// Slowo "Jarvis" offline - bez pakietu mowy Windows i bez Google.
//
// Silnik Vosk (WebAssembly) dziala w aplikacji, z malym angielskim modelem i gramatyka
// ograniczona do jednego slowa ("jarvis" albo "nieznane"). Dzwiek z mikrofonu jest
// rozpoznawany lokalnie i nigdzie nie wychodzi; po uslyszeniu "Jarvis" startuje zwykla
// rozmowa glosowa. Model (ok. 40 MB) pobiera sie raz i zostaje w pamieci podrecznej.
// Na czas rozmowy na zywo nasluch jest wstrzymany.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, toast } = UI;
  const D = () => window.jarvisDesktop;

  const LIB = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';
  const MODEL = 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz';
  const CACHE = 'jarvis-vosk-v1';
  const KEY = 'jarvis.wakeVosk';

  const W = { state: 'off', model: null, rec: null, ctx: null, stream: null, node: null, lastHit: 0, hits: 0 };
  UI.wakeword = W;

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
      /* ustawienie do zamkniecia karty */
    }
  };
  // Domyslnie wlaczone w aplikacji desktopowej (tam nie ma innego slowa budzacego),
  // w przegladarce zostaje wbudowane rozpoznawanie Chrome, chyba ze wlaczysz to recznie.
  const wanted = () => get(KEY, D() ? '1' : '0') === '1';

  function setState(s) {
    W.state = s;
    window.dispatchEvent(new Event('jarvis:wake-state'));
  }

  function loadLib() {
    if (window.Vosk) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Nie udalo sie pobrac silnika Vosk.'));
      document.head.appendChild(s);
    });
  }

  // Model trzymamy w Cache Storage - drugi start nie pobiera juz 40 MB.
  async function modelUrl() {
    try {
      const cache = await caches.open(CACHE);
      let res = await cache.match(MODEL);
      if (!res) {
        toast('Pobieram model slowa "Jarvis" (ok. 40 MB, jednorazowo)...', 'ok');
        const fresh = await fetch(MODEL);
        if (!fresh.ok) throw new Error('HTTP ' + fresh.status);
        await cache.put(MODEL, fresh.clone());
        res = fresh;
      }
      return URL.createObjectURL(await res.blob());
    } catch {
      return MODEL; // bez Cache Storage - zwykle pobranie
    }
  }

  async function start() {
    if (W.state === 'listening' || W.state === 'loading') return;
    setState('loading');
    try {
      await loadLib();
      if (!W.model) W.model = await window.Vosk.createModel(await modelUrl());
      W.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      W.ctx = new AudioContext({ sampleRate: 16000 });
      W.rec = new W.model.KaldiRecognizer(16000, JSON.stringify(['jarvis', 'hey jarvis', '[unk]']));
      W.rec.on('result', (m) => {
        const text = String(m?.result?.text || '');
        if (/\bjarvis\b/.test(text)) onHit();
      });
      const src = W.ctx.createMediaStreamSource(W.stream);
      W.node = W.ctx.createScriptProcessor(4096, 1, 1);
      W.node.onaudioprocess = (e) => {
        if (W.state !== 'listening') return;
        try {
          W.rec.acceptWaveform(e.inputBuffer);
        } catch {
          /* pojedyncza ramka */
        }
      };
      const mute = W.ctx.createGain();
      mute.gain.value = 0;
      src.connect(W.node);
      W.node.connect(mute);
      mute.connect(W.ctx.destination);
      setState(UI.isLive?.() ? 'paused' : 'listening');
    } catch (err) {
      stop();
      W.error = err.message || String(err);
      W.errAt = Date.now();
      setState('error');
    }
  }

  function stop() {
    try {
      W.node?.disconnect();
    } catch {
      /* juz odlaczone */
    }
    W.stream?.getTracks().forEach((t) => t.stop());
    W.ctx?.close().catch(() => {});
    try {
      W.rec?.remove?.();
    } catch {
      /* noop */
    }
    Object.assign(W, { stream: null, ctx: null, node: null, rec: null });
    setState('off');
  }

  function onHit() {
    const now = Date.now();
    if (now - W.lastHit < 3000) return;
    W.lastHit = now;
    W.hits++;
    window.dispatchEvent(new Event('jarvis:wake'));
    if (UI.isLive?.() || !document.getElementById('edith')?.hidden) return;
    window.SFX?.play('wake');
    UI.startListening?.();
  }

  // Wstrzymanie na czas rozmowy na zywo (i wznowienie po niej).
  setInterval(() => {
    if (!wanted()) {
      if (W.state !== 'off' && W.state !== 'error') stop();
      return;
    }
    if (W.state === 'off') return start();
    // Mikrofon chwilowo zajety/niedostepny - ponawiamy co minute (zgody odmowionej nie meczymy).
    if (W.state === 'error' && !/denied|not allowed/i.test(W.error || '') && Date.now() - (W.errAt || 0) > 60000) return start();
    if (W.state === 'listening' && UI.isLive?.()) setState('paused');
    else if (W.state === 'paused' && !UI.isLive?.()) setState('listening');
  }, 1500);

  window.addEventListener('jarvis:ready', () => {
    if (wanted()) setTimeout(start, 4000);
  });

  // ---------- panel ----------
  const LABEL = { off: 'wylaczony', loading: 'laduje model...', listening: 'slucha - powiedz "Jarvis"', paused: 'wstrzymany (trwa rozmowa)', error: 'blad' };
  const def = {
    title: 'SLOWO "JARVIS" I DZWIEKI',
    glyph: '◉',
    build(body) {
      body.innerHTML = '';
      const st = el('div', 'row-text');
      const paint = () => {
        st.textContent = `Nasluch: ${LABEL[W.state] || W.state}${W.state === 'error' && W.error ? ' - ' + W.error : ''}${W.hits ? ` · uslyszane: ${W.hits}` : ''}`;
        st.style.color = W.state === 'listening' ? 'var(--good)' : W.state === 'error' ? 'var(--red)' : 'var(--dim)';
      };
      paint();
      const onState = () => (document.body.contains(body) ? paint() : window.removeEventListener('jarvis:wake-state', onState));
      window.addEventListener('jarvis:wake-state', onState);
      window.addEventListener('jarvis:wake', onState);
      const row = el('div', 'field');
      row.style.cssText = 'margin:8px 0;flex-wrap:wrap;gap:6px';
      const t = el('button', wanted() ? 'btn ghost' : 'btn primary', wanted() ? 'WYLACZ NASLUCH' : 'WLACZ NASLUCH');
      t.addEventListener('click', () => {
        put(KEY, wanted() ? '0' : '1');
        if (wanted()) start();
        else stop();
        def.build(body);
      });
      const sfxOn = window.SFX?.isEnabled?.() !== false;
      const s = el('button', 'btn ghost', sfxOn ? 'DZWIEKI INTERFEJSU: WL.' : 'DZWIEKI INTERFEJSU: WYL.');
      s.addEventListener('click', () => {
        window.SFX?.setEnabled(!sfxOn);
        if (!sfxOn) window.SFX?.play('open');
        def.build(body);
      });
      row.append(t, s);
      body.append(st, row, el('div', 'sub', 'Rozpoznawanie dziala w aplikacji, offline (Vosk). Dzwiek z mikrofonu nie wychodzi z urzadzenia - tylko po uslyszeniu "Jarvis" startuje zwykla rozmowa.'));
    },
  };
  UI.extend('set', { wakeword: def });
})();
