// J.A.R.V.I.S. - warstwa interfejsu zbudowana od zera.
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
  $('#toasts').appendChild(n);
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

// ---------- Moduly ----------
//
// Dwa ekrany: SPOCZYNEK (sam rdzen, zegar, skroty) i CENTRUM OPERACYJNE
// (naglowek, kolumna modulow, tresc, stala kolumna rozmowy).
//
// Rozmowa NIE jest modulem - siedzi na stale w prawej kolumnie, wiec
// transkrypcja jest widoczna niezaleznie od tego, co ogladasz.
//
// Kazdy modul buduje sie raz i zostaje w DOM (chowamy, nie kasujemy) -
// dzieki temu kamera nie gasnie przy zajrzeniu gdzie indziej.

const MODULES = [
  { id: 'dash', title: 'Pulpit', sub: 'przeglad operacyjny', badge: 'LIVE', panels: ['clock', 'weather', 'link'] },
  { id: 'sys', title: 'Systemy', sub: 'stan urzadzenia i lacza', panels: ['link'] },
  { id: 'tasks', title: 'Zadania', sub: 'kolejka i przypomnienia', owner: true, panels: ['tasks', 'alerts'] },
  { id: 'know', title: 'Wiedza', sub: 'pamiec i kronika rozmow', owner: true, panels: ['mind'] },
  { id: 'money', title: 'Wydatki', sub: 'rejestr i podsumowanie', owner: true, panels: ['money'] },
  { id: 'eye', title: 'Kamera', sub: 'podglad na zywo', owner: true, panels: ['eye'] },
  { id: 'perimeter', title: 'Perymetr', sub: 'kamery RTSP i alerty', owner: true, panels: ['perimeter'] },
  { id: 'machine', title: 'Maszyna', sub: 'obciazenie laptopa', owner: true, panels: ['machine'] },
  { id: 'sentinel', title: 'Wartownik', sub: 'sledzone tematy', owner: true, panels: ['sentinel'] },
  { id: 'cad', title: 'Projekt 3D', sub: 'model i wytrzymalosc', owner: true, panels: ['cad'] },
  { id: 'find', title: 'Wyszukiwanie', sub: 'wyniki z sieci', panels: ['find'] },
  { id: 'dev', title: 'Urzadzenie', sub: 'sterowanie i uprawnienia', owner: true, panels: ['grip', 'bubble'] },
  { id: 'agent', title: 'Agent', sub: 'wieloetapowe rozumowanie', owner: true, panels: ['agent'] },
  { id: 'set', title: 'Ustawienia', sub: 'profil asystenta', panels: ['settings'] },
  { id: 'logs', title: 'Logi', sub: 'strumien zdarzen', panels: ['logs'] },
];

const MODULE_ICONS = {
  dash: '◈', sys: '◉', tasks: '☷', know: '⚙', money: '◆',
  eye: '◉', perimeter: '△', machine: '■', sentinel: '◎', cad: '⬢',
  find: '●', dev: '⬡', agent: '◇', set: '⚙', logs: '≡',
};

const LIVE_PANELS = new Set();
const panelLive = (id) => LIVE_PANELS.has(id);
const moduleById = (id) => MODULES.find((m) => m.id === id);

// ---------- Silnik sceny (mostek dowodzenia) ----------
//
// Zadna swobodna tablica z przeciaganymi oknami - szyna nawigacji po lewej
// (#dock) i JEDNA aktywna scena na srodku (#board). Kazdy modul nadal
// buduje sie raz i zostaje w DOM (chowany, nie kasowany - kamera nie gasnie
// przy przejsciu gdzie indziej), ale widac na raz tylko jeden, z przejsciem
// (patrz .stage-panel.show w CSS). Zapamietuje sie tylko to, KTORY modul
// byl ostatnio na scenie - nie ma juz pozycji/rozmiaru do pilnowania.

const WINDOWS = new Map(); // id -> { win, body }
let activeModule = null;

const ACTIVE_KEY = 'jarvis.activeModule';
const PRELOGOUT_KEY = 'jarvis.preLogoutModule';

function isWindowOpen(id) {
  return activeModule === id;
}

function getSavedModule() {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function setSavedModule(id) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* localStorage moze byc niedostepny (tryb prywatny) - po prostu nie zapamieta */
  }
}

function buildWindowChrome(id, title, icon) {
  const win = el('section', 'stage-panel');
  win.dataset.win = id;
  win.hidden = true;

  const bar = el('div', 'stage-titlebar');
  const titleEl = el('span', 'stage-title');
  titleEl.append(el('span', 'stage-ico', icon || '◇'), document.createTextNode(title));
  bar.appendChild(titleEl);

  const body = el('div', 'stage-body');
  win.append(bar, body);
  return { win, body };
}

function openWindow(id) {
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
    $('#board').appendChild(win);
    entry = { win, body };
    WINDOWS.set(id, entry);
  }

  if (activeModule && activeModule !== id) {
    const prev = WINDOWS.get(activeModule);
    if (prev) {
      prev.win.classList.remove('show');
      prev.win.hidden = true;
    }
  }

  entry.win.hidden = false;
  requestAnimationFrame(() => entry.win.classList.add('show'));
  activeModule = id;
  setSavedModule(id);
  mod.panels.forEach((pid) => PANEL_DEFS[pid]?.refresh?.());
  syncDock();
}

// W modelu jednej sceny "zamkniecie" oznacza powrot do pulpitu - nie ma
// sensu chowac aktywnego modulu bez pokazania czegokolwiek w zamian.
function closeWindow(id) {
  if (activeModule === id) openWindow('dash');
}

function buildDock() {
  const dock = $('#dock');
  dock.innerHTML = '';
  MODULES.forEach((m) => {
    const b = el('button', 'dock-btn');
    b.type = 'button';
    b.dataset.mod = m.id;
    b.title = m.title;
    b.append(el('span', 'dock-ico', MODULE_ICONS[m.id] || '◇'), el('span', 'dock-lbl', m.title));
    b.addEventListener('click', () => openWindow(m.id));
    dock.appendChild(b);
  });
  syncDock();
}

function syncDock() {
  document.querySelectorAll('.dock-btn').forEach((b) => {
    const m = moduleById(b.dataset.mod);
    b.classList.toggle('on', activeModule === b.dataset.mod);
    b.classList.toggle('off', Boolean(m?.owner) && !isOwner());
  });
}

// Pierwsze uruchomienie: Pulpit. Kolejne wizyty: ten modul, ktory byl na
// scenie, gdy ostatnio zamykales appke.
function restoreBoard() {
  const saved = getSavedModule();
  const mod = saved && moduleById(saved);
  openWindow(mod && (!mod.owner || isOwner()) ? saved : 'dash');
}

// Po wylogowaniu modul wlasciciela znika RAZEM z wczytana trescia - inaczej
// gosc zobaczylby cudze zadania czy pamiec. Zapamietujemy, co to bylo, zeby
// po ponownym zalogowaniu wrocic dokladnie tam, a nie zawsze na pulpit.
function dropOwnerModules() {
  if (activeModule && moduleById(activeModule)?.owner) {
    try {
      localStorage.setItem(PRELOGOUT_KEY, activeModule);
    } catch {
      /* localStorage moze byc niedostepny */
    }
  }
  const wasOwnerActive = Boolean(moduleById(activeModule)?.owner);
  MODULES.filter((m) => m.owner).forEach((m) => {
    const entry = WINDOWS.get(m.id);
    if (!entry) return;
    if (m.id === 'eye') camOff();
    entry.win.remove();
    WINDOWS.delete(m.id);
    m.panels.forEach((p) => LIVE_PANELS.delete(p));
  });
  if (wasOwnerActive) {
    activeModule = null;
    openWindow('dash');
  }
  syncDock();
}

// Rozmowa to staly pasek boczny (#comms), nie okno do przeciagania - nic
// tu juz nie trzeba spinac, funkcja zostaje jako no-op dla zgodnosci z
// miejscem wywolania przy starcie appki.
function initTalkWindow() {}

// ---------- Dziennik zdarzen ----------
// Prawdziwe zdarzenia aplikacji, nie generowany szum: logowanie, mikrofon,
// akcje na urzadzeniu, bledy. Modul "Logi" czyta wlasnie to.

const EVENTS = [];

function logEvent(source, message, kind = 'info') {
  EVENTS.unshift({ source, message, kind, at: new Date() });
  if (EVENTS.length > 200) EVENTS.length = 200;
  if (panelLive('logs')) drawLogs();
}

function drawLogs() {
  const box = $('#logList');
  if (!box) return;
  box.innerHTML = '';
  if (!EVENTS.length) {
    box.appendChild(el('div', 'hint', 'Brak zdarzen w tej sesji.'));
    return;
  }
  EVENTS.forEach((e) => {
    const row = el('div', 'kv');
    const t = e.at.toLocaleTimeString('pl-PL', { hour12: false });
    row.append(el('span', null, `${t}  ${e.source}`));
    const b = el('b', e.kind === 'bad' ? '' : 'good', e.message);
    if (e.kind === 'bad') b.style.color = 'var(--red)';
    row.appendChild(b);
    box.appendChild(row);
  });
}

// ---------- Przelaczanie ekranow ----------

function enterOps(moduleId) {
  $('#idle').hidden = true;
  $('#ops').hidden = false;
  if (moduleId) openWindow(moduleId);
}

function exitOps() {
  $('#ops').hidden = true;
  $('#idle').hidden = false;
}

function opsVisible() {
  return !$('#ops').hidden;
}


// ---------- Projektowanie 3D ----------

let cadView = null;
let lastDesign = null;

async function runDesign(spec) {
  if (!isOwner()) return toast('Projektowanie wymaga zalogowania.');

  const body = spec || {
    loadKg: parseFloat($('#cadLoad')?.value) || 5,
    shelfDepth: parseFloat($('#cadArm')?.value) || 45,
    plateW: parseFloat($('#cadWidth')?.value) || 60,
    thickness: parseFloat($('#cadThick')?.value) || 5,
    material: $('#cadMat')?.value || 'PLA',
  };

  setCoreState('PROJEKTUJE');
  try {
    const model = await api('/api/cad', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    lastDesign = model;
    logEvent('cad', `model ${model.id}: ${model.strength.verdict.toLowerCase()}`, model.strength.ok ? 'info' : 'bad');
    drawCadInfo(model);
    mountCadView(model);
    window.SFX?.play(model.strength.ok ? 'ok' : 'err');
  } catch (err) {
    toast(err.message || 'Nie udalo sie wygenerowac modelu.');
  } finally {
    setCoreState(store.live ? 'SLUCHAM' : 'GOTOWY');
  }
}

function mountCadView(model) {
  const cv = $('#cadCanvas');
  if (!cv || !window.CADView) return;
  cadView?.stop();
  cadView = window.CADView(cv, model);
}

// Przycisk drukowania jest wspolny dla obu ukladow panelu (wspornik i
// zlozenie z brył) - zawsze widoczny, bo brak skonfigurowanej drukarki to
// stan normalny, nie blad: serwer po prostu odpowie jasnym komunikatem.
function printButton(id) {
  const btn = el('button', 'btn', 'WYDRUKUJ');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = 'WYSYLAM...';
    try {
      await api(`/api/cad/${id}/print`, { method: 'POST' });
      toast('Wyslano do drukarki.', 'ok');
    } catch (err) {
      toast(err.message || 'Nie udalo sie wyslac do drukarki.');
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  });
  return btn;
}

function drawCadInfo(model) {
  const box = $('#cadInfo');
  if (!box) return;
  box.innerHTML = '';

  if (!model) {
    box.appendChild(
      el('div', 'hint', 'Podaj parametry wspornika ponizej, albo popros Jarvisa glosem/na czacie o cokolwiek: "zaprojektuj uchwyt na 15 funtow" albo "zrob mi podstawke pod telefon".')
    );
    return;
  }

  const s = model.strength;

  // Zlozenia z brył (zaprojektuj_model) nie maja analizy wytrzymalosci -
  // to inna geometria niz belka wspornikowa, wzor sigma=M/W by tu klamal.
  // Panel wtedy pokazuje tylko geometrie, bez werdyktu/mapy naprezen.
  if (!s) {
    if (model.nazwa) box.appendChild(el('div', 'big-num', model.nazwa)).style.fontSize = '17px';
    const rows = [
      ['WYMIARY', model.sizeMm.join(' x ') + ' mm'],
      ['MATERIAL', model.params?.material || 'PLA'],
      ['MASA ~', `${model.massEstimateG} g`],
      ['OBJETOSC', `${model.volumeCm3} cm3`],
      ['TROJKATOW', model.triangles],
    ];
    rows.forEach(([k, v]) => {
      const r = el('div', 'kv');
      r.append(el('span', null, k), el('b', null, String(v)));
      box.appendChild(r);
    });
    const basis = el('div', 'sub');
    basis.style.cssText = 'margin-top:10px; line-height:1.6; letter-spacing:0; text-transform:none';
    basis.textContent = 'Prosty model geometryczny ze zlozenia brył, bez symulacji wytrzymalosciowej.';
    box.appendChild(basis);

    const actions = el('div', 'field');
    actions.style.marginTop = '10px';
    const dl = el('a', 'btn', 'POBIERZ STL');
    dl.href = `/api/cad/${model.id}/stl`;
    dl.setAttribute('download', `jarvis-${model.id}.stl`);
    actions.append(dl, printButton(model.id));
    box.appendChild(actions);
    return;
  }

  const verdict = el('div', 'big-num', s.verdict);
  verdict.style.fontSize = '17px';
  verdict.style.color = s.ok ? 'var(--good)' : 'var(--red)';
  box.appendChild(verdict);
  box.appendChild(el('div', 'sub', `ZAPAS ${s.safety ?? '--'}x`));

  const rows = [
    ['NAPREZENIE', `${s.stressMPa} MPa`],
    ['LIMIT', `${s.limitMPa} MPa`],
    ['MATERIAL', s.material],
    ['SILA', `${s.forceN} N`],
    ['WYMIARY', model.sizeMm.join(' x ') + ' mm'],
    ['MASA ~', `${model.massEstimateG} g`],
    ['TROJKATOW', model.triangles],
  ];
  rows.forEach(([k, v]) => {
    const r = el('div', 'kv');
    r.append(el('span', null, k), el('b', null, String(v)));
    box.appendChild(r);
  });

  // Podstawa oceny musi byc widoczna - inaczej liczby udaja wynik symulacji.
  const basis = el('div', 'sub');
  basis.style.cssText = 'margin-top:10px; line-height:1.6; letter-spacing:0; text-transform:none';
  basis.textContent = `Model belki wspornikowej (sigma = M/W), nie MES. Limit: ${s.limitBasis}. Mapa cieplna pokazuje rozklad z tego modelu.`;
  box.appendChild(basis);

  if (model.fix) {
    const fix = el('div', 'row');
    fix.style.marginTop = '10px';
    const t = el('div', 'row-text', model.fix.note);
    const b = el('button', 'btn', 'POPRAW');
    b.addEventListener('click', () => {
      const inp = $('#cadThick');
      if (inp) inp.value = model.fix.thickness;
      runDesign();
    });
    fix.append(t, b);
    box.appendChild(fix);
  }

  const actions = el('div', 'field');
  actions.style.marginTop = '10px';
  const heat = el('button', 'btn', 'MAPA NAPREZEN');
  let heatOn = true;
  heat.classList.add('primary');
  heat.addEventListener('click', () => {
    heatOn = !heatOn;
    cadView?.setHeat(heatOn);
    heat.classList.toggle('primary', heatOn);
  });
  const dl = el('a', 'btn', 'POBIERZ STL');
  dl.href = `/api/cad/${model.id}/stl`;
  dl.setAttribute('download', `jarvis-${model.id}.stl`);
  actions.append(heat, dl, printButton(model.id));
  box.appendChild(actions);
}

// ---------- Karty na ekranie spoczynku ----------
//
// Tylko rzeczy, ktore naprawde znamy: pogoda z serwisu, najblizsze
// przypomnienie i liczba zadan. Zadnych wymyslonych odczytow.

async function drawIdleCards() {
  const box = $('#idleCards');
  if (!box) return;
  const cards = [];

  const temp = $('#wxTemp')?.textContent;
  if (temp && temp !== '--°') {
    cards.push(['POGODA', temp, $('#wxDesc')?.textContent || '']);
  }

  if (isOwner()) {
    try {
      const { todos } = await api('/api/todos');
      const open = (todos || []).filter((t) => !t.done);
      store.todoCount = open.length;
      cards.push(['ZADANIA', String(open.length), open[0]?.text || 'nic w kolejce']);
    } catch {
      /* brak uprawnien albo brak sieci */
    }
    try {
      const { reminders } = await api('/api/reminders');
      const next = (reminders || [])
        .filter((r) => !r.sent)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
      if (next) {
        const when = new Date(next.dueAt);
        cards.push([
          'NAJBLIZSZE',
          when.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }),
          next.text,
        ]);
      }
    } catch {
      /* jw. */
    }
  }

  box.innerHTML = '';
  cards.forEach(([cap, value, note]) => {
    const c = el('div', 'idle-card');
    c.append(el('span', null, cap), el('b', null, value), el('i', null, note));
    box.appendChild(c);
  });
  refreshHeadStats();
}

// ---------- Paleta polecen ----------

function paletteCommands() {
  const cmds = MODULES.filter((m) => !m.owner || isOwner()).map((m) => ({
    label: m.title,
    hint: m.sub,
    run: () => {
      enterOps(m.id);
    },
  }));
  cmds.push(
    { label: store.live ? 'Wycisz rozmowe' : 'Wznow rozmowe', hint: 'mikrofon', run: liveToggle },
    { label: 'Ekran spoczynku', hint: 'sam rdzen', run: exitOps },
    {
      label: isOwner() ? 'Wyloguj' : 'Zaloguj',
      hint: 'konto',
      run: () => (isOwner() ? doLogout() : showAuth()),
    }
  );
  if (isOwner()) cmds.push({ label: 'E.D.I.T.H.', hint: 'ochrona', run: () => window.Edith?.open() });
  return cmds;
}

let paletteItems = [];
let paletteSel = 0;

function openPalette() {
  $('#palette').hidden = false;
  const input = $('#paletteInput');
  input.value = '';
  drawPalette('');
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  $('#palette').hidden = true;
}

function drawPalette(query) {
  const q = query.trim().toLowerCase();
  paletteItems = paletteCommands().filter(
    (c) => !q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)
  );
  paletteSel = 0;
  const list = $('#paletteList');
  list.innerHTML = '';

  if (!paletteItems.length) {
    // Nic nie pasuje do modulow - traktujemy wpis jako pytanie do Jarvisa.
    const b = el('button', 'palette-item');
    b.append(el('span', null, `Zapytaj Jarvisa: "${query.trim()}"`), el('span', 'k', 'ENTER'));
    b.addEventListener('click', () => {
      closePalette();
      enterOps();
      sendTyped(query.trim());
    });
    list.appendChild(b);
    paletteItems = [{ label: '', hint: '', run: () => b.click() }];
    return;
  }

  paletteItems.forEach((c, i) => {
    const b = el('button', `palette-item${i === 0 ? ' sel' : ''}`);
    b.append(el('span', null, c.label), el('span', 'k', c.hint));
    b.addEventListener('click', () => {
      closePalette();
      c.run();
    });
    list.appendChild(b);
  });
}

function movePalette(delta) {
  const items = [...document.querySelectorAll('.palette-item')];
  if (!items.length) return;
  items[paletteSel]?.classList.remove('sel');
  paletteSel = (paletteSel + delta + items.length) % items.length;
  items[paletteSel].classList.add('sel');
  items[paletteSel].scrollIntoView({ block: 'nearest' });
}

// ---------- Definicje paneli ----------

// Rdzen nie jest juz panelem - siedzi na stale w HTML jako tlo aplikacji
// (patrz startCoreVisual w boot()). Ponizsze definicje to tresc zakladek.
const PANEL_DEFS = {
  link: {
    title: 'SYSTEM',
    glyph: '▤',
    build(body) {
      body.innerHTML = '';
      const rows = [
        ['TOZSAMOSC', 'linkRole'],
        ['BATERIA', 'linkBattery'],
        ['PAMIEC', 'linkStorage'],
        ['LACZE', 'linkNet'],
      ];
      rows.forEach(([label, id]) => {
        const r = el('div', 'kv');
        r.append(el('span', null, label));
        const b = el('b', null, '--');
        b.id = id;
        r.appendChild(b);
        body.appendChild(r);
      });
      refreshLink();
    },
    refresh: () => refreshLink(),
  },

  clock: {
    title: 'CZAS',
    glyph: '◷',
    build(body) {
      body.innerHTML = '';
      const t = el('div', 'big-num', '--:--:--');
      t.id = 'clkTime';
      const d = el('div', 'sub', '');
      d.id = 'clkDate';
      body.append(t, d);
      tickClock();
    },
  },

  weather: {
    title: 'OTOCZENIE',
    glyph: '◍',
    build(body) {
      body.innerHTML = '';
      const t = el('div', 'big-num', '--°');
      t.id = 'wxTemp';
      const d = el('div', 'sub', 'lokalizuje...');
      d.id = 'wxDesc';
      const p = el('div', 'sub', '');
      p.id = 'wxPlace';
      p.style.marginTop = '6px';
      const f = el('div');
      f.id = 'wxDays';
      f.style.marginTop = '10px';
      body.append(t, d, p, f);
      loadWeather();
    },
  },

  // Rozmowa nie jest juz panelem - siedzi na stale w prawej kolumnie.

  cad: {
    title: 'PROJEKTOWANIE 3D',
    glyph: '◈',
    wide: true,
    build(body) {
      body.innerHTML = '';

      const form = el('form', 'field');
      form.style.flexWrap = 'wrap';
      const mk = (id, ph, val, w = '90px') => {
        const i = el('input', 'inp');
        i.id = id;
        i.placeholder = ph;
        i.value = val;
        i.style.maxWidth = w;
        i.inputMode = 'decimal';
        return i;
      };
      const mat = el('select', 'inp');
      mat.id = 'cadMat';
      mat.style.maxWidth = '110px';
      ['PLA', 'PETG', 'ABS', 'ASA', 'NYLON'].forEach((m) => {
        const o = el('option', null, m);
        o.value = m;
        mat.appendChild(o);
      });
      const go = el('button', 'btn primary', 'ZAPROJEKTUJ');
      go.type = 'submit';
      form.append(
        mk('cadLoad', 'obciazenie kg', '6.8'),
        mk('cadArm', 'wysieg mm', '45'),
        mk('cadWidth', 'szerokosc mm', '60'),
        mk('cadThick', 'grubosc mm', '5'),
        mat,
        go
      );

      const stage = el('div');
      stage.style.cssText = 'display:grid; grid-template-columns:minmax(240px,1fr) minmax(220px,280px); gap:12px';

      const viewWrap = el('div');
      viewWrap.style.cssText = 'position:relative; min-height:280px; border:1px solid var(--line); border-radius:3px; background:#040a12';
      const cv = el('canvas');
      cv.id = 'cadCanvas';
      cv.style.cssText = 'display:block; width:100%; height:280px; cursor:grab';
      const tip = el('div', 'sub', 'PRZECIAGNIJ, ZEBY OBROCIC');
      tip.style.cssText = 'position:absolute; left:10px; bottom:8px; opacity:.6';
      viewWrap.append(cv, tip);

      const info = el('div');
      info.id = 'cadInfo';

      stage.append(viewWrap, info);
      body.append(form, stage);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        runDesign();
      });

      drawCadInfo(null);
    },
  },

  agent: {
    title: 'AGENT - WIELOETAPOWE ROZUMOWANIE',
    glyph: '◈',
    owner: true,
    wide: true,
    build(body) {
      body.innerHTML = '';
      const note = el(
        'div',
        'sub',
        'Do pytan wymagajacych kilku krokow naraz (np. "sprawdz pogode i moj kalendarz i powiedz czy zdaze") - Jarvis sam dobiera i laczy narzedzia, zamiast odpowiadac z jednego kontekstu.'
      );
      note.style.marginBottom = '10px';

      const f = el('form', 'field col');
      const i = el('input', 'inp');
      i.placeholder = 'Cel dla agenta...';
      i.autocomplete = 'off';
      const b = el('button', 'btn primary', 'URUCHOM');
      b.type = 'submit';
      f.append(i, b);

      const log = el('div');
      log.id = 'agentLog';
      const result = el('div', 'row-text');
      result.id = 'agentResult';
      const pending = el('div');
      pending.id = 'agentPending';

      body.append(note, f, pending, log, result);

      function renderLog(entries) {
        log.innerHTML = '';
        (entries || []).forEach((step) => {
          const row = el('div', 'kv');
          row.append(el('span', null, step.narzedzie), el('b', null, JSON.stringify(step.wynik).slice(0, 80)));
          log.appendChild(row);
        });
      }

      function renderPending(data) {
        pending.innerHTML = '';
        if (!data?.needsConfirmation) return;
        const box = el('div', 'row');
        const txt = el('div', 'row-text', `Agent chce wykonac: ${data.pendingCall.name} (${JSON.stringify(data.pendingCall.args)})`);
        txt.style.flex = '1';
        const okBtn = el('button', 'btn primary', 'POTWIERDZ');
        okBtn.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const res = await api('/api/agent/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ runId: data.runId }),
            });
            renderLog(res.log);
            renderPending(res);
            result.textContent = res.text || '';
          } catch (err) {
            toast(err.message);
          } finally {
            b.disabled = false;
          }
        });
        const noBtn = el('button', 'btn danger', 'ANULUJ');
        noBtn.addEventListener('click', () => {
          pending.innerHTML = '';
        });
        box.append(txt, okBtn, noBtn);
        pending.appendChild(box);
      }

      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const goal = i.value.trim();
        if (!goal) return;
        b.disabled = true;
        result.textContent = '';
        pending.innerHTML = '';
        log.innerHTML = '';
        try {
          const res = await api('/api/agent/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal, location: store.location }),
          });
          renderLog(res.log);
          renderPending(res);
          result.textContent = res.text || '';
          logEvent('agent', `zapytanie: ${goal}`);
        } catch (err) {
          toast(err.message);
        } finally {
          b.disabled = false;
        }
      });
    },
  },

  settings: {
    title: 'PROFIL ASYSTENTA',
    glyph: '⚙',
    wide: true,
    build(body) {
      body.innerHTML = '';

      const opts = [
        {
          key: 'jarvis.sfx',
          label: 'Dzwieki interfejsu',
          desc: 'krotkie sygnaly przy klikaniu i wlaczaniu mikrofonu',
          on: () => window.SFX?.isEnabled?.() !== false,
          set: (v) => window.SFX?.setEnabled(v),
        },
        {
          key: 'jarvis.wake',
          label: 'Slowo aktywujace w przegladarce',
          desc: 'nasluch frazy "Jarvis". Uwaga: przegladarka gra przy tym wlasny sygnal Google, ktorego nie da sie wyciszyc',
          on: () => localStorage.getItem('jarvis.wake') === 'on',
          set: (v) => {
            localStorage.setItem('jarvis.wake', v ? 'on' : 'off');
            toast('Zmiana zadziala po odswiezeniu strony.', 'ok');
          },
        },
      ];

      // Tylko wlasciciel i tylko gdy serwer ma naprawde skonfigurowana
      // usluge klonujaca - inaczej przelacznik nic by nie robil i tylko
      // by mylil.
      if (isOwner() && store.cloneVoiceConfigured) {
        opts.push({
          key: 'jarvis.liveClone',
          label: 'Sklonowany glos w rozmowie na zywo',
          desc: 'zamiast wbudowanego glosu Gemini. Wolniejsza pierwsza odpowiedz w kazdej turze - synteza czeka na koniec zdania',
          on: () => {
            const v = localStorage.getItem('jarvis.liveClone');
            return v === '1' || (v == null && store.liveClonedVoiceDefault);
          },
          set: (v) => {
            localStorage.setItem('jarvis.liveClone', v ? '1' : '0');
            toast('Zmiana zadziala od nastepnej rozmowy - wznawiam teraz.', 'ok');
            if (store.live) {
              liveStop();
              setTimeout(liveStart, 300);
            }
          },
        });
      }

      opts.forEach((o) => {
        const row = el('div', 'row');
        const txt = el('div');
        txt.style.flex = '1';
        txt.append(el('div', 'row-text', o.label), el('div', 'sub', o.desc));
        const cb = el('input', 'row-check');
        cb.type = 'checkbox';
        cb.checked = o.on();
        cb.addEventListener('change', () => {
          o.set(cb.checked);
          logEvent('ustawienia', `${o.label}: ${cb.checked ? 'wlaczone' : 'wylaczone'}`);
        });
        row.append(txt, cb);
        body.appendChild(row);
      });

      const sep = el('div', 'sub', 'KONTO');
      sep.style.margin = '14px 0 8px';
      body.appendChild(sep);

      const acc = el('div', 'field');
      const who = el('div', 'row-text', isOwner() ? `Zalogowany${store.user ? ' jako ' + store.user : ''}` : 'Tryb goscia');
      who.style.flex = '1';
      const b = el('button', 'btn', isOwner() ? 'WYLOGUJ' : 'ZALOGUJ');
      b.addEventListener('click', () => (isOwner() ? doLogout() : showAuth()));
      acc.append(who, b);
      body.appendChild(acc);

      const notif = el('button', 'btn', 'WLACZ POWIADOMIENIA');
      notif.addEventListener('click', async () => {
        if (!('Notification' in window)) return toast('Brak obslugi powiadomien.');
        const p = await Notification.requestPermission();
        toast(p === 'granted' ? 'Powiadomienia wlaczone.' : 'Powiadomienia odrzucone.', p === 'granted' ? 'ok' : 'bad');
      });
      body.appendChild(notif);

      if (isOwner()) {
        const sep2 = el('div', 'sub', 'PROAKTYWNOSC I URZADZENIA');
        sep2.style.margin = '14px 0 8px';
        body.appendChild(sep2);

        const dndRow = el('div', 'row');
        const dndTxt = el('div');
        dndTxt.style.flex = '1';
        dndTxt.append(el('div', 'row-text', 'Nie przeszkadzac'), el('div', 'sub', 'Jarvis wstrzymuje zaczepki z wlasnej inicjatywy (przypomnienia zaplanowane recznie i tak dojda)'));
        const dndCb = el('input', 'row-check');
        dndCb.type = 'checkbox';
        dndRow.append(dndTxt, dndCb);
        body.appendChild(dndRow);

        api('/api/proactive/dnd').then((d) => { dndCb.checked = Boolean(d.active); }).catch(() => {});
        dndCb.addEventListener('change', async () => {
          try {
            await api('/api/proactive/dnd', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active: dndCb.checked, minutes: dndCb.checked ? 240 : 0 }),
            });
            logEvent('ustawienia', `nie przeszkadzac: ${dndCb.checked ? 'wlaczone (4h)' : 'wylaczone'}`);
          } catch (err) {
            toast(err.message);
          }
        });

        const devBox = el('div');
        devBox.className = 'sub';
        devBox.style.marginTop = '10px';
        devBox.textContent = 'Sprawdzanie polaczonych urzadzen...';
        body.appendChild(devBox);
        api('/api/devices')
          .then(({ devices }) => {
            devBox.textContent = devices.length
              ? `POLACZONE TERAZ: ${devices.map((d) => d.name).join(', ')}`
              : 'Brak innych polaczonych urzadzen w tej chwili.';
          })
          .catch(() => { devBox.textContent = ''; });
      }
    },
  },

  logs: {
    title: 'STRUMIEN ZDARZEN',
    glyph: '≡',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const note = el('div', 'sub', 'ZDARZENIA TEJ SESJI - ZAPIS RZECZYWISTY, NIE PODGLAD DEMONSTRACYJNY');
      note.style.marginBottom = '10px';
      const box = el('div');
      box.id = 'logList';
      body.append(note, box);
      drawLogs();
    },
    refresh: () => drawLogs(),
  },

  tasks: {
    title: 'ZADANIA',
    glyph: '☰',
    owner: true,
    build(body) {
      body.innerHTML = '';
      const f = el('form', 'field');
      const i = el('input', 'inp');
      i.placeholder = 'Nowe zadanie...';
      i.autocomplete = 'off';
      const b = el('button', 'btn', '+');
      b.type = 'submit';
      f.append(i, b);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!i.value.trim()) return;
        try {
          const { todos } = await api('/api/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: i.value.trim() }),
          });
          i.value = '';
          drawTasks(todos);
        } catch (err) {
          toast(err.message);
        }
      });
      const ul = el('ul', 'list');
      ul.id = 'taskList';
      body.append(f, ul);
      loadTasks();
    },
    refresh: () => loadTasks(),
  },

  alerts: {
    title: 'PRZYPOMNIENIA',
    glyph: '◔',
    owner: true,
    build(body) {
      body.innerHTML = '';
      const f = el('form', 'field col');
      const i = el('input', 'inp');
      i.placeholder = 'Tresc...';
      i.autocomplete = 'off';
      const d = el('input', 'inp');
      d.type = 'datetime-local';
      const b = el('button', 'btn', 'Dodaj');
      b.type = 'submit';
      f.append(i, d, b);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!i.value.trim() || !d.value) return;
        try {
          const { reminders } = await api('/api/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: i.value.trim(), dueAt: d.value }),
          });
          i.value = '';
          d.value = '';
          drawAlerts(reminders);
        } catch (err) {
          toast(err.message);
        }
      });
      const ul = el('ul', 'list');
      ul.id = 'alertList';
      body.append(f, ul);
      loadAlerts();
    },
    refresh: () => loadAlerts(),
  },

  mind: {
    title: 'PAMIEC',
    glyph: '❖',
    owner: true,
    build(body) {
      body.innerHTML = '';
      const ul = el('ul', 'list');
      ul.id = 'mindList';
      body.appendChild(ul);
      loadMind();
    },
    refresh: () => loadMind(),
  },

  eye: {
    title: 'KAMERA',
    glyph: '◎',
    owner: true,
    build(body) {
      body.innerHTML = '';
      const v = el('video', 'cam-feed');
      v.id = 'camFeed';
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;
      const note = el('div', 'hint', 'Kamera wylaczona. Powiedz Jarvisowi "wlacz kamere".');
      note.id = 'camNote';
      body.append(v, note);
      v.style.display = camStream ? 'block' : 'none';
      note.style.display = camStream ? 'none' : 'block';
      if (camStream) v.srcObject = camStream;
    },
  },

  find: {
    title: 'WYSZUKIWANIE',
    glyph: '⌕',
    build(body) {
      body.innerHTML = '';
      const q = el('div', 'sub', 'Powiedz Jarvisowi, czego poszukac.');
      q.id = 'findQuery';
      const r = el('div');
      r.id = 'findHits';
      r.style.marginTop = '10px';
      body.append(q, r);
      if (lastSearch) drawHits(lastSearch.query, lastSearch.results);
    },
  },

  bubble: {
    title: 'TRYB W TLE',
    glyph: '◐',
    owner: true,
    build(body) {
      body.innerHTML = '';
      if (!isNativeShell()) {
        const l = el('div', 'locked');
        l.append(el('div', 'locked-mark', '◐'));
        const p = el('p');
        p.textContent = 'Dymek dziala tylko w aplikacji na Androida, nie w przegladarce.';
        l.appendChild(p);
        body.appendChild(l);
        return;
      }
      const state = el('div', 'kv');
      state.append(el('span', null, 'STAN'));
      const b = el('b', null, '...');
      b.id = 'bubbleState';
      state.appendChild(b);

      const perm = el('div', 'kv');
      perm.append(el('span', null, 'ZGODA NA NAKLADKE'));
      const pb = el('b', null, '...');
      pb.id = 'bubblePerm';
      perm.appendChild(pb);

      const info = el('div', 'sub');
      info.style.margin = '10px 0';
      info.textContent =
        'Jarvis zostaje na ekranie jako dymek i dziala po zamknieciu aplikacji. Wymaga zgody systemu na wyswietlanie nad innymi aplikacjami.';

      const row = el('div', 'field');
      const permBtn = el('button', 'btn', 'Daj zgode');
      permBtn.id = 'bubblePermBtn';
      permBtn.addEventListener('click', async () => {
        await window.Capacitor.Plugins.Bubble.requestPermission();
        toast('Wlacz zgode w ustawieniach, potem wroc tutaj.', 'ok');
      });
      const toggleBtn = el('button', 'btn primary', 'Wlacz');
      toggleBtn.id = 'bubbleToggle';
      toggleBtn.addEventListener('click', async () => {
        const P = window.Capacitor.Plugins.Bubble;
        try {
          const s = await P.status();
          if (s.running) await P.stop();
          else await P.start();
        } catch (err) {
          toast(err.message || 'Nie udalo sie przelaczyc dymka.');
        }
        refreshBubble();
      });
      row.append(permBtn, toggleBtn);

      body.append(state, perm, info, row);
      refreshBubble();
    },
    refresh: () => refreshBubble(),
  },

  machine: {
    title: 'MASZYNA DOMOWA',
    glyph: '▮',
    owner: true,
    build(body) {
      body.innerHTML = '';
      const note = el('div', 'sub', 'ODCZYTY Z AGENTA NA LAPTOPIE (home-server/system-monitor.js)');
      note.style.marginBottom = '10px';
      const box = el('div');
      box.id = 'machineBox';
      body.append(note, box);
      loadMachines();
      // Telemetria trafia na magistrale TYLKO przy przekroczeniu progu -
      // celowo, zeby dziennik nie zapelnil sie odczytami co 20 sekund.
      // Panel musi wiec sam odpytywac, inaczej pokazywalby zamrozone
      // liczby. Odpytujemy tylko gdy modul jest naprawde widoczny.
      startMachinePolling();
    },
    refresh: () => loadMachines(),
  },

  sentinel: {
    title: 'WARTOWNIK TEMATOW',
    glyph: '◔',
    owner: true,
    wide: true,
    build(body) {
      body.innerHTML = '';
      const note = el(
        'div',
        'sub',
        'JARVIS SPRAWDZA TE TEMATY W TLE (CO GODZINE) I MELDUJE, GDY POJAWI SIE COS NOWEGO'
      );
      note.style.marginBottom = '10px';

      const f = el('form', 'field');
      const i = el('input', 'inp');
      i.placeholder = 'np. premiery Nvidia RTX, cena stali zbrojeniowej...';
      i.autocomplete = 'off';
      const b = el('button', 'btn primary', '+ SLEDZ');
      b.type = 'submit';
      f.append(i, b);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!i.value.trim()) return;
        try {
          await api('/api/sentinel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: i.value.trim() }),
          });
          i.value = '';
          loadSentinel();
        } catch (err) {
          toast(err.message);
        }
      });

      const list = el('div');
      list.id = 'sentinelList';
      body.append(note, f, list);
      loadSentinel();
    },
    refresh: () => loadSentinel(),
  },

  perimeter: {
    title: 'PERYMETR',
    glyph: '◉',
    owner: true,
    build(body) {
      body.innerHTML = '';
      const note = el(
        'div',
        'sub',
        'KAMERY LACZA SIE Z AGENTEM NA LAPTOPIE (home-server/camera-watcher.js), NIE BEZPOSREDNIO Z PRZEGLADARKA'
      );
      note.style.marginBottom = '10px';
      const ul = el('ul', 'list');
      ul.id = 'perimeterList';
      body.append(note, ul);
      loadPerimeter();
    },
    refresh: () => loadPerimeter(),
  },

  money: {
    title: 'WYDATKI',
    glyph: '▦',
    owner: true,
    build(body) {
      body.innerHTML = '';
      const sum = el('div', 'big-num', '-- zl');
      sum.id = 'moneySum';
      const sub = el('div', 'sub', 'OSTATNIE 30 DNI');
      const cats = el('div');
      cats.id = 'moneyCats';
      cats.style.margin = '10px 0';

      const f = el('form', 'field');
      const amt = el('input', 'inp');
      amt.placeholder = 'Kwota';
      amt.inputMode = 'decimal';
      amt.style.maxWidth = '90px';
      const cat = el('input', 'inp');
      cat.placeholder = 'Kategoria';
      const b = el('button', 'btn', '+');
      b.type = 'submit';
      f.append(amt, cat, b);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!amt.value.trim()) return;
        try {
          await api('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amt.value, category: cat.value || 'inne' }),
          });
          amt.value = '';
          cat.value = '';
          loadMoney();
        } catch (err) {
          toast(err.message);
        }
      });

      // Skan paragonu - zdjecie idzie do Gemini Vision, ale wynik NIGDY
      // nie zapisuje sie sam. Kwota z OCR trafia do zwyklego formularza
      // powyzej, gdzie widac ja PRZED wyslaniem - blad odczytu (przecinek,
      // obcieta cyfra) jest wtedy widoczny, zamiast cicho wejsc do ksiegi.
      const scanRow = el('div', 'field');
      const scanBtn = el('button', 'btn', '📷 SKANUJ PARAGON');
      scanBtn.type = 'button';
      const fileInp = el('input');
      fileInp.type = 'file';
      fileInp.accept = 'image/*';
      fileInp.capture = 'environment';
      fileInp.style.display = 'none';
      scanBtn.addEventListener('click', () => fileInp.click());

      const scanResult = el('div');
      scanResult.id = 'moneyScanResult';

      fileInp.addEventListener('change', async () => {
        const file = fileInp.files?.[0];
        fileInp.value = '';
        if (!file) return;
        scanResult.innerHTML = '';
        const loading = el('div', 'hint', 'Odczytuje paragon...');
        scanResult.appendChild(loading);
        try {
          const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          const data = await api('/api/expenses/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: b64, mimeType: file.type }),
          });
          scanResult.innerHTML = '';
          if (!data.found || data.amount == null) {
            scanResult.appendChild(
              el('div', 'hint', 'Nie udalo sie odczytac kwoty z tego zdjecia - wpisz recznie powyzej.')
            );
            return;
          }
          const card = el('div', 'row');
          card.style.flexDirection = 'column';
          card.style.alignItems = 'stretch';
          card.style.gap = '6px';

          const conf = data.confidence < 0.6 ? ' (niepewne - sprawdz)' : '';
          card.appendChild(
            el(
              'div',
              'row-text',
              `${data.amount} ${data.currency}${data.merchant ? ' · ' + data.merchant : ''}${conf}`
            )
          );
          if (data.date) card.appendChild(el('div', 'row-meta', data.date));

          const actions = el('div', 'field');
          actions.style.marginBottom = '0';
          const addBtn = el('button', 'btn primary', 'DODAJ');
          addBtn.type = 'button';
          addBtn.addEventListener('click', async () => {
            try {
              await api('/api/expenses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  amount: data.amount,
                  category: data.category,
                  note: data.merchant || '',
                }),
              });
              scanResult.innerHTML = '';
              loadMoney();
            } catch (err) {
              toast(err.message);
            }
          });
          const dropBtn = el('button', 'btn', 'ODRZUC');
          dropBtn.type = 'button';
          dropBtn.addEventListener('click', () => {
            scanResult.innerHTML = '';
          });
          actions.append(addBtn, dropBtn);
          card.appendChild(actions);
          scanResult.appendChild(card);
        } catch (err) {
          scanResult.innerHTML = '';
          toast(err.message || 'Nie udalo sie odczytac paragonu.');
        }
      });

      scanRow.append(scanBtn, fileInp);

      const ul = el('ul', 'list');
      ul.id = 'moneyList';
      body.append(sum, sub, cats, f, scanRow, scanResult, ul);
      loadMoney();
    },
    refresh: () => loadMoney(),
  },

  grip: {
    title: 'STEROWANIE APLIKACJAMI',
    glyph: '✥',
    owner: true,
    build(body) {
      body.innerHTML = '';
      if (!isNativeShell()) {
        const l = el('div', 'locked');
        l.append(el('div', 'locked-mark', '✥'));
        const p = el('p');
        p.textContent = 'Sterowanie wnetrzem aplikacji dziala tylko w apce na Androida.';
        l.appendChild(p);
        body.appendChild(l);
        return;
      }
      const state = el('div', 'kv');
      state.append(el('span', null, 'USLUGA'));
      const b = el('b', null, '...');
      b.id = 'gripState';
      state.appendChild(b);

      const info = el('div', 'sub');
      info.style.margin = '10px 0';
      info.textContent =
        'Pozwala Jarvisowi wykonac: cofnij, ekran glowny, ostatnie aplikacje, powiadomienia, przewijanie oraz klikniecie przycisku po napisie. Dziala tylko na Twoje polecenie.';

      const row = el('div', 'field');
      const openBtn = el('button', 'btn primary', 'Ustawienia dostepnosci');
      openBtn.addEventListener('click', async () => {
        await window.Capacitor.Plugins.AppControl.openSettings();
        toast('Znajdz "J.A.R.V.I.S." i wlacz usluge, potem wroc.', 'ok');
      });
      const testBtn = el('button', 'btn', 'Test: wstecz');
      testBtn.addEventListener('click', () => runAppAction('wstecz'));
      row.append(openBtn, testBtn);

      body.append(state, info, row);
      refreshGrip();
    },
    refresh: () => refreshGrip(),
  },
};

// ---------- Galaktyka w tle ----------
//
// Dysk gwiazd w trzech ramionach spiralnych, ogladany pod katem (stad
// splaszczenie w pionie). Obrot jest ROZNICZKOWY - srodek krazy szybciej
// niz obrzeza, tak jak w prawdziwej galaktyce - dzieki czemu ramiona
// powoli sie zwijaja i obraz nigdy nie wyglada na zapetlony.
//
// Rysujemy w polowie klatek (co druga), bo to tylko tlo, a na slabszym
// telefonie kazda zaoszczedzona klatka idzie na plynnosc rdzenia.

const GALAXY_STARS = 340;
let galaxyRaf = null;

function startGalaxy(cv) {
  const ctx = cv.getContext('2d');
  const stars = [];

  for (let i = 0; i < GALAXY_STARS; i++) {
    // Pierwiastek zageszcza gwiazdy blizej srodka.
    const r = Math.sqrt(Math.random());
    const arm = i % 3;
    stars.push({
      r,
      ang: arm * ((Math.PI * 2) / 3) + r * 2.9 + (Math.random() - 0.5) * 0.55,
      sp: 0.16 / (0.28 + r),
      size: Math.random() * 1.4 + 0.35,
      base: 0.18 + Math.random() * 0.55,
      tw: Math.random() * Math.PI * 2,
      warm: Math.random() < 0.1,
    });
  }

  let w = 0;
  let h = 0;
  let dpr = 1;
  let t = 0;
  let frame = 0;
  // Czas liczony od zegara, nie od liczby klatek - na ekranie 120/144 Hz
  // requestAnimationFrame odpala sie 2-2.4x czesciej niz na 60 Hz, wiec
  // przyrost "na klatke" kreciłby galaktyka proporcjonalnie szybciej.
  let lastT = performance.now();

  const fit = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  };
  fit();
  window.addEventListener('resize', fit);

  const draw = () => {
    galaxyRaf = requestAnimationFrame(draw);
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    t += dt * 0.132; // = dawne "0.0022 na klatke" przy zalozeniu 60 Hz

    frame++;
    if (frame % 2) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.44;
    const R = Math.max(w, h) * 0.66;
    const flat = 0.4; // splaszczenie dysku - dysk widziany pod katem
    const lvl = store.audioLevel;

    // Mglawica - trzy plamy krazace wolniej niz gwiazdy
    for (let i = 0; i < 3; i++) {
      const a = t * 0.5 + (i * Math.PI * 2) / 3;
      const nx = cx + Math.cos(a) * R * 0.3;
      const ny = cy + Math.sin(a) * R * 0.3 * flat;
      const rad = R * (0.34 + i * 0.06);
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, rad);
      g.addColorStop(0, `rgba(34, 224, 255, ${0.05 + lvl * 0.03})`);
      g.addColorStop(1, 'rgba(34, 224, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(nx, ny, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gwiazdy
    for (const s of stars) {
      const ang = s.ang + t * s.sp * 5;
      const x = cx + Math.cos(ang) * s.r * R;
      const y = cy + Math.sin(ang) * s.r * R * flat;
      if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;

      const twinkle = 0.62 + Math.sin(t * 26 + s.tw) * 0.38;
      const a = Math.min(1, s.base * twinkle * (1 + lvl * 0.5));
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, Math.PI * 2);
      ctx.fillStyle = s.warm ? `rgba(255, 179, 71, ${a * 0.8})` : `rgba(150, 232, 255, ${a})`;
      ctx.fill();
    }
  };

  if (galaxyRaf) cancelAnimationFrame(galaxyRaf);
  draw();
}

// ---------- Wizualizacja rdzenia: holograficzny skaner ----------

// UWAGA: uchwyt animacji musi byc OSOBNY dla kazdego rdzenia. Rysujemy dwa
// (duzy na ekranie spoczynku i maly przy rozmowie), a wspolna zmienna
// sprawiala, ze drugie wywolanie anulowalo klatke pierwszego i wielki rdzen
// pozostawal pusty.

// Zamiast kuli plazmy (dawny "reaktor", kojarzacy sie ze zbroja): przejrzysty,
// obracajacy sie globus z obreczy szerokosci/dlugosci geograficznej, po
// ktorym bez przerwy przewija sie w gore i w dol pas skanujacy - jak LIDAR
// albo sonar namierzajacy obiekt. Punkty na powierzchni "zapalaja sie" w
// chwili, gdy pas je mija, pingi sonaru rozchodza sie z centrum, a radar na
// krawedzi kreci sie wlasnym rytmem - cos sie dzieje caly czas, nawet gdy
// Jarvis milczy. W samym centrum celownik namierzania, nie jadro energii.

// "let", nie "const" - celowo, zeby jedna i ta sama funkcja rysujaca
// (startCoreVisual) mogla obslugiwac wiecej niz jeden "motyw" (Jarvis -
// cyjan, E.D.I.T.H. - czerwien) bez duplikowania ~250 linii kodu canvasu.
// Kazda instancja ustawia te zmienne na poczatku WLASNEJ klatki (patrz
// theme w startCoreVisual) - bezpieczne, bo rysowanie jest synchroniczne
// i klatki roznych rdzeni nigdy sie nie przeplataja.
let SCAN_BLUE = (a) => `rgba(51, 224, 255, ${a})`;
let SCAN_ICE = (a) => `rgba(190, 240, 255, ${a})`;
let SCAN_WHITE = (a) => `rgba(255, 255, 255, ${a})`;
let WORDMARK_TEXT = 'JARVIS';

// Motywy dla startCoreVisual - na razie dwa: Jarvis (domyslny, cyjan) i
// E.D.I.T.H. (czerwien/czern, ta sama geometria - "wzorowane na Jarvisie,
// ale czerwono-czarne").
const CORE_THEMES = {
  jarvis: {
    blue: (a) => `rgba(51, 224, 255, ${a})`,
    ice: (a) => `rgba(190, 240, 255, ${a})`,
    white: (a) => `rgba(255, 255, 255, ${a})`,
    word: 'JARVIS',
  },
  edith: {
    blue: (a) => `rgba(255, 42, 42, ${a})`,
    ice: (a) => `rgba(255, 150, 140, ${a})`,
    white: (a) => `rgba(255, 225, 215, ${a})`,
    word: 'E.D.I.T.H.',
  },
};
// "const" nie wycieka do window, a public/edith.js (osobny <script>, bez
// modulow) potrzebuje tego motywu do wlasnego wywolania startCoreVisual.
window.CORE_THEMES = CORE_THEMES;

// Punkty na powierzchni kuli rozlozone rownomiernie spirala Fibonacciego
// (zadnego zageszczenia przy biegunach) - cele, ktore pas skanujacy po
// kolei "zapala". Uklad losowany RAZ przy starcie (ziarno rozne dla
// duzego/malego rdzenia), nie w kazdej klatce.
function buildScanner(seed) {
  let s = seed;
  const rnd = () => {
    // LCG - deterministyczny, zeby dwa rdzenie (duzy/maly) mialy rozne,
    // ale powtarzalne uklady bez zaleznosci od Math.random w petli klatek.
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const N = 70;
  const points = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      size: 0.009 + rnd() * 0.009,
      flash: 0,
    });
  }
  // Odczyty telemetrii wokol pierscienia - staly uklad katow, zmienna tresc.
  const READOUTS = 6;
  const readouts = [];
  for (let i = 0; i < READOUTS; i++) {
    readouts.push({ ang: (i / READOUTS) * Math.PI * 2, seed: Math.floor(rnd() * 99999) });
  }
  // Satelity namierzania - diamenciki krazace daleko poza globusem, kazdy
  // wlasnym tempem/kierunkiem - osobna, wolniejsza warstwa ruchu niz
  // skanowanie, zeby obrotu nie dalo sie "przewidziec" jednym spojrzeniem.
  const BLIPS = 3;
  const blips = [];
  for (let i = 0; i < BLIPS; i++) {
    blips.push({
      ang: rnd() * Math.PI * 2,
      speed: 0.12 + rnd() * 0.18,
      dir: rnd() < 0.5 ? 1 : -1,
      r: 1.28 + rnd() * 0.1,
      phase: rnd() * 10,
    });
  }
  return { points, readouts, blips };
}

// Obraca punkt (x,y,z znormalizowane do promienia 1) wokol osi Y (obrot
// globusu) i X (stale przechylenie, zeby bieguny nie siedzialy plasko na
// krawedzi), a potem rzuca na ekran ze slaba perspektywa - punkty blizej
// "kamery" wypadaja odrobine wieksze.
function rotateProject(p, spin, tiltX, base, cx, cy) {
  const ca = Math.cos(spin), sa = Math.sin(spin);
  const x1 = p.x * ca - p.z * sa;
  const z1 = p.x * sa + p.z * ca;
  const ct = Math.cos(tiltX), st = Math.sin(tiltX);
  const y2 = p.y * ct - z1 * st;
  const z2 = p.y * st + z1 * ct;
  const scale = 1 / (1.7 - z2 * 0.55);
  return { x: cx + x1 * base * scale, y: cy + y2 * base * scale, z: z2, scale };
}

// Jedna obrecz szerokosci geograficznej na wysokosci "y" (-1..1), na
// podanym kontekscie (glowny canvas albo bufor blomu) - uzywana zarowno dla
// statycznego szkieletu globusu, jak i dla samego (ruchliwego, podswietlonego)
// pasa skanujacego.
function latitudeRing(ctx, y, spin, tiltX, base, cx, cy, color, lw) {
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  if (rad < 0.02) return;
  const STEPS = 56;
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    const p = rotateProject({ x: Math.cos(a) * rad, y, z: Math.sin(a) * rad }, spin, tiltX, base, cx, cy);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

// Poludnik (biegun-biegun) w plaszczyznie obroconej o "off" wokol osi Y,
// zanim doliczy sie globalny obrot calego globusu.
function meridianRing(ctx, off, spin, tiltX, base, cx, cy, color, lw) {
  const STEPS = 56;
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    const p = rotateProject(
      { x: Math.sin(a) * Math.cos(off), y: Math.cos(a), z: Math.sin(a) * Math.sin(off) },
      spin, tiltX, base, cx, cy
    );
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

// Napis rysujemy litera po literze. ctx.letterSpacing jest nowe i nie
// wszedzie dziala, a odstep miedzy literami to tu polowa charakteru.
function drawWordmark(ctx, cx, cy, base, lvl) {
  const word = WORDMARK_TEXT;
  const size = base * 0.14;
  ctx.font = `600 ${size}px 'JetBrains Mono', 'SF Mono', 'Consolas', monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const gap = size * 0.32;
  const widths = [...word].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (word.length - 1);

  // Napis siedzi PONIZEJ globusu, nie na nim, z ciemnym obrysem wokol
  // kazdej litery - tak zostaje czytelny niezaleznie od tego, co akurat
  // przesuwa sie pod spodem (obreczy, punkty, pas skanujacy).
  cy = cy + base * 0.62;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = 'rgba(6, 4, 16, 0.75)';
  ctx.lineWidth = size * 0.16;
  ctx.shadowColor = SCAN_BLUE(0.9);
  ctx.shadowBlur = base * 0.08;
  ctx.fillStyle = SCAN_ICE(0.95 + lvl * 0.05);
  let x = cx - total / 2;
  for (let i = 0; i < word.length; i++) {
    ctx.strokeText(word[i], x, cy);
    ctx.fillText(word[i], x, cy);
    x += widths[i] + gap;
  }
  ctx.restore();
}

function startCoreVisual(cv, seed = 42, theme = CORE_THEMES.jarvis) {
  const ctx = cv.getContext('2d');
  const scanner = buildScanner(seed);
  let t = 0;
  let raf = null;
  let prevLvl = 0;
  // Czas liczony od zegara, nie od liczby klatek - na ekranach 120/144 Hz
  // (i w oknie Electrona, gdzie rAF bywa jeszcze mniej ograniczone) kazda
  // klatka to mniej czasu niz na 60 Hz, wiec staly przyrost "na klatke"
  // kreciłby caly rdzen proporcjonalnie szybciej niz zaprojektowano.
  let lastT = performance.now();
  // Krotkie "zaklocenie transmisji" co kilka-kilkanascie sekund - obraz
  // globusu na chwile sie rozjezdza/miga, a ramka HUD (pierscien, celownik,
  // odczyty) zostaje idealnie stabilna. To ona sprzedaje wrazenie, ze
  // ogladamy NIESTABILNY sygnal z czegos, a nie animacje, ktora po prostu
  // sie kreci.
  let nextGlitch = 2 + Math.random() * 4;
  let glitchUntil = 0;

  // Bufor poza ekranem na "jasna warstwe" (pas skanujacy, zapalone punkty) -
  // prawdziwy bloom (miekki blask, nie twarda kreska) wymaga rozmycia
  // Gaussa gotowego obrazu, nie rozmywania sceny w trakcie rysowania.
  const bloomCv = document.createElement('canvas');
  const bloomCtx = bloomCv.getContext('2d');

  const draw = () => {
    SCAN_BLUE = theme.blue;
    SCAN_ICE = theme.ice;
    SCAN_WHITE = theme.white;
    WORDMARK_TEXT = theme.word;
    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(rect.width * dpr)) {
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
    }
    if (bloomCv.width !== cv.width || bloomCv.height !== cv.height) {
      bloomCv.width = cv.width;
      bloomCv.height = cv.height;
    }
    const w = rect.width;
    const h = rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    bloomCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bloomCtx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) / 2 - 4;
    if (base <= 0) {
      raf = requestAnimationFrame(draw);
      return;
    }
    const lvl = store.audioLevel;
    const rise = Math.max(0, lvl - prevLvl);
    prevLvl = lvl;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    t += dt * 0.96; // = dawne "0.016 na klatke" przy zalozeniu 60 Hz
    const spin = t * (0.14 + lvl * 0.08);
    const tiltX = 0.46;

    // Zaklocenie: globus/pas skanujacy (nie HUD) na chwile "rozjezdza sie"
    // losowo - gx/gy to srodek UZYWANY TYLKO przez warstwe projekcji,
    // reszta (pierscien HUD, celownik, odczyty) trzyma sie cx/cy na sztywno.
    if (t > nextGlitch && t > glitchUntil) {
      glitchUntil = t + 0.1 + Math.random() * 0.1;
      nextGlitch = t + 4 + Math.random() * 6;
    }
    const glitching = t < glitchUntil;
    const gx = cx + (glitching ? (Math.random() - 0.5) * base * 0.035 : 0);
    const gy = cy + (glitching ? (Math.random() - 0.5) * base * 0.02 : 0);

    // 1. Poswiata ogolna - oddycha powoli, mocniej gdy Jarvis mowi.
    const breathe = 0.5 + Math.sin(t * 0.8) * 0.5;
    const halo = ctx.createRadialGradient(gx, gy, base * 0.1, gx, gy, base * 1.1);
    halo.addColorStop(0, SCAN_BLUE(0.07 + lvl * 0.14 + breathe * 0.02));
    halo.addColorStop(1, 'rgba(51, 224, 255, 0)');
    ctx.beginPath();
    ctx.arc(gx, gy, base * 1.1, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    // 2. Ping sonaru - pierscien co ok. 2.6s rozchodzi sie z centrum i gasnie,
    // niezalezny od reszty - gwarantuje ruch nawet w calkowitym bezruchu.
    const pingCycle = 2.6;
    const pingTau = (t % pingCycle) / pingCycle;
    ctx.beginPath();
    ctx.arc(cx, cy, base * (0.12 + pingTau * 0.95), 0, Math.PI * 2);
    ctx.strokeStyle = SCAN_BLUE((1 - pingTau) * 0.3);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 3. Szkielet globusu - rownoleznikowe obreczy + dwa poludniki + os
    // biegunowa. Przezroczyste na wylot (to hologram, nie pelna kula), wiec
    // nie trzeba usuwac "tylnej" polowki. Lekko migoce podczas zaklocenia.
    ctx.globalAlpha = glitching ? 0.55 + Math.random() * 0.45 : 1;
    [-0.6, -0.3, 0.3, 0.6].forEach((y) => latitudeRing(ctx, y, spin, tiltX, base, gx, gy, SCAN_BLUE(0.12), 1));
    latitudeRing(ctx, 0, spin, tiltX, base, gx, gy, SCAN_BLUE(0.22), 1.2);
    meridianRing(ctx, 0, spin, tiltX, base, gx, gy, SCAN_BLUE(0.1), 1);
    meridianRing(ctx, Math.PI / 2, spin, tiltX, base, gx, gy, SCAN_BLUE(0.1), 1);
    const north = rotateProject({ x: 0, y: 1, z: 0 }, spin, tiltX, base, gx, gy);
    const south = rotateProject({ x: 0, y: -1, z: 0 }, spin, tiltX, base, gx, gy);
    ctx.beginPath();
    ctx.moveTo(north.x, north.y);
    ctx.lineTo(south.x, south.y);
    ctx.strokeStyle = SCAN_BLUE(0.1);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- Od tego miejsca rysujemy na BUFORZE (bloomCtx), nie na glownym
    // canvasie - pas skanujacy i punkty, ktore ma zapalac, dostaja
    // prawdziwy, miekki blask z addytywnym mieszaniem 'lighter'.
    bloomCtx.save();
    bloomCtx.globalCompositeOperation = 'lighter';

    // 4. Pas skanujacy - przesuwa sie w gore i w dol sinusoidalnie,
    // przyspiesza, gdy Jarvis mowi. To on "skanuje" powierzchnie. Dwa
    // cienkie duchy-echa za nim (wczesniejsze pozycje) daja wrazenie ruchu
    // nawet na nieruchomym zrzucie ekranu.
    const scanSpeed = 0.5 + lvl * 0.5;
    const scanY = Math.sin(t * scanSpeed) * 0.92;
    [0.18, 0.1].forEach((dt, i) => {
      const ghostY = Math.sin((t - dt) * scanSpeed) * 0.92;
      latitudeRing(bloomCtx, ghostY, spin, tiltX, base, gx, gy, SCAN_ICE(0.12 - i * 0.04), 1.4);
    });
    latitudeRing(bloomCtx, scanY, spin, tiltX, base, gx, gy, SCAN_ICE(0.65 + lvl * 0.3), 2.4);

    // 5. Punkty na powierzchni - "zapalaja sie" na krotko, gdy pas skanujacy
    // je mija (bez listy "zywych" iskier - stan trzymany wprost na kazdym
    // punkcie, zanikajacy wykladniczo miedzy przejsciami pasa). Lekko
    // "oddychaja" (wysuwaja sie) z poziomem glosu.
    scanner.points.forEach((pt) => {
      const near = Math.max(0, 1 - Math.abs(pt.y - scanY) / 0.09);
      pt.flash = Math.max(pt.flash * 0.9, near);
      const bulge = 1 + lvl * 0.06;
      const p = rotateProject({ x: pt.x * bulge, y: pt.y * bulge, z: pt.z * bulge }, spin, tiltX, base, gx, gy);
      const r = Math.max(0.5, base * pt.size * (0.7 + pt.flash * 1.6) * p.scale);
      bloomCtx.beginPath();
      bloomCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
      bloomCtx.fillStyle = pt.flash > 0.08 ? SCAN_WHITE(0.25 + pt.flash * 0.75) : SCAN_BLUE(0.1 + lvl * 0.12);
      bloomCtx.fill();
    });

    bloomCtx.restore();

    // --- Bloom: naklejamy bufor na glowny canvas kilka razy z rosnacym
    // rozmyciem Gaussa i malejaca sila, plus ostry przebieg na wierzchu,
    // zeby struktura nie zgubila sie w samym rozmyciu. Kompozycje robimy w
    // ukladzie surowych pikseli (transform=identity), bo bloomCv juz
    // zawiera gotowy obraz w rozdzielczosci urzadzenia.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    [
      { blur: 1.5, alpha: 0.9 },
      { blur: 6, alpha: 0.5 },
      { blur: 14, alpha: 0.3 },
    ].forEach((pass) => {
      ctx.filter = `blur(${pass.blur * dpr}px)`;
      ctx.globalAlpha = pass.alpha;
      ctx.drawImage(bloomCv, 0, 0);
    });
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.drawImage(bloomCv, 0, 0);

    // Chromatyczny poblask - ten sam material nalozony z malym przesunieciem
    // i przebarwieniem w obie strony. Nie jest to prawdziwy rozdzial
    // kanalow RGB, ale na oko czyta sie jak "hologram", zwlaszcza gdy
    // przesuniecie chwilowo rosnie podczas zaklocenia.
    const fringe = (1 + (glitching ? 2.4 : 0)) * dpr;
    ctx.globalAlpha = glitching ? 0.32 : 0.12;
    ctx.filter = `blur(${1.5 * dpr}px) hue-rotate(-45deg) saturate(2)`;
    ctx.drawImage(bloomCv, -fringe, 0);
    ctx.filter = `blur(${1.5 * dpr}px) hue-rotate(45deg) saturate(2)`;
    ctx.drawImage(bloomCv, fringe, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.restore();

    // 6. Pierscien HUD z podzialka na samej krawedzi.
    const ticks = 90;
    for (let i = 0; i < ticks; i++) {
      const ang = (i / ticks) * Math.PI * 2 - spin * 0.6;
      const major = i % 6 === 0;
      const len = major ? base * 0.045 : base * 0.02;
      const r0 = base * 1.03 - len;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
      ctx.strokeStyle = SCAN_BLUE(major ? 0.4 : 0.14);
      ctx.lineWidth = major ? 1.3 : 0.8;
      ctx.stroke();
    }

    // 7. Luk radaru na krawedzi pierscienia HUD - wlasny, szybszy obrot z
    // gasnacym ogonem, niezalezny od pasa skanujacego na globusie, zeby
    // zawsze bylo widac jakis ruch, nawet gdy pas jest akurat przy biegunie.
    const sweepAng = t * 1.1;
    for (let i = 0; i < 10; i++) {
      const a0 = sweepAng - i * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, base * 1.03, a0, a0 + 0.045);
      ctx.strokeStyle = SCAN_ICE((1 - i / 10) * 0.5);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 8. Satelity namierzania - diamenciki krazace daleko poza pierscieniem
    // HUD, wlasnym, wolniejszym tempem niz globus - kolejna warstwa ruchu,
    // ktora nie daje sie "przewidziec" jednym spojrzeniem na ekran.
    scanner.blips.forEach((b) => {
      const ang = b.ang + t * b.speed * b.dir;
      const bx = cx + Math.cos(ang) * base * b.r;
      const by = cy + Math.sin(ang) * base * b.r;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + b.phase);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(ang + Math.PI / 4);
      const s = base * 0.014 * (0.8 + pulse * 0.4);
      ctx.beginPath();
      ctx.rect(-s, -s, s * 2, s * 2);
      ctx.strokeStyle = SCAN_ICE(0.25 + pulse * 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });

    // 9. Tęczówka celownika - zamiast prostego krzyza: ostrza jak przeslona
    // aparatu, ktore delikatnie "oddychaja" i rozwieraja sie z poziomem
    // glosu, plus jasny rozblysk w samym srodku przy nagłym skoku glosu
    // (poczatek wypowiedzi) - nie stale jarzace sie jadro energii.
    const openness = 0.5 + Math.sin(t * 0.7) * 0.18 + lvl * 0.35;
    const bladeR = base * (0.075 + openness * 0.045);
    const blades = 6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin * 0.25);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = SCAN_ICE(0.55 + lvl * 0.3);
    for (let i = 0; i < blades; i++) {
      const a0 = (i / blades) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, bladeR, a0, a0 + ((Math.PI * 2) / blades) * 0.58);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, bladeR * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = SCAN_BLUE(0.5 + lvl * 0.3);
    ctx.stroke();
    const flare = Math.min(1, rise * 7);
    if (flare > 0.03) {
      const burst = ctx.createRadialGradient(0, 0, 0, 0, 0, bladeR * (1.4 + flare * 1.2));
      burst.addColorStop(0, SCAN_WHITE(0.8 * flare));
      burst.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.beginPath();
      ctx.arc(0, 0, bladeR * (1.4 + flare * 1.2), 0, Math.PI * 2);
      ctx.fillStyle = burst;
      ctx.fill();
    }
    ctx.restore();

    // 10. Odczyty telemetrii plywajace wokol pierscienia - wartosc zmienia
    // sie co kawalek, zeby zawsze cos "migalo" nawet w bezruchu.
    ctx.font = `${Math.max(7, base * 0.032)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    scanner.readouts.forEach((rd) => {
      const ang = rd.ang + spin * 0.15;
      const rx = cx + Math.cos(ang) * base * 1.18;
      const ry = cy + Math.sin(ang) * base * 1.18;
      const tick = Math.floor(t * 2 + rd.seed) % 4096;
      ctx.fillStyle = SCAN_BLUE(0.3);
      ctx.fillText(tick.toString(16).padStart(3, '0').toUpperCase(), rx, ry);
    });

    // 11. Napis - zwykle mieszanie, zeby zostal czytelny.
    drawWordmark(ctx, cx, cy, base, lvl);

    store.audioLevel *= 0.92;
    raf = requestAnimationFrame(draw);
  };

  if (raf) cancelAnimationFrame(raf);
  draw();
}

function setCoreState(text) {
  for (const id of ['#coreState', '#sideState']) {
    const n = $(id);
    if (n) n.textContent = text;
  }
  setState(text);
}

// ---------- Dane paneli ----------

async function refreshLink() {
  const roleEl = $('#linkRole');
  if (roleEl) {
    roleEl.textContent = isOwner() ? 'MILOSZ' : 'GOSC';
    roleEl.classList.toggle('good', isOwner());
  }
  const net = $('#linkNet');
  if (net) net.textContent = navigator.onLine ? 'AKTYWNE' : 'BRAK';

  if (navigator.getBattery) {
    try {
      const b = await navigator.getBattery();
      const n = $('#linkBattery');
      if (n) n.textContent = `${Math.round(b.level * 100)}%`;
    } catch {
      /* brak API baterii */
    }
  }
  if (navigator.storage?.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const n = $('#linkStorage');
      if (n && quota) n.textContent = `${(usage / 1e9).toFixed(1)}/${(quota / 1e9).toFixed(0)} GB`;
    } catch {
      /* brak API pamieci */
    }
  }
}

function tickClock() {
  const now = new Date();
  const hh = now.toLocaleTimeString('pl-PL', { hour12: false });
  const hm = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

  const idleClock = $('#idleClock');
  if (idleClock) idleClock.textContent = hm;
  const idleDate = $('#idleDate');
  if (idleDate) {
    idleDate.textContent = now
      .toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })
      .toUpperCase();
  }
  // Zegar w module Pulpit (budowany przez PANEL_DEFS.clock).
  const t = $('#clkTime');
  if (t) t.textContent = hh;
  const d = $('#clkDate');
  if (d) d.textContent = now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
}
setInterval(tickClock, 1000);

const WX_TEXT = {
  0: 'bezchmurnie', 1: 'przewaznie slonecznie', 2: 'czesciowe zachmurzenie', 3: 'pochmurno',
  45: 'mgla', 48: 'mgla', 51: 'mzawka', 53: 'mzawka', 55: 'mzawka',
  61: 'deszcz', 63: 'deszcz', 65: 'silny deszcz', 66: 'marznacy deszcz', 67: 'marznacy deszcz',
  71: 'snieg', 73: 'snieg', 75: 'silny snieg', 77: 'snieg',
  80: 'przelotny deszcz', 81: 'przelotny deszcz', 82: 'ulewa', 85: 'przelotny snieg', 86: 'silny snieg',
  95: 'burza', 96: 'burza z gradem', 99: 'silna burza',
};
const DAY_SHORT = ['ND', 'PN', 'WT', 'SR', 'CZ', 'PT', 'SB'];

async function fetchWeather(lat, lon, label) {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max&forecast_days=4&timezone=auto`
    );
    const data = await res.json();
    const t = $('#wxTemp');
    const d = $('#wxDesc');
    const p = $('#wxPlace');
    const days = $('#wxDays');
    if (t) t.textContent = `${Math.round(data.current.temperature_2m)}°`;
    if (d) d.textContent = (WX_TEXT[data.current.weather_code] || '').toUpperCase();
    if (p) p.textContent = label;
    if (days && data.daily?.time) {
      days.innerHTML = '';
      data.daily.time.forEach((date, i) => {
        if (i === 0) return;
        const row = el('div', 'kv');
        row.append(el('span', null, DAY_SHORT[new Date(date).getDay()]));
        row.append(el('b', null, `${Math.round(data.daily.temperature_2m_max[i])}°`));
        days.appendChild(row);
      });
    }
  } catch {
    const d = $('#wxDesc');
    if (d) d.textContent = 'BRAK DANYCH';
  }
}

function loadWeather() {
  if (store.location) return fetchWeather(store.location.lat, store.location.lon, 'TWOJA POZYCJA');
  if (!navigator.geolocation) return fetchWeather(52.23, 21.01, 'WARSZAWA');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      store.location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      fetchWeather(pos.coords.latitude, pos.coords.longitude, 'TWOJA POZYCJA');
    },
    () => fetchWeather(52.23, 21.01, 'WARSZAWA'),
    { timeout: 8000 }
  );
}

function drawTasks(todos) {
  const ul = $('#taskList');
  if (!ul) return;
  ul.innerHTML = '';
  if (!todos.length) {
    ul.appendChild(el('li', 'hint', 'Brak zadan.'));
    return;
  }
  todos.forEach((t) => {
    const li = el('li', `row ${t.done ? 'done' : ''}`);
    const c = el('input', 'row-check');
    c.type = 'checkbox';
    c.checked = t.done;
    c.addEventListener('change', async () => {
      try {
        const { todos: next } = await api(`/api/todos/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done: c.checked }),
        });
        drawTasks(next);
      } catch (err) {
        toast(err.message);
      }
    });
    const x = el('button', 'row-x', '×');
    x.addEventListener('click', async () => {
      try {
        const { todos: next } = await api(`/api/todos/${t.id}`, { method: 'DELETE' });
        drawTasks(next);
      } catch (err) {
        toast(err.message);
      }
    });
    li.append(c, el('span', 'row-text', t.text), x);
    ul.appendChild(li);
  });
}

async function loadTasks() {
  if (!isOwner() || !panelLive('tasks')) return;
  try {
    const { todos } = await api('/api/todos');
    drawTasks(todos);
  } catch {
    /* brak uprawnien albo brak sieci */
  }
}

function drawAlerts(reminders) {
  const ul = $('#alertList');
  if (!ul) return;
  ul.innerHTML = '';
  const pending = reminders.filter((r) => !r.sent);
  if (!pending.length) {
    ul.appendChild(el('li', 'hint', 'Brak przypomnien.'));
    return;
  }
  pending.forEach((r) => {
    const li = el('li', 'row');
    const when = new Date(r.dueAt).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const x = el('button', 'row-x', '×');
    x.addEventListener('click', async () => {
      try {
        const { reminders: next } = await api(`/api/reminders/${r.id}`, { method: 'DELETE' });
        drawAlerts(next);
      } catch (err) {
        toast(err.message);
      }
    });
    li.append(el('span', 'row-text', r.text), el('span', 'row-meta', when), x);
    ul.appendChild(li);
  });
}

async function loadAlerts() {
  if (!isOwner() || !panelLive('alerts')) return;
  try {
    const { reminders } = await api('/api/reminders');
    drawAlerts(reminders);
  } catch {
    /* brak uprawnien albo brak sieci */
  }
}

async function loadMind() {
  if (!isOwner() || !panelLive('mind')) return;
  const ul = $('#mindList');
  if (!ul) return;
  try {
    const { facts } = await api('/api/memory');
    ul.innerHTML = '';
    if (!facts.length) {
      ul.appendChild(el('li', 'hint', 'Nic jeszcze nie zapamietano.'));
      return;
    }
    facts.forEach((f, i) => {
      const li = el('li', 'row');
      const x = el('button', 'row-x', '×');
      x.addEventListener('click', async () => {
        try {
          await api(`/api/memory/${i}`, { method: 'DELETE' });
          loadMind();
        } catch (err) {
          toast(err.message);
        }
      });
      li.append(el('span', 'row-text', f), x);
      ul.appendChild(li);
    });
  } catch {
    /* brak uprawnien */
  }
}

function refreshOwnerPanes() {
  api('/api/memory')
    .then(({ facts }) => {
      store.factCount = (facts || []).length;
      refreshHeadStats();
    })
    .catch(() => {});
  loadMoney();
  loadTasks();
  loadAlerts();
  loadPerimeter();
  loadMachines();
  loadSentinel();
  loadMind();
  refreshLink();
}

// ---------- Dymek / praca w tle ----------

async function refreshBubble() {
  if (!isNativeShell() || !window.Capacitor.Plugins.Bubble) return;
  const stateEl = $('#bubbleState');
  const permEl = $('#bubblePerm');
  const toggle = $('#bubbleToggle');
  const permBtn = $('#bubblePermBtn');
  if (!stateEl) return;
  try {
    const s = await window.Capacitor.Plugins.Bubble.status();
    stateEl.textContent = s.running ? 'AKTYWNY' : 'WYLACZONY';
    stateEl.classList.toggle('good', Boolean(s.running));
    permEl.textContent = s.hasPermission ? 'PRZYZNANA' : 'BRAK';
    permEl.classList.toggle('good', Boolean(s.hasPermission));
    if (toggle) {
      toggle.textContent = s.running ? 'Wylacz' : 'Wlacz';
      toggle.disabled = !s.hasPermission;
    }
    if (permBtn) permBtn.style.display = s.hasPermission ? 'none' : '';
  } catch {
    stateEl.textContent = 'BLAD';
  }
}

// Online = agent przyslal heartbeat albo klatke w ciagu ostatnich 6 minut
// (patrz server/cameras.js#cameraStatuses). Zadnych kamer na liscie nie
// znaczy blad - znaczy, ze agent na laptopie jeszcze sie nie odezwal.
// Pasek obciazenia robi wieksze wrazenie niz sama liczba i od razu widac
// kolorem, ktora wartosc wchodzi w strefe alarmowa.
function meterRow(label, pct, extra) {
  const wrap = el('div');
  wrap.style.marginBottom = '10px';
  const top = el('div', 'kv');
  top.append(el('span', null, label), el('b', null, extra ? `${pct}%  ${extra}` : `${pct}%`));
  const bar = el('div');
  bar.style.cssText = 'height:4px; background:#0e1a27; border-radius:2px; overflow:hidden; margin-top:4px';
  const fill = el('div');
  const color = pct > 90 ? 'var(--red)' : pct > 75 ? 'var(--amber)' : 'var(--blue)';
  fill.style.cssText = `height:100%; width:${Math.max(0, Math.min(100, pct))}%; background:${color}; transition:width .4s`;
  bar.appendChild(fill);
  wrap.append(top, bar);
  return wrap;
}

// Odpytywanie chodzi tylko wtedy, gdy modul Maszyna jest naprawde na
// ekranie: karta w tle albo inna zakladka nie ma po co obciazac lacza.
let machineTimer = null;

function startMachinePolling() {
  clearInterval(machineTimer);
  machineTimer = setInterval(() => {
    const visible =
      panelLive('machine') &&
      isWindowOpen('machine') &&
      opsVisible() &&
      document.visibilityState === 'visible';
    if (visible) loadMachines();
  }, 5000);
}

async function loadMachines() {
  if (!isOwner() || !panelLive('machine')) return;
  try {
    const { machines } = await api('/api/telemetry');
    const box = $('#machineBox');
    if (!box) return;
    box.innerHTML = '';
    if (!machines.length) {
      box.appendChild(
        el('div', 'hint', 'Brak odczytow. Uruchom home-server/system-monitor.js na laptopie.')
      );
      return;
    }
    machines.forEach((m) => {
      const card = el('div');
      card.style.cssText = 'border:1px solid var(--line); border-radius:3px; padding:11px; margin-bottom:10px';
      const head = el('div', 'kv');
      const dot = el('span', null, `${m.online ? '●' : '○'} ${m.machine}`);
      dot.style.color = m.online ? 'var(--good)' : 'var(--red)';
      head.append(dot, el('b', null, m.online ? `sprzed ${m.ageSec}s` : 'brak lacznosci'));
      card.appendChild(head);
      card.appendChild(meterRow('PROCESOR', m.cpu));
      card.appendChild(meterRow('PAMIEC', m.ramUsedPct, m.ramTotalMb ? `${Math.round(m.ramTotalMb / 1024)} GB` : ''));
      if (m.diskUsedPct != null) card.appendChild(meterRow('DYSK', m.diskUsedPct));

      if (m.top?.length) {
        const cap = el('div', 'sub', 'NAJWIECEJ PAMIECI');
        cap.style.margin = '8px 0 4px';
        card.appendChild(cap);
        [...m.top]
          .sort((a, b) => (b.memMb || 0) - (a.memMb || 0))
          .slice(0, 3)
          .forEach((p) => {
            const r = el('div', 'kv');
            r.append(el('span', null, `${p.name} (${p.pid})`), el('b', null, `${Math.round(p.memMb)} MB`));
            card.appendChild(r);
          });
      }
      box.appendChild(card);
    });
  } catch {
    /* brak uprawnien albo brak sieci */
  }
}

function fmtAgo(ts) {
  if (!ts) return 'nigdy';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s temu`;
  if (s < 3600) return `${Math.round(s / 60)}min temu`;
  if (s < 86400) return `${Math.round(s / 3600)}h temu`;
  return `${Math.round(s / 86400)}d temu`;
}

async function loadSentinel() {
  if (!isOwner() || !panelLive('sentinel')) return;
  try {
    const { topics } = await api('/api/sentinel');
    const box = $('#sentinelList');
    if (!box) return;
    box.innerHTML = '';

    if (!topics.length) {
      box.appendChild(el('div', 'hint', 'Brak sledzonych tematow. Dodaj jeden powyzej albo popros Jarvisa glosem.'));
      return;
    }

    topics.forEach((t) => {
      const card = el('div');
      card.style.cssText = 'border:1px solid var(--line); border-radius:3px; padding:11px; margin-bottom:9px';

      const head = el('div', 'kv');
      const label = el('span', null, t.query);
      if (t.paused) label.style.opacity = '.5';
      const badge = el(
        'b',
        null,
        !t.lastCheckedAt ? 'CZEKA NA PIERWSZE SPRAWDZENIE' : t.findings ? `${t.findings} ZNALEZISK` : 'BEZ NOWOSCI'
      );
      head.append(label, badge);
      card.appendChild(head);

      const sub = el('div', 'sub');
      sub.style.margin = '4px 0 8px';
      sub.textContent = `sprawdzone: ${fmtAgo(t.lastCheckedAt)}${t.lastFindingAt ? ` · ostatnie znalezisko: ${fmtAgo(t.lastFindingAt)}` : ''}`;
      card.appendChild(sub);

      const findBox = el('div');
      findBox.id = `sentinelFind-${t.id}`;
      card.appendChild(findBox);

      const row = el('div', 'field');
      row.style.marginTop = '8px';
      row.style.marginBottom = '0';

      const showBtn = el('button', 'btn', t.findings ? 'POKAZ ZNALEZISKA' : 'BRAK ZNALEZISK');
      showBtn.disabled = !t.findings;
      showBtn.addEventListener('click', async () => {
        const { findings } = await api(`/api/sentinel/${t.id}/findings`);
        findBox.innerHTML = '';
        findings.forEach((f) => {
          const item = el('div', 'row');
          item.style.flexDirection = 'column';
          item.style.alignItems = 'flex-start';
          item.style.gap = '4px';
          const when = el('div', 'row-meta', fmtAgo(f.at));
          const txt = el('div', 'row-text', f.summary);
          item.append(when, txt);
          (f.sources || []).forEach((s) => {
            const a = el('a', null, s.title || s.url);
            a.href = s.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.style.cssText = 'display:block; font-size:11px; color:var(--ice)';
            item.appendChild(a);
          });
          findBox.appendChild(item);
        });
      });

      const pauseBtn = el('button', 'btn', t.paused ? 'WZNOW' : 'WSTRZYMAJ');
      pauseBtn.addEventListener('click', async () => {
        await api(`/api/sentinel/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paused: !t.paused }),
        });
        loadSentinel();
      });

      const delBtn = el('button', 'btn', 'USUN');
      delBtn.addEventListener('click', async () => {
        await api(`/api/sentinel/${t.id}`, { method: 'DELETE' });
        loadSentinel();
      });

      row.append(showBtn, pauseBtn, delBtn);
      card.appendChild(row);
      box.appendChild(card);
    });
  } catch {
    /* brak uprawnien albo brak sieci */
  }
}

async function loadPerimeter() {
  if (!isOwner() || !panelLive('perimeter')) return;
  try {
    const { cameras } = await api('/api/cameras');
    const ul = $('#perimeterList');
    if (!ul) return;
    ul.innerHTML = '';
    if (!cameras.length) {
      ul.appendChild(
        el('li', 'hint', 'Brak polaczonych kamer. Skonfiguruj i uruchom home-server/camera-watcher.js na laptopie.')
      );
      return;
    }
    cameras.forEach((c) => {
      const li = el('li', 'row');
      const dot = el('span', null, c.online ? '●' : '○');
      dot.style.color = c.online ? 'var(--good)' : 'var(--red)';
      const txt = el('span', 'row-text', c.camera);
      const meta = el('span', 'row-meta', c.online ? 'aktywna' : `cisza ${Math.round(c.lastSeenMs / 1000)}s`);
      li.append(dot, txt, meta);
      ul.appendChild(li);
    });
  } catch {
    /* brak uprawnien albo brak sieci - panel zostaje jak byl */
  }
}

async function loadMoney() {
  if (!isOwner() || !panelLive('money')) return;
  try {
    const { expenses, summary } = await api('/api/expenses');
    const sum = $('#moneySum');
    const cats = $('#moneyCats');
    const ul = $('#moneyList');
    if (sum) sum.textContent = `${summary.total.toFixed(2)} zl`;

    if (cats) {
      cats.innerHTML = '';
      const top = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (!top.length) cats.appendChild(el('div', 'sub', 'Brak wydatkow.'));
      top.forEach(([name, value]) => {
        const r = el('div', 'kv');
        r.append(el('span', null, name.toUpperCase()));
        r.append(el('b', null, `${value.toFixed(2)} zl`));
        cats.appendChild(r);
      });
    }

    if (ul) {
      ul.innerHTML = '';
      // Najnowsze na gorze, ograniczamy liste zeby panel byl czytelny.
      [...expenses].reverse().slice(0, 12).forEach((e) => {
        const li = el('li', 'row');
        const when = new Date(e.ts).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
        const x = el('button', 'row-x', '×');
        x.addEventListener('click', async () => {
          try {
            await api(`/api/expenses/${e.id}`, { method: 'DELETE' });
            loadMoney();
          } catch (err) {
            toast(err.message);
          }
        });
        li.append(
          el('span', 'row-text', `${e.amount.toFixed(2)} zl - ${e.category}`),
          el('span', 'row-meta', when),
          x
        );
        ul.appendChild(li);
      });
    }
  } catch {
    /* brak uprawnien albo brak sieci */
  }
}

async function refreshGrip() {
  if (!isNativeShell() || !window.Capacitor.Plugins.AppControl) return;
  const stateEl = $('#gripState');
  if (!stateEl) return;
  try {
    const s = await window.Capacitor.Plugins.AppControl.status();
    stateEl.textContent = s.enabled ? 'WLACZONA' : 'WYLACZONA';
    stateEl.classList.toggle('good', Boolean(s.enabled));
  } catch {
    stateEl.textContent = 'BLAD';
  }
}

// ---------- Wyszukiwanie ----------

let lastSearch = null;

function drawHits(query, results) {
  const q = $('#findQuery');
  const box = $('#findHits');
  if (!box) return;
  if (q) q.textContent = `ZAPYTANIE: ${query}`;
  box.innerHTML = '';
  if (!results.length) {
    box.appendChild(el('div', 'hint', 'Brak wynikow.'));
    return;
  }
  // Tresc pochodzi z obcych stron - budujemy wezly, nie wstrzykujemy HTML.
  results.forEach((r) => {
    const card = el('div', 'hit');
    const safe = /^https?:\/\//i.test(r.url || '');
    const title = el(safe ? 'a' : 'div', null, r.title || '');
    if (safe) {
      title.href = r.url;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
    }
    const host = el('div', 'host');
    try {
      host.textContent = new URL(r.url).hostname;
    } catch {
      host.textContent = r.url || '';
    }
    card.append(title, host, el('div', 'snip', r.snippet || ''));
    box.appendChild(card);
  });
}

function showSearch(query, results) {
  lastSearch = { query, results };
  enterOps('find');
  drawHits(query, results);
}

// ---------- Kamera ----------

let camStream = null;
let camTimer = null;
const camCanvas = document.createElement('canvas');

async function camOn() {
  if (camStream || !isOwner()) return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 } } });
  } catch {
    toast('Brak dostepu do kamery.');
    return;
  }
  enterOps('eye');
  const v = $('#camFeed');
  const note = $('#camNote');
  if (v) {
    v.srcObject = camStream;
    v.style.display = 'block';
  }
  if (note) note.style.display = 'none';

  const ctx = camCanvas.getContext('2d');
  let busy = false;
  camTimer = setInterval(() => {
    if (busy || !store.live || !liveWs || liveWs.readyState !== WebSocket.OPEN) return;
    const vid = $('#camFeed');
    if (!vid || !vid.videoWidth) return;
    const w = Math.min(360, vid.videoWidth);
    const h = Math.round(w * (vid.videoHeight / vid.videoWidth));
    camCanvas.width = w;
    camCanvas.height = h;
    ctx.drawImage(vid, 0, 0, w, h);
    busy = true;
    camCanvas.toBlob(
      (blob) => {
        busy = false;
        if (!blob || !liveWs || liveWs.readyState !== WebSocket.OPEN) return;
        blob.arrayBuffer().then((buf) => {
          liveWs.send(JSON.stringify({ type: 'video', data: bufToB64(buf) }));
        });
      },
      'image/jpeg',
      0.5
    );
  }, 1500);
}

function camOff() {
  if (camTimer) {
    clearInterval(camTimer);
    camTimer = null;
  }
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
  const v = $('#camFeed');
  const note = $('#camNote');
  if (v) {
    v.srcObject = null;
    v.style.display = 'none';
  }
  if (note) note.style.display = 'block';
}

// Kamera CELOWO nie gasnie przy zmianie zakladki - podglad leci dalej do
// rozmowy na zywo. Wylacza ja dopiero Jarvis (wylacz_kamere) albo
// wylogowanie.

// ---------- Sterowanie urzadzeniem ----------

function isNativeShell() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

// Tryb to tylko nazwana kolejnosc krokow steruj_urzadzeniem - wykonujemy je
// PO KOLEI (nie Promise.all) z krotka przerwa miedzy nimi, bo niektore akcje
// (np. otworz-aplikacje -> potem klawisz medialny) potrzebuja chwili, zeby
// druga strona zdazyla zareagowac, zanim przyjdzie kolejny krok.
async function runRoutineSteps(steps) {
  for (const step of steps || []) {
    if (step?.akcja) await runDeviceAction(step.akcja);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// E.D.I.T.H. moze odmowic wykonania od razu i zazadac wyraznego "tak" -
// patrz desktop/edithPolicy.js (zasilanie, zabicie procesu, wylaczenie
// sieci). Trzymamy TYLKO JEDNO oczekujace potwierdzenie naraz i wygasza
// je po minucie - zle usłyszane/zapomniane "tak" po dluzszej chwili nie
// ma uruchamiac czegos, o czym uzytkownik juz dawno przestal myslec.
let pendingConfirm = null;

function askConfirm(name, params, warning) {
  pendingConfirm = { name, params, warning, at: Date.now() };
  // W rozmowie na zywo samo powiedzenie "tak" NIE dotrze tutaj (ten kanal
  // nie sluchamy - mowi o tym Gemini Live), dlatego prosba zawsze kieruje
  // do czatu pisanego - to jedyny kanal, ktory realnie to potwierdzenie
  // odbiera i wykonuje.
  const msg = `E.D.I.T.H.: ${warning || 'Ta operacja wymaga potwierdzenia.'} Napisz „tak" w czacie, zeby to wykonac.`;
  pushSaid('jv', msg);
  // speak() dziala niezaleznie od trybu (czat pisany czy rozmowa na zywo) -
  // bez tego w rozmowie glosowej prosba o potwierdzenie byla widoczna
  // tylko na ekranie, a uzytkownik jej nie slyszal.
  speak(msg);
  setCoreState('POTWIERDZ');
}

// Wolana z obslugi wiadomosci (czat pisany i glos) ZANIM tekst trafi do
// zwyklej rozmowy z Jarvisem - odpowiedz na oczekujace potwierdzenie nie
// powinna isc do modelu jako nowe pytanie. Zwraca true, gdy przejela tekst.
function tryConsumeConfirmation(text) {
  if (!pendingConfirm) return false;
  if (Date.now() - pendingConfirm.at > 60000) {
    pendingConfirm = null;
    return false;
  }
  const norm = deaccent(String(text || '').trim());
  const { name, params } = pendingConfirm;
  if (/^(tak|potwierdzam|rob to|zrob to|wykonaj|ok|zgoda)\b/.test(norm)) {
    pendingConfirm = null;
    runDeviceAction(name, params, { confirmedByEdith: true });
    return true;
  }
  if (/^(nie|anuluj|stop|przerwij)\b/.test(norm)) {
    pendingConfirm = null;
    pushSaid('jv', 'Dobrze, nie robię tego.');
    setCoreState('GOTOWY');
    return true;
  }
  return false;
}

// Jedna wypowiedz Jarvisa potrafi zlecic kilka krokow pod rzad (np. "otworz
// przegladarke i wpisz X") - kazdy tag/wywolanie narzedzia odpala
// runDeviceAction, gdy tylko zostanie sparsowany/odebrany, WIEC BEZ KOLEJKI
// dwa takie kroki leca niemal jednoczesnie. "Wpisz tekst" docierajace, zanim
// przegladarka zdazyla choc sie otworzyc i zlapac fokus, po prostu znika w
// nic - to byl powod "w przegladarce nie moge nic wpisac". runRoutineSteps
// (tryby) mialo wlasna przerwe 500ms miedzy krokami od dawna - teraz KAZDE
// wywolanie runDeviceAction czeka w tej samej, jednej kolejce.
let actionChain = Promise.resolve();

function runDeviceAction(name, params, options) {
  const run = () => runDeviceActionNow(name, params, options);
  actionChain = actionChain.then(run, run);
  return actionChain;
}

async function runDeviceActionNow(name, params, options) {
  if (!isOwner()) {
    toast('Sterowanie urzadzeniem wymaga zalogowania.');
    return;
  }
  // "wlacz-edith"/"wlacz-jarvis" sa czysto klienckie (przelaczaja widok),
  // nie maja odpowiednika w desktop/actions.js - obsluzone od razu, bez
  // wysylania do aplikacji desktopowej/mobilnej.
  //
  // KLUCZOWE: samo pokazanie panelu Edith NIE wystarczy - jesli trwa
  // rozmowa glosowa z Jarvisem (albo cokolwiek pozniej ja wznowi, patrz
  // wakeword w liveStart), uzytkownik dalej slyszy/rozmawia z Jarvisem
  // mimo czerwonego ekranu. To byl powod, dla ktorego "Edith" brzmiala
  // jak Jarvis mowiacy "sir" - panel sie przelaczal, ale glos nie.
  // Trzeba WYLACZYC sesje Jarvisa (i jego checa wznawiania), zanim Edith
  // przejmie rozmowe.
  if (name === 'wlacz-edith') {
    store.wantLive = false;
    liveStop();
    window.Edith?.open();
    return;
  }
  if (name === 'wlacz-jarvis') {
    window.Edith?.close();
    store.wantLive = true;
    liveStart();
    return;
  }
  try {
    if (window.jarvisDesktop) {
      const r = await window.jarvisDesktop.runAction(name, params, options);
      if (r?.requiresEdithConfirmation) {
        askConfirm(name, params, r.warning || r.reason);
        return;
      }
      if (r?.blocked) {
        toast(`Zablokowane przez E.D.I.T.H.: ${r.edithReason || ''}`);
        return;
      }
      if (!r?.ok) toast(`Nie udalo sie: ${name}`);
      // Krotkie odczekanie PO kazdej akcji (nie tylko udanej - nawet
      // nieudana proba otwarcia zajela chwile) - zanim kolejka przepusci
      // nastepny krok. To ta sama logika co runRoutineSteps, tylko dla
      // WSZYSTKICH wywolan runDeviceAction, nie tylko zapisanych trybow.
      await new Promise((res) => setTimeout(res, 600));
      return;
    }
    if (isNativeShell() && window.Capacitor.Plugins.DeviceControl) {
      const r = await window.Capacitor.Plugins.DeviceControl.runAction({ name, ...params });
      if (!r?.ok) toast(`Nie udalo sie: ${name}`);
      await new Promise((res) => setTimeout(res, 600));
      return;
    }
    toast('Sterowanie dziala w aplikacji desktopowej lub mobilnej.', 'ok');
  } catch {
    toast(`Nie udalo sie: ${name}`);
  }
}

// Sterowanie wnetrzem aplikacji - wylacznie w apce na Androida, przez
// usluge dostepnosci, ktora uzytkownik musi wlaczyc recznie.
async function runAppAction(action, text) {
  if (!isOwner()) {
    toast('Sterowanie aplikacjami wymaga zalogowania.');
    return;
  }
  if (!isNativeShell() || !window.Capacitor.Plugins.AppControl) {
    toast('Sterowanie aplikacjami dziala tylko w apce na Androida.', 'ok');
    return;
  }
  try {
    const r = await window.Capacitor.Plugins.AppControl.run({ action, text: text || '' });
    if (!r?.ok) toast(`Nie udalo sie wykonac: ${action}${text ? ` "${text}"` : ''}`);
  } catch (err) {
    toast(err.message || 'Usluga dostepnosci jest wylaczona.');
  }
}

// Operacje na plikach wykonuje aplikacja desktopowa (tylko ona ma dostep
// do dysku) i odsyla wynik serwerowi, ktory przekazuje go modelowi.
async function handleFileAction(msg) {
  const reply = (data) => {
    if (liveWs && liveWs.readyState === WebSocket.OPEN) {
      liveWs.send(JSON.stringify({ type: 'response', requestId: msg.requestId, data }));
    }
  };

  if (!isOwner()) return reply({ ok: false, error: 'brak uprawnien' });
  if (!window.jarvisDesktop) {
    return reply({ ok: false, error: 'pliki dzialaja tylko w aplikacji desktopowej na komputerze' });
  }

  try {
    const result = await window.jarvisDesktop.runAction(msg.action, {
      nazwa: msg.nazwa,
      tresc: msg.tresc,
    });
    if (result?.ok && msg.action === 'zapisz-plik') toast(`Zapisano: ${msg.nazwa}`, 'ok');
    reply(result);
  } catch (err) {
    reply({ ok: false, error: err.message || 'blad zapisu' });
  }
}

// ---------- Transkrypcja rozmowy ----------

// Licznik trzymany osobno, zeby NIE liczyc calej listy przy kazdej
// wiadomosci (feed.querySelectorAll('.said').length na tysiacach wezlow
// w wielogodzinnej rozmowie to powtarzane przejscie po calym DOM - jedno
// z tego, co spowalnia appke az do wrazenia "przestala odpowiadac" po
// dluzszej sesji).
let feedCount = 0;

// Sam feed tez ma twardy sufit - bez niego DOM rosnie bez konca przez
// cala dlugosc rozmowy na zywo (repliki lecą bez przerwy). Usuwamy
// najstarsze wpisy zamiast pozwolic liscie rosnac w nieskonczonosc.
const FEED_MAX = 300;

function pushSaid(who, text) {
  // Pusty string to CELOWE wywolanie z sendTyped - placeholder do wypelnienia
  // strumieniem odpowiedzi. Odsiewamy tylko brak tekstu (null/undefined), nie
  // pusty string - inaczej placeholder nigdy nie powstaje i caly czat pisany
  // wywala sie w momencie pierwszego dopisania fragmentu do (nieistniejacego) node.
  if (text == null) return;
  // Tylko budujemy czat, NIE otwieramy go. Rozmowa na zywo sypie replikami
  // bez przerwy - wymuszanie widoku odbieraloby mozliwosc ogladania rdzenia.

  const feed = $('#talkFeed');
  if (!feed) return;
  const d = el('div', `said ${who === 'me' ? 'me' : 'jv'}`);
  d.appendChild(el('span', 'who', who === 'me' ? 'TY' : 'JARVIS'));
  d.appendChild(document.createTextNode(text));
  feed.appendChild(d);
  feedCount++;
  while (feedCount > FEED_MAX && feed.firstChild) {
    feed.removeChild(feed.firstChild);
    feedCount--;
  }
  const count = $('#sideCount');
  if (count) count.textContent = String(feedCount);
  feed.scrollTop = feed.scrollHeight;
  return d;
}

// ---------- Czat pisany ----------

const IMG_RE = /\[\[IMG:([^\]]+)\]\]/;
const ACT_RE = /\[AKCJA:\s*([^\]]+)\]/g;
const TRYB_RE = /\[TRYB:\s*([^\]]+)\]/g;
// [POLECENIE: komenda] - jedyny "wentyl bezpieczenstwa" dla wszystkiego,
// czego nie ma na liscie nazwanych akcji (patrz prompt w server/core/
// jarvis.js). Serwer celowo zostawia go zywcem w strumieniu - do teraz
// jednak nic po stronie klienta go nie czytalo, wiec caly ten mechanizm
// (a z nim "Jarvis moze zrobic wszystko, Edith to sprawdza") byl martwy:
// tag po prostu wyswietlal sie i byl czytany na glos jako tekst.
const CMD_RE = /\[POLECENIE:\s*([^\]]+)\]/g;

function stripActionTags(text) {
  return text.replace(ACT_RE, '').replace(TRYB_RE, '').replace(CMD_RE, '').replace(IMG_RE, '').replace(CAD_RE, '');
}

// [AKCJA: nazwa] sam w sobie nie moze niczego przekazac - np.
// "otworz-aplikacje" bez nazwy programu konczy sie bledem "Nie podano
// nazwy aplikacji", bo runAction dostaje puste parametry. Parametr
// dolaczamy po "|" - [AKCJA: otworz-aplikacje | notepad] - i tu
// tlumaczymy go na ksztalt, jakiego oczekuje kazda konkretna akcja
// (patrz desktop/actions.js). Patrz tez prompt w server/core/jarvis.js,
// ktory uczy model dokladnie tej skladni.
function paramsForAction(name, raw) {
  if (!raw) return undefined;
  if (name === 'otworz-aplikacje' || name === 'zamknij-proces') return { nazwa: raw };
  if (name === 'przelacz-okno') return { tytul: raw };
  if (name === 'pisz-tekst') return { tekst: raw };
  if (name === 'kliknij-na-ekranie') {
    const [x, y] = raw.split(',').map((n) => Number(n.trim()));
    return { x, y };
  }
  return undefined;
}

async function sendTyped(text) {
  window.SFX?.play('send');
  pushSaid('me', text);
  if (tryConsumeConfirmation(text)) return;
  setCoreState('MYSLE');
  const node = pushSaid('jv', '');
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: text, location: store.location }),
    });
    if (!res.ok) throw new Error(`Blad ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = '';
    const done = new Set();
    for (;;) {
      const { done: fin, value } = await reader.read();
      if (fin) break;
      full += dec.decode(value, { stream: true });
      for (const m of full.matchAll(ACT_RE)) {
        if (!done.has(m[1])) {
          done.add(m[1]);
          const [rawName, rawParam] = m[1].split('|').map((s) => s.trim());
          runDeviceAction(rawName, paramsForAction(rawName, rawParam));
        }
      }
      for (const m of full.matchAll(TRYB_RE)) {
        const key = `tryb:${m[1]}`;
        if (!done.has(key)) {
          done.add(key);
          api(`/api/routines/${encodeURIComponent(m[1].trim())}`)
            .then((r) => runRoutineSteps(r.steps))
            .catch(() => toast(`Nie znam trybu: ${m[1].trim()}`));
        }
      }
      for (const m of full.matchAll(CMD_RE)) {
        const key = `cmd:${m[1]}`;
        if (!done.has(key)) {
          done.add(key);
          runDeviceAction('polecenie', { tresc: m[1].trim() });
        }
      }
      node.textContent = '';
      node.appendChild(el('span', 'who', 'JARVIS'));
      node.appendChild(document.createTextNode(stripActionTags(full)));
      $('#talkFeed').scrollTop = $('#talkFeed').scrollHeight;
    }
    const cadHit = full.match(CAD_RE);
    if (cadHit && !done.has(cadHit[1])) {
      // Marker pojawia sie raz, ale strumien czytamy kawalkami - bez tego
      // straznika model pobieralby sie przy kazdym kolejnym fragmencie.
      done.add(cadHit[1]);
      api(`/api/cad/${cadHit[1]}`)
        .then((model) => {
          lastDesign = model;
          enterOps('cad');
          drawCadInfo(model);
          mountCadView(model);
        })
        .catch(() => {});
    }

    const img = full.match(IMG_RE);
    if (img) {
      const im = el('img');
      im.src = `/api/image/${img[1]}`;
      im.alt = 'Wygenerowany obraz';
      node.appendChild(im);
    }
    speak(stripActionTags(full).trim());
    if (isOwner()) refreshOwnerPanes();
  } catch (err) {
    node.remove();
    toast(err.message);
  }
  setCoreState('GOTOWY');
}

// ---------- Mowa (czat pisany) ----------

async function speak(text) {
  if (!text) return;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    setCoreState('MOWIE');
    audio.onplay = () => { store.audioLevel = 0.7; };
    audio.ontimeupdate = () => { store.audioLevel = Math.max(store.audioLevel, 0.5); };
    audio.onended = () => setCoreState('GOTOWY');
    await audio.play().catch(() => {});
  } catch {
    /* mowa jest dodatkiem - cisza nie blokuje rozmowy */
  }
}

// ---------- Kanal telemetryczny (magistrala zdarzen -> HUD) ----------
//
// Jedno polaczenie na cala sesje. Kazdy modul dzialajacy w tle (obrona,
// spotkania, IoT, wizja) melduje sie tu tym samym kanalem, wiec dziennik
// zdarzen i stan systemu sa zawsze zgodne z tym, co naprawde robi serwer.
//
// Zrywa sie regularnie (usypianie karty, zmiana sieci), wiec wpiete jest
// wznawianie z narastajaca przerwa - bez tego HUD po nocy pokazywalby
// zamrozony stan sprzed zerwania.

let hudWs = null;
let hudRetry = 0;
let hudTimer = null;

const HUD_LEVEL_KIND = { alert: 'bad', warn: 'bad', ok: 'ok', info: 'info', debug: 'info' };

function hudUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/hud?token=${encodeURIComponent(store.token || '')}`;
}

// Tozsamosc TEGO urzadzenia w rejestrze cross-device (server/devices.js).
// Trzymana w localStorage, nie w store (ktory zeruje sie przy wylogowaniu) -
// to samo urzadzenie ma zostac rozpoznawalne nawet po ponownym zalogowaniu.
function deviceIdentity() {
  let id = localStorage.getItem('jarvis_device_id');
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem('jarvis_device_id', id);
  }
  const deviceType = window.jarvisDesktop ? 'desktop' : isNativeShell() ? 'phone' : 'web';
  const name = deviceType === 'desktop' ? 'Komputer' : deviceType === 'phone' ? 'Telefon' : 'Przegladarka';
  return { deviceId: id, deviceType, name };
}

// Wiadomosc przekazana z innego urzadzenia przez /api/devices/:id/relay albo
// device.relay - jedyna, konkretna rzecz jaka na razie umie zrobic, to
// wykonac akcje z tego samego, zamknietego slownika co [AKCJA: ...] w
// czacie (runDeviceAction) - zadnej dowolnej komendy.
function handleDeviceRelay(payload) {
  if (payload?.type === 'run-action' && payload.action) {
    runDeviceAction(payload.action);
  }
}

// Stan systemu maluje caly interfejs: przy 'threat' motyw robi sie
// alarmowy, przy 'design' chlodny. Trzymamy go na <body>, zeby arkusz
// stylow mogl przestawic zmienne kolorow w jednym miejscu.
function applyPosture(posture) {
  if (!posture) return;
  const prev = store.posture?.level;
  store.posture = posture;
  document.body.dataset.posture = posture.level;
  if (prev && prev !== posture.level) {
    logEvent('rdzen', `stan systemu: ${posture.level}${posture.reason ? ` - ${posture.reason}` : ''}`,
      posture.level === 'threat' ? 'bad' : 'info');
    if (posture.level === 'threat') window.SFX?.play('err');
  }
  const badge = $('#headStatus');
  if (badge && posture.reason) badge.textContent = String(posture.reason).toLowerCase();
}

function handleHudEvent(event) {
  logEvent(event.source, event.message, HUD_LEVEL_KIND[event.level] || 'info');
  if (event.data?.posture) applyPosture(event.data.posture);
  if (event.level === 'alert') toast(event.message, 'bad');
  else if (event.level === 'warn') toast(event.message, 'bad');
  // Zdarzenia oznaczone jako 'speak' Jarvis czyta na glos - tak dziala
  // meldunek o zneutralizowanym zagrozeniu czy gotowym modelu.
  if (event.speak) speak(event.message);
  // Panele, ktore zywia sie zdarzeniami, dostaja je bezposrednio.
  for (const fn of HUD_HOOKS) {
    try {
      fn(event);
    } catch (err) {
      console.error('hud hook', err);
    }
  }
}

// Moduly interfejsu rejestruja tu swoje reakcje na zdarzenia z serwera.
const HUD_HOOKS = new Set();
function onHudEvent(fn) {
  HUD_HOOKS.add(fn);
  return () => HUD_HOOKS.delete(fn);
}

// Panel Perymetru odswieza sie NATYCHMIAST na zdarzenie z magistrali,
// zamiast czekac na kolejne reczne otwarcie zakladki - to wlasnie po to
// jest kanal HUD, nie tylko do dziennika.
onHudEvent((event) => {
  if (event.source === 'perimeter') loadPerimeter();
  if (event.source === 'telemetry') loadMachines();
  if (event.source === 'sentinel') loadSentinel();
});

function hudConnect() {
  if (!isOwner() || !store.token) return;
  if (hudWs && (hudWs.readyState === WebSocket.OPEN || hudWs.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(hudTimer);

  let ws;
  try {
    ws = new WebSocket(hudUrl());
  } catch {
    hudReconnect();
    return;
  }
  hudWs = ws;

  ws.addEventListener('open', () => {
    hudRetry = 0;
    logEvent('telemetria', 'kanal zdarzen otwarty', 'ok');
    ws.send(JSON.stringify({ type: 'device.hello', ...deviceIdentity() }));
  });

  ws.addEventListener('message', (e) => {
    let msg = null;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      applyPosture(msg.posture);
      // Historia przychodzi od najstarszego; dziennik trzyma najnowsze na
      // gorze, wiec wchodzi w tej samej kolejnosci co na zywo.
      (msg.events || []).forEach(handleHudEvent);
    } else if (msg.type === 'event') {
      handleHudEvent(msg.event);
    } else if (msg.type === 'device.message') {
      handleDeviceRelay(msg.payload);
    }
  });

  ws.addEventListener('close', (e) => {
    hudWs = null;
    // 4003 = serwer odmowil (gosc albo wygasly token). Ponawianie nic tu
    // nie da, wiec nie zasmiecamy dziennika co kilka sekund.
    if (e.code === 4003) return;
    hudReconnect();
  });

  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      /* zamknie sie samo */
    }
  });
}

function hudReconnect() {
  if (!isOwner()) return;
  hudRetry = Math.min(hudRetry + 1, 6);
  const delay = Math.min(30000, 1000 * 2 ** (hudRetry - 1));
  clearTimeout(hudTimer);
  hudTimer = setTimeout(hudConnect, delay);
}

function hudDisconnect() {
  clearTimeout(hudTimer);
  hudRetry = 0;
  if (hudWs) {
    try {
      hudWs.close();
    } catch {
      /* i tak porzucamy */
    }
    hudWs = null;
  }
}

// ---------- Rozmowa na zywo ----------

let liveWs = null;
let micStream = null;
let micNode = null;
let micCtx = null;
let outCtx = null;
let outAt = 0;
let outSources = [];

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const p = new URLSearchParams();
  if (store.location) {
    p.set('lat', store.location.lat);
    p.set('lon', store.location.lon);
  }
  if (store.token) p.set('token', store.token);
  // Brak wpisu w localStorage = "bez zdania", serwer decyduje sam z .env.
  // Wpis jest tylko wtedy, gdy uzytkownik SWIADOMIE przelaczyl w Ustawieniach.
  const clonePref = localStorage.getItem('jarvis.liveClone');
  if (clonePref != null) p.set('wantClone', clonePref);
  const qs = p.toString();
  return `${proto}//${location.host}/ws/voice${qs ? `?${qs}` : ''}`;
}

function to16k(f32, rate) {
  if (rate === 16000) return f32;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(f32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, f32.length - 1);
    out[i] = f32[lo] * (1 - (src - lo)) + f32[hi] * (src - lo);
  }
  return out;
}

function toPCM16(f32) {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function bufToB64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function stopOut() {
  outSources.forEach((s) => {
    try {
      s.stop();
    } catch {
      /* juz zatrzymane */
    }
  });
  outSources = [];
  if (outCtx) outAt = outCtx.currentTime;
  // Odcina tez wszystko, co bylo w drodze do sklonowanego glosu (patrz
  // playEncodedChunk) - inaczej fragment zdania mogl doleciec z opoznieniem
  // i zabrzmiec juz PO tym, jak uzytkownik przerwal Jarvisa.
  resetEncodedQueue();
}

// Kolejka odtwarzania planuje kazdy kawalek TUZ PO poprzednim (outAt), co
// przy plynnym strumieniu daje gladkie audio bez szczelin. Problem: gdy
// przegladarka usypia AudioContext w tle (zmiana karty, ekran wygaszony na
// telefonie), jego zegar (currentTime) ZAMRAZA SIE, a kolejne wiadomosci
// z serwera i tak przychodza i doklejaja sie do outAt. Po wznowieniu
// kontekstu okazuje sie, ze zaplanowalismy dzwiek na czas, ktory juz dawno
// minal wzgledem odswiezonego zegara - i to slychac jako "zacinanie sie" /
// cisze, bo Web Audio API po prostu nie odgrywa zrodel zaplanowanych w
// przeszlosci, tylko je cicho pomija.
//
// Naprawa w dwoch czesciach: (1) upewniamy sie, ze kontekst NAPRAWDE dziala
// TUZ PRZED zaplanowaniem dzwieku, zamiast polegac wylacznie na cyklicznym
// sprawdzaniu co kilka sekund; (2) jesli okaze sie, ze zegar kontekstu
// realnie zdazyl "uciec do przodu" wzgledem naszego planu (bo staly przez
// dluzszy czas), zaczynamy planowanie od nowa od biezacego czasu zamiast
// probowac odtworzyc caly zalegly zapas na raz.
// Fragmenty mowy docieraja od Gemini do serwera i od serwera do
// przegladarki z pewnym jitterem (nierowne odstepy, nie stala predkosc) -
// dotychczasowy plan doklejal kazdy kawalek TUZ PO poprzednim, wiec
// najmniejsza chwila opoznienia miedzy kawalkami slychac jako urwanie/
// zacięcie w polowie zdania. To osobny problem od zamrozonego zegara
// kontekstu w tle (patrz komentarz przy stopOut) - dzieje sie tez na
// pierwszym planie, w trakcie normalnego sluchania. Naprawa: gdy plan
// "dogania" biezacy czas (bufor sie wyczerpal), zaczynamy od nowa z
// niewielkim zapasem do przodu, zamiast dokladnie od teraz - dajemy w ten
// sposob kolejnemu kawalkowi margines na spoznienie, zanim usluchacz to
// uslyszy jako cisze.
const OUT_LOOKAHEAD_S = 0.12;

async function ensureOutRunning() {
  if (!outCtx) return false;
  if (outCtx.state === 'suspended') {
    try {
      await outCtx.resume();
    } catch {
      return false;
    }
  }
  if (!outCtx || outCtx.state !== 'running') return false;
  // Zegar kontekstu wyprzedzil nasz plan o wiecej, niz moglaby to
  // wytlumaczyc zwykla, plynna gra do przodu (kilka ms) - to znak, ze
  // kontekst byl zamrozony (albo bufor po prostu wysechl), a "plan" jest
  // z przeszlosci lub tuz na styk. Zaczynamy od nowa, z zapasem.
  if (outAt < outCtx.currentTime) outAt = outCtx.currentTime + OUT_LOOKAHEAD_S;
  return true;
}

async function playChunk(buf) {
  if (!(await ensureOutRunning())) return;
  const i16 = new Int16Array(buf);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  const ab = outCtx.createBuffer(1, f32.length, 24000);
  ab.copyToChannel(f32, 0);
  const src = outCtx.createBufferSource();
  src.buffer = ab;
  src.connect(outCtx.destination);
  const at = Math.max(outCtx.currentTime, outAt);
  src.start(at);
  outAt = at + ab.duration;
  outSources.push(src);
  src.onended = () => {
    outSources = outSources.filter((s) => s !== src);
  };
  store.audioLevel = 0.75;
}

// ---------- Odtwarzanie skonczonych fragmentow (klon glosu na zywo) ----------
//
// Tryb natywny przesyla surowy PCM 24kHz i playChunk() zaklada ten format
// na sztywno. Sklonowany glos przychodzi jako calkowicie zakodowany plik
// (WAV/MP3, cokolwiek zwrocil tts.js), wiec dekodujemy go Web Audio API
// zamiast zgadywac format probek.
let encodedQueue = Promise.resolve();
let encodedGen = 0;

function resetEncodedQueue() {
  encodedGen++;
  encodedQueue = Promise.resolve();
}

function playEncodedChunk(base64, mimeType) {
  if (!outCtx) return;
  const gen = encodedGen;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  // decodeAudioData jest asynchroniczny i rozne kawalki moga skonczyc sie
  // dekodowac w innej kolejnosci, niz przyszly - a zdania musza zabrzmiec
  // w kolejnosci wypowiedzi. Lancuch obietnic wymusza kolejnosc odtwarzania
  // niezaleznie od tego, ktory dekoduje sie szybciej.
  encodedQueue = encodedQueue.then(async () => {
    if (gen !== encodedGen || !outCtx) return; // przerwane w miedzyczasie
    let audioBuffer;
    try {
      audioBuffer = await outCtx.decodeAudioData(bytes.buffer.slice(0));
    } catch (err) {
      console.error('Nie udalo sie zdekodowac fragmentu mowy:', mimeType, err);
      return;
    }
    if (gen !== encodedGen || !outCtx) return;
    if (!(await ensureOutRunning()) || gen !== encodedGen) return;
    const src = outCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(outCtx.destination);
    const at = Math.max(outCtx.currentTime, outAt);
    src.start(at);
    outAt = at + audioBuffer.duration;
    outSources.push(src);
    src.onended = () => {
      outSources = outSources.filter((s) => s !== src);
    };
    store.audioLevel = 0.75;
  });
}

// Pojedyncza bramka chroniaca przed tym, zeby cokolwiek (slowo budzace,
// auto-polaczenie po zerwaniu sieci, powrot z logowania) wskoczylo Jarvisem
// w rozmowe, podczas gdy uzytkownik rozmawia z E.D.I.T.H. - bez tego panel
// Edith byl tylko oprawa, a glos i tak nalezal do Jarvisa.
function edithOpen() {
  const el = $('#edith');
  return Boolean(el && !el.hidden);
}

async function liveStart() {
  if (edithOpen()) return;
  wakeStop();
  store.live = true;
  $('#micBtn')?.classList.add('on');
  const ml = $('#micLabel');
  if (ml) ml.textContent = 'SLUCHAM';
  setCoreState('LACZE');

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch {
    // Odmowa mikrofonu to nie usterka polaczenia - ponawianie nic nie da,
    // dopoki uzytkownik nie zmieni zgody. Konczymy uczciwie i mowimy jak
    // wrocic, skoro nie ma juz przycisku startu.
    store.wantLive = false;
    store.live = false;
    $('#micBtn')?.classList.remove('on');
  const ml2 = $('#micLabel');
  if (ml2) ml2.textContent = 'NASLUCH';
    setCoreState('BRAK MIKROFONU');
    toast('Brak dostepu do mikrofonu. Przyznaj zgode i kliknij rdzen.');
    wakeStart();
    return;
  }

  // Dopiero tutaj mikrofon naprawde dziala - przy odmowie zgody wyzej
  // wychodzimy, wiec dzwiek nie zagra "na pusto".
  window.SFX?.play('micOn');

  outCtx = new (window.AudioContext || window.webkitAudioContext)();
  outAt = 0;
  liveWs = new WebSocket(wsUrl());
  liveWs.binaryType = 'arraybuffer';

  liveWs.onopen = async () => {
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = micCtx.createMediaStreamSource(micStream);
    const onFrame = (f32) => {
      if (!store.live || liveWs.readyState !== WebSocket.OPEN) return;
      liveWs.send(toPCM16(to16k(f32, micCtx.sampleRate)));
      store.audioLevel = Math.max(store.audioLevel, 0.28);
    };
    try {
      await micCtx.audioWorklet.addModule('/live-audio-processor.js');
      micNode = new AudioWorkletNode(micCtx, 'live-audio-processor');
      micNode.port.onmessage = (e) => onFrame(e.data);
      src.connect(micNode);
    } catch {
      micNode = micCtx.createScriptProcessor(4096, 1, 1);
      const g = micCtx.createGain();
      g.gain.value = 0;
      src.connect(micNode);
      micNode.connect(g);
      g.connect(micCtx.destination);
      micNode.onaudioprocess = (e) => onFrame(e.inputBuffer.getChannelData(0));
    }
  };

  liveWs.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      playChunk(ev.data);
      setCoreState('MOWIE');
      return;
    }
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type === 'ready') {
      relinkTries = 0; // udalo sie polaczyc - zerujemy opoznienie ponowien
      setCoreState('SLUCHAM');
      if (m.clonedVoice) logEvent('glos', 'rozmowa na zywo: sklonowany glos aktywny', 'ok');
    }
    else if (m.type === 'ttsChunk') {
      playEncodedChunk(m.data, m.mimeType);
      setCoreState('MOWIE');
    }
    else if (m.type === 'interrupted') stopOut();
    else if (m.type === 'turnComplete') {
      if (m.userText) pushSaid('me', m.userText);
      if (m.assistantText) pushSaid('jv', m.assistantText);
      if (isOwner()) refreshOwnerPanes();
      if (store.live) setCoreState('SLUCHAM');
    } else if (m.type === 'showImage') {
      // Jarvis wygenerowal obraz glosem - pokazujemy go w rozmowie.
      const d = pushSaid('jv', ' ');
      const im = el('img');
      im.src = '/api/image/' + m.id;
      d.appendChild(im);
    } else if (m.type === 'showDesign') {
      // Jarvis zaprojektowal cos glosem - pobieramy gotowy model i
      // otwieramy modul, zeby uzytkownik zobaczyl to, o czym slyszy.
      api(`/api/cad/${m.id}`)
        .then((model) => {
          lastDesign = model;
          enterOps('cad');
          drawCadInfo(model);
          mountCadView(model);
          logEvent('cad', `model ${model.id} z polecenia glosowego`);
        })
        .catch(() => {});
    } else if (m.type === 'startCamera') camOn();
    else if (m.type === 'stopCamera') camOff();
    else if (m.type === 'showSearch') showSearch(m.query, m.results || []);
    else if (m.type === 'deviceAction') runDeviceAction(m.action, m.params);
    else if (m.type === 'appAction') runAppAction(m.action, m.text);
    else if (m.type === 'runRoutine') runRoutineSteps(m.steps);
    else if (m.type === 'fileAction') handleFileAction(m);
    else if (m.type === 'error') {
      toast(`Rozmowa: ${m.message}`);
      liveStop();
      relinkSoon();
    } else if (m.type === 'closed') {
      liveStop();
      relinkSoon();
    }
  };

  liveWs.onerror = () => {
    // Bez halasu - onclose i tak zaraz zadziala i wznowi polaczenie.
  };
  liveWs.onclose = () => {
    if (store.live) liveStop();
    relinkSoon();
  };
}

function liveStop() {
  if (store.live) window.SFX?.play('micOff');
  store.live = false;
  $('#micBtn')?.classList.remove('on');
  const ml2 = $('#micLabel');
  if (ml2) ml2.textContent = 'NASLUCH';
  stopOut();
  camOff();
  if (micNode) {
    micNode.disconnect();
    micNode.onaudioprocess = null;
    if (micNode.port) micNode.port.onmessage = null;
    micNode = null;
  }
  if (micCtx) {
    micCtx.close().catch(() => {});
    micCtx = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (outCtx) {
    outCtx.close().catch(() => {});
    outCtx = null;
  }
  if (liveWs) {
    if (liveWs.readyState === WebSocket.OPEN) liveWs.send(JSON.stringify({ type: 'end' }));
    liveWs.close();
    liveWs = null;
  }
  setCoreState('GOTOWY');
  wakeStart();
}

// Rozmowa startuje sama i ma sie NIE konczyc. store.wantLive to intencja
// uzytkownika (wyciszyl czy nie) - oddzielona od stanu polaczenia, ktore
// moze paść z przyczyn sieciowych. Dopoki intencja trwa, wracamy.
function liveToggle() {
  if (store.live) {
    store.wantLive = false;
    liveStop();
    toast('Wyciszony. Kliknij rdzen, zeby wrocic.', 'ok');
  } else {
    store.wantLive = true;
    liveStart();
  }
}

let relinkTimer = null;
let relinkTries = 0;

// Wywolywane, gdy polaczenie padlo, a uzytkownik NIE wyciszyl rozmowy.
function relinkSoon() {
  if (!store.wantLive || relinkTimer) return;
  relinkTries++;
  // Rosnace opoznienie do 30 s i BEZ limitu prob: asystent ma byc ciagle
  // dostepny, wiec po powrocie sieci ma wrocic sam, nawet po dluzszej
  // przerwie. 30 s to kompromis miedzy tym a zuzyciem baterii.
  const delay = Math.min(1000 * relinkTries, 30000);
  setCoreState('WZNAWIAM');
  relinkTimer = setTimeout(async () => {
    relinkTimer = null;
    if (!store.wantLive || store.live) return;
    await liveStart();
  }, delay);
}

// ---------- Slowo budzace ----------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRec = null;

// Nasluch slowa "Jarvis" w PRZEGLADARCE jest domyslnie wylaczony, bo
// Web Speech API to mechanizm Google i przegladarka gra przy kazdym jego
// starcie wlasny sygnal, ktorego NIE DA SIE wyciszyc z poziomu strony.
// A restartuje sie co 400 ms, wiec te piknieciа wracaly bez konca.
//
// Nic realnie nie tracimy: rozmowa startuje sama przy wejsciu, a recznie
// wznawia sie klinieciem w rdzen. Aplikacja desktopowa i Android maja
// wlasny nasluch (wakeword.ps1 / plugin) - bez dzwiekow Google - i tych
// dwoch ponizsza flaga nie dotyczy.
// Chcesz wrocic do nasluchu w przegladarce: localStorage.setItem('jarvis.wake','on')
let wakeOn =
  Boolean(SR) &&
  !window.jarvisDesktop &&
  !isNativeShell() &&
  localStorage.getItem('jarvis.wake') === 'on';
let wakeTimer = null;
const WAKE_RE = /\b(d?zarwis|jarwis|jarvis)\b/;

function deaccent(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}

function wakeStop() {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (wakeRec) {
    const r = wakeRec;
    wakeRec = null;
    r.onend = r.onerror = r.onresult = null;
    try {
      r.stop();
    } catch {
      /* juz zatrzymane */
    }
  }
  if (isNativeShell() && window.Capacitor.Plugins.WakeWord) {
    window.Capacitor.Plugins.WakeWord.stop().catch(() => {});
  }
}

function wakeStart() {
  if (store.live) return;
  if (isNativeShell() && window.Capacitor.Plugins.WakeWord) {
    window.Capacitor.Plugins.WakeWord.start().catch(() => {});
    return;
  }
  if (!wakeOn || wakeRec) return;

  const r = new SR();
  wakeRec = r;
  r.lang = 'pl-PL';
  r.continuous = true;
  r.interimResults = false;
  r.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    if (last?.[0] && WAKE_RE.test(deaccent(last[0].transcript || ''))) liveStart();
  };
  r.onerror = (e) => {
    if (['network', 'not-allowed', 'service-not-allowed'].includes(e.error)) wakeOn = false;
  };
  r.onend = () => {
    if (wakeRec === r) wakeRec = null;
    if (wakeOn && !store.live) wakeTimer = setTimeout(wakeStart, 400);
  };
  try {
    r.start();
  } catch {
    wakeRec = null;
  }
}

// ---------- Logowanie ----------

function applyRole(role) {
  const changed = store.role !== role;
  store.role = role;
  if (role === 'owner') {
    // Modul wlasciciela zamkniety przy poprzednim wylogowaniu wraca, jesli
    // byl na scenie, gdy zniknal - ta sama zasada co przy zwyklym starcie.
    try {
      const pre = localStorage.getItem(PRELOGOUT_KEY);
      if (pre && moduleById(pre)?.owner) {
        localStorage.removeItem(PRELOGOUT_KEY);
        openWindow(pre);
      }
    } catch {
      /* localStorage moze byc niedostepny */
    }
    refreshOwnerPanes();
    hudConnect();
  } else {
    dropOwnerModules();
    hudDisconnect();
  }
  syncDock();
  refreshHeadStats();
  if (changed) logEvent('auth', role === 'owner' ? 'zalogowano wlasciciela' : 'tryb goscia');
}

// Prawdziwe liczby, nie ozdobniki: rola, ile Jarvis o Tobie pamieta i ile
// zadan czeka. Nic tu nie jest generowane losowo.
function refreshHeadStats() {
  const box = $('#headStats');
  if (!box) return;
  const stats = [
    [store.role === 'owner' ? (store.user || 'WLASCICIEL').toUpperCase() : 'GOSC', 'KONTO'],
    [String(store.factCount ?? '--'), 'PAMIEC'],
    [String(store.todoCount ?? '--'), 'ZADANIA'],
  ];
  box.innerHTML = '';
  stats.forEach(([value, label]) => {
    const d = el('div', 'head-stat');
    d.append(el('b', null, value), el('span', null, label));
    box.appendChild(d);
  });
}

function showAuth() {
  $('#authVeil').hidden = false;
  $('#authError').hidden = true;
  $('#authPassword').value = '';
  setTimeout(() => $('#authPassword').focus(), 60);
}

async function doLogin(password, user) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, user }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Blad logowania');
    store.token = data.token;
    store.user = (user || '').trim();
    localStorage.setItem('jarvis.token', data.token);
    if (store.user) localStorage.setItem('jarvis.user', store.user);
    applyRole('owner');
    $('#authVeil').hidden = true;
    toast('Zalogowano. Witam ponownie, sir.', 'ok');
    store.wantLive = true;
    liveStart();
  } catch (err) {
    const e = $('#authError');
    e.textContent = err.message;
    e.hidden = false;
  }
}

function doLogout() {
  store.token = null;
  localStorage.removeItem('jarvis.token');
  applyRole('guest');
  toast('Wylogowano - tryb goscia.', 'ok');
}

// ---------- Sekwencja startowa ----------

const BOOT_LINES = [
  'Budze rdzen...',
  'Laczenie z pamiecia...',
  'Otwieranie kanalu glosowego...',
  'Gotowe.',
];

function bootVisual(cv) {
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = cv.getBoundingClientRect().width;
  cv.width = cv.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let t = 0;
  let lastT = performance.now();

  const draw = () => {
    // Po zakonczeniu startu element znika z DOM - bez tego sprawdzenia
    // petla rysujaca rzucalaby wyjatkiem przy kazdej klatce.
    const bootEl = $('#boot');
    if (!bootEl || bootEl.classList.contains('gone')) return;
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    // Czas od zegara, nie od liczby klatek - patrz ten sam zabieg w
    // startCoreVisual/startGalaxy (ekrany >60 Hz inaczej kreciłyby to szybciej).
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    t += dt * 1.2; // = dawne "0.02 na klatke" przy zalozeniu 60 Hz

    // Miekka poswiata + smukly pierscien wypelniania - minimalistyczny
    // splash zamiast dawnego terminalowego dziennika rozruchu.
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(51, 224, 255, 0.22)');
    glow.addColorStop(1, 'rgba(51, 224, 255, 0)');
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(c, c, c * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(c, c, c * 0.72, t * 2.2, t * 2.2 + Math.PI * 0.6);
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#33e0ff');
    grad.addColorStop(1, '#9df3ff');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    requestAnimationFrame(draw);
  };
  draw();
}

async function runBoot() {
  const log = $('#bootLog');
  bootVisual($('#bootCanvas'));
  for (const line of BOOT_LINES) {
    log.textContent = line;
    await new Promise((r) => setTimeout(r, 320));
  }
}

// ---------- Start ----------

async function boot() {
  const bootDone = runBoot();

  try {
    const res = await fetch('/api/health', { headers: authHeaders() });
    const health = await res.json();
    store.cloneVoiceConfigured = Boolean(health.cloneVoiceConfigured);
    store.liveClonedVoiceDefault = Boolean(health.liveClonedVoiceDefault);
    window.__health = health;
    applyRole(health.role || 'guest');
    if (!health.authConfigured) {
      toast('Serwer nie ma ustawionego OWNER_PASSWORD - dziala tylko tryb goscia.', 'ok');
    }
  } catch {
    toast('Brak polaczenia z serwerem.');
  }

  await bootDone;
  $('#boot').classList.add('gone');
  setTimeout(() => $('#boot').remove(), 800);

  // Dwa rdzenie: duzy na ekranie spoczynku i maly w kolumnie rozmowy.
  // Rdzen na ekranie spoczynku jest teraz jedynym miejscem rozmowy - panel
  // "Rozmowa" na mostku jest ukryty (patrz .comms w style.css), wiec drugi
  // rdzen (#sideCore) nigdy nie jest widoczny i nie ma sensu go animowac.
  startCoreVisual($('#coreCanvas'), 42);
  $('#coreHit').addEventListener('click', liveToggle);

  startGalaxy($('#galaxyCanvas'));

  buildDock();
  initTalkWindow();
  restoreBoard();
  refreshHeadStats();
  drawIdleCards();
  window.dispatchEvent(new CustomEvent('jarvis:ready', { detail: window.__health || {} }));

  tickClock();
  setInterval(refreshLink, 60000);
  setInterval(drawIdleCards, 30000);
  wakeStart();

  if (store.role !== 'owner') {
    showAuth();
  } else {
    checkBubbleLaunch();
    // Rozmowa startuje sama razem z aplikacja - bez szukania przycisku.
    // Jesli przegladarka nie ma jeszcze zgody na mikrofon, liveStart sam
    // to zglosi i uzytkownik przyzna ja raz.
    store.wantLive = true;
    liveStart();
  }
}


$('#authForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doLogin($('#authPassword').value, $('#authUser').value);
});
$('#authGuestBtn').addEventListener('click', () => {
  $('#authVeil').hidden = true;
});

// --- Przejscia miedzy ekranem spoczynku a centrum ---
$('#idleEnter').addEventListener('click', () => enterOps());
$('#brandBtn').addEventListener('click', exitOps);
$('#exitBtn').addEventListener('click', exitOps);
$('#micBtn').addEventListener('click', liveToggle);
$('#paletteBtn').addEventListener('click', openPalette);

// --- Rozmowa w prawej kolumnie ---
$('#talkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#talkInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendTyped(text);
});

// --- Paleta polecen ---
$('#paletteInput').addEventListener('input', (e) => drawPalette(e.target.value));
$('#palette').addEventListener('click', (e) => {
  if (e.target.id === 'palette') closePalette();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#palette').hidden ? openPalette() : closePalette();
    return;
  }
  if ($('#palette').hidden) {
    // Escape poza paleta cofa z centrum na ekran spoczynku.
    if (e.key === 'Escape' && opsVisible() && $('#authVeil').hidden) exitOps();
    return;
  }
  if (e.key === 'Escape') closePalette();
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    movePalette(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    movePalette(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    document.querySelectorAll('.palette-item')[paletteSel]?.click();
  }
});

// Dzwiek klikniecia podpinamy w JEDNYM miejscu, na pointerdown - reagowanie
// dopiero na 'click' slychac jako opoznienie. Zakladki dostaja inny sygnal
// niz zwykle przyciski.
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  // Rdzen pomijamy - ma wlasny sygnal wlaczenia/wylaczenia mikrofonu i
  // "tap" tuz przed nim brzmialby jak zacinka.
  if (b.id === 'coreHit') return;
  window.SFX?.play(b.classList.contains('nav-btn') ? 'swap' : 'tap');
});

window.addEventListener('online', refreshLink);
window.addEventListener('offline', refreshLink);
document.addEventListener('click', wakeStart, { once: true });

if (isNativeShell() && window.Capacitor.Plugins.WakeWord) {
  window.Capacitor.Plugins.WakeWord.addListener('wake', () => {
    if (!store.live) liveStart();
  });
}
if (window.jarvisDesktop?.onWakeWord) {
  window.jarvisDesktop.onWakeWord(() => {
    if (!store.live) liveStart();
  });
}

// Dotkniecie dymka otwiera aplikacje i od razu zaczyna rozmowe - bez tego
// trzeba by jeszcze raz siegac po przycisk, co niweczy sens skrotu.
async function checkBubbleLaunch() {
  if (!isNativeShell() || !window.Capacitor.Plugins.Bubble) return;
  try {
    const { fromBubble } = await window.Capacitor.Plugins.Bubble.consumeLaunchFlag();
    if (fromBubble && !store.live) liveStart();
  } catch {
    /* plugin niedostepny - dymek po prostu otworzy apke bez rozmowy */
  }
}
// Gdy aplikacja schodzi w tlo (np. zostaje sam dymek), przegladarka
// potrafi uspic konteksty audio - a wtedy rozmowa milknie mimo dzialajacej
// uslugi. Wznawiamy je jawnie w obie strony.
async function keepAudioAlive() {
  if (!store.live) return;
  for (const ctx of [micCtx, outCtx]) {
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* nie da sie wznowic - rozmowa i tak zostanie zerwana widocznie */
      }
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    hudConnect();
    checkBubbleLaunch();
    refreshBubble();
    refreshGrip();
  }
  keepAudioAlive();
});

// W tle zdarzenia bywaja rzadsze, wiec dokladamy okresowe sprawdzenie.
// Mikrofonu nie da sie "obudzic w momencie uzycia" tak jak wyjscia
// (playChunk/playEncodedChunk maja teraz wlasny, natychmiastowy resume -
// patrz ensureOutRunning) - AudioWorklet dziala na wlasnym watku audio i
// po prostu nie woła onFrame, dopoki kontekst jest zawieszony. Krotszy
// odstep to jedyny sposob, zeby skrocic okno, w ktorym slowa uzytkownika
// wypowiedziane tuz po zawieszeniu w ogole nie docieraja do serwera -
// z zewnatrz wyglada to jak "Jarvis przestal odpowiadac".
setInterval(keepAudioAlive, 1500);

if (isNativeShell() && window.Capacitor.Plugins.Geolocation) {
  window.Capacitor.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000 })
    .then((pos) => {
      store.location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    })
    .catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- API rozszerzen ----------
//
// Nowe funkcje (public/extras/*.js) dolaczaja sie do interfejsu przez ten
// obiekt zamiast edytowac app.js. Skrypty rozszerzen laduja sie PO app.js,
// ale boot() buduje dok dopiero po animacji startowej - wiec register()
// wywolane synchronicznie przy ladowaniu zdaza dopisac modul do docka.
window.JarvisUI = {
  $, el, api, toast, authHeaders, store, isOwner, logEvent, speak, pushSaid,
  setCoreState, openWindow, runDeviceAction, deaccent,
  // Dodaje caly nowy modul: { id, title, sub, icon, owner, panels: { id: panelDef } }
  register(def) {
    if (MODULES.some((m) => m.id === def.id)) return;
    const panelIds = Object.keys(def.panels || {});
    MODULES.push({ id: def.id, title: def.title, sub: def.sub || '', owner: Boolean(def.owner), panels: panelIds });
    MODULE_ICONS[def.id] = def.icon || '◇';
    Object.assign(PANEL_DEFS, def.panels || {});
  },
  // Dopisuje panele do ISTNIEJACEGO modulu (np. kopia zapasowa w Ustawieniach).
  extend(moduleId, panels) {
    const mod = MODULES.find((m) => m.id === moduleId);
    if (!mod) return;
    for (const [pid, def] of Object.entries(panels)) {
      if (!mod.panels.includes(pid)) mod.panels.push(pid);
      PANEL_DEFS[pid] = def;
    }
  },
};

boot();
