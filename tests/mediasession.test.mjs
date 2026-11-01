import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { ensurePlayingScript, parseResult } = require('../desktop/mediaSession.js');
const { judge } = require('../desktop/edithPolicy.js');

test('odpowiedz skryptu: stan i tytul, a smieci znacza cisze', () => {
  assert.deepEqual(parseResult('{"playing":true,"tytul":"AC/DC - Back In Black"}\r\n'), { playing: true, tytul: 'AC/DC - Back In Black' });
  assert.deepEqual(parseResult('ostrzezenie\n{"tytul":"","playing":false}'), { playing: false, tytul: '' });
  assert.deepEqual(parseResult(''), { playing: false, tytul: '' });
  assert.deepEqual(parseResult('blad {zepsute'), { playing: false, tytul: '' });
});

test('aplikacje uruchamia tylko wznawianie, a link czeka przed wymuszeniem', () => {
  assert.match(ensurePlayingScript({ openFirst: true }), /Start-Process 'spotify:'/);
  const link = ensurePlayingScript({ forceAfter: 8, limit: 14 });
  assert.doesNotMatch(link, /Start-Process/);
  assert.match(link, /-ge 8\)/);
  assert.match(link, /-lt 14\)/);
});

test('skrypt miesci sie w limicie wiersza polecen Windows', () => {
  const encoded = Buffer.from(ensurePlayingScript({ openFirst: true }), 'utf16le').toString('base64');
  assert.ok(encoded.length < 8000, `dlugosc ${encoded.length}`);
});

test('polityka: wznowienie muzyki nie pyta o zgode', () => {
  assert.equal(judge('spotify-graj').allow, true);
});

test('plik trafia do paczki aplikacji', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  const files = pkg.build?.files;
  assert.ok(!files || files.some((f) => f === 'mediaSession.js' || f === '*.js' || f === '**/*' || f === '**/*.js'), JSON.stringify(files));
});

// Logika z public/extras/music.js uruchomiona z atrapa przegladarki.
function loadMusic({ connected = false, controlFails = false, desktop = null, played = true } = {}) {
  const calls = [];
  const UI = {
    el: () => ({}),
    toast: () => {},
    isOwner: () => true,
    extend: () => {},
    clientActions: {},
    pushSaid: (_k, t) => calls.push(`powiedz: ${t}`),
    runDeviceActionNow: async (name, params) => {
      calls.push(`akcja: ${name}${params?.url ? ` ${params.url}` : ''}`);
      return desktop;
    },
    api: async (url, o) => {
      if (url === '/api/spotify/status') return { connected };
      if (url === '/api/spotify/control') {
        calls.push('api: play');
        if (controlFails) throw new Error('Premium');
        return { ok: true };
      }
      if (url === '/api/music/play') {
        const q = JSON.parse(o.body).zapytanie;
        calls.push(`szukaj: ${q}`);
        return { ok: true, played, nazwa: q, found: { url: 'spotify:track:abc:play', nazwa: q, zrodlo: 'spotify' } };
      }
      throw new Error(url);
    },
  };
  const window = { JarvisUI: UI, jarvisDesktop: desktop ? {} : undefined };
  new Function('window', fs.readFileSync(new URL('../public/extras/music.js', import.meta.url), 'utf8'))(window);
  return { graj: UI.clientActions.graj, calls };
}

test('"wlacz muzyke" z polaczonym kontem wznawia przez API', async () => {
  const { graj, calls } = loadMusic({ connected: true });
  await graj({ zapytanie: '' });
  assert.deepEqual(calls, ['api: play', 'powiedz: Wznawiam muzykę.']);
});

test('bez konta wznawia w aplikacji na komputerze', async () => {
  const { graj, calls } = loadMusic({ desktop: { playing: true, tytul: 'AC/DC - Thunderstruck' } });
  await graj({ zapytanie: 'cokolwiek' });
  assert.deepEqual(calls, ['akcja: spotify-graj', 'powiedz: Gram: AC/DC - Thunderstruck']);
});

test('gdy nie ma czego wznowic, gra konkretny utwor, a nie zostawia ciszy', async () => {
  const { graj, calls } = loadMusic({ desktop: { playing: false }, played: false });
  await graj({ zapytanie: 'jakas muzyke' });
  assert.equal(calls[0], 'akcja: spotify-graj');
  assert.ok(calls.includes('szukaj: AC/DC Back in Black'), calls.join());
  assert.ok(calls.some((c) => c.startsWith('akcja: otworz-link spotify:track:abc')), calls.join());
});

test('konto bez Premium nie konczy sie cisza', async () => {
  const { graj, calls } = loadMusic({ connected: true, controlFails: true, desktop: { playing: true, tytul: 'X' } });
  await graj({});
  assert.deepEqual(calls, ['api: play', 'akcja: spotify-graj', 'powiedz: Gram: X']);
});

test('konkretny tytul idzie do wyszukiwania', async () => {
  const { graj, calls } = loadMusic({ connected: true });
  await graj({ zapytanie: 'Metallica Nothing Else Matters' });
  assert.equal(calls[0], 'szukaj: Metallica Nothing Else Matters');
});

test('tytul zawierajacy slowo muzyka to nadal konkretny tytul', async () => {
  const { graj, calls } = loadMusic({ connected: true });
  await graj({ zapytanie: 'muzyka filmowa Hans Zimmer' });
  assert.equal(calls[0], 'szukaj: muzyka filmowa Hans Zimmer');
});
