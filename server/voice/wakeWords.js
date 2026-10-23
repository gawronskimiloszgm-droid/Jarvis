// Konfigurowalna lista fraz-wyzwalaczy (wake word) - domyslnie samo "Jarvis",
// ale niektorzy uzytkownicy chca budzic asystenta innym imieniem/pseudonimem
// (np. dziecko w domu tez ma na imie podobnie) albo dodac wariant bez
// polskich znakow dla gorzej trenowanego rozpoznawania mowy w przegladarce.
//
// UWAGA (ograniczenie techniczne): to jest WYLACZNIE magazyn i CRUD dla
// listy fraz. Faktyczne nasluchiwanie wake worda dzieje sie w przegladarce
// przez Web Speech API (public/app.js) - ten modul tylko dostarcza
// KONFIGURACJE, ktora klient powinien pobrac i porownywac z rozpoznanym
// tekstem lokalnie. Podlaczenie (fetch listy + porownanie prefiksu w
// wyniku rozpoznawania mowy) wymaga zmiany w public/app.js, ktora nie
// nalezy do tego pliku - patrz raport koncowy.

import express from 'express';
import { load, save } from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';

const DEFAULT_WAKE_WORDS = ['jarvis'];

function ensureNamespace() {
  const data = load();
  if (!data.voiceConversation) data.voiceConversation = {};
  if (!Array.isArray(data.voiceConversation.wakeWords)) {
    data.voiceConversation.wakeWords = [...DEFAULT_WAKE_WORDS];
  }
  return data;
}

function normalizePhrase(phrase) {
  return String(phrase || '').trim().toLowerCase();
}

export function listWakeWords() {
  const data = ensureNamespace();
  return [...data.voiceConversation.wakeWords];
}

export function addWakeWord(phrase) {
  const clean = normalizePhrase(phrase);
  if (!clean || clean.length > 40) return listWakeWords();
  const data = ensureNamespace();
  if (!data.voiceConversation.wakeWords.includes(clean)) {
    data.voiceConversation.wakeWords.push(clean);
    save(data);
  }
  return listWakeWords();
}

export function removeWakeWord(phrase) {
  const clean = normalizePhrase(phrase);
  const data = ensureNamespace();
  // Ostatnia fraza nie znika - inaczej Jarvis przestalby dac sie obudzic
  // w ogole, dopoki ktos znow nie wejdzie przez API.
  if (data.voiceConversation.wakeWords.length <= 1) return listWakeWords();
  data.voiceConversation.wakeWords = data.voiceConversation.wakeWords.filter((w) => w !== clean);
  if (!data.voiceConversation.wakeWords.length) data.voiceConversation.wakeWords = [...DEFAULT_WAKE_WORDS];
  save(data);
  return listWakeWords();
}

export const router = express.Router();

// Publiczny odczyt - klient (rowniez gosc) musi znac frazy, zeby w ogole
// wiedziec kiedy "obudzic" asystenta lokalnie w przegladarce.
router.get('/api/voice/wake-words', (req, res) => {
  res.json({ wakeWords: listWakeWords() });
});

router.post('/api/voice/wake-words', requireOwner, (req, res) => {
  const { phrase } = req.body || {};
  if (!phrase || !String(phrase).trim()) {
    return res.status(400).json({ error: 'Podaj fraze (pole "phrase").' });
  }
  res.json({ wakeWords: addWakeWord(phrase) });
});

router.delete('/api/voice/wake-words/:phrase', requireOwner, (req, res) => {
  res.json({ wakeWords: removeWakeWord(req.params.phrase) });
});

export default router;
