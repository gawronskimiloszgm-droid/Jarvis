import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SPOTIFY_CLIENT_ID = 'id';
process.env.SPOTIFY_CLIENT_SECRET = 'secret';
process.env.SPOTIFY_REFRESH_TOKEN = 'rt';

const player = await import('../server/connect/spotifyPlayer.js');

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    return handler(String(url), opts);
  };
  return calls;
}
const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

test('spotify: konfiguracja i polaczenie z env', () => {
  assert.equal(player.isConfigured(), true);
  assert.equal(player.isConnected(), true);
});

test('spotify: gra na aktywnym urzadzeniu, a bez aktywnego wybiera komputer', async () => {
  const calls = mockFetch((url, opts) => {
    if (url.includes('accounts.spotify.com')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/me/player/devices')) {
      return json(200, { devices: [{ id: 'ph', name: 'Telefon', type: 'Smartphone', is_active: false }, { id: 'pc', name: 'PC', type: 'Computer', is_active: false }] });
    }
    if (url.includes('/me/player/play')) return { status: 204, ok: true, json: async () => ({}) };
    return json(404, {});
  });
  const r = await player.playUri('spotify:track:abc');
  assert.equal(r.device, 'PC');
  const play = calls.find((c) => c.url.includes('/me/player/play'));
  assert.ok(play.url.includes('device_id=pc'));
  assert.equal(play.method, 'PUT');
  assert.deepEqual(JSON.parse(play.body), { uris: ['spotify:track:abc'] });
});

test('spotify: brak urzadzen i brak Premium daja czytelne bledy', async () => {
  mockFetch((url) => {
    if (url.includes('accounts.spotify.com')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/me/player/devices')) return json(200, { devices: [] });
    return json(404, {});
  });
  await assert.rejects(() => player.playUri('spotify:track:abc'), /nie jest uruchomione/);

  mockFetch((url) => {
    if (url.endsWith('/me/player/devices')) return json(200, { devices: [{ id: 'pc', name: 'PC', type: 'Computer', is_active: true }] });
    if (url.includes('/me/player/play')) return json(403, { error: { message: 'Premium required', reason: 'PREMIUM_REQUIRED' } });
    return json(200, { access_token: 'tok', expires_in: 3600 });
  });
  await assert.rejects(() => player.playUri('spotify:track:abc'), /Premium/);
});

test('spotify: zly state w callbacku jest odrzucany', async () => {
  await assert.rejects(() => player.exchangeCode('code', 'nieznany'), /stan autoryzacji/);
  const url = player.authUrl('https://example.com/callback');
  assert.ok(url.startsWith('https://accounts.spotify.com/authorize?'));
  assert.ok(url.includes('user-modify-playback-state'));
  assert.ok(url.includes(encodeURIComponent('https://example.com/callback')));
});

test('spotify: sterowanie - dalej i glosniej, a bez aktywnego urzadzenia wybiera komputer', async () => {
  let first = true;
  const calls = mockFetch((url, opts) => {
    if (url.includes('accounts.spotify.com')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.includes('/me/player/next')) {
      if (first && !url.includes('device_id')) {
        first = false;
        return json(404, { error: { message: 'No active device', reason: 'NO_ACTIVE_DEVICE' } });
      }
      return { status: 204, ok: true, json: async () => ({}) };
    }
    if (url.endsWith('/me/player/devices')) return json(200, { devices: [{ id: 'pc', name: 'PC', type: 'Computer', is_active: false }] });
    if (url.includes('/me/player?')) return json(200, { is_playing: true, device: { name: 'PC', volume_percent: 40 }, item: { name: 'One', artists: [{ name: 'Metallica' }], duration_ms: 1000 } });
    if (url.includes('/me/player/volume')) return { status: 204, ok: true, json: async () => ({}) };
    return json(404, {});
  });
  await player.control('next');
  const nexts = calls.filter((c) => c.url.includes('/me/player/next'));
  assert.equal(nexts.length, 2);
  assert.ok(nexts[1].url.includes('device_id=pc'));
  const r = await player.control('up', 15);
  assert.equal(r.volume, 55);
  assert.ok(calls.some((c) => c.url.includes('volume_percent=55')));
  const now = await player.nowPlaying();
  assert.equal(now.track, 'One');
  assert.equal(now.artist, 'Metallica');
  await assert.rejects(() => player.control('xyz'), /Nieznane/);
});

// Stan konta: telefon aktywny i komputer. To dokladnie przypadek "aplikacja wlaczona, a utwor sie nie zmienia".
const PHONE = { id: 'ph', name: 'Telefon', type: 'Smartphone', is_active: true };
const PC = { id: 'pc', name: 'PC', type: 'Computer', is_active: false };
function account({ devices = [PHONE, PC], playing = null, followPlay = true } = {}) {
  let state = playing;
  const calls = mockFetch((url, opts) => {
    if (url.includes('accounts.spotify.com')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/me/player/devices')) return json(200, { devices });
    if (url.includes('/me/player/play')) {
      if (followPlay) {
        const uri = JSON.parse(opts.body).uris[0];
        const id = /device_id=(\w+)/.exec(url)[1];
        state = { is_playing: true, item: { uri }, device: { id } };
      }
      return { status: 204, ok: true, json: async () => ({}) };
    }
    if (url.includes('/me/player')) return json(200, state || {});
    return json(404, {});
  });
  return calls;
}
const FAST = { gapMs: 1 };

test('spotify: prosba z komputera gra na komputerze, choc aktywny jest telefon', async () => {
  const calls = account();
  const r = await player.playUri('spotify:track:abc', { komputer: true, ...FAST });
  assert.equal(r.device, 'PC');
  assert.ok(calls.find((c) => c.method === 'PUT').url.includes('device_id=pc'));
});

test('spotify: prosba z telefonu zostaje na aktywnym urzadzeniu', async () => {
  const calls = account();
  const r = await player.playUri('spotify:track:abc', FAST);
  assert.equal(r.device, 'Telefon');
  assert.ok(calls.find((c) => c.method === 'PUT').url.includes('device_id=ph'));
});

test('spotify: bez komputera na liscie blad, zeby klient otworzyl aplikacje linkiem', async () => {
  account({ devices: [PHONE] });
  await assert.rejects(player.playUri('spotify:track:abc', { komputer: true, ...FAST }), /nie jest uruchomione na tym komputerze/);
});

test('spotify: urzadzenie z ograniczeniami nie jest celem', async () => {
  account({ devices: [{ ...PC, is_restricted: true }] });
  await assert.rejects(player.playUri('spotify:track:abc', { komputer: true, ...FAST }), /nie jest uruchomione/);
});

test('spotify: odpowiedz 204 bez zmiany utworu to blad, a nie sukces', async () => {
  account({ followPlay: false, playing: { is_playing: true, item: { uri: 'spotify:track:stary' }, device: { id: 'pc' } } });
  await assert.rejects(player.playUri('spotify:track:abc', { komputer: true, ...FAST }), /nie zagrało/);
});

test('spotify: utwor podmieniony na wersje z innego rynku liczy sie jako ten sam', async () => {
  account({ followPlay: false, playing: { is_playing: true, item: { uri: 'spotify:track:inny', linked_from: { uri: 'spotify:track:abc' } }, device: { id: 'pc' } } });
  assert.equal((await player.playUri('spotify:track:abc', { komputer: true, ...FAST })).device, 'PC');
});
