// Klient generycznego API "open banking" do podgladu salda i ostatnich
// transakcji - wzorowany na strukturze PSD2/Nordigen (GoCardless Bank
// Account Data): jeden bearer token wydany PRZEZ dostawce open-bankingowego
// po jednorazowej zgodzie uzytkownika u niego, nie login/haslo do banku.
// Jarvis NIGDY nie prosi o dane logowania do banku - to bylby dokladnie ten
// rodzaj wrazliwych danych, ktorych ten projekt celowo unika w kodzie.
//
// Ten sam wzor co drukarka (printer.js): brak env = isConfigured() zwraca
// false, a wolajacy (server/finance.js) odpowiada uzytkownikowi grzeczna
// informacja zamiast bledu.
//
// Ksztalt odpowiedzi konkretnego dostawcy (Nordigen/GoCardless, Tink, Plaid...)
// bywa rozny - ta warstwa celowo NIE zaklada jednego konkretnego formatu i
// przepuszcza dane z API w miare "surowe", zeby dzialala z wiekszoscia
// zgodnych z PSD2 endpointow bez przepisywania klienta pod kazdego dostawce.

const API_URL = (process.env.OPEN_BANKING_API_URL || '').replace(/\/+$/, '');
const API_TOKEN = process.env.OPEN_BANKING_TOKEN || '';

export function isConfigured() {
  return Boolean(API_URL && API_TOKEN);
}

async function bankFetch(pathAndQuery) {
  const res = await fetch(`${API_URL}${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      Accept: 'application/json',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || data.message || `HTTP ${res.status}`);
  }
  return data;
}

/** Saldo konta/kont - zwraca surowa odpowiedz dostawcy (zwykle lista kont z saldami). */
export async function getBalance() {
  if (!isConfigured()) return null;
  return bankFetch('/accounts/balances');
}

/** Ostatnie transakcje. */
export async function getRecentTransactions(limit = 10) {
  if (!isConfigured()) return null;
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  return bankFetch(`/accounts/transactions?limit=${n}`);
}
