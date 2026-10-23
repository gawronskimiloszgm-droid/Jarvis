// Nadzorca agentow domowych - uruchamia camera-watcher.js i
// system-monitor.js jako procesy potomne i wskrzesza kazdy z nich,
// jesli padnie.
//
// CELOWO ograniczone do WLASNYCH skryptow tego projektu. "Samoleczenie
// infrastruktury" moglo w teorii oznaczac cos w rodzaju "ubijaj podejrzane
// procesy w systemie" - tego tu NIE MA. Nadzorca restartuje wylacznie
// dwa konkretne, z gory znane pliki .js z tego katalogu; nie ma zadnego
// mechanizmu do dodania czegokolwiek innego do nadzoru z zewnatrz.
//
// To JEDYNY proces, ktory trzeba dodac do Zaplanowanych zadan / crona -
// on sam odpala i pilnuje obu agentow, wiec nie trzeba tego robic osobno
// dla kazdego.
//
// Uruchomienie: node home-server/supervisor.js

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Kazdy wpis to OSOBNY proces z wlasnym cyklem restartu - awaria kamery
// nie ma wplywu na monitor maszyny i odwrotnie.
const AGENTS = [
  { name: 'kamery', file: 'camera-watcher.js' },
  { name: 'telemetria', file: 'system-monitor.js' },
];

const MAX_BACKOFF_MS = 60_000;
const RESET_HEALTHY_AFTER_MS = 2 * 60_000; // dzialal >2 min = uznajemy za "zdrowy start", zerujemy odstep

function log(agent, msg) {
  console.log(`[${new Date().toLocaleTimeString('pl-PL', { hour12: false })}] [${agent}] ${msg}`);
}

function startAgent(agent) {
  let backoff = 2000;
  let restarts = 0;

  const spawnOnce = () => {
    const startedAt = Date.now();
    log(agent.name, `start (proba ${restarts + 1})`);

    const child = spawn(process.execPath, [path.join(__dirname, agent.file)], {
      stdio: 'inherit',
      // Zmienne srodowiskowe agenta CZYTA on sam z home-server/.env przy
      // starcie (patrz camera-watcher.js/system-monitor.js) - nadzorca
      // nie musi ich znac ani przekazywac.
      env: process.env,
    });

    child.on('exit', (code, signal) => {
      const alive = Date.now() - startedAt;
      restarts++;

      // Dlugo dzialajacy proces, ktory w koncu padl, to inny przypadek niz
      // cos, co pada natychmiast po starcie (zla konfiguracja, brak
      // ffmpeg) - w drugim przypadku restartowanie co 2s tylko zapetla
      // ten sam blad w kolko, wiec odstep rosnie. Zdrowy dlugi przebieg
      // zeruje go z powrotem.
      if (alive > RESET_HEALTHY_AFTER_MS) backoff = 2000;
      else backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);

      log(
        agent.name,
        `zakonczony (kod ${code}${signal ? `, sygnal ${signal}` : ''}) po ${Math.round(alive / 1000)}s dzialania. ` +
          `Restart za ${Math.round(backoff / 1000)}s.`
      );
      setTimeout(spawnOnce, backoff);
    });

    child.on('error', (err) => {
      log(agent.name, `nie udalo sie uruchomic: ${err.message}`);
    });
  };

  spawnOnce();
}

log('nadzorca', `startuje ${AGENTS.length} agentow: ${AGENTS.map((a) => a.name).join(', ')}`);
AGENTS.forEach(startAgent);

// Ctrl+C ma zabic WSZYSTKO od razu, nie zostawiac agentow-widmo dzialajacych
// w tle po zamknieciu terminala.
process.on('SIGINT', () => {
  log('nadzorca', 'zamykanie...');
  process.exit(0);
});
