// #105 Powiadomienie o zakonczeniu/bledzie druku.
//
// OctoPrint nie gwarantuje webhookow "out of the box" (to zalezy od
// wtyczek), wiec odpytujemy /api/job (server/printer.js: jobStatus()) w
// petli i sami wykrywamy zmiane stanu. OctoPrint nie ma jednego pola
// "done" - koniec druku widac po tym, ze stan wraca z "Printing" do
// "Operational" (z postepem 100%), a blad po tym, ze stan zawiera "Error".
//
// Polling startuje SAM przy zaladowaniu tego modulu (patrz na koncu pliku)
// - dzieki temu samo zamontowanie routera z index.js tego katalogu
// wystarcza, zeby powiadomienia zaczely dzialac, bez koniecznosci edycji
// server/upkeep.js. Kto wolałby scentralizowac wszystkie cykliczne zadania
// w upkeep.js, moze zamiast tego wywolywac stad pollPrintStatus() recznie
// (patrz raport koncowy).

import { jobStatus, isConfigured } from '../../server/printer.js';
import { publish } from '../../server/bus.js';

const DEFAULT_INTERVAL_MS = Number(process.env.CAD_EXTRA_PRINT_POLL_MS || 60 * 1000);

let lastState = null;
let lastStatus = null;
let timer = null;

/** Pojedyncze sprawdzenie stanu drukarki - bezpieczne w wywolaniu recznym i z timera. */
export async function pollPrintStatus() {
  if (!isConfigured()) return null;
  let status;
  try {
    status = await jobStatus();
  } catch {
    return null; // chwilowy brak sieci/drukarki - nastepny cykl sprobuje ponownie
  }
  if (!status) return null;

  const state = String(status.state || '').toLowerCase();
  const wasPrinting = lastState != null && /printing/i.test(lastState);

  if (/error|offline.*error/i.test(state)) {
    publish('cad-extra', 'print.error', `Drukarka zglosila blad (${status.fileName || 'zadanie'}): stan "${status.state}".`, {
      level: 'alert',
      speak: true,
      data: status,
    });
  } else if (wasPrinting && /operational|finish/i.test(state)) {
    publish('cad-extra', 'print.done', `Druk zakonczony: ${status.fileName || 'zadanie'}.`, {
      level: 'ok',
      speak: true,
      data: status,
    });
  }

  lastState = state;
  lastStatus = status;
  return status;
}

export function lastKnownStatus() {
  return lastStatus;
}

export function startPolling(intervalMs = DEFAULT_INTERVAL_MS) {
  if (timer) return;
  if (!isConfigured()) return; // brak PRINTER_URL/PRINTER_API_KEY - nie ma czego odpytywac
  timer = setInterval(() => {
    pollPrintStatus().catch(() => {});
  }, intervalMs);
  if (timer.unref) timer.unref(); // nie blokuje zamkniecia procesu
}

export function stopPolling() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Auto-start - patrz komentarz na gorze pliku.
startPolling();
