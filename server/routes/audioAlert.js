// Router HTTP dla klasyfikacji dzwieku (modules/security/audioClassify.js).

import { Router } from 'express';
import { requireOwner } from '../auth.js';
import { classifyAudio } from '../../modules/security/audioClassify.js';

const router = Router();
router.use(requireOwner);

// Body: { audio: base64, mimeType?: 'audio/wav'|'audio/webm'|..., source?: string }
router.post('/', async (req, res) => {
  const { audio, mimeType, source } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'Brak pola audio (base64).' });
  try {
    const buffer = Buffer.from(String(audio), 'base64');
    const verdict = await classifyAudio(buffer, mimeType, source);
    res.json(verdict);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
