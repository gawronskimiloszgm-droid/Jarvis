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
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY = process.env.JARVIS_STORE_KEY || 'jarvis:store';

export const isRemote = Boolean(REST_URL && REST_TOKEN);

export function backendName() {
  return isRemote ? 'upstash-redis' : 'plik-lokalny';
}

// Stan zapisu widoczny w aplikacji. Nieudany zapis to ryzyko utraty danych przy restarcie, wiec nie moze
// zostac tylko w logu, ktorego nikt nie czyta.
const status = { backend: isRemote ? 'upstash-redis' : 'plik-lokalny', lastWriteAt: 0, lastWriteOk: null, lastError: null, lastSize: 0, readFailed: false, blockedWrites: 0 };
export const storeStatus = () => ({ ...status });

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

const RETRY_MS = Number(process.env.JARVIS_STORE_RETRY_MS) || 1500;

export async function readStore() {
  if (isRemote) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await remoteRead();
        status.readFailed = false;
        return data;
      } catch (err) {
        console.error(`Store: odczyt zdalny nieudany (proba ${attempt + 1}):`, err.message);
        if (attempt < 2) await new Promise((r) => setTimeout(r, RETRY_MS * (attempt + 1)));
      }
    }
    // Nie wiemy, co jest w magazynie. Dopoki sie tego nie dowiemy, nie wolno do niego pisac:
    // pusty stan po starcie nadpisalby prawdziwe dane.
    status.readFailed = true;
    return fileRead();
  }
  return fileRead();
}

// Kolejna proba odczytu po awarii startowej. Zwraca dane, gdy magazyn znow odpowiada.
export async function retryRemoteRead() {
  if (!isRemote || !status.readFailed) return null;
  try {
    const data = await remoteRead();
    status.readFailed = false;
    return data;
  } catch {
    return null;
  }
}

// Zapis idzie do zdalnego magazynu, a rownolegle na dysk - lokalna kopia
// jest bezuzyteczna po restarcie Rendera, ale ratuje sytuacje, gdyby
// Upstash chwilowo nie odpowiadal w trakcie dzialania procesu.
export async function writeStore(data) {
  status.lastSize = Buffer.byteLength(JSON.stringify(data));
  if (isRemote) {
    if (status.readFailed) {
      status.blockedWrites++;
      console.error('Store: zapis zdalny wstrzymany, bo nie udalo sie odczytac magazynu.');
    } else {
      try {
        await remoteWrite(data);
        status.lastWriteAt = Date.now();
        status.lastWriteOk = true;
        status.lastError = null;
      } catch (err) {
        status.lastWriteOk = false;
        status.lastError = err.message;
        console.error('Store: zapis zdalny nieudany:', err.message);
      }
    }
  } else {
    status.lastWriteAt = Date.now();
    status.lastWriteOk = true;
  }
  try {
    await fileWrite(data);
  } catch {
    /* na Renderze zapis pliku moze byc niemozliwy - to nie jest blad krytyczny */
  }
}

// ---------- kopie stanu (osobne klucze/pliki) ----------
const snapName = (name) => String(name).replace(/[^\w-]/g, '').slice(0, 80);
const snapFile = (name) => path.join(DATA_DIR, 'snapshots', `${snapName(name)}.json`);

export async function snapshotWrite(name, payload) {
  const body = JSON.stringify(payload);
  if (isRemote) {
    const res = await fetch(`${REST_URL}/set/${encodeURIComponent(`${KEY}:snap:${snapName(name)}`)}`, { method: 'POST', headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'text/plain' }, body });
    if (!res.ok) throw new Error(`Upstash SET ${res.status}`);
    return;
  }
  await fsp.mkdir(path.dirname(snapFile(name)), { recursive: true });
  await fsp.writeFile(snapFile(name), body);
}

export async function snapshotRead(name) {
  if (isRemote) {
    const res = await fetch(`${REST_URL}/get/${encodeURIComponent(`${KEY}:snap:${snapName(name)}`)}`, { headers: { Authorization: `Bearer ${REST_TOKEN}` } });
    if (!res.ok) throw new Error(`Upstash GET ${res.status}`);
    const b = await res.json();
    return b.result == null ? null : typeof b.result === 'string' ? JSON.parse(b.result) : b.result;
  }
  return fs.existsSync(snapFile(name)) ? JSON.parse(fs.readFileSync(snapFile(name), 'utf-8')) : null;
}

export async function snapshotDelete(name) {
  if (isRemote) {
    await fetch(`${REST_URL}/del/${encodeURIComponent(`${KEY}:snap:${snapName(name)}`)}`, { method: 'POST', headers: { Authorization: `Bearer ${REST_TOKEN}` } });
    return;
  }
  await fsp.rm(snapFile(name), { force: true });
}
