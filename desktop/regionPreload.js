// Most dla okna zaznaczania fragmentu ekranu (region.html) - tylko dwie rzeczy:
// odebranie zrzutu i odeslanie zaznaczonego prostokata (albo null = anuluj).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('region', {
  onImage: (cb) => ipcRenderer.on('region-image', (_e, dataUrl) => cb(dataUrl)),
  done: (rect) => ipcRenderer.send('region-result', rect),
});
