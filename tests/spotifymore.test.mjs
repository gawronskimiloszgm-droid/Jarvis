import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SPOTIFY_CLIENT_ID = 'id';
process.env.SPOTIFY_CLIENT_SECRET = 'secret';
process.env.SPOTIFY_REFRESH_TOKEN = 'rt';

const memory = await import('../server/memory/memory.js');
const more = await import('../server/connect/spotifyMore.js');
const { runMusicTool, MUSIC_TOOLS } = await import('../server/extras/musicvoice.js');

const before = JSON.parse(JSON.stringify(memory.load()));
after(() => memory.save(before));
const setScope = (s) => {
  memory.load().spotifyScope = s;
};
const ALL = 'user-modify-playback-state user-read-playback-state playlist-read-private user-library-modify user-library-read user-read-recently-played';

const json = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
function spotify(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    if (u.includes('accounts.spotify.com')) return json(200, { access_token: 'tok', expires_in: 3600 });
    for (const [re, fn] of routes) if (re.test(u)) return fn(u, opts);
    return json(204, {});
  };
  return calls;
}
const PC = { id: 'pc', name: 'PC', type: 'Computer', is_active: true };

test('dopasowanie playlisty po nazwie, bez polskich znakow i emoji', () => {
  const lists = [{ name: 'GYM 💀' }, { name: 'Wszystko' }, { name: 'Motivation Rocky Balboa' }, { name: 'Boxing Music 🥊🔥' }];
  assert.equal(more.matchPlaylist(lists, 'gym').name, 'GYM 💀');
  assert.equal(more.matchPlaylist(lists, 'rocky').name, 'Motivation Rocky Balboa');
  assert.equal(more.matchPlaylist(lists, 'boxing').name, 'Boxing Music 🥊🔥');
  assert.equal(more.matchPlaylist(lists, 'jazz'), null);
});

test('stare polaczenie bez nowych uprawnien: jasna prosba o ponowne polaczenie', async () => {
  setScope('user-modify-playback-state user-read-playback-state');
  spotify([]);
  assert.deepEqual(more.missingScopes(), ['playlist-read-private', 'user-library-modify', 'user-library-read', 'user-read-recently-played']);
  await assert.rejects(more.likeCurrent(), /POŁĄCZ PONOWNIE/);
  const r = await runMusicTool('polub_utwor', {});
  assert.match(r.error, /POŁĄCZ PONOWNIE/);
});

test('playlista: Twoja po nazwie gra na komputerze i jest sprawdzana', async () => {
  setScope(ALL);
  let state = {};
  const calls = spotify([
    [/\/me\/playlists/, () => json(200, { items: [{ name: 'GYM 💀', uri: 'spotify:playlist:gym', tracks: { total: 40 } }], next: null })],
    [/\/me\/player\/devices/, () => json(200, { devices: [PC] })],
    [/\/me\/player\/play/, (u, o) => {
      state = { is_playing: true, context: { uri: JSON.parse(o.body).context_uri }, item: { uri: 'spotify:track:x' }, device: { id: 'pc' } };
      return json(204, {});
    }],
    [/\/me\/player\?/, () => json(200, state)],
  ]);
  const r = await more.playPlaylist('gym', { komputer: true, gapMs: 1 });
  assert.deepEqual([r.name, r.mine, r.device], ['GYM 💀', true, 'PC']);
  assert.deepEqual(JSON.parse(calls.find((c) => c.method === 'PUT').body), { context_uri: 'spotify:playlist:gym' });
});

test('playlista spoza Twoich: z wyszukiwarki', async () => {
  setScope(ALL);
  let state = {};
  spotify([
    [/\/me\/playlists/, () => json(200, { items: [], next: null })],
    [/\/search\?type=playlist/, () => json(200, { playlists: { items: [null, { name: 'Workout Hits', uri: 'spotify:playlist:w' }] } })],
    [/\/me\/player\/devices/, () => json(200, { devices: [PC] })],
    [/\/me\/player\/play/, (u, o) => {
      state = { is_playing: true, context: { uri: JSON.parse(o.body).context_uri }, device: { id: 'pc' } };
      return json(204, {});
    }],
    [/\/me\/player\?/, () => json(200, state)],
  ]);
  const r = await more.playPlaylist('cos na trening', { gapMs: 1 });
  assert.deepEqual([r.name, r.mine], ['Workout Hits', false]);
});

test('kolejka, polubienie, historia, tryby i przewijanie', async () => {
  setScope(ALL);
  const calls = spotify([
    [/\/me\/player\?/, () => json(200, { is_playing: true, progress_ms: 50000, item: { uri: 'spotify:track:abc', name: 'T.N.T.', artists: [{ name: 'AC/DC' }], duration_ms: 214000 }, device: { volume_percent: 60 } })],
    [/recently-played/, () => json(200, { items: [{ played_at: '2026-11-03T10:00:00Z', track: { name: 'Thunderstruck', artists: [{ name: 'AC/DC' }], uri: 'spotify:track:t' } }] })],
  ]);
  await more.addToQueue('spotify:track:abc');
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('/me/player/queue?uri=spotify%3Atrack%3Aabc')));
  await assert.rejects(more.addToQueue('spotify:playlist:x'), /tylko utwór/);
  assert.deepEqual(await more.likeCurrent(), { track: 'T.N.T.', artist: 'AC/DC' });
  assert.ok(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/me/tracks?ids=abc')));
  assert.equal((await more.recentlyPlayed(5))[0].track, 'Thunderstruck');
  assert.deepEqual(await more.setRepeat('utwor'), { repeat: 'track' });
  assert.deepEqual(await more.setShuffle(true), { shuffle: true });
  assert.deepEqual(await more.seekBy(30), { at_s: 80 });
  assert.deepEqual(await more.seekBy(-999), { at_s: 0 });
});

test('wylacznik czasowy: sciszanie po kroku, pauza i powrot glosnosci; odwolanie zatrzymuje', async () => {
  const calls = [];
  const timers = [];
  const deps = {
    now: () => 0,
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
    nowPlaying: async () => ({ volume: 60 }),
    spotifyApi: async (m, p) => {
      calls.push(`${m} ${p}`);
      return {};
    },
  };
  const r = more.sleepAfter(10, deps);
  assert.equal(r.minutes, 10);
  assert.ok(more.sleepStatus());
  const run = timers.shift()();
  for (let i = 0; i < 20 && timers.length < 1; i++) await new Promise((res) => setImmediate(res));
  while (timers.length) {
    timers.shift()();
    await new Promise((res) => setImmediate(res));
    await new Promise((res) => setImmediate(res));
  }
  await run;
  assert.deepEqual(calls, [
    'PUT /me/player/volume?volume_percent=50', 'PUT /me/player/volume?volume_percent=40', 'PUT /me/player/volume?volume_percent=30',
    'PUT /me/player/volume?volume_percent=20', 'PUT /me/player/volume?volume_percent=10', 'PUT /me/player/volume?volume_percent=0',
    'PUT /me/player/pause', 'PUT /me/player/volume?volume_percent=60',
  ]);
  assert.equal(more.sleepStatus(), null);
  assert.deepEqual(more.sleepAfter(0, deps), { off: true });
});

test('narzedzia muzyczne: poprawne schematy i brak polaczenia', async () => {
  for (const t of MUSIC_TOOLS) for (const r of t.parameters.required || []) assert.ok(t.parameters.properties[r]);
  assert.equal(await runMusicTool('nie_ma', {}), undefined);
});
