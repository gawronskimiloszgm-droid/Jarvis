// Analiza: dlugie pliki (PDF/DOCX/obrazy/tekst/kod) i ekran komputera.
//
// - przeciagnij/wybierz plik albo podaj sciezke do pliku na komputerze
// - streszczenie, pytania do dokumentu (w panelu ORAZ w zwyklej rozmowie -
//   serwer dokleja Jarvisowi kontekst wczytanego dokumentu)
// - "Analizuj ekran": zrzut -> Gemini Vision (aplikacja desktopowa albo
//   przechwytywanie ekranu w przegladarce)
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, authHeaders, isOwner, pushSaid, speak } = UI;

  let panel = null;
  let current = null; // { id, name, chars, ... }
  let busy = false;

  const state = { log: [] };

  function say(who, text) {
    state.log.push({ who, text });
    if (panel?.feed) {
      const row = el('div', `said ${who === 'me' ? 'me' : 'jv'}`);
      row.append(el('span', 'who', who === 'me' ? 'TY' : 'ANALIZA'), document.createTextNode(text));
      panel.feed.appendChild(row);
      panel.feed.scrollTop = panel.feed.scrollHeight;
    }
  }

  function setBusy(v, label) {
    busy = v;
    if (panel?.status) panel.status.textContent = v ? label || 'Pracuje...' : current ? `Dokument: ${current.name} (${current.chars.toLocaleString('pl-PL')} znakow)` : 'Brak wczytanego dokumentu.';
    if (panel?.root) panel.root.classList.toggle('busy', v);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('Nie udalo sie odczytac pliku.'));
      r.readAsDataURL(file);
    });
  }

  async function uploadBase64(name, mime, dataBase64) {
    setBusy(true, `Wczytuje ${name}...`);
    try {
      const doc = await api('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mime, dataBase64 }),
      });
      current = doc;
      say('jv', `Wczytano "${doc.name}": ${doc.chars.toLocaleString('pl-PL')} znakow${doc.pages ? `, ${doc.pages} str.` : ''}${doc.ocr ? ' (rozpoznany z obrazu)' : ''}. Robie streszczenie...`);
      await summarize();
      return doc;
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file) {
    if (!isOwner()) return toast('Analiza plikow wymaga zalogowania.');
    if (file.size > 45 * 1024 * 1024) return toast('Plik jest za duzy (limit 45 MB).');
    try {
      await uploadBase64(file.name, file.type, await fileToBase64(file));
    } catch (err) {
      toast(err.message);
      say('jv', `Nie udalo sie: ${err.message}`);
    }
  }

  async function summarize() {
    if (!current) return;
    setBusy(true, 'Streszczam (dlugie pliki chwile trwaja)...');
    try {
      const r = await api(`/api/docs/${current.id}/summary`, { method: 'POST' });
      say('jv', r.summary);
    } catch (err) {
      say('jv', `Streszczenie nie wyszlo: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function ask(question) {
    if (!current) return toast('Najpierw wczytaj dokument.');
    say('me', question);
    setBusy(true, 'Szukam odpowiedzi w dokumencie...');
    try {
      const r = await api(`/api/docs/${current.id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      say('jv', r.answer + (r.sources ? `\n\n[fragmenty: ${r.sources.join(', ')}]` : ''));
    } catch (err) {
      say('jv', `Blad: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  // --- ekran ---

  async function captureScreen() {
    if (window.jarvisDesktop) {
      const r = await window.jarvisDesktop.runAction('zrzut-i-opisz');
      if (r?.ok && r.imageBase64) return { imageBase64: r.imageBase64, mimeType: r.mimeType || 'image/png' };
      throw new Error(r?.error || 'Nie udalo sie zrobic zrzutu ekranu.');
    }
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Ta przegladarka nie umie przechwycic ekranu.');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    try {
      const video = el('video');
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 250));
      const c = el('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      return { imageBase64: c.toDataURL('image/png').split(',')[1], mimeType: 'image/png' };
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function analyzeScreen(question) {
    if (!isOwner()) return toast('Analiza ekranu wymaga zalogowania.');
    setBusy(true, 'Patrze na ekran...');
    try {
      const shot = await captureScreen();
      const r = await api('/api/screen/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...shot, question }),
      });
      say('me', question ? `Ekran: ${question}` : 'Co jest na ekranie?');
      say('jv', r.answer);
      // Odpowiedz tez do glownej rozmowy i na glos - o to prosisz mowiac "co jest na ekranie".
      pushSaid('jv', r.answer);
      speak(r.answer.slice(0, 600));
      return r.answer;
    } finally {
      setBusy(false);
    }
  }

  // Akcje wywolywane przez Jarvisa ([AKCJA: analizuj-ekran | pytanie]).
  UI.clientActions['analizuj-ekran'] = (params) => analyzeScreen(params?.pytanie || '');

  // Po tym, jak aplikacja desktopowa odczyta plik z dysku, wysylamy go do analizy.
  window.addEventListener('jarvis:action-result', (e) => {
    const { name, result } = e.detail || {};
    if (name !== 'wczytaj-plik-pc' || !result?.dataBase64) return;
    UI.openWindow('analysis');
    const ext = (result.nazwa.split('.').pop() || '').toLowerCase();
    const mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || '';
    uploadBase64(result.nazwa, mime, result.dataBase64).catch((err) => {
      toast(err.message);
      say('jv', `Nie udalo sie: ${err.message}`);
    });
  });

  UI.analysis = { uploadFile, analyzeScreen, ask };

  // --- panel ---
  const def = {
    title: 'ANALIZA DOKUMENTOW I EKRANU',
    glyph: '◰',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const root = el('div', 'analysis');

      const status = el('div', 'sub', 'Brak wczytanego dokumentu.');
      status.style.marginBottom = '8px';

      const drop = el('div', 'dropzone');
      drop.append(el('b', null, 'Przeciagnij plik tutaj'), el('span', null, ' albo kliknij. PDF, DOCX, obrazy, tekst, kod, CSV, JSON — do 45 MB, takze bardzo dlugie.'));
      const input = el('input');
      input.type = 'file';
      input.hidden = true;
      drop.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        if (input.files?.[0]) uploadFile(input.files[0]);
        input.value = '';
      });
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) uploadFile(f);
      });

      const actions = el('div', 'field');
      actions.style.marginTop = '10px';
      const bScreen = el('button', 'btn', 'ANALIZUJ EKRAN');
      bScreen.addEventListener('click', () => analyzeScreen('').catch((err) => toast(err.message)));
      const bSum = el('button', 'btn ghost', 'STRESC PONOWNIE');
      bSum.addEventListener('click', () => (current ? summarize() : toast('Najpierw wczytaj dokument.')));
      actions.append(bScreen, bSum);

      const pathRow = el('div', 'field');
      const pathInp = el('input', 'inp');
      pathInp.placeholder = window.jarvisDesktop ? 'Sciezka do pliku na komputerze, np. C:\\Users\\Ty\\Documents\\umowa.pdf' : 'Sciezki do plikow na dysku dzialaja w aplikacji desktopowej';
      pathInp.disabled = !window.jarvisDesktop;
      const pathBtn = el('button', 'btn ghost', 'WCZYTAJ');
      pathBtn.disabled = !window.jarvisDesktop;
      pathBtn.addEventListener('click', () => {
        if (pathInp.value.trim()) UI.runDeviceAction('wczytaj-plik-pc', { sciezka: pathInp.value.trim() });
      });
      pathRow.append(pathInp, pathBtn);

      const feed = el('div', 'feed');
      feed.style.maxHeight = '46vh';
      state.log.forEach((m) => {
        const row = el('div', `said ${m.who === 'me' ? 'me' : 'jv'}`);
        row.append(el('span', 'who', m.who === 'me' ? 'TY' : 'ANALIZA'), document.createTextNode(m.text));
        feed.appendChild(row);
      });

      const form = el('form', 'field');
      const q = el('input', 'inp');
      q.placeholder = 'Zapytaj o wczytany dokument...';
      const go = el('button', 'btn primary', '→');
      go.type = 'submit';
      form.append(q, go);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = q.value.trim();
        if (!text || busy) return;
        q.value = '';
        ask(text);
      });

      root.append(status, drop, actions, pathRow, feed, form);
      body.appendChild(root);
      panel = { root, status, feed };
      setBusy(false);
    },
    async refresh() {
      if (!isOwner()) return;
      try {
        const r = await api('/api/docs');
        const doc = r.docs.find((d) => d.id === r.current);
        if (doc) current = doc;
        setBusy(false);
      } catch {
        /* serwer mogl sie zrestartowac - dokumenty sa w pamieci, wczytaj ponownie */
      }
    },
  };

  UI.register({ id: 'analysis', title: 'Analiza', sub: 'dokumenty i ekran', icon: '◰', owner: true, panels: { analysis: def } });
})();
