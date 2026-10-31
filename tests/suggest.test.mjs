import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestions, simplePlan } from '../server/extras/suggest.js';
import { mergeGraph, lookup } from '../server/extras/graphmem.js';

const TODAY = '2026-11-02';
const NOW = new Date(`${TODAY}T12:00:00Z`).getTime();
const DAY = 86400000;
const ids = (r) => r.map((x) => x.id.split(':')[0]);

test('propozycje: stare zadanie tak, swieze i zrobione nie', () => {
  const r = buildSuggestions({ todos: [{ id: 'a', text: 'Stare', createdAt: NOW - 9 * DAY }, { id: 'b', text: 'Nowe', createdAt: NOW - DAY }, { id: 'c', text: 'Zrobione', done: true, createdAt: NOW - 30 * DAY }] }, NOW, TODAY, 12);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'stale:a');
  assert.match(r[0].text, /9 dni/);
  assert.deepEqual(r[0].actions.map((a) => a.op), ['todo-done', 'remind-tomorrow', 'todo-del']);
});

test('propozycje: urodziny i termin blisko, daleko nie; przelom roku', () => {
  const r = buildSuggestions({ birthdays: [{ id: 'x', name: 'Ania', date: '11-04' }, { id: 'y', name: 'Tomek', date: '05-01' }], countdowns: [{ id: 'c', name: 'Urlop', date: '2026-11-03' }, { id: 'd', name: 'Daleko', date: '2027-01-01' }] }, NOW, TODAY, 12);
  assert.deepEqual(ids(r).sort(), ['bday', 'count']);
  const ny = buildSuggestions({ birthdays: [{ id: 'z', name: 'Ola', date: '01-01' }] }, NOW, '2026-12-30', 12);
  assert.equal(ny.length, 1);
  assert.match(ny[0].text, /2 dni/);
});

test('propozycje: seria nawyku dopiero wieczorem i tylko gdy niezrobione', () => {
  const days = ['2026-10-30', '2026-10-31', '2026-11-01'];
  const h = [{ id: 'h', name: 'Bieganie', days }];
  assert.equal(buildSuggestions({ habits: h }, NOW, TODAY, 12).length, 0);
  const r = buildSuggestions({ habits: h }, NOW, TODAY, 19);
  assert.equal(r[0].id, `habit:h:${TODAY}`);
  assert.match(r[0].text, /3 dni/);
  assert.ok(!ids(buildSuggestions({ habits: [{ ...h[0], days: [...days, TODAY] }] }, NOW, TODAY, 19)).includes('habit'));
});

test('propozycje: najwazniejsze pierwsze', () => {
  const r = buildSuggestions({ todos: [{ id: 'a', text: 'x', createdAt: NOW - 8 * DAY }], birthdays: [{ id: 'b', name: 'Ania', date: '11-02' }], daily: { [TODAY]: { water: 0 } } }, NOW, TODAY, 15);
  assert.deepEqual(ids(r), ['bday', 'stale', 'water']);
});

test('plan dnia bez AI: stale punkty i zadania', () => {
  const t = simplePlan({ open: ['A', 'B', 'C', 'D'], planned: ['14:00 Spotkanie'], habits: ['Bieganie'], reminders: [], events: ['09:00 Lekarz'] });
  assert.match(t, /09:00 Lekarz/);
  assert.match(t, /A; B; C\./);
  assert.ok(!t.includes('D.'));
  assert.match(simplePlan({ open: [], planned: [], habits: [], reminders: [], events: [] }), /nic nie jest/);
});

test('graf: te same pojecia lacza sie mimo ogonkow i wielkosci liter', () => {
  let n = 0;
  const id = () => `c${++n}`;
  let g = mergeGraph({}, { concepts: [{ name: 'Łódź', type: 'miejsce', summary: 'miasto' }, { name: 'Praca', type: 'temat', summary: '' }], relations: [{ a: 'Łódź', b: 'Praca', label: 'tam pracuje' }] }, 1, id);
  assert.equal(g.concepts.length, 2);
  assert.equal(g.relations.length, 1);
  g = mergeGraph(g, { concepts: [{ name: 'lodz', type: 'miejsce', summary: 'miasto w centrum Polski' }], relations: [{ a: 'lodz', b: 'PRACA' }] }, 2, id);
  assert.equal(g.concepts.length, 2);
  const lodz = g.concepts.find((c) => c.name === 'Łódź');
  assert.equal(lodz.mentions, 2);
  assert.equal(lodz.summary, 'miasto w centrum Polski');
  assert.equal(g.relations.length, 1);
  assert.equal(g.relations[0].w, 2);
});

test('graf: smieci odrzucone, relacja do nieznanego pojecia i petla pomijane', () => {
  const g = mergeGraph({}, { concepts: [{ name: ' ' }, { name: 'X' }, { name: 'Dom', type: 'dziwny' }], relations: [{ a: 'Dom', b: 'Nieznane' }, { a: 'Dom', b: 'dom' }] }, 1, () => 'i');
  assert.deepEqual(g.concepts.map((c) => c.name), ['Dom']);
  assert.equal(g.concepts[0].type, 'temat');
  assert.equal(g.relations.length, 0);
});

test('graf: limit usuwa najrzadsze razem z ich relacjami', () => {
  const concepts = Array.from({ length: 300 }, (_, i) => ({ id: `k${i}`, name: `Pojecie ${i}`, mentions: 5, at: 1 }));
  const g = mergeGraph({ concepts, relations: [] }, { concepts: [{ name: 'Nowe', type: 'temat' }], relations: [] }, 2, () => 'nowe');
  assert.equal(g.concepts.length, 300);
  assert.ok(!g.concepts.some((c) => c.id === 'nowe'));
});

test('co wiem o: pojecie, sasiedzi i fakty; brak danych = null', () => {
  const graph = { concepts: [{ id: 'a', name: 'Tesla', summary: 'samochód', type: 'rzecz' }, { id: 'b', name: 'Garaż', summary: '' }], relations: [{ a: 'a', b: 'b', label: 'stoi w' }] };
  const r = lookup(graph, ['Tesla jest czerwona', 'Lubi kawę'], 'tesla');
  assert.equal(r.name, 'Tesla');
  assert.deepEqual(r.related, [{ name: 'Garaż', relation: 'stoi w' }]);
  assert.deepEqual(r.facts, ['Tesla jest czerwona']);
  assert.equal(lookup(graph, [], 'nieznane'), null);
  assert.deepEqual(lookup({ concepts: [] }, ['Mam psa Burka'], 'Burka').facts, ['Mam psa Burka']);
});
