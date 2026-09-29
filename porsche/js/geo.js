'use strict';
/* geo.js — explicit mesh builders, mesh utilities, 2D/spline helpers and a BVH raycaster.   Global: PG.geo
 * Classic script, no dependencies except PG.m4 / PG.v3 from core.js (only for matrix conveniences).
 * Everything is pure, deterministic JS. Nothing here touches GL.
 *
 * ============================================================================================================
 * CONVENTIONS
 *   Mesh (CPU):  { positions:Float32Array(3n), normals:Float32Array(3n), uvs:Float32Array(2n), attrs?:Float32Array(4n),
 *                  indices:Uint32Array }.   Triangles are CCW seen from outside.  Right-handed, +Y up.
 *   Every builder returns a NEW mesh. Every utility returns a NEW mesh unless it says "in place".
 *   Primitives are centred on the origin, axis = +Y (opts.axis:'x'|'y'|'z' re-orients the symmetry axis).
 *   UVs are METRIC by default (1 uv unit = 1 metre along the surface) so that carbon-weave / knurl patterns have a
 *   uniform density on every part. Pass {uv:'unit'} for 0..1 parametrisation, {uvScale:s | [su,sv]} to scale either.
 *   2D points are [x,y] arrays, 3D points [x,y,z] arrays. Polygons are arrays of points (no repeated end point).
 *   Angles are RADIANS everywhere unless the name ends in "Deg".
 *
 * PRIMITIVES
 *   box(sx,sy,sz,opts) | box([sx,sy,sz],opts)   opts:{radius|bevel, segments(3), div:[nx,ny,nz], uv}
 *   roundedBox(sx,sy,sz,radius,segments,opts)
 *   plane(w,d,wSeg,dSeg,opts)                   opts:{axis:'y'(normal +Y, u=+X,v=-Z)|'z'(u=+X,v=+Y)|'x'(u=-Z,v=+Y), flip}
 *   grid(uSeg,vSeg,fn,opts) / parametric(fn,uSeg,vSeg,opts)   fn(u,v,out)->[x,y,z] (u,v in 0..1); normal = dP/du x dP/dv (opts.flip inverts);
 *                                               opts:{flip,normal:fn(u,v,out)|null,uv}
 *   sphere(r,wSeg,hSeg,opts) / ellipsoid(rx,ry,rz,wSeg,hSeg,opts)   opts:{phiStart,phiLength,thetaStart,thetaLength,axis}
 *   cubeSphere(r,n,opts)
 *   cylinder(rTop,rBottom,h,radialSeg,heightSeg,opts)   opts:{caps:true|false|{top,bottom},start,sweep,axis,crease}
 *   cyl(r,h,radialSeg,opts) | cone(r,h,radialSeg,heightSeg,opts) (apex +Y) | frustum = cylinder
 *   torus(R,r,tubularSeg,radialSeg,opts)        opts:{arc}
 *   disc(r,seg,opts)  ring(rInner,rOuter,seg,opts) = annulus (flat, normal +Y; opts.flip -> -Y; opts.axis re-orients)
 *   capsule(r,length,radialSeg,capSeg,heightSeg,opts)   (length = straight part only)
 *   lathe(profile,segments,opts)   profile [[r,y,crease?],...] traversed BOTTOM->TOP gives OUTWARD normals (top->bottom = inward).
 *                                  opts:{start,sweep|end,crease(deg,35),flip,axis}; 3rd profile item true=force hard edge,false=force smooth.
 *   extrude(polygon,depth,opts)    opts:{holes:[poly..],center,steps,caps,bevel:{size,depth,segments}|bevelSize/bevelDepth/bevelSegments,crease}
 *                                  Extrudes along +Z (z 0..depth, or centred). Handles concave polygons and holes.
 *   sweep(profile2D,path3D,opts)   opts:{closed,closedProfile,scale,twist,up,frames:'transport'|'up',caps,crease,flip}
 *   tube(path,radius|fn,opts)      opts:{radialSegments,closed,caps:'flat'|'round'|false,...}
 *   loft(sections,opts)            sections: equal-count point rings [[x,y,z],...]; opts:{closed,closedV,caps,crease,orient,flip}
 *
 * CURVES / 2D
 *   catmullRom(pts,{closed,segments,alpha,tension}), bezier(p0,p1,p2,p3,n), quadBezier, bezierPath(ctrl,n), arc(cx,cy,r,a0,a1,n),
 *   resample(pts,n|{spacing},{closed}), pathLength(pts,closed), pathAt(pts,s,closed), subdivide(pts,iter,closed), pathFrames(path,opts)
 *   naca4(chord,m,p,t,points,opts) / naca('2412',chord,points,opts) / naca4Thick(chord,m,p,t,points,teThickness)   opts:{closedTE,teThickness}
 *   extrudeAirfoil(profile,span,opts)   opts:{taper,sweepDeg|sweepDist,twistDeg,twistPivot,dihedralDeg|dihedralDist,segments,caps,center,mirror}
 *   triangulate(poly,holes)->flat index triples (indices into poly points followed by each hole's points), polygonArea (CCW>0), isCCW,
 *   reversePolygon, cleanPolygon, offsetPolygon(poly,dist,{join,miterLimit,arcSegments}) (+dist grows, -dist shrinks), inset(poly,d), outset(poly,d),
 *   roundPolygon(poly,radius|[r..],seg), pointInPolygon(pt,poly),
 *   shapes.{circle(r,n,cx,cy), ellipse(rx,ry,n), rect(w,h), roundRect(w,h,r,seg), ngon(r,n,rot), star(rOut,rIn,n,rot), slot(len,width,seg), arc(r,a0,a1,n), gear(rOut,rIn,teeth)}
 *
 * MESH UTILITIES
 *   merge(meshes,transforms?)  transform(mesh,m4,{inPlace})  translate(mesh,x,y,z|[x,y,z])  scale(mesh,s|sx,sy,sz)  rotate(mesh,axis,rad)
 *   rotateX/Y/Z(mesh,rad)  computeNormals(mesh,creaseDeg=180,{weight:'angle'|'area'})  weld(mesh,eps,{positionOnly})  flip(mesh)
 *   mirror(mesh,'x'|'y'|'z',merge)  mirrorZ(mesh,merge)  bounds(mesh)  generateUVs(mesh,{mode:'planar'|'box'|'cylindrical'|'spherical',...})
 *   setAttrs(mesh,fn) (in place)  toIndexed(mesh)  toNonIndexed(mesh)  flatShade(mesh)  toUint16(mesh)  deepClone(mesh)  validate(mesh,opts)
 *   triangleCount(mesh)  subdivideMesh(mesh) (1->4 midpoint split)  fitsUint16(mesh)  cloneMesh = deepClone
 *
 * RAYCASTER
 *   const rc = PG.geo.raycaster(mesh, {leafSize:4});   // LBVH, builds 1 M triangles in well under a second
 *   rc.cast(origin,dir,{tMin,tMax,backfaces})   -> {t,point,normal,faceNormal,faceIndex,uv,front} | null   (dir need not be unit; t = distance)
 *   rc.castAll(origin,dir,opts)                 -> [hits sorted by t]
 *   rc.nearest(point,maxDist)                   -> {point,distance,faceIndex,normal} | null
 *   rc.heightAt(x,z,yStart?)                    -> y of the top surface below yStart (casts straight down) | null
 *   rc.bottomAt(x,z,yStart?)                    -> y of the lowest surface (casts straight up from below) | null
 *   rc.boundsOf(faceIndex?)                     -> {min,max}  (mesh bounds, or of one triangle);  rc.bounds, rc.triCount, rc.stats
 * ============================================================================================================
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PG = root.PG = root.PG || {};
  const G = PG.geo = {};
  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max, sin = Math.sin, cos = Math.cos, tan = Math.tan, atan2 = Math.atan2;

  // ================================================================== internal: growable mesh builder
  class MB {
    constructor(nv0) {
      this.cap = max(16, nv0 | 0); this.n = 0; this.ni = 0;
      this.p = new Float32Array(this.cap * 3); this.nr = new Float32Array(this.cap * 3); this.uv = new Float32Array(this.cap * 2);
      this.icap = this.cap * 3; this.idx = new Uint32Array(this.icap);
    }
    _grow() {
      const c = this.cap * 2;
      const p = new Float32Array(c * 3); p.set(this.p); this.p = p;
      const n = new Float32Array(c * 3); n.set(this.nr); this.nr = n;
      const u = new Float32Array(c * 2); u.set(this.uv); this.uv = u; this.cap = c;
    }
    v(x, y, z, nx, ny, nz, u, v) {
      if (this.n === this.cap) this._grow();
      const i = this.n++, a = i * 3;
      this.p[a] = x; this.p[a + 1] = y; this.p[a + 2] = z; this.nr[a] = nx; this.nr[a + 1] = ny; this.nr[a + 2] = nz;
      this.uv[i * 2] = u; this.uv[i * 2 + 1] = v; return i;
    }
    tri(a, b, c) {
      if (this.ni + 3 > this.icap) { this.icap *= 2; const x = new Uint32Array(this.icap); x.set(this.idx); this.idx = x; }
      const i = this.ni; this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c; this.ni += 3;
    }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
    build() {
      return { positions: this.p.slice(0, this.n * 3), normals: this.nr.slice(0, this.n * 3), uvs: this.uv.slice(0, this.n * 2), indices: this.idx.slice(0, this.ni) };
    }
  }
  G._MB = MB;

  // uv scale helper: returns {ku,kv}: u = metricU*ku, v = metricV*kv.  lu,lv = metric extent of the parametric range (for 'unit' mode).
  function uvK(o, lu, lv) {
    let su = 1, sv = 1;
    if (o && o.uvScale != null) { if (Array.isArray(o.uvScale)) { su = o.uvScale[0]; sv = o.uvScale[1]; } else su = sv = o.uvScale; }
    if (o && o.uv === 'unit') return { ku: su / (lu > 1e-12 ? lu : 1), kv: sv / (lv > 1e-12 ? lv : 1) };
    return { ku: su, kv: sv };
  }

  const seqIdx = n => { const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
  const idxOf = m => m.indices || seqIdx(m.positions.length / 3);
  G.triangleCount = m => (m.indices ? m.indices.length : m.positions.length / 3) / 3;

  // ================================================================== bounds / clone / merge / transform
  G.bounds = function (mesh) {
    const P = mesh.positions || mesh; let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (!P.length) { x0 = y0 = z0 = x1 = y1 = z1 = 0; }
    const size = [x1 - x0, y1 - y0, z1 - z0], center = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const diag = Math.hypot(size[0], size[1], size[2]);
    return { min: [x0, y0, z0], max: [x1, y1, z1], size, center, diag, radius: diag / 2 };
  };

  G.deepClone = G.cloneMesh = function (m) {
    const o = {};
    for (const k in m) { const v = m[k]; o[k] = ArrayBuffer.isView(v) ? new v.constructor(v) : (Array.isArray(v) ? v.slice() : v); }
    return o;
  };

  function det3(m) {
    return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  }

  // merge(meshes, transforms?)  transforms[i] (Float32Array(16) | null) is applied to meshes[i]. Mirroring matrices flip winding.
  G.merge = function (meshes, transforms) {
    const list = [], tr = [];
    for (let i = 0; i < meshes.length; i++) if (meshes[i] && meshes[i].positions.length) { list.push(meshes[i]); tr.push(transforms ? transforms[i] || null : null); }
    let nv = 0, ni = 0, hasUV = false, hasAttrs = false;
    for (const m of list) { nv += m.positions.length / 3; ni += idxOf(m).length; if (m.uvs) hasUV = true; if (m.attrs) hasAttrs = true; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = new Uint32Array(ni);
    const UV = hasUV ? new Float32Array(nv * 2) : null, A = hasAttrs ? new Float32Array(nv * 4) : null;
    let vo = 0, io = 0;
    for (let k = 0; k < list.length; k++) {
      const m = list[k], M = tr[k], n = m.positions.length / 3, src = idxOf(m), Ps = m.positions, Ns = m.normals;
      let flipW = false;
      if (M) {
        const nm = PG.m4.normalMat3(M); flipW = det3(M) < 0;
        for (let i = 0; i < n; i++) {
          const x = Ps[i * 3], y = Ps[i * 3 + 1], z = Ps[i * 3 + 2];
          P[(vo + i) * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
          P[(vo + i) * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
          P[(vo + i) * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
          if (Ns) {
            const nx = Ns[i * 3], ny = Ns[i * 3 + 1], nz = Ns[i * 3 + 2];
            let a = nm[0] * nx + nm[3] * ny + nm[6] * nz, b = nm[1] * nx + nm[4] * ny + nm[7] * nz, c = nm[2] * nx + nm[5] * ny + nm[8] * nz;
            const l = Math.hypot(a, b, c) || 1; N[(vo + i) * 3] = a / l; N[(vo + i) * 3 + 1] = b / l; N[(vo + i) * 3 + 2] = c / l;
          }
        }
      } else {
        P.set(Ps, vo * 3); if (Ns) N.set(Ns, vo * 3);
      }
      if (UV && m.uvs) UV.set(m.uvs, vo * 2);
      if (A) { if (m.attrs) A.set(m.attrs, vo * 4); else for (let i = 0; i < n; i++) A[(vo + i) * 4] = 1; }
      for (let i = 0; i < src.length; i += 3) {
        if (flipW) { I[io + i] = src[i] + vo; I[io + i + 1] = src[i + 2] + vo; I[io + i + 2] = src[i + 1] + vo; }
        else { I[io + i] = src[i] + vo; I[io + i + 1] = src[i + 1] + vo; I[io + i + 2] = src[i + 2] + vo; }
      }
      vo += n; io += src.length;
    }
    const out = { positions: P, normals: N, indices: I };
    if (UV) out.uvs = UV; else out.uvs = new Float32Array(nv * 2);
    if (A) out.attrs = A;
    return out;
  };

  // transform(mesh, m4, {inPlace}) -> mesh. Normals use the inverse-transpose; mirroring matrices flip winding.
  G.transform = function (mesh, M, o) {
    if (!(o && o.inPlace)) return G.merge([mesh], [M]);
    const P = mesh.positions, N = mesh.normals, n = P.length / 3, nm = PG.m4.normalMat3(M);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      P[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      if (N) {
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        const a = nm[0] * nx + nm[3] * ny + nm[6] * nz, b = nm[1] * nx + nm[4] * ny + nm[7] * nz, c = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        const l = Math.hypot(a, b, c) || 1; N[i * 3] = a / l; N[i * 3 + 1] = b / l; N[i * 3 + 2] = c / l;
      }
    }
    if (det3(M) < 0 && mesh.indices) { const I = mesh.indices; for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } }
    return mesh;
  };
  G.translate = (m, x, y, z) => { const v = Array.isArray(x) ? x : [x, y, z]; return G.transform(m, PG.m4.translation(v[0], v[1], v[2])); };
  G.scale = (m, x, y, z) => { const v = Array.isArray(x) ? x : (y === undefined ? [x, x, x] : [x, y, z]); return G.transform(m, PG.m4.scaling(v[0], v[1], v[2])); };
  G.rotateX = (m, r) => G.transform(m, PG.m4.rotationX(r));
  G.rotateY = (m, r) => G.transform(m, PG.m4.rotationY(r));
  G.rotateZ = (m, r) => G.transform(m, PG.m4.rotationZ(r));
  // rotate(mesh, 'x'|'y'|'z'|[ax,ay,az], radians)
  G.rotate = (m, axis, r) => G.transform(m, axis === 'x' ? PG.m4.rotationX(r) : axis === 'y' ? PG.m4.rotationY(r) : axis === 'z' ? PG.m4.rotationZ(r) : PG.m4.rotationAxis(axis, r));

  // Re-orient a Y-axis primitive so its symmetry axis becomes opts.axis.
  function applyAxis(mesh, o) {
    const a = o && o.axis;
    if (!a || a === 'y') return mesh;
    return G.transform(mesh, a === 'x' ? PG.m4.rotationZ(-PI / 2) : PG.m4.rotationX(PI / 2));
  }
  function maybeFlip(mesh, o) { return o && o.flip ? G.flip(mesh) : mesh; }

  G.flip = function (mesh) {
    const o = G.deepClone(mesh), I = o.indices || (o.indices = seqIdx(o.positions.length / 3));
    for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
    if (o.normals) for (let i = 0; i < o.normals.length; i++) o.normals[i] = -o.normals[i];
    return o;
  };

  // mirror(mesh,'x'|'y'|'z', merge=false): mirrored copy (winding fixed). With merge=true returns mesh + mirrored copy as one mesh.
  G.mirror = function (mesh, axis, mrg) {
    const s = axis === 'x' ? [-1, 1, 1] : axis === 'y' ? [1, -1, 1] : [1, 1, -1];
    const mm = G.transform(mesh, PG.m4.scaling(s[0], s[1], s[2]));
    return mrg ? G.merge([mesh, mm]) : mm;
  };
  G.mirrorZ = (mesh, mrg) => G.mirror(mesh, 'z', mrg && mrg !== 'false');

  // ================================================================== position welding (internal) + weld()
  function weldGroups(P, eps) {
    const nv = P.length / 3, group = new Int32Array(nv);
    let size = 16; while (size < nv * 2) size <<= 1;
    const mask = size - 1, table = new Int32Array(size).fill(-1), inv = 1 / eps, Q = new Float64Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const qx = Math.round(P[i * 3] * inv), qy = Math.round(P[i * 3 + 1] * inv), qz = Math.round(P[i * 3 + 2] * inv);
      Q[i * 3] = qx; Q[i * 3 + 1] = qy; Q[i * 3 + 2] = qz;
      let h = (Math.imul(qx | 0, 73856093) ^ Math.imul(qy | 0, 19349663) ^ Math.imul(qz | 0, 83492791)) & mask, found = -1;
      for (;;) {
        const t = table[h];
        if (t < 0) { table[h] = i; found = i; break; }
        if (Q[t * 3] === qx && Q[t * 3 + 1] === qy && Q[t * 3 + 2] === qz) { found = t; break; }
        h = (h + 1) & mask;
      }
      group[i] = found;
    }
    return group;
  }
  const autoEps = m => max(G.bounds(m).diag * 1e-6, 1e-9);

  // weld(mesh, eps, {positionOnly}) -> merges duplicate vertices (equal position AND normal AND uv unless positionOnly). Drops collapsed triangles.
  G.weld = function (mesh, eps, o) {
    o = o || {}; eps = eps || autoEps(mesh);
    const P = mesh.positions, N = mesh.normals, UV = mesh.uvs, A = mesh.attrs, nv = P.length / 3, I = idxOf(mesh);
    const posOnly = !!o.positionOnly;
    let size = 16; while (size < nv * 2) size <<= 1;
    const mask = size - 1, table = new Int32Array(size).fill(-1), inv = 1 / eps, remap = new Int32Array(nv), keep = [];
    const Q = new Float64Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const qx = Math.round(P[i * 3] * inv), qy = Math.round(P[i * 3 + 1] * inv), qz = Math.round(P[i * 3 + 2] * inv);
      Q[i * 3] = qx; Q[i * 3 + 1] = qy; Q[i * 3 + 2] = qz;
      let h = (Math.imul(qx | 0, 73856093) ^ Math.imul(qy | 0, 19349663) ^ Math.imul(qz | 0, 83492791)) & mask, found = -1;
      for (;;) {
        const t = table[h];
        if (t < 0) { table[h] = i; found = i; break; }
        if (Q[t * 3] === qx && Q[t * 3 + 1] === qy && Q[t * 3 + 2] === qz) {
          let same = true;
          if (!posOnly) {
            if (N && (N[t * 3] * N[i * 3] + N[t * 3 + 1] * N[i * 3 + 1] + N[t * 3 + 2] * N[i * 3 + 2]) < 0.999) same = false;
            if (same && UV && (abs(UV[t * 2] - UV[i * 2]) > eps * 10 || abs(UV[t * 2 + 1] - UV[i * 2 + 1]) > eps * 10)) same = false;
          }
          if (same) { found = t; break; }
        }
        h = (h + 1) & mask;
      }
      remap[i] = found;
    }
    const newIdx = new Int32Array(nv).fill(-1); let cnt = 0;
    for (let i = 0; i < nv; i++) if (remap[i] === i) { newIdx[i] = cnt++; keep.push(i); }
    const out = { positions: new Float32Array(cnt * 3), normals: new Float32Array(cnt * 3), uvs: new Float32Array(cnt * 2) };
    if (A) out.attrs = new Float32Array(cnt * 4);
    for (let k = 0; k < cnt; k++) {
      const i = keep[k];
      out.positions.set(P.subarray(i * 3, i * 3 + 3), k * 3); if (N) out.normals.set(N.subarray(i * 3, i * 3 + 3), k * 3);
      if (UV) out.uvs.set(UV.subarray(i * 2, i * 2 + 2), k * 2); if (A) out.attrs.set(A.subarray(i * 4, i * 4 + 4), k * 4);
    }
    const tri = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = newIdx[remap[I[t]]], b = newIdx[remap[I[t + 1]]], c = newIdx[remap[I[t + 2]]];
      if (a === b || b === c || a === c) continue; tri.push(a, b, c);
    }
    out.indices = Uint32Array.from(tri);
    return out;
  };

  // ================================================================== computeNormals with crease splitting
  // computeNormals(mesh, creaseDeg=180, {weight:'angle'|'area', eps})
  // Vertices sharing a position are treated as one smoothing group, so UV seams stay smooth. Faces whose normals differ by more
  // than creaseDeg do not contribute to each other; vertices are split as needed. Returns a new mesh (uvs/attrs carried along).
  G.computeNormals = function (mesh, creaseDeg, o) {
    if (creaseDeg == null) creaseDeg = 180; o = o || {};
    const P = mesh.positions, I = idxOf(mesh), nv = P.length / 3, nt = (I.length / 3) | 0;
    const grp = weldGroups(P, o.eps || autoEps(mesh));
    const fn = new Float32Array(nt * 3), fw = new Float32Array(nt * 3), ok = new Uint8Array(nt);
    const byArea = o.weight === 'area';
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const e3x = P[c] - P[b], e3y = P[c + 1] - P[b + 1], e3z = P[c + 2] - P[b + 2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x, l = sqrt(cx * cx + cy * cy + cz * cz);
      const l1 = sqrt(e1x * e1x + e1y * e1y + e1z * e1z), l2 = sqrt(e2x * e2x + e2y * e2y + e2z * e2z), l3 = sqrt(e3x * e3x + e3y * e3y + e3z * e3z);
      if (!(l > 1e-14 * (l1 * l2 + 1e-30)) || !(l > 1e-18)) { ok[t] = 0; continue; }
      ok[t] = 1; fn[t * 3] = cx / l; fn[t * 3 + 1] = cy / l; fn[t * 3 + 2] = cz / l;
      if (byArea) { fw[t * 3] = fw[t * 3 + 1] = fw[t * 3 + 2] = l; }
      else {
        const ang = (ux, uy, uz, vx, vy, vz, lu, lv) => Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy + uz * vz) / (lu * lv))));
        fw[t * 3] = ang(e1x, e1y, e1z, e2x, e2y, e2z, l1, l2);
        fw[t * 3 + 1] = ang(-e1x, -e1y, -e1z, e3x, e3y, e3z, l1, l3);
        fw[t * 3 + 2] = PI - fw[t * 3] - fw[t * 3 + 1];
      }
    }
    // CSR corners per group
    const gStart = new Int32Array(nv + 2);
    for (let c = 0; c < nt * 3; c++) if (ok[(c / 3) | 0]) gStart[grp[I[c]] + 2]++;
    for (let i = 2; i < nv + 2; i++) gStart[i] += gStart[i - 1];
    const gList = new Int32Array(gStart[nv + 1]);
    for (let c = 0; c < nt * 3; c++) if (ok[(c / 3) | 0]) gList[gStart[grp[I[c]] + 1]++] = c;
    const cosC = Math.cos(Math.min(creaseDeg, 180) * DEG);
    const smoothAll = creaseDeg >= 179.99;
    const groupNormal = (g, out) => {
      let x = 0, y = 0, z = 0;
      for (let k = gStart[g]; k < gStart[g + 1]; k++) { const c = gList[k], t = (c / 3) | 0, w = fw[c]; x += fn[t * 3] * w; y += fn[t * 3 + 1] * w; z += fn[t * 3 + 2] * w; }
      const l = sqrt(x * x + y * y + z * z); if (l < 1e-20) { out[0] = 0; out[1] = 1; out[2] = 0; return false; }
      out[0] = x / l; out[1] = y / l; out[2] = z / l; return true;
    };
    const tmp = [0, 0, 0];
    const hasUV = !!mesh.uvs, hasA = !!mesh.attrs;
    if (smoothAll) {
      const N = new Float32Array(nv * 3), gn = new Float32Array(nv * 3), gd = new Uint8Array(nv);
      for (let v = 0; v < nv; v++) {
        const g = grp[v];
        if (!gd[g]) { gd[g] = 1; groupNormal(g, tmp); gn[g * 3] = tmp[0]; gn[g * 3 + 1] = tmp[1]; gn[g * 3 + 2] = tmp[2]; }
        N[v * 3] = gn[g * 3]; N[v * 3 + 1] = gn[g * 3 + 1]; N[v * 3 + 2] = gn[g * 3 + 2];
      }
      const out = G.deepClone(mesh); out.normals = N; out.indices = Uint32Array.from(I); return out;
    }
    const cN = new Float32Array(nt * 9);
    for (let g = 0; g < nv; g++) {
      const s = gStart[g], e = gStart[g + 1];
      for (let k = s; k < e; k++) {
        const c = gList[k], t = (c / 3) | 0; let x = 0, y = 0, z = 0;
        const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
        for (let j = s; j < e; j++) {
          const c2 = gList[j], t2 = (c2 / 3) | 0, gx = fn[t2 * 3], gy = fn[t2 * 3 + 1], gz = fn[t2 * 3 + 2];
          if (fx * gx + fy * gy + fz * gz >= cosC - 1e-6) { const w = fw[c2]; x += gx * w; y += gy * w; z += gz * w; }
        }
        const l = sqrt(x * x + y * y + z * z) || 1; cN[c * 3] = x / l; cN[c * 3 + 1] = y / l; cN[c * 3 + 2] = z / l;
      }
    }
    // assign to vertices, cloning when normals differ
    const N0 = new Float32Array(nv * 3), has = new Uint8Array(nv), head = new Int32Array(nv).fill(-1);
    const extraSrc = [], extraN = [], extraNext = [], newI = new Uint32Array(nt * 3);
    const same = (ax, ay, az, bx, by, bz) => ax * bx + ay * by + az * bz > 0.9999;
    for (let c = 0; c < nt * 3; c++) {
      const v = I[c];
      if (!ok[(c / 3) | 0]) { newI[c] = v; continue; }
      const x = cN[c * 3], y = cN[c * 3 + 1], z = cN[c * 3 + 2];
      if (!has[v]) { has[v] = 1; N0[v * 3] = x; N0[v * 3 + 1] = y; N0[v * 3 + 2] = z; newI[c] = v; continue; }
      if (same(N0[v * 3], N0[v * 3 + 1], N0[v * 3 + 2], x, y, z)) { newI[c] = v; continue; }
      let k = head[v], found = -1;
      while (k >= 0) { if (same(extraN[k * 3], extraN[k * 3 + 1], extraN[k * 3 + 2], x, y, z)) { found = k; break; } k = extraNext[k]; }
      if (found < 0) { found = extraSrc.length; extraSrc.push(v); extraN.push(x, y, z); extraNext.push(head[v]); head[v] = found; }
      newI[c] = nv + found;
    }
    for (let v = 0; v < nv; v++) if (!has[v]) { groupNormal(grp[v], tmp); N0[v * 3] = tmp[0]; N0[v * 3 + 1] = tmp[1]; N0[v * 3 + 2] = tmp[2]; }
    const ne = extraSrc.length, nOut = nv + ne, out = { positions: new Float32Array(nOut * 3), normals: new Float32Array(nOut * 3), indices: newI };
    out.positions.set(P); out.normals.set(N0);
    if (hasUV) { out.uvs = new Float32Array(nOut * 2); out.uvs.set(mesh.uvs); }
    if (hasA) { out.attrs = new Float32Array(nOut * 4); out.attrs.set(mesh.attrs); }
    for (let k = 0; k < ne; k++) {
      const s = extraSrc[k], d = nv + k;
      out.positions.set(P.subarray(s * 3, s * 3 + 3), d * 3); out.normals[d * 3] = extraN[k * 3]; out.normals[d * 3 + 1] = extraN[k * 3 + 1]; out.normals[d * 3 + 2] = extraN[k * 3 + 2];
      if (hasUV) out.uvs.set(mesh.uvs.subarray(s * 2, s * 2 + 2), d * 2);
      if (hasA) out.attrs.set(mesh.attrs.subarray(s * 4, s * 4 + 4), d * 4);
    }
    return out;
  };

  // ================================================================== index / attribute helpers
  // toIndexed(mesh, eps): meshes without indices get welded into an indexed mesh; indexed meshes are just cloned.
  G.toIndexed = function (mesh, eps) {
    if (mesh.indices) return G.deepClone(mesh);
    const o = G.deepClone(mesh); o.indices = seqIdx(o.positions.length / 3); return G.weld(o, eps);
  };
  // Unshared vertices (3 per triangle) — useful for flat shading / per-face attributes.
  G.toNonIndexed = function (mesh) {
    const I = idxOf(mesh), n = I.length, P = mesh.positions, N = mesh.normals, UV = mesh.uvs, A = mesh.attrs;
    const o = { positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), uvs: new Float32Array(n * 2), indices: seqIdx(n) };
    if (A) o.attrs = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const s = I[i]; o.positions.set(P.subarray(s * 3, s * 3 + 3), i * 3); if (N) o.normals.set(N.subarray(s * 3, s * 3 + 3), i * 3);
      if (UV) o.uvs.set(UV.subarray(s * 2, s * 2 + 2), i * 2); if (A) o.attrs.set(A.subarray(s * 4, s * 4 + 4), i * 4);
    }
    return o;
  };
  G.flatShade = function (mesh) { return G.computeNormals(G.toNonIndexed(mesh), 0); };
  G.toUint16 = function (mesh) {
    if (mesh.positions.length / 3 > 65535) return mesh;
    const o = Object.assign({}, mesh); o.indices = Uint16Array.from(idxOf(mesh)); return o;
  };
  G.fitsUint16 = mesh => mesh.positions.length / 3 <= 65535;
  // setAttrs(mesh, fn) in place: fn(x,y,z, nx,ny,nz, i, out) -> [a,b,c,d] (or fill `out` and return nothing)
  G.setAttrs = function (mesh, fn) {
    const n = mesh.positions.length / 3, P = mesh.positions, N = mesh.normals;
    if (!mesh.attrs) { mesh.attrs = new Float32Array(n * 4); for (let i = 0; i < n; i++) mesh.attrs[i * 4] = 1; }
    const out = [1, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      out[0] = mesh.attrs[i * 4]; out[1] = mesh.attrs[i * 4 + 1]; out[2] = mesh.attrs[i * 4 + 2]; out[3] = mesh.attrs[i * 4 + 3];
      const r = fn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N ? N[i * 3] : 0, N ? N[i * 3 + 1] : 0, N ? N[i * 3 + 2] : 0, i, out) || out;
      mesh.attrs[i * 4] = r[0]; mesh.attrs[i * 4 + 1] = r[1]; mesh.attrs[i * 4 + 2] = r[2]; mesh.attrs[i * 4 + 3] = r[3];
    }
    return mesh;
  };

  // One 1->4 midpoint subdivision (no smoothing). Useful before bending / noise displacement.
  G.subdivideMesh = function (mesh) {
    const I = idxOf(mesh), P = mesh.positions, N = mesh.normals, UV = mesh.uvs, nv = P.length / 3;
    const P2 = [], N2 = [], U2 = [], edge = new Map(), tri = [];
    for (let i = 0; i < P.length; i++) P2.push(P[i]); if (N) for (let i = 0; i < N.length; i++) N2.push(N[i]); if (UV) for (let i = 0; i < UV.length; i++) U2.push(UV[i]);
    let cnt = nv;
    const mid = (a, b) => {
      const k = a < b ? a * 4294967296 + b : b * 4294967296 + a; let m = edge.get(k); if (m !== undefined) return m;
      m = cnt++; edge.set(k, m);
      for (let j = 0; j < 3; j++) P2.push((P[a * 3 + j] + P[b * 3 + j]) / 2);
      if (N) { let x = N[a * 3] + N[b * 3], y = N[a * 3 + 1] + N[b * 3 + 1], z = N[a * 3 + 2] + N[b * 3 + 2]; const l = Math.hypot(x, y, z) || 1; N2.push(x / l, y / l, z / l); }
      if (UV) U2.push((UV[a * 2] + UV[b * 2]) / 2, (UV[a * 2 + 1] + UV[b * 2 + 1]) / 2);
      return m;
    };
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      tri.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    const o = { positions: Float32Array.from(P2), normals: N ? Float32Array.from(N2) : new Float32Array(P2.length), uvs: UV ? Float32Array.from(U2) : new Float32Array(cnt * 2), indices: Uint32Array.from(tri) };
    return o;
  };

  // generateUVs(mesh, {mode:'planar'|'box'|'cylindrical'|'spherical', axis:'x'|'y'|'z'(planar normal / cylinder axis), scale:1 (uv units per metre),
  //                    offset:[u,v], center:[x,y,z]}) -> new mesh.  'box' splits vertices per dominant face axis.
  G.generateUVs = function (mesh, o) {
    o = o || {}; const mode = o.mode || 'box', s = o.scale == null ? 1 : o.scale, off = o.offset || [0, 0];
    const ax = o.axis || (mode === 'planar' ? 'y' : 'y'), b = G.bounds(mesh), c = o.center || b.center;
    const proj = (x, y, z, axis) => axis === 'x' ? [z, y] : axis === 'y' ? [x, z] : [x, y];
    if (mode === 'box') {
      const I = idxOf(mesh), P = mesh.positions, N = mesh.normals, out = G.toNonIndexed(mesh), O = out.positions;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, bb = I[t + 1] * 3, cc = I[t + 2] * 3;
        const ux = P[bb] - P[a], uy = P[bb + 1] - P[a + 1], uz = P[bb + 2] - P[a + 2], vx = P[cc] - P[a], vy = P[cc + 1] - P[a + 1], vz = P[cc + 2] - P[a + 2];
        const nx = abs(uy * vz - uz * vy), ny = abs(uz * vx - ux * vz), nz = abs(ux * vy - uy * vx);
        const axis = nx >= ny && nx >= nz ? 'x' : ny >= nz ? 'y' : 'z';
        for (let k = 0; k < 3; k++) {
          const i = t + k, uv = proj(O[i * 3], O[i * 3 + 1], O[i * 3 + 2], axis);
          out.uvs[i * 2] = uv[0] * s + off[0]; out.uvs[i * 2 + 1] = uv[1] * s + off[1];
        }
      }
      return out;
    }
    const out = G.deepClone(mesh); if (!out.uvs) out.uvs = new Float32Array(out.positions.length / 3 * 2);
    const P = out.positions, n = P.length / 3;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3] - c[0], y = P[i * 3 + 1] - c[1], z = P[i * 3 + 2] - c[2]; let u, v;
      if (mode === 'planar') { const uv = proj(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], ax); u = uv[0]; v = uv[1]; }
      else if (mode === 'cylindrical') {
        const [p, q, h] = ax === 'y' ? [x, z, y] : ax === 'x' ? [y, z, x] : [x, y, z], r = Math.hypot(p, q);
        u = atan2(q, p) / TAU * TAU * max(r, b.radius * 0.5); v = h;
      } else { const r = Math.hypot(x, y, z) || 1; u = atan2(z, x) * r; v = Math.acos(Math.min(1, Math.max(-1, y / r))) * r; }
      out.uvs[i * 2] = u * s + off[0]; out.uvs[i * 2 + 1] = v * s + off[1];
    }
    return out;
  };

  // ================================================================== validate
  // validate(mesh, {expectClosed:false, eps}) -> report. ok = no NaN, no degenerate tris, normals unit & consistent with winding
  // (and, when expectClosed, watertight + consistently oriented + positive (outward) volume).
  G.validate = function (mesh, o) {
    o = o || {}; const P = mesh.positions, N = mesh.normals, I = idxOf(mesh), nv = P.length / 3, nt = (I.length / 3) | 0;
    const r = { vertexCount: nv, triCount: nt, nan: 0, degenerate: 0, badIndices: 0, nonUnitNormals: 0, flippedNormals: 0, boundaryEdges: 0, nonManifoldEdges: 0, orientationConflicts: 0,
      closed: false, volume: 0, area: 0, issues: [] };
    for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) r.nan++;
    if (N) for (let i = 0; i < N.length; i++) if (!Number.isFinite(N[i])) r.nan++;
    if (mesh.uvs) for (let i = 0; i < mesh.uvs.length; i++) if (!Number.isFinite(mesh.uvs[i])) r.nan++;
    if (N) for (let i = 0; i < nv; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); if (abs(l - 1) > 0.02) r.nonUnitNormals++; }
    const eps = o.eps || autoEps(mesh), grp = weldGroups(P, eps), edges = new Map();
    let vol = 0, area = 0;
    for (let t = 0; t < nt; t++) {
      const ia = I[t * 3], ib = I[t * 3 + 1], ic = I[t * 3 + 2];
      if (ia >= nv || ib >= nv || ic >= nv) { r.badIndices++; continue; }
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x, l = sqrt(cx * cx + cy * cy + cz * cz);
      vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
      area += l / 2;
      const ga = grp[ia], gb = grp[ib], gc = grp[ic];
      if (ga === gb || gb === gc || ga === gc || l < 1e-16) { r.degenerate++; continue; }
      if (N) {
        const sx = N[ia * 3] + N[ib * 3] + N[ic * 3], sy = N[ia * 3 + 1] + N[ib * 3 + 1] + N[ic * 3 + 1], sz = N[ia * 3 + 2] + N[ib * 3 + 2] + N[ic * 3 + 2];
        if ((sx * cx + sy * cy + sz * cz) / l < -1e-3) r.flippedNormals++;
      }
      const es = [ga, gb, gb, gc, gc, ga];
      for (let k = 0; k < 3; k++) {
        const u = es[k * 2], v = es[k * 2 + 1], fwd = u < v, key = fwd ? u * 4294967296 + v : v * 4294967296 + u; let e = edges.get(key);
        if (!e) { e = [0, 0]; edges.set(key, e); } e[fwd ? 0 : 1]++;
      }
    }
    for (const e of edges.values()) {
      const tot = e[0] + e[1];
      if (tot === 1) r.boundaryEdges++; else if (tot > 2) r.nonManifoldEdges++; else if (e[0] !== 1) r.orientationConflicts++;
    }
    r.volume = vol; r.area = area; r.closed = r.boundaryEdges === 0 && r.nonManifoldEdges === 0 && nt > 0;
    r.bounds = G.bounds(mesh);
    if (r.nan) r.issues.push(r.nan + ' NaN/Inf values'); if (r.badIndices) r.issues.push(r.badIndices + ' out-of-range indices');
    if (r.degenerate) r.issues.push(r.degenerate + ' degenerate triangles'); if (r.nonUnitNormals) r.issues.push(r.nonUnitNormals + ' non-unit normals');
    if (r.flippedNormals) r.issues.push(r.flippedNormals + ' triangles whose winding opposes their normals');
    if (o.expectClosed) {
      if (r.boundaryEdges) r.issues.push(r.boundaryEdges + ' boundary edges (not watertight)');
      if (r.nonManifoldEdges) r.issues.push(r.nonManifoldEdges + ' non-manifold edges');
      if (r.orientationConflicts) r.issues.push(r.orientationConflicts + ' inconsistently oriented edges');
      if (r.closed && r.volume <= 0) r.issues.push('negative volume (inside-out)');
    }
    r.ok = r.issues.length === 0;
    return r;
  };

  // ================================================================== primitives
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  // Internal parametric grid. fn(u,v,p,n): fills p[3] (and n[3]); returns true if it supplied a normal.
  // Winding: quad (i,j),(i+1,j),(i+1,j+1),(i,j+1)  => normal = dP/du x dP/dv.   lu,lv = metric extents for UVs.
  function buildGrid(nu, nv, fn, o, lu, lv) {
    o = o || {}; nu = max(1, nu | 0); nv = max(1, nv | 0);
    const B = new MB((nu + 1) * (nv + 1)), p = [0, 0, 0], n = [0, 0, 0], k = uvK(o, lu, lv);
    let haveN = true;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv; n[0] = n[1] = n[2] = 0;
      if (!fn(u, v, p, n)) haveN = false;
      B.v(p[0], p[1], p[2], n[0], n[1], n[2], u * lu * k.ku, v * lv * k.kv);
    }
    const w = nu + 1, P = B.p;
    const degen = (a, b) => { const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz < 1e-20; };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * w + i, b = a + 1, c = a + w + 1, d = a + w;
      if (!degen(a, b) && !degen(b, c) && !degen(a, c)) B.tri(a, b, c);
      if (!degen(a, c) && !degen(c, d) && !degen(a, d)) B.tri(a, c, d);
    }
    let m = B.build();
    if (!haveN) m = G.computeNormals(m, 180);
    return m;
  }
  const finish = (m, o) => applyAxis(maybeFlip(m, o), o);

  // ---------------------------------------------------------------- box / roundedBox
  function axisCoords(h, r, segs, div) {
    const out = [];
    if (r <= 0) { for (let k = 0; k <= div; k++) out.push(-h + 2 * h * k / div); return out; }
    for (let k = 0; k <= segs; k++) out.push(-(h - r) - r * tan(PI / 4 * (segs - k) / segs));
    const flat = h - r;
    if (flat > 1e-9) for (let k = 1; k < div; k++) out.push(-flat + 2 * flat * k / div);
    for (let k = 0; k <= segs; k++) out.push(flat + r * tan(PI / 4 * k / segs));
    const res = [out[0]]; for (let i = 1; i < out.length; i++) if (out[i] - res[res.length - 1] > 1e-9) res.push(out[i]);
    return res;
  }
  G.roundedBox = function (sx, sy, sz, r, segs, o) {
    if (Array.isArray(sx)) { o = segs; segs = r; r = sz; [sx, sy, sz] = sx; }
    o = o || {}; const h = [sx / 2, sy / 2, sz / 2];
    r = clamp(r || 0, 0, min(h[0], h[1], h[2])); segs = r > 0 ? max(1, (segs == null ? 3 : segs) | 0) : 0;
    const div = o.div || [1, 1, 1], co = h.map((hh, a) => axisCoords(hh, r, segs, max(1, div[a] | 0)));
    const B = new MB(1024), size = [sx, sy, sz];
    for (let A = 0; A < 3; A++) for (let sg = 1; sg >= -1; sg -= 2) {
      const Bx = (A + 1) % 3, Cx = (A + 2) % 3, cb = co[Bx], cc = co[Cx], nb = cb.length, nc = cc.length, base = B.n;
      const k = uvK(o, size[Bx], size[Cx]);
      for (let j = 0; j < nc; j++) for (let i = 0; i < nb; i++) {
        const p = [0, 0, 0]; p[A] = sg * h[A]; p[Bx] = cb[i]; p[Cx] = cc[j];
        let nrm = [0, 0, 0], pos = p;
        if (r > 0) {
          const inner = [clamp(p[0], -(h[0] - r), h[0] - r), clamp(p[1], -(h[1] - r), h[1] - r), clamp(p[2], -(h[2] - r), h[2] - r)];
          const d = [p[0] - inner[0], p[1] - inner[1], p[2] - inner[2]], l = Math.hypot(d[0], d[1], d[2]);
          nrm = [d[0] / l, d[1] / l, d[2] / l]; pos = [inner[0] + nrm[0] * r, inner[1] + nrm[1] * r, inner[2] + nrm[2] * r];
        } else nrm[A] = sg;
        let mu = pos[Bx] + h[Bx]; const mv = pos[Cx] + h[Cx]; if (sg < 0) mu = size[Bx] - mu;
        B.v(pos[0], pos[1], pos[2], nrm[0], nrm[1], nrm[2], mu * k.ku, mv * k.kv);
      }
      for (let j = 0; j < nc - 1; j++) for (let i = 0; i < nb - 1; i++) {
        const a = base + j * nb + i, b = a + 1, c = a + nb + 1, d = a + nb;
        if (sg > 0) B.quad(a, b, c, d); else B.quad(a, d, c, b);
      }
    }
    return finish(B.build(), o);
  };
  // box(sx,sy,sz,opts) | box([sx,sy,sz],opts). opts.radius|bevel > 0 makes a rounded box.
  G.box = function (sx, sy, sz, o) {
    if (Array.isArray(sx)) { o = sy; [sx, sy, sz] = sx; }
    o = o || {}; return G.roundedBox(sx, sy, sz, o.radius != null ? o.radius : (o.bevel || 0), o.segments != null ? o.segments : (o.bevelSegments || 3), o);
  };

  // ---------------------------------------------------------------- plane / grid
  G.plane = function (w, d, wSeg, dSeg, o) {
    o = o || {}; const ax = o.axis || 'y';
    const m = buildGrid(wSeg || 1, dSeg || 1, (u, v, p, n) => {
      const a = (u - 0.5) * w, b = (v - 0.5) * d;
      if (ax === 'y') { p[0] = a; p[1] = 0; p[2] = -b; n[1] = 1; } else if (ax === 'z') { p[0] = a; p[1] = b; p[2] = 0; n[2] = 1; } else { p[0] = 0; p[1] = b; p[2] = -a; n[0] = 1; }
      return true;
    }, o, w, d);
    return maybeFlip(m, o);
  };
  // grid(uSeg, vSeg, fn, opts): fn(u,v,out) with u,v in 0..1, returns [x,y,z] (or fills out). Winding: normal = dP/du x dP/dv (use opts.flip to invert).
  G.grid = function (uSeg, vSeg, fn, o) {
    o = o || {}; const tmp = [0, 0, 0];
    const ev = (u, v, out) => { out[0] = out[1] = out[2] = 0; const r = fn(u, v, out); if (r) { out[0] = r[0]; out[1] = r[1]; out[2] = r[2]; } return out; };
    let lu = 0, lv = 0, prev = ev(0, 0.5, [0, 0, 0]);
    const S = 16;
    for (let i = 1; i <= S; i++) { const q = ev(i / S, 0.5, tmp); lu += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]); prev = [q[0], q[1], q[2]]; }
    prev = ev(0.5, 0, [0, 0, 0]);
    for (let i = 1; i <= S; i++) { const q = ev(0.5, i / S, tmp); lv += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]); prev = [q[0], q[1], q[2]]; }
    const nf = o.normal;
    const m = buildGrid(uSeg, vSeg, (u, v, p, n) => {
      ev(u, v, p);
      if (nf) { const r = nf(u, v, n); if (r) { n[0] = r[0]; n[1] = r[1]; n[2] = r[2]; } const l = Math.hypot(n[0], n[1], n[2]) || 1; n[0] /= l; n[1] /= l; n[2] /= l; return true; }
      return false;
    }, o, lu, lv);
    return maybeFlip(m, o);
  };

  // parametric(fn, uSeg, vSeg, opts) = grid(uSeg, vSeg, fn, opts) with the (fn, segments) argument order of parametric surfaces
  G.parametric = (fn, uSeg, vSeg, o) => G.grid(uSeg, vSeg, fn, o);

  // ---------------------------------------------------------------- sphere / ellipsoid / cubeSphere
  G.ellipsoid = function (rx, ry, rz, wSeg, hSeg, o) {
    o = o || {}; const phi0 = o.phiStart || 0, phiL = o.phiLength == null ? TAU : o.phiLength, th0 = o.thetaStart || 0, thL = o.thetaLength == null ? PI : o.thetaLength;
    const rm = max(rx, rz);
    const m = buildGrid(wSeg || 32, hSeg || 16, (u, v, p, n) => {
      const ph = phi0 + u * phiL, th = th0 + v * thL, st = sin(th), ct = cos(th), cp = cos(ph), sp = sin(ph);
      p[0] = rx * st * cp; p[1] = ry * ct; p[2] = rz * st * sp;
      let nx = st * cp / rx, ny = ct / ry, nz = st * sp / rz; const l = Math.hypot(nx, ny, nz) || 1; n[0] = nx / l; n[1] = ny / l; n[2] = nz / l; return true;
    }, o, phiL * rm, thL * max(ry, rm));
    return finish(m, o);
  };
  G.sphere = (r, wSeg, hSeg, o) => G.ellipsoid(r, r, r, wSeg, hSeg, o);
  G.cubeSphere = function (r, n, o) {
    o = o || {}; n = max(1, n | 0 || 8); const B = new MB(6 * (n + 1) * (n + 1)), k = uvK(o, r * PI / 2, r * PI / 2);
    for (let A = 0; A < 3; A++) for (let sg = 1; sg >= -1; sg -= 2) {
      const Bx = (A + 1) % 3, Cx = (A + 2) % 3, base = B.n;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const p = [0, 0, 0]; p[A] = sg; p[Bx] = tan((2 * i / n - 1) * PI / 4); p[Cx] = tan((2 * j / n - 1) * PI / 4);
        const l = Math.hypot(p[0], p[1], p[2]), nx = p[0] / l, ny = p[1] / l, nz = p[2] / l;
        B.v(nx * r, ny * r, nz * r, nx, ny, nz, i / n * r * PI / 2 * k.ku, j / n * r * PI / 2 * k.kv);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 2, d = a + n + 1;
        if (sg > 0) B.quad(a, b, c, d); else B.quad(a, d, c, b);
      }
    }
    return finish(B.build(), o);
  };

  // ---------------------------------------------------------------- torus
  // torus(R, r, tubularSeg=48, radialSeg=16, {arc}) ring in the XZ plane (axis Y).
  G.torus = function (R, r, tSeg, rSeg, o) {
    o = o || {}; const arc = o.arc == null ? TAU : o.arc;
    const m = buildGrid(rSeg || 16, tSeg || 48, (u, v, p, n) => {
      const th = u * TAU, ph = v * arc, c = cos(th), s = sin(th), cp = cos(ph), sp = sin(ph);
      p[0] = (R + r * c) * cp; p[1] = r * s; p[2] = (R + r * c) * sp; n[0] = c * cp; n[1] = s; n[2] = c * sp; return true;
    }, o, TAU * r, arc * R);
    return finish(m, o);
  };

  // ================================================================== profile machinery (lathe, extrude)
  // pts: [{a,b,c}] (a = outward coordinate, b = axial coordinate, c = crease flag). Traversal bottom->top gives outward normals
  // (normal = (db,-da)/len). Returns entries (ring definitions) + per point in/out entry indices.
  function profileEntries(pts, creaseRad, pole) {
    const q = [];
    for (const p of pts) { const l = q[q.length - 1]; if (!l || Math.hypot(p.a - l.a, p.b - l.b) > 1e-9) q.push(p); else if (p.c !== undefined && l.c === undefined) l.c = p.c; }
    const n = q.length, closed = n > 2 && Math.hypot(q[0].a - q[n - 1].a, q[0].b - q[n - 1].b) < 1e-9;
    const segN = [], segL = [], cum = [0];
    for (let k = 0; k < n - 1; k++) {
      const da = q[k + 1].a - q[k].a, db = q[k + 1].b - q[k].b, l = Math.hypot(da, db);
      segN.push([db / l, -da / l]); segL.push(l); cum.push(cum[k] + l);
    }
    const E = [], inI = [], outI = [];
    for (let k = 0; k < n; k++) {
      const pv = k > 0 ? segN[k - 1] : (closed ? segN[n - 2] : null), nx = k < n - 1 ? segN[k] : (closed ? segN[0] : null);
      let nIn, nOut;
      if (!pv) nIn = nOut = nx; else if (!nx) nIn = nOut = pv;
      else {
        const d = pv[0] * nx[0] + pv[1] * nx[1], flag = q[k].c;
        const split = flag === true || (flag !== false && Math.acos(clamp(d, -1, 1)) > creaseRad) || d < -0.999;
        if (!split) { const x = pv[0] + nx[0], y = pv[1] + nx[1], l = Math.hypot(x, y) || 1; nIn = nOut = [x / l, y / l]; } else { nIn = pv; nOut = nx; }
      }
      if (pole && abs(q[k].a) < 1e-9) {
        const snap = nn => (Math.acos(clamp(abs(nn[1]), 0, 1)) < creaseRad ? [0, nn[1] >= 0 ? 1 : -1] : nn);
        nIn = snap(nIn); nOut = snap(nOut);
      }
      inI.push(E.length); E.push({ a: q[k].a, b: q[k].b, na: nIn[0], nb: nIn[1], s: cum[k] });
      if (nIn === nOut) outI.push(E.length - 1); else { outI.push(E.length); E.push({ a: q[k].a, b: q[k].b, na: nOut[0], nb: nOut[1], s: cum[k] }); }
    }
    return { E, inI, outI, n, len: cum[n - 1], pts: q };
  }

  // ---------------------------------------------------------------- lathe
  G.lathe = function (profile, segments, o) {
    o = o || {};
    const pts = profile.map(p => Array.isArray(p) ? { a: p[0], b: p[1], c: p[2] } : { a: p.r != null ? p.r : p.x, b: p.y, c: p.crease });
    const pe = profileEntries(pts, (o.crease == null ? 35 : o.crease) * DEG, true);
    const seg = max(1, (segments == null ? 32 : segments) | 0), start = o.start || 0, sweep = o.sweep != null ? o.sweep : (o.end != null ? o.end - start : TAU);
    let amax = 0; for (const e of pe.E) amax = max(amax, abs(e.a));
    const k = uvK(o, sweep * amax, pe.len), B = new MB(pe.E.length * (seg + 1)), cs = [], sn = [];
    for (let i = 0; i <= seg; i++) { const ph = start + sweep * i / seg; cs.push(cos(ph)); sn.push(sin(ph)); }
    if (abs(sweep - TAU) < 1e-9) { cs[seg] = cs[0]; sn[seg] = sn[0]; }
    const ringBase = [];
    for (const e of pe.E) {
      ringBase.push(B.n);
      for (let i = 0; i <= seg; i++) B.v(e.a * cs[i], e.b, e.a * sn[i], e.na * cs[i], e.nb, e.na * sn[i], i / seg * sweep * amax * k.ku, e.s * k.kv);
    }
    for (let s = 0; s < pe.n - 1; s++) {
      const A = ringBase[pe.outI[s]], Bb = ringBase[pe.inI[s + 1]], ea = pe.E[pe.outI[s]], eb = pe.E[pe.inI[s + 1]];
      const pa = abs(ea.a) < 1e-9, pb = abs(eb.a) < 1e-9;
      if (pa && pb) continue;
      for (let i = 0; i < seg; i++) {
        if (!pb) B.tri(A + i, Bb + i, Bb + i + 1);
        if (!pa) B.tri(A + i, Bb + i + 1, A + i + 1);
      }
    }
    return finish(B.build(), o);
  };

  // ---------------------------------------------------------------- cylinder family
  // cylinder(rTop, rBottom, height, radialSeg=32, heightSeg=1, {caps, start, sweep, axis, crease}) centred on the origin, axis +Y.
  G.cylinder = function (rt, rb, h, radialSeg, heightSeg, o) {
    o = o || {}; heightSeg = max(1, (heightSeg == null ? 1 : heightSeg) | 0);
    let capT = true, capB = true;
    if (o.caps === false || o.openEnded) capT = capB = false; else if (o.caps && typeof o.caps === 'object') { capT = o.caps.top !== false; capB = o.caps.bottom !== false; }
    if (rt <= 1e-12) capT = false; if (rb <= 1e-12) capB = false;
    const pts = [];
    if (capB) pts.push([0, -h / 2]);
    for (let j = 0; j <= heightSeg; j++) { const t = j / heightSeg; pts.push([rb + (rt - rb) * t, -h / 2 + h * t, (j === 0 && capB) || (j === heightSeg && capT) ? true : undefined]); }
    if (capT) pts.push([0, h / 2]);
    return G.lathe(pts, radialSeg == null ? 32 : radialSeg, o);
  };
  G.frustum = G.cylinder;
  G.cyl = (r, h, radialSeg, o) => G.cylinder(r, r, h, radialSeg, 1, o);
  G.cone = (r, h, radialSeg, heightSeg, o) => G.cylinder(0, r, h, radialSeg, heightSeg, o);

  // flat discs: planar (metric) UVs, normal +Y
  function planarXZ(m, o, extent) {
    const k = uvK(o, extent, extent), P = m.positions, U = m.uvs;
    for (let i = 0; i < P.length / 3; i++) { U[i * 2] = (P[i * 3] + extent / 2) * k.ku; U[i * 2 + 1] = (P[i * 3 + 2] + extent / 2) * k.kv; }
    return m;
  }
  G.disc = function (r, seg, o) {
    o = o || {}; const m = planarXZ(G.lathe([[r, 0], [0, 0]], seg == null ? 48 : seg, Object.assign({}, o, { axis: 'y', flip: false })), o, 2 * r);
    return finish(m, o);
  };
  G.ring = function (ri, ro, seg, o) {
    o = o || {}; const m = planarXZ(G.lathe([[ro, 0], [ri, 0]], seg == null ? 48 : seg, Object.assign({}, o, { axis: 'y', flip: false })), o, 2 * ro);
    return finish(m, o);
  };

  G.annulus = G.ring;

  // capsule(r, length, radialSeg=24, capSeg=8, heightSeg=1): `length` is the straight section between the two hemispheres. Axis +Y.
  G.capsule = function (r, len, radialSeg, capSeg, heightSeg, o) {
    o = o || {}; capSeg = max(2, (capSeg == null ? 8 : capSeg) | 0); heightSeg = max(1, (heightSeg == null ? 1 : heightSeg) | 0);
    const pts = [];
    for (let i = 0; i <= capSeg; i++) { const a = -PI / 2 + i / capSeg * PI / 2; pts.push([i === 0 ? 0 : r * cos(a), -len / 2 + r * sin(a), false]); }
    for (let j = 1; j < heightSeg; j++) pts.push([r, -len / 2 + len * j / heightSeg, false]);
    for (let i = 0; i <= capSeg; i++) { const a = i / capSeg * PI / 2; pts.push([i === capSeg ? 0 : r * cos(a), len / 2 + r * sin(a), false]); }
    return G.lathe(pts, radialSeg == null ? 24 : radialSeg, o);
  };

  // ================================================================== 2D polygon toolkit
  const P2 = {
    // signed area, CCW positive
    area(poly) { let a = 0; for (let i = 0, n = poly.length; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; },
  };
  G.polygonArea = P2.area;
  G.isCCW = poly => P2.area(poly) > 0;
  G.reversePolygon = poly => poly.slice().reverse();
  G.pointInPolygon = function (pt, poly) {
    let inside = false; const x = pt[0], y = pt[1];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  // remove repeated/near-duplicate consecutive points and a repeated closing point
  function cleanPoly(poly, eps) {
    eps = eps || 1e-9; const out = [];
    for (const p of poly) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > eps) out.push([p[0], p[1]]); }
    while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
    return out;
  }
  G.cleanPolygon = cleanPoly;

  // ---------------------------------------------------------------- ear-clipping triangulation (with holes)
  // Port of the classic linked-list earcut algorithm (hole bridging, ear clipping, self-intersection recovery).
  function TN(i, x, y) { this.i = i; this.x = x; this.y = y; this.prev = null; this.next = null; this.steiner = false; }
  const tArea = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);   // < 0 for a convex (CCW) corner
  const tEq = (a, b) => a.x === b.x && a.y === b.y;
  function tRemove(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function tInsert(i, x, y, last) {
    const p = new TN(i, x, y);
    if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function tList(pts, start, end, ccw) {
    let a = 0; for (let i = start, j = end - 1; i < end; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[i][1] + pts[j][1]);
    // a > 0 for CCW here
    let last;
    if ((a > 0) === ccw) for (let i = start; i < end; i++) last = tInsert(i, pts[i][0], pts[i][1], last);
    else for (let i = end - 1; i >= start; i--) last = tInsert(i, pts[i][0], pts[i][1], last);
    if (last && tEq(last, last.next)) { tRemove(last); last = last.next; }
    return last;
  }
  function tFilter(start, end) {
    if (!start) return start; if (!end) end = start;
    let p = start, again;
    do {
      again = false;
      if (!p.steiner && (tEq(p, p.next) || tArea(p.prev, p, p.next) === 0)) {
        tRemove(p); p = end = p.prev; if (p === p.next) break; again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }
  const tPointInTri = (ax, ay, bx, by, cx, cy, px, py) => (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  function tIsEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (tArea(a, b, c) >= 0) return false;
    const x0 = min(a.x, b.x, c.x), y0 = min(a.y, b.y, c.y), x1 = max(a.x, b.x, c.x), y1 = max(a.y, b.y, c.y);
    let p = c.next;
    while (p !== a) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && !(a.x === p.x && a.y === p.y) && tPointInTri(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && tArea(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  const tSign = n => n > 0 ? 1 : n < 0 ? -1 : 0;
  const tOnSeg = (p, q, r) => q.x <= max(p.x, r.x) && q.x >= min(p.x, r.x) && q.y <= max(p.y, r.y) && q.y >= min(p.y, r.y);
  function tIntersects(p1, q1, p2, q2) {
    const o1 = tSign(tArea(p1, q1, p2)), o2 = tSign(tArea(p1, q1, q2)), o3 = tSign(tArea(p2, q2, p1)), o4 = tSign(tArea(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && tOnSeg(p1, p2, q1)) return true; if (o2 === 0 && tOnSeg(p1, q2, q1)) return true;
    if (o3 === 0 && tOnSeg(p2, p1, q2)) return true; if (o4 === 0 && tOnSeg(p2, q1, q2)) return true;
    return false;
  }
  function tLocallyInside(a, b) {
    return tArea(a.prev, a, a.next) < 0 ? tArea(a, b, a.next) >= 0 && tArea(a, a.prev, b) >= 0 : tArea(a, b, a.prev) < 0 || tArea(a, a.next, b) < 0;
  }
  function tMiddleInside(a, b) {
    let p = a, inside = false; const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do { if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside; p = p.next; } while (p !== a);
    return inside;
  }
  function tSplit(a, b) {
    const a2 = new TN(a.i, a.x, a.y), b2 = new TN(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp; return b2;
  }
  function tIntersectsPoly(a, b) {
    let p = a;
    do { if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && tIntersects(p, p.next, a, b)) return true; p = p.next; } while (p !== a);
    return false;
  }
  function tValidDiag(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !tIntersectsPoly(a, b) &&
      (tLocallyInside(a, b) && tLocallyInside(b, a) && tMiddleInside(a, b) && (tArea(a.prev, a, b.prev) || tArea(a, b.prev, b)) || tEq(a, b) && tArea(a.prev, a, a.next) > 0 && tArea(b.prev, b, b.next) > 0);
  }
  function tCure(start, tris) {
    let p = start;
    do {
      const a = p.prev, b = p.next.next;
      if (!tEq(a, b) && tIntersects(a, p, p.next, b) && tLocallyInside(a, b) && tLocallyInside(b, a)) {
        tris.push(a.i, p.i, b.i); tRemove(p); tRemove(p.next); p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return tFilter(p);
  }
  function tSplitEar(start, tris) {
    let a = start;
    do {
      let b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && tValidDiag(a, b)) {
          let c = tSplit(a, b); a = tFilter(a, a.next); c = tFilter(c, c.next); tEarcut(a, tris, 0); tEarcut(c, tris, 0); return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function tEarcut(ear, tris, pass) {
    if (!ear) return;
    let stop = ear, prev, next;
    while (ear.prev !== ear.next) {
      prev = ear.prev; next = ear.next;
      if (tIsEar(ear)) { tris.push(prev.i, ear.i, next.i); tRemove(ear); ear = next.next; stop = next.next; continue; }
      ear = next;
      if (ear === stop) {
        if (!pass) tEarcut(tFilter(ear), tris, 1);
        else if (pass === 1) { ear = tCure(tFilter(ear), tris); tEarcut(ear, tris, 2); }
        else if (pass === 2) tSplitEar(ear, tris);
        break;
      }
    }
  }
  function tHoleBridge(hole, outer) {
    let p = outer; const hx = hole.x, hy = hole.y; let qx = -Infinity, m;
    do {
      if (tEq(hole, p)) return p;
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
      }
      p = p.next;
    } while (p !== outer);
    if (!m) return null;
    const stop = m, mx = m.x, my = m.y; let tanMin = Infinity;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x && tPointInTri(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        const t = abs(hy - p.y) / (hx - p.x);
        if (tLocallyInside(p, hole) && (t < tanMin || (t === tanMin && (p.x > m.x || (p.x === m.x && tArea(m.prev, m, p.prev) < 0 && tArea(p.next, m, m.next) < 0))))) { m = p; tanMin = t; }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  // triangulate(polygon, holes?) -> flat index array (triples, CCW). Indices refer to polygon points followed by each hole's points.
  G.triangulate = function (poly, holes) {
    holes = holes || []; const pts = poly.slice(); const starts = [];
    for (const h of holes) { starts.push(pts.length); for (const p of h) pts.push(p); }
    let outer = tList(pts, 0, poly.length, true); const tris = [];
    if (!outer || outer.next === outer.prev) return tris;
    if (holes.length) {
      const queue = [];
      for (let k = 0; k < holes.length; k++) {
        const list = tList(pts, starts[k], starts[k] + holes[k].length, false); if (!list) continue;
        if (list === list.next) list.steiner = true;
        let l = list, p = list; do { if (p.x < l.x || (p.x === l.x && p.y < l.y)) l = p; p = p.next; } while (p !== list);
        queue.push(l);
      }
      queue.sort((a, b) => a.x - b.x);
      for (const hole of queue) {
        const bridge = tHoleBridge(hole, outer); if (!bridge) continue;
        const br = tSplit(bridge, hole); tFilter(br, br.next); outer = tFilter(bridge, bridge.next);
      }
    }
    tEarcut(outer, tris, 0);
    return removeSlivers(pts, fixDropped(pts, tris));
  };
  // Remove zero-area triangles produced by collinear points: split the neighbour across the long edge at the middle vertex instead.
  function removeSlivers(pts, tris) {
    for (let guard = 0; guard < 4 * pts.length + 8; guard++) {
      let found = -1;
      for (let t = 0; t < tris.length; t += 3) {
        const a = pts[tris[t]], b = pts[tris[t + 1]], c = pts[tris[t + 2]];
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        const sc = max(abs(b[0] - a[0]), abs(b[1] - a[1]), abs(c[0] - a[0]), abs(c[1] - a[1]), 1e-12);
        if (abs(cr) <= 1e-10 * sc * sc) { found = t; break; }
      }
      if (found < 0) break;
      const i0 = tris[found], i1 = tris[found + 1], i2 = tris[found + 2], ids = [i0, i1, i2];
      tris[found] = tris[tris.length - 3]; tris[found + 1] = tris[tris.length - 2]; tris[found + 2] = tris[tris.length - 1]; tris.length -= 3;
      // long edge = pair with largest separation; w = the remaining vertex
      let bu = 0, bv = 1, bl = -1;
      for (let k = 0; k < 3; k++) { const u = pts[ids[k]], v = pts[ids[(k + 1) % 3]], l = (u[0] - v[0]) * (u[0] - v[0]) + (u[1] - v[1]) * (u[1] - v[1]); if (l > bl) { bl = l; bu = k; bv = (k + 1) % 3; } }
      const u = ids[bu], v = ids[bv], w = ids[3 - bu - bv];
      if (bl < 1e-24 || pts[w][0] === pts[u][0] && pts[w][1] === pts[u][1] || pts[w][0] === pts[v][0] && pts[w][1] === pts[v][1]) continue;
      for (let t = 0; t < tris.length; t += 3) {
        let hit = false;
        for (let k = 0; k < 3; k++) {
          const a = tris[t + k], b = tris[t + (k + 1) % 3];
          if ((a === u && b === v) || (a === v && b === u)) { const c = tris[t + (k + 2) % 3]; tris[t] = a; tris[t + 1] = w; tris[t + 2] = c; tris.push(w, b, c); hit = true; break; }
        }
        if (hit) break;
      }
    }
    return tris;
  }
  // Ear clipping discards collinear points; re-insert them by splitting the triangle whose edge they lie on, so the cap
  // stays watertight against neighbouring surfaces (no T-junction cracks).
  function fixDropped(pts, tris) {
    const n = pts.length, used = new Uint8Array(n);
    for (let i = 0; i < tris.length; i++) used[tris[i]] = 1;
    for (let v = 0; v < n; v++) {
      if (used[v]) continue;
      const px = pts[v][0], py = pts[v][1]; let best = -1, bk = -1, bd = Infinity;
      for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = pts[tris[t + k]], b = pts[tris[t + (k + 1) % 3]], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        if (l2 < 1e-24) continue;
        const u = ((px - a[0]) * dx + (py - a[1]) * dy) / l2; if (u <= 1e-9 || u >= 1 - 1e-9) continue;
        const d = abs((px - a[0]) * dy - (py - a[1]) * dx) / sqrt(l2);
        if (d < bd) { bd = d; best = t; bk = k; }
      }
      if (best < 0 || bd > 1e-7) continue;
      const a = tris[best + bk], b = tris[best + (bk + 1) % 3], c = tris[best + (bk + 2) % 3];
      tris[best] = a; tris[best + 1] = v; tris[best + 2] = c; tris.push(v, b, c); used[v] = 1;
    }
    return tris;
  }

  // ---------------------------------------------------------------- polygon offset / rounding / shapes
  // offsetPolygon(poly, dist, {join:'miter'|'round'|'bevel', miterLimit:3, arcSegments:6}): dist > 0 grows, dist < 0 shrinks; any winding.
  // Result has the same winding as the input. Intended for offsets smaller than the local feature size.
  G.offsetPolygon = function (poly, dist, o) {
    o = o || {}; poly = cleanPoly(poly); const n = poly.length;
    if (n < 3 || !dist) return poly.map(p => p.slice());
    const sgn = P2.area(poly) > 0 ? 1 : -1, join = o.join || 'miter', ml = o.miterLimit || 3, arcSeg = o.arcSegments || 6;
    const E = [], Nn = [], L = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      E.push([dx / l, dy / l]); L.push(l); Nn.push([sgn * dy / l, -sgn * dx / l]);
    }
    let out = [];
    for (let i = 0; i < n; i++) {
      const v = poly[i], e0 = E[(i + n - 1) % n], e1 = E[i], n0 = Nn[(i + n - 1) % n], n1 = Nn[i];
      const d = n0[0] * n1[0] + n0[1] * n1[1], cr = e0[0] * e1[1] - e0[1] * e1[0];
      const needJoin = dist * sgn * cr > 1e-12, mit = sqrt(2 / max(1 + d, 1e-9));
      if (!needJoin || (join === 'miter' && mit <= ml)) {
        const k = dist / max(1 + d, 1e-3); out.push([v[0] + (n0[0] + n1[0]) * k, v[1] + (n0[1] + n1[1]) * k]);
      } else if (join === 'round') {
        const ang = Math.acos(clamp(d, -1, 1)), steps = max(1, Math.ceil(ang / (PI / 2) * arcSeg)), a0 = atan2(n0[1], n0[0]);
        const sign = n0[0] * n1[1] - n0[1] * n1[0] >= 0 ? 1 : -1;
        for (let s = 0; s <= steps; s++) { const a = a0 + sign * ang * s / steps; out.push([v[0] + cos(a) * dist, v[1] + sin(a) * dist]); }
      } else { out.push([v[0] + n0[0] * dist, v[1] + n0[1] * dist]); out.push([v[0] + n1[0] * dist, v[1] + n1[1] * dist]); }
    }
    // collapse edges whose direction reversed (inset larger than feature size)
    for (let pass = 0; pass < 4 && out.length > 3; pass++) {
      let changed = false; const res = [];
      const m = out.length;
      const ref = c => { let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; const t = clamp(((c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1])) / (L[i] * L[i]), 0, 1); const dd = Math.hypot(c[0] - a[0] - t * (b[0] - a[0]), c[1] - a[1] - t * (b[1] - a[1])); if (dd < bd) { bd = dd; best = i; } } return best; };
      for (let i = 0; i < m; i++) {
        const a = out[i], b = out[(i + 1) % m], e = E[ref([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9 && (b[0] - a[0]) * e[0] + (b[1] - a[1]) * e[1] < 0 && dist < 0) { changed = true; i++; res.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); } else res.push(a);
      }
      out = res; if (!changed) break;
    }
    if (dist < 0 && out.length >= 3 && Math.sign(P2.area(out)) !== Math.sign(P2.area(poly))) return [];
    return out;
  };
  G.inset = (poly, d, o) => G.offsetPolygon(poly, -abs(d), o);
  G.outset = (poly, d, o) => G.offsetPolygon(poly, abs(d), o);

  // roundPolygon(poly, radius | [radius per vertex], segments=6): fillets every corner with a circular arc (radius reduced to fit short edges).
  G.roundPolygon = function (poly, radius, seg) {
    poly = cleanPoly(poly); const n = poly.length, out = []; seg = max(1, seg == null ? 6 : seg | 0);
    const lens = poly.map((p, i) => Math.hypot(poly[(i + 1) % n][0] - p[0], poly[(i + 1) % n][1] - p[1]));
    for (let i = 0; i < n; i++) {
      const v = poly[i], pv = poly[(i + n - 1) % n], nx = poly[(i + 1) % n], r = Array.isArray(radius) ? radius[i] : radius;
      const l0 = lens[(i + n - 1) % n], l1 = lens[i];
      const e0 = [(v[0] - pv[0]) / l0, (v[1] - pv[1]) / l0], e1 = [(nx[0] - v[0]) / l1, (nx[1] - v[1]) / l1];
      const cr = e0[0] * e1[1] - e0[1] * e1[0], dt = e0[0] * e1[0] + e0[1] * e1[1], th = Math.acos(clamp(dt, -1, 1));
      if (!r || th < 1e-4 || th > PI - 1e-4) { out.push([v[0], v[1]]); continue; }
      let t = r * tan(th / 2); const lim = 0.5 * min(l0, l1) + 1e-12; if (t > lim) t = lim;
      const re = t / tan(th / 2), t0 = [v[0] - e0[0] * t, v[1] - e0[1] * t];
      const nrm = cr > 0 ? [-e0[1], e0[0]] : [e0[1], -e0[0]], c = [t0[0] + nrm[0] * re, t0[1] + nrm[1] * re], a0 = atan2(t0[1] - c[1], t0[0] - c[0]);
      const steps = max(1, Math.ceil(th / (PI / 2) * seg)), sg = cr > 0 ? 1 : -1;
      for (let s = 0; s <= steps; s++) { const a = a0 + sg * th * s / steps; out.push([c[0] + cos(a) * re, c[1] + sin(a) * re]); }
    }
    return out;
  };

  const shapes = G.shapes = {
    circle(r, n, cx, cy) { n = n || 32; cx = cx || 0; cy = cy || 0; const o = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; o.push([cx + cos(a) * r, cy + sin(a) * r]); } return o; },
    ellipse(rx, ry, n) { n = n || 32; const o = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; o.push([cos(a) * rx, sin(a) * ry]); } return o; },
    rect(w, h) { return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; },
    roundRect(w, h, r, seg) { return G.roundPolygon(shapes.rect(w, h), min(r, w / 2, h / 2), seg == null ? 6 : seg); },
    ngon(r, n, rot) { rot = rot || 0; const o = []; for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; o.push([cos(a) * r, sin(a) * r]); } return o; },
    star(rOut, rIn, n, rot) { rot = rot || 0; const o = []; for (let i = 0; i < n * 2; i++) { const a = rot + i / (n * 2) * TAU, r = i % 2 ? rIn : rOut; o.push([cos(a) * r, sin(a) * r]); } return o; },
    // stadium shape along X: overall length, width
    slot(length, width, seg) {
      seg = seg || 8; const r = width / 2, c = length / 2 - r, o = [];
      for (let i = 0; i <= seg; i++) { const a = -PI / 2 + i / seg * PI; o.push([c + cos(a) * r, sin(a) * r]); }
      for (let i = 0; i <= seg; i++) { const a = PI / 2 + i / seg * PI; o.push([-c + cos(a) * r, sin(a) * r]); }
      return cleanPoly(o);
    },
    // open arc (not a polygon): points from a0 to a1
    arc(r, a0, a1, n, cx, cy) { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([(cx || 0) + cos(a) * r, (cy || 0) + sin(a) * r]); } return o; },
    // gear outline: trapezoid teeth, tooth tip at rOut, root at rIn
    gear(rOut, rIn, teeth, tipFrac, rootFrac) {
      tipFrac = tipFrac == null ? 0.25 : tipFrac; rootFrac = rootFrac == null ? 0.45 : rootFrac; const o = [], step = TAU / teeth;
      for (let i = 0; i < teeth; i++) {
        const a = i * step, pts = [[-rootFrac / 2, rIn], [-tipFrac / 2, rOut], [tipFrac / 2, rOut], [rootFrac / 2, rIn]];
        for (const [f, r] of pts) o.push([cos(a + f * step) * r, sin(a + f * step) * r]);
      }
      return o;
    },
  };

  // ================================================================== extrude
  // extrude(polygon, depth, {holes, center, steps, caps, bevel:{size,depth,segments}|bevelSize|bevelDepth|bevelSegments, crease, uv})
  // polygon [[x,y],...] any winding, concave OK; holes: array of polygons. Result spans z = 0..depth (or -depth/2..depth/2 with center).
  // Bevel rounds both cap edges (quarter ellipse: `size` inwards in the plane, `depth` along z). size must stay below the local feature size.
  G.extrude = function (polygon, depth, o) {
    o = o || {};
    const loops = [];
    let outer = cleanPoly(polygon); if (P2.area(outer) < 0) outer.reverse(); loops.push(outer);
    for (const h of (o.holes || [])) { const hh = cleanPoly(h); if (hh.length < 3) continue; if (P2.area(hh) > 0) hh.reverse(); loops.push(hh); }
    const bv = o.bevel, bs = bv ? (typeof bv === 'number' ? bv : bv.size || 0) : (o.bevelSize || 0);
    let bd = bv && typeof bv === 'object' && bv.depth != null ? bv.depth : (o.bevelDepth != null ? o.bevelDepth : bs);
    const bn = max(1, ((bv && typeof bv === 'object' ? bv.segments : null) || o.bevelSegments || 3) | 0), steps = max(1, (o.steps || 1) | 0);
    const z0 = o.center ? -depth / 2 : 0, z1 = z0 + depth; bd = min(bd, depth / 2);
    const creaseRad = (o.crease == null ? 35 : o.crease) * DEG;
    // profile in (a = -inset, b = z)
    const pp = [];
    if (bs > 0 && bd > 0) {
      for (let k = 0; k <= bn; k++) { const an = (bn - k) / bn * PI / 2; pp.push({ a: -bs * (1 - cos(an)), b: z0 + bd - bd * sin(an), n: k === 0 ? [0, -1] : undefined }); }
      for (let j = 1; j < steps; j++) pp.push({ a: 0, b: z0 + bd + (depth - 2 * bd) * j / steps });
      for (let k = 0; k <= bn; k++) { const an = k / bn * PI / 2; pp.push({ a: -bs * (1 - cos(an)), b: z1 - bd + bd * sin(an), n: k === bn ? [0, 1] : undefined }); }
    } else for (let j = 0; j <= steps; j++) pp.push({ a: 0, b: z0 + depth * j / steps });
    const pe = profileEntries(pp, creaseRad, false);
    // apply endpoint normal overrides
    if (pp[0].n) { const e = pe.E[pe.inI[0]]; e.na = 0; e.nb = -1; }
    if (pp[pp.length - 1].n) { const e = pe.E[pe.outI[pe.n - 1]]; e.na = 0; e.nb = 1; }
    const insetTop = bs > 0 && bd > 0 ? bs : 0;
    const B = new MB(1024);
    const capPts = [], capLoops = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of outer) { x0 = min(x0, p[0]); x1 = max(x1, p[0]); y0 = min(y0, p[1]); y1 = max(y1, p[1]); }
    for (const loop of loops) {
      const n = loop.length, ex = [], ey = [], el = [];
      for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); ex.push(dx / l); ey.push(dy / l); el.push(l); }
      // vertex data
      const vd = [], cum = [0]; for (let i = 0; i < n; i++) cum.push(cum[i] + el[i]);
      for (let i = 0; i < n; i++) {
        const ip = (i + n - 1) % n, nlpx = -ey[ip], nlpy = ex[ip], nlnx = -ey[i], nlny = ex[i], d = nlpx * nlnx + nlpy * nlny;
        let mx = (nlpx + nlnx) / (1 + d), my = (nlpy + nlny) / (1 + d); const ml = Math.hypot(mx, my); if (ml > 4) { mx *= 4 / ml; my *= 4 / ml; }
        const split = Math.acos(clamp(d, -1, 1)) > creaseRad || d < -0.99;
        vd.push({ mx, my, split, pn: [-nlpx, -nlpy], nn: [-nlnx, -nlny], sm: (() => { const x = -(nlpx + nlnx), y = -(nlpy + nlny), l = Math.hypot(x, y) || 1; return [x / l, y / l]; })() });
      }
      const cols = []; // {v, ox, oy, u}
      const inCol = new Array(n + 1), outCol = new Array(n + 1);
      for (let i = 0; i <= n; i++) {
        const v = i % n, d = vd[v];
        if (!d.split) { cols.push({ v, ox: d.sm[0], oy: d.sm[1], u: cum[i] }); inCol[i] = outCol[i] = cols.length - 1; }
        else {
          if (i > 0) { cols.push({ v, ox: d.pn[0], oy: d.pn[1], u: cum[i] }); inCol[i] = cols.length - 1; }
          if (i < n) { cols.push({ v, ox: d.nn[0], oy: d.nn[1], u: cum[i] }); outCol[i] = cols.length - 1; }
        }
      }
      const k = uvK(o, cum[n], pe.len), base = B.n, ne = pe.E.length;
      for (const c of cols) {
        const vx = loop[c.v][0], vy = loop[c.v][1], m = vd[c.v];
        for (const e of pe.E) {
          const ins = -e.a;
          B.v(vx + m.mx * ins, vy + m.my * ins, e.b, e.na * c.ox, e.na * c.oy, e.nb, c.u * k.ku, e.s * k.kv);
        }
      }
      for (let i = 0; i < n; i++) {
        const c1 = outCol[i], c2 = inCol[i + 1];
        for (let s = 0; s < pe.n - 1; s++) {
          const ea = pe.outI[s], eb = pe.inI[s + 1];
          B.quad(base + c1 * ne + ea, base + c2 * ne + ea, base + c2 * ne + eb, base + c1 * ne + eb);
        }
      }
      const pts = loop.map((p, i) => [p[0] + vd[i].mx * insetTop, p[1] + vd[i].my * insetTop]);
      capLoops.push(pts);
    }
    if (o.caps !== false) {
      const wantF = !(o.caps && o.caps.front === false), wantB = !(o.caps && o.caps.back === false);
      const tri = G.triangulate(capLoops[0], capLoops.slice(1));
      const flat = [].concat(...capLoops), k = uvK(o, x1 - x0, y1 - y0);
      const mk = (z, nz) => { const b = B.n; for (const p of flat) B.v(p[0], p[1], z, 0, 0, nz, (p[0] - x0) * k.ku, (p[1] - y0) * k.kv); return b; };
      if (wantF) { const b = mk(z1, 1); for (let i = 0; i < tri.length; i += 3) B.tri(b + tri[i], b + tri[i + 1], b + tri[i + 2]); }
      if (wantB) { const b = mk(z0, -1); for (let i = 0; i < tri.length; i += 3) B.tri(b + tri[i], b + tri[i + 2], b + tri[i + 1]); }
    }
    return finish(B.build(), o);
  };

  // ================================================================== curves
  const dimOf = pts => pts[0].length;
  const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return sqrt(s); };

  // catmullRom(points, {closed:false, segments:12 (samples per span), alpha:0.5 (0 uniform,0.5 centripetal,1 chordal), tension:0..1})
  // 2D or 3D points. Interpolates every input point. Closed curves do not repeat the first point.
  G.catmullRom = function (pts, o) {
    o = o || {}; const n = pts.length, dim = dimOf(pts), closed = !!o.closed, segs = max(1, (o.segments == null ? 12 : o.segments) | 0);
    const alpha = o.alpha == null ? 0.5 : o.alpha, ten = o.tension || 0, out = [];
    if (n < 2) return pts.map(p => p.slice());
    const P = i => {
      if (closed) return pts[((i % n) + n) % n];
      if (i < 0) { const a = pts[0], b = pts[1]; return a.map((v, k) => 2 * v - b[k]); }
      if (i >= n) { const a = pts[n - 1], b = pts[n - 2]; return a.map((v, k) => 2 * v - b[k]); }
      return pts[i];
    };
    const spans = closed ? n : n - 1;
    for (let s = 0; s < spans; s++) {
      const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2);
      const kn = (a, b) => max(Math.pow(dist(a, b), alpha), 1e-6);
      const t1 = kn(p0, p1), t2 = t1 + kn(p1, p2), t3 = t2 + kn(p2, p3), t0 = 0, dt = t2 - t1;
      const m1 = [], m2 = [];
      for (let k = 0; k < dim; k++) {
        m1.push(dt * ((p1[k] - p0[k]) / (t1 - t0) - (p2[k] - p0[k]) / (t2 - t0) + (p2[k] - p1[k]) / dt) * (1 - ten));
        m2.push(dt * ((p2[k] - p1[k]) / dt - (p3[k] - p1[k]) / (t3 - t1) + (p3[k] - p2[k]) / (t3 - t2)) * (1 - ten));
      }
      const last = !closed && s === spans - 1 ? segs : segs - 1;
      for (let j = 0; j <= last; j++) {
        const u = j / segs, u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2, q = [];
        for (let k = 0; k < dim; k++) q.push(h00 * p1[k] + h10 * m1[k] + h01 * p2[k] + h11 * m2[k]);
        out.push(q);
      }
    }
    return out;
  };
  G.bezier = function (p0, p1, p2, p3, n) {
    n = max(1, (n || 16) | 0); const out = [], dim = p0.length;
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t, q = []; for (let k = 0; k < dim; k++) q.push(u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]); out.push(q); }
    return out;
  };
  G.quadBezier = function (p0, p1, p2, n) {
    n = max(1, (n || 16) | 0); const out = [], dim = p0.length;
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t, q = []; for (let k = 0; k < dim; k++) q.push(u * u * p0[k] + 2 * u * t * p1[k] + t * t * p2[k]); out.push(q); }
    return out;
  };
  // bezierPath([p0,c0,c1,p1,c2,c3,p2,...], samplesPerSegment) chained cubic segments
  G.bezierPath = function (ctrl, n) {
    const out = [];
    for (let i = 0; i + 3 < ctrl.length; i += 3) { const seg = G.bezier(ctrl[i], ctrl[i + 1], ctrl[i + 2], ctrl[i + 3], n); if (i) seg.shift(); for (const p of seg) out.push(p); }
    return out;
  };
  G.arc = (cx, cy, r, a0, a1, n) => shapes.arc(r, a0, a1, n || 16, cx, cy);
  G.pathLength = function (pts, closed) { let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += dist(pts[i], pts[i + 1]); if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0]); return L; };
  // resample(pts, n | {spacing}, {closed}) -> points equally spaced in arc length (closed: no repeated first point)
  G.resample = function (pts, n, o) {
    o = o || {}; const closed = !!o.closed, m = pts.length, dim = dimOf(pts), P = closed ? pts.concat([pts[0]]) : pts, cum = [0];
    for (let i = 0; i + 1 < P.length; i++) cum.push(cum[i] + dist(P[i], P[i + 1]));
    const L = cum[cum.length - 1];
    if (n && typeof n === 'object') n = max(2, Math.round(L / n.spacing) + (closed ? 0 : 1));
    const out = []; let seg = 0;
    for (let i = 0; i < n; i++) {
      const s = closed ? i / n * L : (n === 1 ? 0 : i / (n - 1) * L);
      while (seg < P.length - 2 && cum[seg + 1] < s) seg++;
      const l = cum[seg + 1] - cum[seg], t = l > 1e-15 ? clamp((s - cum[seg]) / l, 0, 1) : 0, q = [];
      for (let k = 0; k < dim; k++) q.push(P[seg][k] + (P[seg + 1][k] - P[seg][k]) * t);
      out.push(q);
    }
    void m; return out;
  };
  // pathAt(pts, s, closed) -> point at arc distance s (clamped for open paths, wrapped for closed)
  G.pathAt = function (pts, s, closed) {
    const P = closed ? pts.concat([pts[0]]) : pts, dim = dimOf(pts); let L = 0; const cum = [0];
    for (let i = 0; i + 1 < P.length; i++) { L += dist(P[i], P[i + 1]); cum.push(L); }
    s = closed ? ((s % L) + L) % L : clamp(s, 0, L);
    let seg = 0; while (seg < P.length - 2 && cum[seg + 1] < s) seg++;
    const l = cum[seg + 1] - cum[seg], t = l > 1e-15 ? (s - cum[seg]) / l : 0, q = [];
    for (let k = 0; k < dim; k++) q.push(P[seg][k] + (P[seg + 1][k] - P[seg][k]) * t);
    return q;
  };
  // Chaikin corner cutting. Open curves keep their end points.
  G.subdivide = function (pts, iter, closed) {
    let P = pts;
    for (let it = 0; it < (iter == null ? 1 : iter); it++) {
      const n = P.length, out = [], dim = dimOf(P), q = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
      if (!closed) out.push(P[0].slice());
      for (let i = 0; i < (closed ? n : n - 1); i++) { const a = P[i], b = P[(i + 1) % n]; out.push(q(a, b, 0.25), q(a, b, 0.75)); }
      if (!closed) out.push(P[n - 1].slice()); void dim; P = out;
    }
    return P;
  };

  // ================================================================== NACA airfoils
  // naca4(chord=1, m=0.02 (max camber, fraction of chord), p=0.4 (camber position), t=0.12 (thickness), points=48 (per surface),
  //       {closedTE:false, teThickness:0 (extra blunt trailing edge as fraction of chord)}) -> CCW polygon [[x,y],...] LE at x=0, TE at x=chord.
  // Starts at the upper trailing edge, runs forward over the top, round the leading edge and back along the bottom.
  G.naca4 = function (chord, m, p, t, points, o) {
    o = o || {}; chord = chord == null ? 1 : chord; m = m == null ? 0.02 : m; p = p == null ? 0.4 : p; t = t == null ? 0.12 : t; const n = max(8, (points || 48) | 0);
    const c4 = o.closedTE ? 0.1036 : 0.1015, te = (o.teThickness || 0) / 2, U = [], Lw = [];
    for (let i = 0; i < n; i++) {
      const x = 0.5 * (1 - cos(PI * i / (n - 1)));
      let yt = 5 * t * (0.2969 * sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - c4 * x * x * x * x) + x * te;
      let yc = 0, dyc = 0;
      if (m > 0 && p > 0 && p < 1) {
        if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dyc = 2 * m / (p * p) * (p - x); } else { yc = m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * x - x * x); dyc = 2 * m / ((1 - p) * (1 - p)) * (p - x); }
      }
      const th = Math.atan(dyc), s = sin(th), c = cos(th);
      U.push([(x - yt * s) * chord, (yc + yt * c) * chord]); Lw.push([(x + yt * s) * chord, (yc - yt * c) * chord]);
    }
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(U[i]);
    for (let i = 1; i < n; i++) out.push(Lw[i]);
    // drop coincident trailing edge duplicate
    const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7 * chord) out.pop();
    return out;
  };
  // thick (blunt) trailing-edge variant: naca4Thick(chord, m, p, t, points, teThickness) — teThickness as a fraction of chord (e.g. 0.02)
  G.naca4Thick = (chord, m, p, t, points, te) => G.naca4(chord, m, p, t, points, { teThickness: te == null ? 0.02 : te });
  // naca('2412', chord, points, opts) parses a 4-digit code
  G.naca = function (code, chord, points, o) {
    code = String(code); const m = +code[0] / 100, p = +code[1] / 10, t = +code.slice(2) / 100;
    return G.naca4(chord, m, p || 0.4, t, points, o);
  };

  // ================================================================== loft / sweep / tube
  function ringsOf(sections) {
    return sections.map(s => {
      if (typeof s[0] === 'number') { const r = []; for (let i = 0; i + 2 < s.length; i += 3) r.push([s[i], s[i + 1], s[i + 2]]); return r; }
      return s;
    });
  }
  function newell(ring) {
    let x = 0, y = 0, z = 0; const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return [x, y, z];
  }
  const centroid = ring => { let x = 0, y = 0, z = 0; for (const p of ring) { x += p[0]; y += p[1]; z += p[2]; } const n = ring.length; return [x / n, y / n, z / n]; };
  function capMesh(ring, outward, o) {
    const nw = newell(ring), l = Math.hypot(nw[0], nw[1], nw[2]);
    if (l < 1e-14) return null;
    let n = [nw[0] / l, nw[1] / l, nw[2] / l];
    const ax = abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let U = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]]; const ul = Math.hypot(U[0], U[1], U[2]); U = U.map(v => v / ul);
    const V = [n[1] * U[2] - n[2] * U[1], n[2] * U[0] - n[0] * U[2], n[0] * U[1] - n[1] * U[0]];
    const c = centroid(ring), pts2 = ring.map(p => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [d[0] * U[0] + d[1] * U[1] + d[2] * U[2], d[0] * V[0] + d[1] * V[1] + d[2] * V[2]]; });
    const tri = G.triangulate(pts2), sgn = (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2]) >= 0 ? 1 : -1;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of pts2) { u0 = min(u0, q[0]); u1 = max(u1, q[0]); v0 = min(v0, q[1]); v1 = max(v1, q[1]); }
    const k = uvK(o, u1 - u0, v1 - v0), B = new MB(ring.length);
    for (let i = 0; i < ring.length; i++) B.v(ring[i][0], ring[i][1], ring[i][2], n[0] * sgn, n[1] * sgn, n[2] * sgn, (pts2[i][0] - u0) * k.ku, (pts2[i][1] - v0) * k.kv);
    for (let i = 0; i < tri.length; i += 3) { if (sgn > 0) B.tri(tri[i], tri[i + 1], tri[i + 2]); else B.tri(tri[i], tri[i + 2], tri[i + 1]); }
    return B.build();
  }
  // loft(sections, {closed:false, closedV:false, caps:true (closed only), crease:40, orient:'auto'|'keep', flip, uv})
  // sections: array of rings with equal point count ([[x,y,z],...] or flat xyz arrays). Point index runs along u, section index along v.
  // Winding: normal = dP/du x dP/dv. orient:'auto' (default) corrects closed sections so normals face outward (uses first section vs. stack direction).
  G.loft = function (sections, o) {
    o = o || {}; const R = ringsOf(sections), S = R.length, M = R[0].length, closed = !!o.closed, closedV = !!o.closedV;
    if (S < 2 || M < 2) return { positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) };
    const cols = closed ? M + 1 : M, rows = closedV ? S + 1 : S;
    // stack direction & orientation
    const c0 = centroid(R[0]), c1 = centroid(R[1]), dStart = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    let flipSide = !!o.flip;
    if (closed && o.orient !== 'keep') { const nw = newell(R[0]); if (nw[0] * dStart[0] + nw[1] * dStart[1] + nw[2] * dStart[2] < 0) flipSide = !flipSide; }
    // v lengths along centroid path
    const vcum = [0]; let prevC = c0;
    for (let r = 1; r < rows; r++) { const c = centroid(R[r % S]); vcum.push(vcum[r - 1] + Math.hypot(c[0] - prevC[0], c[1] - prevC[1], c[2] - prevC[2])); prevC = c; }
    // u = normalised arc position along each ring times the mean ring perimeter (no shear when ring sizes change along the stack)
    const perim = [], cumU = []; let ulen = 0;
    for (let r = 0; r < S; r++) {
      const ring = R[r], cu = [0]; let L = 0;
      for (let c = 1; c < cols; c++) { const p = ring[c % M], q = ring[(c - 1) % M]; L += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); cu.push(L); }
      perim.push(L); cumU.push(cu); ulen += L / S;
    }
    const k = uvK(o, ulen, vcum[rows - 1]), B = new MB(rows * cols);
    for (let r = 0; r < rows; r++) {
      const ring = R[r % S], cu = cumU[r % S], pl = perim[r % S] > 1e-12 ? ulen / perim[r % S] : 0;
      for (let c = 0; c < cols; c++) { const p = ring[c % M]; B.v(p[0], p[1], p[2], 0, 0, 0, cu[c] * pl * k.ku, vcum[r] * k.kv); }
    }
    const P = B.p, degen = (a, b) => { const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz < 1e-20; };
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols + 1, d = a + cols;
      const t = (x, y, z) => { if (degen(x, y) || degen(y, z) || degen(x, z)) return; if (flipSide) B.tri(x, z, y); else B.tri(x, y, z); };
      t(a, b, cc); t(a, cc, d);
    }
    let mesh = G.computeNormals(B.build(), o.crease == null ? 40 : o.crease);
    if (closed && !closedV && o.caps !== false) {
      const parts = [mesh], cN = centroid(R[S - 1]), cP = centroid(R[S - 2]);
      const cs = capMesh(R[0], [-dStart[0], -dStart[1], -dStart[2]], o), ce = capMesh(R[S - 1], [cN[0] - cP[0], cN[1] - cP[1], cN[2] - cP[2]], o);
      if (cs) parts.push(cs); if (ce) parts.push(ce);
      mesh = G.merge(parts);
    }
    return mesh;
  };

  // ---------------------------------------------------------------- path frames (parallel transport)
  // pathFrames(path, {closed, up, frames:'transport'|'up'}) -> {T:[..],N:[..],B:[..],t:[arc-length fraction per point],length}
  G.pathFrames = function (path, o) {
    o = o || {}; const n = path.length, closed = !!o.closed, T = [], N = [], B = [];
    const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-14 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let i = 0; i < n; i++) {
      const a = closed ? path[(i + n - 1) % n] : path[max(i - 1, 0)], b = closed ? path[(i + 1) % n] : path[min(i + 1, n - 1)];
      let t = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]); if (!t) t = T[i - 1] || [1, 0, 0]; T.push(t);
    }
    const perp = (t, up) => { let v = [up[0] - t[0] * dot(up, t), up[1] - t[1] * dot(up, t), up[2] - t[2] * dot(up, t)]; let r = nrm(v); if (!r) { const ax = abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; v = cross(ax, t); r = nrm(v); } return r; };
    const fixed = o.frames === 'up' && o.up;
    const rot = (v, k, ang) => { const c = cos(ang), s = sin(ang), kd = dot(k, v), kc = cross(k, v); return [v[0] * c + kc[0] * s + k[0] * kd * (1 - c), v[1] * c + kc[1] * s + k[1] * kd * (1 - c), v[2] * c + kc[2] * s + k[2] * kd * (1 - c)]; };
    const transport = (nv, t0, t1) => { const ax = cross(t0, t1), l = Math.hypot(ax[0], ax[1], ax[2]); if (l < 1e-12) return nv; const ang = Math.acos(clamp(dot(t0, t1), -1, 1)); return perp(t1, rot(nv, [ax[0] / l, ax[1] / l, ax[2] / l], ang)); };
    N.push(perp(T[0], o.up || (abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])));
    for (let i = 1; i < n; i++) N.push(fixed ? perp(T[i], o.up) : transport(N[i - 1], T[i - 1], T[i]));
    if (fixed) N[0] = perp(T[0], o.up);
    if (closed && !fixed && n > 2) {
      const e = transport(N[n - 1], T[n - 1], T[0]);
      const phi = atan2(dot(cross(e, N[0]), T[0]), dot(e, N[0]));
      for (let i = 1; i < n; i++) N[i] = rot(N[i], T[i], phi * i / n);
    }
    for (let i = 0; i < n; i++) B.push(cross(T[i], N[i]));
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + dist(path[i], path[i - 1]));
    const total = cum[n - 1] + (closed ? dist(path[n - 1], path[0]) : 0), tt = cum.map(c => total > 0 ? c / total : 0);
    return { T, N, B, t: tt, length: total };
  };

  // per-point spec: value | fn(t,i) | array with one entry per path point (a 2-number array is a fixed [sx,sy] pair)
  function evalPerPoint(spec, t, i, n, dflt) {
    if (spec == null) return dflt;
    if (typeof spec === 'function') return spec(t, i);
    if (Array.isArray(spec)) {
      if (spec.length === n && n !== 2) return spec[i];
      if (spec.length === 2 && typeof spec[0] === 'number' && typeof spec[1] === 'number') return spec;
      return spec[min(i, spec.length - 1)];
    }
    return spec;
  }
  // rings of a swept profile. Returns { rings, frames }
  function sweepRings(profile, path, o) {
    const fr = G.pathFrames(path, o), n = path.length, rings = [];
    for (let i = 0; i < n; i++) {
      const t = fr.t[i]; let s = evalPerPoint(o.scale, t, i, n, 1); let sx, sy; if (Array.isArray(s)) { sx = s[0]; sy = s[1]; } else sx = sy = s;
      let tw = o.twist == null ? 0 : (typeof o.twist === 'function' ? o.twist(t, i) : (Array.isArray(o.twist) ? o.twist[i] : o.twist * t));
      const ca = cos(tw), sa = sin(tw), N = fr.N[i], Bv = fr.B[i], p = path[i], ring = [];
      for (const q of profile) {
        const px = (q[0] * ca - q[1] * sa) * sx, py = (q[0] * sa + q[1] * ca) * sy;
        ring.push([p[0] + N[0] * px + Bv[0] * py, p[1] + N[1] * px + Bv[1] * py, p[2] + N[2] * px + Bv[2] * py]);
      }
      rings.push(ring);
    }
    return { rings, frames: fr };
  }
  function prepProfile(profile, o) {
    let pr = profile.map(p => [p[0], p[1]]); let closedP = o.closedProfile !== false;
    const a = pr[0], b = pr[pr.length - 1];
    if (pr.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) { pr.pop(); if (o.closedProfile === false) { pr.push([a[0], a[1]]); } }
    return { pr, closedP };
  }
  // sweep(profile2D, path3D, {closed, closedProfile:true, scale, twist, up, frames, caps, crease, flip, uv})
  // profile coords are (x along frame normal N, y along binormal B). scale: number | [sx,sy] | fn(t,i) | per-point array; twist: total radians | fn(t,i) | array.
  G.sweep = function (profile, path, o) {
    o = o || {}; const { pr, closedP } = prepProfile(profile, o), sr = sweepRings(pr, path, o);
    return G.loft(sr.rings, { closed: closedP, closedV: !!o.closed, caps: o.caps, crease: o.crease, flip: o.flip, orient: o.orient, uv: o.uv, uvScale: o.uvScale });
  };
  // tube(path, radius | fn(t,i) | per-point array, {radialSegments:12, closed, caps:'flat'|'round'|false|true, capSegments:4, up, frames, crease})
  G.tube = function (path, radius, o) {
    o = o || {}; const rs = max(3, (o.radialSegments || 12) | 0), circ = shapes.circle(1, rs);
    const scale = typeof radius === 'number' ? radius : (typeof radius === 'function' ? radius : (t, i) => radius[min(i, radius.length - 1)]);
    const oo = Object.assign({}, o, { scale });
    const sr = sweepRings(circ, path, oo), rings = sr.rings, n = path.length, fr = sr.frames;
    const rad = i => typeof scale === 'function' ? scale(fr.t[i], i) : scale;
    let caps = o.caps == null ? 'flat' : o.caps; if (caps === true) caps = 'flat';
    if (caps === 'round' && !o.closed) {
      const cs = max(2, (o.capSegments || 4) | 0), pre = [], post = [];
      for (let k = 1; k <= cs; k++) {
        const a = k / cs * PI / 2;
        for (const [idx, list, sgn] of [[0, pre, -1], [n - 1, post, 1]]) {
          const r0 = rad(idx), T = fr.T[idx], c = path[idx], off = sgn * r0 * sin(a), f = k === cs ? 0 : cos(a), ring = [];
          for (let j = 0; j < circ.length; j++) {
            const q = rings[idx][j];
            ring.push([c[0] + T[0] * off + (q[0] - c[0]) * f, c[1] + T[1] * off + (q[1] - c[1]) * f, c[2] + T[2] * off + (q[2] - c[2]) * f]);
          }
          list.push(ring);
        }
      }
      const all = pre.reverse().concat(rings, post);
      return G.loft(all, { closed: true, caps: false, crease: o.crease == null ? 60 : o.crease, flip: o.flip, uv: o.uv, uvScale: o.uvScale });
    }
    return G.loft(rings, { closed: true, closedV: !!o.closed, caps: caps !== false, crease: o.crease == null ? 60 : o.crease, flip: o.flip, uv: o.uv, uvScale: o.uvScale });
  };

  // ---------------------------------------------------------------- wing extrusion
  // extrudeAirfoil(profile, span, {taper:1, sweepDeg|sweepDist, twistDeg (tip, +nose up), twistPivot:0.25, dihedralDeg|dihedralDist, segments:8,
  //                                caps:true, center:false, mirror:false, tipProfile})
  // profile: closed 2D airfoil (LE at x=0, chord along +X, thickness +Y). The wing spans +Z (0..span); with mirror:true it spans -span..+span
  // (root at z=0, symmetric taper/sweep/twist/dihedral); with center:true it spans -span/2..span/2 (root at -span/2... left end).
  G.extrudeAirfoil = function (profile, span, o) {
    o = o || {}; const segs = max(1, (o.segments || 8) | 0), taper = o.taper == null ? 1 : o.taper, pv = o.twistPivot == null ? 0.25 : o.twistPivot;
    let xmin = Infinity, xmax = -Infinity; for (const p of profile) { xmin = min(xmin, p[0]); xmax = max(xmax, p[0]); }
    const chord = xmax - xmin, tip = o.tipProfile || profile;
    const sweepD = o.sweepDist != null ? o.sweepDist : (o.sweepDeg ? tan(o.sweepDeg * DEG) * span : 0);
    const dihD = o.dihedralDist != null ? o.dihedralDist : (o.dihedralDeg ? tan(o.dihedralDeg * DEG) * span : 0);
    const twist = -(o.twistDeg || 0) * DEG;
    const zs = [];
    if (o.mirror) for (let j = -segs; j <= segs; j++) zs.push([span * j / segs, abs(j) / segs]);
    else if (o.center) for (let j = 0; j <= segs; j++) zs.push([-span / 2 + span * j / segs, j / segs]);
    else for (let j = 0; j <= segs; j++) zs.push([span * j / segs, j / segs]);
    const rings = [];
    for (const [z, t] of zs) {
      const s = 1 + (taper - 1) * t, a = twist * t, ca = cos(a), sa = sin(a), px = (xmin + pv * chord) * s, ring = [];
      for (let i = 0; i < profile.length; i++) {
        let x = profile[i][0] + (tip[i][0] - profile[i][0]) * t, y = profile[i][1] + (tip[i][1] - profile[i][1]) * t;
        x *= s; y *= s; const dx = x - px, dy = y;
        ring.push([px + dx * ca - dy * sa + sweepD * t, dx * sa + dy * ca + dihD * t, z]);
      }
      rings.push(ring);
    }
    return G.loft(rings, { closed: true, caps: o.caps, crease: o.crease == null ? 40 : o.crease, flip: o.flip, uv: o.uv, uvScale: o.uvScale });
  };

  // ================================================================== raycaster (LBVH)
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function expandBits(v) {
    v = Math.imul(v, 0x00010001) & 0xFF0000FF; v = Math.imul(v, 0x00000101) & 0x0F00F00F;
    v = Math.imul(v, 0x00000011) & 0xC30C30C3; v = Math.imul(v, 0x00000005) & 0x49249249; return v;
  }
  function closestOnTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { out[0] = 1; out[1] = 0; out[2] = 0; return; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { out[0] = 0; out[1] = 1; out[2] = 0; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = 1 - v; out[1] = v; out[2] = 0; return; }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { out[0] = 0; out[1] = 0; out[2] = 1; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = 1 - w; out[1] = 0; out[2] = w; return; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = 0; out[1] = 1 - w; out[2] = w; return; }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; out[0] = 1 - v - w; out[1] = v; out[2] = w;
  }

  // raycaster(mesh, {leafSize:4}) -> see header. Works in the mesh's own space. Build cost is dominated by a radix sort of Morton codes.
  G.raycaster = function (mesh, opts) {
    opts = opts || {}; const t0 = nowMs();
    const P = mesh.positions, I = idxOf(mesh), N = mesh.normals, UV = mesh.uvs, nt = (I.length / 3) | 0, leaf = max(1, (opts.leafSize || 4) | 0);
    // ---- Morton codes of triangle centroids
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    const cen = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      cen[t * 3] = x; cen[t * 3 + 1] = y; cen[t * 3 + 2] = z;
      if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; if (z < cz0) cz0 = z; if (z > cz1) cz1 = z;
    }
    const ix = 1023 / max(cx1 - cx0, 1e-20), iy = 1023 / max(cy1 - cy0, 1e-20), iz = 1023 / max(cz1 - cz0, 1e-20);
    let kA = new Uint32Array(nt), vA = new Uint32Array(nt), kB = new Uint32Array(nt), vB = new Uint32Array(nt);
    for (let t = 0; t < nt; t++) {
      const qx = min(1023, ((cen[t * 3] - cx0) * ix) | 0), qy = min(1023, ((cen[t * 3 + 1] - cy0) * iy) | 0), qz = min(1023, ((cen[t * 3 + 2] - cz0) * iz) | 0);
      kA[t] = ((expandBits(qx) << 2) | (expandBits(qy) << 1) | expandBits(qz)) >>> 0; vA[t] = t;
    }
    const cnt = new Uint32Array(1024);
    for (let pass = 0; pass < 3; pass++) {
      const sh = pass * 10; cnt.fill(0);
      for (let i = 0; i < nt; i++) cnt[(kA[i] >>> sh) & 1023]++;
      let s = 0; for (let i = 0; i < 1024; i++) { const c = cnt[i]; cnt[i] = s; s += c; }
      for (let i = 0; i < nt; i++) { const d = cnt[(kA[i] >>> sh) & 1023]++; kB[d] = kA[i]; vB[d] = vA[i]; }
      let tk = kA; kA = kB; kB = tk; tk = vA; vA = vB; vB = tk;
    }
    const codes = kA, order = vA;
    // ---- triangles in sorted order (cache friendly)
    const tv = new Float32Array(nt * 9);
    for (let k = 0; k < nt; k++) {
      const t = order[k];
      for (let j = 0; j < 3; j++) { const v = I[t * 3 + j] * 3; tv[k * 9 + j * 3] = P[v]; tv[k * 9 + j * 3 + 1] = P[v + 1]; tv[k * 9 + j * 3 + 2] = P[v + 2]; }
    }
    // ---- hierarchy (preorder allocation => children have larger indices than their parent)
    let cap = max(64, Math.ceil(nt * 4 / leaf) + 64), nb = new Float32Array(cap * 6), nl = new Int32Array(cap), nr = new Int32Array(cap), nc = new Int32Array(cap);
    let count = 0, maxDepth = 0;
    const grow = () => {
      const c = Math.ceil(cap * 1.6), b2 = new Float32Array(c * 6); b2.set(nb); nb = b2;
      const l2 = new Int32Array(c); l2.set(nl); nl = l2; const r2 = new Int32Array(c); r2.set(nr); nr = r2; const c2 = new Int32Array(c); c2.set(nc); nc = c2; cap = c;
    };
    if (nt > 0) {
      const stk = new Int32Array(4 * 256); let sp = 0;
      count = 1; stk[sp++] = 0; stk[sp++] = nt; stk[sp++] = 0; stk[sp++] = 0;
      while (sp) {
        const depth = stk[--sp], ni = stk[--sp], hi = stk[--sp], lo = stk[--sp];
        if (depth > maxDepth) maxDepth = depth;
        if (hi - lo <= leaf) { nl[ni] = lo; nc[ni] = hi - lo; continue; }
        let mid;
        const first = codes[lo], last = codes[hi - 1];
        if (first === last) mid = (lo + hi) >> 1;
        else {
          const hb = 31 - Math.clz32(first ^ last); let a = lo, b = hi - 1;
          while (a < b) { const m = (a + b) >> 1; if ((codes[m] >>> hb) & 1) b = m; else a = m + 1; }
          mid = a;
        }
        if (count + 2 > cap) grow();
        const L = count++, R = count++; nl[ni] = L; nr[ni] = R; nc[ni] = 0;
        stk[sp++] = mid; stk[sp++] = hi; stk[sp++] = R; stk[sp++] = depth + 1;
        stk[sp++] = lo; stk[sp++] = mid; stk[sp++] = L; stk[sp++] = depth + 1;
      }
      for (let i = count - 1; i >= 0; i--) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        if (nc[i] > 0) {
          const s = nl[i], e = s + nc[i];
          for (let k = s * 3; k < e * 3; k++) {
            const x = tv[k * 3], y = tv[k * 3 + 1], z = tv[k * 3 + 2];
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
          }
        } else {
          const a = nl[i] * 6, b = nr[i] * 6;
          x0 = min(nb[a], nb[b]); y0 = min(nb[a + 1], nb[b + 1]); z0 = min(nb[a + 2], nb[b + 2]);
          x1 = max(nb[a + 3], nb[b + 3]); y1 = max(nb[a + 4], nb[b + 4]); z1 = max(nb[a + 5], nb[b + 5]);
        }
        nb[i * 6] = x0; nb[i * 6 + 1] = y0; nb[i * 6 + 2] = z0; nb[i * 6 + 3] = x1; nb[i * 6 + 4] = y1; nb[i * 6 + 5] = z1;
      }
    }
    const meshBounds = nt ? { min: [nb[0], nb[1], nb[2]], max: [nb[3], nb[4], nb[5]] } : { min: [0, 0, 0], max: [0, 0, 0] };
    const diag = Math.hypot(meshBounds.max[0] - meshBounds.min[0], meshBounds.max[1] - meshBounds.min[1], meshBounds.max[2] - meshBounds.min[2]);
    const stack = new Int32Array(256), EPS = 1e-7;

    // slab test, returns entry distance (>= tMin clamp) or Infinity on miss
    function slab(ni, ox, oy, oz, ix_, iy_, iz_, tMin, tMax) {
      const b = ni * 6;
      let t1 = (nb[b] - ox) * ix_, t2 = (nb[b + 3] - ox) * ix_, tn = t1 < t2 ? t1 : t2, tf = t1 < t2 ? t2 : t1;
      t1 = (nb[b + 1] - oy) * iy_; t2 = (nb[b + 4] - oy) * iy_; let a = t1 < t2 ? t1 : t2, f = t1 < t2 ? t2 : t1; if (a > tn) tn = a; if (f < tf) tf = f;
      t1 = (nb[b + 2] - oz) * iz_; t2 = (nb[b + 5] - oz) * iz_; a = t1 < t2 ? t1 : t2; f = t1 < t2 ? t2 : t1; if (a > tn) tn = a; if (f < tf) tf = f;
      if (tn > tf * (1 + 1e-9) + 1e-12 || tf < tMin || tn > tMax) return Infinity;
      return tn < tMin ? tMin : tn;
    }
    const hit = { t: 0, tri: -1, u: 0, v: 0, det: 0 };
    // returns via `hit`; mode 0 = closest, mode 1 = collect all into `list`
    function trace(o, d, tMin, tMax, cull, list) {
      const ox = o[0], oy = o[1], oz = o[2];
      let dx = d[0], dy = d[1], dz = d[2]; const dl = Math.hypot(dx, dy, dz); if (!(dl > 0) || nt === 0) return false;
      dx /= dl; dy /= dl; dz /= dl;
      const ix_ = 1 / (dx === 0 ? 1e-30 : dx), iy_ = 1 / (dy === 0 ? 1e-30 : dy), iz_ = 1 / (dz === 0 ? 1e-30 : dz);
      let best = tMax, bestK = -1, bu = 0, bv = 0, bdet = 0, sp = 0;
      if (slab(0, ox, oy, oz, ix_, iy_, iz_, tMin, best) === Infinity) return false;
      stack[sp++] = 0;
      while (sp) {
        const ni = stack[--sp];
        if (nc[ni] > 0) {
          const s = nl[ni], e = s + nc[ni];
          for (let k = s; k < e; k++) {
            const q = k * 9, v0x = tv[q], v0y = tv[q + 1], v0z = tv[q + 2];
            const e1x = tv[q + 3] - v0x, e1y = tv[q + 4] - v0y, e1z = tv[q + 5] - v0z, e2x = tv[q + 6] - v0x, e2y = tv[q + 7] - v0y, e2z = tv[q + 8] - v0z;
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
            if (cull ? det <= 1e-20 : (det < 1e-20 && det > -1e-20)) continue;
            const inv = 1 / det, tx = ox - v0x, ty = oy - v0y, tz = oz - v0z, u = (tx * px + ty * py + tz * pz) * inv;
            if (u < -EPS || u > 1 + EPS) continue;
            const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
            if (v < -EPS || u + v > 1 + EPS) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (t < tMin || t > (list ? tMax : best)) continue;
            if (list) list.push({ k, t, u, v, det });
            else if (t < best) { best = t; bestK = k; bu = u; bv = v; bdet = det; }
          }
        } else {
          const a = nl[ni], b = nr[ni], lim = list ? tMax : best;
          const ta = slab(a, ox, oy, oz, ix_, iy_, iz_, tMin, lim), tb = slab(b, ox, oy, oz, ix_, iy_, iz_, tMin, lim);
          if (ta !== Infinity && tb !== Infinity) { if (ta <= tb) { stack[sp++] = b; stack[sp++] = a; } else { stack[sp++] = a; stack[sp++] = b; } }
          else if (ta !== Infinity) stack[sp++] = a; else if (tb !== Infinity) stack[sp++] = b;
        }
      }
      if (list) return list.length > 0;
      if (bestK < 0) return false;
      hit.t = best; hit.tri = bestK; hit.u = bu; hit.v = bv; hit.det = bdet; return true;
    }
    function makeHit(o, dl, k, t, u, v, det) {
      const q = k * 9, face = order[k], w = 1 - u - v;
      const e1x = tv[q + 3] - tv[q], e1y = tv[q + 4] - tv[q + 1], e1z = tv[q + 5] - tv[q + 2], e2x = tv[q + 6] - tv[q], e2y = tv[q + 7] - tv[q + 1], e2z = tv[q + 8] - tv[q + 2];
      let fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      const ia = I[face * 3], ib = I[face * 3 + 1], ic = I[face * 3 + 2];
      let nx = fx, ny = fy, nz = fz;
      if (N) {
        nx = N[ia * 3] * w + N[ib * 3] * u + N[ic * 3] * v; ny = N[ia * 3 + 1] * w + N[ib * 3 + 1] * u + N[ic * 3 + 1] * v; nz = N[ia * 3 + 2] * w + N[ib * 3 + 2] * u + N[ic * 3 + 2] * v;
        const l = Math.hypot(nx, ny, nz); if (l > 1e-12) { nx /= l; ny /= l; nz /= l; } else { nx = fx; ny = fy; nz = fz; }
      }
      const r = { t, point: [o.ox + o.dx * t, o.oy + o.dy * t, o.oz + o.dz * t], normal: [nx, ny, nz], faceNormal: [fx, fy, fz], faceIndex: face, front: det > 0, bary: [w, u, v] };
      if (UV) r.uv = [UV[ia * 2] * w + UV[ib * 2] * u + UV[ic * 2] * v, UV[ia * 2 + 1] * w + UV[ib * 2 + 1] * u + UV[ic * 2 + 1] * v];
      return r;
    }
    const prep = (origin, dir) => { const l = Math.hypot(dir[0], dir[1], dir[2]) || 1; return { ox: origin[0], oy: origin[1], oz: origin[2], dx: dir[0] / l, dy: dir[1] / l, dz: dir[2] / l }; };
    const rc = {
      triCount: nt, bounds: meshBounds,
      stats: { buildMs: 0, nodes: count, depth: maxDepth, leafSize: leaf },
      // cast(origin, dir, {tMin:0, tMax:Infinity, backfaces:true}) -> {t, point, normal (interpolated), faceNormal, faceIndex, uv, bary, front} | null
      cast(origin, dir, o) {
        o = o || {};
        if (!trace(origin, dir, o.tMin || 0, o.tMax == null ? Infinity : o.tMax, o.backfaces === false, null)) return null;
        return makeHit(prep(origin, dir), 0, hit.tri, hit.t, hit.u, hit.v, hit.det);
      },
      // castAll(origin, dir, opts) -> hits sorted by distance (coincident edge hits are merged)
      castAll(origin, dir, o) {
        o = o || {}; const list = [], pr = prep(origin, dir);
        if (!trace(origin, dir, o.tMin || 0, o.tMax == null ? Infinity : o.tMax, o.backfaces === false, list)) return [];
        list.sort((a, b) => a.t - b.t);
        const out = [], eps = diag * 1e-7 + 1e-9;
        for (const h of list) { const last = out[out.length - 1]; if (last && h.t - last.t < eps && (h.det > 0) === last.front) continue; out.push(makeHit(pr, 0, h.k, h.t, h.u, h.v, h.det)); }
        return out;
      },
      // true when the point lies inside a closed mesh (ray parity along +X)
      inside(p) { const h = rc.castAll(p, [1, 0.0001, 0.00013]); return (h.length & 1) === 1; },
      // nearest(point, maxDist=Infinity) -> {point, distance, faceIndex, normal} | null
      nearest(p, maxDist) {
        if (!nt) return null;
        let bestD = (maxDist == null ? Infinity : maxDist); bestD = bestD * bestD; let bk = -1; const bary = [0, 0, 0], bb = [0, 0, 0], bp = [0, 0, 0];
        const boxD2 = ni => { const b = ni * 6; let d = 0, x;
          x = p[0] < nb[b] ? nb[b] - p[0] : p[0] > nb[b + 3] ? p[0] - nb[b + 3] : 0; d += x * x;
          x = p[1] < nb[b + 1] ? nb[b + 1] - p[1] : p[1] > nb[b + 4] ? p[1] - nb[b + 4] : 0; d += x * x;
          x = p[2] < nb[b + 2] ? nb[b + 2] - p[2] : p[2] > nb[b + 5] ? p[2] - nb[b + 5] : 0; d += x * x; return d; };
        let sp = 0; if (boxD2(0) > bestD) return null; stack[sp++] = 0;
        while (sp) {
          const ni = stack[--sp];
          if (boxD2(ni) > bestD) continue;
          if (nc[ni] > 0) {
            for (let k = nl[ni]; k < nl[ni] + nc[ni]; k++) {
              const q = k * 9; closestOnTri(p[0], p[1], p[2], tv[q], tv[q + 1], tv[q + 2], tv[q + 3], tv[q + 4], tv[q + 5], tv[q + 6], tv[q + 7], tv[q + 8], bary);
              const x = bary[0] * tv[q] + bary[1] * tv[q + 3] + bary[2] * tv[q + 6], y = bary[0] * tv[q + 1] + bary[1] * tv[q + 4] + bary[2] * tv[q + 7], z = bary[0] * tv[q + 2] + bary[1] * tv[q + 5] + bary[2] * tv[q + 8];
              const d2 = (x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]) + (z - p[2]) * (z - p[2]);
              if (d2 < bestD) { bestD = d2; bk = k; bb[0] = bary[0]; bb[1] = bary[1]; bb[2] = bary[2]; bp[0] = x; bp[1] = y; bp[2] = z; }
            }
          } else {
            const a = nl[ni], b = nr[ni]; if (boxD2(a) <= boxD2(b)) { stack[sp++] = b; stack[sp++] = a; } else { stack[sp++] = a; stack[sp++] = b; }
          }
        }
        if (bk < 0) return null;
        const face = order[bk], ia = I[face * 3], ib = I[face * 3 + 1], ic = I[face * 3 + 2]; let nx, ny, nz;
        if (N) { nx = N[ia * 3] * bb[0] + N[ib * 3] * bb[1] + N[ic * 3] * bb[2]; ny = N[ia * 3 + 1] * bb[0] + N[ib * 3 + 1] * bb[1] + N[ic * 3 + 1] * bb[2]; nz = N[ia * 3 + 2] * bb[0] + N[ib * 3 + 2] * bb[1] + N[ic * 3 + 2] * bb[2]; }
        else { const q = bk * 9, e1x = tv[q + 3] - tv[q], e1y = tv[q + 4] - tv[q + 1], e1z = tv[q + 5] - tv[q + 2], e2x = tv[q + 6] - tv[q], e2y = tv[q + 7] - tv[q + 1], e2z = tv[q + 8] - tv[q + 2]; nx = e1y * e2z - e1z * e2y; ny = e1z * e2x - e1x * e2z; nz = e1x * e2y - e1y * e2x; }
        const l = Math.hypot(nx, ny, nz) || 1;
        return { point: [bp[0], bp[1], bp[2]], distance: sqrt(bestD), faceIndex: face, normal: [nx / l, ny / l, nz / l] };
      },
      // heightAt(x, z, yStart = top of bounds + 1) -> y of the first surface hit going straight down (null if none)
      heightAt(x, z, yStart) {
        const y0 = yStart == null ? meshBounds.max[1] + 1 : yStart;
        return trace([x, y0, z], [0, -1, 0], 0, Infinity, false, null) ? y0 - hit.t : null;
      },
      // bottomAt(x, z, yStart = bottom of bounds - 1) -> y of the first surface hit going straight up
      bottomAt(x, z, yStart) {
        const y0 = yStart == null ? meshBounds.min[1] - 1 : yStart;
        return trace([x, y0, z], [0, 1, 0], 0, Infinity, false, null) ? y0 + hit.t : null;
      },
      // boundsOf() -> mesh bounds; boundsOf(faceIndex) -> bounds of one triangle
      boundsOf(face) {
        if (face == null) return meshBounds;
        const a = I[face * 3] * 3, b = I[face * 3 + 1] * 3, c = I[face * 3 + 2] * 3;
        return { min: [min(P[a], P[b], P[c]), min(P[a + 1], P[b + 1], P[c + 1]), min(P[a + 2], P[b + 2], P[c + 2])], max: [max(P[a], P[b], P[c]), max(P[a + 1], P[b + 1], P[c + 1]), max(P[a + 2], P[b + 2], P[c + 2])] };
      },
    };
    rc.stats.buildMs = nowMs() - t0;
    return rc;
  };
})();
