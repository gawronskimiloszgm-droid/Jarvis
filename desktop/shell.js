// "Powloka" aplikacji: ikona w zasobniku, autostart z Windowsem, globalny
// skrot klawiszowy (rozmowa / przekazanie zaznaczonego tekstu), ustawienia.
// Osobno od main.js, zeby main.js zostal krotki i czytelny.

const { app, Tray, Menu, globalShortcut, ipcMain, clipboard } = require('electron');
const { exec } = require('child_process');
const settings = require('./settings');
const { trayIcon } = require('./trayIcon');

let tray = null;
let getWin = () => null;
let quitApp = () => app.quit();

function showWindow() {
  const win = getWin();
  if (!win || win.isDestroyed()) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function send(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Kopiuje ZAZNACZENIE z aplikacji, ktora ma teraz fokus (Ctrl+C), czyta je ze
// schowka i oddaje schowek do poprzedniego stanu - zeby skrot nie psul
// uzytkownikowi tego, co mial skopiowane.
function grabSelection() {
  return new Promise((resolve) => {
    const before = clipboard.readText();
    const marker = `__jarvis_${Date.now()}__`;
    clipboard.writeText(marker);
    exec(
      'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^c\')"',
      () => {
        setTimeout(() => {
          const got = clipboard.readText();
          clipboard.writeText(before);
          resolve(got && got !== marker ? got.slice(0, 8000) : '');
        }, 150);
      }
    );
  });
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const combo = settings.get('hotkey');
  if (!combo) return;
  try {
    globalShortcut.register(combo, async () => {
      const selection = process.platform === 'win32' ? await grabSelection() : '';
      showWindow();
      send('jarvis-command', { type: 'hotkey', selection });
    });
  } catch {
    /* zajety skrot - po prostu go nie mamy */
  }
}

function applyAutostart() {
  try {
    // Uruchomiony z kodu (bez instalatora) electron.exe musi dostac sciezke do aplikacji,
    // inaczej autostart odpala "golego" Electrona z jego domyslnym oknem.
    const launch = app.isPackaged ? { args: ['--hidden'] } : { path: process.execPath, args: [app.getAppPath(), '--hidden'] };
    app.setLoginItemSettings({ openAtLogin: Boolean(settings.get('autostart')), ...launch });
  } catch {
    /* nie wszedzie dostepne */
  }
}

function buildMenu() {
  const mode = settings.get('permissionMode');
  const modeItem = (id, label) => ({
    label,
    type: 'radio',
    checked: mode === id,
    click: () => {
      settings.set('permissionMode', id);
      send('jarvis-command', { type: 'permission-mode', mode: id });
    },
  });
  return Menu.buildFromTemplate([
    { label: 'Otworz J.A.R.V.I.S.', click: showWindow },
    {
      label: 'Otworz E.D.I.T.H.',
      click: () => {
        showWindow();
        send('jarvis-command', { type: 'open-edith' });
      },
    },
    { type: 'separator' },
    {
      label: 'Uprawnienia Jarvisa',
      submenu: [
        modeItem('podglad', 'Tylko podglad (nic nie zmienia)'),
        modeItem('pytaj', 'Pytaj o kazda zmiane'),
        modeItem('zaufany', 'Zaufany (pytaj tylko o ryzykowne)'),
      ],
    },
    {
      label: 'Uruchamiaj z Windowsem',
      type: 'checkbox',
      checked: Boolean(settings.get('autostart')),
      click: (item) => {
        settings.set('autostart', item.checked);
        applyAutostart();
      },
    },
    {
      label: 'Historia schowka (lokalnie)',
      type: 'checkbox',
      checked: Boolean(settings.get('clipboardHistory')),
      click: (item) => settings.set('clipboardHistory', item.checked),
    },
    { type: 'separator' },
    { label: 'Zakoncz', click: () => quitApp() },
  ]);
}

function init({ getWindow, quit }) {
  getWin = getWindow;
  if (quit) quitApp = quit;

  tray = new Tray(trayIcon());
  tray.setToolTip('J.A.R.V.I.S.');
  tray.on('click', showWindow);
  const refresh = () => tray.setContextMenu(buildMenu());
  refresh();
  // Zmiana trybu/ustawien z panelu (renderer) odswieza tez menu zasobnika.
  ipcMain.on('jarvis-settings-changed', refresh);

  applyAutostart();
  registerHotkey();

  ipcMain.handle('jarvis-setting-get', (e, key) => settings.get(key));
  ipcMain.handle('jarvis-setting-set', (e, key, value) => {
    const v = settings.set(key, value);
    if (key === 'autostart') applyAutostart();
    if (key === 'hotkey') registerHotkey();
    refresh();
    return v;
  });
}

function dispose() {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
}

module.exports = { init, dispose, showWindow };
