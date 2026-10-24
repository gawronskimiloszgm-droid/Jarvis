// Telefon jako pilot do komputera + powiadomienia z komputera na telefon.
//
// Przeplyw: telefon -> POST /api/remote/command -> kolejka na serwerze ->
// aplikacja desktopowa (long-poll /api/remote/poll) wykonuje akcje przez te sama
// polityke E.D.I.T.H. co zawsze -> POST /api/remote/result -> telefon odbiera
// wynik. Komputer odbiera polecenia TYLKO gdy wlasciciel wlaczyl na nim
// "zdalne sterowanie" (domyslnie wylaczone), a lista akcji jest waska i stala.

import express from 'express';
import crypto from 'crypto';
import { requireOwner } from '../core/auth.js';
import * as push from '../connect/push.js';
import { isDnd } from './dnd.js';

const router = express.Router();

export const REMOTE_ALLOWED = new Set([
  'odtworz-pauza', 'nastepny-utwor', 'poprzedni-utwor', 'glosniej', 'ciszej', 'wycisz',
  'zablokuj-ekran', 'uspij-komputer', 'pokaz-pulpit', 'zamknij-okno',
  'zrzut-i-opisz', 'lista-okien', 'lista-procesow', 'schowek-odczyt', 'schowek-zapis',
  'otworz-aplikacje', 'otworz-spotify', 'otworz-przegladarke', 'przelacz-okno', 'pisz-tekst',
  'restart-komputera', 'wylacz-komputer',
]);
// Te dwie wymagaja jawnego potwierdzenia na telefonie (confirmed:true).
const NEEDS_CONFIRM = new Set(['restart-komputera', 'wylacz-komputer', 'uspij-komputer']);

const COMMAND_TTL = 60 * 1000;
const RESULT_TTL = 5 * 60 * 1000;
const POLL_HOLD = 20 * 1000;

const queue = [];
const results = new Map();
let waiter = null;
let lastSeen = 0;
let deviceName = '';
let hostEnabled = false;

function prune() {
  const now = Date.now();
  while (queue.length && now - queue[0].at > COMMAND_TTL) queue.shift();
  for (const [id, r] of results) if (now - r.at > RESULT_TTL) results.delete(id);
}

router.post('/api/remote/command', requireOwner, (req, res) => {
  prune();
  const action = String(req.body?.action || '');
  if (!REMOTE_ALLOWED.has(action)) return res.status(400).json({ error: 'Ta akcja nie jest dostepna zdalnie.' });
  if (NEEDS_CONFIRM.has(action) && req.body?.confirmed !== true) {
    return res.status(400).json({ error: 'Ta akcja wymaga potwierdzenia (confirmed:true).' });
  }
  if (Date.now() - lastSeen > 45000) return res.status(409).json({ error: 'Komputer jest offline albo zdalne sterowanie jest wylaczone.' });
  if (queue.length >= 20) return res.status(429).json({ error: 'Za duzo oczekujacych polecen.' });
  const params = {};
  for (const [k, v] of Object.entries(req.body?.params || {}).slice(0, 8)) {
    if (['string', 'number', 'boolean'].includes(typeof v)) params[String(k).slice(0, 30)] = typeof v === 'string' ? v.slice(0, 2000) : v;
  }
  const cmd = { id: crypto.randomBytes(6).toString('hex'), action, params, confirmed: Boolean(req.body?.confirmed), at: Date.now() };
  queue.push(cmd);
  if (waiter) {
    const w = waiter;
    waiter = null;
    w();
  }
  res.json({ id: cmd.id });
});

// Long-poll z aplikacji desktopowej: zwraca polecenie, gdy tylko sie pojawi,
// albo pusty obiekt po POLL_HOLD ms (klient od razu pyta ponownie).
router.get('/api/remote/poll', requireOwner, (req, res) => {
  lastSeen = Date.now();
  deviceName = String(req.query.device || deviceName || 'komputer').slice(0, 40);
  hostEnabled = true;
  const finish = () => {
    prune();
    res.json(queue.length ? { cmd: queue.shift() } : {});
  };
  prune();
  if (queue.length) return finish();
  if (waiter) waiter(); // poprzednie, porzucone zapytanie
  const timer = setTimeout(() => {
    waiter = null;
    lastSeen = Date.now();
    finish();
  }, POLL_HOLD);
  const mine = () => {
    clearTimeout(timer);
    finish();
  };
  waiter = mine;
  res.on('close', () => {
    clearTimeout(timer);
    if (waiter === mine) waiter = null;
  });
});

router.post('/api/remote/result', requireOwner, express.json({ limit: '12mb' }), (req, res) => {
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'Brak id.' });
  const r = req.body?.result && typeof req.body.result === 'object' ? req.body.result : {};
  // Obrazek bywa duzy - nie trzymamy ponad ~6 MB w pamieci.
  if (typeof r.imageBase64 === 'string' && r.imageBase64.length > 6_000_000) r.imageBase64 = null;
  results.set(id, { at: Date.now(), result: r });
  res.json({ ok: true });
});

router.get('/api/remote/result/:id', requireOwner, (req, res) => {
  const r = results.get(req.params.id);
  res.json(r ? { done: true, result: r.result } : { done: false });
});

router.get('/api/remote/status', requireOwner, (req, res) => {
  res.json({ online: Date.now() - lastSeen < 45000, device: deviceName, lastSeen, hostEnabled });
});

// Gdy wlasciciel wylacza zdalne sterowanie na komputerze, host to zglasza.
router.post('/api/remote/disable', requireOwner, (req, res) => {
  lastSeen = 0;
  queue.length = 0;
  hostEnabled = false;
  res.json({ ok: true });
});

// --- Powiadomienia z komputera na telefon ---
router.post('/api/notify', requireOwner, async (req, res) => {
  const title = String(req.body?.title || 'J.A.R.V.I.S.').slice(0, 80);
  const body = String(req.body?.body || '').slice(0, 300);
  if (!body) return res.status(400).json({ error: 'Brak tresci.' });
  if (!push.isConfigured()) return res.json({ sent: false, reason: 'push nie jest skonfigurowany' });
  if (isDnd() && !req.body?.force) return res.json({ sent: false, reason: 'tryb nie przeszkadzac' });
  await push.sendToAll({ title, body }).catch(() => {});
  res.json({ sent: true });
});

export default router;
