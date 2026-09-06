// Wspolny namespace pamieci dla wszystkich modulow podrozy (server/travel/*).
//
// NIE edytujemy server/memory.js (zakaz w tym zadaniu) - trzymamy sie
// dokladnie tego samego wzoru co server/sentinel.js: load() zwraca CALY
// obiekt pamieci z zagwarantowanym polem `travel`, wywolujacy mutuje w
// miejscu i wola z powrotem save(data).

import { nanoid } from 'nanoid';
import * as memory from '../memory.js';

/** Zwraca cala pamiec (jak memory.load()), z zagwarantowanym data.travel.* */
export function loadTravel() {
  const data = memory.load();
  if (!data.travel || typeof data.travel !== 'object') data.travel = {};
  const t = data.travel;
  if (!Array.isArray(t.flights)) t.flights = [];
  if (!Array.isArray(t.courier)) t.courier = [];
  if (!Array.isArray(t.documents)) t.documents = [];
  if (!Array.isArray(t.plan)) t.plan = [];
  if (!Array.isArray(t.bookingDrafts)) t.bookingDrafts = [];
  if (t.home === undefined) t.home = null;
  if (t.commute === undefined) t.commute = null;
  return data;
}

export function saveTravel(data) {
  memory.save(data);
}

export function newId() {
  return nanoid(8);
}
