// #106 Podglad zuzycia filamentu i alert przy niskim stanie.
//
// Model jest celowo prosty: uzytkownik deklaruje ile gramow ma nowa szpula
// (setSpool), a printQueue.js po oznaczeniu pozycji z kolejki jako
// "wydrukowana" dolicza jej massEstimateG do printedTotalG (recordPrinted).
// remainingG to zawsze capacityG - printedTotalG - zadnego osobnego licznika
// "stanu biezacego", ktory moglby sie rozjechac.

import { readData, writeData, round } from './store.js';
import { publish } from '../../server/core/bus.js';

const ALERT_THRESHOLD_PCT = 10;

function view(f) {
  const remainingG = f.capacityG != null ? Math.max(0, round(f.capacityG - (f.printedTotalG || 0), 1)) : null;
  const percentRemaining = f.capacityG ? round((remainingG / f.capacityG) * 100, 1) : null;
  return {
    capacityG: f.capacityG,
    printedTotalG: round(f.printedTotalG || 0, 1),
    remainingG,
    percentRemaining,
    lowFilament: percentRemaining != null && percentRemaining < ALERT_THRESHOLD_PCT,
  };
}

export function getFilamentState() {
  const data = readData();
  return view(data.cadExtra.filament);
}

/** Zaladowanie nowej szpuli - resetuje licznik zuzycia. */
export function setSpool(capacityG) {
  const g = Number(capacityG);
  if (!Number.isFinite(g) || g <= 0) {
    throw new Error('capacityG musi byc liczba dodatnia (gramy filamentu na szpuli).');
  }
  const data = readData();
  data.cadExtra.filament.capacityG = Math.round(g);
  data.cadExtra.filament.printedTotalG = 0;
  data.cadExtra.filament.alerted = false;
  writeData(data);
  return view(data.cadExtra.filament);
}

/**
 * Zaksiegowanie zuzytego filamentu po wydrukowaniu pozycji z kolejki.
 * Publikuje alert przez bus, gdy stan spadnie ponizej progu - tylko RAZ na
 * przejscie ponizej progu (alerted), zeby nie zalewac HUD-u przy kazdym
 * kolejnym wydruku, gdy zapas juz jest niski.
 */
export function recordPrinted(massG) {
  const data = readData();
  const f = data.cadExtra.filament;
  const g = Number(massG);
  if (Number.isFinite(g) && g > 0) {
    f.printedTotalG = round((f.printedTotalG || 0) + g, 1);
  }
  const state = view(f);
  if (state.percentRemaining != null && state.percentRemaining < ALERT_THRESHOLD_PCT) {
    if (!f.alerted) {
      f.alerted = true;
      publish(
        'cad-extra',
        'filament.low',
        `Filament na szpuli ponizej ${ALERT_THRESHOLD_PCT}% - zostalo ok. ${state.remainingG} g z ${f.capacityG} g.`,
        { level: 'warn', data: state, speak: true }
      );
    }
  } else {
    f.alerted = false;
  }
  writeData(data);
  return view(f);
}

export const ALERT_THRESHOLD_PERCENT = ALERT_THRESHOLD_PCT;
