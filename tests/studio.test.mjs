import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesign, cleanTopic, commonsDrawings, defaultScale, imageUrlsFromBing, imagesInHtml, isRelevant, parseLoose, planEdit, refineGroup, research, wantsResearch, CadKit } from '../server/extras/studio.js';

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
  sleep: async () => {},
  bing: async () => [],
  pageImages: async () => [],
  photos: async () => ['https://sklep.pl/foto.jpg'],
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

test('zarys: powod bledu trafia do ostrzezen, po ponowieniu podzespol sie udaje', async () => {
  let tries = 0;
  const d = deps({
    generate: async (prompt) => {
      if (prompt.includes('głównym konstruktorem')) return PLAN;
      if (prompt.includes('kontrolerem jakości')) return { czesci: [{ makro: 'sruba', nazwa: 'Śruba', x: 0, y: 500, z: 0 }] };
      if (prompt.includes('Podzespół: Kadłub')) {
        tries += 1;
        if (tries < 3) throw new Error('chwilowo przeciążony');
        return { czesci: [{ nazwa: 'Rama', ksztalt: 'pudelko', sx: 5000, sy: 200, sz: 2000, x: 0, y: 100, z: 0 }] };
      }
      throw new Error('pusta odpowiedź modelu (MAX_TOKENS)');
    },
  });
  const r = await buildDesign('x', { deps: d });
  assert.equal(tries, 3);
  assert.ok(r.projekt.czesci.some((c) => c.nazwa === 'Rama'));
  assert.ok(r.projekt.czesci.some((c) => c.grupa === 'Kadłub' && /Śruba/.test(c.nazwa)), 'druga runda dopisala srube');
  assert.match(r.ostrzezenia[0], /zawiódł przy 2 z 3.*MAX_TOKENS/);
  assert.equal(r.projekt.czesci.filter((c) => /zarys/.test(c.nazwa)).length, 2);
});

test('prompt: zakaz dzialajacej broni i dokumentacja makr sa zawsze w tresci', async () => {
  const seen = [];
  await buildDesign('x', { deps: deps({ generate: async (prompt) => {
    seen.push(prompt);
    return prompt.includes('głównym konstruktorem') ? PLAN : { czesci: [{ nazwa: 'A', ksztalt: 'pudelko' }] };
  } }) });
  assert.ok(seen.every((p) => /niedziałającą makietę/.test(p)));
  assert.ok(seen.slice(1).every((p) => /aeg_gearbox_v2/.test(p)));
});

test('zdjecia z wyszukiwarki: pelne adresy https, bez powtorek', () => {
  const html = 'x murl&quot;:&quot;https://a.pl/1.jpg&quot; y murl&quot;:&quot;http://b.pl/2.jpg&quot; z murl&quot;:&quot;https://a.pl/1.jpg&quot;';
  assert.deepEqual(imageUrlsFromBing(html), ['https://a.pl/1.jpg']);
});

test('obudowa ze zdjecia: model dostaje jej obrysy i robi tylko wnetrze', async () => {
  const plan = { ...PLAN, podzespoly: [{ ...PLAN.podzespoly[0], wnetrze: false }, { ...PLAN.podzespoly[1], wnetrze: true }, { ...PLAN.podzespoly[2], wnetrze: false }] };
  const prompts = [];
  let info = null;
  const r = await buildDesign('x', {
    deps: deps({ generate: async (p) => {
      prompts.push(p);
      if (p.includes('głównym konstruktorem')) return plan;
      if (p.includes('nazwę kanoniczną')) return { nazwa: 'Thing' };
      return { czesci: [{ nazwa: 'Mechanizm', ksztalt: 'pudelko', x: 0, y: 900, z: 0 }] };
    } }),
    waitOutline: async (i) => {
      info = i;
      return { czesci: [{ nazwa: 'Obudowa', od: [0, 0, 0], do: [100, 50, 20] }] };
    },
  });
  assert.equal(info.dlugosc_mm, 5000);
  assert.deepEqual(info.obrazy, ['https://sklep.pl/foto.jpg']);
  const parts = prompts.filter((p) => p.includes('Podzespół:'));
  assert.equal(parts.length, 1, 'tylko jeden podzespol jest w srodku');
  assert.match(parts[0], /TYLKO to, co jest w środku/);
  assert.match(parts[0], /Obudowa/);
  assert.ok(r.projekt.czesci.every((c) => c.grupa === 'Skrzydło'));
});

test('bez obrysu powstaje caly projekt z opisu', async () => {
  const r = await buildDesign('x', { deps: deps(), waitOutline: async () => null });
  assert.ok(r.projekt.czesci.some((c) => c.grupa === 'Kadłub'));
  assert.ok(r.dlugosc_mm >= 5000);
});

test('obrazy ze strony: rysunki rozstrzelone i zdjecie glowne, adresy pelne', () => {
  const html = '<meta property="og:image" content="https://s.pl/a.jpg"><img src="/x.png"><img alt="exploded view" src="/diagram.png">';
  assert.deepEqual(imagesInHtml(html, 'https://s.pl/p/1'), ['https://s.pl/diagram.png', 'https://s.pl/a.jpg']);
});

test('dopracowanie podzespolu zastepuje tylko jego czesci, w jego krokach', async () => {
  const project = { kroki: [{ nr: 2, tytul: 'B' }], czesci: [{ id: 'a', grupa: 'A', krok: 1, sx: 10, sy: 10, sz: 10 }, { id: 'b', grupa: 'B', krok: 2, sx: 10, sy: 10, sz: 10 }] };
  const ops = await refineGroup(project, 'B', 'wiecej srub', { generate: async (p) => {
    assert.match(p, /wiecej srub/);
    return { czesci: [{ nazwa: 'N1', ksztalt: 'kula', r: 2 }, { makro: 'sruba', nazwa: 'N2' }] };
  } });
  assert.deepEqual(ops.usun, ['b']);
  const next = CadKit.applyOps(CadKit.normalizeProject(project), ops);
  assert.deepEqual(next.czesci.map((c) => c.grupa), ['A', 'B', 'B']);
  assert.ok(next.czesci.slice(1).every((c) => c.krok === 2));
  await assert.rejects(refineGroup(project, 'nie ma', '', { generate: async () => ({}) }), /Nie ma takiego/);
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
