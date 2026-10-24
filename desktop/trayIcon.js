// Ikona zasobnika generowana kodem (PNG zlozony recznie) - zeby nie trzymac
// w repo binarnych plikow i nie zalezec od sciezek po spakowaniu aplikacji.

const zlib = require('zlib');
const { nativeImage } = require('electron');

function crc32(buf) {
  let c;
  let crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Pierscien + kropka w kolorze akcentu Jarvisa (czerwony dla E.D.I.T.H.).
function png(size, [r, g, b]) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let a = 0;
      if (d > size * 0.34 && d < size * 0.46) a = 255;
      else if (d < size * 0.14) a = 255;
      else if (d >= size * 0.46 && d < size * 0.5) a = Math.round(255 * (1 - (d - size * 0.46) / (size * 0.04)));
      const i = (y * size + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.max(0, Math.min(255, a));
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bitow
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function trayIcon(color = [51, 224, 255]) {
  return nativeImage.createFromBuffer(png(32, color));
}

module.exports = { trayIcon, png };
