// Rejestr urzadzen wlasciciela (telefon, desktop, home-server) podpietych
// pod ten sam kanal co HUD (server/hud.js) - zero nowych polaczen, zero
// nowego brokera, tylko nowy typ wiadomosci na juz istniejacym gnieznie.
//
// Po co: kazde urzadzenie osobno juz widzi te sama magistrale zdarzen
// (bus.js), ale nie ma jak jedno urzadzenie kazac cos zrobic KONKRETNIE
// drugiemu (np. telefon mowi "otworz to na komputerze"). Rejestr daje
// adresata (deviceId), relay dostarcza wiadomosc wprost do jego gniazda.

import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as bus from '../core/bus.js';

const devices = new Map();

function clip(value, max) {
  return String(value ?? '').slice(0, max);
}

export function registerDevice(ws, { deviceId, deviceType, name } = {}) {
  const id = clip(deviceId, 64);
  if (!id) return;
  // Ten sam deviceId podlaczajacy sie ponownie (np. odswiezenie strony) -
  // stare gniazdo jest juz martwe albo zaraz bedzie, zamykamy je jawnie,
  // zeby rejestr nie trzymal dwoch wpisow na to samo urzadzenie.
  const existing = devices.get(id);
  if (existing && existing.ws !== ws) {
    try {
      existing.ws.close();
    } catch {
      /* i tak za chwile odpadnie samo */
    }
  }
  devices.set(id, {
    ws,
    deviceId: id,
    deviceType: clip(deviceType || 'unknown', 32),
    name: clip(name || id, 64),
    connectedAt: existing?.connectedAt || Date.now(),
    lastSeenAt: Date.now(),
  });
  ws.__deviceId = id;
  bus.publish('devices', 'device.online', `urzadzenie polaczone: ${clip(name || id, 64)} (${clip(deviceType || 'nieznane', 32)})`, {
    level: 'info',
    data: { deviceId: id, deviceType, name },
  });
}

export function unregisterDevice(ws) {
  const id = ws.__deviceId;
  if (!id) return;
  const entry = devices.get(id);
  if (entry && entry.ws === ws) {
    devices.delete(id);
    bus.publish('devices', 'device.offline', `urzadzenie rozlaczone: ${entry.name}`, {
      level: 'info',
      data: { deviceId: id },
    });
  }
}

export function listDevices() {
  return Array.from(devices.values()).map(({ ws, ...rest }) => rest);
}

export function relayToDevice(deviceId, payload) {
  const entry = devices.get(clip(deviceId, 64));
  if (!entry || entry.ws.readyState !== entry.ws.OPEN) {
    return { ok: false, error: 'urzadzenie niepodlaczone' };
  }
  try {
    entry.ws.send(JSON.stringify({ type: 'device.message', from: 'relay', payload }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Wolane z hud.js dla kazdej wiadomosci, ktora nie byla samym pingiem.
 * Zwraca true, jesli to byla wiadomosc dla rejestru urzadzen (obsluzona
 * tutaj), zeby hud.js wiedzial, ze nie musi robic nic wiecej.
 */
export function handleDeviceMessage(ws, msg) {
  if (msg?.type === 'device.hello') {
    registerDevice(ws, msg);
    return true;
  }
  if (msg?.type === 'device.relay') {
    const result = relayToDevice(msg.targetDeviceId, msg.payload);
    try {
      ws.send(JSON.stringify({ type: 'device.relay.result', targetDeviceId: msg.targetDeviceId, ...result }));
    } catch {
      /* gniazdo nadawcy juz i tak odpada */
    }
    return true;
  }
  return false;
}

export const router = express.Router();

router.get('/api/devices', requireOwner, (req, res) => {
  res.json({ devices: listDevices() });
});

// Uzywane zarowno przez UI (przycisk "wykonaj na innym urzadzeniu"), jak i
// przez server/proactive.js, gdy sam system decyduje ze cos nalezy przekazac
// na konkretne urzadzenie (np. telefon zamiast komputera nocą).
router.post('/api/devices/:id/relay', requireOwner, (req, res) => {
  res.json(relayToDevice(req.params.id, req.body?.payload));
});

export default router;
