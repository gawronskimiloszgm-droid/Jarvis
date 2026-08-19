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
  { id: 'cad', title: 'Projekt 3D', sub: 'model i wytrzymalosc', owner: true, panels: ['cad'] },
  { id: 'find', title: 'Wyszukiwanie', sub: 'wyniki z sieci', panels: ['find'] },
  { id: 'dev', title: 'Urzadzenie', sub: 'sterowanie i uprawnienia', owner: true, panels: ['grip', 'bubble'] },
  { id: 'set', title: 'Ustawienia', sub: 'profil asystenta', panels: ['settings'] },
  { id: 'logs', title: 'Logi', sub: 'strumien zdarzen', panels: ['logs'] },
];

const MOUNTED = new Map();
const LIVE_PANELS = new Set();
let activeModule = null;

const panelLive = (id) => LIVE_PANELS.has(id);
const moduleById = (id) => MODULES.find((m) => m.id === id);

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
  showModule(moduleId || activeModule || 'dash');
}

function exitOps() {
  $('#ops').hidden = true;
  $('#idle').hidden = false;
}

function opsVisible() {
  return !$('#ops').hidden;
}

// ---------- Kolumna modulow ----------

function buildNav() {
  const list = $('#navList');
  list.innerHTML = '';
  MODULES.forEach((m, i) => {
    const b = el('button', 'nav-btn');
    b.dataset.mod = m.id;
    b.append(
      el('span', 'num', String(i + 1).padStart(2, '0')),
      el('span', 'lbl', m.title),
      el('span', 'badge', m.badge || '')
    );
    b.addEventListener('click', () => showModule(m.id));
    list.appendChild(b);
  });
  syncNav();
}

function syncNav() {
  document.querySelectorAll('[data-mod]').forEach((b) => {
    const m = moduleById(b.dataset.mod);
    b.classList.toggle('on', b.dataset.mod === activeModule);
    b.classList.toggle('off', Boolean(m?.owner) && !isOwner());
  });
}

function mountModule(id) {
  const mod = moduleById(id);
  if (!mod) return null;
  if (mod.owner && !isOwner()) return null;

  const existing = MOUNTED.get(id);
  if (existing) return existing;

  const section = el('div', 'cards');
  mod.panels.forEach((pid) => {
    const def = PANEL_DEFS[pid];
    if (!def) return;
    const card = el('div', `card${def.wide ? ' wide' : ''}`);
    const head = el('div', 'card-head');
    head.append(el('span', 'gl', def.glyph), el('span', null, def.title));
    const body = el('div', 'card-body');
    card.append(head, body);
    section.appendChild(card);
    LIVE_PANELS.add(pid);
    def.build(body);
  });
  section.hidden = true;
  $('#modBody').appendChild(section);
  MOUNTED.set(id, section);
  return section;
}

function showModule(id) {
  const mod = moduleById(id);
  if (!mod) return;
  if (mod.owner && !isOwner()) {
    toast('Ten modul wymaga zalogowania.');
    return;
  }

  const section = mountModule(id);
  if (!section) return;
  mod.panels.forEach((pid) => PANEL_DEFS[pid]?.refresh?.());

  MOUNTED.forEach((sec, key) => {
    sec.hidden = key !== id;
  });

  $('#modTitle').textContent = mod.title;
  $('#modSub').textContent = mod.sub;
  const badge = $('#modBadge');
  badge.textContent = mod.badge || '';
  badge.hidden = !mod.badge;

  activeModule = id;
  syncNav();
}

// Po wylogowaniu moduly wlasciciela znikaja RAZEM z wczytana trescia -
// inaczej gosc zobaczylby cudze zadania czy pamiec.
function dropOwnerModules() {
  MODULES.filter((m) => m.owner).forEach((m) => {
    const sec = MOUNTED.get(m.id);
    if (!sec) return;
    if (m.id === 'eye') camOff();
    sec.remove();
    MOUNTED.delete(m.id);
    m.panels.forEach((p) => LIVE_PANELS.delete(p));
  });
  if (!activeModule || moduleById(activeModule)?.owner) showModule('dash');
  syncNav();
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

function drawCadInfo(model) {
  const box = $('#cadInfo');
  if (!box) return;
  box.innerHTML = '';

  if (!model) {
    box.appendChild(
      el('div', 'hint', 'Podaj parametry albo popros Jarvisa glosem: "zaprojektuj uchwyt na 15 funtow".')
    );
    return;
  }

  const s = model.strength;
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
  actions.append(heat, dl);
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

      const ul = el('ul', 'list');
      ul.id = 'moneyList';
      body.append(sum, sub, cats, f, ul);
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
    frame++;
    if (frame % 2) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.44;
    const R = Math.max(w, h) * 0.66;
    const flat = 0.4; // splaszczenie dysku - dysk widziany pod katem
    t += 0.0022;
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

// ---------- Wizualizacja rdzenia ----------

// UWAGA: uchwyt animacji musi byc OSOBNY dla kazdego rdzenia. Rysujemy dwa
// (duzy na ekranie spoczynku i maly przy rozmowie), a wspolna zmienna
// sprawiala, ze drugie wywolanie anulowalo klatke pierwszego i wielki rdzen
// pozostawal pusty.

// Emblemat J.A.R.V.I.S.: koncentryczne pierscienie i napis w srodku.
// Warstwy od zewnatrz: poswiata, pierscien podzialki, wykres widma,
// obrotowy pierscien segmentowy, przeciwbiezne luki, pierscien wewnetrzny
// i wordmark. Ukladem rzadzi jedna liczba - "base" (promien) - wiec calosc
// skaluje sie do kazdego rozmiaru bez poprawek.
const CORE_SPECTRUM = 64;
const coreBands = new Float32Array(CORE_SPECTRUM);

// Napis rysujemy litera po literze. ctx.letterSpacing jest nowe i nie
// wszedzie dziala, a odstep miedzy literami to tu polowa charakteru.
function drawWordmark(ctx, cx, cy, base, lvl) {
  const word = 'JARVIS';
  const size = base * 0.23;
  ctx.font = `600 ${size}px 'Consolas', 'SF Mono', 'Roboto Mono', monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const gap = size * 0.34;
  const widths = [...word].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (word.length - 1);

  ctx.save();
  ctx.shadowColor = `rgba(34, 224, 255, ${0.75 + lvl * 0.25})`;
  ctx.shadowBlur = base * (0.09 + lvl * 0.07);
  ctx.fillStyle = `rgba(190, 246, 255, ${0.9 + lvl * 0.1})`;
  let x = cx - total / 2;
  for (let i = 0; i < word.length; i++) {
    ctx.fillText(word[i], x, cy);
    x += widths[i] + gap;
  }
  ctx.restore();
}

function startCoreVisual(cv) {
  const ctx = cv.getContext('2d');
  let t = 0;
  let raf = null;

  const draw = () => {
    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(rect.width * dpr)) {
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
    }
    const w = rect.width;
    const h = rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) / 2 - 4;
    if (base <= 0) {
      raf = requestAnimationFrame(draw);
      return;
    }
    const lvl = store.audioLevel;
    t += 0.016;

    const ink = (a) => `rgba(34, 224, 255, ${a})`;
    const ring = (r, a, lw) => {
      ctx.beginPath();
      ctx.arc(cx, cy, base * r, 0, Math.PI * 2);
      ctx.strokeStyle = ink(a);
      ctx.lineWidth = lw;
      ctx.stroke();
    };

    // 1. Poswiata calosci - oddycha powoli, mocniej gdy Jarvis mowi
    const halo = ctx.createRadialGradient(cx, cy, base * 0.1, cx, cy, base);
    const breathe = 0.5 + Math.sin(t * 0.9) * 0.5;
    halo.addColorStop(0, ink(0.1 + lvl * 0.16 + breathe * 0.03));
    halo.addColorStop(0.72, ink(0.05 + lvl * 0.07));
    halo.addColorStop(1, 'rgba(34, 224, 255, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, base, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    // 2. Pierscien zewnetrzny z podzialka
    ring(0.99, 0.5, 1.4);
    const ticks = 120;
    for (let i = 0; i < ticks; i++) {
      const ang = (i / ticks) * Math.PI * 2 + t * 0.04;
      const major = i % 10 === 0;
      const len = major ? base * 0.06 : base * 0.028;
      const r0 = base * 0.985 - len;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
      ctx.strokeStyle = ink(major ? 0.8 : 0.22);
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.stroke();
    }

    // 3. Widmo dzwieku - wieniec kreseczek, cichy w spoczynku
    for (let i = 0; i < CORE_SPECTRUM; i++) {
      const noise = Math.sin(t * 1.9 + i * 0.6) * 0.5 + Math.sin(t * 3.3 + i * 1.4) * 0.5;
      const target = 0.06 + Math.abs(noise) * 0.08 + lvl * (0.5 + Math.abs(noise) * 0.8);
      coreBands[i] += (target - coreBands[i]) * 0.22;
      const ang = (i / CORE_SPECTRUM) * Math.PI * 2 - Math.PI / 2;
      const r0 = base * 0.79;
      const r1 = r0 + coreBands[i] * base * 0.15;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.strokeStyle = ink(0.2 + coreBands[i] * 1.1);
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // 4. Pierscien segmentowy - 14 krechek jadacych w prawo
    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const from = (i / seg) * Math.PI * 2 + t * 0.16;
      ctx.beginPath();
      ctx.arc(cx, cy, base * 0.72, from, from + (Math.PI * 2) / seg - 0.13);
      ctx.strokeStyle = ink(0.42);
      ctx.lineWidth = 3.4;
      ctx.stroke();
    }

    // 5. Przeciwbiezne luki - luzniejszy, zywy pierscien
    [
      { r: 0.63, from: 0.3, len: 1.9, sp: -0.34, a: 0.62, lw: 1.5 },
      { r: 0.63, from: 3.7, len: 1.4, sp: -0.34, a: 0.62, lw: 1.5 },
      { r: 0.56, from: 1.4, len: 2.4, sp: 0.5, a: 0.4, lw: 1.2 },
      { r: 0.56, from: 4.9, len: 1.1, sp: 0.5, a: 0.4, lw: 1.2 },
    ].forEach((a) => {
      ctx.beginPath();
      ctx.arc(cx, cy, base * a.r, a.from + t * a.sp, a.from + a.len + t * a.sp);
      ctx.strokeStyle = ink(a.a);
      ctx.lineWidth = a.lw;
      ctx.stroke();
    });

    // 6. Pierscien wewnetrzny - rama napisu, pulsuje z glosem
    ring(0.46 + lvl * 0.015, 0.75, 2);
    ring(0.4, 0.22, 1);

    // 7. Poswiata pod napisem, zeby litery nie wisialy w prozni
    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.44);
    inner.addColorStop(0, ink(0.16 + lvl * 0.2));
    inner.addColorStop(1, 'rgba(34, 224, 255, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, base * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = inner;
    ctx.fill();

    // 8. Napis
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

async function runDeviceAction(name) {
  if (!isOwner()) {
    toast('Sterowanie urzadzeniem wymaga zalogowania.');
    return;
  }
  try {
    if (window.jarvisDesktop) {
      const r = await window.jarvisDesktop.runAction(name);
      if (!r?.ok) toast(`Nie udalo sie: ${name}`);
      return;
    }
    if (isNativeShell() && window.Capacitor.Plugins.DeviceControl) {
      const r = await window.Capacitor.Plugins.DeviceControl.runAction({ name });
      if (!r?.ok) toast(`Nie udalo sie: ${name}`);
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

function pushSaid(who, text) {
  if (!text) return;
  // Tylko budujemy czat, NIE otwieramy go. Rozmowa na zywo sypie replikami
  // bez przerwy - wymuszanie widoku odbieraloby mozliwosc ogladania rdzenia.

  const feed = $('#talkFeed');
  if (!feed) return;
  const d = el('div', `said ${who === 'me' ? 'me' : 'jv'}`);
  d.appendChild(el('span', 'who', who === 'me' ? 'TY' : 'JARVIS'));
  d.appendChild(document.createTextNode(text));
  feed.appendChild(d);
  const count = $('#sideCount');
  if (count) count.textContent = String(feed.querySelectorAll('.said').length);
  feed.scrollTop = feed.scrollHeight;
  return d;
}

// ---------- Czat pisany ----------

const IMG_RE = /\[\[IMG:([^\]]+)\]\]/;
const ACT_RE = /\[AKCJA:\s*([^\]]+)\]/g;

async function sendTyped(text) {
  window.SFX?.play('send');
  pushSaid('me', text);
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
          runDeviceAction(m[1].trim());
        }
      }
      node.textContent = '';
      node.appendChild(el('span', 'who', 'JARVIS'));
      node.appendChild(document.createTextNode(full.replace(ACT_RE, '').replace(IMG_RE, '').replace(CAD_RE, '')));
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
    speak(full.replace(ACT_RE, '').replace(IMG_RE, '').replace(CAD_RE, '').trim());
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
}

function playChunk(buf) {
  if (!outCtx) return;
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

async function liveStart() {
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
    else if (m.type === 'deviceAction') runDeviceAction(m.action);
    else if (m.type === 'appAction') runAppAction(m.action, m.text);
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
  if (role === 'owner') refreshOwnerPanes();
  else dropOwnerModules();
  syncNav();
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
  'core.init  rdzen jarvis',
  'auth.mod   warstwa uprawnien ...... <b>OK</b>',
  'audio.io   kanal glosowy 16k/24k .. <b>OK</b>',
  'net.link   polaczenie szyfrowane .. <b>OK</b>',
  'mem.load   pamiec dlugoterminowa .. <b>OK</b>',
  'sense.geo  lokalizacja ............ <b>OK</b>',
  'ui.stage   przestrzen robocza ..... <b>OK</b>',
  'system gotowy. <b>WSZYSTKIE UKLADY SPRAWNE</b>',
];

function bootVisual(cv) {
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = cv.getBoundingClientRect().width;
  cv.width = cv.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let t = 0;

  const draw = () => {
    // Po zakonczeniu startu element znika z DOM - bez tego sprawdzenia
    // petla rysujaca rzucalaby wyjatkiem przy kazdej klatce.
    const bootEl = $('#boot');
    if (!bootEl || bootEl.classList.contains('gone')) return;
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    t += 0.02;

    for (let i = 0; i < 4; i++) {
      const p = (t * 0.4 + i * 0.25) % 1;
      ctx.beginPath();
      ctx.arc(c, c, p * c * 0.95, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34, 224, 255, ${(1 - p) * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(c, c, c * 0.3, t * 2, t * 2 + Math.PI * 1.3);
    ctx.strokeStyle = 'rgba(34, 224, 255, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    requestAnimationFrame(draw);
  };
  draw();
}

async function runBoot() {
  const log = $('#bootLog');
  bootVisual($('#bootCanvas'));
  for (const line of BOOT_LINES) {
    log.innerHTML += `${line}\n`;
    log.scrollTop = log.scrollHeight;
    await new Promise((r) => setTimeout(r, 170));
  }
}

// ---------- Start ----------

async function boot() {
  const bootDone = runBoot();

  try {
    const res = await fetch('/api/health', { headers: authHeaders() });
    const health = await res.json();
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
  // Kazdy ma wlasna petle rysowania, obie karmione tym samym poziomem
  // dzwieku, wiec reaguja identycznie.
  startCoreVisual($('#coreCanvas'));
  startCoreVisual($('#sideCore'));
  $('#coreHit').addEventListener('click', liveToggle);

  startGalaxy($('#galaxyCanvas'));

  buildNav();
  showModule('dash');
  refreshHeadStats();
  drawIdleCards();

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
    checkBubbleLaunch();
    refreshBubble();
    refreshGrip();
  }
  keepAudioAlive();
});

// W tle zdarzenia bywaja rzadsze, wiec dokladamy okresowe sprawdzenie.
setInterval(keepAudioAlive, 5000);

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

boot();
