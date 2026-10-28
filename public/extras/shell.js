// Powloka interfejsu: chipy stanu w naglowku (teraz gra, minutnik, cisza, profil,
// komputer, powiadomienia), centrum powiadomien, kompaktowa szyna i panel
// "Pamiec" (czy dane przezyja restart serwera).
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
      /* bez localStorage ustawienie trwa do zamkniecia karty */
    }
  };

  // Grupy dla modulow z dodatkow (wbudowane maja je w app.js).
  const GROUPS = { notes: 'Glowne', mail: 'Glowne', profiles: 'System', macros: 'Komputer', worktime: 'Komputer', remote: 'Komputer', screenagent: 'Komputer', analysis: 'Wiedza', doctor: 'System' };
  Object.entries(GROUPS).forEach(([id, g]) => UI.setGroup?.(id, g));

  // ---------- kompaktowa szyna ----------
  if (get('jarvis.railCompact', '0') === '1') document.body.classList.add('rail-compact');
  function addRailToggle() {
    const foot = document.querySelector('.rail-foot');
    if (!foot || foot.querySelector('.rail-compact-btn')) return;
    const b = el('button', 'rail-btn rail-compact-btn', '⇔');
    b.title = 'Zwin / rozwin szyne';
    b.addEventListener('click', () => {
      const on = document.body.classList.toggle('rail-compact');
      put('jarvis.railCompact', on ? '1' : '0');
    });
    foot.prepend(b);
  }

  // ---------- centrum powiadomien ----------
  const SEEN = 'jarvis.notifSeen';
  let edithAlerts = [];
  let reminders = [];
  let drawer = null;

  function notifications() {
    const out = [];
    (UI.events?.() || []).forEach((e) => {
      if (e.kind === 'warn' || e.kind === 'err') out.push({ at: +new Date(e.at), kind: e.kind, text: `${e.source}: ${e.message}` });
    });
    edithAlerts.forEach((a) => out.push({ at: a.at, kind: a.level === 'block' ? 'block' : a.level === 'report' ? 'ok' : 'warn', text: `E.D.I.T.H.: ${a.reason}` }));
    const soon = Date.now() + 3600000;
    reminders
      .filter((r) => !r.sent && new Date(r.dueAt).getTime() <= soon && new Date(r.dueAt).getTime() > Date.now() - 600000)
      .forEach((r) => out.push({ at: new Date(r.dueAt).getTime(), kind: 'ok', text: `Przypomnienie ${new Date(r.dueAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}: ${r.text}` }));
    return out.sort((a, b) => b.at - a.at).slice(0, 60);
  }

  UI.notifications = notifications;

  function unread() {
    const seen = Number(get(SEEN, '0')) || 0;
    return notifications().filter((n) => n.at > seen).length;
  }

  async function loadSources() {
    if (!isOwner()) return;
    const [s, r] = await Promise.all([api('/api/edith/state').catch(() => null), api('/api/reminders').catch(() => null)]);
    if (s) edithAlerts = (s.alerts || []).filter((a) => a.at >= Date.now() - 3 * 86400000).slice(0, 30);
    if (r) reminders = r.reminders || [];
    drawChips();
  }

  function openDrawer() {
    if (!drawer) {
      drawer = el('div', 'notif-drawer');
      drawer.hidden = true;
      document.body.appendChild(drawer);
      document.addEventListener('click', (e) => {
        if (!drawer.hidden && !drawer.contains(e.target) && !e.target.closest('.chip.bell')) drawer.hidden = true;
      });
    }
    const seen = Number(get(SEEN, '0')) || 0;
    drawer.innerHTML = '';
    const head = el('div', 'notif-head');
    head.appendChild(el('span', null, 'Powiadomienia'));
    const close = el('button', 'btn ghost', 'ZAMKNIJ');
    close.addEventListener('click', () => (drawer.hidden = true));
    head.appendChild(close);
    const list = el('div', 'notif-list');
    const items = notifications();
    if (!items.length) list.appendChild(el('div', 'w-empty', 'Nic nowego.'));
    items.forEach((n) => {
      const d = el('div', `notif ${n.kind}${n.at > seen ? ' unread' : ''}`, n.text.slice(0, 240));
      d.appendChild(el('small', null, new Date(n.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })));
      list.appendChild(d);
    });
    drawer.append(head, list);
    drawer.hidden = false;
    put(SEEN, String(Date.now()));
    drawChips();
  }

  // ---------- chipy ----------
  let profile = null;
  let remoteOnline = null;

  function chip(cls, content, onClick, title) {
    const c = el('button', `chip ${cls}`);
    c.type = 'button';
    if (title) c.title = title;
    content.forEach((x) => c.appendChild(typeof x === 'string' ? el('span', 't', x) : x));
    if (onClick) c.addEventListener('click', onClick);
    return c;
  }

  function drawChips() {
    const box = document.getElementById('headChips');
    if (!box) return;
    addRailToggle();
    box.innerHTML = '';
    if (!isOwner()) return;

    // Teraz gra
    const np = UI.nowPlaying || {};
    if (np.connected && np.track) {
      const parts = [];
      if (np.image) {
        const img = el('img');
        img.src = np.image;
        img.alt = '';
        parts.push(img);
      }
      parts.push(`${np.playing ? '' : '❚❚ '}${np.artist ? np.artist + ' – ' : ''}${np.track}`);
      const ctl = el('span', 'ctl', np.playing ? '⏸' : '▶');
      ctl.title = np.playing ? 'Pauza' : 'Graj';
      ctl.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.musicControl?.(np.playing ? 'pauza' : 'wznow').catch((err) => toast(err.message));
      });
      parts.push(ctl);
      box.appendChild(chip('np', parts, () => UI.openWindow('dash'), 'Teraz gra'));
    }

    // Najblizszy minutnik
    const t = UI.timers?.list?.()[0];
    if (t) box.appendChild(chip(`always${t.kind === 'focus' ? ' on' : t.kind === 'break' ? ' warn' : ''}`, [`◷ ${t.name || 'Minutnik'} ${UI.timers.fmt(t.end - Date.now())}`], () => UI.openWindow('dash')));

    // Cisza
    if (UI.dnd?.active) {
      const until = new Date(UI.dnd.until).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      box.appendChild(
        chip('warn', [`☾ cisza do ${until}`], async () => {
          if (!window.confirm('Wylaczyc tryb "nie przeszkadzac"?')) return;
          await api('/api/dnd', json({ minutes: 0 })).catch(() => {});
          window.dispatchEvent(new Event('jarvis:dnd'));
        }, 'Kliknij, zeby wylaczyc')
      );
    }

    // Profil
    if (profile && profile !== 'dom') box.appendChild(chip('', [`☰ ${profile}`], () => UI.openWindow('profiles'), 'Aktywny profil'));

    // Komputer (gdy jestesmy na telefonie/przegladarce)
    if (!D() && remoteOnline != null) box.appendChild(chip(remoteOnline ? 'on' : '', [remoteOnline ? '⌘ PC online' : '⌘ PC offline'], () => UI.openWindow('remote')));

    // Powiadomienia
    const n = unread();
    const bellParts = ['🔔'];
    if (n) bellParts.push(el('span', 'n', String(n > 99 ? '99+' : n)));
    box.appendChild(chip('bell always', bellParts, (e) => {
      e.stopPropagation();
      drawer && !drawer.hidden ? (drawer.hidden = true) : openDrawer();
    }, 'Powiadomienia'));
  }
  UI.drawChips = drawChips;

  async function loadRemote() {
    if (D() || !isOwner()) return;
    remoteOnline = await api('/api/remote/status').then((s) => s.online).catch(() => null);
  }
  async function loadProfile() {
    if (!isOwner()) return;
    profile = await api('/api/profiles').then((s) => s.active).catch(() => profile);
  }

  ['jarvis:now-playing', 'jarvis:timers', 'jarvis:dnd'].forEach((ev) => window.addEventListener(ev, () => setTimeout(drawChips, 50)));
  window.addEventListener('jarvis:ready', async () => {
    addRailToggle();
    await Promise.all([loadSources(), loadProfile(), loadRemote()]);
    drawChips();
    setInterval(() => document.visibilityState === 'visible' && loadSources(), 120000);
    setInterval(() => document.visibilityState === 'visible' && Promise.all([loadProfile(), loadRemote()]).then(drawChips), 60000);
    setInterval(() => UI.timers?.list?.().length && drawChips(), 1000);
  });

  // ---------- panel "Pamiec" ----------
  const memDef = {
    title: 'PAMIEC SERWERA',
    glyph: '⛁',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const h = window.__health || {};
      const ok = h.memoryPersistent;
      const st = el('div', 'row-text', ok ? 'Pamiec TRWALA (Upstash Redis) - profile, makra, aliasy, polaczenie Spotify i historia przezywaja restart serwera.' : 'Pamiec ULOTNA - serwer na darmowym Renderze traci ja przy kazdym restarcie i wdrozeniu (profile, makra, aliasy, polaczenie Spotify, czas pracy).');
      st.style.color = ok ? 'var(--good)' : 'var(--amber)';
      body.appendChild(st);
      if (!ok) {
        const steps = el('div', 'w-list');
        steps.style.marginTop = '10px';
        [
          '1. Zaloz darmowe konto na upstash.com i utworz baze Redis (region: Frankfurt).',
          '2. W bazie, w sekcji "REST API", skopiuj UPSTASH_REDIS_REST_URL i UPSTASH_REDIS_REST_TOKEN.',
          '3. W Renderze: Environment -> dodaj obie zmienne -> Save, rebuild and deploy.',
          '4. Po wdrozeniu ten panel pokaze "Pamiec TRWALA". Darmowy plan Upstash w zupelnosci wystarczy.',
        ].forEach((s) => steps.appendChild(el('div', null, s)));
        body.appendChild(steps);
      }
    },
  };
  UI.extend('set', { memory: memDef });
})();
