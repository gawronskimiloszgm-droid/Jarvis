// Ustawienia aplikacji desktopowej trzymane lokalnie (userData), poza
// serwerem - dotycza TEGO komputera: tryb uprawnien, historia schowka,
// autostart, skrot globalny, zadania cykliczne.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  permissionMode: 'zaufany', // podglad | pytaj | zaufany
  clipboardHistory: false,
  remoteControl: false, // czy ten komputer przyjmuje polecenia z telefonu (domyslnie NIE)
  gameMode: true, // tryb gry: wykrywanie gier i cisza na czas grania
  worktime: true, // licznik czasu pracy (tylko nazwy programow) - patrz insights.js
  autostart: false,
  hotkey: 'CommandOrControl+Alt+J',
  tasks: [], // zadania cykliczne - patrz scheduler.js
  // Linie bazowe patrolu E.D.I.T.H. (patrz patrol.js): null = jeszcze nie zapisano.
  startupBaseline: null,
  listenBaseline: null,
  defenderSeen: 0,
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'jarvis-settings.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('Nie udalo sie zapisac ustawien:', e.message);
  }
}

const ALLOWED_KEYS = new Set(Object.keys(DEFAULTS));

function get(key) {
  return key ? load()[key] : { ...load() };
}

function set(key, value) {
  if (!ALLOWED_KEYS.has(key)) throw new Error(`Nieznane ustawienie: ${key}`);
  if (key === 'permissionMode' && !['podglad', 'pytaj', 'zaufany'].includes(value)) throw new Error('Nieprawidlowy tryb uprawnien.');
  load()[key] = value;
  save();
  return load()[key];
}

module.exports = { get, set, DEFAULTS };
