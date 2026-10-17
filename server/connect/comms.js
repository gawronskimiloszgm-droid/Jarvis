// Glowny router domeny "komunikacja": kolejka powiadomien z telefonu (#113),
// notatki glosowe z automatycznym tagowaniem (#118), tlumaczenie w locie
// (#119) i podsumowanie dlugiego watku (#120) - a takze podpiecie routerow
// gmail.js (#111/#114/#116/#117), sms.js (#112) i telegram.js (#115) pod
// jednym wspolnym prefiksem.
//
// Ten plik eksportuje Router i NIGDZIE sam siebie nie montuje - zrob to
// recznie w server/index.js (poza zakresem tej zmiany):
//
//   import commsRouter from './comms.js';
//   app.use('/api/comms', commsRouter);
//
// Wszystko tutaj wymaga requireOwner - to dostep do prywatnej komunikacji
// wlasciciela (maile, SMS-y, Telegram, powiadomienia z telefonu, notatki).

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import * as memory from '../memory/memory.js';
import gmailRouter from './gmail.js';
import smsRouter from './sms.js';
import telegramRouter from './telegram.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

router.use('/gmail', gmailRouter);
router.use('/sms', smsRouter);
router.use('/telegram', telegramRouter);

// Nowy namespace w trwalej pamieci (server/memory.js NIE jest edytowany -
// klucz "comms" jest tworzony tutaj, na miejscu, dokladnie jak routines/
// expenses zostaly dodane wczesniej w samym memory.js).
function commsData() {
  const data = memory.load();
  if (!data.comms) data.comms = {};
  if (!Array.isArray(data.comms.notifications)) data.comms.notifications = [];
  if (!Array.isArray(data.comms.notes)) data.comms.notes = [];
  return data;
}

// --- #113: powiadomienia z telefonu - odbiornik backendowy ---
//
// KONTRAKT dla przyszlej companion-appki na telefonie (NIE jest budowana w
// tym repo - appka telefoniczna to osobne zadanie):
//   - Przy kazdym nowym powiadomieniu na telefonie appka woLa:
//       POST /api/comms/notifications/incoming
//       Headers: Authorization: Bearer <token wlasciciela> (ten sam token,
//                ktory przegladarka dostaje z /api/login - to telefon
//                wlasciciela, wiec moze go trzymac tak samo jak przegladarka)
//       Body: { "app": "WhatsApp", "title": "Jan Kowalski", "text": "..." }
//   - Klient glosowy (np. voiceLive.js po stronie przegladarki/HUD) ma
//     odpytywac okresowo:
//       GET /api/comms/notifications
//       Headers: Authorization: Bearer <token wlasciciela>
//     i czytac na glos (TTS) kazdy wpis z odpowiedzi. GET domyslnie ZUZYWA
//     kolejke (zwraca wpisy i od razu je czysci), zeby to samo powiadomienie
//     nie zostalo przeczytane dwa razy przy kolejnym odpytaniu - jesli
//     klient wolal chce tylko podejrzec bez konsumowania, doda ?consume=false.
router.post('/notifications/incoming', requireOwner, (req, res) => {
  const app = String(req.body?.app || '').trim();
  const title = String(req.body?.title || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!text && !title) return res.status(400).json({ error: 'Wymagane pole text lub title.' });

  const data = commsData();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    app: app || 'nieznana aplikacja',
    title,
    text,
    at: new Date().toISOString(),
  };
  data.comms.notifications.push(entry);
  if (data.comms.notifications.length > 200) {
    data.comms.notifications = data.comms.notifications.slice(-200);
  }
  memory.save(data);
  res.status(201).json({ ok: true, id: entry.id });
});

router.get('/notifications', requireOwner, (req, res) => {
  const data = commsData();
  const consume = req.query.consume !== 'false'; // domyslnie zuzywa kolejke
  const pending = data.comms.notifications;
  if (consume) {
    data.comms.notifications = [];
    memory.save(data);
  }
  res.json({ notifications: pending });
});

// --- #118: dyktowanie notatek glosowych z automatycznym tagowaniem ---
//
// Transkrypcje robi juz voiceLive.js/Gemini Live gdzie indziej - ten
// endpoint dostaje GOTOWY tekst (transcript) i tylko go kategoryzuje +
// zapisuje z mozliwoscia przeszukania (GET ponizej).
router.post('/notes', requireOwner, async (req, res) => {
  const transcript = String(req.body?.transcript || '').trim();
  if (!transcript) return res.status(400).json({ error: 'Brak transcript.' });

  try {
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          'Ponizej transkrypcja notatki glosowej. Wybierz JEDNA najbardziej pasujaca kategorie sposrod: ' +
          '"praca", "osobiste", "pomysl", "zakupy", "inne". Podaj tez krotki tytul (maks. 6 slow) po polsku.\n\n' +
          `Notatka: "${transcript}"`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING, enum: ['praca', 'osobiste', 'pomysl', 'zakupy', 'inne'] },
              title: { type: Type.STRING },
            },
            required: ['category', 'title'],
          },
        },
      })
    );
    const { category, title } = JSON.parse(result.text);

    const data = commsData();
    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: title || transcript.slice(0, 40),
      category: category || 'inne',
      transcript,
      createdAt: new Date().toISOString(),
    };
    data.comms.notes.push(note);
    memory.save(data);
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Przeszukiwanie: ?q=fraza (tytul/tresc) i/lub ?category=praca|osobiste|pomysl|zakupy|inne
router.get('/notes', requireOwner, (req, res) => {
  const data = commsData();
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim().toLowerCase();
  let notes = data.comms.notes;
  if (category) notes = notes.filter((n) => n.category === category);
  if (q) notes = notes.filter((n) => n.title.toLowerCase().includes(q) || n.transcript.toLowerCase().includes(q));
  res.json({ notes: notes.slice().reverse() });
});

// --- #119: tlumaczenie wiadomosci przychodzacej w locie ---
router.post('/translate', requireOwner, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const targetLang = String(req.body?.targetLang || '').trim();
  if (!text || !targetLang) {
    return res.status(400).json({ error: 'Wymagane pola: text, targetLang (np. "polski", "angielski", "en").' });
  }
  try {
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents: `Przetlumacz ponizszy tekst na jezyk: ${targetLang}. Zwroc SAM przetlumaczony tekst, bez komentarzy i bez cudzyslowow.\n\nTekst: "${text}"`,
      })
    );
    res.json({ translated: result.text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- #120: podsumowanie dlugiego watku wiadomosci ---
router.post('/thread-summary', requireOwner, async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Wymagana niepusta tablica messages (obiekty {text, from, at}).' });
  }
  try {
    const transcript = messages
      .slice(0, 200)
      .map((msg) => `[${msg.at || '?'}] ${msg.from || 'ktos'}: ${String(msg.text || '').slice(0, 500)}`)
      .join('\n');
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          'Ponizej watek wiadomosci (czat/mail/SMS). Napisz PO POLSKU zwiezle podsumowanie (3-6 zdan): o czym ' +
          'byla rozmowa, jakie padly ustalenia/decyzje, czy zostaly otwarte pytania lub dzialania do zrobienia.\n\n' +
          transcript,
      })
    );
    res.json({ summary: result.text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
