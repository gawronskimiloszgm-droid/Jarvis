const path = require('path');
const fsp = require('fs/promises');
const { shell, app, desktopCapturer, screen } = require('electron');
const { exec, spawn } = require('child_process');
const { judge } = require('./edithPolicy');

function runWindowsCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => resolve({ ok: !error, output: stdout || stderr }));
  });
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return runWindowsCommand(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`);
}

const KEY_HELPER = `
Add-Type -Namespace J -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.IntPtr dwExtraInfo);'
function Down([byte]$vk) { [J.K]::keybd_event($vk,0,0,[System.IntPtr]::Zero) }
function Up([byte]$vk) { [J.K]::keybd_event($vk,0,2,[System.IntPtr]::Zero) }
function Tap([byte]$vk) { Down $vk; Up $vk }
`;

const VK = {
  MUTE: 0xad, VOL_DOWN: 0xae, VOL_UP: 0xaf,
  NEXT: 0xb0, PREV: 0xb1, PLAY_PAUSE: 0xb3,
  LWIN: 0x5b, ALT: 0x12, CTRL: 0x11, SHIFT: 0x10,
  F4: 0x73, D: 0x44, ENTER: 0x0d, ESC: 0x1b, TAB: 0x09
};

function tapKey(vk, times = 1) {
  return runPowerShell(`${KEY_HELPER}\nfor ($i=0; $i -lt ${times}; $i++) { Tap ${vk}; Start-Sleep -Milliseconds 30 }`);
}

function tapCombo(modifierVk, vk) {
  return runPowerShell(`${KEY_HELPER}\nDown ${modifierVk}; Tap ${vk}; Up ${modifierVk}`);
}

async function takeScreenshot() {
  const dir = path.join(app.getPath('documents'), 'Jarvis');
  await fsp.mkdir(dir, { recursive: true });
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.round(size.width * scaleFactor),
    height: Math.round(size.height * scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  if (!sources.length) return { ok: false, error: 'Nie udało się pobrać widoku ekranu.' };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = `zrzut-${stamp}.png`;
  await fsp.writeFile(path.join(dir, name), sources[0].thumbnail.toPNG());
  return { ok: true, nazwa: name };
}

async function captureScreenForVision() {
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const thumbnailSize = {
    width: Math.round(size.width * scaleFactor),
    height: Math.round(size.height * scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  if (!sources.length) return { ok: false, error: 'Nie udało się pobrać widoku ekranu.' };
  return { ok: true, imageBase64: sources[0].thumbnail.toPNG().toString('base64'), mimeType: 'image/png' };
}

const WAKE_TRACK_ID = process.env.JARVIS_WAKE_TRACK || '08mG3Y1vljYA6bvDt4Wqkj';

// Rozszerzona baza akcji systemowych
const ACTIONS = {
  'otworz-spotify': async () => {
    await shell.openExternal('spotify:').catch(() => shell.openExternal('https://open.spotify.com'));
    return { ok: true };
  },
  pobudka: async () => {
    await shell.openExternal(`spotify:track:${WAKE_TRACK_ID}`).catch(() => shell.openExternal(`https://open.spotify.com/track/${WAKE_TRACK_ID}`));
    return { ok: true };
  },
  'otworz-youtube-music': async () => { await shell.openExternal('https://music.youtube.com'); return { ok: true }; },
  'otworz-przegladarke': async () => { await shell.openExternal('https://google.com'); return { ok: true }; },
  'otworz-discord': async () => { await shell.openExternal('discord:').catch(() => shell.openExternal('https://discord.com/app')); return { ok: true }; },
  'otworz-teams': async () => { await shell.openExternal('msteams:').catch(() => shell.openExternal('https://teams.microsoft.com')); return { ok: true }; },
  'otworz-slack': async () => { await shell.openExternal('slack://open').catch(() => shell.openExternal('https://slack.com/signin')); return { ok: true }; },
  'otworz-vscode': async () => { await shell.openExternal('vscode://').catch(() => runWindowsCommand('code')); return { ok: true }; },
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
  'uspij-komputer': async () => runPowerShell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false,$false)"),
  'restart-komputera': async () => runWindowsCommand('shutdown /r /t 5'),
  'wylacz-komputer': async () => runWindowsCommand('shutdown /s /t 5')
};

const files = require('./files');

const FILE_ACTIONS = {
  'zapisz-plik': (p) => files.writeFile(p.nazwa, p.tresc),
  'dopisz-do-pliku': (p) => files.appendFile(p.nazwa, p.tresc),
  'czytaj-plik': (p) => files.readFile(p.nazwa),
  'lista-plikow': () => files.listFiles(),
  'otworz-folder-jarvisa': () => files.openFolder(),
};

// Nowe uniwersalne funkcje rozszerzające sterowanie komputerem
const DYNAMIC_SYSTEM_ACTIONS = {
  // Uruchamianie dowolnych aplikacji systemowych (np. "notepad", "calc", "chrome", "steam")
  'otworz-aplikacje': async (params) => {
    const appName = String(params.nazwa || params.app || '').trim();
    if (!appName) return { ok: false, error: 'Nie podano nazwy aplikacji.' };
    return runWindowsCommand(`start "" "${appName}"`);
  },

  // Zamknięcie wskazanego procesu (np. "chrome.exe", "notepad.exe")
  'zamknij-proces': async (params) => {
    const processName = String(params.nazwa || params.process || '').trim();
    if (!processName) return { ok: false, error: 'Nie podano nazwy procesu.' };
    return runWindowsCommand(`taskkill /IM "${processName}" /F`);
  },

  // Pobranie listy aktywnych procesów z zużyciem pamięci RAM
  'lista-procesow': async () => {
    const script = `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 15 Name, @{Name="RAM_MB";Expression={[math]::round($_.WorkingSet64/1MB, 2)}} | ConvertTo-Json`;
    const res = await runPowerShell(script);
    try {
      return { ok: true, processes: JSON.parse(res.output) };
    } catch {
      return { ok: false, error: 'Nie udało się przetworzyć listy procesów.' };
    }
  },

  // Pisanie wskazanego tekstu w aktywnym oknie
  'pisz-tekst': async (params) => {
    const text = String(params.tekst || params.text || '');
    if (!text) return { ok: false, error: 'Brak tekstu do wpisania.' };
    const escapedText = text.replace(/'/g, "''");
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedText}')`;
    return runPowerShell(script);
  },

  // Wykonanie określonego skrótu klawiszowego (np. ctrl+c, alt+tab)
  'skrot-klawiszowy': async (params) => {
    const keys = String(params.keys || '').toLowerCase();
    if (keys === 'ctrl+c') return tapCombo(VK.CTRL, 0x43);
    if (keys === 'ctrl+v') return tapCombo(VK.CTRL, 0x56);
    if (keys === 'ctrl+z') return tapCombo(VK.CTRL, 0x5a);
    if (keys === 'alt+tab') return tapCombo(VK.ALT, VK.TAB);
    return { ok: false, error: 'Nieobsługiwana kombinacja klawiszy.' };
  },

  // Włączanie/wyłączanie karty sieciowej Wi-Fi / Ethernet
  'sterowanie-siecia': async (params) => {
    const state = params.wlacz ? 'Enable' : 'Disable';
    const script = `Get-NetAdapter | ${state}-NetAdapter -Confirm:$false`;
    return runPowerShell(script);
  }
};

function runUserCommand(command) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'powershell.exe' : 'bash';
    const args = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-lc', command];
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} }, 25000);

    child.stdout.on('data', (d) => {
      out += d.toString();
      if (out.length > 15000) out = out.slice(-15000);
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 5000) err = err.slice(-5000);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = (out || err).trim().slice(0, 5000);
      resolve({ ok: code === 0, code, output });
    });
  });
}

async function securityScan() {
  if (process.platform !== 'win32') {
    return { ok: true, summary: 'Skanowanie bezpieczeństwa aktywne tylko dla systemu Windows.', defender: null, firewall: null };
  }
  const script = `
$def = $null
try {
  $d = Get-MpComputerStatus
  $def = [ordered]@{ AntivirusEnabled = [bool]$d.AntivirusEnabled; RealTimeProtectionEnabled = [bool]$d.RealTimeProtectionEnabled; AntivirusSignatureLastUpdated = [string]$d.AntivirusSignatureLastUpdated }
} catch { $def = @{ error = $_.Exception.Message } }
$fw = @()
try { $fw = @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ Name = $_.Name; Enabled = [bool]$_.Enabled } }) } catch {}
[ordered]@{ defender = $def; firewall = $fw } | ConvertTo-Json -Compress -Depth 4
`;
  const result = await runUserCommand(script);
  if (!result.output) return { ok: false, error: 'Skanowanie nie zwróciło odpowiedzi.' };
  try {
    const parsed = JSON.parse(result.output);
    const rt = parsed.defender && parsed.defender.RealTimeProtectionEnabled;
    const av = parsed.defender && parsed.defender.AntivirusEnabled;
    const fwOn = Array.isArray(parsed.firewall) && parsed.firewall.every((p) => p.Enabled !== false);
    const summary = [
      av === false ? 'E.D.I.T.H.: Antywirus wyłączony!' : 'Antywirus aktywny.',
      rt === false ? 'E.D.I.T.H.: Ochrona w czasie rzeczywistym wyłączona!' : 'Ochrona na żywo aktywna.',
      fwOn ? 'Zapora sieciowa aktywna.' : 'E.D.I.T.H.: Zapora ma wyłączony profil!'
    ].join(' ');
    return { ok: true, summary, defender: parsed.defender, firewall: parsed.firewall };
  } catch {
    return { ok: false, error: 'Błąd przetwarzania raportu bezpieczeństwa.', output: result.output.slice(0, 300) };
  }
}

async function runAction(name, params = {}, options = {}) {
  // 1. Analiza bezpieczeństwa i ocena E.D.I.T.H.
  const commandText = params.tresc || params.command || '';
  const verdict = judge(name, commandText, options);

  if (!verdict.allow) {
    if (verdict.requiresConfirmation) {
      return {
        ok: false,
        requiresEdithConfirmation: true,
        warning: verdict.warning,
        reason: verdict.reason,
        pendingAction: { name, params }
      };
    }
    return { ok: false, blocked: true, edithReason: verdict.reason };
  }

  // 2. Obsługa dedykowanego skanowania
  if (name === 'skan-bezpieczenstwa') {
    return await securityScan().catch((e) => ({ ok: false, error: e.message }));
  }

  // 3. Obsługa dynamicznych skryptów komend
  if (name === 'polecenie') {
    try {
      return await runUserCommand(commandText);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // 4. Obsługa operacji plikowych
  const fileFn = FILE_ACTIONS[name];
  if (fileFn) {
    try { return await fileFn(params || {}); } catch (e) { return { ok: false, error: e.message }; }
  }

  // 5. Obsługa dynamicznych akcji rozszerzonych
  const dynFn = DYNAMIC_SYSTEM_ACTIONS[name];
  if (dynFn) {
    try { return await dynFn(params || {}); } catch (e) { return { ok: false, error: e.message }; }
  }

  // 6. Obsługa akcji standardowych
  const fn = ACTIONS[name];
  if (!fn) return { ok: false, error: 'E.D.I.T.H.: Wybrana akcja nie istnieje.' };
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  runAction,
  actionNames: [
    ...Object.keys(ACTIONS),
    ...Object.keys(FILE_ACTIONS),
    ...Object.keys(DYNAMIC_SYSTEM_ACTIONS)
  ],
};
