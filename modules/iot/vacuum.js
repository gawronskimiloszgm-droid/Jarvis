// Robot sprzatajacy - domena "vacuum" w Home Assistant. Uslugi start/pause/
// return_to_base sa czescia standardowego "vacuum" w HA, wiec dziala z
// wiekszoscia integracji (Xiaomi/Roborock, iRobot, Ecovacs...).

import * as ha from './homeAssistant.js';

export async function start(entityId) {
  return ha.callService('vacuum', 'start', entityId);
}

export async function pause(entityId) {
  return ha.callService('vacuum', 'pause', entityId);
}

export async function dock(entityId) {
  return ha.callService('vacuum', 'return_to_base', entityId);
}

/** Stan robota: 'docked' | 'cleaning' | 'paused' | 'returning' | 'error' | null. */
export async function status(entityId) {
  const state = await ha.getState(entityId);
  return state
    ? {
        entityId,
        state: state.state,
        batteryPct: state.attributes?.battery_level ?? null,
        fanSpeed: state.attributes?.fan_speed ?? null,
      }
    : null;
}

/** Wszystkie odkurzacze znane Home Assistant (do panelu/harmonogramu). */
export async function listVacuums() {
  return ha.getStates('vacuum');
}
