// modules/cad-extra - 10 dodatkowych funkcji CAD/druk 3D, NADBUDOWANE nad
// istniejacym modules/cad (geometry.js/index.js/stl.js/stress.js) i
// server/cad.js/printer.js - zaden z tych plikow nie jest tu edytowany,
// tylko importowany.
//
// Ten plik eksportuje Router - NIE montuje sie sam. Zamontowac w
// server/index.js (patrz raport koncowy zadania) np.:
//   import cadExtraRouter from '../modules/cad-extra/index.js';
//   app.use('/api/cad-extra', requireOwner, cadExtraRouter);

import { Router } from 'express';
import express from 'express';

import { listTemplates, createFromTemplate } from './templates.js';
import { getPrintProfile, listPrintProfiles } from './printProfiles.js';
import { listQueue, addToQueue, updateQueueItem, removeFromQueue, reorderQueue } from './printQueue.js';
import { pollPrintStatus, lastKnownStatus } from './printStatus.js';
import { getFilamentState, setSpool } from './filament.js';
import { evaluateFatigue, listFatigueScenarios } from './stressExtra.js';
import { parseBinarySTL, trisToObj } from './stlTools.js';
import { checkPrintability, defaultBed } from './printability.js';
import { scanObjectToModel } from './scan.js';
import { isConfigured as printerConfigured } from '../../server/printer.js';
import { get as getCadModel } from '../../server/cad.js';

const router = Router();

function fail(res, status, err) {
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}

// ---------- #101 Szablony ----------

router.get('/templates', (req, res) => {
  res.json(listTemplates());
});

router.post('/templates/:name/create', (req, res) => {
  try {
    const model = createFromTemplate(req.params.name, req.body || {});
    res.status(201).json(model);
  } catch (err) {
    fail(res, 400, err);
  }
});

// ---------- #102 Skan przedmiotu ze zdjecia ----------
// Body: { imageDataUrl: "data:image/jpeg;base64,...." } (ten sam format co
// istniejace /api/vision, /api/expenses/scan, /api/cameras/frame).

router.post('/scan-to-model', async (req, res) => {
  const { imageDataUrl, mimeType } = req.body || {};
  if (!imageDataUrl) return fail(res, 400, new Error('Brak imageDataUrl (zdjecie przedmiotu w base64).'));
  try {
    const base64Data = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const result = await scanObjectToModel(buffer, mimeType || 'image/jpeg');
    res.status(201).json(result);
  } catch (err) {
    fail(res, 502, err);
  }
});

// ---------- #103 Profile druku wg materialu ----------

router.get('/print-profiles', (req, res) => {
  res.json(listPrintProfiles());
});

router.get('/print-profile/:material', (req, res) => {
  const profile = getPrintProfile(req.params.material);
  if (!profile) return fail(res, 404, new Error(`Nieznany material "${req.params.material}".`));
  res.json(profile);
});

// ---------- #104 Kolejka wydrukow ----------

router.get('/print-queue', (req, res) => {
  res.json(listQueue());
});

router.post('/print-queue', (req, res) => {
  res.status(201).json(addToQueue(req.body || {}));
});

router.patch('/print-queue/:id', (req, res) => {
  const item = updateQueueItem(req.params.id, req.body || {});
  if (!item) return fail(res, 404, new Error('Pozycja kolejki nie znaleziona.'));
  res.json(item);
});

router.delete('/print-queue/:id', (req, res) => {
  const removed = removeFromQueue(req.params.id);
  if (!removed) return fail(res, 404, new Error('Pozycja kolejki nie znaleziona.'));
  res.json({ ok: true });
});

router.post('/print-queue/reorder', (req, res) => {
  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  if (!order.length) return fail(res, 400, new Error('Body musi zawierac tablice "order" z id pozycji w nowej kolejnosci.'));
  res.json(reorderQueue(order));
});

// ---------- #105 Status druku (polling OctoPrint) ----------

router.get('/print-status', (req, res) => {
  res.json({ configured: printerConfigured(), last: lastKnownStatus() });
});

router.post('/print-status/poll', async (req, res) => {
  const status = await pollPrintStatus();
  res.json({ configured: printerConfigured(), status });
});

// ---------- #106 Filament ----------

router.get('/filament', (req, res) => {
  res.json(getFilamentState());
});

router.post('/filament/spool', (req, res) => {
  try {
    res.json(setSpool(req.body?.capacityG));
  } catch (err) {
    fail(res, 400, err);
  }
});

// ---------- #107 Wytrzymalosc - zmeczenie ----------

router.get('/stress/fatigue-scenarios', (req, res) => {
  res.json(listFatigueScenarios());
});

router.post('/stress/fatigue', (req, res) => {
  const { loadKg, armMm, widthMm, thickMm, material, printed, scenario } = req.body || {};
  if (![loadKg, armMm, widthMm, thickMm].every((v) => Number.isFinite(Number(v)))) {
    return fail(res, 400, new Error('Wymagane liczby: loadKg, armMm, widthMm, thickMm.'));
  }
  const result = evaluateFatigue({
    loadKg: Number(loadKg),
    armMm: Number(armMm),
    widthMm: Number(widthMm),
    thickMm: Number(thickMm),
    material,
    printed: printed !== false,
    scenario,
  });
  res.json(result);
});

// ---------- #108 Import STL (metadane: liczba trojkatow + bounding box) ----------
// Przyjmuje albo surowe binarne cialo (Content-Type: application/octet-stream
// lub model/stl), albo JSON { stlBase64 } - ten drugi przechodzi przez
// globalny express.json() z server/index.js (limit 8 MB), wiec dla wiekszych
// plikow trzeba uzyc surowego uploadu ponizej.
router.post(
  '/stl/import',
  express.raw({ type: ['application/octet-stream', 'model/stl'], limit: '25mb' }),
  (req, res) => {
    let buffer = null;
    if (Buffer.isBuffer(req.body) && req.body.length) {
      buffer = req.body;
    } else if (req.body && typeof req.body === 'object' && typeof req.body.stlBase64 === 'string') {
      buffer = Buffer.from(req.body.stlBase64, 'base64');
    }
    if (!buffer || !buffer.length) {
      return fail(
        res,
        400,
        new Error('Brak danych STL - wyslij surowy plik binarny (Content-Type: application/octet-stream) albo JSON {"stlBase64": "..."}.')
      );
    }
    try {
      res.json(parseBinarySTL(buffer));
    } catch (err) {
      fail(res, 400, err);
    }
  }
);

// ---------- #109 Eksport istniejacego projektu CAD do OBJ ----------

router.get('/cad/:id/obj', (req, res) => {
  const model = getCadModel(req.params.id);
  if (!model) return fail(res, 404, new Error('Model nie znaleziony (mogl wygasnac).'));
  const obj = trisToObj(model.mesh, `jarvis-${req.params.id}`);
  res.set('Content-Type', 'text/plain');
  res.set('Content-Disposition', `attachment; filename="jarvis-${req.params.id}.obj"`);
  res.send(obj);
});

// ---------- #110 Sprawdzenie drukowalnosci ----------

router.post('/cad/:id/check-printability', (req, res) => {
  const model = getCadModel(req.params.id);
  if (!model) return fail(res, 404, new Error('Model nie znaleziony (mogl wygasnac).'));
  const { bedX, bedY, bedZ } = req.body || {};
  const bed = { ...defaultBed() };
  if (Number.isFinite(Number(bedX)) && Number(bedX) > 0) bed.x = Number(bedX);
  if (Number.isFinite(Number(bedY)) && Number(bedY) > 0) bed.y = Number(bedY);
  if (Number.isFinite(Number(bedZ)) && Number(bedZ) > 0) bed.z = Number(bedZ);
  res.json(checkPrintability(model.sizeMm, bed));
});

export default router;
