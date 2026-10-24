// Minutniki i tryb skupienia (Pomodoro).
//  - minutnik: odliczanie widoczne na Pulpicie i w naglowku, na koniec dzwiek,
//    komunikat i powiadomienie systemowe (dziala tez przy wlaczonej ciszy).
//  - skupienie: blok pracy (domyslnie 25 min) z "nie przeszkadzac", potem 5 min
//    przerwy i kolejny blok; konczy sie na zyczenie (skupienie 0).
// Stan w localStorage - przezywa przeladowanie strony i restart aplikacji.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { api, toast, pushSaid } = UI;
  const KEY = 'jarvis.timers';
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  let timers = load();
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(timers));
    } catch {
      /* bez localStorage minutniki dzialaja do zamkniecia karty */
    }
    window.dispatchEvent(new Event('jarvis:timers'));
  }

  const id = () => Math.random().toString(36).slice(2, 9);
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };

  function notifyEnd(title, body) {
    window.SFX?.play('ok');
    setTimeout(() => window.SFX?.play('ok'), 450);
    toast(body, 'ok');
    pushSaid?.('jv', body);
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') new Notification(title, { body });
        else if (Notification.permission !== 'denied') Notification.requestPermission();
      }
    } catch {
      /* powiadomienia systemowe sa dodatkiem */
    }
  }

  function setDnd(minutes) {
    return api('/api/dnd', json({ minutes })).then(() => window.dispatchEvent(new Event('jarvis:dnd'))).catch(() => {});
  }

  function add(t) {
    timers.push(t);
    save();
    return t;
  }

  function remove(tid) {
    const t = timers.find((x) => x.id === tid);
    timers = timers.filter((x) => x.id !== tid);
    if (t && t.kind === 'focus') setDnd(0);
    save();
  }

  function startTimer(minutes, name) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0 || m > 24 * 60) throw new Error('Podaj liczbe minut (1-1440).');
    const t = add({ id: id(), kind: 'timer', name: String(name || '').slice(0, 60), end: Date.now() + m * 60000, total: m * 60000 });
    toast(`Minutnik ${m} min${t.name ? ' - ' + t.name : ''}.`, 'ok');
    return t;
  }

  function startFocus(minutes, cycle = 1) {
    timers = timers.filter((x) => x.kind !== 'focus' && x.kind !== 'break');
    const m = Number(minutes);
    if (!m) {
      save();
      setDnd(0);
      toast('Tryb skupienia zakonczony.', 'ok');
      return null;
    }
    const mins = Math.min(Math.max(m, 1), 180);
    add({ id: id(), kind: 'focus', name: `Skupienie #${cycle}`, end: Date.now() + mins * 60000, total: mins * 60000, mins, cycle });
    setDnd(mins);
    toast(`Skupienie: ${mins} min. Powiadomienia wstrzymane.`, 'ok');
    return true;
  }

  // Jeden zegar dla wszystkich - sprawdza konce co sekunde.
  setInterval(() => {
    const now = Date.now();
    const done = timers.filter((t) => t.end <= now);
    if (!done.length) return;
    timers = timers.filter((t) => t.end > now);
    done.forEach((t) => {
      if (t.kind === 'timer') notifyEnd('Minutnik', `Koniec minutnika${t.name ? ': ' + t.name : ''}.`);
      else if (t.kind === 'focus') {
        notifyEnd('Skupienie', `Koniec bloku pracy (${t.mins} min). 5 minut przerwy.`);
        setDnd(0);
        timers.push({ id: id(), kind: 'break', name: 'Przerwa', end: now + 5 * 60000, total: 5 * 60000, mins: t.mins, cycle: t.cycle });
      } else if (t.kind === 'break') {
        notifyEnd('Skupienie', `Koniec przerwy - blok #${t.cycle + 1}.`);
        timers.push({ id: id(), kind: 'focus', name: `Skupienie #${t.cycle + 1}`, end: now + t.mins * 60000, total: t.mins * 60000, mins: t.mins, cycle: t.cycle + 1 });
        setDnd(t.mins);
      }
    });
    save();
  }, 1000);

  UI.timers = {
    list: () => timers.slice().sort((a, b) => a.end - b.end),
    fmt,
    startTimer,
    startFocus,
    remove,
  };

  UI.clientActions['minutnik'] = (p) => startTimer(p?.minuty, p?.nazwa);
  UI.clientActions['skupienie'] = (p) => startFocus(p?.minuty == null ? 25 : p.minuty);
})();
