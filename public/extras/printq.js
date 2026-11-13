// Warsztat: drukarka na zywo (stan, postep, kamera), kolejka wydrukow i swiatlo warsztatu
// przez Home Assistant, ktore zapala sie z trybem warsztatu.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.extend) return;
  const { el, api, toast, isOwner } = UI;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const row = (...kids) => {
    const r = el('div', 'field');
    r.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0;align-items:center';
    r.append(...kids);
    return r;
  };
  const button = (label, fn, cls = 'btn') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      try {
        await fn();
      } catch (e) {
        toast(e.message);
      }
    });
    return b;
  };
  const STATE_PL = { printing: 'drukuje', paused: 'pauza', idle: 'gotowa, bezczynna', finished: 'zakończyła druk', error: 'błąd', offline: 'nie odpowiada' };
  const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

  // ---------- swiatlo warsztatu (Home Assistant) ----------
  const LIGHT_KEY = 'jarvis.warsztat.light';
  const light = () => localStorage.getItem(LIGHT_KEY) || '';
  UI.workshopLight = async (on) => {
    const name = light();
    if (!name || !UI.dom?.command) return;
    try {
      await UI.dom.command(`${on ? 'włącz' : 'wyłącz'} ${name}`);
    } catch (e) {
      toast(`Światło warsztatu: ${e.message}`);
    }
  };

  // Kolejka do dodawania z innych modulow (Studio).
  UI.printQueue = {
    add: async (items) => {
      const r = await api('/api/printq', json('POST', { items }));
      toast(`W kolejce wydruków: ${r.summary.count} (ok. ${hm(r.summary.minutes)})`, 'ok');
      window.dispatchEvent(new Event('jarvis:printq'));
      return r;
    },
  };

  const panel = {
    title: 'DRUKARKA I KOLEJKA WYDRUKÓW',
    glyph: '🖨',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) return body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
      const status = el('div');
      const cam = el('img');
      cam.style.cssText = 'max-width:100%;max-height:260px;border:1px solid rgba(51,224,255,.3);display:none;margin:6px 0';
      cam.alt = 'Kamera drukarki';
      const list = el('div');
      const sum = el('div', 'w-mid');
      const name = el('input', 'inp');
      name.placeholder = 'co wydrukować, np. uchwyt na latarkę';
      name.style.flex = '1 1 240px';
      const minutes = el('input', 'inp');
      minutes.placeholder = 'min';
      minutes.type = 'number';
      minutes.style.flex = '0 1 70px';
      const add = button('DO KOLEJKI', async () => {
        if (!name.value.trim()) return;
        await UI.printQueue.add([{ name: name.value, minutes: Number(minutes.value) || 0 }]);
        name.value = minutes.value = '';
      }, 'btn primary');
      const lightIn = el('input', 'inp');
      lightIn.placeholder = 'nazwa światła w Home Assistant, np. warsztat';
      lightIn.style.flex = '1 1 240px';
      lightIn.value = light();
      lightIn.addEventListener('change', () => localStorage.setItem(LIGHT_KEY, lightIn.value.trim()));
      body.append(
        el('div', 'sub', 'Drukarka (OctoPrint albo Klipper/Moonraker: PRINTER_URL na serwerze):'), status, cam,
        el('div', 'sub', 'Kolejka:'), sum, row(name, minutes, add), list,
        row(button('USUŃ GOTOWE', async () => {
          await api('/api/printq/clear-done', json('POST', {}));
          load();
        }, 'btn ghost')),
        el('div', 'sub', 'Światło warsztatu: zapala się z trybem warsztatu i gaśnie po ostatnim kroku.'), row(lightIn, button('TEST', () => UI.workshopLight(true), 'btn ghost')),
      );

      let camTimer = null;
      async function loadStatus() {
        const s = await api('/api/printer/status').catch(() => null);
        status.innerHTML = '';
        if (!s?.configured) {
          status.appendChild(el('div', 'hint', 'Drukarka niepodłączona. Kolejka działa i bez niej.'));
          return;
        }
        const j = s.job || { state: 'offline' };
        status.appendChild(el('div', 'w-mid', `${s.type === 'moonraker' ? 'Klipper' : 'OctoPrint'}: ${STATE_PL[j.state] || j.state}${j.fileName ? ` · ${j.fileName}` : ''}${j.progressPct != null && j.state === 'printing' ? ` · ${j.progressPct}%` : ''}${j.printTimeLeftSec ? ` · zostało ok. ${hm(Math.round(j.printTimeLeftSec / 60))}` : ''}`));
        if (!camTimer) {
          const refresh = async () => {
            if (!document.body.contains(body)) return clearInterval(camTimer);
            try {
              const r = await fetch('/api/printer/snapshot', { headers: { Authorization: `Bearer ${localStorage.getItem('jarvis.token') || ''}` } });
              if (!r.ok) throw new Error();
              const old = cam.src;
              cam.src = URL.createObjectURL(await r.blob());
              cam.style.display = 'block';
              if (old) URL.revokeObjectURL(old);
            } catch {
              cam.style.display = 'none';
            }
          };
          refresh();
          camTimer = setInterval(refresh, 10000);
        }
      }
      async function load() {
        const r = await api('/api/printq');
        sum.textContent = r.summary.count ? `${r.summary.count} do wydruku · ok. ${hm(r.summary.minutes)} · ${r.summary.grams} g materiału` : 'Kolejka pusta.';
        list.innerHTML = '';
        for (const it of [...r.items].reverse()) {
          const line = el('div', 'row-text');
          line.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:3px 0';
          const sel = el('select', 'inp');
          for (const st of ['czeka', 'drukuje', 'gotowe', 'nieudane']) {
            const o = el('option', null, st);
            o.value = st;
            sel.appendChild(o);
          }
          sel.value = it.status;
          sel.addEventListener('change', async () => {
            await api(`/api/printq/${it.id}`, json('PATCH', { status: sel.value }));
            load();
          });
          const del = button('×', async () => {
            await api(`/api/printq/${it.id}`, { method: 'DELETE' });
            load();
          }, 'row-x');
          line.append(sel, el('span', it.status === 'gotowe' ? 'w-dim' : 'w-mid', `${it.copies > 1 ? `${it.copies}× ` : ''}${it.name}`), el('span', 'w-dim', [it.material, it.minutes ? hm(it.minutes) : '', it.grams ? `${it.grams} g` : '', it.project].filter(Boolean).join(' · ')), del);
          list.appendChild(line);
        }
      }
      load().catch((e) => (sum.textContent = e.message));
      loadStatus();
      const h = () => {
        if (!document.body.contains(body)) return window.removeEventListener('jarvis:printq', h);
        load().catch(() => {});
      };
      window.addEventListener('jarvis:printq', h);
    },
  };

  UI.extend('warsztat', { printq: panel });
})();
