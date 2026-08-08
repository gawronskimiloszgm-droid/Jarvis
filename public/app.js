const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const reactor = document.getElementById('reactor');
const micBtn = document.getElementById('micBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const canvas = document.getElementById('wave');
const ctx = canvas.getContext('2d');
const wakeBtn = document.getElementById('wakeBtn');
const notifyBtn = document.getElementById('notifyBtn');

let ttsConfigured = false;
let pushConfigured = false;

function setStatus(text, mode) {
  statusEl.textContent = text;
  reactor.classList.remove('listening', 'thinking', 'speaking');
  if (mode) reactor.classList.add(mode);
}

function addMessage(text, cls) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

const toastContainer = document.getElementById('toastContainer');

function toast(text, kind = 'error') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'info' ? 'info' : ''}`;
  el.textContent = text;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const GAUGE_CIRCUMFERENCE = 163.36;

function setGauge(name, value, max) {
  const el = document.querySelector(`.gauge[data-gauge="${name}"]`);
  if (!el) return;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  el.querySelector('.gauge-value').style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE * (1 - pct));
  el.querySelector('.gauge-number').textContent = value;
}

async function loadFactsGauge() {
  try {
    const { data } = await fetchJSON('/api/memory');
    setGauge('facts', data.facts.length, 20);
  } catch (e) { /* noop */ }
}

const IMG_MARKER_RE = /\[\[IMG:([^\]]+)\]\]/;
const AKCJA_RE = /\[AKCJA:\s*([^\]]+)\]/g;

// Akcje na komputerze (otworz Spotify, zablokuj ekran, glosnosc...) dzialaja
// TYLKO w aplikacji desktopowej (Electron wstrzykuje window.jarvisDesktop).
// W zwyklej przegladarce ten most po prostu nie istnieje, wiec nic sie nie stanie.
async function runDesktopAction(name) {
  if (!window.jarvisDesktop) {
    toast(`Akcja "${name}" dziala tylko w aplikacji desktopowej.`, 'info');
    return;
  }
  const result = await window.jarvisDesktop.runAction(name);
  if (!result?.ok) toast(`Nie udalo sie wykonac akcji "${name}".`);
}

function renderReplyContent(div, text) {
  const match = text.match(IMG_MARKER_RE);
  if (!match) {
    div.textContent = text;
    return;
  }
  div.innerHTML = '';
  div.appendChild(document.createTextNode(text.slice(0, match.index)));
  const img = document.createElement('img');
  img.src = `/api/image/${match[1]}`;
  img.alt = 'Wygenerowany obraz';
  div.appendChild(img);
  const after = text.slice(match.index + match[0].length);
  if (after.trim()) div.appendChild(document.createTextNode(after));
}

// Darmowy hosting czasem gubi pojedyncze zapytanie przy usypianiu/budzeniu serwera -
// ponawiamy raz lub dwa razy zanim uznamy to za realny blad.
async function fetchJSON(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        if (res.ok && res.status === 204) return { ok: true, status: res.status, data: null };
        throw new Error(`Serwer zwrocil nieoczekiwana odpowiedz (${res.status})`);
      }
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}

// --- Tabs ---
const tabButtons = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
  });
});
function switchToDashboardTab() {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'dashboard'));
  panels.forEach((p) => p.classList.toggle('active', p.id === 'panel-dashboard'));
}

// --- Waveform visual (idle particle ring) ---
let audioLevel = 0;
let t = 0;
function drawWave() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const bars = 48;
  const baseR = w * 0.42;
  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2;
    const wobble = Math.sin(t * 0.05 + i * 0.5) * (4 + audioLevel * 30);
    const len = 6 + Math.abs(wobble);
    const r1 = baseR;
    const r2 = baseR + len;
    const x1 = cx + Math.cos(angle) * r1;
    const y1 = cy + Math.sin(angle) * r1;
    const x2 = cx + Math.cos(angle) * r2;
    const y2 = cy + Math.sin(angle) * r2;
    ctx.strokeStyle = `rgba(53,230,255,${0.15 + audioLevel * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  t += 1;
  audioLevel *= 0.9;
  requestAnimationFrame(drawWave);
}
drawWave();

// --- Siec neuronowa (mozg) w reaktorze ---
const SVG_NS = 'http://www.w3.org/2000/svg';

function buildBrainNetwork() {
  const g = document.getElementById('brainNodes');
  if (!g) return;
  const cx = 100, cy = 98, rx = 68, ry = 72;
  const count = 24;
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 0.85;
    points.push({
      x: cx + Math.cos(angle) * rx * r,
      y: cy + Math.sin(angle) * ry * r,
    });
  }
  points.forEach((p, i) => {
    const neighbours = points
      .map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 }))
      .filter((d) => d.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    neighbours.forEach(({ j }) => {
      const q = points[j];
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', p.x);
      line.setAttribute('y1', p.y);
      line.setAttribute('x2', q.x);
      line.setAttribute('y2', q.y);
      line.setAttribute('class', 'brain-line');
      line.style.animationDelay = `${(Math.random() * 3).toFixed(2)}s`;
      g.appendChild(line);
    });
  });
  points.forEach((p) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', (1.6 + Math.random() * 1.3).toFixed(2));
    c.setAttribute('class', 'brain-node');
    c.style.animationDelay = `${(Math.random() * 2.4).toFixed(2)}s`;
    g.appendChild(c);
  });
}
buildBrainNetwork();

// --- Speech synthesis (browser fallback) ---
function speakBrowser(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'pl-PL';
    utter.rate = 1.0;
    utter.pitch = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => /male|david|daniel|google.*polski/i.test(v.name));
    if (preferred) utter.voice = preferred;
    utter.onboundary = () => { audioLevel = 0.6; };
    utter.onend = resolve;
    utter.onerror = resolve;
    window.speechSynthesis.speak(utter);
  });
}

async function fetchAudioWithRetry(text, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('audio')) return res.blob();
    if (res.status === 204) return null;
    if (attempt === retries) return null;
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return null;
}

function playBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onplay = () => { audioLevel = 0.7; };
    audio.ontimeupdate = () => { audioLevel = 0.5; };
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(resolve);
  });
}

async function prepareAudio(text) {
  if (!ttsConfigured) return null;
  try {
    return await fetchAudioWithRetry(text);
  } catch (e) {
    console.warn('Serwerowy TTS zawiodl dla fragmentu, uzyje glosu przegladarki', e);
    return null;
  }
}

// Mowimy zdanie po zdaniu, w miare jak tekst splywa strumieniem. Synteza
// kolejnego zdania startuje w tle od razu po dolaczeniu do kolejki (nie
// czeka az poprzednie skonczy sie odtwarzac), wiec nie ma ciszy miedzy
// zdaniami podczas gdy serwer generuje kolejny fragment audio.
let speechQueue = [];
let speaking = false;

function enqueueSpeech(text) {
  const clean = text.trim();
  if (!clean) return;
  speechQueue.push({ text: clean, audioPromise: prepareAudio(clean) });
  drainSpeechQueue();
}

async function drainSpeechQueue() {
  if (speaking) return;
  speaking = true;
  setStatus('MOWIE...', 'speaking');
  while (speechQueue.length) {
    const item = speechQueue.shift();
    const blob = await item.audioPromise;
    if (blob) {
      await playBlob(blob);
    } else {
      await speakBrowser(item.text);
    }
  }
  speaking = false;
  setStatus('ONLINE', null);
}

// Dzieli na zdania po . ! ? (ale NIE w liczbach dziesietnych typu "19.5")
// oraz po pustej linii (podwojny enter = nowy akapit). Pojedynczy enter
// sam w sobie nie konczy zdania, zeby uniknac mikro-fragmentow.
const SENTENCE_END_RE = /[^.!?]*(?:(?<!\d)[.!?]+(?!\d)|\n\s*\n)/g;
const MIN_CHUNK_LENGTH = 3;

function extractSentences(buffer) {
  const sentences = [];
  let lastIndex = 0;
  let pending = '';
  SENTENCE_END_RE.lastIndex = 0;
  let match;
  while ((match = SENTENCE_END_RE.exec(buffer))) {
    pending += match[0];
    lastIndex = SENTENCE_END_RE.lastIndex;
    if (pending.trim().length >= MIN_CHUNK_LENGTH) {
      sentences.push(pending);
      pending = '';
    }
  }
  return { sentences, remainder: pending + buffer.slice(lastIndex) };
}

// --- Chat (streaming) ---
async function streamResponseInto(res, replyDiv) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Blad serwera (${res.status})`);
  }

  let fullReply = '';
  let speechBuffer = '';
  const handledActions = new Set();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    fullReply += piece;
    renderReplyContent(replyDiv, fullReply);
    logEl.scrollTop = logEl.scrollHeight;

    for (const m of fullReply.matchAll(AKCJA_RE)) {
      const name = m[1].trim();
      if (!handledActions.has(name)) {
        handledActions.add(name);
        runDesktopAction(name);
      }
    }

    speechBuffer += piece.replace(IMG_MARKER_RE, '').replace(AKCJA_RE, '');
    const { sentences, remainder } = extractSentences(speechBuffer);
    for (const s of sentences) enqueueSpeech(s);
    speechBuffer = remainder;
  }
  if (speechBuffer.trim()) enqueueSpeech(speechBuffer);

  const imgMatch = fullReply.match(IMG_MARKER_RE);
  if (imgMatch) {
    const img = document.createElement('img');
    img.src = `/api/image/${imgMatch[1]}`;
    img.alt = 'Wygenerowany obraz';
    imageGallery.prepend(img);
    toast('Jarvis wygenerowal obraz - zobacz zakladke Obrazy.', 'info');
  } else {
    maybeShowResponseVisual(fullReply);
  }

  return fullReply;
}

// Dla dluzszych, tresciwych odpowiedzi generujemy w tle male zdjecie-ilustracje
// dopasowane do tematu i pokazujemy je na kilka sekund w niebieskiej ramce -
// nie blokuje to glosu (odpalane rownolegle, wynik pojawia sie gdy jest gotowy).
const visualPopup = document.getElementById('visualPopup');
const responseVisualImg = document.getElementById('responseVisualImg');
let visualPopupHideTimer = null;
let visualPopupRemoveTimer = null;

async function maybeShowResponseVisual(text) {
  const clean = text.trim();
  if (clean.length < 40) return;
  try {
    const { ok, data } = await fetchJSON('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: clean.slice(0, 220) }),
    });
    if (!ok) return;
    clearTimeout(visualPopupHideTimer);
    clearTimeout(visualPopupRemoveTimer);
    responseVisualImg.src = data.url;
    visualPopup.hidden = false;
    requestAnimationFrame(() => visualPopup.classList.add('show'));
    visualPopupHideTimer = setTimeout(() => {
      visualPopup.classList.remove('show');
      visualPopupRemoveTimer = setTimeout(() => { visualPopup.hidden = true; }, 400);
    }, 7000);
  } catch (e) { /* noop - to tylko dodatkowa ilustracja, nie krytyczna */ }
}

async function sendMessage(text) {
  if (!text.trim()) return;
  switchToDashboardTab();
  addMessage(text, 'user');
  textInput.value = '';
  setStatus('PRZETWARZAM...', 'thinking');

  const replyDiv = addMessage('', 'jarvis');
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const fullReply = await streamResponseInto(res, replyDiv);
    if (!fullReply.trim()) {
      replyDiv.remove();
    } else {
      loadTodos();
      loadReminders();
      loadFactsGauge();
    }
  } catch (err) {
    replyDiv.remove();
    toast(`Blad: ${err.message}`);
    setStatus('ONLINE', null);
  }
}

sendBtn.addEventListener('click', () => sendMessage(textInput.value));
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage(textInput.value);
});

// --- Nagrywanie + transkrypcja przez Gemini (aplikacja desktopowa) ---
// Elektronowy Chromium NIE ma dolaczonego klucza Google potrzebnego do
// wbudowanego rozpoznawania mowy przegladarki (SpeechRecognition zawsze
// konczy sie bledem "network" mimo dzialajacego internetu) - to znany
// limit Electrona, nie blad naszego kodu. Dla aplikacji desktopowej
// nagrywamy wiec audio samodzielnie i wysylamy je do transkrypcji przez
// Gemini (ten sam model, ktory juz uzywamy do czatu).
const isElectron = Boolean(window.jarvisDesktop);
let electronMicStream = null;
let electronAudioCtx = null;
let electronAnalyser = null;

async function ensureElectronMicStream() {
  if (electronMicStream) return electronMicStream;
  electronMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  electronAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = electronAudioCtx.createMediaStreamSource(electronMicStream);
  electronAnalyser = electronAudioCtx.createAnalyser();
  electronAnalyser.fftSize = 512;
  source.connect(electronAnalyser);
  return electronMicStream;
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function transcribeBlob(blob) {
  const dataUrl = await blobToDataUrl(blob);
  const { ok, data } = await fetchJSON('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: dataUrl, mimeType: 'audio/webm' }),
  });
  return ok ? (data.text || '').trim() : '';
}

// Nagrywa az do ~1.1s ciszy po wykryciu mowy (albo maks. dlugosci), potem
// oddaje nagrany blob. Zwraca null jesli nic sensownego nie nagrano.
function recordUntilSilence({ maxMs = 8000, silenceMs = 1100, threshold = 20 } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const recorder = new MediaRecorder(electronMicStream, { mimeType: 'audio/webm' });
    let started = false;
    let silenceStart = null;
    let rafId = null;
    const startTime = Date.now();

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      cancelAnimationFrame(rafId);
      const blob = new Blob(chunks, { type: 'audio/webm' });
      resolve(blob.size > 4000 ? blob : null);
    };

    const data = new Uint8Array(electronAnalyser.frequencyBinCount);
    function loop() {
      electronAnalyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const elapsed = Date.now() - startTime;
      if (avg > threshold) {
        started = true;
        silenceStart = null;
      } else if (started) {
        if (!silenceStart) silenceStart = Date.now();
        if (Date.now() - silenceStart > silenceMs) {
          recorder.stop();
          return;
        }
      }
      if (elapsed > maxMs) {
        recorder.stop();
        return;
      }
      rafId = requestAnimationFrame(loop);
    }
    recorder.start();
    loop();
  });
}

let awaitingFollowUp = false;
let awaitingFollowUpTimer = null;

function handleWakeTranscript(transcript) {
  const clean = transcript.trim();
  if (!clean) return;
  toast(`Uslyszalem: "${clean}"`, 'info');

  // Jesli chwile wczesniej powiedziano samo "Jarvis" i Jarvis czeka na
  // dokonczenie polecenia, nie trzeba powtarzac slowa "Jarvis" ponownie.
  if (awaitingFollowUp) {
    awaitingFollowUp = false;
    clearTimeout(awaitingFollowUpTimer);
    sendMessage(clean);
    return;
  }

  const normalized = normalizePolish(clean);
  const match = normalized.match(WAKE_RE);
  if (match) {
    const commandStart = match.index + match[0].length - match[3].length;
    const command = clean.slice(commandStart).trim();
    if (command) {
      sendMessage(command);
    } else {
      // Powiedziano samo "Jarvis" bez polecenia - potwierdz, ze slucham,
      // zamiast cicho nic nie robic.
      awaitingFollowUp = true;
      enqueueSpeech('Slucham, sir.');
      awaitingFollowUpTimer = setTimeout(() => { awaitingFollowUp = false; }, 8000);
    }
  }
}

let electronWakeLoopActive = false;

async function startElectronWakeListening() {
  try {
    await ensureElectronMicStream();
  } catch (e) {
    toast('Brak dostepu do mikrofonu.');
    wakeModeOn = false;
    wakeBtn.classList.remove('active');
    return;
  }
  if (!wakeStartToastShown) {
    wakeStartToastShown = true;
    toast('Nasluch mikrofonu aktywny.', 'info');
  }
  electronWakeLoopActive = true;
  electronWakeLoop();
}

function stopElectronWakeListening() {
  electronWakeLoopActive = false;
}

async function electronWakeLoop() {
  while (electronWakeLoopActive && wakeModeOn) {
    if (speaking) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    const blob = await recordUntilSilence();
    if (blob) {
      const text = await transcribeBlob(blob);
      if (text) handleWakeTranscript(text);
    }
  }
}

// --- Voice input (push-to-talk) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizing = false;
let recognizer = null;

if (isElectron) {
  micBtn.addEventListener('click', async () => {
    if (wakeModeOn) toggleWakeMode();
    micBtn.classList.add('active');
    setStatus('SLUCHAM...', 'listening');
    try {
      await ensureElectronMicStream();
      const blob = await recordUntilSilence();
      if (blob) {
        const text = await transcribeBlob(blob);
        if (text) sendMessage(text);
        else setStatus('ONLINE', null);
      } else {
        setStatus('ONLINE', null);
      }
    } catch (e) {
      toast('Brak dostepu do mikrofonu.');
      setStatus('ONLINE', null);
    }
    micBtn.classList.remove('active');
  });
} else if (SpeechRecognition) {
  recognizer = new SpeechRecognition();
  recognizer.lang = 'pl-PL';
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;

  recognizer.onstart = () => {
    recognizing = true;
    micBtn.classList.add('active');
    setStatus('SLUCHAM...', 'listening');
  };
  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    sendMessage(transcript);
  };
  recognizer.onerror = () => {
    setStatus('ONLINE', null);
  };
  recognizer.onend = () => {
    recognizing = false;
    micBtn.classList.remove('active');
    if (statusEl.textContent === 'SLUCHAM...') setStatus('ONLINE', null);
  };

  micBtn.addEventListener('click', () => {
    if (wakeModeOn) toggleWakeMode();
    if (recognizing) {
      recognizer.stop();
    } else {
      recognizer.start();
    }
  });
} else {
  micBtn.disabled = true;
  micBtn.title = 'Rozpoznawanie mowy niedostepne w tej przegladarce';
}

// --- Wake word ("Jarvis, ...") ---
let wakeModeOn = false;
let wakeRecognizer = null;
let wakeStartToastShown = false;
// Polski silnik rozpoznawania mowy czesto transkrybuje angielskie "Jarvis"
// fonetycznie na rozne sposoby - lapiemy popularne warianty. Dopasowujemy na
// znormalizowanym tekscie (bez polskich znakow diakrytycznych), ale komende
// wycinamy z oryginalnego transkryptu, zeby nie zgubic ogonkow w tresci.
const WAKE_RE = /\b(hej\s+)?(jarvis|dzarwis|dzarwiz|czarwis|harwis|harvis|jarwis|zarwis|dzarvis)[,:]?\s*(.*)/i;

function normalizePolish(text) {
  return text
    .toLowerCase()
    .replace(/[żź]/g, 'z')
    .replace(/ó/g, 'o')
    .replace(/ą/g, 'a')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ć/g, 'c')
    .replace(/ń/g, 'n')
    .replace(/ś/g, 's');
}

function toggleWakeMode() {
  if (!SpeechRecognition && !isElectron) return;
  wakeModeOn = !wakeModeOn;
  wakeBtn.classList.toggle('active', wakeModeOn);
  if (wakeModeOn) {
    if (isElectron) startElectronWakeListening();
    else startWakeListening();
    setStatus('NASLUCHUJE "JARVIS"...', null);
  } else {
    if (isElectron) stopElectronWakeListening();
    else if (wakeRecognizer) wakeRecognizer.stop();
    setStatus('ONLINE', null);
  }
}

let wakeRecognizerRunning = false;

function startWakeListening() {
  if (isElectron || !SpeechRecognition || !wakeModeOn || wakeRecognizerRunning) return;
  wakeRecognizer = new SpeechRecognition();
  wakeRecognizer.lang = 'pl-PL';
  wakeRecognizer.interimResults = false;
  wakeRecognizer.continuous = true;

  wakeRecognizer.onstart = () => {
    wakeRecognizerRunning = true;
    if (!wakeStartToastShown) {
      wakeStartToastShown = true;
      toast('Nasluch mikrofonu aktywny.', 'info');
    }
  };

  wakeRecognizer.onresult = (event) => {
    if (speaking) return; // nie reaguj na wlasny glos Jarvisa lecacy z glosnikow
    const last = event.results[event.results.length - 1];
    handleWakeTranscript(last[0].transcript);
  };
  wakeRecognizer.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      wakeModeOn = false;
      wakeBtn.classList.remove('active');
      toast('Brak zgody na mikrofon - kliknij ikone 🎤 przy pasku adresu i zezwol, potem klikni 👂 ponownie.');
    } else if (event.error !== 'no-speech') {
      // 'no-speech' jest normalne w ciszy i pojawia sie czesto - nie pokazujemy go,
      // zeby nie zasypac powiadomieniami. Kazdy inny blad jest warty pokazania.
      toast(`Blad rozpoznawania mowy: ${event.error}`);
    }
  };
  wakeRecognizer.onend = () => {
    wakeRecognizerRunning = false;
    if (wakeModeOn) {
      setTimeout(() => { if (wakeModeOn) startWakeListening(); }, 300);
    }
  };
  try {
    wakeRecognizer.start();
  } catch (e) {
    wakeRecognizerRunning = false;
  }
}

// Niektore przegladarki nie pozwalaja uzyc mikrofonu, dopoki uzytkownik
// choc raz nie kliknie/dotknie strony - ta siatka bezpieczenstwa probuje
// ponownie wtedy, gdyby automatyczny start na wejsciu sie nie udal.
let firstGestureHandled = false;
function retryWakeOnFirstGesture() {
  if (firstGestureHandled) return;
  firstGestureHandled = true;
  if (isElectron) return; // desktop nie potrzebuje tej siatki bezpieczenstwa
  if (wakeModeOn && !wakeRecognizerRunning) startWakeListening();
}
['click', 'keydown', 'touchstart'].forEach((evt) =>
  document.addEventListener(evt, retryWakeOnFirstGesture, { once: true })
);

if (wakeBtn) {
  if (!SpeechRecognition && !isElectron) {
    wakeBtn.disabled = true;
    wakeBtn.title = 'Rozpoznawanie mowy niedostepne w tej przegladarce';
  } else {
    wakeBtn.addEventListener('click', toggleWakeMode);
  }
}

// --- To-do list ---
const todoForm = document.getElementById('todoForm');
const todoInput = document.getElementById('todoInput');
const todoList = document.getElementById('todoList');

function renderTodos(todos) {
  setGauge('todos', todos.filter((t) => !t.done).length, 10);
  todoList.innerHTML = '';
  if (!todos.length) {
    todoList.innerHTML = '<li class="empty-hint">Brak zadan. Dodaj cos ponizej.</li>';
    return;
  }
  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = `item-row ${todo.done ? 'done' : ''}`;
    li.innerHTML = `
      <input type="checkbox" class="item-check" ${todo.done ? 'checked' : ''} />
      <span class="item-text"></span>
      <button class="item-delete" aria-label="Usun">✕</button>
    `;
    li.querySelector('.item-text').textContent = todo.text;
    li.querySelector('.item-check').addEventListener('change', async (e) => {
      const { data } = await fetchJSON(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: e.target.checked }),
      });
      renderTodos(data.todos);
    });
    li.querySelector('.item-delete').addEventListener('click', async () => {
      const { data } = await fetchJSON(`/api/todos/${todo.id}`, { method: 'DELETE' });
      renderTodos(data.todos);
    });
    todoList.appendChild(li);
  }
}

async function loadTodos() {
  const { data } = await fetchJSON('/api/todos');
  renderTodos(data.todos);
}

todoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;
  todoInput.value = '';
  const { data } = await fetchJSON('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  renderTodos(data.todos);
});

// --- Reminders ---
const reminderForm = document.getElementById('reminderForm');
const reminderText = document.getElementById('reminderText');
const reminderDate = document.getElementById('reminderDate');
const reminderList = document.getElementById('reminderList');

function renderReminders(reminders) {
  const pending = reminders.filter((r) => !r.sent);
  setGauge('reminders', pending.length, 10);
  reminderList.innerHTML = '';
  if (!pending.length) {
    reminderList.innerHTML = '<li class="empty-hint">Brak zaplanowanych przypomnien.</li>';
    return;
  }
  for (const r of pending) {
    const li = document.createElement('li');
    li.className = 'item-row';
    const when = new Date(r.dueAt).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
    li.innerHTML = `
      <div style="flex:1">
        <div class="item-text"></div>
        <div class="item-meta"></div>
      </div>
      <button class="item-delete" aria-label="Usun">✕</button>
    `;
    li.querySelector('.item-text').textContent = r.text;
    li.querySelector('.item-meta').textContent = when;
    li.querySelector('.item-delete').addEventListener('click', async () => {
      const { data } = await fetchJSON(`/api/reminders/${r.id}`, { method: 'DELETE' });
      renderReminders(data.reminders);
    });
    reminderList.appendChild(li);
  }
}

async function loadReminders() {
  const { data } = await fetchJSON('/api/reminders');
  renderReminders(data.reminders);
}

reminderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = reminderText.value.trim();
  const dueAt = reminderDate.value;
  if (!text || !dueAt) return;
  const { data } = await fetchJSON('/api/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, dueAt }),
  });
  reminderText.value = '';
  reminderDate.value = '';
  renderReminders(data.reminders);
});

// --- Kamera ---
const cameraVideo = document.getElementById('cameraVideo');
const cameraCanvas = document.getElementById('cameraCanvas');
const cameraToggleBtn = document.getElementById('cameraToggleBtn');
const cameraAskBtn = document.getElementById('cameraAskBtn');
let cameraStream = null;

cameraToggleBtn.addEventListener('click', async () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraToggleBtn.textContent = 'Wlacz kamere';
    cameraAskBtn.disabled = true;
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    cameraVideo.srcObject = cameraStream;
    cameraToggleBtn.textContent = 'Wylacz kamere';
    cameraAskBtn.disabled = false;
  } catch (err) {
    addMessage(`Nie udalo sie uzyskac dostepu do kamery: ${err.message}`, 'error');
  }
});

cameraAskBtn.addEventListener('click', async () => {
  if (!cameraStream) return;
  const question = textInput.value.trim();
  textInput.value = '';

  const maxW = 640;
  const scale = Math.min(1, maxW / cameraVideo.videoWidth);
  cameraCanvas.width = cameraVideo.videoWidth * scale;
  cameraCanvas.height = cameraVideo.videoHeight * scale;
  cameraCanvas.getContext('2d').drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
  const dataUrl = cameraCanvas.toDataURL('image/jpeg', 0.8);

  switchToDashboardTab();
  addMessage(question ? `[kamera] ${question}` : '[kamera] Co widzisz?', 'user');
  setStatus('PRZETWARZAM...', 'thinking');
  const replyDiv = addMessage('', 'jarvis');
  try {
    const res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, mimeType: 'image/jpeg', question }),
    });
    await streamResponseInto(res, replyDiv);
  } catch (err) {
    replyDiv.remove();
    toast(`Blad: ${err.message}`);
    setStatus('ONLINE', null);
  }
});

// --- Generowanie obrazow ---
const imageForm = document.getElementById('imageForm');
const imagePrompt = document.getElementById('imagePrompt');
const imageGallery = document.getElementById('imageGallery');

imageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = imagePrompt.value.trim();
  if (!prompt) return;
  imagePrompt.value = '';

  const placeholder = document.createElement('div');
  placeholder.className = 'empty-hint';
  placeholder.textContent = `Generuje: "${prompt}"...`;
  imageGallery.prepend(placeholder);

  try {
    const { ok, data } = await fetchJSON('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    placeholder.remove();
    if (!ok) throw new Error(data.error || 'Blad generowania obrazu.');
    const img = document.createElement('img');
    img.src = data.url;
    img.alt = prompt;
    imageGallery.prepend(img);
  } catch (err) {
    placeholder.textContent = `Blad: ${err.message}`;
  }
});

// --- Timer ---
const timerDisplay = document.getElementById('timerDisplay');
const timerMinutes = document.getElementById('timerMinutes');
const timerStartBtn = document.getElementById('timerStartBtn');
const timerCancelBtn = document.getElementById('timerCancelBtn');
let timerInterval = null;
let timerEndsAt = null;

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function beep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx2 = new AudioCtx();
    const osc = ctx2.createOscillator();
    const gain = ctx2.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx2.destination);
    gain.gain.setValueAtTime(0.2, ctx2.currentTime);
    osc.start();
    osc.stop(ctx2.currentTime + 0.4);
  } catch (e) { /* noop */ }
}

function startTimer() {
  const minutes = parseFloat(timerMinutes.value) || 0;
  if (minutes <= 0) return;
  timerEndsAt = Date.now() + minutes * 60 * 1000;
  timerStartBtn.hidden = true;
  timerCancelBtn.hidden = false;
  timerMinutes.disabled = true;

  timerInterval = setInterval(() => {
    const remaining = timerEndsAt - Date.now();
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerDisplay.textContent = '00:00';
      resetTimerUI();
      beep();
      if (Notification && Notification.permission === 'granted') {
        new Notification('J.A.R.V.I.S.', { body: 'Czas minal, sir.' });
      }
      toast('Czas minal, sir.', 'info');
      enqueueSpeech('Czas minal, sir.');
      return;
    }
    timerDisplay.textContent = formatTime(remaining);
  }, 250);
}

function resetTimerUI() {
  timerStartBtn.hidden = false;
  timerCancelBtn.hidden = true;
  timerMinutes.disabled = false;
}

timerStartBtn.addEventListener('click', startTimer);
timerCancelBtn.addEventListener('click', () => {
  clearInterval(timerInterval);
  timerDisplay.textContent = '00:00';
  resetTimerUI();
});

// --- Push notifications ---
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Powiadomienia push nie sa wspierane w tej przegladarce.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const reg = await navigator.serviceWorker.ready;
  const { data } = await fetchJSON('/api/push/vapid-public-key');
  if (!data.publicKey) {
    toast('Serwer nie ma skonfigurowanych kluczy powiadomien.');
    return;
  }
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.publicKey),
  });
  await fetchJSON('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });
  notifyBtn.classList.add('active');
}

notifyBtn.addEventListener('click', enablePush);

// --- Zegar ---
const clockTime = document.getElementById('clockTime');
const clockDate = document.getElementById('clockDate');

function tickClock() {
  const now = new Date();
  clockTime.textContent = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  clockDate.textContent = now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
}
tickClock();
setInterval(tickClock, 1000);

// --- Pasek dat ---
function renderDateStrip() {
  const el = document.getElementById('dateStrip');
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  el.innerHTML = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const chip = document.createElement('div');
    chip.className = 'date-chip' + (d === now.getDate() ? ' today' : '');
    chip.textContent = String(d).padStart(2, '0');
    el.appendChild(chip);
  }
  requestAnimationFrame(() => {
    el.querySelector('.today')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}
renderDateStrip();

// --- Cykliczny status (odswieza sie co kilka sekund) ---
const statusCycleEl = document.getElementById('statusCycle');
let cycleTick = 0;

function tickStatusCycle() {
  const facts = document.querySelector('.gauge[data-gauge="facts"] .gauge-number')?.textContent || '0';
  const todos = document.querySelector('.gauge[data-gauge="todos"] .gauge-number')?.textContent || '0';
  const reminders = document.querySelector('.gauge[data-gauge="reminders"] .gauge-number')?.textContent || '0';
  const options = [
    `PAMIEC: ${facts} ZAPAMIETANYCH FAKTOW`,
    `ZADANIA: ${todos} OTWARTYCH`,
    `PRZYPOMNIENIA: ${reminders} ZAPLANOWANYCH`,
    wakeModeOn ? 'NASLUCH: AKTYWNY' : 'NASLUCH: WYLACZONY',
    `POGODA: ${weatherTemp.textContent} ${weatherDesc.textContent.toUpperCase()}`,
    'POLACZENIE: STABILNE',
  ];
  statusCycleEl.style.opacity = 0;
  setTimeout(() => {
    statusCycleEl.textContent = options[cycleTick % options.length];
    statusCycleEl.style.opacity = 1;
    cycleTick++;
  }, 200);
}

// --- Pogoda (widget na panelu glownym) ---
const weatherIcon = document.getElementById('weatherIcon');
const weatherTemp = document.getElementById('weatherTemp');
const weatherDesc = document.getElementById('weatherDesc');
const weatherPlace = document.getElementById('weatherPlace');

const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  66: '🌨', 67: '🌨',
  71: '🌨', 73: '🌨', 75: '❄️', 77: '❄️',
  80: '🌦', 81: '🌧', 82: '⛈',
  85: '🌨', 86: '❄️',
  95: '⛈', 96: '⛈', 99: '⛈',
};
const WMO_DESC = {
  0: 'bezchmurnie', 1: 'przewaznie bezchmurnie', 2: 'czesciowe zachmurzenie', 3: 'pochmurno',
  45: 'mgla', 48: 'mgla z szadzia',
  51: 'mzawka', 53: 'mzawka', 55: 'mzawka',
  61: 'deszcz', 63: 'deszcz', 65: 'silny deszcz',
  66: 'marznacy deszcz', 67: 'marznacy deszcz',
  71: 'snieg', 73: 'snieg', 75: 'silny snieg', 77: 'snieg',
  80: 'przelotny deszcz', 81: 'przelotny deszcz', 82: 'ulewa',
  85: 'przelotny snieg', 86: 'silny snieg',
  95: 'burza', 96: 'burza z gradem', 99: 'silna burza',
};

const forecastRow = document.getElementById('forecastRow');
const FC_DAY_LABELS = ['NIEDZ', 'PON', 'WT', 'SR', 'CZW', 'PT', 'SOB'];

async function fetchWeatherFor(lat, lon, placeLabel) {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max&forecast_days=4&timezone=auto`
    );
    const data = await res.json();
    const code = data.current.weather_code;
    weatherIcon.textContent = WMO_ICONS[code] || '🌐';
    weatherTemp.textContent = `${Math.round(data.current.temperature_2m)}°`;
    weatherDesc.textContent = WMO_DESC[code] || '';
    weatherPlace.textContent = placeLabel;

    forecastRow.innerHTML = '';
    const days = data.daily?.time || [];
    days.forEach((dateStr, i) => {
      if (i === 0) return;
      const dow = FC_DAY_LABELS[new Date(dateStr).getDay()];
      const dCode = data.daily.weather_code[i];
      const max = Math.round(data.daily.temperature_2m_max[i]);
      const chip = document.createElement('div');
      chip.className = 'forecast-day';
      chip.innerHTML = `<span class="fc-label">${dow}</span><span class="fc-icon">${WMO_ICONS[dCode] || '🌐'}</span><span class="fc-temp">${max}°</span>`;
      forecastRow.appendChild(chip);
    });
  } catch (e) {
    weatherDesc.textContent = 'Pogoda niedostepna';
  }
}

function initWeatherWidget() {
  if (!navigator.geolocation) {
    fetchWeatherFor(52.23, 21.01, 'WARSZAWA (domyslnie)');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => fetchWeatherFor(pos.coords.latitude, pos.coords.longitude, 'TWOJA LOKALIZACJA'),
    () => fetchWeatherFor(52.23, 21.01, 'WARSZAWA (domyslnie)'),
    { timeout: 8000 }
  );
}
initWeatherWidget();
setInterval(initWeatherWidget, 20 * 60 * 1000);

tickStatusCycle();
setInterval(tickStatusCycle, 4000);

// --- Sekwencja startowa ---
const bootOverlay = document.getElementById('bootOverlay');
const bootLog = document.getElementById('bootLog');
const BOOT_LINES = [
  '> inicjalizacja rdzenia J.A.R.V.I.S...',
  '> laczenie z modelem Gemini...',
  '> wczytywanie pamieci uzytkownika...',
  '> synchronizacja zadan i przypomnien...',
  '> kalibracja syntezatora mowy...',
  '> systemy gotowe.',
];

async function runBootSequence() {
  for (const line of BOOT_LINES) {
    bootLog.textContent += line + '\n';
    await new Promise((r) => setTimeout(r, 200));
  }
}

function hideBootOverlay() {
  bootOverlay.classList.add('hidden');
  setTimeout(() => bootOverlay.remove(), 700);
}

// --- Init ---
async function init() {
  const bootPromise = runBootSequence();
  setStatus('URUCHAMIAM SYSTEMY...', 'thinking');
  try {
    const { data } = await fetchJSON('/api/health');
    ttsConfigured = Boolean(data.ttsConfigured);
    pushConfigured = Boolean(data.pushConfigured);

    const replyDiv = addMessage('', 'jarvis');
    setStatus('PRZETWARZAM...', 'thinking');
    try {
      const res = await fetch('/api/greeting');
      const greeting = await streamResponseInto(res, replyDiv);
      if (!greeting.trim()) replyDiv.remove();
    } catch (e) {
      replyDiv.textContent = 'Wszystkie systemy sprawne, sir.';
    }
    if (!speaking) setStatus('ONLINE', null);
  } catch (e) {
    setStatus('BRAK POLACZENIA', null);
    toast('Nie moge polaczyc sie z serwerem.');
  }
  await bootPromise;
  hideBootOverlay();
  loadTodos();
  loadReminders();
  loadFactsGauge();

  if ((SpeechRecognition || isElectron) && !wakeModeOn) toggleWakeMode();
}
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
