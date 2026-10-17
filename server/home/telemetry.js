// Telemetria maszyny domowej (laptop) + wykrywanie procesow, ktore sie
// rozbiegly.
//
// Dane przychodza od agenta z home-server/system-monitor.js - serwer w
// chmurze nie ma jak zmierzyc obciazenia laptopa stojacego w domu.
//
// SAMOLECZENIE jest tu CELOWO ograniczone do wykrywania i meldowania.
// Automatyczne ubijanie procesow bez pytania to najprostsza droga do
// tego, zeby falszywy alarm zabil uzytkownikowi cos, nad czym pracowal
// przez godzine. Decyzje o ubiciu podejmuje czlowiek - przez zdarzenie
// na magistrali dostaje konkretna nazwe i PID, wiec kosztuje go to
// jedno klikniecie, a nie utrate pracy.

import * as bus from '../core/bus.js';

// Ostatni odczyt z kazdej maszyny - HUD czyta to bezposrednio.
const machines = new Map();

// Progi, powyzej ktorych melduje sie ostrzezenie. Swiadomie wysokie:
// laptop pod obciazeniem to normalny stan pracy, nie awaria. Alarmujemy
// dopiero gdy stan UTRZYMUJE sie (patrz sustained ponizej).
const CPU_WARN = Number(process.env.TELEMETRY_CPU_WARN || 90);
const RAM_WARN = Number(process.env.TELEMETRY_RAM_WARN || 92);
const DISK_WARN = Number(process.env.TELEMETRY_DISK_WARN || 95);

// Ile kolejnych odczytow musi przekroczyc prog, zanim uznamy to za
// problem. Chwilowy skok przy kompilacji czy starcie gry nie jest awaria.
const SUSTAINED_TICKS = Number(process.env.TELEMETRY_SUSTAINED || 3);

const streaks = new Map();

function bumpStreak(key, over) {
  const n = over ? (streaks.get(key) || 0) + 1 : 0;
  streaks.set(key, n);
  return n;
}

// Ostrzezenie wysylamy RAZ na epizod, nie przy kazdym odczycie - inaczej
// dziennik zalalby sie tym samym komunikatem co kilkanascie sekund.
const announced = new Set();

function announceOnce(key, fn) {
  if (announced.has(key)) return;
  announced.add(key);
  fn();
}

function clearAnnouncement(key) {
  announced.delete(key);
}

/**
 * Przyjecie odczytu od agenta.
 * @param {object} reading
 * @param {string} reading.machine nazwa maszyny
 * @param {number} reading.cpu procent uzycia CPU (0-100)
 * @param {number} reading.ramUsedPct procent zajetej pamieci
 * @param {number} reading.ramTotalMb calkowita pamiec
 * @param {number} [reading.diskUsedPct]
 * @param {number} [reading.uptimeSec]
 * @param {Array<{name:string, pid:number, cpu:number, memMb:number}>} [reading.top]
 */
export function ingest(reading) {
  const machine = String(reading.machine || 'laptop').slice(0, 40);
  const entry = {
    machine,
    at: Date.now(),
    cpu: clampPct(reading.cpu),
    ramUsedPct: clampPct(reading.ramUsedPct),
    ramTotalMb: Number(reading.ramTotalMb) || null,
    diskUsedPct: reading.diskUsedPct == null ? null : clampPct(reading.diskUsedPct),
    uptimeSec: Number(reading.uptimeSec) || null,
    top: Array.isArray(reading.top) ? reading.top.slice(0, 5) : [],
  };
  machines.set(machine, entry);

  checkThreshold(`${machine}:cpu`, entry.cpu > CPU_WARN, () => {
    const worst = entry.top[0];
    bus.publish(
      'telemetry',
      'cpu.sustained',
      `${machine}: procesor obciazony ${entry.cpu}% od dluzszej chwili${worst ? ` - najwiecej bierze ${worst.name} (PID ${worst.pid})` : ''}`,
      { level: 'warn', data: { machine, cpu: entry.cpu, top: entry.top } }
    );
  }, () => {
    bus.publish('telemetry', 'cpu.normal', `${machine}: obciazenie procesora wrocilo do normy`, {
      level: 'ok',
      data: { machine, cpu: entry.cpu },
    });
  });

  checkThreshold(`${machine}:ram`, entry.ramUsedPct > RAM_WARN, () => {
    const worst = [...entry.top].sort((a, b) => (b.memMb || 0) - (a.memMb || 0))[0];
    bus.publish(
      'telemetry',
      'ram.sustained',
      `${machine}: pamiec zajeta w ${entry.ramUsedPct}%${worst ? ` - najwiecej trzyma ${worst.name} (${Math.round(worst.memMb)} MB, PID ${worst.pid})` : ''}`,
      { level: 'warn', speak: true, data: { machine, ramUsedPct: entry.ramUsedPct, top: entry.top } }
    );
  }, () => {
    bus.publish('telemetry', 'ram.normal', `${machine}: pamiec wrocila do normy`, {
      level: 'ok',
      data: { machine },
    });
  });

  if (entry.diskUsedPct != null) {
    checkThreshold(`${machine}:disk`, entry.diskUsedPct > DISK_WARN, () => {
      bus.publish('telemetry', 'disk.low', `${machine}: dysk zapelniony w ${entry.diskUsedPct}%`, {
        level: 'warn',
        speak: true,
        data: { machine, diskUsedPct: entry.diskUsedPct },
      });
    }, () => {
      bus.publish('telemetry', 'disk.normal', `${machine}: miejsce na dysku odzyskane`, {
        level: 'ok',
        data: { machine },
      });
    });
  }

  return entry;
}

// Prog musi byc przekroczony SUSTAINED_TICKS razy z rzedu, zeby cokolwiek
// oglosic - i wraca do normy natychmiast, bo "juz jest dobrze" nie musi
// czekac na potwierdzenie.
function checkThreshold(key, isOver, onTrip, onRecover) {
  const streak = bumpStreak(key, isOver);
  if (isOver && streak >= SUSTAINED_TICKS) {
    announceOnce(key, onTrip);
  } else if (!isOver && announced.has(key)) {
    clearAnnouncement(key);
    onRecover();
  }
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Ostatnie odczyty ze wszystkich maszyn - dla panelu w interfejsie. */
export function snapshot(staleAfterMs = 90 * 1000) {
  const now = Date.now();
  return [...machines.values()].map((m) => ({
    ...m,
    online: now - m.at < staleAfterMs,
    ageSec: Math.round((now - m.at) / 1000),
  }));
}
