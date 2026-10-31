// Silnik automatyzacji "gdy X, zrob Y": czysta logika bez DOM (tests/autoengine.test.mjs).
// Zdarzenie: { type: 'activity', kind, text } | { type: 'start' } | { type: 'tick', now } .
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STRIP = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  const norm = (s) => String(s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => STRIP[c]);

  // Co moze uruchomic regule. Rodzaje zdarzen pochodza z czujnika aplikacji (activity.js).
  const TRIGGERS = {
    time: { label: 'O godzinie', fields: ['at', 'days'] },
    start: { label: 'Po uruchomieniu aplikacji', fields: [] },
    focusEnd: { label: 'Koniec skupienia', kind: 'skupienie' },
    timerEnd: { label: 'Koniec minutnika', kind: 'minutnik' },
    musicStart: { label: 'Gdy zaczyna grać muzyka', kind: 'muzyka' },
    back: { label: 'Gdy wracam do komputera', kind: 'obecnosc', contains: 'wrocil' },
    away: { label: 'Gdy odchodzę od komputera', kind: 'obecnosc', contains: 'odszedl' },
    gameStart: { label: 'Gdy zaczynam grać', kind: 'gra', contains: 'start' },
    gameEnd: { label: 'Gdy kończę grać', kind: 'gra', contains: 'koniec' },
    offline: { label: 'Gdy zniknie internet', kind: 'siec', contains: 'utracono' },
    module: { label: 'Gdy otwieram moduł', kind: 'modul', fields: ['contains'] },
    activity: { label: 'Gdy w aplikacji pojawi się tekst', fields: ['contains'] },
  };

  /** Czy zdarzenie pasuje do warunku reguly. Czas: raz na minute, w podanych dniach tygodnia (0 = niedziela). */
  function matches(when, ev, tz = {}) {
    if (!when || !ev) return false;
    if (when.type === 'start') return ev.type === 'start';
    if (when.type === 'time') {
      if (ev.type !== 'tick') return false;
      const hm = tz.hm ?? ev.hm;
      const dow = tz.dow ?? ev.dow;
      if (hm !== when.at) return false;
      return !Array.isArray(when.days) || !when.days.length || when.days.includes(dow);
    }
    if (ev.type !== 'activity') return false;
    const def = TRIGGERS[when.type];
    if (!def) return false;
    if (def.kind && ev.kind !== def.kind) return false;
    const need = when.contains ?? def.contains;
    return !need || norm(ev.text).includes(norm(need));
  }

  /**
   * Ktore reguly uruchomic. Blokady: wylaczona, odstep miedzy uruchomieniami (domyslnie 60 s, zeby
   * nie zapetlic), zdarzenia samych automatyzacji nigdy niczego nie uruchamiaja.
   */
  function pick(rules, ev, lastRun, now) {
    if (ev.type === 'activity' && ev.kind === 'automatyzacja') return [];
    return (rules || []).filter((r) => {
      if (r.on === false || !matches(r.when, ev)) return false;
      const gap = (r.cooldown ?? 60) * 1000;
      return now - (lastRun[r.id] || 0) >= gap;
    });
  }

  function describe(when) {
    const d = TRIGGERS[when?.type];
    if (!d) return 'nieznany warunek';
    if (when.type === 'time') {
      const NAMES = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
      const days = Array.isArray(when.days) && when.days.length ? ` (${when.days.map((x) => NAMES[x]).join(', ')})` : '';
      return `o ${when.at}${days}`;
    }
    return when.contains ? `${d.label.toLowerCase()}: „${when.contains}”` : d.label.toLowerCase();
  }

  return { TRIGGERS, matches, pick, describe, norm };
});
