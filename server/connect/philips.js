// Ekspres Philips z aplikacji HomeID (seria 8000, platforma FUSION/"Rita") przez chmure Philips.
// Nieoficjalne: Philips nie publikuje API. Protokol wg integracji homeassistant_philips_homeid
// (github.com/renaudallard/homeassistant_philips_homeid), Copyright (c) 2025-2026, Renaud Allard,
// licencja BSD-2-Clause: stale protokolu i przebieg logowania przeniesione stamtad, kod napisany od nowa.
//
// Logowanie: kod z e-maila (Gigya OTP) -> sesja Gigya -> tokeny OIDC klienta aplikacji HomeID
// (logowanie pasywne prompt=none + PKCE). Sterowanie: MQTT przez WebSocket do AWS IoT z naglowkami
// CustomAuthorizer, polecenia "setPort"/"getPort" na temacie {tenant}_ctrl/{thing}/to_ncp,
// stan urzadzenia w cieniu (shadow) AWS.
import crypto from 'node:crypto';
import * as memory from '../memory/memory.js';

const GIGYA_API_KEY = '4_JGZWlP8eQHpEqkvQElolbA';
const GIGYA = 'https://cdc.accounts.home.id';
const ISSUER = `${GIGYA}/oidc/op/v1.0/${GIGYA_API_KEY}`;
const CLIENT_ID = '-u6aTznrxp9_9e_0a57CpvEG';
const REDIRECT = 'com.philips.ka.oneka.app.prod://oauthredirect';
const SCOPES = 'openid profile email offline_access DI.Account.read DI.AccountProfile.read DI.AccountProfile.write DI.AccountGeneralConsent.read DI.AccountGeneralConsent.write DI.GeneralConsent.read DI.GeneralConsent.write VoiceProvider.read VoiceProvider.write subscriptions consent profile_extended DI.AccountSubscription.write DI.AccountSubscription.read';
const IOT = 'https://prod.eu-da.iot.versuni.com/api/da';
const TENANT = 'da';
const MQTT_HOST = 'ats.prod.eu-da.iot.versuni.com';
const TIMEOUT = 20000;

export class PhilipsError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

const auth = () => memory.load().philips || null;
export const isConnected = () => Boolean(auth()?.refresh && auth()?.device?.thingName);

// ---------- logowanie ----------

/** Ciasteczka miedzy krokami logowania (Gigya laczy /authorize, getIDs i /authorize/continue przez nie). */
function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    take(res) {
      const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : String(res.headers.get('set-cookie') || '').split(/,(?=\s*[^;=\s]+=)/);
      for (const c of list) {
        const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c || '');
        if (m) jar.set(m[1], m[2]);
      }
    },
  };
}

async function call(url, opts = {}, what = 'Philips') {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new PhilipsError(`${what} nie odpowiada (${e.name === 'TimeoutError' ? 'przekroczony czas' : e.message}).`);
  }
}
async function gigya(path, form, jar) {
  const res = await call(`${GIGYA}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(jar && { Cookie: jar.header() }) }, body: new URLSearchParams({ ...form, apiKey: GIGYA_API_KEY, format: 'json' }) }, 'Logowanie Philips');
  jar?.take(res);
  const data = await res.json().catch(() => null);
  if (!data) throw new PhilipsError(`Logowanie Philips: zła odpowiedź (HTTP ${res.status}).`);
  return data;
}

const pending = new Map(); // email -> { vToken, at }

/** Krok 1: Philips wysyla kod na e-mail konta HomeID. */
export async function sendCode(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new PhilipsError('Podaj adres e-mail konta Philips HomeID.');
  const data = await gigya('accounts.auth.otp.email.sendCode', { email: e });
  if (data.errorCode !== 0 || !data.vToken) throw new PhilipsError(`Philips nie wysłał kodu: ${data.errorMessage || data.errorCode}.`);
  pending.set(e, { vToken: data.vToken, at: Date.now() });
  return { ok: true };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Sesja Gigya -> kod autoryzacji klienta HomeID bez okna logowania (prompt=none), potem tokeny (PKCE). */
async function oidcFromSession(loginToken) {
  const jar = cookieJar();
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES, state: b64url(crypto.randomBytes(12)), code_challenge: challenge, code_challenge_method: 'S256', prompt: 'none' });
  let res = await call(`${ISSUER}/authorize?${q}`, { redirect: 'manual' }, 'Logowanie Philips');
  jar.take(res);
  const context = new URL(res.headers.get('location') || 'x:/', GIGYA).searchParams.get('context');
  if (!context) throw new PhilipsError(`Logowanie Philips: brak kontekstu (HTTP ${res.status}).`);
  const ids = await gigya('socialize.getIDs', { includeTicket: 'true' }, jar);
  if (!ids.gmidTicket) throw new PhilipsError('Logowanie Philips: brak biletu sesji.');
  res = await call(`${ISSUER}/authorize/continue?${new URLSearchParams({ context, login_token: loginToken, gmidTicket: ids.gmidTicket, client_id: CLIENT_ID })}`, { redirect: 'manual', headers: { Cookie: jar.header() } }, 'Logowanie Philips');
  const loc = new URL(res.headers.get('location') || 'x:/', GIGYA).searchParams;
  if (loc.get('errorMessage')) throw new PhilipsError(`Logowanie Philips: ${loc.get('errorMessage')}. Zaloguj się raz w aplikacji HomeID i spróbuj ponownie.`);
  const code = loc.get('code');
  if (!code) throw new PhilipsError(`Logowanie Philips: brak kodu autoryzacji (HTTP ${res.status}).`);
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
}

async function tokenRequest(form) {
  const res = await call(`${ISSUER}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, ...form }) }, 'Logowanie Philips');
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    const rejected = res.status === 401 || ['invalid_grant', 'invalid_token'].includes(data.error);
    throw new PhilipsError(rejected ? 'Philips odrzucił logowanie: połącz ekspres ponownie w module Kawa.' : `Logowanie Philips: błąd ${data.error_description || data.error || res.status}.`, rejected ? 401 : res.status);
  }
  return data;
}

let cached = null; // { token, exp }
let refreshing = null;

function remember(t) {
  const d = memory.load();
  d.philips = { ...(d.philips || {}), refresh: t.refresh_token || d.philips?.refresh, ...(t.id_token && { idToken: t.id_token }), at: Date.now() };
  memory.save(d);
  cached = { token: t.access_token, exp: Date.now() + ((Number(t.expires_in) || 300) - 30) * 1000 };
}

/** Krok 2: kod z e-maila -> tokeny, id uzytkownika IoT i lista urzadzen. */
export async function verifyCode(email, code) {
  const e = String(email || '').trim().toLowerCase();
  const p = pending.get(e);
  if (!p || Date.now() - p.at > 15 * 60000) throw new PhilipsError('Kod wygasł albo nie był wysłany: wyślij nowy.');
  const data = await gigya('accounts.auth.otp.email.login', { email: e, code: String(code || '').trim(), vToken: p.vToken });
  if (data.errorCode === 206001) throw new PhilipsError('To konto nie jest w pełni zarejestrowane w Philips HomeID: zaloguj się raz w aplikacji HomeID.');
  if (data.errorCode !== 0) throw new PhilipsError(`Zły kod: ${data.errorMessage || data.errorCode}.`);
  const session = data.sessionInfo?.cookieValue;
  if (!session) throw new PhilipsError('Logowanie Philips: brak sesji.');
  pending.delete(e);
  remember(await oidcFromSession(session));
  const d = memory.load();
  d.philips.email = e;
  const id = await iot('/user/self/get-id', { method: 'POST', body: JSON.stringify({ idToken: d.philips.idToken }) });
  d.philips.userId = String(id?.userId || '');
  memory.save(d);
  return listDevices();
}

async function accessToken(force = false) {
  if (!force && cached && Date.now() < cached.exp) return cached.token;
  if (!refreshing) {
    refreshing = (async () => {
      const refresh = auth()?.refresh;
      if (!refresh) throw new PhilipsError('Ekspres niepołączony: zaloguj się w module Kawa.', 401);
      try {
        remember(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }));
      } catch (e) {
        if (e.status === 401) disconnect();
        throw e;
      }
      return cached.token;
    })().finally(() => (refreshing = null));
  }
  return refreshing;
}

export function disconnect() {
  const d = memory.load();
  delete d.philips;
  memory.save(d);
  cached = null;
  closeSession();
}

async function iot(path, opts = {}, retried = false) {
  const res = await call(`${IOT}${path}`, { ...opts, headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json', ...(opts.body && { 'Content-Type': 'application/json' }) } }, 'Chmura Philips');
  if ((res.status === 401 || res.status === 403) && !retried) {
    cached = null;
    await accessToken(true);
    return iot(path, opts, true);
  }
  if (!res.ok) throw new PhilipsError(`Chmura Philips: błąd ${res.status}.`, res.status);
  return res.json().catch(() => null);
}

/** Urzadzenia konta; ekspres z thingName (FUSION) zapisany jako wybrany, gdy jest jeden. */
export async function listDevices() {
  const data = await iot('/user/self/device');
  const list = (Array.isArray(data) ? data : data?.devices || data?.data || data?.items || []).filter((x) => x && x.thingName);
  const devices = list.map((x) => ({ thingName: String(x.thingName), id: String(x.id || ''), name: String(x.friendlyName || x.name || x.ctn || 'Urządzenie'), ctn: String(x.ctn || '') }));
  const d = memory.load();
  if (d.philips) {
    d.philips.devices = devices;
    if (!d.philips.device && devices.length === 1) d.philips.device = devices[0];
  }
  memory.save(d);
  return devices;
}
export function chooseDevice(thingName) {
  const d = memory.load();
  const dev = (d.philips?.devices || []).find((x) => x.thingName === thingName);
  if (!d.philips || !dev) throw new PhilipsError('Nie ma takiego urządzenia na koncie.');
  closeSession();
  d.philips.device = dev;
  memory.save(d);
  return d.philips.device;
}

// ---------- MQTT ----------

const NCP_STATUS = { 0: 'ok', 1: 'zajęty', 2: 'błąd JSON', 7: 'nieznane polecenie', 8: 'zły port', 9: 'port tylko do odczytu', 11: 'błąd danych', 12: 'błąd MQTT' };

let sessionP = null;
let idleTimer = null;
let mqttLib = null;
/** Testy: wlasny "connect" zamiast mqtt.js (atrapa brokera). */
export function _setMqttConnect(fn) {
  mqttLib = fn ? { connect: fn } : null;
}

export function closeSession() {
  clearTimeout(idleTimer);
  const p = sessionP;
  sessionP = null;
  p?.then((s) => s.end()).catch(() => {});
}

async function openSession() {
  const a = auth();
  const thing = a?.device?.thingName;
  if (!a?.refresh || !thing) throw new PhilipsError('Ekspres niepołączony: zaloguj się i wybierz ekspres w module Kawa.');
  const token = await accessToken();
  const sig = await iot('/user/self/signature');
  if (!sig?.signature) throw new PhilipsError('Chmura Philips nie dała podpisu połączenia.');
  if (!a.userId) {
    const id = await iot('/user/self/get-id', { method: 'POST', body: JSON.stringify({ idToken: a.idToken }) });
    memory.load().philips.userId = String(id?.userId || '');
  }
  const lib = mqttLib || (await import('mqtt')).default;
  const topics = {
    shadowGet: `$aws/things/${thing}/shadow/get`,
    shadowUpdate: `$aws/things/${thing}/shadow/update`,
    toNcp: `${TENANT}_ctrl/${thing}/to_ncp`,
    fromNcp: `${TENANT}_ctrl/${thing}/from_ncp`,
  };
  const client = lib.connect(`wss://${MQTT_HOST}:443/mqtt`, {
    clientId: `${memory.load().philips.userId}_${crypto.randomUUID()}`,
    protocolVersion: 4,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 0,
    connectTimeout: 10000,
    // Jak aplikacja: tylko naglowki autoryzacji, bez Origin (autoryzator AWS go odrzuca).
    wsOptions: { perMessageDeflate: false, headers: { 'x-amz-customauthorizer-name': 'CustomAuthorizer', 'x-amz-customauthorizer-signature': sig.signature, 'token-header': `Bearer ${token}`, tenant: TENANT, 'content-type': 'application/json' } },
  });
  const waiting = new Map(); // cid -> resolve
  const shadowWait = [];
  const s = {
    reported: null,
    ports: {},
    end: () => client.end(true),
    publish: (topic, body) => new Promise((resolve, reject) => client.publish(topic, typeof body === 'string' ? body : JSON.stringify(body), { qos: 1 }, (err) => (err ? reject(err) : resolve()))),
  };
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new PhilipsError('Nie mogę połączyć się z ekspresem przez chmurę Philips (przekroczony czas).')), 15000);
    client.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    client.once('error', (e) => {
      clearTimeout(t);
      reject(new PhilipsError(`Chmura Philips odrzuciła połączenie: ${e.message}`));
    });
  });
  client.on('close', () => {
    s.closed = true;
  });
  client.on('message', (topic, buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString() || '{}');
    } catch {
      return;
    }
    if (topic === `${topics.shadowGet}/accepted` || topic === `${topics.shadowUpdate}/accepted`) {
      if (msg.state?.reported) s.reported = { ...(s.reported || {}), ...msg.state.reported };
      shadowWait.splice(0).forEach((f) => f(s.reported));
      return;
    }
    if (topic === topics.fromNcp) {
      const port = msg.data?.portName;
      if (port && msg.data?.properties && (msg.status == null || msg.status === 0)) s.ports[port] = { ...(s.ports[port] || {}), ...msg.data.properties };
      if (msg.cid && msg.type !== 'event' && waiting.has(msg.cid)) {
        waiting.get(msg.cid)(msg);
        waiting.delete(msg.cid);
      }
    }
  });
  await new Promise((resolve, reject) => client.subscribe([`${topics.shadowGet}/accepted`, `${topics.shadowUpdate}/accepted`, `${topics.shadowGet}/rejected`, `${topics.shadowUpdate}/rejected`, topics.fromNcp], { qos: 0 }, (err) => (err ? reject(new PhilipsError(`Subskrypcja MQTT: ${err.message}`)) : resolve())));

  /** Polecenie NCP i odpowiedz z tym samym cid (zajety: do 3 powtorek jak aplikacja). */
  s.ncp = async (cn, portName, properties, timeout = 10000) => {
    for (let attempt = 0; ; attempt++) {
      const cid = crypto.randomBytes(4).toString('hex');
      const reply = new Promise((resolve) => {
        waiting.set(cid, resolve);
        setTimeout(() => {
          if (waiting.delete(cid)) resolve(null);
        }, timeout);
      });
      await s.publish(topics.toNcp, { cid, time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), type: 'command', cn, ct: 'mobile', ...(portName && { data: { portName, ...(properties && { properties }) } }) });
      const r = await reply;
      if (r?.status === 1 && attempt < 3) {
        await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 700));
        continue;
      }
      return r;
    }
  };
  s.getPort = async (port) => {
    const r = await s.ncp('getPort', port);
    if (r && r.status !== 0 && r.status != null) throw new PhilipsError(`Ekspres: ${NCP_STATUS[r.status] || r.status} (port ${port}).`);
    return s.ports[port] || r?.data?.properties || null;
  };
  s.setPort = async (port, properties) => {
    const r = await s.ncp('setPort', port, properties);
    if (!r) return { ok: true, timeout: true }; // odpowiedz QoS0 mogla zginac, a polecenie dojsc
    return { ok: r.status === 0, status: r.status, name: NCP_STATUS[r.status] || String(r.status) };
  };
  s.shadow = (timeout = 8000) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(s.reported), timeout);
    shadowWait.push((v) => {
      clearTimeout(t);
      resolve(v);
    });
    s.publish(topics.shadowGet, '{}').catch(() => {});
  });
  s.setPower = (on) => s.publish(topics.shadowUpdate, { state: { desired: { powerOn: Boolean(on) } } });
  return s;
}

/** Wspolna sesja na kilka polecen z rzedu; zamykana po minucie bezczynnosci. */
export async function withSession(fn) {
  if (sessionP) {
    const old = await sessionP.catch(() => null);
    if (!old || old.closed) sessionP = null;
  }
  if (!sessionP) {
    sessionP = openSession();
    sessionP.catch(() => (sessionP = null));
  }
  const s = await sessionP;
  clearTimeout(idleTimer);
  try {
    return await fn(s);
  } finally {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closeSession, 60000);
  }
}

// ---------- ekspres ----------

/** profileId (pole 1, varint) z zakodowanego protobufem profilu z portu Profiles. */
export function profileIdFromBlob(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  let i = 0;
  const varint = () => {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (i >= buf.length) return null;
      const b = buf[i++];
      v += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return v;
      shift += 7;
      if (shift > 49) return null;
    }
  };
  while (i < buf.length) {
    const key = varint();
    if (key == null) return null;
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      const v = varint();
      if (v == null) return null;
      if (field === 1) return v || null;
    } else if (wire === 2) {
      const len = varint();
      if (len == null) return null;
      i += len;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else return null;
  }
  return null;
}

export const MACHINE_STATE = { 0: 'gotowy', 1: 'parzy', 2: 'wymaga działania', 3: 'błąd' };
export const EXTRA_INFO = {
  1: 'brak ziaren', 2: 'brak wody', 3: 'pełny pojemnik na fusy', 4: 'brak zaparzacza', 5: 'zbiornik na wodę do wyjęcia', 6: 'wyjęta tacka ociekowa', 7: 'otwarte drzwiczki', 8: 'wyjęty pojemnik na fusy',
  20: 'przerwane przez użytkownika', 21: 'przerwane: uzupełnij', 22: 'awaria grzałki', 23: 'awaria zaparzacza', 24: 'awaria młynka',
};
export const CTRL_STATUS = { 3: 'nieprawidłowe polecenie', 50: 'ten ekspres nie ma takiego napoju', 51: 'ekspres zajęty', 52: 'ekspres w stanie alarmu', 103: 'nie wybrano przepisu', 106: 'nieprawidłowy profil' };

/** Stan ekspresu: cien (zasilanie, polaczenie) i port Status (stan maszyny, alarmy, sesja parzenia). */
export async function machineStatus() {
  return withSession(async (s) => {
    const shadow = (await s.shadow()) || {};
    let st = {};
    try {
      st = (await s.getPort('Status')) || {};
    } catch {
      /* wylaczony ekspres nie odpowiada na porty */
    }
    return statusFrom(shadow, st);
  });
}

export function statusFrom(shadow = {}, st = {}) {
  const mc = Number(st.McState ?? 0);
  const extra = Number(st.McExInfo ?? 0);
  const problems = [];
  if (shadow.connected === false) problems.push('ekspres jest offline (brak Wi-Fi albo odłączony)');
  if (mc === 1) problems.push('ekspres właśnie parzy');
  if (mc === 3) problems.push('ekspres zgłasza błąd');
  if (EXTRA_INFO[extra] && extra < 20) problems.push(EXTRA_INFO[extra]);
  else if (extra >= 40) problems.push(`błąd ekspresu (kod ${extra})`);
  if (mc === 2 && !(EXTRA_INFO[extra] && extra < 20)) problems.push('ekspres wymaga działania (sprawdź wyświetlacz)');
  if (shadow.productError && String(shadow.productError) !== '0') problems.push(`błąd ekspresu (${shadow.productError})`);
  return {
    online: shadow.connected !== false,
    powerOn: shadow.powerOn === true,
    productState: shadow.productState || '',
    state: MACHINE_STATE[mc] || String(mc),
    brewing: mc === 1,
    extra: EXTRA_INFO[extra] || (extra ? `kod ${extra}` : ''),
    ctrl: CTRL_STATUS[Number(st.CtrlStatus)] || '',
    session: Number(st.SesOwnId) || 0,
    problems,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Parzenie wbudowanego napoju (polecenie REMOTE_BREW = 1). Wylaczony ekspres najpierw sie wlacza; dopoki
 * sie nagrzewa i odpowiada "zajety", polecenie jest ponawiane (do ok. 2,5 minuty).
 */
export async function brew(drinkId, { profileSlot = 0, wait = sleep, maxMs = 150000 } = {}) {
  return withSession(async (s) => {
    const shadow = (await s.shadow()) || {};
    if (shadow.connected === false) throw new PhilipsError('Ekspres jest offline.');
    let warmed = false;
    if (shadow.powerOn === false) {
      await s.setPower(true);
      warmed = true;
      await wait(8000);
    }
    // Swiezo wlaczony ekspres odpowiada na porty dopiero po chwili.
    let profileId = null;
    for (const t0 = Date.now(); ; ) {
      const profiles = (await s.getPort('Profiles').catch(() => null)) || {};
      profileId = profileIdFromBlob(profiles[`profile${profileSlot}`]);
      if (profileId || !warmed || Date.now() - t0 > 60000) break;
      await wait(5000);
    }
    if (!profileId) throw new PhilipsError(`W ekspresie nie ma profilu nr ${profileSlot + 1}: wybierz inny w module Kawa.`);
    const started = Date.now();
    for (;;) {
      const r = await s.setPort('Control', { CtrlCmd: 1, SesOwnId: crypto.randomInt(10, 2 ** 31 - 10), Profile_id: profileId, Recipe_id: Number(drinkId) });
      if (!r.ok) throw new PhilipsError(`Ekspres nie przyjął polecenia: ${r.name}.`);
      // Wynik na poziomie maszyny przychodzi w porcie Status (CtrlStatus, McState).
      let st = {};
      for (let i = 0; i < 4; i++) {
        await wait(2500);
        st = (await s.getPort('Status').catch(() => null)) || {};
        if (Number(st.McState) === 1 || [50, 51, 52, 3, 106].includes(Number(st.CtrlStatus))) break;
      }
      const ctrl = Number(st.CtrlStatus);
      if (Number(st.McState) === 1) return { ok: true, warmed };
      if (ctrl === 51 && Date.now() - started < maxMs) {
        await wait(10000); // nagrzewa sie albo plucze: jeszcze raz
        continue;
      }
      if (ctrl && CTRL_STATUS[ctrl]) throw new PhilipsError(`Ekspres: ${CTRL_STATUS[ctrl]}${ctrl === 52 && EXTRA_INFO[Number(st.McExInfo)] ? ` (${EXTRA_INFO[Number(st.McExInfo)]})` : ''}.`);
      // Bez potwierdzenia parzenia: polecenie doszlo, ale nie wiemy, czy ruszylo.
      return { ok: true, unconfirmed: true, warmed };
    }
  });
}

/** Przerwanie parzenia (ABORT_BREW = 4) z biezaca sesja z portu Status. */
export async function abortBrew() {
  return withSession(async (s) => {
    const st = (await s.getPort('Status').catch(() => null)) || {};
    const r = await s.setPort('Control', { CtrlCmd: 4, SesOwnId: Number(st.SesOwnId) || crypto.randomInt(10, 2 ** 31 - 10) });
    if (!r.ok) throw new PhilipsError(`Ekspres nie przyjął przerwania: ${r.name}.`);
    return { ok: true };
  });
}

export async function setPower(on) {
  return withSession(async (s) => {
    await s.setPower(on);
    return { ok: true };
  });
}

// Napoje wbudowane (RitaDrinkId) z polskimi nazwami do glosu.
export const DRINKS = [
  { id: 2, name: 'Espresso', words: ['espresso'] },
  { id: 1, name: 'Ristretto', words: ['ristretto'] },
  { id: 4, name: 'Espresso Lungo', words: ['lungo', 'dlugie espresso'] },
  { id: 5, name: 'Podwójne espresso', words: ['podwojne espresso', 'doppio', 'double'] },
  { id: 7, name: 'Kawa (Caffè Crema)', words: ['kawa', 'czarna kawa', 'crema', 'kawe'] },
  { id: 8, name: 'Americano', words: ['americano', 'amerykanska'] },
  { id: 35, name: 'Long Black', words: ['long black'] },
  { id: 10, name: 'Espresso Macchiato', words: ['espresso macchiato'] },
  { id: 11, name: 'Cortado', words: ['cortado'] },
  { id: 14, name: 'Cappuccino', words: ['cappuccino', 'kapuczino', 'kapucino'] },
  { id: 61, name: 'Cappuccino XL', words: ['duze cappuccino', 'cappuccino xl'] },
  { id: 24, name: 'Cappuccino włoskie', words: ['wloskie cappuccino'] },
  { id: 15, name: 'Flat White', words: ['flat white'] },
  { id: 16, name: 'Caffè Latte', words: ['latte', 'caffe latte', 'kawa latte'] },
  { id: 19, name: 'Latte Macchiato', words: ['latte macchiato'] },
  { id: 17, name: 'Kawa z mlekiem (Café au Lait)', words: ['kawa z mlekiem', 'au lait', 'biala kawa'] },
  { id: 42, name: 'Piccolo Latte', words: ['piccolo'] },
  { id: 13, name: 'Mélange', words: ['melange'] },
  { id: 20, name: 'Spienione mleko', words: ['spienione mleko', 'pianka', 'mleko'] },
  { id: 21, name: 'Gorąca woda', words: ['goraca woda', 'woda', 'wrzatek'] },
];
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').trim();
/** Napoj z nazwy po polsku albo z numeru; najdluzsze dopasowanie wygrywa ("latte macchiato" przed "latte"). */
export function findDrink(q) {
  if (Number.isInteger(Number(q)) && DRINKS.some((d) => d.id === Number(q))) return DRINKS.find((d) => d.id === Number(q));
  const t = fold(q);
  if (!t) return null;
  let best = null;
  for (const d of DRINKS) {
    for (const w of [fold(d.name), ...d.words]) {
      if ((t === w || t.includes(w)) && (!best || w.length > best.len)) best = { d, len: w.length };
    }
  }
  return best?.d || null;
}
