/* ============================================================================
 * rover.js  -  module 'rover': NASA Perseverance in its EDL configuration (1:1, metres).
 * Local frame: X forward, Y up, Z right, origin = chassis centre.
 * Everything is procedural (canvas textures + merged three.js geometry); no images, no fetch.
 *
 * Public API (see _work/notes/rover.md):
 *   api.group                         root Object3D (pose comes from flight.state(t).bodies.rover)
 *   api.setMobility(u)                0 = stowed (rocker-bogie folded up), 1 = deployed (wheels down)
 *   api.setSettle(u)                  0..1 suspension settling after touchdown (damped bounce)
 *   api.anchors.bridle[3], api.anchors.umbilical      (Vector3, rover local)
 *   api.mounts.ruc / api.mounts.rdc   {pos: Vector3, quat: Quaternion}  (THREE camera convention: looks along -Z)
 *   api.groundOffset                  distance origin -> wheel contact plane (deployed, settled); also written to EDL.C.rover.groundOffset
 * ========================================================================== */
(function () {
  'use strict';
  const THREE = window.THREE, EDL = window.EDL, C = EDL.C, U = EDL.util;
  const BGU = THREE.BufferGeometryUtils;
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, QT = THREE.Quaternion;
  const PI = Math.PI, TAU = Math.PI * 2;

  /* ---------------------------------------------------------------------------------------------
   * DIMENSIONS (rover local frame, metres)
   * ------------------------------------------------------------------------------------------- */
  const D = {
    x0: -1.15, x1: 1.15, hz: 0.63, y0: -0.36, y1: 0.34,      // warm electronics box (chassis body)
    wheelR: 0.2625, wheelW: 0.40,
    wheelX: [0.97, -0.20, -1.25],                            // front, middle, rear hub X
    wheelZ: 1.20,                                            // hub |Z|
    clearance: 0.66,                                         // belly -> ground
  };
  D.groundY = D.y0 - D.clearance;                            // -1.02 : wheel contact plane (u = 1, settled)
  D.hubY = D.groundY + D.wheelR;                             // -0.7575
  D.groundOffset = -D.groundY;
  C.rover.groundOffset = D.groundOffset;                     // must be set at factory/load time (flight reads it lazily)

  const TILES = { uhf: 0.5, paint: 1.0, greyPaint: 1.0, black: 0.6, alu: 0.6, gold: 0.4, copper: 0.3, foil: 0.4, rtg: 0.5, lens: 1, grille: 0.24, kapton: 0.4 };

  /* ---------------------------------------------------------------------------------------------
   * NOISE / CANVAS TOOLKIT
   * ------------------------------------------------------------------------------------------- */
  function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // periodic value noise on a gx x gy lattice -> Float32Array(w*h) in [0,1]
  function noiseRect(w, h, seed, gx, gy) {
    const rnd = U.rng(seed), lat = new Float32Array(gx * gy);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * gy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), ya = y0 % gy, yb = (y0 + 1) % gy;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * gx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), xa = x0 % gx, xb = (x0 + 1) % gx;
        const a = lat[ya * gx + xa], b = lat[ya * gx + xb], c = lat[yb * gx + xa], d = lat[yb * gx + xb];
        out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      }
    }
    return out;
  }
  function fbmRect(w, h, seed, oct, gx, gy, gain) {
    gain = gain || 0.5;
    const out = new Float32Array(w * h);
    let amp = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const n = noiseRect(w, h, seed + o * 31, gx << o, Math.max(1, gy << o));
      for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
      norm += amp; amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }
  // height canvas (gray, 128 = flat) -> tangent-space normal map canvas (GL convention, v up)
  function heightToNormal(hc, strength, wrap) {
    const w = hc.width, h = hc.height;
    const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
    const out = new ImageData(w, h), o = out.data;
    const G = (x, y) => {
      if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y; }
      return src[(y * w + x) * 4];
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (G(x + 1, y - 1) + 2 * G(x + 1, y) + G(x + 1, y + 1)) - (G(x - 1, y - 1) + 2 * G(x - 1, y) + G(x - 1, y + 1));
        const dy = (G(x - 1, y + 1) + 2 * G(x, y + 1) + G(x + 1, y + 1)) - (G(x - 1, y - 1) + 2 * G(x, y - 1) + G(x + 1, y - 1));
        let nx = -dx * strength / 255, ny = dy * strength / 255, nz = 1;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
        const i = (y * w + x) * 4;
        o[i] = (nx * 0.5 + 0.5) * 255; o[i + 1] = (ny * 0.5 + 0.5) * 255; o[i + 2] = (nz * 0.5 + 0.5) * 255; o[i + 3] = 255;
      }
    }
    const nc = cnv(w, h); nc.getContext('2d').putImageData(out, 0, 0);
    return nc;
  }
  function grayToCanvas(arr, w, h, lo, hi, tint) {
    const c = cnv(w, h), g = c.getContext('2d'), id = g.createImageData(w, h), d = id.data;
    for (let i = 0; i < arr.length; i++) {
      const v = U.clamp((arr[i] - lo) / (hi - lo), 0, 1) * 255;
      d[i * 4] = v * (tint ? tint[0] : 1); d[i * 4 + 1] = v * (tint ? tint[1] : 1); d[i * 4 + 2] = v * (tint ? tint[2] : 1); d[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  /* ---------------------------------------------------------------------------------------------
   * GEOMETRY ACCUMULATOR: collects transformed primitives per material key, merges at the end
   * ------------------------------------------------------------------------------------------- */
  const _e = new THREE.Euler(), _q = new QT(), _p = new V3(), _s = new V3();
  const Y_AXIS = new V3(0, 1, 0);
  function mat4(pos, rot, scl) {
    if (rot) _e.set(rot[0], rot[1], rot[2], 'XYZ'); else _e.set(0, 0, 0, 'XYZ');
    _q.setFromEuler(_e);
    _s.set(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1);
    return new M4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s);
  }
  function planarUV(geo, tile) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
      let u, v;
      if (ny >= nx && ny >= nz) { u = p.getX(i); v = p.getZ(i); }
      else if (nx >= nz) { u = p.getZ(i); v = p.getY(i); }
      else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  function clean(geo) {
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    if (!geo.index) {
      const n = geo.attributes.position.count, idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
  }
  const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };
  function omitFaces(g, names) {
    const src = g.index.array, keep = [];
    const omit = new Set(names.map((n) => FACE[n]));
    for (let f = 0; f < 6; f++) if (!omit.has(f)) for (let k = 0; k < 6; k++) keep.push(src[f * 6 + k]);
    g.setIndex(keep);
    g.clearGroups();
    return g;
  }
  class Acc {
    constructor() { this.lists = {}; }
    add(key, geo, m, keepUV) {
      if (m) geo.applyMatrix4(m);
      if (!keepUV) planarUV(geo, TILES[key] || 1);
      clean(geo);
      (this.lists[key] = this.lists[key] || []).push(geo);
      return geo;
    }
    box(key, sx, sy, sz, pos, rot, omit) {
      let g = new THREE.BoxGeometry(sx, sy, sz);
      if (omit) g = omitFaces(g, omit);
      return this.add(key, g, mat4(pos, rot));
    }
    // chamfered box (catches highlights on the edges)
    bbox(key, sx, sy, sz, pos, rot, b) {
      b = Math.min(b || 0.006, Math.min(sx, sy, sz) * 0.2);
      const w = sx - 2 * b, h = sy - 2 * b, d = sz - 2 * b;
      const sh = new THREE.Shape(); sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: 0, bevelSegments: 1, curveSegments: 1 });
      g.translate(0, 0, -d / 2);
      // extrude axis is Z; our box has sz along Z, sy along Y, sx along X - matches
      return this.add(key, g, mat4(pos, rot));
    }
    cyl(key, rt, rb, h, pos, rot, seg, open) { return this.add(key, new THREE.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open), mat4(pos, rot)); }
    tube(key, a, b, r, seg, r2) {
      const d = new V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
      const q = new QT().setFromUnitVectors(Y_AXIS, d.normalize());
      const m = new M4().compose(new V3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new V3(1, 1, 1));
      return this.add(key, new THREE.CylinderGeometry(r2 === undefined ? r : r2, r, len, seg || 10, 1, false), m);
    }
    sph(key, r, pos, scl, ws, hs) { return this.add(key, new THREE.SphereGeometry(r, ws || 14, hs || 10), mat4(pos, null, scl)); }
    tor(key, R, r, pos, rot, seg) { return this.add(key, new THREE.TorusGeometry(R, r, 6, seg || 24), mat4(pos, rot)); }
    curve(key, pts, r, tseg, rseg) {
      const c = new THREE.CatmullRomCurve3(pts.map((p) => new V3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
      return this.add(key, new THREE.TubeGeometry(c, tseg || 24, r, rseg || 6, false), null);
    }
    // planar quad: origin + ex*w + ey*h; normal = ex x ey; UV (0,0)..(1,1)
    plane(key, origin, ex, ey, w, h) {
      const a = new V3(...origin), X = new V3(...ex).multiplyScalar(w), Y = new V3(...ey).multiplyScalar(h);
      const p = [a, a.clone().add(X), a.clone().add(X).add(Y), a.clone().add(Y)];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
      const n = new V3().crossVectors(new V3(...ex), new V3(...ey)).normalize();
      g.setAttribute('normal', new THREE.Float32BufferAttribute([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return this.add(key, g, null, true);
    }
    merged(key) { return this.lists[key] ? BGU.mergeGeometries(this.lists[key], false) : null; }
    build(mats, noShadow) {
      const grp = new THREE.Group();
      let tris = 0;
      for (const key of Object.keys(this.lists)) {
        const g = this.merged(key);
        if (!g) continue;
        for (const s of this.lists[key]) s.dispose();
        tris += g.index.count / 3;
        const mesh = new THREE.Mesh(g, mats[key]);
        mesh.name = 'rover_' + key;
        mesh.castShadow = !(noShadow && noShadow.includes(key)); mesh.receiveShadow = true;
        grp.add(mesh);
      }
      grp.userData.tris = tris;
      return grp;
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * WHEEL GEOMETRY (axis = Z, outer side = +Z; two groups: 0 = black tread/skin, 1 = aluminium/titanium)
   * ------------------------------------------------------------------------------------------- */
  function spokeGeometry(a0, r0, r1, sweep, thick, z0, z1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, r = r0 + (r1 - r0) * t, a = a0 + sweep * Math.pow(t, 1.35);
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const pos = [], idx = [];
    const quad = (A, B, Cc, Dd) => { const b = pos.length / 3; pos.push(...A, ...B, ...Cc, ...Dd); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    const off = pts.map((p, i) => {
      const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n, i + 1)];
      let dx = q1[0] - q0[0], dy = q1[1] - q0[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      return [-dy * thick * 0.5, dx * thick * 0.5];
    });
    for (let i = 0; i < n; i++) {
      const P = pts[i], Q = pts[i + 1], o0 = off[i], o1 = off[i + 1];
      const v = (p, o, s, z) => [p[0] + o[0] * s, p[1] + o[1] * s, z];
      quad(v(P, o0, 1, z0), v(Q, o1, 1, z0), v(Q, o1, 1, z1), v(P, o0, 1, z1));
      quad(v(P, o0, -1, z1), v(Q, o1, -1, z1), v(Q, o1, -1, z0), v(P, o0, -1, z0));
      quad(v(P, o0, -1, z1), v(P, o0, 1, z1), v(Q, o1, 1, z1), v(Q, o1, -1, z1));
      quad(v(P, o0, 1, z0), v(P, o0, -1, z0), v(Q, o1, -1, z0), v(Q, o1, 1, z0));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2).fill(0.5), 2));
    return g;
  }
  function buildWheelGeometry() {
    const R = D.wheelR, W = D.wheelW, rs = R - 0.0085;               // rs = skin radius, R = grouser crest
    const black = new Acc(), alu = new Acc();
    // skin (open cylinder, axis Z; u = around, v = across)
    {
      const g = new THREE.CylinderGeometry(rs, rs, W - 0.006, 96, 1, true);
      g.rotateX(PI / 2);
      black.add('black', g, null, true);
    }
    // 48 grousers, straight with a slight skew
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const g = new THREE.BoxGeometry(0.0085 * 2, 0.0115, W - 0.014);
      const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, 0.02, 0.5);
      const m = new M4().compose(new V3(Math.cos(a) * (rs + 0.0035), Math.sin(a) * (rs + 0.0035), 0), new QT().setFromEuler(new THREE.Euler(0, 0, a + PI / 2 + 0.0)), new V3(1, 1, 1));
      // skew about the radial axis (rotate the strip a few degrees about its local Y (radial))
      const sk = new M4().makeRotationY(0.17);
      g.applyMatrix4(sk);
      black.add('black', g, m, true);
    }
    // flange rings at both edges + inner rim lip
    for (const s of [-1, 1]) {
      const rg = new THREE.RingGeometry(rs - 0.03, rs + 0.001, 96);
      if (s < 0) rg.rotateY(PI);
      black.add('black', rg, mat4([0, 0, s * (W / 2 - 0.004)]), true);
    }
    // hub axle and drive-motor housing (inner side = -Z), dark
    black.cyl('black', 0.058, 0.058, 0.42, [0, 0, -0.03], [PI / 2, 0, 0], 20);
    black.cyl('black', 0.078, 0.078, 0.11, [0, 0, -0.245], [PI / 2, 0, 0], 24);
    // outer hub dish (dark, slightly domed) so the spoke roots have something to sit on
    {
      const g = new THREE.CylinderGeometry(0.068, 0.11, 0.028, 32, 1, false); g.rotateX(PI / 2);
      black.add('black', g, mat4([0, 0, 0.196]), true);
    }
    // spokes: 10 curved titanium blades near the outer side
    for (let i = 0; i < 10; i++) {
      const g = spokeGeometry((i / 10) * TAU, 0.075, rs - 0.012, 0.95, 0.007, 0.055, 0.155, 14);
      alu.add('alu', g, null, true);
    }
    // hub cap + bolt ring (aluminium)
    alu.cyl('alu', 0.05, 0.05, 0.02, [0, 0, 0.212], [PI / 2, 0, 0], 24);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; alu.cyl('alu', 0.0065, 0.0065, 0.012, [Math.cos(a) * 0.036, Math.sin(a) * 0.036, 0.222], [PI / 2, 0, 0], 8); }
    alu.tor('alu', 0.088, 0.006, [0, 0, 0.205], null, 32);
    alu.tor('alu', 0.24, 0.004, [0, 0, W / 2 - 0.006], null, 72);
    alu.tor('alu', 0.24, 0.004, [0, 0, -W / 2 + 0.006], null, 72);
    const gb = black.merged('black'), ga = alu.merged('alu');
    const g = BGU.mergeGeometries([gb, ga], true);
    return g;
  }

  /* ---------------------------------------------------------------------------------------------
   * TEXTURES
   * ------------------------------------------------------------------------------------------- */
  function makeTextures(renderer, footprints) {
    const aniso = Math.min(8, renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4);
    let bytes = 0;
    const T = {};
    function tex(cv, srgb, repeat) {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = aniso;
      t.needsUpdate = true;
      bytes += cv.width * cv.height * 4;
      return t;
    }
    /* ---- white paint tile (384) ---- */
    {
      const n = 384;
      const f1 = fbmRect(n, n, 11, 4, 4, 4, 0.55), f2 = fbmRect(n, n, 12, 3, 48, 48, 0.5), f3 = fbmRect(n, n, 13, 4, 8, 8, 0.6);
      const c = cnv(n, n), g = c.getContext('2d'), id = g.createImageData(n, n), d = id.data;
      const hc = cnv(n, n), hg = hc.getContext('2d'), hid = hg.createImageData(n, n), hd = hid.data;
      for (let i = 0; i < n * n; i++) {
        let b = 0.905 + (f1[i] - 0.5) * 0.06 + (f2[i] - 0.5) * 0.035;
        const dirt = Math.max(0, f3[i] - 0.66) * 0.35;               // dust smears
        b *= 1 - dirt;
        d[i * 4] = b * 255; d[i * 4 + 1] = b * 250; d[i * 4 + 2] = b * 240; d[i * 4 + 3] = 255;
        const hv = 128 + (f2[i] - 0.5) * 60 + (f3[i] - 0.5) * 20;
        hd[i * 4] = hd[i * 4 + 1] = hd[i * 4 + 2] = hv; hd[i * 4 + 3] = 255;
      }
      g.putImageData(id, 0, 0); hg.putImageData(hid, 0, 0);
      T.paintAlb = tex(c, true, true);
      T.paintNrm = tex(heightToNormal(hc, 1.1, true), false, true);
    }
    /* ---- foil / kapton crinkle normal + albedo variation (384) ---- */
    {
      const n = 384;
      const a = fbmRect(n, n, 21, 5, 6, 6, 0.55), b = fbmRect(n, n, 22, 4, 14, 14, 0.5);
      const hc = cnv(n, n), hg = hc.getContext('2d'), hid = hg.createImageData(n, n), hd = hid.data;
      const ac = cnv(n, n), ag = ac.getContext('2d'), aid = ag.createImageData(n, n), ad = aid.data;
      for (let i = 0; i < n * n; i++) {
        const ridge = 1 - Math.abs(a[i] * 2 - 1);                       // creases
        const r2 = 1 - Math.abs(b[i] * 2 - 1);
        const hv = 128 + (ridge * 0.7 + r2 * 0.3 - 0.6) * 220;
        hd[i * 4] = hd[i * 4 + 1] = hd[i * 4 + 2] = hv; hd[i * 4 + 3] = 255;
        const v = 0.62 + 0.38 * ridge * r2 + (b[i] - 0.5) * 0.2;         // facet brightness variation
        ad[i * 4] = ad[i * 4 + 1] = ad[i * 4 + 2] = U.clamp(v, 0.25, 1) * 255; ad[i * 4 + 3] = 255;
      }
      hg.putImageData(hid, 0, 0); ag.putImageData(aid, 0, 0);
      T.foilNrm = tex(heightToNormal(hc, 2.2, true), false, true);
      T.foilAlb = tex(ac, true, true);
    }
    /* ---- perforated grille (256) ---- */
    {
      const n = 256, c = cnv(n, n), g = c.getContext('2d');
      g.fillStyle = '#3d4247'; g.fillRect(0, 0, n, n);
      g.fillStyle = '#080a0c';
      const cnt = 9, s = n / cnt;
      for (let j = 0; j < cnt; j++) for (let i = 0; i < cnt; i++) {
        const x = (i + (j % 2 ? 0.5 : 0)) * s + s / 2, y = (j + 0.5) * s;
        for (const ox of [0, i === 0 ? n : (i === cnt - 1 ? -n : 0)]) { g.beginPath(); g.ellipse(x + ox, y, s * 0.27, s * 0.27, 0, 0, TAU); g.fill(); }
      }
      T.grille = tex(c, true, true);
    }
    /* ---- wheel tread (1024 x 256): dark anodised aluminium with 'JPL' Morse holes ---- */
    {
      const w = 768, h = 192, c = cnv(w, h), g = c.getContext('2d'), hc = cnv(w, h), hg = hc.getContext('2d');
      const nz = fbmRect(w, h, 31, 4, 12, 3, 0.55), sc = fbmRect(w, h, 32, 2, 3, 48, 0.5);
      const id = g.createImageData(w, h), d = id.data, hid = hg.createImageData(w, h), hd = hid.data;
      for (let i = 0; i < w * h; i++) {
        const v = 0.085 + (nz[i] - 0.5) * 0.05 + Math.max(0, sc[i] - 0.55) * 0.12;   // dark with brushed scratches
        d[i * 4] = v * 255; d[i * 4 + 1] = v * 255; d[i * 4 + 2] = v * 262; d[i * 4 + 3] = 255;
        const hv = 128 + (nz[i] - 0.5) * 50 + (sc[i] - 0.5) * 60;
        hd[i * 4] = hd[i * 4 + 1] = hd[i * 4 + 2] = hv; hd[i * 4 + 3] = 255;
      }
      g.putImageData(id, 0, 0); hg.putImageData(hid, 0, 0);
      // Morse code "JPL" = .--- .--. .-.. ; repeated 3 times around the circumference, along the centre line
      const seq = '.--- .--. .-..';
      g.fillStyle = '#000'; hg.fillStyle = '#000';
      for (let rep = 0; rep < 3; rep++) {
        let x = (rep / 3) * w + 30;
        for (const ch of seq) {
          if (ch === ' ') { x += 16; continue; }
          const len = ch === '.' ? 6 : 18;
          g.fillRect(x, h / 2 - 3, len, 6); hg.fillRect(x, h / 2 - 3, len, 6);
          x += len + 7;
        }
      }
      // faint lighter wear on the grouser crests (vertical bands, 48 around)
      g.globalAlpha = 0.12; g.fillStyle = '#9aa0a8';
      for (let i = 0; i < 48; i++) g.fillRect((i / 48) * w, 0, 3, h);
      g.globalAlpha = 1;
      T.treadAlb = tex(c, true, true);
      T.treadNrm = tex(heightToNormal(hc, 1.4, true), false, true);
    }
    /* ---- deck and sides ---- */
    {
      const deck = makeDeckTextures(footprints); T.deckAlb = tex(deck.alb, true, false); T.deckNrm = tex(deck.nrm, false, false);
      const sr = makeSideTextures(true), sl = makeSideTextures(false);
      T.sideRAlb = tex(sr.alb, true, false); T.sideRNrm = tex(sr.nrm, false, false);
      T.sideLAlb = tex(sl.alb, true, false); T.sideLNrm = tex(sl.nrm, false, false);
      const ff = makeFaceTextures(true), fa = makeFaceTextures(false);
      T.faceFAlb = tex(ff.alb, true, false); T.faceFNrm = tex(ff.nrm, false, false);
      T.faceAAlb = tex(fa.alb, true, false); T.faceANrm = tex(fa.nrm, false, false);
    }
    T.bytes = bytes;
    return T;
  }

  /* ---- drawing helpers shared by deck / side texture painters ---- */
  function Painter(alb, hgt) {
    this.g = alb.getContext('2d'); this.h = hgt.getContext('2d'); this.w = alb.width; this.hh = alb.height;
  }
  Painter.prototype = {
    rivet(x, y, r, col) {
      const g = this.g, h = this.h;
      g.fillStyle = col || '#6f7175'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, TAU); g.fill();
      h.fillStyle = 'rgb(215,215,215)'; h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
    },
    rivetRow(x1, y1, x2, y2, pitch, r, col) {
      const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.floor(L / pitch));
      for (let i = 0; i <= n; i++) this.rivet(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, r, col);
    },
    seam(x1, y1, x2, y2, wpx, col) {
      const g = this.g, h = this.h;
      g.strokeStyle = col || 'rgba(70,72,78,0.85)'; g.lineWidth = wpx || 1.2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      h.strokeStyle = 'rgb(40,40,40)'; h.lineWidth = (wpx || 1.2) * 1.4; h.beginPath(); h.moveTo(x1, y1); h.lineTo(x2, y2); h.stroke();
    },
    rect(x, y, w, hgt, col, hv) {
      this.g.fillStyle = col; this.g.fillRect(x, y, w, hgt);
      if (hv !== undefined) { this.h.fillStyle = 'rgb(' + hv + ',' + hv + ',' + hv + ')'; this.h.fillRect(x, y, w, hgt); }
    },
    disc(x, y, r, col, hv) {
      this.g.fillStyle = col; this.g.beginPath(); this.g.arc(x, y, r, 0, TAU); this.g.fill();
      if (hv !== undefined) { this.h.fillStyle = 'rgb(' + hv + ',' + hv + ',' + hv + ')'; this.h.beginPath(); this.h.arc(x, y, r, 0, TAU); this.h.fill(); }
    },
    fiducial(x, y, r) {
      const g = this.g;
      this.disc(x, y, r, '#f2f2f2', 150);
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r * 0.78, PI, PI * 1.5); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, r * 0.78, 0, PI * 0.5); g.closePath(); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = Math.max(1, r * 0.12); g.beginPath(); g.arc(x, y, r * 0.95, 0, TAU); g.stroke();
    },
    // copper/kapton harness: thick curve with highlight, raised in the height map
    harness(pts, wpx, col, hi) {
      const g = this.g, h = this.h;
      const path = (c) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const p = pts[i - 1], q = pts[i]; c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); } c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
      g.lineCap = 'round'; g.lineJoin = 'round'; h.lineCap = 'round'; h.lineJoin = 'round';
      g.strokeStyle = 'rgba(20,10,8,0.5)'; g.lineWidth = wpx + 2.4; path(g); g.stroke();
      g.strokeStyle = col; g.lineWidth = wpx; path(g); g.stroke();
      g.strokeStyle = hi || 'rgba(255,220,170,0.6)'; g.lineWidth = Math.max(1, wpx * 0.28); path(g); g.stroke();
      h.strokeStyle = 'rgb(205,205,205)'; h.lineWidth = wpx; path(h); h.stroke();
    },
  };

  /* ---- top deck albedo + height (texture u -> +X, v up -> -Z; see deck plane below) ---- */
  const DECK = { W: 1408, H: 771 };
  function makeDeckTextures(footprints) {
    const W = DECK.W, H = DECK.H, ppm = W / (D.x1 - D.x0);
    const alb = cnv(W, H), hgt = cnv(W, H), P = new Painter(alb, hgt), g = P.g, h = P.h;
    const X = (x) => (x - D.x0) * ppm, Z = (z) => (z + D.hz) * ppm;
    g.fillStyle = '#ebe9e4'; g.fillRect(0, 0, W, H);
    h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, W, H);
    // paint mottling / dust
    {
      const nw = 352, nh = 193, nz = fbmRect(nw, nh, 41, 4, 5, 3, 0.55), nc = grayToCanvas(nz, nw, nh, 0.25, 0.85);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.16; g.imageSmoothingEnabled = true; g.drawImage(nc, 0, 0, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    // panel seams (x seams and z seams) with rivet rows
    const xs = [-1.0, -0.62, -0.20, 0.10, 0.42, 0.78], zs = [-0.40, 0.0, 0.36];
    for (const x of xs) { P.seam(X(x), 0, X(x), H, 1.3); P.rivetRow(X(x) - 6, 8, X(x) - 6, H - 8, 16, 1.7); P.rivetRow(X(x) + 6, 8, X(x) + 6, H - 8, 16, 1.7); }
    for (const z of zs) { P.seam(0, Z(z), W, Z(z), 1.3); P.rivetRow(8, Z(z) - 6, W - 8, Z(z) - 6, 16, 1.7); }
    // border rivets
    P.rivetRow(10, 10, W - 10, 10, 15, 1.9); P.rivetRow(10, H - 10, W - 10, H - 10, 15, 1.9);
    P.rivetRow(10, 10, 10, H - 10, 15, 1.9); P.rivetRow(W - 10, 10, W - 10, H - 10, 15, 1.9);
    // -------- the two dark grey-green plates flanking a round disc with a ring of 20 screws --------
    const pxA = X(-0.36), pxB = X(-0.24);
    const plate = (z0, z1, taperFront) => {
      P.rect(pxA, Z(z0), pxB - pxA, Z(z1) - Z(z0), '#59645f', 150);
      g.strokeStyle = 'rgba(20,24,22,0.7)'; g.lineWidth = 2; g.strokeRect(pxA, Z(z0), pxB - pxA, Z(z1) - Z(z0));
      P.rivetRow(pxA + 8, Z(z0) + 8, pxA + 8, Z(z1) - 8, 14, 1.8, '#c2c8c4'); P.rivetRow(pxB - 8, Z(z0) + 8, pxB - 8, Z(z1) - 8, 14, 1.8, '#c2c8c4');
      P.rivetRow(pxA + 8, Z(z0) + 8, pxB - 8, Z(z0) + 8, 14, 1.8, '#c2c8c4'); P.rivetRow(pxA + 8, Z(z1) - 8, pxB - 8, Z(z1) - 8, 14, 1.8, '#c2c8c4');
      // dashed centre line
      g.strokeStyle = 'rgba(210,215,212,0.7)'; g.lineWidth = 1.6; g.setLineDash([6, 8]); g.beginPath(); g.moveTo((pxA + pxB) / 2, Z(z0) + 20); g.lineTo((pxA + pxB) / 2, Z(z1) - 20); g.stroke(); g.setLineDash([]);
    };
    plate(-0.56, -0.135); plate(0.135, 0.60);
    P.disc(X(-0.30), Z(-0.005), 0.098 * ppm, '#9ea3a4', 165);
    g.strokeStyle = 'rgba(40,42,44,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(X(-0.30), Z(-0.005), 0.098 * ppm, 0, TAU); g.stroke();
    for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; P.rivet(X(-0.30) + Math.cos(a) * 0.072 * ppm, Z(-0.005) + Math.sin(a) * 0.072 * ppm, 2.6, '#4a4c50'); }
    P.disc(X(-0.30), Z(-0.005), 0.035 * ppm, '#b7bbbc', 190);
    P.fiducial(X(-0.30), Z(0.47), 0.03 * ppm);
    // -------- fiducial stickers, Mastcam-Z calibration target, Kapton patch outline --------
    P.fiducial(X(-0.66), Z(0.50), 0.028 * ppm); P.fiducial(X(-1.0), Z(0.50), 0.026 * ppm); P.fiducial(X(-0.62), Z(-0.05), 0.026 * ppm); P.fiducial(X(0.05), Z(-0.55), 0.022 * ppm);
    {
      const cx = X(-0.55), cz = Z(0.40), r = 0.05 * ppm;
      P.disc(cx, cz, r, '#c9a24a', 170); P.disc(cx, cz, r * 0.86, '#1a1a1c', 140);
      const cols = ['#c2372c', '#3a8a3e', '#2f5fb5', '#d8c040', '#e8e8e8', '#7a7a7a'];
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; P.disc(cx + Math.cos(a) * r * 0.62, cz + Math.sin(a) * r * 0.62, r * 0.14, cols[i]); }
      P.disc(cx, cz, r * 0.32, '#f0f0f0'); P.disc(cx, cz, r * 0.2, '#161616');
    }
    // -------- painted harness lines (copper / kapton) --------
    const cu = '#a4562e', kap = '#d99a38';
    P.harness([[X(-1.16), Z(-0.20)], [X(-1.0), Z(-0.24)], [X(-0.85), Z(-0.12)], [X(-0.7), Z(-0.18)], [X(-0.6), Z(-0.05)]], 5, cu);
    P.harness([[X(-0.97), Z(0.05)], [X(-0.85), Z(0.16)], [X(-0.72), Z(0.10)], [X(-0.65), Z(0.30)]], 4, kap);
    P.harness([[X(0.05), Z(0.66)], [X(0.20), Z(0.55)], [X(0.32), Z(0.60)], [X(0.50), Z(0.50)], [X(0.62), Z(0.55)]], 4.5, cu);
    P.harness([[X(0.36), Z(-0.64)], [X(0.26), Z(-0.52)], [X(0.22), Z(-0.36)], [X(0.10), Z(-0.30)]], 4, kap);
    P.harness([[X(-0.33), Z(0.30)], [X(-0.20), Z(0.42)], [X(-0.08), Z(0.36)], [X(0.02), Z(0.48)]], 3.6, cu);
    P.harness([[X(-0.10), Z(-0.60)], [X(0.0), Z(-0.50)], [X(-0.08), Z(-0.40)], [X(0.02), Z(-0.30)]], 3.6, cu);
    // -------- ambient occlusion blobs under the raised hardware --------
    g.save();
    for (const f of footprints) {
      const cx = X(f.x), cz = Z(f.z), w = f.sx * ppm, d = f.sz * ppm;
      g.translate(cx, cz); g.rotate(-f.rot || 0);
      g.filter = 'blur(' + Math.round(6 + f.h * 26) + 'px)'; g.fillStyle = 'rgba(40,38,44,' + Math.min(0.55, 0.22 + f.h * 0.9).toFixed(2) + ')';
      g.fillRect(-w / 2 - 6, -d / 2 - 6, w + 12, d + 12);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    g.restore(); g.filter = 'none';
    // grime at the edges
    {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, 'rgba(90,70,60,0.10)'); gr.addColorStop(0.08, 'rgba(90,70,60,0)'); gr.addColorStop(0.92, 'rgba(90,70,60,0)'); gr.addColorStop(1, 'rgba(90,70,60,0.10)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    const nrm = heightToNormal(hgt, 1.6, false);
    // height canvas can be smaller
    const nrmS = cnv(W >> 1, H >> 1); nrmS.getContext('2d').drawImage(nrm, 0, 0, W >> 1, H >> 1);
    return { alb, nrm: nrmS };
  }

  /* ---- chassis side walls: u runs toward the front on the right wall and toward the rear on the left wall ---- */
  const SIDE = { W: 1280, H: 390 };
  function makeSideTextures(right) {
    const W = SIDE.W, H = SIDE.H, ppm = W / (D.x1 - D.x0);
    const alb = cnv(W, H), hgt = cnv(W, H), P = new Painter(alb, hgt), g = P.g, h = P.h;
    const X = (x) => (right ? (x - D.x0) : (D.x1 - x)) * ppm;
    const Y = (y) => (D.y1 - y) * ppm;
    const seed = right ? 51 : 61;
    g.fillStyle = '#e6e4df'; g.fillRect(0, 0, W, H);
    h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, W, H);
    {
      const nw = 320, nh = 98, nz = fbmRect(nw, nh, seed, 4, 6, 2, 0.55), nc = grayToCanvas(nz, nw, nh, 0.25, 0.85);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.2; g.drawImage(nc, 0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    // panel layout
    const vx = right ? [-0.98, -0.42, 0.14, 0.62, 0.95] : [-1.02, -0.5, 0.05, 0.55, 0.92];
    for (const x of vx) { P.seam(X(x), 0, X(x), H, 1.3); P.rivetRow(X(x) - 6, 10, X(x) - 6, H - 10, 16, 1.7); P.rivetRow(X(x) + 6, 10, X(x) + 6, H - 10, 16, 1.7); }
    P.seam(0, Y(-0.13), W, Y(-0.13), 1.3); P.rivetRow(8, Y(-0.13) - 6, W - 8, Y(-0.13) - 6, 16, 1.7);
    P.rivetRow(8, 10, W - 8, 10, 15, 1.9); P.rivetRow(8, H - 10, W - 8, H - 10, 15, 1.9);
    // darker recessed panels (grey-white, as around the rocker pivots)
    const rp = (x0, x1, y0, y1, col) => {
      const a = Math.min(X(x0), X(x1)), b = Math.max(X(x0), X(x1));
      P.rect(a, Y(y1), b - a, Y(y0) - Y(y1), col, 112);
      g.strokeStyle = 'rgba(60,62,68,0.8)'; g.lineWidth = 2; g.strokeRect(a, Y(y1), b - a, Y(y0) - Y(y1));
      P.rivetRow(a + 8, Y(y1) + 8, b - 8, Y(y1) + 8, 15, 1.7); P.rivetRow(a + 8, Y(y0) - 8, b - 8, Y(y0) - 8, 15, 1.7);
    };
    rp(-0.36, 0.08, -0.31, 0.02, '#b9bcbe');
    rp(0.20, 0.55, -0.31, -0.16, '#c8c9c8');
    // silver MLI blanket patch (crinkled)
    {
      const x0 = -1.12, x1 = -0.62, y0 = -0.32, y1 = 0.06;
      const a = Math.min(X(x0), X(x1)), b = Math.max(X(x0), X(x1)), top = Y(y1), bot = Y(y0);
      const cw = Math.round(b - a), ch = Math.round(bot - top);
      const nz = fbmRect(cw, ch, seed + 3, 5, 6, 4, 0.55), nz2 = fbmRect(cw, ch, seed + 4, 4, 12, 8, 0.5);
      const c1 = cnv(cw, ch), c1g = c1.getContext('2d'), id = c1g.createImageData(cw, ch), d = id.data;
      const c2 = cnv(cw, ch), c2g = c2.getContext('2d'), hid = c2g.createImageData(cw, ch), hd = hid.data;
      for (let i = 0; i < cw * ch; i++) {
        const rg = 1 - Math.abs(nz[i] * 2 - 1), rg2 = 1 - Math.abs(nz2[i] * 2 - 1);
        const v = U.clamp(0.55 + 0.4 * rg * rg2 + (nz2[i] - 0.5) * 0.35, 0.2, 1);
        d[i * 4] = v * 218; d[i * 4 + 1] = v * 220; d[i * 4 + 2] = v * 228; d[i * 4 + 3] = 255;
        const hv = 128 + (rg * 0.7 + rg2 * 0.3 - 0.55) * 230; hd[i * 4] = hd[i * 4 + 1] = hd[i * 4 + 2] = hv; hd[i * 4 + 3] = 255;
      }
      c1g.putImageData(id, 0, 0); c2g.putImageData(hid, 0, 0);
      g.drawImage(c1, a, top); h.drawImage(c2, a, top);
      g.strokeStyle = 'rgba(40,40,46,0.85)'; g.lineWidth = 2.5; g.strokeRect(a, top, cw, ch);
      g.strokeStyle = 'rgba(30,30,34,0.7)'; g.lineWidth = 1.5; g.setLineDash([9, 7]); g.strokeRect(a + 6, top + 6, cw - 12, ch - 12); g.setLineDash([]);
    }
    // gold Kapton wrapped harness runs
    const cu = '#9b5230', kap = '#dc9d3c';
    P.harness([[X(-0.98), Y(0.28)], [X(-0.80), Y(0.20)], [X(-0.55), Y(0.24)], [X(-0.30), Y(0.16)], [X(-0.10), Y(0.22)], [X(0.10), Y(0.12)]], 8, kap);
    P.harness([[X(-0.98), Y(0.22)], [X(-0.70), Y(0.13)], [X(-0.44), Y(0.17)], [X(-0.20), Y(0.06)], [X(0.08), Y(0.05)]], 5, cu);
    P.harness([[X(0.20), Y(-0.20)], [X(0.35), Y(-0.28)], [X(0.52), Y(-0.24)], [X(0.70), Y(-0.30)]], 6, kap);
    P.harness([[X(0.62), Y(0.28)], [X(0.72), Y(0.20)], [X(0.86), Y(0.24)], [X(1.02), Y(0.14)]], 6, cu);
    // decals
    if (right) {
      // American flag
      const fx = X(0.66), fy = Y(0.30), fw = 0.20 * ppm, fh = 0.105 * ppm;
      g.fillStyle = '#f4f4f4'; g.fillRect(fx, fy, fw, fh);
      g.fillStyle = '#b32234'; for (let i = 0; i < 7; i++) g.fillRect(fx, fy + (i * 2 * fh) / 13, fw, fh / 13);
      g.fillStyle = '#3c3b6e'; g.fillRect(fx, fy, fw * 0.4, fh * 7 / 13);
      g.fillStyle = '#fff'; for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) g.fillRect(fx + 4 + i * (fw * 0.4 - 8) / 5, fy + 4 + j * (fh * 7 / 13 - 6) / 4, 2, 2);
      h.fillStyle = 'rgb(120,120,120)'; h.fillRect(fx, fy, fw, fh);
      // NASA worm
      g.fillStyle = '#e3342f'; g.font = 'italic 900 ' + Math.round(0.15 * ppm) + 'px Arial, Helvetica, sans-serif'; g.textBaseline = 'alphabetic';
      g.fillText('N\u039BS\u039B', X(0.18), Y(0.235));
      h.fillStyle = 'rgb(122,122,122)'; h.fillRect(X(0.18), Y(0.24), 0.3 * ppm, 0.11 * ppm);
    } else {
      // left side: rover ID plates and a hazard-free clean panel; small JPL-style roundel
      P.disc(X(0.10), Y(0.20), 0.05 * ppm, '#dcdedf', 118); g.strokeStyle = '#2a4a8a'; g.lineWidth = 3; g.beginPath(); g.arc(X(0.10), Y(0.20), 0.043 * ppm, 0, TAU); g.stroke();
      g.fillStyle = '#c0392b'; g.fillRect(X(0.5), Y(0.28), 0.10 * ppm, 0.03 * ppm);
    }
    // fiducials + fastener circles
    P.fiducial(X(-0.20), Y(0.27), 0.022 * ppm); P.fiducial(X(0.78), Y(-0.22), 0.022 * ppm);
    for (const [x, y] of [[-0.14, -0.12], [0.02, -0.12], [-0.14, -0.28], [0.02, -0.28]]) { P.rivet(X(x), Y(y), 5, '#55575b'); }
    // drips of dirt near the bottom
    {
      const gr = g.createLinearGradient(0, H * 0.7, 0, H);
      gr.addColorStop(0, 'rgba(100,78,64,0)'); gr.addColorStop(1, 'rgba(100,78,64,0.20)'); g.fillStyle = gr; g.fillRect(0, H * 0.7, W, H * 0.3);
    }
    const nrm = heightToNormal(hgt, 1.6, false);
    const nrmS = cnv(W >> 1, H >> 1); nrmS.getContext('2d').drawImage(nrm, 0, 0, W >> 1, H >> 1);
    return { alb, nrm: nrmS };
  }


  /* ---- front / aft end walls (u runs toward -Z on the front wall and toward +Z on the aft wall) ---- */
  const ENDW = { W: 896, H: 497 };
  function makeFaceTextures(front) {
    const W = ENDW.W, H = ENDW.H, ppm = W / (2 * D.hz);
    const alb = cnv(W, H), hgt = cnv(W, H), P = new Painter(alb, hgt), g = P.g, h = P.h;
    const Zx = (z) => (front ? (D.hz - z) : (z + D.hz)) * ppm;
    const Y = (y) => (D.y1 - y) * ppm;
    const seed = front ? 71 : 81;
    g.fillStyle = '#e7e5e0'; g.fillRect(0, 0, W, H);
    h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, W, H);
    {
      const nw = 224, nh = 124, nz = fbmRect(nw, nh, seed, 4, 4, 2, 0.55), nc = grayToCanvas(nz, nw, nh, 0.25, 0.85);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.2; g.drawImage(nc, 0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    for (const z of front ? [0.36, -0.02, -0.38] : [0.30, -0.30]) { P.seam(Zx(z), 0, Zx(z), H, 1.3); P.rivetRow(Zx(z) - 5, 8, Zx(z) - 5, H - 8, 14, 1.6); P.rivetRow(Zx(z) + 5, 8, Zx(z) + 5, H - 8, 14, 1.6); }
    P.seam(0, Y(-0.12), W, Y(-0.12), 1.3); P.rivetRow(8, Y(-0.12) - 5, W - 8, Y(-0.12) - 5, 14, 1.6);
    P.rivetRow(8, 8, W - 8, 8, 14, 1.8); P.rivetRow(8, H - 8, W - 8, H - 8, 14, 1.8);
    P.rivetRow(8, 8, 8, H - 8, 14, 1.8); P.rivetRow(W - 8, 8, W - 8, H - 8, 14, 1.8);
    const recess = (z0, z1, y0, y1, col, hv) => {
      const a = Math.min(Zx(z0), Zx(z1)), b = Math.max(Zx(z0), Zx(z1));
      P.rect(a, Y(y1), b - a, Y(y0) - Y(y1), col, hv);
      g.strokeStyle = 'rgba(40,42,46,0.85)'; g.lineWidth = 2.5; g.strokeRect(a, Y(y1), b - a, Y(y0) - Y(y1));
      P.rivetRow(a + 7, Y(y1) + 7, b - 7, Y(y1) + 7, 14, 1.6); P.rivetRow(a + 7, Y(y0) - 7, b - 7, Y(y0) - 7, 14, 1.6);
    };
    const cu = '#9b5230', kap = '#dc9d3c';
    if (front) {
      recess(0.10, 0.56, -0.30, 0.12, '#8b9093', 104);            // arm / turret cradle recess
      recess(-0.55, -0.10, -0.32, -0.16, '#c5c7c7', 118);
      P.harness([[Zx(0.60), Y(0.28)], [Zx(0.40), Y(0.20)], [Zx(0.2), Y(0.26)], [Zx(0.0), Y(0.18)], [Zx(-0.2), Y(0.24)]], 6, kap);
      P.harness([[Zx(-0.60), Y(0.20)], [Zx(-0.4), Y(0.12)], [Zx(-0.2), Y(0.05)]], 4, cu);
      P.fiducial(Zx(-0.30), Y(0.08), 0.022 * ppm); P.fiducial(Zx(0.58), Y(-0.24), 0.02 * ppm);
      // caution tag
      P.rect(Zx(-0.44), Y(0.02), 0.09 * ppm, 0.03 * ppm, '#c0392b', 140);
      g.fillStyle = '#f4d03f'; for (let i = 0; i < 4; i++) g.fillRect(Zx(-0.44) + 4 + i * 0.024 * ppm, Y(0.02) + 3, 0.012 * ppm, 0.03 * ppm - 6);
    } else {
      // circular RTG interface plate
      P.disc(Zx(0), Y(-0.02), 0.27 * ppm, '#9b9fa2', 108); P.disc(Zx(0), Y(-0.02), 0.22 * ppm, '#dcdedf', 122);
      g.strokeStyle = 'rgba(40,42,46,0.85)'; g.lineWidth = 3; g.beginPath(); g.arc(Zx(0), Y(-0.02), 0.27 * ppm, 0, TAU); g.stroke();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; P.rivet(Zx(0) + Math.cos(a) * 0.245 * ppm, Y(-0.02) + Math.sin(a) * 0.245 * ppm, 3.2, '#4a4c50'); }
      recess(0.32, 0.58, -0.30, -0.06, '#8b9093', 104); recess(-0.58, -0.32, -0.30, -0.06, '#c5c7c7', 118);
      P.harness([[Zx(0.58), Y(0.22)], [Zx(0.3), Y(0.16)], [Zx(0.1), Y(0.24)], [Zx(-0.2), Y(0.14)], [Zx(-0.5), Y(0.2)]], 7, kap);
      P.fiducial(Zx(0.45), Y(0.08), 0.022 * ppm);
    }
    const nrm = heightToNormal(hgt, 1.5, false);
    const nrmS = cnv(W >> 1, H >> 1); nrmS.getContext('2d').drawImage(nrm, 0, 0, W >> 1, H >> 1);
    return { alb, nrm: nrmS };
  }

  /* ---------------------------------------------------------------------------------------------
   * PROCEDURAL ENVIRONMENT (only for the metals; the scene lights stay in charge of everything else)
   * ------------------------------------------------------------------------------------------- */
  function makeEnvironment(renderer) {
    if (window.__ROVER_NOENV) return null;
    try {
      const es = new THREE.Scene();
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vP; void main(){ float y = normalize(vP).y;' +
          ' vec3 zen = vec3(0.34,0.31,0.34), hor = vec3(0.95,0.74,0.55), gnd = vec3(0.36,0.20,0.12);' +
          ' vec3 c = y > 0.0 ? mix(hor, zen, pow(y, 0.55)) : mix(hor*0.8, gnd, pow(-y, 0.4));' +
          ' float sun = pow(max(dot(normalize(vP), normalize(vec3(-0.769,0.637,-0.04))), 0.0), 60.0);' +
          ' gl_FragColor = vec4(c*0.85 + vec3(1.0,0.9,0.75)*sun*4.0, 1.0); }',
      });
      es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromScene(es, 0.03);
      pm.dispose();
      return rt.texture;
    } catch (e) { console.warn('[rover] env map failed: ' + e); return null; }
  }

  /* ===========================================================================================
   * FACTORY
   * ========================================================================================= */
  EDL.registerModule('rover', function factory(ctx) {
    const renderer = ctx.renderer;
    const rng = U.rng(2021218);
    const rr = (a, b) => a + (b - a) * rng();
    const group = new THREE.Group(); group.name = 'rover';
    const rig = new THREE.Group(); rig.name = 'rover_rig'; group.add(rig);          // settle bounce lives here

    /* ------------------------------------------------------------------ hull, deck hardware */
    const body = new Acc();
    const foot = [];                                                                   // deck footprints for baked AO
    const DY = D.y1;
    const fp = (x, z, sx, sz, rot, h) => foot.push({ x, z, sx, sz, rot: rot || 0, h });
    const deckBox = (key, sx, sy, sz, x, z, rotY, yBase) => {
      const yb = yBase === undefined ? DY : yBase;
      if (Math.min(sx, sy, sz) > 0.03 && (key === 'paint' || key === 'black' || key === 'greyPaint' || key === 'alu' || key === 'gold')) body.bbox(key, sx, sy, sz, [x, yb + sy / 2, z], [0, rotY || 0, 0], 0.005);
      else body.box(key, sx, sy, sz, [x, yb + sy / 2, z], [0, rotY || 0, 0]);
      if (yb <= DY + 0.001) fp(x, z, sx, sz, rotY, sy);
    };
    const deckCyl = (key, r, h, x, z, seg, yBase) => {
      const yb = yBase === undefined ? DY : yBase;
      body.cyl(key, r, r, h, [x, yb + h / 2, z], null, seg || 20);
      if (yb <= DY + 0.001) fp(x, z, r * 2, r * 2, 0, h);
    };
    const KEYS_MIX = ['paint', 'paint', 'paint', 'paint', 'black', 'black', 'alu', 'copper', 'greyPaint', 'foil'];
    // random mechanical clutter (electronics boxes, canisters, brackets, stacked units) inside a deck rectangle
    const clutter = (x0, x1, z0, z1, n, o) => {
      o = o || {};
      const keys = o.keys || KEYS_MIX;
      for (let i = 0; i < n; i++) {
        const x = rr(x0, x1), z = rr(z0, z1), sx = rr(o.smin || 0.04, o.smax || 0.12), sz = rr(o.smin || 0.04, o.smax || 0.12), sy = rr(o.hmin || 0.03, o.hmax || 0.10);
        const rot = rng() < 0.6 ? 0 : rr(0, 1.6), k = keys[Math.floor(rng() * keys.length)], sh = rng();
        if (sh < 0.6) deckBox(k, sx, sy, sz, x, z, rot);
        else if (sh < 0.82) deckCyl(k, Math.min(sx, sz) / 2, sy, x, z, 14);
        else { deckBox(k, sx, sy, sz, x, z, rot); deckBox(keys[Math.floor(rng() * keys.length)], sx * 0.6, sy * 0.7, sz * 0.6, x, z, rot, DY + sy); }
      }
    };
    // harness run over the deck: pts = [x, z, height above deck]
    const cable = (key, pts, r) => body.curve(key, pts.map((p) => [p[0], DY + p[2], p[1]]), r, Math.max(16, pts.length * 8), 6);
    // bolt heads / small fasteners on a rectangle (rows)
    const CX = (D.x0 + D.x1) / 2;

    // main box: top and both side walls come from textured planes (deck / sideR / sideL)
    body.box('paint', D.x1 - D.x0, D.y1 - D.y0, 2 * D.hz, [CX, (D.y0 + D.y1) / 2, 0], null, ['py', 'pz', 'nz', 'px', 'nx']);
    body.plane('deck', [D.x0, DY, D.hz], [1, 0, 0], [0, 0, -1], D.x1 - D.x0, 2 * D.hz);
    body.plane('sideR', [D.x0, D.y0, D.hz], [1, 0, 0], [0, 1, 0], D.x1 - D.x0, D.y1 - D.y0);
    body.plane('sideL', [D.x1, D.y0, -D.hz], [-1, 0, 0], [0, 1, 0], D.x1 - D.x0, D.y1 - D.y0);
    body.plane('faceF', [D.x1, D.y0, D.hz], [0, 0, -1], [0, 1, 0], 2 * D.hz, D.y1 - D.y0);
    body.plane('faceA', [D.x0, D.y0, -D.hz], [0, 0, 1], [0, 1, 0], 2 * D.hz, D.y1 - D.y0);
    // raised lip around the deck, bottom flange rails (bare aluminium), corner posts
    body.box('paint', D.x1 - D.x0, 0.014, 0.016, [CX, DY + 0.007, D.hz - 0.008]);
    body.box('paint', D.x1 - D.x0, 0.014, 0.016, [CX, DY + 0.007, -D.hz + 0.008]);
    body.box('paint', 0.016, 0.014, 2 * D.hz, [D.x0 + 0.008, DY + 0.007, 0]);
    body.box('paint', 0.016, 0.014, 2 * D.hz, [D.x1 - 0.008, DY + 0.007, 0]);
    for (const s of [-1, 1]) {
      body.box('alu', D.x1 - D.x0 + 0.02, 0.05, 0.03, [CX, D.y0 + 0.015, s * (D.hz + 0.012)]);
      for (let i = 0; i < 14; i++) body.cyl('black', 0.008, 0.008, 0.012, [D.x0 + 0.1 + i * 0.165, D.y0 + 0.02, s * (D.hz + 0.03)], [PI / 2, 0, 0], 8);
    }
    body.box('alu', 0.03, 0.05, 2 * D.hz + 0.02, [D.x1 + 0.012, D.y0 + 0.015, 0]);
    body.box('alu', 0.03, 0.05, 2 * D.hz + 0.02, [D.x0 - 0.012, D.y0 + 0.015, 0]);

    // ---- FRONT (X > 0.5): stowed robotic arm with turret, perforated box, big round shroud -----
    deckBox('grille', 0.22, 0.30, 0.36, 1.00, -0.52, 0);                        // perforated black box (left front)
    body.tube('alu', [1.10, DY + 0.30, -0.58], [1.10, DY + 0.44, -0.58], 0.006, 6);
    body.tube('alu', [1.10, DY + 0.30, -0.47], [1.11, DY + 0.40, -0.47], 0.006, 6);
    for (const [x, z] of [[1.11, -0.63], [0.89, -0.63], [1.11, -0.41], [0.89, -0.41]]) body.box('paint', 0.02, 0.30, 0.02, [x, DY + 0.15, z]);
    deckBox('paint', 0.26, 0.24, 0.26, 0.82, -0.22, 0);                         // white elbow box
    body.box('black', 0.27, 0.014, 0.27, [0.82, DY + 0.247, -0.22]);
    body.box('greyPaint', 0.10, 0.03, 0.10, [0.80, DY + 0.265, -0.22]);
    body.tube('black', [0.96, DY + 0.20, -0.10], [0.94, DY + 0.20, 0.44], 0.04, 12);          // forearm
    body.box('paint', 0.024, 0.016, 0.50, [0.965, DY + 0.245, 0.17]);
    for (const z of [0.0, 0.2, 0.4]) body.box('black', 0.06, 0.09, 0.03, [0.96, DY + 0.16, z]);   // arm clamps
    deckCyl('black', 0.046, 0.34, 1.07, 0.48, 16);                              // turret drum / upright
    body.cyl('alu', 0.05, 0.05, 0.016, [1.07, DY + 0.335, 0.48], null, 16);
    deckBox('gold', 0.18, 0.20, 0.20, 0.93, 0.48, 0);                           // turret instruments (Kapton wrapped)
    body.box('black', 0.05, 0.10, 0.06, [0.82, DY + 0.16, 0.48]);
    deckCyl('paint', 0.25, 0.09, 0.46, 0.18, 44);                               // big round shroud
    body.tor('alu', 0.245, 0.008, [0.46, DY + 0.09, 0.18], [PI / 2, 0, 0], 48);
    body.cyl('greyPaint', 0.19, 0.19, 0.008, [0.46, DY + 0.094, 0.18], null, 36);
    body.cyl('paint', 0.06, 0.06, 0.05, [0.46, DY + 0.12, 0.18], null, 20);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; body.cyl('alu', 0.007, 0.007, 0.012, [0.46 + Math.cos(a) * 0.21, DY + 0.096, 0.18 + Math.sin(a) * 0.21], null, 8); }
    body.sph('black', 0.045, [0.72, DY + 0.06, -0.05]);
    // copper coil stack + black box (front left)
    deckBox('black', 0.14, 0.10, 0.14, 0.58, -0.50, 0.2);
    for (let i = 0; i < 6; i++) body.tor('copper', 0.05, 0.009, [0.58, DY + 0.11 + i * 0.016, -0.50], [PI / 2, 0, 0], 20);
    deckBox('paint', 0.20, 0.13, 0.22, 0.40, -0.40, 0.2);
    // right-hand shoulder bracket / machinery (overhangs the deck edge)
    deckBox('paint', 0.30, 0.16, 0.26, 0.36, 0.50, 0.15);
    deckBox('paint', 0.18, 0.28, 0.14, 0.62, 0.52, -0.1);
    deckBox('foil', 0.16, 0.10, 0.20, 0.66, 0.30, 0.0);
    deckBox('black', 0.10, 0.08, 0.12, 0.10, 0.52, 0.3);
    clutter(0.05, 0.70, 0.22, 0.58, 7, { smin: 0.04, smax: 0.11, hmin: 0.03, hmax: 0.12 });
    clutter(0.25, 0.75, -0.60, -0.28, 6, { smin: 0.04, smax: 0.10, hmin: 0.03, hmax: 0.10 });
    // ---- MID: X-shaped white bracket structure (stowed mast + support), on stand-offs ----------
    {
      const cx = 0.16, cz = 0.02;
      for (const [ang, len, w, hgt] of [[0.70, 0.98, 0.14, 0.11], [-0.66, 0.86, 0.13, 0.10]]) {
        body.bbox('paint', len, hgt, w, [cx, DY + 0.04 + hgt / 2, cz], [0, ang, 0], 0.008); fp(cx, cz, len, w, ang, hgt + 0.04);
        for (const sgn of [-1, 1]) {
          const ex = cx + Math.cos(ang) * len / 2 * sgn, ez = cz - Math.sin(ang) * len / 2 * sgn;
          body.box('greyPaint', 0.05, hgt + 0.05, w + 0.03, [ex, DY + 0.04 + hgt / 2, ez], [0, ang, 0]);
          for (const k of [-1, 1]) body.cyl('alu', 0.008, 0.008, 0.012, [ex + Math.sin(ang) * k * 0.05, DY + 0.04 + hgt + 0.005, ez + Math.cos(ang) * k * 0.05], null, 8);
        }
      }
      body.box('paint', 0.20, 0.15, 0.18, [cx + 0.34, DY + 0.16, cz + 0.30], [0, 0.70, 0]);
      body.cyl('lens', 0.035, 0.035, 0.02, [cx + 0.34 + 0.10 * Math.cos(0.70), DY + 0.17, cz + 0.30 - 0.10 * Math.sin(0.70)], [0, 0, PI / 2], 14);
      body.cyl('lens', 0.03, 0.03, 0.02, [cx + 0.34 + 0.10 * Math.cos(0.70) - 0.05 * Math.sin(0.70), DY + 0.20, cz + 0.30 - 0.10 * Math.sin(0.70) - 0.05 * Math.cos(0.70)], [0, 0, PI / 2], 14);
    }
    // ---- MID/AFT: hex bridle plates (gold) with the three cord terminations ------------------
    const bridleTop = [];
    const hexPlate = (x, z, r, rot) => {
      const g = new THREE.CylinderGeometry(r, r, 0.016, 6, 1, false);
      body.add('gold', g, mat4([x, DY + 0.05, z], [0, rot || 0, 0]));
      body.cyl('alu', 0.022, 0.022, 0.03, [x, DY + 0.07, z], null, 12);
      for (const a of [0, 2.09, 4.19]) body.cyl('alu', 0.012, 0.012, 0.04, [x + Math.cos(a) * r * 0.7, DY + 0.025, z + Math.sin(a) * r * 0.7], null, 8);
      fp(x, z, r * 2, r * 2, 0, 0.05);
      bridleTop.push(new V3(x, DY + 0.09, z));
    };
    hexPlate(-0.44, -0.45, 0.145, 0);       // the big visible one (salmon-gold in the video)
    hexPlate(0.12, -0.50, 0.085, 0.3);
    hexPlate(0.16, 0.45, 0.085, -0.2);
    // ---- AFT of the plates: fiducial-marked white panel, Kapton patch, electronics ---------
    deckBox('paint', 0.40, 0.03, 0.44, -0.82, 0.36, 0);
    body.box('gold', 0.13, 0.03, 0.11, [-0.57, DY + 0.015, 0.26]); fp(-0.57, 0.26, 0.13, 0.11, 0, 0.03);
    body.cyl('alu', 0.006, 0.006, 0.05, [-0.55, DY + 0.025, 0.40], null, 8);       // Mastcam-Z calibration target gnomon
    deckBox('black', 0.18, 0.11, 0.16, -0.95, -0.16, 0.3);
    deckBox('paint', 0.14, 0.10, 0.12, -0.75, -0.14, -0.2);
    deckBox('alu', 0.12, 0.16, 0.12, -0.72, -0.30, 0.2);
    deckCyl('alu', 0.06, 0.17, -1.02, 0.02, 18);                                   // silver canister
    body.sph('black', 0.03, [-0.96, DY + 0.14, -0.38]);
    deckBox('greyPaint', 0.16, 0.08, 0.20, -1.06, -0.38, 0.1);
    deckCyl('copper', 0.05, 0.05, -0.86, -0.30, 18, DY + 0.16);
    clutter(-1.10, -0.70, -0.55, 0.05, 10, { smin: 0.04, smax: 0.10, hmin: 0.03, hmax: 0.09 });
    clutter(-0.25, 0.05, 0.25, 0.60, 4, { smin: 0.04, smax: 0.09 });
    // ---- black / copper / kapton cable runs on the deck -------------------------------------
    cable('copper', [[-1.10, -0.25, 0.03], [-0.98, -0.32, 0.06], [-0.85, -0.20, 0.05], [-0.66, -0.28, 0.07]], 0.011);
    cable('kapton', [[0.10, -0.60, 0.05], [0.24, -0.48, 0.09], [0.30, -0.34, 0.07], [0.42, -0.26, 0.10]], 0.014);
    cable('copper', [[0.05, 0.60, 0.05], [0.20, 0.52, 0.08], [0.34, 0.58, 0.06], [0.50, 0.46, 0.09]], 0.012);
    cable('kapton', [[-0.20, 0.30, 0.05], [-0.10, 0.40, 0.09], [0.0, 0.34, 0.06]], 0.013);
    cable('copper', [[-0.30, -0.20, 0.05], [-0.22, -0.05, 0.10], [-0.10, 0.08, 0.06]], 0.010);
    cable('black', [[-0.20, -0.62, 0.03], [-0.10, -0.50, 0.08], [0.0, -0.58, 0.05], [0.14, -0.40, 0.08], [0.20, -0.25, 0.06]], 0.013);
    cable('black', [[0.45, 0.62, 0.04], [0.40, 0.48, 0.10], [0.25, 0.42, 0.07], [0.12, 0.30, 0.11], [0.02, 0.22, 0.06]], 0.012);
    cable('black', [[-0.70, 0.10, 0.03], [-0.62, 0.20, 0.06], [-0.58, 0.32, 0.03]], 0.008);
    cable('paint', [[0.60, -0.10, 0.11], [0.68, 0.05, 0.14], [0.74, 0.20, 0.12]], 0.008);
    cable('black', [[-1.05, 0.30, 0.03], [-0.96, 0.18, 0.06], [-0.86, 0.12, 0.05]], 0.009);
    // ---- folded high-gain antenna (hexagonal panel) at the aft left ------------------------
    {
      const hx = -0.98, hz = -0.50;
      const g = new THREE.CylinderGeometry(0.14, 0.14, 0.02, 6, 1, false);
      body.add('paint', g, mat4([hx, DY + 0.14, hz], [0, 0.1, 0]));
      const g2 = new THREE.CylinderGeometry(0.115, 0.115, 0.006, 6, 1, false);
      body.add('greyPaint', g2, mat4([hx, DY + 0.153, hz], [0, 0.1, 0]));
      body.tor('alu', 0.125, 0.006, [hx, DY + 0.148, hz], [PI / 2, 0.1, 0], 6);
      for (const [dx, dz] of [[-0.08, -0.06], [0.08, -0.06], [0.0, 0.09]]) body.tube('black', [hx + dx, DY, hz + dz], [hx + dx * 0.8, DY + 0.13, hz + dz * 0.8], 0.012, 8);
      fp(hx, hz, 0.28, 0.28, 0, 0.15);
    }
    // ---- RUC (rover up-look camera) near the UHF antenna; UHF antenna ------------------------
    const rucPos = new V3(-1.02, DY + 0.075, 0.48);
    deckBox('paint', 0.12, 0.05, 0.12, rucPos.x, rucPos.z, 0);
    body.box('black', 0.07, 0.03, 0.07, [rucPos.x, DY + 0.065, rucPos.z]);
    body.cyl('lens', 0.02, 0.02, 0.02, [rucPos.x, DY + 0.09, rucPos.z], null, 14);
    deckCyl('black', 0.04, 0.12, -1.34, 0.49, 12);                              // UHF antenna on its stand
    body.cyl('uhf', 0.105, 0.105, 0.20, [-1.34, DY + 0.22, 0.49], null, 28); fp(-1.34, 0.49, 0.22, 0.22, 0, 0.3);
    body.cyl('alu', 0.108, 0.108, 0.012, [-1.34, DY + 0.326, 0.49], null, 28);
    body.tor('black', 0.106, 0.006, [-1.34, DY + 0.12, 0.49], [PI / 2, 0, 0], 28); body.tor('black', 0.106, 0.006, [-1.34, DY + 0.31, 0.49], [PI / 2, 0, 0], 28);
    // ---- aft RTG bay: truss, tray walls, white-covered RTG with radial fins -------------------
    const RX = -1.53, RY = -0.02, RL = 0.62, TXa = -1.90, TXb = D.x0;
    body.cyl('paint', 0.235, 0.235, RL, [RX, RY, 0], [0, 0, PI / 2], 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + PI / 8;
      body.box('rtg', RL, 0.115, 0.016, [RX, RY + Math.sin(a) * 0.29, Math.cos(a) * 0.29], [PI / 2 - a, 0, 0]);
    }
    body.cyl('rtg', 0.25, 0.25, 0.03, [RX + RL / 2 + 0.015, RY, 0], [0, 0, PI / 2], 8);
    body.cyl('rtg', 0.25, 0.25, 0.03, [RX - RL / 2 - 0.015, RY, 0], [0, 0, PI / 2], 8);
    body.box('paint', 0.06, 0.14, 0.98, [TXa + 0.03, 0.05, 0]);                       // aft wall
    for (const zs of [-1, 1]) body.box('paint', (TXb - TXa), 0.14, 0.05, [(TXa + TXb) / 2, 0.06, zs * 0.475]);   // side walls
    body.box('paint', TXb - TXa - 0.06, 0.02, 0.90, [(TXa + TXb) / 2 + 0.02, -0.11, 0]);    // tray floor
    body.box('paint', 0.05, 0.05, 0.98, [D.x0 - 0.04, 0.29, 0.0]);                     // top chord of the truss
    body.box('paint', 0.05, 0.04, 0.98, [D.x0 - 0.04, 0.19, 0.0]);
    for (let i = 0; i < 12; i++) {
      const z0 = -0.47 + i * (0.94 / 12), z1 = z0 + 0.94 / 12;
      body.tube('paint', [D.x0 - 0.04, i % 2 ? 0.29 : 0.19, i % 2 ? z0 : z1], [D.x0 - 0.04, i % 2 ? 0.19 : 0.29, i % 2 ? z1 : z0], 0.009, 6);
    }
    for (const zs of [0.36, 0.395, 0.43]) body.tube('gold', [D.x0 - 0.08, 0.10, zs], [TXa + 0.08, 0.10, zs], 0.009, 6);
    for (const zs of [-0.34, 0.34]) { body.tube('paint', [D.x0, -0.05, zs], [TXa + 0.05, -0.13, zs], 0.02, 8); }
    body.box('alu', 0.05, 0.06, 0.06, [D.x0 - 0.04, 0.24, -0.50]); body.box('alu', 0.05, 0.06, 0.06, [D.x0 - 0.04, 0.24, 0.50]);
    // umbilical connector (aft left corner of the RTG bay)
    const umbPos = new V3(-1.80, 0.14, -0.36);
    body.cyl('paint', 0.045, 0.05, 0.07, [umbPos.x, umbPos.y + 0.035, umbPos.z], null, 14);
    body.cyl('copper', 0.032, 0.032, 0.025, [umbPos.x, umbPos.y + 0.08, umbPos.z], null, 12);

    // ---- underside: belly plate, Ingenuity bay, RDC ------------------------------------------
    body.box('alu', 0.62, 0.05, 0.52, [0.02, D.y0 - 0.03, -0.02]);                  // Ingenuity debris-shield bay
    body.box('paint', 0.66, 0.02, 0.56, [0.02, D.y0 - 0.06, -0.02]);
    body.box('foil', 0.30, 0.02, 0.20, [-0.55, D.y0 - 0.015, 0.20]);
    for (const [x, z] of [[-0.26, -0.24], [0.30, -0.24], [-0.26, 0.24], [0.30, 0.24]]) body.cyl('black', 0.018, 0.018, 0.03, [x, D.y0 - 0.075, z], null, 10);
    const rdcPos = new V3(1.06, D.y0 - 0.012, 0.36);
    body.box('black', 0.07, 0.024, 0.07, [rdcPos.x, rdcPos.y, rdcPos.z]);
    body.cyl('lens', 0.016, 0.016, 0.006, [rdcPos.x, rdcPos.y - 0.014, rdcPos.z], null, 14);
    // front face cameras (hazcams / navcams), rear hazcams
    for (const z of [-0.50, -0.36, -0.06, 0.04]) { body.box('black', 0.03, 0.05, 0.075, [D.x1 + 0.014, 0.06, z]); body.cyl('lens', 0.017, 0.017, 0.006, [D.x1 + 0.03, 0.06, z], [0, 0, PI / 2], 12); }
    for (const z of [-0.40, 0.40]) { body.box('black', 0.03, 0.05, 0.075, [D.x0 - 0.014, -0.13, z]); body.cyl('lens', 0.017, 0.017, 0.006, [D.x0 - 0.03, -0.13, z], [0, 0, -PI / 2], 12); }
    // ---- side hardware: differential pivot housings, junction boxes, harness bundles --------------
    for (const s of [-1, 1]) {
      body.cyl('black', 0.09, 0.09, 0.05, [-0.05, -0.12, s * (D.hz + 0.02)], [PI / 2, 0, 0], 24);
      body.cyl('alu', 0.05, 0.05, 0.06, [-0.05, -0.12, s * (D.hz + 0.05)], [PI / 2, 0, 0], 20);
      const sb = (key, sx, sy, sz, x, y) => body.box(key, sx, sy, sz, [x, y, s * (D.hz + sz / 2)]);
      sb('black', 0.16, 0.10, 0.045, -0.78, 0.12); sb('paint', 0.12, 0.08, 0.05, -0.60, -0.10); sb('greyPaint', 0.10, 0.14, 0.04, 0.42, -0.06);
      sb('black', 0.08, 0.06, 0.04, 0.72, 0.08); sb('alu', 0.14, 0.03, 0.05, 0.28, -0.30); sb('paint', 0.20, 0.06, 0.03, -0.30, 0.24);
      for (const x of [-0.95, -0.5, 0.2, 0.62, 0.95]) sb('black', 0.045, 0.03, 0.03, x, 0.0);
      for (let i = 0; i < 5; i++) { // cable bundles
        const y0 = 0.20 - i * 0.06;
        body.curve(i % 2 ? 'copper' : 'black', [[-1.05, y0, s * (D.hz + 0.02)], [-0.7, y0 + 0.04, s * (D.hz + 0.03)], [-0.4, y0 - 0.03, s * (D.hz + 0.025)], [-0.1, y0 + 0.03, s * (D.hz + 0.03)]], 0.008 + (i % 2) * 0.004, 20, 6);
      }
    }

    /* ------------------------------------------------------------------ mobility: rocker-bogie, both sides */
    const sides = {};
    const wheelGeo = buildWheelGeometry();
    const zy = D.wheelZ - D.wheelW / 2 - 0.045;                                        // yoke plane |Z| (0.925)
    function buildSide(s) {
      const Dp = [-0.05, -0.12, s * (D.hz + 0.13)], Bp = [-0.68, -0.44, s * zy];
      const Wf = [D.wheelX[0], D.hubY, s * D.wheelZ], Wm = [D.wheelX[1], D.hubY, s * D.wheelZ], Wr = [D.wheelX[2], D.hubY, s * D.wheelZ];
      const rel = (p, o) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      const rk = new Acc(), bg = new Acc();
      // rocker (origin = Dp)
      rk.tube('black', [0, 0, -s * 0.13], [0, 0, 0], 0.05, 12);                                // link from the chassis wall to the pivot
      rk.cyl('black', 0.075, 0.075, 0.13, [0, 0, s * 0.02], [PI / 2, 0, 0], 24);
      rk.cyl('alu', 0.05, 0.05, 0.03, [0, 0, s * 0.09], [PI / 2, 0, 0], 20);
      const fTop = [D.wheelX[0], -0.42, s * zy];
      rk.tube('black', [0, 0, 0], rel(fTop, Dp), 0.048, 14);                                    // front leg
      rk.tube('black', [0, 0, 0], rel(Bp, Dp), 0.052, 14);                                      // rear leg
      rk.sph('black', 0.06, [0, 0, 0]);
      rk.sph('black', 0.055, rel(Bp, Dp));
      rk.cyl('greyPaint', 0.075, 0.075, 0.09, rel([fTop[0], fTop[1] + 0.02, fTop[2]], Dp), null, 20);   // steering actuator (front)
      rk.cyl('alu', 0.078, 0.078, 0.014, rel([fTop[0], fTop[1] + 0.07, fTop[2]], Dp), null, 20);
      // kapton sleeves & harness along the legs
      const mid = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      rk.tube('kapton', mid([0, 0, 0], rel(fTop, Dp), 0.30), mid([0, 0, 0], rel(fTop, Dp), 0.40), 0.052, 12);
      rk.tube('kapton', mid([0, 0, 0], rel(Bp, Dp), 0.42), mid([0, 0, 0], rel(Bp, Dp), 0.52), 0.056, 12);
      rk.curve('copper', [mid([0, 0, 0], rel(fTop, Dp), 0.1).map((v, i) => v + (i === 1 ? 0.06 : 0)), mid([0, 0, 0], rel(fTop, Dp), 0.5).map((v, i) => v + (i === 1 ? 0.075 : 0)), mid([0, 0, 0], rel(fTop, Dp), 0.9).map((v, i) => v + (i === 1 ? 0.06 : 0))], 0.009, 12, 5);
      // bogie (origin = Bp)
      bg.cyl('black', 0.085, 0.085, 0.14, [0, 0, 0], [PI / 2, 0, 0], 24);
      bg.cyl('alu', 0.05, 0.05, 0.03, [0, 0, s * 0.085], [PI / 2, 0, 0], 20);
      const mTop = [D.wheelX[1], -0.47, s * zy], rTop = [D.wheelX[2], -0.44, s * zy];
      bg.tube('black', [0, 0, 0], rel(mTop, Bp), 0.046, 14);
      bg.tube('black', [0, 0, 0], rel(rTop, Bp), 0.046, 14);
      bg.sph('black', 0.055, rel(mTop, Bp)); bg.sph('black', 0.055, rel(rTop, Bp));
      bg.cyl('greyPaint', 0.075, 0.075, 0.09, rel([rTop[0], rTop[1] + 0.02, rTop[2]], Bp), null, 20);
      bg.cyl('alu', 0.078, 0.078, 0.014, rel([rTop[0], rTop[1] + 0.07, rTop[2]], Bp), null, 20);
      bg.tube('kapton', mid([0, 0, 0], rel(rTop, Bp), 0.35), mid([0, 0, 0], rel(rTop, Bp), 0.45), 0.05, 12);
      bg.tube('kapton', mid([0, 0, 0], rel(mTop, Bp), 0.4), mid([0, 0, 0], rel(mTop, Bp), 0.5), 0.05, 12);
      return { Dp, Bp, Wf, Wm, Wr, rk, bg };
    }
    // fork + wheel assemblies (origin = hub centre)
    function forkAcc(s, steered) {
      const f = new Acc();
      const inb = -s * (D.wheelZ - zy);                                   // yoke plane relative to hub (toward chassis)
      f.tube('black', [0, 0.30, inb], [0, 0.0, inb], 0.042, 12);
      f.cyl('black', 0.082, 0.082, 0.05, [0, 0, inb], [PI / 2, 0, 0], 20);
      if (steered) f.cyl('alu', 0.03, 0.03, 0.02, [0, 0, inb - s * 0.03], [PI / 2, 0, 0], 12);
      f.cyl('kapton', 0.046, 0.046, 0.06, [0, 0.20, inb], null, 12);
      return f;
    }
    // build both sides
    const R = { left: buildSide(-1), right: buildSide(1) };

    /* ------------------------------------------------------------------ textures & materials */
    const foots = foot;
    const T = makeTextures(renderer, foots);
    const env = makeEnvironment(renderer);
    const ns = (v) => new THREE.Vector2(v, v);
    const M = {};
    const std = (o) => new THREE.MeshStandardMaterial(o);
    M.paint = std({ color: 0xffffff, map: T.paintAlb, normalMap: T.paintNrm, normalScale: ns(0.16), roughness: 0.6, metalness: 0.0 });
    M.greyPaint = std({ color: 0x59615c, map: T.paintAlb, normalMap: T.paintNrm, normalScale: ns(0.2), roughness: 0.7, metalness: 0.0 });
    M.black = std({ color: 0x1c1d20, normalMap: T.paintNrm, normalScale: ns(0.4), roughness: 0.48, metalness: 0.45 });
    M.alu = std({ color: 0xc4c7ca, map: T.foilAlb, normalMap: T.foilNrm, normalScale: ns(0.15), roughness: 0.36, metalness: 0.85 });
    M.gold = std({ color: 0xe2a545, map: T.foilAlb, normalMap: T.foilNrm, normalScale: ns(0.8), roughness: 0.32, metalness: 0.75 });
    M.kapton = std({ color: 0xd99a3a, map: T.foilAlb, normalMap: T.foilNrm, normalScale: ns(0.45), roughness: 0.36, metalness: 0.55 });
    M.copper = std({ color: 0xb46a3e, normalMap: T.paintNrm, normalScale: ns(0.6), roughness: 0.38, metalness: 0.8 });
    M.foil = std({ color: 0xd9dbe0, map: T.foilAlb, normalMap: T.foilNrm, normalScale: ns(0.45), roughness: 0.38, metalness: 0.85 });
    M.uhf = std({ color: 0x7e8388, normalMap: T.paintNrm, normalScale: ns(0.5), roughness: 0.7, metalness: 0.15 });
    M.rtg = std({ color: 0xb2b6b8, normalMap: T.paintNrm, normalScale: ns(0.3), roughness: 0.5, metalness: 0.6 });
    M.lens = std({ color: 0x08090c, roughness: 0.08, metalness: 0.2 });
    M.grille = std({ color: 0xffffff, map: T.grille, roughness: 0.55, metalness: 0.4 });
    M.deck = std({ color: 0xffffff, map: T.deckAlb, normalMap: T.deckNrm, normalScale: ns(0.8), roughness: 0.62, metalness: 0.0 });
    M.sideR = std({ color: 0xffffff, map: T.sideRAlb, normalMap: T.sideRNrm, normalScale: ns(0.8), roughness: 0.62, metalness: 0.0 });
    M.sideL = std({ color: 0xffffff, map: T.sideLAlb, normalMap: T.sideLNrm, normalScale: ns(0.8), roughness: 0.62, metalness: 0.0 });
    M.faceF = std({ color: 0xffffff, map: T.faceFAlb, normalMap: T.faceFNrm, normalScale: ns(0.8), roughness: 0.62, metalness: 0.0 });
    M.faceA = std({ color: 0xffffff, map: T.faceAAlb, normalMap: T.faceANrm, normalScale: ns(0.8), roughness: 0.62, metalness: 0.0 });
    M.tread = std({ color: 0xffffff, map: T.treadAlb, normalMap: T.treadNrm, normalScale: ns(0.9), roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide });
    M.wheelAlu = std({ color: 0x8d9196, roughness: 0.48, metalness: 0.75, side: THREE.DoubleSide });
    if (env) for (const k of ['black', 'alu', 'gold', 'kapton', 'copper', 'foil', 'uhf', 'rtg', 'lens', 'grille', 'tread', 'wheelAlu']) { M[k].envMap = env; M[k].envMapIntensity = k === 'lens' ? 1.2 : 0.85; }

    /* ------------------------------------------------------------------ assemble the scene graph */
    let tris = 0;
    const bodyGrp = body.build(M); tris += bodyGrp.userData.tris; rig.add(bodyGrp);
    const wheelMat = [M.tread, M.wheelAlu];
    const J = { L: {}, R: {} };
    for (const [name, s] of [['L', -1], ['R', 1]]) {
      const sd = name === 'L' ? R.left : R.right;
      const rocker = new THREE.Group(); rocker.name = 'rocker' + name; rocker.position.set(sd.Dp[0], sd.Dp[1], sd.Dp[2]);
      const rkG = sd.rk.build(M); tris += rkG.userData.tris; rocker.add(rkG);
      const bogie = new THREE.Group(); bogie.name = 'bogie' + name; bogie.position.set(sd.Bp[0] - sd.Dp[0], sd.Bp[1] - sd.Dp[1], sd.Bp[2] - sd.Dp[2]);
      const bgG = sd.bg.build(M); tris += bgG.userData.tris; bogie.add(bgG);
      rocker.add(bogie); rig.add(rocker);
      const wheels = [];
      const mk = (parent, wpos, origin, steered) => {
        const a = new THREE.Group(); a.position.set(wpos[0] - origin[0], wpos[1] - origin[1], wpos[2] - origin[2]);
        const fk = forkAcc(s, steered).build(M); tris += fk.userData.tris; a.add(fk);
        const w = new THREE.Mesh(wheelGeo, wheelMat); w.castShadow = true; w.receiveShadow = true; w.name = 'wheel' + name;
        if (s < 0) w.rotation.y = PI;
        a.add(w); parent.add(a); wheels.push(a);
        return a;
      };
      const wF = mk(rocker, sd.Wf, sd.Dp, true), wM = mk(bogie, sd.Wm, sd.Bp, false), wR = mk(bogie, sd.Wr, sd.Bp, true);
      J[name] = { rocker, bogie, wF, wM, wR };
    }
    tris += (wheelGeo.index.count / 3) * 6;

    /* ------------------------------------------------------------------ anchors / mounts */
    const anchors = { bridle: bridleTop, umbilical: umbPos.clone().add(new V3(0, 0.05, 0)) };
    const mkQuat = (r, u, b) => new QT().setFromRotationMatrix(new M4().makeBasis(r, u, b));
    const mounts = {
      ruc: { pos: new V3(rucPos.x, DY + 0.11, rucPos.z), quat: mkQuat(new V3(0, 0, -1), new V3(1, 0, 0), new V3(0, -1, 0)) },   // looks +Y, image-up = +X
      rdc: { pos: new V3(rdcPos.x, rdcPos.y - 0.02, rdcPos.z), quat: mkQuat(new V3(0, 0, 1), new V3(1, 0, 0), new V3(0, 1, 0)) },   // looks -Y, image-up = +X
    };

    /* ------------------------------------------------------------------ kinematics */
    // stowed pose: rocker pitched up, bogie folded under (angles about +Z; positive lifts the +X end)
    const STOW = { rocker: 0.44, bogie: 2.70, steerF: 0.0 };
    let curU = -1, curS = -1;
    function setMobility(u) {
      u = U.clamp(u === undefined || u !== u ? 1 : u, 0, 1);
      if (u === curU) return;
      curU = u;
      const e = U.smoothstep(0, 1, u), k = 1 - e;
      for (const n of ['L', 'R']) {
        J[n].rocker.rotation.z = STOW.rocker * k;
        J[n].bogie.rotation.z = STOW.bogie * k;
        // wheels keep their attitude relative to the world horizontal while folding (counter-rotate about Z)
        J[n].wF.rotation.z = -STOW.rocker * k;
        J[n].wM.rotation.z = -(STOW.rocker + STOW.bogie) * k;
        J[n].wR.rotation.z = -(STOW.rocker + STOW.bogie) * k;
      }
    }
    function setSettle(u) {
      u = U.clamp(u === undefined || u !== u ? 1 : u, 0, 1);
      if (u === curS) return;
      curS = u;
      const dec = Math.exp(-4.6 * u) * (1 - U.smoothstep(0.85, 1, u));
      rig.position.y = -0.022 * Math.sin(TAU * 2.6 * u) * dec;                 // tyres/suspension take the load: tiny damped bounce
      rig.rotation.z = 0.004 * Math.sin(TAU * 2.1 * u + 0.7) * dec;
      rig.rotation.x = 0.003 * Math.sin(TAU * 1.7 * u) * dec;
    }
    setMobility(1); setSettle(1);

    /* ------------------------------------------------------------------ update */
    function update(t, camera, view) {
      try {
        const f = ctx.modules && ctx.modules.flight;
        if (!f) return;
        const S = f.state(t), b = S && S.bodies && S.bodies.rover;
        if (!b) return;
        if (b.pos && b.quat) U.applyPose(group, b);
        group.visible = b.visible !== false;
        if (b.mobility !== undefined) setMobility(b.mobility);
        if (b.settle !== undefined) setSettle(b.settle);
      } catch (e) { /* never throw from update */ }
    }

    const stats = { tris: Math.round(tris), texMB: +(T.bytes / 1048576).toFixed(1), drawCalls: 0 };
    group.traverse((o) => { if (o.isMesh) stats.drawCalls += Array.isArray(o.material) ? o.material.length : 1; });
    return {
      group, update, setMobility, setSettle, anchors, mounts,
      groundOffset: D.groundOffset, dims: D, stats, joints: J,
      ready: Promise.resolve(),
    };
  });
})();
