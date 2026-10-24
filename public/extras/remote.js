// Pilot: telefon steruje komputerem (przez serwer), a komputer wysyla
// powiadomienia na telefon.
//  - PC (aplikacja desktopowa): jesli wlaczysz "zdalne sterowanie", odbiera
//    polecenia long-pollem, wykonuje je przez ta sama polityke E.D.I.T.H. i
//    wpisuje do dziennika audytowego ze zrodlem "telefon".
//  - Telefon/przegladarka: panel z przyciskami, zrzut ekranu, pisanie tekstu.
//  - Powiadomienia: "powiadom mnie na telefonie" i "powiadom gdy proces X sie
//    skonczy", plus ostrzezenie o niskiej baterii laptopa.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- strona komputera (host) ----------
  let hostRunning = false;

  async function execute(cmd) {
    let res;
    try {
      // Czlowiek dotknal przycisku na telefonie = jawna zgoda; tryb "tylko
      // podglad" nadal blokuje wszystko, co cokolwiek zmienia.
      res = await D().runAction(cmd.action, cmd.params, { confirmedByEdith: true });
    } catch (err) {
      res = { ok: false, error: err?.message || 'blad wykonania' };
    }
    const verdict = res?.blocked ? 'blocked' : res?.ok === false ? 'failed' : 'ok';
    api('/api/audit', json({ name: cmd.action, detail: Object.entries(cmd.params || {}).map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(' '), verdict, note: res?.edithReason || res?.error || '', source: 'telefon' })).catch(() => {});
    const out = { ok: Boolean(res?.ok), error: res?.error || res?.edithReason || undefined };
    if (res?.imageBase64) {
      out.imageBase64 = res.imageBase64;
      out.mimeType = res.mimeType || 'image/png';
    }
    if (res?.windows) out.windows = res.windows;
    if (res?.processes) out.processes = res.processes;
    if (typeof res?.tekst === 'string') out.tekst = res.tekst.slice(0, 4000);
    await api('/api/remote/result', json({ id: cmd.id, result: out })).catch(() => {});
  }

  async function hostLoop() {
    if (hostRunning) return;
    hostRunning = true;
    const device = encodeURIComponent((await D().getSetting('deviceName').catch(() => '')) || 'komputer');
    for (;;) {
      if (!isOwner()) {
        await sleep(10000);
        continue;
      }
      const on = await D().getSetting('remoteControl').catch(() => false);
      if (!on) {
        await sleep(4000);
        continue;
      }
      try {
        const r = await api(`/api/remote/poll?device=${device}`);
        if (r?.cmd) await execute(r.cmd);
      } catch {
        await sleep(5000);
      }
    }
  }

  window.addEventListener('jarvis:ready', () => {
    if (D() && isOwner()) hostLoop();
  });

  // ---------- powiadomienia komputer -> telefon ----------
  async function notify(body, title) {
    const r = await api('/api/notify', json({ title: title || 'J.A.R.V.I.S. (komputer)', body }));
    return r;
  }
  UI.notifyPhone = notify;

  UI.clientActions['powiadom-telefon'] = async (p) => {
    const text = String(p?.tresc || p?.text || '').trim();
    if (!text) return toast('Co mam wyslac na telefon?');
    const r = await notify(text);
    toast(r.sent ? 'Wyslano na telefon.' : `Nie wyslano: ${r.reason || 'blad'}`, r.sent ? 'ok' : undefined);
  };

  // "powiadom gdy proces X sie skonczy": czekamy az proces zniknie.
  const watching = new Map();
  UI.clientActions['powiadom-gdy-proces'] = async (p) => {
    const name = String(p?.nazwa || '').trim();
    if (!name) return toast('Podaj nazwe procesu.');
    if (!D()) return toast('Obserwowanie procesow dziala w aplikacji desktopowej.');
    if (watching.has(name)) return toast(`Juz obserwuje: ${name}`);
    const first = await D().runAction('proces-dziala', { nazwa: name });
    if (!first?.ok) return toast(first?.error || 'Nie moge sprawdzic procesu.');
    if (!first.dziala) return toast(`Proces "${name}" teraz nie dziala.`);
    toast(`Dam znac na telefonie, gdy "${name}" sie zakonczy.`, 'ok');
    const started = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - started > 12 * 3600 * 1000) {
        clearInterval(t);
        watching.delete(name);
        return;
      }
      const r = await D().runAction('proces-dziala', { nazwa: name }).catch(() => null);
      if (r?.ok && !r.dziala) {
        clearInterval(t);
        watching.delete(name);
        notify(`Proces "${name}" sie zakonczyl.`).catch(() => {});
        UI.pushSaid?.('jv', `Proces "${name}" sie zakonczyl - wyslalem informacje na telefon.`);
      }
    }, 15000);
    watching.set(name, t);
  };

  // Bateria: jedno ostrzezenie na epizod rozladowania.
  let batteryWarned = false;
  async function checkBattery() {
    if (!D() || !isOwner()) return;
    const b = await D().runAction('bateria').catch(() => null);
    if (!b?.ok || !b.has) return;
    if (!b.charging && b.percent <= 15 && !batteryWarned) {
      batteryWarned = true;
      notify(`Laptop ma ${b.percent}% baterii i nie jest podlaczony do pradu.`, 'Niski poziom baterii').catch(() => {});
    } else if (b.charging || b.percent > 30) batteryWarned = false;
  }
  window.addEventListener('jarvis:ready', () => {
    if (D() && isOwner()) setInterval(checkBattery, 5 * 60 * 1000);
  });

  // ---------- panel pilota ----------
  const BUTTONS = [
    ['odtworz-pauza', '⏯', 'Odtworz / pauza'],
    ['poprzedni-utwor', '⏮', 'Poprzedni'],
    ['nastepny-utwor', '⏭', 'Nastepny'],
    ['ciszej', '🔉', 'Ciszej'],
    ['glosniej', '🔊', 'Glosniej'],
    ['wycisz', '🔇', 'Wycisz'],
    ['zablokuj-ekran', '🔒', 'Zablokuj'],
    ['pokaz-pulpit', '🖥', 'Pulpit'],
    ['zamknij-okno', '✕', 'Zamknij okno'],
  ];
  const POWER = [
    ['uspij-komputer', 'USPIJ'],
    ['restart-komputera', 'RESTART'],
    ['wylacz-komputer', 'WYLACZ'],
  ];

  async function sendRemote(action, params, confirmed) {
    const { id } = await api('/api/remote/command', json({ action, params, confirmed }));
    for (let i = 0; i < 40; i++) {
      await sleep(i < 4 ? 400 : 1000);
      const r = await api(`/api/remote/result/${id}`);
      if (r.done) return r.result;
    }
    throw new Error('Komputer nie odpowiedzial na czas.');
  }

  const def = {
    title: 'PILOT KOMPUTERA',
    glyph: '⌘',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) {
        body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
        return;
      }

      // Sekcja hosta - tylko na komputerze z aplikacja desktopowa.
      if (D()) {
        const host = el('div');
        host.style.marginBottom = '14px';
        const state = el('div', 'row-text');
        const tgl = el('button', 'btn');
        const paint = async () => {
          const on = await D().getSetting('remoteControl');
          state.textContent = on
            ? 'Zdalne sterowanie WLACZONE - ten komputer przyjmuje polecenia z Twojego telefonu (przez E.D.I.T.H., z zapisem w dzienniku).'
            : 'Zdalne sterowanie wylaczone - komputer ignoruje polecenia z telefonu.';
          tgl.textContent = on ? 'WYLACZ ZDALNE STEROWANIE' : 'WLACZ ZDALNE STEROWANIE';
          tgl.className = on ? 'btn danger' : 'btn primary';
        };
        tgl.addEventListener('click', async () => {
          const on = await D().getSetting('remoteControl');
          if (!on && !window.confirm('Wlaczyc przyjmowanie polecen z telefonu na tym komputerze?')) return;
          await D().setSetting('remoteControl', !on);
          if (on) api('/api/remote/disable', json({})).catch(() => {});
          paint();
        });
        host.append(state, tgl);
        body.appendChild(host);
        paint();
      }

      const status = el('div', 'row-text');
      body.appendChild(status);
      const refreshStatus = async () => {
        try {
          const s = await api('/api/remote/status');
          status.textContent = s.online ? `Komputer "${s.device}" jest online i slucha.` : 'Komputer offline albo zdalne sterowanie wylaczone.';
          status.style.color = s.online ? 'var(--good)' : 'var(--dim)';
        } catch {
          status.textContent = '';
        }
      };
      refreshStatus();
      const poll = setInterval(() => (document.body.contains(body) ? refreshStatus() : clearInterval(poll)), 10000);

      const shot = el('img');
      shot.style.cssText = 'max-width:100%;margin-top:10px;border:1px solid var(--line);display:none';
      const run = async (action, params, confirmed) => {
        try {
          const r = await sendRemote(action, params, confirmed);
          if (!r.ok) return toast(r.error || `Nie udalo sie: ${action}`);
          toast('Wykonano.', 'ok');
          if (r.imageBase64) {
            shot.src = `data:${r.mimeType || 'image/png'};base64,${r.imageBase64}`;
            shot.style.display = 'block';
          }
          return r;
        } catch (e) {
          toast(e.message);
        }
      };

      const grid = el('div', 'field');
      grid.style.cssText = 'flex-wrap:wrap;gap:8px;margin:10px 0';
      BUTTONS.forEach(([a, g, l]) => {
        const b = el('button', 'btn ghost', `${g} ${l}`);
        b.addEventListener('click', () => run(a, {}));
        grid.appendChild(b);
      });
      const snap = el('button', 'btn primary', '📷 ZRZUT EKRANU');
      snap.addEventListener('click', () => run('zrzut-i-opisz', {}));
      grid.appendChild(snap);
      body.appendChild(grid);

      const form = (label, placeholder, action, key) => {
        const f = el('form', 'field');
        f.style.marginBottom = '8px';
        const inp = el('input', 'inp');
        inp.placeholder = placeholder;
        const go = el('button', 'btn', label);
        go.type = 'submit';
        f.append(inp, go);
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!inp.value.trim()) return;
          run(action, { [key]: inp.value.trim() }).then(() => (inp.value = ''));
        });
        body.appendChild(f);
      };
      form('OTWORZ', 'nazwa aplikacji (np. notepad, chrome)', 'otworz-aplikacje', 'nazwa');
      form('WPISZ', 'tekst do wpisania w aktywnym oknie', 'pisz-tekst', 'tekst');

      const pw = el('div', 'field');
      pw.style.marginTop = '12px';
      POWER.forEach(([a, l]) => {
        const b = el('button', 'btn danger', l);
        b.addEventListener('click', () => {
          if (window.confirm(`Na pewno: ${l} komputera?`)) run(a, {}, true);
        });
        pw.appendChild(b);
      });
      body.append(pw, shot);
    },
  };
  UI.register({ id: 'remote', title: 'Pilot PC', sub: 'sterowanie z telefonu', icon: '⌘', owner: true, panels: { remote: def } });
})();
