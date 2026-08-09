import 'dotenv/config';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import * as jarvis from './jarvis.js';
import * as tts from './tts.js';
import * as memory from './memory.js';
import * as push from './push.js';
import * as image from './image.js';
import { attachVoiceRelay } from './voiceLive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', ttsConfigured: tts.isConfigured(), pushConfigured: push.isConfigured() });
});

// --- Chat (streaming) ---
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Brak wiadomosci.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    await jarvis.chatStream(String(message), (chunk) => {
      res.write(chunk);
    });
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Wystapil blad po stronie serwera.' });
    } else {
      res.end('\n[Blad: polaczenie z AI zostalo przerwane]');
    }
  }
});

app.get('/api/greeting', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    await jarvis.greetStream((chunk) => res.write(chunk));
    res.end();
  } catch (err) {
    console.error('Greeting error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Wystapil blad po stronie serwera.' });
    else res.end();
  }
});

// --- Memory (facts) ---
app.get('/api/memory', (req, res) => {
  res.json({ facts: memory.getFacts() });
});

app.delete('/api/memory/:index', (req, res) => {
  const data = memory.removeFact(Number(req.params.index));
  res.json({ facts: data.facts });
});

// --- Todos ---
app.get('/api/todos', (req, res) => {
  res.json({ todos: memory.getTodos() });
});

app.post('/api/todos', (req, res) => {
  const todos = memory.addTodo(req.body.text);
  res.json({ todos });
});

app.patch('/api/todos/:id', (req, res) => {
  const todos = memory.setTodoDone(req.params.id, req.body.done);
  res.json({ todos });
});

app.delete('/api/todos/:id', (req, res) => {
  const todos = memory.removeTodo(req.params.id);
  res.json({ todos });
});

// --- Reminders ---
app.get('/api/reminders', (req, res) => {
  res.json({ reminders: memory.getReminders() });
});

app.post('/api/reminders', (req, res) => {
  const { text, dueAt } = req.body;
  if (!text || !dueAt) return res.status(400).json({ error: 'Brak tresci lub daty.' });
  const reminders = memory.addReminder(text, dueAt);
  res.json({ reminders });
});

app.delete('/api/reminders/:id', (req, res) => {
  const reminders = memory.removeReminder(req.params.id);
  res.json({ reminders });
});

// --- Push notifications ---
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.getPublicKey() });
});

app.post('/api/push/subscribe', (req, res) => {
  memory.addPushSubscription(req.body);
  res.status(201).json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  memory.removePushSubscription(req.body.endpoint);
  res.json({ ok: true });
});

// --- Cron (keep-alive + due reminders), called externally every ~10 min ---
app.get('/api/cron/tick', async (req, res) => {
  if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Nieprawidlowy sekret.' });
  }
  const due = memory.getDueUnsentReminders();
  for (const reminder of due) {
    await push.sendToAll({ title: 'J.A.R.V.I.S. przypomina', body: reminder.text });
    memory.markReminderSent(reminder.id);
  }
  res.json({ ok: true, sent: due.length });
});

// --- Image generation ---
app.post('/api/image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Brak opisu obrazu.' });
    const buffer = await image.generateImage(String(prompt));
    const id = image.storeImage(buffer);
    res.status(201).json({ id, url: `/api/image/${id}` });
  } catch (err) {
    console.error('Image generation error:', err);
    res.status(500).json({ error: 'Nie udalo sie wygenerowac obrazu.' });
  }
});

app.get('/api/image/:id', (req, res) => {
  const entry = image.getImage(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Obraz nie znaleziony (mogl wygasnac).' });
  res.set('Content-Type', entry.mimeType);
  res.set('Cache-Control', 'public, max-age=1800');
  res.send(entry.buffer);
});

// --- Vision (analiza obrazu z kamery) ---
app.post('/api/vision', async (req, res) => {
  const { image: imageDataUrl, mimeType, question } = req.body;
  if (!imageDataUrl) return res.status(400).json({ error: 'Brak obrazu.' });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
  }

  const base64Data = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    await jarvis.visionStream(base64Data, mimeType || 'image/jpeg', question, (chunk) => res.write(chunk));
    res.end();
  } catch (err) {
    console.error('Vision error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Wystapil blad po stronie serwera.' });
    else res.end();
  }
});

// --- TTS ---
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Brak tekstu.' });
    const { buffer, contentType } = await tts.synthesize(text);
    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: 'Blad syntezy mowy.' });
  }
});

const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws/voice' });
wss.on('connection', (ws) => {
  attachVoiceRelay(ws).catch((err) => {
    console.error('Voice relay error:', err);
    ws.close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`J.A.R.V.I.S. online at http://localhost:${PORT}`);
});
