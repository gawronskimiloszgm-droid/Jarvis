// Wizja 2: cztery funkcje oparte na Gemini Vision, ktore dziela wspolny
// wzorzec z modules/perimeter/vision.js i modules/receipts/scan.js, ale nie
// pasuja do zadnego istniejacego modulu:
//   #91  ciagly, tani monitoring sceny (throttling + wykrywanie zmiany opisu)
//   #92  lokalizowanie przedmiotu w ostatniej znanej klatce danej kamery
//   #93  OCR - przepisanie widocznego tekstu
//   #100 roznice miedzy dwoma zdjeciami tego samego pomieszczenia
//
// Router eksportowany, NIE montowany tutaj - patrz raport koncowy co do
// sciezki montowania w server/index.js.

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { imagePart } from './vision.js';
import { withModel } from '../core/geminiChain.js';
import { requireOwner } from '../core/auth.js';
import * as bus from '../core/bus.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const router = express.Router();

function requireApiKey(res) {
  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: 'Brak skonfigurowanego GEMINI_API_KEY na serwerze.' });
    return false;
  }
  return true;
}

// Klient przesyla obraz jako data URL (np. "data:image/jpeg;base64,...") albo
// juz sam surowy base64 - oba warianty widzimy w istniejacych endpointach
// (/api/vision, /api/cameras/frame), wiec akceptujemy tak samo tutaj.
function stripDataUrl(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}

function parseJsonReply(raw, fallback) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { ...fallback, parseFailed: true, raw: cleaned.slice(0, 300) };
  }
}

// --- #91: ciagla analiza obrazu przy niskim koszcie probkowania ---
//
// Throttling PO STRONIE SERWERA: klatki czesciej niz co MONITOR_INTERVAL_MS
// sa odrzucane bez wywolania Gemini, zeby darmowy tier (i budzet) nie
// dostawal spamu z frontendu, ktory probkuje kamere co sekunde.
const MONITOR_INTERVAL_MS = Number(process.env.VISION2_MONITOR_INTERVAL_MS || 30_000);

// Stan per-kamera: ostatni opis sceny + kiedy probkowano. Celowo w pamieci
// procesu (jak lastAnalyzedAt w cameras.js) - to dane robocze do wykrywania
// zmiany "teraz", a nie cos, co ma przetrwac restart.
const monitorState = new Map(); // camera -> { lastDescription, lastAt, lastSampledAt }

// Ten sam magazyn slada za "ostatnia znana klatka danej kamery" dla #92 -
// patrz komentarz przy /locate nizej, dlaczego cameras.js nie wystarcza.
const frameCache = new Map(); // camera -> { base64, mimeType, at }

const MONITOR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    changed: { type: Type.BOOLEAN },
    reason: { type: Type.STRING },
  },
  required: ['description', 'changed'],
};

function monitorPrompt(previousDescription) {
  const base = `Jestes systemem monitoringu pomieszczenia/otoczenia. Dostajesz JEDNA aktualna klatke z kamery.
Opisz krotko (1 zdanie po polsku), co widac.`;
  if (!previousDescription) {
    return `${base}\n\nTo pierwsza probka z tej kamery, wiec "changed" ustaw na true.\n\nZwroc WYLACZNIE obiekt JSON: {"description": string, "changed": true, "reason": "pierwsza probka"}`;
  }
  return `${base}

Poprzedni opis tej samej kamery (chwile wczesniej) brzmial:
"${previousDescription}"

Porownaj to, co widzisz teraz, z tamtym opisem. "changed" ustaw na true TYLKO gdy scena
zmienila sie w sposob ISTOTNY (pojawila/zniknela osoba, przedmiot, pojazd, stan czegos
zauwazalnie inny). Zmiany oswietlenia, drobne cienie, szum kamery - to NIE jest changed.

Zwroc WYLACZNIE obiekt JSON (bez markdown):
{"description": string, "changed": boolean, "reason": string - krotkie uzasadnienie decyzji}`;
}

router.post('/monitor', requireOwner, async (req, res) => {
  if (!requireApiKey(res)) return;
  const { camera, image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak obrazu.' });
  const cam = String(camera || 'kamera').slice(0, 40);
  const base64 = stripDataUrl(image);
  const mt = mimeType || 'image/jpeg';

  // Cache klatki aktualizujemy ZAWSZE, nawet gdy throttling ominie analize -
  // #92 ma wtedy najswiezszy mozliwy obraz do lokalizowania przedmiotow.
  frameCache.set(cam, { base64, mimeType: mt, at: Date.now() });

  const now = Date.now();
  const state = monitorState.get(cam) || { lastDescription: '', lastAt: 0, lastSampledAt: 0 };
  if (now - state.lastSampledAt < MONITOR_INTERVAL_MS) {
    return res.json({
      skipped: true,
      reason: 'throttled',
      nextAllowedInMs: MONITOR_INTERVAL_MS - (now - state.lastSampledAt),
    });
  }
  state.lastSampledAt = now;
  monitorState.set(cam, state);

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [imagePart(base64, mt), { text: monitorPrompt(state.lastDescription) }],
        config: { responseMimeType: 'application/json', responseSchema: MONITOR_SCHEMA },
      })
    );
    const parsed = parseJsonReply(result.text, { description: '', changed: false, reason: 'blad parsowania' });
    const description = String(parsed.description || '').slice(0, 300);
    const changed = Boolean(parsed.changed);

    if (changed) {
      bus.publish('vision2', 'monitor.change', `${cam}: ${description}`, {
        level: 'info',
        data: { camera: cam, previousDescription: state.lastDescription, reason: parsed.reason || null },
      });
    }
    state.lastDescription = description || state.lastDescription;
    state.lastAt = now;
    monitorState.set(cam, state);

    res.json({ skipped: false, camera: cam, description, changed, reason: parsed.reason || null });
  } catch (err) {
    console.error('vision2 monitor error:', err);
    res.status(500).json({ error: 'Nie udalo sie przeanalizowac klatki.' });
  }
});

// Podglad stanu monitoringu (HUD/debug) - bez wywolywania Gemini.
router.get('/monitor/status', requireOwner, (req, res) => {
  const cameras = [...monitorState.entries()].map(([camera, s]) => ({
    camera,
    lastDescription: s.lastDescription,
    lastAt: s.lastAt || null,
    hasCachedFrame: frameCache.has(camera),
  }));
  res.json({ cameras, intervalMs: MONITOR_INTERVAL_MS });
});

// --- #92: rozpoznawanie obiektow i lokalizowanie ich ---
//
// UWAGA (patrz raport): server/cameras.js NIE eksportuje niczego do odczytu
// ostatniej klatki - trzyma tylko znaczniki czasu (lastAnalyzedAt,
// lastHeartbeatAt), nie surowy bufor obrazu. Prawdziwe kamery obwodowe
// (home-server/camera-watcher.js -> POST /api/cameras/frame) NIE traktowaly
// wiec swoich klatek jako cos, co da sie pozniej odczytac gdzie indziej.
//
// Zamiast tego /locate korzysta z WLASNEGO frameCache powyzej, ktory
// wypelnia sie z POST /monitor (i z /frame-cache nizej). To dziala od razu
// dla kamer podpietych pod nowy monitoring; podpiecie pod ISTNIEJACY tor
// kamer obwodowych wymaga zmiany w cameras.js (poza zakresem tego batcha).
const LOCATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    seen: { type: Type.BOOLEAN },
    location: { type: Type.STRING },
    opis: { type: Type.STRING },
    pewnosc: { type: Type.NUMBER },
  },
  required: ['seen'],
};

const FRAME_MAX_AGE_MS = 5 * 60 * 1000;

// Lekki zapis klatki do cache bez platnej analizy Gemini - przydatny, gdy
// zrodlo obrazu chce tylko "odswiezyc" to, co widzi /locate, bez platnego
// wywolania co probke.
router.post('/frame-cache', requireOwner, (req, res) => {
  const { camera, image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak obrazu.' });
  const cam = String(camera || 'kamera').slice(0, 40);
  frameCache.set(cam, { base64: stripDataUrl(image), mimeType: mimeType || 'image/jpeg', at: Date.now() });
  res.json({ ok: true, camera: cam });
});

router.post('/locate', requireOwner, async (req, res) => {
  if (!requireApiKey(res)) return;
  const { camera, image, mimeType, question } = req.body || {};
  const pytanie = String(question || '').trim();
  if (!pytanie) return res.status(400).json({ error: 'Brak pytania o obiekt (np. "gdzie sa moje klucze").' });

  let base64, mt;
  if (image) {
    base64 = stripDataUrl(image);
    mt = mimeType || 'image/jpeg';
  } else if (camera) {
    const cam = String(camera).slice(0, 40);
    const cached = frameCache.get(cam);
    if (!cached) {
      return res
        .status(404)
        .json({ error: `Brak zapisanej klatki dla kamery "${cam}". Wyslij obraz albo najpierw nakarm /api/vision2/frame-cache.` });
    }
    if (Date.now() - cached.at > FRAME_MAX_AGE_MS) {
      return res.status(409).json({ error: `Ostatnia klatka z kamery "${cam}" jest zbyt stara (>5 min).` });
    }
    base64 = cached.base64;
    mt = cached.mimeType;
  } else {
    return res.status(400).json({ error: 'Podaj "image" albo "camera".' });
  }

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          imagePart(base64, mt),
          {
            text: `Uzytkownik szuka: "${pytanie}".

Sprawdz, czy ten przedmiot (lub cos bardzo do niego podobnego) jest widoczny na obrazie.
Jesli tak, opisz PRECYZYJNIE gdzie w kadrze (np. "na stole po lewej stronie", "na podlodze
pod krzeslem", "w prawym gornym rogu kadru").

Zwroc WYLACZNIE obiekt JSON (bez markdown):
{"seen": boolean, "location": string|null - gdzie w kadrze, "opis": string - krotkie uzasadnienie, "pewnosc": number 0-1}`,
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema: LOCATE_SCHEMA },
      })
    );
    const parsed = parseJsonReply(result.text, { seen: false, location: null, opis: '', pewnosc: 0 });
    res.json({
      seen: Boolean(parsed.seen),
      location: parsed.location ? String(parsed.location).slice(0, 200) : null,
      opis: String(parsed.opis || '').slice(0, 300),
      pewnosc: Number.isFinite(parsed.pewnosc) ? Math.max(0, Math.min(1, parsed.pewnosc)) : null,
    });
  } catch (err) {
    console.error('vision2 locate error:', err);
    res.status(500).json({ error: 'Nie udalo sie przeanalizowac obrazu.' });
  }
});

// --- #93: czytanie tekstu z kamery na zywo (OCR) ---
router.post('/ocr', requireOwner, async (req, res) => {
  if (!requireApiKey(res)) return;
  const { image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak obrazu.' });
  const base64 = stripDataUrl(image);
  const mt = mimeType || 'image/jpeg';

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          imagePart(base64, mt),
          {
            text: `Przepisz DOKLADNIE caly widoczny tekst na tym obrazie (etykiety, dokumenty, ekrany,
tabliczki). Zachowaj oryginalny jezyk i wielkosc liter. Nie tlumacz, nie interpretuj,
nie dodawaj komentarzy - sam surowy tekst tak jak widoczny, linia po linii. Jesli nie ma
zadnego czytelnego tekstu, zwroc dokladnie: (brak tekstu)`,
          },
        ],
      })
    );
    const text = String(result.text || '').trim();
    res.json({ text, found: text.length > 0 && text !== '(brak tekstu)' });
  } catch (err) {
    console.error('vision2 ocr error:', err);
    res.status(500).json({ error: 'Nie udalo sie odczytac tekstu.' });
  }
});

// --- #100: sledzenie zmian w pomieszczeniu miedzy zdjeciami (przed/po) ---
const ROOM_DIFF_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    streszczenie: { type: Type.STRING },
    zmiany: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          opis: { type: Type.STRING },
          waga: { type: Type.STRING, enum: ['kosmetyczna', 'istotna'] },
        },
        required: ['opis'],
      },
    },
  },
  required: ['streszczenie'],
};

router.post('/room-diff', requireOwner, async (req, res) => {
  if (!requireApiKey(res)) return;
  const { before, after, mimeTypeBefore, mimeTypeAfter } = req.body || {};
  if (!before || !after) return res.status(400).json({ error: 'Potrzebne oba obrazy: "before" i "after".' });

  try {
    const result = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents: [
          { text: 'Pierwszy obraz ("PRZED") i drugi obraz ("PO") pokazuja to samo pomieszczenie w dwoch momentach.' },
          { text: 'PRZED:' },
          imagePart(stripDataUrl(before), mimeTypeBefore || 'image/jpeg'),
          { text: 'PO:' },
          imagePart(stripDataUrl(after), mimeTypeAfter || 'image/jpeg'),
          {
            text: `Opisz rzeczowo, co sie zmienilo miedzy PRZED a PO (przesuniete/zniknietiete/nowe przedmioty,
zmieniony porzadek, zmiana stanu czegos). Pomin zmiany samego oswietlenia/pory dnia,
chyba ze to jedyna roznica warta wzmianki.

Zwroc WYLACZNIE obiekt JSON (bez markdown):
{"streszczenie": string - 1-2 zdania, "zmiany": [{"opis": string, "waga": "kosmetyczna"|"istotna"}]}`,
          },
        ],
        config: { responseMimeType: 'application/json', responseSchema: ROOM_DIFF_SCHEMA },
      })
    );
    const parsed = parseJsonReply(result.text, { streszczenie: '', zmiany: [] });
    res.json({
      streszczenie: String(parsed.streszczenie || '').slice(0, 500),
      zmiany: Array.isArray(parsed.zmiany)
        ? parsed.zmiany.slice(0, 30).map((z) => ({
            opis: String(z?.opis || '').slice(0, 300),
            waga: z?.waga === 'istotna' ? 'istotna' : 'kosmetyczna',
          }))
        : [],
    });
  } catch (err) {
    console.error('vision2 room-diff error:', err);
    res.status(500).json({ error: 'Nie udalo sie porownac obrazow.' });
  }
});

export default router;
