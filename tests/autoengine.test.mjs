import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mod = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/autoengine.js', import.meta.url), 'utf8'))(mod);
const E = mod.exports;

test('warunki: rodzaj zdarzenia, tekst bez ogonkow, czas i dni', () => {
  assert.equal(E.matches({ type: 'focusEnd' }, { type: 'activity', kind: 'skupienie', text: 'x' }), true);
  assert.equal(E.matches({ type: 'focusEnd' }, { type: 'activity', kind: 'minutnik', text: 'x' }), false);
  assert.equal(E.matches({ type: 'back' }, { type: 'activity', kind: 'obecnosc', text: 'Użytkownik wrócił' }), true);
  assert.equal(E.matches({ type: 'away' }, { type: 'activity', kind: 'obecnosc', text: 'Użytkownik wrócił' }), false);
  assert.equal(E.matches({ type: 'activity', contains: 'zażółć' }, { type: 'activity', kind: 'dane', text: 'ZAZOLC gesla' }), true);
  assert.equal(E.matches({ type: 'module', contains: 'dziennik' }, { type: 'activity', kind: 'modul', text: 'otworzył moduł "Dziennik"' }), true);
  assert.equal(E.matches({ type: 'start' }, { type: 'start' }), true);
  assert.equal(E.matches({ type: 'start' }, { type: 'tick', hm: '08:00', dow: 1 }), false);
  const t = { type: 'time', at: '08:00', days: [1, 2] };
  assert.equal(E.matches(t, { type: 'tick', hm: '08:00', dow: 1 }), true);
  assert.equal(E.matches(t, { type: 'tick', hm: '08:00', dow: 3 }), false);
  assert.equal(E.matches(t, { type: 'tick', hm: '08:01', dow: 1 }), false);
  assert.equal(E.matches({ type: 'time', at: '08:00' }, { type: 'tick', hm: '08:00', dow: 6 }), true);
  assert.equal(E.matches({ type: 'nieznany' }, { type: 'activity', kind: 'x', text: 'y' }), false);
});

test('wybor regul: wylaczona, odstep i brak zapetlenia', () => {
  const rules = [{ id: 'a', when: { type: 'activity', contains: 'x' } }, { id: 'b', on: false, when: { type: 'activity', contains: 'x' } }, { id: 'c', cooldown: 0, when: { type: 'activity', contains: 'x' } }];
  const ev = { type: 'activity', kind: 'dane', text: 'x' };
  assert.deepEqual(E.pick(rules, ev, {}, 1000000).map((r) => r.id), ['a', 'c']);
  assert.deepEqual(E.pick(rules, ev, { a: 1000000 - 30000 }, 1000000).map((r) => r.id), ['c']);
  assert.deepEqual(E.pick(rules, { ...ev, kind: 'automatyzacja' }, {}, 1000000), [], 'reguly nie uruchamiaja regul');
});

test('opis reguly po polsku', () => {
  assert.match(E.describe({ type: 'time', at: '07:30', days: [1, 5] }), /07:30.*pn, pt/);
  assert.match(E.describe({ type: 'module', contains: 'Notatki' }), /Notatki/);
});
