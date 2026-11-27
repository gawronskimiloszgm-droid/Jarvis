import test from 'node:test';
import assert from 'node:assert/strict';

const E = await import('../server/extras/earth.js');
const { LIFE_TOOL_NAMES } = await import('../server/extras/lifevoice.js');

const NOW = Date.UTC(2026, 10, 27, 18, 0);
const feature = (id, mag, lat, lon, hoursAgo, place) => ({ id, properties: { mag, place, time: NOW - hoursAgo * 3600000, tsunami: 0, url: '' }, geometry: { coordinates: [lon, lat, 10] } });

test('odleglosc po kuli: Warszawa-Krakow ok. 250 km', () => {
  const km = E.distanceKm({ lat: 52.23, lon: 21.01 }, { lat: 50.06, lon: 19.94 });
  assert.ok(km > 245 && km < 260, String(km));
});

test('trzesienia: parsowanie, podsumowanie na swiecie i w promieniu, polska odmiana', () => {
  const list = E.parseQuakes({ features: [feature('a', 6.8, -8.3, 127.6, 140, 'Timor'), feature('b', 3, 59.3, -152.5, 1, 'Alaska'), feature('c', 2.7, 49.6, 20.1, 30, 'Podhale'), feature('x', 4, NaN, 1, 1, 'zle')] });
  assert.deepEqual(list.map((q) => q.id), ['b', 'c', 'a'], 'od najnowszego, bez blednych');
  const world = E.quakeSummary(list, { now: NOW });
  assert.match(world.text, /^3 trzęsienia M2,5\+ na świecie w 7 dni, w tym 1 silne \(M6\+\)\. Najsilniejsze: M6,8 Timor, 6 dni temu\. Ostatnie: M3,0 Alaska, 1 h temu\./);
  const near = E.quakeSummary(list, { near: { lat: 50.06, lon: 19.94, name: 'Kraków' }, radiusKm: 200, now: NOW });
  assert.equal(near.count, 1);
  assert.match(near.text, /^1 trzęsienie M2,5\+ w promieniu 200 km od: Kraków.*Podhale \(\d+ km stąd\), 30 h temu/);
  assert.match(E.quakeSummary(list, { near: { lat: 0, lon: 0 }, radiusKm: 100 }).text, /^Brak trzęsień ziemi/);
});

test('samoloty z OpenSky: bez stojacych na ziemi i bez pozycji', () => {
  const p = E.parsePlanes({ states: [['abc', 'LOT123 ', 'Poland', 0, 0, 19.9, 50.1, 10000, false, 230, 90], ['gnd', 'X', 'PL', 0, 0, 20, 50, 0, true, 0, 0], ['nop', 'Y', 'PL', 0, 0, null, null, 0, false, 0, 0]] });
  assert.deepEqual(p, [{ id: 'abc', call: 'LOT123', country: 'Poland', lon: 19.9, lat: 50.1, altM: 10000, speedKmh: 828, heading: 90 }]);
});

test('narzedzie glosowe: przyblizenie przez geokodowanie i polecenie dla ekranu', async () => {
  assert.ok(LIFE_TOOL_NAMES.includes('ziemia'));
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /nominatim\.openstreetmap\.org\/search\?q=Zakopane/);
    return { ok: true, json: async () => [{ lat: '49.29', lon: '19.95', display_name: 'Zakopane, powiat tatrzański, Polska' }] };
  };
  try {
    const r = await E.runEarthTool('ziemia', { akcja: 'przybliz', miejsce: 'Zakopane' });
    assert.deepEqual(r.klient, { action: 'ziemia', params: { akcja: 'przybliz', lat: 49.29, lon: 19.95, nazwa: 'Zakopane, powiat tatrzański' } });
    assert.deepEqual((await E.runEarthTool('ziemia', { akcja: 'satelita' })).klient.params, { akcja: 'satelita' });
    assert.match((await E.runEarthTool('ziemia', { akcja: 'przybliz' })).error, /miejsce/);
    assert.equal(await E.runEarthTool('inne', {}), undefined);
  } finally {
    globalThis.fetch = real;
  }
});
