// Modul Ziemia: kula ziemska 3D (styl hologramu albo prawdziwe zdjecia satelitarne, swiatlo slonca
// wedlug godziny), a po przyblizeniu mapa satelitarna z kafelkow. Warstwy na zywo: trzesienia ziemi
// (USGS), stacja ISS z trasa, radar opadow (RainViewer) i samoloty (OpenSky). Dane przez serwer
// (server/extras/earth.js), tekstury i kafelki prosto ze zrodel (darmowe, z podaniem autorow).
(function () {
  const UI = window.JarvisUI;
  if (!UI || !UI.register) return;
  const { el, api, toast, isOwner } = UI;

  const TEX = 'https://unpkg.com/three-globe@2.45.6/example/img/';
  const TILES = {
    sat: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`,
    // Esri: ciemna mapa i podpisy (granice, miasta) bez klucza; CARTO od 2026 wymaga klucza.
    holo: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    holoLabels: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/${z}/${y}/${x}`,
    labels: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
  };
  const ATTRIB = 'Sentinel-2 cloudless 2020 © EOX (CC BY-NC-SA) · Esri, HERE, Garmin, © OpenStreetMap · NASA Blue Marble · USGS · RainViewer · OpenSky';
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- stan wspolny ----------
  const S = {
    style: 'holo', // holo | sat
    view: 'globe', // globe | map
    layers: { quakes: true, iss: true, radar: false, planes: false },
    quakes: [],
    summary: '',
    iss: null,
    issTrail: [],
    radar: null,
    planes: [],
    map: { lat: 52.23, lon: 21.01, z: 4 },
    focus: null, // { lat, lon, nazwa, km }
    pending: null, // polecenie glosowe czekajace na zbudowanie widoku
    api: null, // funkcje widoku po zbudowaniu
  };

  const loadThree = () => {
    if (window.THREE?.OrbitControls) return Promise.resolve(window.THREE);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/three-bundle.js';
      s.onload = () => resolve(window.THREE);
      s.onerror = () => reject(new Error('Nie udało się wczytać silnika 3D.'));
      document.head.appendChild(s);
    });
  };

  /** Punkt na kuli o promieniu r: zgodny z mapowaniem UV SphereGeometry (lewa krawedz tekstury = 180°W). */
  function toXYZ(THREE, lat, lon, r = 1) {
    const phi = (lon + 180) * D2R;
    const theta = (90 - lat) * D2R;
    return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
  }
  /** Punkt podsloneczny: gdzie slonce jest w zenicie teraz (przyblizenie wystarczajace do oswietlenia). */
  function subsolar(date = new Date()) {
    const day = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
    const decl = -23.44 * Math.cos((2 * Math.PI * (day + 10)) / 365);
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
    return { lat: decl, lon: (12 - hours) * 15 };
  }
  const magColor = (m) => (m >= 6 ? '#ff3b30' : m >= 5 ? '#ff8c1a' : m >= 4 ? '#ffd166' : '#7fe7ff');

  // ---------- dane ----------
  async function loadQuakes() {
    const q = S.focus ? `?lat=${S.focus.lat}&lon=${S.focus.lon}&km=${S.focus.km || 500}&name=${encodeURIComponent(S.focus.nazwa || '')}` : '';
    const r = await api(`/api/earth/quakes${q}`);
    S.quakes = r.quakes;
    S.summary = r.summary.text;
  }
  async function loadIss() {
    const p = await api('/api/earth/iss');
    S.iss = p;
    const last = S.issTrail[S.issTrail.length - 1];
    if (!last || last.lat !== p.lat) S.issTrail.push({ lat: p.lat, lon: p.lon });
    if (S.issTrail.length > 700) S.issTrail.shift();
  }
  async function loadRadar() {
    S.radar = await api('/api/earth/radar');
  }
  async function loadPlanes(box) {
    S.planes = (await api(`/api/earth/planes?lamin=${box.s}&lomin=${box.w}&lamax=${box.n}&lomax=${box.e}`)).planes;
  }

  // ---------- kula 3D ----------
  async function buildGlobe(host, onZoomIn) {
    const THREE = await loadThree();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(0, 0.6, 2.9);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 1.12, maxDistance: 6, rotateSpeed: 0.5, zoomSpeed: 0.7, autoRotate: true, autoRotateSpeed: 0.35, enablePan: false });

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const tex = (name) => {
      const t = loader.load(TEX + name);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    const day = tex('earth-blue-marble.jpg');
    const water = loader.load(`${TEX}earth-water.png`);
    const topo = loader.load(`${TEX}earth-topology.png`);
    const night = tex('earth-night.jpg');

    // Hologram: lad swieci w kolorze interfejsu, ocean ciemny, siatka poludnikow i swiecacy brzeg.
    const holoMat = new THREE.ShaderMaterial({
      uniforms: { day: { value: day }, water: { value: water }, tint: { value: new THREE.Color('#33e0ff') } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: `uniform sampler2D day; uniform sampler2D water; uniform vec3 tint; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          float w = texture2D(water, vUv).r;
          float l = dot(texture2D(day, vUv).rgb, vec3(0.3,0.59,0.11));
          vec3 ocean = vec3(0.02,0.08,0.16);
          vec3 land = tint*(0.35+0.9*l);
          vec3 c = mix(land, ocean, w);
          vec2 g = abs(fract(vec2(vUv.x*36.0, vUv.y*18.0)-0.5));
          float grid = 1.0-smoothstep(0.0, 0.04, min(g.x, g.y));
          c += tint*grid*0.12;
          float rim = pow(1.0-max(dot(vN,vV),0.0), 2.5);
          c += tint*rim*0.9;
          gl_FragColor = vec4(c, 0.96);
        }`,
      transparent: true,
    });
    // Satelita: zdjecie NASA, rzezba terenu, odblask oceanu i swiatla miast po stronie nocy.
    const satMat = new THREE.MeshPhongMaterial({ map: day, bumpMap: topo, bumpScale: 0.015, specularMap: water, specular: new THREE.Color('#333333'), shininess: 18 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), holoMat);
    scene.add(earth);
    const nightMat = new THREE.ShaderMaterial({
      uniforms: { night: { value: night }, sun: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vW=normalize((modelMatrix*vec4(position,1.0)).xyz); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D night; uniform vec3 sun; varying vec2 vUv; varying vec3 vW; void main(){ float d = smoothstep(0.05, -0.25, dot(vW, sun)); gl_FragColor = vec4(texture2D(night, vUv).rgb*d*1.4, d); }',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const nightMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0015, 96, 96), nightMat);
    scene.add(nightMesh);
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 64, 64),
      new THREE.ShaderMaterial({
        uniforms: { c: { value: new THREE.Color('#4fc9ff') } },
        // Cienka poswiata przy krawedzi: najjasniej tuz nad powierzchnia, zanika na zewnatrz.
        vertexShader: 'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 c; varying vec3 vN; void main(){ float i = pow(max(0.0, 0.62+vN.z), 6.0)*1.6; gl_FragColor = vec4(c, clamp(i,0.0,0.85)); }',
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(atmo);
    const stars = new THREE.BufferGeometry();
    const sp = new Float32Array(3000);
    for (let i = 0; i < sp.length; i += 3) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 20);
      sp.set([v.x, v.y, v.z], i);
    }
    stars.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.06, transparent: true, opacity: 0.7 })));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    scene.add(sun, new THREE.AmbientLight(0x404a60, 0.6));

    // Warstwy punktow.
    const quakeGroup = new THREE.Group();
    const issGroup = new THREE.Group();
    const focusGroup = new THREE.Group();
    scene.add(quakeGroup, issGroup, focusGroup);
    const dot = (color, size, alt = 1.004) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      m.userData.alt = alt;
      return m;
    };
    function drawQuakes() {
      quakeGroup.clear();
      if (!S.layers.quakes) return;
      for (const q of S.quakes.slice(0, 400)) {
        const m = dot(magColor(q.mag), 0.004 + Math.max(0, q.mag - 2.5) * 0.004);
        m.position.copy(toXYZ(THREE, q.lat, q.lon, 1.004));
        m.userData.q = q;
        m.userData.pulse = q.mag >= 5;
        quakeGroup.add(m);
      }
    }
    function drawIss() {
      issGroup.clear();
      if (!S.layers.iss || !S.iss) return;
      const alt = 1 + S.iss.altKm / 6371;
      const m = dot('#ffffff', 0.012, alt);
      m.position.copy(toXYZ(THREE, S.iss.lat, S.iss.lon, alt));
      issGroup.add(m);
      if (S.issTrail.length > 1) {
        const pts = S.issTrail.map((p) => toXYZ(THREE, p.lat, p.lon, alt));
        issGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })));
      }
    }
    function drawFocus() {
      focusGroup.clear();
      if (!S.focus) return;
      const m = dot('#ffd166', 0.01);
      m.position.copy(toXYZ(THREE, S.focus.lat, S.focus.lon, 1.006));
      m.userData.pulse = true;
      focusGroup.add(m);
    }

    function setStyle(style) {
      earth.material = style === 'sat' ? satMat : holoMat;
      nightMesh.visible = style === 'sat';
      atmo.material.uniforms.c.value.set(style === 'sat' ? '#6fb8ff' : '#33e0ff');
    }
    setStyle(S.style);

    let fly = null;
    function flyTo(lat, lon, dist = 1.9, then) {
      controls.autoRotate = false;
      const from = camera.position.clone();
      const to = toXYZ(THREE, lat, lon, dist);
      fly = { from, to, t0: performance.now(), dur: 1600, then };
    }

    // Klik w trzesienie: szczegoly.
    const ray = new THREE.Raycaster();
    renderer.domElement.addEventListener('click', (ev) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      ray.params.Mesh = { threshold: 0.02 };
      const hit = ray.intersectObjects(quakeGroup.children)[0];
      if (hit) {
        const q = hit.object.userData.q;
        toast(`M${q.mag} ${q.place} · głębokość ${q.depth} km · ${new Date(q.time).toLocaleString('pl-PL')}`, 'ok');
      }
    });
    controls.addEventListener('start', () => (controls.autoRotate = false));

    let alive = true;
    let zoomedIn = false;
    const resize = () => {
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 400;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    function frame(t) {
      if (!alive) return;
      if (!document.body.contains(host)) return destroy();
      requestAnimationFrame(frame);
      if (host.style.display === 'none') return;
      if (fly) {
        const k = clamp((t - fly.t0) / fly.dur, 0, 1);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        camera.position.copy(fly.from.clone().lerp(fly.to, e).normalize().multiplyScalar(fly.from.length() * (1 - e) + fly.to.length() * e));
        camera.lookAt(0, 0, 0);
        if (k >= 1) {
          const then = fly.then;
          fly = null;
          then?.();
        }
      }
      const s = subsolar();
      const sd = toXYZ(THREE, s.lat, s.lon, 1);
      sun.position.copy(sd.clone().multiplyScalar(5));
      nightMat.uniforms.sun.value.copy(sd);
      const pulse = 1 + 0.35 * Math.sin(t / 250);
      for (const m of [...quakeGroup.children, ...focusGroup.children]) if (m.userData.pulse) m.scale.setScalar(pulse);
      controls.update();
      renderer.render(scene, camera);
      // Bardzo blisko powierzchni: przechodzimy w mape satelitarna w tym miejscu.
      const d = camera.position.length();
      if (d < 1.2 && !zoomedIn && !fly) {
        zoomedIn = true;
        const p = camera.position.clone().normalize();
        const lat = 90 - Math.acos(p.y) / D2R;
        const lon = ((Math.atan2(p.z, -p.x) / D2R - 180 + 540) % 360) - 180;
        onZoomIn(lat, lon);
      }
      if (d > 1.3) zoomedIn = false;
    }
    requestAnimationFrame(frame);
    function destroy() {
      alive = false;
      ro.disconnect();
      renderer.dispose();
      controls.dispose();
    }
    return {
      setStyle,
      flyTo,
      redraw() {
        drawQuakes();
        drawIss();
        drawFocus();
      },
      backOut() {
        camera.position.setLength(2.2);
        zoomedIn = false;
      },
      destroy,
    };
  }

  // ---------- mapa z kafelkow (Web Mercator) ----------
  function buildMap(host) {
    const cv = el('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:grab;touch-action:none';
    host.appendChild(cv);
    const ctx = cv.getContext('2d');
    const imgs = new Map();
    const T = 256;
    const project = (lat, lon, z) => {
      const n = 2 ** z * T;
      const s = Math.sin(clamp(lat, -85.05, 85.05) * D2R);
      return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
    };
    const unproject = (x, y, z) => {
      const n = 2 ** z * T;
      const lon = (x / n) * 360 - 180;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / D2R;
      return { lat, lon };
    };
    const tile = (url) => {
      let im = imgs.get(url);
      if (!im) {
        im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => draw();
        im.onerror = () => (im.failed = true);
        im.src = url;
        imgs.set(url, im);
        if (imgs.size > 600) imgs.delete(imgs.keys().next().value);
      }
      return im.complete && !im.failed && im.naturalWidth ? im : null;
    };
    function bounds() {
      const { lat, lon, z } = S.map;
      const c = project(lat, lon, z);
      const w = cv.width / (window.devicePixelRatio || 1);
      const h = cv.height / (window.devicePixelRatio || 1);
      const nw = unproject(c.x - w / 2, c.y - h / 2, z);
      const se = unproject(c.x + w / 2, c.y + h / 2, z);
      return { n: clamp(nw.lat, -85, 85), s: clamp(se.lat, -85, 85), w: clamp(nw.lon, -180, 180), e: clamp(se.lon, -180, 180) };
    }
    function drawLayer(urlFn, maxZ, alpha = 1) {
      const { lat, lon, z } = S.map;
      const zi = Math.min(maxZ, Math.floor(z));
      const scale = 2 ** (z - zi);
      const c = project(lat, lon, zi);
      const w = cv.width / (window.devicePixelRatio || 1);
      const h = cv.height / (window.devicePixelRatio || 1);
      const size = T * scale;
      const x0 = c.x * scale - w / 2;
      const y0 = c.y * scale - h / 2;
      const n = 2 ** zi;
      ctx.globalAlpha = alpha;
      for (let ty = Math.floor(y0 / size); ty <= Math.floor((y0 + h) / size); ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = Math.floor(x0 / size); tx <= Math.floor((x0 + w) / size); tx++) {
          const im = tile(urlFn(zi, ((tx % n) + n) % n, ty));
          if (im) ctx.drawImage(im, Math.round(tx * size - x0), Math.round(ty * size - y0), Math.ceil(size), Math.ceil(size));
        }
      }
      ctx.globalAlpha = 1;
    }
    const toScreen = (lat, lon) => {
      const { z } = S.map;
      const c = project(S.map.lat, S.map.lon, z);
      const p = project(lat, lon, z);
      return { x: p.x - c.x + cv.width / (window.devicePixelRatio || 1) / 2, y: p.y - c.y + cv.height / (window.devicePixelRatio || 1) / 2 };
    };
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 400;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#02070c';
      ctx.fillRect(0, 0, w, h);
      if (S.style === 'sat') {
        drawLayer(TILES.sat, 15);
        drawLayer(TILES.labels, 16);
      } else {
        drawLayer(TILES.holo, 16);
        // Szara mapa w kolorach interfejsu: odcien niebieski przy zachowanej jasnosci.
        ctx.globalCompositeOperation = 'color';
        ctx.fillStyle = '#0b7fb0';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,8,16,0.5)';
        ctx.fillRect(0, 0, w, h);
        drawLayer(TILES.holoLabels, 16);
      }
      if (S.layers.radar && S.radar?.frames?.length) {
        const f = S.radar.frames[S.radar.frames.length - 1];
        drawLayer((z, x, y) => `${S.radar.host}${f.path}/256/${z}/${x}/${y}/2/1_1.png`, 7, 0.7);
      }
      if (S.layers.quakes) {
        for (const q of S.quakes) {
          const p = toScreen(q.lat, q.lon);
          if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3 + (q.mag - 2.5) * 3, 0, Math.PI * 2);
          ctx.fillStyle = `${magColor(q.mag)}aa`;
          ctx.fill();
          ctx.strokeStyle = '#000a';
          ctx.stroke();
        }
      }
      if (S.layers.planes) {
        ctx.font = '10px monospace';
        for (const pl of S.planes) {
          const p = toScreen(pl.lat, pl.lon);
          if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(pl.heading * D2R);
          ctx.fillStyle = '#ffd166';
          ctx.beginPath();
          ctx.moveTo(0, -6);
          ctx.lineTo(4, 5);
          ctx.lineTo(0, 3);
          ctx.lineTo(-4, 5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          if (S.map.z >= 7 && pl.call) {
            ctx.fillStyle = '#ffe9a8';
            ctx.fillText(pl.call, p.x + 7, p.y - 4);
          }
        }
      }
      if (S.layers.iss && S.iss) {
        const p = toScreen(S.iss.lat, S.iss.lon);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText('ISS', p.x + 8, p.y + 4);
      }
      if (S.focus) {
        const p = toScreen(S.focus.lat, S.focus.lon);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9 + 3 * Math.sin(performance.now() / 250), 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    // Przesuwanie i przyblizanie: mysz, kolko, dwa palce.
    const pointers = new Map();
    let last = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = null;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (last) zoomBy(Math.log2(dist / last));
        last = dist;
        return;
      }
      const c = project(S.map.lat, S.map.lon, S.map.z);
      Object.assign(S.map, unproject(c.x - (e.clientX - prev.x), c.y - (e.clientY - prev.y), S.map.z));
      draw();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      last = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomBy(-e.deltaY / 400);
    }, { passive: false });
    function zoomBy(dz) {
      S.map.z = clamp(S.map.z + dz, 2, 17);
      draw();
    }
    let timer = setInterval(() => {
      if (!document.body.contains(host)) return clearInterval(timer);
      if (host.style.display !== 'none' && S.focus) draw(); // pulsujacy znacznik
    }, 120);
    return { draw, bounds, zoomBy };
  }

  // ---------- panel ----------
  const panel = {
    title: 'ZIEMIA: KULA, TRZĘSIENIA, ISS, RADAR',
    glyph: '🌍',
    wide: true,
    build(body) {
      body.innerHTML = '';
      if (!isOwner()) return body.appendChild(el('div', 'hint', 'Wymaga zalogowania.'));
      const stage = el('div');
      stage.style.cssText = 'position:relative;height:min(72vh,720px);min-height:360px;border-radius:10px;overflow:hidden;background:radial-gradient(circle at 50% 45%,#061a2a,#010407 70%)';
      const globeHost = el('div');
      globeHost.style.cssText = 'position:absolute;inset:0';
      const mapHost = el('div');
      mapHost.style.cssText = 'position:absolute;inset:0;display:none';
      const hudL = el('div');
      hudL.style.cssText = 'position:absolute;left:12px;top:10px;font:12px monospace;color:#9fe8ff;background:rgba(2,12,20,.6);padding:8px 10px;border:1px solid rgba(51,224,255,.35);border-radius:6px;pointer-events:none;max-width:46%';
      const hudR = el('div');
      hudR.style.cssText = 'position:absolute;right:12px;top:10px;font:12px system-ui;color:#e8f6ff;background:rgba(2,12,20,.7);padding:8px 10px;border:1px solid rgba(51,224,255,.35);border-radius:6px;max-width:42%;line-height:1.35';
      const attrib = el('div', null, ATTRIB);
      attrib.style.cssText = 'position:absolute;right:6px;bottom:4px;font:9px system-ui;color:#8aa;opacity:.75;pointer-events:none';
      const back = el('button', 'btn', '◍ GLOBUS');
      back.style.cssText = 'position:absolute;left:12px;bottom:12px;display:none';
      stage.append(globeHost, mapHost, hudL, hudR, attrib, back);

      const bar = el('div', 'field');
      bar.style.cssText = 'gap:6px;flex-wrap:wrap;margin:8px 0;align-items:center';
      const toggle = (label, key) => {
        const b = el('button', S.layers[key] ? 'btn primary' : 'btn ghost', label);
        b.type = 'button';
        b.addEventListener('click', async () => {
          S.layers[key] = !S.layers[key];
          b.className = S.layers[key] ? 'btn primary' : 'btn ghost';
          await refreshLayer(key).catch((e) => toast(e.message));
          redraw();
        });
        return b;
      };
      const styleBtn = el('button', 'btn', S.style === 'sat' ? 'STYL: SATELITA' : 'STYL: HOLOGRAM');
      styleBtn.addEventListener('click', () => setStyle(S.style === 'sat' ? 'holo' : 'sat'));
      const where = el('input', 'inp');
      where.placeholder = 'przybliż do: miasto, kraj, adres';
      where.style.flex = '1 1 180px';
      const go = el('button', 'btn', 'PRZYBLIŻ');
      const goTo = async () => {
        if (!where.value.trim()) return;
        const p = await api(`/api/earth/place?q=${encodeURIComponent(where.value.trim())}`);
        zoomTo(p.lat, p.lon, p.name);
      };
      go.addEventListener('click', () => goTo().catch((e) => toast(e.message)));
      where.addEventListener('keydown', (e) => e.key === 'Enter' && goTo().catch((er) => toast(er.message)));
      bar.append(styleBtn, toggle('TRZĘSIENIA', 'quakes'), toggle('ISS', 'iss'), toggle('RADAR', 'radar'), toggle('SAMOLOTY', 'planes'), where, go);
      body.append(stage, bar);

      let globe = null;
      const map = buildMap(mapHost);
      function showMap(lat, lon, z = 10) {
        Object.assign(S.map, { lat, lon, z });
        S.view = 'map';
        globeHost.style.display = 'none';
        mapHost.style.display = '';
        back.style.display = '';
        map.draw();
        if (S.layers.planes) refreshLayer('planes').then(redraw).catch(() => {});
      }
      function showGlobe() {
        S.view = 'globe';
        mapHost.style.display = 'none';
        globeHost.style.display = '';
        back.style.display = 'none';
        globe?.backOut();
      }
      back.addEventListener('click', showGlobe);
      function zoomTo(lat, lon, nazwa) {
        S.focus = { lat, lon, nazwa, km: 500 };
        redraw();
        if (S.view === 'map') return showMap(lat, lon, 11);
        globe ? globe.flyTo(lat, lon, 1.6, () => showMap(lat, lon, 11)) : showMap(lat, lon, 11);
      }
      function setStyle(style) {
        S.style = style;
        styleBtn.textContent = style === 'sat' ? 'STYL: SATELITA' : 'STYL: HOLOGRAM';
        globe?.setStyle(style);
        map.draw();
      }
      function redraw() {
        globe?.redraw();
        if (S.view === 'map') map.draw();
        hud();
      }
      function hud() {
        const now = new Date();
        const off = -now.getTimezoneOffset() / 60;
        hudL.innerHTML = '';
        hudL.append(
          el('div', null, `${now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} UTC${off >= 0 ? '+' : ''}${off}:00 · ${now.toLocaleDateString('pl-PL')}`),
          el('div', null, S.view === 'map' ? `${S.map.lat.toFixed(3)}°, ${S.map.lon.toFixed(3)}° · zoom ${S.map.z.toFixed(1)}` : `${S.style === 'sat' ? 'widok satelitarny' : 'hologram'} · przeciągnij, przybliż kółkiem`),
          ...(S.focus?.nazwa ? [el('div', null, `◎ ${S.focus.nazwa}`)] : []),
        );
        hudR.innerHTML = '';
        if (S.layers.quakes && S.summary) hudR.appendChild(el('div', null, S.summary));
        if (S.layers.iss && S.iss) hudR.appendChild(el('div', 'w-dim', `ISS: ${S.iss.lat.toFixed(1)}°, ${S.iss.lon.toFixed(1)}° · ${S.iss.altKm} km · ${S.iss.speedKmh.toLocaleString('pl-PL')} km/h · ${S.iss.daylight ? 'w słońcu' : 'w cieniu Ziemi'}`));
        if (S.layers.planes) hudR.appendChild(el('div', 'w-dim', S.view === 'map' ? `Samoloty w widoku: ${S.planes.length}` : 'Samoloty widać na mapie: przybliż jakieś miejsce.'));
        if (S.layers.radar) hudR.appendChild(el('div', 'w-dim', S.radar?.frames?.length ? `Radar opadów: ${new Date(S.radar.frames[S.radar.frames.length - 1].time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} (na mapie)` : 'Radar: wczytuję...'));
        hudR.style.display = hudR.childNodes.length ? '' : 'none';
      }
      async function refreshLayer(key) {
        if (!S.layers[key]) return;
        if (key === 'quakes') await loadQuakes();
        if (key === 'iss') await loadIss();
        if (key === 'radar') await loadRadar();
        if (key === 'planes' && S.view === 'map') await loadPlanes(map.bounds());
      }

      // Polecenia glosowe (clientActions) trafiaja tutaj.
      S.body = body;
      S.api = {
        async run(p) {
          const a = p?.akcja;
          if (a === 'satelita') setStyle('sat');
          else if (a === 'hologram') setStyle('holo');
          else if (a === 'przybliz' && Number.isFinite(p.lat)) zoomTo(p.lat, p.lon, p.nazwa);
          else if (a === 'trzesienia') {
            S.layers.quakes = true;
            S.focus = Number.isFinite(p.lat) ? { lat: p.lat, lon: p.lon, nazwa: p.nazwa, km: p.km || 500 } : null;
            await loadQuakes();
            if (S.focus) globe?.flyTo(S.focus.lat, S.focus.lon, 2.2);
          } else if (a === 'iss') {
            S.layers.iss = true;
            await loadIss();
            if (S.view === 'map') showGlobe();
            globe?.flyTo(S.iss.lat, S.iss.lon, 2.4);
          } else if (a === 'radar') {
            S.layers.radar = true;
            await loadRadar();
            showMap(Number.isFinite(p.lat) ? p.lat : S.focus?.lat ?? 52, Number.isFinite(p.lon) ? p.lon : S.focus?.lon ?? 19, 6);
          } else if (a === 'samoloty') {
            S.layers.planes = true;
            if (Number.isFinite(p.lat)) showMap(p.lat, p.lon, 8);
            else if (S.view !== 'map') showMap(S.focus?.lat ?? 52.2, S.focus?.lon ?? 21, 7);
            await loadPlanes(map.bounds());
          } else if (a === 'zamknij') (UI.closeWindow || window.closeWindow)?.('ziemia');
          redraw();
        },
      };

      buildGlobe(globeHost, (lat, lon) => showMap(lat, lon, 7))
        .then((g) => {
          globe = g;
          redraw();
          if (S.pending) {
            const p = S.pending;
            S.pending = null;
            S.api.run(p).catch((e) => toast(e.message));
          }
        })
        .catch((e) => toast(e.message));
      Promise.all([loadQuakes(), loadIss()]).then(redraw).catch((e) => toast(`Ziemia: ${e.message}`));
      // Odswiezanie: ISS co 5 s, trzesienia co 5 min, samoloty co 30 s (tylko gdy widoczne).
      let n = 0;
      const tick = setInterval(async () => {
        if (!document.body.contains(body)) return clearInterval(tick);
        n++;
        try {
          if (S.layers.iss) await loadIss();
          if (S.layers.quakes && n % 60 === 0) await loadQuakes();
          if (S.layers.planes && S.view === 'map' && n % 6 === 0) await loadPlanes(map.bounds());
          if (S.layers.radar && n % 60 === 0) await loadRadar();
        } catch {
          /* chwilowy brak danych */
        }
        redraw();
      }, 5000);
    },
  };

  UI.clientActions.ziemia = (p) => {
    const open = S.api && S.body && document.body.contains(S.body);
    if (p?.akcja === 'zamknij') return open ? S.api.run(p) : undefined;
    UI.openWindow?.('ziemia');
    // Widok juz zbudowany: od razu; inaczej polecenie czeka, az kula sie wczyta.
    if (open) S.api.run(p).catch((e) => toast(e.message));
    else S.pending = p;
    return undefined;
  };

  UI.register({ id: 'ziemia', title: 'Ziemia', sub: 'kula 3D, trzęsienia, ISS, radar', icon: '🌍', owner: true, group: 'Wiedza', panels: { earth: panel } });
})();
