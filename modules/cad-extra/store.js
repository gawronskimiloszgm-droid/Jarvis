// Wspolna persystencja dla wszystkich funkcji z modules/cad-extra/.
//
// NIE dotykamy server/memory.js - tylko go importujemy (load/save operuja
// na calym obiekcie stanu, wiec caly ten katalog trzyma swoje dane pod
// jednym nowym kluczem `cadExtra`, tak jak np. `routines` czy `expenses`).

import { load, save } from '../../server/memory.js';

function ensureCadExtra(data) {
  if (!data.cadExtra || typeof data.cadExtra !== 'object') {
    data.cadExtra = { printQueue: [], filament: { capacityG: null, printedTotalG: 0, alerted: false } };
  }
  if (!Array.isArray(data.cadExtra.printQueue)) data.cadExtra.printQueue = [];
  if (!data.cadExtra.filament || typeof data.cadExtra.filament !== 'object') {
    data.cadExtra.filament = { capacityG: null, printedTotalG: 0, alerted: false };
  }
  return data;
}

/** Caly obiekt stanu (load() z memory.js) z gwarancja, ze data.cadExtra istnieje. */
export function readData() {
  return ensureCadExtra(load());
}

/** Zapis - identyczny z memory.js save(), tylko nazwany pod ten katalog. */
export function writeData(data) {
  save(data);
}

export function round(v, n = 1) {
  const m = 10 ** n;
  return Math.round(Number(v) * m) / m;
}
