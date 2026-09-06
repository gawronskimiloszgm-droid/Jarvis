// #96: wykrywanie czy roslina potrzebuje podlania, z historia ocen per
// nazwana roslina.
//
// Router eksportowany, NIE montowany tutaj - patrz raport co do sciezki
// montowania w server/index.js.

import express from 'express';
import { nanoid } from 'nanoid';
import { GoogleGenAI, Type } from '@google/genai';
import { imagePart } from './vision.js';
import { withModel } from './geminiChain.js';
import { requireOwner } from './auth.js';
import { load, save } from './memory.js';
import * as bus from './bus.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

function stripDataUrl(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}

function plantData() {
  const data = load();
  if (!data.plantCare2) data.plantCare2 = { rosliny: {} }; // rosliny: { [nazwa]: [{ts, stan, uzasadnienie}] }
  return data;
}

const MAX_HISTORY_PER_PLANT = 50;

const PLANT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    stan: { type: Type.STRING, enum: ['przesuszona', 'ok', 'przelana'] },
    uzasadnienie: { type: Type.STRING },
  },
  required: ['stan', 'uzasadnienie'],
};

function normalizePlantName(name) {
  return String(name || '').trim().toLowerCase().slice(0, 60);
}

// POST /:name/check { image, mimeType }
router.post('/:name/check', requireOwner, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY.' });
  const name = normalizePlantName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Brak nazwy rosliny.' });
  const { image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak obrazu.' });

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          imagePart(stripDataUrl(image), mimeType || 'image/jpeg'),
          {
            text: `Na zdjeciu jest doniczkowa roslina o nazwie "${name}". Ocen jej stan nawodnienia
po wygladzie liscie/podloza (zwiedniete/oklapniete liscie, przesuszona ziemia = przesuszona;
zoltniejace/gnijace liscie, mokra/stojaca woda = przelana; w innym wypadku ok).

Zwroc WYLACZNIE obiekt JSON (bez markdown):
{"stan": "przesuszona"|"ok"|"przelana", "uzasadnienie": string - 1 zdanie po polsku, co konkretnie na to wskazuje}`,
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema: PLANT_SCHEMA },
      })
    );
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = { stan: 'ok', uzasadnienie: 'blad parsowania odpowiedzi modelu' };
    }
    const stan = ['przesuszona', 'ok', 'przelana'].includes(parsed.stan) ? parsed.stan : 'ok';
    const uzasadnienie = String(parsed.uzasadnienie || '').slice(0, 300);

    const data = plantData();
    if (!data.plantCare2.rosliny[name]) data.plantCare2.rosliny[name] = [];
    const entry = { id: nanoid(8), ts: Date.now(), stan, uzasadnienie };
    data.plantCare2.rosliny[name].push(entry);
    if (data.plantCare2.rosliny[name].length > MAX_HISTORY_PER_PLANT) {
      data.plantCare2.rosliny[name] = data.plantCare2.rosliny[name].slice(-MAX_HISTORY_PER_PLANT);
    }
    save(data);

    if (stan === 'przesuszona') {
      bus.publish('plantCare2', 'plant.thirsty', `${name}: potrzebuje podlania - ${uzasadnienie}`, {
        level: 'warn',
        speak: true,
        data: { roslina: name },
      });
    }

    res.json({ roslina: name, ocena: entry });
  } catch (err) {
    console.error('plantCare check error:', err);
    res.status(500).json({ error: 'Nie udalo sie ocenic stanu rosliny.' });
  }
});

// GET /:name/history
router.get('/:name/history', requireOwner, (req, res) => {
  const name = normalizePlantName(req.params.name);
  const history = plantData().plantCare2.rosliny[name] || [];
  res.json({ roslina: name, historia: history });
});

// GET / - lista roslin z ostatnia ocena kazdej.
router.get('/', requireOwner, (req, res) => {
  const rosliny = plantData().plantCare2.rosliny;
  const lista = Object.entries(rosliny).map(([name, history]) => ({
    roslina: name,
    ostatnia: history[history.length - 1] || null,
    liczbaOcen: history.length,
  }));
  res.json({ rosliny: lista });
});

export default router;
