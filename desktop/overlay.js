// Nakladka HUD (przezroczysta, na wierzchu, opcjonalnie "click-through") z zegarem, obciazeniem
// komputera i tym, co teraz gra, oraz maleńkie okno szybkiego przechwytywania (notatka/zadanie).
// Ustawienia lokalne: overlayOn, overlayCorner (tl|tr|bl|br), overlayOpacity (0.2-1), overlayClick.

const { BrowserWindow, screen, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const settings = require('./settings');

let hud = null;
let timer = null;
let nowPlaying = '';
let lastCpu = null;
let onCapture = () => {};

ipcMain.on('jarvis-overlay-push', (_e, text) => {
  nowPlaying = String(text || '').slice(0, 120);
});

function cpuLoad() {
  const cpus = os.cpus();
  const cur = cpus.reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 });
  let load = 0;
  if (lastCpu) {
    const dt = cur.total - lastCpu.total;
    load = dt > 0 ? Math.round((1 - (cur.idle - lastCpu.idle) / dt) * 100) : 0;
  }
  lastCpu = cur;
  return load;
}

function position(win) {
  const { workArea } = screen.getPrimaryDisplay();
  const w = 260;
  const h = 118;
  const m = 14;
  const c = settings.get('overlayCorner') || 'tr';
  const x = c.endsWith('l') ? workArea.x + m : workArea.x + workArea.width - w - m;
  const y = c.startsWith('t') ? workArea.y + m : workArea.y + workArea.height - h - m;
  win.setBounds({ x, y, width: w, height: h });
}

function applyConfig() {
  if (!hud || hud.isDestroyed()) return;
  position(hud);
  hud.setOpacity(Math.max(0.2, Math.min(1, Number(settings.get('overlayOpacity')) || 0.85)));
  hud.setIgnoreMouseEvents(settings.get('overlayClick') !== false, { forward: true });
}

function start() {
  if (hud && !hud.isDestroyed()) return hud;
  hud = new BrowserWindow({
    width: 260,
    height: 118,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'overlayPreload.js'), contextIsolation: true, nodeIntegration: false },
  });
  hud.setAlwaysOnTop(true, 'screen-saver');
  hud.setMenu(null);
  hud.loadFile(path.join(__dirname, 'overlay.html')).then(() => {
    if (hud && !hud.isDestroyed()) {
      applyConfig();
      hud.showInactive();
    }
  });
  hud.on('closed', () => {
    hud = null;
    clearInterval(timer);
    timer = null;
  });
  lastCpu = null;
  cpuLoad();
  timer = setInterval(() => {
    if (!hud || hud.isDestroyed()) return;
    const total = os.totalmem();
    hud.webContents.send('overlay-data', {
      cpu: cpuLoad(),
      ram: Math.round(((total - os.freemem()) / total) * 100),
      np: nowPlaying,
    });
  }, 1500);
  return hud;
}

function stop() {
  clearInterval(timer);
  timer = null;
  if (hud && !hud.isDestroyed()) hud.destroy();
  hud = null;
}

function setOn(on) {
  settings.set('overlayOn', Boolean(on));
  if (on) start();
  else stop();
  return Boolean(on);
}

function toggle() {
  return setOn(!(hud && !hud.isDestroyed()));
}

function configure(patch = {}) {
  if (patch.corner && ['tl', 'tr', 'bl', 'br'].includes(patch.corner)) settings.set('overlayCorner', patch.corner);
  if (patch.opacity != null) settings.set('overlayOpacity', Math.max(0.2, Math.min(1, Number(patch.opacity) || 0.85)));
  if (patch.clickThrough != null) settings.set('overlayClick', Boolean(patch.clickThrough));
  applyConfig();
}

function isOn() {
  return Boolean(hud && !hud.isDestroyed());
}

// ---------- szybkie przechwytywanie ----------
let cap = null;
function openCapture() {
  if (cap && !cap.isDestroyed()) {
    cap.focus();
    return;
  }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  cap = new BrowserWindow({
    width: 520,
    height: 110,
    x: Math.round(workArea.x + (workArea.width - 520) / 2),
    y: Math.round(workArea.y + workArea.height * 0.22),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'overlayPreload.js'), contextIsolation: true, nodeIntegration: false },
  });
  cap.setAlwaysOnTop(true, 'screen-saver');
  cap.setMenu(null);
  cap.loadFile(path.join(__dirname, 'capture.html'));
  cap.on('blur', () => {
    if (cap && !cap.isDestroyed()) cap.close();
  });
  cap.on('closed', () => {
    cap = null;
  });
}

ipcMain.on('capture-result', (e, text) => {
  if (cap && e.sender === cap.webContents) {
    const t = String(text || '').trim().slice(0, 2000);
    cap.close();
    if (t) onCapture(t);
  }
});

function init({ capture }) {
  if (capture) onCapture = capture;
  if (settings.get('overlayOn')) start();
}

module.exports = { init, toggle, setOn, isOn, configure, openCapture, dispose: stop };
