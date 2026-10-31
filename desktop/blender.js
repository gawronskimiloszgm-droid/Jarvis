// Blender na tym komputerze: wyszukanie, instalacja (przenosna wersja z blender.org, na dysk z
// najwieksza iloscia miejsca, suma SHA-256 sprawdzana przed rozpakowaniem), budowa projektu w tle
// i otwieranie wynikow. Skrypt blender_build.py jest staly, a dane to tylko liczby i napisy.
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { app, shell } = require('electron');

const VERSION = '4.5.10';
const ZIP_URL = `https://download.blender.org/release/Blender4.5/blender-${VERSION}-windows-x64.zip`;
const ZIP_SHA256 = 'ef6d846b8015f47ade6df3f9322ce17419080a5d922fa562b6c966064fe30dce';
const ZIP_MB = 381;
const NEED_FREE = 2.5 * 1024 * 1024 * 1024; // archiwum i rozpakowana wersja

const state = { faza: 'bezczynny', postep: 0, tekst: '', proc: null };
const setState = (faza, postep, tekst) => Object.assign(state, { faza, postep, tekst });

const exists = (p) => fs.promises.access(p).then(() => true, () => false);
const studioRoot = () => path.join(app.getPath('documents'), 'Jarvis', 'Studio');

async function lettersWithSpace() {
  if (process.platform !== 'win32') return [];
  const out = [];
  for (const l of 'CDEFGH') {
    try {
      const s = await fsp.statfs(`${l}:\\`);
      out.push({ root: `${l}:\\`, free: s.bavail * s.bsize });
    } catch {
      /* brak dysku */
    }
  }
  return out;
}

async function blenderIn(dir) {
  const items = await fsp.readdir(dir).catch(() => []);
  const hits = items.filter((d) => /^(blender[-\w. ]*)$/i.test(d)).sort().reverse();
  for (const d of hits) {
    const exe = path.join(dir, d, 'blender.exe');
    if (await exists(exe)) return exe;
  }
  return null;
}

async function find() {
  // Tylko znane miejsca. Sciezki nie da sie ustawic ze strony: moglaby wskazac dowolny program.
  if (process.platform !== 'win32') {
    for (const p of ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender', '/Applications/Blender.app/Contents/MacOS/Blender']) {
      if (await exists(p)) return p;
    }
    return null;
  }
  for (const drive of await lettersWithSpace()) {
    const own = await blenderIn(path.join(drive.root, 'Jarvis', 'Blender'));
    if (own) return own;
    const sys = await blenderIn(path.join(drive.root, 'Program Files', 'Blender Foundation'));
    if (sys) return sys;
  }
  return blenderIn(path.join(app.getPath('userData'), 'Blender'));
}

function versionOf(exe) {
  return new Promise((resolve) => {
    execFile(exe, ['--version'], { timeout: 20000, windowsHide: true }, (err, out) => resolve(err ? null : /Blender\s+([\d.]+)/.exec(out)?.[1] || null));
  });
}

let cached = null;
async function status() {
  const exe = await find();
  if (exe && cached?.exe !== exe) cached = { exe, wersja: await versionOf(exe) };
  return { ok: true, zainstalowany: Boolean(exe), sciezka: exe || null, wersja: exe ? cached?.wersja : null, instalacja_mb: ZIP_MB, wersja_do_instalacji: VERSION, ...publicState() };
}
const publicState = () => ({ faza: state.faza, postep: state.postep, tekst: state.tekst });

async function install() {
  if (process.platform !== 'win32') return { ok: false, error: 'Automatyczna instalacja działa na Windows. Zainstaluj Blendera z blender.org.' };
  if (state.faza !== 'bezczynny') return { ok: false, error: 'Blender już pracuje. Chwila.' };
  const already = await find();
  if (already) return { ok: true, sciezka: already, juz_byl: true };
  const drives = (await lettersWithSpace()).sort((a, b) => b.free - a.free);
  if (!drives.length || drives[0].free < NEED_FREE) return { ok: false, error: `Za mało miejsca: potrzeba około ${Math.round(NEED_FREE / 1024 ** 3)} GB wolnego.` };
  const dir = path.join(drives[0].root, 'Jarvis', 'Blender');
  const zip = path.join(dir, 'blender.zip');
  try {
    await fsp.mkdir(dir, { recursive: true });
    setState('instalacja', 1, 'Pobieram Blendera');
    const res = await fetch(ZIP_URL, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`serwer Blendera odpowiedział ${res.status}`);
    const total = Number(res.headers.get('content-length')) || ZIP_MB * 1024 * 1024;
    const hash = crypto.createHash('sha256');
    let got = 0;
    const src = Readable.fromWeb(res.body);
    src.on('data', (d) => {
      hash.update(d);
      got += d.length;
      setState('instalacja', Math.round((got / total) * 88), `Pobieram Blendera: ${Math.round(got / 1048576)} z ${Math.round(total / 1048576)} MB`);
    });
    await pipeline(src, fs.createWriteStream(zip));
    if (hash.digest('hex') !== ZIP_SHA256) throw new Error('suma kontrolna się nie zgadza, plik odrzucony');
    setState('instalacja', 90, 'Rozpakowuję');
    await new Promise((resolve, reject) => {
      execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir], { timeout: 600000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
    });
    const exe = await blenderIn(dir);
    if (!exe) throw new Error('po rozpakowaniu nie ma programu');
    return { ok: true, sciezka: exe, wersja: await versionOf(exe) };
  } catch (e) {
    return { ok: false, error: `Instalacja Blendera nie powiodła się: ${e.message || e}` };
  } finally {
    await fsp.rm(zip, { force: true }).catch(() => {});
    setState('bezczynny', 0, '');
  }
}

const slug = (s) => String(s || 'projekt').normalize('NFD').replace(/[^\w -]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'projekt';

async function readB64(file, maxMb) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st || st.size > maxMb * 1048576) return null;
  return (await fsp.readFile(file)).toString('base64');
}

async function build(params = {}) {
  if (state.faza !== 'bezczynny') return { ok: false, error: 'Blender już pracuje nad innym zadaniem.' };
  const exe = await find();
  if (!exe) return { ok: false, brak: true, error: 'Blender nie jest zainstalowany.' };
  const czesci = Array.isArray(params.czesci) ? params.czesci : [];
  if (!czesci.length) return { ok: false, error: 'Projekt jest pusty.' };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const dir = path.join(studioRoot(), `${slug(params.nazwa)}-${stamp}`);
  await fsp.mkdir(dir, { recursive: true });
  const input = path.join(dir, 'wejscie.json');
  await fsp.writeFile(input, JSON.stringify({ nazwa: params.nazwa, skala: params.skala, rozmiar: params.rozmiar, opcje: params.opcje || {}, czesci }));
  // Skrypt musi lezec poza archiwum aplikacji, bo Blender nie czyta plikow z asar.
  const script = path.join(dir, 'budowa.py');
  await fsp.writeFile(script, await fsp.readFile(path.join(__dirname, 'blender_build.py')));

  setState('budowa', 2, 'Uruchamiam Blendera');
  const log = [];
  const code = await new Promise((resolve) => {
    const proc = spawn(exe, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script, '--', input, dir], { cwd: dir, windowsHide: true });
    state.proc = proc;
    const timer = setTimeout(() => proc.kill(), (params.opcje?.wideo ? 45 : 12) * 60000);
    const onData = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        const m = /^JARVIS_PROGRESS (\d+) (.*)/.exec(line);
        if (m) setState('budowa', Number(m[1]), m[2]);
        else if (line.trim()) {
          log.push(line);
          if (log.length > 40) log.shift();
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', () => resolve(-1));
    proc.on('close', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  const cancelled = state.faza === 'anulowano';
  state.proc = null;
  setState('bezczynny', 0, '');
  if (cancelled) return { ok: false, anulowano: true, error: 'Anulowano.' };
  const manifest = await fsp.readFile(path.join(dir, 'wynik.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (code !== 0 || !manifest) {
    await fsp.writeFile(path.join(dir, 'blad.log'), log.join('\n')).catch(() => {});
    const why = log.filter((l) => /Error|error:/.test(l)).slice(-1)[0];
    return { ok: false, folder: dir, error: `Blender zgłosił błąd${why ? `: ${why.slice(0, 200)}` : ''}. Szczegóły w blad.log.` };
  }
  await fsp.rm(input, { force: true }).catch(() => {});
  const f = manifest.pliki || {};
  return {
    ok: true,
    folder: dir,
    wersja: cached?.wersja,
    silnik: manifest.silnik,
    sf: manifest.sf,
    uwagi: manifest.uwagi,
    czasy: manifest.czasy,
    stl: f.stl ? path.join(dir, f.stl) : null,
    blend: f.blend ? path.join(dir, f.blend) : null,
    wideo_sciezka: f.wideo ? path.join(dir, f.wideo) : null,
    glb: f.glb ? await readB64(path.join(dir, f.glb), 120) : null,
    podglad: f.podglad ? await readB64(path.join(dir, f.podglad), 15) : null,
    rozlozony: f.rozlozony ? await readB64(path.join(dir, f.rozlozony), 15) : null,
    wideo: f.wideo ? await readB64(path.join(dir, f.wideo), 90) : null,
  };
}

function cancel() {
  if (!state.proc) return { ok: false, error: 'Nic nie jest budowane.' };
  setState('anulowano', 0, 'Anuluję');
  state.proc.kill();
  return { ok: true };
}

// Tylko wyniki Studia: strona nie moze tedy otworzyc dowolnego pliku.
const inStudio = (p) => {
  const full = path.resolve(String(p || ''));
  const root = path.resolve(studioRoot()) + path.sep;
  return full.startsWith(root) ? full : null;
};

async function open(params = {}) {
  const target = inStudio(params.sciezka);
  if (!target || !(await exists(target))) return { ok: false, error: 'Nie ma takiego pliku w Studiu.' };
  if (params.w_blenderze && target.endsWith('.blend')) {
    const exe = await find();
    if (!exe) return { ok: false, error: 'Blender nie jest zainstalowany.' };
    spawn(exe, [target], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  const err = await shell.openPath(target);
  return err ? { ok: false, error: err } : { ok: true };
}

module.exports = {
  status,
  install,
  build,
  cancel,
  open,
  progress: async () => ({ ok: true, ...publicState() }),
};
