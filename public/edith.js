(function () {
  const root = document.getElementById('edith');
  if (!root) return;

  const tabs = root.querySelectorAll('[data-tab]');
  const panels = root.querySelectorAll('[data-panel]');

  function showTab(id) {
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    panels.forEach((p) => p.classList.toggle('on', p.dataset.panel === id));
  }

  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  function when(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('pl-PL');
    } catch {
      return '';
    }
  }

  function paint(state) {
    const report = root.querySelector('#edithReport');
    const alerts = root.querySelector('#edithAlerts');
    const scan = root.querySelector('#edithScan');
    if (report) report.textContent = state?.report?.text || 'Jeszcze nie ma raportu.';
    if (scan) {
      const last = state?.scans?.[0];
      scan.textContent = last ? `${when(last.at)} — ${last.summary || 'skan zapisany'}` : 'Brak skanu. Na komputerze z aplikacja Jarvisa nacisnij „Skanuj teraz”.';
    }
    if (alerts) {
      alerts.innerHTML = '';
      (state?.alerts || []).slice(0, 20).forEach((a) => {
        const li = document.createElement('li');
        li.className = `edith-alert ${a.level || ''}`;
        const t = document.createElement('span');
        t.className = 'when';
        t.textContent = when(a.at);
        li.append(t, document.createTextNode(a.reason || ''));
        alerts.appendChild(li);
      });
      if (!state?.alerts?.length) {
        const li = document.createElement('li');
        li.textContent = 'Cicho. Nic nie zostalo zablokowane.';
        alerts.appendChild(li);
      }
    }
  }

  let auditFilter = '';
  const VERDICT_LABEL = { ok: 'OK', failed: 'BLAD', blocked: 'ZABLOKOWANE', confirm: 'POTWIERDZENIE', denied: 'ODRZUCONE', allowed: 'START' };

  async function refreshAudit() {
    const list = root.querySelector('#edithAudit');
    if (!list) return;
    try {
      const res = await fetch(`/api/audit?limit=60${auditFilter ? `&verdict=${auditFilter}` : ''}`, { headers: window.authHeaders ? authHeaders() : {} });
      if (!res.ok) return;
      const data = await res.json();
      list.innerHTML = '';
      data.entries.forEach((e) => {
        const li = document.createElement('li');
        li.className = `edith-alert ${e.verdict === 'blocked' || e.verdict === 'denied' ? 'block' : e.verdict === 'failed' || e.verdict === 'confirm' ? 'warn' : ''}`;
        const t = document.createElement('span');
        t.className = 'when';
        t.textContent = `${when(e.at)} · ${VERDICT_LABEL[e.verdict] || e.verdict} · ${e.source}`;
        li.append(t, document.createTextNode(`${e.name}${e.detail ? ` — ${e.detail}` : ''}${e.note ? ` (${e.note})` : ''}`));
        list.appendChild(li);
      });
      if (!data.entries.length) {
        const li = document.createElement('li');
        li.textContent = 'Brak wpisow.';
        list.appendChild(li);
      }
    } catch {
      /* dziennik jest dodatkiem */
    }
  }

  root.querySelectorAll('[data-audit]').forEach((b) =>
    b.addEventListener('click', () => {
      auditFilter = b.dataset.audit;
      refreshAudit();
    })
  );

  async function refresh() {
    refreshAudit();
    try {
      const res = await fetch('/api/edith/state', { headers: window.authHeaders ? authHeaders() : {} });
      if (!res.ok) return;
      paint(await res.json());
    } catch {
      /* ekran i tak zostaje */
    }
  }

  function setEdithState(text) {
    const n = root.querySelector('#edithCoreState');
    if (n) n.textContent = text;
  }

  // --- zakladka "Komputer": tryby uprawnien, wyniki skanu, narzedzia ---
  const D = () => window.jarvisDesktop;
  const toolOut = () => root.querySelector('#edithToolOut');

  function li(text, sub) {
    const n = document.createElement('li');
    if (sub) {
      const s = document.createElement('span');
      s.className = 'when';
      s.textContent = sub;
      n.appendChild(s);
    }
    n.appendChild(document.createTextNode(text));
    return n;
  }

  async function paintModes() {
    const box = root.querySelector('#edithModes');
    if (!box) return;
    const cur = D() ? await D().getSetting('permissionMode') : null;
    box.querySelectorAll('[data-mode]').forEach((b) => {
      b.disabled = !D();
      b.classList.toggle('solid', b.dataset.mode === cur);
      b.classList.toggle('ghost', b.dataset.mode !== cur);
    });
    const note = root.querySelector('#edithModeNote');
    if (note && !D()) note.textContent = 'Tryby uprawnien dzialaja tylko w aplikacji desktopowej.';
  }

  root.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!D()) return;
      await D().setSetting('permissionMode', b.dataset.mode);
      paintModes();
    })
  );

  // Akcja na podejrzanym procesie - przez ta sama polityke (zamkniecie i
  // zawieszenie wymagaja potwierdzenia, ktore tu pokazuje okno przegladarki).
  async function procAction(action, name) {
    if (!D()) return;
    let r = await D().runAction(action, { nazwa: name });
    if (r?.requiresEdithConfirmation) {
      if (!window.confirm('E.D.I.T.H.: ' + (r.warning || r.reason) + '\nWykonac?')) return;
      r = await D().runAction(action, { nazwa: name }, { confirmedByEdith: true });
    }
    fetch('/api/audit', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: action, detail: name, verdict: r?.ok ? 'ok' : 'failed', source: 'edith-panel', note: r?.error || '' }),
    }).catch(() => {});
    window.alert(r?.ok ? 'Gotowe.' : r?.error || 'Nie udalo sie.');
  }

  function paintFindings(result) {
    const ul = root.querySelector('#edithFindings');
    if (!ul || !result) return;
    ul.innerHTML = '';
    (result.suspiciousProcesses || []).forEach((p) => {
      const n = li('Podejrzanie wysokie zuzycie CPU: ' + p, 'proces');
      const box = document.createElement('div');
      box.className = 'edith-actions';
      [['Zawies', 'zawies-proces'], ['Zamknij', 'zamknij-proces']].forEach(([label, act]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ghost';
        b.textContent = label;
        b.addEventListener('click', () => procAction(act, p));
        box.appendChild(b);
      });
      n.appendChild(box);
      ul.appendChild(n);
    });
    (result.killedThreats || []).forEach((p) => ul.appendChild(li('Odcieto: ' + p, 'zagrozenie zneutralizowane')));
    (result.startupNew || []).forEach((i) => ul.appendChild(li(i.name + ' - ' + i.command, 'nowy wpis autostartu')));
    (result.listeningNew || []).forEach((l) => ul.appendChild(li(l.process + ':' + l.port, 'nowy nasluch w sieci')));
    (result.riskFindings || []).forEach((r) => ul.appendChild(li(r.text, r.level === 'warn' ? 'do sprawdzenia' : 'informacja')));
    (result.defenderThreats || []).forEach((t) => ul.appendChild(li(t.threat + (t.remediated ? ' (usuniete)' : ' (NIEUSUNIETE)'), 'wykrycie Defendera')));
    if (!ul.children.length) ul.appendChild(li(result.summary || 'Nic podejrzanego.'));
  }

  const TOOLS = {
    'defender-status': async () => {
      const r = await D().runAction('defender-status');
      if (!r?.ok) return [li(r?.error || 'Nie udalo sie.')];
      const s = r.status || {};
      return [
        li('Antywirus: ' + (s.antivirus ? 'wlaczony' : 'WYLACZONY') + ' · ochrona na zywo: ' + (s.realtime ? 'tak' : 'NIE') + ' · sygnatury: ' + s.signatures + ' (' + s.signatureAge + ' dni)', 'stan'),
        ...(r.threats || []).map((t) => li(t.threat + (t.remediated ? ' (usuniete)' : ' (nieusuniete)'), t.at)),
      ];
    },
    'defender-szybki': async () => [li((await D().runAction('defender-skan', { rodzaj: 'szybki' })).ok ? 'Szybki skan Defendera uruchomiony w tle.' : 'Nie udalo sie uruchomic skanu.')],
    'defender-pelny': async () => [li((await D().runAction('defender-skan', { rodzaj: 'pelny' })).ok ? 'Pelny skan Defendera uruchomiony w tle (potrwa).' : 'Nie udalo sie uruchomic skanu.')],
    autostart: async () => {
      const r = await D().runAction('skan-autostartu');
      return r?.ok ? r.items.map((i) => li(i.name + ' - ' + i.command, i.where)) : [li(r?.error || 'Nie udalo sie.')];
    },
    siec: async () => {
      const r = await D().runAction('polaczenia-sieciowe');
      if (!r?.ok) return [li(r?.error || 'Nie udalo sie.')];
      return [
        ...r.listening.map((l) => li(l.process + ' nasluchuje na porcie ' + l.port, 'nasluch')),
        ...r.established.slice(0, 40).map((c) => li(c.process + ' -> ' + c.remote, 'polaczenie')),
      ];
    },
  };

  root.querySelectorAll('[data-tool]').forEach((b) =>
    b.addEventListener('click', async () => {
      const out = toolOut();
      if (!out) return;
      out.innerHTML = '';
      if (!D()) {
        out.appendChild(li('To dziala tylko w aplikacji desktopowej.'));
        return;
      }
      out.appendChild(li('Sprawdzam...'));
      try {
        const items = await TOOLS[b.dataset.tool]();
        out.innerHTML = '';
        items.forEach((n) => out.appendChild(n));
      } catch (e) {
        out.innerHTML = '';
        out.appendChild(li('Blad: ' + e.message));
      }
    })
  );

  async function scanNow(silent) {
    const scan = root.querySelector('#edithScan');
    if (!window.jarvisDesktop) {
      if (scan && !silent) scan.textContent = 'Skan komputera dziala tylko w aplikacji Jarvisa na Windowsie.';
      return;
    }
    if (scan && !silent) scan.textContent = 'Skanuje...';
    try {
      const result = await window.jarvisDesktop.runAction('skan-bezpieczenstwa');
      paintFindings(result);
      await fetch('/api/edith/scan', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(result || { ok: false, summary: 'Pusty wynik.' }),
      });
    } catch {
      if (scan && !silent) scan.textContent = 'Skan nie doszedl do skutku.';
    }
    refresh();
  }

  // Patrol w tle: skanuje bez pytania, nie tylko "na zadanie" przy
  // otwarciu panelu - to z tego powodu E.D.I.T.H. w ogole moze powiedziec
  // "jest wirus" zanim ktokolwiek sam otworzy jej panel. Dziala tylko w
  // apce desktopowej (ona jedyna ma dostep do PowerShell/Defender) i tylko
  // gdy jest zalogowany wlasciciel (prosty test: czy jest token - serwer
  // i tak odrzuci zapis, jesli to zgadlo zle).
  const AUTO_SCAN_MS = 15 * 60 * 1000;
  function startPatrol() {
    if (!window.jarvisDesktop) return;
    setInterval(() => {
      if (localStorage.getItem('jarvis.token')) scanNow(true);
    }, AUTO_SCAN_MS);
  }

  async function reportNow() {
    await fetch('/api/edith/report', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
    refresh();
  }

  function addLine(who, text) {
    const feed = root.querySelector('#edithFeed');
    if (!feed) return null;
    const row = document.createElement('div');
    row.className = `edith-line ${who === 'me' ? 'me' : 'her'}`;
    const label = document.createElement('b');
    label.textContent = who === 'me' ? 'TY' : 'EDITH';
    row.append(label, document.createTextNode(text));
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
    return row;
  }

  // Ten sam /api/tts co Jarvis, ale z innym glosem (speaker:'edith') -
  // zeby rozmowa z nia brzmiala jak z kims innym, nie jak Jarvis
  // udajacy kogos innego.
  async function speakEdith(text) {
    if (!text) return;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speaker: 'edith' }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      setEdithState('MOWI');
      audio.onended = () => setEdithState('GOTOWA');
      await audio.play().catch(() => {});
    } catch {
      /* glos jest dodatkiem - brak glosu nie blokuje rozmowy */
    }
  }

  async function sendEdith(text) {
    addLine('me', text);
    const pending = addLine('her', '...');
    setEdithState('MYSLI');
    try {
      const res = await fetch('/api/edith/chat', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = data.text || data.error || 'Edith milczy.';
      if (pending) pending.lastChild.textContent = reply;
      speakEdith(reply);
    } catch {
      if (pending) pending.lastChild.textContent = 'Brak polaczenia z Edith.';
      setEdithState('GOTOWA');
    }
  }

  root.querySelector('#edithForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector('#edithInput');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    sendEdith(text);
  });

  // Nasluch jednorazowy (nie ciagly jak u Jarvisa) - naciskasz, mowisz
  // jedno zdanie, puszcza samo po pauzie. Prostsze niz pelna sesja Gemini
  // Live (ktorej E.D.I.T.H. celowo nie ma - to osobna, mniejsza rozmowa,
  // nie drugi tor glosu na zywo), a mimo to "gada sie z nia tak jak z
  // Jarvisem": mowisz, ona odpowiada glosem.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let micRec = null;
  function speechToggle() {
    const btn = root.querySelector('#edithMicBtn');
    if (!SR) {
      if (btn) btn.title = 'Rozpoznawanie mowy niedostepne w tej przegladarce.';
      return;
    }
    if (micRec) {
      micRec.stop();
      return;
    }
    const r = new SR();
    micRec = r;
    r.lang = 'pl-PL';
    r.continuous = false;
    r.interimResults = false;
    btn?.classList.add('on');
    setEdithState('SLUCHA');
    r.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (text) sendEdith(text);
    };
    r.onerror = () => setEdithState('GOTOWA');
    r.onend = () => {
      micRec = null;
      btn?.classList.remove('on');
      if (root.querySelector('#edithCoreState')?.textContent === 'SLUCHA') setEdithState('GOTOWA');
    };
    try {
      r.start();
    } catch {
      micRec = null;
      btn?.classList.remove('on');
    }
  }


  // ---------- Rozmowa na zywo z E.D.I.T.H. (osobna sesja Gemini Live) ----------
  // Wlasne polaczenie /ws/voice?persona=edith: jej klucz API, zenski glos,
  // zero narzedzi. Nie dotyka sesji Jarvisa - jesli ta dziala, zamykamy ja
  // na czas rozmowy z Edith.
  let eLive = null;

  function pcm16(f32) {
    const buf = new ArrayBuffer(f32.length * 2);
    const v = new DataView(buf);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  function down16k(f32, rate) {
    if (rate === 16000) return f32;
    const ratio = rate / 16000;
    const out = new Float32Array(Math.floor(f32.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const src = i * ratio;
      const lo = Math.floor(src);
      const hi = Math.min(lo + 1, f32.length - 1);
      out[i] = f32[lo] * (1 - (src - lo)) + f32[hi] * (src - lo);
    }
    return out;
  }

  function stopEdithLive() {
    const s = eLive;
    eLive = null;
    if (!s) return;
    try { s.ws.send(JSON.stringify({ type: 'end' })); } catch { /* polaczenie moglo juz byc zamkniete */ }
    try { s.ws.close(); } catch { /* j.w. */ }
    s.sources.forEach((n) => { try { n.stop(); } catch { /* juz zatrzymane */ } });
    try { s.node?.disconnect(); } catch { /* noop */ }
    s.stream?.getTracks().forEach((t) => t.stop());
    s.inCtx?.close().catch(() => {});
    s.outCtx?.close().catch(() => {});
    root.querySelector('#edithMicBtn')?.classList.remove('on');
    setEdithState('GOTOWA');
  }

  async function startEdithLive() {
    const UI = window.JarvisUI;
    if (UI?.store?.live) UI.toggleListening(); // Jarvis milknie na czas rozmowy z Edith
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const p = new URLSearchParams({ persona: 'edith' });
    if (UI?.store?.token) p.set('token', UI.store.token);
    const ws = new WebSocket(proto + '//' + location.host + '/ws/voice?' + p.toString());
    ws.binaryType = 'arraybuffer';
    const s = { ws, stream, sources: [], at: 0, outCtx: new (window.AudioContext || window.webkitAudioContext)(), inCtx: null, node: null, ready: false };
    eLive = s;
    root.querySelector('#edithMicBtn')?.classList.add('on');
    setEdithState('LACZE');

    ws.onopen = async () => {
      s.inCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = s.inCtx.createMediaStreamSource(stream);
      const onFrame = (f32) => {
        if (eLive !== s || ws.readyState !== WebSocket.OPEN || !s.ready) return;
        ws.send(pcm16(down16k(f32, s.inCtx.sampleRate)));
      };
      try {
        await s.inCtx.audioWorklet.addModule('/live-audio-processor.js');
        s.node = new AudioWorkletNode(s.inCtx, 'live-audio-processor');
        s.node.port.onmessage = (e) => onFrame(e.data);
        src.connect(s.node);
      } catch {
        s.node = s.inCtx.createScriptProcessor(4096, 1, 1);
        const g = s.inCtx.createGain();
        g.gain.value = 0;
        src.connect(s.node);
        s.node.connect(g);
        g.connect(s.inCtx.destination);
        s.node.onaudioprocess = (e) => onFrame(e.inputBuffer.getChannelData(0));
      }
    };

    ws.onmessage = (ev) => {
      if (eLive !== s) return;
      if (ev.data instanceof ArrayBuffer) {
        // Surowe PCM 24 kHz 16-bit mono od Gemini.
        const i16 = new Int16Array(ev.data);
        const f32 = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
        const buf = s.outCtx.createBuffer(1, f32.length, 24000);
        buf.copyToChannel(f32, 0);
        const node = s.outCtx.createBufferSource();
        node.buffer = buf;
        node.connect(s.outCtx.destination);
        s.at = Math.max(s.at, s.outCtx.currentTime + 0.05);
        node.start(s.at);
        s.at += buf.duration;
        s.sources.push(node);
        node.onended = () => { s.sources = s.sources.filter((x) => x !== node); };
        setEdithState('MOWI');
        return;
      }
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'ready') { s.ready = true; setEdithState('SLUCHA'); }
      else if (m.type === 'interrupted') {
        s.sources.forEach((n) => { try { n.stop(); } catch { /* noop */ } });
        s.sources = [];
        s.at = 0;
      } else if (m.type === 'heard') setEdithState('SLUCHA');
      else if (m.type === 'turnComplete') {
        if (m.userText) addLine('me', m.userText);
        if (m.assistantText) addLine('her', m.assistantText);
        setEdithState('SLUCHA');
      } else if (m.type === 'error') {
        addLine('her', 'Rozmowa na zywo nie dziala: ' + (m.message || 'blad'));
        stopEdithLive();
      }
    };
    ws.onclose = () => { if (eLive === s) stopEdithLive(); };
    ws.onerror = () => { if (eLive === s) stopEdithLive(); };
  }

  function micToggle() {
    if (eLive) return stopEdithLive();
    if (window.JarvisUI?.store?.token && navigator.mediaDevices?.getUserMedia) {
      startEdithLive().catch(() => {
        stopEdithLive();
        speechToggle();
      });
    } else speechToggle();
  }

  root.querySelector('#edithScanBtn')?.addEventListener('click', () => scanNow(false));
  root.querySelector('#edithScan2Btn')?.addEventListener('click', () => scanNow(false));
  root.querySelector('#edithReportBtn')?.addEventListener('click', reportNow);
  root.querySelector('#edithMicBtn')?.addEventListener('click', micToggle);
  root.querySelector('#edithClose')?.addEventListener('click', () => window.Edith.close());

  let coreStarted = false;
  const GREETINGS = [
    'Czuwam. Mow albo pisz.',
    'E.D.I.T.H. online. Slucham.',
    'Tu E.D.I.T.H. Co sie dzieje?',
  ];

  window.Edith = {
    open() {
      root.hidden = false;
      showTab('rozmowa');
      refresh();
      paintModes();
      if (!coreStarted) {
        coreStarted = true;
        const canvas = root.querySelector('#edithCore');
        if (canvas && window.startCoreVisual) {
          window.startCoreVisual(canvas, 90125, window.CORE_THEMES?.edith);
        }
        startPatrol();
      }
      // Bez tego ekran po przelaczeniu z Jarvisa po prostu milczal - nic
      // sie nie dzialo, dopoki ktos sam cos nie napisal/nie kliknal
      // mikrofonu, wiec wygladalo to jak "Edith sie nie odzywa". Krotkie
      // powitanie od razu, glosem I tekstem, potwierdza ze dziala.
      const hello = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
      addLine('her', hello);
      speakEdith(hello);
      if (window.jarvisDesktop) scanNow(false);
    },
    close() {
      root.hidden = true;
      if (micRec) micRec.stop();
      stopEdithLive();
    },
    noteBlock() {
      this.open();
      showTab('zagrozenia');
      refresh();
    },
  };
})();
