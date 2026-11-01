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

//
// Google potrafi zabrac model nowym kontom (404, tak skonczyl gemini-2.5-flash),
// a stare nazwy przekierowuje na nowsze (3.7 na 3.8, 3.5 na 3.6), wiec na
// liscie sa tylko modele naprawde rozne.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

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

// Model wycofany albo niedostepny dla tego klucza: inny z listy moze dzialac.
export function isUnavailable(err) {
  return (err?.status ?? err?.code) === 404 || /NOT_FOUND/.test(String(err?.message || ''));
}

// Surowy JSON od Google to nie jest komunikat dla czlowieka. Status zostaje,
// bo isOverloaded i wywolujacy decyduja po nim, co dalej.
function readable(err) {
  const text = isUnavailable(err)
    ? 'Żaden model AI z listy nie jest dostępny dla tego klucza Gemini.'
    : (err?.status ?? err?.code) === 429 || /RESOURCE_EXHAUSTED/.test(String(err?.message || ''))
      ? 'Wyczerpany limit zapytań do Gemini. Spróbuj później.'
      : isOverloaded(err)
        ? 'Serwery Gemini są teraz przeciążone. Spróbuj ponownie za chwilę.'
        : null;
  if (!text) return err;
  return Object.assign(new Error(text), { status: err?.status ?? err?.code, cause: err });
}

/**
 * Uruchamia fn(model) schodzac po MODEL_CHAIN, dopoki model jest
 * przeciazony albo niedostepny. canRetry pozwala zablokowac zejscie nizej, gdy czesc
 * odpowiedzi juz poszla do uzytkownika (streaming) - inaczej zobaczylby
 * ja drugi raz z innego modelu.
 */
export async function withModel(fn, canRetry = () => true) {
  let lastErr;
  for (const model of MODEL_CHAIN) {
    try {
      return await fn(model);
    } catch (err) {
      const unavailable = isUnavailable(err);
      if ((!unavailable && !isOverloaded(err)) || !canRetry()) throw readable(err);
      // 404 ostatniego modelu nie moze przykryc prawdziwego powodu, np. limitu na wczesniejszych.
      if (!unavailable || !lastErr) lastErr = err;
      console.warn(`Model ${model} ${unavailable ? 'niedostepny' : 'przeciazony'} (${err?.status ?? err?.code ?? '?'}) - probuje nastepny`);
    }
  }
  throw readable(lastErr);
}
