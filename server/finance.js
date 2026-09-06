// Modul "finanse" - 10 funkcji dolozonych do istniejacego szkieletu
// wydatkow (memory.getExpenses/addExpense/removeExpense/summarizeExpenses
// w server/memory.js, ktorych ten plik NIE duplikuje, tylko uzywa).
//
// Eksportuje WYLACZNIE Router - nie montuje sie sam. Zamontuj w index.js:
//   import financeRouter from './finance.js';
//   app.use('/api/finance', financeRouter);
//
// Dane wrazliwe -> kazdy endpoint wymaga requireOwner (patrz server/auth.js).

import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import * as memory from './memory.js';
import * as financeStore from './financeStore.js';
import * as bank from './openBanking.js';
import * as bus from './bus.js';
import { withModel } from './geminiChain.js';
import { requireOwner } from './auth.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const router = Router();
router.use(requireOwner);

function round2(n) {
  return Math.round(n * 100) / 100;
}

function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function startOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1).getTime();
}

// ---------------------------------------------------------------------
// 71. Sugerowana kategoria wydatku (Gemini, lista zamknieta)
// ---------------------------------------------------------------------

const EXPENSE_CATEGORIES = ['jedzenie', 'paliwo', 'rachunki', 'rozrywka', 'zdrowie', 'zakupy', 'inne'];

const CATEGORY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, enum: EXPENSE_CATEGORIES },
  },
  required: ['category'],
};

async function suggestCategory(description) {
  const text = String(description || '').trim().slice(0, 300);
  if (!text) return 'inne';
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Do jakiej kategorii wydatkow domowych pasuje ten opis zakupu: "${text}"?\n` +
        'Wybierz DOKLADNIE jedna kategorie z podanej zamknietej listy - nie wymyslaj innej.',
      config: { responseMimeType: 'application/json', responseSchema: CATEGORY_SCHEMA },
    })
  );
  try {
    const parsed = JSON.parse(res.text);
    return EXPENSE_CATEGORIES.includes(parsed.category) ? parsed.category : 'inne';
  } catch {
    return 'inne';
  }
}

// POST /api/finance/suggest-category { description } -> { category }
router.post('/suggest-category', async (req, res) => {
  const { description } = req.body || {};
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'Wymagane pole "description".' });
  }
  try {
    const category = await suggestCategory(description);
    res.json({ category, categories: EXPENSE_CATEGORIES });
  } catch (err) {
    res.status(502).json({ error: `Kategoryzacja nieudana: ${err.message}` });
  }
});

// ---------------------------------------------------------------------
// 72. Miesieczny raport wydatkow (dane pod wykres, bez UI)
// ---------------------------------------------------------------------

// GET /api/finance/report/monthly -> ostatnie 6 miesiecy, per miesiac i per kategoria
router.get('/report/monthly', (req, res) => {
  const expenses = memory.getExpenses();
  const now = new Date();
  const monthKeys = [];
  for (let i = 5; i >= 0; i--) {
    monthKeys.push(monthKey(startOfMonth(now.getFullYear(), now.getMonth() - i)));
  }
  const byMonth = Object.fromEntries(monthKeys.map((k) => [k, { total: 0, byCategory: {} }]));
  for (const e of expenses) {
    const key = monthKey(e.ts);
    const bucket = byMonth[key];
    if (!bucket) continue; // wydatek spoza 6-miesiecznego okna wykresu
    bucket.total = round2(bucket.total + e.amount);
    bucket.byCategory[e.category] = round2((bucket.byCategory[e.category] || 0) + e.amount);
  }
  // Sumy per-kategoria za cale okno licza sie z JUZ istniejacej funkcji -
  // nie powielamy tej logiki recznie.
  const overall = memory.summarizeExpenses(31 * 6);
  res.json({
    months: monthKeys.map((key) => ({ month: key, total: byMonth[key].total, byCategory: byMonth[key].byCategory })),
    overallByCategory: overall.byCategory,
    overallTotal: overall.total,
  });
});

// ---------------------------------------------------------------------
// 73. Budzet per kategoria + alert po przekroczeniu
// ---------------------------------------------------------------------

router.get('/budgets', (req, res) => {
  res.json({ budgets: financeStore.getBudgets() });
});

// PUT /api/finance/budgets/:category { limit }
router.put('/budgets/:category', (req, res) => {
  const value = Number(req.body?.limit);
  if (!Number.isFinite(value) || value < 0) {
    return res.status(400).json({ error: 'Wymagane pole "limit" (liczba >= 0).' });
  }
  const budgets = financeStore.setBudget(req.params.category, value);
  res.json({ budgets });
});

router.delete('/budgets/:category', (req, res) => {
  const budgets = financeStore.removeBudget(req.params.category);
  res.json({ budgets });
});

// GET /api/finance/budgets/status -> wydatki biezacego miesiaca vs limity,
// publikuje alert na bus gdy ktoras kategoria przekroczy 90% limitu.
router.get('/budgets/status', (req, res) => {
  const budgets = financeStore.getBudgets();
  const now = new Date();
  const start = startOfMonth(now.getFullYear(), now.getMonth());
  const key = monthKey(start);
  const spentByCategory = {};
  for (const e of memory.getExpenses()) {
    if (e.ts < start) continue;
    spentByCategory[e.category] = round2((spentByCategory[e.category] || 0) + e.amount);
  }
  const status = Object.entries(budgets).map(([category, limit]) => {
    const spent = spentByCategory[category] || 0;
    const pct = limit > 0 ? spent / limit : 0;
    if (pct >= 0.9 && financeStore.markBudgetAlerted(category, key)) {
      bus.publish(
        'finance',
        'budget.exceeded',
        `Budzet "${category}" wykorzystany w ${Math.round(pct * 100)}% (${spent.toFixed(2)} / ${limit.toFixed(2)} zl).`,
        { level: pct >= 1 ? 'alert' : 'warn', data: { category, spent, limit, pct }, speak: pct >= 1 }
      );
    }
    return { category, limit, spent, pct: round2(pct * 100) / 100, overBudget: pct >= 1 };
  });
  res.json({ month: key, status });
});

// ---------------------------------------------------------------------
// 74. Integracja z bankiem (open banking) - podglad salda/transakcji
// ---------------------------------------------------------------------

// GET /api/finance/bank/balance
router.get('/bank/balance', async (req, res) => {
  if (!bank.isConfigured()) {
    return res.json({
      configured: false,
      message:
        'Integracja z bankiem nie jest skonfigurowana. Ustaw OPEN_BANKING_API_URL i OPEN_BANKING_TOKEN ' +
        '(token z Twojego dostawcy open-banking, np. Nordigen/GoCardless Bank Account Data), aby zobaczyc saldo i transakcje.',
    });
  }
  try {
    const [balance, transactions] = await Promise.all([bank.getBalance(), bank.getRecentTransactions(10)]);
    res.json({ configured: true, balance, transactions });
  } catch (err) {
    res.status(502).json({ configured: true, error: `Bank nie odpowiedzial poprawnie: ${err.message}` });
  }
});

// ---------------------------------------------------------------------
// 75. Wykrywanie zapomnianych subskrypcji
// ---------------------------------------------------------------------

function detectSubscriptions(expenses) {
  // Ta sama kwota + ta sama kategoria, powtarzajace sie co ~miesiac, to
  // najsilniejszy sygnal subskrypcji bez znajomosci nazwy sprzedawcy.
  const groups = new Map();
  for (const e of expenses) {
    const key = `${e.category}|${e.amount.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const results = [];
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.ts - b.ts);
    const gaps = [];
    for (let i = 1; i < items.length; i++) {
      gaps.push((items[i].ts - items[i - 1].ts) / (24 * 60 * 60 * 1000));
    }
    // Odstep "mniej wiecej miesieczny": 24-37 dni, elastycznie na krotsze/
    // dluzsze miesiace kalendarzowe i drobne przesuniecia platnosci.
    const monthlyGaps = gaps.filter((g) => g >= 24 && g <= 37).length;
    if (monthlyGaps > 0 && monthlyGaps >= gaps.length - 1) {
      const [category, amountStr] = key.split('|');
      const last = items[items.length - 1];
      results.push({
        category,
        amount: Number(amountStr),
        occurrences: items.length,
        lastSeen: new Date(last.ts).toISOString(),
        note: last.note || null,
      });
    }
  }
  return results.sort((a, b) => b.occurrences - a.occurrences);
}

// GET /api/finance/subscriptions
router.get('/subscriptions', (req, res) => {
  res.json({ subscriptions: detectSubscriptions(memory.getExpenses()) });
});

// ---------------------------------------------------------------------
// 76. Prognoza "ile zostanie do wyplaty"
// ---------------------------------------------------------------------

router.get('/salary', (req, res) => {
  res.json(financeStore.getSalaryConfig());
});

// POST /api/finance/salary { payday: 1-31, monthlyIncome }
router.post('/salary', (req, res) => {
  const payday = Number(req.body?.payday);
  const monthlyIncome = Number(req.body?.monthlyIncome);
  if (!Number.isInteger(payday) || payday < 1 || payday > 31) {
    return res.status(400).json({ error: 'Wymagane pole "payday" (dzien miesiaca, liczba calkowita 1-31).' });
  }
  if (!Number.isFinite(monthlyIncome) || monthlyIncome < 0) {
    return res.status(400).json({ error: 'Wymagane pole "monthlyIncome" (liczba >= 0).' });
  }
  res.json(financeStore.setSalaryConfig(payday, monthlyIncome));
});

// Poczatek biezacego "okresu wyplaty": od ostatniej wyplaty do teraz. Jesli
// dzien wyplaty w tym miesiacu jeszcze nie nadszedl, okres liczy sie od
// wyplaty w miesiacu poprzednim.
function currentPayPeriodStart(payday) {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), payday);
  if (start.getTime() > now.getTime()) {
    start = new Date(now.getFullYear(), now.getMonth() - 1, payday);
  }
  return start;
}

function nextPaydayFrom(payday) {
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), payday);
  if (next.getTime() <= now.getTime()) {
    next = new Date(now.getFullYear(), now.getMonth() + 1, payday);
  }
  return next;
}

// GET /api/finance/forecast
router.get('/forecast', (req, res) => {
  const { payday, monthlyIncome } = financeStore.getSalaryConfig();
  if (!payday || !Number.isFinite(monthlyIncome)) {
    return res.status(400).json({
      error: 'Najpierw skonfiguruj wyplate: POST /api/finance/salary { payday, monthlyIncome }.',
    });
  }
  const start = currentPayPeriodStart(payday);
  const spent = round2(
    memory
      .getExpenses()
      .filter((e) => e.ts >= start.getTime())
      .reduce((sum, e) => sum + e.amount, 0)
  );
  const remaining = round2(monthlyIncome - spent);
  const next = nextPaydayFrom(payday);
  const daysLeft = Math.max(0, Math.ceil((next.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  res.json({
    payday,
    monthlyIncome,
    periodStart: start.toISOString(),
    nextPayday: next.toISOString(),
    daysLeft,
    spentSoFar: spent,
    remaining,
    dailyBudgetLeft: daysLeft > 0 ? round2(remaining / daysLeft) : remaining,
  });
});

// ---------------------------------------------------------------------
// 77. Porownanie wydatkow miesiac do miesiaca
// ---------------------------------------------------------------------

// GET /api/finance/compare/monthly
router.get('/compare/monthly', (req, res) => {
  const now = new Date();
  const startCurrent = startOfMonth(now.getFullYear(), now.getMonth());
  const startPrev = startOfMonth(now.getFullYear(), now.getMonth() - 1);
  const currentByCat = {};
  const prevByCat = {};
  for (const e of memory.getExpenses()) {
    if (e.ts >= startCurrent) {
      currentByCat[e.category] = round2((currentByCat[e.category] || 0) + e.amount);
    } else if (e.ts >= startPrev && e.ts < startCurrent) {
      prevByCat[e.category] = round2((prevByCat[e.category] || 0) + e.amount);
    }
  }
  const categories = new Set([...Object.keys(currentByCat), ...Object.keys(prevByCat)]);
  const comparison = [...categories]
    .map((category) => {
      const current = currentByCat[category] || 0;
      const previous = prevByCat[category] || 0;
      return {
        category,
        current,
        previous,
        delta: round2(current - previous),
        deltaPct: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.current - a.current);
  res.json({ currentMonth: monthKey(startCurrent), previousMonth: monthKey(startPrev), comparison });
});

// ---------------------------------------------------------------------
// 78. Podzial wydatkow wspolnych (rachunki z partnerem/wspollokatorem)
// ---------------------------------------------------------------------

// POST /api/finance/shared { amount, category?, note?, people }
router.post('/shared', (req, res) => {
  const amount = Number(req.body?.amount);
  const people = Number(req.body?.people) || 2;
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Wymagane pole "amount" (liczba > 0).' });
  }
  if (!Number.isInteger(people) || people < 2) {
    return res.status(400).json({ error: 'Wymagane pole "people" (liczba osob dzielacych rachunek, >= 2).' });
  }
  const entry = financeStore.addSharedExpense(amount, req.body?.category, req.body?.note, people);
  res.json(entry);
});

function withShare(e) {
  const share = round2(e.amount / e.people);
  return { ...e, share, owedToYou: round2(e.amount - share) };
}

// GET /api/finance/shared -> lista + ile Ci sie naleza (nieuregulowane)
router.get('/shared', (req, res) => {
  const items = financeStore.getSharedExpenses().map(withShare);
  const totalOwedToYou = round2(items.filter((e) => !e.settled).reduce((sum, e) => sum + e.owedToYou, 0));
  res.json({ items, totalOwedToYou });
});

// POST /api/finance/shared/:id/settle -> oznacz jako rozliczone
router.post('/shared/:id/settle', (req, res) => {
  const items = financeStore.settleSharedExpense(req.params.id).map(withShare);
  res.json({ items });
});

// ---------------------------------------------------------------------
// 79. Sledzenie oszczednosci / celow finansowych
// ---------------------------------------------------------------------

function withPct(goal) {
  return { ...goal, pct: goal.target > 0 ? Math.round((goal.current / goal.target) * 1000) / 10 : 0 };
}

router.get('/goals', (req, res) => {
  res.json({ goals: financeStore.getGoals().map(withPct) });
});

// POST /api/finance/goals { name, target, current? }
router.post('/goals', (req, res) => {
  const { name, target, current } = req.body || {};
  const targetValue = Number(target);
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Wymagane pole "name".' });
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    return res.status(400).json({ error: 'Wymagane pole "target" (liczba > 0).' });
  }
  res.json(withPct(financeStore.addGoal(name, targetValue, Number(current) || 0)));
});

// PUT /api/finance/goals/:id { current } albo { add } - aktualizacja postepu
router.put('/goals/:id', (req, res) => {
  const goals = financeStore.updateGoalProgress(req.params.id, req.body?.current, req.body?.add);
  res.json({ goals: goals.map(withPct) });
});

router.delete('/goals/:id', (req, res) => {
  const goals = financeStore.removeGoal(req.params.id);
  res.json({ goals: goals.map(withPct) });
});

// ---------------------------------------------------------------------
// 80. Alert przy nietypowej transakcji
// ---------------------------------------------------------------------

// GET /api/finance/anomalies -> wydatek > 3x srednia (tej samej kategorii,
// ostatnie 30 dni) trafia na liste i (raz) na magistrale zdarzen.
router.get('/anomalies', (req, res) => {
  const windowMs = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recent = memory.getExpenses().filter((e) => now - e.ts <= windowMs);
  const byCategory = new Map();
  for (const e of recent) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, []);
    byCategory.get(e.category).push(e);
  }
  const anomalies = [];
  for (const [category, items] of byCategory) {
    if (items.length < 3) continue; // za malo danych na wiarygodna srednia
    for (const e of items) {
      // Srednia liczona z POZOSTALYCH wydatkow tej kategorii, zeby sam
      // nietypowy wydatek nie zawyzal wlasnego punktu odniesienia.
      const others = items.filter((o) => o.id !== e.id);
      const avg = others.reduce((s, o) => s + o.amount, 0) / others.length;
      if (avg > 0 && e.amount > avg * 3) {
        anomalies.push({ id: e.id, category, amount: e.amount, avg: round2(avg), ts: e.ts, note: e.note || null });
        if (!financeStore.wasAnomalyReported(e.id)) {
          financeStore.markAnomalyReported(e.id);
          bus.publish(
            'finance',
            'expense.anomaly',
            `Nietypowy wydatek: ${e.amount.toFixed(2)} zl w kategorii "${category}" (srednio ${avg.toFixed(2)} zl).`,
            { level: 'warn', data: { id: e.id, category, amount: e.amount, avg }, speak: true }
          );
        }
      }
    }
  }
  res.json({ anomalies });
});

export default router;
