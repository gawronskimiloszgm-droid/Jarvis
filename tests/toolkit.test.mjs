import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

// toolkit.js to skrypt przegladarkowy (UMD) - w paczce typu module ladujemy go jako funkcje.
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const mod = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/toolkit.js', import.meta.url), 'utf8'))(mod);
const T = mod.exports;

test('kalkulator: kolejnosc dzialan, nawiasy, potegi, funkcje, procenty', () => {
  assert.equal(T.calc('2+2*3'), 8);
  assert.equal(T.calc('(2+2)*3'), 12);
  assert.equal(T.calc('2^10'), 1024);
  assert.equal(T.calc('-3 + 5'), 2);
  assert.equal(T.calc('sqrt(144) + 3'), 15);
  assert.equal(T.calc('10 / 4'), 2.5);
  assert.equal(T.calc('3,5 * 2'), 7);
  assert.equal(T.calc('20% z 150'), 30);
  assert.equal(T.calc('50%'), 0.5);
  assert.equal(T.calc('fact(5)'), 120);
  assert.equal(T.calc('sin(90)'), 1);
  assert.ok(Math.abs(T.calc('pi') - Math.PI) < 1e-9);
});

test('kalkulator: nie wykonuje kodu i zglasza bledy', () => {
  for (const bad of ['process.exit()', '1+', '2**', 'alert(1)', '(1', 'foo', '1/0', '"a"']) assert.throws(() => T.calc(bad), undefined, bad);
});

test('jednostki: dlugosc, masa, temperatura, czas, dane', () => {
  assert.ok(Math.abs(T.convert(10, 'km', 'mi') - 6.21371) < 1e-4);
  assert.equal(T.convert(1, 'kg', 'g'), 1000);
  assert.equal(T.convert(100, 'c', 'f'), 212);
  assert.equal(T.convert(32, 'f', 'c'), 0);
  assert.equal(T.convert(2, 'h', 'min'), 120);
  assert.equal(T.convert(1, 'gb', 'mb'), 1024);
  assert.throws(() => T.convert(1, 'kg', 'km'));
  const p = T.parseConvert('5 kg na lb');
  assert.ok(p && Math.abs(p.result - 11.0231) < 1e-3);
  assert.equal(T.parseConvert('pizza'), null);
});

test('procenty, VAT, kredyt, oszczednosci', () => {
  assert.equal(T.percent.of(20, 150), 30);
  assert.equal(T.percent.change(100, 150), 50);
  assert.equal(T.percent.discount(200, 25).final, 150);
  assert.ok(Math.abs(T.percent.vat(100).gross - 123) < 1e-9);
  assert.ok(Math.abs(T.percent.fromGross(123).net - 100) < 1e-9);
  const l = T.loan(100000, 6, 120);
  assert.ok(Math.abs(l.monthly - 1110.21) < 0.05);
  const s = T.savings(0, 100, 0, 1);
  assert.equal(s.final, 1200);
});

test('daty: roznica i dodawanie dni', () => {
  assert.equal(T.dateDiff('2026-10-01', '2026-10-31'), 30);
  assert.equal(T.dateAdd('2026-10-30', 3), '2020-11-02'.replace('2020', '2026'));
  // sroda 2026-10-28 -> piatek za 2 dni
  assert.equal(T.daysUntilWeekday('piatku', new Date('2026-10-28T12:00:00')), 2);
});

test('losowania i hasla', () => {
  const pw = T.password(20, { symbols: true });
  assert.equal(pw.length, 20);
  assert.match(pw, /[a-z]/);
  assert.match(pw, /[A-Z]/);
  assert.match(pw, /\d/);
  assert.notEqual(T.password(20), T.password(20));
  const dice = T.dice(6, 5);
  assert.equal(dice.length, 5);
  assert.ok(dice.every((d) => d >= 1 && d <= 6));
  assert.ok(['orzel', 'reszka'].includes(T.coin()));
  assert.match(T.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('kodowanie: base64 z polskimi znakami, hash, json, regex, timestamp', async () => {
  assert.equal(T.b64.dec(T.b64.enc('zażółć gęślą jaźń')), 'zażółć gęślą jaźń');
  assert.equal(await T.hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(T.jsonMin('{ "a": [1, 2] }'), '{"a":[1,2]}');
  assert.throws(() => T.json('{zle'));
  assert.deepEqual(T.regex('(\\d+)-(\\d+)', '', 'tel 12-34 i 56-78').map((m) => m.match), ['12-34', '56-78']);
  assert.equal(T.timestamp(0).iso, '1970-01-01T00:00:00.000Z');
  assert.equal(T.timestamp('2026-01-01T00:00:00Z').unix, 1767225600);
  assert.equal(T.words('Ala ma kota. Kot ma Ale!').slowa, 6);
});

test('kolory: hex/rgb/hsl, paleta, kontrast WCAG', () => {
  assert.deepEqual(T.hexToRgb('#ff8800'), [255, 136, 0]);
  assert.deepEqual(T.hexToRgb('f80'), [255, 136, 0]);
  assert.equal(T.rgbToHex(255, 136, 0), '#ff8800');
  assert.deepEqual(T.rgbToHsl(255, 0, 0), [0, 100, 50]);
  assert.equal(T.hslToHex(0, 100, 50), '#ff0000');
  assert.equal(T.palette('#ff0000').komplementarny, '#00ffff');
  assert.ok(Math.abs(T.contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.throws(() => T.hexToRgb('nie-kolor'));
});

test('QR: macierz o poprawnym rozmiarze i znacznikach wyszukiwania', () => {
  const m = T.qr('https://example.com');
  assert.equal(m.length, m[0].length);
  assert.equal((m.length - 17) % 4, 0);
  // lewy gorny znacznik: ramka 7x7 w calosci ciemna po obwodzie
  for (let i = 0; i < 7; i++) assert.ok(m[0][i] && m[6][i] && m[i][0] && m[i][6]);
  assert.ok(m[3][3]);
  assert.ok(!m[1][1]);
  assert.throws(() => T.qr('x'.repeat(500)));
});

test('QR: macierz zgodna ze wzorcem (zweryfikowana dekoderem jsQR i biblioteka qrcode)', async () => {
  const m = T.qr('hello world');
  assert.equal(m.length, 21);
  assert.equal(await T.hash(m.map((r) => r.map((v) => (v ? 1 : 0)).join('')).join('\n')), '03f942a0c3758b117ada4e1d2e5184c22dd5aec9b70693bf04351f96ddf1649f');
});

test('strefy czasowe', () => {
  assert.match(T.timeIn('Asia/Tokyo', new Date('2026-10-28T00:00:00Z')), /09:00/);
});
