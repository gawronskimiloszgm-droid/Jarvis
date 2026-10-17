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

// Pobiera i oczyszcza tresc strony, zeby model mial z czego ODPOWIEDZIEC,
// a nie tylko odeslac do listy linkow. To roznica miedzy "zobacz na
// ekranie" (bezuzyteczne z brudnymi rekami) a konkretna odpowiedzia.
async function fetchPageText(url, maxChars = 3000) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
    });
    if (!res.ok) return '';
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) return '';

    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, noscript, iframe, svg, form').remove();

    const root = $('article').first().length ? $('article').first() : $('body');
    const text = root
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return ''; // strona zablokowala, przekroczyla czas albo padla - idziemy dalej
  } finally {
    clearTimeout(timeout);
  }
}

// Wyszukiwanie "z odpowiedzia": obok listy wynikow zwraca tresc kilku
// pierwszych stron. Pobieramy je rownolegle i z krotkim limitem czasu,
// zeby nie wydluzac rozmowy - jesli ktoras nie odpowie, po prostu jej
// nie ma, zamiast blokowac calosc.
export async function searchWithContent(query, pages = 2) {
  const results = await searchWeb(query, 6);
  if (!results.length) return { results, content: [] };

  const picked = results.slice(0, pages);
  const texts = await Promise.all(picked.map((r) => fetchPageText(r.url)));

  const content = picked
    .map((r, i) => ({ title: r.title, url: r.url, text: texts[i] }))
    .filter((c) => c.text.length > 200);

  return { results, content };
}
