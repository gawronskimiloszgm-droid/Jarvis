// Kanal telemetryczny do interfejsu: WebSocket /ws/hud.
//
// Jednokierunkowy w praktyce (serwer -> HUD), poza prostym ping/pong.
// Wszystko, co moduly wysylaja na magistrale zdarzen, laduje tutaj, wiec
// HUD ma jedno zrodlo prawdy o tym, co system robi.
//
// Tylko dla wlasciciela: strumien niesie telemetrie procesow, adresy IP i
// tresci ze spotkan - to nie sa dane dla trybu goscia.

import * as bus from './bus.js';
import { handleDeviceMessage, unregisterDevice } from '../home/devices.js';

const HEARTBEAT_MS = 25000;

const clients = new Set();

export function clientCount() {
  return clients.size;
}

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error('[hud] send error:', err);
  }
}

// Jedna subskrypcja magistrali na caly proces, nie jedna na kazde polaczenie -
// przy odswiezaniu strony inaczej zostawaloby po sobie martwe nasluchy.
bus.subscribe((event) => {
  for (const ws of clients) send(ws, { type: 'event', event });
});

/**
 * Podpiecie swiezego polaczenia HUD.
 * @param {import('ws').WebSocket} ws
 */
export function attachHud(ws) {
  clients.add(ws);

  send(ws, {
    type: 'hello',
    posture: bus.getPosture(),
    events: bus.recent(60),
    serverTime: new Date().toISOString(),
  });

  // Render usypia bezczynne polaczenia po ~55 s, wiec sami je podtrzymujemy
  // i przy okazji wykrywamy zerwane gniazda.
  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });

  const beat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {
      /* zaraz zamknie sie samo */
    }
  }, HEARTBEAT_MS);

  ws.on('message', (raw) => {
    // Poza pingiem, klient moze tylko zglosic sie do rejestru urzadzen
    // (device.hello/device.relay) - patrz devices.js. HUD sam niczym nie
    // steruje, od tego sa zwykle endpointy REST z autoryzacja.
    let msg = null;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.type === 'ping') {
      send(ws, { type: 'pong', at: Date.now() });
      return;
    }
    handleDeviceMessage(ws, msg);
  });

  const close = () => {
    clearInterval(beat);
    clients.delete(ws);
    unregisterDevice(ws);
  };

  ws.on('close', close);
  ws.on('error', (err) => {
    console.error('[hud] socket error:', err.message);
    close();
  });
}
