// Zamek "spoza" Home Assistant - dla kogos, kto ma zamek z wlasnym, prostym
// API producenta zamiast integracji HA (np. wewnetrzny serwer w sieci LAN).
// CELOWO osobny, malutki modul: zamek to jedyne urzadzenie w tym batchu,
// gdzie brak dostepu = ktos zostaje zamkniety na zewnatrz, wiec dwa niezalezne
// providery (HA i ten) NIE dziela kodu ani zalozen o formacie API.
//
// Domyslny provider to prosty REST: GET <url>/status, POST <url>/lock,
// POST <url>/unlock, z naglowkiem Authorization: Bearer <token> - to
// najczestszy najmniejszy wspolny mianownik dla "wlasnych" bramek IoT
// (Shelly, ESPHome, wlasny mikrokontroler). Jesli Twoj zamek mowi czyms
// innym, podmien tylko funkcje ponizej - reszta modulu IoT go nie dotyka.

const PROVIDER = (process.env.SMART_LOCK_PROVIDER || '').trim().toLowerCase(); // np. "generic_rest"
const URL = (process.env.SMART_LOCK_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.SMART_LOCK_TOKEN || '';

export function isConfigured() {
  return Boolean(PROVIDER && URL);
}

function headers() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error(
      'Alternatywny zamek nie jest skonfigurowany (brak SMART_LOCK_PROVIDER/SMART_LOCK_URL) - jesli Twoj zamek ma integracje Home Assistant, uzyj zamiast tego modulu lock.js.'
    );
  }
}

async function call(path, init = {}) {
  assertConfigured();
  const res = await fetch(`${URL}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zamek (${PROVIDER}) odpowiedzial HTTP ${res.status}`);
  return data;
}

export async function lock() {
  return call('/lock', { method: 'POST' });
}

export async function unlock() {
  return call('/unlock', { method: 'POST' });
}

export async function status() {
  if (!isConfigured()) return null;
  try {
    return await call('/status');
  } catch {
    return null;
  }
}
