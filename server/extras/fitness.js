// Trening, cialo i jedzenie: serie, rekordy, progresja, plan, waga, posilki i sen.
// Dane siedza w tych samych kolekcjach co reszta "zycia" (life.js), liczby licza sie w fitkit.js.
import fs from 'node:fs';
import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import { lifeAdd, lifeList, logJournal, warsawDay } from './life.js';

export const FitKit = (() => {
  const mod = { exports: {} };
  new Function('module', fs.readFileSync(new URL('../../public/extras/fitkit.js', import.meta.url), 'utf8'))(mod);
  return mod.exports;
})();

const router = express.Router();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const PROFILE_DEFAULTS = { sex: 'm', age: 0, height: 0, activity: 1.55, goal: 'utrzymanie', program: 'ppl', bar: 20, rest: 120, repMin: 8, repMax: 12, done: 0 };

export function fitProfile(patch) {
  const d = memory.load();
  const cur = { ...PROFILE_DEFAULTS, ...(d.fitProfile || {}) };
  if (patch) {
    if (['m', 'k'].includes(patch.sex)) cur.sex = patch.sex;
    for (const [k, lo, hi] of [['age', 0, 110], ['height', 0, 250], ['activity', 1.2, 2.0], ['bar', 5, 30], ['rest', 15, 600], ['repMin', 1, 30], ['repMax', 1, 50], ['done', 0, 100000]]) {
      if (patch[k] != null && Number.isFinite(Number(patch[k]))) cur[k] = Math.max(lo, Math.min(hi, Number(patch[k])));
    }
    if (['redukcja', 'utrzymanie', 'masa'].includes(patch.goal)) cur.goal = patch.goal;
    if (FitKit.PROGRAMS[patch.program]) cur.program = patch.program;
    if (cur.repMax < cur.repMin) cur.repMax = cur.repMin;
    d.fitProfile = cur;
    memory.save(d);
  }
  return cur;
}

/** Zapis serii (albo kilku jednakowych) i informacja zwrotna: rekord, nastepny ciezar, przerwa. */
export function logSets({ ex, kg, reps, sets = 1, rpe }) {
  const name = String(ex || '').trim().slice(0, 60);
  if (!name || !(Number(reps) > 0)) return { error: 'podaj cwiczenie i liczbe powtorzen' };
  const before = lifeList('sets');
  const record = FitKit.isRecord(before, { ex: name, kg: num(kg), reps: num(reps) });
  const day = warsawDay();
  const n = Math.max(1, Math.min(10, Math.round(num(sets) || 1)));
  const added = [];
  for (let i = 0; i < n; i++) {
    const item = lifeAdd('sets', { ex: name, kg: num(kg), reps: num(reps), rpe: num(rpe), day });
    if (item) added.push(item);
  }
  if (!added.length) return { error: 'nie udalo sie zapisac serii' };
  const profile = fitProfile();
  const pr = !record.first && (record.kg || record.oneRm);
  if (pr) logJournal('auto', `Rekord: ${name} ${num(kg)} kg × ${num(reps)}`, 'trening');
  const today = lifeList('sets').filter((s) => s.day === day && FitKit.exKey(s.ex) === FitKit.exKey(name));
  return {
    ok: true,
    zapisano: `${n} × ${name} ${num(kg)} kg × ${num(reps)}`,
    serii_dzis: today.length,
    rekord: pr ? (record.kg ? `nowy rekord ciezaru (bylo ${record.prevKg} kg)` : `nowy rekord szacowanego 1RM: ${FitKit.oneRepMax(kg, reps)} kg`) : null,
    pierwszy_raz: record.first,
    przerwa_s: profile.rest,
    klient: { action: 'trening-przerwa', params: { sekundy: profile.rest, cwiczenie: name } },
  };
}

/** Wszystko do panelu i do "jak mi idzie" w jednym miejscu. */
export function fitSummary(day = warsawDay()) {
  const sets = lifeList('sets');
  const profile = fitProfile();
  const body = lifeList('body');
  const trend = FitKit.weightTrend(body);
  const weight = trend?.last || 0;
  const energy = FitKit.energy({ ...profile, weight });
  const recs = FitKit.records(sets);
  const sleep = lifeList('sleep').filter((s) => s.day > FitKit.shiftDay(day, -7));
  const todayEx = [...new Set(sets.filter((s) => s.day === day).map((s) => s.ex))];
  const trainingDays = [...new Set(sets.map((s) => s.day))].sort();
  return {
    day,
    profile,
    plan: FitKit.planDay(profile.program, profile.done),
    today: sets.filter((s) => s.day === day),
    suggestions: todayEx.map((ex) => ({ ex, ...FitKit.nextLoad(sets, ex, { min: profile.repMin, max: profile.repMax }) })),
    // Ile zalozyc na kazde cwiczenie z dzisiejszego dnia planu (z historii, a nie z dzisiejszych serii).
    planLoads: Object.fromEntries(FitKit.planDay(profile.program, profile.done).ex.map(([name]) => [name, FitKit.nextLoad(sets, name, { min: profile.repMin, max: profile.repMax })])),
    records: Object.values(recs).sort((a, b) => b.last - a.last).slice(0, 30),
    week: FitKit.weekVolume(sets, day),
    since: FitKit.daysSince(sets, day),
    lastTraining: trainingDays.length ? trainingDays[trainingDays.length - 1] : null,
    trainingDays7: trainingDays.filter((d) => d > FitKit.shiftDay(day, -7)).length,
    weight: trend,
    energy,
    intake: FitKit.dayIntake(lifeList('meals'), day, energy),
    sleep: sleep.length ? { avg: Math.round((sleep.reduce((s, x) => s + x.hours, 0) / sleep.length) * 10) / 10, nights: sleep.length, last: sleep[sleep.length - 1] } : null,
  };
}

router.get('/api/fit/summary', requireOwner, (req, res) => res.json(fitSummary()));
router.get('/api/fit/profile', requireOwner, (req, res) => res.json(fitProfile()));
router.put('/api/fit/profile', requireOwner, (req, res) => res.json(fitProfile(req.body || {})));
router.post('/api/fit/sets', requireOwner, (req, res) => {
  const r = logSets(req.body || {});
  res.status(r.error ? 400 : 200).json(r);
});
// Te same narzedzia co glosem, dla przyciskow w panelu. Seria ma wlasna trase wyzej.
router.post('/api/fit/tool', requireOwner, async (req, res) => {
  const name = String(req.body?.name || '');
  if (!FIT_TOOLS.some((t) => t.name === name) || name === 'seria') return res.status(400).json({ error: 'Nieznane narzedzie.' });
  const r = await runFitTool(name, req.body?.args || {});
  const { klient, ...rest } = r || {};
  res.status(rest.error ? 400 : 200).json(rest);
});
router.post('/api/fit/plan-done', requireOwner, (req, res) => {
  const p = fitProfile();
  res.json(fitProfile({ done: p.done + 1 }));
});
// Historia do eksportu: arkusz z wszystkimi seriami.
router.get('/api/fit/export.csv', requireOwner, (req, res) => {
  const rows = [['data', 'cwiczenie', 'partia', 'kg', 'powtorzenia', 'szacowany_1rm']];
  for (const s of lifeList('sets')) rows.push([s.day, s.ex, FitKit.muscle(s.ex), s.kg, s.reps, FitKit.oneRepMax(s.kg, s.reps)]);
  res.type('text/csv').send(rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'));
});

// ---------- glos ----------
export const FIT_TOOLS = [
  {
    name: 'seria',
    description: 'Zapisz serie na silowni: cwiczenie, ciezar w kg (0 dla masy ciala), powtorzenia i ile takich serii. Np. "wyciskanie 80 na 10", "3 serie przysiadu po 8 ze 100". Zwraca rekord i czas przerwy.',
    parameters: { type: 'object', properties: { cwiczenie: { type: 'string' }, kg: { type: 'number' }, powtorzenia: { type: 'number' }, serie: { type: 'number' } }, required: ['cwiczenie', 'powtorzenia'] },
  },
  {
    name: 'trening_info',
    description: 'Informacje o treningu: co ostatnio robil na danym cwiczeniu i ile zalozyc dzis (cwiczenie podane), albo dzisiejszy plan, rekordy, objetosc tygodnia i dni od partii (bez cwiczenia).',
    parameters: { type: 'object', properties: { cwiczenie: { type: 'string' } } },
  },
  {
    name: 'talerze',
    description: 'Jakie talerze zalozyc na sztange na kazda strone, zeby bylo podane kg; z opcjonalna rozgrzewka.',
    parameters: { type: 'object', properties: { kg: { type: 'number' }, rozgrzewka: { type: 'boolean' } }, required: ['kg'] },
  },
  {
    name: 'rundy',
    description: 'Odliczanie rund (boks, tabata, interwaly) na ekranie z gongiem: liczba rund, sekundy pracy i przerwy.',
    parameters: { type: 'object', properties: { rundy: { type: 'number' }, praca_s: { type: 'number' }, przerwa_s: { type: 'number' } } },
  },
  {
    name: 'masa_ciala',
    description: 'Zapisz dzisiejsza mase ciala w kg (albo odczytaj trend, gdy kg nie podano).',
    parameters: { type: 'object', properties: { kg: { type: 'number' } } },
  },
  {
    name: 'posilek',
    description: 'Zapisz posilek z kaloriami i bialkiem (oszacuj je sam, jesli uzytkownik nie poda). Zwraca bilans dnia.',
    parameters: { type: 'object', properties: { opis: { type: 'string' }, kcal: { type: 'number' }, bialko: { type: 'number' } }, required: ['opis'] },
  },
  {
    name: 'sen',
    description: 'Zapisz sen: godzina zasniecia i pobudki (HH:MM) albo sama liczba godzin, plus opcjonalna ocena 1-5.',
    parameters: { type: 'object', properties: { od: { type: 'string' }, do: { type: 'string' }, godziny: { type: 'number' }, ocena: { type: 'number' } } },
  },
  {
    name: 'bilans_dnia',
    description: 'Kalorie i bialko zjedzone dzis wzgledem celu, sen i trening: krotki bilans.',
    parameters: { type: 'object', properties: {} },
  },
];

export const FIT_VOICE_PROMPT = '- Trening: seria (kazda zrobiona seria, od razu; potem krotko: rekord albo czas przerwy), trening_info (ile zalozyc, co dzis w planie, jak mi idzie), talerze (co na sztange), rundy (odliczanie rund na ekranie), masa_ciala, posilek (oszacuj kcal i bialko sam), sen, bilans_dnia. Nie dawaj porad medycznych.';

export async function runFitTool(name, a = {}) {
  switch (name) {
    case 'seria':
      return logSets({ ex: a.cwiczenie, kg: a.kg, reps: a.powtorzenia, sets: a.serie });
    case 'trening_info': {
      const s = fitSummary();
      const sets = lifeList('sets');
      if (a.cwiczenie) {
        const k = FitKit.exKey(a.cwiczenie);
        const mine = sets.filter((x) => FitKit.exKey(x.ex) === k);
        if (!mine.length) return { cwiczenie: a.cwiczenie, info: 'brak zapisanych serii tego cwiczenia' };
        const lastDay = mine.reduce((d, x) => (x.day > d ? x.day : d), '');
        const r = FitKit.records(sets)[k];
        return { cwiczenie: r.ex, ostatnio: { dzien: lastDay, serie: mine.filter((x) => x.day === lastDay).map((x) => `${x.kg} kg × ${x.reps}`) }, rekord_kg: r.maxKg, najlepszy_1rm: r.best1rm, dzis: FitKit.nextLoad(sets, a.cwiczenie, { min: s.profile.repMin, max: s.profile.repMax }) };
      }
      return {
        plan_na_dzis: `${s.plan.program}: ${s.plan.name} - ${s.plan.ex.map((e) => `${e[0]} ${e[1]}×${e[2]}`).join(', ')}`,
        dni_treningowe_7: s.trainingDays7,
        ostatni_trening: s.lastTraining,
        dni_od_partii: s.since,
        objetosc_tygodnia: Object.fromEntries(Object.entries(s.week).map(([p, v]) => [p, `${v.sets} serii, ${Math.round(v.volume)} kg`])),
        rekordy: s.records.slice(0, 5).map((r) => `${r.ex}: ${r.maxKg} kg × ${r.maxKgReps}`),
      };
    }
    case 'talerze': {
      const p = fitProfile();
      const r = FitKit.plates(a.kg, { bar: p.bar });
      if (r.error) return { error: r.error };
      return { na_strone: r.side.length ? r.side.join(' + ') : 'nic, sama sztanga', sztanga: p.bar, nie_da_sie_dolozyc: r.ok ? 0 : r.rest, ...(a.rozgrzewka && { rozgrzewka: FitKit.warmup(a.kg, p.bar).map((s) => `${s.kg} kg × ${s.reps}`) }) };
    }
    case 'rundy': {
      const params = { rundy: Math.max(1, Math.min(30, Math.round(num(a.rundy) || 3))), praca_s: Math.max(10, Math.min(900, Math.round(num(a.praca_s) || 180))), przerwa_s: Math.max(0, Math.min(600, Math.round(num(a.przerwa_s ?? 60)))) };
      return { ok: true, ...params, klient: { action: 'trening-rundy', params } };
    }
    case 'masa_ciala': {
      if (num(a.kg) > 20 && num(a.kg) < 400) {
        const day = warsawDay();
        const d = memory.load();
        d.life.body = (d.life.body || []).filter((b) => b.day !== day);
        memory.save(d);
        lifeAdd('body', { kg: num(a.kg), day });
      }
      const t = FitKit.weightTrend(lifeList('body'));
      return t ? { ostatnio: t.last, srednia_7_dni: t.avg7, zmiana_tydzien: t.change, pomiarow: t.count } : { info: 'brak pomiarow' };
    }
    case 'posilek': {
      const item = lifeAdd('meals', { text: a.opis, kcal: num(a.kcal), protein: num(a.bialko), day: warsawDay() });
      if (!item) return { error: 'nie udalo sie zapisac' };
      const s = fitSummary();
      return { ok: true, dzis_kcal: s.intake.kcal, dzis_bialko: s.intake.protein, zostalo_kcal: s.intake.kcalLeft, zostalo_bialka: s.intake.proteinLeft, cel_ustawiony: Boolean(s.energy) };
    }
    case 'sen': {
      const hours = a.od && a.do ? FitKit.sleepHours(a.od, a.do) : num(a.godziny);
      if (!(hours > 0 && hours <= 20)) return { error: 'podaj godziny zasniecia i pobudki albo dlugosc snu' };
      lifeAdd('sleep', { hours, from: a.od || '', to: a.do || '', quality: num(a.ocena), day: warsawDay() });
      const s = fitSummary();
      return { ok: true, godzin: hours, srednia_7_dni: s.sleep?.avg };
    }
    case 'bilans_dnia': {
      const s = fitSummary();
      return {
        kcal: s.intake.kcal, bialko: s.intake.protein,
        cel_kcal: s.energy?.kcal ?? 'brak profilu (ustaw wiek, wzrost i wage w module Trening)', cel_bialko: s.energy?.protein ?? null,
        serie_dzis: s.today.length, sen_ostatni: s.sleep?.last?.hours ?? null, waga: s.weight?.last ?? null,
      };
    }
    default:
      return undefined;
  }
}

// ---------- czat: znaczniki ----------
const R = (tag) => new RegExp(`\\[${tag}:\\s*([^\\]]+)\\]`, 'gi');
export const FIT_TAGS = { SERIA: R('SERIA'), WAGA: R('WAGA'), POSILEK: R('POSILEK'), SEN: R('SEN') };
export const FIT_TAG_PROMPT = `- [SERIA: wyciskanie 80 kg na 10] - zapis serii na silowni (mozna "3 serie po 8 przysiad 100 kg").
- [WAGA: 81.4] - dzisiejsza masa ciala w kg; [POSILEK: opis | kcal | bialko] - posilek z oszacowanymi kcal i bialkiem; [SEN: 23:30-07:00] - sen.`;

export function persistFitTags(raw) {
  const each = (re, fn) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(raw))) fn(m[1].trim());
  };
  each(FIT_TAGS.SERIA, (v) => {
    const s = FitKit.parseSet(v);
    if (s) logSets({ ex: s.ex, kg: s.kg, reps: s.reps, sets: s.sets });
  });
  each(FIT_TAGS.WAGA, (v) => runFitTool('masa_ciala', { kg: parseFloat(v.replace(',', '.')) }));
  each(FIT_TAGS.POSILEK, (v) => {
    const [opis, kcal, bialko] = v.split('|').map((x) => x.trim());
    runFitTool('posilek', { opis, kcal: parseFloat(kcal), bialko: parseFloat(bialko) });
  });
  each(FIT_TAGS.SEN, (v) => {
    const m = /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(v);
    if (m) runFitTool('sen', { od: m[1], do: m[2] });
    else runFitTool('sen', { godziny: parseFloat(v.replace(',', '.')) });
  });
}

export default router;
