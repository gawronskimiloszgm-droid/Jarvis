// Strona kliencka funkcji desktopowych: szybkie przechwytywanie (Ctrl+Alt+N), nakladka HUD
// (zegar, CPU/RAM, teraz gra), kolejny profil (Ctrl+Alt+P), tryb skupienia z zasobnika oraz
// "tryb kina" (przyciemnienie, cisza, pelny ekran) dostepny tez w przegladarce i na telefonie.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.life) return;
  const { el, api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- szybkie przechwytywanie: "z: kupic bilety", "k: mleko, chleb", "d: dobry dzien", reszta = notatka ----------
  async function capture(text) {
    const m = text.match(/^(z|k|d|n)\s*:\s*(.+)$/is);
    const kind = m ? m[1].toLowerCase() : 'n';
    const body = (m ? m[2] : text).trim();
    if (!body) return;
    try {
      if (kind === 'z') await api('/api/todos', json('POST', { text: body }));
      else if (kind === 'k') await Promise.all(body.split(/[,;]+/).map((t) => t.trim()).filter(Boolean).map((t) => UI.life.add('shopping', { text: t })));
      else if (kind === 'd') await UI.life.add('journal', { text: body, kind: 'manual' });
      else await UI.life.add('quicknotes', { text: body });
      toast({ z: 'Dodano zadanie.', k: 'Dodano do zakupow.', d: 'Wpis w dzienniku.', n: 'Zapisano notatke.' }[kind], 'ok');
      window.SFX?.play?.('ok');
    } catch (e) {
      toast(e.message || 'Nie zapisano.');
    }
  }
  UI.quickCapture = capture;

  // ---------- tryb kina ----------
  const cinema = {
    on: false,
    async toggle(force) {
      const on = force == null ? !cinema.on : Boolean(force);
      cinema.on = on;
      document.body.classList.toggle('cinema', on);
      try {
        if (on) await document.documentElement.requestFullscreen?.();
        else if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        /* pelny ekran niedostepny */
      }
      // Cisza: bez odzywek i push-ow na 2 godziny (wylaczenie kina konczy tez cisze).
      try {
        await api('/api/dnd', json('POST', { minutes: on ? 120 : 0 }));
      } catch {
        /* DND tylko dla wlasciciela */
      }
      toast(on ? 'Tryb kina: wlaczony.' : 'Tryb kina: wylaczony.', 'ok');
      UI.activity?.emit('kino', on ? 'Wlaczono tryb kina' : 'Wylaczono tryb kina');
    },
  };
  UI.cinema = cinema;
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && cinema.on) {
      cinema.on = false;
      document.body.classList.remove('cinema');
    }
  });

  // ---------- kolejny profil ----------
  async function nextProfile() {
    try {
      const p = await api('/api/profiles');
      const list = p.list || [];
      if (!list.length) return toast('Brak profili.');
      const i = list.findIndex((x) => x.name === p.active);
      const next = list[(i + 1) % list.length];
      await UI.runDeviceAction('profil', { nazwa: next.name });
      toast(`Profil: ${next.name}`, 'ok');
    } catch (e) {
      toast(e.message || 'Nie przelaczono profilu.');
    }
  }

  // ---------- polecenia z powloki desktopowej ----------
  window.addEventListener('jarvis:ready', () => {
    D()?.onCommand?.((c) => {
      if (!c || !isOwner()) return;
      if (c.type === 'quick-capture') capture(String(c.text || ''));
      else if (c.type === 'cinema') cinema.toggle();
      else if (c.type === 'focus') UI.timers?.startFocus(Number(c.minutes) || 25);
      else if (c.type === 'next-profile') nextProfile();
    });
    // Nakladka HUD pokazuje, co teraz gra.
    const push = () => {
      const s = UI.nowPlaying || {};
      const text = s.playing ? [s.artist, s.title || s.name].filter(Boolean).join(' - ') : '';
      D()?.overlayPush?.(text);
    };
    if (D()?.overlayPush) {
      window.addEventListener('jarvis:now-playing', push);
      setInterval(push, 10000);
    }
  });

  // ---------- panel w Ustawieniach (tylko desktop) ----------
  if (D()?.overlayState) {
    UI.extend('set', {
      overlay: {
        title: 'NAKLADKA HUD',
        glyph: '▣',
        build(body) {
          body.innerHTML = '';
          body.appendChild(el('div', 'sub', 'Przezroczysta nakladka na wierzchu ekranu: zegar, obciazenie CPU/RAM i utwor, ktory gra. Skrot: Ctrl+Alt+H. Szybka notatka: Ctrl+Alt+N. Pauza/wznow: Ctrl+Alt+Spacja. Kolejny profil: Ctrl+Alt+P.'));
          const rows = el('div');
          body.appendChild(rows);
          const draw = async () => {
            const st = await D().overlayState();
            rows.innerHTML = '';
            const on = el('button', st.on ? 'btn primary' : 'btn ghost', st.on ? 'WLACZONA' : 'WYLACZONA');
            on.addEventListener('click', async () => {
              await D().overlaySet({ on: !st.on });
              draw();
            });
            const corner = el('select', 'inp');
            [['tr', 'prawy gorny'], ['tl', 'lewy gorny'], ['br', 'prawy dolny'], ['bl', 'lewy dolny']].forEach(([v, l]) => corner.appendChild(Object.assign(el('option', null, l), { value: v })));
            corner.value = st.corner || 'tr';
            corner.addEventListener('change', () => D().overlaySet({ corner: corner.value }));
            const op = el('input');
            op.type = 'range';
            op.min = '0.2';
            op.max = '1';
            op.step = '0.05';
            op.value = String(st.opacity ?? 0.85);
            op.addEventListener('change', () => D().overlaySet({ opacity: Number(op.value) }));
            const click = el('input');
            click.type = 'checkbox';
            click.checked = st.clickThrough;
            click.addEventListener('change', () => D().overlaySet({ clickThrough: click.checked }));
            const row = (l, n) => {
              const r = el('div', 'kv');
              r.append(el('span', null, l), n);
              return r;
            };
            rows.append(row('NAKLADKA', on), row('ROG EKRANU', corner), row('PRZEZROCZYSTOSC', op), row('PRZEPUSZCZA MYSZ (click-through)', click));
          };
          draw();
        },
      },
    });
  }

  // Kino z palety: "kino".
  const orig = UI.paletteSearch;
  if (orig) {
    UI.paletteSearch = (q) => {
      const out = orig(q);
      if (/^(kino|cinema)\b/i.test(q.trim())) out.unshift({ label: '🎬 Tryb kina (przyciemnienie + cisza + pelny ekran)', hint: 'ENTER', run: () => cinema.toggle() });
      if (/^(nakladka|hud)\b/i.test(q.trim()) && D()?.overlaySet) out.unshift({ label: '▣ Przelacz nakladke HUD', hint: 'ENTER', run: async () => { const s = await D().overlayState(); D().overlaySet({ on: !s.on }); } });
      return out;
    };
  }
})();
