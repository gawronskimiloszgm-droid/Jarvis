// Kawa z ekspresu Philips (HomeID, seria 8000) z zabezpieczeniami. Parzenie i wlaczenie (ktore plucze
// dysze goraca woda) zawsze w dwoch krokach: "przygotuj" daje zlecenie wazne 90 s, a "zaparz" wykonuje
// je dopiero po stuknieciu na ekranie. Glos i model moga zlecenie przygotowac, ale nie potwierdzic:
// trasa potwierdzenia nie ma odpowiednika wsrod narzedzi. Do tego limity (odstep, dziennie, cisza nocna),
// kontrola stanu ekspresu przed parzeniem, powiadomienie i wpis w dzienniku. Stop dziala zawsze.
import crypto from 'node:crypto';
import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as P from '../connect/philips.js';
import { logJournal } from './life.js';

const router = express.Router();
const ORDER_TTL = 90000;
const DEFAULTS = { perDay: 8, gapS: 90, quietFrom: '23:00', quietTo: '05:00', profileSlot: 0, favorites: [2, 7, 14, 16] };

function store() {
  const d = memory.load();
  if (!d.kawa || typeof d.kawa !== 'object') d.kawa = {};
  if (!Array.isArray(d.kawa.log)) d.kawa.log = [];
  return d.kawa;
}
export function kawaSettings(patch) {
  const k = store();
  const cur = { ...DEFAULTS, ...(k.settings || {}) };
  if (patch) {
    const hm = (v) => /^\d{2}:\d{2}$/.test(String(v || '')) && Number(v.slice(0, 2)) < 24 && Number(v.slice(3)) < 60;
    if (patch.perDay != null) cur.perDay = Math.max(1, Math.min(20, Math.round(Number(patch.perDay) || DEFAULTS.perDay)));
    if (patch.gapS != null) cur.gapS = Math.max(30, Math.min(1800, Math.round(Number(patch.gapS) || DEFAULTS.gapS)));
    if (hm(patch.quietFrom)) cur.quietFrom = patch.quietFrom;
    if (hm(patch.quietTo)) cur.quietTo = patch.quietTo;
    if (patch.profileSlot != null) cur.profileSlot = Math.max(0, Math.min(7, Math.round(Number(patch.profileSlot) || 0)));
    if (Array.isArray(patch.favorites)) cur.favorites = patch.favorites.map(Number).filter((id) => P.DRINKS.some((d) => d.id === id)).slice(0, 8);
    k.settings = cur;
    memory.save(memory.load());
  }
  return cur;
}

const warsaw = (now) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));

/** Czemu teraz nie wolno parzyc (pusty napis = wolno). Licza sie tylko udane parzenia. */
export function limitReason(now = Date.now(), s = kawaSettings(), log = store().log) {
  const w = warsaw(now);
  const mins = Number(w.hour) * 60 + Number(w.minute);
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const [a, b] = [toMin(s.quietFrom), toMin(s.quietTo)];
  const quiet = a === b ? false : a < b ? mins >= a && mins < b : mins >= a || mins < b;
  if (quiet) return `cisza nocna (${s.quietFrom}-${s.quietTo}): w nocy ekspres nie parzy zdalnie`;
  const ok = log.filter((x) => x.ok);
  const last = ok[ok.length - 1];
  if (last && now - last.at < s.gapS * 1000) return `ostatnia kawa była przed chwilą, odczekaj ${Math.ceil((s.gapS * 1000 - (now - last.at)) / 1000)} s`;
  const day = `${w.year}-${w.month}-${w.day}`;
  if (ok.filter((x) => x.day === day).length >= s.perDay) return `dzienny limit ${s.perDay} kaw z Jarvisa`;
  return '';
}

const orders = new Map(); // id -> { kind, drink, at }

/** Krok 1: zlecenie do potwierdzenia na ekranie. kind: brew | power_on. */
export function prepare(kind, drinkQuery, now = Date.now()) {
  if (!P.isConnected()) return { error: 'Ekspres niepołączony: zaloguj się kontem Philips HomeID w module Kawa.' };
  for (const [id, o] of orders) if (now - o.at > ORDER_TTL) orders.delete(id);
  let drink = null;
  if (kind === 'brew') {
    drink = P.findDrink(drinkQuery);
    if (!drink) return { error: `Nie znam napoju "${drinkQuery}". Dostępne: ${P.DRINKS.map((d) => d.name).join(', ')}.` };
    const why = limitReason(now);
    if (why) return { error: why };
  }
  const id = crypto.randomBytes(12).toString('hex');
  orders.set(id, { kind, drink, at: now });
  return { ok: true, id, kind, drink: drink && { id: drink.id, name: drink.name }, expiresIn: ORDER_TTL / 1000 };
}

/** Krok 2, tylko z ekranu: wykonanie zlecenia po ponownym sprawdzeniu limitow i stanu ekspresu. */
export async function confirm(id, { now = Date.now(), brewFn = P.brew, statusFn = P.machineStatus, powerFn = P.setPower } = {}) {
  const o = orders.get(String(id || ''));
  orders.delete(String(id || ''));
  if (!o || now - o.at > ORDER_TTL) return { error: 'Zlecenie wygasło albo zostało już użyte: wybierz napój jeszcze raz.' };
  const k = store();
  if (o.kind === 'power_on') {
    await powerFn(true);
    logJournal('auto', 'Ekspres włączony z Jarvisa', 'kawa');
    return { ok: true, text: 'Włączam ekspres: nagrzewa się i płucze dyszę.' };
  }
  const why = limitReason(now);
  if (why) return { error: why };
  const st = await statusFn().catch((e) => ({ problems: [e.message] }));
  // Wylaczony ekspres moze nie odpowiadac na port Status: parzenie i tak go wlaczy.
  const blocking = (st.problems || []).filter((p) => !(st.powerOn === false && /wymaga działania/.test(p)));
  if (blocking.length) {
    k.log.push({ at: now, day: dayOf(now), drink: o.drink.name, ok: false, why: blocking.join(', ') });
    memory.save(memory.load());
    return { error: `Nie parzę: ${blocking.join(', ')}.` };
  }
  try {
    const r = await brewFn(o.drink.id, { profileSlot: kawaSettings().profileSlot });
    k.log.push({ at: now, day: dayOf(now), drink: o.drink.name, ok: true });
    if (k.log.length > 300) k.log.splice(0, k.log.length - 300);
    memory.save(memory.load());
    const text = `${r.warmed ? 'Włączyłem ekspres i parzę' : 'Parzę'}: ${o.drink.name}${r.unconfirmed ? ' (ekspres przyjął polecenie, ale nie potwierdził startu)' : ''}.`;
    logJournal('auto', `Kawa: ${o.drink.name}`, 'kawa');
    if (push.isConfigured()) push.sendToAll({ title: 'J.A.R.V.I.S. - ekspres', body: text }).catch(() => {});
    return { ok: true, text, ...r };
  } catch (e) {
    k.log.push({ at: now, day: dayOf(now), drink: o.drink.name, ok: false, why: e.message });
    memory.save(memory.load());
    return { error: e.message };
  }
}
const dayOf = (now) => {
  const w = warsaw(now);
  return `${w.year}-${w.month}-${w.day}`;
};

export function kawaStatusLocal() {
  const a = memory.load().philips;
  const k = store();
  return {
    connected: P.isConnected(),
    email: a?.email ? a.email.replace(/^(.).*(@.*)$/, '$1***$2') : '',
    device: a?.device || null,
    devices: a?.devices || [],
    settings: kawaSettings(),
    drinks: P.DRINKS.map((d) => ({ id: d.id, name: d.name })),
    today: k.log.filter((x) => x.ok && x.day === dayOf(Date.now())).length,
    log: k.log.slice(-8).reverse(),
    limit: limitReason(),
  };
}

// ---------- trasy (wszystkie tylko dla wlasciciela) ----------
const wrap = (fn) => async (req, res) => {
  try {
    const r = await fn(req);
    res.status(r?.error ? 400 : 200).json(r);
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: e.message });
  }
};
router.get('/api/kawa/status', requireOwner, wrap(async (req) => {
  const base = kawaStatusLocal();
  if (!base.connected || req.query.local) return base;
  try {
    return { ...base, machine: await P.machineStatus() };
  } catch (e) {
    return { ...base, machineError: e.message };
  }
}));
router.post('/api/kawa/login/code', requireOwner, wrap((req) => P.sendCode(req.body?.email)));
router.post('/api/kawa/login/verify', requireOwner, wrap(async (req) => ({ ok: true, devices: await P.verifyCode(req.body?.email, req.body?.code), ...kawaStatusLocal() })));
router.post('/api/kawa/device', requireOwner, wrap(async (req) => ({ ok: true, device: P.chooseDevice(String(req.body?.thingName || '')) })));
router.post('/api/kawa/logout', requireOwner, wrap(async () => {
  P.disconnect();
  return kawaStatusLocal();
}));
router.put('/api/kawa/settings', requireOwner, wrap(async (req) => kawaSettings(req.body || {})));
router.post('/api/kawa/prepare', requireOwner, wrap(async (req) => prepare(req.body?.kind === 'power_on' ? 'power_on' : 'brew', req.body?.drink)));
// Jedyna droga do parzenia: wywoluje ja przycisk na ekranie, nie narzedzie glosowe.
router.post('/api/kawa/confirm', requireOwner, wrap((req) => confirm(req.body?.id)));
router.post('/api/kawa/stop', requireOwner, wrap(async () => {
  await P.abortBrew();
  logJournal('auto', 'Kawa: przerwane z Jarvisa', 'kawa');
  return { ok: true };
}));
router.post('/api/kawa/power-off', requireOwner, wrap(() => P.setPower(false)));

// ---------- glos ----------
export const KAWA_TOOLS = [
  {
    name: 'kawa',
    description: 'Zrob kawe w ekspresie Philips: przygotowuje zlecenie i pokazuje na ekranie przycisk ZAPARZ, ktory uzytkownik musi nacisnac sam (Ty nie mozesz potwierdzic). napoj po polsku: espresso, kawa, americano, cappuccino, latte, latte macchiato, flat white, kawa z mlekiem, goraca woda itd.',
    parameters: { type: 'object', properties: { napoj: { type: 'string' } }, required: ['napoj'] },
  },
  {
    name: 'kawa_stop',
    description: 'Natychmiast przerwij parzenie kawy (bez potwierdzenia).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ekspres',
    description: 'Ekspres Philips: stan (czy gotowy, woda, ziarna, alarmy), wlacz (wymaga potwierdzenia na ekranie, bo ekspres plucze dysze) albo wylacz.',
    parameters: { type: 'object', properties: { akcja: { type: 'string', enum: ['stan', 'wlacz', 'wylacz'] } }, required: ['akcja'] },
  },
];
export const KAWA_VOICE_PROMPT = '- Kawa: kawa (przygotowuje i pokazuje przycisk ZAPARZ; powiedz, zeby podstawil kubek i nacisnal ZAPARZ na ekranie; nigdy nie mow, ze kawa juz sie parzy), kawa_stop (stop, przerwij kawe), ekspres (stan / wlacz / wylacz).';

export async function runKawaTool(name, a = {}) {
  if (name === 'kawa') {
    const r = prepare('brew', a.napoj);
    if (r.error) return r;
    return { czeka_na_potwierdzenie: true, napoj: r.drink.name, wygasa_s: r.expiresIn, klient: { action: 'kawa-potwierdz', params: { id: r.id, napoj: r.drink.name, rodzaj: 'brew' } } };
  }
  if (name === 'kawa_stop') {
    try {
      await P.abortBrew();
      logJournal('auto', 'Kawa: przerwane głosem', 'kawa');
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }
  if (name === 'ekspres') {
    if (!P.isConnected()) return { error: 'Ekspres niepołączony: zaloguj się w module Kawa.' };
    try {
      if (a.akcja === 'wylacz') return { ok: true, ...(await P.setPower(false)) };
      if (a.akcja === 'wlacz') {
        const r = prepare('power_on');
        return { czeka_na_potwierdzenie: true, klient: { action: 'kawa-potwierdz', params: { id: r.id, napoj: 'włączenie ekspresu', rodzaj: 'power_on' } } };
      }
      const st = await P.machineStatus();
      return { wlaczony: st.powerOn, stan: st.state, problemy: st.problems, polaczony: st.online };
    } catch (e) {
      return { error: e.message };
    }
  }
  return undefined;
}

export default router;
