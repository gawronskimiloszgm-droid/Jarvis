// Moduly "zycia": Dziennik, Zakupy, Nawyki, Cele i daty, Tablica (kanban), Zakladki,
// Fiszki, Szybkie notatki i przypomnienia cykliczne. Wszystko na jednym API /api/life.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- wspolny klient API ----------
  const cache = {};
  const Life = {
    async list(coll, force) {
      if (!force && cache[coll] && Date.now() - cache[coll].at < 4000) return cache[coll].items;
      const r = await api(`/api/life/${coll}`);
      cache[coll] = { at: Date.now(), items: r.items };
      return r.items;
    },
    async add(coll, body) {
      const r = await api(`/api/life/${coll}`, json('POST', body));
      delete cache[coll];
      window.dispatchEvent(new CustomEvent('jarvis:life', { detail: { coll } }));
      return r.items;
    },
    async patch(coll, id, body) {
      const r = await api(`/api/life/${coll}/${id}`, json('PATCH', body));
      delete cache[coll];
      window.dispatchEvent(new CustomEvent('jarvis:life', { detail: { coll } }));
      return r.item;
    },
    async del(coll, id) {
      await api(`/api/life/${coll}/${id}`, { method: 'DELETE' });
      delete cache[coll];
      window.dispatchEvent(new CustomEvent('jarvis:life', { detail: { coll } }));
    },
    async clear(coll, onlyDone) {
      await api(`/api/life/${coll}/clear`, json('POST', { onlyDone }));
      delete cache[coll];
      window.dispatchEvent(new CustomEvent('jarvis:life', { detail: { coll } }));
    },
    async daily(day) {
      return api(`/api/life/daily/${day || today()}`);
    },
    async setDaily(body, day) {
      const r = await api(`/api/life/daily/${day || today()}`, json('PUT', body));
      window.dispatchEvent(new CustomEvent('jarvis:life', { detail: { coll: 'daily' } }));
      return r;
    },
  };
  UI.life = Life;

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayKey(new Date());
  const addDays = (key, n) => {
    const d = new Date(key + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return dayKey(d);
  };
  const PL_DAY = ['nd', 'pn', 'wt', 'sr', 'cz', 'pt', 'sb'];
  const PL_MONTH = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'wrzesnia', 'pazdziernika', 'listopada', 'grudnia'];
  const hm = (ts) => new Date(ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  UI.dayKey = dayKey;
  UI.addDays = addDays;

  UI.logLife = (kind, text, tag) => Life.add('journal', { kind, text, tag }).catch(() => {});

  // Wspolne klocki UI.
  function guard(body) {
    if (isOwner()) return false;
    body.innerHTML = '';
    body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
    return true;
  }
  function addForm(placeholder, onSubmit, btn = 'DODAJ', extra) {
    const f = el('form', 'field');
    f.style.cssText = 'margin:8px 0;flex-wrap:wrap;gap:6px';
    const inp = el('input', 'inp');
    inp.placeholder = placeholder;
    inp.style.flex = '1 1 180px';
    const go = el('button', 'btn primary', btn);
    go.type = 'submit';
    f.append(inp);
    const extras = extra ? extra(f) : {};
    f.append(go);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      try {
        await onSubmit(v, extras);
        inp.value = '';
      } catch (err) {
        toast(err.message);
      }
    });
    return f;
  }
  function redrawOn(colls, fn, body) {
    const h = (e) => {
      if (!document.body.contains(body)) return window.removeEventListener('jarvis:life', h);
      if (!e.detail || colls.includes(e.detail.coll)) fn();
    };
    window.addEventListener('jarvis:life', h);
  }
  function mod(id, title, sub, icon, group, panels) {
    UI.register({ id, title, sub, icon, owner: true, group, panels });
  }

  // ================= DZIENNIK =================
  const KIND = { manual: ['✎', 'wpis'], auto: ['•', 'system'], music: ['♫', 'muzyka'], action: ['⌘', 'komputer'], alert: ['⚠', 'alarm'], note: ['♪', 'notatka'], focus: ['◷', 'skupienie'] };
  const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
  const journal = {
    title: 'DZIENNIK DNIA',
    glyph: '☰',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      let day = today();
      let filter = '';
      const top = el('div', 'field');
      top.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:center';
      const prev = el('button', 'btn ghost', '←');
      const next = el('button', 'btn ghost', '→');
      const label = el('b');
      const todayBtn = el('button', 'btn ghost', 'DZIS');
      top.append(prev, label, next, todayBtn);
      const stats = el('div', 'w-row');
      stats.style.margin = '10px 0';
      const form = addForm('Co sie dzieje? (Enter = zapisz do dziennika)', (v) => Life.add('journal', { text: v, kind: 'manual' }));
      const filters = el('div', 'field');
      filters.style.cssText = 'flex-wrap:wrap;gap:4px;margin:6px 0';
      const sum = el('div', 'vout');
      const sumBtn = el('button', 'btn ghost', '✦ PODSUMUJ DZIEN (AI)');
      const list = el('div', 'w-list');
      list.style.marginTop = '8px';
      body.append(top, stats, form, filters, sumBtn, sum, list);

      [['', 'Wszystko'], ['manual', 'Wpisy'], ['music', 'Muzyka'], ['action', 'Komputer'], ['alert', 'Alarmy'], ['note', 'Notatki'], ['focus', 'Skupienie']].forEach(([k, l]) => {
        const b = el('button', 'btn ghost', l);
        b.addEventListener('click', () => {
          filter = k;
          draw();
        });
        filters.appendChild(b);
      });

      async function draw() {
        const d = new Date(day + 'T12:00:00');
        label.textContent = `${PL_DAY[d.getDay()]}, ${d.getDate()} ${PL_MONTH[d.getMonth()]}${day === today() ? ' (dzis)' : ''}`;
        const [items, rec] = await Promise.all([Life.list('journal', true).catch(() => []), Life.daily(day).catch(() => ({ water: 0, mood: 0 }))]);
        stats.innerHTML = '';
        const mood = el('div', 'w-row');
        MOODS.forEach((m, i) => {
          const b = el('button', rec.mood === i + 1 ? 'btn primary' : 'btn ghost', m);
          b.title = `Nastroj ${i + 1}/5`;
          b.addEventListener('click', async () => {
            await Life.setDaily({ mood: i + 1 }, day);
            draw();
          });
          mood.appendChild(b);
        });
        const water = el('div', 'w-row');
        water.append(el('span', 'w-dim', `Woda: ${rec.water} szklanek`));
        [['−', -1], ['+', 1]].forEach(([l, dlt]) => {
          const b = el('button', 'btn ghost', l);
          b.addEventListener('click', async () => {
            await Life.setDaily({ waterDelta: dlt }, day);
            draw();
          });
          water.appendChild(b);
        });
        stats.append(el('span', 'w-dim', 'Nastroj:'), mood, water);
        list.innerHTML = '';
        const rows = items.filter((e) => UI.dayKey(new Date(e.at)) === day && (!filter || e.kind === filter));
        if (!rows.length) list.appendChild(el('div', 'w-empty', 'Brak wpisow tego dnia.'));
        rows.forEach((e) => {
          const [ico, name] = KIND[e.kind] || KIND.auto;
          const it = el('div', 'it');
          const left = el('span', null, `${ico} ${e.text}`);
          left.title = name;
          const right = el('span', null, hm(e.at));
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', async () => {
            await Life.del('journal', e.id);
            draw();
          });
          right.appendChild(del);
          it.append(left, right);
          list.appendChild(it);
        });
      }
      prev.addEventListener('click', () => {
        day = addDays(day, -1);
        sum.textContent = '';
        draw();
      });
      next.addEventListener('click', () => {
        day = addDays(day, 1);
        sum.textContent = '';
        draw();
      });
      todayBtn.addEventListener('click', () => {
        day = today();
        draw();
      });
      sumBtn.addEventListener('click', async () => {
        sum.textContent = 'Podsumowuje...';
        try {
          sum.textContent = (await api('/api/life/summary', json('POST', { day }))).text;
        } catch (e) {
          sum.textContent = e.message;
        }
      });
      redrawOn(['journal', 'daily'], draw, body);
      draw();
    },
  };
  const gratitude = {
    title: 'WDZIECZNOSC I REFLEKSJE',
    glyph: '♡',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'Jedna rzecz, za ktora jestes dzis wdzieczny - kilka sekund dziennie robi roznice.'));
      const list = el('div', 'w-list');
      const draw = async () => {
        const items = (await Life.list('gratitude', true).catch(() => [])).slice().reverse();
        list.innerHTML = '';
        if (!items.length) list.appendChild(el('div', 'w-empty', 'Pusto.'));
        items.slice(0, 30).forEach((g) => {
          const it = el('div', 'it');
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', async () => {
            await Life.del('gratitude', g.id);
            draw();
          });
          const t = el('span', null, g.text);
          const r = el('span', null, new Date(g.at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }));
          r.appendChild(del);
          it.append(t, r);
          list.appendChild(it);
        });
      };
      body.append(addForm('Dzisiaj dziekuje za...', async (v) => {
        await Life.add('gratitude', { text: v });
        Life.add('journal', { text: `Wdziecznosc: ${v}`, kind: 'manual', tag: 'wdziecznosc' }).catch(() => {});
        draw();
      }), list);
      draw();
    },
  };
  mod('journal', 'Dziennik', 'os czasu dnia', '☰', 'Wiedza', { journal, gratitude });

  // ================= ZAKUPY =================
  const shopping = {
    title: 'LISTA ZAKUPOW',
    glyph: '🛒',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const list = el('div');
      const bar = el('div', 'field');
      bar.style.cssText = 'gap:6px;flex-wrap:wrap;margin-top:8px';
      const clr = el('button', 'btn ghost', 'WYCZYSC KUPIONE');
      const copy = el('button', 'btn ghost', 'KOPIUJ LISTE');
      bar.append(clr, copy);
      const catSel = (f) => {
        const s = el('select', 'inp');
        ['inne', 'nabial', 'pieczywo', 'warzywa', 'owoce', 'mieso', 'napoje', 'chemia', 'dom'].forEach((c) => {
          const o = el('option', null, c);
          o.value = c;
          s.appendChild(o);
        });
        f.appendChild(s);
        return s;
      };
      body.append(
        addForm('Dodaj (kilka naraz po przecinku: mleko, chleb, jajka)', async (v, x) => {
          await Life.add('shopping', { items: v.split(/[,;\n]/).map((t) => ({ text: t.trim(), cat: x.cat.value })).filter((i) => i.text) });
        }, 'DODAJ', (f) => ({ cat: catSel(f) })),
        list,
        bar
      );
      async function draw() {
        const items = await Life.list('shopping', true).catch(() => []);
        list.innerHTML = '';
        if (!items.length) list.appendChild(el('div', 'w-empty', 'Lista pusta. Powiedz: "dodaj do zakupow mleko i chleb".'));
        const cats = [...new Set(items.map((i) => i.cat))].sort();
        cats.forEach((c) => {
          list.appendChild(el('div', 'sub', c));
          items.filter((i) => i.cat === c).forEach((i) => {
            const row = el('div', 'row');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = i.done;
            cb.addEventListener('change', async () => {
              await Life.patch('shopping', i.id, { done: cb.checked });
              draw();
            });
            const t = el('div', 'row-text', i.text);
            t.style.flex = '1';
            if (i.done) t.style.textDecoration = 'line-through';
            const x = el('button', 'row-x', '×');
            x.addEventListener('click', async () => {
              await Life.del('shopping', i.id);
              draw();
            });
            row.append(cb, t, x);
            list.appendChild(row);
          });
        });
      }
      clr.addEventListener('click', async () => {
        await Life.clear('shopping', true);
        draw();
      });
      copy.addEventListener('click', async () => {
        const items = (await Life.list('shopping', true)).filter((i) => !i.done);
        const text = items.map((i) => `- ${i.text}`).join('\n');
        try {
          await navigator.clipboard.writeText(text);
          toast('Lista skopiowana.', 'ok');
        } catch {
          toast(text);
        }
      });
      redrawOn(['shopping'], draw, body);
      draw();
    },
  };
  mod('shop', 'Zakupy', 'lista i kategorie', '🛒', 'Dom', { shopping });

  // ================= NAWYKI =================
  function streak(days) {
    const set = new Set(days);
    let n = 0;
    let k = today();
    if (!set.has(k)) k = addDays(k, -1); // dzis jeszcze moze byc przed Toba
    while (set.has(k)) {
      n++;
      k = addDays(k, -1);
    }
    return n;
  }
  function bestStreak(days) {
    const s = [...new Set(days)].sort();
    let best = 0;
    let cur = 0;
    let prev = null;
    for (const d of s) {
      cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
      best = Math.max(best, cur);
      prev = d;
    }
    return best;
  }
  UI.habitStreak = streak;

  async function toggleHabit(h, day) {
    const has = h.days.includes(day);
    const days = has ? h.days.filter((d) => d !== day) : [...h.days, day];
    await Life.patch('habits', h.id, { days });
    if (!has && day === today()) UI.logLife('auto', `Nawyk: ${h.name} (seria ${streak(days)})`, 'nawyki');
  }
  UI.toggleHabit = toggleHabit;

  const habits = {
    title: 'NAWYKI',
    glyph: '⟳',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const list = el('div');
      const heat = el('div', 'heat');
      body.append(
        addForm('Nowy nawyk (np. Spacer, Czytanie, Trening)', async (v, x) => {
          await Life.add('habits', { name: v, icon: x.icon.value || '●', goal: 7 });
        }, 'DODAJ', (f) => {
          const i = el('input', 'inp');
          i.placeholder = '●';
          i.style.maxWidth = '60px';
          f.insertBefore(i, f.firstChild);
          return { icon: i };
        }),
        list,
        el('div', 'sub', 'AKTYWNOSC (12 TYGODNI, WSZYSTKIE NAWYKI)'),
        heat
      );
      async function draw() {
        const items = await Life.list('habits', true).catch(() => []);
        list.innerHTML = '';
        if (!items.length) list.appendChild(el('div', 'w-empty', 'Dodaj pierwszy nawyk.'));
        const t = today();
        items.forEach((h) => {
          const row = el('div', 'row');
          row.style.flexWrap = 'wrap';
          const done = h.days.includes(t);
          const b = el('button', done ? 'btn primary' : 'btn ghost', done ? '✓' : '○');
          b.addEventListener('click', async () => {
            await toggleHabit(h, t);
            draw();
          });
          const name = el('div', 'row-text', `${h.icon} ${h.name}`);
          name.style.flex = '1';
          const s = streak(h.days);
          const info = el('span', 'w-dim', `seria ${s} · rekord ${bestStreak(h.days)} · razem ${h.days.length}`);
          const dots = el('div', 'dots');
          for (let i = 6; i >= 0; i--) {
            const k = addDays(t, -i);
            const dot = el('i', h.days.includes(k) ? 'on' : '');
            dot.title = k;
            dot.addEventListener('click', async () => {
              await toggleHabit(h, k);
              draw();
            });
            dots.appendChild(dot);
          }
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', async () => {
            if (window.confirm(`Usunac nawyk "${h.name}"?`)) {
              await Life.del('habits', h.id);
              draw();
            }
          });
          row.append(b, name, info, dots, x);
          list.appendChild(row);
        });
        // mapa ciepla
        heat.innerHTML = '';
        const counts = {};
        items.forEach((h) => h.days.forEach((d) => (counts[d] = (counts[d] || 0) + 1)));
        const max = Math.max(1, ...Object.values(counts), items.length);
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 7 * 12 + 1 - ((start.getDay() + 6) % 7));
        for (let w = 0; w < 12; w++) {
          const col = el('div', 'heat-col');
          for (let d = 0; d < 7; d++) {
            const dt = new Date(start);
            dt.setDate(start.getDate() + w * 7 + d);
            const k = dayKey(dt);
            const c = counts[k] || 0;
            const cell = el('i');
            cell.style.opacity = dt > end ? '0' : String(0.12 + (0.88 * c) / max);
            cell.title = `${k}: ${c}`;
            col.appendChild(cell);
          }
          heat.appendChild(col);
        }
      }
      redrawOn(['habits'], draw, body);
      draw();
    },
  };
  mod('habits', 'Nawyki', 'serie i statystyki', '⟳', 'Dom', { habits });

  // ================= CELE I DATY =================
  const goals = {
    title: 'CELE',
    glyph: '◎',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const list = el('div');
      body.append(
        addForm('Nowy cel (np. Przebiec 100 km)', async (v, x) => {
          await Life.add('goals', { text: v, target: Number(x.target.value) || 100, unit: x.unit.value || '%', due: x.due.value });
        }, 'DODAJ', (f) => {
          const t = el('input', 'inp');
          t.type = 'number';
          t.placeholder = 'cel';
          t.style.maxWidth = '80px';
          const u = el('input', 'inp');
          u.placeholder = 'jednostka';
          u.style.maxWidth = '90px';
          const d = el('input', 'inp');
          d.type = 'date';
          f.append(t, u, d);
          return { target: t, unit: u, due: d };
        }),
        list
      );
      async function draw() {
        const items = await Life.list('goals', true).catch(() => []);
        list.innerHTML = '';
        if (!items.length) list.appendChild(el('div', 'w-empty', 'Brak celow.'));
        items.forEach((g) => {
          const card = el('div', 'w');
          card.style.minHeight = '0';
          const pct = Math.min(100, Math.round((100 * g.progress) / g.target));
          const days = g.due ? Math.ceil((new Date(g.due + 'T12:00:00') - new Date()) / 86400000) : null;
          card.append(el('div', 'w-mid', `${g.done ? '✓ ' : ''}${g.text}`), el('div', 'w-dim', `${g.progress} / ${g.target} ${g.unit} (${pct}%)${days != null ? ` · ${days >= 0 ? days + ' dni do terminu' : 'po terminie o ' + -days + ' dni'}` : ''}`));
          const bar = el('div', 'w-meter');
          const fill = el('i');
          fill.style.width = pct + '%';
          bar.appendChild(fill);
          card.appendChild(bar);
          const row = el('div', 'field');
          row.style.gap = '4px';
          [[-1, '−1'], [1, '+1'], [5, '+5'], [10, '+10']].forEach(([d, l]) => {
            const b = el('button', 'btn ghost', l);
            b.addEventListener('click', async () => {
              const p = Math.max(0, g.progress + d);
              await Life.patch('goals', g.id, { progress: p, done: p >= g.target });
              if (p >= g.target && !g.done) UI.logLife('auto', `Cel osiagniety: ${g.text}`, 'cele');
              draw();
            });
            row.appendChild(b);
          });
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', async () => {
            await Life.del('goals', g.id);
            draw();
          });
          row.appendChild(x);
          card.appendChild(row);
          list.appendChild(card);
        });
      }
      redrawOn(['goals'], draw, body);
      draw();
    },
  };
  const dates = {
    title: 'ODLICZANIA I URODZINY',
    glyph: '◷',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const cd = el('div', 'w-list');
      const bd = el('div', 'w-list');
      body.append(
        el('div', 'sub', 'ODLICZANIA'),
        addForm('Nazwa wydarzenia', async (v, x) => {
          if (!x.date.value) throw new Error('Podaj date.');
          await Life.add('countdowns', { name: v, date: x.date.value });
        }, 'DODAJ', (f) => {
          const d = el('input', 'inp');
          d.type = 'date';
          f.insertBefore(d, f.lastChild);
          return { date: d };
        }),
        cd,
        el('div', 'sub', 'URODZINY I WAZNE DATY (DZIEN-MIESIAC)'),
        addForm('Imie / okazja', async (v, x) => {
          if (!x.date.value) throw new Error('Podaj date.');
          await Life.add('birthdays', { name: v, date: x.date.value.slice(5) });
        }, 'DODAJ', (f) => {
          const d = el('input', 'inp');
          d.type = 'date';
          f.insertBefore(d, f.lastChild);
          return { date: d };
        }),
        bd
      );
      async function draw() {
        const [c, b] = await Promise.all([Life.list('countdowns', true).catch(() => []), Life.list('birthdays', true).catch(() => [])]);
        cd.innerHTML = '';
        c.slice().sort((x, y) => x.date.localeCompare(y.date)).forEach((e) => {
          const days = Math.ceil((new Date(e.date + 'T12:00:00') - new Date()) / 86400000);
          const it = el('div', 'it');
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', async () => {
            await Life.del('countdowns', e.id);
            draw();
          });
          const r = el('span', null, days >= 0 ? `za ${days} dni` : `${-days} dni temu`);
          r.appendChild(x);
          it.append(el('span', null, `${e.name} (${e.date})`), r);
          cd.appendChild(it);
        });
        if (!c.length) cd.appendChild(el('div', 'w-empty', 'Brak.'));
        bd.innerHTML = '';
        const nowD = new Date();
        const next = (md) => {
          const [m, d] = md.split('-').map(Number);
          let dt = new Date(nowD.getFullYear(), m - 1, d, 12);
          if (dt < new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate())) dt = new Date(nowD.getFullYear() + 1, m - 1, d, 12);
          return dt;
        };
        b.slice().sort((x, y) => next(x.date) - next(y.date)).forEach((e) => {
          const days = Math.ceil((next(e.date) - nowD) / 86400000);
          const it = el('div', 'it');
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', async () => {
            await Life.del('birthdays', e.id);
            draw();
          });
          const r = el('span', null, days === 0 ? 'DZIS!' : `za ${days} dni`);
          r.appendChild(x);
          it.append(el('span', null, `🎂 ${e.name} (${e.date.slice(3)}.${e.date.slice(0, 2)})`), r);
          bd.appendChild(it);
        });
        if (!b.length) bd.appendChild(el('div', 'w-empty', 'Brak.'));
      }
      redrawOn(['countdowns', 'birthdays'], draw, body);
      draw();
    },
  };
  mod('goals', 'Cele i daty', 'cele, odliczania, urodziny', '◎', 'Dom', { goals, dates });

  // ================= TABLICA (KANBAN) =================
  const COLS = [['todo', 'DO ZROBIENIA'], ['doing', 'W TOKU'], ['done', 'GOTOWE']];
  const PRIO = { low: 'var(--dim)', mid: 'var(--blue)', high: 'var(--red)' };
  const kanban = {
    title: 'TABLICA PROJEKTOW',
    glyph: '▦',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const board = el('div', 'kanban');
      body.append(
        addForm('Nowa karta', async (v, x) => {
          await Life.add('kanban', { text: v, col: 'todo', prio: x.prio.value });
        }, 'DODAJ', (f) => {
          const p = el('select', 'inp');
          [['mid', 'normalny'], ['high', 'pilny'], ['low', 'niski']].forEach(([v, l]) => {
            const o = el('option', null, l);
            o.value = v;
            p.appendChild(o);
          });
          f.insertBefore(p, f.lastChild);
          return { prio: p };
        }),
        board
      );
      async function draw() {
        const items = await Life.list('kanban', true).catch(() => []);
        board.innerHTML = '';
        COLS.forEach(([col, label]) => {
          const c = el('div', 'kan-col');
          c.dataset.col = col;
          c.appendChild(el('div', 'sub', `${label} (${items.filter((i) => i.col === col).length})`));
          c.addEventListener('dragover', (e) => {
            e.preventDefault();
            c.classList.add('over');
          });
          c.addEventListener('dragleave', () => c.classList.remove('over'));
          c.addEventListener('drop', async (e) => {
            e.preventDefault();
            c.classList.remove('over');
            const id = e.dataTransfer.getData('text/plain');
            if (id) {
              await Life.patch('kanban', id, { col });
              if (col === 'done') UI.logLife('auto', `Ukonczono: ${(items.find((i) => i.id === id) || {}).text || ''}`, 'tablica');
              draw();
            }
          });
          items.filter((i) => i.col === col).forEach((i) => {
            const card = el('div', 'kan-card');
            card.draggable = true;
            card.style.borderLeftColor = PRIO[i.prio] || PRIO.mid;
            card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', i.id));
            card.appendChild(el('div', null, i.text));
            const acts = el('div', 'kan-acts');
            [['←', -1], ['→', 1]].forEach(([l, d]) => {
              const idx = COLS.findIndex((x) => x[0] === col) + d;
              if (idx < 0 || idx >= COLS.length) return;
              const b = el('button', null, l);
              b.addEventListener('click', async () => {
                await Life.patch('kanban', i.id, { col: COLS[idx][0] });
                draw();
              });
              acts.appendChild(b);
            });
            const x = el('button', null, '×');
            x.addEventListener('click', async () => {
              await Life.del('kanban', i.id);
              draw();
            });
            acts.appendChild(x);
            card.appendChild(acts);
            c.appendChild(card);
          });
          board.appendChild(c);
        });
      }
      redrawOn(['kanban'], draw, body);
      draw();
    },
  };
  mod('kanban', 'Tablica', 'karty: do zrobienia, w toku, gotowe', '▦', 'Wiedza', { kanban });

  // ================= ZAKLADKI =================
  const bookmarks = {
    title: 'ZAKLADKI',
    glyph: '★',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const list = el('div', 'w-list');
      const search = el('input', 'inp');
      search.placeholder = 'Szukaj lub filtruj po #tagu';
      body.append(
        addForm('Adres (https://...)', async (v, x) => {
          await Life.add('bookmarks', { url: /^https?:\/\//i.test(v) ? v : 'https://' + v, title: x.title.value.trim(), tags: x.tags.value.split(/[\s,#]+/).filter(Boolean) });
        }, 'DODAJ', (f) => {
          const t = el('input', 'inp');
          t.placeholder = 'tytul (opcjonalnie)';
          const g = el('input', 'inp');
          g.placeholder = '#tagi';
          f.insertBefore(t, f.lastChild);
          f.insertBefore(g, f.lastChild);
          return { title: t, tags: g };
        }),
        search,
        list
      );
      async function draw() {
        const items = await Life.list('bookmarks', true).catch(() => []);
        const q = search.value.trim().toLowerCase().replace(/^#/, '');
        list.innerHTML = '';
        const rows = items.filter((b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) || b.tags.includes(q));
        if (!rows.length) list.appendChild(el('div', 'w-empty', 'Brak zakladek.'));
        rows.forEach((b) => {
          const it = el('div', 'it');
          const a = el('a', null, `★ ${b.title}`);
          a.href = b.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.style.color = 'var(--bright)';
          const r = el('span', null, b.tags.map((t) => '#' + t).join(' '));
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', async () => {
            await Life.del('bookmarks', b.id);
            draw();
          });
          r.appendChild(x);
          it.append(a, r);
          list.appendChild(it);
        });
      }
      search.addEventListener('input', draw);
      redrawOn(['bookmarks'], draw, body);
      draw();
    },
  };
  mod('bookmarks', 'Zakladki', 'linki z tagami', '★', 'Wiedza', { bookmarks });

  // ================= FISZKI (Leitner) =================
  const INTERVAL = [0, 1, 2, 4, 8, 16];
  const cards = {
    title: 'FISZKI',
    glyph: '❖',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const stage = el('div');
      const manage = el('div');
      body.append(stage, el('div', 'sub', 'DODAJ FISZKE'), manage);

      const mkForm = () => {
        const f = el('form', 'field');
        f.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0';
        const deck = el('input', 'inp');
        deck.placeholder = 'talia';
        deck.style.maxWidth = '120px';
        const q = el('input', 'inp');
        q.placeholder = 'pytanie';
        const a = el('input', 'inp');
        a.placeholder = 'odpowiedz';
        const go = el('button', 'btn primary', 'DODAJ');
        go.type = 'submit';
        f.append(deck, q, a, go);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!q.value.trim() || !a.value.trim()) return;
          await Life.add('flashcards', { deck: deck.value, q: q.value, a: a.value });
          q.value = '';
          a.value = '';
        });
        const g = el('form', 'field');
        g.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0';
        const topic = el('input', 'inp');
        topic.placeholder = 'Temat dla AI, np. stolice Europy / angielski czasowniki / podstawy elektrotechniki';
        topic.style.flex = '1 1 240px';
        const n = el('input', 'inp');
        n.type = 'number';
        n.value = '8';
        n.style.maxWidth = '70px';
        const gen = el('button', 'btn', '✦ GENERUJ AI');
        gen.type = 'submit';
        g.append(topic, n, gen);
        g.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!topic.value.trim()) return;
          gen.disabled = true;
          gen.textContent = 'Generuje...';
          try {
            const r = await api('/api/life/cards/generate', json('POST', { topic: topic.value, n: Number(n.value) || 8 }));
            delete cache.flashcards;
            window.dispatchEvent(new CustomEvent('jarvis:life', { detail: { coll: 'flashcards' } }));
            toast(`Dodano ${r.items.length} fiszek (talia: ${r.deck}).`, 'ok');
            topic.value = '';
          } catch (err) {
            toast(err.message);
          } finally {
            gen.disabled = false;
            gen.textContent = '✦ GENERUJ AI';
          }
        });
        manage.append(f, g);
      };
      mkForm();

      let deckFilter = '';
      async function draw() {
        const items = await Life.list('flashcards', true).catch(() => []);
        const decks = [...new Set(items.map((c) => c.deck))];
        const due = items.filter((c) => c.due <= today() && (!deckFilter || c.deck === deckFilter));
        stage.innerHTML = '';
        const head = el('div', 'w-row');
        const sel = el('select', 'inp');
        [['', 'Wszystkie talie']].concat(decks.map((d) => [d, d])).forEach(([v, l]) => {
          const o = el('option', null, l);
          o.value = v;
          sel.appendChild(o);
        });
        sel.value = deckFilter;
        sel.addEventListener('change', () => {
          deckFilter = sel.value;
          draw();
        });
        head.append(sel, el('span', 'w-dim', `${items.length} fiszek · do powtorki dzis: ${due.length}`));
        stage.appendChild(head);
        if (!due.length) {
          stage.appendChild(el('div', 'w-empty', items.length ? 'Na dzis nic do powtorki - dobra robota!' : 'Dodaj fiszki albo wygeneruj je AI.'));
          return;
        }
        const c = due[Math.floor(Math.random() * due.length)];
        const card = el('div', 'w');
        card.style.cssText = 'min-height:120px;margin-top:10px;cursor:pointer';
        card.appendChild(el('div', 'w-dim', `${c.deck} · poziom ${c.box}/5`));
        card.appendChild(el('div', 'w-mid', c.q));
        const ans = el('div', 'w-mid');
        ans.style.color = 'var(--good)';
        ans.hidden = true;
        ans.textContent = c.a;
        const reveal = el('button', 'btn primary', 'POKAZ ODPOWIEDZ');
        const grade = el('div', 'field');
        grade.hidden = true;
        grade.style.gap = '6px';
        const res = (ok) => async () => {
          const box = ok ? Math.min(5, c.box + 1) : 1;
          await Life.patch('flashcards', c.id, { box, due: addDays(today(), INTERVAL[box]) });
          draw();
        };
        const bad = el('button', 'btn danger', '✗ NIE WIEDZIALEM');
        const good = el('button', 'btn primary', '✓ WIEDZIALEM');
        bad.addEventListener('click', res(false));
        good.addEventListener('click', res(true));
        grade.append(bad, good);
        reveal.addEventListener('click', () => {
          ans.hidden = false;
          grade.hidden = false;
          reveal.hidden = true;
        });
        card.append(ans, reveal, grade);
        stage.appendChild(card);
      }
      redrawOn(['flashcards'], draw, body);
      draw();
    },
  };
  mod('cards', 'Fiszki', 'nauka z powtorkami', '❖', 'Wiedza', { cards });

  // ================= SZYBKIE NOTATKI =================
  const qnotes = {
    title: 'SZYBKIE NOTATKI',
    glyph: '✎',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const list = el('div');
      list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:10px';
      const f = el('form', 'field');
      f.style.cssText = 'gap:6px;margin:8px 0';
      const ta = el('textarea', 'inp');
      ta.rows = 2;
      ta.placeholder = 'Szybka mysl... (Ctrl+Enter zapisuje)';
      ta.style.flex = '1';
      const go = el('button', 'btn primary', 'ZAPISZ');
      go.type = 'submit';
      f.append(ta, go);
      const submit = async () => {
        if (!ta.value.trim()) return;
        await Life.add('quicknotes', { text: ta.value });
        ta.value = '';
      };
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        submit().catch((err) => toast(err.message));
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submit();
        }
      });
      body.append(f, list);
      async function draw() {
        const items = (await Life.list('quicknotes', true).catch(() => [])).slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
        list.innerHTML = '';
        if (!items.length) list.appendChild(el('div', 'w-empty', 'Brak notatek.'));
        items.forEach((n) => {
          const c = el('div', 'w');
          c.style.minHeight = '0';
          if (n.pinned) c.style.borderColor = 'var(--amber)';
          c.appendChild(el('div', 'w-mid', n.text));
          c.appendChild(el('div', 'w-dim', new Date(n.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })));
          const row = el('div', 'field');
          row.style.gap = '4px';
          const pin = el('button', 'btn ghost', n.pinned ? '★ ODEPNIJ' : '☆ PRZYPNIJ');
          pin.addEventListener('click', async () => {
            await Life.patch('quicknotes', n.id, { pinned: !n.pinned });
            draw();
          });
          const todo = el('button', 'btn ghost', '→ ZADANIE');
          todo.addEventListener('click', async () => {
            await api('/api/todos', json('POST', { text: n.text.slice(0, 200) }));
            toast('Dodano do zadan.', 'ok');
          });
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', async () => {
            await Life.del('quicknotes', n.id);
            draw();
          });
          row.append(pin, todo, x);
          c.appendChild(row);
          list.appendChild(c);
        });
      }
      redrawOn(['quicknotes'], draw, body);
      draw();
    },
  };
  mod('qnotes', 'Szybkie notatki', 'mysli i przypiecia', '✎', 'Glowne', { qnotes });

  // ================= PRZYPOMNIENIA CYKLICZNE (w module Zadania) =================
  const recurring = {
    title: 'PRZYPOMNIENIA CYKLICZNE',
    glyph: '↻',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const list = el('div', 'w-list');
      body.append(
        el('div', 'sub', 'Jarvis przypomni pushem (telefon) o wskazanej porze, a wpis trafi do dziennika.'),
        addForm('O czym przypominac (np. Wez tabletke, Tankowanie, Siłownia)', async (v, x) => {
          await Life.add('recurring', { text: v, every: x.every.value, time: x.time.value || '09:00', dow: Number(x.dow.value) });
        }, 'DODAJ', (f) => {
          const every = el('select', 'inp');
          [['daily', 'codziennie'], ['weekly', 'co tydzien'], ['monthly', 'co miesiac']].forEach(([v, l]) => {
            const o = el('option', null, l);
            o.value = v;
            every.appendChild(o);
          });
          const time = el('input', 'inp');
          time.type = 'time';
          time.value = '09:00';
          const dow = el('select', 'inp');
          ['nd', 'pn', 'wt', 'sr', 'cz', 'pt', 'sb'].forEach((l, i) => {
            const o = el('option', null, l);
            o.value = String(i);
            dow.appendChild(o);
          });
          dow.value = '1';
          f.insertBefore(every, f.lastChild);
          f.insertBefore(time, f.lastChild);
          f.insertBefore(dow, f.lastChild);
          return { every, time, dow };
        }),
        list
      );
      async function draw() {
        const items = await Life.list('recurring', true).catch(() => []);
        list.innerHTML = '';
        if (!items.length) list.appendChild(el('div', 'w-empty', 'Brak.'));
        items.forEach((r) => {
          const it = el('div', 'it');
          const when = r.every === 'daily' ? `codziennie ${r.time}` : r.every === 'weekly' ? `${PL_DAY[r.dow]} ${r.time}` : `${r.dom}. dnia miesiaca ${r.time}`;
          const x = el('button', 'row-x', '×');
          x.addEventListener('click', async () => {
            await Life.del('recurring', r.id);
            draw();
          });
          const rr = el('span', null, when);
          rr.appendChild(x);
          it.append(el('span', null, `↻ ${r.text}`), rr);
          list.appendChild(it);
        });
      }
      redrawOn(['recurring'], draw, body);
      draw();
    },
  };
  UI.extend('tasks', { recurring });

  // ================= eksport / import w Ustawieniach =================
  const backup = {
    title: 'DANE MODULOW (ZYCIE)',
    glyph: '⇅',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'Zakupy, nawyki, cele, tablica, dziennik, zakladki, fiszki, notatki, odliczania - eksport i import jednym plikiem JSON.'));
      const row = el('div', 'field');
      row.style.cssText = 'gap:6px;margin-top:8px;flex-wrap:wrap';
      const ex = el('button', 'btn primary', '⬇ EKSPORT JSON');
      ex.addEventListener('click', async () => {
        const data = await api('/api/life/export');
        const a = el('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = `jarvis-zycie-${today()}.json`;
        a.click();
      });
      const file = el('input');
      file.type = 'file';
      file.accept = 'application/json';
      file.hidden = true;
      const im = el('button', 'btn ghost', '⬆ IMPORT JSON');
      im.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        try {
          const r = await api('/api/life/import', json('POST', JSON.parse(await file.files[0].text())));
          toast(`Zaimportowano ${r.added} pozycji.`, 'ok');
        } catch (e) {
          toast('Import nieudany: ' + e.message);
        }
      });
      row.append(ex, im, file);
      body.appendChild(row);
    },
  };
  UI.extend('set', { lifebackup: backup });
})();
