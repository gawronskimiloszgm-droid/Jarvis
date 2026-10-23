// Geometria parametryczna - budowa brylek z trojkatow.
//
// Wszystko liczymy sami, bez bibliotek CAD: model to po prostu lista
// trojkatow [{a,b,c}], gdzie kazdy wierzcholek to [x,y,z] w milimetrach.
// Taka reprezentacja wystarcza i do zapisu STL, i do rysowania podgladu,
// i do pokolorowania mapy naprezen - nie potrzeba niczego wiecej.
//
// Uklad: X w prawo, Y w gore, Z w glab. Jednostka: milimetr.

const V = (x, y, z) => [x, y, z];

function quad(a, b, c, d) {
  return [
    { a, b, c },
    { a, b: c, c: d },
  ];
}

// Prostopadloscian o poczatku w (x,y,z) i rozmiarach (w,h,d).
export function box(x, y, z, w, h, d) {
  const p = [
    V(x, y, z), V(x + w, y, z), V(x + w, y + h, z), V(x, y + h, z),
    V(x, y, z + d), V(x + w, y, z + d), V(x + w, y + h, z + d), V(x, y + h, z + d),
  ];
  return [
    ...quad(p[0], p[3], p[2], p[1]), // tyl
    ...quad(p[4], p[5], p[6], p[7]), // przod
    ...quad(p[0], p[1], p[5], p[4]), // dol
    ...quad(p[3], p[7], p[6], p[2]), // gora
    ...quad(p[0], p[4], p[7], p[3]), // lewo
    ...quad(p[1], p[2], p[6], p[5]), // prawo
  ];
}

// Walec wzdluz osi Z - uzywany jako czop/kolek.
export function cylinderZ(cx, cy, z0, r, depth, seg = 32) {
  const tris = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = V(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z0);
    const p1 = V(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z0);
    const q0 = V(p0[0], p0[1], z0 + depth);
    const q1 = V(p1[0], p1[1], z0 + depth);
    tris.push(...quad(p0, p1, q1, q0));
    tris.push({ a: V(cx, cy, z0), b: p1, c: p0 });
    tris.push({ a: V(cx, cy, z0 + depth), b: q0, c: q1 });
  }
  return tris;
}

// Rura wzdluz osi Z (walec z drazonym srodkiem) - tuleja, dystans, nozka
// rurowa. Sciana zewnetrzna i wewnetrzna licza sie tak samo jak w
// cylinderZ, tylko wewnetrzna ma odwrocona kolejnosc wierzcholkow (normalna
// musi patrzec DO srodka otworu, nie na zewnatrz), a gorny/dolny pierscien
// spina obie sciany zamiast zamykac je pelnym wieczkiem.
export function tubeZ(cx, cy, z0, rOuter, rInner, depth, seg = 32) {
  const tris = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);

    const oB0 = V(cx + c0 * rOuter, cy + s0 * rOuter, z0);
    const oB1 = V(cx + c1 * rOuter, cy + s1 * rOuter, z0);
    const oT0 = V(oB0[0], oB0[1], z0 + depth);
    const oT1 = V(oB1[0], oB1[1], z0 + depth);

    const iB0 = V(cx + c0 * rInner, cy + s0 * rInner, z0);
    const iB1 = V(cx + c1 * rInner, cy + s1 * rInner, z0);
    const iT0 = V(iB0[0], iB0[1], z0 + depth);
    const iT1 = V(iB1[0], iB1[1], z0 + depth);

    tris.push(...quad(oB0, oB1, oT1, oT0)); // sciana zewnetrzna
    tris.push(...quad(iB1, iB0, iT0, iT1)); // sciana wewnetrzna (otworu)
    tris.push(...quad(oT0, oT1, iT1, iT0)); // gorny pierscien
    tris.push(...quad(oB1, oB0, iB0, iB1)); // dolny pierscien
  }
  return tris;
}

function rotateAxis([x, y, z], axis, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  if (axis === 'x') return V(x, y * c - z * s, y * s + z * c);
  if (axis === 'y') return V(x * c + z * s, y, -x * s + z * c);
  return V(x * c - y * s, x * s + y * c, z);
}

// Ustawia bryle w zlozeniu: obrot wokol JEDNEJ osi lokalnego ukladu (wokol
// poczatku bryly), potem przesuniecie. To nie jest pelna macierz Eulera,
// ale do prostych zlozen (przechylona podpora, czesc obok czesci) starcza,
// a przy okazji nie ma ryzyka gimbal locka ani bledow kolejnosci osi.
export function placeTris(tris, { x = 0, y = 0, z = 0, rotAxis = null, rotDeg = 0 } = {}) {
  const rad = (rotDeg * Math.PI) / 180;
  return tris.map((t) => {
    const out = {};
    for (const k of ['a', 'b', 'c']) {
      let p = t[k];
      if (rotAxis && rotDeg) p = rotateAxis(p, rotAxis, rad);
      out[k] = V(p[0] + x, p[1] + y, p[2] + z);
    }
    return out;
  });
}

// Plyta z okraglym otworem. Otworu NIE wycinamy operacja boolowska (to
// wymagaloby pelnego CSG) - od razu budujemy siatke z dziura: obrys
// prostokata laczymy pasem trojkatow z obwodem okregu. Wynik jest
// szczelny, czyli nadaje sie do druku.
export function plateWithHole(w, h, t, holeR, holeCx, holeCy, seg = 48) {
  const cx = holeCx ?? w / 2;
  const cy = holeCy ?? h / 2;

  // KLUCZOWE dla szczelnosci: obwod otworu i obrys plyty musza byc opisane
  // TA SAMA lista katow. Wczesniej gorna sciana miala kilkadziesiat punktow
  // na obwodzie, a sciany boczne tylko cztery narozniki - krawedzie nie
  // mialy sie z czym sparowac i bryla byla dziurawa.
  //
  // Do rownomiernych probek dokladamy katy dokladnie czterech naroznikow,
  // inaczej obrys scinalby rogi prostokata.
  const norm = (a) => (a % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const angles = [];
  for (let i = 0; i < seg; i++) angles.push((i / seg) * Math.PI * 2);
  angles.push(
    norm(Math.atan2(-cy, -cx)),
    norm(Math.atan2(-cy, w - cx)),
    norm(Math.atan2(h - cy, w - cx)),
    norm(Math.atan2(h - cy, -cx))
  );
  const ring = [...new Set(angles.map((a) => norm(a).toFixed(9)))].map(Number).sort((a, b) => a - b);
  const n = ring.length;

  // Punkt, w ktorym promien o danym kacie przebija obrys prostokata.
  const edgePoint = (ang, z) => {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const tx = dx > 1e-12 ? (w - cx) / dx : dx < -1e-12 ? -cx / dx : Infinity;
    const ty = dy > 1e-12 ? (h - cy) / dy : dy < -1e-12 ? -cy / dy : Infinity;
    const s = Math.min(tx, ty);
    return V(cx + dx * s, cy + dy * s, z);
  };
  const holePoint = (ang, z) => V(cx + Math.cos(ang) * holeR, cy + Math.sin(ang) * holeR, z);

  const tris = [];
  for (let i = 0; i < n; i++) {
    const a0 = ring[i];
    const a1 = ring[(i + 1) % n];

    const hb0 = holePoint(a0, 0);
    const hb1 = holePoint(a1, 0);
    const ht0 = holePoint(a0, t);
    const ht1 = holePoint(a1, t);
    const eb0 = edgePoint(a0, 0);
    const eb1 = edgePoint(a1, 0);
    const et0 = edgePoint(a0, t);
    const et1 = edgePoint(a1, t);

    tris.push(...quad(hb0, eb0, eb1, hb1)); // spod
    tris.push(...quad(ht0, ht1, et1, et0)); // wierzch
    tris.push(...quad(hb0, hb1, ht1, ht0)); // sciana otworu
    tris.push(...quad(eb0, et0, et1, eb1)); // sciana zewnetrzna
  }

  return tris;
}

// Wspornik ksztaltu L - plyta montazowa (pionowa, przykrecana do sciany)
// plus polka nosna (pozioma). To typowa postac uchwytu na kask, sluchawki
// czy narzedzie: obciazenie wisi na koncu polki.
export function bracketL({ plateW, plateH, shelfDepth, thickness, holeR, ribs = true }) {
  const tris = [];

  // Plyta montazowa lezy w plaszczyznie XY, grubosc idzie w Z (czyli w
  // sciane). Dzielimy ja na dwie polowy, kazda z wlasnym otworem - jedna
  // plyta z dwoma otworami wymagalaby duzo bardziej zawilej triangulacji,
  // a dwie osobne daja ten sam ksztalt i zostaja szczelne.
  const halfH = plateH / 2;
  for (let i = 0; i < 2; i++) {
    const part = plateWithHole(plateW, halfH, thickness, holeR, plateW / 2, halfH / 2);
    for (const t of part) {
      for (const k of ['a', 'b', 'c']) {
        t[k] = V(t[k][0], t[k][1] + i * halfH, t[k][2]);
      }
      tris.push(t);
    }
  }

  // Polka pozioma wychodzaca do przodu u dolu plyty
  const shelf = box(0, 0, thickness, plateW, thickness, shelfDepth);
  tris.push(...shelf);

  // Zebra wzmacniajace - trojkatne pletwy miedzy plyta a polka. To one
  // decyduja o wytrzymalosci wspornika duzo bardziej niz sama grubosc.
  if (ribs) {
    const ribT = Math.max(2, thickness * 0.8);
    const ribH = Math.min(plateH * 0.55, shelfDepth * 1.6);
    for (const x of [2, plateW - 2 - ribT]) {
      const p = [
        V(x, thickness, thickness),
        V(x, thickness + ribH, thickness),
        V(x, thickness, thickness + shelfDepth * 0.9),
      ];
      const q = p.map((v) => V(v[0] + ribT, v[1], v[2]));
      tris.push({ a: p[0], b: p[1], c: p[2] });
      tris.push({ a: q[0], b: q[2], c: q[1] });
      tris.push(...quad(p[0], p[2], q[2], q[0]));
      tris.push(...quad(p[1], q[1], q[2], p[2]));
      tris.push(...quad(p[0], q[0], q[1], p[1]));
    }
  }

  return tris;
}

export function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const k of ['a', 'b', 'c']) {
      for (let i = 0; i < 3; i++) {
        if (t[k][i] < lo[i]) lo[i] = t[k][i];
        if (t[k][i] > hi[i]) hi[i] = t[k][i];
      }
    }
  }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

// Objetosc bryly z sumy objetosci czworoscianow opartych o poczatek ukladu
// (wzor dywergencji). Potrzebna do oszacowania masy i zuzycia filamentu.
export function volumeMm3(tris) {
  let v = 0;
  for (const t of tris) {
    const [ax, ay, az] = t.a;
    const [bx, by, bz] = t.b;
    const [cx, cy, cz] = t.c;
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}
