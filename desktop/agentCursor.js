// Niebieski kursor Jarvisa: widac, gdzie on dziala, a Twoja myszka zostaje Twoja.
//
// Windows ma jeden prawdziwy wskaznik, wiec to nakladka: przezroczyste okno na wierzchu, ktore nie
// lapie myszy ani fokusu. Klikniecia ida przez UI Automation (bez ruszania wskaznika), a gdy aplikacja
// tego nie obsluguje, wskaznik przeskakuje na ulamek sekundy i wraca (patrz uia.js).
// Okno jest wykluczone ze zrzutow ekranu, zeby agent nie widzial na nich wlasnego kursora.

const { BrowserWindow, screen } = require('electron');
const settings = require('./settings');

const MOVE_MS = 380;
const IDLE_HIDE_MS = 4500;

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;pointer-events:none}
#c{position:absolute;left:0;top:0;transition:transform ${MOVE_MS}ms cubic-bezier(.3,.8,.3,1);will-change:transform;filter:drop-shadow(0 0 5px #33b4ff) drop-shadow(0 1px 2px #0009)}
#t{position:absolute;left:22px;top:20px;padding:1px 6px;border-radius:4px;background:#0a6fd8;color:#fff;font:700 10px/15px Segoe UI,sans-serif;letter-spacing:.8px}
.r{position:absolute;width:12px;height:12px;margin:-6px;border:2px solid #33b4ff;border-radius:50%;animation:r .45s ease-out forwards}
@keyframes r{to{transform:scale(4);opacity:0}}
</style><div id="c"><svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2l0 22 6-5.5 4 9.5 4.5-2-4-9.3 8.3-.7z" fill="#1e90ff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div id="t">JARVIS</div></div>
<script>
const c=document.getElementById('c');let px=0,py=0;
window.go=(x,y)=>{px=x;py=y;c.style.transform='translate('+x+'px,'+y+'px)'};
window.jump=(x,y)=>{c.style.transition='none';go(x,y);c.getBoundingClientRect();c.style.transition=''};
window.ripple=()=>{const r=document.createElement('div');r.className='r';r.style.left=px+'px';r.style.top=py+'px';document.body.appendChild(r);setTimeout(()=>r.remove(),500)};
</script>`;

let win = null;
let ready = null;
let hideTimer = null;
let pinned = false;
let last = null;

const enabled = () => settings.get('agentCursor') !== false;
const live = () => win && !win.isDestroyed();

function ensure() {
  if (live() && ready) return ready;
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Windows przycina nowe okno do obszaru roboczego, a kursor ma dojechac tez na pasek zadan.
  win.setBounds(bounds);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(true);
  win.setMenu(null);
  win.on('closed', () => {
    win = null;
    ready = null;
    last = null;
  });
  ready = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  return ready;
}

function call(script) {
  return live() ? win.webContents.executeJavaScript(script, true).catch(() => {}) : Promise.resolve();
}

function armHide() {
  clearTimeout(hideTimer);
  if (pinned) return;
  hideTimer = setTimeout(() => {
    if (live()) win.hide();
  }, IDLE_HIDE_MS);
}

/** Przesuwa niebieski kursor do punktu ekranu i czeka, az dojedzie. Bledy nakladki nie moga psuc samej akcji. */
async function moveTo(x, y) {
  if (!enabled() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  try {
    await ensure();
    const { bounds } = screen.getPrimaryDisplay();
    const lx = Math.round(x - bounds.x);
    const ly = Math.round(y - bounds.y);
    if (!win.isVisible() || !last) {
      // Wyjezdza spod Twojej myszki, zeby bylo widac, skad sie wzial.
      const from = screen.getCursorScreenPoint();
      await call(`jump(${Math.round(from.x - bounds.x)},${Math.round(from.y - bounds.y)})`);
      win.showInactive();
    }
    await call(`go(${lx},${ly})`);
    last = { x: lx, y: ly };
    armHide();
    await new Promise((r) => setTimeout(r, MOVE_MS + 30));
  } catch {
    /* nakladka to dodatek */
  }
}

function click() {
  if (!enabled() || !live()) return;
  call('ripple()');
  armHide();
}

/** Na czas pracy agenta kursor zostaje na ekranie miedzy krokami. */
async function pin(on) {
  pinned = Boolean(on);
  if (!enabled()) return;
  if (pinned) {
    try {
      await moveTo(...(() => {
        const p = last ? { x: last.x + screen.getPrimaryDisplay().bounds.x, y: last.y + screen.getPrimaryDisplay().bounds.y } : screen.getCursorScreenPoint();
        return [p.x, p.y];
      })());
    } catch {
      /* nakladka to dodatek */
    }
  }
  armHide();
}

function dispose() {
  clearTimeout(hideTimer);
  if (live()) win.destroy();
}

module.exports = { moveTo, click, pin, enabled, dispose, MOVE_MS };
