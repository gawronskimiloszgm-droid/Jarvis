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
