// Transkrypcja rozmowy na glos widoczna NA ZYWO (dostepnosc) - np. drugi
// ekran/karta pokazujaca narastajacy napis, przydatne dla osob
// niedoslyszacych obserwujacych rozmowe glosowa z boku.
//
// Bufor zyje WYLACZNIE w pamieci procesu (per sesja, z TTL) - to podglad
// na biezaco, nie trwala historia (tamta jest w voiceHistory.js/memory.js).
//
// KONTRAKT API (do podpiecia w public/app.js - nie edytowany tutaj):
// 1. Klient generuje sessionId (np. crypto.randomUUID()) przy starcie
//    polaczenia glosowego.
// 2. Kazdy fragment transkrypcji, ktory klient i tak juz dostaje z WS
//    glosowego w server/voiceLive.js (msg.serverContent.inputTranscription.text,
//    msg.serverContent.outputTranscription.text, oraz finalne userText/
//    assistantText przy {type:'turnComplete'}), POSTuje tutaj:
//    POST /api/voice/live-transcript/:sessionId
//    body: { role: 'user'|'assistant', text: '...', final: boolean }
// 3. Kazdy podglad (np. druga karta/urzadzenie) laczy sie przez:
//    GET /api/voice/live-transcript/:sessionId  (Server-Sent Events)
//    - od razu dostaje "backlog" (dotychczasowe fragmenty), potem strumien
//      kolejnych zdarzen "chunk" w miare ich POSTowania.

import express from 'express';

const SESSION_TTL_MS = 30 * 60 * 1000; // pol godziny bezczynnosci = koniec podgladu
const MAX_CHUNKS_PER_SESSION = 500;
const MAX_SESSIONS = 50;

const sessions = new Map(); // sessionId -> { chunks: [], subscribers: Set<res>, lastActivity }

function ensureSession(sessionId) {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { chunks: [], subscribers: new Set(), lastActivity: Date.now() };
    sessions.set(sessionId, s);
    sweep();
  }
  return s;
}

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL_MS) {
      for (const res of s.subscribers) {
        try {
          res.end();
        } catch {
          /* polaczenie i tak juz padlo */
        }
      }
      sessions.delete(id);
    }
  }
  while (sessions.size > MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value);
  }
}

export function pushChunk(sessionId, role, text, final = false) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const s = ensureSession(sessionId);
  const chunk = { role: role === 'assistant' ? 'assistant' : 'user', text: clean, final: Boolean(final), ts: Date.now() };
  s.chunks.push(chunk);
  if (s.chunks.length > MAX_CHUNKS_PER_SESSION) s.chunks.splice(0, s.chunks.length - MAX_CHUNKS_PER_SESSION);
  s.lastActivity = Date.now();

  const payload = `event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`;
  for (const res of s.subscribers) {
    try {
      res.write(payload);
    } catch {
      /* subskrybent zamkniety - usunie sie przy nastepnym sweep/close */
    }
  }
  return chunk;
}

export const router = express.Router();

router.post('/api/voice/live-transcript/:sessionId', (req, res) => {
  const { role, text, final } = req.body || {};
  const chunk = pushChunk(req.params.sessionId, role, text, final);
  if (!chunk) return res.status(400).json({ error: 'Podaj niepusty tekst (pole "text").' });
  res.json({ ok: true });
});

router.get('/api/voice/live-transcript/:sessionId', (req, res) => {
  const s = ensureSession(req.params.sessionId);
  s.lastActivity = Date.now();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Backlog natychmiast, zeby swiezo otwarty podglad nie zaczynal od pustki.
  for (const chunk of s.chunks) {
    res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
  }

  s.subscribers.add(res);
  req.on('close', () => {
    s.subscribers.delete(res);
  });
});

export default router;
