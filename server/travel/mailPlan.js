// #125: Automatyczne tworzenie planu podrozy z maili z potwierdzeniami.
//
// Uzytkownik wkleja tresc maila (lot/hotel/pociag), Gemini wyciaga
// ustrukturyzowane dane (responseSchema) i zapisujemy je jako wpis w planie
// podrozy w namespace uzytkownika (data.travel.plan, patrz store.js).

import { GoogleGenAI, Type } from '@google/genai';
import { withModel } from '../core/geminiChain.js';
import { loadTravel, saveTravel, newId } from './store.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PLAN_ENTRY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    znaleziono: { type: Type.BOOLEAN, description: 'false jesli to NIE jest potwierdzenie podrozy' },
    typ: { type: Type.STRING, enum: ['lot', 'hotel', 'pociag', 'wynajem_auta', 'inne'] },
    data: { type: Type.STRING, description: 'RRRR-MM-DD' },
    godzina: { type: Type.STRING, description: 'GG:MM, jesli widoczna' },
    miejsce: { type: Type.STRING, description: 'lotnisko/hotel/stacja/miasto' },
    numerRezerwacji: { type: Type.STRING },
    dodatkowo: { type: Type.STRING, description: 'inne istotne szczegoly jednym zdaniem' },
  },
  required: ['znaleziono'],
};

async function extractPlanEntry(emailText) {
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        'Ponizej jest tresc maila z potwierdzeniem podrozy (lot, hotel, pociag, wynajem auta). ' +
        'Wyciagnij z niego dane strukturalne po polsku. Jesli to NIE jest potwierdzenie podrozy, ' +
        'ustaw znaleziono na false i nie zgaduj pol.\n\n' +
        `Tresc maila:\n${emailText}`,
      config: { responseMimeType: 'application/json', responseSchema: PLAN_ENTRY_SCHEMA },
    })
  );
  return JSON.parse(res.text);
}

/** @param {string} emailText tresc maila z potwierdzeniem */
export async function addFromEmail(emailText) {
  const clean = String(emailText || '').trim();
  if (!clean) throw new Error('Podaj tresc maila.');

  const parsed = await extractPlanEntry(clean);
  if (!parsed.znaleziono) {
    return { added: false, message: 'Model nie rozpoznal w tym tekscie potwierdzenia podrozy.' };
  }

  const data = loadTravel();
  const entry = {
    id: newId(),
    typ: parsed.typ || 'inne',
    data: parsed.data || null,
    godzina: parsed.godzina || null,
    miejsce: parsed.miejsce || null,
    numerRezerwacji: parsed.numerRezerwacji || null,
    dodatkowo: parsed.dodatkowo || null,
    source: 'email',
    createdAt: Date.now(),
  };
  data.travel.plan.push(entry);
  data.travel.plan.sort((a, b) => String(a.data || '9999').localeCompare(String(b.data || '9999')));
  saveTravel(data);
  return { added: true, entry };
}

export function listPlan() {
  return loadTravel().travel.plan;
}

export function removePlanEntry(id) {
  const data = loadTravel();
  data.travel.plan = data.travel.plan.filter((e) => e.id !== id);
  saveTravel(data);
  return data.travel.plan;
}
