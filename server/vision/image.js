// Generowanie obrazow przez Pollinations.ai - w pelni darmowe, bez klucza API, bez limitu.
import { nanoid } from 'nanoid';

const store = new Map();
const TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  }
}, 5 * 60 * 1000).unref?.();

export function looksLikeImageRequest(text) {
  return /\b(narysuj|namaluj|wygeneruj\s+(mi\s+)?obraz|wygeneruj\s+(mi\s+)?zdjecie|stworz\s+obraz|pokaz\s+mi\s+obraz(ek)?|zrob\s+(mi\s+)?obraz(ek)?)\b/i.test(
    text
  );
}

export async function generateImage(prompt, { width = 768, height = 768 } = {}) {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Pollinations error ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function storeImage(buffer, mimeType = 'image/jpeg') {
  const id = nanoid(10);
  store.set(id, { buffer, mimeType, createdAt: Date.now() });
  return id;
}

export function getImage(id) {
  return store.get(id) || null;
}
