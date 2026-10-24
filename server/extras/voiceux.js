// Doswiadczenie glosowe: wlasny slownik (aliasy) i tryb "nie przeszkadzac".
//
// Aliasy ("moj projekt" = C:\Projekty\Jarvis, "Kasia" = zona) trafiaja do
// promptow Jarvisa (czat i rozmowa na zywo), wiec nazwy, ktore model slabo
// rozpoznaje na sluch, maja przypisane znaczenie - to wprost zmniejsza
// liczbe sytuacji "uslyszal cos innego".

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';
import { dndState, setDnd } from './dnd.js';
import { registerContextProvider } from '../core/jarvis.js';

const router = express.Router();
const MAX_ALIASES = 80;

// Slownik trafia tez do zwyklego czatu (jako kontekst instrukcji systemowej).
registerContextProvider(async () => aliasBlock());

function aliases() {
  const data = memory.load();
  if (!Array.isArray(data.aliases)) data.aliases = [];
  return data.aliases;
}

export function aliasBlock() {
  const list = aliases();
  if (!list.length) return '';
  return `SLOWNIK UZYTKOWNIKA (jego wlasne nazwy - gdy uslyszysz lub przeczytasz fraze po lewej, chodzi o znaczenie po prawej; przy watpliwosci dopytaj zamiast zgadywac):\n${list
    .map((a) => `- "${a.fraza}" = ${a.znaczenie}`)
    .join('\n')}`;
}

router.get('/api/aliases', requireOwner, (req, res) => res.json({ aliases: aliases() }));

router.post('/api/aliases', requireOwner, (req, res) => {
  const fraza = String(req.body?.fraza || '').trim().slice(0, 80);
  const znaczenie = String(req.body?.znaczenie || '').trim().slice(0, 300);
  if (!fraza || !znaczenie) return res.status(400).json({ error: 'Podaj fraze i jej znaczenie.' });
  const list = aliases();
  const i = list.findIndex((a) => a.fraza.toLowerCase() === fraza.toLowerCase());
  if (i >= 0) list[i] = { fraza, znaczenie };
  else if (list.length >= MAX_ALIASES) return res.status(400).json({ error: `Limit ${MAX_ALIASES} wpisow.` });
  else list.push({ fraza, znaczenie });
  memory.save(memory.load());
  res.json({ aliases: list });
});

router.delete('/api/aliases', requireOwner, (req, res) => {
  const fraza = String(req.query.fraza || '').toLowerCase();
  const data = memory.load();
  data.aliases = aliases().filter((a) => a.fraza.toLowerCase() !== fraza);
  memory.save(data);
  res.json({ aliases: data.aliases });
});

// --- Nie przeszkadzac --- (logika w dnd.js)

router.get('/api/dnd', requireOwner, (req, res) => res.json(dndState()));
router.post('/api/dnd', requireOwner, (req, res) => res.json(setDnd(req.body?.minutes, req.body?.textOnly)));

export default router;
