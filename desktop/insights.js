// Telemetria tego komputera (CPU/RAM/dysk/top procesow) i licznik czasu pracy.
//
// Czas pracy: co SAMPLE_S sekund sprawdzamy, ktory program jest na pierwszym
// planie i czy uzytkownik cos robil w ostatnich IDLE_S sekundach (mysz,
// klawiatura). Zapisujemy WYLACZNIE nazwe procesu (np. "chrome", "Code") i
// liczbe sekund na dzien - nigdy tytulow okien ani tresci. Dane leza tylko w
// userData tego komputera; na serwer trafia dopiero zagregowane podsumowanie,
// gdy panel "Czas pracy" lub odprawa o nie poprosi. Wylaczane ustawieniem
// `worktime` (akcja czas-pracy-ustaw).

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('./settings');

const SAMPLE_S = 20;
const IDLE_S = 180;
const KEEP_DAYS = 60;

const FOREGROUND_SCRIPT = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
}
"@
$lii = New-Object FG+LII
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[void][FG]::GetLastInputInfo([ref]$lii)
$d = [int64][Environment]::TickCount - [int64]$lii.dwTime
if ($d -lt 0) { $d += 4294967296 }
[uint32]$procId = 0
[void][FG]::GetWindowThreadProcessId([FG]::GetForegroundWindow(), [ref]$procId)
$name = ''
try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
@{ proc = $name; idleSec = [int]($d / 1000) } | ConvertTo-Json -Compress`;

const TOP_SCRIPT = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$top = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object { @{ name = $_.ProcessName; pid = $_.Id; cpu = 0; memMb = [math]::Round($_.WorkingSet64 / 1MB) } }
@{ top = @($top) } | ConvertTo-Json -Compress -Depth 4`;

const BATTERY_SCRIPT = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($b) { @{ has = $true; percent = [int]$b.EstimatedChargeRemaining; charging = ($b.BatteryStatus -eq 2 -or $b.BatteryStatus -ge 6) } | ConvertTo-Json -Compress } else { '{"has":false}' }`;

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let data = null;
let dirty = false;

function file() {
  return path.join(app.getPath('userData'), 'worktime.json');
}

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    data = {};
  }
  return data;
}

function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    const keys = Object.keys(load()).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete data[k];
    fs.writeFileSync(file(), JSON.stringify(data));
  } catch (e) {
    console.warn('Nie udalo sie zapisac czasu pracy:', e.message);
  }
}

// Prosty pomiar CPU: roznica czasow bezczynnosci miedzy dwoma odczytami.
let lastCpu = null;
function cpuPercent() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  const prev = lastCpu;
  lastCpu = { idle, total };
  if (!prev || total === prev.total) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - (idle - prev.idle) / (total - prev.total)))));
}

function diskUsedPct() {
  try {
    const root = path.parse(process.cwd()).root || 'C:\\';
    const s = fs.statfsSync(root);
    return Math.round(100 * (1 - s.bavail / s.blocks));
  } catch {
    return null;
  }
}

function summarize(days) {
  const all = load();
  const keys = Object.keys(all).sort().slice(-days);
  const apps = {};
  const perDay = {};
  for (const k of keys) {
    let t = 0;
    for (const [proc, sec] of Object.entries(all[k])) {
      apps[proc] = (apps[proc] || 0) + sec;
      t += sec;
    }
    perDay[k] = t;
  }
  const top = Object.entries(apps)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, sec]) => ({ name, sec }));
  const byDay = Object.fromEntries(keys.map((k) => [k, all[k]]));
  return { days: keys.length, perDay, byDay, top, totalSec: Object.values(perDay).reduce((a, b) => a + b, 0) };
}

function make({ runPowerShell }) {
  let timer = null;
  let busy = false;

  async function sample() {
    if (busy || !settings.get('worktime')) return;
    busy = true;
    try {
      const res = await runPowerShell(FOREGROUND_SCRIPT);
      const out = JSON.parse(res.output);
      if (out.proc && out.idleSec < IDLE_S) {
        const today = (load()[dayKey()] ||= {});
        today[out.proc] = (today[out.proc] || 0) + SAMPLE_S;
        dirty = true;
        if (Math.random() < 0.2) flush();
      }
    } catch {
      /* pojedyncza nieudana probka niczego nie psuje */
    } finally {
      busy = false;
    }
  }

  // Start z opoznieniem - nie spowalniamy uruchamiania aplikacji.
  setTimeout(() => {
    timer = setInterval(sample, SAMPLE_S * 1000);
    timer.unref?.();
  }, 15000).unref?.();
  app.on('before-quit', flush);

  return {
    telemetria: async (p) => {
      const total = os.totalmem();
      const free = os.freemem();
      const entry = {
        ok: true,
        machine: os.hostname(),
        cpu: cpuPercent(),
        ramUsedPct: Math.round(100 * (1 - free / total)),
        ramTotalMb: Math.round(total / 1048576),
        diskUsedPct: diskUsedPct(),
        uptimeSec: Math.round(os.uptime()),
        top: [],
      };
      if (p && p.top) {
        try {
          entry.top = JSON.parse((await runPowerShell(TOP_SCRIPT)).output).top || [];
        } catch {
          /* lista procesow jest dodatkiem */
        }
      }
      return entry;
    },
    bateria: async () => {
      try {
        return { ok: true, ...JSON.parse((await runPowerShell(BATTERY_SCRIPT)).output) };
      } catch {
        return { ok: false, error: 'Nie udalo sie odczytac baterii.' };
      }
    },
    'proces-dziala': async (p) => {
      const name = String((p && (p.nazwa || p.name)) || '').replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/\.exe$/i, '');
      if (!name) return { ok: false, error: 'Podaj nazwe procesu.' };
      try {
        const out = JSON.parse((await runPowerShell(`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
@{ n = @(Get-Process -Name '${name}' -ErrorAction SilentlyContinue).Count } | ConvertTo-Json -Compress`)).output);
        return { ok: true, dziala: out.n > 0, ile: out.n };
      } catch {
        return { ok: false, error: 'Nie udalo sie sprawdzic procesu.' };
      }
    },
    'czas-pracy': async (p) => {
      flush();
      const days = Math.max(1, Math.min(KEEP_DAYS, Number(p && p.dni) || 7));
      return { ok: true, wlaczony: Boolean(settings.get('worktime')), dzis: summarize(1), ...summarize(days) };
    },
    'czas-pracy-ustaw': async (p) => {
      settings.set('worktime', Boolean(p && (p.wlaczony ?? p.on)));
      if (p && p.wyczysc) {
        data = {};
        dirty = true;
        flush();
      }
      return { ok: true, wlaczony: Boolean(settings.get('worktime')) };
    },
  };
}

module.exports = { make, dayKey, FOREGROUND_SCRIPT };
