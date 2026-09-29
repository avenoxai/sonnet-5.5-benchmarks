// Kasa, cam, kasa arkası, taç, kayış, kadran ve ibreler.
import * as THREE from 'three';
import * as L from '../layout.js';
import { addScrew, cylZ } from './helpers.js';
import {
  extrudeXY, shapeFromPts, circlePts, mesh, mergeAny, latheHard, planarUV, ringZ, thickCurve, chaikin, worldUV,
} from '../three-utils.js';
import { dialTexture, engravingTexture } from '../materials.js';

const { ZL, DEG, TAU } = L;

export const DIAL = { R: 17.5, z0: 2.0, z1: 2.4 };
export const HANDS = { hourZ: 2.78, minuteZ: 3.18, secondZ: 2.64, hourLen: 8.9, minuteLen: 14.9, secondLen: 4.15 };

// ---------------- DAYANAKLAR ----------------
function bezelGeometry() {
  // (r, z) profili: iç duvar → üst pah → düz üst → dış yuvarlak → yan
  const prof = [
    { r: 17.55, z: 2.4 },
    { r: 17.55, z: 4.0 },
    { r: 17.85, z: 4.32, s: true },
    { r: 18.4, z: 4.62, s: true },
    { r: 19.4, z: 4.74 },
    { r: 20.2, z: 4.55, s: true },
    { r: 20.62, z: 4.1, s: true },
    { r: 20.78, z: 3.3 },
    { r: 20.78, z: 2.4 },
    { r: 17.55, z: 2.4 },
  ];
  return latheHard(prof.reverse(), 128);
}

function midCaseGeometry() {
  const prof = [
    { r: 20.78, z: 2.4 },
    { r: 20.78, z: 1.6, s: true },
    { r: 20.62, z: 1.0, s: true },
    { r: 20.62, z: -4.8 },
    { r: 20.35, z: -5.7, s: true },
    { r: 19.7, z: -6.4 },
    { r: 19.7, z: -6.9 },
    { r: 18.3, z: -6.9 },
    { r: 18.3, z: -0.0 },
    { r: 18.3, z: 2.4 },
    { r: 20.78, z: 2.4 },
  ];
  return latheHard(prof.reverse(), 128);
}

function densify(pts, maxLen) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

// Kulak yatay planı (sağ üst boynuz, x>0, y>0). Kayış aralığı 20.7 mm.
const LUG = { y0: 15.0, y1: 26.8, zMid: -0.7, bar: 24.2 };
function lugPlan() {
  const p = [
    [10.35, 15.0], [10.35, 24.6], [10.5, 25.8], [11.2, 26.7], [12.2, 26.8], [13.0, 26.0],
    [13.55, 23.0], [14.0, 19.0], [13.8, 15.0],
  ];
  return densify(chaikin(p, 1), 0.5);
}
export function lugBendZ(y) {
  const t = Math.max(0, Math.min(1, (y - LUG.y0) / (LUG.y1 - LUG.y0)));
  return -3.3 * t * t;
}
function lugGeometry(sx, sy) {
  const shape = shapeFromPts(lugPlan());
  const g = extrudeXY(shape, -3.6, 2.3, { bevel: 0.32, bevelSegments: 3, curveSegments: 1 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = Math.max(0, Math.min(1, (y - LUG.y0) / (LUG.y1 - LUG.y0)));
    const z = p.getZ(i);
    p.setZ(i, LUG.zMid + (z - LUG.zMid) * (1 - 0.42 * t) + lugBendZ(y));
    p.setX(i, p.getX(i) * sx);
    p.setY(i, y * sy);
  }
  g.computeVertexNormals();
  if (sx * sy < 0) {
    // ayna: üçgen sırasını çevir
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, x1, y1, z1);
    }
    g.computeVertexNormals();
  }
  return g;
}

// ---------------- KASA ----------------
export function buildCase(ctx) {
  const m = ctx.mats;
  const layer = ctx.layers;
  // Cam ve çerçeve
  const bezel = mesh(bezelGeometry(), m.steel);
  layer.crystal.group.add(bezel);

  // Kubbeli safir cam (şeffaf, kırılma)
  {
    const prof = [];
    const R = 17.6, h = 1.6, Rs = (R * R + h * h) / (2 * h);
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const r = R * (1 - t);
      const z = 4.15 + (Math.sqrt(Math.max(0, Rs * Rs - r * r)) - (Rs - h));
      prof.push({ r, z, s: true });
    }
    prof.unshift({ r: R, z: 2.9 }, { r: R, z: 4.15 });
    prof.push({ r: 0, z: 4.15 + h, s: true });
    const g = latheHard(prof, 96);
    ctx.crystalMesh = mesh(g, m.glass, { cast: false, receive: false });
    layer.crystal.group.add(ctx.crystalMesh);
  }

  // Orta kasa
  const midG = new THREE.Group();
  const midMesh = mesh(midCaseGeometry(), m.steelBrushed);
  midG.add(midMesh);
  // Kulaklar: dört boynuz (üst/alt × sol/sağ), aşağı doğru kavisli
  for (const sgn of [1, -1]) {
    for (const sx of [1, -1]) {
      midG.add(mesh(lugGeometry(sx, sgn), m.steel));
    }
    // yay çubuğu (boynuzların arasında)
    const barZ = LUG.zMid + (-0.0) + lugBendZ(LUG.bar) - 0.3;
    const bar = mesh(new THREE.CylinderGeometry(0.42, 0.42, 20.9, 16), m.steelDark);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, sgn * LUG.bar, barZ);
    midG.add(bar);
    for (const sx of [-1, 1]) {
      const sc = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 20), m.steel);
      sc.rotation.z = Math.PI / 2;
      sc.position.set(sx * 10.32, sgn * LUG.bar, barZ);
      midG.add(sc);
    }
  }
  // Taç tüpü
  const tube = mesh(new THREE.CylinderGeometry(1.75, 1.75, 2.4, 28), m.steel);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(21.4, 0, ZL.stemZ);
  midG.add(tube);
  // Taç koruma omuzları
  for (const sy of [1, -1]) {
    const g = extrudeXY(shapeFromPts(chaikin([[19.2, sy * 2.2], [22.8, sy * 3.0], [22.9, sy * 6.4], [19.6, sy * 7.2]].map(([x, y]) => [x, y]), 2)), -2.6, 1.0, { bevel: 0.3, bevelSegments: 2, curveSegments: 1 });
    void g;
  }
  layer.case.group.add(midG);
  ctx.nodes.caseMid = midMesh;

  // Kasa arkası halkası + safir cam
  const backG = new THREE.Group();
  {
    const prof = [
      { r: 16.6, z: -6.8 },
      { r: 18.9, z: -6.8 },
      { r: 19.55, z: -7.0 },
      { r: 19.55, z: -8.15, s: true },
      { r: 19.2, z: -8.55, s: true },
      { r: 17.6, z: -8.55 },
      { r: 16.9, z: -8.2, s: true },
      { r: 16.6, z: -7.9 },
      { r: 16.6, z: -6.8 },
    ];
    backG.add(mesh(latheHard(prof.reverse(), 128), m.steel));
    // Düz safir cam
    const glass = mesh(cylZ(16.75, -8.1, -7.2, 96), m.glassBack, { cast: false, receive: false });
    backG.add(glass);
    // Cam alt/üst ince halkası
    backG.add(mesh(ringZ(16.5, 16.95, -8.2, -7.1, 96, 0.02), m.steelDark));
    // 6 vida
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.26;
      addScrew(backG, 18.2 * Math.cos(a), 18.2 * Math.sin(a), -8.55, 0.55, m.steel, { dir: -1, rot: a });
    }
    // Kazıma yazı
    const tex = engravingTexture(['HOROS · KALİBRE 01 · OTOMATİK · 21 TAŞ · 50 M']);
    const decal = new THREE.Mesh(new THREE.CircleGeometry(19.2, 96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.75 }));
    decal.position.z = -8.57;
    decal.rotation.x = Math.PI;
    decal.userData.noPick = true; decal.userData.noOverlay = true;
    backG.add(decal);
  }
  layer.caseback.group.add(backG);

  // Taç
  const crown = new THREE.Group();
  {
    // Tırtıllı gövde
    const teeth = 30;
    const pts = [];
    for (let i = 0; i < teeth * 4; i++) {
      const a = (i / (teeth * 4)) * TAU;
      const k = i % 4;
      const r = k === 0 || k === 1 ? 2.75 : 2.38;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const body = extrudeXY(shapeFromPts(pts), 0.4, 3.7, { bevel: 0.1, curveSegments: 1 });
    const bodyMesh = mesh(body, m.steel);
    crown.add(bodyMesh);
    // Üst kubbe + logo
    const dome = mesh(latheHard([
      { r: 0.01, z: 3.3 }, { r: 2.35, z: 3.3 }, { r: 2.35, z: 3.55 }, { r: 2.2, z: 3.75, s: true }, { r: 1.5, z: 3.9, s: true }, { r: 0, z: 3.95 },
    ], 40), m.gold);
    crown.add(dome);
    // Taç alt boyun
    crown.add(mesh(cylZ(1.6, -1.2, 0.4, 24), m.steel));
    // Yerel z = mil ekseni (dünya +x) → döndürme
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    crown.quaternion.setFromRotationMatrix(basis);
  }
  const crownPivot = new THREE.Group();
  crownPivot.position.set(22.5, 0, ZL.stemZ);
  const crownAligned = new THREE.Group();
  crownAligned.quaternion.copy(crown.quaternion);
  crown.quaternion.identity();
  crownAligned.add(crown);
  crownPivot.add(crownAligned);
  layer.crown.group.add(crownPivot);
  ctx.nodes.crownPivot = crownPivot;   // kayma için
  ctx.nodes.crownSpin = crown;          // yerel z = mil ekseni

  // Kayış
  buildStrap(ctx);
}

function strapPath(sign) {
  // Kulak çubuğundan başla, kol bileği yayına doğru bük: (y, z) düzleminde çember benzeri
  const pts = [];
  const y0 = LUG.bar, z0 = LUG.zMid + lugBendZ(LUG.bar) - 0.3;
  const R = 32;          // bilek yarıçapı
  const cz = z0 - R;     // bilek merkezi z
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const arc = t * 80;   // mm boyunca
    const ang = arc / R;
    const y = sign * (y0 - 3.0 + R * Math.sin(ang) + 3.0 * Math.cos(ang) * 0);
    // Başlangıçta biraz düz (5 mm), sonra bilek yayı
    const yy = sign * (y0 + R * Math.sin(ang));
    const zz = cz + R * Math.cos(ang);
    pts.push(new THREE.Vector3(0, yy, zz));
    void y;
  }
  return new THREE.CatmullRomCurve3(pts);
}

function buildStrap(ctx) {
  const m = ctx.mats;
  const g = new THREE.Group();
  for (const sign of [1, -1]) {
    const curve = strapPath(sign);
    const N = 60;
    const width0 = 20.0, width1 = 16.5, th0 = 3.6, th1 = 2.6;
    const pos = [], nor = [], uv = [], idx = [];
    const ring = 6;
    let vlen = 0;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      if (prev) vlen += p.distanceTo(prev);
      prev = p;
      const side = new THREE.Vector3(1, 0, 0);
      const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();   // yüzeye dik
      const w = (width0 + (width1 - width0) * t) / 2;
      const th = th0 + (th1 - th0) * t;
      // kesit: dikdörtgen yuvarlak köşeli (6 nokta yarım) — üst yüz + alt yüz + yanlar
      const prof = [
        [-w, 0], [-w + 0.5, th * 0.5 + 0.0], [-w + 1.2, th], [w - 1.2, th], [w - 0.5, th * 0.5], [w, 0],
        [w - 0.6, -0.5], [-w + 0.6, -0.5],
      ];
      prof.forEach(([x, h], k) => {
        const p2 = p.clone().addScaledVector(side, x).addScaledVector(nrm, h * (sign > 0 ? 1 : 1));
        pos.push(p2.x, p2.y, p2.z);
        uv.push((x + w) / (2 * w), vlen / 12);
      });
    }
    const K = 8;
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < K; k++) {
        const a = i * K + k, b = i * K + ((k + 1) % K), c = (i + 1) * K + k, d = (i + 1) * K + ((k + 1) % K);
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mm = mesh(geo, m.leather);
    mm.material.side = THREE.DoubleSide;
    g.add(mm);
  }
  ctx.layers.strap.group.add(g);
}

// ---------------- KADRAN ----------------
export function buildDial(ctx, themeName = 'midnight') {
  const m = ctx.mats;
  const g = ctx.layers.dial.group;
  const { R, z0, z1 } = DIAL;
  const holes = [
    circlePts(0, 0, 0.95, 24).reverse(),
    circlePts(L.FOURTH.x, L.FOURTH.y, 0.3, 16).reverse(),
  ];
  const shape = shapeFromPts(circlePts(0, 0, R, 160), holes);
  const geo = extrudeXY(shape, z0, z1, { bevel: 0.05, curveSegments: 1 });
  planarUV(geo, 0, 0, 2 * R);
  const tex = dialTexture(themeName, { R });
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex.map, bumpMap: tex.bump, bumpScale: 0.6, metalness: 0.55, roughness: 0.42, envMapIntensity: 0.9,
    clearcoat: 0.35, clearcoatRoughness: 0.4,
  });
  const dialMesh = mesh(geo, mat);
  g.add(dialMesh);
  ctx.nodes.dialMesh = dialMesh;
  ctx.nodes.dialMat = mat;
  ctx.nodes.dialTheme = themeName;

  // Uygulama indeksleri (rose altın)
  const idxMats = [];
  const idxGroup = new THREE.Group();
  const bar = (len, w, h) => {
    const s = shapeFromPts([[-w / 2, -len / 2], [w / 2, -len / 2], [w / 2 * 0.86, len / 2], [-w / 2 * 0.86, len / 2]]);
    return extrudeXY(s, 0, h, { bevel: 0.06, curveSegments: 1 });
  };
  for (let i = 0; i < 12; i++) {
    if (i === 9) continue;       // 9: küçük saniye
    const a = (i / 12) * TAU;   // saat yönünde, 12'den
    const r = 13.3;
    const long = i % 3 === 0;
    const len = long ? 3.4 : 2.6, w = long ? 0.95 : 0.7;
    const geo2 = bar(len, w, 0.42);
    const mm = mesh(geo2, m.roseGold);
    mm.position.set(Math.sin(a) * (r + 0.5), Math.cos(a) * (r + 0.5), z1);
    mm.rotation.z = -a;
    idxGroup.add(mm);
    if (i === 0) {
      // 12'de çift çubuk
      const mm2 = mesh(bar(len, w * 0.6, 0.42), m.roseGold);
      mm.scale.x = 0.62;
      mm2.scale.x = 0.62;
      mm.position.set(Math.sin(a) * (r + 0.5) - 0.62 * Math.cos(a), Math.cos(a) * (r + 0.5) + 0.62 * Math.sin(a), z1);
      mm2.position.set(Math.sin(a) * (r + 0.5) + 0.62 * Math.cos(a), Math.cos(a) * (r + 0.5) - 0.62 * Math.sin(a), z1);
      mm2.rotation.z = -a;
      idxGroup.add(mm2);
    }
  }
  g.add(idxGroup);
  // Alt kadran halkası
  const ring = mesh(ringZ(4.55, 4.85, z1 - 0.02, z1 + 0.14, 64, 0.02), m.roseGold);
  ring.position.set(L.FOURTH.x, L.FOURTH.y, 0);
  g.add(ring);
  return { dialMesh, mat };
}

export function setDialTheme(ctx, name) {
  const tex = dialTexture(name, { R: DIAL.R });
  const mat = ctx.nodes.dialMat;
  mat.map.dispose(); mat.bumpMap.dispose();
  mat.map = tex.map; mat.bumpMap = tex.bump;
  mat.needsUpdate = true;
  ctx.nodes.dialTheme = name;
}

// ---------------- İBRELER ----------------
function dauphine(len, tail, wMax, h, { tipTaper = 0.9 } = {}) {
  // Faset dauphine: merkez çizgi boyunca (y), yarı genişlik profili w(y)
  const stations = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -tail + (len + tail) * t;
    // genişlik profili: kuyruktan hızlıca büyür, ortada max, uca sivrilir
    const u = (y + tail) / (len + tail);
    let w = wMax * Math.pow(Math.sin(Math.min(1, u * 1.0) * Math.PI * 0.5 + 0.0), 0.6) * (1 - Math.pow(u, 2.2) * tipTaper);
    if (u < 0.12) w *= u / 0.12 * 0.6 + 0.4;
    stations.push({ y, w: Math.max(0.02, w) });
  }
  const pos = [];
  const push = (x, y, z) => pos.push(x, y, z);
  const tri = (a, b, c) => { push(...a); push(...b); push(...c); };
  for (let i = 0; i < n; i++) {
    const s0 = stations[i], s1 = stations[i + 1];
    const L0 = [-s0.w, s0.y, 0], R0 = [s0.w, s0.y, 0], T0 = [0, s0.y, h];
    const L1 = [-s1.w, s1.y, 0], R1 = [s1.w, s1.y, 0], T1 = [0, s1.y, h];
    // sol yüz
    tri(L0, T0, L1); tri(T0, T1, L1);
    // sağ yüz
    tri(R0, R1, T0); tri(T0, R1, T1);
    // alt yüz
    tri(L0, L1, R0); tri(R0, L1, R1);
  }
  // uç kapakları
  const f0 = stations[0], fN = stations[n];
  tri([-f0.w, f0.y, 0], [f0.w, f0.y, 0], [0, f0.y, h]);
  tri([-fN.w, fN.y, 0], [0, fN.y, h], [fN.w, fN.y, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildHands(ctx) {
  const m = ctx.mats;
  const g = ctx.layers.hands.group;

  // Saat ibresi
  const hour = new THREE.Group();
  hour.position.set(0, 0, HANDS.hourZ);
  {
    const geo = dauphine(HANDS.hourLen, 1.9, 0.78, 0.26, { tipTaper: 0.98 });
    hour.add(mesh(geo, m.roseGold));
    hour.add(mesh(cylZ(1.05, -0.08, 0.24, 28), m.roseGold));
    // lüm kanalı
    const lume = mesh(extrudeXY(shapeFromPts([[-0.16, 3.2], [0.16, 3.2], [0.1, 7.2], [-0.1, 7.2]]), 0.24, 0.30, { bevel: 0 }), m.lume);
    hour.add(lume);
  }
  g.add(hour);
  ctx.nodes.hourHand = hour;

  const minute = new THREE.Group();
  minute.position.set(0, 0, HANDS.minuteZ);
  {
    const geo = dauphine(HANDS.minuteLen, 2.3, 0.62, 0.24, { tipTaper: 0.98 });
    minute.add(mesh(geo, m.roseGold));
    minute.add(mesh(cylZ(0.8, -0.08, 0.22, 28), m.roseGold));
    minute.add(mesh(extrudeXY(shapeFromPts([[-0.13, 3.4], [0.13, 3.4], [0.08, 12.9], [-0.08, 12.9]]), 0.22, 0.28, { bevel: 0 }), m.lume));
  }
  g.add(minute);
  ctx.nodes.minuteHand = minute;

  // Saniye ibresi (F merkezli)
  const sec = new THREE.Group();
  sec.position.set(L.FOURTH.x, L.FOURTH.y, HANDS.secondZ);
  {
    const shaft = mesh(extrudeXY(shapeFromPts([[-0.05, -1.3], [0.05, -1.3], [0.05, HANDS.secondLen], [-0.05, HANDS.secondLen]]), 0, 0.09, { bevel: 0 }), m.roseGold);
    sec.add(shaft);
    // karşı ağırlık
    const cw = mesh(extrudeXY(shapeFromPts(circlePts(0, -1.05, 0.34, 20), [circlePts(0, -1.05, 0.15, 14).reverse()]), 0, 0.09, { bevel: 0.01, curveSegments: 1 }), m.roseGold);
    sec.add(cw);
    sec.add(mesh(cylZ(0.28, -0.05, 0.14, 20), m.roseGold));
    sec.add(mesh(cylZ(0.12, 0.14, 0.24, 14), m.steel));
  }
  g.add(sec);
  ctx.nodes.secondHand = sec;
}
