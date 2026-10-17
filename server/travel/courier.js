// #126: Sledzenie przesylek kurierskich.
//
// Generyczny klient pod dowolne API sledzenia wspierane przez dostawce
// (np. 17track), konfigurowane przez COURIER_TRACKING_API_URL/KEY. Brak env
// = grzeczna informacja zamiast wyjatku (ten sam wzor co server/printer.js).
// Cykliczne sprawdzanie (sweepCourier, wolane ze scheduler.js) alarmuje przez
// bus.publish TYLKO gdy status sie realnie zmienil.

import * as bus from '../core/bus.js';
import { loadTravel, saveTravel, newId } from './store.js';

const COURIER_TRACKING_API_URL = process.env.COURIER_TRACKING_API_URL || '';
const COURIER_TRACKING_API_KEY = process.env.COURIER_TRACKING_API_KEY || '';
const MIN_INTERVAL_MS = Number(process.env.COURIER_CHECK_INTERVAL_MS || 60 * 60 * 1000); // 1h

export function isConfigured() {
  return Boolean(COURIER_TRACKING_API_URL);
}

// Kontrakt oczekiwany od generycznego API:
//   GET <COURIER_TRACKING_API_URL>?tracking=<numer>&carrier=<przewoznik>
//   naglowek Authorization: Bearer <KEY> (jesli ustawiony)
//   odpowiedz JSON { status: string, statusText?: string, lastUpdate?: string }
async function fetchStatus({ trackingNumber, carrier }) {
  const url = new URL(COURIER_TRACKING_API_URL);
  url.searchParams.set('tracking', trackingNumber);
  if (carrier) url.searchParams.set('carrier', carrier);
  const headers = {};
  if (COURIER_TRACKING_API_KEY) headers.Authorization = `Bearer ${COURIER_TRACKING_API_KEY}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`API sledzenia przesylek HTTP ${res.status}`);
  const data = await res.json();
  const status = String(data.status || data.statusText || 'nieznany');
  return { status, raw: data };
}

export function listWatches() {
  return loadTravel().travel.courier;
}

export function addWatch({ trackingNumber, carrier, label }) {
  const num = String(trackingNumber || '').trim();
  if (!num) throw new Error('Podaj numer przesylki.');

  const data = loadTravel();
  const watch = {
    id: newId(),
    trackingNumber: num,
    carrier: carrier ? String(carrier).trim() : null,
    label: label ? String(label).trim() : num,
    lastStatus: null,
    lastCheckedAt: null,
    history: [],
    createdAt: Date.now(),
  };
  data.travel.courier.push(watch);
  saveTravel(data);
  return watch;
}

export function removeWatch(id) {
  const data = loadTravel();
  data.travel.courier = data.travel.courier.filter((w) => w.id !== id);
  saveTravel(data);
  return data.travel.courier;
}

/** Sprawdzenie jednej przesylki "na teraz". */
export async function checkWatch(id) {
  const data = loadTravel();
  const watch = data.travel.courier.find((w) => w.id === id);
  if (!watch) throw new Error('Nie znaleziono obserwowanej przesylki o tym id.');

  if (!isConfigured()) {
    return { ...watch, configured: false, message: 'Brak COURIER_TRACKING_API_URL - podaj dostawce sledzenia, zeby wlaczyc realne sprawdzanie statusu.' };
  }

  const { status } = await fetchStatus(watch);
  const changed = watch.lastStatus !== null && watch.lastStatus !== status;
  watch.history = [...(watch.history || []), { status, at: Date.now() }].slice(-30);
  watch.lastCheckedAt = Date.now();
  const prevStatus = watch.lastStatus;
  watch.lastStatus = status;
  saveTravel(data);

  if (changed) {
    bus.publish(
      'travel',
      'courier.status_changed',
      `Przesylka "${watch.label}": ${prevStatus} -> ${status}.`,
      { level: 'ok', speak: true, data: { id: watch.id, status } }
    );
  }
  return { ...watch, configured: true, changed };
}

/** Wolane cyklicznie przez scheduler.js. */
export async function sweepCourier() {
  if (!isConfigured()) return { checked: 0, configured: false };
  const data = loadTravel();
  const now = Date.now();
  const due = data.travel.courier.filter((w) => !w.lastCheckedAt || now - w.lastCheckedAt >= MIN_INTERVAL_MS);
  let checked = 0;
  for (const watch of due) {
    try {
      await checkWatch(watch.id);
      checked++;
    } catch (err) {
      bus.publish('travel', 'courier.error', `Sprawdzanie przesylki "${watch.label}" nieudane: ${err.message}`, { level: 'warn', data: { id: watch.id } });
    }
  }
  return { checked, configured: true };
}
