// Historia rozmow z mozliwoscia "odsluchu" transkryptu.
//
// Sprawdzone w server/voiceLive.js: zadnego audio nie zapisuje na dysk ani
// w pamieci (strumieniuje na zywo do/od Gemini Live i wyrzuca), wiec
// prawdziwego audio do odtworzenia NIE MA. To co jest: sam transkrypt
// tekstowy, ktory voiceLive.js juz zapisuje przez memory.appendHistory()
// TYLKO dla wlasciciela (linie ~1009-1010 w voiceLive.js). Ten modul go
// tylko CZYTA (memory.js nie jest edytowany) i grupuje w "rozmowy" po
// przerwach czasowych.
//
// OGRANICZENIE: memory.history nie rozroznia kanalu (glos vs pisany
// czat) - jarvis.js (czat pisany) i voiceLive.js (glos) pisza do tego
// samego bufora tym samym ksztaltem {role, content, ts}. Bez rozszerzania
// memory.js (zakazane w tym zadaniu) nie da sie ich rozdzielic ze 100%
// pewnoscia - traktujemy wiec ponizsze jako "historia rozmow" ogolnie,
// nie wylacznie glosowych. Jesli to rozroznienie jest wazne, docelowo
// wymaga dopisania pola np. `channel` przy appendHistory() w voiceLive.js
// i jarvis.js - zmiana centralna, poza zakresem tego pliku.

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';

const SESSION_GAP_MS = 10 * 60 * 1000; // przerwa dluzsza niz 10 min = nowa rozmowa

function groupIntoConversations(history) {
  const sessions = [];
  let current = null;
  for (const turn of history) {
    if (!current || turn.ts - current.endedAt > SESSION_GAP_MS) {
      current = { id: String(turn.ts), startedAt: turn.ts, endedAt: turn.ts, turns: [] };
      sessions.push(current);
    }
    current.turns.push({ role: turn.role, content: turn.content, ts: turn.ts });
    current.endedAt = turn.ts;
  }
  return sessions;
}

export function listConversations(limit = 20) {
  const sessions = groupIntoConversations(memory.getRecentHistory(200));
  return sessions
    .slice(-Math.max(1, limit))
    .reverse()
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      turnCount: s.turns.length,
      preview: (s.turns[0]?.content || '').slice(0, 120),
    }));
}

export function getConversation(id) {
  const sessions = groupIntoConversations(memory.getRecentHistory(200));
  return sessions.find((s) => s.id === String(id)) || null;
}

export const router = express.Router();

router.get('/api/voice/history', requireOwner, (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json({ conversations: listConversations(limit) });
});

router.get('/api/voice/history/:id', requireOwner, (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Nie znaleziono rozmowy.' });
  res.json(conversation);
});

export default router;
