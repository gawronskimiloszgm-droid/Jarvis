// Filmowe powitanie w aplikacji desktopowej: przy starcie (raz na kilka godzin) oraz po
// wybudzeniu / odblokowaniu komputera. Wylaczane w Ustawieniach (Glos i spokoj).
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { api, isOwner, pushSaid, speak, el } = UI;
  const D = () => window.jarvisDesktop;
  const KEY = 'jarvis.greetAt';
  const ON = 'jarvis.greet';

  const get = (k, d) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  };
  const put = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* bez localStorage powitanie moze sie powtorzyc */
    }
  };

  async function greet(kind, minGapMs) {
    if (!isOwner() || get(ON, '1') !== '1') return;
    if (Date.now() - Number(get(KEY, '0')) < minGapMs) return;
    put(KEY, String(Date.now()));
    try {
      const r = await api(`/api/greeting?kind=${kind}`);
      if (!r.text) return;
      pushSaid?.('jv', r.text);
      speak?.(r.text);
    } catch {
      /* powitanie to dodatek */
    }
  }
  UI.greet = greet;

  window.addEventListener('jarvis:ready', () => {
    if (!D()) return;
    // Start aplikacji: najwyzej raz na 3 godziny (restart aplikacji to jeszcze nie "nowy dzien").
    setTimeout(() => greet('start', 3 * 3600000), 2500);
    D().onCommand?.((c) => {
      if (c?.type === 'greet') greet('resume', 45 * 60000);
    });
  });

  const def = {
    title: 'POWITANIE',
    glyph: '☀',
    build(body) {
      body.innerHTML = '';
      const on = get(ON, '1') === '1';
      body.appendChild(el('div', 'row-text', on ? 'Jarvis wita sie meldunkiem przy starcie komputera i po powrocie (wybudzenie, odblokowanie).' : 'Powitanie wylaczone.'));
      const row = el('div', 'field');
      row.style.marginTop = '8px';
      const t = el('button', on ? 'btn ghost' : 'btn primary', on ? 'WYLACZ' : 'WLACZ');
      t.addEventListener('click', () => {
        put(ON, on ? '0' : '1');
        def.build(body);
      });
      const test = el('button', 'btn', 'POWITAJ TERAZ');
      test.addEventListener('click', () => {
        put(KEY, '0');
        greet('resume', 0);
      });
      row.append(t, test);
      body.appendChild(row);
    },
  };
  UI.extend('set', { greet: def });
})();
