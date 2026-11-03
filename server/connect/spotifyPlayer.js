// Sterowanie odtwarzaniem Spotify przez oficjalne Web API (konto Premium).
//
// Dlaczego nie samo otwarcie linku spotify:track:...? Aplikacja Spotify (zwlaszcza
// wersja ze Sklepu Microsoft) potrafi ten link zignorowac i grac dalej to, co grala.
// API "start playback" robi to niezawodnie i dziala na dowolnym urzadzeniu konta
// (komputer, telefon), wiec "graj X" z telefonu odpali muzyke na komputerze.
//
// Wymaga JEDNORAZOWEJ zgody wlasciciela (OAuth "authorization code") - refresh token
// trzymamy w pamieci jak token Kalendarza Google.

import crypto from 'crypto';
import * as memory from '../memory/memory.js';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
// Kolejka, playlisty, polubienia i historia (spotifyMore.js) potrzebuja wiecej niz samo sterowanie.
const SCOPE = 'user-modify-playback-state user-read-playback-state playlist-read-private user-library-modify user-library-read user-read-recently-played';

/** Uprawnienia, ktore Spotify faktycznie dalo; null, gdy jeszcze nie wiadomo (stare polaczenie przed odswiezeniem tokenu). */
export function spotifyScopes() {
  const s = memory.load().spotifyScope;
  return typeof s === 'string' ? s.split(/\s+/).filter(Boolean) : null;
}

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function refreshToken() {
  return memory.load().spotifyRefreshToken || process.env.SPOTIFY_REFRESH_TOKEN || null;
}

export function isConnected() {
  return Boolean(refreshToken());
}

// Ostatni token dostepu (zyje ok. godziny).
let cached = null;

const states = new Map();
const STATE_TTL = 10 * 60 * 1000;

/** Adres ekranu zgody; redirect musi byc DOKLADNIE tym, co wpisano w panelu aplikacji Spotify. */
export function authUrl(redirectUri) {
  const state = crypto.randomBytes(16).toString('hex');
  states.set(state, { at: Date.now(), redirectUri });
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    show_dialog: 'true',
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
}

function basic() {
  return `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
}

export async function exchangeCode(code, state) {
  const entry = states.get(state);
  states.delete(state);
  if (!entry || Date.now() - entry.at > STATE_TTL) throw new Error('Nieprawidlowy albo wygasly stan autoryzacji - sprobuj polaczyc jeszcze raz.');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic() },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: entry.redirectUri }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  const d = memory.load();
  d.spotifyRefreshToken = data.refresh_token;
  if (typeof data.scope === 'string') d.spotifyScope = data.scope;
  memory.save(d);
  cached = { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
}

export function disconnect() {
  const d = memory.load();
  d.spotifyRefreshToken = null;
  memory.save(d);
  cached = null;
}

async function userToken() {
  if (cached && Date.now() < cached.exp - 30_000) return cached.token;
  const rt = refreshToken();
  if (!rt) throw new Error('Spotify nie jest polaczone - polacz konto w Ustawieniach (Muzyka).');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'invalid_grant') disconnect();
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  }
  if (data.refresh_token) {
    const d = memory.load();
    d.spotifyRefreshToken = data.refresh_token;
    memory.save(d);
  }
  if (typeof data.scope === 'string' && memory.load().spotifyScope !== data.scope) {
    const d = memory.load();
    d.spotifyScope = data.scope;
    memory.save(d);
  }
  cached = { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cached.token;
}

export async function spotifyApi(method, path, body) {
  return api(method, path, body);
}

async function api(method, path, body) {
  const token = await userToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.reason = data.error?.reason;
    throw err;
  }
  return data;
}

export async function devices() {
  const d = await api('GET', '/me/player/devices');
  return d.devices || [];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Prosba z komputera ma grac na komputerze, nawet gdy konto ma aktywny telefon albo inny odtwarzacz. */
function pickDevice(all, komputer) {
  const list = all.filter((d) => !d.is_restricted);
  if (komputer) return list.find((d) => d.type === 'Computer' && d.is_active) || list.find((d) => d.type === 'Computer') || null;
  return list.find((d) => d.is_active) || list.find((d) => d.type === 'Computer') || list[0] || null;
}

/** Spotify odpowiada 204 takze wtedy, gdy nic sie nie zmienilo, wiec sprawdzamy, co naprawde gra. */
async function confirmPlaying(uri, target, tries = 4, gapMs = 700) {
  let state = null;
  for (let i = 0; i < tries; i++) {
    await wait(gapMs);
    try {
      state = await api('GET', '/me/player?additional_types=track');
    } catch {
      return; // nie da sie odczytac stanu: polecenie przyjeto, wiec nie zglaszamy bledu na zapas
    }
    const item = state?.item;
    const same = item?.uri === uri || item?.linked_from?.uri === uri || state?.context?.uri === uri;
    if (same && state.is_playing && state.device?.id === target.id) return;
  }
  throw new Error(`Spotify przyjęło polecenie, ale na „${target.name}” nie zagrało.`);
}

/** Playlista albo album od poczatku, z tym samym wyborem urzadzenia i sprawdzeniem co playUri. */
export async function playContext(contextUri, { komputer = false, gapMs = 700 } = {}) {
  const target = pickDevice(await devices(), komputer);
  if (!target) throw new Error(komputer ? 'Spotify nie jest uruchomione na tym komputerze.' : 'Spotify nie jest uruchomione na żadnym urządzeniu.');
  try {
    await api('PUT', `/me/player/play?device_id=${encodeURIComponent(target.id)}`, { context_uri: contextUri });
  } catch (e) {
    if (e.status === 403) throw new Error('Spotify odmawia sterowania odtwarzaniem - to wymaga konta Premium.');
    throw e;
  }
  await confirmPlaying(contextUri, target, 4, gapMs);
  return { device: target.name };
}

/**
 * Odtwarza podany utwor (uri). Domyslnie na aktywnym urzadzeniu, z { komputer: true } na komputerze.
 * Blad oznacza, ze nie gra: klient otwiera wtedy link w aplikacji.
 */
export async function playUri(uri, { komputer = false, gapMs = 700 } = {}) {
  const list = await devices();
  const target = pickDevice(list, komputer);
  if (!target) throw new Error(komputer ? 'Spotify nie jest uruchomione na tym komputerze.' : 'Spotify nie jest uruchomione na zadnym urzadzeniu - otworz aplikacje Spotify na komputerze albo telefonie.');
  try {
    await api('PUT', `/me/player/play?device_id=${encodeURIComponent(target.id)}`, { uris: [uri] });
  } catch (e) {
    if (e.status === 403) throw new Error('Spotify odmawia sterowania odtwarzaniem - to wymaga konta Premium.');
    throw e;
  }
  await confirmPlaying(uri, target, 4, gapMs);
  return { device: target.name };
}

/** Co teraz gra (albo null, gdy nic). */
export async function nowPlaying() {
  const d = await api('GET', '/me/player?additional_types=track,episode');
  if (!d || !d.item) return { playing: false, device: d?.device?.name || null };
  const it = d.item;
  return {
    playing: Boolean(d.is_playing),
    track: it.name,
    artist: (it.artists || []).map((a) => a.name).join(', ') || it.show?.name || '',
    album: it.album?.name || '',
    image: it.album?.images?.[it.album.images.length > 1 ? 1 : 0]?.url || null,
    progressMs: d.progress_ms || 0,
    durationMs: it.duration_ms || 0,
    device: d.device?.name || null,
    volume: d.device?.volume_percent ?? null,
    uri: it.uri,
  };
}

async function withDevice(fn) {
  try {
    return await fn('');
  } catch (e) {
    // Brak aktywnego urzadzenia - wybieramy komputer albo pierwsze z listy i ponawiamy.
    if (e.status !== 404) throw e;
    const list = await devices();
    if (!list.length) throw new Error('Spotify nie jest uruchomione na zadnym urzadzeniu.');
    const target = list.find((d) => d.type === 'Computer') || list[0];
    return fn(`device_id=${encodeURIComponent(target.id)}`);
  }
}

/** Sterowanie: play | pause | next | prev | volume (value 0-100) | up | down. */
export async function control(cmd, value) {
  const q = (extra, more) => [extra, more].filter(Boolean).join('&');
  try {
    switch (cmd) {
      case 'play':
        return await withDevice((dev) => api('PUT', `/me/player/play${dev ? `?${dev}` : ''}`));
      case 'pause':
        return await withDevice((dev) => api('PUT', `/me/player/pause${dev ? `?${dev}` : ''}`));
      case 'next':
        return await withDevice((dev) => api('POST', `/me/player/next${dev ? `?${dev}` : ''}`));
      case 'prev':
        return await withDevice((dev) => api('POST', `/me/player/previous${dev ? `?${dev}` : ''}`));
      case 'up':
      case 'down':
      case 'volume': {
        let v = Number(value);
        if (cmd !== 'volume') {
          const now = await nowPlaying().catch(() => null);
          const cur = Number.isFinite(now?.volume) ? now.volume : 50;
          v = cur + (cmd === 'up' ? 1 : -1) * (Number(value) || 15);
        }
        v = Math.max(0, Math.min(100, Math.round(v)));
        await withDevice((dev) => api('PUT', `/me/player/volume?${q(`volume_percent=${v}`, dev)}`));
        return { volume: v };
      }
      default:
        throw new Error('Nieznane polecenie odtwarzacza.');
    }
  } catch (e) {
    if (e.status === 403) throw new Error('Spotify odmawia sterowania - wymaga konta Premium (albo nic nie jest wybrane do grania).');
    throw e;
  }
}
