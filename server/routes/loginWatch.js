// Router HTTP dla historii logowan (modules/security/loginWatch.js).
// Sam zapis logowania (recordLogin) wywoluje server/index.js - patrz raport.

import { Router } from 'express';
import { requireOwner } from '../auth.js';
import { getHistory } from '../../modules/security/loginWatch.js';

const router = Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  res.json({ history: getHistory(Number(req.query.limit) || 50) });
});

export default router;
