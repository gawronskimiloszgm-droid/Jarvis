// Rozszerzenie palety (Ctrl+K): kalkulator i przeliczenia wprost w polu, losowania,
// hasla/UUID/hashe, daty, szybkie dodawanie (zadanie, notatka, zakupy, wydatek, woda,
// nastroj, nawyk, dziennik, zakladka, odliczanie), skoki do modulow i historia polecen.
// Dziala jako nakladka na UI.paletteSearch z search.js - ladowac PO nim.
(function () {
  const UI = window.JarvisUI;
  const T = window.Toolkit;
  if (!UI || !UI.paletteSearch) return;
  const { api, toast, isOwner, deaccent } = UI;

  const norm = (s) => (deaccent ? deaccent(String(s || '')) : String(s || '')).toLowerCase();
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6).replace('.', ','));
  const HIST_KEY = 'jarvis.palHist';

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text));
      toast(`Skopiowano: ${String(text).slice(0, 60)}`);
    } catch {
      toast(String(text).slice(0, 80));
    }
  };
  const copyItem = (label, value, hint = 'ENTER = kopiuj') => ({ label, hint, run: () => copy(value) });

  // Surowy tekst z pola (paleta przekazuje male litery - przy hashach/hasłach liczy sie wielkosc).
  const rawQuery = (q) => {
    const v = document.getElementById('paletteInput')?.value;
    return v && norm(v.trim()) === norm(q.trim()) ? v.trim() : q.trim();
  };

  // Odpowiedz dla wyrazen arytmetycznych bez zadnego czasownika: "12*7", "20% z 150", "sqrt(81)+1".
  function mathItem(q) {
    if (!T || !/[\d]/.test(q) || !/^[\d\s+\-*/^().,%a-z]+$/i.test(q)) return null;
    if (!/[+\-*/^%()]|sqrt|sin|cos|tan|log|ln|fact|abs|round|floor|ceil|pi\b/i.test(q) || /^[\d\s,.]+$/.test(q)) return null;
    try {
      const v = T.calc(q.replace(/^=\s*/, ''));
      return copyItem(`= ${fmt(v)}`, fmt(v), `${q} · ENTER kopiuje`);
    } catch {
      return null;
    }
  }

  // Szybkie dodawanie do zycia (wymaga zalogowanego wlasciciela).
  const quick = {
    zadanie: (rest) => api('/api/todos', json('POST', { text: rest })).then(() => toast('Dodano zadanie.')),
    notatka: (rest) => UI.life.add('quicknotes', { text: rest }).then(() => toast('Zapisano notatke.')),
    zakupy: (rest) => {
      const items = rest.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      return Promise.all(items.map((t) => UI.life.add('shopping', { text: t }))).then(() => toast(`Dodano do zakupow: ${items.length}.`));
    },
    dziennik: (rest) => UI.life.add('journal', { text: rest, kind: 'manual' }).then(() => toast('Wpis w dzienniku.')),
    zakladka: (rest) => {
      const m = rest.match(/^(https?:\/\/\S+)\s*(.*)$/i);
      return UI.life.add('bookmarks', { url: m ? m[1] : rest, title: m ? m[2] : '' }).then(() => toast('Dodano zakladke.'));
    },
  };

  const go = (id) => () => UI.openWindow(id);
  const JUMP = {
    pulpit: 'dash', dash: 'dash', zadania: 'tasks', notatki: 'notes', poczta: 'mail', narzedzia: 'tools', dziennik: 'journal', zakupy: 'shop', nawyki: 'habits',
    cele: 'goals', tablica: 'kanban', kanban: 'kanban', zakladki: 'bookmarks', fiszki: 'cards', maszyna: 'machine', ustawienia: 'set', wydatki: 'money', kamera: 'eye', logi: 'logs', systemy: 'sys', projekt: 'cad', wiedza: 'know', agent: 'agent', makra: 'macros',
  };

  // Przelicznik walut: "100 eur na pln" / "kurs usd".
  const fxItem = (from, to, amount) => ({
    label: `$ ${amount} ${from.toUpperCase()} → ${to.toUpperCase()}`,
    hint: 'ENTER = pobierz kurs',
    run: async () => {
      try {
        const r = await api(`/api/fx?from=${from}&to=${to}&amount=${amount}`);
        copy(`${fmt(r.result)} ${r.to}`);
        toast(`${amount} ${r.from} = ${fmt(r.result)} ${r.to} (${r.date})`);
      } catch (e) {
        toast(e.message || 'Brak kursu.');
      }
    },
  });

  function more(q) {
    const raw = rawQuery(q);
    const m = raw.match(/^(\S+)\s*(.*)$/s);
    if (!m) return [];
    const verb = norm(m[1]).replace(/[:]$/, '');
    const rest = m[2].trim();
    const out = [];
    const owner = isOwner();

    const mi = mathItem(raw);
    if (mi) out.push(mi);
    if (verb === '=' || (verb.startsWith('=') && verb.length > 1)) {
      const expr = verb === '=' ? rest : raw.slice(1);
      try {
        out.push(copyItem(`= ${fmt(T.calc(expr))}`, fmt(T.calc(expr)), `${expr} · ENTER kopiuje`));
      } catch (e) {
        out.push({ label: `= ${e.message}`, hint: 'blad', run: () => {} });
      }
    }
    // Jednostki: "5 kg na lb", "100 c na f".
    if (T) {
      try {
        const c = T.parseConvert(raw);
        if (c) out.push(copyItem(`⇄ ${fmt(c.value)} ${c.from} = ${fmt(c.result)} ${c.to}`, fmt(c.result), 'przeliczenie · ENTER kopiuje'));
      } catch {
        /* nie jednostki */
      }
    }
    const cur = raw.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]{3})\s+(?:na|to|w|->|→)\s+([a-zA-Z]{3})$/i);
    if (cur && owner && T && !(T.parseConvert(raw))) out.push(fxItem(cur[2], cur[3], Number(cur[1].replace(',', '.'))));
    if (verb === 'kurs' && owner) {
      const [a, b = 'pln'] = rest.split(/\s+/);
      if (a && /^[a-z]{3}$/i.test(a)) out.push(fxItem(a, b, 1));
    }

    if (verb === 'kostka' || verb === 'rzut') {
      const n = parseInt(rest, 10) || 6;
      const v = T.dice(n, 1)[0];
      out.push(copyItem(`⚄ k${n}: ${v}`, v, 'ENTER = kopiuj'));
    }
    if (verb === 'moneta' || verb === 'orzel') {
      const v = T.coin();
      out.push(copyItem(`◍ ${v}`, v));
    }
    if (verb === 'losuj' && rest) {
      const opts = rest.split(/[,;|]|\s+lub\s+/).map((s) => s.trim()).filter(Boolean);
      if (opts.length > 1) {
        const pick = opts[Math.floor(Math.random() * opts.length)];
        out.push(copyItem(`✦ Wylosowano: ${pick}`, pick));
      }
    }
    if (verb === 'haslo' || verb === 'password') {
      const n = Math.max(8, Math.min(64, parseInt(rest, 10) || 20));
      const pw = T.password(n, { symbols: true });
      out.push(copyItem(`🔑 ${pw}`, pw, `${n} znakow · ENTER kopiuje`));
    }
    if (verb === 'uuid' || verb === 'guid') {
      const v = T.uuid();
      out.push(copyItem(`# ${v}`, v));
    }
    if (verb === 'hash' || verb === 'sha256') {
      if (rest) out.push({ label: `# SHA-256: "${rest.slice(0, 30)}"`, hint: 'ENTER = kopiuj', run: async () => copy(await T.hash(rest)) });
    }
    if (verb === 'base64' || verb === 'b64') {
      if (rest) {
        let v;
        try {
          v = /^[A-Za-z0-9+/=]{8,}$/.test(rest) ? T.b64.dec(rest) : T.b64.enc(rest);
        } catch {
          v = T.b64.enc(rest);
        }
        out.push(copyItem(`⇄ ${v.slice(0, 80)}`, v));
      }
    }
    if (verb === 'timestamp' || verb === 'unix') {
      const t = T.timestamp(rest || Date.now() / 1000);
      out.push(copyItem(`⏱ ${t.iso}`, t.unix, `unix ${t.unix}`));
    }
    if (verb === 'qr' && rest) out.push({ label: `▦ QR: ${rest.slice(0, 40)}`, hint: 'ENTER = otworz narzedzia', run: () => { sessionStorage.setItem('jarvis.qrText', rest); UI.openWindow('tools'); } });
    if (verb === 'kolor' || verb === 'color') {
      try {
        const rgb = T.hexToRgb(rest);
        out.push(copyItem(`■ ${T.rgbToHex(...rgb)} · rgb(${rgb.join(', ')})`, T.rgbToHex(...rgb)));
      } catch {
        /* nie kolor */
      }
    }
    if (verb === 'ile' || verb === 'dni') {
      const t = rest.replace(/^do\s+/, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        const d = T.dateDiff(new Date().toISOString().slice(0, 10), t);
        out.push(copyItem(`📅 Do ${t}: ${d} dni`, d));
      } else if (t) {
        try {
          const d = T.daysUntilWeekday(t);
          if (d != null) out.push(copyItem(`📅 Do ${t}: ${d} dni`, d));
        } catch {
          /* ignoruj */
        }
      }
    }
    if (verb === 'za' && /^(\d+)\s+dni/.test(rest)) {
      const n = parseInt(rest, 10);
      const d = T.dateAdd(new Date().toISOString().slice(0, 10), n);
      out.push(copyItem(`📅 Za ${n} dni: ${d}`, d));
    }
    if (verb === 'czas' || verb === 'godzina') {
      const zones = { tokio: 'Asia/Tokyo', nowy_jork: 'America/New_York', 'nowy': 'America/New_York', londyn: 'Europe/London', los: 'America/Los_Angeles', sydney: 'Australia/Sydney', dubaj: 'Asia/Dubai', pekin: 'Asia/Shanghai' };
      const z = zones[norm(rest).split(/\s+/)[0]];
      if (z) out.push(copyItem(`🕐 ${rest}: ${T.timeIn(z)}`, T.timeIn(z)));
    }

    if (owner) {
      if (quick[verb] && rest) out.push({ label: `＋ ${verb[0].toUpperCase() + verb.slice(1)}: ${rest.slice(0, 50)}`, hint: 'ENTER = dodaj', run: () => quick[verb](rest).catch((e) => toast(e.message || 'Blad zapisu.')) });
      if (verb === 'wydatek' && rest) {
        const e = rest.match(/^(\d+(?:[.,]\d+)?)\s*(?:zl)?\s*(.*)$/i);
        if (e) out.push({ label: `＋ Wydatek ${e[1]} zl ${e[2] || ''}`, hint: 'ENTER = zapisz', run: () => api('/api/expenses', json('POST', { amount: Number(e[1].replace(',', '.')), category: e[2].split(/\s+/)[0] || 'inne', note: e[2] })).then(() => toast('Zapisano wydatek.')).catch((x) => toast(x.message)) });
      }
      if (verb === 'woda') {
        const n = parseInt(rest, 10) || 1;
        out.push({ label: `💧 Woda ${n > 0 ? '+' : ''}${n}`, hint: 'ENTER', run: () => UI.life.setDaily({ waterDelta: n }).then((r) => toast(`Woda dzis: ${r.water} szkl.`)) });
      }
      if (verb === 'nastroj') {
        const n = Math.max(1, Math.min(5, parseInt(rest, 10) || 3));
        out.push({ label: `☺ Nastroj ${n}/5`, hint: 'ENTER', run: () => UI.life.setDaily({ mood: n }).then(() => toast(`Nastroj: ${n}/5`)) });
      }
      if (verb === 'nawyk' && rest) {
        out.push({ label: `✔ Nawyk: ${rest}`, hint: 'ENTER = odhacz dzis', run: async () => {
          const hs = await UI.life.list('habits', true);
          const h = hs.find((x) => norm(x.name).includes(norm(rest)));
          if (!h) return toast('Nie ma takiego nawyku.');
          await UI.toggleHabit(h);
          toast(`Nawyk: ${h.name}`);
        } });
      }
      if (verb === 'odliczanie' || verb === 'cel') {
        const d = rest.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
        if (d && verb === 'odliczanie') out.push({ label: `⏳ Odliczanie: ${d[2]} → ${d[1]}`, hint: 'ENTER = dodaj', run: () => UI.life.add('countdowns', { name: d[2], date: d[1] }).then(() => toast('Dodano odliczanie.')) });
        if (verb === 'cel' && rest) out.push({ label: `◎ Cel: ${rest}`, hint: 'ENTER = dodaj', run: () => UI.life.add('goals', { text: rest }).then(() => toast('Dodano cel.')) });
      }
      if (verb === 'tablica' && rest) out.push({ label: `▦ Kanban: ${rest}`, hint: 'ENTER = do "todo"', run: () => UI.life.add('kanban', { text: rest }).then(() => toast('Dodano karte.')) });
      if (verb === 'szukaj' && rest) out.push({ label: `⌕ Szukaj w sieci: ${rest}`, hint: 'ENTER', run: () => window.open(`https://duckduckgo.com/?q=${encodeURIComponent(rest)}`, '_blank', 'noopener') });
      if (verb === 'podsumuj') out.push({ label: '☰ Podsumowanie dnia (AI)', hint: 'ENTER', run: () => UI.openWindow('journal') });
    }

    // Skoki do modulow: "g dziennik", "idz zakupy".
    if ((verb === 'g' || verb === 'idz' || verb === 'go') && rest) {
      const key = Object.keys(JUMP).find((k) => k.startsWith(norm(rest)));
      if (key) out.push({ label: `→ Przejdz: ${key}`, hint: 'ENTER', run: go(JUMP[key]) });
    }
    if (verb === 'holo') {
      const mode = ['full', 'subtle', 'off'].find((x) => x.startsWith(norm(rest))) || null;
      if (mode) out.push({ label: `◇ Hologram: ${mode}`, hint: 'ENTER', run: () => { try { localStorage.setItem('jarvis.holo', mode); } catch { /* brak pamieci */ } UI.holo?.apply(); toast(`Hologram: ${mode}`); } });
    }
    if (verb === 'historia' || verb === 'hist') {
      let h = [];
      try {
        h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      } catch {
        h = [];
      }
      h.slice(0, 8).forEach((t) => out.push({ label: `↺ ${t}`, hint: 'wstaw', run: () => { const i = document.getElementById('paletteInput'); setTimeout(() => { if (i) { i.value = t; i.dispatchEvent(new Event('input')); } }, 60); } }));
    }
    return out;
  }

  // Zapamietuj polecenia, ktore faktycznie wykonano (nie zwykle wyszukiwanie).
  const orig = UI.paletteSearch;
  UI.paletteSearch = (q) => {
    const extra = more(q);
    extra.forEach((it) => {
      const run = it.run;
      it.run = () => {
        try {
          const raw = rawQuery(q);
          const h = [raw, ...JSON.parse(localStorage.getItem(HIST_KEY) || '[]').filter((x) => x !== raw)].slice(0, 30);
          localStorage.setItem(HIST_KEY, JSON.stringify(h));
        } catch {
          /* historia opcjonalna */
        }
        return run();
      };
    });
    return [...extra, ...orig(q)];
  };

  // Alt+1..9 - szybkie skoki do pierwszych modulow, Ctrl+/ - lista skrotow.
  window.addEventListener('keydown', (e) => {
    if (!isOwner() || e.target.closest?.('input, textarea, [contenteditable]')) return;
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const nav = [...document.querySelectorAll('.nav button, #nav button, nav button')].filter((b) => b.offsetParent);
      const b = nav[Number(e.key) - 1];
      if (b) { e.preventDefault(); b.click(); }
    }
  });
  UI.paletteHelp = () => [
    '= 2+2*3  ·  5 kg na lb  ·  100 eur na pln  ·  kurs usd',
    'kostka 20  ·  moneta  ·  losuj a, b, c  ·  haslo 24  ·  uuid  ·  hash tekst',
    'zadanie ...  ·  notatka ...  ·  zakupy mleko, chleb  ·  wydatek 12 kawa',
    'woda +1  ·  nastroj 4  ·  nawyk bieganie  ·  dziennik ...  ·  cel ...',
    'ile do piatku  ·  za 30 dni  ·  g dziennik  ·  holo off  ·  historia',
  ];
})();
