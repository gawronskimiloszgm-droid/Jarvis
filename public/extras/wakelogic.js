// Decyzja, czy rozpoznane slowo to naprawde "Jarvis" (czysta logika, tests/wakelogic.test.mjs).
// Wejscie: wynik Vosk ze slowami i pewnoscia oraz sytuacja (Jarvis mowi, gra muzyka).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WakeLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_THRESHOLD = 0.8;

  /**
   * @param {{text?:string, result?:{word:string, conf:number, start:number, end:number}[]}} res wynik rozpoznawania
   * @param {{threshold?:number, speaking?:boolean, music?:boolean}} ctx
   * @returns {{ok:boolean, conf:number|null, reason:string}}
   */
  function accept(res, ctx = {}) {
    const text = String(res?.text || '');
    if (!/\bjarvis\b/.test(text)) return { ok: false, conf: null, reason: 'inne slowo' };
    if (ctx.speaking) return { ok: false, conf: null, reason: 'Jarvis wlasnie mowi' };
    const words = Array.isArray(res?.result) ? res.result : [];
    const w = words.find((x) => x.word === 'jarvis');
    // Starszy silnik bez szczegolow slow: przyjmujemy jak dotad.
    if (!w) return { ok: true, conf: null, reason: 'bez pewnosci' };
    const conf = Number(w.conf);
    const len = Number(w.end) - Number(w.start);
    if (Number.isFinite(len) && (len < 0.2 || len > 1.6)) return { ok: false, conf, reason: 'zla dlugosc slowa' };
    // Przy muzyce slowa pojawiaja sie w tekstach piosenek: wymagamy wiekszej pewnosci.
    const need = Math.min(0.99, (ctx.threshold ?? DEFAULT_THRESHOLD) + (ctx.music ? 0.08 : 0));
    return conf >= need ? { ok: true, conf, reason: 'ok' } : { ok: false, conf, reason: `za niska pewnosc (${conf.toFixed(2)} < ${need.toFixed(2)})` };
  }

  /** Korekta progu po informacji od uzytkownika: falszywe wlaczenie w gore, przeoczenie w dol. */
  function adjust(threshold, feedback) {
    const t = threshold + (feedback === 'false-alarm' ? 0.03 : -0.03);
    return Math.round(Math.max(0.5, Math.min(0.98, t)) * 100) / 100;
  }

  return { accept, adjust, DEFAULT_THRESHOLD };
});
