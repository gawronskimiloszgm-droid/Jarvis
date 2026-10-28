// Galeria zdarzen z kamer (zdjecia z historii wykryc) z podgladem po kliknieciu oraz statystyki
// skupienia Pomodoro (widzet na Pulpicie i panel w galerii) liczone z dziennika.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.life) return;
  const { el, api, isOwner, authHeaders } = UI;

  async function blobUrl(id) {
    const res = await fetch(`/api/cameras/events/${id}/image`, { headers: authHeaders() });
    if (!res.ok) throw new Error('brak zdjecia');
    return URL.createObjectURL(await res.blob());
  }

  const gallery = {
    title: 'GALERIA ZDARZEN',
    glyph: '▨',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostepne tylko dla wlasciciela.';
        return;
      }
      body.innerHTML = '';
      const only = el('label', 'kv');
      const ck = el('input');
      ck.type = 'checkbox';
      ck.checked = false;
      only.append(el('span', null, 'Tylko wazne zdarzenia'), ck);
      const grid = el('div', 'gal-grid');
      body.append(only, grid);
      const urls = [];
      async function draw() {
        urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
        grid.innerHTML = '';
        let ev = [];
        try {
          ev = (await api('/api/cameras/events')).events || [];
        } catch (e) {
          grid.appendChild(el('div', 'w-empty', e.message || 'Brak dostepu.'));
          return;
        }
        ev = ev.filter((e) => e.hasImage && (!ck.checked || e.notable));
        if (!ev.length) grid.appendChild(el('div', 'w-empty', 'Brak zdjec - kamery jeszcze nic nie zarejestrowaly.'));
        ev.forEach((e) => {
          const card = el('figure', `gal-card${e.notable ? ' notable' : ''}`);
          const img = el('img');
          img.alt = e.description;
          img.loading = 'lazy';
          blobUrl(e.id).then((u) => { urls.push(u); img.src = u; }).catch(() => (img.alt = 'brak zdjecia'));
          const cap = el('figcaption', null, `${e.camera} · ${new Date(e.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}`);
          card.append(img, cap, el('div', 'w-dim', e.description));
          card.addEventListener('click', () => {
            if (!img.src) return;
            const veil = el('div', 'gal-veil');
            const big = el('img');
            big.src = img.src;
            veil.appendChild(big);
            veil.addEventListener('click', () => veil.remove());
            document.body.appendChild(veil);
          });
          grid.appendChild(card);
        });
      }
      ck.addEventListener('change', draw);
      draw();
    },
  };

  // ---------- statystyki skupienia ----------
  async function focusData() {
    const j = await UI.life.list('journal', true).catch(() => []);
    const done = j.filter((e) => e.kind === 'focus');
    const perDay = {};
    done.forEach((e) => {
      const m = /(\d+)\s*min/.exec(e.text);
      const k = UI.dayKey(new Date(e.at));
      perDay[k] = (perDay[k] || 0) + (m ? Number(m[1]) : 25);
    });
    const days = Array.from({ length: 7 }, (_, i) => {
      const k = UI.addDays(UI.dayKey(new Date()), -(6 - i));
      return { k, min: perDay[k] || 0 };
    });
    return { days, total: done.length, week: days.reduce((a, d) => a + d.min, 0) };
  }
  function drawFocus(box, f) {
    box.innerHTML = '';
    const mx = Math.max(25, ...f.days.map((d) => d.min));
    const bars = el('div', 'focus-bars');
    f.days.forEach((d) => {
      const col = el('div', 'focus-col');
      const bar = el('i');
      bar.style.height = `${Math.max(3, (d.min / mx) * 60)}px`;
      bar.title = `${d.k}: ${d.min} min`;
      col.append(bar, el('span', null, ['nd', 'pn', 'wt', 'sr', 'cz', 'pt', 'sb'][new Date(d.k + 'T12:00:00').getDay()]));
      bars.appendChild(col);
    });
    box.append(bars, el('div', 'w-dim', `Tydzien: ${Math.floor(f.week / 60)} h ${f.week % 60} min · ukonczonych blokow: ${f.total}`));
  }
  const focus = {
    title: 'SKUPIENIE - STATYSTYKI',
    glyph: '◔',
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostepne tylko dla wlasciciela.';
        return;
      }
      focusData().then((f) => drawFocus(body, f));
    },
  };
  UI.register({ id: 'gallery', title: 'Galeria', sub: 'zdjecia z kamer i statystyki', icon: '▨', owner: true, group: 'Komputer', panels: { gallery, focus } });
  UI.addHomeWidget?.({ id: 'focus-stats', title: 'Skupienie (7 dni)', glyph: '◔', owner: true, every: 300000, events: ['jarvis:life'], render: async (box) => drawFocus(box, await focusData()) });
})();
