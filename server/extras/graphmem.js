// Pamiec w postaci grafu: model wyciaga z rozmow, faktow i notatek pojecia oraz powiazania miedzy nimi,
// a graf rosnie z czasem. Zasila modul Graf wiedzy i odpowiada na pytanie "co wiem o X?".
import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { nanoid } from 'nanoid';
import { requireOwner } from '../core/auth.js';
import { withModel } from '../core/geminiChain.js';
import * as memory from '../memory/memory.js';
import { logJournal } from './life.js';

const router = Router();
const MAX_CONCEPTS = 300;
const TYPES = ['osoba', 'miejsce', 'projekt', 'temat', 'rzecz', 'cel'];

const STRIP = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const keyOf = (s) => String(s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => STRIP[c]).replace(/\s+/g, ' ').trim();

const store = () => {
  const d = memory.load();
  if (!d.knowledge || typeof d.knowledge !== 'object') d.knowledge = { concepts: [], relations: [], learnedAt: 0 };
  return d.knowledge;
};

/** Laczy wynik modelu z istniejacym grafem. Czysta funkcja (testy): te same nazwy to ten sam wezel. */
export function mergeGraph(cur, extracted, now = Date.now(), makeId = () => nanoid(8)) {
  const concepts = (cur.concepts || []).map((c) => ({ ...c }));
  const relations = (cur.relations || []).map((r) => ({ ...r }));
  const byKey = new Map(concepts.map((c) => [keyOf(c.name), c]));
  (extracted.concepts || []).forEach((raw) => {
    const name = String(raw?.name || '').trim().slice(0, 60);
    const key = keyOf(name);
    if (key.length < 2) return;
    const summary = String(raw.summary || '').trim().slice(0, 300);
    const type = TYPES.includes(raw.type) ? raw.type : 'temat';
    const hit = byKey.get(key);
    if (hit) {
      hit.mentions = (hit.mentions || 1) + 1;
      hit.at = now;
      if (summary.length > (hit.summary || '').length) hit.summary = summary;
    } else {
      const c = { id: makeId(), name, type, summary, mentions: 1, at: now };
      concepts.push(c);
      byKey.set(key, c);
    }
  });
  (extracted.relations || []).forEach((raw) => {
    const a = byKey.get(keyOf(raw?.a));
    const b = byKey.get(keyOf(raw?.b));
    if (!a || !b || a === b) return;
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const hit = relations.find((r) => r.a === x && r.b === y);
    if (hit) {
      hit.w = Math.min(5, (hit.w || 1) + 1);
      if (raw.label) hit.label = String(raw.label).slice(0, 60);
    } else {
      relations.push({ a: x, b: y, label: String(raw.label || '').slice(0, 60), w: 1 });
    }
  });
  // Limit: wypadaja najrzadziej wspominane i najstarsze.
  concepts.sort((p, q) => (q.mentions || 1) - (p.mentions || 1) || (q.at || 0) - (p.at || 0));
  const kept = concepts.slice(0, MAX_CONCEPTS);
  const ids = new Set(kept.map((c) => c.id));
  return { concepts: kept, relations: relations.filter((r) => ids.has(r.a) && ids.has(r.b)) };
}

/** Co wiemy o temacie: pojecie, jego sasiedzi i pasujace fakty z pamieci. */
export function lookup(graph, facts, term) {
  const q = keyOf(term);
  if (!q) return null;
  const words = q.split(' ').filter((w) => w.length >= 3);
  const concepts = graph.concepts || [];
  const concept = concepts.find((c) => keyOf(c.name) === q) || concepts.find((c) => keyOf(c.name).includes(q) || q.includes(keyOf(c.name))) || null;
  const related = [];
  if (concept) {
    (graph.relations || []).forEach((r) => {
      if (r.a !== concept.id && r.b !== concept.id) return;
      const other = concepts.find((c) => c.id === (r.a === concept.id ? r.b : r.a));
      if (other) related.push({ name: other.name, relation: r.label || '' });
    });
  }
  const match = (facts || [])
    .map((f) => (typeof f === 'string' ? f : f?.text || ''))
    .filter((t) => t && (words.length ? words.some((w) => keyOf(t).includes(w)) : keyOf(t).includes(q)))
    .slice(0, 8);
  if (!concept && !match.length) return null;
  return { name: concept?.name || term, summary: concept?.summary || '', type: concept?.type || null, related, facts: match };
}

function sources() {
  const d = memory.load();
  const history = memory.getRecentHistory(80).map((h) => `${h.role === 'user' ? 'Właściciel' : 'Jarvis'}: ${String(h.text || h.content || '').slice(0, 400)}`);
  const facts = (d.facts || []).map((f) => (typeof f === 'string' ? f : f?.text || '')).filter(Boolean).slice(0, 80);
  const notes = (d.notes || []).slice(0, 20).map((n) => `${n.tytul || ''}: ${String(n.streszczenie || '').slice(0, 300)}`);
  return { history, facts, notes };
}

export async function learn() {
  if (!process.env.GEMINI_API_KEY) throw new Error('Brak klucza AI na serwerze.');
  const src = sources();
  if (!src.history.length && !src.facts.length && !src.notes.length) return { added: 0, total: store().concepts.length };
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const r = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: `Z poniższych danych o właścicielu wypisz pojęcia warte zapamiętania (ludzie, miejsca, projekty, tematy, rzeczy, cele) i powiązania między nimi. Tylko to, co naprawdę wynika z danych; pomiń small talk i polecenia techniczne aplikacji. Nazwy krótkie, w mianowniku, po polsku.\n\nFAKTY:\n${src.facts.join('\n')}\n\nNOTATKI:\n${src.notes.join('\n')}\n\nROZMOWY:\n${src.history.join('\n')}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            concepts: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, type: { type: Type.STRING, enum: TYPES }, summary: { type: Type.STRING } }, required: ['name', 'type', 'summary'] } },
            relations: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { a: { type: Type.STRING }, b: { type: Type.STRING }, label: { type: Type.STRING } }, required: ['a', 'b'] } },
          },
          required: ['concepts', 'relations'],
        },
      },
    })
  );
  const before = store().concepts.length;
  const merged = mergeGraph(store(), JSON.parse(r.text));
  const k = store();
  k.concepts = merged.concepts;
  k.relations = merged.relations;
  k.learnedAt = Date.now();
  memory.save(memory.load());
  const added = merged.concepts.length - before;
  if (added > 0) logJournal('auto', `Graf wiedzy: ${added} nowych pojęć`, 'pamiec');
  return { added, total: merged.concepts.length };
}

router.get('/api/graph', requireOwner, (req, res) => {
  const k = store();
  res.json({ concepts: k.concepts, relations: k.relations, learnedAt: k.learnedAt || 0 });
});

router.post('/api/graph/learn', requireOwner, async (req, res) => {
  try {
    res.json({ ok: true, ...(await learn()) });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Nie udało się uczyć z rozmów.' });
  }
});

router.post('/api/graph/forget', requireOwner, (req, res) => {
  const id = String(req.body?.id || '');
  const k = store();
  k.concepts = k.concepts.filter((c) => c.id !== id);
  k.relations = k.relations.filter((r) => r.a !== id && r.b !== id);
  memory.save(memory.load());
  res.json({ ok: true });
});

export function whatDoIKnow(term) {
  const d = memory.load();
  return lookup(store(), d.facts || [], term);
}

// W nocy, gdy doszlo cos nowego: graf uczy sie sam (raz na dobe).
export async function maybeLearn(now = Date.now()) {
  const k = store();
  if (!process.env.GEMINI_API_KEY || now - (k.learnedAt || 0) < 20 * 3600 * 1000) return false;
  const last = memory.getRecentHistory(1)[0];
  if (!last || (last.at || last.ts || now) < (k.learnedAt || 0)) return false;
  await learn();
  return true;
}

export default router;
