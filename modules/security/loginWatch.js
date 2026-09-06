// Wykrywanie nietypowej aktywnosci logowania wlasciciela.
//
// Heurystyka celowo prosta (bez ML/geolokalizacji IP, ktora wymagalaby
// platnego API): "inny adres IP niz przy OSTATNIM udanym logowaniu" albo
// "godzina dnia, o ktorej wlasciciel jeszcze nigdy sie nie logowal (poza
// wachlarzem +/-2h wokol dotychczasowych)". To nie wykryje wyrafinowanego
// wlamania z tej samej sieci, ale zlapie najbardziej typowy sygnal ryzyka:
// haslo wycieklo i ktos loguje sie z innego miejsca albo o 4 w nocy.
//
// recordLogin(req) ma byc wolane z server/index.js PO udanej weryfikacji
// hasla w /api/login (dokladne miejsce - patrz raport koncowy). Ten plik
// tylko EKSPORTUJE funkcje - index.js jest na liscie zakazanych do edycji
// w tym batchu.

import * as memory from '../../server/memory.js';
import * as bus from '../../server/bus.js';

const MAX_HISTORY = 200;
// Ile godzin tolerancji wokol dotychczas widzianych por logowania, zanim
// nowa pora zostanie uznana za nietypowa.
const HOUR_TOLERANCE = Number(process.env.LOGIN_WATCH_HOUR_TOLERANCE || 2);
// Ponizej tylu zapisanych logowan nie oceniamy jeszcze "typowej pory" -
// przy 1-2 probkach kazda kolejna godzina wygladalaby na anomalie.
const MIN_SAMPLES_FOR_HOUR_CHECK = 3;

function load() {
  const data = memory.load();
  if (!data.loginWatch || !Array.isArray(data.loginWatch.history)) {
    data.loginWatch = { history: [], lastIp: null };
  }
  return data;
}

function extractIp(req) {
  return String(req?.ip || req?.headers?.['x-forwarded-for'] || 'nieznany').split(',')[0].trim();
}

/**
 * Wolane po KAZDYM udanym logowaniu wlasciciela. Zwraca ocene i publikuje
 * alert na magistrali, jesli logowanie wyglada nietypowo.
 * @param {import('express').Request} req
 */
export function recordLogin(req) {
  const data = load();
  const ip = extractIp(req);
  const hour = new Date().getHours();
  const history = data.loginWatch.history;

  const reasons = [];
  if (data.loginWatch.lastIp && data.loginWatch.lastIp !== ip) {
    reasons.push(`inny adres IP niz poprzednio (poprzednio ${data.loginWatch.lastIp}, teraz ${ip})`);
  }
  if (history.length >= MIN_SAMPLES_FOR_HOUR_CHECK) {
    const knownHours = history.map((h) => h.hour);
    const typical = knownHours.some((h) => {
      const diff = Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour)); // dystans "na okragłej tarczy" 0-23h
      return diff <= HOUR_TOLERANCE;
    });
    if (!typical) reasons.push(`nietypowa pora logowania (${hour}:00, dotad zwykle inne godziny)`);
  }

  history.push({ at: Date.now(), ip, hour });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  data.loginWatch.lastIp = ip;
  memory.save(data);

  if (reasons.length) {
    bus.publish('security', 'login.unusual', `nietypowe logowanie: ${reasons.join('; ')}`, {
      level: 'warn',
      speak: true,
      data: { ip, hour, reasons },
    });
  }
  return { ip, hour, unusual: reasons.length > 0, reasons };
}

export function getHistory(limit = 50) {
  return load().loginWatch.history.slice(-limit).reverse();
}
