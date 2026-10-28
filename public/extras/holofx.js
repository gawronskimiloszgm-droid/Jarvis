// Drobne efekty holograficzne interfejsu, kazdy do wlaczenia osobno (Ustawienia -> HOLOGRAM):
//  trail  - swietlista smuga za kursorem (canvas na wierzchu, nie lapie myszy),
//  magnet - przyciski lekko "przyciagaja sie" do kursora,
//  ripple - fala swiatla od miejsca klikniecia,
//  tilt   - karty pochylaja sie w 3D pod kursorem i maja odblask,
//  dof    - rozmycie glebi ostrosci: panele w tle sa lekko nieostre, aktywny ostry.
// Wszystko wylaczone przy trybie "off", animacjach oszczednych i na ekranach dotykowych (poza ripple).
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;

  const touch = matchMedia('(pointer: coarse)').matches;
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
  const DEFAULTS = { trail: touch ? '0' : '1', magnet: '0', ripple: '1', tilt: '0', dof: '0' };
  const enabled = (k) => get(`jarvis.fx.${k}`, DEFAULTS[k]) === '1' && document.body.dataset.holo !== 'off' && get('jarvis.motion', 'full') !== 'off';
  const flag = (k) => get(`jarvis.fx.${k}`, DEFAULTS[k]) === '1';

  UI.holoFx = {
    enabled: flag,
    toggle(k) {
      put(`jarvis.fx.${k}`, flag(k) ? '0' : '1');
      sync();
    },
  };

  const col = () => getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#33e0ff';

  // ---------- smuga kursora ----------
  let trail = null;
  const pts = [];
  function ensureTrail() {
    if (trail) return;
    const cv = document.createElement('canvas');
    cv.className = 'holo-trail';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    const size = () => {
      cv.width = innerWidth;
      cv.height = innerHeight;
    };
    size();
    addEventListener('resize', size);
    trail = { cv, g };
    const loop = () => {
      requestAnimationFrame(loop);
      if (!enabled('trail')) {
        if (pts.length) { pts.length = 0; g.clearRect(0, 0, cv.width, cv.height); }
        return;
      }
      g.clearRect(0, 0, cv.width, cv.height);
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        p.life -= 0.035;
        if (p.life <= 0) { pts.splice(i, 1); continue; }
      }
      if (pts.length < 2) return;
      const c = col();
      g.lineCap = 'round';
      g.shadowColor = c;
      g.shadowBlur = 10;
      for (let i = 1; i < pts.length; i++) {
        g.strokeStyle = c;
        g.globalAlpha = Math.max(0, pts[i].life) * 0.7;
        g.lineWidth = 1 + pts[i].life * 3;
        g.beginPath();
        g.moveTo(pts[i - 1].x, pts[i - 1].y);
        g.lineTo(pts[i].x, pts[i].y);
        g.stroke();
      }
      g.globalAlpha = 1;
    };
    loop();
  }
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !flag('trail')) return;
    ensureTrail();
    pts.push({ x: e.clientX, y: e.clientY, life: 1 });
    if (pts.length > 40) pts.shift();
  });

  // ---------- fala po kliknieciu ----------
  addEventListener('pointerdown', (e) => {
    if (!flag('ripple') || document.body.dataset.holo === 'off' || get('jarvis.motion', 'full') === 'off') return;
    const r = document.createElement('i');
    r.className = 'holo-ripple';
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 650);
  });

  // ---------- magnetyczne przyciski i pochylanie kart ----------
  let hot = null;
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest ? e.target : null;
    if (!t) return;
    if (flag('magnet') && enabled('magnet')) {
      const b = t.closest('button, .btn, .nav-item, .palette-item');
      if (b) {
        const r = b.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        b.style.translate = `${(dx * 5).toFixed(1)}px ${(dy * 4).toFixed(1)}px`;
        if (hot && hot !== b) hot.style.translate = '';
        hot = b;
      } else if (hot) {
        hot.style.translate = '';
        hot = null;
      }
    }
    if (flag('tilt') && enabled('tilt')) {
      const card = t.closest('.w, .panel, .kcard');
      document.querySelectorAll('[data-tilt="1"]').forEach((x) => {
        if (x !== card) {
          x.dataset.tilt = '0';
          x.style.rotate = '';
        }
      });
      if (card) {
        const r = card.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        card.dataset.tilt = '1';
        card.style.rotate = `${(-ny).toFixed(3)} ${nx.toFixed(3)} 0 ${(Math.hypot(nx, ny) * 12).toFixed(2)}deg`;
        card.style.setProperty('--gx', `${((nx + 0.5) * 100).toFixed(0)}%`);
        card.style.setProperty('--gy', `${((ny + 0.5) * 100).toFixed(0)}%`);
      }
    }
  });

  function sync() {
    ['trail', 'magnet', 'ripple', 'tilt', 'dof'].forEach((k) => document.body.classList.toggle(`fx-${k}`, flag(k)));
    if (flag('trail')) ensureTrail();
    if (!flag('magnet') && hot) {
      hot.style.translate = '';
      hot = null;
    }
  }
  sync();

  // Start aplikacji: moduly "wlaczaja sie" po kolei (klasa holo-boot na ~1.6 s) + krotki glitch.
  window.addEventListener('jarvis:ready', () => {
    if (document.body.dataset.holo !== 'full') return;
    document.body.classList.add('holo-boot');
    UI.holo?.glitch?.();
    setTimeout(() => document.body.classList.remove('holo-boot'), 1700);
  }, { once: true });
})();
