import { nanoid } from 'nanoid';
import { readStore, writeStore, backendName, isRemote } from '../core/store.js';

// summary - zwijana kronika starszych rozmow. Sama historia ma skonczona
// dlugosc, wiec bez tego wszystko sprzed kilkuset wypowiedzi znikaloby
// bezpowrotnie i Jarvis "budzil sie" bez przeszlosci przy kazdej rozmowie.
const EMPTY_STORE = {
  facts: [],
  history: [],
  summary: '',
  todos: [],
  reminders: [],
  pushSubscriptions: [],
  expenses: [],
  routines: [],
  briefing: { lastMorningAt: null, lastEveningAt: null },
  googleRefreshToken: null,
};

// Stan trzymamy w pamieci procesu, a zapisujemy async/debounced, zamiast
// przy kazdym pojedynczym mutatorze (na wolnym darmowym CPU to realnie
// spowalnialo odpowiedzi). Trwalosc miedzy restartami zapewnia store.js.
let cache = null;
let saveTimer = null;

// Wczytanie stanu ZANIM serwer zacznie przyjmowac zapytania - inaczej
// pierwsze wywolanie load() zobaczyloby pusta pamiec i mogloby ja nadpisac.
export async function hydrate() {
  const data = await readStore();
  cache = { ...EMPTY_STORE, ...(data || {}) };
  console.log(
    `Pamiec: ${backendName()}, faktow: ${cache.facts.length}, zadan: ${cache.todos.length}` +
      (isRemote ? '' : ' (UWAGA: bez zewnetrznego magazynu pamiec ginie przy restarcie na Renderze)')
  );
  return cache;
}

export function load() {
  if (!cache) cache = { ...EMPTY_STORE };
  return cache;
}

export function save(data) {
  cache = data;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeStore(cache).catch((err) => console.error('Pamiec: zapis nieudany:', err.message));
  }, 150);
}

// Wymuszenie natychmiastowego zapisu (np. przy zamykaniu procesu).
export async function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (cache) await writeStore(cache);
}

export function addFacts(newFacts) {
  if (!newFacts || !newFacts.length) return load();
  const data = load();
  for (const fact of newFacts) {
    const clean = String(fact).trim();
    if (!clean) continue;
    if (!data.facts.some((f) => f.toLowerCase() === clean.toLowerCase())) {
      data.facts.push(clean);
    }
  }
  save(data);
  return data;
}

// Twardy sufit jest wysoko, bo wlasciwe skracanie robi condenseHistory():
// zwija najstarsze wypowiedzi w kronike, zamiast je po prostu wyrzucac.
// Sufit chroni tylko przed rozjechaniem sie magazynu, gdyby zwijanie
// przestalo dzialac (np. brak limitu API).
const MAX_HISTORY = 200;

export function appendHistory(role, content) {
  const data = load();
  data.history.push({ role, content, ts: Date.now() });
  if (data.history.length > MAX_HISTORY) {
    data.history = data.history.slice(-MAX_HISTORY);
  }
  save(data);
  return data;
}

export function getRecentHistory(limit = 20) {
  const data = load();
  return data.history.slice(-limit);
}

export function getSummary() {
  return load().summary || '';
}

export function setSummary(text) {
  const data = load();
  data.summary = String(text || '').trim();
  save(data);
  return data.summary;
}

export function getFacts() {
  return load().facts;
}

export function removeFact(index) {
  const data = load();
  if (index >= 0 && index < data.facts.length) {
    data.facts.splice(index, 1);
    save(data);
  }
  return data;
}

// --- Todos ---
export function getTodos() {
  return load().todos;
}

export function addTodo(text) {
  const clean = String(text || '').trim();
  if (!clean) return load().todos;
  const data = load();
  data.todos.push({ id: nanoid(8), text: clean, done: false, createdAt: Date.now() });
  save(data);
  return data.todos;
}

export function setTodoDone(id, done) {
  const data = load();
  const todo = data.todos.find((t) => t.id === id);
  if (todo) todo.done = Boolean(done);
  save(data);
  return data.todos;
}

export function removeTodo(id) {
  const data = load();
  data.todos = data.todos.filter((t) => t.id !== id);
  save(data);
  return data.todos;
}

// --- Reminders ---
export function getReminders() {
  return load().reminders;
}

export function addReminder(text, dueAt) {
  const clean = String(text || '').trim();
  if (!clean || !dueAt) return load().reminders;
  const data = load();
  data.reminders.push({ id: nanoid(8), text: clean, dueAt, sent: false, createdAt: Date.now() });
  save(data);
  return data.reminders;
}

export function removeReminder(id) {
  const data = load();
  data.reminders = data.reminders.filter((r) => r.id !== id);
  save(data);
  return data.reminders;
}

export function getDueUnsentReminders() {
  const now = Date.now();
  return load().reminders.filter((r) => !r.sent && new Date(r.dueAt).getTime() <= now);
}

export function markReminderSent(id) {
  const data = load();
  const reminder = data.reminders.find((r) => r.id === id);
  if (reminder) reminder.sent = true;
  save(data);
}

// --- Push subscriptions ---
export function addPushSubscription(subscription) {
  const data = load();
  const exists = data.pushSubscriptions.some((s) => s.endpoint === subscription.endpoint);
  if (!exists) data.pushSubscriptions.push(subscription);
  save(data);
  return data.pushSubscriptions;
}

export function removePushSubscription(endpoint) {
  const data = load();
  data.pushSubscriptions = data.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
  save(data);
}

export function getPushSubscriptions() {
  return load().pushSubscriptions;
}

// --- Wydatki ---

// Kwota przychodzi z modelu, ktory rozpoznaje ja z mowy ("czterdziesci
// piec zlotych") - moze wiec przyjsc jako tekst, z przecinkiem zamiast
// kropki albo ze slowem "zl". Normalizujemy zamiast ufac formatowi.
function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value || '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function getExpenses() {
  return load().expenses;
}

export function addExpense(amount, category, note) {
  const value = parseAmount(amount);
  if (value === null || value <= 0) return null;
  const data = load();
  const entry = {
    id: nanoid(8),
    amount: Math.round(value * 100) / 100,
    category: String(category || 'inne').trim().toLowerCase(),
    note: String(note || '').trim(),
    ts: Date.now(),
  };
  data.expenses.push(entry);
  save(data);
  return entry;
}

export function removeExpense(id) {
  const data = load();
  data.expenses = data.expenses.filter((e) => e.id !== id);
  save(data);
  return data.expenses;
}

// --- Tryby (rutyny) ---
// Nazwane paczki krokow z istniejacego slownika akcji urzadzenia - Jarvis
// tworzy je na zyczenie (glosem, przez function calling) i odtwarza po
// nazwie. Zadnej nowej logiki wykonania: kroki to te same DEVICE_ACTIONS,
// ktore juz dzialaja pojedynczo - tryb to tylko ich kolejnosc.
export function getRoutines() {
  return load().routines || [];
}

export function getRoutine(name) {
  const clean = String(name || '').trim().toLowerCase();
  return (load().routines || []).find((r) => r.name === clean) || null;
}

export function saveRoutine(name, steps) {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean || !Array.isArray(steps) || !steps.length) return getRoutines();
  const data = load();
  if (!Array.isArray(data.routines)) data.routines = [];
  const existing = data.routines.find((r) => r.name === clean);
  if (existing) existing.steps = steps;
  else data.routines.push({ name: clean, steps, createdAt: Date.now() });
  save(data);
  return data.routines;
}

export function removeRoutine(name) {
  const clean = String(name || '').trim().toLowerCase();
  const data = load();
  data.routines = (data.routines || []).filter((r) => r.name !== clean);
  save(data);
  return data.routines;
}

// --- Kalendarz Google ---
export function getGoogleRefreshToken() {
  return load().googleRefreshToken || null;
}

export function setGoogleRefreshToken(token) {
  const data = load();
  data.googleRefreshToken = token || null;
  save(data);
}

// --- Odprawa (briefing) ---
// Znacznik "ostatnio wyslano" per pora dnia, zeby /api/cron/tick (odpytywany
// z zewnatrz co ~10 min) nie wyslal tej samej odprawy kilka razy w oknie
// docelowej godziny.
export function getBriefingState() {
  return load().briefing || { lastMorningAt: null, lastEveningAt: null };
}

export function markBriefingSent(kind) {
  const data = load();
  if (!data.briefing) data.briefing = { lastMorningAt: null, lastEveningAt: null };
  if (kind === 'morning') data.briefing.lastMorningAt = Date.now();
  else if (kind === 'evening') data.briefing.lastEveningAt = Date.now();
  save(data);
}

// Podsumowanie za ostatnie N dni, z rozbiciem na kategorie.
export function summarizeExpenses(days = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const items = load().expenses.filter((e) => e.ts >= since);
  const byCategory = {};
  let total = 0;
  for (const e of items) {
    total += e.amount;
    byCategory[e.category] = Math.round(((byCategory[e.category] || 0) + e.amount) * 100) / 100;
  }
  return {
    days,
    count: items.length,
    total: Math.round(total * 100) / 100,
    byCategory,
  };
}
