// #101 Biblioteka gotowych szablonow.
//
// Zero nowej geometrii - kazdy szablon to gotowy zestaw parametrow dla
// design() (wspornik L z modules/cad) albo designAssembly() (dowolne
// zlozenie z brył), scalany z ewentualnymi nadpisaniami uzytkownika i
// puszczany przez TE SAME funkcje, ktorych uzywa juz server/cad.js -
// dzieki temu utworzony model od razu dziala z istniejacymi endpointami
// /api/cad/:id, /api/cad/:id/stl i /api/cad/:id/print.

import { create as createDesign, createAssembly } from '../../server/cad.js';

// Otwory montazowe Raspberry Pi (Model 2B/3B/4B) sa w rozstawie 58x49 mm,
// wciete 3.5 mm od krawedzi plytki 85x56 mm - podstawke robimy troche
// wieksza (margines na scianki), a nozki stawiamy dokladnie w tym rozstawie.
const RPI_MARGIN = 5;
const RPI_W = 85 + RPI_MARGIN * 2;
const RPI_D = 56 + RPI_MARGIN * 2;

export const TEMPLATES = {
  'uchwyt-na-kubek': {
    label: 'Uchwyt na kubek',
    description: 'Maly wspornik scienny w ksztalcie L pod kubek/kubek z uchem - lekkie obciazenie, krotki wysieg.',
    kind: 'design',
    defaultParams: {
      plateW: 40,
      plateH: 50,
      shelfDepth: 22,
      thickness: 3,
      holeR: 2,
      material: 'PLA',
      loadKg: 0.5,
      ribs: true,
    },
  },
  'hak-scienny': {
    label: 'Hak scienny',
    description: 'Solidniejszy wspornik L pod hak/pasek/torbe - dluzszy wysieg i wieksze obciazenie niz uchwyt na kubek.',
    kind: 'design',
    defaultParams: {
      plateW: 55,
      plateH: 65,
      shelfDepth: 18,
      thickness: 4,
      holeR: 2.5,
      material: 'PLA',
      loadKg: 2.5,
      ribs: true,
    },
  },
  'organizer-biurko': {
    label: 'Organizer na biurko',
    description: 'Plaska taca z trzema przegrodkami - 4 przegrody na dlugopisy/drobiazgi.',
    kind: 'assembly',
    defaultParams: {
      material: 'PETG',
      nazwa: 'Organizer na biurko',
      czesci: [
        { ksztalt: 'prostopadloscian', x: 0, y: 0, z: 0, szerokosc_mm: 180, wysokosc_mm: 100, grubosc_mm: 3 },
        { ksztalt: 'prostopadloscian', x: 44, y: 0, z: 3, szerokosc_mm: 3, wysokosc_mm: 100, grubosc_mm: 30 },
        { ksztalt: 'prostopadloscian', x: 88, y: 0, z: 3, szerokosc_mm: 3, wysokosc_mm: 100, grubosc_mm: 30 },
        { ksztalt: 'prostopadloscian', x: 132, y: 0, z: 3, szerokosc_mm: 3, wysokosc_mm: 100, grubosc_mm: 30 },
      ],
    },
  },
  'obudowa-raspberry-pi': {
    label: 'Obudowa na Raspberry Pi',
    description:
      'Otwarta taca z 4 nozkami dystansowymi w rozstawie montazowym Raspberry Pi (58x49 mm) i niskimi sciankami bocznymi. Przyblizone wymiary ogolne - bez wycietych otworow na porty.',
    kind: 'assembly',
    defaultParams: {
      material: 'PETG',
      nazwa: 'Obudowa Raspberry Pi',
      czesci: [
        { ksztalt: 'prostopadloscian', x: 0, y: 0, z: 0, szerokosc_mm: RPI_W, wysokosc_mm: RPI_D, grubosc_mm: 3 },
        { ksztalt: 'walec', x: RPI_MARGIN + 3.5, y: RPI_MARGIN + 3.5, z: 3, promien_mm: 2.5, wysokosc_mm: 6 },
        { ksztalt: 'walec', x: RPI_MARGIN + 3.5, y: RPI_MARGIN + 3.5 + 49, z: 3, promien_mm: 2.5, wysokosc_mm: 6 },
        { ksztalt: 'walec', x: RPI_MARGIN + 3.5 + 58, y: RPI_MARGIN + 3.5, z: 3, promien_mm: 2.5, wysokosc_mm: 6 },
        { ksztalt: 'walec', x: RPI_MARGIN + 3.5 + 58, y: RPI_MARGIN + 3.5 + 49, z: 3, promien_mm: 2.5, wysokosc_mm: 6 },
        { ksztalt: 'prostopadloscian', x: 0, y: 0, z: 3, szerokosc_mm: RPI_W, wysokosc_mm: 2.5, grubosc_mm: 18 },
        { ksztalt: 'prostopadloscian', x: 0, y: RPI_D - 2.5, z: 3, szerokosc_mm: RPI_W, wysokosc_mm: 2.5, grubosc_mm: 18 },
        { ksztalt: 'prostopadloscian', x: 0, y: 0, z: 3, szerokosc_mm: 2.5, wysokosc_mm: RPI_D, grubosc_mm: 18 },
        { ksztalt: 'prostopadloscian', x: RPI_W - 2.5, y: 0, z: 3, szerokosc_mm: 2.5, wysokosc_mm: RPI_D, grubosc_mm: 18 },
      ],
    },
  },
};

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([name, t]) => ({
    name,
    label: t.label,
    description: t.description,
    kind: t.kind,
    defaultParams: t.defaultParams,
  }));
}

// Plytkie scalenie parametrow - dla wspornika (design) to wystarcza (proste
// pola liczbowe), dla zlozenia pozwalamy nadpisac material/nazwe wprost,
// a "czesci" tylko w calosci (nadpisanie pojedynczej czesci nie ma dobrze
// zdefiniowanego znaczenia bez identyfikatorow czesci w szablonie).
export function createFromTemplate(name, overrides = {}) {
  const tpl = TEMPLATES[name];
  if (!tpl) throw new Error(`Nieznany szablon "${name}". Dostepne: ${Object.keys(TEMPLATES).join(', ')}`);

  if (tpl.kind === 'design') {
    const spec = { ...tpl.defaultParams, ...pick(overrides, Object.keys(tpl.defaultParams)) };
    return { template: name, ...createDesign(spec) };
  }

  const spec = { ...tpl.defaultParams };
  if (overrides.material) spec.material = overrides.material;
  if (overrides.nazwa) spec.nazwa = overrides.nazwa;
  if (Array.isArray(overrides.czesci) && overrides.czesci.length) spec.czesci = overrides.czesci;
  return { template: name, ...createAssembly(spec) };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
}
