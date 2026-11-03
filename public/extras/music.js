// "Graj X": serwer szuka utworu i - gdy polaczone jest konto Spotify (Premium) -
// odtwarza go przez API na Twoim urzadzeniu. Bez polaczenia otwieramy link: na
// komputerze lokalnie, z telefonu na komputerze przez pilota, a w ostatecznosci na
// tym urzadzeniu. Panel "Muzyka" w Ustawieniach laczy konto Spotify.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function hostOnline() {
    try {
      return (await api('/api/remote/status')).online;
    } catch {
      return false;
    }
  }

  async function openLink(found) {
    if (D()) return UI.runDeviceActionNow('otworz-link', { url: found.url });
    if (await hostOnline()) return UI.clientActions['pilot-pc']?.({ akcja: 'otworz-link', wartosc: found.url });
    // Bez komputera: otwieramy na tym urzadzeniu (spotify:... uruchomi aplikacje Spotify).
    window.open(found.url, '_blank') || (location.href = found.url);
  }

  // Bez tytulu nie ma czego szukac, a samo otwarcie Spotify nic nie gra.
  const GENERIC = /^(cos|cokolwiek|muzyk\w*|(jak\w+|dowoln\w+|moj\w+|ulubion\w+) (muzyk\w*|utwor\w*|piosenk\w*)|spotify)?$/;
  const isGeneric = (q) => GENERIC.test(q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase());
  // Gdy nie ma czego wznowic (swieze konto, pusty odtwarzacz): utwor z pobudki, ktory i tak jest w ustawieniach.
  const FALLBACK_TRACK = 'AC/DC Back in Black';

  async function playAnything() {
    // Na komputerze najpierw lokalnie: API wznowiloby muzyke na aktywnym urzadzeniu, a to moze byc telefon.
    if (D()) {
      // Wprost, a nie przez runDeviceActionNow: ona nie oddaje wyniku, a tu trzeba wiedziec, czy gra.
      const r = await D().runAction('spotify-graj').catch(() => null);
      if (r?.playing) {
        UI.pushSaid?.('jv', r.tytul ? `Gram: ${r.tytul}` : 'Wznawiam muzykę.');
        return;
      }
    } else {
      try {
        if ((await api('/api/spotify/status')).connected) {
          await api('/api/spotify/control', json({ cmd: 'play' }));
          UI.pushSaid?.('jv', 'Wznawiam muzykę.');
          return;
        }
      } catch {
        /* konto bez Premium albo brak urzadzenia: gramy konkretny utwor */
      }
    }
    return UI.clientActions.graj({ zapytanie: FALLBACK_TRACK });
  }

  UI.clientActions['graj'] = async (p) => {
    const q = String(p?.zapytanie || '').trim();
    if (isGeneric(q)) return playAnything();
    let r;
    try {
      r = await api('/api/music/play', json({ zapytanie: q, komputer: Boolean(D()) }));
    } catch (e) {
      UI.pushSaid?.('jv', 'Nie udalo mi sie znalezc: ' + q + (e.message ? ' (' + e.message + ')' : ''));
      return;
    }
    if (r.played) {
      UI.pushSaid?.('jv', 'Gram: ' + r.nazwa + (r.device ? ' (na: ' + r.device + ')' : ''));
      return;
    }
    UI.pushSaid?.('jv', 'Gram: ' + r.found.nazwa + (r.found.zrodlo === 'youtube' ? ' (YouTube)' : ''));
    // Link i tak zaraz zagra, wiec czerwony komunikat tylko by mylil. Powod zostaje w dzienniku.
    return openLink(r.found);
  };

  // ---------- panel w Ustawieniach ----------
  const def = {
    title: 'MUZYKA - SPOTIFY',
    glyph: '♫',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) {
        body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
        return;
      }
      const status = el('div', 'row-text', '...');
      const btns = el('div', 'field');
      btns.style.margin = '10px 0';
      const note = el('div', 'sub');
      body.append(status, btns, note);

      async function paint() {
        let s;
        try {
          s = await api('/api/spotify/status');
        } catch (e) {
          status.textContent = e.message;
          return;
        }
        btns.innerHTML = '';
        if (!s.configured) {
          status.textContent = 'Spotify nie jest skonfigurowane na serwerze (brak SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).';
          return;
        }
        status.textContent = s.connected ? 'Konto Spotify POLACZONE - "graj X" odtwarza przez Spotify na Twoim urzadzeniu.' : 'Konto Spotify niepolaczone - "graj X" otwiera link (bywa zawodne).';
        const go = el('button', s.connected ? 'btn ghost' : 'btn primary', s.connected ? 'POLACZ PONOWNIE' : 'POLACZ SPOTIFY');
        go.addEventListener('click', async () => {
          try {
            const r = await api('/api/spotify/auth-url');
            note.textContent = 'Zaloguj sie i zaakceptuj w oknie Spotify. Adres przekierowania w aplikacji Spotify musi byc dokladnie: ' + r.redirectUri;
            window.open(r.url, '_blank') || (location.href = r.url);
          } catch (e) {
            toast(e.message);
          }
        });
        btns.appendChild(go);
        if (s.connected) {
          const test = el('button', 'btn', 'TEST: ZAGRAJ');
          test.addEventListener('click', () => UI.clientActions.graj({ zapytanie: 'metallica nothing else matters' }));
          const off = el('button', 'btn danger', 'ROZLACZ');
          off.addEventListener('click', async () => {
            await api('/api/spotify/disconnect', json({}));
            paint();
          });
          btns.append(test, off);
        } else {
          const re = el('button', 'btn ghost', 'ODSWIEZ STATUS');
          re.addEventListener('click', paint);
          btns.appendChild(re);
        }
        note.textContent = 'Wymaga konta Premium i uruchomionej aplikacji Spotify na jednym z urzadzen. Po restarcie serwera na darmowym Renderze polaczenie moze trzeba bedzie powtorzyc.';
      }
      paint();
    },
  };
  UI.extend('set', { music: def });

  // ---------- modul Muzyka: playlisty, kolejka, tryby, wylacznik czasowy ----------
  const more = {
    title: 'SPOTIFY: PLAYLISTY, KOLEJKA, TRYBY',
    glyph: '♫',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) return body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
      const warn = el('div', 'hint');
      const now = el('div', 'w-mid');
      const btn = (label, fn, cls = 'btn') => {
        const b = el('button', cls, label);
        b.type = 'button';
        b.addEventListener('click', async () => {
          try {
            await fn();
            setTimeout(() => UI.refreshNowPlaying?.(), 800);
          } catch (e) {
            toast(e.message);
          }
        });
        return b;
      };
      const rowEl = (...kids) => {
        const r = el('div', 'field');
        r.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0;align-items:center';
        r.append(...kids);
        return r;
      };
      const post = (url, body) => api(url, json(body || {}));
      const controls = rowEl(
        btn('⏮', () => UI.musicControl?.('wstecz')),
        btn('⏯', () => UI.musicControl?.(UI.nowPlaying?.playing ? 'pauza' : 'wznow')),
        btn('⏭', () => UI.musicControl?.('dalej')),
        btn('−15 s', () => post('/api/spotify/seek', { s: -15 })),
        btn('+30 s', () => post('/api/spotify/seek', { s: 30 })),
        btn('♥ POLUB', async () => {
          const r = await post('/api/spotify/like');
          toast(`Polubione: ${r.track}`, 'ok');
        }),
        btn('🔀 LOSOWO', async () => toast((await post('/api/spotify/shuffle', { on: true })).shuffle ? 'Losowo: włączone' : 'Losowo: wyłączone', 'ok')),
        btn('➡ PO KOLEI', () => post('/api/spotify/shuffle', { on: false })),
      );
      const repeat = el('select', 'inp');
      for (const [v, t] of [['off', 'bez powtarzania'], ['context', 'powtarzaj playlistę'], ['track', 'powtarzaj utwór']]) {
        const o = el('option', null, t);
        o.value = v;
        repeat.appendChild(o);
      }
      repeat.addEventListener('change', () => post('/api/spotify/repeat', { mode: repeat.value }).catch((e) => toast(e.message)));
      const sleepInfo = el('span', 'w-dim');
      const sleep = rowEl(el('span', 'w-dim', 'Wyłącz muzykę za:'), ...[15, 30, 45, 60].map((m) => btn(`${m} min`, async () => {
        await post('/api/spotify/sleep', { minutes: m });
        toast(`Muzyka wyłączy się za ${m} min (ostatnia minuta ciszej).`, 'ok');
        paintStatus();
      })), btn('ODWOŁAJ', async () => {
        await post('/api/spotify/sleep', { minutes: 0 });
        paintStatus();
      }, 'btn ghost'), sleepInfo);
      const q = el('input', 'inp');
      q.placeholder = 'dodaj do kolejki: wykonawca i tytuł';
      q.style.flex = '1 1 260px';
      const qAdd = btn('DO KOLEJKI', async () => {
        if (!q.value.trim()) return;
        const r = await post('/api/spotify/queue', { zapytanie: q.value });
        toast(`W kolejce: ${r.nazwa}`, 'ok');
        q.value = '';
      }, 'btn primary');
      q.addEventListener('keydown', (e) => e.key === 'Enter' && qAdd.click());
      const lists = el('div');
      const recent = el('div');
      body.append(warn, now, controls, rowEl(repeat), sleep, rowEl(q, qAdd), el('div', 'sub', 'Twoje playlisty (kliknij, żeby włączyć):'), lists, el('div', 'sub', 'Ostatnio grane:'), recent);

      const paintNow = () => {
        const n = UI.nowPlaying || {};
        now.textContent = n.track ? `${n.playing ? '▶' : '⏸'} ${n.track} - ${n.artist}${n.device ? ` (na: ${n.device})` : ''}` : n.connected === false ? 'Spotify niepołączone.' : 'Nic nie gra.';
      };
      window.addEventListener('jarvis:now-playing', paintNow);
      paintNow();
      async function paintStatus() {
        const s = await api('/api/spotify/status').catch(() => null);
        if (!s) return;
        warn.textContent = !s.connected ? 'Połącz konto w Ustawienia → Muzyka.' : s.missingScopes?.length ? 'Playlisty, polubienia i historia wymagają ponownego połączenia: Ustawienia → Muzyka → POŁĄCZ PONOWNIE.' : '';
        sleepInfo.textContent = s.sleep ? `wyłączy się o ${new Date(s.sleep.end).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : '';
        if (!s.connected) return;
        lists.innerHTML = '';
        recent.innerHTML = '';
        try {
          const pl = await api('/api/spotify/playlists');
          for (const p of pl.items) {
            lists.appendChild(btn(`${p.name} (${p.tracks})`, async () => {
              const r = await post('/api/spotify/playlist', { nazwa: p.name, komputer: Boolean(D()) });
              toast(`Gra: ${r.name} (na: ${r.device})`, 'ok');
            }, 'btn ghost'));
          }
          const rp = await api('/api/spotify/recent');
          for (const t of rp.items.slice(0, 10)) recent.appendChild(el('div', 'w-dim', `${new Date(t.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} · ${t.track} - ${t.artist}`));
        } catch (e) {
          lists.appendChild(el('div', 'hint', e.message));
        }
      }
      paintStatus();
    },
  };
  UI.register({ id: 'muzyka', title: 'Muzyka', sub: 'Spotify: playlisty i kolejka', icon: '♫', owner: true, group: 'Glowne', panels: { music_more: more } });
})();
