// Doswiadczenie glosowe po stronie klienta:
//  - "Slysze: ..." na zywo (widac, CO model uslyszal, zanim zadziala)
//  - bramka przed akcjami z glosu: opis + 2,5 s na anulowanie (Escape/przycisk)
//  - tryb "nie przeszkadzac"
//  - slownik wlasnych nazw (aliasy) i ustawienia tego wszystkiego w Ustawieniach
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;

  // ---------- "slysze" ----------
  let heardEl = null;
  let heardTimer = null;

  UI.heard = (text) => {
    if (!text) return;
    if (!heardEl) {
      heardEl = el('div', 'heard');
      document.body.appendChild(heardEl);
    }
    heardEl.textContent = `Slysze: ${text.slice(-160)}`;
    heardEl.classList.add('on');
    clearTimeout(heardTimer);
    heardTimer = setTimeout(() => heardEl?.classList.remove('on'), 3500);
  };

  // ---------- bramka przed akcja z glosu ----------
  const GATED = {
    'otworz-aplikacje': (p) => `Otworzyc aplikacje "${p?.nazwa}"`,
    'zamknij-proces': (p) => `Zamknac proces "${p?.nazwa}"`,
    'pisz-tekst': (p) => `Wpisac tekst "${String(p?.tekst || '').slice(0, 60)}"`,
    'przelacz-okno': (p) => `Przelaczyc na okno "${p?.tytul}"`,
    'kliknij-na-ekranie': (p) => `Kliknac w punkcie ${p?.x}%, ${p?.y}%`,
    'wykonaj-na-ekranie': (p) => `Wykonac zadanie: ${String(p?.cel || '').slice(0, 80)}`,
    'wczytaj-plik-pc': (p) => `Wczytac plik ${p?.sciezka}`,
    'uspij-komputer': () => 'Uspic komputer',
    'zablokuj-ekran': () => 'Zablokowac ekran',
  };

  function gateMs() {
    const v = localStorage.getItem('jarvis.voiceGateMs');
    return v == null ? 2500 : Number(v);
  }

  // Zwraca Promise<boolean> - czy wykonac. Dla akcji spoza listy albo przy
  // wylaczonej bramce od razu true.
  UI.voiceGate = (name, params) => {
    const describe = GATED[name];
    const ms = gateMs();
    if (!describe || !ms) return Promise.resolve(true);
    return new Promise((resolve) => {
      const card = el('div', 'voice-gate');
      const label = el('div', 'vg-text', `${describe(params)}?`);
      const bar = el('div', 'vg-bar');
      const fill = el('i');
      fill.style.animationDuration = `${ms}ms`;
      bar.appendChild(fill);
      const no = el('button', 'btn danger', 'ANULUJ');
      const yes = el('button', 'btn primary', 'TERAZ');
      card.append(label, bar, no, yes);
      document.body.appendChild(card);
      const finish = (ok) => {
        clearTimeout(t);
        window.removeEventListener('keydown', onKey);
        card.remove();
        if (!ok) toast('Anulowane - nie wykonuje.', 'ok');
        resolve(ok);
      };
      const onKey = (e) => e.key === 'Escape' && finish(false);
      const t = setTimeout(() => finish(true), ms);
      no.addEventListener('click', () => finish(false));
      yes.addEventListener('click', () => finish(true));
      window.addEventListener('keydown', onKey);
    });
  };

  // ---------- nie przeszkadzac ----------
  UI.dnd = { active: false, until: null };
  let dndLabel = null;

  function drawDnd() {
    if (!dndLabel) return;
    dndLabel.textContent = UI.dnd.active
      ? `Aktywny do ${new Date(UI.dnd.until).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`
      : 'Wylaczony';
  }

  async function loadDnd() {
    if (!isOwner()) return;
    try {
      const d = await api('/api/dnd');
      UI.dnd = { active: d.active, until: d.until };
      drawDnd();
    } catch {
      /* brak serwera - zostaje poprzedni stan */
    }
  }

  async function setDnd(minutes) {
    const d = await api('/api/dnd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes }) });
    UI.dnd = { active: d.active, until: d.until };
    toast(
      d.active
        ? `Nie przeszkadzam do ${new Date(d.until).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.`
        : 'Tryb "nie przeszkadzac" wylaczony.',
      'ok'
    );
    drawDnd();
  }
  UI.clientActions['nie-przeszkadzac'] = (p) => setDnd(Number(p?.minuty ?? p?.minutes) || 0);
  window.addEventListener('jarvis:ready', loadDnd);
  window.addEventListener('jarvis:dnd', loadDnd);

  // ---------- ustawienia: bramka, DND, aliasy ----------
  const voice = {
    title: 'GLOS I SPOKOJ',
    glyph: '☾',
    build(body) {
      body.innerHTML = '';

      body.appendChild(el('div', 'sub', 'BRAMKA PRZED AKCJA Z GLOSU'));
      const sel = el('select', 'inp');
      [['0', 'wylaczona'], ['1500', '1,5 s'], ['2500', '2,5 s (domyslnie)'], ['5000', '5 s']].forEach(([v, l]) => {
        const o = el('option', null, l);
        o.value = v;
        sel.appendChild(o);
      });
      sel.value = String(gateMs());
      sel.addEventListener('change', () => localStorage.setItem('jarvis.voiceGateMs', sel.value));
      const gateRow = el('div', 'field');
      gateRow.style.margin = '6px 0 4px';
      gateRow.appendChild(sel);
      body.appendChild(gateRow);
      body.appendChild(
        el('div', 'sub', 'Gdy Jarvis zrozumie polecenie z glosu (otworz, wpisz, kliknij...), pokazuje co zrozumial i czeka chwile, zeby mozna bylo anulowac przeslyszenie. Escape = anuluj.')
      );

      const h = el('div', 'sub', 'NIE PRZESZKADZAJ');
      h.style.marginTop = '14px';
      body.appendChild(h);
      dndLabel = el('div', 'row-text', '...');
      body.appendChild(dndLabel);
      const dr = el('div', 'field');
      dr.style.marginTop = '6px';
      [[30, '30 min'], [60, '1 godz.'], [180, '3 godz.'], [0, 'WYLACZ']].forEach(([m, l]) => {
        const b = el('button', m ? 'btn ghost' : 'btn', l);
        b.addEventListener('click', () => setDnd(m).catch((e) => toast(e.message)));
        dr.appendChild(b);
      });
      body.appendChild(dr);
      body.appendChild(el('div', 'sub', 'Jarvis sam sie nie odzywa, nie ma glosu w czacie, wstrzymane przypomnienia i briefingi (alarmy bezpieczenstwa E.D.I.T.H. i prosby o zgode zostaja).'));
      loadDnd();
    },
  };

  const aliasesPanel = {
    title: 'SLOWNIK WLASNYCH NAZW',
    glyph: '≋',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) {
        body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
        return;
      }
      body.appendChild(
        el('div', 'sub', 'Nazwy, ktore Jarvis slabo slyszy albo myli: "kasia" = zona, "projekt" = C:/Projekty/Jarvis. Trafiaja do jego instrukcji - mniej pomylek na sluch.')
      );
      const list = el('div');
      list.style.margin = '8px 0';
      const form = el('form', 'field');
      const a = el('input', 'inp');
      a.placeholder = 'fraza (jak to mowisz)';
      const b = el('input', 'inp');
      b.placeholder = 'co to znaczy';
      const go = el('button', 'btn primary', 'DODAJ');
      go.type = 'submit';
      form.append(a, b, go);

      async function draw(items) {
        list.innerHTML = '';
        const data = items || (await api('/api/aliases')).aliases;
        data.forEach((x) => {
          const row = el('div', 'row');
          const t = el('div', 'row-text', `"${x.fraza}" = ${x.znaczenie}`);
          t.style.flex = '1';
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', async () => draw((await api(`/api/aliases?fraza=${encodeURIComponent(x.fraza)}`, { method: 'DELETE' })).aliases));
          row.append(t, del);
          list.appendChild(row);
        });
        if (!data.length) list.appendChild(el('div', 'hint', 'Brak wpisow.'));
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!a.value.trim() || !b.value.trim()) return;
        try {
          await draw((await api('/api/aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fraza: a.value, znaczenie: b.value }) })).aliases);
          a.value = '';
          b.value = '';
        } catch (err) {
          toast(err.message);
        }
      });
      body.append(list, form);
      draw().catch(() => {});
    },
  };

  UI.extend('set', { voiceux: voice, aliases: aliasesPanel });
})();
