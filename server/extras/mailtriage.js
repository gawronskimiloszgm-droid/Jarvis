// Triage skrzynki Gmail: jedna lista z kategoria, streszczeniem i podpowiedzia
// "co zrobic" dla kazdego z ostatnich maili. Szkic odpowiedzi powstaje na
// zadanie; wysylka zawsze idzie osobnym, jawnie potwierdzonym krokiem
// (/api/comms/gmail/send z confirm:true) - tu niczego nie wysylamy.

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import * as gmailClient from '../connect/gmailClient.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();
const TTL = 5 * 60 * 1000;

let cache = { at: 0, items: [] };

/** Ostatni wynik triage'u (bez ruszania sieci) - dla odprawy. */
export function cachedTriage() {
  return Date.now() - cache.at < 6 * 60 * 60 * 1000 ? cache.items : [];
}

/** Swiezy przeglad na potrzeby odprawy (tylko gdy Gmail polaczony i cache starszy niz TTL). */
export async function ensureTriage() {
  if (!gmailClient.isOAuthConfigured() || !gmailClient.isConnected()) return [];
  if (Date.now() - cache.at >= TTL) cache = { at: Date.now(), items: await triage(10) };
  return cache.items;
}

async function triage(limit) {
  const messages = await gmailClient.listRecentInboxMessages(limit);
  if (!messages.length) return [];
  const result = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        'Jestes asystentem skrzynki pocztowej. Dla kazdego maila (temat, nadawca, fragment) podaj:\n' +
        '- kategoria: "pilny" (wymaga reakcji dzis), "odpowiedz" (ktos czeka na odpowiedz, ale nie pilne), ' +
        '"info" (do wiadomosci: rachunki, potwierdzenia, newslettery wartosciowe), "spam" (reklamy, zbedne),\n' +
        '- streszczenie: JEDNO zdanie po polsku,\n' +
        '- akcja: krotka podpowiedz co zrobic (np. "odpisz do piatku", "zaplac rachunek", "ignoruj"). ' +
        'Zachowaj pole id.\n\n' +
        JSON.stringify(messages.map((x) => ({ id: x.id, subject: x.subject, from: x.from, snippet: x.snippet }))),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              kategoria: { type: Type.STRING, enum: ['pilny', 'odpowiedz', 'info', 'spam'] },
              streszczenie: { type: Type.STRING },
              akcja: { type: Type.STRING },
            },
            required: ['id', 'kategoria', 'streszczenie', 'akcja'],
          },
        },
      },
    })
  );
  const byId = Object.fromEntries(JSON.parse(result.text).map((r) => [r.id, r]));
  const order = { pilny: 0, odpowiedz: 1, info: 2, spam: 3 };
  return messages
    .map((x) => ({
      ...x,
      kategoria: byId[x.id]?.kategoria || 'info',
      streszczenie: byId[x.id]?.streszczenie || x.snippet,
      akcja: byId[x.id]?.akcja || '',
    }))
    .sort((a, b) => order[a.kategoria] - order[b.kategoria]);
}

router.get('/api/triage/mail', requireOwner, async (req, res) => {
  if (!gmailClient.isOAuthConfigured() || !gmailClient.isConnected()) {
    return res.status(400).json({ error: 'Gmail nie jest polaczony - wejdz na /api/comms/gmail/auth jako wlasciciel.' });
  }
  try {
    const fresh = Date.now() - cache.at < TTL;
    if (!fresh || req.query.force === '1') cache = { at: Date.now(), items: await triage(15) };
    res.json({ items: cache.items, at: cache.at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/triage/mail/draft', requireOwner, async (req, res) => {
  const item = cache.items.find((x) => x.id === req.body?.id);
  if (!item) return res.status(404).json({ error: 'Nie ma tego maila w ostatnim przegladzie - odswiez liste.' });
  const instructions = String(req.body?.instructions || '').slice(0, 500);
  try {
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          'Napisz PO POLSKU krotka, uprzejma odpowiedz na ponizszego maila. To tylko szkic do wgladu.\n' +
          `Temat: ${item.subject}\nOd: ${item.from}\n` +
          (instructions ? `Wskazowki uzytkownika: ${instructions}\n` : '') +
          `Fragment maila: ${item.snippet}\n\nZwroc sam tekst odpowiedzi.`,
      })
    );
    res.json({ draft: result.text.trim(), to: item.from, subject: /^re:/i.test(item.subject) ? item.subject : `Re: ${item.subject}`, threadId: item.threadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
