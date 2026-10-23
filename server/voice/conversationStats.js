// Log "naturalnosci" rozmowy - prosta heurystyka (nie ML): dlugosc
// wypowiedzi usera/Jarvisa i czestosc przerywan (#32), zeby z czasem bylo
// widac czy rozmowy staja sie bardziej zwiezle/naturalne czy odwrotnie.
//
// Celowo bez wlasnej persystencji historii - czyta z memory.js (tylko
// odczyt, appendHistory() juz wywoluje jarvis.js/voiceLive.js) i z
// bargeIn.js (juz zapisuje wlasne zdarzenia).

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';
import { bargeInStats } from './bargeIn.js';

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function average(nums) {
  if (!nums.length) return 0;
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10;
}

/**
 * Statystyka stylu rozmowy z ostatnich `days` dni na podstawie historii
 * czatu/glosu juz zapisanej w memory.js (history nie rozroznia kanalu -
 * to najlepsze dostepne przyblizenie bez rozszerzania memory.js).
 */
export function naturalnessStats(days = 14) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  // getRecentHistory(N) zwraca ostatnie N wpisow z bufora (max. 200 w
  // memory.js) - to gorny limit tego, co mozemy przeanalizowac.
  const recent = memory.getRecentHistory(200).filter((h) => h.ts >= cutoff);

  const userTurns = recent.filter((h) => h.role === 'user');
  const assistantTurns = recent.filter((h) => h.role === 'assistant');
  const bargeIns = bargeInStats(days);

  return {
    days,
    turns: recent.length,
    avgUserWords: average(userTurns.map((h) => countWords(h.content))),
    avgAssistantWords: average(assistantTurns.map((h) => countWords(h.content))),
    bargeIns: bargeIns.total,
    // Ile przerwan wypada na jedna wypowiedz Jarvisa - wysoka wartosc
    // sugeruje, ze odpowiedzi sa za dlugie albo za wolno zaczynaja sie od
    // sedna sprawy.
    interruptionsPerAssistantTurn: assistantTurns.length
      ? Math.round((bargeIns.total / assistantTurns.length) * 100) / 100
      : 0,
  };
}

export const router = express.Router();

router.get('/api/voice/naturalness', requireOwner, (req, res) => {
  const days = Number(req.query.days) || 14;
  res.json(naturalnessStats(days));
});

export default router;
