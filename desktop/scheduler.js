// Zadania cykliczne NA TYM KOMPUTERZE ("co piatek o 17:00 posprzataj Pobrane").
//
// Dzialaja w aplikacji desktopowej, a nie na serwerze - bo tylko ona moze
// cokolwiek zrobic na dysku, a serwer na Renderze nie ma jak siegnac do PC.
// Kazde zadanie to zwykla akcja z actions.js, wiec przechodzi przez
// E.D.I.T.H. tak samo jak reczne polecenie; jesli E.D.I.T.H. zazada zgody,
// zadanie jest POMIJANE i uzytkownik dostaje powiadomienie (nikt nie siedzi
// przy komputerze, zeby kliknac "tak" o 3 w nocy).

const { Notification } = require('electron');
const settings = require('./settings');

let runActionFn = null;
let timer = null;
let notify = () => {};

const DAY_NAMES = { pn: 1, wt: 2, sr: 3, cz: 4, pt: 5, so: 6, nd: 0 };

function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return days
    .map((d) => (typeof d === 'number' ? d : DAY_NAMES[String(d).toLowerCase().slice(0, 2)]))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

function due(task, now) {
  const [h, m] = String(task.at || '').split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
  if (now.getHours() !== h || now.getMinutes() !== m) return false;
  const days = normalizeDays(task.days);
  if (days.length && !days.includes(now.getDay())) return false;
  const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${h}:${m}`;
  return task.lastRun !== stamp;
}

async function tick() {
  if (!runActionFn) return;
  const tasks = settings.get('tasks') || [];
  const now = new Date();
  let changed = false;
  for (const t of tasks) {
    if (!t.enabled && t.enabled !== undefined) continue;
    if (!due(t, now)) continue;
    t.lastRun = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
    changed = true;
    let r;
    try {
      r = await runActionFn(t.action, t.params || {}, {});
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    const verdict = r?.requiresEdithConfirmation
      ? `pominiete - E.D.I.T.H. wymaga potwierdzenia (${r.warning || r.reason})`
      : r?.blocked
        ? `zablokowane przez E.D.I.T.H.: ${r.edithReason}`
        : r?.ok === false
          ? `blad: ${r.error || 'nie udalo sie'}`
          : 'wykonane';
    t.lastResult = verdict;
    notify(`Zadanie "${t.name}"`, verdict);
  }
  if (changed) settings.set('tasks', tasks);
}

function init(runAction, notifyFn) {
  runActionFn = runAction;
  notify =
    notifyFn ||
    ((title, body) => {
      try {
        new Notification({ title, body }).show();
      } catch {
        /* powiadomienia moga byc wylaczone w systemie */
      }
    });
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), 20 * 1000);
  timer.unref?.();
}

function make() {
  return {
    'zadania-lista': async () => ({ ok: true, zadania: settings.get('tasks') || [] }),
    'zadania-dodaj': async (p) => {
      const at = String(p.godzina || p.at || '').trim();
      if (!/^\d{1,2}:\d{2}$/.test(at)) return { ok: false, error: 'Podaj godzine w formacie HH:MM.' };
      const action = String(p.akcja || p.action || '').trim();
      if (!action) return { ok: false, error: 'Podaj akcje do wykonania.' };
      const tasks = settings.get('tasks') || [];
      if (tasks.length >= 30) return { ok: false, error: 'Za duzo zadan (limit 30).' };
      const task = {
        id: Math.random().toString(36).slice(2, 9),
        name: String(p.nazwa || p.name || action).slice(0, 60),
        at,
        days: normalizeDays(p.dni || p.days),
        action,
        params: p.parametry || p.params || {},
        enabled: true,
      };
      tasks.push(task);
      settings.set('tasks', tasks);
      return { ok: true, zadanie: task };
    },
    'zadania-usun': async (p) => {
      const tasks = (settings.get('tasks') || []).filter((t) => t.id !== p.id && t.name !== p.nazwa);
      settings.set('tasks', tasks);
      return { ok: true, pozostalo: tasks.length };
    },
  };
}

module.exports = { init, make, due, normalizeDays };
