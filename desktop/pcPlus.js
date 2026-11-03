// Porzadki i okna: najwieksze pliki w Pobranych (tylko odczyt), miejsce na dyskach, przypinanie okna
// na wierzch. Nic tu niczego nie usuwa: to lista do decyzji uzytkownika.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const downloadsDir = () => path.join(os.homedir(), 'Downloads');

/** Najwieksze pliki (z podfolderami do glebokosci 2) i to, co lezy dluzej niz 90 dni. */
async function bigFiles({ dir = downloadsDir(), limit = 15, depth = 2, now = Date.now() } = {}) {
  const files = [];
  async function walk(d, level) {
    let entries = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (level < depth) await walk(full, level + 1);
      } else if (e.isFile()) {
        try {
          // Synchronicznie: fs.promises.stat w Node 18 przy niektorych nazwach zglasza dodatkowo niezlapany blad.
          const st = fs.statSync(full);
          files.push({ name: path.relative(dir, full), size: st.size, mtime: st.mtimeMs });
        } catch {
          /* plik zniknal w trakcie */
        }
      }
      if (files.length > 20000) return;
    }
  }
  await walk(dir, 0);
  const old = files.filter((f) => now - f.mtime > 90 * 86400000);
  const sum = (list) => list.reduce((s, f) => s + f.size, 0);
  return {
    dir,
    count: files.length,
    totalBytes: sum(files),
    oldCount: old.length,
    oldBytes: sum(old),
    biggest: files.sort((a, b) => b.size - a.size).slice(0, limit).map((f) => ({ name: f.name, mb: Math.round((f.size / 1048576) * 10) / 10, days: Math.floor((now - f.mtime) / 86400000) })),
  };
}

/** Wolne miejsce na dyskach od C do Z. */
async function disks() {
  const out = [];
  if (process.platform !== 'win32' || typeof fsp.statfs !== 'function') {
    try {
      const s = await fsp.statfs(os.homedir());
      out.push({ drive: '/', totalGb: Math.round((s.blocks * s.bsize) / 1e9), freeGb: Math.round((s.bavail * s.bsize) / 1e9) });
    } catch {
      /* brak danych */
    }
    return out;
  }
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    if (!fs.existsSync(root)) continue;
    try {
      const s = await fsp.statfs(root);
      const total = s.blocks * s.bsize;
      if (!total) continue;
      const free = s.bavail * s.bsize;
      out.push({ drive: `${letter}:`, totalGb: Math.round(total / 1e9), freeGb: Math.round(free / 1e9), usedPct: Math.round((1 - free / total) * 100) });
    } catch {
      /* naped bez nosnika */
    }
  }
  return out;
}

const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
/** Okno na wierzchu albo z powrotem normalne; okno szukane po fragmencie tytulu. */
function pinScript(title, on) {
  return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -Namespace J -Name P -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);'
$want = ${q(title)}.ToLower()
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.ToLower().Contains($want) } | Select-Object -First 1
if (-not $p) { [pscustomobject]@{ ok = $false; error = 'Nie znalazlem okna o takim tytule.' } | ConvertTo-Json -Compress; exit }
$after = [System.IntPtr]::new(${on ? -1 : -2})
[void][J.P]::SetWindowPos($p.MainWindowHandle, $after, 0, 0, 0, 0, 0x0013)
[pscustomobject]@{ ok = $true; title = $p.MainWindowTitle; onTop = ${on ? '$true' : '$false'} } | ConvertTo-Json -Compress`;
}

module.exports = { bigFiles, disks, pinScript, downloadsDir };
