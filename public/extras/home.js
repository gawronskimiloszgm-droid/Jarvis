// Nowy Pulpit: siatka widzetow z prawdziwymi danymi zamiast trzech kart.
//   Teraz gra, Pogoda, Dzis (zadania/przypomnienia/kalendarz), Minutniki,
//   Komputer, E.D.I.T.H., Czas pracy, Szybkie akcje, Ostatnie zdarzenia.
// Kazdy widzet sam sie odswieza i nie wywraca reszty, gdy jego zrodlo milczy.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner, store } = UI;
  const D = () => window.jarvisDesktop;

  const WX = {
    0: 'bezchmurnie', 1: 'przewaznie slonecznie', 2: 'czesciowe zachmurzenie', 3: 'pochmurno', 45: 'mgla', 48: 'mgla',
    51: 'mzawka', 53: 'mzawka', 55: 'mzawka', 61: 'deszcz', 63: 'deszcz', 65: 'silny deszcz', 71: 'snieg', 73: 'snieg',
    75: 'silny snieg', 80: 'przelotny deszcz', 81: 'przelotny deszcz', 82: 'ulewa', 95: 'burza', 96: 'burza z gradem', 99: 'burza',
  };
  const DAY = ['nd', 'pn', 'wt', 'sr', 'cz', 'pt', 'sb'];
  const hhmm = (d) => new Date(d).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const human = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  };
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Widzet = { id, title, glyph, owner, wide, render(box) -> promise, every(ms) }
  const WIDGETS = [];
  function widget(def) {
    WIDGETS.push(def);
  }

  function shell(def) {
    const w = el('section', `w${def.wide ? ' wide' : ''}`);
    w.dataset.w = def.id;
    const head = el('div', 'w-head');
    const t = el('span');
    t.append(el('span', 'gl', def.glyph), document.createTextNode(def.title));
    head.appendChild(t);
    if (def.action) {
      const b = el('button', null, def.action.label);
      b.title = def.action.title || '';
      b.addEventListener('click', def.action.run);
      head.appendChild(b);
    }
    const body = el('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:1';
    w.append(head, body);
    return { w, body };
  }

  // ---------- Teraz gra ----------
  widget({
    id: 'np',
    title: 'Teraz gra',
    glyph: '♫',
    owner: true,
    wide: true,
    events: ['jarvis:now-playing'],
    render(box) {
      box.innerHTML = '';
      const s = UI.nowPlaying || {};
      const ctl = el('div', 'np-ctl');
      const btn = (label, title, fn) => {
        const b = el('button', null, label);
        b.title = title;
        b.addEventListener('click', () => fn().catch((e) => toast(e.message)));
        ctl.appendChild(b);
      };
      const mc = (p, v) => () => UI.musicControl(p, v);
      btn('⏮', 'Poprzedni', mc('wstecz'));
      btn(s.playing ? '⏸' : '▶', s.playing ? 'Pauza' : 'Graj', mc(s.playing ? 'pauza' : 'wznow'));
      btn('⏭', 'Nastepny', mc('dalej'));
      btn('−', 'Ciszej', mc('ciszej'));
      btn('+', 'Glosniej', mc('glosniej'));

      if (s.connected && s.track) {
        const row = el('div', 'np');
        if (s.image) {
          const img = el('img');
          img.src = s.image;
          img.alt = '';
          row.appendChild(img);
        } else row.appendChild(el('div', 'art-ph', '♫'));
        const txt = el('div');
        txt.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
        txt.append(el('div', 'w-mid', s.track), el('div', 'w-dim', `${s.artist}${s.device ? ' · ' + s.device : ''}${s.volume != null ? ' · ' + s.volume + '%' : ''}`));
        const bar = el('div', 'np-bar');
        const fill = el('i');
        fill.style.width = s.durationMs ? `${Math.min(100, (100 * s.progressMs) / s.durationMs)}%` : '0';
        bar.appendChild(fill);
        txt.append(bar, ctl);
        row.appendChild(txt);
        box.appendChild(row);
      } else {
        box.appendChild(el('div', 'w-mid', s.connected ? 'Nic teraz nie gra.' : 'Spotify niepolaczone'));
        box.appendChild(
          el('div', 'w-dim', s.connected ? 'Powiedz np. "puść Metallice" albo uzyj przyciskow.' : 'Przyciski steruja kazdym odtwarzaczem (klawisze multimedialne). Polacz Spotify, zeby widziec utwor i sterowac glosnoscia.')
        );
        box.appendChild(ctl);
        if (!s.connected) {
          const go = el('button', 'btn ghost', 'POLACZ SPOTIFY');
          go.addEventListener('click', () => UI.openWindow('set'));
          box.appendChild(go);
        }
      }
    },
  });

  // ---------- Pogoda ----------
  widget({
    id: 'wx',
    title: 'Pogoda',
    glyph: '☁',
    every: 30 * 60000,
    async render(box) {
      const loc = store.location || { lat: 52.23, lon: 21.01 };
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=4&timezone=auto`
      ).then((x) => x.json());
      box.innerHTML = '';
      const top = el('div', 'w-row');
      top.append(el('div', 'w-big', `${Math.round(r.current.temperature_2m)}°`));
      const d = el('div');
      d.append(el('div', 'w-mid', WX[r.current.weather_code] || ''), el('div', 'w-dim', `${store.location ? 'Twoja pozycja' : 'Warszawa'} · wiatr ${Math.round(r.current.wind_speed_10m)} km/h`));
      top.appendChild(d);
      box.appendChild(top);
      const list = el('div', 'w-list');
      r.daily.time.forEach((day, i) => {
        const it = el('div', 'it');
        const rain = r.daily.precipitation_probability_max?.[i];
        it.append(
          el('span', null, `${i === 0 ? 'dzis' : DAY[new Date(day).getDay()]} · ${WX[r.daily.weather_code[i]] || ''}`),
          el('span', null, `${Math.round(r.daily.temperature_2m_min[i])}° / ${Math.round(r.daily.temperature_2m_max[i])}°${rain != null ? ` · ${rain}%` : ''}`)
        );
        list.appendChild(it);
      });
      box.appendChild(list);
    },
  });

  // ---------- Dzis ----------
  widget({
    id: 'today',
    title: 'Dzis',
    glyph: '☷',
    owner: true,
    every: 60000,
    action: { label: 'ZADANIA →', run: () => UI.openWindow('tasks') },
    async render(box) {
      const [t, r] = await Promise.all([api('/api/todos').catch(() => ({ todos: [] })), api('/api/reminders').catch(() => ({ reminders: [] }))]);
      let events = [];
      if (window.__health?.calendarConnected) events = await api('/api/calendar/events?limit=5').catch(() => []);
      box.innerHTML = '';
      const list = el('div', 'w-list');
      const today = new Date().toDateString();
      events
        .filter((e) => e.start && new Date(e.start).toDateString() === today)
        .slice(0, 4)
        .forEach((e) => {
          const it = el('div', 'it');
          it.append(el('span', null, `📅 ${e.title}`), el('span', null, e.allDay ? 'caly dzien' : hhmm(e.start)));
          list.appendChild(it);
        });
      (r.reminders || [])
        .filter((x) => !x.sent && new Date(x.dueAt).getTime() > Date.now() - 3600000)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
        .slice(0, 3)
        .forEach((x) => {
          const it = el('div', 'it');
          const due = new Date(x.dueAt);
          it.append(el('span', null, `⏰ ${x.text}`), el('span', null, due.toDateString() === today ? hhmm(due) : due.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })));
          list.appendChild(it);
        });
      const open = (t.todos || []).filter((x) => !x.done);
      open.slice(0, 4).forEach((x) => {
        const it = el('div', 'it');
        it.append(el('span', null, `☐ ${x.text}`), el('span', null, ''));
        list.appendChild(it);
      });
      if (!list.children.length) box.appendChild(el('div', 'w-empty', 'Czysto - brak zadan, przypomnien i wydarzen.'));
      else box.appendChild(list);
      box.appendChild(el('div', 'w-dim', `${open.length} otwartych zadan`));
    },
  });

  // ---------- Minutniki ----------
  widget({
    id: 'timers',
    title: 'Minutniki i skupienie',
    glyph: '◷',
    every: 1000,
    events: ['jarvis:timers'],
    render(box) {
      const T = UI.timers;
      if (!T) return;
      // Przy co-sekundowym odswiezaniu nie przebudowujemy formularza (traciloby fokus).
      if (!box._built) {
        box._built = true;
        box.innerHTML = '';
        box._list = el('div', 'w-list');
        const row = el('div', 'w-row');
        [[5, '5 min'], [10, '10 min'], [25, '25 min']].forEach(([m, l]) => {
          const b = el('button', 'btn ghost', l);
          b.addEventListener('click', () => T.startTimer(m));
          row.appendChild(b);
        });
        const f = el('button', 'btn primary', 'SKUPIENIE 25');
        f.addEventListener('click', () => T.startFocus(25));
        row.appendChild(f);
        box.append(box._list, row);
      }
      const list = box._list;
      list.innerHTML = '';
      const items = T.list();
      if (!items.length) list.appendChild(el('div', 'w-empty', 'Brak aktywnych. Powiedz: "minutnik 10 minut na herbate" albo "tryb skupienia".'));
      items.forEach((t) => {
        const r = el('div', `tm${t.kind === 'focus' ? ' focus' : t.kind === 'break' ? ' brk' : ''}`);
        const x = el('button', null, '✕');
        x.title = t.kind === 'timer' ? 'Usun' : 'Zakoncz skupienie';
        x.addEventListener('click', () => (t.kind === 'timer' ? T.remove(t.id) : T.startFocus(0)));
        r.append(el('span', null, t.name || 'Minutnik'), el('b', null, T.fmt(t.end - Date.now())), x);
        list.appendChild(r);
      });
    },
  });

  // ---------- Komputer ----------
  widget({
    id: 'pc',
    title: 'Komputer',
    glyph: '■',
    owner: true,
    every: 20000,
    action: { label: 'WYKRESY →', run: () => UI.openWindow('machine') },
    async render(box) {
      const d = await api('/api/telemetry/history');
      box.innerHTML = '';
      const m = d.machines.find((x) => x.online) || d.machines[0];
      if (!m || !m.samples.length) {
        box.appendChild(el('div', 'w-empty', 'Brak odczytow. Aplikacja desktopowa wysyla je sama co 30 s.'));
        return;
      }
      const last = m.samples[m.samples.length - 1];
      box.appendChild(el('div', 'w-dim', `${m.machine}${m.online ? '' : ' (offline)'}`));
      [['Procesor', last.cpu, d.thresholds.cpu], ['Pamiec', last.ram, d.thresholds.ram], ['Dysk', last.disk, d.thresholds.disk]].forEach(([label, v, warn]) => {
        if (v == null) return;
        const it = el('div', 'it');
        it.style.cssText = 'display:flex;justify-content:space-between;font-size:12px';
        it.append(el('span', null, label), el('span', null, `${v}%`));
        const bar = el('div', `w-meter${v >= warn ? ' hot' : ''}`);
        const fill = el('i');
        fill.style.width = `${v}%`;
        bar.appendChild(fill);
        box.append(it, bar);
      });
    },
  });

  // ---------- E.D.I.T.H. ----------
  widget({
    id: 'edith',
    title: 'E.D.I.T.H.',
    glyph: '⛨',
    owner: true,
    every: 120000,
    action: { label: 'OTWORZ →', run: () => window.Edith?.open() },
    async render(box) {
      const s = await api('/api/edith/state');
      box.innerHTML = '';
      const day = Date.now() - 86400000;
      const recent = (s.alerts || []).filter((a) => a.at >= day && a.level !== 'report');
      const big = el('div', 'w-mid', recent.length ? `${recent.length} zdarzen w ciagu doby` : 'Spokojnie - brak alarmow');
      big.style.color = recent.some((a) => a.level === 'block') ? 'var(--red)' : recent.length ? 'var(--amber)' : 'var(--good)';
      box.appendChild(big);
      const last = s.scans?.[0];
      box.appendChild(el('div', 'w-dim', last ? `Ostatni skan: ${new Date(last.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}` : 'Brak skanu z komputera.'));
      const risks = (last?.riskFindings || []).filter((r) => r.level === 'warn');
      if (risks.length) box.appendChild(el('div', 'w-dim', `Do sprawdzenia: ${risks.length} (zakladka Komputer w E.D.I.T.H.)`));
      const list = el('div', 'w-list');
      recent.slice(0, 2).forEach((a) => list.appendChild(el('div', null, `• ${String(a.reason).slice(0, 90)}`)));
      box.appendChild(list);
    },
  });

  // ---------- Czas pracy ----------
  widget({
    id: 'work',
    title: 'Czas pracy dzis',
    glyph: '⌛',
    owner: true,
    every: 5 * 60000,
    action: { label: 'RAPORT →', run: () => UI.openWindow('worktime') },
    async render(box) {
      let apps = null;
      if (D()) {
        const r = await D().runAction('czas-pracy', { dni: 1 }).catch(() => null);
        if (r?.ok) apps = Object.fromEntries((r.dzis?.top || []).map((a) => [a.name, a.sec]));
      }
      if (!apps) apps = (await api('/api/worktime').catch(() => ({ byDay: {} }))).byDay?.[todayKey()] || {};
      box.innerHTML = '';
      const entries = Object.entries(apps).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((s, [, v]) => s + v, 0);
      if (!total) {
        box.appendChild(el('div', 'w-empty', 'Jeszcze nic dzis nie zmierzono (mierzy aplikacja desktopowa).'));
        return;
      }
      box.appendChild(el('div', 'w-big', human(total)));
      const list = el('div', 'w-list');
      entries.slice(0, 4).forEach(([n, s]) => {
        const it = el('div', 'it');
        it.append(el('span', null, n), el('span', null, human(s)));
        list.appendChild(it);
      });
      box.appendChild(list);
    },
  });

  // ---------- Szybkie akcje ----------
  const QKEY = 'jarvis.quick';
  const QDEFAULT = [
    { label: 'Notatnik', cmd: 'otworz-aplikacje | notepad' },
    { label: 'Spotify', cmd: 'otworz-spotify' },
    { label: 'Analizuj ekran', cmd: 'analizuj-ekran' },
    { label: 'Zablokuj PC', cmd: 'zablokuj-ekran' },
    { label: 'Skupienie 25', cmd: 'skupienie | 25' },
    { label: 'Profil: praca', cmd: 'profil | praca' },
  ];
  function quick() {
    try {
      const v = JSON.parse(localStorage.getItem(QKEY) || 'null');
      return Array.isArray(v) ? v : QDEFAULT;
    } catch {
      return QDEFAULT;
    }
  }
  function saveQuick(list) {
    try {
      localStorage.setItem(QKEY, JSON.stringify(list));
    } catch {
      /* zostaje do zamkniecia karty */
    }
  }
  function runCmd(cmd) {
    const [name, raw] = String(cmd).split('|').map((s) => s.trim());
    return UI.runDeviceAction(name, raw ? UI.paramsForAction(name, raw) : undefined);
  }
  UI.runQuickCommand = runCmd;

  let quickEdit = false;
  widget({
    id: 'quick',
    title: 'Szybkie akcje',
    glyph: '⚡',
    owner: true,
    action: {
      label: 'EDYTUJ',
      run: () => {
        quickEdit = !quickEdit;
        renderOne('quick');
      },
    },
    render(box) {
      box.innerHTML = '';
      const list = quick();
      const grid = el('div', 'w-actions');
      list.forEach((q, i) => {
        const b = el('button', quickEdit ? 'btn danger' : 'btn', quickEdit ? `✕ ${q.label}` : q.label);
        b.title = q.cmd;
        b.addEventListener('click', () => {
          if (quickEdit) {
            list.splice(i, 1);
            saveQuick(list);
            renderOne('quick');
          } else runCmd(q.cmd);
        });
        grid.appendChild(b);
      });
      box.appendChild(grid);
      if (quickEdit) {
        const f = el('form', 'field');
        f.style.flexWrap = 'wrap';
        const label = el('input', 'inp');
        label.placeholder = 'napis, np. Chrome';
        const cmd = el('input', 'inp');
        cmd.placeholder = 'akcja | parametr, np. otworz-aplikacje | chrome';
        const add = el('button', 'btn primary', 'DODAJ');
        add.type = 'submit';
        f.append(label, cmd, add);
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!label.value.trim() || !cmd.value.trim()) return;
          list.push({ label: label.value.trim().slice(0, 24), cmd: cmd.value.trim().slice(0, 200) });
          saveQuick(list);
          renderOne('quick');
        });
        const reset = el('button', 'btn ghost', 'PRZYWROC DOMYSLNE');
        reset.type = 'button';
        reset.addEventListener('click', () => {
          saveQuick(QDEFAULT.slice());
          renderOne('quick');
        });
        box.append(f, reset);
      }
    },
  });

  // ---------- Zdarzenia ----------
  widget({
    id: 'events',
    title: 'Ostatnie zdarzenia',
    glyph: '≡',
    every: 15000,
    action: { label: 'LOGI →', run: () => UI.openWindow('logs') },
    render(box) {
      box.innerHTML = '';
      const ev = (UI.events?.() || []).slice(0, 6);
      if (!ev.length) {
        box.appendChild(el('div', 'w-empty', 'Brak zdarzen w tej sesji.'));
        return;
      }
      const list = el('div', 'w-list');
      ev.forEach((e) => {
        const it = el('div', 'it');
        it.append(el('span', null, `${e.source}: ${String(e.message).slice(0, 70)}`), el('span', null, hhmm(e.at)));
        list.appendChild(it);
      });
      box.appendChild(list);
    },
  });

  // ---------- uklad pulpitu: ukrywanie, kolejnosc, rozmiar ----------
  const LAYOUT_KEY = 'jarvis.homeLayout';
  function layout() {
    try {
      const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
      return { hidden: Array.isArray(v.hidden) ? v.hidden : [], order: Array.isArray(v.order) ? v.order : [], size: v.size && typeof v.size === 'object' ? v.size : {} };
    } catch {
      return { hidden: [], order: [], size: {} };
    }
  }
  function saveLayout(l) {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      /* uklad do zamkniecia karty */
    }
  }
  let editMode = false;

  function orderedWidgets() {
    const l = layout();
    const list = WIDGETS.filter((w) => !w.owner || isOwner());
    const pos = (id) => {
      const i = l.order.indexOf(id);
      return i < 0 ? 1000 + WIDGETS.findIndex((w) => w.id === id) : i;
    };
    return list.sort((x, y) => pos(x.id) - pos(y.id));
  }

  // Dodatki rejestruja wlasne widzety: UI.addHomeWidget({ id, title, glyph, owner, wide, every, render(box) }).
  UI.addHomeWidget = (def) => {
    if (WIDGETS.some((w) => w.id === def.id)) return;
    WIDGETS.push(def);
    (def.events || []).forEach((ev) => window.addEventListener(ev, () => renderOne(def.id)));
    if (grid?.parentElement) buildGrid(grid.parentElement);
  };
  UI.homeWidgetDef = (id) => WIDGETS.find((w) => w.id === id);
  UI.homeWidgetList = () => WIDGETS.map((w) => ({ id: w.id, title: w.title, owner: Boolean(w.owner) }));
  UI.homeLayout = { get: layout, set: (l) => { saveLayout(l); if (grid?.parentElement) buildGrid(grid.parentElement); }, edit: () => { editMode = !editMode; if (grid?.parentElement) buildGrid(grid.parentElement); return editMode; } };

  // ---------- silnik siatki ----------
  let grid = null;
  const boxes = new Map();
  const timers = [];

  async function renderOne(id) {
    const def = WIDGETS.find((w) => w.id === id);
    const box = boxes.get(id);
    if (!def || !box || !document.body.contains(box)) return;
    try {
      await def.render(box);
    } catch (e) {
      box.innerHTML = '';
      box.appendChild(el('div', 'w-empty', 'Brak danych: ' + (e.message || 'blad')));
    }
  }

  function buildGrid(body) {
    body.innerHTML = '';
    timers.splice(0).forEach(clearInterval);
    boxes.clear();
    const l = layout();

    const bar = el('div', 'home-bar');
    const edit = el('button', editMode ? 'btn primary' : 'btn ghost', editMode ? 'GOTOWE' : '✎ UKLAD');
    edit.title = 'Ukryj, przestaw (przeciagnij) i zmien rozmiar widzetow';
    edit.addEventListener('click', () => {
      editMode = !editMode;
      buildGrid(body);
    });
    bar.appendChild(edit);
    if (editMode) {
      const reset = el('button', 'btn ghost', 'RESETUJ UKLAD');
      reset.addEventListener('click', () => {
        saveLayout({ hidden: [], order: [], size: {} });
        buildGrid(body);
      });
      bar.appendChild(reset);
      bar.appendChild(el('span', 'w-dim', 'Przeciagnij karte, zeby ja przestawic. Przyciski na karcie: ukryj, rozmiar.'));
    }
    body.appendChild(bar);

    grid = el('div', 'home-grid');
    grid._owner = isOwner();
    const all = orderedWidgets();
    const visible = all.filter((w) => editMode || !l.hidden.includes(w.id));
    visible.forEach((def) => {
      const forced = l.size[def.id];
      const wide = forced ? forced === 'wide' : Boolean(def.wide);
      const { w, body: b } = shell({ ...def, wide });
      w.dataset.wid = def.id;
      boxes.set(def.id, b);
      if (l.hidden.includes(def.id)) w.classList.add('w-hidden');
      if (editMode) {
        w.draggable = true;
        w.classList.add('w-edit');
        const tools = el('div', 'w-tools');
        const hide = el('button', null, l.hidden.includes(def.id) ? '👁 POKAZ' : '✕ UKRYJ');
        hide.addEventListener('click', () => {
          const cur = layout();
          cur.hidden = cur.hidden.includes(def.id) ? cur.hidden.filter((x) => x !== def.id) : [...cur.hidden, def.id];
          saveLayout(cur);
          buildGrid(body);
        });
        const size = el('button', null, wide ? '⇲ MALY' : '⇱ DUZY');
        size.addEventListener('click', () => {
          const cur = layout();
          cur.size[def.id] = wide ? 'small' : 'wide';
          saveLayout(cur);
          buildGrid(body);
        });
        tools.append(hide, size);
        w.appendChild(tools);
        w.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', def.id);
          w.classList.add('dragging');
        });
        w.addEventListener('dragend', () => w.classList.remove('dragging'));
        w.addEventListener('dragover', (e) => e.preventDefault());
        w.addEventListener('drop', (e) => {
          e.preventDefault();
          const from = e.dataTransfer.getData('text/plain');
          if (!from || from === def.id) return;
          const ids = orderedWidgets().map((x) => x.id);
          ids.splice(ids.indexOf(from), 1);
          ids.splice(ids.indexOf(def.id), 0, from);
          const cur = layout();
          cur.order = ids;
          saveLayout(cur);
          buildGrid(body);
        });
      }
      grid.appendChild(w);
      renderOne(def.id);
      if (def.every) {
        timers.push(
          setInterval(() => {
            if (document.visibilityState === 'visible' && grid && document.body.contains(grid) && !grid.closest('[hidden]')) renderOne(def.id);
          }, def.every)
        );
      }
    });
    body.appendChild(grid);
  }

  WIDGETS.forEach((def) => (def.events || []).forEach((ev) => window.addEventListener(ev, () => renderOne(def.id))));

  const homeDef = {
    title: 'PRZEGLAD',
    glyph: '◈',
    wide: true,
    build: buildGrid,
    refresh() {
      // Po zalogowaniu/wylogowaniu zmienia sie zestaw widzetow (czesc jest tylko dla wlasciciela).
      if (grid && grid._owner !== isOwner() && grid.parentElement) return buildGrid(grid.parentElement);
      if (grid && !editMode) WIDGETS.filter((w) => !w.every || w.every > 5000).forEach((w) => renderOne(w.id));
    },
  };
  UI.extend('dash', { home: homeDef });
  UI.setPanels('dash', ['home']);
})();
