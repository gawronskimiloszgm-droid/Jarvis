// Fundament: wersje + aktualizacje, panel "Doktor", kopia zapasowa pamieci.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, authHeaders, isOwner } = UI;

  // --- porownanie wersji "x.y.z" ---
  function cmp(a, b) {
    const pa = String(a || '0').split('.').map(Number);
    const pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // --- baner "stara aplikacja" ---
  function showOutdatedBanner(have, need) {
    if (document.getElementById('desktopOutdated')) return;
    const b = el('div', 'banner-warn');
    b.id = 'desktopOutdated';
    b.append(
      el('b', null, 'Przestarzala aplikacja desktopowa'),
      el('span', null, ` (${have || 'brak informacji o wersji'}, serwer wymaga ${need}). Sterowanie komputerem i E.D.I.T.H. nie dzialaja w tej wersji. `)
    );
    const btn = el('button', 'btn', 'SPRAWDZ AKTUALIZACJE');
    btn.addEventListener('click', async () => {
      const st = await window.jarvisDesktop?.checkForUpdate?.();
      toast(
        st?.state === 'dev'
          ? 'Tryb deweloperski - uruchom aplikacje z aktualnego folderu desktop.'
          : `Aktualizacja: ${st?.state || 'nieznany stan'}`,
        'ok'
      );
    });
    const x = el('button', 'btn ghost', 'x');
    x.addEventListener('click', () => b.remove());
    b.append(btn, x);
    document.body.appendChild(b);
  }

  window.addEventListener('jarvis:ready', (e) => {
    const h = e.detail || {};
    if (window.jarvisDesktop) {
      const have = window.jarvisDesktop.version;
      if (!have || cmp(have, h.minDesktopVersion || '0.0.0') < 0) showOutdatedBanner(have, h.minDesktopVersion);
      window.jarvisDesktop.onUpdateStatus?.((s) => {
        if (s.state === 'ready') toast(`Aktualizacja ${s.next} pobrana - zainstaluje sie przy zamknieciu aplikacji.`, 'ok');
      });
    }
  });

  // --- panel Doktor ---
  const ICON = { ok: '●', warn: '▲', bad: '■' };

  function row(c) {
    const r = el('div', 'row');
    const dot = el('span', `doc-dot ${c.status}`, ICON[c.status] || '●');
    const txt = el('div');
    txt.style.flex = '1';
    txt.append(el('div', 'row-text', c.label), el('div', 'sub', c.detail || ''));
    if (c.fix) txt.append(el('div', 'doc-fix', c.fix));
    r.append(dot, txt);
    return r;
  }

  async function clientChecks() {
    const out = [];
    const d = window.jarvisDesktop;
    const sr = window.SpeechRecognition || window.webkitSpeechRecognition;
    out.push({
      id: 'desktop',
      label: 'Aplikacja desktopowa',
      status: d ? 'ok' : 'warn',
      detail: d ? `wersja ${d.version}` : 'uruchomiono w przegladarce - sterowanie komputerem niedostepne',
      fix: d ? undefined : 'Uruchom aplikacje z folderu desktop (npm start) albo zainstaluj zbudowany plik .exe.',
    });
    out.push({ id: 'sr', label: 'Rozpoznawanie mowy w przegladarce', status: sr ? 'ok' : 'warn', detail: sr ? 'dostepne' : 'niedostepne (rozmowa na zywo dziala niezaleznie)' });
    out.push({ id: 'sw', label: 'Service worker (offline)', status: 'serviceWorker' in navigator ? 'ok' : 'warn', detail: 'serviceWorker' in navigator ? 'obslugiwany' : 'brak' });
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      out.push({
        id: 'mic',
        label: 'Mikrofon',
        status: p.state === 'granted' ? 'ok' : p.state === 'prompt' ? 'warn' : 'bad',
        detail: p.state,
        fix: p.state === 'granted' ? undefined : 'Zezwol na mikrofon w ustawieniach przegladarki/aplikacji.',
      });
    } catch {
      out.push({ id: 'mic', label: 'Mikrofon', status: 'warn', detail: 'nie da sie sprawdzic uprawnienia' });
    }
    out.push({
      id: 'notif',
      label: 'Powiadomienia',
      status: 'Notification' in window && Notification.permission === 'granted' ? 'ok' : 'warn',
      detail: 'Notification' in window ? Notification.permission : 'brak obslugi',
    });
    return out;
  }

  const doctor = {
    title: 'DOKTOR',
    glyph: '✚',
    wide: true,
    build(body) {
      body.innerHTML = '';
      doctor._body = body;
    },
    async refresh() {
      const body = doctor._body;
      if (!body) return;
      body.innerHTML = '';
      body.appendChild(el('div', 'hint', 'Sprawdzam...'));
      let server = [];
      let meta = null;
      if (isOwner()) {
        try {
          meta = await api('/api/doctor');
          server = meta.checks;
        } catch (err) {
          server = [{ id: 'srv', label: 'Serwer', status: 'bad', detail: err.message }];
        }
      }
      const client = await clientChecks();
      body.innerHTML = '';
      const sum = el(
        'div',
        'sub',
        meta
          ? `Serwer ${meta.version} · wymagana aplikacja desktopowa >= ${meta.minDesktopVersion} · dziala ${Math.round(meta.uptimeSec / 60)} min`
          : 'Zaloguj sie, zeby zobaczyc kontrole serwera.'
      );
      sum.style.marginBottom = '10px';
      body.appendChild(sum);
      if (server.length) {
        body.appendChild(el('div', 'sub', 'SERWER'));
        server.forEach((c) => body.appendChild(row(c)));
      }
      const h2 = el('div', 'sub', 'TA APLIKACJA');
      h2.style.marginTop = '12px';
      body.appendChild(h2);
      client.forEach((c) => body.appendChild(row(c)));
      const again = el('button', 'btn', 'SPRAWDZ PONOWNIE');
      again.style.marginTop = '12px';
      again.addEventListener('click', () => doctor.refresh());
      body.appendChild(again);
    },
  };

  UI.register({ id: 'doctor', title: 'Doktor', sub: 'diagnostyka i wersje', icon: '✚', owner: false, panels: { doctor } });

  // --- kopia zapasowa (dopisana do Ustawien) ---
  function download(name, text) {
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
  }

  const backup = {
    title: 'KOPIA ZAPASOWA PAMIECI',
    glyph: '⇩',
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) {
        body.appendChild(el('div', 'hint', 'Kopia zapasowa wymaga zalogowania.'));
        return;
      }
      body.appendChild(el('div', 'sub', 'Fakty, zadania, przypomnienia, wydatki, tryby i kronika - w jednym pliku JSON.'));
      const f = el('div', 'field');
      f.style.marginTop = '10px';
      const dl = el('button', 'btn', 'POBIERZ KOPIE');
      dl.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/backup', { headers: authHeaders() });
          if (!res.ok) throw new Error(`Blad ${res.status}`);
          download(`jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`, await res.text());
          toast('Kopia pobrana.', 'ok');
        } catch (err) {
          toast(err.message);
        }
      });
      const up = el('button', 'btn ghost', 'PRZYWROC Z PLIKU');
      const input = el('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.hidden = true;
      up.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!confirm('Przywrocenie nadpisze obecne fakty, zadania i reszte pamieci danymi z pliku. Kontynuowac?')) {
          input.value = '';
          return;
        }
        try {
          const json = JSON.parse(await file.text());
          const r = await api('/api/backup/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(json),
          });
          // Poprzedni stan pobiera sie od razu - pomylka da sie cofnac.
          download('jarvis-przed-przywroceniem.json', JSON.stringify(r.previous, null, 2));
          toast(`Przywrocono (${r.restoredKeys} sekcji). Poprzedni stan zapisany do pliku.`, 'ok');
        } catch (err) {
          toast(err.message || 'Nieprawidlowy plik.');
        }
        input.value = '';
      });
      f.append(dl, up, input);
      body.appendChild(f);
    },
  };
  UI.extend('set', { backup });
})();
