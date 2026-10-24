// Klient Spotify Web API - TYLKO wyszukiwanie publicznych playlist wg
// zapytania (#142, uzywane przez server/entertainment.js).
//
// Uzywa przeplywu "Client Credentials" (autoryzacja aplikacji, bez logowania
// uzytkownika) - w odroznieniu od server/calendar.js, ktory musi uzyc pelnego
// OAuth "Authorization Code" (bo dziala na PRYWATNYM kalendarzu wlasciciela).
// Tutaj wystarczy wyszukac ISTNIEJACA, publiczna playliste pasujaca do
// nastroju - nie ma potrzeby (ani sensu) prosic o dostep do konta Spotify
// uzytkownika, skoro i tak nie odtwarzamy niczego przez to API (odtwarzanie
// zostaje przy prostym schemacie spotify:/otworz-spotify z desktop/actions.js).

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

export function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// Token aplikacji zyje krotko - trzymamy go w pamieci procesu, tak samo jak
// cachedAccessToken w calendar.js, bo i tak trzeba go bedzie za chwile
// wymienic ponownie.
let cachedToken = null;
let cachedExpiresAt = 0;

async function getAppToken() {
  if (cachedToken && Date.now() < cachedExpiresAt - 30_000) return cachedToken;
  if (!isConfigured()) throw new Error('Spotify nie jest skonfigurowane (brak SPOTIFY_CLIENT_ID/SECRET).');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  cachedToken = data.access_token;
  cachedExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

/**
 * Szuka publicznych playlist na Spotify wg dowolnego zapytania tekstowego
 * (najlepiej po angielsku, np. "chill lofi focus").
 * @returns {Promise<Array<{nazwa:string, url:string|null, autor:string|null, obrazek:string|null, opis:string}>>}
 */
export async function searchPlaylists(query, limit = 5) {
  const q = String(query || '').trim();
  if (!q) return [];
  const token = await getAppToken();
  const p = new URLSearchParams({
    q,
    type: 'playlist',
    limit: String(Math.max(1, Math.min(10, Number(limit) || 5))),
  });
  const res = await fetch(`https://api.spotify.com/v1/search?${p.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

  const items = (data.playlists?.items || []).filter(Boolean);
  return items.map((pl) => ({
    nazwa: pl.name,
    url: pl.external_urls?.spotify || null,
    autor: pl.owner?.display_name || null,
    obrazek: pl.images?.[0]?.url || null,
    opis: pl.description || '',
  }));
}

/**
 * Najlepiej pasujacy UTWOR do zapytania ("metallica nothing else matters").
 * Zwraca URI do otwarcia w aplikacji Spotify (spotify:track:ID) - ten sam
 * schemat, ktorym juz dziala "pobudka", wiec utwor od razu zaczyna grac.
 * @returns {Promise<{uri:string, nazwa:string, artysta:string}|null>}
 */
export async function searchTrack(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const token = await getAppToken();
  const p = new URLSearchParams({ q, type: 'track', limit: '3', market: 'PL' });
  const res = await fetch(`https://api.spotify.com/v1/search?${p.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  const t = (data.tracks?.items || []).filter(Boolean)[0];
  return t ? { uri: t.uri, nazwa: t.name, artysta: (t.artists || []).map((a) => a.name).join(', ') } : null;
}
