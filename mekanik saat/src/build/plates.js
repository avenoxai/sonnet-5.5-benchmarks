// Ana plaka, köprüler, taşlar, cıvatalar.
import * as THREE from 'three';
import * as L from '../layout.js';
import { hairStudPos } from './train.js';
import { addScrew, addJewel, cylZ } from './helpers.js';
import {
  extrudeXY, shapeFromPts, circlePts, mesh, mergeAny, worldUV, thickCurve, bezier, ringZ,
} from '../three-utils.js';

const { ZL, DEG, TAU } = L;

/** İki dairenin (c1,r1) (c2,r2) dış teğet zarfı (dışbükey). */
export function hullOfCircles(c1, r1, c2, r2, n = 48) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const th0 = Math.atan2(dy, dx);
  const phi = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const pts = [];
  const a1s = th0 + phi, a1e = th0 - phi + TAU;
  for (let i = 0; i <= n; i++) {
    const a = a1s + ((a1e - a1s) * i) / n;
    pts.push([c1.x + r1 * Math.cos(a), c1.y + r1 * Math.sin(a)]);
  }
  const a2s = th0 - phi, a2e = th0 + phi;
  for (let i = 0; i <= n; i++) {
    const a = a2s + ((a2e - a2s) * i) / n;
    pts.push([c2.x + r2 * Math.cos(a), c2.y + r2 * Math.sin(a)]);
  }
  return pts;
}

/** Catmull-Rom ile pürüzsüz kalın köprü. */
export function smoothBridge(points, widths, seg = 28) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const N = seg * (points.length - 1);
  const center = [], w = [];
  const ws = (t) => {
    const f = t * (widths.length - 1);
    const i = Math.min(widths.length - 2, Math.floor(f));
    return widths[i] + (widths[i + 1] - widths[i]) * (f - i);
  };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPoint(t);
    center.push([p.x, p.y]);
    w.push(ws(t));
  }
  return thickCurve(center, w, 16);
}

export const PIVOT_POINTS = {
  center: L.C, third: L.THIRD, fourth: L.FOURTH, escape: L.ESCAPE, pallet: L.PALLET,
  balance: L.BALANCE, barrel: L.BARREL, crown: L.CROWN_WHEEL,
};

export function buildPlates(ctx) {
  const m = ctx.mats;
  const ESC = L.ESCAPEMENT;
  const plateG = ctx.layers.plate.group;
  const bridgeG = ctx.layers.bridges.group;
  const cockG = ctx.layers.cock.group;

  // ---------------- ANA PLAKA ----------------
  const R = 17.5;
  const pocketHalf = 2.6, stemHalf = 0.8, pocketX = 9.9, notchX = 8.6;
  const a0 = Math.asin(pocketHalf / R);
  const outline = [];
  const N = 220;
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((TAU - 2 * a0) * i) / N;
    outline.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  const xe = Math.sqrt(R * R - pocketHalf * pocketHalf);
  // Kurma/ayar cebi: geniş cep + dar mil kanalı
  outline.push([pocketX, -pocketHalf], [pocketX, -stemHalf], [notchX, -stemHalf], [notchX, stemHalf], [pocketX, stemHalf], [pocketX, pocketHalf]);
  const holes = [];
  const holeAt = (p, r = 0.92) => circlePts(p.x, p.y, r, 28).reverse();
  for (const p of [L.C, L.THIRD, L.FOURTH, L.ESCAPE, L.PALLET, L.BALANCE]) holes.push(holeAt(p));
  holes.push(holeAt(L.BARREL, 1.3));
  const plateShape = shapeFromPts(outline, holes);
  const plateGeo = extrudeXY(plateShape, ZL.plateBot, ZL.plateTop, { bevel: 0.06, curveSegments: 1 });
  worldUV(plateGeo, 12, 0);
  const plate = mesh(plateGeo, m.plate);
  plateG.add(plate);

  // Plaka taşları (chaton + yakut) — arka yüzde
  const jewelSpots = [
    [L.C, 1], [L.THIRD, 0.82], [L.FOURTH, 0.82], [L.ESCAPE, 0.82], [L.PALLET, 0.82], [L.BALANCE, 0.95],
  ];
  for (const [p, s] of jewelSpots) addJewel(plateG, p.x, p.y, ZL.plateBot, s, +1, m);
  addJewel(plateG, L.BARREL.x, L.BARREL.y, ZL.plateBot, 1.4, +1, m);
  // Balans kapak taşı (plaka tarafı)
  addJewel(plateG, L.BALANCE.x, L.BALANCE.y, ZL.plateBot + 0.02, 0.62, +1, m);

  // Banking pimleri (çapa sınırlayıcı)
  {
    const P = L.PALLET;
    const bank = new THREE.Group();
    bank.position.set(P.x, P.y, 0);
    bank.rotation.z = L.ESC_ROT;
    for (const sx of [-1, 1]) {
      const pin = mesh(cylZ(0.24, -2.4, -1.15, 16), m.steel);
      pin.position.set(sx * 0.86, -3.6, 0);
      bank.add(pin);
    }
    plateG.add(bank);
  }
  // Plaka kenar vidaları
  for (const a of [20, 90, 150, 215, 280, 335]) {
    const ang = a * DEG;
    addScrew(plateG, 16.6 * Math.cos(ang), 16.6 * Math.sin(ang), ZL.plateBot, 0.42, m.blued, { dir: -1, rot: ang });
  }
  // Saç yay için: plaka yüzünde kadran ayakları
  for (const a of [40, 160, 275]) {
    const ang = a * DEG;
    const foot = mesh(cylZ(0.5, 0, 1.9, 20), m.steelDark);
    foot.position.set(16.0 * Math.cos(ang), 16.0 * Math.sin(ang), 0);
    plateG.add(foot);
  }

  // ---------------- KÖPRÜLER ----------------
  const zTop = ZL.bridgeTop, zBot = ZL.bridgeBot;      // -4.85, -3.95
  const bridgeMesh = (pts, angleDeg, holePoints = [], mat = m.bridge) => {
    const holesB = holePoints.map(([p, r]) => circlePts(p.x, p.y, r, 24).reverse());
    const g = extrudeXY(shapeFromPts(pts, holesB), zTop, zBot, { bevel: 0.07, curveSegments: 1 });
    worldUV(g, 0.8, angleDeg * DEG);
    return mesh(g, mat);
  };

  // Fıçı köprüsü
  const barrelBridge = new THREE.Group();
  {
    const pts = hullOfCircles(L.BARREL, 7.05, L.CROWN_WHEEL, 2.5, 64);
    barrelBridge.add(bridgeMesh(pts, 18, [[L.BARREL, 0.95], [L.CROWN_WHEEL, 0.8]]));
    addJewel(barrelBridge, L.BARREL.x, L.BARREL.y, zTop, 1.3, -1, m);
    addJewel(barrelBridge, L.CROWN_WHEEL.x, L.CROWN_WHEEL.y, zTop, 0.82, -1, m);
    for (const a of [215, 290, 25]) {
      const ang = a * DEG;
      addScrew(barrelBridge, L.BARREL.x + 6.5 * Math.cos(ang), L.BARREL.y + 6.5 * Math.sin(ang), zTop, 0.42, m.blued, { dir: -1, rot: ang });
    }
    addScrew(barrelBridge, L.CROWN_WHEEL.x + 1.6, L.CROWN_WHEEL.y - 0.9, zTop, 0.36, m.blued, { dir: -1, rot: 1 });
  }
  bridgeG.add(barrelBridge);

  // Dişli köprüsü: F → 3. → merkez
  const trainBridge = new THREE.Group();
  {
    const pts = smoothBridge(
      [[L.FOURTH.x, L.FOURTH.y], [-7.6, -1.6], [L.THIRD.x, L.THIRD.y], [-2.4, -1.1], [L.C.x, L.C.y]],
      [4.5, 4.1, 3.9, 3.6, 3.3], 24,
    );
    trainBridge.add(bridgeMesh(pts, -12, [[L.FOURTH, 0.8], [L.THIRD, 0.8], [L.C, 0.9]]));
    addJewel(trainBridge, L.FOURTH.x, L.FOURTH.y, zTop, 0.82, -1, m);
    addJewel(trainBridge, L.THIRD.x, L.THIRD.y, zTop, 0.82, -1, m);
    addJewel(trainBridge, L.C.x, L.C.y, zTop, 1.0, -1, m);
    addScrew(trainBridge, -12.3, 1.3, zTop, 0.42, m.blued, { dir: -1, rot: 0.5 });
    addScrew(trainBridge, -8.0, -3.0, zTop, 0.42, m.blued, { dir: -1, rot: 1.3 });
    addScrew(trainBridge, -2.6, 1.2, zTop, 0.42, m.blued, { dir: -1, rot: 2.1 });
  }
  bridgeG.add(trainBridge);

  // Çıkış köprüsü: çıkış çarkı ve çapa üst pivotları
  const palletBridge = new THREE.Group();
  {
    const pts = hullOfCircles(L.ESCAPE, 2.35, L.PALLET, 2.0, 40);
    palletBridge.add(bridgeMesh(pts, 40, [[L.ESCAPE, 0.8], [L.PALLET, 0.8]]));
    addJewel(palletBridge, L.ESCAPE.x, L.ESCAPE.y, zTop, 0.82, -1, m);
    addJewel(palletBridge, L.PALLET.x, L.PALLET.y, zTop, 0.82, -1, m);
    addScrew(palletBridge, L.ESCAPE.x - 1.5, L.ESCAPE.y + 0.9, zTop, 0.38, m.blued, { dir: -1, rot: 0.2 });
    addScrew(palletBridge, L.PALLET.x + 1.0, L.PALLET.y - 0.9, zTop, 0.38, m.blued, { dir: -1, rot: 1.4 });
  }
  bridgeG.add(palletBridge);

  // ---------------- BALANS KÖPRÜSÜ (cock) ----------------
  const cock = new THREE.Group();
  {
    const Bc = L.BALANCE;
    const foot = { x: Bc.x + 6.1 * Math.cos(250 * DEG), y: Bc.y + 6.1 * Math.sin(250 * DEG) };
    const ctrl = [Bc.x - 3.4, Bc.y - 3.6];
    const center = bezier([Bc.x, Bc.y], [Bc.x - 1.4, Bc.y - 2.6], ctrl, [foot.x, foot.y], 40);
    const widths = center.map((_, i) => 4.9 - (1.9 * i) / (center.length - 1));
    const pts = thickCurve(center, widths, 18);
    const g = extrudeXY(shapeFromPts(pts, [circlePts(Bc.x, Bc.y, 0.9, 24).reverse()]), zTop, zBot, { bevel: 0.07, curveSegments: 1 });
    worldUV(g, 0.8, -70 * DEG);
    cock.add(mesh(g, m.bridge));
    // Üst pivot taşı (kapak taşlı)
    addJewel(cock, Bc.x, Bc.y, zTop, 1.15, -1, m);
    addJewel(cock, Bc.x, Bc.y, zTop - 0.27, 0.66, -1, m);   // kapak taşı
    // Ayak vidaları
    addScrew(cock, foot.x, foot.y, zTop, 0.5, m.blued, { dir: -1, rot: 0.8 });
    addScrew(cock, Bc.x - 2.6, Bc.y - 2.6, zTop, 0.4, m.blued, { dir: -1, rot: 2.1 });
    // Saç yay stud'ı
    const sp = hairStudPos();
    const stud = mesh(cylZ(0.24, -4.0, -3.55, 16), m.steel);
    stud.position.set(Bc.x + sp.x, Bc.y + sp.y, 0);
    cock.add(stud);
    // Regülatör (indeks) — kavisli kol ve iki ayar pimi
    const reg = new THREE.Group();
    reg.position.set(Bc.x, Bc.y, 0);
    const a = 250 * DEG;
    const arc = [];
    for (let i = 0; i <= 18; i++) {
      const t = a - 0.42 + (0.84 * i) / 18;
      arc.push([3.9 * Math.cos(t), 3.9 * Math.sin(t)]);
    }
    const regPts = thickCurve(arc, arc.map(() => 0.34), 6);
    reg.add(mesh(extrudeXY(shapeFromPts(regPts), zBot - 0.05, zBot - 0.28, { bevel: 0.02, curveSegments: 1 }), m.steel));
    for (const dt of [-0.03, 0.03]) {
      const pin = mesh(cylZ(0.07, -4.2, -3.55, 8), m.steel);
      pin.position.set(3.78 * Math.cos(a + dt), 3.78 * Math.sin(a + dt), 0);
      reg.add(pin);
    }
    cock.add(reg);
  }
  cockG.add(cock);

  ctx.nodes.plate = plate;
  return { plate, barrelBridge, trainBridge, palletBridge, cock };
}
