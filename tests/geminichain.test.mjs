import test from 'node:test';
import assert from 'node:assert/strict';
import { withModel, MODEL_CHAIN, isOverloaded } from '../server/core/geminiChain.js';

const apiError = (status, message = `{"error":{"code":${status}}}`) => Object.assign(new Error(message), { status });

test('model niedostepny (404) nie konczy lancucha', async () => {
  const seen = [];
  const out = await withModel(async (m) => {
    seen.push(m);
    if (seen.length === 1) throw apiError(404);
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.equal(seen.length, 2);
});

test('404 ostatniego modelu nie przykrywa limitu z wczesniejszych', async () => {
  let n = 0;
  await assert.rejects(
    withModel(async () => {
      n++;
      throw apiError(n === MODEL_CHAIN.length ? 404 : 429);
    }),
    (e) => {
      assert.match(e.message, /limit/i);
      assert.equal(e.status, 429);
      assert.ok(isOverloaded(e));
      return true;
    },
  );
  assert.equal(n, MODEL_CHAIN.length);
});

test('uzytkownik nie dostaje surowego JSON-a', async () => {
  await assert.rejects(withModel(async () => { throw apiError(404); }), (e) => {
    assert.doesNotMatch(e.message, /[{}]/);
    assert.equal(e.status, 404);
    return true;
  });
  await assert.rejects(withModel(async () => { throw apiError(503); }), /przeciążone/);
});

test('zly klucz nie schodzi po lancuchu i zostaje bez zmian', async () => {
  const bad = apiError(403, 'API key not valid');
  let n = 0;
  await assert.rejects(withModel(async () => { n++; throw bad; }), (e) => e === bad);
  assert.equal(n, 1);
});

test('canRetry zatrzymuje schodzenie, gdy czesc odpowiedzi juz poszla', async () => {
  let n = 0;
  await assert.rejects(withModel(async () => { n++; throw apiError(503); }, () => false), /przeciążone/);
  assert.equal(n, 1);
});

test('na liscie nie ma modelu wycofanego dla nowych kont', () => {
  assert.ok(!MODEL_CHAIN.includes('gemini-2.5-flash'));
  assert.equal(new Set(MODEL_CHAIN).size, MODEL_CHAIN.length);
});
