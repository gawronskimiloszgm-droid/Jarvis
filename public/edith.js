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

  async function refresh() {
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

  async function scanNow(silent) {
    const scan = root.querySelector('#edithScan');
    if (!window.jarvisDesktop) {
      if (scan && !silent) scan.textContent = 'Skan komputera dziala tylko w aplikacji Jarvisa na Windowsie.';
      return;
    }
    if (scan && !silent) scan.textContent = 'Skanuje...';
    try {
      const result = await window.jarvisDesktop.runAction('skan-bezpieczenstwa');
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
  function micToggle() {
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

  root.querySelector('#edithScanBtn')?.addEventListener('click', () => scanNow(false));
  root.querySelector('#edithReportBtn')?.addEventListener('click', reportNow);
  root.querySelector('#edithMicBtn')?.addEventListener('click', micToggle);
  root.querySelector('#edithClose')?.addEventListener('click', () => window.Edith.close());

  let coreStarted = false;

  window.Edith = {
    open() {
      root.hidden = false;
      showTab('rozmowa');
      refresh();
      if (!coreStarted) {
        coreStarted = true;
        const canvas = root.querySelector('#edithCore');
        if (canvas && window.startCoreVisual) {
          window.startCoreVisual(canvas, 90125, window.CORE_THEMES?.edith);
        }
        startPatrol();
      }
      if (window.jarvisDesktop) scanNow(false);
    },
    close() {
      root.hidden = true;
      if (micRec) micRec.stop();
    },
    noteBlock() {
      this.open();
      showTab('zagrozenia');
      refresh();
    },
  };
})();
