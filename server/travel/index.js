// Router "podroze i transport" (#121-#130). Eksportuje Router - NIE montuje
// sie sam w app.js/index.js (zakaz edycji tego pliku w tym zadaniu). Patrz
// raport dla dokladnego miejsca montowania i wywolania startTravelSchedulers().
//
// Konwencja bledow jak w reszcie server/index.js: 400 dla nieprawidlowego
// zadania, 502 dla bledu uslugi zewnetrznej (Nominatim/OSRM/API pogody/kursow/
// Gemini), 404 gdy nie znaleziono zasobu po id.

import { Router } from 'express';
import { requireOwner } from '../core/auth.js';

import * as flights from './flights.js';
import * as transit from './transit.js';
import * as traffic from './traffic.js';
import * as booking from './booking.js';
import * as mailPlan from './mailPlan.js';
import * as courier from './courier.js';
import * as currency from './currency.js';
import * as packing from './packing.js';
import * as homeDistance from './homeDistance.js';
import * as documents from './documents.js';

export const router = Router();

// --- #121 Ceny lotow --- tylko wlasciciel (obserwacje w pamieci osobistej)
router.get('/flights', requireOwner, (req, res) => {
  res.json({ configured: flights.isConfigured(), watches: flights.listWatches() });
});

router.post('/flights/watch', requireOwner, (req, res) => {
  try {
    const { origin, destination, date, thresholdPct } = req.body || {};
    res.status(201).json(flights.addWatch({ origin, destination, date, thresholdPct }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/flights/:id', requireOwner, (req, res) => {
  res.json({ watches: flights.removeWatch(req.params.id) });
});

router.post('/flights/:id/check', requireOwner, async (req, res) => {
  try {
    res.json(await flights.checkWatch(req.params.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- #122 Komunikacja miejska --- publiczne, bezstanowe (jak pogoda)
router.get('/transit/departures', async (req, res) => {
  try {
    res.json(await transit.getDepartures({ city: req.query.city, stop: req.query.stop }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- #123 Korki na trasie do pracy --- tylko wlasciciel (adres domu/pracy)
router.get('/commute', requireOwner, (req, res) => {
  res.json(traffic.getConfig() || { configured: false });
});

router.post('/commute/config', requireOwner, async (req, res) => {
  try {
    const { homeLat, homeLon, workLat, workLon, thresholdPct } = req.body || {};
    res.status(201).json(await traffic.setConfig({ homeLat, homeLon, workLat, workLon, thresholdPct }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/commute/check', requireOwner, async (req, res) => {
  try {
    res.json(await traffic.checkNow());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- #124 Rezerwacja przez API --- tylko wlasciciel; confirm ZAWSZE osobno
router.get('/booking', requireOwner, (req, res) => {
  res.json({ providerConfigured: booking.isProviderConfigured(), drafts: booking.listDrafts() });
});

router.post('/booking/draft', requireOwner, async (req, res) => {
  try {
    const { description } = req.body || {};
    res.status(201).json(await booking.draftBooking(description));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/booking/confirm', requireOwner, async (req, res) => {
  try {
    const { draftId, confirm } = req.body || {};
    res.json(await booking.confirmBooking(draftId, confirm));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- #125 Plan podrozy z maili --- tylko wlasciciel
router.get('/plan', requireOwner, (req, res) => {
  res.json({ plan: mailPlan.listPlan() });
});

router.post('/plan/from-email', requireOwner, async (req, res) => {
  try {
    const { text } = req.body || {};
    res.status(201).json(await mailPlan.addFromEmail(text));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/plan/:id', requireOwner, (req, res) => {
  res.json({ plan: mailPlan.removePlanEntry(req.params.id) });
});

// --- #126 Sledzenie przesylek --- tylko wlasciciel
router.get('/courier', requireOwner, (req, res) => {
  res.json({ configured: courier.isConfigured(), watches: courier.listWatches() });
});

router.post('/courier', requireOwner, (req, res) => {
  try {
    const { trackingNumber, carrier, label } = req.body || {};
    res.status(201).json(courier.addWatch({ trackingNumber, carrier, label }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/courier/:id', requireOwner, (req, res) => {
  res.json({ watches: courier.removeWatch(req.params.id) });
});

router.post('/courier/:id/check', requireOwner, async (req, res) => {
  try {
    res.json(await courier.checkWatch(req.params.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- #127 Konwersja walut --- publiczne, bezstanowe (jak pogoda)
router.get('/currency', async (req, res) => {
  try {
    res.json(await currency.convert(req.query.from, req.query.to, req.query.amount));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- #128 Sugestie pakowania --- tylko wlasciciel (koszt wywolania Gemini,
// ten sam wzor co /api/vision i /api/expenses/scan)
router.post('/packing', requireOwner, async (req, res) => {
  try {
    const { city, startDate, endDate } = req.body || {};
    res.json(await packing.suggestPacking({ city, startDate, endDate }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- #129 Dystans do domu na zywo --- tylko wlasciciel (adres domowy)
router.get('/home', requireOwner, (req, res) => {
  res.json(homeDistance.getHome() || { configured: false });
});

router.post('/home', requireOwner, async (req, res) => {
  try {
    const { address } = req.body || {};
    res.status(201).json(await homeDistance.setHome(address));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/home/distance', requireOwner, async (req, res) => {
  try {
    const { lat, lon } = req.query;
    res.json(await homeDistance.distanceToHome({ lat: Number(lat), lon: Number(lon) }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- #130 Waznosc dokumentow (paszport/dowod) --- tylko wlasciciel
router.get('/documents', requireOwner, (req, res) => {
  res.json({ documents: documents.listDocuments() });
});

router.post('/documents', requireOwner, (req, res) => {
  try {
    const { name, expiresAt } = req.body || {};
    res.status(201).json(documents.addDocument({ name, expiresAt }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/documents/:id', requireOwner, (req, res) => {
  res.json({ documents: documents.removeDocument(req.params.id) });
});

router.get('/documents/expiring', requireOwner, (req, res) => {
  const days = Number(req.query.days) || 90;
  res.json({ documents: documents.listExpiringSoon(days) });
});

export default router;
