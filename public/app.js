const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const reactor = document.getElementById('reactor');
const micBtn = document.getElementById('micBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const canvas = document.getElementById('wave');
const ctx = canvas.getContext('2d');

let ttsConfigured = false;

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

function typeMessage(text, cls) {
  const div = addMessage('', cls);
  let i = 0;
  const step = () => {
    div.textContent = text.slice(0, i);
    logEl.scrollTop = logEl.scrollHeight;
    i += 2;
    if (i <= text.length) requestAnimationFrame(step);
  };
  step();
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

async function speak(text) {
  setStatus('MOWIE...', 'speaking');
  if (ttsConfigured) {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok && res.status !== 204) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onplay = () => { audioLevel = 0.7; };
        audio.ontimeupdate = () => { audioLevel = 0.5; };
        await new Promise((resolve) => {
          audio.onended = resolve;
          audio.onerror = resolve;
          audio.play();
        });
        setStatus('ONLINE', null);
        return;
      }
    } catch (e) {
      console.warn('Fish Audio TTS failed, falling back to browser voice', e);
    }
  }
  await speakBrowser(text);
  setStatus('ONLINE', null);
}

// --- Chat ---
async function sendMessage(text) {
  if (!text.trim()) return;
  addMessage(text, 'user');
  textInput.value = '';
  setStatus('PRZETWARZAM...', 'thinking');
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Blad serwera');
    typeMessage(data.reply, 'jarvis');
    await speak(data.reply);
  } catch (err) {
    addMessage(`Blad: ${err.message}`, 'error');
    setStatus('ONLINE', null);
  }
}

sendBtn.addEventListener('click', () => sendMessage(textInput.value));
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage(textInput.value);
});

// --- Voice input ---
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

// --- Init ---
async function init() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    ttsConfigured = Boolean(data.ttsConfigured);
    setStatus('ONLINE', null);
    typeMessage('Witaj z powrotem. Wszystkie systemy sprawne i gotowe do pracy.', 'jarvis');
  } catch (e) {
    setStatus('BRAK POLACZENIA', null);
    addMessage('Nie moge polaczyc sie z serwerem.', 'error');
  }
}
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
