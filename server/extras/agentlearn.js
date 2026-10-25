// "Patrz, jak to robie": uzytkownik raz pokazuje zadanie na ekranie (nagrywamy klatki
// co ok. 1.5 s), Gemini zamienia pokaz w przepis - nazwa, cel i kroki - a agent ekranu
// potem odtwarza go sam ("Jarvis, zrob przepis faktura").

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { nanoid } from 'nanoid';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import * as memory from '../memory/memory.js';

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MAX_FRAMES = 20;

function recipes() {
  const d = memory.load();
  if (!Array.isArray(d.agentRecipes)) d.agentRecipes = [];
  return d.agentRecipes;
}

export function findRecipe(name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  return recipes().find((r) => r.nazwa === q) || recipes().find((r) => r.nazwa.includes(q) || q.includes(r.nazwa)) || null;
}

router.post('/api/agent/learn', requireOwner, express.json({ limit: '25mb' }), async (req, res) => {
  const frames = Array.isArray(req.body?.frames) ? req.body.frames.filter((f) => f && typeof f.img === 'string') : [];
  const hint = typeof req.body?.opis === 'string' ? req.body.opis.slice(0, 300) : '';
  if (frames.length < 2) return res.status(400).json({ error: 'Za krotki pokaz - nagraj co najmniej kilka sekund.' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak klucza AI na serwerze.' });
  // Rowno rozlozone klatki, zeby zmiescic sie w limicie.
  const step = Math.max(1, Math.ceil(frames.length / MAX_FRAMES));
  const picked = frames.filter((_, i) => i % step === 0).slice(0, MAX_FRAMES);
  const parts = [];
  picked.forEach((f, i) => {
    parts.push({ text: `Klatka ${i + 1} (${Math.round((f.t || 0) / 1000)} s, aktywny program: ${String(f.proc || '?').slice(0, 40)}):` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: f.img.replace(/^data:[^;]+;base64,/, '') } });
  });
  parts.push({
    text:
      'To kolejne klatki ekranu, na ktorych uzytkownik pokazuje, jak wykonac zadanie na komputerze. ' +
      (hint ? `Uzytkownik opisal to tak: "${hint}". ` : '') +
      'Zapisz to jako przepis dla agenta, ktory potem sam powtorzy zadanie: krotka nazwa (1-3 slowa, male litery), cel (jedno zdanie) ' +
      'i kroki - kazdy jako jedna konkretna czynnosc (otworz program X, kliknij przycisk "Y", wpisz w pole "Z"...). ' +
      'Uzywaj nazw przyciskow i pol dokladnie tak, jak widac je na ekranie. Pomijaj ruchy myszy bez znaczenia. Po polsku.',
  });
  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: { nazwa: { type: Type.STRING }, cel: { type: Type.STRING }, kroki: { type: Type.ARRAY, items: { type: Type.STRING } } },
            required: ['nazwa', 'cel', 'kroki'],
          },
        },
      })
    );
    const r = JSON.parse(result.text);
    const recipe = {
      id: nanoid(8),
      at: Date.now(),
      nazwa: String(r.nazwa || 'przepis').trim().toLowerCase().slice(0, 40),
      cel: String(r.cel || '').slice(0, 300),
      kroki: (r.kroki || []).map((k) => String(k).slice(0, 200)).slice(0, 30),
    };
    const list = recipes();
    const i = list.findIndex((x) => x.nazwa === recipe.nazwa);
    if (i >= 0) list[i] = recipe;
    else list.unshift(recipe);
    if (list.length > 40) list.length = 40;
    memory.save(memory.load());
    res.json({ ok: true, recipe });
  } catch (err) {
    console.error('agent learn:', err.message);
    res.status(500).json({ error: 'Nie udalo sie zrozumiec pokazu.' });
  }
});

router.get('/api/agent/recipes', requireOwner, (req, res) => res.json({ recipes: recipes() }));

router.delete('/api/agent/recipes/:id', requireOwner, (req, res) => {
  const d = memory.load();
  d.agentRecipes = recipes().filter((r) => r.id !== req.params.id);
  memory.save(d);
  res.json({ ok: true });
});

export default router;
