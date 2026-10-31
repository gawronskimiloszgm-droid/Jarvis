import test from 'node:test';
import assert from 'node:assert/strict';
import { plFix, promptFix, fixDescriptions } from '../server/core/pltext.js';

test('przywraca polskie znaki i zachowuje wielkosc liter', () => {
  assert.equal(plFix('Wszystkie systemy dzialaja prawidlowo, sir.'), 'Wszystkie systemy działają prawidłowo, sir.');
  assert.equal(plFix('Moze bedzie lepiej, sa dwie opcje.'), 'Może będzie lepiej, są dwie opcje.');
  assert.equal(plFix('ZAKLADKI'), 'ZAKŁADKI');
  assert.equal(plFix('Zakladki'), 'Zakładki');
  assert.equal(plFix('już działa'), 'już działa');
});

test('"ze" zalezy od nastepnego slowa', () => {
  assert.equal(plFix('Mysle, ze to dziala.'), 'Myślę, że to działa.');
  assert.equal(plFix('Ze mna dobrze.'), 'Ze mną dobrze.');
});

test('nie rusza identyfikatorow, adresow i slow wieloznacznych', () => {
  const s = '[AKCJA: otworz-aplikacje | notepad] dodaj_zadanie plik.js https://moze.pl/sciezka J.A.R.V.I.S.';
  assert.equal(plFix(s), s);
  assert.equal(plFix('kot ma pana za nos, sad i las'), 'kot ma pana za nos, sad i las');
  for (const w of ['function', 'return', 'const', 'value', 'token', 'error', 'system', 'model', 'event', 'data', 'user']) assert.equal(plFix(w), w);
});

test('prompt: znaczniki i nazwy narzedzi bez zmian, regula jezyka dopisana', () => {
  const out = promptFix('[ZAPAMIETAJ: fakt] zapamietaj: moze dzialac', new Set(['zapamietaj']));
  assert.ok(out.startsWith('[ZAPAMIETAJ: fakt] zapamietaj: może działać'), out.slice(0, 60));
  assert.match(out, /pełnymi polskimi znakami/);
});

test('deklaracje narzedzi: poprawiane tylko opisy', () => {
  const d = fixDescriptions([{ name: 'sprawdz_pogode', description: 'Sprawdz pogode', parameters: { type: 'object', properties: { co: { type: 'string', enum: ['moze'], description: 'Moze' } } } }]);
  assert.equal(d[0].name, 'sprawdz_pogode');
  assert.equal(d[0].description, 'Sprawdź pogodę');
  assert.deepEqual(d[0].parameters.properties.co.enum, ['moze']);
  assert.equal(d[0].parameters.properties.co.description, 'Może');
});
