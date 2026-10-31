// Powiadomienia na tym urzadzeniu: przypomnienia, plan dnia, podpowiedzi i prosby o zatwierdzenie.
// Serwer i service worker byly gotowe, ale nic nie zapisywalo urzadzenia, wiec powiadomienia nigdzie nie docieraly.
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.extend) return;
  const { el, api, toast, isOwner } = UI;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const b64ToBytes = (s) => {
    const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const deviceName = () => {
    const u = navigator.userAgent;
    const os = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : 'Linux';
    const br = /Edg\//.test(u) ? 'Edge' : /Firefox/.test(u) ? 'Firefox' : /Chrome/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : 'przeglądarka';
    return `${os}, ${br}`;
  };

  async function current() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Nie ma zgody na powiadomienia. Zmienisz to w ustawieniach przeglądarki.');
    const { publicKey } = await api('/api/push/vapid-public-key');
    if (!publicKey) throw new Error('Serwer nie ma skonfigurowanych powiadomień.');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
    await api('/api/push/subscribe', json({ ...sub.toJSON(), label: deviceName() }));
    return sub;
  }

  async function disable() {
    const sub = await current();
    if (!sub) return;
    await api('/api/push/unsubscribe', json({ endpoint: sub.endpoint })).catch(() => {});
    await sub.unsubscribe();
  }

  UI.extend('set', {
    pushsub: {
      title: 'POWIADOMIENIA',
      glyph: '🔔',
      build(body) {
        if (!isOwner()) {
          body.textContent = 'Dostępne tylko dla właściciela.';
          return;
        }
        body.innerHTML = '';
        body.appendChild(el('div', 'sub', 'Przypomnienia, plan dnia, podpowiedzi Jarvisa i prośby o zatwierdzenie docierają na urządzenia włączone tutaj, nawet gdy aplikacja jest zamknięta.'));
        const st = el('div', 'w-mid');
        const row = el('div', 'field');
        row.style.cssText = 'gap:6px;flex-wrap:wrap;margin:8px 0';
        const toggle = el('button', 'btn primary');
        const test = el('button', 'btn ghost', 'WYŚLIJ TEST');
        const list = el('div', 'w-list');
        row.append(toggle, test);
        body.append(st, row, list);

        async function draw() {
          list.innerHTML = '';
          const d = await api('/api/push/devices').catch(() => ({ devices: [] }));
          d.devices.forEach((x) => {
            const it = el('div', 'it');
            const del = el('button', 'row-x', '×');
            del.title = 'Usuń to urządzenie';
            del.addEventListener('click', async () => {
              await api('/api/push/unsubscribe', json({ endpoint: x.endpoint }));
              draw();
            });
            it.append(el('span', null, x.label || 'nieznane urządzenie'), del);
            list.appendChild(it);
          });
          if (!d.devices.length) list.appendChild(el('div', 'w-empty', 'Żadne urządzenie nie odbiera powiadomień.'));
          if (!supported()) {
            st.textContent = 'Ta aplikacja nie obsługuje powiadomień push. Włącz je na telefonie w przeglądarce.';
            toggle.hidden = true;
            return;
          }
          const sub = await current().catch(() => null);
          st.textContent = sub ? 'To urządzenie odbiera powiadomienia.' : 'To urządzenie nie odbiera powiadomień.';
          toggle.textContent = sub ? 'WYŁĄCZ TUTAJ' : 'WŁĄCZ NA TYM URZĄDZENIU';
          if (sub) await api('/api/push/subscribe', json({ ...sub.toJSON(), label: deviceName() })).catch(() => {});
        }
        toggle.addEventListener('click', async () => {
          toggle.disabled = true;
          try {
            if (await current()) await disable();
            else {
              await enable();
              toast('Powiadomienia włączone.', 'ok');
            }
          } catch (e) {
            toast(e.message || 'Nie udało się.');
          }
          toggle.disabled = false;
          draw();
        });
        test.addEventListener('click', async () => {
          try {
            const r = await api('/api/push/test', json());
            toast(r.devices ? `Wysłano na urządzenia: ${r.devices}.` : 'Żadne urządzenie nie odbiera powiadomień.', r.devices ? 'ok' : 'bad');
          } catch (e) {
            toast(e.message || 'Nie udało się.');
          }
        });
        draw();
      },
    },
  });
})();
