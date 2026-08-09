// Przekaznik do Gemini Live API - dwukierunkowy strumien audio w czasie
// rzeczywistym (zamiast nagraj->transkrybuj->czat->syntezuj), dokladnie jak
// w referencyjnym projekcie. Klient wysyla surowe probki PCM 16kHz binarnie
// przez WebSocket, serwer przekazuje je do Gemini i odsyla z powrotem
// audio PCM 24kHz, ktore klient odtwarza na biezaco.

import { GoogleGenAI, Modality } from '@google/genai';
import * as memory from './memory.js';
import { getWeather } from './weather.js';
import { PERSONALITY_CORE } from './jarvis.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const VOICE_NAME = process.env.GEMINI_LIVE_VOICE || 'Orus';

function buildLiveSystemInstruction() {
  const facts = memory.getFacts();
  const todos = memory.getTodos().filter((t) => !t.done);
  const factsBlock = facts.length
    ? `Znane fakty o uzytkowniku:\n- ${facts.join('\n- ')}`
    : 'Nie znasz jeszcze uzytkownika - kazdy nowy fakt o nim zapisuj przez narzedzie zapamietaj.';
  const todosBlock = todos.length
    ? `Otwarte zadania:\n- ${todos.map((t) => t.text).join('\n- ')}`
    : 'Lista zadan jest obecnie pusta.';

  const now = new Date();
  const nowStr = now.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'full', timeStyle: 'short' });

  return `${PERSONALITY_CORE}

To rozmowa GLOSOWA na zywo (nie pisana) - mow krotkimi, naturalnie brzmiacymi zdaniami jak w prawdziwej rozmowie. Gdy wymawiasz wlasne imie, mow "Jarvis" plynnie jako jedno slowo - NIGDY nie wymawiaj go litera po literze ("dzej, ej, er...").

Masz REALNY dostep do ponizszych narzedzi - to prawdziwe funkcje, ktore faktycznie zapisuja dane w systemie, a nie teoria. Wywoluj je w tle bez komentowania tego na glos ("wywoluje funkcje", "zapisuje w systemie" - tego nie mowisz), po prostu wykonaj akcje i potwierdz normalnym zdaniem:
- zapamietaj: gdy uzytkownik powie o sobie cokolwiek wartego trwalego zapamietania (imie, preferencje, wazne daty, fakty) - ZAWSZE faktycznie wywolaj to narzedzie, nie tylko obiecuj, ze zapamietasz.
- dodaj_zadanie: gdy uzytkownik poprosi o dodanie czegos do listy zadan/rzeczy do zrobienia - ZAWSZE wywolaj to narzedzie. Masz do tego pelny dostep - nigdy nie mow, ze nie potrafisz albo nie masz uprawnien do dodania zadania.
- dodaj_przypomnienie: gdy uzytkownik poprosi o przypomnienie o czyms w konkretnym momencie - wylicz dokladna date i godzine w formacie ISO (RRRR-MM-DDTHH:MM) na podstawie aktualnej daty ponizej i tego, co powiedzial, i wywolaj to narzedzie.
- sprawdz_pogode: gdy uzytkownik pyta o pogode dla konkretnego miasta.

Aktualna data i godzina: ${nowStr} (strefa Europe/Warsaw).

${factsBlock}

${todosBlock}`;
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'zapamietaj',
        description: 'Zapisz na stale istotny fakt o uzytkowniku (imie, preferencje, wazne daty).',
        parameters: { type: 'object', properties: { fakt: { type: 'string' } }, required: ['fakt'] },
      },
      {
        name: 'dodaj_zadanie',
        description: 'Dodaj cos do listy zadan uzytkownika.',
        parameters: { type: 'object', properties: { tresc: { type: 'string' } }, required: ['tresc'] },
      },
      {
        name: 'dodaj_przypomnienie',
        description: 'Dodaj przypomnienie o okreslonej tresci na konkretna date i godzine.',
        parameters: {
          type: 'object',
          properties: {
            tresc: { type: 'string' },
            kiedy: { type: 'string', description: 'Data i godzina w formacie ISO RRRR-MM-DDTHH:MM' },
          },
          required: ['tresc', 'kiedy'],
        },
      },
      {
        name: 'sprawdz_pogode',
        description: 'Pobierz aktualna pogode na zywo dla podanego miasta.',
        parameters: { type: 'object', properties: { miasto: { type: 'string' } }, required: ['miasto'] },
      },
    ],
  },
];

async function executeTool(name, args) {
  switch (name) {
    case 'zapamietaj':
      memory.addFacts([args.fakt]);
      return { ok: true };
    case 'dodaj_zadanie':
      memory.addTodo(args.tresc);
      return { ok: true };
    case 'dodaj_przypomnienie':
      memory.addReminder(args.tresc, args.kiedy);
      return { ok: true };
    case 'sprawdz_pogode': {
      try {
        const w = await getWeather(args.miasto);
        if (!w) return { error: 'nie znaleziono lokalizacji' };
        return { temperatura: w.temperature, warunki: w.condition, wilgotnosc: w.humidity, wiatr: w.windSpeed };
      } catch {
        return { error: 'blad pobierania pogody' };
      }
    }
    default:
      return { error: 'nieznana funkcja' };
  }
}

export async function attachVoiceRelay(clientWs) {
  let liveSession = null;
  let closed = false;
  let assistantTranscript = '';
  let userTranscript = '';

  const safeSend = (payload) => {
    if (clientWs.readyState === clientWs.OPEN) clientWs.send(payload);
  };

  try {
    liveSession = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildLiveSystemInstruction(),
        tools: TOOLS,
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
      },
      callbacks: {
        onopen: () => safeSend(JSON.stringify({ type: 'ready' })),
        onmessage: async (msg) => {
          if (closed) return;

          if (msg.data) {
            const buf = typeof msg.data === 'string' ? Buffer.from(msg.data, 'base64') : Buffer.from(msg.data);
            safeSend(buf);
          }

          if (msg.toolCall) {
            for (const call of msg.toolCall.functionCalls || []) {
              const result = await executeTool(call.name, call.args || {});
              liveSession.sendToolResponse({
                functionResponses: [{ id: call.id, name: call.name, response: result }],
              });
            }
          }

          if (msg.serverContent?.outputTranscription?.text) {
            assistantTranscript += msg.serverContent.outputTranscription.text;
          }
          if (msg.serverContent?.inputTranscription?.text) {
            userTranscript += msg.serverContent.inputTranscription.text;
          }
          if (msg.serverContent?.interrupted) {
            safeSend(JSON.stringify({ type: 'interrupted' }));
          }
          if (msg.serverContent?.turnComplete) {
            if (userTranscript.trim()) memory.appendHistory('user', userTranscript.trim());
            if (assistantTranscript.trim()) memory.appendHistory('assistant', assistantTranscript.trim());
            safeSend(
              JSON.stringify({
                type: 'turnComplete',
                userText: userTranscript.trim(),
                assistantText: assistantTranscript.trim(),
              })
            );
            userTranscript = '';
            assistantTranscript = '';
          }
        },
        onerror: (e) => safeSend(JSON.stringify({ type: 'error', message: e.message || String(e) })),
        onclose: () => safeSend(JSON.stringify({ type: 'closed' })),
      },
    });
  } catch (err) {
    safeSend(JSON.stringify({ type: 'error', message: err.message }));
    clientWs.close();
    return;
  }

  clientWs.on('message', (data, isBinary) => {
    if (isBinary) {
      liveSession.sendRealtimeInput({ audio: { data: data.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
    } else {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'end') liveSession.close();
      } catch {
        /* noop */
      }
    }
  });

  clientWs.on('close', () => {
    closed = true;
    try {
      liveSession.close();
    } catch {
      /* noop */
    }
  });
}
