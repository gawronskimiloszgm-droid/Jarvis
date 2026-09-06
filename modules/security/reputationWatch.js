// Monitoring reputacji - dokladnie ten sam wzorzec co server/sentinel.js
// (temat = zapytanie, pamietamy widziane adresy, melduje sie tylko to,
// czego wczesniej nie bylo), ale zamiast dowolnego tematu web zawsze
// sledzimy wzmianki o KONKRETNEJ osobie/firmie. Osobny namespace pamieci
// (data.reputation) i osobny bus source, zeby nie mieszac z tematami
// wartownika ogolnego ani nie deczyc jego limitow/interwalu.

import * as memory from '../../server/memory.js';
import * as bus from '../../server/bus.js';
import { searchWeb } from '../../server/websearch.js';
import { summarizeFindings } from '../sentinel/summarize.js';

const MIN_INTERVAL_MS = Number(process.env.REPUTATION_MIN_INTERVAL_MS || 24 * 60 * 60 * 1000);
const MAX_SEEN = 400;

function load() {
  const data = memory.load();
  if (!data.reputation || !Array.isArray(data.reputation.watches)) {
    data.reputation = { watches: [] };
  }
  return data;
}

export function listWatches() {
  return load().reputation.watches.map((w) => ({
    id: w.id,
    query: w.query,
    createdAt: w.createdAt,
    lastCheckedAt: w.lastCheckedAt || null,
    lastFindingAt: w.lastFindingAt || null,
    seenCount: (w.seen || []).length,
    findings: (w.findings || []).length,
    paused: Boolean(w.paused),
  }));
}

/** @param {string} name imie i nazwisko lub nazwa firmy do sledzenia */
export function addWatch(name) {
  const q = String(name || '').trim();
  if (!q) return null;
  const data = load();
  const existing = data.reputation.watches.find((w) => w.query.toLowerCase() === q.toLowerCase());
  if (existing) return existing;

  const watch = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    query: q,
    createdAt: Date.now(),
    lastCheckedAt: null,
    lastFindingAt: null,
    primed: false,
    seen: [],
    findings: [],
  };
  data.reputation.watches.push(watch);
  memory.save(data);
  bus.publish('reputation', 'watch.added', `monitoring reputacji przyjal: ${q}`, {
    level: 'ok',
    data: { id: watch.id },
  });
  return watch;
}

export function removeWatch(id) {
  const data = load();
  const before = data.reputation.watches.length;
  data.reputation.watches = data.reputation.watches.filter((w) => w.id !== id);
  if (data.reputation.watches.length !== before) memory.save(data);
  return listWatches();
}

export function setPaused(id, paused) {
  const data = load();
  const watch = data.reputation.watches.find((w) => w.id === id);
  if (!watch) return null;
  watch.paused = Boolean(paused);
  memory.save(data);
  return watch;
}

export function getFindings(id, limit = 20) {
  const watch = load().reputation.watches.find((w) => w.id === id);
  if (!watch) return null;
  return (watch.findings || []).slice(-limit).reverse();
}

async function checkWatch(watch) {
  // Cudzyslow wymusza dopasowanie frazy, a nie osobnych slow - inaczej
  // "Jan Kowalski" zlapaloby kazda strone z ktoregokolwiek z tych imion.
  const results = await searchWeb(`"${watch.query}"`, 8);
  const seen = new Set(watch.seen || []);
  const fresh = results.filter((r) => r.url && !seen.has(r.url));

  watch.seen = [...seen, ...results.map((r) => r.url).filter(Boolean)].slice(-MAX_SEEN);
  watch.lastCheckedAt = Date.now();

  if (!watch.primed) {
    watch.primed = true;
    return { primed: true, fresh: [] };
  }
  return { primed: false, fresh };
}

export async function sweep({ force = false } = {}) {
  const data = load();
  const now = Date.now();
  const due = data.reputation.watches.filter(
    (w) => !w.paused && (force || !w.lastCheckedAt || now - w.lastCheckedAt >= MIN_INTERVAL_MS)
  );
  if (!due.length) return { checked: 0, reported: 0 };

  let reported = 0;
  for (const watch of due) {
    try {
      const { primed, fresh } = await checkWatch(watch);
      if (primed) {
        bus.publish('reputation', 'watch.primed', `monitoring reputacji zapamietal stan wyjsciowy: ${watch.query}`, {
          level: 'debug',
          data: { id: watch.id },
        });
        continue;
      }
      if (!fresh.length) continue;

      const summary = await summarizeFindings(watch.query, fresh);
      if (summary.trim().toUpperCase() === 'BRAK') continue;

      const finding = { at: Date.now(), summary, sources: fresh.slice(0, 5).map((f) => ({ title: f.title, url: f.url })) };
      watch.findings = [...(watch.findings || []), finding].slice(-50);
      watch.lastFindingAt = finding.at;
      reported++;

      bus.publish('reputation', 'watch.finding', `nowa wzmianka o "${watch.query}": ${summary}`, {
        level: 'info',
        speak: true,
        data: { id: watch.id, sources: finding.sources },
      });
    } catch (err) {
      bus.publish('reputation', 'watch.error', `blad monitoringu reputacji "${watch.query}": ${err.message}`, {
        level: 'warn',
        data: { id: watch.id },
      });
    }
  }
  memory.save(data);
  return { checked: due.length, reported };
}
