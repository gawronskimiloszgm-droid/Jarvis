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
