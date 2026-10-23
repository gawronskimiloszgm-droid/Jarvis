// Odczyt paragonu/faktury ze zdjecia (OCR + interpretacja przez Gemini
// Vision).
//
// CELOWO nie zapisuje wydatku sam - zwraca tylko ODCZYTANE dane. Blad OCR
// (zle odczytana kwota, przecinek zamiast kropki, obcieta cyfra) trafiony
// prosto do ksiegowosci bez potwierdzenia czlowieka to dokladnie ten
// rodzaj cichego bledu, ktorego ma unikac caly ten projekt. Zapis robi
// dopiero istniejacy /api/expenses, gdy uzytkownik kliknie "dodaj" nad
// juz wyswietlonymi, sprawdzalnymi liczbami.

import { GoogleGenAI } from '@google/genai';
import { imagePart } from '../../server/vision/vision.js';
import { withModel } from '../../server/core/geminiChain.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PROMPT = `Na zdjeciu jest paragon albo faktura. Odczytaj z niego dane zakupu.

Zwroc WYLACZNIE obiekt JSON (bez markdown, bez komentarza):
{
  "found": boolean - false jesli to NIE jest paragon/faktura albo tekst jest nieczytelny,
  "amount": number|null - kwota CALKOWITA do zaplaty, sama liczba (np. 45.99), kropka nie przecinek,
  "currency": string - kod waluty jesli widoczny (PLN, EUR...), domyslnie "PLN",
  "merchant": string|null - nazwa sklepu/firmy, jesli widoczna,
  "date": string|null - data zakupu w formacie RRRR-MM-DD, jesli widoczna,
  "category": string - jedno slowo po polsku: jedzenie, paliwo, zakupy, dom, zdrowie, transport, rozrywka albo inne,
  "confidence": number 0-1 - jak pewny jestes odczytanej KWOTY calkowitej (nie calosci)
}

Kwota calkowita to zazwyczaj najwieksza liczba, czesto podpisana "SUMA", "RAZEM", "DO ZAPLATY" - NIE pojedyncza pozycja z listy produktow. Gdy nie widac wyraznie kwoty koncowej, ustaw amount na null i confidence na 0 zamiast zgadywac.`;

function parseVerdict(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    const v = JSON.parse(cleaned);
    return {
      found: Boolean(v.found),
      amount: Number.isFinite(v.amount) ? Math.round(v.amount * 100) / 100 : null,
      currency: String(v.currency || 'PLN').toUpperCase().slice(0, 6),
      merchant: v.merchant ? String(v.merchant).slice(0, 80) : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null,
      category: String(v.category || 'inne').toLowerCase().slice(0, 30),
      confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0,
    };
  } catch {
    return { found: false, amount: null, currency: 'PLN', merchant: null, date: null, category: 'inne', confidence: 0, parseFailed: true };
  }
}

/**
 * @param {Buffer} imageBuffer zdjecie paragonu (JPEG/PNG)
 * @param {string} mimeType
 */
export async function scanReceipt(imageBuffer, mimeType = 'image/jpeg') {
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: [imagePart(imageBuffer.toString('base64'), mimeType), { text: PROMPT }],
    })
  );
  return parseVerdict(res.text);
}
