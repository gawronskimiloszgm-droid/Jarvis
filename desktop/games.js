// Gry na tym komputerze: biblioteki Steam (libraryfolders.vdf + appmanifest_*.acf), gry z Epic
// (manifesty launchera), instalacja gry ze Steama po nazwie, aktualizacje i uruchamianie.
// Tylko odczyt plikow i linki steam:// / com.epicgames.launcher:// - instalacje i aktualizacje
// i tak potwierdza sie w oknie Steama.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

/** Parser formatu VDF/ACF Valve: "klucz" "wartosc" i "klucz" { ... }. */
function parseVdf(text) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m;
  while ((m = re.exec(String(text || '')))) tokens.push(m[2] || { s: m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"') });
  let i = 0;
  const obj = () => {
    const out = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t === '}') return out;
      if (typeof t !== 'object') continue;
      const next = tokens[i];
      if (next === '{') {
        i++;
        out[t.s] = obj();
      } else if (next && typeof next === 'object') {
        out[t.s] = next.s;
        i++;
      }
    }
    return out;
  };
  return obj();
}

const run = (file, args) => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: 8000 }, (err, out) => resolve(err ? '' : String(out))));

async function steamPath() {
  if (process.platform === 'win32') {
    const out = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
    const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
    if (m && fs.existsSync(m[1].trim())) return path.normalize(m[1].trim());
  }
  for (const p of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam']) if (fs.existsSync(p)) return p;
  return '';
}

async function freeGb(dir) {
  try {
    const s = await fsp.statfs(dir);
    return Math.round((s.bavail * s.bsize) / 1e9);
  } catch {
    return null;
  }
}

/** Stan gry z manifestu: flagi Steama (2 = wymaga aktualizacji, 512 = wstrzymana, 1024 = trwa) i numer wersji docelowej. */
function steamState(a) {
  const flags = Number(a.StateFlags) || 0;
  const target = String(a.TargetBuildID || '0');
  const needs = Boolean(flags & 2) || (target !== '0' && target !== String(a.buildid || ''));
  const toDl = Number(a.BytesToDownload) || 0;
  const done = Number(a.BytesDownloaded) || 0;
  let state = 'ok';
  if (flags & 2048) state = 'odinstalowuje';
  else if (needs && flags & 512) state = 'wstrzymana';
  else if (needs && flags & 1024) state = 'pobiera';
  else if (needs) state = 'aktualizacja';
  else if (!(flags & 4)) state = 'niepełna';
  return { state, progressPct: needs && toDl ? Math.round((done / toDl) * 100) : null, toDownloadGb: needs && toDl ? Math.round(((toDl - done) / 1e9) * 10) / 10 : null };
}

async function steamGames() {
  const root = await steamPath();
  if (!root) return { installed: false, libraries: [], games: [] };
  let libs = [path.join(root)];
  try {
    const vdf = parseVdf(await fsp.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const lf = vdf.libraryfolders || vdf.LibraryFolders || {};
    const found = Object.values(lf).map((v) => (typeof v === 'object' ? v.path : v)).filter(Boolean);
    if (found.length) libs = found.map((p) => path.normalize(p));
  } catch {
    /* bez pliku bibliotek: tylko katalog Steama */
  }
  const seen = new Set();
  libs = libs.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k) || !fs.existsSync(path.join(p, 'steamapps'))) return false;
    seen.add(k);
    return true;
  });
  const games = [];
  const libraries = [];
  for (const lib of libs) {
    libraries.push({ path: lib, freeGb: await freeGb(lib) });
    const dir = path.join(lib, 'steamapps');
    for (const f of (await fsp.readdir(dir).catch(() => [])).filter((x) => /^appmanifest_\d+\.acf$/i.test(x))) {
      try {
        const a = parseVdf(await fsp.readFile(path.join(dir, f), 'utf8')).AppState || {};
        if (!a.appid) continue;
        games.push({ appid: String(a.appid), name: String(a.name || a.appid), library: lib, sizeGb: Math.round((Number(a.SizeOnDisk) || 0) / 1e8) / 10, tool: /redistributable|proton|runtime|steamworks/i.test(a.name || ''), ...steamState(a) });
      } catch {
        /* uszkodzony manifest */
      }
    }
  }
  const running = process.platform === 'win32' ? /steam\.exe/i.test(await run('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'])) : false;
  // Rozpoczeta aktualizacja przy wylaczonym Steamie stoi w miejscu.
  if (!running) for (const g of games) if (g.state === 'pobiera') g.state = 'aktualizacja (rozpoczęta, Steam wyłączony)';
  return { installed: true, path: root, running, libraries, games: games.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Gry z Epic: manifesty launchera, tylko te, ktorych folder naprawde istnieje (stare wpisy po usunietych grach zostaja). */
async function epicGames() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  const out = [];
  const seen = new Set();
  for (const f of (await fsp.readdir(dir).catch(() => [])).filter((x) => x.endsWith('.item'))) {
    try {
      const j = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      const loc = path.normalize(String(j.InstallLocation || ''));
      if (!j.DisplayName || !loc || !fs.existsSync(loc)) continue;
      // Windows nie rozroznia wielkosci liter: "Epic Games" i "Epic games" to ten sam folder.
      const key = `${j.AppName}|${fs.realpathSync.native(loc).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: String(j.DisplayName), version: String(j.AppVersionString || ''), location: loc, sizeGb: Math.round((Number(j.InstallSize) || 0) / 1e8) / 10, incomplete: Boolean(j.bIsIncompleteInstall), launch: j.CatalogNamespace && j.CatalogItemId && j.AppName ? `com.epicgames.launcher://apps/${encodeURIComponent(`${j.CatalogNamespace}:${j.CatalogItemId}:${j.AppName}`)}?action=launch&silent=true` : '' });
    } catch {
      /* uszkodzony manifest */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Ta sama gra zainstalowana w kilku folderach: kazda kopia zajmuje pelne miejsce. */
function duplicates(epic) {
  const by = new Map();
  for (const g of epic) by.set(g.name, [...(by.get(g.name) || []), g]);
  return [...by.values()].filter((l) => l.length > 1).map((l) => {
    // Zostaje najnowsza wersja, do usuniecia sa starsze.
    const sorted = [...l].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    const old = sorted.slice(1);
    return { name: l[0].name, copies: l.map((g) => `${g.location} (${g.sizeGb} GB, wersja ${g.version})`), keep: sorted[0].location, remove: old.map((g) => g.location), extraGb: Math.round(old.reduce((a, g) => a + g.sizeGb, 0)) };
  });
}

async function overview() {
  const [steam, epic] = await Promise.all([steamGames(), epicGames()]);
  return { ok: true, steam, epic, duplicates: duplicates(epic) };
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Skroty, ktorymi mowi sie o grach.
const ALIASES = { cs2: 'counter strike 2', cs: 'counter strike 2', csgo: 'counter strike 2', gta: 'grand theft auto v', 'gta 5': 'grand theft auto v', 'gta v': 'grand theft auto v', rdr2: 'red dead redemption 2', pubg: 'pubg battlegrounds' };
const wanted = (q) => ALIASES[fold(q)] || fold(q);

/** Najlepiej pasujaca gra z listy po nazwie: dokladna, zaczyna sie od, zawiera wszystkie slowa. */
function bestMatch(list, q, nameOf = (x) => x.name) {
  const t = wanted(q);
  if (!t) return null;
  let best = null;
  for (const x of list) {
    const n = fold(nameOf(x));
    const score = n === t ? 3 : n.startsWith(t) ? 2 : t.split(' ').every((w) => n.includes(w)) ? 1 : 0;
    if (score && (!best || score > best.score)) best = { x, score };
  }
  return best?.x || null;
}

async function searchStore(q) {
  const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(wanted(q))}&l=polish&cc=PL`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Sklep Steam: błąd ${res.status}`);
  const items = ((await res.json()).items || []).filter((i) => i.type === 'app' || !i.type);
  return items.map((i) => ({ appid: String(i.id), name: String(i.name) }));
}

/** Instalacja gry ze Steama po nazwie: otwiera okno instalacji Steama (tam wybiera sie dysk i potwierdza). */
async function install({ nazwa, appid } = {}, { openExternal } = {}) {
  const st = await steamGames();
  if (!st.installed) return { ok: false, error: 'Na tym komputerze nie ma Steama.' };
  let game = appid ? { appid: String(appid).replace(/\D/g, ''), name: String(nazwa || appid) } : null;
  if (!game) {
    const have = bestMatch(st.games, nazwa);
    if (have) return { ok: true, juz_zainstalowana: true, gra: have.name, stan: have.state };
    // Gra z Epic to tez gra, ktora juz jest: nie proponujemy kupna drugiej kopii na Steamie.
    const epic = bestMatch(await epicGames(), nazwa);
    if (epic) return { ok: true, juz_zainstalowana: true, gra: epic.name, sklep: 'Epic', folder: epic.location };
    game = bestMatch(await searchStore(nazwa), nazwa) || (await searchStore(nazwa))[0];
  }
  if (!game?.appid) return { ok: false, error: `Nie znalazłem gry "${nazwa}" w sklepie Steam.` };
  const installed = st.games.find((g) => g.appid === game.appid);
  if (installed) return { ok: true, juz_zainstalowana: true, gra: installed.name, stan: installed.state };
  const libs = [...st.libraries].filter((l) => l.freeGb != null).sort((a, b) => b.freeGb - a.freeGb);
  await openExternal(`steam://install/${game.appid}`);
  return { ok: true, gra: game.name, appid: game.appid, polecana_biblioteka: libs[0] ? `${libs[0].path} (wolne ${libs[0].freeGb} GB)` : null, biblioteki: libs.map((l) => `${l.path}: ${l.freeGb} GB wolne`), uwaga: 'Steam pokazał okno instalacji: tam wybiera się dysk i zatwierdza.' };
}

/** Gry czekajace na aktualizacje i otwarcie listy pobierania Steama, gdzie sie je uruchamia. */
async function updates({ otworz } = {}, { openExternal } = {}) {
  const { steam, epic, duplicates: dups } = await overview();
  const pending = steam.games.filter((g) => g.state !== 'ok');
  // Link uruchamia Steama, gdy jest wylaczony, i od razu pokazuje kolejke pobierania.
  if (otworz && pending.length) await openExternal('steam://open/downloads');
  return {
    ok: true,
    steam: steam.installed ? pending.map((g) => `${g.name}: ${g.state}${g.toDownloadGb ? `, do pobrania ${g.toDownloadGb} GB` : ''}${g.progressPct != null && g.state !== 'aktualizacja' ? ` (${g.progressPct}%)` : ''}`) : null,
    steam_dziala: steam.running,
    epic: epic.map((g) => `${g.name} ${g.version}${g.incomplete ? ' (niedokończona instalacja)' : ''}`),
    epic_uwaga: 'Aktualizacje Epic sprawdza tylko launcher Epic: pliki na dysku nie mówią, czy jest nowsza wersja.',
    ...(dups.length && { zdublowane: dups.map((d) => `${d.name} zainstalowana ${d.copies.length} razy (${d.copies.join('; ')}); najnowsza w ${d.keep}, starsza do usunięcia w launcherze zwolni ok. ${d.extraGb} GB`) }),
  };
}

/** Uruchomienie zainstalowanej gry po nazwie (Steam albo Epic). */
async function launch({ nazwa } = {}, { openExternal } = {}) {
  const { steam, epic } = await overview();
  const s = bestMatch(steam.games.filter((g) => !g.tool), nazwa);
  if (s) {
    await openExternal(`steam://rungameid/${s.appid}`);
    return { ok: true, gra: s.name, sklep: 'Steam', stan: s.state };
  }
  const e = bestMatch(epic, nazwa);
  if (e?.launch) {
    await openExternal(e.launch);
    return { ok: true, gra: e.name, sklep: 'Epic' };
  }
  return { ok: false, error: `Nie ma zainstalowanej gry "${nazwa}".` };
}

module.exports = { parseVdf, steamState, steamGames, epicGames, duplicates, overview, bestMatch, install, updates, launch, fold };
