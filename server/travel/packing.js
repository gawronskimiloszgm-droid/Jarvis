// #128: Sugestie co spakowac na podstawie pogody w celu podrozy.
//
// Uzywa ISTNIEJACEJ getWeather() z server/weather.js (tylko import, plik nie
// jest edytowany - zakaz w tym zadaniu). Open-Meteo daje jedynie AKTUALNA
// pogode (nie prognoze wieloipowa dla dowolnej przyszlej daty na darmowym
// tierze uzywanym przez ten projekt), wiec dla celow pakowania traktujemy ja
// jako reprezentatywny obraz warunkow w miejscu docelowym - Gemini dostaje
// tez daty podrozy, zeby uwzglednic pore roku/dlugosc pobytu w tresci listy.

import { GoogleGenAI } from '@google/genai';
import { withModel } from '../geminiChain.js';
import { getWeather } from '../weather.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** @param {{city:string, startDate?:string, endDate?:string}} params */
export async function suggestPacking({ city, startDate, endDate }) {
  const cityClean = String(city || '').trim();
  if (!cityClean) throw new Error('Podaj miasto docelowe.');

  const weather = await getWeather(cityClean);
  if (!weather) throw new Error(`Nie udalo sie ustalic pogody dla "${cityClean}".`);

  const dates =
    startDate && endDate
      ? `Podroz: ${startDate} - ${endDate}.`
      : startDate
        ? `Podroz od: ${startDate}.`
        : 'Daty podrozy nie podano.';

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents:
        `Uzytkownik jedzie do miasta: ${weather.city || cityClean}${weather.country ? ', ' + weather.country : ''}. ` +
        `${dates}\n` +
        `Aktualna pogoda tam: ${Math.round(weather.temperature)}°C, ${weather.condition}, wiatr ${weather.windSpeed} km/h, wilgotnosc ${weather.humidity}%.\n\n` +
        'Napisz zwiezla liste rzeczy do spakowania po polsku, w punktach (myślnik na poczatku linii), ' +
        'dopasowana do tej pogody i dlugosci podrozy. Bez wstepu ani podsumowania - sama lista.',
    })
  );

  const items = (res.text || '')
    .split('\n')
    .map((l) => l.replace(/^[\s\-*•]+/, '').trim())
    .filter(Boolean);

  return { city: weather.city || cityClean, weather, items };
}
