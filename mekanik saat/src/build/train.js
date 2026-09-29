// Dişli takımı, çıkış (escapement), balans, saç yay ve yay kutusu.
import * as THREE from 'three';
import * as L from '../layout.js';
import { gearData } from './gearset.js';
import { gearMesh, spokeHoles, cylZ, addScrew, rod } from './helpers.js';
import {
  extrudeXY, shapeFromPts, circlePts, ringZ, mesh, mergeAny, latheHard, thickCurve, bezier, chaikin,
} from '../three-utils.js';

const { Z, ZL, DEG, TAU } = L;

const bevelFor = (m) => Math.min(0.025, m * 0.11);

function cyl(r, z0, z1, mat, seg = 24) {
  return mesh(cylZ(r, z0, z1, seg), mat);
}

/** Bir pinyon/mil mesh'i ve çark mesh'i eksenine eklenir. */
export function buildTrain(ctx) {
  const m = ctx.mats;
  const G = gearData();
  const ESC = L.ESCAPEMENT;
  const ep = ESC.p;

  const grpTrain = ctx.layers.train.group;
  const grpBarrel = ctx.layers.barrel.group;

  // ---------------- FIÇI (yay kutusu) ----------------
  const barrel = new THREE.Group();
  barrel.position.set(L.BARREL.x, L.BARREL.y, 0);
  {
    const b = G.barrel;
    const ring = gearMesh(b.pts, -2.95, -2.35, {
      holes: [circlePts(0, 0, 7.25, 96).reverse()], bevel: bevelFor(L.M.barrel), mat: m.goldSoft,
    });
    barrel.add(ring);
    barrel.add(mesh(ringZ(7.25, 7.72, -3.5, -2.95, 96, 0.02), m.goldSoft));
    barrel.add(mesh(ringZ(7.25, 7.72, -2.35, -2.1, 96, 0.02), m.goldSoft));
    barrel.add(mesh(ringZ(1.2, 7.7, -2.25, -2.1, 96, 0.02), m.goldSoft));
    barrel.add(mesh(ringZ(1.2, 1.7, -2.5, -2.25, 48, 0.02), m.goldSoft));
  }
  grpBarrel.add(barrel);
  ctx.nodes.barrel = barrel;

  // Fıçı kapağı: ayrı katman
  const lidGroup = new THREE.Group();
  lidGroup.position.set(L.BARREL.x, L.BARREL.y, 0);
  lidGroup.add(mesh(ringZ(1.2, 7.55, -3.66, -3.5, 96, 0.02), m.steelBrushed));
  lidGroup.add(mesh(ringZ(1.2, 1.75, -3.86, -3.66, 48, 0.02), m.steelBrushed));
  ctx.layers.barrelLid.group.add(lidGroup);
  ctx.nodes.barrelLid = lidGroup;

  // Ana yay (dinamik geometri, fıçı çerçevesinde)
  const spring = mesh(new THREE.BufferGeometry(), m.spring, { cast: false });
  barrel.add(spring);
  ctx.nodes.spring = spring;

  // Fıçı mili: mandal çarkıyla dönen
  const arbor = new THREE.Group();
  arbor.position.set(L.BARREL.x, L.BARREL.y, 0);
  arbor.add(cyl(1.0, -5.35, -1.2, m.steel, 32));
  arbor.add(cyl(1.4, -3.4, -2.3, m.steel, 32));
  // yay kancası
  {
    const hook = mesh(new THREE.BoxGeometry(0.5, 0.3, 0.9), m.steel);
    hook.position.set(1.5, 0, -2.85);
    arbor.add(hook);
  }
  grpBarrel.add(arbor);
  ctx.nodes.barrelArbor = arbor;

  // ---------------- MERKEZ ÇARKI ----------------
  const centerG = new THREE.Group();
  centerG.position.set(L.C.x, L.C.y, 0);
  {
    const rf = G.centerW.rf;
    const holes = spokeHoles(5, 1.05, rf - 0.42, 0.62, { angle0: 0.31 });
    centerG.add(gearMesh(G.centerW.pts, -1.95, -1.55, { holes, bevel: bevelFor(L.M.centerWheel), mat: m.gold }));
    centerG.add(mesh(ringZ(0.5, 1.1, -1.98, -1.52, 32, 0.02), m.gold));
    const pin = gearMesh(G.centerPin.pts, -3.0, -2.3, { bevel: 0.03, mat: m.steel });
    pin.rotation.z = G.phase.centerPin;
    centerG.add(pin);
    centerG.add(cyl(0.55, -3.95, 0.95, m.steel, 28));
    centerG.add(cyl(0.8, -2.3, -1.95, m.steel, 28));
  }
  grpTrain.add(centerG);
  ctx.nodes.center = centerG;

  // ---------------- 3. ÇARK ----------------
  const thirdG = new THREE.Group();
  thirdG.position.set(L.THIRD.x, L.THIRD.y, 0);
  {
    const rf = G.thirdW.rf;
    const holes = spokeHoles(5, 0.95, rf - 0.4, 0.58, { angle0: 0.1 });
    thirdG.add(gearMesh(G.thirdW.pts, -2.65, -2.25, { holes, bevel: bevelFor(L.M.thirdWheel), mat: m.gold }));
    thirdG.add(mesh(ringZ(0.3, 0.95, -2.68, -2.22, 28, 0.02), m.gold));
    const pin = gearMesh(G.thirdPin.pts, -2.05, -1.45, { bevel: 0.025, mat: m.steel });
    pin.rotation.z = G.phase.thirdPin;
    thirdG.add(pin);
    thirdG.add(cyl(0.3, -3.95, -1.2, m.steel, 20));
  }
  grpTrain.add(thirdG);
  ctx.nodes.third = thirdG;

  // ---------------- 4. ÇARK (saniye) ----------------
  const fourthG = new THREE.Group();
  fourthG.position.set(L.FOURTH.x, L.FOURTH.y, 0);
  {
    const rf = G.fourthW.rf;
    const holes = spokeHoles(6, 0.9, rf - 0.36, 0.5, { angle0: 0.2 });
    fourthG.add(gearMesh(G.fourthW.pts, -3.35, -2.95, { holes, bevel: bevelFor(L.M.fourthWheel), mat: m.gold }));
    fourthG.add(mesh(ringZ(0.28, 0.9, -3.38, -2.92, 28, 0.02), m.gold));
    const pin = gearMesh(G.fourthPin.pts, -2.85, -2.05, { bevel: 0.025, mat: m.steel });
    pin.rotation.z = G.phase.fourthPin;
    fourthG.add(pin);
    fourthG.add(cyl(0.28, -3.95, -1.2, m.steel, 20));
    fourthG.add(cyl(0.2, -1.2, 2.78, m.steel, 16));   // saniye ibresi mili (kadran tarafı)
  }
  grpTrain.add(fourthG);
  ctx.nodes.fourth = fourthG;

  // ---------------- ÇIKIŞ ÇARKI ----------------
  const escG = new THREE.Group();
  escG.position.set(L.ESCAPE.x, L.ESCAPE.y, 0);
  {
    const holes = spokeHoles(5, 0.75, ep.Rroot - 0.28, 0.42, { angle0: 0.28 });
    const wheel = gearMesh(G.escapeW.pts, -1.95, -1.55, { holes, bevel: 0.02, mat: m.steel });
    wheel.rotation.z = L.ESC_ROT;
    escG.add(wheel);
    const hub = mesh(ringZ(0.2, 0.78, -1.98, -1.52, 24, 0.015), m.steel);
    escG.add(hub);
    const pin = gearMesh(G.escapePin.pts, -3.55, -2.75, { bevel: 0.012, mat: m.steel });
    pin.rotation.z = G.phase.escapePin;
    escG.add(pin);
    escG.add(cyl(0.2, -3.95, -1.2, m.steel, 16));
  }
  grpTrain.add(escG);
  ctx.nodes.escapeWheel = escG;

  // ---------------- ÇAPA (pallet fork) ----------------
  const forkG = new THREE.Group();
  forkG.position.set(L.PALLET.x, L.PALLET.y, 0);
  {
    const zF0 = -1.9, zF1 = -1.62;
    const parts = [];
    // Göbek
    const hub = extrudeXY(shapeFromPts(circlePts(0, 0, 0.9, 32), [circlePts(0, 0, 0.22, 16)]), zF0, zF1, { bevel: 0.03 });
    parts.push(hub);
    // Kollar: göbekten taş merkezlerine
    ESC.stones.forEach((s) => {
      // taşın P-göreli merkez noktası (çokgen centroid)
      let cx = 0, cy = 0;
      s.rel.forEach((q) => { cx += q.x; cy += q.y; });
      cx /= s.rel.length; cy /= s.rel.length;
      const arm = thickCurve([[0, 0], [cx * 0.55, cy * 0.55], [cx, cy]], [0.9, 0.62, 0.56], 10);
      parts.push(extrudeXY(shapeFromPts(arm), zF0, zF1, { bevel: 0.03, curveSegments: 1 }));
    });
    // Kuyruk: boyuna uzanan gövde + boynuzlar (huni ağızlı yuva)
    const tailPts = [];
    const hw = (along) => (along <= 5.45 ? 0.28 : 0.28 + (along - 5.45) * 0.94);
    // sağ taraf (x>0) aşağı doğru
    tailPts.push([0.42, -0.5], [0.34, -3.0], [0.30, -4.7], [0.62, -5.0]);
    tailPts.push([hw(5.45) + 0.42, -5.45], [hw(5.95) + 0.36, -5.95]);
    tailPts.push([hw(5.95), -5.95], [hw(5.45), -5.45], [0.28, -5.0]);
    // sol taraf yukarı (ayna)
    tailPts.push([-0.28, -5.0], [-hw(5.45), -5.45], [-hw(5.95), -5.95]);
    tailPts.push([-hw(5.95) - 0.36, -5.95], [-hw(5.45) - 0.42, -5.45], [-0.62, -5.0]);
    tailPts.push([-0.30, -4.7], [-0.34, -3.0], [-0.42, -0.5]);
    parts.push(extrudeXY(shapeFromPts(tailPts), zF0, zF1, { bevel: 0.03, curveSegments: 1 }));
    // Çapa gövdesi çelik
    forkG.add(mesh(mergeAny(parts), m.steel));
    // Taşlar (yakut)
    ESC.stones.forEach((s) => {
      const pts = s.rel.map((q) => [q.x, q.y]);
      forkG.add(mesh(extrudeXY(shapeFromPts(pts), -2.06, -1.46, { bevel: 0.03, curveSegments: 1 }), m.ruby));
    });
    // Koruma pimi: kuyruk altında ince çubuk + pim
    const bar = mesh(extrudeXY(shapeFromPts([[-0.09, -4.5], [0.09, -4.5], [0.09, -5.86], [-0.09, -5.86]]), -2.05, -1.86, { bevel: 0.01, curveSegments: 1 }), m.steel);
    forkG.add(bar);
    const pin = mesh(cylZ(0.11, -2.5, -1.86, 12), m.steel);
    pin.position.set(0, -5.8, 0);
    forkG.add(pin);
    // Pivot mili
    forkG.add(cyl(0.2, -3.95, -1.2, m.steel, 16));
    forkG.add(cyl(0.34, -2.05, -1.55, m.steel, 20));
  }
  forkG.rotation.z = L.ESC_ROT;
  grpTrain.add(forkG);
  ctx.nodes.fork = forkG;

  // ---------------- BALANS ÇARKI ----------------
  const balG = new THREE.Group();
  balG.position.set(L.BALANCE.x, L.BALANCE.y, 0);
  const balInner = new THREE.Group();     // θ ile döner; yerel çerçeve escapement çerçevesi
  balInner.rotation.z = L.ESC_ROT;
  balG.add(balInner);
  {
    const zc = ZL.L3;               // -3.15
    const rOut = 5.4, rIn = 4.95;
    // Jant
    balInner.add(mesh(ringZ(rIn, rOut, zc - 0.32, zc + 0.32, 96, 0.04), m.gold));
    // Kollar
    const armPts = [];
    const arms = 3;
    for (let k = 0; k < arms; k++) {
      const a = (k * TAU) / arms + 0.4;
      const w = thickCurve([[Math.cos(a) * 0.8, Math.sin(a) * 0.8], [Math.cos(a) * 2.8, Math.sin(a) * 2.8], [Math.cos(a) * (rIn + 0.1), Math.sin(a) * (rIn + 0.1)]], [1.05, 0.78, 0.72], 10);
      armPts.push(extrudeXY(shapeFromPts(w), zc - 0.2, zc + 0.2, { bevel: 0.03, curveSegments: 1 }));
    }
    balInner.add(mesh(mergeAny(armPts), m.gold));
    balInner.add(mesh(ringZ(0.16, 1.2, zc - 0.28, zc + 0.28, 40, 0.03), m.gold));
    // Zaman ayar vidaları (rim altında/üstünde) ve ağırlık cıvataları
    const screws = [];
    const nS = 20;
    for (let k = 0; k < nS; k++) {
      const a = (k * TAU) / nS;
      const g = mesh(cylZ(0.17, zc - 0.62, zc - 0.28, 14), m.goldSoft);
      g.position.set(Math.cos(a) * (rOut - 0.24), Math.sin(a) * (rOut - 0.24), 0);
      balInner.add(g);
      const cap = mesh(cylZ(0.11, zc - 0.7, zc - 0.62, 14), m.blued);
      cap.position.copy(g.position);
      balInner.add(cap);
    }
    // Mil (staff): alt/üst pivotlar
    balInner.add(cyl(0.16, -4.75, -1.25, m.steel, 16));
    balInner.add(cyl(0.34, -3.85, -3.4, m.steel, 20));
    // İmpuls makarası: plaka tarafında disk, taş çapa düzlemine uzanır
    balInner.add(mesh(ringZ(0.16, 1.45, -1.55, -1.35, 48, 0.02), m.steel));
    const jewel = mesh(cylZ(0.25, -1.82, -1.55, 18), m.ruby);
    jewel.position.set(0, ep.rj, 0);
    balInner.add(jewel);
    // Emniyet makarası (hilal kesitli)
    const safety = [];
    const sr = 0.85;
    const ptsS = [];
    const cres = 0.44;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU;
      const x = sr * Math.cos(a), y = sr * Math.sin(a);
      // hilal: (0, sr) merkezli cres yarıçaplı çukur (P yönü +y)
      const dx = x - 0, dy = y - sr;
      if (Math.hypot(dx, dy) < cres) {
        const ang = Math.atan2(dy, dx);
        ptsS.push([cres * Math.cos(ang), sr + cres * Math.sin(ang)]);
      } else ptsS.push([x, y]);
    }
    // Çukur bölümünü yaklaşık dairesel bırak (basit çokgen kesişimi)
    balInner.add(mesh(extrudeXY(shapeFromPts(ptsS), -2.32, -2.08, { bevel: 0.02, curveSegments: 1 }), m.steel));
    // Bilezik (collet) — saç yay tutucu
    balInner.add(mesh(ringZ(0.16, 0.5, -3.75, -3.4, 24, 0.02), m.gold));
  }
  // Hareket izi (motion blur) hayalet kopyaları: jant + kollar + göbek, yarı saydam
  {
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0xe8b95a, transparent: true, opacity: 0.085, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const zc = ZL.L3;
    const geos = [ringZ(4.95, 5.4, zc - 0.32, zc + 0.32, 72, 0)];
    const armG = [];
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3 + 0.4;
      const w = thickCurve([[Math.cos(a) * 0.8, Math.sin(a) * 0.8], [Math.cos(a) * 2.8, Math.sin(a) * 2.8], [Math.cos(a) * 5.0, Math.sin(a) * 5.0]], [1.05, 0.78, 0.72], 8);
      armG.push(extrudeXY(shapeFromPts(w), zc - 0.2, zc + 0.2, { bevel: 0, curveSegments: 1 }));
    }
    const merged = mergeAny([...geos, ...armG]);
    ctx.nodes.balanceGhosts = [];
    for (let i = 0; i < 8; i++) {
      const gm = mesh(merged, ghostMat, { cast: false, receive: false });
      gm.visible = false;
      gm.userData.noPick = true; gm.userData.noOverlay = true;
      balInner.add(gm);
      ctx.nodes.balanceGhosts.push(gm);
    }
  }
  // Balans ayrı katmanda (dışarı patlama için)
  ctx.layers.balance.group.add(balG);
  ctx.nodes.balance = balInner;

  // Saç yay: dünya sabit çerçevesinde
  const hair = mesh(new THREE.BufferGeometry(), m.hairspring, { cast: false });
  hair.position.set(L.BALANCE.x, L.BALANCE.y, 0);
  ctx.layers.balance.group.add(hair);
  ctx.nodes.hairspring = hair;
  makeHairspring(ctx, hair);

  return {
    barrel, lidGroup, arbor, centerG, thirdG, fourthG, escG, forkG, balG, balInner, hair,
  };
}

// -------- Saç yay: dinamik tüp --------
const HAIR = { turns: 10.5, r0: 0.62, r1: 3.62, z: -3.7, seg: 26, sides: 4, w: 0.034, h: 0.075, aStud: 250 * DEG };
export function makeHairspring(ctx, mesh_) {
  const n = Math.ceil(HAIR.turns * HAIR.seg) + 1;
  const pos = new Float32Array(n * HAIR.sides * 3);
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < HAIR.sides; s++) {
      const a = i * HAIR.sides + s, b = i * HAIR.sides + ((s + 1) % HAIR.sides);
      const c = (i + 1) * HAIR.sides + s, d = (i + 1) * HAIR.sides + ((s + 1) % HAIR.sides);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = mesh_.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  HAIR.n = n;
  updateHairspring(mesh_, 0);
}

/** theta: balans açısı (rad). Dış uç (yükleme noktası) sabit, iç uç theta kadar döner. */
export function updateHairspring(mesh_, theta) {
  const g = mesh_.geometry;
  const pos = g.attributes.position;
  const { n, sides, w, h, turns, r0, r1, z } = HAIR;
  const aStud = HAIR.aStud;   // dış uç açısı (dünya)
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);                    // 0 iç, 1 dış
    const r = r0 + (r1 - r0) * u;
    const ang = aStud - TAU * turns * (1 - u) + theta * (1 - u);
    const c = Math.cos(ang), s = Math.sin(ang);
    const cx = r * c, cy = r * s;
    // kesit: radyal (w) × z (h)
    for (let k = 0; k < sides; k++) {
      const sx = k === 0 || k === 3 ? -1 : 1, sz = k < 2 ? -1 : 1;
      const rr = r + sx * w;
      pos.setXYZ(i * sides + k, rr * c, rr * s, z + sz * h);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}
export const hairStudPos = () => {
  const r = HAIR.r1;
  return { x: r * Math.cos(HAIR.aStud), y: r * Math.sin(HAIR.aStud) };
};

// -------- Ana yay --------
const SPRING = { rArbor: 1.4, rWall: 7.15, t: 0.13, h: 0.9, z: -2.85, maxTurns: L.SPRING_MAX_TURNS };
export function updateSpring(mesh_, stored) {
  // stored: fıçıya göre kurulu tur sayısı (0..maxTurns)
  const { rArbor, rWall, t, h, z, maxTurns } = SPRING;
  const f = Math.max(0, Math.min(1, stored / maxTurns));
  // Yay uzunluğu: tam kurulu iken arbor çevresinde ~14 sıkı sarım
  const Ltot = (() => {
    // arbor etrafında N tur sıkı spiral uzunluğu ≈ 2π N (rArbor + tN/2)
    const N = 13.5;
    return TAU * N * (rArbor + (t * N) / 2);
  })();
  // Arbor üzerindeki uzunluk oranı: 0.06 (boş) .. 0.93 (dolu)
  const fa = 0.06 + 0.87 * f;
  const La = Ltot * fa;
  // Arbor sarımı: r(θ) = rArbor + t θ/2π ; s(θ) = rArbor θ + tθ²/(4π)
  const solveTheta = (s) => {
    const A = t / (4 * Math.PI);
    return (-rArbor + Math.sqrt(rArbor * rArbor + 4 * A * s)) / (2 * A);
  };
  const thA = solveTheta(La);
  // Duvar sarımı: dıştan içeriye r(θ) = rWall - tθ/2π ; kalan uzunluk
  const Lrest = Ltot - La;
  const Lw = Math.max(0, Lrest - 4.5);         // ara S eğrisi payı
  const solveWall = (s) => {
    const A = t / (4 * Math.PI);
    // s = rWall θ - A θ²
    const disc = rWall * rWall - 4 * A * s;
    return (rWall - Math.sqrt(Math.max(0, disc))) / (2 * A);
  };
  const thW = solveWall(Lw);
  const pts = [];
  const nA = Math.max(8, Math.ceil(thA / 0.12));
  // arbor sarımı (iç uç açısı 0)
  for (let i = 0; i <= nA; i++) {
    const th = (thA * i) / nA;
    const r = rArbor + (t * th) / TAU;
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  const endA = pts[pts.length - 1];
  const rEndA = Math.hypot(endA[0], endA[1]);
  const angEndA = thA;
  // duvar sarımının iç ucu
  const rInW = rWall - (t * thW) / TAU;
  const angWallStart = angEndA + 1.4;            // duvar sarımının başlangıcı (iç uçtan)
  const wallPts = [];
  const nW = Math.max(6, Math.ceil(thW / 0.12));
  for (let i = 0; i <= nW; i++) {
    const th = thW * (1 - i / nW);               // içten dışa doğru artan yarıçap
    const r = rWall - (t * th) / TAU;
    // açı: dış uç açısı = angOut ; iç uç = angOut + thW... (dışta sabit)
    wallPts.push({ r, th });
  }
  // Duvar: dış uç açısı 0 sabit (fıçıya kancalı); içe doğru dönerek gider
  const angOutHook = 0.6;
  const wallXY = wallPts.map(({ r, th }) => [r * Math.cos(angOutHook + th), r * Math.sin(angOutHook + th)]);
  const wallStartAng = angOutHook + thW;
  // Ara eğri: arbor uçtan duvar başlangıcına (cubic Bezier, teğetler dairesel)
  const p0 = endA;
  const tA = [-Math.sin(angEndA), Math.cos(angEndA)];
  const w0 = wallXY[0];
  const rW0 = Math.hypot(w0[0], w0[1]);
  const tW = [-Math.sin(wallStartAng), Math.cos(wallStartAng)];
  const dd = Math.max(1.5, Math.hypot(w0[0] - p0[0], w0[1] - p0[1]) * 0.55);
  const mid = bezier(p0, [p0[0] + tA[0] * dd, p0[1] + tA[1] * dd], [w0[0] - tW[0] * dd, w0[1] - tW[1] * dd], w0, 22);
  const all = pts.concat(mid.slice(1), wallXY.slice(1));
  // Şerit geometrisi (kalınlık t, yükseklik h)
  buildRibbon(mesh_.geometry, all, t, z - h / 2, z + h / 2);
}

const RIBBON_N = 460;
function resample(xy, N) {
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = (total * i) / (N - 1);
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const u = (d - cum[j]) / seg;
    out.push([xy[j][0] + (xy[j + 1][0] - xy[j][0]) * u, xy[j][1] + (xy[j + 1][1] - xy[j][1]) * u]);
  }
  return out;
}

function buildRibbon(g, xyRaw, t, z0, z1) {
  const xy = resample(xyRaw, RIBBON_N);
  const n = xy.length;
  let posAttr = g.attributes.position;
  if (!posAttr || posAttr.count !== n * 4) {
    posAttr = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
    g.setAttribute('position', posAttr);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k, b = i * 4 + ((k + 1) % 4);
        const c = (i + 1) * 4 + k, d = (i + 1) * 4 + ((k + 1) % 4);
        idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
  }
  for (let i = 0; i < n; i++) {
    const a = xy[Math.max(0, i - 1)], b = xy[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const nx = ty, ny = -tx;
    const px = xy[i][0], py = xy[i][1];
    posAttr.setXYZ(i * 4 + 0, px - nx * t / 2, py - ny * t / 2, z0);
    posAttr.setXYZ(i * 4 + 1, px + nx * t / 2, py + ny * t / 2, z0);
    posAttr.setXYZ(i * 4 + 2, px + nx * t / 2, py + ny * t / 2, z1);
    posAttr.setXYZ(i * 4 + 3, px - nx * t / 2, py - ny * t / 2, z1);
  }
  posAttr.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}
