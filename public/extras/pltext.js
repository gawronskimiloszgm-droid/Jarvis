// Przywracanie polskich znakow: "Wszystkie systemy dzialaja" -> "Wszystkie systemy działają".
// Uzywane w trzech miejscach: tekst do mowy i prompty na serwerze (zeby Jarvis wymawial poprawnie)
// oraz napisy w interfejsie. Slownik w plwords.js. Dziala tez w Node (testy, serwer).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PlText = factory(root.PL_WORDS || '');
})(typeof globalThis !== 'undefined' ? globalThis : this, function (wordList) {
  const STRIP = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  const plain = (w) => w.replace(/[ąćęłńóśźż]/g, (c) => STRIP[c]);
  const map = new Map();
  String(wordList)
    .split(' ')
    .forEach((w) => {
      if (!w) return;
      const k = plain(w);
      if (!map.has(k)) map.set(k, w);
    });

  // Po "ze" w tym znaczeniu zostaje "ze" ("ze mna"); w kazdym innym przypadku to prawie zawsze "że".
  const ZE_KEEP = /^(mna|mną|mnie|soba|sobą|wzgledu|względu|swiata|świata|wszystkich|strony|szkoly|szkoły|sklepu|stolu|stołu|stolem|sciana|ścianą|schowka|skrzynki|snu|sluzby|służby|zdjecia|zdjęcia|zdjeciem|zmeczenia|zmęczenia|Zlotych|zlotych|złotych|srodka|środka|szczegolami|szczegółami|znakami)$/i;

  function caseLike(src, out) {
    if (src === src.toLowerCase()) return out;
    if (src.length > 1 && src === src.toUpperCase()) return out.toUpperCase();
    if (src[0] === src[0].toUpperCase()) return out[0].toUpperCase() + out.slice(1);
    return out;
  }

  // Slowo = ciag liter. Nie ruszamy identyfikatorow: niczego polaczonego myslnikiem, podkresleniem,
  // kropka, ukosnikiem albo cyfra (otworz-aplikacje, dodaj_zadanie, plik.js, http://...).
  const WORD = /[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g;

  /**
   * @param {string} text
   * @param {{ skipCaps?: boolean, protect?: Set<string> }} [opts] skipCaps: slowa WIELKIMI LITERAMI bez zmian
   *   (znaczniki w promptach, np. [ZAPAMIETAJ: ...]); protect: nazwy, ktorych nie wolno zmienic.
   */
  function fix(text, opts = {}) {
    const s = String(text ?? '');
    if (!s || !/[a-zA-Z]/.test(s)) return s;
    return s.replace(WORD, (w, i) => {
      if (w.length < 2) return w;
      const before = s[i - 1];
      const after = s[i + w.length];
      if (before && /[-_./\\:@#=\d]/.test(before) && before !== ':') return w;
      if (after && /[-_/\\@=\d]/.test(after)) return w;
      if (after === '.' && /[a-zA-Z]/.test(s[i + w.length + 1] || '')) return w; // plik.js, J.A.R.V.I.S
      if (opts.skipCaps && w.length > 1 && w === w.toUpperCase()) return w;
      if (opts.protect && opts.protect.has(w)) return w;
      const low = w.toLowerCase();
      if (low === 'ze') {
        const next = /^\s+([A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)/.exec(s.slice(i + 2));
        if (next && ZE_KEEP.test(next[1])) return w;
        return caseLike(w, 'że');
      }
      if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(w)) return w;
      const hit = map.get(low);
      return hit ? caseLike(w, hit) : w;
    });
  }

  return { fix, size: map.size };
});
