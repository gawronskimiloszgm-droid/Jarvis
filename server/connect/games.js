// Gry glosowe - quiz z 4 odpowiedziami do wyboru (#145).
//
// Stan sesji trzymamy w pamieci procesu (jak server/cad.js), nie w trwalej
// pamieci (memory.js) - to ulotna gra, nie dane, ktore maja przetrwac
// restart serwera.

import express from 'express';
import { nanoid } from 'nanoid';
import { GoogleGenAI, Type } from '@google/genai';
import { withModel } from '../core/geminiChain.js';
import { requireOwner } from '../core/auth.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const QUESTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pytanie: { type: Type.STRING },
    odpowiedzi: { type: Type.ARRAY, items: { type: Type.STRING } },
    poprawnaIndeks: { type: Type.INTEGER },
  },
  required: ['pytanie', 'odpowiedzi', 'poprawnaIndeks'],
};

const SESSIONS = new Map();
const TTL_MS = 30 * 60 * 1000; // pol godziny bezczynnosci - potem sesja wygasa
const MAX_SESSIONS = 100;
const MAX_ROUNDS = 10;

function sweep() {
  const now = Date.now();
  for (const [id, s] of SESSIONS) {
    if (now - s.at > TTL_MS) SESSIONS.delete(id);
  }
  while (SESSIONS.size > MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value);
}

async function generateQuestion(topic, askedSoFar) {
  const avoid = askedSoFar.length
    ? `\nNie powtarzaj (nawet w innej formie) tych juz zadanych pytan: ${askedSoFar.join(' | ')}`
    : '';
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Wygeneruj JEDNO pytanie quizowe${topic ? ` o tematyce: ${topic}` : ' o dowolnej, ciekawej tematyce ogolnej'} ` +
        `po polsku, z dokladnie 4 odpowiedziami do wyboru (dokladnie jedna poprawna). Zwroc indeks poprawnej ` +
        `odpowiedzi (0-3) w polu poprawnaIndeks.${avoid}`,
      config: { responseMimeType: 'application/json', responseSchema: QUESTION_SCHEMA },
    })
  );
  const parsed = JSON.parse(res.text);
  if (!Array.isArray(parsed.odpowiedzi) || parsed.odpowiedzi.length !== 4) {
    throw new Error('Model nie zwrocil dokladnie 4 odpowiedzi.');
  }
  if (!Number.isInteger(parsed.poprawnaIndeks) || parsed.poprawnaIndeks < 0 || parsed.poprawnaIndeks > 3) {
    throw new Error('Model nie zwrocil poprawnego indeksu odpowiedzi.');
  }
  return parsed;
}

const router = express.Router();

// Zamontowac np. jako: app.use('/api/games', gamesRouter)
router.post('/quiz/start', requireOwner, async (req, res) => {
  const topic = req.body?.temat ? String(req.body.temat).trim().slice(0, 100) : '';
  try {
    const q = await generateQuestion(topic, []);
    const id = nanoid(10);
    SESSIONS.set(id, { at: Date.now(), topic, score: 0, round: 1, asked: [q.pytanie], current: q });
    sweep();
    res.json({ id, runda: 1, rundMax: MAX_ROUNDS, wynik: 0, pytanie: q.pytanie, odpowiedzi: q.odpowiedzi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/quiz/:id/answer', requireOwner, async (req, res) => {
  const session = SESSIONS.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Nieznana lub wygasla sesja quizu.' });

  const wybor = Number(req.body?.wybor);
  const poprawna = session.current.poprawnaIndeks;
  const trafione = Number.isInteger(wybor) && wybor === poprawna;
  if (trafione) session.score += 1;
  session.at = Date.now();

  const wynikRundy = {
    poprawnie: trafione,
    poprawnaOdpowiedz: session.current.odpowiedzi[poprawna],
    wynik: session.score,
  };

  if (session.round >= MAX_ROUNDS) {
    SESSIONS.delete(req.params.id);
    return res.json({ ...wynikRundy, koniec: true, rund: session.round });
  }

  try {
    const q = await generateQuestion(session.topic, session.asked);
    session.round += 1;
    session.asked.push(q.pytanie);
    session.current = q;
    res.json({
      ...wynikRundy,
      koniec: false,
      runda: session.round,
      rundMax: MAX_ROUNDS,
      pytanie: q.pytanie,
      odpowiedzi: q.odpowiedzi,
    });
  } catch (e) {
    // Runda odpowiedzi juz jest policzona - meldujemy blad tylko przy
    // generowaniu KOLEJNEGO pytania, zeby nie zgubic wyniku uzytkownika.
    res.status(500).json({ ...wynikRundy, koniec: true, error: e.message });
  }
});

export default router;
