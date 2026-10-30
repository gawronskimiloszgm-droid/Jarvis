// Rozpoznawanie gestow dloni z punktow MediaPipe Hands (21 punktow na dlon, wspolrzedne 0..1).
// Czysta logika bez DOM, zeby dalo sie ja testowac (tests/handgest.test.mjs).
//
// Gesty (jak w pokazie "Claude + Antigravity"):
//   palec wskazujacy          -> kursor (najechanie na wezel)
//   otwarta dlon + ruch       -> obrot grafu w 3D
//   szczypniecie (krotkie)    -> zaznaczenie wezla
//   szczypniecie + przytrzymanie -> chwyt (przeciaganie wezla)
//   szczypniecie + ruch       -> przesuwanie widoku (pan)
//   dwie dlonie rozsun/zbliz  -> zoom
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HandGest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const PIN_ON = 0.3; // stosunek odleglosci kciuk-palec wskazujacy do rozmiaru dloni
  const PIN_OFF = 0.46;
  const HOLD_MS = 340; // przytrzymanie szczypniecia = chwyt
  const MOVE_PAN = 0.035; // ruch w trakcie szczypniecia zamienia tap w pan

  // Palec jest wyprostowany, gdy czubek jest dalej od nadgarstka niz staw posredni.
  function extended(lm, tip, pip) {
    return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.08;
  }

  function analyze(lm) {
    const palm = Math.max(1e-6, dist(lm[0], lm[9])); // nadgarstek -> podstawa srodkowego palca
    const ext = {
      index: extended(lm, 8, 6),
      middle: extended(lm, 12, 10),
      ring: extended(lm, 16, 14),
      pinky: extended(lm, 20, 18),
    };
    const nExt = Object.values(ext).filter(Boolean).length;
    const pinch = dist(lm[4], lm[8]) / palm;
    const center = { x: (lm[0].x + lm[5].x + lm[9].x + lm[17].x) / 4, y: (lm[0].y + lm[5].y + lm[9].y + lm[17].y) / 4 };
    let mode = 'other';
    if (nExt >= 3) mode = 'open';
    else if (ext.index && !ext.middle && !ext.ring && !ext.pinky) mode = 'point';
    else if (nExt === 0) mode = 'fist';
    return { ext, nExt, pinch, center, tip: { x: lm[8].x, y: lm[8].y }, mode };
  }

  // Obraz z kamery jest lustrzany (selfie) - odbijamy os X, zeby ruch w prawo = w prawo na ekranie.
  const mirror = (lm) => lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z || 0 }));

  function createTracker(opts = {}) {
    const rotGain = opts.rotateGain || 5.2;
    const st = {
      pinching: false,
      t0: 0,
      p0: null,
      moved: 0,
      grab: false,
      pan: false,
      last: null,
      cursor: { x: 0.5, y: 0.5 },
      seen: false,
      palm: null,
      twoDist: null,
      zoomAcc: 1,
    };

    function update(hands, now) {
      const events = [];
      const out = { visible: false, cursor: st.cursor, pinch: false, mode: 'none', hands: hands.length, events };
      if (!hands.length) {
        if (st.grab) events.push({ type: 'grab-end' });
        st.pinching = st.grab = st.pan = false;
        st.palm = null;
        st.twoDist = null;
        st.seen = false;
        return out;
      }
      const a = hands.map((h) => analyze(mirror(h)));

      // ---- dwie dlonie: zoom ----
      if (a.length >= 2) {
        const d = dist(a[0].center, a[1].center);
        if (st.twoDist != null && d > 0.05) {
          const f = d / st.twoDist;
          if (Math.abs(f - 1) > 0.012) events.push({ type: 'zoom', factor: Math.max(0.85, Math.min(1.18, f)) });
        }
        st.twoDist = d;
        st.pinching = st.grab = st.pan = false;
        st.palm = null;
        out.visible = true;
        out.mode = 'zoom';
        out.cursor = { x: (a[0].tip.x + a[1].tip.x) / 2, y: (a[0].tip.y + a[1].tip.y) / 2 };
        return out;
      }
      st.twoDist = null;

      const h = a[0];
      // Kursor wygladzany wykladniczo (drzenie dloni).
      st.cursor = st.seen ? { x: st.cursor.x + (h.tip.x - st.cursor.x) * 0.55, y: st.cursor.y + (h.tip.y - st.cursor.y) * 0.55 } : { ...h.tip };
      st.seen = true;
      out.visible = true;
      out.cursor = st.cursor;

      // ---- szczypniecie z histereza ----
      const was = st.pinching;
      st.pinching = was ? h.pinch < PIN_OFF : h.pinch < PIN_ON;
      out.pinch = st.pinching;
      out.mode = st.pinching ? 'pinch' : h.mode;

      if (st.pinching && !was) {
        st.t0 = now;
        st.p0 = { ...st.cursor };
        st.moved = 0;
        st.grab = false;
        st.pan = false;
        st.last = { ...st.cursor };
      } else if (st.pinching && was) {
        st.moved += dist(st.cursor, st.last);
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
        if (st.grab) events.push({ type: 'grab-end' });
        else if (!st.pan && now - st.t0 <= HOLD_MS + 120) events.push({ type: 'tap', x: st.p0.x, y: st.p0.y });
        st.grab = st.pan = false;
      }

      // ---- otwarta dlon: obrot ----
      if (!st.pinching && h.mode === 'open') {
        if (st.palm) {
          const dx = h.center.x - st.palm.x;
          const dy = h.center.y - st.palm.y;
          if (Math.hypot(dx, dy) > 0.004) events.push({ type: 'rotate', dx: dx * rotGain, dy: dy * rotGain });
        }
        st.palm = { ...h.center };
      } else {
        st.palm = null;
      }
      return out;
    }

    return { update, state: st };
  }

  return { analyze, mirror, createTracker, PIN_ON, PIN_OFF, HOLD_MS };
});
