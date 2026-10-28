import test from 'node:test';
import assert from 'node:assert/strict';
import { LIFE_TOOLS, LIFE_TOOL_NAMES, LIFE_TAGS, LIFE_TAG_PROMPT } from '../server/extras/lifevoice.js';

test('narzedzia glosowe zycia: unikalne nazwy i poprawne schematy', () => {
  assert.equal(new Set(LIFE_TOOL_NAMES).size, LIFE_TOOLS.length);
  for (const t of LIFE_TOOLS) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 15, t.name);
    assert.equal(t.parameters.type, 'object');
    for (const r of t.parameters.required || []) assert.ok(t.parameters.properties[r], `${t.name}: brak pola ${r}`);
  }
});

test('znaczniki czatu: parsowanie wielu znacznikow w jednej odpowiedzi', () => {
  const text = 'Gotowe, sir. [ZAKUPY: mleko, chleb] oraz [WODA: 2] i [NASTROJ: 4]';
  const grab = (re) => {
    re.lastIndex = 0;
    return [...text.matchAll(re)].map((m) => m[1]);
  };
  assert.deepEqual(grab(LIFE_TAGS.ZAKUPY), ['mleko, chleb']);
  assert.deepEqual(grab(LIFE_TAGS.WODA), ['2']);
  assert.deepEqual(grab(LIFE_TAGS.NASTROJ), ['4']);
  assert.deepEqual(grab(LIFE_TAGS.DZIENNIK), []);
  for (const tag of Object.keys(LIFE_TAGS)) assert.ok(LIFE_TAG_PROMPT.includes(`[${tag}:`), `prompt nie opisuje ${tag}`);
});
