import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mod = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/handgest.js', import.meta.url), 'utf8'))(mod);
const G = mod.exports;

// Syntetyczna dlon: nadgarstek (0), podstawy palcow (5,9,13,17), stawy (6,10,14,18), czubki (8,12,16,20), kciuk (1-4).
function hand({ ext = [true, true, true, true], pinch = false, dx = 0, dy = 0 } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  const set = (i, x, y) => (lm[i] = { x: x + dx, y: y + dy, z: 0 });
  set(0, 0.5, 0.8);
  const bases = [[5, 0.45], [9, 0.5], [13, 0.55], [17, 0.6]];
  bases.forEach(([b, x], k) => {
    set(b, x, 0.62);
    set(b + 1, x, ext[k] ? 0.5 : 0.56);
    set(b + 2, x, ext[k] ? 0.42 : 0.6);
    set(b + 3, x, ext[k] ? 0.34 : 0.64);
  });
  set(1, 0.44, 0.74); set(2, 0.4, 0.7); set(3, 0.37, 0.67);
  set(4, 0.35, 0.64);
  if (pinch) set(4, 0.45, 0.35); // czubek kciuka w czubku wskazujacego (8 jest na x=.45,y=.34)
  return lm;
}
const flip = (lm) => lm.map((p) => ({ ...p, x: p.x }));

test('analiza: palce wyprostowane, wskazujacy, piesc', () => {
  assert.equal(G.analyze(hand()).mode, 'open');
  assert.equal(G.analyze(hand({ ext: [true, false, false, false] })).mode, 'point');
  assert.equal(G.analyze(hand({ ext: [false, false, false, false] })).mode, 'fist');
  assert.equal(G.analyze(hand()).nExt, 4);
});

test('analiza: szczypniecie zmniejsza stosunek kciuk-wskazujacy', () => {
  assert.ok(G.analyze(hand()).pinch > 0.6);
  assert.ok(G.analyze(hand({ pinch: true })).pinch < G.PIN_ON);
});

test('tracker: krotkie szczypniecie = tap w miejscu kursora', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const step = (h, ms = 33) => { now += ms; ev.push(...t.update(h ? [h] : [], now).events); };
  for (let i = 0; i < 3; i++) step(hand({ ext: [true, false, false, false] }));
  for (let i = 0; i < 4; i++) step(hand({ pinch: true, ext: [true, false, false, false] }));
  for (let i = 0; i < 3; i++) step(hand({ ext: [true, false, false, false] }));
  const tap = ev.find((e) => e.type === 'tap');
  assert.ok(tap, JSON.stringify(ev));
  assert.ok(tap.x >= 0 && tap.x <= 1 && tap.y >= 0 && tap.y <= 1);
  assert.ok(!ev.some((e) => e.type === 'grab-start'));
});

test('tracker: przytrzymane szczypniecie = chwyt, potem koniec chwytu', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const step = (h, ms = 33) => { now += ms; ev.push(...t.update(h ? [h] : [], now).events); };
  step(hand({ ext: [true, false, false, false] }));
  for (let i = 0; i < 14; i++) step(hand({ pinch: true, ext: [true, false, false, false] })); // ~460 ms
  step(hand({ ext: [true, false, false, false] }));
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('grab-start'), types.join());
  assert.ok(types.includes('grab-move'));
  assert.equal(types.at(-1), 'grab-end');
  assert.ok(!types.includes('tap'));
});

test('tracker: szczypniecie z ruchem = pan', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const step = (h) => { now += 33; ev.push(...t.update([h], now).events); };
  step(hand({ ext: [true, false, false, false] }));
  for (let i = 0; i < 8; i++) step(hand({ pinch: true, ext: [true, false, false, false], dx: i * 0.02 }));
  assert.ok(ev.some((e) => e.type === 'pan' && Math.abs(e.dx) > 0));
  assert.ok(!ev.some((e) => e.type === 'tap'));
});

test('tracker: otwarta dlon w ruchu obraca graf, nieruchoma nie', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const step = (h) => { now += 33; ev.push(...t.update([h], now).events); };
  for (let i = 0; i < 5; i++) step(hand({ dx: 0.3 })); // bez ruchu
  assert.equal(ev.filter((e) => e.type === 'rotate').length, 0);
  for (let i = 0; i < 5; i++) step(hand({ dx: 0.3 + i * 0.02 }));
  const rot = ev.filter((e) => e.type === 'rotate');
  assert.ok(rot.length >= 3);
  assert.ok(rot.every((e) => e.dx !== 0));
});

test('tracker: dwie dlonie - rozsuwanie przybliza, zblizanie oddala', () => {
  const t = G.createTracker();
  let now = 0;
  const two = (gap) => [hand({ dx: -gap }), hand({ dx: gap })];
  const run = (gaps) => {
    const ev = [];
    gaps.forEach((g) => { now += 33; ev.push(...t.update(two(g), now).events); });
    return ev.filter((e) => e.type === 'zoom');
  };
  const spread = run([0.1, 0.12, 0.14, 0.16, 0.18]);
  assert.ok(spread.length && spread.every((e) => e.factor > 1));
  const close = run([0.16, 0.13, 0.1, 0.08]);
  assert.ok(close.length && close.every((e) => e.factor < 1));
});

test('tracker: brak dloni konczy chwyt', () => {
  const t = G.createTracker();
  let now = 0;
  const ev = [];
  const step = (hs) => { now += 33; ev.push(...t.update(hs, now).events); };
  for (let i = 0; i < 16; i++) step([hand({ pinch: true, ext: [true, false, false, false] })]);
  step([]);
  assert.ok(ev.some((e) => e.type === 'grab-end'));
});
