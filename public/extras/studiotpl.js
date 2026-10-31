// Gotowe projekty Studia 3D: dzialaja bez AI i bez sieci. Saturn V opiera sie na znanych wymiarach
// rakiety (110,6 m wysokosci, 10,1 m srednicy), reszta to modele pogladowe opisane jako szacunek.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StudioTemplates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CY = '#37c8ff';
  const STEEL = { kolor: '#9fb0bd', metal: 0.85, szorstkosc: 0.35 };
  const DARK = { kolor: '#2a3138', metal: 0.5, szorstkosc: 0.6 };
  const WHITE = { kolor: '#e8ecef', metal: 0.05, szorstkosc: 0.5 };

  function saturn() {
    const p = { zrodlo: 'plany' };
    // Wysokosci w mm w skali rzeczywistej, y to srodek czesci.
    const stack = [
      { id: 'sic', nazwa: 'Człon S-IC', grupa: 'Człon pierwszy S-IC', krok: 1, ksztalt: 'walec', r: 5050, h: 42000, y: 24000, ...WHITE, ...p, opis: 'Pięć silników F-1, nafta i ciekły tlen.' },
      { id: 'sic_pas', nazwa: 'Czarny pas S-IC', grupa: 'Człon pierwszy S-IC', krok: 1, ksztalt: 'rura', r: 5070, ri: 5040, h: 9000, y: 8000, ...DARK, ...p },
      { id: 'owiew', nazwa: 'Owiewka silnika', grupa: 'Silniki F-1', krok: 2, ksztalt: 'walec', r: 1000, r2: 500, h: 5000, x: 3500, y: 3500, z: 0, ...DARK, zrodlo: 'szacunek', powiel: { n: 4, kolowy: true } },
      { id: 'f1_srodek', nazwa: 'Silnik F-1 środkowy', grupa: 'Silniki F-1', krok: 2, ksztalt: 'walec', r: 1850, r2: 600, h: 5800, y: 2900, ...STEEL, ...p },
      { id: 'f1', nazwa: 'Silnik F-1', grupa: 'Silniki F-1', krok: 2, ksztalt: 'walec', r: 1850, r2: 600, h: 5800, x: 3200, y: 2900, z: 3200, ...STEEL, ...p, powiel: { n: 4, kolowy: true } },
      { id: 'statecz', nazwa: 'Statecznik', grupa: 'Człon pierwszy S-IC', krok: 3, ksztalt: 'klin', sx: 300, sy: 5800, sz: 3400, x: 0, y: 5900, z: 6500, ry: 0, ...DARK, zrodlo: 'szacunek', powiel: { n: 4, kolowy: true } },
      { id: 'mpier', nazwa: 'Międzyczłon S-IC/S-II', grupa: 'Człon drugi S-II', krok: 4, ksztalt: 'rura', r: 5050, ri: 4900, h: 5500, y: 47750, ...WHITE, ...p },
      { id: 'j2', nazwa: 'Silnik J-2', grupa: 'Człon drugi S-II', krok: 4, ksztalt: 'walec', r: 1000, r2: 350, h: 3400, x: 2400, y: 47000, ...STEEL, ...p, powiel: { n: 4, kolowy: true } },
      { id: 'j2s', nazwa: 'Silnik J-2 środkowy', grupa: 'Człon drugi S-II', krok: 4, ksztalt: 'walec', r: 1000, r2: 350, h: 3400, y: 47000, ...STEEL, ...p },
      { id: 'sii', nazwa: 'Człon S-II', grupa: 'Człon drugi S-II', krok: 5, ksztalt: 'walec', r: 5050, h: 19000, y: 60000, ...WHITE, ...p, opis: 'Pięć silników J-2, wodór i ciekły tlen.' },
      { id: 'adapter', nazwa: 'Adapter S-II/S-IVB', grupa: 'Człon trzeci S-IVB', krok: 6, ksztalt: 'walec', r: 5050, r2: 3300, h: 5600, y: 72300, ...DARK, ...p },
      { id: 'j2b', nazwa: 'Silnik J-2 S-IVB', grupa: 'Człon trzeci S-IVB', krok: 6, ksztalt: 'walec', r: 1000, r2: 350, h: 3400, y: 73500, ...STEEL, ...p },
      { id: 'sivb', nazwa: 'Człon S-IVB', grupa: 'Człon trzeci S-IVB', krok: 7, ksztalt: 'walec', r: 3300, h: 12800, y: 81500, ...WHITE, ...p, opis: 'Jeden silnik J-2 z możliwością ponownego zapłonu.' },
      { id: 'iu', nazwa: 'Segment przyrządów', grupa: 'Człon trzeci S-IVB', krok: 8, ksztalt: 'walec', r: 3300, h: 900, y: 88350, ...DARK, ...p },
      { id: 'sla', nazwa: 'Osłona lądownika', grupa: 'Statek Apollo', krok: 9, ksztalt: 'walec', r: 3300, r2: 1950, h: 8500, y: 93050, ...WHITE, ...p },
      { id: 'lm', nazwa: 'Lądownik księżycowy', grupa: 'Statek Apollo', krok: 9, ksztalt: 'pryzmat', n: 8, r: 2000, h: 4500, y: 92000, kolor: '#c9a15a', metal: 0.7, szorstkosc: 0.4, ...p },
      { id: 'sm', nazwa: 'Moduł serwisowy', grupa: 'Statek Apollo', krok: 10, ksztalt: 'walec', r: 1950, h: 7500, y: 101050, kolor: '#cfd5da', metal: 0.6, szorstkosc: 0.4, ...p },
      { id: 'cm', nazwa: 'Kapsuła załogowa', grupa: 'Statek Apollo', krok: 11, ksztalt: 'walec', r: 1950, r2: 300, h: 3200, y: 106400, kolor: '#b9c2c8', metal: 0.8, szorstkosc: 0.3, ...p },
      { id: 'les', nazwa: 'Wieża ratunkowa', grupa: 'Statek Apollo', krok: 12, ksztalt: 'walec', r: 330, r2: 80, h: 2600, y: 109300, kolor: '#e24b3b', metal: 0.2, szorstkosc: 0.5, zrodlo: 'szacunek' },
    ];
    return {
      nazwa: 'Saturn V (makieta)',
      opis: 'Rakieta programu Apollo, 110,6 m wysokości i 10,1 m średnicy. Układ członów zgodny z oficjalnymi wymiarami, drobne szczegóły uproszczone.',
      skala: 200,
      realny: true,
      uwagi: 'Główne wymiary członów są znane. Owiewki, stateczniki i wieża to przybliżenia do makiety, a nie plany konstrukcyjne.',
      czesci: stack,
      kroki: [
        { nr: 1, tytul: 'Człon pierwszy', opis: 'Korpus S-IC, zbiorniki nafty i tlenu.' },
        { nr: 2, tytul: 'Silniki F-1', opis: 'Pięć silników: jeden stały w środku i cztery sterowane.' },
        { nr: 3, tytul: 'Stateczniki', opis: 'Cztery stateczniki na dole rakiety.' },
        { nr: 4, tytul: 'Międzyczłon', opis: 'Łącznik z pięcioma silnikami J-2.' },
        { nr: 5, tytul: 'Człon drugi', opis: 'Korpus S-II.' },
        { nr: 6, tytul: 'Adapter', opis: 'Zwężenie do średnicy trzeciego członu, z silnikiem J-2.' },
        { nr: 7, tytul: 'Człon trzeci', opis: 'Korpus S-IVB.' },
        { nr: 8, tytul: 'Segment przyrządów', opis: 'Komputer pokładowy i prowadzenie rakiety.' },
        { nr: 9, tytul: 'Osłona i lądownik', opis: 'Lądownik księżycowy ukryty w stożkowej osłonie.' },
        { nr: 10, tytul: 'Moduł serwisowy', opis: 'Główny silnik statku i zapasy.' },
        { nr: 11, tytul: 'Kapsuła', opis: 'Moduł załogowy.' },
        { nr: 12, tytul: 'Wieża ratunkowa', opis: 'Odciąga kapsułę od rakiety w razie awarii startowej.' },
      ],
      fakty: ['Wysokość 110,6 m', 'Średnica 10,1 m', 'Trzy człony: S-IC, S-II, S-IVB'],
      zrodla: [{ tytul: 'Saturn V: Wikipedia', url: 'https://en.wikipedia.org/wiki/Saturn_V' }],
    };
  }

  function engine() {
    const S = { ...STEEL };
    return {
      nazwa: 'Silnik jednocylindrowy',
      opis: 'Poglądowy czterosuw: blok, wał, tłok, głowica i zawory. Do nauki budowy, nie do wykonania.',
      skala: 1,
      czesci: [
        { id: 'miska', nazwa: 'Miska olejowa', grupa: 'Dół silnika', krok: 1, ksztalt: 'pudelko', sx: 150, sy: 40, sz: 120, y: 20, ...DARK },
        { id: 'skrzynia', nazwa: 'Skrzynia korbowa', grupa: 'Dół silnika', krok: 1, ksztalt: 'pudelko', sx: 150, sy: 90, sz: 120, y: 85, kolor: '#59636b', metal: 0.6, szorstkosc: 0.5 },
        { id: 'wal', nazwa: 'Wał korbowy', grupa: 'Układ korbowy', krok: 2, ksztalt: 'walec', r: 14, h: 220, y: 85, rx: 0, rz: 90, ...S, rozst: [0, 0, 230] },
        { id: 'wyk', nazwa: 'Wykorbienie', grupa: 'Układ korbowy', krok: 2, ksztalt: 'pudelko', sx: 16, sy: 64, sz: 40, x: 24, y: 96, ...S, lustro: 'x', rozst: [0, 30, 230] },
        { id: 'czop', nazwa: 'Czop korbowy', grupa: 'Układ korbowy', krok: 2, ksztalt: 'walec', r: 12, h: 48, y: 110, rz: 90, ...S, rozst: [0, 60, 230] },
        { id: 'kolo', nazwa: 'Koło zamachowe', grupa: 'Układ korbowy', krok: 3, ksztalt: 'walec', r: 62, h: 22, x: -118, y: 85, rz: 90, kolor: '#6d7780', metal: 0.8, szorstkosc: 0.35, rozst: [-160, 0, 0] },
        { id: 'zebatka', nazwa: 'Koło rozrządu', grupa: 'Rozrząd', krok: 3, ksztalt: 'kolo_zebate', zeby: 20, m: 3, h: 10, otwor: 14, x: 90, y: 85, rz: 90, kolor: '#c98a3a', metal: 0.8, szorstkosc: 0.35, rozst: [150, 0, 0] },
        { id: 'blok', nazwa: 'Cylinder', grupa: 'Blok', krok: 4, ksztalt: 'rura', r: 60, ri: 40, h: 140, y: 200, kolor: '#71808b', metal: 0.6, szorstkosc: 0.5 },
        { id: 'zebro', nazwa: 'Żebro chłodzące', grupa: 'Blok', krok: 4, ksztalt: 'rura', r: 74, ri: 60, h: 5, y: 145, kolor: '#71808b', metal: 0.6, szorstkosc: 0.5, powiel: { n: 8, dy: 15 } },
        { id: 'korbowod', nazwa: 'Korbowód', grupa: 'Tłok', krok: 5, ksztalt: 'pudelko', sx: 16, sy: 110, sz: 18, y: 165, ...S, rozst: [0, 40, 200] },
        { id: 'tlok', nazwa: 'Tłok', grupa: 'Tłok', krok: 5, ksztalt: 'walec', r: 39, h: 50, y: 225, kolor: '#c6ccd1', metal: 0.85, szorstkosc: 0.3, rozst: [0, 80, 200] },
        { id: 'pierscien', nazwa: 'Pierścień tłokowy', grupa: 'Tłok', krok: 5, ksztalt: 'torus', R: 39, r: 1.6, y: 240, ...DARK, powiel: { n: 2, dy: -9 }, rozst: [0, 120, 200] },
        { id: 'uszczelka', nazwa: 'Uszczelka głowicy', grupa: 'Głowica', krok: 6, ksztalt: 'rura', r: 62, ri: 40, h: 2, y: 271, kolor: '#b56b3a', metal: 0.4, szorstkosc: 0.7 },
        { id: 'glowica', nazwa: 'Głowica', grupa: 'Głowica', krok: 7, ksztalt: 'pudelko', sx: 135, sy: 46, sz: 120, y: 295, kolor: '#7a8894', metal: 0.6, szorstkosc: 0.5 },
        { id: 'zawor', nazwa: 'Zawór', grupa: 'Rozrząd', krok: 8, ksztalt: 'obrotowa', profil: [[0, -48], [17, -48], [17, -45], [4, -36], [3, 44], [0, 44]], x: 18, y: 318, ...S, lustro: 'x', rozst: [0, 170, 0] },
        { id: 'spr', nazwa: 'Sprężyna zaworu', grupa: 'Rozrząd', krok: 8, ksztalt: 'sprezyna', R: 9, r: 1.6, skok: 7, zwoje: 5, x: 18, y: 338, ...S, lustro: 'x', rozst: [0, 210, 0] },
        { id: 'pokrywa', nazwa: 'Pokrywa zaworów', grupa: 'Głowica', krok: 9, ksztalt: 'pudelko', sx: 135, sy: 34, sz: 120, y: 370, ...DARK, rozst: [0, 260, 0] },
        { id: 'swieca', nazwa: 'Świeca zapłonowa', grupa: 'Głowica', krok: 9, ksztalt: 'walec', r: 7, h: 70, y: 400, z: 40, ...WHITE, rozst: [0, 320, 90] },
        { id: 'wydech', nazwa: 'Kolektor wydechowy', grupa: 'Głowica', krok: 10, ksztalt: 'rurka', r: 11, sciezka: [[0, 295, -60], [0, 295, -110], [0, 260, -150], [0, 170, -170]], kolor: '#6e4a36', metal: 0.7, szorstkosc: 0.6, rozst: [0, 40, -180] },
      ],
      kroki: [
        { nr: 1, tytul: 'Dół silnika', opis: 'Miska olejowa i skrzynia korbowa.' },
        { nr: 2, tytul: 'Wał korbowy', opis: 'Wał z wykorbieniami i czopem.' },
        { nr: 3, tytul: 'Koła', opis: 'Koło zamachowe i koło rozrządu na końcach wału.' },
        { nr: 4, tytul: 'Cylinder', opis: 'Blok z żebrami chłodzącymi.' },
        { nr: 5, tytul: 'Tłok', opis: 'Korbowód, tłok i pierścienie.' },
        { nr: 6, tytul: 'Uszczelka', opis: 'Uszczelka głowicy.' },
        { nr: 7, tytul: 'Głowica', opis: 'Głowica cylindra.' },
        { nr: 8, tytul: 'Zawory', opis: 'Zawory ze sprężynami.' },
        { nr: 9, tytul: 'Pokrywa i świeca', opis: 'Pokrywa zaworów i świeca zapłonowa.' },
        { nr: 10, tytul: 'Wydech', opis: 'Kolektor wydechowy.' },
      ],
      uwagi: 'Model poglądowy: proporcje szacunkowe, bez dokumentacji konkretnego silnika.',
    };
  }

  function drone() {
    const arm = (Math.SQRT1_2 * 170).toFixed(1) * 1;
    return {
      nazwa: 'Dron quadcopter 250',
      opis: 'Rama klasy 250 mm z silnikami, śmigłami, elektroniką i akumulatorem. Rama do druku 3D, reszta poglądowo.',
      skala: 1,
      czesci: [
        { id: 'dol', nazwa: 'Płyta dolna', grupa: 'Rama', krok: 1, ksztalt: 'plyta', sx: 110, sy: 3, sz: 70, y: 0, otwory: [{ x: -35, z: -20, r: 2 }, { x: 35, z: -20, r: 2 }, { x: -35, z: 20, r: 2 }, { x: 35, z: 20, r: 2 }], ...DARK },
        { id: 'ramie', nazwa: 'Ramię', grupa: 'Rama', krok: 2, ksztalt: 'pudelko', sx: 190, sy: 5, sz: 20, x: 62, y: 4, z: 62, ry: -45, ...DARK, lustro: 'x' },
        { id: 'ramie2', nazwa: 'Ramię tylne', grupa: 'Rama', krok: 2, ksztalt: 'pudelko', sx: 190, sy: 5, sz: 20, x: 62, y: 4, z: -62, ry: 45, ...DARK, lustro: 'x' },
        { id: 'dyst', nazwa: 'Dystans', grupa: 'Rama', krok: 3, ksztalt: 'walec', r: 3, h: 36, x: -35, y: 25, z: -20, ...STEEL, powiel: { n: 2, dx: 70 } },
        { id: 'dyst2', nazwa: 'Dystans tylny', grupa: 'Rama', krok: 3, ksztalt: 'walec', r: 3, h: 36, x: -35, y: 25, z: 20, ...STEEL, powiel: { n: 2, dx: 70 } },
        { id: 'fc', nazwa: 'Kontroler lotu', grupa: 'Elektronika', krok: 4, ksztalt: 'pudelko', sx: 36, sy: 5, sz: 36, y: 17, kolor: '#1d6b4a', metal: 0.2, szorstkosc: 0.6, rozst: [0, 90, 0] },
        { id: 'esc', nazwa: 'Regulator ESC', grupa: 'Elektronika', krok: 4, ksztalt: 'pudelko', sx: 36, sy: 6, sz: 36, y: 10, kolor: '#27405f', metal: 0.2, szorstkosc: 0.6, rozst: [0, 50, 0] },
        { id: 'gora', nazwa: 'Płyta górna', grupa: 'Rama', krok: 5, ksztalt: 'plyta', sx: 110, sy: 3, sz: 70, y: 44, otwory: [{ x: 0, z: 0, r: 8 }], ...DARK, rozst: [0, 170, 0] },
        { id: 'akumulator', nazwa: 'Akumulator LiPo', grupa: 'Elektronika', krok: 6, ksztalt: 'pudelko', sx: 85, sy: 26, sz: 34, y: 60, kolor: '#c84b3a', metal: 0.1, szorstkosc: 0.5, rozst: [0, 240, 0] },
        { id: 'kamera', nazwa: 'Kamera FPV', grupa: 'Elektronika', krok: 6, ksztalt: 'walec', r: 9, h: 22, y: 14, z: -38, rx: 75, ...DARK, rozst: [0, 40, -120] },
        { id: 'silnik', nazwa: 'Silnik bezszczotkowy', grupa: 'Napęd', krok: 7, ksztalt: 'walec', r: 14, h: 20, x: arm + 8, y: 17, z: arm + 8, ...STEEL, lustro: 'x', rozst: [0, 90, 0] },
        { id: 'silnik2', nazwa: 'Silnik bezszczotkowy tylny', grupa: 'Napęd', krok: 7, ksztalt: 'walec', r: 14, h: 20, x: arm + 8, y: 17, z: -arm - 8, ...STEEL, lustro: 'x', rozst: [0, 90, 0] },
        { id: 'sm1', nazwa: 'Śmigło', grupa: 'Napęd', krok: 8, ksztalt: 'loft', przekroje: [{ p: -63, typ: 'elipsa', a: 6, b: 1 }, { p: -30, typ: 'elipsa', a: 11, b: 1.6 }, { p: 0, typ: 'elipsa', a: 6, b: 4 }, { p: 30, typ: 'elipsa', a: 11, b: 1.6 }, { p: 63, typ: 'elipsa', a: 6, b: 1 }], gladki: true, x: arm + 8, y: 31, z: arm + 8, rx: 90, ry: 25, kolor: CY, metal: 0.1, szorstkosc: 0.4, lustro: 'x', rozst: [0, 150, 0] },
        { id: 'sm2', nazwa: 'Śmigło tylne', grupa: 'Napęd', krok: 8, ksztalt: 'loft', przekroje: [{ p: -63, typ: 'elipsa', a: 6, b: 1 }, { p: -30, typ: 'elipsa', a: 11, b: 1.6 }, { p: 0, typ: 'elipsa', a: 6, b: 4 }, { p: 30, typ: 'elipsa', a: 11, b: 1.6 }, { p: 63, typ: 'elipsa', a: 6, b: 1 }], gladki: true, x: arm + 8, y: 31, z: -arm - 8, rx: 90, ry: -25, kolor: '#ff9d3c', metal: 0.1, szorstkosc: 0.4, lustro: 'x', rozst: [0, 150, 0] },
      ],
      kroki: [
        { nr: 1, tytul: 'Płyta dolna', opis: 'Podstawa ramy.' },
        { nr: 2, tytul: 'Ramiona', opis: 'Cztery ramiona pod kątem 45 stopni.' },
        { nr: 3, tytul: 'Dystanse', opis: 'Słupki między płytami.' },
        { nr: 4, tytul: 'Elektronika', opis: 'Regulator ESC, nad nim kontroler lotu.' },
        { nr: 5, tytul: 'Płyta górna', opis: 'Zamyka ramę.' },
        { nr: 6, tytul: 'Akumulator i kamera', opis: 'Akumulator na górze, kamera z przodu.' },
        { nr: 7, tytul: 'Silniki', opis: 'Po jednym na końcu ramienia.' },
        { nr: 8, tytul: 'Śmigła', opis: 'Kierunki obrotów naprzemiennie, kolory pokazują przód i tył.' },
      ],
      uwagi: 'Model poglądowy: wymiary typowe dla ramy klasy 250, bez konkretnego produktu.',
    };
  }

  const LIST = [
    { id: 'saturn', nazwa: 'Saturn V', sub: 'replika ze znanych wymiarów', make: saturn },
    { id: 'silnik', nazwa: 'Silnik', sub: 'budowa jednego cylindra', make: engine },
    { id: 'dron', nazwa: 'Dron 250', sub: 'rama i elektronika', make: drone },
  ];
  return { LIST };
});
