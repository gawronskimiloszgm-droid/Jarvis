// Kalkulatory warsztatowe: ASG (energia, kulki, przelozenia, akumulator), elektronika (Ohm, LED,
// paski rezystorow, dzielnik), gwinty metryczne i druk 3D. Czysta logika, testy w tests/workkit.test.mjs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const FPS = 0.3048;

  /** Energia kulki: predkosc w fps albo m/s, masa w gramach. */
  function bbEnergy({ fps, ms, g = 0.2 }) {
    const v = ms != null ? Number(ms) : Number(fps) * FPS;
    const m = Number(g) / 1000;
    if (!(v > 0) || !(m > 0)) return null;
    const j = 0.5 * m * v * v;
    return { joule: r2(j, 3), ms: r2(v, 1), fps: r2(v / FPS, 0) };
  }

  /** Predkosc przy innej masie kulki, przy tej samej energii (przyblizenie dla replik sprezynowych). */
  function sameEnergyFps(fps, gFrom, gTo) {
    const e = bbEnergy({ fps, g: gFrom });
    if (!e || !(gTo > 0)) return null;
    const v = Math.sqrt((2 * e.joule) / (gTo / 1000));
    return { fps: r2(v / FPS, 0), ms: r2(v, 1), joule: e.joule };
  }

  // Typowe limity energii; kazde pole i organizator moga miec wlasne, dlatego tylko jako punkt odniesienia.
  const LIMITS = [
    { name: 'CQB', joule: 1.0 },
    { name: 'AEG / szturmowa', joule: 1.49 },
    { name: 'DMR', joule: 2.32 },
    { name: 'Snajperka (bolt)', joule: 3.34 },
  ];
  function limitsFor(joule) {
    return LIMITS.map((l) => ({ ...l, ok: joule <= l.joule + 1e-9, fps02: r2(Math.sqrt((2 * l.joule) / 0.0002) / FPS, 0) }));
  }

  /** Przelozenie gearboxa z liczby zebow kolejnych par (zebatka napedzana / napedzajaca). */
  function gearRatio(pairs) {
    const list = (pairs || []).map(([driven, driver]) => Number(driven) / Number(driver)).filter((v) => v > 0 && Number.isFinite(v));
    if (!list.length) return null;
    return r2(list.reduce((a, b) => a * b, 1), 2);
  }

  /** Szacowana szybkostrzelnosc: obroty silnika pod obciazeniem przez przelozenie (jeden cykl na obrot sektorowki). */
  function rof({ rpm, ratio, loadFactor = 0.7 }) {
    const r = Number(rpm);
    const k = Number(ratio);
    if (!(r > 0) || !(k > 0)) return null;
    return Math.round(((r * loadFactor) / k / 60) * 10) / 10;
  }

  /** Akumulator: ile strzalow i minut ciaglego ognia przy danym poborze. */
  function battery({ mAh, amps = 15, rofBps = 20 }) {
    const c = Number(mAh);
    const a = Number(amps);
    if (!(c > 0) || !(a > 0)) return null;
    const seconds = (c / 1000 / a) * 3600 * 0.8; // 80% pojemnosci uzytkowej
    return { minutes: r2(seconds / 60, 1), shots: Math.round(seconds * Number(rofBps || 20)) };
  }

  /** Prawo Ohma i moc: podaj dowolne dwie z U, I, R, P. */
  function ohm({ U, I, R, P }) {
    const has = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
    let u = has(U) ? Number(U) : null;
    let i = has(I) ? Number(I) : null;
    let r = has(R) ? Number(R) : null;
    let p = has(P) ? Number(P) : null;
    if ([u, i, r, p].filter((v) => v != null).length < 2) return null;
    if (u != null && i != null) { r = u / i; p = u * i; }
    else if (u != null && r != null) { i = u / r; p = (u * u) / r; }
    else if (u != null && p != null) { i = p / u; r = (u * u) / p; }
    else if (i != null && r != null) { u = i * r; p = i * i * r; }
    else if (i != null && p != null) { u = p / i; r = p / (i * i); }
    else if (r != null && p != null) { u = Math.sqrt(p * r); i = Math.sqrt(p / r); }
    return { U: r2(u, 3), I: r2(i, 4), R: r2(r, 2), P: r2(p, 3) };
  }

  const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  /** Najblizsza wartosc szeregu E12 nie mniejsza niz podana (bezpieczniej dla LED). */
  function e12Up(ohms) {
    if (!(ohms > 0)) return 0;
    let dec = 10 ** Math.floor(Math.log10(ohms));
    for (let k = 0; k < 3; k++, dec *= 10) {
      for (const b of E12) if (b * dec >= ohms * (1 - 1e-9)) return r2(b * dec, 2);
    }
    return r2(ohms, 2);
  }

  /** Rezystor do diody: zasilanie, napiecie diody, prad w mA, ile diod szeregowo. */
  function ledResistor({ supply, vf = 2.0, mA = 20, count = 1 }) {
    const drop = Number(supply) - Number(vf) * Number(count || 1);
    const amps = Number(mA) / 1000;
    if (!(drop > 0) || !(amps > 0)) return { error: 'Za niskie zasilanie dla tylu diod.' };
    const exact = drop / amps;
    const R = e12Up(exact);
    const realI = drop / R;
    const P = realI * realI * R;
    return { exact: r2(exact, 1), R, mA: r2(realI * 1000, 1), watts: r2(P, 3), power: P <= 0.125 ? '1/8 W' : P <= 0.25 ? '1/4 W' : P <= 0.5 ? '1/2 W' : '1 W lub wiecej' };
  }

  const COLORS = ['czarny', 'brazowy', 'czerwony', 'pomaranczowy', 'zolty', 'zielony', 'niebieski', 'fioletowy', 'szary', 'bialy'];
  const MULT = { czarny: 1, brazowy: 10, czerwony: 100, pomaranczowy: 1e3, zolty: 1e4, zielony: 1e5, niebieski: 1e6, fioletowy: 1e7, zloty: 0.1, srebrny: 0.01 };
  const TOL = { brazowy: '±1%', czerwony: '±2%', zloty: '±5%', srebrny: '±10%', zielony: '±0,5%' };
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim();

  /** Paski rezystora (4 paski) na wartosc. */
  function bandsToOhms(bands) {
    const b = (bands || []).map(fold);
    if (b.length < 3) return null;
    const d1 = COLORS.indexOf(b[0]);
    const d2 = COLORS.indexOf(b[1]);
    const m = MULT[b[2]];
    if (d1 < 0 || d2 < 0 || m == null) return null;
    return { ohms: r2((d1 * 10 + d2) * m, 2), tolerance: TOL[b[3]] || (b[3] ? '?' : '±20%') };
  }

  /** Wartosc na paski (dwie cyfry znaczace). */
  function ohmsToBands(ohms) {
    const v = Number(ohms);
    if (!(v >= 1)) return null;
    let exp = Math.floor(Math.log10(v)) - 1;
    let digits = Math.round(v / 10 ** exp);
    if (digits >= 100) {
      digits = Math.round(digits / 10);
      exp += 1;
    }
    const mult = Object.entries(MULT).find(([, m]) => m === 10 ** exp);
    if (!mult) return null;
    return [COLORS[Math.floor(digits / 10)], COLORS[digits % 10], mult[0], 'zloty'];
  }

  /** Dzielnik napiecia: wyjscie z U i dwoch rezystorow. */
  function divider({ U, R1, R2 }) {
    const u = Number(U);
    const a = Number(R1);
    const b = Number(R2);
    if (!(u > 0 && a > 0 && b > 0)) return null;
    return { out: r2((u * b) / (a + b), 3), current_mA: r2((u / (a + b)) * 1000, 3) };
  }

  // Gwinty metryczne zwykle: skok, wiertlo pod gwint (ok. srednica - skok), otwor przelotowy (sredni).
  const THREADS = { 2: 0.4, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2.0, 16: 2.0, 20: 2.5 };
  const CLEAR = { 2: 2.4, 2.5: 2.9, 3: 3.4, 4: 4.5, 5: 5.5, 6: 6.6, 8: 9, 10: 11, 12: 13.5, 14: 15.5, 16: 17.5, 20: 22 };
  function thread(m) {
    const d = Number(String(m).replace(/^m/i, '').replace(',', '.'));
    if (!THREADS[d]) return null;
    // Wkret w druk 3D: otwor nieco mniejszy niz srednica, zeby gwint sie wcial.
    return { name: `M${d}`, pitch: THREADS[d], tapDrill: r2(d - THREADS[d], 2), clearance: CLEAR[d], print3d: r2(d * 0.85, 1), insertHole: r2(d * 1.33, 1) };
  }

  // Druk 3D: gestosci i domyslne parametry.
  const MATERIALS = { PLA: { density: 1.24, price: 85 }, PETG: { density: 1.27, price: 95 }, ABS: { density: 1.04, price: 90 }, ASA: { density: 1.07, price: 110 }, TPU: { density: 1.21, price: 130 }, 'PA-CF': { density: 1.18, price: 260 } };

  /**
   * Szacunek wydruku z objetosci bryly (mm3) i jej pola powierzchni (mm2): sciany liczone pelnie,
   * wnetrze w procencie wypelnienia. Czas z przeplywu (mm3/s), koszt z ceny za kg.
   */
  function printEstimate({ volume, area = 0, material = 'PLA', infill = 20, walls = 1.2, flow = 8, pricePerKg, diameter = 1.75 }) {
    const vol = Number(volume);
    if (!(vol > 0)) return null;
    const mat = MATERIALS[material] || MATERIALS.PLA;
    const shell = Math.min(vol, Number(area) * Number(walls));
    const used = shell + (vol - shell) * (Math.max(0, Math.min(100, Number(infill))) / 100);
    const grams = (used / 1000) * mat.density;
    const length = used / (Math.PI * (diameter / 2) ** 2) / 1000; // metry
    const seconds = used / Math.max(1, Number(flow)) * 1.25; // +25% na ruchy jalowe i warstwy
    const price = Number(pricePerKg) > 0 ? Number(pricePerKg) : mat.price;
    return { grams: r2(grams, 1), meters: r2(length, 2), minutes: Math.round(seconds / 60), cost: r2((grams / 1000) * price, 2), material, infill: Number(infill) };
  }

  /** Najwieksza skala, w jakiej model miesci sie na stole (wymiary w mm). */
  function fitScale(size, bed = [220, 220, 250]) {
    const s = (size || []).map(Number);
    if (s.length < 3 || s.some((v) => !(v > 0))) return null;
    // Probujemy obrocic model najdluzszym bokiem wzdluz najdluzszego boku stolu.
    const a = [...s.slice(0, 2)].sort((x, y) => y - x);
    const b = [...bed.slice(0, 2)].sort((x, y) => y - x);
    const k = Math.min(b[0] / a[0], b[1] / a[1], bed[2] / s[2]);
    return { scale: r2(Math.min(1, k), 3), fits: k >= 1, maxScale: r2(k, 3) };
  }

  /**
   * Rozklad czesci na stole: polkami, od najwyzszych. Kazda czesc to { id, w, d } w mm (rzut z gory),
   * odstep miedzy czesciami w mm. Zwraca pozycje i czesci, ktore nie weszly.
   */
  function packBed(parts, bed = [220, 220], gap = 4) {
    const list = (parts || []).filter((p) => p.w > 0 && p.d > 0).map((p) => (p.w < p.d ? { ...p, w: p.d, d: p.w, rotated: true } : { ...p, rotated: false })).sort((a, b) => b.d - a.d || b.w - a.w);
    const placed = [];
    const left = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const p of list) {
      if (p.w > bed[0] || p.d > bed[1]) {
        left.push(p.id);
        continue;
      }
      if (x + p.w > bed[0]) {
        y += shelf + gap;
        x = 0;
        shelf = 0;
      }
      if (y + p.d > bed[1]) {
        left.push(p.id);
        continue;
      }
      placed.push({ id: p.id, x: r2(x, 1), y: r2(y, 1), w: p.w, d: p.d, rotated: p.rotated });
      x += p.w + gap;
      shelf = Math.max(shelf, p.d);
    }
    const used = placed.reduce((s, p) => s + p.w * p.d, 0);
    return { placed, left, fill: r2(used / (bed[0] * bed[1]), 3) };
  }

  return { bbEnergy, sameEnergyFps, LIMITS, limitsFor, gearRatio, rof, battery, ohm, e12Up, ledResistor, bandsToOhms, ohmsToBands, COLORS, divider, thread, THREADS, MATERIALS, printEstimate, fitScale, packBed };
});
