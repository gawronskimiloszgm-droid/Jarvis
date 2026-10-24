// Profile: jedno slowo przelacza motyw, animacje, tryb uprawnien na komputerze,
// "nie przeszkadzac" i uruchamia wybrany tryb. Glosem/czatem:
// [AKCJA: profil | praca].
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function activate(name) {
    const r = await api('/api/profiles/activate', json('POST', { name }));
    const p = r.profile;
    UI.appearance?.setTheme(p.theme);
    UI.appearance?.setMotion(p.motion);
    if (D()) await D().setSetting('permissionMode', p.permissionMode).catch(() => {});
    await api('/api/dnd', json('POST', { minutes: p.dndMinutes })).catch(() => {});
    window.dispatchEvent(new Event('jarvis:dnd'));
    if (p.routine) {
      const routine = await api(`/api/routines/${encodeURIComponent(p.routine)}`).catch(() => null);
      if (routine) UI.runRoutine(routine.steps);
    }
    toast(`Profil: ${p.name}`, 'ok');
    return p;
  }

  UI.clientActions['profil'] = async (params) => {
    const name = String(params?.nazwa || '').trim();
    if (!name) return toast('Podaj nazwe profilu.');
    try {
      await activate(name);
    } catch (e) {
      toast(e.message);
    }
  };

  const def = {
    title: 'PROFILE',
    glyph: '☰',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) {
        body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
        return;
      }
      const list = el('div');
      const form = el('form');
      form.style.marginTop = '14px';

      async function draw() {
        const s = await api('/api/profiles');
        list.innerHTML = '';
        s.list.forEach((p) => {
          const row = el('div', 'row');
          row.style.cssText = 'display:block;border-left:3px solid ' + (p.name === s.active ? 'var(--good)' : 'var(--line-3)') + ';padding:6px 10px;margin:6px 0';
          row.appendChild(el('div', 'row-text', `${p.name}${p.name === s.active ? '  (aktywny)' : ''}`));
          row.appendChild(el('div', 'sub', `motyw: ${p.theme} · animacje: ${p.motion} · uprawnienia: ${p.permissionMode} · cisza: ${p.dndMinutes ? p.dndMinutes + ' min' : 'brak'}${p.routine ? ' · tryb: ' + p.routine : ''}`));
          if (p.note) row.appendChild(el('div', 'sub', p.note));
          const btns = el('div', 'field');
          const go = el('button', 'btn primary', 'WLACZ');
          go.addEventListener('click', async () => {
            try {
              await activate(p.name);
              draw();
            } catch (e) {
              toast(e.message);
            }
          });
          const del = el('button', 'btn ghost', 'USUN');
          del.addEventListener('click', async () => {
            try {
              await api(`/api/profiles/${encodeURIComponent(p.name)}`, { method: 'DELETE' });
              draw();
            } catch (e) {
              toast(e.message);
            }
          });
          btns.append(go, del);
          row.appendChild(btns);
          list.appendChild(row);
        });
      }

      const field = (ph) => {
        const i = el('input', 'inp');
        i.placeholder = ph;
        return i;
      };
      const select = (opts) => {
        const s = el('select', 'inp');
        opts.forEach((o) => {
          const op = el('option', null, o);
          op.value = o;
          s.appendChild(op);
        });
        return s;
      };
      const name = field('nazwa profilu (np. kino)');
      const theme = select(['cyjan', 'bursztyn', 'zielony', 'fiolet', 'mono']);
      const motion = select(['full', 'low', 'off']);
      const perm = select(['zaufany', 'pytaj', 'podglad']);
      perm.value = 'zaufany';
      const dnd = field('cisza w minutach (0 = brak)');
      const routine = field('tryb do uruchomienia (opcjonalnie)');
      const note = field('wskazowka dla Jarvisa (opcjonalnie)');
      const save = el('button', 'btn primary', 'ZAPISZ PROFIL');
      save.type = 'submit';
      const grid = el('div', 'field');
      grid.style.cssText = 'flex-wrap:wrap;gap:6px';
      grid.append(name, theme, motion, perm, dnd, routine, note, save);
      form.appendChild(el('div', 'sub', 'NOWY / EDYCJA PROFILU (ta sama nazwa = nadpisanie)'));
      form.appendChild(grid);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/profiles', json('POST', { name: name.value, theme: theme.value, motion: motion.value, permissionMode: perm.value, dndMinutes: dnd.value, routine: routine.value, note: note.value }));
          name.value = '';
          draw();
        } catch (err) {
          toast(err.message);
        }
      });
      body.append(list, form);
      draw().catch(() => {});
    },
  };
  UI.register({ id: 'profiles', title: 'Profile', sub: 'praca / dom / noc', icon: '☰', owner: true, panels: { profiles: def } });
})();
