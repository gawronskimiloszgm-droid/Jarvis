import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { GoogleGenAI } from '@google/genai';
import * as bus from '../core/bus.js';

// Podstawowy silnik: ten sam model/glos co rozmowa na zywo (Gemini TTS,
// darmowy w ramach free-tier), zeby powitanie i pisany czat brzmialy
// TAK SAMO jak rozmowa glosowa - jeden Jarvis, jeden glos.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const VOICE_NAME = process.env.GEMINI_LIVE_VOICE || 'Orus';
const SAMPLE_RATE = 24000;

// Zapasowy silnik: Edge TTS, uzywany tylko gdy Gemini TTS (model -preview-)
// chwilowo zawiedzie, zeby czat nigdy nie zostal calkiem bez glosu.
const EDGE_VOICE = process.env.TTS_VOICE || 'pl-PL-MarekNeural';
const EDGE_PROSODY = {
  pitch: process.env.TTS_PITCH || '-7%',
  rate: process.env.TTS_RATE || '-8%',
};

// Sklonowany glos z osobnej uslugi (tts_cloud/). Uzywany TYLKO jesli
// skonfigurowany i tylko dla krotkich wypowiedzi - XTTS-v2 na darmowym
// procesorze generuje wolniej niz czlowiek mowi, wiec dla dlugiego akapitu
// uzytkownik czekalby dluzej niz trwa sama wypowiedz. Krotkie repliki i
// meldunki brzmia wtedy wlasciwym glosem, a dluzsze i tak wchodza szybkim
// silnikiem. Granice ustawia TTS_CLONE_MAX_CHARS.
const CLONE_URL = (process.env.TTS_CLOUD_URL || '').replace(/\/+$/, '');
const CLONE_TOKEN = process.env.TTS_CLOUD_TOKEN || '';
const CLONE_MAX_CHARS = Number(process.env.TTS_CLONE_MAX_CHARS || 240);
const CLONE_TIMEOUT_MS = Number(process.env.TTS_CLONE_TIMEOUT_MS || 20000);
const CLONE_LANG = process.env.TTS_CLONE_LANGUAGE || 'pl';

export function isConfigured() {
  return true;
}

export function cloneStatus() {
  return { enabled: Boolean(CLONE_URL), url: CLONE_URL || null, maxChars: CLONE_MAX_CHARS };
}

async function synthesizeClone(text) {
  if (!CLONE_URL) throw new Error('Usluga klonowania glosu nie jest skonfigurowana.');

  // Usluga moze spac (HuggingFace usypia darmowe Spaces) albo dopiero
  // wczytywac model - bez limitu czasu czat wisialby w nieskonczonosc.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLONE_TIMEOUT_MS);
  try {
    const res = await fetch(`${CLONE_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: CLONE_LANG, token: CLONE_TOKEN }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TTS clone HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1024) throw new Error('Usluga zwrocila pusty strumien audio.');
    return { buffer, contentType: 'audio/wav' };
  } finally {
    clearTimeout(timer);
  }
}

// Zabezpieczenie: gdyby model mimo instrukcji wypisal pelna, kropkowana
// nazwe, syntezator odczytalby ja litera po literze - zamieniamy na "Jarvis".
function normalizeForSpeech(text) {
  return text.replace(/J\.\s*A\.\s*R\.\s*V\.\s*I\.\s*S\.?/gi, 'Jarvis');
}

function pcmToWav(pcmBuffer, sampleRate = SAMPLE_RATE) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function synthesizeGemini(text, voiceName = VOICE_NAME) {
  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: text,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });
  const base64 = response.data;
  if (!base64) throw new Error('Brak audio w odpowiedzi Gemini TTS.');
  return { buffer: pcmToWav(Buffer.from(base64, 'base64')), contentType: 'audio/wav' };
}

async function synthesizeEdge(text) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text, EDGE_PROSODY);
  const chunks = [];
  for await (const chunk of audioStream) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), contentType: 'audio/mpeg' };
}

// Nie zglaszamy KAZDEGO nieudanego zdania osobno - przy dluzszej awarii
// (usluga spi, tunel padl) zalaloby to Logi tym samym komunikatem co
// kilka sekund. Jedno zgloszenie na epizod wystarczy.
const CLONE_FAILURE_GAP_MS = 5 * 60 * 1000;
let lastCloneFailureAt = 0;

function announceCloneFailure(err) {
  const now = Date.now();
  if (now - lastCloneFailureAt < CLONE_FAILURE_GAP_MS) return;
  lastCloneFailureAt = now;
  bus.publish('glos', 'clone.unavailable', `Sklonowany glos niedostepny, uzywam zapasowego: ${err.message || err}`, {
    level: 'warn',
  });
}

// Glos E.D.I.T.H. - inny niz Jarvisa, zeby rozmowa z nia brzmiala jak z
// kims innym, nie jak Jarvis udajacy kogos innego. Dziala TYLKO przez
// Gemini TTS (klon i Edge ignoruja ten parametr - to osobne uslugi/
// konfiguracje, nie warto ich tu komplikowac dla jednego dodatkowego glosu).
const EDITH_VOICE_NAME = process.env.EDITH_TTS_VOICE || 'Kore';

// Kolejnosc: sklonowany glos (gdy wlaczony i tekst krotki) -> Gemini TTS
// -> Edge TTS. Kazdy stopien lapie awarie poprzedniego, wiec czat nigdy
// nie zostaje calkiem bez glosu, nawet gdy usluga klonujaca spi.
export async function synthesize(text, { speaker } = {}) {
  const clean = normalizeForSpeech(text);
  const voiceName = speaker === 'edith' ? EDITH_VOICE_NAME : VOICE_NAME;

  if (speaker !== 'edith' && CLONE_URL && clean.length <= CLONE_MAX_CHARS) {
    try {
      return await synthesizeClone(clean);
    } catch (err) {
      // Ta awaria jest CICHA dla uzytkownika - dostaje po prostu stary
      // glos, bez zadnego komunikatu w appce. Odkryte dokladnie tak: dzialalo
      // przez curl (inna kolejnosc rozwiazywania localhost/127.0.0.1 niz
      // Node), a appka po prostu brzmiala jak dawniej, bez sladu bledu poza
      // logiem konsoli, ktorego na Renderze nikt na biezaco nie czyta.
      // Stad publikacja na magistrale - zeby bylo widac w panelu Logi.
      console.error('Sklonowany glos niedostepny, schodze nizej:', err.message || err);
      announceCloneFailure(err);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await synthesizeGemini(clean, voiceName);
    } catch (err) {
      if (attempt === 1) console.error('Gemini TTS zawiodlo, uzywam Edge TTS:', err.message || err);
    }
  }
  return synthesizeEdge(clean);
}
