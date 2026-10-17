// Tryb "wakacje" - symulacja obecnosci pod nieobecnosc domownikow.
//
// Ten modul TYLKO generuje plan i oglasza go na magistrali - nie steruje
// zadnym urzadzeniem. Wykonanie (faktyczne wlaczenie swiatla o wyznaczonej
// godzinie) nalezy do modulu IoT z innego batcha; kontrakt miedzy nimi to
// zdarzenie bus 'security'/'vacation.plan' z polem data.plan - patrz raport
// koncowy po dokladny ksztalt.
//
// Godziny sa CELOWO losowane z jitterem (nie sztywna siatka co 19:00/23:00) -
// prawdziwy domownik nie wlacza swiatla co wieczor o tej samej sekundzie;
// idealnie rowna siatka to wlasnie sygnal dla kogos obserwujacego dom, ze
// to automat, nie obecnosc.

import * as memory from '../../server/memory/memory.js';
import * as bus from '../../server/core/bus.js';

const DEVICES = ['swiatlo_salon', 'swiatlo_sypialnia', 'swiatlo_korytarz', 'radio'];

function load() {
  const data = memory.load();
  if (!data.vacationMode) {
    data.vacationMode = { active: false, startedAt: null, days: 0, plan: [] };
  }
  return data;
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function fmt(minutesFromMidnight) {
  const h = Math.floor(minutesFromMidnight / 60) % 24;
  const m = minutesFromMidnight % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Plan jednego dnia: 2-4 zdarzenia, losowane w rozsadnych oknach czasowych
// (wieczorne swiatlo, pozniejsze dogaszenie), zeby uklad tygodnia nie byl
// identyczny dzien w dzien.
function planDay(dayIndex) {
  const events = [];
  const mainLight = DEVICES[randomInt(0, 1)]; // salon albo sypialnia jako "glowne" swiatlo wieczorne
  const onAt = randomInt(17 * 60 + 30, 20 * 60); // 17:30 - 20:00
  const offAt = randomInt(22 * 60, 23 * 60 + 45); // 22:00 - 23:45
  events.push({ at: fmt(onAt), device: mainLight, action: 'wlacz' });
  events.push({ at: fmt(offAt), device: mainLight, action: 'wylacz' });

  // 50% szans na dodatkowe, krotsze swiatlo (korytarz przy "powrocie").
  if (Math.random() < 0.5) {
    const shortOn = randomInt(onAt + 30, offAt - 30);
    const shortOff = Math.min(shortOn + randomInt(10, 40), offAt - 5);
    events.push({ at: fmt(shortOn), device: 'swiatlo_korytarz', action: 'wlacz' });
    events.push({ at: fmt(shortOff), device: 'swiatlo_korytarz', action: 'wylacz' });
  }

  return { day: dayIndex, events: events.sort((a, b) => a.at.localeCompare(b.at)) };
}

/**
 * Uruchomienie trybu na kolejne `days` dni. Zwraca plan i publikuje go na
 * magistrali dla modulu IoT.
 */
export function start(days = 7) {
  const n = Math.max(1, Math.min(30, Number(days) || 7));
  const plan = Array.from({ length: n }, (_, i) => planDay(i));

  const data = load();
  data.vacationMode = { active: true, startedAt: Date.now(), days: n, plan };
  memory.save(data);

  bus.publish('security', 'vacation.plan', `tryb wakacje: wygenerowano plan na ${n} dni`, {
    level: 'info',
    data: { active: true, days: n, plan },
  });
  return data.vacationMode;
}

export function stop() {
  const data = load();
  data.vacationMode = { active: false, startedAt: null, days: 0, plan: [] };
  memory.save(data);
  bus.publish('security', 'vacation.plan', 'tryb wakacje: wylaczony', {
    level: 'info',
    data: { active: false },
  });
  return data.vacationMode;
}

export function status() {
  return load().vacationMode;
}
