// Poranna/wieczorna odprawa - jedna wiadomosc push laczaca dane, ktore
// Jarvis i tak juz zbiera osobno (pogoda, zadania, wartownik, telemetria
// maszyny), zamiast zmuszac uzytkownika do zagladania w kilka miejsc.
//
// Bez wlasnego harmonogramu: odpytywana jest z /api/cron/tick, tego samego
// endpointu, ktory zewnetrzny cron juz bije co ~10 minut dla podtrzymania
// Rendera (patrz upkeep.js) - kolejny timer wewnatrz procesu nic by tu nie
// dodal, a przy usnieciu Rendera i tak by nie odpalil.

import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as bus from './bus.js';
import { getWeather } from './weather.js';
import { snapshot as telemetrySnapshot } from '../home/telemetry.js';

const CITY = process.env.OWNER_CITY || 'Warszawa';
const MORNING_HOUR = Number(process.env.BRIEFING_MORNING_HOUR || 7);
const EVENING_HOUR = Number(process.env.BRIEFING_EVENING_HOUR || 20);
// Cron bije co ~10 min - okno musi byc szersze niz odstep, inaczej latwo
// przeoczyc trafienie (np. cron akurat wypadl o 6:59 i 7:11).
const WINDOW_MIN = Number(process.env.BRIEFING_WINDOW_MIN || 15);

function warsawParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function sameDay(tsMs, dateStr) {
  if (!tsMs) return false;
  return warsawParts(new Date(tsMs)).dateStr === dateStr;
}

// Eksportowane takze do wywolania NA ZADANIE (poza oknem harmonogramu) -
// patrz narzedzie "odprawa" w voiceLive.js/jarvis.js, ktore pozwala
// zapytac o to samo w dowolnym momencie, nie tylko rano/wieczorem.
export async function buildBrief(kind) {
  const lines = [];

  try {
    const w = await getWeather(CITY);
    if (w) lines.push(`Pogoda w ${w.city}: ${Math.round(w.temperature)}°C, ${w.condition}.`);
  } catch {
    /* pogoda nie jest krytyczna dla odprawy - pomijamy ciszej */
  }

  const todos = memory.getTodos().filter((t) => !t.done);
  if (todos.length) {
    const preview = todos.slice(0, 3).map((t) => t.text).join('; ');
    lines.push(`Zadania (${todos.length}): ${preview}${todos.length > 3 ? '...' : ''}.`);
  }

  if (kind === 'morning') {
    const today = warsawParts().dateStr;
    const dueToday = memory
      .getReminders()
      .filter((r) => !r.sent && String(r.dueAt || '').slice(0, 10) === today);
    if (dueToday.length) {
      lines.push(`Przypomnienia na dzis: ${dueToday.map((r) => r.text).join('; ')}.`);
    }
  }

  if (kind === 'evening') {
    const summary = memory.summarizeExpenses(1);
    if (summary.count) lines.push(`Wydatki dzisiaj: ${summary.total} zl (${summary.count} pozycji).`);
  }

  const hot = telemetrySnapshot().filter((m) => m.online && (m.cpu > 85 || m.ramUsedPct > 85));
  if (hot.length) {
    lines.push(`Uwaga na maszynie: ${hot.map((m) => `${m.machine} (CPU ${m.cpu}%, RAM ${m.ramUsedPct}%)`).join(', ')}.`);
  }

  if (!lines.length) lines.push('Nic nowego do zameldowania.');
  return lines.join(' ');
}

/**
 * Wolane z kazdym tikiem /api/cron/tick. Wysyla odprawe co najwyzej raz na
 * dzien na pore (rano/wieczor), tylko w oknie docelowej godziny.
 */
export async function maybeSendBriefing() {
  const { dateStr, hour, minute } = warsawParts();
  const state = memory.getBriefingState();

  const inWindow = (targetHour) => hour === targetHour && minute < WINDOW_MIN;

  let sent = null;
  if (inWindow(MORNING_HOUR) && !sameDay(state.lastMorningAt, dateStr)) {
    sent = 'morning';
  } else if (inWindow(EVENING_HOUR) && !sameDay(state.lastEveningAt, dateStr)) {
    sent = 'evening';
  }
  if (!sent) return { sent: false };

  const body = await buildBrief(sent);
  const title = sent === 'morning' ? 'Odprawa poranna' : 'Odprawa wieczorna';
  memory.markBriefingSent(sent);
  bus.publish('briefing', `${sent}.sent`, body, { level: 'info', speak: false });
  if (push.isConfigured()) await push.sendToAll({ title, body });
  return { sent: true, kind: sent, body };
}
