// Wspolny harmonogram dla wszystkich cyklicznych sprawdzen modulu podrozy:
// ceny lotow (#121), korki na trasie do pracy (#123), przesylki kurierskie
// (#126) i waznosc dokumentow (#130). Kazda z tych funkcji sama pilnuje
// wlasnego odstepu miedzy sprawdzeniami (patrz MIN_INTERVAL_MS w kazdym
// module) - ten plik tylko odpytuje je w kolko, jak upkeep.js robi to dla
// reszty serwera.
//
// Ten modul NIE startuje sam z siebie (zaden import w tym repo nie ma
// efektow ubocznych przy wczytaniu) - trzeba go jawnie uruchomic wywolaniem
// startTravelSchedulers() raz przy starcie serwera (patrz raport koncowy,
// gdzie dokladnie to podlaczyc w server/index.js, ktorego nie wolno mi tu
// edytowac).

import { sweepFlights } from './flights.js';
import { sweepCommute } from './traffic.js';
import { sweepCourier } from './courier.js';
import { syncReminders as syncDocumentReminders } from './documents.js';

const SWEEP_MS = Number(process.env.TRAVEL_SWEEP_MS || 15 * 60 * 1000); // 15 min

let timer = null;

async function tick() {
  try {
    await sweepFlights();
  } catch (err) {
    console.error('travel: sweepFlights nieudany:', err.message);
  }
  try {
    await sweepCommute();
  } catch (err) {
    console.error('travel: sweepCommute nieudany:', err.message);
  }
  try {
    await sweepCourier();
  } catch (err) {
    console.error('travel: sweepCourier nieudany:', err.message);
  }
  try {
    syncDocumentReminders();
  } catch (err) {
    console.error('travel: syncDocumentReminders nieudany:', err.message);
  }
}

export function startTravelSchedulers() {
  if (timer) return;
  timer = setInterval(tick, SWEEP_MS);
  if (timer.unref) timer.unref(); // nie blokuje zamkniecia procesu
  console.log(`Harmonogram podrozy: co ${Math.round(SWEEP_MS / 60000)} min`);
}

export function stopTravelSchedulers() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
