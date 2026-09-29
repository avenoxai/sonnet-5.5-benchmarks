// Kurma sistemi, zaman ayarı, kadran altı mekanizma ve otomatik kurma rotoru.
import * as THREE from 'three';
import * as L from '../layout.js';
import { gearData } from './gearset.js';
import { involuteOutline } from '../gears.js';
import { gearMesh, spokeHoles, addScrew, addJewel } from './helpers.js';
import { hullOfCircles } from './plates.js';
import {
  extrudeXY, shapeFromPts, circlePts, cylZ, ringZ, mesh, mergeAny, thickCurve, chaikin, annularSector, worldUV, bezier,
} from '../three-utils.js';
import { rotorTextTexture } from '../materials.js';

const { Z, M, ZL, DEG, TAU } = L;
const bevelFor = (m) => Math.min(0.025, m * 0.11);
const cyl = (r, z0, z1, mat, seg = 24) => mesh(cylZ(r, z0, z1, seg), mat);

// ---- Konik dişli geometrisi ----
export function bevelGearGeometry({ z, m, delta, face = 0.9, dir = 1, gapAtZero = false, thick = 0.9 }) {
  const R = (z * m) / 2;
  const A = R / Math.sin(delta);
  const base = involuteOutline({ z, m, thick, flank: 4, tip: 2, rootPts: 1 });
  let pts = base.pts;
  if (gapAtZero) {
    const c = Math.cos(Math.PI / z), s = Math.sin(Math.PI / z);
    pts = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  }
  const n = pts.length;
  const aOut = A, aIn = A - face;
  const sIn = aIn / A;
  const hOut = dir * aOut * Math.cos(delta), hIn = dir * aIn * Math.cos(delta);
  const pos = [];
  const push = (x, y, zz) => pos.push(x, y, zz);
  const tri = (p, q, r, flip) => {
    if (flip) { push(...q); push(...p); push(...r); } else { push(...p); push(...q); push(...r); }
  };
  const flip = dir < 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    const o0 = [x0, y0, hOut], o1 = [x1, y1, hOut];
    const i0 = [x0 * sIn, y0 * sIn, hIn], i1 = [x1 * sIn, y1 * sIn, hIn];
    // dış normal için (o0, i0, o1) ve (o1, i0, i1)
    tri(o0, i0, o1, flip);
    tri(o1, i0, i1, flip);
  }
  // Büyük uç kapağı (dışa bakar) ve küçük uç kapağı
  const vs = pts.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(vs, []);
  for (const [a, b, c] of tris) {
    tri([pts[a][0], pts[a][1], hOut], [pts[b][0], pts[b][1], hOut], [pts[c][0], pts[c][1], hOut], flip);
    tri([pts[a][0] * sIn, pts[a][1] * sIn, hIn], [pts[c][0] * sIn, pts[c][1] * sIn, hIn], [pts[b][0] * sIn, pts[b][1] * sIn, hIn], flip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return { geo: g, A, R, hOut, hIn };
}

export function buildWinding(ctx) {
  const m = ctx.mats;
  const G = gearData();
  const gWind = ctx.layers.winding.group;
  const gTrain = ctx.layers.train.group;
  const gMotion = ctx.layers.motion.group;
  const gRotorGear = ctx.layers.rotorGear.group;
  const gRotor = ctx.layers.rotor.group;
  const gPlate = ctx.layers.plate.group;

  // ---------------- MANDAL ÇARKI ----------------
  const ratchet = new THREE.Group();
  ratchet.position.set(L.RATCHET.x, L.RATCHET.y, 0);
  {
    const holes = [];
    // 4 hafifletme deliği
    for (let k = 0; k < 4; k++) {
      holes.push(annularSector(2.2, 4.9, k * (TAU / 4) + 0.18, (k + 1) * (TAU / 4) - 0.18, 12, 2).reverse());
    }
    const wheel = gearMesh(G.ratchet.pts, ZL.ratchetZ - 0.25, ZL.ratchetZ + 0.25, { holes, bevel: 0.03, mat: m.steel });
    ratchet.add(wheel);
    ratchet.add(mesh(ringZ(0.0001 + 0.001, 1.3, ZL.ratchetZ - 0.5, ZL.ratchetZ - 0.25, 40, 0.02), m.steel));
    addScrew(ratchet, 0, 0, ZL.ratchetZ - 0.5, 0.95, m.blued, { dir: -1, rot: 0.6 });
  }
  gWind.add(ratchet);
  ctx.nodes.ratchet = ratchet;

  // Çıkıntılı yay (click): mandal çarkının dışında sabit bir mandal
  const click = new THREE.Group();
  {
    const aClick = 148 * DEG;
    const rIn = 5.72;
    const tip = { x: L.RATCHET.x + (rIn + 0.05) * Math.cos(aClick), y: L.RATCHET.y + (rIn + 0.05) * Math.sin(aClick) };
    const tx = -Math.sin(aClick), ty = Math.cos(aClick);      // CCW teğet
    const Lc = 3.3;
    const pivot = { x: tip.x + tx * Lc, y: tip.y + ty * Lc };
    click.position.set(pivot.x, pivot.y, 0);
    // yerel çerçevede kol: pivottan tip'e vektör
    const vx = tip.x - pivot.x, vy = tip.y - pivot.y;
    const armPts = thickCurve([[0, 0], [vx * 0.5 - 0.15 * ty, vy * 0.5 + 0.15 * tx], [vx, vy]], [1.0, 0.85, 0.4], 8);
    const z0 = ZL.ratchetZ - 0.25, z1 = ZL.ratchetZ + 0.25;
    click.add(mesh(extrudeXY(shapeFromPts(armPts), z0, z1, { bevel: 0.03, curveSegments: 1 }), m.steel));
    click.add(cyl(0.32, ZL.bridgeTop - 0.02, z0 - 0.35, m.steel, 16));
    click.userData = { tip, pivot, aClick, Lc, vx, vy, rIn };
    // Yay (ince mavi çubuk)
    const sp = mesh(extrudeXY(shapeFromPts(thickCurve(
      bezier([pivot.x + 0.2, pivot.y + 0.5], [pivot.x + 1.5, pivot.y + 2.4], [pivot.x + 3.2, pivot.y + 2.2], [pivot.x + 3.6, pivot.y + 0.4], 12), Array(13).fill(0.12), 4)),
      z0 + 0.1, z1 - 0.1, { bevel: 0.0, curveSegments: 1 }), m.blued);
    gWind.add(sp);
    addScrew(gWind, pivot.x, pivot.y, ZL.ratchetZ - 0.42, 0.36, m.blued, { dir: -1, rot: 0.9 });
  }
  gWind.add(click);
  ctx.nodes.click = click;

  // ---------------- TAÇ ÇARKI (düz kısım + konik) ----------------
  const crownWheel = new THREE.Group();
  crownWheel.position.set(L.CROWN_WHEEL.x, L.CROWN_WHEEL.y, 0);
  ctx.nodes.crownWheel = crownWheel;
  {
    const spur = G.crownSpur;
    const holes = spokeHoles(5, 1.35, 4.05, 0.66, { angle0: 0.35 });
    const w = gearMesh(spur.pts, ZL.ratchetZ - 0.25, ZL.ratchetZ + 0.25, { holes, bevel: 0.03, mat: m.steel });
    w.rotation.z = G.phase.crownSpur;
    crownWheel.add(w);
    crownWheel.add(cyl(0.8, ZL.ratchetZ - 0.32, ZL.ratchetZ + 0.32, m.steel, 24));
    crownWheel.add(cyl(0.34, -2.6, ZL.ratchetZ - 0.5, m.steel, 18));
  }
  gWind.add(crownWheel);

  // Konik taç dişlisi (plaka altında, milde), ayrı katman: tren katmanıyla
  const stemZ = ZL.stemZ;
  const crownBevelG = new THREE.Group();
  crownBevelG.position.set(L.CROWN_WHEEL.x, L.CROWN_WHEEL.y, stemZ);
  ctx.nodes.crownBevel = crownBevelG;
  const dP = Math.atan2(Z.windPinion, Z.crownBevel);    // pinyon konisi yarım açısı
  const dC = Math.PI / 2 - dP;
  {
    const b = bevelGearGeometry({ z: Z.crownBevel, m: M.wind, delta: dC, face: 0.9, dir: -1, gapAtZero: true });
    crownBevelG.add(mesh(b.geo, m.steel));
    // Bağlantı diski + mil
    const hTop = b.hOut;                        // negatif, büyük uç
    crownBevelG.add(mesh(cylZ(1.5, hTop - 0.14, hTop, 32), m.steel));
    crownBevelG.add(mesh(cylZ(0.34, -2.35 - stemZ, ZL.plateBot - stemZ + 0.02, 18), m.steel));
    crownBevelG.add(mesh(cylZ(0.5, hTop - 0.14, ZL.plateBot - stemZ, 20), m.steel));
  }
  // Taç çarkı kapak (alt) köprüsü
  {
    const br = new THREE.Group();
    const pts = hullOfCircles(L.CROWN_WHEEL, 1.5, { x: 16.4, y: 0 }, 1.1, 30);
    br.add(mesh(extrudeXY(shapeFromPts(pts), -2.85, -2.45, { bevel: 0.04, curveSegments: 1 }), m.steel));
    br.add(mesh(cylZ(0.3, -2.7, -2.4, 16), m.gold));
    addScrew(br, 16.4, 0, -2.45, 0.5, m.blued, { dir: 1, rot: 0.3 });
    gPlate.add(br);
  }
  gTrain.add(crownBevelG);

  // ---------------- MİL (stem) ve konik pinyon ----------------
  const stem = new THREE.Group();          // x ekseninde kayar (0..2 mm)
  stem.position.set(0, 0, stemZ);
  const stemRot = new THREE.Group();       // mil ekseni etrafında döner (yerel z = +x dünya)
  {
    // yerel çerçeve: local x = −ẑ, local y = ŷ, local z = x̂ (dünya)
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    stemRot.quaternion.setFromRotationMatrix(basis);
    stem.add(stemRot);
    // Mil çubuğu: yerel z boyunca (dünya x)
    const rod = cyl(0.45, 8.8, 25.5, m.steel, 20);
    stemRot.add(rod);
    // Konik pinyon: apex yerel z = 11.0 (dünya x)
    const pin = bevelGearGeometry({ z: Z.windPinion, m: M.wind, delta: dP, face: 0.9, dir: 1, gapAtZero: false });
    const pm = mesh(pin.geo, m.gold);
    pm.position.z = L.CROWN_WHEEL.x;          // apeks x = 11.0
    stemRot.add(pm);
    // Ayar konik pinyonu ve kavrama disklikleri
    const collar = mesh(cylZ(0.75, L.CROWN_WHEEL.x + 2.35, L.CROWN_WHEEL.x + 2.65, 24), m.gold);
    stemRot.add(collar);
    const collar2 = mesh(cylZ(0.7, 8.8, 9.4, 24), m.gold);
    stemRot.add(collar2);
  }
  gTrain.add(stem);
  ctx.nodes.stem = stem;
  ctx.nodes.stemRot = stemRot;

  // Kurma tacı ve kasa tüpü (kasa modülünde), burada sadece mil kalır.

  // ---------------- AYAR ÇARKI (kadran tarafı) ----------------
  const settingG = new THREE.Group();
  settingG.position.set(L.SETTING_WHEEL.x, L.SETTING_WHEEL.y, 0);
  ctx.nodes.setting = settingG;
  {
    const sp = G.settingSpur;
    const w = gearMesh(sp.pts, 0.3, 0.6, { bevel: 0.02, mat: m.gold });
    w.rotation.z = G.phase.settingSpur;
    settingG.add(w);
    const b = bevelGearGeometry({ z: Z.settingBevel, m: M.wind, delta: dC, face: 0.9, dir: 1, gapAtZero: true });
    const bm = mesh(b.geo, m.steel);
    bm.position.z = stemZ;
    settingG.add(bm);
    // kapak diski
    settingG.add(mesh(cylZ(1.4, stemZ + b.hOut, stemZ + b.hOut + 0.14, 32), m.steel));
    // dikey mil
    settingG.add(cyl(0.34, 0.0, 0.9, m.steel, 16));
  }
  gMotion.add(settingG);

  // ---------------- DAKİKA ÇARKI ve PİNYONU ----------------
  const minuteG = new THREE.Group();
  minuteG.position.set(L.MINUTE_WHEEL.x, L.MINUTE_WHEEL.y, 0);
  ctx.nodes.minuteWheel = minuteG;
  {
    const holes = spokeHoles(4, 0.8, G.minuteW.rf - 0.45, 0.5, { angle0: 0.5 });
    minuteG.add(gearMesh(G.minuteW.pts, 0.3, 0.6, { holes, bevel: 0.02, mat: m.gold }));
    minuteG.add(mesh(ringZ(0.2, 0.9, 0.28, 0.62, 24, 0.02), m.gold));
    const mp = gearMesh(G.minutePin.pts, 0.62, 1.1, { bevel: 0.02, mat: m.steel });
    mp.rotation.z = G.phase.minutePin;
    minuteG.add(mp);
    minuteG.add(cyl(0.3, 0.0, 1.15, m.steel, 16));
  }
  gMotion.add(minuteG);

  // ---------------- KANON PİNYONU + SAAT ÇARKI ----------------
  const cannonG = new THREE.Group();
  cannonG.position.set(0, 0, 0);
  ctx.nodes.cannon = cannonG;
  {
    const cp = gearMesh(G.cannon.pts, 0.3, 0.6, { bevel: 0.02, mat: m.steel });
    cp.rotation.z = G.phase.cannon;
    cannonG.add(cp);
    cannonG.add(mesh(ringZ(0.56, 0.86, 0.3, 3.25, 32, 0.0), m.steel));   // tüp (minute hand)
  }
  gMotion.add(cannonG);

  const hourG = new THREE.Group();
  ctx.nodes.hourWheel = hourG;
  {
    const holes = spokeHoles(4, 1.3, G.hourW.rf - 0.5, 0.6, { angle0: 0.2 });
    hourG.add(gearMesh(G.hourW.pts, 1.06, 1.34, { holes, bevel: 0.02, mat: m.gold }));
    hourG.add(mesh(ringZ(0.9, 1.25, 1.06, 2.7, 32, 0.0), m.gold));     // saat tüpü
  }
  gMotion.add(hourG);

  // ---------------- OTOMATİK KURMA: W1 + rotor pinyonu ----------------
  const w1 = new THREE.Group();
  w1.position.set(L.ROTOR_W1.x, L.ROTOR_W1.y, 0);
  ctx.nodes.rotorW1 = w1;
  {
    const holes = spokeHoles(4, 0.9, G.rotorW1.rf - 0.45, 0.6, { angle0: 0.4 });
    w1.add(gearMesh(G.rotorW1.pts, ZL.rotorGearZ - 0.22, ZL.rotorGearZ + 0.22, { holes, bevel: 0.03, mat: m.gold }));
    const p = gearMesh(G.rotorW1Pin.pts, ZL.ratchetZ - 0.3, ZL.ratchetZ + 0.3, { bevel: 0.025, mat: m.steel });
    p.rotation.z = G.phase.rotorW1Pin;
    w1.add(p);
    w1.add(cyl(0.34, ZL.ratchetZ - 0.6, ZL.rotorGearZ + 0.5, m.steel, 16));
    w1.add(cyl(0.3, ZL.bridgeTop, ZL.ratchetZ + 0.5, m.steel, 16));
  }
  gRotorGear.add(w1);

  const rotorPin = new THREE.Group();
  rotorPin.position.set(L.ROTOR_AXIS.x, L.ROTOR_AXIS.y, 0);
  ctx.nodes.rotorPinion = rotorPin;
  {
    const p = gearMesh(G.rotorPin.pts, ZL.rotorGearZ - 0.27, ZL.rotorGearZ + 0.27, { bevel: 0.025, mat: m.steel });
    p.rotation.z = G.phase.rotorPin;
    rotorPin.add(p);
    rotorPin.add(mesh(ringZ(0.9, 1.5, ZL.rotorGearZ + 0.27, ZL.bridgeTop - 0.02, 32, 0.0), m.steel));
  }
  gRotorGear.add(rotorPin);
  // W1 köprüsü (üst pivot) — rotor dişlileri için
  {
    const br = new THREE.Group();
    const pts = hullOfCircles(L.ROTOR_W1, 1.7, { x: L.ROTOR_W1.x - 2.6, y: L.ROTOR_W1.y + 2.5 }, 1.1, 30);
    br.add(mesh(extrudeXY(shapeFromPts(pts), ZL.rotorGearZ - 0.75, ZL.rotorGearZ - 1.15, { bevel: 0.04, curveSegments: 1 }), m.bridge));
    addJewel(br, L.ROTOR_W1.x, L.ROTOR_W1.y, ZL.rotorGearZ - 1.15, 0.8, -1, m);
    gRotorGear.add(br);
  }

  // ---------------- ROTOR ----------------
  const rotor = new THREE.Group();
  rotor.position.set(L.ROTOR_AXIS.x, L.ROTOR_AXIS.y, 0);
  ctx.nodes.rotor = rotor;
  {
    const zc = ZL.rotorZ;
    const rOut = 16.5, rRimIn = 14.6, rHub = 3.5;
    const a0 = -100 * DEG, a1 = 100 * DEG;
    const outline = [];
    const nArc = 60;
    for (let i = 0; i <= nArc; i++) {
      const a = a0 + ((a1 - a0) * i) / nArc;
      outline.push([rOut * Math.cos(a), rOut * Math.sin(a)]);
    }
    // iç: a1 yönünden hub dairesine
    const hubA1 = a1, hubA0 = a0 + TAU;
    for (let i = 0; i <= 40; i++) {
      const a = hubA1 + ((hubA0 - hubA1) * i) / 40;
      outline.push([rHub * Math.cos(a), rHub * Math.sin(a)]);
    }
    const holes = [];
    const windows = [[-84, -33], [-24, 24], [33, 84]];
    for (const [w0, w1_] of windows) holes.push(annularSector(rHub + 1.4, rRimIn - 0.1, w0 * DEG, w1_ * DEG, 16, 2).reverse());
    const geo = extrudeXY(shapeFromPts(outline, holes), zc - 0.25, zc + 0.25, { bevel: 0.05, curveSegments: 1 });
    worldUV(geo, 0.8, 30 * DEG);
    rotor.add(mesh(geo, m.bridge));
    // Ağır segment (altın)
    const segPts = [];
    const sa0 = -62 * DEG, sa1 = 62 * DEG;
    for (let i = 0; i <= 40; i++) {
      const a = sa0 + ((sa1 - sa0) * i) / 40;
      segPts.push([rOut * Math.cos(a), rOut * Math.sin(a)]);
    }
    for (let i = 40; i >= 0; i--) {
      const a = sa0 + ((sa1 - sa0) * i) / 40;
      segPts.push([(rRimIn + 0.35) * Math.cos(a), (rRimIn + 0.35) * Math.sin(a)]);
    }
    rotor.add(mesh(extrudeXY(shapeFromPts(segPts), zc - 0.55, zc + 0.25, { bevel: 0.06, curveSegments: 1 }), m.rotorGold));
    // Yazı (decal)
    const tex = rotorTextTexture('HOROS  ·  KALİBRE 01  ·  OTOMATİK', 1024, 0.9);
    const decalMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(rOut * 2 * 1.11, rOut * 2 * 1.11), decalMat);
    decal.position.z = zc - 0.56;
    decal.rotation.z = -Math.PI / 2 + 0.0;
    decal.rotation.x = Math.PI;
    decal.userData.noPick = true; decal.userData.noOverlay = true;
    rotor.add(decal);
    // Rulman: dış halka, bilyeler, iç halka
    rotor.add(mesh(ringZ(2.05, 2.5, zc - 0.7, zc + 0.35, 48, 0.03), m.steel));
    rotor.add(mesh(ringZ(1.0, 1.5, zc - 0.7, zc + 0.35, 40, 0.03), m.steel));
    const balls = [];
    for (let k = 0; k < 11; k++) {
      const a = (k * TAU) / 11;
      const bm = mesh(new THREE.SphereGeometry(0.24, 14, 10), m.steelDark);
      bm.position.set(1.78 * Math.cos(a), 1.78 * Math.sin(a), zc - 0.16);
      rotor.add(bm);
    }
    // Merkez vida
    addScrew(rotor, 0, 0, zc - 0.7, 0.85, m.blued, { dir: -1, rot: 0.2 });
    // Rotor mili (hub): tren köprüsünden aşağı
    rotor.add(cyl(0.95, ZL.bridgeTop - 0.02, zc - 0.7, m.steel, 24));
  }
  gRotor.add(rotor);

  return { ratchet, click, crownWheel, crownBevelG, stem, settingG, minuteG, cannonG, hourG, w1, rotorPin, rotor };
}
