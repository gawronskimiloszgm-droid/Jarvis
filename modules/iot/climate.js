// Ogrzewanie/klimatyzacja per pokoj - domena "climate" w Home Assistant.
//
// Mapowanie "nazwa pokoju po polsku" -> "entity_id" trzyma sie w pamieci
// (server/memory.js pod kluczem iot.climateRooms), bo entity_id w HA jest
// techniczny (climate.termostat_salon) i nikt nie chce go wymawiac/pamietac -
// wygodniej powiedziec "ustaw 21 stopni w salonie".

import * as ha from './homeAssistant.js';
import { load, save } from '../../server/memory/memory.js';

function data() {
  const d = load();
  if (!d.iot) d.iot = {};
  if (!d.iot.climateRooms || typeof d.iot.climateRooms !== 'object') d.iot.climateRooms = {};
  return d;
}

function normalizeRoom(name) {
  return String(name || '').trim().toLowerCase();
}

/** Mapa {nazwa pokoju: entity_id}. */
export function listRooms() {
  return { ...data().iot.climateRooms };
}

export function setRoom(name, entityId) {
  const room = normalizeRoom(name);
  const entity = String(entityId || '').trim();
  if (!room || !entity) throw new Error('Wymagane sa: nazwa pokoju i entity_id (np. climate.salon).');
  const d = data();
  d.iot.climateRooms[room] = entity;
  save(d);
  return listRooms();
}

export function removeRoom(name) {
  const room = normalizeRoom(name);
  const d = data();
  delete d.iot.climateRooms[room];
  save(d);
  return listRooms();
}

function resolveEntity(roomOrEntityId) {
  const rooms = listRooms();
  const room = normalizeRoom(roomOrEntityId);
  return rooms[room] || roomOrEntityId; // pozwala tez podac entity_id wprost
}

/** Ustawienie temperatury docelowej w pokoju (po nazwie z mapy albo wprost entity_id). */
export async function setTemperature(roomOrEntityId, temperature) {
  const entityId = resolveEntity(roomOrEntityId);
  const temp = Number(temperature);
  if (!entityId) throw new Error(`Nieznany pokoj: "${roomOrEntityId}". Dodaj mapowanie przez POST /api/iot/climate/rooms.`);
  if (!Number.isFinite(temp)) throw new Error('Temperatura musi byc liczba.');
  return ha.callService('climate', 'set_temperature', entityId, { temperature: temp });
}

/** Biezacy stan klimatyzacji/ogrzewania w pokoju. */
export async function status(roomOrEntityId) {
  const entityId = resolveEntity(roomOrEntityId);
  if (!entityId) return null;
  const state = await ha.getState(entityId);
  return state
    ? {
        entityId,
        state: state.state,
        currentTemperature: state.attributes?.current_temperature ?? null,
        targetTemperature: state.attributes?.temperature ?? null,
        hvacAction: state.attributes?.hvac_action ?? null,
      }
    : null;
}

/** Wszystkie encje climate.* znane Home Assistant (do panelu/diagnostyki). */
export async function listClimateEntities() {
  return ha.getStates('climate');
}
