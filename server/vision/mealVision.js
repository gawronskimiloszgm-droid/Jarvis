// Sledzenie posilkow ze zdjecia: Gemini Vision rozpoznaje danie i szacuje
// kalorie/makroskladniki. Wzorowane WPROST na modules/receipts/scan.js
// (ten sam ksztalt: obraz -> prompt JSON -> parsowanie z zabezpieczeniami),
// tylko inna dziedzina - tutaj NIE ma "potwierdzenia" jak przy paragonie,
// bo szacunek kaloryczny i tak jest przyblizeniem, a nie kwota do rozliczenia.

import { GoogleGenAI } from '@google/genai';
import express from 'express';
import { nanoid } from 'nanoid';
import { imagePart } from './vision.js';
import { withModel } from '../core/geminiChain.js';
import { requireOwner } from '../core/auth.js';
import { load, save } from '../memory/memory.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PROMPT = `Na zdjeciu jest posilek. Rozpoznaj co na nim widac i oszacuj wartosc odzywcza.

Zwroc WYLACZNIE obiekt JSON (bez markdown, bez komentarza):
{
  "found": boolean - false jesli to NIE jest jedzenie albo zdjecie jest nieczytelne,
  "description": string - krotki opis posilku po polsku (np. "kurczak z ryzem i brokulem"),
  "calories": number|null - szacunkowa liczba kalorii calego posilku (kcal),
  "protein": number|null - bialko w gramach,
  "carbs": number|null - weglowodany w gramach,
  "fat": number|null - tluszcz w gramach,
  "confidence": number 0-1 - jak pewny jestes szacunku kalorycznego
}

To SZACUNEK "na oko" z wygladu potrawy, nie analiza laboratoryjna - gdy zdjecie jest niewyrazne albo porcja trudna do ocenienia, zejdz z confidence zamiast zgadywac precyzyjna liczbe.`;

function parseVerdict(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    const v = JSON.parse(cleaned);
    const num = (x) => (Number.isFinite(x) ? Math.round(x) : null);
    return {
      found: Boolean(v.found),
      description: v.description ? String(v.description).slice(0, 200) : '',
      calories: num(v.calories),
      protein: num(v.protein),
      carbs: num(v.carbs),
      fat: num(v.fat),
      confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0,
    };
  } catch {
    return { found: false, description: '', calories: null, protein: null, carbs: null, fat: null, confidence: 0, parseFailed: true };
  }
}

/**
 * @param {Buffer} imageBuffer zdjecie posilku (JPEG/PNG)
 * @param {string} mimeType
 */
export async function recognizeMeal(imageBuffer, mimeType = 'image/jpeg') {
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: [imagePart(imageBuffer.toString('base64'), mimeType), { text: PROMPT }],
    })
  );
  return parseVerdict(res.text);
}

// --- Namespace w pamieci ---
function data() {
  const d = load();
  if (!Array.isArray(d.meals)) d.meals = [];
  return d;
}

export function getMeals(limit = 50) {
  return data().meals.slice(-limit).reverse();
}

export function addMeal(verdict) {
  const d = data();
  const entry = {
    id: nanoid(8),
    description: verdict.description || '',
    calories: verdict.calories,
    protein: verdict.protein,
    carbs: verdict.carbs,
    fat: verdict.fat,
    confidence: verdict.confidence,
    ts: Date.now(),
  };
  d.meals.push(entry);
  save(d);
  return entry;
}

export function removeMeal(id) {
  const d = data();
  d.meals = d.meals.filter((m) => m.id !== id);
  save(d);
  return d.meals;
}

/** Suma kalorii/makro z ostatnich `days` dni - do szybkiego podgladu dnia/tygodnia. */
export function summarizeMeals(days = 1) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const items = data().meals.filter((m) => m.ts >= since);
  const total = items.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      carbs: acc.carbs + (m.carbs || 0),
      fat: acc.fat + (m.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  return { days, count: items.length, ...total };
}

// --- Router ---
// Eksportuje Router zamiast montowac sie w index.js - patrz raport koncowy.
export const router = express.Router();

router.post('/', requireOwner, async (req, res) => {
  const { image: imageDataUrl, mimeType } = req.body || {};
  if (!imageDataUrl) return res.status(400).json({ error: 'Brak zdjecia.' });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
  }
  try {
    const base64Data = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Puste zdjecie.' });
    const verdict = await recognizeMeal(buffer, mimeType || 'image/jpeg');
    const entry = verdict.found ? addMeal(verdict) : null;
    res.status(201).json({ ...verdict, saved: Boolean(entry), entry });
  } catch (err) {
    console.error('Meal vision error:', err);
    res.status(500).json({ error: 'Nie udalo sie rozpoznac posilku.' });
  }
});

router.get('/', requireOwner, (req, res) => {
  res.json(getMeals(Number(req.query.limit) || 50));
});

router.get('/summary', requireOwner, (req, res) => {
  res.json(summarizeMeals(Number(req.query.days) || 1));
});

router.delete('/:id', requireOwner, (req, res) => {
  res.json(removeMeal(req.params.id));
});
