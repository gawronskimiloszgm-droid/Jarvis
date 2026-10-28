// Most dla okien nakladki HUD i szybkiego przechwytywania.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onData: (cb) => ipcRenderer.on('overlay-data', (_e, d) => cb(d)),
  capture: (text) => ipcRenderer.send('capture-result', text),
});
