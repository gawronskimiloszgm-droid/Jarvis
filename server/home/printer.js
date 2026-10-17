// Wyslanie gotowego modelu prosto do drukarki 3D przez OctoPrint (REST API,
// dziala tez z Klipper+Mainsail/Fluidd przez wtyczke OctoPrint-compat, ale
// natywnego Moonrakera NIE obsluguje - inny format API, do dodania osobno
// gdyby okazal sie potrzebny).
//
// Celowo bez zadnej nowej zaleznosci: Node 20+ ma wbudowane FormData/Blob/
// fetch, a to wystarcza do multipart-uploadu pliku - dokladnie ten sam
// minimalizm co reszta projektu (patrz np. rezygnacja z biblioteki CAD).

const PRINTER_URL = (process.env.PRINTER_URL || '').replace(/\/+$/, '');
const PRINTER_API_KEY = process.env.PRINTER_API_KEY || '';

export function isConfigured() {
  return Boolean(PRINTER_URL && PRINTER_API_KEY);
}

function headers(extra = {}) {
  return { 'X-Api-Key': PRINTER_API_KEY, ...extra };
}

/**
 * Wysyla plik STL do OctoPrint i od razu zleca druk.
 * @param {Buffer} stlBuffer
 * @param {string} filename
 */
export async function uploadAndPrint(stlBuffer, filename) {
  if (!isConfigured()) {
    throw new Error('Drukarka nie jest skonfigurowana (brak PRINTER_URL/PRINTER_API_KEY).');
  }
  const form = new FormData();
  form.append('file', new Blob([stlBuffer], { type: 'model/stl' }), filename);
  form.append('print', 'true');

  const res = await fetch(`${PRINTER_URL}/api/files/local`, {
    method: 'POST',
    headers: headers(),
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drukarka odpowiedziala HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return { ok: true };
}

/** Stan biezacego zadania druku, jesli drukarka jest skonfigurowana. */
export async function jobStatus() {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${PRINTER_URL}/api/job`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      state: data.state,
      fileName: data.job?.file?.name || null,
      progressPct: data.progress?.completion == null ? null : Math.round(data.progress.completion),
      printTimeLeftSec: data.progress?.printTimeLeft ?? null,
    };
  } catch {
    return null;
  }
}
