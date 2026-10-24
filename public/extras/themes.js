// Wyglad: motywy kolorystyczne i tryb ograniczonych animacji.
//  - motyw to jedna barwa bazowa przeliczana na zmienne CSS (+ kolory rdzenia),
//  - "oszczedny" tnie klatki animacji canvas do ok. 20/s, "wylaczony" zatrzymuje
//    animacje CSS i zostawia ok. 1 klatke/s (telefon, slabszy laptop, bateria).
// Domyslnie szanujemy systemowe prefers-reduced-motion.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el } = UI;

  const THEMES = {
    cyjan: { label: 'Cyjan (domyslny)', rgb: [51, 224, 255] },
    bursztyn: { label: 'Bursztyn', rgb: [255, 182, 72] },
    zielony: { label: 'Zielony', rgb: [61, 255, 176] },
    fiolet: { label: 'Fiolet', rgb: [170, 140, 255] },
    mono: { label: 'Monochrom', rgb: [225, 225, 225] },
  };
  const MOTION = { full: 'Pelne', low: 'Oszczedne (~20 kl./s)', off: 'Wylaczone' };

  const get = (k, d) => {
    try {
      return localStorage.getItem(k) || d;
    } catch {
      return d;
    }
  };
  const put = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* tryb prywatny - ustawienie dziala do zamkniecia karty */
    }
  };

  const mix = (rgb, to, f) => rgb.map((c, i) => Math.round(c + (to[i] - c) * f));
  const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  const hex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');

  let style = null;
  function ensureStyle() {
    if (!style) {
      style = el('style');
      style.id = 'themeStyle';
      document.head.appendChild(style);
    }
    return style;
  }

  function applyTheme(name) {
    const t = THEMES[name] || THEMES.cyjan;
    const rgb = t.rgb;
    const ice = mix(rgb, [255, 255, 255], 0.55);
    const dim = mix(rgb, [127, 150, 160], 0.55);
    const txt = mix(rgb, [225, 235, 240], 0.82);
    let css = '';
    if (name !== 'cyjan' && THEMES[name]) {
      css = `:root {
        --line: ${rgba(rgb, 0.22)}; --line-2: ${rgba(rgb, 0.13)}; --line-3: ${rgba(rgb, 0.4)};
        --blue: ${hex(rgb)}; --ice: ${hex(ice)}; --dim: ${hex(dim)}; --txt: ${hex(txt)};
        --glow: 0 0 0 1px ${rgba(rgb, 0.22)}, 0 0 24px ${rgba(rgb, 0.1)}, inset 0 0 40px ${rgba(rgb, 0.03)};
      }`;
    }
    ensureStyle().textContent = css + motionCss();
    // Rdzen: kolory E.D.I.T.H. zostaja czerwone, zmieniamy tylko Jarvisa.
    const core = window.CORE_THEMES?.jarvis;
    if (core) {
      core.blue = (a) => rgba(rgb, a);
      core.ice = (a) => rgba(ice, a);
    }
    document.documentElement.dataset.theme = name;
  }

  function motionCss() {
    return get('jarvis.motion', defaultMotion()) === 'off'
      ? '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }'
      : '';
  }

  function defaultMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'low' : 'full';
    } catch {
      return 'full';
    }
  }

  // Ograniczenie klatek: opakowujemy requestAnimationFrame. Petle w app.js
  // wolaja je za kazdym razem z globalnego obiektu, wiec zmiana trybu dziala
  // od razu. Kazde wywolanie jest opozniane o stala przerwe (oszczedny ~50 ms,
  // wylaczony ~1 s), a cancelAnimationFrame obsluguje oba rodzaje uchwytow.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map();
  let seq = 1e9;
  window.requestAnimationFrame = (cb) => {
    const mode = get('jarvis.motion', defaultMotion());
    if (mode === 'full') return nativeRaf(cb);
    const id = ++seq;
    const entry = {};
    entry.t = setTimeout(() => {
      entry.r = nativeRaf((ts) => {
        pending.delete(id);
        cb(ts);
      });
    }, mode === 'low' ? 50 : 1000);
    pending.set(id, entry);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const p = pending.get(id);
    if (!p) return nativeCancel(id);
    clearTimeout(p.t);
    if (p.r) nativeCancel(p.r);
    pending.delete(id);
  };

  applyTheme(get('jarvis.theme', 'cyjan'));

  const def = {
    title: 'WYGLAD I ANIMACJE',
    glyph: '◐',
    build(body) {
      body.innerHTML = '';
      const pick = (title, options, current, onPick) => {
        body.appendChild(el('div', 'sub', title));
        const row = el('div', 'field');
        row.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0 12px';
        Object.entries(options).forEach(([key, v]) => {
          const b = el('button', key === current ? 'btn primary' : 'btn ghost', typeof v === 'string' ? v : v.label);
          b.addEventListener('click', () => {
            onPick(key);
            def.build(body);
          });
          row.appendChild(b);
        });
        body.appendChild(row);
      };
      pick('MOTYW KOLORYSTYCZNY', THEMES, get('jarvis.theme', 'cyjan'), (k) => {
        put('jarvis.theme', k);
        applyTheme(k);
      });
      pick('ANIMACJE', MOTION, get('jarvis.motion', defaultMotion()), (k) => {
        put('jarvis.motion', k);
        applyTheme(get('jarvis.theme', 'cyjan'));
      });
      body.appendChild(el('div', 'sub', 'Rdzen i tlo przyjmuja nowy kolor po odswiezeniu strony. Tryb oszczedny zmniejsza zuzycie baterii i procesora.'));
    },
  };
  UI.appearance = {
    setTheme(name) {
      put('jarvis.theme', name);
      applyTheme(name);
    },
    setMotion(mode) {
      put('jarvis.motion', mode);
      applyTheme(get('jarvis.theme', 'cyjan'));
    },
  };
  UI.extend('set', { appearance: def });
})();
