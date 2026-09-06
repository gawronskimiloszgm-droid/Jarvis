// #129: "Ile mam jeszcze do domu" na zywo.
//
// Adres domowy geokodujemy RAZ (Nominatim) i trzymamy wspolrzedne w pamieci -
// kazde kolejne zapytanie o dystans/czas liczy tylko OSRM (route()), bez
// ponownego geokodowania.

import { loadTravel, saveTravel } from './store.js';
import { geocode, route } from './geo.js';

export function getHome() {
  return loadTravel().travel.home;
}

/** Ustawia adres domowy - geokoduje przez Nominatim i zapisuje wspolrzedne. */
export async function setHome(address) {
  const clean = String(address || '').trim();
  if (!clean) throw new Error('Podaj adres domowy.');

  const place = await geocode(clean);
  if (!place) throw new Error(`Nie udalo sie zgeokodowac adresu: "${clean}".`);

  const data = loadTravel();
  data.travel.home = {
    address: clean,
    displayName: place.displayName,
    lat: place.lat,
    lon: place.lon,
    setAt: Date.now(),
  };
  saveTravel(data);
  return data.travel.home;
}

/**
 * Dystans/czas na zywo z podanych wspolrzednych (np. GPS telefonu) do
 * zapisanego adresu domowego.
 * @param {{lat:number, lon:number}} current
 */
export async function distanceToHome(current) {
  const home = getHome();
  if (!home) throw new Error('Adres domowy nie jest ustawiony - ustaw go przez POST /travel/home.');

  const from = { lat: Number(current?.lat), lon: Number(current?.lon) };
  if (!Number.isFinite(from.lat) || !Number.isFinite(from.lon)) {
    throw new Error('Podaj poprawne aktualne wspolrzedne (lat, lon).');
  }

  const result = await route(from, home);
  if (!result) throw new Error('OSRM nie zwrocil trasy dla podanych wspolrzednych.');

  return {
    home: { address: home.address, lat: home.lat, lon: home.lon },
    durationSec: result.durationSec,
    distanceMeters: result.distanceMeters,
    etaMinutes: Math.round(result.durationSec / 60),
  };
}
