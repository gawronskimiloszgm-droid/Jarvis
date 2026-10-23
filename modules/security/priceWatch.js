// Wartownik cen - odmiana server/sentinel.js (patrz tamten plik jako wzor),
// ale zamiast pilnowac "czy pojawilo sie cos nowego" pilnuje "czy cena
// spadla". Dlatego zamiast zbioru widzianych adresow trzymamy ostatnia
// znana cene i alarmujemy dopiero przy spadku o zadany procent - wzrost
// ceny albo brak zmiany to nie jest zdarzenie warte przerywania uzytkownika.
//
// Ekstrakcje ceny z tekstu wynikow wyszukiwania robi Gemini (ceny w polskich
// sklepach bywaja zapisane na dziesiatki sposobow: "1 299 zl", "1299,00 PLN",
// przekreslona cena promocyjna obok regularnej) - regex tu by sie nie obronil.

import { GoogleGenAI } from '@google/genai';
import * as memory from '../../server/memory/memory.js';
import * as bus from '../../server/core/bus.js';
import { searchWeb } from '../../server/connect/websearch.js';
import { withModel } from '../../server/core/geminiChain.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Ceny nie skacza co godzine - sprawdzanie czesciej niz kilka razy dziennie
// tylko zjada limit wyszukiwarki i budzet zapytan do modelu bez korzysci.
const MIN_INTERVAL_MS = Number(process.env.PRICE_WATCH_MIN_INTERVAL_MS || 6 * 60 * 60 * 1000);
const MAX_HISTORY = 100;

function load() {
  const data = memory.load();
  if (!data.priceWatch || !Array.isArray(data.priceWatch.items)) {
    data.priceWatch = { items: [] };
  }
  return data;
}

export function listWatches() {
  return load().priceWatch.items.map((w) => ({
    id: w.id,
    query: w.query,
    url: w.url || null,
    thresholdPct: w.thresholdPct,
    createdAt: w.createdAt,
    lastCheckedAt: w.lastCheckedAt || null,
    lastPrice: w.lastPrice,
    currency: w.currency || null,
    paused: Boolean(w.paused),
    historyCount: (w.history || []).length,
  }));
}

/**
 * @param {string} query nazwa produktu (i ewentualnie sklep) do wyszukania
 * @param {object} [opts]
 * @param {string} [opts.url] adres konkretnej oferty, jesli znany - trafia do zapytania wyszukiwarki
 * @param {number} [opts.thresholdPct] próg alertu w procentach spadku (domyslnie 5%)
 */
export function addWatch(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  const data = load();
  const thresholdPct = Number.isFinite(Number(opts.thresholdPct)) ? Math.max(0.5, Number(opts.thresholdPct)) : 5;
  const watch = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    query: q,
    url: opts.url ? String(opts.url).slice(0, 500) : null,
    thresholdPct,
    createdAt: Date.now(),
    lastCheckedAt: null,
    lastPrice: null,
    currency: null,
    paused: false,
    history: [],
  };
  data.priceWatch.items.push(watch);
  memory.save(data);
  bus.publish('priceWatch', 'watch.added', `wartownik cen przyjal produkt: ${q}`, {
    level: 'ok',
    data: { id: watch.id },
  });
  return watch;
}

export function removeWatch(id) {
  const data = load();
  const before = data.priceWatch.items.length;
  data.priceWatch.items = data.priceWatch.items.filter((w) => w.id !== id);
  if (data.priceWatch.items.length !== before) memory.save(data);
  return listWatches();
}

export function setPaused(id, paused) {
  const data = load();
  const watch = data.priceWatch.items.find((w) => w.id === id);
  if (!watch) return null;
  watch.paused = Boolean(paused);
  memory.save(data);
  return watch;
}

export function getHistory(id, limit = 30) {
  const watch = load().priceWatch.items.find((w) => w.id === id);
  if (!watch) return null;
  return (watch.history || []).slice(-limit).reverse();
}

// Model dostaje surowe fragmenty wyszukiwarki i ma z nich wyluskac
// najnizsza aktualnie oferowana cene. Odpowiedz owinieta w ```json bywa
// czesta u Gemini - zdejmujemy to samo jak w modules/perimeter/vision.js.
function parsePriceVerdict(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    const v = JSON.parse(cleaned);
    const price = Number(v.price);
    return {
      price: Number.isFinite(price) && price > 0 ? price : null,
      currency: v.currency ? String(v.currency).slice(0, 8) : null,
    };
  } catch {
    return { price: null, currency: null };
  }
}

async function extractPrice(query, results) {
  const list = results
    .slice(0, 8)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Szukasz aktualnej ceny produktu: "${query}".\n` +
        'Ponizej fragmenty wynikow wyszukiwania. Znajdz NAJNIZSZA aktualnie oferowana cene ' +
        '(pomijaj przekreslone/regularne ceny obok promocji, licz sie z promocyjna).\n\n' +
        `${list}\n\n` +
        'Zwroc WYLACZNIE obiekt JSON (bez markdown): {"price": number|null, "currency": string|null}. ' +
        'Jesli nie da sie ustalic ceny z pewnoscia, zwroc price: null.',
    })
  );
  return parsePriceVerdict(res.text);
}

/**
 * Sprawdzenie jednej obserwacji. Modyfikuje wpis w miejscu i zwraca
 * informacje o ewentualnym spadku.
 */
async function checkWatch(watch) {
  const q = watch.url ? `${watch.query} ${watch.url}` : `${watch.query} cena`;
  const results = await searchWeb(q, 8);
  watch.lastCheckedAt = Date.now();
  if (!results.length) return { dropped: false };

  const { price, currency } = await extractPrice(watch.query, results);
  if (price == null) return { dropped: false };

  watch.history = [...(watch.history || []), { at: Date.now(), price }].slice(-MAX_HISTORY);
  if (currency) watch.currency = currency;

  const previous = watch.lastPrice;
  watch.lastPrice = price;

  // Pierwszy odczyt tylko zapamietuje baze - nie ma z czym porownac spadku.
  if (previous == null) return { dropped: false, primed: true };

  const dropPct = previous > 0 ? ((previous - price) / previous) * 100 : 0;
  if (dropPct >= watch.thresholdPct) {
    return { dropped: true, previous, price, dropPct, currency: watch.currency };
  }
  return { dropped: false };
}

/** Przejscie po wszystkich obserwacjach, ktorym minal odstep sprawdzania. */
export async function sweep({ force = false } = {}) {
  const data = load();
  const now = Date.now();
  const due = data.priceWatch.items.filter(
    (w) => !w.paused && (force || !w.lastCheckedAt || now - w.lastCheckedAt >= MIN_INTERVAL_MS)
  );
  if (!due.length) return { checked: 0, alerts: 0 };

  let alerts = 0;
  for (const watch of due) {
    try {
      const result = await checkWatch(watch);
      if (result.dropped) {
        alerts++;
        bus.publish(
          'priceWatch',
          'price.drop',
          `${watch.query}: cena spadla z ${result.previous} do ${result.price} ${result.currency || ''} (-${Math.round(result.dropPct)}%)`.trim(),
          { level: 'info', speak: true, data: { id: watch.id, ...result } }
        );
      }
    } catch (err) {
      bus.publish('priceWatch', 'watch.error', `blad sprawdzania ceny "${watch.query}": ${err.message}`, {
        level: 'warn',
        data: { id: watch.id },
      });
    }
  }
  memory.save(data);
  return { checked: due.length, alerts };
}
