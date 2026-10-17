// Wykrywanie otwartego okna przy prognozie deszczu.
//
// Laczy dwie rzeczy, ktore osobno nic nie mowia: stan czujnika okna
// (binary_sensor.* w Home Assistant, on = otwarte) i biezaca pogode z
// server/weather.js (Open-Meteo, ten sam serwis co reszta Jarvisa - nie
// dublujemy tu integracji pogodowej wlasnym kodem). Gdy oba warunki sa
// spelnione naraz - alert przez magistrale zdarzen.
//
// UWAGA: server/weather.js daje pogode BIEZACA (current), nie prognoze
// godzinowa - "prognoza deszczu" w tym module oznacza wiec "aktualnie pada
// lub mzawi", nie przewidywanie na kilka godzin do przodu. To swiadomy
// kompromis: dobudowanie prawdziwej prognozy wymagaloby rozszerzenia
// weather.js (zakazane w tym batchu) o pole hourly z Open-Meteo.

import * as ha from './homeAssistant.js';
import * as bus from '../../server/core/bus.js';
import { getWeather, getWeatherByCoords } from '../../server/core/weather.js';
import { load, save } from '../../server/memory/memory.js';

const REALERT_GAP_MS = 60 * 60 * 1000; // nie powtarzaj tego samego alertu czesciej niz co godzine

function isRainy(condition) {
  return /deszcz|mzawk|burz/i.test(String(condition || ''));
}

function stateNamespace() {
  const d = load();
  if (!d.iot) d.iot = {};
  if (!d.iot.windowAlerts || typeof d.iot.windowAlerts !== 'object') d.iot.windowAlerts = {};
  return d;
}

/**
 * @param {string} windowEntityId np. "binary_sensor.okno_salon"
 * @param {{city?: string, lat?: number, lon?: number}} location jedno z: city, albo lat+lon
 */
export async function checkWindowBeforeRain(windowEntityId, location = {}) {
  if (!ha.isConfigured()) return { skipped: true, reason: 'Home Assistant nie jest skonfigurowany' };

  const state = await ha.getState(windowEntityId);
  if (!state) return { skipped: true, reason: `Nie znaleziono encji ${windowEntityId}` };
  const isOpen = state.state === 'on';
  if (!isOpen) return { entityId: windowEntityId, open: false, rain: false, alert: false };

  const weather =
    location.lat != null && location.lon != null
      ? await getWeatherByCoords(location.lat, location.lon)
      : await getWeather(location.city || process.env.OWNER_CITY || 'Warszawa');

  const rain = weather ? isRainy(weather.condition) : false;
  const result = { entityId: windowEntityId, open: true, rain, condition: weather?.condition || null, alert: isOpen && rain };

  if (result.alert) {
    const d = stateNamespace();
    const lastAt = d.iot.windowAlerts[windowEntityId] || 0;
    if (Date.now() - lastAt >= REALERT_GAP_MS) {
      d.iot.windowAlerts[windowEntityId] = Date.now();
      save(d);
      bus.publish(
        'iot',
        'window.rain_risk',
        `Otwarte okno (${windowEntityId}) przy opadach: ${weather.condition}`,
        { level: 'warn', speak: true, data: result }
      );
    }
  }

  return result;
}

/** Sprawdza liste okien naraz - do wywolania recznego albo z harmonogramu (scheduler.js). */
export async function checkWindowsBeforeRain(windowEntityIds = [], location = {}) {
  if (!ha.isConfigured()) return { skipped: true, reason: 'Home Assistant nie jest skonfigurowany' };
  const ids = windowEntityIds.length ? windowEntityIds : (await ha.getStates('binary_sensor')).map((s) => s.entity_id).filter((id) => /okno|window/i.test(id));
  const results = [];
  for (const id of ids) {
    try {
      results.push(await checkWindowBeforeRain(id, location));
    } catch (err) {
      results.push({ entityId: id, error: err.message });
    }
  }
  return { checked: results.length, alerts: results.filter((r) => r.alert).length, results };
}
