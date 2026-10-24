const { app, BrowserWindow, session, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { runAction } = require('./actions');
const { initUpdater } = require('./updater');
const shell = require('./shell');
const scheduler = require('./scheduler');

let mainWindow = null;

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const JARVIS_URL = process.env.JARVIS_URL || config.url;

let wakeProc = null;
let quitting = false;
let wakeCrashCount = 0;
const WAKE_MAX_CRASHES = 3;

// Wbudowany, offline wykrywacz slowa "Jarvis" (System.Speech przez PowerShell)
// - zastepuje brakujaca w Elektronowym Chromium Web Speech API, zeby aplikacja
// desktopowa tez dzialala bez klikania przycisku ucha. Wymaga jednorazowo
// zainstalowanego w Windows pakietu rozpoznawania mowy (Ustawienia > Czas i
// jezyk > Mowa) - bez niego skrypt konczy sie od razu bledem, wiec po kilku
// szybkich awariach z rzedu przestajemy probowac zamiast zapetlac sie w kolko.
function startWakeWordListener(win) {
  if (process.platform !== 'win32') return;
  try {
    wakeProc = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(__dirname, 'wakeword.ps1'),
    ]);

    const startedAt = Date.now();
    let buffer = '';
    wakeProc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line === 'WAKE' && win && !win.isDestroyed()) {
          win.webContents.send('wake-word-detected');
        }
      }
    });

    wakeProc.on('exit', () => {
      wakeProc = null;
      const ranMs = Date.now() - startedAt;
      wakeCrashCount = ranMs < 5000 ? wakeCrashCount + 1 : 0;
      if (wakeCrashCount >= WAKE_MAX_CRASHES) {
        console.warn(
          'Lokalny wykrywacz slowa "Jarvis" nie startuje (prawdopodobnie brak pakietu ' +
            'rozpoznawania mowy w Windows: Ustawienia > Czas i jezyk > Mowa). Uzyj przycisku ucha.'
        );
        return;
      }
      if (!quitting && win && !win.isDestroyed()) {
        setTimeout(() => startWakeWordListener(win), 2000);
      }
    });
  } catch (e) {
    wakeProc = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#020409',
    title: 'J.A.R.V.I.S.',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = win;
  // Zamkniecie okna chowa aplikacje do zasobnika (Jarvis dalej nasluchuje,
  // dziala skrot globalny i zadania cykliczne). Prawdziwe wyjscie: menu
  // zasobnika -> Zakoncz.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  if (process.argv.includes('--hidden')) win.once('ready-to-show', () => win.hide());
  win.loadURL(JARVIS_URL);
  startWakeWordListener(win);
}

// Zaktualizowany handler IPC przekazujacy opcje weryfikacji i autoryzacji E.D.I.T.H.
ipcMain.handle('jarvis-action', (event, name, params, options = {}) => {
  return runAction(name, params, options);
});

ipcMain.on('jarvis-version', (event) => {
  event.returnValue = app.getVersion();
});

app.whenReady().then(() => {
  // Zezwalaj automatycznie na kamere/mikrofon/powiadomienia dla wlasnej aplikacji
  // (to Twoje wlasne okno, nie obca strona - nie ma powodu pytac za kazdym razem).
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'notifications', 'clipboard-read'];
    callback(allowed.includes(permission));
  });

  createWindow();
  initUpdater(() => mainWindow);
  shell.init({
    getWindow: () => mainWindow,
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
  scheduler.init(
    (name, params, options) => runAction(name, params, options),
    (title, body) => {
      try {
        new Notification({ title, body }).show();
      } catch {
        /* powiadomienia wylaczone w systemie */
      }
    }
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Aplikacja zyje w zasobniku - zamkniecie okna nie konczy procesu.
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  quitting = true;
  shell.dispose();
  if (wakeProc) {
    try { wakeProc.kill(); } catch (e) { /* noop */ }
    wakeProc = null;
  }
});
