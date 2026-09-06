// Sprawdzanie wycieku danych.
//
// Hasla: Pwned Passwords range API (haveibeenpwned) dziala w modelu
// k-anonimowosci BEZ klucza API i bez wysylania hasla ani jego pelnego
// hasha do trzeciego serwisu - liczymy SHA-1 LOKALNIE, wysylamy tylko
// PIERWSZE 5 znakow hasha, serwis odsyla wszystkie sufiksy pasujace do
// tego prefiksu (setki, czasem tysiace), a dopasowanie sufiksu robimy
// znowu lokalnie. Serwis nigdy nie widzi ani hasla, ani jego pelnego
// odcisku - to jest cel k-anonimowosci, nie szczegol implementacyjny.
//
// E-maile: pelne API HIBP (sprawdzanie konkretnego adresu w wyciekach)
// wymaga PLATNEGO klucza. Bez niego funkcja uczciwie informuje o braku
// konfiguracji, zamiast udawac wynik albo wysylac e-mail do jakiegos
// darmowego zamiennika o nieznanej polityce prywatnosci.

import crypto from 'crypto';

const HIBP_API_KEY = process.env.HIBP_API_KEY || '';
const USER_AGENT = 'jarvis-security-check';

export function isEmailCheckConfigured() {
  return Boolean(HIBP_API_KEY);
}

/**
 * @param {string} password haslo w postaci jawnej - UZYWANE WYLACZNIE LOKALNIE
 *   do policzenia SHA-1; nigdy nie opuszcza tej funkcji w pelnej postaci.
 * @returns {Promise<{breached:boolean, count:number}>}
 */
export async function checkPasswordBreach(password) {
  const pass = String(password || '');
  if (!pass) throw new Error('Brak hasla do sprawdzenia.');

  const sha1 = crypto.createHash('sha1').update(pass, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'User-Agent': USER_AGENT, 'Add-Padding': 'true' },
  });
  if (!res.ok) throw new Error(`Pwned Passwords status ${res.status}`);
  const text = await res.text();

  for (const line of text.split('\n')) {
    const [lineSuffix, countRaw] = line.trim().split(':');
    if (lineSuffix === suffix) {
      const count = Number(countRaw) || 0;
      return { breached: count > 0, count };
    }
  }
  return { breached: false, count: 0 };
}

/**
 * @param {string} email adres do sprawdzenia w wyciekach (wymaga HIBP_API_KEY)
 * @returns {Promise<{configured:boolean, breached?:boolean, breaches?:Array<{name:string, breachDate:string}>}>}
 */
export async function checkEmailBreach(email) {
  if (!isEmailCheckConfigured()) {
    return {
      configured: false,
      message:
        'Sprawdzanie e-maila wymaga platnego klucza HIBP_API_KEY (haveibeenpwned.com/API/Key). ' +
        'Sprawdzanie hasel dziala bez klucza (Pwned Passwords).',
    };
  }
  const addr = String(email || '').trim();
  if (!addr) throw new Error('Brak adresu e-mail do sprawdzenia.');

  const res = await fetch(
    `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(addr)}?truncateResponse=false`,
    { headers: { 'hibp-api-key': HIBP_API_KEY, 'User-Agent': USER_AGENT } }
  );
  if (res.status === 404) return { configured: true, breached: false, breaches: [] };
  if (!res.ok) throw new Error(`HIBP status ${res.status}`);
  const list = await res.json();
  return {
    configured: true,
    breached: true,
    breaches: (Array.isArray(list) ? list : []).map((b) => ({ name: b.Name, breachDate: b.BreachDate })),
  };
}
