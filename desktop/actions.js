// Biala lista bezpiecznych akcji, ktore Jarvis moze wykonac na komputerze,
// gdy dziala jako aplikacja desktopowa. CELOWO nie ma tu mechanizmu do
// wykonania dowolnej komendy - Jarvis moze jedynie wywolac jedna z ponizszych,
// z gory zdefiniowanych funkcji po nazwie. To rozroznienie jest kluczowe dla
// bezpieczenstwa: zaden tekst od uzytkownika/AI nigdy nie trafia bezposrednio
// do powloki systemowej.

const { shell } = require('electron');
const { exec } = require('child_process');

function runWindowsCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error) => resolve({ ok: !error }));
  });
}

function sendMediaKey(keyCode, times = 1) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; for ($i=0;$i -lt ${times};$i++) { [System.Windows.Forms.SendKeys]::SendWait([char]${keyCode}) }`;
  return runWindowsCommand(`powershell -NoProfile -Command "${script}"`);
}

// AC/DC - "Back in Black". Identyfikator sprawdzony, nie zgadywany.
const WAKE_TRACK_ID = process.env.JARVIS_WAKE_TRACK || '08mG3Y1vljYA6bvDt4Wqkj';

const ACTIONS = {
  'otworz-spotify': async () => {
    await shell.openExternal('spotify:').catch(() => shell.openExternal('https://open.spotify.com'));
    return { ok: true };
  },
  // "Jarvis, pobudka" - najpierw probujemy schematu spotify:, ktory otwiera
  // aplikacje i od razu odtwarza; gdy jej nie ma, ladujemy w przegladarce.
  pobudka: async () => {
    await shell
      .openExternal(`spotify:track:${WAKE_TRACK_ID}`)
      .catch(() => shell.openExternal(`https://open.spotify.com/track/${WAKE_TRACK_ID}`));
    return { ok: true };
  },
  'otworz-youtube-music': async () => {
    await shell.openExternal('https://music.youtube.com');
    return { ok: true };
  },
  'otworz-przegladarke': async () => {
    await shell.openExternal('https://google.com');
    return { ok: true };
  },
  'otworz-eksplorator': async () => runWindowsCommand('explorer.exe'),
  'zablokuj-ekran': async () => runWindowsCommand('rundll32.exe user32.dll,LockWorkStation'),
  glosniej: async () => sendMediaKey(0xaf, 3),
  ciszej: async () => sendMediaKey(0xae, 3),
  wycisz: async () => sendMediaKey(0xad, 1),
};

// Operacje na plikach sa osobno, bo jako jedyne przyjmuja parametry.
// Kazda z nich i tak jest zamknieta w folderze Dokumenty\Jarvis - patrz
// uzasadnienie w files.js.
const files = require('./files');

const FILE_ACTIONS = {
  'zapisz-plik': (p) => files.writeFile(p.nazwa, p.tresc),
  'dopisz-do-pliku': (p) => files.appendFile(p.nazwa, p.tresc),
  'czytaj-plik': (p) => files.readFile(p.nazwa),
  'lista-plikow': () => files.listFiles(),
  'otworz-folder-jarvisa': () => files.openFolder(),
};

async function runAction(name, params = {}) {
  const fileFn = FILE_ACTIONS[name];
  if (fileFn) {
    try {
      return await fileFn(params || {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  const fn = ACTIONS[name];
  if (!fn) return { ok: false, error: 'Nieznana akcja' };
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  runAction,
  actionNames: [...Object.keys(ACTIONS), ...Object.keys(FILE_ACTIONS)],
};
