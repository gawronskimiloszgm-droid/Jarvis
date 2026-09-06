// Darmowe geokodowanie (Nominatim/OpenStreetMap) i trasy (OSRM) - bez klucza
// API, uzywane przez traffic.js (#123) i homeDistance.js (#129).
//
// Nominatim wymaga w polityce uzycia naglowka User-Agent z identyfikacja
// aplikacji i limitu ~1 zapytania/sekunde. W tym projekcie wywolania sa
// rzadkie (na zadanie uzytkownika, nie w petli), wiec wlasny throttler nie
// jest potrzebny - ale NIE nalezy tego wywolywac w ciasnej petli.

const USER_AGENT = 'jarvis-personal-assistant/1.0 (osobisty asystent, uzytek prywatny)';

/** Zamienia adres/nazwe miejsca na wspolrzedne. Zwraca null, gdy nic nie znaleziono. */
export async function geocode(query) {
  const clean = String(query || '').trim();
  if (!clean) return null;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&format=json&limit=1`,
    { headers: { 'User-Agent': USER_AGENT } }
  );
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  const place = data?.[0];
  if (!place) return null;
  return {
    lat: Number(place.lat),
    lon: Number(place.lon),
    displayName: place.display_name,
  };
}

/**
 * Czas i dystans jazdy samochodem miedzy dwoma punktami (OSRM, serwer
 * demonstracyjny project-osrm.org - darmowy, bez klucza, bez SLA).
 * @param {{lat:number, lon:number}} from
 * @param {{lat:number, lon:number}} to
 */
export async function route(from, to) {
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(to.lat)) return null;
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r) return null;
  return { durationSec: Math.round(r.duration), distanceMeters: Math.round(r.distance) };
}
