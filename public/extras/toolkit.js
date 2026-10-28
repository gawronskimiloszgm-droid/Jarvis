// Biblioteka narzedzi bez zaleznosci: kalkulator (bezpieczny parser, bez eval), konwersje
// jednostek, procenty, daty, hasla, UUID, base64, hash (SHA), JSON, regex, kolory, QR (generator
// wlasny), losowania. Czysty kod - uzywaja go modul Narzedzia, paleta Ctrl+K i narzedzia glosowe.
// Dostepne tez w Node (testy): module.exports.
(function (root) {
  const T = {};

  // ---------- kalkulator: parser rekurencyjny ----------
  const FN = {
    sqrt: Math.sqrt, abs: Math.abs, sin: (x) => Math.sin((x * Math.PI) / 180), cos: (x) => Math.cos((x * Math.PI) / 180), tan: (x) => Math.tan((x * Math.PI) / 180),
    ln: Math.log, log: Math.log10, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil, fact: (n) => { if (n < 0 || n > 170 || n !== Math.floor(n)) return NaN; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
  };
  const CONST = { pi: Math.PI, e: Math.E };
  T.calc = function calc(src) {
    const s = String(src).toLowerCase().replace(/,/g, '.').replace(/×|x(?=\s*\d)/g, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)\s*%\s*(?:z|of)\s+(\d+(?:\.\d+)?)/g, '($1/100*$2)');
    let i = 0;
    const peek = () => s[i];
    const ws = () => { while (s[i] === ' ') i++; };
    function num() {
      ws();
      const m = /^\d+(?:\.\d+)?(?:e[+-]?\d+)?/.exec(s.slice(i));
      if (m) { i += m[0].length; ws(); if (peek() === '%') { i++; return parseFloat(m[0]) / 100; } return parseFloat(m[0]); }
      const id = /^[a-z]+/.exec(s.slice(i));
      if (id) {
        i += id[0].length;
        if (id[0] in CONST) return CONST[id[0]];
        if (id[0] in FN) { ws(); if (peek() !== '(') throw new Error('Brak ( po ' + id[0]); i++; const v = expr(); ws(); if (peek() !== ')') throw new Error('Brak )'); i++; return FN[id[0]](v); }
        throw new Error('Nieznane: ' + id[0]);
      }
      throw new Error('Niepoprawne wyrazenie');
    }
    function unary() { ws(); if (peek() === '-') { i++; return -power(); } if (peek() === '+') { i++; return power(); } return power(); }
    function power() { let b = atom(); ws(); if (s.slice(i, i + 2) === '**') { i += 2; return Math.pow(b, unary()); } return b; }
    function atom() { ws(); if (peek() === '(') { i++; const v = expr(); ws(); if (peek() !== ')') throw new Error('Brak )'); i++; return v; } return num(); }
    function term() { let v = unary(); for (;;) { ws(); if (peek() === '*' && s[i + 1] !== '*') { i++; v *= unary(); } else if (peek() === '/') { i++; v /= unary(); } else if (peek() === '%' ) { i++; v %= unary(); } else return v; } }
    function expr() { let v = term(); for (;;) { ws(); if (peek() === '+') { i++; v += term(); } else if (peek() === '-') { i++; v -= term(); } else return v; } }
    const v = expr();
    ws();
    if (i < s.length) throw new Error('Nieoczekiwane: ' + s.slice(i, i + 5));
    if (!Number.isFinite(v)) throw new Error('Wynik nie jest liczba');
    return Math.round(v * 1e10) / 1e10;
  };

  // ---------- jednostki ----------
  const U = {
    dl: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, cal: 0.0254, ft: 0.3048, stopa: 0.3048, yd: 0.9144, mi: 1609.344, mila: 1609.344 },
    ma: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.0283495, lb: 0.45359237, funt: 0.45359237 },
    obj: { ml: 0.001, l: 1, litr: 1, m3: 1000, gal: 3.78541, galon: 3.78541, szklanka: 0.25, lyzka: 0.015, lyzeczka: 0.005 },
    pow: { m2: 1, ar: 100, ha: 10000, km2: 1e6, ft2: 0.092903, akr: 4046.86 },
    cz: { s: 1, sek: 1, min: 60, h: 3600, godz: 3600, d: 86400, dzien: 86400, tydz: 604800 },
    dane: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
    pred: { 'm/s': 1, 'km/h': 0.277778, mph: 0.44704, wezel: 0.514444 },
    cis: { pa: 1, hpa: 100, bar: 1e5, psi: 6894.76, atm: 101325 },
    ene: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6 },
  };
  T.convert = function convert(value, from, to) {
    const f = String(from).toLowerCase();
    const t = String(to).toLowerCase();
    const temp = { c: 1, f: 1, k: 1 };
    if (f in temp && t in temp) {
      const c = f === 'c' ? value : f === 'f' ? ((value - 32) * 5) / 9 : value - 273.15;
      const r = t === 'c' ? c : t === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
      return Math.round(r * 1e6) / 1e6;
    }
    for (const group of Object.values(U)) if (f in group && t in group) return Math.round(((value * group[f]) / group[t]) * 1e8) / 1e8;
    throw new Error(`Nie umiem przeliczyc ${from} na ${to}`);
  };
  T.UNITS = Object.values(U).flatMap((g) => Object.keys(g)).concat(['c', 'f', 'k']);
  // "10 km w mile", "5 kg to lb", "72 f na c"
  T.parseConvert = function parseConvert(text) {
    const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*([a-z0-9/]+)\s+(?:w|na|to|in|->|do)\s+([a-z0-9/]+)\s*$/i.exec(String(text));
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    try {
      return { value: v, from: m[2], to: m[3], result: T.convert(v, m[2], m[3]) };
    } catch {
      return null;
    }
  };

  // ---------- procenty, kredyt, oszczednosci ----------
  T.percent = {
    of: (p, x) => (p / 100) * x,
    what: (a, b) => (a / b) * 100,
    change: (from, to) => ((to - from) / from) * 100,
    discount: (price, pct) => ({ final: price * (1 - pct / 100), saved: (price * pct) / 100 }),
    vat: (net, rate = 23) => ({ gross: net * (1 + rate / 100), vat: (net * rate) / 100 }),
    fromGross: (gross, rate = 23) => ({ net: gross / (1 + rate / 100), vat: gross - gross / (1 + rate / 100) }),
  };
  T.loan = function loan(principal, ratePct, months) {
    const r = ratePct / 100 / 12;
    const pay = r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
    return { monthly: pay, total: pay * months, interest: pay * months - principal };
  };
  T.savings = function savings(start, monthly, ratePct, years) {
    const r = ratePct / 100 / 12;
    let bal = start;
    for (let m = 0; m < years * 12; m++) bal = bal * (1 + r) + monthly;
    const paid = start + monthly * years * 12;
    return { final: bal, paid, gain: bal - paid };
  };

  // ---------- daty ----------
  T.dateDiff = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  T.dateAdd = (a, n) => { const d = new Date(a + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const DOW = { nd: 0, niedziela: 0, pn: 1, poniedzialek: 1, wt: 2, wtorek: 2, sr: 3, sroda: 3, cz: 4, czwartek: 4, pt: 5, piatek: 5, sb: 6, sobota: 6 };
  // "za ile do piatku" -> dni; "data za 30 dni"
  T.daysUntilWeekday = (name, from = new Date()) => {
    const k = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(do|na)\s+/, '').replace(/(ego|a|e|u)$/, (m) => m);
    const key = Object.keys(DOW).find((n) => k.startsWith(n.slice(0, Math.max(2, Math.min(n.length, 4)))));
    if (key == null) return null;
    const d = (DOW[key] - from.getDay() + 7) % 7;
    return d === 0 ? 7 : d;
  };

  // ---------- losowanie ----------
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  T.dice = (sides = 6, count = 1) => Array.from({ length: Math.max(1, Math.min(20, count)) }, () => 1 + rnd(Math.max(2, Math.min(1000, sides))));
  T.coin = () => (rnd(2) ? 'orzel' : 'reszka');
  T.pick = (list) => (list.length ? list[rnd(list.length)] : null);
  T.password = function password(len = 16, opts = {}) {
    const sets = [opts.lower !== false && 'abcdefghijkmnopqrstuvwxyz', opts.upper !== false && 'ABCDEFGHJKLMNPQRSTUVWXYZ', opts.digits !== false && '23456789', opts.symbols && '!@#$%^&*-_=+?'].filter(Boolean);
    if (!sets.length) sets.push('abcdefghijkmnopqrstuvwxyz');
    const all = sets.join('');
    const L = Math.max(6, Math.min(128, len));
    const out = sets.map((s) => s[rnd(s.length)]);
    while (out.length < L) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  };
  T.uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  // ---------- kodowanie ----------
  const enc = new TextEncoder();
  T.b64 = { enc: (s) => btoa(String.fromCharCode(...enc.encode(s))), dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))) };
  T.url = { enc: encodeURIComponent, dec: decodeURIComponent };
  T.hash = async (text, algo = 'SHA-256') => [...new Uint8Array(await crypto.subtle.digest(algo, enc.encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  T.json = (text, indent = 2) => JSON.stringify(JSON.parse(text), null, indent);
  T.jsonMin = (text) => JSON.stringify(JSON.parse(text));
  T.regex = (pattern, flags, text) => {
    const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
    return [...String(text).matchAll(re)].slice(0, 200).map((m) => ({ match: m[0], index: m.index, groups: m.slice(1) }));
  };
  T.timestamp = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && String(v).trim() !== '') { const d = new Date(n < 1e12 ? n * 1000 : n); return { iso: d.toISOString(), local: d.toLocaleString('pl-PL') }; }
    const d = new Date(v);
    if (isNaN(d)) throw new Error('Nie rozpoznano daty');
    return { unix: Math.floor(d / 1000), ms: d.getTime(), iso: d.toISOString() };
  };
  T.words = (text) => {
    const t = String(text);
    const w = t.trim() ? t.trim().split(/\s+/).length : 0;
    return { slowa: w, znaki: t.length, znakiBezSpacji: t.replace(/\s/g, '').length, zdania: (t.match(/[.!?]+(\s|$)/g) || []).length, minutCzytania: Math.max(1, Math.round(w / 200)) };
  };

  // ---------- kolory ----------
  T.hexToRgb = (hex) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim()); if (!m) throw new Error('Zly kolor'); let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  T.rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  T.rgbToHsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]; };
  T.hslToHex = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return T.rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255); };
  T.palette = (hex) => { const [r, g, b] = T.hexToRgb(hex); const [h, s, l] = T.rgbToHsl(r, g, b); return { komplementarny: T.hslToHex((h + 180) % 360, s, l), triada: [T.hslToHex((h + 120) % 360, s, l), T.hslToHex((h + 240) % 360, s, l)], analogowe: [T.hslToHex((h + 30) % 360, s, l), T.hslToHex((h + 330) % 360, s, l)], jasny: T.hslToHex(h, s, Math.min(95, l + 25)), ciemny: T.hslToHex(h, s, Math.max(5, l - 25)) }; };
  // kontrast WCAG
  T.contrast = (hexA, hexB) => { const lum = (hex) => { const c = T.hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }; const a = lum(hexA), b = lum(hexB); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

  // ---------- czas strefowy ----------
  T.timeIn = (tz, date = new Date()) => new Intl.DateTimeFormat('pl-PL', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(date);
  T.CITIES = { warszawa: 'Europe/Warsaw', londyn: 'Europe/London', paryz: 'Europe/Paris', berlin: 'Europe/Berlin', nowyjork: 'America/New_York', 'nowy jork': 'America/New_York', losangeles: 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles', tokio: 'Asia/Tokyo', pekin: 'Asia/Shanghai', szanghaj: 'Asia/Shanghai', dubaj: 'Asia/Dubai', sydney: 'Australia/Sydney', moskwa: 'Europe/Moscow', kijow: 'Europe/Kyiv', rzym: 'Europe/Rome', madryt: 'Europe/Madrid', delhi: 'Asia/Kolkata', singapur: 'Asia/Singapore', chicago: 'America/Chicago', toronto: 'America/Toronto', 'sao paulo': 'America/Sao_Paulo', kair: 'Africa/Cairo' };

  // ---------- QR (generator wlasny, wersje 1-10, korekcja L, maski 0) ----------
  // Zwraca macierz [[bool]] - rysowanie po stronie wywolujacego.
  T.qr = (function () {
    // Tabele GF(256) do Reeda-Solomona.
    const EXP = new Array(512), LOG = new Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
    function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
    function rsEnc(data, n) { const g = rsGen(n); const res = new Array(n).fill(0); for (const d of data) { const f = d ^ res[0]; res.shift(); res.push(0); if (f) for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], f); } return res; }
    // [wersja] -> [ecBytesNaBlok, blokiG1, daneG1, blokiG2, daneG2] dla poziomu L
    const VER = { 1: [7, 1, 19, 0, 0], 2: [10, 1, 34, 0, 0], 3: [15, 1, 55, 0, 0], 4: [20, 1, 80, 0, 0], 5: [26, 1, 108, 0, 0], 6: [18, 2, 68, 0, 0], 7: [20, 2, 78, 0, 0], 8: [24, 2, 97, 0, 0], 9: [30, 2, 116, 0, 0], 10: [18, 2, 68, 2, 69] };
    const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
    return function qr(text) {
      const bytes = [...enc.encode(String(text))];
      let ver = 0;
      for (let v = 1; v <= 10; v++) { const [, b1, d1, b2, d2] = VER[v]; const cap = b1 * d1 + b2 * d2; if (bytes.length + 2 + (v > 9 ? 1 : 0) <= cap) { ver = v; break; } }
      if (!ver) throw new Error('Tekst za dlugi na kod QR (maks. ok. 270 znakow)');
      const [ecN, b1, d1, b2, d2] = VER[ver];
      const total = b1 * d1 + b2 * d2;
      // strumien bitow: tryb 0100, dlugosc, dane, terminator, dopelnienie
      const bits = [];
      const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
      put(4, 4); put(bytes.length, ver > 9 ? 16 : 8); bytes.forEach((b) => put(b, 8));
      put(0, Math.min(4, total * 8 - bits.length)); while (bits.length % 8) bits.push(0);
      const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
      for (let p = 0; data.length < total; p ^= 1) data.push(p ? 0x11 : 0xec);
      // bloki + korekcja
      const blocks = []; let off = 0;
      for (let i = 0; i < b1; i++) { blocks.push(data.slice(off, off + d1)); off += d1; }
      for (let i = 0; i < b2; i++) { blocks.push(data.slice(off, off + d2)); off += d2; }
      const ecs = blocks.map((b) => rsEnc(b, ecN));
      const stream = [];
      const maxD = Math.max(d1, d2 || 0);
      for (let i = 0; i < maxD; i++) blocks.forEach((b) => i < b.length && stream.push(b[i]));
      for (let i = 0; i < ecN; i++) ecs.forEach((e) => stream.push(e[i]));
      const size = 17 + ver * 4;
      const M = Array.from({ length: size }, () => new Array(size).fill(null));
      const set = (r, c, v) => { if (r >= 0 && c >= 0 && r < size && c < size) M[r][c] = v; };
      const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) set(r + i, c + j, i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4))); };
      finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
      for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
      const al = ALIGN[ver];
      al.forEach((r) => al.forEach((c) => { if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) return; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }));
      set(size - 8, 8, true);
      // zarezerwuj obszary formatu (i wersji)
      const reserved = M.map((row) => row.map((v) => v !== null));
      // Format: pierwsza kopia to wiersz i kolumna 8 (po 9 modulow), druga to 8 modulow w wierszu 8
      // przy prawej krawedzi i 7 w kolumnie 8 przy dolnej (modul "ciemny" jest juz ustawiony).
      for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true; }
      for (let i = 0; i < 8; i++) reserved[8][size - 1 - i] = true;
      for (let i = 0; i < 7; i++) reserved[size - 1 - i][8] = true;
      if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { reserved[i][size - 11 + j] = true; reserved[size - 11 + j][i] = true; }
      // dane: zygzak od prawego dolnego rogu, maska 0 ((r+c)%2==0)
      const allBits = []; stream.forEach((b) => { for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1); });
      let bi = 0, up = true;
      for (let c = size - 1; c > 0; c -= 2) {
        if (c === 6) c--;
        for (let k = 0; k < size; k++) {
          const r = up ? size - 1 - k : k;
          for (const cc of [c, c - 1]) {
            if (reserved[r][cc]) continue;
            let bit = bi < allBits.length ? allBits[bi++] : 0;
            if ((r + cc) % 2 === 0) bit ^= 1;
            M[r][cc] = Boolean(bit);
          }
        }
        up = !up;
      }
      // informacja o formacie: poziom L (01), maska 0 (000) -> BCH
      const fmtData = (1 << 3) | 0;
      let rem = fmtData << 10;
      for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
      const fmt = ((fmtData << 10) | rem) ^ 0x5412;
      const bitAt = (i) => Boolean((fmt >> i) & 1);
      // Pierwsza kopia przy lewym gornym znaczniku (x = kolumna, y = wiersz -> M[y][x]).
      for (let i = 0; i <= 5; i++) M[i][8] = bitAt(i);
      M[7][8] = bitAt(6);
      M[8][8] = bitAt(7);
      M[8][7] = bitAt(8);
      for (let i = 9; i < 15; i++) M[8][14 - i] = bitAt(i);
      // Druga kopia: pod lewym gornym znacznikiem i przy prawym gornym.
      for (let i = 0; i < 8; i++) M[8][size - 1 - i] = bitAt(i);
      for (let i = 8; i < 15; i++) M[size - 15 + i][8] = bitAt(i);
      M[size - 8][8] = true;
      if (ver >= 7) {
        let r2 = ver << 12;
        for (let i = 17; i >= 12; i--) if ((r2 >> i) & 1) r2 ^= 0x1f25 << (i - 12);
        const vi = (ver << 12) | r2;
        for (let i = 0; i < 18; i++) { const v = Boolean((vi >> i) & 1); M[Math.floor(i / 3)][size - 11 + (i % 3)] = v; M[size - 11 + (i % 3)][Math.floor(i / 3)] = v; }
      }
      return M.map((row) => row.map(Boolean));
    };
  })();

  if (typeof module !== 'undefined' && module.exports) module.exports = T;
  else root.Toolkit = T;
})(typeof window !== 'undefined' ? window : globalThis);
