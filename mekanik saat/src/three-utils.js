import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export function circlePts(cx, cy, r, n = 48, startAng = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = startAng + (i / n) * TAU;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export function shapeFromPts(pts, holes = []) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

/** Şekli z0..z1 arasında ekstrüde et (pah dahil toplam kalınlık korunur). */
export function extrudeXY(shape, z0, z1, { bevel = 0.03, bevelSegments = 1, curveSegments = 8, steps = 1 } = {}) {
  const depth = Math.max(0.001, z1 - z0 - (bevel > 0 ? 2 * bevel : 0));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps,
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
  });
  g.translate(0, 0, z0 + (bevel > 0 ? bevel : 0));
  return g;
}

/** Eksen z boyunca silindir, z0..z1. */
export function cylZ(r, z0, z1, seg = 28, open = false) {
  const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

/** z ekseninde halka (iç/dış yarıçap), düz yüzeyli. */
export function ringZ(rIn, rOut, z0, z1, seg = 64, bevel = 0.02) {
  const outer = circlePts(0, 0, rOut, seg);
  const inner = circlePts(0, 0, rIn, seg).reverse();
  return extrudeXY(shapeFromPts(outer, [inner]), z0, z1, { bevel });
}

/** Profil noktalarından (r,z) sert kenarlı dönel geometri. smooth=true olan noktalar komşu segmentle yumuşatılır. */
export function latheHard(profile, seg = 96, { closeCaps = false } = {}) {
  // profile: [{r,z,s}] s: sonraki noktayla yumuşat
  const pos = [], nor = [], uv = [], idx = [];
  let v = 0;
  const segNormal = (a, b) => {
    const dr = b.r - a.r, dz = b.z - a.z;
    const l = Math.hypot(dr, dz) || 1;
    return [dz / l, -dr / l]; // (nr, nz) dışa
  };
  const n = profile.length;
  const vn = [];
  // Her noktanın iki normali: önceki segment ve sonraki segment; s ise ortalama
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? segNormal(profile[i - 1], profile[i]) : null;
    const next = i < n - 1 ? segNormal(profile[i], profile[i + 1]) : null;
    vn.push({ prev, next });
  }
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    const segLen = Math.hypot(b.r - a.r, b.z - a.z);
    const nA = a.s && vn[i].prev ? avg(vn[i].prev, vn[i].next) : vn[i].next;
    const nB = b.s && vn[i + 1].next ? avg(vn[i + 1].prev, vn[i + 1].next) : vn[i + 1].prev;
    const base = v;
    for (let k = 0; k <= seg; k++) {
      const ang = (k / seg) * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      pos.push(a.r * c, a.r * s, a.z); nor.push(nA[0] * c, nA[0] * s, nA[1]); uv.push(k / seg, acc);
      pos.push(b.r * c, b.r * s, b.z); nor.push(nB[0] * c, nB[0] * s, nB[1]); uv.push(k / seg, acc + segLen);
      v += 2;
    }
    for (let k = 0; k < seg; k++) {
      const i0 = base + k * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
    acc += segLen;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
  function avg(p, q) {
    const x = p[0] + q[0], y = p[1] + q[1];
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }
}

/** Düzlemsel UV: x,y → (x-cx)/sx+.5 */
export function planarUV(geo, cx, cy, sx, sy = sx) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[2 * i] = (p.getX(i) - cx) / sx + 0.5;
    uv[2 * i + 1] = (p.getY(i) - cy) / sy + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Metre bazlı (mm) düzlemsel UV, x/y → (x/scale, y/scale) döndürülmüş. */
export function worldUV(geo, scale, angle = 0, ox = 0, oy = 0) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - ox, y = p.getY(i) - oy;
    uv[2 * i] = (x * c - y * s) / scale;
    uv[2 * i + 1] = (x * s + y * c) / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Zincirleme köşe yuvarlama (Chaikin) — kapalı çokgen. */
export function chaikin(pts, iters = 2) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

/** Yarıçapları rIn..rOut, açısı a0..a1 olan halka dilimi çokgeni (yuvarlatılmış köşeli). */
export function annularSector(rIn, rOut, a0, a1, arcPts = 14, round = 2) {
  const pts = [];
  for (let i = 0; i <= arcPts; i++) {
    const a = a0 + ((a1 - a0) * i) / arcPts;
    pts.push([rOut * Math.cos(a), rOut * Math.sin(a)]);
  }
  for (let i = arcPts; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / arcPts;
    pts.push([rIn * Math.cos(a), rIn * Math.sin(a)]);
  }
  return chaikin(pts, round);
}

/** Kalın eğri: merkez noktaları ve genişlikler → yuvarlak uçlu kapalı çokgen. */
export function thickCurve(center, widths, capSeg = 14) {
  const n = center.length;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)], b = center[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const nx = -ty, ny = tx;
    const w = widths[i] / 2;
    left.push([center[i][0] + nx * w, center[i][1] + ny * w]);
    right.push([center[i][0] - nx * w, center[i][1] - ny * w]);
  }
  const pts = [];
  // sol tarafı ileri
  pts.push(...left);
  // son uç yuvarlağı
  {
    const c = center[n - 1], w = widths[n - 1] / 2;
    const a = center[n - 2];
    const base = Math.atan2(c[1] - a[1], c[0] - a[0]);
    for (let i = 1; i < capSeg; i++) {
      const ang = base + Math.PI / 2 - (i / capSeg) * Math.PI;
      pts.push([c[0] + w * Math.cos(ang), c[1] + w * Math.sin(ang)]);
    }
  }
  pts.push(...right.reverse());
  {
    const c = center[0], w = widths[0] / 2;
    const b = center[1];
    const base = Math.atan2(c[1] - b[1], c[0] - b[0]);
    for (let i = 1; i < capSeg; i++) {
      const ang = base + Math.PI / 2 - (i / capSeg) * Math.PI;
      pts.push([c[0] + w * Math.cos(ang), c[1] + w * Math.sin(ang)]);
    }
  }
  return pts;
}

/** Kuadratik/kübik Bezier örnekleme. */
export function bezier(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    if (p3) {
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    } else {
      out.push([
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      ]);
    }
  }
  return out;
}

/** Bir Mesh (gölge + isim/bilgi) oluştur. */
export function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Birden çok geometriyi tek Mesh'e birleştir. */
export function mergedMesh(geos, mat, opts) {
  return mesh(mergeGeometries(geos.filter(Boolean), false), mat, opts);
}

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Farklı türde (indexli/indexsiz) geometrileri güvenle birleştir. */
export function mergeAny(geos) {
  const list = geos.filter(Boolean).map((g) => {
    let x = g.index ? g.toNonIndexed() : g.clone();
    if (!x.attributes.normal) x.computeVertexNormals();
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
    return x;
  });
  return mergeGeometries(list, false);
}
