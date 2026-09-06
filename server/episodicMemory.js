// Funkcja 25: pamiec epizodyczna - "co sie dzialo tego dnia". Subskrybuje
// bus.js (ta sama magistrala, ktora zasila HUD) i zapisuje kazde zdarzenie
// do wlasnego, trwalego dziennika pod data.episodes - bus.js sam trzyma
// tylko ostatnie 300 zdarzen w pamieci procesu (patrz RING_MAX w bus.js),
// wiec bez tego epizody starsze niz "przed ostatnim restartem" znikalyby
// bezpowrotnie. Podsumowanie dnia generuje Gemini (przez withModel) na
// podstawie zebranych zdarzen i jest cache'owane pod data.episodeSummaries,
// dopoki liczba zdarzen danego dnia sie nie zmieni.

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import * as bus from './bus.js';
import { load, save } from './memory.js';
import { withModel } from './geminiChain.js';
import { requireOwner } from './auth.js';
import { ensureNamespace } from './knowledgeStore.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_EVENTS = 4000;
const RETENTION_DAYS = 90;

function warsawDateStr(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

// Subskrypcja startuje w momencie zaimportowania tego pliku (czyli gdy
// episodicMemoryRouter zostanie zamontowany w index.js) - standardowy wzorzec
// "subskrybuj przy imporcie", taki sam jak inne moduly nasluchujace bus.js.
bus.subscribe((event) => {
  const data = ensureNamespace(load());
  const at = Date.parse(event.at) || Date.now();
  data.episodes.push({
    id: event.id,
    at,
    date: warsawDateStr(at),
    source: event.source,
    topic: event.topic,
    message: event.message,
    level: event.level,
  });
  if (data.episodes.length > MAX_EVENTS) {
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    data.episodes = data.episodes.filter((e) => e.at >= cutoff).slice(-MAX_EVENTS);
  }
  save(data);
});

export async function buildDailySummary(dateStr) {
  const data = ensureNamespace(load());
  const events = data.episodes.filter((e) => e.date === dateStr);
  if (!events.length) {
    return { date: dateStr, summary: 'Brak odnotowanych zdarzen tego dnia.', eventCount: 0, cached: false };
  }
  const cached = data.episodeSummaries[dateStr];
  if (cached && cached.eventCount === events.length) {
    return { date: dateStr, summary: cached.summary, eventCount: events.length, cached: true };
  }
  const lines = events.map((e) => `- [${e.source}] ${e.message}`).join('\n');
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Ponizej sa zdarzenia zebrane automatycznie z systemu Jarvis dla dnia ${dateStr}. ` +
        'Napisz krotkie (3-6 zdan), rzeczowe podsumowanie po polsku tego, co sie tego dnia dzialo - ' +
        'bez wstepu w stylu "oto podsumowanie".\n\n' +
        lines,
    })
  );
  const summary = (res.text || '').trim() || 'Nie udalo sie wygenerowac podsumowania.';
  data.episodeSummaries[dateStr] = { summary, generatedAt: Date.now(), eventCount: events.length };
  save(data);
  return { date: dateStr, summary, eventCount: events.length, cached: false };
}

const router = express.Router();

router.get('/api/episodes', requireOwner, (req, res) => {
  const data = ensureNamespace(load());
  const byDate = {};
  for (const e of data.episodes) byDate[e.date] = (byDate[e.date] || 0) + 1;
  const days = Object.entries(byDate)
    .map(([date, count]) => ({ date, count, summarized: Boolean(data.episodeSummaries[date]) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  res.json({ days });
});

router.get('/api/episodes/:date', requireOwner, async (req, res) => {
  const dateStr = req.params.date === 'today' ? warsawDateStr() : req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'Podaj date w formacie RRRR-MM-DD albo "today".' });
  }
  try {
    res.json(await buildDailySummary(dateStr));
  } catch {
    res.status(503).json({ error: 'Model niedostepny - sprobuj ponownie za chwile.' });
  }
});

export const episodicMemoryRouter = router;
