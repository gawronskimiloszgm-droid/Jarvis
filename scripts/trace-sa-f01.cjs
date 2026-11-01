// Tworzy public/extras/studiosaf01.js: kontury repliki SA-F01 FLEX odrysowane ze zdjecia produktu.
// Uzycie: node scripts/trace-sa-f01.cjs zdjecie.rgba 2000 1333
// (surowe RGBA, np. ffmpeg -i zdjecie.webp -f rawvideo -pix_fmt rgba zdjecie.rgba)
// Do repozytorium trafiaja tylko wspolrzedne, samo zdjecie aplikacja pobiera ze sklepu przy otwarciu.
const fs = require('fs');
const path = require('path');

const load = (f) => {
  const m = { exports: {} };
  new Function('module', fs.readFileSync(path.join(__dirname, '..', 'public', 'extras', f), 'utf8'))(m);
  return m.exports;
};
const PT = load('phototrace.js');

const [, , file, w, h] = process.argv;
const data = fs.readFileSync(file);
const img = { data, width: Number(w), height: Number(h) };

const POLY = { kolor: '#24272a', metal: 0.05, szorstkosc: 0.65 };
const ALU = { kolor: '#2a2d30', metal: 0.55, szorstkosc: 0.45 };
const STEEL = { kolor: '#1d1f22', metal: 0.8, szorstkosc: 0.4 };

// Obszary w pikselach zdjecia. Kolejnosc ma znaczenie: pierwszy zabiera piksele.
const parts = [
  { id: 'muszka', nazwa: 'Muszka składana', grupa: 'Przyrządy', krok: 19, obszar: [272, 296, 346, 406], gr: 14, faza: 1, ...ALU, rozst: [40, 170, 0] },
  { id: 'szczerbinka', nazwa: 'Szczerbinka składana', grupa: 'Przyrządy', krok: 19, obszar: [1128, 296, 1206, 424], gr: 16, faza: 1, ...ALU, rozst: [-40, 170, 0] },
  { id: 'tlumik', nazwa: 'Tłumik płomienia', grupa: 'Lufa', krok: 18, obszar: [140, 440, 236, 530], obrotowa: true, ...STEEL, rozst: [190, 0, 0] },
  { id: 'nakretka', nazwa: 'Tuleja lufy z gwintem M14', grupa: 'Lufa', krok: 17, obszar: [236, 440, 274, 530], obrotowa: true, ...STEEL, rozst: [140, 0, 0] },
  { id: 'szyna_g', nazwa: 'Szyna górna Picatinny frontu', grupa: 'Front', krok: 16, obszar: [346, 398, 800, 426], gr: 21, faza: 0.6, ...ALU, rozst: [40, 110, 0] },
  { id: 'szyna_d', nazwa: 'Szyna dolna Picatinny frontu', grupa: 'Front', krok: 16, obszar: [296, 532, 700, 562], gr: 21, faza: 0.6, ...ALU, rozst: [40, -110, 0] },
  { id: 'szyna_k', nazwa: 'Szyna górna korpusu', grupa: 'Korpus górny', krok: 13, obszar: [800, 398, 1128, 424], gr: 21, faza: 0.6, ...ALU, rozst: [0, 230, 0] },
  { id: 'front', nazwa: 'Front z otworami', grupa: 'Front', krok: 16, obszar: [274, 398, 802, 562], gr: 42, faza: 2, skorupa: 3, ...ALU, rozst: [110, 0, 0] },
  { id: 'rura', nazwa: 'Rura kolby z nakrętką', grupa: 'Kolba', krok: 14, obszar: [1306, 432, 1362, 532], obrotowa: true, ...ALU, rozst: [-120, 0, 0] },
  { id: 'kolba', nazwa: 'Kolba Crane', grupa: 'Kolba', krok: 15, obszar: [1362, 430, 1862, 780], gr: 50, faza: 3, ...POLY, rozst: [-240, 0, 0] },
  { id: 'spust', nazwa: 'Spust', grupa: 'Korpus dolny', krok: 6, obszar: [1078, 622, 1128, 692], gr: 7, faza: 0.6, ...STEEL, rozst: [0, -100, 60] },
  { id: 'magazynek', nazwa: 'Magazynek S-MAG', grupa: 'Magazynek', krok: 20, obszar: [[770, 668], [828, 668], [992, 692], [1020, 1040], [760, 1040]], gr: 25, faza: 2, ...POLY, rozst: [30, -240, 0] },
  { id: 'chwyt', nazwa: 'Chwyt pistoletowy', grupa: 'Chwyt i silnik', krok: 11, obszar: [[1162, 622], [1270, 622], [1400, 880], [1210, 900], [1148, 730], [1162, 700]], gr: 28, faza: 3, ...POLY, rozst: [-40, -200, 0] },
  { id: 'gorny', nazwa: 'Korpus górny', grupa: 'Korpus górny', krok: 13, obszar: [[798, 396], [1312, 396], [1312, 524], [798, 524]], gr: 35, faza: 1.2, skorupa: 3, ...ALU, rozst: [0, 170, 0] },
  { id: 'dolny', nazwa: 'Korpus dolny', grupa: 'Korpus dolny', krok: 12, obszar: [790, 524, 1312, 730], gr: 35, faza: 1.2, skorupa: 3, ...ALU, rozst: [0, -40, 170] },
];

// Zdjecie pokazuje replike z lufa w lewo; w Studiu wylot jest w strone +X.
const AXIS_Y = 485;
const out = PT.traceParts(img, { dlugosc: 650, parts, cy: AXIS_Y, flip: true, eps: 1, minHole: 150 });
const q = PT.photoQuality(img);
console.log('jakosc', JSON.stringify(q), 'mm/px', out.k.toFixed(4));
for (const p of out.parts) console.log(p.id, 'pkt', p.kontur.length, 'otw', p.otwory.length, p.profil ? `prof ${p.profil.length}` : '');

const payload = {
  zdjecie: {
    url: 'https://pictures.milgear.fi/0/1/original/72590.webp',
    strona: 'https://milgear.fi/en/product/specna-arms-sa-f01-flex-gen-2-x-asr/56637',
    tytul: 'Zdjęcie produktu ze sklepu Milgear (zdjęcie sklepu, tylko jako wzór)',
    k: out.k, cx: out.cx, cy: out.cy, flip: out.flip, w: out.w, h: out.h,
  },
  czesci: out.parts.map((p) => ({ ...p, pxArea: undefined })),
};
const dest = path.join(__dirname, '..', 'public', 'extras', 'studiosaf01.js');
fs.writeFileSync(dest, `// Kontury repliki SA-F01 FLEX odrysowane ze zdjecia produktu przez scripts/trace-sa-f01.cjs. Nie edytowac recznie.\n(function (root, factory) {\n  if (typeof module === 'object' && module.exports) module.exports = factory();\n  else root.StudioSAF01 = factory();\n})(typeof self !== 'undefined' ? self : this, function () {\n  return ${JSON.stringify(payload)};\n});\n`);
console.log('zapisano', (fs.statSync(dest).size / 1024).toFixed(1), 'KB');
