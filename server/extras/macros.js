// Makra: tryby (rutyny) nagrane z faktycznie wykonanych akcji, razem z ich
// parametrami. Stary magazyn `routines` trzyma kroki `{ akcja }` - tutaj
// dochodzi `params`, a w wartosciach tekstowych mozna uzyc {{arg}}, czyli
// jednego argumentu podawanego przy uruchomieniu ("tryb pisz | Marek").

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';

const router = express.Router();
const MAX_STEPS = 40;

// Tylko plaskie parametry tekstowe/liczbowe/boolowskie - makro nie ma byc
// wehikulem na dowolne obiekty (i nie wnosi nic do pamieci poza tym).
function cleanParams(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(p).slice(0, 12)) {
    if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, 2000);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k.slice(0, 40)] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function cleanSteps(kroki) {
  if (!Array.isArray(kroki)) return [];
  return kroki
    .slice(0, MAX_STEPS)
    .map((s) => {
      const akcja = String(s?.akcja || '').trim().slice(0, 60);
      if (!/^[a-z0-9-]+$/.test(akcja)) return null;
      const params = cleanParams(s?.params);
      return params ? { akcja, params } : { akcja };
    })
    .filter(Boolean);
}

router.post('/api/macros', requireOwner, (req, res) => {
  const nazwa = String(req.body?.nazwa || '').trim().toLowerCase().slice(0, 40);
  const steps = cleanSteps(req.body?.kroki);
  if (!nazwa || !steps.length) return res.status(400).json({ error: 'Podaj nazwe i co najmniej jeden krok.' });
  memory.saveRoutine(nazwa, steps);
  res.json({ ok: true, nazwa, kroki: steps.length });
});

router.delete('/api/macros/:name', requireOwner, (req, res) => {
  memory.removeRoutine(req.params.name);
  res.json({ ok: true });
});

export default router;
