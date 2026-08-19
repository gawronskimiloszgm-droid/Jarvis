// Modul CAD: parametry -> bryla -> ocena wytrzymalosci -> plik STL.
//
// Wszystko jest synchroniczne i czysto obliczeniowe (kilka ms), wiec nie
// blokuje petli zdarzen. Cieżkiej pracy tu nie ma - siatka ma rzad tysiaca
// trojkatow, a wytrzymalosc to kilka mnozen.

import { bracketL, bounds, volumeMm3 } from './geometry.js';
import { evaluate, requiredThickness, stressField, MATERIALS, lbsToKg } from './stress.js';
import { toBinarySTL, toAsciiSTL } from './stl.js';

export const DEFAULTS = {
  plateW: 60,
  plateH: 80,
  shelfDepth: 45,
  thickness: 5,
  holeR: 2.5,
  material: 'PLA',
  loadKg: 3,
  ribs: true,
};

// Zamiana opisu slownego na parametry. Model jezykowy podaje liczby, ale
// gdy czegos nie poda, wchodza sensowne wartosci domyslne - lepsze niz
// odmowa wygenerowania czegokolwiek.
export function normalizeSpec(spec = {}) {
  const p = { ...DEFAULTS, ...spec };
  if (spec.loadLbs != null) p.loadKg = lbsToKg(Number(spec.loadLbs));
  p.loadKg = clampNum(p.loadKg, 0.1, 500);
  p.plateW = clampNum(p.plateW, 20, 300);
  p.plateH = clampNum(p.plateH, 20, 300);
  p.shelfDepth = clampNum(p.shelfDepth, 10, 300);
  p.thickness = clampNum(p.thickness, 1.5, 40);
  p.holeR = clampNum(p.holeR, 1, Math.min(p.plateW, p.plateH) / 6);
  if (!MATERIALS[p.material]) p.material = 'PLA';
  return p;
}

export function design(spec = {}) {
  const p = normalizeSpec(spec);

  const tris = bracketL({
    plateW: p.plateW,
    plateH: p.plateH,
    shelfDepth: p.shelfDepth,
    thickness: p.thickness,
    holeR: p.holeR,
    ribs: p.ribs,
  });

  const strength = evaluate({
    loadKg: p.loadKg,
    armMm: p.shelfDepth,
    widthMm: p.plateW,
    thickMm: p.thickness,
    material: p.material,
  });

  // Gdy nie przechodzi, od razu liczymy, co by pomoglo - sama informacja
  // "zlamie sie" jest bezuzyteczna bez propozycji.
  let fix = null;
  if (!strength.ok) {
    const need = requiredThickness({
      loadKg: p.loadKg,
      armMm: p.shelfDepth,
      widthMm: p.plateW,
      material: p.material,
      targetSafety: 2,
    });
    fix = {
      thickness: need,
      note: `zwieksz grubosc polki z ${p.thickness} do ${need} mm (albo skroc wysieg)`,
    };
  }

  const field = stressField(tris, {
    armAxis: 2,
    fixedAt: p.thickness,
    thickMm: p.thickness,
    peakMPa: strength.stressMPa,
  });

  const b = bounds(tris);
  const volume = volumeMm3(tris);
  const density = MATERIALS[p.material].densityGcm3;
  // Wydruk nie jest lity - przy typowym wypelnieniu 25% i scianach realna
  // masa to okolo 45% masy bryly. Podajemy oszacowanie, nie wartosc dokladna.
  const massG = (volume / 1000) * density * 0.45;

  return {
    params: p,
    triangles: tris.length,
    sizeMm: b.size.map((v) => Math.round(v * 10) / 10),
    volumeCm3: Math.round(volume / 100) / 10,
    massEstimateG: Math.round(massG),
    strength,
    fix,
    mesh: tris,
    field,
  };
}

export function exportSTL(tris, { ascii = false, name = 'jarvis-uchwyt' } = {}) {
  return ascii ? Buffer.from(toAsciiSTL(tris, name), 'utf8') : toBinarySTL(tris, name);
}

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export { MATERIALS };

// Rozpoznanie prosby o projekt z samego tekstu.
//
// Nie polegamy na tym, ze model grzecznie wystawi znacznik - sprawdzone:
// przy prosbie o uchwyt wolal napisac poradny elaborat z wymiarami wzietymi
// z powietrza. Wykrywamy wiec intencje tutaj i liczymy model DETERMINISTYCZNIE,
// dokladnie tak, jak dziala juz generator obrazow.
const DESIGN_VERBS = /(zaprojektuj|zaprojektowa|projekt(?:u|o)|zrob|wykonaj|wymodeluj|wygeneruj)/i;
const DESIGN_NOUNS = /(uchwyt|wspornik|k[ao]townik|polk|podstawk|mocowani|trzymak|hak|stojak|zawiesi)/i;

export function looksLikeDesignRequest(text = '') {
  const t = String(text).toLowerCase();
  if (DESIGN_VERBS.test(t) && DESIGN_NOUNS.test(t)) return true;
  // "czy uchwyt o grubosci 3 mm wytrzyma 5 kg"
  return DESIGN_NOUNS.test(t) && /(wytrzym|utrzyma|zlamie|uniesie)/i.test(t);
}

// Wyciagniecie parametrow z jezyka naturalnego. Czego nie ma - zostaje
// domyslne; lepiej policzyc model z sensownymi zalozeniami niz odmowic.
export function parseDesignSpec(text = '') {
  const t = String(text).toLowerCase().replace(',', '.');
  const spec = {};

  const lbs = t.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|funt)/);
  const kg = t.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilogram)/);
  if (lbs) spec.loadLbs = parseFloat(lbs[1]);
  else if (kg) spec.loadKg = parseFloat(kg[1]);

  // Wysieg: "wysieg 30 cm", "polka 45 mm", "dlugosc 12 cm"
  const arm = t.match(/(?:wysieg|wysi[eę]g|polk\w*|ramie|ramię|dlugosc|d[lł]ugo[sś][cć]|gl[eę]bok\w*)\D{0,12}(\d+(?:\.\d+)?)\s*(mm|cm)?/);
  if (arm) spec.shelfDepth = parseFloat(arm[1]) * (arm[2] === 'cm' ? 10 : 1);

  const thick = t.match(/(?:grubo[sś][cć]\w*|gruby|scianka|ścianka)\D{0,12}(\d+(?:\.\d+)?)\s*(mm|cm)?/);
  if (thick) spec.thickness = parseFloat(thick[1]) * (thick[2] === 'cm' ? 10 : 1);

  const wide = t.match(/(?:szeroko[sś][cć]\w*|szeroki)\D{0,12}(\d+(?:\.\d+)?)\s*(mm|cm)?/);
  if (wide) spec.plateW = parseFloat(wide[1]) * (wide[2] === 'cm' ? 10 : 1);

  const mat = t.match(/\b(pla|petg|abs|asa|nylon)\b/);
  if (mat) spec.material = mat[1].toUpperCase();

  return spec;
}
