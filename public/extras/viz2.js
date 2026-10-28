// Dalsze wizualizacje: holograficzny globus z Twoja pozycja, fazy ksiezyca, kompas wiatru,
// pierscien baterii, wykres opoznienia sieci i fala odpowiedzi Jarvisa. Kolor sceny
// delikatnie zalezy od nastroju dnia (data-mood na body).
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.addHomeWidget) return;
  const { el, store } = UI;

  const css = () => getComputedStyle(document.documentElement);
  const accent = () => css().getPropertyValue('--blue').trim() || '#33e0ff';
  const rgb = () => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(accent());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [51, 224, 255];
  };
  const rgba = (a) => `rgba(${rgb().join(',')},${a})`;

  function canvas(box, h, draw, fps = 24) {
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
      if (document.visibilityState !== 'visible' || cv.offsetParent === null) return;
      if (now - last < 1000 / (document.body.dataset.holo === 'off' ? 1 : fps)) return;
      last = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      draw(g, w, h, now / 1000);
    };
    requestAnimationFrame(loop);
    return cv;
  }

  const add = (id, title, glyph, opts, render) => UI.addHomeWidget({ id, title, glyph, ...opts, render });

  // ---------- globus ----------
  add('globe', 'Globus', '◍', {}, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    const loc = store.location || { lat: 52.23, lon: 21.01 };
    const cities = [[52.23, 21.01], [51.5, -0.12], [40.7, -74], [35.7, 139.7], [-33.9, 151.2], [25.2, 55.3], [-23.5, -46.6], [55.7, 37.6]];
    box.appendChild(el('div', 'w-dim', store.location ? 'Twoja pozycja (GPS)' : 'Warszawa (pozycja domyslna)'));
    canvas(box, 170, (g, w, h, t) => {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8;
      const spin = t * 0.25;
      const proj = (lat, lon) => {
        const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180 + spin;
        const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
        return [cx + x * R, cy - y * R, z];
      };
      g.strokeStyle = rgba(0.5);
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.stroke();
      g.lineWidth = 0.7;
      for (let lat = -60; lat <= 60; lat += 30) {
        g.strokeStyle = rgba(0.18);
        g.beginPath();
        for (let lon = -180; lon <= 180; lon += 6) {
          const p = proj(lat, lon);
          if (p[2] > 0) { g.lineTo(p[0], p[1]); } else { g.moveTo(p[0], p[1]); }
        }
        g.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        g.strokeStyle = rgba(0.18);
        g.beginPath();
        for (let lat = -90; lat <= 90; lat += 6) {
          const p = proj(lat, lon);
          if (p[2] > 0) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
        }
        g.stroke();
      }
      cities.forEach(([la, lo]) => {
        const p = proj(la, lo);
        if (p[2] > 0) { g.fillStyle = rgba(0.7); g.beginPath(); g.arc(p[0], p[1], 2, 0, 6.283); g.fill(); }
      });
      const me = proj(loc.lat, loc.lon);
      if (me[2] > 0) {
        const pulse = 4 + 3 * Math.sin(t * 4);
        g.strokeStyle = '#ff6b6b';
        g.lineWidth = 1.4;
        g.beginPath(); g.arc(me[0], me[1], pulse, 0, 6.283); g.stroke();
        g.fillStyle = '#ff6b6b';
        g.beginPath(); g.arc(me[0], me[1], 2.5, 0, 6.283); g.fill();
      }
    }, 20);
  });

  // ---------- fazy ksiezyca ----------
  const SYN = 29.530588853;
  // Wiek ksiezyca od nowiu referencyjnego 2000-01-06 18:14 UTC (0 = nowiu, .5 = pelnia).
  const phaseOf = (d) => ((((d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000 / SYN) % 1) + 1) % 1;
  const PHASE_NAMES = ['Nowiu', 'Rosnacy sierp', 'Pierwsza kwadra', 'Rosnacy garb', 'Pelnia', 'Malejacy garb', 'Ostatnia kwadra', 'Malejacy sierp'];
  add('moon', 'Faza ksiezyca', '☾', { every: 3600000 }, (box) => {
    const ph = phaseOf(new Date());
    box.innerHTML = '';
    const row = el('div', 'w-row');
    const cv = el('canvas');
    cv.width = 120; cv.height = 120; cv.style.cssText = 'width:80px;height:80px';
    const g = cv.getContext('2d');
    const R = 52;
    g.translate(60, 60);
    g.strokeStyle = rgba(0.6); g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, R, 0, 6.283); g.stroke();
    // oswietlona czesc: polkole + elipsa terminatora
    const k = Math.cos(ph * 2 * Math.PI); // 1 nowiu, -1 pelnia
    g.fillStyle = rgba(0.85);
    g.beginPath();
    const waxing = ph < 0.5;
    g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, !waxing);
    g.ellipse(0, 0, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
    g.fill();
    const info = el('div');
    const idx = Math.round(ph * 8) % 8;
    const illum = Math.round(((1 - Math.cos(ph * 2 * Math.PI)) / 2) * 100);
    info.append(el('div', 'w-mid', PHASE_NAMES[idx]), el('div', 'w-dim', `Oswietlenie ${illum}%`), el('div', 'w-dim', `Pelnia za ${Math.round(((0.5 - ph + 1) % 1) * SYN)} dni`));
    row.append(cv, info);
    box.appendChild(row);
  });

  // ---------- kompas wiatru ----------
  add('compass', 'Kompas wiatru', '✧', { every: 1800000 }, async (box) => {
    const loc = store.location || { lat: 52.23, lon: 21.01 };
    let w = null;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=auto`).then((x) => x.json());
      w = r.current;
    } catch {
      /* brak sieci */
    }
    box.innerHTML = '';
    if (!w) { box.appendChild(el('div', 'w-empty', 'Brak danych o wietrze.')); return; }
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dir = dirs[Math.round(w.wind_direction_10m / 45) % 8];
    canvas(box, 130, (g, wd, h, t) => {
      const cx = 65, cy = h / 2, R = 52;
      g.strokeStyle = rgba(0.45); g.lineWidth = 1.2;
      g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.stroke();
      g.font = '10px monospace'; g.fillStyle = rgba(0.9); g.textAlign = 'center'; g.textBaseline = 'middle';
      [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, a]) => {
        const r = ((a - 90) * Math.PI) / 180;
        g.fillText(l, cx + Math.cos(r) * (R - 9), cy + Math.sin(r) * (R - 9));
      });
      // strzalka wskazuje, DOKAD wieje (kierunek z ktorego wieje + 180)
      const ang = ((w.wind_direction_10m + 180 - 90 + Math.sin(t * 2) * 2) * Math.PI) / 180;
      g.strokeStyle = '#ffb347'; g.fillStyle = '#ffb347'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(cx - Math.cos(ang) * 30, cy - Math.sin(ang) * 30); g.lineTo(cx + Math.cos(ang) * 32, cy + Math.sin(ang) * 32); g.stroke();
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * 40, cy + Math.sin(ang) * 40);
      g.lineTo(cx + Math.cos(ang + 2.6) * 9 + Math.cos(ang) * 26, cy + Math.sin(ang + 2.6) * 9 + Math.sin(ang) * 26);
      g.lineTo(cx + Math.cos(ang - 2.6) * 9 + Math.cos(ang) * 26, cy + Math.sin(ang - 2.6) * 9 + Math.sin(ang) * 26);
      g.fill();
      g.textAlign = 'left'; g.fillStyle = rgba(1); g.font = '600 20px monospace';
      g.fillText(`${Math.round(w.wind_speed_10m)}`, 140, cy - 10);
      g.font = '10px monospace'; g.fillStyle = rgba(0.7);
      g.fillText('km/h', 176, cy - 6);
      g.fillText(`z kierunku ${dir} (${Math.round(w.wind_direction_10m)}°)`, 140, cy + 10);
      g.fillText(`porywy ${Math.round(w.wind_gusts_10m || 0)} km/h`, 140, cy + 24);
    }, 12);
  });

  // ---------- pierscien baterii ----------
  add('battery-ring', 'Bateria', '▮', { every: 30000 }, async (box) => {
    let b = null;
    try {
      b = await navigator.getBattery();
    } catch {
      /* brak API baterii */
    }
    box.innerHTML = '';
    if (!b) { box.appendChild(el('div', 'w-empty', 'Ta przegladarka nie podaje stanu baterii.')); return; }
    canvas(box, 110, (g, w, h, t) => {
      const cx = 55, cy = h / 2, r = 40;
      g.lineWidth = 9; g.lineCap = 'round';
      g.strokeStyle = rgba(0.14);
      g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
      const lvl = b.level;
      g.strokeStyle = lvl < 0.2 ? '#ff5a5a' : lvl < 0.5 ? '#ffb347' : accent();
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + lvl * 6.283); g.stroke();
      if (b.charging) {
        const a = -Math.PI / 2 + ((t * 0.6) % 1) * 6.283;
        g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.5, 0, 6.283); g.fill();
      }
      g.fillStyle = css().getPropertyValue('--bright').trim() || '#fff';
      g.font = '600 16px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`${Math.round(lvl * 100)}%`, cx, cy);
      g.textAlign = 'left'; g.font = '11px monospace'; g.fillStyle = rgba(0.85);
      g.fillText(b.charging ? '⚡ ladowanie' : 'na baterii', 115, cy - 8);
      const min = b.charging ? b.chargingTime : b.dischargingTime;
      g.fillStyle = rgba(0.6);
      g.fillText(Number.isFinite(min) && min > 0 ? `${Math.floor(min / 3600)} h ${Math.round((min % 3600) / 60)} min` : '—', 115, cy + 10);
    }, 6);
  });

  // ---------- opoznienie sieci ----------
  const PING = (window.__pingHist = window.__pingHist || []);
  add('net-graph', 'Siec: opoznienie', '≋', { every: 8000 }, async (box) => {
    const t0 = performance.now();
    let ms = null;
    try {
      await fetch('/api/health', { cache: 'no-store' });
      ms = Math.round(performance.now() - t0);
    } catch {
      ms = null;
    }
    PING.push(ms);
    if (PING.length > 40) PING.shift();
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    canvas(box, 90, (g, w, h) => {
      const vals = PING.filter((v) => v != null);
      const mx = Math.max(100, ...vals);
      g.strokeStyle = rgba(0.12);
      g.beginPath(); g.moveTo(0, h - 14); g.lineTo(w, h - 14); g.stroke();
      g.strokeStyle = rgba(0.95); g.lineWidth = 1.8; g.beginPath();
      PING.forEach((v, i) => {
        const x = (i / Math.max(1, PING.length - 1)) * (w - 4) + 2;
        const y = v == null ? h - 14 : h - 16 - (v / mx) * (h - 32);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      const last = PING[PING.length - 1];
      g.fillStyle = last == null ? '#ff5a5a' : rgba(1); g.font = '600 12px monospace'; g.textAlign = 'left';
      g.fillText(last == null ? 'BRAK POLACZENIA' : `${last} ms`, 6, 12);
      if (vals.length) { g.fillStyle = rgba(0.6); g.font = '10px monospace'; g.textAlign = 'right'; g.fillText(`śr. ${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)} ms`, w - 6, 12); }
    }, 4);
  });

  // ---------- fala odpowiedzi ----------
  add('voicewave', 'Fala glosu Jarvisa', '≈', {}, (box) => {
    if (box._built) return;
    box._built = true;
    box.innerHTML = '';
    let amp = 0;
    canvas(box, 70, (g, w, h, t) => {
      const lvl = Math.min(1, store.audioLevel || 0);
      amp += (lvl - amp) * 0.2;
      for (let layer = 0; layer < 3; layer++) {
        g.strokeStyle = rgba(0.85 - layer * 0.25);
        g.lineWidth = 2 - layer * 0.5;
        g.beginPath();
        for (let x = 0; x <= w; x += 3) {
          const env = Math.sin((x / w) * Math.PI);
          const y = h / 2 + Math.sin(x * 0.04 + t * (3 + layer) + layer) * (3 + amp * 26) * env;
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
    }, 40);
  });

  // ---------- nastroj koloruje scene ----------
  // Kolor akcentu zostaje z motywu; zmieniamy tylko data-mood, z ktorego korzysta CSS (swiatlo tla).
  async function syncMood() {
    if (!UI.life || !UI.isOwner()) return;
    try {
      const d = await UI.life.daily();
      document.body.dataset.mood = d.mood ? String(d.mood) : '';
    } catch {
      /* bez nastroju */
    }
  }
  window.addEventListener('jarvis:ready', syncMood);
  window.addEventListener('jarvis:life', (e) => (!e.detail || e.detail.coll === 'daily') && syncMood());
})();
