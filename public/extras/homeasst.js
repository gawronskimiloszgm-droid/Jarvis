// Modul "Dom": Home Assistant. Aplikacja desktopowa laczy sie z nim przez siec domowa (adres i token
// wpisujesz w module, zostaja na tym komputerze). Karty urzadzen, sterowanie glosem, gestami i regulami.
// Polecenia po polsku ("wlacz salon", "zgas biurko", "ustaw sypialnie 40%") rozumie logika w parseCommand.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.register) return;
  const { el, toast, isOwner, deaccent } = UI;
  const D = () => window.jarvisDesktop;
  const CONTROL = ['light', 'switch', 'fan', 'cover', 'scene', 'script', 'input_boolean', 'media_player', 'climate', 'lock'];
  const norm = (s) => deaccent(String(s || '').toLowerCase()).trim();
  let states = [];

  const call = (params) => D().runAction('dom', params);

  async function refresh() {
    if (!D()) throw new Error('Dom działa w aplikacji desktopowej (łączy się z siecią domową).');
    const r = await call({ op: 'states' });
    if (!r?.ok) throw new Error(r?.error || 'Zaktualizuj aplikację desktopową.');
    states = r.states.filter((s) => CONTROL.includes(s.entity_id.split('.')[0]) || /^sensor\.|^binary_sensor\./.test(s.entity_id));
    return states;
  }
  const nameOf = (s) => s.attributes?.friendly_name || s.entity_id;

  // Polecenie tekstowe -> { verb, target, value }.
  function parseCommand(text) {
    const t = norm(text);
    let verb = 'przelacz';
    if (/\b(wylacz|zgas|zamknij|stop|zablokuj)\b/.test(t)) verb = 'off';
    else if (/\b(wlacz|zapal|uruchom|otworz|odblokuj)\b/.test(t)) verb = 'on';
    else if (/\b(stan|status|ile|jaka|jaki)\b/.test(t)) verb = 'state';
    const pct = /(\d{1,3})\s*(%|procent)/.exec(t);
    const deg = /(\d{1,2}(?:[.,]\d)?)\s*(stopni|°)/.exec(t);
    const target = t
      .replace(/(\d{1,3})\s*(%|procent)|(\d{1,2}(?:[.,]\d)?)\s*(stopni|°)/g, ' ')
      .replace(/\b(wlacz|wylacz|zgas|zapal|zamknij|otworz|uruchom|stop|zablokuj|odblokuj|przelacz|ustaw|stan|status|ile|jaka|jaki|prosze|na|w|we|swiatlo|swiatla|lampe|lampa|lampy)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { verb, target, pct: pct ? Math.min(100, Number(pct[1])) : null, deg: deg ? Number(deg[1].replace(',', '.')) : null };
  }

  function findEntity(list, target) {
    const q = norm(target);
    if (!q) return null;
    const score = (s) => {
      const n = norm(nameOf(s));
      const ctrl = CONTROL.includes(s.entity_id.split('.')[0]) ? 0.5 : 0;
      if (n === q) return 4 + ctrl;
      if (n.startsWith(q) || n.includes(q)) return 2 + ctrl;
      const words = q.split(' ');
      // Polskie odmiany: "salonie" ~ "salon", "sypialni" ~ "sypialnia": porownujemy poczatek slowa.
      const hit = words.filter((w) => n.split(/[\s_]+/).some((x) => x.slice(0, 4) === w.slice(0, 4) && w.length >= 3)).length;
      return hit === words.length ? 1 + ctrl : 0;
    };
    let best = null;
    let bs = 0;
    list.forEach((s) => {
      const v = score(s);
      if (v > bs) {
        bs = v;
        best = s;
      }
    });
    return best;
  }

  function serviceFor(s, cmd) {
    const domain = s.entity_id.split('.')[0];
    const on = cmd.verb === 'przelacz' ? s.state !== 'on' && s.state !== 'open' && s.state !== 'unlocked' : cmd.verb === 'on';
    if (domain === 'scene' || domain === 'script') return { domain, service: 'turn_on' };
    if (domain === 'cover') return { domain, service: on ? 'open_cover' : 'close_cover' };
    if (domain === 'lock') return { domain, service: on ? 'unlock' : 'lock' };
    if (domain === 'climate' && cmd.deg != null) return { domain, service: 'set_temperature', data: { temperature: cmd.deg } };
    if (domain === 'light' && cmd.pct != null) return cmd.pct === 0 ? { domain, service: 'turn_off' } : { domain, service: 'turn_on', data: { brightness_pct: cmd.pct } };
    if (domain === 'media_player' && cmd.pct != null) return { domain, service: 'volume_set', data: { volume_level: cmd.pct / 100 } };
    return { domain, service: on ? 'turn_on' : 'turn_off' };
  }

  async function command(text) {
    await refresh();
    const cmd = parseCommand(text);
    const s = findEntity(states, cmd.target);
    if (!s) throw new Error(`Nie znam urządzenia „${cmd.target || text}”.`);
    if (cmd.verb === 'state') {
      const unit = s.attributes?.unit_of_measurement || '';
      return { ok: true, name: nameOf(s), state: `${s.state}${unit ? ` ${unit}` : ''}`, msg: `${nameOf(s)}: ${s.state}${unit ? ` ${unit}` : ''}.` };
    }
    const sv = serviceFor(s, cmd);
    const r = await call({ op: 'call', domain: sv.domain, service: sv.service, data: { entity_id: s.entity_id, ...(sv.data || {}) } });
    if (!r?.ok) throw new Error(r?.error || 'Home Assistant odrzucił polecenie.');
    UI.activity?.emit('dom', `${nameOf(s)}: ${sv.service}`);
    return { ok: true, name: nameOf(s), msg: `${nameOf(s)}: gotowe.` };
  }
  UI.dom = { command, refresh, parseCommand, findEntity };

  if (UI.clientActions) {
    UI.clientActions.dom = async (p) => {
      const text = p?.polecenie || p?.raw || '';
      try {
        const r = await command(text);
        toast(r.msg, 'ok');
        if (UI.isLive?.()) UI.liveSend({ type: 'react', text: r.msg });
        return r;
      } catch (e) {
        toast(e.message);
        if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `Nie wyszło: ${e.message}` });
        return { ok: false, error: e.message };
      }
    };
  }

  // ---------- modul ----------
  const panel = {
    title: 'DOM',
    glyph: '⌂',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostępne tylko dla właściciela.';
        return;
      }
      body.innerHTML = '';
      if (!D()) {
        body.appendChild(el('div', 'w-empty', 'Dom działa w aplikacji desktopowej, bo łączy się z Home Assistant w Twojej sieci domowej.'));
        return;
      }
      const cfgBox = el('div', 'field');
      cfgBox.style.cssText = 'gap:6px;flex-wrap:wrap;margin-bottom:8px';
      const url = el('input', 'inp');
      url.placeholder = 'Adres Home Assistant, np. http://homeassistant.local:8123';
      url.style.flex = '1 1 280px';
      const tok = el('input', 'inp');
      tok.type = 'password';
      tok.placeholder = 'Token (profil HA → długoterminowe tokeny)';
      tok.style.flex = '1 1 240px';
      const save = el('button', 'btn primary', 'POŁĄCZ');
      cfgBox.append(url, tok, save);
      const status = el('div', 'w-dim');
      const search = el('input', 'inp');
      search.placeholder = 'Szukaj urządzenia...';
      const grid = el('div', 'dom-grid');
      const cmdRow = el('div', 'field');
      cmdRow.style.cssText = 'gap:6px;margin:8px 0';
      const cmdIn = el('input', 'inp');
      cmdIn.placeholder = 'Polecenie, np. włącz salon, ustaw sypialnię 40%';
      cmdIn.style.flex = '1';
      const cmdGo = el('button', 'btn ghost', 'WYKONAJ');
      cmdRow.append(cmdIn, cmdGo);
      body.append(cfgBox, status, cmdRow, search, grid);

      D().getSetting('haUrl').then((v) => (url.value = v || ''));
      const runCmd = async () => {
        if (!cmdIn.value.trim()) return;
        try {
          toast((await command(cmdIn.value)).msg, 'ok');
          cmdIn.value = '';
          load();
        } catch (e) {
          toast(e.message);
        }
      };
      cmdGo.addEventListener('click', runCmd);
      cmdIn.addEventListener('keydown', (e) => e.key === 'Enter' && runCmd());
      save.addEventListener('click', async () => {
        await D().setSetting('haUrl', url.value.trim());
        if (tok.value.trim()) await D().setSetting('haToken', tok.value.trim());
        tok.value = '';
        load();
      });
      search.addEventListener('input', draw);

      function card(s) {
        const domain = s.entity_id.split('.')[0];
        const on = ['on', 'open', 'playing', 'unlocked'].includes(s.state);
        const c = el('button', `dom-card${on ? ' on' : ''}`);
        c.type = 'button';
        const unit = s.attributes?.unit_of_measurement || '';
        c.append(el('b', null, nameOf(s)), el('span', null, `${s.state}${unit ? ` ${unit}` : ''}`));
        if (CONTROL.includes(domain)) {
          c.addEventListener('click', async () => {
            const sv = serviceFor(s, { verb: 'przelacz' });
            const r = await call({ op: 'call', domain: sv.domain, service: sv.service, data: { entity_id: s.entity_id, ...(sv.data || {}) } });
            if (!r?.ok) toast(r?.error || 'Nie udało się.');
            UI.activity?.emit('dom', `${nameOf(s)}: ${sv.service}`);
            setTimeout(load, 500);
          });
        } else c.disabled = true;
        return c;
      }
      function draw() {
        grid.innerHTML = '';
        const q = norm(search.value);
        const rows = states.filter((s) => !q || norm(nameOf(s)).includes(q));
        const ctrl = rows.filter((s) => CONTROL.includes(s.entity_id.split('.')[0]));
        ctrl.concat(rows.filter((s) => !ctrl.includes(s)).slice(0, 12)).slice(0, 60).forEach((s) => grid.appendChild(card(s)));
      }
      async function load() {
        try {
          await refresh();
          cfgBox.hidden = false;
          status.textContent = `Połączono: ${states.length} urządzeń i czujników.`;
          draw();
        } catch (e) {
          status.textContent = e.message;
        }
      }
      load();
    },
    refresh() {},
  };
  UI.register({ id: 'dom', title: 'Dom', sub: 'Home Assistant', icon: '⌂', owner: true, group: 'Dom', panels: { dom: panel } });
})();
