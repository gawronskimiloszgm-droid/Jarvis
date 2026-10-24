// "Teraz gra": stan odtwarzania ze Spotify (gdy konto polaczone) dla widzetu na Pulpicie
// i mini odtwarzacza w naglowku, plus akcja "muzyka" (pauza/dalej/glosnosc...).
// Bez polaczonego Spotify "muzyka" uzywa klawiszy multimedialnych komputera, wiec
// dziala z kazdym odtwarzaczem (YouTube w przegladarce, VLC...).
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { api, toast, isOwner } = UI;
  const D = () => window.jarvisDesktop;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const state = { connected: null, playing: false };
  UI.nowPlaying = state;

  async function refresh() {
    if (!isOwner()) return;
    try {
      const r = await api('/api/spotify/now');
      Object.keys(state).forEach((k) => delete state[k]);
      Object.assign(state, r, { at: Date.now() });
    } catch {
      state.connected = false;
    }
    window.dispatchEvent(new Event('jarvis:now-playing'));
  }
  UI.refreshNowPlaying = refresh;

  // Odpytujemy tylko, gdy konto jest polaczone i karta widoczna; rzadziej, gdy nic nie gra.
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    const ms = state.connected === false ? 60000 : state.playing ? 8000 : 20000;
    timer = setTimeout(async () => {
      if (document.visibilityState === 'visible') await refresh();
      schedule();
    }, ms);
  }
  window.addEventListener('jarvis:ready', () => {
    refresh().then(schedule);
  });

  const KEYS = { pauza: 'odtworz-pauza', wznow: 'odtworz-pauza', dalej: 'nastepny-utwor', wstecz: 'poprzedni-utwor', glosniej: 'glosniej', ciszej: 'ciszej' };
  const CMD = { pauza: 'pause', wznow: 'play', dalej: 'next', wstecz: 'prev', glosniej: 'up', ciszej: 'down', glosnosc: 'volume' };
  const ALIAS = { stop: 'pauza', pause: 'pauza', play: 'wznow', graj: 'wznow', next: 'dalej', nastepny: 'dalej', poprzedni: 'wstecz', prev: 'wstecz', glosnosc: 'glosnosc' };

  async function control(polecenie, wartosc) {
    const p = ALIAS[polecenie] || polecenie;
    if (!CMD[p]) throw new Error('Nie znam polecenia: ' + polecenie);
    try {
      const r = await api('/api/spotify/control', json({ cmd: CMD[p], value: wartosc }));
      setTimeout(refresh, 700);
      return r;
    } catch (e) {
      // Spotify niepolaczone albo bez urzadzenia: klawisze multimedialne na komputerze.
      if (KEYS[p] && D()) return UI.runDeviceActionNow(KEYS[p]);
      if (KEYS[p] && !D()) return UI.clientActions['pilot-pc']?.({ akcja: KEYS[p] });
      throw e;
    }
  }
  UI.musicControl = control;

  UI.clientActions['muzyka'] = async (p) => {
    try {
      await control(String(p?.polecenie || '').toLowerCase(), p?.wartosc);
    } catch (e) {
      toast(e.message);
    }
  };
})();
