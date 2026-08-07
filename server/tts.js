import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Microsoft Edge "Read Aloud" neural voices - w pelni darmowe, bez klucza API, bez limitu.
// Pelna lista glosow: uruchom `node scripts/list-voices.js`
const VOICE = process.env.TTS_VOICE || 'pl-PL-MarekNeural';

export function isConfigured() {
  return true;
}

export async function synthesize(text) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);

  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
