// Biblioteka projektow 3D (zapis lokalny, bo modele na serwerze wygasaja): wczytywanie,
// porownanie dwoch modeli obok siebie, notatki, koszt materialu i kalkulator druku, eksport STL
// z zapisanej siatki oraz opis modelu przez Jarvisa. Przycisk ZAPISZ pojawia sie w pasku podgladu.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.extend) return;
  const { el, toast, isOwner } = UI;
  const KEY = 'jarvis.cadlib';
  const MAX = 12;

  const load = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const save = (list) => {
    const round = (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
    try {
      localStorage.setItem(KEY, JSON.stringify(list, round));
      return true;
    } catch {
      return false; // przepelniony magazyn
    }
  };

  // Zapis do biblioteki: pomijamy pola ciezkie i zbedne (pole naprezen zostaje - kolorowanie).
  function slim(model) {
    return { ...model, mesh: model.mesh, field: model.field };
  }

  function addCurrent(model) {
    const name = (prompt('Nazwa projektu:', model.nazwa || `Projekt ${new Date().toLocaleDateString('pl-PL')}`) || '').trim();
    if (!name) return;
    const list = load().filter((x) => x.id !== model.id);
    list.unshift({ id: model.id || String(Date.now()), name: name.slice(0, 60), at: Date.now(), note: '', model: slim(model) });
    list.length = Math.min(list.length, MAX);
    while (!save(list) && list.length > 1) list.pop();
    toast(`Zapisano w bibliotece: ${name}`, 'ok');
    window.dispatchEvent(new Event('jarvis:cadlib'));
  }

  // Dodatkowe przyciski w pasku podgladu po kazdym zamontowaniu modelu.
  window.addEventListener('jarvis:cad-model', (e) => {
    const model = e.detail?.model;
    if (!model) return;
    setTimeout(() => {
      const bar = document.querySelector('#cadCanvas')?.parentElement?.querySelector('.cad-tools');
      if (!bar || bar.querySelector('.cad-save')) return;
      const mk = (label, fn, cls) => {
        const b = el('button', `cad-tool ${cls || ''}`, label);
        b.type = 'button';
        b.addEventListener('click', fn);
        bar.appendChild(b);
      };
      mk('ZAPISZ', () => addCurrent(model), 'cad-save');
      mk('OPOWIEDZ', () => {
        const s = model.strength;
        UI.sendTyped(`Opowiedz glosem, co widzisz w tym modelu 3D: wymiary ${model.sizeMm?.join(' x ')} mm, material ${model.params?.material || 'PLA'}, masa okolo ${model.massEstimateG} g${s ? `, wytrzymalosc: ${s.verdict}, zapas ${s.safety}x` : ''}. Krotko i konkretnie, z oceną, czy nadaje sie do druku.`);
      });
    }, 0);
  });

  // ---------- STL z zapisanej siatki (ASCII) ----------
  function toStl(model, name) {
    const lines = [`solid ${name.replace(/\s+/g, '_')}`];
    for (const t of model.mesh) {
      const u = [t.b[0] - t.a[0], t.b[1] - t.a[1], t.b[2] - t.a[2]];
      const v = [t.c[0] - t.a[0], t.c[1] - t.a[1], t.c[2] - t.a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      lines.push(`facet normal ${n.map((x) => (x / l).toFixed(5)).join(' ')}`, ' outer loop');
      [t.a, t.b, t.c].forEach((p) => lines.push(`  vertex ${p.map((x) => x.toFixed(4)).join(' ')}`));
      lines.push(' endloop', 'endfacet');
    }
    lines.push(`endsolid ${name.replace(/\s+/g, '_')}`);
    return lines.join('\n');
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'model/stl' }));
    a.download = `${name.replace(/[^\w-]+/g, '_')}.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  // ---------- kalkulator kosztu i druku ----------
  function calc(model, price, infill, flow) {
    const volCm3 = Number(model.volumeCm3) || 0;
    const solidMm3 = volCm3 * 1000;
    const used = solidMm3 * (0.25 + 0.75 * (infill / 100)); // skorupa + wypelnienie
    const density = (model.massEstimateG && volCm3 ? model.massEstimateG / volCm3 : 1.24);
    const grams = Math.round(used / 1000 * density * 10) / 10;
    const lengthM = Math.round(used / (Math.PI * 0.875 * 0.875) / 100) / 10; // fi 1.75 mm
    const sec = used / Math.max(1, flow);
    return {
      grams,
      lengthM,
      cost: Math.round((grams / 1000) * price * 100) / 100,
      time: `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`,
    };
  }

  // ---------- panel biblioteki ----------
  const lib = {
    title: 'BIBLIOTEKA PROJEKTOW 3D',
    glyph: '▣',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostepne tylko dla wlasciciela.';
        return;
      }
      body.innerHTML = '';
      const cmp = new Set();
      const calcBox = el('div', 'vout');
      const cmpBox = el('div');
      const list = el('div', 'w-list');
      body.append(el('div', 'sub', 'Zapisuj projekty przyciskiem ZAPISZ pod podgladem. Modele sa trzymane lokalnie na tym urzadzeniu.'), list, calcBox, cmpBox);

      function draw() {
        const items = load();
        list.innerHTML = '';
        if (!items.length) list.appendChild(el('div', 'w-empty', 'Biblioteka jest pusta - wygeneruj model i kliknij ZAPISZ.'));
        items.forEach((it) => {
          const row = el('div', 'w-row');
          row.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px';
          const ck = el('input');
          ck.type = 'checkbox';
          ck.title = 'Porownaj';
          ck.checked = cmp.has(it.id);
          ck.addEventListener('change', () => {
            if (ck.checked) cmp.add(it.id);
            else cmp.delete(it.id);
            drawCompare();
          });
          const info = el('div');
          info.style.flex = '1 1 180px';
          info.append(el('b', null, it.name), el('div', 'w-dim', `${(it.model.sizeMm || []).join(' x ')} mm · ${it.model.massEstimateG ?? '?'} g · ${new Date(it.at).toLocaleDateString('pl-PL')}`));
          const open = el('button', 'btn ghost', 'WCZYTAJ');
          open.addEventListener('click', () => {
            UI.openWindow('cad');
            setTimeout(() => {
              window.drawCadInfo?.(it.model);
              window.mountCadView?.(it.model);
            }, 250);
          });
          const stl = el('button', 'btn ghost', 'STL');
          stl.addEventListener('click', () => download(it.name, toStl(it.model, it.name)));
          const cal = el('button', 'btn ghost', 'KOSZT / DRUK');
          cal.addEventListener('click', () => drawCalc(it));
          const note = el('button', 'btn ghost', it.note ? 'NOTATKA ✎' : 'NOTATKA');
          note.addEventListener('click', () => {
            const t = prompt('Notatka do projektu:', it.note || '');
            if (t == null) return;
            const all = load();
            const x = all.find((y) => y.id === it.id);
            if (x) x.note = t.slice(0, 500);
            save(all);
            draw();
          });
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', () => {
            save(load().filter((y) => y.id !== it.id));
            cmp.delete(it.id);
            draw();
            drawCompare();
          });
          row.append(ck, info, open, stl, cal, note, del);
          list.appendChild(row);
          if (it.note) list.appendChild(el('div', 'w-dim', `✎ ${it.note}`));
        });
      }

      function drawCalc(it) {
        calcBox.innerHTML = '';
        const price = el('input', 'inp');
        price.type = 'number';
        price.value = localStorage.getItem('jarvis.cadPrice') || '90';
        price.style.width = '90px';
        const infill = el('input', 'inp');
        infill.type = 'number';
        infill.value = '20';
        infill.style.width = '70px';
        const flow = el('input', 'inp');
        flow.type = 'number';
        flow.value = '8';
        flow.style.width = '70px';
        const out = el('div');
        const run = () => {
          try {
            localStorage.setItem('jarvis.cadPrice', price.value);
          } catch {
            /* brak pamieci */
          }
          const c = calc(it.model, Number(price.value) || 0, Math.max(0, Math.min(100, Number(infill.value) || 0)), Number(flow.value) || 8);
          out.innerHTML = '';
          [['FILAMENT', `${c.grams} g (~${c.lengthM} m)`], ['KOSZT MATERIALU', `${c.cost} zl`], ['CZAS DRUKU (szac.)', c.time]].forEach(([k, v]) => {
            const r = el('div', 'kv');
            r.append(el('span', null, k), el('b', null, v));
            out.appendChild(r);
          });
        };
        const f = el('div', 'field');
        f.style.cssText = 'flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0';
        f.append(el('span', 'w-dim', `${it.name}: cena zl/kg`), price, el('span', 'w-dim', 'wypelnienie %'), infill, el('span', 'w-dim', 'przeplyw mm3/s'), flow);
        [price, infill, flow].forEach((x) => x.addEventListener('input', run));
        calcBox.append(f, out);
        run();
      }

      function drawCompare() {
        cmpBox.innerHTML = '';
        const picks = load().filter((x) => cmp.has(x.id)).slice(0, 2);
        if (picks.length < 2) return;
        cmpBox.appendChild(el('div', 'sub', 'PORÓWNANIE'));
        const grid = el('div');
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
        picks.forEach((it) => {
          const col = el('div');
          const cv = el('canvas');
          cv.style.cssText = 'width:100%;height:200px;border:1px solid var(--line);border-radius:3px;background:#040a12';
          col.append(el('b', null, it.name), cv);
          const m = it.model;
          [['WYMIARY', `${(m.sizeMm || []).join(' x ')} mm`], ['MASA', `${m.massEstimateG} g`], ['OBJETOSC', `${m.volumeCm3} cm3`], ['TROJKATOW', m.triangles], ['WYTRZYMALOSC', m.strength ? `${m.strength.verdict} (${m.strength.safety}x)` : '-']].forEach(([k, v]) => {
            const r = el('div', 'kv');
            r.append(el('span', null, k), el('b', null, String(v)));
            col.appendChild(r);
          });
          grid.appendChild(col);
          setTimeout(() => window.CADView?.(cv, m, { tools: false }).setStyle('holo'), 0);
        });
        cmpBox.appendChild(grid);
      }

      window.addEventListener('jarvis:cadlib', function h() {
        if (!document.body.contains(body)) return window.removeEventListener('jarvis:cadlib', h);
        draw();
      });
      draw();
    },
  };

  UI.extend('cad', { cadlib: lib });
})();
