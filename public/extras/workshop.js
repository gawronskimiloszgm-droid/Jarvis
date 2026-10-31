// Tryb warsztatu: praca z brudnymi rekami. Mowisz, co robisz, Jarvis uklada kroki (ze zrodel z sieci),
// duzy tekst widac z daleka, a dalej idziesz glosem albo machnieciem reki. Kamera telefonu moze
// pokazywac Jarvisowi to, co masz przed soba.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.register) return;
  const { el, api, toast, isOwner } = UI;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const KEY = 'jarvis.workshop';

  const W = { plan: null, step: 0, cam: null, camTimer: null, lock: null, draw: () => {} };
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s?.plan) Object.assign(W, { plan: s.plan, step: s.step || 0 });
    } catch {
      /* brak zapisu */
    }
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ plan: W.plan, step: W.step }));
    } catch {
      /* zapis opcjonalny */
    }
  };
  load();

  const stepText = () => {
    const s = W.plan?.steps?.[W.step];
    return s ? `Krok ${W.step + 1} z ${W.plan.steps.length}: ${s.tekst}${s.uwaga ? ` Uwaga: ${s.uwaga}.` : ''}` : '';
  };

  // W rozmowie Jarvis czyta krok sam, poza nia mowimy zwyklym glosem.
  function announce() {
    const text = stepText();
    if (!text) return;
    if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `Tryb warsztatu. Przeczytaj uzytkownikowi ten krok, bez dodatkow: ${text}` });
    else UI.speak?.(text);
  }

  function go(delta) {
    if (!W.plan) return false;
    const next = W.step + delta;
    if (next >= W.plan.steps.length) {
      finish();
      return true;
    }
    W.step = Math.max(0, next);
    save();
    W.draw();
    window.SFX?.play?.('tap');
    announce();
    return true;
  }

  function finish() {
    const title = W.plan?.tytul;
    if (title) UI.life?.add('journal', { text: `Warsztat ukończony: ${title}`, kind: 'manual' }).catch(() => {});
    if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `Ostatni krok zrobiony: ${title}. Pogratuluj jednym zdaniem.` });
    else UI.speak?.('To był ostatni krok. Dobra robota, sir.');
    W.plan = null;
    W.step = 0;
    save();
    stopCam();
    W.lock?.release?.().catch(() => {});
    W.lock = null;
    W.draw();
  }

  // Machniecie reka (gesty dloni) przelacza kroki, gdy modul jest otwarty.
  UI.workshopSwipe = (dir) => {
    const win = document.querySelector('[data-win="warsztat"]');
    if (!W.plan || !win || win.hidden) return false;
    go(dir);
    return true;
  };

  // ---------- kamera dla Jarvisa ----------
  function stopCam() {
    clearInterval(W.camTimer);
    W.camTimer = null;
    if (W.cam) {
      W.cam.pause();
      W.cam.srcObject = null;
      W.cam = null;
      UI.camera?.release();
    }
  }
  async function startCam(preview) {
    if (W.cam) return stopCam();
    if (!UI.isLive?.()) UI.startListening?.();
    const s = await UI.camera.acquire();
    preview.srcObject = s;
    await preview.play();
    W.cam = preview;
    const cv = document.createElement('canvas');
    W.camTimer = setInterval(() => {
      if (!UI.isLive?.() || !preview.videoWidth) return;
      const k = Math.min(1, 640 / preview.videoWidth);
      cv.width = preview.videoWidth * k;
      cv.height = preview.videoHeight * k;
      cv.getContext('2d').drawImage(preview, 0, 0, cv.width, cv.height);
      UI.liveSend({ type: 'video', data: cv.toDataURL('image/jpeg', 0.7).split(',')[1] });
    }, 2500);
  }

  // Polecenia od Jarvisa (glos i czat).
  if (UI.clientActions) {
    UI.clientActions.warsztat = async (p) => {
      const a = String(p?.akcja || p?.raw || 'dalej').toLowerCase();
      if (/wstecz|wroc|cofnij|poprzedni/.test(a)) go(-1);
      else if (/powtorz/.test(a)) announce();
      else if (/koniec|zakoncz/.test(a)) finish();
      else go(1);
      return { ok: true };
    };
    UI.clientActions['warsztat-plan'] = async (p) => {
      UI.openWindow('warsztat');
      await start(String(p?.temat || p?.raw || ''));
      return { ok: true };
    };
  }

  async function start(topic) {
    const t = topic.trim();
    if (!t) return;
    const r = await api('/api/workshop/plan', json({ temat: t }));
    W.plan = r.plan;
    W.step = 0;
    save();
    W.draw();
    try {
      W.lock = await navigator.wakeLock?.request('screen');
    } catch {
      /* blokada ekranu niedostepna */
    }
    UI.activity?.emit('warsztat', `Tryb warsztatu: ${W.plan.tytul}`);
    if (UI.isLive?.()) UI.liveSend({ type: 'note', text: `[UI] Tryb warsztatu "${W.plan.tytul}". Kroki: ${W.plan.steps.map((s, i) => `${i + 1}. ${s.tekst}`).join(' ')}. Prowadz po jednym kroku; "dalej", "wroc", "powtorz" obsluz narzedziem warsztat.` });
    announce();
  }

  const panel = {
    title: 'TRYB WARSZTATU',
    glyph: '🔧',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostępne tylko dla właściciela.';
        return;
      }
      body.innerHTML = '';
      const startBox = el('div', 'ws-start');
      const topic = el('input', 'inp');
      topic.placeholder = 'Co robimy? np. wymiana oleju w Golfie IV 1.9 TDI';
      topic.style.flex = '1 1 300px';
      const go1 = el('button', 'btn primary', 'UŁÓŻ KROKI');
      startBox.append(topic, go1);
      const hint = el('div', 'sub', 'Mów: „dalej”, „wróć”, „powtórz”, „ile momentu?”. Działa też machnięcie ręką w bok, gdy gesty są włączone. Kamera (też telefonu) pokazuje Jarvisowi, co masz przed sobą.');
      const stage = el('div', 'ws-stage');
      const tools = el('div', 'w-dim');
      const counter = el('div', 'ws-count');
      const big = el('div', 'ws-step');
      const warn = el('div', 'ws-warn');
      const bar = el('div', 'ws-bar');
      const prev = el('button', 'btn ghost', '← WRÓĆ');
      const again = el('button', 'btn ghost', '🔊 POWTÓRZ');
      const next = el('button', 'btn primary', 'DALEJ →');
      const talk = el('button', 'btn ghost', '🎙 ROZMOWA');
      const camBtn = el('button', 'btn ghost', '📷 POKAŻ JARVISOWI');
      const end = el('button', 'btn ghost', 'ZAKOŃCZ');
      bar.append(prev, again, next, talk, camBtn, end);
      const preview = el('video', 'ws-cam');
      preview.muted = true;
      preview.playsInline = true;
      const src = el('div', 'w-dim');
      stage.append(tools, counter, big, warn, bar, preview, src);
      body.append(startBox, hint, stage);

      W.draw = () => {
        if (!document.body.contains(body)) return;
        const has = Boolean(W.plan);
        startBox.hidden = has;
        hint.hidden = has;
        stage.hidden = !has;
        if (!has) return;
        const s = W.plan.steps[W.step];
        counter.textContent = `${W.plan.tytul} · krok ${W.step + 1} z ${W.plan.steps.length}`;
        big.textContent = s.tekst;
        warn.textContent = s.uwaga ? `⚠ ${s.uwaga}` : '';
        warn.hidden = !s.uwaga;
        tools.textContent = W.plan.narzedzia?.length ? `Przygotuj: ${W.plan.narzedzia.join(', ')}` : '';
        tools.hidden = W.step !== 0 || !W.plan.narzedzia?.length;
        src.textContent = W.plan.zrodla?.length ? `Źródła: ${W.plan.zrodla.join(', ')}` : '';
        prev.disabled = W.step === 0;
        next.textContent = W.step === W.plan.steps.length - 1 ? 'GOTOWE ✓' : 'DALEJ →';
        preview.hidden = !W.cam;
        camBtn.textContent = W.cam ? '📷 UKRYJ KAMERĘ' : '📷 POKAŻ JARVISOWI';
      };
      const doStart = async () => {
        go1.disabled = true;
        go1.textContent = 'SZUKAM I UKŁADAM...';
        try {
          await start(topic.value);
        } catch (e) {
          toast(e.message || 'Nie udało się ułożyć kroków.');
        }
        go1.disabled = false;
        go1.textContent = 'UŁÓŻ KROKI';
      };
      go1.addEventListener('click', doStart);
      topic.addEventListener('keydown', (e) => e.key === 'Enter' && doStart());
      prev.addEventListener('click', () => go(-1));
      next.addEventListener('click', () => go(1));
      again.addEventListener('click', announce);
      talk.addEventListener('click', () => UI.toggleListening?.());
      end.addEventListener('click', () => {
        if (confirm('Zakończyć warsztat?')) finish();
      });
      camBtn.addEventListener('click', async () => {
        try {
          await startCam(preview);
        } catch (e) {
          toast(UI.camera ? await UI.camera.explain(e) : e.message);
        }
        W.draw();
      });
      W.draw();
    },
  };
  UI.register({ id: 'warsztat', title: 'Warsztat', sub: 'krok po kroku, bez rąk', icon: '🔧', owner: true, group: 'Dom', panels: { warsztat: panel } });
})();
