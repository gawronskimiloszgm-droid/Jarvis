// Rozroznienie "wlasciciel vs gosc" juz istnieje w auth.js (roleFromRequest) -
// nie ma tu zadnej probki identyfikacji po glosie (technicznie niemozliwe
// bez modelu diaryzacji mowcy). To co dokladamy to PROSTY log: kto
// (jaka rola) rozmawial z Jarvisem i kiedy, do wgladu przez wlasciciela.

import express from 'express';
import { load, save } from './memory.js';
import { requireOwner, roleFromRequest } from './auth.js';

const MAX_ENTRIES = 2000;

function ensureNamespace() {
  const data = load();
  if (!data.voiceConversation) data.voiceConversation = {};
  if (!Array.isArray(data.voiceConversation.sessions)) data.voiceConversation.sessions = [];
  return data;
}

/**
 * Zapisuje jedno rozpoczecie sesji (glosowej lub czatu) wraz z rola
 * ustalona po stronie serwera z tokenu - nie ufamy roli podanej przez
 * klienta w tresci zapytania.
 */
export function logSession(role, channel = 'voice') {
  const data = ensureNamespace();
  const entry = {
    at: Date.now(),
    role: role === 'owner' ? 'owner' : 'guest',
    channel: channel === 'chat' ? 'chat' : 'voice',
  };
  data.voiceConversation.sessions.push(entry);
  if (data.voiceConversation.sessions.length > MAX_ENTRIES) {
    data.voiceConversation.sessions.splice(0, data.voiceConversation.sessions.length - MAX_ENTRIES);
  }
  save(data);
  return entry;
}

export function getSessions(limit = 100) {
  const data = ensureNamespace();
  return data.voiceConversation.sessions.slice(-Math.max(1, Math.min(MAX_ENTRIES, limit))).reverse();
}

export function sessionSummary() {
  const list = ensureNamespace().voiceConversation.sessions;
  const byRole = { owner: 0, guest: 0 };
  for (const s of list) byRole[s.role] = (byRole[s.role] || 0) + 1;
  return { total: list.length, byRole, lastAt: list.length ? list[list.length - 1].at : null };
}

export const router = express.Router();

// Wolane przez klienta przy starcie kazdej sesji (otwarcie WS glosowego
// albo pierwsza wiadomosc czatu) - rola brana z naglowka/tokenu tego
// zapytania, wiec gosc nie moze podszyc sie pod wlasciciela.
router.post('/api/voice/session', (req, res) => {
  const role = roleFromRequest(req);
  const channel = req.body?.channel === 'chat' ? 'chat' : 'voice';
  res.json(logSession(role, channel));
});

router.get('/api/voice/sessions', requireOwner, (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json({ sessions: getSessions(limit), summary: sessionSummary() });
});

export default router;
