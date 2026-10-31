// Sterowanie CALYM interfejsem gestami dloni (kamera + MediaPipe Hands, logika w handgest.js):
//   palec wskazujacy      -> kursor na ekranie (podswietla to, na co najezdzasz),
//   szczypniecie          -> klik w element pod kursorem,
//   szczypniecie + ruch   -> przewijanie z bezwladnoscia,
//   otwarta dlon w gore/dol -> przewijanie, szybki ruch w bok -> poprzedni/nastepny modul,
//   piesc                 -> pauza (mozna przesunac reke bez skutkow),
//   zawis kursora         -> klik (opcjonalnie, gdy szczypniecie sprawia klopot).
// Wlaczanie: Ustawienia -> GESTY DLONI, polecenie "dlon" w palecie albo skrot Alt+H.
// Gdy otwarty jest Graf wiedzy (ma wlasne gesty), warstwa globalna sie wstrzymuje.
(function () {
  const UI = window.JarvisUI;
  const G = window.HandGest;
  if (!UI || !G || !UI.extend) return;
  const { el, toast, isOwner } = UI;

  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const MODE_LABEL = { point: 'KURSOR', open: 'OTWARTA DLON', pinch: 'SZCZYPNIECIE', freeze: 'PAUZA (PIESC)', zoom: 'DWIE DLONIE', lost: 'SZUKAM DLONI', other: 'DLON', none: 'BRAK DLONI' };

  let landmarker = null;
  let stream = null;
  let video = null;
  let cursor = null;
  let preview = null;
  let label = null;
  let raf = 0;
  let on = false;
  let hover = null;
  let tracker = null;
  let lastTime = -1;
  let dragEl = null;
  let dragY = null;
  let shared = false;
  let opts = G.loadOptions();
  let dwell = G.createDwell({ ms: opts.dwellMs });
  let lastRatio = null;
  let calib = null;
  // Bezwladnosc przewijania: predkosc w pikselach na klatke, wygasa po puszczeniu.
  let inertia = { el: null, v: 0 };

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
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return document.elementFromPoint(x, y);
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

  function feedback() {
    if (!opts.feedback) return;
    window.SFX?.play?.('tap');
    UI.buzz?.(10);
  }

  function clickAt(x, y) {
    const under = underCursor(x, y);
    // Tylko elementy do klikania (i plotna) - szczypniecie w puste miejsce niczego nie uruchamia.
    const n = clickable(under) || (under && under.tagName === 'CANVAS' ? under : null);
    if (!n) return false;
    UI.activity?.emit('gesty', `Klik gestem w "${String(n.textContent || n.title || n.tagName).trim().slice(0, 40)}"`);
    feedback();
    if (n.focus && /^(input|textarea|select)$/i.test(n.tagName)) n.focus();
    else n.click?.();
    ripple(x, y);
    return true;
  }

  function nudge(target, dy) {
    if (!target) return;
    target.scrollTop += dy;
    inertia = { el: target, v: inertia.el === target ? inertia.v * 0.5 + dy * 0.5 : dy };
  }

  function handle(e, pos) {
    const x = pos.x * innerWidth;
    const y = pos.y * innerHeight;
    if (e.type === 'tap') {
      inertia.v = 0;
      clickAt(e.x * innerWidth, e.y * innerHeight);
    } else if (e.type === 'grab-start') {
      inertia.v = 0;
      dragEl = scroller(underCursor(e.x * innerWidth, e.y * innerHeight));
      dragY = e.y;
    } else if (e.type === 'grab-move') {
      if (dragEl && dragY != null) nudge(dragEl, -(e.y - dragY) * innerHeight * 1.8 * opts.scrollSpeed);
      dragY = e.y;
    } else if (e.type === 'pan') {
      if (!dragEl) dragEl = scroller(underCursor(x, y));
      nudge(dragEl, -e.dy * innerHeight * 1.8 * opts.scrollSpeed);
    } else if (e.type === 'grab-end') {
      dragEl = null;
      dragY = null;
    } else if (e.type === 'rotate') {
      if (Math.abs(e.dy) > Math.abs(e.dx)) nudge(scroller(underCursor(x, y)), e.dy * innerHeight * 0.9 * opts.scrollSpeed);
    } else if (e.type === 'swipe') {
      if (UI.workshopSwipe?.(e.dir)) return;
      const btns = [...document.querySelectorAll('#dock .dock-btn')].filter((b) => !b.classList.contains('off'));
      const i = btns.findIndex((b) => b.classList.contains('on'));
      feedback();
      btns[(i + e.dir + btns.length) % btns.length]?.click();
    }
  }

  function ripple(x, y) {
    const r = el('i', 'holo-ripple');
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 650);
  }

  function drawPreview(hands, pinch) {
    if (!preview) return;
    const g = preview.getContext('2d');
    g.clearRect(0, 0, preview.width, preview.height);
    g.strokeStyle = pinch ? '#ffb347' : '#33e0ff';
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

  function loopInertia() {
    if (!on) return;
    requestAnimationFrame(loopInertia);
    if (Math.abs(inertia.v) < 0.3 || !inertia.el) return;
    if (dragEl) return; // palce trzymaja: bez bezwladnosci
    inertia.el.scrollTop += inertia.v;
    inertia.v *= 0.92;
  }

  async function start() {
    if (on) return;
    if (!navigator.mediaDevices?.getUserMedia) return toast('Ta przegladarka nie udostepnia kamery.');
    try {
      const s = await (UI.camera ? UI.camera.acquire() : navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }));
      stream = s;
      shared = Boolean(UI.camera);
      const lm = await loadLandmarker();
      video = el('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      await video.play();
      cursor = el('div', 'hu-cursor');
      preview = el('canvas', 'hu-preview');
      preview.width = 160;
      preview.height = 120;
      label = el('div', 'hu-label', 'SZUKAM DLONI');
      document.body.append(cursor, preview, label);
      opts = G.loadOptions();
      tracker = G.createTracker(opts);
      tracker.setOptions({ aspect: (video.videoWidth || 4) / (video.videoHeight || 3) });
      dwell = G.createDwell({ ms: opts.dwellMs });
      on = true;
      document.body.classList.add('hand-ui');
      toast('Gesty dloni: szczypnij, zeby kliknac; piesc to pauza.', 'ok');
      UI.activity?.emit('gesty', 'Gesty dloni aktywne w calym interfejsie', { react: true });
      loopInertia();
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
        if (graphActive()) {
          drawPreview(hands, false);
          cursor.style.opacity = '0';
          label.textContent = 'GESTY W GRAFIE';
          return;
        }
        const now = performance.now();
        const out = tracker.update(hands, now);
        drawPreview(hands, out.pinch);
        label.textContent = MODE_LABEL[out.mode] || 'DLON';
        lastRatio = out.pinchRatio;
        if (calib && out.pinchRatio != null) {
          calib.min = Math.min(calib.min, out.pinchRatio);
          calib.max = Math.max(calib.max, out.pinchRatio);
        }
        if (out.visible) {
          const x = out.cursor.x * innerWidth;
          const y = out.cursor.y * innerHeight;
          cursor.style.opacity = '1';
          cursor.style.transform = `translate(${x}px, ${y}px)`;
          cursor.classList.toggle('pinch', out.pinch);
          cursor.classList.toggle('freeze', out.mode === 'freeze');
          const under = underCursor(x, y);
          setHover(under);
          // Klik przez zawis: tylko przy wskazywaniu, zeby nie klikac przypadkiem przy przewijaniu.
          if (opts.dwell && out.mode === 'point') {
            const d = dwell.update(out.cursor.x, out.cursor.y, hover, now);
            cursor.style.setProperty('--p', `${Math.round(d.progress * 100)}%`);
            if (d.fire) clickAt(x, y);
          } else {
            dwell.update(0, 0, null, now);
            cursor.style.setProperty('--p', '0%');
          }
        } else {
          cursor.style.opacity = '0';
          setHover(null);
          dwell.update(0, 0, null, now);
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
    label?.remove();
    cursor = preview = label = null;
    inertia = { el: null, v: 0 };
    setHover(null);
    document.body.classList.remove('hand-ui');
  }

  UI.handUi = {
    start,
    stop,
    toggle: () => (on ? stop() : start()),
    isOn: () => on,
    _event: handle,
    reloadOptions() {
      opts = G.loadOptions();
      tracker?.setOptions(opts);
      dwell = G.createDwell({ ms: opts.dwellMs });
      window.dispatchEvent(new Event('jarvis:hand-options'));
    },
  };

  UI.extend('set', {
    handui: {
      title: 'GESTY DLONI',
      glyph: '✋',
      build(body) {
        body.innerHTML = '';
        body.appendChild(el('div', 'sub', 'Palec wskazujacy = kursor, szczypniecie = klik, szczypniecie z ruchem = przewijanie, otwarta dlon w gore/dol = przewijanie, szybki ruch w bok = nastepny/poprzedni modul, piesc = pauza. Obraz z kamery jest przetwarzany lokalnie i nigdzie nie jest wysylany.'));
        const b = el('button', on ? 'btn primary' : 'btn ghost', on ? 'WYLACZ GESTY' : 'WLACZ GESTY');
        b.addEventListener('click', async () => {
          await UI.handUi.toggle();
          b.textContent = on ? 'WYLACZ GESTY' : 'WLACZ GESTY';
          b.className = on ? 'btn primary' : 'btn ghost';
        });
        body.appendChild(b);

        const put = (patch) => {
          G.saveOptions({ ...G.loadOptions(), ...patch });
          UI.handUi.reloadOptions();
        };
        const box = el('div', 'hu-opts');
        const slider = (label2, key, min, max, step, apply) => {
          const l = el('label', 'kv');
          const i = el('input');
          i.type = 'range';
          i.min = min;
          i.max = max;
          i.step = step;
          i.value = G.loadOptions()[key];
          i.addEventListener('change', () => (apply ? apply(Number(i.value)) : put({ [key]: Number(i.value) })));
          l.append(el('span', null, label2), i);
          box.appendChild(l);
          return i;
        };
        const check = (label2, key) => {
          const l = el('label', 'kv');
          const i = el('input');
          i.type = 'checkbox';
          i.checked = Boolean(G.loadOptions()[key]);
          i.addEventListener('change', () => put({ [key]: i.checked }));
          l.append(el('span', null, label2), i);
          box.appendChild(l);
        };
        const pinchSl = slider('Czulosc szczypniecia', 'pinchOn', 0.18, 0.5, 0.01, (v) => put({ pinchOn: v, pinchOff: Math.round(v * 150) / 100 }));
        slider('Zasieg kursora (wiekszy = mniejszy ruch reki)', 'edge', 0, 0.25, 0.01);
        slider('Predkosc przewijania', 'scrollSpeed', 0.3, 2.5, 0.1);
        slider('Czulosc obrotu (graf)', 'rotateGain', 2, 10, 0.2);
        check('Klik przez zawis kursora', 'dwell');
        slider('Czas zawisu (ms)', 'dwellMs', 500, 2000, 100);
        check('Dzwiek i wibracja przy kliknieciu', 'feedback');

        // Pomiar na zywo i kalibracja pod konkretna reke i kamere.
        const meter = el('div', 'hu-meter');
        const fill = el('i');
        const mark = el('b');
        meter.append(fill, mark);
        const info = el('div', 'w-dim');
        const cal = el('button', 'btn ghost', 'KALIBRUJ SZCZYPNIECIE (5 s)');
        cal.addEventListener('click', () => {
          if (!on) return (info.textContent = 'Najpierw wlacz gesty.');
          calib = { min: 9, max: 0 };
          info.textContent = 'Zamykaj i otwieraj szczypniecie przez 5 sekund...';
          setTimeout(() => {
            const c = calib;
            calib = null;
            if (!c || c.max - c.min < 0.25) return (info.textContent = 'Za malo ruchu albo nie widze dloni. Sprobuj jeszcze raz.');
            const v = Math.max(0.18, Math.min(0.5, c.min + (c.max - c.min) * 0.22));
            const pinchOn = Math.round(v * 100) / 100;
            put({ pinchOn, pinchOff: Math.round(pinchOn * 150) / 100 });
            pinchSl.value = pinchOn;
            info.textContent = `Gotowe: prog szczypniecia ${pinchOn} (najmniej ${c.min.toFixed(2)}, najwiecej ${c.max.toFixed(2)}).`;
          }, 5000);
        });
        box.append(el('div', 'sub', 'Odleglosc palcow teraz (pasek ponizej kreski = szczypniecie):'), meter, cal, info);
        body.appendChild(box);
        const tick = () => {
          if (!document.body.contains(meter)) return;
          const o = G.loadOptions();
          fill.style.width = `${lastRatio == null || !on ? 0 : Math.min(100, (lastRatio / 1.2) * 100)}%`;
          mark.style.left = `${(o.pinchOn / 1.2) * 100}%`;
          setTimeout(tick, 120);
        };
        setTimeout(tick, 500); // panel jest dolaczany do strony dopiero po zbudowaniu
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
