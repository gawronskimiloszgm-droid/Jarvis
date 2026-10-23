// #123: Monitorowanie korkow na trasie do pracy.
//
// Darmowe OSRM (router.project-osrm.org, patrz geo.js) liczy czas jazdy
// samochodem miedzy dwoma punktami. Pierwsze wywolanie po konfiguracji
// ustala "baseline" (zwykly czas przejazdu); kolejne, cykliczne sprawdzenia
// porownuja z nim biezacy czas i alarmuja przez bus.publish, gdy przekracza
// prog (domyslnie +50%).

import * as bus from '../core/bus.js';
import { loadTravel, saveTravel } from './store.js';
import { route } from './geo.js';

const MIN_INTERVAL_MS = Number(process.env.COMMUTE_CHECK_INTERVAL_MS || 20 * 60 * 1000); // 20 min
const DEFAULT_THRESHOLD_PCT = 50;

export function getConfig() {
  return loadTravel().travel.commute;
}

/**
 * Ustawia/aktualizuje trase dom->praca i od razu liczy baseline (zwykly
 * czas przejazdu w tym momencie) - kolejne sprawdzenia porownuja do niego.
 * @param {{homeLat:number, homeLon:number, workLat:number, workLon:number, thresholdPct?:number}} cfg
 */
export async function setConfig({ homeLat, homeLon, workLat, workLon, thresholdPct }) {
  const home = { lat: Number(homeLat), lon: Number(homeLon) };
  const work = { lat: Number(workLat), lon: Number(workLon) };
  if (![home.lat, home.lon, work.lat, work.lon].every(Number.isFinite)) {
    throw new Error('Podaj poprawne wspolrzedne homeLat/homeLon/workLat/workLon.');
  }

  const baseline = await route(home, work);
  if (!baseline) throw new Error('OSRM nie zwrocil trasy dla podanych wspolrzednych.');

  const data = loadTravel();
  data.travel.commute = {
    home,
    work,
    thresholdPct: Number.isFinite(Number(thresholdPct)) ? Math.max(5, Number(thresholdPct)) : DEFAULT_THRESHOLD_PCT,
    baselineSec: baseline.durationSec,
    lastDurationSec: baseline.durationSec,
    lastCheckedAt: Date.now(),
    createdAt: Date.now(),
  };
  saveTravel(data);
  return data.travel.commute;
}

/** Sprawdzenie "na teraz" - wolane recznie z endpointu albo ze schedulera. */
export async function checkNow() {
  const data = loadTravel();
  const cfg = data.travel.commute;
  if (!cfg) throw new Error('Trasa dom->praca nie jest skonfigurowana - ustaw ja przez POST /travel/commute/config.');

  const current = await route(cfg.home, cfg.work);
  if (!current) throw new Error('OSRM nie zwrocil trasy.');

  cfg.lastDurationSec = current.durationSec;
  cfg.lastCheckedAt = Date.now();

  const overPct = ((current.durationSec - cfg.baselineSec) / cfg.baselineSec) * 100;
  const isJammed = overPct >= cfg.thresholdPct;
  if (isJammed) {
    bus.publish(
      'travel',
      'commute.jam',
      `Korki na trasie do pracy: ${Math.round(current.durationSec / 60)} min zamiast zwyklych ${Math.round(cfg.baselineSec / 60)} min (+${overPct.toFixed(0)}%).`,
      { level: 'warn', speak: true, data: { durationSec: current.durationSec, baselineSec: cfg.baselineSec } }
    );
  }
  saveTravel(data);
  return { ...cfg, isJammed, overPct: Math.round(overPct) };
}

/** Wolane cyklicznie przez scheduler.js. */
export async function sweepCommute() {
  const cfg = getConfig();
  if (!cfg) return { checked: 0, configured: false };
  if (cfg.lastCheckedAt && Date.now() - cfg.lastCheckedAt < MIN_INTERVAL_MS) return { checked: 0, configured: true };
  try {
    await checkNow();
    return { checked: 1, configured: true };
  } catch (err) {
    bus.publish('travel', 'commute.error', `Sprawdzanie korkow nieudane: ${err.message}`, { level: 'warn' });
    return { checked: 0, configured: true, error: err.message };
  }
}
