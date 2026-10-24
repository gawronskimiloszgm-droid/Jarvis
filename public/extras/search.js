// Wyszukiwanie globalne w palecie (Ctrl+K): oprocz modulow szuka w zadaniach,
// przypomnieniach, notatkach, dokumentach, pamieci, trybach, profilach i szybkich
// akcjach. Rozumie tez krotkie polecenia: "minutnik 10 herbata", "graj metallica",
// "skupienie 25", "profil praca", "otworz notepad".
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { api, isOwner, toast, deaccent } = UI;

  let index = [];
  let loadedAt = 0;

  const norm = (s) => (deaccent ? deaccent(String(s || '')) : String(s || '')).toLowerCase();

  async function buildIndex() {
    if (!isOwner() || Date.now() - loadedAt < 30000) return;
    loadedAt = Date.now();
    const [t, r, n, d, m, rt, p] = await Promise.all([
      api('/api/todos').catch(() => ({})),
      api('/api/reminders').catch(() => ({})),
      api('/api/notes').catch(() => ({})),
      api('/api/docs').catch(() => ({})),
      api('/api/memory').catch(() => ({})),
      api('/api/routines').catch(() => []),
      api('/api/profiles').catch(() => ({})),
    ]);
    const out = [];
    (t.todos || []).forEach((x) => out.push({ label: `${x.done ? '☑' : '☐'} ${x.text}`, hint: 'zadanie', run: () => UI.openWindow('tasks') }));
    (r.reminders || [])
      .filter((x) => !x.sent)
      .forEach((x) => out.push({ label: `⏰ ${x.text}`, hint: `przypomnienie ${new Date(x.dueAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}`, run: () => UI.openWindow('tasks') }));
    (n.notes || []).forEach((x) => out.push({ label: `♪ ${x.tytul}`, hint: 'notatka', text: `${x.tytul} ${x.streszczenie || ''}`, run: () => UI.openWindow('notes') }));
    (d.docs || []).forEach((x) => out.push({ label: `▤ ${x.name}`, hint: 'dokument', run: () => UI.openWindow('analysis') }));
    (m.facts || []).forEach((x) => out.push({ label: `✦ ${typeof x === 'string' ? x : x.text || ''}`, hint: 'pamiec', run: () => UI.openWindow('know') }));
    (Array.isArray(rt) ? rt : []).forEach((x) => out.push({ label: `▶ tryb: ${x.name}`, hint: `${x.steps?.length || 0} krokow - uruchom`, run: () => UI.runRoutine(x.steps) }));
    (p.list || []).forEach((x) => out.push({ label: `☰ profil: ${x.name}`, hint: x.name === p.active ? 'aktywny' : 'przelacz', run: () => UI.runDeviceAction('profil', { nazwa: x.name }) }));
    index = out;
    // Indeks doszedl po otwarciu palety - przerysuj wyniki dla tego, co juz wpisano.
    const inp = document.getElementById('paletteInput');
    if (inp && inp.value.trim() && !document.getElementById('palette')?.hidden) inp.dispatchEvent(new Event('input'));
  }

  window.addEventListener('jarvis:palette-open', () => buildIndex().catch(() => {}));

  // Polecenia wpisane wprost.
  function commands(q) {
    const raw = q.trim();
    const m = raw.match(/^(\S+)\s*(.*)$/);
    if (!m) return [];
    const verb = norm(m[1]);
    const rest = m[2].trim();
    const out = [];
    if (verb === 'minutnik' || verb === 'timer') {
      const [mins, ...name] = rest.split(/\s+/);
      if (parseFloat(mins) > 0) out.push({ label: `◷ Minutnik ${parseFloat(mins)} min${name.length ? ' - ' + name.join(' ') : ''}`, hint: 'ENTER', run: () => UI.timers?.startTimer(parseFloat(mins), name.join(' ')) });
    }
    if ((verb === 'graj' || verb === 'pusc' || verb === 'zagraj') && rest) out.push({ label: `♫ Graj: ${rest}`, hint: 'ENTER', run: () => UI.runDeviceAction('graj', { zapytanie: rest }) });
    if (verb === 'skupienie' || verb === 'pomodoro') out.push({ label: `◷ Skupienie ${parseFloat(rest) || 25} min`, hint: 'ENTER', run: () => UI.timers?.startFocus(parseFloat(rest) || 25) });
    if (verb === 'profil' && rest) out.push({ label: `☰ Profil: ${rest}`, hint: 'ENTER', run: () => UI.runDeviceAction('profil', { nazwa: rest }) });
    if ((verb === 'otworz' || verb === 'uruchom') && rest) out.push({ label: `⬡ Otworz: ${rest}`, hint: 'ENTER', run: () => UI.runDeviceAction('otworz-aplikacje', { nazwa: rest }) });
    if (verb === 'cisza' || verb === 'dnd') out.push({ label: `☾ Nie przeszkadzac ${parseFloat(rest) || 60} min`, hint: 'ENTER', run: () => UI.runDeviceAction('nie-przeszkadzac', { minuty: parseFloat(rest) || 60 }) });
    return out;
  }

  UI.paletteSearch = (q) => {
    const nq = norm(q);
    if (nq.length < 2) return commands(q);
    const words = nq.split(/\s+/).filter(Boolean);
    const hits = index.filter((it) => {
      const hay = norm(`${it.label} ${it.text || ''} ${it.hint}`);
      return words.every((w) => hay.includes(w));
    });
    let quick = [];
    try {
      quick = JSON.parse(localStorage.getItem('jarvis.quick') || 'null') || [];
    } catch {
      quick = [];
    }
    const qa = (Array.isArray(quick) ? quick : [])
      .filter((x) => norm(x.label).includes(nq))
      .map((x) => ({ label: `⚡ ${x.label}`, hint: 'szybka akcja', run: () => (UI.runQuickCommand ? UI.runQuickCommand(x.cmd) : toast(x.cmd)) }));
    return [...commands(q), ...qa, ...hits.slice(0, 12)];
  };
})();
