// Spotify ponad "graj X": kolejka, Twoje playlisty, polubienia, ostatnio grane, losowo i powtarzanie,
// przewijanie oraz wylacznik czasowy, ktory sciszaa stopniowo zamiast urywac muzyke.
// Wspolne logowanie i wybor urzadzenia sa w spotifyPlayer.js.
import { spotifyApi, spotifyScopes, playContext, nowPlaying } from './spotifyPlayer.js';

/** Uprawnienia, ktorych wymagaja te funkcje. Starsze polaczenie ich nie ma: wtedy trzeba polaczyc ponownie. */
export const MORE_SCOPES = ['playlist-read-private', 'user-library-modify', 'user-library-read', 'user-read-recently-played'];
export function missingScopes() {
  const have = spotifyScopes();
  return have == null ? MORE_SCOPES : MORE_SCOPES.filter((s) => !have.includes(s));
}
function needScope(scope) {
  if (missingScopes().includes(scope)) {
    const e = new Error('Ta funkcja wymaga ponownego połączenia Spotify (Ustawienia → Muzyka → POŁĄCZ PONOWNIE), bo potrzebuje nowych uprawnień.');
    e.code = 'scope';
    throw e;
  }
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Dopasowanie nazwy playlisty: dokladna, potem poczatek, potem wszystkie slowa. "gym" znajduje "GYM 💀". */
export function matchPlaylist(lists, query) {
  const q = fold(query);
  if (!q) return null;
  const named = lists.map((p) => ({ p, n: fold(p.name) }));
  return (
    named.find((x) => x.n === q)?.p ||
    named.find((x) => x.n.startsWith(q))?.p ||
    named.find((x) => q.split(' ').every((w) => x.n.includes(w)))?.p ||
    null
  );
}

export async function myPlaylists() {
  needScope('playlist-read-private');
  const out = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const r = await spotifyApi('GET', `/me/playlists?limit=50&offset=${offset}`);
    out.push(...(r.items || []).filter(Boolean).map((p) => ({ name: p.name, uri: p.uri, tracks: p.tracks?.total ?? 0, owner: p.owner?.display_name || '' })));
    if (!r.next) break;
  }
  return out;
}

/** Twoja playlista po nazwie, a gdy takiej nie ma, publiczna z wyszukiwarki ("cos na trening"). */
export async function playPlaylist(name, opts = {}) {
  let found = null;
  let mine = true;
  if (!missingScopes().includes('playlist-read-private')) found = matchPlaylist(await myPlaylists(), name);
  if (!found) {
    const r = await spotifyApi('GET', `/search?type=playlist&limit=5&q=${encodeURIComponent(name)}`);
    const p = (r.playlists?.items || []).filter(Boolean)[0];
    if (p) found = { name: p.name, uri: p.uri, owner: p.owner?.display_name || '' };
    mine = false;
  }
  if (!found) throw new Error(`Nie znalazłem playlisty „${name}”.`);
  const r = await playContext(found.uri, opts);
  return { name: found.name, mine, device: r.device };
}

export async function addToQueue(uri) {
  if (!/^spotify:(track|episode):[A-Za-z0-9]+$/.test(String(uri))) throw new Error('Do kolejki można dodać tylko utwór.');
  await spotifyApi('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`);
  return { ok: true };
}

export async function likeCurrent() {
  needScope('user-library-modify');
  const n = await nowPlaying();
  const id = /^spotify:track:([A-Za-z0-9]+)$/.exec(n?.uri || '')?.[1];
  if (!id) throw new Error('Teraz nic nie gra albo to nie jest utwór.');
  await spotifyApi('PUT', `/me/tracks?ids=${id}`);
  return { track: n.track, artist: n.artist };
}

export async function recentlyPlayed(limit = 10) {
  needScope('user-read-recently-played');
  const r = await spotifyApi('GET', `/me/player/recently-played?limit=${Math.max(1, Math.min(50, limit))}`);
  return (r.items || []).map((i) => ({ track: i.track?.name, artist: (i.track?.artists || []).map((a) => a.name).join(', '), at: i.played_at, uri: i.track?.uri }));
}

export async function setShuffle(on) {
  await spotifyApi('PUT', `/me/player/shuffle?state=${on ? 'true' : 'false'}`);
  return { shuffle: Boolean(on) };
}

const REPEAT = { wylacz: 'off', utwor: 'track', playlista: 'context', off: 'off', track: 'track', context: 'context' };
export async function setRepeat(mode) {
  const m = REPEAT[mode] || 'off';
  await spotifyApi('PUT', `/me/player/repeat?state=${m}`);
  return { repeat: m };
}

/** Przewiniecie o podana liczbe sekund (ujemna cofa). */
export async function seekBy(seconds) {
  const n = await nowPlaying();
  if (!n?.durationMs) throw new Error('Teraz nic nie gra.');
  const to = Math.max(0, Math.min(n.durationMs - 1000, n.progressMs + Number(seconds) * 1000));
  await spotifyApi('PUT', `/me/player/seek?position_ms=${Math.round(to)}`);
  return { at_s: Math.round(to / 1000) };
}

// ---------- wylacznik czasowy ----------
let sleepTimer = null;
const FADE_STEPS = 6;
const FADE_MS = 60000;

/** Za ile minut wylaczyc muzyke; 0 odwoluje. Ostatnia minuta to stopniowe sciszanie, potem pauza i powrot glosnosci. */
export function sleepAfter(minutes, deps = { spotifyApi, nowPlaying, setTimeout, clearTimeout, now: Date.now }) {
  if (sleepTimer) {
    deps.clearTimeout(sleepTimer.handle);
    sleepTimer = null;
  }
  const m = Number(minutes);
  if (!(m > 0)) return { off: true };
  const total = Math.min(m, 600) * 60000;
  const end = deps.now() + total;
  const fade = async () => {
    let start = 50;
    try {
      const n = await deps.nowPlaying();
      start = Number.isFinite(n?.volume) ? n.volume : 50;
      for (let i = 1; i <= FADE_STEPS; i++) {
        await new Promise((r) => deps.setTimeout(r, FADE_MS / FADE_STEPS));
        if (sleepTimer?.end !== end) return; // odwolany w trakcie
        await deps.spotifyApi('PUT', `/me/player/volume?volume_percent=${Math.round(start * (1 - i / FADE_STEPS))}`);
      }
      await deps.spotifyApi('PUT', '/me/player/pause');
    } catch {
      /* odtwarzacz mogl zniknac */
    } finally {
      // Nastepnym razem ma grac normalnie glosno.
      deps.spotifyApi('PUT', `/me/player/volume?volume_percent=${start}`).catch(() => {});
      if (sleepTimer?.end === end) sleepTimer = null;
    }
  };
  sleepTimer = { end, handle: deps.setTimeout(fade, Math.max(0, total - FADE_MS)) };
  return { minutes: Math.min(m, 600), end };
}
export const sleepStatus = () => (sleepTimer ? { end: sleepTimer.end } : null);
