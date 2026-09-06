// Wysylka SMS przez Twilio - czyste REST (Basic Auth + form-urlencoded),
// bez pakietu 'twilio' (analogiczny minimalizm co server/printer.js:
// wystarczy wbudowany fetch, po co dokladac cala zaleznosc do jednego
// wywolania HTTP).
//
// #112 z listy "komunikacja": szkic tresci i realna wysylka to DWA
// oddzielne endpointy. /draft tylko formatuje tekst (Gemini), niczego nie
// wysyla. /send wymaga jawnego confirm:true - bez niego zwraca blad, nigdy
// nie wysyla automatycznie "przy okazji" analizy tresci.

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireOwner } from './auth.js';
import { withModel } from './geminiChain.js';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

function isConfigured() {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER);
}

async function sendSms(to, body) {
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: FROM_NUMBER, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return { sid: data.sid, status: data.status };
}

router.get('/status', requireOwner, (req, res) => {
  res.json({ configured: isConfigured() });
});

// #112a: szkic tresci SMS-a na podstawie krotkiego opisu - nie wysyla nic.
router.post('/draft', requireOwner, async (req, res) => {
  const description = String(req.body?.description || '').trim();
  if (!description) return res.status(400).json({ error: 'Brak opisu (description) - o czym ma byc SMS.' });
  try {
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          `Na podstawie tego krotkiego opisu napisz PO POLSKU gotowa tresc SMS-a - zwiezla, naturalna, ` +
          `bez naglowkow typu "Temat:". Opis: "${description}"\n\nZwroc sam tekst wiadomosci.`,
      })
    );
    res.json({ draft: result.text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// #112b: realna wysylka - wymaga confirm:true oraz jawnego numeru i tresci.
router.post('/send', requireOwner, async (req, res) => {
  if (!isConfigured()) {
    return res.status(400).json({ error: 'SMS nie jest skonfigurowany (brak TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER).' });
  }
  const { to, body, confirm } = req.body || {};
  if (confirm !== true) {
    return res.status(400).json({ error: 'Wymagane jawne potwierdzenie: confirm:true. To realna wysylka SMS.' });
  }
  if (!to || !String(body || '').trim()) {
    return res.status(400).json({ error: 'Wymagane pola: to (numer w formacie E.164, np. +48600000000), body.' });
  }
  try {
    const sent = await sendSms(String(to), String(body));
    res.json({ ok: true, ...sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
