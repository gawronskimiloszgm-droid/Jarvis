// Sterowanie CALYM interfejsem gestami dloni (kamera + MediaPipe Hands, logika w handgest.js):
//   palec wskazujacy      -> kursor na ekranie (podswietla to, na co najezdzasz),
//   szczypniecie          -> klik w element pod kursorem,
//   szczypniecie + ruch   -> przewijanie (przeciagnij w gore/dol),
//   otwarta dlon w gore/dol -> przewijanie, szybki ruch w bok -> poprzedni/nastepny modul.
// Wlaczanie: Ustawienia -> GESTY DLONI, polecenie "dlon" w palecie albo skrot Alt+H.
// Gdy otwarty jest Graf wiedzy (ma wlasne gesty), warstwa globalna sie wstrzymuje.
(function () {
  const UI = window.JarvisUI;
  const G = window.HandGest;
  if (!UI || !G || !UI.extend) return;
  const { el, toast, isOwner } = UI;

  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  let landmarker = null;
  let stream = null;
  let video = null;
  let cursor = null;
  let preview = null;
  let raf = 0;
  let on = false;
  let hover = null;
  let tracker = null;
  let lastTime = -1;
  let swipe = { dx: 0, t: 0 };
  let dragEl = null;
  let shared = false;

  async function loadLandmarker() {
    if (landmarker) return landmarker;
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(files, opts('GPU'));
    } catch {
      landmarker = await vision.HandLandmarker.createFromOptions(files, opts('CPU'));
    }
    return landmarker;
  }

  // Najblizszy przewijalny rodzic elementu.
  function scroller(node) {
    let n = node;
    while (n && n !== document.body) {
      const st = getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
      n = n.parentElement;
    }
    const vis = [...document.querySelectorAll('.stage-body')].find((b) => b.offsetParent !== null && b.scrollHeight > b.clientHeight + 4);
    return vis || document.scrollingElement;
  }

  const clickable = (n) => n && n.closest && n.closest('button, a, input, select, textarea, label, [role=button], .dock-btn, .palette-item, .w-head, .kcard, summary');

  function underCursor(x, y) {
    if (cursor) cursor.style.pointerEvents = 'none';
    const n = document.elementFromPoint(x, y);
    return n;
  }

  function setHover(n) {
    const c = clickable(n);
    if (hover === c) return;
    hover?.classList.remove('hu-hover');
    hover = c || null;
    hover?.classList.add('hu-hover');
  }

  function graphActive() {
    const c = document.querySelector('.gk-canvas');
    return Boolean(c && c.isConnected && c.offsetParent !== null);
  }

  function handle(e, pos) {
    const x = pos.x * innerWidth;
    const y = pos.y * innerHeight;
    if (e.type === 'tap') {
      const under = underCursor(e.x * innerWidth, e.y * innerHeight);
      // Tylko elementy do klikania (i plotna) - szczypniecie w puste miejsce niczego nie uruchamia.
      const n = clickable(under) || (under && under.tagName === 'CANVAS' ? under : null);
      if (n) {
        UI.activity?.emit('gesty', `Klik gestem w "${String(n.textContent || n.title || n.tagName).trim().slice(0, 40)}"`);
        UI.buzz?.(10);
        if (n.focus && /^(input|textarea|select)$/i.test(n.tagName)) n.focus();
        else n.click?.();
        ripple(e.x * innerWidth, e.y * innerHeight);
      }
    } else if (e.type === 'grab-start') {
      dragEl = scroller(underCursor(e.x * innerWidth, e.y * innerHeight));
    } else if (e.type === 'grab-move' || e.type === 'pan') {
      const el2 = dragEl || scroller(underCursor(x, y));
      if (el2 && e.type === 'pan') el2.scrollTop -= e.dy * innerHeight * 1.8;
    } else if (e.type === 'grab-end') {
      dragEl = null;
    } else if (e.type === 'rotate') {
      const s = scroller(underCursor(x, y));
      if (s && Math.abs(e.dy) > Math.abs(e.dx)) s.scrollTop += e.dy * innerHeight * 0.9;
      // szybki ruch w bok = zmiana modulu
      const now = performance.now();
      if (now - swipe.t > 450) swipe = { dx: 0, t: now };
      swipe.dx += e.dx;
      if (Math.abs(swipe.dx) > 1.9 && Math.abs(e.dx) > Math.abs(e.dy)) {
        const btns = [...document.querySelectorAll('#dock .dock-btn')].filter((b) => !b.classList.contains('off'));
        const i = btns.findIndex((b) => b.classList.contains('on'));
        const nxt = btns[(i + (swipe.dx > 0 ? 1 : -1) + btns.length) % btns.length];
        swipe = { dx: 0, t: now + 900 };
        nxt?.click();
      }
    }
  }

  function ripple(x, y) {
    const r = el('i', 'holo-ripple');
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 650);
  }

  function drawPreview(hands) {
    if (!preview) return;
    const g = preview.getContext('2d');
    g.clearRect(0, 0, preview.width, preview.height);
    g.strokeStyle = '#33e0ff';
    g.fillStyle = '#ffb347';
    g.lineWidth = 1.5;
    const links = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    hands.forEach((h) => {
      const m = G.mirror(h);
      links.forEach(([a, b]) => {
        g.beginPath();
        g.moveTo(m[a].x * preview.width, m[a].y * preview.height);
        g.lineTo(m[b].x * preview.width, m[b].y * preview.height);
        g.stroke();
      });
      [4, 8, 12, 16, 20].forEach((i) => {
        g.beginPath();
        g.arc(m[i].x * preview.width, m[i].y * preview.height, 3, 0, 6.283);
        g.fill();
      });
    });
  }

  async function start() {
    if (on) return;
    if (!navigator.mediaDevices?.getUserMedia) return toast('Ta przegladarka nie udostepnia kamery.');
    try {
      const s = await (UI.camera ? UI.camera.acquire() : navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }));
          stream = s;
          shared = Boolean(UI.camera);
          const lm = await loadLandmarker();
      stream = s;
      video = el('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      await video.play();
      cursor = el('div', 'hu-cursor');
      preview = el('canvas', 'hu-preview');
      preview.width = 160;
      preview.height = 120;
      document.body.append(cursor, preview);
      tracker = G.createTracker();
      on = true;
      document.body.classList.add('hand-ui');
      toast('Gesty dloni: szczypnij, zeby kliknac; przeciagnij zeby przewinac.', 'ok');
      UI.activity?.emit('gesty', 'Gesty dloni aktywne w calym interfejsie', { react: true });
      const loop = () => {
        if (!on) return;
        raf = requestAnimationFrame(loop);
        if (video.readyState < 2 || video.currentTime === lastTime) return;
        lastTime = video.currentTime;
        let res;
        try {
          res = lm.detectForVideo(video, performance.now());
        } catch {
          return;
        }
        const hands = res.landmarks || [];
        drawPreview(hands);
        if (graphActive()) {
          cursor.style.opacity = '0';
          return;
        }
        const out = tracker.update(hands, performance.now());
        if (out.visible) {
          const x = out.cursor.x * innerWidth;
          const y = out.cursor.y * innerHeight;
          cursor.style.opacity = '1';
          cursor.style.transform = `translate(${x}px, ${y}px)`;
          cursor.classList.toggle('pinch', out.pinch);
          setHover(underCursor(x, y));
        } else {
          cursor.style.opacity = '0';
          setHover(null);
        }
        out.events.forEach((e) => handle(e, out.cursor));
      };
      loop();
    } catch (e) {
      stop();
      toast(UI.camera ? await UI.camera.explain(e) : `Gesty nie wystartowaly: ${e.message || e}`);
    }
  }

  function stop() {
    on = false;
    cancelAnimationFrame(raf);
    if (stream) {
      if (shared) UI.camera.release();
      else stream.getTracks().forEach((t) => t.stop());
    }
    stream = null;
    shared = false;
    video = null;
    cursor?.remove();
    preview?.remove();
    cursor = preview = null;
    setHover(null);
    document.body.classList.remove('hand-ui');
  }

  UI.handUi = { start, stop, toggle: () => (on ? stop() : start()), isOn: () => on, _event: handle };

  UI.extend('set', {
    handui: {
      title: 'GESTY DLONI',
      glyph: '✋',
      build(body) {
        body.innerHTML = '';
        body.appendChild(el('div', 'sub', 'Steruj calym interfejsem dlonia przez kamere: palec wskazujacy = kursor, szczypniecie = klik, szczypniecie + przeciagniecie = przewijanie, otwarta dlon w gore/dol = przewijanie, szybki ruch w bok = nastepny/poprzedni modul. Przetwarzanie dziala lokalnie w przegladarce; obraz z kamery nigdzie nie jest wysylany.'));
        const b = el('button', on ? 'btn primary' : 'btn ghost', on ? 'WYLACZ GESTY' : 'WLACZ GESTY');
        b.addEventListener('click', async () => {
          await UI.handUi.toggle();
          b.textContent = on ? 'WYLACZ GESTY' : 'WLACZ GESTY';
          b.className = on ? 'btn primary' : 'btn ghost';
        });
        body.appendChild(b);
      },
    },
  });

  addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'h' || e.key === 'H') && isOwner() && !e.ctrlKey) {
      e.preventDefault();
      UI.handUi.toggle();
    }
  });

  const orig = UI.paletteSearch;
  if (orig) {
    UI.paletteSearch = (q) => {
      const out = orig(q);
      if (/^(dlon|dloni|gesty|hand)\b/i.test(UI.deaccent(q.trim().toLowerCase()))) out.unshift({ label: `✋ Gesty dloni: ${on ? 'wylacz' : 'wlacz'}`, hint: 'ENTER (Alt+H)', run: () => UI.handUi.toggle() });
      return out;
    };
  }
})();
