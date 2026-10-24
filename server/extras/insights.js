// Czas pracy (z aplikacji desktopowej) i historia telemetrii do wykresow.
// Czas pracy to zagregowane sekundy na program na dzien - bez tytulow okien.

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';
import { registerBriefSection } from '../core/briefing.js';
import { history, alerts, THRESHOLDS, snapshot } from '../home/telemetry.js';

const router = express.Router();

function store() {
  const d = memory.load();
  if (!d.worktime || typeof d.worktime !== 'object') d.worktime = { at: 0, byDay: {} };
  return d.worktime;
}

function cleanByDay(byDay) {
  const out = {};
  for (const [day, apps] of Object.entries(byDay || {}).slice(-30)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof apps !== 'object') continue;
    out[day] = {};
    for (const [name, sec] of Object.entries(apps).slice(0, 60)) {
      const n = Number(sec);
      if (Number.isFinite(n) && n > 0) out[day][String(name).slice(0, 60)] = Math.round(n);
    }
  }
  return out;
}

router.post('/api/worktime', requireOwner, (req, res) => {
  const w = store();
  w.byDay = { ...w.byDay, ...cleanByDay(req.body?.byDay) };
  const keys = Object.keys(w.byDay).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete w.byDay[k];
  w.at = Date.now();
  memory.save(memory.load());
  res.json({ ok: true });
});

router.get('/api/worktime', requireOwner, (req, res) => res.json(store()));

router.get('/api/telemetry/history', requireOwner, (req, res) => {
  res.json({
    thresholds: THRESHOLDS,
    alerts: alerts(),
    machines: snapshot().map((m) => ({ machine: m.machine, online: m.online, samples: history(m.machine) })),
  });
});

function warsawDay(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(Date.now() + offsetDays * 86400000));
}

function human(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

// Odprawa poranna: wczorajszy czas przed komputerem i trzy glowne programy.
registerBriefSection(async (kind) => {
  if (kind !== 'morning') return null;
  const apps = store().byDay[warsawDay(-1)];
  if (!apps) return null;
  const total = Object.values(apps).reduce((a, b) => a + b, 0);
  if (total < 600) return null;
  const top = Object.entries(apps)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, s]) => `${n} (${human(s)})`);
  return `Wczoraj przy komputerze ${human(total)}: ${top.join(', ')}.`;
});

export default router;
