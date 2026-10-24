// Patrol bezpieczenstwa E.D.I.T.H. - to, co robi sie przy kazdym skanie ponad
// samym sprawdzeniem "czy Defender jest wlaczony":
//   - nowe wpisy autostartu (klasyczna metoda utrwalania sie malware)
//   - nowe procesy nasluchujace na wszystkich interfejsach sieciowych
//   - nowe wykrycia w historii Windows Defendera + wiek sygnatur
//
// Metoda "linii bazowej": pierwszy skan zapisuje stan jako normalny i NIC nie
// zglasza (inaczej kazdy dostalby 24 alarmy o programach, ktore sam
// zainstalowal); kolejne zglaszaja tylko ROZNICE. To heurystyka zmian, nie
// baza sygnatur - prawdziwa ochrona to Defender, tu go tylko wypytujemy.

const fs = require('fs');
const scripts = require('./pcscripts');
const settings = require('./settings');

const startupKey = (i) => `${i.where}|${i.name}|${String(i.command || '').toLowerCase()}`;
const listenKey = (l) => `${String(l.process || '?').toLowerCase()}:${l.port}`;

// Defender zwraca daty jako "MM/DD/YYYY HH:MM:SS" (kultura niezmienna).
function parseDefenderDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

// Zwraca roznice wzgledem zapisanej linii bazowej i aktualizuje baze.
function diffBaseline(settingKey, currentKeys) {
  const prev = settings.get(settingKey);
  settings.set(settingKey, currentKeys);
  if (!Array.isArray(prev)) return { first: true, added: [] };
  const known = new Set(prev);
  return { first: false, added: currentKeys.filter((k) => !known.has(k)) };
}

function json(res) {
  try {
    return JSON.parse(res.output);
  } catch {
    return null;
  }
}

// Reguly "postawy" - sprawdzane przy KAZDYM skanie, bo linia bazowa nie
// zlapie czegos, co jest na komputerze od dawna (koparka w autostarcie, wlaczony
// pulpit zdalny, brak pelnego skanu).
const MINER_RE = /miner|xmrig|cryptonight|nicehash|coinhive|monero|ethminer/i;
const RISKY_DIR_RE = /\\(temp|downloads|users\\public)\\/i;
const RDP_SCRIPT = "@{ rdp = ((Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections -eq 0); listening = [bool](Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue) } | ConvertTo-Json -Compress";

// Sciezka pliku .exe z polecenia autostartu (w cudzyslowie albo bez).
function exeOf(cmd) {
  const s = String(cmd || '');
  const m = /^\s*"([^"]+\.exe)"/i.exec(s) || /^\s*([A-Za-z]:\\[^"]*?\.exe)(\s|$)/i.exec(s);
  return m ? m[1] : null;
}

function riskFindings(items, def, rdp) {
  const out = [];
  const orphans = [];
  for (const i of items || []) {
    const exe = exeOf(i.command);
    const missing = exe && !fs.existsSync(exe);
    const label = i.name + (missing ? ' (pliku juz nie ma)' : '');
    if (MINER_RE.test(i.name) || MINER_RE.test(String(i.command))) {
      out.push(missing
        ? { key: 'miner:' + i.name, level: 'info', text: 'Wpis w autostarcie wskazuje na program do kopania kryptowalut (' + i.name + '), ale pliku juz nie ma, wiec nic nie kopie. Warto usunac sam wpis.' }
        : { key: 'miner:' + i.name, level: 'warn', text: 'Autostart uruchamia program do kopania kryptowalut: ' + i.name + '. Jesli to nie Twoje - usun wpis i program (zasoby komputera i pradu ida na cudzy portfel).' });
    } else if (RISKY_DIR_RE.test(String(i.command)) && !missing) {
      out.push({ key: 'dir:' + i.name, level: 'warn', text: 'Autostart uruchamia program z folderu tymczasowego/pobranych: ' + i.name + ' - ' + String(i.command).slice(0, 120) + '. Zwykle tak nie instaluje sie uczciwe programy.' });
    } else if (missing && i.where && !/zaplanowane/i.test(i.where)) {
      orphans.push(i.name);
    }
  }
  if (orphans.length) out.push({ key: 'orphans', level: 'info', text: 'Wpisy autostartu bez pliku (pozostalosci po odinstalowanych programach): ' + orphans.slice(0, 8).join(', ') + '.' });
  if (rdp && rdp.rdp && rdp.listening) {
    out.push({ key: 'rdp', level: 'warn', text: 'Pulpit zdalny (RDP) jest wlaczony i nasluchuje na porcie 3389. Jesli go nie uzywasz, wylacz: Ustawienia > System > Pulpit zdalny.' });
  }
  const full = def && def.status ? parseDefenderDate(def.status.lastFullScan) : 0;
  const days = full ? Math.floor((Date.now() - full) / 86400000) : null;
  if (def && def.status && (days === null || days > 45)) {
    out.push({ key: 'fullscan', level: 'info', text: days === null ? 'Pelny skan Defendera nigdy nie zostal uruchomiony.' : 'Ostatni pelny skan Defendera byl ' + days + ' dni temu.' });
  }
  return out;
}

async function patrol(runPowerShell) {
  const out = { startupNew: [], listeningNew: [], defenderThreats: [], defenderSignatureAgeDays: null, baselineCreated: false, riskFindings: [] };
  let startupItems = [];

  const startup = json(await runPowerShell(scripts.startupScript()));
  if (startup?.items) {
    startupItems = startup.items;
    const keys = startup.items.map(startupKey);
    const d = diffBaseline('startupBaseline', keys);
    out.baselineCreated = out.baselineCreated || d.first;
    const byKey = new Map(startup.items.map((i) => [startupKey(i), i]));
    out.startupNew = d.added.map((k) => byKey.get(k)).filter(Boolean).map((i) => ({ where: i.where, name: i.name, command: String(i.command).slice(0, 200) }));
  }

  const net = json(await runPowerShell(scripts.networkScript()));
  if (net?.listening) {
    const keys = [...new Set(net.listening.map(listenKey))];
    const d = diffBaseline('listenBaseline', keys);
    out.baselineCreated = out.baselineCreated || d.first;
    out.listeningNew = d.added.map((k) => {
      const [process, port] = k.split(':');
      return { process, port: Number(port) };
    });
  }

  const def = json(await runPowerShell(scripts.defenderScript()));
  if (def?.status && typeof def.status.signatureAge === 'number') out.defenderSignatureAgeDays = def.status.signatureAge;
  if (Array.isArray(def?.threats)) {
    const seen = Number(settings.get('defenderSeen')) || 0;
    let max = seen;
    for (const t of def.threats) {
      const at = parseDefenderDate(t.at);
      if (at > max) max = at;
      // Pierwszy skan: stare wykrycia z historii to nie "nowe zagrozenie".
      if (seen && at > seen) out.defenderThreats.push({ threat: t.threat, at: t.at, remediated: t.remediated, resources: (t.resources || []).slice(0, 2) });
    }
    if (!seen) out.baselineCreated = true;
    settings.set('defenderSeen', max || Date.now());
  }
  let rdp = null;
  try {
    rdp = json(await runPowerShell(RDP_SCRIPT));
  } catch {
    /* RDP to dodatek */
  }
  out.riskFindings = riskFindings(startupItems, def, rdp);
  return out;
}

module.exports = { patrol, parseDefenderDate, diffBaseline, startupKey, listenKey, riskFindings, exeOf };
