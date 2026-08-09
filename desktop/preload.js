const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', {
  runAction: (name) => ipcRenderer.invoke('jarvis-action', name),
  onWakeWord: (callback) => ipcRenderer.on('wake-word-detected', () => callback()),
});
