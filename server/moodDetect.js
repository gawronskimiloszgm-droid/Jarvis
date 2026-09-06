// Wykrywanie tonu/nastroju wypowiedzi - Z TRESCI transkrybowanego tekstu,
// nie z surowego audio. Prawdziwa analiza emocji z barwy glosu wymagalaby
// osobnego modelu ML (nie ma go w tym projekcie) - klasyfikacja sentymentu
// tekstu przez Gemini jest uczciwym, wykonalnym przyblizeniem: nie powie
// "user brzmial zmeczony", ale wyczyta rozdraznienie/stres/radosc ze slow.

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { withModel } from './geminiChain.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const MOODS = ['neutralny', 'zirytowany', 'zestresowany', 'wesoly'];

const MOOD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mood: { type: Type.STRING, enum: MOODS },
    confidence: { type: Type.NUMBER },
  },
  required: ['mood', 'confidence'],
};

/**
 * Klasyfikuje ton wypowiedzi na podstawie samego tekstu.
 * @param {string} text transkrypt wypowiedzi uzytkownika
 * @returns {Promise<{mood: string, confidence: number}>}
 */
export async function detectMood(text) {
  const clean = String(text || '').trim();
  if (!clean) return { mood: 'neutralny', confidence: 0 };

  try {
    const res = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents: `Sklasyfikuj ton/nastroj tej wypowiedzi uzytkownika na podstawie samej tresci (slownictwo, interpunkcja, intensywnosc). Wybierz DOKLADNIE jedna etykiete z: ${MOODS.join(', ')}. Podaj tez pewnosc 0-1.\n\nWypowiedz: "${clean.slice(0, 2000)}"`,
        config: { responseMimeType: 'application/json', responseSchema: MOOD_SCHEMA },
      })
    );
    const parsed = JSON.parse(res.text || '{}');
    const mood = MOODS.includes(parsed.mood) ? parsed.mood : 'neutralny';
    const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    return { mood, confidence };
  } catch (err) {
    console.error('detectMood: klasyfikacja nieudana:', err.message || err);
    return { mood: 'neutralny', confidence: 0 };
  }
}

export const router = express.Router();

// Endpoint pomocniczy (test/podglad) - jarvis.js/voiceLive.js moga wolac
// detectMood() bezposrednio jako funkcje, bez HTTP w petli.
router.post('/api/voice/mood', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Podaj tekst do analizy (pole "text").' });
  }
  res.json(await detectMood(text));
});

export default router;
