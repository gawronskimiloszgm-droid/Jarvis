// Wizualizacje holograficzne (canvas 2D, bez bibliotek):
//  - zegar orbitalny, radar systemu, pierscienie dnia/roku, mapa cieplna aktywnosci,
//  - wykres CPU na zywo, slupki 3D czasu pracy, wykres kolowy wydatkow,
//  - spektrogram i oscyloskop dzwieku (Web Audio AnalyserNode z odtwarzanej mowy/muzyki),
//  - mapa polaczen Jarvis - Edith - uslugi z plynacymi czastkami.
// Kazda to widzet Pulpitu (UI.addHomeWidget) i/lub panel w module "Wizualizacje".
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, isOwner } = UI;

  const css = () => getComputedStyle(document.documentElement);
  const color = () => css().getPropertyValue('--blue').trim() || '#33e0ff';
  const rgb = (hex) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [51, 224, 255];
  };
  const rgba = (a) => {
    const [r, g, b] = rgb(color());
    return `rgba(${r},${g},${b},${a})`;
  };

  // Plotno z automatycznym DPR i petla animacji, ktora zatrzymuje sie, gdy plotno znika.
  function animCanvas(box, h, draw, fps = 30) {
    const cv = el('canvas');
    cv.style.cssText = `width:100%;height:${h}px;display:block`;
    box.appendChild(cv);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = 0;
    const size = () => {
      w = Math.max(40, cv.clientWidth || 300);
      cv.width = w * dpr;
      cv.height = h * dpr;
    };
    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(cv);
    const g = cv.getContext('2d');
    let last = 0;
    const loop = (now) => {
      if (!document.body.contains(cv)) return;
      requestAnimationFrame(loop);
      const mode = document.body.dataset.holo;
      if (document.visibilityState !== 'visible' || cv.offsetParent === null) return;
      if (now - last < (mode === 'off' ? 1000 : 1000 / fps)) return;
      last = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      draw(g, w, h, now / 1000);
    };
    requestAnimationFrame(loop);
    return cv;
  }

  // ---------- analizator dzwieku: podpinany pod wspolny lancuch glosu ----------
  // voicefx.js tworzy wejscie lancucha (UI.voiceFx); my doklejamy rozgalezienie do AnalyserNode.
  const AN = { node: null, ctx: null, data: null, time: null };
  UI.audioAnalyser = (ctx) => {
    if (!AN.node || AN.ctx !== ctx) {
      AN.ctx = ctx;
      AN.node = ctx.createAnalyser();
      AN.node.fftSize = 512;
      AN.node.smoothingTimeConstant = 0.78;
      AN.data = new Uint8Array(AN.node.frequencyBinCount);
      AN.time = new Uint8Array(AN.node.fftSize);
    }
    return AN.node;
  };
  // Poziom z analizatora zasila rdzen i scene (UI.store.audioLevel).
  function pumpLevel() {
    if (AN.node) {
      AN.node.getByteFrequencyData(AN.data);
      let sum = 0;
      for (let i = 0; i < 40; i++) sum += AN.data[i];
      const lvl = sum / 40 / 255;
      if (lvl > 0.02 && UI.store) UI.store.audioLevel = Math.max(UI.store.audioLevel || 0, Math.min(1, lvl * 1.6));
    }
    requestAnimationFrame(pumpLevel);
  }
  requestAnimationFrame(pumpLevel);

  // ---------- widzety ----------
  const add = (id, title, glyph, opts, render) => UI.addHomeWidget && UI.addHomeWidget({ id, title, glyph, ...opts, render });

  add('orbit', 'Zegar orbitalny', '◎', {}, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    animCanvas(box, 150, (g, w, h, t) => {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 6;
      const d = new Date();
      const sec = d.getSeconds() + d.getMilliseconds() / 1000;
      const min = d.getMinutes() + sec / 60;
      const hr = (d.getHours() % 12) + min / 60;
      const rings = [[R, hr / 12, 'h'], [R * 0.72, min / 60, 'm'], [R * 0.46, sec / 60, 's']];
      g.lineWidth = 1.5;
      rings.forEach(([r, f, k], i) => {
        g.strokeStyle = rgba(0.18);
        g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
        g.strokeStyle = rgba(0.85 - i * 0.15);
        g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + f * 6.283); g.stroke();
        const a = -Math.PI / 2 + f * 6.283;
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4 - i, 0, 6.283); g.fill();
        g.lineWidth = 1.5;
      });
      g.fillStyle = css().getPropertyValue('--bright').trim() || '#fff';
      g.font = '600 15px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, cx, cy - 2);
      g.font = '9px monospace'; g.fillStyle = rgba(0.7);
      g.fillText(d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(), cx, cy + 14);
    }, 20);
  });

  add('rings', 'Pierscienie czasu', '◍', {}, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    animCanvas(box, 130, (g, w, h) => {
      const n = new Date();
      const day = (n.getHours() * 60 + n.getMinutes()) / 1440;
      const wk = (((n.getDay() + 6) % 7) * 24 + n.getHours()) / 168;
      const start = new Date(n.getFullYear(), 0, 1);
      const yr = (n - start) / (new Date(n.getFullYear() + 1, 0, 1) - start);
      const items = [['DZIEN', day], ['TYDZIEN', wk], ['ROK', yr]];
      items.forEach(([label, f], i) => {
        const cx = (w / 3) * (i + 0.5), cy = h / 2 - 4, r = 36;
        g.lineWidth = 7; g.strokeStyle = rgba(0.14);
        g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
        g.strokeStyle = rgba(0.9); g.lineCap = 'round';
        g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + f * 6.283); g.stroke();
        g.fillStyle = css().getPropertyValue('--bright').trim() || '#fff';
        g.font = '600 14px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(`${Math.round(f * 100)}%`, cx, cy);
        g.font = '9px monospace'; g.fillStyle = rgba(0.7);
        g.fillText(label, cx, cy + r + 14);
      });
    }, 4);
  });

  const CPU = (window.__cpuHist = window.__cpuHist || []);
  add('radar', 'Radar systemu', '◈', { owner: true, every: 10000 }, async (box) => {
    let s = null;
    try {
      const r = await api('/api/telemetry/history');
      const m = r.machines.find((x) => x.online) || r.machines[0];
      s = m && m.samples[m.samples.length - 1];
      if (m) m.samples.slice(-40).forEach((x, i) => { if (i === 0) CPU.length = 0; CPU.push(x.cpu); });
    } catch {
      /* bez telemetrii radar pokazuje same siatke */
    }
    window.__radarState = s;
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    animCanvas(box, 170, (g, w, h, t) => {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 14;
      for (let i = 1; i <= 4; i++) { g.strokeStyle = rgba(0.12 + i * 0.03); g.beginPath(); g.arc(cx, cy, (R * i) / 4, 0, 6.283); g.stroke(); }
      const axes = ['CPU', 'RAM', 'DYSK', 'SIEC', 'GPU'];
      const st = window.__radarState || {};
      const vals = [st.cpu, st.ram, st.disk, 20 + 15 * Math.sin(t), 10 + 8 * Math.sin(t * 0.7)].map((v) => Math.max(0, Math.min(100, v == null ? 0 : v)));
      axes.forEach((a, i) => {
        const ang = -Math.PI / 2 + (i / axes.length) * 6.283;
        g.strokeStyle = rgba(0.2); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); g.stroke();
        g.fillStyle = rgba(0.8); g.font = '9px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(a, cx + Math.cos(ang) * (R + 10), cy + Math.sin(ang) * (R + 10));
      });
      g.beginPath();
      vals.forEach((v, i) => { const ang = -Math.PI / 2 + (i / axes.length) * 6.283; const x = cx + Math.cos(ang) * R * (v / 100), y = cy + Math.sin(ang) * R * (v / 100); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath(); g.fillStyle = rgba(0.22); g.fill(); g.strokeStyle = rgba(0.95); g.lineWidth = 2; g.stroke();
      const sweep = (t * 1.2) % 6.283;
      const grad = g.createConicGradient ? g.createConicGradient(sweep, cx, cy) : null;
      if (grad) { grad.addColorStop(0, rgba(0.35)); grad.addColorStop(0.12, rgba(0)); grad.addColorStop(1, rgba(0)); g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill(); }
    }, 24);
  });

  add('cpu-live', 'Procesor na zywo', '∿', { owner: true, every: 10000 }, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    box.appendChild(el('div', 'w-dim', 'Ostatnie odczyty z komputera (co 30 s)'));
    animCanvas(box, 80, (g, w, h) => {
      if (CPU.length < 2) { g.fillStyle = rgba(0.5); g.font = '11px monospace'; g.fillText('Brak odczytow - uruchom aplikacje desktopowa.', 10, h / 2); return; }
      g.beginPath();
      CPU.forEach((v, i) => { const x = (i / (CPU.length - 1)) * (w - 4) + 2, y = h - 4 - (v / 100) * (h - 10); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.lineTo(w - 2, h - 2); g.lineTo(2, h - 2); g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, rgba(0.4)); gr.addColorStop(1, rgba(0.02)); g.fillStyle = gr; g.fill();
      g.strokeStyle = rgba(0.95); g.lineWidth = 1.8; g.beginPath();
      CPU.forEach((v, i) => { const x = (i / (CPU.length - 1)) * (w - 4) + 2, y = h - 4 - (v / 100) * (h - 10); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    }, 10);
  });

  add('spectro', 'Spektrogram dzwieku', '▁▃▅▇', { wide: true }, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    const hist = [];
    animCanvas(box, 120, (g, w, h, t) => {
      const live = AN.node && (AN.node.getByteFrequencyData(AN.data), true);
      const bars = 48;
      const barW = w / bars;
      const lvl = UI.store?.audioLevel || 0;
      const row = [];
      for (let i = 0; i < bars; i++) {
        let v;
        if (live) { const idx = Math.floor(Math.pow(i / bars, 1.6) * (AN.data.length * 0.85)); v = AN.data[idx] / 255; }
        else v = 0.05 + 0.04 * Math.sin(t * 2 + i * 0.4) + lvl * (0.5 + 0.5 * Math.sin(t * 5 + i));
        row.push(Math.max(0, Math.min(1, v)));
      }
      hist.unshift(row);
      if (hist.length > 18) hist.pop();
      // przeszlosc w glab (pseudo-3D): starsze wiersze mniejsze i przezroczystsze
      for (let k = hist.length - 1; k >= 0; k--) {
        const f = 1 - k / 20;
        const oy = (k * 3.2);
        hist[k].forEach((v, i) => {
          const bh = v * (h * 0.7) * f;
          g.fillStyle = rgba((0.08 + 0.55 * v) * f);
          g.fillRect(i * barW + barW * 0.1 + k * 1.2, h - oy - bh - 4, barW * 0.8, bh);
        });
      }
      g.strokeStyle = rgba(0.3); g.beginPath(); g.moveTo(0, h - 3); g.lineTo(w, h - 3); g.stroke();
    }, 30);
  });

  add('scope', 'Oscyloskop', '〰', {}, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    animCanvas(box, 80, (g, w, h, t) => {
      g.strokeStyle = rgba(0.12);
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (h * i) / 4); g.lineTo(w, (h * i) / 4); g.stroke(); }
      const lvl = UI.store?.audioLevel || 0;
      g.strokeStyle = rgba(0.95); g.lineWidth = 2; g.beginPath();
      if (AN.node) AN.node.getByteTimeDomainData(AN.time);
      for (let x = 0; x < w; x += 2) {
        let y;
        if (AN.node) y = ((AN.time[Math.floor((x / w) * AN.time.length)] - 128) / 128) * (h / 2.2);
        else y = Math.sin(x * 0.05 + t * 4) * (3 + lvl * 28) * Math.sin(x * 0.01 + t);
        x ? g.lineTo(x, h / 2 + y) : g.moveTo(x, h / 2 + y);
      }
      g.stroke();
    }, 40);
  });

  add('netmap', 'Mapa polaczen', '⌬', { owner: true, wide: true, every: 30000 }, async (box) => {
    const h = await fetch('/api/health').then((r) => r.json()).catch(() => ({}));
    const sp = await api('/api/spotify/status').catch(() => ({}));
    window.__netState = { server: h.status === 'online', gemini: h.geminiKeyWorks !== false, edith: h.edithKeyWorks !== false, spotify: Boolean(sp.connected), cal: Boolean(h.calendarConnected), push: Boolean(h.pushConfigured), mem: Boolean(h.memoryPersistent), pc: Boolean(window.jarvisDesktop) };
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    const nodes = [
      { id: 'jarvis', label: 'JARVIS', x: 0.5, y: 0.5, r: 18, core: true },
      { id: 'edith', label: 'E.D.I.T.H.', x: 0.82, y: 0.2, r: 12, red: true },
      { id: 'server', label: 'SERWER', x: 0.5, y: 0.14, r: 11 },
      { id: 'gemini', label: 'GEMINI', x: 0.2, y: 0.22, r: 10 },
      { id: 'pc', label: 'PC', x: 0.14, y: 0.62, r: 11 },
      { id: 'spotify', label: 'SPOTIFY', x: 0.3, y: 0.88, r: 9 },
      { id: 'cal', label: 'KALENDARZ', x: 0.62, y: 0.9, r: 9 },
      { id: 'mem', label: 'PAMIEC', x: 0.86, y: 0.7, r: 9 },
      { id: 'push', label: 'PUSH', x: 0.96, y: 0.46, r: 8 },
    ];
    const links = [['jarvis', 'edith'], ['jarvis', 'server'], ['server', 'gemini'], ['jarvis', 'pc'], ['jarvis', 'spotify'], ['jarvis', 'cal'], ['server', 'mem'], ['server', 'push'], ['edith', 'pc']];
    const parts = links.map(() => Math.random());
    animCanvas(box, 220, (g, w, hh, t) => {
      const ns = window.__netState || {};
      const P = (id) => nodes.find((n) => n.id === id);
      const on = (id) => id === 'jarvis' || id === 'edith' ? true : ns[id] !== false && ns[id] !== undefined ? Boolean(ns[id]) : false;
      links.forEach(([a, b], i) => {
        const A = P(a), B = P(b);
        const ax = A.x * w, ay = A.y * hh, bx = B.x * w, by = B.y * hh;
        const live = on(a) && on(b);
        g.strokeStyle = live ? rgba(0.35) : 'rgba(255,255,255,0.08)';
        g.setLineDash(live ? [] : [3, 5]); g.lineWidth = 1; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
        if (live) {
          parts[i] = (parts[i] + 0.004 + (UI.store?.audioLevel || 0) * 0.01) % 1;
          const px = ax + (bx - ax) * parts[i], py = ay + (by - ay) * parts[i];
          g.fillStyle = (A.red || B.red) ? 'rgba(255,90,90,.95)' : rgba(1); g.beginPath(); g.arc(px, py, 2.2, 0, 6.283); g.fill();
        }
      });
      nodes.forEach((n) => {
        const x = n.x * w, y = n.y * hh, live = on(n.id);
        const pulse = n.core ? 1 + 0.12 * Math.sin(t * 2) + (UI.store?.audioLevel || 0) * 0.3 : 1;
        const c = n.red ? '255,70,70' : rgb(color()).join(',');
        g.fillStyle = live ? `rgba(${c},0.18)` : 'rgba(255,255,255,0.04)';
        g.strokeStyle = live ? `rgba(${c},0.95)` : 'rgba(255,255,255,0.25)';
        g.lineWidth = n.core ? 2 : 1.4;
        g.beginPath(); g.arc(x, y, n.r * pulse, 0, 6.283); g.fill(); g.stroke();
        g.fillStyle = live ? `rgba(${c},1)` : 'rgba(255,255,255,0.4)';
        g.font = '9px monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillText(n.label, x, y + n.r * pulse + 4);
      });
    }, 30);
  });

  // ---------- dane z API do wykresow ----------
  add('worktime-3d', 'Czas pracy (7 dni)', '▮', { owner: true, every: 600000 }, async (box) => {
    const r = await api('/api/worktime').catch(() => ({ byDay: {} }));
    const days = [];
    for (let i = 6; i >= 0; i--) { const k = UI.addDays(UI.dayKey(new Date()), -i); days.push({ k, sec: Object.values(r.byDay?.[k] || {}).reduce((a, b) => a + b, 0) }); }
    box.innerHTML = '';
    if (!days.some((d) => d.sec)) { box.appendChild(el('div', 'w-empty', 'Brak danych - czas pracy mierzy aplikacja desktopowa.')); return; }
    const mx = Math.max(...days.map((d) => d.sec), 1);
    animCanvas(box, 110, (g, w, h) => {
      const bw = w / 7;
      days.forEach((d, i) => {
        const bh = (d.sec / mx) * (h - 28), x = i * bw + bw * 0.2, y = h - 14 - bh, ww = bw * 0.6, dp = 8;
        g.fillStyle = rgba(0.55); g.fillRect(x, y, ww, bh);                                  // front
        g.fillStyle = rgba(0.3); g.beginPath(); g.moveTo(x, y); g.lineTo(x + dp, y - dp * 0.6); g.lineTo(x + ww + dp, y - dp * 0.6); g.lineTo(x + ww, y); g.fill(); // gora
        g.fillStyle = rgba(0.18); g.beginPath(); g.moveTo(x + ww, y); g.lineTo(x + ww + dp, y - dp * 0.6); g.lineTo(x + ww + dp, y - dp * 0.6 + bh); g.lineTo(x + ww, y + bh); g.fill(); // bok
        g.fillStyle = rgba(0.8); g.font = '9px monospace'; g.textAlign = 'center';
        g.fillText(['nd', 'pn', 'wt', 'sr', 'cz', 'pt', 'sb'][new Date(d.k + 'T12:00:00').getDay()], x + ww / 2, h - 3);
        if (d.sec) g.fillText(`${(d.sec / 3600).toFixed(1)}h`, x + ww / 2 + 3, y - 10);
      });
    }, 2);
  });

  add('expense-pie', 'Wydatki wg kategorii', '◔', { owner: true, every: 600000 }, async (box) => {
    const r = await api('/api/expenses').catch(() => null);
    box.innerHTML = '';
    const ym = new Date().toISOString().slice(0, 7);
    const cats = {};
    ((r && r.expenses) || []).filter((e) => new Date(e.ts || 0).toISOString().slice(0, 7) === ym).forEach((e) => (cats[e.category || 'inne'] = (cats[e.category || 'inne'] || 0) + Number(e.amount || 0)));
    const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!entries.length) { box.appendChild(el('div', 'w-empty', 'Brak wydatkow w tym miesiacu.')); return; }
    const total = entries.reduce((s, e) => s + e[1], 0);
    const hues = [190, 150, 45, 290, 10, 220];
    let grow = 0;
    animCanvas(box, 130, (g, w, h) => {
      grow = Math.min(1, grow + 0.04);
      const cx = 70, cy = h / 2, R = 52;
      let a0 = -Math.PI / 2;
      entries.forEach(([c, v], i) => {
        const a1 = a0 + (v / total) * 6.283 * grow;
        g.fillStyle = `hsla(${hues[i % 6]},80%,60%,.8)`;
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill();
        a0 = a1;
      });
      g.fillStyle = 'rgba(4,12,16,.95)'; g.beginPath(); g.arc(cx, cy, R * 0.58, 0, 6.283); g.fill();
      g.fillStyle = css().getPropertyValue('--bright').trim() || '#fff'; g.font = '600 12px monospace'; g.textAlign = 'center'; g.fillText(`${total.toFixed(0)} zl`, cx, cy + 4);
      g.textAlign = 'left'; g.font = '11px monospace';
      entries.forEach(([c, v], i) => { g.fillStyle = `hsl(${hues[i % 6]},80%,65%)`; g.fillRect(150, 18 + i * 18, 9, 9); g.fillStyle = css().getPropertyValue('--txt').trim() || '#cde'; g.fillText(`${c} ${v.toFixed(0)} zl`, 166, 27 + i * 18); });
    }, 20);
  });

  add('activity-heat', 'Aktywnosc (dziennik)', '▦', { owner: true, wide: true, every: 900000, events: ['jarvis:life'] }, async (box) => {
    const j = await UI.life.list('journal', true).catch(() => []);
    const counts = {};
    j.forEach((e) => { const k = UI.dayKey(new Date(e.at)); counts[k] = (counts[k] || 0) + 1; });
    box.innerHTML = '';
    const heat = el('div', 'heat');
    const mx = Math.max(1, ...Object.values(counts));
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 7 * 20 + 1 - ((start.getDay() + 6) % 7));
    for (let w = 0; w < 20; w++) {
      const col = el('div', 'heat-col');
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + d);
        const k = UI.dayKey(dt);
        const cell = el('i');
        cell.style.opacity = dt > end ? '0' : String(0.1 + (0.9 * (counts[k] || 0)) / mx);
        cell.title = `${k}: ${counts[k] || 0} wpisow`;
        col.appendChild(cell);
      }
      heat.appendChild(col);
    }
    box.append(heat, el('div', 'w-dim', `Ostatnie 20 tygodni · ${j.length} wpisow`));
  });
})();
