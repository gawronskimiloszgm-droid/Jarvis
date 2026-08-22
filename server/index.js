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
import * as cad from './cad.js';
import * as bus from './bus.js';
import { attachHud } from './hud.js';
import { handleFrame as handleCameraFrame, handleHeartbeat as handleCameraHeartbeat, cameraStatuses } from './cameras.js';
import { ingest as ingestTelemetry, snapshot as telemetrySnapshot } from './telemetry.js';
import { scanReceipt } from '../modules/receipts/scan.js';
import {
  listTopics as listSentinelTopics,
  addTopic as addSentinelTopic,
  removeTopic as removeSentinelTopic,
  setPaused as setSentinelPaused,
  getFindings as getSentinelFindings,
  sweep as sweepSentinelNow,
} from './sentinel.js';
import { attachVoiceRelay, LIVE_CLONED_VOICE_REQUESTED } from './voiceLive.js';
import { isAuthConfigured, verifyPassword, verifyUser, ownerUserName, issueToken, isOwnerToken, roleFromRequest, requireOwner } from './auth.js';
import { startUpkeep } from './upkeep.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    ttsConfigured: tts.isConfigured(),
    pushConfigured: push.isConfigured(),
    authConfigured: isAuthConfigured(),
    ownerUser: ownerUserName(),
    role: roleFromRequest(req),
    cloneVoiceConfigured: tts.cloneStatus().enabled,
    liveClonedVoiceDefault: LIVE_CLONED_VOICE_REQUESTED,
  });
});

// --- Logowanie wlasciciela ---
app.post('/api/login', (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(500).json({ error: 'Brak skonfigurowanego OWNER_PASSWORD na serwerze.' });
  }
  // Uzytkownik i haslo sprawdzamy razem i odpowiadamy JEDNYM komunikatem -
  // rozne bledy dla zlej nazwy i zlego hasla podpowiadalyby, ktora czesc
  // zgadla osoba postronna.
  if (!verifyUser(req.body?.user) || !verifyPassword(req.body?.password)) {
    // Nieudane logowanie to sygnal dla modulu obrony, nie tylko wpis w logu.
    bus.publish('auth', 'login.failed', `nieudane logowanie z ${req.ip}`, {
      level: 'warn',
      data: { ip: req.ip },
    });
    return res.status(401).json({ error: 'Nieprawidlowy uzytkownik lub haslo.' });
  }
  bus.publish('auth', 'owner.login', 'wlasciciel zalogowany', { level: 'ok' });
  res.json({ token: issueToken(), role: 'owner' });
});

// --- Chat (streaming) ---
app.post('/api/chat', async (req, res) => {
  const { message, location } = req.body;
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Brak wiadomosci.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const coords =
    location && Number.isFinite(location.lat) && Number.isFinite(location.lon)
      ? { lat: location.lat, lon: location.lon }
      : null;

  const isOwner = roleFromRequest(req) === 'owner';

  try {
    await jarvis.chatStream(String(message), (chunk) => {
      res.write(chunk);
    }, coords, isOwner);
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

// --- Memory (facts) --- tylko wlasciciel
app.get('/api/memory', requireOwner, (req, res) => {
  res.json({ facts: memory.getFacts() });
});

app.delete('/api/memory/:index', requireOwner, (req, res) => {
  const data = memory.removeFact(Number(req.params.index));
  res.json({ facts: data.facts });
});

// --- Todos --- tylko wlasciciel
app.get('/api/todos', requireOwner, (req, res) => {
  res.json({ todos: memory.getTodos() });
});

app.post('/api/todos', requireOwner, (req, res) => {
  const todos = memory.addTodo(req.body.text);
  res.json({ todos });
});

app.patch('/api/todos/:id', requireOwner, (req, res) => {
  const todos = memory.setTodoDone(req.params.id, req.body.done);
  res.json({ todos });
});

app.delete('/api/todos/:id', requireOwner, (req, res) => {
  const todos = memory.removeTodo(req.params.id);
  res.json({ todos });
});

// --- Reminders --- tylko wlasciciel
app.get('/api/reminders', requireOwner, (req, res) => {
  res.json({ reminders: memory.getReminders() });
});

app.post('/api/reminders', requireOwner, (req, res) => {
  const { text, dueAt } = req.body;
  if (!text || !dueAt) return res.status(400).json({ error: 'Brak tresci lub daty.' });
  const reminders = memory.addReminder(text, dueAt);
  res.json({ reminders });
});

app.delete('/api/reminders/:id', requireOwner, (req, res) => {
  const reminders = memory.removeReminder(req.params.id);
  res.json({ reminders });
});

// --- Wydatki --- tylko wlasciciel
app.get('/api/expenses', requireOwner, (req, res) => {
  const days = Number(req.query.days) || 30;
  res.json({ expenses: memory.getExpenses(), summary: memory.summarizeExpenses(days) });
});

app.post('/api/expenses', requireOwner, (req, res) => {
  const { amount, category, note } = req.body;
  const entry = memory.addExpense(amount, category, note);
  if (!entry) return res.status(400).json({ error: 'Nieprawidlowa kwota.' });
  res.json({ expenses: memory.getExpenses(), summary: memory.summarizeExpenses(30) });
});

app.delete('/api/expenses/:id', requireOwner, (req, res) => {
  memory.removeExpense(req.params.id);
  res.json({ expenses: memory.getExpenses(), summary: memory.summarizeExpenses(30) });
});

// Odczyt paragonu - zwraca TYLKO odczytane dane, nic nie zapisuje. Zapis
// idzie osobnym, juz istniejacym POST /api/expenses, dopiero po
// potwierdzeniu przez uzytkownika - patrz uzasadnienie w scan.js.
app.post('/api/expenses/scan', requireOwner, async (req, res) => {
  const { image: imageDataUrl, mimeType } = req.body || {};
  if (!imageDataUrl) return res.status(400).json({ error: 'Brak zdjecia.' });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
  }
  try {
    const base64Data = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Puste zdjecie.' });
    const result = await scanReceipt(buffer, mimeType || 'image/jpeg');
    res.json(result);
  } catch (err) {
    console.error('Receipt scan error:', err);
    res.status(500).json({ error: 'Nie udalo sie odczytac paragonu.' });
  }
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

// --- Projektowanie 3D --- tylko wlasciciel
app.post('/api/cad', requireOwner, (req, res) => {
  try {
    const model = cad.create(req.body || {});
    bus.publish('cad', 'model.ready', `model gotowy: ${model.sizeMm.join(' x ')} mm, zapas ${model.strength.safety}x`, {
      level: model.strength.ok ? 'ok' : 'warn',
      data: { id: model.id, params: model.params, strength: model.strength },
    });
    res.status(201).json(model);
  } catch (err) {
    console.error('CAD error:', err);
    res.status(500).json({ error: 'Nie udalo sie wygenerowac modelu.' });
  }
});

app.get('/api/cad/:id', requireOwner, (req, res) => {
  const result = cad.get(req.params.id);
  if (!result) return res.status(404).json({ error: 'Model nie znaleziony (mogl wygasnac).' });
  res.json({ id: req.params.id, ...result });
});

// Plik do slicera. Pobranie jako zalacznik, zeby przegladarka nie
// probowala go wyswietlic jako tekst.
app.get('/api/cad/:id/stl', requireOwner, (req, res) => {
  const buf = cad.stl(req.params.id, req.query.ascii === '1');
  if (!buf) return res.status(404).json({ error: 'Model nie znaleziony (mogl wygasnac).' });
  res.set('Content-Type', 'model/stl');
  res.set('Content-Disposition', `attachment; filename="jarvis-${req.params.id}.stl"`);
  res.send(buf);
});

// --- Vision (analiza obrazu z kamery) --- tylko wlasciciel
app.post('/api/vision', requireOwner, async (req, res) => {
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

// --- Kamery obwodowe (klatki od lokalnego agenta na laptopie) --- tylko wlasciciel
app.post('/api/cameras/frame', requireOwner, async (req, res) => {
  const { camera, image: imageDataUrl } = req.body || {};
  if (!imageDataUrl) return res.status(400).json({ error: 'Brak obrazu.' });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
  }
  try {
    const base64Data = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Pusty obraz.' });
    const result = await handleCameraFrame({ camera, buffer });
    res.json(result);
  } catch (err) {
    console.error('Camera frame error:', err);
    res.status(500).json({ error: 'Nie udalo sie przeanalizowac klatki.' });
  }
});

app.post('/api/cameras/heartbeat', requireOwner, (req, res) => {
  res.json(handleCameraHeartbeat({ camera: req.body?.camera }));
});

app.get('/api/cameras', requireOwner, (req, res) => {
  res.json({ cameras: cameraStatuses() });
});

// --- Telemetria maszyny domowej --- tylko wlasciciel
app.post('/api/telemetry', requireOwner, (req, res) => {
  try {
    res.json({ ok: true, reading: ingestTelemetry(req.body || {}) });
  } catch (err) {
    console.error('Telemetry error:', err);
    res.status(500).json({ error: 'Nie udalo sie przyjac odczytu.' });
  }
});

app.get('/api/telemetry', requireOwner, (req, res) => {
  res.json({ machines: telemetrySnapshot() });
});

// --- Wartownik tematow --- tylko wlasciciel
app.get('/api/sentinel', requireOwner, (req, res) => {
  res.json({ topics: listSentinelTopics() });
});

app.post('/api/sentinel', requireOwner, (req, res) => {
  const topic = addSentinelTopic(req.body?.query);
  if (!topic) return res.status(400).json({ error: 'Brak tresci tematu.' });
  res.status(201).json({ topics: listSentinelTopics() });
});

app.delete('/api/sentinel/:id', requireOwner, (req, res) => {
  res.json({ topics: removeSentinelTopic(req.params.id) });
});

app.patch('/api/sentinel/:id', requireOwner, (req, res) => {
  const topic = setSentinelPaused(req.params.id, Boolean(req.body?.paused));
  if (!topic) return res.status(404).json({ error: 'Temat nie znaleziony.' });
  res.json({ topics: listSentinelTopics() });
});

app.get('/api/sentinel/:id/findings', requireOwner, (req, res) => {
  const findings = getSentinelFindings(req.params.id);
  if (!findings) return res.status(404).json({ error: 'Temat nie znaleziony.' });
  res.json({ findings });
});

// Wymuszenie sprawdzenia od reki - normalnie wartownik czeka na cykl
// utrzymaniowy (co PING_MS), ale po dodaniu tematu chce sie zobaczyc, ze
// dziala, a nie czekac do 10 minuty.
app.post('/api/sentinel/sweep', requireOwner, async (req, res) => {
  try {
    res.json(await sweepSentinelNow({ force: Boolean(req.body?.force) }));
  } catch (err) {
    console.error('Sentinel sweep error:', err);
    res.status(500).json({ error: 'Wartownik napotkal blad.' });
  }
});

// --- Magistrala zdarzen (podglad przez REST, gdy WebSocket jest zablokowany) ---
app.get('/api/events', requireOwner, (req, res) => {
  res.json({ posture: bus.getPosture(), events: bus.recent(Number(req.query.limit) || 60) });
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

// Dwa kanaly na jednym serwerze HTTP: glos i telemetria. Kazdy WebSocketServer
// musi byc w trybie noServer i dostawac polaczenie z jednego, wspolnego
// obslugiwacza 'upgrade' - dwa serwery pieté wprost do 'server' odrzucalyby
// sobie nawzajem polaczenia bledem 400.
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const coords = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  const isOwner = isOwnerToken(url.searchParams.get('token'));
  // Preferencja klienta (przelacznik w Ustawieniach) nadpisuje domyslna
  // wartosc z .env NA TA JEDNA sesje - nikt nie musi restartowac serwera,
  // zeby wypróbowac klonowany glos. 'wantClone=0' wylacza go jawnie nawet
  // gdy JARVIS_LIVE_CLONED_VOICE=true w konfiguracji; brak parametru
  // zostawia domyslne zachowanie z env (patrz voiceLive.js).
  const wantCloneParam = url.searchParams.get('wantClone');
  const wantClone = wantCloneParam == null ? null : wantCloneParam === '1';
  attachVoiceRelay(ws, coords, isOwner, wantClone).catch((err) => {
    console.error('Voice relay error:', err);
    ws.close();
  });
});

// Telemetria do HUD. Osobna sciezka, zeby strumien glosu i strumien zdarzen
// nie walczyly o to samo polaczenie - HUD ma dzialac takze bez mikrofonu.
const hudWss = new WebSocketServer({ noServer: true });
hudWss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  if (!isOwnerToken(url.searchParams.get('token'))) {
    ws.close(4003, 'Kanal telemetryczny tylko dla wlasciciela.');
    return;
  }
  attachHud(ws);
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const target = pathname === '/ws/voice' ? wss : pathname === '/ws/hud' ? hudWss : null;
  if (!target) {
    socket.write(`HTTP/1.1 404 Not Found\r\n\r\n`);
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

const PORT = process.env.PORT || 3000;

// Pamiec musi byc wczytana ZANIM przyjmiemy pierwsze zapytanie - inaczej
// pusty cache moglby zostac zapisany na zdalny magazyn i skasowac historie.
await memory.hydrate();

server.listen(PORT, () => {
  console.log(`J.A.R.V.I.S. online at http://localhost:${PORT}`);
  startUpkeep();
  bus.publish('core', 'system.online', `rdzen online na porcie ${PORT}`, { level: 'ok' });
});

// Render wysyla SIGTERM przy restarcie/wdrozeniu - dopisujemy to, co jeszcze
// czeka w buforze zapisu, zamiast zgubic ostatnie zmiany.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    try {
      await memory.flush();
    } catch {
      /* i tak konczymy */
    }
    process.exit(0);
  });
}
