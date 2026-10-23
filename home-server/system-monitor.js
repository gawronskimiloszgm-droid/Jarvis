// Monitor maszyny domowej - dziala NA LAPTOPIE, obok agenta kamer.
// Wysyla odczyty do chmury, ktora ocenia je i melduje na magistrale.
//
// CPU liczymy z ROZNICY licznikow os.cpus() miedzy dwoma odczytami.
// Pojedynczy odczyt podaje sumy od startu systemu, wiec sam w sobie nic
// nie mowi o biezacym obciazeniu. Sprawdzone na tej maszynie: liczniki
// Windows (Win32_Processor.LoadPercentage, Get-Counter) zwracaly 0%
// zamiast prawdziwej wartosci, a ta metoda dala poprawne 7.2%.
// Dodatkowo nie wymaga PowerShella, wiec dziala tez na Linuksie/Macu.
//
// Uruchomienie: node home-server/system-monitor.js
// Konfiguracja: home-server/.env (ten sam plik co agent kamer)

import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

// Konfiguracje wczytujemy z KATALOGU AGENTA, nie z katalogu uruchomienia.
// Zwykle 'dotenv/config' bierze .env z cwd - a agenta uruchamia sie z
// glownego katalogu repozytorium, wiec czytal .env serwera zamiast wlasnego
// i cicho ignorowal cala konfiguracje z home-server/.env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const execAsync = promisify(exec);

const JARVIS_URL = (process.env.JARVIS_URL || 'http://localhost:3000').replace(/\/+$/, '');
const OWNER_USER = process.env.OWNER_USER || '';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const MACHINE_NAME = process.env.MACHINE_NAME || os.hostname() || 'laptop';
const INTERVAL_MS = Number(process.env.TELEMETRY_INTERVAL_MS || 20000);

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('pl-PL', { hour12: false })}] ${msg}`);
}

if (!OWNER_PASSWORD) {
  console.error('Brak OWNER_PASSWORD w home-server/.env - agent musi sie zalogowac tak samo jak przegladarka.');
  process.exit(1);
}

// ---------- Sesja z chmura ----------

let token = null;

async function login() {
  const res = await fetch(`${JARVIS_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: OWNER_USER, password: OWNER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`logowanie nieudane: HTTP ${res.status}`);
  token = (await res.json()).token;
  log('zalogowano do chmury');
}

async function postTelemetry(body) {
  if (!token) await login();
  const attempt = () =>
    fetch(`${JARVIS_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  let res = await attempt();
  if (res.status === 401) {
    await login();
    res = await attempt();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Pomiary ----------

function cpuSample() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

let previous = cpuSample();

function cpuPercent() {
  const current = cpuSample();
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  previous = current;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

// Lista najciezszych procesow - sortowana po PAMIECI, bo to ona zwykle
// wskazuje winowajce wycieku, a chwilowy skok CPU zdarza sie kazdemu.
async function topProcesses() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 5 Name,Id,WorkingSet64 | ConvertTo-Json -Compress"',
        { timeout: 8000, windowsHide: true }
      );
      const parsed = JSON.parse(stdout.trim());
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.map((p) => ({ name: p.Name, pid: p.Id, memMb: Math.round(p.WorkingSet64 / 1024 / 1024), cpu: null }));
    }
    const { stdout } = await execAsync('ps -eo comm,pid,rss --sort=-rss | head -6', { timeout: 8000 });
    return stdout
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const [name, pid, rss] = line.trim().split(/\s+/);
        return { name, pid: Number(pid), memMb: Math.round(Number(rss) / 1024), cpu: null };
      });
  } catch {
    // Brak listy procesow nie jest powodem, zeby przestac raportowac
    // obciazenie - lepszy odczyt bez szczegolow niz zaden.
    return [];
  }
}

async function diskUsedPercent() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "$d=Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID=\'C:\'\\"; [math]::Round((($d.Size-$d.FreeSpace)/$d.Size)*100,1)"',
        { timeout: 8000, windowsHide: true }
      );
      const n = parseFloat(stdout.trim());
      return Number.isFinite(n) ? n : null;
    }
    const { stdout } = await execAsync("df -P / | tail -1 | awk '{print $5}'", { timeout: 8000 });
    const n = parseFloat(stdout.replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ---------- Petla ----------

async function tick() {
  try {
    const [top, diskUsedPct] = await Promise.all([topProcesses(), diskUsedPercent()]);
    const reading = {
      machine: MACHINE_NAME,
      cpu: cpuPercent(),
      ramUsedPct: (1 - os.freemem() / os.totalmem()) * 100,
      ramTotalMb: Math.round(os.totalmem() / 1024 / 1024),
      diskUsedPct,
      uptimeSec: Math.round(os.uptime()),
      top,
    };
    await postTelemetry(reading);
    log(`CPU ${reading.cpu.toFixed(0)}% | RAM ${reading.ramUsedPct.toFixed(0)}% | dysk ${diskUsedPct ?? '?'}%`);
  } catch (err) {
    log(`blad wysylki telemetrii: ${err.message}`);
  }
}

async function main() {
  await login();
  log(`monitor maszyny "${MACHINE_NAME}" wystartowal, odczyt co ${Math.round(INTERVAL_MS / 1000)}s`);
  // Pierwszy pomiar CPU potrzebuje odstepu od punktu odniesienia z importu.
  setTimeout(tick, 1000);
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  console.error('Monitor nie wystartowal:', err.message);
  process.exit(1);
});
