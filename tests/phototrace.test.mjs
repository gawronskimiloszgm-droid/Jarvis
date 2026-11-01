import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPrivateIp, photoParts } from '../server/extras/studio.js';

function load(file) {
  const m = { exports: {} };
  new Function('module', fs.readFileSync(new URL(`../public/extras/${file}.js`, import.meta.url), 'utf8'))(m);
  return m.exports;
}
const PT = load('phototrace');
const K = load('cadkit');

// Biale tlo, czarny prostokat 100 x 40 pikseli z dziura 20 x 10 i osobnym pylkiem.
function image(w = 200, h = 100, draw) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x, y) => {
    data[(y * w + x) * 4] = 20;
    data[(y * w + x) * 4 + 1] = 20;
    data[(y * w + x) * 4 + 2] = 20;
  };
  draw(set, (x, y) => {
    data[(y * w + x) * 4] = 255;
    data[(y * w + x) * 4 + 1] = 255;
    data[(y * w + x) * 4 + 2] = 255;
  });
  return { data, width: w, height: h };
}
const rect = (fn, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn(x, y);
};
const sample = () => image(200, 100, (on, off) => {
  rect(on, 50, 30, 150, 70);
  rect(off, 90, 45, 110, 55);
  rect(on, 2, 2, 5, 5);
});

test('skala, obrys i otwor sa dokladne co do piksela, pylek odpada', () => {
  const t = PT.traceParts(sample(), { dlugosc: 500, parts: [{ id: 'a', nazwa: 'A', obszar: [0, 0, 200, 100] }] });
  assert.equal(t.k, 5);
  assert.equal(t.parts.length, 1);
  const p = t.parts[0];
  const xs = p.kontur.map((v) => v[0]);
  const ys = p.kontur.map((v) => v[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-250, 250, -100, 100]);
  assert.ok(p.kontur.length <= 5, 'prostokat zostaje prostokatem');
  assert.equal(p.otwory.length, 1);
  const hx = p.otwory[0].map((v) => v[0]);
  assert.deepEqual([Math.min(...hx), Math.max(...hx)], [-50, 50]);
});

test('wycieta czesc jest zamknieta bryla o wlasciwej objetosci', () => {
  const t = PT.traceParts(sample(), { dlugosc: 500, parts: [{ id: 'a', nazwa: 'A', gr: 10, obszar: [0, 0, 200, 100] }] });
  const part = K.normalizePart(PT.toPart(t.parts[0]));
  const v = K.signedVolume(K.partMesh(part));
  assert.ok(Math.abs(v - (500 * 200 - 100 * 50) * 10) < 1, String(v));
});

test('lustro zdjecia i pierwszenstwo obszarow', () => {
  const t = PT.traceParts(sample(), { dlugosc: 500, flip: true, cx: 50, parts: [{ id: 'l', nazwa: 'L', obszar: [0, 0, 100, 100] }, { id: 'r', nazwa: 'R', obszar: [0, 0, 200, 100] }] });
  const lx = t.parts[0].kontur.map((v) => v[0]);
  assert.deepEqual([Math.min(...lx), Math.max(...lx)], [-250, 0], 'lewa strona zdjecia po stronie ujemnej po odbiciu');
  const rx = t.parts[1].kontur.map((v) => v[0]);
  assert.equal(Math.max(...rx), -250, 'piksele sa tylko raz');
});

test('bryla obrotowa dostaje profil i os ze zdjecia', () => {
  const img = image(100, 60, (on) => {
    rect(on, 10, 20, 50, 40);
    rect(on, 50, 25, 90, 35);
  });
  const t = PT.traceParts(img, { dlugosc: 80, cy: 30, parts: [{ id: 'a', nazwa: 'A', obrotowa: true, obszar: [0, 0, 100, 60] }] });
  const part = PT.toPart(t.parts[0]);
  assert.equal(part.ksztalt, 'obrotowa');
  assert.equal(part.y, 0);
  const n = K.normalizePart(part);
  const b = K.boundsOf(K.worldMesh(n));
  assert.ok(Math.abs(b.hi[0] - b.lo[0] - 80) < 0.5, 'dlugosc wzdluz X');
  assert.ok(Math.abs(b.hi[1] - 10) < 0.5, 'promien grubszej czesci');
  assert.ok(K.signedVolume(K.partMesh(n)) > 0);
});

test('skorupa ma sciany, obwod i wnetrze, a jej scianki sa w odleglosci grubosci', () => {
  const t = PT.traceParts(sample(), { dlugosc: 500, parts: [{ id: 'a', nazwa: 'A', gr: 30, skorupa: 3, obszar: [0, 0, 200, 100] }] });
  const part = K.normalizePart(PT.toPart({ ...t.parts[0], gr: 30, skorupa: 3, otwory: [] }));
  assert.equal(part.ksztalt, 'zespol');
  assert.equal(part.elementy.length, 3);
  const b = K.boundsOf(K.partMesh(part));
  assert.ok(Math.abs(b.hi[2] - 15) < 1e-6);
  assert.ok(Math.abs(K.signedVolume(K.partMesh(part))) < 500 * 200 * 30 * 0.5, 'jest puste w srodku');
});

test('ocena zdjecia: przedmiot przy krawedzi albo pelne tlo sa odrzucane', () => {
  assert.equal(PT.photoQuality(sample()).ok, true);
  const cut = image(100, 40, (on) => rect(on, 0, 10, 100, 30));
  assert.equal(PT.photoQuality(cut).touches, true);
  assert.equal(PT.photoQuality(cut).ok, false);
});

test('podzial zdjecia od modelu: skala 0-1 i odrzucone bledne prostokaty', async () => {
  const r = await photoParts('data:image/jpeg;base64,AAAA', 'x', { generate: async (p, s, imgs) => {
    assert.equal(imgs[0].inlineData.mimeType, 'image/jpeg');
    return { dlugosc_mm: 650, czesci: [{ nazwa: 'Lufa', box_2d: [100, 200, 300, 400], obrotowa: true, gr: 20 }, { nazwa: 'Zla', box_2d: [1, 2] }] };
  } });
  assert.equal(r.dlugosc_mm, 650);
  assert.deepEqual(r.czesci[0].box, [0.2, 0.1, 0.4, 0.3]);
  assert.equal(r.czesci.length, 1);
  await assert.rejects(photoParts('javascript:x', 'x', { generate: async () => ({}) }), /Nieprawidłowy/);
});

test('zdjecia nie mozna pobrac z sieci wewnetrznej', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1']) assert.equal(isPrivateIp(ip), false, ip);
});
