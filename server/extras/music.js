// "Graj X": zamienia nazwe utworu/wykonawcy na konkretny link, ktory komputer
// (albo telefon) otwiera i od razu odtwarza. Najpierw Spotify (jesli ustawione
// SPOTIFY_CLIENT_ID/SECRET - ten sam schemat spotify:track:ID co "pobudka"),
// a gdy go nie ma albo nic nie znajdzie - pierwszy wynik z YouTube.

import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as spotify from '../connect/spotify.js';
import * as player from '../connect/spotifyPlayer.js';

const router = express.Router();

// Linki, ktore wolno otwierac akcji "otworz-link" (desktop sprawdza to samo).
export const LINK_RE = /^(spotify:(track|album|playlist|artist):[A-Za-z0-9]{10,30}(:play)?|https:\/\/(open\.spotify\.com\/(track|album|playlist|artist)\/[A-Za-z0-9]+|www\.youtube\.com\/watch\?v=[\w-]{11}|music\.youtube\.com\/watch\?v=[\w-]{11}))/;

async function youtubeFirst(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.5',
      Cookie: 'CONSENT=YES+1; SOCS=CAI',
    },
  });
  const html = await res.text();
  const id = html.match(/"videoId":"([\w-]{11})"/)?.[1];
  const title = html.match(/"title":\{"runs":\[\{"text":"([^"]{1,120})"/)?.[1];
  return id ? { url: `https://www.youtube.com/watch?v=${id}`, nazwa: title || query, zrodlo: 'youtube' } : null;
}

export async function resolveTrack(query, source = 'auto') {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return null;
  if (source !== 'youtube' && spotify.isConfigured()) {
    try {
      const t = await spotify.searchTrack(q);
      if (t) return { url: t.uri + ':play', nazwa: `${t.nazwa} - ${t.artysta}`, zrodlo: 'spotify' };
    } catch {
      /* spadamy na YouTube */
    }
  }
  if (source === 'spotify') return null;
  return youtubeFirst(q).catch(() => null);
}

router.get('/api/music/resolve', requireOwner, async (req, res) => {
  const found = await resolveTrack(req.query.q, String(req.query.source || 'auto'));
  if (!found) {
    return res.status(404).json({
      error: spotify.isConfigured() ? 'Nic nie znalazlem.' : 'Nic nie znalazlem (Spotify nie jest skonfigurowane - ustaw SPOTIFY_CLIENT_ID i SPOTIFY_CLIENT_SECRET, a szukam na YouTube).',
    });
  }
  res.json(found);
});

// --- Spotify: polaczenie konta i odtwarzanie przez API ---

function origin(req) {
  const host = req.get('host') || 'localhost';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return proto.split(',')[0] + '://' + host;
}

router.get('/api/spotify/status', requireOwner, (req, res) => {
  res.json({ configured: player.isConfigured(), connected: player.isConnected(), redirectUri: origin(req) + '/callback' });
});

router.get('/api/spotify/auth-url', requireOwner, (req, res) => {
  if (!player.isConfigured()) return res.status(400).json({ error: 'Brak SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET w konfiguracji serwera.' });
  const redirectUri = origin(req) + '/callback';
  res.json({ url: player.authUrl(redirectUri), redirectUri });
});

// Spotify przekierowuje tu przegladarke BEZ naszych naglowkow - bezpieczenstwo daje
// jednorazowy "state" wydany wylacznie po wejsciu na /api/spotify/auth-url jako wlasciciel.
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const page = (title, msg) =>
    res.type('html').send(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#05090b;color:#cdeef7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px;padding:20px"><h2>' +
        title + '</h2><p>' + msg + '</p></div></body>'
    );
  if (error) return page('Spotify', 'Spotify zwrocil blad: ' + String(error).replace(/[<>&]/g, ''));
  if (!code || !state) return page('Spotify', 'Brak kodu autoryzacji.');
  try {
    await player.exchangeCode(String(code), String(state));
    page('Spotify polaczone', 'Mozesz zamknac to okno i wrocic do Jarvisa. Powiedz: "Jarvis, pusc Metallice".');
  } catch (err) {
    page('Nie udalo sie polaczyc', String(err.message || err).replace(/[<>&]/g, ''));
  }
});

router.get('/api/spotify/now', requireOwner, async (req, res) => {
  if (!player.isConnected()) return res.json({ connected: false });
  try {
    res.json({ connected: true, ...(await player.nowPlaying()) });
  } catch (err) {
    res.json({ connected: true, playing: false, error: err.message });
  }
});

const CONTROL = new Set(['play', 'pause', 'next', 'prev', 'volume', 'up', 'down']);
router.post('/api/spotify/control', requireOwner, async (req, res) => {
  const cmd = String(req.body?.cmd || '');
  if (!CONTROL.has(cmd)) return res.status(400).json({ error: 'Nieznane polecenie.' });
  if (!player.isConnected()) return res.status(409).json({ error: 'Spotify nie jest polaczone.', notConnected: true });
  try {
    res.json({ ok: true, ...((await player.control(cmd, req.body?.value)) || {}) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/api/spotify/disconnect', requireOwner, (req, res) => {
  player.disconnect();
  res.json({ ok: true });
});

// "Graj X": szukamy utworu, a gdy konto Spotify jest polaczone - odtwarzamy je
// przez API (dziala na dowolnym urzadzeniu). Inaczej oddajemy link do otwarcia przez klienta.
router.post('/api/music/play', requireOwner, async (req, res) => {
  const q = String(req.body?.zapytanie || '').trim();
  if (!q) return res.status(400).json({ error: 'Podaj, co zagrac.' });
  const found = await resolveTrack(q);
  if (!found) return res.status(404).json({ error: 'Nic nie znalazlem.' });
  if (found.zrodlo === 'spotify' && player.isConnected()) {
    try {
      const r = await player.playUri(found.url.replace(/:play$/, ''));
      return res.json({ ok: true, played: true, nazwa: found.nazwa, device: r.device });
    } catch (err) {
      // Nie udalo sie przez API (np. Spotify wylaczone) - klient sprobuje otworzyc link.
      return res.json({ ok: true, played: false, found, warning: err.message });
    }
  }
  res.json({ ok: true, played: false, found });
});

export default router;
