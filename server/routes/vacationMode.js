// Router HTTP dla trybu "wakacje" (modules/security/vacationMode.js).

import { Router } from 'express';
import { requireOwner } from '../core/auth.js';
import { start, stop, status } from '../../modules/security/vacationMode.js';

const router = Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  res.json(status());
});

router.post('/start', (req, res) => {
  res.json(start(req.body?.days));
});

router.post('/stop', (req, res) => {
  res.json(stop());
});

export default router;
