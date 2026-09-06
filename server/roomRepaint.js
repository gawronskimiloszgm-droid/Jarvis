// #99: wirtualna przymiarka/podglad zmiany w pomieszczeniu (np. "pomaluj
// sciany na szaro").
//
// Probuje NAJPIERW prawdziwej edycji obrazu wejsciowego przez model Gemini
// z obsluga generowania obrazu (config.responseModalities: ['TEXT','IMAGE']).
// NIE dalo sie tego zweryfikowac w tym worktree, bo brak node_modules
// (zainstalowanej wersji @google/genai) - patrz raport koncowy. Dlatego
// kazdy blad/brak obrazu w odpowiedzi modelu ma bezpieczny fallback: NOWY
// obraz wygenerowany opisowo przez istniejacy server/image.js (Pollinations),
// zgodnie z instrukcja - bez duplikowania jego logiki.

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { imagePart } from './vision.js';
import { withModel, isOverloaded } from './geminiChain.js';
import { requireOwner } from './auth.js';
import { generateImage, storeImage } from './image.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

// Model do edycji obrazu - konfigurowalny, bo nazwa modelu obrazkowego
// Gemini zmienia sie czesciej niz modele tekstowe w geminiChain.js (ktorych
// lancuch zapasowy jest do zapytan czysto tekstowych/vision-do-tekstu, nie
// do generowania obrazu).
const IMAGE_EDIT_MODEL = process.env.GEMINI_IMAGE_EDIT_MODEL || 'gemini-2.5-flash-image';

function stripDataUrl(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}

// Szuka pierwszej czesci z obrazem (inlineData) w odpowiedzi Gemini.
function extractImagePart(result) {
  const parts = result?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
    }
  }
  return null;
}

function extractTextPart(result) {
  const parts = result?.candidates?.[0]?.content?.parts || [];
  const texts = parts.filter((p) => typeof p?.text === 'string').map((p) => p.text);
  return texts.join(' ').trim();
}

async function tryGeminiEdit(base64, mimeType, change) {
  const result = await withModel(
    (model) =>
      ai.models.generateContent({
        model,
        contents: [
          imagePart(base64, mimeType),
          { text: `Zmien to zdjecie pomieszczenia dokladnie w ten sposob: "${change}". Zachowaj perspektywe, uklad i pozostale elementy bez zmian - zmien TYLKO to, o co prosze.` },
        ],
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    () => false // model obrazkowy nie jest czescia zwyklego lancucha zapasowego - jeden strzal, od razu fallback
  );
  const image = extractImagePart(result);
  if (!image) throw new Error('Model nie zwrocil obrazu (edycja obrazu prawdopodobnie niewspierana).');
  return { image, caption: extractTextPart(result) };
}

// POST / { image, mimeType, change }
router.post('/', requireOwner, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY.' });
  const { image, mimeType, change } = req.body || {};
  const opisZmiany = String(change || '').trim();
  if (!image) return res.status(400).json({ error: 'Brak obrazu pomieszczenia.' });
  if (!opisZmiany) return res.status(400).json({ error: 'Brak opisu zmiany (np. "pomaluj sciany na szaro").' });

  const base64 = stripDataUrl(image);
  const mt = mimeType || 'image/jpeg';

  try {
    const { image: edited, caption } = await tryGeminiEdit(base64, mt, opisZmiany);
    const buffer = Buffer.from(edited.base64, 'base64');
    const id = storeImage(buffer, edited.mimeType);
    return res.json({ mode: 'edit', id, url: `/api/image/${id}`, opis: caption || null });
  } catch (err) {
    console.warn('roomRepaint: edycja Gemini niedostepna, fallback na generowanie opisowe:', err.message);
  }

  // Fallback: NOWY obraz generowany opisowo (nie edycja) przez Pollinations,
  // przez istniejacy server/image.js - bez duplikowania jego logiki.
  try {
    const prompt = `wnetrze pomieszczenia po zmianie: ${opisZmiany}, realistyczne zdjecie wnetrza`;
    const buffer = await generateImage(prompt);
    const id = storeImage(buffer, 'image/jpeg');
    res.json({
      mode: 'fallback-generate',
      id,
      url: `/api/image/${id}`,
      uwaga: 'To NOWO wygenerowany obraz na podstawie opisu, NIE edycja przeslanego zdjecia - edycja obrazu wejsciowego byla niedostepna.',
    });
  } catch (err) {
    console.error('roomRepaint fallback error:', err);
    const overloaded = isOverloaded(err);
    res.status(overloaded ? 503 : 500).json({ error: 'Nie udalo sie wygenerowac podgladu.' });
  }
});

export default router;
