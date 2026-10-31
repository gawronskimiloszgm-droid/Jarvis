// Telefon jako kamera: holo-kamera i gesty dzialaja bez kamerki w komputerze. Na telefonie otwierasz
// modul (albo skanujesz kod QR) i nadajesz obraz; komputer odbiera go jak zwykla kamere (WebRTC,
// obraz leci wprost miedzy urzadzeniami, serwer przekazuje tylko wiadomosci zestawiajace polaczenie).
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.register) return;
  const { el, api, toast, isOwner } = UI;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const RTC = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const send = (to, msg) => api('/api/phonecam/signal', json({ to, msg }));
  const POLL_MS = 1200;

  // SDP wysylamy dopiero z zebranymi trasami polaczenia, wiec wystarczy jedna wymiana wiadomosci.
  const gathered = (pc) =>
    new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const done = () => pc.iceGatheringState === 'complete' && res();
      pc.addEventListener('icegatheringstatechange', done);
      setTimeout(res, 3000);
    });

  // ---------- strona telefonu: nadawanie ----------
  const tx = { on: false, stream: null, pc: null, facing: 'environment', timer: null, lock: null, status: () => {} };

  async function txOpenCamera() {
    tx.stream?.getTracks().forEach((t) => t.stop());
    tx.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: tx.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    return tx.stream;
  }

  async function txConnect() {
    tx.pc?.close();
    const pc = new RTCPeerConnection(RTC);
    tx.pc = pc;
    tx.connectAt = Date.now();
    tx.stream.getTracks().forEach((t) => pc.addTrack(t, tx.stream));
    pc.addEventListener('connectionstatechange', () => {
      if (tx.pc !== pc) return;
      const s = pc.connectionState;
      tx.status(s === 'connected' ? 'Połączono z komputerem. Obraz leci.' : s === 'failed' ? 'Nie udało się połączyć. Telefon i komputer najlepiej w tej samej sieci Wi-Fi.' : s === 'disconnected' ? 'Rozłączono. Czekam na komputer...' : 'Łączę...');
    });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    await send('pc', { type: 'offer', sdp: pc.localDescription.sdp });
  }

  async function txPoll() {
    const r = await api('/api/phonecam/signal?role=phone').catch(() => null);
    for (const m of r?.messages || []) {
      if (m.type === 'request') {
        // Zaproszenie przychodzi co kilka sekund: nie przerywamy polaczenia, ktore wlasnie sie zestawia.
        const busy = tx.pc && (tx.pc.connectionState === 'connected' || (['new', 'connecting'].includes(tx.pc.connectionState) && Date.now() - tx.connectAt < 12000));
        if (!busy) await txConnect();
      }
      else if (m.type === 'answer' && tx.pc?.signalingState === 'have-local-offer') await tx.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      else if (m.type === 'stop') {
        tx.pc?.close();
        tx.pc = null;
        tx.status('Komputer zakończył odbiór. Czekam...');
      }
    }
  }

  async function txStart(preview) {
    if (tx.on) return;
    await txOpenCamera();
    preview.srcObject = tx.stream;
    preview.play().catch(() => {});
    tx.on = true;
    tx.status('Czekam, aż komputer poprosi o obraz...');
    await send('pc', { type: 'phone-ready' }).catch(() => {});
    tx.timer = setInterval(() => txPoll().catch(() => {}), POLL_MS);
    try {
      tx.lock = await navigator.wakeLock?.request('screen'); // ekran nie gasnie w trakcie nadawania
    } catch {
      /* blokada ekranu niedostepna */
    }
  }

  function txStop() {
    tx.on = false;
    clearInterval(tx.timer);
    tx.pc?.close();
    tx.pc = null;
    tx.stream?.getTracks().forEach((t) => t.stop());
    tx.stream = null;
    tx.lock?.release?.().catch(() => {});
    tx.lock = null;
    tx.status('Wyłączone.');
  }

  // ---------- strona komputera: odbior ----------
  const rx = { pc: null, stream: null, timer: null, status: () => {} };

  function rxStop(notify = true) {
    clearInterval(rx.timer);
    rx.timer = null;
    rx.pc?.close();
    rx.pc = null;
    rx.stream = null;
    if (notify) send('phone', { type: 'stop' }).catch(() => {});
  }

  // Obraz z telefonu jako zwykly MediaStream. Odrzuca po czasie, gdy telefon nie nadaje.
  function getStream(timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      rxStop(false);
      rx.stream = new MediaStream();
      const started = Date.now();
      let settled = false;
      let lastAsk = 0;
      const finish = (fn, v) => {
        if (settled) return;
        settled = true;
        fn(v);
      };
      const tick = async () => {
        if (!settled && Date.now() - started > timeoutMs) {
          rxStop(false);
          const e = new Error('Telefon nie nadaje. Otwórz na nim moduł „Telefon jako kamera” i wciśnij NADAJ OBRAZ.');
          e.name = 'PhoneTimeout';
          return finish(reject, e);
        }
        const lost = settled && ['failed', 'closed', 'disconnected'].includes(rx.pc?.connectionState);
        if ((!settled || lost) && Date.now() - lastAsk > 4000) {
          lastAsk = Date.now();
          send('phone', { type: 'request' }).catch(() => {});
        }
        const r = await api('/api/phonecam/signal?role=pc').catch(() => null);
        for (const m of r?.messages || []) {
          if (m.type === 'phone-ready') lastAsk = 0;
          if (m.type !== 'offer') continue;
          rx.pc?.close();
          const pc = new RTCPeerConnection(RTC);
          rx.pc = pc;
          // Jeden staly strumien: po ponownym polaczeniu (np. telefon wlaczony od nowa) podmieniamy w nim
          // sciezke, wiec holo-kamera i gesty dzialaja dalej bez restartu.
          pc.addEventListener('track', (ev) => {
            rx.stream.getTracks().forEach((t) => rx.stream.removeTrack(t));
            rx.stream.addTrack(ev.track);
            finish(resolve, rx.stream);
          });
          pc.addEventListener('connectionstatechange', () => {
            if (rx.pc === pc) rx.status(pc.connectionState === 'connected' ? 'Obraz z telefonu odbierany.' : pc.connectionState === 'failed' ? 'Połączenie nie wyszło. Spróbuj w tej samej sieci Wi-Fi.' : 'Łączę z telefonem...');
          });
          await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
          await pc.setLocalDescription(await pc.createAnswer());
          await gathered(pc);
          await send('phone', { type: 'answer', sdp: pc.localDescription.sdp });
        }
      };
      rx.timer = setInterval(() => tick().catch(() => {}), POLL_MS);
      tick().catch(() => {});
    });
  }

  // Liczniki klatek obu stron (diagnostyka: czy obraz naprawde plynie).
  async function stats() {
    const pick = async (pc, kind) => {
      if (!pc) return null;
      const out = {};
      (await pc.getStats()).forEach((r) => {
        if (r.type === kind && r.kind === 'video') Object.assign(out, { frames: r.framesDecoded ?? r.framesEncoded, sent: r.framesSent, width: r.frameWidth, height: r.frameHeight, fps: r.framesPerSecond, limit: r.qualityLimitationReason, codec: r.codecId });
      });
      return out;
    };
    return { send: await pick(tx.pc, 'outbound-rtp'), recv: await pick(rx.pc, 'inbound-rtp'), state: { tx: tx.pc?.connectionState, rx: rx.pc?.connectionState } };
  }

  UI.phoneCam = { getStream, stop: () => rxStop(true), startSending: txStart, stopSending: txStop, isSending: () => tx.on, stats };

  // ---------- modul ----------
  const panel = {
    title: 'TELEFON JAKO KAMERA',
    glyph: '▯',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostępne tylko dla właściciela.';
        return;
      }
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'Komputer nie ma kamery? Użyj telefonu: holo-kamera i gesty dłoni dostaną obraz z niego. Obraz leci bezpośrednio między urządzeniami, najlepiej w tej samej sieci Wi-Fi.'));
      const grid = el('div', 'pc-grid');

      // nadawanie (na telefonie)
      const a = el('div', 'pc-col');
      a.appendChild(el('b', null, 'NA TYM TELEFONIE'));
      const preview = el('video', 'pc-preview');
      preview.muted = true;
      preview.playsInline = true;
      const sta = el('div', 'w-dim', 'Wyłączone.');
      tx.status = (t) => (sta.textContent = t);
      const go = el('button', 'btn primary', 'NADAJ OBRAZ');
      const flip = el('button', 'btn ghost', 'ZMIEŃ KAMERĘ');
      go.addEventListener('click', async () => {
        if (tx.on) {
          txStop();
          go.textContent = 'NADAJ OBRAZ';
          return;
        }
        try {
          await txStart(preview);
          go.textContent = 'ZAKOŃCZ';
        } catch (e) {
          sta.textContent = e.name === 'NotAllowedError' ? 'Brak zgody na kamerę.' : `Kamera nie ruszyła: ${e.message || e}`;
        }
      });
      flip.addEventListener('click', async () => {
        tx.facing = tx.facing === 'environment' ? 'user' : 'environment';
        if (!tx.on) return;
        try {
          await txOpenCamera();
          preview.srcObject = tx.stream;
          const track = tx.stream.getVideoTracks()[0];
          const sender = tx.pc?.getSenders().find((s) => s.track?.kind === 'video');
          await sender?.replaceTrack(track);
        } catch (e) {
          sta.textContent = e.message || 'Nie udało się zmienić kamery.';
        }
      });
      const row = el('div', 'field');
      row.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0';
      row.append(go, flip);
      a.append(preview, row, sta);

      // odbior (na komputerze)
      const b = el('div', 'pc-col');
      b.appendChild(el('b', null, 'NA KOMPUTERZE'));
      const qr = el('canvas', 'pc-qr');
      const url = `${location.origin}/?phonecam=1`;
      try {
        const m = window.Toolkit.qr(url);
        const q = 3;
        const sc = Math.max(3, Math.floor(180 / (m.length + q * 2)));
        qr.width = qr.height = (m.length + q * 2) * sc;
        const g = qr.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, qr.width, qr.height);
        g.fillStyle = '#000';
        m.forEach((r, y) => r.forEach((v, x) => v && g.fillRect((x + q) * sc, (y + q) * sc, sc, sc)));
      } catch {
        qr.hidden = true;
      }
      const rxs = el('div', 'w-dim', 'Zeskanuj kod telefonem i zaloguj się tym samym kontem.');
      rx.status = (t) => (rxs.textContent = t);
      const use = el('button', 'btn primary');
      const label = () => {
        use.textContent = localStorage.getItem('jarvis.camId') === 'phone' ? 'TELEFON JEST KAMERĄ JARVISA ✓' : 'UŻYJ TELEFONU JAKO KAMERY';
      };
      label();
      use.addEventListener('click', () => {
        const isPhone = localStorage.getItem('jarvis.camId') === 'phone';
        localStorage.setItem('jarvis.camId', isPhone ? '' : 'phone');
        label();
        toast(isPhone ? 'Kamera: domyślna.' : 'Kamera: telefon. Włącz holo-kamerę (Alt+K) albo gesty (Alt+H).', 'ok');
      });
      b.append(qr, use, rxs);
      grid.append(a, b);
      body.appendChild(grid);
    },
  };
  UI.register({ id: 'phonecam', title: 'Telefon jako kamera', sub: 'obraz z telefonu dla komputera', icon: '▯', owner: true, group: 'Komputer', panels: { phonecam: panel } });

  // Wejscie z kodu QR
  window.addEventListener('jarvis:ready', () => {
    if (new URLSearchParams(location.search).get('phonecam') === '1' && isOwner()) UI.openWindow('phonecam');
  });
})();
