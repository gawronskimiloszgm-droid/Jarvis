// Modul Trening: dzisiejszy trening z planem i odpoczynkiem, postepy i rekordy, talerze i rozgrzewka,
// rundy z gongiem oraz cialo, jedzenie i sen. Liczy FitKit, dane trzyma serwer (/api/fit, /api/life).
(function () {
  const UI = window.JarvisUI;
  const F = window.FitKit;
  if (!UI || !F) return;
  const { el, api, toast, isOwner } = UI;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const today = () => UI.dayKey?.(new Date()) || new Date().toISOString().slice(0, 10);
  const changed = () => window.dispatchEvent(new CustomEvent('jarvis:fit'));

  function guard(body) {
    if (isOwner()) return false;
    body.innerHTML = '';
    body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
    return true;
  }
  function onChange(body, fn) {
    const h = () => {
      if (!document.body.contains(body)) return window.removeEventListener('jarvis:fit', h);
      fn();
    };
    window.addEventListener('jarvis:fit', h);
    // Seria zapisana glosem trafia na serwer: odswiezamy, gdy dziennik albo dane zycia sie zmienia.
    window.addEventListener('jarvis:life', h);
  }
  const row = (...kids) => {
    const r = el('div', 'field');
    r.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0;align-items:center';
    r.append(...kids);
    return r;
  };
  const input = (ph, w = '90px', type = 'text') => {
    const i = el('input', 'inp');
    i.placeholder = ph;
    i.type = type;
    i.style.flex = `0 1 ${w}`;
    return i;
  };
  const button = (label, cls, fn) => {
    const b = el('button', `btn ${cls || ''}`, label);
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
  const bar = (pct, label) => {
    const wrap = el('div');
    wrap.style.cssText = 'margin:4px 0';
    const t = el('div', 'w-dim', label);
    const track = el('div');
    track.style.cssText = 'height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden';
    const fill = el('div');
    fill.style.cssText = `height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:var(--blue,#33e0ff)`;
    track.appendChild(fill);
    wrap.append(t, track);
    return wrap;
  };

  // ---------- dzwiek: gong i krotkie piski (WebAudio, bez plikow) ----------
  let ctx = null;
  function beep(freq = 880, ms = 160, times = 1, gain = 0.25) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        o.type = 'sine';
        const t0 = ctx.currentTime + i * (ms / 1000 + 0.08);
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + ms / 1000 + 0.02);
      }
    } catch {
      /* dzwiek to dodatek */
    }
  }
  const gong = () => beep(330, 900, 1, 0.4);

  // ---------- odpoczynek miedzy seriami: jeden na cala aplikacje ----------
  const rest = { end: 0, total: 0, ex: '', timer: null, listeners: new Set() };
  function startRest(seconds, ex) {
    const s = Math.max(10, Math.min(900, Number(seconds) || 120));
    rest.end = Date.now() + s * 1000;
    rest.total = s * 1000;
    rest.ex = ex || '';
    clearInterval(rest.timer);
    rest.timer = setInterval(() => {
      const left = rest.end - Date.now();
      rest.listeners.forEach((fn) => fn(left));
      if (left <= 0) {
        clearInterval(rest.timer);
        rest.end = 0;
        beep(990, 180, 3);
        toast(`Koniec przerwy${rest.ex ? ` - ${rest.ex}` : ''}. Następna seria.`, 'ok');
      } else if (left < 10500 && left > 9500) beep(660, 90, 1, 0.15);
    }, 500);
    toast(`Przerwa ${s} s.`, 'ok');
  }
  UI.clientActions['trening-przerwa'] = (p) => startRest(p?.sekundy, p?.cwiczenie);

  // ---------- rundy ----------
  const box = { plan: null, i: 0, end: 0, timer: null, listeners: new Set() };
  function stopRounds() {
    clearInterval(box.timer);
    box.plan = null;
    box.listeners.forEach((fn) => fn(null));
  }
  function startRounds({ rundy = 3, praca_s = 180, przerwa_s = 60 } = {}) {
    stopRounds();
    box.plan = F.rounds({ rounds: Number(rundy) || 3, work: Number(praca_s) || 180, rest: Number(przerwa_s) ?? 60, prep: 10 }).odcinki;
    box.i = 0;
    box.end = Date.now() + box.plan[0].s * 1000;
    beep(660, 120, 2);
    box.timer = setInterval(() => {
      if (!box.plan) return;
      let left = box.end - Date.now();
      if (left <= 0) {
        box.i++;
        if (box.i >= box.plan.length) {
          gong();
          setTimeout(gong, 700);
          toast('Koniec rund. Dobra robota.', 'ok');
          stopRounds();
          return;
        }
        const seg = box.plan[box.i];
        box.end = Date.now() + seg.s * 1000;
        left = seg.s * 1000;
        if (seg.typ === 'runda') gong();
        else beep(520, 300, 2);
      } else if (box.plan[box.i].typ === 'runda' && left < 10500 && left > 9500) beep(1200, 70, 3, 0.15); // 10 s do konca rundy
      box.listeners.forEach((fn) => fn({ seg: box.plan[box.i], left, i: box.i, n: box.plan.length }));
    }, 250);
  }
  UI.clientActions['trening-rundy'] = (p) => {
    UI.openWindow?.('trening');
    startRounds(p || {});
  };

  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // ================= TRENING DZIS =================
  const todayPanel = {
    title: 'TRENING DZIŚ',
    glyph: '🏋',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const restBox = el('div', 'w-mid');
      restBox.style.cssText = 'font-size:20px;margin:4px 0;min-height:26px';
      const draw = (left) => {
        restBox.textContent = left > 0 ? `⏱ Przerwa: ${fmt(left)}${rest.ex ? ` (${rest.ex})` : ''}` : '';
      };
      rest.listeners.add(draw);
      const quick = input('np. wyciskanie 80 kg na 10 albo 3 serie po 8 przysiad 100', '340px');
      const add = button('ZAPISZ SERIĘ', 'primary', async () => {
        const s = F.parseSet(quick.value);
        if (!s) throw new Error('Napisz: ćwiczenie, ciężar i powtórzenia, np. „przysiad 100 kg na 5”.');
        const r = await api('/api/fit/sets', json('POST', { ex: s.ex, kg: s.kg, reps: s.reps, sets: s.sets }));
        quick.value = '';
        if (r.rekord) toast(`🏆 ${r.rekord}`, 'ok');
        startRest(r.przerwa_s, s.ex);
        changed();
      });
      quick.addEventListener('keydown', (e) => e.key === 'Enter' && add.click());
      const plan = el('div');
      const list = el('div');
      const tips = el('div');
      body.append(el('div', 'sub', 'Mów albo pisz: „Jarvis, wyciskanie 80 na 10”. Po każdej serii rusza przerwa, a rekordy wykrywają się same.'), row(quick, add), restBox, plan, list, tips);

      async function load() {
        let s;
        try {
          s = await api('/api/fit/summary');
        } catch (e) {
          list.textContent = e.message;
          return;
        }
        plan.innerHTML = '';
        plan.appendChild(el('div', 'w-mid', `Plan: ${s.plan.program} - dzień ${s.plan.name}`));
        const exRow = el('div', 'field');
        exRow.style.cssText = 'gap:6px;flex-wrap:wrap;margin:4px 0';
        for (const [name, n, reps] of s.plan.ex) {
          const sug = s.planLoads?.[name];
          const b = el('button', 'btn ghost', `${name} ${n}×${reps}`);
          b.type = 'button';
          b.title = 'Wstaw do pola';
          b.addEventListener('click', () => {
            quick.value = `${name} ${sug?.kg ? `${sug.kg} kg ` : ''}na `;
            quick.focus();
          });
          exRow.appendChild(b);
        }
        plan.append(exRow, button('ZAKOŃCZ DZIEŃ PLANU', 'ghost', async () => {
          await api('/api/fit/plan-done', json('POST', {}));
          toast('Następnym razem kolejny dzień planu.', 'ok');
          changed();
        }));
        list.innerHTML = '';
        if (!s.today.length) list.appendChild(el('div', 'hint', 'Dziś jeszcze nic. Zacznij od rozgrzewki (zakładka NARZĘDZIA).'));
        const groups = {};
        s.today.forEach((x) => (groups[x.ex] = groups[x.ex] || []).push(x));
        for (const [ex, sets] of Object.entries(groups)) {
          const r = el('div', 'row-text');
          r.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:3px 0';
          r.appendChild(el('b', null, ex));
          for (const x of sets) {
            const chip = el('span', 'w-dim', x.kg ? `${x.kg} kg × ${x.reps}` : `× ${x.reps}`);
            chip.style.cssText = 'border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:1px 6px;cursor:pointer';
            chip.title = 'Kliknij, żeby usunąć';
            chip.addEventListener('click', async () => {
              if (!confirm(`Usunąć serię ${x.ex} ${x.kg} kg × ${x.reps}?`)) return;
              await api(`/api/life/sets/${x.id}`, { method: 'DELETE' });
              changed();
            });
            r.appendChild(chip);
          }
          const best = Math.max(...sets.map((x) => F.oneRepMax(x.kg, x.reps)));
          r.appendChild(el('span', 'w-dim', best ? `1RM ≈ ${best} kg` : `masa ciała, razem ${sets.reduce((a, x) => a + x.reps, 0)} powt.`));
          list.appendChild(r);
        }
        tips.innerHTML = '';
        for (const t of s.suggestions.filter((x) => x.kg != null)) tips.appendChild(el('div', 'w-dim', `Następnym razem ${t.ex}: ${t.kg ? `${t.kg} kg × ` : ''}${t.reps} powt. (${t.why}).`));
      }
      load();
      onChange(body, load);
    },
  };

  // ================= POSTEPY =================
  const progress = {
    title: 'POSTĘPY I REKORDY',
    glyph: '🏆',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const out = el('div');
      const csv = button('POBIERZ HISTORIĘ (CSV)', 'ghost', async () => {
        const r = await fetch('/api/fit/export.csv', { headers: { Authorization: `Bearer ${localStorage.getItem('jarvis.token') || ''}` } });
        if (!r.ok) throw new Error('Nie udało się pobrać.');
        const a = el('a');
        a.href = URL.createObjectURL(await r.blob());
        a.download = `trening-${today()}.csv`;
        a.click();
      });
      body.append(out, row(csv));
      async function load() {
        const [s, all] = await Promise.all([api('/api/fit/summary'), api('/api/life/sets')]);
        out.innerHTML = '';
        out.appendChild(el('div', 'w-mid', `Treningów w 7 dni: ${s.trainingDays7}. Ostatni: ${s.lastTraining || 'brak'}.`));
        const vols = Object.entries(s.week).sort((a, b) => b[1].sets - a[1].sets);
        const maxSets = Math.max(10, ...vols.map(([, v]) => v.sets));
        out.appendChild(el('div', 'sub', 'Serie w tym tygodniu (10-20 na partię to typowy zakres):'));
        for (const [p, v] of vols) out.appendChild(bar((100 * v.sets) / maxSets, `${p}: ${v.sets} serii, ${Math.round(v.volume)} kg objętości`));
        const since = Object.entries(s.since).filter(([p]) => p !== 'inne').sort((a, b) => b[1] - a[1]);
        if (since.length) out.appendChild(el('div', 'w-dim', `Dni od ostatniego treningu: ${since.map(([p, d]) => `${p} ${d}`).join(', ')}`));
        out.appendChild(el('div', 'sub', 'Rekordy (kliknij, żeby zobaczyć wykres szacowanego 1RM):'));
        const chart = el('div');
        for (const r of s.records) {
          const line = el('div', 'row-text', r.maxKg ? `${r.ex}: ${r.maxKg} kg × ${r.maxKgReps} · 1RM ≈ ${r.best1rm} kg · ${r.sets} serii` : `${r.ex}: najwięcej ${r.maxKgReps} powtórzeń · ${r.sets} serii`);
          line.style.cursor = 'pointer';
          line.addEventListener('click', () => drawChart(chart, r.ex, all.items));
          out.appendChild(line);
        }
        if (!s.records.length) out.appendChild(el('div', 'hint', 'Brak serii.'));
        out.appendChild(chart);
      }
      function drawChart(host, ex, sets) {
        const k = F.exKey(ex);
        const days = {};
        for (const x of sets.filter((y) => F.exKey(y.ex) === k)) days[x.day] = Math.max(days[x.day] || 0, F.oneRepMax(x.kg, x.reps));
        const pts = Object.entries(days).sort();
        host.innerHTML = '';
        if (pts.length < 2) return host.appendChild(el('div', 'hint', 'Za mało dni na wykres.'));
        const W = 520;
        const H = 140;
        const vals = pts.map((p) => p[1]);
        const lo = Math.min(...vals) * 0.95;
        const hi = Math.max(...vals) * 1.05;
        const xy = pts.map(([, v], i) => [20 + (i * (W - 40)) / (pts.length - 1), H - 20 - ((v - lo) / (hi - lo || 1)) * (H - 40)]);
        host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px"><polyline fill="none" stroke="#33e0ff" stroke-width="2" points="${xy.map((p) => p.join(',')).join(' ')}"/>${xy.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3" fill="#33e0ff"><title>${pts[i][0]}: ${pts[i][1]} kg</title></circle>`).join('')}<text x="20" y="14" fill="#9fd8ff" font-size="11">${ex}: ${vals[0]} → ${vals[vals.length - 1]} kg (1RM)</text></svg>`;
      }
      load().catch((e) => (out.textContent = e.message));
      onChange(body, () => load().catch(() => {}));
    },
  };

  // ================= NARZEDZIA =================
  const tools = {
    title: 'TALERZE, ROZGRZEWKA, 1RM',
    glyph: '⚖',
    build(body) {
      body.innerHTML = '';
      const kg = input('ciężar kg', '110px', 'number');
      const barKg = input('sztanga', '90px', 'number');
      barKg.value = '20';
      const out = el('div');
      const calc = () => {
        out.innerHTML = '';
        const total = Number(kg.value);
        if (!total) return;
        const p = F.plates(total, { bar: Number(barKg.value) || 20 });
        if (p.error) return out.appendChild(el('div', 'hint', p.error));
        const vis = el('div');
        vis.style.cssText = 'display:flex;align-items:center;gap:2px;margin:8px 0';
        const COLORS = { 25: '#d33', 20: '#36c', 15: '#db3', 10: '#3a3', 5: '#eee', 2.5: '#888', 1.25: '#aaa' };
        const plate = (w) => {
          const d = el('div');
          d.title = `${w} kg`;
          d.style.cssText = `width:${w >= 10 ? 12 : 8}px;height:${30 + w * 2.2}px;background:${COLORS[w] || '#999'};border-radius:2px`;
          return d;
        };
        const barEl = el('div');
        barEl.style.cssText = 'width:140px;height:8px;background:#aab';
        [...p.side].reverse().forEach((w) => vis.appendChild(plate(w)));
        vis.appendChild(barEl);
        p.side.forEach((w) => vis.appendChild(plate(w)));
        out.append(el('div', 'w-mid', p.side.length ? `Na każdą stronę: ${p.side.join(' + ')} kg` : 'Sama sztanga.'), vis);
        if (!p.ok) out.appendChild(el('div', 'hint', `Brakuje ${p.rest} kg, których nie da się złożyć z talerzy.`));
        out.appendChild(el('div', 'sub', 'Rozgrzewka:'));
        for (const s of F.warmup(total, Number(barKg.value) || 20)) out.appendChild(el('div', 'w-dim', `${s.kg} kg × ${s.reps}`));
      };
      kg.addEventListener('input', calc);
      barKg.addEventListener('input', calc);
      const w = input('kg', '80px', 'number');
      const r = input('powt.', '70px', 'number');
      const one = el('div', 'w-mid');
      const rm = () => {
        const v = F.oneRepMax(w.value, r.value);
        one.textContent = v ? `Szacowany 1RM: ${v} kg · 90%: ${Math.round(v * 0.9 * 2) / 2} · 80%: ${Math.round(v * 0.8 * 2) / 2} · 70%: ${Math.round(v * 0.7 * 2) / 2}` : '';
      };
      w.addEventListener('input', rm);
      r.addEventListener('input', rm);
      body.append(el('div', 'sub', 'Talerze na sztangę i rozgrzewka:'), row(kg, barKg), out, el('div', 'sub', 'Ciężar na jedno powtórzenie z serii:'), row(w, r), one);
    },
  };

  // ================= RUNDY =================
  const roundsPanel = {
    title: 'RUNDY (BOKS, INTERWAŁY)',
    glyph: '🥊',
    build(body) {
      body.innerHTML = '';
      const n = input('rundy', '70px', 'number');
      const work = input('praca s', '80px', 'number');
      const pause = input('przerwa s', '80px', 'number');
      n.value = '3';
      work.value = '180';
      pause.value = '60';
      const big = el('div');
      big.style.cssText = 'font:700 54px/1.1 monospace;margin:10px 0;color:var(--bright,#fff)';
      const label = el('div', 'w-mid');
      const presets = row(
        button('BOKS 3×3:00', 'ghost', () => Object.assign(n, { value: 3 }) && Object.assign(work, { value: 180 }) && Object.assign(pause, { value: 60 })),
        button('TABATA 8×0:20', 'ghost', () => Object.assign(n, { value: 8 }) && Object.assign(work, { value: 20 }) && Object.assign(pause, { value: 10 })),
        button('WOREK 6×2:00', 'ghost', () => Object.assign(n, { value: 6 }) && Object.assign(work, { value: 120 }) && Object.assign(pause, { value: 45 })),
      );
      const draw = (st) => {
        if (!st) {
          big.textContent = '0:00';
          label.textContent = 'Gotowy.';
          return;
        }
        big.textContent = fmt(st.left);
        big.style.color = st.seg.typ === 'runda' ? '#ff5d5d' : st.seg.typ === 'przerwa' ? '#5dff9e' : '#ffd25d';
        label.textContent = st.seg.typ === 'runda' ? `RUNDA ${st.seg.nr}` : st.seg.typ === 'przerwa' ? `Przerwa po rundzie ${st.seg.nr}` : 'Przygotuj się';
      };
      box.listeners.add(draw);
      draw(null);
      body.append(el('div', 'sub', 'Gong na start rundy, trzy piski 10 s przed końcem. Głosem: „Jarvis, 5 rund po 3 minuty”.'), presets, row(n, work, pause, button('START', 'primary', () => startRounds({ rundy: n.value, praca_s: work.value, przerwa_s: pause.value })), button('STOP', 'danger', stopRounds)), big, label);
    },
  };

  // ================= CIALO I JEDZENIE =================
  const bodyPanel = {
    title: 'CIAŁO, JEDZENIE I SEN',
    glyph: '🍽',
    wide: true,
    build(body) {
      if (guard(body)) return;
      body.innerHTML = '';
      const out = el('div');
      const kg = input('waga kg', '90px', 'number');
      const meal = input('posiłek, np. kurczak z ryżem', '220px');
      const kcal = input('kcal', '70px', 'number');
      const prot = input('białko g', '80px', 'number');
      const from = input('zasnąłem 23:30', '120px');
      const to = input('wstałem 07:00', '120px');
      const prof = el('div');
      body.append(
        out,
        row(kg, button('ZAPISZ WAGĘ', 'primary', async () => {
          await api('/api/fit/tool', json('POST', { name: 'masa_ciala', args: { kg: Number(kg.value) } }));
          kg.value = '';
          changed();
        })),
        row(meal, kcal, prot, button('DODAJ POSIŁEK', 'primary', async () => {
          if (!meal.value.trim()) throw new Error('Napisz, co to było.');
          await api('/api/fit/tool', json('POST', { name: 'posilek', args: { opis: meal.value, kcal: Number(kcal.value), bialko: Number(prot.value) } }));
          meal.value = kcal.value = prot.value = '';
          changed();
        })),
        row(from, to, button('ZAPISZ SEN', 'primary', async () => {
          const r = await api('/api/fit/tool', json('POST', { name: 'sen', args: { od: from.value, do: to.value } }));
          if (r.error) throw new Error(r.error);
          from.value = to.value = '';
          changed();
        })),
        prof,
      );
      async function load() {
        const s = await api('/api/fit/summary');
        out.innerHTML = '';
        if (s.weight) out.appendChild(el('div', 'w-mid', `Waga: ${s.weight.last} kg · średnia 7 dni ${s.weight.avg7} kg${s.weight.change != null ? ` · tydzień do tygodnia ${s.weight.change > 0 ? '+' : ''}${s.weight.change} kg` : ''}`));
        if (s.energy) {
          out.appendChild(bar((100 * s.intake.kcal) / s.energy.kcal, `Kalorie: ${s.intake.kcal} / ${s.energy.kcal} kcal (zapotrzebowanie ${s.energy.tdee}, cel: ${s.profile.goal})`));
          out.appendChild(bar((100 * s.intake.protein) / s.energy.protein, `Białko: ${s.intake.protein} / ${s.energy.protein} g · woda ok. ${s.energy.water} ml`));
        } else out.appendChild(el('div', 'hint', `Zjedzone dziś: ${s.intake.kcal} kcal, ${s.intake.protein} g białka. Uzupełnij profil niżej i wagę, żeby był cel.`));
        if (s.sleep) out.appendChild(el('div', 'w-dim', `Sen: ostatnio ${s.sleep.last.hours} h · średnia z ${s.sleep.nights} nocy: ${s.sleep.avg} h`));
        drawProfile(s.profile);
      }
      function drawProfile(p) {
        if (prof.dataset.drawn) return;
        prof.dataset.drawn = '1';
        const sel = (opts, v) => {
          const s = el('select', 'inp');
          for (const [val, txt] of opts) {
            const o = el('option', null, txt);
            o.value = val;
            s.appendChild(o);
          }
          s.value = String(v);
          return s;
        };
        const sex = sel([['m', 'mężczyzna'], ['k', 'kobieta']], p.sex);
        const age = input('wiek', '70px', 'number');
        const height = input('wzrost cm', '90px', 'number');
        age.value = p.age || '';
        height.value = p.height || '';
        const act = sel([[1.2, 'siedzący'], [1.375, 'lekka aktywność'], [1.55, 'trening 3-5×'], [1.725, 'trening 6-7×'], [1.9, 'bardzo dużo ruchu']], p.activity);
        const goal = sel([['redukcja', 'redukcja'], ['utrzymanie', 'utrzymanie'], ['masa', 'masa']], p.goal);
        const program = sel(Object.entries(F.PROGRAMS).map(([k, v]) => [k, v.name]), p.program);
        const restS = input('przerwa s', '90px', 'number');
        restS.value = p.rest;
        prof.append(el('div', 'sub', 'Profil (do celów kalorii i planu):'), row(sex, age, height, act, goal), row(program, restS, button('ZAPISZ PROFIL', 'primary', async () => {
          await api('/api/fit/profile', json('PUT', { sex: sex.value, age: Number(age.value), height: Number(height.value), activity: Number(act.value), goal: goal.value, program: program.value, rest: Number(restS.value) }));
          toast('Profil zapisany.', 'ok');
          changed();
        })));
      }
      load().catch((e) => (out.textContent = e.message));
      onChange(body, () => load().catch(() => {}));
    },
  };

  UI.register({ id: 'trening', title: 'Trening', sub: 'siłownia, boks, jedzenie, sen', icon: '🏋', owner: true, group: 'Zdrowie', panels: { fit_today: todayPanel, fit_progress: progress, fit_tools: tools, fit_rounds: roundsPanel, fit_body: bodyPanel } });
})();
