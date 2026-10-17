// Integracja z Google Calendar - czyste REST wywolania (bez pakietu
// googleapis, ktory dokladalby kilkadziesiat MB zaleznosci do jednej
// prostej rzeczy: listy i tworzenia wydarzen). Ten sam minimalizm co
// reszta projektu.
//
// Autoryzacja to klasyczny OAuth2 "authorization code" z Google - JEDNORAZOWA
// czynnosc, ktora musi wykonac sam wlasciciel w przegladarce (logowanie do
// wlasnego konta Google i zgoda na dostep). Serwer nie moze i nie powinien
// robic tego za niego - stad endpoint /api/calendar/auth w index.js, ktory
// tylko przekierowuje do ekranu zgody Google.
//
// Po zgodzie Google oddaje "refresh token", ktory trzymamy w tej samej
// trwalej pamieci co reszta stanu (memory.js) - z niego zawsze da sie
// dorobic swiezy token dostepu, wiec zgoda jest potrzebna tylko raz.

import * as memory from '../memory/memory.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export function isOAuthConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

export function isConnected() {
  return Boolean(memory.getGoogleRefreshToken());
}

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    // "consent" wymusza wydanie refresh_token TAKZE przy powtornej zgodzie -
    // bez tego Google przy kolejnym logowaniu zwraca sam access_token.
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  if (!data.refresh_token) {
    throw new Error('Google nie zwrocil refresh_token - odwolaj dostep aplikacji na myaccount.google.com i sprobuj ponownie.');
  }
  memory.setGoogleRefreshToken(data.refresh_token);
  return true;
}

// Token dostepu żyje krotko (~1h) - odswiezamy go w pamieci procesu, nie w
// trwalym magazynie, bo i tak trzeba go bedzie za chwile wymienic ponownie.
let cachedAccessToken = null;
let cachedExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiresAt - 30_000) return cachedAccessToken;
  const refreshToken = memory.getGoogleRefreshToken();
  if (!refreshToken) throw new Error('Kalendarz nie jest polaczony - wejdz na /api/calendar/auth jako wlasciciel.');

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
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant zwykle znaczy: dostep odwolany po stronie Google -
    // czyszczenie tokena, zeby kolejna proba od razu poprosila o zgode
    // od nowa, zamiast pekac cicho w kolko.
    if (data.error === 'invalid_grant') memory.setGoogleRefreshToken(null);
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  }
  cachedAccessToken = data.access_token;
  cachedExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

async function calendarFetch(pathAndQuery, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

/** Nadchodzace wydarzenia, od teraz. */
export async function listUpcoming(maxResults = 10) {
  const p = new URLSearchParams({
    timeMin: new Date().toISOString(),
    maxResults: String(Math.max(1, Math.min(25, maxResults))),
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  const data = await calendarFetch(`calendars/primary/events?${p.toString()}`);
  return (data.items || []).map((e) => ({
    id: e.id,
    title: e.summary || '(bez tytulu)',
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    allDay: Boolean(e.start?.date && !e.start?.dateTime),
    location: e.location || null,
  }));
}

/**
 * @param {{title:string, startISO:string, endISO?:string, description?:string}} spec
 */
export async function createEvent({ title, startISO, endISO, description }) {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) throw new Error('Nieprawidlowa data poczatku.');
  const end = endISO && !Number.isNaN(new Date(endISO).getTime()) ? new Date(endISO) : new Date(start.getTime() + 60 * 60 * 1000);

  const data = await calendarFetch('calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: String(title || '').slice(0, 200) || 'Wydarzenie',
      description: description ? String(description).slice(0, 1000) : undefined,
      start: { dateTime: start.toISOString(), timeZone: 'Europe/Warsaw' },
      end: { dateTime: end.toISOString(), timeZone: 'Europe/Warsaw' },
    }),
  });
  return { id: data.id, htmlLink: data.htmlLink };
}
