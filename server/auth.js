// Konta: wlasciciel (Milosz) vs gosc.
//
// Wlasciciel loguje sie haslem i dostaje podpisany token sesji. Dopiero
// wtedy Jarvis ma dostep do rzeczy wrazliwych: pamieci o uzytkowniku,
// zadan, przypomnien, kamery i sterowania urzadzeniem. Gosc (bez hasla)
// moze normalnie rozmawiac, pytac o pogode i szukac w sieci - ale nie
// dotknie danych ani urzadzenia.
//
// Blokada jest po stronie SERWERA (model dostaje tylko te narzedzia, do
// ktorych rola ma prawo, a wrazliwe endpointy odrzucaja gosci) - blokada
// w interfejsie to tylko wygoda, nie zabezpieczenie.

import crypto from 'crypto';

const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.createHash('sha256').update(`jarvis:${OWNER_PASSWORD}`).digest('hex');
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dni

export function isAuthConfigured() {
  return OWNER_PASSWORD.length > 0;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPassword(password) {
  if (!isAuthConfigured()) return false;
  return safeEqual(password || '', OWNER_PASSWORD);
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

export function issueToken() {
  const expires = Date.now() + TOKEN_TTL_MS;
  const payload = `owner.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function isOwnerToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, expiresRaw, signature] = parts;
  if (role !== 'owner') return false;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  return safeEqual(signature, sign(`${role}.${expiresRaw}`));
}

// Token moze przyjsc naglowkiem (zwykle zapytania) albo parametrem URL
// (WebSocket, ktory nie pozwala ustawic wlasnych naglowkow w przegladarce).
export function roleFromRequest(req) {
  const header = req.headers?.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const queryToken = req.query?.token || null;
  return isOwnerToken(bearer) || isOwnerToken(queryToken) ? 'owner' : 'guest';
}

export function requireOwner(req, res, next) {
  if (roleFromRequest(req) !== 'owner') {
    return res.status(403).json({ error: 'Funkcja tylko dla zalogowanego wlasciciela.' });
  }
  next();
}
