// Podglad modelu 3D na zwyklym canvasie 2D.
//
// Celowo BEZ three.js: aplikacja dziala jako PWA i ma ruszac offline, a
// dociaganie biblioteki 3D tylko po to, zeby pokazac kilkaset trojkatow,
// bylo by nieproporcjonalne. Rzutowanie i sortowanie po glebokosci mieszcza
// sie w kilkuset linijkach.
//
// Kolejnosc rysowania: algorytm malarza (od najdalszego trojkata). Dla
// bryly wypuklej jest dokladny, dla wspornika w praktyce wystarczajacy -
// nie ma tu przenikajacych sie scian.
//
// Style: bryla (cieniowana / mapa naprezen), hologram (swiecace krawedzie + przezroczyste
// sciany + promien skanera), szkielet, rentgen. Do tego: siatka-podloga, osie, wymiary
// obrysu w mm, plaszczyzna ciecia, widoki (przod/gora/bok/izo), zoom kolkiem, zrzut PNG.

(() => {
  function project(v, rotX, rotY, scale, cx, cy, center, zoom) {
    // Obrot wokol osi Y, potem X - jak przy obracaniu przedmiotu w rece.
    let x = v[0] - center[0];
    let y = v[1] - center[1];
    let z = v[2] - center[2];

    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    let x1 = x * cosY - z * sinY;
    let z1 = x * sinY + z * cosY;

    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    let y1 = y * cosX - z1 * sinX;
    let z2 = y * sinX + z1 * cosX;

    // Rzut perspektywiczny - bez niego bryla wyglada plasko jak rysunek
    // techniczny i trudno ocenic ksztalt.
    const dist = 520;
    const f = dist / (dist + z2 + 260);
    const s = scale * (zoom || 1);
    return [cx + x1 * s * f, cy - y1 * s * f, z2];
  }

  function faceNormal(t) {
    const ux = t.b[0] - t.a[0], uy = t.b[1] - t.a[1], uz = t.b[2] - t.a[2];
    const vx = t.c[0] - t.a[0], vy = t.c[1] - t.a[1], vz = t.c[2] - t.a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  function heatColor(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    if (r < 0.5) {
      const k = r / 0.5;
      return [Math.round(40 + k * 215), Math.round(190 + k * 65), Math.round(120 - k * 60)];
    }
    const k = (r - 0.5) / 0.5;
    return [255, Math.round(255 - k * 200), Math.round(60 - k * 45)];
  }

  const STYLES = [['solid', 'BRYLA'], ['holo', 'HOLO'], ['wire', 'SZKIELET'], ['xray', 'RENTGEN']];
  const VIEWS = { przod: [0, 0], gora: [-Math.PI / 2 + 0.001, 0], bok: [0, Math.PI / 2], izo: [-0.45, 0.7] };

  window.CADView = function CADView(canvas, model, opts = {}) {
    const ctx = canvas.getContext('2d');
    let rotX = -0.45;
    let rotY = 0.7;
    let heat = true;
    let spin = true;
    let raf = null;
    let style = 'solid';
    let zoom = 1;
    let showGrid = true;
    let showDims = false;
    let cut = 1; // 1 = bez ciecia; mniej = odcina gore bryly
    let projector = false; // model unosi sie nad stolem projektora
    const t0 = performance.now();

    const mesh = model.mesh || [];
    const field = model.field || [];

    // Srodek bryly i skala dobrane tak, zeby model wypelnial kadr
    // niezaleznie od jego rozmiaru w milimetrach.
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const t of mesh) {
      for (const k of ['a', 'b', 'c']) {
        for (let i = 0; i < 3; i++) {
          if (t[k][i] < lo[i]) lo[i] = t[k][i];
          if (t[k][i] > hi[i]) hi[i] = t[k][i];
        }
      }
    }
    const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;

    const light = [0.4, 0.7, 0.55];
    const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#33e0ff';
    const rgb = () => {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(accent());
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [51, 224, 255];
    };

    function line3(p, a, b, scale, cx, cy) {
      const pa = project(a, rotX, rotY, scale, cx, cy, center, zoom);
      const pb = project(b, rotX, rotY, scale, cx, cy, center, zoom);
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
      return [pa, pb];
    }

    function drawFloor(scale, cx, cy, col) {
      const y = lo[1] - span * 0.04;
      const ext = span * 0.9;
      const n = 10;
      ctx.lineWidth = 1;
      for (let i = -n; i <= n; i++) {
        const k = (i / n) * ext;
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${i % 5 === 0 ? 0.28 : 0.1})`;
        line3(null, [center[0] - ext, y, center[2] + k], [center[0] + ext, y, center[2] + k], scale, cx, cy);
        line3(null, [center[0] + k, y, center[2] - ext], [center[0] + k, y, center[2] + ext], scale, cx, cy);
      }
    }

    function drawAxes(scale, cx, cy) {
      const o = [lo[0], lo[1], lo[2]];
      const len = span * 0.35;
      ctx.lineWidth = 1.6;
      [['#ff5a5a', [len, 0, 0], 'X'], ['#5aff8c', [0, len, 0], 'Y'], ['#5aa0ff', [0, 0, len], 'Z']].forEach(([c, d, name]) => {
        ctx.strokeStyle = c;
        const [, pb] = line3(null, o, [o[0] + d[0], o[1] + d[1], o[2] + d[2]], scale, cx, cy);
        ctx.fillStyle = c;
        ctx.font = '10px monospace';
        ctx.fillText(name, pb[0] + 4, pb[1] - 4);
      });
    }

    // Wymiary obrysu: trzy krawedzie bounding boxa z opisem (jednostki siatki = mm).
    function drawDims(scale, cx, cy, col) {
      const sz = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]; // z geometrii, zeby opisy zgadzaly sie z rysunkiem
      const d = span * 0.06;
      ctx.lineWidth = 1;
      ctx.font = '10px monospace';
      const rows = [
        [[lo[0], lo[1] - d, hi[2] + d], [hi[0], lo[1] - d, hi[2] + d], `${Math.round(sz[0])} mm`],
        [[hi[0] + d, lo[1], hi[2] + d], [hi[0] + d, hi[1], hi[2] + d], `${Math.round(sz[1])} mm`],
        [[hi[0] + d, lo[1] - d, lo[2]], [hi[0] + d, lo[1] - d, hi[2]], `${Math.round(sz[2])} mm`],
      ];
      rows.forEach(([a, b, label]) => {
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.85)`;
        const [pa, pb] = line3(null, a, b, scale, cx, cy);
        [pa, pb].forEach((p) => ctx.strokeRect(p[0] - 2, p[1] - 2, 4, 4));
        ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        ctx.fillText(label, (pa[0] + pb[0]) / 2 + 6, (pa[1] + pb[1]) / 2 - 4);
      });
    }

    // Stol projektora: swiecaca tarcza pod modelem i wiazki swiatla w gore.
    function drawProjector(scale, cx, cy, col, t) {
      const y = lo[1] - span * 0.04;
      const base = project([center[0], y, center[2]], rotX, rotY, scale, cx, cy, center, zoom);
      const rx = span * 0.55 * scale * zoom * 0.9;
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const k = 1 - i * 0.22;
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(0.5 - i * 0.1).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(base[0], base[1], rx * k, rx * k * Math.abs(Math.sin(rotX) * 0.6 + 0.25), 0, 0, 6.283);
        ctx.stroke();
      }
      const g = ctx.createLinearGradient(0, base[1] - span * scale * zoom, 0, base[1]);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},${(0.16 + 0.05 * Math.sin(t * 3)).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(base[0] - rx * 0.9, base[1]);
      ctx.lineTo(base[0] - rx * 0.45, base[1] - span * scale * zoom);
      ctx.lineTo(base[0] + rx * 0.45, base[1] - span * scale * zoom);
      ctx.lineTo(base[0] + rx * 0.9, base[1]);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function draw() {
      if (!canvas.isConnected) return; // plotno usuniete z DOM - konczymy petle
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      const w = rect.width;
      const h = rect.height;
      if (!w || !h) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (spin) rotY += 0.006;

      const scale = (Math.min(w, h) * 0.62) / span;
      const cx = w / 2;
      const cy = h / 2;
      const col = rgb();
      const t = (performance.now() - t0) / 1000;
      const cutY = lo[1] + (hi[1] - lo[1]) * cut;

      if (showGrid) drawFloor(scale, cx, cy, col);
      const hover = projector ? Math.sin(t * 1.4) * span * 0.03 + span * 0.12 : 0;
      if (projector) drawProjector(scale, cx, cy, col, t);

      const drawn = [];
      mesh.forEach((tri, i) => {
        if (cut < 0.999 && Math.min(tri.a[1], tri.b[1], tri.c[1]) > cutY) return;
        const pa = project(tri.a, rotX, rotY, scale, cx, cy - hover * scale * zoom, center, zoom);
        const pb = project(tri.b, rotX, rotY, scale, cx, cy - hover * scale * zoom, center, zoom);
        const pc = project(tri.c, rotX, rotY, scale, cx, cy - hover * scale * zoom, center, zoom);
        drawn.push({ t: tri, i, pa, pb, pc, depth: (pa[2] + pb[2] + pc[2]) / 3 });
      });
      drawn.sort((p, q) => q.depth - p.depth);

      // Promien skanera: pas swiatla przesuwajacy sie po wysokosci modelu (styl holo).
      const scanY = h * (0.15 + 0.7 * ((t * 0.35) % 1));

      for (const d of drawn) {
        const area = (d.pb[0] - d.pa[0]) * (d.pc[1] - d.pa[1]) - (d.pc[0] - d.pa[0]) * (d.pb[1] - d.pa[1]);
        const back = area <= 0;
        // W trybach przezroczystych rysujemy tez tylne sciany (slabiej); w pelnej bryle je pomijamy.
        if (back && (style === 'solid')) continue;

        const n = faceNormal(d.t);
        const lam = Math.max(0.25, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);

        ctx.beginPath();
        ctx.moveTo(d.pa[0], d.pa[1]);
        ctx.lineTo(d.pb[0], d.pb[1]);
        ctx.lineTo(d.pc[0], d.pc[1]);
        ctx.closePath();

        if (style === 'solid') {
          let c;
          if (heat && field[d.i]) {
            const hc = heatColor(field[d.i].ratio);
            c = `rgb(${Math.round(hc[0] * lam)}, ${Math.round(hc[1] * lam)}, ${Math.round(hc[2] * lam)})`;
          } else {
            const g = Math.round(90 + lam * 140);
            c = `rgb(${Math.round(g * 0.55)}, ${Math.round(g * 0.82)}, ${g})`;
          }
          ctx.fillStyle = c;
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        } else {
          const cy3 = (d.pa[1] + d.pb[1] + d.pc[1]) / 3;
          const near = Math.max(0, 1 - Math.abs(cy3 - scanY) / 26);
          const base = style === 'xray' ? 0.05 : style === 'wire' ? 0 : 0.07;
          if (base) {
            ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(back ? base * 0.4 : base + lam * 0.08).toFixed(3)})`;
            ctx.fill();
          }
          const a = (back ? 0.12 : 0.45) + near * 0.5;
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
          ctx.lineWidth = near > 0.1 ? 1.4 : 0.8;
          ctx.stroke();
        }
      }

      if (style === 'holo' || style === 'xray') {
        const g = ctx.createLinearGradient(0, scanY - 18, 0, scanY + 18);
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        g.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},0.18)`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, scanY - 18, w, 36);
      }

      if (showDims) drawDims(scale, cx, cy, col);
      drawAxes(scale, cx, cy);

      raf = requestAnimationFrame(draw);
    }

    // Obracanie mysza/palcem - przy ocenie modelu chce sie na niego
    // spojrzec z drugiej strony. Kolko = zoom, dwa palce = zoom (uszczypniecie).
    let drag = null;
    let pinch = null;
    const down = (e) => {
      if (e.touches && e.touches.length === 2) {
        pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: zoom };
        drag = null;
        return;
      }
      const p = e.touches ? e.touches[0] : e;
      drag = { x: p.clientX, y: p.clientY, rx: rotX, ry: rotY };
      spin = false;
    };
    const move = (e) => {
      if (pinch && e.touches && e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        zoom = Math.max(0.4, Math.min(4, pinch.z * (d / pinch.d)));
        e.preventDefault();
        return;
      }
      if (!drag) return;
      const p = e.touches ? e.touches[0] : e;
      rotY = drag.ry + (p.clientX - drag.x) * 0.01;
      rotX = Math.max(-1.6, Math.min(1.6, drag.rx + (p.clientY - drag.y) * 0.01));
      e.preventDefault();
    };
    const up = () => {
      drag = null;
      pinch = null;
    };
    const wheel = (e) => {
      e.preventDefault();
      zoom = Math.max(0.4, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    };
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    // Pasek narzedzi pod plotnem (tworzony raz na plotno).
    let bar = opts.tools === false ? null : canvas.parentElement && canvas.parentElement.querySelector(':scope > .cad-tools');
    if (bar) bar.remove();
    bar = opts.tools === false ? document.createElement('div') : document.createElement('div');
    bar.className = 'cad-tools';
    const btn = (label, fn, on) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cad-tool${on ? ' on' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => fn(b));
      bar.appendChild(b);
      return b;
    };
    const styleBtns = STYLES.map(([k, label]) =>
      btn(label, () => {
        style = k;
        styleBtns.forEach((b, i) => b.classList.toggle('on', STYLES[i][0] === k));
      }, k === style)
    );
    btn('SIATKA', (b) => { showGrid = !showGrid; b.classList.toggle('on', showGrid); }, showGrid);
    btn('WYMIARY', (b) => { showDims = !showDims; b.classList.toggle('on', showDims); }, showDims);
    btn('PROJEKTOR', (b) => { projector = !projector; b.classList.toggle('on', projector); }, projector);
    btn('OBROT', (b) => { spin = !spin; b.classList.toggle('on', spin); }, spin);
    Object.entries(VIEWS).forEach(([name, [rx, ry]]) => btn(name.toUpperCase(), () => { spin = false; rotX = rx; rotY = ry; zoom = 1; }));
    const cutWrap = document.createElement('label');
    cutWrap.className = 'cad-cut';
    cutWrap.textContent = 'CIECIE ';
    const cutIn = document.createElement('input');
    cutIn.type = 'range';
    cutIn.min = '5';
    cutIn.max = '100';
    cutIn.value = '100';
    cutIn.addEventListener('input', () => { cut = Number(cutIn.value) / 100; });
    cutWrap.appendChild(cutIn);
    bar.appendChild(cutWrap);
    btn('PNG', () => {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `model-${model.id || 'jarvis'}.png`;
      a.click();
    });
    if (canvas.parentElement && opts.tools !== false) canvas.parentElement.appendChild(bar);

    draw();

    return {
      setHeat(on) {
        heat = on;
      },
      setSpin(on) {
        spin = on;
      },
      getBar() {
        return bar;
      },
      setStyle(s) {
        if (STYLES.some((x) => x[0] === s)) style = s;
      },
      stop() {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('touchend', up);
      },
    };
  };
})();
