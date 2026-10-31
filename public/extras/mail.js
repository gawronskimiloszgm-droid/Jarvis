// Skrzynka: triage maili z Gmaila (kategoria, streszczenie, podpowiedz),
// szkic odpowiedzi na klik i wysylka dopiero po jawnym potwierdzeniu.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;

  const COLORS = { pilny: 'var(--red, #ff5a5a)', odpowiedz: 'var(--amber, #ffb648)', info: 'var(--cyan, #4fd8ff)', spam: 'var(--dim, #7a8a94)' };
  const LABEL = { pilny: 'PILNY', odpowiedz: 'ODPISZ', info: 'INFO', spam: 'SPAM' };

  function emailOf(from) {
    const m = String(from).match(/<([^>]+)>/);
    return (m ? m[1] : from).trim();
  }

  const def = {
    title: 'SKRZYNKA - PRZEGLAD',
    glyph: '✉',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) {
        body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
        return;
      }
      const bar = el('div', 'field');
      const reload = el('button', 'btn primary', 'ODSWIEZ PRZEGLAD');
      bar.appendChild(reload);
      const list = el('div');
      list.style.marginTop = '10px';
      body.append(bar, list);

      async function load(force) {
        list.innerHTML = '';
        list.appendChild(el('div', 'hint', 'Czytam skrzynke...'));
        try {
          const data = await api(`/api/triage/mail${force ? '?force=1' : ''}`);
          list.innerHTML = '';
          data.items.forEach((m) => list.appendChild(card(m)));
          if (!data.items.length) list.appendChild(el('div', 'hint', 'Skrzynka pusta.'));
        } catch (e) {
          list.innerHTML = '';
          list.appendChild(el('div', 'hint', e.message));
        }
      }

      function card(m) {
        const c = el('div', 'row');
        c.style.cssText = 'display:block;border-left:3px solid ' + (COLORS[m.kategoria] || 'var(--line-3)') + ';padding:6px 10px;margin:6px 0';
        const head = el('div', 'row-text', `${LABEL[m.kategoria] || ''}${m.unread ? ' • nowy' : ''} — ${m.subject}`);
        head.style.fontWeight = '600';
        const from = el('div', 'sub', m.from);
        const sum = el('div', 'row-text', m.streszczenie);
        const act = el('div', 'sub', m.akcja ? `→ ${m.akcja}` : '');
        const btns = el('div', 'field');
        btns.style.marginTop = '4px';
        const draftBtn = el('button', 'btn ghost', 'SZKIC ODPOWIEDZI');
        btns.appendChild(draftBtn);
        const calBtn = el('button', 'btn ghost', 'DO KALENDARZA');
        btns.appendChild(calBtn);
        calBtn.addEventListener('click', async () => {
          area.innerHTML = '';
          calBtn.disabled = true;
          try {
            const ev = await api('/api/triage/mail/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) });
            if (!ev.jest) {
              toast('W tym mailu nie widzę konkretnego terminu.', 'ok');
              return;
            }
            const t = el('input', 'inp');
            t.value = ev.tytul || m.subject;
            const s = el('input', 'inp');
            s.type = 'datetime-local';
            s.value = String(ev.start || '').slice(0, 16);
            const e2 = el('input', 'inp');
            e2.type = 'datetime-local';
            e2.value = String(ev.koniec || '').slice(0, 16);
            const add = el('button', 'btn primary', 'DODAJ DO KALENDARZA');
            add.addEventListener('click', async () => {
              try {
                await api('/api/calendar/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t.value, startISO: s.value, endISO: e2.value || undefined, description: `Z maila: ${m.subject}` }) });
                toast('Dodano do kalendarza.', 'ok');
                area.innerHTML = '';
              } catch (e) {
                toast(e.message);
              }
            });
            area.append(el('div', 'sub', 'SPRAWDŹ I ZATWIERDŹ'), t, s, e2, add);
          } catch (e) {
            toast(e.message);
          } finally {
            calBtn.disabled = false;
          }
        });
        const area = el('div');
        draftBtn.addEventListener('click', async () => {
          area.innerHTML = '';
          try {
            const d = await api('/api/triage/mail/draft', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: m.id }),
            });
            const ta = el('textarea', 'inp');
            ta.rows = 6;
            ta.style.width = '100%';
            ta.value = d.draft;
            const send = el('button', 'btn danger', 'WYSLIJ');
            send.addEventListener('click', async () => {
              if (!window.confirm(`Wyslac te odpowiedz do ${emailOf(d.to)}?`)) return;
              try {
                await api('/api/comms/gmail/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ to: emailOf(d.to), subject: d.subject, body: ta.value, threadId: d.threadId, confirm: true }),
                });
                toast('Wyslano.', 'ok');
                area.innerHTML = '';
              } catch (e) {
                toast(e.message);
              }
            });
            area.append(ta, send);
          } catch (e) {
            toast(e.message);
          }
        });
        c.append(head, from, sum, act, btns, area);
        return c;
      }

      reload.addEventListener('click', () => load(true));
      load(false);
    },
  };

  UI.register({ id: 'mail', title: 'Poczta', sub: 'triage skrzynki', icon: '✉', owner: true, panels: { mail: def } });
})();
