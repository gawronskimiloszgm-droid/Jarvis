import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../server/extras/holodesk.js');
const { LIFE_TOOL_NAMES, runLifeTool } = await import('../server/extras/lifevoice.js');

test('RSS: tytul bez dopisku zrodla, encje, CDATA, tylko linki https', () => {
  const xml = '<rss><channel><item><title>Wazna sprawa &quot;cytat&quot; - Onet</title><link>https://news.google.com/a</link><pubDate>Fri, 27 Nov 2026 18:00:00 GMT</pubDate><source url="https://onet.pl">Onet</source></item>'
    + '<item><title><![CDATA[Druga & trzecia]]></title><link>https://tvn24.pl/b</link></item>'
    + '<item><title>Zly link</title><link>javascript:alert(1)</link></item></channel></rss>';
  const items = H.parseRss(xml);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { title: 'Wazna sprawa "cytat"', source: 'Onet', link: 'https://news.google.com/a', at: Date.parse('Fri, 27 Nov 2026 18:00:00 GMT') });
  assert.equal(items[1].title, 'Druga & trzecia');
});

test('wiadomosci: przy bledzie pierwszego kanalu zapasowy', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('google')
    ? { ok: false, status: 429 }
    : { ok: true, text: async () => '<item><title>Z zapasu</title><link>https://tvn24.pl/x</link></item>' });
  try {
    const items = await H.news({ feeds: [['https://news.google.com/rss', ''], ['https://tvn24.pl/najnowsze.xml', 'TVN24']] });
    assert.deepEqual(items.map((i) => [i.title, i.source]), [['Z zapasu', 'TVN24']]);
  } finally {
    globalThis.fetch = real;
  }
});

test('narzedzie glosowe holo_biurko', async () => {
  assert.ok(LIFE_TOOL_NAMES.includes('holo_biurko'));
  assert.deepEqual((await runLifeTool('holo_biurko', { akcja: 'panel', typ: 'wiadomosci' })).klient, { action: 'holo-biurko', params: { akcja: 'panel', typ: 'wiadomosci' } });
  assert.match((await runLifeTool('holo_biurko', { akcja: 'panel' })).error, /typ/);
});
