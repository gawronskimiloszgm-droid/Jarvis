// Kinowy, złoty reaktor 3D J.A.R.V.I.S.-a (Holographic Core)
function initCinematicCore() {
  const canvas = document.getElementById('coreCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Dopasowanie rozdzielczości siatki do ekranu dla idealnej ostrości
  const resize = () => {
    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  };
  resize();
  window.addEventListener('resize', resize);

  let angle = 0;
  let particles = [];
  
  // Tworzenie cząsteczek wokół kuli
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: (Math.random() - 0.5) * 180,
      y: (Math.random() - 0.5) * 180,
      z: (Math.random() - 0.5) * 180,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.02 + 0.01
    });
  }

  function render() {
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    angle += 0.015;

    // 1. Zewnętrzny, pulsujący pierścień holograficzny
    ctx.beginPath();
    ctx.arc(cx, cy, 95 + Math.sin(angle * 3) * 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 157, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Środkowy pierścień obracający się w przeciwnym kierunku
    ctx.beginPath();
    ctx.arc(cx, cy, 70, -angle * 1.5, Math.PI * 1.5 - angle * 1.5);
    ctx.strokeStyle = 'rgba(255, 107, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 3. Wewnętrzny rdzeń energii (złożony z rotujących elips / meridianów)
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle * (i % 2 === 0 ? 1 : -1) + (i * Math.PI / 4));
      ctx.beginPath();
      ctx.ellipse(0, 0, 50, 18, 0, 0, Math.PI * 2);
      ctx.strokeStyle = i === 0 ? 'rgba(255, 200, 50, 0.8)' : 'rgba(255, 120, 0, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Centralna kula / słońce reaktora (efekt blasku)
    const gradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, 45);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.3, 'rgba(255, 160, 20, 0.8)');
    gradient.addColorStop(0.7, 'rgba(255, 90, 0, 0.3)');
    gradient.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.arc(cx, cy, 45, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // 5. Cząsteczki wokół kuli (efekt chmury danych/hologramu)
    particles.forEach(p => {
      // Rotacja 3D w uproszczeniu
      const cos = Math.cos(angle * p.speed);
      const sin = Math.sin(angle * p.speed);
      const x3d = p.x * cos - p.z * sin;
      const z3d = p.z * cos + p.x * sin;
      
      const scale = 200 / (200 + z3d);
      const px = cx + x3d * scale;
      const py = cy + p.y * scale;

      if (scale > 0) {
        ctx.beginPath();
        ctx.arc(px, py, p.size * scale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 170, 50, ${0.3 + scale * 0.4})`;
        ctx.fill();
      }
    });

    requestAnimationFrame(render);
  }

  render();
}

// Uruchomienie po załadowaniu okna
window.addEventListener('DOMContentLoaded', initCinematicCore);
