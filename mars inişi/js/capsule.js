/* ============================================================================
 * capsule.js  --  module 'capsule'
 *   Mars 2020 aeroshell: heat shield (PICA outside, creased-foil blanket + harness inside),
 *   backshell (biconic, white paint, thrusters, PCC + lid, open interior), parachute support
 *   structure with the PUC cameras, entry balance masses, lid / heat-shield debris.
 *
 *   Roots (both children of api.group, poses come from flight state):
 *     api.heatShield : origin = rim-plane centre, nose toward -Y, inner (concave) side faces +Y
 *     api.backshell  : origin = base-ring centre, apex toward +Y
 *   Everything visual is procedural: the big surfaces are GLSL (onBeforeCompile on MeshStandardMaterial)
 *   so there are no textures at all (0 MB) and detail stays crisp from 0.4 m to 76 m.
 *
 *   Generated file: assembled from _work/tmp_capsule/p*.js by _work/tmp_capsule/build.sh
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util;
  const BGU = THREE.BufferGeometryUtils;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;

  /* ------------------------------------------------------------------ dimensions (metres) */
  const R = C.aeroshell.diameter / 2;                 // 2.25 rim radius
  const HS = {
    R, nose: 1.125, halfAngle: 70 * DEG, thick: 0.05,  // 70 deg sphere-cone, nose radius 1.125 m (MSL/M2020 heritage)
    band: 0.135, ring: 0.06, edge: 0.02,               // black band / cream ring / dark outline widths at the rim
  };
  HS.rt = HS.nose * Math.cos(HS.halfAngle);            // sphere->cone tangent radius (= nose*sin(90-70))
  HS.ht = HS.nose * (1 - Math.sin(HS.halfAngle));      // height of the tangent point above the apex
  HS.tanA = Math.tan(HS.halfAngle);
  const hOf = (r) => (r <= HS.rt ? HS.nose - Math.sqrt(HS.nose * HS.nose - r * r) : HS.ht + (r - HS.rt) / HS.tanA);
  const dhOf = (r) => (r <= HS.rt ? r / Math.sqrt(HS.nose * HS.nose - r * r) : 1 / HS.tanA);
  const H_RIM = hOf(R);                                // ~0.75 m apex->rim height
  // inner (concave, vehicle side) surface passes through the rim plane (y = 0) at r = R; nose apex at y = -H_RIM
  const yIn = (r) => hOf(r) - H_RIM;
  const yOut = (r) => yIn(r) - HS.thick * Math.sqrt(1 + dhOf(r) * dhOf(r));
  HS.depth = H_RIM + HS.thick;                         // rim plane -> outer nose

  // backshell (biconic + parachute closeout cone), origin = base ring centre, apex +Y
  const BS = { R, H: 3.0, thick: 0.05, pccBaseY: 2.42, pccTopY: 3.0, lidR: 0.545 };

  // helpers ------------------------------------------------------------------------------------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp01 = U.saturate;
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(),
    _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

  /** Chaikin corner cutting on a polyline of [r,y] pairs (keeps end points). */
  function chaikin(pts, iters) {
    let p = pts;
    for (let k = 0; k < iters; k++) {
      const o = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        o.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      o.push(p[p.length - 1]);
      p = o;
    }
    return p;
  }

  /**
   * Surface of revolution about +Y from a [r,y] profile.
   * flip=false: normal = (dy,-dr) rotated (i.e. right-hand side when walking along the profile from small to large r).
   * uv: u = azimuth fraction, v = arc-length fraction.  Winding is fixed automatically so the front face follows the normal.
   */
  function revolve(pts, seg, flip, phiStart, phiLen) {
    phiStart = phiStart || 0; phiLen = phiLen || TAU;
    const n = pts.length, pos = [], nor = [], uv = [], idx = [];
    const s = [0];
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const sl = s[n - 1] || 1;
    const nrm = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tr = b[0] - a[0], ty = b[1] - a[1];
      const l = Math.hypot(tr, ty) || 1; tr /= l; ty /= l;
      nrm.push(flip ? [-ty, tr] : [ty, -tr]);
    }
    for (let j = 0; j <= seg; j++) {
      const u = j / seg, ph = phiStart + u * phiLen, c = Math.cos(ph), sn = Math.sin(ph);
      for (let i = 0; i < n; i++) {
        pos.push(pts[i][0] * c, pts[i][1], pts[i][0] * sn);
        nor.push(nrm[i][0] * c, nrm[i][1], nrm[i][0] * sn);
        uv.push(u, s[i] / sl);
      }
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = (j + 1) * n + i, c2 = (j + 1) * n + i + 1, d = j * n + i + 1;
      idx.push(a, b, d, b, c2, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // fix winding: compare the geometric normal of the first triangle with the vertex normal
    if (idx.length >= 3) {
      const P = g.attributes.position, N = g.attributes.normal;
      const i0 = idx[0], i1 = idx[1], i2 = idx[2];
      const a = V3(P.getX(i0), P.getY(i0), P.getZ(i0)), b = V3(P.getX(i1), P.getY(i1), P.getZ(i1)), c3 = V3(P.getX(i2), P.getY(i2), P.getZ(i2));
      const gn = b.clone().sub(a).cross(c3.clone().sub(a));
      const vn = V3(N.getX(i0), N.getY(i0), N.getZ(i0));
      if (gn.dot(vn) < 0) {
        for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
        g.setIndex(idx);
      }
    }
    return g;
  }

  /** flat ribbon following a polyline; normals[] give the local up; width in metres; lift along the normal */
  function ribbon(points, normals, width, lift) {
    const n = points.length, pos = [], nor = [], uv = [], idx = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i], nn = normals[i];
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
      const t = b.clone().sub(a).normalize();
      const side = new THREE.Vector3().crossVectors(nn, t).normalize();
      if (i > 0) acc += p.distanceTo(points[i - 1]);
      for (let k = -1; k <= 1; k += 2) {
        pos.push(p.x + nn.x * lift + side.x * k * width * 0.5, p.y + nn.y * lift + side.y * k * width * 0.5, p.z + nn.z * lift + side.z * k * width * 0.5);
        nor.push(nn.x, nn.y, nn.z);
        uv.push(k < 0 ? 0 : 1, acc);
      }
    }
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  /** transform a geometry by position/quaternion/scale (returns the same geometry) */
  function xf(g, pos, quat, scl) {
    _m.compose(pos || _v.set(0, 0, 0), quat || _q.identity(), scl || _s.set(1, 1, 1));
    g.applyMatrix4(_m);
    return g;
  }
  function merge(list) {
    const cl = list.map((g) => { const c = g.index ? g : g; return c; });
    // make sure all have identical attribute sets
    for (const g of cl) {
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    return BGU.mergeGeometries(cl, false);
  }
  /** quaternion that maps +Y to n and +X approximately to `fwd` (projected) */
  function frameQuat(n, fwd) {
    const up = n.clone().normalize();
    let x = fwd.clone().sub(up.clone().multiplyScalar(fwd.dot(up)));
    if (x.lengthSq() < 1e-8) x = V3(1, 0, 0).sub(up.clone().multiplyScalar(up.x));
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    const m = new THREE.Matrix4().makeBasis(x, up, z);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  // reference-image (crop px, 1398 px picture, centre 700,700, rim radius 655 px = R) -> shield-local position on the inner surface
  // image right = +Z, image down = -X (RDC image-up = +X, right = +Z)
  const PXM = R / 655;
  function pxToXZ(px, py) { const u = (px - 700) * PXM, v = (py - 700) * PXM; return [-v, u]; }
  function surfIn(x, z) {
    const r = Math.hypot(x, z), y = yIn(r), d = dhOf(r);
    const er = r > 1e-6 ? V3(x / r, 0, z / r) : V3(1, 0, 0);
    const n = V3(-d * er.x, 1, -d * er.z).normalize();
    return { p: V3(x, y, z), n, er, r };
  }

  /* ------------------------------------------------------------------ GLSL: procedural surface kits */
  const GLSL_VARY_V = `
varying vec3 vLP; varying vec3 vON; varying vec3 vAx0; varying vec3 vAx1; varying vec3 vAx2;
`;
  const GLSL_VARY_F = `
varying vec3 vLP; varying vec3 vON; varying vec3 vAx0; varying vec3 vAx1; varying vec3 vAx2;
uniform float uSheenK; uniform vec3 uTint;
`;
  const GLSL_LIB = `
#define TAU 6.2831853
float h1(float n){ return fract(sin(n*12.9898+4.1414)*43758.5453); }
float h2(vec2 p){ p = fract(p*vec2(0.1031,0.1030)); p += dot(p, p.yx+33.33); return fract((p.x+p.y)*p.x); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h2(i),h2(i+vec2(1.,0.)),f.x), mix(h2(i+vec2(0.,1.)),h2(i+vec2(1.,1.)),f.x), f.y); }
float rdg(float x){ return 1.0-abs(2.0*x-1.0); }

// anisotropic crease height in metres. c = (along, across) metres, px = metres/pixel (band limiting)
float creaseH(vec2 c, float px, float seed, float aniso){
  float h=0.0, a=1.0;
  vec2 wp = vec2(vn(c*vec2(1.7,4.0)+seed)*2.0-1.0, vn(c*vec2(2.3,6.0)+seed*1.7+7.7)*2.0-1.0);
  for(int i=0;i<3;i++){
    float fx = 22.0*exp2(float(i));
    float fa = fx/aniso;
    float w = 1.0 - smoothstep(0.22, 0.6, fx*px);
    float n = vn(vec2(c.x*fa + wp.x*1.6, c.y*fx + wp.y*2.4) + seed*3.1 + float(i)*11.3);
    h += a*w*rdg(n);
    a *= 0.5;
  }
  return h*0.0075;
}
float grommetH(float d){ return 0.0035*(smoothstep(0.0245,0.0195,d)*(1.0-smoothstep(0.0155,0.0120,d))); }

// ---------------------------------------------------------------- heat-shield inner blanket (creased foil, gores, grommets)
// lp: shield-content-local position (metres). Image plane coords: a = lp.z (right), b = -lp.x (down).
void shieldFoil(vec3 lp, float px, out vec3 alb, out vec3 nObj, out float sheen, out float rough){
  vec2 pl = vec2(lp.z, -lp.x);
  float r = length(pl);
  float th = atan(pl.y, pl.x);
  const float NG = 24.0;
  float gf = (th+PI)/TAU*NG; float gi = floor(gf); float gl = fract(gf);
  float ga = (gi+0.5)/NG*TAU - PI;
  vec2 er = vec2(cos(ga), sin(ga)); vec2 et = vec2(-er.y, er.x);
  vec2 q = vec2(dot(pl,er), dot(pl,et));
  float dl = (h1(gi*3.7+1.3)-0.5)*0.8 + (r>1.5 ? (h1(gi*7.1)-0.5)*0.55 : 0.0);
  float cd = cos(dl), sd = sin(dl);
  vec2 c = vec2(cd*q.x - sd*q.y, sd*q.x + cd*q.y);
  float seed = gi*1.913;
  float e = max(0.0018, px*0.6);
  float h0 = creaseH(c, px, seed, 7.0);
  float hx = creaseH(c+vec2(e,0.0), px, seed, 7.0);
  float hy = creaseH(c+vec2(0.0,e), px, seed, 7.0);
  vec2 gc = vec2(hx-h0, hy-h0)/e;                        // slope in crease frame
  vec2 gq = vec2(cd*gc.x + sd*gc.y, -sd*gc.x + cd*gc.y);  // -> gore frame

  // gore seams
  float sdist = min(gl,1.0-gl)*r*(TAU/NG);
  float seam = 1.0 - smoothstep(0.0, 0.0065+px, sdist);

  // grommet grid per gore
  float oy = h1(gi*5.3)*0.21, ox = h1(gi*9.1)*0.21;
  vec2 ci = floor(vec2((q.x-0.45-ox)/0.21, (q.y-oy)/0.21) + 0.5);
  vec2 ctr = vec2(ci.x*0.21+0.45+ox, ci.y*0.21+oy);
  float cr = length(ctr);
  float ok = step(0.5, cr) * step(cr, R_OUT-0.25) * step(abs(atan(ctr.y, ctr.x)), 0.5*TAU/NG - 0.035/max(cr,0.3) - 0.03);
  vec2 dq = q - ctr; float dgr = length(dq);
  float gfade = (1.0 - smoothstep(0.006, 0.016, px)) * ok;
  float ring = gfade*(smoothstep(0.0235+px,0.0235-px*0.5,dgr) - smoothstep(0.0135+px*0.5,0.0135-px,dgr));
  float hole = gfade*smoothstep(0.0135+px*0.5,0.0135-px,dgr);
  float pin  = gfade*(1.0-smoothstep(0.0038,0.0038+px,dgr));
  vec2 gdir = dq/max(dgr,1e-4);
  float dgh = (grommetH(dgr+e)-grommetH(dgr-e))/(2.0*e);
  vec2 gg = gdir*dgh*gfade;

  vec2 gtot = gq*(1.0-0.85*seam) + gg;
  vec2 gpl = gtot.x*er + gtot.y*et;                      // gradient in the (right, down) plane
  vec3 N0 = normalize(vON);
  nObj = normalize(N0 + vec3(gpl.y, 0.0, -gpl.x)*1.0);

  // albedo: nearly black blue foil (the bright look comes from the sheen fan), creases catch a little more
  float hn = clamp(h0/0.0105, 0.0, 1.0);
  vec3 foil = vec3(0.028,0.042,0.052) * (0.55 + 0.9*hn);
  foil = mix(foil, vec3(0.010,0.012,0.014), seam*0.85);
  foil = mix(foil, vec3(0.006,0.008,0.010), ring*0.9);
  foil = mix(foil, vec3(0.05,0.07,0.08), hole*0.6);
  foil = mix(foil, vec3(0.52,0.58,0.60), pin);
  alb = foil;
  rough = 0.38 + 0.25*(1.0-hn);

  // shield-fixed bright fan (see notes: specular fan of the creased foil, baked, sun-intensity scaled)
  float dth = th - (-100.0*PI/180.0); dth = mod(dth+PI, TAU) - PI;
  float fan = dth < 0.0 ? 1.0 - smoothstep(0.70, 1.55, -dth) : 1.0 - smoothstep(0.72, 1.18, dth);
  float rad = smoothstep(0.03, 0.18, r) * (1.0 - 0.25*smoothstep(1.85, 2.12, r));
  float sl = clamp(0.5 - gpl.y*9.0, 0.0, 1.0);           // slopes facing image-up glint more
  float glint = 0.22 + 0.78*clamp(0.55*smoothstep(0.10,0.80,hn) + 0.45*sl, 0.0, 1.0);
  float mask = (1.0-0.9*seam)*(1.0-0.9*ring)*(1.0-0.55*hole)*(1.0-pin);
  sheen = fan*rad*glint*mask;
}

// ---------------------------------------------------------------- heat-shield outer: PICA tiles with RTV gaps
void picaOuter(vec3 lp, float px, out vec3 alb, out vec3 nObj, out float rough){
  float r = length(lp.xz), th = atan(lp.z, lp.x);
  const float edg[7] = float[7](0.0, 0.30, 0.72, 1.14, 1.56, 1.96, 9.0);
  const float cnt[6] = float[6](1.0, 9.0, 16.0, 22.0, 30.0, 35.0);
  int ri = 0;
  for(int i=1;i<6;i++){ if(r >= edg[i]) ri = i; }
  float lo = edg[ri], hi = edg[ri+1];
  float nT = cnt[ri];
  float a = (th/TAU+0.5)*nT + h1(float(ri)*3.3)*3.0;
  float dr = ri==0 ? (hi-r) : min(r-lo, hi-r);
  float dth_ = (0.5-abs(fract(a)-0.5))*(r*TAU/nT);
  float dS = ri==0 ? dr : min(dr, dth_);
  float gap = 1.0 - smoothstep(0.0022, 0.0052+px, dS);
  float tid = h2(vec2(floor(a), float(ri)*7.0));
  float streak = vn(vec2(th*26.0, r*1.6));
  float fine = vn(lp.xz*44.0+lp.y*7.0);
  float big  = vn(lp.xz*2.3+4.0);
  vec3 char_ = vec3(0.030,0.023,0.018)*(0.65+0.85*tid)*(0.75+0.5*streak)*(0.85+0.3*fine);
  char_ = mix(char_, vec3(0.05,0.042,0.036), smoothstep(0.55,0.9,big)*0.5);
  // tile edges chipped/lighter
  float edgeL = 1.0 - smoothstep(0.004, 0.03, dS);
  char_ = mix(char_, char_*1.7+0.01, edgeL*0.5);
  alb = mix(char_, vec3(0.115,0.105,0.095), gap);
  float w = 1.0 - smoothstep(0.004, 0.012, px);
  vec3 N0 = normalize(vON);
  vec2 bg = vec2(vn(lp.xz*60.0)-0.5, vn(lp.zx*60.0+3.1)-0.5)*0.35*w;
  nObj = normalize(N0 + vec3(bg.x, 0.0, bg.y) - N0*gap*0.0);
  rough = 0.93;
}

// ---------------------------------------------------------------- backshell exterior: white paint over SLA-561V, soot, seams, rivets
void bsOuter(vec3 lp, float px, out vec3 alb, out vec3 nObj, out float rough){
  float y = lp.y, r = length(lp.xz), th = atan(lp.z, lp.x);
  vec3 paint = vec3(0.70,0.69,0.655);
  float mott = vn(lp.xz*2.6 + y*1.7);
  float streak = vn(vec2(th*20.0 + y*0.6, y*1.2));
  float soot = smoothstep(1.9, 0.05, y)*(0.30+0.70*streak) + 0.18*smoothstep(0.8,2.9,y)*streak;
  vec3 sootC = vec3(0.30,0.235,0.18);
  alb = mix(paint*(0.90+0.2*mott), sootC, clamp(soot*0.50, 0.0, 0.72));
  float w = 1.0 - smoothstep(0.004, 0.012, px);
  alb *= 0.96 + 0.08*h2(lp.xz*220.0+lp.y*90.0)*w;
  // ring seams
  const float ys[6] = float[6](0.105, 0.64, 1.19, 1.83, 2.43, 2.60);
  float seam = 0.0;
  for(int i=0;i<6;i++){ seam = max(seam, 1.0 - smoothstep(0.0012, 0.0032+px, abs(y-ys[i]))); }
  // radial seams (two bands)
  float dsl = 1e3;
  if(y > 0.12 && y < 1.19){ float pa = th/TAU*22.0; dsl = min(fract(pa),1.0-fract(pa))*r*TAU/22.0; }
  else if(y >= 1.19 && y < 2.42){ float pa = th/TAU*14.0 + 0.5; dsl = min(fract(pa),1.0-fract(pa))*r*TAU/14.0; }
  seam = max(seam, 1.0 - smoothstep(0.0012, 0.0032+px, dsl));
  alb *= mix(1.0, 0.42, seam);
  // rivets along two ring seams
  float rv = 0.0;
  for(int i=1;i<3;i++){
    float Y0 = ys[i]; float ar = (th+PI)*r; float fr = (fract(ar/0.11)-0.5)*0.11;
    float d = length(vec2(fr, y-Y0-0.014));
    rv = max(rv, (1.0 - smoothstep(0.0028, 0.0028+px, d)));
  }
  alb = mix(alb, alb*0.55, rv*w);
  vec3 N0 = normalize(vON);
  nObj = normalize(N0 + vec3(vn(lp.xz*18.0)-0.5, 0.0, vn(lp.zx*18.0+2.0)-0.5)*0.05*w);
  rough = 0.55 + 0.25*streak;
}

// ---------------------------------------------------------------- backshell interior: cork/SLA tan, gold MLI panels, soot
void bsInner(vec3 lp, float px, out vec3 alb, out vec3 nObj, out float rough, out float metal){
  float y = lp.y, r = length(lp.xz), th = atan(lp.z, lp.x);
  float n1 = vn(lp.xz*5.0 + y*4.0), n2 = vn(lp.xz*23.0 + y*17.0);
  vec3 cork = mix(vec3(0.24,0.155,0.085), vec3(0.42,0.30,0.17), n1) * (0.85+0.3*n2);
  float soot = smoothstep(2.0, 2.9, y)*0.6 + 0.35*vn(vec2(th*6.0, y*2.0));
  cork = mix(cork, vec3(0.06,0.045,0.035), clamp(soot,0.,1.)*0.55);
  // MLI panels: alternate gold blankets
  float pa = th/TAU*6.0 + 0.25;
  float inP = step(fract(pa), 0.62) * step(0.32, y) * step(y, 1.55);
  vec2 cp = vec2(y*3.0, th*r*3.0);
  float hc = creaseH(cp*0.55, px, 3.7, 1.6);
  vec3 gold = vec3(0.62,0.44,0.13) * (0.6 + 0.8*clamp(hc/0.009,0.,1.));
  float edgeD = min(abs(fract(pa)-0.0), abs(fract(pa)-0.62));
  float tape = 1.0 - smoothstep(0.01, 0.03, edgeD);
  alb = mix(cork, gold, inP);
  alb = mix(alb, vec3(0.65,0.6,0.5), inP*tape*0.5);
  vec3 N0 = normalize(vON);
  float e = max(0.004, px*0.6);
  float hx = creaseH(cp*0.55+vec2(e,0.0), px, 3.7, 1.6), hy = creaseH(cp*0.55+vec2(0.0,e), px, 3.7, 1.6);
  vec2 g = vec2(hx-hc, hy-hc)/e*inP;
  // g is in (y, arc) space -> object space: y axis and tangential direction
  vec3 tang = normalize(vec3(-lp.z, 0.0, lp.x));
  nObj = normalize(N0 - (vec3(0.0,1.0,0.0)*g.x + tang*g.y)*0.9);
  rough = mix(0.88, 0.35, inP);
  metal = inP*0.85;
}

// ---------------------------------------------------------------- generic crinkled metal foil patch (planar, local XY / XZ chosen by uv)
void foilPatch(vec3 lp, float px, out vec3 alb, out vec3 nObj, out float rough){
  vec2 c = lp.xy*9.0 + lp.z*5.0;
  float h0 = creaseH(c*0.33, px*3.0, 5.3, 1.8);
  float e = max(0.002, px*0.6);
  float hx = creaseH((c+vec2(e*9.0,0.0))*0.33, px*3.0, 5.3, 1.8), hy = creaseH((c+vec2(0.0,e*9.0))*0.33, px*3.0, 5.3, 1.8);
  vec2 g = vec2(hx-h0, hy-h0)/e*0.75;
  vec3 N0 = normalize(vON);
  nObj = normalize(N0 - vec3(g.x, g.y, 0.0));
  float hn = clamp(h0/0.011,0.,1.);
  alb = uTint*(0.55+0.65*hn);
  rough = 0.30 + 0.25*(1.0-hn);
}
`;

  /** Build the onBeforeCompile patch for one of the procedural kinds. */
  const KIND_CODE = {
    shieldFoil: `
      vec3 a_; vec3 n_; float sh_; float ro_;
      shieldFoil(vLP, gPx, a_, n_, sh_, ro_);
      diffuseColor.rgb = a_; gN = n_; gRough = ro_;
      float sunLum = 1.0;
      #if NUM_DIR_LIGHTS > 0
        sunLum = dot(directionalLights[0].color, vec3(0.30,0.55,0.15));
      #endif
      gEmit = vec3(0.66,0.90,0.80) * (sh_*sunLum*uSheenK);`,
    pica: `
      vec3 a_; vec3 n_; float ro_;
      picaOuter(vLP, gPx, a_, n_, ro_);
      diffuseColor.rgb = a_; gN = n_; gRough = ro_;`,
    bsOuter: `
      vec3 a_; vec3 n_; float ro_;
      bsOuter(vLP, gPx, a_, n_, ro_);
      diffuseColor.rgb = a_; gN = n_; gRough = ro_;`,
    bsInner: `
      vec3 a_; vec3 n_; float ro_; float me_;
      bsInner(vLP, gPx, a_, n_, ro_, me_);
      diffuseColor.rgb = a_; gN = n_; gRough = ro_; gMetal = me_;`,
    foilPatch: `
      vec3 a_; vec3 n_; float ro_;
      foilPatch(vLP, gPx, a_, n_, ro_);
      diffuseColor.rgb = a_; gN = n_; gRough = ro_; gMetal = 0.9;`,
  };

  const _procMats = [];
  function procMat(kind, base, opts) {
    opts = opts || {};
    const mat = base;
    const uni = { uSheenK: { value: opts.sheenK != null ? opts.sheenK : 0.30 }, uTint: { value: new THREE.Color(opts.tint != null ? opts.tint : 0xffffff) } };
    mat.userData.procUniforms = uni;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSheenK = uni.uSheenK; sh.uniforms.uTint = uni.uTint;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + GLSL_VARY_V)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLP = position; vON = normal; vAx0 = normalize(normalMatrix*vec3(1.,0.,0.)); vAx1 = normalize(normalMatrix*vec3(0.,1.,0.)); vAx2 = normalize(normalMatrix*vec3(0.,0.,1.));');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_VARY_F + '\n#define R_OUT ' + R.toFixed(3) + '\n' + GLSL_LIB)
        .replace('void main() {', 'void main() {\n  vec3 gN = normalize(vON); float gRough = -1.0; float gMetal = -1.0; vec3 gEmit = vec3(0.0); float gPx = max(1e-5, length(fwidth(vLP))*0.7);')
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + KIND_CODE[kind])
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (gRough >= 0.0) roughnessFactor = gRough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  if (gMetal >= 0.0) metalnessFactor = gMetal;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(vAx0*gN.x + vAx1*gN.y + vAx2*gN.z);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gEmit;');
    };
    mat.customProgramCacheKey = () => 'capsule-' + kind;
    _procMats.push(mat);
    return mat;
  }
  function std(color, rough, metal, extra) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal || 0 }, extra || {}));
    return m;
  }

  /* ------------------------------------------------------------------ HEAT SHIELD */
  // Hardware layout traced from the k=62 reference disc (crop px, centre 700,700, R = 655 px).
  const SH_PATHS = {
    // main serpentine from the boss up through the fan to the upper right, then the tangled service coil at ~3 o'clock
    serpentine: [[652, 640], [648, 590], [655, 545], [680, 510], [740, 495], [800, 480], [855, 445], [885, 415], [915, 375], [945, 335],
      [985, 305], [1030, 288], [1085, 276], [1130, 274], [1160, 285], [1172, 320], [1172, 370], [1178, 425], [1182, 470], [1200, 510], [1225, 535], [1240, 560]],
    coil: [[1240, 560], [1252, 590], [1275, 620], [1300, 640], [1312, 625], [1296, 608], [1268, 620], [1244, 640], [1226, 656], [1214, 690], [1202, 724], [1166, 742], [1136, 734]],
    loops: [[1096, 592], [1104, 570], [1128, 572], [1134, 594], [1156, 596], [1168, 574], [1190, 574], [1198, 596], [1222, 604]],
    // branch from the boss down-left around the heart recess
    heartBranch: [[650, 662], [600, 640], [560, 612], [520, 580], [470, 552], [440, 548], [418, 566], [432, 596], [470, 612], [505, 640], [540, 668], [580, 690]],
    // two branches running down from the boss to loose ends
    downA: [[560, 705], [555, 735], [545, 762], [528, 792], [510, 822], [498, 852], [485, 880], [470, 905], [455, 925], [430, 935], [412, 952], [396, 980]],
    downB: [[462, 918], [480, 945], [502, 966], [540, 978], [572, 972], [600, 988], [606, 1010], [592, 1032], [596, 1058]],
    lowerRight: [[720, 770], [760, 800], [812, 830], [852, 852], [888, 884], [912, 925], [936, 962], [962, 990], [990, 1010]],
    upperRightBranch: [[790, 845], [850, 828], [900, 800], [945, 775], [975, 748], [1002, 716], [1022, 696]],
  };
  const SH_TAPES = [
    // [x0,y0,x1,y1, dashOn, dashOff]  (dashOn=0 -> solid)
    [640, 725, 322, 828, 0.20, 0.09],
    [668, 745, 606, 950, 0, 0],
    [742, 722, 950, 905, 0, 0],
  ];
  const SH_DISCS = [[262, 808, 0.07], [629, 887, 0.07], [805, 1145, 0.07]];
  const SH_PADS = [[432, 388, 'round', 0.19], [612, 268, 'round', 0.16], [740, 325, 'square', 0.34]];
  const SH_PLUGS = [[1060, 418, 0.34, 0.036, 0x4b5960], [930, 650, 0.34, 0.03, 0x121817], [1072, 962, 0.34, 0.03, 0x0d1211], [1010, 1085, 0.30, 0.03, 0x10161a]];

  function buildHeatShield() {
    const root = new THREE.Group(); root.name = 'heatShield';
    const content = new THREE.Group(); content.name = 'heatShieldContent'; root.add(content);
    const stats = { tris: 0 };
    const meshes = [];
    function addMesh(geo, mat, name, o) {
      const m = new THREE.Mesh(geo, mat); m.name = name || '';
      m.castShadow = !(o && o.noCast); m.receiveShadow = !!(o && o.receive);
      content.add(m); meshes.push(m);
      stats.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      return m;
    }

    // ---- materials
    const matPica = procMat('pica', std(0xffffff, 0.93, 0.0));
    const matFoil = procMat('shieldFoil', std(0xffffff, 0.4, 0.0), { sheenK: 0.30 });
    const matDark = std(0x1c130d, 0.85, 0);
    const matBand = std(0x050607, 0.7, 0);
    const matCream = std(0xd8cd98, 0.55, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const matOrange = std(0xc4571f, 0.55, 0, { emissive: 0x160500 });
    const matClip = std(0xe9dcb0, 0.55, 0);
    const matWhite = std(0xd9d8c0, 0.5, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const matFrost = std(0x9db4a8, 0.22, 0.0, { transparent: false });
    const matPlug = std(0x3d474d, 0.7, 0);
    const matBoss = std(0x1c2524, 0.35, 0.2);
    const matSilver = std(0x8f9698, 0.42, 0.75);
    const matBlack = std(0x08090a, 0.6, 0.1);
    const matPocket = std(0x0a1012, 0.5, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const matLip = std(0x1a2226, 0.5, 0.3);

    // ---- outer (PICA) surface
    const rs = [0, 0.05, 0.11, 0.18, 0.26, 0.33, HS.rt];
    for (let r = HS.rt + 0.22; r < R - 0.01; r += 0.22) rs.push(r);
    rs.push(R);
    const outerPts = rs.map((r) => [r, yOut(r)]);
    addMesh(revolve(outerPts, 160, false), matPica, 'shieldOuter');
    addMesh(revolve([[R, yOut(R)], [R, -0.02], [R - 0.004, 0.0]], 160, false), matDark, 'shieldEdge');

    // ---- inner foil surface (procedural blanket)
    const rin = [0, 0.05, 0.11, 0.18, 0.26, 0.33, HS.rt];
    for (let r = HS.rt + 0.2; r < R - HS.band - 0.01; r += 0.2) rin.push(r);
    rin.push(R - HS.band);
    addMesh(revolve(rin.map((r) => [r, yIn(r)]), 200, true), matFoil, 'shieldFoil');

    // ---- rim: black band, cream ring, dark outline
    const rb0 = R - HS.band, rb1 = R - HS.ring, rc1 = R - HS.edge;
    addMesh(revolve([[rb0, yIn(rb0)], [rb1, yIn(rb1)]], 200, true), matBand, 'rimBand');
    addMesh(revolve([[rb1, yIn(rb1)], [rb1 + 0.004, yIn(rb1) + 0.006], [rc1 - 0.004, yIn(rc1) + 0.006], [rc1, yIn(rc1)]], 200, true), matCream, 'rimCream');
    addMesh(revolve([[rc1, yIn(rc1)], [R - 0.004, yIn(R) + 0.001], [R, yIn(R)]], 200, true), matDark, 'rimOutline');

    // ---- helpers to lay things on the inner surface
    const hwOrange = [], hwClip = [], hwCream = [], hwWhite = [], hwFrost = [], hwPlug = [], hwSilver = [], hwBlack = [], hwPocket = [], hwLip = [];
    function pxLift(px, py, lift) { const [x, z] = pxToXZ(px, py); const s = surfIn(x, z); return s.p.addScaledVector(s.n, lift); }

    // harness: orange tubes + cream clips + hex P-clamps
    function addPath(pxPts, radius, clipStep, clampStep, seedOff) {
      const c2 = pxPts.map((p) => { const [x, z] = pxToXZ(p[0], p[1]); return V3(x, 0, z); });
      const curve = new THREE.CatmullRomCurve3(c2, false, 'catmullrom', 0.5);
      const len = curve.getLength();
      const nS = Math.max(8, Math.round(len / 0.02));
      const sp = curve.getSpacedPoints(nS);
      const pts = [], nrm = [];
      for (const q of sp) { const s = surfIn(q.x, q.z); pts.push(s.p.clone().addScaledVector(s.n, radius + 0.002)); nrm.push(s.n); }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5), nS, radius, 6, false);
      hwOrange.push(tube);
      // clips
      const rng = U.rng(9001 + seedOff);
      let d = 0.03 + rng() * 0.03, acc = 0, dcl = 0.05;
      for (let i = 1; i < pts.length; i++) {
        const seg = pts[i].distanceTo(pts[i - 1]); acc += seg; dcl += seg;
        if (acc >= d) {
          acc = 0; d = clipStep * (0.85 + 0.3 * rng());
          const t = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
          const g = new THREE.CylinderGeometry(radius * 1.32, radius * 1.32, 0.026, 8, 1);
          g.rotateZ(Math.PI / 2); // axis along X
          const q = frameQuat(nrm[i], t);
          xf(g, pts[i].clone(), q);
          hwClip.push(g);
        }
        if (dcl >= clampStep) {
          dcl = 0;
          const t = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
          const g = new THREE.CylinderGeometry(radius * 2.5, radius * 2.5, 0.034, 6, 1);
          g.rotateZ(Math.PI / 2);
          xf(g, pts[i].clone(), frameQuat(nrm[i], t));
          hwClip.push(g);
        }
      }
    }
    let pid = 0;
    for (const k of Object.keys(SH_PATHS)) {
      const r = (k === 'serpentine' || k === 'coil' || k === 'loops') ? 0.0095 : 0.0085;
      addPath(SH_PATHS[k], r, 0.075, k === 'serpentine' ? 0.52 : 0.6, (pid++) * 17);
    }

    // cream tapes (2.6 cm) and circular seams
    function addTapeLine(x0, y0, x1, y1, on, off) {
      const total = Math.hypot(x1 - x0, y1 - y0) * PXM;
      const step = 0.02;
      let s = 0;
      const seg = [];
      const flush = () => {
        if (seg.length > 1) {
          const pts = seg.map((p) => p.p), nn = seg.map((p) => p.n);
          hwCream.push(ribbon(pts, nn, 0.026, 0.0025));
        }
        seg.length = 0;
      };
      let phase = 0; let isOn = true; let lastToggle = 0;
      while (s <= total + 1e-6) {
        const f = s / total, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
        if (on > 0) {
          const per = on + off; const m = s % per; const wantOn = m < on || f > 0.55;
          if (wantOn !== isOn) { flush(); isOn = wantOn; }
        }
        if (isOn) { const [x, z] = pxToXZ(px, py); const sf = surfIn(x, z); seg.push({ p: sf.p, n: sf.n }); }
        s += step;
      }
      flush();
    }
    for (const t of SH_TAPES) addTapeLine(t[0], t[1], t[2], t[3], t[4], t[5]);
    // dashes / flags near the lower right
    for (const f of [[884, 764, 916, 792], [910, 796, 934, 806], [1000, 748, 1010, 738]]) addTapeLine(f[0], f[1], f[2], f[3], 0, 0);
    function addArc(cx, cy, rad, a0, a1, width, lift) {
      const pts = [], nn = [];
      const n = Math.max(12, Math.round(Math.abs(a1 - a0) * rad * PXM / 0.02));
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        const [x, z] = pxToXZ(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); const s = surfIn(x, z);
        pts.push(s.p); nn.push(s.n);
      }
      hwCream.push(ribbon(pts, nn, width, lift));
    }
    addArc(700, 700, 362, 143 * DEG, 206 * DEG, 0.016, 0.0025);
    addArc(700, 700, 344, 210 * DEG, 232 * DEG, 0.010, 0.0025);
    addArc(718, 735, 114, 0, TAU, 0.010, 0.0025);
    addArc(718, 735, 120, 0.3, 1.6, 0.007, 0.0025);

    // boss (dark dome) with a small bright cap
    {
      const pts = [[0, 0.115]];
      for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI * 0.5; pts.push([0.215 * Math.sin(a), 0.115 * Math.cos(a)]); }
      pts.push([0.235, -0.01]);
      const g = revolve(pts, 64, true);
      const s = surfIn(0, 0);
      g.translate(0, s.p.y + 0.004, 0);
      hwBlack.push(g);
      const flange = revolve([[0.215, -0.003], [0.255, 0.004], [0.27, 0.0]], 64, true); flange.translate(0, s.p.y + 0.003, 0);
      hwPocket.push(flange);
      const cap = new THREE.CylinderGeometry(0.05, 0.05, 0.008, 20);
      const [cx, cz] = pxToXZ(716, 706); const sc = surfIn(cx, cz);
      cap.translate(sc.p.x, s.p.y + 0.108, sc.p.z);
      hwWhite.push(cap);
    }
    // heart-shaped recess: two overlapping dark pockets with a raised lip
    for (const c of [[415, 646, 52], [490, 702, 47]]) {
      const [x, z] = pxToXZ(c[0], c[1]); const s = surfIn(x, z); const rad = c[2] * PXM;
      const disc = new THREE.CylinderGeometry(rad, rad, 0.006, 40);
      xf(disc, s.p.clone().addScaledVector(s.n, 0.004), frameQuat(s.n, s.er));
      hwPocket.push(disc);
      const lip = new THREE.TorusGeometry(rad, 0.009, 8, 40); lip.rotateX(Math.PI / 2);
      xf(lip, s.p.clone().addScaledVector(s.n, 0.006), frameQuat(s.n, s.er));
      hwLip.push(lip);
    }
    // three white / cream discs (0.14 m)
    for (const d of SH_DISCS) {
      const [x, z] = pxToXZ(d[0], d[1]); const s = surfIn(x, z);
      const g = new THREE.CylinderGeometry(d[2], d[2], 0.008, 28);
      xf(g, s.p.clone().addScaledVector(s.n, 0.004), frameQuat(s.n, s.er));
      hwWhite.push(g);
    }
    // frosted pads in the bright fan
    for (const p of SH_PADS) {
      const [x, z] = pxToXZ(p[0], p[1]); const s = surfIn(x, z);
      let g;
      if (p[2] === 'round') g = new THREE.CylinderGeometry(p[3], p[3] * 1.02, 0.016, 32);
      else g = new THREE.BoxGeometry(p[3], 0.016, p[3]);
      xf(g, s.p.clone().addScaledVector(s.n, 0.008), frameQuat(s.n, s.er));
      hwFrost.push(g);
    }
    // dark square plugs and the IC-like connector
    for (const p of SH_PLUGS) {
      const [x, z] = pxToXZ(p[0], p[1]); const s = surfIn(x, z);
      const g = new THREE.BoxGeometry(p[2], p[3], p[2] * 0.96);
      xf(g, s.p.clone().addScaledVector(s.n, p[3] * 0.5), frameQuat(s.n, s.er));
      const gg = g.clone();
      hwPlug.push(g);
      if (p[4] !== 0x4b5960) { /* darker plugs use the black material */ hwPlug.pop(); hwBlack.push(gg); }
    }
    {
      const [x, z] = pxToXZ(1140, 690); const s = surfIn(x, z); const q = frameQuat(s.n, s.er);
      const body = new THREE.BoxGeometry(0.33, 0.04, 0.2); xf(body, s.p.clone().addScaledVector(s.n, 0.02), q); hwBlack.push(body);
      for (let i = 0; i < 12; i++) for (const side of [-1, 1]) {
        const pin = new THREE.BoxGeometry(0.012, 0.008, 0.03);
        const lp = V3(-0.15 + i * 0.027, 0.006, side * 0.115).applyQuaternion(q).add(s.p).addScaledVector(s.n, 0.02);
        xf(pin, lp, q); hwSilver.push(pin);
      }
    }
    // nine hardware boxes every 40 deg at rho 0.86 R (bracket + eyelet + bolt)
    for (let i = 0; i < 9; i++) {
      const a = (181 - 40 * i) * DEG;
      const [x, z] = pxToXZ(700 + Math.cos(a) * 563, 700 + Math.sin(a) * 563); const s = surfIn(x, z);
      const q = frameQuat(s.n, s.er);
      const box = new THREE.BoxGeometry(0.20, 0.05, 0.17); xf(box, s.p.clone().addScaledVector(s.n, 0.025), q); hwSilver.push(box);
      const top = new THREE.BoxGeometry(0.13, 0.03, 0.10); xf(top, V3(0.02, 0.06, 0).applyQuaternion(q).add(s.p), q); hwSilver.push(top);
      const eye = new THREE.TorusGeometry(0.03, 0.007, 8, 16); eye.rotateX(Math.PI / 2);
      xf(eye, V3(-0.085, 0.056, 0.065).applyQuaternion(q).add(s.p), q); hwSilver.push(eye);
      const bolt = new THREE.CylinderGeometry(0.014, 0.014, 0.03, 10);
      xf(bolt, V3(0.06, 0.08, -0.05).applyQuaternion(q).add(s.p), q); hwSilver.push(bolt);
    }
    // tiny dark gouges near the rim (upper left) as seen in the reference
    for (const p of [[270, 292, 0.03], [214, 268, 0.022], [116, 640, 0.026], [122, 662, 0.02]]) {
      const [x, z] = pxToXZ(p[0], p[1]); const s = surfIn(x, z);
      const g = new THREE.CylinderGeometry(p[2], p[2], 0.006, 12); xf(g, s.p.clone().addScaledVector(s.n, 0.003), frameQuat(s.n, s.er)); hwBlack.push(g);
    }

    const add = (list, mat, name, o) => { if (list.length) addMesh(merge(list), mat, name, o); };
    add(hwOrange, matOrange, 'harness');
    add(hwClip, matClip, 'harnessClips');
    add(hwCream, matCream, 'tapes');
    add(hwWhite, matWhite, 'whiteDiscs');
    add(hwFrost, matFrost, 'frostedPads');
    add(hwPlug, matPlug, 'plugs');
    add(hwSilver, matSilver, 'hwBoxes');
    add(hwBlack, matBoss, 'boss');
    add(hwPocket, matPocket, 'pockets');
    add(hwLip, matLip, 'lips');

    // ---- MEDLI2 pressure ports on the outer surface (7)
    {
      const g = [];
      const ports = [[0, 0], [0.55, 0.3], [0.55, 2.4], [1.0, 4.4], [1.0, 1.4], [1.5, 3.4], [1.5, 5.6]];
      for (const p of ports) {
        const r = p[0], a = p[1], x = r * Math.cos(a), z = r * Math.sin(a);
        const d = dhOf(r); const er = r > 1e-6 ? V3(x / r, 0, z / r) : V3(1, 0, 0);
        const n = V3(d * er.x, -1, d * er.z).normalize();
        const plug = new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16);
        xf(plug, V3(x, yOut(r), z).addScaledVector(n, 0.002), frameQuat(n, er));
        g.push(plug);
      }
      addMesh(merge(g), std(0x2a2724, 0.6, 0.4), 'medli2Ports');
    }

    return { root, content, stats, meshes, procMats: [matPica, matFoil] };
  }

  /* ------------------------------------------------------------------ BACKSHELL */
  // outer profile, base ring (y = 0) -> PCC top, [r, y]
  const BS_SHELL = chaikin([[2.25, 0.0], [2.25, 0.10], [2.215, 0.17], [1.34, 1.20], [0.72, 2.42]], 3);
  const BS_PCC = [[0.72, 2.42], [0.78, 2.455], [0.78, 2.52], [0.64, 2.565], [0.585, 2.63], [0.548, 2.94], [0.572, 2.962], [0.572, 3.0]];
  function polyNormalAt(pts, i) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tr = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tr, ty) || 1; tr /= l; ty /= l;
    return [ty, -tr]; // outward for a base->top profile
  }
  function shellR(y) {
    const P = BS_SHELL;
    for (let i = 0; i < P.length - 1; i++) if (y >= P[i][1] && y <= P[i + 1][1]) { const f = (y - P[i][1]) / ((P[i + 1][1] - P[i][1]) || 1); return P[i][0] + (P[i + 1][0] - P[i][0]) * f; }
    return P[P.length - 1][0];
  }
  /** local frame on the outer shell at azimuth az (rad) and height y */
  function bsFrameAt(az, y) {
    const r = shellR(y), e = 0.01;
    const r1 = shellR(y + e), r0 = shellR(y - e);
    const tr = (r1 - r0) / (2 * e), ty = 1; const l = Math.hypot(tr, ty);
    const nr = ty / l, ny = -tr / l;
    const er = V3(Math.cos(az), 0, Math.sin(az));
    const p = V3(r * er.x, y, r * er.z);
    const n = er.clone().multiplyScalar(nr).add(V3(0, ny, 0)).normalize();
    const tUp = er.clone().multiplyScalar(tr / l).add(V3(0, ty / l, 0)).normalize();
    const tTan = new THREE.Vector3().crossVectors(V3(0, 1, 0), er).normalize();
    return { p, n, tUp, tTan, er, r };
  }
  function basisQuat(x, y, z) { return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); }

  function buildBackshell() {
    const root = new THREE.Group(); root.name = 'backshell';
    const stats = { tris: 0 };
    const meshes = [];
    function addMesh(geo, mat, name, o) {
      const m = new THREE.Mesh(geo, mat); m.name = name || '';
      m.castShadow = !(o && o.noCast); m.receiveShadow = !(o && o.noReceive);
      (o && o.parent || root).add(m); meshes.push(m);
      stats.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      return m;
    }
    const matShell = procMat('bsOuter', std(0xffffff, 0.6, 0.0));
    const matIn = procMat('bsInner', std(0xffffff, 0.85, 0.0), {});
    const matPCC = std(0x8e8a80, 0.78, 0.0);
    const matLid = std(0x232427, 0.7, 0.15);
    const matNoz = std(0x33353a, 0.4, 0.8);
    const matAlu = std(0xa3a8ac, 0.4, 0.85);
    const matDkM = std(0x2b2d30, 0.55, 0.6);
    const matMass = std(0x38393c, 0.35, 0.9);
    const matBore = std(0x050506, 0.9, 0.0);
    const matPocket = std(0x0d0e10, 0.8, 0.0);
    const matBolt = std(0x6b6f72, 0.45, 0.8);
    const matBase = std(0x2a2b2e, 0.6, 0.5);

    // ---- outer shell + PCC neck
    addMesh(revolve(BS_SHELL, 200, false), matShell, 'bsShell');
    addMesh(revolve(BS_PCC, 96, false), matPCC, 'pcc');
    // base ring (bottom annulus, seen from below when the heat shield is gone)
    addMesh(revolve([[2.25, 0.0], [2.20, 0.0]], 160, true), matBase, 'bsBaseFace');   // outer lip of the interface plate, faces down
    // ---- inner surface
    const inner = [];
    for (let i = 0; i < BS_SHELL.length; i++) {
      const n = polyNormalAt(BS_SHELL, i);
      inner.push([BS_SHELL[i][0] - BS.thick * n[0], BS_SHELL[i][1] - BS.thick * n[1]]);
    }
    // keep monotonic y, clamp the bottom to the base plane
    const innerPts = inner.filter((p, i) => i === 0 || p[1] > inner[i - 1][1] - 1e-6);
    innerPts[0] = [2.20, 0.0];
    innerPts.push([0.60, 2.40], [0.50, 2.46], [0.50, 2.95]);
    addMesh(revolve(innerPts, 200, true), matIn, 'bsInner');
    // mortar bore cap (seen after the lid is gone) + lid seat ring
    {
      const cap = revolve([[0.0, 2.955], [0.5, 2.955]], 48, true); cap.scale(1, 1, 1);
      addMesh(cap, matBore, 'boreCap');
    }

    // ---- interior structure: meridional ribs, ring stiffeners, separation ring + bolts, bridle fittings, mortar tube
    {
      const rib = [];
      for (let k = 0; k < 12; k++) {
        const az = (k / 12) * TAU + 0.13, pts = [], nn = [];
        for (let i = 0; i < innerPts.length - 3; i++) {
          const ip = innerPts[i]; if (ip[1] < 0.16) continue;
          const n2 = polyNormalAt(innerPts, i);
          const er = V3(Math.cos(az), 0, Math.sin(az));
          const nIn = er.clone().multiplyScalar(-n2[0]).add(V3(0, -n2[1], 0)).normalize();
          pts.push(V3(ip[0] * er.x, ip[1], ip[0] * er.z)); nn.push(nIn);
        }
        rib.push(ribbon(pts, nn, 0.07, 0.03));
        rib.push(ribbon(pts, nn, 0.045, 0.045));
      }
      const g = merge(rib);
      addMesh(g, matAlu, 'bsRibs', { noCast: true });
      // ring stiffeners
      const rings = [];
      for (const y of [0.55, 1.05, 1.55, 2.0]) {
        // find inner radius at y
        let r = 1;
        for (let i = 0; i < innerPts.length - 1; i++) if (y >= innerPts[i][1] && y <= innerPts[i + 1][1]) { const f = (y - innerPts[i][1]) / ((innerPts[i + 1][1] - innerPts[i][1]) || 1); r = innerPts[i][0] + (innerPts[i + 1][0] - innerPts[i][0]) * f; }
        const t = new THREE.TorusGeometry(r - 0.02, 0.028, 8, 120); t.rotateX(Math.PI / 2); t.translate(0, y, 0); rings.push(t);
      }
      addMesh(merge(rings), matAlu, 'bsRings', { noCast: true });
      // separation ring at the base (box section) with bolt heads
      const sepPts = [[1.93, 0.0], [2.20, 0.0]];
      const sr = [];
      sr.push(revolve([[2.20, 0.0], [1.93, 0.0]], 160, true));             // bottom face (normal down)
      sr.push(revolve([[1.93, 0.0], [1.93, 0.15]], 160, true));            // inner wall (normal inward)
      sr.push(revolve([[1.93, 0.15], [2.20, 0.15]], 160, true));           // top face (normal up)
      addMesh(merge(sr), matAlu, 'sepRing', { noCast: true });
      const bolts = [];
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU; const b = new THREE.CylinderGeometry(0.02, 0.02, 0.012, 8);
        xf(b, V3(Math.cos(a) * 2.07, -0.005, Math.sin(a) * 2.07), _q.identity()); bolts.push(b.clone());
      }
      for (let i = 0; i < 36; i++) {
        const a = ((i + 0.5) / 36) * TAU; const b = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10);
        xf(b, V3(Math.cos(a) * 1.965, 0.075, Math.sin(a) * 1.965), _q.setFromAxisAngle(V3(0, 0, 1), Math.PI / 2).premultiply(_q.clone().setFromAxisAngle(V3(0, 1, 0), -a)));
        bolts.push(b.clone());
      }
      addMesh(merge(bolts), matBolt, 'sepBolts', { noCast: true });
      // three bridle fittings + mortar tube inside the PCC
      const fit = [];
      for (let k = 0; k < 3; k++) {
        const az = (k / 3) * TAU + 0.35;
        const b = new THREE.BoxGeometry(0.22, 0.34, 0.14);
        const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -az);
        xf(b, V3(Math.cos(az) * 0.66, 2.24, Math.sin(az) * 0.66), q); fit.push(b);
        const l1 = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10); l1.rotateX(Math.PI / 2);
        xf(l1, V3(Math.cos(az) * 0.66, 2.10, Math.sin(az) * 0.66), q); fit.push(l1);
        // strut down to the shell
        const a0 = V3(Math.cos(az) * 0.62, 2.12, Math.sin(az) * 0.62), a1 = V3(Math.cos(az) * 1.25, 1.18, Math.sin(az) * 1.25);
        const d = a1.clone().sub(a0), len = d.length();
        const st = new THREE.CylinderGeometry(0.035, 0.035, len, 8);
        xf(st, a0.clone().add(a1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
        fit.push(st);
      }
      addMesh(merge(fit), matDkM, 'bridleFittings', { noCast: true });
      const tube = revolve([[0.30, 2.28], [0.30, 2.94]], 40, true);
      addMesh(tube, matBore, 'mortarTube', { noCast: true });
      addMesh(revolve([[0.30, 2.28], [0.36, 2.28]], 40, true), matAlu, 'mortarLip', { noCast: true });
    }

    // ---- RCS thruster clusters (4 pods x 2 nozzles), MEDLI2 ports, balance mass pockets
    {
      const pods = [], nozz = [], ports = [], portRings = [];
      for (let k = 0; k < 4; k++) {
        const az = ((45 + 90 * k) * DEG);
        const f = bsFrameAt(az, 1.02);
        const q = basisQuat(f.tUp, f.n, f.tTan); // x = up slope, y = normal, z = ?
        // pod fairing
        const pod = new THREE.BoxGeometry(0.42, 0.06, 0.26);
        xf(pod, f.p.clone().addScaledVector(f.n, 0.02), q); pods.push(pod);
        const rim = new THREE.BoxGeometry(0.34, 0.03, 0.19);
        xf(rim, f.p.clone().addScaledVector(f.n, 0.055), q); pods.push(rim);
        for (const s of [-1, 1]) {
          const dir = f.n.clone().addScaledVector(f.tTan, 0.35 * s).addScaledVector(f.tUp, -0.15).normalize();
          const g = new THREE.CylinderGeometry(0.052, 0.027, 0.13, 14, 1, true);
          xf(g, f.p.clone().addScaledVector(f.n, 0.11).addScaledVector(f.tUp, s * 0.07).addScaledVector(f.tTan, s * 0.03), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir).clone());
          nozz.push(g);
          const th = new THREE.CylinderGeometry(0.027, 0.027, 0.03, 10);
          xf(th, f.p.clone().addScaledVector(f.n, 0.05).addScaledVector(f.tUp, s * 0.07).addScaledVector(f.tTan, s * 0.03), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir).clone());
          nozz.push(th);
        }
      }
      addMesh(merge(pods), matDkM, 'rcsPods');
      addMesh(merge(nozz), matNoz, 'rcsNozzles', { noReceive: false });
      const medli = [[20, 0.72], [78, 0.80], [152, 0.70], [205, 0.93], [258, 0.74], [300, 0.98], [338, 0.58], [112, 1.72], [232, 1.66], [322, 1.58]];
      for (const m of medli) {
        const f = bsFrameAt(m[0] * DEG, m[1]);
        const q = frameQuat(f.n, f.tUp);
        const d = new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16); xf(d, f.p.clone().addScaledVector(f.n, 0.003), q); ports.push(d);
        const t = new THREE.TorusGeometry(0.035, 0.005, 6, 16); t.rotateX(Math.PI / 2); xf(t, f.p.clone().addScaledVector(f.n, 0.004), q); portRings.push(t);
      }
      addMesh(merge(ports), matBore, 'medli2Ports', { noCast: true });
      addMesh(merge(portRings), matAlu, 'medli2Rings', { noCast: true });
    }
    // balance-mass pockets (frame + dark floor); the masses themselves are separate movable meshes
    const massPocket = [];
    const massMeshes = [];
    const MASS = { az: [90 * DEG, 270 * DEG], y: 0.86, size: [0.46, 0.15, 0.30] };
    {
      const pk = [], fl = [];
      for (const az of MASS.az) {
        const f = bsFrameAt(az, MASS.y);
        const q = basisQuat(f.tUp, f.n, f.tTan);
        const W = 0.56, Hh = 0.40;
        const floor_ = new THREE.BoxGeometry(W, 0.02, Hh); xf(floor_, f.p.clone().addScaledVector(f.n, 0.004), q); fl.push(floor_);
        for (const [dx, dz, sx, sz] of [[0, Hh / 2, W + 0.04, 0.03], [0, -Hh / 2, W + 0.04, 0.03], [W / 2, 0, 0.03, Hh], [-W / 2, 0, 0.03, Hh]]) {
          const b = new THREE.BoxGeometry(sx, 0.05, sz);
          xf(b, f.p.clone().addScaledVector(f.n, 0.02).addScaledVector(f.tUp, dx).addScaledVector(f.tTan, dz), q); pk.push(b);
        }
        // bolts on the frame corners
        for (const [dx, dz] of [[W / 2, Hh / 2], [-W / 2, Hh / 2], [W / 2, -Hh / 2], [-W / 2, -Hh / 2]]) {
          const b = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8); xf(b, f.p.clone().addScaledVector(f.n, 0.05).addScaledVector(f.tUp, dx).addScaledVector(f.tTan, dz), q); pk.push(b);
        }
      }
      addMesh(merge(pk), matDkM, 'massFrames');
      addMesh(merge(fl), matPocket, 'massPockets');
      for (let i = 0; i < 2; i++) {
        const g = new THREE.BoxGeometry(MASS.size[0], MASS.size[1], MASS.size[2]);
        const m = new THREE.Mesh(g, matMass); m.name = 'entryBalanceMass' + i; m.castShadow = true; root.add(m); massMeshes.push(m);
        // rest pose (seated in the pocket)
        const f = bsFrameAt(MASS.az[i], MASS.y);
        m.userData.restPos = f.p.clone().addScaledVector(f.n, 0.03 + MASS.size[1] * 0.5);
        m.userData.restQuat = basisQuat(f.tUp, f.n, f.tTan);
        m.userData.outDir = f.n.clone();
        m.userData.az = MASS.az[i];
      }
    }

    // ---- PCC lid (jettisoned at mortar fire) and small fragments
    const lidGroup = new THREE.Group(); lidGroup.name = 'pccLid'; root.add(lidGroup);
    const lidPieces = [];
    {
      const pts = [[0, 0.05], [0.18, 0.047], [0.36, 0.036], [0.50, 0.018], [BS.lidR, 0.0], [BS.lidR, -0.03], [0.0, -0.03]];
      const lid = revolve(pts, 72, true);
      const lm = new THREE.Mesh(lid, matLid); lm.castShadow = true; lm.position.set(0, BS.pccTopY + 0.0, 0); lidGroup.add(lm);
      // concentric stiffening rings + centre boss
      const g = [];
      for (const r of [0.2, 0.35, 0.47]) { const t = new THREE.TorusGeometry(r, 0.006, 6, 72); t.rotateX(Math.PI / 2); t.translate(0, 0.045 - r * 0.09, 0); g.push(t); }
      const boss = new THREE.CylinderGeometry(0.06, 0.07, 0.03, 20); boss.translate(0, 0.06, 0); g.push(boss);
      const rm = new THREE.Mesh(merge(g), matDkM); rm.position.set(0, BS.pccTopY, 0); lidGroup.add(rm);
      lidPieces.push({ mesh: lidGroup, kind: 'lid' });
      stats.tris += lid.index.count / 3;
      // radome fragments (3 small shards) that fly with the lid
      for (let i = 0; i < 3; i++) {
        const sh = new THREE.BoxGeometry(0.14 + 0.05 * i, 0.012, 0.09 + 0.03 * i);
        const m = new THREE.Mesh(sh, i === 1 ? matPCC : matLid); m.castShadow = true; root.add(m); lidPieces.push({ mesh: m, kind: 'shard', i });
      }
    }
    stats.meshes = meshes;
    return { root, stats, massMeshes, MASS, lidGroup, lidPieces, meshes, procMats: [matShell, matIn], innerPts };
  }

  /* ------------------------------------------------------------------ PARACHUTE SUPPORT STRUCTURE + PUC CAMERAS */
  const PSS = {
    lugR: 0.80, lugY: 2.52,      // bridle leg feet on the PCC flange
    topR: 0.14, topY: 5.35,      // leg tops (confluence fitting); the chute module continues from here
    legAz0: 0.35,                // azimuth of leg 0 (rad)
    legW: 0.12,                  // strap pitch inside a leg bundle
    cam: [                       // PUC mounts: azimuth (deg), radius, height, roll (deg)
      { id: 'pucA', az: 8, r: 0.52, y: 3.14, roll: 0 },
      { id: 'pucB', az: 134, r: 0.52, y: 3.14, roll: 0 },
    ],
  };

  /** corrugated sleeve (ribbed charcoal column) along +Y from 0..len */
  function corrTube(len, r0, amp, pitch, seg) {
    const pts = [[0, 0], [r0 * 0.85, 0]];
    const n = Math.max(4, Math.round(len / pitch * 6));
    for (let i = 0; i <= n; i++) { const y = (i / n) * len; pts.push([r0 + amp * (0.5 + 0.5 * Math.sin((y / pitch) * TAU)), y]); }
    pts.push([r0 * 0.85, len], [0, len]);
    return revolve(pts, seg, false);
  }
  function helixCord(a, b, radius, turnsPerM, tubeR) {
    const d = b.clone().sub(a), len = d.length(); d.normalize();
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(d, u).normalize();
    const pts = []; const n = Math.max(12, Math.round(len * turnsPerM * 10));
    for (let i = 0; i <= n; i++) {
      const f = i / n, ph = f * len * turnsPerM * TAU;
      pts.push(a.clone().addScaledVector(d, f * len).addScaledVector(u, Math.cos(ph) * radius).addScaledVector(v, Math.sin(ph) * radius));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, tubeR, 5, false);
  }
  function camMount(spec, targetDist) {
    const az = spec.az * DEG;
    const pos = V3(Math.cos(az) * spec.r, spec.y, Math.sin(az) * spec.r);
    const target = V3(0, spec.y + targetDist, 0);
    const f = target.clone().sub(pos).normalize();                   // look toward the canopy hub (on the chute axis)
    const er = V3(Math.cos(az), 0, Math.sin(az));
    let x = er.clone().sub(f.clone().multiplyScalar(er.dot(f))).normalize();   // image right = radially outward
    const zc = f.clone().negate();
    if (spec.roll) x.applyAxisAngle(f, spec.roll * DEG);
    const y = new THREE.Vector3().crossVectors(zc, x).normalize();
    return { pos, quat: basisQuat(x, y, zc), az };
  }

  function buildPSS(bsRoot) {
    const group = new THREE.Group(); group.name = 'parachuteSupportStructure'; bsRoot.add(group);
    const stats = { tris: 0 };
    const matSleeve = std(0x1e1f26, 0.9, 0.0);
    const matDark = std(0x121318, 0.85, 0.1);
    const matFoil = procMat('foilPatch', std(0xffffff, 0.35, 0.9), { tint: 0xa8b0c4 });
    const matAlu = std(0xb4b8bd, 0.32, 0.9);
    const matWedge = std(0x8d919b, 0.5, 0.15);
    const matCord = std(0x0b0b0d, 0.8, 0.0);
    const matWrap = std(0x5a4632, 0.85, 0.0);
    const matCam = std(0x0e0f11, 0.45, 0.5);
    const matGlass = std(0x0a1020, 0.15, 0.3);
    const matBrown = std(0x2b211b, 0.9, 0.0);
    function add(geo, mat, name, parent, noCast) {
      const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = !noCast; m.receiveShadow = true; (parent || group).add(m);
      stats.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; return m;
    }
    const tops = [], feet = [];
    const sleeves = [], wraps = [], hw = [], foil = [], alu = [], wedge = [], cords = [], brown = [];
    for (let k = 0; k < 3; k++) {
      const az = PSS.legAz0 + (k / 3) * TAU;
      const er = V3(Math.cos(az), 0, Math.sin(az)), et = V3(-Math.sin(az), 0, Math.cos(az));
      const foot = V3(er.x * PSS.lugR, PSS.lugY, er.z * PSS.lugR), top = V3(er.x * PSS.topR, PSS.topY, er.z * PSS.topR);
      feet.push(foot); tops.push(top);
      const dir = top.clone().sub(foot); const len = dir.length(); dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
      // side vector of the bundle (tangential, perpendicular to the leg)
      const side = et.clone().sub(dir.clone().multiplyScalar(et.dot(dir))).normalize();
      // 3 straps per leg
      for (let s = -1; s <= 1; s++) {
        const g = corrTube(len - 0.25, 0.058, 0.007, 0.032, 10);
        const start = foot.clone().addScaledVector(dir, 0.16).addScaledVector(side, s * PSS.legW);
        xf(g, start, q); sleeves.push(g);
      }
      // helical wrap cord around the bundle
      wraps.push(helixCord(foot.clone().addScaledVector(dir, 0.35), foot.clone().addScaledVector(dir, len - 0.3), 0.2, 3.2, 0.008));
      // foot bracket: boxy dark clevis block + crinkled foil patch on its outer face
      const qb = basisQuat(side, dir, new THREE.Vector3().crossVectors(side, dir).normalize());
      const blk = new THREE.BoxGeometry(0.46, 0.26, 0.24); xf(blk, foot.clone().addScaledVector(dir, 0.07), qb); hw.push(blk);
      const plate = new THREE.BoxGeometry(0.5, 0.05, 0.3); xf(plate, foot.clone().addScaledVector(dir, -0.09), qb); hw.push(plate);
      const patch = new THREE.PlaneGeometry(0.16, 0.2, 1, 1);
      const nrm = new THREE.Vector3().crossVectors(side, dir).normalize();
      xf(patch, foot.clone().addScaledVector(dir, 0.07).addScaledVector(nrm, 0.125).addScaledVector(side, -0.05), basisQuat(side, dir, nrm)); foil.push(patch);
      // brace strut (metal beam) from the foot down to the upper cone
      const b0 = foot.clone().addScaledVector(er, -0.02), b1 = V3(er.x * 1.28, 1.16, er.z * 1.28);
      const bd = b1.clone().sub(b0), bl = bd.length(); bd.normalize();
      const beam = new THREE.BoxGeometry(0.075, bl, 0.032);
      xf(beam, b0.clone().add(b1).multiplyScalar(0.5), basisQuat(et.clone(), bd.clone(), new THREE.Vector3().crossVectors(et, bd).normalize())); alu.push(beam);
      // pale grey rounded wedge fitting where the riser attaches near the top
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.30, 0.02); sh.quadraticCurveTo(0.34, 0.10, 0.25, 0.20); sh.lineTo(0.02, 0.30); sh.quadraticCurveTo(-0.04, 0.12, 0, 0);
      const wg = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 8 });
      wg.translate(-0.15, -0.15, -0.07);
      xf(wg, top.clone().addScaledVector(dir, -0.42).addScaledVector(er, 0.10), basisQuat(side, dir, new THREE.Vector3().crossVectors(side, dir).normalize())); wedge.push(wg);
      // top ring / riser attach eye
      const eye = new THREE.TorusGeometry(0.075, 0.02, 8, 24); xf(eye, top.clone().addScaledVector(dir, 0.02), basisQuat(side, dir, new THREE.Vector3().crossVectors(side, dir).normalize())); alu.push(eye);
      // frayed black cords near the bracket
      const rng = U.rng(4040 + k);
      for (let i = 0; i < 5; i++) {
        const base = foot.clone().addScaledVector(dir, 0.25 + rng() * 0.9).addScaledVector(side, (rng() - 0.5) * 0.4);
        const pts = [base.clone()];
        let cur = base.clone(); const heading = side.clone().multiplyScalar((rng() < 0.5 ? -1 : 1)).addScaledVector(dir, (rng() - 0.5) * 0.7).addScaledVector(nrm, (rng() - 0.3) * 0.6).normalize();
        for (let j = 0; j < 5; j++) { heading.add(V3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.8)).normalize(); cur = cur.clone().addScaledVector(heading, 0.05 + 0.03 * rng()); pts.push(cur); }
        cords.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0055, 4, false));
      }
      // irregular dark-brown structure below the bracket (PCC-side mount blocks)
      const bb = new THREE.BoxGeometry(0.5, 0.12, 0.34); xf(bb, foot.clone().addScaledVector(dir, -0.2).addScaledVector(er, -0.08), basisQuat(side, dir, new THREE.Vector3().crossVectors(side, dir).normalize())); brown.push(bb);
    }
    add(merge(sleeves), matSleeve, 'bridleSleeves');
    add(merge(wraps), matWrap, 'bridleWraps');
    add(merge(hw), matDark, 'bridleBrackets');
    add(merge(foil), matFoil, 'foilPatches');
    add(merge(alu), matAlu, 'metalBeams');
    add(merge(wedge), matWedge, 'wedgeFittings');
    add(merge(cords), matCord, 'frayedCords', null, true);
    add(merge(brown), matBrown, 'mountBlocks');
    // confluence hub disc at the top (three tops meet here)
    const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20); hub.translate(0, PSS.topY + 0.1, 0); add(hub, matDark, 'hub');

    // ---- PUC camera bodies + posts
    const mounts = {}; const camBodies = [];
    for (const spec of PSS.cam) {
      const mt = camMount(spec, 44);
      mounts[spec.id] = { pos: mt.pos.clone(), quat: mt.quat.clone() };
      const cg = new THREE.Group(); cg.name = spec.id + 'Body'; cg.position.copy(mt.pos); cg.quaternion.copy(mt.quat); group.add(cg);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.075, 0.08), matCam); body.position.set(0, 0, 0.045); body.castShadow = true; cg.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.027, 0.032, 18), matAlu); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -0.008); cg.add(barrel);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.018, 16), matGlass); glass.position.set(0, 0, -0.0245); glass.rotation.y = Math.PI; cg.add(glass);
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.03, 18, 1, true), matDark); hood.rotation.x = Math.PI / 2; hood.position.set(0, 0, -0.03); cg.add(hood);
      // post from the PCC flange top to the camera
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, spec.y - 3.0 + 0.04, 10), matAlu); post.position.set(mt.pos.x, (spec.y + 3.0) / 2 - 0.02, mt.pos.z); group.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14), matDark); foot.position.set(mt.pos.x, 3.02, mt.pos.z); group.add(foot);
      camBodies.push(cg);
      stats.tris += 400;
    }
    return { group, stats, tops, feet, mounts, camBodies };
  }

  /* ------------------------------------------------------------------ debris specks released with the heat shield (heatshield_report sec.6) */
  // image tracks in half-res picture coordinates (1134x904): [t, x_pf, y_pf]; from heatshield_track.json debris_specks
  const SPECKS = [
    { name: 'A', size: [0.10, 0.06], col: 0xf2c8b0, tr: [[33.033, 876.0, 552.0], [33.1, 876.5, 545.0], [33.167, 885.5, 539.3], [33.233, 901.1, 535.4], [33.3, 923.0, 533.5], [33.367, 952.4, 532.3], [33.433, 985.4, 533.3], [33.5, 1023.7, 536.0], [33.567, 1066.1, 540.6], [33.633, 1110.7, 546.4]] },
    { name: 'B', size: [0.09, 0.05], col: 0xffe2cf, tr: [[32.733, 985.0, 747.0], [32.8, 960.2, 738.2], [32.9, 926.7, 724.9], [32.967, 911.3, 714.8], [33.033, 904.4, 704.3], [33.1, 921.0, 695.5], [33.167, 945.7, 687.8], [33.233, 978.5, 690.0], [33.3, 1016.0, 694.0], [33.367, 1062.0, 682.0], [33.433, 1130.0, 674.0]] },
    { name: 'C', size: [0.10, 0.05], col: 0xeac4af, tr: [[33.97, 695.0, 418.0], [34.13, 688.0, 412.0], [34.3, 700.0, 390.0], [34.4, 717.0, 370.0], [34.57, 744.0, 310.0], [34.7, 765.0, 248.0], [34.83, 783.0, 163.0], [34.87, 794.0, 114.0], [34.9, 814.0, 28.0]] },
  ];
  const RDC_F_PF = 567 / Math.tan(15.9 * DEG);   // focal length in half-res picture pixels (HFOV 31.8 deg over 1134 px)

  /* ------------------------------------------------------------------ module factory */
  EDL.registerModule('capsule', function factory(ctx) {
    const flight = ctx.modules && ctx.modules.flight;
    const T = C.t;
    const group = new THREE.Group(); group.name = 'capsule';

    // --- stack offsets: the backshell base ring IS the heat-shield rim plane; chute attach = confluence fitting at the leg tops
    const rim = C.stack.heatShield.origin.slice();
    C.stack.backshell = C.stack.backshell || { origin: [0, 0, 0] };
    C.stack.backshell.origin = [rim[0], rim[1], rim[2]];
    C.stack.chuteAttach = C.stack.chuteAttach || { origin: [0, 0, 0] };
    C.stack.chuteAttach.origin = [rim[0], rim[1] + PSS.topY, rim[2]];
    const dsDeckAboveRim = (C.stack.descentStage ? C.stack.descentStage.origin[1] : 0) - rim[1];

    const hs = buildHeatShield();
    const bs = buildBackshell();
    const pss = buildPSS(bs.root);
    group.add(hs.root); group.add(bs.root);

    // --- debris specks (InstancedMesh, world space)
    const speckGeo = new THREE.BoxGeometry(1, 0.35, 1);
    const speckMat = new THREE.MeshStandardMaterial({ color: 0xffd9c0, roughness: 0.6, emissive: 0x552a18 });
    const specks = new THREE.InstancedMesh(speckGeo, speckMat, SPECKS.length); specks.frustumCulled = false; specks.name = 'heatShieldDebris';
    specks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < SPECKS.length; i++) specks.setColorAt(i, new THREE.Color(SPECKS[i].col));
    group.add(specks);
    const speckTracks = SPECKS.map((s) => ({ u: new U.Track(s.tr.map((r) => [r[0], r[1]]), { mode: 'cubic' }), v: new U.Track(s.tr.map((r) => [r[0], r[2]]), { mode: 'cubic' }), t0: s.tr[0][0], t1: s.tr[s.tr.length - 1][0] }));

    // --- state helpers
    const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion(), qD = new THREE.Quaternion();
    const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
    const qStack = new THREE.Quaternion();
    const defaultHS = { pos: [rim[0], rim[1], rim[2]], quat: [0, 0, 0, 1], visible: true };
    const defaultBS = { pos: [rim[0], rim[1], rim[2]], quat: [0, 0, 0, 1], visible: true };
    // frames of the backshell at the instants of the entry-balance-mass ejections and the lid jettison (cached, deterministic)
    const T_MASS = [1.0, 1.6], T_LID = T.chuteDeploy;
    const ejectQ = { m0: new THREE.Quaternion(), m1: new THREE.Quaternion(), lid: new THREE.Quaternion() };
    let ejectReady = false;
    function ensureEject() {
      if (ejectReady) return;
      ejectReady = true;
      try {
        if (flight && flight.state) {
          for (const [k, tt] of [['m0', T_MASS[0]], ['m1', T_MASS[1]], ['lid', T_LID]]) {
            const b = flight.state(tt).bodies.backshell;
            ejectQ[k].set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
          }
        }
      } catch (e) { /* keep identity */ }
    }
    // RDC mount (rover local == stack frame offset) for the debris specks and the shield image orientation
    let rdcInit = false; const rdc = { pos: V3(0.63, -0.55, -0.82), up: V3(1, 0, 0), have: false };
    function ensureRdc() {
      if (rdcInit) return; rdcInit = true;
      try {
        const m = ctx.modules.rover && ctx.modules.rover.mounts && ctx.modules.rover.mounts.rdc;
        if (m && m.pos && m.quat) {
          const o = C.stack.rover.origin;
          rdc.pos.copy(m.pos).add(V3(o[0], o[1], o[2]));
          rdc.up.set(0, 1, 0).applyQuaternion(m.quat);
          rdc.have = true;
          hs.content.rotation.y = Math.atan2(-rdc.up.z, rdc.up.x);
        }
      } catch (e) { /* nominal */ }
    }

    const lidLocal = V3(0, BS.pccTopY, 0);
    const shardSeeds = [V3(1.0, 0.3, 0.4), V3(-0.7, 0.4, -0.8), V3(0.2, 0.5, 1.1)];

    function update(t, camera, view) {
      try {
        ensureEject(); ensureRdc();
        const S = flight && flight.state ? flight.state(t) : null;
        const bH = S ? S.bodies.heatShield : defaultHS, bB = S ? S.bodies.backshell : defaultBS;
        U.applyPose(hs.root, bH); hs.root.visible = bH.visible !== false;
        U.applyPose(bs.root, bB); bs.root.visible = bB.visible !== false;
        group.visible = true;

        // ---- entry balance masses: seated until T_MASS, then analytic ballistic drift (relative to the capsule, frame of the ejection instant)
        for (let i = 0; i < 2; i++) {
          const m = bs.massMeshes[i], tau = t - T_MASS[i];
          if (tau < 0) { m.visible = true; m.position.copy(m.userData.restPos); m.quaternion.copy(m.userData.restQuat); continue; }
          if (tau > 7) { m.visible = false; continue; }
          m.visible = true;
          // R(t)^-1 * R_e
          qA.set(bB.quat[0], bB.quat[1], bB.quat[2], bB.quat[3]).invert().multiply(i ? ejectQ.m1 : ejectQ.m0);
          const out = 2.4 + 0.5 * i, fwd = 5.5;
          // relative displacement in the ejection frame: outward, then forward (toward the nose, -Y) as the capsule decelerates
          pA.copy(m.userData.outDir).multiplyScalar(out * tau).add(V3(0, -0.5 * fwd * tau * tau, 0));
          pA.applyQuaternion(qA).add(m.userData.restPos);
          m.position.copy(pA);
          qB.setFromAxisAngle(V3(0.3 + i * 0.4, 0.7, 0.5).normalize(), tau * (1.6 + 0.6 * i));
          m.quaternion.copy(qA).multiply(m.userData.restQuat).multiply(qB);
        }
        // ---- PCC lid and shards
        {
          const tau = t - T_LID;
          for (const p of bs.lidPieces) {
            const mesh = p.mesh;
            if (tau < 0) {
              if (p.kind === 'lid') { mesh.visible = true; mesh.position.set(0, 0, 0); mesh.quaternion.identity(); } else mesh.visible = false;
              continue;
            }
            if (tau > 6) { mesh.visible = false; continue; }
            mesh.visible = true;
            qA.set(bB.quat[0], bB.quat[1], bB.quat[2], bB.quat[3]).invert().multiply(ejectQ.lid);
            if (p.kind === 'lid') {
              pA.set(1.4 * tau, 8.5 * tau + 1.2 * tau * tau, 0.7 * tau);
              pA.applyQuaternion(qA);
              mesh.position.copy(pA);            // lidGroup children are positioned at the apex, so this is an offset from the rest pose
              qB.setFromAxisAngle(V3(0.4, 0.2, 0.9).normalize(), tau * 3.2);
              mesh.quaternion.copy(qA).multiply(qB);
              // rotate about the lid centre: shift so the pivot stays at the lid centre
              const pivot = lidLocal.clone();
              const rotated = pivot.clone().applyQuaternion(mesh.quaternion);
              mesh.position.add(pivot).sub(rotated);
            } else {
              const sd = shardSeeds[p.i];
              pA.copy(lidLocal).add(V3(0, 0.1, 0).addScaledVector(sd, 5 * tau)).add(V3(0, 5 * tau + 1.5 * tau * tau, 0));
              pB.copy(pA).sub(lidLocal).applyQuaternion(qA).add(lidLocal);
              mesh.position.copy(pB);
              qB.setFromAxisAngle(sd.clone().normalize(), tau * (4 + p.i));
              mesh.quaternion.copy(qA).multiply(qB);
            }
          }
        }
        // ---- debris specks released with the heat shield: RDC image tracks -> world positions
        {
          let any = false;
          if (S && t > 32.6 && t < 36.2) {
            const st = S.bodies.stack;
            qStack.set(st.quat[0], st.quat[1], st.quat[2], st.quat[3]);
            // stack-frame position of the shield rim plane below the camera
            pC.set(bH.pos[0] - st.pos[0], bH.pos[1] - st.pos[1], bH.pos[2] - st.pos[2]).applyQuaternion(qA.copy(qStack).invert());
            const Zrim = Math.max(0.5, rdc.pos.y - pC.y);       // camera height above the shield rim plane along the stack axis
            for (let i = 0; i < SPECKS.length; i++) {
              const tr = speckTracks[i];
              if (t < tr.t0 - 0.02 || t > tr.t1 + 0.1) { specks.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
              const tc = Math.min(Math.max(t, tr.t0), tr.t1);
              const u = tr.u.at(tc) + (t - tc) * (tr.u.at(tr.t1) - tr.u.at(tr.t1 - 0.05)) / 0.05;
              const v = tr.v.at(tc) + (t - tc) * (tr.v.at(tr.t1) - tr.v.at(tr.t1 - 0.05)) / 0.05;
              const depth = Zrim + 0.3;
              // camera frame: right = +Z, up = +X, look = -Y  (stack frame)
              const right = (u - 567) / RDC_F_PF, down = (v - 452) / RDC_F_PF;
              const dirS = V3(-down, -1, right);   // (up=+X => -down), look -Y, right +Z
              pA.copy(dirS).multiplyScalar(depth).add(rdc.pos).applyQuaternion(qStack).add(V3(st.pos[0], st.pos[1], st.pos[2]));
              const sz = SPECKS[i].size;
              _q.setFromAxisAngle(V3(0.2, 1, 0.3).normalize(), (t - tr.t0) * 4 + i);
              _m.compose(pA, _q, _s.set(sz[0], sz[1] * 0.4, sz[1]));
              specks.setMatrixAt(i, _m); any = true;
            }
            specks.instanceMatrix.needsUpdate = true;
          }
          specks.visible = any;
        }
        // hide a PUC camera body that would sit at the near plane of the viewing camera
        if (camera) {
          for (const cb of pss.camBodies) {
            cb.getWorldPosition(pA);
            cb.visible = pA.distanceToSquared(camera.position) > 0.04;
          }
        }
      } catch (e) {
        if (!update._warned) { update._warned = true; console.error('[capsule] update error: ' + (e && e.stack || e)); }
      }
    }

    const api = {
      group, update,
      heatShield: hs.root, backshell: bs.root,
      heatShieldContent: hs.content,
      anchors: {
        chuteBridle: pss.tops.map((v) => v.clone()),        // leg tops, backshell local
        legFeet: pss.feet.map((v) => v.clone()),
        apex: V3(0, BS.pccTopY, 0),
        confluence: V3(0, PSS.topY, 0),
        rimPlaneCentre: V3(0, 0, 0),
      },
      mounts: pss.mounts,
      dims: { rimRadius: R, heatShieldDepth: HS.depth, backshellHeight: BS.pccTopY, apexY: BS.pccTopY, pssTopY: PSS.topY },
      rdcNominal: { pos: V3(0.63, -0.55, -0.82), imageUpLocal: V3(1, 0, 0), imageRightLocal: V3(0, 0, 1) },
      info: { dsDeckAboveRim, tris: hs.stats.tris + bs.stats.tris + pss.stats.tris },
      // frames of the ejection instants (used by tests)
      ejectTimes: { masses: T_MASS.slice(), lid: T_LID },
      ready: Promise.resolve(),
    };
    return api;
  });
})();
