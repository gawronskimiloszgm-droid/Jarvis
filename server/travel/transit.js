// #122: Integracja z komunikacja miejska.
//
// Prawdziwe GTFS-realtime to protobuf (feed binarny) - dekodowanie wymagaloby
// nowej zaleznosci (`gtfs-realtime-bindings`), ktorej nie ma w package.json
// tego repo i nie wolno mi tu doinstalowywac. Zamiast tego (zgodnie z
// poleceniem: "postaraj sie najpierw o prostszy JSON-owy wariant") budujemy
// generycznego klienta pod endpoint TRANSIT_GTFS_URL, ktory zwraca JSON
// (wiele miejskich API - w tym czesc feedow GTFS-RT wystawianych przez
// operatorow przez proxy - udostepnia rownolegle wariant JSON obok protobuf).
//
// Brak env = grzeczna informacja, ze integracja dla danego miasta wymaga
// konfiguracji - nie wyjatek (ten sam wzor co server/printer.js).

const TRANSIT_GTFS_URL = process.env.TRANSIT_GTFS_URL || '';

export function isConfigured() {
  return Boolean(TRANSIT_GTFS_URL);
}

/**
 * Odjazdy z przystanku. Format odpowiedzi generycznego API nie jest
 * ustandaryzowany miedzy miastami - zakladamy {departures:[{line, headsign,
 * etaMinutes}]} albo goly array, i przepuszczamy surowe dane w `raw` do
 * ewentualnego dostrojenia mapowania pod konkretnego dostawce.
 * @param {{city:string, stop:string}} params
 */
export async function getDepartures({ city, stop }) {
  const cityClean = String(city || '').trim();
  const stopClean = String(stop || '').trim();
  if (!stopClean) throw new Error('Podaj przystanek.');

  if (!isConfigured()) {
    return {
      configured: false,
      city: cityClean,
      stop: stopClean,
      departures: [],
      message: `Integracja z komunikacja miejska dla "${cityClean || 'tego miasta'}" wymaga konfiguracji: ustaw TRANSIT_GTFS_URL na adres endpointu GTFS-realtime (wariant JSON) danego miasta/operatora.`,
    };
  }

  const url = new URL(TRANSIT_GTFS_URL);
  url.searchParams.set('city', cityClean);
  url.searchParams.set('stop', stopClean);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API komunikacji miejskiej HTTP ${res.status}`);
  const data = await res.json();
  const departures = Array.isArray(data.departures) ? data.departures : Array.isArray(data) ? data : [];

  return { configured: true, city: cityClean, stop: stopClean, departures, raw: data };
}
