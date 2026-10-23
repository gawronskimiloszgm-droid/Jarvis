// Klient REST do Home Assistant - jeden wspolny punkt dostepu dla calego
// modulu IoT (swiatla, gniazdka, termostaty, rolety, zamki, odkurzacze...).
//
// Home Assistant udostepnia dwa endpointy, ktore wystarcza na wszystko
// ponizej:
//   GET  /api/states                       - stan wszystkich encji
//   GET  /api/states/<entity_id>            - stan jednej encji
//   POST /api/services/<domain>/<service>   - wywolanie uslugi (np. turn_on)
//   GET  /api/history/period/<start>?filter_entity_id=<id> - historia stanow
//
// Celowo bez pakietu (np. home-assistant-js-websocket) - to jest REST, wiec
// wbudowany fetch w Node 20+ wystarcza, dokladnie ten sam minimalizm co
// server/printer.js i server/calendar.js.
//
// WZORZEC (wymagany dla calego batcha): brak env = brak wyjatku. Kazda
// funkcja eksportowana stad zwraca czytelny obiekt/blad zamiast rzucac,
// zeby wywolujacy endpoint mogl grzecznie odpowiedziec "integracja nie jest
// skonfigurowana" zamiast wywrocic sie 500.

const HA_URL = (process.env.HOME_ASSISTANT_URL || '').replace(/\/+$/, '');
const HA_TOKEN = process.env.HOME_ASSISTANT_TOKEN || '';

export function isConfigured() {
  return Boolean(HA_URL && HA_TOKEN);
}

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${HA_TOKEN}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// Blad "brak konfiguracji" ma jeden ksztalt wszedzie, zeby wszystkie
// endpointy nad tym klientem mogly go rozpoznac i zwrocic ten sam,
// spokojny komunikat zamiast stack trace'a.
export class NotConfiguredError extends Error {
  constructor() {
    super('Integracja z Home Assistant nie jest skonfigurowana (brak HOME_ASSISTANT_URL/HOME_ASSISTANT_TOKEN).');
    this.name = 'NotConfiguredError';
    this.notConfigured = true;
  }
}

function assertConfigured() {
  if (!isConfigured()) throw new NotConfiguredError();
}

async function haFetch(pathAndQuery, init = {}) {
  assertConfigured();
  const res = await fetch(`${HA_URL}${pathAndQuery}`, {
    ...init,
    headers: headers(init.headers),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = (data && data.message) || (typeof data === 'string' ? data.slice(0, 200) : `HTTP ${res.status}`);
    throw new Error(`Home Assistant odpowiedzial HTTP ${res.status}: ${msg}`);
  }
  return data;
}

/** Szybki test polaczenia - true/false, nigdy nie rzuca. */
export async function ping() {
  if (!isConfigured()) return false;
  try {
    await haFetch('/api/');
    return true;
  } catch {
    return false;
  }
}

/**
 * Lista wszystkich encji (albo tylko z danej domeny, np. "light", "cover").
 * @param {string} [domainFilter]
 */
export async function getStates(domainFilter) {
  const all = await haFetch('/api/states');
  const list = Array.isArray(all) ? all : [];
  if (!domainFilter) return list;
  const prefix = `${domainFilter}.`;
  return list.filter((e) => typeof e.entity_id === 'string' && e.entity_id.startsWith(prefix));
}

/** Stan pojedynczej encji, albo null gdy nie istnieje. */
export async function getState(entityId) {
  try {
    return await haFetch(`/api/states/${encodeURIComponent(entityId)}`);
  } catch (err) {
    if (err.notConfigured) throw err;
    return null;
  }
}

/**
 * Wywolanie uslugi Home Assistant, np. callService('light', 'turn_on', 'light.salon', { brightness_pct: 40 }).
 * @param {string} domain np. "light", "cover", "climate", "lock", "vacuum", "media_player"
 * @param {string} service np. "turn_on", "turn_off", "set_temperature"
 * @param {string|string[]} [entityId] entity_id albo lista - pomijalne dla uslug bez celu
 * @param {object} [extraData] dodatkowe pola usugi (np. { temperature: 21 })
 */
export async function callService(domain, service, entityId, extraData = {}) {
  const body = { ...extraData };
  if (entityId) body.entity_id = entityId;
  return haFetch(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Historia stanow encji za ostatnie `hours` godzin (Home Assistant History API).
 * Zwraca tablice probek {state, last_changed} - surowa odpowiedz HA jest
 * tablica-tablic (jedna lista na encje), tu splaszczona bo pytamy o jedna.
 */
export async function getHistory(entityId, hours = 24 * 7) {
  const start = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const p = new URLSearchParams({
    filter_entity_id: entityId,
    minimal_response: 'true',
    no_attributes: 'true',
  });
  const data = await haFetch(`/api/history/period/${encodeURIComponent(start)}?${p.toString()}`);
  const series = Array.isArray(data) ? data[0] || [] : [];
  return series.map((s) => ({ state: s.state, at: s.last_changed || s.last_updated }));
}
