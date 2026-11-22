import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const m = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/scan3d.js', import.meta.url), 'utf8'))(m);
const S = m.exports;

// Sylwetka jako maska: obraz w x h, funkcja (x, y) -> czy przedmiot.
function mask(w, h, inside) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = inside(x, y) ? 1 : 0;
  return out;
}
const views = (n, w, h, fnForAngle) => Array.from({ length: n }, (_, i) => {
  const angle = (i / n) * Math.PI * 2;
  return { w, h, angle, mask: mask(w, h, (x, y) => fnForAngle(angle, x, y)) };
});

function closedEdges(mesh) {
  const count = new Map();
  const f = mesh.indices;
  for (let t = 0; t < f.length; t += 3) {
    for (let a = 0; a < 3; a++) {
      const u = f[t + a];
      const v = f[t + ((a + 1) % 3)];
      const k = `${u},${v}`;
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  let open = 0;
  for (const [k, c] of count) {
    const [u, v] = k.split(',');
    if ((count.get(`${v},${u}`) || 0) !== c) open++;
  }
  return open;
}

test('walec: ten sam prostokat ze wszystkich stron daje walec o dobrej objetosci', () => {
  // 80 px szerokosci i 100 px wysokosci, przy 100 mm wysokosci: promien 40 mm.
  const v = views(12, 200, 160, () => true).map((x) => ({ ...x, mask: mask(200, 160, (px, py) => px >= 60 && px < 140 && py >= 30 && py < 130) }));
  const r = S.scan(v, { height: 100, res: 48 });
  const expected = Math.PI * 40 * 40 * 100;
  const got = S.volume(r);
  assert.ok(Math.abs(got - expected) / expected < 0.12, `objetosc ${Math.round(got)} zamiast ok. ${Math.round(expected)}`);
  assert.equal(closedEdges(r), 0, 'powierzchnia ma dziury');
  assert.equal(r.mmPerPx, 1);
});

test('prostopadloscian: inna szerokosc z przodu i z boku', () => {
  // Pudelko 80 x 40 mm: z przodu (0 i 180 stopni) 80 px, z boku 40 px, przy kacie posrednim rzut przekatnej.
  const w = 300;
  const h = 200;
  const v = views(16, w, h, (angle, x, y) => {
    const half = (Math.abs(40 * Math.cos(angle)) + Math.abs(20 * Math.sin(angle)));
    return y >= 50 && y < 150 && Math.abs(x + 0.5 - 150) <= half;
  });
  const r = S.scan(v, { height: 100, res: 56 });
  const expected = 80 * 40 * 100;
  const got = S.volume(r);
  assert.ok(Math.abs(got - expected) / expected < 0.15, `objetosc ${Math.round(got)} zamiast ${expected}`);
});

test('kula z kolowych sylwetek', () => {
  const v = views(10, 200, 200, (a, x, y) => (x + 0.5 - 100) ** 2 + (y + 0.5 - 100) ** 2 <= 60 * 60);
  const r = S.scan(v, { height: 120, res: 48 });
  const expected = (4 / 3) * Math.PI * 60 ** 3;
  assert.ok(Math.abs(S.volume(r) - expected) / expected < 0.15, `objetosc ${Math.round(S.volume(r))}`);
  assert.equal(closedEdges(r), 0);
});

test('male dziury w sylwetce zapelnione, duze przeswity zostaja', () => {
  const w = 60;
  const h = 40;
  // Prostokat z dziura 2x2 (odblask) i dziura 10x10 (ucho), plus tlo wokol.
  const m = mask(w, h, (x, y) => x >= 5 && x < 55 && y >= 5 && y < 35 && !(x >= 10 && x < 12 && y >= 10 && y < 12) && !(x >= 30 && x < 40 && y >= 15 && y < 25));
  const out = S.fillSmallHoles(m, w, h, 20);
  assert.equal(out[11 * w + 11], 1);
  assert.equal(out[20 * w + 35], 0);
  assert.equal(out[0], 0, 'tlo przy brzegu zostaje tlem');
});

test('bledy: brak przedmiotu na zdjeciu i sylwetki, ktore sie nie pokrywaja', () => {
  const empty = views(4, 50, 50, () => false);
  assert.throws(() => S.scan(empty, { height: 10 }), /nie widać/);
  // Na jednym zdjeciu przedmiot w gornej polowie kadru, na drugim w dolnej: nie ma wspolnej bryly.
  const off = views(2, 100, 100, (a, x, y) => x > 30 && x < 70 && (a < 1 ? y < 40 : y > 60));
  assert.throws(() => S.scan(off, { height: 10, res: 20 }), /nie pokrywają/);
});
