// Czyste funkcje do pracy z dlugim tekstem: dzielenie na fragmenty i proste
// wyszukiwanie (BM25-podobne). Bez zaleznosci i bez sieci - latwe do testow.

// Dzieli tekst na fragmenty ~targetChars znakow, tnac po granicach
// akapitow/zdan (nie w pol slowa), z niewielkim zakladkowaniem, zeby zdanie
// przecięte granica nie zginelo z kontekstu.
export function chunkText(text, targetChars = 6000, overlap = 400) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
  if (clean.length <= targetChars) return clean.trim() ? [clean.trim()] : [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + targetChars, clean.length);
    if (end < clean.length) {
      // Szukamy najlepszego miejsca ciecia w ostatnich ~25% okna.
      const windowStart = start + Math.floor(targetChars * 0.75);
      const slice = clean.slice(windowStart, end);
      const para = slice.lastIndexOf('\n\n');
      const line = slice.lastIndexOf('\n');
      const sent = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
      const cut = para >= 0 ? para + 2 : line >= 0 ? line + 1 : sent >= 0 ? sent + 2 : -1;
      if (cut > 0) end = windowStart + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

const STOP = new Set(
  'i w z na do to ze sie nie jest jak co czy po od dla ale oraz tez tak lub bo ten ta te tym tej the a an of and or in on is are for with'.split(' ')
);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    // Polska fleksja: przycinamy do 6 znakow, zeby "umowy"/"umowie"/"umowa"
    // trafialy w ten sam token.
    .map((t) => (t.length > 6 ? t.slice(0, 6) : t));
}

// Zwraca indeksy fragmentow posortowane od najbardziej pasujacego.
export function rankChunks(chunks, query, limit = 6) {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return chunks.slice(0, limit).map((_, i) => i);
  const docs = chunks.map((c) => tokenize(c));
  const N = docs.length;
  const df = new Map();
  for (const toks of docs) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, N);
  const k1 = 1.4;
  const b = 0.75;
  const scores = docs.map((toks, i) => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avg)));
    }
    return { i, score };
  });
  return scores
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit)
    .map((s) => s.i);
}
