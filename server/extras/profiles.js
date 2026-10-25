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
const GAME_PROFILE = { name: 'gra', theme: 'zielony', motion: 'low', permissionMode: 'zaufany', dndMinutes: 240, routine: '', note: 'Tryb gry: odzywaj sie tylko gdy pytam, bardzo krotko, bez zaczepiania.' };

// Reguly automatycznych profili: pierwsza pasujaca wygrywa (aplikacje/gra przed pora dnia).
const DEFAULT_RULES = [
  { typ: 'gra', profil: 'gra' },
  { typ: 'aplikacja', proc: 'Code', profil: 'praca' },
  { typ: 'czas', od: '23:00', do: '07:00', profil: 'noc' },
];

function state() {
  const d = memory.load();
  if (!d.profiles || !Array.isArray(d.profiles.list) || !d.profiles.list.length) d.profiles = { list: SEED.map((p) => ({ ...p })), active: 'dom' };
  if (!d.profiles.list.some((p) => p.name === d.profiles.active)) d.profiles.active = d.profiles.list[0].name;
  // Jednorazowo dokladamy profil "gra" (tryb gry) i domyslne reguly (wylaczone, dopoki ich nie wlaczysz).
  if (!d.profiles.gameAdded) {
    d.profiles.gameAdded = true;
    if (!d.profiles.list.some((p) => p.name === 'gra')) d.profiles.list.push({ ...GAME_PROFILE });
  }
  if (!Array.isArray(d.profiles.rules)) d.profiles.rules = DEFAULT_RULES.map((r) => ({ ...r }));
  if (typeof d.profiles.auto !== 'boolean') d.profiles.auto = false;
  return d.profiles;
}

// Tylko tekst i liczby - obiekt z zapytania nie moze zamienic sie w nazwe "[object Object]".
const clip = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').trim().slice(0, n);

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

router.post('/api/profiles/rules', requireOwner, (req, res) => {
  const s = state();
  const HH = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const rules = (Array.isArray(req.body?.rules) ? req.body.rules : [])
    .slice(0, 20)
    .map((r) => {
      const profil = clip(r?.profil, 30).toLowerCase();
      if (!profil) return null;
      if (r.typ === 'gra') return { typ: 'gra', profil };
      if (r.typ === 'aplikacja' && clip(r.proc, 60)) return { typ: 'aplikacja', proc: clip(r.proc, 60), profil };
      if (r.typ === 'czas' && HH.test(clip(r.od, 5)) && HH.test(clip(r.do, 5))) return { typ: 'czas', od: clip(r.od, 5), do: clip(r.do, 5), profil };
      return null;
    })
    .filter(Boolean);
  s.rules = rules;
  s.auto = Boolean(req.body?.auto);
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
