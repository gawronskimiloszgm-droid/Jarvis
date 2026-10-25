// Dzwieki HUD w odpowiedzi na to, co sie dzieje: otwarcie modulu, wykonana akcja na
// komputerze, nowy alarm (E.D.I.T.H. / ostrzezenie). Same dzwieki sa syntezowane w
// sfx.js; wylaczysz je w Ustawieniach (Slowo "Jarvis" i dzwieki).
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const play = (n) => window.SFX?.play(n);

  // Otwarcie modulu z szyny.
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.dock-btn')) play('open');
  });

  // Udana akcja na komputerze (bez akcji "w tle", jak telemetria czy probki).
  const QUIET = new Set(['telemetria', 'aktywne-okno', 'zrzut-maly', 'czas-pracy', 'bateria', 'proces-dziala', 'schowek-historia', 'zadania-lista', 'stan-gry']);
  let lastDone = 0;
  window.addEventListener('jarvis:action-result', (e) => {
    const name = e.detail?.name;
    if (!name || QUIET.has(name)) return;
    if (Date.now() - lastDone < 600) return;
    lastDone = Date.now();
    play('done');
  });

  // Nowe ostrzezenia w dzienniku zdarzen (alarmy E.D.I.T.H., perymetr, telemetria).
  let seen = 0;
  setInterval(() => {
    const ev = UI.events?.() || [];
    const newest = ev[0] ? +new Date(ev[0].at) : 0;
    if (!seen) {
      seen = newest || Date.now();
      return;
    }
    const fresh = ev.filter((x) => +new Date(x.at) > seen && (x.kind === 'warn' || x.kind === 'err' || x.kind === 'bad'));
    if (newest > seen) seen = newest;
    if (fresh.length) play('alert');
  }, 2000);
})();
