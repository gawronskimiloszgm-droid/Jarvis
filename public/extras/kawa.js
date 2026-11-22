// Modul Kawa: ekspres Philips z aplikacji HomeID przez chmure Philips (server/extras/kawa.js).
// Parzenie zawsze w dwoch krokach: wybor napoju przygotowuje zlecenie, a dopiero przycisk ZAPARZ
// (stukniecie czlowieka) je wykonuje. Polecenie glosowe tylko pokazuje karte z tym przyciskiem.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.register) return;
  const { el, api, toast, isOwner } = UI;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const row = (...kids) => {
    const r = el('div', 'field');
    r.style.cssText = 'gap:6px;flex-wrap:wrap;margin:6px 0;align-items:center';
    r.append(...kids);
    return r;
  };
  const button = (label, fn, cls = 'btn') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        toast(e.message);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };
  const input = (ph, type = 'text', w = '220px') => {
    const i = el('input', 'inp');
    i.placeholder = ph;
    i.type = type;
    i.style.flex = `0 1 ${w}`;
    return i;
  };
  const changed = () => window.dispatchEvent(new Event('jarvis:kawa'));

  // ---------- karta potwierdzenia (z panelu albo po poleceniu glosowym) ----------
  let card = null;
  function confirmCard({ id, napoj, rodzaj }) {
    card?.remove();
    card = el('div');
    card.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:rgba(6,16,22,.97);border:1px solid #ffb347;border-radius:12px;padding:16px 18px;width:min(92vw,420px);box-shadow:0 10px 40px rgba(0,0,0,.6);color:#e8f6ff';
    const left = el('div', 'w-dim', '');
    card.append(
      el('div', 'w-mid', rodzaj === 'power_on' ? 'Włączyć ekspres?' : `Zaparzyć: ${napoj}?`),
      el('div', 'w-dim', rodzaj === 'power_on' ? 'Po włączeniu ekspres płucze dyszę gorącą wodą: podstaw naczynie.' : 'Podstaw kubek pod dyszę. Bez Twojego kliknięcia nic się nie zaparzy.'),
      left,
    );
    const go = button(rodzaj === 'power_on' ? 'WŁĄCZ' : 'ZAPARZ', async () => {
      clearInterval(tick);
      go.textContent = rodzaj === 'power_on' ? 'WŁĄCZAM...' : 'PARZĘ...';
      try {
        const r = await api('/api/kawa/confirm', json('POST', { id }));
        toast(r.text || 'Gotowe.', 'ok');
        if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `${r.text} Powiedz to krótko.` });
      } catch (e) {
        toast(e.message);
        if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `Ekspres: ${e.message} Powiedz to krótko.` });
      }
      card?.remove();
      changed();
    }, 'btn primary');
    const no = button('ANULUJ', async () => {
      clearInterval(tick);
      card?.remove();
    }, 'btn ghost');
    card.appendChild(row(go, no));
    document.body.appendChild(card);
    navigator.vibrate?.(60);
    const until = Date.now() + 85000;
    const tick = setInterval(() => {
      const s = Math.round((until - Date.now()) / 1000);
      if (s <= 0 || !document.body.contains(card)) {
        clearInterval(tick);
        card?.remove();
        return;
      }
      left.textContent = `Wygasa za ${s} s.`;
    }, 1000);
  }
  UI.clientActions['kawa-potwierdz'] = (p) => {
    if (p?.id) confirmCard(p);
  };
  async function order(kind, drink, name) {
    const r = await api('/api/kawa/prepare', json('POST', { kind, drink }));
    confirmCard({ id: r.id, napoj: name || r.drink?.name, rodzaj: kind });
  }

  // ---------- panel ----------
  const panel = {
    title: 'EKSPRES PHILIPS',
    glyph: '☕',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) return body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
      const box = el('div');
      body.appendChild(box);

      function loginView(s) {
        box.appendChild(el('div', 'w-mid', 'Połącz ekspres kontem Philips HomeID (tym samym co w aplikacji).'));
        box.appendChild(el('div', 'w-dim', 'Philips wyśle kod na e-mail. Połączenie jest nieoficjalne (Philips nie udostępnia API): może przestać działać po zmianach u Philipsa.'));
        const email = input('e-mail konta HomeID', 'email');
        const code = input('kod z e-maila', 'text', '140px');
        code.autocomplete = 'one-time-code';
        const step2 = row(code, button('POŁĄCZ', async () => {
          const r = await api('/api/kawa/login/verify', json('POST', { email: email.value, code: code.value }));
          toast(r.devices?.length ? `Połączono. Urządzeń: ${r.devices.length}` : 'Połączono, ale na koncie nie ma ekspresu z chmurą Philips.', 'ok');
          load();
        }, 'btn primary'));
        step2.hidden = true;
        box.append(row(email, button('WYŚLIJ KOD', async () => {
          await api('/api/kawa/login/code', json('POST', { email: email.value }));
          step2.hidden = false;
          toast('Kod wysłany na e-mail.', 'ok');
          code.focus();
        })), step2);
        if (s.devices?.length && !s.device) devicePick(s);
      }
      function devicePick(s) {
        box.appendChild(el('div', 'w-mid', 'Który to ekspres?'));
        for (const d of s.devices) box.appendChild(row(button(`${d.name}${d.ctn ? ` (${d.ctn})` : ''}`, async () => {
          await api('/api/kawa/device', json('POST', { thingName: d.thingName }));
          load();
        })));
      }

      async function load() {
        box.innerHTML = '';
        box.appendChild(el('div', 'w-dim', 'Łączę z ekspresem...'));
        let s;
        try {
          s = await api('/api/kawa/status');
        } catch (e) {
          box.textContent = e.message;
          return;
        }
        box.innerHTML = '';
        if (!s.connected) {
          if (s.devices?.length && !s.device) return devicePick(s);
          return loginView(s);
        }
        const m = s.machine;
        const line = m ? `${s.device?.name || 'Ekspres'} · ${m.online ? (m.powerOn ? `włączony · ${m.state}` : 'w czuwaniu') : 'offline'}${m.extra ? ` · ${m.extra}` : ''}` : `${s.device?.name || 'Ekspres'} · ${s.machineError || 'brak odpowiedzi'}`;
        box.appendChild(el('div', 'w-mid', line));
        if (m?.problems?.length) box.appendChild(el('div', 'hint', `Uwaga: ${m.problems.join(', ')}`));
        if (s.limit) box.appendChild(el('div', 'hint', `Teraz nie parzę: ${s.limit}.`));
        box.appendChild(el('div', 'w-dim', `Dziś z Jarvisa: ${s.today}/${s.settings.perDay}. Każde parzenie potwierdzasz przyciskiem ZAPARZ.`));

        const fav = new Set(s.settings.favorites);
        const favRow = row();
        for (const d of s.drinks.filter((x) => fav.has(x.id))) favRow.appendChild(button(d.name, () => order('brew', d.id, d.name), 'btn primary'));
        box.append(el('div', 'sub', 'Ulubione:'), favRow);
        const sel = el('select', 'inp');
        for (const d of s.drinks) {
          const o = el('option', null, d.name);
          o.value = String(d.id);
          sel.appendChild(o);
        }
        box.append(el('div', 'sub', 'Wszystkie napoje:'), row(sel, button('PRZYGOTUJ', () => order('brew', Number(sel.value), sel.selectedOptions[0].textContent)), button(fav.has(Number(sel.value)) ? '★' : '☆ DO ULUBIONYCH', async () => {
          const id = Number(sel.value);
          const next = fav.has(id) ? s.settings.favorites.filter((x) => x !== id) : [...s.settings.favorites, id];
          await api('/api/kawa/settings', json('PUT', { favorites: next }));
          load();
        }, 'btn ghost')));
        box.append(el('div', 'sub', 'Ekspres:'), row(
          button('STOP PARZENIA', async () => {
            await api('/api/kawa/stop', { method: 'POST' });
            toast('Przerwano.', 'ok');
          }, 'btn'),
          button('WŁĄCZ', () => order('power_on', null, 'włączenie ekspresu'), 'btn ghost'),
          button('WYŁĄCZ', async () => {
            await api('/api/kawa/power-off', { method: 'POST' });
            toast('Ekspres przechodzi w czuwanie.', 'ok');
            setTimeout(load, 3000);
          }, 'btn ghost'),
          button('ODŚWIEŻ', load, 'btn ghost'),
        ));

        // Zabezpieczenia do ustawienia.
        const perDay = input('dziennie', 'number', '90px');
        perDay.value = s.settings.perDay;
        const qf = input('od', 'time', '110px');
        qf.value = s.settings.quietFrom;
        const qt = input('do', 'time', '110px');
        qt.value = s.settings.quietTo;
        const prof = el('select', 'inp');
        for (let i = 0; i < 8; i++) {
          const o = el('option', null, `profil ${i + 1}`);
          o.value = String(i);
          prof.appendChild(o);
        }
        prof.value = String(s.settings.profileSlot);
        box.append(el('div', 'sub', 'Zabezpieczenia:'), row(el('span', 'w-dim', 'limit dziennie'), perDay, el('span', 'w-dim', 'cisza nocna'), qf, qt, el('span', 'w-dim', 'profil w ekspresie'), prof, button('ZAPISZ', async () => {
          await api('/api/kawa/settings', json('PUT', { perDay: perDay.value, quietFrom: qf.value, quietTo: qt.value, profileSlot: prof.value }));
          toast('Zapisano.', 'ok');
          load();
        }, 'btn ghost')));
        if (s.log.length) {
          box.appendChild(el('div', 'sub', 'Ostatnio:'));
          for (const x of s.log) box.appendChild(el('div', 'w-dim', `${new Date(x.at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${x.drink} · ${x.ok ? 'zaparzone' : `nie: ${x.why}`}`));
        }
        box.appendChild(row(el('span', 'w-dim', `Konto: ${s.email}`), button('ROZŁĄCZ', async () => {
          if (!window.confirm('Rozłączyć ekspres od Jarvisa?')) return;
          await api('/api/kawa/logout', { method: 'POST' });
          load();
        }, 'btn ghost')));
      }
      load();
      const h = () => {
        if (!document.body.contains(body)) return window.removeEventListener('jarvis:kawa', h);
        load();
      };
      window.addEventListener('jarvis:kawa', h);
    },
  };

  UI.register({ id: 'kawa', title: 'Kawa', sub: 'ekspres Philips', icon: '☕', owner: true, group: 'Dom', panels: { kawa: panel } });
})();
