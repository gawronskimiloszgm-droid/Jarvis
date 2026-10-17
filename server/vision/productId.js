// #97: rozpoznawanie marki/modelu produktu ze zdjecia.
//
// Celowo bezstanowe - zwraca tylko rozpoznane dane, zeby inny (rownolegly)
// batch mogl je wziac i doleczyc porownywarke cen bez zaleznosci od tego pliku.

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

const PRODUCT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rozpoznano: { type: Type.BOOLEAN },
    marka: { type: Type.STRING },
    model: { type: Type.STRING },
    kategoria: { type: Type.STRING },
    opis: { type: Type.STRING },
    pewnosc: { type: Type.NUMBER },
  },
  required: ['rozpoznano'],
};

// POST / { image, mimeType }
router.post('/', requireOwner, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY.' });
  const { image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak obrazu.' });

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          imagePart(stripDataUrl(image), mimeType || 'image/jpeg'),
          {
            text: `Na zdjeciu jest produkt (urzadzenie, sprzet, opakowanie...). Zidentyfikuj go po
widocznych cechach (logo, ksztalt, oznaczenia, tabliczka znamionowa jesli widoczna).

Zwroc WYLACZNIE obiekt JSON (bez markdown):
{"rozpoznano": boolean - false, jesli nie da sie sensownie zidentyfikowac marki/modelu,
"marka": string - nazwa producenta, jesli rozpoznana, inaczej pusty string,
"model": string - nazwa/numer modelu, jesli widoczny lub rozpoznawalny, inaczej pusty string,
"kategoria": string - ogolna kategoria produktu po polsku (np. "słuchawki bezprzewodowe"),
"opis": string - 1 zdanie, na jakiej podstawie rozpoznales (albo dlaczego nie),
"pewnosc": number 0-1}`,
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema: PRODUCT_SCHEMA },
      })
    );
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = { rozpoznano: false, marka: '', model: '', kategoria: '', opis: 'blad parsowania odpowiedzi modelu', pewnosc: 0 };
    }
    res.json({
      rozpoznano: Boolean(parsed.rozpoznano),
      marka: String(parsed.marka || '').slice(0, 80),
      model: String(parsed.model || '').slice(0, 100),
      kategoria: String(parsed.kategoria || '').slice(0, 80),
      opis: String(parsed.opis || '').slice(0, 300),
      pewnosc: Number.isFinite(parsed.pewnosc) ? Math.max(0, Math.min(1, parsed.pewnosc)) : null,
    });
  } catch (err) {
    console.error('productId error:', err);
    res.status(500).json({ error: 'Nie udalo sie zidentyfikowac produktu.' });
  }
});

export default router;
