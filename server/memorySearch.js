// Funkcja 26: wyszukiwanie semantyczne w pamieci. Bez zewnetrznej bazy
// wektorowej - prefiltr slowami kluczowymi zawezia pula kandydatow (fakty +
// wygenerowane podsumowania dni), a Gemini ocenia trafnosc top-N kandydatow
// wzgledem zapytania (responseSchema wymusza liczbowa ocene per kandydat,
// ten sam mechanizm co klasyfikacja kategorii w factLifecycle.js).

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { withModel } from './geminiChain.js';
import { requireOwner } from './auth.js';
import { ensureFactMeta } from './factLifecycle.js';
import { load } from './memory.js';
import { ensureNamespace } from './knowledgeStore.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function keywordScore(query, text) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  return words.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);
}

const RANK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    wyniki: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          indeks: { type: Type.NUMBER },
          trafnosc: { type: Type.NUMBER },
        },
        required: ['indeks', 'trafnosc'],
      },
    },
  },
  required: ['wyniki'],
};

export async function semanticSearch(query, limit = 5) {
  const q = String(query || '').trim();
  if (!q) return [];

  ensureFactMeta();
  const data = ensureNamespace(load());
  const candidates = [
    ...data.facts.map((text, i) => ({ type: 'fakt', ref: i, text })),
    ...Object.entries(data.episodeSummaries || {}).map(([date, s]) => ({
      type: 'dzien',
      ref: date,
      text: `${date}: ${s.summary}`,
    })),
  ];
  if (!candidates.length) return [];

  const prefiltered = candidates
    .map((c) => ({ ...c, kw: keywordScore(q, c.text) }))
    .sort((a, b) => b.kw - a.kw)
    .slice(0, 25);

  const numbered = prefiltered.map((c, i) => `${i}: ${c.text}`).join('\n');
  try {
    const res = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          `Zapytanie uzytkownika: "${q}"\n\n` +
          'Ocen trafnosc (liczba 0-10, gdzie 10 = bezposrednio odpowiada na zapytanie) kazdej z ponizszych ' +
          `pozycji z pamieci wzgledem zapytania:\n${numbered}`,
        config: { responseMimeType: 'application/json', responseSchema: RANK_SCHEMA },
      })
    );
    const parsed = JSON.parse(res.text);
    const scored = (parsed.wyniki || [])
      .filter((w) => Number.isInteger(Number(w.indeks)) && prefiltered[Number(w.indeks)])
      .map((w) => ({ ...prefiltered[Number(w.indeks)], score: Number(w.trafnosc) || 0 }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ kw, ...rest }) => rest);
  } catch {
    // model niedostepny - fallback na sam ranking slow kluczowych, zeby
    // wyszukiwanie dzialalo (choc mniej trafnie) tez przy przeciazeniu API
    return prefiltered.slice(0, limit).map(({ kw, ...rest }) => rest);
  }
}

const router = express.Router();

router.get('/api/memory/search', requireOwner, async (req, res) => {
  const q = String(req.query.q || '');
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
  res.json({ query: q, results: await semanticSearch(q, limit) });
});

export const memorySearchRouter = router;
