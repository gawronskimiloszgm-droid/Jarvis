// Analiza dlugich plikow i ekranu.
//
// - POST /api/docs            wczytuje plik (PDF, DOCX, obraz, tekst/kod/CSV/JSON...)
// - POST /api/docs/:id/summary streszczenie (map-reduce dla naprawde dlugich tekstow)
// - POST /api/docs/:id/ask     pytanie do dokumentu (caly tekst albo najlepsze fragmenty)
// - POST /api/screen/analyze   zrzut ekranu + pytanie -> odpowiedz
//
// Dokumenty zyja w pamieci procesu (kilka godzin, ograniczona liczba) - to
// robocza przestrzen do analizy, nie archiwum. Gemini ma bardzo dlugi
// kontekst, wiec do ~350 tys. znakow wysylamy CALY tekst (najlepsza jakosc,
// bez ryzyka, ze wyszukiwanie pominie wlasciwy fragment); dopiero powyzej
// przechodzimy na streszczanie kawalkami i wyszukiwanie.

import express from 'express';
import { nanoid } from 'nanoid';
import { GoogleGenAI } from '@google/genai';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import { registerContextProvider } from '../core/jarvis.js';
import { chunkText, rankChunks } from './textutils.js';

const router = express.Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_BYTES = 45 * 1024 * 1024;
const MAX_DOCS = 12;
const TTL_MS = 6 * 60 * 60 * 1000;
const WHOLE_DOC_LIMIT = 350_000;
const MAP_CHUNK = 60_000;

const docs = new Map();
let currentId = null;

function sweep() {
  const now = Date.now();
  for (const [id, d] of docs) if (now - d.touchedAt > TTL_MS) docs.delete(id);
  while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value);
  if (currentId && !docs.has(currentId)) currentId = null;
}

function ext(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  let bad = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) bad++;
  return bad > 2;
}

async function gen(parts, systemInstruction) {
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: systemInstruction ? { systemInstruction } : undefined,
    })
  );
  return String(res.text || '').trim();
}

async function extractText(name, mime, buf) {
  const e = ext(name);
  if (e === 'pdf' || mime === 'application/pdf') {
    // Importujemy plik biblioteczny wprost - indeks pdf-parse przy imporcie
    // probuje czytac wlasny plik testowy (znany blad tej paczki).
    const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const out = await pdf(buf);
    if (out.text && out.text.trim().length > 40) return { text: out.text, pages: out.numpages };
    // Skan bez warstwy tekstowej - oddajemy do OCR przez model z obrazem.
    const text = await gen(
      [{ inlineData: { mimeType: 'application/pdf', data: buf.toString('base64') } }, { text: 'Przepisz CALY tekst z tego dokumentu dokladnie tak, jak jest, strona po stronie. Bez komentarzy.' }]
    );
    return { text, pages: out.numpages, ocr: true };
  }
  if (e === 'docx') {
    const mammoth = (await import('mammoth')).default;
    const out = await mammoth.extractRawText({ buffer: buf });
    return { text: out.value };
  }
  if (IMAGE_MIME[e] || String(mime).startsWith('image/')) {
    const text = await gen([
      { inlineData: { mimeType: IMAGE_MIME[e] || mime, data: buf.toString('base64') } },
      { text: 'Przepisz caly widoczny tekst z tego obrazu. Jesli to wykres, tabela lub diagram - opisz dokladnie jego tresc i liczby. Po polsku, bez komentarzy.' },
    ]);
    return { text, ocr: true };
  }
  if (e === 'doc' || e === 'xls' || e === 'xlsx' || e === 'pptx' || e === 'zip' || e === 'exe') {
    throw new Error(`Format .${e} nie jest obslugiwany (obslugiwane: PDF, DOCX, obrazy, tekst/kod/CSV/JSON).`);
  }
  if (looksBinary(buf)) throw new Error('To wyglada na plik binarny, ktorego nie umiem odczytac jako tekst.');
  return { text: buf.toString('utf8') };
}

function publicView(d) {
  return { id: d.id, name: d.name, chars: d.text.length, chunks: d.chunks.length, pages: d.pages || null, ocr: Boolean(d.ocr), hasSummary: Boolean(d.summary), at: d.at };
}

router.post('/api/docs', requireOwner, express.json({ limit: '70mb' }), async (req, res) => {
  try {
    const { name = 'plik', mime = '', dataBase64 = '' } = req.body || {};
    const buf = Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Pusty plik.' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: `Plik jest za duzy (limit ${Math.round(MAX_BYTES / 1048576)} MB).` });
    const { text, pages, ocr } = await extractText(name, mime, buf);
    if (!text || !text.trim()) return res.status(422).json({ error: 'Nie znalazlem w tym pliku zadnego tekstu.' });
    sweep();
    const id = nanoid(8);
    const doc = { id, name, text, chunks: chunkText(text), pages, ocr, summary: '', at: Date.now(), touchedAt: Date.now() };
    docs.set(id, doc);
    currentId = id;
    res.json(publicView(doc));
  } catch (err) {
    console.error('docs upload:', err.message);
    res.status(500).json({ error: err.message || 'Nie udalo sie wczytac pliku.' });
  }
});

router.get('/api/docs', requireOwner, (req, res) => {
  sweep();
  res.json({ current: currentId, docs: [...docs.values()].map(publicView) });
});

router.post('/api/docs/:id/select', requireOwner, (req, res) => {
  if (!docs.has(req.params.id)) return res.status(404).json({ error: 'Nie ma takiego dokumentu.' });
  currentId = req.params.id;
  res.json({ ok: true });
});

router.delete('/api/docs/:id', requireOwner, (req, res) => {
  docs.delete(req.params.id);
  if (currentId === req.params.id) currentId = null;
  res.json({ ok: true });
});

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const SUMMARY_PROMPT =
  'Streszczasz dokument po polsku. Zrob: 1) 2-3 zdania "o czym to jest", 2) najwazniejsze punkty z podzialem na sekcje dokumentu, 3) konkretne liczby, daty, nazwy i zobowiazania, jesli sa, 4) otwarte pytania lub braki. Nie zmyslaj - tylko to, co jest w tekscie.';

async function summarize(doc) {
  if (doc.summary) return doc.summary;
  if (doc.text.length <= WHOLE_DOC_LIMIT) {
    doc.summary = await gen([{ text: `${SUMMARY_PROMPT}\n\nDOKUMENT "${doc.name}":\n\n${doc.text}` }]);
    return doc.summary;
  }
  // Map-reduce dla naprawde dlugich tekstow.
  const pieces = chunkText(doc.text, MAP_CHUNK, 600);
  const partials = await mapLimit(pieces, 3, (p, i) =>
    gen([{ text: `Streszcz czesc ${i + 1}/${pieces.length} dlugiego dokumentu "${doc.name}" po polsku, zachowujac liczby, daty, nazwy i zobowiazania. 150-250 slow.\n\n${p}` }])
  );
  doc.summary = await gen([
    { text: `${SUMMARY_PROMPT}\n\nPonizej streszczenia kolejnych czesci dokumentu "${doc.name}" (${pieces.length} czesci). Zloz z nich jedno spojne streszczenie calosci.\n\n${partials.map((p, i) => `--- CZESC ${i + 1} ---\n${p}`).join('\n\n')}` },
  ]);
  return doc.summary;
}

router.post('/api/docs/:id/summary', requireOwner, async (req, res) => {
  const doc = docs.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nie ma takiego dokumentu (wygasl?). Wczytaj go ponownie.' });
  try {
    doc.touchedAt = Date.now();
    res.json({ summary: await summarize(doc) });
  } catch (err) {
    console.error('docs summary:', err.message);
    res.status(500).json({ error: 'Streszczenie nie wyszlo - sprobuj ponownie.' });
  }
});

async function ask(doc, question) {
  const sys = `Odpowiadasz na pytania o dokument "${doc.name}". Opieraj sie WYLACZNIE na jego tresci. Jesli odpowiedzi nie ma w tekscie, powiedz to wprost. Cytuj krotkie fragmenty i podawaj numery czesci [#n], gdy je znasz. Odpowiadaj po polsku, konkretnie.`;
  if (doc.text.length <= WHOLE_DOC_LIMIT) {
    return { answer: await gen([{ text: `DOKUMENT:\n\n${doc.text}\n\nPYTANIE: ${question}` }], sys), mode: 'calosc' };
  }
  const idx = rankChunks(doc.chunks, question, 8).sort((a, b) => a - b);
  const context = idx.map((i) => `[#${i + 1}]\n${doc.chunks[i]}`).join('\n\n---\n\n');
  const summary = await summarize(doc).catch(() => '');
  return {
    answer: await gen([{ text: `STRESZCZENIE CALOSCI:\n${summary}\n\nNAJBARDZIEJ PASUJACE FRAGMENTY:\n\n${context}\n\nPYTANIE: ${question}` }], sys),
    mode: 'fragmenty',
    sources: idx.map((i) => i + 1),
  };
}

router.post('/api/docs/:id/ask', requireOwner, async (req, res) => {
  const doc = docs.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nie ma takiego dokumentu (wygasl?). Wczytaj go ponownie.' });
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Brak pytania.' });
  try {
    doc.touchedAt = Date.now();
    res.json(await ask(doc, question.slice(0, 2000)));
  } catch (err) {
    console.error('docs ask:', err.message);
    res.status(500).json({ error: 'Nie udalo sie odpowiedziec - sprobuj ponownie.' });
  }
});

// --- Analiza ekranu ---

router.post('/api/screen/analyze', requireOwner, express.json({ limit: '25mb' }), async (req, res) => {
  const { imageBase64, mimeType = 'image/png', question = '' } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'Brak obrazu.' });
  try {
    const answer = await gen(
      [
        { inlineData: { mimeType, data: String(imageBase64).replace(/^data:[^;]+;base64,/, '') } },
        { text: String(question).trim() || 'Opisz, co jest teraz na ekranie: jaka aplikacja, co robi uzytkownik, jakie sa widoczne bledy lub wazne informacje.' },
      ],
      'To zrzut ekranu komputera wlasciciela. Odpowiadaj po polsku, konkretnie. Czytaj widoczny tekst dokladnie. Jesli ktos pyta "gdzie kliknac", podaj polozenie jako przyblizony procent szerokosci i wysokosci ekranu (x%, y%) oraz nazwe elementu.'
    );
    res.json({ answer });
  } catch (err) {
    console.error('screen analyze:', err.message);
    res.status(500).json({ error: 'Nie udalo sie przeanalizowac ekranu.' });
  }
});

// --- Kontekst dla rozmowy z Jarvisem ---
// Gdy w pracy jest dokument, a pytanie go dotyczy (albo dokument wczytano
// przed chwila), Jarvis dostaje jego streszczenie i pasujace fragmenty -
// dzieki temu "co jest w tej umowie o terminach?" dziala tez w zwyklym czacie.
const DOC_WORDS = /\b(dokument|plik|pdf|umow|tekst|raport|notatk|ten plik|tej umowie|powyzsz|wczytan)/i;
registerContextProvider(async (message) => {
  sweep();
  const doc = currentId && docs.get(currentId);
  if (!doc) return '';
  const fresh = Date.now() - doc.at < 20 * 60 * 1000;
  if (!fresh && !DOC_WORDS.test(String(message || ''))) return '';
  doc.touchedAt = Date.now();
  const head = `\nWCZYTANY DOKUMENT "${doc.name}" (${doc.text.length} znakow) - jesli pytanie go dotyczy, odpowiadaj na jego podstawie:\n`;
  if (doc.text.length <= 14_000) return `${head}${doc.text}`;
  const idx = rankChunks(doc.chunks, message, 3).sort((a, b) => a - b);
  const frags = idx.map((i) => `[#${i + 1}] ${doc.chunks[i].slice(0, 4000)}`).join('\n---\n');
  return `${head}${doc.summary ? `Streszczenie: ${doc.summary.slice(0, 3000)}\n` : ''}Pasujace fragmenty:\n${frags}`;
});

// Dla rozmowy glosowej: pytanie do ostatnio wczytanego dokumentu.
export async function askCurrent(question) {
  sweep();
  const doc = currentId && docs.get(currentId);
  if (!doc) return { error: 'nie ma wczytanego dokumentu - poproszono uzytkownika o wczytanie pliku' };
  doc.touchedAt = Date.now();
  const r = await ask(doc, String(question || '').slice(0, 2000));
  return { dokument: doc.name, odpowiedz: r.answer };
}

export function currentDocName() {
  sweep();
  return currentId && docs.get(currentId) ? docs.get(currentId).name : null;
}

export default router;
