// Zaznaczanie fragmentu ekranu: robimy zrzut monitora pod kursorem, pokazujemy go w
// pelnoekranowym oknie, uzytkownik zaznacza prostokat (Esc anuluje), a my zwracamy
// wyciety fragment jako JPEG. Uzywane przez skrot Ctrl+Alt+S i akcje "zaznacz-ekran".

const { BrowserWindow, desktopCapturer, screen, ipcMain } = require('electron');
const path = require('path');

let pending = null;

async function capture(display) {
  const { bounds, scaleFactor } = display;
  const thumbnailSize = { width: Math.round(bounds.width * scaleFactor), height: Math.round(bounds.height * scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  return src ? src.thumbnail : null;
}

function selectRegion() {
  if (pending) return pending;
  pending = (async () => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const img = await capture(display);
    if (!img || img.isEmpty()) return { ok: false, error: 'Nie udalo sie zrobic zrzutu ekranu.' };
    const { bounds } = display;
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreen: true,
      show: false,
      backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, 'regionPreload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenu(null);

    const rect = await new Promise((resolve) => {
      let settled = false;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener('region-result', onResult);
        if (!win.isDestroyed()) win.destroy();
        resolve(r);
      };
      const onResult = (e, r) => {
        if (e.sender === win.webContents) finish(r);
      };
      ipcMain.on('region-result', onResult);
      win.on('closed', () => finish(null));
      setTimeout(() => finish(null), 120000);
      win.loadFile(path.join(__dirname, 'region.html')).then(() => {
        win.webContents.send('region-image', `data:image/jpeg;base64,${img.toJPEG(88).toString('base64')}`);
        win.show();
        win.focus();
      });
    });

    if (!rect || rect.w < 8 || rect.h < 8) return { ok: false, cancelled: true, error: 'Anulowano zaznaczanie.' };
    // Zrzut jest rozciagniety na cale okno - przeliczamy osobno w poziomie i w pionie
    // (okno moze miec inne proporcje niz monitor, np. gdy pasek zadan je przytnie).
    const { width: iw, height: ih } = img.getSize();
    const sx = iw / (rect.vw || bounds.width);
    const sy = ih / (rect.vh || bounds.height);
    const x = Math.max(0, Math.round(rect.x * sx));
    const y = Math.max(0, Math.round(rect.y * sy));
    let part = img.crop({
      x,
      y,
      width: Math.max(1, Math.min(iw - x, Math.round(rect.w * sx))),
      height: Math.max(1, Math.min(ih - y, Math.round(rect.h * sy))),
    });
    if (part.getSize().width > 1600) part = part.resize({ width: 1600 });
    return { ok: true, imageBase64: part.toJPEG(88).toString('base64'), mimeType: 'image/jpeg', width: part.getSize().width, height: part.getSize().height };
  })().finally(() => {
    pending = null;
  });
  return pending;
}

// Lekki zrzut calego ekranu do strumienia "ekran na zywo" (JPEG, zmniejszony).
async function smallShot(width = 1280, quality = 60) {
  const display = screen.getPrimaryDisplay();
  const img = await capture(display);
  if (!img || img.isEmpty()) return { ok: false, error: 'Nie udalo sie zrobic zrzutu ekranu.' };
  const w = Math.max(320, Math.min(1920, Number(width) || 1280));
  const small = img.getSize().width > w ? img.resize({ width: w }) : img;
  return { ok: true, imageBase64: small.toJPEG(Math.max(30, Math.min(90, Number(quality) || 60))).toString('base64'), mimeType: 'image/jpeg' };
}

module.exports = { selectRegion, smallShot };
