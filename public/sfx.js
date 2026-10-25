// Dzwieki interfejsu J.A.R.V.I.S.
//
// Wszystko jest SYNTEZOWANE w locie przez Web Audio - zadnych plikow mp3,
// zadnego pobierania, zero opoznienia przy pierwszym klinieciu. Dzieki temu
// dzwieki waza 0 bajtow transferu i brzmia identycznie na kazdym urzadzeniu.
//
// Charakter: krotkie, czyste, przefiltrowane - blizej sygnalu aparatury niz
// klasycznego "klik". Kazdy dzwiek to kilka oscylatorow z obwiednia
// wykladnicza i filtrem dolnoprzepustowym, zeby nie klulo w uszy.

(() => {
  const MASTER = 0.16; // celowo cicho - to tlo, nie atrakcja
  let ctx = null;
  let bus = null;
  let noiseBuf = null;

  const enabled = () => localStorage.getItem('jarvis.sfx') !== 'off';

  function ensure() {
    if (!enabled()) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch {
        return null;
      }
      bus = ctx.createGain();
      bus.gain.value = MASTER;
      // Delikatny sufit czestotliwosci - zdejmuje ostrosc z transjentow.
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 7200;
      bus.connect(soft).connect(ctx.destination);
    }
    // Przegladarki usypiaja kontekst do pierwszego gestu uzytkownika.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function noise() {
    if (noiseBuf) return noiseBuf;
    const n = Math.floor(ctx.sampleRate * 0.12);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // Jeden glos: oscylator z obwiednia i opcjonalnym przemiataniem wysokosci.
  function voice({ type = 'sine', from, to, t0, dur, peak = 1, detune = 0, cutoff = 5200 }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t0);

    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(from, t0);
    if (to && to !== from) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);

    // Bardzo krotki atak (2 ms) - inaczej slychac "pyk" na starcie.
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g).connect(f).connect(bus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  // Szum: "powietrze" transjentu, bez niego dzwieki brzmia plastikowo.
  function air({ t0, dur, peak = 0.25, hp = 2600 }) {
    const s = ctx.createBufferSource();
    s.buffer = noise();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(g).connect(f).connect(bus);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
  }

  const SOUNDS = {
    // Zwykle klikniecie - jeden krotki impuls z odrobina powietrza.
    tap(t) {
      voice({ type: 'sine', from: 1180, to: 880, t0: t, dur: 0.07, peak: 0.5 });
      voice({ type: 'triangle', from: 2360, to: 1760, t0: t, dur: 0.045, peak: 0.14 });
      air({ t0: t, dur: 0.035, peak: 0.16, hp: 3400 });
    },

    // Zmiana zakladki - krotkie przemiatanie w gore, "przeskok".
    swap(t) {
      voice({ type: 'triangle', from: 620, to: 1420, t0: t, dur: 0.11, peak: 0.42 });
      voice({ type: 'sine', from: 1240, to: 2840, t0: t, dur: 0.09, peak: 0.12, detune: 6 });
      air({ t0: t, dur: 0.05, peak: 0.12, hp: 3000 });
    },

    // Mikrofon wlaczony - spokojne narastanie, dwa lekko rozstrojone glosy.
    micOn(t) {
      voice({ type: 'sine', from: 330, to: 990, t0: t, dur: 0.3, peak: 0.5, cutoff: 4200 });
      voice({ type: 'sine', from: 495, to: 1485, t0: t + 0.03, dur: 0.28, peak: 0.2, detune: 8 });
      voice({ type: 'triangle', from: 1980, to: 2640, t0: t + 0.08, dur: 0.16, peak: 0.07 });
      air({ t0: t, dur: 0.1, peak: 0.1, hp: 2200 });
    },

    // Otwarcie modulu - krotki "holo" sweep z blyskiem na koncu.
    open(t) {
      voice({ type: 'sine', from: 440, to: 1760, t0: t, dur: 0.14, peak: 0.32, cutoff: 4800 });
      voice({ type: 'triangle', from: 2640, to: 3520, t0: t + 0.09, dur: 0.07, peak: 0.08 });
      air({ t0: t, dur: 0.06, peak: 0.08, hp: 3800 });
    },

    // Wykonana akcja na komputerze - cichy, krotki "tik" potwierdzenia.
    done(t) {
      voice({ type: 'sine', from: 1568, to: 1568, t0: t, dur: 0.06, peak: 0.22 });
      voice({ type: 'sine', from: 2349, to: 2349, t0: t + 0.05, dur: 0.09, peak: 0.16 });
    },

    // Alarm (E.D.I.T.H., ostrzezenie) - dwa niskie impulsy, czytelne, ale bez paniki.
    alert(t) {
      voice({ type: 'square', from: 523, to: 523, t0: t, dur: 0.12, peak: 0.16, cutoff: 1800 });
      voice({ type: 'square', from: 523, to: 523, t0: t + 0.18, dur: 0.12, peak: 0.16, cutoff: 1800 });
      voice({ type: 'sine', from: 1046, to: 1046, t0: t, dur: 0.3, peak: 0.08 });
    },

    // Slowo "Jarvis" uslyszane - jasne narastanie, zanim wlaczy sie rozmowa.
    wake(t) {
      voice({ type: 'sine', from: 660, to: 1320, t0: t, dur: 0.18, peak: 0.4, cutoff: 5000 });
      voice({ type: 'sine', from: 990, to: 1980, t0: t + 0.06, dur: 0.18, peak: 0.18, detune: 7 });
      air({ t0: t, dur: 0.08, peak: 0.09, hp: 3000 });
    },

    // Mikrofon wylaczony - to samo w druga strone, krocej.
    micOff(t) {
      voice({ type: 'sine', from: 880, to: 280, t0: t, dur: 0.24, peak: 0.45, cutoff: 3400 });
      voice({ type: 'sine', from: 1320, to: 420, t0: t + 0.02, dur: 0.2, peak: 0.14, detune: -8 });
    },

    // Potwierdzenie - dwie nuty w gore (kwinta).
    ok(t) {
      voice({ type: 'sine', from: 880, to: 880, t0: t, dur: 0.1, peak: 0.4 });
      voice({ type: 'sine', from: 1320, to: 1320, t0: t + 0.08, dur: 0.16, peak: 0.34 });
      air({ t0: t, dur: 0.03, peak: 0.08, hp: 3000 });
    },

    // Blad - dwie nuty w dol, lekko rozstrojone, bez agresji.
    err(t) {
      voice({ type: 'triangle', from: 400, to: 400, t0: t, dur: 0.12, peak: 0.4, cutoff: 2400 });
      voice({ type: 'triangle', from: 300, to: 292, t0: t + 0.1, dur: 0.22, peak: 0.38, cutoff: 2200 });
    },

    // Wyslanie wiadomosci - lekkie "puf" w gore.
    send(t) {
      voice({ type: 'sine', from: 720, to: 1180, t0: t, dur: 0.08, peak: 0.34 });
      air({ t0: t, dur: 0.04, peak: 0.1, hp: 3200 });
    },
  };

  let last = 0;

  window.SFX = {
    play(name) {
      const c = ensure();
      if (!c || !SOUNDS[name]) return;
      // Zabezpieczenie przed serią dzwiekow naraz (np. kilka toastow) -
      // zlewaja sie wtedy w trzask.
      const now = c.currentTime;
      if (now - last < 0.035) return;
      last = now;
      try {
        SOUNDS[name](now + 0.001);
      } catch {
        /* kontekst mogl paść - dzwiek nie jest wart wywracania appki */
      }
    },
    setEnabled(on) {
      localStorage.setItem('jarvis.sfx', on ? 'on' : 'off');
    },
    isEnabled: enabled,
  };
})();
