import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

export async function transcribeAudio(base64Data, mimeType) {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          {
            text: 'Przepisz dokladnie to, co slyszysz w tym nagraniu audio, po polsku. Jesli nagranie jest ciche/puste/niezrozumiale, zwroc pusty tekst. Zwroc TYLKO sam przepisany tekst, bez cudzyslowow i komentarzy.',
          },
        ],
      },
    ],
  });
  return (res.text || '').trim();
}
