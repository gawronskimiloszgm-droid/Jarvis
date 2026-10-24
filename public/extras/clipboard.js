// Historia schowka (aplikacja desktopowa): wlaczana swiadomie - w schowku bywaja
// hasla - trzymana tylko w pamieci aplikacji na tym komputerze, nigdy nie idzie na
// serwer sama z siebie. Z listy: skopiuj ponownie albo przepusc przez AI.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast } = UI;
  const D = () => window.jarvisDesktop;

  const OPS = [['streszcz', 'Streszcz'], ['popraw', 'Popraw'], ['tlumacz-en', 'EN'], ['tlumacz-pl', 'PL']];

  const def = {
    title: 'HISTORIA SCHOWKA',
    glyph: '⎘',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!D()) {
        body.appendChild(el('div', 'hint', 'Historia schowka dziala w aplikacji desktopowej.'));
        return;
      }
      const state = el('div', 'row-text');
      const bar = el('div', 'field');
      bar.style.margin = '8px 0';
      const list = el('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
      body.append(state, bar, list);

      async function draw() {
        const r = await D().runAction('schowek-historia');
        const on = Boolean(r?.wlaczona);
        state.textContent = on ? 'Zapisywanie historii WLACZONE (tylko na tym komputerze, do 50 wpisow, znika po zamknieciu aplikacji).' : 'Zapisywanie historii wylaczone.';
        bar.innerHTML = '';
        const tgl = el('button', on ? 'btn danger' : 'btn primary', on ? 'WYLACZ' : 'WLACZ HISTORIE');
        tgl.addEventListener('click', async () => {
          if (!on && !window.confirm('Wlaczyc zapamietywanie tego, co kopiujesz? W schowku moga byc hasla - historia zostaje tylko na tym komputerze.')) return;
          await D().setSetting('clipboardHistory', !on);
          draw();
        });
        const re = el('button', 'btn ghost', 'ODSWIEZ');
        re.addEventListener('click', draw);
        bar.append(tgl, re);
        list.innerHTML = '';
        const items = r?.wpisy || [];
        if (!items.length) list.appendChild(el('div', 'hint', on ? 'Skopiuj cos - pojawi sie tutaj.' : 'Brak wpisow.'));
        items.forEach((it) => {
          const row = el('div', 'clip');
          const pre = el('pre', null, it.text);
          const side = el('div');
          side.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:flex-end';
          side.appendChild(el('span', 'sub', new Date(it.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })));
          const copy = el('button', 'btn ghost', 'KOPIUJ');
          copy.addEventListener('click', async () => {
            await D().runAction('schowek-zapis', { tekst: it.text });
            toast('Skopiowano do schowka.', 'ok');
          });
          side.appendChild(copy);
          const ops = el('div', 'field');
          OPS.forEach(([op, label]) => {
            const b = el('button', 'btn ghost', label);
            b.addEventListener('click', async () => {
              try {
                const res = await api('/api/text/transform', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: it.text, operation: op }) });
                await D().runAction('schowek-zapis', { tekst: res.result });
                UI.pushSaid?.('jv', `${label} (w schowku):\n${res.result}`);
                toast('Wynik w schowku.', 'ok');
              } catch (e) {
                toast(e.message);
              }
            });
            ops.appendChild(b);
          });
          side.appendChild(ops);
          row.append(pre, side);
          list.appendChild(row);
        });
      }
      draw().catch((e) => toast(e.message));
    },
  };
  UI.register({ id: 'clipboard', title: 'Schowek', sub: 'historia i AI', icon: '⎘', owner: true, group: 'Komputer', panels: { clipboard: def } });
})();
