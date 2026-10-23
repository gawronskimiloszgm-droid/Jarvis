// Generuje ikone aplikacji Android w stylu rdzenia Jarvisa (pierscienie,
// podzialka i swiecacy srodek na ciemnym tle). Uruchamiane recznie:
//   npm i --no-save sharp && node scripts/generate-icons.js
// sharp nie jest zaleznoscia produkcyjna - serwer go nie potrzebuje.
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const PUB = path.join(__dirname, '..', 'public', 'icons');

const BG = '#02060d';
const HOT = '#22e0ff';
const DIM = '#124b5c';

// Rysunek w ukladzie 0..100. `scale` zmniejsza motyw dla ikony adaptacyjnej,
// gdzie system przycina brzegi (bezpieczna strefa to srodkowe ~66%).
function art(scale) {
  const c = 50;
  const R = 42 * scale;

  let ticks = '';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const major = i % 6 === 0;
    const len = major ? R * 0.2 : R * 0.1;
    const r0 = R - len;
    ticks += `<line x1="${(c + Math.cos(a) * r0).toFixed(2)}" y1="${(c + Math.sin(a) * r0).toFixed(2)}" x2="${(c + Math.cos(a) * R).toFixed(2)}" y2="${(c + Math.sin(a) * R).toFixed(2)}" stroke="${HOT}" stroke-width="${major ? 1.6 * scale : 0.8 * scale}" opacity="${major ? 0.95 : 0.45}"/>`;
  }

  let tri = '';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    tri += `${(c + Math.cos(a) * R * 0.34).toFixed(2)},${(c + Math.sin(a) * R * 0.34).toFixed(2)} `;
  }

  return `
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${HOT}" stop-opacity="0.95"/>
        <stop offset="55%" stop-color="${HOT}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${HOT}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    ${ticks}
    <circle cx="${c}" cy="${c}" r="${R * 0.78}" fill="none" stroke="${DIM}" stroke-width="${1.6 * scale}"/>
    <path d="M ${c - R * 0.62} ${c} A ${R * 0.62} ${R * 0.62} 0 0 1 ${c + R * 0.44} ${c - R * 0.44}"
          fill="none" stroke="${HOT}" stroke-width="${2.2 * scale}" stroke-linecap="round"/>
    <path d="M ${c + R * 0.62} ${c} A ${R * 0.62} ${R * 0.62} 0 0 1 ${c - R * 0.44} ${c + R * 0.44}"
          fill="none" stroke="${HOT}" stroke-width="${2.2 * scale}" stroke-linecap="round" opacity="0.75"/>
    <polygon points="${tri.trim()}" fill="none" stroke="${HOT}" stroke-width="${1.8 * scale}"/>
    <circle cx="${c}" cy="${c}" r="${R * 0.5}" fill="url(#g)"/>
    <circle cx="${c}" cy="${c}" r="${R * 0.13}" fill="#d9fbff"/>
  `;
}

const svgFull = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
     <rect width="100" height="100" fill="${BG}"/>${art(1)}</svg>`;

// Warstwa foreground ikony adaptacyjnej jest przezroczysta, a motyw musi
// zmiescic sie w bezpiecznej strefie - stad mniejsza skala.
const svgFg = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${art(0.62)}</svg>`;

const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function main() {
  for (const [d, size] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${d}`);
    await sharp(Buffer.from(svgFull(size))).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(Buffer.from(svgFull(size))).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    await sharp(Buffer.from(svgFg(size * 2.25))).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
    console.log(`mipmap-${d}: ${size}px + foreground ${Math.round(size * 2.25)}px`);
  }
  // Ikony PWA (przegladarka / ekran glowny)
  await sharp(Buffer.from(svgFull(192))).png().toFile(path.join(PUB, 'icon-192.png'));
  await sharp(Buffer.from(svgFull(512))).png().toFile(path.join(PUB, 'icon-512.png'));
  console.log('public/icons: icon-192.png, icon-512.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
