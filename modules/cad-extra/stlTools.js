// #108 Import/edycja istniejacych plikow STL (na razie: odczyt metadanych)
// #109 Eksport do formatu OBJ (Wavefront) - konwersja z tych samych
//       trojkatow, ktore modules/cad/stl.js juz umie zapisac jako STL.
//
// Format binarny STL: 80 bajtow naglowka (tekst, ignorowany przez slicery)
// + uint32 LE liczba trojkatow + N x 50 bajtow rekordu (12 floatow: normalna
// + 3 wierzcholki, potem 2 bajty "attribute byte count", zwykle 0). Patrz
// modules/cad/stl.js:toBinarySTL() - to dokladnie odwrotna operacja.

function round3(arr) {
  return arr.map((v) => Math.round(v * 1000) / 1000);
}

function emptyBounds() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

/** Parsowanie NAGLOWKA i geometrii binarnego pliku STL - liczba trojkatow + bounding box. */
export function parseBinarySTL(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 84) {
    throw new Error(`Plik za krotki na naglowek binarnego STL (${buf.length} B, potrzeba min. 84 B).`);
  }

  const header = buf.toString('ascii', 0, 80).replace(/\0/g, '').trim();
  const triCount = buf.readUInt32LE(80);
  const expectedLen = 84 + triCount * 50;

  if (expectedLen !== buf.length) {
    // Rozmiar sie nie zgadza - albo to plik tekstowy (ASCII STL), albo jest
    // uszkodzony. ASCII STL zaczyna sie od "solid" i zawiera slowo "facet";
    // sam poczatek "solid" NIE wystarcza (binarny tez moze miec taki naglowek
    // tekstowy w pierwszych bajtach).
    const head = buf.toString('ascii', 0, Math.min(512, buf.length));
    if (/^solid\b/i.test(head.trim()) && buf.toString('ascii').includes('facet')) {
      return parseAsciiSTL(buf.toString('ascii'));
    }
    throw new Error(
      `Rozmiar pliku (${buf.length} B) nie zgadza sie z liczba trojkatow z naglowka binarnego STL ` +
        `(oczekiwano ${expectedLen} B dla ${triCount} trojkatow) - plik moze byc uszkodzony.`
    );
  }

  const b = emptyBounds();
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    off += 12; // normalna - pomijamy, licza sie tylko wierzcholki do bounding-boxa
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(off);
      const y = buf.readFloatLE(off + 4);
      const z = buf.readFloatLE(off + 8);
      off += 12;
      if (x < b.min[0]) b.min[0] = x;
      if (y < b.min[1]) b.min[1] = y;
      if (z < b.min[2]) b.min[2] = z;
      if (x > b.max[0]) b.max[0] = x;
      if (y > b.max[1]) b.max[1] = y;
      if (z > b.max[2]) b.max[2] = z;
    }
    off += 2; // attribute byte count
  }

  return {
    format: 'binary',
    header,
    triangles: triCount,
    bounds: { min: round3(b.min), max: round3(b.max) },
    sizeMm: round3([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]),
  };
}

// Fallback dla plikow ASCII STL - nie byl wymagany wprost, ale odrzucanie
// ich twardym bledem (skoro odróżnienie od binarnego jest tanie) byloby
// zlym doswiadczeniem: uzytkownik i tak nie wie, w jakim formacie ma plik.
function parseAsciiSTL(text) {
  const vertexRe = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  const b = emptyBounds();
  let count = 0;
  let m;
  while ((m = vertexRe.exec(text))) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const z = parseFloat(m[3]);
    count++;
    if (x < b.min[0]) b.min[0] = x;
    if (y < b.min[1]) b.min[1] = y;
    if (z < b.min[2]) b.min[2] = z;
    if (x > b.max[0]) b.max[0] = x;
    if (y > b.max[1]) b.max[1] = y;
    if (z > b.max[2]) b.max[2] = z;
  }
  if (count === 0) throw new Error('Nie znaleziono zadnych wierzcholkow w pliku STL (ASCII).');

  const nameMatch = text.match(/^\s*solid\s+(.*)$/m);
  return {
    format: 'ascii',
    header: nameMatch ? nameMatch[1].trim().slice(0, 80) : '',
    triangles: Math.floor(count / 3),
    bounds: { min: round3(b.min), max: round3(b.max) },
    sizeMm: round3([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]),
  };
}

/**
 * #109 Konwersja siatki trojkatow (format uzywany w calym module CAD:
 * [{a,b,c}] gdzie kazdy wierzcholek to [x,y,z]) do tekstowego formatu OBJ.
 * Bez deduplikacji wspoldzielonych wierzcholkow (jak toAsciiSTL() w
 * modules/cad/stl.js) - kazdy trojkat dostaje wlasne 3 linie "v" - prostsze
 * i dla siatek rzedu paru tysiecy trojkatow rozmiar pliku nie ma znaczenia.
 */
export function trisToObj(tris, name = 'jarvis') {
  const lines = [`# eksport z Jarvis CAD (${tris.length} trojkatow)`, `o ${name}`];
  let idx = 1;
  for (const t of tris) {
    for (const k of ['a', 'b', 'c']) {
      lines.push(`v ${t[k][0].toFixed(4)} ${t[k][1].toFixed(4)} ${t[k][2].toFixed(4)}`);
    }
    lines.push(`f ${idx} ${idx + 1} ${idx + 2}`);
    idx += 3;
  }
  return lines.join('\n') + '\n';
}
