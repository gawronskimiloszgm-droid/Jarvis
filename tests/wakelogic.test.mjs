import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mod = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/wakelogic.js', import.meta.url), 'utf8'))(mod);
const W = mod.exports;
const res = (conf, start = 1, end = 1.5) => ({ text: 'jarvis', result: [{ word: 'jarvis', conf, start, end }] });

test('slowo: pewnosc ponizej progu odrzucona, powyzej przyjeta', () => {
  assert.equal(W.accept(res(0.95)).ok, true);
  assert.equal(W.accept(res(0.5)).ok, false);
  assert.equal(W.accept(res(0.7), { threshold: 0.6 }).ok, true);
  assert.equal(W.accept({ text: '[unk]' }).ok, false);
  assert.equal(W.accept({ text: '' }).ok, false);
});

test('slowo: muzyka podnosi prog, mowa Jarvisa blokuje, dziwna dlugosc odrzucona', () => {
  assert.equal(W.accept(res(0.84), { threshold: 0.8 }).ok, true);
  assert.equal(W.accept(res(0.84), { threshold: 0.8, music: true }).ok, false);
  assert.equal(W.accept(res(0.99), { speaking: true }).ok, false);
  assert.equal(W.accept(res(0.99, 1, 1.05)).ok, false);
  assert.equal(W.accept(res(0.99, 1, 3.5)).ok, false);
});

test('slowo: silnik bez szczegolow dziala jak dotad; korekta progu w granicach', () => {
  assert.equal(W.accept({ text: 'hey jarvis' }).ok, true);
  assert.equal(W.adjust(0.8, 'false-alarm'), 0.83);
  assert.equal(W.adjust(0.8, 'miss'), 0.77);
  assert.equal(W.adjust(0.98, 'false-alarm'), 0.98);
  assert.equal(W.adjust(0.5, 'miss'), 0.5);
});
