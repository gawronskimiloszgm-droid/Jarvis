// Klient kamer zewnetrznych po RTSP - niezalezny od server/cameras.js
// (ktory obsluguje WYLACZNIE agenta z home-server/camera-watcher.js,
// wysylajacego juz gotowe klatki JPEG). Tutaj serwer sam laczy sie z
// dowolnym strumieniem RTSP (kamera IP w sieci lokalnej/VPN) i wyciaga
// z niego jedna klatke.
//
// Zero wlasnej logiki dekodowania wideo - to robota dla ffmpeg, ktory
// jest wszedzie tam gdzie jest, ale NIE jest gwarantowany na darmowym
// hostingu (Render). Dlatego kazda funkcja najpierw sprawdza dostepnosc
// i uczciwie zglasza brak, zamiast udawac dzialanie.

import { spawn, spawnSync } from 'child_process';

const CAPTURE_TIMEOUT_MS = Number(process.env.RTSP_CAPTURE_TIMEOUT_MS || 10000);

let ffmpegChecked = null;

/** Czy ffmpeg jest dostepny w PATH systemu, na ktorym stoi serwer. */
export function isFfmpegAvailable() {
  if (ffmpegChecked !== null) return ffmpegChecked;
  try {
    const res = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpegChecked = !res.error;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

// Format zmiennej RTSP_CAMERA_URLS: "etykieta1=rtsp://...;etykieta2=rtsp://...".
// Wpis bez "=" dostaje etykiete wg pozycji (kamera1, kamera2, ...).
export function listConfiguredCameras() {
  const raw = String(process.env.RTSP_CAMERA_URLS || '').trim();
  if (!raw) return [];
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const eq = entry.indexOf('=');
      if (eq === -1) return { name: `kamera${i + 1}`, url: entry };
      return { name: entry.slice(0, eq).trim() || `kamera${i + 1}`, url: entry.slice(eq + 1).trim() };
    });
}

/**
 * Zrzut jednej klatki ze strumienia RTSP jako JPEG.
 * @param {string} rtspUrl
 * @returns {Promise<Buffer>} bufor JPEG
 */
export function captureFrame(rtspUrl) {
  if (!isFfmpegAvailable()) {
    return Promise.reject(new Error('ffmpeg nie jest zainstalowany na serwerze - wymagany do odczytu RTSP.'));
  }
  const url = String(rtspUrl || '').trim();
  if (!url) return Promise.reject(new Error('Brak adresu RTSP.'));

  return new Promise((resolve, reject) => {
    // -rtsp_transport tcp: wiekszosc kamer IP za NAT/VPN gubi pakiety UDP;
    // TCP jest wolniejsze, ale dla pojedynczej klatki roznica jest bez znaczenia.
    const proc = spawn('ffmpeg', [
      '-y',
      '-rtsp_transport', 'tcp',
      '-i', url,
      '-frames:v', '1',
      '-q:v', '3',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1',
    ]);

    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Przekroczono czas oczekiwania na klatke RTSP (kamera niedostepna?).'));
    }, CAPTURE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || !buffer.length) {
        reject(new Error(`ffmpeg nie zwrocil klatki (kod ${code}): ${stderr.slice(-300)}`));
        return;
      }
      resolve(buffer);
    });
  });
}
