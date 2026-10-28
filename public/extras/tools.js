// Modul "Narzedzia": kalkulator, konwerter, finanse, daty, losowanie, hasla/UUID, kodowanie,
// JSON, regex, kolory, licznik slow, QR, zegary swiata i kursy walut. Logika w toolkit.js.
(function () {
  const UI = window.JarvisUI;
  const T = window.Toolkit;
  if (!UI || !T) return;
  const { el, toast, api } = UI;

  const input = (ph, type = 'text', val = '') => {
    const i = el('input', 'inp');
    i.type = type;
    i.placeholder = ph;
    i.value = val;
    return i;
  };
  const row = (...kids) => {
    const r = el('div', 'field');
    r.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0';
    r.append(...kids);
    return r;
  };
  const out = () => {
    const o = el('div', 'vout');
    o.style.cssText = 'margin-top:6px;font-family:var(--mono);';
    return o;
  };
  const btn = (label, fn, cls = 'btn') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      try {
        fn();
      } catch (e) {
        toast(e.message || String(e));
      }
    });
    return b;
  };
  const copyBtn = (get) => btn('KOPIUJ', async () => {
    await navigator.clipboard.writeText(String(get()));
    toast('Skopiowano.', 'ok');
  }, 'btn ghost');
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6));
  const money = (n) => n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const panels = {};
  const add = (id, title, glyph, build, wide = false) => {
    panels[id] = { title, glyph, wide, build(body) { body.innerHTML = ''; build(body); } };
  };

  // ---------- kalkulator ----------
  add('tcalc', 'KALKULATOR', '＝', (b) => {
    const i = input('np. 2+2*3, (5+3)^2, sqrt(81), 15% z 240, sin(30)');
    i.style.flex = '1 1 260px';
    const o = el('div', 'w-big');
    const hist = el('div', 'w-list');
    const hs = [];
    const run = () => {
      try {
        const r = T.calc(i.value);
        o.textContent = fmt(r);
        hs.unshift(`${i.value} = ${fmt(r)}`);
        hist.innerHTML = '';
        hs.slice(0, 6).forEach((h) => hist.appendChild(el('div', null, h)));
      } catch (e) {
        o.textContent = '…';
        toast(e.message);
      }
    };
    i.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    b.append(row(i, btn('LICZ', run, 'btn primary'), copyBtn(() => o.textContent)), o, hist);
  });

  // ---------- konwerter ----------
  add('tconv', 'KONWERTER JEDNOSTEK', '⇄', (b) => {
    const v = input('wartosc', 'number', '1');
    v.style.maxWidth = '110px';
    const mk = (def) => {
      const s = el('select', 'inp');
      ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'mg', 'g', 'kg', 't', 'oz', 'lb', 'ml', 'l', 'gal', 's', 'min', 'h', 'd', 'b', 'kb', 'mb', 'gb', 'tb', 'm/s', 'km/h', 'mph', 'hpa', 'bar', 'psi', 'j', 'kj', 'kcal', 'kwh', 'c', 'f', 'k'].forEach((u) => {
        const o = el('option', null, u);
        o.value = u;
        s.appendChild(o);
      });
      s.value = def;
      return s;
    };
    const from = mk('km');
    const to = mk('mi');
    const o = el('div', 'w-big');
    const run = () => {
      try {
        o.textContent = `${fmt(Number(v.value))} ${from.value} = ${fmt(T.convert(Number(v.value), from.value, to.value))} ${to.value}`;
      } catch (e) {
        o.textContent = e.message;
      }
    };
    [v, from, to].forEach((x) => x.addEventListener('input', run));
    run();
    b.append(row(v, from, el('span', 'w-dim', '→'), to), o);
  });

  // ---------- finanse ----------
  add('tmoney', 'PROCENTY, VAT, KREDYT', '％', (b) => {
    const a = input('kwota', 'number', '1000');
    const p = input('procent', 'number', '23');
    const o = out();
    const show = (lines) => (o.innerHTML = lines.join('<br>'));
    b.append(
      row(a, p),
      row(
        btn('% z kwoty', () => show([`${fmt(Number(p.value))}% z ${fmt(Number(a.value))} = ${money(T.percent.of(Number(p.value), Number(a.value)))}`])),
        btn('RABAT', () => { const r = T.percent.discount(Number(a.value), Number(p.value)); show([`Cena po rabacie: ${money(r.final)}`, `Oszczednosc: ${money(r.saved)}`]); }),
        btn('NETTO → BRUTTO', () => { const r = T.percent.vat(Number(a.value), Number(p.value)); show([`Brutto: ${money(r.gross)}`, `VAT: ${money(r.vat)}`]); }),
        btn('BRUTTO → NETTO', () => { const r = T.percent.fromGross(Number(a.value), Number(p.value)); show([`Netto: ${money(r.net)}`, `VAT: ${money(r.vat)}`]); })
      )
    );
    const l1 = input('kredyt: kwota', 'number', '200000');
    const l2 = input('oprocentowanie %', 'number', '7');
    const l3 = input('miesiecy', 'number', '240');
    b.append(row(l1, l2, l3, btn('RATA', () => { const r = T.loan(Number(l1.value), Number(l2.value), Number(l3.value)); show([`Rata: ${money(r.monthly)}`, `Razem: ${money(r.total)}`, `Odsetki: ${money(r.interest)}`]); }, 'btn primary')));
    const s1 = input('oszczednosci: start', 'number', '0');
    const s2 = input('wplata miesiecznie', 'number', '500');
    const s3 = input('zysk % rocznie', 'number', '5');
    const s4 = input('lat', 'number', '10');
    b.append(row(s1, s2, s3, s4, btn('OSZCZEDNOSCI', () => { const r = T.savings(Number(s1.value), Number(s2.value), Number(s3.value), Number(s4.value)); show([`Po ${s4.value} latach: ${money(r.final)}`, `Wplacone: ${money(r.paid)}`, `Zysk: ${money(r.gain)}`]); }, 'btn primary')), o);
  });

  // ---------- daty ----------
  add('tdate', 'DATY', '📅', (b) => {
    const d1 = input('', 'date', UI.dayKey(new Date()));
    const d2 = input('', 'date', UI.addDays(UI.dayKey(new Date()), 30));
    const n = input('dni', 'number', '30');
    const o = out();
    b.append(
      row(d1, d2, btn('ROZNICA', () => { const x = T.dateDiff(d1.value, d2.value); o.textContent = `${Math.abs(x)} dni (${Math.round(Math.abs(x) / 7 * 10) / 10} tyg.) ${x >= 0 ? 'w przod' : 'wstecz'}`; })),
      row(n, btn('DODAJ DNI DO PIERWSZEJ', () => (o.textContent = T.dateAdd(d1.value, Number(n.value)))), btn('DZIEN TYGODNIA', () => (o.textContent = ['niedziela', 'poniedzialek', 'wtorek', 'sroda', 'czwartek', 'piatek', 'sobota'][new Date(d1.value + 'T12:00:00').getDay()]))),
      o
    );
    const ts = input('timestamp albo data (np. 1767225600)');
    ts.style.flex = '1 1 220px';
    const o2 = out();
    b.append(row(ts, btn('PRZELICZ', () => (o2.textContent = JSON.stringify(T.timestamp(ts.value), null, 1)))), o2);
  });

  // ---------- losowanie ----------
  add('trand', 'LOSOWANIE', '🎲', (b) => {
    const sides = input('scian', 'number', '6');
    sides.style.maxWidth = '90px';
    const cnt = input('ile', 'number', '2');
    cnt.style.maxWidth = '80px';
    const o = el('div', 'w-big');
    const list = el('textarea', 'inp');
    list.rows = 3;
    list.placeholder = 'Lista opcji (po jednej w wierszu) - wylosuje jedna';
    b.append(
      row(sides, cnt, btn('RZUC KOSTKA', () => { const r = T.dice(Number(sides.value), Number(cnt.value)); o.textContent = `${r.join(' + ')} = ${r.reduce((x, y) => x + y, 0)}`; }, 'btn primary'), btn('MONETA', () => (o.textContent = T.coin()))),
      list,
      row(btn('LOSUJ Z LISTY', () => (o.textContent = T.pick(list.value.split('\n').map((x) => x.trim()).filter(Boolean)) || 'Pusta lista')), btn('POMIESZAJ', () => { const a = list.value.split('\n').filter((x) => x.trim()); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } list.value = a.join('\n'); })),
      o
    );
  });

  // ---------- haslo / uuid ----------
  add('tpass', 'HASLO I UUID', '🔑', (b) => {
    const len = input('dlugosc', 'number', '18');
    len.style.maxWidth = '90px';
    const sym = el('input');
    sym.type = 'checkbox';
    sym.checked = true;
    const o = el('div', 'w-mid');
    o.style.cssText = 'font-family:var(--mono);word-break:break-all;margin:8px 0';
    const gen = () => (o.textContent = T.password(Number(len.value), { symbols: sym.checked }));
    gen();
    b.append(row(len, el('label', 'w-dim', ' symbole '), sym, btn('GENERUJ', gen, 'btn primary'), btn('UUID', () => (o.textContent = T.uuid())), copyBtn(() => o.textContent)), o, el('div', 'sub', 'Generowane lokalnie, nic nie jest wysylane ani zapisywane.'));
  });

  // ---------- kodowanie ----------
  add('tenc', 'BASE64, URL, HASH', '⌗', (b) => {
    const i = el('textarea', 'inp');
    i.rows = 3;
    i.placeholder = 'Tekst';
    const o = out();
    o.style.wordBreak = 'break-all';
    const set = (p) => p.then((v) => (o.textContent = v)).catch((e) => toast(e.message));
    b.append(
      i,
      row(
        btn('BASE64 →', () => (o.textContent = T.b64.enc(i.value))),
        btn('← BASE64', () => (o.textContent = T.b64.dec(i.value.trim()))),
        btn('URL →', () => (o.textContent = T.url.enc(i.value))),
        btn('← URL', () => (o.textContent = T.url.dec(i.value))),
        btn('SHA-256', () => set(T.hash(i.value))),
        btn('SHA-1', () => set(T.hash(i.value, 'SHA-1'))),
        copyBtn(() => o.textContent)
      ),
      o
    );
  });

  // ---------- JSON ----------
  add('tjson', 'FORMATOWANIE JSON', '{}', (b) => {
    const i = el('textarea', 'inp');
    i.rows = 6;
    i.placeholder = '{"klucz": [1, 2, 3]}';
    b.append(i, row(btn('FORMATUJ', () => (i.value = T.json(i.value)), 'btn primary'), btn('MINIFIKUJ', () => (i.value = T.jsonMin(i.value))), copyBtn(() => i.value)));
  });

  // ---------- regex ----------
  add('tregex', 'TESTER REGEX', '.*', (b) => {
    const p = input('wzorzec, np. (\\d+)-(\\d+)');
    const f = input('flagi', 'text', 'i');
    f.style.maxWidth = '70px';
    const t = el('textarea', 'inp');
    t.rows = 3;
    t.placeholder = 'Tekst do przeszukania';
    const o = out();
    const run = () => {
      try {
        const m = T.regex(p.value, f.value, t.value);
        o.textContent = m.length ? m.map((x) => `[${x.index}] "${x.match}"${x.groups.length ? ' grupy: ' + x.groups.join(' | ') : ''}`).join('\n') : 'Brak dopasowan';
        o.style.whiteSpace = 'pre-wrap';
      } catch (e) {
        o.textContent = e.message;
      }
    };
    [p, f, t].forEach((x) => x.addEventListener('input', run));
    b.append(row(p, f), t, o);
  });

  // ---------- kolory ----------
  add('tcolor', 'KOLORY I PALETA', '🎨', (b) => {
    const c = input('', 'color', '#33e0ff');
    c.style.cssText = 'width:60px;height:36px;padding:2px';
    const h = input('#33e0ff', 'text', '#33e0ff');
    h.style.maxWidth = '110px';
    const o = el('div');
    const run = () => {
      try {
        const hex = h.value;
        const [r, g, bl] = T.hexToRgb(hex);
        const [hh, s, l] = T.rgbToHsl(r, g, bl);
        const pal = T.palette(hex);
        o.innerHTML = '';
        o.appendChild(el('div', 'w-dim', `RGB ${r}, ${g}, ${bl} · HSL ${hh}°, ${s}%, ${l}% · kontrast z bialym ${T.contrast(hex, '#ffffff').toFixed(2)}, z czarnym ${T.contrast(hex, '#000000').toFixed(2)}`));
        const sw = el('div', 'field');
        sw.style.cssText = 'gap:6px;margin-top:8px;flex-wrap:wrap';
        [['kolor', hex], ['jasny', pal.jasny], ['ciemny', pal.ciemny], ['komplementarny', pal.komplementarny], ['triada 1', pal.triada[0]], ['triada 2', pal.triada[1]], ['analogowy 1', pal.analogowe[0]], ['analogowy 2', pal.analogowe[1]]].forEach(([n, col]) => {
          const s2 = el('button', null, col);
          s2.title = n;
          s2.style.cssText = `background:${col};color:${T.contrast(col, '#000000') > 7 ? '#000' : '#fff'};border:1px solid var(--line-3);border-radius:6px;padding:10px 8px;font-family:var(--mono);font-size:11px;cursor:pointer`;
          s2.addEventListener('click', async () => {
            await navigator.clipboard.writeText(col);
            toast(`Skopiowano ${col}`, 'ok');
          });
          sw.appendChild(s2);
        });
        o.appendChild(sw);
      } catch (e) {
        o.textContent = e.message;
      }
    };
    c.addEventListener('input', () => {
      h.value = c.value;
      run();
    });
    h.addEventListener('input', () => {
      try {
        T.hexToRgb(h.value);
        c.value = h.value.length === 4 ? '#' + [...h.value.slice(1)].map((x) => x + x).join('') : h.value;
        run();
      } catch {
        /* wpisywanie w toku */
      }
    });
    run();
    b.append(row(c, h), o);
  });

  // ---------- licznik slow ----------
  add('twords', 'LICZNIK SLOW', '¶', (b) => {
    const t = el('textarea', 'inp');
    t.rows = 5;
    t.placeholder = 'Wklej tekst...';
    const o = out();
    t.addEventListener('input', () => {
      const w = T.words(t.value);
      o.textContent = `${w.slowa} slow · ${w.znaki} znakow (${w.znakiBezSpacji} bez spacji) · ${w.zdania} zdan · ok. ${w.minutCzytania} min czytania`;
    });
    b.append(t, o);
  });

  // ---------- QR ----------
  add('tqr', 'KOD QR', '▩', (b) => {
    const t = input('Tekst albo adres (do ok. 270 znakow)', 'text', 'https://jarvis-u4vw.onrender.com');
    t.style.flex = '1 1 260px';
    const cv = el('canvas');
    cv.style.cssText = 'display:block;margin:10px 0;image-rendering:pixelated;background:#fff;border-radius:6px';
    const draw = () => {
      const m = T.qr(t.value || ' ');
      const q = 4;
      const sc = Math.max(3, Math.floor(280 / (m.length + q * 2)));
      cv.width = cv.height = (m.length + q * 2) * sc;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#000';
      m.forEach((r, y) => r.forEach((v, x) => v && g.fillRect((x + q) * sc, (y + q) * sc, sc, sc)));
    };
    t.addEventListener('input', () => {
      try {
        draw();
      } catch (e) {
        toast(e.message);
      }
    });
    const save = btn('POBIERZ PNG', () => {
      const a = el('a');
      a.href = cv.toDataURL('image/png');
      a.download = 'qr.png';
      a.click();
    }, 'btn ghost');
    try {
      const pre = sessionStorage.getItem('jarvis.qrText'); // z palety: "qr tekst"
      if (pre) {
        sessionStorage.removeItem('jarvis.qrText');
        t.value = pre;
      }
    } catch {
      /* brak sessionStorage */
    }
    draw();
    b.append(row(t, save), cv);
    UI.qrCanvas = cv;
  });

  // ---------- zegary swiata ----------
  add('tworld', 'ZEGARY SWIATA', '🌐', (b) => {
    const list = el('div', 'w-list');
    const key = 'jarvis.worldClocks';
    const get = () => {
      try {
        return JSON.parse(localStorage.getItem(key)) || ['warszawa', 'londyn', 'nowy jork', 'tokio'];
      } catch {
        return ['warszawa', 'londyn', 'nowy jork', 'tokio'];
      }
    };
    const set = (v) => {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* do zamkniecia karty */
      }
    };
    const draw = () => {
      list.innerHTML = '';
      get().forEach((c) => {
        const it = el('div', 'it');
        const x = el('button', 'row-x', '×');
        x.addEventListener('click', () => {
          set(get().filter((y) => y !== c));
          draw();
        });
        const r = el('span', null, T.timeIn(T.CITIES[c], new Date()));
        r.appendChild(x);
        it.append(el('span', null, c), r);
        list.appendChild(it);
      });
    };
    const sel = el('select', 'inp');
    Object.keys(T.CITIES).forEach((c) => {
      const o = el('option', null, c);
      o.value = c;
      sel.appendChild(o);
    });
    b.append(row(sel, btn('DODAJ', () => { const cur = get(); if (!cur.includes(sel.value)) set([...cur, sel.value]); draw(); }, 'btn primary')), list);
    draw();
    const t = setInterval(() => (document.body.contains(b) ? draw() : clearInterval(t)), 20000);
  });

  // ---------- waluty ----------
  add('tfx', 'KURSY WALUT', '€', (b) => {
    const amt = input('kwota', 'number', '100');
    amt.style.maxWidth = '110px';
    const mk = (d) => {
      const s = el('select', 'inp');
      ['PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'NOK', 'SEK', 'JPY', 'CAD', 'AUD', 'UAH'].forEach((c) => {
        const o = el('option', null, c);
        o.value = c;
        s.appendChild(o);
      });
      s.value = d;
      return s;
    };
    const from = mk('EUR');
    const to = mk('PLN');
    const o = el('div', 'w-big');
    const run = async () => {
      o.textContent = '...';
      try {
        if (from.value === to.value) return (o.textContent = fmt(Number(amt.value)));
        const r = await api(`/api/fx?amount=${encodeURIComponent(amt.value || 1)}&from=${from.value}&to=${to.value}`);
        o.textContent = `${money(Number(amt.value))} ${from.value} = ${money(r.result)} ${to.value}  (${r.date})`;
      } catch {
        o.textContent = 'Brak polaczenia z serwisem kursow.';
      }
    };
    [from, to].forEach((x) => x.addEventListener('change', run));
    amt.addEventListener('change', run);
    run();
    b.append(row(amt, from, el('span', 'w-dim', '→'), to, btn('ODSWIEZ', run, 'btn ghost')), o, el('div', 'sub', 'Kursy: Europejski Bank Centralny (frankfurter.app), dzienne.'));
  });

  UI.register({ id: 'tools', title: 'Narzedzia', sub: 'kalkulator, konwertery, QR...', icon: '⚙', owner: false, group: 'Glowne', panels });
})();
