// Makra: "nagraj to, co robie" -> tryb. Podczas nagrywania zapisujemy kazda
// udana akcje urzadzenia (z parametrami); po zatrzymaniu nadajesz nazwe i od
// tej pory dziala "Jarvis, <nazwa>" (glos i czat). Wartosc {{arg}} w tekscie
// kroku zastepuje argument podany przy uruchomieniu.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;

  const rec = { on: false, steps: [] };
  let redraw = () => {};

  // Akcje, ktorych nie ma sensu nagrywac (odczyty, same pytania do AI).
  const SKIP = new Set(['analizuj-ekran', 'wczytaj-plik-pc', 'szukaj-plikow', 'nie-przeszkadzac', 'schowek-ai']);

  window.addEventListener('jarvis:action-result', (e) => {
    if (!rec.on) return;
    const { name, params } = e.detail || {};
    if (!name || SKIP.has(name)) return;
    rec.steps.push(params && Object.keys(params).length ? { akcja: name, params } : { akcja: name });
    redraw();
  });

  async function save(name) {
    const r = await api('/api/macros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nazwa: name, kroki: rec.steps }),
    });
    toast(`Zapisano tryb "${r.nazwa}" (${r.kroki} krokow).`, 'ok');
  }

  UI.macros = rec;

  const macrosDef = {
    title: 'NAGRYWANIE MAKR',
    glyph: '●',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) {
        body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
        return;
      }
      body.appendChild(
        el('div', 'sub', 'Wlacz nagrywanie, wykonaj akcje (rozmowa, polecenia, panele), zatrzymaj i nazwij. Potem wystarczy powiedziec nazwe. {{arg}} w tekscie kroku = argument przy uruchomieniu.')
      );
      const status = el('div', 'row-text');
      status.style.margin = '8px 0';
      const list = el('div');
      const bar = el('div', 'field');
      const name = el('input', 'inp');
      name.placeholder = 'nazwa trybu';
      const start = el('button', 'btn primary', 'START');
      const stop = el('button', 'btn', 'ZAPISZ');
      const drop = el('button', 'btn ghost', 'ODRZUC');
      bar.append(name, start, stop, drop);

      redraw = () => {
        status.textContent = rec.on ? `NAGRYWAM - ${rec.steps.length} krokow` : 'Nagrywanie wylaczone';
        start.disabled = rec.on;
        list.innerHTML = '';
        rec.steps.forEach((s, i) => {
          const row = el('div', 'row');
          const t = el('div', 'row-text', `${i + 1}. ${s.akcja}${s.params ? ' ' + JSON.stringify(s.params) : ''}`);
          t.style.flex = '1';
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', () => {
            rec.steps.splice(i, 1);
            redraw();
          });
          row.append(t, x);
          list.appendChild(row);
        });
      };

      start.addEventListener('click', () => {
        rec.on = true;
        rec.steps = [];
        redraw();
      });
      drop.addEventListener('click', () => {
        rec.on = false;
        rec.steps = [];
        redraw();
      });
      stop.addEventListener('click', async () => {
        if (!rec.steps.length) return toast('Nic nie nagrano.');
        if (!name.value.trim()) return toast('Podaj nazwe trybu.');
        try {
          await save(name.value.trim());
          rec.on = false;
          rec.steps = [];
          name.value = '';
          redraw();
          loadSaved();
        } catch (e) {
          toast(e.message);
        }
      });

      const saved = el('div');
      saved.style.marginTop = '12px';
      async function loadSaved() {
        saved.innerHTML = '';
        saved.appendChild(el('div', 'sub', 'ZAPISANE TRYBY'));
        const routines = await api('/api/routines').catch(() => []);
        routines.forEach((r) => {
          const row = el('div', 'row');
          const t = el('div', 'row-text', `${r.name} (${r.steps.length})`);
          t.style.flex = '1';
          const run = el('button', 'btn ghost', '▶');
          run.addEventListener('click', () => UI.runRoutine(r.steps));
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', async () => {
            await api(`/api/macros/${encodeURIComponent(r.name)}`, { method: 'DELETE' });
            loadSaved();
          });
          row.append(t, run, del);
          saved.appendChild(row);
        });
        if (!routines.length) saved.appendChild(el('div', 'hint', 'Brak zapisanych trybow.'));
      }

      body.append(status, bar, list, saved);
      redraw();
      loadSaved();
    },
  };
  UI.register({ id: 'macros', title: 'Makra', sub: 'nagrywanie trybow', icon: '●', owner: true, panels: { macros: macrosDef } });
})();
