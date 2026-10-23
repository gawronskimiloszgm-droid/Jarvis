// Monitorowanie zuzycia energii i alert przy anomalii.
//
// Heurystyka jest celowo prosta (srednia z ostatnich 7 dni historii +
// odchylenie procentowe), bo to modul zewnetrzny bez ML: Home Assistant
// History API oddaje surowe probki stanu sensor.* (najczesciej licznik kWh
// albo chwilowa moc W), z tego liczymy srednia i porownujemy z najnowsza
// probka. Nie jest to wykrywanie trendu ani sezonowosci - to prog "cos tu
// wyglada wyraznie inaczej niz zwykle", ktory ma zasygnalizowac czlowiekowi,
// zeby sam ocenil kontekst.

import * as ha from './homeAssistant.js';
import * as bus from '../../server/core/bus.js';
import { load, save } from '../../server/memory/memory.js';

const DEFAULT_THRESHOLD_PCT = Number(process.env.IOT_ENERGY_ANOMALY_PCT || 50); // % odchylenia od sredniej 7-dniowej
const REALERT_GAP_MS = 6 * 60 * 60 * 1000; // nie spamuj tym samym alertem czesciej niz co 6h

function stateNamespace() {
  const d = load();
  if (!d.iot) d.iot = {};
  if (!d.iot.energyAlerts || typeof d.iot.energyAlerts !== 'object') d.iot.energyAlerts = {};
  return d;
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sprawdza jedna encje sensor.* pod katem anomalii wzgledem sredniej z 7 dni.
 * Zwraca raport nawet gdy nic nie jest niepokojace (do panelu/diagnostyki).
 * @param {string} entityId np. "sensor.zuzycie_pradu"
 * @param {number} [thresholdPct] prog alertu w % (domyslnie IOT_ENERGY_ANOMALY_PCT albo 50)
 */
export async function checkEntityAnomaly(entityId, thresholdPct = DEFAULT_THRESHOLD_PCT) {
  const history = await ha.getHistory(entityId, 24 * 7);
  const samples = history.map((h) => numeric(h.state)).filter((n) => n !== null);
  if (samples.length < 3) {
    return { entityId, ok: true, reason: 'za malo probek historii do oceny', samples: samples.length };
  }

  const latest = samples[samples.length - 1];
  const priorSamples = samples.slice(0, -1);
  const avg = priorSamples.reduce((sum, n) => sum + n, 0) / priorSamples.length;
  if (avg === 0) {
    return { entityId, ok: true, reason: 'srednia historyczna to 0 - brak punktu odniesienia', latest, avg };
  }

  const deviationPct = ((latest - avg) / Math.abs(avg)) * 100;
  const anomaly = Math.abs(deviationPct) >= thresholdPct;

  const result = {
    entityId,
    ok: !anomaly,
    latest,
    avg7d: Math.round(avg * 100) / 100,
    deviationPct: Math.round(deviationPct * 10) / 10,
    thresholdPct,
  };

  if (anomaly) {
    const d = stateNamespace();
    const lastAlertAt = d.iot.energyAlerts[entityId] || 0;
    if (Date.now() - lastAlertAt >= REALERT_GAP_MS) {
      d.iot.energyAlerts[entityId] = Date.now();
      save(d);
      bus.publish(
        'iot',
        'energy.anomaly',
        `Anomalia zuzycia energii: ${entityId} = ${latest} (srednia 7d: ${result.avg7d}, odchylenie ${result.deviationPct}%)`,
        { level: 'warn', speak: true, data: result }
      );
    }
  }

  return result;
}

/**
 * Sprawdza liste encji sensor.* naraz. To ta funkcja jest przeznaczona do
 * podpiecia pod cykliczny upkeep (patrz raport modulu IoT - upkeep.js NIE
 * jest edytowany w tym batchu, wiec podlaczenie robi sie osobno).
 * @param {string[]} entityIds
 */
export async function checkEnergyAnomalies(entityIds = []) {
  if (!ha.isConfigured()) return { skipped: true, reason: 'Home Assistant nie jest skonfigurowany' };
  const ids = entityIds.length ? entityIds : (await ha.getStates('sensor')).map((s) => s.entity_id).filter((id) => /energy|power|prad|zuzycie/i.test(id));
  const results = [];
  for (const id of ids) {
    try {
      results.push(await checkEntityAnomaly(id));
    } catch (err) {
      results.push({ entityId: id, ok: true, error: err.message });
    }
  }
  return { checked: results.length, anomalies: results.filter((r) => !r.ok).length, results };
}
