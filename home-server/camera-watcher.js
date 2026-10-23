// Agent kamer - dziala NA LAPTOPIE (nie na Render), bo tylko stad jest
// dostep do kamer RTSP w sieci domowej. Sam nie ma klucza Gemini ani zadnej
// logiki AI: wyciaga klatki, chmura je ocenia.
//
// RUCH: jedno polaczenie RTSP na kamere, ffmpeg sam filtruje klatki
// filtrem sceny (select=scene) - CPU laptopa nie dekoduje i nie ocenia
// obrazu klatka po klatce, robi to tylko wtedy, gdy scena sie zmienia.
// Wyjscie skalowane do 720p (spec I.1: 'ogranicz do 1 FPS z automatycznym
// zmniejszaniem rozdzielczosci do 720p') - tu realizowane jako "1 klatka
// na zmiane sceny" zamiast sztywnego 1 FPS non-stop: ciagle wysylanie
// klatki co sekunde 24/7 do platnego API wizyjnego wyczerpaloby darmowy
// limit Gemini w kilkanascie minut, a nic by to nie dawalo przy nieruchomym
// kadrze. To swiadome odejscie od litery specyfikacji, nie przeoczenie.
//
// HEARTBEAT: zywotnosc procesu ffmpeg = zywotnosc polaczenia z kamera
// (RTSP, ktore padnie, konczy proces bledem). Nie otwieramy drugiego
// polaczenia tylko po to, zeby "sprawdzic czy kamera zyje".
//
// Uruchomienie: node home-server/camera-watcher.js
// Konfiguracja: home-server/.env (patrz home-server/.env.example)

import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

// Konfiguracja z KATALOGU AGENTA, nie z katalogu uruchomienia - inaczej
// przy starcie z glownego katalogu repozytorium czytalby .env serwera
// i ignorowal home-server/.env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const JARVIS_URL = (process.env.JARVIS_URL || 'http://localhost:3000').replace(/\/+$/, '');
const OWNER_USER = process.env.OWNER_USER || '';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const CAMERA_NAME = process.env.CAMERA_NAME || 'kamera';
const RTSP_URL = process.env.RTSP_URL || '';
const SCENE_THRESHOLD = process.env.SCENE_THRESHOLD || '0.02';
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 5 * 60 * 1000);
const MIN_UPLOAD_GAP_MS = Number(process.env.MIN_UPLOAD_GAP_MS || 3000);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('pl-PL', { hour12: false })}] ${msg}`);
}

if (!RTSP_URL) {
  console.error('Brak RTSP_URL w konfiguracji (home-server/.env). Bez tego nie ma czego ogladac.');
  process.exit(1);
}
if (!OWNER_PASSWORD) {
  console.error('Brak OWNER_PASSWORD w konfiguracji - agent musi sie zalogowac tak samo jak przegladarka.');
  process.exit(1);
}

// ---------- Sesja z chmura ----------

let token = null;

async function login() {
  const res = await fetch(`${JARVIS_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: OWNER_USER, password: OWNER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`logowanie nieudane: HTTP ${res.status}`);
  const data = await res.json();
  token = data.token;
  log('zalogowano do chmury');
}

// Jedno wywolanie proboje ponowic PO ponownym zalogowaniu, jesli token
// wygasl albo zostal uniewazniony (401) - ale tylko raz, zeby zly login
// nie zapetlil sie w nieskonczonosc.
async function postJson(path, body) {
  if (!token) await login();
  const attempt = async () =>
    fetch(`${JARVIS_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  let res = await attempt();
  if (res.status === 401) {
    log('token odrzucony, loguje ponownie');
    await login();
    res = await attempt();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Wysylka klatek ----------

let lastUploadAt = 0;

async function uploadMotionFrame(jpegBuffer) {
  const now = Date.now();
  // Lekki filtr PO STRONIE AGENTA - oszczedza upload z domowego lacza.
  // Serwer i tak throttluje analize (patrz server/cameras.js), to tylko
  // dodatkowa oszczednosc, nie zrodlo prawdy o throttlingu.
  if (now - lastUploadAt < MIN_UPLOAD_GAP_MS) return;
  lastUploadAt = now;
  try {
    const result = await postJson('/api/cameras/frame', {
      camera: CAMERA_NAME,
      image: jpegBuffer.toString('base64'),
    });
    if (result.skipped) log(`klatka pominieta (${result.reason})`);
    else if (result.escalated) log(`ALERT: ${result.verdict?.description || '(brak opisu)'}`);
    else log(`klatka oceniona: ${result.verdict?.description || 'bez uwag'}`);
  } catch (err) {
    log(`blad wysylki klatki: ${err.message}`);
  }
}

async function sendHeartbeat() {
  try {
    await postJson('/api/cameras/heartbeat', { camera: CAMERA_NAME });
  } catch (err) {
    log(`blad heartbeat: ${err.message}`);
  }
}

// ---------- Demuks strumienia MJPEG ----------
//
// ffmpeg z '-f image2pipe -vcodec mjpeg' wypisuje na stdout kolejne,
// kompletne pliki JPEG jeden za drugim, bez zadnego separatora poza tym,
// ze kazdy JPEG sam w sobie zaczyna sie znacznikiem SOI (FF D8) i konczy
// EOI (FF D9). W poprawnym JPEG bajt FF wewnatrz danych jest zawsze
// "stuffowany" zerem, wiec surowe skanowanie na FF D9 jest bezpieczne i
// jest dokladnie tym, czego uzywa sam demuxer image2 w ffmpeg.
function makeJpegSplitter(onFrame) {
  const SOI = Buffer.from([0xff, 0xd8]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let buf = Buffer.alloc(0);

  return function feed(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    for (;;) {
      const start = buf.indexOf(SOI);
      if (start === -1) {
        buf = Buffer.alloc(0);
        return;
      }
      const end = buf.indexOf(EOI, start + 2);
      if (end === -1) {
        if (start > 0) buf = buf.subarray(start);
        return;
      }
      onFrame(buf.subarray(start, end + 2));
      buf = buf.subarray(end + 2);
    }
  };
}

// ---------- Proces ffmpeg (ruch) ----------

let restartDelay = 2000;
const MAX_RESTART_DELAY = 60000;

function startMotionWatcher() {
  const args = [
    '-rtsp_transport', 'tcp',
    '-i', RTSP_URL,
    '-vf', `select='gt(scene,${SCENE_THRESHOLD})',scale=-2:720`,
    // '-vsync vfr' jest w nowszych ffmpeg (5+) zastapione przez '-fps_mode vfr'.
    // Bez tego kazda wybrana klatka i tak trafi w strumien, ale ze
    // zdublowanym znacznikiem czasu - dla image2pipe to bez znaczenia,
    // flaga i tak jest tu tylko dla poprawnosci/kompatybilnosci wstecz.
    '-fps_mode', 'vfr',
    '-f', 'image2pipe',
    '-q:v', '5',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ];

  log(`laczenie z kamera "${CAMERA_NAME}"...`);
  const ff = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const feed = makeJpegSplitter((frame) => {
    restartDelay = 2000; // dostalismy dane - polaczenie dziala, reset backoffu
    uploadMotionFrame(frame);
  });

  ff.stdout.on('data', feed);

  // ffmpeg pisze normalny status polaczenia na stderr, nie tylko bledy -
  // logujemy ostatnia linie przy wyjsciu, zeby wiedziec CO padlo (zly
  // adres, zle haslo w URL, kamera nieosiagalna itd.), a nie tylko ZE padlo.
  let lastErrLine = '';
  ff.stderr.on('data', (d) => {
    const lines = d.toString().trim().split('\n');
    if (lines.length) lastErrLine = lines[lines.length - 1];
  });

  ff.on('exit', (code) => {
    log(`polaczenie z kamera zerwane (kod ${code}). ${lastErrLine ? 'ostatni komunikat: ' + lastErrLine : ''}`);
    log(`ponawiam za ${Math.round(restartDelay / 1000)}s`);
    setTimeout(startMotionWatcher, restartDelay);
    restartDelay = Math.min(restartDelay * 1.6, MAX_RESTART_DELAY);
  });

  ff.on('error', (err) => {
    log(`nie udalo sie uruchomic ffmpeg: ${err.message}. Czy ffmpeg jest w PATH? (FFMPEG_BIN w .env)`);
  });
}

// ---------- Start ----------

async function main() {
  await login();
  startMotionWatcher();
  setInterval(sendHeartbeat, HEARTBEAT_MS);
  sendHeartbeat();
}

main().catch((err) => {
  console.error('Agent nie wystartowal:', err.message);
  process.exit(1);
});
