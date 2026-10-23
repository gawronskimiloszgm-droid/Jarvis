// Modul CAD: parametry -> bryla -> ocena wytrzymalosci -> plik STL.
//
// Wszystko jest synchroniczne i czysto obliczeniowe (kilka ms), wiec nie
// blokuje petli zdarzen. Cieżkiej pracy tu nie ma - siatka ma rzad tysiaca
// trojkatow, a wytrzymalosc to kilka mnozen.

import { bracketL, bounds, volumeMm3, box, cylinderZ, tubeZ, plateWithHole, placeTris } from './geometry.js';
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
// Jednoznacznie scienne/nosne - te slowa same wystarcza, bo prawie zawsze
// chodzi o plyte + polke z realnym obciazeniem.
const BRACKET_NOUNS_STRONG = /(wspornik|k[ao]townik|polk|mocowani|zawiesi)/i;
// Ogolne slowa - "podstawka", "stojak" czy "hak" tak samo dobrze opisuja
// stojak na telefon albo hak na kubek, ktore NIE sa scienna belka pod
// obciazeniem. Licza sie jako wspornik tylko z dodatkowym kontekstem
// sciany/obciazenia obok - inaczej trafialy do generatora L-ksztaltu
// bez wzgledu na to, o co naprawde prosil uzytkownik.
const BRACKET_NOUNS_WEAK = /(uchwyt|podstawk|trzymak|hak|stojak)/i;
const WALL_OR_LOAD_HINT = /(scian|na scianie|wisi|obciazeni|wytrzym|utrzyma|zlamie|uniesie|\bkg\b|kilogram|\bfunt|\blbs?\b)/i;

export function looksLikeDesignRequest(text = '') {
  const t = String(text).toLowerCase();
  if (DESIGN_VERBS.test(t)) {
    if (BRACKET_NOUNS_STRONG.test(t)) return true;
    if (BRACKET_NOUNS_WEAK.test(t) && WALL_OR_LOAD_HINT.test(t)) return true;
  }
  // "czy uchwyt o grubosci 3 mm wytrzyma 5 kg" - bez czasownika projektowania
  return (BRACKET_NOUNS_STRONG.test(t) || BRACKET_NOUNS_WEAK.test(t)) && /(wytrzym|utrzyma|zlamie|uniesie)/i.test(t);
}

// ---------- Ogolne zlozenia z brył (nie tylko wspornik) ----------
//
// bracketL() umie DOKLADNIE jeden ksztalt. Zeby Jarvis zaprojektowal
// "cokolwiek", zamiast kolejnego hardkodowanego ksztaltu dajemy mu maly
// zestaw klockow (prostopadloscian, walec, rura, plyta z jednym otworem),
// kazdy z wlasna pozycja x/y/z i opcjonalnym obrotem wokol jednej osi, i
// sklejamy je w jedna siatke. Sklejanie to zwykle zsumowanie trojkatow
// (bez prawdziwego CSG) - dla wydruku FDM to wystarcza, bo slicery i tak
// licza objetosc regula "parzystosc przejsc", wiec nakladajace sie bryly
// wychodza poprawnie jako jedna pełna forma, bez potrzeby prawdziwej
// operacji boolowskiej.
//
// To NIE jest generator dowolnych organicznych ksztaltow (gitara, figurka,
// kolo zebate z prawdziwymi zebami) - tylko rzeczy dajace sie zlozyc z
// prostych brył. Ale to duzo szerzej niz sam wspornik scienny: obudowy,
// stojaki, dystanse, uchwyty na kable, podstawki, proste zlozenia.

const PART_SHAPES = ['prostopadloscian', 'plyta_z_otworem', 'walec', 'rura'];
const MAX_PARTS = 24;

function num(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

// Kazda czesc dostaje sensowne wartosci domyslne zamiast odmowy - model
// czasem poda tylko ksztalt bez wszystkich wymiarow, a lepiej policzyc
// cos rozsadnego niz nic.
export function normalizePart(raw = {}) {
  const shape = PART_SHAPES.includes(raw.ksztalt) ? raw.ksztalt : 'prostopadloscian';
  const place = {
    x: num(raw.x, -500, 500, 0),
    y: num(raw.y, -500, 500, 0),
    z: num(raw.z, -500, 500, 0),
    rotAxis: ['x', 'y', 'z'].includes(raw.obrot_os) ? raw.obrot_os : null,
    rotDeg: num(raw.obrot_deg, -180, 180, 0),
  };

  if (shape === 'walec') {
    const r = num(raw.promien_mm, 1, 150, 10);
    return { shape, place, r, h: num(raw.wysokosc_mm, 1, 400, 20) };
  }
  if (shape === 'rura') {
    const rOuter = num(raw.promien_mm, 1, 150, 10);
    const rInner = num(raw.promien_wewn_mm, 0.2, rOuter - 0.2, Math.max(0.2, rOuter * 0.6));
    return { shape, place, rOuter, rInner, h: num(raw.wysokosc_mm, 1, 400, 20) };
  }

  const w = num(raw.szerokosc_mm, 2, 400, 40);
  const h = num(raw.wysokosc_mm, 2, 400, 40);
  const defaultDepth = shape === 'plyta_z_otworem' ? 5 : 20;
  const depth = num(raw.grubosc_mm ?? raw.glebokosc_mm, 1, 400, defaultDepth);

  if (shape === 'plyta_z_otworem') {
    const holeCap = Math.min(w, h) / 2 - 0.5;
    return {
      shape,
      place,
      w,
      h,
      t: depth,
      holeR: num(raw.otwor_promien_mm, 0.5, Math.max(0.5, holeCap), Math.max(0.5, Math.min(w, h) / 6)),
      holeCx: raw.otwor_x_mm != null ? num(raw.otwor_x_mm, 0, w, w / 2) : w / 2,
      holeCy: raw.otwor_y_mm != null ? num(raw.otwor_y_mm, 0, h, h / 2) : h / 2,
    };
  }
  return { shape: 'prostopadloscian', place, w, h, d: depth };
}

function partMesh(p) {
  if (p.shape === 'walec') return cylinderZ(0, 0, 0, p.r, p.h);
  if (p.shape === 'rura') return tubeZ(0, 0, 0, p.rOuter, p.rInner, p.h);
  if (p.shape === 'plyta_z_otworem') return plateWithHole(p.w, p.h, p.t, p.holeR, p.holeCx, p.holeCy);
  return box(0, 0, 0, p.w, p.h, p.d);
}

export function designAssembly(spec = {}) {
  const rawParts = Array.isArray(spec.czesci) ? spec.czesci.slice(0, MAX_PARTS) : [];
  if (rawParts.length === 0) throw new Error('Brak czesci do zbudowania.');
  const parts = rawParts.map(normalizePart);

  const tris = [];
  for (const p of parts) tris.push(...placeTris(partMesh(p), p.place));

  const b = bounds(tris);
  const volume = volumeMm3(tris);
  const material = MATERIALS[spec.material] ? spec.material : 'PLA';
  const density = MATERIALS[material].densityGcm3;
  const massG = (volume / 1000) * density * 0.45;

  return {
    params: { czesci: parts.length, material },
    triangles: tris.length,
    sizeMm: b.size.map((v) => Math.round(v * 10) / 10),
    volumeCm3: Math.round(volume / 100) / 10,
    massEstimateG: Math.round(massG),
    strength: null,
    fix: null,
    mesh: tris,
    field: null,
    nazwa: typeof spec.nazwa === 'string' ? spec.nazwa.slice(0, 80) : null,
  };
}

// Rozpoznanie ogolnej prosby o model, gdy to NIE jest wspornik scienny
// (ten ma wlasny, wczesniejszy detektor z realna analiza wytrzymalosci).
// Uzywane tylko w czacie pisanym - w rozmowie glosowej model sam wybiera
// wlasciwe narzedzie (zaprojektuj vs zaprojektuj_model) przez function
// calling, tam ten regex nie jest potrzebny.
// "zaprojektuj/zamodeluj" znacza praktycznie zawsze jedno i to samo - starcza
// samo slowo. "zrob/wygeneruj/stworz/wydrukuj" sa uzywane do wszystkiego
// (zrob kawe, wygeneruj obraz, stworz liste) - te licza sie tylko razem z
// dodatkowym sygnalem druku/wymiarow, inaczej lapalyby zupelnie inne prosby.
const GENERAL_DESIGN_VERBS_STRONG = /(zaprojektuj|zaprojektowa|zamodeluj|wymodeluj)/i;
const GENERAL_DESIGN_VERBS_WEAK = /(zrob|wygeneruj|stworz|wydrukuj)/i;
const GENERAL_DESIGN_HINT = /(model 3d|do druku|na drukark|plik stl|\bstl\b|wymiar|\d+\s*x\s*\d+)/i;

export function looksLikeGeneralDesignRequest(text = '') {
  const t = String(text).toLowerCase();
  if (looksLikeDesignRequest(t)) return false; // wspornik ma pierwszenstwo, ma realny model wytrzymalosci
  if (GENERAL_DESIGN_VERBS_STRONG.test(t)) return true;
  return GENERAL_DESIGN_VERBS_WEAK.test(t) && GENERAL_DESIGN_HINT.test(t);
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
