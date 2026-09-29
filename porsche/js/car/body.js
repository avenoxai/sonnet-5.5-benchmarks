'use strict';
// car/body.js — BODY SHELL (order 10). Attempt B "blueprint / orthographic intersection", refinement round 1.
//
// The body is modelled like a designer working from three drawings, all driven by smooth (C2) tables sampled from natural cubic splines:
//   SIDE   view : centre-line top Tb(x) (hood line, cowl, belt/deck, duck-tail lip), floor F(x); nose / tail faces are x-positions that are
//                 TABLES OF HEIGHT (ns(y), ts(y): the lid edge overhangs the bumper, the tail bulges at y~0.55 and its top edge is set back ~0.1 m)
//   PLAN   view : maximum half-width W(x) (waist at the doors, swelling to the arches, tail narrowing to the light bar). The plan corners of
//                 nose (r ~0.3 m) and tail (r ~0.2 m) are exponential smooth-max blends of the flank with the (convex) end faces.
//   SECTION     : flank Ws(x,y) = W(x) - a(y-yW)^2 (barrel: widest at yW, tucks in to the sill and in to the shoulder) + a soft shoulder bead
//                 along the doors + a rolled flare bead around both wheel openings; crowned top
//                 H(x,z) = Tb(x) - crown(x) z^2 + A(x) G((z-zc(x))/w)   (G = gaussian hump: the front fender crest / "frog eye" line, and the
//                 rear haunch shoulders; crown < 0 at the deck gives the shallow valley between the haunches).
// Every drawing is a graph-type distance (divided by its own gradient norm), combined with CUBIC (C2) smooth max/min fillets whose
// radius is a table of x. The greenhouse is a separate tapered region (roof spline Rf(x), lean planes with half-width Wb(x), lean tan tl(x))
// smooth-united at the belt line (the fillet only acts at / above the lower body's top surface, so no beads appear on the flank) and clipped
// by the lower body's plan outline. Rear glass / windshield / door glass / quarter glass are analytic masks in body_cabin.js.
// Wheel arches are cylinders (tyre radius + 40 mm) carved with a rolled lip; the well is a closed cavity (inboard wall z = 0.58 / 0.55).
//
// ---------------------------------------------------------------------------------------------------------------------------
// FEATURE CONTRACT (all feature files body_*.js register through PG.body.registerFeature):
//   feature = { name, order, common, sdf, shade }
//     common : GLSL helpers/constants shared by sdf and shade of that feature (identifiers prefixed with the feature name).
//              MUST NOT use PG.sdf.lib (the material hook has no lib): use the bd_* helpers of this file (bd_smin, bd_smax, bd_sstep, bd_rb2,
//              bd_aa, bd_poly*, bd table functions ...). May also be a function returning the string (evaluated when the shaders are composed).
//     sdf    : `float feat_<name>(vec3 p, float d)`  p = car space with p.z ALREADY mirrored (p.z >= 0), d = current body distance.
//              Change d only locally, return it unchanged elsewhere.  (sdf-only code MAY use PG.sdf.lib.)
//     shade  : `void shade_<name>(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw)`  p mirrored to z >= 0, n = unflipped outward
//              normal with the same mirroring (n.z multiplied by sgnz), sgnz = original sign of z, fw = pixel footprint. Called after the base
//              paint in feature order (front faces only). Override s.* inside your own analytic masks (use bd_aa(d, fw) for AA).
//   Also exported to features (defined in the base common block of this file):
//     tables/functions   bdTb bdF bdW bdRf bdWb ... (each name(x) -> value, name_2(x) -> vec2(value, d/dx)),
//                        bd_roofY(x,z), bd_ghSide(x,y,z) (signed dist to the greenhouse lean plane, + outside), bd_wellF/bd_wellR(p) (< 0 inside
//                        the wheel-well cylinders), bd_baseHeight(x,z) (top height of the lower body)
//     JS                 PG.body.prof = { Tb, F, W, Rf, Wb, tl, cR, cr, beltY, ... } JS twins of the tables (for CPU placement / polygons)
//   Parts: 'body' (paint, back faces = dark trim) and 'body_glass' (subset of the triangles near windows). ctx.shared.body published.
(function () {
  const PG = window.PG = window.PG || {};
  const spec = PG.spec;

  // ------------------------------------------------------------------------------------------------------- feature registry
  PG.body = PG.body || {};
  Object.assign(PG.body, {
    features: [], version: 1,
    registerFeature(f) {
      if (!f || !f.name) throw new Error('body feature needs a name');
      const i = PG.body.features.findIndex(g => g.name === f.name);
      if (i >= 0) PG.body.features.splice(i, 1);
      PG.body.features.push(f);
      PG.body.features.sort((a, b) => (a.order || 0) - (b.order || 0));
      return f;
    },
  });
  {
    const cs = document.currentScript, base = cs && cs.src ? cs.src.replace(/body\.js(\?.*)?$/, '') : 'js/car/';
    ['front', 'side', 'rear', 'cabin', 'lights', 'decals'].forEach(n => document.write('<script src="' + base + 'body_' + n + '.js"><\/script>'));
  }

  // ------------------------------------------------------------------------------------------------------- splines (natural cubic, C2)
  function nspline(pts) {
    const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]);
    const h = [], al = [], l = [1], mu = [0], z = [0], c = new Array(n).fill(0), b = new Array(n).fill(0), d = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) h[i] = x[i + 1] - x[i];
    for (let i = 1; i < n - 1; i++) al[i] = 3 / h[i] * (y[i + 1] - y[i]) - 3 / h[i - 1] * (y[i] - y[i - 1]);
    for (let i = 1; i < n - 1; i++) { l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1]; mu[i] = h[i] / l[i]; z[i] = (al[i] - h[i - 1] * z[i - 1]) / l[i]; }
    for (let j = n - 2; j >= 0; j--) { c[j] = z[j] - mu[j] * c[j + 1]; b[j] = (y[j + 1] - y[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3; d[j] = (c[j + 1] - c[j]) / (3 * h[j]); }
    const slope0 = b[0], slopeN = b[n - 2] + 2 * c[n - 2] * h[n - 2] + 3 * d[n - 2] * h[n - 2] * h[n - 2];
    return function (xx) {
      if (xx <= x[0]) return y[0] + slope0 * (xx - x[0]);
      if (xx >= x[n - 1]) return y[n - 1] + slopeN * (xx - x[n - 1]);
      let i = 0; while (xx > x[i + 1]) i++;
      const t = xx - x[i]; return y[i] + b[i] * t + c[i] * t * t + d[i] * t * t * t;
    };
  }
  const f5 = v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(5);
  function tabGLSL(name, fn, X0 = -2.5, X1 = 2.5, NT = 251) {
    const n = NT, v = [];
    for (let i = 0; i < n; i++) v.push(fn(X0 + (X1 - X0) * i / (n - 1)));
    return `const float ${name}_v[${n}] = float[${n}](${v.map(f5).join(',')});
vec2 ${name}_2(float x) { float u = clamp((x - (${f5(X0)})) / ${f5(X1 - X0)}, 0.0, 1.0) * ${n - 1}.0; int i = min(int(u), ${n - 2}); float t = u - float(i);
  float a = ${name}_v[max(i - 1, 0)], b = ${name}_v[i], c = ${name}_v[i + 1], d = ${name}_v[min(i + 2, ${n - 1})];
  float v = 0.5 * (2.0 * b + (-a + c) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t * t + (-a + 3.0 * b - 3.0 * c + d) * t * t * t);
  float dv = 0.5 * ((-a + c) + 2.0 * (2.0 * a - 5.0 * b + 4.0 * c - d) * t + 3.0 * (-a + 3.0 * b - 3.0 * c + d) * t * t) * ${f5((n - 1) / (X1 - X0))};
  return vec2(v, dv); }
float ${name}(float x) { return ${name}_2(x).x; }
`;
  }

  // ------------------------------------------------------------------------------------------------------- the drawings (control points)
  const W = spec.wheel, AF = W.front, AR = W.rear;
  const K = {
    // side view ---------------------------------------------------------------------------------------------------------------
    // Tb = height of the lower body's top at the centre line (hood line, cowl, belt/shoulder, deck, duck-tail)
    Tb: [[-2.60, 0.93], [-2.40, 0.998], [-2.30, 1.040], [-2.23, 1.033], [-2.13, 1.028], [-2.02, 1.034], [-1.90, 1.043], [-1.75, 1.050], [-1.60, 1.058], [-1.40, 1.075], [-1.20, 1.060], [-0.90, 1.030], [-0.50, 0.998],
      [-0.10, 0.976], [0.30, 0.973], [0.55, 0.976], [0.72, 0.962], [0.90, 0.915], [1.35, 0.790], [1.75, 0.680], [2.12, 0.588], [2.35, 0.540], [2.60, 0.47]],
    // floor
    F: [[-2.60, 0.34], [-2.33, 0.315], [-2.24, 0.290], [-2.10, 0.225], [-1.90, 0.160], [-1.65, 0.112], [-1.40, 0.100], [-1.0, 0.100], [0.0, 0.100], [1.0, 0.100], [1.7, 0.100], [2.0, 0.112], [2.2, 0.135], [2.5, 0.16]],
    // plan view: half width of the widest point (yW), sides only - the plan corners come from the end faces + big smooth-max radii
    W: [[-2.60, 0.68], [-2.30, 0.795], [-2.10, 0.848], [-1.90, 0.888], [-1.70, 0.918], [-1.50, 0.940], [-1.2285, 0.945], [-0.90, 0.934], [-0.60, 0.920], [-0.20, 0.898], [0.25, 0.902], [0.55, 0.925],
      [0.80, 0.940], [1.0, 0.940], [1.2285, 0.943], [1.55, 0.918], [1.80, 0.862], [1.95, 0.818], [2.10, 0.752], [2.25, 0.66], [2.40, 0.50]],
    // section: height of the widest line yW, curvature above / below it, top crown, shoulder fillet k
    yW: [[-2.6, 0.55], [-2.2, 0.56], [-1.9, 0.60], [-1.5, 0.64], [-1.2285, 0.62], [-0.8, 0.56], [-0.2, 0.50], [0.4, 0.56], [0.9, 0.64], [1.23, 0.66], [1.7, 0.62], [2.0, 0.55], [2.2, 0.45], [2.5, 0.4]],
    aU: [[-2.6, 0.18], [-2.2, 0.19], [-1.9, 0.26], [-1.5, 0.38], [-1.2285, 0.45], [-0.8, 0.36], [-0.2, 0.28], [0.4, 0.28], [0.9, 0.40], [1.23, 0.60], [1.7, 0.50], [2.0, 0.35], [2.2, 0.30], [2.5, 0.30]],
    aL: [[-2.6, 0.55], [-1.2285, 0.50], [-0.2, 0.53], [1.23, 0.50], [1.8, 0.40], [2.2, 0.28], [2.5, 0.25]],
    cr: [[-2.6, -0.02], [-2.0, -0.012], [-1.6, -0.006], [-1.2, 0.010], [-0.8, 0.03], [-0.5, 0.040], [0.0, 0.045], [0.6, 0.040], [1.0, 0.030], [1.6, 0.025], [2.2, 0.030], [2.6, 0.03]],
    kS: [[-2.6, 0.10], [-2.3, 0.10], [-2.15, 0.11], [-2.0, 0.13], [-1.6, 0.15], [-1.2285, 0.15], [-0.8, 0.10], [-0.2, 0.05], [0.4, 0.06], [0.9, 0.18], [1.23, 0.28], [1.7, 0.26], [2.0, 0.16], [2.15, 0.05], [2.6, 0.05]],
    // fender crest hump (front eyes + rear haunches): amplitude, z of the ridge, widths inside / outside
    cA: [[-2.6, 0], [-2.30, 0.0], [-2.10, 0.0], [-1.95, 0.010], [-1.8, 0.022], [-1.5, 0.030], [-1.2, 0.030], [-0.9, 0.020], [-0.6, 0.0], [0.60, 0.0], [0.72, 0.006], [0.90, 0.024], [1.05, 0.042], [1.2285, 0.062], [1.35, 0.082], [1.55, 0.110],
      [1.75, 0.128], [1.93, 0.118], [2.05, 0.098], [2.15, 0.05], [2.3, 0.0], [2.6, 0]],
    cZ: [[-2.6, 0.45], [-2.2, 0.52], [-2.0, 0.60], [-1.8, 0.68], [-1.6, 0.76], [-1.4, 0.81], [-1.2, 0.84], [-0.9, 0.83], [-0.6, 0.80], [0.6, 0.78], [0.72, 0.78], [0.9, 0.80], [1.05, 0.81], [1.2285, 0.80], [1.35, 0.78], [1.55, 0.74], [1.75, 0.69], [1.93, 0.63], [2.05, 0.60], [2.3, 0.5], [2.6, 0.4]],
    cWi: [[-2.6, 0.25], [-1.2, 0.28], [-0.6, 0.18], [0.6, 0.11], [1.2, 0.14], [1.6, 0.13], [1.9, 0.10], [2.6, 0.08]],
    cWo: [[-2.6, 0.10], [-1.2, 0.11], [0.6, 0.11], [1.2, 0.12], [1.6, 0.115], [1.9, 0.10], [2.6, 0.08]],
    // greenhouse (own region): roof spline (centre line), belt half width Wb of the lean plane at belt height, lean tan, fillet with the body
    Rf: [[-2.6, 0.72], [-2.0, 1.031], [-1.8, 1.043], [-1.6, 1.060], [-1.4, 1.087], [-1.2, 1.135], [-1.0, 1.195], [-0.85, 1.240], [-0.60, 1.268], [-0.30, 1.280], [-0.10, 1.2765], [0.02, 1.2685], [0.15, 1.2135], [0.30, 1.148],
      [0.50, 1.061], [0.72, 0.965], [0.90, 0.887], [1.2, 0.757], [1.6, 0.58], [2.6, 0.2]],
    Wb: [[-2.6, 0.80], [-2.0, 0.85], [-1.8, 0.90], [-1.5, 0.90], [-1.2, 0.88], [-0.9, 0.86], [-0.5, 0.84], [-0.1, 0.84], [0.3, 0.83], [0.55, 0.79], [0.72, 0.74], [1.2, 0.72], [2.6, 0.7]],
    tl: [[-2.6, 1.8], [-2.0, 1.7], [-1.8, 1.6], [-1.5, 1.4], [-1.2, 1.25], [-0.9, 0.98], [-0.5, 0.84], [0.0, 0.81], [0.3, 0.80], [0.6, 0.78], [2.6, 0.75]],
    kC: [[-2.6, 0.02], [-2.0, 0.02], [-1.85, 0.06], [-1.65, 0.16], [-1.5, 0.22], [-1.1, 0.15], [-0.8, 0.09], [-0.2, 0.05], [0.4, 0.05], [0.72, 0.05], [1.2, 0.05], [2.6, 0.05]],
    cR: [[-2.6, 0.060], [-1.5, 0.060], [-0.85, 0.066], [-0.2, 0.066], [0.05, 0.060], [0.3, 0.040], [0.72, 0.030], [2.6, 0.030]],
    kR: [[-2.6, 0.10], [-1.2, 0.11], [-0.85, 0.12], [-0.3, 0.13], [0.1, 0.12], [0.3, 0.10], [0.72, 0.08], [2.6, 0.08]],
    // end faces: setback of the face as a function of HEIGHT y (tables over y!): nose face (lid edge overhangs the bumper), tail face (bumper bulge ~y 0.55, top edge set back)
    ns: [[0.0, 0.12], [0.13, 0.10], [0.20, 0.075], [0.30, 0.04], [0.40, 0.015], [0.50, 0.0], [0.60, 0.004], [0.75, 0.02], [1.4, 0.10]],
    ts: [[0.0, 0.10], [0.15, 0.072], [0.25, 0.046], [0.35, 0.022], [0.48, 0.003], [0.60, 0.0], [0.75, 0.025], [0.90, 0.062], [1.0, 0.095], [1.1, 0.14], [1.3, 0.24], [1.5, 0.34]],
  };
  const P = {};   // JS twins
  for (const k in K) P[k] = nspline(K[k]);
  P.beltY = 0.96;
  P.roofPeakY = 1.28;
  P.arch = { front: { x: AF.x, y: AF.tireRadius, r: 0.390, zc: 0.58 }, rear: { x: AR.x, y: AR.tireRadius, r: 0.404, zc: 0.55 } };
  PG.body.prof = P;
  PG.body.tables = K;

  // ------------------------------------------------------------------------------------------------------- GLSL: base common block
  function baseCommon() {
    const t = (n, k) => tabGLSL(n, P[k]);
    return `
// ==== body base common (no PG.sdf.lib!) ====
float bd_sq(float x) { return x * x; }
float bd_smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * h * k * (1.0 / 6.0); }
float bd_smaxe(float a, float b, float k) { return max(a, b) + k * log(1.0 + exp(-abs(a - b) / k)); }   // exponential smooth max (C-infinity, no blend-boundary seams)
float bd_smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * h * k * (1.0 / 6.0); }
float bd_sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float bd_rb2(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
float bd_aa(float d, float fw) { return 1.0 - smoothstep(-fw, fw, d); }
// convex polygon signed distance (exact inside, sharp corners): pts given as consecutive vec2, CCW
float bd_seg(vec2 p, vec2 a, vec2 b) { vec2 e = b - a; vec2 w = p - a; return length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0)); }
const float BD_BELT = ${f5(P.beltY)};
${t('bdTb', 'Tb')}${t('bdF', 'F')}${t('bdW', 'W')}${t('bdYw', 'yW')}${t('bdAu', 'aU')}${t('bdAl', 'aL')}${t('bdCr', 'cr')}${t('bdKs', 'kS')}
${t('bdCa', 'cA')}${t('bdCz', 'cZ')}${t('bdCwi', 'cWi')}${t('bdCwo', 'cWo')}
${tabGLSL('bdNs', P.ns, 0.0, 1.6, 161)}${tabGLSL('bdTs', P.ts, 0.0, 1.6, 161)}
${t('bdRf', 'Rf')}${t('bdWb', 'Wb')}${t('bdTl', 'tl')}${t('bdKc', 'kC')}${t('bdKr', 'kR')}${t('bdCR', 'cR')}

// roof height at (x, z)
float bd_roofY(float x, float z) { return bdRf(x) - bdCR(x) * z * z; }
// signed distance to the greenhouse lean plane (positive outside), z >= 0
float bd_ghSide(float x, float y, float z) {
  vec2 wb = bdWb_2(x); float t = bdTl(x);
  return (z - wb.x + (y - BD_BELT) * t) / sqrt(1.0 + t * t + wb.y * wb.y);
}
// height of the lower body's crowned top incl. fender crest at (x, z)
float bd_baseHeight(float x, float z) {
  float zc = bdCz(x), A = bdCa(x); float w = (z < zc) ? bdCwi(x) : bdCwo(x); float u = (z - zc) / w;
  return bdTb(x) - bdCr(x) * z * z + A * exp(-u * u);
}
// wheel wells: signed distance (< 0 inside the closed cavity / tunnel) for the front and rear wheel, p mirrored
float bd_arch(vec3 q, float ax, float ay, float r, float zc) {
  float dc = length(q.xy - vec2(ax, ay)) - r;
  return bd_smax(dc, zc - q.z, 0.06);
}
float bd_wellF(vec3 q) { return bd_arch(q, ${f5(P.arch.front.x)}, ${f5(P.arch.front.y)}, ${f5(P.arch.front.r)}, ${f5(P.arch.front.zc)}); }
float bd_wellR(vec3 q) { return bd_arch(q, ${f5(P.arch.rear.x)}, ${f5(P.arch.rear.y)}, ${f5(P.arch.rear.r)}, ${f5(P.arch.rear.zc)}); }
`;
  }

  // lower body + greenhouse + arches (mesher only; may use PG.sdf.lib)
  function baseMap() {
    return `
float bd_side(vec3 q) {
  float x = q.x, y = q.y, z = q.z;
  vec2 wv = bdW_2(x); float yw = bdYw(x);
  float dy = y - yw;
  float a = mix(bdAl(x), bdAu(x), bd_sstep(-0.24, 0.24, dy));
  float Ws = wv.x - a * dy * dy;
  float Wy = -2.0 * a * dy;
  // soft horizontal character line along the door (light-catching shoulder), fading out towards the arches
  float shw = bd_sstep(-1.0, -0.65, x) * (1.0 - bd_sstep(0.60, 0.90, x));
  float shu = (y - 0.80) / 0.055;
  Ws += 0.008 * exp(-shu * shu) * shw;
  Wy += 0.008 * exp(-shu * shu) * shw * (-2.0 * shu / 0.055);
  // rolled fender flare: a soft outward bead running around each wheel opening
  float lf = abs(length(q.xy - vec2(${f5(P.arch.front.x)}, ${f5(P.arch.front.y)})) - ${f5(P.arch.front.r + 0.030)});
  float lr = abs(length(q.xy - vec2(${f5(P.arch.rear.x)}, ${f5(P.arch.rear.y)})) - ${f5(P.arch.rear.r + 0.030)});
  float lip = 0.014 * exp(-bd_sq(min(lf, lr) / 0.030));
  float zs = sqrt(z * z + 0.0016);      // smooth |z|: no kink on the centre line (the exponential plan blend has long tails)
  return (zs - Ws - lip) / sqrt(1.0 + Wy * Wy + wv.y * wv.y);
}
float bd_wall(vec3 q) {
  float x = q.x, y = q.y, z = q.z;
  float dSide = bd_side(q);
  // nose / tail faces: convex in plan, x-position is a table of HEIGHT (nose: lid edge overhangs the bumper; tail: bumper bulge, set-back top edge)
  vec2 ns = bdNs_2(y); vec2 ts = bdTs_2(y);
  float zk = z * z;
  float xf = 2.185 - ns.x - 0.050 * zk / 0.49;
  float dFront = (x - xf) / sqrt(1.0 + ns.y * ns.y + bd_sq(0.10 * z / 0.49));
  float xb = -2.317 + ts.x + 0.018 * zk / 0.64;
  float dBack = (xb - x) / sqrt(1.0 + ts.y * ts.y + bd_sq(0.036 * z / 0.64));
  // plan corners: side wall and end faces are blended with a big radius (~0.15-0.3 m)
  float dWall = bd_smaxe(dSide, dFront, 0.20);
  return bd_smaxe(dWall, dBack, 0.10);
}
float bd_lower(vec3 q) {
  float x = q.x, y = q.y, z = q.z;
  // ---- top surface (crowned, with the fender crest hump)
  vec2 tb = bdTb_2(x); float cr = bdCr(x);
  vec2 ca = bdCa_2(x); float zc = bdCz(x); float w = (z < zc) ? bdCwi(x) : bdCwo(x); float u = (z - zc) / w;
  float g = exp(-u * u);
  float H = tb.x - cr * z * z + ca.x * g;
  float Hx = tb.y + ca.y * g;
  float Hz = -2.0 * cr * z - 2.0 * ca.x * g * u / w;
  float dTop = (y - H) / sqrt(1.0 + Hx * Hx + Hz * Hz);
  float dSide = bd_side(q);
  // ---- floor
  vec2 fv = bdF_2(x);
  float dFloor = (fv.x - y) / sqrt(1.0 + fv.y * fv.y);
  float dWall = bd_wall(q);
  float d = bd_smax(dTop, dWall, bdKs(x));
  d = bd_smax(d, dFloor, 0.07);
  return d;
}
float bd_cabin(vec3 q) {
  float x = q.x, y = q.y, z = q.z;
  vec2 rf = bdRf_2(x);
  float crr = bdCR(x);
  float H = rf.x - crr * z * z; float Hz = -2.0 * crr * z;
  float dTop = (y - H) / sqrt(1.0 + rf.y * rf.y + Hz * Hz);
  float dSide = bd_ghSide(x, y, z);
  float d = bd_smax(dTop, dSide, bdKr(x));
  d = bd_smax(d, 0.92 - y, 0.03);
  d = bd_smax(d, bd_wall(q) + 0.002, 0.02);
  d = bd_smax(d, x - 0.90, 0.05);
  return bd_smax(d, -2.10 - x, 0.05);
}
float baseMap(vec3 q) {
  float d = bd_lower(q);
  // the cabin fillet only acts at / above the lower body's top surface (no beads on the flank below the belt)
  float kk = bdKc(q.x) * bd_sstep(-0.07, -0.005, q.y - bd_baseHeight(q.x, q.z));
  d = bd_smin(d, bd_cabin(q), max(kk, 1e-4));
  d = bd_smax(d, bd_wall(q), 0.012);          // the cabin fillet must never bulge outside the flank
  d = bd_smax(d, -bdWellFm(q), 0.035);
  d = bd_smax(d, -bdWellRm(q), 0.035);
  return d;
}
`;
  }

  // ------------------------------------------------------------------------------------------------------- composition
  function featureBlocks() {
    const fs = PG.body.features.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const str = v => (typeof v === 'function' ? v() : v) || '';
    return { fs, str };
  }
  function composeSDF() {
    const { fs, str } = featureBlocks();
    let s = baseCommon();
    for (const f of fs) s += '\n// ---- feature ' + f.name + ' (common)\n' + str(f.common);
    s += '\nfloat bdWellFm(vec3 q) { return bd_wellF(q); }\nfloat bdWellRm(vec3 q) { return bd_wellR(q); }\n' + baseMap();
    for (const f of fs) s += '\n// ---- feature ' + f.name + ' (sdf)\n' + (str(f.sdf) || `float feat_${f.name}(vec3 p, float d) { return d; }`);
    s += '\nfloat map(vec3 p) {\n  p.z = abs(p.z);\n  float d = baseMap(p);\n';
    for (const f of fs) s += `  d = feat_${f.name}(p, d);\n`;
    s += '  return d;\n}\n';
    return s;
  }
  // glass-related functions are provided by the cabin feature; safe stubs otherwise
  function stubs(fs) {
    const has = n => fs.some(f => f.name === 'cabin');
    return has() ? '' : `float cabin_glass(vec3 p) { return 1.0; }\nvoid cabin_glassShade(inout Surf s, vec3 p, vec3 n, float fw) {}\n`;
  }
  const BASE_SHADE = `
void bd_paintBase(inout Surf s, vec3 p, vec3 n, float fw) {
  // underbody / sill bottom / wheel wells: matte black
  float mU = 1.0 - smoothstep(0.150, 0.172, p.y);
  float wF = length(p.xy - vec2(${f5(P.arch.front.x)}, ${f5(P.arch.front.y)})) - ${f5(P.arch.front.r)};
  float wR = length(p.xy - vec2(${f5(P.arch.rear.x)}, ${f5(P.arch.rear.y)})) - ${f5(P.arch.rear.r)};
  float mW = bd_aa(min(wF, wR) - 0.004, fw) * step(p.z, 0.99);
  float m = max(mU, mW);
  vec3 blk = vec3(0.012, 0.012, 0.014);
  s.baseColor = mix(s.baseColor, blk, m); s.metallic = mix(s.metallic, 0.0, m); s.roughness = mix(s.roughness, 0.82, m);
  s.clearcoat = mix(s.clearcoat, 0.0, m); s.flake = mix(s.flake, 0.0, m); s.specular = mix(s.specular, 0.25, m);
}
`;
  function composeHook(kind) {
    const { fs, str } = featureBlocks();
    let s = baseCommon() + '\n';
    for (const f of fs) s += '// ---- feature ' + f.name + ' (common)\n' + str(f.common) + '\n';
    s += stubs(fs) + BASE_SHADE;
    for (const f of fs) s += '// ---- feature ' + f.name + ' (shade)\n' + (str(f.shade) || `void shade_${f.name}(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {}`) + '\n';
    if (kind === 'paint') {
      s += `
void surfaceHook(inout Surf s, in Frag f) {
  vec3 n = f.front ? f.nObj : -f.nObj;                     // unflipped outward normal
  vec3 p = f.pObj; float sg = p.z < 0.0 ? -1.0 : 1.0; p.z = abs(p.z); n.z *= sg;
  float fw = f.fw;
  if (cabin_glass(p) < 0.0) { s.discardFrag = true; return; }
  if (!f.front) {                                            // inside of the shell (seen through the windows): dark trim
    s.baseColor = vec3(0.012); s.metallic = 0.0; s.roughness = 0.9; s.clearcoat = 0.0; s.flake = 0.0; s.specular = 0.15;
    return;
  }
  bd_paintBase(s, p, n, fw);
`;
      for (const f of fs) s += `  shade_${f.name}(s, p, n, f.attr, sg, fw);\n`;
      s += '}\n';
    } else {
      s += `
void surfaceHook(inout Surf s, in Frag f) {
  vec3 n = f.front ? f.nObj : -f.nObj;
  vec3 p = f.pObj; float sg = p.z < 0.0 ? -1.0 : 1.0; p.z = abs(p.z); n.z *= sg;
  if (cabin_glass(p) >= 0.0) { s.discardFrag = true; return; }
  cabin_glassShade(s, p, n, f.fw);
}
`;
    }
    return s;
  }
  PG.body.composeSDF = composeSDF; PG.body.composeHook = composeHook;

  // ------------------------------------------------------------------------------------------------------- module
  PG.registerModule({
    name: 'body', order: 10,
    async build(ctx) {
      const { renderer, gl } = ctx;
      const voxel = (+ctx.params.get('bodyvoxel') || 0.008) * ctx.quality;
      const t0 = performance.now();
      ctx.progress('meshing body', 0.02);
      const sdfSrc = composeSDF();
      const attrSrc = `vec4 attr(vec3 p, vec3 n) { p.z = abs(p.z); return vec4(0.0, cabin_glass(p), 0.0, 0.0); }`;
      const mesh = await PG.sdf.mesh(gl, {
        label: 'body', glsl: sdfSrc + '\n' + (PG.body.features.some(f => f.name === 'cabin') ? '' : 'float cabin_glass(vec3 p) { return 1.0; }\n'), attr: attrSrc,
        min: [-2.40, 0.0, -1.05], max: [2.40, 1.42, 1.05], voxel, aoScale: 0.12,
        onProgress: f => ctx.progress('meshing body', 0.02 + 0.75 * f),
      });
      const msMesh = performance.now() - t0;
      ctx.progress('uploading body', 0.8);
      const gpu = renderer.upload(mesh);
      const bodyMat = PG.mats.paint.derive({ name: 'bodyPaint', hook: composeHook('paint'), doubleSided: true });
      const glassMat = PG.mats.glass.derive({ name: 'bodyGlass', hook: composeHook('glass') });
      const body = ctx.add({ name: 'body', mesh: gpu, material: bodyMat });
      // glass subset: triangles with a vertex within a margin of a glass region (attrs.y = cabin_glass at the vertex)
      const A = mesh.attrs, I = mesh.indices, idx = [], margin = 0.03;
      for (let t = 0; t < I.length; t += 3) {
        if (A[I[t] * 4 + 1] < margin || A[I[t + 1] * 4 + 1] < margin || A[I[t + 2] * 4 + 1] < margin) idx.push(I[t], I[t + 1], I[t + 2]);
      }
      const glassGpu = gpu.subset(idx);
      const glass = ctx.add({ name: 'body_glass', mesh: glassGpu, material: glassMat, castShadow: false, reflect: true });

      ctx.progress('building raycaster', 0.9);
      const t1 = performance.now();
      const raycaster = PG.geo.raycaster(mesh, { leafSize: 4 });
      const msRay = performance.now() - t1;
      const bounds = { min: [-2.317, 0.10, -0.95], max: [2.205, 1.28, 0.95] };
      const shared = ctx.shared.body = {
        mesh, gpu, raycaster, bounds, features: PG.body.features, parts: { body, glass }, materials: { body: bodyMat, glass: glassMat }, voxel, stats: mesh.stats,
        heightAt: (x, z) => raycaster.heightAt(x, z, 2.0),
        halfWidthAt: (x, y) => {           // outermost |z| of the body at (x, y): horizontal ray from outside
          const a = raycaster.cast([x, y, 1.5], [0, 0, -1]), b = raycaster.cast([x, y, -1.5], [0, 0, 1]);
          return Math.max(a ? Math.abs(a.point[2]) : 0, b ? Math.abs(b.point[2]) : 0) || null;
        },
        profile: P,
      };
      PG.bodyStats = { msMesh, msRaycaster: msRay, verts: mesh.stats.verts, tris: mesh.stats.tris, glassTris: idx.length / 3, voxel, sdf: mesh.stats, msTotal: performance.now() - t0 };
      PG.log(`body B: ${mesh.stats.verts} verts, ${mesh.stats.tris} tris (glass subset ${idx.length / 3}), voxel ${(voxel * 1000).toFixed(1)} mm, mesh ${msMesh.toFixed(0)} ms, raycaster ${msRay.toFixed(0)} ms`);
    },
  });
})();
