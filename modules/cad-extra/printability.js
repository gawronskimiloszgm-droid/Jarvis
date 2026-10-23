// #110 Automatyczna korekta modelu pod katem drukowalnosci.
//
// Sama heurystyka: porownanie bounding-boxa modelu (sizeMm z modules/cad)
// z typowym obszarem roboczym drukarki. Konfigurowalne przez env, bo
// obszar roboczy jest wlasciwoscia KONKRETNEJ drukarki, nie tej aplikacji.

const DEFAULT_BED = {
  x: Number(process.env.CAD_EXTRA_BED_X_MM) || 220,
  y: Number(process.env.CAD_EXTRA_BED_Y_MM) || 220,
  z: Number(process.env.CAD_EXTRA_BED_Z_MM) || 250,
};

function round(v, n = 3) {
  const m = 10 ** n;
  return Math.round(v * m) / m;
}

export function defaultBed() {
  return { ...DEFAULT_BED };
}

/**
 * @param {[number,number,number]} sizeMm bounding-box modelu (X,Y,Z) w mm
 * @param {{x:number,y:number,z:number}} [bed] obszar roboczy drukarki - domyslnie DEFAULT_BED
 */
export function checkPrintability(sizeMm, bed = DEFAULT_BED) {
  const [sx, sy, sz] = sizeMm;
  const fitsX = sx <= bed.x;
  const fitsY = sy <= bed.y;
  const fitsZ = sz <= bed.z;
  const fits = fitsX && fitsY && fitsZ;

  const warnings = [];
  if (!fitsX) warnings.push(`Szerokosc modelu ${round(sx, 1)} mm przekracza obszar roboczy X (${bed.x} mm).`);
  if (!fitsY) warnings.push(`Wysokosc modelu ${round(sy, 1)} mm przekracza obszar roboczy Y (${bed.y} mm).`);
  if (!fitsZ) warnings.push(`Glebokosc modelu ${round(sz, 1)} mm przekracza obszar roboczy Z (${bed.z} mm).`);

  // Skalowanie w dol o odrobine wiecej niz scisle potrzeba (floor do 3
  // miejsc), zeby po realnym przeliczeniu w slicerze model nadal miescil
  // sie z niewielkim marginesem, a nie dokladnie na styk.
  let suggestedScale = 1;
  if (!fits) {
    const raw = Math.min(bed.x / sx, bed.y / sy, bed.z / sz);
    suggestedScale = Math.max(0.01, Math.floor(raw * 1000) / 1000);
  }

  return {
    bed: { ...bed },
    sizeMm: [round(sx, 1), round(sy, 1), round(sz, 1)],
    fits,
    warnings,
    suggestedScalePercent: fits ? 100 : round(suggestedScale * 100, 1),
  };
}
