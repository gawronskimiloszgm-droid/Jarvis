// Streszczenie nowych znalezisk wartownika.
//
// Wejsciem sa TYLKO tytuly i fragmenty z wyszukiwarki, nie pelne strony -
// wartownik chodzi w tle co godzine, wiec pobieranie i przetwarzanie
// kilkunastu stron przy kazdym temacie kosztowaloby wielokrotnie wiecej
// niz cala reszta systemu razem wziete. Do "czy wydarzylo sie cos
// nowego" fragmenty wystarczaja; po szczegoly uzytkownik ma linki.

import { GoogleGenAI } from '@google/genai';
import { withModel } from '../../server/geminiChain.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * @param {string} query sledzony temat
 * @param {Array<{title:string,url:string,snippet:string}>} items nowe wyniki
 * @returns {Promise<string>} jedno-dwa zdania po polsku
 */
export async function summarizeFindings(query, items) {
  const list = items
    .slice(0, 8)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${String(r.snippet || '').replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n');

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Sledzisz dla uzytkownika temat: "${query}".\n` +
        'Ponizej NOWE wyniki wyszukiwania, ktorych wczesniej nie bylo.\n\n' +
        'Napisz JEDNO, maksymalnie DWA zdania po polsku o tym, co sie wydarzylo. Zasady:\n' +
        '- Zacznij od konkretu, nie od "pojawily sie nowe informacje".\n' +
        '- Jesli wyniki nie niosa nic nowego poza szumem (reklamy, stare strony, przypadkowe trafienia),\n' +
        '  napisz dokladnie: BRAK\n' +
        '- Nie wymyslaj szczegolow, ktorych nie ma w tekscie ponizej.\n\n' +
        list,
    })
  );

  const text = (res.text || '').trim();
  return text;
}
