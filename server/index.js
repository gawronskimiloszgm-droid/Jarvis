import 'dotenv/config';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import * as jarvis from './core/jarvis.js';
import * as tts from './voice/tts.js';
import * as memory from './memory/memory.js';
import * as push from './connect/push.js';
import * as image from './vision/image.js';
import * as cad from './home/cad.js';
import * as bus from './core/bus.js';
import { attachHud } from './core/hud.js';
import devicesRouter from './home/devices.js';
import agentCoreRouter from './core/agentCore.js';
import proactiveRouter from './home/proactive.js';

// --- pamiec i kontekst ---
import { episodicMemoryRouter } from './memory/episodicMemory.js';
import { factsRouter } from './memory/factLifecycle.js';
import { knowledgeGraphRouter } from './memory/knowledgeGraph.js';
import { memoryExportRouter } from './memory/memoryExport.js';
import { memorySearchRouter } from './memory/memorySearch.js';
import { memoryVersionsRouter } from './memory/memoryVersions.js';
import { relationsRouter } from './memory/relations.js';

// --- glos i rozmowa ---
import bargeInRouter from './voice/bargeIn.js';
import conversationStatsRouter from './voice/conversationStats.js';
import languageDetectRouter from './voice/languageDetect.js';
import liveTranscriptRouter from './voice/liveTranscript.js';
import moodDetectRouter from './voice/moodDetect.js';
import nightModeRouter from './voice/nightMode.js';
import routineMacrosRouter from './voice/routineMacros.js';
import sessionLogRouter from './memory/sessionLog.js';
import voiceHistoryRouter from './voice/voiceHistory.js';
import wakeWordsRouter from './voice/wakeWords.js';

// --- dom / IoT ---
import iotRouter from '../modules/iot/index.js';

// --- kalendarz i produktywnosc ---
import { router as productivityRouter } from './connect/productivity.js';
import { router as outlookRouter } from './connect/outlookCalendar.js';

// --- zdrowie i dobrostan ---
import { router as healthRouter } from './connect/health.js';
import { router as googleFitRouter } from './connect/googleFit.js';
import { router as mealVisionRouter } from './vision/mealVision.js';

// --- finanse ---
import financeRouter from './connect/finance.js';

// --- bezpieczenstwo / sentinel / perimeter ---
import priceWatchRoutes from './routes/priceWatch.js';
import breachCheckRoutes from './routes/breachCheck.js';
import reputationWatchRoutes from './routes/reputationWatch.js';
import threatNotifyRoutes from './routes/threatNotify.js';
import knownFacesRoutes from './routes/knownFaces.js';
import audioAlertRoutes from './routes/audioAlert.js';
import rtspCameraRoutes from './routes/rtspCamera.js';
import securityLogRoutes from './routes/securityLog.js';
import vacationModeRoutes from './routes/vacationMode.js';
import loginWatchRoutes from './routes/loginWatch.js';
import { recordLogin } from '../modules/security/loginWatch.js';

// --- wizja / kamera ---
import vision2Router from './vision/vision2.js';
import pantryRouter from './connect/pantry.js';
import plantCareRouter from './connect/plantCare.js';
import outfitCheckRouter from './vision/outfitCheck.js';
import productIdRouter from './vision/productId.js';
import docSummaryRouter from './vision/docSummary.js';
import roomRepaintRouter from './vision/roomRepaint.js';

// --- CAD / druk 3D ---
import cadExtraRouter from '../modules/cad-extra/index.js';

// --- komunikacja ---
import commsRouter from './connect/comms.js';

// --- podroze i transport ---
import travelRouter from './travel/index.js';

// --- wiedza / research ---
import knowledgeBaseRouter from './memory/knowledgeBase.js';
import researchRouter from './connect/research.js';

// --- sterowanie / rozrywka / meta ---
import desktopAppsRouter from './connect/desktopApps.js';
import entertainmentRouter from './connect/entertainment.js';
import gamesRouter from './connect/games.js';
import metaRouter from './core/meta.js';
import { handleFrame as handleCameraFrame, handleHeartbeat as handleCameraHeartbeat, cameraStatuses } from './vision/cameras.js';
import { ingest as ingestTelemetry, snapshot as telemetrySnapshot } from './home/telemetry.js';
import { maybeSendBriefing } from './core/briefing.js';
import * as printer from './home/printer.js';
import * as calendar from './connect/calendar.js';
import { scanReceipt } from '../modules/receipts/scan.js';
import {
  listTopics as listSentinelTopics,
  addTopic as addSentinelTopic,
  removeTopic as removeSentinelTopic,
  setPaused as setSentinelPaused,
  getFindings as getSentinelFindings,
  sweep as sweepSentinelNow,
} from './home/sentinel.js';
import { attachVoiceRelay, LIVE_CLONED_VOICE_REQUESTED } from './voice/voiceLive.js';
import { isAuthConfigured, verifyPassword, verifyUser, ownerUserName, issueToken, isOwnerToken, roleFromRequest, requireOwner } from './core/auth.js';
import { startUpkeep } from './core/upkeep.js';
import { startTravelSchedulers } from './travel/scheduler.js';
import edithRouter from './security/edith.js';
import { extraRouters, SERVER_VERSION, MIN_DESKTOP_VERSION } from './extras/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Jeden zgubiony blad w obietnicy (np. w trasie async albo w kolejce pushy) nie moze
// wywrocic calego serwera - na Renderze oznaczaloby to restart i utrate pamieci.
process.on('unhandledRejection', (err) => console.error('Nieobsluzone odrzucenie obietnicy:', err));
process.on('uncaughtException', (err) => console.error('Nieprzechwycony wyjatek:', err));

const app = express();
app.use(cors());
// Wczytywanie plikow i zrzutow ekranu (server/extras/documents.js) ma wlasny,
// wiekszy limit na poziomie trasy - globalny 8 MB odcialby je wczesniej.
const BIG_BODY_PATHS = new Set(['/api/docs', '/api/screen/analyze', '/api/agent/step', '/api/notes/audio', '/api/backup/restore', '/api/remote/result']);
const BIG_BODY = (req) => req.method === 'POST' && BIG_BODY_PATHS.has(req.path);
const smallJson = express.json({ limit: '8mb' });
app.use((req, res, next) => (BIG_BODY(req) ? next() : smallJson(req, res, next)));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(devicesRouter);
app.use(agentCoreRouter);
app.use(proactiveRouter);

// --- pamiec i kontekst (biblioteki wewnetrznych funkcji sciagniete z 13
// rownoleglych partii pracy - kazda montowana pod wlasnym, absolutnym albo
// prefiksowanym zestawem sciezek, zeby nic sie nie nadpisywalo) ---
app.use(episodicMemoryRouter);
app.use(factsRouter);
app.use(knowledgeGraphRouter);
app.use(memoryExportRouter);
app.use(memorySearchRouter);
app.use(memoryVersionsRouter);
app.use(relationsRouter);

// --- glos i rozmowa ---
app.use(bargeInRouter);
app.use(conversationStatsRouter);
app.use(languageDetectRouter);
app.use(liveTranscriptRouter);
app.use(moodDetectRouter);
app.use(nightModeRouter);
app.use(routineMacrosRouter);
app.use(sessionLogRouter);
app.use(voiceHistoryRouter);
app.use(wakeWordsRouter);

// --- dom / IoT (Home Assistant) ---
app.use('/api/iot', iotRouter);

// --- kalendarz i produktywnosc ---
app.use('/api/productivity', productivityRouter);
app.use('/api/outlook', outlookRouter);

// --- zdrowie i dobrostan ---
app.use('/api/health', healthRouter);
app.use('/api/googlefit', googleFitRouter);
app.use('/api/meals', mealVisionRouter);

// --- finanse ---
app.use('/api/finance', financeRouter);

// --- bezpieczenstwo / sentinel / perimeter ---
app.use('/api/price-watch', priceWatchRoutes);
app.use('/api/breach', breachCheckRoutes);
app.use('/api/reputation', reputationWatchRoutes);
app.use('/api/perimeter/threat', threatNotifyRoutes);
app.use('/api/known-faces', knownFacesRoutes);
app.use('/api/audio-alert', audioAlertRoutes);
app.use('/api/rtsp-cameras', rtspCameraRoutes);
app.use('/api/security-log', securityLogRoutes);
app.use('/api/vacation', vacationModeRoutes);
app.use('/api/login-watch', loginWatchRoutes);
app.use(edithRouter);
extraRouters.forEach((r) => app.use(r));

// --- wizja / kamera ---
app.use('/api/vision2', vision2Router);
app.use('/api/pantry', pantryRouter);
app.use('/api/plants', plantCareRouter);
app.use('/api/outfit', outfitCheckRouter);
app.use('/api/product', productIdRouter);
app.use('/api/documents', docSummaryRouter);
app.use('/api/room', roomRepaintRouter);

// --- CAD / druk 3D (rozszerzenia) --- router sam nie ma requireOwner (patrz
// jego wlasny komentarz), wiec doklejamy go tutaj, tak jak przy montowaniu.
app.use('/api/cad-extra', requireOwner, cadExtraRouter);

// --- komunikacja (mail/SMS/Telegram sa zamontowane WEWNATRZ commsRouter) ---
app.use('/api/comms', commsRouter);

// --- podroze i transport ---
app.use('/api/travel', travelRouter);

// --- wiedza / research ---
app.use('/api/knowledge', knowledgeBaseRouter);
app.use('/api/research', researchRouter);

// --- sterowanie / rozrywka / meta ---
app.use('/api/desktop', desktopAppsRouter);
app.use('/api/entertainment', entertainmentRouter);
app.use('/api/games', gamesRouter);
app.use('/api/meta', metaRouter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    version: SERVER_VERSION,
    minDesktopVersion: MIN_DESKTOP_VERSION,
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
  recordLogin(req);
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
  const briefing = await maybeSendBriefing().catch((err) => {
    console.error('Odprawa nieudana:', err.message);
    return { sent: false };
  });
  res.json({ ok: true, sent: due.length, briefing: briefing.sent ? briefing.kind : null });
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
// Cialo z "czesci" (tablica brył) to ogolne zlozenie, bez tego pola to
// stary, wciaz obslugiwany wspornik scienny z realna analiza wytrzymalosci.
app.post('/api/cad', requireOwner, (req, res) => {
  try {
    const body = req.body || {};
    const model = Array.isArray(body.czesci) ? cad.createAssembly(body) : cad.create(body);
    const s = model.strength;
    const msg = s
      ? `model gotowy: ${model.sizeMm.join(' x ')} mm, zapas ${s.safety}x`
      : `model gotowy: ${model.sizeMm.join(' x ')} mm, ${model.triangles} trojkatow`;
    bus.publish('cad', 'model.ready', msg, {
      level: s ? (s.ok ? 'ok' : 'warn') : 'ok',
      data: { id: model.id, params: model.params, strength: s || null },
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

// Wysylka gotowego modelu do drukarki (OctoPrint) - patrz printer.js.
// Nieaktywna jesli PRINTER_URL/PRINTER_API_KEY nie sa ustawione; zwraca
// wtedy jasny blad zamiast cichego "nic sie nie stalo".
app.post('/api/cad/:id/print', requireOwner, async (req, res) => {
  const buf = cad.stl(req.params.id);
  if (!buf) return res.status(404).json({ error: 'Model nie znaleziony (mogl wygasnac).' });
  try {
    await printer.uploadAndPrint(buf, `jarvis-${req.params.id}.stl`);
    bus.publish('cad', 'print.sent', `model ${req.params.id} wyslany do druku`, { level: 'ok' });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/printer/status', requireOwner, async (req, res) => {
  res.json({ configured: printer.isConfigured(), job: await printer.jobStatus() });
});

// --- Kalendarz Google --- tylko wlasciciel. Autoryzacja to jednorazowy
// reczny krok: wlasciciel wchodzi na /api/calendar/auth zalogowany, Google
// pyta o zgode we WLASNEJ przegladarce, a callback ponizej zapisuje token.
const oauthStates = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

app.get('/api/calendar/auth', requireOwner, (req, res) => {
  if (!calendar.isOAuthConfigured()) {
    return res.status(400).json({ error: 'Brak GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI w konfiguracji.' });
  }
  const state = globalThis.crypto.randomUUID();
  oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
  res.redirect(calendar.authUrl(state));
});

// Google przekierowuje tutaj BEZ naszych naglowkow autoryzacji (to zwykle
// przekierowanie przegladarki) - stad brak requireOwner. Bezpieczenstwo
// daje jednorazowy "state" wygenerowany tylko po tym, jak wlasciciel juz
// przeszedl requireOwner na /api/calendar/auth powyzej, plus fakt, ze sam
// "code" jest jednorazowy i zwiazany z naszym client_id/redirect_uri.
app.get('/api/calendar/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expiry = state && oauthStates.get(state);
  if (state) oauthStates.delete(state);
  if (error) return res.status(400).send(`Kalendarz: Google zwrocil blad (${error}).`);
  if (!expiry || Date.now() > expiry) return res.status(400).send('Kalendarz: nieprawidlowy albo wygasly stan autoryzacji, sprobuj ponownie.');
  if (!code) return res.status(400).send('Kalendarz: brak kodu autoryzacji.');
  try {
    await calendar.exchangeCode(code);
    res.send('Kalendarz polaczony. Mozesz zamknac te karte i wrocic do Jarvisa.');
  } catch (err) {
    res.status(502).send(`Kalendarz: nie udalo sie dokonczyc polaczenia (${err.message}).`);
  }
});

app.get('/api/calendar/status', requireOwner, (req, res) => {
  res.json({ configured: calendar.isOAuthConfigured(), connected: calendar.isConnected() });
});

app.get('/api/calendar/events', requireOwner, async (req, res) => {
  try {
    res.json(await calendar.listUpcoming(Number(req.query.limit) || 10));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/calendar/events', requireOwner, async (req, res) => {
  try {
    const { title, startISO, endISO, description } = req.body || {};
    res.status(201).json(await calendar.createEvent({ title, startISO, endISO, description }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- Tryby (rutyny) --- tylko wlasciciel. Tworzy sie je tylko glosem
// (function calling), ale uruchamiac mozna tez z czatu pisanego - stad
// GET po nazwie, ktorego uzywa klient po zobaczeniu znacznika [TRYB: ...]
// w streamowanej odpowiedzi (patrz TRYB_RE w app.js).
app.get('/api/routines', requireOwner, (req, res) => {
  res.json(memory.getRoutines());
});

app.get('/api/routines/:name', requireOwner, (req, res) => {
  const routine = memory.getRoutine(req.params.name);
  if (!routine) return res.status(404).json({ error: 'Nie znam trybu o tej nazwie.' });
  res.json(routine);
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
    const { text, speaker } = req.body;
    if (!text) return res.status(400).json({ error: 'Brak tekstu.' });
    const { buffer, contentType } = await tts.synthesize(text, { speaker });
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
  attachVoiceRelay(ws, coords, isOwner, wantClone, url.searchParams.get('persona')).catch((err) => {
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
  startTravelSchedulers();
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
