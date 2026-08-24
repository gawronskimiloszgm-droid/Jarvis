// Warstwa serwerowa modulu CAD: trzyma wygenerowane projekty w pamieci
// procesu i wydaje je jako JSON (do podgladu) albo STL (do druku).
//
// Trzymamy w pamieci, nie na dysku, bo darmowy Render i tak kasuje dysk
// przy wdrozeniu, a projekt jest tani do przeliczenia od nowa.

import { nanoid } from 'nanoid';
import { design, designAssembly, exportSTL, MATERIALS } from '../modules/cad/index.js';

const STORE = new Map();
const TTL_MS = 60 * 60 * 1000; // godzina
const MAX = 40;

function sweep() {
  const now = Date.now();
  for (const [id, entry] of STORE) {
    if (now - entry.at > TTL_MS) STORE.delete(id);
  }
  while (STORE.size > MAX) STORE.delete(STORE.keys().next().value);
}

export function create(spec) {
  const result = design(spec);
  const id = nanoid(10);
  STORE.set(id, { at: Date.now(), result });
  sweep();

  // Siatki NIE odsylamy w calosci przy kazdym zapytaniu o liste - tutaj
  // zwracamy pelny wynik, bo klient rysuje z niego podglad.
  return { id, ...result };
}

// Ogolne zlozenie z brył (dowolny przedmiot, nie tylko wspornik scienny) -
// patrz uzasadnienie przy designAssembly() w modules/cad/index.js.
export function createAssembly(spec) {
  const result = designAssembly(spec);
  const id = nanoid(10);
  STORE.set(id, { at: Date.now(), result });
  sweep();
  return { id, ...result };
}

export function get(id) {
  return STORE.get(id)?.result || null;
}

export function stl(id, ascii = false) {
  const entry = STORE.get(id);
  if (!entry) return null;
  return exportSTL(entry.result.mesh, { ascii, name: `jarvis-${id}` });
}

export const materials = Object.keys(MATERIALS);
