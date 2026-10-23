// Uzycie: node scripts/list-voices.js [fragment-nazwy]
// Wypisuje dostepne glosy Microsoft Edge TTS, np. `node scripts/list-voices.js pl-PL`
import { MsEdgeTTS } from 'msedge-tts';

const filter = process.argv[2] || '';
const tts = new MsEdgeTTS();
const voices = await tts.getVoices();

for (const v of voices) {
  if (!filter || v.ShortName.toLowerCase().includes(filter.toLowerCase())) {
    console.log(`${v.ShortName}  (${v.Gender}, ${v.Locale})`);
  }
}
