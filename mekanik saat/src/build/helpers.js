import * as THREE from 'three';
import {
  extrudeXY, shapeFromPts, cylZ, circlePts, mesh, mergeAny, latheHard, chaikin,
} from '../three-utils.js';

const TAU = Math.PI * 2;

/** Bağlam: katmanlar, parça kayıtları, hareketli düğümler. */
export class Ctx {
  constructor(mats) {
    this.mats = mats;
    this.root = new THREE.Group();
    this.layers = {};
    this.parts = [];
    this.nodes = {};
    this.meshToPart = new Map();
  }

  layer(id, name, off) {
    const group = new THREE.Group();
    group.name = 'layer-' + id;
    this.root.add(group);
    this.layers[id] = { id, name, off, group };
    return group;
  }

  /** Bir grubu (veya grup listesini) seçilebilir parça olarak kaydet. */
  part(id, name, groups, layerId, info = {}) {
    const objects = Array.isArray(groups) ? groups : [groups];
    const p = { id, name, objects, layerId, info, get group() { return objects[0]; } };
    this.parts.push(p);
    objects.forEach((g) => g.traverse((o) => { if (o.isMesh) this.meshToPart.set(o, p); }));
    return p;
  }

  /** Sonradan eklenen mesh'leri de parçaya bağla. */
  attach(part, obj) {
    obj.traverse((o) => { if (o.isMesh) this.meshToPart.set(o, part); });
  }
}

/** Sağlam ekstrüde dişli/çark mesh'i. */
export function gearMesh(pts, z0, z1, { holes = [], bevel = 0.02, mat }) {
  const shape = shapeFromPts(pts, holes);
  const g = extrudeXY(shape, z0, z1, { bevel, curveSegments: 1 });
  return mesh(g, mat);
}

/** Kolların arasındaki delikler (paralel kenarlı kollar, köşeleri yuvarlak). */
export function spokeHoles(n, rHub, rRim, w, { angle0 = 0, round = 2, arc = 12 } = {}) {
  const holes = [];
  const edge = (s, side, r) => {
    const ux = Math.cos(s), uy = Math.sin(s);
    const nx = -uy, ny = ux;
    return [r * ux + side * (w / 2) * nx, r * uy + side * (w / 2) * ny];
  };
  for (let k = 0; k < n; k++) {
    const s0 = angle0 + (k * TAU) / n, s1 = angle0 + ((k + 1) * TAU) / n;
    const pIn0 = edge(s0, +1, rHub), pOut0 = edge(s0, +1, rRim);
    const pOut1 = edge(s1, -1, rRim), pIn1 = edge(s1, -1, rHub);
    const pts = [pIn0, pOut0];
    const aO0 = Math.atan2(pOut0[1], pOut0[0]);
    let aO1 = Math.atan2(pOut1[1], pOut1[0]);
    while (aO1 < aO0) aO1 += TAU;
    const rO0 = Math.hypot(...pOut0), rO1 = Math.hypot(...pOut1);
    for (let i = 1; i < arc; i++) {
      const t = i / arc;
      const a = aO0 + (aO1 - aO0) * t, r = rO0 + (rO1 - rO0) * t;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    pts.push(pOut1, pIn1);
    const aI1 = Math.atan2(pIn1[1], pIn1[0]);
    let aI0 = Math.atan2(pIn0[1], pIn0[0]);
    while (aI0 < aI1) aI0 += TAU;
    const rI1 = Math.hypot(...pIn1), rI0 = Math.hypot(...pIn0);
    // aI1 -> aI0 (dönüş yönünde geri): inner kenar ters
    for (let i = 1; i < arc; i++) {
      const t = i / arc;
      const a = aI1 + (aI0 - aI1) * t - TAU * 0, r = rI1 + (rI0 - rI1) * t;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    holes.push(chaikin(pts, round));
  }
  return holes;
}

// --- Paylaşılan küçük geometriler ---
let _screw = null;
/** Yarıçapı 1 olan yarık başlı cıvata başı; z 0 → +h (h=0.34). */
export function screwGeometry() {
  if (_screw) return _screw;
  const R = 1, h = 0.34, hw = 0.11;
  const parts = [];
  parts.push(extrudeXY(shapeFromPts(circlePts(0, 0, R, 28)), 0, h * 0.5, { bevel: 0 }));
  const aa = Math.asin(hw / R);
  for (const sgn of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const a = aa + (Math.PI - 2 * aa) * (i / 14);
      pts.push([R * Math.cos(a), sgn * R * Math.sin(a)]);
    }
    parts.push(extrudeXY(shapeFromPts(pts), h * 0.5, h, { bevel: 0.05, bevelSegments: 1, curveSegments: 1 }));
  }
  _screw = mergeAny(parts);
  return _screw;
}

/** Cıvata ekle: head (x,y,z) düzleminde, dir=+1 → baş +z yönüne, −1 → −z yönüne. */
export function addScrew(parent, x, y, z, r, mat, { dir = -1, rot = 0 } = {}) {
  const m = mesh(screwGeometry(), mat);
  m.scale.set(r, r, r);
  m.position.set(x, y, z);
  if (dir < 0) { m.rotation.x = Math.PI; }
  m.rotation.z = rot;
  parent.add(m);
  return m;
}

/** Taş yuvası (altın chaton + yakut). z: plaka/köprü yüzeyi; dir: taşın çıkıntı yönü. */
let _jewel = null;
export function jewelGeometry() {
  if (_jewel) return _jewel;
  // Altın halka (r 0.9 dış, 0.55 iç), yakut halka (0.58 dış, 0.16 iç delik)
  const ring = latheHard([
    { r: 0.56, z: 0 }, { r: 0.9, z: 0 }, { r: 0.9, z: 0.16, s: false }, { r: 0.8, z: 0.24 }, { r: 0.56, z: 0.24 },
  ], 32);
  const ruby = latheHard([
    { r: 0.16, z: 0.02 }, { r: 0.6, z: 0.02 }, { r: 0.6, z: 0.1, s: false }, { r: 0.42, z: 0.28, s: true }, { r: 0.16, z: 0.3 },
  ], 32);
  _jewel = { ring, ruby };
  return _jewel;
}

export function addJewel(parent, x, y, z, s, dir, mats) {
  const g = jewelGeometry();
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.scale.set(s, s, s);
  if (dir < 0) grp.rotation.x = Math.PI;
  grp.add(mesh(g.ring, mats.gold), mesh(g.ruby, mats.ruby));
  parent.add(grp);
  return grp;
}

/** Yay/çubuk: iki nokta arasında silindir (x,y,z uzayında). */
export function rod(a, b, r, mat, seg = 12) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const m = mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

export { cylZ };
