// Skan 3D ze zdjec dookola przedmiotu (kadlub wizualny): z kazdego zdjecia sylwetka, z sylwetek bryla
// w siatce wokseli, z wokseli gladka powierzchnia (naive surface nets + wygladzanie). Czysta logika:
// testy w tests/scan3d.test.mjs. Zalozenia: aparat stoi w miejscu (statyw), przedmiot obraca sie wokol
// pionowej osi o rowne katy, tlo jednolite. Wklesniecia, ktorych nie widac w zadnej sylwetce, zostaja wypelnione.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scan3D = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Ramka sylwetki: kolumny i wiersze z przedmiotem. mask: Uint8Array w*h. */
  function bbox(mask, w, h) {
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0, x1, y0, y1 };
  }

  /**
   * Male dziury w sylwetce (odblask, napis w kolorze tla) zapelnione: w kadlubie wizualnym przewiercilyby
   * bryle na wylot. Wieksze zostaja, bo to prawdziwe przeswity (ucho kubka). maxArea: w pikselach.
   */
  function fillSmallHoles(mask, w, h, maxArea) {
    const out = Uint8Array.from(mask);
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (out[s] || seen[s]) continue;
      let top = 0;
      stack[top++] = s;
      seen[s] = 1;
      const cells = [];
      let border = false;
      while (top) {
        const i = stack[--top];
        cells.push(i);
        const x = i % w;
        const y = (i - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && !out[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
      if (!border && cells.length <= maxArea) for (const i of cells) out[i] = 1;
    }
    return out;
  }

  /**
   * Kadlub wizualny. views: [{ mask, w, h, angle (radiany) }], height: prawdziwa wysokosc w mm.
   * Os obrotu to srednia srodkow sylwetek (przy statywie i obrotowej podstawce stoi w miejscu).
   * Zwraca siatke wokseli { n: [nx, ny, nz], cell (mm), origin [x, y, z], data: Uint8Array }.
   */
  function carve(views, { height, res = 72 } = {}) {
    const boxes = views.map((v) => bbox(v.mask, v.w, v.h));
    if (boxes.some((b) => !b)) throw new Error('Na którymś zdjęciu nie widać przedmiotu.');
    const axis = boxes.reduce((s, b) => s + (b.x0 + b.x1 + 1) / 2, 0) / boxes.length;
    const bottom = Math.max(...boxes.map((b) => b.y1 + 1));
    const top = Math.min(...boxes.map((b) => b.y0));
    const hPx = bottom - top;
    const k = Number(height) > 0 ? Number(height) / hPx : 1; // mm na piksel
    const reach = Math.max(...boxes.map((b) => Math.max(axis - b.x0, b.x1 + 1 - axis))) * k;
    const cell = (2 * reach) / res;
    const nx = res;
    const nz = res;
    const ny = Math.max(4, Math.ceil((hPx * k) / cell));
    const data = new Uint8Array(nx * ny * nz);
    const trig = views.map((v) => [Math.cos(v.angle), Math.sin(v.angle)]);
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * cell;
      for (let i = 0; i < nx; i++) {
        const x = -reach + (i + 0.5) * cell;
        for (let l = 0; l < nz; l++) {
          const z = -reach + (l + 0.5) * cell;
          let keep = 1;
          for (let t = 0; t < views.length && keep; t++) {
            const v = views[t];
            // Obrot przedmiotu o kat widoku: wspolrzedna pozioma w obrazie to rzut na os X kamery.
            const u = Math.floor(axis + (x * trig[t][0] + z * trig[t][1]) / k);
            const r = Math.floor(bottom - 1 - y / k);
            keep = u >= 0 && u < v.w && r >= 0 && r < v.h && v.mask[r * v.w + u] ? 1 : 0;
          }
          data[(j * nz + l) * nx + i] = keep;
        }
      }
    }
    return { n: [nx, ny, nz], cell, origin: [-reach, 0, -reach], data, mmPerPx: k };
  }

  /**
   * Naive surface nets: jeden wierzcholek w kazdej komorce przecinajacej powierzchnie, czworokaty miedzy
   * nimi. Zwraca { positions: Float32Array, indices: Uint32Array } w mm, sciany na zewnatrz.
   */
  function surfaceNets(grid) {
    const [nx, ny, nz] = grid.n;
    const at = (i, j, l) => (i < 0 || j < 0 || l < 0 || i >= nx || j >= ny || l >= nz ? 0 : grid.data[(j * nz + l) * nx + i]);
    // Komorki rozpiete miedzy srodkami wokseli, z marginesem o jeden, zeby bryla byla zamknieta.
    const cx = nx + 1;
    const cy = ny + 1;
    const cz = nz + 1;
    const vid = new Int32Array(cx * cy * cz).fill(-1);
    const pos = [];
    for (let j = 0; j < cy; j++) {
      for (let l = 0; l < cz; l++) {
        for (let i = 0; i < cx; i++) {
          let mask = 0;
          let c = 0;
          for (let d = 0; d < 8; d++) {
            const v = at(i - 1 + (d & 1), j - 1 + ((d >> 1) & 1), l - 1 + ((d >> 2) & 1));
            mask |= v << d;
            c += v;
          }
          if (c === 0 || c === 8) continue;
          // Srodek ciezkosci punktow przeciecia krawedzi komorki (dla danych 0/1 to srodki krawedzi).
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let m = 0;
          for (let d = 0; d < 8; d++) {
            for (const bit of [1, 2, 4]) {
              const e = d | bit;
              if (e === d) continue;
              if (((mask >> d) & 1) !== ((mask >> e) & 1)) {
                sx += ((d & 1) + (e & 1)) / 2;
                sy += (((d >> 1) & 1) + ((e >> 1) & 1)) / 2;
                sz += (((d >> 2) & 1) + ((e >> 2) & 1)) / 2;
                m++;
              }
            }
          }
          vid[(j * cz + l) * cx + i] = pos.length / 3;
          pos.push(i - 1 + sx / m, j - 1 + sy / m, l - 1 + sz / m);
        }
      }
    }
    const idx = [];
    const V = (i, j, l) => (i < 0 || j < 0 || l < 0 || i >= cx || j >= cy || l >= cz ? -1 : vid[(j * cz + l) * cx + i]);
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    };
    // Kazda krawedz miedzy dwoma wokselami o roznym stanie daje czworokat z czterech sasiednich komorek.
    for (let j = 0; j <= ny; j++) {
      for (let l = 0; l <= nz; l++) {
        for (let i = 0; i <= nx; i++) {
          const here = at(i, j, l);
          // Komorka (i, j, l) obejmuje probki i-1..i, j-1..j, l-1..l, wiec krawedz miedzy probkami
          // (i-1) i (i) wzdluz X dziela komorki i oraz j..j+1, l..l+1.
          if (here !== at(i - 1, j, l)) quad(V(i, j, l), V(i, j + 1, l), V(i, j + 1, l + 1), V(i, j, l + 1), here === 1);
          if (here !== at(i, j - 1, l)) quad(V(i, j, l), V(i, j, l + 1), V(i + 1, j, l + 1), V(i + 1, j, l), here === 1);
          if (here !== at(i, j, l - 1)) quad(V(i, j, l), V(i + 1, j, l), V(i + 1, j + 1, l), V(i, j + 1, l), here === 1);
        }
      }
    }
    const positions = new Float32Array(pos.length);
    for (let p = 0; p < pos.length; p += 3) {
      positions[p] = grid.origin[0] + (pos[p] + 0.5) * grid.cell;
      positions[p + 1] = grid.origin[1] + (pos[p + 1] + 0.5) * grid.cell;
      positions[p + 2] = grid.origin[2] + (pos[p + 2] + 0.5) * grid.cell;
    }
    return { positions, indices: Uint32Array.from(idx) };
  }

  /** Wygladzanie Taubina: zabiera schodki po wokselach, prawie nie zmniejszajac bryly. */
  function smooth(mesh, iterations = 6, lambda = 0.5, mu = -0.53) {
    const n = mesh.positions.length / 3;
    const nb = Array.from({ length: n }, () => new Set());
    const f = mesh.indices;
    for (let t = 0; t < f.length; t += 3) {
      for (let a = 0; a < 3; a++) {
        nb[f[t + a]].add(f[t + ((a + 1) % 3)]);
        nb[f[t + a]].add(f[t + ((a + 2) % 3)]);
      }
    }
    let p = Float32Array.from(mesh.positions);
    const step = (factor) => {
      const out = new Float32Array(p.length);
      for (let v = 0; v < n; v++) {
        const s = nb[v];
        if (!s.size) {
          out.set(p.subarray(v * 3, v * 3 + 3), v * 3);
          continue;
        }
        let x = 0;
        let y = 0;
        let z = 0;
        for (const q of s) {
          x += p[q * 3];
          y += p[q * 3 + 1];
          z += p[q * 3 + 2];
        }
        out[v * 3] = p[v * 3] + factor * (x / s.size - p[v * 3]);
        out[v * 3 + 1] = p[v * 3 + 1] + factor * (y / s.size - p[v * 3 + 1]);
        out[v * 3 + 2] = p[v * 3 + 2] + factor * (z / s.size - p[v * 3 + 2]);
      }
      p = out;
    };
    for (let i = 0; i < iterations; i++) {
      step(lambda);
      step(mu);
    }
    return { positions: p, indices: mesh.indices };
  }

  /** Objetosc siatki (mm3), dodatnia dla scian na zewnatrz. */
  function volume(mesh) {
    const p = mesh.positions;
    const f = mesh.indices;
    let v = 0;
    for (let t = 0; t < f.length; t += 3) {
      const a = f[t] * 3;
      const b = f[t + 1] * 3;
      const c = f[t + 2] * 3;
      v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
    return v;
  }

  /** Od zdjec do siatki: views z maskami, wysokosc w mm. */
  function scan(views, { height, res = 72, smoothing = 6 } = {}) {
    const grid = carve(views, { height, res });
    let filled = 0;
    for (let i = 0; i < grid.data.length; i++) filled += grid.data[i];
    if (filled < 8) throw new Error('Sylwetki się nie pokrywają: sprawdź kolejność zdjęć i czy aparat stał w miejscu.');
    const mesh = smooth(surfaceNets(grid), smoothing);
    return { ...mesh, grid: { n: grid.n, cell: grid.cell }, mmPerPx: grid.mmPerPx, triangles: mesh.indices.length / 3 };
  }

  return { bbox, fillSmallHoles, carve, surfaceNets, smooth, volume, scan };
});
