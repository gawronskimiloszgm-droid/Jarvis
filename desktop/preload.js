const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', {
  runAction: (name, params) => ipcRenderer.invoke('jarvis-action', name, params),
  onWakeWord: (callback) => ipcRenderer.on('wake-word-detected', () => callback()),
});
