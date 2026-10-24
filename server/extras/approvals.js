// Zdalne zatwierdzanie: gdy E.D.I.T.H. prosi o zgode na ryzykowna akcje, a
// uzytkownika nie ma przy komputerze, powiadomienie push z przyciskami
// "Zatwierdz"/"Odrzuc" trafia na telefon. Kto pierwszy - ten decyduje (lokalne
// "tak" w czacie albo telefon).
//
// Bezpieczenstwo: kazda prosba ma LOSOWY, jednorazowy token (128 bitow)
// wbudowany w adresy z powiadomienia - SW na telefonie nie ma dostepu do
// tokenu sesji wlasciciela, wiec nie moze uwierzytelnic sie inaczej. Token
// dziala raz i wygasa po 10 minutach, a decyzja dotyczy WYLACZNIE tej jednej
// prosby, ktorej tresc widac w powiadomieniu.

import express from 'express';
import crypto from 'crypto';
import { requireOwner } from '../core/auth.js';
import * as push from '../connect/push.js';

const router = express.Router();
const TTL_MS = 10 * 60 * 1000;
const approvals = new Map(); // id -> { text, token, status, createdAt, waiters }

function sweep() {
  const now = Date.now();
  for (const [id, a] of approvals) {
    if (now - a.createdAt > TTL_MS) {
      if (a.status === 'pending') finish(id, 'expired');
      if (now - a.createdAt > TTL_MS * 2) approvals.delete(id);
    }
  }
}

function finish(id, status) {
  const a = approvals.get(id);
  if (!a || a.status !== 'pending') return false;
  a.status = status;
  a.waiters.splice(0).forEach((w) => w(status));
  return true;
}

router.post('/api/approvals', requireOwner, (req, res) => {
  sweep();
  const text = String(req.body?.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Brak tresci prosby.' });
  const id = crypto.randomBytes(6).toString('hex');
  const token = crypto.randomBytes(16).toString('hex');
  approvals.set(id, { text, token, status: 'pending', createdAt: Date.now(), waiters: [] });

  const base = `/api/approvals/${id}/respond?token=${token}`;
  push
    .sendToAll({
      title: 'E.D.I.T.H. prosi o zgode',
      body: text,
      tag: `approval-${id}`,
      requireInteraction: true,
      actions: [
        { action: 'allow', title: 'Zatwierdz' },
        { action: 'deny', title: 'Odrzuc' },
      ],
      data: { allowUrl: `${base}&allow=1`, denyUrl: `${base}&allow=0` },
    })
    .catch(() => {});
  res.json({ id, pushConfigured: push.isConfigured() });
});

// Long-poll: klient czeka do ~25 s na decyzje (zwraca od razu, jesli juz jest).
router.get('/api/approvals/:id/wait', requireOwner, (req, res) => {
  const a = approvals.get(req.params.id);
  if (!a) return res.status(404).json({ status: 'unknown' });
  if (a.status !== 'pending') return res.json({ status: a.status });
  let done = false;
  const reply = (status) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    res.json({ status });
  };
  a.waiters.push(reply);
  const timer = setTimeout(() => reply('pending'), 25000);
  req.on('close', () => {
    done = true;
    clearTimeout(timer);
  });
});

// Decyzja z samej aplikacji (lokalne "tak"/"nie" - zamyka tez prosbe na telefonie).
router.post('/api/approvals/:id/decision', requireOwner, (req, res) => {
  const ok = finish(req.params.id, req.body?.allow ? 'allowed' : 'denied');
  res.json({ ok });
});

// Decyzja z powiadomienia/linku na telefonie - bez sesji, ale z jednorazowym tokenem.
router.get('/api/approvals/:id/respond', (req, res) => {
  const a = approvals.get(req.params.id);
  const valid =
    a && a.status === 'pending' && typeof req.query.token === 'string' && req.query.token.length === a.token.length &&
    crypto.timingSafeEqual(Buffer.from(req.query.token), Buffer.from(a.token));
  const allow = req.query.allow === '1';
  if (valid) finish(req.params.id, allow ? 'allowed' : 'denied');
  res.status(valid ? 200 : 410).type('html').send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#05090b;color:#cdeef7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${
      valid ? (allow ? 'Zatwierdzono' : 'Odrzucono') : 'Ta prosba juz wygasla albo zostala rozpatrzona'
    }</h2><p>J.A.R.V.I.S. / E.D.I.T.H.</p></div>`
  );
});

export default router;
