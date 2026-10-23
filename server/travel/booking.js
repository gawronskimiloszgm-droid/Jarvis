// #124: Rezerwacja stolika/wizyty przez API.
//
// Generyczny szkielet w dwoch krokach, bo rezerwacja to jedna z tych rzeczy,
// ktore NIGDY nie moga sie wykonac same z siebie (analogicznie do zasady przy
// wysylce wiadomosci): /draft tylko formatuje zadanie z opisu (Gemini), nic
// nie wysyla; /confirm wymaga confirm:true i dopiero wtedy probuje wyslac -
// a poniewaz w srodowisku nie ma zadnego prawdziwego dostawcy rezerwacji
// (np. OpenTable), bez skonfigurowanego BOOKING_API_URL po prostu jasno o tym
// informuje, zamiast udawac sukces.

import { GoogleGenAI, Type } from '@google/genai';
import { withModel } from '../core/geminiChain.js';
import { loadTravel, saveTravel, newId } from './store.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BOOKING_API_URL = process.env.BOOKING_API_URL || '';
const BOOKING_API_KEY = process.env.BOOKING_API_KEY || '';

export function isProviderConfigured() {
  return Boolean(BOOKING_API_URL);
}

const DRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rodzaj: { type: Type.STRING, enum: ['restauracja', 'wizyta', 'inne'] },
    miejsce: { type: Type.STRING },
    data: { type: Type.STRING, description: 'RRRR-MM-DD jesli mozliwe do wywnioskowania' },
    godzina: { type: Type.STRING, description: 'GG:MM jesli mozliwa do wywnioskowania' },
    liczbaOsob: { type: Type.NUMBER },
    uwagi: { type: Type.STRING },
  },
  required: ['rodzaj', 'miejsce'],
};

async function extractDraft(description) {
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        'Uzytkownik chce zarezerwowac stolik/wizyte. Z opisu ponizej wyciagnij dane rezerwacji ' +
        'po polsku. Gdy czegos brakuje w opisie, zostaw puste - NIE zgaduj.\n\n' +
        `Opis: "${description}"`,
      config: { responseMimeType: 'application/json', responseSchema: DRAFT_SCHEMA },
    })
  );
  return JSON.parse(res.text);
}

/** Krok 1: przygotowanie draftu rezerwacji z opisu - NIC nie wysyla. */
export async function draftBooking(description) {
  const clean = String(description || '').trim();
  if (!clean) throw new Error('Podaj opis rezerwacji.');

  const parsed = await extractDraft(clean);
  const data = loadTravel();
  const draft = {
    id: newId(),
    description: clean,
    parsed,
    status: 'draft',
    createdAt: Date.now(),
  };
  data.travel.bookingDrafts.push(draft);
  saveTravel(data);
  return draft;
}

export function listDrafts() {
  return loadTravel().travel.bookingDrafts;
}

/**
 * Krok 2: potwierdzenie - wymaga confirm:true. Bez skonfigurowanego
 * dostawcy zwraca jasna informacje o potrzebnej integracji zamiast
 * udawac, ze rezerwacja poszla.
 */
export async function confirmBooking(draftId, confirm) {
  if (confirm !== true) {
    throw new Error('Rezerwacja wymaga jawnego potwierdzenia (confirm:true) - to celowe zabezpieczenie, nie blad.');
  }
  const data = loadTravel();
  const draft = data.travel.bookingDrafts.find((d) => d.id === draftId);
  if (!draft) throw new Error('Nie znaleziono draftu rezerwacji o tym id.');
  if (draft.status === 'sent') return draft; // idempotentnie - nie wysylamy drugi raz

  if (!isProviderConfigured()) {
    draft.status = 'needs_provider';
    draft.message =
      'Brak skonfigurowanego dostawcy rezerwacji. Ustaw BOOKING_API_URL/BOOKING_API_KEY pod konkretne API ' +
      '(np. OpenTable) - dopiero wtedy potwierdzenie moze realnie wyslac zadanie rezerwacji.';
    saveTravel(data);
    return draft;
  }

  // Ksztalt zadania do konkretnego dostawcy jest nieznany bez wybranego API -
  // wysylamy draft.parsed wprost i zostawiamy mapowanie na pozniej.
  const headers = { 'Content-Type': 'application/json' };
  if (BOOKING_API_KEY) headers.Authorization = `Bearer ${BOOKING_API_KEY}`;
  const res = await fetch(BOOKING_API_URL, { method: 'POST', headers, body: JSON.stringify(draft.parsed) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    draft.status = 'error';
    draft.message = `Dostawca rezerwacji odpowiedzial HTTP ${res.status}`;
    saveTravel(data);
    throw new Error(draft.message);
  }

  draft.status = 'sent';
  draft.providerResponse = body;
  saveTravel(data);
  return draft;
}
