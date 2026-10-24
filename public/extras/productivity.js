// Produktywnosc: notatki glosowe, "przetworz schowek", polecenia z zasobnika
// i globalnego skrotu aplikacji desktopowej, zadania cykliczne.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner, pushSaid, speak, authHeaders } = UI;

  // ---------- schowek + AI ----------
  const OP_LABEL = { streszcz: 'streszczenie', punkty: 'punkty', popraw: 'poprawiony tekst', formalizuj: 'wersja formalna', wyjasnij: 'wyjasnienie', 'tlumacz-en': 'tlumaczenie (EN)', 'tlumacz-pl': 'tlumaczenie (PL)' };

  async function transformClipboard(operation) {
    if (!isOwner()) throw new Error('Wymaga zalogowania.');
    if (!window.jarvisDesktop) throw new Error('Schowek dziala w aplikacji desktopowej.');
    const clip = await window.jarvisDesktop.runAction('schowek-odczyt');
    const text = clip?.tekst || '';
    if (!text.trim()) throw new Error('Schowek jest pusty.');
    const r = await api('/api/text/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, operation }),
    });
    // Wynik trafia z powrotem do schowka (mozna od razu wkleic) i do rozmowy.
    await window.jarvisDesktop.runAction('schowek-zapis', { tekst: r.result });
    pushSaid('jv', `${OP_LABEL[operation] || operation} (wstawione do schowka):\n${r.result}`);
    speak(r.result.slice(0, 500));
    return r.result;
  }
  UI.clientActions['schowek-ai'] = (params) => transformClipboard(String(params?.operacja || 'streszcz'));

  // ---------- wyniki wyszukiwania plikow ----------
  // Akcja [AKCJA: szukaj-plikow | fraza] z czatu nie zwraca wyniku modelowi,
  // wiec pokazujemy go sami: lista w rozmowie + krotka zapowiedz glosem.
  window.addEventListener('jarvis:action-result', (e) => {
    const { name, result } = e.detail || {};
    if (name !== 'szukaj-plikow' || !result?.files) return;
    if (!result.files.length) {
      pushSaid('jv', 'Nic nie znalazlem pod ta fraze.');
      speak('Nic nie znalazlem.');
      return;
    }
    const lines = result.files.slice(0, 12).map((f, i) => (i + 1) + '. ' + f.path + ' (' + Math.round(f.size / 1024) + ' KB, ' + f.modified.slice(0, 10) + ')');
    pushSaid('jv', ['Znalezione pliki:', ...lines].join(String.fromCharCode(10)));
    const newest = result.files[0].path.split(String.fromCharCode(92)).pop();
    speak(`Znalazlem ${result.count} ${result.count === 1 ? 'plik' : 'plikow'}. Najnowszy to ${newest}.`);
  });

  // ---------- notatki glosowe ----------
  let recorder = null;
  let chunks = [];
  let panel = null;

  function fmtDate(ts) {
    return new Date(ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function drawNotes() {
    if (!panel || !isOwner()) return;
    try {
      const { notes } = await api('/api/notes');
      panel.list.innerHTML = '';
      if (!notes.length) panel.list.appendChild(el('div', 'hint', 'Brak notatek. Nagraj pierwsza.'));
      notes.forEach((n) => {
        const card = el('div', 'card');
        const head = el('div', 'card-head');
        head.append(el('span', 'gl', '♪'), el('span', null, `${n.tytul} · ${fmtDate(n.at)}`));
        const body = el('div', 'card-body');
        body.appendChild(el('div', 'row-text', n.streszczenie));
        if (n.punkty.length) body.appendChild(el('div', 'sub', 'PUNKTY')), n.punkty.forEach((p) => body.appendChild(el('div', 'row-text', `• ${p}`)));
        if (n.decyzje.length) body.appendChild(el('div', 'sub', 'DECYZJE')), n.decyzje.forEach((p) => body.appendChild(el('div', 'row-text', `✓ ${p}`)));
        if (n.zadania.length) {
          body.appendChild(el('div', 'sub', 'ZADANIA'));
          n.zadania.forEach((z) => body.appendChild(el('div', 'row-text', `☐ ${z.tresc}${z.kto ? ` — ${z.kto}` : ''}${z.termin ? ` (${z.termin})` : ''}`)));
          const add = el('button', 'btn ghost', 'DODAJ ZADANIA DO LISTY');
          add.addEventListener('click', async () => {
            for (const z of n.zadania) {
              await api('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: z.kto ? `${z.tresc} (${z.kto})` : z.tresc }) }).catch(() => {});
            }
            toast('Dodano do zadan.', 'ok');
            add.disabled = true;
          });
          body.appendChild(add);
        }
        const del = el('button', 'btn ghost', 'USUN');
        del.addEventListener('click', async () => {
          await api(`/api/notes/${n.id}`, { method: 'DELETE' });
          drawNotes();
        });
        body.appendChild(del);
        card.append(head, body);
        panel.list.appendChild(card);
      });
    } catch (err) {
      panel.list.textContent = err.message;
    }
  }

  async function toggleRecording() {
    if (!isOwner()) return toast('Notatki wymagaja zalogowania.');
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toast('Brak dostepu do mikrofonu.');
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const mime = recorder.mimeType || 'audio/webm';
      recorder = null;
      panel.rec.textContent = '● NAGRYWAJ';
      panel.rec.classList.remove('danger');
      panel.status.textContent = 'Przetwarzam nagranie...';
      try {
        const blob = new Blob(chunks, { type: mime });
        if (blob.size > 30 * 1024 * 1024) throw new Error('Nagranie jest za dlugie (limit ok. 30 MB).');
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1]);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        await api('/api/notes/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: b64, mimeType: mime.split(';')[0] }),
        });
        panel.status.textContent = 'Notatka zapisana.';
        drawNotes();
      } catch (err) {
        panel.status.textContent = err.message;
      }
    };
    recorder.start();
    panel.rec.textContent = '■ ZAKONCZ I ZAPISZ';
    panel.rec.classList.add('danger');
    panel.status.textContent = 'Nagrywam... mow normalnie, nagranie moze trwac kilka minut.';
  }

  const notesDef = {
    title: 'NOTATKI GLOSOWE',
    glyph: '♪',
    wide: true,
    build(body) {
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'Nagraj spotkanie albo mysl - dostaniesz tytul, streszczenie, punkty, decyzje i liste zadan (z zapisem calej transkrypcji).'));
      const row = el('div', 'field');
      row.style.marginTop = '10px';
      const rec = el('button', 'btn primary', '● NAGRYWAJ');
      rec.addEventListener('click', toggleRecording);
      row.appendChild(rec);
      const status = el('div', 'sub', '');
      status.style.margin = '6px 0 10px';
      const list = el('div');
      body.append(row, status, list);
      panel = { rec, status, list };
    },
    refresh: drawNotes,
  };
  UI.register({ id: 'notes', title: 'Notatki', sub: 'nagrania i zadania', icon: '♪', owner: true, panels: { notes: notesDef } });

  // ---------- zadania cykliczne na komputerze ----------
  let tasksBody = null;
  async function drawTasks() {
    if (!tasksBody) return;
    tasksBody.innerHTML = '';
    if (!window.jarvisDesktop) {
      tasksBody.appendChild(el('div', 'hint', 'Zadania cykliczne dzialaja w aplikacji desktopowej (to ona wykonuje je na komputerze).'));
      return;
    }
    const list = await window.jarvisDesktop.runAction('zadania-lista');
    (list?.zadania || []).forEach((t) => {
      const row = el('div', 'row');
      const txt = el('div');
      txt.style.flex = '1';
      txt.append(el('div', 'row-text', `${t.name} — ${t.at}${t.days?.length ? ` (${t.days.join(',')})` : ' (codziennie)'}`), el('div', 'sub', `${t.action}${t.lastResult ? ` · ostatnio: ${t.lastResult}` : ''}`));
      const x = el('button', 'row-x', '×');
      x.addEventListener('click', async () => {
        await window.jarvisDesktop.runAction('zadania-usun', { id: t.id });
        drawTasks();
      });
      row.append(txt, x);
      tasksBody.appendChild(row);
    });
    if (!list?.zadania?.length) tasksBody.appendChild(el('div', 'hint', 'Brak zadan. Dodaj nizej albo powiedz: "codziennie o 8:00 zrob skan bezpieczenstwa".'));

    const f = el('form', 'field');
    f.style.marginTop = '10px';
    const at = el('input', 'inp');
    at.placeholder = 'HH:MM';
    at.style.maxWidth = '90px';
    const act = el('input', 'inp');
    act.placeholder = 'akcja, np. skan-bezpieczenstwa';
    const go = el('button', 'btn primary', 'DODAJ');
    go.type = 'submit';
    f.append(at, act, go);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await window.jarvisDesktop.runAction('zadania-dodaj', { godzina: at.value.trim(), akcja: act.value.trim(), nazwa: act.value.trim() });
      if (!r?.ok) toast(r?.error || 'Nie udalo sie.');
      drawTasks();
    });
    tasksBody.appendChild(f);
  }
  const tasksDef = {
    title: 'ZADANIA CYKLICZNE NA PC',
    glyph: '⟳',
    wide: true,
    build(body) {
      tasksBody = body; // rysuje refresh() zaraz po zbudowaniu panelu
    },
    refresh: drawTasks,
  };
  UI.extend('tasks', { pctasks: tasksDef });

  // ---------- polecenia z zasobnika i skrotu globalnego ----------
  if (window.jarvisDesktop?.onCommand) {
    window.jarvisDesktop.onCommand((c) => {
      if (!c) return;
      if (c.type === 'open-edith') window.Edith?.open();
      else if (c.type === 'permission-mode') toast(`Uprawnienia Jarvisa: ${c.mode}`, 'ok');
      else if (c.type === 'hotkey') {
        if (!isOwner()) return;
        if (c.selection) {
          // Skrot z zaznaczonym tekstem: Jarvis dostaje go jako kontekst i pyta, co z nim zrobic.
          UI.sendTyped(`Zaznaczylem ten tekst i wcisnalem skrot. Powiedz krotko, co to jest i zaproponuj, co z tym zrobic (jesli to kod - czy widac bledy):\n\n${c.selection}`);
        } else {
          UI.toggleListening();
        }
      }
    });
  }
})();
