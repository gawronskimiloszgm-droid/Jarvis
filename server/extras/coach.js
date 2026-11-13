// Trener na co dzien: plan i jedzenie w porannej odprawie, bilans wieczorem, przypomnienia o
// zaniedbanej partii, o treningu po przerwie i o bialku, podsumowanie tygodnia oraz start treningu
// z playlista. Dane z modulu Trening (fitness.js), wysylka jak reszta podpowiedzi: raz na dzien, nigdy w ciszy.
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as player from '../connect/spotifyPlayer.js';
import { registerBriefSection } from '../core/briefing.js';
import { FitKit, fitProfile, fitSummary } from './fitness.js';
import { lifeList, logJournal, warsawDay } from './life.js';
import { isDnd } from './dnd.js';

const PART_NAMES = { nogi: 'nogi', plecy: 'plecy', klatka: 'klatka', barki: 'barki', biceps: 'biceps', triceps: 'triceps', brzuch: 'brzuch' };

/** Linia do porannej albo wieczornej odprawy; pusta, gdy modul Trening nie jest uzywany. */
export function coachBriefLine(kind, day = warsawDay()) {
  const sets = lifeList('sets');
  const meals = lifeList('meals');
  if (!sets.length && !meals.length) return '';
  const s = fitSummary(day);
  if (kind === 'morning') {
    const parts = [];
    if (sets.length) {
      const ago = s.lastTraining ? FitKit.dayDiff(s.lastTraining, day) : null;
      parts.push(`Trening: dziś ${s.plan.name} (${s.plan.ex.slice(0, 3).map((e) => e[0]).join(', ')}${s.plan.ex.length > 3 ? '...' : ''})${ago != null ? `, ostatni ${ago === 0 ? 'dziś' : ago === 1 ? 'wczoraj' : `${ago} dni temu`}` : ''}`);
    }
    if (s.energy) parts.push(`cel: ${s.energy.kcal} kcal i ${s.energy.protein} g białka`);
    return parts.length ? `${parts.join('; ')}.` : '';
  }
  if (kind === 'evening') {
    const parts = [];
    if (s.today.length) parts.push(`${s.today.length} serii`);
    if (s.intake.meals) parts.push(`${s.intake.kcal}${s.energy ? `/${s.energy.kcal}` : ''} kcal, ${s.intake.protein}${s.energy ? `/${s.energy.protein}` : ''} g białka`);
    return parts.length ? `Dziś: ${parts.join(', ')}.` : '';
  }
  return '';
}
registerBriefSection(async (kind) => coachBriefLine(kind));

/** Tekst podsumowania tygodnia (glos, push w niedziele). */
export function coachWeekText(day = warsawDay()) {
  const r = FitKit.weekReport({ sets: lifeList('sets'), body: lifeList('body'), sleep: lifeList('sleep') }, day);
  const p = fitProfile();
  const bits = [`treningi: ${r.days}/${p.perWeek || 3}`, `${r.sets} serii`, `${r.volume} kg objętości`];
  if (r.prs.length) bits.push(`rekordy: ${r.prs.slice(0, 3).join(', ')}`);
  if (r.weightChange != null) bits.push(`waga ${r.weightChange > 0 ? '+' : ''}${r.weightChange} kg`);
  if (r.sleepAvg) bits.push(`sen średnio ${r.sleepAvg} h`);
  return { text: bits.join(' · '), ...r };
}

/** Co dzis wypada przypomniec. Zwraca liste [klucz, tytul, tresc]; wysylke robi maybeCoach. */
export function coachNudges(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', weekday: 'short', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  const hour = Number(parts.hour);
  const day = warsawDay();
  const sets = lifeList('sets');
  const out = [];
  if (!sets.length && !lifeList('meals').length) return out;
  const s = fitSummary(day);
  if (sets.length && hour >= 16 && hour < 18) {
    const ago = s.lastTraining ? FitKit.dayDiff(s.lastTraining, day) : 99;
    const per = s.profile.perWeek || 3;
    // Przy 3 treningach w tygodniu przerwa dluzsza niz 3 dni oznacza, ze tydzien sie rozjezdza.
    if (ago >= Math.ceil(7 / per) + 1 && ago < 30) out.push([`${day}:coach-train`, 'Trening', `Ostatni trening ${ago} dni temu. Dziś w planie ${s.plan.name}: ${s.plan.ex.slice(0, 3).map((e) => e[0]).join(', ')}.`]);
    else {
      const n = FitKit.neglected(sets, day);
      if (n.length) out.push([`${day}:coach-neglect`, 'Trening', `${n.slice(0, 2).map((x) => `${PART_NAMES[x.part] || x.part}: ${x.days} dni`).join(', ')} bez treningu. Warto wpleść to w najbliższą sesję.`]);
    }
  }
  if (s.energy && s.intake.meals && hour >= 19 && hour < 21 && s.intake.protein < s.energy.protein * 0.7) {
    out.push([`${day}:coach-protein`, 'Białko', `Dziś ${s.intake.protein} z ${s.energy.protein} g białka. Brakuje ok. ${s.energy.protein - s.intake.protein} g.`]);
  }
  if (sets.length && parts.weekday === 'Sun' && hour >= 18 && hour < 21) out.push([`${day}:coach-week`, 'Tydzień treningowy', coachWeekText(day).text]);
  return out;
}

export async function maybeCoach(now = new Date()) {
  const d = memory.load();
  if (!d.coachNudges || typeof d.coachNudges !== 'object') d.coachNudges = {};
  const keep = warsawDay(-3);
  for (const k of Object.keys(d.coachNudges)) if (k.slice(0, 10) < keep) delete d.coachNudges[k];
  let sent = 0;
  for (const [key, title, body] of coachNudges(now)) {
    if (d.coachNudges[key]) continue;
    d.coachNudges[key] = true;
    sent++;
    if (push.isConfigured() && !isDnd()) await push.sendToAll({ title: `J.A.R.V.I.S. - ${title}`, body }).catch(() => {});
    logJournal('auto', `${title}: ${body}`, 'trening');
  }
  if (sent) memory.save(d);
  return sent;
}

/** Start treningu: plan z ciezarami i (gdy ustawiona i Spotify polaczone) playlista. */
export async function startWorkout({ playlist, playMore } = {}) {
  const s = fitSummary();
  const p = fitProfile();
  const name = String(playlist || p.playlist || '').trim();
  let music = null;
  if (name && player.isConnected()) {
    try {
      const more = playMore || (await import('../connect/spotifyMore.js'));
      const r = await more.playPlaylist(name);
      music = `gra ${r.name}`;
    } catch (e) {
      music = `muzyka: ${e.message}`;
    }
  }
  logJournal('auto', `Start treningu: ${s.plan.name}`, 'trening');
  return {
    plan: `${s.plan.program}: ${s.plan.name}`,
    cwiczenia: s.plan.ex.map(([ex, n, reps]) => {
      const l = s.planLoads?.[ex];
      return `${ex} ${n}×${reps}${l?.kg ? ` (${l.kg} kg)` : ''}`;
    }),
    rozgrzewka: 'zacznij od 5-10 min rozgrzewki i serii rozgrzewkowych',
    muzyka: music,
    klient: { action: 'trening-start', params: {} },
  };
}

export const COACH_TOOLS = [
  {
    name: 'start_treningu',
    description: 'Uzytkownik zaczyna trening ("zaczynam trening", "idziemy na silke"): podaje dzisiejszy plan z ciezarami, otwiera modul Trening i wlacza playliste treningowa, jesli jest ustawiona.',
    parameters: { type: 'object', properties: { playlista: { type: 'string', description: 'opcjonalnie inna playlista niz zapisana' } } },
  },
  {
    name: 'tydzien_treningowy',
    description: 'Podsumowanie tygodnia treningowego: dni, serie, objetosc, rekordy, zmiana wagi, sen.',
    parameters: { type: 'object', properties: {} },
  },
];
export const COACH_VOICE_PROMPT = '- start_treningu: gdy uzytkownik zaczyna trening; potem krotko plan i pierwsze cwiczenie. tydzien_treningowy: "jak mi poszedl tydzien".';

export async function runCoachTool(name, a = {}) {
  if (name === 'start_treningu') return startWorkout({ playlist: a.playlista });
  if (name === 'tydzien_treningowy') {
    const r = coachWeekText();
    return { podsumowanie: r.text, rekordy: r.prs };
  }
  return undefined;
}
