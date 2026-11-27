// Holo-biurko: dane do paneli wiszacych nad obrazem z kamery (wiadomosci, pogoda). Wiadomosci
// z kanalu RSS Google News po polsku (dopuszczony do osobistego czytnika), pogoda z modulu pogody.
import express from 'express';
import { requireOwner } from '../core/auth.js';
import { getWeather } from '../core/weather.js';

const router = express.Router();
let newsCache = { at: 0, items: [] };

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** Pozycje kanalu RSS: tytul bez dopisku zrodla, zrodlo, link, data. */
export function parseRss(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (t) => decode((new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(m[1]) || [])[1] || '').trim();
    const source = tag('source');
    let title = tag('title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag('link');
    if (!title || !/^https:\/\//.test(link)) continue;
    items.push({ title, source, link, at: Date.parse(tag('pubDate')) || 0 });
  }
  return items;
}

// Google News bywa chwilowo niedostepny (429): wtedy kanaly polskich serwisow.
const FEEDS = [
  ['https://news.google.com/rss?hl=pl&gl=PL&ceid=PL:pl', ''],
  ['https://tvn24.pl/najnowsze.xml', 'TVN24'],
  ['https://www.rmf24.pl/fakty/feed', 'RMF24'],
  ['https://www.polsatnews.pl/rss/wszystkie.xml', 'Polsat News'],
];

export async function news({ feeds = FEEDS } = {}) {
  if (Date.now() - newsCache.at < 10 * 60000 && newsCache.items.length) return newsCache.items;
  let lastErr = null;
  for (const [url, name] of feeds) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'jarvis-personal-assistant/1.0' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`${new URL(url).host}: błąd ${res.status}`);
      const items = parseRss(await res.text()).map((i) => ({ ...i, source: i.source || name })).slice(0, 25);
      if (!items.length) throw new Error(`${new URL(url).host}: pusty kanał`);
      newsCache = { at: Date.now(), items };
      return items;
    } catch (e) {
      lastErr = e;
    }
  }
  if (newsCache.items.length) return newsCache.items; // stare lepsze niz nic
  throw new Error(`Wiadomości niedostępne (${lastErr?.message || 'brak źródeł'}).`);
}

router.get('/api/holo/news', requireOwner, async (req, res) => {
  try {
    res.json({ items: await news() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
router.get('/api/holo/weather', requireOwner, async (req, res) => {
  try {
    res.json((await getWeather(String(req.query.city || process.env.OWNER_CITY || 'Warszawa').slice(0, 60))) || { error: 'Brak pogody.' });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- glos ----------
export const HOLO_TOOLS = [
  {
    name: 'holo_biurko',
    description: 'Holo-biurko: obraz z kamery na caly ekran i panele w powietrzu sterowane dlonia (szczypniecie tworzy i chwyta panele, szybki ruch otwarta dlonia zamyka wszystkie). akcja: otworz, zamknij, panel (typ: zegar, pogoda, wiadomosci, muzyka, notatka), wyczysc (zamknij wszystkie panele).',
    parameters: { type: 'object', properties: { akcja: { type: 'string', enum: ['otworz', 'zamknij', 'panel', 'wyczysc'] }, typ: { type: 'string', enum: ['zegar', 'pogoda', 'wiadomosci', 'muzyka', 'notatka'] } }, required: ['akcja'] },
  },
];
export const HOLO_VOICE_PROMPT = '- holo_biurko: "otworz holo biurko", "pokaz wiadomosci/pogode na holo", "zamknij wszystko".';

export async function runHoloTool(name, a = {}) {
  if (name !== 'holo_biurko') return undefined;
  if (a.akcja === 'panel' && !a.typ) return { error: 'podaj typ panelu' };
  return { ok: true, klient: { action: 'holo-biurko', params: { akcja: a.akcja, typ: a.typ || '' } } };
}

export default router;
