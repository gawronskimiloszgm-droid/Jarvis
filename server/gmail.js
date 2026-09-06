// Router HTTP dla Gmaila: czytanie/podsumowanie (#111), szkic odpowiedzi
// (#114), priorytetyzacja/spam (#116) i przypomnienie o braku odpowiedzi
// (#117) z listy funkcji "komunikacja". Warstwa REST/OAuth jest w
// gmailClient.js - tutaj tylko trasy HTTP + wywolania Gemini.
//
// KRYTYCZNE: ten plik NIGDY nie wysyla maila przy okazji podsumowania czy
// generowania szkicu - wysylka (POST /send) to zawsze OSOBNE wywolanie,
// z jawnym confirm:true, ktore musi zainicjowac wlasciciel.
//
// Montowanie: patrz komentarz na gorze server/comms.js (ten router jest
// tam podpiety pod /gmail).

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { requireOwner } from './auth.js';
import { withModel } from './geminiChain.js';
import * as memory from './memory.js';
import * as gmailClient from './gmailClient.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

// --- OAuth: identyczny wzor jak istniejacy /api/calendar/* w server/index.js ---

router.get('/auth', requireOwner, (req, res) => {
  if (!gmailClient.isOAuthConfigured()) {
    return res.status(400).json({ error: 'Gmail nie jest skonfigurowany (brak GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REDIRECT_URI).' });
  }
  res.redirect(gmailClient.authUrl('gmail'));
});

// Callback wywoluje przegladarka Google'a po zgodzie - BEZ naszego naglowka
// autoryzacji, wiec celowo nie moze przejsc przez requireOwner. Ten sam
// wyjatek co juz zaakceptowany w istniejacym /api/calendar/oauth/callback.
router.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google zwrocil blad: ${error}`);
  if (!code) return res.status(400).send('Brak kodu autoryzacji.');
  try {
    await gmailClient.exchangeCode(String(code));
    res.send('Gmail polaczony. Mozesz zamknac te karte.');
  } catch (err) {
    res.status(500).send(`Nie udalo sie polaczyc Gmail: ${err.message}`);
  }
});

router.get('/status', requireOwner, (req, res) => {
  res.json({ configured: gmailClient.isOAuthConfigured(), connected: gmailClient.isConnected() });
});

function requireGmailConnected(req, res) {
  if (!gmailClient.isOAuthConfigured()) {
    res.status(400).json({ error: 'Gmail nie jest skonfigurowany.' });
    return false;
  }
  if (!gmailClient.isConnected()) {
    res.status(400).json({ error: 'Gmail nie jest polaczony - wejdz na /api/comms/gmail/auth jako wlasciciel.' });
    return false;
  }
  return true;
}

// --- #111: podsumowanie ostatnich maili ---
router.get('/summary', requireOwner, async (req, res) => {
  if (!requireGmailConnected(req, res)) return;
  try {
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 10));
    const messages = await gmailClient.listRecentInboxMessages(limit);
    if (!messages.length) return res.json({ messages: [] });

    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          'Ponizej lista maili (temat, nadawca, krotki fragment tresci - NIE cala tresc). Dla kazdego napisz ' +
          'JEDNO zwiezle zdanie po polsku streszczajace o co chodzi w mailu, uwzgledniajac nadawce. Zachowaj ' +
          'to samo pole id.\n\n' +
          JSON.stringify(messages.map((x) => ({ id: x.id, subject: x.subject, from: x.from, snippet: x.snippet }))),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { id: { type: Type.STRING }, summary: { type: Type.STRING } },
              required: ['id', 'summary'],
            },
          },
        },
      })
    );
    const summaries = JSON.parse(result.text);
    const byId = Object.fromEntries(summaries.map((s) => [s.id, s.summary]));
    res.json({ messages: messages.map((x) => ({ ...x, summary: byId[x.id] || x.snippet })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- #116: priorytetyzacja / filtr spamu ---
router.get('/priority', requireOwner, async (req, res) => {
  if (!requireGmailConnected(req, res)) return;
  try {
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 15));
    const messages = await gmailClient.listRecentInboxMessages(limit);
    if (!messages.length) return res.json({ messages: [] });

    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          'Sklasyfikuj kazdy z tych maili (temat, nadawca, fragment tresci) do jednej z kategorii: ' +
          '"pilny", "normalny", "spam". Zwroc pole id i priority dla kazdego.\n\n' +
          JSON.stringify(messages.map((x) => ({ id: x.id, subject: x.subject, from: x.from, snippet: x.snippet }))),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ['pilny', 'normalny', 'spam'] },
              },
              required: ['id', 'priority'],
            },
          },
        },
      })
    );
    const priorities = JSON.parse(result.text);
    const byId = Object.fromEntries(priorities.map((p) => [p.id, p.priority]));
    const order = { pilny: 0, normalny: 1, spam: 2 };
    const sorted = messages
      .map((x) => ({ ...x, priority: byId[x.id] || 'normalny' }))
      .sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
    res.json({ messages: sorted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- #117: przypomnienie "nie odpisales od X dni" ---
// Idempotentne: pamieta juz zgloszone watki (comms.remindedThreadIds w
// memory.js), zeby powtorne wywolanie nie dodawalo tego samego przypomnienia.
router.post('/unanswered-check', requireOwner, async (req, res) => {
  if (!requireGmailConnected(req, res)) return;
  try {
    const days = Math.max(1, Number(req.body?.days) || 3);
    const stale = await gmailClient.listInboxThreadsOlderThan(days);

    const data = memory.load();
    if (!data.comms) data.comms = {};
    if (!Array.isArray(data.comms.remindedThreadIds)) data.comms.remindedThreadIds = [];
    const already = new Set(data.comms.remindedThreadIds);
    const fresh = stale.filter((t) => !already.has(t.threadId));

    for (const t of fresh) {
      // dueAt = teraz, wiec przypomnienie jest od razu "przeterminowane" i
      // pojawi sie przy najblizszym odczycie getDueUnsentReminders().
      memory.addReminder(`Nie odpisales ${t.from} ws. "${t.subject}" od ${days}+ dni.`, new Date().toISOString());
      already.add(t.threadId);
    }
    data.comms.remindedThreadIds = [...already].slice(-500);
    memory.save(data);

    res.json({ staleThreads: stale.length, newReminders: fresh.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- #114: szkic odpowiedzi na maila (NIGDY nie wysyla) ---
router.post('/reply-draft', requireOwner, async (req, res) => {
  const incomingText = String(req.body?.incomingText || '').trim();
  if (!incomingText) return res.status(400).json({ error: 'Brak tresci maila przychodzacego (incomingText).' });
  const from = String(req.body?.from || '').trim();
  const subject = String(req.body?.subject || '').trim();
  const instructions = String(req.body?.instructions || '').trim();

  try {
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          'Napisz PO POLSKU proponowana, uprzejma odpowiedz na ponizszy mail. To TYLKO szkic do wgladu - ' +
          'uzytkownik sam go przejrzy, ewentualnie poprawi i wysle osobnym krokiem.\n' +
          (subject ? `Temat: ${subject}\n` : '') +
          (from ? `Od: ${from}\n` : '') +
          (instructions ? `Wskazowki uzytkownika co do tresci odpowiedzi: ${instructions}\n` : '') +
          `\nTresc maila przychodzacego:\n${incomingText.slice(0, 6000)}\n\nZwroc sam tekst odpowiedzi, bez dodatkowych komentarzy.`,
      })
    );
    res.json({ draft: result.text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Realna wysylka - ZAWSZE osobny krok od /reply-draft, wymaga confirm:true ---
router.post('/send', requireOwner, async (req, res) => {
  if (!requireGmailConnected(req, res)) return;
  const { to, subject, body, confirm, threadId, inReplyToMessageId } = req.body || {};
  if (confirm !== true) {
    return res.status(400).json({ error: 'Wymagane jawne potwierdzenie: confirm:true. To realna wysylka maila.' });
  }
  if (!to || !String(body || '').trim()) {
    return res.status(400).json({ error: 'Wymagane pola: to, body.' });
  }
  try {
    const sent = await gmailClient.sendPlainTextMessage({
      to: String(to),
      subject: String(subject || ''),
      body: String(body),
      threadId,
      inReplyTo: inReplyToMessageId,
    });
    res.json({ ok: true, ...sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
