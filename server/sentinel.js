// Ciagly wartownik tematow - Jarvis sam sledzi wskazane sprawy i odzywa
// sie, gdy pojawi sie cos NOWEGO.
//
// Sedno problemu nie jest w wyszukiwaniu, tylko w tym, zeby nie meldowac
// tego samego w kolko. Kazdy temat pamieta adresy juz widzianych stron;
// raport powstaje wylacznie z tych, ktorych wczesniej nie bylo. Bez tego
// wartownik po dwoch dniach stalby sie generatorem szumu i przestalbys go
// czytac - a wtedy przegapilbys ten jeden raz, kiedy naprawde cos znalazl.
//
// Tematy zyja w tej samej pamieci co reszta stanu (memory.js), wiec
// przezywaja restart serwera.

import * as memory from './memory.js';
import * as bus from './bus.js';
import { searchWeb } from './websearch.js';
import { summarizeFindings } from '../modules/sentinel/summarize.js';

// Minimalny odstep miedzy sprawdzeniami tego samego tematu. Wartownik ma
// dzialac tygodniami w tle - odpytywanie czesciej niz raz na godzine nic
// nie wnosi poza obciazeniem.
const MIN_INTERVAL_MS = Number(process.env.SENTINEL_MIN_INTERVAL_MS || 60 * 60 * 1000);

// Ile adresow pamietamy na temat. Powyzej tego najstarsze wypadaja - po
// pol roku stara strona i tak nie wroci w wynikach jako "nowa".
const MAX_SEEN = 400;

function load() {
  const data = memory.load();
  if (!Array.isArray(data.topics)) data.topics = [];
  return data;
}

export function listTopics() {
  return load().topics.map((t) => ({
    id: t.id,
    query: t.query,
    createdAt: t.createdAt,
    lastCheckedAt: t.lastCheckedAt || null,
    lastFindingAt: t.lastFindingAt || null,
    seenCount: (t.seen || []).length,
    findings: (t.findings || []).length,
    paused: Boolean(t.paused),
  }));
}

export function addTopic(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const data = load();
  const existing = data.topics.find((t) => t.query.toLowerCase() === q.toLowerCase());
  if (existing) return existing;

  const topic = {
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    query: q,
    createdAt: Date.now(),
    lastCheckedAt: null,
    lastFindingAt: null,
    // Pierwsze sprawdzenie CELOWO tylko zapamietuje stan wyjsciowy i nic
    // nie melduje - inaczej dodanie tematu od razu wysypaloby raport z
    // dziesieciu stron, ktore istnialy od dawna.
    primed: false,
    seen: [],
    findings: [],
  };
  data.topics.push(topic);
  memory.save(data);
  bus.publish('sentinel', 'topic.added', `wartownik przyjal temat: ${q}`, { level: 'ok', data: { id: topic.id } });
  return topic;
}

export function removeTopic(id) {
  const data = load();
  const before = data.topics.length;
  data.topics = data.topics.filter((t) => t.id !== id);
  if (data.topics.length !== before) memory.save(data);
  return listTopics();
}

export function setPaused(id, paused) {
  const data = load();
  const topic = data.topics.find((t) => t.id === id);
  if (!topic) return null;
  topic.paused = Boolean(paused);
  memory.save(data);
  return topic;
}

export function getFindings(id, limit = 20) {
  const topic = load().topics.find((t) => t.id === id);
  if (!topic) return null;
  return (topic.findings || []).slice(-limit).reverse();
}

/**
 * Sprawdzenie jednego tematu. Zwraca liste NOWYCH wynikow (moze byc pusta).
 * @param {object} topic wpis z pamieci (modyfikowany w miejscu)
 */
async function checkTopic(topic) {
  const results = await searchWeb(topic.query, 8);
  const seen = new Set(topic.seen || []);
  const fresh = results.filter((r) => r.url && !seen.has(r.url));

  // Widziane adresy zapisujemy ZAWSZE, takze przy pierwszym przebiegu -
  // to one sa punktem odniesienia dla kolejnych sprawdzen.
  topic.seen = [...seen, ...results.map((r) => r.url).filter(Boolean)].slice(-MAX_SEEN);
  topic.lastCheckedAt = Date.now();

  if (!topic.primed) {
    topic.primed = true;
    return { primed: true, fresh: [] };
  }
  return { primed: false, fresh };
}

/**
 * Przejscie po wszystkich tematach, ktorym minal odstep.
 * Wolane z upkeep.js przy kazdym cyklu utrzymaniowym.
 */
export async function sweep({ force = false } = {}) {
  const data = load();
  const now = Date.now();
  const due = data.topics.filter(
    (t) => !t.paused && (force || !t.lastCheckedAt || now - t.lastCheckedAt >= MIN_INTERVAL_MS)
  );
  if (!due.length) return { checked: 0, reported: 0 };

  let reported = 0;

  for (const topic of due) {
    try {
      const { primed, fresh } = await checkTopic(topic);

      if (primed) {
        bus.publish('sentinel', 'topic.primed', `wartownik zapamietal stan wyjsciowy tematu: ${topic.query}`, {
          level: 'debug',
          data: { id: topic.id },
        });
        continue;
      }
      if (!fresh.length) continue;

      // Streszczenie robimy TYLKO gdy jest co streszczac - to jedyne
      // miejsce w wartowniku, ktore kosztuje wywolanie modelu.
      const summary = await summarizeFindings(topic.query, fresh);
      const finding = { at: Date.now(), summary, sources: fresh.slice(0, 5).map((f) => ({ title: f.title, url: f.url })) };
      topic.findings = [...(topic.findings || []), finding].slice(-50);
      topic.lastFindingAt = finding.at;
      reported++;

      bus.publish('sentinel', 'topic.finding', `${topic.query}: ${summary}`, {
        level: 'info',
        speak: true,
        data: { id: topic.id, sources: finding.sources },
      });
    } catch (err) {
      bus.publish('sentinel', 'topic.error', `wartownik potknal sie na temacie "${topic.query}": ${err.message}`, {
        level: 'warn',
        data: { id: topic.id },
      });
    }
  }

  memory.save(data);
  return { checked: due.length, reported };
}
