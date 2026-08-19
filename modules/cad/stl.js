// Zapis siatki do STL - formatu, ktory rozumie kazdy program do ciecia
// (PrusaSlicer, Cura, Bambu Studio) i kazda drukarka 3D.
//
// Domyslnie binarny: dla tych samych trojkatow plik jest kilkukrotnie
// mniejszy niz tekstowy i wczytuje sie szybciej.

function normal(t) {
  const ux = t.b[0] - t.a[0];
  const uy = t.b[1] - t.a[1];
  const uz = t.b[2] - t.a[2];
  const vx = t.c[0] - t.a[0];
  const vy = t.c[1] - t.a[1];
  const vz = t.c[2] - t.a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function toBinarySTL(tris, header = 'JARVIS') {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write(header.slice(0, 79).padEnd(80, ' '), 0, 80, 'ascii');
  buf.writeUInt32LE(tris.length, 80);

  let off = 84;
  for (const t of tris) {
    const n = normal(t);
    buf.writeFloatLE(n[0], off);
    buf.writeFloatLE(n[1], off + 4);
    buf.writeFloatLE(n[2], off + 8);
    off += 12;
    for (const k of ['a', 'b', 'c']) {
      buf.writeFloatLE(t[k][0], off);
      buf.writeFloatLE(t[k][1], off + 4);
      buf.writeFloatLE(t[k][2], off + 8);
      off += 12;
    }
    buf.writeUInt16LE(0, off);
    off += 2;
  }
  return buf;
}

export function toAsciiSTL(tris, name = 'jarvis') {
  const out = [`solid ${name}`];
  for (const t of tris) {
    const n = normal(t);
    out.push(`  facet normal ${n[0].toFixed(6)} ${n[1].toFixed(6)} ${n[2].toFixed(6)}`);
    out.push('    outer loop');
    for (const k of ['a', 'b', 'c']) {
      out.push(`      vertex ${t[k][0].toFixed(4)} ${t[k][1].toFixed(4)} ${t[k][2].toFixed(4)}`);
    }
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n');
}
