// Odbior klatek od lokalnego agenta kamer (patrz home-server/camera-watcher.js)
// i ich ocena.
//
// Agent na laptopie NIE ma klucza Gemini ani zadnej logiki AI - jego jedyna
// robota to wyciagniecie klatki z RTSP (filtrem ruchu w samym ffmpeg) i
// przeslanie jej tutaj. Cala analiza i cala magistrala zdarzen zyja w
// jednym miejscu w chmurze, zeby nie trzymac sekretow na urzadzeniu, ktore
// stoi w garazu.

import * as bus from './bus.js';
import * as push from './push.js';
import { analyzeFrame } from '../modules/perimeter/vision.js';

// ffmpeg po stronie agenta filtruje juz ruch (select=scene), ale przy
// migajacym swietle albo przejezdzajacych reflektorach potrafi wypluc
// kilka klatek pod rzad. Ten limit chroni budzet zapytan do Gemini -
// nie odrzuca ruchu, tylko nie analizuje go klatka po klatce.
const MIN_GAP_MS = Number(process.env.CAMERA_MIN_GAP_MS || 4000);
const lastAnalyzedAt = new Map();
const lastHeartbeatAt = new Map();

// Klatka z wykrytym ruchem - ZAWSZE warta analizy, bo to ffmpeg po stronie
// agenta juz przefiltrowal nieistotne klatki filtrem sceny.
export async function handleFrame({ camera, buffer }) {
  const cam = String(camera || 'kamera').slice(0, 40);
  const now = Date.now();
  const last = lastAnalyzedAt.get(cam) || 0;
  if (now - last < MIN_GAP_MS) return { skipped: true, reason: 'throttled' };
  lastAnalyzedAt.set(cam, now);

  const verdict = await analyzeFrame(buffer, cam);

  if (verdict.notable) {
    bus.publish('perimeter', 'camera.alert', `${cam}: ${verdict.description}`, {
      level: 'warn',
      speak: true,
      data: { camera: cam, confidence: verdict.confidence },
    });
    push.sendToAll({ title: `Jarvis - ${cam}`, body: verdict.description }).catch(() => {});
  } else {
    bus.publish('perimeter', 'camera.clear', `${cam}: ${verdict.description || 'ruch bez znaczenia'}`, {
      level: 'debug',
      data: { camera: cam },
    });
  }
  return { ok: true, verdict, escalated: verdict.notable };
}

// Heartbeat - potwierdzenie, ze agent i polaczenie RTSP wciaz zyja. Zadnej
// analizy obrazu: to sygnal obecnosci, nie zdarzenie do oceny.
const HEARTBEAT_LOG_GAP_MS = 10 * 60 * 1000; // nie zasmiecaj dziennika czesciej niz co 10 min

export function handleHeartbeat({ camera }) {
  const cam = String(camera || 'kamera').slice(0, 40);
  const now = Date.now();
  const last = lastHeartbeatAt.get(cam) || 0;
  lastHeartbeatAt.set(cam, now);
  if (now - last > HEARTBEAT_LOG_GAP_MS) {
    bus.publish('perimeter', 'camera.heartbeat', `${cam}: łącze aktywne`, { level: 'debug', data: { camera: cam } });
  }
  return { ok: true };
}

// Dla HUD/pulpitu: kiedy kazda kamera ostatnio dala znak zycia. Brak
// wpisu albo wpis starszy niz 2x oczekiwany interwal = kamera podejrzana
// o rozlaczenie - to wykorzysta panel Systemy/Perymetr.
export function cameraStatuses(staleAfterMs = 6 * 60 * 1000) {
  const now = Date.now();
  return [...lastHeartbeatAt.entries()].map(([camera, at]) => ({
    camera,
    lastSeenMs: now - at,
    online: now - at < staleAfterMs,
  }));
}
