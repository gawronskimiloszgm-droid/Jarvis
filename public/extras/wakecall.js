// Poranny telefon od Jarvisa: ustawienia, ekran polaczenia przychodzacego, odebranie z raportem
// "gdy spales" w rozmowie glosowej i szkice maili do zatwierdzenia. W aplikacji na Androida budzik
// i pelnoekranowe polaczenie robi wtyczka CallAlarm; w przegladarce i PWA dzwoni powiadomienie
// z serwera (server/extras/night.js), ktore otwiera "/?call=morning".
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.register) return;
  const { el, api, toast, isOwner } = UI;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const native = () => window.Capacitor?.Plugins?.CallAlarm || null;
  const DAYS = [['Pn', 1], ['Wt', 2], ['Śr', 3], ['Cz', 4], ['Pt', 5], ['So', 6], ['Nd', 0]];

  const row = (...kids) => {
    const r = el('div', 'field');
    r.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0;align-items:center';
    r.append(...kids);
    return r;
  };
  const button = (label, fn, cls = 'btn') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        toast(e.message);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };

  // ---------- dzwonek w przegladarce (gdy strona juz moze grac dzwiek) ----------
  let ringCtx = null;
  let ringTimer = null;
  function startRingtone() {
    try {
      ringCtx = new (window.AudioContext || window.webkitAudioContext)();
      const beep = () => {
        if (!ringCtx) return;
        const t = ringCtx.currentTime;
        for (const [off, f] of [[0, 880], [0.25, 660], [0.5, 880], [0.75, 660]]) {
          const o = ringCtx.createOscillator();
          const g = ringCtx.createGain();
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t + off);
          g.gain.exponentialRampToValueAtTime(0.25, t + off + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.22);
          o.connect(g).connect(ringCtx.destination);
          o.start(t + off);
          o.stop(t + off + 0.24);
        }
        navigator.vibrate?.([800, 400, 800]);
      };
      beep();
      ringTimer = setInterval(beep, 2500);
    } catch {
      /* bez dzwieku: zostaje sam ekran */
    }
  }
  function stopRingtone() {
    clearInterval(ringTimer);
    ringTimer = null;
    ringCtx?.close?.().catch(() => {});
    ringCtx = null;
    navigator.vibrate?.(0);
  }

  // ---------- ekran polaczenia ----------
  let screen = null;
  function incoming({ id, autoAnswer } = {}) {
    if (screen) return;
    screen = el('div');
    screen.style.cssText = 'position:fixed;inset:0;z-index:10000;background:radial-gradient(circle at 50% 35%,#0b2a3d,#020a12 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#e8f6ff;gap:10px;text-align:center;padding:20px';
    const pulse = el('div');
    pulse.style.cssText = 'width:140px;height:140px;border-radius:50%;border:3px solid #33e0ff;box-shadow:0 0 40px #33e0ff;animation:jcall 1.4s ease-out infinite';
    const style = el('style', null, '@keyframes jcall{0%{transform:scale(.9);opacity:1}100%{transform:scale(1.25);opacity:.35}}');
    const title = el('div', null, 'J.A.R.V.I.S.');
    title.style.cssText = 'font:700 30px monospace;letter-spacing:4px;margin-top:18px';
    const sub = el('div', 'w-dim', 'dzwoni · raport poranny');
    const btns = el('div');
    btns.style.cssText = 'display:flex;gap:28px;margin-top:40px;flex-wrap:wrap;justify-content:center';
    const round = (label, color, fn) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.style.cssText = `width:96px;height:96px;border-radius:50%;border:none;background:${color};color:#fff;font:600 14px system-ui;cursor:pointer`;
      b.addEventListener('click', fn);
      return b;
    };
    const close = () => {
      stopRingtone();
      screen?.remove();
      screen = null;
    };
    btns.append(
      round('Odrzuć', '#dc3545', async () => {
        close();
        await api('/api/wake/answer', json('POST', { id })).catch(() => {});
      }),
      round('Drzemka', '#3a4a5a', async () => {
        close();
        const r = await api('/api/wake/snooze', json('POST', { id })).catch(() => null);
        toast(r ? `Zadzwonię za ${r.min} min.` : 'Drzemka niedostępna.', 'ok');
      }),
      round('Odbierz', '#28b463', () => {
        close();
        answer(id).catch((e) => toast(e.message));
      }),
    );
    screen.append(style, pulse, title, sub, btns);
    document.body.appendChild(screen);
    if (autoAnswer) {
      // Odebrane juz na ekranie telefonu (Android): od razu rozmowa.
      close();
      answer(id).catch((e) => toast(e.message));
    } else startRingtone();
  }

  /** Po odebraniu: raport z serwera i rozmowa glosowa; bez niej raport czytany syntezatorem. */
  async function answer(id) {
    api('/api/wake/answer', json('POST', { id })).catch(() => {});
    const report = await api('/api/wake/report');
    const hour = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const prompt = `To poranny telefon: zadzwoniles do uzytkownika i wlasnie odebral, jest ${hour}. Przywitaj sie jednym zdaniem i przekaz raport jak w rozmowie telefonicznej: krotko, najwazniejsze najpierw. Szkice maili tylko zapowiedz (zatwierdza je sam w module Poranny telefon). Na koniec zapytaj, czy czegos potrzebuje. Na dopytania uzyj narzedzia raport_nocny. Raport: ${report.text}`;
    UI.startListening?.();
    for (let i = 0; i < 40 && !UI.isLive?.(); i++) await new Promise((r) => setTimeout(r, 250));
    if (UI.isLive?.()) UI.liveSend({ type: 'react', text: prompt });
    else UI.speak?.(`Dzień dobry, jest ${hour}. ${report.text}`);
    if (report.drafts?.length) toast(`Szkiców maili do zatwierdzenia: ${report.drafts.length} (moduł Poranny telefon).`, 'ok');
  }

  // Wejscia: adres z powiadomienia, wiadomosc z service workera, przycisk Odbierz w Androidzie.
  function checkUrl(url) {
    const u = new URL(url, location.origin);
    if (u.searchParams.get('call') !== 'morning') return;
    incoming({ id: u.searchParams.get('id') || '' });
    history.replaceState(null, '', location.pathname);
  }
  setTimeout(() => {
    if (isOwner()) checkUrl(location.href);
  }, 1500);
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'jarvis-open' && typeof e.data.url === 'string') checkUrl(e.data.url);
  });
  async function nativeAnswered() {
    const r = await native()?.consumeAnswer?.().catch(() => null);
    if (r?.answered) incoming({ autoAnswer: true });
  }
  if (native()) {
    setTimeout(nativeAnswered, 1500);
    native().addListener?.('answered', () => incoming({ autoAnswer: true }));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && nativeAnswered());
  }

  // ---------- panel ----------
  const panel = {
    title: 'PORANNY TELEFON',
    glyph: '📞',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) return body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
      const box = el('div');
      const drafts = el('div');
      body.append(box, el('div', 'sub', 'Szkice odpowiedzi z nocy (wysyłasz sam):'), drafts);

      async function syncNative(s) {
        const n = native();
        if (!n) return null;
        // Budzik w telefonie; serwer wtedy nie wysyla wlasnych powiadomien, zeby nie dzwonilo podwojnie.
        const st = await n.configure({ enabled: s.enabled, time: s.time, days: s.days });
        if (s.nativeAlarm !== Boolean(s.enabled)) await api('/api/wake/settings', json('PUT', { nativeAlarm: Boolean(s.enabled) }));
        return st;
      }

      async function load() {
        const s = await api('/api/wake/settings');
        box.innerHTML = '';
        const on = el('input');
        on.type = 'checkbox';
        on.checked = s.enabled;
        const time = el('input', 'inp');
        time.type = 'time';
        time.value = s.time;
        const sleep = el('input', 'inp');
        sleep.type = 'time';
        sleep.value = s.sleepFrom;
        const days = new Set(s.days);
        const dayRow = row(el('span', 'w-dim', 'dni:'));
        for (const [label, d] of DAYS) {
          const b = el('button', days.has(d) ? 'btn primary' : 'btn ghost', label);
          b.type = 'button';
          b.addEventListener('click', () => {
            days.has(d) ? days.delete(d) : days.add(d);
            b.className = days.has(d) ? 'btn primary' : 'btn ghost';
          });
          dayRow.appendChild(b);
        }
        const work = el('input');
        work.type = 'checkbox';
        work.checked = s.nightWork;
        const lbl = (input, text) => {
          const l = el('label', 'st-check');
          l.append(input, document.createTextNode(` ${text}`));
          return l;
        };
        const nextTxt = s.next ? new Date(s.next).toLocaleString('pl-PL', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : 'wyłączony';
        box.append(
          el('div', 'w-mid', `Następny telefon: ${nextTxt}`),
          row(lbl(on, 'dzwoń rano'), el('span', 'w-dim', 'o'), time, el('span', 'w-dim', 'kładę się ok.'), sleep),
          dayRow,
          row(lbl(work, 'w nocy przejrzyj pocztę i przygotuj szkice odpowiedzi (nic nie wysyła)')),
          row(button('ZAPISZ', async () => {
            const r = await api('/api/wake/settings', json('PUT', { enabled: on.checked, time: time.value, sleepFrom: sleep.value, days: [...days], nightWork: work.checked }));
            const st = await syncNative(r).catch((e) => ({ error: e.message }));
            toast(r.next ? `Zadzwonię: ${new Date(r.next).toLocaleString('pl-PL', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}${st?.scheduledAt ? ' (budzik w telefonie ustawiony)' : ''}` : 'Poranny telefon wyłączony.', 'ok');
            load();
          }, 'btn primary'), button('ZADZWOŃ TERAZ (PRÓBA)', async () => {
            if (native()) {
              await native().test({ seconds: 5 });
              toast('Za 5 s zadzwoni telefon: możesz go zablokować, żeby zobaczyć ekran połączenia.', 'ok');
            } else {
              await api('/api/wake/test', { method: 'POST' });
              toast('Wysłałem powiadomienie z połączeniem.', 'ok');
            }
          }, 'btn ghost'), button('RAPORT TERAZ', async () => {
            await api('/api/wake/night-work', { method: 'POST' }).catch(() => {});
            incoming({ id: '' });
          }, 'btn ghost')),
        );
        if (!s.pushReady && !native()) box.appendChild(el('div', 'hint', 'Serwer nie ma skonfigurowanych powiadomień push (VAPID): w przeglądarce telefon nie zadzwoni. W aplikacji na Androida działa budzik w telefonie.'));
        if (!s.gmail) box.appendChild(el('div', 'w-dim', 'Gmail niepołączony: raport będzie bez poczty.'));
        const n = native();
        if (n) {
          const st = await n.getStatus().catch(() => null);
          if (st) {
            const miss = [!st.notifications && ['notifications', 'powiadomienia'], !st.exactAlarms && ['exactAlarms', 'dokładne budziki'], !st.fullScreen && ['fullScreen', 'pełny ekran na blokadzie']].filter(Boolean);
            box.appendChild(el('div', miss.length ? 'hint' : 'w-dim', miss.length ? `Telefon: brakuje uprawnień: ${miss.map((m) => m[1]).join(', ')}.` : `Budzik w telefonie: ${st.scheduledAt ? new Date(st.scheduledAt).toLocaleString('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'nieustawiony'}.`));
            if (miss.length) box.appendChild(row(...miss.map(([k, l]) => button(`WŁĄCZ: ${l.toUpperCase()}`, () => n.openSettings({ which: k }), 'btn ghost'))));
          }
        }
        loadDrafts();
      }

      async function loadDrafts() {
        const r = await api('/api/wake/drafts');
        drafts.innerHTML = '';
        if (!r.drafts.length) return drafts.appendChild(el('div', 'w-dim', 'Brak szkiców.'));
        for (const d of r.drafts) {
          const card = el('div');
          card.style.cssText = `border-left:2px solid ${d.angry ? '#ff6b6b' : d.urgent ? '#ffd166' : 'rgba(51,224,255,.4)'};padding:4px 0 4px 8px;margin:6px 0`;
          const text = el('textarea', 'inp');
          text.value = d.draft;
          text.rows = 4;
          text.style.width = '100%';
          card.append(
            el('div', 'w-mid', `${d.from} · ${d.subject}${d.angry ? ' · zdenerwowany' : d.urgent ? ' · pilne' : ''}`),
            el('div', 'w-dim', d.summary || ''),
            text,
            row(button('WYŚLIJ', async () => {
              if (!window.confirm(`Wysłać odpowiedź do: ${d.to}?`)) return;
              await api('/api/comms/gmail/send', json('POST', { to: d.to, subject: d.subject, body: text.value, threadId: d.threadId, confirm: true }));
              await api(`/api/wake/drafts/${d.id}`, json('POST', { status: 'wyslany' }));
              toast('Wysłane.', 'ok');
              loadDrafts();
            }, 'btn primary'), button('ODRZUĆ', async () => {
              await api(`/api/wake/drafts/${d.id}`, json('POST', { status: 'odrzucony' }));
              loadDrafts();
            }, 'btn ghost')),
          );
          drafts.appendChild(card);
        }
      }
      load().catch((e) => (box.textContent = e.message));
    },
  };

  UI.register({ id: 'telefon', title: 'Poranny telefon', sub: 'pobudka z raportem z nocy', icon: '📞', owner: true, group: 'Glowne', panels: { wake: panel } });
})();
