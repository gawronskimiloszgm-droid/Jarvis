// Zdrowie i dobrostan - jeden wspolny plik dla funkcji, ktore same w sobie
// sa zbyt male na osobne modulki: przypomnienia o wodzie/przerwach, dziennik
// nastroju, leki, sen, oddech, badania okresowe, tryb "focus" i plan
// treningowy. Kazda sekcja ma wlasny wycinek pod data.health.* (ten sam
// wzorzec co data.topics w sentinel.js) i wlasny kawalek Routera.
//
// Integracje ze zdjeciem (#67) i Google Fit (#61) sa CELOWO w osobnych
// plikach (mealVision.js, googleFit.js) - inny ksztalt problemu (obraz,
// OAuth) niz reszta, ktora to zwykle CRUD nad pamiecia.

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import { load, save, addReminder } from './memory.js';
import { requireOwner } from './auth.js';
import { withModel } from './geminiChain.js';
import * as bus from './bus.js';
import * as googleFit from './googleFit.js';

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// --- Wspolny dostep do namespace'u ---
function data() {
  const d = load();
  if (!d.health || typeof d.health !== 'object') {
    d.health = {
      wellness: {
        water: { enabled: false, intervalMin: 60, lastRemindedAt: null },
        screenBreak: { enabled: false, intervalMin: 45, lastRemindedAt: null },
      },
      moods: [],
      medications: [],
      medicationLog: [],
      sleepEntries: [],
      checkups: [],
      focus: { active: false, until: null, reason: null },
      workoutPlan: [],
      workoutLogs: [],
      lastDailyScanAt: null,
    };
  }
  // Uzupelnienie brakujacych pol dla wpisow tworzonych przed dodaniem tej
  // funkcji (np. gdy plik health.js trafi do repo pozniej niz pierwszy zapis).
  const h = d.health;
  if (!h.wellness) h.wellness = { water: { enabled: false, intervalMin: 60, lastRemindedAt: null }, screenBreak: { enabled: false, intervalMin: 45, lastRemindedAt: null } };
  if (!Array.isArray(h.moods)) h.moods = [];
  if (!Array.isArray(h.medications)) h.medications = [];
  if (!Array.isArray(h.medicationLog)) h.medicationLog = [];
  if (!Array.isArray(h.sleepEntries)) h.sleepEntries = [];
  if (!Array.isArray(h.checkups)) h.checkups = [];
  if (!h.focus) h.focus = { active: false, until: null, reason: null };
  if (!Array.isArray(h.workoutPlan)) h.workoutPlan = [];
  if (!Array.isArray(h.workoutLogs)) h.workoutLogs = [];
  return d;
}

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// ============================================================
// #62 - Przypomnienia o piciu wody / przerwach od ekranu
// ============================================================

export function getWellnessConfig() {
  return data().health.wellness;
}

export function setWellnessConfig(patch) {
  const d = data();
  const w = d.health.wellness;
  if (patch?.water) {
    if (typeof patch.water.enabled === 'boolean') w.water.enabled = patch.water.enabled;
    if (Number.isFinite(patch.water.intervalMin)) w.water.intervalMin = Math.max(5, Math.min(480, patch.water.intervalMin));
  }
  if (patch?.screenBreak) {
    if (typeof patch.screenBreak.enabled === 'boolean') w.screenBreak.enabled = patch.screenBreak.enabled;
    if (Number.isFinite(patch.screenBreak.intervalMin)) w.screenBreak.intervalMin = Math.max(5, Math.min(480, patch.screenBreak.intervalMin));
  }
  save(d);
  return w;
}

// Wywolywane cyklicznie przez startHealthScheduler(). Kazde przypomnienie
// idzie przez juz istniejacy memory.addReminder z dueAt=teraz - dostarczy
// je ten sam mechanizm (/api/cron/tick), ktory juz obsluguje reszte
// przypomnien, wiec zero nowej logiki wysylki.
function tickWellness() {
  const d = data();
  const w = d.health.wellness;
  const now = Date.now();

  if (w.water.enabled) {
    const due = !w.water.lastRemindedAt || now - w.water.lastRemindedAt >= w.water.intervalMin * 60_000;
    if (due) {
      addReminder('Czas na szklanke wody.', new Date(now).toISOString());
      w.water.lastRemindedAt = now;
    }
  }
  if (w.screenBreak.enabled) {
    const due = !w.screenBreak.lastRemindedAt || now - w.screenBreak.lastRemindedAt >= w.screenBreak.intervalMin * 60_000;
    if (due) {
      addReminder('Czas na krotka przerwe od ekranu - wstan i rozejrzyj sie w dal.', new Date(now).toISOString());
      w.screenBreak.lastRemindedAt = now;
    }
  }
  save(d);
}

// ============================================================
// #63 - Sledzenie nastroju (dziennik glosowy)
// ============================================================

export function addMoodEntry(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const d = data();
  const entry = { id: nanoid(8), text: clean.slice(0, 500), ts: Date.now() };
  d.health.moods.push(entry);
  save(d);
  return entry;
}

export function getMoodHistory(days = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return data().health.moods.filter((m) => m.ts >= since).sort((a, b) => b.ts - a.ts);
}

// Slowa-wskazniki do bardzo prostej agregacji trendu bez wywolywania modelu
// przy kazdym GET - Gemini uzywamy tylko na wyrazne zadanie (summary=true).
const POSITIVE_WORDS = ['dobrze', 'super', 'swietnie', 'szczesliwy', 'szczesliwa', 'spokojnie', 'zadowolony', 'zadowolona', 'wypoczety', 'wypoczeta', 'energia'];
const NEGATIVE_WORDS = ['zle', 'zmeczony', 'zmeczona', 'stres', 'zestresowany', 'zestresowana', 'smutny', 'smutna', 'zly', 'niewyspany', 'niewyspana', 'przytloczony', 'przytloczona'];

function scoreEntry(text) {
  const low = text.toLowerCase();
  let score = 0;
  for (const w of POSITIVE_WORDS) if (low.includes(w)) score += 1;
  for (const w of NEGATIVE_WORDS) if (low.includes(w)) score -= 1;
  return score;
}

export function moodTrend(days = 7) {
  const entries = getMoodHistory(days);
  const scored = entries.map((e) => ({ ...e, score: scoreEntry(e.text) }));
  const avg = scored.length ? scored.reduce((s, e) => s + e.score, 0) / scored.length : 0;
  return {
    days,
    count: scored.length,
    avgScore: Math.round(avg * 100) / 100,
    trend: avg > 0.3 ? 'poprawa' : avg < -0.3 ? 'pogorszenie' : 'stabilnie',
    entries: scored,
  };
}

export async function moodWeeklySummary() {
  const { entries, count } = moodTrend(7);
  if (!count) return { summary: 'Brak wpisow nastroju z ostatniego tygodnia.' };
  if (!ai) return { summary: 'Brak skonfigurowanego GEMINI_API_KEY - podsumowanie niedostepne, ale historia wpisow jest ponizej.' };
  const lines = entries.map((e) => `- ${new Date(e.ts).toLocaleDateString('pl-PL')}: ${e.text}`).join('\n');
  const prompt = `Oto wpisy dziennika nastroju uzytkownika z ostatniego tygodnia:\n${lines}\n\nNapisz BARDZO krotkie (2-3 zdania) podsumowanie tygodnia po polsku, empatyczne i konkretne, bez moralizowania.`;
  try {
    const res = await withModel((model) => ai.models.generateContent({ model, contents: [{ text: prompt }] }));
    return { summary: String(res.text || '').trim() };
  } catch (err) {
    return { summary: `Nie udalo sie wygenerowac podsumowania (${err.message}).` };
  }
}

// ============================================================
// #64 - Przypomnienia o lekach z potwierdzeniem zazycia
// ============================================================

export function getMedications() {
  return data().health.medications;
}

export function addMedication({ name, times, daysOfWeek }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const cleanTimes = Array.isArray(times) ? times.filter((t) => /^\d{2}:\d{2}$/.test(t)) : [];
  if (!cleanTimes.length) return null;
  const cleanDaysRaw = Array.isArray(daysOfWeek) ? daysOfWeek.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : null;
  const cleanDays = cleanDaysRaw && cleanDaysRaw.length ? cleanDaysRaw : null;
  const d = data();
  const entry = { id: nanoid(8), name: clean.slice(0, 100), times: cleanTimes, daysOfWeek: cleanDays, createdAt: Date.now() };
  d.health.medications.push(entry);
  save(d);
  return entry;
}

export function updateMedication(id, patch) {
  const d = data();
  const med = d.health.medications.find((m) => m.id === id);
  if (!med) return null;
  if (typeof patch?.name === 'string' && patch.name.trim()) med.name = patch.name.trim().slice(0, 100);
  if (Array.isArray(patch?.times)) {
    const cleanTimes = patch.times.filter((t) => /^\d{2}:\d{2}$/.test(t));
    if (cleanTimes.length) med.times = cleanTimes;
  }
  if (patch?.daysOfWeek === null) med.daysOfWeek = null;
  else if (Array.isArray(patch?.daysOfWeek)) {
    const cleanDays = patch.daysOfWeek.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    med.daysOfWeek = cleanDays.length ? cleanDays : null;
  }
  save(d);
  return med;
}

export function removeMedication(id) {
  const d = data();
  d.health.medications = d.health.medications.filter((m) => m.id !== id);
  d.health.medicationLog = d.health.medicationLog.filter((l) => l.medId !== id);
  save(d);
  return d.health.medications;
}

export function confirmDose(medId, { time, status, date } = {}) {
  const d = data();
  const med = d.health.medications.find((m) => m.id === medId);
  if (!med) return null;
  const cleanTime = /^\d{2}:\d{2}$/.test(time) ? time : med.times[0];
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayStr();
  const cleanStatus = status === 'skipped' ? 'skipped' : 'taken';

  // Nadpisujemy istniejacy wpis dla tej samej dawki zamiast dublowac -
  // uzytkownik moze zmienic zdanie ("jednak pominalem") bez czyszczenia historii.
  const existing = d.health.medicationLog.find((l) => l.medId === medId && l.date === cleanDate && l.time === cleanTime);
  if (existing) {
    existing.status = cleanStatus;
    existing.at = Date.now();
  } else {
    d.health.medicationLog.push({ id: nanoid(8), medId, date: cleanDate, time: cleanTime, status: cleanStatus, at: Date.now() });
  }
  save(d);
  bus.publish('health', 'medication.confirmed', `${med.name} (${cleanTime}): ${cleanStatus === 'taken' ? 'zazyto' : 'pominieto'}`, { level: 'info' });
  return { medId, date: cleanDate, time: cleanTime, status: cleanStatus };
}

/** Dzisiejszy status kazdej dawki: zazyte / pominiete / oczekujace. */
export function todayMedicationStatus() {
  const d = data();
  const now = new Date();
  const dow = now.getDay();
  const date = todayStr(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const result = [];
  for (const med of d.health.medications) {
    if (med.daysOfWeek && !med.daysOfWeek.includes(dow)) continue;
    for (const time of med.times) {
      const log = d.health.medicationLog.find((l) => l.medId === med.id && l.date === date && l.time === time);
      let status = 'oczekujaca';
      if (log) status = log.status === 'taken' ? 'zazyta' : 'pominieta';
      else {
        const [h, m] = time.split(':').map(Number);
        if (nowMinutes - (h * 60 + m) > 30) status = 'pominieta';
      }
      result.push({ medId: med.id, name: med.name, time, status });
    }
  }
  return result.sort((a, b) => a.time.localeCompare(b.time));
}

// ============================================================
// #65 - Analiza jakosci snu i sugestie
// ============================================================

const RECOMMENDED_SLEEP_HOURS = [7, 9];

export function addSleepEntry(date, hours) {
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayStr();
  const cleanHours = Number(hours);
  if (!Number.isFinite(cleanHours) || cleanHours <= 0 || cleanHours > 24) return null;
  const d = data();
  const existing = d.health.sleepEntries.find((s) => s.date === cleanDate && s.source === 'manual');
  const entry = { date: cleanDate, hours: Math.round(cleanHours * 10) / 10, source: 'manual', ts: Date.now() };
  if (existing) Object.assign(existing, entry);
  else d.health.sleepEntries.push(entry);
  save(d);
  return entry;
}

export function getSleepHistory(days = 14) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return data()
    .health.sleepEntries.filter((s) => s.ts >= since)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Sen z ostatnich `days` dni: preferuje Google Fit, gdzie brak danych - dopelnia recznymi wpisami. */
async function getMergedSleep(days = 7) {
  const manual = getSleepHistory(days);
  const byDate = new Map(manual.map((s) => [s.date, s]));
  if (googleFit.isConnected()) {
    try {
      const fit = await googleFit.getRecentData(days);
      for (const s of fit.sleepHours) {
        if (s.hours > 0) byDate.set(s.date, { date: s.date, hours: s.hours, source: 'google_fit' });
      }
    } catch {
      /* Fit chwilowo niedostepny - jedziemy na recznych wpisach */
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function sleepAnalysis() {
  const entries = await getMergedSleep(7);
  if (!entries.length) {
    return {
      hasData: false,
      message: googleFit.isConnected()
        ? 'Brak danych o snie z ostatniego tygodnia (ani z Google Fit, ani wpisanych recznie).'
        : 'Brak danych o snie. Google Fit nie jest polaczony - podaj recznie godziny snu przez POST /api/health/sleep, albo polacz Google Fit.',
      entries: [],
    };
  }
  const avg = entries.reduce((s, e) => s + e.hours, 0) / entries.length;
  const [lo, hi] = RECOMMENDED_SLEEP_HOURS;
  const heuristic = avg < lo ? 'za_malo' : avg > hi ? 'za_duzo' : 'w_normie';

  let suggestion = null;
  if (ai) {
    const lines = entries.map((e) => `- ${e.date}: ${e.hours}h (${e.source === 'google_fit' ? 'Google Fit' : 'wpis reczny'})`).join('\n');
    const prompt = `Dane o snie z ostatniego tygodnia:\n${lines}\n\nSrednia: ${avg.toFixed(1)}h. Rekomendacja dla doroslego: ${lo}-${hi}h na dobe.\n\nNapisz BARDZO krotka (2-3 zdania), konkretna sugestie po polsku dotyczaca jakosci snu.`;
    try {
      const res = await withModel((model) => ai.models.generateContent({ model, contents: [{ text: prompt }] }));
      suggestion = String(res.text || '').trim();
    } catch (err) {
      suggestion = `Nie udalo sie wygenerowac sugestii (${err.message}).`;
    }
  }

  return {
    hasData: true,
    avgHours: Math.round(avg * 10) / 10,
    recommendedRange: RECOMMENDED_SLEEP_HOURS,
    heuristic,
    suggestion,
    entries,
  };
}

// ============================================================
// #66 - Coaching oddechowy/medytacyjny na zadanie
// ============================================================

// Wzorce jako sekwencje faz w sekundach - deterministyczne, bez modelu:
// UI ma po prostu odtworzyc czasy, nie interpretowac tekstu.
const BREATHING_PATTERNS = {
  '4-7-8': [
    { phase: 'wdech', seconds: 4 },
    { phase: 'wstrzymanie', seconds: 7 },
    { phase: 'wydech', seconds: 8 },
  ],
  pudelko: [
    { phase: 'wdech', seconds: 4 },
    { phase: 'wstrzymanie', seconds: 4 },
    { phase: 'wydech', seconds: 4 },
    { phase: 'wstrzymanie', seconds: 4 },
  ],
  relaksacyjne: [
    { phase: 'wdech', seconds: 4 },
    { phase: 'wydech', seconds: 6 },
  ],
};

export function breathingExercise(pattern = '4-7-8', reps = 4) {
  const key = BREATHING_PATTERNS[pattern] ? pattern : '4-7-8';
  const cycle = BREATHING_PATTERNS[key];
  const repCount = Math.max(1, Math.min(20, Number(reps) || 4));

  const steps = [];
  let cursor = 0;
  for (let r = 0; r < repCount; r++) {
    for (const phase of cycle) {
      steps.push({ rep: r + 1, phase: phase.phase, seconds: phase.seconds, startAt: cursor });
      cursor += phase.seconds;
    }
  }
  return { pattern: key, reps: repCount, totalSeconds: cursor, availablePatterns: Object.keys(BREATHING_PATTERNS), steps };
}

// ============================================================
// #68 - Badania okresowe / wizyty lekarskie
// ============================================================

export function getCheckups() {
  return data().health.checkups;
}

export function addCheckup({ name, cycleMonths, lastDate }) {
  const clean = String(name || '').trim();
  const cycle = Number(cycleMonths);
  if (!clean || !Number.isFinite(cycle) || cycle <= 0) return null;
  const d = data();
  const entry = {
    id: nanoid(8),
    name: clean.slice(0, 100),
    cycleMonths: Math.round(cycle),
    lastDate: /^\d{4}-\d{2}-\d{2}$/.test(lastDate || '') ? lastDate : null,
    createdAt: Date.now(),
    lastRemindedAt: null,
  };
  d.health.checkups.push(entry);
  save(d);
  return entry;
}

export function updateCheckup(id, patch) {
  const d = data();
  const c = d.health.checkups.find((x) => x.id === id);
  if (!c) return null;
  if (typeof patch?.name === 'string' && patch.name.trim()) c.name = patch.name.trim().slice(0, 100);
  if (Number.isFinite(Number(patch?.cycleMonths)) && Number(patch.cycleMonths) > 0) c.cycleMonths = Math.round(Number(patch.cycleMonths));
  if (/^\d{4}-\d{2}-\d{2}$/.test(patch?.lastDate || '')) c.lastDate = patch.lastDate;
  save(d);
  return c;
}

export function removeCheckup(id) {
  const d = data();
  d.health.checkups = d.health.checkups.filter((c) => c.id !== id);
  save(d);
  return d.health.checkups;
}

function checkupStatusOf(c, now = Date.now()) {
  if (!c.lastDate) {
    return { ...c, nextDueDate: null, dueInDays: null, status: 'brak_danych' };
  }
  const last = new Date(`${c.lastDate}T00:00:00`);
  const next = new Date(last);
  next.setMonth(next.getMonth() + c.cycleMonths);
  const dueInDays = Math.round((next.getTime() - now) / (24 * 60 * 60 * 1000));
  const status = dueInDays < 0 ? 'zalegle' : dueInDays <= 30 ? 'nadchodzace' : 'ok';
  return { ...c, nextDueDate: next.toISOString().slice(0, 10), dueInDays, status };
}

/** Lista badan z policzonym statusem (zalegle/nadchodzace/ok/brak_danych). */
export function checkupsStatus() {
  return getCheckups()
    .map((c) => checkupStatusOf(c))
    .sort((a, b) => (a.dueInDays ?? -Infinity) - (b.dueInDays ?? -Infinity));
}

// Wywolywane raz dziennie przez scheduler: dla zaleglych/nadchodzacych badan,
// ktorym o tym nie przypomniano w ciagu ostatniego tygodnia, tworzy
// przypomnienie przez juz istniejace memory.addReminder.
function scanCheckupsForReminders() {
  const d = data();
  const now = Date.now();
  let changed = false;
  for (const c of d.health.checkups) {
    const withStatus = checkupStatusOf(c, now);
    if (withStatus.status !== 'zalegle' && withStatus.status !== 'nadchodzace') continue;
    if (c.lastRemindedAt && now - c.lastRemindedAt < 7 * 24 * 60 * 60 * 1000) continue;
    const msg =
      withStatus.status === 'zalegle'
        ? `Badanie "${c.name}" jest zalegle (mialo byc co ${c.cycleMonths} mies.) - czas je zaplanowac.`
        : `Zbliza sie termin badania "${c.name}" (za ${withStatus.dueInDays} dni).`;
    addReminder(msg, new Date(now).toISOString());
    c.lastRemindedAt = now;
    changed = true;
  }
  if (changed) save(d);
}

// ============================================================
// #69 - Tryb "focus" blokujacy powiadomienia
// ============================================================

function focusData() {
  const d = data();
  return d.health.focus;
}

export function startFocusMode(minutes, reason) {
  const mins = Math.max(1, Math.min(600, Number(minutes) || 25));
  const d = data();
  d.health.focus = { active: true, until: Date.now() + mins * 60_000, reason: String(reason || '').trim().slice(0, 200) || null };
  save(d);
  bus.publish('health', 'focus.started', `tryb focus na ${mins} min${d.health.focus.reason ? ` (${d.health.focus.reason})` : ''}`, { level: 'info' });
  return d.health.focus;
}

export function stopFocusMode() {
  const d = data();
  d.health.focus = { active: false, until: null, reason: null };
  save(d);
  bus.publish('health', 'focus.stopped', 'tryb focus zakonczony', { level: 'info' });
  return d.health.focus;
}

export function getFocusStatus() {
  const f = focusData();
  if (f.active && f.until && Date.now() >= f.until) {
    // Wygasl sam z siebie - czyscimy przy pierwszym odczycie zamiast czekac
    // na kolejny cykl schedulera.
    return stopFocusMode();
  }
  return f;
}

/**
 * Do uzycia przez server/push.js (NIE edytowany w tym batchu - patrz raport
 * koncowy z instrukcja podlaczenia): true, gdy trwa tryb focus i nalezy
 * wstrzymac wysylke powiadomien push.
 */
export function isFocusModeActive() {
  return Boolean(getFocusStatus().active);
}

// ============================================================
// #70 - Integracja z aplikacja treningowa (plan, postep)
// ============================================================

export function getWorkoutPlan() {
  return data().health.workoutPlan;
}

function cleanExercises(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises
    .map((e) => ({
      name: String(e?.name || '').trim().slice(0, 100),
      sets: Number.isFinite(Number(e?.sets)) ? Math.round(Number(e.sets)) : null,
      reps: Number.isFinite(Number(e?.reps)) ? Math.round(Number(e.reps)) : null,
      weightKg: Number.isFinite(Number(e?.weightKg)) ? Number(e.weightKg) : null,
    }))
    .filter((e) => e.name);
}

export function addWorkoutPlanDay({ day, exercises }) {
  const cleanDay = String(day || '').trim().slice(0, 40);
  const ex = cleanExercises(exercises);
  if (!cleanDay || !ex.length) return null;
  const d = data();
  const entry = { id: nanoid(8), day: cleanDay, exercises: ex, createdAt: Date.now() };
  d.health.workoutPlan.push(entry);
  save(d);
  return entry;
}

export function updateWorkoutPlanDay(id, patch) {
  const d = data();
  const p = d.health.workoutPlan.find((x) => x.id === id);
  if (!p) return null;
  if (typeof patch?.day === 'string' && patch.day.trim()) p.day = patch.day.trim().slice(0, 40);
  if (Array.isArray(patch?.exercises)) {
    const ex = cleanExercises(patch.exercises);
    if (ex.length) p.exercises = ex;
  }
  save(d);
  return p;
}

export function removeWorkoutPlanDay(id) {
  const d = data();
  d.health.workoutPlan = d.health.workoutPlan.filter((p) => p.id !== id);
  save(d);
  return d.health.workoutPlan;
}

export function logWorkout({ day, exercises }) {
  const ex = cleanExercises(exercises);
  if (!ex.length) return null;
  const d = data();
  const entry = { id: nanoid(8), day: String(day || '').trim().slice(0, 40) || null, exercises: ex, ts: Date.now() };
  d.health.workoutLogs.push(entry);
  save(d);
  bus.publish('health', 'workout.logged', `zapisano trening${entry.day ? ` (${entry.day})` : ''}: ${ex.length} cwiczen`, { level: 'ok' });
  return entry;
}

/** Historia logow + prosty postep per cwiczenie (max ciezar/powtorzenia w czasie). */
export function workoutProgress(days = 90) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const logs = data()
    .health.workoutLogs.filter((l) => l.ts >= since)
    .sort((a, b) => a.ts - b.ts);

  const byExercise = {};
  for (const log of logs) {
    for (const ex of log.exercises) {
      if (!byExercise[ex.name]) byExercise[ex.name] = [];
      byExercise[ex.name].push({ date: new Date(log.ts).toISOString().slice(0, 10), sets: ex.sets, reps: ex.reps, weightKg: ex.weightKg });
    }
  }
  return { days, workoutCount: logs.length, logs, byExercise };
}

// ============================================================
// Scheduler
// ============================================================

const TICK_MS = 60_000;
let timer = null;

export function startHealthScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    try {
      tickWellness();
    } catch (err) {
      console.error('Przypomnienia zdrowotne (woda/ekran) nieudane:', err.message);
    }
    try {
      const d = data();
      const now = Date.now();
      // Skan badan okresowych raz na dobe - nie ma sensu czesciej, terminy
      // licza sie w miesiacach.
      if (!d.health.lastDailyScanAt || now - d.health.lastDailyScanAt >= 24 * 60 * 60 * 1000) {
        scanCheckupsForReminders();
        const d2 = data();
        d2.health.lastDailyScanAt = now;
        save(d2);
      }
    } catch (err) {
      console.error('Skan badan okresowych nieudany:', err.message);
    }
  }, TICK_MS);
  if (timer.unref) timer.unref();
}

export function stopHealthScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ============================================================
// Router - eksportowany, NIE montowany tutaj (patrz raport koncowy).
// ============================================================

export const router = express.Router();

// --- Wellness (woda / ekran) ---
router.get('/wellness', requireOwner, (req, res) => res.json(getWellnessConfig()));
router.post('/wellness', requireOwner, (req, res) => res.json(setWellnessConfig(req.body || {})));

// --- Nastroj ---
router.post('/mood', requireOwner, (req, res) => {
  const entry = addMoodEntry(req.body?.text);
  if (!entry) return res.status(400).json({ error: 'Brak tresci wpisu.' });
  res.status(201).json(entry);
});
router.get('/mood', requireOwner, (req, res) => res.json(moodTrend(Number(req.query.days) || 30)));
router.get('/mood/summary', requireOwner, async (req, res) => {
  try {
    res.json(await moodWeeklySummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Leki ---
router.get('/medications', requireOwner, (req, res) => res.json(getMedications()));
router.post('/medications', requireOwner, (req, res) => {
  const entry = addMedication(req.body || {});
  if (!entry) return res.status(400).json({ error: 'Brak nazwy albo poprawnych godzin (format GG:MM).' });
  res.status(201).json(entry);
});
router.put('/medications/:id', requireOwner, (req, res) => {
  const entry = updateMedication(req.params.id, req.body || {});
  if (!entry) return res.status(404).json({ error: 'Nie znaleziono leku.' });
  res.json(entry);
});
router.delete('/medications/:id', requireOwner, (req, res) => res.json(removeMedication(req.params.id)));
router.post('/medications/:id/confirm', requireOwner, (req, res) => {
  const result = confirmDose(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: 'Nie znaleziono leku.' });
  res.json(result);
});
router.get('/medications/today', requireOwner, (req, res) => res.json(todayMedicationStatus()));

// --- Sen ---
router.post('/sleep', requireOwner, (req, res) => {
  const entry = addSleepEntry(req.body?.date, req.body?.hours);
  if (!entry) return res.status(400).json({ error: 'Podaj poprawna liczbe godzin snu (0-24).' });
  res.status(201).json(entry);
});
router.get('/sleep', requireOwner, (req, res) => res.json(getSleepHistory(Number(req.query.days) || 14)));
router.get('/sleep/analysis', requireOwner, async (req, res) => {
  try {
    res.json(await sleepAnalysis());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Oddech ---
router.get('/breathing', requireOwner, (req, res) => {
  res.json(breathingExercise(req.query.pattern, req.query.reps));
});

// --- Badania okresowe ---
router.get('/checkups', requireOwner, (req, res) => res.json(checkupsStatus()));
router.post('/checkups', requireOwner, (req, res) => {
  const entry = addCheckup(req.body || {});
  if (!entry) return res.status(400).json({ error: 'Brak nazwy albo poprawnego cyklu (miesiace > 0).' });
  res.status(201).json(entry);
});
router.put('/checkups/:id', requireOwner, (req, res) => {
  const entry = updateCheckup(req.params.id, req.body || {});
  if (!entry) return res.status(404).json({ error: 'Nie znaleziono badania.' });
  res.json(entry);
});
router.delete('/checkups/:id', requireOwner, (req, res) => res.json(removeCheckup(req.params.id)));

// --- Focus ---
router.post('/focus/start', requireOwner, (req, res) => res.json(startFocusMode(req.body?.minutes, req.body?.reason)));
router.post('/focus/stop', requireOwner, (req, res) => res.json(stopFocusMode()));
router.get('/focus', requireOwner, (req, res) => res.json(getFocusStatus()));

// --- Trening ---
router.get('/workout/plan', requireOwner, (req, res) => res.json(getWorkoutPlan()));
router.post('/workout/plan', requireOwner, (req, res) => {
  const entry = addWorkoutPlanDay(req.body || {});
  if (!entry) return res.status(400).json({ error: 'Brak dnia albo poprawnych cwiczen.' });
  res.status(201).json(entry);
});
router.put('/workout/plan/:id', requireOwner, (req, res) => {
  const entry = updateWorkoutPlanDay(req.params.id, req.body || {});
  if (!entry) return res.status(404).json({ error: 'Nie znaleziono dnia planu.' });
  res.json(entry);
});
router.delete('/workout/plan/:id', requireOwner, (req, res) => res.json(removeWorkoutPlanDay(req.params.id)));
router.post('/workout/log', requireOwner, (req, res) => {
  const entry = logWorkout(req.body || {});
  if (!entry) return res.status(400).json({ error: 'Brak poprawnych cwiczen.' });
  res.status(201).json(entry);
});
router.get('/workout/progress', requireOwner, (req, res) => res.json(workoutProgress(Number(req.query.days) || 90)));
