import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findPhotos, imagesFromBing, isStockPhoto, photoMatchesTopic, photoParts, pickPhoto, reviewProject } from '../server/extras/studio.js';

const m = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/phototrace.js', import.meta.url), 'utf8'))(m);
const PT = m.exports;

function draw(w, h, inside, color = [20, 20, 20]) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inside(x, y)) {
        const i = (y * w + x) * 4;
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
      }
    }
  }
  return { data, width: w, height: h };
}

test('dlugi przedmiot na ukos jest oznaczony, a poziomy i pionowy nie', () => {
  const diag = draw(400, 400, (x, y) => Math.abs(x - y) < 25 && x > 40 && x < 360);
  assert.equal(PT.photoQuality(diag).skos, true);
  assert.equal(PT.photoQuality(draw(400, 200, (x, y) => x > 40 && x < 360 && y > 70 && y < 130)).skos, false);
  assert.equal(PT.photoQuality(draw(200, 400, (x, y) => y > 40 && y < 360 && x > 70 && x < 130)).skos, false);
});

test('gitara z lekko niesymetrycznym korpusem nie liczy sie jako ukos', () => {
  const guitar = draw(600, 300, (x, y) => (x > 40 && x < 240 && y > 60 && y < 240) || (x >= 240 && x < 560 && y > 120 && y < 150));
  assert.equal(PT.photoQuality(guitar).skos, false);
});

test('sam waski profil jest oznaczony jako krawedz', () => {
  assert.equal(PT.photoQuality(draw(200, 800, (x, y) => y > 40 && y < 760 && x > 90 && x < 110)).krawedz, true);
  assert.equal(PT.photoQuality(draw(400, 200, (x, y) => x > 40 && x < 360 && y > 50 && y < 150)).krawedz, false);
});

test('przedmiot zlewajacy sie z tlem ma slaba krawedz', () => {
  const box = (x, y) => x > 40 && x < 360 && y > 40 && y < 160;
  assert.ok(PT.photoQuality(draw(400, 200, box, [240, 235, 225])).slaba > 0.9);
  assert.ok(PT.photoQuality(draw(400, 200, box)).slaba < 0.05);
});

test('banki zdjec sa rozpoznawane, a zwykle sklepy nie', () => {
  for (const u of ['https://thumbs.dreamstime.com/z/a.jpg', 'https://c8.alamy.com/comp/a.jpg', 'https://as2.ftcdn.net/jpg/a.jpg', 'https://image.shutterstock.com/z/a.jpg']) assert.equal(isStockPhoto(u), true, u);
  for (const u of ['https://www.thomann.de/pics/a.jpg', 'https://pictures.milgear.fi/0/1/a.webp', 'https://upload.wikimedia.org/a.jpg']) assert.equal(isStockPhoto(u), false, u);
  assert.equal(isStockPhoto('to nie adres'), true);
});

const entry = (u, t = 'electric guitar') => `m="${JSON.stringify({ murl: u, t }).replace(/"/g, '&quot;')}"`;

test('wyszukiwanie pyta o oba widoki, na przemian, bez bankow zdjec i bez powtorzen', async (t) => {
  const asked = [];
  const page = (list) => list.map((u) => entry(u)).join(' ');
  t.mock.method(globalThis, 'fetch', async (url) => {
    const q = decodeURIComponent(String(url));
    asked.push(q);
    return new Response(/front view/.test(q) ? page(['https://a.pl/f1.jpg', 'https://a.pl/wspolne.jpg']) : page(['https://a.pl/s1.jpg', 'https://thumbs.dreamstime.com/z/x.jpg', 'https://a.pl/wspolne.jpg']));
  });
  const out = await findPhotos('electric guitar');
  assert.equal(asked.length, 3);
  assert.deepEqual(out, ['https://a.pl/s1.jpg', 'https://a.pl/f1.jpg', 'https://a.pl/wspolne.jpg']);
});

test('awaria jednego zapytania nie przekresla drugiego', async (t) => {
  let n = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (n++ === 0) throw new Error('siec');
    return new Response(entry('https://a.pl/f.jpg', 'x'));
  });
  assert.deepEqual(await findPhotos('x'), ['https://a.pl/f.jpg']);
});

const IMG = 'data:image/jpeg;base64,AAAA';

test('obcy przedmiot, rysunek i obraz z generatora odpadaja juz po tytule', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response([
    entry('https://a.pl/1.jpg', 'Classical guitar 4/4 Ortega'),
    entry('https://a.pl/2.jpg', 'Lock Jaw barbell collars red'),
    entry('https://a.pl/guitar3.jpg', 'Sklep'),
    entry('https://a.pl/4.jpg', 'Premium Vector | classical guitar'),
    entry('https://a.pl/5.jpg', 'Premium AI Image | classical guitar'),
  ].join(' ')));
  assert.deepEqual(await findPhotos('classical guitar'), ['https://a.pl/1.jpg', 'https://a.pl/guitar3.jpg']);
});

test('dopasowanie do nazwy radzi sobie z odmiana i numerami', () => {
  assert.equal(photoMatchesTopic({ url: 'https://a/x.jpg', title: 'Gitara klasyczna Ortega' }, 'gitarę klasyczną'), true);
  assert.equal(photoMatchesTopic({ url: 'https://a/x.jpg', title: 'Zacisk na sztangę' }, 'gitarę klasyczną'), false);
  assert.equal(photoMatchesTopic({ url: 'https://a/honda-cb650r.jpg', title: 'Motor' }, 'Honda CB650R'), true);
});

test('wynik z bledem w opisie jest pomijany', () => {
  assert.deepEqual(imagesFromBing('m="{zepsute}" m="{&quot;murl&quot;:&quot;http://a/x&quot;}"'), []);
});

test('potwierdzenie przedmiotu musi przyjsc wprost od modelu', async () => {
  const say = (o) => photoParts(IMG, 'gitara', { generate: async () => o });
  assert.equal((await say({ to_ten_przedmiot: true })).to_ten_przedmiot, true);
  assert.equal((await say({ to_ten_przedmiot: false })).to_ten_przedmiot, false);
  assert.equal((await say({})).to_ten_przedmiot, false);
});

test('wybor zdjecia pilnuje numeru i wysyla miniatury', async () => {
  let seen;
  const r = await pickPhoto([IMG, 'zly', IMG], 'gitara', { generate: async (_p, _s, parts) => { seen = parts; return { najlepszy: 1, powod: 'front' }; } });
  assert.equal(seen.length, 2);
  assert.equal(r.najlepszy, 1);
  assert.equal((await pickPhoto([IMG], 'g', { generate: async () => ({ najlepszy: 7 }) })).najlepszy, -1);
  assert.equal((await pickPhoto([IMG], 'g', { generate: async () => ({ najlepszy: 'x' }) })).najlepszy, -1);
  await assert.rejects(pickPhoto([], 'g', { generate: async () => ({}) }), /Brak zdjęć/);
});

test('przeglad zglasza zla obudowe', async () => {
  const pr = { nazwa: 'T', czesci: [{ id: 'w', ksztalt: 'pudelko', sx: 10, sy: 10, sz: 10 }] };
  const bad = await reviewProject(pr, [IMG], { generate: async () => ({ obudowa_ok: false, uwaga_obudowa: 'To waza.' }) });
  assert.equal(bad.obudowa_ok, false);
  assert.equal(bad.uwaga_obudowa, 'To waza.');
  assert.equal((await reviewProject(pr, [IMG], { generate: async () => ({}) })).obudowa_ok, true);
});
