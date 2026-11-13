// Studio 3D: projekty z nazwanych czesci. Jarvis projektuje (replike po znalezieniu planow), a tutaj
// widac model z prawdziwa glebia, animacje rozbierania i skladania po krokach, liste czesci, edycje
// i dodawanie elementow, zrodla i rysunki. W aplikacji na PC model szlifuje i renderuje Blender.
// Silnik three.js ladujemy dopiero przy otwarciu, zeby nie spowalnial startu.
(function () {
  const UI = window.JarvisUI;
  const K = window.CadKit;
  const T = window.StudioTemplates;
  if (!UI || !UI.extend || !K) return;
  const { el, api, toast, isOwner } = UI;
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const LIB_KEY = 'jarvis.studio.lib';
  const CUR_KEY = 'jarvis.studio.current';
  const desktop = () => window.jarvisDesktop;

  const S = {
    project: null,
    warnings: [],
    selected: null,
    hidden: new Set(),
    history: [],
    future: [],
    refined: {}, // id czesci -> geometria z Blendera (w ukladzie czesci)
    blender: { status: null, result: null, busy: false, auto: true },
    job: null,
    view: null,
    tau: 0,
    spread: 1,
    together: false,
    fromZero: false,
    playing: 0,
    speed: 1,
    lector: false,
    labels: true,
    style: 'real',
    gizmo: null,
    tab: 'czesci',
    lastStep: null,
    redraw: () => {},
    ready: null,
  };

  // ---------- zapis ----------
  const store = {
    get(k, d) {
      try {
        return JSON.parse(localStorage.getItem(k)) ?? d;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch {
        return false; // przepelniony magazyn
      }
    },
  };
  const library = () => store.get(LIB_KEY, []);
  const VER_KEY = (name) => `jarvis.studio.versions.${String(name || 'projekt').slice(0, 60)}`;
  function versions(name) {
    try {
      return JSON.parse(localStorage.getItem(VER_KEY(name)) || '[]');
    } catch {
      return [];
    }
  }
  function saveVersion(label) {
    if (!S.project) return;
    const list = [{ at: Date.now(), label, parts: S.project.czesci.length, projekt: S.project }, ...versions(S.project.nazwa)].slice(0, 15);
    // Duze projekty potrafia przekroczyc limit przegladarki: wtedy zostaje mniej wersji.
    while (list.length) {
      try {
        localStorage.setItem(VER_KEY(S.project.nazwa), JSON.stringify(list));
        return;
      } catch {
        list.pop();
      }
    }
  }
  // OBJ: kazda czesc jako osobny obiekt, w mm wydruku (z uwzglednieniem skali).
  function objText(pr) {
    const sk = pr.skala || 1;
    const out = [`# ${pr.nazwa} - J.A.R.V.I.S Studio 3D, jednostki: mm${sk > 1 ? `, skala 1:${sk}` : ''}`];
    let base = 1;
    for (const p of pr.czesci.filter((c) => !c.ciecie && !S.hidden.has(c.id))) {
      const wm = S.view ? S.view.worldArray(p) : K.worldMesh(p);
      out.push(`o ${String(p.nazwa).replace(/\s+/g, '_')}`);
      for (let i = 0; i < wm.length; i += 3) out.push(`v ${(wm[i] / sk).toFixed(3)} ${(wm[i + 1] / sk).toFixed(3)} ${(wm[i + 2] / sk).toFixed(3)}`);
      for (let i = 0; i < wm.length / 3; i += 3) out.push(`f ${base + i} ${base + i + 1} ${base + i + 2}`);
      base += wm.length / 3;
    }
    return out.join('\n');
  }
  function saveToLibrary() {
    if (!S.project) return;
    const list = library().filter((x) => x.nazwa !== S.project.nazwa);
    list.unshift({ nazwa: S.project.nazwa, at: Date.now(), projekt: S.project });
    list.length = Math.min(list.length, 24);
    while (!store.set(LIB_KEY, list) && list.length > 1) list.pop();
    toast(`Zapisano: ${S.project.nazwa}`, 'ok');
    S.redraw();
  }

  // ---------- silnik ----------
  let threeLoading = null;
  function loadThree() {
    if (window.THREE?.OrbitControls) return Promise.resolve(window.THREE);
    threeLoading ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/three-bundle.js';
      s.onload = () => resolve(window.THREE);
      s.onerror = () => {
        threeLoading = null;
        reject(new Error('Nie udało się wczytać silnika 3D.'));
      };
      document.head.appendChild(s);
    });
    return threeLoading;
  }

  // ---------- zdjecie ----------
  const authHeaders = () => {
    const token = localStorage.getItem('jarvis.token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  async function photoBlob(url) {
    if (/^(blob:|data:)/.test(url)) return (await fetch(url)).blob();
    const r = await fetch(`/api/studio/image?url=${encodeURIComponent(url)}`, { headers: authHeaders() });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Nie udało się pobrać zdjęcia.');
    return r.blob();
  }
  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  /** Odrys 1:1: zdjecie z boku + dlugosc -> czesci z konturow, z podzialem od modelu AI, gdy dziala. */
  async function readPhoto(source) {
    const bmp = await createImageBitmap(source);
    const scale = Math.min(1, 2400 / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return { cv, img, w, h, q: window.PhotoTrace.photoQuality(img) };
  }
  const BUSY = /przeciążone|limit zapytań/i;
  /** Chwilowe przeciazenie modelu: czekamy i ponawiamy, zamiast poddawac sie po pierwszej odmowie. */
  async function retryBusy(fn, onWait) {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i >= 2 || !BUSY.test(e.message || '')) throw e;
        onWait?.(i);
        await new Promise((r) => setTimeout(r, i ? 15000 : 6000));
      }
    }
  }
  /** Obudowa ze zdjecia: kontury czesci, bez tworzenia projektu. */
  async function tracePhoto({ read, source, url, dlugosc, nazwa, ai, strictView, onWait }) {
    const PT = window.PhotoTrace;
    const { cv, img, w, h, q } = read;
    if (q.touches) throw new Error('Przedmiot dotyka krawędzi zdjęcia. Potrzebne jest całe zdjęcie z boku, na jednolitym tle.');
    if (!q.ok) throw new Error('To zdjęcie nie nadaje się do odrysu: potrzebny jest widok z boku na jednolitym tle.');
    // Podzial na czesci: prostokaty z modelu; bez niego jedna czesc, ale obrys i tak jest dokladny.
    const small = document.createElement('canvas');
    const sk = Math.min(1, 1100 / w);
    small.width = Math.round(w * sk);
    small.height = Math.round(h * sk);
    small.getContext('2d').drawImage(cv, 0, 0, small.width, small.height);
    let split = { czesci: [], dlugosc_mm: 0 };
    try {
      split = await retryBusy(() => api('/api/studio/photo-parts', json({ image: small.toDataURL('image/jpeg', 0.85), nazwa })), onWait);
    } catch (e) {
      // Zdjecie z sieci bez potwierdzenia, ze to ten przedmiot, nie moze zostac modelem: tak powstaly zaciski zamiast gitary.
      if (strictView) throw Object.assign(new Error(`Nie mogłem sprawdzić zdjęcia: ${e.message}`), { niesprawdzone: true });
      toast(`Bez podziału na części: ${e.message}`);
    }
    if (strictView && split.to_ten_przedmiot !== true) throw new Error('Na zdjęciu jest coś innego.');
    if (strictView && split.widok_z_boku === false) throw new Error('Zły widok na zdjęciu.');
    const length = Number(dlugosc) > 0 ? Number(dlugosc) : split.dlugosc_mm;
    if (!(length > 0)) throw new Error('Podaj prawdziwą długość w milimetrach: bez niej nie da się ustalić skali.');
    // Faza wieksza niz pare pikseli psuje dokladny kontur: krawedz zaczyna przecinac sama siebie.
    const pxMm = length / Math.max(q.bbox[2] - q.bbox[0], q.bbox[3] - q.bbox[1]);
    // Bryla toczona ignoruje kontur i zdjecie, a model potrafi tak oznaczyc nawet korpus gitary. Obla z konturu
    // daje okragla rure, gdy rura jest okragla, i wierny ksztalt, gdy nie jest.
    const parts = split.czesci.map((c) => ({ id: c.id, nazwa: c.nazwa, grupa: c.grupa, krok: c.krok, gr: c.gr, oble: c.obly || c.obrotowa, szer: c.szer, metal: c.metal, szorstkosc: c.szorstkosc, kolor: '#2a2d30', faza: Math.min(c.gr * 0.1, pxMm * 1.2), obszar: [c.box[0] * w, c.box[1] * h, c.box[2] * w, c.box[3] * h] }));
    parts.push({ id: 'reszta', reszta: true, oble: true, nazwa: split.czesci.length ? 'Pozostała część korpusu' : (nazwa || 'Obrys'), grupa: 'Korpus', krok: 1, gr: Math.round(length * 0.12), kolor: '#2a2d30', metal: 0.2, szorstkosc: 0.6, faza: pxMm * 1.2, obszar: [0, 0, w, h] });
    const t = PT.traceParts(img, { dlugosc: length, dluzszy: true, parts, eps: 1.5, minHole: Math.max(40, (w * w) / 26000), czysc: true });
    // Druga strona nie ma zdjecia, ale ma prawdziwy kolor tej czesci.
    t.parts.forEach((p) => {
      if (p.kolorZdjecia) p.kolor = p.kolorZdjecia;
    });
    const tytul = ai ? 'Obraz wygenerowany przez AI (to nie jest zdjęcie prawdziwego przedmiotu)' : 'Zdjęcie użyte do odrysu';
    const zdjecie = { url: URL.createObjectURL(source), strona: /^https:/.test(url || '') ? url : '', tytul, k: t.k, cx: t.cx, cy: t.cy, flip: t.flip, w: t.w, h: t.h };
    return { t, zdjecie, length, czesci: t.parts.map((p) => PT.toPart(p)) };
  }
  /** Odrys 1:1 na zadanie: zdjecie od uzytkownika + dlugosc. */
  /**
   * Zdjecie z gory podaje prawdziwa szerokosc wzdluz przedmiotu. Bez niego grubosc obłych czesci to szacunek.
   * Zwraca czesci z polem szer albo bez zmian, gdy zdjecie sie nie nadaje.
   */
  async function applyTopPhoto(czesci, topBlob, length) {
    const read = await readPhoto(topBlob);
    if (read.q.touches || !read.q.ok) throw new Error('Zdjęcie z góry musi pokazywać cały przedmiot na jednolitym tle.');
    const prof = window.PhotoTrace.widthProfile(read.img);
    const all = czesci.flatMap((c) => (c.kontur ? c.kontur.map(([x]) => x + c.x) : [c.x]));
    const xMin = Math.min(...all);
    let used = 0;
    const out = czesci.map((c) => {
      if (c.ksztalt !== 'boczny' || !c.kontur) return c;
      const xs = c.kontur.map(([x]) => x + c.x);
      const szer = window.PhotoTrace.partWidths(prof, { length, modelXMin: xMin, xFrom: Math.min(...xs), xTo: Math.max(...xs) });
      if (!szer) return c;
      used++;
      return { ...c, oble: true, szer, gr: Math.max(...szer.map((s) => s[1])) };
    });
    return { czesci: out, used };
  }

  async function fromPhoto({ url, blob, dlugosc, nazwa, topBlob }) {
    const source = blob || (await photoBlob(url));
    const read = await readPhoto(source);
    const traced = await tracePhoto({ read, source, url, dlugosc, nazwa });
    const { t, zdjecie, length } = traced;
    let { czesci } = traced;
    let topNote = '';
    if (topBlob) {
      const r = await applyTopPhoto(czesci, topBlob, length);
      czesci = r.czesci;
      topNote = ` Szerokość ${r.used} części wzięta ze zdjęcia z góry (przedmiot musi na nim leżeć tym samym końcem w lewo).`;
    }
    setProject({
      nazwa: nazwa || 'Odrys ze zdjęcia',
      opis: `Obrys odrysowany ze zdjęcia i przeskalowany do ${Math.round(length)} mm (${t.k.toFixed(2)} mm na piksel).`,
      realny: true,
      uwagi: `Z boku obrys jest zgodny ze zdjęciem. ${topBlob ? '' : 'Grubości i krzywizna to szacunek, '}drugi bok obłych części to lustrzane odbicie zdjęcia, a wnętrza zdjęcie z boku nie pokazuje: dodaj je w zakładce EDYCJA albo poleceniem.${topNote}`,
      zdjecie,
      czesci,
      kroki: [...new Set(t.parts.map((p) => p.krok))].sort((a, b) => a - b).map((nr) => ({ nr, tytul: t.parts.filter((p) => p.krok === nr).map((p) => p.nazwa).join(', ').slice(0, 90) })),
      zrodla: /^https:/.test(url || '') ? [{ tytul: 'Zdjęcie użyte do odrysu', url }] : [],
    });
    emit(`Odrys 1:1 gotowy: ${S.project.nazwa}, ${S.project.czesci.length} części.`);
    if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `Odrysowałem model ze zdjęcia, ${S.project.czesci.length} części, ${t.k.toFixed(2)} mm na piksel. Powiedz krótko, że bok jest zgodny ze zdjęciem, a grubości to szacunek.` });
    return S.project;
  }

  // ---------- podglad ----------
  function createViewer(host, THREE, hooks) {
    const canvas = el('canvas', 'st-canvas');
    const labelsBox = el('div', 'st-labels');
    const tip = el('div', 'st-tip');
    tip.hidden = true;
    const planImg = el('img', 'st-plan-overlay');
    planImg.hidden = true;
    planImg.referrerPolicy = 'no-referrer';
    host.append(canvas, planImg, labelsBox, tip);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    } catch {
      throw new Error('Ta przeglądarka nie obsługuje grafiki 3D (WebGL).');
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 1.1;
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 1000);
    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.7;
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(1, 1.4, 0.8);
    const rim = new THREE.DirectionalLight(0x66ccff, 0.9);
    rim.position.set(-1, 0.5, -1);
    scene.add(key, rim, new THREE.HemisphereLight(0x9fd8ff, 0x0a1420, 0.5));
    const gizmo = new THREE.TransformControls(camera, canvas);
    gizmo.addEventListener('dragging-changed', (e) => {
      controls.enabled = !e.value;
      if (e.value) hooks.onGizmoStart();
      else if (gizmo.object) hooks.onGizmoEnd(gizmo.object);
    });
    gizmo.addEventListener('objectChange', () => gizmo.object && hooks.onGizmoMove(gizmo.object));
    scene.add(gizmo.getHelper());
    const root = new THREE.Group();
    scene.add(root);
    let grid = null;
    let meshes = {};
    let vectors = {};
    let m = null;
    let center = new THREE.Vector3();
    let fitTarget = null;

    const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#33e0ff';
    function geometryFor(p) {
      const refined = S.refined[p.id];
      if (refined) return refined.clone();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(K.partMesh(p), 3));
      // Bryla obla ma byc gladka: ostry jest tylko jej rant.
      return THREE.toCreasedNormals(g, p.oble ? 1.25 : 0.6);
    }
    function disposeMeshes() {
      Object.values(meshes).forEach((o) => {
        o.geometry.dispose();
        o.material.dispose();
        o.children.forEach((c) => {
          c.geometry?.dispose();
          c.material?.dispose();
        });
      });
      root.clear();
      meshes = {};
    }
    function materialFor(p) {
      if (S.style === 'holo') return new THREE.MeshBasicMaterial({ color: accent(), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      if (S.style === 'xray') return new THREE.MeshStandardMaterial({ color: p.kolor, transparent: true, opacity: 0.28, metalness: 0.1, roughness: 0.4, depthWrite: false, side: THREE.DoubleSide });
      return new THREE.MeshStandardMaterial({ color: p.kolor, metalness: p.metal, roughness: p.szorstkosc, transparent: true, opacity: 1, side: THREE.DoubleSide });
    }
    // Zdjecie na bokach czesci: mapujemy je tam, gdzie te piksele naprawde lezaly.
    let photoTex = null;
    function ensurePhoto() {
      const z = S.project?.zdjecie;
      if (!z || photoTex?.url === z.url) return;
      photoTex = { url: z.url, map: null };
      const here = photoTex;
      photoBlob(z.url)
        .then((blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }))
        .then((bmp) => {
          if (photoTex !== here) return;
          const map = new THREE.Texture(bmp);
          map.flipY = false;
          map.colorSpace = THREE.SRGBColorSpace;
          map.anisotropy = 8;
          map.needsUpdate = true;
          here.map = map;
          Object.values(meshes).forEach(decorate);
        })
        .catch(() => {
          // Obraz z tej sesji po przeladowaniu juz nie istnieje: model zostaje bez powierzchni ze zdjecia.
          if (!/^blob:/.test(here.url)) toast('Nie udało się wczytać zdjęcia: model jest bez powierzchni ze zdjęcia.');
        });
    }
    function addSkin(mesh) {
      const z = S.project?.zdjecie;
      const p = S.project?.czesci.find((c) => c.id === mesh.userData.id);
      if (!z || !p?.skora || !photoTex?.map) return;
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = g.attributes.position;
      let zMax = -Infinity;
      let zMin = Infinity;
      for (let i = 0; i < pos.count; i++) {
        zMax = Math.max(zMax, pos.getZ(i));
        zMin = Math.min(zMin, pos.getZ(i));
      }
      const eps = (zMax - zMin) * 0.002 + 1e-4;
      const out = [];
      const uv = [];
      const nor = [];
      const normals = g.attributes.normal;
      // Odstep rosnie z rozmiarem modelu: przy dwoch metrach 0,03 mm to za malo i warstwy migocza.
      const lift = Math.max(0.03, Math.hypot(S.project ? K.measure(S.project).size[0] : 0, 0) * 0.0002);
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const zs = [pos.getZ(i), pos.getZ(i + 1), pos.getZ(i + 2)];
        // Bryla obla nie ma plaskiej sciany: o stronie decyduje kierunek trojkata, a boczne ranty zostaja bez zdjecia.
        const nz = (pos.getX(i + 1) - pos.getX(i)) * (pos.getY(i + 2) - pos.getY(i)) - (pos.getY(i + 1) - pos.getY(i)) * (pos.getX(i + 2) - pos.getX(i));
        const side = p.oble ? (Math.abs(nz) < 1e-9 ? 0 : Math.sign(nz)) : zs.every((v) => v > zMax - eps) ? 1 : zs.every((v) => v < zMin + eps) ? -1 : 0;
        // Plaska czesc: tylko strona, ktora zdjecie naprawde pokazuje, bo na drugiej napisy bylyby w lustrzanym
        // odbiciu. Obla bez zdjecia wyglada jak bryla gliny, wiec dostaje odbicie, a uwagi projektu o tym mowia.
        const wanted = z.flip < 0 ? -1 : 1;
        if (p.oble ? !side : side !== wanted) continue;
        for (let k = 0; k < 3; k++) {
          const x = pos.getX(i + k);
          const y = pos.getY(i + k);
          out.push(x, y, zs[k] + side * lift);
          if (normals) nor.push(normals.getX(i + k), normals.getY(i + k), normals.getZ(i + k));
          uv.push(((x + p.x) / (z.k * z.flip) + z.cx) / z.w, 1 - (z.cy - (y + p.y) / z.k) / z.h);
        }
      }
      if (!out.length) return;
      const skin = new THREE.BufferGeometry();
      skin.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
      skin.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (nor.length) skin.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      else skin.computeVertexNormals();
      const s = new THREE.Mesh(skin, new THREE.MeshStandardMaterial({ map: photoTex.map, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      s.raycast = () => {};
      mesh.add(s);
    }
    function decorate(mesh) {
      mesh.children.slice().forEach((c) => {
        c.geometry.dispose();
        c.material.dispose();
        mesh.remove(c);
      });
      if (S.style === 'real') addSkin(mesh);
      if (S.style !== 'holo' && S.style !== 'wire') return;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), new THREE.LineBasicMaterial({ color: accent(), transparent: true, opacity: 0.8 }));
      lines.raycast = () => {};
      mesh.add(lines);
    }
    function setPartTransform(mesh, p) {
      const d = Math.PI / 180;
      mesh.userData.base = new THREE.Vector3(p.x, p.y, p.z);
      mesh.rotation.set(p.rx * d, p.ry * d, p.rz * d, 'XYZ');
    }
    function setProject(project, keepCamera) {
      gizmo.detach();
      disposeMeshes();
      ensurePhoto();
      m = K.measure(project);
      vectors = K.explodeVectors(project, m);
      center.set(...K.centerOf(m.bounds));
      for (const p of project.czesci) {
        if (p.ciecie) continue;
        const mesh = new THREE.Mesh(geometryFor(p), materialFor(p));
        mesh.userData.id = p.id;
        setPartTransform(mesh, p);
        mesh.position.copy(mesh.userData.base);
        decorate(mesh);
        meshes[p.id] = mesh;
        root.add(mesh);
      }
      const span = m.span;
      if (grid) {
        scene.remove(grid);
        grid.geometry.dispose();
        grid.material.dispose();
      }
      grid = new THREE.GridHelper(span * 2.4, 24, accent(), accent());
      grid.material.transparent = true;
      grid.material.opacity = 0.14;
      grid.position.set(center.x, m.bounds.lo[1] - span * 0.005, center.z);
      scene.add(grid);
      camera.near = span / 200;
      camera.far = span * 60;
      camera.updateProjectionMatrix();
      if (!keepCamera) {
        // Dlugi przedmiot ogladamy z boku, nie od czola.
        const dir = m.size[0] >= m.size[2] ? new THREE.Vector3(0.42, 0.26, 0.87) : new THREE.Vector3(0.87, 0.26, 0.42);
        if (project.zdjecie?.flip < 0) dir.z = -Math.abs(dir.z); // zaczynamy od strony ze zdjecia
        controls.target.copy(center);
        camera.position.copy(center).add(dir.normalize().multiplyScalar(span));
        const aspect = host.clientWidth && host.clientHeight ? host.clientWidth / host.clientHeight : 1.6;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        const f = fitBox(false);
        camera.position.copy(f.c).add(dir.multiplyScalar(f.dist));
        controls.target.copy(f.c);
        fitTarget = null;
      }
      refreshAll();
    }
    function refreshAll() {
      if (!S.project) return;
      const tl = K.timeline(S.project, S.tau);
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
      const hl = new THREE.Color(accent());
      for (const p of S.project.czesci) {
        const mesh = meshes[p.id];
        if (!mesh) continue;
        const e = S.together ? ease(S.tau) : tl.progress[p.id];
        const v = vectors[p.id];
        if (gizmo.object !== mesh || !gizmo.dragging) mesh.position.set(p.x + v[0] * e * S.spread, p.y + v[1] * e * S.spread, p.z + v[2] * e * S.spread);
        const gone = S.fromZero && e >= 0.995;
        mesh.visible = !S.hidden.has(p.id) && !gone;
        const mat = mesh.material;
        if (S.style === 'real') mat.opacity = S.fromZero ? Math.max(0.08, 1 - e * e) : 1;
        if (mat.emissive) {
          mat.emissive.copy(hl);
          mat.emissiveIntensity = p.id === S.selected ? 0.5 : 0;
        }
        if (S.style === 'holo') mat.opacity = p.id === S.selected ? 0.42 : 0.1;
      }
      return tl;
    }
    function setStyle() {
      if (!S.project) return;
      for (const p of S.project.czesci) {
        const mesh = meshes[p.id];
        if (!mesh) continue;
        mesh.material.dispose();
        mesh.material = materialFor(p);
        decorate(mesh);
      }
      refreshAll();
    }
    // Kadr: odleglosc, z ktorej wszystkie widoczne czesci mieszcza sie w oknie, z obecnego kierunku patrzenia.
    function fitBox(on) {
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
      const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (const p of S.project.czesci) {
        if (!meshes[p.id] || S.hidden.has(p.id)) continue;
        const b = m.items[p.id];
        const k = on ? S.spread : 0;
        const v = vectors[p.id];
        lo.min(new THREE.Vector3(b.lo[0] + v[0] * k, b.lo[1] + v[1] * k, b.lo[2] + v[2] * k));
        hi.max(new THREE.Vector3(b.hi[0] + v[0] * k, b.hi[1] + v[1] * k, b.hi[2] + v[2] * k));
      }
      if (!Number.isFinite(lo.x)) return { c: center.clone(), dist: m.span * 2 };
      const c = lo.clone().add(hi).multiplyScalar(0.5);
      const dir = camera.position.clone().sub(controls.target).normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
      const up = dir.clone().cross(right).normalize();
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const tanH = tanV * (camera.aspect || 1.6);
      let dist = 0;
      for (const x of [lo.x, hi.x]) {
        for (const y of [lo.y, hi.y]) {
          for (const z of [lo.z, hi.z]) {
            const rel = new THREE.Vector3(x, y, z).sub(c);
            dist = Math.max(dist, Math.abs(rel.dot(right)) / tanH + rel.dot(dir), Math.abs(rel.dot(up)) / tanV + rel.dot(dir));
          }
        }
      }
      return { c, dist: Math.max(m.span * 0.3, dist * 1.14) };
    }
    function frameExploded(on) {
      if (m) fitTarget = fitBox(on);
    }
    function drawLabels() {
      const rect = canvas.getBoundingClientRect();
      labelsBox.innerHTML = '';
      if (!S.labels || !S.project) return;
      const tl = K.timeline(S.project, S.tau);
      const moving = S.tau > 0 && S.tau < 1 ? S.project.czesci.filter((p) => p.krok === tl.step) : [];
      const list = S.selected ? S.project.czesci.filter((p) => p.id === S.selected) : moving.slice(0, 8);
      if (S.tau >= 1 && !S.selected) {
        const seen = new Set();
        S.project.czesci.forEach((p) => {
          if (!seen.has(p.grupa) && !p.ciecie) {
            seen.add(p.grupa);
            list.push({ ...p, nazwa: p.grupa });
          }
        });
      }
      for (const p of list) {
        const mesh = meshes[p.id];
        if (!mesh || !mesh.visible) continue;
        const b = m.items[p.id];
        const off = new THREE.Vector3(...K.centerOf(b)).sub(mesh.userData.base);
        const pt = mesh.position.clone().add(off).project(camera);
        if (pt.z > 1) continue;
        const l = el('div', 'st-label', p.nazwa);
        l.style.left = `${Math.round(((pt.x + 1) / 2) * rect.width)}px`;
        l.style.top = `${Math.round(((1 - pt.y) / 2) * rect.height)}px`;
        labelsBox.appendChild(l);
      }
    }

    // Wybor czesci kliknieciem.
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;
    const pick = (e) => {
      const r = canvas.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(Object.values(meshes).filter((o) => o.visible), false)[0];
      return hit ? hit.object.userData.id : null;
    };
    canvas.addEventListener('pointerdown', (e) => {
      downAt = [e.clientX, e.clientY];
      controls.autoRotate = false;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || gizmo.axis) return;
      if (S.measure?.on) {
        const r = canvas.getBoundingClientRect();
        pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(pointer, camera);
        const hit = ray.intersectObjects(Object.values(meshes).filter((o) => o.visible), false)[0];
        if (hit) hooks.onMeasure?.(hit.point.clone());
        return;
      }
      hooks.onSelect(pick(e));
    });
    // Miarka: kulki w punktach i linia miedzy nimi, widoczne przez model.
    let measureGroup = null;
    function drawMeasure(pts) {
      if (measureGroup) {
        scene.remove(measureGroup);
        measureGroup.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose();
        });
        measureGroup = null;
      }
      if (!pts?.length || !m) return;
      measureGroup = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd25d, depthTest: false });
      const r = Math.max(0.5, m.span * 0.006);
      for (const p of pts) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat.clone());
        s.position.copy(p);
        s.renderOrder = 999;
        measureGroup.add(s);
      }
      if (pts.length === 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd25d, depthTest: false }));
        line.renderOrder = 999;
        measureGroup.add(line);
      }
      scene.add(measureGroup);
    }
    let lastHover = 0;
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons || performance.now() - lastHover < 60 || !S.project) return;
      lastHover = performance.now();
      const id = pick(e);
      const p = id && S.project.czesci.find((x) => x.id === id);
      tip.hidden = !p;
      if (p) {
        const r = host.getBoundingClientRect();
        tip.textContent = `${p.nazwa} · ${p.grupa}`;
        tip.style.left = `${e.clientX - r.left + 12}px`;
        tip.style.top = `${e.clientY - r.top + 12}px`;
      }
    });
    canvas.addEventListener('pointerleave', () => {
      tip.hidden = true;
    });

    let w = 0;
    let h = 0;
    let raf = 0;
    let prev = performance.now();
    let frames = 0;
    const loop = (now) => {
      if (!canvas.isConnected) return destroy();
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const rw = host.clientWidth;
      const rh = host.clientHeight;
      if (!rw || !rh) return;
      if (rw !== w || rh !== h) {
        w = rw;
        h = rh;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      hooks.onTick(dt);
      if (fitTarget) {
        controls.target.lerp(fitTarget.c, 0.06);
        const dir = camera.position.clone().sub(controls.target);
        const nextLen = dir.length() + (fitTarget.dist - dir.length()) * 0.06;
        camera.position.copy(controls.target).add(dir.setLength(nextLen));
        if (Math.abs(nextLen - fitTarget.dist) < fitTarget.dist * 0.01 && controls.target.distanceTo(fitTarget.c) < fitTarget.dist * 0.005) fitTarget = null;
      }
      controls.update();
      renderer.render(scene, camera);
      if (++frames % 4 === 0) drawLabels();
    };
    function destroy() {
      cancelAnimationFrame(raf);
      disposeMeshes();
      gizmo.detach();
      gizmo.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    }
    raf = requestAnimationFrame(loop);

    return {
      setProject,
      refresh: refreshAll,
      setStyle,
      frameExploded,
      destroy,
      /** Przekroj: ucina model plaszczyzna, zeby zajrzec do srodka. axis to x, y, z albo null. */
      setClip(axis, t) {
        if (!axis || !m) {
          renderer.clippingPlanes = [];
          return;
        }
        const k = { x: 0, y: 1, z: 2 }[axis];
        const normal = new THREE.Vector3(k === 0 ? -1 : 0, k === 1 ? -1 : 0, k === 2 ? -1 : 0);
        const at = m.bounds.lo[k] + (m.bounds.hi[k] - m.bounds.lo[k]) * t;
        renderer.clippingPlanes = [new THREE.Plane(normal, at)];
      },
      /** Kamera od strony przeciecia: inaczej widac tylko nienaruszona polowe. */
      lookAlong(axis) {
        if (!m) return;
        controls.autoRotate = false;
        const dir = new THREE.Vector3(axis === 'x' ? 1 : 0.18, axis === 'y' ? 1 : 0.16, axis === 'z' ? 1 : 0.18).normalize();
        const away = camera.position.distanceTo(controls.target);
        camera.position.copy(controls.target).add(dir.multiplyScalar(away));
        fitTarget = fitBox(S.tau > 0.5);
      },
      setPlan(url) {
        planImg.hidden = !url;
        if (url) planImg.src = url;
      },
      attachGizmo(id, mode) {
        const mesh = meshes[id];
        if (!mesh || !mode) return gizmo.detach();
        gizmo.setMode(mode);
        gizmo.setSpace('world');
        gizmo.attach(mesh);
      },
      /** Blender zwraca GLB w ukladzie projektu * sf: przeliczamy na uklad kazdej czesci. */
      absorbGlb(buffer, sf) {
        return new Promise((resolve, reject) => {
          new THREE.GLTFLoader().parse(buffer, '', (gltf) => {
            gltf.scene.updateMatrixWorld(true);
            const scale = new THREE.Matrix4().makeScale(1 / sf, 1 / sf, 1 / sf);
            const byId = new Map(S.project.czesci.map((p) => [p.id, p]));
            const found = {};
            const merge = (a, b) => {
              const x = a.index ? a.toNonIndexed() : a;
              const y = b.index ? b.toNonIndexed() : b;
              const g = new THREE.BufferGeometry();
              ['position', 'normal'].forEach((n) => g.setAttribute(n, new THREE.Float32BufferAttribute([...x.attributes[n].array, ...y.attributes[n].array], 3)));
              return g;
            };
            gltf.scene.traverse((o) => {
              if (!o.isMesh) return;
              let id = o.name;
              for (let q = o; q && !byId.has(id); q = q.parent) id = q.name;
              const p = byId.get(id);
              if (!p) return;
              const part = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler((p.rx * Math.PI) / 180, (p.ry * Math.PI) / 180, (p.rz * Math.PI) / 180, 'XYZ')), new THREE.Vector3(1, 1, 1));
              const g = o.geometry.clone();
              g.applyMatrix4(scale.clone().multiply(o.matrixWorld));
              g.applyMatrix4(part.clone().invert());
              g.computeBoundingSphere();
              found[id] = found[id] ? merge(found[id], g) : g;
            });
            resolve(found);
          }, reject);
        });
      },
      /** Siatka czesci do STL: z Blendera, gdy jest, inaczej wbudowana. */
      worldArray(p) {
        const r = S.refined[p.id];
        if (!r) return K.worldMesh(p);
        const pos = r.attributes.position;
        const idx = r.index;
        const local = [];
        const n = idx ? idx.count : pos.count;
        for (let i = 0; i < n; i++) {
          const v = idx ? idx.getX(i) : i;
          local.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        }
        return K.transform(p, local);
      },
      drawMeasure,
      png() {
        renderer.render(scene, camera);
        return canvas.toDataURL('image/png');
      },
      /** Kamera od razu na miejscu: do klatki dla AI nie ma czasu na plynny najazd. */
      settle(on, side) {
        if (!m) return;
        if (side) {
          const away = camera.position.distanceTo(controls.target);
          const look = new THREE.Vector3(0.05, 0.08, S.project.zdjecie?.flip < 0 ? -1 : 1).normalize();
          camera.position.copy(controls.target).add(look.multiplyScalar(away));
        }
        const t = fitBox(on);
        const dir = camera.position.clone().sub(controls.target).setLength(t.dist);
        controls.target.copy(t.c);
        camera.position.copy(t.c).add(dir);
        fitTarget = null;
        controls.update();
      },
      /** Klatka do przegladu AI: JPEG na ciemnym tle, bo PNG wazy wielokrotnie wiecej i nic nie wnosi. */
      jpeg() {
        renderer.render(scene, camera);
        const out = document.createElement('canvas');
        const sc = Math.min(1, 1000 / canvas.width);
        out.width = Math.round(canvas.width * sc);
        out.height = Math.round(canvas.height * sc);
        const c = out.getContext('2d');
        c.fillStyle = '#10171d';
        c.fillRect(0, 0, out.width, out.height);
        c.drawImage(canvas, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', 0.8);
      },
      glb() {
        return new Promise((resolve, reject) => {
          new THREE.GLTFExporter().parse(root, resolve, reject, { binary: true });
        });
      },
    };
  }

  // ---------- zmiany projektu ----------
  function setProject(raw) {
    S.project = K.normalizeProject(raw);
    S.warnings = K.check(S.project);
    S.selected = null;
    S.hidden = new Set();
    S.history = [];
    S.future = [];
    S.refined = {};
    S.blender.result = null;
    S.tau = 0;
    S.playing = 0;
    S.fromZero = false;
    S.lastStep = null;
    store.set(CUR_KEY, S.project);
    if (S.clip) {
      S.clip.axis = null;
      S.applyClip?.();
    }
    S.view?.setProject(S.project);
    S.redraw();
  }
  function commit(next, { keepRefined = true, snapshot } = {}) {
    S.history.push(snapshot || JSON.stringify(S.project.czesci));
    if (S.history.length > 40) S.history.shift();
    S.future = [];
    S.project = next;
    S.warnings = K.check(next);
    if (!keepRefined) S.refined = {};
    store.set(CUR_KEY, next);
    S.view?.setProject(next, true);
    S.redraw();
  }
  function undo(dir) {
    const from = dir < 0 ? S.history : S.future;
    const to = dir < 0 ? S.future : S.history;
    if (!from.length) return;
    to.push(JSON.stringify(S.project.czesci));
    S.project = { ...S.project, czesci: JSON.parse(from.pop()) };
    S.warnings = K.check(S.project);
    S.view?.setProject(S.project, true);
    S.redraw();
  }
  const selectedPart = () => S.project?.czesci.find((p) => p.id === S.selected) || null;
  function editPart(id, patch) {
    delete S.refined[id];
    commit(K.applyOps(S.project, { zmien: [{ id, ...patch }] }));
  }
  const say = (text, instruction) => {
    if (UI.isLive?.()) UI.liveSend({ type: 'react', text: instruction || `Przeczytaj krótko: ${text}` });
    else if (S.lector) UI.speak?.(text);
  };

  // ---------- animacja ----------
  function play(dir, opts = {}) {
    if (!S.project) return;
    S.selected = null;
    S.view?.attachGizmo(null);
    S.gizmo = null;
    S.fromZero = Boolean(opts.fromZero);
    if (dir > 0 && S.tau >= 1) S.tau = 0;
    if (dir < 0 && S.tau <= 0) S.tau = 1;
    S.playing = dir;
    S.lastStep = null;
    S.view?.frameExploded(dir > 0 || S.fromZero);
    S.redraw();
  }
  function tick(dt) {
    if (!S.playing || !S.project) return;
    const n = Math.max(1, K.stepNumbers(S.project).length);
    const perStep = (S.lector || UI.isLive?.() ? 5.5 : Math.max(0.6, Math.min(1.8, 18 / n))) / S.speed;
    S.tau = Math.max(0, Math.min(1, S.tau + (S.playing * dt) / (perStep * n)));
    const tl = S.view?.refresh();
    if (tl && tl.step !== S.lastStep) {
      S.lastStep = tl.step;
      const k = S.project.kroki.find((x) => x.nr === tl.step);
      if (k && (S.lector || UI.isLive?.())) say(`${S.playing > 0 ? 'Zdejmuję' : 'Montuję'}: ${k.tytul}. ${k.opis}`, `Komentujesz animację modelu. Jednym krótkim zdaniem powiedz: ${S.playing > 0 ? 'zdejmujemy' : 'montujemy'} ${k.tytul}. ${k.opis}`);
    }
    if (S.tau <= 0 || S.tau >= 1) {
      S.playing = 0;
      if (S.tau <= 0) {
        S.fromZero = false;
        S.view?.refresh();
        S.view?.frameExploded(false);
      }
    }
    S.drawTimeline?.();
  }
  function goToStep(nr) {
    const steps = K.stepNumbers(S.project);
    const i = steps.indexOf(nr);
    if (i < 0) return;
    // Pokazujemy stan z wyjeta ta czescia: wszystko, co montowane po niej, tez jest juz zdjete.
    S.playing = 0;
    S.fromZero = false;
    S.tau = (steps.length - i) / steps.length;
    S.view?.refresh();
    S.view?.frameExploded(true);
    S.lastStep = null;
    S.drawTimeline?.();
    const k = S.project.kroki.find((x) => x.nr === nr);
    if (k) say(`${k.tytul}. ${k.opis}`, `Powiedz jednym zdaniem o tym kroku: ${k.tytul}. ${k.opis}`);
  }

  // ---------- Jarvis projektuje ----------
  const emit = (text, opt = {}) => UI.activity?.emit('projekt', text, opt);
  async function waitReady() {
    UI.openWindow?.('cad');
    for (let i = 0; i < 60 && !S.view; i++) await new Promise((r) => setTimeout(r, 100));
  }
  /** Wybor zdjecia: najpierw prawdziwe z sieci (najlepsze oceny), a gdy zadne nie pasuje, obraz od generatora. */
  async function autoOutline(job, nazwa, setStage) {
    const wait = () => setStage('Gemini jest przeciążony, czekam i ponawiam');
    const candidates = (job.obrazy || []).slice(0, 20);
    const rated = [];
    let idx = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (idx < candidates.length) {
        const url = candidates[idx++];
        try {
          const source = await photoBlob(url);
          const read = await readPhoto(source);
          if (read.q.ok && read.w >= 500) rated.push({ url, source, read, score: Math.min(read.w * read.h, 2e6) * (1 - read.q.stray) * (1 - read.q.slaba) });
        } catch {
          /* adres nie odpowiada: nastepny */
        }
      }
    }));
    rated.sort((a, b) => b.score - a.score);
    // Ukos, sama waska krawedz i przedmiot zlewajacy sie z tlem daja zly model, nawet gdy zdjecie jest duze.
    const fine = rated.filter((c) => !c.read.q.skos && !c.read.q.krawedz && c.read.q.slaba < 0.35);
    const pool = fine.length ? fine : rated;
    if (pool.length > 1) {
      setStage('Wybieram najlepsze zdjęcie');
      try {
        const top = pool.slice(0, 8);
        const obrazy = top.map(({ read }) => {
          const c = document.createElement('canvas');
          const sc = Math.min(1, 384 / Math.max(read.w, read.h));
          c.width = Math.round(read.w * sc);
          c.height = Math.round(read.h * sc);
          c.getContext('2d').drawImage(read.cv, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', 0.75);
        });
        const r = await retryBusy(() => api('/api/studio/pick-photo', json({ obrazy, nazwa })), wait);
        if (r.najlepszy >= 0) pool.unshift(pool.splice(r.najlepszy, 1)[0]);
        else pool.length = 0; // model nie widzi tego przedmiotu na zadnym zdjeciu
      } catch {
        /* kazde zdjecie i tak przejdzie niżej sprawdzenie, czy to ten przedmiot */
      }
    }
    const dlugosc = job.plan?.dlugosc_mm;
    for (const c of pool.slice(0, 3)) {
      setStage(`Sprawdzam i odrysowuję zdjęcie: ${new URL(c.url).hostname}`);
      try {
        return await tracePhoto({ ...c, dlugosc, nazwa, strictView: true, onWait: wait });
      } catch (e) {
        if (e.niesprawdzone) throw e; // model nie odpowiada, wiec nastepne zdjecie tez nie przejdzie
        /* inny przedmiot albo zly widok: nastepne */
      }
    }
    setStage('Nie ma dobrego zdjęcia: generuję obraz referencyjny');
    const r = await fetch('/api/studio/reference', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ opis: nazwa }) });
    if (!r.ok) throw new Error('Nie ma obrazu referencyjnego.');
    const source = await r.blob();
    const read = await readPhoto(source);
    return tracePhoto({ read, source, dlugosc, nazwa, ai: true, strictView: true, onWait: wait });
  }
  /** Laczy odrysowana obudowe z wnetrzem: najpierw montujemy srodek, potem to, co na wierzchu. */
  function mergeOutline(inner, outline) {
    const steps = K.stepNumbers(inner);
    const offset = steps.length ? Math.max(...steps) : 0;
    const shell = outline.czesci.map((c) => ({ ...c, krok: (c.krok || 1) + offset }));
    const shellSteps = [...new Set(shell.map((c) => c.krok))].sort((a, b) => a - b);
    const fit = K.fitInside(inner.czesci, shell);
    outline.dopasowanie = fit;
    return {
      ...inner,
      zdjecie: outline.zdjecie,
      realny: true,
      czesci: [...fit.czesci, ...shell],
      kroki: [...inner.kroki, ...shellSteps.map((nr) => ({ nr, tytul: shell.filter((c) => c.krok === nr).map((c) => c.nazwa).join(', ').slice(0, 90), opis: 'Część zewnętrzna odrysowana ze zdjęcia.' }))],
      uwagi: [`Obudowa: ${outline.zdjecie.tytul}, ${outline.t.k.toFixed(2)} mm na piksel. Obrys z boku jest z tego obrazu; grubości i krzywizna to szacunek, a drugi bok to lustrzane odbicie tego zdjęcia, więc napisy są tam odwrócone.`, inner.uwagi].filter(Boolean).join(' '),
    };
  }
  /** Jedna runda kontroli: AI oglada render i poprawia wnetrze. Gdy sie nie uda, projekt zostaje taki, jak jest. */
  async function reviewPass(setStage) {
    if (!S.view?.jpeg) return null;
    setStage('Sprawdzam gotowy model na renderach');
    S.playing = 0;
    const frame = async (tau, side) => {
      S.tau = tau;
      S.view.refresh();
      S.view.settle(tau > 0, side);
      await new Promise((r) => setTimeout(r, 900));
      S.view.settle(tau > 0);
      return S.view.jpeg();
    };
    const obrazy = [await frame(0, true), await frame(1)];
    S.tau = 0;
    S.view.refresh();
    S.view.settle(false);
    if (S.project.zdjecie?.url) {
      try {
        const bmp = await createImageBitmap(await (await fetch(S.project.zdjecie.url)).blob());
        const c = document.createElement('canvas');
        const sc = Math.min(1, 1000 / bmp.width);
        c.width = Math.round(bmp.width * sc);
        c.height = Math.round(bmp.height * sc);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        obrazy.push(c.toDataURL('image/jpeg', 0.8));
      } catch {
        /* bez zdjecia przeglad i tak widzi model */
      }
    }
    const ops = await api('/api/studio/review', json({ projekt: S.project, obrazy }));
    const zlaObudowa = ops.obudowa_ok === false ? ops.uwaga_obudowa || 'nie przypomina tego przedmiotu.' : '';
    if (!ops.zmien.length && !ops.dodaj.length) return { puste: true, zlaObudowa };
    ops.zmien.forEach((e) => delete S.refined[e.id]);
    const made = K.applyOps(S.project, ops);
    // Zmiana po kontroli nie moze cofnac dopasowania do obudowy.
    const shell = made.czesci.filter((c) => c.skora);
    if (shell.length) made.czesci = [...K.fitInside(made.czesci.filter((c) => !c.skora), shell).czesci, ...shell];
    commit(made);
    return { ops, zlaObudowa };
  }
  async function design(opis, szukaj) {
    const text = String(opis || '').trim();
    if (!text) return;
    await waitReady();
    S.job = { etap: 'Zaczynam', postep: 2, opis: text };
    S.redraw();
    try {
      const body = { opis: text };
      if (szukaj != null) body.szukaj = szukaj;
      const start = await api('/api/studio/design', json(body));
      emit(`Studio 3D: ${start.szukaj ? 'szukam planów i projektuję' : 'projektuję'}: ${text.slice(0, 60)}`);
      let toldSources = false;
      let outline = null;
      let outlineSent = false;
      let outlineWhy = '';
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await api(`/api/studio/job/${start.id}`);
        S.job = { ...j, opis: text };
        S.drawJob?.();
        if (j.stan === 'obrys' && !outlineSent) {
          outlineSent = true;
          const setStage = (etap) => {
            S.job = { ...S.job, etap };
            S.drawJob?.();
          };
          try {
            outline = await autoOutline(j, j.plan?.nazwa || text, setStage);
            emit(`Studio 3D: obudowa odrysowana, ${outline.czesci.length} części.`);
          } catch (e) {
            outline = null; // zostaje projekt z samego opisu, a ostrzezenie mowi o tym wprost
            outlineWhy = e.niesprawdzone ? 'Gemini był przeciążony i nie dało się sprawdzić, czy zdjęcia pokazują ten przedmiot, więc ich nie użyłem. Wygląd powstał z samego opisu: spróbuj ponownie za chwilę.' : '';
          }
          const round = (v) => Math.round(v);
          const brief = outline ? outline.czesci.map((c) => {
            const b = K.boundsOf(K.worldMesh(K.normalizePart(c)));
            return { nazwa: c.nazwa, od: b.lo.map(round), do: b.hi.map(round) };
          }) : [];
          await api(`/api/studio/job/${start.id}/outline`, json({ czesci: brief })).catch(() => {
            outline = null;
          });
          continue;
        }
        if (j.zrodla?.length && !toldSources) {
          toldSources = true;
          if (UI.isLive?.()) UI.liveSend({ type: 'note', text: `[UI] Znalezione źródła do projektu: ${j.zrodla.slice(0, 5).map((z) => z.tytul).join('; ')}. Rysunków: ${j.plany?.length || 0}.` });
        }
        if (j.stan === 'blad') throw new Error(j.etap);
        if (j.stan === 'gotowe') {
          setProject(outline ? mergeOutline(j.projekt, outline) : j.projekt);
          if (!outline) S.warnings = [...(j.ostrzezenia || []), outlineWhy || 'Nie znalazłem zdjęcia tego przedmiotu: wygląd powstał z samego opisu. Podaj zdjęcie w ODRYSUJ ZE ZDJĘCIA, a będzie dokładny.'];
          else S.warnings = [...S.warnings.filter((w) => !/kroków/.test(w)), ...(j.ostrzezenia || []).filter((w) => /zawiódł/.test(w))];
          const notes = S.warnings.slice();
          if (outline) {
            const fit = outline.dopasowanie;
            if (outline.zdjecie.strona) notes.push(`Obudowa ze zdjęcia: ${new URL(outline.zdjecie.strona).hostname}. Inny przedmiot? Podaj własne zdjęcie.`);
            if (fit?.przesuniete.length) notes.push(`Dopasowałem do obudowy: ${fit.przesuniete.slice(0, 5).join(', ')}.`);
            if (fit?.wystaje.length) notes.push(`Nie mieści się w obudowie: ${fit.wystaje.slice(0, 5).join(', ')}. Użyj DOPRACUJ przy tym podzespole.`);
            if (outline.t.pokrycie < 0.97) notes.push(`Część obrysu ze zdjęcia nie weszła do modelu (pokrycie ${Math.round(outline.t.pokrycie * 100)}%).`);
          }
          try {
            const review = await reviewPass((etap) => {
              S.job = { etap, postep: 96, opis: text };
              S.drawJob?.();
            });
            if (review?.ops?.co_zmieniono) notes.push(`Kontrola na renderach: ${review.ops.co_zmieniono}`);
            if (review?.zlaObudowa) notes.push(`Kształt zewnętrzny wyszedł źle: ${review.zlaObudowa} Podaj własne zdjęcie w ODRYSUJ ZE ZDJĘCIA.`);
          } catch (e) {
            notes.push(`Kontrola na renderach się nie udała: ${e.message}. Projekt jest bez niej.`);
          }
          // commit w kontroli liczy ostrzezenia od nowa, wiec te z projektowania dokladamy na koncu.
          S.warnings = [...new Set([...S.warnings, ...notes])];
          S.job = null;
          S.tab = 'czesci';
          S.redraw();
          const m = K.measure(S.project);
          if (S.project.obrazy?.length) toast('Znalazłem zdjęcia. Żeby wygląd był 1:1, użyj ODRYSUJ w zakładce PLANY.', 'ok');
          const note = `Projekt gotowy: ${S.project.nazwa}. ${S.project.czesci.length} części, ${K.stepNumbers(S.project).length} kroków montażu.`;
          emit(note, { react: false, important: true });
          if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `${note} Wymiary ${m.size.map((v) => Math.round(v)).join(' x ')} mm${S.project.skala > 1 ? `, skala 1:${S.project.skala}` : ''}. ${S.project.uwagi ? `Uwagi: ${S.project.uwagi}` : ''} Powiedz to krótko, zaznacz, co jest szacunkiem, a co z planów, i zapytaj, czy pokazać rozbieranie.` });
          saveVersion('po zaprojektowaniu');
          setTimeout(() => play(1), 1400);
          if (S.blender.auto) autoBlender();
          return;
        }
      }
    } catch (e) {
      S.job = null;
      S.redraw();
      toast(e.message || 'Nie udało się zaprojektować.');
      if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `Projektowanie się nie udało: ${e.message}. Powiedz to krótko.` });
    }
  }
  async function aiEdit(polecenie) {
    if (!S.project) return toast('Najpierw otwórz albo zaprojektuj model.');
    const ops = await api('/api/studio/edit', json({ projekt: S.project, polecenie }));
    (ops.usun || []).forEach((id) => delete S.refined[id]);
    (ops.zmien || []).forEach((e) => delete S.refined[e.id]);
    commit(K.applyOps(S.project, ops));
    toast(ops.co_zmieniono, 'ok');
    if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `Zmieniono projekt: ${ops.co_zmieniono} Powiedz to krótko.` });
    return ops;
  }

  // ---------- Blender ----------
  async function blenderAction(name, params, options) {
    const r = await desktop().runAction(name, params, options);
    if (r?.requiresEdithConfirmation) throw new Error('E.D.I.T.H. czeka na potwierdzenie tej operacji: zmień tryb uprawnień albo potwierdź.');
    return r;
  }
  async function blenderRefresh() {
    if (!desktop()?.runAction) return;
    const r = await blenderAction('blender-status').catch(() => null);
    S.blender.status = r?.ok ? r : { nieobslugiwany: true };
    S.drawBlender?.();
  }
  async function blenderInstall() {
    if (!confirm('Pobrać Blendera 4.5 LTS z blender.org? Około 380 MB pobierania i 1,2 GB na dysku z największą ilością miejsca.')) return;
    S.blender.busy = true;
    const timer = setInterval(async () => {
      const st = await blenderAction('blender-postep').catch(() => null);
      if (st) {
        S.blender.progress = st;
        S.drawBlender?.();
      }
    }, 800);
    try {
      const r = await blenderAction('blender-instaluj', {}, { confirmedByEdith: true });
      if (!r.ok) throw new Error(r.error);
      toast('Blender zainstalowany.', 'ok');
    } catch (e) {
      toast(e.message);
    }
    clearInterval(timer);
    S.blender.busy = false;
    S.blender.progress = null;
    await blenderRefresh();
  }
  function blenderPayload(opcje) {
    const pr = S.project;
    const m = K.measure(pr);
    const vec = K.explodeVectors(pr, m);
    return {
      nazwa: pr.nazwa,
      skala: pr.skala,
      rozmiar: m.span,
      opcje,
      czesci: pr.czesci.map((p) => ({
        id: p.id, nazwa: p.nazwa, grupa: p.grupa, krok: p.krok, kolor: p.kolor, metal: p.metal, szorstkosc: p.szorstkosc,
        faza: p.faza, gladki: p.gladki, ciecie: p.ciecie, skora: p.skora, oble: p.oble, x: p.x, y: p.y, z: p.z, rx: p.rx, ry: p.ry, rz: p.rz,
        rozst: vec[p.id], siatka: K.partMesh(p).map((v) => Math.round(v * 1000) / 1000),
      })),
    };
  }
  const b64buf = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;
  async function blenderBuild(opcje = {}) {
    if (!S.project || S.blender.busy) return;
    S.blender.busy = true;
    S.drawBlender?.();
    const timer = setInterval(async () => {
      const st = await blenderAction('blender-postep').catch(() => null);
      if (st) {
        S.blender.progress = st;
        S.drawBlender?.();
      }
    }, 1000);
    const forProject = S.project;
    try {
      const payload = blenderPayload({ render: true, stl: true, probki: 48, ...opcje });
      if (S.project.zdjecie) {
        const z = S.project.zdjecie;
        payload.zdjecie = { k: z.k, cx: z.cx, cy: z.cy, flip: z.flip, w: z.w, h: z.h };
        payload.zdjecie_b64 = await photoBlob(z.url).then(async (b) => {
          // Blender czyta PNG, a sklepy czesto daja WebP.
          const bmp = await createImageBitmap(b);
          const cv = document.createElement('canvas');
          cv.width = bmp.width;
          cv.height = bmp.height;
          cv.getContext('2d').drawImage(bmp, 0, 0);
          return blobToB64(await new Promise((res) => cv.toBlob(res, 'image/png')));
        }).catch(() => null);
        if (!payload.zdjecie_b64) delete payload.zdjecie;
      }
      const r = await blenderAction('blender-buduj', payload);
      if (!r.ok) throw new Error(r.error);
      if (S.project !== forProject) return; // uzytkownik przeszedl do innego projektu
      S.blender.result = { ...S.blender.result, ...r };
      if (r.glb && S.view) {
        const found = await S.view.absorbGlb(b64buf(r.glb), r.sf);
        S.refined = found;
        S.view.setProject(S.project, true);
      }
      if (r.wideo) {
        if (S.blender.videoUrl) URL.revokeObjectURL(S.blender.videoUrl);
        S.blender.videoUrl = URL.createObjectURL(new Blob([b64buf(r.wideo)], { type: 'video/mp4' }));
      }
      delete S.blender.result.glb;
      delete S.blender.result.wideo;
      const note = `Blender ${r.wersja || ''} skończył: ${S.project.nazwa}${r.wideo_sciezka ? ', z wideo rozbierania' : ''}.`;
      emit(note);
      if (UI.isLive?.()) UI.liveSend({ type: 'note', text: `[UI] ${note} Pliki w folderze: ${r.folder}.` });
      S.redraw();
    } catch (e) {
      if (!/Anulowano/.test(e.message)) toast(e.message);
    } finally {
      clearInterval(timer);
      S.blender.busy = false;
      S.blender.progress = null;
      S.drawBlender?.();
    }
  }
  async function autoBlender() {
    if (!desktop()?.runAction) return;
    if (!S.blender.status) await blenderRefresh();
    if (S.blender.status?.zainstalowany) blenderBuild();
  }

  // ---------- eksport ----------
  function downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fileName = (ext) => `${(S.project?.nazwa || 'projekt').replace(/[^\w\u0080-ɏ-]+/g, '_')}.${ext}`;
  function exportStl(onlySelected) {
    const parts = S.project.czesci.filter((p) => !p.ciecie && !S.hidden.has(p.id) && (!onlySelected || p.id === S.selected));
    if (!parts.length) return toast('Wybierz część.');
    const buf = K.stlBinary(parts.map((p) => S.view.worldArray(p)), S.project.skala, S.project.nazwa);
    downloadBlob(fileName('stl'), new Blob([buf], { type: 'model/stl' }));
  }

  // ---------- panel ----------
  const FIELDS = { boczny: ['gr', 'faza', 'zaokr'], gwint: ['r', 'h', 'skok'], zespol: [], pudelko: ['sx', 'sy', 'sz', 'faza'], klin: ['sx', 'sy', 'sz'], walec: ['r', 'r2', 'h', 'faza'], rura: ['r', 'ri', 'h'], kula: ['r'], torus: ['R', 'r'], pryzmat: ['n', 'r', 'h'], sruba: ['r', 'h'], plyta: ['sx', 'sy', 'sz', 'faza'], wyciagniecie: ['h', 'faza'], obrotowa: [], loft: [], rurka: ['r'], sprezyna: ['R', 'r', 'skok', 'zwoje'], kolo_zebate: ['zeby', 'm', 'h', 'otwor'] };
  const FIELD_NAMES = { sx: 'szer. X', sy: 'wys. Y', sz: 'gł. Z', r: 'promień', r2: 'promień góra', ri: 'promień wewn.', h: 'wysokość', R: 'promień duży', n: 'boki', skok: 'skok', zwoje: 'zwoje', zeby: 'zęby', m: 'moduł', otwor: 'otwór', faza: 'faza', gr: 'grubość', zaokr: 'zaokrąglenie' };
  const SHAPE_NAMES = { pudelko: 'Prostopadłościan', walec: 'Walec / stożek', rura: 'Rura', kula: 'Kula', torus: 'Pierścień', klin: 'Klin', pryzmat: 'Graniastosłup', sruba: 'Śruba', plyta: 'Płyta', wyciagniecie: 'Profil', obrotowa: 'Bryła obrotowa', loft: 'Kadłub (loft)', rurka: 'Rurka', sprezyna: 'Sprężyna', kolo_zebate: 'Koło zębate', boczny: 'Obrys z boku', gwint: 'Pręt z gwintem' };
  const MACRO_NAMES = { sruba: 'Śruba', nakretka: 'Nakrętka', podkladka: 'Podkładka', kolek: 'Kołek', lozysko: 'Łożysko', szyna_picatinny: 'Szyna Picatinny', panel_mlok: 'Panel M-LOK', aeg_gearbox_v2: 'Gearbox V2 (komplet)', aeg_silnik: 'Silnik AEG', aeg_hopup: 'Komora hop-up', aeg_lufa: 'Lufy z gwintem', aeg_magazynek: 'Magazynek AEG' };
  function newPartDefaults(ksztalt, u) {
    return {
      pudelko: { sx: u * 2, sy: u * 2, sz: u * 2 },
      walec: { r: u, h: u * 2 },
      rura: { r: u, ri: u * 0.7, h: u * 2 },
      kula: { r: u },
      torus: { R: u, r: u * 0.25 },
      klin: { sx: u * 2, sy: u * 2, sz: u * 2 },
      pryzmat: { n: 6, r: u, h: u },
      sruba: { r: u * 0.25, h: u * 1.5 },
      plyta: { sx: u * 3, sy: u * 0.3, sz: u * 2 },
      wyciagniecie: { kontur: [[-u, -u], [u, -u], [u, 0], [0, u], [-u, u]], h: u * 0.5 },
      obrotowa: { profil: [[0, -u], [u, -u * 0.6], [u * 0.5, u * 0.2], [u * 0.8, u], [0, u]], gladki: true },
      loft: { przekroje: [{ p: -u * 2, a: u * 0.3, b: u * 0.3 }, { p: 0, typ: 'zaokraglony', a: u, b: u * 0.7 }, { p: u * 2, a: u * 0.2, b: u * 0.2 }], gladki: true },
      rurka: { r: u * 0.1, sciezka: [[-u, 0, 0], [0, u * 0.6, 0], [u, 0, u * 0.4]] },
      sprezyna: { R: u * 0.5, r: u * 0.07, skok: u * 0.3, zwoje: 6 },
      kolo_zebate: { zeby: 24, m: Math.max(0.1, (u * 2) / 24), h: u * 0.4, otwor: u * 0.2 },
      boczny: { kontur: [[-u, -u], [u, -u], [u, u * 0.3], [0, u], [-u, u]], gr: u * 0.5, zaokr: u * 0.1, faza: u * 0.03 },
      gwint: { r: u * 0.2, h: u * 1.5, skok: u * 0.1 },
    }[ksztalt];
  }

  const panel = {
    title: 'STUDIO 3D: PROJEKT, PLANY, ANIMACJA, BLENDER',
    glyph: '⬡',
    wide: true,
    build(body) {
      if (!isOwner()) {
        body.textContent = 'Dostępne tylko dla właściciela.';
        return;
      }
      S.view?.destroy();
      S.view = null;
      body.innerHTML = '';
      const wrap = el('div', 'st-wrap');
      const head = el('div', 'st-head');
      const prompt = el('input', 'inp');
      prompt.placeholder = 'Co projektujemy? np. replika Sokoła Millennium, silnik V8, rower, zamek średniowieczny';
      const research = el('label', 'st-check');
      const rcheck = el('input');
      rcheck.type = 'checkbox';
      research.append(rcheck, document.createTextNode(' szukaj planów'));
      const goBtn = el('button', 'btn primary', 'ZAPROJEKTUJ');
      head.append(prompt, research, goBtn);
      const chips = el('div', 'st-chips');
      chips.appendChild(el('span', 'w-dim', 'Gotowe:'));
      (T?.LIST || []).forEach((t) => {
        const c = el('button', 'cad-tool', t.nazwa);
        c.title = t.sub;
        c.addEventListener('click', () => {
          setProject(t.make());
          setTimeout(() => play(1), 800);
        });
        chips.appendChild(c);
      });
      const photoBtn = el('button', 'cad-tool on', '📷 ODRYSUJ ZE ZDJĘCIA 1:1');
      chips.appendChild(photoBtn);
      const photoForm = el('div', 'st-photo');
      photoForm.hidden = true;
      const photoHint = el('div', 'w-dim', 'Zdjęcie z boku, cały przedmiot, jednolite tło. Skalę daje prawdziwa długość.');
      const photoFile = el('input');
      photoFile.type = 'file';
      photoFile.accept = 'image/*';
      const photoUrl = el('input', 'inp');
      photoUrl.placeholder = 'albo adres zdjęcia https://…';
      const photoLen = el('input', 'inp');
      photoLen.type = 'number';
      photoLen.placeholder = 'długość mm';
      const photoName = el('input', 'inp');
      photoName.placeholder = 'nazwa, np. M4 CQB';
      const photoGo = el('button', 'btn primary', 'ODRYSUJ');
      const photoRow = el('div', 'st-row');
      photoRow.append(photoFile, photoUrl, photoLen, photoName, photoGo);
      const topFile = el('input');
      topFile.type = 'file';
      topFile.accept = 'image/*';
      const topRow = el('div', 'st-row');
      topRow.append(el('span', 'w-dim', 'Opcjonalnie zdjęcie z góry (prawdziwa szerokość):'), topFile);
      photoForm.append(photoHint, photoRow, topRow);
      S.openPhoto = (u, len) => {
        photoForm.hidden = false;
        if (u) photoUrl.value = u;
        if (len) photoLen.value = String(Math.round(len));
      };
      photoBtn.addEventListener('click', () => {
        photoForm.hidden = !photoForm.hidden;
      });
      photoGo.addEventListener('click', async () => {
        const blob = photoFile.files?.[0];
        const url = photoUrl.value.trim();
        if (!blob && !url) return toast('Wybierz zdjęcie albo podaj adres.');
        photoGo.disabled = true;
        photoGo.textContent = 'ODRYSOWUJĘ...';
        try {
          await fromPhoto({ blob, url, dlugosc: photoLen.value, nazwa: photoName.value.trim() || prompt.value.trim(), topBlob: topFile.files?.[0] });
          photoForm.hidden = true;
        } catch (e) {
          toast(e.message || 'Nie udało się odrysować.');
        }
        photoGo.disabled = false;
        photoGo.textContent = 'ODRYSUJ';
        return undefined;
      });
      const jobBox = el('div', 'st-job');
      jobBox.hidden = true;
      const jobBar = el('div', 'st-job-bar');
      const jobFill = el('i');
      jobBar.appendChild(jobFill);
      const jobText = el('div', 'w-dim');
      jobBox.append(jobText, jobBar);

      const stage = el('div', 'st-stage');
      const left = el('div', 'st-left');
      const host = el('div', 'st-view');
      const empty = el('div', 'st-empty', 'Powiedz Jarvisowi, co zbudować, wpisz to wyżej albo wybierz gotowy projekt.');
      host.appendChild(empty);
      const caption = el('div', 'st-caption');
      caption.hidden = true;

      // Os montazu
      const tl = el('div', 'st-timeline');
      const row1 = el('div', 'st-row');
      const btnApart = el('button', 'btn primary', '▶ ROZBIERZ');
      const btnBuild = el('button', 'btn ghost', '◀ ZŁÓŻ');
      const btnZero = el('button', 'btn ghost', '⬢ BUDUJ OD ZERA');
      const btnStop = el('button', 'btn ghost', '❚❚');
      const seek = el('input', 'st-seek');
      seek.type = 'range';
      seek.min = '0';
      seek.max = '1000';
      seek.value = '0';
      const stepLabel = el('span', 'st-step');
      row1.append(btnApart, btnBuild, btnZero, btnStop, seek, stepLabel);
      const row2 = el('div', 'cad-tools');
      const toggle = (label, get, set, title) => {
        const b = el('button', `cad-tool${get() ? ' on' : ''}`, label);
        if (title) b.title = title;
        b.addEventListener('click', () => {
          set(!get());
          b.classList.toggle('on', get());
          S.view?.refresh();
        });
        row2.appendChild(b);
        return b;
      };
      const styleBtns = [['real', 'BRYŁA'], ['holo', 'HOLOGRAM'], ['xray', 'RENTGEN']].map(([k, label]) => {
        const b = el('button', `cad-tool${S.style === k ? ' on' : ''}`, label);
        b.addEventListener('click', () => {
          S.style = k;
          styleBtns.forEach(([kk, bb]) => bb.classList.toggle('on', kk === k));
          S.view?.setStyle();
        });
        row2.appendChild(b);
        return [k, b];
      });
      toggle('NARAZ', () => S.together, (v) => { S.together = v; }, 'Wszystkie części rozsuwają się razem, zamiast po kolei');
      toggle('ETYKIETY', () => S.labels, (v) => { S.labels = v; });
      toggle('LEKTOR', () => S.lector, (v) => { S.lector = v; }, 'Jarvis czyta kroki podczas animacji');
      const lab = (t, inp) => {
        const w = el('label', 'cad-cut', `${t} `);
        w.appendChild(inp);
        row2.appendChild(w);
      };
      const spread = el('input');
      spread.type = 'range';
      spread.min = '30';
      spread.max = '300';
      spread.value = String(S.spread * 100);
      spread.addEventListener('input', () => {
        S.spread = Number(spread.value) / 100;
        S.view?.refresh();
      });
      lab('ROZSUNIĘCIE', spread);
      const speed = el('input');
      speed.type = 'range';
      speed.min = '25';
      speed.max = '300';
      speed.value = String(S.speed * 100);
      speed.addEventListener('input', () => {
        S.speed = Number(speed.value) / 100;
      });
      lab('TEMPO', speed);
      // Przekroj modelu: pokazuje budowe w srodku bez rozbierania.
      const clip = { axis: null, t: 0.5 };
      S.clip = clip;
      const clipBtn = el('button', 'cad-tool', 'PRZEKRÓJ');
      const clipIn = el('input');
      clipIn.type = 'range';
      clipIn.min = '0';
      clipIn.max = '100';
      clipIn.value = '50';
      const applyClip = () => {
        S.view?.setClip(clip.axis, clip.t);
        clipBtn.classList.toggle('on', Boolean(clip.axis));
        clipBtn.textContent = clip.axis ? `PRZEKRÓJ ${clip.axis.toUpperCase()}` : 'PRZEKRÓJ';
      };
      clipBtn.title = 'Kolejne kliknięcia: oś Z, X, Y, wyłącz';
      clipBtn.addEventListener('click', () => {
        clip.axis = { null: 'z', z: 'x', x: 'y', y: null }[String(clip.axis)];
        applyClip();
        if (clip.axis) S.view?.lookAlong(clip.axis);
      });
      clipIn.addEventListener('input', () => {
        clip.t = Number(clipIn.value) / 100;
        if (!clip.axis) clip.axis = 'z';
        applyClip();
      });
      row2.appendChild(clipBtn);
      // Miarka: dwa klikniecia na modelu daja odleglosc w mm (w skali 1:1, a z skala modelu takze wydruku).
      const measBtn = el('button', 'cad-tool', 'MIARKA');
      measBtn.title = 'Kliknij dwa punkty na modelu';
      S.measure = { on: false, pts: [] };
      measBtn.addEventListener('click', () => {
        S.measure = { on: !S.measure.on, pts: [] };
        measBtn.classList.toggle('on', S.measure.on);
        measBtn.textContent = S.measure.on ? 'MIARKA: kliknij 2 punkty' : 'MIARKA';
        S.view?.drawMeasure([]);
      });
      row2.appendChild(measBtn);
      S.onMeasure = (p) => {
        const pts = S.measure.pts.length >= 2 ? [p] : [...S.measure.pts, p];
        S.measure.pts = pts;
        S.view?.drawMeasure(pts);
        if (pts.length === 2) {
          const d = pts[0].distanceTo(pts[1]);
          const sk = S.project?.skala || 1;
          const dx = Math.abs(pts[0].x - pts[1].x);
          const dy = Math.abs(pts[0].y - pts[1].y);
          const dz = Math.abs(pts[0].z - pts[1].z);
          measBtn.textContent = `${d.toFixed(1)} mm${sk > 1 ? ` (w druku ${(d / sk).toFixed(1)})` : ''}`;
          toast(`Odległość ${d.toFixed(1)} mm · X ${dx.toFixed(1)} · Y ${dy.toFixed(1)} · Z ${dz.toFixed(1)}${S.tau > 0.02 ? ' (model jest rozłożony: mierz na złożonym)' : ''}`, 'ok');
        } else measBtn.textContent = 'MIARKA: drugi punkt';
      };
      lab('CIĘCIE', clipIn);
      S.clip = clip;
      S.applyClip = applyClip;
      const png = el('button', 'cad-tool', 'PNG');
      png.addEventListener('click', () => {
        if (!S.view) return;
        const a = document.createElement('a');
        a.href = S.view.png();
        a.download = fileName('png');
        a.click();
      });
      row2.appendChild(png);
      tl.append(row1, row2);
      left.append(host, caption, tl);

      // Boczny panel
      const side = el('div', 'st-side');
      const tabs = el('div', 'st-tabs');
      const pane = el('div', 'st-pane');
      const TABS = [['czesci', 'CZĘŚCI'], ['edycja', 'EDYCJA'], ['kroki', 'KROKI'], ['plany', 'PLANY'], ['blender', 'BLENDER'], ['pliki', 'PLIKI']];
      const tabBtns = {};
      TABS.forEach(([id, label]) => {
        const b = el('button', 'st-tab', label);
        b.addEventListener('click', () => {
          S.tab = id;
          S.redraw();
        });
        tabBtns[id] = b;
        tabs.appendChild(b);
      });
      side.append(tabs, pane);
      stage.append(left, side);
      wrap.append(head, chips, photoForm, jobBox, stage);
      body.appendChild(wrap);

      // Zdarzenia
      const submit = () => {
        const t = prompt.value.trim();
        if (t) design(t, rcheck.checked ? true : undefined);
      };
      goBtn.addEventListener('click', submit);
      prompt.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      btnApart.addEventListener('click', () => play(1));
      btnBuild.addEventListener('click', () => play(-1));
      btnZero.addEventListener('click', () => {
        S.tau = 1;
        play(-1, { fromZero: true });
      });
      btnStop.addEventListener('click', () => {
        S.playing = 0;
      });
      seek.addEventListener('input', () => {
        S.playing = 0;
        S.fromZero = false;
        S.tau = Number(seek.value) / 1000;
        S.view?.refresh();
        S.view?.frameExploded(S.tau > 0.02);
        S.drawTimeline();
      });

      S.drawTimeline = () => {
        if (!S.project) return;
        if (document.activeElement !== seek || S.playing) seek.value = String(Math.round(S.tau * 1000));
        const t = K.timeline(S.project, S.tau);
        const pos = S.tau >= 1 ? t.steps.length : S.tau <= 0 ? 0 : t.stepIndex + 1;
        stepLabel.textContent = `${pos} / ${t.steps.length}`;
        btnStop.disabled = !S.playing;
        const k = S.project.kroki.find((x) => x.nr === t.step);
        const show = S.tau > 0 && S.tau < 1 && k;
        caption.hidden = !show;
        if (show) {
          caption.innerHTML = '';
          caption.append(el('b', null, `Krok ${k.nr}: ${k.tytul}`), document.createTextNode(k.opis ? ` ${k.opis}` : ''));
        }
      };
      S.drawJob = () => {
        jobBox.hidden = !S.job;
        goBtn.disabled = Boolean(S.job);
        if (!S.job) return;
        jobText.textContent = S.job.etap || 'Pracuję';
        jobFill.style.width = `${S.job.postep || 3}%`;
        if (S.tab === 'plany' && S.job.zrodla && !S.project) S.redraw();
      };

      // ---------- zakladki ----------
      function drawParts() {
        const pr = S.project;
        const m = K.measure(pr);
        const stats = el('div', 'st-stats');
        const realSize = m.size.map((v) => Math.round(v)).join(' × ');
        const scaled = m.size.map((v) => Math.round((v / pr.skala) * 10) / 10).join(' × ');
        const g = Math.round(K.massG(pr, m));
        [['CZĘŚCI', pr.czesci.filter((p) => !p.ciecie).length], ['KROKI', K.stepNumbers(pr).length], ['WYMIARY', `${realSize} mm`], ...(pr.skala > 1 ? [[`W SKALI 1:${pr.skala}`, `${scaled} mm`]] : []), ['MASA PEŁNEGO WYDRUKU', `${g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${g} g`} (PLA)`], ['TRÓJKĄTY', m.triangles]].forEach(([k, v]) => {
          const r = el('div', 'kv');
          r.append(el('span', null, k), el('b', null, String(v)));
          stats.appendChild(r);
        });
        pane.appendChild(stats);
        if (pr.opis) pane.appendChild(el('div', 'w-dim st-desc', pr.opis));
        S.warnings.forEach((w) => pane.appendChild(el('div', 'st-warn', `⚠ ${w}`)));
        const groups = new Map();
        pr.czesci.forEach((p) => {
          if (!groups.has(p.grupa)) groups.set(p.grupa, []);
          groups.get(p.grupa).push(p);
        });
        for (const [name, list] of groups) {
          const gh = el('div', 'st-group');
          const allHidden = list.every((p) => S.hidden.has(p.id));
          const eye = el('button', 'cad-tool', allHidden ? 'POKAŻ' : 'UKRYJ');
          eye.addEventListener('click', () => {
            list.forEach((p) => (allHidden ? S.hidden.delete(p.id) : S.hidden.add(p.id)));
            S.view?.refresh();
            S.redraw();
          });
          const only = el('button', 'cad-tool', 'TYLKO TO');
          only.addEventListener('click', () => {
            S.hidden = new Set(pr.czesci.filter((p) => p.grupa !== name).map((p) => p.id));
            S.view?.refresh();
            S.redraw();
          });
          const better = el('button', 'cad-tool', 'DOPRACUJ');
          better.title = 'Jarvis przebuduje ten podzespół szczegółowo';
          better.addEventListener('click', async () => {
            better.disabled = true;
            better.textContent = 'PRACUJĘ...';
            try {
              const ops = await api('/api/studio/refine', json({ projekt: S.project, grupa: name }));
              ops.usun.forEach((id) => delete S.refined[id]);
              commit(K.applyOps(S.project, ops));
              toast(ops.co_zmieniono, 'ok');
            } catch (e) {
              toast(e.message || 'Nie udało się.');
              better.disabled = false;
              better.textContent = 'DOPRACUJ';
            }
          });
          gh.append(el('b', null, `${name} (${list.length})`), eye, only, better);
          pane.appendChild(gh);
          list.forEach((p) => {
            const row = el('div', `st-part${p.id === S.selected ? ' on' : ''}${S.hidden.has(p.id) ? ' off' : ''}`);
            const dot = el('i', 'st-dot');
            dot.style.background = p.kolor;
            const badge = el('span', `st-src ${p.zrodlo}`, p.skora ? 'zdjęcie' : p.zrodlo === 'plany' ? 'plany' : 'szac.');
            row.append(dot, el('span', 'st-name', p.nazwa), el('span', 'w-dim', `k.${p.krok}`), badge);
            row.addEventListener('click', () => select(p.id === S.selected ? null : p.id));
            pane.appendChild(row);
          });
        }
        if (S.hidden.size) {
          const all = el('button', 'btn ghost', 'POKAŻ WSZYSTKO');
          all.addEventListener('click', () => {
            S.hidden.clear();
            S.view?.refresh();
            S.redraw();
          });
          pane.appendChild(all);
        }
      }
      function numberField(label, value, onChange, step) {
        const w = el('label', 'st-field');
        const i = el('input', 'inp');
        i.type = 'number';
        i.step = step || 'any';
        i.value = String(Math.round(Number(value) * 100) / 100);
        i.addEventListener('change', () => onChange(Number(i.value)));
        w.append(el('span', null, label), i);
        return w;
      }
      function drawEdit() {
        const undoBar = el('div', 'cad-tools');
        const bu = el('button', 'cad-tool', '↶ COFNIJ');
        bu.disabled = !S.history.length;
        bu.addEventListener('click', () => undo(-1));
        const br = el('button', 'cad-tool', '↷ PONÓW');
        br.disabled = !S.future.length;
        br.addEventListener('click', () => undo(1));
        undoBar.append(bu, br);
        pane.appendChild(undoBar);
        // Polecenie dla Jarvisa
        pane.appendChild(el('div', 'st-sub', 'POWIEDZ, CO ZMIENIĆ'));
        const ask = el('div', 'st-row');
        const ai = el('input', 'inp');
        ai.placeholder = 'np. dodaj śmigło z tyłu, wydłuż kadłub o 20%, usuń ogon';
        const send = el('button', 'btn primary', 'ZRÓB');
        const runAi = async () => {
          const t = ai.value.trim();
          if (!t) return;
          send.disabled = true;
          send.textContent = '...';
          try {
            await aiEdit(t);
          } catch (e) {
            toast(e.message || 'Nie udało się.');
            send.disabled = false;
            send.textContent = 'ZRÓB';
          }
        };
        send.addEventListener('click', runAi);
        ai.addEventListener('keydown', (e) => e.key === 'Enter' && runAi());
        ask.append(ai, send);
        pane.appendChild(ask);

        // Dodawanie
        pane.appendChild(el('div', 'st-sub', 'DODAJ ELEMENT'));
        const addRow = el('div', 'st-row');
        const kind = el('select', 'inp');
        Object.keys(K.SHAPES).filter((k) => k !== 'zespol').forEach((k) => {
          const o = el('option', null, SHAPE_NAMES[k] || k);
          o.value = k;
          kind.appendChild(o);
        });
        Object.keys(K.MACROS).forEach((k) => {
          const o = el('option', null, `▣ ${MACRO_NAMES[k] || k}`);
          o.value = `makro:${k}`;
          kind.appendChild(o);
        });
        const nameIn = el('input', 'inp');
        nameIn.placeholder = 'nazwa';
        const addBtn = el('button', 'btn ghost', 'DODAJ');
        addBtn.addEventListener('click', () => {
          const m = K.measure(S.project);
          const c = K.centerOf(m.bounds);
          const sel = selectedPart();
          const u = Math.max(0.1, m.span * 0.08);
          const ksztalt = kind.value;
          const id = `n${Date.now().toString(36)}`;
          if (ksztalt.startsWith('makro:')) {
            const before = S.project.czesci.length;
            const made = K.applyOps(S.project, { dodaj: [{ makro: ksztalt.slice(6), id, nazwa: nameIn.value.trim() || undefined, grupa: sel?.grupa || 'Dodane', x: sel ? sel.x : c[0], y: (sel ? m.items[sel.id].hi[1] : m.bounds.hi[1]) + u, z: sel ? sel.z : c[2] }] });
            commit(made);
            nameIn.value = '';
            toast(`Dodano ${made.czesci.length - before} elementów.`, 'ok');
            select(made.czesci[made.czesci.length - 1].id);
            return;
          }
          // Nowy element staje nad wybrana czescia albo nad calym modelem; dalej ustawia sie go uchwytem.
          const next = K.applyOps(S.project, { dodaj: [{ id, nazwa: nameIn.value.trim() || SHAPE_NAMES[ksztalt], grupa: sel?.grupa || 'Dodane', ksztalt, kolor: '#37c8ff', metal: 0.3, x: sel ? sel.x : c[0], y: (sel ? m.items[sel.id].hi[1] : m.bounds.hi[1]) + u, z: sel ? sel.z : c[2], ...newPartDefaults(ksztalt, u) }] });
          commit(next);
          nameIn.value = '';
          const created = next.czesci[next.czesci.length - 1];
          select(created.id);
          setGizmo('translate');
        });
        addRow.append(kind, nameIn, addBtn);
        pane.appendChild(addRow);

        const p = selectedPart();
        pane.appendChild(el('div', 'st-sub', p ? `WYBRANA: ${p.nazwa}` : 'KLIKNIJ CZĘŚĆ NA MODELU'));
        if (!p) return;
        const giz = el('div', 'cad-tools');
        [['translate', 'PRZESUŃ'], ['rotate', 'OBRÓĆ']].forEach(([mode, label]) => {
          const b = el('button', `cad-tool${S.gizmo === mode ? ' on' : ''}`, label);
          b.addEventListener('click', () => setGizmo(S.gizmo === mode ? null : mode));
          giz.appendChild(b);
        });
        const dup = el('button', 'cad-tool', 'POWIEL');
        dup.addEventListener('click', () => {
          const m = K.measure(S.project);
          const b = m.items[p.id];
          const next = K.applyOps(S.project, { dodaj: [{ ...p, id: `${p.id}_k`, nazwa: `${p.nazwa} (kopia)`, x: p.x + (b.hi[0] - b.lo[0]) * 1.2 }] });
          commit(next);
          select(next.czesci[next.czesci.length - 1].id);
        });
        const mirror = el('button', 'cad-tool', 'LUSTRO X');
        mirror.addEventListener('click', () => {
          const next = K.applyOps(S.project, { dodaj: [{ ...p, id: `${p.id}_l`, nazwa: `${p.nazwa} (lustro)`, x: -p.x, ry: -p.ry, rz: -p.rz, odb: p.odb === 'x' ? undefined : 'x' }] });
          commit(next);
        });
        const del = el('button', 'cad-tool', 'USUŃ');
        del.addEventListener('click', () => {
          S.selected = null;
          S.view?.attachGizmo(null);
          S.gizmo = null;
          delete S.refined[p.id];
          commit(K.applyOps(S.project, { usun: [p.id] }));
        });
        giz.append(dup, mirror, del);
        pane.appendChild(giz);
        const form = el('div', 'st-form');
        const nm = el('label', 'st-field st-wide');
        const nmI = el('input', 'inp');
        nmI.value = p.nazwa;
        nmI.addEventListener('change', () => commit(K.applyOps(S.project, { zmien: [{ id: p.id, nazwa: nmI.value }] })));
        nm.append(el('span', null, 'nazwa'), nmI);
        const gr = el('label', 'st-field st-wide');
        const grI = el('input', 'inp');
        grI.value = p.grupa;
        grI.addEventListener('change', () => commit(K.applyOps(S.project, { zmien: [{ id: p.id, grupa: grI.value }] })));
        gr.append(el('span', null, 'podzespół'), grI);
        const col = el('label', 'st-field');
        const colI = el('input');
        colI.type = 'color';
        colI.value = p.kolor;
        colI.addEventListener('change', () => commit(K.applyOps(S.project, { zmien: [{ id: p.id, kolor: colI.value }] })));
        col.append(el('span', null, 'kolor'), colI);
        form.append(nm, gr, col, numberField('krok', p.krok, (v) => commit(K.applyOps(S.project, { zmien: [{ id: p.id, krok: v }] })), '1'));
        const mf = (key, label) => numberField(label, p[key], (v) => commit(K.applyOps(S.project, { zmien: [{ id: p.id, [key]: v }] })));
        [['x', 'X'], ['y', 'Y'], ['z', 'Z'], ['rx', 'obrót X°'], ['ry', 'obrót Y°'], ['rz', 'obrót Z°']].forEach(([k, l]) => form.appendChild(mf(k, l)));
        (FIELDS[p.ksztalt] || []).forEach((k) => {
          if (p[k] !== undefined || k === 'faza') form.appendChild(numberField(FIELD_NAMES[k] || k, p[k] ?? 0, (v) => editPart(p.id, { [k]: v })));
        });
        form.append(numberField('metal 0-1', p.metal, (v) => commit(K.applyOps(S.project, { zmien: [{ id: p.id, metal: v }] }))), numberField('szorstkość 0-1', p.szorstkosc, (v) => commit(K.applyOps(S.project, { zmien: [{ id: p.id, szorstkosc: v }] }))));
        pane.appendChild(form);
        const note = el('textarea', 'inp');
        note.placeholder = 'Notatka do tej części (np. „wydrukować z PETG”, „śruba M3x12”)';
        note.value = p.opis || '';
        note.rows = 2;
        note.style.cssText = 'width:100%;margin-top:6px;resize:vertical';
        note.addEventListener('change', () => commit(K.applyOps(S.project, { zmien: [{ id: p.id, opis: note.value.slice(0, 300) }] })));
        pane.appendChild(note);
      }
      function drawSteps() {
        const pr = S.project;
        if (!pr.kroki.length) pane.appendChild(el('div', 'w-empty', 'Ten projekt nie ma opisanych kroków.'));
        const steps = K.stepNumbers(pr);
        steps.forEach((nr) => {
          const k = pr.kroki.find((x) => x.nr === nr) || { nr, tytul: `Krok ${nr}`, opis: '' };
          const row = el('div', 'st-stepitem');
          const names = pr.czesci.filter((p) => p.krok === nr && !p.ciecie).map((p) => p.nazwa);
          const text = el('div');
          text.append(el('b', null, `${nr}. ${k.tytul}`), el('div', 'w-dim', k.opis), el('div', 'w-dim st-names', names.slice(0, 6).join(', ') + (names.length > 6 ? ` i ${names.length - 6} innych` : '')));
          row.appendChild(text);
          row.addEventListener('click', () => goToStep(nr));
          pane.appendChild(row);
        });
      }
      function drawPlans() {
        const pr = S.project;
        const src = pr || {};
        const zrodla = src.zrodla?.length ? src.zrodla : S.job?.zrodla || [];
        const plany = src.plany?.length ? src.plany : S.job?.plany || [];
        if (src.uwagi) pane.appendChild(el('div', 'st-warn', src.uwagi));
        if (pr?.realny) {
          const all = pr.czesci.length || 1;
          const fromPlans = pr.czesci.filter((p) => p.zrodlo === 'plany').length;
          pane.appendChild(el('div', 'w-dim st-desc', `Z planów: ${fromPlans} z ${all} części. Reszta to szacunek: nie traktuj tych wymiarów jako dokumentacji.`));
        }
        if (src.zdjecie) {
          pane.appendChild(el('div', 'st-sub', 'ZDJĘCIE-WZÓR'));
          const a = el(src.zdjecie.strona ? 'a' : 'div', 'st-link', src.zdjecie.tytul || 'Zdjęcie użyte do odrysu');
          if (src.zdjecie.strona) {
            a.href = src.zdjecie.strona;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          }
          pane.append(a, el('div', 'w-dim', `${src.zdjecie.k.toFixed(2)} mm na piksel. Obrys z boku pochodzi z tego zdjęcia.`));
        }
        if (src.obrazy?.length && !src.zdjecie) {
          pane.appendChild(el('div', 'st-sub', 'ZDJĘCIA Z SIECI DO ODRYSU 1:1'));
          src.obrazy.forEach((u, i) => {
            const b = el('button', 'btn ghost', `ODRYSUJ Z OBRAZU ${i + 1}`);
            b.title = u;
            b.addEventListener('click', () => S.openPhoto(u));
            pane.appendChild(b);
          });
        }
        if (src.fakty?.length) {
          pane.appendChild(el('div', 'st-sub', 'DANE ZE ŹRÓDEŁ'));
          src.fakty.forEach((f) => pane.appendChild(el('div', 'st-fact', f)));
        }
        if (plany.length) {
          pane.appendChild(el('div', 'st-sub', 'RYSUNKI'));
          const grid = el('div', 'st-plans');
          plany.forEach((p) => {
            const card = el('div', 'st-plan');
            const img = el('img');
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.src = p.url;
            img.alt = p.tytul;
            const over = el('button', 'cad-tool', 'NA MODELU');
            over.addEventListener('click', () => {
              const on = S.planOn === p.url;
              S.planOn = on ? null : p.url;
              S.view?.setPlan(S.planOn);
            });
            const link = el('a', 'cad-tool', 'ŹRÓDŁO');
            if (p.strona) {
              link.href = p.strona;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
            }
            const tools = el('div', 'cad-tools');
            tools.append(over, link);
            card.append(img, el('div', 'w-dim', `${p.tytul}${p.licencja ? ` · ${p.licencja}` : ''}`), tools);
            grid.appendChild(card);
          });
          pane.appendChild(grid);
        }
        if (zrodla.length) {
          pane.appendChild(el('div', 'st-sub', 'ŹRÓDŁA'));
          zrodla.forEach((z) => {
            const a = el('a', 'st-link', z.tytul || z.url);
            a.href = z.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            pane.appendChild(a);
          });
        }
        if (!zrodla.length && !plany.length && !src.fakty?.length) pane.appendChild(el('div', 'w-empty', 'Ten projekt powstał bez szukania. Zaznacz „szukaj planów” albo napisz „replika…”, a Jarvis najpierw sprawdzi źródła.'));
      }
      function drawBlenderTab() {
        S.drawBlender = () => {
          if (S.tab === 'blender') S.redraw();
        };
        const st = S.blender.status;
        if (!desktop()?.runAction) {
          pane.appendChild(el('div', 'w-empty', 'Blender działa w aplikacji na komputerze. Tutaj działa podgląd, edycja, animacja i pliki STL.'));
          return;
        }
        if (!st) {
          blenderRefresh();
          pane.appendChild(el('div', 'w-dim', 'Sprawdzam…'));
          return;
        }
        if (st.nieobslugiwany) {
          pane.appendChild(el('div', 'st-warn', 'Ta wersja aplikacji na PC nie obsługuje jeszcze Blendera. Zaktualizuj ją w Ustawieniach.'));
          return;
        }
        const prog = S.blender.progress;
        if (S.blender.busy && prog && prog.faza !== 'bezczynny') {
          const bar = el('div', 'st-job-bar');
          const fill = el('i');
          fill.style.width = `${prog.postep || 2}%`;
          bar.appendChild(fill);
          pane.append(el('div', 'w-dim', prog.tekst || 'Pracuję'), bar);
        }
        if (!st.zainstalowany) {
          pane.appendChild(el('div', 'w-dim st-desc', 'Blender wygładza i fazuje krawędzie, wycina otwory, renderuje realistyczne obrazy i wideo rozbierania oraz zapisuje plik .blend do dalszej pracy.'));
          const inst = el('button', 'btn primary', `ZAINSTALUJ BLENDERA (${st.instalacja_mb} MB)`);
          inst.disabled = S.blender.busy;
          inst.addEventListener('click', blenderInstall);
          pane.appendChild(inst);
          return;
        }
        pane.appendChild(el('div', 'w-dim st-desc', `Blender ${st.wersja || ''} · ${st.sciezka}`));
        if (S.project) {
          const bar = el('div', 'st-btns');
          const b1 = el('button', 'btn primary', 'ZBUDUJ W BLENDERZE');
          b1.addEventListener('click', () => blenderBuild());
          const b2 = el('button', 'btn ghost', 'WIDEO ROZBIERANIA');
          b2.title = 'Render animacji: kilka minut';
          b2.addEventListener('click', () => blenderBuild({ wideo: true }));
          [b1, b2].forEach((b) => {
            b.disabled = S.blender.busy;
            bar.appendChild(b);
          });
          if (S.blender.busy) {
            const c = el('button', 'btn ghost', 'ANULUJ');
            c.addEventListener('click', () => blenderAction('blender-anuluj'));
            bar.appendChild(c);
          }
          pane.appendChild(bar);
        }
        const auto = el('label', 'st-check');
        const ai = el('input');
        ai.type = 'checkbox';
        ai.checked = S.blender.auto;
        ai.addEventListener('change', () => {
          S.blender.auto = ai.checked;
        });
        auto.append(ai, document.createTextNode(' buduj automatycznie po projekcie Jarvisa'));
        pane.appendChild(auto);
        const r = S.blender.result;
        if (!r) return;
        const refinedCount = Object.keys(S.refined).length;
        pane.appendChild(el('div', 'w-dim st-desc', `Silnik: ${r.silnik || '?'}. W podglądzie ${refinedCount} części z Blendera.${(r.uwagi || []).length ? ` ${r.uwagi.join(' ')}` : ''}`));
        const img = (b64, title) => {
          if (!b64) return;
          pane.appendChild(el('div', 'st-sub', title));
          const i = el('img', 'st-render');
          i.src = `data:image/png;base64,${b64}`;
          pane.appendChild(i);
        };
        img(r.podglad, 'RENDER');
        img(r.rozlozony, 'ROZŁOŻONY');
        if (S.blender.videoUrl) {
          pane.appendChild(el('div', 'st-sub', 'WIDEO ROZBIERANIA'));
          const v = el('video', 'st-render');
          v.src = S.blender.videoUrl;
          v.controls = true;
          v.loop = true;
          pane.appendChild(v);
        }
        const files = el('div', 'st-btns');
        const openIt = (label, sciezka, w_blenderze) => {
          if (!sciezka) return;
          const b = el('button', 'btn ghost', label);
          b.addEventListener('click', async () => {
            const out = await blenderAction('blender-otworz', { sciezka, w_blenderze });
            if (!out.ok) toast(out.error);
          });
          files.appendChild(b);
        };
        openIt('OTWÓRZ W BLENDERZE', r.blend, true);
        openIt('FOLDER PROJEKTU', r.folder);
        openIt('PLIKI STL', r.stl);
        pane.appendChild(files);
      }
      // Szacunek druku, dopasowanie do stolu i rozklad czesci: liczy WorkKit z prawdziwych siatek.
      function drawPrint(pr) {
        const W = window.WorkKit;
        if (!W) return;
        pane.appendChild(el('div', 'st-sub', 'WYDRUK: CZAS, MATERIAŁ, STÓŁ'));
        const cfg = (() => {
          try {
            return { material: 'PLA', infill: 20, bed: [220, 220, 250], price: 0, ...JSON.parse(localStorage.getItem('jarvis.studio.print') || '{}') };
          } catch {
            return { material: 'PLA', infill: 20, bed: [220, 220, 250], price: 0 };
          }
        })();
        const save = () => localStorage.setItem('jarvis.studio.print', JSON.stringify(cfg));
        const row = el('div', 'st-row');
        const mat = el('select', 'inp');
        Object.keys(W.MATERIALS).forEach((k) => {
          const o = el('option', null, k);
          o.value = k;
          mat.appendChild(o);
        });
        mat.value = cfg.material;
        mat.addEventListener('change', () => {
          cfg.material = mat.value;
          save();
          S.redraw();
        });
        row.append(mat, numberField('wypełnienie %', cfg.infill, (v) => { cfg.infill = Math.max(0, Math.min(100, v)); save(); S.redraw(); }, '5'), numberField('zł/kg (0 = typowa)', cfg.price, (v) => { cfg.price = Math.max(0, v); save(); S.redraw(); }, '1'));
        const bed = el('div', 'st-row');
        ['X', 'Y', 'Z'].forEach((a, i) => bed.appendChild(numberField(`stół ${a}`, cfg.bed[i], (v) => { cfg.bed[i] = Math.max(50, v || 220); save(); S.redraw(); }, '1')));
        pane.append(row, bed);
        const sk = pr.skala || 1;
        const parts = pr.czesci.filter((p) => !p.ciecie && !S.hidden.has(p.id));
        let vol = 0;
        let area = 0;
        const foot = [];
        for (const p of parts) {
          const wm = S.view ? S.view.worldArray(p) : K.worldMesh(p);
          vol += Math.abs(K.signedVolume(wm));
          for (let i = 0; i < wm.length; i += 9) {
            const ax = wm[i + 3] - wm[i]; const ay = wm[i + 4] - wm[i + 1]; const az = wm[i + 5] - wm[i + 2];
            const bx = wm[i + 6] - wm[i]; const by = wm[i + 7] - wm[i + 1]; const bz = wm[i + 8] - wm[i + 2];
            area += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
          }
          const b = K.boundsOf(wm);
          foot.push({ id: p.id, w: (b.hi[0] - b.lo[0]) / sk, d: (b.hi[2] - b.lo[2]) / sk });
        }
        const est = W.printEstimate({ volume: vol / sk ** 3, area: area / sk ** 2, material: cfg.material, infill: cfg.infill, pricePerKg: cfg.price });
        if (est) pane.appendChild(el('div', 'w-mid', `${parts.length} części: ok. ${est.grams} g ${est.material}, ${est.meters} m filamentu, ok. ${Math.floor(est.minutes / 60)} h ${est.minutes % 60} min, koszt ok. ${est.cost.toFixed(2)} zł (szacunek: zależy od drukarki i ustawień)`));
        if (est && UI.printQueue) {
          const q = el('div', 'st-btns');
          const one = (p) => {
            const wm = S.view ? S.view.worldArray(p) : K.worldMesh(p);
            let a = 0;
            for (let i = 0; i < wm.length; i += 9) {
              const ax = wm[i + 3] - wm[i]; const ay = wm[i + 4] - wm[i + 1]; const az = wm[i + 5] - wm[i + 2];
              const bx = wm[i + 6] - wm[i]; const by = wm[i + 7] - wm[i + 1]; const bz = wm[i + 8] - wm[i + 2];
              a += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
            }
            const e = W.printEstimate({ volume: Math.abs(K.signedVolume(wm)) / sk ** 3, area: a / sk ** 2, material: cfg.material, infill: cfg.infill, pricePerKg: cfg.price });
            return { name: p.nazwa, project: pr.nazwa, material: cfg.material, grams: e?.grams || 0, minutes: e?.minutes || 0, note: p.opis || '' };
          };
          const all = el('button', 'btn ghost', 'CAŁOŚĆ DO KOLEJKI WYDRUKÓW');
          all.addEventListener('click', () => UI.printQueue.add(parts.map(one)).catch((e) => toast(e.message)));
          q.appendChild(all);
          const selPart = parts.find((p) => p.id === S.selected);
          if (selPart) {
            const b = el('button', 'btn ghost', `„${selPart.nazwa}” DO KOLEJKI`);
            b.addEventListener('click', () => UI.printQueue.add([one(selPart)]).catch((e) => toast(e.message)));
            q.appendChild(b);
          }
          pane.appendChild(q);
        }
        const m = K.measure(pr);
        const fit = W.fitScale(m.size.map((v) => v / sk), cfg.bed);
        if (fit) {
          const need = Math.ceil(sk / fit.maxScale);
          const line = el('div', fit.fits ? 'w-dim' : 'w-mid', fit.fits ? 'Całość zmieści się na stole w jednym kawałku.' : `Całość w jednym kawałku nie zmieści się na stole. Najmniejsza skala, przy której wejdzie: 1:${need}.`);
          pane.appendChild(line);
          if (!fit.fits) {
            const b = el('button', 'btn ghost', `USTAW SKALĘ 1:${need}`);
            b.addEventListener('click', () => commit({ ...pr, skala: need }));
            pane.appendChild(b);
          }
        }
        // Rozklad na stoly: kolejne stoly dostaja to, co nie weszlo na poprzedni.
        let left = foot;
        const plates = [];
        for (let i = 0; i < 30 && left.length; i++) {
          const r = W.packBed(left, cfg.bed.slice(0, 2), 4);
          if (!r.placed.length) break;
          plates.push(r);
          left = left.filter((f) => r.left.includes(f.id));
        }
        const tooBig = left.length;
        pane.appendChild(el('div', 'w-dim', `Rozkład części: ${plates.length} ${plates.length === 1 ? 'stół' : 'stołów'}${tooBig ? `, ${tooBig} części za dużych na stół (podziel albo zmniejsz skalę)` : ''}. Rzut z góry, części mogą wymagać obrotu na płaską stronę.`));
        const names = Object.fromEntries(pr.czesci.map((p) => [p.id, p.nazwa]));
        plates.slice(0, 4).forEach((pl, i) => {
          const [bw, bd] = cfg.bed;
          const sc = 220 / Math.max(bw, bd);
          pane.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${bw * sc} ${bd * sc}" style="width:220px;margin:4px;border:1px solid rgba(51,224,255,.4);background:rgba(51,224,255,.04)"><text x="4" y="12" fill="#9fd8ff" font-size="10">stół ${i + 1} · ${Math.round(pl.fill * 100)}%</text>${pl.placed.map((p) => `<rect x="${p.x * sc}" y="${p.y * sc}" width="${p.w * sc}" height="${p.d * sc}" fill="rgba(51,224,255,.25)" stroke="#33e0ff" stroke-width=".6"><title>${String(names[p.id] || p.id).replace(/[<>&"]/g, '')}</title></rect>`).join('')}</svg>`);
        });
      }

      // Wersje projektu na tym urzadzeniu: ostatnie 15, z przywracaniem.
      function drawVersions(pr) {
        const list = versions(pr.nazwa);
        pane.appendChild(el('div', 'st-sub', `WERSJE: ${pr.nazwa}`));
        if (!list.length) pane.appendChild(el('div', 'w-empty', 'Brak zapisanych wersji. Zapisują się same po zaprojektowaniu albo przyciskiem ZAPISZ WERSJĘ.'));
        list.forEach((v) => {
          const row = el('div', 'st-group');
          const b = el('button', 'cad-tool', 'PRZYWRÓĆ');
          b.addEventListener('click', () => {
            saveVersion('przed przywróceniem');
            commit(K.normalizeProject(v.projekt));
            toast('Przywrócono wersję.', 'ok');
          });
          row.append(el('span', null, `${new Date(v.at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${v.label} · ${v.parts} części`), b);
          pane.appendChild(row);
        });
      }

      function drawFiles() {
        const pr = S.project;
        if (pr) {
          pane.appendChild(el('div', 'st-sub', 'SKALA I DRUK'));
          const row = el('div', 'st-row');
          row.appendChild(numberField('skala 1:', pr.skala, (v) => commit({ ...pr, skala: Math.max(1, v || 1) })));
          pane.appendChild(row);
          const bar = el('div', 'st-btns');
          const mk = (label, fn, cls = 'btn ghost') => {
            const b = el('button', cls, label);
            b.addEventListener('click', fn);
            bar.appendChild(b);
          };
          mk('STL CAŁOŚCI', () => exportStl(false));
          mk('STL WYBRANEJ', () => exportStl(true));
          mk('GLB', async () => {
            try {
              downloadBlob(fileName('glb'), new Blob([await S.view.glb()], { type: 'model/gltf-binary' }));
            } catch (e) {
              toast(e.message);
            }
          });
          mk('OBJ', () => downloadBlob(fileName('obj'), new Blob([objText(pr)], { type: 'text/plain' })));
          mk('LISTA CZĘŚCI (CSV)', () => downloadBlob(fileName('csv'), new Blob([K.bomCsv(pr)], { type: 'text/csv' })));
          mk('PROJEKT (JSON)', () => downloadBlob(fileName('json'), new Blob([JSON.stringify(pr)], { type: 'application/json' })));
          mk('WYŚLIJ NA DRUKARKĘ', async () => {
            try {
              await api('/api/studio/print', json({ projekt: pr, czesci: S.selected ? [S.selected] : null }));
              toast('Wysłano do drukarki.', 'ok');
            } catch (e) {
              toast(e.message);
            }
          });
          mk('ZAPISZ W BIBLIOTECE', saveToLibrary, 'btn primary');
          mk('ZAPISZ WERSJĘ', () => {
            saveVersion('ręcznie');
            S.redraw();
          });
          pane.appendChild(bar);
          drawPrint(pr);
          drawVersions(pr);
        }
        pane.appendChild(el('div', 'st-sub', 'MOJE PROJEKTY'));
        const imp = el('input');
        imp.type = 'file';
        imp.accept = '.json';
        imp.addEventListener('change', async () => {
          try {
            setProject(JSON.parse(await imp.files[0].text()));
          } catch {
            toast('To nie jest plik projektu.');
          }
        });
        pane.appendChild(imp);
        const list = library();
        if (!list.length) pane.appendChild(el('div', 'w-empty', 'Brak zapisanych projektów na tym urządzeniu.'));
        list.forEach((it) => {
          const row = el('div', 'st-group');
          const open = el('button', 'cad-tool', 'WCZYTAJ');
          open.addEventListener('click', () => setProject(it.projekt));
          const del = el('button', 'row-x', '×');
          del.addEventListener('click', () => {
            store.set(LIB_KEY, library().filter((x) => x.nazwa !== it.nazwa));
            S.redraw();
          });
          row.append(el('b', null, it.nazwa), el('span', 'w-dim', new Date(it.at).toLocaleDateString('pl-PL')), open, del);
          pane.appendChild(row);
        });
      }
      function select(id) {
        S.selected = id;
        if (!id) S.gizmo = null;
        if (id && S.tau > 0 && S.gizmo) {
          S.tau = 0;
          S.playing = 0;
          S.view?.frameExploded(false);
        }
        S.view?.attachGizmo(id, S.gizmo);
        S.view?.refresh();
        if (id && S.tab === 'czesci') S.tab = 'edycja';
        S.redraw();
      }
      function setGizmo(mode) {
        S.gizmo = mode;
        if (mode && S.tau > 0) {
          S.tau = 0;
          S.playing = 0;
          S.fromZero = false;
          S.view?.refresh();
          S.view?.frameExploded(false);
        }
        S.view?.attachGizmo(S.selected, mode);
        S.redraw();
      }
      S.redraw = () => {
        if (!pane.isConnected) return;
        const scroll = pane.scrollTop;
        pane.innerHTML = '';
        Object.entries(tabBtns).forEach(([id, b]) => b.classList.toggle('on', S.tab === id));
        empty.hidden = Boolean(S.project);
        tl.style.visibility = S.project ? 'visible' : 'hidden';
        S.drawJob();
        S.drawTimeline();
        const needsProject = !S.project && ['czesci', 'edycja', 'kroki'].includes(S.tab);
        if (needsProject) pane.appendChild(el('div', 'w-empty', 'Nie ma jeszcze projektu.'));
        else if (S.tab === 'czesci') drawParts();
        else if (S.tab === 'edycja') drawEdit();
        else if (S.tab === 'kroki') drawSteps();
        else if (S.tab === 'plany') drawPlans();
        else if (S.tab === 'blender') drawBlenderTab();
        else drawFiles();
        pane.scrollTop = scroll;
      };
      S.redraw();

      loadThree()
        .then((THREE) => {
          S.view = createViewer(host, THREE, {
            onSelect: select,
            onMeasure: (p) => S.onMeasure?.(p),
            onTick: tick,
            onGizmoStart() {
              S.preDrag = JSON.stringify(S.project.czesci);
            },
            onGizmoMove(mesh) {
              const p = S.project.czesci.find((x) => x.id === mesh.userData.id);
              if (!p) return;
              p.x = mesh.position.x;
              p.y = mesh.position.y;
              p.z = mesh.position.z;
              const d = 180 / Math.PI;
              p.rx = mesh.rotation.x * d;
              p.ry = mesh.rotation.y * d;
              p.rz = mesh.rotation.z * d;
            },
            onGizmoEnd(mesh) {
              const p = S.project.czesci.find((x) => x.id === mesh.userData.id);
              if (!p) return;
              commit({ ...S.project, czesci: S.project.czesci.map((c) => ({ ...c })) }, { snapshot: S.preDrag });
              S.view.attachGizmo(p.id, S.gizmo);
            },
          });
          if (!S.project) {
            const last = store.get(CUR_KEY, null);
            if (last?.czesci?.length) {
              S.project = K.normalizeProject(last);
              S.warnings = K.check(S.project);
            }
          }
          if (S.project) S.view.setProject(S.project);
          S.redraw();
        })
        .catch((e) => {
          empty.hidden = false;
          empty.textContent = e.message;
        });
    },
  };
  UI.extend('cad', { studio: panel }, { first: true });

  // ---------- polecenia dla Jarvisa ----------
  if (UI.clientActions) {
    UI.clientActions['studio-projekt'] = async (p) => {
      const opis = String(p?.opis || p?.raw || '');
      design(opis, null);
      return { ok: true };
    };
    UI.clientActions['studio-replika'] = async (p) => {
      const opis = String(p?.opis || p?.raw || '');
      design(opis, true);
      return { ok: true };
    };
    UI.clientActions['studio-edytuj'] = async (p) => {
      await waitReady();
      await aiEdit(String(p?.polecenie || p?.raw || ''));
      return { ok: true };
    };
    UI.clientActions['studio-dopracuj'] = async (p) => {
      await waitReady();
      if (!S.project) return { ok: false, error: 'Nie ma otwartego projektu.' };
      const want = String(p?.grupa || p?.raw || '').toLowerCase();
      const groups = [...new Set(S.project.czesci.map((c) => c.grupa))];
      const grupa = groups.find((g) => g.toLowerCase().includes(want) || want.includes(g.toLowerCase()));
      if (!grupa) return { ok: false, error: `Nie ma takiego podzespołu. Są: ${groups.join(', ')}.` };
      const ops = await api('/api/studio/refine', json({ projekt: S.project, grupa }));
      ops.usun.forEach((id) => delete S.refined[id]);
      commit(K.applyOps(S.project, ops));
      if (UI.isLive?.()) UI.liveSend({ type: 'react', text: `${ops.co_zmieniono} Powiedz to krótko.` });
      return { ok: true };
    };
    UI.clientActions['studio-steruj'] = async (p) => {
      await waitReady();
      if (!S.project) return { ok: false, error: 'Nie ma otwartego projektu.' };
      const a = String(p?.akcja || p?.raw || '').toLowerCase();
      const num = /(\d+)/.exec(a);
      if (/stop|pauz|zatrzym/.test(a)) S.playing = 0;
      else if (/od zera/.test(a)) {
        S.tau = 1;
        play(-1, { fromZero: true });
      } else if (/krok/.test(a) && num) goToStep(Number(num[1]));
      else if (/przekr/.test(a)) {
        S.clip.axis = S.clip.axis ? null : 'z';
        S.applyClip();
        if (S.clip.axis) S.view?.lookAlong(S.clip.axis);
      } else if (/rozbier|rozloz|rozłóż/.test(a)) play(1);
      else if (/zloz|złóż|montaz|montaż|zbuduj/.test(a)) play(-1);
      else if (/wideo|film/.test(a)) blenderBuild({ wideo: true });
      else if (/blender/.test(a)) blenderBuild();
      else if (/zapisz/.test(a)) saveToLibrary();
      else if (/holo/.test(a)) {
        S.style = 'holo';
        S.view?.setStyle();
      } else if (/rentgen/.test(a)) {
        S.style = 'xray';
        S.view?.setStyle();
      } else if (/bryl|norm/.test(a)) {
        S.style = 'real';
        S.view?.setStyle();
      } else {
        const tpl = (T?.LIST || []).find((t) => a.includes(t.id) || a.includes(t.nazwa.toLowerCase()));
        if (tpl) setProject(tpl.make());
        else return { ok: false, error: 'Nie znam tego polecenia.' };
      }
      S.redraw();
      return { ok: true };
    };
  }
  // Dla Jarvisa i testow.
  UI.studio = { fromPhoto, design, aiEdit, setProject, play, goToStep, blenderBuild, blenderRefresh, state: S };
})();
