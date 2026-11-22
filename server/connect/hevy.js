// Hevy (aplikacja do zapisywania treningow): publiczne API https://api.hevyapp.com.
// Dwa sposoby polaczenia:
//  - klucz osobisty (HEVY_API_KEY z developers.hevy.com/api-key) w naglowku "api-key": wymaga Hevy Pro,
//  - wlasna aplikacja OAuth (HEVY_CLIENT_ID + HEVY_CLIENT_SECRET z developers.hevy.com/apps): logowanie
//    kontem Hevy, token na godzine i token odswiezania w pamieci serwera.
// Sekrety tylko w zmiennych srodowiskowych serwera (Render -> Environment), nie w czacie.
// Limit: 1000 zapytan na 5 minut z jednego IP, wiec synchronizacja co 20 minut jest daleko od niego.
import crypto from 'node:crypto';
import * as memory from '../memory/memory.js';

// HEVY_API_URL i HEVY_AUTH_URL tylko do prob z lokalna atrapa.
const BASE = () => process.env.HEVY_API_URL || 'https://api.hevyapp.com';
const AUTH_BASE = () => process.env.HEVY_AUTH_URL || 'https://hevy.com';
const env = (k) => String(process.env[k] || '').trim();

export const hasKey = () => Boolean(env('HEVY_API_KEY'));
export const oauthConfigured = () => Boolean(env('HEVY_CLIENT_ID') && env('HEVY_CLIENT_SECRET'));
const auth = () => memory.load().hevyAuth || null;
/** Czy jest czym pytac API: klucz albo konto polaczone przez OAuth. */
export const isConfigured = () => hasKey() || Boolean(oauthConfigured() && auth()?.refresh);
export const mode = () => (hasKey() ? 'klucz' : isConfigured() ? 'oauth' : '');

export class HevyError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ---------- OAuth ----------
const states = new Map();
const STATE_TTL = 10 * 60 * 1000;

/** Adres zgody w Hevy. redirectUri musi byc dokladnie tym, co wpisano w aplikacji na developers.hevy.com. */
export function authUrl(redirectUri) {
  for (const [k, v] of states) if (Date.now() - v.at > STATE_TTL) states.delete(k);
  const state = crypto.randomBytes(16).toString('hex');
  states.set(state, { at: Date.now(), redirectUri });
  const p = new URLSearchParams({ client_id: env('HEVY_CLIENT_ID'), redirect_uri: redirectUri, state });
  return `${AUTH_BASE()}/oauth/authorize?${p.toString()}`;
}

let cached = null; // { token, exp }
let refreshing = null;

async function tokenRequest(body) {
  let res;
  try {
    res = await fetch(`${AUTH_BASE()}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...body, client_id: env('HEVY_CLIENT_ID'), client_secret: env('HEVY_CLIENT_SECRET') }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new HevyError(`Hevy nie odpowiada (${e.message}).`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new HevyError(`Hevy odrzucił logowanie: ${data.error_description || data.error || `HTTP ${res.status}`}.`, [400, 401].includes(res.status) ? 401 : res.status);
  return data;
}

function remember(data) {
  const d = memory.load();
  // Token odswiezania dziala raz: nowy zapisujemy, zanim uzyjemy nowego tokenu dostepu.
  d.hevyAuth = { ...(d.hevyAuth || {}), refresh: data.refresh_token || d.hevyAuth?.refresh, ...(data.user_id && { userId: String(data.user_id) }), ...(data.username && { username: String(data.username).slice(0, 60) }), at: Date.now() };
  memory.save(d);
  cached = { token: data.access_token, exp: Date.now() + ((Number(data.expires_in) || 3600) - 60) * 1000 };
}

export async function exchangeCode(code, state) {
  const entry = states.get(state);
  states.delete(state);
  if (!entry || Date.now() - entry.at > STATE_TTL) throw new HevyError('Nieprawidłowy albo wygasły stan logowania: połącz jeszcze raz.', 400);
  remember(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: entry.redirectUri }));
}

/** Token dostepu; odswiezanie tylko z jednego miejsca naraz, jak wymaga Hevy. */
async function accessToken(force = false) {
  if (!force && cached && Date.now() < cached.exp) return cached.token;
  if (!refreshing) {
    refreshing = (async () => {
      const refresh = auth()?.refresh;
      if (!refresh) throw new HevyError('Hevy niepołączone.', 401);
      try {
        remember(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }));
      } catch (e) {
        // Odrzucony token odswiezania nie zadziala juz nigdy: trzeba polaczyc od nowa.
        if (e.status === 401) disconnect();
        throw e;
      }
      return cached.token;
    })().finally(() => (refreshing = null));
  }
  return refreshing;
}

export function disconnect() {
  const d = memory.load();
  delete d.hevyAuth;
  memory.save(d);
  cached = null;
}

// ---------- API ----------
/** GET z kluczem albo tokenem, czytelne bledy po polsku. query: obiekt parametrow. */
export async function hevyGet(path, query = {}, retried = false) {
  if (!isConfigured()) throw new HevyError('Hevy niepołączone: połącz konto w module Trening (panel Hevy).', 0);
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  const headers = { accept: 'application/json' };
  if (hasKey()) headers['api-key'] = env('HEVY_API_KEY');
  else headers.Authorization = `Bearer ${await accessToken()}`;
  let res;
  try {
    res = await fetch(`${BASE()}${path}${qs ? `?${qs}` : ''}`, { headers, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new HevyError(`Hevy nie odpowiada (${e.name === 'TimeoutError' ? 'przekroczony czas' : e.message}).`, 0);
  }
  // Token wygasl wczesniej niz zapowiadal: jedno odswiezenie i powtorka.
  if (res.status === 401 && !hasKey() && !retried) {
    cached = null;
    await accessToken(true);
    return hevyGet(path, query, true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new HevyError(hasKey() ? 'Hevy odrzuca klucz API: sprawdź HEVY_API_KEY (klucz z developers.hevy.com/api-key, wymaga Hevy Pro).' : 'Hevy odmawia dostępu: sprawdź zakresy aplikacji (read-workout, read-routine, read-exercise, read-body-measurement, read-profile) albo połącz konto ponownie.', res.status);
  }
  if (res.status === 404) throw new HevyError('Hevy: nie znaleziono.', 404);
  if (res.status === 429) throw new HevyError('Hevy: za dużo zapytań, spróbuję później.', 429);
  if (!res.ok) throw new HevyError(`Hevy: błąd ${res.status}.`, res.status);
  return res.json();
}

export const userInfo = async () => (await hevyGet('/v1/user/info'))?.data || null;
export const workoutCount = async () => (await hevyGet('/v1/workouts/count'))?.workout_count ?? 0;
/** Strona treningow, najnowsze pierwsze (maks. 10 na strone). */
export const workoutsPage = (page = 1) => hevyGet('/v1/workouts', { page, pageSize: 10 });
/** Zmiany (updated z calym treningiem, deleted z id) od podanej chwili ISO, najnowsze pierwsze. */
export const eventsPage = (since, page = 1) => hevyGet('/v1/workouts/events', { since, page, pageSize: 10 });
export const exerciseTemplate = (id) => hevyGet(`/v1/exercise_templates/${encodeURIComponent(id)}`);
export const routinesPage = (page = 1) => hevyGet('/v1/routines', { page, pageSize: 10 });
export const bodyPage = (page = 1) => hevyGet('/v1/body_measurements', { page, pageSize: 10 });
