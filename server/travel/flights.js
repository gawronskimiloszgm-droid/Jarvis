// #121: Sprawdzanie cen lotow/biletow i alert przy spadku ceny.
//
// Nie ma w srodowisku klucza do zadnego realnego API lotniczego (kazde
// sensowne wymaga platnej subskrypcji), wiec budujemy GENERYCZNEGO klienta
// pod dowolne API zwracajace cene dla pary origin/destination/date,
// konfigurowane przez FLIGHTS_API_URL/FLIGHTS_API_KEY. Brak env = funkcja
// dziala "na sucho": mozna dodawac obserwowane loty, ale sprawdzanie ceny
// grzecznie informuje o braku konfiguracji zamiast rzucac wyjatkiem
// (dokladnie ten sam wzor co server/printer.js).

import * as bus from '../core/bus.js';
import { loadTravel, saveTravel, newId } from './store.js';

const FLIGHTS_API_URL = process.env.FLIGHTS_API_URL || '';
const FLIGHTS_API_KEY = process.env.FLIGHTS_API_KEY || '';
// Loty nie zmieniaja ceny co minute - 6h miedzy sprawdzeniami tego samego
// wpisu oszczedza limity generycznego API, ktore ktos kiedys tu podlaczy.
const MIN_INTERVAL_MS = Number(process.env.FLIGHTS_CHECK_INTERVAL_MS || 6 * 60 * 60 * 1000);

export function isConfigured() {
  return Boolean(FLIGHTS_API_URL);
}

// Kontrakt oczekiwany od generycznego API:
//   GET <FLIGHTS_API_URL>?origin=..&destination=..&date=..
//   naglowek Authorization: Bearer <FLIGHTS_API_KEY> (jesli ustawiony)
//   odpowiedz JSON { price: number, currency?: string }
// Konkretny dostawca prawie na pewno zwraca inny ksztalt - to miejsce do
// dopisania mapowania, gdy wiadomo juz z kim integrujemy.
async function fetchPrice({ origin, destination, date }) {
  const url = new URL(FLIGHTS_API_URL);
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  if (date) url.searchParams.set('date', date);
  const headers = {};
  if (FLIGHTS_API_KEY) headers.Authorization = `Bearer ${FLIGHTS_API_KEY}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`API lotow odpowiedzialo HTTP ${res.status}`);
  const data = await res.json();
  const price = Number(data.price ?? data.amount ?? data.lowestPrice);
  if (!Number.isFinite(price)) throw new Error('API lotow: brak rozpoznawalnej ceny w odpowiedzi.');
  return { price, currency: String(data.currency || 'PLN').toUpperCase().slice(0, 6) };
}

export function listWatches() {
  return loadTravel().travel.flights;
}

export function addWatch({ origin, destination, date, thresholdPct }) {
  const o = String(origin || '').trim();
  const d = String(destination || '').trim();
  if (!o || !d) throw new Error('Podaj origin i destination (kody lotnisk albo nazwy miast).');

  const data = loadTravel();
  const watch = {
    id: newId(),
    origin: o,
    destination: d,
    date: date ? String(date).slice(0, 10) : null,
    thresholdPct: Number.isFinite(Number(thresholdPct)) ? Math.max(1, Number(thresholdPct)) : 10,
    lastPrice: null,
    lastCurrency: null,
    lastCheckedAt: null,
    history: [],
    createdAt: Date.now(),
  };
  data.travel.flights.push(watch);
  saveTravel(data);
  return watch;
}

export function removeWatch(id) {
  const data = loadTravel();
  data.travel.flights = data.travel.flights.filter((w) => w.id !== id);
  saveTravel(data);
  return data.travel.flights;
}

/** Sprawdzenie jednego obserwowanego lotu "na teraz". Zapisuje wynik w pamieci. */
export async function checkWatch(id) {
  const data = loadTravel();
  const watch = data.travel.flights.find((w) => w.id === id);
  if (!watch) throw new Error('Nie znaleziono obserwowanego lotu o tym id.');

  if (!isConfigured()) {
    return { ...watch, configured: false, message: 'Brak FLIGHTS_API_URL - sledzenie dziala "na sucho" (bez realnych cen). Ustaw FLIGHTS_API_URL/FLIGHTS_API_KEY, zeby wlaczyc realne sprawdzanie.' };
  }

  const { price, currency } = await fetchPrice(watch);
  const prevPrice = watch.lastPrice;
  watch.history = [...(watch.history || []), { price, currency, at: Date.now() }].slice(-30);
  watch.lastCheckedAt = Date.now();
  watch.lastPrice = price;
  watch.lastCurrency = currency;

  if (prevPrice != null && prevPrice > 0) {
    const dropPct = ((prevPrice - price) / prevPrice) * 100;
    if (dropPct >= watch.thresholdPct) {
      bus.publish(
        'travel',
        'flight.price_drop',
        `Cena lotu ${watch.origin} -> ${watch.destination} spadla o ${dropPct.toFixed(1)}%: ${price} ${currency} (bylo ${prevPrice} ${currency}).`,
        { level: 'ok', speak: true, data: { id: watch.id, price, prevPrice, currency } }
      );
    }
  }
  saveTravel(data);
  return { ...watch, configured: true };
}

/** Wolane cyklicznie przez scheduler.js - sprawdza wszystkie wpisy, ktorym minal odstep. */
export async function sweepFlights() {
  if (!isConfigured()) return { checked: 0, configured: false };
  const data = loadTravel();
  const now = Date.now();
  const due = data.travel.flights.filter((w) => !w.lastCheckedAt || now - w.lastCheckedAt >= MIN_INTERVAL_MS);
  let checked = 0;
  for (const watch of due) {
    try {
      await checkWatch(watch.id);
      checked++;
    } catch (err) {
      bus.publish(
        'travel',
        'flight.error',
        `Sprawdzanie ceny lotu ${watch.origin}->${watch.destination} nieudane: ${err.message}`,
        { level: 'warn', data: { id: watch.id } }
      );
    }
  }
  return { checked, configured: true };
}
