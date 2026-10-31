// Propozycje Jarvisa na Pulpicie: konkretne dzialania z przyciskami i plan dnia (server/extras/suggest.js).
// Nowa wazna propozycja trafia tez do czujnika zdarzen, wiec Jarvis powie o niej sam.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.addHomeWidget) return;
  const { el, api, toast, isOwner } = UI;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const SAID = 'jarvis.suggestSaid';

  const said = () => {
    try {
      return JSON.parse(localStorage.getItem(SAID) || '{}');
    } catch {
      return {};
    }
  };

  async function run(item, a) {
    if (a.op === 'open') {
      UI.openWindow(a.arg);
      return;
    }
    await api('/api/suggest/do', json('POST', { id: item.id, op: a.op, arg: a.arg }));
    toast('Zrobione.', 'ok');
    UI.activity?.emit('propozycja', `Wykonano propozycję: ${item.text} (${a.label})`);
    window.dispatchEvent(new CustomEvent('jarvis:life', { detail: { coll: 'suggest' } }));
  }

  function card(item, redraw) {
    const c = el('div', 'sg-card');
    c.append(el('b', null, item.title), el('div', 'sg-text', item.text));
    const row = el('div', 'sg-actions');
    item.actions.forEach((a) => {
      const b = el('button', 'btn ghost', a.label);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await run(item, a);
          redraw();
        } catch (e) {
          toast(e.message || 'Nie udało się.');
          b.disabled = false;
        }
      });
      row.appendChild(b);
    });
    const later = el('button', 'row-x', '×');
    later.title = 'Nie teraz (3 dni)';
    later.addEventListener('click', async () => {
      await api('/api/suggest/dismiss', json('POST', { id: item.id, days: 3 })).catch(() => {});
      redraw();
    });
    row.appendChild(later);
    c.appendChild(row);
    return c;
  }

  const widget = {
    id: 'suggest',
    title: 'Jarvis proponuje',
    glyph: '✦',
    owner: true,
    wide: true,
    every: 300000,
    events: ['jarvis:life'],
    async render(box) {
      const r = await api('/api/suggest').catch(() => ({ items: [] }));
      box.innerHTML = '';
      const redraw = () => widget.render(box);
      if (r.plan && r.plan.day === UI.dayKey?.(new Date())) {
        const p = el('div', 'sg-plan');
        p.append(el('b', null, 'Plan dnia'), el('div', 'sg-text', r.plan.text));
        box.appendChild(p);
      }
      const planBtn = el('button', 'btn ghost', r.plan && r.plan.day === UI.dayKey?.(new Date()) ? 'UŁÓŻ PLAN OD NOWA' : 'UŁÓŻ PLAN DNIA');
      planBtn.addEventListener('click', async () => {
        planBtn.disabled = true;
        planBtn.textContent = 'UKŁADAM...';
        try {
          const out = await api('/api/suggest/plan', json('POST', {}));
          UI.activity?.emit('propozycja', 'Jarvis ułożył plan dnia', { react: true, important: true, say: out.plan.text });
          redraw();
        } catch (e) {
          toast(e.message || 'Nie udało się ułożyć planu.');
          planBtn.disabled = false;
        }
      });
      const items = r.items || [];
      if (!items.length) box.appendChild(el('div', 'w-empty', 'Nic pilnego, sir. Rzadki widok.'));
      items.slice(0, 4).forEach((it) => box.appendChild(card(it, redraw)));
      if (items.length > 4) box.appendChild(el('div', 'w-dim', `i ${items.length - 4} więcej`));
      box.appendChild(planBtn);
    },
  };
  UI.addHomeWidget(widget);

  // Najwazniejsza nowa propozycja: Jarvis mowi o niej raz (w rozmowie albo glosem).
  async function announce() {
    if (!isOwner()) return;
    const r = await api('/api/suggest').catch(() => null);
    const top = r?.items?.[0];
    if (!top || top.prio < 60) return;
    const s = said();
    if (s[top.id]) return;
    s[top.id] = Date.now();
    const keep = Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 100);
    try {
      localStorage.setItem(SAID, JSON.stringify(Object.fromEntries(keep)));
    } catch {
      /* powtorzy sie przy nastepnym sprawdzeniu */
    }
    UI.activity?.emit('propozycja', top.text, { react: true, important: true, say: top.text });
  }
  window.addEventListener('jarvis:ready', () => {
    setTimeout(announce, 45000);
    setInterval(announce, 15 * 60000);
  });

  // ---------- propozycje z czatu: [PROPOZYCJA: tekst | akcja | parametr] -> przyciski pod odpowiedzia ----------
  UI.renderProposal = (node, text, action, param) => {
    const box = el('div', 'sg-card sg-chat');
    box.appendChild(el('div', 'sg-text', text));
    const row = el('div', 'sg-actions');
    const yes = el('button', 'btn primary', 'ZRÓB');
    const no = el('button', 'btn ghost', 'NIE');
    yes.addEventListener('click', () => {
      box.remove();
      UI.runDeviceAction(action, UI.paramsForAction(action, param));
      UI.activity?.emit('propozycja', `Zatwierdzono: ${text}`);
    });
    no.addEventListener('click', () => {
      box.remove();
      UI.activity?.emit('propozycja', `Odrzucono: ${text}`);
    });
    row.append(yes, no);
    box.appendChild(row);
    node.appendChild(box);
  };
})();
