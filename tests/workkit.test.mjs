import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const m = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/workkit.js', import.meta.url), 'utf8'))(m);
const W = m.exports;

test('energia kulki: 350 fps na 0,20 g to ok. 1,14 J', () => {
  const e = W.bbEnergy({ fps: 350, g: 0.2 });
  assert.equal(e.joule, 1.138);
  assert.equal(e.ms, 106.7);
  assert.equal(W.bbEnergy({ ms: 100, g: 0.25 }).joule, 1.25);
  assert.equal(W.bbEnergy({ fps: 0 }), null);
});

test('inna kulka przy tej samej energii i porownanie z limitami', () => {
  const v = W.sameEnergyFps(350, 0.2, 0.25);
  assert.equal(v.fps, 313);
  const lim = W.limitsFor(1.6);
  assert.deepEqual(lim.map((l) => l.ok), [false, false, true, true]);
  assert.equal(lim[1].fps02, 400);
});

test('przelozenie i szybkostrzelnosc', () => {
  assert.equal(W.gearRatio([[30, 10], [24, 12], [40, 12.5]]), 19.2);
  assert.equal(W.rof({ rpm: 30000, ratio: 18.72 }), 18.7);
  assert.equal(W.gearRatio([]), null);
  assert.equal(W.rof({ rpm: 0, ratio: 18 }), null);
});

test('akumulator', () => {
  assert.deepEqual(W.battery({ mAh: 1200, amps: 15, rofBps: 20 }), { minutes: 3.8, shots: 4608 });
});

test('prawo Ohma z dowolnej pary', () => {
  assert.deepEqual(W.ohm({ U: 12, I: 2 }), { U: 12, I: 2, R: 6, P: 24 });
  assert.deepEqual(W.ohm({ R: 6, P: 24 }), { U: 12, I: 2, R: 6, P: 24 });
  assert.deepEqual(W.ohm({ U: 5, R: 250 }), { U: 5, I: 0.02, R: 250, P: 0.1 });
  assert.equal(W.ohm({ U: 5 }), null);
});

test('LED: zaokraglenie w gore do E12 i moc', () => {
  const r = W.ledResistor({ supply: 5, vf: 2, mA: 20 });
  assert.equal(r.exact, 150);
  assert.equal(r.R, 150);
  assert.equal(r.power, '1/8 W');
  assert.equal(W.ledResistor({ supply: 12, vf: 3.2, mA: 20, count: 3 }).R, 120);
  assert.equal(W.ledResistor({ supply: 12, vf: 3.2, mA: 20, count: 3 }).exact, 120);
  assert.match(W.ledResistor({ supply: 3, vf: 3.2 }).error, /zasilanie/);
  assert.equal(W.e12Up(152), 180);
  assert.equal(W.e12Up(1000), 1000);
});

test('paski rezystora w obie strony', () => {
  assert.deepEqual(W.bandsToOhms(['brązowy', 'czarny', 'czerwony', 'złoty']), { ohms: 1000, tolerance: '±5%' });
  assert.deepEqual(W.bandsToOhms(['żółty', 'fioletowy', 'czarny']), { ohms: 47, tolerance: '±20%' });
  assert.equal(W.bandsToOhms(['nie', 'ma']), null);
  assert.deepEqual(W.ohmsToBands(4700), ['zolty', 'fioletowy', 'czerwony', 'zloty']);
  assert.deepEqual(W.ohmsToBands(10), ['brazowy', 'czarny', 'czarny', 'zloty']);
  assert.deepEqual(W.ohmsToBands(220), ['czerwony', 'czerwony', 'brazowy', 'zloty']);
});

test('dzielnik napiecia', () => {
  assert.deepEqual(W.divider({ U: 12, R1: 10000, R2: 4700 }), { out: 3.837, current_mA: 0.816 });
});

test('gwinty metryczne', () => {
  const t = W.thread('M3');
  assert.deepEqual([t.pitch, t.tapDrill, t.clearance], [0.5, 2.5, 3.4]);
  assert.equal(W.thread('m8').tapDrill, 6.75);
  assert.equal(W.thread('M7'), null);
});

test('szacunek wydruku: wiecej wypelnienia to wiecej materialu', () => {
  const low = W.printEstimate({ volume: 50000, area: 8000, infill: 15 });
  const high = W.printEstimate({ volume: 50000, area: 8000, infill: 60 });
  assert.ok(high.grams > low.grams);
  assert.equal(W.printEstimate({ volume: 1000, area: 10000, infill: 0 }).grams, 1.2, 'cienka scianka liczy sie najwyzej jako cala objetosc');
  assert.ok(low.meters > 0 && low.minutes > 0 && low.cost > 0);
  assert.equal(W.printEstimate({ volume: 0 }), null);
});

test('skala na stol i rozklad czesci', () => {
  assert.deepEqual(W.fitScale([300, 100, 50]), { scale: 0.733, fits: false, maxScale: 0.733 });
  assert.equal(W.fitScale([100, 50, 20]).fits, true);
  const p = W.packBed([{ id: 'a', w: 100, d: 50 }, { id: 'b', w: 30, d: 120 }, { id: 'c', w: 300, d: 10 }, { id: 'd', w: 100, d: 100 }], [220, 220], 4);
  assert.deepEqual(p.left, ['c']);
  assert.equal(p.placed.length, 3);
  for (const a of p.placed) {
    assert.ok(a.x + a.w <= 220 && a.y + a.d <= 220, a.id);
    for (const b of p.placed) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.d <= b.y || b.y + b.d <= a.y, `${a.id} nachodzi na ${b.id}`);
  }
  assert.equal(p.placed.find((x) => x.id === 'b').rotated, true);
});

test('narzedzia glosowe warsztatu', async () => {
  const { runWorkTool, WORK_TOOLS } = await import('../server/extras/workcalc.js');
  const e = runWorkTool('energia_asg', { fps: 350, kulka_g: 0.2, inna_kulka_g: 0.28 });
  assert.equal(e.dzule, 1.138);
  assert.match(e.na_innej_kulce, /296 fps/);
  assert.match(runWorkTool('energia_asg', {}).error, /predkosc/);
  const r = runWorkTool('repliki_osiagi', { zebatki: '30/10, 24/12, 40/12,5', obroty: 30000, mah: 1200 });
  assert.equal(r.przelozenie, '19.2:1');
  assert.match(r.akumulator, /3.8 min/);
  assert.equal(runWorkTool('elektronika', { typ: 'ohm', U: 12, I: 2 }).R, 6);
  assert.equal(runWorkTool('elektronika', { typ: 'led', zasilanie: 5 }).R, 150);
  assert.equal(runWorkTool('elektronika', { typ: 'paski', kolory: 'brązowy, czarny, czerwony' }).ohms, 1000);
  assert.equal(runWorkTool('elektronika', { typ: 'paski', R: 4700 }).paski, 'zolty, fioletowy, czerwony, zloty');
  assert.equal(runWorkTool('gwint', { rozmiar: 'M4' }).tapDrill, 3.3);
  assert.equal(runWorkTool('nie', {}), undefined);
  for (const t of WORK_TOOLS) for (const req of t.parameters.required || []) assert.ok(t.parameters.properties[req]);
});
