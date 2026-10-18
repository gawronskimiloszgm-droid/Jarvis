// J.A.R.V.I.S. - warstwa interfejsu klienta.
//
// Zamiast statycznego ukladu: przestrzen robocza z panelami, ktore mozna
// swobodnie przesuwac i skalowac (mysza i palcem). Uklad zapisuje sie
// lokalnie, wiec zostaje miedzy uruchomieniami.
//
// Dostep: wlasciciel loguje sie haslem i ma pelnie funkcji; gosc moze
// rozmawiac, pytac o pogode i szukac w sieci. Prawdziwa blokada jest na
// serwerze - to tutaj tylko chowa niedostepne rzeczy z oczu.

// ---------- Stan ----------

const store = {
  token: localStorage.getItem('jarvis.token') || null,
  role: 'guest',
  audioLevel: 0,
  live: false,
  wantLive: false,
  location: null,
  user: localStorage.getItem('jarvis.user') || '',
  factCount: null,
  todoCount: null,
  // Stan calego systemu z magistrali serwera: nominal | design | focus |
  // threat | recovery. Maluje interfejs i steruje swiatlem w pokoju.
  posture: null,
  // Czy serwer ma w ogole skonfigurowana usluge klonowania glosu -
  // ustawiane raz przy starcie z /api/health. Bez tego przelacznik w
  // Ustawieniach nie ma czym sterowac.
  cloneVoiceConfigured: false,
  liveClonedVoiceDefault: false,
};

const isOwner = () => store.role === 'owner';

// ---------- Drobiazgi ----------

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function toast(msg, kind = 'bad') {
  const n = el('div', `toast ${kind === 'ok' ? 'ok' : ''}`, msg);
  const container = $('#toasts');
  if (container) container.appendChild(n);
  window.SFX?.play(kind === 'ok' ? 'ok' : 'err');
  setTimeout(() => n.remove(), 4800);
}

function authHeaders(extra = {}) {
  return store.token ? { ...extra, Authorization: `Bearer ${store.token}` } : extra;
}

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
  if (res.status === 403) throw new Error('Brak uprawnien');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Blad ${res.status}`);
  }
  return res.json();
}

// Stan pokazujemy w trzech miejscach naraz: naglowek centrum, ekran
// spoczynku i podpis pod rdzeniem w kolumnie rozmowy.
function setState(text) {
  const head = $('#headStatus');
  if (head) head.textContent = String(text).toLowerCase();
  const idle = $('#idleStatus');
  if (idle) idle.textContent = text;
}

// ---------- Definicje paneli ----------

const PANEL_DEFS = {
  clock: {
    glyph: '🕒',
    title: 'Czas',
    build: (root) => {
      const box = el('div', 'kv');
      box.innerHTML = '<span>Czas lokalny</span><b id="panelClock">--:--</b>';
      root.appendChild(box);
    },
    refresh: () => {
      const elClock = $('#panelClock');
      if (elClock) elClock.textContent = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
  },
  weather: {
    glyph: '🌤',
    title: 'Pogoda',
    build: (root) => {
      root.innerHTML = '<div class="sub">Pobieranie danych pogodowych...</div>';
    }
  },
  link: {
    glyph: '🔗',
    title: 'Status Łącza',
    build: (root) => {
      root.innerHTML = '<div class="kv"><span>Połączenie</span><b class="good">ONLINE</b></div>';
    }
  }
};

// ---------- Moduly ----------

const MODULES = [
  { id: 'edith', title: 'Edith', sub: 'ochrona', owner: true, panels: [] },
  { id: 'dash', title: 'Pulpit', sub: 'przeglad operacyjny', badge: 'LIVE', panels: ['clock', 'weather', 'link'] },
  { id: 'sys', title: 'Systemy', sub: 'stan urzadzenia i lacza', panels: ['link'] },
  { id: 'tasks', title: 'Zadania', sub: 'kolejka i przypomnienia', owner: true, panels: [] },
  { id: 'know', title: 'Wiedza', sub: 'pamiec i kronika rozmow', owner: true, panels: [] },
  { id: 'money', title: 'Wydatki', sub: 'rejestr i podsumowanie', owner: true, panels: [] },
  { id: 'eye', title: 'Kamera', sub: 'podglad na zywo', owner: true, panels: [] },
  { id: 'perimeter', title: 'Perymetr', sub: 'kamery RTSP i alerty', owner: true, panels: [] },
  { id: 'machine', title: 'Maszyna', sub: 'obciazenie laptopa', owner: true, panels: [] },
  { id: 'sentinel', title: 'Wartownik', sub: 'sledzone tematy', owner: true, panels: [] },
  { id: 'cad', title: 'Projekt 3D', sub: 'model i wytrzymalosc', owner: true, panels: [] },
  { id: 'find', title: 'Wyszukiwanie', sub: 'wyniki z sieci', panels: [] },
  { id: 'dev', title: 'Urzadzenie', sub: 'sterowanie i uprawnienia', owner: true, panels: [] },
  { id: 'agent', title: 'Agent', sub: 'wieloetapowe rozumowanie', owner: true, panels: [] },
  { id: 'set', title: 'Ustawienia', sub: 'profil asystenta', panels: [] },
  { id: 'logs', title: 'Logi', sub: 'strumien zdarzen', panels: [] },
];

const MODULE_ICONS = {
  dash: '◈', sys: '◉', tasks: '☷', know: '⚙', money: '◆',
  eye: '◉', perimeter: '△', machine: '■', sentinel: '◎', cad: '⬢',
  find: '●', dev: '⬡', agent: '◇', set: '⚙', logs: '≡', edith: '◆',
};

const LIVE_PANELS = new Set();
const moduleById = (id) => MODULES.find((m) => m.id === id);

// ---------- Silnik holo-okien ----------

const WINDOWS = new Map();
const openIds = new Set();
let activeModule = null;
let topZ = 10;
let cascadeN = 0;

function winKey(id) {
  return `jarvis.win.${id}`;
}

function loadWinState(id) {
  try {
    return JSON.parse(localStorage.getItem(winKey(id)));
  } catch {
    return null;
  }
}

function saveWinState(id, patch) {
  try {
    localStorage.setItem(winKey(id), JSON.stringify({ ...loadWinState(id), ...patch }));
  } catch {
    /* localStorage niedostepny */
  }
}

function defaultGeometry() {
  const w = Math.min(400, window.innerWidth - 40);
  const h = Math.min(360, window.innerHeight - 190);
  const step = cascadeN % 6;
  cascadeN++;
  return { x: 24 + step * 26, y: 24 + step * 22, w, h };
}

function clampGeometry(x, y, w, h) {
  const maxX = Math.max(4, window.innerWidth - Math.min(160, w));
  const maxY = Math.max(4, window.innerHeight - Math.min(120, h) - 60);
  return { x: Math.min(Math.max(4, x), maxX), y: Math.min(Math.max(4, y), maxY) };
}

function bringToFront(win) {
  topZ += 1;
  win.style.zIndex = String(topZ);
}

function makeDraggable(win, id) {
  const bar = win.querySelector('[data-drag]');
  if (!bar) return;
  let dragging = false;
  let ox = 0;
  let oy = 0;

  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    ox = e.clientX - win.offsetLeft;
    oy = e.clientY - win.offsetTop;
    bringToFront(win);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { x, y } = clampGeometry(e.clientX - ox, e.clientY - oy, win.offsetWidth, win.offsetHeight);
    win.style.left = `${x}px`;
    win.style.top = `${y}px`;
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    saveWinState(id, { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight, open: true });
  };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
}

function makeResizable(win, id, minW = 260, minH = 180) {
  const handle = win.querySelector('[data-resize]');
  if (!handle) return;
  let resizing = false;

  handle.addEventListener('pointerdown', (e) => {
    resizing = true;
    handle.setPointerCapture(e.pointerId);
    bringToFront(win);
    e.stopPropagation();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const rect = win.getBoundingClientRect();
    const w = Math.max(minW, Math.min(window.innerWidth - rect.left - 8, e.clientX - rect.left));
    const h = Math.max(minH, Math.min(window.innerHeight - rect.top - 8, e.clientY - rect.top));
    win.style.width = `${w}px`;
    win.style.height = `${h}px`;
  });
  const stop = () => {
    if (!resizing) return;
    resizing = false;
    saveWinState(id, { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight, open: true });
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

function applyGeometry(win, geo) {
  win.style.left = `${geo.x}px`;
  win.style.top = `${geo.y}px`;
  win.style.width = `${geo.w}px`;
  win.style.height = `${geo.h}px`;
}

function buildWindowChrome(id, title, icon) {
  const win = el('section', 'holo-window');
  win.dataset.win = id;

  const bar = el('div', 'holo-titlebar');
  bar.setAttribute('data-drag', '');
  const titleEl = el('span', 'holo-title');
  titleEl.append(el('span', 'holo-ico', icon || '◇'), document.createTextNode(title));
  const controls = el('div', 'holo-controls');
  const closeBtn = el('button', 'holo-x', '×');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeWindow(id);
  });
  controls.appendChild(closeBtn);
  bar.append(el('span', 'holo-dot'), titleEl, controls);

  const body = el('div', 'holo-body');
  const resize = el('div', 'holo-resize');
  resize.setAttribute('data-resize', '');

  win.append(bar, body, resize);
  win.addEventListener('pointerdown', () => bringToFront(win));
  makeDraggable(win, id);
  makeResizable(win, id);
  return { win, body };
}

function openWindow(id) {
  if (id === 'edith') {
    window.Edith?.open();
    return;
  }
  const mod = moduleById(id);
  if (!mod) return;
  if (mod.owner && !isOwner()) {
    toast('Ten modul wymaga zalogowania.');
    return;
  }

  let entry = WINDOWS.get(id);
  if (!entry) {
    const { win, body } = buildWindowChrome(id, mod.title, MODULE_ICONS[id]);
    mod.panels.forEach((pid) => {
      const def = PANEL_DEFS[pid];
      if (!def) return;
      const card = el('div', `card${def.wide ? ' wide' : ''}`);
      const head = el('div', 'card-head');
      head.append(el('span', 'gl', def.glyph), el('span', null, def.title));
      const cbody = el('div', 'card-body');
      card.append(head, cbody);
      body.appendChild(card);
      LIVE_PANELS.add(pid);
      def.build(cbody);
    });
    const board = $('#board');
    if (board) board.appendChild(win);
    entry = { win, body };
    WINDOWS.set(id, entry);
    applyGeometry(win, loadWinState(id) || defaultGeometry());
  }

  entry.win.hidden = false;
  openIds.add(id);
  bringToFront(entry.win);
  mod.panels.forEach((pid) => PANEL_DEFS[pid]?.refresh?.());
  saveWinState(id, { x: entry.win.offsetLeft, y: entry.win.offsetTop, w: entry.win.offsetWidth, h: entry.win.offsetHeight, open: true });
  activeModule = id;
  syncDock();
}

function closeWindow(id) {
  const entry = WINDOWS.get(id);
  if (!entry) return;
  entry.win.hidden = true;
  openIds.delete(id);
  saveWinState(id, { open: false });
  syncDock();
}

function buildDock() {
  const dock = $('#dock');
  if (!dock) return;
  dock.innerHTML = '';
  MODULES.forEach((m) => {
    const b = el('button', 'dock-btn');
    b.type = 'button';
    b.dataset.mod = m.id;
    b.append(el('span', 'dock-ico', MODULE_ICONS[m.id] || '◇'), el('span', 'dock-lbl', m.title));
    b.addEventListener('click', () => openWindow(m.id));
    dock.appendChild(b);
  });
  syncDock();
}

function syncDock() {
  document.querySelectorAll('.dock-btn').forEach((b) => {
    const m = moduleById(b.dataset.mod);
    b.classList.toggle('on', openIds.has(b.dataset.mod));
    b.classList.toggle('off', Boolean(m?.owner) && !isOwner());
  });
}

// Bezpieczne ukrywanie ekranu bootloadera
function hideBootScreen() {
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.add('gone');
    setTimeout(() => {
      boot.style.display = 'none';
    }, 600);
  }
}

// Obsługa logowania / autoryzacji
function initAuth() {
  const form = document.getElementById('authForm');
  const guestBtn = document.getElementById('authGuestBtn');
  const veil = document.getElementById('authVeil');

  if (guestBtn) {
    guestBtn.addEventListener('click', () => {
      store.role = 'guest';
      if (veil) veil.hidden = true;
      toast('Zalogowano w trybie Gościa', 'ok');
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = document.getElementById('authUser')?.value;
      const password = document.getElementById('authPassword')?.value;
      try {
        const res = await api('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, password })
        });
        store.token = res.token;
        store.role = 'owner';
        localStorage.setItem('jarvis.token', res.token);
        localStorage.setItem('jarvis.user', user);
        if (veil) veil.hidden = true;
        toast('Autoryzacja pomyślna', 'ok');
        syncDock();
      } catch (err) {
        const errEl = document.getElementById('authError');
        if (errEl) {
          errEl.textContent = err.message;
          errEl.hidden = false;
        }
      }
    });
  }
}

// Nawigacja między ekranem IDLE a CENTRUM OPERACYJNYM
function initNavigation() {
  const enterBtn = document.getElementById('idleEnter');
  const exitBtn = document.getElementById('exitBtn');
  const idle = document.getElementById('idle');
  const ops = document.getElementById('ops');

  if (enterBtn) {
    enterBtn.addEventListener('click', () => {
      if (idle) idle.hidden = true;
      if (ops) ops.hidden = false;
    });
  }

  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      if (ops) ops.hidden = true;
      if (idle) idle.hidden = false;
    });
  }
}

// Inicjalizacja zegara
function updateClock() {
  const clock = document.getElementById('idleClock');
  const dateEl = document.getElementById('idleDate');
  const now = new Date();
  if (clock) {
    clock.textContent = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  PANEL_DEFS.clock.refresh();
}

// Główny start po załadowaniu DOM
window.addEventListener('DOMContentLoaded', () => {
  try {
    buildDock();
    openWindow('dash');
    initAuth();
    initNavigation();
    setInterval(updateClock, 1000);
    updateClock();
  } catch (err) {
    console.error("Błąd podczas startu aplikacji:", err);
  } finally {
    setTimeout(hideBootScreen, 1000);
  }
});
