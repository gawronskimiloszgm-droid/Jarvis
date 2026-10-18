import { Router } from 'express';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import { judge } from './edithPolicy.js';

const DAY = 24 * 60 * 60 * 1000;
const router = Router();

function bag() {
  const data = memory.load();
  if (!data.edith || typeof data.edith !== 'object') {
    data.edith = { alerts: [], scans: [], lastReportAt: 0, blocks: 0 };
  }
  return data.edith;
}

function remember() {
  memory.save(memory.load());
}

function pushAlert(title, body) {
  push.sendToAll({ title, body }).catch((err) => {
    console.error('E.D.I.T.H. nie wyslala powiadomienia:', err.message);
  });
}

export function recordBlock(verdict) {
  const state = bag();
  state.blocks = (state.blocks || 0) + 1;
  state.alerts.unshift({
    at: Date.now(),
    level: 'block',
    reason: verdict.reason,
    command: verdict.command || verdict.action || '',
  });
  state.alerts = state.alerts.slice(0, 80);
  remember();
  pushAlert('E.D.I.T.H. — blokada', verdict.reason);
}

export function reviewAction(action, command) {
  const verdict = judge(action, command);
  if (!verdict.allow) recordBlock(verdict);
  return verdict;
}

export function ingestScan(scan) {
  const state = bag();
  const entry = {
    at: Date.now(),
    ok: Boolean(scan?.ok),
    summary: String(scan?.summary || '').slice(0, 500),
    defender: scan?.defender || null,
    firewall: scan?.firewall || null,
  };
  state.scans.unshift(entry);
  state.scans = state.scans.slice(0, 14);
  remember();

  const weak = [];
  if (entry.defender && entry.defender.RealTimeProtectionEnabled === false) weak.push('ochrona w czasie rzeczywistym jest wylaczona');
  if (entry.defender && entry.defender.AntivirusEnabled === false) weak.push('antywirus jest wylaczony');
  const fw = Array.isArray(entry.firewall) ? entry.firewall : [];
  if (fw.some((p) => p && p.Enabled === false)) weak.push('ktorys profil zapory jest wylaczony');
  if (weak.length) {
    state.alerts.unshift({ at: Date.now(), level: 'warn', reason: weak.join('; '), command: '' });
    state.alerts = state.alerts.slice(0, 80);
    remember();
    pushAlert('E.D.I.T.H. — slaba ochrona', weak.join('; '));
  }
  return entry;
}

export function buildReport() {
  const state = bag();
  const since = Date.now() - DAY;
  const recentBlocks = (state.alerts || []).filter((a) => a.at >= since && a.level === 'block');
  const lastScan = state.scans?.[0] || null;
  const lines = [];
  lines.push(lastScan ? `Ostatni skan: ${lastScan.summary || 'wykonany'}` : 'Brak skanu z tego komputera. Otworz aplikacje Jarvisa na Windowsie.');
  lines.push(`Zablokowane dzialania z ostatniej doby: ${recentBlocks.length}.`);
  if (recentBlocks[0]) lines.push(`Ostatnia blokada: ${recentBlocks[0].reason}`);
  return {
    at: Date.now(),
    text: lines.join(' '),
    blocks: recentBlocks.length,
    lastScan,
  };
}

export async function maybeDailyReport() {
  const state = bag();
  if (Date.now() - (state.lastReportAt || 0) < DAY) return null;
  state.lastReportAt = Date.now();
  remember();
  const report = buildReport();
  pushAlert('E.D.I.T.H. — raport dobowy', report.text);
  state.alerts.unshift({ at: Date.now(), level: 'report', reason: report.text, command: '' });
  state.alerts = state.alerts.slice(0, 80);
  remember();
  console.log('E.D.I.T.H. raport dobowy wyslany');
  return report;
}

router.post('/api/edith/review', requireOwner, (req, res) => {
  const verdict = reviewAction(req.body?.action, req.body?.command);
  res.json(verdict);
});

router.get('/api/edith/state', requireOwner, (req, res) => {
  const state = bag();
  res.json({
    alerts: state.alerts || [],
    scans: state.scans || [],
    blocks: state.blocks || 0,
    lastReportAt: state.lastReportAt || 0,
    report: buildReport(),
  });
});

router.post('/api/edith/scan', requireOwner, (req, res) => {
  res.json({ ok: true, scan: ingestScan(req.body || {}) });
});

router.post('/api/edith/report', requireOwner, async (req, res) => {
  const report = buildReport();
  const state = bag();
  state.lastReportAt = Date.now();
  state.alerts.unshift({ at: Date.now(), level: 'report', reason: report.text, command: '' });
  state.alerts = state.alerts.slice(0, 80);
  remember();
  pushAlert('E.D.I.T.H. — raport', report.text);
  res.json(report);
});

export default router;
