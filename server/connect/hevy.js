// Hevy (aplikacja do zapisywania treningow): publiczne API https://api.hevyapp.com, klucz w naglowku
// "api-key". Klucz generuje sie na developers.hevy.com/api-key (wymaga Hevy Pro) i wpisuje jako
// HEVY_API_KEY w zmiennych srodowiskowych serwera (Render -> Environment), nie w czacie.
// Limit: 1000 zapytan na 5 minut z jednego IP, wiec synchronizacja co 20 minut jest daleko od niego.
// HEVY_API_URL tylko do prob z lokalna atrapa API.
const BASE = process.env.HEVY_API_URL || 'https://api.hevyapp.com';

export const isConfigured = () => Boolean(String(process.env.HEVY_API_KEY || '').trim());

export class HevyError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** GET z kluczem, czytelne bledy po polsku. query: obiekt parametrow. */
export async function hevyGet(path, query = {}) {
  if (!isConfigured()) throw new HevyError('Hevy niepodłączone: brak HEVY_API_KEY w ustawieniach serwera.', 0);
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
  let res;
  try {
    res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
      headers: { 'api-key': String(process.env.HEVY_API_KEY).trim(), accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new HevyError(`Hevy nie odpowiada (${e.name === 'TimeoutError' ? 'przekroczony czas' : e.message}).`, 0);
  }
  if (res.status === 401 || res.status === 403) throw new HevyError('Hevy odrzuca klucz API: sprawdź HEVY_API_KEY (klucz z developers.hevy.com/api-key, wymaga Hevy Pro).', res.status);
  if (res.status === 404) throw new HevyError('Hevy: nie znaleziono.', 404);
  if (res.status === 429) throw new HevyError('Hevy: za dużo zapytań, spróbuję później.', 429);
  if (!res.ok) throw new HevyError(`Hevy: błąd ${res.status}.`, res.status);
  return res.json();
}

export const userInfo = async () => (await hevyGet('/v1/user/info'))?.data || null;
export const workoutCount = async () => (await hevyGet('/v1/workouts/count'))?.workout_count ?? 0;
/** Strona treningow, najnowsze pierwsze (maks. 10 na strone). */
export const workoutsPage = (page = 1) => hevyGet('/v1/workouts', { page, pageSize: 10 });
/** Zmiany (updated z calym treningiem, deleted z id) od podanej chwili ISO, najnowsze pierwsze. */
export const eventsPage = (since, page = 1) => hevyGet('/v1/workouts/events', { since, page, pageSize: 10 });
export const exerciseTemplate = (id) => hevyGet(`/v1/exercise_templates/${encodeURIComponent(id)}`);
export const routinesPage = (page = 1) => hevyGet('/v1/routines', { page, pageSize: 10 });
export const bodyPage = (page = 1) => hevyGet('/v1/body_measurements', { page, pageSize: 10 });
