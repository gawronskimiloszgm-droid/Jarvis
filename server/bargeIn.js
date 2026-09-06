// Wsparcie dla "barge-in" (uzytkownik zaczyna mowic, zanim Jarvis skonczyl
// wypowiedz) - tutaj tylko warstwa KSIEGOWA: przyjecie zgloszenia i
// statystyka ile razy dziennie to sie zdarza, do analizy stylu rozmowy
// (#37 korzysta z tych samych danych).
//
// Samo WYKRYCIE przerwania juz istnieje w server/voiceLive.js -
// msg.serverContent?.interrupted (Gemini Live wykrywa to samo w strumieniu
// audio i serwer juz dzis wysyla do klienta {type:'interrupted'}), wiec
// NIE duplikujemy detekcji. Ten modul tylko zlicza zdarzenie, gdy klient
// (przegladarka/desktop) je zglosi - patrz raport koncowy co dopiac w
// public/app.js po stronie odbioru {type:'interrupted'}.

import express from 'express';
import { load, save } from './memory.js';
import { requireOwner } from './auth.js';
import { roleFromRequest } from './auth.js';

const MAX_ENTRIES = 5000; // ok. kilku miesiecy przy normalnym uzyciu
const KEEP_DAYS = 120;

function ensureNamespace() {
  const data = load();
  if (!data.voiceConversation) data.voiceConversation = {};
  if (!Array.isArray(data.voiceConversation.bargeIns)) data.voiceConversation.bargeIns = [];
  return data;
}

function dateKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Oznacza biezaca wypowiedz TTS jako przerwana przez uzytkownika. */
export function markInterrupted(role = 'owner') {
  const data = ensureNamespace();
  const now = Date.now();
  data.voiceConversation.bargeIns.push({ at: now, role: role === 'owner' ? 'owner' : 'guest' });

  const cutoff = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
  data.voiceConversation.bargeIns = data.voiceConversation.bargeIns.filter((b) => b.at >= cutoff);
  if (data.voiceConversation.bargeIns.length > MAX_ENTRIES) {
    data.voiceConversation.bargeIns.splice(0, data.voiceConversation.bargeIns.length - MAX_ENTRIES);
  }
  save(data);
  return { at: now };
}

export function bargeInStats(days = 14) {
  const data = ensureNamespace();
  const list = data.voiceConversation.bargeIns;
  const today = dateKey(Date.now());
  const byDay = {};
  for (const b of list) {
    const key = dateKey(b.at);
    byDay[key] = (byDay[key] || 0) + 1;
  }
  const sortedDays = Object.keys(byDay).sort().slice(-Math.max(1, days));
  return {
    today: byDay[today] || 0,
    total: list.length,
    byDay: Object.fromEntries(sortedDays.map((d) => [d, byDay[d]])),
  };
}

export const router = express.Router();

// Zglaszane przez klienta, gdy uzytkownik zaczyna mowic w trakcie
// wypowiedzi Jarvisa - guest tez moze przerywac, wiec bez requireOwner,
// role ustalamy z tokenu (jesli jest), a nie z tresci zapytania.
router.post('/api/voice/barge-in', (req, res) => {
  const role = roleFromRequest(req);
  res.json(markInterrupted(role));
});

router.get('/api/voice/barge-in/stats', requireOwner, (req, res) => {
  const days = Number(req.query.days) || 14;
  res.json(bargeInStats(days));
});

export default router;
