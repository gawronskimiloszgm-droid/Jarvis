const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', {
  // Trzeci argument (options) niesie { confirmedByEdith: true } przy
  // ponownym wywolaniu akcji po tym, jak uzytkownik potwierdzil ostrzezenie
  // E.D.I.T.H. - main.js juz to przyjmowal, ale ten bridge go gubil.
  runAction: (name, params, options) => ipcRenderer.invoke('jarvis-action', name, params, options),
  onWakeWord: (callback) => ipcRenderer.on('wake-word-detected', () => callback()),
  // Wersja POWLOKI (nie strony) - serwer porownuje ja z minDesktopVersion.
  version: ipcRenderer.sendSync('jarvis-version'),
  updateStatus: () => ipcRenderer.invoke('jarvis-update-status'),
  checkForUpdate: () => ipcRenderer.invoke('jarvis-update-check'),
  installUpdate: () => ipcRenderer.invoke('jarvis-update-install'),
  // Ustawienia lokalne tego komputera (tryb uprawnien, schowek, autostart...).
  getSetting: (key) => ipcRenderer.invoke('jarvis-setting-get', key),
  setSetting: (key, value) => ipcRenderer.invoke('jarvis-setting-set', key, value),
  // Polecenia z zasobnika/skrotu: { type: 'open-edith' | 'hotkey' | 'permission-mode', ... }
  onCommand: (cb) => ipcRenderer.on('jarvis-command', (_e, c) => cb(c)),
  // Nakladka HUD: tekst "teraz gra" i ustawienia (patrz overlay.js).
  overlayPush: (text) => ipcRenderer.send('jarvis-overlay-push', text),
  overlayState: () => ipcRenderer.invoke('jarvis-overlay-state'),
  overlaySet: (patch) => ipcRenderer.invoke('jarvis-overlay-set', patch),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
