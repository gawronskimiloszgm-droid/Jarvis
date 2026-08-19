// Podglad modelu 3D na zwyklym canvasie 2D.
//
// Celowo BEZ three.js: aplikacja dziala jako PWA i ma ruszac offline, a
// dociaganie biblioteki 3D tylko po to, zeby pokazac kilkaset trojkatow,
// bylo by nieproporcjonalne. Rzutowanie i sortowanie po glebokosci mieszcza
// sie w stu linijkach.
//
// Kolejnosc rysowania: algorytm malarza (od najdalszego trojkata). Dla
// bryly wypuklej jest dokladny, dla wspornika w praktyce wystarczajacy -
// nie ma tu przenikajacych sie scian.

(() => {
  function project(v, rotX, rotY, scale, cx, cy, center) {
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
    return [cx + x1 * scale * f, cy - y1 * scale * f, z2];
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

  window.CADView = function CADView(canvas, model) {
    const ctx = canvas.getContext('2d');
    let rotX = -0.45;
    let rotY = 0.7;
    let heat = true;
    let spin = true;
    let raf = null;

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

    function draw() {
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

      const drawn = mesh.map((t, i) => {
        const pa = project(t.a, rotX, rotY, scale, cx, cy, center);
        const pb = project(t.b, rotX, rotY, scale, cx, cy, center);
        const pc = project(t.c, rotX, rotY, scale, cx, cy, center);
        return { t, i, pa, pb, pc, depth: (pa[2] + pb[2] + pc[2]) / 3 };
      });
      drawn.sort((p, q) => q.depth - p.depth);

      for (const d of drawn) {
        // Sciany odwrocone tylem pomijamy - mniej rysowania i czystszy obraz.
        const area =
          (d.pb[0] - d.pa[0]) * (d.pc[1] - d.pa[1]) - (d.pc[0] - d.pa[0]) * (d.pb[1] - d.pa[1]);
        if (area <= 0) continue;

        const n = faceNormal(d.t);
        const lam = Math.max(0.25, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);

        let col;
        if (heat && field[d.i]) {
          const c = heatColor(field[d.i].ratio);
          col = `rgb(${Math.round(c[0] * lam)}, ${Math.round(c[1] * lam)}, ${Math.round(c[2] * lam)})`;
        } else {
          const g = Math.round(90 + lam * 140);
          col = `rgb(${Math.round(g * 0.55)}, ${Math.round(g * 0.82)}, ${g})`;
        }

        ctx.beginPath();
        ctx.moveTo(d.pa[0], d.pa[1]);
        ctx.lineTo(d.pb[0], d.pb[1]);
        ctx.lineTo(d.pc[0], d.pc[1]);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    }

    // Obracanie mysza/palcem - przy ocenie modelu chce sie na niego
    // spojrzec z drugiej strony.
    let drag = null;
    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      drag = { x: p.clientX, y: p.clientY, rx: rotX, ry: rotY };
      spin = false;
    };
    const move = (e) => {
      if (!drag) return;
      const p = e.touches ? e.touches[0] : e;
      rotY = drag.ry + (p.clientX - drag.x) * 0.01;
      rotX = Math.max(-1.4, Math.min(1.4, drag.rx + (p.clientY - drag.y) * 0.01));
      e.preventDefault();
    };
    const up = () => {
      drag = null;
    };
    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    draw();

    return {
      setHeat(on) {
        heat = on;
      },
      setSpin(on) {
        spin = on;
      },
      stop() {
        if (raf) cancelAnimationFrame(raf);
      },
    };
  };
})();
