// Kolejne moduly: Holo-stol (swobodny uklad widzetow w 3D), Planer tygodnia, Tlumacz,
// Zegary swiata, Statystyki oraz Centrum pomocy (komendy, skroty, "Co nowego").
// Globalnie: Ctrl+/ otwiera pomoc, "g" + litera skacze do modulu (styl vim).
(function () {
  const UI = window.JarvisUI;
  const T = window.Toolkit;
  if (!UI || !UI.life) return;
  const { el, api, toast, isOwner } = UI;
  const Life = UI.life;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const lsGet = (k, d) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v == null ? d : v;
    } catch {
      return d;
    }
  };
  const lsSet = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* brak pamieci */
    }
  };
  const mod = (id, title, sub, icon, group, panels) => UI.register({ id, title, sub, icon, owner: true, group, panels });
  const guard = (body) => {
    if (isOwner()) return false;
    body.textContent = 'Ten modul jest dostepny tylko dla wlasciciela.';
    return true;
  };
  const redrawOn = (colls, fn, body) => {
    const h = (e) => {
      if (!document.body.contains(body)) return window.removeEventListener('jarvis:life', h);
      if (!e.detail || colls.includes(e.detail.coll)) fn();
    };
    window.addEventListener('jarvis:life', h);
  };

  // ================= HOLO-STOL =================
  // Widzety Pulpitu jako karty swobodnie rozmieszczone w przestrzeni: przeciaganie, glebia (kolko),
  // uklad zapisywany lokalnie. Karty rysuja sie tymi samymi funkcjami co Pulpit.
  const table = {
    title: 'HOLO-STOL',
    glyph: '◇',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const SAVE = 'jarvis.holoTable';
      let st = lsGet(SAVE, { cards: {} });
      const bar = el('div', 'field');
      bar.style.cssText = 'flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center';
      const sel = el('select', 'inp');
      sel.appendChild(Object.assign(el('option', null, '＋ dodaj widzet...'), { value: '' }));
      (UI.homeWidgetList ? UI.homeWidgetList() : []).forEach((w) => sel.appendChild(Object.assign(el('option', null, w.title), { value: w.id })));
      const reset = el('button', 'btn ghost', 'WYCZYSC STOL');
      bar.append(sel, reset, el('span', 'w-dim', 'Przeciagnij karte, kolko myszy = blizej/dalej, dwuklik = usun.'));
      const stage = el('div', 'holo-table');
      body.append(bar, stage);

      const cards = new Map();
      const place = (id) => {
        const c = st.cards[id];
        const node = cards.get(id);
        if (!c || !node) return;
        node.style.left = `${c.x}px`;
        node.style.top = `${c.y}px`;
        node.style.setProperty('--z', c.z);
        node.style.zIndex = String(10 + Math.round(c.z * 10));
      };
      function add(id) {
        const def = UI.homeWidgetDef && UI.homeWidgetDef(id);
        if (!def || cards.has(id)) return;
        if (!st.cards[id]) st.cards[id] = { x: 20 + (cards.size % 4) * 230, y: 20 + Math.floor(cards.size / 4) * 190, z: 1 };
        const node = el('section', 'ht-card');
        const head = el('div', 'ht-head');
        head.append(el('span', null, `${def.glyph || ''} ${def.title}`));
        const box = el('div', 'ht-body');
        node.append(head, box);
        stage.appendChild(node);
        cards.set(id, node);
        place(id);
        Promise.resolve(def.render(box)).catch(() => (box.textContent = 'Brak danych.'));
        if (def.every) {
          const iv = setInterval(() => {
            if (!document.body.contains(node)) return clearInterval(iv);
            if (document.visibilityState === 'visible') Promise.resolve(def.render(box)).catch(() => {});
          }, Math.max(def.every, 5000));
        }
        let drag = null;
        head.addEventListener('pointerdown', (e) => {
          drag = { x: e.clientX - st.cards[id].x, y: e.clientY - st.cards[id].y };
          head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', (e) => {
          if (!drag) return;
          st.cards[id].x = Math.max(0, e.clientX - drag.x);
          st.cards[id].y = Math.max(0, e.clientY - drag.y);
          place(id);
        });
        head.addEventListener('pointerup', () => {
          drag = null;
          lsSet(SAVE, st);
        });
        node.addEventListener('wheel', (e) => {
          e.preventDefault();
          st.cards[id].z = Math.max(0.4, Math.min(2.2, st.cards[id].z + (e.deltaY < 0 ? 0.1 : -0.1)));
          place(id);
          lsSet(SAVE, st);
        }, { passive: false });
        head.addEventListener('dblclick', () => {
          node.remove();
          cards.delete(id);
          delete st.cards[id];
          lsSet(SAVE, st);
        });
      }
      sel.addEventListener('change', () => {
        if (sel.value) add(sel.value);
        lsSet(SAVE, st);
        sel.value = '';
      });
      reset.addEventListener('click', () => {
        st = { cards: {} };
        lsSet(SAVE, st);
        stage.innerHTML = '';
        cards.clear();
      });
      Object.keys(st.cards).forEach(add);
      if (!cards.size) ['orbit', 'wx', 'world', 'progress'].forEach((id) => add(id));
      // Lekki parallax calego stolu za kursorem.
      stage.addEventListener('pointermove', (e) => {
        const r = stage.getBoundingClientRect();
        stage.style.setProperty('--rx', `${(((e.clientY - r.top) / r.height - 0.5) * -6).toFixed(2)}deg`);
        stage.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(2)}deg`);
      });
    },
  };

  // ================= PLANER TYGODNIA =================
  const startOfWeek = (d) => {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return UI.dayKey(x);
  };
  const planner = {
    title: 'PLANER TYGODNIA',
    glyph: '▦',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      let week = startOfWeek(new Date());
      const top = el('div', 'field');
      top.style.cssText = 'gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px';
      const prev = el('button', 'btn ghost', '←');
      const next = el('button', 'btn ghost', '→');
      const now = el('button', 'btn ghost', 'TEN TYDZIEN');
      const label = el('b');
      top.append(prev, label, next, now);
      const grid = el('div', 'plan-grid');
      body.append(top, grid);
      const NAMES = ['PN', 'WT', 'SR', 'CZ', 'PT', 'SB', 'ND'];
      async function draw() {
        const items = await Life.list('planner', true).catch(() => []);
        const end = UI.addDays(week, 6);
        label.textContent = `${week} → ${end}`;
        grid.innerHTML = '';
        for (let i = 0; i < 7; i++) {
          const day = UI.addDays(week, i);
          const col = el('div', `plan-col${day === UI.dayKey(new Date()) ? ' today' : ''}`);
          col.appendChild(el('div', 'plan-head', `${NAMES[i]} ${day.slice(8)}.${day.slice(5, 7)}`));
          items.filter((x) => x.day === day).sort((a, b) => (a.time || '99').localeCompare(b.time || '99')).forEach((it) => {
            const row = el('div', `plan-item${it.done ? ' done' : ''}`);
            const ck = el('input');
            ck.type = 'checkbox';
            ck.checked = it.done;
            ck.addEventListener('change', async () => {
              await Life.patch('planner', it.id, { done: ck.checked });
              draw();
            });
            const txt = el('span', null, `${it.time ? it.time + ' ' : ''}${it.text}`);
            const x = el('button', 'row-x', '×');
            x.addEventListener('click', async () => {
              await Life.del('planner', it.id);
              draw();
            });
            row.append(ck, txt, x);
            col.appendChild(row);
          });
          const inp = el('input', 'inp');
          inp.placeholder = '+ (godz. opcjonalnie: 14:30 spotkanie)';
          inp.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter' || !inp.value.trim()) return;
            const m = inp.value.trim().match(/^(\d{1,2}[:.]\d{2})\s+(.+)$/);
            const time = m ? m[1].replace('.', ':').padStart(5, '0') : '';
            await Life.add('planner', { text: m ? m[2] : inp.value.trim(), day, time }).catch((err) => toast(err.message));
            draw();
          });
          col.appendChild(inp);
          grid.appendChild(col);
        }
      }
      prev.addEventListener('click', () => { week = UI.addDays(week, -7); draw(); });
      next.addEventListener('click', () => { week = UI.addDays(week, 7); draw(); });
      now.addEventListener('click', () => { week = startOfWeek(new Date()); draw(); });
      redrawOn(['planner'], draw, body);
      draw();
    },
  };

  // ================= TLUMACZ =================
  const LANGS = ['angielski', 'niemiecki', 'francuski', 'hiszpanski', 'wloski', 'portugalski', 'rosyjski', 'ukrainski', 'czeski', 'japonski', 'chinski', 'polski'];
  const translate = {
    title: 'TLUMACZ (AI)',
    glyph: '⇄',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const inp = el('textarea', 'inp');
      inp.rows = 4;
      inp.placeholder = 'Tekst do przetlumaczenia...';
      const to = el('select', 'inp');
      LANGS.forEach((l) => to.appendChild(Object.assign(el('option', null, l), { value: l })));
      to.value = lsGet('jarvis.trLang', 'angielski');
      const go = el('button', 'btn primary', 'TLUMACZ');
      const out = el('div', 'vout');
      const copy = el('button', 'btn ghost', 'KOPIUJ');
      const speak = el('button', 'btn ghost', 'ODCZYTAJ');
      const row = el('div', 'field');
      row.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0';
      row.append(to, go, copy, speak);
      const histBox = el('div', 'w-list');
      body.append(inp, row, out, el('div', 'sub', 'HISTORIA'), histBox);
      const drawHist = () => {
        histBox.innerHTML = '';
        const h = lsGet('jarvis.trHist', []);
        if (!h.length) histBox.appendChild(el('div', 'w-empty', 'Brak historii.'));
        h.forEach((x) => {
          const r = el('button', 'btn ghost', `${x.to}: ${x.src.slice(0, 40)} → ${x.out.slice(0, 40)}`);
          r.style.textAlign = 'left';
          r.addEventListener('click', () => { inp.value = x.src; to.value = x.to; out.textContent = x.out; });
          histBox.appendChild(r);
        });
      };
      go.addEventListener('click', async () => {
        const text = inp.value.trim();
        if (!text) return;
        out.textContent = '...';
        lsSet('jarvis.trLang', to.value);
        try {
          const r = await api('/api/translate', json('POST', { text, to: to.value }));
          out.textContent = r.text;
          const h = [{ src: text, out: r.text, to: to.value }, ...lsGet('jarvis.trHist', [])].slice(0, 20);
          lsSet('jarvis.trHist', h);
          drawHist();
          UI.logLife && UI.logLife('note', `Tlumaczenie (${to.value}): ${text.slice(0, 80)}`);
        } catch (e) {
          out.textContent = e.message || 'Blad tlumaczenia.';
        }
      });
      copy.addEventListener('click', () => navigator.clipboard?.writeText(out.textContent).then(() => toast('Skopiowano.')));
      speak.addEventListener('click', () => {
        const u = new SpeechSynthesisUtterance(out.textContent);
        u.lang = { angielski: 'en', niemiecki: 'de', francuski: 'fr', hiszpanski: 'es', wloski: 'it', portugalski: 'pt', rosyjski: 'ru', ukrainski: 'uk', czeski: 'cs', japonski: 'ja', chinski: 'zh', polski: 'pl' }[to.value] || 'en';
        speechSynthesis.speak(u);
      });
      drawHist();
      try {
        const pre = sessionStorage.getItem('jarvis.trText');
        if (pre) {
          sessionStorage.removeItem('jarvis.trText');
          inp.value = pre;
          go.click();
        }
      } catch {
        /* brak sessionStorage */
      }
    },
  };

  // ================= ZEGARY SWIATA =================
  const ZONES = [['Warszawa', 'Europe/Warsaw'], ['Londyn', 'Europe/London'], ['Nowy Jork', 'America/New_York'], ['Los Angeles', 'America/Los_Angeles'], ['Tokio', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'], ['Dubaj', 'Asia/Dubai'], ['Pekin', 'Asia/Shanghai'], ['Sao Paulo', 'America/Sao_Paulo'], ['Kair', 'Africa/Cairo'], ['Reykjavik', 'Atlantic/Reykjavik'], ['Singapur', 'Asia/Singapore']];
  const clocks = {
    title: 'ZEGARY SWIATA',
    glyph: '◷',
    wide: true,
    build(body) {
      body.innerHTML = '';
      let active = lsGet('jarvis.zones', ['Europe/Warsaw', 'America/New_York', 'Asia/Tokyo']);
      const add = el('select', 'inp');
      add.appendChild(Object.assign(el('option', null, '＋ dodaj miasto...'), { value: '' }));
      ZONES.forEach(([n, z]) => add.appendChild(Object.assign(el('option', null, n), { value: z })));
      const grid = el('div', 'clock-grid');
      body.append(add, grid);
      add.addEventListener('change', () => {
        if (add.value && !active.includes(add.value)) active.push(add.value);
        lsSet('jarvis.zones', active);
        add.value = '';
        draw();
      });
      function parts(zone) {
        const f = new Intl.DateTimeFormat('pl-PL', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short', day: 'numeric', month: 'short' });
        const o = Object.fromEntries(f.formatToParts(new Date()).map((p) => [p.type, p.value]));
        return { h: Number(o.hour) % 24, m: Number(o.minute), s: Number(o.second), label: `${o.weekday} ${o.day} ${o.month}`, time: `${o.hour}:${o.minute}` };
      }
      function draw() {
        grid.innerHTML = '';
        active.forEach((z) => {
          const name = (ZONES.find((x) => x[1] === z) || [z])[0];
          const card = el('div', 'clock-card');
          const cv = el('canvas');
          cv.width = 120;
          cv.height = 120;
          const lab = el('div', 'clock-name', name);
          const tm = el('div', 'clock-time');
          const dt = el('div', 'w-dim');
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', () => {
            active = active.filter((a) => a !== z);
            lsSet('jarvis.zones', active);
            draw();
          });
          card.append(x, cv, lab, tm, dt);
          grid.appendChild(card);
          card._z = z;
          card._cv = cv;
          card._tm = tm;
          card._dt = dt;
        });
      }
      const tick = () => {
        if (!document.body.contains(grid)) return;
        const col = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#33e0ff';
        grid.querySelectorAll('.clock-card').forEach((c) => {
          const p = parts(c._z);
          c._tm.textContent = `${p.time}:${String(p.s).padStart(2, '0')}`;
          c._dt.textContent = p.label;
          const g = c._cv.getContext('2d');
          g.clearRect(0, 0, 120, 120);
          g.strokeStyle = col;
          g.globalAlpha = 0.35;
          g.lineWidth = 2;
          g.beginPath(); g.arc(60, 60, 54, 0, 6.283); g.stroke();
          g.globalAlpha = 1;
          const hand = (ang, len, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(60, 60); g.lineTo(60 + Math.sin(ang) * len, 60 - Math.cos(ang) * len); g.stroke(); };
          hand(((p.h % 12) + p.m / 60) * (Math.PI / 6), 30, 3);
          hand((p.m + p.s / 60) * (Math.PI / 30), 44, 2);
          g.strokeStyle = '#ff6b6b';
          hand(p.s * (Math.PI / 30), 48, 1);
        });
        requestAnimationFrame(() => setTimeout(tick, 1000));
      };
      draw();
      tick();
    },
  };

  // ================= STATYSTYKI =================
  const stats = {
    title: 'STATYSTYKI',
    glyph: '▤',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '<div class="w-dim">Liczenie...</div>';
      Promise.all([api('/api/life/stats/all'), api('/api/memory').catch(() => ({})), api('/api/todos').catch(() => ({})), api('/api/expenses').catch(() => ({}))]).then(([s, mem, td, ex]) => {
        body.innerHTML = '';
        const days = Math.max(1, Math.round((Date.now() - s.firstAt) / 86400000));
        const big = [
          ['DNI Z JARVISEM', days],
          ['FAKTOW W PAMIECI', (mem.facts || []).length],
          ['OTWARTE ZADANIA', (td.todos || []).filter((t) => !t.done).length],
          ['WPISOW W DZIENNIKU', s.counts.journal],
          ['NAJDLUZSZA SERIA NAWYKU', `${s.bestStreak} dni`],
          ['SREDNI NASTROJ', s.moodAvg ? `${s.moodAvg}/5` : '-'],
          ['WYPITA WODA', `${s.water} szkl.`],
          ['WYDATKI (30 DNI)', ex.summary ? `${Math.round(ex.summary.total)} zl` : '-'],
        ];
        const g = el('div', 'stat-grid');
        big.forEach(([k, v]) => {
          const c = el('div', 'stat-card');
          c.append(el('div', 'stat-v', String(v)), el('div', 'w-dim', k));
          g.appendChild(c);
        });
        body.appendChild(g);
        body.appendChild(el('div', 'sub', 'ZAWARTOSC MODULOW'));
        const bars = el('div', 'stat-bars');
        const labels = { shopping: 'zakupy', habits: 'nawyki', goals: 'cele', kanban: 'tablica', journal: 'dziennik', bookmarks: 'zakladki', flashcards: 'fiszki', quicknotes: 'notatki', gratitude: 'wdziecznosc', countdowns: 'odliczania', birthdays: 'urodziny', recurring: 'cykliczne', planner: 'planer' };
        const mx = Math.max(1, ...Object.values(s.counts));
        Object.entries(s.counts).forEach(([k, v]) => {
          const r = el('div', 'stat-bar');
          const fill = el('i');
          fill.style.width = `${Math.max(2, (v / mx) * 100)}%`;
          r.append(el('span', null, labels[k] || k), el('div', 'stat-track'), el('b', null, String(v)));
          r.children[1].appendChild(fill);
          bars.appendChild(r);
        });
        body.appendChild(bars);
      }).catch((e) => (body.textContent = e.message || 'Blad.'));
    },
  };

  // ================= CENTRUM POMOCY =================
  const CHANGES = [
    ['0.6.0', 'Nocna rozbudowa', ['Hologram: 6 stylow sceny, lewitacja, paralaksa, smuga kursora, fale, pochylanie kart', 'Podglad 3D: tryb holo, skaner, wymiary, ciecie, widoki, PNG', '50 widzetow Pulpitu i wlasny uklad (przeciaganie, ukrywanie, rozmiar)', 'Dziennik, Zakupy, Nawyki, Cele, Tablica, Zakladki, Fiszki, Szybkie notatki, Planer', 'Narzedzia: kalkulator, konwertery, QR, hasla, JSON, regex, kolory i inne', 'Paleta: obliczenia, szybkie dodawanie, skoki do modulow, historia', 'Glos i czat: 13 nowych narzedzi i znacznikow', 'Holo-stol, Tlumacz, Zegary swiata, Statystyki, Centrum pomocy']],
    ['0.5.0', 'Dzwiek i automatyzacja', ['Slowo "Jarvis" offline, dzwieki HUD, wlasny glos lokalny', 'Obecnosc, tryb gry, profile automatyczne, nauka przez pokaz']],
  ];
  const COMMANDS = [
    ['= 2+2*3', 'kalkulator wprost w palecie (Ctrl+K)'], ['5 kg na lb', 'przeliczenie jednostek'], ['100 eur na pln', 'kurs walut'],
    ['kostka 20 / moneta / losuj a, b, c', 'losowania'], ['haslo 24 / uuid / hash tekst', 'generatory'], ['ile do piatku / za 30 dni', 'daty'],
    ['zadanie ... / notatka ... / dziennik ...', 'szybkie dodawanie'], ['zakupy mleko, chleb', 'lista zakupow'], ['wydatek 12 kawa', 'wydatek'],
    ['woda +1 / nastroj 4 / nawyk bieganie', 'rekord dnia'], ['g dziennik', 'skok do modulu'], ['holo off', 'tryb hologramu'], ['historia', 'ostatnie polecenia'],
    ['"dopisz mleko do zakupow"', 'glosem: zakupy'], ['"wypilem szklanke wody"', 'glosem: woda'], ['"policz 15 procent z 240"', 'glosem: kalkulator'], ['"rzuc kostka"', 'glosem: losowanie'],
    ['"odhacz bieganie"', 'glosem: nawyk'], ['"zapisz w dzienniku..."', 'glosem: dziennik'],
  ];
  const SHORTCUTS = [
    ['Ctrl+K', 'paleta polecen'], ['Ctrl+/', 'ta pomoc'], ['Alt+1..9', 'kolejne moduly z menu'], ['g d', 'Pulpit'], ['g z', 'Zadania'], ['g n', 'Notatki'], ['g j', 'Dziennik'],
    ['g k', 'Zakupy'], ['g w', 'Nawyki'], ['g t', 'Tablica'], ['g p', 'Planer'], ['g s', 'Statystyki'], ['g h', 'Pomoc'], ['Ctrl+Alt+S', 'zaznacz fragment ekranu (desktop)'], ['Ctrl+Alt+J', 'nakladka HUD (desktop)'], ['Ctrl+Alt+N', 'szybka notatka (desktop)'],
  ];
  const help = {
    title: 'CENTRUM POMOCY',
    glyph: '?',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const q = el('input', 'inp');
      q.placeholder = 'Szukaj komendy, skrotu lub zmiany...';
      const out = el('div', 'help-out');
      body.append(q, out);
      const draw = () => {
        const f = UI.deaccent(q.value.trim().toLowerCase());
        const match = (s) => !f || UI.deaccent(String(s).toLowerCase()).includes(f);
        out.innerHTML = '';
        const sec = (title, rows) => {
          const r = rows.filter(([a, b]) => match(a + ' ' + b));
          if (!r.length) return;
          out.appendChild(el('div', 'sub', title));
          r.forEach(([a, b]) => {
            const row = el('div', 'kv');
            row.append(el('b', null, a), el('span', null, b));
            out.appendChild(row);
          });
        };
        sec('KOMENDY', COMMANDS);
        sec('SKROTY KLAWISZOWE', SHORTCUTS);
        CHANGES.forEach(([v, name, items]) => {
          const rows = items.map((i) => [v, i]);
          if (rows.some(([a, b]) => match(a + ' ' + name + ' ' + b))) {
            out.appendChild(el('div', 'sub', `CO NOWEGO ${v} - ${name}`));
            items.forEach((i) => out.appendChild(el('div', 'help-li', `• ${i}`)));
          }
        });
      };
      q.addEventListener('input', draw);
      draw();
    },
  };

  mod('table', 'Holo-stol', 'widzety w przestrzeni', '◇', 'Glowne', { table });
  mod('planner', 'Planer tygodnia', 'plan na 7 dni', '▦', 'Dom', { planner });
  mod('translate', 'Tlumacz', 'AI, 12 jezykow', '⇄', 'Wiedza', { translate });
  mod('clocks', 'Zegary swiata', 'strefy czasowe', '◷', 'Dom', { clocks });
  mod('stats', 'Statystyki', 'uzycie i nawyki', '▤', 'Wiedza', { stats });
  mod('help', 'Pomoc', 'komendy i skroty', '?', 'Glowne', { help });

  // ---------- globalne skroty: Ctrl+/ i "g" + litera ----------
  const GOTO = { d: 'dash', z: 'tasks', n: 'notes', j: 'journal', k: 'shop', w: 'habits', t: 'kanban', p: 'planner', s: 'stats', h: 'help', c: 'clocks', m: 'machine', b: 'bookmarks', f: 'cards', l: 'translate' };
  let gArmed = 0;
  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault();
      UI.openWindow('help');
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'g') {
      gArmed = Date.now();
      return;
    }
    if (gArmed && Date.now() - gArmed < 1200 && GOTO[e.key] && isOwner()) {
      gArmed = 0;
      UI.openWindow(GOTO[e.key]);
    }
  });
  UI.shortcuts = { goto: GOTO, list: SHORTCUTS, commands: COMMANDS };
})();
