// Oszacowanie wytrzymalosci wspornika.
//
// UCZCIWIE O TYM, CZYM TO JEST: to NIE jest analiza metoda elementow
// skonczonych. MES wymaga podzialu bryly na siatke elementow i rozwiazania
// ukladu rownan - to osobny, ciezki solver.
//
// Zamiast tego liczymy klasyczny model belki wspornikowej, ten sam, ktorego
// uzywa konstruktor przy szybkiej ocenie:
//
//     M = F * L            moment gnacy w utwierdzeniu
//     W = b * t^2 / 6      wskaznik wytrzymalosci przekroju prostokatnego
//     sigma = M / W        naprezenie gnace
//
// Dla wspornika typu L to jest wlasciwy model: polka zachowuje sie jak
// belka utwierdzona w plycie, a zniszczenie prawie zawsze zaczyna sie
// wlasnie w narozu. Wyniki sa rzedu wielkosci zgodne z MES dla prostych
// ksztaltow, ale NIE uwzgledniaja spietrzen naprezen na karbach, anizotropii
// wydruku 3D ani zeber. Traktuj to jako oszacowanie z zapasem, nie jako
// dowod bezpieczenstwa.

// Wytrzymalosc materialow. Dla druku 3D podajemy wartosci MIEDZYWARSTWOWE
// (wzdluz osi Z), bo tam wydruk jest najslabszy i tam peka.
export const MATERIALS = {
  PLA: { name: 'PLA', yieldMPa: 45, printedZMPa: 22, densityGcm3: 1.24 },
  PETG: { name: 'PETG', yieldMPa: 50, printedZMPa: 26, densityGcm3: 1.27 },
  ABS: { name: 'ABS', yieldMPa: 40, printedZMPa: 18, densityGcm3: 1.04 },
  ASA: { name: 'ASA', yieldMPa: 44, printedZMPa: 20, densityGcm3: 1.07 },
  NYLON: { name: 'Nylon', yieldMPa: 70, printedZMPa: 35, densityGcm3: 1.14 },
};

export const G = 9.80665;

export function lbsToKg(lbs) {
  return lbs * 0.45359237;
}

// Naprezenie w utwierdzeniu polki.
//   loadKg    - masa zawieszona na koncu polki
//   armMm     - ramie (wysiegan polki)
//   widthMm   - szerokosc przekroju
//   thickMm   - grubosc przekroju
export function cantileverStress({ loadKg, armMm, widthMm, thickMm }) {
  const forceN = loadKg * G;
  const armM = armMm / 1000;
  const bM = widthMm / 1000;
  const tM = thickMm / 1000;

  const momentNm = forceN * armM;
  const sectionModulus = (bM * tM * tM) / 6; // m^3
  const stressPa = sectionModulus > 0 ? momentNm / sectionModulus : Infinity;

  return {
    forceN,
    momentNm,
    stressMPa: stressPa / 1e6,
  };
}

export function evaluate({ loadKg, armMm, widthMm, thickMm, material = 'PLA', printed = true }) {
  const mat = MATERIALS[material] || MATERIALS.PLA;
  const limit = printed ? mat.printedZMPa : mat.yieldMPa;
  const { forceN, momentNm, stressMPa } = cantileverStress({ loadKg, armMm, widthMm, thickMm });

  const safety = stressMPa > 0 ? limit / stressMPa : Infinity;

  // Progi bierzemy z praktyki konstruktorskiej: ponizej 1.5 nie ma marginesu
  // na niedoskonalosci wydruku, ponizej 1.0 element sie po prostu zlamie.
  let verdict;
  if (safety < 1) verdict = 'ZLAMIE SIE';
  else if (safety < 1.5) verdict = 'NA GRANICY';
  else if (safety < 3) verdict = 'BEZPIECZNY';
  else verdict = 'DUZY ZAPAS';

  return {
    material: mat.name,
    limitMPa: limit,
    limitBasis: printed ? 'wytrzymalosc miedzywarstwowa wydruku' : 'granica plastycznosci materialu',
    forceN: round(forceN, 1),
    momentNm: round(momentNm, 2),
    stressMPa: round(stressMPa, 1),
    safety: Number.isFinite(safety) ? round(safety, 2) : null,
    verdict,
    ok: safety >= 1.5,
  };
}

// Minimalna grubosc polki dajaca zadany zapas - stad bierze sie propozycja
// poprawki, gdy model nie przechodzi.
export function requiredThickness({ loadKg, armMm, widthMm, material = 'PLA', printed = true, targetSafety = 2 }) {
  const mat = MATERIALS[material] || MATERIALS.PLA;
  const limit = (printed ? mat.printedZMPa : mat.yieldMPa) * 1e6;
  const momentNm = loadKg * G * (armMm / 1000);
  const bM = widthMm / 1000;
  // sigma = 6M/(b t^2) <= limit/target  =>  t >= sqrt(6*M*target/(b*limit))
  const tM = Math.sqrt((6 * momentNm * targetSafety) / (bM * limit));
  return round(tM * 1000, 1);
}

// Mapa naprezen na trojkatach.
//
// W belce wspornikowej moment rosnie liniowo od konca do utwierdzenia, a
// naprezenie dodatkowo rosnie z odlegloscia od osi obojetnej. Kolorujemy
// wiec kazdy trojkat wartoscia wynikajaca z jego POLOZENIA w tym modelu -
// to nie jest wynik solvera, tylko rozklad analityczny naniesiony na siatke.
export function stressField(tris, { armAxis = 2, fixedAt = 0, thickMm = 4, peakMPa = 1 }) {
  let maxArm = 0;
  for (const t of tris) {
    for (const k of ['a', 'b', 'c']) {
      const d = Math.abs(t[k][armAxis] - fixedAt);
      if (d > maxArm) maxArm = d;
    }
  }

  return tris.map((t) => {
    const cz = (t.a[armAxis] + t.b[armAxis] + t.c[armAxis]) / 3;
    const arm = Math.abs(cz - fixedAt);
    // Im blizej utwierdzenia, tym wiekszy moment -> wieksze naprezenie.
    const momentFactor = maxArm > 0 ? 1 - arm / maxArm : 1;
    // Odleglosc od osi obojetnej (srodek grubosci) w kierunku gnacym.
    const cy = (t.a[1] + t.b[1] + t.c[1]) / 3;
    const fibre = Math.min(1, Math.abs(cy - thickMm / 2) / (thickMm / 2 || 1));
    const value = peakMPa * momentFactor * (0.35 + 0.65 * fibre);
    return { value: round(value, 2), ratio: peakMPa > 0 ? clamp(value / peakMPa, 0, 1) : 0 };
  });
}

// Zielony -> zolty -> czerwony. Skala jak na mapach cieplnych w programach
// inzynierskich: zimne = spokojne, czerwone = krytyczne.
export function heatColor(ratio) {
  const r = clamp(ratio, 0, 1);
  if (r < 0.5) {
    const k = r / 0.5;
    return [Math.round(40 + k * 215), Math.round(190 + k * 65), Math.round(120 - k * 60)];
  }
  const k = (r - 0.5) / 0.5;
  return [255, Math.round(255 - k * 200), Math.round(60 - k * 45)];
}

function round(v, n) {
  const m = 10 ** n;
  return Math.round(v * m) / m;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
