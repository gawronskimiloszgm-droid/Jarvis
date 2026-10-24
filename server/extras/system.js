// Fundament: wersje, "Doktor" (diagnostyka konfiguracji) i kopia zapasowa
// pamieci w JSON (eksport + przywracanie).

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireOwner, isAuthConfigured } from '../core/auth.js';
import { backendName, isRemote } from '../core/store.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

export const SERVER_VERSION = readVersion();
// Najstarsza wersja aplikacji desktopowej, ktora rozumie obecny serwer
// (nowe akcje sterowania komputerem, potwierdzenia E.D.I.T.H.). Starsza
// odpowiada na wszystko "nieznana akcja" - klient pokaze wtedy ostrzezenie.
export const MIN_DESKTOP_VERSION = process.env.MIN_DESKTOP_VERSION || '0.2.0';

const startedAt = Date.now();
const router = express.Router();

// --- Doktor: co jest skonfigurowane, a co nie ---

function check(id, label, ok, detail, fix) {
  return { id, label, status: ok === 'warn' ? 'warn' : ok ? 'ok' : 'bad', detail, fix: ok === true ? undefined : fix };
}

function serverChecks() {
  const checks = [];
  checks.push(
    check('gemini', 'Klucz Gemini (Jarvis)', Boolean(process.env.GEMINI_API_KEY), process.env.GEMINI_API_KEY ? 'ustawiony' : 'brak', 'Ustaw GEMINI_API_KEY w zmiennych srodowiskowych (Render -> Environment).')
  );
  checks.push(
    check(
      'edith-key',
      'Klucz Gemini (E.D.I.T.H.)',
      process.env.EDITH_GEMINI_API_KEY ? true : 'warn',
      process.env.EDITH_GEMINI_API_KEY ? 'osobny klucz' : 'wspolny z Jarvisem (dziala, ale dziela limit)',
      'Opcjonalnie ustaw EDITH_GEMINI_API_KEY na drugi, darmowy klucz.'
    )
  );
  checks.push(check('owner', 'Haslo wlasciciela', isAuthConfigured(), isAuthConfigured() ? 'ustawione' : 'brak - dziala tylko tryb goscia', 'Ustaw OWNER_PASSWORD (i SESSION_SECRET).'));
  checks.push(
    check('session', 'SESSION_SECRET', Boolean(process.env.SESSION_SECRET), process.env.SESSION_SECRET ? 'ustawiony' : 'brak - sesje nie przetrwaja restartu', 'Ustaw dlugi, losowy SESSION_SECRET.')
  );
  checks.push(
    check(
      'storage',
      'Trwala pamiec',
      isRemote ? true : 'warn',
      `${backendName()}${isRemote ? '' : ' - na Renderze zniknie przy kazdym deployu'}`,
      'Zaloz darmowa baze Upstash Redis i ustaw UPSTASH_REDIS_REST_URL oraz UPSTASH_REDIS_REST_TOKEN.'
    )
  );
  checks.push(check('push', 'Powiadomienia push (VAPID)', push.isConfigured(), push.isConfigured() ? 'skonfigurowane' : 'brak kluczy VAPID', 'Wygeneruj: node scripts/generate-vapid-keys.js i wpisz do .env.'));
  checks.push(
    check(
      'public-url',
      'Adres publiczny (keep-alive)',
      process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL ? true : 'warn',
      process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || 'tryb lokalny',
      'Na Renderze ustawia sie sam; lokalnie nie jest potrzebny.'
    )
  );
  checks.push(check('node', 'Wersja Node.js', Number(process.versions.node.split('.')[0]) >= 20 ? true : 'warn', process.version, 'Projekt wymaga Node >= 20.'));
  return checks;
}

router.get('/api/doctor', requireOwner, (req, res) => {
  res.json({
    version: SERVER_VERSION,
    minDesktopVersion: MIN_DESKTOP_VERSION,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    checks: serverChecks(),
  });
});

// --- Kopia zapasowa ---

// Subskrypcje push zawieraja klucze konkretnych przegladarek - nie ma sensu
// ich przenosic (po przywroceniu i tak trzeba wlaczyc powiadomienia ponownie),
// a wyciek pliku kopii nie powinien ujawniac endpointow.
const EXCLUDE_FROM_BACKUP = new Set(['pushSubscriptions', 'googleRefreshToken']);

router.get('/api/backup', requireOwner, (req, res) => {
  const data = { ...memory.load() };
  for (const k of EXCLUDE_FROM_BACKUP) delete data[k];
  const payload = { kind: 'jarvis-backup', version: SERVER_VERSION, createdAt: new Date().toISOString(), data };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jarvis-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

router.post('/api/backup/restore', requireOwner, express.json({ limit: '25mb' }), (req, res) => {
  const body = req.body;
  if (body?.kind !== 'jarvis-backup' || typeof body.data !== 'object' || !body.data || Array.isArray(body.data)) {
    return res.status(400).json({ error: 'To nie wyglada na plik kopii zapasowej Jarvisa.' });
  }
  const incoming = { ...body.data };
  for (const k of EXCLUDE_FROM_BACKUP) delete incoming[k];

  // Zwracamy poprzedni stan, zeby pomylkowe przywrocenie dalo sie cofnac.
  const previous = { ...memory.load() };
  for (const k of EXCLUDE_FROM_BACKUP) delete previous[k];

  const current = memory.load();
  memory.save({ ...current, ...incoming, pushSubscriptions: current.pushSubscriptions, googleRefreshToken: current.googleRefreshToken });
  res.json({ ok: true, restoredKeys: Object.keys(incoming).length, previous: { kind: 'jarvis-backup', createdAt: new Date().toISOString(), data: previous } });
});

export default router;
