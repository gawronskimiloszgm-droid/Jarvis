import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const m = { exports: {} };
new Function('module', fs.readFileSync(new URL('../public/extras/fitkit.js', import.meta.url), 'utf8'))(m);
const F = m.exports;

test('1RM: Epley, jedno powtorzenie bez zmian, smieci daja zero', () => {
  assert.equal(F.oneRepMax(100, 10), 133.3);
  assert.equal(F.oneRepMax(140, 1), 140);
  assert.equal(F.oneRepMax(0, 5), 0);
  assert.equal(F.oneRepMax(100, 30), F.oneRepMax(100, 12));
});

test('talerze: na strone, z reszta, ponizej sztangi blad', () => {
  assert.deepEqual(F.plates(100).side, [25, 15]);
  assert.deepEqual(F.plates(62.5).side, [20, 1.25]);
  assert.equal(F.plates(62.5).ok, true);
  const odd = F.plates(101);
  assert.equal(odd.ok, false);
  assert.equal(odd.rest, 1);
  assert.match(F.plates(15).error, /sztanga/);
  assert.deepEqual(F.plates(60, { bar: 20, available: [10] }).side, [10, 10]);
});

test('rozgrzewka rosnie i nie dochodzi do ciezaru roboczego', () => {
  const w = F.warmup(100);
  assert.equal(w[0].kg, 20);
  assert.ok(w.every((s, i) => i === 0 || s.kg > w[i - 1].kg));
  assert.ok(w.every((s) => s.kg < 100 && s.kg % 2.5 === 0));
  assert.deepEqual(F.warmup(20), [{ kg: 20, reps: 10 }]);
});

test('partie miesniowe po nazwie, takze bez polskich znakow', () => {
  assert.equal(F.muscle('Wyciskanie na ławce płaskiej'), 'klatka');
  assert.equal(F.muscle('wyciskanie nad glowe stojac'), 'barki');
  assert.equal(F.muscle('Wyciskanie wąskie'), 'triceps');
  assert.equal(F.muscle('Przysiad'), 'nogi');
  assert.equal(F.muscle('Martwy ciąg'), 'plecy');
  assert.equal(F.muscle('Martwy ciąg rumuński'), 'nogi');
  assert.equal(F.muscle('Uginanie ramion z hantlami'), 'biceps');
  assert.equal(F.muscle('Worek'), 'cardio');
  assert.equal(F.muscle('Coś dziwnego'), 'inne');
});

const S = (ex, kg, reps, day, at = 0) => ({ ex, kg, reps, day, at });

test('rekordy i wykrywanie nowego rekordu', () => {
  const h = [S('Przysiad', 100, 5, '2026-10-01'), S('przysiad ', 110, 3, '2026-10-05')];
  const r = F.records(h)[F.exKey('Przysiad')];
  assert.equal(r.maxKg, 110);
  assert.equal(r.sets, 2);
  assert.deepEqual(F.isRecord(h, S('Przysiad', 115, 1)).kg, true);
  assert.equal(F.isRecord(h, S('Przysiad', 100, 10)).oneRm, true);
  assert.equal(F.isRecord(h, S('Przysiad', 90, 5)).oneRm, false);
  assert.equal(F.isRecord(h, S('Wiosłowanie', 60, 8)).first, true);
});

test('progresja: komplet powtorzen dokłada ciezar, niedobor obniza, inaczej powtorzenia', () => {
  const full = [S('Wyciskanie na ławce', 80, 12, '2026-10-01'), S('Wyciskanie na ławce', 80, 12, '2026-10-01')];
  assert.equal(F.nextLoad(full, 'wyciskanie na lawce').kg, 82.5);
  const legs = [S('Przysiad', 100, 12, '2026-10-01')];
  assert.equal(F.nextLoad(legs, 'Przysiad').kg, 105);
  const weak = [S('Wyciskanie na ławce', 80, 4, '2026-10-02')];
  assert.equal(F.nextLoad(weak, 'Wyciskanie na ławce').kg, 72.5);
  const mid = [S('Wyciskanie na ławce', 80, 9, '2026-10-03'), S('Wyciskanie na ławce', 80, 8, '2026-10-03')];
  assert.deepEqual([F.nextLoad(mid, 'Wyciskanie na ławce').kg, F.nextLoad(mid, 'Wyciskanie na ławce').reps], [80, 10]);
  // Liczy sie ostatnia sesja, nie starsza.
  const two = [S('Wyciskanie na ławce', 70, 12, '2026-09-01'), S('Wyciskanie na ławce', 80, 9, '2026-10-03')];
  assert.equal(F.nextLoad(two, 'Wyciskanie na ławce').kg, 80);
  assert.equal(F.nextLoad([], 'x'), null);
});

test('objetosc tygodnia i dni od partii', () => {
  const sets = [S('Przysiad', 100, 5, '2026-11-03'), S('Przysiad', 100, 5, '2026-11-01'), S('Wyciskanie na ławce', 80, 10, '2026-10-20')];
  const v = F.weekVolume(sets, '2026-11-03');
  assert.deepEqual(v.nogi, { volume: 1000, sets: 2 });
  assert.equal(v.klatka, undefined);
  assert.deepEqual(F.daysSince(sets, '2026-11-03'), { nogi: 0, klatka: 14 });
});

test('seria z mowy', () => {
  assert.deepEqual(F.parseSet('wyciskanie 80 kg na 10'), { ex: 'wyciskanie', kg: 80, reps: 10, sets: 1 });
  assert.deepEqual(F.parseSet('3 serie po 8 przysiad 100kg'), { ex: 'przysiad', kg: 100, reps: 8, sets: 3 });
  assert.deepEqual(F.parseSet('martwy ciąg 140 kilo 5 powtórzeń'), { ex: 'martwy ciąg', kg: 140, reps: 5, sets: 1 });
  assert.deepEqual(F.parseSet('podciąganie 12 razy'), { ex: 'podciąganie', kg: 0, reps: 12, sets: 1 });
  assert.equal(F.parseSet('przysiad'), null);
});

test('plan: kolejne dni w kolko', () => {
  assert.equal(F.planDay('ppl', 0).name, 'Push');
  assert.equal(F.planDay('ppl', 4).name, 'Pull');
  assert.equal(F.planDay('nieznany', 0).name, 'Push');
  assert.equal(F.planDay('fbw', -1).name, 'B');
});

test('rundy: odcinki i czas calkowity', () => {
  const r = F.rounds({ rounds: 3, work: 180, rest: 60, prep: 10 });
  assert.equal(r.odcinki.length, 6);
  assert.equal(r.razem, 10 + 3 * 180 + 2 * 60);
  assert.equal(r.odcinki.at(-1).typ, 'runda');
});

test('zapotrzebowanie, bialko, woda', () => {
  const e = F.energy({ sex: 'm', age: 25, height: 180, weight: 80, activity: 1.55 });
  assert.equal(e.bmr, 1805);
  assert.equal(e.tdee, 2798);
  assert.equal(e.protein, 144);
  assert.equal(F.energy({ sex: 'm', age: 25, height: 180, weight: 80, goal: 'redukcja' }).kcal, 2398);
  assert.equal(F.energy({}), null);
});

test('trend wagi i sen przez polnoc', () => {
  const t = F.weightTrend([{ day: '2026-10-20', kg: 82 }, { day: '2026-10-25', kg: 81.6 }, { day: '2026-10-30', kg: 81 }, { day: '2026-11-02', kg: 80.6 }]);
  assert.equal(t.last, 80.6);
  assert.equal(t.avg7, 80.8);
  assert.equal(t.change, -1);
  assert.equal(F.weightTrend([]), null);
  assert.equal(F.sleepHours('23:30', '07:00'), 7.5);
  assert.equal(F.sleepHours('01:15', '09:00'), 7.75);
  assert.equal(F.sleepHours('zle', '07:00'), 0);
});

test('bilans dnia', () => {
  const meals = [{ day: '2026-11-03', kcal: 600, protein: 40 }, { day: '2026-11-03', kcal: 800, protein: 50 }, { day: '2026-11-02', kcal: 999 }];
  assert.deepEqual(F.dayIntake(meals, '2026-11-03', { kcal: 2500, protein: 150 }), { kcal: 1400, protein: 90, meals: 2, kcalLeft: 1100, proteinLeft: 60 });
});

test('zaniedbane partie: od tygodnia do miesiaca, bez cardio', () => {
  const sets = [S('Przysiad', 100, 5, '2026-11-01'), S('Wyciskanie na ławce', 80, 8, '2026-11-12'), S('Podciąganie', 0, 8, '2026-09-01'), S('Worek', 0, 1, '2026-10-01')];
  assert.deepEqual(F.neglected(sets, '2026-11-13'), [{ part: 'nogi', days: 12 }]);
});

test('raport tygodnia: rekordy tylko z tego tygodnia', () => {
  const sets = [
    { ...S('Przysiad', 100, 5, '2026-10-01'), at: 1 },
    { ...S('Przysiad', 105, 5, '2026-11-10'), at: 2 },
    { ...S('Przysiad', 100, 5, '2026-11-12'), at: 3 },
    { ...S('Wyciskanie', 60, 10, '2026-11-12'), at: 4 },
  ];
  const r = F.weekReport({ sets, body: [{ day: '2026-11-01', kg: 82 }, { day: '2026-11-12', kg: 81 }], sleep: [{ day: '2026-11-12', hours: 7 }, { day: '2026-11-11', hours: 6 }] }, '2026-11-13');
  assert.deepEqual(r.prs, ['Przysiad 105 kg × 5']);
  assert.equal(r.days, 2);
  assert.equal(r.sets, 3);
  assert.equal(r.volume, 525 + 500 + 600);
  assert.equal(r.sleepAvg, 6.5);
});
