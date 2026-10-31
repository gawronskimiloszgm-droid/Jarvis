// Polskie znaki po stronie serwera: prompty i tekst do mowy. Logika i slownik sa wspolne z klientem
// (public/extras/pltext.js, plwords.js). Prompty pisane sa bez ogonkow, a model czyta je doslownie,
// wiec bez tego uczy sie zlej pisowni, a mowa przekreca wyrazy ("dzialaja" zamiast "działają").
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../../public/extras/${f}`, import.meta.url), 'utf8');
const scope = {};
new Function('module', 'globalThis', read('plwords.js'))({ exports: {} }, scope);
const mod = { exports: {} };
new Function('module', 'globalThis', read('pltext.js'))(mod, scope);
const pl = mod.exports(scope.PL_WORDS);

export const plFix = (text, opts) => pl.fix(text, opts);

export const PL_RULE =
  'JEZYK I WYMOWA: mowisz i piszesz wylacznie poprawna polszczyzna, ZAWSZE z pelnymi polskimi znakami (ą, ć, ę, ł, ń, ó, ś, ź, ż) - nigdy "dzialaja", zawsze "działają". ' +
  'Wymawiasz po polsku, naturalnie i wyraznie: ł jak w "łódź", ą i ę nosowo, ś ć ź ż cz sz rz z polska, akcent na przedostatniej sylabie. Obce nazwy wymawiasz tak, jak robi to Polak. Slowo "sir" wymawiasz "ser".';

// Prompt gotowy dla modelu: znaczniki WIELKIMI LITERAMI i nazwy narzedzi zostaja bez zmian.
export const promptFix = (text, protect) => `${plFix(text, { skipCaps: true, protect })}\n\n${plFix(PL_RULE)}`;

// Opisy w deklaracjach narzedzi (tylko pola description, nigdy nazwy ani wartosci enum).
export function fixDescriptions(node) {
  if (Array.isArray(node)) return node.map(fixDescriptions);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === 'description' && typeof v === 'string' ? plFix(v, { skipCaps: true }) : fixDescriptions(v);
  return out;
}
