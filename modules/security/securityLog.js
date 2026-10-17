// Log zdarzen bezpieczenstwa - trwaly (przezywa restart) wyciag z magistrali
// zdarzen (server/bus.js), ktorej wlasny bufor (RING_MAX=300, patrz bus.js)
// jest tylko krotkotrwaly i wspolny dla WSZYSTKICH modulow, nie tylko
// bezpieczenstwa. Subskrybujemy WSZYSTKO, ale zapisujemy tylko zdarzenia
// ze zrodel zwiazanych z bezpieczenstwem - reszta (cad, printer, calendar...)
// nas nie interesuje i tylko zapchalaby historie.
//
// Subskrypcja startuje przy PIERWSZYM zaimportowaniu tego modulu (efekt
// uboczny na poziomie modulu) - patrz raport koncowy: wystarczy zamontowac
// server/routes/securityLog.js, zeby to zaczelo dzialac, bez osobnego
// wywolania startu.

import * as memory from '../../server/memory/memory.js';
import * as bus from '../../server/core/bus.js';

// Zrodla traktowane jako "bezpieczenstwo". Domyslnie oryginalna trojka z
// zadania (sentinel/perimeter/security) plus zrodla nowych modulow z tego
// samego batcha, ktore tez sa czescia domeny bezpieczenstwa - bez tego
// rozszerzenia log lapalby wlasny wartownik tematow ogolnych, ale juz nie
// wartownik cen czy monitoring reputacji, co byloby niespojne.
const DEFAULT_SOURCES = ['sentinel', 'perimeter', 'security', 'priceWatch', 'reputation', 'auth'];
const SOURCES = new Set(
  String(process.env.SECURITY_LOG_SOURCES || '').trim()
    ? String(process.env.SECURITY_LOG_SOURCES).split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SOURCES
);

const MAX_EVENTS = Number(process.env.SECURITY_LOG_MAX || 2000);

function load() {
  const data = memory.load();
  if (!data.securityLog || !Array.isArray(data.securityLog.events)) {
    data.securityLog = { events: [] };
  }
  return data;
}

let started = false;

function startCapture() {
  if (started) return;
  started = true;
  bus.subscribe((event) => {
    if (!SOURCES.has(event.source)) return;
    const data = load();
    data.securityLog.events.push({
      id: event.id,
      at: event.at,
      source: event.source,
      topic: event.topic,
      message: event.message,
      level: event.level,
    });
    if (data.securityLog.events.length > MAX_EVENTS) {
      data.securityLog.events.splice(0, data.securityLog.events.length - MAX_EVENTS);
    }
    memory.save(data);
  });
}
startCapture();

/** Ktore zrodla sa aktualnie logowane - dla panelu ustawien. */
export function watchedSources() {
  return [...SOURCES];
}

/**
 * @param {{source?:string, level?:string, since?:number, limit?:number}} [filters]
 */
export function getHistory(filters = {}) {
  const events = load().securityLog.events;
  let list = events;
  if (filters.source) list = list.filter((e) => e.source === filters.source);
  if (filters.level) list = list.filter((e) => e.level === filters.level);
  if (filters.since) list = list.filter((e) => new Date(e.at).getTime() >= Number(filters.since));
  const limit = Math.max(1, Math.min(2000, Number(filters.limit) || 200));
  return list.slice(-limit).reverse();
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @returns {string} log jako CSV (nagłówek + wiersze) */
export function exportCSV(filters = {}) {
  const rows = getHistory({ ...filters, limit: filters.limit || 2000 });
  const header = 'at,source,topic,level,message';
  const lines = rows.map((e) => [e.at, e.source, e.topic, e.level, e.message].map(csvEscape).join(','));
  return [header, ...lines].join('\n');
}

/** @returns {string} log jako JSON (tablica zdarzen) */
export function exportJSON(filters = {}) {
  return JSON.stringify(getHistory({ ...filters, limit: filters.limit || 2000 }), null, 2);
}
