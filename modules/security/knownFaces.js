// "Rozpoznawanie" znajomych osob na kamerze.
//
// UWAGA - WAZNE OGRANICZENIE: to NIE jest biometryczne rozpoznawanie twarzy.
// Nie ma tu modelu embeddingow (jak FaceNet/dlib), zadnego wektora cech
// twarzy ani progu odleglosci euklidesowej. Zamiast tego Gemini dostaje
// klatke z kamery ORAZ liste tekstowych opisow wygladu ("szczupły mezczyzna,
// broda, zwykle w czarnej kurtce") i ocenia SLOWNIE, czy ktorys opis pasuje
// do tego, co widac. To dziala jak rozsadny czlowiek czytajacy rysopis -
// bywa trafne, ale myli sie przy podobnym ubiorze/sylwetce i NIE nadaje sie
// do decyzji bezpieczenstwa wyzszej wagi (np. otwierania drzwi). Traktuj to
// jako podpowiedz ("prawdopodobnie to Anna"), nie jako dowod tozsamosci.

import { GoogleGenAI } from '@google/genai';
import * as memory from '../../server/memory/memory.js';
import { imagePart } from '../../server/vision/vision.js';
import { withModel } from '../../server/core/geminiChain.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function load() {
  const data = memory.load();
  if (!data.knownFaces || !Array.isArray(data.knownFaces.people)) {
    data.knownFaces = { people: [] };
  }
  return data;
}

export function listPeople() {
  return load().knownFaces.people.map((p) => ({ id: p.id, name: p.name, description: p.description, createdAt: p.createdAt }));
}

/**
 * @param {string} name imie/etykieta znanej osoby
 * @param {string} description opis wygladu PO POLSKU (ubior, sylwetka, cechy charakterystyczne)
 */
export function registerPerson(name, description) {
  const n = String(name || '').trim();
  const d = String(description || '').trim();
  if (!n || !d) return null;
  const data = load();
  const person = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n, description: d.slice(0, 500), createdAt: Date.now() };
  data.knownFaces.people.push(person);
  memory.save(data);
  return person;
}

export function removePerson(id) {
  const data = load();
  data.knownFaces.people = data.knownFaces.people.filter((p) => p.id !== id);
  memory.save(data);
  return listPeople();
}

function parseMatch(raw, people) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    const v = JSON.parse(cleaned);
    const person = v.personId ? people.find((p) => p.id === v.personId) : null;
    return {
      matched: Boolean(v.matched) && Boolean(person),
      person: person ? { id: person.id, name: person.name } : null,
      confidence: Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : null,
      note: String(v.note || '').slice(0, 300),
    };
  } catch {
    return { matched: false, person: null, confidence: null, note: cleaned.slice(0, 300) || 'brak odpowiedzi modelu' };
  }
}

/**
 * Porownanie osoby widocznej na klatce z lista znanych opisow.
 * @param {Buffer} jpegBuffer
 * @param {string} [cameraName]
 * @returns {Promise<{matched:boolean, person:{id:string,name:string}|null, confidence:number|null, note:string}>}
 */
export async function matchFace(jpegBuffer, cameraName) {
  const people = load().knownFaces.people;
  if (!people.length) return { matched: false, person: null, confidence: null, note: 'brak zarejestrowanych osob' };

  const roster = people.map((p) => `- id:"${p.id}" ${p.name}: ${p.description}`).join('\n');

  const prompt =
    `Jestes systemem ochrony domu (kamera: ${cameraName || 'nieznana'}). Dostajesz JEDNA klatke oraz liste ` +
    `znanych osob wraz z opisem ich wygladu:\n${roster}\n\n` +
    'WAZNE OGRANICZENIE: to NIE jest biometria - oceniasz WYLACZNIE na podstawie ogolnego podobienstwa ' +
    '(sylwetka, ubior, wlosy, inne cechy z opisu), nie porownujesz rysow twarzy z baza danych. Jesli nie ' +
    'widac wyraznie osoby albo zaden opis nie pasuje z rozsadna pewnoscia, zwroc matched:false.\n\n' +
    'Zwroc WYLACZNIE obiekt JSON (bez markdown): {"matched": boolean, "personId": string|null, ' +
    '"confidence": number 0-1, "note": string - jedno zdanie po polsku uzasadnienia}.';

  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: [imagePart(jpegBuffer.toString('base64'), 'image/jpeg'), { text: prompt }],
    })
  );
  return parseMatch(res.text, people);
}
