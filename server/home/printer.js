// Drukarka 3D: OctoPrint (REST z kluczem) albo Klipper przez Moonraker (zwykle w sieci domowej bez klucza).
// Wspolny ksztalt stanu, zeby reszta Jarvisa nie musiala wiedziec, z czym rozmawia.
//
// Celowo bez zadnej nowej zaleznosci: Node 20+ ma wbudowane FormData/Blob/fetch.
// Uwaga: OctoPrint drukuje G-code; plik STL bez wtyczki do krojenia zostanie tylko wgrany.

const env = () => ({
  url: (process.env.PRINTER_URL || '').replace(/\/+$/, ''),
  key: process.env.PRINTER_API_KEY || '',
  // Bez klucza zakladamy Moonrakera: OctoPrint zawsze go wymaga.
  type: (process.env.PRINTER_TYPE || (process.env.PRINTER_API_KEY ? 'octoprint' : 'moonraker')).toLowerCase(),
  snapshot: process.env.PRINTER_SNAPSHOT_URL || '',
});

export function isConfigured() {
  const e = env();
  return Boolean(e.url && (e.type === 'moonraker' || e.key));
}
export const printerType = () => env().type;

function headers(extra = {}) {
  const { key } = env();
  return key ? { 'X-Api-Key': key, ...extra } : extra;
}

/** Wgranie pliku i start druku. */
export async function uploadAndPrint(buffer, filename) {
  if (!isConfigured()) throw new Error('Drukarka nie jest skonfigurowana (PRINTER_URL, dla OctoPrint także PRINTER_API_KEY).');
  const { url, type } = env();
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/octet-stream' }), filename);
  form.append('print', 'true');
  const res = await fetch(`${url}${type === 'moonraker' ? '/server/files/upload' : '/api/files/local'}`, { method: 'POST', headers: headers(), body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drukarka odpowiedziala HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return { ok: true };
}

const STATES = { printing: 'printing', paused: 'paused', complete: 'finished', standby: 'idle', error: 'error', cancelled: 'idle', operational: 'idle', ready: 'idle' };

/**
 * Stan biezacego zadania: { state: printing|paused|idle|finished|error|offline, fileName, progressPct, printTimeLeftSec }.
 * null, gdy drukarka nie jest skonfigurowana.
 */
export async function jobStatus() {
  if (!isConfigured()) return null;
  const { url, type } = env();
  try {
    if (type === 'moonraker') {
      const res = await fetch(`${url}/printer/objects/query?print_stats&virtual_sdcard`, { headers: headers(), signal: AbortSignal.timeout(6000) });
      if (!res.ok) return { state: 'offline' };
      const st = (await res.json())?.result?.status || {};
      const ps = st.print_stats || {};
      const progress = Number(st.virtual_sdcard?.progress) || 0;
      const spent = Number(ps.print_duration) || 0;
      return {
        state: STATES[ps.state] || 'idle',
        fileName: ps.filename || null,
        progressPct: Math.round(progress * 100),
        printTimeLeftSec: progress > 0.01 && ps.state === 'printing' ? Math.round(spent / progress - spent) : null,
      };
    }
    const res = await fetch(`${url}/api/job`, { headers: headers(), signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { state: 'offline' };
    const data = await res.json();
    const s = String(data.state || '').toLowerCase();
    return {
      state: /printing/.test(s) ? 'printing' : /paus/.test(s) ? 'paused' : /error|offline/.test(s) ? 'error' : 'idle',
      fileName: data.job?.file?.name || null,
      progressPct: data.progress?.completion == null ? null : Math.round(data.progress.completion),
      printTimeLeftSec: data.progress?.printTimeLeft ?? null,
    };
  } catch {
    return { state: 'offline' };
  }
}

/** Klatka z kamery drukarki (mjpg-streamer / crowsnest); adres mozna nadpisac PRINTER_SNAPSHOT_URL. */
export async function snapshot() {
  if (!isConfigured()) throw new Error('Drukarka nie jest skonfigurowana.');
  const { url, snapshot: custom } = env();
  const res = await fetch(custom || `${url}/webcam/?action=snapshot`, { headers: headers(), signal: AbortSignal.timeout(8000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !/^image\//.test(type)) throw new Error('Kamera drukarki nie odpowiada.');
  return { type, buffer: Buffer.from(await res.arrayBuffer()) };
}
