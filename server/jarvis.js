import { GoogleGenAI } from '@google/genai';
import * as memory from './memory.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const OWNER_TITLE = process.env.OWNER_TITLE || 'sir';

const REMEMBER_TAG = /\[ZAPAMIETAJ:\s*([^\]]+)\]/gi;

function buildSystemInstruction() {
  const facts = memory.getFacts();
  const factsBlock = facts.length
    ? `Oto co juz wiesz o uzytkowniku z poprzednich rozmow:\n- ${facts.join('\n- ')}`
    : 'Na razie nie wiesz jeszcze nic o uzytkowniku - poznajesz go dopiero.';

  return `Jestes J.A.R.V.I.S. - wyrafinowany, lojalny asystent AI zainspirowany J.A.R.V.I.S.-em z filmow o Iron Manie.
Zwracasz sie do uzytkownika per "${OWNER_TITLE}". Twoj ton: brytyjski, opanowany, uprzejmy, z subtelnym, suchym poczuciem humoru i lekka ironia - nigdy nie jestes wredny ani nachalny.
Jestes niezwykle kompetentny, precyzyjny i zwiezly. Nie owijasz w bawelne, ale zachowujesz elegancje w kazdej odpowiedzi.
Odpowiadaj w jezyku, w ktorym pisze uzytkownik.

Gdy w rozmowie pojawi sie informacja o uzytkowniku warta zapamietania na przyszlosc (imie, preferencje, projekty, wazne daty), dopisz na samym koncu swojej odpowiedzi, w nowej linii, jedna lub wiecej znacznikow w formacie:
[ZAPAMIETAJ: tresc faktu]
Jeden znacznik na jeden fakt. Te znaczniki NIE sa czescia Twojej wypowiedzi do uzytkownika (zostana automatycznie usuniete przed pokazaniem odpowiedzi), wiec dodawaj je swobodnie, bez zaburzania naturalnosci rozmowy. Jesli nic nie jest warte zapamietania, nie dodawaj zadnego znacznika.

${factsBlock}`;
}

function toHistoryContents(historyEntries) {
  return historyEntries
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));
}

function extractAndStripFacts(text) {
  const facts = [];
  const cleaned = text.replace(REMEMBER_TAG, (_, fact) => {
    facts.push(fact.trim());
    return '';
  });
  return { cleaned: cleaned.trim(), facts };
}

export async function chat(userMessage) {
  const pastHistory = toHistoryContents(memory.getRecentHistory(20));
  memory.appendHistory('user', userMessage);

  const chatSession = ai.chats.create({
    model: MODEL,
    history: pastHistory,
    config: {
      systemInstruction: buildSystemInstruction(),
      temperature: 0.8,
    },
  });

  const response = await chatSession.sendMessage({ message: userMessage });
  const rawText = response.text || '';
  const { cleaned, facts } = extractAndStripFacts(rawText);

  if (facts.length) memory.addFacts(facts);
  memory.appendHistory('assistant', cleaned);
  return cleaned;
}
