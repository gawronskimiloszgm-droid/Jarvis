// Hevy w module Trening: treningi zapisane w aplikacji Hevy trafiaja do tych samych serii co reszta
// (rekordy, objetosc tygodnia, trener, odprawy), a po kazdym nowym treningu Jarvis opisuje postep:
// rekordy, porownanie z poprzednia sesja cwiczenia i z poprzednim takim samym treningiem.
// Synchronizacja: pierwszy raz cala historia strona po stronie, potem tylko zmiany (/v1/workouts/events).
// Cala historia siedzi w osobnym archiwum (wlasny klucz w magazynie, zapis tylko po zmianach), a w glownej
// pamieci, zapisywanej przy kazdej drobnej zmianie, tylko ostatnie miesiace. Rekordy, postep i porownania
// licza sie z calego archiwum.
import crypto from 'node:crypto';
import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as H from '../connect/hevy.js';
import { snapshotRead, snapshotWrite } from '../core/store.js';
import { registerBriefSection } from '../core/briefing.js';
import { FitKit, setPlanProvider, setHistoryProvider } from './fitness.js';
import { lifeAdd, lifeList, logJournal, warsawDay } from './life.js';
import { isDnd } from './dnd.js';

const router = express.Router();
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const WORK = new Set(['normal', 'failure', 'dropset']);
const RECENT_DAYS = 120; // tyle dni serii z Hevy w glownej pamieci (trener, tydzien, dzis)
const MAX_PAGES = 1000; // 10 000 treningow: bezpiecznik, nie limit
const MAX_ARCHIVE = 10000;
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
  const span = weeks >= 5200 ? 'całej historii' : `${weeks} tyg.`;
  if (!win.length) return { ex: name, sessions: 0, lastDay: all.length ? all[all.length - 1].day : null, text: `${name}: brak sesji w ${weeks >= 5200 ? 'historii' : `ostatnich ${weeks} tygodniach`}${all.length ? ` (ostatnio ${all[all.length - 1].day})` : ''}.` };
  const first = win[0];
  const last = win[win.length - 1];
  const top = win.reduce((a, s) => (val(s) > val(a) ? s : a), win[0]);
  const change = Math.round((val(last) - val(first)) * 10) / 10;
  const pct = val(first) > 0 ? Math.round((change / val(first)) * 100) : null;
  const unit = bodyweight ? ' powt.' : ' kg';
  const text = win.length < 2
    ? `${name}: jedna sesja w ${span} (${last.day}), ${bodyweight ? `${last.reps} powt.` : `1RM ok. ${fmtKg(last.one)} kg`}.`
    : `${name}: ${win.length} sesji w ${span}, ${bodyweight ? 'powtórzenia' : 'szacowany 1RM'} ${fmtKg(val(first))} → ${fmtKg(val(last))}${unit} (${change > 0 ? '+' : ''}${fmtKg(change)}${unit}${pct != null ? `, ${pct > 0 ? '+' : ''}${pct}%` : ''}). Najlepiej ${top.day}: ${bodyweight ? `${top.reps} powt.` : `${fmtKg(top.maxKg)} kg, 1RM ${fmtKg(top.one)} kg`}.`;
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

// ---------- archiwum calej historii ----------

const ARCHIVE = () => process.env.HEVY_ARCHIVE_NAME || 'hevy-archive';
const TYPE_CODE = { normal: 'n', warmup: 'w', failure: 'f', dropset: 'd' };
const TYPE_NAME = { n: 'normal', w: 'warmup', f: 'failure', d: 'dropset' };
const NUM = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

/** Trening w zwartej postaci archiwum: serie jako tablice [typ, kg, powt, rpe, metry, sekundy]. */
export function packWorkout(w) {
  const start = Date.parse(w.start_time) || 0;
  return {
    i: str(w.id, 40),
    t: str(w.title, 80) || 'Trening',
    ...(w.routine_id && { r: str(w.routine_id, 40) }),
    s: start,
    e: Math.max(start, Date.parse(w.end_time) || start),
    x: (w.exercises || []).map((e) => [str(e.title, 60), str(e.exercise_template_id, 40), (e.sets || []).map((s) => {
      const a = [TYPE_CODE[s.type] || 'n', NUM(s.weight_kg), NUM(s.reps), NUM(s.rpe), NUM(s.distance_meters), NUM(s.duration_seconds)];
      while (a.length > 1 && a[a.length - 1] == null) a.pop();
      return a;
    })]),
  };
}
/** Z powrotem do ksztaltu API Hevy: reszta kodu (opisy, serie) pracuje na nim. */
export function unpackWorkout(p) {
  return {
    id: p.i,
    title: p.t,
    routine_id: p.r || null,
    start_time: new Date(p.s).toISOString(),
    end_time: new Date(p.e).toISOString(),
    exercises: (p.x || []).map(([title, tid, sets], index) => ({
      index, title, exercise_template_id: tid,
      sets: (sets || []).map((a, k) => ({ index: k, type: TYPE_NAME[a[0]] || 'normal', weight_kg: a[1] ?? null, reps: a[2] ?? null, rpe: a[3] ?? null, distance_meters: a[4] ?? null, duration_seconds: a[5] ?? null })),
    })),
  };
}

let archive = null; // Map id -> trening w postaci archiwum
let archiveLoading = null;
let archiveDirty = false;
let derived = null; // { sets, summaries } liczone z archiwum, kasowane przy kazdej zmianie

/** Odczyt archiwum z magazynu. Gdy sie nie uda, nic nie zapisujemy: pusty stan nadpisalby historie. */
export function loadArchive() {
  if (archive) return Promise.resolve(archive);
  if (!archiveLoading) {
    archiveLoading = snapshotRead(ARCHIVE())
      .then((a) => {
        archive = new Map((Array.isArray(a?.workouts) ? a.workouts : []).filter((p) => p?.i).map((p) => [p.i, p]));
        migrateOld();
        return archive;
      })
      .finally(() => (archiveLoading = null));
  }
  return archiveLoading;
}
export const archiveReady = () => Boolean(archive);

/** Testy: zapomnij archiwum w pamieci procesu. */
export function _forgetArchive() {
  archive = null;
  archiveLoading = null;
  archiveDirty = false;
  derived = null;
}

function touch() {
  archiveDirty = true;
  derived = null;
}
function archivePut(w) {
  const p = packWorkout(w);
  if (!p.i || !p.s) return null;
  archive.set(p.i, p);
  touch();
  return p;
}
function archiveDel(id) {
  if (archive.delete(id)) touch();
}

async function saveArchive() {
  if (!archive || !archiveDirty) return;
  const list = [...archive.values()].sort((a, b) => a.s - b.s);
  // Bezpiecznik rozmiaru: najstarsze odpadaja dopiero przy 10 000 treningow.
  for (const old of list.splice(0, Math.max(0, list.length - MAX_ARCHIVE))) archive.delete(old.i);
  await snapshotWrite(ARCHIVE(), { v: 1, savedAt: Date.now(), workouts: list });
  archiveDirty = false;
}

/** Dane z wersji sprzed archiwum (treningi i serie w glownej pamieci) przechodza do archiwum. */
function migrateOld() {
  const st = state();
  const sets = lifeList('sets').filter((s) => s.src === 'hevy' && s.wid);
  for (const cw of st.workouts) {
    if (!cw?.id || archive.has(cw.id)) continue;
    const mine = sets.filter((s) => s.wid === cw.id);
    if (!mine.length && !cw.ex?.length) continue;
    const exercises = [];
    for (const s of mine) {
      let e = exercises.find((x) => x.title === s.ex);
      if (!e) {
        e = { title: s.ex, exercise_template_id: cw.ex?.find((x) => x.t === s.ex)?.tid || '', sets: [] };
        exercises.push(e);
      }
      e.sets.push({ type: 'normal', weight_kg: s.kg, reps: s.reps, rpe: s.rpe || null });
    }
    archivePut({ id: cw.id, title: cw.title, routine_id: cw.routine || null, start_time: new Date(cw.start).toISOString(), end_time: new Date(cw.end).toISOString(), exercises });
  }
}

function derive() {
  if (derived) return derived;
  const st = state();
  const list = [...archive.values()].sort((a, b) => a.s - b.s).map(unpackWorkout);
  derived = { summaries: list.map(compactWorkout), sets: list.flatMap((w) => workoutSets(w, st.templates)) };
  return derived;
}
/** Wszystkie treningi (podsumowania) od najstarszego: z archiwum, a zanim sie wczyta, z pamieci. */
export const allWorkouts = () => (archive ? derive().summaries : state().workouts);
/** Cala historia serii: z Hevy z archiwum plus serie zapisane w Jarvisie. */
export function historySets() {
  if (!archive) return lifeList('sets');
  return [...lifeList('sets').filter((s) => s.src !== 'hevy'), ...derive().sets];
}
setHistoryProvider(() => (archive ? historySets() : null));

/** Glowna pamiec: serie i podsumowania z Hevy tylko z ostatnich miesiecy, odtworzone z archiwum. */
function rebuildRecent() {
  const d = memory.load();
  const st = state();
  const from = FitKit.shiftDay(warsawDay(), -RECENT_DAYS);
  const { summaries, sets } = derive();
  if (d.life?.sets) d.life.sets = d.life.sets.filter((s) => s.src !== 'hevy');
  for (const s of sets) {
    if (s.day < from) continue;
    const item = lifeAdd('sets', s);
    if (item) item.at = s.at; // czas z treningu, nie z chwili importu: rekordy licza sie po kolei
  }
  st.workouts = summaries.filter((w) => w.day >= from);
  st.count = summaries.length;
  st.first = summaries.length ? summaries[0].day : null;
}

// Trening wczytany wczesniej z CSV i ten sam trening z API: zostaje wersja z API (ma rutyne i szablony).
const SAME_START_MS = 3 * 60000;
const fromCsv = (id) => String(id).startsWith('csv-');

function addWorkout(w) {
  if (!fromCsv(w.id)) {
    const start = Date.parse(w.start_time) || 0;
    for (const old of [...archive.values()].filter((x) => fromCsv(x.i) && Math.abs(x.s - start) < SAME_START_MS)) archiveDel(old.i);
  }
  return archivePut(w);
}

/** Opis treningu z historia sprzed niego i poprzednim treningiem z tej samej rutyny albo o tym samym tytule. */
export function describeStored(cw) {
  const history = historySets().filter((s) => s.wid !== cw.id && (s.at || 0) < cw.start);
  const previous = [...allWorkouts()].filter((w) => w.id !== cw.id && w.start < cw.start && ((cw.routine && w.routine === cw.routine) || w.title === cw.title)).sort((x, y) => y.start - x.start)[0] || null;
  return describeWorkout(cw, history, previous);
}
const summaryOf = (id) => allWorkouts().find((w) => w.id === id);

async function syncTemplates(workouts) {
  const st = state();
  const ids = [...new Set(workouts.flatMap((w) => (w.exercises || []).map((e) => e.exercise_template_id)).filter((id) => id && !st.templates[id]))];
  let fetched = 0;
  for (const id of ids.slice(0, 150)) {
    fetched++;
    try {
      const t = await H.exerciseTemplate(id);
      st.templates[id] = { t: str(t?.title, 60), mg: FitKit.HEVY_MUSCLE[t?.primary_muscle_group] || 'inne' };
    } catch (e) {
      if (e.status === 404) st.templates[id] = { t: '', mg: '' };
      else break; // limit albo siec: reszta w nastepnej synchronizacji
    }
  }
  derived = null; // partie z nowych szablonow
  return fetched;
}

async function syncBody(initial) {
  const st = state();
  if (!initial && Date.now() - (st.bodyAt || 0) < 6 * 3600000) return 0;
  st.bodyAt = Date.now();
  let added = 0;
  const have = new Set(lifeList('body').map((b) => b.day));
  for (let page = 1; page <= (initial ? 200 : 1); page++) {
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

/** Rutyna z Hevy w krotkiej postaci: cwiczenia z liczba serii, zakresem powtorzen i ciezarem. */
export function compactRoutine(r) {
  return {
    id: str(r.id, 40),
    title: str(r.title, 80) || 'Rutyna',
    folder: r.folder_id ?? null,
    ex: (r.exercises || []).map((e) => {
      const work = (e.sets || []).filter((s) => (s.type || 'normal') !== 'warmup');
      const rr = work.find((s) => s.rep_range && s.rep_range.start)?.rep_range;
      const reps = rr ? (rr.end && rr.end !== rr.start ? `${rr.start}-${rr.end}` : `${rr.start}`) : work.find((s) => s.reps)?.reps ? `${work.find((s) => s.reps).reps}` : work.find((s) => s.duration_seconds) ? `${Math.round(work.find((s) => s.duration_seconds).duration_seconds)} s` : '';
      return [str(e.title, 60), work.length || (e.sets || []).length, reps];
    }).filter((e) => e[0]),
  };
}

/**
 * Nastepna rutyna: po tej z ostatniego treningu, w tym samym folderze i w kolejnosci z Hevy.
 * Bez treningu z rutyna pierwsza z listy. Zwraca plan w ksztalcie FitKit.planDay albo null.
 */
export function nextRoutine(routines, workouts) {
  if (!routines?.length) return null;
  const byId = new Map(routines.map((r) => [r.id, r]));
  const last = [...(workouts || [])].reverse().find((w) => w.routine && byId.has(w.routine));
  let pick = routines[0];
  if (last) {
    const done = byId.get(last.routine);
    const folder = routines.filter((r) => r.folder === done.folder);
    pick = folder[(folder.indexOf(done) + 1) % folder.length];
  }
  if (!pick.ex.length) return null;
  return { program: 'Hevy', name: pick.title, index: routines.indexOf(pick), ex: pick.ex, hevy: pick.id };
}

async function syncRoutines(initial) {
  const st = state();
  if (!initial && Date.now() - (st.routinesAt || 0) < 6 * 3600000) return;
  st.routinesAt = Date.now();
  const list = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await H.routinesPage(page);
      list.push(...(r?.routines || []).map(compactRoutine));
      if (page >= (r?.page_count || 1)) break;
    }
    st.routines = list.slice(0, 40);
  } catch {
    /* rutyny sa dodatkiem: zostaja poprzednie */
  }
}

// Plan dnia w module Trening, odprawie i "zaczynam trening" bierze sie z rutyn Hevy, gdy sa.
setPlanProvider(() => {
  if (!H.isConfigured()) return null;
  const st = state();
  return nextRoutine(st.routines, st.workouts);
});

// ---------- eksport CSV z aplikacji Hevy (bez Pro: Profil -> Ustawienia -> Eksport danych) ----------

/** Wiersze CSV z polami w cudzyslowach, przecinkami i nowymi liniami w srodku. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const t = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, sty: 0, lut: 1, kwi: 3, maj: 4, cze: 5, lip: 6, sie: 7, wrz: 8, paz: 9, lis: 10, gru: 11 };
/** Czas z eksportu ("28 Feb 2024, 18:09", "Feb 28, 2024 6:09 PM" albo ISO) jako ms; godzina w czasie warszawskim. */
export function parseHevyTime(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return Date.parse(s) || 0;
  const m = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let y;
  let mo;
  let d;
  let a = /(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(am|pm)?/.exec(m);
  if (a) [, d, mo, y] = a;
  else {
    a = /([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(am|pm)?/.exec(m);
    if (!a) {
      const iso = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})/.exec(m);
      if (!iso) return 0;
      a = [null, null, null, iso[1], iso[4], iso[5], null];
      [y, mo, d] = [iso[1], Number(iso[2]) - 1, iso[3]];
    } else [, mo, d, y] = a;
  }
  const month = typeof mo === 'number' ? mo : MONTHS[mo];
  if (month == null) return 0;
  let h = Number(a[4]);
  if (a[6] === 'pm' && h < 12) h += 12;
  if (a[6] === 'am' && h === 12) h = 0;
  // Najpierw jakby to byl UTC, potem przesuniecie o roznice Warszawy w tej chwili (zima +1, lato +2).
  const guess = Date.UTC(Number(y), month, Number(d), h, Number(a[5]));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return guess - (shown - guess);
}

/** Eksport CSV z Hevy -> treningi w ksztalcie API (jeden wiersz to jedna seria). */
export function parseHevyCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Plik jest pusty albo to nie jest eksport z Hevy.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const c = {
    title: col('title', 'workout_name'), start: col('start_time', 'date'), end: col('end_time'), ex: col('exercise_title', 'exercise_name'),
    type: col('set_type'), kg: col('weight_kg'), lbs: col('weight_lbs'), reps: col('reps'), km: col('distance_km'), mi: col('distance_miles'), sec: col('duration_seconds'), rpe: col('rpe'),
  };
  if (c.start < 0 || c.ex < 0) throw new Error('To nie wygląda na eksport treningów z Hevy (brak kolumn start_time i exercise_title).');
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const n = (v) => (v === '' ? null : Number(String(v).replace(',', '.')));
  const byKey = new Map();
  for (const r of rows.slice(1)) {
    const startRaw = cell(r, c.start);
    const start = parseHevyTime(startRaw);
    const exTitle = cell(r, c.ex);
    if (!start || !exTitle) continue;
    const title = cell(r, c.title) || 'Trening';
    const key = `${title}|${startRaw}`;
    if (!byKey.has(key)) {
      const end = parseHevyTime(cell(r, c.end)) || start;
      byKey.set(key, { id: `csv-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`, title, routine_id: null, start_time: new Date(start).toISOString(), end_time: new Date(Math.max(end, start)).toISOString(), exercises: [] });
    }
    const w = byKey.get(key);
    let e = w.exercises.find((x) => x.title === exTitle);
    if (!e) {
      e = { index: w.exercises.length, title: exTitle, exercise_template_id: '', sets: [] };
      w.exercises.push(e);
    }
    const kg = c.kg >= 0 ? n(cell(r, c.kg)) : c.lbs >= 0 && n(cell(r, c.lbs)) != null ? Math.round(n(cell(r, c.lbs)) * 0.45359237 * 10) / 10 : null;
    const meters = c.km >= 0 && n(cell(r, c.km)) != null ? n(cell(r, c.km)) * 1000 : c.mi >= 0 && n(cell(r, c.mi)) != null ? n(cell(r, c.mi)) * 1609.34 : null;
    e.sets.push({ index: e.sets.length, type: cell(r, c.type) || 'normal', weight_kg: kg, reps: n(cell(r, c.reps)), distance_meters: meters, duration_seconds: n(cell(r, c.sec)), rpe: n(cell(r, c.rpe)) });
  }
  return [...byKey.values()].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
}

/** Wczytanie eksportu: nowe treningi dochodza, juz znane (ten sam poczatek) zostaja bez zmian. */
export async function importCsv(text) {
  const list = parseHevyCsv(text);
  if (!list.length) throw new Error('W pliku nie ma treningów.');
  await loadArchive();
  const st = state();
  const starts = [...archive.values()].map((p) => [p.i, p.s]);
  const added = [];
  for (const w of list) {
    const start = Date.parse(w.start_time);
    if (starts.some(([i, s]) => i === w.id || Math.abs(s - start) < SAME_START_MS)) continue;
    if (addWorkout(w)) added.push(w.id);
  }
  st.csvAt = Date.now();
  if (added.length) {
    rebuildRecent();
    await saveArchive();
  }
  // Najnowszy nowy trening z ostatnich 2 dni dostaje opis w dzienniku, jak po synchronizacji.
  const fresh = added.map(summaryOf).filter((w) => w && Date.now() - w.end < 48 * 3600000).pop();
  const desc = fresh ? describeStored(fresh).text : '';
  if (desc) logJournal('auto', `Hevy: ${desc}`, 'trening');
  memory.save(memory.load());
  return { ok: true, inFile: list.length, added: added.length, skipped: list.length - added.length, total: archive.size, opis: desc };
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
  const base = process.env.HEVY_WEBHOOK_SECRET || process.env.HEVY_API_KEY || process.env.HEVY_CLIENT_SECRET || '';
  return base ? crypto.createHmac('sha256', base).update('jarvis-hevy-webhook').digest('hex').slice(0, 32) : '';
}
const sameToken = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function doSync(notify) {
  const st = state();
  const fail = (e) => {
    st.error = e.message;
    st.errorStatus = e.status || 0;
    st.errorAt = Date.now();
    memory.save(memory.load());
    return { ok: false, error: e.message };
  };
  try {
    await loadArchive();
  } catch (e) {
    return fail(new Error(`Nie mogę odczytać archiwum treningów: ${e.message}`));
  }
  const startedAt = new Date().toISOString();
  // Cala historia przy pierwszym polaczeniu, a takze raz po aktualizacji z wersji, ktora brala tylko 250 ostatnich.
  const full = !st.fullHistory;
  const changed = [];
  const deleted = [];
  try {
    if (!st.user) {
      const u = await H.userInfo().catch(() => null);
      if (u) st.user = { name: str(u.name, 60), username: str(u.username, 60), pro: Boolean(u.is_pro), unit: u.weight_unit === 'lbs' ? 'lbs' : 'kg' };
    }
    for (let page = 1; page <= (full ? MAX_PAGES : 30); page++) {
      const r = full ? await H.workoutsPage(page) : await H.eventsPage(st.lastSync, page);
      if (full) changed.push(...(r?.workouts || []));
      else for (const ev of r?.events || []) ev.type === 'deleted' ? deleted.push(ev.id) : ev.workout && changed.push(ev.workout);
      if (page >= (r?.page_count || 1)) break;
    }
  } catch (e) {
    return fail(e);
  }
  // Zdarzenia przychodza od najnowszych: pierwsze wystapienie treningu to jego aktualna wersja.
  const latest = new Map();
  for (const w of changed) if (w?.id && !latest.has(w.id)) latest.set(w.id, w);
  for (const id of deleted) if (!latest.has(id)) latest.set(id, null);
  // Szablony (partie miesni) najpierw dla najnowszych: przy dlugiej historii reszta dojdzie w kolejnych synchronizacjach.
  const newTemplates = await syncTemplates([...latest.values()].filter(Boolean));
  const known = new Set(archive.keys());
  const added = [];
  let updated = 0;
  let removed = 0;
  for (const [id, w] of latest) {
    if (!w) {
      if (known.has(id)) removed++;
      archiveDel(id);
      continue;
    }
    if (!addWorkout(w)) continue;
    if (known.has(id)) updated++;
    else added.push(id);
  }
  if (full) st.fullHistory = true;
  if (archiveDirty || full || newTemplates) rebuildRecent();
  try {
    await saveArchive();
  } catch (e) {
    return fail(new Error(`Nie udało się zapisać archiwum treningów: ${e.message}`));
  }
  const weights = await syncBody(full);
  await syncRoutines(full);
  st.lastSync = startedAt;
  st.lastOk = Date.now();
  st.error = '';
  st.errorStatus = 0;
  const notes = [];
  // Przy pobieraniu calej historii nie zasypujemy telefonu: opisujemy tylko swieze treningi ze zmian.
  if (!full) {
    const fresh = added.map(summaryOf).filter((w) => w && Date.now() - w.end < 48 * 3600000).sort((a, b) => a.start - b.start);
    for (const cw of fresh) {
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
  return { ok: true, initial: full, added: added.length, updated, removed, weights, total: archive.size, notes };
}

/** Z petli utrzymania: co 20 minut, po odrzuconym kluczu dopiero po 6 godzinach. */
export async function maybeHevySync(now = Date.now()) {
  // Archiwum w pamieci procesu tez wtedy, gdy Hevy rozlaczone (np. historia z CSV): rekordy z calej historii.
  if (!archive) await loadArchive().catch(() => {});
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
    mode: H.mode(),
    oauth: H.oauthConfigured(),
    csvAt: st.csvAt || null,
    user: st.user || null,
    lastSync: st.lastSync || null,
    lastOk: st.lastOk || null,
    error: st.error || '',
    workouts: archive ? archive.size : st.count || st.workouts.length,
    first: archive ? allWorkouts()[0]?.day || null : st.first || null,
    last: st.workouts.length ? st.workouts[st.workouts.length - 1].day : null,
    fullHistory: Boolean(st.fullHistory),
    webhookPath: H.isConfigured() && webhookToken() ? `/api/hevy/webhook/${webhookToken()}` : '',
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
  await loadArchive().catch(() => {});
  const d = describeStored(w);
  return `Trening w Hevy: ${d.title}, ${d.sets} serii${d.prs.length ? `, rekordy: ${d.prs.slice(0, 2).map((p) => p.ex).join(', ')}` : ''}.`;
});

// ---------- trasy ----------
function origin(req) {
  const host = req.get('host') || 'localhost';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto.split(',')[0]}://${host}`;
}
const redirectUri = (req) => `${origin(req)}/api/hevy/oauth/callback`;

// Trasy, ktore licza z historii, najpierw wczytuja archiwum (po restarcie serwera jest tylko w magazynie).
const withArchive = (fn) => async (req, res) => {
  await loadArchive().catch(() => {});
  return fn(req, res);
};
router.get('/api/hevy/status', requireOwner, withArchive((req, res) => res.json({ ...hevyStatus(), redirectUri: redirectUri(req) })));
router.get('/api/hevy/auth-url', requireOwner, (req, res) => {
  if (!H.oauthConfigured()) return res.status(400).json({ error: 'Brak HEVY_CLIENT_ID i HEVY_CLIENT_SECRET w ustawieniach serwera.' });
  res.json({ url: H.authUrl(redirectUri(req)), redirectUri: redirectUri(req) });
});
// Hevy przekierowuje tu przegladarke bez naszych naglowkow: bezpieczenstwo daje jednorazowy state
// wydany tylko wlascicielowi przez /api/hevy/auth-url.
router.get('/api/hevy/oauth/callback', async (req, res) => {
  const page = (title, msg) => res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#05090b;color:#cdeef7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px;padding:20px"><h2>${title}</h2><p>${String(msg).replace(/[<>&]/g, '')}</p></div></body>`);
  const { code, state: st, error } = req.query;
  if (error) return page('Hevy', error === 'access_denied' ? 'Odmówiono dostępu.' : `Hevy zwrócił błąd: ${error}`);
  if (!code || !st) return page('Hevy', 'Brak kodu logowania.');
  try {
    await H.exchangeCode(String(code), String(st));
    delete state().user;
    hevySync().catch((e) => console.error('Hevy po polaczeniu:', e.message));
    page('Hevy połączone', 'Możesz zamknąć to okno i wrócić do Jarvisa: treningi właśnie się pobierają.');
  } catch (e) {
    page('Nie udało się połączyć', e.message);
  }
});
router.post('/api/hevy/disconnect', requireOwner, (req, res) => {
  H.disconnect();
  res.json(hevyStatus());
});
router.post('/api/hevy/import', requireOwner, async (req, res) => {
  const csv = String(req.body?.csv || '');
  if (!csv) return res.status(400).json({ error: 'Brak pliku CSV.' });
  try {
    res.json(await importCsv(csv));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
router.post('/api/hevy/sync', requireOwner, async (req, res) => {
  if (!H.isConfigured()) return res.status(400).json({ error: 'Hevy niepołączone: połącz konto w module Trening (panel Hevy) albo wczytaj eksport CSV z aplikacji.' });
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
router.get('/api/hevy/workouts', requireOwner, withArchive((req, res) => {
  const n = Math.max(1, Math.min(30, Math.round(num(req.query.limit) || 10)));
  res.json({ workouts: [...allWorkouts()].reverse().slice(0, n).map((w) => describeStored(w)) });
}));
// tygodnie 0 = cala historia
const weeksOf = (v, d = 12) => (Number(v) === 0 ? 5200 : Math.max(1, Math.min(5200, Math.round(num(v) || d))));
router.get('/api/hevy/progress', requireOwner, withArchive((req, res) => {
  const sets = historySets();
  if (req.query.ex) return res.json(exerciseProgress(sets, String(req.query.ex), { weeks: weeksOf(req.query.weeks) }) || { error: 'Nie znam takiego ćwiczenia w historii.' });
  res.json(overallProgress(allWorkouts(), sets));
}));
router.get('/api/hevy/exercises', requireOwner, withArchive((req, res) => {
  const count = new Map();
  for (const s of historySets()) count.set(s.ex, (count.get(s.ex) || 0) + 1);
  res.json({ exercises: [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([ex, n]) => ({ ex, sets: n })) });
}));

// ---------- glos ----------
export const HEVY_TOOLS = [
  {
    name: 'hevy_trening',
    description: 'Opis treningu zapisanego w aplikacji Hevy: czas, serie, objetosc, rekordy i co poszlo mocniej lub slabiej niz poprzednio. ktory: 0 = ostatni, 1 = przedostatni itd.',
    parameters: { type: 'object', properties: { ktory: { type: 'number' } } },
  },
  {
    name: 'hevy_postep',
    description: 'Postep na silowni z calej historii Hevy i modulu Trening: dla cwiczenia (po polsku lub angielsku) zmiana szacowanego 1RM w ostatnich tygodniach (tygodnie: 0 = od pierwszego treningu), bez cwiczenia ogolny bilans 4 tygodni i bilans calej historii.',
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
    if (!H.isConfigured()) return { error: 'Hevy niepołączone: połącz konto w module Trening (panel Hevy) albo wczytaj eksport CSV z aplikacji.' };
    const r = await hevySync();
    if (!r.ok) return { error: r.error };
    return { nowe: r.added, zmienione: r.updated, usuniete: r.removed, opis: r.notes[0] || (r.added ? 'zapisane' : 'brak nowych treningów') };
  }
  await loadArchive().catch(() => {});
  if (name === 'hevy_trening') {
    const all = allWorkouts();
    if (!all.length) return { error: H.isConfigured() ? 'brak treningów z Hevy (jeszcze nie zsynchronizowane?)' : 'Hevy niepołączone: połącz konto w module Trening (panel Hevy) albo wczytaj eksport CSV z aplikacji.' };
    const i = Math.max(0, Math.min(all.length - 1, Math.round(num(a.ktory))));
    const d = describeStored(all[all.length - 1 - i]);
    return { opis: d.text, dzien: d.day, minut: d.minutes, serii: d.sets, objetosc_kg: d.volume, zmiana_objetosci_proc: d.volumeChange, rekordy: d.prs.map((p) => `${p.ex} ${p.kg} kg × ${p.reps}`) };
  }
  if (name === 'hevy_postep') {
    const sets = historySets();
    if (a.cwiczenie) {
      const p = exerciseProgress(sets, a.cwiczenie, { weeks: weeksOf(a.tygodnie) });
      return p ? { opis: p.text, sesji: p.sessions, zmiana: p.change, zmiana_proc: p.pct, najlepiej: p.best } : { error: `nie znam ćwiczenia "${a.cwiczenie}" w historii` };
    }
    const all = allWorkouts();
    const o = overallProgress(all, sets);
    return { opis: o.text, treningi_4_tyg: o.workouts, wczesniej: o.workoutsBefore, wszystkich_treningow: all.length, pierwszy_trening: all[0]?.day || null };
  }
  return undefined;
}

export default router;
