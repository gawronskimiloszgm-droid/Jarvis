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
    if (D()) return UI.runDeviceAction('otworz-link', { url: found.url });
    if (await hostOnline()) return UI.clientActions['pilot-pc']?.({ akcja: 'otworz-link', wartosc: found.url });
    // Bez komputera: otwieramy na tym urzadzeniu (spotify:... uruchomi aplikacje Spotify).
    window.open(found.url, '_blank') || (location.href = found.url);
  }

  UI.clientActions['graj'] = async (p) => {
    const q = String(p?.zapytanie || '').trim();
    if (!q) return toast('Co mam zagrac?');
    let r;
    try {
      r = await api('/api/music/play', json({ zapytanie: q }));
    } catch (e) {
      UI.pushSaid?.('jv', 'Nie udalo mi sie znalezc: ' + q + (e.message ? ' (' + e.message + ')' : ''));
      return;
    }
    if (r.played) {
      UI.pushSaid?.('jv', 'Gram: ' + r.nazwa + (r.device ? ' (na: ' + r.device + ')' : ''));
      return;
    }
    UI.pushSaid?.('jv', 'Gram: ' + r.found.nazwa + (r.found.zrodlo === 'youtube' ? ' (YouTube)' : ''));
    if (r.warning) toast('Spotify API: ' + r.warning);
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
})();
