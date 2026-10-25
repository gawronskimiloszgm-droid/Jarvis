// Wlasny glos lokalnie (darmowy): Jarvis czyta odpowiedzi Twoim serwerem mowy na tym
// komputerze - np. XTTS z probka glosu, na ktory masz zgode (Twojego), albo Piper.
// W czacie zastepuje zwykla synteze, a w rozmowie na zywo (opcjonalnie) serwer
// przysyla tekst zdanie po zdaniu i to lokalny serwer go wypowiada.
(function () {
  const UI = window.JarvisUI;
  if (!UI) return;
  const { el, toast } = UI;
  const D = () => window.jarvisDesktop;
  const KEY = 'jarvis.localVoice';

  function cfg() {
    try {
      return { on: false, url: 'http://127.0.0.1:8020', format: 'xtts', glos: 'jarvis', live: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { on: false, url: 'http://127.0.0.1:8020', format: 'xtts', glos: 'jarvis', live: false };
    }
  }
  function save(c) {
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* bez localStorage ustawienie do zamkniecia karty */
    }
  }

  // Tekst -> audio z lokalnego serwera. W aplikacji desktopowej przez proces glowny
  // (bez problemow z CORS), w przegladarce bezposrednio.
  async function synth(text, c = cfg()) {
    if (D()) {
      const r = await D().runAction('lokalny-tts', { url: c.url, tekst: text, format: c.format, glos: c.glos });
      if (!r?.ok) throw new Error(r?.error || 'Lokalny serwer mowy nie odpowiedzial.');
      const bin = atob(r.audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    const base = c.url.replace(/\/$/, '');
    const res =
      c.format === 'openai'
        ? await fetch(base + '/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'tts-1', input: text, voice: c.glos || 'alloy', response_format: 'wav' }) })
        : c.format === 'xtts'
          ? await fetch(base + '/tts_to_audio/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, speaker_wav: c.glos || 'jarvis', language: 'pl' }) })
          : await fetch(base + '/?text=' + encodeURIComponent(text));
    if (!res.ok) throw new Error('Serwer mowy odpowiedzial ' + res.status + '.');
    return res.arrayBuffer();
  }

  // Wlasny odtwarzacz (zeby dalo sie przerwac w pol zdania) - przez efekt filmowy, gdy wlaczony.
  let ctx = null;
  let current = null;
  async function play(buf) {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(UI.voiceFx?.(ctx) || ctx.destination);
    current = src;
    await new Promise((resolve) => {
      src.onended = resolve;
      src.start();
    });
    if (current === src) current = null;
  }

  let warned = false;
  UI.localSpeak = async (text) => {
    const c = cfg();
    if (!c.on) return false;
    try {
      await play(await synth(text, c));
      return true;
    } catch (e) {
      if (!warned) {
        warned = true;
        toast('Wlasny glos niedostepny (' + e.message + ') - czytam zwyklym glosem.');
      }
      return false;
    }
  };

  UI.localVoiceLive = () => {
    const c = cfg();
    return Boolean(c.on && c.live);
  };

  // Rozmowa na zywo: zdania przychodza po kolei - syntezujemy z wyprzedzeniem, gramy po kolei.
  let queue = [];
  let gen = 0;
  let pumping = false;
  UI.localSay = (text) => {
    const myGen = gen;
    queue.push({ gen: myGen, audio: synth(text).catch(() => null) });
    if (!pumping) pump();
  };
  async function pump() {
    pumping = true;
    while (queue.length) {
      const item = queue.shift();
      const buf = await item.audio;
      if (item.gen !== gen || !buf) continue;
      try {
        await play(buf);
      } catch {
        /* zdanie pominiete */
      }
    }
    pumping = false;
  }
  UI.localSayStop = () => {
    gen++;
    queue = [];
    try {
      current?.stop();
    } catch {
      /* juz zatrzymane */
    }
    current = null;
  };

  // ---------- probka glosu do sklonowania (WAV) ----------
  function toWav(audioBuffer, rate = 22050) {
    const src = audioBuffer.getChannelData(0);
    const ratio = audioBuffer.sampleRate / rate;
    const n = Math.floor(src.length / ratio);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    w(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, src[Math.floor(i * ratio)]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  async function recordSample(status, link) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true } });
    } catch {
      status.textContent = 'Brak dostepu do mikrofonu.';
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let s = 15; s > 0; s--) {
      status.textContent = `Nagrywam... czytaj spokojnie dowolny tekst (${s} s)`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    rec.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ac.decodeAudioData(await new Blob(chunks).arrayBuffer());
    ac.close();
    const wav = toWav(decoded);
    link.href = URL.createObjectURL(wav);
    link.download = 'jarvis.wav';
    link.hidden = false;
    status.textContent = `Gotowe: ${Math.round(wav.size / 1024)} KB. Pobierz plik i wskaz go serwerowi XTTS jako probke glosu (speaker_wav "jarvis").`;
  }

  // ---------- panel ----------
  const def = {
    title: 'WLASNY GLOS (LOKALNIE)',
    glyph: '🗣',
    wide: true,
    build(body) {
      body.innerHTML = '';
      const c = cfg();
      body.appendChild(
        el('div', 'sub', 'Darmowo, na Twoim komputerze. Uzyj glosu, na ktory masz zgode - np. wlasnego. Klonowanie cudzego glosu (aktora, znajomego) bez zgody jest nielegalne.')
      );
      const grid = el('div', 'field');
      grid.style.cssText = 'flex-wrap:wrap;gap:6px;margin:8px 0';
      const url = el('input', 'inp');
      url.value = c.url;
      url.placeholder = 'http://127.0.0.1:8020';
      const fmt = el('select', 'inp');
      [['xtts', 'XTTS (klon z probki)'], ['piper', 'Piper (GET ?text=)'], ['openai', 'Zgodny z OpenAI (/v1/audio/speech)']].forEach(([v, l]) => {
        const o = el('option', null, l);
        o.value = v;
        fmt.appendChild(o);
      });
      fmt.value = c.format;
      const glos = el('input', 'inp');
      glos.value = c.glos;
      glos.placeholder = 'probka / nazwa glosu (np. jarvis)';
      grid.append(url, fmt, glos);
      const opts = el('div', 'field');
      opts.style.cssText = 'flex-wrap:wrap;gap:12px;margin:4px 0 8px';
      const mk = (label, checked) => {
        const l = el('label', 'w-dim');
        const i = el('input');
        i.type = 'checkbox';
        i.checked = checked;
        l.append(i, document.createTextNode(' ' + label));
        opts.appendChild(l);
        return i;
      };
      const on = mk('Uzywaj wlasnego glosu w czacie', c.on);
      const live = mk('Takze w rozmowie na zywo (wolniejsze)', c.live);
      const persist = () => save({ on: on.checked, url: url.value.trim(), format: fmt.value, glos: glos.value.trim() || 'jarvis', live: live.checked });
      [url, fmt, glos, on, live].forEach((x) => x.addEventListener('change', () => {
        persist();
        warned = false;
      }));
      const status = el('div', 'w-dim');
      const btns = el('div', 'field');
      btns.style.cssText = 'flex-wrap:wrap;gap:6px';
      const test = el('button', 'btn primary', '▶ TEST GLOSU');
      test.addEventListener('click', async () => {
        persist();
        status.textContent = 'Lacze z serwerem mowy...';
        try {
          await play(await synth('Dobry wieczor, sir. Wlasny glos dziala.'));
          status.textContent = 'Dziala.';
        } catch (e) {
          status.textContent = e.message;
        }
      });
      const recBtn = el('button', 'btn ghost', '⏺ NAGRAJ PROBKE MOJEGO GLOSU (15 s)');
      const link = el('a', 'btn ghost', '⬇ POBIERZ PROBKE WAV');
      link.hidden = true;
      recBtn.addEventListener('click', () => recordSample(status, link).catch((e) => (status.textContent = e.message)));
      btns.append(test, recBtn, link);
      const help = el('div', 'w-list');
      help.style.marginTop = '10px';
      [
        'Jak uruchomic XTTS (jednorazowo, wymaga Pythona): pip install xtts-api-server, potem: python -m xtts_api_server --listen -p 8020',
        'Probke glosu (plik jarvis.wav z przycisku wyzej) wrzuc do folderu "speakers" serwera.',
        'Piper (szybszy, gotowe polskie glosy, bez klonowania): uruchom serwer HTTP Pipera i wybierz format "Piper".',
        'Gdy serwer nie odpowiada, Jarvis sam wraca do zwyklego glosu.',
      ].forEach((t) => help.appendChild(el('div', null, '• ' + t)));
      body.append(grid, opts, btns, status, help);
    },
  };
  UI.extend('set', { localvoice: def });
})();
