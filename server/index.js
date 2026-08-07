import 'dotenv/config';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import * as jarvis from './jarvis.js';
import * as tts from './tts.js';
import * as memory from './memory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', ttsConfigured: tts.isConfigured() });
});

app.get('/api/memory', (req, res) => {
  res.json({ facts: memory.getFacts() });
});

app.delete('/api/memory/:index', (req, res) => {
  const data = memory.removeFact(Number(req.params.index));
  res.json({ facts: data.facts });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Brak wiadomosci.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
    }
    const reply = await jarvis.chat(String(message));
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Wystapil blad po stronie serwera.' });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Brak tekstu.' });
    if (!tts.isConfigured()) {
      return res.status(204).end();
    }
    const audio = await tts.synthesize(text);
    res.set('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: 'Blad syntezy mowy.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`J.A.R.V.I.S. online at http://localhost:${PORT}`);
});
