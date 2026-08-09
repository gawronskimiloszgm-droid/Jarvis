import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { GoogleGenAI } from '@google/genai';

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

export function isConfigured() {
  return true;
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

async function synthesizeGemini(text) {
  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: text,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
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

export async function synthesize(text) {
  const clean = normalizeForSpeech(text);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await synthesizeGemini(clean);
    } catch (err) {
      if (attempt === 1) console.error('Gemini TTS zawiodlo, uzywam Edge TTS:', err.message || err);
    }
  }
  return synthesizeEdge(clean);
}
