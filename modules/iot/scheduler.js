// Automatyczne sceny na podstawie pory dnia/pogody.
//
// Harmonogram to prosta lista {godzina, warunek pogodowy, nazwa sceny},
// trzymana w tym samym namespace pamieci co reszta modulu IoT. Zadnego
// wlasnego crona tutaj - runDue() ma byc wywolywane cyklicznie z zewnatrz
// (patrz raport modulu IoT: podpiecie pod server/upkeep.js, ktorego nie
// wolno tu edytowac). Kazdy wpis odpala sie najwyzej raz dziennie - znacznik
// "ostatnio uruchomiono <data>" chroni przed wielokrotnym odpaleniem tej
// samej sceny w oknie tolerancji, dokladnie jak server/memory.js robi to
// dla odprawy porannej/wieczornej.

import * as scenes from './scenes.js';
import * as bus from '../../server/core/bus.js';
import { getWeather } from '../../server/core/weather.js';
import { load, save } from '../../server/memory/memory.js';
import { nanoid } from 'nanoid';

const TOLERANCE_MIN = Number(process.env.IOT_SCHEDULE_TOLERANCE_MIN || 10);

function data() {
  const d = load();
  if (!d.iot) d.iot = {};
  if (!Array.isArray(d.iot.schedule)) d.iot.schedule = [];
  return d;
}

export function listSchedule() {
  return data().iot.schedule;
}

/**
 * @param {{hour:number, minute?:number, weatherCondition?:'any'|'rain'|'clear', scene:'leaving'|'cinema', params?:object}} entry
 */
export function addScheduleEntry(entry) {
  const hour = Number(entry.hour);
  const minute = Number(entry.minute) || 0;
  const scene = String(entry.scene || '').trim();
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) throw new Error('hour musi byc liczba 0-23.');
  if (minute < 0 || minute > 59) throw new Error('minute musi byc liczba 0-59.');
  if (!['leaving', 'cinema'].includes(scene)) throw new Error('scene musi byc "leaving" albo "cinema".');
  const weatherCondition = ['any', 'rain', 'clear'].includes(entry.weatherCondition) ? entry.weatherCondition : 'any';

  const d = data();
  const item = {
    id: nanoid(8),
    hour,
    minute,
    weatherCondition,
    scene,
    params: entry.params && typeof entry.params === 'object' ? entry.params : {},
    lastRunDate: null,
  };
  d.iot.schedule.push(item);
  save(d);
  return d.iot.schedule;
}

export function removeScheduleEntry(id) {
  const d = data();
  d.iot.schedule = d.iot.schedule.filter((e) => e.id !== id);
  save(d);
  return d.iot.schedule;
}

function todayKey(now) {
  return now.toISOString().slice(0, 10);
}

function minutesSinceMidnight(now) {
  return now.getHours() * 60 + now.getMinutes();
}

function isRainy(condition) {
  return /deszcz|mzawk|burz/i.test(String(condition || ''));
}

async function weatherMatches(condition, city) {
  if (condition === 'any') return true;
  const weather = await getWeather(city || process.env.OWNER_CITY || 'Warszawa').catch(() => null);
  if (!weather) return false;
  const rainy = isRainy(weather.condition);
  return condition === 'rain' ? rainy : !rainy;
}

/**
 * Sprawdza wszystkie wpisy harmonogramu i odpala te, ktorych okno czasowe
 * (godzina:minuta +/- tolerancja) wlasnie trwa, warunek pogodowy jest
 * spelniony i nie zostaly juz odpalone dzisiaj. Bezpieczne do wywolywania
 * czesto (np. co 10 min z upkeep.js) - powtorne wywolanie w tym samym oknie
 * nic nie robi dzieki lastRunDate.
 */
export async function runDue() {
  const d = data();
  if (!d.iot.schedule.length) return { checked: 0, ran: [] };

  const now = new Date();
  const nowMin = minutesSinceMidnight(now);
  const today = todayKey(now);
  const ran = [];

  for (const entry of d.iot.schedule) {
    if (entry.lastRunDate === today) continue;
    const entryMin = entry.hour * 60 + entry.minute;
    if (Math.abs(nowMin - entryMin) > TOLERANCE_MIN) continue;

    let matches = false;
    try {
      matches = await weatherMatches(entry.weatherCondition, entry.params?.city);
    } catch {
      matches = false;
    }
    if (!matches) continue;

    entry.lastRunDate = today; // ustawiamy PRZED wywolaniem, zeby blad sceny nie zapetlil probowania w kolko
    save(d);

    try {
      const result = entry.scene === 'cinema' ? await scenes.cinema(entry.params) : await scenes.leaving(entry.params);
      ran.push({ id: entry.id, scene: entry.scene, result });
    } catch (err) {
      bus.publish('iot', 'schedule.failed', `Automatyczna scena "${entry.scene}" nieudana: ${err.message}`, {
        level: 'warn',
        data: { entryId: entry.id },
      });
      ran.push({ id: entry.id, scene: entry.scene, error: err.message });
    }
  }

  return { checked: d.iot.schedule.length, ran };
}
