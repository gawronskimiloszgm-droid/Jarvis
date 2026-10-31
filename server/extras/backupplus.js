// Bezpieczenstwo danych: codzienne kopie stanu w magazynie (7 ostatnich dni i 4 tygodnie wstecz),
// przywracanie jednym kliknieciem, podglad stanu zapisu. Kopia NIE zawiera sekretow (tokeny, subskrypcje).
import express, { Router } from 'express';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import { snapshotDelete, snapshotRead, snapshotWrite, storeStatus } from '../core/store.js';
import { warsawDay } from './life.js';

const router = Router();
const SECRET_KEYS = ['pushSubscriptions', 'googleRefreshToken', 'snapshots'];
const SIZE_WARN = 800 * 1024;

const clean = () => {
  const data = { ...memory.load() };
  for (const k of SECRET_KEYS) delete data[k];
  return data;
};
const index = () => {
  const d = memory.load();
  if (!Array.isArray(d.snapshots)) d.snapshots = [];
  return d.snapshots;
};

/** Ktore kopie zachowac: 7 najnowszych dziennych i po jednej z 4 ostatnich tygodni. Reszta do usuniecia. */
export function pruneSnapshots(list, keepDaily = 7, keepWeekly = 4) {
  const auto = list.filter((s) => s.kind !== 'manual').sort((a, b) => b.at - a.at);
  const keep = new Set(auto.slice(0, keepDaily).map((s) => s.name));
  const weeks = new Set();
  for (const s of auto.slice(keepDaily)) {
    const week = Math.floor(s.at / (7 * 86400000));
    if (!weeks.has(week) && weeks.size < keepWeekly) {
      weeks.add(week);
      keep.add(s.name);
    }
  }
  const manual = list.filter((s) => s.kind === 'manual').sort((a, b) => b.at - a.at);
  manual.slice(0, 5).forEach((s) => keep.add(s.name));
  return list.filter((s) => !keep.has(s.name)).map((s) => s.name);
}

export async function makeSnapshot(kind = 'auto', label = warsawDay()) {
  const name = kind === 'auto' ? `dzien-${label}` : `${kind}-${Date.now()}`;
  const data = clean();
  const size = Buffer.byteLength(JSON.stringify(data));
  await snapshotWrite(name, { kind: 'jarvis-backup', createdAt: new Date().toISOString(), data });
  const list = index().filter((s) => s.name !== name);
  list.push({ name, kind, at: Date.now(), size });
  for (const old of pruneSnapshots(list)) {
    await snapshotDelete(old).catch(() => {});
    list.splice(list.findIndex((s) => s.name === old), 1);
  }
  memory.load().snapshots = list;
  memory.save(memory.load());
  return { name, size };
}

export async function maybeSnapshot() {
  const name = `dzien-${warsawDay()}`;
  if (index().some((s) => s.name === name)) return false;
  await makeSnapshot('auto');
  return true;
}

router.get('/api/backup/status', requireOwner, (req, res) => {
  const st = storeStatus();
  const size = Buffer.byteLength(JSON.stringify(memory.load()));
  res.json({ ...st, size, sizeWarn: size > SIZE_WARN, snapshots: [...index()].sort((a, b) => b.at - a.at) });
});

router.post('/api/backup/snapshot', requireOwner, async (req, res) => {
  try {
    res.json({ ok: true, ...(await makeSnapshot('manual')) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Nie udało się zrobić kopii.' });
  }
});

router.get('/api/backup/snapshot/:name', requireOwner, async (req, res) => {
  const snap = await snapshotRead(req.params.name).catch(() => null);
  if (!snap) return res.status(404).json({ error: 'Nie ma takiej kopii.' });
  res.setHeader('Content-Disposition', `attachment; filename="jarvis-${req.params.name.replace(/[^\w-]/g, '')}.json"`);
  res.json(snap);
});

router.post('/api/backup/snapshot/restore', requireOwner, express.json(), async (req, res) => {
  const name = String(req.body?.name || '');
  if (!index().some((s) => s.name === name)) return res.status(404).json({ error: 'Nie ma takiej kopii.' });
  const snap = await snapshotRead(name).catch(() => null);
  if (!snap?.data) return res.status(404).json({ error: 'Nie udało się odczytać kopii.' });
  // Najpierw kopia stanu obecnego: pomylkowe przywrocenie da sie cofnac.
  await makeSnapshot('manual');
  const cur = memory.load();
  const keep = { pushSubscriptions: cur.pushSubscriptions, googleRefreshToken: cur.googleRefreshToken, snapshots: cur.snapshots };
  memory.save({ ...cur, ...snap.data, ...keep });
  await memory.flush();
  res.json({ ok: true, restored: name });
});

export default router;
