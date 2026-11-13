// Kolejka wydrukow (lista do zrobienia, niezalezna od drukarki), stan drukarki, kamera i powiadomienie
// po zakonczeniu druku. Studio dodaje tu czesci z szacunkiem czasu i materialu.
import express from 'express';
import { nanoid } from 'nanoid';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as printer from '../home/printer.js';
import { logJournal } from './life.js';
import { isDnd } from './dnd.js';

const router = express.Router();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const STATUS = ['czeka', 'drukuje', 'gotowe', 'nieudane'];

function queue() {
  const d = memory.load();
  if (!Array.isArray(d.printQueue)) d.printQueue = [];
  return d.printQueue;
}
const save = () => memory.save(memory.load());

export function addPrint(b) {
  const name = str(b.name, 100);
  if (!name) return null;
  const q = queue();
  if (q.length >= 300) q.splice(0, q.findIndex((x) => x.status === 'gotowe') + 1 || 1);
  const item = { id: nanoid(8), at: Date.now(), name, project: str(b.project, 100), material: str(b.material, 12) || 'PLA', grams: Math.max(0, num(b.grams)), minutes: Math.max(0, Math.round(num(b.minutes))), copies: Math.max(1, Math.min(50, Math.round(num(b.copies) || 1))), note: str(b.note, 200), status: 'czeka' };
  q.push(item);
  save();
  return item;
}

/** Podsumowanie: ile czeka, ile godzin i materialu. */
export function queueSummary() {
  const waiting = queue().filter((x) => x.status === 'czeka' || x.status === 'drukuje');
  return {
    count: waiting.length,
    minutes: waiting.reduce((a, x) => a + x.minutes * x.copies, 0),
    grams: Math.round(waiting.reduce((a, x) => a + x.grams * x.copies, 0)),
    next: waiting.find((x) => x.status === 'czeka')?.name || null,
  };
}

router.get('/api/printq', requireOwner, (req, res) => res.json({ items: queue(), summary: queueSummary() }));
router.post('/api/printq', requireOwner, (req, res) => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : [req.body || {}]).slice(0, 60).map(addPrint).filter(Boolean);
  if (!items.length) return res.status(400).json({ error: 'Podaj nazwę wydruku.' });
  res.json({ ok: true, items, summary: queueSummary() });
});
router.patch('/api/printq/:id', requireOwner, (req, res) => {
  const it = queue().find((x) => x.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'Nie ma takiego wydruku.' });
  if (STATUS.includes(req.body?.status)) {
    it.status = req.body.status;
    if (it.status === 'gotowe') logJournal('auto', `Wydruk gotowy: ${it.name}`, 'druk');
  }
  if (req.body?.note != null) it.note = str(req.body.note, 200);
  if (req.body?.copies != null) it.copies = Math.max(1, Math.min(50, Math.round(num(req.body.copies))));
  save();
  res.json({ ok: true, item: it });
});
router.delete('/api/printq/:id', requireOwner, (req, res) => {
  const d = memory.load();
  d.printQueue = queue().filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
});
router.post('/api/printq/clear-done', requireOwner, (req, res) => {
  const d = memory.load();
  d.printQueue = queue().filter((x) => x.status !== 'gotowe');
  save();
  res.json({ ok: true });
});

// Stan drukarki: /api/printer/status w server/index.js.
router.get('/api/printer/snapshot', requireOwner, async (req, res) => {
  try {
    const s = await printer.snapshot();
    res.setHeader('Cache-Control', 'no-store');
    res.type(s.type).send(s.buffer);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/**
 * Wolane z cyklu w tle: gdy druk przeszedl z "printing" w koniec, wysylamy powiadomienie
 * i oznaczamy w kolejce pierwszy drukujacy wpis jako gotowy.
 */
export async function watchPrinter(status = printer.jobStatus) {
  if (!printer.isConfigured()) return null;
  const d = memory.load();
  const job = await status();
  if (!job) return null;
  const prev = d.printerLast || {};
  let event = null;
  if (prev.state === 'printing' && job.state !== 'printing' && job.state !== 'paused' && job.state !== 'offline') {
    const ok = job.state === 'finished' || job.state === 'idle';
    event = ok ? `Wydruk zakończony${prev.fileName ? `: ${prev.fileName}` : ''}. Można zdejmować ze stołu.` : `Druk przerwany${prev.fileName ? `: ${prev.fileName}` : ''} (${job.state}). Sprawdź drukarkę.`;
    const it = queue().find((x) => x.status === 'drukuje');
    if (it) it.status = ok ? 'gotowe' : 'nieudane';
    logJournal(ok ? 'auto' : 'alert', event, 'druk');
    if (push.isConfigured() && (!isDnd() || !ok)) await push.sendToAll({ title: 'J.A.R.V.I.S. - drukarka', body: event }).catch(() => {});
  }
  if (job.state !== 'offline') d.printerLast = { state: job.state, fileName: job.fileName, at: Date.now() };
  memory.save(d);
  return event;
}

// ---------- glos ----------
export const PRINT_TOOLS = [
  {
    name: 'drukarka',
    description: 'Drukarka 3D i kolejka wydrukow: stan druku (postep, ile zostalo), lista kolejki albo dopisanie czegos do kolejki (dodaj = nazwa).',
    parameters: { type: 'object', properties: { dodaj: { type: 'string', description: 'co dopisac do kolejki wydrukow' } } },
  },
];
export const PRINT_VOICE_PROMPT = '- drukarka: "jak idzie wydruk", "co jest w kolejce do druku", "dopisz do kolejki uchwyt na latarke".';

export async function runPrintTool(name, a = {}) {
  if (name !== 'drukarka') return undefined;
  if (a.dodaj) {
    const it = addPrint({ name: a.dodaj });
    return it ? { dodano: it.name, kolejka: queueSummary() } : { error: 'podaj, co dopisac' };
  }
  const job = await printer.jobStatus();
  const s = queueSummary();
  return {
    drukarka: job ? { stan: job.state, plik: job.fileName, postep_proc: job.progressPct, zostalo_min: job.printTimeLeftSec != null ? Math.round(job.printTimeLeftSec / 60) : null } : 'nie podlaczona (PRINTER_URL na serwerze)',
    kolejka: s.count ? `${s.count} wydrukow, ok. ${Math.round(s.minutes / 60)} h i ${s.grams} g materialu, nastepny: ${s.next}` : 'pusta',
  };
}

export default router;
