// Powiadomienie w czasie rzeczywistym o zagrozeniu wykrytym przez
// modules/perimeter/vision.js.
//
// server/cameras.js JUZ publikuje 'camera.alert' (level 'warn') i wysyla
// push przy kazdej klatce z notable=true. Ta funkcja to WARSTWA WYZEJ:
// eskaluje do poziomu 'alert' (HUD przelacza sie na czerwony motyw przez
// bus.setPosture - patrz server/bus.js) i pilnuje, zeby seria klatek z tej
// samej kamery (np. osoba stojaca w kadrze przez minute, analizowana co
// kilka sekund mimo throttlingu w cameras.js) nie zasypala telefonu
// dziesiatkami powiadomien push o tym samym zdarzeniu - to jest jego
// jedyny realny dodatek ponad to, co juz dzieje sie w cameras.js.
//
// Wywolanie: patrz raport koncowy - dokladne miejsce w server/cameras.js.

import * as bus from '../../server/bus.js';
import * as push from '../../server/push.js';

// Ten sam "wybuch" ruchu (osoba w kadrze przez dluzsza chwile) nie powinien
// wywolac push co kilka sekund - telefon budzony w kolko przestaje byc
// sygnalem, a zaczyna byc irytacja, ktora usypia czujnosc.
const COOLDOWN_MS = Number(process.env.THREAT_NOTIFY_COOLDOWN_MS || 5 * 60 * 1000);
const MIN_CONFIDENCE = Number(process.env.THREAT_NOTIFY_MIN_CONFIDENCE || 0);

const lastNotifiedAt = new Map();

/**
 * @param {{notable:boolean, description:string, confidence:number|null}} visionResult wynik z analyzeFrame()
 * @param {{camera?: string}} [meta]
 * @returns {{notified:boolean, reason?:string}}
 */
export function notifyIfThreat(visionResult, meta = {}) {
  const camera = String(meta.camera || 'kamera').slice(0, 40);
  if (!visionResult || !visionResult.notable) return { notified: false, reason: 'not-notable' };

  const confidence = Number.isFinite(visionResult.confidence) ? visionResult.confidence : null;
  if (confidence != null && confidence < MIN_CONFIDENCE) {
    return { notified: false, reason: 'low-confidence' };
  }

  const now = Date.now();
  const last = lastNotifiedAt.get(camera) || 0;
  if (now - last < COOLDOWN_MS) {
    return { notified: false, reason: 'cooldown' };
  }
  lastNotifiedAt.set(camera, now);

  const message = `ZAGROZENIE - ${camera}: ${visionResult.description}`;
  bus.publish('perimeter', 'threat.notify', message, {
    level: 'alert',
    speak: true,
    data: { camera, confidence },
  });
  bus.setPosture('threat', `ruch obwodowy: ${camera}`);

  push
    .sendToAll({ title: 'Jarvis - ALARM', body: message })
    .catch(() => {
      /* brak skonfigurowanego push (VAPID) albo martwa subskrypcja - zdarzenie na busie i tak poszlo */
    });

  return { notified: true };
}

/** Dla panelu/testow - kiedy ostatnio wyslano powiadomienie dla danej kamery. */
export function lastNotification(camera) {
  const at = lastNotifiedAt.get(String(camera || 'kamera').slice(0, 40));
  return at ? { at, ageMs: Date.now() - at } : null;
}
