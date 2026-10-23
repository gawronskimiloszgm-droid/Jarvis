// Funkcje 22, 23, 27, 28: cykl zycia pojedynczego faktu z plaskiej listy
// memory.js (data.facts) - wygasanie wagi w czasie, rozroznienie pewnosci
// (heard_once/confirmed_multiple), reczna edycja/scalanie oraz automatyczne
// tagowanie kategoriami. Metadane trzymane sa pod nowym kluczem
// data.factMeta (mapa: znormalizowany tekst faktu -> metadane), zeby nie
// ruszac samej tablicy facts poza tym, co uzytkownik jawnie edytuje.

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { load, save } from './memory.js';
import { withModel } from '../core/geminiChain.js';
import { requireOwner } from '../core/auth.js';
import {
  CATEGORIES,
  normalizeFactKey,
  resolveMetaEntry,
  ensureNamespace,
  snapshotVersion,
  similarity,
} from './knowledgeStore.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Polczas zaniku wagi faktu - bez potwierdzenia (rozmowa wspominajaca go
// ponownie albo reczne "odswiezenie") po tylu dniach waga spada do polowy.
// 90 dni to kompromis: dosc dlugo, zeby rzadko wspominane, ale wciaz
// prawdziwe fakty (np. "ma psa") nie wypadaly z listy "aktywnych" po
// miesiacu ciszy w rozmowach.
const HALF_LIFE_DAYS = 90;

function computeWeight(meta, now = Date.now()) {
  if (!meta) return 0;
  const ref = meta.lastConfirmedAt || meta.createdAt || now;
  const ageDays = Math.max(0, (now - ref) / 86400000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function findSimilarCanonicalKey(factMeta, text) {
  let best = null;
  let bestScore = 0;
  for (const [key, meta] of Object.entries(factMeta)) {
    if (meta.aliasOf) continue;
    const score = similarity(text, meta.text);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

// Punkt styku z plaska lista faktow, ktora dopisuje jarvis.js (przez
// memory.addFacts, poza tym plikiem). Wolane na poczatku kazdego handlera
// ponizej, wiec nowe fakty dostaja metadane bez potrzeby zaczepiania sie w
// jarvis.js (ktorego nie wolno tu edytowac). Fakt, ktory brzmi bardzo
// podobnie do juz sledzonego, traktowany jest jako jego potwierdzenie
// (rosnie confidence), a nie nowy, oddzielny wpis - bo memory.addFacts()
// odrzuca po cichu TYLKO doslowne duplikaty, a przeformulowanie tego
// samego faktu i tak trafia do facts jako osobny string.
export function ensureFactMeta() {
  const data = ensureNamespace(load());
  const known = data.factMeta;
  const currentKeys = new Set();
  let changed = false;

  for (const text of data.facts) {
    const key = normalizeFactKey(text);
    currentKeys.add(key);
    if (known[key]) continue;

    const similarKey = findSimilarCanonicalKey(known, text);
    if (similarKey) {
      const meta = known[similarKey];
      meta.occurrences = (meta.occurrences || 1) + 1;
      meta.confidence = meta.occurrences >= 2 ? 'confirmed_multiple' : 'heard_once';
      meta.lastConfirmedAt = Date.now();
      meta.aliases = meta.aliases || [];
      meta.aliases.push(text);
      known[key] = { aliasOf: similarKey };
    } else {
      known[key] = {
        text,
        category: null,
        confidence: 'heard_once',
        occurrences: 1,
        createdAt: Date.now(),
        lastConfirmedAt: Date.now(),
        aliases: [],
      };
    }
    changed = true;
  }

  for (const key of Object.keys(known)) {
    if (!currentKeys.has(key)) {
      delete known[key];
      changed = true;
    }
  }

  if (changed) save(data);
  return data;
}

const CLASSIFY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    wpisy: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          indeks: { type: Type.NUMBER },
          kategoria: { type: Type.STRING, enum: CATEGORIES },
        },
        required: ['indeks', 'kategoria'],
      },
    },
  },
  required: ['wpisy'],
};

async function classifyBatch(texts) {
  const numbered = texts.map((t, i) => `${i}: ${t}`).join('\n');
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Przypisz kazdemu z ponizszych faktow o uzytkowniku dokladnie jedna kategorie z listy: ` +
        `${CATEGORIES.join(', ')}.\n\nFakty:\n${numbered}`,
      config: { responseMimeType: 'application/json', responseSchema: CLASSIFY_SCHEMA },
    })
  );
  const parsed = JSON.parse(res.text);
  const out = texts.map(() => 'inne');
  for (const w of parsed.wpisy || []) {
    const idx = Number(w.indeks);
    if (Number.isInteger(idx) && idx >= 0 && idx < texts.length && CATEGORIES.includes(w.kategoria)) {
      out[idx] = w.kategoria;
    }
  }
  return out;
}

export async function classifyPendingFacts(limit = 20) {
  const data = ensureFactMeta();
  const pending = Object.values(data.factMeta).filter((m) => !m.aliasOf && !m.category).slice(0, limit);
  if (!pending.length) return { classified: 0 };
  const categories = await classifyBatch(pending.map((m) => m.text));
  pending.forEach((meta, i) => {
    meta.category = categories[i];
  });
  save(data);
  return { classified: pending.length };
}

async function mergeFactsWithAI(a, b) {
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Scal te dwa fakty o uzytkowniku w jedno, krotkie, spojne zdanie po polsku, bez utraty informacji:\n` +
        `1. ${a}\n2. ${b}`,
    })
  );
  return (res.text || '').trim() || `${a}; ${b}`;
}

const router = express.Router();

router.get('/api/facts/meta', requireOwner, (req, res) => {
  const data = ensureFactMeta();
  const now = Date.now();
  const items = data.facts.map((text, index) => {
    const meta = resolveMetaEntry(data.factMeta, text) || {};
    return {
      index,
      text,
      confidence: meta.confidence || 'heard_once',
      occurrences: meta.occurrences || 1,
      category: meta.category || null,
      weight: Math.round(computeWeight(meta, now) * 100) / 100,
      createdAt: meta.createdAt || null,
      lastConfirmedAt: meta.lastConfirmedAt || null,
    };
  });
  res.json({ facts: items });
});

router.get('/api/facts/active', requireOwner, (req, res) => {
  const threshold = Math.min(1, Math.max(0, Number(req.query.threshold) || 0.15));
  const data = ensureFactMeta();
  const now = Date.now();
  const facts = data.facts
    .map((text, index) => ({ index, text, w: computeWeight(resolveMetaEntry(data.factMeta, text), now) }))
    .filter((f) => f.w > threshold)
    .map((f) => ({ index: f.index, text: f.text, weight: Math.round(f.w * 100) / 100 }));
  res.json({ threshold, count: facts.length, facts });
});

router.post('/api/facts/:index/refresh', requireOwner, (req, res) => {
  const idx = Number(req.params.index);
  const data = ensureFactMeta();
  if (!(idx >= 0 && idx < data.facts.length)) {
    return res.status(404).json({ error: 'Nie ma faktu o tym indeksie.' });
  }
  snapshotVersion('odswiezenie faktu');
  const text = data.facts[idx];
  const key = normalizeFactKey(text);
  let entry = data.factMeta[key];
  if (entry?.aliasOf) entry = data.factMeta[entry.aliasOf];
  if (!entry) {
    entry = {
      text,
      category: null,
      confidence: 'heard_once',
      occurrences: 1,
      createdAt: Date.now(),
      lastConfirmedAt: Date.now(),
      aliases: [],
    };
    data.factMeta[key] = entry;
  }
  entry.occurrences = (entry.occurrences || 1) + 1;
  entry.confidence = entry.occurrences >= 2 ? 'confirmed_multiple' : 'heard_once';
  entry.lastConfirmedAt = Date.now();
  save(data);
  res.json({ ok: true, fact: text, confidence: entry.confidence, occurrences: entry.occurrences });
});

router.put('/api/facts/:index', requireOwner, (req, res) => {
  const idx = Number(req.params.index);
  const newText = String(req.body?.text || '').trim();
  if (!newText) return res.status(400).json({ error: 'Podaj tresc faktu.' });
  const data = ensureFactMeta();
  if (!(idx >= 0 && idx < data.facts.length)) {
    return res.status(404).json({ error: 'Nie ma faktu o tym indeksie.' });
  }
  snapshotVersion('edycja faktu');
  const oldText = data.facts[idx];
  const oldMeta = resolveMetaEntry(data.factMeta, oldText);
  delete data.factMeta[normalizeFactKey(oldText)];
  data.facts[idx] = newText;
  data.factMeta[normalizeFactKey(newText)] = {
    text: newText,
    category: oldMeta?.category ?? null,
    confidence: oldMeta?.confidence ?? 'heard_once',
    occurrences: oldMeta?.occurrences ?? 1,
    createdAt: oldMeta?.createdAt ?? Date.now(),
    lastConfirmedAt: Date.now(),
    aliases: [],
  };
  save(data);
  res.json({ ok: true, facts: data.facts });
});

router.post('/api/facts/merge', requireOwner, async (req, res) => {
  const a = Number(req.body?.indexA);
  const b = Number(req.body?.indexB);
  const mode = req.body?.mode === 'ai' ? 'ai' : 'concat';
  const data = ensureFactMeta();
  if (!(a >= 0 && a < data.facts.length) || !(b >= 0 && b < data.facts.length) || a === b) {
    return res.status(400).json({ error: 'Podaj dwa rozne, istniejace indeksy faktow.' });
  }
  const textA = data.facts[a];
  const textB = data.facts[b];
  let merged = `${textA}; ${textB}`;
  if (mode === 'ai') {
    try {
      merged = await mergeFactsWithAI(textA, textB);
    } catch {
      /* model niedostepny - zostaje fallback konkatenacji ustawiony wyzej */
    }
  }
  snapshotVersion('scalanie faktow');
  const metaA = resolveMetaEntry(data.factMeta, textA);
  const metaB = resolveMetaEntry(data.factMeta, textB);
  delete data.factMeta[normalizeFactKey(textA)];
  delete data.factMeta[normalizeFactKey(textB)];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  data.facts.splice(hi, 1);
  data.facts.splice(lo, 1, merged);
  data.factMeta[normalizeFactKey(merged)] = {
    text: merged,
    category: metaA?.category || metaB?.category || null,
    confidence: 'confirmed_multiple',
    occurrences: (metaA?.occurrences || 1) + (metaB?.occurrences || 1),
    createdAt: Math.min(metaA?.createdAt || Date.now(), metaB?.createdAt || Date.now()),
    lastConfirmedAt: Date.now(),
    aliases: [],
  };
  save(data);
  res.json({ ok: true, facts: data.facts });
});

router.get('/api/facts/category/:category', requireOwner, (req, res) => {
  const cat = String(req.params.category || '').trim().toLowerCase();
  const data = ensureFactMeta();
  const facts = data.facts
    .map((text, index) => ({ index, text, meta: resolveMetaEntry(data.factMeta, text) }))
    .filter((f) => (f.meta?.category || 'inne') === cat)
    .map(({ index, text }) => ({ index, text }));
  res.json({ category: cat, facts });
});

router.post('/api/facts/classify', requireOwner, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit) || 20));
    res.json(await classifyPendingFacts(limit));
  } catch {
    res.status(503).json({ error: 'Model niedostepny - sprobuj ponownie za chwile.' });
  }
});

export const factsRouter = router;
