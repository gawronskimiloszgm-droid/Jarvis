// Propozycje Jarvisa: patrzy na Twoje dane i sam proponuje konkretne dzialanie (odkladane zadania,
// zagrozona seria nawyku, zblizajace sie terminy, urodziny...) oraz uklada plan dnia rano.
// Regule sa zwykle i dzialaja bez AI; plan dnia pisze model, a bez niego zostaje prosta lista.
import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as calendar from '../connect/calendar.js';
import { isDnd } from './dnd.js';
import { lifeAdd, lifeDaily, lifeList, lifeToggleHabit, logJournal, warsawDay } from './life.js';
import { promptFix } from '../core/pltext.js';

const router = Router();
const DAY_MS = 86400000;

const state = () => {
  const d = memory.load();
  if (!d.suggest || typeof d.suggest !== 'object') d.suggest = { dismissed: {}, plan: null };
  if (!d.suggest.dismissed) d.suggest.dismissed = {};
  return d.suggest;
};
const save = () => memory.save(memory.load());

const warsawHour = (now) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(new Date(now)));
const daysTo = (day, today) => Math.round((new Date(`${day}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / DAY_MS);
const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const dni = (n) => `${n} ${plural(n, 'dzień', 'dni', 'dni')}`;

function streakOf(days, today) {
  const set = new Set(days);
  let n = 0;
  let cur = set.has(today) ? today : new Date(new Date(`${today}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  while (set.has(cur)) {
    n++;
    cur = new Date(new Date(`${cur}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  }
  return n;
}

/**
 * Czyste reguly (testowane osobno). Wynik posortowany: najwazniejsze pierwsze.
 * @param {object} d dane: todos, habits, goals, countdowns, birthdays, shopping, kanban, cards, journal, daily
 */
export function buildSuggestions(d, now = Date.now(), today = warsawDay(), hour = warsawHour(now)) {
  const out = [];
  const add = (id, prio, title, text, actions) => out.push({ id, prio, title, text, actions });
  const open = (mod, label = 'OTWÓRZ') => ({ label, op: 'open', arg: mod });

  (d.todos || [])
    .filter((t) => !t.done && t.createdAt)
    .forEach((t) => {
      const age = Math.floor((now - t.createdAt) / DAY_MS);
      if (age >= 7) {
        add(`stale:${t.id}`, Math.min(80, 40 + age + (t.priority || 0) * 10), 'Odkładane zadanie', `„${t.text}” czeka już ${dni(age)}. Zrobimy to, przełożymy czy usuwamy?`, [
          { label: 'ZROBIONE', op: 'todo-done', arg: t.id },
          { label: 'PRZYPOMNIJ JUTRO', op: 'remind-tomorrow', arg: t.text },
          { label: 'USUŃ', op: 'todo-del', arg: t.id },
        ]);
      }
    });

  (d.birthdays || []).forEach((b) => {
    const year = today.slice(0, 4);
    let n = daysTo(`${year}-${b.date}`, today);
    if (n < 0) n = daysTo(`${Number(year) + 1}-${b.date}`, today);
    if (n <= 3) {
      add(`bday:${b.id}:${year}`, 90 - n, 'Urodziny', n === 0 ? `Dziś urodziny: ${b.name}.` : `${b.name}: urodziny za ${dni(n)}.`, [{ label: 'DODAJ ZADANIE: PREZENT', op: 'add-todo', arg: `Prezent / życzenia: ${b.name}` }]);
    }
  });

  (d.countdowns || []).forEach((c) => {
    const n = daysTo(c.date, today);
    if (n >= 0 && n <= 3) add(`count:${c.id}`, 75 - n, 'Zbliża się termin', n === 0 ? `Dziś: ${c.name}.` : `${c.name}: za ${dni(n)}.`, [open('goals')]);
  });

  (d.goals || [])
    .filter((g) => !g.done && g.due)
    .forEach((g) => {
      const n = daysTo(g.due, today);
      if (n >= 0 && n <= 7 && (g.progress || 0) < (g.target || 100)) add(`goal:${g.id}`, 70 - n, 'Cel z terminem', `„${g.text}”: zostało ${dni(n)}, postęp ${g.progress || 0}/${g.target || 100} ${g.unit || ''}.`.trim(), [open('goals')]);
    });

  if (hour >= 18) {
    (d.habits || []).forEach((h) => {
      if ((h.days || []).includes(today)) return;
      const s = streakOf(h.days || [], today);
      if (s >= 3) add(`habit:${h.id}:${today}`, 65 + Math.min(20, s), 'Seria w niebezpieczeństwie', `„${h.name}”: seria ${dni(s)} przepadnie, jeśli dziś nie odhaczysz.`, [{ label: 'ODHACZ', op: 'habit', arg: h.name }]);
    });
  }

  const water = d.daily?.[today]?.water || 0;
  if (hour >= 14 && hour < 22 && water < 3) add(`water:${today}`, 35, 'Woda', `Dziś dopiero ${water} szkl. wody.`, [{ label: 'WYPIŁEM SZKLANKĘ', op: 'water', arg: 1 }]);

  const shop = (d.shopping || []).filter((x) => !x.done).length;
  if (shop >= 8) add(`shop:${today}`, 30, 'Zakupy', `Na liście jest już ${shop} pozycji. Może czas na sklep?`, [open('shop')]);

  (d.kanban || [])
    .filter((k) => k.col === 'doing' && k.at && now - k.at > 5 * DAY_MS)
    .forEach((k) => add(`kanban:${k.id}`, 45, 'Tablica', `Karta „${k.text}” jest w toku od ${dni(Math.floor((now - k.at) / DAY_MS))}.`, [open('kanban')]));

  const dueCards = (d.cards || []).filter((c) => c.due && c.due <= today).length;
  if (dueCards >= 5) add(`cards:${today}`, 25, 'Fiszki', `${dueCards} fiszek czeka na powtórkę.`, [open('cards', 'POWTÓRKA')]);

  if (hour >= 20) {
    const wrote = (d.journal || []).some((e) => e.kind === 'manual' && Date.now() - e.at < DAY_MS && new Date(e.at).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) === today);
    if (!wrote && (d.journal || []).some((e) => e.kind === 'manual')) add(`journal:${today}`, 20, 'Dziennik', 'Dziś nie ma jeszcze wpisu w dzienniku.', [open('journal', 'DOPISZ')]);
  }

  return out.sort((a, b) => b.prio - a.prio);
}

function snapshot() {
  const d = memory.load();
  const l = d.life || {};
  return {
    todos: memory.getTodos(),
    habits: lifeList('habits'),
    goals: lifeList('goals'),
    countdowns: lifeList('countdowns'),
    birthdays: lifeList('birthdays'),
    shopping: lifeList('shopping'),
    kanban: lifeList('kanban'),
    cards: lifeList('flashcards'),
    journal: lifeList('journal').slice(0, 200),
    planner: lifeList('planner'),
    daily: l.daily || {},
  };
}

export function currentSuggestions(now = Date.now()) {
  const s = state();
  let changed = false;
  for (const [k, until] of Object.entries(s.dismissed)) {
    if (until < now) {
      delete s.dismissed[k];
      changed = true;
    }
  }
  if (changed) save();
  return buildSuggestions(snapshot(), now).filter((x) => !s.dismissed[x.id]);
}

router.get('/api/suggest', requireOwner, (req, res) => res.json({ items: currentSuggestions(), plan: state().plan }));

router.post('/api/suggest/dismiss', requireOwner, (req, res) => {
  const id = String(req.body?.id || '').slice(0, 120);
  if (!id) return res.status(400).json({ error: 'Brak propozycji.' });
  state().dismissed[id] = Date.now() + Math.max(1, Math.min(60, Number(req.body?.days) || 3)) * DAY_MS;
  save();
  res.json({ ok: true });
});

// Wykonanie propozycji po potwierdzeniu przyciskiem.
router.post('/api/suggest/do', requireOwner, (req, res) => {
  const { id, op, arg } = req.body || {};
  const text = String(arg ?? '').slice(0, 300);
  switch (op) {
    case 'todo-done':
      memory.setTodoDone(text, true);
      break;
    case 'todo-del':
      memory.removeTodo(text);
      break;
    case 'add-todo':
      memory.addTodo(text);
      break;
    case 'remind-tomorrow': {
      const when = `${warsawDay(1)}T09:00`;
      memory.addReminder(text, when);
      break;
    }
    case 'habit':
      lifeToggleHabit(text);
      break;
    case 'water':
      lifeDaily({ waterDelta: Number(arg) || 1 });
      break;
    case 'add-journal':
      lifeAdd('journal', { text, kind: 'manual' });
      break;
    default:
      return res.status(400).json({ error: 'Nieznane działanie.' });
  }
  if (id) state().dismissed[String(id).slice(0, 120)] = Date.now() + 3 * DAY_MS;
  save();
  res.json({ ok: true });
});

// ---------- plan dnia ----------
async function planInputs() {
  const today = warsawDay();
  const snap = snapshot();
  const open = snap.todos.filter((t) => !t.done).sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, 12).map((t) => t.text);
  const planned = snap.planner.filter((p) => p.day === today && !p.done).map((p) => `${p.time || ''} ${p.text}`.trim());
  const habits = snap.habits.map((h) => h.name);
  const reminders = (memory.getReminders?.() || []).filter((r) => !r.sent && String(r.dueAt).slice(0, 10) === today).map((r) => `${String(r.dueAt).slice(11, 16)} ${r.text}`);
  let events = [];
  if (calendar.isConnected?.()) {
    try {
      events = (await calendar.listUpcoming(8)).filter((e) => String(e.start || '').slice(0, 10) === today).map((e) => `${String(e.start).slice(11, 16)} ${e.title || e.summary || ''}`);
    } catch {
      /* plan powstanie bez kalendarza */
    }
  }
  return { today, open, planned, habits, reminders, events };
}

export function simplePlan({ open, planned, habits, reminders, events }) {
  const lines = [];
  const fixed = [...events, ...reminders, ...planned];
  if (fixed.length) lines.push(`Stałe punkty: ${fixed.join('; ')}.`);
  if (open.length) lines.push(`Najpierw: ${open.slice(0, 3).join('; ')}.`);
  if (habits.length) lines.push(`Nawyki: ${habits.slice(0, 5).join(', ')}.`);
  return lines.join(' ') || 'Dziś nic nie jest zaplanowane. Rzadka sytuacja, sir.';
}

async function makePlan() {
  const input = await planInputs();
  let text = simplePlan(input);
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const r = await withModel((model) =>
        ai.models.generateContent({
          model,
          contents: `Dane na dziś (${input.today}):\n${JSON.stringify(input)}\n\nUłóż krótki plan dnia dla właściciela: 3-5 zdań, co najpierw, kiedy stałe punkty, co można odpuścić. Bez list, bez wymyślania rzeczy spoza danych.`,
          config: { systemInstruction: promptFix('Jestes Jarvisem, spokojnym majordomusem AI. Mowisz konkretnie, z lekka ironia, zwracasz sie "sir".') },
        })
      );
      if (r.text) text = String(r.text).trim();
    } catch (err) {
      console.error('Plan dnia bez AI:', err.message || err);
    }
  }
  const plan = { day: input.today, text, at: Date.now() };
  state().plan = plan;
  save();
  return plan;
}

router.post('/api/suggest/plan', requireOwner, async (req, res) => {
  try {
    res.json({ plan: await makePlan() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Nie udało się ułożyć planu.' });
  }
});

// Rano raz dziennie: plan dnia jako powiadomienie i wpis w dzienniku.
export async function maybeMorningPlan(now = Date.now()) {
  const hour = warsawHour(now);
  if (hour < 6 || hour >= 11) return false;
  if (state().plan?.day === warsawDay()) return false;
  const plan = await makePlan();
  if (push.isConfigured() && !isDnd()) await push.sendToAll({ title: 'J.A.R.V.I.S. - plan dnia', body: plan.text.slice(0, 280) }).catch(() => {});
  logJournal('auto', `Plan dnia: ${plan.text.slice(0, 300)}`, 'plan');
  return true;
}

export default router;
