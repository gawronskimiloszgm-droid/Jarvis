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
  location: null,
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

function setState(text) {
  const n = $('#barState');
  if (n) n.textContent = text;
}

// ---------- Menedzer paneli ----------

const PANES = new Map();
let zTop = 10;

function savedBox(id) {
  try {
    return JSON.parse(localStorage.getItem(`jarvis.pane.${id}`) || 'null');
  } catch {
    return null;
  }
}

function saveBox(id, box) {
  localStorage.setItem(`jarvis.pane.${id}`, JSON.stringify(box));
}

function clampBox(box) {
  const stage = $('#stage').getBoundingClientRect();
  const w = Math.min(box.w, stage.width - 8);
  const h = Math.min(box.h, stage.height - 8);
  return {
    x: Math.max(0, Math.min(box.x, stage.width - w)),
    y: Math.max(0, Math.min(box.y, stage.height - h)),
    w,
    h,
  };
}

function focusPane(pane) {
  document.querySelectorAll('.pane.focus').forEach((p) => p.classList.remove('focus'));
  pane.classList.add('focus');
  pane.style.zIndex = String(++zTop);
}

function makeDraggable(pane, handle, id) {
  let start = null;

  const down = (e) => {
    if (e.target.closest('.pane-btn')) return;
    const pt = e.touches ? e.touches[0] : e;
    const r = pane.getBoundingClientRect();
    const stage = $('#stage').getBoundingClientRect();
    start = { px: pt.clientX, py: pt.clientY, x: r.left - stage.left, y: r.top - stage.top };
    focusPane(pane);
    e.preventDefault();
  };

  const move = (e) => {
    if (!start) return;
    const pt = e.touches ? e.touches[0] : e;
    const box = clampBox({
      x: start.x + (pt.clientX - start.px),
      y: start.y + (pt.clientY - start.py),
      w: pane.offsetWidth,
      h: pane.offsetHeight,
    });
    pane.style.left = `${box.x}px`;
    pane.style.top = `${box.y}px`;
  };

  const up = () => {
    if (!start) return;
    start = null;
    const r = pane.getBoundingClientRect();
    const stage = $('#stage').getBoundingClientRect();
    saveBox(id, { x: r.left - stage.left, y: r.top - stage.top, w: pane.offsetWidth, h: pane.offsetHeight });
  };

  handle.addEventListener('mousedown', down);
  handle.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}

function makeResizable(pane, grip, id) {
  let start = null;

  const down = (e) => {
    const pt = e.touches ? e.touches[0] : e;
    start = { px: pt.clientX, py: pt.clientY, w: pane.offsetWidth, h: pane.offsetHeight };
    focusPane(pane);
    e.preventDefault();
    e.stopPropagation();
  };

  const move = (e) => {
    if (!start) return;
    const pt = e.touches ? e.touches[0] : e;
    pane.style.width = `${Math.max(190, start.w + (pt.clientX - start.px))}px`;
    pane.style.height = `${Math.max(120, start.h + (pt.clientY - start.py))}px`;
    e.preventDefault();
  };

  const up = () => {
    if (!start) return;
    start = null;
    const r = pane.getBoundingClientRect();
    const stage = $('#stage').getBoundingClientRect();
    saveBox(id, { x: r.left - stage.left, y: r.top - stage.top, w: pane.offsetWidth, h: pane.offsetHeight });
  };

  grip.addEventListener('mousedown', down);
  grip.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}

function openPane(id) {
  const def = PANEL_DEFS[id];
  if (!def) return null;
  if (def.owner && !isOwner()) {
    toast('Ta funkcja wymaga zalogowania haslem.');
    return null;
  }
  if (PANES.has(id)) {
    const pane = PANES.get(id);
    pane.classList.remove('min');
    focusPane(pane);
    return pane;
  }

  const frag = $('#panelTpl').content.cloneNode(true);
  const pane = frag.querySelector('.pane');
  pane.dataset.pane = id;
  $('.pane-title', pane).textContent = def.title;

  const box = clampBox(savedBox(id) || def.box());
  pane.style.left = `${box.x}px`;
  pane.style.top = `${box.y}px`;
  pane.style.width = `${box.w}px`;
  pane.style.height = `${box.h}px`;

  const body = $('.pane-body', pane);
  $('[data-act="close"]', pane).addEventListener('click', () => closePane(id));
  $('[data-act="min"]', pane).addEventListener('click', () => {
    pane.classList.toggle('min');
    syncDock();
  });
  pane.addEventListener('mousedown', () => focusPane(pane));

  makeDraggable(pane, $('.pane-bar', pane), id);
  makeResizable(pane, $('[data-grip]', pane), id);

  $('#stage').appendChild(pane);
  PANES.set(id, pane);
  focusPane(pane);

  def.build(body, pane);
  if (def.refresh) def.refresh();
  syncDock();
  return pane;
}

function closePane(id) {
  const pane = PANES.get(id);
  if (!pane) return;
  if (PANEL_DEFS[id]?.onClose) PANEL_DEFS[id].onClose();
  pane.remove();
  PANES.delete(id);
  syncDock();
}

function togglePane(id) {
  if (PANES.has(id)) closePane(id);
  else openPane(id);
}

function paneBody(id) {
  const pane = PANES.get(id);
  return pane ? $('.pane-body', pane) : null;
}

// ---------- Definicje paneli ----------

function grid(col, row, w, h) {
  return () => {
    const stage = $('#stage').getBoundingClientRect();
    const unitW = stage.width / 12;
    const unitH = stage.height / 8;
    return {
      x: Math.round(col * unitW),
      y: Math.round(row * unitH),
      w: Math.round(w * unitW),
      h: Math.round(h * unitH),
    };
  };
}

const PANEL_DEFS = {
  core: {
    title: 'RDZEN',
    glyph: '◉',
    box: grid(4, 0.2, 4, 4),
    build(body) {
      body.style.padding = '6px';
      const wrap = el('div', 'core-wrap');
      const cv = el('canvas', 'core-canvas');
      cv.id = 'coreCanvas';
      const st = el('div', 'core-state', 'GOTOWY');
      st.id = 'coreState';
      wrap.append(cv, st);
      body.appendChild(wrap);
      startCoreVisual(cv);
    },
  },

  link: {
    title: 'SYSTEM',
    glyph: '▤',
    box: grid(0.2, 0.2, 3.6, 2.2),
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
    box: grid(8.2, 0.2, 3.6, 2.2),
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
    box: grid(0.2, 2.6, 3.6, 2.6),
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

  talk: {
    title: 'ROZMOWA',
    glyph: '❐',
    box: grid(8.2, 2.6, 3.6, 5.2),
    build(body) {
      body.innerHTML = '';
      const feed = el('div', 'feed');
      feed.id = 'talkFeed';
      const f = el('form', 'field');
      f.style.marginTop = '10px';
      const i = el('input', 'inp');
      i.id = 'talkInput';
      i.placeholder = 'Napisz...';
      i.autocomplete = 'off';
      const b = el('button', 'btn', 'OK');
      b.type = 'submit';
      f.append(i, b);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = i.value.trim();
        if (text) {
          i.value = '';
          sendTyped(text);
        }
      });
      body.append(feed, f);
    },
  },

  tasks: {
    title: 'ZADANIA',
    glyph: '☰',
    owner: true,
    box: grid(0.2, 5.4, 3.9, 2.4),
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
    box: grid(4.2, 5.4, 3.9, 2.4),
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
    box: grid(4.2, 0.2, 3.6, 2.2),
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
    box: grid(4.2, 2.6, 3.9, 2.6),
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
    box: grid(0.2, 2.6, 7.9, 5.2),
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
};

const DOCK_ORDER = ['core', 'link', 'clock', 'weather', 'talk', 'mind', 'tasks', 'alerts', 'eye', 'find'];

function buildDock() {
  const dock = $('#dock');
  dock.innerHTML = '';
  DOCK_ORDER.forEach((id) => {
    const def = PANEL_DEFS[id];
    const b = el('button', 'dock-btn');
    b.dataset.dock = id;
    b.append(el('span', 'gl', def.glyph), el('span', null, def.title));
    b.addEventListener('click', () => togglePane(id));
    dock.appendChild(b);
  });
  syncDock();
}

function syncDock() {
  document.querySelectorAll('[data-dock]').forEach((b) => {
    const id = b.dataset.dock;
    b.classList.toggle('on', PANES.has(id));
    b.classList.toggle('locked', Boolean(PANEL_DEFS[id].owner) && !isOwner());
  });
}

// ---------- Wizualizacja rdzenia ----------

let coreRaf = null;

function startCoreVisual(cv) {
  const ctx = cv.getContext('2d');
  let t = 0;

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
    const base = Math.min(w, h) / 2 - 6;
    if (base <= 0) {
      coreRaf = requestAnimationFrame(draw);
      return;
    }
    const lvl = store.audioLevel;
    t += 0.016;

    // Obrotowe luki
    const arcs = [
      { r: base * 0.94, from: 0.1, len: 1.5, sp: 0.35, a: 0.55 },
      { r: base * 0.94, from: 3.4, len: 1.1, sp: 0.35, a: 0.55 },
      { r: base * 0.76, from: 1.2, len: 2.4, sp: -0.5, a: 0.75 },
      { r: base * 0.58, from: 2.6, len: 1.8, sp: 0.8, a: 0.9 },
    ];
    arcs.forEach((a) => {
      ctx.beginPath();
      ctx.arc(cx, cy, a.r, a.from + t * a.sp, a.from + a.len + t * a.sp);
      ctx.strokeStyle = `rgba(34, 224, 255, ${a.a})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });

    // Radialne slupki reagujace na dzwiek
    const bars = 56;
    for (let i = 0; i < bars; i++) {
      const ang = (i / bars) * Math.PI * 2;
      const wobble = Math.sin(t * 3 + i * 0.7) * 0.5 + 0.5;
      const len = base * 0.1 + wobble * base * 0.1 * (0.25 + lvl * 2.4);
      const r0 = base * 0.34;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
      ctx.strokeStyle = `rgba(34, 224, 255, ${0.2 + wobble * 0.55})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Srodkowy wielobok
    const sides = 6;
    const pr = base * 0.24 * (1 + lvl * 0.4);
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const ang = (i / sides) * Math.PI * 2 - t * 0.4;
      const px = cx + Math.cos(ang) * pr;
      const py = cy + Math.sin(ang) * pr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(34, 224, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = `rgba(34, 224, 255, ${0.08 + lvl * 0.3})`;
    ctx.fill();

    store.audioLevel *= 0.92;
    coreRaf = requestAnimationFrame(draw);
  };

  if (coreRaf) cancelAnimationFrame(coreRaf);
  draw();
}

function setCoreState(text) {
  const n = $('#coreState');
  if (n) n.textContent = text;
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
  const t = $('#clkTime');
  const d = $('#clkDate');
  const bar = $('#barClock');
  const hh = now.toLocaleTimeString('pl-PL', { hour12: false });
  if (t) t.textContent = hh;
  if (bar) bar.textContent = hh;
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
  if (!isOwner() || !PANES.has('tasks')) return;
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
  if (!isOwner() || !PANES.has('alerts')) return;
  try {
    const { reminders } = await api('/api/reminders');
    drawAlerts(reminders);
  } catch {
    /* brak uprawnien albo brak sieci */
  }
}

async function loadMind() {
  if (!isOwner() || !PANES.has('mind')) return;
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
  loadTasks();
  loadAlerts();
  loadMind();
  refreshLink();
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
  openPane('find');
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
  openPane('eye');
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

PANEL_DEFS.eye.onClose = () => camOff();

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

// ---------- Transkrypcja rozmowy ----------

function pushSaid(who, text) {
  if (!text) return;
  openPane('talk');
  const feed = $('#talkFeed');
  if (!feed) return;
  const d = el('div', `said ${who === 'me' ? 'me' : 'jv'}`);
  d.appendChild(el('span', 'who', who === 'me' ? 'TY' : 'JARVIS'));
  d.appendChild(document.createTextNode(text));
  feed.appendChild(d);
  feed.scrollTop = feed.scrollHeight;
  return d;
}

// ---------- Czat pisany ----------

const IMG_RE = /\[\[IMG:([^\]]+)\]\]/;
const ACT_RE = /\[AKCJA:\s*([^\]]+)\]/g;

async function sendTyped(text) {
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
      node.appendChild(document.createTextNode(full.replace(ACT_RE, '').replace(IMG_RE, '')));
      $('#talkFeed').scrollTop = $('#talkFeed').scrollHeight;
    }
    const img = full.match(IMG_RE);
    if (img) {
      const im = el('img');
      im.src = `/api/image/${img[1]}`;
      im.alt = 'Wygenerowany obraz';
      node.appendChild(im);
    }
    speak(full.replace(ACT_RE, '').replace(IMG_RE, '').trim());
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
  $('#talkBtn').classList.add('live');
  setCoreState('LACZE');

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch {
    toast('Brak dostepu do mikrofonu.');
    store.live = false;
    $('#talkBtn').classList.remove('live');
    setCoreState('GOTOWY');
    wakeStart();
    return;
  }

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
    if (m.type === 'ready') setCoreState('SLUCHAM');
    else if (m.type === 'interrupted') stopOut();
    else if (m.type === 'turnComplete') {
      if (m.userText) pushSaid('me', m.userText);
      if (m.assistantText) pushSaid('jv', m.assistantText);
      if (isOwner()) refreshOwnerPanes();
      if (store.live) setCoreState('SLUCHAM');
    } else if (m.type === 'startCamera') camOn();
    else if (m.type === 'stopCamera') camOff();
    else if (m.type === 'showSearch') showSearch(m.query, m.results || []);
    else if (m.type === 'deviceAction') runDeviceAction(m.action);
    else if (m.type === 'error') {
      toast(`Rozmowa: ${m.message}`);
      liveStop();
    } else if (m.type === 'closed') liveStop();
  };

  liveWs.onerror = () => toast('Blad polaczenia glosowego.');
  liveWs.onclose = () => {
    if (store.live) liveStop();
  };
}

function liveStop() {
  store.live = false;
  $('#talkBtn').classList.remove('live');
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

function liveToggle() {
  if (store.live) liveStop();
  else liveStart();
}

// ---------- Slowo budzace ----------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRec = null;
let wakeOn = Boolean(SR) && !window.jarvisDesktop && !isNativeShell();
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
  store.role = role;
  const n = $('#barRole');
  n.textContent = role === 'owner' ? 'MILOSZ' : 'GOSC';
  n.classList.toggle('owner', role === 'owner');
  syncDock();
  if (role === 'owner') refreshOwnerPanes();
  else ['tasks', 'alerts', 'mind', 'eye'].forEach((id) => closePane(id));
}

function showAuth() {
  $('#authVeil').hidden = false;
  $('#authError').hidden = true;
  $('#authPassword').value = '';
  setTimeout(() => $('#authPassword').focus(), 60);
}

async function doLogin(password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Blad logowania');
    store.token = data.token;
    localStorage.setItem('jarvis.token', data.token);
    applyRole('owner');
    $('#authVeil').hidden = true;
    toast('Zalogowano. Witam ponownie, sir.', 'ok');
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
    if ($('#boot').classList.contains('gone')) return;
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

function defaultLayout() {
  const seen = localStorage.getItem('jarvis.layout.v1');
  const wide = $('#stage').getBoundingClientRect().width >= 900;
  const base = wide ? ['link', 'core', 'clock', 'weather', 'talk'] : ['core', 'talk'];
  if (!seen) localStorage.setItem('jarvis.layout.v1', '1');
  base.forEach(openPane);
}

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

  buildDock();
  defaultLayout();
  tickClock();
  setInterval(refreshLink, 60000);
  wakeStart();

  if (store.role !== 'owner') showAuth();
}

$('#talkBtn').addEventListener('click', liveToggle);
$('#lockBtn').addEventListener('click', () => (isOwner() ? doLogout() : showAuth()));
$('#authForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doLogin($('#authPassword').value);
});
$('#authGuestBtn').addEventListener('click', () => {
  $('#authVeil').hidden = true;
});
$('#notifyBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Brak obslugi powiadomien.');
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Powiadomienia wlaczone.' : 'Powiadomienia odrzucone.', p === 'granted' ? 'ok' : 'bad');
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
