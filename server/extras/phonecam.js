// Telefon jako kamera komputera: serwer tylko przekazuje wiadomosci zestawiajace polaczenie WebRTC.
// Sam obraz idzie bezposrednio miedzy urzadzeniami, nie przez serwer.
import { Router } from 'express';
import { requireOwner } from '../core/auth.js';

const router = Router();
const MAX_QUEUE = 20;
const TTL_MS = 60000;
const boxes = { pc: [], phone: [] };
const seen = { pc: 0, phone: 0 };

const fresh = (role) => {
  const now = Date.now();
  boxes[role] = boxes[role].filter((m) => now - m.at < TTL_MS);
  return boxes[role];
};

router.post('/api/phonecam/signal', requireOwner, (req, res) => {
  const { to, msg } = req.body || {};
  if (!boxes[to] || !msg || typeof msg.type !== 'string') return res.status(400).json({ error: 'Nieprawidłowa wiadomość.' });
  const text = JSON.stringify(msg);
  if (text.length > 60000) return res.status(413).json({ error: 'Za duża wiadomość.' });
  // Starsze zaproszenia tego samego rodzaju sa juz nieaktualne.
  boxes[to] = fresh(to).filter((m) => m.msg.type !== msg.type);
  boxes[to].push({ at: Date.now(), msg });
  if (boxes[to].length > MAX_QUEUE) boxes[to].shift();
  res.json({ ok: true });
});

router.get('/api/phonecam/signal', requireOwner, (req, res) => {
  const role = req.query.role;
  if (!boxes[role]) return res.status(400).json({ error: 'Nieznana rola.' });
  seen[role] = Date.now();
  const out = fresh(role).map((m) => m.msg);
  boxes[role] = [];
  const other = role === 'pc' ? 'phone' : 'pc';
  res.json({ messages: out, peerOnline: Date.now() - seen[other] < 6000 });
});

export default router;
