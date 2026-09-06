// Biblioteka wlasnych dokumentow uzytkownika + proste "RAG" bez wektorowej
// bazy danych (#135 zapis i pytania, #140 lista z metadanymi).
//
// Dlaczego bez embeddingow/bazy wektorowej: przy skali, w jakiej ten projekt
// dziala (jeden uzytkownik, jeden proces, rozsadna liczba wklejonych
// dokumentow - notatki, artykul, kilka umow), dopasowanie po slowach
// kluczowych + wrzucenie calego pasujacego tekstu do kontekstu Gemini daje
// ten sam efekt co wektorowe wyszukiwanie, bez dokladania kolejnej uslugi
// (indeksacja, embedding API), ktora moglaby padac albo kosztowac ekstra.

import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { nanoid } from 'nanoid';
import { withModel } from './geminiChain.js';
import { requireOwner } from './auth.js';
import * as memory from './memory.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Twardy sufit na dlugosc jednego dokumentu, zeby wklejona ksiazka nie
// zjadla calego limitu kontekstu promptu przy kazdym pytaniu.
const MAX_DOC_CHARS = 20000;
// Ponizej tych progow wrzucamy WSZYSTKIE dokumenty w calosci do promptu -
// dopasowanie po slowach kluczowych wlacza sie dopiero, gdy biblioteka
// urosnie na tyle, ze wszystko naraz by sie nie zmiescilo.
const FULL_CONTEXT_DOC_LIMIT = 8;
const FULL_CONTEXT_CHAR_LIMIT = 40000;
const TOP_K_BY_KEYWORDS = 5;

function store() {
  const data = memory.load();
  // Konwencja z reszty projektu: nowy klucz w pamieci dopisywany leniwie,
  // bez ruszania server/memory.js.
  if (!data.knowledgeBase || !Array.isArray(data.knowledgeBase.documents)) {
    data.knowledgeBase = { documents: [] };
  }
  return data;
}

const TAG_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tagi: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['tagi'],
};

// Tagowanie jest dodatkiem (#140: "jesli Gemini je automatycznie przypisze")
// - blad tutaj NIE moze zablokowac zapisu dokumentu.
async function autoTag(name, text) {
  try {
    const res = await withModel((model) =>
      ai.models.generateContent({
        model,
        contents:
          'Nadaj 2-4 krotkie tagi (jedno-dwa slowa, po polsku, male litery, bez znakow specjalnych) ' +
          `opisujace ponizszy dokument.\n\nNazwa: ${name}\n\nTresc (fragment):\n${text.slice(0, 4000)}`,
        config: { responseMimeType: 'application/json', responseSchema: TAG_SCHEMA },
      })
    );
    const parsed = JSON.parse(res.text);
    if (!Array.isArray(parsed.tagi)) return [];
    return parsed.tagi
      .map((t) => String(t).toLowerCase().trim())
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}

/**
 * Zapisuje dokument w bibliotece. #135: "endpoint POST /documents przyjmujacy
 * tekst dokumentu + nazwe".
 * @param {string} name
 * @param {string} text
 */
export async function addDocument(name, text) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Pusta tresc dokumentu.');
  const cleanName = String(name || 'bez nazwy').trim().slice(0, 120) || 'bez nazwy';
  const truncated = clean.slice(0, MAX_DOC_CHARS);

  const tags = await autoTag(cleanName, truncated);

  const data = store();
  const doc = {
    id: nanoid(10),
    name: cleanName,
    text: truncated,
    length: truncated.length,
    tags,
    addedAt: Date.now(),
  };
  data.knowledgeBase.documents.push(doc);
  memory.save(data);
  return { id: doc.id, name: doc.name, length: doc.length, tags: doc.tags, addedAt: doc.addedAt };
}

/** #140: liste dokumentow/notatek z metadanymi, bez pelnej tresci. */
export function listDocuments() {
  return store()
    .knowledgeBase.documents.map(({ id, name, length, tags, addedAt }) => ({ id, name, length, tags, addedAt }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

export function removeDocument(id) {
  const data = store();
  data.knowledgeBase.documents = data.knowledgeBase.documents.filter((d) => d.id !== id);
  memory.save(data);
  return listDocuments();
}

// Proste dopasowanie po slowach kluczowych - bez biblioteki NLP. Liczymy
// "wazne" slowa (>=4 znaki, bez najczestszych partykul PL/EN) wspolne dla
// pytania i dokumentu; im wiecej trafien, tym wyzej dokument w rankingu.
const STOPWORDS = new Set([
  'jest', 'jak', 'czy', 'oraz', 'tego', 'tych', 'ktory', 'ktora', 'ktore', 'dla', 'przez', 'tylko', 'moze',
  'sie', 'nie', 'ale', 'tak', 'jaka', 'jakie', 'kiedy', 'gdzie', 'ktos', 'cos', 'bardzo', 'tylko',
  'the', 'and', 'for', 'are', 'with', 'that', 'this', 'from', 'have', 'what', 'when', 'where', 'which',
]);

function keywords(text) {
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    )
  );
}

function pickRelevant(question, docs) {
  const totalChars = docs.reduce((sum, d) => sum + d.length, 0);
  if (docs.length <= FULL_CONTEXT_DOC_LIMIT && totalChars <= FULL_CONTEXT_CHAR_LIMIT) {
    return docs; // malo dokumentow - wrzucamy wszystkie, dopasowanie niepotrzebne
  }
  const qWords = keywords(question);
  if (!qWords.length) return docs.slice(0, TOP_K_BY_KEYWORDS);

  const scored = docs.map((d) => {
    const docWords = new Set(keywords(`${d.text} ${d.name}`));
    const score = qWords.reduce((s, w) => s + (docWords.has(w) ? 1 : 0), 0);
    return { doc: d, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const withScore = scored.filter((s) => s.score > 0).slice(0, TOP_K_BY_KEYWORDS);
  const top = withScore.length ? withScore : scored.slice(0, TOP_K_BY_KEYWORDS);
  return top.map((s) => s.doc);
}

/**
 * #135: odpowiada na pytanie na podstawie zapisanych dokumentow, z
 * odniesieniem do zrodla (nazwy dokumentu).
 */
export async function askKnowledgeBase(question) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Puste pytanie.');

  const docs = store().knowledgeBase.documents;
  if (!docs.length) {
    return { answer: 'Biblioteka dokumentow jest pusta - nie mam z czego odpowiedziec.', sources: [] };
  }

  const relevant = pickRelevant(q, docs);
  const context = relevant.map((d, i) => `[Dokument ${i + 1}: "${d.name}"]\n${d.text}`).join('\n\n---\n\n');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        'Ponizej fragmenty biblioteki dokumentow uzytkownika. Odpowiedz na pytanie WYLACZNIE na ich podstawie.\n' +
        'Jesli odpowiedzi nie ma w dokumentach, powiedz to wprost zamiast zgadywac.\n' +
        'Przy odpowiedzi wskaz, z ktorego dokumentu (nazwa) pochodzi kluczowa informacja.\n\n' +
        `${context}\n\n---\n\nPytanie: ${q}`,
    })
  );

  return {
    answer: (res.text || '').trim(),
    sources: relevant.map((d) => d.name),
  };
}

export const router = Router();
// Biblioteka dokumentow i pytania do niej to dane osobiste - tak samo
// zastrzezone jak pamiec/zadania/wydatki gdzie indziej w projekcie.
router.use(requireOwner);

router.post('/documents', async (req, res) => {
  try {
    const doc = await addDocument(req.body?.name, req.body?.text);
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/documents', (req, res) => {
  res.json(listDocuments());
});

router.delete('/documents/:id', (req, res) => {
  res.json(removeDocument(req.params.id));
});

router.post('/ask', async (req, res) => {
  try {
    const result = await askKnowledgeBase(req.body?.pytanie ?? req.body?.question);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
