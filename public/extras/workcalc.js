// Kalkulatory w module Warsztat: ASG, elektronika, gwinty i druk 3D. Liczy WorkKit, wszystko lokalnie.
(function () {
  const UI = window.JarvisUI;
  const W = window.WorkKit;
  if (!UI || !W || !UI.extend) return;
  const { el } = UI;

  const row = (...kids) => {
    const r = el('div', 'field');
    r.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0;align-items:center';
    r.append(...kids);
    return r;
  };
  const input = (ph, w = '100px', value = '') => {
    const i = el('input', 'inp');
    i.placeholder = ph;
    i.title = ph;
    i.style.flex = `0 1 ${w}`;
    i.value = value;
    return i;
  };
  const select = (opts, v) => {
    const s = el('select', 'inp');
    for (const o of opts) {
      const e = el('option', null, o);
      e.value = o;
      s.appendChild(e);
    }
    s.value = v;
    return s;
  };
  const num = (i) => (i.value.trim() === '' ? undefined : Number(i.value.replace(',', '.')));
  const live = (inputs, fn) => {
    const run = () => {
      try {
        fn();
      } catch {
        /* niepelne dane */
      }
    };
    inputs.forEach((i) => i.addEventListener('input', run));
    inputs.forEach((i) => i.addEventListener('change', run));
    run();
  };
  const line = (out, text, cls = 'w-dim') => out.appendChild(el('div', cls, text));

  const asg = {
    title: 'ASG: ENERGIA, KULKI, PRZEŁOŻENIA',
    glyph: '⌖',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const fps = input('fps', '90px', '350');
      const g = input('kulka g', '80px', '0.20');
      const g2 = input('inna kulka g', '100px', '0.25');
      const e1 = el('div');
      live([fps, g, g2], () => {
        e1.innerHTML = '';
        const e = W.bbEnergy({ fps: num(fps), g: num(g) });
        if (!e) return;
        line(e1, `${e.joule} J · ${e.ms} m/s`, 'w-mid');
        for (const l of W.limitsFor(e.joule)) line(e1, `${l.ok ? '✓' : '✗'} ${l.name}: do ${l.joule} J (to ok. ${l.fps02} fps na 0,20 g)`);
        const o = num(g2) && W.sameEnergyFps(e.fps, num(g), num(g2));
        if (o) line(e1, `Na kulce ${num(g2)} g przy tej samej energii: ok. ${o.fps} fps.`);
        line(e1, 'Limity są typowe. Każde pole i organizator mają własny regulamin.', 'hint');
      });
      const gears = input('zębatki: napędzana/napędzająca, np. 30/10, 24/12, 40/12.5', '360px', '30/10, 24/12, 40/12.5');
      const rpm = input('obroty silnika', '120px', '30000');
      const mah = input('akumulator mAh', '120px', '1200');
      const amps = input('pobór A', '80px', '15');
      const e2 = el('div');
      live([gears, rpm, mah, amps], () => {
        e2.innerHTML = '';
        const pairs = gears.value.split(/;|,\s+/).map((p) => p.split('/').map((x) => Number(x.trim().replace(',', '.')))).filter((p) => p.length === 2);
        const ratio = W.gearRatio(pairs);
        if (ratio) line(e2, `Przełożenie ${ratio}:1 · szacowana szybkostrzelność ok. ${W.rof({ rpm: num(rpm), ratio }) ?? '?'} strz./s`, 'w-mid');
        const b = W.battery({ mAh: num(mah), amps: num(amps) });
        if (b) line(e2, `Akumulator: ok. ${b.minutes} min ciągłego ognia, ok. ${b.shots} strzałów.`);
      });
      body.append(el('div', 'sub', 'Energia kulki i limity:'), row(fps, g, g2), e1, el('div', 'sub', 'Gearbox i akumulator:'), row(gears), row(rpm, mah, amps), e2);
    },
  };

  const elec = {
    title: 'ELEKTRONIKA',
    glyph: 'Ω',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const U = input('U [V]', '80px');
      const I = input('I [A]', '80px');
      const R = input('R [Ω]', '80px');
      const P = input('P [W]', '80px');
      const o1 = el('div');
      live([U, I, R, P], () => {
        o1.innerHTML = '';
        const r = W.ohm({ U: num(U), I: num(I), R: num(R), P: num(P) });
        line(o1, r ? `U ${r.U} V · I ${r.I} A · R ${r.R} Ω · P ${r.P} W` : 'Wpisz dowolne dwie wartości.', r ? 'w-mid' : 'hint');
      });
      const sup = input('zasilanie V', '100px', '5');
      const vf = input('dioda V', '80px', '2.0');
      const ma = input('prąd mA', '80px', '20');
      const cnt = input('ile szeregowo', '100px', '1');
      const o2 = el('div');
      live([sup, vf, ma, cnt], () => {
        o2.innerHTML = '';
        const r = W.ledResistor({ supply: num(sup), vf: num(vf), mA: num(ma), count: num(cnt) || 1 });
        line(o2, r.error || `Rezystor ${r.R} Ω (wyliczone ${r.exact} Ω), prąd ${r.mA} mA, moc ${r.watts} W: wystarczy ${r.power}.`, r.error ? 'hint' : 'w-mid');
        if (!r.error) line(o2, `Paski: ${W.ohmsToBands(r.R)?.join(', ')}`);
      });
      const cols = W.COLORS.concat(['zloty', 'srebrny']);
      const b1 = select(W.COLORS, 'brazowy');
      const b2 = select(W.COLORS, 'czarny');
      const b3 = select(cols, 'czerwony');
      const b4 = select(['zloty', 'srebrny', 'brazowy', 'czerwony'], 'zloty');
      const o3 = el('div');
      live([b1, b2, b3, b4], () => {
        o3.innerHTML = '';
        const r = W.bandsToOhms([b1.value, b2.value, b3.value, b4.value]);
        if (r) line(o3, `${r.ohms >= 1e6 ? `${r.ohms / 1e6} MΩ` : r.ohms >= 1e3 ? `${r.ohms / 1e3} kΩ` : `${r.ohms} Ω`} ${r.tolerance}`, 'w-mid');
      });
      const dU = input('U wejście', '90px', '12');
      const r1 = input('R1 Ω', '90px', '10000');
      const r2 = input('R2 Ω', '90px', '4700');
      const o4 = el('div');
      live([dU, r1, r2], () => {
        o4.innerHTML = '';
        const r = W.divider({ U: num(dU), R1: num(r1), R2: num(r2) });
        if (r) line(o4, `Wyjście ${r.out} V, prąd ${r.current_mA} mA`, 'w-mid');
      });
      body.append(el('div', 'sub', 'Prawo Ohma (dowolne dwie):'), row(U, I, R, P), o1, el('div', 'sub', 'Rezystor do diody LED:'), row(sup, vf, ma, cnt), o2, el('div', 'sub', 'Paski rezystora:'), row(b1, b2, b3, b4), o3, el('div', 'sub', 'Dzielnik napięcia:'), row(dU, r1, r2), o4);
    },
  };

  const threads = {
    title: 'GWINTY I OTWORY',
    glyph: '⚙',
    build(body) {
      body.innerHTML = '';
      const t = el('table');
      t.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
      t.innerHTML = `<tr><th align="left">Gwint</th><th>Skok</th><th>Wiertło pod gwint</th><th>Przelotowy</th><th>Druk 3D: wkręt</th><th>Druk 3D: tulejka</th></tr>${Object.keys(W.THREADS).map((d) => {
        const r = W.thread(d);
        return `<tr><td>${r.name}</td><td align="center">${r.pitch}</td><td align="center">${r.tapDrill}</td><td align="center">${r.clearance}</td><td align="center">${r.print3d}</td><td align="center">${r.insertHole}</td></tr>`;
      }).join('')}`;
      body.append(el('div', 'sub', 'Wartości w mm. Otwory do druku to punkt wyjścia: zależą od drukarki i materiału.'), t);
    },
  };

  UI.extend('warsztat', { calc_asg: asg, calc_elec: elec, calc_threads: threads });
})();
