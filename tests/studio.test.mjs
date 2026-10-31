import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesign, cleanTopic, commonsDrawings, defaultScale, isRelevant, parseLoose, planEdit, research, wantsResearch, CadKit } from '../server/extras/studio.js';

const PLAN = {
  nazwa: 'Replika testowa',
  opis: 'x',
  realny: true,
  uwagi: 'Przybliżenia.',
  wymiary_mm: { dlugosc: 5000, szerokosc: 2000, wysokosc: 1000 },
  fakty: ['Długość 5 m'],
  podzespoly: [
    { nazwa: 'Kadłub', srodek: [0, 500, 0], rozmiar: [5000, 1000, 2000], kolor: '#ff0000', ile_czesci: 5, z_planow: true, kroki: [{ tytul: 'Rama' }, { tytul: 'Poszycie' }] },
    { nazwa: 'Skrzydło', srodek: [0, 900, 0], rozmiar: [800, 200, 800], ile_czesci: 3, kroki: [{ tytul: 'Mocowanie' }] },
    { nazwa: 'Ogon', srodek: [2600, 500, 0], rozmiar: [400, 400, 400], ile_czesci: 3, kroki: [{ tytul: 'Ogon' }] },
  ],
};
const deps = (over = {}) => ({
  search: { searchWithContent: async () => ({ results: [{ title: 'Plany', url: 'https://przyklad.pl/plany' }], content: [{ title: 'Plany', url: 'https://przyklad.pl/plany', text: 'dlugosc 5 m '.repeat(40) }] }), searchWeb: async () => [{ title: 'Inne', url: 'https://przyklad.pl/inne' }] },
  wikipedia: async (t, lang) => (lang === 'en' ? { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/X', text: 'tekst' } : null),
  commons: async () => [{ tytul: 'Rysunek', url: 'https://upload.wikimedia.org/x.png', strona: 'https://commons.wikimedia.org/wiki/File:X.png', licencja: 'CC BY 4.0' }],
  image: async () => null,
  generate: async (prompt) => {
    if (prompt.includes('głównym konstruktorem')) return PLAN;
    if (prompt.includes('Podzespół: Kadłub')) return { czesci: [{ nazwa: 'Rama', ksztalt: 'pudelko', sx: 5000, sy: 200, sz: 2000, x: 0, y: 100, z: 0, etap: 1, zrodlo: 'plany' }, { nazwa: 'Poszycie', ksztalt: 'loft', przekroje: [{ p: -400, a: 900, b: 900 }, { p: 400, a: 500, b: 500 }], x: 0, y: 600, z: 0, etap: 2 }] };
    if (prompt.includes('Podzespół: Skrzydło')) return { czesci: [{ nazwa: 'Skrzydło', ksztalt: 'pudelko', sx: 800, sy: 40, sz: 800, x: 300, y: 900, z: 0, lustro: 'x' }] };
    throw new Error('model padl');
  },
  ...over,
});

test('rozpoznawanie prosby o replike i temat do wyszukania', () => {
  assert.equal(wantsResearch('pokaz budowe repliki Sokola Millennium'), true);
  assert.equal(wantsResearch('znajdz plany budowy mostu'), true);
  assert.equal(wantsResearch('zaprojektuj podstawke pod kubek'), false);
  assert.equal(cleanTopic('pokaż mi budowę repliki Saturn V'), 'Saturn V');
});

test('tytul musi dotyczyc tematu: Bank Millennium to nie Millennium Falcon', () => {
  assert.equal(isRelevant('Millennium Falcon', 'Millennium Falcon'), true);
  assert.equal(isRelevant('Saturn V (rocket) cutaway', 'Saturn V'), true);
  assert.equal(isRelevant('Bank Millennium', 'Millennium Falcon'), false);
  assert.equal(isRelevant('Floppy disk internal diagram', 'Saturn V'), false);
  assert.equal(isRelevant('Sokół Millennium', 'sokol millennium'), true);
});

test('wyszukiwanie po nazwie kanonicznej, rysunki nie na temat odpadaja', async () => {
  const asked = [];
  const d = deps({
    generate: async (prompt) => {
      if (prompt.includes('nazwę kanoniczną')) return { nazwa: 'Millennium Falcon' };
      return deps().generate(prompt);
    },
    wikipedia: async (t) => {
      asked.push(t);
      return null;
    },
  });
  await buildDesign('replika Sokoła Millennium', { szukaj: true, deps: d });
  assert.deepEqual(asked, ['Millennium Falcon', 'Millennium Falcon']);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ query: { pages: { 1: { title: 'File:Floppy disk diagram.png', imageinfo: [{ thumburl: 'https://x/a.png', descriptionurl: 'https://x/a' }] }, 2: { title: 'File:Millennium Falcon cutaway.jpg', imageinfo: [{ thumburl: 'https://x/b.jpg', descriptionurl: 'https://x/b', extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } } }] } } } }));
  try {
    const r = await commonsDrawings('Millennium Falcon');
    assert.deepEqual(r.map((p) => p.url), ['https://x/b.jpg']);
    assert.equal(r[0].licencja, 'CC BY 4.0');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(research);
});

test('skala repliki miesci sie na drukarce, maly przedmiot zostaje 1:1', () => {
  assert.equal(defaultScale([120, 80, 40]), 1);
  assert.equal(defaultScale([110600, 10100, 10100]), 500);
  assert.ok(110600 / defaultScale([110600]) <= 250);
});

test('uciety JSON z listy czesci da sie uratowac', () => {
  const r = parseLoose('{"czesci":[{"nazwa":"a","x":1},{"nazwa":"b","x":2},{"nazwa":"c","x"');
  assert.equal(r.czesci.length, 2);
  assert.equal(parseLoose('```json\n{"a":1}\n```').a, 1);
  assert.throws(() => parseLoose('nie json'));
});

test('replika: szuka, zapisuje zrodla, numeruje kroki, zarys gdy podzespol zawiedzie', async () => {
  const stages = [];
  const r = await buildDesign('replika testowa', { szukaj: true, deps: deps(), report: (s, e, p) => stages.push([s, p]) });
  const pr = r.projekt;
  assert.deepEqual([...new Set(stages.map((s) => s[0]))], ['szukam', 'planuje', 'buduje']);
  assert.ok(stages.every((s, i) => !i || s[1] >= stages[i - 1][1]), 'postep nie cofa sie');
  assert.ok(pr.zrodla.some((z) => z.url.includes('wikipedia')));
  assert.equal(pr.plany[0].licencja, 'CC BY 4.0');
  assert.deepEqual(pr.kroki.map((k) => k.nr), [1, 2, 3, 4]);
  assert.equal(pr.czesci.find((c) => c.nazwa === 'Rama').krok, 1);
  assert.equal(pr.czesci.find((c) => c.nazwa === 'Poszycie').krok, 2);
  assert.equal(pr.czesci.filter((c) => c.grupa === 'Skrzydło').length, 2, 'lustro');
  assert.equal(pr.czesci.find((c) => c.grupa === 'Ogon').nazwa, 'Ogon (zarys)');
  assert.match(pr.uwagi, /Nie udało się rozpisać: Ogon/);
  assert.equal(pr.czesci.find((c) => c.nazwa === 'Rama').zrodlo, 'plany');
  assert.equal(pr.czesci.find((c) => c.grupa === 'Skrzydło').zrodlo, 'szacunek', 'wymiary spoza planow nie udaja planow');
  assert.ok(pr.skala >= 20);
  assert.equal(new Set(pr.czesci.map((c) => c.id)).size, pr.czesci.length);
  assert.ok(pr.czesci.every((c) => CadKit.partMesh(c).length > 0));
});

test('bez szukania nie dotyka sieci', async () => {
  const d = deps({ search: { searchWithContent: () => assert.fail('siec'), searchWeb: () => assert.fail('siec') }, wikipedia: () => assert.fail('siec'), commons: () => assert.fail('siec') });
  const r = await buildDesign('podstawka', { szukaj: false, deps: d });
  assert.equal(r.projekt.zrodla.length, 0);
});

test('awaria szukania nie przerywa projektu, pusty plan to jasny blad', async () => {
  const d = deps({ wikipedia: async () => { throw new Error('x'); }, commons: async () => { throw new Error('x'); }, search: { searchWithContent: async () => { throw new Error('x'); }, searchWeb: async () => { throw new Error('x'); } } });
  assert.ok((await buildDesign('cos', { szukaj: true, deps: d })).projekt.czesci.length);
  await assert.rejects(buildDesign('cos', { deps: deps({ generate: async () => ({ podzespoly: [] }) }) }), /podzespoły/);
});

test('edycja: nieznane id z modelu sa odrzucane', async () => {
  const project = { czesci: [{ id: 'a', nazwa: 'A' }] };
  const ops = await planEdit(project, 'usun a', { generate: async () => ({ co_zmieniono: 'ok', usun: ['a', 'duch'], zmien: [{ id: 'duch', sx: 1 }, { id: 'a', sx: 90 }], dodaj: [{ nazwa: 'N', ksztalt: 'kula', r: 3 }] }) });
  assert.deepEqual(ops.usun, ['a']);
  assert.equal(ops.zmien.length, 1);
  const next = CadKit.applyOps(CadKit.normalizeProject(project), ops);
  assert.equal(next.czesci.length, 1);
  assert.equal(next.czesci[0].nazwa, 'N');
});
