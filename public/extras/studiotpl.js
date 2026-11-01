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

  // Replika ASG: wzorzec szczegolowosci. Uklad jak w typowym AEG z gearboxem V2, wymiary dobrane do
  // dlugosci okolo 680 mm. To nie sa pomiary konkretnego modelu i projekt mowi o tym wprost.
  function asg() {
    const P = { kolor: '#22252a', metal: 0.05, szorstkosc: 0.72 };
    const S = { kolor: '#2b2f33', metal: 0.75, szorstkosc: 0.45 };
    const body = [[-112, 46], [125, 46], [125, -14], [116, -14], [116, -62], [58, -62], [56, -48], [-42, -54], [-60, -54], [-72, -30], [-112, -24]];
    const inner = [[-108, 42], [121, 42], [121, -10], [112, -10], [112, -58], [62, -58], [60, -44], [-40, -50], [-58, -50], [-68, -28], [-108, -20]];
    const half = (id, nazwa, sign, krok) => ({
      id, nazwa, grupa: 'Korpus', krok, ksztalt: 'zespol', ...P, rozst: [0, 0, sign * 230],
      elementy: [
        { ksztalt: 'boczny', kontur: body, gr: 3, z: sign * 18.5, zaokr: 4, faza: 0.8, otwory: [{ x: -60, y: 15, r: 3 }, { x: 80, y: 20, r: 3 }, { x: 25, y: 28, r: 7, dl: 60 }, { x: -60, y: 32, r: 5, dl: 40 }] },
        { ksztalt: 'boczny', kontur: body, gr: 14, z: sign * 10, zaokr: 4, otwory: [{ kontur: inner }] },
      ],
    });
    const bodyScrews = [[-95, 30], [-95, -12], [105, 34], [105, -5], [90, -52], [20, -44], [-40, 36]];
    const panel = (id, nazwa, extra, rozst) => ({ makro: 'panel_mlok', id, nazwa, grupa: 'Front M-LOK', krok: 15, dl: 200, szer: 30, gr: 3, x: 225, ...extra, rozst });
    return {
      nazwa: 'Replika ASG AEG (gearbox V2)',
      opis: 'Wzorzec rozkładu repliki elektrycznej: cały gearbox V2 z kołami, tłokiem, sprężyną i śrubami, komora hop-up, lufy, silnik w chwycie, polimerowy korpus, front M-LOK, kolba i magazynek.',
      skala: 1,
      material: 'PLA',
      uwagi: 'Układ i nazwy jak w typowym AEG V2. Wymiary to szacunek proporcji, a nie pomiar konkretnego modelu: do repliki SA-F01 podaj Jarvisowi nazwę, a dane przyjdą z jej źródeł.',
      fakty: ['Typowy gearbox V2, sprężyna M90, lufa 6,03 mm i gwint M14 lewy to częste parametry tego typu replik.'],
      czesci: [
        { makro: 'aeg_gearbox_v2', id: 'gb', grupa: 'Gearbox V2', krok_od: 1 },
        { makro: 'aeg_hopup', id: 'hop', grupa: 'Komora hop-up', krok: 9, x: 96 },
        { makro: 'aeg_lufa', id: 'lufa', grupa: 'Lufy', krok: 10, x: 112, dl_wew: 235, dl_zew: 226 },
        { makro: 'aeg_silnik', id: 'silnik', grupa: 'Silnik i chwyt', krok: 11, x: -40, y: -97, rz: -18, dl: 56 },
        { id: 'chwyt', nazwa: 'Chwyt pistoletowy', grupa: 'Silnik i chwyt', krok: 12, ksztalt: 'boczny', gr: 30, z: 0, zaokr: 7, faza: 1.5, ...P, kontur: [[-12, -50], [-60, -50], [-80, -112], [-78, -150], [-38, -154], [-26, -116], [-12, -70]], rozst: [-60, -200, 0] },
        { id: 'stopka_chwyt', nazwa: 'Stopka chwytu', grupa: 'Silnik i chwyt', krok: 13, ksztalt: 'plyta', sx: 42, sy: 4, sz: 30, faza: 0.6, x: -58, y: -155, rz: 7, ...P, rozst: [-60, -270, 0], otwory: [{ x: 0, z: 0, r: 2 }] },
        { makro: 'sruba', id: 'sr_st', nazwa: 'Śruba stopki M3 x 16', grupa: 'Silnik i chwyt', krok: 13, d: 3, l: 16, x: -58, y: -162, rx: 180, rz: 7, rozst: [-60, -320, 0] },
        half('korpus_l', 'Korpus polimerowy lewy', -1, 14),
        half('korpus_p', 'Korpus polimerowy prawy', 1, 14),
        { makro: 'kolek', id: 'kol1', nazwa: 'Kołek rozłączny przedni', grupa: 'Korpus', krok: 14, d: 5, l: 44, x: 80, y: 20, rx: 90, rozst: [0, 0, 300] },
        { makro: 'kolek', id: 'kol2', nazwa: 'Kołek rozłączny tylny', grupa: 'Korpus', krok: 14, d: 5, l: 44, x: -60, y: 15, rx: 90, rozst: [0, 0, 300] },
        ...bodyScrews.map(([x, y], i) => ({ makro: 'sruba', id: `sr_k${i + 1}`, nazwa: `Śruba korpusu M3 x 30 nr ${i + 1}`, grupa: 'Korpus', krok: 14, d: 3, l: 30, x, y, z: 20, rx: 90, rozst: [0, 0, 330] })),
        { id: 'oslona', nazwa: 'Osłona spustu', grupa: 'Korpus', krok: 14, ksztalt: 'boczny', gr: 12, zaokr: 3, faza: 0.6, ...P, kontur: [[60, -48], [56, -56], [50, -90], [12, -90], [4, -54], [4, -48]], otwory: [{ kontur: [[50, -52], [44, -84], [18, -84], [10, -52]] }], rozst: [10, -230, 0] },
        { id: 'selektor', nazwa: 'Dźwignia selektora', grupa: 'Elementy zewnętrzne', krok: 16, ksztalt: 'boczny', gr: 3, z: 21.5, zaokr: 1.5, faza: 0.4, ...S, kontur: [[-34, -18], [-14, -22], [-8, -18], [-14, -14], [-30, -10]], rozst: [0, 0, 380] },
        { id: 'zwalniacz', nazwa: 'Przycisk magazynka', grupa: 'Elementy zewnętrzne', krok: 16, ksztalt: 'walec', r: 5, h: 7, faza: 0.5, x: 54, y: -40, z: 22, rx: 90, ...S, rozst: [0, 0, 340] },
        { id: 'napinacz', nazwa: 'Napinacz', grupa: 'Elementy zewnętrzne', krok: 16, ksztalt: 'boczny', gr: 18, zaokr: 2, faza: 0.6, ...P, kontur: [[-118, 46], [-102, 46], [-96, 40], [-96, 34], [-118, 34]], rozst: [-120, 150, 0] },
        { makro: 'szyna_picatinny', id: 'sz_g', nazwa: 'Szyna górna korpusu', grupa: 'Szyny i przyrządy', krok: 17, dl: 215, x: 5, y: 48.5, rozst: [0, 170, 0] },
        { makro: 'szyna_picatinny', id: 'sz_f', nazwa: 'Szyna górna frontu', grupa: 'Szyny i przyrządy', krok: 17, dl: 200, x: 228, y: 26, rozst: [0, 170, 0] },
        { id: 'nakretka_lufy', nazwa: 'Nakrętka lufy', grupa: 'Front M-LOK', krok: 15, ksztalt: 'rura', r: 15, ri: 10, h: 18, faza: 0.6, x: 126, rz: 90, ...S, rozst: [80, -130, 0] },
        { id: 'tuleja_tyl', nazwa: 'Pierścień tylny frontu', grupa: 'Front M-LOK', krok: 15, ksztalt: 'rura', r: 23, ri: 16, h: 8, x: 130, rz: 90, ...S, rozst: [60, -160, 0] },
        { id: 'tuleja_przod', nazwa: 'Pierścień przedni frontu', grupa: 'Front M-LOK', krok: 15, ksztalt: 'rura', r: 23, ri: 11, h: 8, x: 322, rz: 90, ...S, rozst: [150, -160, 0] },
        panel('pan_l', 'Panel M-LOK lewy', { z: -20.5, rx: 90 }, [0, 0, -200]),
        panel('pan_p', 'Panel M-LOK prawy', { z: 20.5, rx: 90 }, [0, 0, 200]),
        panel('pan_d', 'Panel M-LOK dolny', { y: -20.5 }, [0, -180, 0]),
        { id: 'muszka', nazwa: 'Muszka składana', grupa: 'Szyny i przyrządy', krok: 17, ksztalt: 'boczny', gr: 10, zaokr: 1.5, faza: 0.5, ...S, x: 310, y: 30, kontur: [[-12, 0], [12, 0], [12, 6], [4, 8], [2, 34], [-2, 34], [-4, 8], [-12, 6]], rozst: [50, 240, 0] },
        { id: 'celownik', nazwa: 'Szczerbinka składana', grupa: 'Szyny i przyrządy', krok: 17, ksztalt: 'boczny', gr: 16, zaokr: 1.5, faza: 0.5, ...S, x: -60, y: 52, kontur: [[-16, 0], [16, 0], [16, 6], [6, 8], [4, 30], [-4, 30], [-6, 8], [-16, 6]], otwory: [{ x: 0, y: 22, r: 2.2 }], rozst: [-50, 240, 0] },
        { id: 'rura_kolby', nazwa: 'Rura kolby', grupa: 'Kolba', krok: 18, ksztalt: 'rura', r: 15, ri: 12.5, h: 165, faza: 0.6, x: -190, y: 8, rz: 90, kolor: '#30343a', metal: 0.7, szorstkosc: 0.45, rozst: [-120, 0, 0] },
        { id: 'nakretka_kolby', nazwa: 'Nakrętka kolby', grupa: 'Kolba', krok: 18, ksztalt: 'kolo_zebate', zeby: 8, m: 5, h: 8, otwor: 15.2, x: -117, y: 8, rz: 90, ...S, rozst: [-80, 110, 0] },
        { id: 'akumulator', nazwa: 'Akumulator LiPo 7,4 V', grupa: 'Kolba', krok: 19, ksztalt: 'walec', r: 10.5, h: 110, x: -190, y: 8, rz: 90, kolor: '#b84234', metal: 0.1, szorstkosc: 0.5, rozst: [-180, 130, 0] },
        { id: 'kolba', nazwa: 'Kolba składana', grupa: 'Kolba', krok: 20, ksztalt: 'boczny', gr: 34, zaokr: 6, faza: 1.5, ...P, kontur: [[-225, 34], [-340, 42], [-345, -60], [-325, -66], [-310, -14], [-225, -14]], otwory: [{ x: -300, y: 14, r: 12, dl: 60 }], rozst: [-320, 0, 0] },
        { id: 'stopka_kolby', nazwa: 'Stopka kolby', grupa: 'Kolba', krok: 21, ksztalt: 'boczny', gr: 34, zaokr: 3, faza: 0.8, kolor: '#14161a', metal: 0, szorstkosc: 0.9, kontur: [[-340, 42], [-350, 42], [-355, -62], [-345, -60]], rozst: [-400, 0, 0] },
        { makro: 'aeg_magazynek', id: 'mag', grupa: 'Magazynek', krok: 22, x: 86, y: -16, rz: 11, wys: 118, rozst: [40, -220, 0] },
      ],
      kroki: [
        { nr: 1, tytul: 'Skorupa lewa', opis: 'Baza gearboxa: tu wchodzi cała mechanika.' },
        { nr: 2, tytul: 'Tuleje', opis: 'Tuleje osi trzech kół w obu skorupach.' },
        { nr: 3, tytul: 'Koła zębate', opis: 'Stożkowe odbiera napęd z silnika, pośrednie je przenosi, sektorowe ciągnie tłok.' },
        { nr: 4, tytul: 'Cylinder i tłok', opis: 'Tłok z listwą zębatą, sprężyna główna i prowadnica sprężyny.' },
        { nr: 5, tytul: 'Dysza i popychacz', opis: 'Dysza podaje kulkę do komory, popychacz ją cofa.' },
        { nr: 6, tytul: 'Spust i elektronika', opis: 'Spust, przełącznik, MOSFET i płytka selektora.' },
        { nr: 7, tytul: 'Skorupa prawa', opis: 'Zamyka gearbox.' },
        { nr: 8, tytul: 'Śruby gearboxa', opis: 'Siedem śrub M3 spina obie skorupy.' },
        { nr: 9, tytul: 'Komora hop-up', opis: 'Gumka, docisk i pokrętło obrotowe regulują podkręcenie kulki.' },
        { nr: 10, tytul: 'Lufy', opis: 'Lufa precyzyjna 6,03 i lufa zewnętrzna z gwintem M14 i tłumikiem płomienia.' },
        { nr: 11, tytul: 'Silnik', opis: 'Silnik w chwycie, zębnik zazębia się z kołem stożkowym.' },
        { nr: 12, tytul: 'Chwyt', opis: 'Chwyt pistoletowy zamyka silnik.' },
        { nr: 13, tytul: 'Stopka chwytu', opis: 'Stopka ze śrubą trzyma silnik na miejscu.' },
        { nr: 14, tytul: 'Korpus', opis: 'Dwie połówki polimerowe z osłoną spustu, kołkami i śrubami.' },
        { nr: 15, tytul: 'Front M-LOK', opis: 'Nakrętka lufy, pierścienie i trzy panele M-LOK.' },
        { nr: 16, tytul: 'Elementy zewnętrzne', opis: 'Selektor, przycisk magazynka i napinacz.' },
        { nr: 17, tytul: 'Szyny i przyrządy', opis: 'Szyny Picatinny, muszka i szczerbinka.' },
        { nr: 18, tytul: 'Rura kolby', opis: 'Rura z nakrętką przykręcona do korpusu.' },
        { nr: 19, tytul: 'Akumulator', opis: 'Akumulator w rurze kolby.' },
        { nr: 20, tytul: 'Kolba', opis: 'Kolba nasunięta na rurę.' },
        { nr: 21, tytul: 'Stopka kolby', opis: 'Gumowa stopka na końcu.' },
        { nr: 22, tytul: 'Magazynek', opis: 'Wpięty magazynek ze sprężyną, popychaczem i kulkami.' },
      ],
    };
  }

  const LIST = [
    { id: 'asg', nazwa: 'Replika ASG', sub: 'gearbox V2 i cały rozkład, co do śruby', make: asg },
    { id: 'saturn', nazwa: 'Saturn V', sub: 'replika ze znanych wymiarów', make: saturn },
    { id: 'silnik', nazwa: 'Silnik', sub: 'budowa jednego cylindra', make: engine },
    { id: 'dron', nazwa: 'Dron 250', sub: 'rama i elektronika', make: drone },
  ];
  return { LIST };
});
