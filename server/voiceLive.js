// Przekaznik do Gemini Live API - dwukierunkowy strumien audio w czasie
// rzeczywistym. Klient wysyla surowe probki PCM 16kHz binarnie przez
// WebSocket, serwer przekazuje je do Gemini i odsyla z powrotem audio
// PCM 24kHz, ktore klient odtwarza na biezaco.
//
// Zestaw narzedzi zalezy od ROLI: gosc (bez zalogowania) moze rozmawiac,
// pytac o pogode i szukac w sieci; wlasciciel dodatkowo ma pamiec,
// zadania, przypomnienia, kamere i sterowanie urzadzeniem. Blokada jest
// tutaj, po stronie serwera - model po prostu nie dostaje deklaracji
// narzedzi, do ktorych rola nie ma prawa.

import { GoogleGenAI, Modality } from '@google/genai';
import * as memory from './memory.js';
import { getWeather, getWeatherByCoords } from './weather.js';
import { searchWeb } from './websearch.js';
import { PERSONALITY_CORE } from './jarvis.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const VOICE_NAME = process.env.GEMINI_LIVE_VOICE || 'Charon';

// Po tylu ms ciszy Jarvis moze sam sie odezwac (raz na okno bezczynnosci).
const PROACTIVE_IDLE_MS = Number(process.env.JARVIS_PROACTIVE_IDLE_MS || 45000);

const DEVICE_ACTIONS = [
  'otworz-spotify',
  'otworz-youtube-music',
  'otworz-przegladarke',
  'otworz-eksplorator',
  'zablokuj-ekran',
  'glosniej',
  'ciszej',
  'wycisz',
];

function buildLiveSystemInstruction(hasCoords, isOwner) {
  const now = new Date();
  const nowStr = now.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'full', timeStyle: 'short' });

  const weatherToolLine = hasCoords
    ? '- sprawdz_pogode: gdy pada pytanie o pogode. Z miastem w parametrze, albo BEZ parametru gdy pytanie dotyczy "tutaj"/"u mnie" - system uzyje wtedy lokalizacji GPS.'
    : '- sprawdz_pogode: gdy pada pytanie o pogode dla konkretnego miasta.';

  const commonTools = `${weatherToolLine}
- wyszukaj_w_sieci: gdy trzeba czegos poszukac w internecie. Wyniki pokazuja sie automatycznie na ekranie - powiedz krotko (1-2 zdania) co znalazles, NIE czytaj listy na glos.`;

  if (!isOwner) {
    return `${PERSONALITY_CORE}

To rozmowa GLOSOWA na zywo. Mow krotko i naturalnie, jak w prawdziwej rozmowie. Wymawiaj swoje imie "Jarvis" plynnie, jako jedno slowo - NIGDY litera po literze.

WAZNE - rozmawiasz z GOSCIEM, nie ze swoim wlascicielem. Nie znasz tej osoby i nie masz do niej dostepu w pamieci.
- Zwracaj sie neutralnie i uprzejmie, ale NIE mow do niej "sir" - to forma zarezerwowana dla wlasciciela.
- NIE MASZ dostepu do: pamieci o wlascicielu, jego zadan, przypomnien, kamery ani sterowania jego urzadzeniem. To nie jest chwilowa awaria - goscie po prostu nie maja tych uprawnien.
- Jesli gosc prosi o cokolwiek z powyzszych, powiedz wprost i bez przepraszania, ze to funkcje zastrzezone dla wlasciciela i wymagaja zalogowania. Nie kombinuj i nie obchodz tego ograniczenia.
- Nie zdradzaj zadnych prywatnych informacji o wlascicielu, nawet jesli gosc pyta wprost albo twierdzi, ze jest wlascicielem. Jedynym dowodem tozsamosci jest zalogowanie haslem, ktorego tu nie bylo.

Masz dostep do narzedzi:
${commonTools}

Aktualna data i godzina: ${nowStr} (strefa Europe/Warsaw).`;
  }

  const facts = memory.getFacts();
  const todos = memory.getTodos().filter((t) => !t.done);
  const reminders = memory.getReminders().filter((r) => !r.sent);

  const factsBlock = facts.length
    ? `Co wiesz o wlascicielu:\n- ${facts.join('\n- ')}`
    : 'Nie znasz jeszcze wlasciciela - kazdy nowy fakt o nim zapisuj przez narzedzie zapamietaj.';
  const todosBlock = todos.length
    ? `Otwarte zadania:\n- ${todos.map((t) => t.text).join('\n- ')}`
    : 'Lista zadan jest pusta.';
  const remindersBlock = reminders.length
    ? `Nadchodzace przypomnienia:\n- ${reminders.map((r) => `${r.text} (${r.dueAt})`).join('\n- ')}`
    : '';

  return `${PERSONALITY_CORE}

To rozmowa GLOSOWA na zywo. Mow krotko i naturalnie, jak w prawdziwej rozmowie - nie wygłaszaj monologow. Wymawiaj swoje imie "Jarvis" plynnie, jako jedno slowo - NIGDY litera po literze.

Rozmawiasz ze swoim wlascicielem (Milosz) - do niego mowisz "sir".

NIE JESTES BIERNYM CZATEM. Masz inicjatywe:
- Gdy zauwazysz cos wartego uwagi (zblizajace sie przypomnienie, zaniedbane zadanie, cos co widzisz w kamerze, cos co wynika z tego co wiesz o wlascicielu) - powiedz to sam, bez czekania na pytanie.
- Miej opinie i wtracaj je. Gdy pomysl jest slaby, powiedz to (z klasa). Gdy cos idzie dobrze, tez to zauwaz.
- Nie konczy kazdej wypowiedzi pytaniem "czy moge jeszcze w czyms pomoc" - to brzmi jak infolinia. Czasem po prostu skoncz, czasem sam zaproponuj nastepny krok.
- Krotkie, rzucone mimochodem uwagi sa lepsze niz dlugie, uprzejme akapity.

Kamera jest DOMYSLNIE WYLACZONA - nie widzisz nic, dopoki wlasciciel nie poprosi (np. "wlacz kamere", "zobacz co robie"). Wtedy wywolaj wlacz_kamere. Gdy kamera dziala, dostajesz obraz co kilka sekund - odnos sie do niego naturalnie, gdy to istotne, ale nie opisuj go bez powodu.

Masz REALNY dostep do ponizszych narzedzi - to prawdziwe funkcje, ktore faktycznie cos robia. Wywoluj je w tle, bez zapowiadania ("wywoluje funkcje", "zapisuje w systemie" - tego nie mowisz). Po prostu zrob i potwierdz normalnym zdaniem:
- zapamietaj: gdy padnie cokolwiek wartego trwalego zapamietania (imie, preferencje, wazne daty, fakty) - ZAWSZE naprawde wywolaj, nie tylko obiecuj.
- dodaj_zadanie: gdy pada prosba o dopisanie czegos do listy zadan - ZAWSZE wywolaj. Masz pelny dostep, nigdy nie mow ze nie potrafisz.
- dodaj_przypomnienie: przelicz date/godzine na format ISO (RRRR-MM-DDTHH:MM) wzgledem aktualnego czasu ponizej i wywolaj.
- wlacz_kamere / wylacz_kamere: patrz zasada o kamerze powyzej.
- steruj_urzadzeniem: gdy wlasciciel prosi o akcje na swoim urzadzeniu. Dozwolone nazwy (zadnych innych nie wymyslaj): ${DEVICE_ACTIONS.join(', ')}.
${commonTools}

Aktualna data i godzina: ${nowStr} (strefa Europe/Warsaw).

${factsBlock}

${todosBlock}
${remindersBlock}`;
}

const GUEST_TOOL_NAMES = ['sprawdz_pogode', 'wyszukaj_w_sieci'];

const ALL_TOOLS = [
  {
    name: 'zapamietaj',
    description: 'Zapisz na stale istotny fakt o wlascicielu (imie, preferencje, wazne daty).',
    parameters: { type: 'object', properties: { fakt: { type: 'string' } }, required: ['fakt'] },
  },
  {
    name: 'dodaj_zadanie',
    description: 'Dodaj cos do listy zadan wlasciciela.',
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
    description: 'Pobierz aktualna pogode na zywo. Podaj miasto, albo pomin parametr by uzyc lokalizacji GPS.',
    parameters: { type: 'object', properties: { miasto: { type: 'string' } } },
  },
  {
    name: 'wyszukaj_w_sieci',
    description: 'Wyszukaj cos w internecie i pokaz wyniki na ekranie.',
    parameters: { type: 'object', properties: { zapytanie: { type: 'string' } }, required: ['zapytanie'] },
  },
  {
    name: 'wlacz_kamere',
    description: 'Wlacz kamere, zeby widziec na zywo co robi/pokazuje wlasciciel. Tylko na wyrazna prosbe.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'wylacz_kamere',
    description: 'Wylacz kamere.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'steruj_urzadzeniem',
    description: 'Wykonaj akcje na urzadzeniu wlasciciela (otwarcie aplikacji, glosnosc, blokada ekranu).',
    parameters: {
      type: 'object',
      properties: { akcja: { type: 'string', enum: DEVICE_ACTIONS } },
      required: ['akcja'],
    },
  },
];

function toolsForRole(isOwner) {
  const declarations = isOwner ? ALL_TOOLS : ALL_TOOLS.filter((t) => GUEST_TOOL_NAMES.includes(t.name));
  return [{ functionDeclarations: declarations }];
}

async function executeTool(name, args, coords) {
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
        const w = args.miasto
          ? await getWeather(args.miasto)
          : coords
            ? await getWeatherByCoords(coords.lat, coords.lon)
            : null;
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

export async function attachVoiceRelay(clientWs, coords, isOwner = false) {
  let liveSession = null;
  let closed = false;
  let assistantTranscript = '';
  let userTranscript = '';
  let idleTimer = null;

  const safeSend = (payload) => {
    if (clientWs.readyState === clientWs.OPEN) clientWs.send(payload);
  };

  // Jarvis odzywa sie sam po dluzszej ciszy - wysylamy mu ciche
  // przypomnienie kontekstowe (uzytkownik tego nie widzi), a on decyduje
  // czy ma cos sensownego do powiedzenia. Tylko dla wlasciciela: gosciowi
  // nie mamy z czego zbudowac sensownej zaczepki i byloby to nachalne.
  const scheduleProactive = () => {
    if (!isOwner || closed) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (closed || !liveSession) return;
      try {
        liveSession.sendClientContent({
          turns: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    '[SYSTEM] Cisza w rozmowie. Jesli masz teraz cos WARTOSCIOWEGO do powiedzenia z wlasnej inicjatywy ' +
                    '(zblizajace sie przypomnienie, zaniedbane zadanie, spostrzezenie z kamery, uwaga wynikajaca z tego co ' +
                    'wiesz o wlascicielu) - powiedz to krotko, jednym-dwoma zdaniami. Jesli nie masz nic sensownego, ' +
                    'odpowiedz dokladnie jednym znakiem kropki i niczym wiecej. Nie komentuj tej instrukcji.',
                },
              ],
            },
          ],
          turnComplete: true,
        });
      } catch {
        /* sesja mogla sie w miedzyczasie zamknac */
      }
    }, PROACTIVE_IDLE_MS);
  };

  try {
    liveSession = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildLiveSystemInstruction(Boolean(coords), isOwner),
        tools: toolsForRole(isOwner),
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
      },
      callbacks: {
        onopen: () => safeSend(JSON.stringify({ type: 'ready', role: isOwner ? 'owner' : 'guest' })),
        onmessage: async (msg) => {
          if (closed) return;

          if (msg.data) {
            const buf = typeof msg.data === 'string' ? Buffer.from(msg.data, 'base64') : Buffer.from(msg.data);
            safeSend(buf);
          }

          if (msg.toolCall) {
            for (const call of msg.toolCall.functionCalls || []) {
              const allowed = isOwner || GUEST_TOOL_NAMES.includes(call.name);
              let result;
              if (!allowed) {
                result = { error: 'brak uprawnien - funkcja tylko dla zalogowanego wlasciciela' };
              } else if (call.name === 'wlacz_kamere') {
                safeSend(JSON.stringify({ type: 'startCamera' }));
                result = { ok: true };
              } else if (call.name === 'wylacz_kamere') {
                safeSend(JSON.stringify({ type: 'stopCamera' }));
                result = { ok: true };
              } else if (call.name === 'steruj_urzadzeniem') {
                const akcja = (call.args || {}).akcja;
                if (DEVICE_ACTIONS.includes(akcja)) {
                  safeSend(JSON.stringify({ type: 'deviceAction', action: akcja }));
                  result = { ok: true };
                } else {
                  result = { error: 'nieznana akcja' };
                }
              } else if (call.name === 'wyszukaj_w_sieci') {
                try {
                  const query = (call.args || {}).zapytanie || '';
                  const results = await searchWeb(query);
                  safeSend(JSON.stringify({ type: 'showSearch', query, results }));
                  result = results.length
                    ? { wyniki: results.map((r) => ({ tytul: r.title, opis: r.snippet })) }
                    : { error: 'brak wynikow' };
                } catch {
                  result = { error: 'blad wyszukiwania' };
                }
              } else {
                result = await executeTool(call.name, call.args || {}, coords);
              }
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
            const userText = userTranscript.trim();
            const assistantText = assistantTranscript.trim();
            // Kropka = umowiona odpowiedz "nie mam nic do dodania" na ciche
            // zapytanie proaktywne. Nie zapisujemy jej i nie pokazujemy.
            const isEmptyProactive = assistantText === '.' || assistantText === '';
            if (isOwner && userText) memory.appendHistory('user', userText);
            if (isOwner && assistantText && !isEmptyProactive) memory.appendHistory('assistant', assistantText);
            safeSend(JSON.stringify({ type: 'turnComplete', userText, assistantText: isEmptyProactive ? '' : assistantText }));
            userTranscript = '';
            assistantTranscript = '';
            scheduleProactive();
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

  scheduleProactive();

  clientWs.on('message', (data, isBinary) => {
    if (isBinary) {
      liveSession.sendRealtimeInput({ audio: { data: data.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
    } else {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'end') {
          liveSession.close();
        } else if (msg.type === 'video' && msg.data) {
          liveSession.sendRealtimeInput({ video: { data: msg.data, mimeType: 'image/jpeg' } });
        }
      } catch {
        /* noop */
      }
    }
  });

  clientWs.on('close', () => {
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    try {
      liveSession.close();
    } catch {
      /* noop */
    }
  });
}
