// #104 Kolejka wydrukow z priorytetyzacja.
//
// Czas druku NIE jest liczony fizycznie (to wymagaloby symulacji ruchu
// glowicy) - szacujemy go prostym mnoznikiem g/h z masy modelu, ktora
// modules/cad juz zwraca jako massEstimateG. To zgrubne oszacowanie,
// wystarczajace do sortowania i planowania, nie do dokladnego ETA.

import { nanoid } from 'nanoid';
import { readData, writeData, round } from './store.js';
import { get as getCadModel } from '../../server/home/cad.js';
import { recordPrinted } from './filament.js';

// Gramy na godzine przy typowym 20% wypelnieniu i sredniej predkosci -
// PLA/PETG/ABS/ASA sa zblizone gestoscia, NYLON drukuje sie wolniej
// (nizsza predkosc zalecana w printProfiles.js), stad nizszy mnoznik.
const GRAMS_PER_HOUR = { PLA: 18, PETG: 15, ABS: 16, ASA: 15, NYLON: 11 };
const STATUSES = ['queued', 'printing', 'done', 'error'];

function estimateHours(massG, material) {
  const rate = GRAMS_PER_HOUR[material] || GRAMS_PER_HOUR.PLA;
  return massG > 0 ? massG / rate : 0;
}

function sorted(list) {
  return [...list].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}

export function listQueue() {
  return sorted(readData().cadExtra.printQueue);
}

export function addToQueue(input = {}) {
  const data = readData();
  let massEstimateG = Number(input.massEstimateG);
  let name = input.name ? String(input.name).slice(0, 120) : null;

  if (input.modelId && (!Number.isFinite(massEstimateG) || massEstimateG <= 0)) {
    const model = getCadModel(input.modelId);
    if (model) {
      massEstimateG = model.massEstimateG;
      if (!name) name = model.nazwa || model.params?.nazwa || `model ${input.modelId}`;
    }
  }
  if (!Number.isFinite(massEstimateG) || massEstimateG < 0) massEstimateG = 0;

  const material = GRAMS_PER_HOUR[String(input.material || '').toUpperCase()] ? String(input.material).toUpperCase() : 'PLA';

  const item = {
    id: nanoid(8),
    name: name || 'model bez nazwy',
    modelId: input.modelId || null,
    material,
    massEstimateG: Math.round(massEstimateG),
    estHours: round(estimateHours(massEstimateG, material), 2),
    priority: Number.isFinite(Number(input.priority)) ? Math.round(Number(input.priority)) : 0,
    status: 'queued',
    createdAt: Date.now(),
    printedAt: null,
  };
  data.cadExtra.printQueue.push(item);
  writeData(data);
  return item;
}

export function updateQueueItem(id, patch = {}) {
  const data = readData();
  const item = data.cadExtra.printQueue.find((i) => i.id === id);
  if (!item) return null;

  if (patch.name != null) item.name = String(patch.name).slice(0, 120);
  if (patch.priority != null && Number.isFinite(Number(patch.priority))) {
    item.priority = Math.round(Number(patch.priority));
  }
  if (patch.material && GRAMS_PER_HOUR[String(patch.material).toUpperCase()]) {
    item.material = String(patch.material).toUpperCase();
    item.estHours = round(estimateHours(item.massEstimateG, item.material), 2);
  }
  if (patch.status && STATUSES.includes(patch.status)) {
    const wasNotDone = item.status !== 'done';
    item.status = patch.status;
    if (patch.status === 'done' && wasNotDone) {
      item.printedAt = Date.now();
      // Zapis zuzycia filamentu robimy TUTAJ (nie w routerze), zeby kazda
      // droga oznaczenia druku jako gotowego (API, przyszly UI) zawsze
      // aktualizowala stan szpuli - latwo o to zapomniec w kliencie.
      recordPrinted(item.massEstimateG);
    }
  }
  writeData(data);
  return item;
}

export function removeFromQueue(id) {
  const data = readData();
  const before = data.cadExtra.printQueue.length;
  data.cadExtra.printQueue = data.cadExtra.printQueue.filter((i) => i.id !== id);
  writeData(data);
  return data.cadExtra.printQueue.length !== before;
}

/** Nadanie kolejnosci priorytetow na podstawie kolejnosci id w tablicy (index 0 = najwyzszy priorytet). */
export function reorderQueue(orderIds = []) {
  const data = readData();
  const list = data.cadExtra.printQueue;
  const n = list.length;
  orderIds.forEach((id, idx) => {
    const item = list.find((i) => i.id === id);
    if (item) item.priority = n - idx;
  });
  writeData(data);
  return sorted(list);
}

export { GRAMS_PER_HOUR };
