// Integracja z Outlook/Microsoft 365 Calendar przez Microsoft Graph API.
//
// Struktura celowo lustrzana wobec server/calendar.js (Google) - ten sam
// wzorzec OAuth2 "authorization code" + refresh token trzymany trwale, ta
// sama filozofia "zero dodatkowych zaleznosci" (surowy fetch zamiast SDK
// @azure/msal-node, ktory dokladalby zaleznosci do listy/tworzenia zdarzen).
//
// Roznice wobec Google wynikaja z samego Graph API:
// - endpoint tokenu jest wspolny dla wszystkich najemcow (tenant "common"),
//   wiec dziala zarowno dla kont osobistych, jak i firmowych/szkolnych;
// - do listowania zdarzen w zakresie dat Graph poleca /calendarView (a nie
//   filtrowanie /events recznym OData), bo poprawnie rozwija wydarzenia
//   cykliczne na konkretne wystapienia.

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';

const CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.OUTLOOK_REDIRECT_URI || '';
const SCOPE = 'offline_access Calendars.ReadWrite';
const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export function isOAuthConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

// --- Wlasny namespace w pamieci (bez edycji memory.js) ---
function loadNs() {
  const data = memory.load();
  if (!data.outlookCalendar || typeof data.outlookCalendar !== 'object') {
    data.outlookCalendar = { refreshToken: null };
  }
  return data;
}

function getRefreshToken() {
  return loadNs().outlookCalendar.refreshToken || null;
}

function setRefreshToken(token) {
  const data = loadNs();
  data.outlookCalendar.refreshToken = token || null;
  memory.save(data);
}

export function isConnected() {
  return Boolean(getRefreshToken());
}

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  if (!data.refresh_token) {
    throw new Error('Microsoft nie zwrocil refresh_token - sprobuj polaczyc ponownie (upewnij sie, ze scope obejmuje offline_access).');
  }
  setRefreshToken(data.refresh_token);
  return true;
}

// Token dostepu zyje krotko - odswiezamy go tylko w pamieci procesu, tak
// samo jak w server/calendar.js.
let cachedAccessToken = null;
let cachedExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiresAt - 30_000) return cachedAccessToken;
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('Outlook Calendar nie jest polaczony - wejdz na /api/outlook/auth jako wlasciciel.');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant zwykle znaczy odwolany dostep - czyscimy token, zeby
    // kolejna proba od razu poprosila o zgode od nowa.
    if (data.error === 'invalid_grant') setRefreshToken(null);
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  }
  cachedAccessToken = data.access_token;
  cachedExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  // Microsoft czasem wydaje nowy refresh_token przy odswiezaniu (rotacja) -
  // trzeba go zapisac, inaczej stary przestanie dzialac przy kolejnej probie.
  if (data.refresh_token && data.refresh_token !== refreshToken) setRefreshToken(data.refresh_token);
  return cachedAccessToken;
}

async function graphFetch(pathAndQuery, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}/${pathAndQuery}`, {
    ...init,
    // Bez naglowka Prefer: outlook.timezone - Graph domyslnie zwraca
    // start/end w UTC (dateTime bez sufiksu "Z"), co pozwala bezpiecznie
    // dokleic go samemu i miec spojny format ISO z reszta projektu.
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

function toIsoUtc(dateTimeNoZone) {
  if (!dateTimeNoZone) return null;
  return dateTimeNoZone.endsWith('Z') ? dateTimeNoZone : `${dateTimeNoZone}Z`;
}

/** Nadchodzace wydarzenia z Outlooka, od teraz do +daysAhead dni. */
export async function listUpcoming(maxResults = 10, daysAhead = 14) {
  const now = new Date();
  const until = new Date(now.getTime() + Math.max(1, daysAhead) * 24 * 60 * 60 * 1000);
  const p = new URLSearchParams({
    startDateTime: now.toISOString(),
    endDateTime: until.toISOString(),
    $orderby: 'start/dateTime',
    $top: String(Math.max(1, Math.min(50, maxResults))),
  });
  const data = await graphFetch(`me/calendarView?${p.toString()}`);
  return (data.value || []).map((e) => ({
    id: e.id,
    title: e.subject || '(bez tytulu)',
    start: toIsoUtc(e.start?.dateTime),
    end: toIsoUtc(e.end?.dateTime),
    allDay: Boolean(e.isAllDay),
    location: e.location?.displayName || null,
  }));
}

/**
 * @param {{title:string, startISO:string, endISO?:string, description?:string}} spec
 */
export async function createEvent({ title, startISO, endISO, description }) {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) throw new Error('Nieprawidlowa data poczatku.');
  const end = endISO && !Number.isNaN(new Date(endISO).getTime()) ? new Date(endISO) : new Date(start.getTime() + 60 * 60 * 1000);

  const data = await graphFetch('me/events', {
    method: 'POST',
    body: JSON.stringify({
      subject: String(title || '').slice(0, 200) || 'Wydarzenie',
      body: description ? { contentType: 'text', content: String(description).slice(0, 1000) } : undefined,
      start: { dateTime: start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: end.toISOString(), timeZone: 'UTC' },
    }),
  });
  return { id: data.id, webLink: data.webLink };
}

// =====================================================================
// Router HTTP - eksportowany, NIE montowany tutaj. Zamontuj w index.js:
//   import { router as outlookRouter } from './server/outlookCalendar.js';
//   app.use('/api/outlook', outlookRouter);
// =====================================================================

export const router = express.Router();

const oauthStates = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

router.get('/auth', requireOwner, (req, res) => {
  if (!isOAuthConfigured()) {
    return res.status(400).json({ error: 'Brak OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET/OUTLOOK_REDIRECT_URI w konfiguracji.' });
  }
  const state = globalThis.crypto.randomUUID();
  oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
  res.redirect(authUrl(state));
});

// Bez requireOwner z tego samego powodu co w calendar.js: Microsoft
// przekierowuje tu przegladarke wlasciciela BEZ naszych naglowkow -
// bezpieczenstwo daje jednorazowy "state" wydany tylko po przejsciu
// requireOwner na /auth powyzej.
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const expiry = state && oauthStates.get(state);
  if (state) oauthStates.delete(state);
  if (error) return res.status(400).send(`Outlook: Microsoft zwrocil blad (${error}: ${errorDescription || ''}).`);
  if (!expiry || Date.now() > expiry) return res.status(400).send('Outlook: nieprawidlowy albo wygasly stan autoryzacji, sprobuj ponownie.');
  if (!code) return res.status(400).send('Outlook: brak kodu autoryzacji.');
  try {
    await exchangeCode(code);
    res.send('Outlook Calendar polaczony. Mozesz zamknac te karte i wrocic do Jarvisa.');
  } catch (err) {
    res.status(502).send(`Outlook: nie udalo sie dokonczyc polaczenia (${err.message}).`);
  }
});

router.get('/status', requireOwner, (req, res) => {
  res.json({ configured: isOAuthConfigured(), connected: isConnected() });
});

router.get('/events', requireOwner, async (req, res) => {
  try {
    res.json(await listUpcoming(Number(req.query.limit) || 10, Number(req.query.daysAhead) || 14));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/events', requireOwner, async (req, res) => {
  try {
    const { title, startISO, endISO, description } = req.body || {};
    res.status(201).json(await createEvent({ title, startISO, endISO, description }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
