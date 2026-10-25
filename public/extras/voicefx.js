// "Filmowy" glos za darmo: zamiast klonowac czyjs glos (do tego potrzebna bylaby zgoda
// wlasciciela glosu), obrabiamy wybrany glos Gemini w przegladarce (Web Audio):
//   - filtr dolnoprzepustowy usuwa dudnienie, lekkie podbicie "obecnosci" (ok. 3 kHz)
//     daje wyrazniejsza, "studyjna" barwe,
//   - kompresor wyrownuje glosnosc jak w filmowym miksie,
//   - krotki poglos (sztuczne pomieszczenie) i delikatne opoznienie daja wrazenie
//     glosu "z systemu", a nie z glosnika telefonu.
// Wszystko liczy sie lokalnie, nic nie kosztuje. Do tego wybor jednego z glosow Gemini
// (niskie, spokojne brzmia najbardziej "po lokajsku") i odsluch przed wyborem.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, toast } = UI;

  const MODE_KEY = 'jarvis.voiceFx';
  const VOICE_KEY = 'jarvis.voice';
  const PRESETS = {
    off: null,
    subtle: { wet: 0.16, presence: 3, delayGain: 0.08, decay: 0.7 },
    film: { wet: 0.28, presence: 4.5, delayGain: 0.14, decay: 1.1 },
  };
  const VOICES = [
    ['', 'Domyslny (z serwera)'],
    ['Charon', 'Charon - niski, rzeczowy (polecany)'],
    ['Iapetus', 'Iapetus - czysty, spokojny'],
    ['Rasalgethi', 'Rasalgethi - informacyjny, dojrzaly'],
    ['Sadaltager', 'Sadaltager - madry, wywazony'],
    ['Algenib', 'Algenib - chropowaty, gleboki'],
    ['Orus', 'Orus - stanowczy'],
    ['Schedar', 'Schedar - rowny, opanowany'],
    ['Alnilam', 'Alnilam - pewny siebie'],
    ['Enceladus', 'Enceladus - miekki, przydechowy'],
    ['Umbriel', 'Umbriel - swobodny'],
    ['Puck', 'Puck - zywy, wesoly'],
  ];
  const SAMPLE = 'Dobry wieczor, sir. Wszystkie systemy sprawne. Osmiele sie zauwazyc, ze kawa wystygla juz dwadziescia minut temu.';

  const get = (k, d) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  };
  const put = (k, v) => {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      /* ustawienie do zamkniecia karty */
    }
  };
  const mode = () => (PRESETS[get(MODE_KEY, 'off')] ? get(MODE_KEY, 'off') : 'off');

  // Sztuczna odpowiedz impulsowa pomieszczenia: zanikajacy szum stereo.
  function impulse(ctx, seconds) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  const chains = new WeakMap();
  function build(ctx, p) {
    const input = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 95;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3000;
    presence.Q.value = 0.9;
    presence.gain.value = p.presence;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 9000;
    air.gain.value = -2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const dry = ctx.createGain();
    dry.gain.value = 1 - p.wet * 0.5;
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, p.decay);
    const wet = ctx.createGain();
    wet.gain.value = p.wet;
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = 0.022;
    const delayGain = ctx.createGain();
    delayGain.gain.value = p.delayGain;
    const out = ctx.createGain();
    out.gain.value = 0.95;

    input.connect(hp);
    hp.connect(presence);
    presence.connect(air);
    air.connect(comp);
    comp.connect(dry);
    comp.connect(verb);
    comp.connect(delay);
    verb.connect(wet);
    delay.connect(delayGain);
    dry.connect(out);
    wet.connect(out);
    delayGain.connect(out);
    out.connect(ctx.destination);
    return input;
  }

  // Punkt wejscia lancucha dla danego AudioContext (albo null = graj bez efektu).
  UI.voiceFx = (ctx) => {
    const m = mode();
    if (!ctx || m === 'off') return null;
    let entry = chains.get(ctx);
    if (!entry || entry.mode !== m) {
      entry = { mode: m, input: build(ctx, PRESETS[m]) };
      chains.set(ctx, entry);
    }
    return entry.input;
  };

  // Czytanie odpowiedzi z czatu (gotowy plik audio) przez ten sam efekt.
  let playCtx = null;
  UI.playVoiceBlob = async (blob) => {
    if (mode() === 'off') return false;
    try {
      playCtx = playCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (playCtx.state !== 'running') await playCtx.resume();
      const buf = await playCtx.decodeAudioData(await blob.arrayBuffer());
      const src = playCtx.createBufferSource();
      src.buffer = buf;
      src.connect(UI.voiceFx(playCtx) || playCtx.destination);
      await new Promise((resolve) => {
        src.onended = resolve;
        src.start();
      });
      return true;
    } catch {
      return false; // app.js zagra wtedy zwyklym <audio>
    }
  };

  async function preview(voice) {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: SAMPLE, voice: voice || undefined }),
    });
    if (!res.ok) throw new Error('Synteza nie powiodla sie.');
    const blob = await res.blob();
    if (!(await UI.playVoiceBlob(blob))) await new Audio(URL.createObjectURL(blob)).play();
  }

  const def = {
    title: 'GLOS JARVISA',
    glyph: '🎙',
    wide: true,
    build(body) {
      body.innerHTML = '';
      body.appendChild(el('div', 'sub', 'GLOS'));
      const row = el('div', 'field');
      row.style.cssText = 'margin:6px 0 10px;flex-wrap:wrap;gap:6px';
      const sel = el('select', 'inp');
      VOICES.forEach(([v, l]) => {
        const o = el('option', null, l);
        o.value = v;
        sel.appendChild(o);
      });
      sel.value = get(VOICE_KEY, '');
      sel.addEventListener('change', () => {
        put(VOICE_KEY, sel.value);
        toast('Glos zapisany - zadziala od nastepnej rozmowy (kliknij rdzen, zeby polaczyc od nowa).', 'ok');
      });
      const play = el('button', 'btn primary', '▶ ODSLUCHAJ');
      play.addEventListener('click', async () => {
        play.disabled = true;
        try {
          await preview(sel.value);
        } catch (e) {
          toast(e.message);
        } finally {
          play.disabled = false;
        }
      });
      row.append(sel, play);
      body.appendChild(row);

      body.appendChild(el('div', 'sub', 'EFEKT "FILMOWY"'));
      const fx = el('div', 'field');
      fx.style.cssText = 'margin:6px 0 10px;flex-wrap:wrap;gap:6px';
      [['off', 'Wylaczony'], ['subtle', 'Subtelny'], ['film', 'Filmowy']].forEach(([m, l]) => {
        const b = el('button', mode() === m ? 'btn primary' : 'btn ghost', l);
        b.addEventListener('click', () => {
          put(MODE_KEY, m === 'off' ? '' : m);
          def.build(body);
        });
        fx.appendChild(b);
      });
      body.appendChild(fx);
      body.appendChild(
        el('div', 'sub', 'Efekt dziala od razu, w rozmowie na zywo i przy czytaniu odpowiedzi. Darmowy: liczy sie w aplikacji. Najbardziej "po filmowemu" brzmi glos Charon albo Iapetus z efektem "Filmowy".')
      );
    },
  };
  UI.extend('set', { voicefx: def });
})();
