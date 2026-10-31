// Bezpieczenstwo danych w aplikacji: stan zapisu, lista kopii i przywracanie, codzienna kopia na dysk
// tego komputera (aplikacja desktopowa) oraz ostrzezenie, gdy zapis do magazynu sie nie udaje.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.extend) return;
  const { el, api, toast, isOwner, authHeaders } = UI;
  const D = () => window.jarvisDesktop;
  const LAST = 'jarvis.localBackupDay';
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

  async function localBackup(force) {
    if (!D() || !isOwner()) return null;
    const day = new Date().toISOString().slice(0, 10);
    if (!force && localStorage.getItem(LAST) === day) return null;
    const res = await fetch('/api/backup', { headers: authHeaders() });
    if (!res.ok) throw new Error(`Błąd ${res.status}`);
    const r = await D().runAction('zapisz-kopie', { json: await res.text() });
    if (r?.ok) localStorage.setItem(LAST, day);
    return r;
  }

  let warned = false;
  async function check() {
    if (!isOwner()) return;
    const h = await fetch('/api/health', { headers: authHeaders() }).then((r) => r.json()).catch(() => null);
    if (h && h.storeOk === false && !warned) {
      warned = true;
      toast('Uwaga: zapis danych na serwerze się nie udaje. Sprawdź Ustawienia → KOPIE I DANE.');
      UI.activity?.emit('system', 'Zapis danych na serwerze się nie udaje', { react: true, important: true, say: 'Mamy problem z zapisem danych na serwerze, sir. Sprawdź kopie zapasowe.' });
    }
    if (h?.storeOk) warned = false;
  }
  window.addEventListener('jarvis:ready', () => {
    setTimeout(() => localBackup().catch(() => {}), 20000);
    setTimeout(check, 15000);
    setInterval(check, 5 * 60000);
  });

  UI.extend('set', {
    dataguard: {
      title: 'KOPIE I DANE',
      glyph: '⛁',
      wide: true,
      build(body) {
        if (!isOwner()) {
          body.textContent = 'Dostępne tylko dla właściciela.';
          return;
        }
        body.innerHTML = '';
        body.appendChild(el('div', 'sub', 'Serwer sam robi kopię raz dziennie: 7 ostatnich dni i 4 tygodnie wstecz. Kopie nie zawierają tokenów. Aplikacja desktopowa zapisuje też kopię w Dokumenty/Jarvis-kopie.'));
        const info = el('div');
        const list = el('div', 'w-list');
        const row = el('div', 'field');
        row.style.cssText = 'gap:6px;flex-wrap:wrap;margin:8px 0';
        const now = el('button', 'btn primary', 'ZRÓB KOPIĘ TERAZ');
        now.addEventListener('click', async () => {
          now.disabled = true;
          try {
            const r = await api('/api/backup/snapshot', { method: 'POST' });
            toast(`Kopia gotowa (${kb(r.size)}).`, 'ok');
            await draw();
          } catch (e) {
            toast(e.message || 'Nie udało się.');
          }
          now.disabled = false;
        });
        row.appendChild(now);
        if (D()) {
          const pc = el('button', 'btn ghost', 'KOPIA NA TEN KOMPUTER');
          pc.addEventListener('click', async () => {
            try {
              const r = await localBackup(true);
              toast(r?.ok ? `Zapisano: ${r.file}` : r?.error || 'Zaktualizuj aplikację desktopową.', r?.ok ? 'ok' : 'bad');
            } catch (e) {
              toast(e.message || 'Nie udało się.');
            }
          });
          row.appendChild(pc);
        }
        body.append(info, row, list);

        async function draw() {
          const s = await api('/api/backup/status').catch((e) => ({ error: e.message }));
          info.innerHTML = '';
          if (s.error) {
            info.appendChild(el('div', 'w-empty', s.error));
            return;
          }
          const kv = (k, v, bad) => {
            const r = el('div', 'kv');
            const b = el('b', null, v);
            if (bad) b.style.color = 'var(--red)';
            r.append(el('span', null, k), b);
            info.appendChild(r);
          };
          kv('MAGAZYN', s.backend === 'upstash-redis' ? 'Upstash (trwały)' : 'plik lokalny');
          kv('OSTATNI ZAPIS', s.readFailed ? 'wstrzymany: magazyn nie odpowiada' : s.lastWriteOk === false ? `BŁĄD: ${s.lastError}` : s.lastWriteAt ? new Date(s.lastWriteAt).toLocaleString('pl-PL') : 'jeszcze nie było', s.readFailed || s.lastWriteOk === false);
          kv('ROZMIAR DANYCH', `${kb(s.size)}${s.sizeWarn ? ' (dużo: darmowy magazyn może mieć limit 1 MB)' : ''}`, s.sizeWarn);
          list.innerHTML = '';
          if (!s.snapshots.length) list.appendChild(el('div', 'w-empty', 'Pierwsza kopia powstanie automatycznie albo przyciskiem wyżej.'));
          s.snapshots.forEach((c) => {
            const it = el('div', 'it');
            const left = el('span', null, `${new Date(c.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })} · ${kb(c.size)}${c.kind === 'manual' ? ' · ręczna' : ''}`);
            const go = el('button', 'btn ghost', 'PRZYWRÓĆ');
            go.addEventListener('click', async () => {
              if (!confirm(`Przywrócić dane z ${new Date(c.at).toLocaleString('pl-PL')}? Obecny stan zapiszę jako kopię, więc da się to cofnąć.`)) return;
              try {
                await api('/api/backup/snapshot/restore', json({ name: c.name }));
                toast('Dane przywrócone. Odświeżam...', 'ok');
                setTimeout(() => location.reload(), 900);
              } catch (e) {
                toast(e.message || 'Nie udało się przywrócić.');
              }
            });
            it.append(left, go);
            list.appendChild(it);
          });
        }
        draw();
      },
    },
  });
})();
