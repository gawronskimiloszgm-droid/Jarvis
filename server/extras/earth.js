// Ziemia: kula 3D i mapa satelitarna z danymi na zywo, wszystko za darmo i bez kluczy:
// trzesienia ziemi (USGS), stacja ISS (wheretheiss.at), radar opadow (RainViewer),
// samoloty (OpenSky, anonimowo) i wyszukiwanie miejsc (Nominatim). Serwer tylko posredniczy
// i trzyma krotka pamiec podreczna, zeby nie odpytywac zrodel przy kazdym odswiezeniu ekranu.
import express from 'express';
import { requireOwner } from '../core/auth.js';
import { geocode } from '../travel/geo.js';

const router = express.Router();
const cache = new Map(); // klucz -> { at, data }

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return hit.data; // zrodlo chwilowo nie odpowiada: ostatnie dane lepsze niz nic
    throw e;
  }
}
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'jarvis-personal-assistant/1.0', ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: błąd ${res.status}`);
  return res.json();
}

// ---------- czysta logika (testy w tests/earth.test.mjs) ----------

/** Odleglosc po kuli ziemskiej w km. */
export function distanceKm(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Trzesienia z GeoJSON USGS w krotkiej postaci. */
export function parseQuakes(geo) {
  return (geo?.features || [])
    .map((f) => ({ id: String(f.id), mag: Math.round((Number(f.properties?.mag) || 0) * 10) / 10, place: String(f.properties?.place || ''), time: Number(f.properties?.time) || 0, lon: Number(f.geometry?.coordinates?.[0]), lat: Number(f.geometry?.coordinates?.[1]), depth: Math.round(Number(f.geometry?.coordinates?.[2]) || 0), tsunami: Boolean(f.properties?.tsunami), url: String(f.properties?.url || '') }))
    .filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lon))
    .sort((a, b) => b.time - a.time);
}

// 1 trzesienie, 2-4 trzesienia, 5+ trzesien (ale 12-14 trzesien, 22 trzesienia).
const quakeWord = (n) => (n === 1 ? 'trzęsienie' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'trzęsienia' : 'trzęsień');
const ago = (ms, now) => {
  const h = Math.round((now - ms) / 3600000);
  return h < 1 ? 'przed chwilą' : h < 48 ? `${h} h temu` : `${Math.round(h / 24)} dni temu`;
};

/** Podsumowanie po polsku: wszystkie albo w promieniu od punktu. */
export function quakeSummary(list, { near, radiusKm = 500, now = Date.now(), days = 7 } = {}) {
  const inArea = near ? list.filter((q) => distanceKm(near, q) <= radiusKm).map((q) => ({ ...q, km: Math.round(distanceKm(near, q)) })) : list;
  const where = near ? `w promieniu ${radiusKm} km${near.name ? ` od: ${near.name}` : ''}` : 'na świecie';
  if (!inArea.length) return { count: 0, list: [], text: `Brak trzęsień ziemi M2,5+ ${where} w ostatnich ${days} dniach.` };
  const strongest = inArea.reduce((a, q) => (q.mag > a.mag ? q : a), inArea[0]);
  const latest = inArea[0];
  const fmt = (q) => `M${q.mag.toFixed(1).replace('.', ',')} ${q.place}${q.km != null ? ` (${q.km} km stąd)` : ''}, ${ago(q.time, now)}`;
  const strong = inArea.filter((q) => q.mag >= 6).length;
  const text = `${inArea.length} ${quakeWord(inArea.length)} M2,5+ ${where} w ${days} dni${strong ? `, w tym ${strong} ${strong === 1 ? 'silne' : 'silnych'} (M6+)` : ''}. Najsilniejsze: ${fmt(strongest)}.${latest !== strongest ? ` Ostatnie: ${fmt(latest)}.` : ''}`;
  return { count: inArea.length, strongest, latest, list: inArea.slice(0, 200), text };
}

/** Samoloty z OpenSky w krotkiej postaci (wektor stanu to tablica). */
export function parsePlanes(data) {
  return (data?.states || [])
    .filter((s) => Number.isFinite(s[5]) && Number.isFinite(s[6]) && !s[8])
    .slice(0, 600)
    .map((s) => ({ id: String(s[0]), call: String(s[1] || '').trim(), country: String(s[2] || ''), lon: s[5], lat: s[6], altM: Math.round(s[7] ?? s[13] ?? 0), speedKmh: Math.round((s[9] || 0) * 3.6), heading: Math.round(s[10] || 0) }));
}

// ---------- zrodla ----------
export const quakes = (days = 7) => cached(`q${days}`, 5 * 60000, async () => parseQuakes(await getJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_${days <= 1 ? 'day' : days <= 7 ? 'week' : 'month'}.geojson`)));
export const iss = () => cached('iss', 4000, async () => {
  const j = await getJson('https://api.wheretheiss.at/v1/satellites/25544');
  return { lat: j.latitude, lon: j.longitude, altKm: Math.round(j.altitude), speedKmh: Math.round(j.velocity), daylight: j.visibility === 'daylight', at: j.timestamp * 1000 };
});
export const radar = () => cached('radar', 5 * 60000, async () => {
  const j = await getJson('https://api.rainviewer.com/public/weather-maps.json');
  return { host: j.host, frames: (j.radar?.past || []).slice(-6).map((f) => ({ time: f.time * 1000, path: f.path })) };
});
export const planes = (box) => {
  const b = [box.lamin, box.lomin, box.lamax, box.lomax].map((v) => Math.round(Number(v) * 10) / 10);
  if (b.some((v) => !Number.isFinite(v))) throw new Error('Zły obszar.');
  return cached(`p${b.join(',')}`, 30000, async () => parsePlanes(await getJson(`https://opensky-network.org/api/states/all?lamin=${b[0]}&lomin=${b[1]}&lamax=${b[2]}&lomax=${b[3]}`)));
};
export async function findPlace(q) {
  const p = await cached(`g${String(q).toLowerCase()}`, 24 * 3600000, () => geocode(q));
  if (!p) throw new Error(`Nie znalazłem miejsca "${q}".`);
  return { lat: p.lat, lon: p.lon, name: String(p.displayName || q).split(',').slice(0, 2).join(',') };
}

// ---------- trasy ----------
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
router.get('/api/earth/quakes', requireOwner, wrap(async (req) => {
  const days = Number(req.query.days) || 7;
  const list = await quakes(days);
  const near = req.query.lat ? { lat: Number(req.query.lat), lon: Number(req.query.lon), name: String(req.query.name || '').slice(0, 60) } : null;
  return { quakes: list, summary: quakeSummary(list, { near, radiusKm: Number(req.query.km) || 500, days }) };
}));
router.get('/api/earth/iss', requireOwner, wrap(() => iss()));
router.get('/api/earth/radar', requireOwner, wrap(() => radar()));
router.get('/api/earth/planes', requireOwner, wrap(async (req) => ({ planes: await planes(req.query) })));
router.get('/api/earth/place', requireOwner, wrap((req) => findPlace(String(req.query.q || '').slice(0, 120))));

// ---------- glos ----------
export const EARTH_TOOLS = [
  {
    name: 'ziemia',
    description: 'Kula ziemska 3D na ekranie z danymi na zywo. akcja: pokaz (otworz kule), satelita (prawdziwe zdjecia satelitarne), hologram (niebieski styl), przybliz (miejsce: miasto/kraj/adres; przechodzi w mape satelitarna), trzesienia (trzesienia ziemi M2.5+ z 7 dni; z miejscem: w promieniu promien_km), iss (gdzie jest teraz stacja ISS), radar (opady deszczu na mapie), samoloty (samoloty nad oglądanym obszarem), zamknij.',
    parameters: { type: 'object', properties: { akcja: { type: 'string', enum: ['pokaz', 'satelita', 'hologram', 'przybliz', 'trzesienia', 'iss', 'radar', 'samoloty', 'zamknij'] }, miejsce: { type: 'string' }, promien_km: { type: 'number' } }, required: ['akcja'] },
  },
];
export const EARTH_VOICE_PROMPT = '- ziemia: "pokaz ziemie", "widok satelitarny", "przybliz do Krakowa", "pokaz trzesienia ziemi (w tym rejonie)", "gdzie jest ISS", "pokaz radar", "samoloty nad nami". Opisz krotko liczby z wyniku.';

export async function runEarthTool(name, a = {}) {
  if (name !== 'ziemia') return undefined;
  const klient = (params) => ({ action: 'ziemia', params });
  try {
    switch (a.akcja) {
      case 'pokaz':
      case 'satelita':
      case 'hologram':
      case 'zamknij':
        return { ok: true, klient: klient({ akcja: a.akcja }) };
      case 'przybliz': {
        if (!a.miejsce) return { error: 'podaj miejsce' };
        const p = await findPlace(a.miejsce);
        return { ok: true, miejsce: p.name, klient: klient({ akcja: 'przybliz', lat: p.lat, lon: p.lon, nazwa: p.name }) };
      }
      case 'trzesienia': {
        const list = await quakes(7);
        const near = a.miejsce ? await findPlace(a.miejsce) : null;
        const radiusKm = Math.max(50, Math.min(3000, Number(a.promien_km) || 500));
        const s = quakeSummary(list, { near, radiusKm });
        return { opis: s.text, liczba: s.count, klient: klient({ akcja: 'trzesienia', ...(near && { lat: near.lat, lon: near.lon, nazwa: near.name, km: radiusKm }) }) };
      }
      case 'iss': {
        const p = await iss();
        return { szerokosc: Math.round(p.lat * 10) / 10, dlugosc: Math.round(p.lon * 10) / 10, wysokosc_km: p.altKm, predkosc_kmh: p.speedKmh, w_sloncu: p.daylight, klient: klient({ akcja: 'iss' }) };
      }
      case 'radar': {
        const r = await radar();
        return { ok: true, klatek: r.frames.length, klient: klient({ akcja: 'radar', ...(a.miejsce && (await findPlace(a.miejsce).then((p) => ({ lat: p.lat, lon: p.lon, nazwa: p.name })).catch(() => ({})))) }) };
      }
      case 'samoloty':
        return { ok: true, uwaga: 'pokazuje samoloty nad obszarem widocznym na mapie', klient: klient({ akcja: 'samoloty', ...(a.miejsce && (await findPlace(a.miejsce).then((p) => ({ lat: p.lat, lon: p.lon, nazwa: p.name })).catch(() => ({})))) }) };
      default:
        return { error: 'nieznana akcja' };
    }
  } catch (e) {
    return { error: e.message };
  }
}

export default router;
