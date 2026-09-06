// #102 Skanowanie przedmiotu telefonem i generowanie modelu 3D na tej
// podstawie.
//
// Ten sam wzorzec co modules/receipts/scan.js: Gemini Vision (przez
// withModel - lancuch zapasowy modeli) dostaje zdjecie i ma zwrocic JSON.
// KLUCZOWA roznica wzgledem paragonu: tu JSON od razu jest w formacie
// spec.czesci, ktorego oczekuje designAssembly()/createAssembly() z
// modules/cad/index.js (patrz normalizePart() tam) - wiec nie trzeba
// tlumaczyc pol, wynik idzie wprost do generatora. normalizePart() jest
// juz odporne na braki/dziwne wartosci (num() z fallbackiem), wiec nawet
// niedoskonaly JSON od modelu da jakis rozsadny model zamiast bledu.

import { GoogleGenAI } from '@google/genai';
import { imagePart } from '../../server/vision.js';
import { withModel } from '../../server/geminiChain.js';
import { createAssembly } from '../../server/cad.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_PARTS = 8;

const PROMPT = `Na zdjeciu jest pojedynczy przedmiot fizyczny. Rozloz jego ksztalt na proste bryly (prostopadloscian, walec, rura, plyta z okraglym otworem) i oszacuj wymiary w milimetrach, tak zeby dalo sie go odtworzyc jako model do druku 3D. Jesli w kadrze jest cos o znanym rozmiarze (moneta, dlon, linijka), uzyj tego jako punktu odniesienia do skali - w przeciwnym razie oszacuj wymiary z typowego rozmiaru takiego przedmiotu i ustaw nisza pewnosc.

Zwroc WYLACZNIE obiekt JSON w DOKLADNIE takim ksztalcie (bez markdown, bez komentarza):
{
  "nazwa": string - krotki opis przedmiotu po polsku (np. "uchwyt na kabel"),
  "material": "PLA" | "PETG" | "ABS" | "ASA" | "NYLON",
  "confidence": number 0-1 - pewnosc oszacowania WYMIAROW z samego zdjecia,
  "czesci": [
    {
      "ksztalt": "prostopadloscian" | "walec" | "rura" | "plyta_z_otworem",
      "x": number, "y": number, "z": number - polozenie bryly w mm wzgledem wspolnego poczatku (0,0,0), tak by bryly stykaly sie tworzac jeden przedmiot,
      "obrot_os": "x" | "y" | "z" | null, "obrot_deg": number,
      "szerokosc_mm": number,
      "wysokosc_mm": number,
      "grubosc_mm": number,
      "promien_mm": number,
      "promien_wewn_mm": number,
      "otwor_promien_mm": number, "otwor_x_mm": number, "otwor_y_mm": number
    }
  ]
}

Pola z listy wyzej podawaj TYLKO gdy maja sens dla danego ksztaltu (np. promien_mm tylko dla walca/rury, szerokosc_mm/wysokosc_mm/grubosc_mm tylko dla prostopadloscianu/plyty_z_otworem). Maksymalnie ${MAX_PARTS} czesci. Gdy przedmiot jest zbyt zlozony albo organiczny (np. zwierze, twarz, roslina), przyblizaj go najprostsza bryla oddajaca ogolny gabaryt i ustaw confidence ponizej 0.4.`;

function parseSpec(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let v;
  try {
    v = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini nie zwrocil poprawnego JSON-a dla tego zdjecia - sprobuj ponownie, najlepiej z lepszym oswietleniem.');
  }
  const czesci = Array.isArray(v.czesci)
    ? v.czesci.filter((p) => p && typeof p === 'object').slice(0, MAX_PARTS)
    : [];
  if (!czesci.length) {
    throw new Error('Gemini nie rozpoznal na zdjeciu zadnego ksztaltu mozliwego do zlozenia z brył.');
  }
  return {
    nazwa: v.nazwa ? String(v.nazwa).slice(0, 80) : 'przedmiot ze zdjecia',
    material: typeof v.material === 'string' ? v.material.toUpperCase() : 'PLA',
    confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0,
    czesci,
  };
}

/**
 * @param {Buffer} imageBuffer zdjecie przedmiotu (JPEG/PNG)
 * @param {string} mimeType
 * @returns {Promise<{spec: object, model: object}>} spec = to, co odczytal Gemini; model = wynik createAssembly() (z id, gotowy do /api/cad/:id/stl)
 */
export async function scanObjectToModel(imageBuffer, mimeType = 'image/jpeg') {
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: [imagePart(imageBuffer.toString('base64'), mimeType), { text: PROMPT }],
    })
  );
  const spec = parseSpec(res.text);
  const model = createAssembly(spec);
  return { spec, model };
}
