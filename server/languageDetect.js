// Wielojezycznosc w locie - wykrycie jezyka wypowiedzi (jedno slowo:
// pl/en/inny), zeby system prompt Jarvisa (edytowany centralnie przez
// autora repo) mogl dostosowac jezyk odpowiedzi. Ten modul tylko wykrywa -
// nie zmienia zadnego promptu.

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { withModel } from './geminiChain.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SUPPORTED = ['pl', 'en', 'inny'];

/**
 * Wykrywa jezyk wypowiedzi. Zwraca dokladnie 'pl', 'en' albo 'inny'.
 * @param {string} text
 * @returns {Promise<{language: string}>}
 */
export async function detectLanguage(text) {
  const clean = String(text || '').trim();
  if (!clean) return { language: 'pl' };

  try {
    const res = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents: `Jakim jezykiem napisano ponizszy tekst? Odpowiedz TYLKO jednym slowem: "pl" (polski), "en" (angielski) albo "inny" (kazdy inny jezyk). Bez cudzyslowow, bez kropki.\n\nTekst: "${clean.slice(0, 1000)}"`,
      })
    );
    const raw = (res.text || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    const language = SUPPORTED.includes(raw) ? raw : 'inny';
    return { language };
  } catch (err) {
    console.error('detectLanguage: wykrywanie nieudane:', err.message || err);
    return { language: 'pl' };
  }
}

export const router = express.Router();

router.post('/api/voice/language', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Podaj tekst do analizy (pole "text").' });
  }
  res.json(await detectLanguage(text));
});

export default router;
