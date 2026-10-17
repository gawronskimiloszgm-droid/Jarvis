// Magistrala zdarzen - jeden punkt, przez ktory kazdy modul (CAD, obrona,
// spotkania, wizja, IoT) melduje, co robi, a interfejs HUD to slyszy.
//
// Celowo bez brokera (Redis/NATS): caly system chodzi w jednym procesie
// Node na darmowym hostingu, wiec EventEmitter + bufor ostatnich zdarzen
// daje dokladnie to samo, a nie dokłada usługi, ktora moze paść.
//
// Bufor jest po to, zeby swiezo otwarty HUD nie zaczynal od pustego ekranu:
// dostaje ostatnie zdarzenia natychmiast po podlaczeniu.

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

const RING_MAX = 300;

const emitter = new EventEmitter();
// Modulow nasluchujacych bedzie kilkanascie - domyslny limit 10 tylko
// sypalby ostrzezeniami do konsoli.
emitter.setMaxListeners(64);

const ring = [];

// Poziomy uzywane przez HUD do kolorowania i przez obrone do przelaczania
// motywu na alarmowy.
export const LEVELS = ['debug', 'info', 'ok', 'warn', 'alert'];

let posture = { level: 'nominal', reason: 'system gotowy', at: new Date().toISOString() };

function normalizeLevel(level) {
  return LEVELS.includes(level) ? level : 'info';
}

/**
 * Wyslanie zdarzenia na magistrale.
 * @param {string} source nazwa modulu, np. 'defense', 'cad', 'meet'
 * @param {string} topic  identyfikator zdarzenia, np. 'threat.detected'
 * @param {string} message tekst dla czlowieka (HUD pokazuje go wprost)
 * @param {{level?: string, data?: object, speak?: boolean}} [opts]
 */
export function publish(source, topic, message, opts = {}) {
  const event = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source: String(source),
    topic: String(topic),
    message: String(message),
    level: normalizeLevel(opts.level),
    // speak=true oznacza, ze HUD ma to przeczytac na glos, a nie tylko
    // dopisac do dziennika.
    speak: opts.speak === true,
    data: opts.data && typeof opts.data === 'object' ? opts.data : null,
  };

  ring.push(event);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);

  // Blad w jednym sluchaczu nie moze wywrocic calego procesu ani zablokowac
  // pozostalych - EventEmitter rzuca dalej, wiec lapiemy tutaj.
  try {
    emitter.emit('event', event);
  } catch (err) {
    console.error('[bus] listener error:', err);
  }

  return event;
}

/**
 * Nasluch wszystkich zdarzen. Zwraca funkcje odpinajaca.
 * @param {(event: object) => void} handler
 */
export function subscribe(handler) {
  const safe = (event) => {
    try {
      handler(event);
    } catch (err) {
      console.error('[bus] handler error:', err);
    }
  };
  emitter.on('event', safe);
  return () => emitter.off('event', safe);
}

/** Ostatnie zdarzenia - do odtworzenia w swiezo otwartym HUD. */
export function recent(limit = 60) {
  const n = Math.max(1, Math.min(RING_MAX, Number(limit) || 60));
  return ring.slice(-n);
}

/** Stan calego systemu: nominal | focus | design | threat | recovery. */
export function getPosture() {
  return { ...posture };
}

/**
 * Zmiana stanu systemu. HUD przemalowuje sie na jej podstawie (czerwien przy
 * 'threat'), a modul IoT ustawia pod nia swiatlo w pomieszczeniu.
 */
export function setPosture(level, reason) {
  const next = { level: String(level), reason: String(reason || ''), at: new Date().toISOString() };
  if (next.level === posture.level && next.reason === posture.reason) return posture;
  posture = next;
  publish('core', 'posture.changed', `stan systemu: ${next.level}${next.reason ? ` (${next.reason})` : ''}`, {
    level: next.level === 'threat' ? 'alert' : 'info',
    data: { posture: next },
  });
  return { ...posture };
}
