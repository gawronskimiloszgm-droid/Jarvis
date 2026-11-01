import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function load(file) {
  const m = { exports: {} };
  new Function('module', fs.readFileSync(new URL(`../public/extras/${file}.js`, import.meta.url), 'utf8'))(m);
  return m.exports;
}
const K = load('cadkit');
const T = load('studiotpl');

// Kazda krawedz zamknietej bryly wystepuje dwa razy, w przeciwnych kierunkach.
function openEdges(m) {
  const key = (i) => `${m[i].toFixed(3)},${m[i + 1].toFixed(3)},${m[i + 2].toFixed(3)}`;
  const edges = new Map();
  for (let i = 0; i + 8 < m.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(id, (edges.get(id) || 0) + (a < b ? 1 : -1));
    }
  }
  return [...edges.values()].filter((v) => v !== 0).length;
}

const SAMPLES = {
  pudelko: { sx: 30, sy: 10, sz: 20 },
  walec: { r: 10, r2: 4, h: 30 },
  rura: { r: 10, ri: 8, h: 30 },
  kula: { r: 12 },
  torus: { R: 20, r: 3 },
  klin: { sx: 10, sy: 20, sz: 30 },
  pryzmat: { n: 6, r: 10, h: 5 },
  sruba: { r: 3, h: 20 },
  plyta: { sx: 80, sy: 4, sz: 60, otwory: [{ x: -20, z: 0, r: 5 }, { x: 20, z: 10, r: 8 }] },
  wyciagniecie: { kontur: [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]], h: 6, otwory: [{ x: 5, z: 5, r: 2 }] },
  obrotowa: { profil: [[0, -20], [15, -18], [10, 5], [18, 20], [0, 22]] },
  loft: { przekroje: [{ p: -20, a: 10, b: 5 }, { p: 0, typ: 'prostokat', a: 12, b: 8, dx: 2 }, { p: 20, typ: 'zaokraglony', a: 4, b: 3 }] },
  rurka: { r: 2, sciezka: [[0, 0, 0], [20, 0, 0], [20, 20, 5], [0, 30, 10]] },
  sprezyna: { R: 10, r: 1.5, skok: 6, zwoje: 5 },
  kolo_zebate: { zeby: 18, m: 2, h: 8, otwor: 5, faza: 0.4 },
  boczny: { kontur: [[0, 0], [60, 0], [60, 20], [30, 35], [0, 30]], gr: 6, zaokr: 3, faza: 0.5, otwory: [{ x: 15, y: 15, r: 4 }, { x: 40, y: 12, r: 3, dl: 18 }, { x: 22, y: 25, r: 2, n: 6 }] },
  gwint: { r: 3, h: 12, skok: 0.7 },
  zespol: { elementy: [{ ksztalt: 'walec', r: 3, h: 20 }, { ksztalt: 'kolo_zebate', zeby: 20, m: 1, h: 4, y: 5 }, { ksztalt: 'pudelko', sx: 8, sy: 2, sz: 8, faza: 0.4, y: -9 }] },
};

test('kazdy ksztalt to zamknieta bryla ze scianami na zewnatrz', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(K.SHAPES).sort());
  for (const [ksztalt, wym] of Object.entries(SAMPLES)) {
    const p = K.normalizePart({ ksztalt, ...wym });
    const m = K.partMesh(p);
    assert.ok(m.length > 0, ksztalt);
    assert.equal(m.length % 9, 0, ksztalt);
    assert.ok(K.signedVolume(m) > 0, `${ksztalt}: objetosc`);
    assert.equal(openEdges(m), 0, `${ksztalt}: otwarte krawedzie`);
  }
});

test('plyta z otworami ma objetosc pomniejszona o otwory', () => {
  const full = K.signedVolume(K.partMesh(K.normalizePart({ ksztalt: 'plyta', sx: 100, sy: 10, sz: 100 })));
  const holed = K.signedVolume(K.partMesh(K.normalizePart({ ksztalt: 'plyta', sx: 100, sy: 10, sz: 100, otwory: [{ x: 0, z: 0, r: 20 }] })));
  assert.ok(Math.abs(full - 100000) < 1);
  assert.ok(Math.abs(full - holed - Math.PI * 400 * 10) < 200);
});

test('otwor poza plyta jest odrzucany, wymiary sa przycinane', () => {
  const p = K.normalizePart({ ksztalt: 'plyta', sx: 20, sy: 2, sz: 20, otwory: [{ x: 50, z: 0, r: 2 }] });
  assert.equal(p.otwory.length, 0);
  assert.equal(K.normalizePart({ ksztalt: 'nieznany' }).ksztalt, 'pudelko');
  assert.equal(K.normalizePart({ ksztalt: 'walec', r: -5 }).r, 0.01);
  assert.equal(K.normalizePart({ kolor: 'javascript:alert(1)' }).kolor, '#8fa6b8');
});

test('lustro daje odbicie w tym samym miejscu po drugiej stronie, tez po obrocie', () => {
  const pr = K.normalizeProject({ czesci: [{ id: 'a', ksztalt: 'klin', sx: 10, sy: 20, sz: 30, x: 40, y: 5, z: 3, ry: 30, rz: 15, lustro: 'x' }] });
  assert.equal(pr.czesci.length, 2);
  const a = K.boundsOf(K.worldMesh(pr.czesci[0]));
  const b = K.boundsOf(K.worldMesh(pr.czesci[1]));
  for (const k of [1, 2]) {
    assert.ok(Math.abs(a.lo[k] - b.lo[k]) < 1e-6);
    assert.ok(Math.abs(a.hi[k] - b.hi[k]) < 1e-6);
  }
  assert.ok(Math.abs(a.lo[0] + b.hi[0]) < 1e-6);
  assert.ok(K.signedVolume(K.partMesh(pr.czesci[1])) > 0);
});

test('szyk kolowy rozklada czesci rownomiernie', () => {
  const pr = K.normalizeProject({ czesci: [{ id: 'k', ksztalt: 'walec', r: 2, h: 2, x: 100, powiel: { n: 4, kolowy: true } }] });
  assert.equal(pr.czesci.length, 4);
  const xz = pr.czesci.map((p) => [Math.round(p.x), Math.round(p.z)]);
  assert.deepEqual(xz.map((v) => v.map(Math.abs)).sort(), [[0, 100], [0, 100], [100, 0], [100, 0]]);
  assert.equal(new Set(pr.czesci.map((p) => p.id)).size, 4);
});

test('animacja rozbiera od ostatniego kroku i konczy na pelnym wyjeciu', () => {
  const pr = K.normalizeProject({ czesci: [{ id: 'a', krok: 1 }, { id: 'b', krok: 2 }, { id: 'c', krok: 3 }] });
  const at0 = K.timeline(pr, 0);
  assert.deepEqual(Object.values(at0.progress), [0, 0, 0]);
  const mid = K.timeline(pr, 0.34);
  assert.equal(mid.progress.c, 1);
  assert.ok(mid.progress.b > 0 && mid.progress.b < 1);
  assert.equal(mid.progress.a, 0);
  assert.equal(mid.step, 2);
  assert.deepEqual(Object.values(K.timeline(pr, 1).progress), [1, 1, 1]);
});

test('rozstrzelenie rozsuwa wszystkie czesci, kierunek reczny ma pierwszenstwo', () => {
  const pr = K.normalizeProject({ czesci: [{ id: 'a', y: 0 }, { id: 'b', y: 0 }, { id: 'c', x: 100, grupa: 'Inna' }, { id: 'd', rozst: [1, 2, 3] }] });
  const v = K.explodeVectors(pr);
  const one = K.normalizeProject({ czesci: [{ id: 'a' }, { id: 'd', x: 50, rozst: [1, 2, 3] }] });
  assert.deepEqual(K.explodeVectors(one).d, [1, 2, 3]);
  assert.equal(v.d[1], 2 + (0 - 0) * 1.1, 'odjazd grupy dodaje sie do kierunku');
  for (const id of ['a', 'b', 'c']) assert.ok(Math.hypot(...v[id]) > 0, id);
});

test('kontrola wskazuje czesc oderwana od reszty', () => {
  const pr = K.normalizeProject({ nazwa: 'x', kroki: [{ tytul: 'a' }], czesci: [{ id: 'a', nazwa: 'Baza', sx: 10, sy: 10, sz: 10 }, { id: 'b', nazwa: 'Klocek', sx: 10, sy: 10, sz: 10, x: 10 }, { id: 'c', nazwa: 'Wisi', sx: 5, sy: 5, sz: 5, y: 500 }] });
  const w = K.check(pr);
  assert.equal(w.length, 1);
  assert.match(w[0], /Wisi/);
  assert.doesNotMatch(w[0], /Baza/);
});

test('edycja dodaje, usuwa i zmienia, a nowa czesc trafia na koniec montazu', () => {
  let pr = K.normalizeProject({ czesci: [{ id: 'a', krok: 1 }, { id: 'b', krok: 2, sx: 5 }] });
  pr = K.applyOps(pr, { usun: ['a'], zmien: [{ id: 'b', sx: 50, kolor: '#ff0000' }], dodaj: [{ id: 'b', nazwa: 'Nowa', ksztalt: 'kula', r: 4 }] });
  assert.deepEqual(pr.czesci.map((p) => p.id), ['b', 'b_n2']);
  assert.equal(pr.czesci[0].sx, 50);
  assert.equal(pr.czesci[0].kolor, '#ff0000');
  assert.equal(pr.czesci[1].krok, 3);
});

test('STL ma poprawny rozmiar i uwzglednia skale repliki', () => {
  const p = K.normalizePart({ sx: 100, sy: 100, sz: 100 });
  const m = K.worldMesh(p);
  const buf = K.stlBinary([m], 10);
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 84 + 12 * 50);
  assert.equal(v.getUint32(80, true), 12);
  assert.ok(Math.abs(Math.abs(v.getFloat32(84 + 12, true)) - 5) < 1e-5);
});

test('gotowe projekty: poprawne dane, kroki opisane, spojne bryly', () => {
  assert.equal(T.LIST.length, 4);
  for (const tpl of T.LIST) {
    const pr = K.normalizeProject(tpl.make());
    assert.ok(pr.czesci.length >= 15, tpl.id);
    const nums = K.stepNumbers(pr);
    assert.deepEqual(nums, pr.kroki.map((k) => k.nr), `${tpl.id}: kazdy krok ma opis`);
    const m = K.measure(pr);
    assert.ok(m.triangles > 500 && m.triangles < 150000, `${tpl.id}: ${m.triangles}`);
    assert.deepEqual(K.check(pr, m), [], tpl.id);
    for (const p of pr.czesci) assert.equal(openEdges(K.partMesh(p)), 0, `${tpl.id}/${p.id}`);
  }
  const asg = K.normalizeProject(T.LIST[0].make());
  assert.ok(asg.czesci.length >= 80, `ASG: ${asg.czesci.length} czesci`);
  const am = K.measure(asg);
  assert.ok(am.size[0] > 650 && am.size[0] < 800, `dlugosc ${am.size[0]}`);
  const saturn = K.normalizeProject(T.LIST.find((t) => t.id === 'saturn').make());
  const m = K.measure(saturn);
  assert.ok(Math.abs(m.size[1] - 110600) < 300, `wysokosc ${m.size[1]}`);
});

test('gotowe podzespoly: zamkniete bryly, nazwy po polsku, pozycja i obrot rodzica', () => {
  assert.ok(Object.keys(K.MACROS).length >= 12);
  for (const makro of Object.keys(K.MACROS)) {
    const pr = K.normalizeProject({ czesci: [{ makro, id: 'a', grupa: 'G', krok: 4 }] });
    assert.ok(pr.czesci.length >= 1, makro);
    for (const p of pr.czesci) {
      assert.equal(p.krok, 4, `${makro}/${p.id}`);
      assert.equal(p.grupa, 'G');
      assert.ok(K.signedVolume(K.partMesh(p)) > 0, `${makro}/${p.id}`);
    }
  }
  const pr = K.normalizeProject({ czesci: [{ makro: 'sruba', id: 's', d: 4, l: 20 }, { makro: 'sruba', id: 't', d: 4, l: 20, x: 100, rz: 90 }] });
  const a = K.boundsOf(K.worldMesh(pr.czesci[0]));
  const b = K.boundsOf(K.worldMesh(pr.czesci[1]));
  assert.ok(Math.abs(a.hi[1] - a.lo[1] - (b.hi[0] - b.lo[0])) < 0.01, 'obrot o 90 stopni zamienia osie');
  assert.ok(Math.abs((b.lo[0] + b.hi[0]) / 2 - 100 + 0) < 20);
});

test('gearbox V2 to komplet: koła, tłok, sprężyna, siedem śrub, po kolei', () => {
  const pr = K.normalizeProject({ czesci: [{ makro: 'aeg_gearbox_v2', id: 'g', grupa: 'G', krok_od: 1 }] });
  const names = pr.czesci.map((p) => p.nazwa).join('|');
  for (const n of ['Skorupa gearboxa lewa', 'Koło sektorowe', 'Koło stożkowe', 'Tłok', 'Sprężyna główna', 'Dysza', 'Spust', 'Układ MOSFET']) assert.ok(names.includes(n), n);
  assert.equal(pr.czesci.filter((p) => /Śruba skorupy/.test(p.nazwa)).length, 7);
  assert.deepEqual(K.stepNumbers(pr), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('uszkodzone dane od modelu nie wywracaja projektu', () => {
  const pr = K.normalizeProject({ czesci: [null, 5, { ksztalt: 'loft', przekroje: 'zle' }, { ksztalt: 'obrotowa', profil: [[1]] }, { ksztalt: 'rurka', sciezka: [[]] }, { ksztalt: 'plyta', otwory: [null] }, { powiel: { n: 9999 } }], kroki: [null], zrodla: [{ url: 'javascript:x' }] });
  assert.ok(pr.czesci.length > 0 && pr.czesci.length <= K.MAX_PARTS);
  assert.equal(pr.zrodla.length, 0);
  for (const p of pr.czesci) assert.ok(K.partMesh(p).every(Number.isFinite), p.ksztalt);
});
