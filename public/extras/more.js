// Domkniecie listy: zadania z priorytetem i ostatnie pliki na Pulpicie, rdzen pulsujacy z muzyka,
// stoper sterowany glosem oraz dyktowanie notatki skrotem (Ctrl+Alt+D w aplikacji desktopowej).
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.addHomeWidget) return;
  const { el, api, toast, isOwner, store, authHeaders } = UI;
  const D = () => window.jarvisDesktop;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- zadania z priorytetem ----------
  const PRIO = ['', '!', '!!', '!!!'];
  UI.addHomeWidget({
    id: 'tasks-prio',
    title: 'Zadania wg priorytetu',
    glyph: '⚑',
    owner: true,
    every: 60000,
    async render(box) {
      const r = await api('/api/todos').catch(() => ({ todos: [] }));
      const open = (r.todos || []).filter((t) => !t.done).sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.createdAt || 0) - (b.createdAt || 0));
      box.innerHTML = '';
      if (!open.length) {
        box.appendChild(el('div', 'w-empty', 'Brak otwartych zadań.'));
        return;
      }
      const list = el('div', 'w-list');
      open.slice(0, 7).forEach((t) => {
        const row = el('div', 'it');
        const p = el('button', `prio-btn p${t.priority || 0}`, PRIO[t.priority || 0] || '·');
        p.title = 'Zmień priorytet';
        p.addEventListener('click', async () => {
          await api(`/api/todos/${t.id}`, json('PATCH', { priority: ((t.priority || 0) + 1) % 4 }));
          this.render(box);
        });
        const txt = el('span', null, t.text);
        txt.style.flex = '1';
        const ok = el('button', 'row-x', '✓');
        ok.title = 'Zrobione';
        ok.addEventListener('click', async () => {
          await api(`/api/todos/${t.id}`, json('PATCH', { done: true }));
          UI.activity?.emit('dane', `Zakończono zadanie: ${t.text}`);
          this.render(box);
        });
        row.append(p, txt, ok);
        list.appendChild(row);
      });
      box.appendChild(list);
      if (open.length > 7) box.appendChild(el('div', 'w-dim', `i ${open.length - 7} więcej`));
    },
  });

  // ---------- ostatnie pliki (z historii Windows) ----------
  UI.addHomeWidget({
    id: 'recent-files',
    title: 'Ostatnie pliki',
    glyph: '🗎',
    owner: true,
    every: 120000,
    async render(box) {
      box.innerHTML = '';
      if (!D()) {
        box.appendChild(el('div', 'w-empty', 'Lista plików działa w aplikacji desktopowej.'));
        return;
      }
      const r = await D().runAction('ostatnie-pliki', { limit: 8 }).catch(() => null);
      if (!r || !r.ok) {
        box.appendChild(el('div', 'w-empty', r?.error ? String(r.error) : 'Zaktualizuj aplikację desktopową, żeby zobaczyć listę.'));
        return;
      }
      const list = el('div', 'w-list');
      r.files.forEach((f) => {
        const row = el('div', 'it');
        const when = new Date(f.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
        row.append(el('span', null, f.name), el('span', 'w-dim', when));
        list.appendChild(row);
      });
      if (!r.files.length) list.appendChild(el('div', 'w-empty', 'Brak.'));
      box.appendChild(list);
    },
  });

  // ---------- rdzen pulsuje, gdy gra muzyka ----------
  // Spotify nie daje surowego dzwieku ani tempa, wiec to staly rytm ok. 120 uderzen na minute, nie analiza utworu.
  let pulseOn = false;
  function musicPulse(now) {
    if (!pulseOn) return;
    requestAnimationFrame(musicPulse);
    const beat = Math.pow(Math.max(0, Math.sin((now / 1000) * Math.PI * 2)), 6);
    store.audioLevel = Math.max(store.audioLevel || 0, 0.12 + beat * 0.3);
  }
  window.addEventListener('jarvis:now-playing', () => {
    const playing = Boolean(UI.nowPlaying?.playing);
    if (playing && !pulseOn) {
      pulseOn = true;
      requestAnimationFrame(musicPulse);
    } else if (!playing) {
      pulseOn = false;
    }
  });

  // ---------- stoper glosem (wspolny stan z widzetem i palecia) ----------
  const fmtSw = (ms) => {
    const s = Math.floor(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  };
  if (UI.clientActions) {
    UI.clientActions.stoper = async (p) => {
      const sw = (window.__stopwatch = window.__stopwatch || { run: false, start: 0, acc: 0, laps: [] });
      const cur = () => sw.acc + (sw.run ? Date.now() - sw.start : 0);
      const a = String(p?.akcja || p?.raw || 'start').toLowerCase();
      let msg;
      if (/zeruj|reset/.test(a)) {
        sw.run = false;
        sw.acc = 0;
        sw.laps = [];
        msg = 'Stoper wyzerowany.';
      } else if (/stop|pauz|zatrzym/.test(a)) {
        sw.acc = cur();
        sw.run = false;
        msg = `Stoper zatrzymany: ${fmtSw(sw.acc)}.`;
      } else if (/odczyt|ile|czas/.test(a)) {
        msg = `Stoper pokazuje ${fmtSw(cur())}.`;
      } else {
        if (!sw.run) {
          sw.start = Date.now();
          sw.run = true;
        }
        msg = 'Stoper ruszył.';
      }
      toast(msg, 'ok');
      // W rozmowie Jarvis dostaje wynik i powie go sam; poza nia czytamy.
      if (UI.isLive?.()) UI.liveSend({ type: 'react', text: msg });
      else if (/zatrzymany|pokazuje/.test(msg)) UI.speak?.(msg);
      return { ok: true, msg };
    };
  }

  // ---------- dyktowanie notatki ----------
  let rec = null;
  async function dictate() {
    if (!isOwner()) return;
    if (rec) {
      rec.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('Brak dostępu do mikrofonu.');
      return;
    }
    const chunks = [];
    const r = new MediaRecorder(stream);
    rec = r;
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const limit = setTimeout(() => r.state === 'recording' && r.stop(), 30000);
    r.onstop = async () => {
      clearTimeout(limit);
      rec = null;
      stream.getTracks().forEach((t) => t.stop());
      document.body.classList.remove('dictating');
      try {
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        const data = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(',')[1]);
          fr.readAsDataURL(blob);
        });
        toast('Przepisuję notatkę...', 'ok');
        const out = await fetch('/api/transcribe', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ data, mimeType: blob.type }) }).then(async (x) => {
          const d = await x.json().catch(() => ({}));
          if (!x.ok) throw new Error(d.error || `Błąd ${x.status}`);
          return d;
        });
        if (!out.text) {
          toast('Nie usłyszałem żadnej treści.');
          return;
        }
        await UI.life.add('quicknotes', { text: out.text });
        toast(`Notatka: ${out.text.slice(0, 70)}`, 'ok');
      } catch (e) {
        toast(e.message || 'Nie udało się przepisać notatki.');
      }
    };
    r.start();
    document.body.classList.add('dictating');
    toast('Dyktuj. Drugie naciśnięcie kończy (albo po 30 s).', 'ok');
    window.SFX?.play?.('tap');
  }
  UI.dictate = dictate;
  window.addEventListener('jarvis:ready', () => {
    D()?.onCommand?.((c) => {
      if (c?.type === 'dictate') dictate();
    });
  });
})();
