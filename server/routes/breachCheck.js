// Router HTTP dla sprawdzania wyciekow (modules/security/breachCheck.js).
// Haslo idzie w ciele zapytania POST (nie w URL/query - trafiloby do logow
// serwera i historii przegladarki), a poza ta funkcja nigdzie dalej.

import { Router } from 'express';
import { requireOwner } from '../core/auth.js';
import * as bus from '../core/bus.js';
import { checkPasswordBreach, checkEmailBreach, isEmailCheckConfigured } from '../../modules/security/breachCheck.js';

const router = Router();
router.use(requireOwner);

router.post('/password', async (req, res) => {
  try {
    const result = await checkPasswordBreach(req.body?.password);
    if (result.breached) {
      bus.publish('security', 'breach.password', `haslo znalezione w ${result.count} znanych wyciekach`, {
        level: 'warn',
        speak: true,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/email', async (req, res) => {
  try {
    const result = await checkEmailBreach(req.body?.email);
    if (result.breached) {
      bus.publish('security', 'breach.email', `adres e-mail wystapil w ${result.breaches.length} wyciekach`, {
        level: 'warn',
        speak: true,
        data: { breaches: result.breaches },
      });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/status', (req, res) => {
  res.json({ emailCheckConfigured: isEmailCheckConfigured(), passwordCheckConfigured: true });
});

export default router;
