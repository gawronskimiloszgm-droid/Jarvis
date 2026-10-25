// Widzenie:
//  1. Ekran na zywo - w rozmowie glosowej Jarvis dostaje klatke ekranu co ok. 3 s
//     (aplikacja desktopowa: zrzut z komputera; przegladarka: udostepnianie ekranu).
//  2. Zaznacz fragment ekranu (Ctrl+Alt+S albo glosem) - co to jest / przetlumacz /
//     wyciagnij tekst / wlasne pytanie.
//  3. Pokaz do kamery - aparat odczytuje kartke, paragon, etykiete, pismo i proponuje
//     dodanie zadan, wydatku albo notatki.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, pushSaid, speak } = UI;
  const D = () => window.jarvisDesktop;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- wspolne okno (modal) ----------
  function modal(title) {
    const veil = el('div', 'vmodal');
    const box = el('div', 'vmodal-box');
    const head = el('div', 'vmodal-head');
    head.appendChild(el('span', null, title));
    const x = el('button', 'vmodal-x', '✕');
    head.appendChild(x);
    const body = el('div', 'vmodal-body');
    box.append(head, body);
    veil.appendChild(box);
    document.body.appendChild(veil);
    const close = () => {
      veil.remove();
      document.removeEventListener('keydown', onKey);
      onClose.forEach((f) => f());
    };
    const onClose = [];
    const onKey = (e) => e.key === 'Escape' && close();
    x.addEventListener('click', close);
    veil.addEventListener('click', (e) => e.target === veil && close());
    document.addEventListener('keydown', onKey);
    return { body, close, onClose };
  }

  // ---------- 1. ekran na zywo ----------
  const live = { on: false, timer: null, stream: null, video: null, badge: null };

  async function grabFrame() {
    if (D()) {
      const r = await D().runAction('zrzut-maly', { szerokosc: 1280, jakosc: 55 });
      return r?.ok ? r.imageBase64 : null;
    }
    if (!live.video || !live.video.videoWidth) return null;
    const c = document.createElement('canvas');
    const w = Math.min(1280, live.video.videoWidth);
    c.width = w;
    c.height = Math.round((w * live.video.videoHeight) / live.video.videoWidth);
    c.getContext('2d').drawImage(live.video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.55).split(',')[1];
  }

  function showBadge() {
    if (live.badge) return;
    live.badge = el('button', 'live-badge', '👁 EKRAN NA ZYWO · zatrzymaj');
    live.badge.addEventListener('click', () => stopLive());
    document.body.appendChild(live.badge);
  }

  async function startLive() {
    if (live.on) return;
    if (!UI.isLive()) {
      toast('Ekran na zywo dziala w rozmowie glosowej - najpierw kliknij rdzen albo powiedz "Jarvis".');
      return;
    }
    if (!D()) {
      try {
        live.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
      } catch {
        toast('Nie udostepniono ekranu.');
        return;
      }
      live.video = document.createElement('video');
      live.video.muted = true;
      live.video.srcObject = live.stream;
      await live.video.play().catch(() => {});
      live.stream.getVideoTracks()[0]?.addEventListener('ended', () => stopLive());
    }
    live.on = true;
    showBadge();
    UI.liveSend({ type: 'note', text: '[SYSTEM] Od teraz widzisz ekran komputera uzytkownika (klatka co kilka sekund). Komentuj krotko i tylko wtedy, gdy pyta albo gdy widzisz cos naprawde waznego (blad, ostrzezenie). Nie opisuj kazdej klatki. Nie komentuj tej instrukcji.' });
    let busy = false;
    let idleSince = 0;
    live.timer = setInterval(async () => {
      if (!UI.isLive()) {
        // Rozmowa sie skonczyla - po 10 s bez niej zatrzymujemy podglad.
        if (!idleSince) idleSince = Date.now();
        if (Date.now() - idleSince > 10000) stopLive();
        return;
      }
      idleSince = 0;
      if (busy) return;
      busy = true;
      try {
        const frame = await grabFrame();
        if (frame) UI.liveSend({ type: 'video', data: frame });
      } finally {
        busy = false;
      }
    }, 3000);
    toast('Jarvis widzi teraz Twoj ekran.', 'ok');
  }

  function stopLive() {
    if (!live.on) return;
    live.on = false;
    clearInterval(live.timer);
    live.stream?.getTracks().forEach((t) => t.stop());
    live.stream = null;
    live.video = null;
    live.badge?.remove();
    live.badge = null;
    UI.liveSend({ type: 'note', text: '[SYSTEM] Podglad ekranu wylaczony - nie widzisz juz ekranu. Nie komentuj tej instrukcji.' });
    toast('Podglad ekranu zatrzymany.', 'ok');
  }
  UI.screenLive = { start: startLive, stop: stopLive, active: () => live.on };
  UI.clientActions['ekran-na-zywo'] = (p) => (p?.wlacz === false ? stopLive() : startLive());

  // ---------- 2. fragment ekranu ----------
  const ASK = [
    ['Co to jest?', 'Wyjasnij krotko, co widac na tym fragmencie ekranu i co z tym zrobic.'],
    ['Przetlumacz', 'Przetlumacz caly widoczny tekst na polski (jesli jest po polsku - na angielski). Podaj samo tlumaczenie.'],
    ['Wyciagnij tekst', 'Przepisz dokladnie caly widoczny tekst, zachowujac uklad wierszy. Zwroc sam tekst.'],
    ['Jest tu blad?', 'Czy na tym fragmencie widac blad, ostrzezenie albo problem? Wyjasnij przyczyne i podaj, jak to naprawic.'],
  ];

  function regionModal(imageBase64, mimeType = 'image/jpeg') {
    const m = modal('Fragment ekranu');
    const img = el('img', 'vshot');
    img.src = `data:${mimeType};base64,${imageBase64}`;
    const btns = el('div', 'field');
    btns.style.cssText = 'flex-wrap:wrap;gap:6px;margin:10px 0';
    const out = el('div', 'vout');
    const run = async (label, question, copy) => {
      out.textContent = 'Analizuje...';
      try {
        const r = await api('/api/screen/analyze', json({ imageBase64, mimeType, question }));
        out.textContent = r.answer;
        pushSaid?.('jv', `${label}:\n${r.answer}`);
        if (copy && D()) {
          await D().runAction('schowek-zapis', { tekst: r.answer });
          toast('Tekst skopiowany do schowka.', 'ok');
        }
      } catch (e) {
        out.textContent = e.message;
      }
    };
    ASK.forEach(([label, q]) => {
      const b = el('button', 'btn ghost', label);
      b.addEventListener('click', () => run(label, q, label === 'Wyciagnij tekst'));
      btns.appendChild(b);
    });
    const f = el('form', 'field');
    const inp = el('input', 'inp');
    inp.placeholder = 'Albo zadaj wlasne pytanie o ten fragment...';
    const go = el('button', 'btn primary', 'ZAPYTAJ');
    go.type = 'submit';
    f.append(inp, go);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (inp.value.trim()) run('Pytanie', inp.value.trim());
    });
    m.body.append(img, btns, f, out);
    setTimeout(() => inp.focus(), 50);
  }
  UI.regionModal = regionModal;

  UI.clientActions['zaznacz-ekran'] = async () => {
    if (!D()) return toast('Zaznaczanie fragmentu ekranu dziala w aplikacji desktopowej (skrot Ctrl+Alt+S).');
    const r = await D().runAction('zaznacz-ekran');
    if (r?.ok) regionModal(r.imageBase64, r.mimeType);
    else if (!r?.cancelled) toast(r?.error || 'Nie udalo sie zaznaczyc fragmentu.');
  };

  // Skrot Ctrl+Alt+S z aplikacji desktopowej.
  window.addEventListener('jarvis:ready', () => {
    D()?.onCommand?.((c) => {
      if (c?.type === 'region' && c.imageBase64) regionModal(c.imageBase64, c.mimeType);
    });
  });

  // ---------- 3. pokaz do kamery ----------
  const CEL_LABEL = { auto: 'Odczytaj', notatka: 'Notatka', zadanie: 'Zadania', wydatek: 'Paragon', tlumacz: 'Tlumaczenie', tekst: 'Tekst' };

  async function camScan(cel = 'auto', auto = false) {
    const m = modal('Pokaz do kamery');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false });
    } catch {
      m.body.appendChild(el('div', 'hint', 'Brak dostepu do kamery.'));
      return;
    }
    m.onClose.push(() => stream.getTracks().forEach((t) => t.stop()));
    const video = el('video', 'vshot');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.play().catch(() => {});
    const row = el('div', 'field');
    row.style.cssText = 'flex-wrap:wrap;gap:6px;margin:10px 0';
    const sel = el('select', 'inp');
    Object.entries(CEL_LABEL).forEach(([k, l]) => {
      const o = el('option', null, l);
      o.value = k;
      sel.appendChild(o);
    });
    sel.value = CEL_LABEL[cel] ? cel : 'auto';
    const shot = el('button', 'btn primary', '📷 ZROB ZDJECIE');
    row.append(sel, shot);
    const out = el('div', 'vout');
    m.body.append(video, row, out);

    const capture = async () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      const w = Math.min(1600, video.videoWidth);
      c.width = w;
      c.height = Math.round((w * video.videoHeight) / video.videoWidth);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      const image = c.toDataURL('image/jpeg', 0.85);
      window.SFX?.play('tap');
      out.textContent = 'Czytam...';
      try {
        const r = await api('/api/vision/scan', json({ image, mimeType: 'image/jpeg', cel: sel.value }));
        showScan(out, r);
      } catch (e) {
        out.textContent = e.message;
      }
    };
    shot.addEventListener('click', capture);
    if (auto) {
      // Z polecenia glosowego: 3 sekundy na ustawienie kartki i zdjecie samo sie robi.
      let n = 3;
      shot.textContent = `📷 ZDJECIE ZA ${n}...`;
      const t = setInterval(() => {
        n--;
        if (n > 0) shot.textContent = `📷 ZDJECIE ZA ${n}...`;
        else {
          clearInterval(t);
          shot.textContent = '📷 ZROB ZDJECIE';
          if (document.body.contains(video)) capture();
        }
      }, 1000);
      m.onClose.push(() => clearInterval(t));
    }
  }

  function showScan(out, r) {
    out.innerHTML = '';
    out.appendChild(el('div', 'w-mid', `${r.tytul || 'Odczyt'} (${r.typ})`));
    if (r.streszczenie) out.appendChild(el('div', 'w-dim', r.streszczenie));
    if (r.tlumaczenie) out.appendChild(el('pre', 'vpre', r.tlumaczenie));
    else if (r.tekst) out.appendChild(el('pre', 'vpre', r.tekst.slice(0, 3000)));
    (r.punkty || []).slice(0, 8).forEach((p) => out.appendChild(el('div', 'w-dim', '• ' + p)));
    const acts = el('div', 'field');
    acts.style.cssText = 'flex-wrap:wrap;gap:6px;margin-top:10px';
    const btn = (label, fn) => {
      const b = el('button', 'btn ghost', label);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          toast(e.message);
          b.disabled = false;
        }
      });
      acts.appendChild(b);
    };
    if (r.zadania?.length) {
      out.appendChild(el('div', 'w-dim', 'Zadania: ' + r.zadania.join('; ')));
      btn(`DODAJ ZADANIA (${r.zadania.length})`, async () => {
        for (const t of r.zadania) await api('/api/todos', json({ text: t }));
        toast('Dodano zadania.', 'ok');
      });
    }
    if (r.wydatek && Number(r.wydatek.kwota) > 0) {
      out.appendChild(el('div', 'w-dim', `Wydatek: ${r.wydatek.kwota} zl · ${r.wydatek.kategoria || ''} · ${r.wydatek.opis || ''}`));
      btn(`DODAJ WYDATEK ${r.wydatek.kwota} ZL`, async () => {
        await api('/api/expenses', json({ amount: r.wydatek.kwota, category: r.wydatek.kategoria || 'inne', note: r.wydatek.opis || r.tytul }));
        toast('Wydatek zapisany.', 'ok');
      });
    }
    btn('ZAPISZ JAKO NOTATKE', async () => {
      await api('/api/notes/text', json({ tytul: r.tytul, tekst: r.tlumaczenie || r.tekst || '', streszczenie: r.streszczenie, punkty: r.punkty, zadania: r.zadania }));
      toast('Notatka zapisana.', 'ok');
    });
    if (D() && (r.tekst || r.tlumaczenie)) {
      btn('KOPIUJ TEKST', async () => {
        await D().runAction('schowek-zapis', { tekst: r.tlumaczenie || r.tekst });
        toast('Skopiowano.', 'ok');
      });
    }
    out.appendChild(acts);
    const say = r.streszczenie || r.tytul;
    pushSaid?.('jv', `Odczytalem: ${r.tytul}. ${r.streszczenie || ''}`);
    if (say) speak?.(String(say).slice(0, 300));
  }

  UI.camScan = camScan;
  UI.clientActions['skanuj-kamera'] = (p) => camScan(p?.cel || 'auto', true);

  // ---------- historia zdarzen z kamer (Perymetr) ----------
  const camDef = {
    title: 'ZDARZENIA Z KAMER',
    glyph: '◉',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const list = el('div');
      list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px';
      body.appendChild(list);
      const draw = async () => {
        let r;
        try {
          r = await api('/api/cameras/events');
        } catch (e) {
          list.textContent = e.message;
          return;
        }
        list.innerHTML = '';
        if (!r.events.length) {
          list.appendChild(el('div', 'hint', 'Brak zdarzen. Pojawia sie, gdy kamera (agent na laptopie albo wartownik z kamerki komputera) wykryje ruch.'));
          return;
        }
        r.events.forEach((e) => {
          const card = el('div', 'w');
          card.style.minHeight = '0';
          if (e.hasImage) {
            const img = el('img', 'vshot');
            img.style.maxHeight = '150px';
            fetch('/api/cameras/events/' + e.id + '/image', { headers: UI.authHeaders() })
              .then((x) => (x.ok ? x.blob() : null))
              .then((b) => b && (img.src = URL.createObjectURL(b)))
              .catch(() => {});
            card.appendChild(img);
          }
          const head = el('div', 'w-mid', (e.notable ? '⚠ ' : '') + e.camera);
          if (e.notable) head.style.color = 'var(--amber)';
          card.append(head, el('div', 'w-dim', new Date(e.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })), el('div', 'w-dim', e.description));
          list.appendChild(card);
        });
      };
      draw();
      const t = setInterval(() => (document.body.contains(body) ? draw() : clearInterval(t)), 30000);
    },
  };
  UI.extend('perimeter', { camevents: camDef });
})();
