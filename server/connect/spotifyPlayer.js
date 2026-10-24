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
const SCOPE = 'user-modify-playback-state user-read-playback-state';

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function refreshToken() {
  return memory.load().spotifyRefreshToken || process.env.SPOTIFY_REFRESH_TOKEN || null;
}

export function isConnected() {
  return Boolean(refreshToken());
}

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
  memory.save(d);
  cached = { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
}

export function disconnect() {
  const d = memory.load();
  d.spotifyRefreshToken = null;
  memory.save(d);
  cached = null;
}

let cached = null;

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
  cached = { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cached.token;
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

/** Odtwarza podany utwor (uri) na aktywnym urzadzeniu albo - gdy zadne nie jest aktywne - na komputerze/pierwszym z listy. */
export async function playUri(uri) {
  const list = await devices();
  if (!list.length) throw new Error('Spotify nie jest uruchomione na zadnym urzadzeniu - otworz aplikacje Spotify na komputerze albo telefonie.');
  const target = list.find((d) => d.is_active) || list.find((d) => d.type === 'Computer') || list[0];
  try {
    await api('PUT', `/me/player/play?device_id=${encodeURIComponent(target.id)}`, { uris: [uri] });
  } catch (e) {
    if (e.status === 403) throw new Error('Spotify odmawia sterowania odtwarzaniem - to wymaga konta Premium.');
    throw e;
  }
  return { device: target.name };
}
