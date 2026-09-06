// Router HTTP dla rejestru znanych osob (modules/security/knownFaces.js).
// Przypomnienie ograniczenia: dopasowanie to heurystyka oparta o opis
// tekstowy przez Gemini, NIE biometryczne rozpoznawanie twarzy - patrz
// komentarz na gorze modules/security/knownFaces.js.

import { Router } from 'express';
import { requireOwner } from '../auth.js';
import { listPeople, registerPerson, removePerson, matchFace } from '../../modules/security/knownFaces.js';

const router = Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  res.json({ people: listPeople() });
});

router.post('/', (req, res) => {
  const person = registerPerson(req.body?.name, req.body?.description);
  if (!person) return res.status(400).json({ error: 'Wymagane pola: name, description.' });
  res.json({ person });
});

router.delete('/:id', (req, res) => {
  res.json({ people: removePerson(req.params.id) });
});

// Klatka jako base64 JPEG w body (jak /api/cameras/frame w server/index.js).
router.post('/match', async (req, res) => {
  const { image, camera } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Brak pola image (base64 JPEG).' });
  try {
    const buffer = Buffer.from(String(image), 'base64');
    const result = await matchFace(buffer, camera);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
