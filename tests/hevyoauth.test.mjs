import test, { after } from 'node:test';
import assert from 'node:assert/strict';

// Bez Hevy Pro: logowanie przez wlasna aplikacje OAuth albo eksport CSV.
delete process.env.HEVY_API_KEY;
process.env.HEVY_CLIENT_ID = 'klient';
process.env.HEVY_CLIENT_SECRET = 'sekret';
process.env.HEVY_ARCHIVE_NAME = 'test-hevyoauth';
const memory = await import('../server/memory/memory.js');
const { snapshotDelete } = await import('../server/core/store.js');
const H = await import('../server/connect/hevy.js');
const hevy = await import('../server/extras/hevy.js');
const { lifeList } = await import('../server/extras/life.js');

const before = JSON.parse(JSON.stringify(memory.load()));
memory.load().life = {};
delete memory.load().hevy;
delete memory.load().hevyAuth;
after(async () => {
  await snapshotDelete(process.env.HEVY_ARCHIVE_NAME);
  memory.save(before);
  delete process.env.HEVY_CLIENT_ID;
  delete process.env.HEVY_CLIENT_SECRET;
});

const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });

test('czas z eksportu Hevy w czasie warszawskim (zima i lato, rozne zapisy)', () => {
  assert.equal(new Date(hevy.parseHevyTime('28 Feb 2024, 18:09')).toISOString(), '2024-02-28T17:09:00.000Z');
  assert.equal(new Date(hevy.parseHevyTime('15 Jul 2024, 18:09')).toISOString(), '2024-07-15T16:09:00.000Z');
  assert.equal(new Date(hevy.parseHevyTime('Feb 28, 2024 6:09 PM')).toISOString(), '2024-02-28T17:09:00.000Z');
  assert.equal(new Date(hevy.parseHevyTime('5 paź 2024, 07:30')).toISOString(), '2024-10-05T05:30:00.000Z');
  assert.equal(hevy.parseHevyTime('2024-03-01T10:00:00Z'), Date.parse('2024-03-01T10:00:00Z'));
  assert.equal(hevy.parseHevyTime('wczoraj'), 0);
});

const fmt = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hourCycle: 'h23', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
};
const t1 = Date.now() - 9 * 86400000;
const t2 = Date.now() - 3600000;
const CSV = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
  `"Push, ciężki","${fmt(t1)}","${fmt(t1 + 3600000)}","","Bench Press (Barbell)","","","0","warmup","40","10","","",""`,
  `"Push, ciężki","${fmt(t1)}","${fmt(t1 + 3600000)}","","Bench Press (Barbell)","","notatka ""z cudzysłowem""","1","normal","80","8","","","8"`,
  `"Push, ciężki","${fmt(t1)}","${fmt(t1 + 3600000)}","","Bench Press (Barbell)","","","2","normal","80","7","","",""`,
  `"Push, ciężki","${fmt(t2)}","${fmt(t2 + 3000000)}","","Bench Press (Barbell)","","","0","normal","85","8","","",""`,
  `"Push, ciężki","${fmt(t2)}","${fmt(t2 + 3000000)}","","Treadmill","","","0","normal","","","2.5","900",""`,
].join('\r\n');

test('eksport CSV: treningi, rozgrzewka pominieta, opis najnowszego, drugi import nic nie dubluje', async () => {
  const list = hevy.parseHevyCsv(CSV);
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'Push, ciężki');
  assert.equal(list[0].exercises[0].sets.length, 3);
  assert.equal(list[1].exercises[1].sets[0].distance_meters, 2500);
  const r = await hevy.importCsv(CSV);
  assert.deepEqual([r.inFile, r.added, r.skipped], [2, 2, 0]);
  assert.match(r.opis, /Rekordy: Bench Press \(Barbell\) 85 kg × 8 \(było 80 kg\)/);
  assert.match(r.opis, /Cardio: Treadmill 2,5 km 15 min/);
  assert.equal(lifeList('sets').length, 3, 'bez serii rozgrzewkowej i bez cardio');
  assert.equal(lifeList('sets').find((s) => s.ex === 'Bench Press (Barbell)').mg, undefined);
  const again = await hevy.importCsv(CSV);
  assert.deepEqual([again.added, again.skipped], [0, 2]);
  await assert.rejects(hevy.importCsv('a,b\n1,2'), /eksport treningów z Hevy/);
});

test('OAuth: zgoda, wymiana kodu, zapytania z tokenem, odswiezenie po 401, trening z API zastepuje ten z CSV', async () => {
  assert.equal(H.isConfigured(), false);
  assert.equal(H.oauthConfigured(), true);
  const url = new URL(H.authUrl('https://jarvis.example/api/hevy/oauth/callback'));
  assert.equal(url.origin + url.pathname, 'https://hevy.com/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'klient');
  const state = url.searchParams.get('state');
  await assert.rejects(H.exchangeCode('kod', 'zly-state'), /wygasły stan/);

  const tokenCalls = [];
  let apiAuth = [];
  let expire = false;
  globalThis.fetch = async (u, opts = {}) => {
    const s = String(u);
    if (s === 'https://hevy.com/api/token') {
      const body = Object.fromEntries(new URLSearchParams(String(opts.body)));
      tokenCalls.push(body);
      assert.equal(body.client_secret, 'sekret');
      if (body.grant_type === 'refresh_token' && body.refresh_token === 'zly') return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: `dostep-${tokenCalls.length}`, expires_in: 3600, refresh_token: `odswiez-${tokenCalls.length}`, user_id: 'u1', username: 'eryk' });
    }
    const p = new URL(s);
    apiAuth.push(opts.headers.Authorization);
    assert.equal(opts.headers['api-key'], undefined);
    if (expire) {
      expire = false;
      return json({}, 401);
    }
    if (p.pathname === '/v1/user/info') return json({ data: { name: 'Eryk', is_pro: false } });
    if (p.pathname === '/v1/workouts') return json({ page: 1, page_count: 1, workouts: [{ id: 'api-1', title: 'Push', routine_id: 'r1', start_time: new Date(t2 + 60000).toISOString(), end_time: new Date(t2 + 3000000).toISOString(), exercises: [{ title: 'Bench Press (Barbell)', exercise_template_id: 'B1', sets: [{ type: 'normal', weight_kg: 85, reps: 8 }] }] }] });
    if (p.pathname.startsWith('/v1/exercise_templates/')) return json({ title: 'Bench Press (Barbell)', primary_muscle_group: 'chest' });
    if (p.pathname === '/v1/routines') return json({ page: 1, page_count: 1, routines: [] });
    if (p.pathname === '/v1/body_measurements') return json({ page: 1, page_count: 1, body_measurements: [] });
    return json({}, 404);
  };
  await H.exchangeCode('kod', state);
  assert.equal(tokenCalls[0].grant_type, 'authorization_code');
  assert.equal(tokenCalls[0].redirect_uri, 'https://jarvis.example/api/hevy/oauth/callback');
  assert.equal(memory.load().hevyAuth.refresh, 'odswiez-1');
  assert.equal(H.isConfigured(), true);
  assert.equal(H.mode(), 'oauth');

  const r = await hevy.hevySync();
  assert.equal(r.ok, true);
  assert.ok(apiAuth.every((a) => a === 'Bearer dostep-1'));
  const ws = memory.load().hevy.workouts;
  assert.equal(ws.filter((w) => w.id.startsWith('csv-')).length, 1, 'starszy trening z CSV zostaje');
  assert.ok(ws.some((w) => w.id === 'api-1'), 'ten sam trening z API zastapil wersje z CSV');
  assert.equal(lifeList('sets').filter((s) => s.ex === 'Bench Press (Barbell)' && s.kg === 85).length, 1);

  // Token wygasl wczesniej: jedno odswiezenie i powtorka, nowy token odswiezania zapisany.
  expire = true;
  apiAuth = [];
  await H.userInfo();
  assert.equal(tokenCalls.at(-1).grant_type, 'refresh_token');
  assert.equal(tokenCalls.at(-1).refresh_token, 'odswiez-1');
  assert.equal(memory.load().hevyAuth.refresh, 'odswiez-2');
  assert.deepEqual(apiAuth, ['Bearer dostep-1', 'Bearer dostep-2']);

  // Odrzucony token odswiezania: konto rozlaczone, panel pokaze przycisk polaczenia.
  memory.load().hevyAuth.refresh = 'zly';
  expire = true;
  await assert.rejects(H.userInfo(), /odrzucił logowanie/);
  assert.equal(memory.load().hevyAuth, undefined);
  assert.equal(H.isConfigured(), false);
});
