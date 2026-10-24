// Profile: nazwane zestawy ustawien przelaczane jednym slowem ("profil praca").
// Profil moze zmienic motyw i animacje, tryb uprawnien Jarvisa na komputerze,
// wlaczyc "nie przeszkadzac", uruchomic tryb (rutyne) i dopisac Jarvisowi
// wskazowke, jak ma sie zachowywac (np. "odpowiadaj krotko, bez zartow").
// Serwer trzyma definicje i aktywny profil; same zmiany ustawien robi klient.

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';
import { registerContextProvider } from '../core/jarvis.js';

const router = express.Router();
const MAX = 12;

const SEED = [
  { name: 'praca', theme: 'cyjan', motion: 'low', permissionMode: 'zaufany', dndMinutes: 120, routine: '', note: 'Tryb pracy: odpowiadaj krotko i konkretnie, bez zartow i dygresji, nie zaczepiaj sam z siebie.' },
  { name: 'dom', theme: 'cyjan', motion: 'full', permissionMode: 'zaufany', dndMinutes: 0, routine: '', note: '' },
  { name: 'noc', theme: 'bursztyn', motion: 'off', permissionMode: 'pytaj', dndMinutes: 480, routine: '', note: 'Tryb nocny: mow cicho i krotko, nic nie wykonuj na komputerze bez pytania.' },
];

function state() {
  const d = memory.load();
  if (!d.profiles || !Array.isArray(d.profiles.list) || !d.profiles.list.length) d.profiles = { list: SEED.map((p) => ({ ...p })), active: 'dom' };
  return d.profiles;
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function clean(p) {
  const name = clip(p?.name, 30).toLowerCase();
  if (!name) return null;
  return {
    name,
    theme: ['cyjan', 'bursztyn', 'zielony', 'fiolet', 'mono'].includes(p.theme) ? p.theme : 'cyjan',
    motion: ['full', 'low', 'off'].includes(p.motion) ? p.motion : 'full',
    permissionMode: ['podglad', 'pytaj', 'zaufany'].includes(p.permissionMode) ? p.permissionMode : 'zaufany',
    dndMinutes: Math.max(0, Math.min(1440, Number(p.dndMinutes) || 0)),
    routine: clip(p.routine, 40).toLowerCase(),
    note: clip(p.note, 300),
  };
}

export function profileBlock() {
  const s = state();
  const p = s.list.find((x) => x.name === s.active);
  return p && p.note ? `AKTYWNY PROFIL "${p.name}": ${p.note}` : '';
}

registerContextProvider(async () => profileBlock());

router.get('/api/profiles', requireOwner, (req, res) => res.json(state()));

router.post('/api/profiles', requireOwner, (req, res) => {
  const p = clean(req.body);
  if (!p) return res.status(400).json({ error: 'Podaj nazwe profilu.' });
  const s = state();
  const i = s.list.findIndex((x) => x.name === p.name);
  if (i >= 0) s.list[i] = p;
  else if (s.list.length >= MAX) return res.status(400).json({ error: `Limit ${MAX} profili.` });
  else s.list.push(p);
  memory.save(memory.load());
  res.json(s);
});

router.delete('/api/profiles/:name', requireOwner, (req, res) => {
  const s = state();
  const name = req.params.name.toLowerCase();
  if (s.list.length <= 1) return res.status(400).json({ error: 'Musi zostac co najmniej jeden profil.' });
  s.list = s.list.filter((x) => x.name !== name);
  if (s.active === name) s.active = s.list[0].name;
  memory.save(memory.load());
  res.json(s);
});

router.post('/api/profiles/activate', requireOwner, (req, res) => {
  const s = state();
  const name = clip(req.body?.name, 30).toLowerCase();
  const p = s.list.find((x) => x.name === name);
  if (!p) return res.status(404).json({ error: `Nie ma profilu "${name}".` });
  s.active = p.name;
  memory.save(memory.load());
  res.json({ active: p.name, profile: p });
});

export default router;
