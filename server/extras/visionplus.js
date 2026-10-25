// "Pokaz do kamery": zdjecie kartki, paragonu, etykiety albo pisma zamienia sie w
// konkretne dane - tekst, streszczenie, zadania, wydatek, tlumaczenie. Klient
// decyduje, co z tym zrobic (przyciski: dodaj zadania, wydatek, notatke).

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { nanoid } from 'nanoid';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import * as memory from '../memory/memory.js';

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CEL = {
  auto: 'Rozpoznaj, co to jest, i wyciagnij to, co najbardziej przydatne.',
  notatka: 'Przepisz tresc jako notatke: tytul, streszczenie, najwazniejsze punkty.',
  zadanie: 'Wyciagnij z tego liste konkretnych zadan do zrobienia.',
  wydatek: 'To paragon albo rachunek - podaj kwote do zaplaty (laczna), kategorie i krotki opis.',
  tlumacz: 'Przetlumacz caly widoczny tekst na polski (a jesli jest po polsku - na angielski).',
  tekst: 'Przepisz dokladnie caly widoczny tekst, zachowujac uklad wierszy.',
};

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    typ: { type: Type.STRING, enum: ['paragon', 'notatka', 'dokument', 'etykieta', 'ekran', 'inne'] },
    tytul: { type: Type.STRING },
    tekst: { type: Type.STRING, description: 'Przepisany widoczny tekst.' },
    streszczenie: { type: Type.STRING },
    punkty: { type: Type.ARRAY, items: { type: Type.STRING } },
    zadania: { type: Type.ARRAY, items: { type: Type.STRING } },
    wydatek: {
      type: Type.OBJECT,
      nullable: true,
      properties: { kwota: { type: Type.NUMBER }, kategoria: { type: Type.STRING }, opis: { type: Type.STRING } },
    },
    tlumaczenie: { type: Type.STRING },
  },
  required: ['typ', 'tytul', 'streszczenie'],
};

router.post('/api/vision/scan', requireOwner, express.json({ limit: '12mb' }), async (req, res) => {
  const { image, mimeType = 'image/jpeg', cel = 'auto' } = req.body || {};
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'Brak obrazu.' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak klucza AI na serwerze.' });
  const task = CEL[cel] || CEL.auto;
  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType, data: image.replace(/^data:[^;]+;base64,/, '') } },
          { text: `${task} Odpowiadaj po polsku. Nie zmyslaj - gdy czegos nie widac wyraznie, pomin to. Kwoty jako liczby w zlotych.` },
        ],
        config: { responseMimeType: 'application/json', responseSchema: SCHEMA },
      })
    );
    const data = JSON.parse(result.text);
    res.json({ ok: true, cel, ...data });
  } catch (err) {
    console.error('vision scan:', err.message);
    res.status(500).json({ error: 'Nie udalo sie odczytac obrazu.' });
  }
});

// Notatka z tekstu (np. ze skanu kamery) - ta sama lista co notatki glosowe.
router.post('/api/notes/text', requireOwner, (req, res) => {
  const str = (v, n) => (typeof v === 'string' ? v : '').trim().slice(0, n);
  const tytul = str(req.body?.tytul, 120) || 'Notatka';
  const tresc = str(req.body?.tekst, 60_000);
  const streszczenie = str(req.body?.streszczenie, 4000);
  if (!tresc && !streszczenie) return res.status(400).json({ error: 'Pusta notatka.' });
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 500)).slice(0, 30) : []);
  const data = memory.load();
  if (!Array.isArray(data.notes)) data.notes = [];
  const note = {
    id: nanoid(8),
    at: Date.now(),
    tytul,
    streszczenie: streszczenie || tresc.slice(0, 300),
    punkty: arr(req.body?.punkty),
    decyzje: [],
    zadania: arr(req.body?.zadania).map((t) => ({ tresc: t })),
    transkrypcja: tresc,
  };
  data.notes.unshift(note);
  if (data.notes.length > 100) data.notes.length = 100;
  memory.save(data);
  res.json({ ok: true, id: note.id });
});

export default router;
