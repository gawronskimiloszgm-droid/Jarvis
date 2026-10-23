const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', {
  // Trzeci argument (options) niesie { confirmedByEdith: true } przy
  // ponownym wywolaniu akcji po tym, jak uzytkownik potwierdzil ostrzezenie
  // E.D.I.T.H. - main.js juz to przyjmowal, ale ten bridge go gubil.
  runAction: (name, params, options) => ipcRenderer.invoke('jarvis-action', name, params, options),
  onWakeWord: (callback) => ipcRenderer.on('wake-word-detected', () => callback()),
});
