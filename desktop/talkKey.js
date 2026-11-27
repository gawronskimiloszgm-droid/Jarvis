// Prawy Enter (na klawiaturze numerycznej) wlacza rozmowe z Jarvisem, takze gdy okno jest schowane.
// Windows odroznia go od zwyklego Entera dopiero na poziomie haka klawiatury (uiohook-napi): skrot
// globalny Electrona by tego nie potrafil. Hak tylko patrzy na ten jeden klawisz, niczego nie zapisuje
// i nie blokuje: Enter trafia tez do aktywnego okna.
// Do tego maly wskaznik na ekranie, gdy Jarvis slucha (okno aplikacji bywa wtedy ukryte).
const { BrowserWindow, screen } = require('electron');

let hook = null;
let handlers = null;
let down = 0;

function onKeyDown(e) {
  if (e.keycode !== hook.UiohookKey.NumpadEnter || down) return; // powtorzenia przy przytrzymaniu pomijamy
  down = Date.now();
  handlers.onDown();
}
function onKeyUp(e) {
  if (e.keycode !== hook.UiohookKey.NumpadEnter || !down) return;
  const held = Date.now() - down;
  down = 0;
  handlers.onUp(held);
}

/** Start nasluchu prawego Entera. Zwraca false, gdy hak nie jest dostepny na tym systemie. */
function start(h) {
  if (hook) return true;
  try {
    const lib = require('uiohook-napi');
    hook = { uIOhook: lib.uIOhook, UiohookKey: lib.UiohookKey };
    handlers = h;
    hook.uIOhook.on('keydown', onKeyDown);
    hook.uIOhook.on('keyup', onKeyUp);
    hook.uIOhook.start();
    return true;
  } catch (e) {
    console.warn('Prawy Enter niedostepny:', e.message);
    hook = null;
    return false;
  }
}

function stop() {
  if (!hook) return;
  try {
    hook.uIOhook.removeListener('keydown', onKeyDown);
    hook.uIOhook.removeListener('keyup', onKeyUp);
    hook.uIOhook.stop();
  } catch {
    /* juz zatrzymany */
  }
  hook = null;
  down = 0;
}

// ---------- wskaznik "Jarvis slucha" ----------
let indicator = null;
const HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:system-ui;user-select:none}
.w{display:inline-flex;white-space:nowrap;align-items:center;gap:10px;padding:8px 16px;margin:6px;border-radius:30px;background:rgba(2,12,20,.86);border:1px solid rgba(51,224,255,.7);box-shadow:0 0 18px rgba(51,224,255,.45);color:#cfefff;font-size:13px;letter-spacing:.5px}
.r{width:14px;height:14px;border-radius:50%;background:#33e0ff;box-shadow:0 0 12px #33e0ff;animation:p 1.1s ease-in-out infinite}
@keyframes p{50%{transform:scale(.6);opacity:.5}}
b{font-family:monospace;letter-spacing:2px}
</style><div class="w"><div class="r"></div><div><b>J.A.R.V.I.S.</b> słucha · prawy Enter kończy</div></div>`;

function setLive(on) {
  if (!on) {
    if (indicator && !indicator.isDestroyed()) indicator.hide();
    return;
  }
  if (!indicator || indicator.isDestroyed()) {
    const { workArea } = screen.getPrimaryDisplay();
    const w = 390;
    const h = 60;
    indicator = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round(workArea.x + (workArea.width - w) / 2),
      y: workArea.y + workArea.height - h - 12,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    indicator.setAlwaysOnTop(true, 'screen-saver');
    indicator.setIgnoreMouseEvents(true);
    indicator.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  }
  indicator.showInactive(); // bez zabierania fokusu aktywnemu oknu
}

function dispose() {
  stop();
  if (indicator && !indicator.isDestroyed()) indicator.destroy();
  indicator = null;
}

module.exports = { start, stop, setLive, dispose };
