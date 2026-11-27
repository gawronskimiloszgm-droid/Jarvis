// Poranny telefon: Jarvis "dzwoni" o ustawionej godzinie (powiadomienie, ktore dzwoni i wibruje, a w
// aplikacji na Androida pelnoekranowe polaczenie przychodzace) i po odebraniu mowi raport z nocy.
// W nocy (ok. godzine przed pobudka) sam przeglada poczte: kategorie, nastroj nadawcy i szkice
// odpowiedzi czekajace rano na zatwierdzenie. Niczego nie wysyla: maile idza dopiero po
// kliknieciu WYSLIJ (trasa /api/comms/gmail/send z confirm:true).
import crypto from 'node:crypto';
import express from 'express';
import { requireOwner } from '../core/auth.js';
import * as memory from '../memory/memory.js';
import * as push from '../connect/push.js';
import * as gmailClient from '../connect/gmailClient.js';
import { buildBrief } from '../core/briefing.js';
import { lifeList, logJournal } from './life.js';

const router = express.Router();
// nativeAlarm: dzwoni budzik aplikacji na Androidzie, wiec serwer nie wysyla wlasnych powiadomien.
const DEFAULTS = { enabled: false, time: '06:00', days: [1, 2, 3, 4, 5], sleepFrom: '22:30', rings: 3, snoozeMin: 10, nightWork: true, nativeAlarm: false };
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

function store() {
  const d = memory.load();
  if (!d.night || typeof d.night !== 'object') d.night = {};
  return d.night;
}
export function wakeSettings(patch) {
  const n = store();
  const cur = { ...DEFAULTS, ...(n.settings || {}) };
  if (patch) {
    if (patch.enabled != null) cur.enabled = Boolean(patch.enabled);
    if (HM.test(String(patch.time || ''))) cur.time = patch.time;
    if (HM.test(String(patch.sleepFrom || ''))) cur.sleepFrom = patch.sleepFrom;
    if (Array.isArray(patch.days)) cur.days = [...new Set(patch.days.map(Number).filter((x) => x >= 0 && x <= 6))].sort();
    if (patch.rings != null) cur.rings = Math.max(1, Math.min(5, Math.round(Number(patch.rings) || 3)));
    if (patch.snoozeMin != null) cur.snoozeMin = Math.max(3, Math.min(30, Math.round(Number(patch.snoozeMin) || 10)));
    if (patch.nightWork != null) cur.nightWork = Boolean(patch.nightWork);
    if (patch.nativeAlarm != null) cur.nativeAlarm = Boolean(patch.nativeAlarm);
    n.settings = cur;
    memory.save(memory.load());
    schedule();
  }
  return cur;
}

// ---------- czas warszawski ----------
const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Chwila (ms) o danej godzinie warszawskiej w dniu, w ktorym wypada `ms`. */
function warsawAt(ms, hm) {
  const p = parts(ms);
  const guess = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(hm.slice(0, 2)), Number(hm.slice(3)));
  const q = parts(guess);
  const shown = Date.UTC(Number(q.year), Number(q.month) - 1, Number(q.day), Number(q.hour), Number(q.minute));
  return guess - (shown - guess);
}
/** Najblizszy telefon po `now` (w wybrane dni tygodnia), albo null. */
export function nextCall(now = Date.now(), s = wakeSettings()) {
  if (!s.enabled || !s.days.length) return null;
  for (let i = 0; i < 8; i++) {
    const at = warsawAt(now + i * 86400000, s.time);
    if (at > now && s.days.includes(DOW[parts(at).weekday])) return at;
  }
  return null;
}
/** Od kiedy liczyc "noc": wczorajsza pora snu (albo dzisiejsza, gdy juz minela przed telefonem). */
export function nightStart(callAt, s = wakeSettings()) {
  let at = warsawAt(callAt, s.sleepFrom);
  if (at >= callAt) at = warsawAt(callAt - 86400000, s.sleepFrom);
  return at;
}

// ---------- praca w nocy ----------
const fmtHM = (ms) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
/** Odmiana: 1 mail, 2-4 maile (ale 12-14 maili), 5+ maili. */
export const pl = (n, one, few, many) => `${n} ${n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many}`;
const nameOf = (from) => String(from || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || String(from || '');

/** Przeglad maili z nocy: klasyfikacja, nastroj i szkice odpowiedzi (do zatwierdzenia rano). */
export async function nightWork({ since, deps = {} } = {}) {
  const gmail = deps.gmail || gmailClient;
  const triage = deps.triage || (await import('./mailtriage.js'));
  const n = store();
  const out = { at: Date.now(), since, mail: null };
  if (gmail.isOAuthConfigured() && gmail.isConnected()) {
    const recent = (await gmail.listRecentInboxMessages(25)).filter((m) => !since || (Date.parse(m.date) || 0) >= since);
    const items = recent.length ? await triage.classifyMessages(recent) : [];
    const needReply = items.filter((x) => x.kategoria === 'pilny' || x.kategoria === 'odpowiedz');
    const drafts = [];
    for (const item of needReply.slice(0, 6)) {
      try {
        const d = await triage.draftReply(item);
        drafts.push({ id: crypto.randomBytes(6).toString('hex'), mailId: item.id, from: item.from, subject: item.subject, summary: item.streszczenie, angry: item.nastroj === 'zdenerwowany', urgent: item.kategoria === 'pilny', ...d, status: 'czeka' });
      } catch {
        /* szkic jest dodatkiem: mail i tak jest w raporcie */
      }
    }
    out.mail = {
      count: items.length,
      byCat: Object.fromEntries(['pilny', 'odpowiedz', 'info', 'spam'].map((k) => [k, items.filter((x) => x.kategoria === k).length])),
      urgent: items.filter((x) => x.kategoria === 'pilny').map((x) => ({ from: nameOf(x.from), subject: x.subject, summary: x.streszczenie })),
      angry: items.filter((x) => x.nastroj === 'zdenerwowany').map((x) => ({ from: nameOf(x.from), subject: x.subject, summary: x.streszczenie })),
      needReply: needReply.map((x) => ({ from: nameOf(x.from), subject: x.subject, summary: x.streszczenie })),
    };
    n.drafts = [...drafts, ...(n.drafts || []).filter((x) => x.status === 'czeka')].slice(0, 12);
  }
  n.work = out;
  memory.save(memory.load());
  return out;
}

/** Raport "gdy spales": poczta z pracy nocnej, wazne wpisy z dziennika, odprawa poranna. */
export async function nightReport({ now = Date.now(), deps = {} } = {}) {
  const s = wakeSettings();
  const since = nightStart(now + 60000, s);
  const n = store();
  const work = n.work && n.work.at >= since ? n.work : null;
  const events = lifeList('journal')
    .filter((j) => j.at >= since && (j.kind === 'alert' || (j.kind === 'auto' && /trening|kawa|drukark|wydruk|hevy|edith/i.test(`${j.tag} ${j.text}`))))
    .slice(0, 8)
    .map((j) => ({ at: j.at, kind: j.kind, text: j.text }));
  const brief = await (deps.buildBrief || buildBrief)('morning').catch(() => '');
  const lines = [];
  const m = work?.mail;
  if (m) {
    if (!m.count) lines.push('W nocy nie przyszedł żaden mail.');
    else {
      lines.push(`W nocy ${m.count === 1 ? 'przyszedł' : [2, 3, 4].includes(m.count % 10) && ![12, 13, 14].includes(m.count % 100) ? 'przyszły' : 'przyszło'} ${pl(m.count, 'mail', 'maile', 'maili')}: ${[m.byCat.pilny && pl(m.byCat.pilny, 'pilny', 'pilne', 'pilnych'), m.byCat.odpowiedz && `${pl(m.byCat.odpowiedz, 'czeka', 'czekają', 'czeka')} na odpowiedź`, m.byCat.info && `${m.byCat.info} do wiadomości`, m.byCat.spam && pl(m.byCat.spam, 'reklama', 'reklamy', 'reklam')].filter(Boolean).join(', ')}.`);
      const drafts = (n.drafts || []).filter((x) => x.status === 'czeka').length;
      if (drafts) lines.push(`Przygotowałem ${pl(drafts, 'szkic', 'szkice', 'szkiców')} odpowiedzi, ${drafts === 1 ? 'czeka' : 'czekają'} na Twoje zatwierdzenie.`);
      lines.push(m.angry.length ? `Ktoś jest niezadowolony: ${m.angry.map((x) => `${x.from} (${x.subject})`).join('; ')}.` : 'Nikt nie jest na Ciebie zły.');
      if (m.urgent.length) lines.push(`Pilne: ${m.urgent.slice(0, 3).map((x) => `${x.from}: ${x.summary}`).join(' ')}`);
    }
  }
  const alerts = events.filter((e) => e.kind === 'alert');
  if (alerts.length) lines.push(`Alarmy w nocy: ${alerts.slice(0, 3).map((e) => `${fmtHM(e.at)} ${e.text}`).join('; ')}.`);
  const other = events.filter((e) => e.kind !== 'alert');
  if (other.length) lines.push(`Poza tym: ${other.slice(0, 3).map((e) => e.text).join('; ')}.`);
  const quiet = !alerts.length && !(m && (m.urgent.length || m.angry.length));
  if (quiet) lines.push(`Od ${fmtHM(since)} nic nie wymagało Twojej uwagi.`);
  if (brief) lines.push(brief);
  return { since, quiet, mail: m, drafts: (n.drafts || []).filter((x) => x.status === 'czeka'), events, brief, text: lines.join(' ') };
}

// ---------- telefon ----------
let timer = null;
const rings = new Map(); // id dzwonienia -> { at, n, answered }

/** Jeden "sygnal": powiadomienie, ktore wibruje i otwiera ekran polaczenia. */
async function ring(callId, n, total) {
  if (!push.isConfigured()) return;
  await push.sendToAll({
    title: 'J.A.R.V.I.S. dzwoni',
    body: n === 1 ? 'Raport poranny. Dotknij, żeby odebrać.' : `Raport poranny (${n}/${total}). Dotknij, żeby odebrać.`,
    tag: 'jarvis-call',
    renotify: true,
    requireInteraction: true,
    vibrate: [1000, 500, 1000, 500, 1000, 500, 1000],
    data: { url: `/?call=morning&id=${callId}` },
  }).catch(() => {});
}

/** Dzwonienie: pierwszy sygnal od razu, kolejne co 2 minuty, dopoki nikt nie odbierze. */
export async function startCall({ reason = 'pobudka', now = Date.now() } = {}) {
  const s = wakeSettings();
  const id = crypto.randomBytes(6).toString('hex');
  const c = { at: now, n: 0, answered: false, reason };
  rings.set(id, c);
  for (const [k, v] of rings) if (now - v.at > 3600000) rings.delete(k);
  const next = async () => {
    if (c.answered || c.n >= s.rings) return;
    c.n++;
    await ring(id, c.n, s.rings);
    if (c.n < s.rings) setTimeout(next, 120000).unref?.();
  };
  await next();
  store().lastCall = { id, at: now, reason };
  memory.save(memory.load());
  return id;
}
export function answerCall(id) {
  const c = rings.get(String(id || ''));
  if (c) c.answered = true;
  store().lastAnswered = Date.now();
  memory.save(memory.load());
  return Boolean(c);
}

/** Planowanie: praca nocna godzine przed telefonem, sam telefon co do minuty (plus zapas w petli utrzymania). */
export function schedule(now = Date.now()) {
  clearTimeout(timer);
  const at = nextCall(now);
  if (!at) return null;
  const delay = Math.min(at - now, 6 * 3600000); // dlugie odliczanie dzielimy, zeby zegar nie odplywal
  timer = setTimeout(() => {
    if (Date.now() >= at - 30000) fireIfDue().catch((e) => console.error('Poranny telefon:', e.message));
    schedule();
  }, Math.max(1000, delay));
  timer.unref?.();
  return at;
}

/** Z petli utrzymania i z zegara: praca nocna w oknie przed telefonem, telefon raz na dzien. */
export async function fireIfDue(now = Date.now()) {
  const s = wakeSettings();
  const n = store();
  if (!s.enabled) return null;
  const today = `${parts(now).year}-${parts(now).month}-${parts(now).day}`;
  const callAt = warsawAt(now, s.time);
  const dayOk = s.days.includes(DOW[parts(now).weekday]);
  if (dayOk && s.nightWork && n.workDay !== today && now >= callAt - 75 * 60000 && now < callAt) {
    n.workDay = today;
    await nightWork({ since: nightStart(callAt, s) }).catch((e) => console.error('Praca nocna:', e.message));
  }
  if (dayOk && n.callDay !== today && now >= callAt && now - callAt < 20 * 60000) {
    n.callDay = today;
    memory.save(memory.load());
    if (s.nightWork && n.workDay !== today) await nightWork({ since: nightStart(callAt, s) }).catch(() => {});
    logJournal('auto', `Poranny telefon o ${fmtHM(now)}`, 'pobudka');
    if (s.nativeAlarm) return 'telefon'; // dzwoni budzik w telefonie
    return startCall({ now });
  }
  return null;
}

// ---------- trasy ----------
router.get('/api/wake/settings', requireOwner, (req, res) => res.json({ ...wakeSettings(), next: nextCall(), pushReady: push.isConfigured(), gmail: gmailClient.isOAuthConfigured() && gmailClient.isConnected() }));
router.put('/api/wake/settings', requireOwner, (req, res) => res.json({ ...wakeSettings(req.body || {}), next: nextCall() }));
router.get('/api/wake/report', requireOwner, async (req, res) => {
  try {
    res.json(await nightReport());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/api/wake/answer', requireOwner, (req, res) => res.json({ ok: answerCall(req.body?.id) }));
router.post('/api/wake/snooze', requireOwner, (req, res) => {
  answerCall(req.body?.id);
  const min = wakeSettings().snoozeMin;
  setTimeout(() => startCall({ reason: 'drzemka' }).catch(() => {}), min * 60000).unref?.();
  res.json({ ok: true, min });
});
// Proba: telefon za chwile, bez czekania do rana.
router.post('/api/wake/test', requireOwner, async (req, res) => {
  if (!push.isConfigured()) return res.status(400).json({ error: 'Powiadomienia push nie są skonfigurowane na serwerze (VAPID).' });
  res.json({ ok: true, id: await startCall({ reason: 'proba' }) });
});
router.post('/api/wake/night-work', requireOwner, async (req, res) => {
  try {
    res.json(await nightWork({ since: nightStart(Date.now() + 60000) }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.get('/api/wake/drafts', requireOwner, (req, res) => res.json({ drafts: (store().drafts || []).filter((x) => x.status === 'czeka') }));
// Zatwierdzony szkic wysyla klient przez /api/comms/gmail/send (confirm:true); tu tylko zmiana stanu.
router.post('/api/wake/drafts/:id', requireOwner, (req, res) => {
  const d = (store().drafts || []).find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Nie ma takiego szkicu.' });
  if (['wyslany', 'odrzucony'].includes(req.body?.status)) d.status = req.body.status;
  memory.save(memory.load());
  res.json({ ok: true });
});

// ---------- glos ----------
export const NIGHT_TOOLS = [
  {
    name: 'raport_nocny',
    description: 'Co sie dzialo, gdy uzytkownik spal: maile z nocy (ile, pilne, kto jest zdenerwowany, szkice odpowiedzi czekajace na zatwierdzenie), alarmy i wpisy z dziennika, plus odprawa poranna. Uzywaj przy porannym telefonie i pytaniach "co w nocy", "czy ktos jest zly", "co z mailami".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'poranny_telefon',
    description: 'Ustaw poranny telefon od Jarvisa: godzina HH:MM, dni (0=niedziela..6=sobota), wlaczony true/false.',
    parameters: { type: 'object', properties: { godzina: { type: 'string' }, dni: { type: 'array', items: { type: 'number' } }, wlaczony: { type: 'boolean' } } },
  },
];
export const NIGHT_VOICE_PROMPT = '- raport_nocny: przy porannym telefonie i "co w nocy". Mow jak w rozmowie telefonicznej: krotko, najwazniejsze najpierw, liczby; szkice maili tylko zapowiedz (wysyla je uzytkownik przyciskiem). poranny_telefon: ustawienie godziny pobudki.';

export async function runNightTool(name, a = {}) {
  if (name === 'raport_nocny') {
    const r = await nightReport();
    return { raport: r.text, szkice: r.drafts.map((d) => `${nameOf(d.from)}: ${d.subject}${d.angry ? ' (zdenerwowany)' : ''}`), spokojna_noc: r.quiet };
  }
  if (name === 'poranny_telefon') {
    const s = wakeSettings({ ...(a.godzina && { time: a.godzina }), ...(Array.isArray(a.dni) && { days: a.dni }), enabled: a.wlaczony !== false });
    const next = nextCall();
    return { ok: true, godzina: s.time, dni: s.days, wlaczony: s.enabled, nastepny: next ? new Date(next).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : null, uwaga: push.isConfigured() ? null : 'powiadomienia push nie sa skonfigurowane na serwerze' };
  }
  return undefined;
}

schedule();

export default router;
