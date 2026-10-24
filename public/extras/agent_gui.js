// Agent ekranu: Jarvis sam prowadzi zadanie w aplikacjach.
//
// Petla: zrzut ekranu + lista nazwanych elementow okna (UI Automation) ->
// serwer wybiera JEDEN krok -> wykonujemy go przez aplikacje desktopowa
// (czyli przez polityke E.D.I.T.H.) -> nastepna runda widzi efekt na nowym
// zrzucie. Zawsze widoczny przycisk STOP, twardy limit krokow, a krok
// wymagajacy zgody E.D.I.T.H. zatrzymuje petle do decyzji uzytkownika.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, api, toast, isOwner, pushSaid, speak } = UI;

  const MAX_STEPS = 20;
  const STEP_PAUSE_MS = 900;
  const SHORTCUTS = new Set(['ctrl+c', 'ctrl+v', 'ctrl+z', 'alt+tab']);

  let run = null; // { goal, abort, steps }
  let ui = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(text, cls) {
    if (!ui) return;
    const row = el('div', `agent-step ${cls || ''}`, text);
    ui.log.appendChild(row);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function setRunning(v) {
    if (!ui) return;
    ui.start.disabled = v;
    ui.stop.disabled = !v;
    ui.goal.disabled = v;
  }

  function audit(name, detail, verdict, note) {
    api('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, detail, verdict, note, source: 'agent-ekranu' }),
    }).catch(() => {});
  }

  async function desktop(name, params, options) {
    return window.jarvisDesktop.runAction(name, params, options);
  }

  // Pyta uzytkownika o zgode w panelu i czeka na decyzje (albo STOP).
  function askUser(text, positive = 'ZGADZAM SIE') {
    return new Promise((resolve) => {
      const box = el('div', 'agent-ask');
      box.appendChild(el('div', null, text));
      const yes = el('button', 'btn primary', positive);
      const no = el('button', 'btn danger', 'NIE');
      const done = (v) => {
        box.remove();
        resolve(v);
      };
      yes.addEventListener('click', () => done(true));
      no.addEventListener('click', () => done(false));
      box.append(yes, no);
      ui.log.appendChild(box);
      ui.log.scrollTop = ui.log.scrollHeight;
      run.pendingAsk = () => done(false);
    });
  }

  // Wykonuje krok. Zwraca { wynik, stop? }.
  async function execute(s) {
    const withConfirm = async (name, params) => {
      let r = await desktop(name, params);
      if (r?.requiresEdithConfirmation) {
        const ok = await askUser(`E.D.I.T.H.: ${r.warning || r.reason}`, 'POTWIERDZAM');
        if (!ok) return { ok: false, error: 'uzytkownik odmowil' };
        r = await desktop(name, params, { confirmedByEdith: true });
      }
      return r;
    };
    let r;
    switch (s.akcja) {
      case 'kliknij_element':
        r = await withConfirm('kliknij-element', { nazwa: s.nazwa });
        break;
      case 'wpisz_w_element':
        r = await withConfirm('wpisz-w-element', { nazwa: s.nazwa || '', tekst: s.tekst || '' });
        break;
      case 'kliknij_xy':
        r = await withConfirm('kliknij-na-ekranie', { x: s.x, y: s.y });
        break;
      case 'pisz_tekst':
        r = await withConfirm('pisz-tekst', { tekst: s.tekst || '' });
        break;
      case 'skrot': {
        const k = String(s.klawisze || '').toLowerCase();
        if (!SHORTCUTS.has(k)) return { wynik: 'niedozwolony skrot' };
        r = await withConfirm('skrot-klawiszowy', { keys: k });
        break;
      }
      case 'otworz_aplikacje':
        r = await withConfirm('otworz-aplikacje', { nazwa: s.nazwa });
        await sleep(1800);
        break;
      case 'przelacz_okno':
        r = await withConfirm('przelacz-okno', { tytul: s.nazwa });
        break;
      case 'czekaj':
        await sleep(1500);
        return { wynik: 'odczekano' };
      default:
        return { wynik: 'nieznany krok' };
    }
    if (r?.blocked) return { wynik: `zablokowane przez E.D.I.T.H.: ${r.edithReason || ''}` };
    return { wynik: r?.ok === false ? `blad: ${r.error || 'nie udalo sie'}` : 'ok' };
  }

  async function start(goal) {
    if (!isOwner()) return toast('Agent ekranu wymaga zalogowania.');
    if (!window.jarvisDesktop) return toast('Agent ekranu dziala tylko w aplikacji desktopowej.');
    if (run) return toast('Agent juz pracuje.');
    run = { goal, abort: false, steps: [], pendingAsk: null };
    setRunning(true);
    log(`CEL: ${goal}`, 'goal');
    audit('agent-start', goal, 'allowed');
    pushSaid('jv', `Biore sie za to: ${goal}`);

    try {
      for (let n = 1; n <= MAX_STEPS && !run.abort; n++) {
        const shot = await desktop('zrzut-i-opisz');
        if (!shot?.ok) throw new Error(shot?.error || 'zrzut ekranu nie powiodl sie');
        const listing = await desktop('lista-elementow', { limit: 120 });
        const step = await api('/api/agent/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal,
            step: n,
            imageBase64: shot.imageBase64,
            mimeType: shot.mimeType,
            elements: listing?.elements || [],
            windowTitle: listing?.window || '',
            history: run.steps,
          }),
        });
        if (run.abort) break;
        log(`${n}. ${step.obserwacja}`, 'obs');

        if (step.akcja === 'koniec') {
          log(`GOTOWE: ${step.wiadomosc || 'cel osiagniety'}`, 'done');
          audit('agent-koniec', goal, 'ok', step.wiadomosc);
          pushSaid('jv', step.wiadomosc || 'Zrobione.');
          speak(String(step.wiadomosc || 'Zrobione.').slice(0, 300));
          return;
        }
        if (step.akcja === 'pytanie') {
          log(`PYTANIE: ${step.wiadomosc}`, 'ask');
          pushSaid('jv', step.wiadomosc || 'Potrzebuje Twojej decyzji.');
          speak(String(step.wiadomosc || '').slice(0, 300));
          return;
        }

        const label = `${step.akcja}${step.nazwa ? ` "${step.nazwa}"` : ''}${step.tekst ? ` "${String(step.tekst).slice(0, 40)}"` : ''}${step.x != null ? ` (${step.x}%,${step.y}%)` : ''}`;
        log(`→ ${label}`, 'act');
        const { wynik } = await execute(step);
        log(`   ${wynik}`, wynik === 'ok' || wynik === 'odczekano' ? 'ok' : 'bad');
        audit(`agent:${step.akcja}`, label, wynik === 'ok' || wynik === 'odczekano' ? 'ok' : 'failed', wynik);
        run.steps.push({ akcja: step.akcja, nazwa: step.nazwa, tekst: step.tekst, x: step.x, y: step.y, wynik });
        await sleep(STEP_PAUSE_MS);
      }
      if (run.abort) {
        log('PRZERWANO przez uzytkownika.', 'bad');
        audit('agent-stop', goal, 'denied', 'przerwano');
      } else {
        log(`Limit ${MAX_STEPS} krokow - zatrzymuje sie, zeby nie kreclic sie w kolko.`, 'bad');
        pushSaid('jv', `Zatrzymalem sie po ${MAX_STEPS} krokach - nie doszedlem do celu. Zobacz panel Agent.`);
      }
    } catch (err) {
      log(`BLAD: ${err.message}`, 'bad');
      audit('agent-blad', goal, 'failed', err.message);
      toast(err.message);
    } finally {
      run = null;
      setRunning(false);
    }
  }

  function stop() {
    if (!run) return;
    run.abort = true;
    run.pendingAsk?.();
  }

  // Awaryjnie: Escape zatrzymuje agenta z dowolnego miejsca.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && run) stop();
  });

  UI.clientActions['wykonaj-na-ekranie'] = (params) => {
    const goal = String(params?.cel || '').trim();
    if (!goal) throw new Error('Podaj, co mam zrobic.');
    UI.openWindow('screenagent');
    return start(goal);
  };
  UI.agentGui = { start, stop };

  const def = {
    title: 'AGENT EKRANU',
    glyph: '◉',
    wide: true,
    build(body) {
      body.innerHTML = '';
      body.appendChild(
        el('div', 'sub', 'Opisz zadanie - Jarvis sam przejdzie przez aplikacje: patrzy na ekran, klika nazwane elementy, wpisuje tekst i sprawdza efekt. Kazdy krok idzie przez E.D.I.T.H. Escape albo STOP przerywa.')
      );
      const form = el('form', 'field');
      form.style.marginTop = '10px';
      const goal = el('input', 'inp');
      goal.placeholder = 'np. otworz Kalkulator i policz 12 razy 34';
      const startBtn = el('button', 'btn primary', 'START');
      startBtn.type = 'submit';
      const stopBtn = el('button', 'btn danger', 'STOP');
      stopBtn.type = 'button';
      stopBtn.disabled = true;
      stopBtn.addEventListener('click', stop);
      form.append(goal, startBtn, stopBtn);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const g = goal.value.trim();
        if (g) start(g);
      });
      const logBox = el('div', 'agent-log');
      body.append(form, logBox);
      ui = { goal, start: startBtn, stop: stopBtn, log: logBox };
      if (!window.jarvisDesktop) log('Ten modul wymaga aplikacji desktopowej (w przegladarce nie ma jak sterowac systemem).', 'bad');
    },
  };

  UI.register({ id: 'screenagent', title: 'Agent ekranu', sub: 'zadania w aplikacjach', icon: '◉', owner: true, panels: { screenagent: def } });
})();
