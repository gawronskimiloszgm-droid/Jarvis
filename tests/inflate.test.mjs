import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewProject } from '../server/extras/studio.js';

function load(file) {
  const m = { exports: {} };
  new Function('module', fs.readFileSync(new URL(`../public/extras/${file}.js`, import.meta.url), 'utf8'))(m);
  return m.exports;
}
const K = load('cadkit');
const PT = load('phototrace');

const ring = (r, n = 64, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)]);
const bar = (l, w) => [[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]];

/** Kazda krawedz w dwoch trojkatach, w przeciwnych kierunkach: bryla szczelna i dobrze skierowana. */
function assertClosed(mesh) {
  const edges = new Map();
  const key = (i) => `${mesh[i].toFixed(5)},${mesh[i + 1].toFixed(5)},${mesh[i + 2].toFixed(5)}`;
  for (let t = 0; t < mesh.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    if (new Set(v).size < 3) continue;
    for (let k = 0; k < 3; k++) {
      const e = `${v[k]}|${v[(k + 1) % 3]}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let open = 0;
  for (const [e, n] of edges) {
    const [a, b] = e.split('|');
    if ((edges.get(`${b}|${a}`) || 0) !== n) open++;
  }
  assert.equal(open, 0, 'siatka ma szczeliny');
}
const part = (over) => K.normalizePart({ ksztalt: 'boczny', oble: true, gr: 200, ...over });
const maxZ = (m) => {
  let z = 0;
  for (let i = 2; i < m.length; i += 3) z = Math.max(z, m[i]);
  return z;
};

test('obla bryla jest szczelna i ma objetosc na zewnatrz', () => {
  const m = K.partMesh(part({ kontur: ring(100) }));
  assertClosed(m);
  assert.ok(K.signedVolume(m) > 0);
});

test('obla bryla z otworem tez jest szczelna', () => {
  const m = K.partMesh(part({ kontur: ring(100), otwory: [{ kontur: ring(30) }] }));
  assertClosed(m);
  assert.ok(K.signedVolume(m) > 0);
});

test('kontur zostaje co do punktu', () => {
  const kontur = [[-100, -40], [100, -40], [120, 30], [20, 60], [-90, 30]];
  const m = K.partMesh(part({ kontur }));
  const seen = (x, y) => {
    for (let i = 0; i < m.length; i += 3) if (Math.abs(m[i] - x) < 1e-6 && Math.abs(m[i + 1] - y) < 1e-6) return true;
    return false;
  };
  kontur.forEach(([x, y]) => assert.ok(seen(x, y), `brak punktu ${x},${y}`));
});

test('rura wychodzi okragla, a nie jak deska', () => {
  // Pret 1000 x 40 przy grubosci 300: glebokosc ma byc zblizona do jego wysokosci.
  const z = maxZ(K.partMesh(part({ kontur: bar(1000, 40), gr: 300 })));
  assert.ok(z > 14 && z < 30, `polowa grubosci ${z}`);
});

test('duza plyta dochodzi prawie do podanej grubosci, ale jej nie przekracza', () => {
  const z = maxZ(K.partMesh(part({ kontur: bar(1000, 800), gr: 100 })));
  assert.ok(z > 45 && z <= 50.001, `polowa grubosci ${z}`);
});

test('srodek jest wyzej niz brzeg: to nie jest plaska sciana', () => {
  const m = K.partMesh(part({ kontur: ring(100), gr: 120 }));
  let edge = 0;
  let mid = 0;
  for (let i = 0; i < m.length; i += 3) {
    const r = Math.hypot(m[i], m[i + 1]);
    if (r > 95) edge = Math.max(edge, m[i + 2]);
    if (r < 10) mid = Math.max(mid, m[i + 2]);
  }
  assert.ok(mid > edge * 1.5, `srodek ${mid}, brzeg ${edge}`);
});

test('szer zmienia grubosc wzdluz przedmiotu', () => {
  const m = K.partMesh(part({ kontur: bar(1000, 400), gr: 100, szer: [[0, 40], [1, 300]] }));
  let left = 0;
  let right = 0;
  for (let i = 0; i < m.length; i += 3) {
    if (m[i] < -300) left = Math.max(left, m[i + 2]);
    if (m[i] > 300) right = Math.max(right, m[i + 2]);
  }
  assert.ok(right > left * 1.8, `lewa ${left}, prawa ${right}`);
});

test('liczba trojkatow ma gorna granice', () => {
  const zebra = [];
  for (let i = 0; i < 300; i++) zebra.push([i * 10, i % 2 ? 30 : 0]);
  zebra.push([3000, 600], [0, 600]);
  const m = K.partMesh(part({ kontur: zebra }));
  assert.ok(m.length / 9 < 200000, `trojkatow ${m.length / 9}`);
  assertClosed(m);
});

test('ustawienie oble przechodzi przez normalizacje i bledna szer jest odrzucana', () => {
  assert.equal(K.normalizePart({ ksztalt: 'boczny', oble: true, kontur: bar(10, 10) }).oble, true);
  assert.equal(K.normalizePart({ ksztalt: 'boczny', kontur: bar(10, 10), szer: [[0, -1], ['x', 2]] }).szer, undefined);
});

// ---------- dopasowanie wnetrza ----------
const shell = [{ ksztalt: 'boczny', id: 'o', kontur: bar(400, 200), gr: 60, x: 0, y: 0, z: 0, skora: true }];

test('zespol wystajacy poza obudowe wraca do srodka', () => {
  const inner = [{ id: 'a', grupa: 'Silnik', ksztalt: 'pudelko', sx: 100, sy: 50, sz: 20, x: 240, y: 0, z: 0 }];
  const fit = K.fitInside(inner, shell);
  assert.deepEqual(fit.przesuniete, ['Silnik']);
  assert.equal(fit.wystaje.length, 0);
  const b = K.boundsOf(K.worldMesh(K.normalizePart(fit.czesci[0])));
  assert.ok(b.hi[0] <= 215, `prawy koniec ${b.hi[0]}`);
});

test('zespol juz w srodku zostaje na miejscu', () => {
  const inner = [{ id: 'a', grupa: 'Silnik', ksztalt: 'pudelko', sx: 100, sy: 50, sz: 20, x: 20, y: 10, z: 5 }];
  const fit = K.fitInside(inner, shell);
  assert.equal(fit.przesuniete.length, 0);
  assert.equal(fit.czesci[0], inner[0]);
});

test('czesci zespolu przesuwaja sie razem', () => {
  const inner = [
    { id: 'a', grupa: 'Silnik', ksztalt: 'pudelko', sx: 60, sy: 40, sz: 20, x: 230, y: 0 },
    { id: 'b', grupa: 'Silnik', ksztalt: 'pudelko', sx: 60, sy: 40, sz: 20, x: 170, y: 0 },
  ];
  const fit = K.fitInside(inner, shell);
  assert.equal(fit.czesci[0].x - fit.czesci[1].x, 60);
});

test('zespol zbyt duzy na obudowe jest zglaszany', () => {
  const inner = [{ id: 'a', grupa: 'Rama', ksztalt: 'pudelko', sx: 900, sy: 500, sz: 20 }];
  assert.deepEqual(K.fitInside(inner, shell).wystaje, ['Rama']);
});

test('zespol za gruby na obudowe jest zglaszany', () => {
  const inner = [{ id: 'a', grupa: 'Blok', ksztalt: 'pudelko', sx: 50, sy: 50, sz: 200 }];
  assert.deepEqual(K.fitInside(inner, shell).wystaje, ['Blok']);
});

// ---------- obraz ----------
function canvas(w, h) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const paint = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
      }
    }
  };
  return { img: { data, width: w, height: h }, paint };
}
const opts = { dlugosc: 100, parts: [{ id: 'a', nazwa: 'A', reszta: true, obszar: [0, 0, 300, 200] }], minHole: 20, czysc: true };

test('odblask nie robi dziury, a prawdziwy przeswit zostaje', () => {
  const { img, paint } = canvas(300, 200);
  paint(30, 30, 270, 170, [20, 40, 120]);
  // Prawdziwy przeswit: biel od razu przy ciemnym lakierze.
  paint(60, 60, 90, 90, [255, 255, 255]);
  // Odblask: biel otoczona szeroka, jasna otoczka.
  paint(170, 70, 230, 130, [235, 235, 235]);
  paint(180, 80, 220, 120, [255, 255, 255]);
  const t = PT.traceParts(img, opts);
  assert.equal(t.parts[0].otwory.length, 1);
  const xs = t.parts[0].otwory[0].map((p) => p[0]);
  assert.ok(Math.max(...xs) < 0, 'zostac ma otwor po lewej');
});

test('okna miedzy cienkimi szprychami zostaja otworami', () => {
  const { img, paint } = canvas(300, 200);
  paint(30, 30, 270, 170, [30, 30, 30]);
  for (let x = 40; x < 260; x += 24) paint(x, 40, x + 21, 160, [255, 255, 255]);
  const t = PT.traceParts(img, opts);
  assert.equal(t.parts[0].otwory.length, 9);
});

test('jasny cien pod przedmiotem nie wchodzi do obrysu', () => {
  const { img, paint } = canvas(300, 200);
  paint(40, 40, 260, 140, [150, 30, 30]);
  paint(30, 140, 270, 165, [205, 205, 205]);
  const t = PT.traceParts(img, opts);
  assert.equal(t.bbox[3], 140);
  assert.equal(t.parts[0].kolorZdjecia, '#961e1e');
});

test('pasek cienia na wysokosci opon znika, a srebrna felga za opona zostaje', () => {
  const { img, paint } = canvas(400, 200);
  // Dwa ciemne kola ze srebrnym srodkiem, korpus i jasny pasek cienia miedzy nimi przy samej ziemi.
  paint(40, 80, 140, 180, [20, 20, 20]);
  paint(75, 115, 105, 145, [190, 190, 190]);
  paint(260, 80, 360, 180, [20, 20, 20]);
  paint(295, 115, 325, 145, [190, 190, 190]);
  paint(40, 40, 360, 100, [120, 20, 20]);
  paint(140, 170, 260, 180, [225, 225, 225]);
  const t = PT.traceParts(img, { ...opts, parts: [{ id: 'a', nazwa: 'A', reszta: true, obszar: [0, 0, 400, 200] }] });
  const ys = t.parts[0].kontur.filter((p) => Math.abs(p[0]) < 18).map((p) => p[1]);
  const body = t.parts[0].kontur.map((p) => p[1]);
  assert.ok(ys.length === 0 || Math.min(...ys) > Math.min(...body) + 1, `pasek zostal w obrysie: ${JSON.stringify(t.parts[0].kontur)}`);
  assert.equal(t.parts[0].otwory.length, 0, 'felga nie moze zniknac');
  assert.equal(t.bbox[3], 180);
});

test('cienka ciemna linia styku z ziemia znika, a opony zostaja', () => {
  const { img, paint } = canvas(400, 200);
  paint(40, 80, 140, 180, [20, 20, 20]);
  paint(260, 80, 360, 180, [20, 20, 20]);
  paint(40, 40, 360, 100, [120, 20, 20]);
  paint(140, 178, 260, 180, [70, 70, 70]);
  const t = PT.traceParts(img, { ...opts, parts: [{ id: 'a', nazwa: 'A', reszta: true, obszar: [0, 0, 400, 200] }] });
  const ys = t.parts[0].kontur.filter((p) => Math.abs(p[0]) < 18).map((p) => p[1]);
  assert.ok(ys.every((y) => y > 0), `linia zostala: ${JSON.stringify(t.parts[0].kontur)}`);
  assert.equal(t.bbox[3], 180);
});

test('szara podstawa stykajaca sie z przedmiotem zostaje w obrysie', () => {
  const { img, paint } = canvas(400, 200);
  paint(100, 40, 300, 170, [150, 30, 30]);
  paint(40, 170, 360, 180, [70, 70, 70]);
  const t = PT.traceParts(img, { ...opts, parts: [{ id: 'a', nazwa: 'A', reszta: true, obszar: [0, 0, 400, 200] }] });
  assert.equal(t.bbox[3], 180);
  assert.equal(t.bbox[0], 40);
});

test('dopasowanie omija przeswity w obudowie', () => {
  const hollow = [{ ksztalt: 'boczny', id: 'o', kontur: bar(400, 200), gr: 60, otwory: [{ kontur: [[-40, -80], [180, -80], [180, 80], [-40, 80]] }] }];
  const fit = K.fitInside([{ id: 'a', grupa: 'Silnik', ksztalt: 'pudelko', sx: 40, sy: 40, sz: 20, x: 60 }], hollow);
  assert.deepEqual(fit.przesuniete, ['Silnik']);
  const b = K.boundsOf(K.worldMesh(K.normalizePart(fit.czesci[0])));
  assert.ok(b.hi[0] <= -30, `prawy koniec ${b.hi[0]}`);
});

test('na czarnym tle cien nie zjada opon', () => {
  const w = 300;
  const h = 200;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let y = 60; y < 150; y++) {
    for (let x = 40; x < 260; x++) {
      const i = (y * w + x) * 4;
      data[i] = 90;
      data[i + 1] = 90;
      data[i + 2] = 90;
    }
  }
  const t = PT.traceParts({ data, width: w, height: h }, opts);
  assert.equal(t.bbox[3], 150);
});

test('oderwany fragment dostaje wlasna czesc i nic nie ginie', () => {
  const { img, paint } = canvas(300, 200);
  paint(20, 60, 120, 140, [20, 20, 20]);
  paint(120, 95, 180, 105, [20, 20, 20]);
  paint(180, 60, 280, 140, [20, 20, 20]);
  const t = PT.traceParts(img, {
    dlugosc: 100,
    minHole: 20,
    czysc: true,
    parts: [
      { id: 'srodek', nazwa: 'Srodek', obszar: [125, 0, 175, 200] },
      { id: 'r', nazwa: 'Korpus', reszta: true, obszar: [0, 0, 300, 200] },
    ],
  });
  assert.equal(t.parts.length, 3);
  assert.ok(t.pokrycie > 0.999, `pokrycie ${t.pokrycie}`);
});

test('bez opcji czysc odrys dziala jak wczesniej', () => {
  const { img, paint } = canvas(300, 200);
  paint(30, 30, 270, 170, [20, 40, 120]);
  paint(170, 70, 230, 130, [235, 235, 235]);
  paint(180, 80, 220, 120, [255, 255, 255]);
  const t = PT.traceParts(img, { dlugosc: 100, minHole: 20, parts: [{ id: 'a', nazwa: 'A', obszar: [0, 0, 300, 200] }] });
  assert.equal(t.parts[0].otwory.length, 1);
  assert.equal(t.parts[0].kolorZdjecia, undefined);
});

// ---------- przeglad ----------
const IMG = 'data:image/jpeg;base64,AAAA';
const reviewed = { nazwa: 'T', czesci: [{ id: 'w', grupa: 'Silnik', ksztalt: 'pudelko', sx: 10, sy: 10, sz: 10 }, { id: 'o', grupa: 'Korpus', ksztalt: 'boczny', kontur: bar(50, 50), gr: 20, skora: true }] };

test('przeglad nie rusza obudowy ze zdjecia i niczego nie usuwa', async () => {
  const out = await reviewProject(reviewed, [IMG], {
    generate: async () => ({ co_zmieniono: 'x', usun: ['w', 'o'], zmien: [{ id: 'o', gr: 1 }, { id: 'w', sx: 20 }], dodaj: [{ id: 'n', ksztalt: 'walec', r: 1, h: 2 }] }),
  });
  assert.deepEqual(out.usun, []);
  assert.deepEqual(out.zmien.map((e) => e.id), ['w']);
  assert.equal(out.dodaj[0].zrodlo, 'szacunek');
});

test('przeglad przekazuje obrazy, a bez obrazow odmawia', async () => {
  let seen;
  await reviewProject(reviewed, [IMG, 'nie-obraz'], {
    generate: async (_p, _s, parts) => {
      seen = parts;
      return {};
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].inlineData.mimeType, 'image/jpeg');
  await assert.rejects(reviewProject(reviewed, ['x'], { generate: async () => ({}) }), /Brak obrazów/);
});
