// Analiza pojedynczej klatki z kamery obwodowej.
//
// Celowo NIE jest to sesja czatu (jak jarvis.chatStream) - to jednorazowa,
// bezstanowa ocena: "czy na tym obrazie jest cos wartego uwagi". Kamera
// wysyla klatki czesto (co ruch albo co kilka minut jako heartbeat), a
// trzymanie dla kazdej z nich historii rozmowy tylko zjadaloby kontekst
// i zwalnialo odpowiedz bez żadnej korzysci.

import { GoogleGenAI } from '@google/genai';
import { imagePart } from '../../server/vision.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';

const PROMPT = `Jestes systemem ochrony obwodowej domu. Dostajesz JEDNA klatke z kamery
zewnetrznej. Oceń ja rzeczowo, bez spekulacji.

Zwroc WYLACZNIE obiekt JSON (bez markdown, bez komentarza) o polach:
{
  "notable": boolean - true TYLKO jesli widac czlowieka, pojazd, albo cos
    wyraznie niecodziennego w tym miejscu. Zwierzeta, wiatr, zmiany swiatla,
    cienie, deszcz, snieg - to NIE jest notable.
  "description": string - jedno krotkie zdanie po polsku, co dokladnie widac.
  "confidence": number 0-1 - jak pewny jestes oceny "notable".
}

Blad w druga strone (przeoczenie czegos) jest gorszy niz falszywy alarm, ale
NIE zglaszaj czegos jako notable, jesli oczywiscie nic tam nie ma.`;

// Odpowiedz modelu bywa owinieta w ```json - zdejmujemy to, zanim sparsujemy.
function parseVerdict(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    const v = JSON.parse(cleaned);
    return {
      notable: Boolean(v.notable),
      description: String(v.description || '').slice(0, 300),
      confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : null,
    };
  } catch {
    // Model czasem odpowie zwyklym zdaniem mimo instrukcji - lepiej
    // pokazac to czlowiekowi z flaga niepewnosci niz udawac cisze.
    return { notable: false, description: cleaned.slice(0, 300) || 'brak odpowiedzi modelu', confidence: null, parseFailed: true };
  }
}

/**
 * @param {Buffer} jpegBuffer surowa klatka JPEG
 * @param {string} cameraName etykieta kamery, np. "garaz"
 * @returns {Promise<{notable:boolean, description:string, confidence:number|null}>}
 */
export async function analyzeFrame(jpegBuffer, cameraName) {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      imagePart(jpegBuffer.toString('base64'), 'image/jpeg'),
      { text: `Kamera: ${cameraName || 'nieznana'}.\n\n${PROMPT}` },
    ],
  });
  return parseVerdict(res.text);
}
