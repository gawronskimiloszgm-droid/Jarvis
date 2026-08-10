// Generuje natywny ekran powitalny Androida ("JARVIS" na ciemnym tle w
// kolorach HUD) - zeby zakryc domyslny/pusty ekran ladowania Capacitora
// podczas budzenia darmowego serwera Render, zamiast go usuwac.
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const BG = '#030914';
const CYAN = '#00f3ff';
const CYAN_DIM = '#0f6b7d';

function svgFor(w, h) {
  const fontSize = Math.round(Math.min(w, h) * 0.11);
  const ringR = Math.round(Math.min(w, h) * 0.16);
  const cx = w / 2;
  const cy = h / 2 - fontSize * 0.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${CYAN}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${CYAN}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="${BG}"/>
    <circle cx="${cx}" cy="${cy}" r="${ringR * 1.8}" fill="url(#glow)"/>
    <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${CYAN_DIM}" stroke-width="${Math.max(2, ringR * 0.04)}"/>
    <circle cx="${cx}" cy="${cy}" r="${ringR * 0.7}" fill="none" stroke="${CYAN}" stroke-width="${Math.max(2, ringR * 0.03)}" stroke-opacity="0.8"/>
    <text x="${cx}" y="${cy + fontSize * 0.12}" font-family="Consolas, 'Courier New', monospace" font-size="${fontSize * 0.34}" fill="${CYAN}" text-anchor="middle" dominant-baseline="middle" letter-spacing="${fontSize * 0.05}">J</text>
    <text x="${cx}" y="${cy + ringR * 2.1}" font-family="Consolas, 'Courier New', monospace" font-weight="bold" font-size="${fontSize}" fill="${CYAN}" text-anchor="middle" letter-spacing="${fontSize * 0.25}">JARVIS</text>
  </svg>`;
}

const targets = [
  ['drawable/splash.png', 480, 320],
  ['drawable-port-mdpi/splash.png', 320, 480],
  ['drawable-port-hdpi/splash.png', 480, 800],
  ['drawable-port-xhdpi/splash.png', 720, 1280],
  ['drawable-port-xxhdpi/splash.png', 960, 1600],
  ['drawable-port-xxxhdpi/splash.png', 1280, 1920],
  ['drawable-land-mdpi/splash.png', 480, 320],
  ['drawable-land-hdpi/splash.png', 800, 480],
  ['drawable-land-xhdpi/splash.png', 1280, 720],
  ['drawable-land-xxhdpi/splash.png', 1600, 960],
  ['drawable-land-xxxhdpi/splash.png', 1920, 1280],
];

async function main() {
  for (const [rel, w, h] of targets) {
    const svg = Buffer.from(svgFor(w, h));
    const out = path.join(RES, rel);
    await sharp(svg).png().toFile(out);
    console.log('wrote', rel, `${w}x${h}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
