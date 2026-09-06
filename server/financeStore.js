// Wlasny namespace w trwalej pamieci (memory.js) dla modulu finansow -
// budzety per kategoria, cele oszczednosciowe, wydatki wspolne (podzial
// rachunkow) i konfiguracja wyplaty. Zgodnie z konwencja repo: NIE
// modyfikujemy memory.js - doklejamy nowy klucz "finance" do tego samego
// store przez juz istniejace load()/save(). Same wydatki (jedno-, nie
// wielo-osobowe) zostaja tam, gdzie juz sa: w memory.getExpenses().

import { nanoid } from 'nanoid';
import { load, save } from './memory.js';

const EMPTY_FINANCE = {
  budgets: {}, // { [kategoria]: limitMiesieczny }
  budgetAlerts: {}, // { "kategoria:RRRR-MM": true } - zeby alert nie lecial przy kazdym sprawdzeniu
  salary: { payday: null, monthlyIncome: null },
  savingsGoals: [], // [{ id, name, target, current, createdAt }]
  sharedExpenses: [], // [{ id, amount, category, note, people, ts, settled }]
  reportedAnomalies: [], // id-y wydatkow, o ktorych juz wyslano alert (bez duplikatow)
};

// Zwraca CALY obiekt store (jak memory.load()), z gwarancja ze data.finance
// istnieje i ma wszystkie oczekiwane pola - takze gdy zapisano go wczesniej
// przed dodaniem kolejnego pod-klucza.
function store() {
  const data = load();
  if (!data.finance || typeof data.finance !== 'object') data.finance = {};
  for (const key of Object.keys(EMPTY_FINANCE)) {
    if (!(key in data.finance)) {
      data.finance[key] = Array.isArray(EMPTY_FINANCE[key])
        ? [...EMPTY_FINANCE[key]]
        : { ...EMPTY_FINANCE[key] };
    }
  }
  return data;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// --- Budzety per kategoria ---

export function getBudgets() {
  return store().finance.budgets;
}

export function setBudget(category, limit) {
  const data = store();
  const clean = String(category || '').trim().toLowerCase();
  const value = Number(limit);
  if (!clean || !Number.isFinite(value) || value < 0) return data.finance.budgets;
  data.finance.budgets[clean] = round2(value);
  save(data);
  return data.finance.budgets;
}

export function removeBudget(category) {
  const data = store();
  const clean = String(category || '').trim().toLowerCase();
  delete data.finance.budgets[clean];
  save(data);
  return data.finance.budgets;
}

// Zwraca true tylko PRZY PIERWSZYM przekroczeniu progu w danym miesiacu -
// endpoint sprawdzajacy budzet moze byc odpytywany wielokrotnie (frontend,
// cron), a alert glosowy/HUD ma polecieć raz, nie za kazdym razem.
export function markBudgetAlerted(category, monthKey) {
  const data = store();
  const key = `${category}:${monthKey}`;
  if (data.finance.budgetAlerts[key]) return false;
  data.finance.budgetAlerts[key] = true;
  save(data);
  return true;
}

// --- Konfiguracja wyplaty ---

export function getSalaryConfig() {
  return store().finance.salary;
}

export function setSalaryConfig(payday, monthlyIncome) {
  const data = store();
  data.finance.salary = {
    payday: Number.isInteger(payday) ? payday : null,
    monthlyIncome: Number.isFinite(monthlyIncome) ? round2(monthlyIncome) : null,
  };
  save(data);
  return data.finance.salary;
}

// --- Cele oszczednosciowe ---

export function getGoals() {
  return store().finance.savingsGoals;
}

export function addGoal(name, target, current = 0) {
  const data = store();
  const goal = {
    id: nanoid(8),
    name: String(name || '').trim().slice(0, 80),
    target: round2(Number(target) || 0),
    current: round2(Number(current) || 0),
    createdAt: Date.now(),
  };
  data.finance.savingsGoals.push(goal);
  save(data);
  return goal;
}

// `current` (wartosc bezwzgledna) i `add` (przyrost/ubytek) sa wzajemnie
// wykluczajace sie - `current` ma pierwszenstwo, gdy podano oba.
export function updateGoalProgress(id, current, add) {
  const data = store();
  const goal = data.finance.savingsGoals.find((g) => g.id === id);
  if (goal) {
    if (Number.isFinite(Number(current))) {
      goal.current = round2(Number(current));
    } else if (Number.isFinite(Number(add))) {
      goal.current = round2(Math.max(0, goal.current + Number(add)));
    }
  }
  save(data);
  return data.finance.savingsGoals;
}

export function removeGoal(id) {
  const data = store();
  data.finance.savingsGoals = data.finance.savingsGoals.filter((g) => g.id !== id);
  save(data);
  return data.finance.savingsGoals;
}

// --- Wydatki wspolne (podzial rachunkow) ---
// Osobna, mniejsza struktura niz memory.expenses - dotyczy pieniedzy, ktore
// uzytkownik wylozyl za kogos innego i ktore mu sie naleza z powrotem, nie
// jego wlasnego budzetu.

export function getSharedExpenses() {
  return store().finance.sharedExpenses;
}

export function addSharedExpense(amount, category, note, people) {
  const data = store();
  const entry = {
    id: nanoid(8),
    amount: round2(Number(amount) || 0),
    category: String(category || 'inne').trim().toLowerCase(),
    note: String(note || '').trim(),
    people: Math.max(2, Math.round(Number(people) || 2)),
    ts: Date.now(),
    settled: false,
  };
  data.finance.sharedExpenses.push(entry);
  save(data);
  return entry;
}

export function settleSharedExpense(id) {
  const data = store();
  const entry = data.finance.sharedExpenses.find((e) => e.id === id);
  if (entry) entry.settled = true;
  save(data);
  return data.finance.sharedExpenses;
}

// --- Alert przy nietypowej transakcji: dedup ---

const MAX_REPORTED_ANOMALIES = 500;

export function wasAnomalyReported(expenseId) {
  return store().finance.reportedAnomalies.includes(expenseId);
}

export function markAnomalyReported(expenseId) {
  const data = store();
  data.finance.reportedAnomalies.push(expenseId);
  if (data.finance.reportedAnomalies.length > MAX_REPORTED_ANOMALIES) {
    data.finance.reportedAnomalies = data.finance.reportedAnomalies.slice(-MAX_REPORTED_ANOMALIES);
  }
  save(data);
}
