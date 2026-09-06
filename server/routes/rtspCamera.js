// Router HTTP dla kamer RTSP zewnetrznych (modules/security/rtspCamera.js).

import { Router } from 'express';
import { requireOwner } from '../auth.js';
import * as bus from '../bus.js';
import { listConfiguredCameras, captureFrame, isFfmpegAvailable } from '../../modules/security/rtspCamera.js';

const router = Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  res.json({
    ffmpegAvailable: isFfmpegAvailable(),
    cameras: listConfiguredCameras().map((c) => ({ name: c.name })), // adres RTSP zawiera zwykle login:haslo - nie odsylamy go do klienta
  });
});

router.get('/:name/frame', async (req, res) => {
  const camera = listConfiguredCameras().find((c) => c.name === req.params.name);
  if (!camera) return res.status(404).json({ error: 'Nieznana kamera - sprawdz RTSP_CAMERA_URLS.' });
  try {
    const jpeg = await captureFrame(camera.url);
    res.set('Content-Type', 'image/jpeg');
    res.send(jpeg);
  } catch (err) {
    bus.publish('perimeter', 'rtsp.error', `kamera RTSP "${camera.name}": ${err.message}`, {
      level: 'warn',
      data: { camera: camera.name },
    });
    res.status(502).json({ error: err.message });
  }
});

export default router;
