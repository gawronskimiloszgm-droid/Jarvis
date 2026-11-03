// Trening, cialo i jedzenie: czysta logika bez zaleznosci (testy w tests/fitkit.test.mjs).
// Uzywaja jej modul Trening w przegladarce i narzedzia glosowe na serwerze.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FitKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round = (v, step = 2.5) => Math.round(v / step) * step;
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

  /** Szacowany ciezar na jedno powtorzenie (Epley). Powyzej 12 powtorzen wzor przestaje byc wiarygodny. */
  function oneRepMax(kg, reps) {
    const w = Number(kg);
    const r = Number(reps);
    if (!(w > 0) || !(r > 0)) return 0;
    if (r === 1) return w;
    return Math.round(w * (1 + Math.min(r, 12) / 30) * 10) / 10;
  }

  /** Talerze na jedna strone sztangi. Zwraca liste i to, czego nie da sie dolozyc dostepnymi talerzami. */
  function plates(total, { bar = 20, available = [25, 20, 15, 10, 5, 2.5, 1.25] } = {}) {
    const t = Number(total);
    if (!(t >= bar)) return { side: [], rest: 0, ok: t === bar, error: t < bar ? `Mniej niz sama sztanga (${bar} kg).` : '' };
    let left = Math.round(((t - bar) / 2) * 100) / 100;
    const side = [];
    for (const p of [...available].sort((a, b) => b - a)) {
      while (left >= p - 1e-9) {
        side.push(p);
        left = Math.round((left - p) * 100) / 100;
      }
    }
    return { side, rest: Math.round(left * 2 * 100) / 100, ok: left < 1e-9, error: '' };
  }

  /** Serie rozgrzewkowe do ciezaru roboczego: od pustej sztangi do ok. 85%. */
  function warmup(work, bar = 20) {
    const w = Number(work);
    if (!(w > bar)) return [{ kg: bar, reps: 10 }];
    const steps = [[0, 10], [0.4, 8], [0.6, 5], [0.75, 3], [0.85, 1]];
    const out = [];
    for (const [f, reps] of steps) {
      const kg = f === 0 ? bar : Math.max(bar, round(w * f));
      if (kg >= w) break;
      if (!out.length || kg > out[out.length - 1].kg) out.push({ kg, reps });
    }
    return out;
  }

  // Partie miesniowe po slowach w nazwie cwiczenia (polskie i angielskie).
  const MUSCLES = [
    ['nogi', /przysiad|squat|martwy.*rumun|rdl|wykrok|lunge|prasa|leg press|uginanie nog|prostowanie nog|lydk|calf|hip thrust|wypychanie/],
    ['plecy', /martwy|deadlift|wioslow|row\b|rowing|podciag|pull.?up|chin.?up|sciaganie|lat pull|szrug|shrug|face pull/],
    ['klatka', /wyciskanie.*(lez|lawk|skos|plask)|bench|klatk|rozpietk|fly|pompk|push.?up|dips|porecz/],
    ['barki', /wyciskanie.*(nad|stoj|zolnier|barki|siedz)|overhead|ohp|military|unoszenie bokiem|lateral|arnold/],
    ['biceps', /bicep|uginanie.*(ramion|przedram|hantl|sztang|mlotk)|curl/],
    ['triceps', /tricep|francusk|prostowanie ramion|pushdown|wyciskanie waskie|close.?grip|skull/],
    ['brzuch', /brzuch|plank|deska|crunch|spiecie|allah|unoszenie nog|ab /],
    ['cardio', /bieg|rower|skakank|wioslarz|cardio|worek|tarcza|sparing|boks|run/],
  ];
  function muscle(name) {
    const n = fold(name);
    // Najpierw "wyciskanie" z doprecyzowaniem, potem ogolne: kolejnosc w tabeli o tym decyduje.
    for (const [part, re] of [MUSCLES[3], MUSCLES[5], ...MUSCLES]) if (re.test(n)) return part;
    if (/wyciskanie/.test(n)) return 'klatka';
    return 'inne';
  }

  /** Klucz cwiczenia: "Wyciskanie na ławce" i "wyciskanie na lawce " to to samo. */
  const exKey = (name) => fold(name).replace(/[^a-z0-9]+/g, ' ').trim();

  /** Rekordy na cwiczenie: najwiekszy ciezar i najlepszy szacowany 1RM. */
  function records(sets) {
    const by = {};
    for (const s of sets || []) {
      const k = exKey(s.ex);
      if (!k) continue;
      const one = oneRepMax(s.kg, s.reps);
      const r = by[k] || { ex: s.ex, maxKg: 0, maxKgReps: 0, best1rm: 0, sets: 0, last: 0 };
      if (s.kg > r.maxKg || (s.kg === r.maxKg && s.reps > r.maxKgReps)) {
        r.maxKg = s.kg;
        r.maxKgReps = s.reps;
      }
      r.best1rm = Math.max(r.best1rm, one);
      r.sets++;
      r.last = Math.max(r.last, s.at || 0);
      by[k] = r;
    }
    return by;
  }

  /** Czy nowa seria bije rekord (ciezar albo szacowany 1RM). Liczy wzgledem serii sprzed niej. */
  function isRecord(history, set) {
    const r = records(history)[exKey(set.ex)];
    if (!r) return { first: true, kg: false, oneRm: false };
    const one = oneRepMax(set.kg, set.reps);
    return { first: false, kg: set.kg > r.maxKg, oneRm: one > r.best1rm + 0.05, prevKg: r.maxKg, prev1rm: r.best1rm };
  }

  /**
   * Podpowiedz na nastepny trening (podwojna progresja): gdy w ostatniej sesji wszystkie serie
   * doszly do gornej granicy powtorzen, dokladamy ciezar, inaczej dobijamy powtorzenia.
   */
  function nextLoad(history, ex, { min = 8, max = 12 } = {}) {
    const k = exKey(ex);
    const mine = (history || []).filter((s) => exKey(s.ex) === k);
    if (!mine.length) return null;
    const lastDay = mine.reduce((d, s) => (s.day > d ? s.day : d), '');
    const session = mine.filter((s) => s.day === lastDay);
    const top = Math.max(...session.map((s) => s.kg));
    const work = session.filter((s) => s.kg === top);
    const step = muscle(ex) === 'nogi' || /martwy|deadlift/.test(fold(ex)) ? 5 : top < 20 ? 1 : 2.5;
    if (work.every((s) => s.reps >= max)) return { kg: top + step, reps: min, why: `ostatnio ${work.length}× ${top} kg po ${max}+ powtórzeń, więc dokładamy ${step} kg` };
    if (work.some((s) => s.reps < Math.max(1, min - 3))) return { kg: Math.max(0, round(top * 0.9, step === 1 ? 1 : 2.5)), reps: min, why: `ostatnio za mało powtórzeń przy ${top} kg, więc lżej o ok. 10%` };
    const best = Math.max(...work.map((s) => s.reps));
    return { kg: top, reps: Math.min(max, best + 1), why: `ten sam ciężar, celuj w ${Math.min(max, best + 1)} powtórzeń` };
  }

  /** Tygodniowa objetosc (kg x powtorzenia) i liczba serii na partie z ostatnich 7 dni. */
  function weekVolume(sets, todayKey) {
    const from = shiftDay(todayKey, -6);
    const out = {};
    for (const s of sets || []) {
      if (!s.day || s.day < from || s.day > todayKey) continue;
      const p = muscle(s.ex);
      const v = out[p] || { volume: 0, sets: 0 };
      v.volume += (s.kg || 0) * (s.reps || 0);
      v.sets++;
      out[p] = v;
    }
    return out;
  }

  /** Ile dni minelo od ostatniego treningu danej partii. */
  function daysSince(sets, todayKey) {
    const last = {};
    for (const s of sets || []) {
      const p = muscle(s.ex);
      if (!last[p] || s.day > last[p]) last[p] = s.day;
    }
    const out = {};
    for (const [p, d] of Object.entries(last)) out[p] = dayDiff(d, todayKey);
    return out;
  }

  function shiftDay(key, n) {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

  /** Seria z mowy albo pola tekstowego: "wyciskanie 80 kg na 10", "3 serie po 8 przysiad 100". */
  function parseSet(text) {
    const t = fold(text).replace(/,/g, '.');
    const kg = /(\d+(?:\.\d+)?)\s*(?:kg|kilo\w*)/.exec(t) || /(?:^|\s)(\d+(?:\.\d+)?)\s+(?:na|x|razy)\s+\d/.exec(t);
    const reps = /(?:na|x|razy|po)\s*(\d+)\s*(?:powt\w*|raz\w*)?(?!\s*kg)/.exec(t) || /(\d+)\s*(?:powt\w*|razy)/.exec(t);
    const series = /(\d+)\s*(?:serie|serii|seria|x\s*\d)/.exec(t);
    const name = String(text)
      // \p{L} zamiast \w: inaczej z "powtórzeń" w nazwie zostawalo "órzeń".
      .replace(/\d+(?:[.,]\d+)?\s*(?:kg|kilo\p{L}*)/giu, ' ')
      .replace(/(?<!\p{L})\d+\s*(?:serie|serii|seria)(?!\p{L})/giu, ' ')
      .replace(/(?<!\p{L})(?:po|na|x|razy)\s*\d+\s*(?:powt\p{L}*|raz\p{L}*)?/giu, ' ')
      .replace(/(?<!\p{L})\d+\s*(?:powt\p{L}*|razy)(?!\p{L})/giu, ' ')
      .replace(/\d+(?:[.,]\d+)?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const out = { ex: name, kg: kg ? Number(kg[1]) : 0, reps: reps ? Number(reps[1]) : 0, sets: series ? Math.min(20, Number(series[1])) : 1 };
    return out.ex && out.reps > 0 ? out : null;
  }

  // Plany: dzien to lista cwiczen z zakresem powtorzen i liczba serii.
  const PROGRAMS = {
    ppl: {
      name: 'Push / Pull / Legs',
      days: [
        { name: 'Push', ex: [['Wyciskanie na ławce płaskiej', 4, '6-10'], ['Wyciskanie nad głowę stojąc', 3, '8-10'], ['Wyciskanie hantli skos', 3, '8-12'], ['Unoszenie bokiem', 3, '12-15'], ['Prostowanie ramion na wyciągu', 3, '10-15']] },
        { name: 'Pull', ex: [['Martwy ciąg', 3, '5-8'], ['Podciąganie', 4, '6-10'], ['Wiosłowanie sztangą', 3, '8-10'], ['Face pull', 3, '12-15'], ['Uginanie ramion ze sztangą', 3, '8-12']] },
        { name: 'Legs', ex: [['Przysiad', 4, '6-10'], ['Martwy ciąg rumuński', 3, '8-10'], ['Wykroki', 3, '10-12'], ['Uginanie nóg', 3, '10-12'], ['Wspięcia na łydki', 4, '12-15']] },
      ],
    },
    fbw: {
      name: 'FBW (całe ciało)',
      days: [
        { name: 'A', ex: [['Przysiad', 3, '6-10'], ['Wyciskanie na ławce płaskiej', 3, '6-10'], ['Wiosłowanie sztangą', 3, '8-10'], ['Unoszenie bokiem', 2, '12-15'], ['Plank', 3, '45 s']] },
        { name: 'B', ex: [['Martwy ciąg', 3, '5-8'], ['Wyciskanie nad głowę stojąc', 3, '6-10'], ['Podciąganie', 3, '6-10'], ['Wykroki', 2, '10-12'], ['Uginanie ramion z hantlami', 2, '10-12']] },
      ],
    },
    ul: {
      name: 'Góra / Dół',
      days: [
        { name: 'Góra', ex: [['Wyciskanie na ławce płaskiej', 4, '6-10'], ['Wiosłowanie sztangą', 4, '6-10'], ['Wyciskanie nad głowę stojąc', 3, '8-10'], ['Podciąganie', 3, '6-10'], ['Uginanie ramion ze sztangą', 2, '10-12'], ['Prostowanie ramion na wyciągu', 2, '10-12']] },
        { name: 'Dół', ex: [['Przysiad', 4, '6-10'], ['Martwy ciąg rumuński', 3, '8-10'], ['Wypychanie nogami', 3, '10-12'], ['Uginanie nóg', 3, '10-12'], ['Wspięcia na łydki', 4, '12-15']] },
      ],
    },
    boks: {
      name: 'Boks + siła',
      days: [
        { name: 'Technika', ex: [['Skakanka', 3, '3 min'], ['Worek', 6, '3 min'], ['Tarcze', 4, '3 min'], ['Plank', 3, '45 s']] },
        { name: 'Siła', ex: [['Przysiad', 3, '5-8'], ['Wyciskanie na ławce płaskiej', 3, '5-8'], ['Podciąganie', 3, '6-10'], ['Martwy ciąg', 2, '5']] },
      ],
    },
  };

  /** Dzisiejszy dzien planu: kolejny po ostatnio zrobionym. */
  function planDay(programId, doneCount) {
    const p = PROGRAMS[programId] || PROGRAMS.ppl;
    const i = ((Number(doneCount) || 0) % p.days.length + p.days.length) % p.days.length;
    return { program: p.name, index: i, ...p.days[i] };
  }

  /** Odliczanie rund bokserskich: kolejne odcinki { typ, s } od rozgrzewki do konca. */
  function rounds({ rounds: n = 3, work = 180, rest = 60, prep = 10 } = {}) {
    const out = [];
    if (prep > 0) out.push({ typ: 'przygotowanie', s: prep });
    for (let i = 1; i <= n; i++) {
      out.push({ typ: 'runda', nr: i, s: work });
      if (i < n && rest > 0) out.push({ typ: 'przerwa', nr: i, s: rest });
    }
    return { odcinki: out, razem: out.reduce((s, o) => s + o.s, 0) };
  }

  /** Przemiana materii (Mifflin-St Jeor), zapotrzebowanie i bialko. */
  function energy({ sex = 'm', age, height, weight, activity = 1.55, goal = 'utrzymanie' } = {}) {
    const a = Number(age);
    const h = Number(height);
    const w = Number(weight);
    if (!(a > 0 && h > 0 && w > 0)) return null;
    const bmr = Math.round(10 * w + 6.25 * h - 5 * a + (sex === 'k' ? -161 : 5));
    const tdee = Math.round(bmr * Number(activity || 1.55));
    const kcal = goal === 'redukcja' ? tdee - 400 : goal === 'masa' ? tdee + 300 : tdee;
    return { bmr, tdee, kcal, protein: Math.round(w * (goal === 'redukcja' ? 2.2 : 1.8)), water: Math.round(w * 35) };
  }

  /** Trend masy ciala: srednia z ostatnich 7 pomiarow i zmiana tydzien do tygodnia. */
  function weightTrend(entries) {
    const list = (entries || []).filter((e) => e.kg > 0 && e.day).sort((a, b) => (a.day < b.day ? -1 : 1));
    if (!list.length) return null;
    const avg = (arr) => Math.round((arr.reduce((s, e) => s + e.kg, 0) / arr.length) * 10) / 10;
    const lastDay = list[list.length - 1].day;
    const recent = list.filter((e) => e.day > shiftDay(lastDay, -7));
    const before = list.filter((e) => e.day <= shiftDay(lastDay, -7) && e.day > shiftDay(lastDay, -14));
    const now = avg(recent);
    return { last: list[list.length - 1].kg, avg7: now, change: before.length ? Math.round((now - avg(before)) * 10) / 10 : null, count: list.length };
  }

  /** Dlugosc snu z godzin zasniecia i pobudki ("23:40", "07:05"), przez polnoc. */
  function sleepHours(from, to) {
    const m = (t) => {
      const x = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
      return x && Number(x[1]) < 24 && Number(x[2]) < 60 ? Number(x[1]) * 60 + Number(x[2]) : null;
    };
    const a = m(from);
    const b = m(to);
    if (a == null || b == null) return 0;
    const mins = (b - a + 1440) % 1440;
    return Math.round((mins / 60) * 100) / 100;
  }

  /** Suma dnia z posilkow wzgledem celu. */
  function dayIntake(meals, dayKey, target) {
    const mine = (meals || []).filter((m) => m.day === dayKey);
    const kcal = mine.reduce((s, m) => s + (Number(m.kcal) || 0), 0);
    const protein = mine.reduce((s, m) => s + (Number(m.protein) || 0), 0);
    return { kcal, protein, meals: mine.length, kcalLeft: target ? target.kcal - kcal : null, proteinLeft: target ? target.protein - protein : null };
  }

  return { oneRepMax, plates, warmup, muscle, exKey, records, isRecord, nextLoad, weekVolume, daysSince, parseSet, PROGRAMS, planDay, rounds, energy, weightTrend, sleepHours, dayIntake, shiftDay, dayDiff };
});
