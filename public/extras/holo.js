// Silnik hologramu ("antygrawitacja"):
//  - scena w tle modulu: perspektywiczna siatka-podloga, unoszace sie czastki i wolno
//    obracajace sie bryly druciane; reaguje na rozmowe (poziom dzwieku), alarm i muzyke,
//  - paralaksa: elementy przesuwaja sie wzgledem siebie za mysza (komputer) albo za
//    zyroskopem (telefon) - kazdy na innej glebokosci,
//  - glitch przy zmianie modulu i delikatne linie skanujace,
//  - tryby: full | subtle | off (Ustawienia -> Hologram), a przy "Animacje: oszczedne"
//    albo "wylaczone" sam przechodzi w tryb statyczny.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, store } = UI;

  const KEY = 'jarvis.holo';
  const get = (k, d) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  };
  const put = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ustawienie do zamkniecia karty */
    }
  };
  const touch = matchMedia('(pointer: coarse)').matches;
  const motion = () => get('jarvis.motion', 'full');
  // Efektywny tryb: animacje "oszczedne"/"wylaczone" zawsze tna ruch hologramu.
  function mode() {
    const m = motion();
    const want = get(KEY, touch ? 'subtle' : 'full');
    if (m === 'off') return 'off';
    if (m === 'low') return want === 'off' ? 'off' : 'subtle';
    return want;
  }

  function apply() {
    document.body.dataset.holo = mode();
    ensureFx();
  }

  // ---------- nakladki: glitch + linie ----------
  let glitch = null;
  let lines = null;
  function ensureFx() {
    if (!glitch) {
      glitch = el('div', 'holo-glitch');
      lines = el('div', 'holo-lines');
      document.body.append(glitch, lines);
    }
  }
  function doGlitch() {
    if (mode() !== 'full' || !glitch) return;
    glitch.classList.remove('on');
    void glitch.offsetWidth;
    glitch.classList.add('on');
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.dock-btn')) doGlitch();
  });

  // Kolejnosc wejscia widzetow: --i dla opoznienia animacji.
  const indexer = new MutationObserver(() => {
    document.querySelectorAll('.stage-panel .w:not([data-hi]), .stage-panel .card:not([data-hi])').forEach((n, i) => {
      n.dataset.hi = '1';
      n.style.setProperty('--i', String(i % 12));
    });
  });

  // ---------- paralaksa ----------
  const P = { tx: 0, ty: 0, x: 0, y: 0, raf: 0 };
  function tick() {
    P.raf = 0;
    if (mode() === 'off') return;
    P.x += (P.tx - P.x) * 0.08;
    P.y += (P.ty - P.y) * 0.08;
    const root = document.documentElement.style;
    root.setProperty('--holo-mx', P.x.toFixed(3));
    root.setProperty('--holo-my', P.y.toFixed(3));
    root.setProperty('--holo-tilt-x', (-P.y * 2.2).toFixed(2) + 'deg');
    root.setProperty('--holo-tilt-y', (P.x * 2.6).toFixed(2) + 'deg');
    if (Math.abs(P.tx - P.x) > 0.002 || Math.abs(P.ty - P.y) > 0.002) P.raf = requestAnimationFrame(tick);
  }
  function target(x, y) {
    P.tx = Math.max(-1, Math.min(1, x));
    P.ty = Math.max(-1, Math.min(1, y));
    if (!P.raf && mode() === 'full') P.raf = requestAnimationFrame(tick);
  }
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || mode() !== 'full') return;
    target((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  });
  // Telefon: zyroskop (Android od razu; iOS wymaga zgody, ktorej nie wymuszamy).
  window.addEventListener('deviceorientation', (e) => {
    if (mode() === 'off' || e.gamma == null) return;
    target(e.gamma / 30, (e.beta - 50) / 40);
  });

  // ---------- scena ----------
  const S = { cv: null, ctx: null, w: 0, h: 0, dpr: 1, t0: performance.now(), last: 0, parts: [], shapes: [], pulse: 0 };

  function rgb() {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#33e0ff';
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [51, 224, 255];
  }

  function seed() {
    S.parts = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), s: 0.15 + Math.random() * 0.5, r: 0.6 + Math.random() * 1.6 }));
    S.shapes = [
      { type: 'ico', x: 0.14, y: 0.3, size: 70, ax: 0.2, ay: 0.4, sp: 0.18 },
      { type: 'ring', x: 0.88, y: 0.24, size: 56, ax: 1.1, ay: 0.3, sp: -0.22 },
      { type: 'cube', x: 0.8, y: 0.72, size: 46, ax: 0.5, ay: 0.9, sp: 0.15 },
    ];
  }

  function mount() {
    const stage = document.getElementById('board');
    if (!stage || S.cv) return;
    S.cv = el('canvas', 'holo-scene');
    stage.insertBefore(S.cv, stage.firstChild);
    S.ctx = S.cv.getContext('2d');
    seed();
    resize();
    window.addEventListener('resize', resize);
    // Scena powstaje, gdy mostek jest jeszcze ukryty (rozmiar 0) - sledzimy realny rozmiar.
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    S.raf = requestAnimationFrame(frame);
  }

  function resize() {
    if (!S.cv) return;
    S.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const r = S.cv.getBoundingClientRect();
    S.w = Math.max(1, Math.round(r.width));
    S.h = Math.max(1, Math.round(r.height));
    S.cv.width = Math.round(S.w * S.dpr);
    S.cv.height = Math.round(S.h * S.dpr);
  }

  // Wierzcholki: ikosaedr, szescian, pierscien.
  const PHI = (1 + Math.sqrt(5)) / 2;
  const ICO = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]];
  const ICO_E = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (Math.abs(Math.hypot(ICO[i][0] - ICO[j][0], ICO[i][1] - ICO[j][1], ICO[i][2] - ICO[j][2]) - 2) < 0.01) ICO_E.push([i, j]);
  const CUBE = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const CUBE_E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

  function rot(p, ax, ay) {
    const [x, y, z] = p;
    const cy = Math.cos(ay), sy = Math.sin(ay);
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const cx = Math.cos(ax), sx = Math.sin(ax);
    return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
  }

  function wire(ctx, verts, edges, cx, cy, size, ax, ay, col, alpha) {
    const pts = verts.map((v) => {
      const r = rot(v, ax, ay);
      const f = 3.2 / (3.2 + r[2] * 0.5);
      return [cx + r[0] * size * 0.5 * f, cy + r[1] * size * 0.5 * f, r[2]];
    });
    ctx.lineWidth = 1;
    edges.forEach(([a, b]) => {
      const depth = (pts[a][2] + pts[b][2]) / 2;
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(alpha * (0.45 + 0.3 * (1 - depth))).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(pts[a][0], pts[a][1]);
      ctx.lineTo(pts[b][0], pts[b][1]);
      ctx.stroke();
    });
  }

  function ring(ctx, cx, cy, size, ax, ay, col, alpha) {
    const verts = Array.from({ length: 40 }, (_, i) => [Math.cos((i / 40) * Math.PI * 2), 0, Math.sin((i / 40) * Math.PI * 2)]);
    const edges = verts.map((_, i) => [i, (i + 1) % 40]);
    wire(ctx, verts, edges, cx, cy, size * 1.6, ax, ay, col, alpha);
    wire(ctx, verts, edges, cx, cy, size * 1.1, ax + 0.5, ay + 0.8, col, alpha * 0.7);
  }

  // Poziom "energii" sceny: rozmowa, alarm, muzyka.
  function energy() {
    const talk = Math.min(1, store.audioLevel || 0);
    const alarm = document.body.dataset.posture === 'threat' ? 0.6 : 0;
    const music = UI.nowPlaying?.playing ? 0.18 : 0;
    return Math.min(1, Math.max(talk, alarm, music));
  }

  // ---------- style sceny tla ----------
  const SCENES = [['grid', 'Siatka'], ['hex', 'Heksy'], ['rain', 'Deszcz danych'], ['aurora', 'Zorza'], ['stars', 'Gwiazdy'], ['circuit', 'Uklad']];
  const sceneStyle = () => {
    const v = get('jarvis.holoScene', 'grid');
    return SCENES.some((s) => s[0] === v) ? v : 'grid';
  };
  const rgba3 = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

  function drawScene(style, ctx, w, h, t, col, px, py) {
    const p = S.pulse;
    if (style === 'hex') {
      // plaster sześciokątów; fala rozchodzi się od kursora/środka
      const r = Math.max(26, Math.min(w, h) / 14);
      const dx = r * 1.5, dy = r * Math.sqrt(3);
      const cx0 = w * (0.5 + px * 0.05), cy0 = h * (0.5 + py * 0.05);
      for (let c = -1; c * dx < w + dx; c++) {
        for (let rw = -1; rw * dy < h + dy; rw++) {
          const x = c * dx, y = rw * dy + (c % 2 ? dy / 2 : 0);
          const d = Math.hypot(x - cx0, y - cy0);
          const wave = 0.5 + 0.5 * Math.sin(d * 0.012 - t * 1.6);
          const a = 0.035 + wave * (0.09 + p * 0.12);
          ctx.strokeStyle = rgba3(col, a);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const ang = (Math.PI / 3) * k;
            const hx = x + Math.cos(ang) * r * 0.92, hy = y + Math.sin(ang) * r * 0.92;
            k ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    } else if (style === 'rain') {
      if (!S.drops || S.drops.length !== Math.ceil(w / 18)) S.drops = Array.from({ length: Math.ceil(w / 18) }, () => ({ y: Math.random() * h, v: 30 + Math.random() * 90 }));
      ctx.font = '12px monospace';
      S.drops.forEach((d, i) => {
        d.y += d.v * 0.033 * (1 + p * 3);
        if (d.y > h + 120) d.y = -Math.random() * 200;
        for (let k = 0; k < 9; k++) {
          ctx.fillStyle = rgba3(col, (0.28 - k * 0.03) * (0.6 + p));
          ctx.fillText(String.fromCharCode(0x30a0 + ((i * 7 + k * 13 + Math.floor(t * 4)) % 90)), i * 18 + px * 4, d.y - k * 14);
        }
      });
    } else if (style === 'aurora') {
      for (let b = 0; b < 4; b++) {
        const g = ctx.createLinearGradient(0, h * 0.1, 0, h * 0.7);
        const hue = [col, [Math.min(255, col[0] + 60), col[1], 255], [90, 255, 200], col][b];
        g.addColorStop(0, rgba3(hue, 0));
        g.addColorStop(0.5, rgba3(hue, 0.07 + p * 0.06));
        g.addColorStop(1, rgba3(hue, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * (0.3 + b * 0.07) + Math.sin(x * 0.006 + t * (0.3 + b * 0.1) + b) * h * 0.1 + Math.sin(x * 0.015 - t * 0.4) * h * 0.03);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
    } else if (style === 'stars') {
      if (!S.stars) S.stars = Array.from({ length: 140 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
      const cx = w * (0.5 + px * 0.03), cy = h * (0.5 + py * 0.03);
      S.stars.forEach((s) => {
        s.z -= 0.004 * (1 + p * 6);
        if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; }
        const k = 1 / s.z;
        const x = cx + s.x * k * w * 0.08, y = cy + s.y * k * h * 0.08;
        const x2 = cx + s.x * (k * 1.08) * w * 0.08, y2 = cy + s.y * (k * 1.08) * h * 0.08;
        ctx.strokeStyle = rgba3(col, Math.min(0.8, (1 - s.z) * 0.8));
        ctx.lineWidth = 0.6 + (1 - s.z) * 1.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      });
      ctx.lineWidth = 1;
    } else if (style === 'circuit') {
      if (!S.traces) S.traces = Array.from({ length: 14 }, () => ({ y: Math.random(), x: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, len: 0.2 + Math.random() * 0.4, sp: 0.04 + Math.random() * 0.08 }));
      S.traces.forEach((tr, i) => {
        tr.x += tr.dir * tr.sp * 0.033 * (1 + p * 3);
        if (tr.x > 1.4 || tr.x < -0.4) { tr.x = tr.dir > 0 ? -0.3 : 1.3; tr.y = Math.random(); }
        const y = tr.y * h;
        const x1 = tr.x * w, x0 = x1 - tr.dir * tr.len * w;
        ctx.strokeStyle = rgba3(col, 0.07);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.lineTo(x1 + tr.dir * 30, y + (i % 2 ? 24 : -24)); ctx.stroke();
        ctx.fillStyle = rgba3(col, 0.6);
        ctx.beginPath(); ctx.arc(x1, y, 2.2, 0, 6.283); ctx.fill();
      });
    }
  }

  function frame(now) {
    S.raf = requestAnimationFrame(frame);
    const m = mode();
    const stageVisible = S.cv && S.cv.offsetParent !== null && !document.getElementById('ops')?.hidden;
    if (!stageVisible || document.visibilityState !== 'visible') return;
    if (m === 'off') return;
    // 30 klatek/s w pelnym trybie, ~8 w subtelnym - to tlo, nie atrakcja.
    const gap = m === 'full' ? 33 : 120;
    if (now - S.last < gap) return;
    S.last = now;
    const ctx = S.ctx;
    const w = S.w, h = S.h;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = (now - S.t0) / 1000;
    const col = rgb();
    const en = energy();
    S.pulse += (en - S.pulse) * 0.15;
    const px = P.x, py = P.y;

    const style = sceneStyle();
    if (style !== 'grid') drawScene(style, ctx, w, h, t, col, px, py);
    else {
    // horyzont i poswiata
    const hor = h * (0.58 + py * 0.02);
    const glow = ctx.createLinearGradient(0, hor - h * 0.35, 0, hor + 4);
    glow.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    glow.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},${(0.07 + S.pulse * 0.1).toFixed(3)})`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, hor - h * 0.35, w, h * 0.35 + 4);

    // siatka-podloga w perspektywie: poziome linie zbiegaja sie ku horyzontowi, pionowe wachlarzem
    const vx = w * (0.5 + px * 0.04);
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const k = (i + ((t * 0.35) % 1)) / 16;
      const y = hor + Math.pow(k, 2.2) * (h - hor);
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(0.05 + k * 0.17).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let i = -14; i <= 14; i++) {
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${i % 7 === 0 ? 0.2 : 0.09})`;
      ctx.beginPath();
      ctx.moveTo(vx + i * w * 0.012, hor);
      ctx.lineTo(vx + i * w * 0.2, h);
      ctx.stroke();
    }

    // czastki unoszace sie ku gorze (antygrawitacja)
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    S.parts.forEach((p) => {
      p.y -= p.s * 0.0009 * (1 + S.pulse * 3) * 16;
      if (p.y < -0.05) {
        p.y = 1.05;
        p.x = Math.random();
      }
      const sx = (p.x + px * 0.03 * (1 - p.z)) * w + Math.sin(t * 0.6 + p.z * 20) * 6;
      const sy = p.y * h;
      ctx.globalAlpha = (0.12 + p.z * 0.4) * (0.6 + S.pulse);
      ctx.beginPath();
      ctx.arc(sx, sy, p.r * (0.6 + p.z), 0, 6.283);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    }

    // bryly druciane
    S.shapes.forEach((s, i) => {
      const cx = (s.x + px * 0.02 * (i + 1)) * w;
      const cy = (s.y + Math.sin(t * 0.5 + i * 2) * 0.012 + py * 0.015 * (i + 1)) * h;
      const ax = s.ax + t * s.sp * 0.6;
      const ay = s.ay + t * s.sp;
      const a = 0.22 + S.pulse * 0.3;
      if (s.type === 'ico') wire(ctx, ICO, ICO_E, cx, cy, s.size * (1 + S.pulse * 0.2), ax, ay, col, a);
      else if (s.type === 'cube') wire(ctx, CUBE, CUBE_E, cx, cy, s.size, ax, ay, col, a);
      else ring(ctx, cx, cy, s.size, ax, ay, col, a);
    });

    // przemiatajacy promien skanera
    const beam = ((t * 0.12) % 1.4) - 0.2;
    const bx = beam * w;
    const bg = ctx.createLinearGradient(bx - 90, 0, bx + 90, 0);
    bg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    bg.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},${(0.035 + S.pulse * 0.05).toFixed(3)})`);
    bg.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = bg;
    ctx.fillRect(bx - 90, 0, 180, h);
  }

  UI.holo = { mode, apply, glitch: doGlitch, energy };

  // ---------- panel w Ustawieniach ----------
  const def = {
    title: 'HOLOGRAM',
    glyph: '✦',
    build(body) {
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'Panele unosza sie w przestrzeni i reaguja na mysz (na telefonie - na przechylenie). W tle plynie siatka, czastki i bryly, a scena pulsuje podczas rozmowy.'));
      const row = el('div', 'field');
      row.style.cssText = 'flex-wrap:wrap;gap:6px;margin:8px 0';
      [['full', 'Pelny'], ['subtle', 'Subtelny (sam szklany wyglad)'], ['off', 'Wylaczony']].forEach(([v, l]) => {
        const cur = get(KEY, touch ? 'subtle' : 'full');
        const b = el('button', cur === v ? 'btn primary' : 'btn ghost', l);
        b.addEventListener('click', () => {
          put(KEY, v);
          apply();
          def.build(body);
        });
        row.appendChild(b);
      });
      body.appendChild(row);
      body.appendChild(el('div', 'sub', 'Tlo sceny:'));
      const scenes = el('div', 'field');
      scenes.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0 10px';
      SCENES.forEach(([v, l]) => {
        const b = el('button', sceneStyle() === v ? 'btn primary' : 'btn ghost', l);
        b.addEventListener('click', () => {
          put('jarvis.holoScene', v);
          S.drops = S.stars = S.traces = null;
          def.build(body);
        });
        scenes.appendChild(b);
      });
      body.appendChild(scenes);
      body.appendChild(el('div', 'sub', 'Efekty interfejsu:'));
      const fxRow = el('div', 'field');
      fxRow.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0 10px';
      [['trail', 'Smuga kursora'], ['magnet', 'Magnetyczne przyciski'], ['ripple', 'Fale po kliknieciu'], ['tilt', 'Pochylanie kart'], ['dof', 'Rozmycie tla']].forEach(([k, l]) => {
        const on = UI.holoFx ? UI.holoFx.enabled(k) : false;
        const b = el('button', on ? 'btn primary' : 'btn ghost', l);
        b.addEventListener('click', () => {
          UI.holoFx && UI.holoFx.toggle(k);
          def.build(body);
        });
        fxRow.appendChild(b);
      });
      body.appendChild(fxRow);
      const amp = el('input');
      amp.type = 'range';
      amp.min = '0.2';
      amp.max = '1.6';
      amp.step = '0.1';
      amp.value = get('jarvis.holoAmp', '1');
      amp.addEventListener('input', () => {
        put('jarvis.holoAmp', amp.value);
        document.documentElement.style.setProperty('--holo-amp', amp.value);
      });
      const r = el('div', 'kv');
      r.append(el('span', null, 'Sila lewitacji i paralaksy'), amp);
      body.appendChild(r);
      if (motion() !== 'full') body.appendChild(el('div', 'hint', 'Animacje sa ustawione na "oszczedne"/"wylaczone" (panel Wyglad) - hologram jest wtedy statyczny.'));
    },
  };
  UI.extend('set', { hologram: def });

  window.addEventListener('jarvis:ready', () => {
    document.documentElement.style.setProperty('--holo-amp', get('jarvis.holoAmp', '1'));
    apply();
    mount();
    indexer.observe(document.getElementById('board') || document.body, { childList: true, subtree: true });
  });
  // Zmiana "Animacji" w panelu Wyglad od razu przelicza tryb.
  setInterval(apply, 2000);
  // Gdy scena jeszcze nie istnieje (boot przed ops), probujemy ponownie.
  const early = setInterval(() => {
    if (S.cv) return clearInterval(early);
    mount();
  }, 1500);
})();
