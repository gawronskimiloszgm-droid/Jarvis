// Rozpoznawanie gestow dloni z punktow MediaPipe Hands (21 punktow na dlon, wspolrzedne 0..1).
// Czysta logika bez DOM, zeby dalo sie ja testowac (tests/handgest.test.mjs).
//
// Gesty:
//   palec wskazujacy             -> kursor (najechanie)
//   otwarta dlon + ruch          -> obrot / przewijanie
//   szybki ruch otwarta dlonia w bok -> swipe (poprzedni/nastepny modul)
//   szczypniecie (krotkie)       -> klik / wybor
//   szczypniecie + przytrzymanie -> chwyt
//   szczypniecie + ruch          -> przesuwanie
//   dwie dlonie rozsun/zbliz     -> zoom
//   piesc                        -> pauza: mozna przesunac reke bez skutkow
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HandGest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const DEFAULTS = {
    pinchOn: 0.3, // stosunek odleglosci kciuk-palec wskazujacy do rozmiaru dloni
    pinchOff: 0.46,
    edge: 0.1, // margines kadru: srodek obrazu z kamery pokrywa caly ekran, zeby siegnac do rogow
    rotateGain: 5.2,
    aspect: 4 / 3, // szerokosc/wysokosc kadru kamery
    scrollSpeed: 1,
    dwell: false, // klik przez zawis kursora
    dwellMs: 900,
    feedback: true, // dzwiek i wibracja przy kliknieciu
  };
  const HOLD_MS = 340; // przytrzymanie szczypniecia = chwyt
  const MOVE_PAN = 0.045; // odsuniecie od punktu startu w trakcie szczypniecia zamienia klik w przesuwanie
  const GRACE_MS = 300; // krotka utrata dloni przez detektor nie przerywa gestu
  const PINCH_FRAMES = 2; // tyle klatek z rzedu zmienia stan szczypniecia (bez migotania)
  const TWO_FRAMES = 3; // tyle klatek z rzedu z dwiema dlonmi wlacza zoom (falszywa druga dlon go nie uruchomi)
  const JUMP = 0.25; // skok czubka palca o tyle = zgubiony sledzony punkt, a nie ruch
  const PRE_PINCH_MS = 130; // zamykanie palcow przesuwa czubek: klik trafia tam, gdzie kursor byl przed ruchem
  const SWIPE_DIST = 0.28;
  const SWIPE_WINDOW_MS = 280;
  const SWIPE_COOLDOWN_MS = 1000;

  const KEY = 'jarvis.handOpts';
  function loadOptions() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function saveOptions(o) {
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch {
      /* ustawienia do zamkniecia karty */
    }
  }

  // Punkty sa w ulamkach szerokosci i wysokosci kadru, wiec bez proporcji kadru dlon wydaje sie
  // inna w pionie niz w poziomie. Glebia z (w skali szerokosci) odroznia palce tylko nalozone na siebie
  // w obrazie od tych, ktore naprawde sie stykaja.
  function analyze(lm, aspect = 1) {
    const d = (a, b) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y, ((lm[a].z || 0) - (lm[b].z || 0)) * aspect);
    // Palec jest wyprostowany, gdy czubek jest dalej od nadgarstka niz staw posredni.
    const extended = (tip, pip) => d(tip, 0) > d(pip, 0) * 1.08;
    const palm = Math.max(1e-6, d(0, 9)); // nadgarstek -> podstawa srodkowego palca
    const ext = {
      index: extended(8, 6),
      middle: extended(12, 10),
      ring: extended(16, 14),
      pinky: extended(20, 18),
    };
    const nExt = Object.values(ext).filter(Boolean).length;
    const pinch = d(4, 8) / palm;
    const reach = d(8, 0) / palm; // w piesci czubek palca wskazujacego lezy na dloni
    const center = { x: (lm[0].x + lm[5].x + lm[9].x + lm[17].x) / 4, y: (lm[0].y + lm[5].y + lm[9].y + lm[17].y) / 4 };
    let mode = 'other';
    if (nExt >= 3) mode = 'open';
    else if (ext.index && !ext.middle && !ext.ring && !ext.pinky) mode = 'point';
    else if (nExt === 0 && reach < 1.15) mode = 'fist';
    return { ext, nExt, pinch, reach, center, tip: { x: lm[8].x, y: lm[8].y }, mode };
  }

  // Obraz z kamery jest lustrzany (selfie) - odbijamy os X, zeby ruch w prawo = w prawo na ekranie.
  const mirror = (lm) => lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z || 0 }));

  // Filtr One Euro: mocno wygladza przy wolnym ruchu (drzenie), a przy szybkim prawie nie opoznia.
  function oneEuro(minCutoff = 1.4, beta = 12, dCutoff = 1) {
    let x = null;
    let dx = 0;
    let last = 0;
    const alpha = (cut, dt) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
    return {
      reset() {
        x = null;
      },
      next(v, now) {
        if (x == null) {
          x = v;
          dx = 0;
          last = now;
          return v;
        }
        const dt = Math.max(0.001, (now - last) / 1000);
        last = now;
        const raw = (v - x) / dt;
        dx += alpha(dCutoff, dt) * (raw - dx);
        x += alpha(minCutoff + beta * Math.abs(dx), dt) * (v - x);
        return x;
      },
    };
  }

  function createTracker(optsIn = {}) {
    let o = { ...DEFAULTS, ...optsIn };
    const fx = oneEuro();
    const fy = oneEuro();
    const st = {
      pinching: false,
      onCount: 0,
      offCount: 0,
      t0: 0,
      p0: null,
      moved: 0,
      grab: false,
      pan: false,
      last: null,
      cursor: { x: 0.5, y: 0.5 },
      rawTip: null,
      history: [],
      seen: false,
      lastSeen: 0,
      palm: null,
      palmHist: [],
      swipeAt: -1e9,
      twoDist: null,
      twoFrames: 0,
    };

    const mapEdge = (p) => {
      const m = clamp(o.edge, 0, 0.3);
      return { x: clamp((p.x - m) / (1 - 2 * m), 0, 1), y: clamp((p.y - m) / (1 - 2 * m), 0, 1) };
    };

    function endPinch(events) {
      if (st.grab) events.push({ type: 'grab-end' });
      st.pinching = st.grab = st.pan = false;
      st.onCount = st.offCount = 0;
    }

    function resetTracking() {
      fx.reset();
      fy.reset();
      st.rawTip = null;
      st.history = [];
      st.palm = null;
      st.palmHist = [];
    }

    function update(hands, now) {
      const events = [];
      const out = { visible: false, cursor: st.cursor, pinch: false, mode: 'none', hands: hands.length, events, pinchRatio: null };

      if (!hands.length) {
        if (st.seen && now - st.lastSeen < GRACE_MS) {
          // Krotka dziura w detekcji: gest trwa dalej, kursor stoi.
          out.visible = true;
          out.pinch = st.pinching;
          out.mode = 'lost';
          return out;
        }
        endPinch(events);
        resetTracking();
        st.twoDist = null;
        st.twoFrames = 0;
        st.seen = false;
        return out;
      }
      st.seen = true;
      st.lastSeen = now;
      const a = hands.map((h) => analyze(mirror(h), o.aspect));

      // ---- dwie dlonie: zoom ----
      st.twoFrames = a.length >= 2 ? st.twoFrames + 1 : 0;
      if (st.twoFrames >= TWO_FRAMES) {
        endPinch(events);
        const d = dist(a[0].center, a[1].center);
        if (st.twoDist != null && d > 0.05) {
          const f = d / st.twoDist;
          if (Math.abs(f - 1) > 0.012) events.push({ type: 'zoom', factor: clamp(f, 0.85, 1.18) });
        }
        st.twoDist = d;
        resetTracking();
        out.visible = true;
        out.mode = 'zoom';
        out.cursor = mapEdge({ x: (a[0].tip.x + a[1].tip.x) / 2, y: (a[0].tip.y + a[1].tip.y) / 2 });
        return out;
      }
      st.twoDist = null;

      // Glowna dlon: ta blizej ostatniej pozycji (kursor nie przeskakuje na druga reke).
      let h = a[0];
      if (a.length > 1 && st.rawTip && dist(a[1].tip, st.rawTip) < dist(a[0].tip, st.rawTip)) h = a[1];
      out.pinchRatio = h.pinch;
      out.visible = true;

      // Skok punktu sledzonego: zaczynamy filtr od nowa, ten ruch sie nie liczy.
      const jumped = st.rawTip && dist(h.tip, st.rawTip) > JUMP;
      if (jumped) {
        resetTracking();
        st.last = null;
      }
      st.rawTip = h.tip;

      // ---- piesc: pauza ----
      if (h.mode === 'fist' && !st.pinching) {
        st.palm = null;
        st.palmHist = [];
        out.mode = 'freeze';
        return out;
      }

      const mapped = mapEdge(h.tip);
      st.cursor = { x: fx.next(mapped.x, now), y: fy.next(mapped.y, now) };
      out.cursor = st.cursor;
      st.history.push({ t: now, x: st.cursor.x, y: st.cursor.y });
      while (st.history.length > 2 && now - st.history[0].t > 400) st.history.shift();

      // ---- szczypniecie: histereza i kilka klatek z rzedu ----
      const was = st.pinching;
      if (was) {
        st.offCount = h.pinch > o.pinchOff ? st.offCount + 1 : 0;
        if (st.offCount >= PINCH_FRAMES) st.pinching = false;
      } else {
        st.onCount = h.pinch < o.pinchOn ? st.onCount + 1 : 0;
        if (st.onCount >= PINCH_FRAMES) st.pinching = true;
      }
      out.pinch = st.pinching;
      out.mode = st.pinching ? 'pinch' : h.mode;

      if (st.pinching && !was) {
        st.offCount = 0;
        st.t0 = now;
        // Klik tam, gdzie kursor byl, zanim palce zaczely sie zamykac.
        const before = st.history.find((p) => now - p.t <= PRE_PINCH_MS) || st.history[st.history.length - 1];
        st.p0 = { x: before.x, y: before.y };
        st.moved = 0;
        st.grab = false;
        st.pan = false;
        st.last = { ...st.cursor };
        st.pinchStart = { ...st.cursor };
      } else if (st.pinching && was) {
        if (!st.last) st.last = { ...st.cursor };
        // Liczymy odsuniecie od startu, a nie przebyta droge: drzenie reki nie moze zamienic klikniecia w przesuwanie.
        st.moved = Math.max(st.moved, dist(st.cursor, st.pinchStart || st.cursor));
        const dx = st.cursor.x - st.last.x;
        const dy = st.cursor.y - st.last.y;
        st.last = { ...st.cursor };
        if (st.grab) {
          events.push({ type: 'grab-move', x: st.cursor.x, y: st.cursor.y });
        } else if (st.pan) {
          events.push({ type: 'pan', dx, dy });
        } else if (st.moved > MOVE_PAN) {
          st.pan = true;
          events.push({ type: 'pan', dx, dy });
        } else if (now - st.t0 > HOLD_MS) {
          st.grab = true;
          events.push({ type: 'grab-start', x: st.p0.x, y: st.p0.y });
        }
      } else if (!st.pinching && was) {
        st.onCount = 0;
        if (st.grab) events.push({ type: 'grab-end' });
        else if (!st.pan && now - st.t0 <= HOLD_MS + 120) events.push({ type: 'tap', x: st.p0.x, y: st.p0.y });
        st.grab = st.pan = false;
      }

      // ---- otwarta dlon: obrot i swipe ----
      if (!st.pinching && h.mode === 'open') {
        const c = st.palm ? { x: st.palm.x + (h.center.x - st.palm.x) * 0.6, y: st.palm.y + (h.center.y - st.palm.y) * 0.6 } : { ...h.center };
        st.palmHist.push({ t: now, x: c.x, y: c.y });
        while (st.palmHist.length > 2 && now - st.palmHist[0].t > SWIPE_WINDOW_MS) st.palmHist.shift();
        const first = st.palmHist[0];
        const sdx = c.x - first.x;
        const sdy = c.y - first.y;
        if (Math.abs(sdx) > SWIPE_DIST && Math.abs(sdy) < Math.abs(sdx) * 0.6 && now - st.swipeAt > SWIPE_COOLDOWN_MS) {
          st.swipeAt = now;
          events.push({ type: 'swipe', dir: sdx > 0 ? 1 : -1 });
        }
        if (st.palm && now - st.swipeAt > 350) {
          const dx = c.x - st.palm.x;
          const dy = c.y - st.palm.y;
          if (Math.hypot(dx, dy) > 0.004) events.push({ type: 'rotate', dx: dx * o.rotateGain, dy: dy * o.rotateGain });
        }
        st.palm = c;
      } else {
        st.palm = null;
        st.palmHist = [];
      }
      return out;
    }

    return {
      update,
      state: st,
      setOptions(next) {
        o = { ...o, ...next };
      },
    };
  }

  // Klik przez zawis: kursor stoi na tym samym elemencie przez ms -> jedno "fire", dopoki z niego nie zejdzie.
  function createDwell({ ms = 900, radius = 0.025 } = {}) {
    let key = null;
    let t0 = 0;
    let anchor = null;
    let fired = false;
    return {
      update(x, y, target, now) {
        if (!target) {
          key = null;
          fired = false;
          return { progress: 0, fire: false };
        }
        if (target !== key || !anchor || Math.hypot(x - anchor.x, y - anchor.y) > radius) {
          if (target !== key) fired = false;
          key = target;
          t0 = now;
          anchor = { x, y };
        }
        if (fired) return { progress: 0, fire: false };
        const progress = Math.min(1, (now - t0) / ms);
        if (progress >= 1) {
          fired = true;
          return { progress: 1, fire: true };
        }
        return { progress, fire: false };
      },
    };
  }

  return { analyze, mirror, createTracker, createDwell, oneEuro, loadOptions, saveOptions, DEFAULTS, HOLD_MS, GRACE_MS, PIN_ON: DEFAULTS.pinchOn, PIN_OFF: DEFAULTS.pinchOff };
});
