import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const memory = await import('../server/memory/memory.js');
const P = await import('../server/connect/philips.js');
const K = await import('../server/extras/kawa.js');
const { runLifeTool, LIFE_TOOL_NAMES } = await import('../server/extras/lifevoice.js');

const before = JSON.parse(JSON.stringify(memory.load()));
delete memory.load().philips;
delete memory.load().kawa;
memory.load().life = {};
after(() => {
  P.closeSession();
  memory.save(before);
});

// 12:00 w Warszawie (zima, UTC+1)
const NOON = Date.UTC(2026, 10, 20, 11, 0);

test('napoje po polsku, najdluzsze dopasowanie wygrywa', () => {
  assert.equal(P.findDrink('zrób mi kawę').id, 7);
  assert.equal(P.findDrink('poproszę latte macchiato').id, 19);
  assert.equal(P.findDrink('latte').id, 16);
  assert.equal(P.findDrink('kapuczino').id, 14);
  assert.equal(P.findDrink('podwójne espresso').id, 5);
  assert.equal(P.findDrink(21).name, 'Gorąca woda');
  assert.equal(P.findDrink('herbata'), null);
});

test('profileId z protobufu profilu (pole 1 po innych polach)', () => {
  // pole 2 (dlugosc 3: "abc"), potem pole 1 = 300 (varint 0xAC 0x02)
  const blob = Buffer.from([0x12, 0x03, 0x61, 0x62, 0x63, 0x08, 0xac, 0x02]).toString('base64');
  assert.equal(P.profileIdFromBlob(blob), 300);
  assert.equal(P.profileIdFromBlob(Buffer.from([0x08, 0x00]).toString('base64')), null, 'zero to pusty profil');
  assert.equal(P.profileIdFromBlob(''), null);
});

test('stan ekspresu: alarmy po polsku', () => {
  assert.deepEqual(P.statusFrom({ connected: true, powerOn: true }, { McState: 0 }).problems, []);
  assert.deepEqual(P.statusFrom({ connected: true, powerOn: true }, { McState: 2, McExInfo: 2 }).problems, ['brak wody']);
  assert.deepEqual(P.statusFrom({ connected: true }, { McState: 1 }).problems, ['ekspres właśnie parzy']);
  assert.match(P.statusFrom({ connected: false }, {}).problems[0], /offline/);
});

test('limity: cisza nocna, odstep, dziennie', () => {
  const s = { perDay: 2, gapS: 90, quietFrom: '23:00', quietTo: '05:00' };
  assert.equal(K.limitReason(NOON, s, []), '');
  assert.match(K.limitReason(Date.UTC(2026, 10, 20, 23, 30), s, []), /cisza nocna/); // 00:30 w Warszawie
  assert.match(K.limitReason(NOON, s, [{ at: NOON - 30000, day: '2026-11-20', ok: true }]), /odczekaj 60 s/);
  const two = [{ at: NOON - 7200000, day: '2026-11-20', ok: true }, { at: NOON - 3600000, day: '2026-11-20', ok: true }];
  assert.match(K.limitReason(NOON, s, two), /dzienny limit 2/);
  assert.equal(K.limitReason(NOON, s, [{ at: NOON - 30000, day: '2026-11-20', ok: false }]), '', 'nieudane sie nie licza');
});

test('dwa kroki: glos tylko przygotowuje, parzy dopiero potwierdzenie z ekranu, zlecenie jednorazowe', async () => {
  assert.match((await runLifeTool('kawa', { napoj: 'cappuccino' })).error, /niepołączony/);
  memory.load().philips = { refresh: 'r', device: { thingName: 'thing-1', name: 'Ekspres' }, userId: 'u-1' };
  assert.ok(['kawa', 'kawa_stop', 'ekspres'].every((n) => LIFE_TOOL_NAMES.includes(n)));
  assert.ok(!LIFE_TOOL_NAMES.some((n) => /potwierd|confirm|zaparz/.test(n)), 'zadne narzedzie nie potwierdza');
  let brewed = 0;
  const brewFn = async () => {
    brewed++;
    return { ok: true };
  };
  const v = await runLifeTool('kawa', { napoj: 'cappuccino' });
  assert.equal(v.czeka_na_potwierdzenie, true);
  assert.equal(v.klient.action, 'kawa-potwierdz');
  assert.equal(brewed, 0);
  // Alarm w ekspresie blokuje parzenie.
  const id1 = K.prepare('brew', 'espresso', NOON).id;
  const bad = await K.confirm(id1, { now: NOON, brewFn, statusFn: async () => P.statusFrom({ connected: true, powerOn: true }, { McState: 2, McExInfo: 1 }) });
  assert.match(bad.error, /Nie parzę: brak ziaren/);
  assert.equal(brewed, 0);
  const id2 = K.prepare('brew', 'latte', NOON).id;
  const ok = await K.confirm(id2, { now: NOON, brewFn, statusFn: async () => P.statusFrom({ connected: true, powerOn: true }, { McState: 0 }) });
  assert.equal(ok.ok, true);
  assert.match(ok.text, /Parzę: Caffè Latte/);
  assert.equal(brewed, 1);
  assert.match((await K.confirm(id2, { now: NOON, brewFn })).error, /wygasło albo zostało już użyte/);
  // Wygasle zlecenie.
  const id3 = K.prepare('brew', 'kawa', NOON + 200000).id;
  assert.match((await K.confirm(id3, { now: NOON + 200000 + 91000, brewFn })).error, /wygasło/);
  // Zaraz po kawie: limit odstepu juz przy przygotowaniu.
  assert.match(K.prepare('brew', 'kawa', NOON + 20000).error, /odczekaj/);
  assert.match(memory.load().life.journal[0].text, /Kawa: Caffè Latte/);
  // Wylaczony ekspres nie odpowiada na port Status: to nie blokuje (parzenie go wlaczy).
  const id4 = K.prepare('brew', 'kawa', NOON + 600000).id;
  const off = await K.confirm(id4, { now: NOON + 600000, brewFn, statusFn: async () => P.statusFrom({ connected: true, powerOn: false }, { McState: 2 }) });
  assert.equal(off.ok, true);
  assert.equal(memory.load().kawa.log.filter((x) => x.ok).length, 2);
  assert.equal(memory.load().kawa.log.filter((x) => !x.ok).length, 1);
  delete memory.load().philips;
});

const res = (status, body, headers = {}) => ({ status, ok: status < 300, headers: new Headers(headers), json: async () => body });

test('logowanie kodem z e-maila: OTP, pasywne OIDC z PKCE i ciasteczkami, id IoT, urzadzenia', async () => {
  const seen = {};
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const form = opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : null;
    if (u.pathname === '/accounts.auth.otp.email.sendCode') return res(200, { errorCode: 0, vToken: 'vt' });
    if (u.pathname === '/accounts.auth.otp.email.login') {
      assert.equal(form.vToken, 'vt');
      return form.code === '123456' ? res(200, { errorCode: 0, sessionInfo: { cookieValue: 'sess' } }) : res(200, { errorCode: 403042, errorMessage: 'Invalid code' });
    }
    if (u.pathname.endsWith('/authorize')) {
      seen.challenge = u.searchParams.get('code_challenge');
      assert.equal(u.searchParams.get('prompt'), 'none');
      assert.equal(opts.redirect, 'manual');
      return res(302, {}, { location: 'https://cdc.accounts.home.id/pages/login?context=ctx1', 'set-cookie': 'gmid=G1; Path=/' });
    }
    if (u.pathname === '/socialize.getIDs') {
      assert.match(opts.headers.Cookie, /gmid=G1/);
      return res(200, { gmidTicket: 'tk' });
    }
    if (u.pathname.endsWith('/authorize/continue')) {
      assert.deepEqual([u.searchParams.get('context'), u.searchParams.get('login_token'), u.searchParams.get('gmidTicket')], ['ctx1', 'sess', 'tk']);
      return res(302, {}, { location: 'com.philips.ka.oneka.app.prod://oauthredirect?code=CODE1' });
    }
    if (u.pathname.endsWith('/token')) {
      if (form.grant_type === 'authorization_code') {
        const expect = crypto.createHash('sha256').update(form.code_verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        assert.equal(expect, seen.challenge, 'PKCE');
        assert.equal(form.code, 'CODE1');
      }
      return res(200, { access_token: 'AT', id_token: 'IDT', refresh_token: 'RT', expires_in: 300 });
    }
    if (u.pathname === '/api/da/user/self/get-id') {
      assert.equal(JSON.parse(opts.body).idToken, 'IDT');
      return res(200, { userId: 'user-uuid' });
    }
    if (u.pathname === '/api/da/user/self/device') return res(200, [{ thingName: 'thing-8000', id: 'd1', friendlyName: 'Ekspres w kuchni', ctn: 'EP8757' }, { id: 'bez-thing' }]);
    if (u.pathname === '/api/da/user/self/signature') return res(200, { signature: 'SIG' });
    return res(404, {});
  };
  await assert.rejects(P.verifyCode('a@b.pl', '1'), /wygasł albo nie był wysłany/);
  await P.sendCode('Ja@Example.com');
  await assert.rejects(P.verifyCode('ja@example.com', '000000'), /Zły kod/);
  await P.sendCode('ja@example.com');
  const devices = await P.verifyCode('ja@example.com', '123456');
  assert.deepEqual(devices.map((d) => d.thingName), ['thing-8000']);
  const a = memory.load().philips;
  assert.equal(a.refresh, 'RT');
  assert.equal(a.userId, 'user-uuid');
  assert.equal(a.device.thingName, 'thing-8000', 'jedyny ekspres wybrany sam');
  assert.equal(P.isConnected(), true);
});

/** Atrapa brokera: cien, porty Status i Profiles, polecenia na porcie Control. */
function fakeBroker() {
  const b = { connects: [], commands: [], mc: 0, powerOn: false };
  const profile = Buffer.from([0x08, 0x2a]).toString('base64'); // profileId 42
  b.connect = (url, opts) => {
    b.connects.push({ url, opts });
    const c = new EventEmitter();
    const reply = (topic, obj) => setImmediate(() => c.emit('message', topic, Buffer.from(JSON.stringify(obj))));
    c.subscribe = (topics, o, cb) => {
      b.topics = topics;
      cb(null);
    };
    c.end = () => c.emit('close');
    c.publish = (topic, payload, o, cb) => {
      cb(null);
      const msg = JSON.parse(payload || '{}');
      if (topic.endsWith('/shadow/get')) reply(`${topic}/accepted`, { state: { reported: { connected: true, powerOn: b.powerOn, productState: b.powerOn ? 'idle' : 'standby' } } });
      if (topic.endsWith('/shadow/update')) {
        b.powerOn = msg.state.desired.powerOn;
        reply(`${topic}/accepted`, { state: { reported: { powerOn: b.powerOn } } });
      }
      if (topic.endsWith('/to_ncp')) {
        const from = topic.replace('to_ncp', 'from_ncp');
        b.commands.push(msg);
        if (msg.cn === 'getPort' && msg.data.portName === 'Status') reply(from, { cid: msg.cid, type: 'response', status: 0, data: { portName: 'Status', properties: { McState: b.mc, McExInfo: 0, CtrlStatus: b.ctrl ?? 2, SesOwnId: b.ses || 0 } } });
        if (msg.cn === 'getPort' && msg.data.portName === 'Profiles') reply(from, { cid: msg.cid, type: 'response', status: 0, data: { portName: 'Profiles', properties: b.powerOn ? { profile0: profile } : {} } });
        if (msg.cn === 'setPort' && msg.data.portName === 'Control') {
          const p = msg.data.properties;
          if (p.CtrlCmd === 1 && ![51, 52].includes(b.ctrl)) {
            b.mc = 1;
            b.ses = p.SesOwnId;
          }
          if (p.CtrlCmd === 4) b.mc = 0;
          reply(from, { cid: msg.cid, type: 'response', status: 0, data: { portName: 'Control' } });
        }
      }
    };
    setImmediate(() => c.emit('connect'));
    return c;
  };
  return b;
}

test('parzenie przez MQTT: naglowki autoryzatora, wlaczenie, profil z portu Profiles, polecenie i potwierdzenie, stop', async () => {
  const b = fakeBroker();
  P._setMqttConnect(b.connect);
  const waits = [];
  const r = await P.brew(14, { wait: async (ms) => waits.push(ms) });
  assert.deepEqual(r, { ok: true, warmed: true });
  const c = b.connects[0];
  assert.equal(c.url, 'wss://ats.prod.eu-da.iot.versuni.com:443/mqtt');
  assert.match(c.opts.clientId, /^user-uuid_[0-9a-f-]{36}$/);
  assert.equal(c.opts.wsOptions.perMessageDeflate, false);
  assert.deepEqual(c.opts.wsOptions.headers, { 'x-amz-customauthorizer-name': 'CustomAuthorizer', 'x-amz-customauthorizer-signature': 'SIG', 'token-header': 'Bearer AT', tenant: 'da', 'content-type': 'application/json' });
  assert.ok(b.topics.includes('da_ctrl/thing-8000/from_ncp'));
  const brewCmd = b.commands.find((m) => m.cn === 'setPort');
  assert.equal(brewCmd.type, 'command');
  assert.equal(brewCmd.ct, 'mobile');
  assert.deepEqual({ ...brewCmd.data.properties, SesOwnId: 0 }, { CtrlCmd: 1, SesOwnId: 0, Profile_id: 42, Recipe_id: 14 });
  assert.ok(b.powerOn, 'wylaczony ekspres zostal wlaczony');
  const st = await P.machineStatus();
  assert.equal(st.brewing, true);
  assert.equal(st.state, 'parzy');
  await P.abortBrew();
  const stop = b.commands.filter((m) => m.cn === 'setPort').pop();
  assert.equal(stop.data.properties.CtrlCmd, 4);
  assert.equal(stop.data.properties.SesOwnId, brewCmd.data.properties.SesOwnId, 'stop w tej samej sesji parzenia');
  assert.equal(b.connects.length, 1, 'jedna sesja na kilka polecen');
  // Ekspres zajety (nagrzewa sie): ponawia, a gdy nie ruszy, mowi, czemu.
  b.mc = 0;
  b.ctrl = 52;
  const orig = b.connect;
  await assert.rejects(P.brew(2, { wait: async () => {} }), /stanie alarmu/);
  assert.equal(orig, b.connect);
  P._setMqttConnect(null);
});
