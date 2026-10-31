// Modul "Automatyzacje": prosty kreator regul "gdy X, zrob Y" laczacy makra, tryby, profile, muzyke,
// dzialania na danych i dom. Reguly sa zapisane na serwerze, a wykonuje je urzadzenie, ktore ma to
// wlaczone (domyslnie aplikacja desktopowa, zeby telefon i komputer nie robily tego samego dwa razy).
(function () {
  const UI = window.JarvisUI;
  const E = window.AutoEngine;
  if (!UI || !E || !UI.register) return;
  const { el, api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const HERE = 'jarvis.autoHere';

  const runsHere = () => {
    const v = localStorage.getItem(HERE);
    return v == null ? Boolean(D()) : v === '1';
  };

  // ---------- co regula moze zrobic ----------
  const ACTIONS = {
    speak: { label: 'Jarvis mówi', hint: 'tekst', run: (a) => UI.speak?.(a.value) },
    toast: { label: 'Pokaż komunikat', hint: 'tekst', run: (a) => toast(a.value, 'ok') },
    journal: { label: 'Wpis w dzienniku', hint: 'tekst', run: (a) => UI.life.add('journal', { text: a.value, kind: 'manual' }) },
    todo: { label: 'Dodaj zadanie', hint: 'treść', run: (a) => api('/api/todos', json('POST', { text: a.value })) },
    note: { label: 'Szybka notatka', hint: 'treść', run: (a) => UI.life.add('quicknotes', { text: a.value }) },
    open: { label: 'Otwórz moduł', hint: 'np. dash, journal, shop', run: (a) => UI.openWindow(a.value) },
    music: { label: 'Włącz muzykę', hint: 'utwór lub wykonawca', run: (a) => UI.runDeviceAction('graj', { zapytanie: a.value }) },
    profile: { label: 'Przełącz profil', hint: 'nazwa profilu', run: (a) => UI.runDeviceAction('profil', { nazwa: a.value }) },
    dnd: { label: 'Nie przeszkadzać', hint: 'minuty (0 = wyłącz)', run: (a) => api('/api/dnd', json('POST', { minutes: Number(a.value) || 0 })) },
    focus: { label: 'Tryb skupienia', hint: 'minuty', run: (a) => UI.timers?.startFocus(Number(a.value) || 25) },
    routine: { label: 'Uruchom tryb', hint: 'nazwa trybu', run: async (a) => UI.runRoutine((await api(`/api/routines/${encodeURIComponent(a.value)}`)).steps) },
    dom: { label: 'Dom: urządzenie', hint: 'np. włącz salon, wyłącz biurko', run: (a) => UI.dom?.command(a.value) },
    device: { label: 'Akcja na komputerze', hint: 'np. otworz-aplikacje; notepad', run: (a) => {
      const [name, param] = String(a.value).split(';').map((s) => s.trim());
      return UI.runDeviceAction(name, UI.paramsForAction(name, param));
    } },
  };

  const TEMPLATES = [
    { name: 'Po skupieniu zapisz w dzienniku', when: { type: 'focusEnd' }, then: [{ type: 'journal', value: 'Blok skupienia ukończony.' }] },
    { name: 'Dzień dobry o 7:30', when: { type: 'time', at: '07:30', days: [1, 2, 3, 4, 5] }, then: [{ type: 'speak', value: 'Dzień dobry, sir. Czas zaczynać.' }, { type: 'open', value: 'dash' }] },
    { name: 'Powrót do komputera: muzyka', when: { type: 'back' }, then: [{ type: 'music', value: 'AC/DC' }] },
    { name: 'Gra: nie przeszkadzać', when: { type: 'gameStart' }, then: [{ type: 'dnd', value: '120' }] },
    { name: 'Koniec gry: wróć do pracy', when: { type: 'gameEnd' }, then: [{ type: 'dnd', value: '0' }, { type: 'speak', value: 'Koniec grania, sir. Odzyskuję panu powiadomienia.' }] },
    { name: 'Wieczorem przypomnij o dzienniku', when: { type: 'time', at: '21:30' }, then: [{ type: 'speak', value: 'Pora na wpis w dzienniku, sir.' }, { type: 'open', value: 'journal' }] },
  ];

  // ---------- wykonywanie ----------
  let rules = [];
  const lastRun = {};
  const log = [];

  async function runRule(r, why) {
    lastRun[r.id] = Date.now();
    const results = [];
    for (const a of r.then || []) {
      const def = ACTIONS[a.type];
      if (!def) continue;
      try {
        await def.run(a);
        results.push(`${def.label}: ok`);
      } catch (e) {
        results.push(`${def.label}: ${e.message || 'błąd'}`);
      }
    }
    log.unshift({ at: Date.now(), name: r.name, why, results });
    log.length = Math.min(log.length, 30);
    UI.activity?.emit('automatyzacja', `Reguła „${r.name}” (${why})`);
    window.dispatchEvent(new Event('jarvis:auto-log'));
  }

  function dispatch(ev, why) {
    if (!runsHere() || !isOwner()) return;
    E.pick(rules, ev, lastRun, Date.now()).forEach((r) => runRule(r, why).catch(() => {}));
  }

  async function reload() {
    if (!isOwner()) return;
    rules = await UI.life.list('automations', true).catch(() => []);
  }

  window.addEventListener('jarvis:activity', (e) => {
    const d = e.detail || {};
    dispatch({ type: 'activity', kind: d.kind, text: d.text }, d.text?.slice(0, 50) || d.kind);
  });
  window.addEventListener('jarvis:life', (e) => {
    if (e.detail?.coll === 'automations') reload();
  });
  window.addEventListener('jarvis:ready', async () => {
    await reload();
    dispatch({ type: 'start' }, 'start aplikacji');
    let lastMinute = '';
    setInterval(() => {
      const n = new Date();
      const hm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
      if (hm === lastMinute) return;
      lastMinute = hm;
      dispatch({ type: 'tick', hm, dow: n.getDay() }, `godzina ${hm}`);
    }, 5000);
  });

  UI.automations = { dispatch, reload, runRule, rules: () => rules, log: () => log };

  // ---------- modul ----------
  const select = (opts, value) => {
    const s = el('select', 'inp');
    opts.forEach(([v, l]) => s.appendChild(Object.assign(el('option', null, l), { value: v })));
    if (value != null) s.value = value;
    return s;
  };

  const panel = {
    title: 'AUTOMATYZACJE',
    glyph: '⟿',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostępne tylko dla właściciela.';
        return;
      }
      body.innerHTML = '';
      const here = el('label', 'kv');
      const hereBox = el('input');
      hereBox.type = 'checkbox';
      hereBox.checked = runsHere();
      hereBox.addEventListener('change', () => localStorage.setItem(HERE, hereBox.checked ? '1' : '0'));
      here.append(el('span', null, 'To urządzenie wykonuje reguły (działają, gdy aplikacja jest uruchomiona)'), hereBox);
      body.appendChild(here);

      // kreator
      const form = el('div', 'au-form');
      const name = el('input', 'inp');
      name.placeholder = 'Nazwa reguły';
      const trigger = select(Object.entries(E.TRIGGERS).map(([k, v]) => [k, `GDY: ${v.label}`]));
      const at = el('input', 'inp');
      at.type = 'time';
      at.value = '08:00';
      const days = el('div', 'au-days');
      const dayBoxes = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'].map((d, i) => {
        const l = el('label', 'w-dim');
        const c = el('input');
        c.type = 'checkbox';
        c.value = String(i);
        l.append(c, document.createTextNode(` ${d}`));
        days.appendChild(l);
        return c;
      });
      const contains = el('input', 'inp');
      contains.placeholder = 'zawiera tekst...';
      const steps = el('div', 'au-steps');
      const addStep = (step = {}) => {
        const row = el('div', 'field');
        row.style.cssText = 'gap:6px;flex-wrap:wrap;margin:4px 0';
        const type = select(Object.entries(ACTIONS).map(([k, v]) => [k, `ZRÓB: ${v.label}`]), step.type);
        const value = el('input', 'inp');
        value.style.flex = '1 1 200px';
        value.value = step.value || '';
        const hint = () => (value.placeholder = ACTIONS[type.value].hint);
        type.addEventListener('change', hint);
        hint();
        const x = el('button', 'row-x', '×');
        x.addEventListener('click', () => row.remove());
        row.append(type, value, x);
        row._get = () => ({ type: type.value, value: value.value.trim() });
        steps.appendChild(row);
      };
      const showFields = () => {
        const f = E.TRIGGERS[trigger.value];
        const isTime = trigger.value === 'time';
        at.hidden = !isTime;
        days.hidden = !isTime;
        contains.hidden = !(f.fields || []).includes('contains');
      };
      trigger.addEventListener('change', showFields);
      const more = el('button', 'btn ghost', '+ KOLEJNE DZIAŁANIE');
      more.addEventListener('click', () => addStep());
      const save = el('button', 'btn primary', 'ZAPISZ REGUŁĘ');
      const fill = (t) => {
        name.value = t.name;
        trigger.value = t.when.type;
        at.value = t.when.at || '08:00';
        dayBoxes.forEach((c) => (c.checked = (t.when.days || []).includes(Number(c.value))));
        contains.value = t.when.contains || '';
        steps.innerHTML = '';
        t.then.forEach(addStep);
        showFields();
      };
      save.addEventListener('click', async () => {
        const then = [...steps.children].map((r) => r._get()).filter((s) => s.value || s.type === 'open');
        if (!name.value.trim() || !then.length) return toast('Podaj nazwę i co najmniej jedno działanie.');
        const when = { type: trigger.value };
        if (trigger.value === 'time') {
          when.at = at.value;
          when.days = dayBoxes.filter((c) => c.checked).map((c) => Number(c.value));
        }
        if (contains.value.trim() && !contains.hidden) when.contains = contains.value.trim();
        try {
          await UI.life.add('automations', { name: name.value.trim(), when, then, on: true });
          toast('Reguła zapisana.', 'ok');
          name.value = '';
          steps.innerHTML = '';
          addStep();
          draw();
        } catch (e) {
          toast(e.message || 'Nie udało się zapisać.');
        }
      });
      const actions = el('div', 'field');
      actions.style.cssText = 'gap:6px;flex-wrap:wrap;margin-top:6px';
      actions.append(more, save);
      form.append(name, trigger, at, days, contains, steps, actions);

      const tpl = el('div', 'field');
      tpl.style.cssText = 'gap:6px;flex-wrap:wrap;margin:8px 0';
      TEMPLATES.forEach((t) => {
        const b = el('button', 'btn ghost', t.name);
        b.addEventListener('click', () => fill(t));
        tpl.appendChild(b);
      });
      const list = el('div', 'w-list');
      const logBox = el('div', 'w-list');
      body.append(el('div', 'sub', 'GOTOWE PRZEPISY'), tpl, el('div', 'sub', 'NOWA REGUŁA'), form, el('div', 'sub', 'TWOJE REGUŁY'), list, el('div', 'sub', 'OSTATNIE WYKONANIA'), logBox);

      const drawLog = () => {
        logBox.innerHTML = '';
        if (!log.length) logBox.appendChild(el('div', 'w-empty', 'Jeszcze nic się nie wykonało.'));
        log.slice(0, 8).forEach((l) => logBox.appendChild(el('div', 'w-dim', `${new Date(l.at).toLocaleTimeString('pl-PL', { hour12: false })} ${l.name}: ${l.results.join(', ')}`)));
      };
      async function draw() {
        await reload();
        list.innerHTML = '';
        if (!rules.length) list.appendChild(el('div', 'w-empty', 'Brak reguł. Wybierz gotowy przepis albo utwórz własną.'));
        rules.forEach((r) => {
          const it = el('div', 'au-rule');
          const on = el('input');
          on.type = 'checkbox';
          on.checked = r.on !== false;
          on.title = 'Włączona';
          on.addEventListener('change', async () => {
            await UI.life.patch('automations', r.id, { on: on.checked });
            reload();
          });
          const info = el('div');
          info.style.flex = '1';
          info.append(el('b', null, r.name), el('div', 'w-dim', `Gdy ${E.describe(r.when)} → ${(r.then || []).map((a) => ACTIONS[a.type]?.label || a.type).join(', ')}`));
          const test = el('button', 'btn ghost', 'TEST');
          test.addEventListener('click', () => runRule(r, 'test ręczny'));
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', async () => {
            await UI.life.del('automations', r.id);
            draw();
          });
          it.append(on, info, test, del);
          list.appendChild(it);
        });
        drawLog();
      }
      window.addEventListener('jarvis:auto-log', function h() {
        if (!document.body.contains(logBox)) return window.removeEventListener('jarvis:auto-log', h);
        drawLog();
      });
      addStep();
      showFields();
      draw();
    },
  };
  UI.register({ id: 'auto', title: 'Automatyzacje', sub: 'gdy X, zrób Y', icon: '⟿', owner: true, group: 'Komputer', panels: { auto: panel } });
})();
