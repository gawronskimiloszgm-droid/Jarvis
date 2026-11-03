// Narzedzia glosowe do Spotify ponad "graj X": playlisty, kolejka, polubienia, historia, tryby,
// przewijanie i wylacznik czasowy. Logika w connect/spotifyMore.js.
import * as player from '../connect/spotifyPlayer.js';
import * as more from '../connect/spotifyMore.js';
import { resolveTrack } from './music.js';
import { logJournal } from './life.js';

export const MUSIC_TOOLS = [
  {
    name: 'playlista',
    description: 'Wlacz playliste Spotify po nazwie: najpierw z playlist uzytkownika ("pusc moja playliste GYM"), a gdy takiej nie ma, publiczna z wyszukiwarki ("cos na trening", "spokojna muzyka do pracy").',
    parameters: { type: 'object', properties: { nazwa: { type: 'string' } }, required: ['nazwa'] },
  },
  {
    name: 'do_kolejki',
    description: 'Dodaj utwor do kolejki Spotify (zagra po obecnym), np. "dodaj do kolejki Thunderstruck".',
    parameters: { type: 'object', properties: { zapytanie: { type: 'string', description: 'wykonawca + tytul' } }, required: ['zapytanie'] },
  },
  {
    name: 'polub_utwor',
    description: 'Dodaj utwor, ktory teraz gra, do polubionych na Spotify.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ostatnio_grane',
    description: 'Co ostatnio gralo na Spotify ("co to bylo za piosenka przed chwila").',
    parameters: { type: 'object', properties: { ile: { type: 'number' } } },
  },
  {
    name: 'tryb_odtwarzania',
    description: 'Losowa kolejnosc (losowo true/false) i powtarzanie (wylacz, utwor, playlista).',
    parameters: { type: 'object', properties: { losowo: { type: 'boolean' }, powtarzanie: { type: 'string', enum: ['wylacz', 'utwor', 'playlista'] } } },
  },
  {
    name: 'przewin',
    description: 'Przewin obecny utwor o liczbe sekund (ujemna cofa), np. "przewin o 30 sekund".',
    parameters: { type: 'object', properties: { sekundy: { type: 'number' } }, required: ['sekundy'] },
  },
  {
    name: 'wylacz_muzyke_za',
    description: 'Wylacznik czasowy muzyki: za ile minut wylaczyc (ostatnia minuta stopniowo sciszana); 0 odwoluje.',
    parameters: { type: 'object', properties: { minuty: { type: 'number' } }, required: ['minuty'] },
  },
];

export const MUSIC_VOICE_PROMPT = '- Spotify: playlista (po nazwie, takze "cos na trening"), do_kolejki, polub_utwor, ostatnio_grane, tryb_odtwarzania, przewin, wylacz_muzyke_za (np. przed snem). Gdy narzedzie mowi o ponownym polaczeniu, przekaz to wprost.';

const wrap = async (fn) => {
  if (!player.isConnected()) return { error: 'Spotify nie jest polaczone (Ustawienia, Muzyka)' };
  try {
    return await fn();
  } catch (e) {
    return { error: e.message };
  }
};

export async function runMusicTool(name, a = {}) {
  switch (name) {
    case 'playlista':
      return wrap(async () => {
        const r = await more.playPlaylist(String(a.nazwa || ''));
        logJournal('music', `Playlista: ${r.name}${r.mine ? '' : ' (z wyszukiwarki)'} (na: ${r.device})`, 'muzyka');
        return { gra: r.name, twoja: r.mine, urzadzenie: r.device };
      });
    case 'do_kolejki':
      return wrap(async () => {
        const found = await resolveTrack(String(a.zapytanie || ''), 'spotify');
        if (!found) return { error: 'nie znalazlem takiego utworu na Spotify' };
        await more.addToQueue(found.url.replace(/:play$/, ''));
        return { w_kolejce: found.nazwa };
      });
    case 'polub_utwor':
      return wrap(async () => {
        const r = await more.likeCurrent();
        return { polubiono: `${r.track} - ${r.artist}` };
      });
    case 'ostatnio_grane':
      return wrap(async () => ({ ostatnio: (await more.recentlyPlayed(Math.round(Number(a.ile) || 5))).map((t) => `${t.track} - ${t.artist}`) }));
    case 'tryb_odtwarzania':
      return wrap(async () => {
        const out = {};
        if (typeof a.losowo === 'boolean') Object.assign(out, await more.setShuffle(a.losowo));
        if (a.powtarzanie) Object.assign(out, await more.setRepeat(a.powtarzanie));
        return Object.keys(out).length ? out : { error: 'podaj losowo albo powtarzanie' };
      });
    case 'przewin':
      return wrap(() => more.seekBy(Number(a.sekundy) || 0));
    case 'wylacz_muzyke_za':
      return wrap(async () => {
        const r = more.sleepAfter(Number(a.minuty) || 0);
        return r.off ? { odwolano: true } : { wylacze_za_minut: r.minutes };
      });
    default:
      return undefined;
  }
}
