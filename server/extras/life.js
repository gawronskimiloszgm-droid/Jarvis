// "Zycie": jedno uniwersalne API na kolekcje osobiste - zakupy, nawyki, cele, tablica
// kanban, dziennik, zakladki, fiszki, szybkie notatki, wdziecznosc, odliczania, urodziny,
// przypomnienia cykliczne - plus dzienny rekord (woda, nastroj). Kazda kolekcja ma wlasny
// walidator, limity i znane pola; nic spoza listy nie trafia do pamieci.

import express from 'express';
import { nanoid } from 'nanoid';
import { GoogleGenAI } from '@google/genai';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import { isDnd } from './dnd.js';

const router = express.Router();

const str = (v, n) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, n);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v) => v === true || v === 'true' || v === 1;
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v) => typeof v === 'string' && DAY.test(v);
const tags = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase().slice(0, 24)).filter(Boolean).slice(0, 8) : []);

// Walidatory: zwracaja obiekt z polami kolekcji albo null. `partial` = aktualizacja (tylko podane pola).
const SCHEMAS = {
  shopping: {
    max: 400,
    make: (b) => (str(b.text, 120) ? { text: str(b.text, 120), cat: str(b.cat, 24) || 'inne', done: false } : null),
    patch: (b) => ({ ...(b.text != null && { text: str(b.text, 120) }), ...(b.cat != null && { cat: str(b.cat, 24) }), ...(b.done != null && { done: bool(b.done) }) }),
  },
  habits: {
    max: 40,
    make: (b) => (str(b.name, 60) ? { name: str(b.name, 60), icon: str(b.icon, 4) || '●', days: [], goal: Math.max(1, Math.min(7, num(b.goal, 7))) } : null),
    patch: (b) => ({
      ...(b.name != null && { name: str(b.name, 60) }),
      ...(b.icon != null && { icon: str(b.icon, 4) }),
      ...(b.goal != null && { goal: Math.max(1, Math.min(7, num(b.goal, 7))) }),
      ...(Array.isArray(b.days) && { days: [...new Set(b.days.filter(isDay))].sort().slice(-400) }),
    }),
  },
  goals: {
    max: 100,
    make: (b) => (str(b.text, 140) ? { text: str(b.text, 140), target: Math.max(1, num(b.target, 100)), progress: 0, unit: str(b.unit, 12) || '%', due: isDay(b.due) ? b.due : '', done: false } : null),
    patch: (b) => ({
      ...(b.text != null && { text: str(b.text, 140) }),
      ...(b.target != null && { target: Math.max(1, num(b.target, 100)) }),
      ...(b.progress != null && { progress: Math.max(0, num(b.progress)) }),
      ...(b.unit != null && { unit: str(b.unit, 12) }),
      ...(b.due != null && { due: isDay(b.due) ? b.due : '' }),
      ...(b.done != null && { done: bool(b.done) }),
    }),
  },
  kanban: {
    max: 300,
    make: (b) => (str(b.text, 160) ? { text: str(b.text, 160), col: oneOf(b.col, ['todo', 'doing', 'done'], 'todo'), note: str(b.note, 400), prio: oneOf(b.prio, ['low', 'mid', 'high'], 'mid') } : null),
    patch: (b) => ({
      ...(b.text != null && { text: str(b.text, 160) }),
      ...(b.col != null && { col: oneOf(b.col, ['todo', 'doing', 'done'], 'todo') }),
      ...(b.note != null && { note: str(b.note, 400) }),
      ...(b.prio != null && { prio: oneOf(b.prio, ['low', 'mid', 'high'], 'mid') }),
    }),
  },
  journal: {
    max: 1500,
    make: (b) => (str(b.text, 600) ? { text: str(b.text, 600), kind: oneOf(b.kind, ['manual', 'auto', 'music', 'action', 'alert', 'note', 'focus'], 'manual'), tag: str(b.tag, 24) } : null),
    patch: (b) => ({ ...(b.text != null && { text: str(b.text, 600) }), ...(b.tag != null && { tag: str(b.tag, 24) }) }),
  },
  bookmarks: {
    max: 300,
    make: (b) => {
      const url = str(b.url, 500);
      if (!/^https?:\/\//i.test(url)) return null;
      return { title: str(b.title, 120) || url.replace(/^https?:\/\//i, '').slice(0, 60), url, tags: tags(b.tags) };
    },
    patch: (b) => ({ ...(b.title != null && { title: str(b.title, 120) }), ...(b.tags != null && { tags: tags(b.tags) }) }),
  },
  flashcards: {
    max: 600,
    make: (b) => (str(b.q, 300) && str(b.a, 500) ? { deck: str(b.deck, 40) || 'ogolne', q: str(b.q, 300), a: str(b.a, 500), box: 1, due: new Date().toISOString().slice(0, 10) } : null),
    patch: (b) => ({
      ...(b.deck != null && { deck: str(b.deck, 40) }),
      ...(b.q != null && { q: str(b.q, 300) }),
      ...(b.a != null && { a: str(b.a, 500) }),
      ...(b.box != null && { box: Math.max(1, Math.min(5, num(b.box, 1))) }),
      ...(b.due != null && isDay(b.due) && { due: b.due }),
    }),
  },
  quicknotes: {
    max: 200,
    make: (b) => (str(b.text, 1200) ? { text: str(b.text, 1200), pinned: false } : null),
    patch: (b) => ({ ...(b.text != null && { text: str(b.text, 1200) }), ...(b.pinned != null && { pinned: bool(b.pinned) }) }),
  },
  gratitude: {
    max: 400,
    make: (b) => (str(b.text, 300) ? { text: str(b.text, 300) } : null),
    patch: (b) => ({ ...(b.text != null && { text: str(b.text, 300) }) }),
  },
  countdowns: {
    max: 60,
    make: (b) => (str(b.name, 80) && isDay(b.date) ? { name: str(b.name, 80), date: b.date } : null),
    patch: (b) => ({ ...(b.name != null && { name: str(b.name, 80) }), ...(isDay(b.date) && { date: b.date }) }),
  },
  birthdays: {
    max: 120,
    make: (b) => (str(b.name, 60) && /^\d{2}-\d{2}$/.test(str(b.date, 5)) ? { name: str(b.name, 60), date: str(b.date, 5) } : null),
    patch: (b) => ({ ...(b.name != null && { name: str(b.name, 60) }), ...(/^\d{2}-\d{2}$/.test(str(b.date, 5)) && { date: str(b.date, 5) }) }),
  },
  recurring: {
    max: 60,
    make: (b) => (str(b.text, 140) ? { text: str(b.text, 140), every: oneOf(b.every, ['daily', 'weekly', 'monthly'], 'daily'), time: /^\d{2}:\d{2}$/.test(str(b.time, 5)) ? str(b.time, 5) : '09:00', dow: Math.max(0, Math.min(6, num(b.dow, 1))), dom: Math.max(1, Math.min(28, num(b.dom, 1))), last: '' } : null),
    patch: (b) => ({
      ...(b.text != null && { text: str(b.text, 140) }),
      ...(b.every != null && { every: oneOf(b.every, ['daily', 'weekly', 'monthly'], 'daily') }),
      ...(b.time != null && /^\d{2}:\d{2}$/.test(str(b.time, 5)) && { time: str(b.time, 5) }),
      ...(b.dow != null && { dow: Math.max(0, Math.min(6, num(b.dow, 1))) }),
      ...(b.dom != null && { dom: Math.max(1, Math.min(28, num(b.dom, 1))) }),
    }),
  },
};

function life() {
  const d = memory.load();
  if (!d.life || typeof d.life !== 'object') d.life = {};
  for (const k of Object.keys(SCHEMAS)) if (!Array.isArray(d.life[k])) d.life[k] = [];
  if (!d.life.daily || typeof d.life.daily !== 'object') d.life.daily = {};
  return d.life;
}
const save = () => memory.save(memory.load());

export function warsawDay(offset = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(Date.now() + offset * 86400000));
}

/** Wpis do dziennika z innych modulow (akcje, muzyka, alarmy...). Nie rzuca bledami. */
export function logJournal(kind, text, tag = '') {
  try {
    const t = str(text, 600);
    if (!t) return;
    const l = life();
    const last = l.journal[0];
    if (last && last.text === t && Date.now() - last.at < 60000) return; // ten sam wpis tuz po sobie
    l.journal.unshift({ id: nanoid(8), at: Date.now(), kind: oneOf(kind, ['manual', 'auto', 'music', 'action', 'alert', 'note', 'focus'], 'auto'), tag: str(tag, 24), text: t });
    if (l.journal.length > SCHEMAS.journal.max) l.journal.length = SCHEMAS.journal.max;
    save();
  } catch {
    /* dziennik jest dodatkiem */
  }
}

// ---------- kolekcje ----------
// Kursy walut (EBC przez frankfurter.app) - przez serwer, bo przegladarka blokuje to CORS-em; cache 6 h.
const fxCache = new Map();
router.get('/api/fx', requireOwner, async (req, res) => {
  const cur = (v) => /^[A-Za-z]{3}$/.test(String(v || '')) ? String(v).toUpperCase() : null;
  const from = cur(req.query.from);
  const to = cur(req.query.to);
  const amount = Number(req.query.amount) || 1;
  if (!from || !to) return res.status(400).json({ error: 'Podaj waluty (np. EUR i PLN).' });
  const key = `${from}>${to}`;
  let hit = fxCache.get(key);
  if (!hit || Date.now() - hit.at > 6 * 3600 * 1000) {
    try {
      const r = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (!r.ok || !j.rates || !j.rates[to]) throw new Error(j.message || 'brak kursu');
      hit = { at: Date.now(), rate: j.rates[to], date: j.date };
      fxCache.set(key, hit);
    } catch (e) {
      if (!hit) return res.status(502).json({ error: `Nie pobrano kursu: ${e.message}` });
    }
  }
  res.json({ from, to, amount, rate: hit.rate, result: Math.round(amount * hit.rate * 10000) / 10000, date: hit.date });
});

router.get('/api/life', requireOwner, (req, res) => {
  const l = life();
  res.json({ ...l, journal: l.journal.slice(0, 200) });
});

router.get('/api/life/export', requireOwner, (req, res) => res.json({ version: 1, at: Date.now(), life: life() }));

router.post('/api/life/import', requireOwner, express.json({ limit: '8mb' }), (req, res) => {
  const src = req.body?.life;
  if (!src || typeof src !== 'object') return res.status(400).json({ error: 'Brak danych do importu.' });
  const l = life();
  let added = 0;
  for (const [k, schema] of Object.entries(SCHEMAS)) {
    if (!Array.isArray(src[k])) continue;
    const have = new Set(l[k].map((x) => x.id));
    for (const item of src[k].slice(0, schema.max)) {
      const clean = schema.make(item || {});
      if (!clean || (item.id && have.has(item.id))) continue;
      const extra = {};
      if (k === 'habits' && Array.isArray(item.days)) extra.days = item.days.filter(isDay).slice(-400);
      if (k === 'goals') Object.assign(extra, schema.patch(item));
      if (k === 'flashcards') Object.assign(extra, schema.patch(item));
      l[k].push({ id: str(item.id, 16) || nanoid(8), at: num(item.at, Date.now()), ...clean, ...extra });
      added++;
    }
    if (l[k].length > schema.max) l[k].length = schema.max;
  }
  if (src.daily && typeof src.daily === 'object') {
    for (const [day, v] of Object.entries(src.daily).slice(-400)) if (isDay(day) && !l.daily[day]) l.daily[day] = { water: Math.max(0, num(v?.water)), mood: Math.max(0, Math.min(5, num(v?.mood))) };
  }
  save();
  res.json({ ok: true, added });
});

function collection(req, res) {
  const name = req.params.coll;
  const schema = SCHEMAS[name];
  if (!schema) {
    res.status(404).json({ error: 'Nieznana kolekcja.' });
    return null;
  }
  return { name, schema, list: life()[name] };
}

router.get('/api/life/:coll', requireOwner, (req, res) => {
  const c = collection(req, res);
  if (c) res.json({ items: c.name === 'journal' ? c.list.slice(0, 400) : c.list });
});

router.post('/api/life/:coll', requireOwner, (req, res, next) => {
  if (req.params.coll === 'summary') return next(); // osobna trasa nizej
  const c = collection(req, res);
  if (!c) return;
  // Hurtowe dodawanie ("mleko, chleb, masło") - kazda pozycja osobno.
  const bodies = Array.isArray(req.body?.items) ? req.body.items.slice(0, 40) : [req.body || {}];
  const created = [];
  for (const b of bodies) {
    const clean = c.schema.make(b || {});
    if (!clean) continue;
    if (c.list.length >= c.schema.max) {
      if (c.name === 'journal') c.list.length = c.schema.max - 1;
      else return res.status(400).json({ error: `Limit ${c.schema.max} pozycji.` });
    }
    const item = { id: nanoid(8), at: Date.now(), ...clean };
    if (c.name === 'journal') c.list.unshift(item);
    else c.list.push(item);
    created.push(item);
  }
  if (!created.length) return res.status(400).json({ error: 'Nieprawidlowe dane.' });
  save();
  res.json({ ok: true, items: created, count: c.list.length });
});

router.patch('/api/life/:coll/:id', requireOwner, (req, res) => {
  const c = collection(req, res);
  if (!c) return;
  const item = c.list.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nie znaleziono.' });
  Object.assign(item, c.schema.patch(req.body || {}));
  save();
  res.json({ ok: true, item });
});

router.delete('/api/life/:coll/:id', requireOwner, (req, res) => {
  const c = collection(req, res);
  if (!c) return;
  const l = life();
  l[c.name] = c.list.filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
});

// Usuniecie wielu naraz (np. "wyczysc kupione").
router.post('/api/life/:coll/clear', requireOwner, (req, res) => {
  const c = collection(req, res);
  if (!c) return;
  const l = life();
  l[c.name] = req.body?.onlyDone ? c.list.filter((x) => !x.done) : [];
  save();
  res.json({ ok: true, left: l[c.name].length });
});

// ---------- rekord dnia: woda, nastroj ----------
router.get('/api/life/daily/:day', requireOwner, (req, res) => {
  const day = isDay(req.params.day) ? req.params.day : warsawDay();
  res.json({ day, ...(life().daily[day] || { water: 0, mood: 0 }) });
});

router.put('/api/life/daily/:day', requireOwner, (req, res) => {
  const day = isDay(req.params.day) ? req.params.day : warsawDay();
  const l = life();
  const cur = l.daily[day] || { water: 0, mood: 0 };
  if (req.body?.water != null) cur.water = Math.max(0, Math.min(40, Math.round(num(req.body.water))));
  if (req.body?.waterDelta != null) cur.water = Math.max(0, Math.min(40, cur.water + Math.round(num(req.body.waterDelta))));
  if (req.body?.mood != null) cur.mood = Math.max(0, Math.min(5, Math.round(num(req.body.mood))));
  l.daily[day] = cur;
  const keys = Object.keys(l.daily).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete l.daily[k];
  save();
  res.json({ day, ...cur });
});

// ---------- podsumowanie dnia (AI) ----------
router.post('/api/life/summary', requireOwner, async (req, res) => {
  const day = isDay(req.body?.day) ? req.body.day : warsawDay();
  const l = life();
  const entries = l.journal.filter((e) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(e.at)) === day).slice(0, 80).reverse();
  const daily = l.daily[day] || { water: 0, mood: 0 };
  const habitsDone = l.habits.filter((h) => h.days.includes(day)).map((h) => h.name);
  const facts = [
    `Dzien: ${day}.`,
    `Woda: ${daily.water} szklanek. Nastroj: ${daily.mood || 'nie podano'}/5.`,
    habitsDone.length ? `Zrobione nawyki: ${habitsDone.join(', ')}.` : 'Zadnych odhaczonych nawykow.',
    ...entries.map((e) => `${new Date(e.at).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })} [${e.kind}] ${e.text}`),
  ];
  const fallback = `${day}: wpisow w dzienniku ${entries.length}, woda ${daily.water}, nawyki ${habitsDone.length}.`;
  if (!process.env.GEMINI_API_KEY || entries.length + habitsDone.length === 0) return res.json({ text: fallback });
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const r = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: `Podsumuj ten dzien uzytkownika w 3-4 zdaniach po polsku, ciepło i konkretnie (co zrobil, jak sie czul, co warto zauwazyc). Nie zmyslaj - uzywaj tylko faktow.\n\n${facts.join('\n')}`,
      })
    );
    res.json({ text: String(r.text || '').trim() || fallback });
  } catch {
    res.json({ text: fallback });
  }
});

// ---------- fiszki generowane przez AI ----------
router.post('/api/life/cards/generate', requireOwner, async (req, res) => {
  const topic = str(req.body?.topic, 160);
  const deck = str(req.body?.deck, 40) || topic.slice(0, 30) || 'ogolne';
  const n = Math.max(3, Math.min(20, Math.round(num(req.body?.n, 8))));
  if (!topic) return res.status(400).json({ error: 'Podaj temat fiszek.' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak klucza AI na serwerze.' });
  try {
    const { Type } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const r = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: `Przygotuj ${n} fiszek do nauki po polsku na temat: ${topic}. Pytania krotkie i konkretne, odpowiedzi zwiezle (1-2 zdania). Tylko sprawdzone fakty.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { q: { type: Type.STRING }, a: { type: Type.STRING } }, required: ['q', 'a'] } },
        },
      })
    );
    const l = life();
    const made = [];
    for (const c of JSON.parse(r.text).slice(0, n)) {
      const clean = SCHEMAS.flashcards.make({ deck, q: c.q, a: c.a });
      if (!clean || l.flashcards.length >= SCHEMAS.flashcards.max) continue;
      const item = { id: nanoid(8), at: Date.now(), ...clean };
      l.flashcards.push(item);
      made.push(item);
    }
    save();
    res.json({ ok: true, deck, items: made });
  } catch (err) {
    console.error('cards generate:', err.message);
    res.status(500).json({ error: 'Nie udalo sie wygenerowac fiszek.' });
  }
});

// ---------- przypomnienia cykliczne ----------
// Wolane z cyklu utrzymania (co kilka minut): jesli nadeszla pora, a dzis jeszcze nie
// przypominalismy - push + wpis do dziennika. Cisza ("nie przeszkadzac") je wstrzymuje.
export async function maybeRecurring() {
  const l = life();
  if (!l.recurring.length) return 0;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', weekday: 'short', day: '2-digit', hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  const nowMin = Number(parts.hour) * 60 + Number(parts.minute);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const today = warsawDay();
  let sent = 0;
  for (const r of l.recurring) {
    if (r.last === today) continue;
    const [h, m] = r.time.split(':').map(Number);
    if (nowMin < h * 60 + m) continue;
    if (r.every === 'weekly' && dow !== r.dow) continue;
    if (r.every === 'monthly' && Number(parts.day) !== r.dom) continue;
    r.last = today;
    sent++;
    if (push.isConfigured() && !isDnd()) await push.sendToAll({ title: 'J.A.R.V.I.S. przypomina', body: r.text }).catch(() => {});
    logJournal('auto', `Przypomnienie cykliczne: ${r.text}`, 'przypomnienie');
  }
  if (sent) save();
  return sent;
}

export default router;
