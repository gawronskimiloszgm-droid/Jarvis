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
  step(hand({ ext: [true, false, false, false] })); // puszczenie liczy sie po 2 klatkach
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
  assert.ok(!ev.some((e) => e.type === 'grab-end'), 'krotka utrata dloni nie przerywa chwytu');
  now += G.GRACE_MS;
  step([]);
  assert.ok(ev.some((e) => e.type === 'grab-end'));
});

test('analiza: proporcje kadru i glebia zmieniaja odleglosc palcow', () => {
  const lm = hand();
  const wide = G.analyze(lm, 16 / 9).pinch;
  const narrow = G.analyze(lm, 9 / 16).pinch;
  assert.notEqual(wide.toFixed(3), narrow.toFixed(3));
  const flat = hand({ pinch: true });
  const inDepth = flat.map((p, i) => (i === 4 ? { ...p, z: 0.5 } : p));
  assert.ok(G.analyze(flat).pinch < G.PIN_ON);
  assert.ok(G.analyze(inDepth).pinch > G.PIN_OFF, 'kciuk tylko nalozony w obrazie to nie szczypniecie');
});

test('tracker: jednoklatkowe mignięcie szczypniecia nic nie robi', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const point = { ext: [true, false, false, false] };
  const step = (h) => { now += 33; ev.push(...t.update([h], now).events); };
  for (let i = 0; i < 3; i++) step(hand(point));
  step(hand({ ...point, pinch: true }));
  for (let i = 0; i < 4; i++) step(hand(point));
  assert.equal(ev.filter((e) => e.type === 'tap').length, 0);
});

test('tracker: krotka utrata dloni nie przerywa szczypniecia', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const pin = hand({ pinch: true, ext: [true, false, false, false] });
  const step = (hs, ms = 33) => { now += ms; const o = t.update(hs, now); ev.push(...o.events); return o; };
  for (let i = 0; i < 4; i++) step([pin]);
  const lost = step([], 100);
  assert.equal(lost.mode, 'lost');
  assert.equal(lost.pinch, true);
  const back = step([pin]);
  assert.equal(back.pinch, true);
  assert.equal(ev.filter((e) => e.type === 'tap').length, 0);
});

test('tracker: piesc to pauza - kursor stoi, brak zdarzen', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const step = (h) => { now += 33; const o = t.update([h], now); ev.push(...o.events); return o; };
  const before = step(hand({ ext: [true, false, false, false] })).cursor;
  let o;
  for (let i = 0; i < 6; i++) o = step(hand({ ext: [false, false, false, false], dx: i * 0.02 }));
  assert.equal(o.mode, 'freeze');
  assert.deepEqual(o.cursor, before);
  assert.equal(ev.length, 0);
});

test('tracker: szybki ruch otwarta dlonia = jeden swipe z kierunkiem i przerwa', () => {
  const t = G.createTracker();
  const ev = [];
  let now = 0;
  const step = (h) => { now += 33; ev.push(...t.update([h], now).events); };
  for (let i = 0; i < 9; i++) step(hand({ dx: -0.2 + i * 0.05 }));
  const sw = ev.filter((e) => e.type === 'swipe');
  assert.equal(sw.length, 1);
  assert.ok(sw[0].dir === -1 || sw[0].dir === 1);
  // powolny ruch nie jest swipe
  const t2 = G.createTracker();
  const ev2 = [];
  let n2 = 0;
  for (let i = 0; i < 30; i++) { n2 += 33; ev2.push(...t2.update([hand({ dx: -0.2 + i * 0.005 })], n2).events); }
  assert.equal(ev2.filter((e) => e.type === 'swipe').length, 0);
});

test('tracker: falszywa druga dlon przez 1-2 klatki nie wlacza zoomu', () => {
  const t = G.createTracker();
  let now = 0;
  const modes = [];
  const step = (hs) => { now += 33; modes.push(t.update(hs, now).mode); };
  const a = hand({ ext: [true, false, false, false] });
  step([a]);
  step([a, hand({ dx: 0.3 })]);
  step([a, hand({ dx: 0.3 })]);
  step([a]);
  assert.ok(!modes.includes('zoom'), modes.join());
  for (let i = 0; i < 3; i++) step([a, hand({ dx: 0.3 })]);
  assert.equal(modes.at(-1), 'zoom');
});

test('tracker: margines kadru pozwala siegnac do rogu ekranu', () => {
  const t = G.createTracker({ edge: 0.15 });
  let o;
  // czubek wskazujacego przy x=.45 -> po lustrze .55; przesuwamy dlon tak, by czubek byl w 10% od krawedzi kadru
  for (let i = 0; i < 20; i++) o = t.update([hand({ ext: [true, false, false, false], dx: 0.45, dy: -0.25 })], i * 33);
  assert.ok(o.cursor.x <= 0.01, `x=${o.cursor.x}`);
  assert.ok(o.cursor.y <= 0.01, `y=${o.cursor.y}`);
});

test('tracker: klik trafia w miejsce sprzed zamykania palcow', () => {
  const t = G.createTracker({ edge: 0 });
  const ev = [];
  let now = 0;
  const point = { ext: [true, false, false, false] };
  const step = (h) => { now += 33; ev.push(...t.update([h], now).events); };
  for (let i = 0; i < 20; i++) step(hand(point));
  // zamykajac palce czubek opada o 2% - klik ma zostac przy pozycji startowej
  step(hand({ ...point, pinch: true, dy: 0.01 }));
  step(hand({ ...point, pinch: true, dy: 0.02 }));
  step(hand({ ...point, pinch: true, dy: 0.02 }));
  step(hand(point));
  step(hand(point));
  const tap = ev.find((e) => e.type === 'tap');
  assert.ok(tap, JSON.stringify(ev));
  assert.ok(Math.abs(tap.y - 0.34) < 0.012, `y=${tap.y}`);
});

test('zawis: klik raz po czasie, ruch i zmiana celu zeruja licznik', () => {
  const d = G.createDwell({ ms: 500, radius: 0.03 });
  assert.equal(d.update(0.5, 0.5, 'a', 0).fire, false);
  assert.ok(Math.abs(d.update(0.5, 0.5, 'a', 250).progress - 0.5) < 0.01);
  assert.equal(d.update(0.5, 0.5, 'a', 510).fire, true);
  assert.equal(d.update(0.5, 0.5, 'a', 1200).fire, false, 'tylko raz na wejscie');
  assert.equal(d.update(0.5, 0.5, 'b', 1300).progress, 0);
  assert.equal(d.update(0.6, 0.5, 'b', 1600).progress, 0, 'ruch zeruje');
  assert.equal(d.update(0.6, 0.5, null, 1700).progress, 0);
});

test('filtr: stoi w miejscu przy drzeniu, nadąża przy szybkim ruchu', () => {
  const f = G.oneEuro();
  let v = f.next(0.5, 0);
  let spread = 0;
  for (let i = 1; i < 60; i++) {
    v = f.next(0.5 + (i % 2 ? 0.004 : -0.004), i * 33);
    if (i > 20) spread = Math.max(spread, Math.abs(v - 0.5));
  }
  assert.ok(spread < 0.0035, `drzenie ${spread}`);
  const g = G.oneEuro();
  g.next(0, 0);
  let out = 0;
  for (let i = 1; i <= 6; i++) out = g.next(i * 0.05, i * 33);
  assert.ok(out > 0.2, `opoznienie ${out}`);
});
