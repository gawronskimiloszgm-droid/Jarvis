(()=>{
const $=id=>document.getElementById(id), root=document.body;
const rgb=()=>getComputedStyle(root).getPropertyValue('--rgb').trim();
const pad=n=>String(n).padStart(2,'0');
let mode='idle', energy=0, voiceOut=true, t0=Date.now();

/* ---------- audio ---------- */
let ac;
function beep(f=880,d=.08,v=.04){try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.value=f;g.gain.value=v;g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+d);o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+d)}catch(e){}}

/* ---------- canvas helpers ---------- */
function fit(c){const r=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;if(c.width!==w*r||c.height!==h*r){c.width=w*r;c.height=h*r}const x=c.getContext('2d');x.setTransform(r,0,0,r,0,0);return[x,w,h]}

/* ---------- background stars ---------- */
const stars=Array.from({length:140},()=>({x:Math.random(),y:Math.random(),z:Math.random()*.9+.1}));
let mx=0,my=0;
addEventListener('pointermove',e=>{mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5});
function drawBg(){
  const[x,w,h]=fit($('bg'));x.clearRect(0,0,w,h);const c=rgb();
  for(const s of stars){s.y-=s.z*.00012;if(s.y<0)s.y=1;
    const px=((s.x+mx*s.z*.03)%1)*w,py=s.y*h;
    x.fillStyle=`rgba(${c},${.15+s.z*.45})`;x.fillRect(px,py,s.z*1.8,s.z*1.8)}
}

/* ---------- core: 3D wireframe sphere ---------- */
const core=$('core'), pts=Array.from({length:240},()=>{const u=Math.random()*6.283,v=Math.acos(2*Math.random()-1),r=1.15+Math.random()*.55;return{u,v,r,s:(Math.random()-.5)*.6}});
let ay=0,ax=.4;
function proj(x,y,z,cx,cy,R){const cy1=Math.cos(ay),sy=Math.sin(ay),cx1=Math.cos(ax),sx=Math.sin(ax);
  let X=x*cy1+z*sy,Z=-x*sy+z*cy1,Y=y*cx1-Z*sx;Z=y*sx+Z*cx1;const k=2.6/(2.6+Z);return[cx+X*R*k,cy+Y*R*k,Z,k]}
function drawCore(tm){
  const[x,w,h]=fit(core),cx=w/2,cy=h/2,c=rgb();
  const boost=mode==='listen'?1.8:mode==='speak'?1.3+Math.sin(tm/90)*.4:mode==='think'?2.4:.6;
  energy+=(boost-energy)*.06;ay+=.004*(1+energy);ax=.4+Math.sin(tm/4000)*.15;
  x.clearRect(0,0,w,h);
  const R=w*.26*(1+Math.sin(tm/700)*.015*energy);
  const g=x.createRadialGradient(cx,cy,2,cx,cy,R*.9);
  g.addColorStop(0,'rgba(255,255,255,.95)');g.addColorStop(.25,`rgba(${c},.7)`);g.addColorStop(1,`rgba(${c},0)`);
  x.fillStyle=g;x.beginPath();x.arc(cx,cy,R*.9,0,7);x.fill();
  x.lineWidth=1;
  // latitudes
  for(let i=-3;i<=3;i++){const lat=i/4*Math.PI/2*1.0,r=Math.cos(lat),y=Math.sin(lat);x.beginPath();
    for(let a=0;a<=64;a++){const th=a/64*6.283,[px,py,,k]=proj(Math.cos(th)*r,y,Math.sin(th)*r,cx,cy,R);a?x.lineTo(px,py):x.moveTo(px,py)}
    x.strokeStyle=`rgba(${c},${i===0?.9:.32})`;x.stroke()}
  // meridians
  for(let m=0;m<8;m++){const th=m/8*Math.PI;x.beginPath();
    for(let a=0;a<=48;a++){const p=a/48*6.283,[px,py]=proj(Math.cos(p)*Math.cos(th),Math.sin(p),Math.cos(p)*Math.sin(th),cx,cy,R);a?x.lineTo(px,py):x.moveTo(px,py)}
    x.strokeStyle=`rgba(${c},.28)`;x.stroke()}
  // particles
  for(const p of pts){p.u+=p.s*.01*(1+energy);const X=p.r*Math.sin(p.v)*Math.cos(p.u),Y=p.r*Math.cos(p.v),Z=p.r*Math.sin(p.v)*Math.sin(p.u);
    const[px,py,z,k]=proj(X,Y,Z,cx,cy,R);x.fillStyle=`rgba(${c},${.15+k*.35})`;x.beginPath();x.arc(px,py,1.3*k,0,7);x.fill()}
  // outer tick ring
  const rr=R*1.75;x.save();x.translate(cx,cy);x.rotate(-tm/6000);
  for(let i=0;i<72;i++){x.rotate(6.283/72);const l=i%6===0?10:4;x.strokeStyle=`rgba(${i%18===0?'255,184,0':c},${i%6===0?.7:.3})`;x.beginPath();x.moveTo(rr,0);x.lineTo(rr+l,0);x.stroke()}
  x.restore();
  // voice level arc
  x.strokeStyle=`rgba(${c},.8)`;x.lineWidth=2;x.beginPath();x.arc(cx,cy,R*1.5,-1.57,-1.57+Math.min(6.2,energy*1.9+.3*Math.sin(tm/300)));x.stroke();
  x.font=`700 ${R*.42}px Rajdhani,sans-serif`;x.fillStyle='rgba(255,255,255,.9)';x.textAlign='center';x.textBaseline='middle';x.fillText('J',cx,cy+2);
}

/* ---------- telemetry ---------- */
const hist={cpu:Array(40).fill(20),net:Array(40).fill(300)};let cpu=22,mem=7.8,net=320;
function spark(id,arr,max){const[x,w,h]=fit($(id));x.clearRect(0,0,w,h);const c=rgb();x.beginPath();
  arr.forEach((v,i)=>{const px=i/(arr.length-1)*w,py=h-v/max*h;i?x.lineTo(px,py):x.moveTo(px,py)});
  x.strokeStyle=`rgb(${c})`;x.lineWidth=1.4;x.stroke();x.lineTo(w,h);x.lineTo(0,h);x.fillStyle=`rgba(${c},.12)`;x.fill()}
function tick(){
  const th=root.dataset.posture==='threat'?30:0;
  cpu=Math.max(4,Math.min(98,cpu+(Math.random()-.5)*14+th*.1));mem=Math.max(5,Math.min(15,mem+(Math.random()-.5)*.3));net=Math.max(40,Math.min(1200,net+(Math.random()-.5)*160));
  hist.cpu.push(cpu);hist.cpu.shift();hist.net.push(net);hist.net.shift();
  $('cpuV').textContent=cpu.toFixed(0)+'%';$('memV').textContent=mem.toFixed(1)+' GB';$('memB').style.width=mem/16*100+'%';$('netV').textContent=net.toFixed(0)+' Mbps';
  const s=Math.floor((Date.now()-t0)/1000);$('up').textContent=pad(Math.floor(s/60))+':'+pad(s%60);
  spark('cpuC',hist.cpu,100);spark('netC',hist.net,1200);
}
setInterval(tick,900);

/* ---------- clock ---------- */
function clock(){const d=new Date();$('clock').textContent=`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  $('date').textContent=d.toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
setInterval(clock,1000);clock();

/* ---------- logs ---------- */
const logs=$('logs');
function log(msg,warn){const li=document.createElement('li');if(warn)li.className='warn';const d=new Date();
  li.innerHTML=`<b>${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</b>`;li.append(msg);logs.append(li);
  while(logs.children.length>60)logs.firstChild.remove();logs.parentElement.scrollTop=1e6}
['Diagnostyka systemu zakończona','Sieć meridianów zsynchronizowana','Strumień danych aktywny','Protokół E.D.I.T.H. online'].forEach((m,i)=>setTimeout(()=>log(m),600+i*900));
setInterval(()=>{const a=['Optymalizacja kolejki zadań','Analiza struktury poleceń','Weryfikacja integralności rdzenia','Synchronizacja pamięci podręcznej','Skan pasma radiowego: czysto'];log(a[Math.random()*a.length|0])},6500);

/* ---------- feed + speech ---------- */
const feed=$('feed');
function say(text,speak=true){
  const p=document.createElement('div');p.className='j';feed.append(p);setState('speak','Mówię…');
  let i=0;const iv=setInterval(()=>{p.textContent=text.slice(0,++i);feed.scrollTop=1e6;if(i>=text.length){clearInterval(iv);if(!(speak&&voiceOut&&speechSynthesis))setState('idle','Gotowy, sir')}},18);
  if(speak&&voiceOut&&window.speechSynthesis){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='pl-PL';u.rate=1.02;u.pitch=.85;
    u.onend=()=>setState('idle','Gotowy, sir');speechSynthesis.speak(u)}
}
function setState(m,label){mode=m;$('state').textContent=label}

/* ---------- postures ---------- */
const names={nominal:'NOMINALNY',focus:'SKUPIENIE',threat:'ZAGROŻENIE',recovery:'REGENERACJA'};
function posture(m){root.dataset.posture=m;document.querySelectorAll('.chip').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));
  $('status').textContent=m==='threat'?'ALERT: PODWYŻSZONA GOTOWOŚĆ':'SYSTEM '+names[m];log('Postawa: '+names[m],m==='threat');beep(m==='threat'?220:880,.2)}
$('modes').addEventListener('click',e=>{const b=e.target.closest('.chip');if(b){posture(b.dataset.m);say('Postawa zmieniona na '+names[b.dataset.m].toLowerCase()+'.')}});

/* ---------- commands ---------- */
const jokes=['Zawsze chętnie pomogę, sir. Proszę nie pytać, ile razy już ratowałem pański kod.','Mam 99 problemów, sir, ale kompilacja nie jest jednym z nich.'];
function handle(raw){
  const q=raw.toLowerCase().trim();if(!q)return;
  const u=document.createElement('div');u.className='u';u.textContent='> '+raw;feed.append(u);log('Polecenie: '+raw);
  setState('think','Przetwarzam…');beep(1200,.05);
  setTimeout(()=>{
    const d=new Date();
    if(/pomoc|help/.test(q))return say('Dostępne: czas, data, skan, status, żart, wyczyść, głos włącz/wyłącz oraz tryb nominalny, skupienie, zagrożenie lub regeneracja.');
    if(/godzin|czas/.test(q))return say(`Jest ${pad(d.getHours())}:${pad(d.getMinutes())}, sir.`);
    if(/data|dzi[śs]/.test(q))return say('Dziś jest '+d.toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'})+'.');
    if(/status|stan/.test(q))return say(`Procesor ${cpu.toFixed(0)} procent, pamięć ${mem.toFixed(1)} gigabajta, sieć ${net.toFixed(0)} megabitów. Postawa: ${names[root.dataset.posture].toLowerCase()}.`);
    if(/skan/.test(q)){log('Skan wszystkich podsystemów…');[0,1,2].forEach(i=>setTimeout(()=>log(['Rdzeń: OK','Sieć: OK','Pamięć: OK'][i]),400*(i+1)));return say('Skan zakończony. Wszystkie podsystemy w normie.')}
    if(/żart|zart/.test(q))return say(jokes[Math.random()*jokes.length|0]);
    if(/wyczy/.test(q)){feed.innerHTML='';logs.innerHTML='';setState('idle','Gotowy, sir');return}
    if(/g[łl]os w[łl]/.test(q)){voiceOut=true;return say('Głos włączony.')}
    if(/g[łl]os wy[łl]/.test(q)){voiceOut=false;speechSynthesis&&speechSynthesis.cancel();return say('Głos wyłączony.',false)}
    const m=/zagro|threat/.test(q)?'threat':/skupi|focus/.test(q)?'focus':/regen|recov/.test(q)?'recovery':/nomin/.test(q)?'nominal':null;
    if(m&&/tryb|postaw/.test(q)){posture(m);return say('Przełączam na postawę '+names[m].toLowerCase()+'.')}
    say('Nie rozpoznałem polecenia, sir. Wpisz „pomoc”, aby zobaczyć listę.');
  },450);
}
$('form').addEventListener('submit',e=>{e.preventDefault();const v=$('inp').value;$('inp').value='';handle(v)});

/* ---------- microphone ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec,on=false;
function toggleMic(){
  if(!SR){say('Rozpoznawanie mowy nie jest dostępne w tej przeglądarce. Użyj klawiatury.',false);return}
  if(on){rec.stop();return}
  rec=new SR();rec.lang='pl-PL';rec.interimResults=true;
  rec.onstart=()=>{on=true;$('mic').classList.add('on');setState('listen','Słucham…');beep(1000)};
  rec.onresult=e=>{const r=e.results[e.results.length-1];$('inp').value=r[0].transcript;if(r.isFinal){$('inp').value='';handle(r[0].transcript)}};
  rec.onend=()=>{on=false;$('mic').classList.remove('on');if(mode==='listen')setState('idle','Gotowy, sir')};
  rec.onerror=()=>{on=false;$('mic').classList.remove('on');setState('idle','Błąd mikrofonu')};
  rec.start();
}
$('mic').onclick=toggleMic;$('coreHit').onclick=toggleMic;

/* ---------- loop ---------- */
(function loop(tm){drawBg();drawCore(tm);requestAnimationFrame(loop)})(0);
setTimeout(()=>say('Dzień dobry, sir. Wszystkie systemy działają prawidłowo.',false),400);
})();
