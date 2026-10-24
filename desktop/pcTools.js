// Akcje "komputera": wyszukiwanie plikow, uklad okien i pulpitow, schowek,
// skany bezpieczenstwa (autostart, siec, Defender), kwarantanna procesu.
// Rejestrowane w actions.js (DYNAMIC_SYSTEM_ACTIONS) - przechodza przez ta
// sama polityke E.D.I.T.H. co wszystko inne.

const { clipboard } = require('electron');
const scripts = require('./pcscripts');
const settings = require('./settings');

const KEYS = `
Add-Type -Namespace J -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.IntPtr dwExtraInfo);'
function Down([byte]$vk) { [J.K]::keybd_event($vk,0,0,[System.IntPtr]::Zero) }
function Up([byte]$vk) { [J.K]::keybd_event($vk,0,2,[System.IntPtr]::Zero) }
`;

const VK = { LWIN: 0x5b, CTRL: 0x11, LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, TAB: 0x09, D: 0x44, F4: 0x73 };

// tryb -> [modyfikatory, klawisz]
const WINDOW_MODES = {
  lewo: [[VK.LWIN], VK.LEFT],
  prawo: [[VK.LWIN], VK.RIGHT],
  maksymalizuj: [[VK.LWIN], VK.UP],
  minimalizuj: [[VK.LWIN], VK.DOWN],
  przeglad: [[VK.LWIN], VK.TAB],
  'pulpit-nowy': [[VK.LWIN, VK.CTRL], VK.D],
  'pulpit-nastepny': [[VK.LWIN, VK.CTRL], VK.RIGHT],
  'pulpit-poprzedni': [[VK.LWIN, VK.CTRL], VK.LEFT],
  'pulpit-zamknij': [[VK.LWIN, VK.CTRL], VK.F4],
};

// Historia schowka: tylko gdy uzytkownik sam ja wlaczyl (w schowku bywaja
// hasla), tylko w pamieci procesu, nigdy nie wysylana na serwer sama z siebie.
const history = [];
let lastClip = '';
let watcher = null;

function startClipboardWatch() {
  if (watcher) return;
  watcher = setInterval(() => {
    if (!settings.get('clipboardHistory')) return;
    let t = '';
    try {
      t = clipboard.readText();
    } catch {
      return;
    }
    if (!t || t === lastClip) return;
    lastClip = t;
    history.unshift({ text: t.slice(0, 4000), at: Date.now() });
    if (history.length > 50) history.length = 50;
  }, 1500);
  watcher.unref?.();
}

function parse(res, fallback) {
  try {
    return JSON.parse(res.output);
  } catch {
    return { ok: false, error: fallback };
  }
}

function make({ runPowerShell }) {
  startClipboardWatch();
  return {
    'szukaj-plikow': async (p) => {
      const query = String(p.zapytanie || p.query || '').trim();
      if (!query && !p.rozszerzenie) return { ok: false, error: 'Podaj, czego szukac (nazwa albo fragment tresci).' };
      const res = await runPowerShell(scripts.searchFilesScript({ query, days: p.dni || 0, ext: p.rozszerzenie || '', limit: p.limit || 40 }));
      const out = parse(res, 'Wyszukiwanie plikow nie powiodlo sie.');
      return out.files ? { ok: true, ...out } : out;
    },
    'skan-autostartu': async () => {
      const out = parse(await runPowerShell(scripts.startupScript()), 'Nie udalo sie odczytac autostartu.');
      return out.items ? { ok: true, ...out } : out;
    },
    'polaczenia-sieciowe': async () => {
      const out = parse(await runPowerShell(scripts.networkScript()), 'Nie udalo sie odczytac polaczen.');
      return out.established ? { ok: true, ...out } : out;
    },
    'defender-status': async () => {
      const out = parse(await runPowerShell(scripts.defenderScript()), 'Nie udalo sie odczytac stanu Defendera.');
      return out.status ? { ok: true, ...out } : out;
    },
    'defender-skan': async (p) => parse(await runPowerShell(scripts.defenderScanScript(p.rodzaj === 'pelny' ? 'full' : 'quick')), 'Nie udalo sie uruchomic skanu Defendera.'),
    'zawies-proces': async (p) => parse(await runPowerShell(scripts.suspendScript(p.nazwa || p.pid, false)), 'Nie udalo sie zawiesic procesu.'),
    'wznow-proces': async (p) => parse(await runPowerShell(scripts.suspendScript(p.nazwa || p.pid, true)), 'Nie udalo sie wznowic procesu.'),

    'ukladaj-okno': async (p) => {
      const mode = WINDOW_MODES[String(p.tryb || '').toLowerCase()];
      if (!mode) return { ok: false, error: `Znane tryby: ${Object.keys(WINDOW_MODES).join(', ')}.` };
      const [mods, vk] = mode;
      const down = mods.map((m) => `Down ${m}`).join('; ');
      const up = [...mods].reverse().map((m) => `Up ${m}`).join('; ');
      const res = await runPowerShell(`${KEYS}\n${down}; Down ${vk}; Up ${vk}; ${up}`);
      return { ok: res.ok, tryb: p.tryb };
    },

    'schowek-odczyt': async () => ({ ok: true, tekst: clipboard.readText().slice(0, 20000) }),
    'schowek-zapis': async (p) => {
      clipboard.writeText(String(p.tekst ?? p.text ?? ''));
      return { ok: true };
    },
    'schowek-historia': async () => ({
      ok: true,
      wlaczona: Boolean(settings.get('clipboardHistory')),
      wpisy: history.slice(0, 30),
    }),
  };
}

module.exports = { make, WINDOW_MODES };
