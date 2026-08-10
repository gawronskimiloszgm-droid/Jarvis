// Trwale przechowywanie stanu Jarvisa (pamiec, zadania, przypomnienia).
//
// PROBLEM: darmowy plan Render ma ULOTNY system plikow. Katalog data/ nie
// jest w repozytorium, wiec przy kazdym wdrozeniu i kazdym restarcie
// uslugi plik memory.json powstaje od nowa - pusty. Wszystko, co Jarvis
// "zapamietal", znikalo.
//
// ROZWIAZANIE: jesli ustawiony jest zewnetrzny magazyn klucz-wartosc
// (Upstash Redis - darmowy plan, REST, bez sterownika), stan trzymamy tam
// i przezywa on restarty. Bez konfiguracji dziala jak dotad, na pliku -
// co jest w porzadku lokalnie, ale NIE wystarcza na Renderze.

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY = process.env.JARVIS_STORE_KEY || 'jarvis:store';

export const isRemote = Boolean(REST_URL && REST_TOKEN);

export function backendName() {
  return isRemote ? 'upstash-redis' : 'plik-lokalny';
}

async function remoteRead() {
  const res = await fetch(`${REST_URL}/get/${encodeURIComponent(KEY)}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Upstash GET ${res.status}`);
  const body = await res.json();
  if (body.result == null) return null;
  return typeof body.result === 'string' ? JSON.parse(body.result) : body.result;
}

async function remoteWrite(data) {
  const res = await fetch(`${REST_URL}/set/${encodeURIComponent(KEY)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'text/plain' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Upstash SET ${res.status}`);
}

function fileRead() {
  if (!fs.existsSync(MEMORY_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function fileWrite(data) {
  if (!fs.existsSync(DATA_DIR)) await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2));
}

export async function readStore() {
  if (isRemote) {
    try {
      return await remoteRead();
    } catch (err) {
      console.error('Store: odczyt zdalny nieudany, probuje plik lokalny:', err.message);
      return fileRead();
    }
  }
  return fileRead();
}

// Zapis idzie do zdalnego magazynu, a rownolegle na dysk - lokalna kopia
// jest bezuzyteczna po restarcie Rendera, ale ratuje sytuacje, gdyby
// Upstash chwilowo nie odpowiadal w trakcie dzialania procesu.
export async function writeStore(data) {
  if (isRemote) {
    try {
      await remoteWrite(data);
    } catch (err) {
      console.error('Store: zapis zdalny nieudany:', err.message);
    }
  }
  try {
    await fileWrite(data);
  } catch {
    /* na Renderze zapis pliku moze byc niemozliwy - to nie jest blad krytyczny */
  }
}
