// Klasyfikacja krotkich fragmentow dzwieku (tluczone szklo, alarm, placz...)
// przez Gemini.
//
// @google/genai przyjmuje dzwiek dokladnie tak samo jak obraz - jako
// "inlineData" z mimeType i danymi base64 (Part API nie rozroznia typu
// multimedium poza samym mimeType). Dlatego audioPart() ponizej jest
// funkcjonalnie identyczny z imagePart() w server/vision.js - to nie
// duplikacja z lenistwa, tylko odzwierciedlenie tego, jak plaskie jest
// API: nie ma wspolnego "mediaPart", wiec kazdy modul multimodalny
// definiuje wlasny, nazwany pod swoj typ danych.

import { GoogleGenAI } from '@google/genai';
import * as bus from '../../server/bus.js';
import { withModel } from '../../server/geminiChain.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function audioPart(base64Data, mimeType) {
  return { inlineData: { mimeType, data: base64Data } };
}

// Kategorie uznawane za niepokojace - przy nich endpoint wysyla alert.
// Pozostale (np. "mowa", "cisza", "muzyka", "ruch uliczny") to normalne tlo.
const CONCERNING_CATEGORIES = ['tluczone_szklo', 'alarm', 'plocz', 'krzyk', 'wybicie_drzwi'];

const PROMPT = `Jestes systemem ochrony domu analizujacym KROTKI fragment dzwieku z mikrofonu.
Zaklasyfikuj go do JEDNEJ z kategorii:
- "tluczone_szklo" - dzwiek tluczonego/pekajacego szkla
- "alarm" - alarm (przeciwpozarowy, samochodowy, syrena)
- "plocz" - dziecko lub osoba placze
- "krzyk" - krzyk, wolanie o pomoc
- "wybicie_drzwi" - trzask/uderzenie w drzwi lub okno
- "mowa" - zwykla rozmowa/mowa bez sygnalow niepokoju
- "cisza" - cisza lub szum tla
- "inne" - cokolwiek innego

Zwroc WYLACZNIE obiekt JSON (bez markdown): {
  "category": jedna z powyzszych wartosci (dokladnie taki napis),
  "description": string - jedno krotkie zdanie po polsku co slychac,
  "confidence": number 0-1
}`;

function parseVerdict(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    const v = JSON.parse(cleaned);
    const category = String(v.category || 'inne').trim();
    return {
      category,
      description: String(v.description || '').slice(0, 300),
      confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : null,
      concerning: CONCERNING_CATEGORIES.includes(category),
    };
  } catch {
    return { category: 'inne', description: cleaned.slice(0, 300) || 'brak odpowiedzi modelu', confidence: null, concerning: false, parseFailed: true };
  }
}

/**
 * @param {Buffer} audioBuffer surowe dane audio (np. WAV/OGG/WEBM, krotki fragment)
 * @param {string} mimeType np. 'audio/wav', 'audio/webm', 'audio/ogg'
 * @param {string} [source] etykieta czujnika/pomieszczenia
 * @returns {Promise<{category:string, description:string, confidence:number|null, concerning:boolean}>}
 */
export async function classifyAudio(audioBuffer, mimeType, source) {
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: [audioPart(audioBuffer.toString('base64'), mimeType || 'audio/wav'), { text: PROMPT }],
    })
  );
  const verdict = parseVerdict(res.text);

  const label = String(source || 'mikrofon').slice(0, 40);
  if (verdict.concerning) {
    bus.publish('perimeter', 'audio.alert', `${label}: wykryto niepokojacy dzwiek (${verdict.category}) - ${verdict.description}`, {
      level: 'alert',
      speak: true,
      data: { source: label, ...verdict },
    });
  } else {
    bus.publish('perimeter', 'audio.clear', `${label}: ${verdict.description || verdict.category}`, {
      level: 'debug',
      data: { source: label, ...verdict },
    });
  }
  return verdict;
}
