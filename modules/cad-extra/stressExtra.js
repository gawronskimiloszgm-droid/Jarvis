// #107 Rozszerzona analiza wytrzymalosci - obciazenie cykliczne/zmeczeniowe.
//
// WRAPPER, nie zmiana oryginalu: modules/cad/stress.js evaluate() liczy
// tylko obciazenie statyczne (jednorazowe M=F*L). Zmeczenie materialu przy
// wielu cyklach obciazenia to osobne zjawisko (pekanie przy naprezeniach
// ponizej granicy statycznej po wielu powtorzeniach) - tu NIE liczymy
// prawdziwej krzywej S-N (do tego trzeba by znac realna liczbe cykli do
// zniszczenia dla wydruku 3D, ktorej nikt nie publikuje dla FDM), tylko
// mnozymy wymagany zapas bezpieczenstwa prostym wspolczynnikiem z tabeli -
// to samo podejscie "zapasu z gory", ktorego stress.js juz uzywa progami
// 1.5/3.0.

import { evaluate } from '../cad/stress.js';

export const FATIGUE_SCENARIOS = {
  static: { label: 'obciazenie statyczne (bez cykli)', factor: 1 },
  occasional: { label: 'okazjonalne cykle (kilka razy dziennie)', factor: 1.5 },
  daily: { label: 'codzienne uzycie (dziesiatki cykli dziennie)', factor: 2.2 },
  frequent: { label: 'czeste cykle / drgania (setki cykli dziennie)', factor: 3.5 },
  continuous: { label: 'praca ciagla / ciagle wibracje', factor: 5 },
};

function round(v, n) {
  const m = 10 ** n;
  return Math.round(v * m) / m;
}

function verdictFor(safety, suffix) {
  if (safety < 1) return `ZLAMIE SIE${suffix}`;
  if (safety < 1.5) return `NA GRANICY${suffix}`;
  if (safety < 3) return `BEZPIECZNY${suffix}`;
  return `DUZY ZAPAS${suffix}`;
}

/**
 * Ta sama wejsciowka co evaluate() z modules/cad/stress.js plus `scenario`
 * (klucz z FATIGUE_SCENARIOS). Zwraca oryginalny wynik (base) plus ocene
 * po uwzglednieniu zmeczenia.
 */
export function evaluateFatigue({ loadKg, armMm, widthMm, thickMm, material = 'PLA', printed = true, scenario = 'static' }) {
  const base = evaluate({ loadKg, armMm, widthMm, thickMm, material, printed });
  const sc = FATIGUE_SCENARIOS[scenario] || FATIGUE_SCENARIOS.static;
  const fatigueSafety = Number.isFinite(base.safety) ? round(base.safety / sc.factor, 2) : null;

  return {
    base,
    scenario,
    scenarioLabel: sc.label,
    fatigueFactor: sc.factor,
    fatigueSafety,
    fatigueVerdict: fatigueSafety == null ? base.verdict : verdictFor(fatigueSafety, ' (zmeczenie)'),
    ok: fatigueSafety == null ? base.ok : fatigueSafety >= 1.5,
  };
}

export function listFatigueScenarios() {
  return Object.entries(FATIGUE_SCENARIOS).map(([key, v]) => ({ key, ...v }));
}
