import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { ensurePlayingScript, pauseIfPlayingScript, parseResult } = require('../desktop/mediaSession.js');
const { webTarget } = require('../desktop/webUrl.js');
const uia = require('../desktop/uia.js');
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
    // Prawdziwa funkcja niczego nie zwraca: atrapa zwracajaca wynik maskowala tu blad.
    runDeviceActionNow: async (name, params) => {
      calls.push(`akcja: ${name}${params?.url ? ` ${params.url}` : ''}`);
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
  const window = {
    open: (url) => calls.push(`otworz: ${url}`),
    JarvisUI: UI,
    jarvisDesktop: desktop
      ? {
          runAction: async (name) => {
            calls.push(`akcja: ${name}`);
            return desktop;
          },
        }
      : undefined,
  };
  new Function('window', fs.readFileSync(new URL('../public/extras/music.js', import.meta.url), 'utf8'))(window);
  return { graj: UI.clientActions.graj, calls };
}

test('na telefonie "wlacz muzyke" wznawia przez API', async () => {
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

test('na komputerze wznawia lokalnie, nawet z polaczonym kontem: API moze grac na telefonie', async () => {
  const { graj, calls } = loadMusic({ connected: true, desktop: { playing: true, tytul: 'X' } });
  await graj({});
  assert.deepEqual(calls, ['akcja: spotify-graj', 'powiedz: Gram: X']);
});

test('telefon bez Premium nie konczy sie cisza', async () => {
  const { graj, calls } = loadMusic({ connected: true, controlFails: true, played: false });
  await graj({});
  assert.deepEqual(calls.slice(0, 2), ['api: play', 'szukaj: AC/DC Back in Black']);
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

test('pauza przed linkiem dziala tylko, gdy cos gra', () => {
  const s = pauseIfPlayingScript();
  assert.match(s, /-eq 'Playing'/);
  assert.match(s, /TryPauseAsync/);
  assert.doesNotMatch(s, /TryPlayAsync/);
});

test('strona: nazwa, domena i wyszukiwanie', () => {
  assert.equal(webTarget('youtube'), 'https://www.youtube.com/');
  assert.equal(webTarget('YouTube.com'), 'https://www.youtube.com/');
  assert.equal(webTarget('onet.pl'), 'https://www.onet.pl/');
  assert.equal(webTarget('ceneo.pl'), 'https://ceneo.pl/');
  assert.equal(webTarget('https://a.pl/x?y=1&z=2'), 'https://a.pl/x?y=1&z=2');
  assert.equal(webTarget('youtube', 'back in black'), 'https://www.youtube.com/results?search_query=back%20in%20black');
  assert.equal(webTarget('allegro', 'laptop'), 'https://allegro.pl/listing?string=laptop');
  assert.equal(webTarget('ceneo.pl', 'laptop'), 'https://www.google.com/search?q=site%3Aceneo.pl%20laptop');
  assert.equal(webTarget('', 'pogoda krakow'), 'https://www.google.com/search?q=pogoda%20krakow');
  assert.equal(webTarget('jakas nieznana strona'), 'https://www.google.com/search?q=jakas%20nieznana%20strona');
  assert.equal(webTarget('localhost:3000'), 'https://localhost:3000/');
});

test('strona: tylko http i https, bez loginu w adresie', () => {
  for (const bad of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'spotify:track:abc', 'ms-settings:privacy', 'vbscript:x']) {
    assert.throws(() => webTarget(bad), /tylko strony/, bad);
  }
  assert.throws(() => webTarget('https://bank.pl@zlo.pl/'), /loginem/);
  assert.throws(() => webTarget('', ''), /Nie podano/);
});

test('polityka: strona i kursor nie pytaja o zgode', () => {
  assert.equal(judge('otworz-strone').allow, true);
  assert.equal(judge('kursor-jarvisa').allow, true);
});

test('wynik klikniecia: znacznik kursora nie psuje odczytu JSON', () => {
  assert.deepEqual(uia.parseOutput('@@KURSOR 10 20\r\n{"ok":true,"clicked":"Plik"}\r\n'), { ok: true, clicked: 'Plik' });
  assert.deepEqual(uia.cursorMark('@@KURSOR 10 20'), [10, 20]);
  assert.equal(uia.cursorMark('{"ok":true}'), null);
  assert.throws(() => uia.parseOutput(''));
});

test('skrypty UIA: kursor przed akcja, parametry tylko jako tekst', () => {
  const s = uia.clickScript("x'; calc; '", '', 440);
  assert.ok(s.indexOf('Show-Cursor $best.x $best.y 440') < s.indexOf('$p.Invoke()'));
  assert.ok(s.includes("'x''; calc; '''"));
  assert.match(uia.clickAtScript(5.9, 'zly'), /Click-At 5 0/);
});

test('nazwane panele sa na liscie elementow, bo klasyczne okna nie maja tam innych typow', () => {
  assert.ok(uia.listScript(10).split('\n').some((l) => l.startsWith('$wantedTypes') && l.includes("'Pane'")));
  assert.match(uia.listScript(10), /if \(-not \$name -and \$t -ne 'Edit'/);
});

test('skrypty UIA mieszcza sie w limicie uruchomienia procesu w Windows', () => {
  for (const script of [uia.listScript(120), uia.clickScript('x', '', 440), uia.typeScript('x', 'y'.repeat(2000), 440)]) {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    assert.ok(encoded.length < 32000, `dlugosc ${encoded.length}`);
  }
});
