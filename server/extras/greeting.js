// Filmowe powitanie: krotki meldunek Jarvisa przy starcie komputera albo po powrocie
// (wybudzenie, odblokowanie). Fakty zbieramy z tego, co serwer juz wie, a Jarvis
// uklada je swoim stylem. Bez klucza AI - prosty szablon z tych samych faktow.

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import { getWeather } from '../core/weather.js';
import * as memory from '../memory/memory.js';
import * as calendar from '../connect/calendar.js';
import { PERSONALITY_CORE } from '../core/jarvis.js';
import { buildReport } from '../security/edith.js';
import { cachedTriage } from './mailtriage.js';
import { isDnd } from './dnd.js';

const router = express.Router();
const CITY = process.env.OWNER_CITY || 'Warszawa';

function warsaw(fmt) {
  return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', ...fmt }).format(new Date());
}

async function facts() {
  const out = [];
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(new Date()));
  out.push(`Godzina: ${warsaw({ hour: '2-digit', minute: '2-digit' })}, ${warsaw({ weekday: 'long', day: 'numeric', month: 'long' })}.`);
  try {
    const w = await getWeather(CITY);
    if (w) out.push(`Pogoda w ${w.city}: ${Math.round(w.temperature)} stopni, ${w.condition}.`);
  } catch {
    /* bez pogody */
  }
  if (calendar.isConnected()) {
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
      const ev = (await calendar.listUpcoming(8)).filter((e) => e.start && new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(e.start)) === today);
      out.push(ev.length ? `Kalendarz dzis: ${ev.slice(0, 4).map((e) => `${e.allDay ? '' : new Date(e.start).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }) + ' '}${e.title}`).join('; ')}.` : 'Kalendarz na dzis pusty.');
    } catch {
      /* bez kalendarza */
    }
  }
  const now = Date.now();
  const rem = memory.getReminders().filter((r) => !r.sent && new Date(r.dueAt).getTime() > now && new Date(r.dueAt).getTime() < now + 12 * 3600000);
  if (rem.length) out.push(`Przypomnienia w ciagu 12 h: ${rem.slice(0, 3).map((r) => r.text).join('; ')}.`);
  const todos = memory.getTodos().filter((t) => !t.done);
  if (todos.length) out.push(`Otwarte zadania: ${todos.length} (np. ${todos.slice(0, 2).map((t) => t.text).join('; ')}).`);
  const urgent = cachedTriage().filter((m) => m.kategoria === 'pilny');
  if (urgent.length) out.push(`Pilne maile: ${urgent.length}.`);
  const r = buildReport();
  out.push(r.blocks ? `E.D.I.T.H. zablokowala w ciagu doby ${r.blocks} dzialan.` : 'E.D.I.T.H.: spokojnie, brak blokad.');
  return { list: out, hour };
}

function template(kind, f) {
  const part = f.hour < 5 ? 'Dobranoc' : f.hour < 12 ? 'Dzien dobry' : f.hour < 18 ? 'Dzien dobry' : 'Dobry wieczor';
  const intro = kind === 'resume' ? `${part}, sir. Witam z powrotem.` : `${part}, sir. Wszystkie systemy sprawne.`;
  return [intro, ...f.list.slice(1, 4)].join(' ');
}

router.get('/api/greeting', requireOwner, async (req, res) => {
  if (isDnd()) return res.json({ text: null, reason: 'dnd' });
  const kind = req.query.kind === 'resume' ? 'resume' : 'start';
  const f = await facts();
  if (!process.env.GEMINI_API_KEY) return res.json({ text: template(kind, f) });
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents:
          `${kind === 'resume' ? 'Wlasciciel wlasnie wrocil do komputera (wybudzenie albo odblokowanie).' : 'Wlasciciel wlasnie uruchomil komputer.'} ` +
          'Przywitaj go krotkim meldunkiem w swoim stylu: 2-3 zdania, po polsku, bez list i bez znacznikow. ' +
          'Wybierz z faktow tylko to, co wazne (nie wyliczaj wszystkiego). Nie dodawaj zadnych faktow spoza ponizszej listy.\n\nFakty:\n' +
          f.list.join('\n'),
        config: { systemInstruction: PERSONALITY_CORE },
      })
    );
    const text = String(result.text || '').replace(/\[[^\]]*\]/g, '').trim();
    res.json({ text: text || template(kind, f) });
  } catch {
    res.json({ text: template(kind, f) });
  }
});

export default router;
