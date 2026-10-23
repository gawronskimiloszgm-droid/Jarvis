// Integracja z Gmail API - czyste REST wywolania (bez pakietu googleapis),
// ten sam minimalizm co server/calendar.js (wzor strukturalny OAuth
// "authorization code" - czytaj tamten plik, nie edytuj).
//
// Osobny klient OAuth (GMAIL_CLIENT_ID/SECRET) niz kalendarz, mimo ze oba
// to Google - inny zestaw scope'ow (gmail.readonly + gmail.send) i osobny
// refresh token w pamieci (klucz gmailRefreshToken, nie googleRefreshToken
// kalendarza), zeby wlaczenie/wylaczenie jednej integracji nie psulo
// drugiej - gdyby dzielily jeden klucz, druga zgoda nadpisywalaby refresh
// token pierwszej.

import * as memory from '../memory/memory.js';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || '';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';

export function isOAuthConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

function getRefreshToken() {
  return memory.load().gmailRefreshToken || null;
}

function setRefreshToken(token) {
  const data = memory.load();
  data.gmailRefreshToken = token || null;
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
  setRefreshToken(data.refresh_token);
  return true;
}

// Token dostepu żyje krotko (~1h) - odswiezamy go w pamieci procesu, nie w
// trwalym magazynie, bo i tak trzeba go bedzie za chwile wymienic ponownie.
let cachedAccessToken = null;
let cachedExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiresAt - 30_000) return cachedAccessToken;
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('Gmail nie jest polaczony - wejdz na /api/comms/gmail/auth jako wlasciciel.');

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
    if (data.error === 'invalid_grant') setRefreshToken(null);
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  }
  cachedAccessToken = data.access_token;
  cachedExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

async function gmailFetch(pathAndQuery, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

let cachedEmailAddress = null;

/** Adres wlasciciela skrzynki - potrzebny do rozpoznania "czy ostatnia wiadomosc w watku to moja odpowiedz". */
export async function getOwnEmailAddress() {
  if (cachedEmailAddress) return cachedEmailAddress;
  const data = await gmailFetch('profile');
  cachedEmailAddress = data.emailAddress || null;
  return cachedEmailAddress;
}

function headerValue(headers, name) {
  const h = (headers || []).find((x) => String(x.name || '').toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

/** Ostatnie N wiadomosci ze skrzynki odbiorczej - same metadane + snippet, NIE cala tresc. */
export async function listRecentInboxMessages(limit = 10) {
  const max = Math.max(1, Math.min(25, Number(limit) || 10));
  const p = new URLSearchParams({ maxResults: String(max), labelIds: 'INBOX', q: '-in:chats' });
  const list = await gmailFetch(`messages?${p.toString()}`);
  const ids = (list.messages || []).map((m) => m.id);

  const out = [];
  for (const id of ids) {
    const mp = new URLSearchParams({ format: 'metadata' });
    mp.append('metadataHeaders', 'Subject');
    mp.append('metadataHeaders', 'From');
    mp.append('metadataHeaders', 'Date');
    const msg = await gmailFetch(`messages/${id}?${mp.toString()}`);
    out.push({
      id: msg.id,
      threadId: msg.threadId,
      subject: headerValue(msg.payload?.headers, 'Subject') || '(bez tematu)',
      from: headerValue(msg.payload?.headers, 'From') || '(nieznany nadawca)',
      date: headerValue(msg.payload?.headers, 'Date') || null,
      snippet: msg.snippet || '',
      unread: (msg.labelIds || []).includes('UNREAD'),
    });
  }
  return out;
}

/**
 * Watki w skrzynce odbiorczej, ktorych OSTATNIA wiadomosc jest OD kogos
 * innego (nie od wlasciciela) i starsza niz `days` dni - kandydaci na
 * "nie odpisales od X dni".
 */
export async function listInboxThreadsOlderThan(days = 3, maxThreads = 30) {
  const p = new URLSearchParams({
    maxResults: String(Math.max(1, Math.min(50, maxThreads))),
    labelIds: 'INBOX',
    q: 'newer_than:30d -in:chats',
  });
  const list = await gmailFetch(`threads?${p.toString()}`);
  const ids = (list.threads || []).map((t) => t.id);
  const own = await getOwnEmailAddress();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const results = [];
  for (const id of ids) {
    const mp = new URLSearchParams({ format: 'metadata' });
    mp.append('metadataHeaders', 'Subject');
    mp.append('metadataHeaders', 'From');
    mp.append('metadataHeaders', 'Date');
    const thread = await gmailFetch(`threads/${id}?${mp.toString()}`);
    const messages = thread.messages || [];
    if (!messages.length) continue;
    const last = messages[messages.length - 1];
    const fromHeader = headerValue(last.payload?.headers, 'From');
    const isFromOwner = Boolean(own) && fromHeader.toLowerCase().includes(own.toLowerCase());
    const ts = Number(last.internalDate) || 0;
    if (!isFromOwner && ts > 0 && ts <= cutoff) {
      results.push({
        threadId: id,
        subject: headerValue(last.payload?.headers, 'Subject') || '(bez tematu)',
        from: fromHeader || '(nieznany nadawca)',
        lastMessageAt: new Date(ts).toISOString(),
      });
    }
  }
  return results;
}

/**
 * Budowa i wyslanie prostej wiadomosci tekstowej (raw MIME, base64url) -
 * jedyna funkcja w tym pliku, ktora REALNIE cos wysyla. Wolana wylacznie
 * z endpointu POST /send w gmail.js, ktory wymaga jawnego confirm:true.
 */
export async function sendPlainTextMessage({ to, subject, body, threadId, inReplyTo }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject || ''}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }
  lines.push('', body || '');

  const raw = Buffer.from(lines.join('\r\n'), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const payload = { raw };
  if (threadId) payload.threadId = threadId;
  const data = await gmailFetch('messages/send', { method: 'POST', body: JSON.stringify(payload) });
  return { id: data.id, threadId: data.threadId };
}
