// Funkcja 30: wersjonowanie pamieci - cofniecie ostatniej zmiany w
// namespace tego zestawu modulow (facts, knowledgeGraph, factMeta, people).
// Kazda mutujaca operacja w knowledgeGraph.js/factLifecycle.js/relations.js
// wola snapshotVersion() z knowledgeStore.js TUZ PRZED zmiana, wiec undo
// przywraca dokladnie stan sprzed tej operacji.

import express from 'express';
import { requireOwner } from '../core/auth.js';
import { listVersions, undoLastVersion } from './knowledgeStore.js';

const router = express.Router();

router.get('/api/knowledge/versions', requireOwner, (req, res) => {
  res.json({ versions: listVersions() });
});

router.post('/api/knowledge/undo', requireOwner, (req, res) => {
  const restored = undoLastVersion();
  if (!restored) return res.status(404).json({ error: 'Brak wersji do cofniecia.' });
  res.json({ ok: true, restoredAt: restored.at, reason: restored.reason });
});

export const memoryVersionsRouter = router;
