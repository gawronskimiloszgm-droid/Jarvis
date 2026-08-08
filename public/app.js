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
function switchToChatTab() {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'chat'));
  panels.forEach((p) => p.classList.toggle('active', p.id === 'panel-chat'));
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
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    fullReply += piece;
    renderReplyContent(replyDiv, fullReply);
    logEl.scrollTop = logEl.scrollHeight;

    speechBuffer += piece.replace(IMG_MARKER_RE, '');
    const { sentences, remainder } = extractSentences(speechBuffer);
    for (const s of sentences) enqueueSpeech(s);
    speechBuffer = remainder;
  }
  if (speechBuffer.trim()) enqueueSpeech(speechBuffer);
  return fullReply;
}

async function sendMessage(text) {
  if (!text.trim()) return;
  switchToChatTab();
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
    addMessage(`Blad: ${err.message}`, 'error');
    setStatus('ONLINE', null);
  }
}

sendBtn.addEventListener('click', () => sendMessage(textInput.value));
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage(textInput.value);
});

// --- Voice input (push-to-talk) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizing = false;
let recognizer = null;

if (SpeechRecognition) {
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
const WAKE_RE = /\b(hej\s+)?jarvis[,:]?\s*(.*)/i;

function toggleWakeMode() {
  if (!SpeechRecognition) return;
  wakeModeOn = !wakeModeOn;
  wakeBtn.classList.toggle('active', wakeModeOn);
  if (wakeModeOn) {
    startWakeListening();
    setStatus('NASLUCHUJE "JARVIS"...', null);
  } else {
    if (wakeRecognizer) wakeRecognizer.stop();
    setStatus('ONLINE', null);
  }
}

function startWakeListening() {
  if (!SpeechRecognition || !wakeModeOn) return;
  wakeRecognizer = new SpeechRecognition();
  wakeRecognizer.lang = 'pl-PL';
  wakeRecognizer.interimResults = false;
  wakeRecognizer.continuous = true;

  wakeRecognizer.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    const transcript = last[0].transcript.trim();
    const match = transcript.match(WAKE_RE);
    if (match) {
      const command = match[2].trim();
      if (command) sendMessage(command);
    }
  };
  wakeRecognizer.onerror = () => {};
  wakeRecognizer.onend = () => {
    if (wakeModeOn) {
      try { wakeRecognizer.start(); } catch (e) { /* already running */ }
    }
  };
  try { wakeRecognizer.start(); } catch (e) { /* noop */ }
}

if (wakeBtn) {
  if (!SpeechRecognition) {
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

  switchToChatTab();
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
    addMessage(`Blad: ${err.message}`, 'error');
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
      addMessage('Czas minal, sir.', 'jarvis');
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
    addMessage('Powiadomienia push nie sa wspierane w tej przegladarce.', 'error');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const reg = await navigator.serviceWorker.ready;
  const { data } = await fetchJSON('/api/push/vapid-public-key');
  if (!data.publicKey) {
    addMessage('Serwer nie ma skonfigurowanych kluczy powiadomien.', 'error');
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
    addMessage('Nie moge polaczyc sie z serwerem.', 'error');
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
