/* ============================================================================
 * parachute.js  —  module 'parachute'
 * 21.5 m disk-gap-band supersonic parachute (80 gores, 80 lines), riser + triple bridle, deployment bag,
 * debris, deployment/inflation sequence and canopy swing as seen by the PUC cameras and from outside.
 *
 * Local frame of api.group == state.bodies.chute frame: origin = confluence (suspension lines meet riser),
 * +Y toward the canopy apex.  Everything is a pure function of t (+ flight state); no accumulated state.
 * See _work/notes/parachute.md for the public API, constants and how to test.
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util;

  /* ---------------------------------------------------------------------------------------------
   * CONSTANTS (real hardware: hardware_and_edl_facts.md 4.2; video timing: parachute_report.md)
   * ------------------------------------------------------------------------------------------- */
  const K = {
    T0: 12.767,            // video time of the first PUC frame (frame 383); tau = t - T0 is the "panel" time of the report
    NG: 80,                // gores
    lineH: 35.826,         // suspension-line height (confluence -> skirt plane), inflated
    riser: 8.895,          // riser incl. triple bridle (anchor -> confluence)
    legLen: 2.5,           // triple-bridle leg length (junction -> backshell anchors)
    bandH: 2.58, gapH: 0.904, ventD: 1.576, projD: 15.447,
    rHem: 7.72,            // projected radius of the skirt
    lineLen: 36.65,        // true length of a line (confluence -> hem)
    lines: 80,
    lateT: 20.0,           // from here on the flight state's inflation drives the canopy (steady state / deflation)
  };
  // keep the shared constants consistent with the real dimensions (flight reads C.chute lazily)
  C.chute.lineLength = K.lineH;
  C.chute.bridleLength = K.riser;
  C.chute.diameter = 21.5;

  /* ---------------------------------------------------------------------------------------------
   * THE MESSAGE  (parachute_report.md sec.5 / facts 4.3; verified 0 mismatches against parachute_cells.json)
   * message bit k of a ring sits at gore (start + k) mod 80, gore index j = RIGHT-camera indexing at t = 20 s.
   * Screen angle (clockwise seen from below, from screen-right) of gore j centre = 5.42 + 4.5 j deg.
   * ------------------------------------------------------------------------------------------- */
  const RING_BITS = {
    A: '00000001000000000001000001001000000001010001111111111111111111111111111111111111', // DARE
    B: '00000011010000001001000000011100000010000000010100000001100100011111111111111111', // MIGHTY
    C: '00000101000000001000000000100100000011100000000111000001001100011111111111111111', // THINGS
    D: '00001000100000001011000011101000000011100001110110000000101000000111110000010111', // 34 11 58 N 118 10 31 W
  };
  const RING_START = { A: 33, B: 73, C: 53, D: 33 };
  const MATRIX = ['A', 'B', 'C', 'D'].map((k) => {
    const row = new Uint8Array(80);
    for (let b = 0; b < 80; b++) row[(RING_START[k] + b) % 80] = RING_BITS[k].charCodeAt(b) === 49 ? 1 : 0;
    return row;
  });

  /* ---------------------------------------------------------------------------------------------
   * INFLATION TIMELINE (tau = t - T0), width fraction x = projected canopy width / final width
   * frames f416..f432 of the RIGHT panel (parachute_report.md 3.3)
   * ------------------------------------------------------------------------------------------- */
  const INFL = new U.Track([
    [1.10, 0.09], [1.167, 0.12], [1.233, 0.15], [1.30, 0.30], [1.367, 0.41], [1.433, 0.57],
    [1.50, 0.73], [1.567, 0.92], [1.633, 1.014],
  ], { mode: 'linear' });
  const T_LINESTRETCH = 1.10;   // bag strips off, lines fully out
  const T_BAG_OUT = 0.17;       // bag leaves the mortar tube region (visible)
  const T_PACK0 = 0.12;

  // canopy swing seen by the PUC (half peak-to-peak, degrees of angle in the camera frame) - parachute_canopy_track.json
  const SW_MINOR = new U.Track([[1.6, 3.8], [3.5, 3.3], [5.3, 1.6], [8.2, 1.4], [9.0, 0.95], [12, 1.0], [14.7, 1.0], [40, 0.9], [150, 0.7]], { mode: 'smooth' });
  const SW_MAJOR = new U.Track([[1.6, 2.8], [3.5, 2.5], [5.5, 2.6], [8.2, 2.55], [9.0, 1.6], [12, 1.55], [14.7, 1.6], [40, 1.4], [150, 1.0]], { mode: 'smooth' });
  const TWIST = new U.Track([[1.6, 0], [3, 1.5], [4.6, 2.5], [6.7, 2.5], [8.7, -2.5], [10.0, 0], [11.2, 3.5], [12.5, 7], [13.6, 15], [14.77, 26]], { mode: 'cubic' });

  /* ---------------------------------------------------------------------------------------------
   * MERIDIAN of the canopy (canopy frame, apex up, hem plane at y = 0)
   * Radial layout is fitted to the measured on-screen ring fractions (0.096 | 0.367 | 0.652 | 0.842 | gap | 0.908 | 1.0 of R_out)
   * for a camera ~45 m below the skirt plane.
   * The inflation family keeps the fabric arc length: only the slope angle beta(s) is morphed (bulb -> flat disk).
   * ------------------------------------------------------------------------------------------- */
  const NM = 129;
  const MER = (function () {
    const rV = 0.80, rD = 7.0, yD = 3.48, HD = 3.40, rBT = 7.41, yBT = 2.58, rH = K.rHem;
    const yv = yD + HD * (1 - (rV / rD) * (rV / rD));
    const poly = [[0, yv], [rV, yv]];
    const nd = 200;
    for (let i = 1; i <= nd; i++) { const r = rV + ((rD - rV) * i) / nd; poly.push([r, yD + HD * (1 - (r / rD) * (r / rD))]); }
    const iDiskEnd = poly.length - 1;
    poly.push([rBT, yBT]);
    const iBandTop = poly.length - 1;
    const nb = 30;
    for (let i = 1; i <= nb; i++) { const u = i / nb; poly.push([rBT + (rH - rBT) * Math.pow(u, 1.15), yBT * (1 - u)]); }
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    const Lm = cum[cum.length - 1];
    function sAtR(rr) {
      for (let i = 2; i <= iDiskEnd; i++) if (poly[i][0] >= rr) { const f = (rr - poly[i - 1][0]) / (poly[i][0] - poly[i - 1][0]); return cum[i - 1] + f * (cum[i] - cum[i - 1]); }
      return cum[iDiskEnd];
    }
    // ring boundaries (arc fraction sigma = s / Lm)
    const sig = {
      hub: cum[1] / Lm, AB: sAtR(3.22) / Lm, BC: sAtR(5.56) / Lm, CD: cum[iDiskEnd] / Lm, bandTop: cum[iBandTop] / Lm,
    };
    // resample to NM uniformly spaced arc samples
    const rs = new Float64Array(NM), ys = new Float64Array(NM);
    let j = 0;
    for (let k = 0; k < NM; k++) {
      const s = (Lm * k) / (NM - 1);
      while (j < poly.length - 2 && cum[j + 1] < s) j++;
      const f = U.clamp((s - cum[j]) / (cum[j + 1] - cum[j] || 1), 0, 1);
      rs[k] = poly[j][0] + f * (poly[j + 1][0] - poly[j][0]);
      ys[k] = poly[j][1] + f * (poly[j + 1][1] - poly[j][1]);
    }
    const chord = new Float64Array(NM - 1), bFin = new Float64Array(NM - 1), bBulb = new Float64Array(NM - 1);
    for (let i = 0; i < NM - 1; i++) {
      chord[i] = Math.hypot(rs[i + 1] - rs[i], ys[i + 1] - ys[i]);
      bFin[i] = Math.atan2(ys[i] - ys[i + 1], rs[i + 1] - rs[i]);
      const u = (i + 0.5) / (NM - 1);
      bBulb[i] = 0.14 + (2.70 - 0.14) * Math.pow(u, 0.85);    // ~8 deg at the vent -> ~155 deg at the hem (nearly closed ball)
    }
    // LUT: blend w in [0, 1.3] -> max projected radius
    const NW = 84, wMax = 1.3;
    const wArr = new Float64Array(NW), rmaxArr = new Float64Array(NW);
    for (let k = 0; k < NW; k++) {
      const w = (wMax * k) / (NW - 1);
      let r = 0, rm = 0;
      for (let i = 0; i < NM - 1; i++) {
        const b = bBulb[i] * (1 - w) + bFin[i] * w;
        r += chord[i] * Math.cos(b);
        if (r > rm) rm = r;
      }
      wArr[k] = w; rmaxArr[k] = rm;
    }
    return { poly, Lm, sig, rs, ys, chord, bFin, bBulb, wArr, rmaxArr, NW, rV, rD };
  })();
  const X_BULB = MER.rmaxArr[0] / K.rHem;       // width fraction of the closed bulb (below: fabric bunched up = scaled)

  /* row layout (sigma values) of the canopy mesh: hub, ring A, B, C (disk), [gap = no fabric], band */
  const NV = 8;      // subdivisions across a gore
  const ROWS = (function () {
    const rows = [], brk = [];
    const Lm = MER.Lm, sg = MER.sig;
    function span(s0, s1, step, brkAfter) {
      const n = Math.max(1, Math.ceil(((s1 - s0) * Lm) / step));
      for (let i = 0; i <= n; i++) { if (i === 0 && rows.length && Math.abs(rows[rows.length - 1] - s0) < 1e-9) continue; rows.push(s0 + ((s1 - s0) * i) / n); brk.push(false); }
      if (brkAfter) brk[brk.length - 1] = true;
    }
    span(0, sg.hub, 0.4, false);
    span(sg.hub, sg.AB, 0.2, false);
    span(sg.AB, sg.BC, 0.2, false);
    span(sg.BC, sg.CD, 0.2, true);
    span(sg.bandTop, 1.0, 0.17, false);
    return { rows, brk };
  })();

  /* ---------------------------------------------------------------------------------------------
   * GLSL
   * ------------------------------------------------------------------------------------------- */
  const CANOPY_VS = /* glsl */ `
#define NM ${NM}
#define PI 3.14159265359
#define NG 80.0
const float PSI0 = 0.055327;      // 3.17 deg: start edge of gore 0 (gore j is centred at 5.42 + 4.5 j deg, clockwise seen from below)
const float DPSI = 0.0785398163;  // 2 pi / 80
uniform vec4 uMer[NM];            // r, y, beta, -
uniform vec4 uDef, uDef2, uDef3, uDef4;
uniform vec4 uRing;               // sAB, sBC, sCD, sBandTop
uniform vec4 uRing2;              // sHub, chevron, seamW, -
attribute vec3 aP;                // gore g, v across gore (0..1), sigma
varying vec3 vP;
varying vec3 vWPos;
varying vec3 vNw;

vec3 surf(float a, float sig, float v){
  float psi = -(PSI0 + a * DPSI);
  float f = clamp(sig, 0.0, 1.0) * float(NM - 1);
  int i0 = min(int(floor(f)), NM - 2);
  float fr = f - float(i0);
  vec4 m0 = uMer[i0]; vec4 m1 = uMer[i0 + 1];
  float r0 = mix(m0.x, m1.x, fr); float y0 = mix(m0.y, m1.y, fr); float be = mix(m0.z, m1.z, fr);
  float wD = smoothstep(0.10, 1.0, sig);
  float ell = 1.0 + wD * uDef.x * cos(2.0 * (psi - uDef.y));
  float dd = psi - uDef.w; dd = atan(sin(dd), cos(dd));
  float dent = uDef.z * exp(-dd * dd / (uDef2.x * uDef2.x));
  float r = r0 * (ell - wD * dent);
  float y = y0 - wD * dent * uDef4.x;
  float wH = sig * sig * sig;
  float p9 = 9.0 * psi + uDef2.w; float p17 = 17.0 * psi + uDef4.y; float p5 = 5.0 * psi + uDef4.w;
  r += wH * (uDef2.y * sin(p9) + uDef2.z * sin(p17) + uDef4.z * sin(p5));
  y += wH * 0.6 * (uDef2.y * cos(p9 + 0.9) + uDef2.z * cos(p17 + 0.4) + uDef4.z * cos(p5 + 1.1));
  float cr = uDef3.x * (sin(3.0 * psi + 5.0 * sig + 1.3) + 0.7 * sin(7.0 * psi - 9.0 * sig + 2.1) + 0.5 * sin(13.0 * psi + 4.0 * sig + 0.4)) * (0.25 + 0.75 * sig);
  r += cr; y += 0.7 * cr;
  // gore pleats: each gore bulges outward between its seams (parabola), stronger in the band ("ribbed collar")
  float pw = smoothstep(uRing2.x * 0.7, uRing2.x * 1.6, sig);
  float inBand = smoothstep(uRing.w - 0.004, uRing.w + 0.004, sig);
  float bl = uDef3.y * (2.0 * PI * max(r0, 0.05) / NG) * 4.0 * v * (1.0 - v) * (1.0 + 0.9 * (v - 0.5)) * pw * (1.0 + inBand * uDef3.w);
  r += sin(be) * bl; y += cos(be) * bl;
  // scalloped hem: the skirt hangs lower in the middle of each gore
  float sv = sin(PI * v);
  y -= uDef3.z * sv * sv * smoothstep(0.90, 1.0, sig);
  return vec3(r * cos(psi), y, r * sin(psi));
}

void main(){
  float g = aP.x; float v = aP.y; float sig = aP.z;
  float a = g + v;
  vec3 P = surf(a, sig, v);
  float e = 0.0015; float es = 0.003;
  vec3 dv = surf(a + e, sig, v + e) - surf(a - e, sig, v - e);
  vec3 ds = surf(a, sig + es, v) - surf(a, sig - es, v);
  vec3 c = cross(ds, dv);
  float cl = length(c);
  vec3 Nl = cl > 1e-10 ? c / cl : vec3(0.0, 1.0, 0.0);
  vNw = normalize(mat3(modelMatrix) * Nl);
  vec4 wp = modelMatrix * vec4(P, 1.0);
  vWPos = wp.xyz;
  vP = aP;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

  const CANOPY_FS = /* glsl */ `
#define PI 3.14159265359
uniform sampler2D uPat;
uniform vec4 uRing;      // sAB, sBC, sCD, sBandTop
uniform vec4 uRing2;     // sHub, chevron, seamW, translucency gain
uniform vec3 uSunRad;    // sun colour * intensity
uniform vec3 uSkyRad;    // sky ambient radiance-ish
uniform vec3 uGndRad;    // ground bounce colour (seen from below)
uniform vec3 uWhiteT, uOrangeT, uWhiteA, uOrangeA;
uniform float uFlicker;
varying vec3 vP;
varying vec3 vWPos;
varying vec3 vNw;
${EDL.glsl.noise}
${EDL.glsl.fog}

void main(){
  float g = vP.x; float v = vP.y; float sig = vP.z;
  vec3 Nw = normalize(vNw);
  vec3 toCam = cameraPosition - vWPos;
  float dist = length(toCam);
  vec3 Vw = toCam / max(dist, 1e-3);
  bool inside = dot(Nw, Vw) < 0.0;          // viewer looks at the inner face (PUC cameras)
  vec3 N = inside ? -Nw : Nw;
  vec3 L = normalize(uSunDir);
  float cosO = dot(Nw, L);                  // sun incidence on the OUTER face

  vec3 aT; vec3 aA; float hub = 0.0; float seam = 1.0; float cell = 0.0;
  if (sig < uRing2.x) {
    hub = 1.0;
    aT = vec3(0.13, 0.135, 0.15); aA = vec3(0.10, 0.10, 0.11);
  } else {
    float chev = uRing2.y * (1.0 - abs(2.0 * v - 1.0));
    float s2 = sig - chev;
    vec4 A = texture2D(uPat, vec2((g + 0.5) / 80.0, 0.5));
    float e = fwidth(sig) * 1.2 + 1e-4;
    float c = A.r;
    c = mix(c, A.g, smoothstep(uRing.x - e, uRing.x + e, s2));
    c = mix(c, A.b, smoothstep(uRing.y - e, uRing.y + e, s2));
    float isBand = step(uRing.w - 1e-4, sig);
    c = mix(c, A.a, isBand);
    cell = c;
    aT = mix(uWhiteT, uOrangeT, c); aA = mix(uWhiteA, uOrangeA, c);
    float ew = fwidth(v) * 1.5 + 1e-3;
    seam = smoothstep(0.0, uRing2.z + ew, min(v, 1.0 - v));
  }
  // gentle fabric variation (mottling / ripstop crinkle) - subtle
  float mott = vnoise2(vec2(g * 0.71 + v * 2.3, sig * 61.0)) * 0.5 + vnoise2(vec2(g * 1.9 - v * 5.0, sig * 23.0)) * 0.5;
  float fab = 0.90 + 0.20 * mott;
  float streak = vnoise2(vec2(v * 9.0 + g * 3.7, sig * 3.0));
  float seamDark = mix(0.30, 1.0, seam) * (0.92 + 0.16 * streak);

  vec3 sky = uSkyRad * (0.55 + 0.45 * clamp(Nw.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 rad;
  if (inside) {
    // fabric seen from below: sunlight is TRANSMITTED through the cloth (sun above, camera below)
    float wrap = clamp(cosO * 0.85 + 0.15, 0.0, 1.0);
    vec3 E = uSunRad * wrap + sky;
    rad = aT * E * (uRing2.w / PI);
    rad += aA * uGndRad * 0.12;                 // Mars-ground bounce lighting the inside of the dome
    // forward-scatter glow when looking toward the sun through the cloth
    float fs = pow(max(dot(-Vw, L), 0.0), 8.0);
    rad += aT * uSunRad * fs * 0.10 / PI * (0.5 + 0.5 * step(0.0, cosO));
  } else {
    float dif = max(cosO, 0.0);
    vec3 E = uSunRad * dif + sky;
    rad = aA * E / PI;
    rad += aT * uSunRad * max(-cosO, 0.0) * 0.25 / PI;   // light transmitted from the far inside surface
    vec3 H = normalize(L + Vw);
    rad += uSunRad * pow(max(dot(N, H), 0.0), 40.0) * 0.06 * step(0.0, cosO);   // satin sheen of the nylon
  }
  rad *= fab * seamDark;
  if (hub > 0.5) {
    // polyester hub disc with a few grommets
    float rho = sig / max(uRing2.x, 1e-4);
    vec2 pd = vec2(cos(-(0.0553 + (g + v) * 0.0785398)) * rho, sin(-(0.0553 + (g + v) * 0.0785398)) * rho);
    float dots = 0.0;
    for (int i = 0; i < 3; i++) {
      float an = 0.6 + float(i) * 2.0944;
      vec2 dc = vec2(cos(an), sin(an)) * 0.5;
      dots = max(dots, 1.0 - smoothstep(0.07, 0.11, length(pd - dc)));
    }
    rad *= (1.0 - 0.75 * dots) * (0.85 + 0.15 * smoothstep(0.85, 1.0, rho));
  }
  gl_FragColor = vec4(rad, 1.0);
  gl_FragColor.rgb = edlFog(gl_FragColor.rgb, dist, -Vw);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  const LINE_VS = /* glsl */ `
attribute vec3 iA; attribute vec3 iB; attribute vec2 iS;   // segment ends (local), seed / width multiplier
uniform float uW; uniform float uMinPx; uniform float uRes;
uniform vec3 uSunDir;
varying float vCov; varying float vLit; varying float vSeed; varying float vDist;
void main(){
  vec3 wa = (modelMatrix * vec4(iA, 1.0)).xyz; vec3 wb = (modelMatrix * vec4(iB, 1.0)).xyz;
  vec3 va = (viewMatrix * vec4(wa, 1.0)).xyz; vec3 vb = (viewMatrix * vec4(wb, 1.0)).xyz;
  vec3 vp = mix(va, vb, position.x);
  vec3 tg = vb - va; float tl = length(tg); tg = tl > 1e-6 ? tg / tl : vec3(0.0, 1.0, 0.0);
  vec3 c = cross(tg, vp); float cl = length(c);
  vec3 side = cl > 1e-6 ? c / cl : vec3(1.0, 0.0, 0.0);
  float pxw = max(-vp.z, 0.05) * 2.0 / (projectionMatrix[1][1] * uRes);
  float w = uW * iS.y;
  float wpx = max(w, uMinPx * pxw);
  vCov = clamp(w / wpx, 0.0, 1.0);
  vp += side * position.y * 0.5 * wpx;
  vec3 dw = normalize(wb - wa + vec3(1e-6));
  vLit = sqrt(max(1.0 - abs(dot(dw, uSunDir)), 0.0));
  vSeed = iS.x; vDist = length(vp);
  gl_Position = projectionMatrix * vec4(vp, 1.0);
}
`;
  const LINE_FS = /* glsl */ `
uniform vec3 uCol; uniform vec3 uSunRad; uniform vec3 uSkyRad; uniform float uAlpha; uniform float uGain;
varying float vCov; varying float vLit; varying float vSeed; varying float vDist;
void main(){
  vec3 rad = uCol * (uSunRad * (0.25 + 0.75 * vLit) + uSkyRad) * (uGain / 3.14159265);
  float a = uAlpha * mix(0.45, 1.0, vSeed) * mix(0.35, 1.0, vCov);
  gl_FragColor = vec4(rad, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  /* =============================================================================================
   * FACTORY
   * =========================================================================================== */
  EDL.registerModule('parachute', function factory(ctx) {
    const group = new THREE.Group();
    group.name = 'parachute';
    group.visible = false;
    const swingRoot = new THREE.Group(); swingRoot.name = 'chute.swing';
    const twistRoot = new THREE.Group(); twistRoot.name = 'chute.twist';
    group.add(swingRoot); swingRoot.add(twistRoot);

    const anchors = {
      confluence: new THREE.Vector3(0, 0, 0),
      apex: new THREE.Vector3(0, K.lineH + 6, 0),
      skirtCentre: new THREE.Vector3(0, K.lineH, 0),
      riserJunction: new THREE.Vector3(0, -(K.riser - K.legLen), 0),
    };

    /* ---------------- pattern data texture (80 x 1 RGBA: rings A, B, C, band) ---------------- */
    const patData = new Uint8Array(80 * 4);
    for (let g = 0; g < 80; g++) for (let r = 0; r < 4; r++) patData[g * 4 + r] = MATRIX[r][g] ? 255 : 0;
    const patTex = new THREE.DataTexture(patData, 80, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    patTex.magFilter = THREE.NearestFilter; patTex.minFilter = THREE.NearestFilter;
    patTex.generateMipmaps = false; patTex.needsUpdate = true;

    /* ---------------- dynamic meridian / shape state ---------------- */
    const merArr = new Float32Array(NM * 4);
    const merR = new Float64Array(NM), merY = new Float64Array(NM), merB = new Float64Array(NM);
    const DEF = { ell: 0, ellAng: 0.4, dent: 0, dentAng: -2.356, dentW: 0.6, ruf9: 0, ruf17: 0, ruf5: 0, phA: 0, phB: 0, phC: 0, crumple: 0, pleat: 0.1, scallop: 0.1, ribAmp: 1.2, sag: 0.3 };
    let hemY = K.lineH;          // height of the hem plane above the confluence
    let rHemNow = K.rHem;

    function fillMeridian(w, sc, collapse) {
      let r = 0, y = 0;
      const rr = merR, yy = merY;
      for (let i = 0; i < NM; i++) {
        rr[i] = r; yy[i] = y;
        if (i < NM - 1) {
          const b = MER.bBulb[i] * (1 - w) + MER.bFin[i] * w;
          merB[i] = b;
          r += MER.chord[i] * Math.cos(b);
          y -= MER.chord[i] * Math.sin(b);
        }
      }
      merB[NM - 1] = merB[NM - 2];
      const yEnd = yy[NM - 1];
      const flat = 1 - 0.96 * collapse, spread = 1 + 0.30 * collapse;
      for (let i = 0; i < NM; i++) {
        merR[i] = rr[i] * sc * spread;
        merY[i] = (yy[i] - yEnd) * sc * flat;
        merArr[i * 4] = merR[i]; merArr[i * 4 + 1] = merY[i]; merArr[i * 4 + 2] = merB[i]; merArr[i * 4 + 3] = 0;
      }
      rHemNow = merR[NM - 1];
    }
    // width fraction x -> (blend w, scale s)
    function widthToShape(x, collapse) {
      const target = Math.max(x, 0.02) * K.rHem;
      const R = MER.rmaxArr, W = MER.wArr;
      let w, s = 1;
      if (target <= R[0]) { w = 0; s = target / R[0]; }
      else {
        let k = 0;
        while (k < MER.NW - 2 && R[k + 1] < target) k++;
        const f = U.clamp((target - R[k]) / (R[k + 1] - R[k] || 1e-6), 0, 1);
        w = W[k] + (W[k + 1] - W[k]) * f;
      }
      fillMeridian(w, s, collapse);
      return s;
    }

    // JS mirror of the vertex shader surface (seams only: pleat bulge is 0 there)
    function surfJS(a, sig, out) {
      const psi = -(0.055327 + a * 0.0785398163);
      const f = U.clamp(sig, 0, 1) * (NM - 1);
      const i0 = Math.min(Math.floor(f), NM - 2), fr = f - i0;
      const r0 = merR[i0] + (merR[i0 + 1] - merR[i0]) * fr, y0 = merY[i0] + (merY[i0 + 1] - merY[i0]) * fr;
      const wD = U.smoothstep(0.10, 1.0, sig);
      const ell = 1 + wD * DEF.ell * Math.cos(2 * (psi - DEF.ellAng));
      let dd = psi - DEF.dentAng; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      const dent = DEF.dent * Math.exp((-dd * dd) / (DEF.dentW * DEF.dentW));
      let r = r0 * (ell - wD * dent), y = y0 - wD * dent * DEF.sag;
      const wH = sig * sig * sig;
      const p9 = 9 * psi + DEF.phA, p17 = 17 * psi + DEF.phB, p5 = 5 * psi + DEF.phC;
      r += wH * (DEF.ruf9 * Math.sin(p9) + DEF.ruf17 * Math.sin(p17) + DEF.ruf5 * Math.sin(p5));
      y += wH * 0.6 * (DEF.ruf9 * Math.cos(p9 + 0.9) + DEF.ruf17 * Math.cos(p17 + 0.4) + DEF.ruf5 * Math.cos(p5 + 1.1));
      const cr = DEF.crumple * (Math.sin(3 * psi + 5 * sig + 1.3) + 0.7 * Math.sin(7 * psi - 9 * sig + 2.1) + 0.5 * Math.sin(13 * psi + 4 * sig + 0.4)) * (0.25 + 0.75 * sig);
      r += cr; y += 0.7 * cr;
      out[0] = r * Math.cos(psi); out[1] = y; out[2] = r * Math.sin(psi);
      return out;
    }

    /* ---------------- lighting constants (adapt to the scene's real lights if present) ---------------- */
    const L = {
      sunRad: new THREE.Vector3(3.0 * 1.0, 3.0 * 0.945, 3.0 * 0.86),
      skyRad: new THREE.Vector3(0.75, 0.68, 0.62),
      gndRad: new THREE.Vector3(0.9, 0.55, 0.38),
      dirLight: null, hemiLight: null, scan: 0,
    };
    function refreshLights() {
      const sc = ctx.scene;
      if (!L.dirLight || !L.dirLight.parent) {
        L.dirLight = null; L.hemiLight = null;
        if (sc && (L.scan++ % 20) === 0) {
          const find = (o, d) => {
            for (const ch of o.children) {
              if (ch.isDirectionalLight && !L.dirLight && ch.intensity > 0.2) L.dirLight = ch;
              else if (ch.isHemisphereLight && !L.hemiLight) L.hemiLight = ch;
              if (d < 2 && ch.children.length) find(ch, d + 1);
            }
          };
          find(sc, 0);
        }
      }
      const uc = EDL.uniforms.uSunColor.value;
      if (L.dirLight) L.sunRad.set(L.dirLight.color.r, L.dirLight.color.g, L.dirLight.color.b).multiplyScalar(L.dirLight.intensity);
      else L.sunRad.set(uc.r, uc.g, uc.b).multiplyScalar(3.0);
      if (L.hemiLight) {
        const h = L.hemiLight;
        L.skyRad.set(h.color.r, h.color.g, h.color.b).multiplyScalar(h.intensity * 0.9);
        L.gndRad.set(h.groundColor.r, h.groundColor.g, h.groundColor.b).multiplyScalar(Math.max(h.intensity, 0.6) * 1.1);
      } else {
        const z = EDL.uniforms.uSkyZenith.value, hz = EDL.uniforms.uSkyHorizon.value;
        L.skyRad.set((z.r + hz.r) * 0.5, (z.g + hz.g) * 0.5, (z.b + hz.b) * 0.5).multiplyScalar(1.3);
      }
    }

    /* =================================================================================
     * CANOPY MESH
     * ================================================================================= */
    const canopyUniforms = Object.assign({
      uMer: { value: merArr },
      uDef: { value: new THREE.Vector4() }, uDef2: { value: new THREE.Vector4() },
      uDef3: { value: new THREE.Vector4() }, uDef4: { value: new THREE.Vector4() },
      uRing: { value: new THREE.Vector4(MER.sig.AB, MER.sig.BC, MER.sig.CD, MER.sig.bandTop) },
      uRing2: { value: new THREE.Vector4(MER.sig.hub, 0.0125, 0.055, 1.55) },
      uPat: { value: patTex },
      uSunRad: { value: L.sunRad }, uSkyRad: { value: L.skyRad }, uGndRad: { value: L.gndRad },
      uWhiteT: { value: new THREE.Vector3(0.50, 0.505, 0.52) },
      uOrangeT: { value: new THREE.Vector3(0.50, 0.075, 0.022) },
      uWhiteA: { value: new THREE.Vector3(0.80, 0.80, 0.82) },
      uOrangeA: { value: new THREE.Vector3(0.72, 0.085, 0.022) },
      uFlicker: { value: 0 },
    }, EDL.uniforms);
    const canopyMat = new THREE.ShaderMaterial({
      uniforms: canopyUniforms, vertexShader: CANOPY_VS, fragmentShader: CANOPY_FS,
      side: THREE.DoubleSide, extensions: { derivatives: true },
    });
    const canopyGeo = (function () {
      const rows = ROWS.rows, nr = rows.length, NG = K.NG;
      const nv = nr * NG * (NV + 1);
      const aP = new Float32Array(nv * 3);
      let p = 0;
      for (let k = 0; k < nr; k++) for (let g = 0; g < NG; g++) for (let m = 0; m <= NV; m++) { aP[p++] = g; aP[p++] = m / NV; aP[p++] = rows[k]; }
      const idx = [];
      for (let k = 0; k < nr - 1; k++) {
        if (ROWS.brk[k]) continue;
        for (let g = 0; g < NG; g++) for (let m = 0; m < NV; m++) {
          const i00 = (k * NG + g) * (NV + 1) + m, i01 = i00 + 1;
          const i10 = ((k + 1) * NG + g) * (NV + 1) + m, i11 = i10 + 1;
          idx.push(i00, i10, i01, i01, i10, i11);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); // dummy (positions come from aP in the shader)
      geo.setAttribute('aP', new THREE.BufferAttribute(aP, 3));
      geo.setIndex(idx);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 14);
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(-12, -8, -12), new THREE.Vector3(12, 14, 12));
      return geo;
    })();
    const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
    canopyMesh.frustumCulled = false; canopyMesh.name = 'chute.canopy';
    twistRoot.add(canopyMesh);

    /* =================================================================================
     * LINES (80 suspension lines) + dark bundle cords near the confluence — camera-facing ribbons
     * ================================================================================= */
    const LS = 40;                       // segments per line
    const NB = 9;                        // dark sub-bundles at the confluence
    function makeRibbon(n) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const A = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); A.setUsage(THREE.DynamicDrawUsage);
      const B = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); B.setUsage(THREE.DynamicDrawUsage);
      const S = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2); S.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iA', A); g.setAttribute('iB', B); g.setAttribute('iS', S);
      g.instanceCount = n;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), 60);
      return { geo: g, A: A.array, B: B.array, S: S.array, attrs: [A, B, S], n };
    }
    const lineRib = makeRibbon(K.lines * LS);
    const cordRib = makeRibbon(NB * 3);
    const lineU = Object.assign({
      uW: { value: 0.0055 }, uMinPx: { value: 1.5 }, uRes: { value: 1024 },
      uCol: { value: new THREE.Vector3(0.92, 0.95, 1.0) }, uAlpha: { value: 0.7 }, uGain: { value: 1.5 },
      uSunRad: { value: L.sunRad }, uSkyRad: { value: L.skyRad },
    }, { uSunDir: EDL.uniforms.uSunDir });
    const lineMat = new THREE.ShaderMaterial({ uniforms: lineU, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const cordU = Object.assign({
      uW: { value: 0.065 }, uMinPx: { value: 2.0 }, uRes: { value: 1024 },
      uCol: { value: new THREE.Vector3(0.05, 0.05, 0.06) }, uAlpha: { value: 1.0 }, uGain: { value: 1.0 },
      uSunRad: { value: L.sunRad }, uSkyRad: { value: L.skyRad },
    }, { uSunDir: EDL.uniforms.uSunDir });
    const cordMat = new THREE.ShaderMaterial({ uniforms: cordU, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: true, side: THREE.DoubleSide });
    const lineMesh = new THREE.Mesh(lineRib.geo, lineMat); lineMesh.frustumCulled = false; lineMesh.renderOrder = 3; lineMesh.name = 'chute.lines';
    const cordMesh = new THREE.Mesh(cordRib.geo, cordMat); cordMesh.frustumCulled = false; cordMesh.renderOrder = 2; cordMesh.name = 'chute.cords';
    twistRoot.add(lineMesh); twistRoot.add(cordMesh);

    // confluence fitting (small steel ring + riser link)
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x6e727a, metalness: 0.85, roughness: 0.45 });
    const confRing = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 20), steelMat);
    confRing.rotation.x = Math.PI / 2; confRing.position.set(0, 0.02, 0);
    swingRoot.add(confRing);
    const confPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 14), new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.6, metalness: 0.4 }));
    confPlate.position.set(0, 0.06, 0); swingRoot.add(confPlate);
    const juncBlock = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.07), new THREE.MeshStandardMaterial({ color: 0x24252a, roughness: 0.55, metalness: 0.5 }));
    group.add(juncBlock);

    /* =================================================================================
     * STRAPS: riser, three bridle legs, loose flailing deployment straps (CPU ribbons)
     * ================================================================================= */
    const NS = 48;                                   // samples per strap
    const strapDefs = [];
    const rng = U.rng(20210218);
    strapDefs.push({ kind: 'riser', hw: 0.070, tw: 0.4 });
    for (let k = 0; k < 3; k++) strapDefs.push({ kind: 'leg', k, hw: 0.045, tw: 0.0 });
    const NLOOSE = 5;
    for (let i = 0; i < NLOOSE; i++) {
      strapDefs.push({
        kind: 'loose', hw: 0.022 + rng() * 0.028, len: 3.0 + rng() * 4.0, loops: 1.2 + rng() * 1.6, ph0: rng() * 6.283,
        om: (5.5 + rng() * 6) * (rng() < 0.5 ? -1 : 1), rad: 0.22 + rng() * 0.38, a0: rng() * 6.283, up: 0.25 + rng() * 0.45, tw: 6 + rng() * 8, lag: rng() * 0.25,
      });
    }
    const nStrap = strapDefs.length;
    const strapPos = new Float32Array(nStrap * NS * 2 * 3), strapNor = new Float32Array(nStrap * NS * 2 * 3), strapUV = new Float32Array(nStrap * NS * 2 * 2);
    const strapIdx = [];
    for (let s = 0; s < nStrap; s++) for (let i = 0; i < NS - 1; i++) {
      const a = (s * NS + i) * 2, b = a + 2;
      strapIdx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const strapGeo = new THREE.BufferGeometry();
    const sPosA = new THREE.BufferAttribute(strapPos, 3); sPosA.setUsage(THREE.DynamicDrawUsage);
    const sNorA = new THREE.BufferAttribute(strapNor, 3); sNorA.setUsage(THREE.DynamicDrawUsage);
    strapGeo.setAttribute('position', sPosA); strapGeo.setAttribute('normal', sNorA);
    strapGeo.setAttribute('uv', new THREE.BufferAttribute(strapUV, 2));
    strapGeo.setIndex(strapIdx);
    strapGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -3, 0), 40);
    const weaveTex = U.canvasTexture(64, 256, (g, w, h) => {
      g.fillStyle = '#9a7a58'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        g.fillStyle = (y / 2) % 2 ? 'rgba(60,40,20,0.22)' : 'rgba(255,230,190,0.16)';
        for (let x = 0; x < w; x += 4) g.fillRect(x + ((y / 2) % 2) * 2, y, 2, 2);
      }
      g.fillStyle = 'rgba(30,20,10,0.35)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    }, { repeat: true });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide, emissive: 0x08080a });
    const strapMat = new THREE.MeshStandardMaterial({ map: weaveTex, color: 0x6a5a4c, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide, emissive: 0x241a12 });
    const strapPer = (NS - 1) * 6;
    strapGeo.addGroup(0, strapPer, 0);                     // riser
    strapGeo.addGroup(strapPer, strapPer * 3, 1);          // three bridle legs (dark sleeved Technora)
    strapGeo.addGroup(strapPer * 4, strapPer * NLOOSE, 0); // loose deployment straps
    const strapMesh = new THREE.Mesh(strapGeo, [strapMat, legMat]); strapMesh.frustumCulled = false; strapMesh.name = 'chute.straps';
    group.add(strapMesh);

    /* =================================================================================
     * DEPLOYMENT BAG (dark cylinder 0.46 x 0.66 m with white corkscrew webbing) + debris
     * ================================================================================= */
    const bag = new THREE.Group(); bag.name = 'chute.bag'; bag.visible = false;
    {
      const fab = U.canvasTexture(128, 128, (g, w, h) => {
        g.fillStyle = '#2b2522'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(' + (60 + (rng() * 40) | 0) + ',' + (50 + (rng() * 30) | 0) + ',45,' + (0.10 + rng() * 0.2) + ')'; g.fillRect(rng() * w, rng() * h, 1 + rng() * 10, 1 + rng() * 2); }
        g.fillStyle = 'rgba(20,15,12,0.5)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
      }, { repeat: true });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.66, 24, 1, true), new THREE.MeshStandardMaterial({ map: fab, roughness: 0.92, side: THREE.DoubleSide }));
      bag.add(body);
      const lid = new THREE.Mesh(new THREE.CircleGeometry(0.23, 24), new THREE.MeshStandardMaterial({ color: 0x1c1816, roughness: 0.9, side: THREE.DoubleSide }));
      lid.rotation.x = -Math.PI / 2; lid.position.y = 0.33; bag.add(lid);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.21, 24), new THREE.MeshStandardMaterial({ color: 0x9a9caa, roughness: 0.6, side: THREE.DoubleSide }));
      mouth.rotation.x = Math.PI / 2; mouth.position.y = -0.31; bag.add(mouth);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.02, 6, 24), new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.8 }));
      rim.rotation.x = Math.PI / 2; rim.position.y = -0.33; bag.add(rim);
      const pts = [];
      for (let i = 0; i <= 120; i++) { const u = i / 120, a = u * 4 * 6.2832; pts.push(new THREE.Vector3(Math.cos(a) * 0.238, -0.33 + u * 0.66, Math.sin(a) * 0.238)); }
      const web = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.016, 5, false), new THREE.MeshStandardMaterial({ color: 0xe9e6e0, roughness: 0.7 }));
      bag.add(web);
    }
    group.add(bag);

    const NDEB = 10;
    const debMat = new THREE.MeshStandardMaterial({ color: 0x8a5a50, roughness: 0.8, side: THREE.DoubleSide });
    const debris = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 10), debMat, NDEB);
    debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debris.frustumCulled = false; debris.visible = false; debris.name = 'chute.debris';
    const debSpec = [];
    for (let i = 0; i < NDEB; i++) {
      const ang = rng() * 6.283, sp = 2 + rng() * 7;
      debSpec.push({
        v: new THREE.Vector3(Math.cos(ang) * sp, 18 + rng() * 30, Math.sin(ang) * sp), size: 0.10 + rng() * 0.22,
        axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), spin: (4 + rng() * 14) * (rng() < 0.5 ? -1 : 1),
        p0: new THREE.Vector3((rng() - 0.5) * 0.9, 0.3 + rng() * 0.5, (rng() - 0.5) * 0.9), t0: 0.09 + rng() * 0.05,
      });
    }
    group.add(debris);
    // pink fragment colour for a few instances
    debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NDEB * 3), 3);
    for (let i = 0; i < NDEB; i++) { const c = i % 4 === 0 ? [1.0, 0.72, 0.75] : [0.85, 0.62, 0.56]; debris.instanceColor.setXYZ(i, c[0], c[1], c[2]); }

    /* ---------------- temporaries ---------------- */
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qInv = new THREE.Quaternion();
    const m4 = new THREE.Matrix4(), eu = new THREE.Euler(), sc3 = new THREE.Vector3();
    const anchorL = new THREE.Vector3(0, -K.riser, 0);
    const axisU = new THREE.Vector3(0, -1, 0), jVec = new THREE.Vector3(), cVec = new THREE.Vector3();
    const qUp = new THREE.Vector3(0, 1, 0), qDn = new THREE.Vector3();
    const hemPts = new Float64Array(K.lines * 3);
    const tmp3 = [0, 0, 0];
    const ptsBuf = new Float32Array(NS * 3);
    const grpDir = new Float64Array(NB * 3);
    const errOnce = {};

    /* ---------------- animation helpers (pure functions of tau) ---------------- */
    function inflationAt(tv) {
      if (tv < T_LINESTRETCH) return 0;
      if (tv < 1.633) return INFL.at(tv);
      const d = tv - 1.633;
      let x = 1 + 0.055 * Math.exp(-d / 0.8) * Math.cos(2 * Math.PI * 3.0 * d + 1.315);
      // small residual breathing of the steady canopy (< +-1.2 %)
      const env = U.smoothstep(1.8, 3.5, tv);
      x += env * (0.006 * Math.sin(2 * Math.PI * 1.7 * tv + 0.7) + 0.005 * Math.sin(2 * Math.PI * 0.55 * tv + 2.1));
      return x;
    }
    function swingPhase(tv) {
      if (tv <= 2.0) return (2 * Math.PI * (tv - 1.6)) / 0.7;
      const th2 = (2 * Math.PI * 0.4) / 0.7;
      const Tn = Math.min(0.70 + 0.07 * (tv - 2.0), 1.5);
      let th = th2 + (2 * Math.PI / 0.07) * Math.log(Tn / 0.7);
      if (tv > 13.43) th += (2 * Math.PI * (tv - 13.43)) / 1.5;
      return th;
    }
    function twistDeg(tv) {
      if (tv <= 14.77) return TWIST.at(tv);
      const d = tv - 14.77;
      return 26 + 36 * (1 - Math.exp(-d / 5)) + 9 * Math.sin(0.25 * d);
    }
    // canopy-centre orbit -> tilt of the canopy about the confluence (rad about X, rad about Z)
    const swingOut = { rx: 0, rz: 0 };
    function swingAt(tv, scale) {
      if (tv < 1.55) { swingOut.rx = 0; swingOut.rz = 0; return swingOut; }
      const env = U.smoothstep(1.55, 1.8, tv);
      const kick = 1 + 0.7 * Math.exp(-(tv - 1.7) / 0.9);
      const th = swingPhase(tv);
      const ax = SW_MINOR.at(tv) * kick * env * scale, ay = SW_MAJOR.at(tv) * kick * env * scale;
      const dx = ax * Math.sin(th), dz = ay * Math.sin(th + 1.50);
      const D2R = Math.PI / 180 / 0.8;      // canopy tilt = camera-frame angle / 0.8 (canopy is 36 m of the 45 m distance)
      swingOut.rz = -dx * D2R; swingOut.rx = dz * D2R;
      return swingOut;
    }

    // ---------------- strap writer ----------------
    function writeStrap(si, pts, hw, tw0, twRate, uvScale, refX, refY, refZ) {
      const base = si * NS * 2;
      let uacc = 0;
      for (let i = 0; i < NS; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(NS - 1, i + 1);
        let tx = pts[i1 * 3] - pts[i0 * 3], ty = pts[i1 * 3 + 1] - pts[i0 * 3 + 1], tz = pts[i1 * 3 + 2] - pts[i0 * 3 + 2];
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        // width direction: reference x perpendicular to the tangent
        let wx = refY * tz - refZ * ty, wy = refZ * tx - refX * tz, wz = refX * ty - refY * tx;
        let wl = Math.hypot(wx, wy, wz);
        if (wl < 1e-5) { wx = 1; wy = 0; wz = 0; wl = 1; }
        wx /= wl; wy /= wl; wz /= wl;
        const ang = tw0 + twRate * (i / (NS - 1));
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const cxr = ty * wz - tz * wy, cyr = tz * wx - tx * wz, czr = tx * wy - ty * wx;   // t x w
        const ux = wx * ca + cxr * sa, uy = wy * ca + cyr * sa, uz = wz * ca + czr * sa;
        const nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux;
        const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
        const o = (base + i * 2) * 3;
        strapPos[o] = px - ux * hw; strapPos[o + 1] = py - uy * hw; strapPos[o + 2] = pz - uz * hw;
        strapPos[o + 3] = px + ux * hw; strapPos[o + 4] = py + uy * hw; strapPos[o + 5] = pz + uz * hw;
        strapNor[o] = nx; strapNor[o + 1] = ny; strapNor[o + 2] = nz; strapNor[o + 3] = nx; strapNor[o + 4] = ny; strapNor[o + 5] = nz;
        if (i > 0) uacc += Math.hypot(px - pts[(i - 1) * 3], py - pts[(i - 1) * 3 + 1], pz - pts[(i - 1) * 3 + 2]);
        const uo = (base + i * 2) * 2;
        strapUV[uo] = 0; strapUV[uo + 1] = uacc * uvScale; strapUV[uo + 2] = 1; strapUV[uo + 3] = uacc * uvScale;
      }
    }
    function hideStrap(si) {
      const o = si * NS * 2 * 3;
      for (let i = 0; i < NS * 2 * 3; i++) strapPos[o + i] = 0;
    }

    /* ---------------- canopy state -> uniforms ---------------- */
    function applyShape(x, tv, flutter, collapse, tSec) {
      const s = widthToShape(x, collapse);
      const young = 1 - U.smoothstep(0.55, 1.0, x);
      const mid = U.smoothstep(0.45, 0.7, x) * (1 - U.smoothstep(0.85, 1.0, x));
      const sm = Math.min(1, x / 0.6);
      DEF.ell = 0.02 + 0.08 * young + 0.02 * collapse;
      DEF.ellAng = 0.4 + 2.0 * young;
      DEF.dent = 0.20 * mid;
      DEF.dentW = 0.65;
      DEF.sag = 1.0 * s;
      DEF.ruf9 = (0.02 + 0.65 * young) * s * (0.6 + 0.4 * sm);
      DEF.ruf17 = (0.02 + 0.03 * flutter + 0.30 * young * mid + 0.15 * young) * s;
      DEF.ruf5 = (0.02 + 0.5 * young) * s;
      DEF.phA = 5.0 * tv + 1.0; DEF.phB = 8.5 * tv + 2.0; DEF.phC = -3.2 * tv + 0.5;
      DEF.crumple = (0.40 * (1 - U.smoothstep(0.0, 0.75, x)) + 0.55 * collapse) * s;
      DEF.pleat = (0.085 + 0.12 * young) * (1 - 0.5 * collapse);
      DEF.scallop = (0.09 + 0.22 * young) * s;
      DEF.ribAmp = 0.25;
      canopyUniforms.uDef.value.set(DEF.ell, DEF.ellAng, DEF.dent, DEF.dentAng);
      canopyUniforms.uDef2.value.set(DEF.dentW, DEF.ruf9, DEF.ruf17, DEF.phA);
      canopyUniforms.uDef3.value.set(DEF.crumple, DEF.pleat, DEF.scallop, DEF.ribAmp);
      canopyUniforms.uDef4.value.set(DEF.sag, DEF.phB, DEF.ruf5, DEF.phC);
      canopyUniforms.uRing2.value.y = 0.0125 * Math.max(s, 0.3);
      return s;
    }

    /* =================================================================================
     * UPDATE
     * ================================================================================= */
    function _update(t, camera, view) {
      const fl = ctx.modules.flight;
      if (!fl || !fl.state) { group.visible = false; return; }
      const S = fl.state(t);
      const cs = S.bodies.chute;
      const tv = t - K.T0;
      if (!cs || cs.visible === false || tv < 0.09) { group.visible = false; return; }
      group.visible = true;
      group.position.set(cs.pos[0], cs.pos[1], cs.pos[2]);
      group.quaternion.set(cs.quat[0], cs.quat[1], cs.quat[2], cs.quat[3]);
      group.updateMatrixWorld(true);
      const res = view && view.height ? view.height * (view.pixelRatio || 1) : 1024;
      lineU.uRes.value = res; cordU.uRes.value = res;
      refreshLights();

      /* ---- riser anchor (backshell bridle attach point) in chute-local coordinates ---- */
      {
        const bs = S.bodies.backshell;
        const cap = ctx.modules.capsule;
        const loc = cap && cap.anchors && cap.anchors.chuteBridle;
        if (loc) v1.copy(loc); else v1.set(C.stack.chuteAttach.origin[0] - C.stack.backshell.origin[0], C.stack.chuteAttach.origin[1] - C.stack.backshell.origin[1], C.stack.chuteAttach.origin[2] - C.stack.backshell.origin[2]);
        qa.set(bs.quat[0], bs.quat[1], bs.quat[2], bs.quat[3]);
        v1.applyQuaternion(qa).add(v2.set(bs.pos[0], bs.pos[1], bs.pos[2]));    // world
        v1.sub(group.position);
        qInv.copy(group.quaternion).invert();
        anchorL.copy(v1).applyQuaternion(qInv);
      }

      /* ---- inflation state ---- */
      let x = inflationAt(tv);
      let collapse = 0;
      const flutter = cs.flutter === undefined ? 0.5 : cs.flutter;
      if (t >= K.lateT && cs.inflation !== undefined) {
        const fi = cs.inflation;
        x = fi > 0.02 ? fi + 0.011 * Math.sin(2 * Math.PI * 1.7 * tv + 0.7) * U.saturate(fi) : 0.02;
        if (fi < 0.985) collapse = U.smoothstep(0.985, 0.05, fi);
        if (fi <= 0.02) collapse = 1;
      }
      const inPack = tv < T_LINESTRETCH;
      // ---- riser geometry (anchor -> bridle junction J -> confluence C) ----
      const al = anchorL.length() || K.riser;
      axisU.copy(anchorL).multiplyScalar(1 / al);                 // unit vector confluence-rest -> anchor
      const legLen = Math.min(K.legLen, al * 0.4);
      const Lr = al - legLen;                                     // riser strap arc length
      jVec.copy(axisU).multiplyScalar(Lr);                        // junction J relative to the final confluence position
      // deployment order (video): the suspension lines pay out FIRST (bag on the end of the white cord, riser still coiled at the
      // bridle junction, tan straps flailing), the riser is extracted while the canopy inflates and goes taut by tau ~ 1.55
      const sR = U.smoothstep(1.05, 1.55, tv);
      cVec.copy(jVec).multiplyScalar(1 - sR);                     // current confluence position
      const hemFinal = Math.sqrt(K.lineLen * K.lineLen - K.rHem * K.rHem);
      const lPay = K.lineLen * U.clamp((tv - T_PACK0) / (T_LINESTRETCH - T_PACK0), 0, 1);   // paid-out line length (from the confluence)
      swingRoot.position.copy(cVec);

      // canopy shape
      let hemYnow, sinkHem = 0;
      if (!inPack) {
        applyShape(collapse > 0 ? U.lerp(x, 0.8, collapse) : x, tv, flutter, collapse, t);   // a collapsing canopy lies down instead of shrinking
        hemYnow = Math.sqrt(Math.max(K.lineLen * K.lineLen - rHemNow * rHemNow, 0.25));
        if (collapse > 0) { sinkHem = collapse; hemYnow = U.lerp(hemYnow, 0.25, collapse); }
      } else hemYnow = lPay;
      hemY = hemYnow;
      canopyMesh.visible = !inPack;
      canopyMesh.position.set(0, hemYnow, 0);

      /* ---- swing / twist ---- */
      const sw = swingAt(tv, 1.0);
      eu.set(sw.rx, 0, sw.rz, 'XYZ');
      swingRoot.quaternion.setFromEuler(eu);
      twistRoot.rotation.set(0, (twistDeg(tv) * Math.PI) / 180, 0);
      swingRoot.updateMatrixWorld(true);

      /* ---- hem points (seams) ---- */
      for (let i = 0; i < K.lines; i++) {
        if (inPack) { hemPts[i * 3] = 0; hemPts[i * 3 + 1] = hemYnow; hemPts[i * 3 + 2] = 0; }
        else { surfJS(i, 1.0, tmp3); hemPts[i * 3] = tmp3[0]; hemPts[i * 3 + 1] = tmp3[1] + hemYnow; hemPts[i * 3 + 2] = tmp3[2]; }
      }
      // sub-bundle directions (mean hem direction of each group of lines)
      for (let k = 0; k < NB; k++) { grpDir[k * 3] = 0; grpDir[k * 3 + 1] = 0; grpDir[k * 3 + 2] = 0; }
      for (let i = 0; i < K.lines; i++) {
        const k = Math.min(NB - 1, Math.floor((i * NB) / K.lines));
        const hx = hemPts[i * 3], hy = hemPts[i * 3 + 1], hz = hemPts[i * 3 + 2], hl = Math.hypot(hx, hy, hz) || 1;
        grpDir[k * 3] += hx / hl; grpDir[k * 3 + 1] += hy / hl; grpDir[k * 3 + 2] += hz / hl;
      }
      for (let k = 0; k < NB; k++) { const l = Math.hypot(grpDir[k * 3], grpDir[k * 3 + 1], grpDir[k * 3 + 2]) || 1; grpDir[k * 3] /= l; grpDir[k * 3 + 1] /= l; grpDir[k * 3 + 2] /= l; }

      /* ---- lines ---- */
      {
        const A = lineRib.A, B = lineRib.B, Sd = lineRib.S;
        const bundleLen = Math.min(1.5, Math.max(0.3, hemYnow * 0.5));
        const snap = tv < T_LINESTRETCH ? 0 : Math.exp(-(tv - T_LINESTRETCH) / 0.30);           // slack decays after line stretch
        const slack = 0.25 * snap + 3.6 * collapse;
        const corkAmp = inPack ? 0.42 * U.smoothstep(0.25, 0.7, tv) * (1 - 0.6 * U.smoothstep(0.9, 1.1, tv)) : 0.42 * Math.exp(-(tv - T_LINESTRETCH) / 0.06) * 0;
        const turns = 4.5;
        const flutAmp = 0.008 + 0.014 * flutter;
        const visLines = !inPack || tv > 0.14;
        let n = 0;
        for (let i = 0; i < K.lines; i++) {
          const k = Math.min(NB - 1, Math.floor((i * NB) / K.lines));
          const bx = grpDir[k * 3] * bundleLen, by = grpDir[k * 3 + 1] * bundleLen, bz = grpDir[k * 3 + 2] * bundleLen;
          const hx = hemPts[i * 3], hy = hemPts[i * 3 + 1], hz = hemPts[i * 3 + 2];
          const seed = U.hash1(i * 7 + 13);
          // per-line perpendicular for slack sag
          let dx = hx - bx, dy = hy - by, dz = hz - bz; const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;
          let px = -dz, py = 0, pz = dx; const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
          const sgn = seed < 0.5 ? -1 : 1;
          let prevx = bx, prevy = by, prevz = bz;
          for (let j = 1; j <= LS; j++) {
            const u = j / LS;
            let cx = bx + (hx - bx) * u, cy = by + (hy - by) * u, cz = bz + (hz - bz) * u;
            const sag = slack * Math.sin(Math.PI * u) * (0.6 + 0.8 * seed) * sgn;
            const wv = flutAmp * Math.sin(Math.PI * u) * Math.sin(6.2832 * (u * 2.2 - 1.9 * tv) + seed * 6.28);
            cx += px * (sag + wv); cz += pz * (sag + wv); cy -= Math.abs(sag) * 0.3 * (collapse > 0 ? 1 : 0.2);
            if (corkAmp > 0) {
              const e = Math.sin(Math.PI * Math.min(1, u * 0.98 + 0.01));
              const a = 6.2832 * turns * u * (1.0 + 0.0) + 9.0 * tv + seed * 0.4;
              cx += corkAmp * e * Math.cos(a); cz += corkAmp * e * Math.sin(a);
            }
            const o = n * 3;
            A[o] = prevx; A[o + 1] = prevy; A[o + 2] = prevz; B[o] = cx; B[o + 1] = cy; B[o + 2] = cz;
            Sd[n * 2] = seed; Sd[n * 2 + 1] = 1;
            prevx = cx; prevy = cy; prevz = cz; n++;
          }
        }
        lineRib.attrs[0].needsUpdate = true; lineRib.attrs[1].needsUpdate = true; lineRib.attrs[2].needsUpdate = true;
        lineMesh.visible = visLines;
        lineU.uAlpha.value = inPack ? 0.95 : 0.70;
        // dark sub-bundles (the black "spikes" around the confluence) — hidden while the lines are still one twisted cord
        {
          const CA = cordRib.A, CB = cordRib.B, CS = cordRib.S;
          let m = 0;
          for (let k = 0; k < NB; k++) {
            const ex = grpDir[k * 3] * bundleLen, ey = grpDir[k * 3 + 1] * bundleLen, ez = grpDir[k * 3 + 2] * bundleLen;
            const mx = ex * 0.5, my = ey * 0.5, mz = ez * 0.5;
            const seg = [[0, 0, 0, mx, my, mz, 1.0], [mx, my, mz, ex, ey, ez, 0.72], [ex, ey, ez, ex * 1.12, ey * 1.12, ez * 1.12, 0.45]];
            for (let s = 0; s < 3; s++) {
              const o = m * 3;
              CA[o] = seg[s][0]; CA[o + 1] = seg[s][1]; CA[o + 2] = seg[s][2]; CB[o] = seg[s][3]; CB[o + 1] = seg[s][4]; CB[o + 2] = seg[s][5];
              CS[m * 2] = 1; CS[m * 2 + 1] = seg[s][6]; m++;
            }
          }
          cordRib.attrs[0].needsUpdate = true; cordRib.attrs[1].needsUpdate = true; cordRib.attrs[2].needsUpdate = true;
          cordMesh.visible = !inPack && collapse < 0.5;
        }
      }
      confRing.visible = confPlate.visible = true;

      /* ---- riser + triple bridle ---- */
      {
        v1.copy(axisU);
        v2.copy(jVec);                                    // junction J
        juncBlock.position.copy(v2);
        juncBlock.quaternion.setFromUnitVectors(qUp, qDn.copy(v1).negate());
        anchors.riserJunction.copy(v2);
        // perpendicular basis
        v3.set(1, 0, 0); if (Math.abs(v1.x) > 0.9) v3.set(0, 0, 1);
        const e1x = v1.y * v3.z - v1.z * v3.y, e1y = v1.z * v3.x - v1.x * v3.z, e1z = v1.x * v3.y - v1.y * v3.x;
        const e1l = Math.hypot(e1x, e1y, e1z);
        const E1 = [e1x / e1l, e1y / e1l, e1z / e1l];
        const E2 = [v1.y * E1[2] - v1.z * E1[1], v1.z * E1[0] - v1.x * E1[2], v1.x * E1[1] - v1.y * E1[0]];
        const jx = v2.x, jy = v2.y, jz = v2.z;
        // riser: from the confluence C (u=0) to the junction J (u=1); coiled in loops while not fully extracted
        const chord = Lr * sR;
        const nT = 4.5;
        const Rmax = Math.sqrt(Math.max(Lr * Lr - chord * chord, 0)) / (6.2832 * nT);
        const wave = 0.02 + 0.06 * Math.exp(-Math.max(tv - 1.55, 0) / 0.3);
        for (let i = 0; i < NS; i++) {
          const u = i / (NS - 1);
          const ph = 6.2832 * nT * u + 8.0 * tv * (1 - sR) + 1.0;
          const R = Rmax * (0.25 + 0.75 * Math.pow(Math.sin(Math.PI * u), 0.6)) * (0.8 + 0.2 * Math.sin(5 * tv + 3 * u)) + wave * Math.sin(Math.PI * u) * Math.sin(6.2832 * (1.3 * u - 2.0 * tv));
          const bx = cVec.x + (jx - cVec.x) * u, by = cVec.y + (jy - cVec.y) * u, bz = cVec.z + (jz - cVec.z) * u;
          ptsBuf[i * 3] = bx + R * (Math.cos(ph) * E1[0] + Math.sin(ph) * E2[0]);
          ptsBuf[i * 3 + 1] = by + R * (Math.cos(ph) * E1[1] + Math.sin(ph) * E2[1]);
          ptsBuf[i * 3 + 2] = bz + R * (Math.cos(ph) * E1[2] + Math.sin(ph) * E2[2]);
        }
        writeStrap(0, ptsBuf, strapDefs[0].hw, 0.3 + 0.2 * Math.sin(tv * 1.3), 0.5 + 6.0 * (1 - sR), 1.2, E1[0], E1[1], E1[2]);
        // bridle legs: J -> ring around the anchor (always taut, dark sleeved cords)
        for (let k = 0; k < 3; k++) {
          const ph = k * 2.0944 + 0.5;
          const rx = anchorL.x + 0.55 * (Math.cos(ph) * E1[0] + Math.sin(ph) * E2[0]);
          const ry = anchorL.y + 0.55 * (Math.cos(ph) * E1[1] + Math.sin(ph) * E2[1]);
          const rz = anchorL.z + 0.55 * (Math.cos(ph) * E1[2] + Math.sin(ph) * E2[2]);
          for (let i = 0; i < NS; i++) {
            const u = i / (NS - 1);
            const w = 0.01 * Math.sin(Math.PI * u) * Math.sin(6.2832 * (1.7 * u - 2.4 * tv) + k);
            ptsBuf[i * 3] = jx + (rx - jx) * u + E2[0] * w; ptsBuf[i * 3 + 1] = jy + (ry - jy) * u + E2[1] * w; ptsBuf[i * 3 + 2] = jz + (rz - jz) * u + E2[2] * w;
          }
          writeStrap(1 + k, ptsBuf, strapDefs[1 + k].hw, 0.0, 0.05, 1.2, E1[0], E1[1], E1[2]);
        }
        // loose deployment straps (riser cover flaps / tie tapes): flail near the bridle while the lines pay out, swept away afterwards
        const uy = v3.copy(v1).negate();        // chute axis direction (toward the canopy)
        for (let s = 0; s < NLOOSE; s++) {
          const d = strapDefs[4 + s];
          const en = U.smoothstep(0.10 + d.lag * 0.4, 0.30 + d.lag * 0.4, tv) * (1 - U.smoothstep(1.25 + d.lag, 1.75 + d.lag, tv));
          if (en < 0.01) { hideStrap(4 + s); continue; }
          const L = d.len * (0.35 + 0.65 * en);
          for (let i = 0; i < NS; i++) {
            const u = i / (NS - 1);
            const phi = d.a0 + d.om * (tv - 0.12) * 0.5 + 6.2832 * d.loops * u;
            const R = d.rad * Math.sin(Math.PI * Math.pow(u, 0.7)) * (0.5 + 0.5 * en) * (0.6 + 0.4 * Math.sin(tv * 9 + d.ph0 + u * 4));
            const c1 = Math.cos(phi) * R, c2 = Math.sin(phi) * R;
            const up = u * L * d.up * (0.5 + 0.5 * en) + 0.6 * Math.sin(u * 6 + tv * 7 + d.ph0) * u;
            const off = 0.45 + 0.25 * u;      // loops live on one side of the axis (the side of the bracket)
            ptsBuf[i * 3] = jx + uy.x * up + E1[0] * c1 + E2[0] * (c2 - off);
            ptsBuf[i * 3 + 1] = jy + uy.y * up + E1[1] * c1 + E2[1] * (c2 - off);
            ptsBuf[i * 3 + 2] = jz + uy.z * up + E1[2] * c1 + E2[2] * (c2 - off);
          }
          writeStrap(4 + s, ptsBuf, d.hw * (0.5 + 0.5 * en), d.ph0, d.tw * (0.5 + 0.5 * Math.sin(tv * 3 + d.ph0)), 1.5, E1[0] + 0.3, E1[1], E1[2] - 0.2);
        }
        sPosA.needsUpdate = true; sNorA.needsUpdate = true;
        strapGeo.attributes.uv.needsUpdate = true;
        strapMesh.visible = true;
      }

      /* ---- bag + debris ---- */
      {
        const bagFly = tv - T_LINESTRETCH;
        if (tv >= T_BAG_OUT && tv < 2.1) {
          bag.visible = true;
          if (tv < T_LINESTRETCH) {
            // hangs at the end of the twisted line bundle, tumbling
            const wob = 0.28 * Math.sin(7.5 * tv) * U.smoothstep(0.3, 0.9, tv);
            bag.position.set(cVec.x + wob, cVec.y + Math.max(lPay, 0.5), cVec.z + 0.22 * Math.cos(6.1 * tv) * U.smoothstep(0.3, 0.9, tv));
            eu.set(1.0 * Math.sin(3.1 * tv) + tv * 2.2, tv * 9.0, 0.6 * Math.cos(2.3 * tv), 'YXZ');
          } else {
            // stripped off the canopy: drifts away
            const yb = cVec.y + hemFinal + 0.2 - 3.0 * bagFly - 6 * bagFly * bagFly;
            bag.position.set(4.0 * bagFly + 1.5 * bagFly * bagFly, yb - 0.8 * bagFly, -1.5 * bagFly);
            eu.set(tv * 2.2 + 1.1, tv * 9.0 + 3.0 * bagFly, 0.6 * Math.cos(2.3 * tv) + 4 * bagFly, 'YXZ');
          }
          bag.quaternion.setFromEuler(eu);
        } else bag.visible = false;

        if (tv >= 0.09 && tv < 1.6) {
          debris.visible = true;
          const ar = anchorL;
          for (let i = 0; i < NDEB; i++) {
            const d = debSpec[i];
            const dtv = Math.max(0, tv - d.t0);
            const drag = 1 - Math.exp(-dtv / 0.9);
            const p = 0.9 * drag;                       // relative travel fraction (drag slows the fragments)
            v1.copy(ar).addScaledVector(d.p0, 1).addScaledVector(d.v, dtv * (0.6 + 0.4 * (1 - drag)) * 1.0 + 0);
            qa.setFromAxisAngle(d.axis, d.spin * dtv);
            const sz = d.size * (0.7 + 0.3 * Math.sin(d.spin * dtv * 2.0));
            sc3.set(sz, sz, sz);
            m4.compose(v1, qa, sc3);
            debris.setMatrixAt(i, m4);
          }
          debris.count = NDEB;
          debris.instanceMatrix.needsUpdate = true;
          debris.instanceColor.needsUpdate = true;
        } else debris.visible = false;
      }
    }

    function update(t, camera, view) {
      try { _update(t, camera, view); }
      catch (e) {
        group.visible = false;
        if (!errOnce.u) { errOnce.u = 1; console.error('[parachute] update error: ' + (e && e.stack || e)); }
      }
    }

    /* ---------------- public API ---------------- */
    const api = {
      group, ready: Promise.resolve(), update, anchors,
      constants: K,
      pattern: { rings: RING_BITS, starts: RING_START, matrix: MATRIX },
      /** hem (skirt) seam point i (0..79) in the chute frame (after twist, before swing) — valid after update() */
      hemPoint(i, out) { out = out || new THREE.Vector3(); return out.set(hemPts[i * 3], hemPts[i * 3 + 1], hemPts[i * 3 + 2]); },
      /** canopy centre (skirt plane centre + a little above) in world coordinates, valid after update() */
      canopyCentre(out) { out = out || new THREE.Vector3(); out.set(0, hemY + 2.0, 0); swingRoot.localToWorld(out); return out; },
      /** width fraction (inflation) at video time t */
      inflationAt(t) { return inflationAt(t - K.T0); },
      swingAt(t, out) { const s = swingAt(t - K.T0, 1); out = out || {}; out.rx = s.rx; out.rz = s.rz; out.twistDeg = twistDeg(t - K.T0); return out; },
      tauOf(t) { return t - K.T0; },
      debug: { MER, DEF, X_BULB, canopyMat, lineMat },
    };
    return api;
  });
})();
