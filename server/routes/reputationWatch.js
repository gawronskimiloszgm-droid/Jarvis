// Router HTTP dla monitoringu reputacji (modules/security/reputationWatch.js).

import { Router } from 'express';
import { requireOwner } from '../auth.js';
import { listWatches, addWatch, removeWatch, setPaused, getFindings, sweep } from '../../modules/security/reputationWatch.js';

const router = Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  res.json({ items: listWatches() });
});

router.post('/', (req, res) => {
  const watch = addWatch(req.body?.name);
  if (!watch) return res.status(400).json({ error: 'Brak imienia/nazwiska lub nazwy firmy.' });
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

router.get('/:id/findings', (req, res) => {
  const findings = getFindings(req.params.id, Number(req.query.limit) || 20);
  if (findings === null) return res.status(404).json({ error: 'Nie znaleziono obserwacji.' });
  res.json({ findings });
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
