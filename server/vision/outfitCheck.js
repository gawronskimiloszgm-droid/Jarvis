// #94: analiza ubrania/wygladu przed wyjsciem wzgledem pogody.
//
// Celowo NIE importuje server/weather.js - to osobny batch rownolegly i
// import cudzego modulu w trakcie jego rownoczesnej edycji grozi konfliktem
// scalania. Zamiast tego dane pogodowe przychodza jako parametr w body
// zadania. Spiecie centralne (np. auto-pobranie z weather.js przed
// wywolaniem tego endpointu z jarvis.js) opisane w raporcie koncowym.

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

const OUTFIT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pasuje: { type: Type.BOOLEAN },
    uzasadnienie: { type: Type.STRING },
    sugestie: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['pasuje', 'uzasadnienie'],
};

function describeWeather(weather) {
  if (!weather || typeof weather !== 'object') return 'brak danych pogodowych - ocen tylko na podstawie stroju.';
  const parts = [];
  if (weather.tempC != null) parts.push(`temperatura: ${weather.tempC} C`);
  if (weather.condition) parts.push(`warunki: ${weather.condition}`);
  if (weather.windKmh != null) parts.push(`wiatr: ${weather.windKmh} km/h`);
  if (weather.precipitationMm != null) parts.push(`opady: ${weather.precipitationMm} mm`);
  if (weather.feelsLikeC != null) parts.push(`odczuwalna: ${weather.feelsLikeC} C`);
  return parts.length ? parts.join(', ') : 'brak danych pogodowych - ocen tylko na podstawie stroju.';
}

// POST / { image, mimeType, weather: {tempC, condition, windKmh, precipitationMm, feelsLikeC} }
router.post('/', requireOwner, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY.' });
  const { image, mimeType, weather } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak obrazu.' });

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          imagePart(stripDataUrl(image), mimeType || 'image/jpeg'),
          {
            text: `Na zdjeciu widac osobe ubrana przed wyjsciem z domu. Aktualna pogoda: ${describeWeather(weather)}

Ocen, czy strój jest odpowiedni do tych warunkow (grubosc ubrania, okrycie wierzchnie,
obuwie, parasol/nakrycie glowy jesli potrzebne). Badz konkretny i praktyczny, nie ogolnikowy.

Zwroc WYLACZNIE obiekt JSON (bez markdown):
{"pasuje": boolean, "uzasadnienie": string - 1-2 zdania po polsku,
"sugestie": string[] - 0-3 krotkie, konkretne sugestie poprawy (pusta tablica, jesli strój juz pasuje)}`,
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema: OUTFIT_SCHEMA },
      })
    );
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = { pasuje: true, uzasadnienie: 'blad parsowania odpowiedzi modelu', sugestie: [] };
    }
    res.json({
      pasuje: Boolean(parsed.pasuje),
      uzasadnienie: String(parsed.uzasadnienie || '').slice(0, 400),
      sugestie: Array.isArray(parsed.sugestie) ? parsed.sugestie.slice(0, 5).map((s) => String(s).slice(0, 150)) : [],
    });
  } catch (err) {
    console.error('outfitCheck error:', err);
    res.status(500).json({ error: 'Nie udalo sie ocenic stroju.' });
  }
});

export default router;
