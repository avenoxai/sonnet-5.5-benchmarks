import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as L from './layout.js';
import { createMaterials, studioEnvironment } from './materials.js';
import { createWatch, LAYER_TOGGLES, LAYER_DEFS } from './scene.js';
import { WatchSim } from './sim.js';
import { WatchAudio } from './audio.js';
import { createUI } from './ui.js';
import { CHAIN } from './info.js';

const DEG = Math.PI / 180;
const canvas = document.getElementById('gl');

// ---------------- Renderer ----------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x000000, 0);

const HASH = location.hash;
if (HASH.includes('noshadow=1')) renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.environment = studioEnvironment(renderer);
scene.environmentIntensity = 1.0;

const camera = new THREE.PerspectiveCamera(28, 1, 2, 900);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 7;
controls.maxDistance = 460;
controls.zoomSpeed = 0.9;
controls.rotateSpeed = 0.7;
controls.screenSpacePanning = true;

// ---------------- Işıklar ----------------
const key = new THREE.DirectionalLight(0xfff1de, 2.4);
key.position.set(30, 74, 46);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
const sc = key.shadow.camera;
sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 10; sc.far = 320;
key.shadow.bias = -0.00035;
key.shadow.normalBias = 0.03;
key.shadow.radius = 2.4;
scene.add(key, key.target);
// arkadan (mekanizmayı görmek için) ikinci ışık — izleyicinin bulunduğu tarafa göre şiddeti değişir
const backKey = new THREE.DirectionalLight(0xffe9cf, 1.6);
backKey.position.set(-26, 70, -40);
backKey.castShadow = true;
backKey.shadow.mapSize.set(4096, 4096);
const sc2 = backKey.shadow.camera;
sc2.left = -34; sc2.right = 34; sc2.top = 34; sc2.bottom = -34; sc2.near = 10; sc2.far = 320;
backKey.shadow.bias = -0.00035;
backKey.shadow.normalBias = 0.03;
backKey.shadow.radius = 2.4;
scene.add(backKey, backKey.target);
scene.add(new THREE.HemisphereLight(0xbfd0ff, 0x2a2018, 0.35));

// ---------------- Saat ----------------
const mats = createMaterials();
let watch = null, sim = null, ui = null;
const audio = new WatchAudio();

// ---------------- Görünümler ----------------
const VIEWS = {
  hero: { pos: [40, -58, 112], target: [0, -1, 0], hide: [] },
  front: { pos: [0, 0, 132], target: [0, 0, 0], hide: [] },
  back: { pos: [0, 2, -132], target: [0, 0, -4], hide: [] },
  side: { pos: [132, 8, -6], target: [8, 0, -2], hide: [] },
  movement: { pos: [-20, -32, -84], target: [0, 0, -5], hide: ['caseback'] },
  escape: { pos: [-3.5, -9.5, 37], target: [-8.4, -6.6, -1.8], hide: ['crystal', 'hands', 'dial', 'motion', 'plate'] },
  balance: { pos: [-8, -19, -33], target: [-4.6, -9.4, -3.3], hide: ['caseback', 'rotor', 'rotorGear', 'winding', 'cock'] },
  barrel: { pos: [9, 18, -32], target: [3.8, 8.2, -3.2], hide: ['caseback', 'rotor', 'rotorGear', 'winding', 'bridges', 'barrelLid'] },
};
let currentView = 'hero';
let explode = 0;
let explodeTarget = 0;
const fly = { active: false, t: 0, dur: 1.4, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function flyTo(pos, target, dur = 1.4, instant = false) {
  if (instant) {
    camera.position.set(...pos); controls.target.set(...target); controls.update(); fly.active = false; return;
  }
  fly.active = true; fly.t = 0; fly.dur = dur;
  fly.fromPos.copy(camera.position); fly.fromT.copy(controls.target);
  fly.toPos.set(...pos); fly.toT.set(...target);
}

function applyVisibility(hideIds) {
  const hide = new Set(hideIds);
  for (const [id] of LAYER_DEFS) {
    const on = !hide.has(id);
    watch.layers[id].group.visible = on;
    watch.ctx.layerUserVisible = watch.ctx.layerUserVisible || {};
    watch.ctx.layerUserVisible[id] = on;
  }
  for (const [tid, , ids] of LAYER_TOGGLES) ui.setLayerChip(tid, ids.some((i) => !hide.has(i)));
}

const STACK_DIR = new THREE.Vector3(0.8, -0.32, 0.52).normalize();
const EXPLODE_K = 2.2;
const STACK_VIEWS = ['hero', 'front', 'back', 'side'];
function viewForExplode(id, t) {
  const v = VIEWS[id];
  const pos = new THREE.Vector3(...v.pos), tgt = new THREE.Vector3(...v.target);
  if (t < 0.06) return { pos, tgt };
  if (STACK_VIEWS.includes(id)) {
    const zs = id === 'back' ? -1 : 1;
    const d = new THREE.Vector3(STACK_DIR.x, STACK_DIR.y, STACK_DIR.z * zs).normalize();
    const tg = new THREE.Vector3(0, 0, -12 * t);
    return { pos: tg.clone().addScaledVector(d, 95 * (1 + EXPLODE_K * t)), tgt: tg };
  }
  const dir = pos.clone().sub(tgt);
  tgt.z += -12 * t;
  pos.copy(tgt).add(dir.multiplyScalar(1 + EXPLODE_K * t));
  return { pos, tgt };
}

function setView(id, { instant = false, keepExplode = false } = {}) {
  const v = VIEWS[id];
  if (!v) return;
  currentView = id;
  ui.setView(id);
  applyVisibility(v.hide);
  if (['escape', 'balance', 'barrel'].includes(id) && !keepExplode) setExplode(0, true);
  // Çıkış / balans yakın planında saat otomatik yavaşlar (gerçek hızda göz ayırt edemez)
  if (!instant) {
    if ((id === 'escape' || id === 'balance') && sim.timeScale === 1 && !tour.active) { setSpeed(id === 'escape' ? 0.1 : 0.25); autoSlow = true; }
    else if (autoSlow && id !== 'escape' && id !== 'balance' && !tour.active) { setSpeed(1); autoSlow = false; }
  }
  const vw = viewForExplode(id, explodeTarget);
  lastExplodeForCam = explode;
  flyTo(vw.pos.toArray(), vw.tgt.toArray(), 1.5, instant);
}
let autoSlow = false;

function setExplode(v, jump = false) {
  const prev = explodeTarget;
  explodeTarget = v;
  if (jump) explode = v;
  ui.setExplode(v);
  if (!jump && STACK_VIEWS.includes(currentView)) {
    const crossing = (prev < 0.06 && v >= 0.06) || (prev >= 0.06 && v < 0.06);
    if (crossing) {
      const vw = viewForExplode(currentView, v);
      lastExplodeForCam = v;
      flyTo(vw.pos.toArray(), vw.tgt.toArray(), 1.6);
    }
  }
}

let lastExplodeForCam = 0;
function reframeForExplode(t) {
  if (fly.active) return;
  const dt = t - lastExplodeForCam;
  if (Math.abs(dt) < 1e-4) return;
  const dirVec = camera.position.clone().sub(controls.target);
  const d0 = dirVec.length();
  const dNew = (d0 * (1 + EXPLODE_K * t)) / (1 + EXPLODE_K * lastExplodeForCam);
  controls.target.z += -12 * dt;
  camera.position.copy(controls.target).add(dirVec.normalize().multiplyScalar(dNew));
  lastExplodeForCam = t;
}

// ---------------- Vurgu (highlight) ----------------
const hlMat = {
  hover: new THREE.MeshBasicMaterial({ color: 0x66c8ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
  select: new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
  chain: new THREE.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
};
const overlays = new Map();     // part → [overlay meshes]
const hl = { hover: null, select: null, chain: null };
function getOverlays(part) {
  let arr = overlays.get(part);
  if (arr) return arr;
  arr = [];
  part.objects.forEach((g) => g.traverse((o) => {
    if (!o.isMesh || o.userData.isOverlay || o.userData.noOverlay) return;
    const ov = new THREE.Mesh(o.geometry, hlMat.hover);
    ov.userData.isOverlay = true;
    ov.raycast = () => {};
    ov.renderOrder = 20;
    ov.visible = false;
    o.add(ov);
    arr.push(ov);
  }));
  overlays.set(part, arr);
  return arr;
}
function refreshHighlight() {
  const want = new Map();
  if (hl.hover) want.set(hl.hover, 'hover');
  if (hl.select) want.set(hl.select, 'select');
  if (hl.chain) want.set(hl.chain, 'chain');
  for (const [part, arr] of overlays) {
    const mode = want.get(part);
    for (const ov of arr) {
      ov.visible = !!mode;
      if (mode) ov.material = hlMat[mode];
    }
  }
  for (const [part, mode] of want) {
    const arr = getOverlays(part);
    for (const ov of arr) { ov.visible = true; ov.material = hlMat[mode]; }
  }
}

// ---------------- Seçim / işaretleme ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tip = document.getElementById('tip');
let pickables = [];
function buildPickables() {
  pickables = [];
  for (const m of watch.ctx.meshToPart.keys()) if (!m.userData.noPick) pickables.push(m);
}
function isVisible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  for (const h of hits) {
    if (!isVisible(h.object)) continue;
    const part = watch.ctx.meshToPart.get(h.object);
    if (part && part.id === 'case' && explode > 0.25) continue;   // hayalet kasa seçilmez
    if (part) return { part, hit: h };
  }
  return null;
}

let selected = null;
function select(part) {
  selected = part;
  hl.select = part;
  ui.setInfo(part);
  refreshHighlight();
}

// ---------------- Girdi: taç, rotor, hover ----------------
const drag = { mode: null, lastY: 0, lastAngle: 0, moved: 0, startX: 0, startY: 0, plane: new THREE.Plane(), vel: 0 };

canvas.addEventListener('pointerdown', (ev) => {
  drag.startX = ev.clientX; drag.startY = ev.clientY; drag.moved = 0;
  const p = pick(ev);
  if (p && (p.part.id === 'crown' || p.part.id === 'stem') && ev.button === 0) {
    drag.mode = 'crown'; drag.lastY = ev.clientY; controls.enabled = false;
    ev.stopImmediatePropagation();
    canvas.setPointerCapture(ev.pointerId);
  } else if (p && p.part.id === 'rotor' && ev.button === 0) {
    const rotorObj = watch.ctx.nodes.rotor;
    const wp = new THREE.Vector3(); rotorObj.getWorldPosition(wp);
    drag.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), wp);
    const pt = new THREE.Vector3();
    raycaster.ray.intersectPlane(drag.plane, pt);
    drag.lastAngle = Math.atan2(pt.y - wp.y, pt.x - wp.x);
    drag.mode = 'rotor'; controls.enabled = false; drag.vel = 0;
    ev.stopImmediatePropagation();
    canvas.setPointerCapture(ev.pointerId);
    sim.rotorVel = 0; sim.gravAng = 0; sim.shakeT = 0;
  }
}, { capture: true });
canvas.addEventListener('pointermove', (ev) => {
  drag.moved += Math.abs(ev.movementX || 0) + Math.abs(ev.movementY || 0);
  if (drag.mode === 'crown') {
    const dy = ev.clientY - drag.lastY; drag.lastY = ev.clientY;
    const applied = sim.turnCrown(dy * 0.022);
    if (applied === 0 && sim.mode === 'wind' && dy > 0) { /* ters yön: mandal tutar */ }
    return;
  }
  if (drag.mode === 'rotor') {
    const r = canvas.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const pt = new THREE.Vector3();
    const wp = new THREE.Vector3(); watch.ctx.nodes.rotor.getWorldPosition(wp);
    if (raycaster.ray.intersectPlane(drag.plane, pt)) {
      let a = Math.atan2(pt.y - wp.y, pt.x - wp.x);
      let d = a - drag.lastAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      // arkadan bakıldığı için görüntüdeki dönüş yönü ters olabilir; dünya açısı kullanılır
      sim.moveRotor(d);
      drag.vel = d / Math.max(0.008, (ev.timeStamp - (drag.t || ev.timeStamp - 16)) / 1000);
      drag.t = ev.timeStamp;
      drag.lastAngle = a;
    }
    return;
  }
  // hover
  if (ev.buttons) { tip.classList.remove('show'); return; }
  const p = pick(ev);
  const part = p ? p.part : null;
  if (part !== hl.hover) { hl.hover = part; refreshHighlight(); }
  if (part) {
    tip.textContent = part.info?.title || part.name;
    tip.style.left = ev.clientX + 'px'; tip.style.top = ev.clientY + 'px';
    tip.classList.add('show');
    canvas.style.cursor = (part.id === 'crown' || part.id === 'rotor') ? 'grab' : 'pointer';
  } else {
    tip.classList.remove('show'); canvas.style.cursor = 'default';
  }
});
function endDrag(ev) {
  if (drag.mode === 'rotor') sim.rotorVel = Math.max(-14, Math.min(14, drag.vel * 0.6));
  if (drag.mode) { drag.mode = null; controls.enabled = true; try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* */ } }
}
canvas.addEventListener('pointerup', (ev) => {
  const wasDrag = drag.mode;
  const click = drag.moved < 5;
  endDrag(ev);
  if (click && ev.button === 0 && !wasDrag) {
    const p = pick(ev);
    select(p ? p.part : null);
  } else if (click && wasDrag === 'crown') {
    select(watch.ctx.parts.find((x) => x.id === 'crown'));
  }
});
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { tip.classList.remove('show'); if (hl.hover) { hl.hover = null; refreshHighlight(); } });
canvas.addEventListener('dblclick', (ev) => {
  const p = pick(ev);
  if (p && (p.part.id === 'crown' || p.part.id === 'stem')) togglePull();
});
canvas.addEventListener('wheel', (ev) => {
  const p = pick(ev);
  if (p && p.part.id === 'crown') {
    ev.preventDefault(); ev.stopPropagation();
    sim.turnCrown(Math.sign(ev.deltaY) * Math.min(Math.abs(ev.deltaY), 60) * 0.011);
  }
}, { capture: true, passive: false });

function togglePull() {
  const pulled = sim.slideTarget !== 1;
  sim.pullCrown(pulled);
  ui.setPulled(pulled);
  audio.clunk(1);
}

// ---------------- Katman etiketleri (açılım sırasında) ----------------
const LABELS = [
  ['crystal', 'Safir cam ve çerçeve', [-19.4, -3, 4.5], 'l'],
  ['hands', 'İbreler', [0, 14.4, 3.3]],
  ['dial', 'Kadran', [17.4, -3, 2.4]],
  ['motion', 'Akrep-yelkovan dişlileri', [L.SETTING_WHEEL.x, 2.6, 0.6]],
  ['plate', 'Ana plaka', [17.3, -4, -0.6]],
  ['train', 'Dişli takımı ve çıkış', [L.THIRD.x - 3.2, L.THIRD.y - 3.6, -2.5]],
  ['barrel', 'Yay kutusu', [L.BARREL.x + 7.8, L.BARREL.y, -2.7]],
  ['barrelLid', 'Yay kutusu kapağı', [L.BARREL.x + 2, L.BARREL.y + 7.4, -3.7]],
  ['balance', 'Denge çarkı', [L.BALANCE.x + 5.4, L.BALANCE.y, -3.15]],
  ['bridges', 'Köprüler', [-2.4, -1.1, -4.9]],
  ['cock', 'Balans köprüsü', [-6.2, -14.9, -4.9]],
  ['winding', 'Mandal çarkı ve taç çarkı', [L.RATCHET.x + 5, L.RATCHET.y - 3.5, -5.55]],
  ['rotorGear', 'Otomatik kurma dişlileri', [L.ROTOR_W1.x, L.ROTOR_W1.y, -6.2]],
  ['rotor', 'Rotor', [13, -9, -7]],
  ['caseback', 'Kasa arkası', [18.9, 0, -8.3]],
];
const labelEls = [];
let labelsOn = true;
function buildLabels() {
  LABELS.forEach(([id, text, , side]) => {
    const el = document.createElement('div');
    el.className = 'lbl' + (side === 'l' ? ' left' : '');
    el.innerHTML = `<i></i><span>${text}</span>`;
    document.body.appendChild(el);
    labelEls.push(el);
  });
}
const _v = new THREE.Vector3();
function updateLabels() {
  const a = THREE.MathUtils.clamp((explode - 0.3) / 0.35, 0, 1) * (labelsOn ? 1 : 0);
  const w = window.innerWidth, h = window.innerHeight;
  LABELS.forEach(([id, , p], i) => {
    const el = labelEls[i];
    const layer = watch.layers[id].group;
    if (a < 0.02 || !isVisible(layer)) { el.style.opacity = 0; return; }
    _v.set(p[0], p[1], p[2] + layer.position.z);
    _v.project(camera);
    if (_v.z > 1) { el.style.opacity = 0; return; }
    const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    el.style.opacity = a;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` + (el.classList.contains('left') ? ' translateX(-100%)' : '');
  });
}

// ---------------- Ses ----------------
let soundWanted = false;

// ---------------- Enerji yolu ve tur ----------------
let chainOn = false, chainT = 0, chainIdx = 0;
function setChain(on) {
  chainOn = on; chainT = 0; chainIdx = 0;
  if (!on) { hl.chain = null; refreshHighlight(); ui.setChain(null, false); }
  else ui.setChain(CHAIN[0][0], true);
}
function updateChain(dt) {
  if (!chainOn) return;
  chainT += dt;
  const step = 1.15;
  const idx = Math.floor(chainT / step) % CHAIN.length;
  if (idx !== chainIdx || !hl.chain) {
    chainIdx = idx;
    const id = CHAIN[idx][0];
    hl.chain = watch.ctx.parts.find((p) => p.id === id) || null;
    ui.setChain(id, true);
    refreshHighlight();
  }
  const pulse = 0.35 + 0.35 * Math.sin(chainT * 7);
  hlMat.chain.opacity = 0.12 + pulse * 0.4;
}

const TOUR = [
  { view: 'hero', explode: 0, speed: 1, select: null, dur: 6.5, title: 'HOROS Kalibre 01', text: 'Bu bir animasyon değil: içindeki her dişli gerçek diş sayısıyla, gerçek oranlarla dönüyor. Saniye ibresini izle — altı adımlık tik-tak, balans çarkının saniyede üç kez ileri geri gitmesinden geliyor.' },
  { view: 'front', explode: 0, speed: 1, select: 'hands', dur: 7, text: null },
  { view: 'side', explode: 0, speed: 1, select: 'crown', dur: 6.5, text: null },
  { view: 'back', explode: 0, speed: 1, select: 'rotor', dur: 7, text: null },
  { view: 'movement', explode: 0, speed: 1, select: 'barrelBridge', dur: 6, text: null },
  { view: 'hero', explode: 1, speed: 1, select: null, dur: 8, title: 'İçini açalım', text: 'Katmanlar sırayla ayrıldı: cam, ibreler, kadran, akrep-yelkovan dişlileri, plaka, dişli takımı, köprüler, rotor ve kasa arkası. Slider ile istediğin kademede durdur.' },
  { view: 'barrel', explode: 0, speed: 1, select: 'barrel', dur: 7, text: null },
  { view: 'movement', explode: 0, speed: 1, select: null, chain: true, dur: 9, title: 'Enerjinin yolu', text: 'Yay kutusu → merkez çarkı → üçüncü → saniye çarkı → çıkış çarkı → çapa → balans. Her adımda dişli oranı artıyor: yay 8 saatte bir dönerken çıkış çarkı dakikada 12 kez dönüyor.' },
  { view: 'escape', explode: 0, speed: 0.02, select: 'fork', dur: 11, text: null },
  { view: 'balance', explode: 0, speed: 0.1, select: 'balance', dur: 8, text: null },
  { view: 'hero', explode: 0, speed: 1, select: null, dur: 4, title: 'Bu kadar', text: 'Şimdi kendin dene: tacı çek, ibreleri ilerlet; yayı doldur; rotoru döndür; zamanı yavaşlat.' },
];
let tour = { active: false, i: 0, t: 0 };
function startTour() {
  tour = { active: true, i: -1, t: 999 };
  ui.setTourBtn(true);
}
function stopTour() {
  tour.active = false; ui.setTourBtn(false); setChain(false); setSpeed(1); select(null);
}
function updateTour(dt) {
  if (!tour.active) return;
  tour.t += dt;
  const cur = TOUR[tour.i];
  if (!cur || tour.t >= cur.dur) {
    tour.i++;
    tour.t = 0;
    if (tour.i >= TOUR.length) { stopTour(); return; }
    const s = TOUR[tour.i];
    const wasOpen = explodeTarget > 0.3;
    setExplode(s.explode);
    if (wasOpen && s.explode < 0.06) {
      const idx = tour.i;
      setTimeout(() => { if (tour.active && tour.i === idx) setView(s.view, { keepExplode: true }); }, 1400);
    } else setView(s.view, { keepExplode: true });
    setSpeed(s.speed);
    setChain(!!s.chain);
    if (s.select) select(watch.ctx.parts.find((p) => p.id === s.select));
    else select(null);
    if (s.title) ui.setInfo({ name: s.title, info: { title: s.title, text: s.text, specs: [] } });
  }
}

// ---------------- Hız ----------------
function setSpeed(v) {
  autoSlow = false;
  sim.timeScale = v;
  ui.setSpeed(v);
}

// ---------------- Basılı tut girdileri ----------------
const held = { wind: false, fwd: false, back: false };

// ---------------- Kurulum ----------------
function boot() {
  watch = createWatch(mats);
  if (HASH.includes('noglass=1')) { watch.ctx.crystalMesh.visible = false; }
  if (HASH.includes('nocss=1')) document.querySelectorAll('.glass').forEach((e) => { e.style.backdropFilter = 'none'; });
  scene.add(watch.ctx.root);
  sim = new WatchSim();

  // seçilemeyen mesh'ler
  watch.ctx.crystalMesh.userData.noPick = true;
  watch.ctx.layers.caseback.group.traverse((o) => { if (o.isMesh && o.material === mats.glass) o.userData.noPick = true; });

  ui = createUI({
    onExplode: (v) => { const prev = explodeTarget; explodeTarget = v; explode = v; const c = (prev < 0.06 && v >= 0.06) || (prev >= 0.06 && v < 0.06); if (c && STACK_VIEWS.includes(currentView)) { const vw = viewForExplode(currentView, v); lastExplodeForCam = v; flyTo(vw.pos.toArray(), vw.tgt.toArray(), 1.4); } },
    onExplodeTo: (v) => { setExplode(v); },
    onView: (id) => setView(id),
    onLayer: (id, on) => { watch.setLayerVisible(id, on); },
    onSpeed: (v) => setSpeed(v),
    onSound: async () => {
      if (!audio.enabled) { const ok = await audio.enable(); soundWanted = ok; ui.setSound(ok); }
      else { audio.disable(); soundWanted = false; ui.setSound(false); }
    },
    onPull: () => togglePull(),
    onHold: (dir, on) => { held[dir] = on; },
    onShake: () => { sim.shakeRotor(4); },
    onSpring: (v) => sim.setSpring(v * sim.springMax),
    onTheme: (n) => watch.setDialTheme(n),
    onChain: () => setChain(!chainOn),
    onTour: () => (tour.active ? stopTour() : startTour()),
    onSelect: (p) => select(p),
  });
  ui.setPulled(false);
  ui.setSpeed(1);
  ui.setView('hero');

  if (HASH.includes('envtest=1')) {
    const sph = new THREE.Mesh(new THREE.SphereGeometry(14, 64, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.02 }));
    scene.add(sph); watch.ctx.root.visible = false;
  }
  buildLabels();
  buildPickables();
  window.__w = { setView, setExplode, sim, watch, camera, controls, ui, select, setSpeed, applyVisibility, flyTo, THREE };
  handleHash();
  resize();
  requestAnimationFrame(() => {
    const el = document.getElementById('loading');
    el.style.opacity = 0;
    setTimeout(() => el.remove(), 900);
  });
  loop();
}

function handleHash() {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const view = q.get('view') || 'hero';
  flyTo(VIEWS.hero.pos, VIEWS.hero.target, 0, true);
  if (q.has('explode')) { setExplode(parseFloat(q.get('explode')), true); watch.setExplode(explode); }
  if (q.has('theme')) watch.setDialTheme(q.get('theme'));
  if (q.has('spring')) sim.setSpring(parseFloat(q.get('spring')) * sim.springMax);
  if (q.has('speed')) setSpeed(parseFloat(q.get('speed')));
  if (q.get('pull') === '1') { sim.pullCrown(true); sim.update(1); ui.setPulled(true); }
  setView(view, { instant: true, keepExplode: q.has('explode') });
  if (q.has('hide')) applyVisibility(q.get('hide').split(',').filter(Boolean));
  if (q.has('cam')) {
    const c = q.get('cam').split(',').map(Number);
    camera.position.set(c[0], c[1], c[2]);
    if (c.length >= 6) controls.target.set(c[3], c[4], c[5]);
    controls.update();
  }
  if (q.has('info')) select(watch.ctx.parts.find((p) => p.id === q.get('info')));
  if (q.get('panel') === '0') ui.setPanel(false);
  if (q.has('warm')) { const n = parseFloat(q.get('warm')); for (let i = 0; i < n * 60; i++) sim.update(1 / 60); }
  if (q.get('tour') === '1') startTour();
  if (!q.has('view') && !q.has('cam') && !q.has('explode') && q.get('intro') !== '0') {
    const h = VIEWS.hero;
    const start = new THREE.Vector3(...h.pos).sub(new THREE.Vector3(...h.target)).multiplyScalar(1.7).add(new THREE.Vector3(...h.target));
    start.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.55);
    camera.position.copy(start); controls.target.set(...h.target); controls.update();
    flyTo(h.pos, h.target, 3.2);
    lastInteract = performance.now() + 2500;
  }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // panel için sahneyi hafif sola kaydır
  const shift = w > 1100 ? -0.02 : 0;
  camera.setViewOffset(w, h, w * shift, 0, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------- Döngü ----------------
let lastT = performance.now();
let readoutT = 0;
let lastInteract = performance.now();
let swayPrev = 0;
for (const t of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(t, () => { lastInteract = performance.now(); }, { passive: true, capture: true });
function loop() {
  requestAnimationFrame(loop);
  const nowT = performance.now();
  const dt = Math.min((nowT - lastT) / 1000, 0.05);
  lastT = nowT;

  // basılı tutma
  if (held.wind && sim.mode === 'wind') sim.turnCrown(-7.5 * dt);
  if (sim.mode === 'set') {
    if (held.fwd) sim.turnCrown(8 * dt);
    if (held.back) sim.turnCrown(-8 * dt);
  }

  const tA = performance.now();
  sim.update(dt);
  const tB = performance.now();
  for (const e of sim.drainEvents()) {
    if (e.type === 'tick') {
      ui.beat(true); setTimeout(() => ui.beat(false), 60);
      if (soundWanted) {
        const dist = camera.position.distanceTo(controls.target);
        audio.tick(e.stone, Math.min(1, 45 / Math.max(15, dist)) * (0.6 + 0.4 * e.strength), Math.max(0.55, Math.sqrt(sim.timeScale)));
      }
    } else if (e.type === 'click' && soundWanted) audio.click(0.9);
  }

  // açılım animasyonu (yumuşak)
  const target = explodeTarget;
  if (Math.abs(explode - target) > 1e-4) {
    explode += (target - explode) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(explode - target) < 1e-3) explode = target;
    ui.setExplode(explode);
  }
  watch.setExplode(explode);
  reframeForExplode(explode);

  const tC = performance.now();
  watch.applyState(sim);
  updateLabels();
  const tD = performance.now();
  updateChain(dt);
  updateTour(dt);

  // uçuş
  if (fly.active) {
    fly.t += dt / fly.dur;
    const e = ease(Math.min(1, fly.t));
    camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
    controls.target.lerpVectors(fly.fromT, fly.toT, e);
    if (fly.t >= 1) fly.active = false;
  }
  // boşta iken hafif salınım (yalnız sergi görünümünde)
  {
    const idle = (nowT - lastInteract) / 1000;
    const want = currentView === 'hero' && idle > 4 && !fly.active && !tour.active && !drag.mode && explode < 0.05;
    const sway = want ? 0.34 * Math.sin((nowT / 1000) * 0.32) * Math.min(1, (idle - 4) / 3) : swayPrev;
    if (want || Math.abs(sway - swayPrev) > 1e-6) {
      const d = want ? sway - swayPrev : 0;
      const off = camera.position.clone().sub(controls.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), d);
      camera.position.copy(controls.target).add(off);
    }
    swayPrev = want ? sway : 0;
  }
  controls.update();
  key.target.position.set(0, 0, -6 * explode);
  backKey.target.position.set(0, 0, -6 * explode);
  {
    // izleyici hangi taraftaysa o taraftaki ışık güçlü olur (gölgeler ekrana doğru düşer)
    const dz = camera.position.z - controls.target.z;
    const dl = camera.position.distanceTo(controls.target) || 1;
    const back = THREE.MathUtils.smoothstep(-dz / dl, -0.25, 0.35);
    key.intensity = 0.5 + 1.9 * (1 - back);
    backKey.intensity = 0.3 + 1.7 * back;
  }
  const tE = performance.now();
  renderer.render(scene, camera);
  if (perf.el) renderer.getContext().finish();
  const tF = performance.now();
  perf.sim += tB - tA; perf.apply += tD - tC; perf.render += tF - tE;

  readoutT += dt;
  if (readoutT > 0.1) { readoutT = 0; updateReadout(); }
  perf.frames++;
  if (nowT - perf.t0 > 1000) {
    if (perf.el) {
      const i = renderer.info;
      const n = Math.max(1, perf.frames);
      perf.el.textContent = `${perf.frames}fps sim ${(perf.sim / n).toFixed(1)} apply ${(perf.apply / n).toFixed(1)} render ${(perf.render / n).toFixed(1)}ms | ${i.render.calls}c ${(i.render.triangles / 1000).toFixed(0)}k`;
      perf.sim = perf.apply = perf.render = 0;
    }
    perf.frames = 0; perf.t0 = nowT;
  }
}
const perf = { frames: 0, t0: performance.now(), el: null, sim: 0, apply: 0, render: 0 };
if (location.hash.includes('perf=1')) {
  perf.el = document.createElement('div');
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  perf.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a';
  perf.el.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:99;font:12px monospace;color:#9f9;background:rgba(0,0,0,.6);padding:3px 8px;border-radius:4px';
  document.body.appendChild(perf.el);
}

function updateReadout() {
  const wrap = (a, n) => ((a % n) + n) % n;
  const sec = wrap(-sim.secondRot / DEG / 6, 60);
  const min = wrap(-sim.minuteRot / DEG / 6, 60);
  const hr = wrap(-sim.hourRot / DEG / 30, 12);
  let hh = Math.floor(hr + 1e-6);
  const mm = Math.floor(min + 1e-6);
  const ss = Math.floor(sec + 1e-6);
  if (hh === 0) hh = 12;
  let state = '';
  if (sim.mode === 'set') state = 'Zaman ayarı konumu — tacı çevir';
  else if (sim.mode === 'moving') state = 'Taç kayıyor…';
  else if (sim.isFull) state = 'Yay tam kurulu';
  else if (!sim.running) state = 'Saat durdu — tacı çevir veya rotoru salla';
  if (sim.timeScale === 0) state = 'Duraklatıldı';
  else if (sim.timeScale < 1) state = `Yavaş çekim ${sim.timeScale < 0.05 ? '1/50' : sim.timeScale < 0.2 ? '1/10' : '1/4'}×` + (state ? ' · ' + state : '');
  ui.setReadout({
    h: hh, m: mm, s: ss,
    spring: sim.spring, springMax: sim.springMax, reserve: sim.powerReserveHours,
    amp: sim.running ? sim.amplitudeDeg : 0, stopped: !sim.running, state,
  });
}

// Sekme gizlenince saat çalışmaya devam eder: dönünce geçen süreyi ilerlet
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = performance.now();
  else if (hiddenAt && sim) { sim.fastForward((performance.now() - hiddenAt) / 1000); hiddenAt = 0; lastT = performance.now(); }
});

// Klavye
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'e') { setExplode(explodeTarget > 0.5 ? 0 : 1); }
  else if (k === ' ') { e.preventDefault(); setSpeed(sim.timeScale === 0 ? 1 : 0); }
  else if (k >= '1' && k <= '8') { setView(Object.keys(VIEWS)[Number(k) - 1]); }
  else if (k === 'h') ui.setPanel(true);
});

// Başlat: önce bir kare çiz (yükleme ekranı görünsün)
setTimeout(() => {
  try { boot(); } catch (err) {
    console.error(err);
    const el = document.getElementById('loading');
    if (el) el.querySelector('.sub').textContent = 'Hata: ' + err.message;
  }
}, 60);
