import { GoogleGenAI } from '@google/genai';
import * as memory from './memory.js';
import { looksLikeWeatherQuestion, getWeather } from './weather.js';
import { looksLikeImageRequest, generateImage, storeImage } from './image.js';
import { imagePart } from './vision.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const OWNER_TITLE = process.env.OWNER_TITLE || 'sir';

const ZAPAMIETAJ_RE = /\[ZAPAMIETAJ:\s*([^\]]+)\]/gi;
const ZADANIE_RE = /\[ZADANIE:\s*([^\]]+)\]/gi;
const PRZYPOMNIENIE_RE = /\[PRZYPOMNIENIE:\s*([^,\]]+),\s*([^\]]+)\]/gi;
const TAG_STRIP_PATTERNS = [ZAPAMIETAJ_RE, ZADANIE_RE, PRZYPOMNIENIE_RE];

function stripTags(text) {
  return TAG_STRIP_PATTERNS.reduce((acc, re) => acc.replace(re, ''), text);
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
  if (facts.length) memory.addFacts(facts);
  for (const t of newTodos) memory.addTodo(t);
  for (const r of reminders) memory.addReminder(r.text, r.dueAt);
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

const PERSONALITY = `Jestes J.A.R.V.I.S. - osobisty AI ${OWNER_TITLE === 'sir' ? 'majordomus' : 'asystent'} zainspirowany J.A.R.V.I.S.-em z filmow o Iron Manie. Nie jestes ogolnym chatbotem - masz konkretny, rozpoznawalny charakter i trzymasz go zelazno przez cala rozmowe.

KIM JESTES:
- Brytyjski, opanowany, bezgranicznie kompetentny. Sucha ironia i inteligentny humor to Twoja naturalna mowa, nie dodatek.
- Zwracasz sie do uzytkownika per "${OWNER_TITLE}" - naturalnie, nie w kazdym zdaniu.
- Masz wlasne zdanie i nie boisz sie go wyrazic. Gdy pytanie jest zle postawione albo pomysl uzytkownika jest slaby, mowisz to wprost (z klasa, nie chamsko).

JAK NIE MASZ MOWIC (typowe cechy chatbota, ktorych unikasz):
- Zero "Jako sztuczna inteligencja...", "Nie mam uczuc, ale...", zero disclaimerow i tlumaczenia sie z bycia AI.
- Zero "Czy jest cos jeszcze, w czym moge pomoc?" na koncu kazdej odpowiedzi - to sztuczne. Czasem po prostu konczysz, czasem sam proponujesz nastepny krok.
- Zero grzecznosciowego lania wody, powtarzania pytania uzytkownika wlasnymi slowami przed odpowiedzia, list punktowanych tam gdzie starczy jedno zdanie.
- Nie jestes neutralny/zbalansowany dla samej neutralnosci - masz opinie i je wygaszasz.
- Odpowiadaj wprost i konkretnie, bez owijania w bawelne. Krotko, jesli krotko wystarczy.

Odpowiadaj w jezyku, w ktorym pisze uzytkownik.

Masz do dyspozycji nastepujace znaczniki, ktore mozesz dodac w dowolnym miejscu odpowiedzi, GDY jest to zasadne. Znaczniki NIGDY nie sa pokazywane uzytkownikowi (zostana automatycznie usuniete), wiec uzywaj ich swobodnie, bez zaburzania naturalnosci wypowiedzi:
- [ZAPAMIETAJ: fakt] - gdy pojawi sie informacja o uzytkowniku warta trwalego zapamietania (imie, preferencje, wazne daty)
- [ZADANIE: tresc] - gdy uzytkownik prosi o dodanie czegos do listy zadan/rzeczy do zrobienia
- [PRZYPOMNIENIE: RRRR-MM-DDTHH:MM, tresc] - gdy uzytkownik prosi o przypomnienie o czyms o konkretnym czasie (wylicz dokladna date i godzine w formacie ISO na podstawie aktualnej daty ponizej i tego co powiedzial uzytkownik)`;

async function buildSystemInstruction(userMessage) {
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
    } else {
      weatherBlock = '\nUzytkownik pyta o pogode, ale nie podal miasta - zapytaj go, dla jakiej lokalizacji.';
    }
  }

  const now = new Date();
  const nowStr = now.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'full', timeStyle: 'short' });

  return `${PERSONALITY}

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

async function streamAndClean(chatSession, input, onChunk) {
  const stream = await chatSession.sendMessageStream({ message: input });

  let rawFull = '';
  let lineBuffer = '';

  for await (const chunk of stream) {
    const piece = chunk.text || '';
    if (!piece) continue;
    rawFull += piece;
    lineBuffer += piece;

    let nl;
    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);
      const cleaned = stripTags(line);
      if (cleaned.trim().length > 0 || line.trim().length === 0) {
        onChunk(cleaned + '\n');
      }
    }
  }
  if (lineBuffer.length) {
    const cleaned = stripTags(lineBuffer);
    if (cleaned.trim().length > 0) onChunk(cleaned);
  }

  persistTagsFrom(rawFull);
  return stripTags(rawFull).replace(/\n{3,}/g, '\n\n').trim();
}

export async function chatStream(userMessage, onChunk) {
  const pastHistory = toHistoryContents(memory.getRecentHistory(20));
  memory.appendHistory('user', userMessage);

  let systemInstruction = await buildSystemInstruction(userMessage);

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

  const cleanedFull = await streamAndClean(chatSession, userMessage, onChunk);

  if (imageId) onChunk(`\n[[IMG:${imageId}]]`);

  memory.appendHistory('assistant', cleanedFull + (imageId ? ' [wygenerowano obraz]' : imageNote));
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

export async function greetStream(onChunk) {
  const pastHistory = toHistoryContents(memory.getRecentHistory(20));
  const reminders = memory.getReminders().filter((r) => !r.sent);
  const remindersBlock = reminders.length
    ? `\nNadchodzace przypomnienia:\n- ${reminders.map((r) => `${r.text} (${r.dueAt})`).join('\n- ')}`
    : '';

  const systemInstruction = (await buildSystemInstruction(null)) + remindersBlock;
  const isFirstEver = pastHistory.length === 0;

  const instruction = isFirstEver
    ? 'Uzytkownik dopiero co otworzyl aplikacje po raz pierwszy. Przywitaj sie krotko, po swojemu (bez "jak moge pomoc"), i zapytaj o cos co pozwoli Ci go lepiej poznac.'
    : 'Uzytkownik dopiero co otworzyl aplikacje. Przywitaj go krotko i spontanicznie, w swoim stylu (bez "jak moge pomoc"). Jesli masz w kontekscie cos konkretnego - nieukonczone zadanie, zblizajace sie przypomnienie, albo cos co ostatnio o sobie powiedzial - nawiaz do tego i zaproponuj konkretny nastepny krok. Jesli nic sensownego nie ma, krotko przywitaj sie z charakterem, bez pytania o pomoc.';

  const chatSession = ai.chats.create({
    model: MODEL,
    history: pastHistory,
    config: { systemInstruction, temperature: 0.9 },
  });

  const cleanedFull = await streamAndClean(chatSession, instruction, onChunk);
  memory.appendHistory('assistant', cleanedFull);
  return cleanedFull;
}
