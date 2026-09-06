// Kalendarz i produktywnosc - zestaw funkcji budujacych sie NA gotowych
// klockach (server/calendar.js dla Google Calendar, server/memory.js dla
// todosow/przypomnien), zamiast duplikowac ich logike.
//
// Caly stan wlasny (timery, ostatnie sprawdzenie "co przegapilem", token
// eskalacji przypomnien) trzymamy pod jednym kluczem najwyzszego poziomu
// data.productivity w tej samej trwalej pamieci co reszta - bez dotykania
// memory.js, zgodnie z konwencja modulow takich jak sentinel.js.

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import * as memory from './memory.js';
import * as calendar from './calendar.js';
import * as bus from './bus.js';
import { requireOwner } from './auth.js';
import { withModel } from './geminiChain.js';
import { listTopics as listSentinelTopics, getFindings as getSentinelFindings } from './sentinel.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Wlasny namespace w pamieci (bez edycji memory.js) ---
function loadProd() {
  const data = memory.load();
  if (!data.productivity || typeof data.productivity !== 'object') {
    data.productivity = {
      timeTracking: { active: {}, entries: [] }, // #55
      lastCatchUpAt: null, // #60
      reminderEscalation: {}, // #57 - id -> ostatnio zameldowano (ms)
    };
  }
  if (!data.productivity.timeTracking) data.productivity.timeTracking = { active: {}, entries: [] };
  if (!data.productivity.reminderEscalation) data.productivity.reminderEscalation = {};
  return data;
}

// =====================================================================
// #51 - Automatyczne planowanie spotkan: wolne okna na podstawie listy
// zajetych wydarzen.
// =====================================================================

function toBusyIntervals(events) {
  return events
    .filter((e) => e.start && e.end)
    .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .sort((a, b) => a.start - b.start);
}

function pushSlotsInRange(slots, rangeStartMs, rangeEndMs, durationMs, maxSlots) {
  let t = rangeStartMs;
  while (t + durationMs <= rangeEndMs && slots.length < maxSlots) {
    slots.push({ startISO: new Date(t).toISOString(), endISO: new Date(t + durationMs).toISOString() });
    t += durationMs;
  }
}

/**
 * Szuka wolnych okien w zadanym zakresie dat, w godzinach roboczych,
 * pomijajac weekendy i kolidujace z podanymi wydarzeniami (zajetymi
 * przedzialami).
 * @param {{events:Array<{start:string,end:string}>, rangeStart:string, rangeEnd:string,
 *   durationMin?:number, workHourStart?:number, workHourEnd?:number, maxSlots?:number}} opts
 */
export function findFreeSlots({
  events = [],
  rangeStart,
  rangeEnd,
  durationMin = 30,
  workHourStart = 9,
  workHourEnd = 17,
  maxSlots = 10,
}) {
  const durationMs = Math.max(5, Number(durationMin) || 30) * 60 * 1000;
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error('Nieprawidlowy zakres dat.');
  }
  const busy = toBusyIntervals(events);
  const slots = [];

  const cursorDay = new Date(start);
  cursorDay.setHours(0, 0, 0, 0);

  while (cursorDay.getTime() < end.getTime() && slots.length < maxSlots) {
    const dow = cursorDay.getDay();
    if (dow !== 0 && dow !== 6) {
      const dayStart = new Date(cursorDay);
      dayStart.setHours(workHourStart, 0, 0, 0);
      const dayEnd = new Date(cursorDay);
      dayEnd.setHours(workHourEnd, 0, 0, 0);

      // Nie proponujemy okien w przeszlosci ani przed poczatkiem zakresu.
      let cursor = Math.max(dayStart.getTime(), start.getTime(), Date.now());
      const limit = Math.min(dayEnd.getTime(), end.getTime());

      const dayBusy = busy.filter((b) => b.end > dayStart.getTime() && b.start < dayEnd.getTime());
      for (const b of dayBusy) {
        if (slots.length >= maxSlots) break;
        if (b.start > cursor) pushSlotsInRange(slots, cursor, Math.min(b.start, limit), durationMs, maxSlots);
        cursor = Math.max(cursor, b.end);
      }
      if (slots.length < maxSlots && cursor < limit) pushSlotsInRange(slots, cursor, limit, durationMs, maxSlots);
    }
    cursorDay.setDate(cursorDay.getDate() + 1);
  }
  return slots;
}

async function fetchBusyEvents() {
  // listUpcoming rzuca czytelny blad, gdy kalendarz nie jest polaczony -
  // przepuszczamy go dalej, endpoint go zamieni na 400/502.
  return calendar.listUpcoming(25);
}

// =====================================================================
// #52 - Blok "deep work" proporcjonalny do liczby niedokonczonych zadan.
// =====================================================================

/** 15 minut na kazde niedokonczone zadanie, w widelkach 30-180 minut. */
export function computeDeepWorkMinutes() {
  const openCount = memory.getTodos().filter((t) => !t.done).length;
  const minutes = Math.min(180, Math.max(30, openCount * 15));
  return { openCount, minutes };
}

export async function scheduleDeepWorkBlock({ daysAhead = 3, workHourStart = 9, workHourEnd = 17 } = {}) {
  const { openCount, minutes } = computeDeepWorkMinutes();
  if (openCount === 0) {
    return { created: false, reason: 'Brak niedokonczonych zadan - blok deep work nie jest potrzebny.' };
  }
  const events = await fetchBusyEvents();
  const now = new Date();
  const rangeEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const [slot] = findFreeSlots({
    events,
    rangeStart: now.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    durationMin: minutes,
    workHourStart,
    workHourEnd,
    maxSlots: 1,
  });
  if (!slot) {
    return { created: false, reason: `Nie znaleziono wolnego okna ${minutes} min w najblizszych ${daysAhead} dniach.` };
  }
  const created = await calendar.createEvent({
    title: 'Deep work',
    startISO: slot.startISO,
    endISO: slot.endISO,
    description: `Blok wygenerowany automatycznie na podstawie ${openCount} niedokonczonych zadan.`,
  });
  bus.publish('productivity', 'deepwork.scheduled', `zaplanowano blok deep work: ${minutes} min`, {
    level: 'ok',
    data: { minutes, openCount, slot },
  });
  return { created: true, minutes, openCount, slot, event: created };
}

// =====================================================================
// #53 - Dwukierunkowa synchronizacja z Todoist (REST API v2).
// =====================================================================

const TODOIST_TOKEN = process.env.TODOIST_API_TOKEN || '';

export function isTodoistConfigured() {
  return Boolean(TODOIST_TOKEN);
}

async function todoistFetch(path, init = {}) {
  const res = await fetch(`https://api.todoist.com/rest/v2/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Todoist HTTP ${res.status}`);
  return data;
}

/**
 * Sync dwukierunkowy po TRESCI (bez ID mapowania): kazde zadanie z Todoist,
 * ktorego tekstu nie ma jeszcze lokalnie, trafia do memory.addTodo(); kazde
 * lokalne, aktywne zadanie, ktorego nie ma jeszcze w Todoist, jest tam
 * dopisywane. Brak env = grzeczna informacja, nie wyjatek.
 */
export async function syncTodoist() {
  if (!isTodoistConfigured()) {
    return { configured: false, message: 'Todoist nie jest skonfigurowany (brak TODOIST_API_TOKEN) - synchronizacja pominieta.' };
  }

  const remoteTasks = (await todoistFetch('tasks')) || [];
  const norm = (s) => String(s || '').trim().toLowerCase();

  const localTextsLower = new Set(memory.getTodos().map((t) => norm(t.text)));
  let pulled = 0;
  for (const task of remoteTasks) {
    const text = String(task.content || '').trim();
    if (!text || localTextsLower.has(norm(text))) continue;
    memory.addTodo(text);
    localTextsLower.add(norm(text));
    pulled++;
  }

  const remoteTextsLower = new Set(remoteTasks.map((t) => norm(t.content)));
  let pushed = 0;
  for (const todo of memory.getTodos()) {
    if (todo.done || remoteTextsLower.has(norm(todo.text))) continue;
    await todoistFetch('tasks', { method: 'POST', body: JSON.stringify({ content: todo.text }) });
    remoteTextsLower.add(norm(todo.text));
    pushed++;
  }

  bus.publish('productivity', 'todoist.sync', `Todoist: pobrano ${pulled}, wyslano ${pushed}`, { level: 'ok' });
  return { configured: true, pulled, pushed, remoteCount: remoteTasks.length, localCount: memory.getTodos().length };
}

// =====================================================================
// #54 - Rozbicie duzego zadania na podzadania (Gemini, responseSchema).
// =====================================================================

const SUBTASKS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    podzadania: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['podzadania'],
};

export async function breakdownTask(taskText) {
  const clean = String(taskText || '').trim();
  if (!clean) throw new Error('Brak tresci zadania do rozbicia.');
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Rozbij nastepujace duze zadanie na 3-8 konkretnych, wykonalnych podzadan, ` +
        `kazde jako krotkie zdanie po polsku: "${clean}"`,
      config: { responseMimeType: 'application/json', responseSchema: SUBTASKS_SCHEMA },
    })
  );
  const parsed = JSON.parse(res.text);
  const items = Array.isArray(parsed.podzadania)
    ? parsed.podzadania.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (!items.length) throw new Error('Model nie zwrocil zadnych podzadan.');
  for (const text of items) memory.addTodo(text);
  bus.publish('productivity', 'task.brokendown', `zadanie rozbite na ${items.length} podzadan: ${clean}`, { level: 'ok' });
  return items;
}

// =====================================================================
// #55 - Time tracking per todo (start/stop + podsumowanie).
// =====================================================================

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function startTimer(todoId) {
  const data = loadProd();
  const tt = data.productivity.timeTracking;
  if (tt.active[todoId]) return { started: false, reason: 'Timer dla tego zadania juz dziala.' };
  tt.active[todoId] = Date.now();
  memory.save(data);
  return { started: true, todoId, startedAt: tt.active[todoId] };
}

export function stopTimer(todoId) {
  const data = loadProd();
  const tt = data.productivity.timeTracking;
  const startedAt = tt.active[todoId];
  if (!startedAt) return { stopped: false, reason: 'Ten timer nie dziala.' };
  const endedAt = Date.now();
  const entry = { id: `${todoId}-${endedAt}`, todoId, startedAt, endedAt, durationMs: endedAt - startedAt, day: dayKey(startedAt) };
  tt.entries.push(entry);
  delete tt.active[todoId];
  memory.save(data);
  return { stopped: true, entry };
}

/** Podsumowanie czasu, opcjonalnie zawezone do jednego zadania i/lub dnia (YYYY-MM-DD). */
export function summarizeTime({ todoId, day } = {}) {
  const data = loadProd();
  const tt = data.productivity.timeTracking;
  const todosById = new Map(memory.getTodos().map((t) => [t.id, t.text]));
  const now = Date.now();

  let entries = tt.entries.slice();
  if (todoId) entries = entries.filter((e) => e.todoId === todoId);
  if (day) entries = entries.filter((e) => e.day === day);

  const byTodo = {};
  for (const e of entries) {
    byTodo[e.todoId] = byTodo[e.todoId] || { todoId: e.todoId, text: todosById.get(e.todoId) || '(usuniete zadanie)', totalMs: 0 };
    byTodo[e.todoId].totalMs += e.durationMs;
  }
  // Aktywne (jeszcze nie zatrzymane) timery liczymy do "teraz", zeby
  // podsumowanie w trakcie pracy nie pokazywalo zera.
  for (const [id, startedAt] of Object.entries(tt.active)) {
    if (todoId && id !== todoId) continue;
    if (day && dayKey(startedAt) !== day) continue;
    byTodo[id] = byTodo[id] || { todoId: id, text: todosById.get(id) || '(usuniete zadanie)', totalMs: 0 };
    byTodo[id].totalMs += now - startedAt;
    byTodo[id].running = true;
  }

  return Object.values(byTodo);
}

// =====================================================================
// #56 - Priorytetyzacja Eisenhowera na zadanie (Gemini, bez zapisu).
// =====================================================================

const EISENHOWER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    klasyfikacje: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          cwiartka: {
            type: Type.STRING,
            enum: ['pilne_wazne', 'wazne_niepilne', 'pilne_niewazne', 'niepilne_niewazne'],
          },
          uzasadnienie: { type: Type.STRING },
        },
        required: ['id', 'cwiartka'],
      },
    },
  },
  required: ['klasyfikacje'],
};

const EMPTY_QUADRANTS = () => ({ pilne_wazne: [], wazne_niepilne: [], pilne_niewazne: [], niepilne_niewazne: [] });

export async function prioritizeEisenhower() {
  const todos = memory.getTodos().filter((t) => !t.done);
  if (!todos.length) return EMPTY_QUADRANTS();

  const listText = todos.map((t) => `${t.id}: ${t.text}`).join('\n');
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Oto lista zadan uzytkownika (id: tresc):\n${listText}\n\n` +
        'Sklasyfikuj KAZDE zadanie do jednej cwiartki macierzy Eisenhowera, oceniajac pilnosc i waznosc z samej tresci.',
      config: { responseMimeType: 'application/json', responseSchema: EISENHOWER_SCHEMA },
    })
  );
  const parsed = JSON.parse(res.text);
  const byId = new Map(todos.map((t) => [t.id, t]));
  const groups = EMPTY_QUADRANTS();
  for (const c of parsed.klasyfikacje || []) {
    const todo = byId.get(c.id);
    if (!todo || !groups[c.cwiartka]) continue;
    groups[c.cwiartka].push({ id: todo.id, text: todo.text, uzasadnienie: c.uzasadnienie || '' });
  }
  return groups;
}

// =====================================================================
// #57 - Eskalacja przypomnien o zblizajacym sie terminie.
// =====================================================================

/**
 * Jak czesto przypominac o danym terminie, w zaleznosci od tego, ile do
 * niego zostalo. Im blizej (albo im bardziej po terminie), tym czesciej.
 * @param {{dueAt:string}} reminder
 * @returns {{ms:number, label:string}}
 */
export function escalationLevel(reminder) {
  const dueMs = new Date(reminder.dueAt).getTime();
  const leftMs = dueMs - Date.now();

  if (leftMs <= 0) return { ms: 15 * 60 * 1000, label: 'po terminie - co 15 minut' };
  if (leftMs <= 24 * 60 * 60 * 1000) return { ms: 60 * 60 * 1000, label: 'mniej niz doba - co godzine' };
  if (leftMs <= 3 * 24 * 60 * 60 * 1000) return { ms: 6 * 60 * 60 * 1000, label: 'mniej niz 3 dni - co 6 godzin' };
  if (leftMs <= 7 * 24 * 60 * 60 * 1000) return { ms: 24 * 60 * 60 * 1000, label: 'mniej niz tydzien - raz dziennie' };
  return { ms: 3 * 24 * 60 * 60 * 1000, label: 'daleki termin - co 3 dni' };
}

/**
 * Nieukonczone przypomnienia, dla ktorych minal wlasciwy dla ich poziomu
 * eskalacji odstep od ostatniego zameldowania. Wolane z zewnatrz (np. z
 * cyklu upkeep.js) - patrz opis podlaczenia w raporcie.
 */
export function dueEscalatingReminders() {
  const data = loadProd();
  const table = data.productivity.reminderEscalation;
  const now = Date.now();
  return memory
    .getReminders()
    .filter((r) => !r.sent)
    .map((r) => ({ reminder: r, level: escalationLevel(r) }))
    .filter(({ reminder, level }) => {
      const last = table[reminder.id] || 0;
      return now - last >= level.ms;
    });
}

/** Oznacz, ze przypomnienie zostalo wlasnie zameldowane (do liczenia nastepnego odstepu). */
export function markEscalated(reminderId) {
  const data = loadProd();
  data.productivity.reminderEscalation[reminderId] = Date.now();
  memory.save(data);
}

// =====================================================================
// #59 - Generowanie agendy spotkania z krotkiego opisu (Gemini).
// =====================================================================

const AGENDA_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tytul: { type: Type.STRING },
    punkty: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          temat: { type: Type.STRING },
          czas_min: { type: Type.NUMBER },
        },
        required: ['temat', 'czas_min'],
      },
    },
  },
  required: ['punkty'],
};

export async function generateAgenda(description) {
  const clean = String(description || '').trim();
  if (!clean) throw new Error('Brak opisu spotkania.');
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Na podstawie krotkiego opisu spotkania zbuduj ustrukturyzowana agende po polsku: "${clean}"\n\n` +
        'Podaj tytul spotkania oraz 3-8 punktow, kazdy z realistycznym szacowanym czasem w minutach.',
      config: { responseMimeType: 'application/json', responseSchema: AGENDA_SCHEMA },
    })
  );
  const parsed = JSON.parse(res.text);
  if (!Array.isArray(parsed.punkty) || !parsed.punkty.length) throw new Error('Model nie zwrocil agendy.');
  const razemMin = parsed.punkty.reduce((s, p) => s + (Number(p.czas_min) || 0), 0);
  return { tytul: parsed.tytul || clean.slice(0, 60), punkty: parsed.punkty, razemMin };
}

// =====================================================================
// #60 - "Co przegapilem" po dluzszej nieobecnosci.
// =====================================================================

export async function buildCatchUpSummary() {
  const data = loadProd();
  const lastAt = data.productivity.lastCatchUpAt;
  const lines = [];

  try {
    const events = await calendar.listUpcoming(10);
    if (events.length) {
      lines.push(
        `Najblizsze wydarzenia w kalendarzu (${events.length}): ` +
          events.slice(0, 5).map((e) => `${e.title} (${e.start || '?'})`).join('; ')
      );
    }
  } catch {
    // kalendarz moze byc niepolaczony - to nie powinno zablokowac reszty podsumowania
  }

  const days = 3;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const staleTodos = memory.getTodos().filter((t) => !t.done && t.createdAt < cutoff);
  if (staleTodos.length) {
    lines.push(`Zalegle zadania starsze niz ${days} dni (${staleTodos.length}): ` + staleTodos.slice(0, 5).map((t) => t.text).join('; '));
  }

  try {
    const topics = listSentinelTopics();
    const freshFindings = [];
    for (const t of topics) {
      const findings = getSentinelFindings(t.id, 20) || [];
      for (const f of findings) {
        if (!lastAt || f.at > lastAt) freshFindings.push({ query: t.query, summary: f.summary });
      }
    }
    if (freshFindings.length) {
      lines.push(
        `Wartownik znalazl nowosci (${freshFindings.length}): ` +
          freshFindings.slice(0, 5).map((f) => `${f.query}: ${f.summary}`).join(' | ')
      );
    }
  } catch {
    // wartownik to dodatek do podsumowania, jego brak nie powinien go wywalic
  }

  data.productivity.lastCatchUpAt = Date.now();
  memory.save(data);

  if (!lines.length) return 'Nic nowego - wszystko na biezaco.';

  try {
    const res = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents: `Na podstawie tych surowych notatek napisz jedno zwiezle podsumowanie po polsku (2-4 zdania), w stylu krotkiej odprawy:\n${lines.join('\n')}`,
      })
    );
    if (res.text && res.text.trim()) return res.text.trim();
  } catch {
    // model zawodzi - surowe punkty sa lepsze niz brak odpowiedzi
  }
  return lines.join(' ');
}

// =====================================================================
// Router HTTP - eksportowany, NIE montowany tutaj. Zamontuj w index.js:
//   import { router as productivityRouter } from './server/productivity.js';
//   app.use('/api/productivity', productivityRouter);
// =====================================================================

export const router = express.Router();

router.post('/schedule/slots', requireOwner, async (req, res) => {
  try {
    const { durationMin = 30, daysAhead = 5, workHourStart = 9, workHourEnd = 17, maxSlots = 10 } = req.body || {};
    const events = await fetchBusyEvents();
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + Number(daysAhead) * 24 * 60 * 60 * 1000);
    const slots = findFreeSlots({
      events,
      rangeStart: now.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      durationMin: Number(durationMin),
      workHourStart: Number(workHourStart),
      workHourEnd: Number(workHourEnd),
      maxSlots: Number(maxSlots),
    });
    res.json({ slots });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/deep-work', requireOwner, async (req, res) => {
  try {
    const { daysAhead, workHourStart, workHourEnd } = req.body || {};
    const result = await scheduleDeepWorkBlock({ daysAhead, workHourStart, workHourEnd });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/todoist/sync', requireOwner, async (req, res) => {
  try {
    res.json(await syncTodoist());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/breakdown', requireOwner, async (req, res) => {
  try {
    const items = await breakdownTask(req.body?.task);
    res.json({ items });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/time/start', requireOwner, (req, res) => {
  const { todoId } = req.body || {};
  if (!todoId) return res.status(400).json({ error: 'Brak todoId.' });
  res.json(startTimer(todoId));
});

router.post('/time/stop', requireOwner, (req, res) => {
  const { todoId } = req.body || {};
  if (!todoId) return res.status(400).json({ error: 'Brak todoId.' });
  res.json(stopTimer(todoId));
});

router.get('/time/summary', requireOwner, (req, res) => {
  res.json({ items: summarizeTime({ todoId: req.query.todoId, day: req.query.day }) });
});

router.post('/eisenhower', requireOwner, async (req, res) => {
  try {
    res.json(await prioritizeEisenhower());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/reminders/escalation', requireOwner, (req, res) => {
  const due = dueEscalatingReminders().map(({ reminder, level }) => ({
    id: reminder.id,
    text: reminder.text,
    dueAt: reminder.dueAt,
    level,
  }));
  res.json({ due });
});

router.post('/agenda', requireOwner, async (req, res) => {
  try {
    res.json(await generateAgenda(req.body?.description));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/catch-up', requireOwner, async (req, res) => {
  try {
    res.json({ summary: await buildCatchUpSummary() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
