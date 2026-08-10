const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const reactor = document.getElementById('reactor');
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

function setGauge(name, value) {
  const el = document.querySelector(`[data-stat="${name}"]`);
  if (!el) return;
  el.textContent = value;
}

async function loadFactsGauge() {
  try {
    const { data } = await fetchJSON('/api/memory');
    setGauge('facts', data.facts.length, 20);
  } catch (e) { /* noop */ }
}

const IMG_MARKER_RE = /\[\[IMG:([^\]]+)\]\]/;
const AKCJA_RE = /\[AKCJA:\s*([^\]]+)\]/g;

// Akcje na urzadzeniu (otworz Spotify, glosnosc, zablokuj ekran...) dzialaja
// w aplikacji desktopowej (Electron wstrzykuje window.jarvisDesktop) i w
// aplikacji mobilnej (Capacitor wstrzykuje window.Capacitor). W zwyklej
// przegladarce zaden z tych mostow nie istnieje, wiec nic sie nie stanie.
function isCapacitorNative() {
  return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

async function runDesktopAction(name) {
  if (window.jarvisDesktop) {
    const result = await window.jarvisDesktop.runAction(name);
    if (!result?.ok) toast(`Nie udalo sie wykonac akcji "${name}".`);
    return;
  }
  if (isCapacitorNative() && window.Capacitor.Plugins.DeviceControl) {
    const result = await window.Capacitor.Plugins.DeviceControl.runAction({ name });
    if (!result?.ok) toast(`Nie udalo sie wykonac akcji "${name}".`);
    return;
  }
  toast(`Akcja "${name}" dziala tylko w aplikacji desktopowej lub mobilnej.`, 'info');
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
const tabButtons = document.querySelectorAll('.folder-tab');
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

// --- Celownik/radar w reaktorze ---
const SVG_NS = 'http://www.w3.org/2000/svg';

function buildReticleTicks() {
  const g = document.getElementById('reticleTicks');
  if (!g) return;
  const cx = 100, cy = 100, r = 80, tickLen = 6;
  const count = 36;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const major = i % 3 === 0;
    const outerR = r + (major ? tickLen * 1.6 : tickLen);
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle) * outerR;
    const y2 = cy + Math.sin(angle) * outerR;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1.toFixed(2));
    line.setAttribute('y1', y1.toFixed(2));
    line.setAttribute('x2', x2.toFixed(2));
    line.setAttribute('y2', y2.toFixed(2));
    line.setAttribute('class', major ? 'reticle-tick major' : 'reticle-tick');
    g.appendChild(line);
  }
}
buildReticleTicks();

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
  }

  return fullReply;
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
      body: JSON.stringify({ message: text, location: mobileLocation }),
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


// --- Rozmowa na zywo (Gemini Live API) ---
// Ciagly, dwukierunkowy strumien audio zamiast nagraj->transkrybuj->czat->mow.
// To sam model rozumie mowe i mowi natywnie - bez posredniego tekstu, bez
// dopasowywania slowa "Jarvis" (ktore bylo niewiarygodne). Kliknij, zeby
// zaczac rozmowe, kliknij ponownie, zeby ja zakonczyc.
let wakeModeOn = false; // true = trwa rozmowa na zywo
let liveWs = null;
let liveAudioCtx = null;
let liveMicStream = null;
let liveProcessor = null;
let livePlaybackCtx = null;
let liveNextPlayTime = 0;
let liveActiveSources = [];
let liveFrameTimer = null;
const liveFrameCanvas = document.createElement('canvas');

function getLiveWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${location.host}/ws/voice`;
  if (mobileLocation) {
    return `${base}?lat=${mobileLocation.lat}&lon=${mobileLocation.lon}`;
  }
  return base;
}

// Lokalizacja GPS - tylko w aplikacji mobilnej (Capacitor). Uzywana jako
// domyslna lokalizacja dla pogody, gdy uzytkownik nie poda miasta.
let mobileLocation = null;

async function primeMobileLocation() {
  if (!isCapacitorNative() || !window.Capacitor.Plugins.Geolocation) return;
  try {
    const pos = await window.Capacitor.Plugins.Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 8000,
    });
    mobileLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch (e) {
    /* brak zgody albo brak GPS - po prostu nie uzywamy lokalizacji */
  }
}
primeMobileLocation();

function resampleTo16k(float32Array, inputRate) {
  if (inputRate === 16000) return float32Array;
  const ratio = inputRate / 16000;
  const outLength = Math.floor(float32Array.length / ratio);
  const result = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const idxLow = Math.floor(srcIdx);
    const idxHigh = Math.min(idxLow + 1, float32Array.length - 1);
    const frac = srcIdx - idxLow;
    result[i] = float32Array[idxLow] * (1 - frac) + float32Array[idxHigh] * frac;
  }
  return result;
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function stopLivePlayback() {
  liveActiveSources.forEach((s) => { try { s.stop(); } catch (e) { /* noop */ } });
  liveActiveSources = [];
  if (livePlaybackCtx) liveNextPlayTime = livePlaybackCtx.currentTime;
}

function playLiveAudioChunk(arrayBuffer) {
  if (!livePlaybackCtx) return;
  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  const audioBuffer = livePlaybackCtx.createBuffer(1, float32.length, 24000);
  audioBuffer.copyToChannel(float32, 0);
  const source = livePlaybackCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(livePlaybackCtx.destination);
  const now = livePlaybackCtx.currentTime;
  const startAt = Math.max(now, liveNextPlayTime);
  source.start(startAt);
  liveNextPlayTime = startAt + audioBuffer.duration;
  liveActiveSources.push(source);
  source.onended = () => { liveActiveSources = liveActiveSources.filter((s) => s !== source); };
  audioLevel = 0.7;
}

function startLiveFrameCapture(stream) {
  const previewEl = document.getElementById('liveCameraPreview');
  if (!previewEl) return;
  previewEl.srcObject = stream;
  previewEl.hidden = false;

  const ctx = liveFrameCanvas.getContext('2d');
  liveFrameTimer = setInterval(() => {
    if (!wakeModeOn || !liveWs || liveWs.readyState !== WebSocket.OPEN) return;
    if (!previewEl.videoWidth) return;
    const w = Math.min(480, previewEl.videoWidth);
    const h = Math.round(w * (previewEl.videoHeight / previewEl.videoWidth));
    liveFrameCanvas.width = w;
    liveFrameCanvas.height = h;
    ctx.drawImage(previewEl, 0, 0, w, h);
    const dataUrl = liveFrameCanvas.toDataURL('image/jpeg', 0.6);
    liveWs.send(JSON.stringify({ type: 'video', data: dataUrl.split(',')[1] }));
  }, 1500);
}

function stopLiveFrameCapture() {
  if (liveFrameTimer) { clearInterval(liveFrameTimer); liveFrameTimer = null; }
  const previewEl = document.getElementById('liveCameraPreview');
  if (previewEl) { previewEl.srcObject = null; previewEl.hidden = true; }
}

async function startLiveConversation() {
  stopWakeListening();
  wakeModeOn = true;
  wakeBtn.classList.add('active');
  setStatus('LACZE...', 'thinking');

  try {
    liveMicStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
      video: { facingMode: 'user', width: { ideal: 480 } },
    });
  } catch (e) {
    try {
      liveMicStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch (e2) {
      toast('Brak dostepu do mikrofonu.');
      wakeModeOn = false;
      wakeBtn.classList.remove('active');
      setStatus('ONLINE', null);
      startWakeListening();
      return;
    }
  }

  const liveVideoTrack = liveMicStream.getVideoTracks()[0] || null;
  if (liveVideoTrack) startLiveFrameCapture(liveMicStream);

  livePlaybackCtx = new (window.AudioContext || window.webkitAudioContext)();
  liveNextPlayTime = 0;
  liveWs = new WebSocket(getLiveWsUrl());
  liveWs.binaryType = 'arraybuffer';

  liveWs.onopen = () => {
    liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = liveAudioCtx.createMediaStreamSource(liveMicStream);
    liveProcessor = liveAudioCtx.createScriptProcessor(4096, 1, 1);
    const silentGain = liveAudioCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(liveProcessor);
    liveProcessor.connect(silentGain);
    silentGain.connect(liveAudioCtx.destination);

    liveProcessor.onaudioprocess = (e) => {
      if (!wakeModeOn || liveWs.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const resampled = resampleTo16k(input, liveAudioCtx.sampleRate);
      liveWs.send(floatTo16BitPCM(resampled));
      audioLevel = Math.max(audioLevel, 0.3);
    };
  };

  liveWs.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      playLiveAudioChunk(event.data);
      setStatus('MOWIE...', 'speaking');
      return;
    }
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (msg.type === 'ready') {
      setStatus('ROZMOWA NA ZYWO...', 'listening');
    } else if (msg.type === 'interrupted') {
      stopLivePlayback();
    } else if (msg.type === 'turnComplete') {
      loadTodos();
      loadReminders();
      loadFactsGauge();
      if (wakeModeOn) setStatus('ROZMOWA NA ZYWO...', 'listening');
    } else if (msg.type === 'error') {
      toast(`Blad rozmowy na zywo: ${msg.message}`);
      stopLiveConversation();
    } else if (msg.type === 'closed') {
      stopLiveConversation();
    }
  };

  liveWs.onerror = () => toast('Blad polaczenia glosowego.');
  liveWs.onclose = () => { if (wakeModeOn) stopLiveConversation(); };
}

function stopLiveConversation() {
  wakeModeOn = false;
  wakeBtn.classList.remove('active');
  stopLivePlayback();
  stopLiveFrameCapture();
  if (liveProcessor) { liveProcessor.disconnect(); liveProcessor.onaudioprocess = null; liveProcessor = null; }
  if (liveAudioCtx) { liveAudioCtx.close().catch(() => {}); liveAudioCtx = null; }
  if (liveMicStream) { liveMicStream.getTracks().forEach((t) => t.stop()); liveMicStream = null; }
  if (livePlaybackCtx) { livePlaybackCtx.close().catch(() => {}); livePlaybackCtx = null; }
  if (liveWs) {
    if (liveWs.readyState === WebSocket.OPEN) liveWs.send(JSON.stringify({ type: 'end' }));
    liveWs.close();
    liveWs = null;
  }
  setStatus('ONLINE', null);
  startWakeListening();
}

function toggleWakeMode() {
  if (wakeModeOn) stopLiveConversation();
  else startLiveConversation();
}

if (wakeBtn) {
  wakeBtn.title = 'Rozmowa na zywo z Jarvisem';
  wakeBtn.addEventListener('click', toggleWakeMode);
}

// --- Wake word "Jarvis" ---
// Przegladarka/PWA: Web Speech API (SpeechRecognition), dziala od razu.
// Electron: wlasny, offline wykrywacz System.Speech (desktop/wakeword.ps1),
// bo Chromium w Elektronie nie ma dostepu do Web Speech API.
// Android (Capacitor): wlasny natywny plugin WakeWordPlugin.java oparty o
// android.speech.SpeechRecognizer, bo WebView na Androidzie tez nie
// udostepnia stronom Web Speech API - patrz uzasadnienie w tamtym pliku.
// We wszystkich trzech przypadkach wykrycie startuje DOKLADNIE ta sama
// rozmowe na zywo co przycisk ucha - to tylko alternatywny wyzwalacz.
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRecognition = null;
let autoWakeEnabled = Boolean(SpeechRecognitionCtor) && !window.jarvisDesktop && !isCapacitorNative();
let wakeRestartTimer = null;

function normalizePolish(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');
}

const WAKE_RE = /\b(d?zarwis|jarwis|jarvis)\b/;

function stopWakeListening() {
  if (wakeRestartTimer) { clearTimeout(wakeRestartTimer); wakeRestartTimer = null; }
  if (wakeRecognition) {
    const rec = wakeRecognition;
    wakeRecognition = null;
    rec.onend = null;
    rec.onerror = null;
    rec.onresult = null;
    try { rec.stop(); } catch (e) { /* noop */ }
  }
  if (isCapacitorNative() && window.Capacitor.Plugins.WakeWord) {
    window.Capacitor.Plugins.WakeWord.stop().catch(() => {});
  }
}

function startWakeListening() {
  if (wakeModeOn) return;

  if (isCapacitorNative() && window.Capacitor.Plugins.WakeWord) {
    window.Capacitor.Plugins.WakeWord.start().catch(() => {});
    return;
  }

  if (!autoWakeEnabled || wakeRecognition) return;

  const rec = new SpeechRecognitionCtor();
  wakeRecognition = rec;
  rec.lang = 'pl-PL';
  rec.continuous = true;
  rec.interimResults = false;

  rec.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    if (!last || !last[0]) return;
    if (WAKE_RE.test(normalizePolish(last[0].transcript || ''))) {
      startLiveConversation();
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'network' || e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      autoWakeEnabled = false;
    }
  };

  rec.onend = () => {
    if (wakeRecognition === rec) wakeRecognition = null;
    if (autoWakeEnabled && !wakeModeOn) {
      wakeRestartTimer = setTimeout(startWakeListening, 400);
    }
  };

  try {
    rec.start();
  } catch (e) {
    wakeRecognition = null;
  }
}

if (isCapacitorNative() && window.Capacitor.Plugins.WakeWord) {
  window.Capacitor.Plugins.WakeWord.addListener('wake', () => {
    if (!wakeModeOn) startLiveConversation();
  });
}

startWakeListening();
document.addEventListener('click', startWakeListening, { once: true });

// Aplikacja desktopowa (Electron) ma wlasny, offline wykrywacz slowa "Jarvis"
// oparty o System.Speech Windows (patrz desktop/wakeword.ps1) - Chromium w
// Elektronie nie ma dostepu do Web Speech API uzywanego powyzej.
if (window.jarvisDesktop && window.jarvisDesktop.onWakeWord) {
  window.jarvisDesktop.onWakeWord(() => {
    if (!wakeModeOn) startLiveConversation();
  });
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
  const facts = document.querySelector('[data-stat="facts"]')?.textContent || '0';
  const todos = document.querySelector('[data-stat="todos"]')?.textContent || '0';
  const reminders = document.querySelector('[data-stat="reminders"]')?.textContent || '0';
  const options = [
    `PAMIEC: ${facts} ZAPAMIETANYCH FAKTOW`,
    `ZADANIA: ${todos} OTWARTYCH`,
    `PRZYPOMNIENIA: ${reminders} ZAPLANOWANYCH`,
    wakeModeOn ? 'ROZMOWA NA ZYWO: AKTYWNA' : 'ROZMOWA NA ZYWO: WYLACZONA',
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
const bootOrbContent = document.getElementById('bootOrbContent');
const bootWaveBars = document.getElementById('bootWaveBars');

const BOOT_LINES = [
  'user www-data;',
  'worker_processes auto;',
  'worker_rlimit_nofile 65535;',
  '> inicjalizacja rdzenia J.A.R.V.I.S...',
  '> laczenie z modelem Gemini Live...',
  'ssl_protocols TLSv1.2 TLSv1.3;',
  '> wczytywanie pamieci uzytkownika... <span class="ok">OK</span>',
  '> synchronizacja zadan i przypomnien... <span class="ok">OK</span>',
  '> kalibracja kanalu audio... <span class="ok">OK</span>',
  'listen 443 ssl http2;',
  '> systemy gotowe. <span class="ok">BOOT COMPLETE</span>',
];

function buildBootWaveBars() {
  const cx = 150, cy = 150, r = 138, count = 40;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const bar = document.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('x', x - 1.5);
    bar.setAttribute('y', y - 5);
    bar.setAttribute('width', 3);
    bar.setAttribute('height', 10);
    bar.setAttribute('class', 'boot-wave-bar');
    bar.setAttribute('transform', `rotate(${(angle * 180) / Math.PI + 90} ${x} ${y})`);
    bar.style.animationDelay = `${(i % 8) * 0.08}s`;
    bootWaveBars.appendChild(bar);
  }
}
buildBootWaveBars();

const BOOT_ICONS = {
  jarvis: '<div class="boot-orb-text">JARVIS</div>',
  pcb: '<svg class="boot-orb-icon" viewBox="0 0 100 100"><rect x="15" y="15" width="70" height="70" rx="4"/><circle cx="15" cy="15" r="3" fill="currentColor" stroke="none"/><circle cx="85" cy="15" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="85" r="3" fill="currentColor" stroke="none"/><circle cx="85" cy="85" r="3" fill="currentColor" stroke="none"/><path d="M30 15 V35 H50 V50"/><path d="M70 15 V30 H55"/><path d="M15 50 H35 V70"/><path d="M85 60 H60 V85"/><circle cx="50" cy="50" r="9"/></svg>',
  mic: '<svg class="boot-orb-icon" viewBox="0 0 100 100"><rect x="38" y="15" width="24" height="46" rx="12"/><path d="M22 48 a28 28 0 0 0 56 0"/><line x1="50" y1="76" x2="50" y2="90"/><line x1="35" y1="90" x2="65" y2="90"/></svg>',
  helmet: '<svg class="boot-orb-icon" viewBox="0 0 200 220"><path d="M100 8 C60 8 34 34 30 74 C27 100 30 128 40 156 C46 172 56 186 70 196 L78 176 L88 200 L100 182 L112 200 L122 176 L130 196 C144 186 154 172 160 156 C170 128 173 100 170 74 C166 34 140 8 100 8 Z"/><path d="M52 92 L86 88 L86 100 L54 104 Z" fill="currentColor" stroke="none"/><path d="M148 92 L114 88 L114 100 L146 104 Z" fill="currentColor" stroke="none"/></svg>',
};

async function cycleBootOrb() {
  const order = ['jarvis', 'pcb', 'mic', 'helmet'];
  for (const key of order) {
    bootOrbContent.innerHTML = BOOT_ICONS[key];
    await new Promise((r) => setTimeout(r, 550));
  }
}

async function runBootSequence() {
  cycleBootOrb();
  for (const line of BOOT_LINES) {
    bootLog.innerHTML += line + '\n';
    bootLog.scrollTop = bootLog.scrollHeight;
    await new Promise((r) => setTimeout(r, 180));
  }
}

function hideBootOverlay() {
  bootOverlay.classList.add('hidden');
  setTimeout(() => bootOverlay.remove(), 700);
}

function setHudTopstats() {
  const idEl = document.getElementById('hudId');
  const unitEl = document.getElementById('hudUnit');
  if (idEl) idEl.textContent = String(Date.now()).slice(-9);
  if (unitEl) unitEl.textContent = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
}

// Prawdziwe dane urzadzenia tam, gdzie przegladarka na to pozwala - bateria
// (Battery Status API) i wykorzystanie pamieci (Storage API). Przegladarki
// celowo nie udostepniaja realnego zuzycia CPU/RAM ze wzgledow prywatnosci,
// wiec te dwa wskazniki sa jedynymi "prawdziwymi" jakie mozemy tu pokazac.
async function setHudDeviceStats() {
  if (navigator.getBattery) {
    try {
      const battery = await navigator.getBattery();
      const el = document.getElementById('hudBattery');
      const update = () => { el.textContent = `${Math.round(battery.level * 100)}%`; };
      update();
      battery.addEventListener('levelchange', update);
    } catch (e) {
      /* Battery Status API niedostepne - zostaje placeholder "--%" */
    }
  }

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (Number.isFinite(usage) && Number.isFinite(quota) && quota > 0) {
        const el = document.getElementById('hudStorage');
        el.textContent = `${(usage / 1e9).toFixed(1)}/${(quota / 1e9).toFixed(0)} GB`;
      }
    } catch (e) {
      /* Storage API niedostepne - zostaje placeholder "-- GB" */
    }
  }
}

// --- Init ---
async function init() {
  setHudTopstats();
  setHudDeviceStats();
  const bootPromise = runBootSequence();
  setStatus('URUCHAMIAM SYSTEMY...', 'thinking');
  try {
    const { data } = await fetchJSON('/api/health');
    ttsConfigured = Boolean(data.ttsConfigured);
    pushConfigured = Boolean(data.pushConfigured);
    setStatus('ONLINE', null);
  } catch (e) {
    setStatus('BRAK POLACZENIA', null);
    toast('Nie moge polaczyc sie z serwerem.');
  }
  await bootPromise;
  hideBootOverlay();
  loadTodos();
  loadReminders();
  loadFactsGauge();
}
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
