// J.A.R.V.I.S. Neural OS // Core Rendering & Logs

function initNeuralOSUI() {
  const canvas = document.getElementById('coreCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const resize = () => {
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  };
  resize();
  window.addEventListener('resize', resize);

  let angle = 0;
  let particles = [];
  
  // Tworzenie dynamicznej chmury cząsteczek danych 3D
  for (let i = 0; i < 150; i++) {
    particles.push({
      x: (Math.random() - 0.5) * 200,
      y: (Math.random() - 0.5) * 200,
      z: (Math.random() - 0.5) * 200,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.01 + 0.005
    });
  }

  function render() {
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    angle += 0.01;

    // 1. Centralna pula energii (Blask jądra)
    const gradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, 50);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.3, 'rgba(0, 229, 255, 0.8)');
    gradient.addColorStop(0.7, 'rgba(0, 100, 180, 0.3)');
    gradient.addColorStop(1, 'transparent');
    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fillStyle = gradient; ctx.fill();

    // 2. Geometryczna kula (Sieć meridianów 3D)
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle * (i % 2 === 0 ? 1 : -1) + (i * Math.PI / 4));
      ctx.beginPath();
      ctx.ellipse(0, 0, 60, 22, 0, 0, Math.PI * 2);
      ctx.strokeStyle = i === 0 ? 'rgba(255, 184, 0, 0.9)' : 'rgba(0, 229, 255, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // 3. Zewnętrzny, cyfrowy pierścień HUD
    ctx.beginPath();
    ctx.arc(cx, cy, 100 + Math.sin(angle * 3) * 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 10]); ctx.stroke(); ctx.setLineDash([]);

    // 4. Cząsteczki danych (Holograficzna chmura)
    particles.forEach(p => {
      const cos = Math.cos(angle * p.speed); const sin = Math.sin(angle * p.speed);
      const x3d = p.x * cos - p.z * sin; const z3d = p.z * cos + p.x * sin;
      const scale = 200 / (200 + z3d); const px = cx + x3d * scale; const py = cy + p.y * scale;
      if (scale > 0) {
        ctx.beginPath(); ctx.arc(px, py, p.size * scale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 229, 255, ${0.3 + scale * 0.4})`; ctx.fill();
      }
    });

    // 5. Centralna geometryczna J (Demonstracja znaku)
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('J', cx, cy + 2);

    requestAnimationFrame(render);
  }
  render();

  // Demonstracyjny strumień logów w panelu neuronowym
  const logsList = document.getElementById('neuralLogs');
  if (logsList) {
    const messages = [
      "SYSTEM DIAGNOSTIC: COMPLETE",
      "RELOADING MERIDIAN NETWORK...",
      "DATA STREAM: ACTIVE",
      "E.D.I.T.H. PROTOCOL: ONLINE",
      "WAITING FOR COMMAND, SIR."
    ];
    let i = 0;
    setInterval(() => {
      if (i < messages.length) {
        const li = document.createElement('li');
        li.textContent = messages[i];
        logsList.appendChild(li);
        logsList.scrollTop = logsList.scrollHeight;
        i++;
      }
    }, 2800);
  }
}

// Uruchomienie po załadowaniu
window.addEventListener('DOMContentLoaded', initNeuralOSUI);
