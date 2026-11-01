// Zamiana tego, co uslyszal Jarvis ("youtube", "onet.pl", "allegro + laptop"), na adres do otwarcia.
// Tylko http i https: file:, javascript: i protokoly aplikacji nie przechodza.

const KNOWN = {
  youtube: 'www.youtube.com',
  google: 'www.google.com',
  gmail: 'mail.google.com',
  facebook: 'www.facebook.com',
  instagram: 'www.instagram.com',
  tiktok: 'www.tiktok.com',
  twitter: 'x.com',
  reddit: 'www.reddit.com',
  github: 'github.com',
  netflix: 'www.netflix.com',
  twitch: 'www.twitch.tv',
  wikipedia: 'pl.wikipedia.org',
  allegro: 'allegro.pl',
  olx: 'www.olx.pl',
  onet: 'www.onet.pl',
  wp: 'www.wp.pl',
  interia: 'www.interia.pl',
};

const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

function parse(raw) {
  const text = raw.trim();
  const known = KNOWN[text.toLowerCase().replace(/\s+/g, '').replace(/\.(com|pl)$/, '')];
  if (known) return new URL(`https://${known}/`);
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(text);
  if (scheme && !/^https?$/i.test(scheme[1])) throw new Error('Mogę otwierać tylko strony internetowe.');
  // Bez kropki i spacji to nie adres: "laptop" trafia do wyszukiwarki.
  if (!scheme && (/\s/.test(text) || !/^[^/]+\.[^/]{2,}/.test(text)) && !/^localhost\b/i.test(text)) return null;
  const url = new URL(scheme ? text : `https://${text}`);
  if (url.username || url.password) throw new Error('Nie otwieram adresów z loginem i hasłem.');
  return url;
}

/** Zwraca adres do otwarcia. adres: strona (moze byc sama nazwa), zapytanie: czego na niej szukac. */
function webTarget(adres, zapytanie) {
  const a = String(adres || '').trim().slice(0, 2000);
  const q = String(zapytanie || '').trim().slice(0, 300);
  if (!a && !q) throw new Error('Nie podano adresu strony.');
  if (!a) return google(q);
  const url = parse(a);
  if (!url) return google(q ? `${a} ${q}` : a);
  if (!q) return url.href;
  const host = url.hostname.replace(/^www\./, '');
  if (/(^|\.)youtube\.com$/.test(host)) return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  if (host === 'google.com' || host.startsWith('google.')) return google(q);
  if (host === 'allegro.pl') return `https://allegro.pl/listing?string=${encodeURIComponent(q)}`;
  return google(`site:${host} ${q}`);
}

module.exports = { webTarget };
