// Router HTTP dla warstwy powiadomien o zagrozeniu (modules/security/threatNotify.js).
// Docelowe wywolanie idzie z server/cameras.js (patrz raport), ten endpoint
// sluzy do recznego testu powiadomien push/HUD bez czekania na realny ruch.

import { Router } from 'express';
import { requireOwner } from '../auth.js';
import { notifyIfThreat, lastNotification } from '../../modules/security/threatNotify.js';

const router = Router();
router.use(requireOwner);

router.post('/test', (req, res) => {
  const { camera, description, confidence } = req.body || {};
  const result = notifyIfThreat(
    { notable: true, description: String(description || 'test recznego alarmu'), confidence: confidence ?? 1 },
    { camera: camera || 'test' }
  );
  res.json(result);
});

router.get('/:camera/last', (req, res) => {
  res.json({ last: lastNotification(req.params.camera) });
});

export default router;
