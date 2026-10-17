// Router modulu IoT - spina wszystkie funkcje domu (Home Assistant, sceny,
// rolety, zamki, ogrzewanie per pokoj, energia, okna/pogoda, harmonogram,
// odkurzacz) pod JEDNYM prefiksem.
//
// Ten plik NIE montuje sie sam - eksportuje tylko Router. Zgodnie z
// konwencja tego batcha, montaz w server/index.js (ktorego nie wolno tu
// edytowac) to jedna linijka:
//   import iotRouter from '../modules/iot/index.js';
//   app.use('/api/iot', iotRouter);
// (requireOwner jest juz stosowany na calym routerze ponizej przez
// `router.use(requireOwner)`, wiec nie trzeba go dodawac drugi raz przy
// montowaniu.)
//
// Sterowanie domem to dane wlasciciela - kazda trasa przechodzi przez
// requireOwner (server/auth.js), tak jak reszta wrazliwych endpointow
// w projekcie (kamery, pamiec, kalendarz...).

import { Router } from 'express';
import { requireOwner } from '../../server/core/auth.js';
import * as ha from './homeAssistant.js';
import * as covers from './covers.js';
import * as lockModule from './lock.js';
import * as smartLockProvider from './smartLockProvider.js';
import * as climate from './climate.js';
import * as scenes from './scenes.js';
import * as energy from './energy.js';
import * as windowWeather from './windowWeather.js';
import * as vacuum from './vacuum.js';
import * as scheduler from './scheduler.js';

const router = Router();
router.use(requireOwner);

// Owija handler tak, ze:
// - NotConfiguredError / "integracja nie skonfigurowana" -> 200 z ok:false
//   (to NIE jest blad serwera, to informacyjna odpowiedz dla usera/modelu)
// - reszta bledow -> 500 z komunikatem
function handle(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined) res.json(result);
    } catch (err) {
      if (err?.notConfigured) {
        return res.json({ ok: false, configured: false, message: err.message });
      }
      res.status(400).json({ error: err.message || 'Nieznany blad modulu IoT.' });
    }
  };
}

// --- #41: status integracji + lista/wywolanie encji Home Assistant ---

router.get('/status', handle(async () => ({
  homeAssistant: { configured: ha.isConfigured() },
  smartLockProvider: { configured: smartLockProvider.isConfigured() },
})));

router.get('/entities', handle(async (req) => {
  if (!ha.isConfigured()) throw new ha.NotConfiguredError();
  const domain = typeof req.query.domain === 'string' ? req.query.domain : undefined;
  const states = await ha.getStates(domain);
  return { ok: true, count: states.length, entities: states };
}));

router.get('/entities/:entityId', handle(async (req) => {
  if (!ha.isConfigured()) throw new ha.NotConfiguredError();
  const state = await ha.getState(req.params.entityId);
  if (!state) return { ok: false, message: `Nie znaleziono encji ${req.params.entityId}.` };
  return { ok: true, entity: state };
}));

// Generyczne wywolanie dowolnej uslugi HA - "furtka" dla wszystkiego, czego
// nie ma jeszcze jako wygodnej funkcji ponizej (np. swiatlo RGB z kolorem).
router.post('/service', handle(async (req) => {
  const { domain, service, entityId, data } = req.body || {};
  if (!domain || !service) throw new Error('Wymagane pola: domain, service.');
  const result = await ha.callService(domain, service, entityId, data || {});
  return { ok: true, result };
}));

// --- #42: rolety/zaluzje ---

router.get('/covers', handle(async () => ({ ok: true, covers: await covers.listCovers() })));
router.post('/covers/:entityId/open', handle(async (req) => ({ ok: true, result: await covers.open(req.params.entityId) })));
router.post('/covers/:entityId/close', handle(async (req) => ({ ok: true, result: await covers.close(req.params.entityId) })));
router.post('/covers/:entityId/position', handle(async (req) => {
  const { position } = req.body || {};
  return { ok: true, result: await covers.setPosition(req.params.entityId, position) };
}));

// --- #43/#44: sceny ---

router.post('/scenes/leaving', handle(async (req) => scenes.leaving(req.body || {})));
router.post('/scenes/cinema', handle(async (req) => scenes.cinema(req.body || {})));

// --- #45: energia ---

router.get('/energy/check', handle(async (req) => {
  const entityIds = typeof req.query.entityIds === 'string' ? req.query.entityIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return energy.checkEnergyAnomalies(entityIds);
}));
router.post('/energy/check', handle(async (req) => energy.checkEnergyAnomalies(req.body?.entityIds || [])));

// --- #46: zamek drzwi (Home Assistant + fallback provider) ---

router.get('/locks', handle(async () => ({ ok: true, locks: await lockModule.listLocks() })));
router.get('/locks/:entityId/status', handle(async (req) => ({ ok: true, status: await lockModule.status(req.params.entityId) })));
router.post('/locks/:entityId/lock', handle(async (req) => ({ ok: true, result: await lockModule.lock(req.params.entityId) })));
router.post('/locks/:entityId/unlock', handle(async (req) => ({ ok: true, result: await lockModule.unlock(req.params.entityId) })));

// Alternatywny zamek spoza Home Assistant (patrz smartLockProvider.js).
router.get('/smart-lock/status', handle(async () => {
  if (!smartLockProvider.isConfigured()) return { ok: false, configured: false, message: 'Alternatywny zamek nie jest skonfigurowany.' };
  return { ok: true, status: await smartLockProvider.status() };
}));
router.post('/smart-lock/lock', handle(async () => ({ ok: true, result: await smartLockProvider.lock() })));
router.post('/smart-lock/unlock', handle(async () => ({ ok: true, result: await smartLockProvider.unlock() })));

// --- #47: ogrzewanie/klimatyzacja per pokoj ---

router.get('/climate/rooms', handle(async () => ({ ok: true, rooms: climate.listRooms() })));
router.post('/climate/rooms', handle(async (req) => {
  const { name, entityId } = req.body || {};
  return { ok: true, rooms: climate.setRoom(name, entityId) };
}));
router.delete('/climate/rooms/:name', handle(async (req) => ({ ok: true, rooms: climate.removeRoom(req.params.name) })));
router.get('/climate/rooms/:name/status', handle(async (req) => ({ ok: true, status: await climate.status(req.params.name) })));
router.post('/climate/rooms/:name/temperature', handle(async (req) => {
  const { temperature } = req.body || {};
  return { ok: true, result: await climate.setTemperature(req.params.name, temperature) };
}));

// --- #48: otwarte okno + prognoza deszczu ---

router.post('/windows/check', handle(async (req) => {
  const { entityIds, city, lat, lon } = req.body || {};
  const location = lat != null && lon != null ? { lat, lon } : { city };
  return windowWeather.checkWindowsBeforeRain(entityIds || [], location);
}));

// --- #49: automatyczne sceny wg pory dnia/pogody ---

router.get('/schedule', handle(async () => ({ ok: true, schedule: scheduler.listSchedule() })));
router.post('/schedule', handle(async (req) => ({ ok: true, schedule: scheduler.addScheduleEntry(req.body || {}) })));
router.delete('/schedule/:id', handle(async (req) => ({ ok: true, schedule: scheduler.removeScheduleEntry(req.params.id) })));
router.post('/schedule/run', handle(async () => scheduler.runDue()));

// --- #50: robot sprzatajacy ---

router.get('/vacuum', handle(async () => ({ ok: true, vacuums: await vacuum.listVacuums() })));
router.get('/vacuum/:entityId/status', handle(async (req) => ({ ok: true, status: await vacuum.status(req.params.entityId) })));
router.post('/vacuum/:entityId/start', handle(async (req) => ({ ok: true, result: await vacuum.start(req.params.entityId) })));
router.post('/vacuum/:entityId/pause', handle(async (req) => ({ ok: true, result: await vacuum.pause(req.params.entityId) })));
router.post('/vacuum/:entityId/dock', handle(async (req) => ({ ok: true, result: await vacuum.dock(req.params.entityId) })));

export default router;

// Reeksport funkcji przeznaczonych do podpiecia POZA HTTP (np. z upkeep.js
// albo z jarvis.js przy function-calling) - patrz raport modulu.
export { checkEnergyAnomalies } from './energy.js';
export { checkWindowsBeforeRain } from './windowWeather.js';
export { runDue as runDueScenes } from './scheduler.js';
