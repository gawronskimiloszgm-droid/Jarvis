// Hevy w module Trening: stan polaczenia, ostatnie treningi z opisem postepu, bilans 4 tygodni
// i postep wybranego cwiczenia na wykresie. Dane licza sie na serwerze (server/extras/hevy.js).
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.extend) return;
  const { el, api, toast, isOwner } = UI;

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
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'przed chwilą' : m < 60 ? `${m} min temu` : m < 1440 ? `${Math.round(m / 60)} h temu` : `${Math.round(m / 1440)} dni temu`;
  };

  function chart(host, p) {
    host.innerHTML = '';
    if (!p || p.error) return host.appendChild(el('div', 'hint', p?.error || 'Brak danych.'));
    host.appendChild(el('div', 'w-mid', p.text));
    const pts = p.points || [];
    if (pts.length < 2) return;
    const W = 520;
    const H = 140;
    const vals = pts.map((x) => x[1]);
    const lo = Math.min(...vals) * 0.95;
    const hi = Math.max(...vals) * 1.05;
    const xy = pts.map(([, v], i) => [20 + (i * (W - 40)) / (pts.length - 1), H - 20 - ((v - lo) / (hi - lo || 1)) * (H - 40)]);
    const unit = p.bodyweight ? ' powt.' : ' kg';
    const svg = el('div');
    svg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px"><polyline fill="none" stroke="#33e0ff" stroke-width="2" points="${xy.map((q) => q.join(',')).join(' ')}"/>${xy.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3" fill="#33e0ff"><title>${esc(pts[i][0])}: ${pts[i][1]}${unit}</title></circle>`).join('')}<text x="20" y="14" fill="#9fd8ff" font-size="11">${esc(p.ex)} · ${p.bodyweight ? 'powtórzenia' : 'szacowany 1RM'}</text></svg>`;
    host.appendChild(svg);
  }

  const panel = {
    title: 'HEVY: TRENINGI I POSTĘP',
    glyph: '📈',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) return body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
      const status = el('div');
      const overall = el('div', 'w-mid');
      const list = el('div');
      const prog = el('div');
      const inp = el('input', 'inp');
      inp.placeholder = 'ćwiczenie, np. wyciskanie, squat';
      inp.style.flex = '1 1 200px';
      const dl = el('datalist');
      dl.id = `hevy-ex-${Math.random().toString(36).slice(2, 8)}`;
      inp.setAttribute('list', dl.id);
      const weeks = el('select', 'inp');
      for (const w of [4, 8, 12, 26, 52]) {
        const o = el('option', null, `${w} tyg.`);
        o.value = String(w);
        weeks.appendChild(o);
      }
      weeks.value = '12';
      const show = async () => {
        if (!inp.value.trim()) return;
        chart(prog, await api(`/api/hevy/progress?ex=${encodeURIComponent(inp.value.trim())}&weeks=${weeks.value}`).catch((e) => ({ error: e.message })));
      };
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && show());
      const sync = button('SYNCHRONIZUJ TERAZ', async () => {
        const r = await api('/api/hevy/sync', { method: 'POST' });
        toast(r.added ? `Hevy: ${r.added} nowych treningów` : r.updated || r.removed ? `Hevy: zmienione ${r.updated}, usunięte ${r.removed}` : 'Hevy: brak nowych treningów', 'ok');
        window.dispatchEvent(new CustomEvent('jarvis:fit'));
        load();
      });
      // Eksport z aplikacji Hevy dziala bez Pro i bez zadnych kluczy.
      const csvFile = el('input');
      csvFile.type = 'file';
      csvFile.accept = '.csv,text/csv,text/comma-separated-values';
      csvFile.addEventListener('change', async () => {
        const f = csvFile.files?.[0];
        if (!f) return;
        try {
          if (f.size > 7 * 1024 * 1024) throw new Error('Plik jest za duży (ponad 7 MB).');
          const r = await api('/api/hevy/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: await f.text() }) });
          toast(`Hevy CSV: ${r.added} nowych treningów${r.skipped ? `, ${r.skipped} już było` : ''}`, 'ok');
          window.dispatchEvent(new CustomEvent('jarvis:fit'));
          load();
        } catch (e) {
          toast(e.message);
        }
        csvFile.value = '';
      });
      const csvBox = el('div');
      csvBox.append(el('div', 'sub', 'Eksport z aplikacji (bez Pro):'), el('div', 'w-dim', 'W Hevy: Profil → ⚙ Ustawienia → Eksport i import danych → Eksportuj treningi. Plik CSV wybierz tutaj (na telefonie prosto z Pobranych). Kolejne eksporty dokładają tylko nowe treningi.'), row(csvFile));
      body.append(status, row(sync), overall, el('div', 'sub', 'Ostatnie treningi:'), list, el('div', 'sub', 'Postęp ćwiczenia:'), row(inp, dl, weeks, button('POKAŻ', show)), prog);

      async function load() {
        const s = await api('/api/hevy/status');
        status.innerHTML = '';
        if (!s.configured) {
          sync.style.display = 'none';
          if (s.oauth) {
            // Aplikacja ustawiona na serwerze: zostalo zalogowac sie kontem Hevy.
            status.appendChild(el('div', 'w-mid', `Hevy niepołączone${s.workouts ? ` · ${s.workouts} treningów z pliku` : ''}.`));
            status.appendChild(row(button('POŁĄCZ Z HEVY', async () => {
              const r = await api('/api/hevy/auth-url');
              location.href = r.url;
            }, 'btn primary'), el('span', 'w-dim', 'zalogujesz się kontem Hevy i wrócisz tutaj')));
          } else {
            status.appendChild(el('div', 'w-mid', `Hevy bez połączenia${s.workouts ? ` · ${s.workouts} treningów z pliku` : ''}. Połączenie bez Hevy Pro (raz, ok. 5 minut):`));
            const steps = [
              '1. Na developers.hevy.com zaloguj się kontem Hevy → OAuth app → utwórz aplikację (np. „Jarvis”).',
              '2. Zakresy: read-workout, read-routine, read-exercise, read-body-measurement, read-profile. Adres przekierowania (redirect URI) wklej ten niżej.',
              '3. Na Render: usługa Jarvisa → Environment → HEVY_CLIENT_ID i HEVY_CLIENT_SECRET z tej aplikacji, zapisz. Sekretu nie wklejaj do czatu.',
              '4. Wróć tutaj i kliknij POŁĄCZ Z HEVY. Z kluczem Pro wystarczy samo HEVY_API_KEY.',
            ];
            for (const t of steps) status.appendChild(el('div', 'w-dim', t));
            const uri = s.redirectUri || `${location.origin}/api/hevy/oauth/callback`;
            status.appendChild(row(el('code', 'w-mid', uri), button('KOPIUJ', async () => {
              await navigator.clipboard.writeText(uri);
              toast('Skopiowano adres przekierowania.', 'ok');
            }, 'btn ghost')));
          }
        } else {
          sync.style.display = '';
          status.appendChild(el('div', 'w-mid', `Hevy${s.user?.name ? `: ${s.user.name}` : ''} · ${s.workouts} treningów${s.lastOk ? ` · sprawdzone ${ago(s.lastOk)}` : ' · jeszcze nie zsynchronizowane'}`));
          if (s.error) status.appendChild(el('div', 'hint', s.error));
          if (s.webhookPath) {
            // Adres do wklejenia w Hevy (strona klucza API -> webhook): nowy trening opisany od razu, bez czekania 20 minut.
            const url = `${location.origin}${s.webhookPath}`;
            const copy = button(s.webhookAt ? 'WEBHOOK DZIAŁA · KOPIUJ ADRES' : 'KOPIUJ ADRES WEBHOOKA', async () => {
              await navigator.clipboard.writeText(url);
              toast(`Skopiowano. Wklej w Hevy: developers.hevy.com → ${s.mode === 'oauth' ? 'OAuth app → webhook URL' : 'API key & webhooks'}.`, 'ok');
            }, 'btn ghost');
            status.appendChild(row(copy, el('span', 'w-dim', s.webhookAt ? `ostatni sygnał ${ago(s.webhookAt)}` : 'natychmiastowy opis po zapisaniu treningu')));
          }
          if (s.mode === 'oauth') {
            status.appendChild(row(button('ROZŁĄCZ HEVY', async () => {
              if (!window.confirm('Rozłączyć konto Hevy? Pobrane treningi zostają.')) return;
              await api('/api/hevy/disconnect', { method: 'POST' });
              load();
            }, 'btn ghost')));
          }
        }
        status.appendChild(csvBox);
        if (s.csvAt && !s.configured) status.appendChild(el('div', 'w-dim', `Ostatni plik wczytany ${ago(s.csvAt)}.`));
        if (!s.workouts) {
          overall.textContent = '';
          list.innerHTML = '';
          return;
        }
        const [o, w, ex] = await Promise.all([api('/api/hevy/progress'), api('/api/hevy/workouts?limit=8'), api('/api/hevy/exercises')]);
        overall.textContent = o.text || '';
        list.innerHTML = '';
        for (const d of w.workouts) {
          const item = el('div', 'row-text', d.text);
          item.style.cssText = `margin:4px 0;padding:4px 0 4px 8px;border-left:2px solid ${d.prs.length ? '#ffd166' : 'rgba(51,224,255,.4)'}`;
          list.appendChild(item);
        }
        dl.innerHTML = '';
        for (const e of ex.exercises) {
          const o2 = el('option');
          o2.value = e.ex;
          dl.appendChild(o2);
        }
        if (!inp.value && ex.exercises[0]) {
          inp.value = ex.exercises[0].ex;
          show();
        }
      }
      load().catch((e) => (status.textContent = e.message));
      const h = () => {
        if (!document.body.contains(body)) return window.removeEventListener('jarvis:life', h);
        load().catch(() => {});
      };
      window.addEventListener('jarvis:life', h);
    },
  };

  UI.extend('trening', { fit_hevy: panel });
})();
