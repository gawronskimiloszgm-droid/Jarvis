// Inteligentny zamek drzwi - domena "lock" w Home Assistant (priorytet,
// zgodnie z zadaniem: wspolny klient HA obsluguje wiekszosc popularnych
// zamkow, ktore juz maja integracje HA - Nuki, Yale, Aqara itd.).
//
// Gdy ktos ma zamek BEZ integracji HA (rzadki, ale mozliwy przypadek - np.
// wlasne API producenta), patrz smartLockProvider.js obok - osobny,
// jasno nazwany modul z wlasnym env, ktory nie miesza sie z tym plikiem.

import * as ha from './homeAssistant.js';

export async function lock(entityId) {
  return ha.callService('lock', 'lock', entityId);
}

export async function unlock(entityId) {
  return ha.callService('lock', 'unlock', entityId);
}

/** Stan zamka: 'locked' | 'unlocked' | 'locking' | 'unlocking' | 'jammed' | null. */
export async function status(entityId) {
  const state = await ha.getState(entityId);
  return state ? { entityId, state: state.state, attributes: state.attributes } : null;
}

/** Wszystkie zamki znane Home Assistant (do panelu/diagnostyki). */
export async function listLocks() {
  return ha.getStates('lock');
}
