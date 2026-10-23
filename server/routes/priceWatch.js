// Router HTTP dla wartownika cen (modules/security/priceWatch.js).
// Zgodnie z konwencja batcha: eksportuje Router, NIE montuje sie sam -
// patrz raport koncowy co do wpiecia w server/index.js.

import { Router } from 'express';
import { requireOwner } from '../core/auth.js';
import { listWatches, addWatch, removeWatch, setPaused, getHistory, sweep } from '../../modules/security/priceWatch.js';

const router = Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  res.json({ items: listWatches() });
});

router.post('/', (req, res) => {
  const { query, url, thresholdPct } = req.body || {};
  const watch = addWatch(query, { url, thresholdPct });
  if (!watch) return res.status(400).json({ error: 'Brak nazwy produktu.' });
  res.json({ item: watch });
});

router.delete('/:id', (req, res) => {
  res.json({ items: removeWatch(req.params.id) });
});

router.post('/:id/pause', (req, res) => {
  const watch = setPaused(req.params.id, req.body?.paused !== false);
  if (!watch) return res.status(404).json({ error: 'Nie znaleziono obserwacji.' });
  res.json({ item: watch });
});

router.get('/:id/history', (req, res) => {
  const history = getHistory(req.params.id, Number(req.query.limit) || 30);
  if (history === null) return res.status(404).json({ error: 'Nie znaleziono obserwacji.' });
  res.json({ history });
});

router.post('/sweep', async (req, res) => {
  try {
    const result = await sweep({ force: req.body?.force === true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
