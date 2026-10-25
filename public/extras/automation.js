// Automatyka:
//  4. Obecnosc przy komputerze - "odszedles" po kilku minutach bez myszy/klawiatury
//     (albo bez ruchu w kamerze): pauza muzyki, opcjonalnie blokada ekranu; po powrocie
//     Jarvis sie wita i mowi, co sie dzialo.
//  5. Wartownik z kamerki - gdy Cie nie ma, kamera obserwuje pokoj; ruch -> zdjecie do
//     oceny AI -> push na telefon (ta sama sciezka co kamery domowe w Perymetrze).
//  8. Tryb gry - aplikacja desktopowa wykrywa gre i wlacza cisze na czas grania.
//  9. Automatyczne profile - wg pory dnia, otwartej aplikacji albo trwajacej gry.
//  6. Nauka z pokazu - nagrywasz, jak cos robisz, a agent ekranu odtwarza to jako przepis.
// Wykrywanie ruchu liczy sie lokalnie (roznica klatek), bez rozpoznawania twarzy.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner, speak, pushSaid } = UI;
  const D = () => window.jarvisDesktop;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const get = (k, d) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  };
  const put = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ustawienie do zamkniecia karty */
    }
  };

  // ================= 4 + 5: obecnosc i wartownik =================
  const P = {
    away: false,
    awayAt: 0,
    lastPresent: Date.now(),
    lastMotion: 0,
    cam: null,
    camTimer: null,
    prev: null,
    guardShots: 0,
    lastGuard: 0,
    pendingGuard: null,
  };
  const mode = () => get('jarvis.presence', 'off'); // off | aktywnosc | kamera
  const awayMin = () => Math.max(1, Number(get('jarvis.awayMin', '5')) || 5);
  const flag = (k, d) => get(k, d) === '1';

  async function camStart() {
    if (P.cam) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: 5 }, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 60;
      P.cam = { stream, video, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
      P.camTimer = setInterval(checkMotion, 1000);
      return true;
    } catch {
      toast('Obecnosc/wartownik: brak dostepu do kamery.');
      return false;
    }
  }

  function camStop() {
    clearInterval(P.camTimer);
    P.cam?.stream.getTracks().forEach((t) => t.stop());
    P.cam = null;
    P.prev = null;
  }

  // Ruch = wyrazna zmiana jasnosci na co najmniej ~2% pikseli miniatury 80x60.
  function checkMotion() {
    const c = P.cam;
    if (!c || !c.video.videoWidth) return;
    c.ctx.drawImage(c.video, 0, 0, 80, 60);
    const d = c.ctx.getImageData(0, 0, 80, 60).data;
    const gray = new Uint8Array(80 * 60);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    if (P.prev) {
      let changed = 0;
      for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - P.prev[i]) > 28) changed++;
      if (changed > gray.length * 0.02) onMotion();
    }
    P.prev = gray;
  }

  function onMotion() {
    P.lastMotion = Date.now();
    if (!P.away || !flag('jarvis.guard', '0')) return;
    if (P.pendingGuard || Date.now() - P.lastGuard < 20000) return;
    // 8 s na "to tylko ja": jesli w tym czasie wrocisz do klawiatury, zdjecie nie leci.
    P.pendingGuard = setTimeout(guardShot, 8000);
  }

  async function guardShot() {
    P.pendingGuard = null;
    if (!P.away || !P.cam) return;
    P.lastGuard = Date.now();
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = Math.round((640 * P.cam.video.videoHeight) / (P.cam.video.videoWidth || 640)) || 480;
    c.getContext('2d').drawImage(P.cam.video, 0, 0, c.width, c.height);
    try {
      const r = await api('/api/cameras/frame', json({ camera: 'Kamera PC', image: c.toDataURL('image/jpeg', 0.8) }));
      if (r?.escalated) P.guardShots++;
    } catch {
      /* brak sieci - sprobujemy przy kolejnym ruchu */
    }
  }

  async function idleSeconds() {
    if (!D()) return null;
    const r = await D().runAction('aktywne-okno').catch(() => null);
    return r?.ok ? r.idleSec : null;
  }

  async function onAway() {
    P.away = true;
    P.awayAt = Date.now();
    P.guardShots = 0;
    UI.logEvent?.('obecnosc', 'odszedles od komputera', 'info');
    if (flag('jarvis.awayPause', '1') && UI.nowPlaying?.playing) UI.musicControl?.('pauza').catch(() => {});
    if (flag('jarvis.awayLock', '0') && D()) D().runAction('zablokuj-ekran').catch(() => {});
    if (flag('jarvis.guard', '0')) await camStart();
  }

  function onReturn() {
    const awayMs = Date.now() - P.awayAt;
    P.away = false;
    clearTimeout(P.pendingGuard);
    P.pendingGuard = null;
    if (mode() !== 'kamera') camStop();
    const missed = (UI.events?.() || []).filter((e) => +new Date(e.at) > P.awayAt && (e.kind === 'warn' || e.kind === 'err' || e.kind === 'bad')).length;
    const mins = Math.round(awayMs / 60000);
    let text = `Witaj z powrotem, sir. Nie bylo Cie ${mins} min.`;
    if (P.guardShots) text += ` Wartownik zglosil ${P.guardShots} zdarzen - szczegoly w Perymetrze.`;
    else if (missed) text += ` W tym czasie: ${missed} ostrzezen - sa w powiadomieniach.`;
    else text += ' Nic waznego sie nie wydarzylo.';
    UI.logEvent?.('obecnosc', `powrot po ${mins} min`, 'ok');
    if (mins >= 2) {
      pushSaid?.('jv', text);
      speak?.(text);
    }
  }

  async function presenceTick() {
    const m = mode();
    if (m === 'off' || !isOwner()) {
      if (P.cam && !P.away) camStop();
      return;
    }
    if (m === 'kamera' && !P.cam) await camStart();
    const idle = await idleSeconds();
    const now = Date.now();
    const present = (idle != null && idle < 60) || (m === 'kamera' && now - P.lastMotion < 60000) || (idle == null && m !== 'kamera');
    if (present) P.lastPresent = now;
    if (!P.away && now - P.lastPresent > awayMin() * 60000) await onAway();
    else if (P.away && present) onReturn();
  }

  // ================= 8: tryb gry =================
  const G = { setDnd: false, name: '' };
  async function onGame(c) {
    if (get('jarvis.gameMode', '1') !== '1') return;
    if (c.on) {
      G.name = c.name;
      if (!UI.dnd?.active) {
        await api('/api/dnd', json({ minutes: 240 })).catch(() => {});
        window.dispatchEvent(new Event('jarvis:dnd'));
        G.setDnd = true;
      }
      toast(`Tryb gry: ${c.name}. Powiadomienia wstrzymane - powodzenia, sir.`, 'ok');
      UI.logEvent?.('tryb gry', `start: ${c.name}`, 'ok');
    } else {
      if (G.setDnd) {
        await api('/api/dnd', json({ minutes: 0 })).catch(() => {});
        window.dispatchEvent(new Event('jarvis:dnd'));
        G.setDnd = false;
      }
      toast(`Koniec gry (${c.name}${c.minutes ? `, ${c.minutes} min` : ''}).`, 'ok');
      UI.logEvent?.('tryb gry', `koniec: ${c.name} po ${c.minutes || 0} min`, 'ok');
    }
    autoTick(true);
  }

  // ================= 9: automatyczne profile =================
  const A = { lastManual: 0, autoActive: null, state: null, loadedAt: 0 };

  async function loadProfiles(force) {
    if (!force && A.state && Date.now() - A.loadedAt < 5 * 60000) return A.state;
    A.state = await api('/api/profiles').catch(() => A.state);
    A.loadedAt = Date.now();
    return A.state;
  }

  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  };
  function inRange(od, doo) {
    const d = new Date();
    const now = d.getHours() * 60 + d.getMinutes();
    const a = toMin(od);
    const b = toMin(doo);
    return a <= b ? now >= a && now < b : now >= a || now < b;
  }

  async function autoTick(force) {
    if (!isOwner()) return;
    const s = await loadProfiles(force);
    if (!s?.auto || !Array.isArray(s.rules)) return;
    if (Date.now() - A.lastManual < 30 * 60000) return; // reczny wybor ma pierwszenstwo przez 30 min
    const fg = D() ? await D().runAction('aktywne-okno').catch(() => null) : null;
    let target = null;
    for (const r of s.rules) {
      if (r.typ === 'gra' && fg?.gra) target = r.profil;
      else if (r.typ === 'aplikacja' && fg?.proc && fg.proc.toLowerCase() === String(r.proc).toLowerCase()) target = r.profil;
      else if (r.typ === 'czas' && inRange(r.od, r.do)) target = r.profil;
      if (target) break;
    }
    // Nic nie pasuje, a to my wlaczylismy biezacy profil - wracamy do "dom".
    if (!target && A.autoActive && s.active === A.autoActive) target = 'dom';
    if (!target || target === s.active || !s.list.some((p) => p.name === target)) return;
    A.autoActive = target === 'dom' ? null : target;
    await origProfil?.({ nazwa: target }, { auto: true });
    await loadProfiles(true);
    UI.logEvent?.('profile', `automatycznie: ${target}`, 'ok');
  }

  // Reczna zmiana profilu (glos, czat, panel) wstrzymuje automat na 30 minut.
  let origProfil = null;
  function wrapProfil() {
    if (origProfil || !UI.clientActions.profil) return;
    origProfil = UI.clientActions.profil;
    UI.clientActions.profil = (p, o) => {
      if (!o?.auto) {
        A.lastManual = Date.now();
        A.autoActive = null;
      }
      return origProfil(p, o);
    };
  }

  // ================= 6: nauka z pokazu =================
  const L = { on: false, frames: [], timer: null, t0: 0 };

  function recipeGoal(r) {
    return `${r.cel}\nKroki (pokazane wczesniej przez uzytkownika):\n${r.kroki.map((k, i) => `${i + 1}. ${k}`).join('\n')}`;
  }

  async function runRecipe(name) {
    const { recipes } = await api('/api/agent/recipes');
    const q = String(name || '').trim().toLowerCase();
    const r = recipes.find((x) => x.nazwa === q) || recipes.find((x) => x.nazwa.includes(q) || q.includes(x.nazwa));
    if (!r) return toast(`Nie znam przepisu "${name}". Nagraj go w Agencie ekranu (Naucz sie z pokazu).`);
    UI.openWindow('screenagent');
    return UI.agentGui?.start(recipeGoal(r));
  }
  UI.clientActions['przepis'] = (p) => runRecipe(p?.nazwa);

  // Do diagnostyki (konsola) i paneli.
  UI.automation = { presenceTick, autoTick, onGame, presence: P, auto: A };

  // ================= start =================
  window.addEventListener('jarvis:ready', () => {
    wrapProfil();
    setInterval(() => presenceTick().catch(() => {}), 15000);
    setInterval(() => autoTick().catch(() => {}), 60000);
    setTimeout(() => autoTick(true).catch(() => {}), 8000);
    D()?.onCommand?.((c) => {
      if (c?.type === 'game') onGame(c).catch(() => {});
    });
  });

  // ================= panele =================
  const row = (label, input) => {
    const r = el('div', 'kv');
    r.append(el('span', null, label), input);
    return r;
  };
  const check = (key, def, onChange) => {
    const c = el('input');
    c.type = 'checkbox';
    c.checked = flag(key, def);
    c.addEventListener('change', () => {
      put(key, c.checked ? '1' : '0');
      onChange?.(c.checked);
    });
    return c;
  };

  const presenceDef = {
    title: 'OBECNOSC I WARTOWNIK',
    glyph: '◎',
    wide: true,
    build(body) {
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'Wykrywanie ruchu liczy sie na tym urzadzeniu - bez rozpoznawania twarzy i bez wysylania obrazu. Do serwera trafia zdjecie tylko z wartownika, gdy Cie nie ma.'));
      const sel = el('select', 'inp');
      [['off', 'Wylaczone'], ['aktywnosc', 'Mysz i klawiatura (bez kamery)'], ['kamera', 'Kamera + mysz/klawiatura']].forEach(([v, l]) => {
        const o = el('option', null, l);
        o.value = v;
        sel.appendChild(o);
      });
      sel.value = mode();
      sel.addEventListener('change', () => {
        put('jarvis.presence', sel.value);
        if (sel.value !== 'kamera' && !P.away) camStop();
      });
      const mins = el('input', 'inp');
      mins.type = 'number';
      mins.min = '1';
      mins.max = '60';
      mins.value = String(awayMin());
      mins.style.width = '80px';
      mins.addEventListener('change', () => put('jarvis.awayMin', String(Math.max(1, Number(mins.value) || 5))));
      body.append(
        row('Tryb', sel),
        row('Nieobecnosc po (min)', mins),
        row('Pauzuj muzyke, gdy odejdziesz', check('jarvis.awayPause', '1')),
        row('Blokuj ekran, gdy odejdziesz', check('jarvis.awayLock', '0')),
        row('Wartownik: kamera pilnuje, gdy Cie nie ma (push na telefon)', check('jarvis.guard', '0'))
      );
      if (!D()) body.appendChild(el('div', 'hint', 'Mysz/klawiatura dziala tylko w aplikacji desktopowej - w przegladarce uzyj trybu z kamera.'));
      const st = el('div', 'w-dim');
      st.style.marginTop = '8px';
      st.textContent = P.away ? `Stan: nieobecny od ${new Date(P.awayAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : 'Stan: obecny';
      body.appendChild(st);
    },
  };

  const gameDef = {
    title: 'TRYB GRY',
    glyph: '🎮',
    build(body) {
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'Aplikacja desktopowa rozpoznaje gre (Steam, Epic, Riot, EA, znane tytuly) i na czas grania wlacza cisze. "Jarvis, jaka temperatura karty?" - poda stan GPU.'));
      body.appendChild(row('Wlacz tryb gry', check('jarvis.gameMode', '1', (on) => D()?.setSetting('gameMode', on))));
      const st = el('div', 'w-dim');
      body.appendChild(st);
      if (D()) {
        D().runAction('stan-gry').then((r) => {
          if (!r?.ok) return;
          st.textContent = `${r.gra ? `Gra: ${r.gra} (${r.minut} min) · ` : ''}CPU ${r.cpu}% · RAM ${r.ramUsedPct}%${r.gpu ? ` · ${r.gpu.nazwa}: ${r.gpu.temperatura}°C, ${r.gpu.obciazenie}%` : ''}`;
        });
      } else st.textContent = 'Dziala w aplikacji desktopowej.';
    },
  };
  UI.extend('set', { presence: presenceDef, gamemode: gameDef });

  // Reguly automatycznych profili - w module Profile.
  const rulesDef = {
    title: 'AUTOMATYCZNE PROFILE',
    glyph: '⟳',
    wide: true,
    async build(body) {
      body.innerHTML = '';
      const s = await loadProfiles(true);
      if (!s) return body.appendChild(el('div', 'hint', 'Brak danych profili.'));
      body.appendChild(el('div', 'sub', 'Pierwsza pasujaca regula wygrywa. Reczna zmiana profilu wstrzymuje automat na 30 minut.'));
      const autoBox = el('input');
      autoBox.type = 'checkbox';
      autoBox.checked = Boolean(s.auto);
      const rules = s.rules.map((r) => ({ ...r }));
      const save = async () => {
        await api('/api/profiles/rules', json({ auto: autoBox.checked, rules }));
        await loadProfiles(true);
        rulesDef.build(body);
        if (autoBox.checked) autoTick(true);
      };
      autoBox.addEventListener('change', save);
      body.appendChild(row('Automatyczne przelaczanie', autoBox));
      const list = el('div', 'w-list');
      list.style.margin = '8px 0';
      rules.forEach((r, i) => {
        const it = el('div', 'it');
        const txt = r.typ === 'gra' ? 'gdy trwa gra' : r.typ === 'aplikacja' ? `gdy na wierzchu: ${r.proc}` : `od ${r.od} do ${r.do}`;
        const x = el('button', 'row-x', '×');
        x.addEventListener('click', () => {
          rules.splice(i, 1);
          save();
        });
        it.append(el('span', null, `${i + 1}. ${txt} → ${r.profil}`), x);
        list.appendChild(it);
      });
      if (!rules.length) list.appendChild(el('div', 'w-empty', 'Brak regul.'));
      body.appendChild(list);
      const f = el('form', 'field');
      f.style.flexWrap = 'wrap';
      const typ = el('select', 'inp');
      [['czas', 'Pora dnia'], ['aplikacja', 'Aplikacja'], ['gra', 'Gra']].forEach(([v, l]) => {
        const o = el('option', null, l);
        o.value = v;
        typ.appendChild(o);
      });
      const a = el('input', 'inp');
      const b = el('input', 'inp');
      const prof = el('select', 'inp');
      s.list.forEach((p) => {
        const o = el('option', null, p.name);
        o.value = p.name;
        prof.appendChild(o);
      });
      const paint = () => {
        a.hidden = typ.value === 'gra';
        b.hidden = typ.value !== 'czas';
        a.placeholder = typ.value === 'czas' ? 'od (np. 22:00)' : 'proces (np. Code, chrome)';
        b.placeholder = 'do (np. 07:00)';
      };
      typ.addEventListener('change', paint);
      paint();
      const add = el('button', 'btn primary', 'DODAJ REGULE');
      add.type = 'submit';
      f.append(typ, a, b, prof, add);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = typ.value === 'gra' ? { typ: 'gra', profil: prof.value } : typ.value === 'aplikacja' ? { typ: 'aplikacja', proc: a.value.trim(), profil: prof.value } : { typ: 'czas', od: a.value.trim(), do: b.value.trim(), profil: prof.value };
        rules.push(r);
        save();
      });
      body.appendChild(f);
    },
  };
  UI.extend('profiles', { profrules: rulesDef });

  // Nauka z pokazu - w module Agent ekranu.
  const learnDef = {
    title: 'NAUCZ SIE Z POKAZU',
    glyph: '⏺',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!D()) {
        body.appendChild(el('div', 'hint', 'Dziala w aplikacji desktopowej.'));
        return;
      }
      body.appendChild(el('div', 'sub', 'Kliknij START, zrob zadanie normalnie (do 60 s), kliknij STOP. Jarvis zapisze to jako przepis i potem zrobi sam: "Jarvis, zrob przepis <nazwa>".'));
      const f = el('div', 'field');
      f.style.cssText = 'margin:8px 0;flex-wrap:wrap';
      const opis = el('input', 'inp');
      opis.placeholder = 'co pokazujesz (opcjonalnie), np. wysylka faktury z Excela';
      const start = el('button', 'btn primary', '⏺ START');
      const stop = el('button', 'btn danger', '■ STOP');
      stop.disabled = true;
      const st = el('div', 'w-dim');
      f.append(opis, start, stop);
      const list = el('div', 'w-list');
      list.style.marginTop = '10px';
      body.append(f, st, list);

      async function drawList() {
        const { recipes } = await api('/api/agent/recipes').catch(() => ({ recipes: [] }));
        list.innerHTML = '';
        if (!recipes.length) list.appendChild(el('div', 'w-empty', 'Brak przepisow.'));
        recipes.forEach((r) => {
          const it = el('div', 'it');
          const txt = el('span', null, `${r.nazwa} - ${r.cel} (${r.kroki.length} krokow)`);
          txt.title = r.kroki.map((k, i) => `${i + 1}. ${k}`).join('\n');
          const ctl = el('span');
          const run = el('button', 'btn ghost', '▶');
          run.addEventListener('click', () => UI.agentGui?.start(recipeGoal(r)));
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', async () => {
            await api(`/api/agent/recipes/${r.id}`, { method: 'DELETE' });
            drawList();
          });
          ctl.append(run, del);
          it.append(txt, ctl);
          list.appendChild(it);
        });
      }

      async function stopRec() {
        if (!L.on) return;
        L.on = false;
        clearInterval(L.timer);
        start.disabled = false;
        stop.disabled = true;
        st.textContent = `Analizuje pokaz (${L.frames.length} klatek)...`;
        try {
          const r = await api('/api/agent/learn', json({ frames: L.frames, opis: opis.value.trim() }));
          st.textContent = `Zapisano przepis "${r.recipe.nazwa}": ${r.recipe.kroki.length} krokow.`;
          pushSaid?.('jv', `Nauczylem sie: ${r.recipe.nazwa} - ${r.recipe.cel}`);
          drawList();
        } catch (e) {
          st.textContent = e.message;
        }
        L.frames = [];
      }

      start.addEventListener('click', () => {
        L.on = true;
        L.frames = [];
        L.t0 = Date.now();
        start.disabled = true;
        stop.disabled = false;
        let busy = false;
        L.timer = setInterval(async () => {
          if (!L.on || busy) return;
          if (Date.now() - L.t0 > 60000 || L.frames.length >= 40) return stopRec();
          busy = true;
          try {
            const [shot, fg] = await Promise.all([D().runAction('zrzut-maly', { szerokosc: 960, jakosc: 50 }), D().runAction('aktywne-okno')]);
            if (shot?.ok) L.frames.push({ img: shot.imageBase64, proc: fg?.proc || '', t: Date.now() - L.t0 });
            st.textContent = `Nagrywam... ${L.frames.length} klatek (${Math.round((Date.now() - L.t0) / 1000)} s)`;
          } finally {
            busy = false;
          }
        }, 1500);
      });
      stop.addEventListener('click', stopRec);
      drawList();
    },
  };
  UI.extend('screenagent', { agentlearn: learnDef });
})();
