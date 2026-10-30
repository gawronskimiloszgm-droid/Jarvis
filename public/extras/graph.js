// "Graf wiedzy": holograficzna sieć pojęć w 3D. Węzły to Twoje dane (pamięć Jarvisa, notatki, zakładki,
// cele, nawyki, tablica, fiszki, zadania, szybkie notatki, dziennik), powiązane wspólnymi słowami
// i kategoriami. Sterowanie: mysz/dotyk ORAZ gesty dłoni przez kamerę (MediaPipe Hands, logika w
// handgest.js): obrót otwartą dłonią, szczypnięcie = wybór, przytrzymanie = chwyt, szczypnięcie+ruch =
// przesuwanie, dwie dłonie = zoom. Kamera może być tłem (graf unosi się nad obrazem z kamery).
// Przy małej ilości danych pokazuje wbudowaną sieć demonstracyjną.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.register) return;
  const { el, api, toast, isOwner, deaccent } = UI;
  const G = window.HandGest;

  const MP_VER = '0.10.14';
  const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

  const CATS = {
    pamiec: ['PAMIĘĆ', '#33e0ff'], notatki: ['NOTATKI', '#ffb347'], zakladki: ['ZAKŁADKI', '#c58bff'], cele: ['CELE', '#5aff8c'],
    nawyki: ['NAWYKI', '#ff6b9d'], tablica: ['TABLICA', '#ffe14d'], fiszki: ['FISZKI', '#7aa8ff'], zadania: ['ZADANIA', '#ffffff'], dziennik: ['DZIENNIK', '#9fd8e8'],
    psych: ['PSYCHOLOGIA', '#ff6b9d'], fiz: ['FIZYKA', '#33e0ff'], sys: ['SYSTEMY', '#5aff8c'], eko: ['EKONOMIA', '#ffe14d'], tech: ['TECHNOLOGIA', '#7aa8ff'], filo: ['FILOZOFIA', '#c58bff'],
  };

  // ---------- dane demonstracyjne (jak w pokazie: sieć pojęć) ----------
  const DEMO_NODES = [
    ['dis', 'psych', 'Dysonans poznawczy', 'Napięcie, gdy mamy sprzeczne przekonania. Mózg dąży do jego zmniejszenia - często przez zmianę przekonań, nie faktów.'],
    ['bias', 'psych', 'Błędy poznawcze', 'Systematyczne odchylenia w ocenie i decyzjach: efekt potwierdzenia, kotwiczenia, dostępności.'],
    ['heur', 'psych', 'Heurystyki', 'Skróty myślowe, które oszczędzają energię kosztem dokładności.'],
    ['sys1', 'psych', 'System 1 i 2', 'Szybkie, intuicyjne myślenie kontra wolne, analityczne. Źródło większości błędów poznawczych.'],
    ['uwaga', 'psych', 'Uwaga', 'Ograniczony zasób. To, na co patrzymy, kształtuje to, co uważamy za ważne.'],
    ['pam', 'psych', 'Pamięć robocza', 'Mieści kilka elementów naraz. Dlatego listy i notatki zwiększają nasze możliwości.'],
    ['rel', 'fiz', 'Względność', 'Czas i przestrzeń zależą od układu odniesienia. Prędkość światła jest stała dla wszystkich.'],
    ['ent', 'fiz', 'Entropia', 'Miara nieuporządkowania. W układzie izolowanym nie maleje.'],
    ['term', 'fiz', 'Termodynamika', 'Energia, ciepło i praca. Zasady, które ograniczają każdą maszynę.'],
    ['kwant', 'fiz', 'Mechanika kwantowa', 'Na małą skalę rzeczywistość jest probabilistyczna, a pomiar zmienia stan układu.'],
    ['chaos', 'fiz', 'Chaos deterministyczny', 'Drobna zmiana warunków początkowych daje zupełnie inny wynik. Pogody nie da się przewidzieć daleko w przód.'],
    ['emerg', 'sys', 'Emergencja', 'Złożone zjawiska powstają z prostych reguł: mrowisko, mózg, rynek. Całość jest czymś więcej niż sumą części.'],
    ['feed', 'sys', 'Sprzężenie zwrotne', 'Wynik działania wraca jako wejście. Dodatnie wzmacnia, ujemne stabilizuje.'],
    ['homeo', 'sys', 'Homeostaza', 'Utrzymywanie równowagi przez sprzężenia ujemne. Od termostatu po temperaturę ciała.'],
    ['siec', 'sys', 'Teoria sieci', 'Struktura połączeń decyduje o zachowaniu systemu. Huby, klastry, małe światy.'],
    ['anty', 'sys', 'Antykruchość', 'Systemy, które zyskują na wstrząsach. Więcej niż odporność: wzmacniają się przez stres.'],
    ['ewol', 'sys', 'Ewolucja', 'Zmienność, dobór, dziedziczenie. Algorytm optymalizujący bez projektanta.'],
    ['rynek', 'eko', 'Rynek', 'Zdecentralizowany system cen, który agreguje wiedzę milionów ludzi.'],
    ['inc', 'eko', 'Bodźce', 'Ludzie reagują na zachęty. Zła struktura bodźców psuje nawet dobre cele.'],
    ['kosz', 'eko', 'Koszt alternatywny', 'Prawdziwy koszt wyboru to najlepsza opcja, z której zrezygnowano.'],
    ['teor', 'eko', 'Teoria gier', 'Strategiczne decyzje, gdy wynik zależy od wyborów innych. Równowaga Nasha.'],
    ['tragedia', 'eko', 'Tragedia wspólnot', 'Indywidualna racjonalność niszczy wspólne zasoby, jeśli nikt ich nie pilnuje.'],
    ['ai', 'tech', 'Sztuczna inteligencja', 'Systemy uczące się wzorców z danych. Skuteczne, ale często nieprzejrzyste.'],
    ['nn', 'tech', 'Sieci neuronowe', 'Warstwy prostych jednostek, które razem uczą się złożonych funkcji.'],
    ['info', 'tech', 'Teoria informacji', 'Informacja to redukcja niepewności. Entropia Shannona łączy fizykę i komunikację.'],
    ['krypto', 'tech', 'Kryptografia', 'Matematyka tajności i zaufania. Podstawa współczesnego internetu.'],
    ['alg', 'tech', 'Algorytmy', 'Skończone przepisy rozwiązywania problemów. Złożoność decyduje o tym, co jest wykonalne.'],
    ['ep', 'filo', 'Epistemologia', 'Co wiemy i skąd to wiemy. Granice poznania i uzasadnienia.'],
    ['okam', 'filo', 'Brzytwa Ockhama', 'Nie mnóż bytów ponad potrzebę. Proste wyjaśnienie wygrywa, gdy tłumaczy tyle samo.'],
    ['stoic', 'filo', 'Stoicyzm', 'Skup się na tym, na co masz wpływ. Reszta to hałas.'],
    ['wola', 'filo', 'Wolna wola', 'Czy wybieramy, czy tylko zachodzą procesy fizyczne. Spór determinizmu z kompatybilizmem.'],
    ['swiad', 'filo', 'Świadomość', 'Doświadczenie subiektywne. Trudny problem: dlaczego procesy mózgu mają "jak to jest".'],
  ];
  const DEMO_EDGES = 'dis-bias dis-sys1 bias-heur heur-sys1 sys1-uwaga uwaga-pam bias-ep rel-ent ent-term ent-info ent-chaos term-feed kwant-info kwant-swiad chaos-emerg emerg-siec emerg-ewol emerg-rynek feed-homeo feed-ai homeo-anty anty-chaos anty-ewol siec-rynek siec-nn rynek-inc rynek-teor inc-teor teor-tragedia tragedia-inc kosz-inc kosz-stoic ai-nn ai-alg ai-swiad nn-pam info-krypto krypto-alg alg-info ep-okam ep-wola wola-swiad wola-chaos stoic-wola stoic-uwaga okam-heur okam-ai rel-kwant ewol-bias'.split(' ').map((s) => s.split('-'));

  // ---------- słowa kluczowe do łączenia danych ----------
  const STOP = new Set('oraz ktory ktora ktore tylko jeszcze bardzo takze dlatego wiec albo gdzie kiedy ponizej powyzej mozna trzeba jest byly byla bedzie sobie swoje swoja przez przed po nad pod ktorego tego tamten tutaj teraz dzis jutro wczoraj zrobic mam mamy musze chce chcemy moje moja moj'.split(' '));
  const words = (t) => [...new Set(deaccent(String(t || '').toLowerCase()).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w)))];

  // ---------- budowa grafu z danych użytkownika ----------
  async function collect() {
    const L = UI.life;
    const safe = (p, d) => p.catch(() => d);
    const [mem, notes, todos, bm, goals, habits, kan, cards, qn, jr] = await Promise.all([
      safe(api('/api/memory'), {}), safe(api('/api/notes'), {}), safe(api('/api/todos'), {}),
      safe(L.list('bookmarks', true), []), safe(L.list('goals', true), []), safe(L.list('habits', true), []), safe(L.list('kanban', true), []),
      safe(L.list('flashcards', true), []), safe(L.list('quicknotes', true), []), safe(L.list('journal', true), []),
    ]);
    const out = [];
    const add = (cat, label, text, tags) => out.push({ cat, label: String(label).slice(0, 48), text: String(text || label).slice(0, 400), tags: tags || [] });
    (mem.facts || []).slice(0, 60).forEach((f) => { const t = typeof f === 'string' ? f : f.text || ''; if (t) add('pamiec', t.length > 40 ? t.slice(0, 38) + '…' : t, t); });
    (notes.notes || []).slice(0, 40).forEach((n) => add('notatki', n.tytul, `${n.tytul}. ${n.streszczenie || ''}`));
    bm.slice(0, 40).forEach((b) => add('zakladki', b.title, `${b.title} - ${b.url}`, b.tags));
    goals.slice(0, 30).forEach((g) => add('cele', g.text, `Cel: ${g.text} (${g.progress || 0}/${g.target || 100} ${g.unit || ''})`));
    habits.slice(0, 30).forEach((h) => add('nawyki', h.name, `Nawyk: ${h.name}. Seria: ${UI.habitStreak ? UI.habitStreak(h.days) : 0} dni.`));
    kan.slice(0, 40).forEach((k) => add('tablica', k.text, `${k.text}${k.note ? '. ' + k.note : ''} [${k.col}]`));
    const decks = {};
    cards.slice(0, 80).forEach((c) => { (decks[c.deck] = decks[c.deck] || []).push(c); });
    Object.entries(decks).forEach(([d, cs]) => add('fiszki', `Talia: ${d}`, cs.slice(0, 4).map((c) => `${c.q} → ${c.a}`).join(' | '), [d]));
    (todos.todos || []).filter((t) => !t.done).slice(0, 30).forEach((t) => add('zadania', t.text, t.text));
    qn.slice(0, 30).forEach((n) => add('notatki', n.text.length > 40 ? n.text.slice(0, 38) + '…' : n.text, n.text));
    jr.filter((e) => e.kind === 'manual').slice(0, 25).forEach((e) => add('dziennik', e.text.length > 40 ? e.text.slice(0, 38) + '…' : e.text, e.text));
    return out;
  }

  function buildFromData(items) {
    const nodes = [];
    const edges = [];
    const hubs = {};
    const hub = (cat) => {
      if (!hubs[cat]) {
        hubs[cat] = nodes.length;
        nodes.push({ id: `hub:${cat}`, cat, label: CATS[cat][0], text: `Kategoria: ${CATS[cat][0]}`, hub: true });
      }
      return hubs[cat];
    };
    items.forEach((it, i) => {
      const idx = nodes.length;
      nodes.push({ id: `n${i}`, cat: it.cat, label: it.label, text: it.text, kw: words(`${it.label} ${it.text} ${(it.tags || []).join(' ')}`), tags: it.tags || [] });
      edges.push([hub(it.cat), idx, 1]);
    });
    // Powiązania między elementami: wspólne rzadkie słowa i tagi.
    const freq = {};
    nodes.forEach((n) => (n.kw || []).forEach((w) => (freq[w] = (freq[w] || 0) + 1)));
    const byWord = {};
    nodes.forEach((n, i) => (n.kw || []).forEach((w) => { if (freq[w] >= 2 && freq[w] <= 7) (byWord[w] = byWord[w] || []).push(i); }));
    const pair = new Map();
    Object.values(byWord).forEach((list) => {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const k = `${list[a]}-${list[b]}`;
        pair.set(k, (pair.get(k) || 0) + 1);
      }
    });
    const deg = {};
    [...pair.entries()].sort((x, y) => y[1] - x[1]).forEach(([k, w]) => {
      const [a, b] = k.split('-').map(Number);
      if ((deg[a] || 0) >= 5 || (deg[b] || 0) >= 5) return;
      deg[a] = (deg[a] || 0) + 1;
      deg[b] = (deg[b] || 0) + 1;
      edges.push([a, b, Math.min(3, w)]);
    });
    return { nodes, edges };
  }

  function buildDemo() {
    const idx = {};
    const nodes = DEMO_NODES.map(([id, cat, label, text], i) => {
      idx[id] = i;
      return { id, cat, label, text };
    });
    const edges = DEMO_EDGES.filter(([a, b]) => idx[a] != null && idx[b] != null).map(([a, b]) => [idx[a], idx[b], 1]);
    return { nodes, edges };
  }

  const spriteCache = {};
  function sprite(color) {
    if (spriteCache[color]) return spriteCache[color];
    const c0 = document.createElement('canvas');
    c0.width = c0.height = 64;
    const c = c0.getContext('2d');
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(0.18, color);
    gr.addColorStop(0.45, color + '66');
    gr.addColorStop(1, color + '00');
    c.fillStyle = gr;
    c.fillRect(0, 0, 64, 64);
    spriteCache[color] = c0;
    return c0;
  }

  // ---------- panel ----------
  const graph = {
    title: 'GRAF WIEDZY',
    glyph: '⌬',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostępne tylko dla właściciela.';
        return;
      }
      body.innerHTML = '';
      const wrap = el('div', 'gk');
      const video = el('video', 'gk-video');
      video.muted = true;
      video.playsInline = true;
      video.hidden = true;
      const cv = el('canvas', 'gk-canvas');
      const hud = el('div', 'gk-hud');
      const card = el('div', 'gk-card');
      card.hidden = true;
      wrap.append(video, cv, hud, card);
      body.appendChild(wrap);

      // ----- stan -----
      let nodes = [];
      let edges = [];
      let demo = false;
      const cam = { rx: -0.35, ry: 0.5, zoom: 1.35, px: 0, py: 0 };
      let selected = -1;
      let hover = -1;
      let query = '';
      let alpha = 1;
      let spin = true;
      let showLabels = true;
      let dragNode = -1;
      let W = 600;
      let H = 480;
      const pointer = { x: -999, y: -999, down: false, hand: false };
      const hand = { on: false, status: 'wyłączone', cursor: null, pinch: false, mode: 'none' };
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const g = cv.getContext('2d');
      const adj = () => nodes.map(() => []);
      let nbr = [];

      // ----- ładowanie i układ -----
      function setData(d, isDemo) {
        demo = isDemo;
        nodes = d.nodes;
        edges = d.edges;
        nbr = adj();
        edges.forEach(([a, b]) => {
          nbr[a].push(b);
          nbr[b].push(a);
        });
        nodes.forEach((n, i) => {
          const r = 150 + Math.random() * 60;
          const th = Math.random() * 6.283;
          const ph = Math.acos(2 * Math.random() - 1);
          n.x = r * Math.sin(ph) * Math.cos(th);
          n.y = r * Math.cos(ph);
          n.z = r * Math.sin(ph) * Math.sin(th);
          n.vx = n.vy = n.vz = 0;
          n.deg = nbr[i].length;
        });
        selected = hover = dragNode = -1;
        card.hidden = true;
        alpha = 1;
        for (let i = 0; i < 280; i++) physics(0.9 - i * 0.002);
        drawHud();
      }

      function physics(a) {
        const n = nodes.length;
        for (let i = 0; i < n; i++) {
          const p = nodes[i];
          for (let j = i + 1; j < n; j++) {
            const q = nodes[j];
            let dx = p.x - q.x;
            let dy = p.y - q.y;
            let dz = p.z - q.z;
            const d2 = dx * dx + dy * dy + dz * dz + 40;
            if (d2 > 90000) continue;
            const f = (1900 / d2) * a;
            const d = Math.sqrt(d2);
            dx = (dx / d) * f; dy = (dy / d) * f; dz = (dz / d) * f;
            p.vx += dx; p.vy += dy; p.vz += dz;
            q.vx -= dx; q.vy -= dy; q.vz -= dz;
          }
        }
        edges.forEach(([ai, bi, w]) => {
          const p = nodes[ai];
          const q = nodes[bi];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const dz = q.z - p.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const rest = 48 + (p.hub || q.hub ? 22 : 0);
          const f = ((d - rest) / d) * 0.05 * (1 + w * 0.25) * a;
          p.vx += dx * f; p.vy += dy * f; p.vz += dz * f;
          q.vx -= dx * f; q.vy -= dy * f; q.vz -= dz * f;
        });
        nodes.forEach((p, i) => {
          if (i === dragNode) {
            p.vx = p.vy = p.vz = 0;
            return;
          }
          p.vx -= p.x * 0.004 * a; p.vy -= p.y * 0.004 * a; p.vz -= p.z * 0.004 * a;
          p.vx *= 0.82; p.vy *= 0.82; p.vz *= 0.82;
          p.x += p.vx; p.y += p.vy; p.z += p.vz;
        });
      }

      async function load(forceDemo) {
        let items = [];
        if (!forceDemo) items = await collect().catch(() => []);
        if (forceDemo || items.length < 8) {
          setData(buildDemo(), true);
          if (!forceDemo) toast('Za mało danych - pokazuję sieć demonstracyjną. Dodaj notatki, zakładki, cele...', 'ok');
        } else {
          setData(buildFromData(items), false);
        }
      }

      // ----- rzutowanie -----
      const D = 520;
      function view(p) {
        const cy = Math.cos(cam.ry), sy = Math.sin(cam.ry), cx = Math.cos(cam.rx), sx = Math.sin(cam.rx);
        const x1 = p.x * cy - p.z * sy;
        const z1 = p.x * sy + p.z * cy;
        const y1 = p.y * cx - z1 * sx;
        const z2 = p.y * sx + z1 * cx;
        const f = D / (D + z2 + 380);
        const s = cam.zoom * Math.min(W, H) * 0.0036 * 1.5;
        return { sx: W / 2 + cam.px + x1 * s * f * 1.0, sy: H / 2 + cam.py + y1 * s * f, f, z: z2, s: s * f };
      }
      // odwrotne rzutowanie: punkt ekranu na głębokości z2 -> współrzędne świata
      function unproject(sx, sy, z2) {
        const f = D / (D + z2 + 380);
        const s = cam.zoom * Math.min(W, H) * 0.0036 * 1.5 * f;
        const x1 = (sx - W / 2 - cam.px) / s;
        const y1 = (sy - H / 2 - cam.py) / s;
        const cy = Math.cos(cam.ry), sy_ = Math.sin(cam.ry), cx = Math.cos(cam.rx), sx_ = Math.sin(cam.rx);
        // cofnij obrót X: y1 = y cx - z1 sx, z2 = y sx + z1 cx
        const y = y1 * cx + z2 * sx_;
        const z1 = -y1 * sx_ + z2 * cx;
        // cofnij obrót Y
        const x = x1 * cy + z1 * sy_;
        const z = -x1 * sy_ + z1 * cy;
        return { x, y, z };
      }

      function pick(px, py) {
        let best = -1;
        let bd = 1e9;
        nodes.forEach((n, i) => {
          const v = view(n);
          const r = (n.hub ? 11 : 6 + Math.min(n.deg, 6) * 0.9) * v.f * Math.max(0.8, cam.zoom) + 9;
          const d = Math.hypot(v.sx - px, v.sy - py);
          if (d < r && d - r * 0.2 < bd) {
            bd = d - r * 0.2;
            best = i;
          }
        });
        return best;
      }

      // ----- rysowanie -----
      let t0 = performance.now();
      const dust = [];
      function matches(n) {
        return !query || deaccent(`${n.label} ${n.text}`.toLowerCase()).includes(query);
      }

      function frame(now) {
        if (!cv.isConnected) return stopHands();
        requestAnimationFrame(frame);
        if (cv.offsetParent === null || document.visibilityState !== 'visible') return;
        const rect = cv.getBoundingClientRect();
        if (Math.abs(rect.width - W) > 1 || Math.abs(rect.height - H) > 1 || cv.width !== Math.round(W * dpr)) {
          W = Math.max(200, rect.width);
          H = Math.max(200, rect.height);
          cv.width = Math.round(W * dpr);
          cv.height = Math.round(H * dpr);
        }
        const t = (now - t0) / 1000;
        if (alpha > 0.02) {
          physics(alpha);
          alpha *= 0.985;
        } else {
          physics(0.04); // delikatny ruch "unoszenia"
        }
        if (spin && !pointer.down && dragNode < 0 && !hand.on) cam.ry += 0.0016;

        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';

        const vs = nodes.map(view);
        const focus = selected >= 0 ? selected : hover;
        const near = new Set(focus >= 0 ? [focus, ...nbr[focus]] : []);

        // pył: drobne cząsteczki unoszące się w przestrzeni (antygrawitacja)
        if (!dust.length) for (let i = 0; i < 90; i++) dust.push({ x: Math.random(), y: Math.random(), s: 0.02 + Math.random() * 0.05, r: 0.6 + Math.random() * 1.4, a: 0.2 + Math.random() * 0.5 });
        dust.forEach((d) => {
          d.y -= d.s * 0.016;
          if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
          g.fillStyle = `rgba(190,235,255,${d.a})`;
          g.fillRect(d.x * W + Math.sin(t * 0.6 + d.x * 9) * 6 + cam.px * 0.05, d.y * H, d.r, d.r);
        });

        // krawędzie
        edges.forEach(([a, b, w], ei) => {
          const A = vs[a], B = vs[b];
          const hot = focus >= 0 && (a === focus || b === focus);
          const dim = (focus >= 0 && !hot) || (query && !(matches(nodes[a]) || matches(nodes[b])));
          const depth = Math.max(0.15, Math.min(1, (A.f + B.f) / 2 * 1.25));
          const al = (hot ? 0.95 : dim ? 0.06 : 0.34 + 0.1 * w) * depth;
          g.strokeStyle = hot ? `rgba(255,255,255,${al})` : `rgba(140,225,255,${al})`;
          g.lineWidth = hot ? 1.6 : 0.8 + w * 0.2;
          g.beginPath();
          g.moveTo(A.sx, A.sy);
          g.lineTo(B.sx, B.sy);
          g.stroke();
          // cząsteczki płynące po krawędzi
          if (hot || ei % 4 === 0) {
            const ph = (t * (hot ? 0.7 : 0.25) + ei * 0.37) % 1;
            g.fillStyle = hot ? 'rgba(255,255,255,.95)' : 'rgba(255,190,110,.7)';
            g.beginPath();
            g.arc(A.sx + (B.sx - A.sx) * ph, A.sy + (B.sy - A.sy) * ph, hot ? 2 : 1.3, 0, 6.283);
            g.fill();
          }
        });

        // węzły (od najdalszego)
        const order = nodes.map((_, i) => i).sort((p, q) => vs[q].z - vs[p].z);
        g.globalCompositeOperation = 'lighter';
        order.forEach((i) => {
          const n = nodes[i];
          const v = vs[i];
          const col = CATS[n.cat][1];
          const isFocus = i === focus;
          const dim = (focus >= 0 && !near.has(i)) || (query && !matches(n));
          const base = (n.hub ? 19 : 10 + Math.min(n.deg, 7) * 1.2) * v.f * Math.max(0.85, Math.sqrt(cam.zoom));
          const r = base * (isFocus ? 1.7 : 1) * (1 + 0.08 * Math.sin(t * 2 + i));
          g.globalAlpha = dim ? 0.16 : Math.max(0.35, Math.min(1, v.f * 1.3));
          const sp = sprite(col);
          g.drawImage(sp, v.sx - r * 2.2, v.sy - r * 2.2, r * 4.4, r * 4.4);
          if (isFocus || n.hub) {
            g.strokeStyle = col;
            g.lineWidth = 1.2;
            g.beginPath();
            g.arc(v.sx, v.sy, r * (isFocus ? 1.9 : 1.5), 0, 6.283);
            g.stroke();
          }
        });
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';

        // etykiety
        if (showLabels) {
          g.font = '600 11px Consolas, monospace';
          g.textBaseline = 'middle';
          order.forEach((i) => {
            const n = nodes[i];
            const v = vs[i];
            const show = i === focus || near.has(i) || n.hub || (query && matches(n)) || v.f > 0.86;
            if (!show || v.sx < -50 || v.sx > W + 50) return;
            const col = CATS[n.cat][1];
            g.fillStyle = i === focus ? '#ffffff' : col;
            g.globalAlpha = i === focus ? 1 : (focus >= 0 && !near.has(i) ? 0.25 : Math.max(0.4, (v.f - 0.7) * 2.2));
            g.fillText(n.label, v.sx + 12 * v.f + 4, v.sy - 11 * v.f);
          });
          g.globalAlpha = 1;
        }

        // kursor dłoni
        if (hand.on && hand.cursor) {
          const cx = hand.cursor.x * W;
          const cy = hand.cursor.y * H;
          g.strokeStyle = hand.pinch ? '#ffb347' : '#33e0ff';
          g.fillStyle = hand.pinch ? 'rgba(255,179,71,.35)' : 'rgba(51,224,255,.12)';
          g.lineWidth = 2;
          g.beginPath();
          g.arc(cx, cy, hand.pinch ? 10 : 15, 0, 6.283);
          g.fill();
          g.stroke();
          g.beginPath();
          g.moveTo(cx - 22, cy); g.lineTo(cx - 8, cy); g.moveTo(cx + 8, cy); g.lineTo(cx + 22, cy);
          g.moveTo(cx, cy - 22); g.lineTo(cx, cy - 8); g.moveTo(cx, cy + 8); g.lineTo(cx, cy + 22);
          g.stroke();
        }

        // najechanie: wskaźnik (mysz lub dłoń)
        const px = hand.on && hand.cursor ? hand.cursor.x * W : pointer.x;
        const py = hand.on && hand.cursor ? hand.cursor.y * H : pointer.y;
        const h2 = dragNode >= 0 ? dragNode : pick(px, py);
        if (h2 !== hover) {
          hover = h2;
          cv.style.cursor = h2 >= 0 ? 'pointer' : 'grab';
        }

        // karta przy wybranym węźle
        if (selected >= 0) {
          const v = vs[selected];
          const cw = card.offsetWidth || 260;
          const ch = card.offsetHeight || 150;
          const x = Math.max(8, Math.min(W - cw - 8, v.sx + 26));
          const y = Math.max(8, Math.min(H - ch - 8, v.sy - ch / 2));
          card.style.transform = `translate(${x}px, ${y}px)`;
          g.strokeStyle = 'rgba(51,224,255,.6)';
          g.setLineDash([3, 3]);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(v.sx, v.sy);
          g.lineTo(x, y + 18);
          g.stroke();
          g.setLineDash([]);
        }
        updateHud(vs);
      }

      // ----- HUD -----
      let hudRefs = {};
      function drawHud() {
        hud.innerHTML = '';
        const stats = el('div', 'gk-stats');
        const mk = (k) => {
          const r = el('div');
          const v = el('b', null, '0');
          r.append(el('span', null, k), v);
          stats.appendChild(r);
          return v;
        };
        hudRefs = { nodes: mk('WĘZŁY'), links: mk('POWIĄZANIA'), dens: mk('GĘSTOŚĆ'), mode: el('div', 'gk-mode') };
        stats.appendChild(hudRefs.mode);

        const help = el('div', 'gk-help');
        [['ROZSUNIĘTE PALCE', 'kursor / najechanie'], ['OTWARTA DŁOŃ + RUCH', 'obrót 3D'], ['SZCZYPNIĘCIE', 'wybór węzła'], ['SZCZYP. + PRZYTRZYMANIE', 'chwyt węzła'], ['SZCZYP. + RUCH', 'przesuwanie widoku'], ['2 DŁONIE ROZSUŃ / ZBLIŻ', 'zoom +/-']].forEach(([a, b]) => {
          const r = el('div');
          r.append(el('i', null, a), el('span', null, b));
          help.appendChild(r);
        });
        help.appendChild(el('em', null, 'Mysz: przeciągnij = obrót, kółko = zoom, Shift+przeciągnij = przesuwanie, klik = wybór.'));

        const bar = el('div', 'gk-bar');
        const hb = el('button', 'gk-btn', 'AKTYWUJ GESTY');
        hb.addEventListener('click', () => (hand.on ? stopHands() : startHands(hb)));
        hud.hb = hb;
        const search = el('input', 'gk-search');
        search.placeholder = 'szukaj w grafie...';
        search.addEventListener('input', () => {
          query = deaccent(search.value.trim().toLowerCase());
        });
        const mkBtn = (label, fn) => {
          const b = el('button', 'gk-btn gk-btn2', label);
          b.addEventListener('click', () => fn(b));
          return b;
        };
        bar.append(
          hb,
          search,
          mkBtn('KAMERA W TLE', async (b) => {
            if (UI.holoCam) await UI.holoCam.toggle();
            b.classList.toggle('on', Boolean(UI.holoCam?.isOn()));
            if (UI.holoCam?.isOn() && !hand.on) startHands(hb);
          }),
          mkBtn('ETYKIETY', (b) => {
            showLabels = !showLabels;
            b.classList.toggle('on', showLabels);
          }),
          mkBtn('OBRÓT', (b) => {
            spin = !spin;
            b.classList.toggle('on', spin);
          }),
          mkBtn('RESET', () => Object.assign(cam, { rx: -0.35, ry: 0.5, zoom: 1.35, px: 0, py: 0 })),
          mkBtn('DEMO', () => load(true)),
          mkBtn('MOJE DANE', () => load(false))
        );
        bar.querySelectorAll('.gk-btn2')[1].classList.add('on');
        bar.querySelectorAll('.gk-btn2')[2].classList.add('on');

        const nearBox = el('div', 'gk-near');
        hudRefs.near = nearBox;
        hudRefs.zoom = el('div', 'gk-zoom');
        hud.append(stats, help, bar, nearBox, hudRefs.zoom);
      }

      let lastHud = 0;
      function updateHud(vs) {
        const now = performance.now();
        if (now - lastHud < 200 || !hudRefs.nodes) return;
        lastHud = now;
        hudRefs.nodes.textContent = String(nodes.length);
        hudRefs.links.textContent = String(edges.length);
        hudRefs.dens.textContent = nodes.length ? (edges.length / nodes.length).toFixed(2) : '0';
        hudRefs.mode.textContent = `${demo ? 'SIEĆ DEMO' : 'TWOJE DANE'} · ${hand.on ? 'GESTY: ' + hand.mode.toUpperCase() : 'MYSZ'}`;
        hudRefs.zoom.textContent = `ZOOM: ${Math.round(cam.zoom * 100)}%`;
        const px = hand.on && hand.cursor ? hand.cursor.x * W : pointer.x > -900 ? pointer.x : W / 2;
        const py = hand.on && hand.cursor ? hand.cursor.y * H : pointer.y > -900 ? pointer.y : H / 2;
        const list = nodes.map((n, i) => ({ n, i, d: Math.hypot(vs[i].sx - px, vs[i].sy - py) })).sort((a, b) => a.d - b.d).slice(0, 5);
        hudRefs.near.innerHTML = '';
        hudRefs.near.appendChild(el('div', 'gk-neart', 'WĘZŁY BLISKO'));
        list.forEach(({ n, i, d }) => {
          const r = el('div', 'gk-nearr');
          const pct = Math.max(0, Math.round(100 - d / 4));
          r.append(el('i'), el('span', null, n.label), el('b', null, `${pct}%`));
          r.firstChild.style.background = CATS[n.cat][1];
          r.addEventListener('click', () => select(i));
          hudRefs.near.appendChild(r);
        });
      }

      // ----- wybór i karta -----
      function select(i) {
        selected = i;
        if (i < 0) {
          card.hidden = true;
          return;
        }
        const n = nodes[i];
        const first = String(n.text || '').split(/(?<=[.!?])\s/)[0].slice(0, 160);
        UI.activity?.emit('graf', `Wybrano pojecie "${n.label}" (${CATS[n.cat][0]}): ${String(n.text).slice(0, 120)}`, { react: true, say: `${n.label}. ${first}` });
        card.hidden = false;
        card.innerHTML = '';
        const head = el('div', 'gk-ch');
        const chip = el('span', 'gk-chip', CATS[n.cat][0]);
        chip.style.color = CATS[n.cat][1];
        chip.style.borderColor = CATS[n.cat][1];
        const x = el('button', 'gk-x', '×');
        x.addEventListener('click', () => select(-1));
        head.append(chip, x);
        card.append(head, el('div', 'gk-ct', n.label), el('div', 'gk-cb', n.text));
        if (nbr[i].length) {
          card.appendChild(el('div', 'gk-cl', `POWIĄZANIA (${nbr[i].length})`));
          const row = el('div', 'gk-links');
          nbr[i].slice(0, 8).forEach((j) => {
            const b = el('button', 'gk-link', nodes[j].label);
            b.style.borderColor = CATS[nodes[j].cat][1];
            b.addEventListener('click', () => select(j));
            row.appendChild(b);
          });
          card.appendChild(row);
        }
        alpha = Math.max(alpha, 0.1);
      }

      // ----- mysz / dotyk -----
      cv.addEventListener('pointerdown', (e) => {
        const r = cv.getBoundingClientRect();
        pointer.x = e.clientX - r.left;
        pointer.y = e.clientY - r.top;
        pointer.down = { x: pointer.x, y: pointer.y, moved: 0, pan: e.shiftKey || e.button === 2, node: pick(pointer.x, pointer.y) };
        cv.setPointerCapture(e.pointerId);
        if (pointer.down.node >= 0 && !pointer.down.pan) dragNode = pointer.down.node;
      });
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect();
        const nx = e.clientX - r.left;
        const ny = e.clientY - r.top;
        const dx = nx - pointer.x;
        const dy = ny - pointer.y;
        pointer.x = nx;
        pointer.y = ny;
        const d = pointer.down;
        if (!d) return;
        d.moved += Math.abs(dx) + Math.abs(dy);
        if (dragNode >= 0) {
          if (d.moved > 4) moveNodeTo(dragNode, nx, ny);
        } else if (d.pan) {
          cam.px += dx;
          cam.py += dy;
        } else {
          cam.ry += dx * 0.008;
          cam.rx = Math.max(-1.5, Math.min(1.5, cam.rx + dy * 0.008));
        }
      });
      cv.addEventListener('pointerup', () => {
        const d = pointer.down;
        pointer.down = false;
        if (d && d.moved < 5) select(d.node >= 0 && d.node !== selected ? d.node : -1);
        if (dragNode >= 0) alpha = Math.max(alpha, 0.25);
        dragNode = -1;
      });
      cv.addEventListener('pointerleave', () => {
        if (!pointer.down) {
          pointer.x = pointer.y = -999;
        }
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        cam.zoom = Math.max(0.4, Math.min(4, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      }, { passive: false });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('dblclick', () => {
        if (hover >= 0) {
          const v = view(nodes[hover]);
          cam.px -= v.sx - W / 2;
          cam.py -= v.sy - H / 2;
        }
      });

      function moveNodeTo(i, sx, sy) {
        const n = nodes[i];
        const v = view(n);
        const p = unproject(sx, sy, v.z);
        n.x = p.x;
        n.y = p.y;
        n.z = p.z;
        alpha = Math.max(alpha, 0.25);
      }

      // ----- gesty dłoni (MediaPipe) -----
      let landmarker = null;
      let stream = null;
      let sharedCam = false;
      let handRaf = 0;
      const tracker = G ? G.createTracker() : null;
      let lastVideoTime = -1;

      async function loadLandmarker() {
        if (landmarker) return landmarker;
        const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
        const opts = (delegate) => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        try {
          landmarker = await vision.HandLandmarker.createFromOptions(files, opts('GPU'));
        } catch {
          landmarker = await vision.HandLandmarker.createFromOptions(files, opts('CPU'));
        }
        return landmarker;
      }

      async function startHands(btn) {
        if (!G || !tracker) return toast('Brak modułu gestów.');
        if (!navigator.mediaDevices?.getUserMedia) return toast('Ta przeglądarka nie udostępnia kamery.');
        btn.textContent = 'ŁADOWANIE...';
        btn.disabled = true;
        try {
          const s = await (UI.camera ? UI.camera.acquire() : navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }));
          stream = s;
          sharedCam = Boolean(UI.camera);
          const lm = await loadLandmarker();
          // Do sledzenia osobny, niedolaczony do strony element: ukryty <video> w DOM nie dostarcza klatek.
          const feed = el('video');
          feed.muted = true;
          feed.playsInline = true;
          feed.srcObject = s;
          await feed.play();
          video.srcObject = s;
          if (!video.hidden) await video.play();
          hand.on = true;
          hand.status = 'aktywne';
          btn.textContent = 'DEZAKTYWUJ GESTY';
          btn.classList.add('on');
          toast('Gesty dłoni aktywne. Rozsuń palce i pokaż dłoń do kamery.', 'ok');
          UI.activity?.emit('gesty', 'Gesty dloni aktywne w grafie wiedzy', { react: true });
          const loop = () => {
            if (!hand.on) return;
            handRaf = requestAnimationFrame(loop);
            if (feed.readyState < 2 || feed.currentTime === lastVideoTime) return;
            lastVideoTime = feed.currentTime;
            let res;
            try {
              res = lm.detectForVideo(feed, performance.now());
            } catch {
              return;
            }
            const out = tracker.update(res.landmarks || [], performance.now());
            hand.cursor = out.visible ? out.cursor : null;
            hand.pinch = out.pinch;
            hand.mode = out.mode;
            out.events.forEach(onGesture);
          };
          loop();
        } catch (e) {
          stopHands();
          toast(UI.camera ? await UI.camera.explain(e) : `Nie uruchomiono gestów: ${e.message || e}`);
        } finally {
          btn.disabled = false;
        }
      }

      function stopHands() {
        hand.on = false;
        hand.cursor = null;
        cancelAnimationFrame(handRaf);
        if (stream) {
          if (sharedCam) UI.camera.release();
          else stream.getTracks().forEach((t) => t.stop());
        }
        stream = null;
        sharedCam = false;
        video.srcObject = null;
        if (hud.hb) {
          hud.hb.textContent = 'AKTYWUJ GESTY';
          hud.hb.classList.remove('on');
        }
      }

      function onGesture(e) {
        if (e.type === 'rotate') {
          cam.ry += e.dx * 2.4;
          cam.rx = Math.max(-1.5, Math.min(1.5, cam.rx + e.dy * 2.4));
        } else if (e.type === 'zoom') {
          cam.zoom = Math.max(0.4, Math.min(4, cam.zoom * e.factor));
        } else if (e.type === 'pan') {
          cam.px += e.dx * W;
          cam.py += e.dy * H;
        } else if (e.type === 'tap') {
          const i = pick(e.x * W, e.y * H);
          select(i >= 0 && i !== selected ? i : -1);
        } else if (e.type === 'grab-start') {
          const i = pick(e.x * W, e.y * H);
          if (i >= 0) {
            dragNode = i;
            UI.activity?.emit('graf', `Chwycono wezel "${nodes[i].label}" gestem`);
            select(i);
          }
        } else if (e.type === 'grab-move') {
          if (dragNode >= 0) moveNodeTo(dragNode, e.x * W, e.y * H);
        } else if (e.type === 'grab-end') {
          if (dragNode >= 0) alpha = Math.max(alpha, 0.3);
          dragNode = -1;
        }
      }

      load(false).then(() => requestAnimationFrame(frame));
    },
  };


  // ---------- mini podgląd na Pulpicie ----------
  UI.addHomeWidget?.({
    id: 'graph-mini',
    title: 'Graf wiedzy',
    glyph: '⌬',
    owner: true,
    action: { label: 'OTWÓRZ →', title: 'Graf wiedzy 3D z gestami dłoni', run: () => UI.openWindow('graph') },
    render(box) {
      if (box._built) return;
      box._built = true;
      box.innerHTML = '';
      const cv = el('canvas');
      cv.style.cssText = 'width:100%;height:130px;display:block;cursor:pointer';
      cv.addEventListener('click', () => UI.openWindow('graph'));
      box.append(cv, el('div', 'w-dim', 'Sieć pojęć z Twoich danych. Steruj myszą albo gestami dłoni przez kamerę.'));
      const d = buildDemo();
      const pts = d.nodes.map((n, i) => {
        const a = (i / d.nodes.length) * 6.283 * 3;
        const r = 40 + (i % 5) * 9;
        return { x: Math.cos(a) * r, y: ((i * 37) % 80) - 40, z: Math.sin(a) * r, c: CATS[n.cat][1] };
      });
      const gx = cv.getContext('2d');
      const dpr2 = Math.min(devicePixelRatio || 1, 2);
      const loop = (now) => {
        if (!cv.isConnected) return;
        requestAnimationFrame(loop);
        if (cv.offsetParent === null || document.visibilityState !== 'visible') return;
        const w = cv.clientWidth || 300;
        if (cv.width !== Math.round(w * dpr2)) { cv.width = Math.round(w * dpr2); cv.height = Math.round(130 * dpr2); }
        gx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
        gx.clearRect(0, 0, w, 130);
        const a = now / 4000;
        const P = pts.map((p) => {
          const x = p.x * Math.cos(a) - p.z * Math.sin(a);
          const z = p.x * Math.sin(a) + p.z * Math.cos(a);
          const f = 300 / (300 + z + 120);
          return { x: w / 2 + x * f * 1.5, y: 65 + p.y * f * 1.2, f, c: p.c };
        });
        gx.globalCompositeOperation = 'lighter';
        gx.strokeStyle = 'rgba(140,225,255,.25)';
        d.edges.forEach(([i, j]) => { gx.beginPath(); gx.moveTo(P[i].x, P[i].y); gx.lineTo(P[j].x, P[j].y); gx.stroke(); });
        P.forEach((p) => { gx.drawImage(sprite(p.c), p.x - 9 * p.f, p.y - 9 * p.f, 18 * p.f, 18 * p.f); });
        gx.globalCompositeOperation = 'source-over';
      };
      requestAnimationFrame(loop);
    },
  });

  UI.register({ id: 'graph', title: 'Graf wiedzy', sub: 'sieć pojęć 3D, gesty dłoni', icon: '⌬', owner: true, group: 'Wiedza', panels: { graph } });
  if (UI.shortcuts?.goto) UI.shortcuts.goto.v = 'graph';
})();
