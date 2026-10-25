// Dziennik audytowy: kazda akcja, ktora Jarvis (albo agent ekranu) probowal
// wykonac na komputerze, razem z werdyktem E.D.I.T.H. Klient dopisuje wpisy
// po kazdej akcji; panel E.D.I.T.H. je pokazuje. Przechowywane w pamieci
// trwalej (ostatnie 500), wiec przezywa restart.

import express from 'express';
import * as memory from '../memory/memory.js';
import { requireOwner } from '../core/auth.js';
import { watchAudit } from '../security/edith.js';

const router = express.Router();
const CAP = 500;

function bucket() {
  const data = memory.load();
  if (!Array.isArray(data.audit)) data.audit = [];
  return data.audit;
}

const clip = (v, n) => String(v ?? '').slice(0, n);

export function recordAudit(entry) {
  const list = bucket();
  list.unshift({
    at: Date.now(),
    name: clip(entry.name, 60),
    detail: clip(entry.detail, 240),
    source: clip(entry.source || 'jarvis', 30),
    verdict: ['ok', 'failed', 'blocked', 'confirm', 'denied', 'allowed'].includes(entry.verdict) ? entry.verdict : 'ok',
    note: clip(entry.note, 200),
  });
  if (list.length > CAP) list.length = CAP;
  memory.save(memory.load());
  try {
    watchAudit(list[0], list);
  } catch (err) {
    console.error('Czujnik E.D.I.T.H.:', err.message);
  }
}

router.post('/api/audit', requireOwner, (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 20) : [req.body];
  entries.forEach((e) => e && e.name && recordAudit(e));
  res.json({ ok: true });
});

router.get('/api/audit', requireOwner, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, CAP);
  const verdict = req.query.verdict;
  let list = bucket();
  if (verdict) list = list.filter((e) => e.verdict === verdict);
  res.json({ total: bucket().length, entries: list.slice(0, limit) });
});

router.delete('/api/audit', requireOwner, (req, res) => {
  memory.load().audit = [];
  memory.save(memory.load());
  res.json({ ok: true });
});

export default router;
