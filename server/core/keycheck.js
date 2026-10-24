// Sprawdza, czy klucze Gemini naprawde dzialaja (lista modeli - darmowe zapytanie, zero tokenow).
// Wynik tylko jako true/false w /api/health; wartosci kluczy nigdzie nie wychodza.

const TTL = 10 * 60 * 1000;
const state = { main: { ok: null, at: 0, err: null }, edith: { ok: null, at: 0, err: null } };

async function probe(key) {
  if (!key) return { ok: false, err: 'brak klucza' };
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, err: null };
    const data = await res.json().catch(() => ({}));
    return { ok: false, err: String(data.error?.message || `HTTP ${res.status}`).slice(0, 120) };
  } catch (e) {
    return { ok: null, err: 'brak odpowiedzi: ' + String(e.message || e).slice(0, 80) };
  }
}

async function refresh(which, key) {
  const r = await probe(key);
  state[which] = { ...r, at: Date.now() };
}

/** Nieblokujace: zwraca ostatni znany wynik i w razie potrzeby odswieza w tle. */
export function keyStatus() {
  const main = process.env.GEMINI_API_KEY;
  const edith = process.env.EDITH_GEMINI_API_KEY || main;
  if (Date.now() - state.main.at > TTL) {
    state.main.at = Date.now();
    refresh('main', main).catch(() => {});
  }
  if (Date.now() - state.edith.at > TTL) {
    state.edith.at = Date.now();
    refresh('edith', edith).catch(() => {});
  }
  return { geminiKeyWorks: state.main.ok, edithKeyWorks: state.edith.ok, geminiKeyError: state.main.ok === false ? state.main.err : undefined, edithKeyError: state.edith.ok === false ? state.edith.err : undefined };
}
