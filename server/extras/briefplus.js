// Rozszerzona odprawa: dopisuje do porannej/wieczornej wiadomosci dane z
// kalendarza, skrzynki, bezpieczenstwa (E.D.I.T.H.) i czasu pracy. Kazda
// sekcja jest opcjonalna - brak polaczenia z usluga po prostu ja pomija.

import { registerBriefSection } from '../core/briefing.js';
import * as calendar from '../connect/calendar.js';
import { buildReport } from '../security/edith.js';
import { cachedTriage } from './mailtriage.js';

function warsawDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d);
}

registerBriefSection(async (kind) => {
  if (!calendar.isConnected()) return null;
  try {
    const events = await calendar.listUpcoming(12);
    const day = warsawDate(new Date(Date.now() + (kind === 'evening' ? 24 * 3600 * 1000 : 0)));
    const mine = events.filter((e) => e.start && warsawDate(new Date(e.start)) === day);
    if (!mine.length) return kind === 'evening' ? 'Jutro w kalendarzu pusto.' : 'Dzis w kalendarzu pusto.';
    const fmt = (e) =>
      e.allDay
        ? e.title
        : `${new Date(e.start).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })} ${e.title}`;
    return `${kind === 'evening' ? 'Jutro' : 'Dzis'} w kalendarzu: ${mine.slice(0, 5).map(fmt).join('; ')}.`;
  } catch {
    return null;
  }
});

registerBriefSection(async () => {
  const items = cachedTriage();
  const urgent = items.filter((x) => x.kategoria === 'pilny');
  if (!urgent.length) return null;
  return `Pilne maile (${urgent.length}): ${urgent
    .slice(0, 3)
    .map((x) => x.streszczenie)
    .join(' | ')}.`;
});

registerBriefSection(async (kind) => {
  if (kind !== 'morning') return null;
  const r = buildReport();
  return r.blocks ? `E.D.I.T.H.: w ciagu doby zablokowano ${r.blocks} dzialan.` : null;
});
