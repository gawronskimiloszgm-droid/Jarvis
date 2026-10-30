// Wspolna kamera i tryb "holo-kamera" jak w pokazie: obraz z Twojej kamery wypelnia caly ekran,
// a interfejs Jarvisa (panele, graf, HUD) unosi sie nad nim jak hologram. Jedna kamera dla wszystkich
// funkcji (gesty dloni, Graf wiedzy, holo-kamera) - licznik uzycia, strumien zamykany dopiero po
// ostatnim zwolnieniu.
// Wlaczanie: Alt+K, polecenie "kamera" w palecie, przycisk na pasku szybkich akcji albo Ustawienia -> HOLO-KAMERA.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, toast, isOwner } = UI;

  let stream = null;
  let users = 0;
  let pending = null;

  UI.camera = {
    // Zwraca wspolny strumien (otwiera kamere przy pierwszym uzytkowniku).
    async acquire() {
      users++;
      try {
        if (!stream) {
          if (!pending) {
            const id = localStorage.getItem('jarvis.camId');
            pending = navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(id ? { deviceId: { ideal: id } } : { facingMode: 'user' }) }, audio: false });
          }
          stream = await pending;
          pending = null;
        } else if (pending) {
          await pending;
        }
        return stream;
      } catch (e) {
        users = Math.max(0, users - 1);
        pending = null;
        throw e;
      }
    },
    release() {
      users = Math.max(0, users - 1);
      if (!users && stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    },
    isOpen: () => Boolean(stream),
    // Lista kamer (nazwy sa dostepne po pierwszej zgodzie na kamere).
    async list() {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput');
    },
    // Zrozumialy komunikat zamiast surowego bledu przegladarki.
    async explain(e) {
      const name = e && e.name;
      if (name === 'NotAllowedError') return 'Brak zgody na kamere. Zezwol na nia w ustawieniach przegladarki.';
      const cams = await UI.camera.list().catch(() => []);
      const onlyObs = cams.length > 0 && cams.every((c) => /obs/i.test(c.label));
      if (onlyObs) return 'Masz tylko wirtualna kamere OBS. Podlacz kamere albo wlacz w OBS "Start Virtual Camera".';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nie znaleziono kamery. Podlacz ja i sprobuj ponownie.';
      if (name === 'NotReadableError') return 'Kamera jest zajeta przez inny program albo nieaktywna. Zamknij go i sprobuj ponownie.';
      return `Kamera nie wystartowala: ${(e && e.message) || e}`;
    },
  };

  let video = null;
  let frame = null;
  let on = false;
  const mode = () => localStorage.getItem('jarvis.holoCamLook') || 'natural';

  async function enable() {
    if (on) return;
    if (!navigator.mediaDevices?.getUserMedia) return toast('Ta przegladarka nie udostepnia kamery.');
    try {
      const s = await UI.camera.acquire();
      video = el('video', 'holocam-video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      frame = el('div', 'holocam-frame');
      ['tl', 'tr', 'bl', 'br'].forEach((c) => frame.appendChild(el('i', `hc-corner ${c}`)));
      frame.appendChild(el('div', 'hc-scan'));
      frame.appendChild(el('span', 'hc-label', 'HOLO-KAMERA · LIVE'));
      document.body.prepend(video);
      document.body.appendChild(frame);
      await video.play();
      on = true;
      document.body.classList.add('holo-cam');
      document.body.dataset.camLook = mode();
      UI.activity?.emit('kamera', 'Wlaczono tryb holo-kamery (obraz z kamery w tle)', { react: true });
    } catch (e) {
      disable(true);
      toast(await UI.camera.explain(e));
    }
  }

  function disable(silent) {
    if (!on && !video) return;
    const was = on;
    on = false;
    video?.remove();
    frame?.remove();
    video = frame = null;
    document.body.classList.remove('holo-cam');
    if (was) {
      UI.camera.release();
      if (!silent) UI.activity?.emit('kamera', 'Wylaczono tryb holo-kamery', {});
    } else {
      UI.camera.release();
    }
  }

  UI.holoCam = { enable, disable: () => disable(false), toggle: () => (on ? disable(false) : enable()), isOn: () => on };

  const LOOKS = [['natural', 'NATURALNY (jak na filmie)'], ['holo', 'HOLO (niebieski odcien)'], ['dark', 'CIEMNY (czytelniejszy interfejs)']];
  UI.extend?.('set', {
    holocam: {
      title: 'HOLO-KAMERA',
      glyph: '◉',
      build(body) {
        body.innerHTML = '';
        body.appendChild(el('div', 'sub', 'Obraz z Twojej kamery na calym ekranie, a interfejs unosi sie nad nim jak hologram (jak w pokazie). Przetwarzanie lokalne - obraz nigdzie nie jest wysylany. Skrot: Alt+K.'));
        const b = el('button', on ? 'btn primary' : 'btn ghost', on ? 'WYLACZ HOLO-KAMERE' : 'WLACZ HOLO-KAMERE');
        b.addEventListener('click', async () => {
          await UI.holoCam.toggle();
          b.textContent = on ? 'WYLACZ HOLO-KAMERE' : 'WLACZ HOLO-KAMERE';
          b.className = on ? 'btn primary' : 'btn ghost';
        });
        const row = el('div', 'field');
        row.style.cssText = 'flex-wrap:wrap;gap:6px;margin:8px 0';
        LOOKS.forEach(([k, l]) => {
          const x = el('button', mode() === k ? 'btn primary' : 'btn ghost', l);
          x.addEventListener('click', () => {
            localStorage.setItem('jarvis.holoCamLook', k);
            document.body.dataset.camLook = k;
            row.querySelectorAll('button').forEach((y) => (y.className = 'btn ghost'));
            x.className = 'btn primary';
          });
          row.appendChild(x);
        });
        const pick = el('select', 'inp');
        const fill = async () => {
          const cams = await UI.camera.list().catch(() => []);
          pick.innerHTML = '';
          pick.appendChild(Object.assign(el('option', null, 'Domyslna kamera'), { value: '' }));
          cams.forEach((c, i) => pick.appendChild(Object.assign(el('option', null, c.label || `Kamera ${i + 1}`), { value: c.deviceId })));
          pick.value = localStorage.getItem('jarvis.camId') || '';
        };
        pick.addEventListener('change', async () => {
          localStorage.setItem('jarvis.camId', pick.value);
          if (on) {
            disable(true);
            await enable();
          }
        });
        fill();
        body.append(b, el('div', 'sub', 'Kamera:'), pick, el('div', 'sub', 'Wyglad obrazu:'), row);
      },
    },
  });

  // Polecenia dla Jarvisa (glos i czat): holo-kamera, gesty dloni, graf wiedzy, tryb kina.
  const setOn = async (api, want) => {
    if (!api) return { ok: false, error: 'funkcja niedostepna' };
    const cur = api.isOn();
    const next = want == null ? !cur : Boolean(want);
    if (next !== cur) await api.toggle();
    return { ok: true, wlaczone: api.isOn() };
  };
  const wantOf = (p) => (p && p.wlacz != null ? p.wlacz === true || p.wlacz === 'true' : null);
  if (UI.clientActions) {
    UI.clientActions['holo-kamera'] = (p) => setOn(UI.holoCam, wantOf(p));
    UI.clientActions['gesty-dloni'] = (p) => setOn(UI.handUi, wantOf(p));
    UI.clientActions['graf-wiedzy'] = async () => {
      UI.openWindow('graph');
      return { ok: true };
    };
    UI.clientActions['tryb-kina'] = async (p) => {
      await UI.cinema?.toggle(wantOf(p) == null ? undefined : wantOf(p));
      return { ok: true };
    };
  }

  addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'k' || e.key === 'K') && !e.ctrlKey && isOwner()) {
      e.preventDefault();
      UI.holoCam.toggle();
    }
  });

  const orig = UI.paletteSearch;
  if (orig) {
    UI.paletteSearch = (q) => {
      const out = orig(q);
      if (/^(kamera|holokamera|holo-kamera|tlo)\b/i.test(UI.deaccent(q.trim().toLowerCase()))) out.unshift({ label: `◉ Holo-kamera: ${on ? 'wylacz' : 'wlacz'}`, hint: 'ENTER (Alt+K)', run: () => UI.holoCam.toggle() });
      return out;
    };
  }
})();
