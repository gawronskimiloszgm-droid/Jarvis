// #98: analiza dokumentu/umowy ze zdjecia (moze byc wielostronicowa).
//
// TWARDE ZASTRZEZENIE: to narzedzie streszcza FAKTY widoczne w dokumencie
// (strony, kwoty, daty, zobowiazania) i NIC WIECEJ. Nie ocenia, czy umowa
// jest korzystna, nie sugeruje dzialan prawnych, nie interpretuje klauzul.
// Zastrzezenie jest wymuszone i w prompcie do modelu, i doklejane twardo po
// stronie serwera (nie ufamy, ze model zawsze o nim wspomni).

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { imagePart } from './vision.js';
import { withModel } from '../core/geminiChain.js';
import { requireOwner } from '../core/auth.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

function stripDataUrl(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}

// Limit stron chroni czas odpowiedzi i globalny limit body (8mb w
// server/index.js) - wiele zdjec stron w jednym base64 body potrafi ten
// limit szybko przekroczyc, patrz raport koncowy.
const MAX_PAGES = 12;

const DOC_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    liczba_stron: { type: Type.NUMBER },
    streszczenie: { type: Type.STRING },
    kwoty: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { opis: { type: Type.STRING }, kwota: { type: Type.STRING } },
        required: ['opis', 'kwota'],
      },
    },
    daty: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { opis: { type: Type.STRING }, data: { type: Type.STRING } },
        required: ['opis', 'data'],
      },
    },
    zobowiazania: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { strona: { type: Type.STRING }, zobowiazanie: { type: Type.STRING } },
        required: ['zobowiazanie'],
      },
    },
  },
  required: ['streszczenie'],
};

const DISCLAIMER =
  'To automatyczne streszczenie FAKTOW widocznych w dokumencie (nie porada prawna). ' +
  'Przed podjeciem jakiejkolwiek decyzji sprawdz oryginal dokumentu i, w razie watpliwosci, skonsultuj sie z prawnikiem.';

// POST / { images: string[] (base64/data-url), mimeType? }
router.post('/', requireOwner, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY.' });
  const { images, mimeType } = req.body || {};
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Podaj tablice "images" (co najmniej jedna strona).' });
  }
  if (images.length > MAX_PAGES) {
    return res.status(400).json({ error: `Zbyt wiele stron naraz (max ${MAX_PAGES}). Podziel na kilka wywolan.` });
  }

  const mt = mimeType || 'image/jpeg';
  const imageParts = images.map((img) => imagePart(stripDataUrl(img), mt));

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          {
            text: `Ponizej sa kolejne strony (${images.length}) jednego dokumentu/umowy, w kolejnosci.
Jestes narzedziem do STRESZCZANIA FAKTOW, NIE doradca prawnym. Nie oceniaj czy umowa jest
korzystna, nie sugeruj decyzji, nie interpretuj intencji stron - tylko wypisz to, co
faktycznie jest napisane.`,
          },
          ...imageParts,
          {
            text: `Zwroc WYLACZNIE obiekt JSON (bez markdown):
{"liczba_stron": number, "streszczenie": string - 2-4 zdania po polsku, o czym jest dokument,
"kwoty": [{"opis": string, "kwota": string}] - wszystkie kwoty pieniezne z kontekstem,
"daty": [{"opis": string, "data": string}] - wszystkie istotne daty z kontekstem,
"zobowiazania": [{"strona": string - ktora strona umowy, jesli okreslona, "zobowiazanie": string}]}

Gdy czegos nie ma w dokumencie, zwroc pusta tablice dla tego pola - nie zgaduj.`,
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema: DOC_SCHEMA },
      })
    );
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = { liczba_stron: images.length, streszczenie: 'Nie udalo sie sparsowac odpowiedzi modelu.', kwoty: [], daty: [], zobowiazania: [] };
    }
    res.json({
      liczba_stron: Number.isFinite(parsed.liczba_stron) ? parsed.liczba_stron : images.length,
      streszczenie: String(parsed.streszczenie || '').slice(0, 1000),
      kwoty: Array.isArray(parsed.kwoty) ? parsed.kwoty.slice(0, 50) : [],
      daty: Array.isArray(parsed.daty) ? parsed.daty.slice(0, 50) : [],
      zobowiazania: Array.isArray(parsed.zobowiazania) ? parsed.zobowiazania.slice(0, 50) : [],
      zastrzezenie: DISCLAIMER,
    });
  } catch (err) {
    console.error('docSummary error:', err);
    res.status(500).json({ error: 'Nie udalo sie przeanalizowac dokumentu.' });
  }
});

export default router;
