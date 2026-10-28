// Telefon / PWA: przeciagniecie palcem miedzy modulami, wibracje przy potwierdzeniach i bledach,
// pasek szybkich akcji na dole, tryb jednej reki (duze przyciski), czysta czern OLED oraz baner
// zachety do instalacji aplikacji. Ustawienia w Ustawienia -> TELEFON.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, toast, isOwner } = UI;
  const coarse = matchMedia('(pointer: coarse)').matches;

  const get = (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : v;
    } catch {
      return d;
    }
  };
  const put = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* brak pamieci */
    }
  };
  const flag = (k, d) => get(`jarvis.m.${k}`, d ? '1' : '0') === '1';
  const setFlag = (k, v) => {
    put(`jarvis.m.${k}`, v ? '1' : '0');
    apply();
  };

  function apply() {
    document.body.classList.toggle('m-oled', flag('oled', false));
    document.body.classList.toggle('m-onehand', flag('onehand', false));
    document.body.classList.toggle('m-quickbar', flag('quickbar', coarse) && isOwner());
    drawQuickBar();
  }

  // ---------- wibracje ----------
  const buzz = (p) => {
    if (!flag('haptics', true) || !navigator.vibrate) return;
    try {
      navigator.vibrate(p);
    } catch {
      /* brak wibracji */
    }
  };
  UI.buzz = buzz;
  window.addEventListener('jarvis:toast', (e) => buzz(e.detail?.kind === 'ok' ? 12 : [30, 40, 30]));
  window.addEventListener('jarvis:alarm', () => buzz([200, 100, 200, 100, 400]));

  // ---------- przeciagniecie miedzy modulami ----------
  function moduleButtons() {
    return [...document.querySelectorAll('#dock .dock-btn')];
  }
  let sx = 0;
  let sy = 0;
  let st = 0;
  let blocked = false;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.target;
    // Nie przechwytujemy gestow na suwakach, polach, plotnach 3D, tablicy i tabeli.
    blocked = Boolean(t.closest && t.closest('input, textarea, select, canvas, .kanban, .holo-table, .plan-grid, .cad-tools, [draggable="true"]'));
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    st = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (blocked || !flag('swipe', coarse) || !isOwner()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - st > 600) return;
    if (!e.target.closest || !e.target.closest('.stage-body')) return;
    const btns = moduleButtons();
    const i = btns.findIndex((b) => b.classList.contains('active') || b.classList.contains('on') || b.classList.contains('sel'));
    if (i < 0) return;
    const next = btns[(i + (dx < 0 ? 1 : -1) + btns.length) % btns.length];
    if (next) {
      buzz(10);
      next.click();
    }
  }, { passive: true });

  // ---------- pasek szybkich akcji ----------
  let bar = null;
  function drawQuickBar() {
    if (!bar) {
      bar = el('div', 'quickbar');
      document.body.appendChild(bar);
    }
    bar.hidden = !(flag('quickbar', coarse) && isOwner());
    if (bar.hidden) return;
    bar.innerHTML = '';
    const btn = (label, title, fn) => {
      const b = el('button', 'qb', label);
      b.title = title;
      b.addEventListener('click', () => {
        buzz(12);
        fn();
      });
      bar.appendChild(b);
    };
    btn('🎙', 'Rozmowa', () => UI.toggleListening?.());
    btn('💧', 'Woda +1', () => UI.life.setDaily({ waterDelta: 1 }).then((r) => toast(`Woda dzis: ${r.water}`, 'ok')).catch((e) => toast(e.message)));
    btn('🛒', 'Zakupy', () => UI.openWindow('shop'));
    btn('✎', 'Szybka notatka', () => {
      const t = prompt('Szybka notatka:');
      if (t && t.trim()) UI.quickCapture ? UI.quickCapture(t) : UI.life.add('quicknotes', { text: t.trim() });
    });
    btn('🎬', 'Tryb kina', () => UI.cinema?.toggle());
    btn('⌕', 'Paleta', () => document.getElementById('paletteBtn')?.click());
  }

  // ---------- baner instalacji ----------
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (get('jarvis.m.installDismissed', '0') === '1' || matchMedia('(display-mode: standalone)').matches) return;
    const b = el('div', 'install-banner');
    b.append(el('span', null, 'Zainstaluj Jarvisa jako aplikacje - pelny ekran i szybszy start.'));
    const yes = el('button', 'btn primary', 'ZAINSTALUJ');
    yes.addEventListener('click', async () => {
      b.remove();
      deferred?.prompt();
      await deferred?.userChoice.catch(() => {});
      deferred = null;
    });
    const no = el('button', 'btn ghost', 'POZNIEJ');
    no.addEventListener('click', () => {
      put('jarvis.m.installDismissed', '1');
      b.remove();
    });
    b.append(yes, no);
    document.body.appendChild(b);
  });
  window.addEventListener('appinstalled', () => document.querySelector('.install-banner')?.remove());

  // ---------- ustawienia ----------
  UI.extend('set', {
    mobile: {
      title: 'TELEFON',
      glyph: '▯',
      build(body) {
        body.innerHTML = '';
        body.appendChild(el('div', 'sub', 'Gesty, wibracje i uklad dla telefonu. Dziala tez na komputerze (do testow).'));
        [
          ['swipe', 'Przeciagniecie w bok przelacza moduly', coarse],
          ['haptics', 'Wibracje przy potwierdzeniach i alarmach', true],
          ['quickbar', 'Pasek szybkich akcji na dole', coarse],
          ['onehand', 'Tryb jednej reki (duze przyciski, dol ekranu)', false],
          ['oled', 'Czysta czern (oszczedza bateria OLED)', false],
        ].forEach(([k, label, def]) => {
          const r = el('label', 'kv');
          const c = el('input');
          c.type = 'checkbox';
          c.checked = flag(k, def);
          c.addEventListener('change', () => setFlag(k, c.checked));
          r.append(el('span', null, label), c);
          body.appendChild(r);
        });
        if (deferred) {
          const b = el('button', 'btn primary', 'ZAINSTALUJ APLIKACJE');
          b.addEventListener('click', () => deferred.prompt());
          body.appendChild(b);
        }
      },
    },
  });

  window.addEventListener('jarvis:ready', apply);
  apply();
})();
