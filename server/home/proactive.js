// Warstwa ambientowa: Jarvis sam decyduje, kiedy odezwac sie z wlasnej
// inicjatywy, zamiast czekac az go zapytasz. Rozne moduly (finanse, IoT,
// bezpieczenstwo) juz publikuja WLASNE alerty na bus.js w momencie, gdy
// cos wykryja - to zostaje, to dziala dobrze. Czego brakowalo: nikt nie
// patrzyl na CALOSC naraz (kalendarz + pogoda + zadania + aktywnosc) i nikt
// nie pilnowal, zeby nie zasypac uzytkownika w trybie "nie przeszkadzac".
//
// Wolane raz na cykl utrzymaniowy z upkeep.js - patrz runCheck().

import * as bus from '../core/bus.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import { isDnd } from '../extras/dnd.js';
import * as calendar from '../connect/calendar.js';
import { getWeatherByCoords } from '../core/weather.js';
import express from 'express';
import { requireOwner } from '../core/auth.js';

function store() {
  const data = memory.load();
  if (!data.proactive) {
    data.proactive = {
      dnd: { active: false, until: null, allowAlerts: true },
      lastNudgeAt: {},
      lastWeeklyDigestAt: null,
      lastQuietCheckDay: null,
    };
  }
  return data;
}

// Odstep minimalny miedzy dwoma zaczepkami TEGO SAMEGO typu - inaczej ten
// sam warunek (np. "spotkanie za 20 minut") melduje sie przy kazdym cyklu
// utrzymaniowym (co PING_MS), nie tylko raz.
const NUDGE_COOLDOWN_MS = 30 * 60 * 1000;

function canNudge(data, key) {
  const last = data.proactive.lastNudgeAt[key];
  return !last || Date.now() - last > NUDGE_COOLDOWN_MS;
}

function markNudged(data, key) {
  data.proactive.lastNudgeAt[key] = Date.now();
}

export function isDndActive() {
  const dnd = store().proactive.dnd;
  if (!dnd.active) return false;
  if (dnd.until && Date.now() > dnd.until) return false;
  return true;
}

async function speakUp(message, { level = 'info', force = false } = {}) {
  // level 'alert' przebija tryb "nie przeszkadzac" TYLKO gdy user zostawil
  // allowAlerts wlaczone (domyslnie tak) - to jest ta "eskalacja mimo DND",
  // o ktora chodzi w #17/#18, bez robienia z DND dziury bez dna.
  const data = store();
  if (isDndActive() && !(force && data.proactive.dnd.allowAlerts && level === 'alert')) return;
  bus.publish('proactive', 'nudge', message, { level, speak: true });
  if (!isDnd()) await push.sendToAll({ title: 'J.A.R.V.I.S.', body: message }).catch(() => {});
}

// --- #11/#12: konflikty w kalendarzu + ostrzezenie o wyjsciu na czas ---
async function checkCalendar(data, coords) {
  if (!calendar.isConnected()) return;
  let events;
  try {
    events = await calendar.listUpcoming(8);
  } catch {
    return; // token mogl wygasnac - milczymy, nie spamujemy bledem co 10 min
  }
  if (!events.length) return;

  // Nakladajace sie wydarzenia - proste porownanie par sasiadujacych w czasie.
  const timed = events.filter((e) => !e.allDay && e.start && e.end).map((e) => ({ ...e, s: new Date(e.start).getTime(), e: new Date(e.end).getTime() }));
  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i], b = timed[i + 1];
    if (a.e > b.s) {
      const key = `conflict:${a.id}:${b.id}`;
      if (canNudge(data, key)) {
        markNudged(data, key);
        await speakUp(`W kalendarzu nakladaja sie na siebie "${a.title}" i "${b.title}" - warto to rozsupłac.`);
      }
      break; // jeden konflikt na cykl wystarczy, zeby nie zalac uzytkownika
    }
  }

  // Najblizsze wydarzenie za < 30 min + pogoda niesprzyjajaca -> ostrzezenie
  // "wyjdz wczesniej". Bez dostepu do realnego czasu dojazdu (to inny
  // batch/travel.js) to celowo prosta heurystyka: zla pogoda + malo czasu.
  const next = timed.filter((e) => e.s > Date.now()).sort((a, b) => a.s - b.s)[0];
  if (next) {
    const minsLeft = Math.round((next.s - Date.now()) / 60000);
    if (minsLeft > 0 && minsLeft <= 30 && coords) {
      try {
        const w = await getWeatherByCoords(coords.lat, coords.lon);
        if (w && /deszcz|snieg|burza/i.test(w.condition)) {
          const key = `commute:${next.id}`;
          if (canNudge(data, key)) {
            markNudged(data, key);
            await speakUp(`"${next.title}" masz za ${minsLeft} min, a na dworze ${w.condition} - wyjdz z zapasem, ${process.env.OWNER_TITLE || 'sir'}.`);
          }
        }
      } catch {
        /* brak pogody - nie blokuje reszty */
      }
    }
  }
}

// --- #16/#20: wzorce i "dzis jest inaczej niz zwykle" ---
function checkActivityAnomaly(data) {
  const hist = memory.getRecentHistory(50);
  if (!hist.length) return;
  const lastAt = hist[hist.length - 1].ts;
  const hour = new Date().getHours();
  // Tylko w rozsadnych godzinach (9-21) i tylko raz dziennie - to ma byc
  // ciche "wszystko w porzadku?", nie codzienny nagabywacz.
  const today = new Date().toDateString();
  if (hour < 9 || hour > 21) return;
  if (data.proactive.lastQuietCheckDay === today) return;
  const silentHours = (Date.now() - lastAt) / (60 * 60 * 1000);
  if (silentHours >= 20) {
    data.proactive.lastQuietCheckDay = today;
    speakUp(`Cisza z Twojej strony od blisko doby - wszystko w porzadku, ${process.env.OWNER_TITLE || 'sir'}?`, { level: 'info' });
  }
}

// --- #16: zaniedbane, powtarzajace sie zadania ---
function checkStaleTodoPattern(data) {
  const todos = memory.getTodos().filter((t) => !t.done);
  const veryStale = todos.filter((t) => t.createdAt && Date.now() - t.createdAt > 7 * 24 * 60 * 60 * 1000);
  if (veryStale.length >= 3) {
    const key = 'stale-todos';
    if (canNudge(data, key)) {
      markNudged(data, key);
      speakUp(`${veryStale.length} zadania wisza na liscie od ponad tygodnia - moze pora je przejrzec, a nie tylko przewijac?`);
    }
  }
}

// --- #19: tygodniowe podsumowanie (niedziela wieczorem) ---
async function checkWeeklyDigest(data) {
  const now = new Date();
  const isSundayEvening = now.getDay() === 0 && now.getHours() >= 18;
  if (!isSundayEvening) return;
  const last = data.proactive.lastWeeklyDigestAt;
  if (last && Date.now() - last < 6 * 24 * 60 * 60 * 1000) return;

  const expenses = memory.summarizeExpenses(7);
  const doneTodos = memory.getTodos().filter((t) => t.done).length;
  const openTodos = memory.getTodos().filter((t) => !t.done).length;
  data.proactive.lastWeeklyDigestAt = Date.now();
  await speakUp(
    `Podsumowanie tygodnia: wydano ${expenses.total} zl, ukonczono ${doneTodos} zadan, ${openTodos} wciaz otwartych.`,
    { level: 'info' }
  );
}

export async function runCheck(coords) {
  const data = store();
  try {
    await checkCalendar(data, coords);
  } catch (err) {
    console.error('Proaktywnosc: kalendarz nieudany:', err.message);
  }
  try {
    checkActivityAnomaly(data);
  } catch (err) {
    console.error('Proaktywnosc: anomalia aktywnosci nieudana:', err.message);
  }
  try {
    checkStaleTodoPattern(data);
  } catch (err) {
    console.error('Proaktywnosc: zaniedbane zadania nieudane:', err.message);
  }
  try {
    await checkWeeklyDigest(data);
  } catch (err) {
    console.error('Proaktywnosc: cotygodniowe podsumowanie nieudane:', err.message);
  }
  memory.save(data);
}

export const router = express.Router();

router.get('/api/proactive/dnd', requireOwner, (req, res) => {
  res.json(store().proactive.dnd);
});

router.post('/api/proactive/dnd', requireOwner, (req, res) => {
  const data = store();
  const { active, minutes, allowAlerts } = req.body || {};
  data.proactive.dnd = {
    active: Boolean(active),
    until: active && Number(minutes) > 0 ? Date.now() + Number(minutes) * 60000 : null,
    allowAlerts: allowAlerts !== false,
  };
  memory.save(data);
  res.json(data.proactive.dnd);
});

export default router;
