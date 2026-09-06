// Integracja z Telegram Bot API - czyste REST (fetch), bez zaleznosci SDK.
// #115 z listy "komunikacja".
//
// Webhook Telegrama (POST /webhook) woLa BEZPOSREDNIO serwer Telegrama, nie
// wlasciciel w przegladarce - nie moze wiec przejsc przez requireOwner
// (ktory sprawdza token sesji wlasciciela z /api/login). Zabezpieczeniem
// jest sekret ustawiany recznie przy rejestracji webhooka (parametr
// secret_token w wywolaniu setWebhook), ktory Telegram odsyla w naglowku
// X-Telegram-Bot-Api-Secret-Token przy kazdym wywolaniu - ten sam ksztalt
// zabezpieczenia "sekret zamiast sesji wlasciciela" co juz istniejacy
// CRON_SECRET dla /api/cron/tick (patrz server/index.js), tylko przez
// naglowek zamiast query. Sama wysylka (POST /send) i podglad odebranych
// wiadomosci (GET /messages) zostaja pod requireOwner - to juz prywatna
// korespondencja.

import express from 'express';
import { requireOwner } from './auth.js';
import * as bus from './bus.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';

const router = express.Router();

// Ostatnio odebrane wiadomosci - prosty bufor w pamieci procesu (ten sam
// wzor co np. cameraStatuses w server/cameras.js), nie trwala pamiec: to
// tylko "co przyszlo od ostatniego restartu", do wgladu/odczytania.
const MAX_INCOMING = 100;
const incoming = [];

export function isConfigured() {
  return Boolean(BOT_TOKEN);
}

async function callTelegram(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.description || `HTTP ${res.status}`);
  return data.result;
}

/** Realna wysylka - wywolywana WYLACZNIE z endpointu POST /send ponizej (wymaga confirm:true). */
export async function sendMessage(chatId, text) {
  if (!isConfigured()) throw new Error('Telegram nie jest skonfigurowany (brak TELEGRAM_BOT_TOKEN).');
  return callTelegram('sendMessage', { chat_id: chatId, text });
}

router.get('/status', requireOwner, (req, res) => {
  res.json({ configured: isConfigured() });
});

// Webhook Telegrama - patrz uzasadnienie braku requireOwner w komentarzu na gorze pliku.
router.post('/webhook', (req, res) => {
  if (WEBHOOK_SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== WEBHOOK_SECRET) return res.status(403).json({ error: 'Zly sekret webhooka.' });
  }
  const msg = req.body?.message;
  if (msg && (msg.text || msg.caption)) {
    const entry = {
      id: String(msg.message_id),
      chatId: msg.chat?.id ?? null,
      from: msg.from?.username || msg.from?.first_name || 'nieznany',
      text: msg.text || msg.caption || '',
      at: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(),
    };
    incoming.push(entry);
    if (incoming.length > MAX_INCOMING) incoming.splice(0, incoming.length - MAX_INCOMING);
    bus.publish('telegram', 'message.received', `Telegram od ${entry.from}: ${entry.text.slice(0, 120)}`, { level: 'info' });
  }
  // Telegram oczekuje szybkiego 200 OK, inaczej ponawia dostarczenie tego samego update'u.
  res.json({ ok: true });
});

router.get('/messages', requireOwner, (req, res) => {
  const limit = Math.max(1, Math.min(MAX_INCOMING, Number(req.query.limit) || 20));
  res.json({ messages: incoming.slice(-limit) });
});

// Wysylka - jak SMS (#112), wymaga jawnego confirm:true.
router.post('/send', requireOwner, async (req, res) => {
  const { chatId, text, confirm } = req.body || {};
  if (confirm !== true) {
    return res.status(400).json({ error: 'Wymagane jawne potwierdzenie: confirm:true. To realna wysylka na Telegramie.' });
  }
  if (!chatId || !String(text || '').trim()) {
    return res.status(400).json({ error: 'Wymagane pola: chatId, text.' });
  }
  try {
    const sent = await sendMessage(chatId, String(text));
    res.json({ ok: true, messageId: sent.message_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
