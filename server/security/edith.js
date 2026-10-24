import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import { withModel } from '../core/geminiChain.js';
import { judge } from './edithPolicy.js';

const DAY = 24 * 60 * 60 * 1000;
const router = Router();

function bag() {
  const data = memory.load();
  if (!data.edith || typeof data.edith !== 'object') {
    data.edith = { alerts: [], scans: [], lastReportAt: 0, blocks: 0, talk: [] };
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
    killedThreats: Array.isArray(scan?.killedThreats) ? scan.killedThreats.slice(0, 20) : [],
    suspiciousProcesses: Array.isArray(scan?.suspiciousProcesses) ? scan.suspiciousProcesses.slice(0, 20) : [],
    startupNew: Array.isArray(scan?.startupNew) ? scan.startupNew.slice(0, 20) : [],
    listeningNew: Array.isArray(scan?.listeningNew) ? scan.listeningNew.slice(0, 20) : [],
    defenderThreats: Array.isArray(scan?.defenderThreats) ? scan.defenderThreats.slice(0, 20) : [],
    defenderSignatureAgeDays: Number.isFinite(scan?.defenderSignatureAgeDays) ? scan.defenderSignatureAgeDays : null,
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

  // Odciete zagrozenie to zawsze alert najwyzszego poziomu - to jedyny
  // przypadek, w ktorym E.D.I.T.H. juz cos zrobila sama, bez pytania.
  if (entry.killedThreats.length) {
    const reason = `Odcieto rozpoznane zagrozenie: ${entry.killedThreats.join(', ')}.`;
    state.alerts.unshift({ at: Date.now(), level: 'block', reason, command: '' });
    state.alerts = state.alerts.slice(0, 80);
    remember();
    pushAlert('E.D.I.T.H. — zagrozenie odciete', reason);
  }
  const finding = (reason, title, level = 'warn') => {
    state.alerts.unshift({ at: Date.now(), level, reason, command: '' });
    state.alerts = state.alerts.slice(0, 80);
    remember();
    pushAlert(title, reason);
  };
  if (entry.defenderThreats.length) {
    finding(`Windows Defender wykryl: ${entry.defenderThreats.map((t) => `${t.threat}${t.remediated ? ' (usuniete)' : ' (NIEUSUNIETE)'}`).join(', ')}.`, 'E.D.I.T.H. — wykrycie Defendera', 'block');
  }
  if (entry.startupNew.length) {
    finding(`Nowe wpisy autostartu: ${entry.startupNew.map((i) => `${i.name} (${i.command})`).join('; ')}. Jesli to nie Ty - sprawdz.`, 'E.D.I.T.H. — nowy autostart');
  }
  if (entry.listeningNew.length) {
    finding(`Nowe procesy nasluchujace w sieci: ${entry.listeningNew.map((l) => `${l.process}:${l.port}`).join(', ')}.`, 'E.D.I.T.H. — nowy nasluch w sieci');
  }
  if (entry.defenderSignatureAgeDays > 7) {
    finding(`Sygnatury Defendera maja ${entry.defenderSignatureAgeDays} dni - zaktualizuj.`, 'E.D.I.T.H. — nieaktualne sygnatury');
  }
  if (entry.suspiciousProcesses.length) {
    const reason = `Do przejrzenia (bardzo wysokie zuzycie procesora): ${entry.suspiciousProcesses.join(', ')}.`;
    state.alerts.unshift({ at: Date.now(), level: 'warn', reason, command: '' });
    state.alerts = state.alerts.slice(0, 80);
    remember();
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

export const EDITH_VOICE = `Jestes E.D.I.T.H. Osobna od Jarvisa. Nie jestes Jarvisem i nie udajesz go.
Mowisz krotko, konkretnie, po polsku. Ton suchy, czujny, bez zartow i bez "sir".
Twoja praca to bezpieczenstwo: wirusy, wycieki, dziwne polecenia, blokady, skany, raport dobowy.
Nie wykonujesz polecen na komputerze. Jesli ktos prosi o cos groznego, odmawiasz i mowisz dlaczego.
Nie zapisujesz faktow do pamieci Jarvisa. Nie przejmujesz jego zadan ani kalendarza.
Jesli pytanie nie dotyczy ochrony, odpowiadasz jednym zdaniem i wracasz do tematu bezpieczenstwa.`;

// Wlasny klucz API dla E.D.I.T.H. - oddzielny od tego, ktorym rozmawia
// Jarvis. Celowo osobny budzet/limit zapytan, zeby intensywna rozmowa z
// jednym z nich nie zjadala limitu drugiemu. Jesli nie ustawiono
// EDITH_GEMINI_API_KEY, Edith po prostu dzieli klucz z Jarvisem (dziala
// od razu, bez dodatkowej konfiguracji).
export function edithApiKey() {
  return process.env.EDITH_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
}

export async function edithReply(message) {
  const state = bag();
  const talk = Array.isArray(state.talk) ? state.talk : [];
  const history = talk.slice(-12).map((t) => ({
    role: t.role === 'edith' ? 'model' : 'user',
    parts: [{ text: String(t.text || '') }],
  }));
  const ai = new GoogleGenAI({ apiKey: edithApiKey() });
  const report = buildReport();
  const res = await withModel((model) =>
    ai.models.generateContent({
      model,
      contents: [...history, { role: 'user', parts: [{ text: message }] }],
      config: {
        systemInstruction: `${EDITH_VOICE}\n\nAktualny stan: ${report.text}`,
      },
    })
  );
  const text = String(res.text || '').trim() || 'Nie mam teraz odpowiedzi.';
  talk.push({ role: 'user', text: message.slice(0, 2000), at: Date.now() });
  talk.push({ role: 'edith', text: text.slice(0, 4000), at: Date.now() });
  state.talk = talk.slice(-40);
  remember();
  return text;
}

router.post('/api/edith/chat', requireOwner, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Brak wiadomosci.' });
  if (!edithApiKey()) return res.status(500).json({ error: 'Brak klucza AI.' });
  try {
    const text = await edithReply(message);
    res.json({ text });
  } catch (err) {
    console.error('E.D.I.T.H. rozmowa:', err.message);
    res.status(500).json({ error: 'Edith nie odpowiedziala.' });
  }
});

export default router;
