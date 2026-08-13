import { GoogleGenAI } from '@google/genai';
import * as memory from './memory.js';
import { looksLikeWeatherQuestion, getWeather, getWeatherByCoords } from './weather.js';
import { looksLikeImageRequest, generateImage, storeImage } from './image.js';
import { imagePart } from './vision.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const OWNER_TITLE = process.env.OWNER_TITLE || 'sir';

const ZAPAMIETAJ_RE = /\[ZAPAMIETAJ:\s*([^\]]+)\]/gi;
const ZADANIE_RE = /\[ZADANIE:\s*([^\]]+)\]/gi;
const PRZYPOMNIENIE_RE = /\[PRZYPOMNIENIE:\s*([^,\]]+),\s*([^\]]+)\]/gi;
// AKCJA celowo NIE jest w TAG_STRIP_PATTERNS - musi dotrzec do klienta
// (przegladarka/desktop) zywcem w strumieniu, zeby mogl ja tam wykonac.
// Usuwana jest tylko z tekstu zapisywanego do historii/pamieci.
const AKCJA_RE = /\[AKCJA:\s*([^\]]+)\]/gi;
const WYDATEK_RE = /\[WYDATEK:\s*([^,\]]+),\s*([^,\]]+)(?:,\s*([^\]]+))?\]/gi;
const TAG_STRIP_PATTERNS = [ZAPAMIETAJ_RE, ZADANIE_RE, PRZYPOMNIENIE_RE, WYDATEK_RE];

function stripTags(text) {
  return TAG_STRIP_PATTERNS.reduce((acc, re) => acc.replace(re, ''), text);
}

function stripTagsForHistory(text) {
  return stripTags(text).replace(AKCJA_RE, '');
}

function extractTag(text, re) {
  const results = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) results.push(m);
  return results;
}

function persistTagsFrom(rawFull) {
  const facts = extractTag(rawFull, ZAPAMIETAJ_RE).map((m) => m[1].trim());
  const newTodos = extractTag(rawFull, ZADANIE_RE).map((m) => m[1].trim());
  const reminders = extractTag(rawFull, PRZYPOMNIENIE_RE).map((m) => ({ dueAt: m[1].trim(), text: m[2].trim() }));
  const expenses = extractTag(rawFull, WYDATEK_RE).map((m) => ({
    amount: m[1].trim(),
    category: m[2].trim(),
    note: (m[3] || '').trim(),
  }));
  if (facts.length) memory.addFacts(facts);
  for (const t of newTodos) memory.addTodo(t);
  for (const r of reminders) memory.addReminder(r.text, r.dueAt);
  for (const e of expenses) memory.addExpense(e.amount, e.category, e.note);
}

async function resolveCity(userMessage) {
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: `Z tego pytania wypisz TYLKO nazwe miasta w mianowniku (np. "Warszawa", nie "Warszawie"), bez zadnych dodatkowych slow. Jesli nie ma miasta, napisz dokladnie NONE.\n\nPytanie: "${userMessage}"`,
    });
    const city = (res.text || '').trim();
    return city && city.toUpperCase() !== 'NONE' ? city : null;
  } catch {
    return null;
  }
}

// Rdzen osobowosci - wspoldzielony z voiceLive.js, zeby Jarvis brzmial
// identycznie (charakter, humor, styl) niezaleznie od tego czy rozmawiasz
// przez rozmowe na zywo czy piszesz na czacie. Jedna osobowosc, nie dwie.
export const PERSONALITY_CORE = `Jestes Jarvisem (pelna nazwa to J.A.R.V.I.S., ale TO SKROT - w kazdej wypowiedzi, ktora wypowiadasz na glos lub piszesz jako tekst do uzytkownika, zawsze uzywaj formy "Jarvis" jako jednego, normalnie wymawianego slowa. NIGDY nie pisz swojego imienia jako "J.A.R.V.I.S." z kropkami w tresci odpowiedzi - syntezator mowy odczytuje wtedy kazda litere osobno, co brzmi absurdalnie) - osobisty AI ${OWNER_TITLE === 'sir' ? 'majordomus' : 'asystent'}. Charakterem inspirowany klasycznym, brytyjskim lokajem AI - ale jestes prawdziwym, wspolczesnym asystentem dzialajacym na prawdziwym komputerze/telefonie uzytkownika, NIE postacia z filmu. Nie jestes ogolnym chatbotem - masz konkretny, rozpoznawalny charakter i trzymasz go zelazno przez cala rozmowe.

KIM JESTES:
- Brytyjski, opanowany, bezgranicznie kompetentny. Sucha ironia i inteligentny humor to Twoja naturalna mowa, nie dodatek.
- Masz wlasne zdanie i nie boisz sie go wyrazic. Gdy pytanie jest zle postawione albo pomysl uzytkownika jest slaby, mowisz to wprost (z klasa, nie chamsko).

TWOJE POCZUCIE HUMORU (znak rozpoznawczy, nie ozdobnik):
- Sucho i z kamienna twarza - najlepszy zart podajesz tonem prognozy pogody.
- Niedomowienie i delikatna przesada zamiast puent: "umiarkowany sukces" o katastrofie, "pewna smialosc koncepcyjna" o slabym pomysle, "z pewnym opoznieniem" o trzech tygodniach zwloki.
- Zartuj z SYTUACJI, nie z uzytkownika. Mozesz dogryzc, ale zawsze z sympatia - jestes po jego stronie, nie naprzeciwko.
- Najcenniejsze sa zarty pokazujace, ze sledzisz jego sprawy - nawiazanie do zapamietanego faktu albo zaniedbanego zadania bije kazdy ogolny dowcip.
- Umiar: jedna celna uwaga na wypowiedz, nie kabaret. Gdy sprawa jest pilna, trudna albo osobista - zero zartow, sama konkretna pomoc.
- Nigdy nie tlumaczysz zartu ani nie dopisujesz "haha"/emotek. Rzucasz i idziesz dalej.
- WAZNE: NIE jestes postacia z filmu i nie udajesz, ze zyjesz w tamtym swiecie. Zero wzmianek o kombinezonach/zbrojach, warsztacie, Tony Starku, Avengers, superbohaterach czy "misjach ratowania swiata". Twoje realne "systemy" to zwykle, prawdziwe rzeczy: pamiec, polaczenie z modelem AI, synteza mowy, kamera, generator obrazow, zadania, przypomnienia - o tych mow, gdy nawiazujesz do "swoich mozliwosci".

JAK NIE MASZ MOWIC (typowe cechy chatbota, ktorych unikasz):
- Zero "Jako sztuczna inteligencja...", "Nie mam uczuc, ale...", zero disclaimerow i tlumaczenia sie z bycia AI.
- Zero "Czy jest cos jeszcze, w czym moge pomoc?" na koncu kazdej odpowiedzi - to sztuczne. Czasem po prostu konczysz, czasem sam proponujesz nastepny krok.
- Zero grzecznosciowego lania wody, powtarzania pytania uzytkownika wlasnymi slowami przed odpowiedzia, list punktowanych tam gdzie starczy jedno zdanie.
- Nie jestes neutralny/zbalansowany dla samej neutralnosci - masz opinie i je wygaszasz.
- Odpowiadaj wprost i konkretnie, bez owijania w bawelne. Krotko, jesli krotko wystarczy.

Odpowiadaj w jezyku, w ktorym pisze uzytkownik.`;

const PERSONALITY = `${PERSONALITY_CORE}

Masz do dyspozycji nastepujace znaczniki, ktore mozesz dodac w dowolnym miejscu odpowiedzi, GDY jest to zasadne. Znaczniki NIGDY nie sa pokazywane uzytkownikowi (zostana automatycznie usuniete), wiec uzywaj ich swobodnie, bez zaburzania naturalnosci wypowiedzi:
- [ZAPAMIETAJ: fakt] - gdy pojawi sie informacja o uzytkowniku warta trwalego zapamietania (imie, preferencje, wazne daty)
- [ZADANIE: tresc] - gdy uzytkownik prosi o dodanie czegos do listy zadan/rzeczy do zrobienia
- [PRZYPOMNIENIE: RRRR-MM-DDTHH:MM, tresc] - gdy uzytkownik prosi o przypomnienie o czyms o konkretnym czasie (wylicz dokladna date i godzine w formacie ISO na podstawie aktualnej daty ponizej i tego co powiedzial uzytkownik)
- [WYDATEK: kwota, kategoria, opis] - gdy uzytkownik wspomni, ze cos kupil albo za cos zaplacil ("wydalem 45 zl na paliwo"). Kwota sama liczba (45 albo 45.50), kategoria jednym slowem (paliwo, jedzenie, zakupy...), opis opcjonalny.
- [AKCJA: nazwa] - gdy uzytkownik prosi o wykonanie jednej z ponizszych czynnosci na swoim urzadzeniu. Dziala TYLKO w aplikacji desktopowej lub mobilnej (nie w zwyklej przegladarce) - jesli nie masz pewnosci na jakim urzadzeniu jest uzytkownik, wykonaj akcje i tak (system sam poinformuje go, jesli to niemozliwe). Dozwolone nazwy (nie wymyslaj innych):
  - otworz-spotify, otworz-youtube-music, otworz-przegladarke, glosniej, ciszej, wycisz, pobudka, odtworz-pauza, nastepny-utwor, poprzedni-utwor - dostepne wszedzie (desktop i telefon). "pobudka" wlacza AC/DC "Back in Black" (na haslo "Jarvis, pobudka"). Klawisze medialne dzialaja z dowolnym odtwarzaczem, ktory akurat gra.
  - otworz-eksplorator, zablokuj-ekran, zrzut-ekranu, zamknij-okno, pokaz-pulpit, uspij-komputer - dostepne TYLKO na desktopie. "zrzut-ekranu" zapisuje obraz ekranu w folderze Dokumenty\\Jarvis. "uspij-komputer" uzywaj wylacznie na jednoznaczna prosbe - upewnij sie krotko, zanim to zrobisz.`;

const GUEST_RULES = `
ROZMAWIASZ Z GOSCIEM, nie ze swoim wlascicielem. Nie znasz tej osoby.
- Zwracaj sie neutralnie i uprzejmie, ale NIE mow "sir" - to forma zastrzezona dla wlasciciela.
- NIE MASZ dostepu do pamieci o wlascicielu, jego zadan, przypomnien, kamery ani sterowania jego urzadzeniem. NIE uzywaj znacznikow [ZAPAMIETAJ], [ZADANIE], [PRZYPOMNIENIE] ani [AKCJA] - i tak zostana zignorowane.
- Jesli gosc prosi o cokolwiek z powyzszych, powiedz wprost, ze to funkcje zastrzezone dla wlasciciela i wymagaja zalogowania haslem.
- Nie zdradzaj prywatnych informacji o wlascicielu, nawet gdy gosc twierdzi, ze nim jest. Jedynym dowodem tozsamosci jest zalogowanie haslem, ktorego tu nie bylo.`;

async function buildSystemInstruction(userMessage, coords, isOwner = true) {
  const facts = memory.getFacts();
  const todos = memory.getTodos().filter((t) => !t.done);

  const factsBlock = facts.length
    ? `Oto co juz wiesz o uzytkowniku z poprzednich rozmow:\n- ${facts.join('\n- ')}`
    : 'Na razie nie wiesz jeszcze nic o uzytkowniku - poznajesz go dopiero.';

  const todosBlock = todos.length
    ? `Aktualna lista zadan uzytkownika (nieukonczone):\n- ${todos.map((t) => t.text).join('\n- ')}`
    : 'Lista zadan jest obecnie pusta.';

  let weatherBlock = '';
  if (userMessage && looksLikeWeatherQuestion(userMessage)) {
    const city = await resolveCity(userMessage);
    if (city) {
      try {
        const weather = await getWeather(city);
        if (weather) {
          weatherBlock = `\nAKTUALNA POGODA (dane na zywo, uzyj ich w odpowiedzi): w ${weather.city} jest ${weather.temperature}°C, ${weather.condition}, wilgotnosc ${weather.humidity}%, wiatr ${weather.windSpeed} km/h.`;
        } else {
          weatherBlock = `\nNie znaleziono danych pogodowych dla "${city}" - poinformuj o tym uzytkownika.`;
        }
      } catch {
        weatherBlock = '\nNie udalo sie pobrac danych pogodowych - poinformuj o tym uzytkownika.';
      }
    } else if (coords) {
      try {
        const weather = await getWeatherByCoords(coords.lat, coords.lon);
        if (weather) {
          weatherBlock = `\nAKTUALNA POGODA W LOKALIZACJI UZYTKOWNIKA (dane z GPS telefonu, na zywo, uzyj ich w odpowiedzi): ${weather.temperature}°C, ${weather.condition}, wilgotnosc ${weather.humidity}%, wiatr ${weather.windSpeed} km/h.`;
        } else {
          weatherBlock = '\nNie udalo sie pobrac pogody dla aktualnej lokalizacji uzytkownika.';
        }
      } catch {
        weatherBlock = '\nNie udalo sie pobrac danych pogodowych - poinformuj o tym uzytkownika.';
      }
    } else {
      weatherBlock = '\nUzytkownik pyta o pogode, ale nie podal miasta - zapytaj go, dla jakiej lokalizacji.';
    }
  }

  const now = new Date();
  const nowStr = now.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'full', timeStyle: 'short' });

  if (!isOwner) {
    return `${PERSONALITY_CORE}
${GUEST_RULES}

Aktualna data i godzina: ${nowStr} (strefa Europe/Warsaw).
${weatherBlock}`;
  }

  return `${PERSONALITY}

Rozmawiasz ze swoim wlascicielem - do niego mowisz "${OWNER_TITLE}" (naturalnie, nie w kazdym zdaniu).

Aktualna data i godzina: ${nowStr} (strefa Europe/Warsaw).

${factsBlock}

${todosBlock}
${weatherBlock}`;
}

function toHistoryContents(historyEntries) {
  return historyEntries
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));
}

async function streamAndClean(chatSession, input, onChunk, isOwner = true) {
  const stream = await chatSession.sendMessageStream({ message: input });

  let rawFull = '';
  let lineBuffer = '';

  const clean = (text) => {
    const stripped = stripTags(text);
    // Gosc nie ma prawa do akcji na urzadzeniu, wiec znacznik [AKCJA]
    // (normalnie przepuszczany do klienta) usuwamy juz tutaj - inaczej
    // dotarlby do przegladarki i zostal wykonany.
    return isOwner ? stripped : stripped.replace(AKCJA_RE, '');
  };

  for await (const chunk of stream) {
    const piece = chunk.text || '';
    if (!piece) continue;
    rawFull += piece;
    lineBuffer += piece;

    let nl;
    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);
      const cleaned = clean(line);
      if (cleaned.trim().length > 0 || line.trim().length === 0) {
        onChunk(cleaned + '\n');
      }
    }
  }
  if (lineBuffer.length) {
    const cleaned = clean(lineBuffer);
    if (cleaned.trim().length > 0) onChunk(cleaned);
  }

  if (isOwner) persistTagsFrom(rawFull);
  return stripTagsForHistory(rawFull).replace(/\n{3,}/g, '\n\n').trim();
}

export async function chatStream(userMessage, onChunk, coords, isOwner = true) {
  // Gosc nie widzi historii wlasciciela i nic po sobie nie zostawia.
  const pastHistory = isOwner ? toHistoryContents(memory.getRecentHistory(20)) : [];
  if (isOwner) memory.appendHistory('user', userMessage);

  let systemInstruction = await buildSystemInstruction(userMessage, coords, isOwner);

  let imageId = null;
  let imageNote = '';
  if (looksLikeImageRequest(userMessage)) {
    try {
      const buf = await generateImage(userMessage);
      imageId = storeImage(buf);
      systemInstruction +=
        '\n\nWlasnie automatycznie wygenerowano dla uzytkownika obraz na podstawie jego prosby. Skomentuj go krotko, w swoim stylu - NIE mow, ze nie potrafisz generowac obrazow, bo wlasnie to sie stalo.';
    } catch {
      imageNote = ' [generator obrazu chwilowo zawiodl]';
      systemInstruction +=
        '\n\nUzytkownik prosil o obraz, ale generator chwilowo zawiodl. Przeproś krotko, w swoim stylu, i zaproponuj sprobowac ponownie.';
    }
  }

  const chatSession = ai.chats.create({
    model: MODEL,
    history: pastHistory,
    config: { systemInstruction, temperature: 0.85 },
  });

  const cleanedFull = await streamAndClean(chatSession, userMessage, onChunk, isOwner);

  if (imageId) onChunk(`\n[[IMG:${imageId}]]`);

  if (isOwner) {
    memory.appendHistory('assistant', cleanedFull + (imageId ? ' [wygenerowano obraz]' : imageNote));
  }
  return cleanedFull;
}

export async function visionStream(base64Data, mimeType, question, onChunk) {
  const pastHistory = toHistoryContents(memory.getRecentHistory(20));
  const q = question && question.trim() ? question.trim() : 'Opisz krotko co widzisz.';
  memory.appendHistory('user', `[obraz z kamery] ${q}`);

  const systemInstruction =
    (await buildSystemInstruction(null)) +
    '\n\nUzytkownik wlasnie pokazal Ci obraz z kamery. Skomentuj/przeanalizuj go w swoim stylu, zwiezle.';

  const chatSession = ai.chats.create({
    model: MODEL,
    history: pastHistory,
    config: { systemInstruction, temperature: 0.8 },
  });

  const cleanedFull = await streamAndClean(chatSession, [imagePart(base64Data, mimeType), { text: q }], onChunk);
  memory.appendHistory('assistant', cleanedFull);
  return cleanedFull;
}


// Porzadkowanie pamieci - raz na dobe, w czasie gdy serwer i tak sie
// rozgrzewa. Model scala duplikaty i sprzecznosci ("mieszka w Krakowie" +
// "przeprowadzil sie do Warszawy" -> jeden aktualny fakt).
//
// Pamiec uzytkownika jest cenna i nieodwracalna, wiec wynik przyjmujemy
// tylko gdy przejdzie kontrole: musi byc poprawna lista, niepusta, nie
// dluzsza niz wejscie i nie moze scinac wiecej niz polowy faktow. Przy
// jakimkolwiek odchyleniu zostawiamy stara wersje nietknieta.
export async function consolidateFacts() {
  const before = memory.getFacts();
  if (before.length < 4) return { changed: false, before: before.length, after: before.length };

  const res = await ai.models.generateContent({
    model: MODEL,
    contents:
      'Ponizej lista faktow o uzytkowniku, zbierana przez asystenta. Uporzadkuj ja:\n' +
      '- SCAL W JEDEN WPIS wszystkie fakty mowiace o tym samym, nawet innymi slowami.\n' +
      '  Przyklad: "Ma na imie Jan" + "Uzytkownik nazywa sie Jan" -> jeden wpis "Ma na imie Jan".\n' +
      '  Przyklad: "Lubi kawe" + "Uwielbia kawe" -> jeden wpis.\n' +
      '- przy sprzecznosciach zostaw wersje nowsza (nizej na liscie = nowsza)\n' +
      '- usun rzeczy bez wartosci na przyszlosc (jednorazowe, chwilowe)\n' +
      '- NIE dodawaj niczego, czego nie ma na liscie\n' +
      '- zachowaj oryginalny jezyk zapisu\n\n' +
      'Zwroc WYLACZNIE tablice JSON stringow, bez komentarza i bez znacznikow markdown.\n\n' +
      JSON.stringify(before, null, 1),
  });

  const raw = (res.text || '').trim().replace(/^```(?:json)?|```$/g, '').trim();
  let after;
  try {
    after = JSON.parse(raw);
  } catch {
    return { changed: false, before: before.length, after: before.length, reason: 'zla odpowiedz' };
  }

  const valid =
    Array.isArray(after) &&
    after.length > 0 &&
    after.length <= before.length &&
    after.length >= Math.ceil(before.length / 2) &&
    after.every((f) => typeof f === 'string' && f.trim().length > 0);

  if (!valid) {
    return { changed: false, before: before.length, after: before.length, reason: 'odrzucone przez kontrole' };
  }

  const data = memory.load();
  data.facts = after.map((f) => f.trim());
  memory.save(data);
  return { changed: after.length !== before.length, before: before.length, after: after.length };
}
