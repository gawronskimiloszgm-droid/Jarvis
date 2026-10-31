// Geometria Studia 3D (czysta logika, bez DOM): projekt to lista nazwanych czesci, kazda z wlasnym
// ksztaltem, pozycja i krokiem montazu. Ten sam kod liczy siatki w przegladarce, na serwerze (STL do
// druku) i dla Blendera, wiec wymiary zgadzaja sie wszedzie. tests/cadkit.test.mjs sprawdza, ze
// kazdy ksztalt jest zamknieta bryla.
//
// Uklad wspolrzednych: milimetry, os Y w gore, pozycja to srodek czesci, obrot XYZ w stopniach
// (macierz Rx*Ry*Rz, jak domyslny Euler w three.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CadKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SHAPES = {
    pudelko: 'prostopadłościan: sx, sy, sz',
    walec: 'walec lub stożek: r (dół), r2 (góra), h',
    rura: 'rura: r, ri, h',
    kula: 'kula lub elipsoida: r albo sx, sy, sz (średnice)',
    torus: 'pierścień: R, r',
    klin: 'klin: sx, sy, sz',
    pryzmat: 'graniastosłup: n boków, r, h',
    sruba: 'śruba z łbem: r, h',
    plyta: 'płyta z otworami: sx, sy, sz, otwory [{x, z, r}]',
    wyciagniecie: 'dowolny kontur 2D wyciągnięty: kontur [[x, z]...], h, otwory',
    obrotowa: 'bryła obrotowa (kadłub, kielich, kopuła): profil [[r, y]...]',
    loft: 'przejście przez przekroje (nadwozie, skrzydło): przekroje [{p, typ, a, b, dx, dz}]',
    rurka: 'rurka po ścieżce (kable, wydech): sciezka [[x, y, z]...], r',
    sprezyna: 'sprężyna: R, r, skok, zwoje',
    kolo_zebate: 'koło zębate: z (liczba zębów), m (moduł), h, otwor',
  };
  const MAX_PARTS = 400;
  const MAX_POINTS = 200;
  const clamp = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const LIM = 2000000; // 2 km: repliki opisujemy w rzeczywistych wymiarach
  const size = (v, d) => clamp(v, 0.01, LIM, d);
  const pos = (v) => clamp(v, -LIM, LIM, 0);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // ---------- podstawy siatki ----------
  const tri = (o, a, b, c) => o.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const quad = (o, a, b, c, d) => {
    tri(o, a, b, c);
    tri(o, a, c, d);
  };

  function signedVolume(m) {
    let v = 0;
    for (let i = 0; i + 8 < m.length; i += 9) {
      v += m[i] * (m[i + 4] * m[i + 8] - m[i + 5] * m[i + 7]) - m[i + 1] * (m[i + 3] * m[i + 8] - m[i + 5] * m[i + 6]) + m[i + 2] * (m[i + 3] * m[i + 7] - m[i + 4] * m[i + 6]);
    }
    return v / 6;
  }
  function flip(m) {
    for (let i = 0; i + 8 < m.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = m[i + 3 + k];
        m[i + 3 + k] = m[i + 6 + k];
        m[i + 6 + k] = t;
      }
    }
    return m;
  }

  // Bryla obrotowa wokol Y. profil: [[r, y]...]; otwarty profil zamykamy na osi.
  function revolve(profile, seg, closedLoop) {
    const pts = profile.map((p) => [p[0] < 1e-9 ? 0 : p[0], p[1]]);
    const prof = closedLoop ? [...pts, pts[0]] : pts;
    if (!closedLoop) {
      if (prof[0][0] > 1e-6) prof.unshift([0, prof[0][1]]);
      if (prof[prof.length - 1][0] > 1e-6) prof.push([0, prof[prof.length - 1][1]]);
    }
    const o = [];
    const at = (p, i) => {
      const t = ((i % seg) / seg) * Math.PI * 2;
      return [p[0] * Math.cos(t), p[1], p[0] * Math.sin(t)];
    };
    for (let j = 0; j + 1 < prof.length; j++) {
      const p = prof[j];
      const q = prof[j + 1];
      if (p[0] < 1e-6 && q[0] < 1e-6) continue;
      for (let i = 0; i < seg; i++) {
        const a = at(p, i);
        const b = at(p, i + 1);
        const c = at(q, i + 1);
        const d = at(q, i);
        if (p[0] < 1e-6) tri(o, a, c, d);
        else if (q[0] < 1e-6) tri(o, a, b, c);
        else quad(o, a, b, c, d);
      }
    }
    return o;
  }

  function polyArea(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    return a / 2;
  }
  const orient = (p, ccw) => (polyArea(p) > 0 === ccw ? p.slice() : p.slice().reverse());

  function segCross(a, b, c, d) {
    const s = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return s(a, b, c) * s(a, b, d) < -1e-12 && s(c, d, a) * s(c, d, b) < -1e-12;
  }
  // Otwory wlaczamy do konturu mostkiem do najblizszego widocznego wierzcholka.
  function bridgeHoles(outer, holes) {
    let poly = orient(outer, true);
    const rest = holes.map((h) => orient(h, false)).sort((a, b) => Math.max(...b.map((p) => p[0])) - Math.max(...a.map((p) => p[0])));
    rest.forEach((hole, hi) => {
      let hIdx = 0;
      hole.forEach((p, i) => {
        if (p[0] > hole[hIdx][0]) hIdx = i;
      });
      const m = hole[hIdx];
      const others = rest.slice(hi + 1);
      const cands = poly.map((p, i) => ({ i, d: (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2 })).sort((a, b) => a.d - b.d);
      const ok = cands.find(({ i }) => {
        const v = poly[i];
        const clear = (loop) => loop.every((p, k) => {
          const q = loop[(k + 1) % loop.length];
          if (p === v || q === v || p === m || q === m) return true;
          return !segCross(m, v, p, q);
        });
        return clear(poly) && clear(hole) && others.every(clear);
      }) || cands[0];
      const ring = [...hole.slice(hIdx), ...hole.slice(0, hIdx), m];
      poly = [...poly.slice(0, ok.i + 1), ...ring, poly[ok.i], ...poly.slice(ok.i + 1)];
    });
    return poly;
  }
  // Obcinanie uszu: wystarcza na kontury do kilkuset punktow.
  function earcut(poly) {
    const idx = poly.map((_, i) => i);
    const out = [];
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;
    let guard = idx.length * idx.length + 16;
    while (idx.length > 3 && guard-- > 0) {
      let clipped = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length];
        const ib = idx[i];
        const ic = idx[(i + 1) % idx.length];
        const a = poly[ia];
        const b = poly[ib];
        const c = poly[ic];
        const area = cross(a, b, c);
        if (area <= 1e-12) continue;
        const blocked = idx.some((k) => {
          if (k === ia || k === ib || k === ic) return false;
          const p = poly[k];
          if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) return false;
          return inside(p, a, b, c);
        });
        if (blocked) continue;
        out.push([a, b, c]);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) {
        // Zdegenerowany fragment (punkty na jednej prostej): usuwamy najmniej znaczacy wierzcholek.
        let best = 0;
        let bestArea = Infinity;
        for (let i = 0; i < idx.length; i++) {
          const a = poly[idx[(i + idx.length - 1) % idx.length]];
          const b = poly[idx[i]];
          const c = poly[idx[(i + 1) % idx.length]];
          const ar = Math.abs(cross(a, b, c));
          if (ar < bestArea) {
            bestArea = ar;
            best = i;
          }
        }
        out.push([poly[idx[(best + idx.length - 1) % idx.length]], poly[idx[best]], poly[idx[(best + 1) % idx.length]]]);
        idx.splice(best, 1);
      }
    }
    if (idx.length === 3) out.push([poly[idx[0]], poly[idx[1]], poly[idx[2]]]);
    return out;
  }

  // Kontur [[x, z]...] wyciagniety wzdluz Y, srodek wysokosci w 0.
  function extrude(outer, holes, h) {
    const o = [];
    const top = h / 2;
    const bot = -h / 2;
    const up = (p) => [p[0], top, p[1]];
    const dn = (p) => [p[0], bot, p[1]];
    const merged = bridgeHoles(outer, holes);
    for (const [a, b, c] of earcut(merged)) {
      tri(o, up(a), up(b), up(c));
      tri(o, dn(a), dn(c), dn(b));
    }
    for (let i = 0; i < merged.length; i++) {
      const p = merged[i];
      const q = merged[(i + 1) % merged.length];
      if (p[0] === q[0] && p[1] === q[1]) continue;
      quad(o, dn(p), dn(q), up(q), up(p));
    }
    return o;
  }

  const circle = (x, z, r, n) => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [x + r * Math.cos(t), z + r * Math.sin(t)];
  });

  function box(sx, sy, sz) {
    const x = sx / 2;
    const y = sy / 2;
    const z = sz / 2;
    const o = [];
    const v = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
    [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]].forEach((f) => quad(o, v[f[0]], v[f[1]], v[f[2]], v[f[3]]));
    return o;
  }

  function wedge(sx, sy, sz) {
    const x = sx / 2;
    const y = sy / 2;
    const z = sz / 2;
    const o = [];
    const a = [-x, -y, -z];
    const b = [x, -y, -z];
    const c = [x, -y, z];
    const d = [-x, -y, z];
    const e = [-x, y, -z];
    const f = [x, y, -z];
    quad(o, a, b, c, d);
    quad(o, e, f, b, a);
    quad(o, d, c, f, e);
    tri(o, a, d, e);
    tri(o, b, f, c);
    return o;
  }

  // ---------- rurki i sprezyny ----------
  function catmull(pts, sub) {
    if (pts.length < 3) return pts;
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < sub; s++) {
        const t = s / sub;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };

  function sweep(path, r, n) {
    const clean = path.filter((p, i) => !i || Math.hypot(...sub3(p, path[i - 1])) > 1e-6);
    if (clean.length < 2) return box(r * 2, r * 2, r * 2);
    const o = [];
    let tan = norm3(sub3(clean[1], clean[0]));
    const seed = Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = norm3(cross3(tan, seed));
    const rings = clean.map((p, i) => {
      const nextTan = norm3(sub3(clean[Math.min(i + 1, clean.length - 1)], clean[Math.max(i - 1, 0)]));
      // Transport rownolegly: rura sie nie skreca po drodze.
      const v0 = cross3(nextTan, u);
      u = norm3(cross3(v0, nextTan));
      tan = nextTan;
      const v = norm3(cross3(tan, u));
      return Array.from({ length: n }, (_, k) => {
        const t = (k / n) * Math.PI * 2;
        const c = Math.cos(t) * r;
        const s = Math.sin(t) * r;
        return [p[0] + u[0] * c + v[0] * s, p[1] + u[1] * c + v[1] * s, p[2] + u[2] * c + v[2] * s];
      });
    });
    for (let j = 0; j + 1 < rings.length; j++) {
      for (let k = 0; k < n; k++) quad(o, rings[j][k], rings[j][(k + 1) % n], rings[j + 1][(k + 1) % n], rings[j + 1][k]);
    }
    const first = rings[0];
    const last = rings[rings.length - 1];
    for (let k = 0; k < n; k++) {
      tri(o, clean[0], first[(k + 1) % n], first[k]);
      tri(o, clean[clean.length - 1], last[k], last[(k + 1) % n]);
    }
    return o;
  }

  // ---------- przekroje ----------
  function sectionRing(s, n) {
    const a = Math.max(0.005, s.a);
    const b = Math.max(0.005, s.b);
    return Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      const c = Math.cos(t);
      const q = Math.sin(t);
      let x;
      let z;
      if (s.typ === 'prostokat') {
        const k = 1 / Math.max(Math.abs(c), Math.abs(q));
        x = a * c * k;
        z = b * q * k;
      } else if (s.typ === 'zaokraglony') {
        const e = 0.5; // superelipsa: miedzy elipsa a prostokatem
        x = a * Math.sign(c) * Math.abs(c) ** e;
        z = b * Math.sign(q) * Math.abs(q) ** e;
      } else {
        x = a * c;
        z = b * q;
      }
      return [x + s.dx, s.p, z + s.dz];
    });
  }
  function loft(sections, n, smooth) {
    let list = sections.slice().sort((a, b) => a.p - b.p);
    if (smooth && list.length >= 3) {
      const smoothed = catmull(list.map((s) => [s.p, s.a, s.b]), 4);
      const dxz = catmull(list.map((s) => [s.dx, s.dz, 0]), 4);
      list = smoothed.map((v, i) => {
        const src = list[Math.min(list.length - 1, Math.floor(i / 4))];
        return { p: v[0], a: Math.max(0.005, v[1]), b: Math.max(0.005, v[2]), dx: dxz[i][0], dz: dxz[i][1], typ: src.typ };
      });
    }
    const rings = list.map((s) => sectionRing(s, n));
    const o = [];
    for (let j = 0; j + 1 < rings.length; j++) {
      for (let i = 0; i < n; i++) quad(o, rings[j][i], rings[j][(i + 1) % n], rings[j + 1][(i + 1) % n], rings[j + 1][i]);
    }
    const c0 = [list[0].dx, list[0].p, list[0].dz];
    const lastS = list[list.length - 1];
    const c1 = [lastS.dx, lastS.p, lastS.dz];
    const last = rings[rings.length - 1];
    for (let i = 0; i < n; i++) {
      tri(o, c0, rings[0][(i + 1) % n], rings[0][i]);
      tri(o, c1, last[i], last[(i + 1) % n]);
    }
    return o;
  }

  // ---------- kolo zebate ----------
  function gearOutline(z, m) {
    const rp = (m * z) / 2;
    const ra = rp + m;
    const rf = Math.max(m * 0.4, rp - 1.25 * m);
    const step = (Math.PI * 2) / z;
    const pts = [];
    for (let i = 0; i < z; i++) {
      const t = i * step;
      const p = (r, frac) => [r * Math.cos(t + frac * step), r * Math.sin(t + frac * step)];
      pts.push(p(rf, 0), p(rf, 0.12), p(rp, 0.2), p(ra, 0.3), p(ra, 0.45), p(rp, 0.55), p(rf, 0.63), p(rf, 0.8));
    }
    return pts;
  }

  // ---------- normalizacja ----------
  const COLOR = /^#[0-9a-f]{6}$/i;
  const points2 = (v) => (Array.isArray(v) ? v : []).slice(0, MAX_POINTS).map((p) => (Array.isArray(p) ? [pos(p[0]), pos(p[1])] : null)).filter(Boolean);
  const points3 = (v) => (Array.isArray(v) ? v : []).slice(0, MAX_POINTS).map((p) => (Array.isArray(p) ? [pos(p[0]), pos(p[1]), pos(p[2])] : null)).filter(Boolean);
  const holes = (v) => (Array.isArray(v) ? v : []).slice(0, 40).map((h) => ({ x: pos(h?.x), z: pos(h?.z), r: size(h?.r, 1) }));

  function normalizePart(raw = {}, i = 0) {
    const ksztalt = SHAPES[raw.ksztalt] ? raw.ksztalt : 'pudelko';
    const p = {
      id: str(raw.id, 40).replace(/[^\w-]/g, '_') || `c${i + 1}`,
      nazwa: str(raw.nazwa, 80) || `Część ${i + 1}`,
      grupa: str(raw.grupa, 60) || 'Korpus',
      opis: str(raw.opis, 300),
      krok: Math.round(clamp(raw.krok, 1, 200, 1)),
      ksztalt,
      kolor: COLOR.test(raw.kolor) ? raw.kolor.toLowerCase() : '#8fa6b8',
      metal: clamp(raw.metal, 0, 1, 0.3),
      szorstkosc: clamp(raw.szorstkosc, 0, 1, 0.55),
      x: pos(raw.x),
      y: pos(raw.y),
      z: pos(raw.z),
      rx: clamp(raw.rx, -360, 360, 0),
      ry: clamp(raw.ry, -360, 360, 0),
      rz: clamp(raw.rz, -360, 360, 0),
      zrodlo: raw.zrodlo === 'plany' ? 'plany' : 'szacunek',
    };
    // Szlif w Blenderze: fazowanie krawedzi, wygladzanie, wyciecie czesci z innej.
    if (Number(raw.faza) > 0) p.faza = size(raw.faza, 0);
    if (raw.gladki) p.gladki = true;
    if (raw.ciecie) p.ciecie = true;
    if (['x', 'y', 'z'].includes(raw.odb)) p.odb = raw.odb;
    if (Array.isArray(raw.rozst)) p.rozst = [pos(raw.rozst[0]), pos(raw.rozst[1]), pos(raw.rozst[2])];

    if (ksztalt === 'pudelko' || ksztalt === 'klin') Object.assign(p, { sx: size(raw.sx, 40), sy: size(raw.sy, 40), sz: size(raw.sz, 40) });
    else if (ksztalt === 'walec') {
      p.r = size(raw.r, 10);
      p.r2 = raw.r2 == null ? p.r : clamp(raw.r2, 0, LIM, p.r);
      p.h = size(raw.h, 20);
    } else if (ksztalt === 'rura') {
      p.r = size(raw.r, 10);
      p.ri = clamp(raw.ri, 0.005, p.r * 0.995, p.r * 0.7);
      p.h = size(raw.h, 20);
    } else if (ksztalt === 'kula') {
      if (raw.sx || raw.sy || raw.sz) {
        const d = size(raw.r, 10) * 2;
        Object.assign(p, { sx: size(raw.sx, d), sy: size(raw.sy, d), sz: size(raw.sz, d) });
      } else p.r = size(raw.r, 10);
    } else if (ksztalt === 'torus') {
      p.R = size(raw.R, 20);
      p.r = clamp(raw.r, 0.005, p.R * 0.98, Math.min(5, p.R * 0.3));
    } else if (ksztalt === 'pryzmat') {
      p.n = Math.round(clamp(raw.n, 3, 24, 6));
      p.r = size(raw.r, 10);
      p.h = size(raw.h, 20);
    } else if (ksztalt === 'sruba') {
      p.r = size(raw.r, 3);
      p.h = size(raw.h, 20);
    } else if (ksztalt === 'plyta') {
      Object.assign(p, { sx: size(raw.sx, 60), sy: size(raw.sy, 5), sz: size(raw.sz, 40) });
      p.otwory = holes(raw.otwory).filter((h) => Math.abs(h.x) + h.r < p.sx / 2 && Math.abs(h.z) + h.r < p.sz / 2);
    } else if (ksztalt === 'wyciagniecie') {
      p.kontur = points2(raw.kontur);
      if (p.kontur.length < 3) p.kontur = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
      p.h = size(raw.h, 10);
      p.otwory = holes(raw.otwory);
    } else if (ksztalt === 'obrotowa') {
      p.profil = points2(raw.profil).map(([r, y]) => [Math.max(0, r), y]);
      if (p.profil.length < 2) p.profil = [[10, -10], [10, 10]];
    } else if (ksztalt === 'loft') {
      p.przekroje = (Array.isArray(raw.przekroje) ? raw.przekroje : []).slice(0, 40).map((s) => ({
        p: pos(s?.p),
        typ: ['elipsa', 'prostokat', 'zaokraglony'].includes(s?.typ) ? s.typ : 'elipsa',
        a: size(s?.a, 10),
        b: size(s?.b ?? s?.a, 10),
        dx: pos(s?.dx),
        dz: pos(s?.dz),
      }));
      if (p.przekroje.length < 2) p.przekroje = [{ p: -10, typ: 'elipsa', a: 10, b: 10, dx: 0, dz: 0 }, { p: 10, typ: 'elipsa', a: 10, b: 10, dx: 0, dz: 0 }];
    } else if (ksztalt === 'rurka') {
      p.sciezka = points3(raw.sciezka);
      if (p.sciezka.length < 2) p.sciezka = [[0, -10, 0], [0, 10, 0]];
      p.r = size(raw.r, 2);
    } else if (ksztalt === 'sprezyna') {
      p.R = size(raw.R, 10);
      p.r = clamp(raw.r, 0.005, p.R * 0.8, Math.min(1.5, p.R * 0.2));
      p.skok = size(raw.skok, 6);
      p.zwoje = clamp(raw.zwoje, 0.5, 60, 6);
    } else if (ksztalt === 'kolo_zebate') {
      p.zeby = Math.round(clamp(raw.zeby ?? raw.z_zebow, 6, 200, 20));
      p.m = size(raw.m, 2);
      p.h = size(raw.h, 8);
      const rf = (p.m * p.zeby) / 2 - 1.25 * p.m;
      p.otwor = clamp(raw.otwor, 0, Math.max(0, rf * 0.9), Math.max(0, rf * 0.25));
    }
    return p;
  }

  // Powielanie po stronie danych: lustro (lewa/prawa strona) i szyk (liniowy albo kolowy wokol osi Y).
  function expandParts(rawList) {
    const out = [];
    for (const raw of rawList) {
      if (out.length >= MAX_PARTS) break;
      if (!raw || typeof raw !== 'object') continue;
      const base = { ...raw };
      delete base.powiel;
      delete base.lustro;
      const copies = [base];
      const szyk = raw.powiel;
      const n = Math.round(clamp(szyk?.n, 1, 120, 1));
      if (n > 1) {
        for (let i = 1; i < n; i++) {
          const c = { ...base, id: base.id ? `${base.id}_${i + 1}` : '', nazwa: base.nazwa ? `${base.nazwa} ${i + 1}` : base.nazwa };
          if (szyk.kolowy) {
            const t = ((Number(szyk.kat) || 360) / (Number(szyk.kat) ? Math.max(1, n - 1) : n)) * i;
            const rad = (t * Math.PI) / 180;
            const cx = Number(szyk.cx) || 0;
            const cz = Number(szyk.cz) || 0;
            const dx = (Number(base.x) || 0) - cx;
            const dz = (Number(base.z) || 0) - cz;
            c.x = cx + dx * Math.cos(rad) + dz * Math.sin(rad);
            c.z = cz - dx * Math.sin(rad) + dz * Math.cos(rad);
            c.ry = (Number(base.ry) || 0) + t;
          } else {
            c.x = (Number(base.x) || 0) + (Number(szyk.dx) || 0) * i;
            c.y = (Number(base.y) || 0) + (Number(szyk.dy) || 0) * i;
            c.z = (Number(base.z) || 0) + (Number(szyk.dz) || 0) * i;
          }
          copies.push(c);
        }
      }
      for (const c of copies) {
        out.push(c);
        if (['x', 'y', 'z'].includes(raw.lustro)) {
          const a = raw.lustro;
          const m = { ...c, id: c.id ? `${c.id}_L` : '', nazwa: c.nazwa ? `${c.nazwa} (lustro)` : c.nazwa, odb: a };
          // Odbicie S*T*R = (S*T)*(S*R*S)*S: pozycja na druga strone, dwa obroty ze zmienionym znakiem.
          m[a] = -(Number(c[a]) || 0);
          ['x', 'y', 'z'].filter((k) => k !== a).forEach((k) => {
            m[`r${k}`] = -(Number(c[`r${k}`]) || 0);
          });
          out.push(m);
        }
      }
    }
    return out.slice(0, MAX_PARTS);
  }

  function normalizeProject(raw = {}) {
    const parts = expandParts(Array.isArray(raw.czesci) ? raw.czesci : []).map(normalizePart);
    const seen = new Set();
    parts.forEach((p, i) => {
      let id = p.id;
      while (seen.has(id)) id = `${p.id}_${++i}`;
      p.id = id;
      seen.add(id);
    });
    return {
      nazwa: str(raw.nazwa, 100) || 'Projekt',
      opis: str(raw.opis, 800),
      material: str(raw.material, 20) || 'PLA',
      skala: clamp(raw.skala, 1, 100000, 1),
      realny: Boolean(raw.realny),
      uwagi: str(raw.uwagi, 800),
      czesci: parts,
      kroki: (Array.isArray(raw.kroki) ? raw.kroki : []).slice(0, 200).map((k, i) => ({ nr: Math.round(clamp(k?.nr, 1, 200, i + 1)), tytul: str(k?.tytul, 100) || `Krok ${i + 1}`, opis: str(k?.opis, 500) })),
      fakty: (Array.isArray(raw.fakty) ? raw.fakty : []).slice(0, 30).map((f) => str(typeof f === 'string' ? f : f?.fakt, 240)).filter(Boolean),
      zrodla: (Array.isArray(raw.zrodla) ? raw.zrodla : []).slice(0, 20).map((z) => ({ tytul: str(z?.tytul, 140), url: /^https?:\/\//.test(z?.url || '') ? String(z.url).slice(0, 500) : '' })).filter((z) => z.url),
      plany: (Array.isArray(raw.plany) ? raw.plany : []).slice(0, 12).map((z) => ({ tytul: str(z?.tytul, 140), url: /^https:\/\//.test(z?.url || '') ? String(z.url).slice(0, 500) : '', strona: /^https:\/\//.test(z?.strona || '') ? String(z.strona).slice(0, 500) : '', licencja: str(z?.licencja, 60) })).filter((z) => z.url),
    };
  }

  // ---------- siatka czesci ----------
  /** Plaska lista wierzcholkow trojkatow (9 liczb na trojkat) w ukladzie czesci, sciany na zewnatrz. */
  function partMesh(p) {
    let m;
    switch (p.ksztalt) {
      case 'walec': {
        const seg = p.seg || 40;
        m = revolve([[p.r, -p.h / 2], [p.r2, p.h / 2]], seg);
        break;
      }
      case 'rura':
        m = revolve([[p.ri, -p.h / 2], [p.r, -p.h / 2], [p.r, p.h / 2], [p.ri, p.h / 2]], 40, true);
        break;
      case 'kula': {
        const rows = 18;
        const prof = Array.from({ length: rows + 1 }, (_, i) => {
          const t = -Math.PI / 2 + (i / rows) * Math.PI;
          return [Math.cos(t), Math.sin(t)];
        });
        m = revolve(prof, 32);
        const kx = p.sx ? p.sx / 2 : p.r;
        const ky = p.sy ? p.sy / 2 : p.r;
        const kz = p.sz ? p.sz / 2 : p.r;
        for (let i = 0; i < m.length; i += 3) {
          m[i] *= kx;
          m[i + 1] *= ky;
          m[i + 2] *= kz;
        }
        break;
      }
      case 'torus': {
        const prof = Array.from({ length: 16 }, (_, i) => {
          const t = (i / 16) * Math.PI * 2;
          return [p.R + p.r * Math.cos(t), p.r * Math.sin(t)];
        });
        m = revolve(prof, 40, true);
        break;
      }
      case 'klin':
        m = wedge(p.sx, p.sy, p.sz);
        break;
      case 'pryzmat':
        m = revolve([[p.r, -p.h / 2], [p.r, p.h / 2]], p.n);
        break;
      case 'sruba': {
        const headH = p.r * 1.3;
        const head = revolve([[p.r * 1.8, 0], [p.r * 1.8, headH]], 6);
        for (let i = 1; i < head.length; i += 3) head[i] += p.h / 2;
        m = [...head, ...revolve([[p.r, -p.h / 2], [p.r, p.h / 2]], 20)];
        break;
      }
      case 'plyta': {
        const x = p.sx / 2;
        const z = p.sz / 2;
        m = extrude([[-x, -z], [x, -z], [x, z], [-x, z]], p.otwory.map((h) => circle(h.x, h.z, h.r, 24)), p.sy);
        break;
      }
      case 'wyciagniecie':
        m = extrude(p.kontur, p.otwory.map((h) => circle(h.x, h.z, h.r, 24)), p.h);
        break;
      case 'obrotowa':
        m = revolve(p.gladki ? catmull(p.profil.map(([r, y]) => [r, y, 0]), 4).map((v) => [Math.max(0, v[0]), v[1]]) : p.profil, 48);
        break;
      case 'loft':
        m = loft(p.przekroje, 32, p.gladki);
        break;
      case 'rurka':
        m = sweep(p.sciezka.length > 2 ? catmull(p.sciezka, 6) : p.sciezka, p.r, 12);
        break;
      case 'sprezyna': {
        const steps = Math.ceil(p.zwoje * 24);
        const total = p.zwoje * p.skok;
        const path = Array.from({ length: steps + 1 }, (_, i) => {
          const t = (i / 24) * Math.PI * 2;
          return [p.R * Math.cos(t), (i / steps) * total - total / 2, p.R * Math.sin(t)];
        });
        m = sweep(path, p.r, 10);
        break;
      }
      case 'kolo_zebate':
        m = extrude(gearOutline(p.zeby, p.m), p.otwor > 0 ? [circle(0, 0, p.otwor, 32)] : [], p.h);
        break;
      default:
        m = box(p.sx, p.sy, p.sz);
    }
    if (p.odb) {
      const k = { x: 0, y: 1, z: 2 }[p.odb];
      for (let i = k; i < m.length; i += 3) m[i] = -m[i];
    }
    return signedVolume(m) < 0 ? flip(m) : m;
  }

  /** Uklad czesci -> uklad projektu: macierz Rx*Ry*Rz i przesuniecie. */
  function transform(p, m) {
    const d = Math.PI / 180;
    const [cx, sx] = [Math.cos(p.rx * d), Math.sin(p.rx * d)];
    const [cy, sy] = [Math.cos(p.ry * d), Math.sin(p.ry * d)];
    const [cz, sz] = [Math.cos(p.rz * d), Math.sin(p.rz * d)];
    const r = [
      cy * cz, -cy * sz, sy,
      sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy,
      -cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy,
    ];
    const out = new Array(m.length);
    for (let i = 0; i < m.length; i += 3) {
      const a = m[i];
      const b = m[i + 1];
      const c = m[i + 2];
      out[i] = r[0] * a + r[1] * b + r[2] * c + p.x;
      out[i + 1] = r[3] * a + r[4] * b + r[5] * c + p.y;
      out[i + 2] = r[6] * a + r[7] * b + r[8] * c + p.z;
    }
    return out;
  }
  const worldMesh = (p) => transform(p, partMesh(p));

  function boundsOf(m) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (m[i + k] < lo[k]) lo[k] = m[i + k];
        if (m[i + k] > hi[k]) hi[k] = m[i + k];
      }
    }
    return { lo, hi };
  }
  const centerOf = (b) => [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];

  /** Bryly projektu: obrys kazdej czesci i calosci, objetosc, trojkaty. */
  function measure(project) {
    const items = {};
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    let triangles = 0;
    let volume = 0;
    for (const p of project.czesci) {
      const m = worldMesh(p);
      const b = boundsOf(m);
      items[p.id] = b;
      triangles += m.length / 9;
      if (p.ciecie) continue;
      volume += Math.abs(signedVolume(m));
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], b.lo[k]);
        hi[k] = Math.max(hi[k], b.hi[k]);
      }
    }
    const ok = Number.isFinite(lo[0]);
    const bounds = ok ? { lo, hi } : { lo: [0, 0, 0], hi: [1, 1, 1] };
    return { items, bounds, size: [0, 1, 2].map((k) => bounds.hi[k] - bounds.lo[k]), span: Math.max(1, ...[0, 1, 2].map((k) => bounds.hi[k] - bounds.lo[k])), triangles, volumeMm3: volume };
  }

  // ---------- rozstrzelenie i animacja montazu ----------
  /** Wektor wyjecia kazdej czesci przy pelnym rozstrzeleniu: najpierw odjezdza podzespol, potem czesci w nim. */
  function explodeVectors(project, m = measure(project)) {
    const center = centerOf(m.bounds);
    const groups = new Map();
    for (const p of project.czesci) {
      const c = centerOf(m.items[p.id]);
      const g = groups.get(p.grupa) || { sum: [0, 0, 0], n: 0 };
      g.sum = g.sum.map((v, k) => v + c[k]);
      g.n++;
      groups.set(p.grupa, g);
    }
    const out = {};
    let i = 0;
    for (const p of project.czesci) {
      i++;
      if (p.rozst) {
        out[p.id] = p.rozst.slice();
        continue;
      }
      const c = centerOf(m.items[p.id]);
      const g = groups.get(p.grupa);
      const gc = g.sum.map((v) => v / g.n);
      const v = [0, 1, 2].map((k) => (gc[k] - center[k]) * 0.9 + (c[k] - gc[k]) * 1.25);
      if (Math.hypot(v[0], v[1], v[2]) < m.span * 0.04) {
        // Czesc w samym srodku (np. srodek stosu): wyjmujemy ja na bok, po kolei w roznych strony.
        const t = (i * 2.4) % (Math.PI * 2);
        v[0] += Math.cos(t) * m.span * 0.35;
        v[2] += Math.sin(t) * m.span * 0.35;
      }
      out[p.id] = v;
    }
    return out;
  }

  /** Numery krokow montazu w kolejnosci rosnacej. */
  function stepNumbers(project) {
    return [...new Set(project.czesci.filter((p) => !p.ciecie).map((p) => p.krok))].sort((a, b) => a - b);
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  /**
   * Stan animacji rozbierania. tau 0 = model zlozony, 1 = wszystko wyjete. Rozbieramy od ostatniego
   * kroku montazu; zwraca {id: 0..1} oraz biezacy krok. Skladanie to ta sama os przebyta wstecz.
   */
  function timeline(project, tau) {
    const steps = stepNumbers(project);
    const n = Math.max(1, steps.length);
    const t = Math.max(0, Math.min(1, tau)) * n;
    const progress = {};
    for (const p of project.czesci) {
      const order = n - 1 - steps.indexOf(p.krok); // ostatni krok montazu rozbieramy pierwszy
      progress[p.id] = ease(Math.max(0, Math.min(1, t - order)));
    }
    const idx = Math.min(n - 1, Math.floor(t));
    return { progress, stepIndex: idx, step: steps[n - 1 - idx] ?? 1, steps };
  }

  // ---------- kontrola projektu ----------
  /** Uwagi: czesci, ktore wisza w powietrzu, zerowa liczba krokow, pomylone rozmiary. */
  function check(project, m = measure(project)) {
    const warnings = [];
    const real = project.czesci.filter((p) => !p.ciecie);
    const touches = (a, b, gap) => [0, 1, 2].every((k) => a.lo[k] - gap <= b.hi[k] && b.lo[k] - gap <= a.hi[k]);
    if (real.length > 1) {
      const gap = m.span * 0.01;
      // Spojne skladowe po stykajacych sie obrysach: jedna duza bryla i to, co od niej oderwane.
      const left = new Set(real.map((p) => p.id));
      const groups = [];
      while (left.size) {
        const start = left.values().next().value;
        left.delete(start);
        const comp = [start];
        for (let i = 0; i < comp.length; i++) {
          for (const id of [...left]) {
            if (touches(m.items[comp[i]], m.items[id], gap)) {
              left.delete(id);
              comp.push(id);
            }
          }
        }
        groups.push(comp);
      }
      groups.sort((a, b) => b.length - a.length);
      const loose = groups.slice(1).flat();
      if (loose.length) warnings.push(`Oderwane od reszty: ${loose.slice(0, 6).map((id) => real.find((p) => p.id === id).nazwa).join(', ')}${loose.length > 6 ? ` i ${loose.length - 6} innych` : ''}.`);
    }
    if (!project.kroki.length) warnings.push('Brak opisanych kroków montażu.');
    if (project.realny && project.czesci.length && project.czesci.every((p) => p.zrodlo !== 'plany')) warnings.push('Żaden wymiar nie pochodzi z planów: cały model jest szacunkiem.');
    return warnings;
  }

  /** Masa z objetosci po skalowaniu. Gestosci jak w module CAD; wypelnienie druku to osobna sprawa. */
  function massG(project, m = measure(project), density = 1.24) {
    return (m.volumeMm3 / project.skala ** 3 / 1000) * density;
  }

  // ---------- edycja ----------
  /** Zmiany od Jarvisa albo z panelu: {dodaj:[], usun:[ids], zmien:[{id, ...pola}], kroki:[]}. */
  function applyOps(project, ops = {}) {
    const usun = new Set(Array.isArray(ops.usun) ? ops.usun : []);
    let parts = project.czesci.filter((p) => !usun.has(p.id));
    const edits = Array.isArray(ops.zmien) ? ops.zmien : [];
    parts = parts.map((p, i) => {
      const e = edits.find((x) => x && x.id === p.id);
      return e ? normalizePart({ ...p, ...e, id: p.id }, i) : p;
    });
    const added = normalizeProject({ czesci: Array.isArray(ops.dodaj) ? ops.dodaj : [] }).czesci;
    const taken = new Set(parts.map((p) => p.id));
    added.forEach((p) => {
      let id = p.id;
      let k = 1;
      while (taken.has(id)) id = `${p.id}_n${++k}`;
      taken.add(id);
      // Bez podanego kroku element montujemy na koncu.
      parts.push({ ...p, id, krok: p.krok > 1 || !parts.length ? p.krok : Math.max(0, ...parts.map((x) => x.krok)) + 1 });
    });
    const next = { ...project, czesci: parts.slice(0, MAX_PARTS) };
    if (Array.isArray(ops.kroki) && ops.kroki.length) next.kroki = normalizeProject({ kroki: ops.kroki }).kroki;
    return next;
  }

  // ---------- eksport ----------
  /** STL binarny z list wierzcholkow w mm (dzielimy przez skale repliki). */
  function stlBinary(meshes, scale = 1, title = 'jarvis-studio') {
    const count = meshes.reduce((n, m) => n + m.length / 9, 0);
    const buf = new ArrayBuffer(84 + count * 50);
    const v = new DataView(buf);
    for (let i = 0; i < Math.min(79, title.length); i++) v.setUint8(i, title.charCodeAt(i) & 0x7f);
    v.setUint32(80, count, true);
    let o = 84;
    const k = 1 / scale;
    for (const m of meshes) {
      for (let i = 0; i + 8 < m.length; i += 9) {
        const u = [m[i + 3] - m[i], m[i + 4] - m[i + 1], m[i + 5] - m[i + 2]];
        const w = [m[i + 6] - m[i], m[i + 7] - m[i + 1], m[i + 8] - m[i + 2]];
        const n = norm3(cross3(u, w));
        // STL ma os Z w gore: (x, y, z) -> (x, -z, y), ten sam kierunek scian.
        [n[0], -n[2], n[1]].forEach((x, j) => v.setFloat32(o + j * 4, x, true));
        o += 12;
        for (let j = 0; j < 3; j++) {
          v.setFloat32(o, m[i + j * 3] * k, true);
          v.setFloat32(o + 4, -m[i + j * 3 + 2] * k, true);
          v.setFloat32(o + 8, m[i + j * 3 + 1] * k, true);
          o += 12;
        }
        o += 2;
      }
    }
    return buf;
  }

  /** Lista czesci do arkusza (CSV, srednik: polski Excel). */
  function bomCsv(project) {
    const m = measure(project);
    const rows = [['Podzespół', 'Część', 'Krok', 'Kształt', 'Wymiary mm (dł x wys x gł)', 'Pochodzenie wymiarów']];
    const fmt = (v) => String(Math.round((v / project.skala) * 10) / 10).replace('.', ',');
    for (const p of project.czesci) {
      const b = m.items[p.id];
      rows.push([p.grupa, p.nazwa, p.krok, p.ksztalt, [0, 1, 2].map((k) => fmt(b.hi[k] - b.lo[k])).join(' x '), p.zrodlo === 'plany' ? 'plany' : 'szacunek']);
    }
    return `﻿${rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')}`;
  }

  return { SHAPES, MAX_PARTS, normalizePart, normalizeProject, expandParts, partMesh, worldMesh, transform, measure, boundsOf, centerOf, explodeVectors, stepNumbers, timeline, check, massG, applyOps, stlBinary, bomCsv, signedVolume };
});
