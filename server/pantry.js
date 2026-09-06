// #95: liczenie/monitorowanie stanu zapasow w lodowce/spizarni.
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

function stripDataUrl(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}

// Namespace w pamieci trwalej - NIE edytujemy server/memory.js, tylko
// doklejamy wlasny klucz do wspolnego magazynu (patrz konwencja projektu).
function pantryData() {
  const data = load();
  if (!data.pantry2) data.pantry2 = { spisy: [] }; // spisy = kolejne migawki stanu
  return data;
}

const MAX_SPISY = 30;

const ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    nazwa: { type: Type.STRING },
    ilosc_szacunkowa: { type: Type.STRING }, // tekstowo, bo model widzi np. "ok. 3 sztuki", "polpelna butelka"
  },
  required: ['nazwa'],
};
const PANTRY_SCHEMA = { type: Type.ARRAY, items: ITEM_SCHEMA };

// POST /scan { image, mimeType } - rozpoznaje widoczne produkty i zapisuje
// migawke z timestampem.
router.post('/scan', requireOwner, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY.' });
  const { image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak obrazu.' });

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          imagePart(stripDataUrl(image), mimeType || 'image/jpeg'),
          {
            text: `Na zdjeciu jest wnetrze lodowki/spizarni/szafki kuchennej. Rozpoznaj widoczne
produkty spozywcze i oszacuj ich ilosc na oko.

Zwroc WYLACZNIE tablice JSON (bez markdown), jeden wpis na kazdy rozpoznany produkt:
[{"nazwa": string - nazwa produktu po polsku, "ilosc_szacunkowa": string - np. "3 sztuki",
"polpelna butelka", "ok. 200g"}]

Pomijaj rzeczy niejadalne (pojemniki, polki). Gdy nic nie rozpoznajesz, zwroc pusta tablice [].`,
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema: PANTRY_SCHEMA },
      })
    );
    let items;
    try {
      items = JSON.parse(result.text);
    } catch {
      items = [];
    }
    if (!Array.isArray(items)) items = [];
    const cleanItems = items
      .slice(0, 100)
      .map((it) => ({
        nazwa: String(it?.nazwa || '').slice(0, 80),
        ilosc_szacunkowa: String(it?.ilosc_szacunkowa || '').slice(0, 60),
      }))
      .filter((it) => it.nazwa);

    const data = pantryData();
    const spis = { id: nanoid(8), ts: Date.now(), items: cleanItems };
    data.pantry2.spisy.push(spis);
    if (data.pantry2.spisy.length > MAX_SPISY) {
      data.pantry2.spisy = data.pantry2.spisy.slice(-MAX_SPISY);
    }
    save(data);

    res.json({ spis });
  } catch (err) {
    console.error('pantry scan error:', err);
    res.status(500).json({ error: 'Nie udalo sie przeanalizowac zapasow.' });
  }
});

// GET / - lista zapisanych spisow (bez ponownej analizy).
router.get('/', requireOwner, (req, res) => {
  res.json({ spisy: pantryData().pantry2.spisy });
});

// GET /compare - porownanie dwoch ostatnich spisow: co ubylo / przybylo.
router.get('/compare', requireOwner, (req, res) => {
  const spisy = pantryData().pantry2.spisy;
  if (spisy.length < 2) {
    return res.status(409).json({ error: 'Potrzebne co najmniej dwa zapisane spisy do porownania.' });
  }
  const [prev, curr] = spisy.slice(-2);
  const prevNames = new Set(prev.items.map((i) => i.nazwa.toLowerCase()));
  const currNames = new Set(curr.items.map((i) => i.nazwa.toLowerCase()));

  const ubylo = prev.items.filter((i) => !currNames.has(i.nazwa.toLowerCase()));
  const przybylo = curr.items.filter((i) => !prevNames.has(i.nazwa.toLowerCase()));

  res.json({
    poprzedni: { id: prev.id, ts: prev.ts },
    aktualny: { id: curr.id, ts: curr.ts },
    ubylo,
    przybylo,
  });
});

export default router;
