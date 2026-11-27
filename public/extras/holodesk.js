// Holo-biurko: obraz z kamery na caly ekran, a nad nim panele "w powietrzu" sterowane dlonia
// (MediaPipe przez HandGest): szczypniecie w przycisk = klik, szczypniecie w pustym miejscu = menu
// nowych paneli, szczypniecie z przytrzymaniem = chwyt i przenoszenie, szczypniecie z ruchem nad
// lista = przewijanie, szybki ruch otwarta dlonia w bok = zamkniecie wszystkich paneli. Mysz dziala
// tak samo (zapas, gdy kamera nie widzi dloni).
(function () {
  const UI = window.JarvisUI;
  const G = window.HandGest;
  if (!UI || !UI.register || !G) return;
  const { el, api, toast, isOwner } = UI;
  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const TYPES = { zegar: ['🕒', 'Zegar'], pogoda: ['☁', 'Pogoda'], wiadomosci: ['📰', 'Wiadomości'], muzyka: ['♫', 'Muzyka'], notatka: ['✎', 'Notatka'] };

  let root = null;
  let video = null;
  let overlay = null;
  let cursorEl = null;
  let tracker = null;
  let landmarker = null;
  let running = false;
  let handUiWasOn = false;
  let drag = null; // { panel, dx, dy }
  const panels = new Set();

  async function loadLandmarker() {
    if (landmarker) return landmarker;
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(files, make('GPU'));
    } catch {
      landmarker = await vision.HandLandmarker.createFromOptions(files, make('CPU'));
    }
    return landmarker;
  }

  // ---------- panele ----------
  function panelShell(type, x, y) {
    const [glyph, title] = TYPES[type];
    const p = el('div', 'hd-panel');
    p.dataset.type = type;
    const head = el('div', 'hd-head');
    const close = el('button', 'hd-x', '✕');
    close.type = 'button';
    close.addEventListener('click', () => removePanel(p));
    head.append(el('span', null, `${glyph} ${title}`), close);
    const body = el('div', 'hd-body');
    p.append(head, body);
    place(p, x, y);
    root.appendChild(p);
    panels.add(p);
    requestAnimationFrame(() => p.classList.add('on'));
    return { p, body };
  }
  function place(p, x, y) {
    const w = p.offsetWidth || 300;
    const h = p.offsetHeight || 200;
    p.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, x - w / 2))}px`;
    p.style.top = `${Math.max(6, Math.min(innerHeight - h - 90, y - 18))}px`;
  }
  function removePanel(p) {
    p.classList.remove('on');
    panels.delete(p);
    clearInterval(p._timer);
    setTimeout(() => p.remove(), 250);
  }
  function clearPanels() {
    [...panels].forEach((p, i) => setTimeout(() => removePanel(p), i * 60));
  }

  const fill = {
    zegar(body, p) {
      const t = el('div', 'hd-big');
      const d = el('div', 'hd-dim');
      body.append(t, d);
      const tick = () => {
        const n = new Date();
        t.textContent = n.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        d.textContent = n.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
      };
      tick();
      p._timer = setInterval(tick, 1000);
    },
    async pogoda(body) {
      body.textContent = 'Wczytuję...';
      const w = await api('/api/holo/weather');
      body.innerHTML = '';
      if (w.error) return (body.textContent = w.error);
      body.append(el('div', 'hd-big', `${Math.round(w.temperature)}°C`), el('div', null, w.condition || ''), el('div', 'hd-dim', w.city || ''));
    },
    async wiadomosci(body) {
      body.textContent = 'Wczytuję...';
      const r = await api('/api/holo/news');
      body.innerHTML = '';
      const list = el('div', 'hd-scroll');
      for (const n of r.items) {
        const item = el('div', 'hd-news');
        item.append(el('div', null, n.title), el('div', 'hd-dim', n.source || ''));
        item.addEventListener('click', () => window.open(n.link, '_blank', 'noopener'));
        list.appendChild(item);
      }
      body.appendChild(list);
    },
    async muzyka(body, p) {
      const draw = async () => {
        const r = await api('/api/spotify/now').catch(() => ({ connected: false }));
        body.innerHTML = '';
        if (!r.connected) return body.appendChild(el('div', 'hd-dim', 'Spotify niepołączone.'));
        body.append(el('div', null, r.track ? `${r.playing ? '▶' : '⏸'} ${r.track}` : 'Nic nie gra'), el('div', 'hd-dim', r.artist || ''));
        const row = el('div', 'hd-row');
        for (const [label, a] of [['⏮', 'poprzedni-utwor'], ['⏯', 'odtworz-pauza'], ['⏭', 'nastepny-utwor']]) {
          const b = el('button', 'hd-btn', label);
          b.type = 'button';
          b.addEventListener('click', () => UI.runDeviceAction?.(a, {}));
          row.appendChild(b);
        }
        body.appendChild(row);
      };
      await draw();
      p._timer = setInterval(() => draw().catch(() => {}), 15000);
    },
    notatka(body) {
      const t = el('textarea', 'hd-note');
      t.placeholder = 'Notatka (zostaje w tej przeglądarce)';
      try {
        t.value = localStorage.getItem('jarvis.holodesk.note') || '';
      } catch {
        /* bez pamieci przegladarki */
      }
      t.addEventListener('input', () => {
        try {
          localStorage.setItem('jarvis.holodesk.note', t.value);
        } catch {
          /* bez pamieci przegladarki */
        }
      });
      body.appendChild(t);
    },
  };
  /** Wolne miejsce na nowy panel: siatka 3x2 nad dokiem, pierwsze pole, w ktorym nic nie lezy. */
  function freeSpot() {
    const cols = [0.2, 0.5, 0.8];
    const rows = [0.2, 0.55];
    // Tresc (wiadomosci) wczytuje sie po chwili: panel rezerwuje od razu docelowa wysokosc.
    const busy = [...panels].map((p) => {
      const r = p.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: Math.max(r.bottom, r.top + 320) };
    });
    for (const ry of rows) {
      for (const cx of cols) {
        const x = cx * innerWidth;
        const y = ry * innerHeight;
        if (!busy.some((r) => x > r.left - 160 && x < r.right + 160 && y > r.top - 60 && y < r.bottom + 40)) return [x, y];
      }
    }
    // Ciasno (male okno): miejsce, gdzie nowy panel 300x220 najmniej zaslania pozostale.
    const overlap = (x, y) => busy.reduce((sum, r) => {
      const w = Math.max(0, Math.min(x + 150, r.right) - Math.max(x - 150, r.left));
      const h = Math.max(0, Math.min(y + 220, r.bottom) - Math.max(y - 18, r.top));
      return sum + w * h;
    }, 0);
    let best = [innerWidth / 2, innerHeight / 3];
    let bestScore = Infinity;
    for (let y = 40; y < innerHeight - 320; y += 40) {
      for (let x = 160; x < innerWidth - 150; x += 60) {
        const score = overlap(x, y);
        if (score < bestScore) [best, bestScore] = [[x, y], score];
      }
    }
    return best;
  }
  function openPanel(type, x, y) {
    if (!TYPES[type]) return;
    if (x == null) [x, y] = freeSpot();
    const { p, body } = panelShell(type, x, y);
    Promise.resolve(fill[type](body, p)).catch((e) => (body.textContent = e.message));
  }

  // Menu nowych paneli w miejscu szczypniecia (jak "pinch a panel").
  let radial = null;
  function showRadial(x, y) {
    radial?.remove();
    radial = el('div', 'hd-radial');
    radial.style.left = `${x}px`;
    radial.style.top = `${y}px`;
    Object.entries(TYPES).forEach(([type, [glyph, title]], i, all) => {
      const a = (i / all.length) * Math.PI * 2 - Math.PI / 2;
      const b = el('button', 'hd-rbtn', glyph);
      b.type = 'button';
      b.title = title;
      b.style.transform = `translate(${Math.cos(a) * 78}px, ${Math.sin(a) * 78}px)`;
      b.addEventListener('click', () => {
        radial?.remove();
        radial = null;
        openPanel(type, x, y);
      });
      radial.appendChild(b);
    });
    root.appendChild(radial);
    setTimeout(() => {
      if (radial && root?.contains(radial)) radial.remove();
    }, 6000);
  }

  // ---------- reczne sterowanie: zdarzenia trackera na elementy ekranu ----------
  const at = (x, y) => {
    cursorEl.style.display = 'none';
    const t = document.elementFromPoint(x, y);
    cursorEl.style.display = '';
    return t;
  };
  function handle(ev, px) {
    const x = px.x;
    const y = px.y;
    if (ev.type === 'tap') {
      const t = at(x, y);
      const btn = t?.closest?.('button, .hd-news');
      if (btn && root.contains(btn)) return btn.click();
      if (!t?.closest?.('.hd-panel, .hd-dock')) showRadial(x, y);
    } else if (ev.type === 'grab-start') {
      const p = at(x, y)?.closest?.('.hd-panel');
      if (p) {
        const r = p.getBoundingClientRect();
        drag = { panel: p, dx: x - r.left, dy: y - r.top };
        p.classList.add('held');
      }
    } else if (ev.type === 'grab-move' && drag) {
      drag.panel.style.left = `${x - drag.dx}px`;
      drag.panel.style.top = `${y - drag.dy}px`;
    } else if (ev.type === 'grab-end' && drag) {
      drag.panel.classList.remove('held');
      drag = null;
    } else if (ev.type === 'pan') {
      const s = at(x, y)?.closest?.('.hd-scroll');
      if (s) s.scrollTop -= ev.dy * innerHeight * 1.4;
    } else if (ev.type === 'swipe') {
      clearPanels();
      toast('Holo-biurko: zamknięte wszystkie panele.', 'ok');
    }
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!landmarker || video.readyState < 2) return;
    const now = performance.now();
    const res = landmarker.detectForVideo(video, now);
    const hands = res?.landmarks || [];
    const out = tracker.update(hands, now);
    drawHands(hands, out.pinch);
    if (out.visible) {
      const px = { x: out.cursor.x * innerWidth, y: out.cursor.y * innerHeight };
      cursorEl.style.transform = `translate(${px.x}px, ${px.y}px)`;
      cursorEl.classList.toggle('pinch', Boolean(out.pinch));
      cursorEl.style.opacity = '1';
      for (const ev of out.events) handle(ev, ev.x != null ? { x: ev.x * innerWidth, y: ev.y * innerHeight } : px);
    } else cursorEl.style.opacity = '0.25';
  }
  function drawHands(hands, pinch) {
    const g = overlay.getContext('2d');
    if (overlay.width !== innerWidth) {
      overlay.width = innerWidth;
      overlay.height = innerHeight;
    }
    g.clearRect(0, 0, overlay.width, overlay.height);
    g.strokeStyle = pinch ? 'rgba(255,179,71,.8)' : 'rgba(51,224,255,.7)';
    g.lineWidth = 2;
    const links = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    // Obraz z kamery jest odbity i wypelnia ekran (object-fit: cover): punkty w tych samych wspolrzednych.
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const k = Math.max(innerWidth / vw, innerHeight / vh);
    const ox = (innerWidth - vw * k) / 2;
    const oy = (innerHeight - vh * k) / 2;
    for (const h of hands) {
      const m = G.mirror(h).map((p) => ({ x: ox + p.x * vw * k, y: oy + p.y * vh * k }));
      g.beginPath();
      for (const [a, b] of links) {
        g.moveTo(m[a].x, m[a].y);
        g.lineTo(m[b].x, m[b].y);
      }
      g.stroke();
    }
  }

  // ---------- otwieranie i zamykanie ----------
  async function open() {
    if (root) return;
    root = el('div', 'hd-root');
    video = el('video', 'hd-video');
    video.muted = true;
    video.playsInline = true;
    overlay = el('canvas', 'hd-overlay');
    cursorEl = el('div', 'hd-cursor');
    const dock = el('div', 'hd-dock');
    for (const [type, [glyph, title]] of Object.entries(TYPES)) {
      const b = el('button', 'hd-dbtn', glyph);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', () => openPanel(type));
      dock.appendChild(b);
    }
    const clearBtn = el('button', 'hd-dbtn', '⊘');
    clearBtn.title = 'Zamknij wszystkie panele';
    clearBtn.addEventListener('click', clearPanels);
    const exitBtn = el('button', 'hd-dbtn hd-exit', '✕');
    exitBtn.title = 'Wyjdź z holo-biurka (Esc)';
    exitBtn.addEventListener('click', close);
    dock.append(clearBtn, exitBtn);
    const hint = el('div', 'hd-hint', 'Holo-biurko · szczypnij w pustym miejscu: nowy panel · przytrzymaj szczypnięcie: przenieś · szybki ruch dłonią w bok: zamknij wszystko · Esc: wyjście');
    root.append(video, overlay, hint, dock, cursorEl);
    root.addEventListener('pointerdown', (e) => {
      // Mysz: tlo otwiera menu, naglowek panelu przenosi.
      if (e.target === root || e.target === overlay || e.target === video) return showRadial(e.clientX, e.clientY);
      const p = e.target.closest('.hd-head')?.parentElement;
      if (!p) return;
      const r = p.getBoundingClientRect();
      drag = { panel: p, dx: e.clientX - r.left, dy: e.clientY - r.top };
      p.classList.add('held');
    });
    window.addEventListener('pointermove', mouseMove);
    window.addEventListener('pointerup', mouseUp);
    window.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    running = true;
    handUiWasOn = Boolean(UI.handUi?.isOn?.());
    if (handUiWasOn) UI.handUi.stop();
    try {
      video.srcObject = await (UI.camera ? UI.camera.acquire() : navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' } }));
      await video.play();
      tracker = G.createTracker({ ...G.loadOptions(), aspect: (video.videoWidth || 16) / (video.videoHeight || 9) });
      await loadLandmarker();
      loop();
    } catch (e) {
      toast(`Holo-biurko bez kamery: ${e.message}. Działa myszką.`);
    }
    openPanel('zegar', innerWidth * 0.78, innerHeight * 0.18);
  }
  function mouseMove(e) {
    if (!drag) return;
    drag.panel.style.left = `${e.clientX - drag.dx}px`;
    drag.panel.style.top = `${e.clientY - drag.dy}px`;
  }
  function mouseUp() {
    if (!drag) return;
    drag.panel.classList.remove('held');
    drag = null;
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  function close() {
    if (!root) return;
    running = false;
    panels.forEach((p) => clearInterval(p._timer));
    panels.clear();
    if (video?.srcObject) {
      if (UI.camera) UI.camera.release();
      else video.srcObject.getTracks().forEach((t) => t.stop());
    }
    window.removeEventListener('pointermove', mouseMove);
    window.removeEventListener('pointerup', mouseUp);
    window.removeEventListener('keydown', onKey);
    root.remove();
    root = null;
    if (handUiWasOn) UI.handUi?.start?.();
  }

  const css = el('style', null, `
    .hd-root{position:fixed;inset:0;z-index:9500;background:#000;overflow:hidden;color:#e8f6ff;font-family:system-ui}
    .hd-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);filter:saturate(.6) brightness(.75)}
    .hd-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .hd-root::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(51,224,255,.04) 0 1px,transparent 1px 3px)}
    .hd-panel{position:absolute;width:300px;min-height:90px;background:rgba(4,20,32,.72);border:1px solid rgba(51,224,255,.75);border-radius:10px;box-shadow:0 0 24px rgba(51,224,255,.35),inset 0 0 18px rgba(51,224,255,.12);backdrop-filter:blur(3px);opacity:0;transform:scale(.85);transition:opacity .25s,transform .25s,box-shadow .2s;z-index:2}
    .hd-panel.on{opacity:1;transform:scale(1)}
    .hd-panel.held{box-shadow:0 0 40px rgba(255,179,71,.6);border-color:#ffb347;z-index:3}
    .hd-head{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;font:600 12px monospace;letter-spacing:1px;border-bottom:1px solid rgba(51,224,255,.3);cursor:grab}
    .hd-x{background:none;border:1px solid rgba(255,107,107,.6);color:#ff8b8b;border-radius:50%;width:24px;height:24px;cursor:pointer}
    .hd-body{padding:10px 12px;font-size:14px}
    .hd-big{font:700 34px monospace;color:#9fe8ff}
    .hd-dim{color:#8fb8c8;font-size:12px}
    .hd-scroll{max-height:260px;overflow:auto}
    .hd-news{padding:6px 0;border-bottom:1px solid rgba(51,224,255,.15);cursor:pointer}
    .hd-row{display:flex;gap:8px;margin-top:8px}
    .hd-btn,.hd-dbtn,.hd-rbtn{background:rgba(4,30,46,.85);border:1px solid rgba(51,224,255,.7);color:#bff3ff;border-radius:50%;cursor:pointer}
    .hd-btn{width:40px;height:40px;font-size:16px}
    .hd-note{width:100%;min-height:120px;background:transparent;color:#e8f6ff;border:1px dashed rgba(51,224,255,.4);border-radius:6px}
    .hd-dock{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:12px;padding:8px 14px;background:rgba(2,12,20,.55);border:1px solid rgba(51,224,255,.4);border-radius:40px;z-index:4}
    .hd-dbtn{width:52px;height:52px;font-size:20px;box-shadow:0 0 12px rgba(51,224,255,.3)}
    .hd-exit{border-color:rgba(255,107,107,.7);color:#ff9b9b}
    .hd-radial{position:absolute;width:0;height:0;z-index:5}
    .hd-rbtn{position:absolute;left:-26px;top:-26px;width:52px;height:52px;font-size:20px;animation:hdpop .2s ease-out}
    @keyframes hdpop{from{opacity:0;transform:scale(.3)}}
    .hd-cursor{position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;border:2px solid #33e0ff;box-shadow:0 0 14px #33e0ff;pointer-events:none;z-index:6;transition:opacity .2s}
    .hd-cursor.pinch{background:rgba(255,179,71,.6);border-color:#ffb347;box-shadow:0 0 18px #ffb347}
    .hd-hint{position:absolute;left:50%;top:10px;transform:translateX(-50%);font:11px monospace;color:#9fd8ff;background:rgba(2,12,20,.5);padding:4px 10px;border-radius:12px;pointer-events:none;z-index:4;text-align:center}
  `);
  document.head.appendChild(css);

  UI.holoDesk = { open, close, openPanel, clearPanels, isOpen: () => Boolean(root) };
  UI.clientActions['holo-biurko'] = async (p) => {
    const a = p?.akcja;
    if (a === 'zamknij') return close();
    if (!root) await open();
    if (a === 'panel') openPanel(p.typ);
    if (a === 'wyczysc') clearPanels();
    return undefined;
  };

  const panel = {
    title: 'HOLO-BIURKO',
    glyph: '🖐',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) return body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
      const go = el('button', 'btn primary', 'WŁĄCZ HOLO-BIURKO');
      go.addEventListener('click', () => open().catch((e) => toast(e.message)));
      body.append(
        el('div', 'w-mid', 'Obraz z kamery na cały ekran i panele w powietrzu sterowane dłonią.'),
        el('div', 'w-dim', 'Szczypnięcie (kciuk + wskazujący) w przycisk = klik · szczypnięcie w pustym miejscu = menu nowych paneli · przytrzymane szczypnięcie = chwyć i przenieś · szczypnięcie z ruchem nad wiadomościami = przewijanie · szybki ruch otwartą dłonią w bok = zamknij wszystkie panele · Esc albo ⏻ = wyjście. Myszką działa tak samo.'),
        el('div', 'w-dim', 'Głosem: „otwórz holo-biurko”, „pokaż wiadomości na holo”, „zamknij wszystko”.'),
        go,
      );
    },
  };
  UI.register({ id: 'holobiurko', title: 'Holo-biurko', sub: 'panele w powietrzu, sterowanie dłonią', icon: '🖐', owner: true, group: 'Komputer', panels: { holodesk: panel } });
})();
