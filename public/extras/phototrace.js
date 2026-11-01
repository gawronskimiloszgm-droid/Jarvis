// Odrys 1:1 ze zdjecia z boku (czysta logika, tests/phototrace.test.mjs). Z pikseli powstaje maska
// przedmiotu, a z niej kontury czesci w milimetrach: obrys, otwory i profile bryl obrotowych. Skale
// daje znana dlugosc calosci. Zdjecia nie zostaja w projekcie, tylko wspolrzedne.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhotoTrace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Maska: 1 = przedmiot. Tlo to kolor brzegow zdjecia, a biale dziury wewnatrz zostaja dziurami. */
  function buildMask(img, tol = 34) {
    const { data, width: w, height: h } = img;
    const samples = [];
    for (let x = 0; x < w; x += Math.max(1, w >> 6)) samples.push((x + 0) * 4, (x + (h - 1) * w) * 4);
    for (let y = 0; y < h; y += Math.max(1, h >> 6)) samples.push(y * w * 4, (y * w + w - 1) * 4);
    const med = (k) => samples.map((i) => data[i + k]).sort((a, b) => a - b)[samples.length >> 1];
    const bg = [med(0), med(1), med(2)];
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const a = data[i * 4 + 3];
      const d = Math.abs(data[i * 4] - bg[0]) + Math.abs(data[i * 4 + 1] - bg[1]) + Math.abs(data[i * 4 + 2] - bg[2]);
      mask[i] = a > 128 && d > tol ? 1 : 0;
    }
    return { mask, w, h, bg };
  }

  /** Najwieksza spojna plama: odrzuca cien, napisy na tle i smieci. */
  function largestBlob({ mask, w, h }) {
    const seen = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    let best = null;
    const stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || seen[s]) continue;
      let top = 0;
      stack[top++] = s;
      seen[s] = 1;
      const cells = [];
      while (top) {
        const i = stack[--top];
        cells.push(i);
        const x = i % w;
        if (x > 0 && mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1, stack[top++] = i - 1);
        if (x < w - 1 && mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1, stack[top++] = i + 1);
        if (i >= w && mask[i - w] && !seen[i - w]) (seen[i - w] = 1, stack[top++] = i - w);
        if (i < w * (h - 1) && mask[i + w] && !seen[i + w]) (seen[i + w] = 1, stack[top++] = i + w);
      }
      if (!best || cells.length > best.length) best = cells;
    }
    (best || []).forEach((i) => {
      out[i] = 1;
    });
    return out;
  }

  /**
   * Odblask na lakierze wyglada jak tlo, ale ma miekka krawedz: kilka pikseli dalej nadal jest jasno.
   * Prawdziwy przeswit konczy sie ostro na ciemniejszym materiale, wiec tylko takie dziury zostaja.
   */
  function fillReflections(blob, img, bg, w, h) {
    const { data } = img;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const diff = (i) => Math.abs(data[i * 4] - bg[0]) + Math.abs(data[i * 4 + 1] - bg[1]) + Math.abs(data[i * 4 + 2] - bg[2]);
    const out = blob.slice();
    const flood = (s, visit) => {
      let top = 0;
      stack[top++] = s;
      seen[s] = 1;
      while (top) {
        const i = stack[--top];
        visit(i);
        const x = i % w;
        if (x > 0 && !blob[i - 1] && !seen[i - 1]) (seen[i - 1] = 1, stack[top++] = i - 1);
        if (x < w - 1 && !blob[i + 1] && !seen[i + 1]) (seen[i + 1] = 1, stack[top++] = i + 1);
        if (i >= w && !blob[i - w] && !seen[i - w]) (seen[i - w] = 1, stack[top++] = i - w);
        if (i < w * (h - 1) && !blob[i + w] && !seen[i + w]) (seen[i + w] = 1, stack[top++] = i + w);
      }
    };
    const none = () => {};
    for (let i = 0; i < w; i++) {
      if (!blob[i] && !seen[i]) flood(i, none);
      const b = (h - 1) * w + i;
      if (!blob[b] && !seen[b]) flood(b, none);
    }
    for (let j = 0; j < h; j++) {
      if (!blob[j * w] && !seen[j * w]) flood(j * w, none);
      const b = j * w + w - 1;
      if (!blob[b] && !seen[b]) flood(b, none);
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let s = 0; s < w * h; s++) {
      if (blob[s] || seen[s]) continue;
      const cells = [];
      let edge = 0;
      let soft = 0;
      flood(s, (i) => {
        cells.push(i);
        for (const [dx, dy] of dirs) {
          const x = (i % w) + dx;
          const y = Math.floor(i / w) + dy;
          if (x < 0 || y < 0 || x >= w || y >= h || !blob[y * w + x]) continue;
          edge++;
          // Tuz za krawedzia, bo dalej mogloby juz byc nastepne okno: szprycha ma tylko pare pikseli.
          let sharp = false;
          for (let d = 0; d < 3 && !sharp; d++) {
            const fx = x + dx * d;
            const fy = y + dy * d;
            if (fx >= 0 && fy >= 0 && fx < w && fy < h && diff(fy * w + fx) >= 150) sharp = true;
          }
          if (!sharp) soft++;
        }
      });
      if (edge && soft / edge > 0.7) cells.forEach((i) => {
        out[i] = 1;
      });
    }
    return out;
  }

  /**
   * Cien pod przedmiotem: szary, bez koloru, lezy nizej niz najnizszy prawdziwy element (opona, stopa) i
   * plynnie przechodzi w tlo. Srebrny wydech czy felga leza wyzej, wiec zostaja. Gdy odciecie zabraloby
   * za duzo albo dolna krawedz jest ostra, obrys zostaje bez zmian.
   */
  function dropShadow(blob, img, bg, w, h) {
    const { data } = img;
    let minY = h;
    let maxY = 0;
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (!blob[i]) continue;
      const y = Math.floor(i / w);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      n++;
    }
    if (!n) return blob;
    const light = bg[0] + bg[1] + bg[2];
    // Na ciemnym tle cien nie jest jasniejszy od opon i nie da sie go tak odroznic.
    if (light < 380) return blob;
    const isShadow = (i) => {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      return Math.max(r, g, b) - Math.min(r, g, b) < 16 && r + g + b > light * 0.55;
    };
    const limit = maxY - Math.round((maxY - minY) * 0.22);
    let support = maxY;
    for (; support >= limit; support--) {
      let solid = 0;
      for (let x = 0; x < w; x++) {
        const i = support * w + x;
        if (blob[i] && !isShadow(i)) solid++;
      }
      if (solid >= Math.max(3, w * 0.004)) break;
    }
    // Pasek cienia miedzy kolami lezy na tej samej wysokosci co opony: zjadamy go od zewnatrz, bo felga
    // i srebrne czesci sa odgrodzone ciemnym materialem i tam sie nie dojdzie.
    const band = maxY - Math.round((maxY - minY) * 0.12);
    const pale = new Uint8Array(w * h);
    const stack = [];
    for (let y = band; y <= maxY; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!blob[i] || !isShadow(i) || data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] < light * 0.7) continue;
        if (!blob[i - 1] || !blob[i + 1] || !blob[i + w]) {
          pale[i] = 1;
          stack.push(i);
        }
      }
    }
    while (stack.length) {
      const i = stack.pop();
      for (const q of [i - 1, i + 1, i - w, i + w]) {
        if (q < band * w || q >= (maxY + 1) * w || !blob[q] || pale[q] || !isShadow(q) || data[q * 4] + data[q * 4 + 1] + data[q * 4 + 2] < light * 0.7) continue;
        pale[q] = 1;
        stack.push(q);
      }
    }
    // Linia styku z ziemia bywa ciemna, ale jest cienka, dluga, szara i odstaje od reszty przedmiotu.
    // Podstawa przedmiotu styka sie z nim, wiec ma nad soba material i tu nie pasuje.
    const thinMax = Math.max(2, Math.round((maxY - minY) * 0.035));
    const line = new Uint8Array(w * h);
    const clear = (i) => !blob[i] || pale[i];
    let runStart = -1;
    const runs = [];
    for (let x = 0; x <= w; x++) {
      let thin = false;
      let top = 0;
      let bottom = 0;
      if (x < w) {
        let y = maxY;
        while (y >= band && clear(y * w + x)) y--;
        bottom = y;
        while (y >= band && !clear(y * w + x)) y--;
        top = y + 1;
        const thick = bottom - top + 1;
        thin = bottom >= band && y >= band && thick <= thinMax;
        if (thin) {
          const mid = Math.floor((top + bottom) / 2) * w + x;
          if (Math.max(data[mid * 4], data[mid * 4 + 1], data[mid * 4 + 2]) - Math.min(data[mid * 4], data[mid * 4 + 1], data[mid * 4 + 2]) >= 16) thin = false;
          for (let k = 0; thin && k < thick * 2; k++) {
            if (y - k >= 0 && !clear((y - k) * w + x)) thin = false;
          }
        }
      }
      if (thin && runStart < 0) runStart = x;
      if (!thin && runStart >= 0) {
        runs.push([runStart, x]);
        runStart = -1;
      }
    }
    let lined = false;
    const needed = Math.max(8, Math.round(w * 0.05));
    for (const [from, to] of runs) {
      if (to - from < needed) continue;
      lined = true;
      for (let x = from; x < to; x++) {
        let y = maxY;
        while (y >= band && clear(y * w + x)) y--;
        while (y >= band && !clear(y * w + x)) {
          line[y * w + x] = 1;
          y--;
        }
      }
    }
    if (support >= maxY || support < limit) {
      if (!lined && !pale.some(Boolean)) return blob;
      support = maxY;
    }
    // Dolna krawedz cienia jest prawie w kolorze tla, a krawedz przedmiotu wyraznie od niego odstaje.
    let edge = 0;
    let edges = 0;
    for (let x = 0; x < w; x++) {
      for (let y = maxY; y > support; y--) {
        const i = y * w + x;
        if (!blob[i]) continue;
        edge += Math.abs(data[i * 4] - bg[0]) + Math.abs(data[i * 4 + 1] - bg[1]) + Math.abs(data[i * 4 + 2] - bg[2]);
        edges++;
        break;
      }
    }
    if (edges && edge / edges > 170) return blob;
    const mask = blob.slice();
    for (let y = support + 1; y <= maxY; y++) mask.fill(0, y * w, (y + 1) * w);
    for (let i = 0; i < w * h; i++) {
      if (pale[i] || line[i]) mask[i] = 0;
    }
    const kept = largestBlob({ mask, w, h });
    let left = 0;
    for (let i = 0; i < w * h; i++) left += kept[i];
    return left >= n * 0.7 ? kept : blob;
  }

  /** Granica maski jako petle wzdluz krawedzi pikseli. Material zawsze po lewej stronie kierunku. */
  function traceLoops(mask, w, h, x0 = 0, y0 = 0, x1 = w, y1 = h) {
    const at = (x, y) => x >= x0 && y >= y0 && x < x1 && y < y1 && mask[y * w + x] === 1;
    const next = new Map();
    const add = (ax, ay, bx, by) => {
      const k = ay * (w + 1) + ax;
      const v = next.get(k);
      if (v) v.push(by * (w + 1) + bx);
      else next.set(k, [by * (w + 1) + bx]);
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!at(x, y)) continue;
        if (!at(x, y - 1)) add(x + 1, y, x, y);
        if (!at(x, y + 1)) add(x, y + 1, x + 1, y + 1);
        if (!at(x - 1, y)) add(x, y, x, y + 1);
        if (!at(x + 1, y)) add(x + 1, y + 1, x + 1, y);
      }
    }
    const loops = [];
    for (const start of next.keys()) {
      while (next.get(start)?.length) {
        const loop = [];
        let k = start;
        do {
          const list = next.get(k);
          if (!list || !list.length) break;
          const n = list.pop();
          loop.push([k % (w + 1), Math.floor(k / (w + 1))]);
          k = n;
        } while (k !== start);
        if (loop.length >= 4) loops.push(loop);
      }
    }
    return loops;
  }

  function area(loop) {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const q = loop[(i + 1) % loop.length];
      a += loop[i][0] * q[1] - q[0] * loop[i][1];
    }
    return a / 2;
  }

  function rdp(points, eps) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = points[a];
      const [bx, by] = points[b];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      let far = -1;
      let dist = eps;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len;
        if (d > dist) {
          dist = d;
          far = i;
        }
      }
      if (far >= 0) {
        keep[far] = 1;
        stack.push([a, far], [far, b]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }
  /** Uproszczenie zamknietej petli: tniemy ja na dwa luki w najdalszych punktach. */
  function simplifyLoop(loop, eps) {
    let far = 0;
    let best = -1;
    loop.forEach((p, i) => {
      const d = (p[0] - loop[0][0]) ** 2 + (p[1] - loop[0][1]) ** 2;
      if (d > best) {
        best = d;
        far = i;
      }
    });
    const a = rdp(loop.slice(0, far + 1), eps);
    const b = rdp([...loop.slice(far), loop[0]], eps);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
  }

  function inPoly(x, y, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (poly[i][1] > y !== poly[j][1] > y && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
    }
    return c;
  }

  /** Obszar: prostokat [x0, y0, x1, y1] albo wielokat [[x, y]...] w pikselach. */
  const regionPoly = (r) => (typeof r[0] === 'number' ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : r);

  /**
   * Podzial przedmiotu na czesci. Pierwszy obszar na liscie ma pierwszenstwo, a piksele poza
   * wszystkimi obszarami trafiaja do czesci "reszta", jesli jest. Zwraca kontury w mm.
   */
  function traceParts(img, opts) {
    const m = buildMask(img, opts.tol);
    const { w, h } = m;
    let blob = largestBlob(m);
    if (opts.czysc) blob = fillReflections(dropShadow(blob, img, m.bg, w, h), img, m.bg, w, h);
    let total = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    for (let i = 0; i < w * h; i++) {
      if (!blob[i]) continue;
      total++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const widthPx = maxX - minX + 1;
    // Skala: dlugosc to szerokosc na zdjeciu, a przy dluzszy: true dluzszy bok przedmiotu (np. stojaca rakieta).
    const basePx = opts.dluzszy ? Math.max(widthPx, maxY - minY + 1) : widthPx;
    const k = (opts.dlugosc || basePx) / basePx; // mm na piksel
    const cx = opts.cx ?? (minX + maxX + 1) / 2;
    const cy = opts.cy ?? (minY + maxY + 1) / 2;
    const flip = opts.flip ? -1 : 1;
    const toMm = ([x, y]) => [Math.round((x - cx) * k * flip * 100) / 100 || 0, Math.round((cy - y) * k * 100) / 100 || 0];
    const claimed = new Uint8Array(w * h);
    const eps = opts.eps ?? 0.7;
    const minHole = opts.minHole ?? 120;
    const parts = [];
    let used = 0;
    const medianColor = (piece) => {
      const ch = [[], [], []];
      const step = Math.max(1, Math.floor(total / 4000));
      for (let i = 0, n = 0; i < w * h; i++) {
        if (piece[i] && n++ % step === 0) [0, 1, 2].forEach((k) => ch[k].push(img.data[i * 4 + k]));
      }
      if (!ch[0].length) return null;
      return `#${ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1].toString(16).padStart(2, '0')).join('')}`;
    };
    const queue = opts.parts.slice();
    let extra = 0;
    while (queue.length) {
      const part = queue.shift();
      const poly = regionPoly(part.obszar);
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      const bx0 = Math.max(0, Math.floor(Math.min(...xs)));
      const bx1 = Math.min(w, Math.ceil(Math.max(...xs)));
      const by0 = Math.max(0, Math.floor(Math.min(...ys)));
      const by1 = Math.min(h, Math.ceil(Math.max(...ys)));
      const local = new Uint8Array(w * h);
      for (let y = by0; y < by1; y++) {
        for (let x = bx0; x < bx1; x++) {
          const i = y * w + x;
          if (blob[i] && !claimed[i] && inPoly(x + 0.5, y + 0.5, poly)) {
            local[i] = 1;
            claimed[i] = 1;
          }
        }
      }
      const piece = largestBlob({ mask: local, w, h });
      // Reszta z obszaru nie moze zniknac: wraca do puli, a ostatnia czesc zbiera ja jako osobne kawalki.
      let leftover = 0;
      for (let i = 0; i < w * h; i++) {
        if (local[i] && !piece[i]) {
          claimed[i] = 0;
          leftover++;
        }
      }
      if (part.reszta && leftover > minHole && extra < 12) {
        extra++;
        queue.push({ ...part, id: `${part.id.replace(/_\d+$/, '')}_${extra}`, nazwa: `${part.nazwa.replace(/ \d+$/, '')} ${extra + 1}` });
      }
      const loops = traceLoops(piece, w, h, bx0, by0, bx1, by1);
      if (!loops.length) continue;
      for (let i = 0; i < w * h; i++) used += piece[i];
      // W ukladzie obrazu (y w dol) obrys ma znak dodatni przy materiale po lewej: najwieksza petla to obrys.
      const sorted = loops.map((l) => ({ l, a: area(l) })).sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
      const outer = sorted[0];
      const holes = sorted.slice(1).filter((s) => Math.abs(s.a) >= minHole && Math.sign(s.a) !== Math.sign(outer.a));
      const entry = { ...part, kontur: simplifyLoop(outer.l, eps).map(toMm), otwory: holes.map((s) => simplifyLoop(s.l, eps).map(toMm)), pxArea: Math.abs(outer.a) };
      delete entry.obszar;
      delete entry.reszta;
      if (opts.czysc) entry.kolorZdjecia = medianColor(piece);
      if (part.obrotowa) {
        // Bryla obrotowa: promien z wysokosci kazdej kolumny, os wzdluz X zdjecia.
        const prof = [];
        for (let x = bx0; x < bx1; x += 1) {
          let lo = -1;
          let hi = -1;
          for (let y = by0; y < by1; y++) {
            if (piece[y * w + x]) {
              if (lo < 0) lo = y;
              hi = y + 1;
            }
          }
          if (lo >= 0) prof.push([(hi - lo) / 2, x + 0.5, (lo + hi) / 2]);
        }
        if (prof.length >= 2) {
          // Kolumny mierzymy w srodku piksela, a bryla konczy sie na jego krawedzi.
          prof[0][1] -= 0.5;
          prof[prof.length - 1][1] += 0.5;
          const axisY = prof.reduce((s, p) => s + p[2], 0) / prof.length;
          const pts = rdp(prof.map((p) => [p[0], p[1]]), eps);
          entry.profil = pts.map(([r, x]) => [Math.round(r * k * 100) / 100, Math.round((x - cx) * k * flip * 100) / 100]);
          entry.osY = Math.round((cy - axisY) * k * 100) / 100;
        }
      }
      parts.push(entry);
    }
    return { k, cx, cy, flip, w, h, widthPx, bbox: [minX, minY, maxX + 1, maxY + 1], parts, pokrycie: total ? used / total : 0 };
  }

  /** Czy zdjecie nadaje sie do odrysu: wydluzony przedmiot na jednolitym tle, bez dotykania brzegow. */
  function photoQuality(img) {
    const m = buildMask(img);
    const blob = largestBlob(m);
    const { w, h } = m;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    let n = 0;
    let all = 0;
    for (let i = 0; i < w * h; i++) {
      if (m.mask[i]) all++;
      if (!blob[i]) continue;
      n++;
      const x = i % w;
      const y = (i - x) / w;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const touches = minX <= 1 || minY <= 1 || maxX >= w - 2 || maxY >= h - 2;
    const fill = n / ((maxX - minX + 1) * (maxY - minY + 1) || 1);
    const stray = all ? 1 - n / all : 1;
    // Os przedmiotu: dlugi przedmiot ulozony na ukos to prawie zawsze zdjecie z perspektywa.
    let sx = 0;
    let sy = 0;
    let c = 0;
    let border = 0;
    let faint = 0;
    const step = Math.max(1, Math.floor(n / 20000));
    let mx = 0;
    let my = 0;
    let seen = 0;
    for (let i = 0; i < w * h; i++) {
      if (!blob[i]) continue;
      if (seen++ % step === 0) {
        mx += i % w;
        my += Math.floor(i / w);
      }
    }
    const samples = Math.ceil(n / step) || 1;
    mx /= samples;
    my /= samples;
    seen = 0;
    for (let i = 0; i < w * h; i++) {
      if (!blob[i]) continue;
      if (seen++ % step === 0) {
        const dx = (i % w) - mx;
        const dy = Math.floor(i / w) - my;
        sx += dx * dx;
        sy += dy * dy;
        c += dx * dy;
      }
      // Krawedz prawie w kolorze tla: przedmiot zlewa sie z tlem i obrys bedzie poszarpany.
      if (i % w > 0 && i % w < w - 1 && i >= w && i < w * (h - 1) && (!blob[i - 1] || !blob[i + 1] || !blob[i - w] || !blob[i + w])) {
        border++;
        // Mierzymy pare pikseli w glab: sam brzeg jest wygladzony i na kazdym zdjeciu wyglada na blady.
        const inward = !blob[i - 1] ? 3 : !blob[i + 1] ? -3 : !blob[i - w] ? 3 * w : -3 * w;
        const q = Math.max(0, Math.min(w * h - 1, i + inward));
        const d = Math.abs(img.data[q * 4] - m.bg[0]) + Math.abs(img.data[q * 4 + 1] - m.bg[1]) + Math.abs(img.data[q * 4 + 2] - m.bg[2]);
        if (d < 90) faint++;
      }
    }
    const half = Math.sqrt(((sx - sy) / 2) ** 2 + c * c);
    const major = (sx + sy) / 2 + half;
    const minor = Math.max(1e-6, (sx + sy) / 2 - half);
    const tilt = (Math.abs(Math.atan2(2 * c, sx - sy) / 2) * 180) / Math.PI; // 0 = poziomo, 90 = pionowo
    const longish = Math.sqrt(major / minor) >= 1.7;
    const skos = longish && Math.min(tilt, 90 - tilt) > 18;
    const aspect = (maxX - minX + 1) / Math.max(1, maxY - minY + 1);
    return { ok: n > 500 && !touches && fill < 0.98 && stray < 0.25, touches, fill, stray, aspect, skos, krawedz: Math.max(aspect, 1 / aspect) > 5.5, slaba: border ? faint / border : 1, bbox: [minX, minY, maxX + 1, maxY + 1] };
  }

  /** Kontur wewnetrzny obudowy: uproszczony (bez zebow szyn) i przesuniety do srodka. */
  function insetCoarse(loop, d) {
    const coarse = simplifyLoop(loop, d * 0.9);
    const sign = area(coarse) > 0 ? 1 : -1;
    const out = coarse.map((v, i) => {
      const a = coarse[(i + coarse.length - 1) % coarse.length];
      const b = coarse[(i + 1) % coarse.length];
      const l1 = Math.hypot(v[0] - a[0], v[1] - a[1]) || 1;
      const l2 = Math.hypot(b[0] - v[0], b[1] - v[1]) || 1;
      const n = [-(v[1] - a[1]) / l1 - (b[1] - v[1]) / l2, (v[0] - a[0]) / l1 + (b[0] - v[0]) / l2];
      const nl = Math.hypot(n[0], n[1]) || 1;
      return [Math.round((v[0] + (sign * n[0] * d) / nl) * 100) / 100, Math.round((v[1] + (sign * n[1] * d) / nl) * 100) / 100];
    });
    return out.filter((p) => inPoly(p[0], p[1], loop));
  }

  /** Czesc Studia 3D z konturu: srodek w pozycji czesci, zeby uchwyty i obroty dzialaly normalnie. */
  function toPart(t, defaults = {}) {
    const xs = t.kontur.map((p) => p[0]);
    const ys = t.kontur.map((p) => p[1]);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    const shift = (l) => l.map((p) => [Math.round((p[0] - x) * 100) / 100, Math.round((p[1] - y) * 100) / 100]);
    const base = { id: t.id, nazwa: t.nazwa, grupa: t.grupa, krok: t.krok, kolor: t.kolor, metal: t.metal, szorstkosc: t.szorstkosc, rozst: t.rozst, zrodlo: 'plany', ...defaults };
    if (t.profil) {
      const ps = t.profil.map((p) => p[1]);
      const px = (Math.min(...ps) + Math.max(...ps)) / 2;
      // Oś bryly (lokalne Y) kladziemy wzdluz X projektu.
      return { ...base, ksztalt: 'obrotowa', profil: t.profil.map(([r, v]) => [r, Math.round((v - px) * 100) / 100]).sort((a, b) => a[1] - b[1]), x: px, y: t.osY, z: 0, rz: -90 };
    }
    const kontur = shift(t.kontur);
    const otwory = (t.otwory || []).map((l) => ({ kontur: shift(l) }));
    const gr = t.gr || 20;
    const place = { x, y, z: 0, skora: true };
    if (t.skorupa) {
      // Wydrazona obudowa: dwie sciany z konturem i obwod, zeby w srodku bylo miejsce na mechanizm.
      const wall = t.skorupa;
      const inner = insetCoarse(kontur, wall + 1.5);
      const elementy = [-1, 1].map((s) => ({ ksztalt: 'boczny', kontur, gr: wall, faza: t.faza, z: (s * (gr - wall)) / 2, otwory }));
      if (inner.length >= 3) elementy.push({ ksztalt: 'boczny', kontur, gr: gr - wall * 2, otwory: [{ kontur: inner }] });
      return { ...base, ksztalt: 'zespol', elementy, ...place };
    }
    if (t.oble) return { ...base, ksztalt: 'boczny', kontur, otwory, gr, oble: true, szer: t.szer, ...place };
    return { ...base, ksztalt: 'boczny', kontur, otwory, gr, faza: t.faza, ...place };
  }

  return { fillReflections, dropShadow, buildMask, largestBlob, traceLoops, traceParts, photoQuality, simplifyLoop, toPart };
});
