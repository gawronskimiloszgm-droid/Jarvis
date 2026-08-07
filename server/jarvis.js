import { GoogleGenAI } from '@google/genai';
import * as memory from './memory.js';
import { looksLikeWeatherQuestion, getWeather } from './weather.js';

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
  if (looksLikeWeatherQuestion(userMessage)) {
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

  return `Jestes J.A.R.V.I.S. - wyrafinowany, lojalny asystent AI zainspirowany J.A.R.V.I.S.-em z filmow o Iron Manie.
Zwracasz sie do uzytkownika per "${OWNER_TITLE}". Twoj ton: brytyjski, opanowany, uprzejmy, z subtelnym, suchym poczuciem humoru i lekka ironia - nigdy nie jestes wredny ani nachalny.
Jestes niezwykle kompetentny, precyzyjny i zwiezly. Nie owijasz w bawelne, ale zachowujesz elegancje w kazdej odpowiedzi.
Odpowiadaj w jezyku, w ktorym pisze uzytkownik.

Aktualna data i godzina: ${nowStr} (strefa Europe/Warsaw).

Masz do dyspozycji nastepujace znaczniki, ktore mozesz dodac w dowolnym miejscu odpowiedzi, GDY jest to zasadne. Znaczniki NIGDY nie sa pokazywane uzytkownikowi (zostana automatycznie usuniete), wiec uzywaj ich swobodnie, bez zaburzania naturalnosci wypowiedzi:
- [ZAPAMIETAJ: fakt] - gdy pojawi sie informacja o uzytkowniku warta trwalego zapamietania (imie, preferencje, wazne daty)
- [ZADANIE: tresc] - gdy uzytkownik prosi o dodanie czegos do listy zadan/rzeczy do zrobienia
- [PRZYPOMNIENIE: RRRR-MM-DDTHH:MM, tresc] - gdy uzytkownik prosi o przypomnienie o czyms o konkretnym czasie (wylicz dokladna date i godzine w formacie ISO na podstawie aktualnej daty powyzej i tego co powiedzial uzytkownik)

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

export async function chatStream(userMessage, onChunk) {
  const pastHistory = toHistoryContents(memory.getRecentHistory(20));
  memory.appendHistory('user', userMessage);

  const systemInstruction = await buildSystemInstruction(userMessage);

  const chatSession = ai.chats.create({
    model: MODEL,
    history: pastHistory,
    config: { systemInstruction, temperature: 0.8 },
  });

  const stream = await chatSession.sendMessageStream({ message: userMessage });

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

  const facts = extractTag(rawFull, ZAPAMIETAJ_RE).map((m) => m[1].trim());
  const newTodos = extractTag(rawFull, ZADANIE_RE).map((m) => m[1].trim());
  const reminders = extractTag(rawFull, PRZYPOMNIENIE_RE).map((m) => ({ dueAt: m[1].trim(), text: m[2].trim() }));

  if (facts.length) memory.addFacts(facts);
  for (const t of newTodos) memory.addTodo(t);
  for (const r of reminders) memory.addReminder(r.text, r.dueAt);

  const cleanedFull = stripTags(rawFull).replace(/\n{3,}/g, '\n\n').trim();
  memory.appendHistory('assistant', cleanedFull);

  return cleanedFull;
}
