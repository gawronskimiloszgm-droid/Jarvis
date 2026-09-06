// Funkcja 29: eksport calej pamieci do czytelnego pliku (backup/audyt) -
// jeden plik markdown z faktami (+ metadanymi z factLifecycle.js), grafem
// wiedzy, osobami i podsumowaniami dni, gotowy do pobrania.

import express from 'express';
import { load } from './memory.js';
import { resolveMetaEntry } from './knowledgeStore.js';
import { ensureFactMeta } from './factLifecycle.js';
import { requireOwner } from './auth.js';

function buildMarkdown(data) {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`# Eksport pamieci Jarvisa (${today})`, '');

  lines.push('## Fakty', '');
  if (!data.facts.length) lines.push('_brak faktow_');
  data.facts.forEach((text, i) => {
    const meta = resolveMetaEntry(data.factMeta, text);
    const cat = meta?.category ? ` [${meta.category}]` : '';
    const conf = meta?.confidence ? ` (${meta.confidence})` : '';
    lines.push(`${i}. ${text}${cat}${conf}`);
  });

  lines.push('', '## Graf wiedzy', '', '### Wezly');
  const nodes = data.knowledgeGraph?.nodes || [];
  if (!nodes.length) lines.push('_brak wezlow_');
  nodes.forEach((n) => lines.push(`- **${n.label}** (${n.type})${n.notes ? ` - ${n.notes}` : ''}`));

  lines.push('', '### Relacje');
  const edges = data.knowledgeGraph?.edges || [];
  if (!edges.length) lines.push('_brak relacji_');
  edges.forEach((e) => {
    const from = nodes.find((n) => n.id === e.from)?.label || e.from;
    const to = nodes.find((n) => n.id === e.to)?.label || e.to;
    lines.push(`- ${from} -> [${e.relation}] -> ${to}`);
  });

  lines.push('', '## Osoby', '');
  const people = data.people || [];
  if (!people.length) lines.push('_brak zapisanych osob_');
  people.forEach((p) => lines.push(`- **${p.name}** - ${p.relationToOwner || 'brak okreslonej relacji'}${p.notes ? ` (${p.notes})` : ''}`));

  lines.push('', '## Podsumowania dni', '');
  const days = Object.entries(data.episodeSummaries || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!days.length) lines.push('_brak wygenerowanych podsumowan_');
  days.forEach(([date, s]) => lines.push(`### ${date}`, s.summary, ''));

  return lines.join('\n');
}

const router = express.Router();

router.get('/api/knowledge/export', requireOwner, (req, res) => {
  const data = ensureFactMeta();
  const md = buildMarkdown(data);
  const filename = `jarvis-pamiec-${new Date().toISOString().slice(0, 10)}.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(md);
});

export const memoryExportRouter = router;
