// Funkcja 21: graf wiedzy (osoby, miejsca, rzeczy + relacje miedzy nimi)
// jako nadbudowa NAD plaska lista faktow (memory.js: data.facts) - fakty
// zostaja bez zmian, graf to osobna, dodatkowa struktura pod nowym kluczem
// data.knowledgeGraph = { nodes, edges }.

import express from 'express';
import { nanoid } from 'nanoid';
import { load, save } from './memory.js';
import { ensureNamespace, snapshotVersion } from './knowledgeStore.js';
import { requireOwner } from './auth.js';

const NODE_TYPES = ['osoba', 'miejsce', 'rzecz', 'inne'];

export function addNode(type, label, notes = '') {
  const clean = String(label || '').trim();
  if (!clean) return null;
  const data = ensureNamespace(load());
  snapshotVersion('dodanie wezla grafu');
  const node = {
    id: nanoid(8),
    type: NODE_TYPES.includes(type) ? type : 'inne',
    label: clean,
    notes: String(notes || '').trim(),
    createdAt: Date.now(),
  };
  data.knowledgeGraph.nodes.push(node);
  save(data);
  return node;
}

export function addEdge(fromId, toId, relation) {
  const clean = String(relation || '').trim();
  if (!clean) return null;
  const data = ensureNamespace(load());
  const hasFrom = data.knowledgeGraph.nodes.some((n) => n.id === fromId);
  const hasTo = data.knowledgeGraph.nodes.some((n) => n.id === toId);
  if (!hasFrom || !hasTo) return null;
  snapshotVersion('dodanie relacji grafu');
  const edge = { id: nanoid(8), from: fromId, to: toId, relation: clean, createdAt: Date.now() };
  data.knowledgeGraph.edges.push(edge);
  save(data);
  return edge;
}

export function getGraph() {
  return ensureNamespace(load()).knowledgeGraph;
}

export function getNodeConnections(nodeId) {
  const graph = getGraph();
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const edges = graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
  const connections = edges.map((e) => {
    const otherId = e.from === nodeId ? e.to : e.from;
    return { edge: e, node: graph.nodes.find((n) => n.id === otherId) || null };
  });
  return { node, connections };
}

export function removeNode(nodeId) {
  const data = ensureNamespace(load());
  if (!data.knowledgeGraph.nodes.some((n) => n.id === nodeId)) return false;
  snapshotVersion('usuniecie wezla grafu');
  data.knowledgeGraph.nodes = data.knowledgeGraph.nodes.filter((n) => n.id !== nodeId);
  data.knowledgeGraph.edges = data.knowledgeGraph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  save(data);
  return true;
}

const router = express.Router();

router.get('/api/knowledge/graph', requireOwner, (req, res) => {
  res.json(getGraph());
});

router.get('/api/knowledge/graph/nodes/:id', requireOwner, (req, res) => {
  const result = getNodeConnections(req.params.id);
  if (!result) return res.status(404).json({ error: 'Nie ma wezla o tym id.' });
  res.json(result);
});

router.post('/api/knowledge/graph/nodes', requireOwner, (req, res) => {
  const { type, label, notes } = req.body || {};
  const node = addNode(type, label, notes);
  if (!node) return res.status(400).json({ error: 'Podaj etykiete wezla.' });
  res.json(node);
});

router.post('/api/knowledge/graph/edges', requireOwner, (req, res) => {
  const { from, to, relation } = req.body || {};
  const edge = addEdge(from, to, relation);
  if (!edge) return res.status(400).json({ error: 'Podaj istniejace from/to oraz relation.' });
  res.json(edge);
});

router.delete('/api/knowledge/graph/nodes/:id', requireOwner, (req, res) => {
  const ok = removeNode(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Nie ma wezla o tym id.' });
  res.json({ ok: true });
});

export const knowledgeGraphRouter = router;
