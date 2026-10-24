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

async function patrol(runPowerShell) {
  const out = { startupNew: [], listeningNew: [], defenderThreats: [], defenderSignatureAgeDays: null, baselineCreated: false };

  const startup = json(await runPowerShell(scripts.startupScript()));
  if (startup?.items) {
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
  return out;
}

module.exports = { patrol, parseDefenderDate, diffBaseline, startupKey, listenKey };
