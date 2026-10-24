// "Graj X": zamienia nazwe utworu/wykonawcy na konkretny link, ktory komputer
// (albo telefon) otwiera i od razu odtwarza. Najpierw Spotify (jesli ustawione
// SPOTIFY_CLIENT_ID/SECRET - ten sam schemat spotify:track:ID co "pobudka"),
// a gdy go nie ma albo nic nie znajdzie - pierwszy wynik z YouTube.

import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as spotify from '../connect/spotify.js';

const router = express.Router();

// Linki, ktore wolno otwierac akcji "otworz-link" (desktop sprawdza to samo).
export const LINK_RE = /^(spotify:(track|album|playlist|artist):[A-Za-z0-9]{10,30}|https:\/\/(open\.spotify\.com\/(track|album|playlist|artist)\/[A-Za-z0-9]+|www\.youtube\.com\/watch\?v=[\w-]{11}|music\.youtube\.com\/watch\?v=[\w-]{11}))/;

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
      if (t) return { url: t.uri, nazwa: `${t.nazwa} - ${t.artysta}`, zrodlo: 'spotify' };
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

export default router;
