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

const ACTIONS = {
  'otworz-spotify': async () => {
    await shell.openExternal('spotify:').catch(() => shell.openExternal('https://open.spotify.com'));
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

async function runAction(name) {
  const fn = ACTIONS[name];
  if (!fn) return { ok: false, error: 'Nieznana akcja' };
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { runAction, actionNames: Object.keys(ACTIONS) };
