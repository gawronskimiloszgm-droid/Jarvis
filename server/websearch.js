// Darmowe wyszukiwanie w sieci - HTML-owy endpoint DuckDuckGo, bez klucza
// API i bez limitu dla normalnego uzycia. Zwraca tytul/adres/fragment dla
// kilku najlepszych wynikow, ktore wyswietlamy uzytkownikowi na ekranie
// podczas rozmowy ("antygravity" - Jarvis szuka, user widzi i przegląda).

// cheerio pulli w undici, ktore na Node 18 odwoluje sie do globalnego File
// (dostepny dopiero od Node 20) juz przy wczytywaniu modulu. Statyczny
// import zostalby wykonany przed ponizszym polyfillem (kolejnosc ewaluacji
// ESM), wiec ladujemy cheerio dynamicznie PO ustawieniu polyfilla.
import { File } from 'buffer';
if (!globalThis.File) globalThis.File = File;

const cheerio = await import('cheerio');

export async function searchWeb(query, limit = 6) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo status ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];
  $('.result.web-result').each((i, el) => {
    if (results.length >= limit) return;
    const link = $(el).find('.result__a').first();
    const title = link.text().trim();
    let href = link.attr('href') || '';
    const match = href.match(/uddg=([^&]+)/);
    if (match) href = decodeURIComponent(match[1]);
    const snippet = $(el).find('.result__snippet').first().text().trim();
    if (title && href) results.push({ title, url: href, snippet });
  });

  return results;
}
