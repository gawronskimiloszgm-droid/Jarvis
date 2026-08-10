import { nanoid } from 'nanoid';
import { readStore, writeStore, backendName, isRemote } from './store.js';

const EMPTY_STORE = { facts: [], history: [], todos: [], reminders: [], pushSubscriptions: [] };

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
    writeStore(cache).catch(() => {});
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

export function appendHistory(role, content) {
  const data = load();
  data.history.push({ role, content, ts: Date.now() });
  const MAX_HISTORY = 40;
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
