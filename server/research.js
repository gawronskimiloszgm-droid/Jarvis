// Osiem funkcji z domeny "wiedza/research/web" (#131-134, #136-139), poza
// biblioteka dokumentow/RAG ktora jest w server/knowledgeBase.js (#135/#140).
//
// Wszystkie funkcje wyszukujace w sieci uzywaja WYLACZNIE istniejacego
// searchWeb() z server/websearch.js (patrz import ponizej) - zaden wlasny
// klient wyszukiwarki nie jest tu pisany.

import { Router } from 'express';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { nanoid } from 'nanoid';
import { withModel } from './geminiChain.js';
import { requireOwner } from './auth.js';
import { searchWeb } from './websearch.js';
import * as memory from './memory.js';
import * as bus from './bus.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// cheerio pulli undici, ktore na Node 18 odwoluje sie do globalnego File
// (dostepny dopiero od Node 20) juz przy wczytywaniu modulu - identyczny
// problem i identyczne obejscie jak w server/websearch.js. Import ./websearch.js
// powyzej juz ustawia ten polyfill (top-level await tamtego modulu konczy sie
// PRZED wykonaniem reszty tego pliku), ale ustawiamy go tez tutaj wprost,
// zeby ten plik nie polegal cicho na kolejnosci importow.
import { File } from 'buffer';
if (!globalThis.File) globalThis.File = File;
const cheerio = await import('cheerio');

// --- wspolny helper: pobranie i oczyszczenie tresci zwyklej strony HTML ---
// Wzorowany na fetchPageText() z websearch.js (ktore nie jest eksportowane),
// tylko z wiekszym limitem znakow - tu chodzi o cala tresc artykulu do
// streszczenia/monitorowania, nie o kilka zdan kontekstu do odpowiedzi.
async function fetchArticleText(url, maxChars = 12000) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
    });
    if (!res.ok) throw new Error(`Strona zwrocila status ${res.status}.`);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) {
      throw new Error('To nie jest strona HTML (jesli to plik PDF, uzyj podsumowania URL z rozszerzeniem .pdf).');
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, noscript, iframe, svg, form, aside').remove();

    const root = $('article').first().length ? $('article').first() : $('body');
    const text = root.text().replace(/\s+/g, ' ').trim();
    return text.slice(0, maxChars);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonSafe(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ============================================================
// #131 - glebsze wieloźrodlowe badanie tematu
// ============================================================

const QUERY_VARIANTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    warianty: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['warianty'],
};

export async function researchTopic(topic) {
  const t = String(topic || '').trim();
  if (!t) throw new Error('Podaj temat do zbadania.');

  const variantsRes = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Uzytkownik chce zbadac temat: "${t}". Wygeneruj 3-4 rozne zapytania wyszukiwania ` +
        '(rozne katy/aspekty tematu, po polsku), ktore razem daja szeroki obraz tematu. ' +
        'Same zapytania, bez wyjasnien i numeracji.',
      config: { responseMimeType: 'application/json', responseSchema: QUERY_VARIANTS_SCHEMA },
    })
  );
  const variantsParsed = parseJsonSafe(variantsRes.text, { warianty: [t] });
  let variants = (Array.isArray(variantsParsed.warianty) ? variantsParsed.warianty : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!variants.length) variants = [t];

  const resultSets = await Promise.all(variants.map((q) => searchWeb(q, 5).catch(() => [])));
  const byUrl = new Map();
  for (const r of resultSets.flat()) {
    if (r.url && !byUrl.has(r.url)) byUrl.set(r.url, r);
  }
  const allResults = Array.from(byUrl.values()).slice(0, 20);

  if (!allResults.length) {
    return { topic: t, variants, answer: 'Nie znalazlem zadnych wynikow wyszukiwania dla tego tematu.', sources: [] };
  }

  const listing = allResults
    .map((r, i) => `${i + 1}. ${r.title} (${r.url})\n   ${String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');

  const synthRes = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        'Na podstawie ponizszych wynikow wyszukiwania (z kilku roznych zapytan) napisz spojna, rzeczowa ' +
        `odpowiedz po polsku na temat: "${t}". Cytuj zrodla w tekscie jako [1], [2] itd., odpowiadajace ` +
        'numeracji ponizej. Jesli wyniki sa ze soba sprzeczne, zaznacz to zamiast wygladzac.\n\n' +
        listing,
    })
  );

  return {
    topic: t,
    variants,
    answer: (synthRes.text || '').trim(),
    sources: allResults.map((r, i) => ({ n: i + 1, title: r.title, url: r.url })),
  };
}

// ============================================================
// #132 - automatyczny fact-checking twierdzen
// ============================================================

const VERDICT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    werdykt: { type: Type.STRING, enum: ['prawda', 'falsz', 'niejednoznaczne'] },
    uzasadnienie: { type: Type.STRING },
    pewnosc: { type: Type.NUMBER },
  },
  required: ['werdykt', 'uzasadnienie'],
};

export async function factCheck(claim) {
  const c = String(claim || '').trim();
  if (!c) throw new Error('Podaj twierdzenie do sprawdzenia.');

  const results = await searchWeb(c, 8);
  if (!results.length) {
    return {
      claim: c,
      werdykt: 'niejednoznaczne',
      uzasadnienie: 'Nie znalazlem zadnych zrodel w sieci dotyczacych tego twierdzenia.',
      pewnosc: 0,
      sources: [],
    };
  }

  const listing = results
    .map((r, i) => `${i + 1}. ${r.title} (${r.url})\n   ${String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Sprawdz wiarygodnosc nastepujacego twierdzenia na podstawie wynikow wyszukiwania ponizej:\n"${c}"\n\n` +
        `Wyniki wyszukiwania:\n${listing}\n\n` +
        'Ocen, czy zrodla potwierdzaja twierdzenie, mu zaprzeczaja, czy sa niejednoznaczne. ' +
        'Nie wnioskuj poza tym, co faktycznie wynika z tekstu wynikow powyzej.',
      config: { responseMimeType: 'application/json', responseSchema: VERDICT_SCHEMA },
    })
  );

  const parsed = parseJsonSafe(res.text, {
    werdykt: 'niejednoznaczne',
    uzasadnienie: 'Nie udalo sie przetworzyc oceny modelu.',
    pewnosc: 0,
  });

  return {
    claim: c,
    werdykt: parsed.werdykt || 'niejednoznaczne',
    uzasadnienie: parsed.uzasadnienie || '',
    pewnosc: Number.isFinite(parsed.pewnosc) ? Math.max(0, Math.min(1, parsed.pewnosc)) : null,
    sources: results.slice(0, 8).map((r) => ({ title: r.title, url: r.url })),
  };
}

// ============================================================
// #133 - sledzenie cen produktu w kilku sklepach
// ============================================================

const PRICE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cena_orientacyjna: { type: Type.STRING },
    pewnosc: { type: Type.NUMBER },
    uwaga: { type: Type.STRING },
  },
};

async function extractPriceFromResults(sklep, results) {
  if (!results.length) {
    return { sklep, cena_orientacyjna: null, pewnosc: 0, uwaga: 'Brak wynikow wyszukiwania.', sources: [] };
  }
  const listing = results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 250)}`)
    .join('\n');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Ponizej wyniki wyszukiwania dla zapytania o produkt w sklepie "${sklep}". Wyciagnij PRZYBLIZONA cene, ` +
        'jesli da sie ja wywnioskowac z samych tytulow/fragmentow (nie masz dostepu do zawartosci strony). ' +
        'Jesli nie widac ceny, ustaw cena_orientacyjna na null i pewnosc na 0.\n\n' +
        listing,
      config: { responseMimeType: 'application/json', responseSchema: PRICE_SCHEMA },
    })
  );

  const parsed = parseJsonSafe(res.text, { cena_orientacyjna: null, pewnosc: 0, uwaga: null });
  return {
    sklep,
    cena_orientacyjna: parsed.cena_orientacyjna || null,
    pewnosc: Number.isFinite(parsed.pewnosc) ? Math.max(0, Math.min(1, parsed.pewnosc)) : 0,
    uwaga: parsed.uwaga || null,
    sources: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url })),
  };
}

/**
 * UWAGA (do raportu i do kazdego kto to bedzie utrzymywal): to HEURYSTYKA
 * oparta na tytulach/fragmentach z wyszukiwarki, NIE scraping konkretnych
 * stron sklepow. Dokladnosc zalezy calkowicie od tego, co DuckDuckGo pokaze
 * w wyniku - traktowac jako orientacyjny sygnal, nie zrodlo prawdy do
 * automatycznych decyzji zakupowych.
 */
export async function trackPrices(produkt, sklepy) {
  const p = String(produkt || '').trim();
  const stores = Array.isArray(sklepy) ? sklepy.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (!p) throw new Error('Podaj nazwe produktu.');
  if (!stores.length) throw new Error('Podaj przynajmniej jeden sklep.');

  const rows = await Promise.all(
    stores.map(async (sklep) => {
      const results = await searchWeb(`${p} ${sklep} cena`, 5).catch(() => []);
      return extractPriceFromResults(sklep, results);
    })
  );

  return { produkt: p, sklepy: rows };
}

// ============================================================
// #134 - podsumowanie dlugiego artykulu/PDF-a z linku
// ============================================================

// Sprawdzane LENIWIE i tylko raz (per uruchomienie procesu) - w tym
// worktree pdf-parse NIE jest zainstalowane (brak w node_modules), wiec
// dynamiczny import ma sie nie udac za kazdym razem bez sensu. Gdy ktos
// doinstaluje zaleznosc, zadziala bez zmiany kodu.
let pdfParseFn = null;
let pdfParseChecked = false;
async function getPdfParse() {
  if (pdfParseChecked) return pdfParseFn;
  pdfParseChecked = true;
  try {
    const mod = await import('pdf-parse');
    pdfParseFn = mod.default || mod;
  } catch {
    pdfParseFn = null;
  }
  return pdfParseFn;
}

export async function summarizeUrl(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) throw new Error('Podaj pelny adres URL (http/https).');

  let text = '';
  let sourceType = 'html';

  if (/\.pdf(\?|#|$)/i.test(clean)) {
    sourceType = 'pdf';
    const pdfParse = await getPdfParse();
    if (!pdfParse) {
      throw new Error(
        'Podsumowanie PDF wymaga doinstalowania zaleznosci "pdf-parse" (npm install pdf-parse) - ' +
          'nie jest ona obecnie dostepna w node_modules tego projektu.'
      );
    }
    const res = await fetch(clean);
    if (!res.ok) throw new Error(`Nie udalo sie pobrac pliku PDF (status ${res.status}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const parsed = await pdfParse(buffer);
    text = String(parsed.text || '').replace(/\s+/g, ' ').trim();
  } else {
    text = await fetchArticleText(clean, 12000);
  }

  if (!text || text.length < 200) {
    throw new Error('Nie udalo sie wyciagnac wystarczajacej tresci ze strony/pliku do streszczenia.');
  }

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Streszcz ponizszy ${sourceType === 'pdf' ? 'dokument PDF' : 'artykul'} po polsku w 4-8 zdaniach i ` +
        'wypunktuj najwazniejsze fakty/wnioski. Nie dodawaj wlasnych opinii, trzymaj sie tresci.\n\n' +
        text.slice(0, 15000),
    })
  );

  return { url: clean, sourceType, summary: (res.text || '').trim(), extractedChars: text.length };
}

// ============================================================
// #136 - generowanie porownan produktow
// ============================================================

const COMPARISON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tabela: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          produkt: { type: Type.STRING },
          plusy: { type: Type.ARRAY, items: { type: Type.STRING } },
          minusy: { type: Type.ARRAY, items: { type: Type.STRING } },
          cena_orientacyjna: { type: Type.STRING },
          podsumowanie: { type: Type.STRING },
        },
        required: ['produkt', 'plusy', 'minusy'],
      },
    },
  },
  required: ['tabela'],
};

export async function compareProducts(produkty) {
  const items = Array.isArray(produkty) ? produkty.map((p) => String(p || '').trim()).filter(Boolean) : [];
  if (items.length < 2) throw new Error('Podaj co najmniej dwa produkty do porownania.');

  const perProduct = await Promise.all(
    items.map(async (name) => ({ name, results: await searchWeb(`${name} recenzja opinie cena`, 5).catch(() => []) }))
  );

  const context = perProduct
    .map(
      ({ name, results }) =>
        `## ${name}\n` +
        (results.length
          ? results
              .map((r, i) => `${i + 1}. ${r.title}\n   ${String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 250)}`)
              .join('\n')
          : '(brak wynikow wyszukiwania)')
    )
    .join('\n\n');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        'Na podstawie ponizszych wynikow wyszukiwania przygotuj tabele porownawcza dla produktow: ' +
        `${items.join(', ')}.\n` +
        'Dla kazdego: liste plusow, liste minusow, orientacyjna cene (jesli da sie wywnioskowac z tekstu, ' +
        'w przeciwnym razie napisz "brak danych"), krotkie podsumowanie. Badz konkretny, nie ogolnikowy.\n\n' +
        context,
      config: { responseMimeType: 'application/json', responseSchema: COMPARISON_SCHEMA },
    })
  );

  const parsed = parseJsonSafe(res.text, { tabela: [] });
  return { produkty: items, tabela: Array.isArray(parsed.tabela) ? parsed.tabela : [] };
}

// ============================================================
// #137 - monitoring zmian na wybranej stronie
// ============================================================

function pagesStore() {
  const data = memory.load();
  if (!Array.isArray(data.watchedPages)) data.watchedPages = [];
  return data;
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function listWatchedPages() {
  return pagesStore().watchedPages.map(({ id, url, addedAt, lastCheckedAt, lastChangedAt, lastLength }) => ({
    id,
    url,
    addedAt,
    lastCheckedAt,
    lastChangedAt,
    lastLength,
  }));
}

export function addWatchedPage(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) throw new Error('Podaj pelny adres URL (http/https).');

  const data = pagesStore();
  const existing = data.watchedPages.find((p) => p.url === clean);
  if (existing) return existing;

  const entry = {
    id: nanoid(10),
    url: clean,
    addedAt: Date.now(),
    lastCheckedAt: null,
    lastChangedAt: null,
    lastHash: null,
    lastLength: null,
  };
  data.watchedPages.push(entry);
  memory.save(data);
  return entry;
}

export function removeWatchedPage(id) {
  const data = pagesStore();
  data.watchedPages = data.watchedPages.filter((p) => p.id !== id);
  memory.save(data);
  return listWatchedPages();
}

/**
 * Sprawdza jedna obserwowana strone (modyfikuje entry W MIEJSCU) i
 * publikuje zdarzenie na bus, gdy tresc realnie sie zmienila. Pierwsze
 * sprawdzenie (brak lastHash) TYLKO zapamietuje stan - tak jak w
 * sentinel.js, inaczej samo dodanie strony wygladaloby jak "zmiana".
 * NIE zapisuje pamieci - wywolujacy (sweepPages/checkWatchedPageById)
 * robi to raz, po przejsciu wszystkich wpisow.
 */
export async function checkPage(entry) {
  entry.lastCheckedAt = Date.now();

  let text;
  try {
    text = await fetchArticleText(entry.url, 50000);
  } catch (err) {
    return { changed: false, error: err.message };
  }
  if (!text) return { changed: false, error: 'Pusta tresc strony po oczyszczeniu.' };

  const hash = hashText(text);
  const firstCheck = entry.lastHash === null;
  const changed = !firstCheck && entry.lastHash !== hash;
  entry.lastHash = hash;
  entry.lastLength = text.length;
  if (changed) entry.lastChangedAt = Date.now();

  if (changed) {
    bus.publish('research', 'page.changed', `strona sie zmienila: ${entry.url}`, {
      level: 'info',
      speak: true,
      data: { id: entry.id, url: entry.url },
    });
  }
  return { changed, firstCheck };
}

export async function checkWatchedPageById(id) {
  const data = pagesStore();
  const entry = data.watchedPages.find((p) => p.id === id);
  if (!entry) throw new Error('Nie znaleziono obserwowanej strony o takim id.');
  const result = await checkPage(entry);
  memory.save(data);
  return { ...result, page: entry };
}

/**
 * Przejscie po wszystkich obserwowanych stronach. Wolane cyklicznie -
 * patrz raport co do podlaczenia w upkeep.js (ten plik go NIE edytuje).
 */
export async function sweepPages() {
  const data = pagesStore();
  let checked = 0;
  let changed = 0;
  for (const entry of data.watchedPages) {
    try {
      const result = await checkPage(entry);
      checked++;
      if (result.changed) changed++;
    } catch (err) {
      bus.publish('research', 'page.error', `blad sprawdzania strony ${entry.url}: ${err.message}`, {
        level: 'warn',
        data: { id: entry.id },
      });
    }
  }
  memory.save(data);
  return { checked, changed };
}

// ============================================================
// #138 - wyszukiwanie najtanszego terminu/oferty uslugi
// ============================================================

const OFFER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    oferty: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nazwa: { type: Type.STRING },
          cena_orientacyjna: { type: Type.STRING },
          zrodlo_url: { type: Type.STRING },
          uwagi: { type: Type.STRING },
        },
        required: ['nazwa'],
      },
    },
  },
  required: ['oferty'],
};

/**
 * Zwraca POSORTOWANA liste ofert do wyboru - NIGDY nie rezerwuje niczego
 * automatycznie. Tak jak kazde inne dzialanie z realnymi skutkami w tym
 * projekcie (np. finalizacja zakupu), ostateczny wybor i potwierdzenie
 * nalezy do czlowieka; endpoint tylko przygotowuje material do decyzji
 * (stad wymagaPotwierdzenia: true w odpowiedzi).
 */
export async function findCheapestService(usluga, miasto) {
  const u = String(usluga || '').trim();
  const m = String(miasto || '').trim();
  if (!u) throw new Error('Podaj usluge.');

  const query = m ? `${u} ${m} cennik cena` : `${u} cennik cena`;
  const results = await searchWeb(query, 10);
  if (!results.length) {
    return { usluga: u, miasto: m || null, oferty: [], wymagaPotwierdzenia: true };
  }

  const listing = results
    .map((r, i) => `${i + 1}. ${r.title} (${r.url})\n   ${String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 250)}`)
    .join('\n');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Ponizej wyniki wyszukiwania ofert uslugi "${u}"${m ? ` w miejscowosci ${m}` : ''}. Wypisz oferty ` +
        '(nazwa firmy/miejsca, orientacyjna cena jesli widoczna w tekscie, adres url zrodla, ewentualne uwagi), ' +
        'POSORTOWANE od najtanszej. Nie wymyslaj cen, ktorych nie ma w tekscie - wtedy zostaw puste pole.\n\n' +
        listing,
      config: { responseMimeType: 'application/json', responseSchema: OFFER_SCHEMA },
    })
  );

  const parsed = parseJsonSafe(res.text, { oferty: [] });
  return {
    usluga: u,
    miasto: m || null,
    oferty: Array.isArray(parsed.oferty) ? parsed.oferty : [],
    wymagaPotwierdzenia: true,
  };
}

// ============================================================
// #139 - tlumaczenie/wyjasnianie trudnych dokumentow prawnych
// ============================================================

const LEGAL_DISCLAIMER =
  'To nie jest porada prawna. W sprawach z realnymi konsekwencjami (umowy, pisma urzedowe, terminy) ' +
  'skonsultuj sie z prawnikiem lub odpowiednim urzedem.';

export async function simplifyLegalText(tekst) {
  const t = String(tekst || '').trim();
  if (!t) throw new Error('Podaj tekst do wyjasnienia.');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        'Ponizej tekst prawny/urzedowy. Wyjasnij PROSTYM JEZYKIEM, co on w praktyce oznacza dla przecietnej ' +
        'osoby - nie tlumacz doslownie slowo w slowo, tylko wytlumacz sens, konsekwencje i ewentualne terminy ' +
        'do dotrzymania. Krotkie zdania, konkretne przyklady tam, gdzie to pomaga zrozumiec.\n\n' +
        t.slice(0, 15000),
    })
  );

  return { wyjasnienie: (res.text || '').trim(), zastrzezenie: LEGAL_DISCLAIMER };
}

// ============================================================
// Router
// ============================================================

export const router = Router();
// Wyszukiwanie wielokrotne, fact-checking, monitoring stron itd. to
// operacje kosztowne (wywolania Gemini + wielokrotny searchWeb) i produkuja
// dane osobiste (obserwowane strony, historia zapytan) - stad requireOwner
// na calym routerze, tak jak przy pozostalych nietrywialnych endpointach.
router.use(requireOwner);

router.post('/research', async (req, res) => {
  try {
    res.json(await researchTopic(req.body?.temat ?? req.body?.topic));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/factcheck', async (req, res) => {
  try {
    res.json(await factCheck(req.body?.twierdzenie ?? req.body?.claim));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/prices', async (req, res) => {
  try {
    res.json(await trackPrices(req.body?.produkt, req.body?.sklepy));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/summarize-url', async (req, res) => {
  try {
    res.json(await summarizeUrl(req.body?.url));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/compare', async (req, res) => {
  try {
    res.json(await compareProducts(req.body?.produkty));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/watch-pages', (req, res) => {
  res.json(listWatchedPages());
});

router.post('/watch-pages', (req, res) => {
  try {
    res.status(201).json(addWatchedPage(req.body?.url));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/watch-pages/:id/check', async (req, res) => {
  try {
    res.json(await checkWatchedPageById(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/watch-pages/:id', (req, res) => {
  res.json(removeWatchedPage(req.params.id));
});

router.post('/cheapest-service', async (req, res) => {
  try {
    res.json(await findCheapestService(req.body?.usluga, req.body?.miasto));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/legal-simplify', async (req, res) => {
  try {
    res.json(await simplifyLegalText(req.body?.tekst));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
