// Rolety/zaluzje - domena "cover" w Home Assistant. Cienka warstwa wygody
// nad wspolnym klientem: te same 3 uslugi (open_cover/close_cover/
// set_cover_position), ktore HA i tak udostepnia, tylko pod czytelniejszymi
// nazwami funkcji.

import * as ha from './homeAssistant.js';

export async function open(entityId) {
  return ha.callService('cover', 'open_cover', entityId);
}

export async function close(entityId) {
  return ha.callService('cover', 'close_cover', entityId);
}

/** @param {string} entityId @param {number} position 0 (zamkniete) - 100 (otwarte) */
export async function setPosition(entityId, position) {
  const pos = Math.max(0, Math.min(100, Number(position)));
  if (!Number.isFinite(pos)) throw new Error('Pozycja rolety musi byc liczba 0-100.');
  return ha.callService('cover', 'set_cover_position', entityId, { position: pos });
}

/** Wszystkie encje typu cover ze stanem (do panelu/diagnostyki). */
export async function listCovers() {
  return ha.getStates('cover');
}
