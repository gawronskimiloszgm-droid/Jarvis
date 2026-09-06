// Rozrywka na zadanie: playlista/gatunek pod nastroj (#142), sugestie
// filmu/serialu na wieczor (#143) i krotka historia/zart w stylu Jarvisa
// (#144).

import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { withModel } from './geminiChain.js';
import { requireOwner } from './auth.js';
import * as spotify from './spotify.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// TMDB jest opcjonalny (darmowy klucz) - bez niego sugestie filmowe dzialaja
// tak samo, tylko bez plakatu/oceny. Patrz uzasadnienie w raporcie agenta.
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

const router = express.Router();

// --- #142: playlista/gatunek pod nastroj ---

const MOOD_QUERY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    zapytanie: { type: Type.STRING },
    gatunek: { type: Type.STRING },
  },
  required: ['zapytanie', 'gatunek'],
};

const SONGLIST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    utwory: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          wykonawca: { type: Type.STRING },
          tytul: { type: Type.STRING },
        },
        required: ['wykonawca', 'tytul'],
      },
    },
  },
  required: ['utwory'],
};

// Tlumaczy polski nastroj na krotkie angielskie zapytanie wyszukiwania
// pasujace do tytulow playlist na Spotify (te sa niemal zawsze po angielsku).
async function moodToSearchQuery(mood, genre) {
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Nastroj uzytkownika: "${mood}".${genre ? ` Preferowany gatunek: "${genre}".` : ''}\n` +
        'Zwroc krotkie zapytanie wyszukiwania PO ANGIELSKU (2-4 slowa, np. "chill lofi focus") ' +
        'pasujace do tytulu playlisty na Spotify, oraz nazwe gatunku muzycznego PO POLSKU.',
      config: { responseMimeType: 'application/json', responseSchema: MOOD_QUERY_SCHEMA },
    })
  );
  return JSON.parse(res.text);
}

// Zapasowy tryb bez Spotify: model sam proponuje konkretne utwory.
async function moodToSongList(mood, genre) {
  const res = await withModel((m) =>
    ai.models.generateContent({
      model: m,
      contents:
        `Nastroj uzytkownika: "${mood}".${genre ? ` Preferowany gatunek: "${genre}".` : ''}\n` +
        'Zaproponuj 8 konkretnych utworow (wykonawca + tytul) pasujacych do tego nastroju. ' +
        'Zadnych wyjasnien - sama lista.',
      config: { responseMimeType: 'application/json', responseSchema: SONGLIST_SCHEMA },
    })
  );
  return JSON.parse(res.text).utwory || [];
}

// Zamontowac np. jako: app.use('/api/entertainment', entertainmentRouter)
router.post('/playlist', requireOwner, async (req, res) => {
  const mood = String(req.body?.nastroj || '').trim();
  const genre = req.body?.gatunek ? String(req.body.gatunek).trim() : '';
  if (!mood) return res.status(400).json({ error: 'Podaj nastroj.' });

  try {
    if (spotify.isConfigured()) {
      const { zapytanie, gatunek } = await moodToSearchQuery(mood, genre);
      const playlists = await spotify.searchPlaylists(zapytanie || genre || mood, 5);
      if (playlists.length) {
        return res.json({ zrodlo: 'spotify', gatunek: gatunek || genre || null, playlists });
      }
    }
    const utwory = await moodToSongList(mood, genre);
    res.json({ zrodlo: 'gemini', utwory });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- #143: co obejrzec wieczorem ---

const WATCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    propozycje: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tytul: { type: Type.STRING },
          typ: { type: Type.STRING, enum: ['film', 'serial'] },
          uzasadnienie: { type: Type.STRING },
        },
        required: ['tytul', 'typ', 'uzasadnienie'],
      },
    },
  },
  required: ['propozycje'],
};

async function tmdbEnrich(title) {
  if (!TMDB_API_KEY) return null;
  try {
    const p = new URLSearchParams({ api_key: TMDB_API_KEY, query: title, language: 'pl-PL' });
    const r = await fetch(`https://api.themoviedb.org/3/search/multi?${p.toString()}`);
    if (!r.ok) return null;
    const data = await r.json();
    const hit = (data.results || []).find((x) => x.media_type === 'movie' || x.media_type === 'tv') || data.results?.[0];
    if (!hit) return null;
    return {
      ocena: hit.vote_average ?? null,
      plakat: hit.poster_path ? `https://image.tmdb.org/t/p/w300${hit.poster_path}` : null,
      opisTmdb: hit.overview || null,
    };
  } catch {
    return null;
  }
}

router.post('/watch', requireOwner, async (req, res) => {
  const mood = String(req.body?.nastroj || '').trim();
  const genre = req.body?.gatunek ? String(req.body.gatunek).trim() : '';
  if (!mood) return res.status(400).json({ error: 'Podaj nastroj.' });

  try {
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          `Nastroj uzytkownika na wieczor: "${mood}".${genre ? ` Preferowany gatunek: "${genre}".` : ''}\n` +
          'Zaproponuj 3-5 filmow lub seriali (rozne, realne tytuly) z krotkim (jedno zdanie) uzasadnieniem ' +
          'po polsku, dlaczego pasuja do tego nastroju.',
        config: { responseMimeType: 'application/json', responseSchema: WATCH_SCHEMA },
      })
    );
    const parsed = JSON.parse(result.text);
    const propozycje = parsed.propozycje || [];

    if (TMDB_API_KEY) {
      for (const p of propozycje) {
        p.tmdb = await tmdbEnrich(p.tytul);
      }
    }
    res.json({ propozycje });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- #144: historia/zart na zadanie ---

// Streszczenie stylu Jarvisa (nie kopiujemy PERSONALITY_CORE z jarvis.js -
// patrz zastrzezenie w zleceniu) - wystarcza do konsekwentnego tonu.
const STYL_JARVISA =
  'Mow sucho, z klasa i z delikatna ironia, jak wytworny brytyjski lokaj - rzucasz celna uwage i idziesz dalej, ' +
  'bez tlumaczenia zartu ani dopisywania "haha".';

// Zamontowac np. jako: app.use('/api/entertainment', entertainmentRouter)
router.get('/story', requireOwner, async (req, res) => {
  const typ = req.query?.typ === 'zart' ? 'zart' : 'historia';
  try {
    const result = await withModel((m) =>
      ai.models.generateContent({
        model: m,
        contents:
          typ === 'zart'
            ? `${STYL_JARVISA}\n\nOpowiedz JEDEN krotki, oryginalny zart (2-4 zdania) po polsku. Bez wstepu - od razu tresc.`
            : `${STYL_JARVISA}\n\nOpowiedz krotka (5-8 zdan), oryginalna, lekko humorystyczna, zmyslona anegdotke po polsku. Bez wstepu - od razu tresc.`,
      })
    );
    res.json({ typ, tresc: (result.text || '').trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
