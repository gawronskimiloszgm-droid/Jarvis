// #127: Konwersja walut w locie.
//
// Darmowe open.er-api.com - bez klucza, bez rejestracji, kursy odswiezane
// raz dziennie (wystarczajaco dla podrozy, nie do handlu na gieldzie).

export async function convert(from, to, amount) {
  const fromCode = String(from || '').trim().toUpperCase();
  const toCode = String(to || '').trim().toUpperCase();
  const value = Number(amount);
  if (!fromCode || !toCode) throw new Error('Podaj waluty from i to (np. PLN, EUR).');
  if (!Number.isFinite(value) || value < 0) throw new Error('Podaj poprawna kwote.');

  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(fromCode)}`);
  if (!res.ok) throw new Error(`API kursow walut HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(data['error-type'] || 'API kursow walut zwrocilo blad.');

  const rate = data.rates?.[toCode];
  if (!Number.isFinite(rate)) throw new Error(`Nieznany kod waluty docelowej: ${toCode}.`);

  const result = Math.round(value * rate * 10000) / 10000;
  return {
    from: fromCode,
    to: toCode,
    amount: value,
    rate,
    result,
    updatedAt: data.time_last_update_utc || null,
  };
}
