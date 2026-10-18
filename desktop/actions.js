// Biala lista bezpiecznych akcji, ktore Jarvis moze wykonac na komputerze,
// gdy dziala jako aplikacja desktopowa. CELOWO nie ma tu mechanizmu do
// wykonania dowolnej komendy - Jarvis moze jedynie wywolac jedna z ponizszych,
// z gory zdefiniowanych funkcji po nazwie. To rozroznienie jest kluczowe dla
// bezpieczenstwa: zaden tekst od uzytkownika/AI nigdy nie trafia bezposrednio
// do powloki systemowej.

const path = require('path');
const fsp = require('fs/promises');
const { shell, app, desktopCapturer, screen } = require('electron');
const { exec } = require('child_process');
const { spawn } = require('child_process');
const { judge } = require('./edithPolicy');

function runWindowsCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error) => resolve({ ok: !error }));
  });
}

// Skrypty PowerShella podajemy zakodowane w base64 (-EncodedCommand) zamiast
// wklejac je w cudzyslowy w linii polecen. Skrypty ponizej zawieraja wlasne
// cudzyslowy (sygnatury P/Invoke), ktore w zwyklym `-Command "..."` rozwalilyby
// parsowanie. Zadna czesc tych skryptow nie pochodzi od uzytkownika ani modelu.
function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return runWindowsCommand(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`);
}

// keybd_event zamiast SendKeys - SendKeys nie obsluguje klawiszy medialnych
// (odtwarzanie, nastepny utwor) ani klawisza Windows.
const KEY_HELPER = `
Add-Type -Namespace J -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.IntPtr dwExtraInfo);'
function Down([byte]$vk) { [J.K]::keybd_event($vk,0,0,[System.IntPtr]::Zero) }
function Up([byte]$vk) { [J.K]::keybd_event($vk,0,2,[System.IntPtr]::Zero) }
function Tap([byte]$vk) { Down $vk; Up $vk }
`;

const VK = {
  MUTE: 0xad,
  VOL_DOWN: 0xae,
  VOL_UP: 0xaf,
  NEXT: 0xb0,
  PREV: 0xb1,
  PLAY_PAUSE: 0xb3,
  LWIN: 0x5b,
  ALT: 0x12,
  F4: 0x73,
  D: 0x44,
};

function tapKey(vk, times = 1) {
  return runPowerShell(`${KEY_HELPER}
for ($i=0; $i -lt ${times}; $i++) { Tap ${vk}; Start-Sleep -Milliseconds 30 }`);
}

function tapCombo(modifierVk, vk) {
  return runPowerShell(`${KEY_HELPER}
Down ${modifierVk}; Tap ${vk}; Up ${modifierVk}`);
}

// Zrzut ekranu ladujemy w tym samym folderze co notatki (Dokumenty\Jarvis),
// pod nazwa generowana z daty - uzytkownik ani model nie podaja tu nazwy.
async function takeScreenshot() {
  const dir = path.join(app.getPath('documents'), 'Jarvis');
  await fsp.mkdir(dir, { recursive: true });

  // size jest w punktach niezaleznych od skali - przy skalowaniu Windows
  // (125%, 150%) daloby to rozmyty zrzut w mniejszej rozdzielczosci niz ekran.
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.round(size.width * scaleFactor),
    height: Math.round(size.height * scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  if (!sources.length) return { ok: false, error: 'Nie udalo sie odczytac ekranu.' };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = `zrzut-${stamp}.png`;
  await fsp.writeFile(path.join(dir, name), sources[0].thumbnail.toPNG());
  return { ok: true, nazwa: name };
}

// Jak takeScreenshot, ale bez zapisu na dysk - zwraca same bajty (base64)
// do analizy przez model. To dwie osobne funkcje celowo: "zrzut-ekranu"
// zostawia trwaly plik w Dokumenty\Jarvis (user o to prosi wprost), a
// "co na ekranie" to ulotne spojrzenie, ktore nie powinno zasmiecac dysku
// przy kazdym pytaniu.
async function captureScreenForVision() {
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.round(size.width * scaleFactor),
    height: Math.round(size.height * scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  if (!sources.length) return { ok: false, error: 'Nie udalo sie odczytac ekranu.' };
  return { ok: true, imageBase64: sources[0].thumbnail.toPNG().toString('base64'), mimeType: 'image/png' };
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
  'otworz-discord': async () => {
    await shell.openExternal('discord:').catch(() => shell.openExternal('https://discord.com/app'));
    return { ok: true };
  },
  'otworz-teams': async () => {
    await shell.openExternal('msteams:').catch(() => shell.openExternal('https://teams.microsoft.com'));
    return { ok: true };
  },
  'otworz-slack': async () => {
    await shell.openExternal('slack://open').catch(() => shell.openExternal('https://slack.com/signin'));
    return { ok: true };
  },
  'otworz-vscode': async () => {
    await shell.openExternal('vscode://').catch(() => runWindowsCommand('code'));
    return { ok: true };
  },
  'otworz-eksplorator': async () => runWindowsCommand('explorer.exe'),
  'zablokuj-ekran': async () => runWindowsCommand('rundll32.exe user32.dll,LockWorkStation'),
  glosniej: async () => tapKey(VK.VOL_UP, 3),
  ciszej: async () => tapKey(VK.VOL_DOWN, 3),
  wycisz: async () => tapKey(VK.MUTE),
  'odtworz-pauza': async () => tapKey(VK.PLAY_PAUSE),
  'nastepny-utwor': async () => tapKey(VK.NEXT),
  'poprzedni-utwor': async () => tapKey(VK.PREV),
  'zrzut-ekranu': takeScreenshot,
  'zrzut-i-opisz': captureScreenForVision,
  'zamknij-okno': async () => tapCombo(VK.ALT, VK.F4),
  'pokaz-pulpit': async () => tapCombo(VK.LWIN, VK.D),
  'uspij-komputer': async () =>
    runPowerShell(
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"
    ),
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

function runUserCommand(command) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'powershell.exe' : 'bash';
    const args = isWin
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command];
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* juz nie zyje */ }
    }, 20000);
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (out.length > 12000) out = out.slice(-12000);
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = (out || err).trim().slice(0, 4000);
      resolve({ ok: code === 0, code, output });
    });
  });
}

async function securityScan() {
  if (process.platform !== 'win32') {
    return {
      ok: true,
      summary: 'Ten komputer nie jest Windowsem. Skan ochrony systemowej dziala w aplikacji desktopowej na Windowsie.',
      defender: null,
      firewall: null,
    };
  }
  const script = `
$def = $null
try {
  $d = Get-MpComputerStatus
  $def = [ordered]@{
    AntivirusEnabled = [bool]$d.AntivirusEnabled
    RealTimeProtectionEnabled = [bool]$d.RealTimeProtectionEnabled
    AntivirusSignatureLastUpdated = [string]$d.AntivirusSignatureLastUpdated
  }
} catch {
  $def = @{ error = $_.Exception.Message }
}
$fw = @()
try {
  $fw = @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ Name = $_.Name; Enabled = [bool]$_.Enabled } })
} catch {}
[ordered]@{ defender = $def; firewall = $fw } | ConvertTo-Json -Compress -Depth 4
`;
  const result = await runUserCommand(script);
  if (!result.output) return { ok: false, error: 'Skan nie zwrocil danych.' };
  try {
    const parsed = JSON.parse(result.output);
    const rt = parsed.defender && parsed.defender.RealTimeProtectionEnabled;
    const av = parsed.defender && parsed.defender.AntivirusEnabled;
    const fwOn = Array.isArray(parsed.firewall) && parsed.firewall.every((p) => p.Enabled !== false);
    const summary = [
      av === false ? 'Antywirus wylaczony.' : 'Antywirus wlaczony.',
      rt === false ? 'Ochrona na zywo wylaczona.' : 'Ochrona na zywo wlaczona.',
      fwOn ? 'Zapora wlaczona.' : 'Zapora ma wylaczony profil.',
    ].join(' ');
    return { ok: true, summary, defender: parsed.defender, firewall: parsed.firewall };
  } catch {
    return { ok: false, error: 'Nie udalo sie odczytac wyniku skanu.', output: result.output.slice(0, 300) };
  }
}

async function runAction(name, params = {}) {
  if (name === 'skan-bezpieczenstwa') {
    try {
      return await securityScan();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (name === 'polecenie') {
    const verdict = judge('polecenie', params.tresc || params.command || '');
    if (!verdict.allow) return { ok: false, blocked: true, error: verdict.reason };
    try {
      return await runUserCommand(params.tresc || params.command || '');
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  const verdict = judge(name, '');
  if (!verdict.allow) return { ok: false, blocked: true, error: verdict.reason };

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
