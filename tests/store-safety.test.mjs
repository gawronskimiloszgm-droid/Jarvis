import test from 'node:test';
import assert from 'node:assert/strict';

// Zdalny magazyn atakowany atrapa fetch: najgorszy scenariusz to pusta pamiec nadpisujaca prawdziwe dane.
process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'x';
process.env.JARVIS_STORE_RETRY_MS = '1';
const realFetch = globalThis.fetch;
const remote = { value: JSON.stringify({ facts: ['wazny fakt'] }), failReads: 0, failWrites: false, writes: 0 };
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('/get/')) {
    if (remote.failReads > 0) {
      remote.failReads--;
      return new Response('blad', { status: 500 });
    }
    return new Response(JSON.stringify({ result: remote.value }), { status: 200 });
  }
  if (remote.failWrites) return new Response('za duze', { status: 413 });
  remote.writes++;
  remote.value = opts.body;
  return new Response('{}', { status: 200 });
};
const { readStore, writeStore, storeStatus, retryRemoteRead } = await import('../server/core/store.js');
const { pruneSnapshots } = await import('../server/extras/backupplus.js');

test.after(() => {
  globalThis.fetch = realFetch;
});

test('chwilowy blad odczytu: ponowna proba i prawdziwe dane', async () => {
  remote.failReads = 2;
  const d = await readStore();
  assert.deepEqual(d.facts, ['wazny fakt']);
  assert.equal(storeStatus().readFailed, false);
});

test('trwaly blad odczytu: zapis zdalny zablokowany, dane nie zostaja nadpisane', async () => {
  remote.failReads = 99;
  await readStore();
  assert.equal(storeStatus().readFailed, true);
  const before = remote.value;
  await writeStore({ facts: [] });
  assert.equal(remote.value, before, 'pusta pamiec nie moze nadpisac magazynu');
  assert.ok(storeStatus().blockedWrites >= 1);
  // magazyn wraca: dane sie odzyskuja, a zapis znow dziala
  remote.failReads = 0;
  const back = await retryRemoteRead();
  assert.deepEqual(back.facts, ['wazny fakt']);
  assert.equal(storeStatus().readFailed, false);
  await writeStore({ facts: ['nowy'] });
  assert.match(remote.value, /nowy/);
});

test('nieudany zapis jest widoczny w stanie, udany go czysci', async () => {
  remote.failWrites = true;
  await writeStore({ facts: ['x'] });
  const st = storeStatus();
  assert.equal(st.lastWriteOk, false);
  assert.match(st.lastError, /413/);
  remote.failWrites = false;
  await writeStore({ facts: ['x'] });
  assert.equal(storeStatus().lastWriteOk, true);
  assert.equal(storeStatus().lastError, null);
  assert.ok(storeStatus().lastSize > 0);
});

test('retencja kopii: 7 dni, 4 tygodnie, reczne osobno', () => {
  const DAY = 86400000;
  const now = 2000 * DAY;
  const list = Array.from({ length: 40 }, (_, i) => ({ name: `d${i}`, kind: 'auto', at: now - i * DAY }));
  list.push(...Array.from({ length: 7 }, (_, i) => ({ name: `m${i}`, kind: 'manual', at: now - i * DAY })));
  const drop = pruneSnapshots(list);
  const kept = list.filter((s) => !drop.includes(s.name));
  assert.equal(kept.filter((s) => s.kind === 'manual').length, 5);
  const auto = kept.filter((s) => s.kind === 'auto');
  assert.equal(auto.length, 11);
  for (let i = 0; i < 7; i++) assert.ok(auto.some((s) => s.name === `d${i}`), `brak d${i}`);
});
