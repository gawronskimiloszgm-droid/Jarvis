// Rdzen agentowosci: PRAWDZIWE wieloetapowe wolanie narzedzi (function
// calling Gemini), obok - nie zamiast - istniejacego czatu ze znacznikami
// [TAG: ...] w jarvis.js. Ten drugi mechanizm zostaje nietkniety: dziala
// dobrze przy strumieniowaniu (patrz uzasadnienie w jarvis.js) i przerobienie
// go na petle function-calling zepsuloby streaming bez zadnego zysku dla
// prostych próśb typu "zapamietaj X" czy "dodaj zadanie".
//
// Ten modul jest do INNEJ klasy pytan: takich, gdzie Jarvis musi sam
// zdecydowac KTOREJ i ILU informacji potrzebuje, zebrac je (kalendarz,
// pogoda, sieć, pamiec) i dopiero na tej podstawie cos ustalic - czyli
// prawdziwe rozumowanie krok po kroku, nie jedna odpowiedz z gotowego
// kontekstu.
//
// Druga czesc pliku to kolejka zadan dlugotrwalych: "zrob X i zglos sie
// pozniej", z priorytetem, anulowaniem i dziennikiem decyzji - do uzycia
// przez /api/agent/tasks, niezaleznie od petli powyzej.

import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import express from 'express';
import * as memory from './memory.js';
import { requireOwner } from './auth.js';
import { withModel } from './geminiChain.js';
import { getWeather, getWeatherByCoords } from './weather.js';
import { searchWeb } from './websearch.js';
import * as calendar from './calendar.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MAX_TURNS = 10;

const TOOLS = [
  {
    name: 'sprawdz_pogode',
    description: 'Aktualna pogoda dla miasta.',
    parameters: { type: 'object', properties: { miasto: { type: 'string' } }, required: ['miasto'] },
  },
  {
    name: 'pokaz_kalendarz',
    description: 'Nadchodzace wydarzenia z kalendarza uzytkownika.',
    parameters: { type: 'object', properties: { ile: { type: 'number' } } },
  },
  {
    name: 'lista_zadan',
    description: 'Aktualna lista zadan (todo) uzytkownika.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'przypomnienia',
    description: 'Nadchodzace, jeszcze nie wyslane przypomnienia uzytkownika.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'fakty_o_uzytkowniku',
    description: 'To, co Jarvis juz wie o uzytkowniku z poprzednich rozmow.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'szukaj_w_sieci',
    description: 'Wyszukaj w internecie, gdy potrzebna jest aktualna informacja spoza pamieci Jarvisa.',
    parameters: { type: 'object', properties: { zapytanie: { type: 'string' } }, required: ['zapytanie'] },
  },
];

// Narzedzia, ktore COS ZMIENIAJA, wymagaja jawnego potwierdzenia zanim
// wykonaja sie naprawde - petla ponizej zatrzymuje sie i zwraca "pending"
// zamiast wywolac je od razu. Same odczyty (wszystko powyzej) nie wymagaja
// potwierdzenia - nic nie ryzykuja.
const IRREVERSIBLE_TOOLS = new Set(['dodaj_zadanie', 'dodaj_przypomnienie']);
const WRITE_TOOLS = [
  {
    name: 'dodaj_zadanie',
    description: 'Dodaj nowe zadanie do listy todo uzytkownika.',
    parameters: { type: 'object', properties: { tresc: { type: 'string' } }, required: ['tresc'] },
  },
  {
    name: 'dodaj_przypomnienie',
    description: 'Dodaj przypomnienie na konkretna date/godzine (ISO).',
    parameters: {
      type: 'object',
      properties: { tresc: { type: 'string' }, kiedy: { type: 'string' } },
      required: ['tresc', 'kiedy'],
    },
  },
];

function describeCall(call, result) {
  return `${call.name}(${JSON.stringify(call.args || {})}) -> ${JSON.stringify(result)}`;
}

async function executeTool(name, args, coords) {
  switch (name) {
    case 'sprawdz_pogode': {
      try {
        const w = args.miasto ? await getWeather(args.miasto) : coords ? await getWeatherByCoords(coords.lat, coords.lon) : null;
        return w ? { temperatura: w.temperature, warunki: w.condition, wilgotnosc: w.humidity, wiatr: w.windSpeed } : { error: 'nie znaleziono lokalizacji' };
      } catch {
        return { error: 'blad pobierania pogody' };
      }
    }
    case 'pokaz_kalendarz': {
      if (!calendar.isConnected()) return { error: 'kalendarz nie jest polaczony' };
      try {
        return { wydarzenia: await calendar.listUpcoming(Number(args.ile) || 5) };
      } catch (err) {
        return { error: err.message };
      }
    }
    case 'lista_zadan':
      return { zadania: memory.getTodos().filter((t) => !t.done).map((t) => t.text) };
    case 'przypomnienia':
      return { przypomnienia: memory.getReminders().filter((r) => !r.sent).map((r) => ({ tresc: r.text, kiedy: r.dueAt })) };
    case 'fakty_o_uzytkowniku':
      return { fakty: memory.getFacts() };
    case 'szukaj_w_sieci': {
      try {
        const results = await searchWeb(args.zapytanie, 5);
        return { wyniki: results.map((r) => ({ tytul: r.title, url: r.url, fragment: r.snippet })) };
      } catch (err) {
        return { error: err.message };
      }
    }
    case 'dodaj_zadanie':
      memory.addTodo(args.tresc);
      return { ok: true };
    case 'dodaj_przypomnienie':
      memory.addReminder(args.tresc, args.kiedy);
      return { ok: true };
    default:
      return { error: 'nieznane narzedzie' };
  }
}

// Uchwyty na petle wstrzymane w oczekiwaniu na potwierdzenie - tylko w
// pamieci procesu, celowo nietrwale: to stan JEDNEGO trwajacego zapytania,
// nie cos, co ma przetrwac restart serwera.
const pendingRuns = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function prunePending() {
  const now = Date.now();
  for (const [id, run] of pendingRuns) {
    if (now - run.at > PENDING_TTL_MS) pendingRuns.delete(id);
  }
}

const SYSTEM_INSTRUCTION =
  'Jestes Jarvisem. Masz dostep do narzedzi ponizej - uzyj TYLU ile potrzeba, zeby rzetelnie ' +
  'odpowiedziec na prosbe, laczac wyniki z kilku, jesli trzeba. Gdy masz juz dosc informacji, ' +
  'odpowiedz zwyklym tekstem, krotko i konkretnie, swoim zwyklym stylem (sucha ironia, brytyjska ' +
  'rezerwa, zwraca sie "sir").';

/**
 * Petla: pytaj model, wykonuj narzedzia ktore chce wywolac, dopoki nie
 * zwroci zwyklego tekstu (albo nie natrafi na narzedzie wymagajace
 * potwierdzenia, albo nie wyczerpie limitu tur).
 *
 * WAZNE: do historii NIGDY nie wraca surowa tresc modelu z czescia
 * "functionCall" - zmierzone na zywo, ze API odrzuca (400) taka ture przy
 * odeslaniu z powrotem z brakujacym "thought_signature", ktorego biezaca
 * wersja SDK/modelu w ogole nie dostarcza (ani przy zwyklym wywolaniu, ani
 * z thinkingConfig.includeThoughts). Zamiast tego kazda kolejna tura to
 * swiezy, zwykly tekst z WYNIKAMI narzedzi - model nie widzi doslownie
 * wlasnego wywolania, tylko jego rezultat, co w zupelnosci wystarcza do
 * dalszego rozumowania i omija ten blad API calkowicie.
 */
export async function runAgent(goal, { coords, allowWrites = true } = {}) {
  const tools = [{ functionDeclarations: allowWrites ? [...TOOLS, ...WRITE_TOOLS] : TOOLS }];
  const contents = [{ role: 'user', parts: [{ text: String(goal || '').trim() }] }];
  const log = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await withModel((model) =>
      ai.models.generateContent({ model, contents, config: { tools, systemInstruction: SYSTEM_INSTRUCTION } })
    );

    const calls = res.functionCalls || [];
    if (!calls.length) {
      return { done: true, text: (res.text || '').trim(), log };
    }

    const pendingCall = calls.find((c) => IRREVERSIBLE_TOOLS.has(c.name));
    if (pendingCall) {
      const runId = nanoid(10);
      pendingRuns.set(runId, { contents, calls, at: Date.now(), coords });
      prunePending();
      return {
        done: false,
        needsConfirmation: true,
        runId,
        pendingCall: { name: pendingCall.name, args: pendingCall.args },
        log,
      };
    }

    const lines = [];
    for (const call of calls) {
      const result = await executeTool(call.name, call.args || {}, coords);
      log.push({ narzedzie: call.name, argumenty: call.args, wynik: result, at: Date.now() });
      lines.push(describeCall(call, result));
    }
    contents.push({ role: 'user', parts: [{ text: `Wyniki narzedzi:\n${lines.join('\n')}\n\nNa podstawie tego odpowiedz uzytkownikowi (albo wywolaj kolejne narzedzie, jesli to nadal za malo).` }] });
  }

  return { done: true, text: 'Za duzo krokow, zeby to bezpiecznie dokonczyc - sprobuj doprecyzowac prosbe.', log };
}

export async function confirmAgent(runId) {
  prunePending();
  const run = pendingRuns.get(runId);
  if (!run) return { error: 'Nie ma juz takiego oczekujacego zadania (mogło wygasnac).' };
  pendingRuns.delete(runId);

  const log = [];
  const lines = [];
  for (const call of run.calls) {
    const result = await executeTool(call.name, call.args || {}, run.coords);
    log.push({ narzedzie: call.name, argumenty: call.args, wynik: result, at: Date.now() });
    lines.push(describeCall(call, result));
  }
  run.contents.push({ role: 'user', parts: [{ text: `Wyniki narzedzi:\n${lines.join('\n')}\n\nNa podstawie tego odpowiedz uzytkownikowi (albo wywolaj kolejne narzedzie, jesli to nadal za malo).` }] });

  const tools = [{ functionDeclarations: [...TOOLS, ...WRITE_TOOLS] }];

  // Po potwierdzeniu wracamy do zwyklej petli, zeby model mogl skonczyc
  // (albo zapytac o kolejne potwierdzenie, jesli chce zrobic wiecej niz jedno).
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await withModel((model) =>
      ai.models.generateContent({ model, contents: run.contents, config: { tools, systemInstruction: SYSTEM_INSTRUCTION } })
    );
    const calls = res.functionCalls || [];
    if (!calls.length) return { done: true, text: (res.text || '').trim(), log };

    const pendingCall = calls.find((c) => IRREVERSIBLE_TOOLS.has(c.name));
    if (pendingCall) {
      const newRunId = nanoid(10);
      pendingRuns.set(newRunId, { contents: run.contents, calls, at: Date.now(), coords: run.coords });
      return { done: false, needsConfirmation: true, runId: newRunId, pendingCall: { name: pendingCall.name, args: pendingCall.args }, log };
    }

    const stepLines = [];
    for (const call of calls) {
      const result = await executeTool(call.name, call.args || {}, run.coords);
      log.push({ narzedzie: call.name, argumenty: call.args, wynik: result, at: Date.now() });
      stepLines.push(describeCall(call, result));
    }
    run.contents.push({ role: 'user', parts: [{ text: `Wyniki narzedzi:\n${stepLines.join('\n')}\n\nNa podstawie tego odpowiedz uzytkownikowi (albo wywolaj kolejne narzedzie, jesli to nadal za malo).` }] });
  }
  return { done: true, text: 'Za duzo krokow, zeby to bezpiecznie dokonczyc.', log };
}

// --- Kolejka zadan dlugotrwalych ---
//
// Osobna od petli powyzej: to do zadan typu "zrob X, zglos sie jak
// skonczysz", ktore NIE musza trzymac polaczenia HTTP otwartego. Wykonawce
// (handler) rejestruje modul, ktory faktycznie wie jak wykonac dany typ
// zadania - agentCore sam nie wie nic o konkretnych domenach.

const handlers = new Map();
export function registerTaskHandler(type, fn) {
  handlers.set(type, fn);
}

function taskStore() {
  const data = memory.load();
  if (!Array.isArray(data.agentTasks)) data.agentTasks = [];
  return data;
}

export function enqueueTask({ type, description, priority = 0, payload = null }) {
  const data = taskStore();
  const task = {
    id: nanoid(10),
    type: String(type || 'generic'),
    description: String(description || '').slice(0, 500),
    priority: Number(priority) || 0,
    payload,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
  data.agentTasks.push(task);
  memory.save(data);
  processQueue();
  return task;
}

export function listTasks() {
  return taskStore().agentTasks.slice().sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}

export function cancelTask(id) {
  const data = taskStore();
  const task = data.agentTasks.find((t) => t.id === id);
  if (!task) return null;
  if (task.status === 'queued') {
    task.status = 'cancelled';
    task.finishedAt = Date.now();
  } else if (task.status === 'running' && task.__abort) {
    // Wspolpracujace anulowanie: wykonawca sam sprawdza task.__abort.aborted
    // w swoich dluzszych krokach - to najlepsze co da sie zrobic bez
    // wywlaszczajacego przerywania w jednowatkowym Node.
    task.__abort.abort();
    task.status = 'cancelling';
  }
  memory.save(data);
  return task;
}

let queueRunning = false;
async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const data = taskStore();
      const next = data.agentTasks
        .filter((t) => t.status === 'queued')
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)[0];
      if (!next) break;

      const handler = handlers.get(next.type);
      next.status = 'running';
      next.startedAt = Date.now();
      const abort = new AbortController();
      next.__abort = abort;
      memory.save(data);

      try {
        if (!handler) throw new Error(`brak zarejestrowanego wykonawcy dla typu "${next.type}"`);
        next.result = await handler(next.payload, { signal: abort.signal });
        next.status = 'done';
      } catch (err) {
        next.status = next.status === 'cancelling' ? 'cancelled' : 'error';
        next.error = err.message;
      }
      next.finishedAt = Date.now();
      delete next.__abort;
      memory.save(data);
    }
  } finally {
    queueRunning = false;
  }
}

export const router = express.Router();

router.post('/api/agent/run', requireOwner, async (req, res) => {
  const { goal, location } = req.body || {};
  if (!goal || !String(goal).trim()) return res.status(400).json({ error: 'Brak celu.' });
  const coords = location && Number.isFinite(location.lat) && Number.isFinite(location.lon) ? location : null;
  try {
    res.json(await runAgent(goal, { coords }));
  } catch (err) {
    console.error('Agent run error:', err);
    res.status(500).json({ error: 'Agent napotkal blad.' });
  }
});

router.post('/api/agent/confirm', requireOwner, async (req, res) => {
  const { runId } = req.body || {};
  if (!runId) return res.status(400).json({ error: 'Brak runId.' });
  try {
    res.json(await confirmAgent(runId));
  } catch (err) {
    console.error('Agent confirm error:', err);
    res.status(500).json({ error: 'Agent napotkal blad.' });
  }
});

router.get('/api/agent/tasks', requireOwner, (req, res) => {
  res.json({ tasks: listTasks() });
});

router.post('/api/agent/tasks', requireOwner, (req, res) => {
  const { type, description, priority, payload } = req.body || {};
  if (!description) return res.status(400).json({ error: 'Brak opisu zadania.' });
  res.status(201).json(enqueueTask({ type, description, priority, payload }));
});

router.post('/api/agent/tasks/:id/cancel', requireOwner, (req, res) => {
  const task = cancelTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Zadanie nie znalezione.' });
  res.json(task);
});

export default router;
