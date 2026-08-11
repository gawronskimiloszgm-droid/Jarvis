// Operacje na plikach dostepne dla Jarvisa - CELOWO zamkniete w jednym
// folderze (Dokumenty\Jarvis).
//
// DLACZEGO TAK WASKO: Jarvis czyta tresc stron internetowych, zeby moc
// odpowiadac konkretnie. Gdyby jednoczesnie mogl zapisywac dowolne pliki
// pod dowolna sciezka, spreparowana strona moglaby zawrzec polecenie
// ("zapisz plik X"), ktore model potraktowalby jako zadanie uzytkownika.
// Zamkniecie zapisu w jednym katalogu sprawia, ze najgorszy mozliwy skutek
// to smiec w folderze Jarvisa - a nie nadpisany plik systemowy czy
// podrzucony plik wykonywalny.
//
// Zasady: tylko ten folder, tylko formaty tekstowe, limit rozmiaru,
// zadnych sciezek wychodzacych w gore ani absolutnych.

const fs = require('fs/promises');
const path = require('path');
const { app, shell } = require('electron');

const ALLOWED_EXT = new Set(['.txt', '.md', '.csv', '.json', '.log']);
const MAX_BYTES = 1024 * 1024; // 1 MB - notatki, listy, eksporty
const MAX_LIST = 100;

function rootDir() {
  return path.join(app.getPath('documents'), 'Jarvis');
}

async function ensureRoot() {
  const dir = rootDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Zwraca bezpieczna, pelna sciezke albo null. Odrzuca wszystko, co
// probuje wyjsc poza folder Jarvisa - takze przez dowiazania i "..".
function safePath(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const cleaned = name.trim();

  // Zadnych separatorow, sciezek absolutnych ani przejsc w gore.
  if (/[\\/]/.test(cleaned)) return null;
  if (cleaned.includes('..')) return null;
  if (path.isAbsolute(cleaned)) return null;
  // Windows: "C:plik" to sciezka wzgledna WOBEC DYSKU, a isAbsolute()
  // zwraca dla niej false. Ostateczna kontrola nizej i tak by to zlapala,
  // ale odrzucamy jawnie, zeby nie powstawaly mylace nazwy plikow.
  if (/^[a-z]:/i.test(cleaned)) return null;

  const ext = path.extname(cleaned).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;

  const full = path.resolve(rootDir(), cleaned);
  // Ostateczna kontrola: wynik MUSI lezec wewnatrz folderu Jarvisa.
  if (!full.startsWith(path.resolve(rootDir()) + path.sep)) return null;
  return full;
}

async function writeFile(name, content) {
  await ensureRoot();
  const full = safePath(name);
  if (!full) {
    return { ok: false, error: 'Niedozwolona nazwa pliku. Dozwolone: nazwa.txt/.md/.csv/.json/.log, bez folderow.' };
  }
  const text = String(content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { ok: false, error: 'Plik za duzy (limit 1 MB).' };
  }
  await fs.writeFile(full, text, 'utf8');
  return { ok: true, path: full };
}

async function appendFile(name, content) {
  await ensureRoot();
  const full = safePath(name);
  if (!full) return { ok: false, error: 'Niedozwolona nazwa pliku.' };
  const text = String(content ?? '');
  let current = 0;
  try {
    current = (await fs.stat(full)).size;
  } catch {
    /* plik jeszcze nie istnieje */
  }
  if (current + Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { ok: false, error: 'Plik osiagnalby limit 1 MB.' };
  }
  await fs.appendFile(full, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  return { ok: true, path: full };
}

async function readFile(name) {
  const full = safePath(name);
  if (!full) return { ok: false, error: 'Niedozwolona nazwa pliku.' };
  try {
    const text = await fs.readFile(full, 'utf8');
    return { ok: true, content: text.slice(0, 20000) };
  } catch {
    return { ok: false, error: 'Nie ma takiego pliku.' };
  }
}

async function listFiles() {
  const dir = await ensureRoot();
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries.slice(0, MAX_LIST)) {
      if (!e.isFile()) continue;
      const stat = await fs.stat(path.join(dir, e.name));
      files.push({ name: e.name, bytes: stat.size, modified: stat.mtimeMs });
    }
    return { ok: true, files };
  } catch {
    return { ok: true, files: [] };
  }
}

async function openFolder() {
  const dir = await ensureRoot();
  await shell.openPath(dir);
  return { ok: true, path: dir };
}

module.exports = { writeFile, appendFile, readFile, listFiles, openFolder, rootDir };
