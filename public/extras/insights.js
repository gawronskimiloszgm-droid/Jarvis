// Komputer jako zrodlo danych: telemetria (CPU/RAM/dysk) wysylana na serwer,
// wykresy z progami i alarmami w module Maszyna oraz panel "Czas pracy"
// (kto zjada dzien: programy i godziny). Dziala w aplikacji desktopowej.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- zasilanie z tego komputera ----------
  let tick = 0;
  async function pushTelemetry() {
    if (!D() || !isOwner()) return;
    try {
      const r = await D().runAction('telemetria', { top: tick % 4 === 0 });
      tick++;
      if (r?.ok) {
        const { ok, ...reading } = r;
        await post('/api/telemetry', reading);
      }
    } catch {
      /* brak sieci albo zgody - nastepna proba za chwile */
    }
  }

  async function pushWorktime() {
    if (!D() || !isOwner()) return;
    try {
      const r = await D().runAction('czas-pracy', { dni: 14 });
      if (r?.ok && r.byDay) await post('/api/worktime', { byDay: r.byDay });
    } catch {
      /* j.w. */
    }
  }

  window.addEventListener('jarvis:ready', () => {
    if (!D() || !isOwner()) return;
    pushTelemetry();
    setInterval(pushTelemetry, 30000);
    setTimeout(pushWorktime, 20000);
    setInterval(pushWorktime, 30 * 60 * 1000);
  });

  // ---------- wykresy ----------
  function spark(samples, key, warn, color) {
    const c = el('canvas');
    c.width = 560;
    c.height = 70;
    c.style.cssText = 'width:100%;height:70px;display:block';
    const g = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, 0, c.width, c.height);
    // linia progu
    const y = (v) => c.height - 4 - (Math.max(0, Math.min(100, v)) / 100) * (c.height - 8);
    g.setLineDash([4, 4]);
    g.strokeStyle = css.getPropertyValue('--amber').trim() || '#ffb648';
    g.beginPath();
    g.moveTo(0, y(warn));
    g.lineTo(c.width, y(warn));
    g.stroke();
    g.setLineDash([]);
    const pts = samples.filter((s) => s[key] != null);
    if (pts.length > 1) {
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      pts.forEach((s, i) => {
        const x = (i / (pts.length - 1)) * c.width;
        if (i) g.lineTo(x, y(s[key]));
        else g.moveTo(x, y(s[key]));
      });
      g.stroke();
    }
    return c;
  }

  const KEY_LABEL = { cpu: 'PROCESOR', ram: 'PAMIEC', disk: 'DYSK' };

  const chartsDef = {
    title: 'WYKRESY I ALARMY',
    glyph: '≈',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const box = el('div');
      body.appendChild(box);
      async function draw() {
        if (!isOwner()) return;
        try {
          const d = await api('/api/telemetry/history');
          box.innerHTML = '';
          if (!d.machines.length) {
            box.appendChild(el('div', 'hint', 'Brak odczytow. W aplikacji desktopowej dane wysylaja sie same co 30 s.'));
            return;
          }
          d.machines.forEach((m) => {
            box.appendChild(el('div', 'sub', `${m.machine}${m.online ? '' : ' (offline)'} - ${m.samples.length} odczytow`));
            ['cpu', 'ram', 'disk'].forEach((k) => {
              const last = m.samples.at(-1)?.[k];
              const row = el('div', 'kv');
              row.append(el('span', null, KEY_LABEL[k]), el('b', null, last == null ? '-' : `${last}% (prog ${d.thresholds[k]}%)`));
              box.append(row, spark(m.samples.map((s) => ({ ...s })), k, d.thresholds[k], '#4fd8ff'));
            });
          });
          const al = el('div', 'sub', 'OSTATNIE ALARMY');
          al.style.marginTop = '10px';
          box.appendChild(al);
          if (!d.alerts.length) box.appendChild(el('div', 'hint', 'Cisza - progi nie byly przekroczone.'));
          d.alerts.slice(0, 12).forEach((a) => {
            const r = el('div', 'row-text', `${new Date(a.at).toLocaleString('pl-PL')} · ${a.key} · ${a.kind === 'trip' ? 'PRZEKROCZONO' : 'wrocilo do normy'}`);
            box.appendChild(r);
          });
        } catch {
          /* brak uprawnien albo sieci */
        }
      }
      draw();
      const t = setInterval(() => (document.body.contains(body) ? draw() : clearInterval(t)), 15000);
    },
  };
  UI.extend('machine', { machinecharts: chartsDef });

  // ---------- czas pracy ----------
  function human(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  const workDef = {
    title: 'CZAS PRACY',
    glyph: '◷',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!D()) {
        body.appendChild(el('div', 'hint', 'Czas pracy mierzy aplikacja desktopowa (zapisuje tylko nazwy programow i sekundy, bez tytulow okien).'));
        return;
      }
      const status = el('div', 'row-text');
      const range = el('div', 'field');
      const out = el('div');
      out.style.marginTop = '10px';

      async function draw(days) {
        out.innerHTML = '';
        const r = await D().runAction('czas-pracy', { dni: days });
        status.textContent = r.wlaczony ? 'Pomiar wlaczony (tylko nazwy programow, bez tytulow okien).' : 'Pomiar wylaczony.';
        if (!r.totalSec) {
          out.appendChild(el('div', 'hint', 'Jeszcze brak danych - pomiar zbiera probki co 20 s, gdy cos robisz.'));
          return;
        }
        out.appendChild(el('div', 'row-text', `Razem (${r.days} dni): ${human(r.totalSec)} · dzis: ${human(r.dzis.totalSec)}`));
        const max = r.top[0]?.sec || 1;
        r.top.forEach((a) => {
          const row = el('div', 'kv');
          row.append(el('span', null, a.name), el('b', null, human(a.sec)));
          const bar = el('div');
          bar.style.cssText = `height:4px;margin:2px 0 6px;background:var(--cyan,#4fd8ff);width:${Math.round((100 * a.sec) / max)}%;opacity:.7`;
          out.append(row, bar);
        });
        out.appendChild(el('div', 'sub', 'PER DZIEN'));
        Object.entries(r.perDay).forEach(([d, s]) => out.appendChild(el('div', 'row-text', `${d}: ${human(s)}`)));
      }

      [[1, 'DZIS'], [7, '7 DNI'], [30, '30 DNI']].forEach(([n, l]) => {
        const b = el('button', 'btn ghost', l);
        b.addEventListener('click', () => draw(n));
        range.appendChild(b);
      });
      const toggle = el('button', 'btn', 'WL/WYL POMIAR');
      toggle.addEventListener('click', async () => {
        const cur = await D().runAction('czas-pracy', { dni: 1 });
        await D().runAction('czas-pracy-ustaw', { wlaczony: !cur.wlaczony });
        draw(7);
      });
      const wipe = el('button', 'btn danger', 'WYCZYSC DANE');
      wipe.addEventListener('click', async () => {
        if (!window.confirm('Usunac cala zapisana historie czasu pracy z tego komputera?')) return;
        const cur = await D().runAction('czas-pracy', { dni: 1 });
        await D().runAction('czas-pracy-ustaw', { wlaczony: cur.wlaczony, wyczysc: true });
        toast('Wyczyszczono.', 'ok');
        draw(7);
      });
      range.append(toggle, wipe);
      body.append(status, range, out);
      draw(7);
    },
  };
  UI.register({ id: 'worktime', title: 'Czas pracy', sub: 'programy i godziny', icon: '◷', owner: true, panels: { worktime: workDef } });
})();
