// Czujnik zdarzen aplikacji: Jarvis wie, co dzieje sie w programie, i potrafi na to zareagowac.
//
// 1) Rejestr: wszystko, co robisz lub co sie dzieje (otwarte moduly, komunikaty, zmiany danych,
//    gesty, graf, muzyka, kamera, utrata sieci...) trafia do UI.activity przez emit().
// 2) Kontekst: ostatnie zdarzenia leca do Jarvisa jako CICHA notatka [UI] podczas rozmowy na zywo
//    i sa dolaczane do kazdej wiadomosci czatu (UI.activity.recent) - Jarvis "widzi", co robisz.
// 3) Reakcje: przy waznych zdarzeniach Jarvis sam sie odzywa - w rozmowie na zywo model dostaje
//    zdarzenie i odpowiada jednym zdaniem, poza nia mowi gotowa kwestia (tekst + glos). Czestotliwosc
//    ograniczona, nie dziala w trybie ciszy i kina. Poziom: Ustawienia -> REAKCJE JARVISA.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;

  const MAX = 80;
  const buf = [];
  const fmt = (e) => `${new Date(e.t).toLocaleTimeString('pl-PL', { hour12: false })} ${e.kind}: ${e.text}`;

  const get = (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : v;
    } catch {
      return d;
    }
  };
  const level = () => get('jarvis.react', 'zywo'); // off | rzadko | zywo
  const voiceOn = () => get('jarvis.reactVoice', '1') === '1';

  // ---- decyzja: czy Jarvis ma teraz zareagowac (czysta funkcja - testowana osobno) ----
  function decide({ lvl, now, lastAt, important, dnd, cinema, isLive, busy }) {
    if (lvl === 'off') return { react: false, reason: 'wylaczone' };
    if (dnd) return { react: false, reason: 'cisza' };
    if (cinema) return { react: false, reason: 'kino' };
    if (busy) return { react: false, reason: 'Jarvis mowi' };
    const gap = lvl === 'zywo' ? 14000 : 45000;
    if (now - lastAt < gap) return { react: false, reason: 'za szybko' };
    if (lvl === 'rzadko' && !important) return { react: false, reason: 'nieistotne' };
    return { react: true, reason: 'ok', via: isLive ? 'live' : 'local' };
  }

  let lastReactAt = 0;
  let relayQ = [];
  let relayTimer = null;
  const seenModules = new Set();

  function relay(text) {
    if (!UI.isLive || !UI.isLive()) return;
    relayQ.push(text);
    if (relayTimer) return;
    relayTimer = setTimeout(() => {
      relayTimer = null;
      const lines = relayQ.splice(0).slice(-6);
      if (lines.length) UI.liveSend({ type: 'note', text: `[UI] ${lines.join(' | ')}`.slice(0, 900) });
    }, 1500);
  }

  function say(text) {
    UI.pushSaid?.('jv', text);
    if (voiceOn()) UI.speak?.(text);
  }

  // Gotowe kwestie w charakterze filmowego Jarvisa (uzywane, gdy nie trwa rozmowa na zywo).
  const LINES = {
    graph: 'Graf wiedzy gotowy, sir. Pokaz dlon do kamery, a obrocisz go gestem.',
    table: 'Holo-stol rozlozony. Karty mozna przeciagac swobodnie w przestrzeni.',
    cad: 'Stanowisko projektowe gotowe. Podaj wymiary albo opisz, co mam zaprojektowac.',
    machine: 'Telemetria komputera na ekranie. Wszystko pod kontrola, o ile nie powiem inaczej.',
    help: 'Centrum pomocy. Wszystkie komendy i skroty w jednym miejscu.',
  };
  const KIND_LINES = {
    kamera: (t) => (/Wlaczono/.test(t) ? 'Kamera aktywna. Widze Cie, sir.' : null),
    gesty: (t) => (/aktywne/.test(t) ? 'Sterowanie gestami aktywne. Rozsun palce, a pojawi sie kursor.' : null),
    siec: (t) => t,
  };

  function emit(kind, text, opts = {}) {
    const t = Date.now();
    const clean = String(text || '').replace(/\s+/g, ' ').slice(0, 200);
    if (!clean) return;
    const last = buf[buf.length - 1];
    if (last && last.text === clean && last.kind === kind && t - last.t < 2500) return;
    const entry = { t, kind, text: clean };
    buf.push(entry);
    if (buf.length > MAX) buf.shift();
    window.dispatchEvent(new CustomEvent('jarvis:activity', { detail: entry }));
    relay(`${kind}: ${clean}`);

    if (!opts.react) return;
    const d = decide({
      lvl: level(),
      now: t,
      lastAt: lastReactAt,
      important: Boolean(opts.important),
      dnd: Boolean(UI.dnd && UI.dnd.active),
      cinema: document.body.classList.contains('cinema'),
      isLive: Boolean(UI.isLive && UI.isLive()),
      busy: Boolean(window.speechSynthesis && window.speechSynthesis.speaking),
    });
    if (!d.react) return;
    lastReactAt = t;
    if (d.via === 'live') {
      UI.liveSend({ type: 'react', text: opts.say ? `${clean} (powiedz mniej wiecej: ${opts.say})` : clean });
    } else {
      const line = opts.say || (KIND_LINES[kind] ? KIND_LINES[kind](clean) : null);
      if (line) say(line);
    }
  }

  UI.activity = {
    emit,
    recent: (n = 10) => buf.slice(-n).map(fmt),
    all: () => buf.slice(),
    _decide: decide,
    level,
  };

  // ---------- podpiecie zrodel ----------
  window.addEventListener('jarvis:module', (e) => {
    const { id, title } = e.detail || {};
    const first = !seenModules.has(id);
    seenModules.add(id);
    emit('modul', `Uzytkownik otworzyl modul "${title}"`, LINES[id] && first ? { react: true, say: LINES[id], important: false } : {});
  });
  window.addEventListener('jarvis:toast', (e) => {
    const { kind, msg } = e.detail || {};
    if (!msg) return;
    const bad = kind !== 'ok';
    emit('komunikat', `${bad ? 'Blad/ostrzezenie' : 'Potwierdzenie'}: ${msg}`, bad && String(msg).length < 90 ? { react: true, important: true, say: `Mamy drobny problem, sir: ${msg}` } : {});
  });
  window.addEventListener('jarvis:event', (e) => {
    const { source, message, kind } = e.detail || {};
    if (source === 'activity') return;
    emit('system', `${source}: ${message}`, kind === 'bad' ? { react: true, important: true, say: `Zgloszono problem w module ${source}: ${message}` } : {});
  });
  window.addEventListener('jarvis:action-result', (e) => {
    const { name, result } = e.detail || {};
    if (name) emit('akcja', `Wykonano akcje: ${name}${result && result.ok === false ? ' (nieudana)' : ''}`);
  });
  let lastTrack = '';
  window.addEventListener('jarvis:now-playing', () => {
    const s = UI.nowPlaying || {};
    const name = s.playing ? [s.artist, s.title || s.name].filter(Boolean).join(' - ') : '';
    if (name && name !== lastTrack) emit('muzyka', `Gra: ${name}`);
    lastTrack = name;
  });
  window.addEventListener('offline', () => emit('siec', 'Utracono polaczenie z internetem', { react: true, important: true, say: 'Utracilem polaczenie z internetem, sir. Pracuje w trybie lokalnym.' }));
  window.addEventListener('online', () => emit('siec', 'Polaczenie z internetem wrocilo', { react: true, say: 'Polaczenie z siecia przywrocone.' }));
  window.addEventListener('jarvis:ready', () => {
    // Zmiany danych (zakupy, nawyki, dziennik...) - z modulow "zycia" (patrz UI.logLife / UI.life).
    window.addEventListener('jarvis:life', (e) => {
      const c = e.detail && e.detail.coll;
      if (c && c !== 'journal') emit('dane', `Zmiana w danych: ${c}`);
    });
  });

  // ---------- ustawienia ----------
  UI.extend?.('set', {
    reactions: {
      title: 'REAKCJE JARVISA',
      glyph: '◈',
      build(body) {
        const { el } = UI;
        body.innerHTML = '';
        body.appendChild(el('div', 'sub', 'Jarvis widzi, co robisz w aplikacji (moduly, wybrane pojecia, gesty, komunikaty, zmiany danych) i moze sam zareagowac. Podczas rozmowy na zywo dostaje te zdarzenia jako cichy kontekst, a w czacie widzi ostatnie z nich.'));
        const row = el('div', 'field');
        row.style.cssText = 'flex-wrap:wrap;gap:6px;margin:8px 0';
        [['off', 'WYLACZONE'], ['rzadko', 'RZADKO (tylko wazne)'], ['zywo', 'ZYWO (czesto)']].forEach(([k, l]) => {
          const b = el('button', level() === k ? 'btn primary' : 'btn ghost', l);
          b.addEventListener('click', () => {
            try {
              localStorage.setItem('jarvis.react', k);
            } catch {
              /* brak pamieci */
            }
            row.querySelectorAll('button').forEach((x) => (x.className = 'btn ghost'));
            b.className = 'btn primary';
          });
          row.appendChild(b);
        });
        const v = el('input');
        v.type = 'checkbox';
        v.checked = voiceOn();
        v.addEventListener('change', () => {
          try {
            localStorage.setItem('jarvis.reactVoice', v.checked ? '1' : '0');
          } catch {
            /* brak pamieci */
          }
        });
        const vr = el('label', 'kv');
        vr.append(el('span', null, 'Reakcje glosem (poza rozmowa na zywo)'), v);
        const feed = el('div', 'w-list');
        const draw = () => {
          if (!document.body.contains(feed)) return;
          feed.innerHTML = '';
          buf.slice(-12).reverse().forEach((e) => feed.appendChild(el('div', 'w-dim', fmt(e))));
          setTimeout(draw, 2000);
        };
        body.append(row, vr, el('div', 'sub', 'OSTATNIE ZDARZENIA'), feed);
        draw();
      },
    },
  });
})();
