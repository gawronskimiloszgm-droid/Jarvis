// Uruchamia lokalny syntezator glosu (voice-server/server.py) razem z aplikacja, jesli jest zainstalowany.
// Sam serwer nie zajmuje karty graficznej, dopoki Jarvis nie zacznie mowic (model wczytuje sie przy pierwszym zdaniu).

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

let proc = null;

async function alreadyRunning() {
  try {
    const r = await fetch('http://127.0.0.1:8020/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function start() {
  const home = settings.get('voiceHome') || 'D:\\JarvisVoice';
  const py = path.join(home, 'venv', 'Scripts', 'python.exe');
  const script = path.join(home, 'server.py');
  if (proc || !fs.existsSync(py) || !fs.existsSync(script) || (await alreadyRunning())) return;
  proc = spawn(py, [script], { cwd: home, windowsHide: true, stdio: 'ignore', env: { ...process.env, JARVIS_VOICE_HOME: home } });
  proc.on('exit', () => {
    proc = null;
  });
  proc.on('error', () => {
    proc = null;
  });
}

function stop() {
  if (!proc) return;
  try {
    proc.kill();
  } catch {
    /* juz zakonczony */
  }
  proc = null;
}

module.exports = { start, stop };
