const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', {
  runAction: (name) => ipcRenderer.invoke('jarvis-action', name),
});
