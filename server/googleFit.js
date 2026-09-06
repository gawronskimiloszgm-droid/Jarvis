// Integracja z Google Fit (Fitness REST API) - kroki, sen, tetno.
//
// Ten sam wzorzec OAuth2 "authorization code" co server/calendar.js
// (koncepcyjnie), ale CELOWO osobny, niezalezny plik i osobny token w
// pamieci: to inny zestaw scope'ow Google, wygasa/odswieza sie osobno,
// a odlaczenie jednej integracji nie moze przypadkiem zerwac drugiej.
//
// Bez @google/genai ani googleapis - czyste REST wywolania, zeby nie
// dokladac zaleznosci do listy: sam odczyt agregatow (kroki/sen/tetno).

import { load, save } from './memory.js';
import express from 'express';
import { requireOwner } from './auth.js';

const CLIENT_ID = process.env.GOOGLE_FIT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_FIT_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_FIT_REDIRECT_URI || '';
const SCOPE = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.sleep.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
].join(' ');

function data() {
  const d = load();
  if (!d.googleFit || typeof d.googleFit !== 'object') d.googleFit = { refreshToken: null };
  return d;
}

export function isOAuthConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

export function isConnected() {
  return Boolean(data().googleFit.refreshToken);
}

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.error || `HTTP ${res.status}`);
  if (!body.refresh_token) {
    throw new Error('Google nie zwrocil refresh_token - odwolaj dostep na myaccount.google.com i sprobuj ponownie.');
  }
  const d = data();
  d.googleFit.refreshToken = body.refresh_token;
  save(d);
  return true;
}

export function disconnect() {
  const d = data();
  d.googleFit.refreshToken = null;
  save(d);
}

// Token dostepu (~1h) trzymamy tylko w pamieci procesu - tak jak calendar.js.
let cachedAccessToken = null;
let cachedExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiresAt - 30_000) return cachedAccessToken;
  const refreshToken = data().googleFit.refreshToken;
  if (!refreshToken) throw new Error('Google Fit nie jest polaczony - wejdz na /api/googlefit/auth jako wlasciciel.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    if (body.error === 'invalid_grant') disconnect();
    throw new Error(body.error_description || body.error || `HTTP ${res.status}`);
  }
  cachedAccessToken = body.access_token;
  cachedExpiresAt = Date.now() + (Number(body.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Agregat jednego typu danych (kroki/sen/tetno) po dniach, dla ostatnich `days` dni.
 */
async function aggregate({ dataTypeName, startTimeMillis, endTimeMillis }) {
  const token = await getAccessToken();
  const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aggregateBy: [{ dataTypeName }],
      bucketByTime: { durationMillis: 24 * 60 * 60 * 1000 },
      startTimeMillis,
      endTimeMillis,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status}`);
  return body.bucket || [];
}

/**
 * Kroki, sen (w godzinach) i sredni puls z ostatnich `days` dni, po dniach.
 * Kazde z trzech zrodel jest niezalezne - brak jednego (np. zegarek bez
 * pomiaru snu) nie psuje pozostalych.
 */
export async function getRecentData(days = 7) {
  const endTimeMillis = Date.now();
  const startTimeMillis = endTimeMillis - days * 24 * 60 * 60 * 1000;

  const [stepBuckets, sleepBuckets, hrBuckets] = await Promise.all([
    aggregate({ dataTypeName: 'com.google.step_count.delta', startTimeMillis, endTimeMillis }).catch(() => []),
    aggregate({ dataTypeName: 'com.google.sleep.segment', startTimeMillis, endTimeMillis }).catch(() => []),
    aggregate({ dataTypeName: 'com.google.heart_rate.bpm', startTimeMillis, endTimeMillis }).catch(() => []),
  ]);

  const steps = stepBuckets.map((b) => {
    const count = (b.dataset || []).flatMap((ds) => ds.point || []).reduce((sum, p) => sum + (p.value?.[0]?.intVal || 0), 0);
    return { date: dayKey(Number(b.startTimeMillis)), steps: count };
  });

  // Segmenty snu maja wlasny startTimeNanos/endTimeNanos NIEZALEZNY od
  // brzegow wiadra dobowego (sen czesto zaczyna sie przed polnoca) -
  // liczymy wiec dlugosc kazdego segmentu z jego wlasnych znacznikow czasu,
  // a przypisujemy go do dnia, w ktorym wiadro zostalo zwrocone.
  const sleepHours = sleepBuckets.map((b) => {
    const points = (b.dataset || []).flatMap((ds) => ds.point || []);
    const ms = points.reduce((sum, p) => {
      const startNanos = Number(p.startTimeNanos || 0);
      const endNanos = Number(p.endTimeNanos || 0);
      return sum + Math.max(0, (endNanos - startNanos) / 1e6);
    }, 0);
    return { date: dayKey(Number(b.startTimeMillis)), hours: Math.round((ms / 3_600_000) * 10) / 10 };
  });

  const heartRate = hrBuckets.map((b) => {
    const points = (b.dataset || []).flatMap((ds) => ds.point || []);
    const values = points.map((p) => p.value?.[0]?.fpVal).filter((v) => Number.isFinite(v));
    const avg = values.length ? values.reduce((a, v) => a + v, 0) / values.length : null;
    return { date: dayKey(Number(b.startTimeMillis)), avgBpm: avg == null ? null : Math.round(avg) };
  });

  return { steps, sleepHours, heartRate };
}

// --- Router ---
// Eksportuje Router zamiast montowac sie w index.js (patrz raport koncowy
// za wskazowka, gdzie i pod jakim prefiksem to podpiac).
export const router = express.Router();

// Google przekierowuje tutaj BEZ naszych naglowkow autoryzacji (zwykle
// przekierowanie przegladarki), wiec formalnie brak requireOwner - ale
// bezpieczenstwo jest rownowazne: jednorazowy "state" powstaje WYLACZNIE
// po tym, jak wlasciciel przeszedl requireOwner na /auth ponizej. Ten sam
// wzorzec co juz istniejacy /api/calendar/oauth/callback w index.js.
const oauthStates = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

router.get('/auth', requireOwner, (req, res) => {
  if (!isOAuthConfigured()) {
    return res.status(400).json({ error: 'Brak GOOGLE_FIT_CLIENT_ID/GOOGLE_FIT_CLIENT_SECRET/GOOGLE_FIT_REDIRECT_URI w konfiguracji.' });
  }
  const state = globalThis.crypto.randomUUID();
  oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
  res.redirect(authUrl(state));
});

router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expiry = state && oauthStates.get(state);
  if (state) oauthStates.delete(state);
  if (error) return res.status(400).send(`Google Fit: Google zwrocil blad (${error}).`);
  if (!expiry || Date.now() > expiry) return res.status(400).send('Google Fit: nieprawidlowy albo wygasly stan autoryzacji, sprobuj ponownie.');
  if (!code) return res.status(400).send('Google Fit: brak kodu autoryzacji.');
  try {
    await exchangeCode(code);
    res.send('Google Fit polaczony. Mozesz zamknac te karte i wrocic do Jarvisa.');
  } catch (err) {
    res.status(502).send(`Google Fit: nie udalo sie dokonczyc polaczenia (${err.message}).`);
  }
});

router.get('/status', requireOwner, (req, res) => {
  res.json({ configured: isOAuthConfigured(), connected: isConnected() });
});

router.post('/disconnect', requireOwner, (req, res) => {
  disconnect();
  res.json({ ok: true });
});

router.get('/data', requireOwner, async (req, res) => {
  if (!isConnected()) return res.status(400).json({ error: 'Google Fit nie jest polaczony.' });
  try {
    const days = Math.max(1, Math.min(30, Number(req.query.days) || 7));
    res.json(await getRecentData(days));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
