// Utrzymanie serwera w gotowosci + lekka "nauka" w czasie bezczynnosci.
//
// PROBLEM: darmowy Render usypia usluge po ~15 min bez ruchu, a wybudzenie
// trwa 30-60 s. Mielismy juz pingowanie z GitHub Actions, ale GitHub sam
// dokumentuje, ze zaplanowane zadania bywaja opoznione, a przy duzym
// obciazeniu wrecz POMIJANE - wiec przerwa potrafila przekroczyc 15 minut
// i serwer i tak zasypial.
//
// ROZWIAZANIE: serwer pinguje samego siebie po publicznym adresie. Dla
// Rendera to zwykly ruch przychodzacy, wiec licznik bezczynnosci sie
// zeruje - i nie zalezymy od niczego z zewnatrz.
//
// Przy okazji te cykle nie ida na marne: raz na dobe Jarvis porzadkuje
// wlasna pamiec (scala duplikaty i sprzecznosci), zamiast tylko odbijac
// pusty ping.

import * as memory from '../memory/memory.js';
import { consolidateFacts, condenseHistory } from './jarvis.js';
import { sweep as sweepSentinel } from '../home/sentinel.js';
import { runCheck as runProactiveCheck } from '../home/proactive.js';
import { maybeDailyReport, maybeWeeklyReport } from '../security/edith.js';
import { maybeRecurring } from '../extras/life.js';

const PING_MS = Number(process.env.UPKEEP_PING_MS || 10 * 60 * 1000); // 10 min
const LEARN_EVERY_MS = 24 * 60 * 60 * 1000;

let lastLearnAt = 0;
let timer = null;

function publicUrl() {
  // Render ustawia RENDER_EXTERNAL_URL automatycznie.
  return process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '';
}

async function selfPing() {
  const base = publicUrl();
  if (!base) return; // lokalnie nie ma sensu i nie ma czego pingowac
  try {
    await fetch(`${base.replace(/\/+$/, '')}/api/health`, {
      headers: { 'User-Agent': 'jarvis-upkeep' },
    });
  } catch {
    /* chwilowy brak sieci - nastepny cykl sprobuje ponownie */
  }
}

// Raz na dobe: prosimy model o uporzadkowanie zebranych faktow.
// Wynik przyjmujemy tylko jesli wyglada rozsadnie - patrz zabezpieczenia
// w consolidateFacts().
async function learn() {
  if (Date.now() - lastLearnAt < LEARN_EVERY_MS) return;
  lastLearnAt = Date.now();
  try {
    const result = await consolidateFacts();
    if (result?.changed) {
      console.log(`Porzadkowanie pamieci: ${result.before} -> ${result.after} faktow`);
    }
  } catch (err) {
    console.error('Porzadkowanie pamieci nieudane:', err.message);
  }
}

export function startUpkeep() {
  if (timer) return;
  const base = publicUrl();
  console.log(
    base
      ? `Utrzymanie w gotowosci: co ${Math.round(PING_MS / 60000)} min (${base})`
      : 'Utrzymanie w gotowosci: wylaczone (brak RENDER_EXTERNAL_URL - tryb lokalny)'
  );

  timer = setInterval(async () => {
    await selfPing();
    // Zwijanie historii sprawdzamy w KAZDYM cyklu, nie raz na dobe: samo
    // sprawdzenie jest darmowe (porownanie dlugosci), a model odzywa sie
    // dopiero po przekroczeniu progu. Przy intensywnym dniu rozmow czekanie
    // do nastepnej doby oznaczaloby utrate najstarszych watkow.
    try {
      const folded = await condenseHistory();
      if (folded?.changed) {
        console.log(`Kronika rozmow: zwinieto ${folded.folded} wypowiedzi, zostalo ${folded.kept}`);
      }
    } catch (err) {
      console.error('Zwijanie historii nieudane:', err.message);
    }
    await learn();
    try {
      const result = await sweepSentinel();
      if (result.reported) {
        console.log(`Wartownik: sprawdzono ${result.checked} tematow, ${result.reported} nowych znalezisk`);
      }
    } catch (err) {
      console.error('Wartownik tematow nieudany:', err.message);
    }
    try {
      await maybeDailyReport();
      await maybeWeeklyReport();
      await maybeRecurring();
    } catch (err) {
      console.error('Raport E.D.I.T.H. nieudany:', err.message);
    }
    try {
      // Bez wspolrzednych - to cykl w tle, nie zapytanie z telefonu. Kontrole
      // zalezne od GPS (np. pogoda na trasie) po prostu same siebie pomijaja.
      await runProactiveCheck(null);
    } catch (err) {
      console.error('Warstwa proaktywna nieudana:', err.message);
    }
  }, PING_MS);

  // Nie blokuje zamkniecia procesu przy restarcie/wdrozeniu.
  if (timer.unref) timer.unref();
}

export function stopUpkeep() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
