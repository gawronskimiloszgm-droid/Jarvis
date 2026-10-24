// Auto-aktualizacja powloki desktopowej (GitHub Releases).
//
// Sam interfejs (index.html/app.js) ladowany jest z serwera, wiec aktualizuje
// sie przy kazdym deployu. Ale to, CO MOZE ZROBIC na komputerze (akcje,
// polityka E.D.I.T.H., most preload) siedzi w tej aplikacji - i to jest
// dokladnie to, co ostatnio zostalo w starej wersji. Stad ten modul.

const { app, ipcMain } = require('electron');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
let status = { state: 'idle', version: app.getVersion() };
let sendToWindow = () => {};
// Podmieniane na prawdziwe sprawdzanie dopiero, gdy updater sie uda zaladowac
// (w trybie deweloperskim zostaje to "nic nie rob").
let doCheck = async () => status;

function setStatus(next) {
  status = { ...status, ...next, version: app.getVersion() };
  sendToWindow(status);
}

function initUpdater(getWindow) {
  sendToWindow = (s) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update-status', s);
  };

  ipcMain.handle('jarvis-update-status', () => status);
  ipcMain.handle('jarvis-update-check', () => doCheck());
  ipcMain.handle('jarvis-update-install', () => {
    try {
      require('electron-updater').autoUpdater.quitAndInstall();
      return true;
    } catch {
      return false;
    }
  });

  // W trybie deweloperskim (npm start) nie ma czego aktualizowac.
  if (!app.isPackaged) {
    setStatus({ state: 'dev' });
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    setStatus({ state: 'error', error: 'brak modulu electron-updater' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', next: info.version }));
  autoUpdater.on('update-not-available', () => setStatus({ state: 'current' }));
  autoUpdater.on('download-progress', (p) => setStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'ready', next: info.version }));
  autoUpdater.on('error', (err) => setStatus({ state: 'error', error: String(err && err.message ? err.message : err).slice(0, 200) }));

  doCheck = () => autoUpdater.checkForUpdates().then(() => status).catch(() => status);
  doCheck();
  setInterval(doCheck, CHECK_EVERY_MS).unref?.();
}

module.exports = { initUpdater };
