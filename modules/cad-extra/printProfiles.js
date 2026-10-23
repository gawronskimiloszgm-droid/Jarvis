// #103 Automatyczny dobor parametrow druku pod material.
//
// Stala tabela wartosci uzywanych powszechnie w PrusaSlicer/Cura jako
// bezpieczny punkt startowy - NIE wymaga AI, to czysta konfiguracja.
// Zakresy (nie pojedyncze liczby), bo realna temperatura zalezy od
// konkretnej szpuli/producenta - podajemy przedzial i wartosc "domyslna"
// w srodku.

export const PRINT_PROFILES = {
  PLA: {
    material: 'PLA',
    nozzleC: { min: 190, max: 220, default: 205 },
    bedC: { min: 50, max: 60, default: 55 },
    speedMmS: { min: 40, max: 70, default: 55 },
    fanPercent: 100,
    dryerNeeded: false,
    note: 'Najlatwiejszy w druku - nie wymaga zamknietej komory ani suszenia filamentu.',
  },
  PETG: {
    material: 'PETG',
    nozzleC: { min: 220, max: 245, default: 235 },
    bedC: { min: 70, max: 85, default: 80 },
    speedMmS: { min: 30, max: 55, default: 45 },
    fanPercent: 40,
    dryerNeeded: false,
    note: 'Wentylator nizej niz przy PLA - inaczej warstwy slabo sie klejaja. Podatny na "stringing".',
  },
  ABS: {
    material: 'ABS',
    nozzleC: { min: 230, max: 250, default: 240 },
    bedC: { min: 95, max: 110, default: 100 },
    speedMmS: { min: 30, max: 60, default: 45 },
    fanPercent: 10,
    dryerNeeded: false,
    note: 'Wymaga zamknietej komory drukarki - bez oslony pekaja rogi (odklejanie od stolu).',
  },
  ASA: {
    material: 'ASA',
    nozzleC: { min: 235, max: 255, default: 245 },
    bedC: { min: 95, max: 110, default: 100 },
    speedMmS: { min: 30, max: 60, default: 45 },
    fanPercent: 10,
    dryerNeeded: false,
    note: 'Podobny do ABS, ale odporny na UV - dobry na elementy na zewnatrz. Tez wymaga zamknietej komory.',
  },
  NYLON: {
    material: 'NYLON',
    nozzleC: { min: 240, max: 260, default: 250 },
    bedC: { min: 70, max: 90, default: 80 },
    speedMmS: { min: 25, max: 50, default: 35 },
    fanPercent: 20,
    dryerNeeded: true,
    note: 'Bardzo higroskopijny - suszenie filamentu przed drukiem (kilka godzin w suszarce) jest praktycznie obowiazkowe.',
  },
};

export function getPrintProfile(material) {
  const key = String(material || '').toUpperCase();
  return PRINT_PROFILES[key] || null;
}

export function listPrintProfiles() {
  return Object.values(PRINT_PROFILES);
}
