// Glosowe skroty makr - rozszerza istniejace "tryby/rutyny" z memory.js
// (getRoutines/getRoutine/saveRoutine, NIE edytowane tutaj - tylko
// uzywane) o dwie rzeczy, ktorych tamten magazyn nie ma:
//   1. opis "kiedy/jak sie uruchamia" (np. "wieczorem, komenda 'tryb kinowy'")
//   2. licznik uzyc, do statystyki popularnosci trybow
// Kroki wykonania (DEVICE_ACTIONS) i tak zyja po stronie klienta (patrz
// runRoutineSteps w app.js, nieedytowany) - ten modul niczego nie
// wykonuje, tylko opisuje i zlicza.

import express from 'express';
import { load, save } from '../memory/memory.js';
import { getRoutines, getRoutine } from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';

function ensureNamespace() {
  const data = load();
  if (!data.voiceConversation) data.voiceConversation = {};
  if (!data.voiceConversation.routineMeta || typeof data.voiceConversation.routineMeta !== 'object') {
    data.voiceConversation.routineMeta = {};
  }
  return data;
}

function metaFor(data, name) {
  if (!data.voiceConversation.routineMeta[name]) {
    data.voiceConversation.routineMeta[name] = { description: '', usageCount: 0, lastUsedAt: null };
  }
  return data.voiceConversation.routineMeta[name];
}

/** Lista rutyn (memory.js) polaczona z opisem/licznikiem uzyc (ten modul). */
export function listRoutinesWithStats() {
  const data = ensureNamespace();
  return getRoutines().map((r) => {
    const meta = data.voiceConversation.routineMeta[r.name] || { description: '', usageCount: 0, lastUsedAt: null };
    return {
      name: r.name,
      stepCount: Array.isArray(r.steps) ? r.steps.length : 0,
      createdAt: r.createdAt,
      description: meta.description,
      usageCount: meta.usageCount,
      lastUsedAt: meta.lastUsedAt,
    };
  });
}

export function setRoutineDescription(name, description) {
  const clean = String(name || '').trim().toLowerCase();
  if (!getRoutine(clean)) return null;
  const data = ensureNamespace();
  const meta = metaFor(data, clean);
  meta.description = String(description || '').trim().slice(0, 300);
  save(data);
  return meta;
}

/** Wywolywane, gdy rutyna faktycznie zostaje odtworzona (glosem/skrotem). */
export function recordRoutineUsage(name) {
  const clean = String(name || '').trim().toLowerCase();
  if (!getRoutine(clean)) return null;
  const data = ensureNamespace();
  const meta = metaFor(data, clean);
  meta.usageCount += 1;
  meta.lastUsedAt = Date.now();
  save(data);
  return meta;
}

export const router = express.Router();

router.get('/api/voice/routines', requireOwner, (req, res) => {
  res.json({ routines: listRoutinesWithStats() });
});

router.put('/api/voice/routines/:name/description', requireOwner, (req, res) => {
  const meta = setRoutineDescription(req.params.name, req.body?.description);
  if (!meta) return res.status(404).json({ error: 'Nie znaleziono rutyny o tej nazwie.' });
  res.json(meta);
});

// Wolane, gdy klient faktycznie odtworzyl kroki rutyny (patrz runRoutineSteps
// w public/app.js, ktore juz zna nazwe uruchamianego trybu z tagu [TRYB:...]) -
// integracja opisana w raporcie koncowym, bo app.js nie jest tu edytowany.
router.post('/api/voice/routines/:name/used', requireOwner, (req, res) => {
  const meta = recordRoutineUsage(req.params.name);
  if (!meta) return res.status(404).json({ error: 'Nie znaleziono rutyny o tej nazwie.' });
  res.json(meta);
});

export default router;
