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

  async function scanNow() {
    const scan = root.querySelector('#edithScan');
    if (!window.jarvisDesktop) {
      if (scan) scan.textContent = 'Skan komputera dziala tylko w aplikacji Jarvisa na Windowsie.';
      return;
    }
    if (scan) scan.textContent = 'Skanuje...';
    try {
      const result = await window.jarvisDesktop.runAction('skan-bezpieczenstwa');
      await fetch('/api/edith/scan', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(result || { ok: false, summary: 'Pusty wynik.' }),
      });
    } catch {
      if (scan) scan.textContent = 'Skan nie doszedl do skutku.';
    }
    refresh();
  }

  async function reportNow() {
    await fetch('/api/edith/report', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
    refresh();
  }

  function addLine(who, text) {
    const feed = root.querySelector('#edithFeed');
    if (!feed) return;
    const row = document.createElement('div');
    row.className = `edith-line ${who === 'me' ? 'me' : 'her'}`;
    const label = document.createElement('b');
    label.textContent = who === 'me' ? 'TY' : 'EDITH';
    row.append(label, document.createTextNode(text));
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
  }

  async function sendEdith(text) {
    addLine('me', text);
    addLine('her', '...');
    const feed = root.querySelector('#edithFeed');
    const pending = feed?.lastElementChild;
    try {
      const res = await fetch('/api/edith/chat', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (pending) pending.lastChild.textContent = data.text || data.error || 'Edith milczy.';
    } catch {
      if (pending) pending.lastChild.textContent = 'Brak polaczenia z Edith.';
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

  root.querySelector('#edithScanBtn')?.addEventListener('click', scanNow);
  root.querySelector('#edithReportBtn')?.addEventListener('click', reportNow);
  root.querySelector('#edithClose')?.addEventListener('click', () => window.Edith.close());

  window.Edith = {
    open() {
      root.hidden = false;
      showTab('rozmowa');
      refresh();
      if (window.jarvisDesktop) scanNow();
    },
    close() {
      root.hidden = true;
    },
    noteBlock() {
      this.open();
      showTab('zagrozenia');
      refresh();
    },
  };
})();
