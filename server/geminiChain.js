// Wspolny lancuch zapasowy modeli Gemini.
//
// Wydzielone z jarvis.js po tym, jak sie okazalo, ze trzy pozniejsze
// moduly (perimeter/vision.js, receipts/scan.js, sentinel/summarize.js)
// wywolywaly ai.models.generateContent WPROST, bez tego zabezpieczenia -
// pierwszy realny 503 "high demand" (a nie "czy sie zdarzy", tylko
// "kiedy") wywalal skan paragonu bledem, mimo ze mechanizm zeby temu
// zapobiec juz w projekcie istnial, tylko w jednym miejscu.
//
// Darmowy tier bywa PRZECIAZONY - zmierzone wczesniej w tym projekcie:
// kazdy model potrafi zwrocic 503 mniej wiecej raz na cztery zapytania,
// niezaleznie od wersji. Wybieranie "bezpieczniejszego" modelu nic nie
// daje; ratuje dopiero lancuch zapasowy.

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const FALLBACKS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];

export const MODEL_CHAIN = [DEFAULT_MODEL, ...FALLBACKS.filter((m) => m !== DEFAULT_MODEL)];

// Rozrozniamy "serwer zajety" od realnego bledu (zly klucz, zle zapytanie).
// Przy tym drugim schodzenie nizej nie ma sensu - kazdy model odmowi tak samo.
export function isOverloaded(err) {
  const code = err?.status ?? err?.code ?? 0;
  const msg = String(err?.message || '');
  return (
    code === 503 ||
    code === 429 ||
    code === 500 ||
    /UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED|internal error/i.test(msg)
  );
}

/**
 * Uruchamia fn(model) schodzac po MODEL_CHAIN, dopoki model jest
 * przeciazony. canRetry pozwala zablokowac zejscie nizej, gdy czesc
 * odpowiedzi juz poszla do uzytkownika (streaming) - inaczej zobaczylby
 * ja drugi raz z innego modelu.
 */
export async function withModel(fn, canRetry = () => true) {
  let lastErr;
  for (const model of MODEL_CHAIN) {
    try {
      return await fn(model);
    } catch (err) {
      lastErr = err;
      if (!isOverloaded(err) || !canRetry()) throw err;
      console.warn(`Model ${model} przeciazony - probuje nastepny`);
    }
  }
  throw lastErr;
}
