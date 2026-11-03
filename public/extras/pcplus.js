// Komputer: porzadki na dysku (tylko odczyt), przypinanie okien, przerwy od ekranu i diagnostyka
// akcji aplikacji desktopowej. Wszystko idzie przez polityke E.D.I.T.H. w aplikacji.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.extend) return;
  const { el, toast } = UI;
  const D = () => window.jarvisDesktop;
  const run = (name, params) => D().runAction(name, params || {});

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
      try {
        await fn();
      } catch (e) {
        toast(e.message);
      }
    });
    return b;
  };
  const bar = (pct, label, warn) => {
    const wrap = el('div');
    wrap.style.margin = '5px 0';
    const track = el('div');
    track.style.cssText = 'height:7px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden';
    const fill = el('div');
    fill.style.cssText = `height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${warn ? '#ff5d5d' : 'var(--blue,#33e0ff)'}`;
    track.appendChild(fill);
    wrap.append(el('div', warn ? 'w-mid' : 'w-dim', label), track);
    return wrap;
  };
  const needDesktop = (body) => {
    if (D()) return false;
    body.appendChild(el('div', 'hint', 'To działa w aplikacji J.A.R.V.I.S na komputerze.'));
    return true;
  };

  // ================= PORZADKI I OKNA =================
  const tidy = {
    title: 'DYSKI, POBRANE I OKNA',
    glyph: '🗂',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (needDesktop(body)) return;
      const disks = el('div');
      const dl = el('div');
      const title = el('input', 'inp');
      title.placeholder = 'fragment tytułu okna, np. Kalkulator';
      title.style.flex = '1 1 220px';
      body.append(el('div', 'sub', 'Miejsce na dyskach:'), disks, el('div', 'sub', 'Pobrane (tylko podgląd, nic nie jest usuwane):'), dl, el('div', 'sub', 'Okno zawsze na wierzchu:'), row(title, button('PRZYPNIJ', async () => {
        const r = await run('przypnij-okno', { tytul: title.value, wl: true });
        if (!r.ok) throw new Error(r.error || 'Nie udało się.');
        toast(`Na wierzchu: ${r.title}`, 'ok');
      }, 'btn primary'), button('ODEPNIJ', async () => {
        const r = await run('przypnij-okno', { tytul: title.value, wl: false });
        if (!r.ok) throw new Error(r.error || 'Nie udało się.');
        toast(`Odpięte: ${r.title}`, 'ok');
      })));
      (async () => {
        const d = await run('dyski');
        disks.innerHTML = '';
        for (const x of d.dyski || []) disks.appendChild(bar(x.usedPct, `${x.drive} wolne ${x.freeGb} GB z ${x.totalGb} GB${x.freeGb / x.totalGb < 0.1 ? ' - mało miejsca' : ''}`, x.freeGb / x.totalGb < 0.1));
        dl.textContent = 'Liczę...';
        const f = await run('duze-pliki');
        dl.innerHTML = '';
        if (!f.ok) return dl.appendChild(el('div', 'hint', f.error || 'Nie udało się odczytać.'));
        dl.appendChild(el('div', 'w-mid', `${f.count} plików, ${(f.totalBytes / 1e9).toFixed(1)} GB · starsze niż 90 dni: ${f.oldCount} (${(f.oldBytes / 1e9).toFixed(1)} GB)`));
        for (const x of f.biggest) dl.appendChild(el('div', 'w-dim', `${x.mb} MB · ${x.days} dni · ${x.name}`));
        dl.appendChild(row(button('OTWÓRZ FOLDER POBRANE', () => run('otworz-pobrane'), 'btn ghost')));
      })().catch((e) => toast(e.message));
    },
  };

  // ================= PRZERWY OD EKRANU =================
  const KEY = 'jarvis.breaks';
  const prefs = () => {
    try {
      return { eyes: false, stand: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { eyes: false, stand: false };
    }
  };
  const last = { eyes: Date.now(), stand: Date.now() };
  function remind(kind, text) {
    if (UI.dnd?.active || document.body.classList.contains('cinema')) return; // cisza i tryb gry/kina maja pierwszenstwo
    window.SFX?.play?.('ok');
    toast(text, 'ok');
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('J.A.R.V.I.S', { body: text });
    } catch {
      /* powiadomienia sa dodatkiem */
    }
    UI.activity?.emit('przerwa', text);
  }
  setInterval(() => {
    if (!D()) return;
    const p = prefs();
    const now = Date.now();
    if (p.eyes && now - last.eyes >= 20 * 60000) {
      last.eyes = now;
      remind('eyes', 'Zasada 20-20-20: spójrz przez 20 sekund na coś oddalonego o kilka metrów.');
    }
    if (p.stand && now - last.stand >= 60 * 60000) {
      last.stand = now;
      remind('stand', 'Godzina przy komputerze. Wstań, rozciągnij się i napij wody.');
    }
  }, 30000);
  const breaks = {
    title: 'PRZERWY OD EKRANU',
    glyph: '👁',
    build(body) {
      body.innerHTML = '';
      const p = prefs();
      const box = (k, label) => {
        const l = el('label', 'row-text');
        l.style.display = 'block';
        const c = el('input');
        c.type = 'checkbox';
        c.checked = p[k];
        c.addEventListener('change', () => {
          const cur = prefs();
          cur[k] = c.checked;
          last[k] = Date.now();
          localStorage.setItem(KEY, JSON.stringify(cur));
          if (c.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
        });
        l.append(c, ` ${label}`);
        return l;
      };
      body.append(el('div', 'sub', 'Przypomnienia w aplikacji na komputerze. Milczą w trybie „nie przeszkadzać” i podczas gry.'), box('eyes', 'Co 20 minut: odpoczynek dla oczu (20-20-20)'), box('stand', 'Co godzinę: wstań i się rozciągnij'));
    },
  };

  // ================= DIAGNOSTYKA =================
  // Akcje, z ktorych korzystaja glos i agent: gdy ktorejs brakuje, aplikacja jest starsza niz serwer.
  const EXPECTED = ['otworz-strone', 'kursor-jarvisa', 'spotify-graj', 'otworz-link', 'przypnij-okno', 'duze-pliki', 'dyski', 'otworz-pobrane', 'lista-elementow', 'kliknij-element', 'wpisz-w-element', 'kliknij-na-ekranie', 'pisz-tekst', 'otworz-aplikacje', 'przelacz-okno', 'zrzut-i-opisz', 'blender-status', 'lista-okien'];
  const PROBES = [
    ['lista-okien', 'Lista okien', (r) => `${(r.windows || []).length} okien`],
    ['lista-elementow', 'Elementy aktywnego okna', (r) => `${(r.elements || []).length} elementów w „${r.window || '?'}”`],
    ['dyski', 'Dyski', (r) => `${(r.dyski || []).length} dysków`],
    ['telemetria', 'Telemetria', () => 'odczytana'],
    ['blender-status', 'Blender', (r) => (r.found || r.path ? 'zainstalowany' : 'brak (opcjonalny)')],
  ];
  const diag = {
    title: 'DIAGNOSTYKA NARZĘDZI',
    glyph: '🩺',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (needDesktop(body)) return;
      const out = el('div');
      const go = button('SPRAWDŹ', async () => {
        out.innerHTML = '';
        const line = (ok, text) => out.appendChild(el('div', ok ? 'w-dim' : 'w-mid', `${ok ? '✓' : '✗'} ${text}`));
        let known = [];
        try {
          const r = await run('lista-akcji');
          known = r.akcje || [];
        } catch {
          /* starsza aplikacja nie zna tej akcji */
        }
        const missing = EXPECTED.filter((a) => !known.includes(a));
        line(!missing.length, known.length ? (missing.length ? `Brakuje akcji: ${missing.join(', ')} - zaktualizuj aplikację (Ustawienia → Aplikacja).` : `Wszystkie ${EXPECTED.length} potrzebne akcje są w tej wersji aplikacji.`) : 'Ta wersja aplikacji nie umie wypisać akcji - jest starsza niż serwer, zaktualizuj ją.');
        for (const [name, label, fmt] of PROBES) {
          const t = performance.now();
          try {
            const r = await run(name);
            const ms = Math.round(performance.now() - t);
            line(r && r.ok !== false && !r.blocked, `${label}: ${r?.blocked ? `zablokowane (${r.edithReason || 'E.D.I.T.H.'})` : r?.ok === false ? r.error : fmt(r)} · ${ms} ms`);
          } catch (e) {
            line(false, `${label}: ${e.message}`);
          }
        }
        try {
          const h = await fetch('/api/health').then((r) => r.json());
          line(h.geminiKeyWorks !== false, `Serwer ${h.version}: klucz AI ${h.geminiKeyWorks ? 'działa' : 'NIE działa'}, pamięć ${h.memoryPersistent ? 'trwała' : 'tymczasowa'}`);
        } catch (e) {
          line(false, `Serwer: ${e.message}`);
        }
      }, 'btn primary');
      body.append(el('div', 'sub', 'Sprawdza tylko odczytem (niczego nie klika ani nie otwiera), czy akcje komputera działają w tej wersji aplikacji.'), row(go), out);
    },
  };

  UI.extend('machine', { pc_tidy: tidy, pc_breaks: breaks, pc_diag: diag });
})();
