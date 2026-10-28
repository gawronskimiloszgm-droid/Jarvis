// Druga paczka widzetow Pulpitu (rejestrowane przez UI.addHomeWidget; mozna je ukrywac,
// przestawiac i zmieniac im rozmiar w trybie "UKLAD").
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.addHomeWidget) return;
  const { el, api, toast, isOwner, store } = UI;
  const T = window.Toolkit;
  const L = () => UI.life;
  const hm = (d) => new Date(d).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const wx = {
    0: '☀', 1: '🌤', 2: '⛅', 3: '☁', 45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧', 71: '🌨', 73: '🌨', 75: '❄', 80: '🌦', 81: '🌧', 82: '⛈', 95: '⛈', 96: '⛈', 99: '⛈',
  };
  const loc = () => store.location || { lat: 52.23, lon: 21.01 };
  const add = (id, title, glyph, opts, render) => UI.addHomeWidget({ id, title, glyph, ...opts, render });
  const none = (box, t) => {
    box.innerHTML = '';
    box.appendChild(el('div', 'w-empty', t));
  };

  // ---------- czas i kalendarz ----------
  add('world', 'Zegary swiata', '🌐', { every: 30000 }, (box) => {
    if (!T) return;
    let list;
    try {
      list = JSON.parse(localStorage.getItem('jarvis.worldClocks')) || ['warszawa', 'londyn', 'nowy jork', 'tokio'];
    } catch {
      list = ['warszawa', 'londyn', 'nowy jork', 'tokio'];
    }
    box.innerHTML = '';
    const l = el('div', 'w-list');
    list.slice(0, 5).forEach((c) => {
      if (!T.CITIES[c]) return;
      const it = el('div', 'it');
      it.append(el('span', null, c), el('span', null, T.timeIn(T.CITIES[c])));
      l.appendChild(it);
    });
    box.appendChild(l);
  });

  add('sun', 'Slonce i ksiezyc', '☼', { every: 3600000 }, async (box) => {
    const { lat, lon } = loc();
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto&forecast_days=1`).then((x) => x.json());
    const rise = new Date(r.daily.sunrise[0]);
    const set = new Date(r.daily.sunset[0]);
    const now = new Date();
    box.innerHTML = '';
    box.appendChild(el('div', 'w-mid', `↑ ${hm(rise)}   ↓ ${hm(set)}`));
    const dayLen = (set - rise) / 3600000;
    box.appendChild(el('div', 'w-dim', `Dzien trwa ${Math.floor(dayLen)} h ${Math.round((dayLen % 1) * 60)} min`));
    const left = set - now;
    box.appendChild(el('div', 'w-dim', now < rise ? `Wschod za ${Math.round((rise - now) / 60000)} min` : left > 0 ? `Do zachodu ${Math.floor(left / 3600000)} h ${Math.round((left % 3600000) / 60000)} min` : 'Slonce juz zaszlo'));
    // faza ksiezyca (cykl 29.53 dnia od nowiu 2000-01-06)
    const age = (((now - new Date('2000-01-06T18:14:00Z')) / 86400000) % 29.530588 + 29.530588) % 29.530588;
    const phases = ['🌑 nów', '🌒 przybywa', '🌓 pierwsza kwadra', '🌔 przybywa', '🌕 pelnia', '🌖 ubywa', '🌗 ostatnia kwadra', '🌘 ubywa'];
    box.appendChild(el('div', 'w-dim', `Ksiezyc: ${phases[Math.round((age / 29.530588) * 8) % 8]} (${Math.round(age)} dzien cyklu)`));
  });

  add('hourly', 'Pogoda godzinowa', '🌡', { every: 30 * 60000, wide: true }, async (box) => {
    const { lat, lon } = loc();
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=2&timezone=auto`).then((x) => x.json());
    const now = new Date();
    const idx = r.hourly.time.findIndex((t) => new Date(t) >= now);
    const hrs = r.hourly.time.slice(idx, idx + 24).map((t, i) => ({ t, temp: r.hourly.temperature_2m[idx + i], p: r.hourly.precipitation_probability[idx + i], c: r.hourly.weather_code[idx + i] }));
    box.innerHTML = '';
    const cv = el('canvas');
    cv.style.cssText = 'width:100%;height:90px';
    box.appendChild(cv);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = (cv.width = 700 * dpr), h = (cv.height = 90 * dpr);
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const col = css.getPropertyValue('--blue').trim() || '#33e0ff';
    const mn = Math.min(...hrs.map((x) => x.temp)), mx = Math.max(...hrs.map((x) => x.temp));
    const X = (i) => 20 + (i * 660) / (hrs.length - 1);
    const Y = (v) => 60 - ((v - mn) / Math.max(1, mx - mn)) * 44;
    hrs.forEach((x, i) => { g.fillStyle = 'rgba(80,160,255,.35)'; g.fillRect(X(i) - 8, 84 - (x.p / 100) * 22, 16, (x.p / 100) * 22); });
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
    hrs.forEach((x, i) => (i ? g.lineTo(X(i), Y(x.temp)) : g.moveTo(X(i), Y(x.temp)))); g.stroke();
    g.fillStyle = css.getPropertyValue('--txt').trim() || '#cde'; g.font = '10px monospace'; g.textAlign = 'center';
    hrs.forEach((x, i) => { if (i % 3 === 0) { g.fillText(`${Math.round(x.temp)}°`, X(i), Y(x.temp) - 6); g.fillText(`${new Date(x.t).getHours()}h`, X(i), 12); } });
    const rain = hrs.find((x) => x.p >= 60);
    box.appendChild(el('div', 'w-dim', rain ? `Deszcz mozliwy ok. ${hm(rain.t)} (${rain.p}%)` : 'Bez wiekszych opadow w najblizszych 24 h.'));
  });

  add('air', 'Jakosc powietrza', '🍃', { every: 3600000 }, async (box) => {
    const { lat, lon } = loc();
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5,pm10,uv_index`).then((x) => x.json());
    const c = r.current;
    const aqi = c.european_aqi;
    const label = aqi <= 20 ? 'bardzo dobra' : aqi <= 40 ? 'dobra' : aqi <= 60 ? 'umiarkowana' : aqi <= 80 ? 'zla' : 'bardzo zla';
    box.innerHTML = '';
    const big = el('div', 'w-big', String(aqi));
    big.style.color = aqi <= 40 ? 'var(--good)' : aqi <= 60 ? 'var(--amber)' : 'var(--red)';
    box.append(big, el('div', 'w-mid', label), el('div', 'w-dim', `PM2.5 ${c.pm2_5} · PM10 ${c.pm10} µg/m³ · UV ${c.uv_index ?? '-'}`));
  });

  const QUOTES = [
    ['Najlepszy sposob, zeby przewidziec przyszlosc, to ja stworzyc.', 'Peter Drucker'],
    ['Nie liczy sie, jak wolno idziesz, byle nie stawac.', 'Konfucjusz'],
    ['Prostota jest szczytem wyrafinowania.', 'Leonardo da Vinci'],
    ['Zrob to, czego sie boisz, a strach zniknie.', 'Ralph Waldo Emerson'],
    ['Kazdy ekspert byl kiedys poczatkujacym.', 'Helen Hayes'],
    ['Plan jest niczym, planowanie jest wszystkim.', 'Dwight Eisenhower'],
    ['To, co mierzysz, to poprawiasz.', 'Peter Drucker'],
    ['Wytrwalosc jest matka sukcesu.', 'przyslowie'],
    ['Dzis jest dobry dzien, zeby zaczac.', 'nieznany'],
    ['Male kroki, kazdego dnia.', 'nieznany'],
    ['Skup sie na procesie, nie na wyniku.', 'nieznany'],
    ['Nie czekaj na idealny moment - stworz go.', 'nieznany'],
    ['Kto pyta, ten nie bladzi.', 'przyslowie'],
    ['Madrosc zaczyna sie od zdziwienia.', 'Sokrates'],
    ['Lepiej zrobic i zalowac, niz nie zrobic i zalowac.', 'przyslowie'],
  ];
  add('quote', 'Cytat dnia', '❝', { every: 3600000 }, (box) => {
    const d = new Date();
    const q = QUOTES[(d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate()) % QUOTES.length];
    box.innerHTML = '';
    box.append(el('div', 'w-mid', `„${q[0]}”`), el('div', 'w-dim', '— ' + q[1]));
  });

  function progressBar(label, pct, sub) {
    const w = el('div');
    const it = el('div', 'it');
    it.style.cssText = 'display:flex;justify-content:space-between;font-size:12px';
    it.append(el('span', null, label), el('span', null, sub || `${Math.round(pct)}%`));
    const bar = el('div', 'w-meter');
    const fill = el('i');
    fill.style.width = Math.min(100, pct) + '%';
    bar.appendChild(fill);
    w.append(it, bar);
    return w;
  }
  add('progress', 'Postep czasu', '⏳', { every: 60000 }, (box) => {
    const n = new Date();
    const dayPct = ((n.getHours() * 60 + n.getMinutes()) / 1440) * 100;
    const dow = (n.getDay() + 6) % 7;
    const weekPct = ((dow * 24 + n.getHours()) / 168) * 100;
    const start = new Date(n.getFullYear(), 0, 1);
    const days = (new Date(n.getFullYear() + 1, 0, 1) - start) / 86400000;
    const yearPct = ((n - start) / 86400000 / days) * 100;
    const monthDays = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    box.innerHTML = '';
    box.append(progressBar('Dzien', dayPct), progressBar('Tydzien', weekPct), progressBar('Miesiac', ((n.getDate() - 1 + n.getHours() / 24) / monthDays) * 100), progressBar('Rok ' + n.getFullYear(), yearPct, `${Math.round(yearPct * 10) / 10}% · dzien ${Math.ceil((n - start) / 86400000)}/${days}`));
  });

  add('countdown', 'Odliczanie', '◷', { owner: true, every: 60000, events: ['jarvis:life'] }, async (box) => {
    const items = (await L().list('countdowns', true).catch(() => [])).filter((c) => new Date(c.date + 'T23:59:59') >= new Date()).sort((a, b) => a.date.localeCompare(b.date));
    const bd = await L().list('birthdays').catch(() => []);
    box.innerHTML = '';
    const l = el('div', 'w-list');
    items.slice(0, 3).forEach((c) => {
      const d = Math.ceil((new Date(c.date + 'T12:00:00') - new Date()) / 86400000);
      const it = el('div', 'it');
      it.append(el('span', null, c.name), el('span', null, d === 0 ? 'DZIS' : `za ${d} dni`));
      l.appendChild(it);
    });
    const now = new Date();
    bd.map((b) => { const [m, d] = b.date.split('-').map(Number); let dt = new Date(now.getFullYear(), m - 1, d, 12); if (dt < new Date(now.getFullYear(), now.getMonth(), now.getDate())) dt = new Date(now.getFullYear() + 1, m - 1, d, 12); return { b, days: Math.ceil((dt - now) / 86400000) }; }).filter((x) => x.days <= 30).sort((a, b) => a.days - b.days).slice(0, 2).forEach((x) => {
      const it = el('div', 'it');
      it.append(el('span', null, `🎂 ${x.b.name}`), el('span', null, x.days === 0 ? 'DZIS!' : `za ${x.days} dni`));
      l.appendChild(it);
    });
    if (!l.children.length) return none(box, 'Dodaj odliczania i urodziny w module "Cele i daty".');
    box.appendChild(l);
  });

  // ---------- zdrowie i nawyki ----------
  add('water', 'Woda', '💧', { owner: true, events: ['jarvis:life'] }, async (box) => {
    const d = await L().daily().catch(() => ({ water: 0 }));
    box.innerHTML = '';
    const goal = Number(localStorage.getItem('jarvis.waterGoal') || 8);
    box.appendChild(el('div', 'w-big', `${d.water}/${goal}`));
    const cups = el('div', 'w-row');
    for (let i = 0; i < goal; i++) {
      const c = el('span', null, i < d.water ? '💧' : '○');
      c.style.cssText = 'font-size:16px;opacity:' + (i < d.water ? 1 : 0.35);
      cups.appendChild(c);
    }
    box.appendChild(cups);
    const row = el('div', 'w-row');
    [['−', -1], ['+ szklanka', 1]].forEach(([l, dlt]) => {
      const b = el('button', dlt > 0 ? 'btn primary' : 'btn ghost', l);
      b.addEventListener('click', () => L().setDaily({ waterDelta: dlt }));
      row.appendChild(b);
    });
    box.appendChild(row);
  });

  add('habits-today', 'Nawyki dzis', '⟳', { owner: true, events: ['jarvis:life'], every: 300000 }, async (box) => {
    const hs = await L().list('habits', true).catch(() => []);
    box.innerHTML = '';
    if (!hs.length) return none(box, 'Dodaj nawyki w module "Nawyki".');
    const t = UI.dayKey(new Date());
    const l = el('div', 'w-list');
    hs.slice(0, 6).forEach((h) => {
      const done = h.days.includes(t);
      const it = el('div', 'it');
      const b = el('button', done ? 'btn primary' : 'btn ghost', done ? '✓' : '○');
      b.style.padding = '2px 9px';
      b.addEventListener('click', () => UI.toggleHabit(h, t));
      const left = el('span');
      left.append(b, document.createTextNode(` ${h.icon} ${h.name}`));
      it.append(left, el('span', null, `🔥 ${UI.habitStreak(h.days)}`));
      l.appendChild(it);
    });
    box.appendChild(l);
    const done = hs.filter((h) => h.days.includes(t)).length;
    box.appendChild(el('div', 'w-dim', `${done}/${hs.length} zrobione dzis`));
  });

  add('mood', 'Nastroj', '☺', { owner: true, events: ['jarvis:life'] }, async (box) => {
    const d = await L().daily().catch(() => ({ mood: 0 }));
    box.innerHTML = '';
    const row = el('div', 'w-row');
    ['😞', '😕', '😐', '🙂', '😄'].forEach((m, i) => {
      const b = el('button', d.mood === i + 1 ? 'btn primary' : 'btn ghost', m);
      b.style.fontSize = '18px';
      b.addEventListener('click', () => L().setDaily({ mood: i + 1 }));
      row.appendChild(b);
    });
    box.append(row, el('div', 'w-dim', d.mood ? `Dzis: ${d.mood}/5` : 'Jak sie dzis czujesz?'));
  });

  // ---------- listy i notatki ----------
  add('shop-w', 'Zakupy', '🛒', { owner: true, events: ['jarvis:life'], every: 300000 }, async (box) => {
    const items = (await L().list('shopping', true).catch(() => [])).filter((i) => !i.done);
    box.innerHTML = '';
    if (!items.length) return none(box, 'Lista zakupow pusta.');
    const l = el('div', 'w-list');
    items.slice(0, 7).forEach((i) => {
      const it = el('div', 'it');
      const b = el('button', 'btn ghost', '☐');
      b.style.padding = '1px 8px';
      b.addEventListener('click', () => L().patch('shopping', i.id, { done: true }));
      const left = el('span');
      left.append(b, document.createTextNode(' ' + i.text));
      it.append(left, el('span', null, i.cat));
      l.appendChild(it);
    });
    box.appendChild(l);
    if (items.length > 7) box.appendChild(el('div', 'w-dim', `…i ${items.length - 7} wiecej`));
    const f = el('form', 'field');
    const inp = el('input', 'inp');
    inp.placeholder = 'dodaj...';
    f.append(inp);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (inp.value.trim()) await L().add('shopping', { items: inp.value.split(',').map((t) => ({ text: t.trim() })).filter((x) => x.text) });
    });
    box.appendChild(f);
  });

  add('qnote', 'Szybka notatka', '✎', { owner: true }, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    const ta = el('textarea', 'inp');
    ta.rows = 3;
    ta.placeholder = 'Zapisz mysl... (Ctrl+Enter)';
    const row = el('div', 'w-row');
    const save = el('button', 'btn primary', 'ZAPISZ');
    const pad = el('span', 'w-dim', '');
    const go = async () => {
      if (!ta.value.trim()) return;
      await L().add('quicknotes', { text: ta.value });
      ta.value = '';
      pad.textContent = 'Zapisano ✓';
      setTimeout(() => (pad.textContent = ''), 2000);
    };
    save.addEventListener('click', go);
    ta.addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && go());
    row.append(save, pad);
    box.append(ta, row);
  });

  add('goals-w', 'Cele', '◎', { owner: true, events: ['jarvis:life'], every: 600000 }, async (box) => {
    const gs = (await L().list('goals', true).catch(() => [])).filter((g) => !g.done);
    box.innerHTML = '';
    if (!gs.length) return none(box, 'Dodaj cele w module "Cele i daty".');
    gs.slice(0, 4).forEach((g) => box.appendChild(progressBar(g.text.slice(0, 30), (100 * g.progress) / g.target, `${g.progress}/${g.target} ${g.unit}`)));
  });

  add('kanban-w', 'Tablica', '▦', { owner: true, events: ['jarvis:life'], every: 600000 }, async (box) => {
    const items = await L().list('kanban', true).catch(() => []);
    box.innerHTML = '';
    if (!items.length) return none(box, 'Tablica jest pusta.');
    const row = el('div', 'w-row');
    [['todo', 'do zrobienia'], ['doing', 'w toku'], ['done', 'gotowe']].forEach(([k, l]) => {
      const b = el('div');
      b.style.cssText = 'flex:1;text-align:center';
      b.append(el('div', 'w-big', String(items.filter((i) => i.col === k).length)), el('div', 'w-dim', l));
      row.appendChild(b);
    });
    box.appendChild(row);
    const top = items.filter((i) => i.col === 'doing').slice(0, 3);
    if (top.length) box.appendChild(el('div', 'w-dim', 'W toku: ' + top.map((i) => i.text).join(' · ')));
  });

  // ---------- male narzedzia ----------
  add('stopwatch', 'Stoper', '⏱', {}, (box) => {
    if (box._built) return;
    box._built = true;
    const st = (window.__stopwatch = window.__stopwatch || { run: false, start: 0, acc: 0, laps: [] });
    const disp = el('div', 'w-big');
    const laps = el('div', 'w-list');
    const row = el('div', 'w-row');
    const fmtT = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
    const cur = () => st.acc + (st.run ? Date.now() - st.start : 0);
    const go = el('button', 'btn primary', st.run ? 'PAUZA' : 'START');
    const lap = el('button', 'btn ghost', 'OKRAZENIE');
    const rst = el('button', 'btn ghost', 'ZERUJ');
    go.addEventListener('click', () => {
      if (st.run) { st.acc = cur(); st.run = false; } else { st.start = Date.now(); st.run = true; }
      go.textContent = st.run ? 'PAUZA' : 'START';
    });
    lap.addEventListener('click', () => { if (st.run) { st.laps.unshift(fmtT(cur())); draw(); } });
    rst.addEventListener('click', () => { st.run = false; st.acc = 0; st.laps = []; go.textContent = 'START'; draw(); });
    row.append(go, lap, rst);
    const draw = () => { disp.textContent = fmtT(cur()); laps.innerHTML = ''; st.laps.slice(0, 4).forEach((l, i) => laps.appendChild(el('div', 'w-dim', `#${st.laps.length - i}  ${l}`))); };
    box.append(disp, row, laps);
    draw();
    const t = setInterval(() => (document.body.contains(box) ? disp.textContent = fmtT(cur()) : clearInterval(t)), 50);
  });

  add('dice', 'Kostka i moneta', '🎲', {}, (box) => {
    if (box._built || !T) return;
    box._built = true;
    const o = el('div', 'w-big', '—');
    const row = el('div', 'w-row');
    [['K6', () => String(T.dice(6, 1)[0])], ['2×K6', () => T.dice(6, 2).join(' + ')], ['K20', () => String(T.dice(20, 1)[0])], ['Moneta', () => T.coin()]].forEach(([l, fn]) => {
      const b = el('button', 'btn ghost', l);
      b.addEventListener('click', () => { o.textContent = fn(); window.SFX?.play('tap'); });
      row.appendChild(b);
    });
    box.append(o, row);
  });

  add('clip-w', 'Ostatnio skopiowane', '⎘', { owner: true, every: 15000 }, async (box) => {
    box.innerHTML = '';
    if (!window.jarvisDesktop) return none(box, 'Historia schowka dziala w aplikacji desktopowej.');
    const r = await window.jarvisDesktop.runAction('schowek-historia').catch(() => null);
    if (!r?.wlaczona) return none(box, 'Wlacz historie schowka w module Schowek.');
    const l = el('div', 'w-list');
    (r.wpisy || []).slice(0, 4).forEach((w) => l.appendChild(el('div', null, w.text.replace(/\s+/g, ' ').slice(0, 60))));
    box.appendChild(l.children.length ? l : el('div', 'w-empty', 'Skopiuj cos...'));
  });

  // ---------- urzadzenie i siec ----------
  add('battery', 'Bateria i ekran', '🔋', { every: 60000 }, async (box) => {
    box.innerHTML = '';
    try {
      const b = await navigator.getBattery();
      const pct = Math.round(b.level * 100);
      box.append(progressBar('Bateria', pct, `${pct}%${b.charging ? ' ⚡ laduje' : ''}`));
    } catch {
      box.appendChild(el('div', 'w-dim', 'Bateria: niedostepna w tej przegladarce.'));
    }
    box.appendChild(el('div', 'w-dim', `Ekran ${screen.width}×${screen.height} · okno ${innerWidth}×${innerHeight} · ${matchMedia('(pointer: coarse)').matches ? 'dotyk' : 'mysz'} · ${devicePixelRatio}x`));
    const c = navigator.connection;
    if (c) box.appendChild(el('div', 'w-dim', `Siec: ${c.effectiveType || '?'}${c.downlink ? `, ok. ${c.downlink} Mb/s` : ''}${c.saveData ? ' (oszczedzanie danych)' : ''}`));
  });

  add('ping', 'Lacznosc', '📶', { every: 20000 }, async (box) => {
    const t0 = performance.now();
    let ok = true;
    try {
      await fetch('/api/health', { cache: 'no-store' });
    } catch {
      ok = false;
    }
    const ms = Math.round(performance.now() - t0);
    box.innerHTML = '';
    const hist = (window.__pingHist = window.__pingHist || []);
    if (ok) hist.push(ms);
    if (hist.length > 30) hist.shift();
    const big = el('div', 'w-big', ok ? `${ms} ms` : 'brak');
    big.style.color = !ok ? 'var(--red)' : ms < 200 ? 'var(--good)' : ms < 600 ? 'var(--amber)' : 'var(--red)';
    box.append(big, el('div', 'w-dim', `Serwer Jarvisa · srednio ${hist.length ? Math.round(hist.reduce((a, b) => a + b, 0) / hist.length) : '-'} ms (${hist.length} pomiarow)`));
    const cv = el('canvas');
    cv.style.cssText = 'width:100%;height:34px';
    box.appendChild(cv);
    const w = (cv.width = 300), h = (cv.height = 34);
    const g = cv.getContext('2d');
    const mx = Math.max(100, ...hist);
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#33e0ff';
    g.beginPath();
    hist.forEach((v, i) => { const x = (i / Math.max(1, hist.length - 1)) * (w - 4) + 2, y = h - 3 - (v / mx) * (h - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  });

  add('perf', 'Wydajnosc interfejsu', '⚡', { every: 4000 }, async (box) => {
    const frames = await new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const loop = (t) => { n++; if (t - t0 < 700) requestAnimationFrame(loop); else res((n * 1000) / (t - t0)); };
      requestAnimationFrame(loop);
    });
    box.innerHTML = '';
    box.appendChild(progressBar('Klatki/s', Math.min(100, (frames / 60) * 100), `${Math.round(frames)} fps`));
    const mem = performance.memory;
    if (mem) box.appendChild(el('div', 'w-dim', `Pamiec strony: ${Math.round(mem.usedJSHeapSize / 1048576)} MB · tryb hologramu: ${document.body.dataset.holo || '-'} · animacje: ${localStorage.getItem('jarvis.motion') || 'full'}`));
    if (frames < 25 && document.body.dataset.holo === 'full') box.appendChild(el('div', 'w-dim', 'Wolno? Ustawienia → Hologram → Subtelny.'));
  });

  add('services', 'Status uslug', '🔌', { owner: true, every: 60000 }, async (box) => {
    const h = await fetch('/api/health').then((r) => r.json()).catch(() => ({}));
    const sp = await api('/api/spotify/status').catch(() => ({}));
    box.innerHTML = '';
    const rows = [
      ['Serwer', h.status === 'online', `v${h.version || '?'}`],
      ['Klucz Gemini', h.geminiKeyWorks, h.geminiKeyWorks === false ? 'zly klucz' : ''],
      ['Klucz Edith', h.edithKeyWorks, h.edithOwnKey ? 'wlasny' : 'wspolny'],
      ['Spotify', sp.connected, sp.configured ? (sp.connected ? 'polaczone' : 'niepolaczone') : 'brak kluczy'],
      ['Kalendarz', h.calendarConnected, ''],
      ['Pamiec trwala', h.memoryPersistent, h.memoryPersistent ? '' : 'ulotna'],
      ['Push', h.pushConfigured, ''],
      ['Aplikacja PC', Boolean(window.jarvisDesktop), window.jarvisDesktop ? `v${window.jarvisDesktop.version || ''}` : 'przegladarka'],
    ];
    const l = el('div', 'w-list');
    rows.forEach(([n, ok, note]) => {
      const it = el('div', 'it');
      const dot = el('span', null, ok === true ? '●' : ok === false ? '○' : '◌');
      dot.style.color = ok === true ? 'var(--good)' : ok === false ? 'var(--red)' : 'var(--dim)';
      const left = el('span');
      left.append(dot, document.createTextNode(' ' + n));
      it.append(left, el('span', null, note));
      l.appendChild(it);
    });
    box.appendChild(l);
  });

  add('camera-w', 'Kamery', '◉', { owner: true, every: 30000 }, async (box) => {
    const r = await api('/api/cameras/events').catch(() => ({ events: [] }));
    const st = await api('/api/cameras').catch(() => ({ cameras: [] }));
    box.innerHTML = '';
    box.appendChild(el('div', 'w-dim', st.cameras.length ? st.cameras.map((c) => `${c.online ? '●' : '○'} ${c.camera}`).join('  ') : 'Brak aktywnych kamer.'));
    const e = r.events[0];
    if (e) {
      box.appendChild(el('div', 'w-mid', `${e.notable ? '⚠ ' : ''}${e.camera}`));
      box.appendChild(el('div', 'w-dim', `${hm(e.at)} · ${e.description || ''}`));
    } else box.appendChild(el('div', 'w-empty', 'Brak zdarzen.'));
  });

  add('money-w', 'Wydatki miesiaca', '◆', { owner: true, every: 300000 }, async (box) => {
    const r = await api('/api/expenses').catch(() => null);
    box.innerHTML = '';
    if (!r) return none(box, 'Brak danych.');
    const list = r.expenses || [];
    const ym = new Date().toISOString().slice(0, 7);
    const mine = list.filter((e) => new Date(e.ts || e.at || 0).toISOString().slice(0, 7) === ym);
    const total = mine.reduce((s, e) => s + Number(e.amount || 0), 0);
    box.appendChild(el('div', 'w-big', `${total.toFixed(2)} zl`));
    const cats = {};
    mine.forEach((e) => (cats[e.category || 'inne'] = (cats[e.category || 'inne'] || 0) + Number(e.amount || 0)));
    const l = el('div', 'w-list');
    Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([c, v]) => { const it = el('div', 'it'); it.append(el('span', null, c), el('span', null, v.toFixed(2) + ' zl')); l.appendChild(it); });
    box.appendChild(l.children.length ? l : el('div', 'w-empty', 'Brak wydatkow w tym miesiacu.'));
  });

  add('notif-w', 'Ostatnie powiadomienia', '🔔', { owner: true, every: 30000 }, (box) => {
    box.innerHTML = '';
    const items = (UI.notifications?.() || []).slice(0, 4);
    if (!items.length) return none(box, 'Cisza.');
    const l = el('div', 'w-list');
    items.forEach((n) => { const it = el('div', 'it'); it.append(el('span', null, n.text.slice(0, 55)), el('span', null, hm(n.at))); l.appendChild(it); });
    box.appendChild(l);
  });

  // ---------- Jarvis ----------
  add('advice', 'Jarvis radzi', '✦', { owner: true, wide: true, every: 300000, events: ['jarvis:life'] }, async (box) => {
    const tips = [];
    const now = new Date();
    const h = now.getHours();
    const t = UI.dayKey(now);
    const [habits, d, todos] = await Promise.all([L().list('habits').catch(() => []), L().daily().catch(() => ({ water: 0 })), api('/api/todos').then((r) => r.todos).catch(() => [])]);
    const goal = Number(localStorage.getItem('jarvis.waterGoal') || 8);
    const left = habits.filter((x) => !x.days.includes(t));
    if (h >= 18 && left.length) tips.push(`Zostaly Ci nawyki na dzis: ${left.slice(0, 3).map((x) => x.name).join(', ')}. Jeszcze zdazysz.`);
    habits.filter((x) => UI.habitStreak(x.days) >= 5 && !x.days.includes(t)).forEach((x) => tips.push(`Seria „${x.name}” trwa ${UI.habitStreak(x.days)} dni - nie przerywaj jej dzis.`));
    if (h >= 12 && d.water < goal / 2) tips.push(`Wypiles dopiero ${d.water} z ${goal} szklanek wody.`);
    const open = (todos || []).filter((x) => !x.done);
    if (open.length > 8) tips.push(`Masz ${open.length} otwartych zadan - moze warto wybrac trzy najwazniejsze?`);
    if (h >= 23 || h < 5) tips.push('Jest pozno, sir. Sen to tez produktywnosc.');
    if (!d.mood && h >= 20) tips.push('Nie zapisales dzis nastroju - to 2 sekundy.');
    const events = UI.events?.() || [];
    if (events.filter((e) => e.kind === 'warn' || e.kind === 'err').length > 3) tips.push('Kilka ostrzezen w dzienniku zdarzen - zerknij do powiadomien.');
    if (!tips.length) tips.push(h < 12 ? 'Dzien dobry, sir. Wszystko w porzadku - to dobry moment na najtrudniejsze zadanie.' : 'Wszystkie systemy sprawne, sir. Nic nie wymaga Twojej uwagi.');
    box.innerHTML = '';
    tips.slice(0, 3).forEach((x) => box.appendChild(el('div', 'w-mid', '• ' + x)));
  });

  add('jstats', 'Statystyki Jarvisa', '∑', { owner: true, every: 300000, events: ['jarvis:life'] }, async (box) => {
    const [j, a, rem] = await Promise.all([L().list('journal', true).catch(() => []), api('/api/audit?limit=500').catch(() => ({ entries: [] })), api('/api/memory').catch(() => ({ facts: [] }))]);
    const first = localStorage.getItem('jarvis.firstSeen') || (localStorage.setItem('jarvis.firstSeen', String(Date.now())), String(Date.now()));
    const days = Math.max(1, Math.ceil((Date.now() - Number(first)) / 86400000));
    box.innerHTML = '';
    const week = Date.now() - 7 * 86400000;
    const rows = [
      ['Dni z Jarvisem (na tym urzadzeniu)', days],
      ['Akcje na komputerze (ostatnie 500)', a.entries.length],
      ['Akcje w tym tygodniu', a.entries.filter((e) => e.at >= week).length],
      ['Wpisy w dzienniku', j.length],
      ['Zapamietane fakty', (rem.facts || []).length],
    ];
    const l = el('div', 'w-list');
    rows.forEach(([n, v]) => { const it = el('div', 'it'); it.append(el('span', null, n), el('span', null, String(v))); l.appendChild(it); });
    box.appendChild(l);
  });

  add('records', 'Rekordy', '🏆', { owner: true, every: 600000, events: ['jarvis:life'] }, async (box) => {
    const hs = await L().list('habits').catch(() => []);
    box.innerHTML = '';
    if (!hs.length) return none(box, 'Rekordy pojawia sie z nawykami.');
    const best = (days) => { const s = [...new Set(days)].sort(); let b = 0, c = 0, p = null; for (const d of s) { c = p && UI.addDays(p, 1) === d ? c + 1 : 1; b = Math.max(b, c); p = d; } return b; };
    const l = el('div', 'w-list');
    hs.map((h) => ({ h, b: best(h.days), cur: UI.habitStreak(h.days) })).sort((a, b) => b.b - a.b).slice(0, 4).forEach((x) => {
      const it = el('div', 'it');
      it.append(el('span', null, `${x.h.icon} ${x.h.name}`), el('span', null, `rekord ${x.b} (teraz ${x.cur})`));
      l.appendChild(it);
    });
    box.appendChild(l);
    const jt = JSON.parse(localStorage.getItem('jarvis.focusRecord') || '0');
    if (jt) box.appendChild(el('div', 'w-dim', `Najdluzsze skupienie: ${jt} min`));
  });

  add('knowledge', 'Z pamieci', '❖', { owner: true, every: 900000 }, async (box) => {
    const r = await api('/api/memory').catch(() => ({ facts: [] }));
    box.innerHTML = '';
    const facts = (r.facts || []).map((f) => (typeof f === 'string' ? f : f.text || '')).filter(Boolean);
    if (!facts.length) return none(box, 'Jarvis jeszcze nic o Tobie nie zapamietal. Powiedz: "zapamietaj, ze...".');
    box.append(el('div', 'w-mid', facts[Math.floor(Date.now() / 900000) % facts.length]), el('div', 'w-dim', `Jeden z ${facts.length} faktow, ktore Jarvis pamieta.`));
  });

  add('today-hist', 'Dzis w dzienniku', '☰', { owner: true, every: 120000, events: ['jarvis:life'] }, async (box) => {
    const j = await L().list('journal', true).catch(() => []);
    const t = UI.dayKey(new Date());
    const mine = j.filter((e) => UI.dayKey(new Date(e.at)) === t).slice(0, 5);
    box.innerHTML = '';
    if (!mine.length) return none(box, 'Dziennik dzisiaj pusty.');
    const l = el('div', 'w-list');
    mine.forEach((e) => { const it = el('div', 'it'); it.append(el('span', null, e.text.slice(0, 52)), el('span', null, hm(e.at))); l.appendChild(it); });
    box.appendChild(l);
  });

  add('shortcuts', 'Skroty', '⌨', {}, (box) => {
    box.innerHTML = '';
    const l = el('div', 'w-list');
    [['Ctrl + K', 'paleta polecen i szukanie'], ['Ctrl + /', 'pomoc i skroty'], ['Alt + 1…9', 'moduly z szyny'], ['Ctrl + Alt + S', 'zaznacz fragment ekranu (PC)'], ['Ctrl + Alt + J', 'Jarvis (PC)'], ['Esc', 'wstecz / zamknij'], ['"Jarvis"', 'slowo budzace']].forEach(([k, v]) => { const it = el('div', 'it'); it.append(el('span', null, k), el('span', null, v)); l.appendChild(it); });
    box.appendChild(l);
  });
})();
