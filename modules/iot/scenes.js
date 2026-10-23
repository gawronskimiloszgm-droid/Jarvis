// Gotowe sceny - "wychodze" i "kino". Kazda to sekwencja wywolan Home
// Assistant, ktora ma dzialac tak daleko, jak sie da, nawet gdy jedno
// urzadzenie akurat nie odpowiada (jedna zgasla żarowka nie powinna
// zablokowac zamykania rolet czy zamka) - stad Promise.allSettled zamiast
// przerywania na pierwszym bledzie, plus log co sie udalo/nie udalo.

import * as ha from './homeAssistant.js';
import * as bus from '../../server/core/bus.js';
import * as lockModule from './lock.js';

/**
 * Wykonuje liste krokow niezaleznie od siebie i zwraca raport sukces/porazka
 * dla kazdego. Krok to {label, run: () => Promise}.
 */
async function runSteps(sceneName, steps) {
  const results = await Promise.allSettled(steps.map((s) => s.run()));
  const report = results.map((r, i) => ({
    step: steps[i].label,
    ok: r.status === 'fulfilled',
    error: r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : null,
  }));
  const okCount = report.filter((r) => r.ok).length;
  const failed = report.filter((r) => !r.ok);

  bus.publish(
    'iot',
    `scene.${sceneName}`,
    `Scena "${sceneName}": ${okCount}/${report.length} krokow udanych` +
      (failed.length ? ` (nieudane: ${failed.map((f) => f.step).join(', ')})` : ''),
    {
      level: failed.length ? 'warn' : 'ok',
      speak: true,
      data: { scene: sceneName, report },
    }
  );

  return { scene: sceneName, okCount, total: report.length, steps: report };
}

/**
 * Tryb "wychodze": gasi wszystkie swiatla, zamyka wszystkie rolety,
 * blokuje wszystkie zamki (jesli sa). Dziala na WSZYSTKICH encjach danej
 * domeny, bo wychodzac z domu chce sie miec pewnosc, ze nic nie zostalo
 * pominiete - w przeciwienstwie do sceny kinowej, gdzie liczy sie
 * konkretny pokoj.
 * @param {{lightEntities?: string[], coverEntities?: string[], lockEntities?: string[]}} [opts]
 *   Opcjonalne jawne listy encji - gdy pominiete, pobierane sa WSZYSTKIE
 *   encje danej domeny z Home Assistant.
 */
export async function leaving(opts = {}) {
  if (!ha.isConfigured()) {
    throw new ha.NotConfiguredError();
  }

  const [lights, covers, locks] = await Promise.all([
    opts.lightEntities ? Promise.resolve(opts.lightEntities.map((entity_id) => ({ entity_id }))) : ha.getStates('light'),
    opts.coverEntities ? Promise.resolve(opts.coverEntities.map((entity_id) => ({ entity_id }))) : ha.getStates('cover'),
    opts.lockEntities ? Promise.resolve(opts.lockEntities.map((entity_id) => ({ entity_id }))) : ha.getStates('lock'),
  ]);

  const steps = [
    ...lights.map((l) => ({
      label: `swiatlo wylaczone: ${l.entity_id}`,
      run: () => ha.callService('light', 'turn_off', l.entity_id),
    })),
    ...covers.map((c) => ({
      label: `roleta zamknieta: ${c.entity_id}`,
      run: () => ha.callService('cover', 'close_cover', c.entity_id),
    })),
    ...locks.map((l) => ({
      label: `zamek zablokowany: ${l.entity_id}`,
      run: () => lockModule.lock(l.entity_id),
    })),
  ];

  if (!steps.length) {
    return { scene: 'leaving', okCount: 0, total: 0, steps: [], note: 'Brak encji light/cover/lock w Home Assistant.' };
  }

  return runSteps('leaving', steps);
}

/**
 * Tryb "kino": przyciemnia (jesli dimmable) lub gasi wskazane swiatla i
 * wlacza podany media_player. W przeciwienstwie do "wychodze" dziala TYLKO
 * na jawnie podanych encjach - nikt nie chce, zeby "wlacz kino" zgasilo
 * caly dom.
 * @param {{lightEntities?: string[], mediaPlayerEntity?: string, brightnessPct?: number}} opts
 */
export async function cinema({ lightEntities = [], mediaPlayerEntity, brightnessPct = 10 } = {}) {
  if (!ha.isConfigured()) {
    throw new ha.NotConfiguredError();
  }
  if (!lightEntities.length && !mediaPlayerEntity) {
    throw new Error('Podaj przynajmniej jedno z: lightEntities, mediaPlayerEntity.');
  }
  const pct = Math.max(0, Math.min(100, Number(brightnessPct) || 10));

  const steps = [
    ...lightEntities.map((entityId) => ({
      label: `swiatlo przyciemnione: ${entityId}`,
      // brightness_pct dziala tylko na zarowkach ktore to wspieraja - HA po
      // prostu ignoruje pole, ktorego encja nie obsluguje, wiec nie trzeba
      // tu sprawdzac atrybutow z gory.
      run: () => ha.callService('light', 'turn_on', entityId, { brightness_pct: pct }),
    })),
  ];
  if (mediaPlayerEntity) {
    steps.push({
      label: `odtwarzacz wlaczony: ${mediaPlayerEntity}`,
      run: () => ha.callService('media_player', 'turn_on', mediaPlayerEntity),
    });
  }

  return runSteps('cinema', steps);
}
