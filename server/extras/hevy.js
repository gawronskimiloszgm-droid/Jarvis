// Hevy w module Trening: treningi zapisane w aplikacji Hevy trafiaja do tych samych serii co reszta
// (rekordy, objetosc tygodnia, trener, odprawy), a po kazdym nowym treningu Jarvis opisuje postep:
// rekordy, porownanie z poprzednia sesja cwiczenia i z poprzednim takim samym treningiem.
// Synchronizacja: pierwszy raz ostatnie treningi strona po stronie, potem tylko zmiany (/v1/workouts/events).
import crypto from 'node:crypto';
import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as H from '../connect/hevy.js';
import { registerBriefSection } from '../core/briefing.js';
import { FitKit } from './fitness.js';
import { lifeAdd, lifeList, logJournal, warsawDay } from './life.js';
import { isDnd } from './dnd.js';

const router = express.Router();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const WORK = new Set(['normal', 'failure', 'dropset']);
const KEEP_WORKOUTS = 250;
const INITIAL_PAGES = 25; // 250 ostatnich treningow przy pierwszym polaczeniu
const dayOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(ms));
const fmtKg = (v) => `${Math.round(v * 10) / 10}`.replace('.', ',');
const fmtInt = (v) => Math.round(v).toLocaleString('pl-PL').replace(/ /g, ' ');
const shortDay = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

function state() {
  const d = memory.load();
  if (!d.hevy || typeof d.hevy !== 'object') d.hevy = {};
  const st = d.hevy;
  if (!Array.isArray(st.workouts)) st.workouts = [];
  if (!st.templates || typeof st.templates !== 'object') st.templates = {};
  return st;
}

// ---------- czysta logika (testy w tests/hevy.test.mjs) ----------

/** Najlepsza seria cwiczenia: najwyzszy szacowany 1RM, przy masie ciala najwiecej powtorzen. */
function bestSet(sets) {
  let best = null;
  for (const s of sets) {
    const one = FitKit.oneRepMax(s.kg, s.reps);
    const score = one || s.reps / 1000; // bez ciezaru porownujemy powtorzenia
    if (!best || score > best.score) best = { kg: s.kg, reps: s.reps, one, score };
  }
  return best;
}

/** Trening z Hevy w krotkiej postaci do pamieci: same podsumowania cwiczen (serie ida do kolekcji sets). */
export function compactWorkout(w) {
  const start = Date.parse(w.start_time) || 0;
  const end = Date.parse(w.end_time) || start;
  return {
    id: str(w.id, 40),
    title: str(w.title, 80) || 'Trening',
    routine: str(w.routine_id, 40),
    start,
    end,
    day: dayOf(start || Date.now()),
    ex: (w.exercises || []).map((e) => {
      const work = (e.sets || []).filter((s) => WORK.has(s.type || 'normal'));
      const lifts = work.filter((s) => num(s.reps) > 0).map((s) => ({ kg: Math.max(0, num(s.weight_kg)), reps: Math.round(num(s.reps)) }));
      const b = bestSet(lifts);
      return {
        t: str(e.title, 60),
        tid: str(e.exercise_template_id, 40),
        n: work.length,
        vol: Math.round(lifts.reduce((a, s) => a + s.kg * s.reps, 0)),
        ...(b && { best: [b.kg, b.reps] }),
        // Cardio i cwiczenia na czas: suma metrow i sekund.
        ...(work.some((s) => num(s.distance_meters)) && { m: Math.round(work.reduce((a, s) => a + num(s.distance_meters), 0)) }),
        ...(work.some((s) => num(s.duration_seconds)) && { s: Math.round(work.reduce((a, s) => a + num(s.duration_seconds), 0)) }),
      };
    }),
  };
}

/** Serie robocze treningu do kolekcji sets (rozgrzewkowe pomijamy: psulyby rekordy i objetosc). */
export function workoutSets(w, templates = {}) {
  const start = Date.parse(w.start_time) || Date.now();
  const day = dayOf(start);
  const out = [];
  (w.exercises || []).forEach((e, ei) => {
    const mg = templates[e.exercise_template_id]?.mg || '';
    (e.sets || []).forEach((s, si) => {
      if (!WORK.has(s.type || 'normal') || !(num(s.reps) > 0)) return;
      out.push({ ex: str(e.title, 60), kg: Math.max(0, num(s.weight_kg)), reps: Math.round(num(s.reps)), rpe: num(s.rpe), day, src: 'hevy', wid: str(w.id, 40), mg, at: start + ei * 1000 + si });
    });
  });
  return out;
}

/** Najlepszy 1RM (albo powtorzenia) z kazdej sesji cwiczenia, od najstarszej. */
function sessions(sets, key) {
  const by = new Map();
  for (const s of sets) {
    if (FitKit.exKey(s.ex) !== key) continue;
    const k = s.wid || s.day;
    const cur = by.get(k) || { day: s.day, at: s.at || 0, one: 0, maxKg: 0, reps: 0, vol: 0, sets: 0 };
    if (s.at && s.at < cur.at) cur.at = s.at;
    cur.one = Math.max(cur.one, FitKit.oneRepMax(s.kg, s.reps));
    cur.maxKg = Math.max(cur.maxKg, s.kg);
    cur.reps = Math.max(cur.reps, s.reps);
    cur.vol += s.kg * s.reps;
    cur.sets++;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => (a.day === b.day ? a.at - b.at : a.day < b.day ? -1 : 1));
}

/**
 * Opis treningu: czas, serie, objetosc i zmiana wzgledem poprzedniego takiego samego treningu,
 * rekordy i cwiczenia mocniejsze albo slabsze niz w poprzedniej sesji. history: serie sprzed treningu.
 */
export function describeWorkout(cw, history = [], previous = null) {
  const minutes = Math.max(0, Math.round((cw.end - cw.start) / 60000));
  const sets = cw.ex.reduce((a, e) => a + e.n, 0);
  const volume = cw.ex.reduce((a, e) => a + e.vol, 0);
  const prevVolume = previous ? previous.ex.reduce((a, e) => a + e.vol, 0) : 0;
  const volumeChange = prevVolume > 0 ? Math.round(((volume - prevVolume) / prevVolume) * 100) : null;
  const recs = FitKit.records(history);
  const prs = [];
  const better = [];
  const worse = [];
  const fresh = [];
  for (const e of cw.ex) {
    if (!e.best) continue;
    const key = FitKit.exKey(e.t);
    const r = recs[key];
    const [kg, reps] = e.best;
    if (!r) {
      fresh.push(e.t);
      continue;
    }
    const one = FitKit.oneRepMax(kg, reps);
    if (kg > 0 && (kg > r.maxKg || one > r.best1rm + 0.05)) prs.push({ ex: e.t, kg, reps, was: kg > r.maxKg ? `${fmtKg(r.maxKg)} kg` : `1RM ${fmtKg(r.best1rm)} kg` });
    else if (kg === 0 && reps > r.maxKgReps && r.maxKg === 0) prs.push({ ex: e.t, kg, reps, was: `${r.maxKgReps} powt.` });
    const last = sessions(history, key).pop();
    if (!last) continue;
    if (kg > 0 && last.one > 0) {
      const delta = Math.round((one - last.one) * 10) / 10;
      if (delta >= 1) better.push({ ex: e.t, from: last.one, to: one });
      else if (delta <= -2.5) worse.push({ ex: e.t, from: last.one, to: one });
    } else if (kg === 0 && last.maxKg === 0) {
      if (reps > last.reps) better.push({ ex: e.t, from: last.reps, to: reps, reps: true });
      else if (reps < last.reps - 2) worse.push({ ex: e.t, from: last.reps, to: reps, reps: true });
    }
  }
  const cardio = cw.ex.filter((e) => e.m || (e.s && !e.best)).map((e) => `${e.t}${e.m ? ` ${fmtKg(e.m / 1000)} km` : ''}${e.s ? ` ${Math.round(e.s / 60)} min` : ''}`);
  const bits = [`${cw.title} (${shortDay(cw.day)}${minutes ? `, ${minutes} min` : ''}): ${sets} serii`];
  if (volume) bits[0] += `, ${fmtInt(volume)} kg objętości${volumeChange != null ? ` (${volumeChange > 0 ? '+' : ''}${volumeChange}% względem poprzedniego)` : ''}`;
  const text = [`${bits[0]}.`];
  if (prs.length) text.push(`Rekordy: ${prs.slice(0, 4).map((p) => `${p.ex} ${p.kg ? `${fmtKg(p.kg)} kg × ${p.reps}` : `${p.reps} powt.`} (było ${p.was})`).join(', ')}.`);
  const unPr = better.filter((b) => !prs.some((p) => p.ex === b.ex));
  if (unPr.length) text.push(`Mocniej: ${unPr.slice(0, 4).map((b) => (b.reps ? `${b.ex} ${b.from}→${b.to} powt.` : `${b.ex} 1RM ${fmtKg(b.from)}→${fmtKg(b.to)} kg`)).join(', ')}.`);
  if (worse.length) text.push(`Słabiej: ${worse.slice(0, 3).map((b) => (b.reps ? `${b.ex} ${b.from}→${b.to} powt.` : `${b.ex} 1RM ${fmtKg(b.from)}→${fmtKg(b.to)} kg`)).join(', ')}.`);
  if (fresh.length) text.push(`Nowe ćwiczenia: ${fresh.slice(0, 3).join(', ')}.`);
  if (cardio.length) text.push(`Cardio: ${cardio.slice(0, 3).join(', ')}.`);
  return { id: cw.id, title: cw.title, day: cw.day, minutes, sets, volume, prevVolume, volumeChange, prs, better, worse, fresh, cardio, text: text.join(' ') };
}

// Polskie nazwy, ktorymi mowi sie o cwiczeniach, na slowa w angielskich nazwach z Hevy.
const ALIASES = [
  [/martwy.*rumun|rumunsk|rdl/, /romanian|rdl/],
  [/martwy/, /deadlift/],
  [/wyciskanie.*(nad|stoj|zolnier|barki|siedz)|ohp/, /shoulder press|overhead|military/],
  [/wyciskanie.*skos/, /incline/],
  [/wyciskanie|lawk/, /bench press/],
  [/przysiad/, /squat/],
  [/podciag/, /pull ?up|chin ?up/],
  [/sciaganie|wyciag.*gor/, /pulldown/],
  [/wioslow/, /\brow\b/],
  [/uginanie nog|dwuglow/, /leg curl/],
  [/prostowanie nog|czworoglow/, /leg extension/],
  [/uginanie|biceps|mlotk/, /curl/],
  [/prostowanie ramion|triceps|francusk/, /triceps|pushdown|skull/],
  [/wykrok/, /lunge/],
  [/lydk|wspiecia/, /calf/],
  [/unoszenie bokiem|boczne/, /lateral raise/],
  [/pompk/, /push ?up/],
  [/porecz|dipy/, /\bdip/],
  [/prasa|suwnic|wypychanie/, /leg press/],
  [/hip thrust|unoszenie bioder|mostek/, /hip thrust|glute bridge/],
  [/face pull|przyciaganie liny/, /face pull/],
  [/plank|deska/, /plank/],
];

/** Cwiczenie z historii pasujace do slow uzytkownika (po polsku albo po angielsku). Zwraca klucz. */
export function findExercise(query, sets) {
  const q = FitKit.exKey(query);
  if (!q) return null;
  const count = new Map();
  for (const s of sets) {
    const k = FitKit.exKey(s.ex);
    if (k) count.set(k, (count.get(k) || 0) + 1);
  }
  const words = q.split(' ').filter((w) => w.length > 2);
  const aliases = ALIASES.filter(([pl]) => pl.test(q)).map(([, en]) => en);
  let best = null;
  for (const [k, n] of count) {
    let score = 0;
    if (k === q) score = 100;
    else if (k.includes(q)) score = 60;
    else if (words.length && words.every((w) => k.includes(w))) score = 40;
    else if (aliases.length) {
      // Pierwszy alias jest najbardziej szczegolowy ("martwy rumunski" przed "martwy").
      const i = aliases.findIndex((re) => re.test(k));
      if (i >= 0) score = 30 - i;
    }
    if (score && (!best || score > best.score || (score === best.score && n > best.n))) best = { key: k, score, n };
  }
  return best ? best.key : null;
}

/** Postep cwiczenia w oknie tygodni: pierwsza i ostatnia sesja, najlepszy wynik, punkty do wykresu. */
export function exerciseProgress(sets, query, { weeks = 12, today = warsawDay() } = {}) {
  const key = findExercise(query, sets);
  if (!key) return null;
  const all = sessions(sets, key);
  const from = FitKit.shiftDay(today, -weeks * 7);
  const win = all.filter((s) => s.day >= from);
  const name = sets.find((s) => FitKit.exKey(s.ex) === key)?.ex || query;
  const bodyweight = all.every((s) => s.maxKg === 0);
  const val = (s) => (bodyweight ? s.reps : s.one);
  if (!win.length) return { ex: name, sessions: 0, lastDay: all.length ? all[all.length - 1].day : null, text: `${name}: brak sesji w ostatnich ${weeks} tygodniach${all.length ? ` (ostatnio ${all[all.length - 1].day})` : ''}.` };
  const first = win[0];
  const last = win[win.length - 1];
  const top = win.reduce((a, s) => (val(s) > val(a) ? s : a), win[0]);
  const change = Math.round((val(last) - val(first)) * 10) / 10;
  const pct = val(first) > 0 ? Math.round((change / val(first)) * 100) : null;
  const unit = bodyweight ? ' powt.' : ' kg';
  const text = win.length < 2
    ? `${name}: jedna sesja w ${weeks} tyg. (${last.day}), ${bodyweight ? `${last.reps} powt.` : `1RM ok. ${fmtKg(last.one)} kg`}.`
    : `${name}: ${win.length} sesji w ${weeks} tyg., ${bodyweight ? 'powtórzenia' : 'szacowany 1RM'} ${fmtKg(val(first))} → ${fmtKg(val(last))}${unit} (${change > 0 ? '+' : ''}${fmtKg(change)}${unit}${pct != null ? `, ${pct > 0 ? '+' : ''}${pct}%` : ''}). Najlepiej ${top.day}: ${bodyweight ? `${top.reps} powt.` : `${fmtKg(top.maxKg)} kg, 1RM ${fmtKg(top.one)} kg`}.`;
  return { ex: name, key, bodyweight, sessions: win.length, first: val(first), last: val(last), change, pct, best: { day: top.day, value: val(top), kg: top.maxKg }, points: win.map((s) => [s.day, Math.round(val(s) * 10) / 10]), text };
}

/** Ogolny postep: ostatnie 4 tygodnie wobec 4 wczesniejszych i cwiczenia, ktore urosly najbardziej. */
export function overallProgress(workouts, sets, today = warsawDay()) {
  const a = FitKit.shiftDay(today, -27);
  const b = FitKit.shiftDay(today, -55);
  const now = workouts.filter((w) => w.day >= a && w.day <= today);
  const prev = workouts.filter((w) => w.day >= b && w.day < a);
  const vol = (list) => list.reduce((s, w) => s + w.ex.reduce((x, e) => x + e.vol, 0), 0);
  const mins = (list) => (list.length ? Math.round(list.reduce((s, w) => s + (w.end - w.start) / 60000, 0) / list.length) : 0);
  const keys = [...new Set(sets.filter((s) => s.day >= a).map((s) => FitKit.exKey(s.ex)))];
  const growth = [];
  for (const k of keys) {
    const ss = sessions(sets, k);
    const before = ss.filter((s) => s.day < a && s.day >= b);
    const after = ss.filter((s) => s.day >= a);
    if (!before.length || !after.length) continue;
    const x = Math.max(...before.map((s) => s.one));
    const y = Math.max(...after.map((s) => s.one));
    if (x > 0) growth.push({ ex: sets.find((s) => FitKit.exKey(s.ex) === k).ex, from: x, to: y, pct: Math.round(((y - x) / x) * 100) });
  }
  growth.sort((p, q) => q.pct - p.pct);
  const vNow = vol(now);
  const vPrev = vol(prev);
  const parts = [`Ostatnie 4 tygodnie: ${now.length} treningów (wcześniej ${prev.length}), ${fmtInt(vNow)} kg objętości${vPrev ? ` (${vNow >= vPrev ? '+' : ''}${Math.round(((vNow - vPrev) / vPrev) * 100)}%)` : ''}${now.length ? `, średnio ${mins(now)} min` : ''}.`];
  const up = growth.filter((g) => g.pct > 0);
  const down = growth.filter((g) => g.pct < -3);
  if (up.length) parts.push(`Najbardziej w górę: ${up.slice(0, 3).map((g) => `${g.ex} ${g.pct > 0 ? '+' : ''}${g.pct}%`).join(', ')}.`);
  if (down.length) parts.push(`W dół: ${down.slice(-2).map((g) => `${g.ex} ${g.pct}%`).join(', ')}.`);
  return { workouts: now.length, workoutsBefore: prev.length, volume: vNow, volumeBefore: vPrev, avgMinutes: mins(now), growth, text: parts.join(' ') };
}

// ---------- synchronizacja ----------

function removeWorkout(id) {
  const d = memory.load();
  const st = state();
  st.workouts = st.workouts.filter((w) => w.id !== id);
  if (d.life?.sets) d.life.sets = d.life.sets.filter((s) => s.wid !== id);
}

function addWorkout(w) {
  const st = state();
  removeWorkout(w.id);
  const cw = compactWorkout(w);
  for (const s of workoutSets(w, st.templates)) {
    const item = lifeAdd('sets', s);
    if (item) item.at = s.at; // czas z treningu, nie z chwili importu: rekordy licza sie po kolei
  }
  st.workouts.push(cw);
  return cw;
}

/** Opis treningu z historia sprzed niego i poprzednim treningiem z tej samej rutyny albo o tym samym tytule. */
export function describeStored(cw) {
  const st = state();
  const history = lifeList('sets').filter((s) => s.wid !== cw.id && (s.at || 0) < cw.start);
  const previous = [...st.workouts].filter((w) => w.id !== cw.id && w.start < cw.start && ((cw.routine && w.routine === cw.routine) || w.title === cw.title)).sort((x, y) => y.start - x.start)[0] || null;
  return describeWorkout(cw, history, previous);
}

async function syncTemplates(workouts) {
  const st = state();
  const ids = [...new Set(workouts.flatMap((w) => (w.exercises || []).map((e) => e.exercise_template_id)).filter((id) => id && !st.templates[id]))];
  for (const id of ids.slice(0, 40)) {
    try {
      const t = await H.exerciseTemplate(id);
      st.templates[id] = { t: str(t?.title, 60), mg: FitKit.HEVY_MUSCLE[t?.primary_muscle_group] || 'inne' };
    } catch (e) {
      if (e.status === 404) st.templates[id] = { t: '', mg: '' };
      else break; // limit albo siec: reszta w nastepnej synchronizacji
    }
  }
  // Serie zapisane zanim znalismy szablon dostaja partie teraz.
  const byTitle = new Map(Object.values(st.templates).filter((t) => t.t && t.mg).map((t) => [t.t, t.mg]));
  for (const s of lifeList('sets')) if (s.src === 'hevy' && !s.mg && byTitle.has(s.ex)) s.mg = byTitle.get(s.ex);
}

async function syncBody(initial) {
  const st = state();
  if (!initial && Date.now() - (st.bodyAt || 0) < 6 * 3600000) return 0;
  st.bodyAt = Date.now();
  let added = 0;
  const have = new Set(lifeList('body').map((b) => b.day));
  for (let page = 1; page <= (initial ? 5 : 1); page++) {
    let r;
    try {
      r = await H.bodyPage(page);
    } catch {
      break;
    }
    for (const m of r?.body_measurements || []) {
      if (m.weight_kg > 20 && /^\d{4}-\d{2}-\d{2}$/.test(m.date) && !have.has(m.date) && lifeAdd('body', { kg: m.weight_kg, day: m.date })) {
        have.add(m.date);
        added++;
      }
    }
    if (page >= (r?.page_count || 1)) break;
  }
  return added;
}

let running = null;
let again = false;

/** Synchronizacja z Hevy. notify: opis nowego treningu do dziennika i na telefon. */
export function hevySync({ notify = true } = {}) {
  if (running) {
    // Webhook w trakcie synchronizacji: trening mogl dojsc po pobraniu zmian, wiec jeszcze raz po niej.
    again = true;
    return running;
  }
  running = doSync(notify).finally(() => {
    running = null;
    if (again) {
      again = false;
      hevySync({ notify }).catch(() => {});
    }
  });
  return running;
}

/**
 * Tajny fragment adresu webhooka: Hevy wysyla POST po kazdym zapisanym treningu (ustawienie przy
 * kluczu API). Bez wlasnego sekretu wyprowadzony z klucza Hevy, wiec zmienia sie razem z nim.
 */
export function webhookToken() {
  const base = process.env.HEVY_WEBHOOK_SECRET || process.env.HEVY_API_KEY || '';
  return base ? crypto.createHmac('sha256', base).update('jarvis-hevy-webhook').digest('hex').slice(0, 32) : '';
}
const sameToken = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function doSync(notify) {
  const st = state();
  const startedAt = new Date().toISOString();
  const initial = !st.lastSync;
  const changed = [];
  const deleted = [];
  try {
    if (!st.user) {
      const u = await H.userInfo().catch(() => null);
      if (u) st.user = { name: str(u.name, 60), username: str(u.username, 60), pro: Boolean(u.is_pro), unit: u.weight_unit === 'lbs' ? 'lbs' : 'kg' };
    }
    for (let page = 1; page <= (initial ? INITIAL_PAGES : 30); page++) {
      const r = initial ? await H.workoutsPage(page) : await H.eventsPage(st.lastSync, page);
      if (initial) changed.push(...(r?.workouts || []));
      else for (const ev of r?.events || []) ev.type === 'deleted' ? deleted.push(ev.id) : ev.workout && changed.push(ev.workout);
      if (page >= (r?.page_count || 1)) break;
    }
  } catch (e) {
    st.error = e.message;
    st.errorStatus = e.status || 0;
    st.errorAt = Date.now();
    memory.save(memory.load());
    return { ok: false, error: e.message };
  }
  // Zdarzenia przychodza od najnowszych: pierwsze wystapienie treningu to jego aktualna wersja.
  const latest = new Map();
  for (const w of changed) if (w?.id && !latest.has(w.id)) latest.set(w.id, w);
  for (const id of deleted) if (!latest.has(id)) latest.set(id, null);
  await syncTemplates([...latest.values()].filter(Boolean));
  const known = new Set(st.workouts.map((w) => w.id));
  const added = [];
  let updated = 0;
  let removed = 0;
  const ordered = [...latest.entries()].sort(([, a], [, b]) => (Date.parse(a?.start_time) || 0) - (Date.parse(b?.start_time) || 0));
  for (const [id, w] of ordered) {
    if (!w) {
      if (known.has(id)) removed++;
      removeWorkout(id);
      continue;
    }
    const cw = addWorkout(w);
    if (known.has(id)) updated++;
    else added.push(cw);
  }
  st.workouts.sort((a, b) => a.start - b.start);
  if (st.workouts.length > KEEP_WORKOUTS) st.workouts = st.workouts.slice(-KEEP_WORKOUTS);
  const weights = await syncBody(initial);
  st.lastSync = startedAt;
  st.lastOk = Date.now();
  st.error = '';
  st.errorStatus = 0;
  const notes = [];
  // Po pierwszym polaczeniu nie zasypujemy telefonu historia: opisujemy tylko swieze treningi.
  if (!initial) {
    for (const cw of added.filter((w) => Date.now() - w.end < 48 * 3600000)) {
      const desc = describeStored(cw);
      notes.push(desc.text);
      st.lastDescribed = cw.id;
      if (notify) {
        logJournal('auto', `Hevy: ${desc.text}`, 'trening');
        if (push.isConfigured() && !isDnd()) await push.sendToAll({ title: 'J.A.R.V.I.S. - trening z Hevy', body: desc.text }).catch(() => {});
      }
    }
  }
  memory.save(memory.load());
  return { ok: true, initial, added: added.length, updated, removed, weights, total: st.workouts.length, notes };
}

/** Z petli utrzymania: co 20 minut, po odrzuconym kluczu dopiero po 6 godzinach. */
export async function maybeHevySync(now = Date.now()) {
  if (!H.isConfigured()) return null;
  const st = state();
  if (now - (st.lastTry || 0) < 20 * 60000) return null;
  if ([401, 403].includes(st.errorStatus) && now - (st.errorAt || 0) < 6 * 3600000) return null;
  st.lastTry = now;
  return hevySync();
}

export function hevyStatus() {
  const st = state();
  return {
    configured: H.isConfigured(),
    user: st.user || null,
    lastSync: st.lastSync || null,
    lastOk: st.lastOk || null,
    error: st.error || '',
    workouts: st.workouts.length,
    last: st.workouts.length ? st.workouts[st.workouts.length - 1].day : null,
    webhookPath: H.isConfigured() ? `/api/hevy/webhook/${webhookToken()}` : '',
    webhookAt: st.webhookAt || null,
  };
}

// Wieczorna odprawa: dzisiejszy trening z Hevy, jesli byl.
registerBriefSection(async (kind) => {
  if (kind !== 'evening') return '';
  const st = state();
  const today = warsawDay();
  const w = [...st.workouts].reverse().find((x) => x.day === today);
  if (!w) return '';
  const d = describeStored(w);
  return `Trening w Hevy: ${d.title}, ${d.sets} serii${d.prs.length ? `, rekordy: ${d.prs.slice(0, 2).map((p) => p.ex).join(', ')}` : ''}.`;
});

// ---------- trasy ----------
router.get('/api/hevy/status', requireOwner, (req, res) => res.json(hevyStatus()));
router.post('/api/hevy/sync', requireOwner, async (req, res) => {
  if (!H.isConfigured()) return res.status(400).json({ error: 'Brak HEVY_API_KEY w ustawieniach serwera.' });
  const r = await hevySync();
  res.status(r.ok ? 200 : 502).json(r);
});
// Publiczny (Hevy nie loguje sie do Jarvisa): sprawdza tylko token w adresie i pobiera zmiany przez API,
// tresci zadania nie ufamy. Odpowiedz od razu, Hevy czeka 5 s i ponawia przy bledzie.
router.post('/api/hevy/webhook/:token', (req, res) => {
  const token = webhookToken();
  if (!token || !sameToken(String(req.params.token || ''), token)) return res.status(404).end();
  res.status(200).json({ ok: true });
  state().webhookAt = Date.now();
  setTimeout(() => hevySync().catch((e) => console.error('Hevy webhook:', e.message)), 1500);
});
router.get('/api/hevy/workouts', requireOwner, (req, res) => {
  const n = Math.max(1, Math.min(30, Math.round(num(req.query.limit) || 10)));
  res.json({ workouts: [...state().workouts].reverse().slice(0, n).map((w) => describeStored(w)) });
});
router.get('/api/hevy/progress', requireOwner, (req, res) => {
  const weeks = Math.max(1, Math.min(104, Math.round(num(req.query.weeks) || 12)));
  const sets = lifeList('sets');
  if (req.query.ex) return res.json(exerciseProgress(sets, String(req.query.ex), { weeks }) || { error: 'Nie znam takiego ćwiczenia w historii.' });
  res.json(overallProgress(state().workouts, sets));
});
router.get('/api/hevy/exercises', requireOwner, (req, res) => {
  const count = new Map();
  for (const s of lifeList('sets')) count.set(s.ex, (count.get(s.ex) || 0) + 1);
  res.json({ exercises: [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([ex, n]) => ({ ex, sets: n })) });
});

// ---------- glos ----------
export const HEVY_TOOLS = [
  {
    name: 'hevy_trening',
    description: 'Opis treningu zapisanego w aplikacji Hevy: czas, serie, objetosc, rekordy i co poszlo mocniej lub slabiej niz poprzednio. ktory: 0 = ostatni, 1 = przedostatni itd.',
    parameters: { type: 'object', properties: { ktory: { type: 'number' } } },
  },
  {
    name: 'hevy_postep',
    description: 'Postep na silowni z Hevy i modulu Trening: dla cwiczenia (po polsku lub angielsku) zmiana szacowanego 1RM w ostatnich tygodniach, bez cwiczenia ogolny bilans 4 tygodni.',
    parameters: { type: 'object', properties: { cwiczenie: { type: 'string' }, tygodnie: { type: 'number' } } },
  },
  {
    name: 'hevy_synchronizuj',
    description: 'Pobierz teraz nowe treningi z Hevy (normalnie dzieje sie to samo co 20 minut).',
    parameters: { type: 'object', properties: {} },
  },
];
export const HEVY_VOICE_PROMPT = '- Hevy: hevy_trening (jak mi poszedl trening, ostatni trening), hevy_postep (jak mi idzie wyciskanie, postep), hevy_synchronizuj (gdy mowi, ze wlasnie skonczyl trening w Hevy). Opowiadaj liczbami z wyniku, krotko.';

export async function runHevyTool(name, a = {}) {
  if (name === 'hevy_synchronizuj') {
    if (!H.isConfigured()) return { error: 'Hevy niepodłączone: ustaw HEVY_API_KEY w ustawieniach serwera (klucz z developers.hevy.com/api-key).' };
    const r = await hevySync();
    if (!r.ok) return { error: r.error };
    return { nowe: r.added, zmienione: r.updated, usuniete: r.removed, opis: r.notes[0] || (r.added ? 'zapisane' : 'brak nowych treningów') };
  }
  if (name === 'hevy_trening') {
    const st = state();
    if (!st.workouts.length) return { error: H.isConfigured() ? 'brak treningów z Hevy (jeszcze nie zsynchronizowane?)' : 'Hevy niepodłączone: ustaw HEVY_API_KEY' };
    const i = Math.max(0, Math.min(st.workouts.length - 1, Math.round(num(a.ktory))));
    const d = describeStored(st.workouts[st.workouts.length - 1 - i]);
    return { opis: d.text, dzien: d.day, minut: d.minutes, serii: d.sets, objetosc_kg: d.volume, zmiana_objetosci_proc: d.volumeChange, rekordy: d.prs.map((p) => `${p.ex} ${p.kg} kg × ${p.reps}`) };
  }
  if (name === 'hevy_postep') {
    const sets = lifeList('sets');
    if (a.cwiczenie) {
      const p = exerciseProgress(sets, a.cwiczenie, { weeks: Math.max(1, Math.min(104, Math.round(num(a.tygodnie) || 12))) });
      return p ? { opis: p.text, sesji: p.sessions, zmiana: p.change, zmiana_proc: p.pct } : { error: `nie znam ćwiczenia "${a.cwiczenie}" w historii` };
    }
    const o = overallProgress(state().workouts, sets);
    return { opis: o.text, treningi_4_tyg: o.workouts, wczesniej: o.workoutsBefore };
  }
  return undefined;
}

export default router;
