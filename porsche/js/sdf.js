'use strict';
/* sdf.js - GPU signed-distance-field -> mesh pipeline + GLSL SDF library  (window.PG.sdf)
 *
 * PUBLIC API
 * ---------------------------------------------------------------------------------------------------------------
 *   const mesh = await PG.sdf.mesh(gl, opts)
 *     opts.glsl       REQUIRED  GLSL ES 3.00 source that defines `float map(vec3 p)` (negative inside, ~metric).
 *                               PG.sdf.lib is prepended automatically (do not redefine its function names). You may declare
 *                               helper functions and consts; do not declare uniforms. Everything is highp float.
 *     opts.min, opts.max  REQUIRED  [x,y,z] bounds in metres. The SDF is CLIPPED (intersected) with this box: anything that
 *                               crosses the bounds is closed by a flat cap exactly on the bounds, so the mesh is always
 *                               watertight. The evaluation grid extends 2.5 cells beyond the box on every side and those
 *                               outermost nodes are guaranteed outside. (opts.clip=false disables the clip; only safe when the
 *                               shape stays >= 3 cells inside the bounds.)
 *     opts.voxel      REQUIRED  cell size in metres (car body: 0.008 * ctx.quality; small parts: 0.0015 .. 0.003).
 *     opts.attr       optional  `vec4 attr(vec3 p, vec3 n)`, evaluated at every final vertex -> mesh.attrs. x is ALWAYS replaced by
 *                               the baked ambient occlusion (0..1) unless opts.attrFull=true (then the whole vec4 is yours);
 *                               the global `float sdfAO` (0..1) is readable inside attr(). Without opts.attr: attrs = vec4(ao,0,0,0).
 *     opts.label      string used in logs and shader-error messages.
 *     opts.onProgress(frac)   called ~30x/s with 0..1; the mesher yields to the event loop every ~25 ms (max gap seen: 35-60 ms
 *                             warm; the first draw of a NEW heavy shader can block 100-700 ms while the driver builds the pipeline).
 *     -- tuning (all optional) --
 *     opts.sharp=true       dual-contouring style vertex placement: least-squares intersection of the tangent planes measured at the
 *                           (Newton-refined) edge crossings. Keeps creases/corners crisp (exact box corners, clean hole rims) and is
 *                           sub-voxel accurate on smooth surfaces (sphere r=300 mm @10 mm voxels: 0.11 mm max radial error).
 *                           false = surface-nets vertices projected with `newton` gradient steps (rounds creases to voxel size).
 *     opts.qefBias=0.01     regularisation towards the crossing centroid (0.002 = crispest, 0.1 = smoother / rounder features)
 *     opts.qefEps=0.1       gradient epsilon (in voxels) used to measure the crossing normals (small = crisp creases)
 *     opts.newton=0|3       extra Newton projection iterations (default 0 when sharp, 3 when not sharp); opts.maxMove=1.0 voxel cap
 *     opts.normalEps=0.4    gradient epsilon in voxels for the final vertex normal (raise to ~1 to smooth fine facets / noise)
 *     opts.aoScale=0.15     ambient-occlusion reach in metres (0.03 .. 0.35 typical), opts.aoStrength=1.3 (0 disables AO)
 *                           AO = 5 map() samples along the normal: mean over samples of clamp(1 - d/h, 0, 1), h = aoScale*i/5.
 *     opts.coarse=4         empty-space skipping block size in cells (0 = evaluate every node, ~3x slower). One map() sample per
 *                           KxKxK block centre and the bound |d| > lipschitz*0.866*K*voxel decide whether a block is empty.
 *     opts.lipschitz=1.5    safety factor of that bound: raise (2..3) if your SDF over-estimates distance (heavy warps/scaling);
 *                           symptom of a too-small value = missing chunks of surface.
 *     opts.maxCells=3e8     hard cap on grid cells; a clear Error is thrown if exceeded (slice nx*ny is also capped at 25 M).
 *     opts.post=true        false skips the GPU refinement pass (surface-nets positions, averaged face normals, ao = 1).
 *     opts.debug=false      extra GL error checks / timing probes.
 *   Returns  { positions:Float32Array(3n), normals:Float32Array(3n), attrs:Float32Array(4n), indices:Uint16Array|Uint32Array,
 *              stats:{ verts, tris, cells, dims, voxel, msCompile, msGPU, msMesh, msPost, msPostGPU, msQEF, msTotal, skipFrac } }
 *   (ARCHITECTURE.md sec. 4). Triangles are CCW seen from outside; normals are analytic (gradient of map), unit length, outward,
 *   in the same space as the SDF. Indices are Uint16 when verts <= 65535. Stats are also logged with PG.log.
 *   Calls on one GL context are serialised internally; compiled programs are cached by source hash (repeat calls are cheap).
 *   Thin features: a wall thinner than ~1 voxel can vanish (no grid node inside it); walls of 1-2 voxels are captured but poorly
 *   shaded. Keep walls >= 2-3 voxels, or mesh them separately with a finer voxel (tools/test_sdf.html?test=thin documents this).
 *   Topology: naive surface nets can produce a few non-manifold edges at ambiguous cells (0.01% of edges); boundary edges are 0.
 *
 *   PG.sdf.meshMany(gl, [opts...])            -> Promise<mesh[]>   sequential convenience wrapper (shares compiled programs)
 *   PG.sdf.sample(gl, glslWithMap, Float32Array xyz [, {clip:true,min,max}]) -> Promise<Float32Array> of map() values (GPU; tests)
 *   PG.sdf.lib                                the GLSL library string (every function documented in place; unit-tested by
 *                                             tools/test_sdf.html?test=lib, 116 value checks)
 *   PG.sdf.tableGLSL(name, floatArray, {x0:0, x1:1})
 *        -> GLSL: `const int name_n`, `const float name[n]`, `float name_lin(float x)` (piecewise-linear, clamped, x in
 *           [x0,x1] mapped over the array), `float name_cr(float x)` (Catmull-Rom cubic through the samples).
 *   PG.sdf.polygonGLSL(name, [[x,y],...])     -> GLSL `float name(vec2 p)`: signed distance to that closed polygon (3..64 pts).
 *   PG.sdf.loftGLSL(name, stations, opts)     -> GLSL `float name(vec3 p)`: loft along X through closed cross-sections; see the
 *                                                doc block above that function for the exact semantics and options.
 *   PG.sdf.clearCache(gl)                     delete the cached shader programs of that context
 *   PG.sdf.debugGL(gl, on)                    enable GL error checks for that context
 *
 * PIPELINE (all on the passed WebGL2 context; GL state is saved/restored around every synchronous chunk):
 *   1. ONE shader program evaluates the clipped map() at grid nodes. A coarse pass (1 sample per KxKxK block centre) finds the
 *      empty blocks; fine evaluation skips nodes whose blocks are all empty (per-fragment early-out) and only the bounding
 *      rectangle of the non-empty blocks is drawn/read per slice; wholly empty slices are skipped.
 *   2. Slices are rendered to an R32F target and copied into pixel-pack buffers (3 slices in flight, asynchronous), then fetched
 *      into a 2-slice rolling window: the full volume is never held in memory.
 *   3. CPU naive surface nets on typed arrays (growable vertex / quad arrays), one vertex per sign-changing cell.
 *   4. GPU pass 1 (sharp): normal + refinement step for every crossing edge (one sample tetrahedron per edge, shared by the 4 quads
 *      around it), CPU least-squares solve per vertex; GPU pass 2: analytic normal, baked AO, user attr at the final positions
 *      (RGBA32F textures 2048 wide, batches of 131k vertices).
 *   5. Quads -> triangles, choosing the flatter diagonal from the refined positions.
 * Measured (M-series, headless Chrome): 300-primitive car-scale SDF, 4.7x2.0x1.4 m @ 8 mm (25.7 M cells): ~0.55-0.65 s warm,
 * ~1.5 s with a cold shader cache, 0.9 M vertices; 1.5 mm wheel (17.7 M cells): 0.5 s.
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PG = root.PG = root.PG || {};
  const sdf = PG.sdf = PG.sdf || {};

  // =================================================================================================================
  //  GLSL LIBRARY
  // =================================================================================================================
  const LIB = /* glsl */`
// ---------------------------------------------------------------- PG.sdf.lib (GLSL ES 3.00, highp)
// Conventions: distances in metres; negative inside. "p" is the sample point in the shape's local space.
// To transform a shape: evaluate at the inverse-transformed point, e.g. rotate by +a about Z:  sdf(p * rotZ(a)) ;
// translate: sdf(p - offset). Scale s: sdf(p / s) * s.
#define PG_PI 3.14159265358979
#define PG_TAU 6.28318530717959

// ---------------------------------------------------------------- tiny helpers
float sq(float x) { return x * x; }
float dot2(vec2 v) { return dot(v, v); }
float dot2(vec3 v) { return dot(v, v); }
float ndot(vec2 a, vec2 b) { return a.x * b.x - a.y * b.y; }
float saturate(float x) { return clamp(x, 0.0, 1.0); }
float remap(float x, float a, float b, float c, float d) { return c + (d - c) * (x - a) / (b - a); }
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); } // smoothstep, any edge order
float sstep5(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float plin(float x, float x0, float x1, float y0, float y1) { return mix(y0, y1, clamp((x - x0) / (x1 - x0), 0.0, 1.0)); } // clamped linear map

// ---------------------------------------------------------------- smooth min / max (k = blend width in metres)
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }        // quadratic
float smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
float sminC(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * h * k * (1.0 / 6.0); } // cubic (C2)
float smaxC(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * h * k * (1.0 / 6.0); }
float sminE(float a, float b, float k) { float r = exp2(-k * a) + exp2(-k * b); return -log2(r) / k; }                          // exponential, k ~ 1/width (e.g. 30)
float smaxE(float a, float b, float k) { float r = exp2(k * a) + exp2(k * b); return log2(r) / k; }
float sSub(float a, float b, float k) { return smax(a, -b, k); }     // smooth subtract: a minus b
float sInter(float a, float b, float k) { return smax(a, b, k); }    // smooth intersect
float minChamfer(float a, float b, float r) { return min(min(a, b), (a - r + b) * 0.70710678); }
float maxChamfer(float a, float b, float r) { return max(max(a, b), (a + r + b) * 0.70710678); }
// smin that also returns the blend weight of b in .y (0 = all a, 1 = all b): handy for masks
vec2 sminW(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; float m = h * h * 0.5; float s = m * k * 0.5; return (a < b) ? vec2(a - s, m) : vec2(b - s, 1.0 - m); }

// ---------------------------------------------------------------- 3D primitives (all centred at the origin)
float sdSphere(vec3 p, float r) { return length(p) - r; }
// ellipsoid with semi-axes r; good first-order approximation (exact on the surface, ~metric near it)
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r); float k1 = length(p / (r * r));
  if (k1 < 1e-9) return -min(r.x, min(r.y, r.z));
  return k0 * (k0 - 1.0) / k1;
}
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }   // b = half extents
float sdRoundBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; } // b = OUTER half extents
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdSegment(vec3 p, vec3 a, vec3 b) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0); return length(pa - ba * h); } // unsigned
// capsule with different end radii (r1 at a, r2 at b)
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba); float rr = r1 - r2; float a2 = l2 - rr * rr; float il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba); float z = y - l2; float x2 = dot2(pa * l2 - ba * y); float y2 = y * y * l2; float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
// infinite cylinders along an axis (r = radius)
float sdCylinderX(vec3 p, float r) { return length(p.yz) - r; }
float sdCylinderY(vec3 p, float r) { return length(p.xz) - r; }
float sdCylinderZ(vec3 p, float r) { return length(p.xy) - r; }
// capped cylinders along an axis (r = radius, h = HALF length)
float sdCappedCylinderX(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.yz), p.x)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdCappedCylinderY(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdCappedCylinderZ(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
// capped cylinder with rounded rims along Y: radius ra (outer incl. rounding), half-length h, rounding rb
float sdRoundedCylinderY(vec3 p, float ra, float rb, float h) { vec2 d = vec2(length(p.xz) - ra + rb, abs(p.y) - h + rb); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rb; }
// capped cylinder between two points a,b with radius r (exact)
float sdCylinderAB(vec3 p, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, pa = p - a; float baba = dot(ba, ba), paba = dot(pa, ba);
  float x = length(pa * baba - ba * paba) - r * baba; float y = abs(paba - baba * 0.5) - baba * 0.5;
  float x2 = x * x, y2 = y * y * baba;
  float d = (max(x, y) < 0.0) ? -min(x2, y2) : (((x > 0.0) ? x2 : 0.0) + ((y > 0.0) ? y2 : 0.0));
  return sign(d) * sqrt(abs(d)) / baba;
}
// exact cone along Y: tip at the origin, opening towards -Y, c = vec2(sin,cos) of the half angle, h = height (base at y=-h)
float sdCone(vec3 p, vec2 c, float h) {
  vec2 q = h * vec2(c.x / c.y, -1.0); vec2 w = vec2(length(p.xz), p.y);
  vec2 a = w - q * clamp(dot(w, q) / dot(q, q), 0.0, 1.0);
  vec2 b = w - q * vec2(clamp(w.x / q.x, 0.0, 1.0), 1.0);
  float k = sign(q.y); float d = min(dot(a, a), dot(b, b));
  float s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));
  return sqrt(d) * sign(s);
}
// exact capped cone (frustum) along Y: half-height h, radius r1 at y=-h, r2 at y=+h
float sdCappedCone(vec3 p, float h, float r1, float r2) {
  vec2 q = vec2(length(p.xz), p.y); vec2 k1 = vec2(r2, h); vec2 k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
// torus: ring radius R, tube radius r. sdTorus = axis Y (ring in XZ), X = axis X (ring in YZ), Z = axis Z (ring in XY)
float sdTorus(vec3 p, float R, float r) { return length(vec2(length(p.xz) - R, p.y)) - r; }
float sdTorusX(vec3 p, float R, float r) { return sdTorus(p.yxz, R, r); }
float sdTorusZ(vec3 p, float R, float r) { return sdTorus(p.xzy, R, r); }
// plane with unit normal n:  dot(p,n) + h  (points with dot(p,n) < -h are inside)
float sdPlane(vec3 p, vec3 n, float h) { return dot(p, n) + h; }

// ---------------------------------------------------------------- 2D primitives (return signed distance in the plane)
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox2(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdRoundBox2(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; } // b = outer half extents
float sdSegment2(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0); return length(pa - ba * h); } // unsigned
// exact ellipse distance, semi-axes ab
float sdEllipse2(vec2 p, vec2 ab) {
  if (abs(ab.x - ab.y) < 1e-5 * max(ab.x, ab.y)) return length(p) - ab.x;
  p = abs(p); if (p.x > p.y) { p = p.yx; ab = ab.yx; }
  float l = ab.y * ab.y - ab.x * ab.x;
  float m = ab.x * p.x / l; float m2 = m * m;
  float n = ab.y * p.y / l; float n2 = n * n;
  float c = (m2 + n2 - 1.0) / 3.0; float c3 = c * c * c;
  float q = c3 + m2 * n2 * 2.0; float d = c3 + m2 * n2; float g = m + m * n2; float co;
  if (d < 0.0) {
    float h = acos(clamp(q / c3, -1.0, 1.0)) / 3.0; float s = cos(h); float t = sin(h) * 1.7320508;
    float rx = sqrt(max(-c * (s + t + 2.0) + m2, 0.0)); float ry = sqrt(max(-c * (s - t + 2.0) + m2, 0.0));
    co = (ry + sign(l) * rx + abs(g) / max(rx * ry, 1e-12) - m) / 2.0;
  } else {
    float h = 2.0 * m * n * sqrt(d);
    float s = sign(q + h) * pow(abs(q + h), 1.0 / 3.0); float u = sign(q - h) * pow(abs(q - h), 1.0 / 3.0);
    float rx = -s - u - c * 4.0 + 2.0 * m2; float ry = (s - u) * 1.7320508; float rm = sqrt(rx * rx + ry * ry);
    co = (ry / sqrt(max(rm - rx, 1e-12)) + 2.0 * g / max(rm, 1e-12) - m) / 2.0;
  }
  co = clamp(co, 0.0, 1.0);
  vec2 r = ab * vec2(co, sqrt(1.0 - co * co));
  return length(r - p) * sign(p.y - r.y);
}
// isosceles trapezoid: bottom half-width r1 at y=-he, top half-width r2 at y=+he
float sdTrapezoid2(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he); vec2 k2 = vec2(r2 - r1, 2.0 * he); p.x = abs(p.x);
  vec2 ca = vec2(max(0.0, p.x - ((p.y < 0.0) ? r1 : r2)), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
// arbitrary closed polygon (any winding, concave OK), n <= 64 vertices in v[0..n-1]. Declare the array as vec2 v[64].
// For a fixed polygon prefer PG.sdf.polygonGLSL(name, pts) which generates an exact-size function.
float sdPolygon2(vec2 p, vec2 v[64], int n) {
  float d = dot(p - v[0], p - v[0]); float s = 1.0;
  for (int i = 0, j = n - 1; i < n; j = i, i++) {
    vec2 e = v[j] - v[i]; vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

// ---------------------------------------------------------------- 2D -> 3D
// extrude a 2D distance d2 along an axis: z = coordinate along the extrusion axis, h = HALF depth (exact)
float opExtrude(float d2, float z, float h) { vec2 w = vec2(d2, abs(z) - h); return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)); }
// revolve helpers: (axial, radial) coordinates of p for a solid of revolution about an axis through the origin. Feed the
// result to any 2D SDF whose shape lies in the radial >= 0 half plane:  d = sdPolygon2(revolveX(p), ...)  -> exact.
vec2 revolveX(vec3 p) { return vec2(p.x, length(p.yz)); }
vec2 revolveY(vec3 p) { return vec2(p.y, length(p.xz)); }
vec2 revolveZ(vec3 p) { return vec2(p.z, length(p.xy)); }
// revolve a 2D shape defined in (x = distance from axis - o, y = axial) around Y at offset o (torus-like):  sdCircle(opRevolveY(p, R), r) = torus
vec2 opRevolveY(vec3 p, float o) { return vec2(length(p.xz) - o, p.y); }

// ---------------------------------------------------------------- rotations. rotX(a)*p rotates p by +a (right-handed) about X.
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 rotAxis(vec3 ax, float a) {
  ax = normalize(ax); float c = cos(a), s = sin(a), t = 1.0 - c;
  return mat3(t * ax.x * ax.x + c, t * ax.x * ax.y + s * ax.z, t * ax.x * ax.z - s * ax.y,
              t * ax.x * ax.y - s * ax.z, t * ax.y * ax.y + c, t * ax.y * ax.z + s * ax.x,
              t * ax.x * ax.z + s * ax.y, t * ax.y * ax.z - s * ax.x, t * ax.z * ax.z + c);
}

// ---------------------------------------------------------------- domain operations
// mirror / fold: use abs(p.z) for left-right symmetric bodies
vec3 opMirrorX(vec3 p) { return vec3(abs(p.x), p.y, p.z); }
vec3 opMirrorY(vec3 p) { return vec3(p.x, abs(p.y), p.z); }
vec3 opMirrorZ(vec3 p) { return vec3(p.x, p.y, abs(p.z)); }
vec3 opMirrorPlane(vec3 p, vec3 n, float h) { float d = dot(p, n) - h; return p - 2.0 * min(d, 0.0) * n; }  // reflect the part behind the plane (unit n) to the front
// polar repetition of a 2D point around the origin into n sectors; the result lies in the sector centred on +x (angle 0)
vec2 opPolar2(vec2 p, float n) { float sec = PG_TAU / n; float a = atan(p.y, p.x); a = mod(a + 0.5 * sec, sec) - 0.5 * sec; return length(p) * vec2(cos(a), sin(a)); }
// same, also returns the (integer valued) sector index in idx
vec2 opPolar2i(vec2 p, float n, out float idx) { float sec = PG_TAU / n; float a = atan(p.y, p.x) + 0.5 * sec; idx = floor(a / sec); a = a - sec * idx - 0.5 * sec; return length(p) * vec2(cos(a), sin(a)); }
// n-fold polar repetition about an axis (spokes, bolts): the object should be modelled in the sector centred on
//   X-axis version: +Y direction (angle measured in the YZ plane, u = y);  Y-axis: +Z (u = z, v = x);  Z-axis: +X (u = x, v = y)
vec3 opPolarX(vec3 p, float n) { return vec3(p.x, opPolar2(p.yz, n)); }
vec3 opPolarY(vec3 p, float n) { vec2 q = opPolar2(p.zx, n); return vec3(q.y, p.y, q.x); }
vec3 opPolarZ(vec3 p, float n) { return vec3(opPolar2(p.xy, n), p.z); }
vec3 opPolar(vec3 p, float n) { return opPolarZ(p, n); }   // default: about Z (the wheel axis in car space)
// cartesian repetition: infinite (period c) and limited to +-l repetitions
float opRep1(float x, float c) { return mod(x + 0.5 * c, c) - 0.5 * c; }
vec3 opRep(vec3 p, vec3 c) { return mod(p + 0.5 * c, c) - 0.5 * c; }
vec3 opRepLim(vec3 p, float c, vec3 l) { return p - c * clamp(round(p / c), -l, l); }
// twist about an axis: k = radians per metre
vec3 opTwistX(vec3 p, float k) { float a = k * p.x; float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
vec3 opTwistY(vec3 p, float k) { float a = k * p.y; float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
vec3 opTwistZ(vec3 p, float k) { float a = k * p.z; float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
// bend: the X axis is bent towards Y (opBendXY) or Z (opBendXZ); k = curvature in 1/m. (multiply d by ~0.8 for large k)
vec3 opBendXY(vec3 p, float k) { float a = k * p.x; float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
vec3 opBendXZ(vec3 p, float k) { float a = k * p.x; float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
// taper: scales the cross-section perpendicular to the axis by s = 1 + k*axisCoord. Returned distance must be multiplied by
// min(1, s) for a conservative metric:  d = sdf(opTaperX(p,k)) * max(0.2, min(1.0, 1.0 + k * p.x))
vec3 opTaperX(vec3 p, float k) { float s = max(1.0 + k * p.x, 0.05); return vec3(p.x, p.yz / s); }
vec3 opTaperY(vec3 p, float k) { float s = max(1.0 + k * p.y, 0.05); return vec3(p.x / s, p.y, p.z / s); }
vec3 opTaperZ(vec3 p, float k) { float s = max(1.0 + k * p.z, 0.05); return vec3(p.xy / s, p.z); }
// distance modifiers
float opOnion(float d, float t) { return abs(d) - t; }        // hollow shell of thickness 2t
float opRound(float d, float r) { return d - r; }             // round every edge by r (shape grows by r)
vec3 opElongate(vec3 p, vec3 h) { return p - clamp(p, -h, h); } // stretch a primitive by +-h (use as the sample point)

// ---------------------------------------------------------------- hash / noise
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
// value noise in [0,1], smooth (C1), period ~1 unit
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// fractal brownian motion of vnoise, oct octaves (<= 8), roughly [0,1)
float fbm(vec3 p, int oct) { float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); n += a; p = p * 2.03 + vec3(17.1, 9.2, 5.3); a *= 0.5; } return s / max(n, 1e-6); }
float fbm(vec3 p) { return fbm(p, 4); }

// ---------------------------------------------------------------- splines / tables
float catmullRom(float p0, float p1, float p2, float p3, float t) {
  float t2 = t * t, t3 = t2 * t;
  return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}
vec2 catmullRom(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
  float t2 = t * t, t3 = t2 * t;
  return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}
vec3 catmullRom(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float t2 = t * t, t3 = t2 * t;
  return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}
// piecewise-linear table lookup over 4 / 8 knots (xs ascending), clamped at the ends
float pwl4(float x, vec4 xs, vec4 ys) {
  if (x <= xs.x) return ys.x; if (x >= xs.w) return ys.w;
  int i = (x >= xs.z) ? 2 : ((x >= xs.y) ? 1 : 0);
  return mix(ys[i], ys[i + 1], (x - xs[i]) / (xs[i + 1] - xs[i]));
}
float pwl8(float x, vec4 xa, vec4 xb, vec4 ya, vec4 yb) {
  float xs[8] = float[8](xa.x, xa.y, xa.z, xa.w, xb.x, xb.y, xb.z, xb.w);
  float ys[8] = float[8](ya.x, ya.y, ya.z, ya.w, yb.x, yb.y, yb.z, yb.w);
  if (x <= xs[0]) return ys[0]; if (x >= xs[7]) return ys[7];
  int i = 0; for (int k = 1; k < 7; k++) { if (x >= xs[k]) i = k; }
  return mix(ys[i], ys[i + 1], (x - xs[i]) / (xs[i + 1] - xs[i]));
}
// ---------------------------------------------------------------- end of PG.sdf.lib
`;
  sdf.lib = LIB;

  // =================================================================================================================
  //  JS HELPERS THAT EMIT GLSL
  // =================================================================================================================
  const fnum = x => { if (!isFinite(x)) throw new Error('PG.sdf: non-finite number in generated GLSL'); let s = (+x).toFixed(6); return s === '-0.000000' ? '0.000000' : s; };

  sdf.tableGLSL = function (name, arr, opts) {
    opts = opts || {}; const n = arr.length; if (n < 2) throw new Error('tableGLSL needs >= 2 samples');
    const x0 = opts.x0 !== undefined ? opts.x0 : 0, x1 = opts.x1 !== undefined ? opts.x1 : 1;
    const vals = Array.from(arr, fnum).join(', ');
    return `const int ${name}_n = ${n};
const float ${name}[${n}] = float[${n}](${vals});
float ${name}_lin(float x) { float u = clamp((x - (${fnum(x0)})) / (${fnum(x1 - x0)}), 0.0, 1.0) * float(${n - 1}); int i = min(int(u), ${n - 2}); return mix(${name}[i], ${name}[i + 1], u - float(i)); }
float ${name}_cr(float x) { float u = clamp((x - (${fnum(x0)})) / (${fnum(x1 - x0)}), 0.0, 1.0) * float(${n - 1}); int i = min(int(u), ${n - 2}); float t = u - float(i);
  return catmullRom(${name}[max(i - 1, 0)], ${name}[i], ${name}[i + 1], ${name}[min(i + 2, ${n - 1})], t); }
`;
  };

  sdf.polygonGLSL = function (name, pts) {
    const n = pts.length; if (n < 3 || n > 64) throw new Error('polygonGLSL: 3..64 vertices required');
    const vs = pts.map(p => `vec2(${fnum(p[0])}, ${fnum(p[1])})`).join(', ');
    return `const vec2 ${name}_v[${n}] = vec2[${n}](${vs});
float ${name}(vec2 p) {
  float d = dot(p - ${name}_v[0], p - ${name}_v[0]); float s = 1.0;
  for (int i = 0, j = ${n - 1}; i < ${n}; j = i, i++) {
    vec2 e = ${name}_v[j] - ${name}_v[i]; vec2 w = p - ${name}_v[i];
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= ${name}_v[i].y, p.y < ${name}_v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}
`;
  };

  /* LOFT along X.
   *   stations = [{ x, pts:[[y,z], ...] }, ...]   >= 2 stations (sorted by x automatically); every station has the SAME number
   *              N (>=3, <=64) of vertices, y = up, z = lateral (car right). Each station is a closed polygon (last vertex
   *              connects to the first); winding direction is irrelevant, but vertex k must correspond across stations.
   *   opts.symmetric=false   if true the points describe only the z >= 0 half, running from one point on the z=0 plane
   *                          (e.g. roof centre) to another point on z=0 (e.g. floor centre); the solid is mirrored (abs(p.z))
   *                          and the closing edge along z=0 is not a boundary.
   *   opts.subdivide=1       n > 1 refines every section with a closed Catmull-Rom curve (n output points per input segment,
   *                          also for the symmetric half) BEFORE emitting GLSL: smooth sections from few control points.
   *                          Keep the refined vertex count <= 128 (cost per map() call is O(N)).
   *   opts.linear=false      linear instead of cubic interpolation between stations.
   *   opts.tension=1         scales the Catmull-Rom tangents (0 = ease-in/out, 1 = Catmull-Rom, > 1 overshoots).
   *   opts.smoothNormals=true  near the surface the 2D distance is dot(p - closestPoint, n) + sag(t), with n the Phong-interpolated
   *                          (vertex-averaged) outward normal of the section polygon and sag(t) a tiny quadratic term (<< 1/10
   *                          of an edge length x angle) that cancels the gradient's dependence on the edge parameter: the zero
   *                          set stays within ~0.1 mm of the polygon but the GRADIENT (= mesh normals) is continuous around the
   *                          section: no facet banding in reflections. Costs ~1.3x more per map() call.
   *   opts.lipschitz=true    divide the 2D distance by sqrt(1+s^2), s = normal speed of the section boundary along x, which
   *                          restores |grad| ~ 1 exactly for locally planar walls (no correction -> distances are too large
   *                          where the hull tapers quickly, and Newton projection / AO would over-shoot).
   * Semantics: the section polygon at position x is obtained per vertex by cubic Hermite interpolation with Catmull-Rom
   * (finite-difference, non-uniform spacing aware) tangents over x. d2 = signed 2D polygon distance of (p.y, p.z) to that
   * section (negative inside). Beyond the first / last station the end section is held and the solid is capped by the plane
   * x = x_first / x_last:  d = min(max(d2c, xcap), 0) + length(max(vec2(d2c, xcap), 0)),  xcap = max(x0 - x, x - xN).
   * The result is NOT an exact SDF (sections only approximate the true offset) but it is Lipschitz-corrected and metric enough
   * for meshing, smooth blending and Newton projection.  Generated function:  float name(vec3 p).
   * Extra consts emitted: name_S (station count) and name_N (vertices per station).
   */
  // closed periodic Catmull-Rom refinement of a polygon: `sub` output points per input segment
  function subdivideLoop(pts, sub) {
    const n = pts.length, out = [], cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let s = 0; s < sub; s++) { const t = s / sub; out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]); }
    }
    return out;
  }
  function refineSection(pts, sub, symmetric) {
    if (!(sub > 1)) return pts;
    if (!symmetric) return subdivideLoop(pts, sub);
    const n = pts.length, full = pts.concat(pts.slice(1, n - 1).reverse().map(p => [p[0], -p[1]]));
    return subdivideLoop(full, sub).slice(0, (n - 1) * sub + 1);
  }
  sdf.loftGLSL = function (name, stations, opts) {
    opts = opts || {};
    const sub = opts.subdivide | 0;
    if (sub > 1) stations = stations.map(s => ({ x: s.x, pts: refineSection(s.pts, sub, !!opts.symmetric) }));
    const st = stations.slice().sort((a, b) => a.x - b.x);
    const S = st.length, N = st[0].pts.length;
    if (S < 2) throw new Error('loftGLSL: need >= 2 stations');
    if (N < 3 || N > 128) throw new Error('loftGLSL: 3..128 points per station (after subdivision)');
    st.forEach((s, i) => { if (s.pts.length !== N) throw new Error(`loftGLSL: station ${i} has ${s.pts.length} pts, expected ${N}`); if (i && !(s.x > st[i - 1].x)) throw new Error('loftGLSL: duplicate station x'); });
    const smoothN = opts.smoothNormals !== false;
    // winding of the (mirrored) section: +1 if counter-clockwise in the (y,z) plane
    const ring = sym0 => { const p0 = st[0].pts; const full = sym0 ? p0.concat(p0.slice(1, p0.length - 1).reverse().map(p => [p[0], -p[1]])) : p0; let a = 0; for (let i = 0; i < full.length; i++) { const u = full[i], v = full[(i + 1) % full.length]; a += u[0] * v[1] - v[0] * u[1]; } return a >= 0 ? 1 : -1; };
    const sym = !!opts.symmetric, orient = fnum(ring(!!opts.symmetric)), linear = !!opts.linear, tension = opts.tension !== undefined ? opts.tension : 1, lip = opts.lipschitz !== false;
    const P = [], M = [];
    for (let s = 0; s < S; s++) for (let k = 0; k < N; k++) {
      P.push(`vec2(${fnum(st[s].pts[k][0])}, ${fnum(st[s].pts[k][1])})`);
      const a = st[Math.max(s - 1, 0)], b = st[Math.min(s + 1, S - 1)], dx = b.x - a.x;
      const m = [0, 1].map(c => tension * (b.pts[k][c] - a.pts[k][c]) / dx);
      M.push(`vec2(${fnum(m[0])}, ${fnum(m[1])})`);
    }
    const X = st.map(s => fnum(s.x)).join(', ');
    const interp = linear
      ? `V[k] = mix(a, b, t); W[k] = (b - a) / dx;`
      : `vec2 ma = ${name}_M[s * ${N} + k] * dx, mb = ${name}_M[(s + 1) * ${N} + k] * dx;
    V[k] = h00 * a + h10 * ma + h01 * b + h11 * mb; W[k] = (dh00 * a + dh10 * ma + dh01 * b + dh11 * mb) / dx;`;
    return `const int ${name}_S = ${S};
const int ${name}_N = ${N};
const float ${name}_X[${S}] = float[${S}](${X});
const vec2 ${name}_P[${S * N}] = vec2[${S * N}](${P.join(', ')});
const vec2 ${name}_M[${S * N}] = vec2[${S * N}](${M.join(', ')});
${smoothN ? `vec2 ${name}_en(vec2 a, vec2 b) { vec2 e = b - a; return ${orient} * vec2(-e.y, e.x) / max(length(e), 1e-9); }
vec2 ${name}_vn(int i, vec2 V[${N}]) {
  ${sym ? `vec2 n1 = (i >= 1) ? ${name}_en(V[i], V[i - 1]) : vec2(0.0);
  vec2 n2 = (i <= ${N - 2}) ? ${name}_en(V[i + 1], V[i]) : vec2(0.0);
  vec2 n = n1 + n2; if (i == 0 || i == ${N - 1}) n = vec2(n.x, 0.0);
  return normalize(n);` : `vec2 n = ${name}_en(V[i], V[(i + ${N - 1}) % ${N}]) + ${name}_en(V[(i + 1) % ${N}], V[i]);
  return normalize(n);`}
}` : ''}
float ${name}(vec3 p) {
  float x = p.x; int s = 0;
  for (int i = 1; i < ${S - 1}; i++) { if (x >= ${name}_X[i]) s = i; }
  float x0 = ${name}_X[s], x1 = ${name}_X[s + 1]; float dx = x1 - x0;
  float t = clamp((x - x0) / dx, 0.0, 1.0); float t2 = t * t, t3 = t2 * t;
  float h00 = 2.0 * t3 - 3.0 * t2 + 1.0, h10 = t3 - 2.0 * t2 + t, h01 = -2.0 * t3 + 3.0 * t2, h11 = t3 - t2;
  float dh00 = 6.0 * t2 - 6.0 * t, dh10 = 3.0 * t2 - 4.0 * t + 1.0, dh01 = -6.0 * t2 + 6.0 * t, dh11 = 3.0 * t2 - 2.0 * t;
  vec2 V[${N}]; vec2 W[${N}];
  for (int k = 0; k < ${N}; k++) {
    vec2 a = ${name}_P[s * ${N} + k], b = ${name}_P[(s + 1) * ${N} + k];
    ${interp}
  }
  vec2 q = vec2(p.y, ${sym ? 'abs(p.z)' : 'p.z'});
  float d = 1e20; float sg = 1.0; int bi = 0, bj = 0; float bt = 0.0;
  for (int i = 0, j = ${N - 1}; i < ${N}; j = i, i++) {
    vec2 e = V[j] - V[i]; vec2 w = q - V[i];
    float tt = clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0); vec2 bb = w - e * tt; float dd = dot(bb, bb);
    ${sym ? 'if (i != 0)' : ''} { if (dd < d) { d = dd; bi = i; bj = j; bt = tt; } }
    bvec3 c = bvec3(q.y >= V[i].y, q.y < V[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) sg = -sg;
  }
  float d2 = sg * sqrt(d);
  ${smoothN || lip ? `vec2 cp = mix(V[bi], V[bj], bt);` : ''}
  ${smoothN ? `vec2 nA = ${name}_vn(bi, V), nB = ${name}_vn(bj, V); vec2 nn = normalize(mix(nA, nB, bt)); vec2 ee = V[bj] - V[bi];
  float F = dot(q - cp, nn) + (dot(ee, nA) - dot(ee, nB)) * bt * (1.0 - bt) * 0.5;
  d2 = (abs(F) > 0.002 && F * sg < 0.0) ? -F : F;` : lip ? `vec2 nn = q - cp; float nl = length(nn); nn = (nl > 1e-6) ? nn / nl * sg : vec2(0.0);` : ''}
  ${lip ? `vec2 vc = mix(W[bi], W[bj], bt); float sn = dot(vc, nn); d2 /= sqrt(1.0 + sn * sn);` : ''}
  float xcap = max(${name}_X[0] - x, x - ${name}_X[${S - 1}]);
  vec2 w2 = vec2(d2, xcap);
  return min(max(w2.x, w2.y), 0.0) + length(max(w2, 0.0));
}
`;
  };

  // =================================================================================================================
  //  GL INFRASTRUCTURE
  // =================================================================================================================
  const now = () => performance.now();
  const yieldTask = (() => {
    let ch = null, queue = [];
    if (typeof MessageChannel !== 'undefined') { ch = new MessageChannel(); ch.port1.onmessage = () => { const f = queue.shift(); if (f) f(); }; }
    return () => new Promise(r => { if (ch) { queue.push(r); ch.port2.postMessage(0); } else setTimeout(r, 0); });
  })();

  function fnv(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16) + ':' + str.length; }

  const progCache = new WeakMap();   // gl -> Map(key -> entry)
  sdf.clearCache = function (gl) { const m = progCache.get(gl); if (!m) return; for (const e of m.values()) if (e.prog) gl.deleteProgram(e.prog); m.clear(); };
  function cacheOf(gl) { let m = progCache.get(gl); if (!m) { m = new Map(); progCache.set(gl, m); } return m; }

  // Start compiling + linking without waiting so that several programs are built by the driver in parallel.
  function startProgram(gl, vsSrc, fsSrc) {
    const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
    const vs = mk(gl.VERTEX_SHADER, vsSrc), fs = mk(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    return { prog, vs, fs, vsSrc, fsSrc };
  }
  async function finishProgram(gl, ent, label, parallelExt) {
    if (parallelExt) { let n = 0; while (!gl.getProgramParameter(ent.prog, parallelExt.COMPLETION_STATUS_KHR)) { if (n++ < 3) await yieldTask(); else await new Promise(r => setTimeout(r, 2)); if (n > 100000) break; } }
    if (!gl.getProgramParameter(ent.prog, gl.LINK_STATUS)) {
      // recompile through PG.glu.program to obtain the annotated source dump + exception
      gl.deleteProgram(ent.prog); gl.deleteShader(ent.vs); gl.deleteShader(ent.fs);
      PG.glu.program(gl, ent.vsSrc, ent.fsSrc, label);
      throw new Error(`PG.sdf: shader link failed (${label})`);
    }
    gl.deleteShader(ent.vs); gl.deleteShader(ent.fs);
    return ent.prog;
  }

  const HDR = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
`;
  // common part: lib, global AO, user code, clipped map wrapper
  function commonSrc(glsl, clipDecl) {
    return `${LIB}
float sdfAO = 1.0;
${glsl}
uniform vec3 uBMin; uniform vec3 uBMax; uniform int uClip;
float PG_M(vec3 p) {
  float d = map(p);
  if (uClip != 0) { vec3 q = abs(p - 0.5 * (uBMin + uBMax)) - 0.5 * (uBMax - uBMin); d = max(d, length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0)); }
  return d;
}
`;
  }

  const VOLUME_MAIN = `
layout(location = 0) out float oV;
uniform vec3 uOrigin; uniform float uStep; uniform int uMode; uniform int uK; uniform ivec3 uCC; uniform int uSlice; uniform int uLayer0;
uniform sampler3D uSkip;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 p;
  if (uMode == 0) {   // coarse block centres: tile row = layer * uCC.y + cy
    int cy = c.y % uCC.y; int layer = c.y / uCC.y + uLayer0;
    p = uOrigin + (vec3(float(c.x), float(cy), float(layer)) * float(uK) + 0.5 * float(uK)) * uStep;
  } else {
    ivec3 n = ivec3(c, uSlice);
    ivec3 lo = max(max(n - 1, ivec3(0)) / uK, ivec3(0));
    ivec3 hi = min(n / uK, uCC - 1);
    float s0 = texelFetch(uSkip, hi, 0).r;
    if (s0 != 0.0) {
      bool skip = true;
      for (int q = 0; q < 8; q++) {
        ivec3 cc = ivec3((q & 1) != 0 ? hi.x : lo.x, (q & 2) != 0 ? hi.y : lo.y, (q & 4) != 0 ? hi.z : lo.z);
        if (texelFetch(uSkip, cc, 0).r == 0.0) { skip = false; break; }
      }
      if (skip) { oV = s0; return; }
    }
    p = uOrigin + vec3(n) * uStep;
  }
  oV = PG_M(p);
}
`;
  // Post pass. NOTE: map() is deliberately evaluated from ONE call site inside a loop over "taps" (gradient tetrahedra, AO samples):
  // driver compile time grows roughly linearly with the number of inlined map() copies, so a tap loop compiles several times faster.
  const POST_MAIN = (hasAttr) => `
layout(location = 0) out vec4 oPos; layout(location = 1) out vec4 oNrm; layout(location = 2) out vec4 oAttr;
uniform sampler2D uPos;
uniform float uEps, uQefEps, uMaxMove, uAoScale, uAoStrength, uVoxel; uniform int uIter, uAttrFull, uMode;
const vec3 PG_K[4] = vec3[4](vec3(1.0, -1.0, -1.0), vec3(-1.0, -1.0, 1.0), vec3(-1.0, 1.0, -1.0), vec3(1.0, 1.0, 1.0));
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 p0 = texelFetch(uPos, c, 0).xyz; vec3 p = p0;
  bool edgeMode = (uMode == 0);
  float e = (edgeMode ? uQefEps : uEps) * 0.57735;
  int nNewton = edgeMode ? 0 : uIter;
  int nGrad = nNewton * 4 + 4;                       // taps used for gradients (Newton iterations + the final normal)
  int nAo = (edgeMode || uAoStrength <= 0.0) ? 0 : 5;
  float f4[4]; vec3 n = vec3(0.0, 1.0, 0.0); float dm = 0.0, step0 = 0.0;
  float occ = 0.0, wsum = 0.0, wt = 1.0;
  for (int k = 0; k < nGrad + nAo; k++) {
    vec3 pos; int j = k & 3;
    if (k < nGrad) pos = p + PG_K[j] * e; else pos = p + n * (uAoScale * float(k - nGrad + 1) / 5.0);
    float f = PG_M(pos);
    if (k < nGrad) {
      f4[j] = f;
      if (j == 3) {
        vec3 g = (PG_K[0] * f4[0] + PG_K[1] * f4[1] + PG_K[2] * f4[2] + PG_K[3] * f4[3]) / (4.0 * e);
        dm = 0.25 * (f4[0] + f4[1] + f4[2] + f4[3]);
        float gg = dot(g, g);
        if (k < nNewton * 4) {                       // Newton iteration: project onto the zero level set, clamp to maxMove
          if (gg > 1e-10) p -= g * (dm / gg);
          vec3 dv = p - p0; float L = length(dv); if (L > uMaxMove) p = p0 + dv * (uMaxMove / L);
          if (!(dot(p, p) >= 0.0)) p = p0;
        } else if (gg > 1e-10) {                     // final gradient: unit normal (+ Hermite refinement step in edge mode)
          n = g * inversesqrt(gg); step0 = clamp(-dm * inversesqrt(gg), -0.5 * uVoxel, 0.5 * uVoxel);
        }
      }
    } else {
      float h = uAoScale * float(k - nGrad + 1) / 5.0;
      occ += wt * clamp(1.0 - f / h, 0.0, 1.0); wsum += wt; wt *= 0.8;
    }
  }
  if (edgeMode) { oPos = vec4(n, step0); oNrm = vec4(0.0); oAttr = vec4(0.0); return; }
  float ao = (nAo > 0) ? clamp(1.0 - uAoStrength * occ / wsum, 0.0, 1.0) : 1.0;
  sdfAO = ao;
  oPos = vec4(p, dm); oNrm = vec4(n, ao);
  ${hasAttr ? `vec4 a = attr(p, n); if (uAttrFull == 0) a.x = ao; oAttr = a;` : 'oAttr = vec4(ao, 0.0, 0.0, 0.0);'}
}
`;
  const SAMPLE_MAIN = `
layout(location = 0) out float oV;
uniform sampler2D uPos;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); oV = PG_M(texelFetch(uPos, c, 0).xyz); }
`;

  function getGLCtx(gl) {
    if (gl.__pgsdf) return gl.__pgsdf;
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) throw new Error('PG.sdf requires a WebGL2 context');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('PG.sdf requires EXT_color_buffer_float');
    const c = { par: gl.getExtension('KHR_parallel_shader_compile'), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), vao: gl.createVertexArray() };
    gl.__pgsdf = c; return c;
  }

  // Save / restore every piece of GL state we touch so the caller's renderer is unaffected.
  function stateGuard(gl, gc) {
    const FLAGS = [gl.SCISSOR_TEST, gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.STENCIL_TEST, gl.DITHER, gl.RASTERIZER_DISCARD, gl.POLYGON_OFFSET_FILL];
    let s = null;
    return {
      save() {
        s = {
          dfb: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), rfb: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
          vp: gl.getParameter(gl.VIEWPORT), sc: gl.getParameter(gl.SCISSOR_BOX), flags: FLAGS.map(f => gl.isEnabled(f)),
          cm: gl.getParameter(gl.COLOR_WRITEMASK), prog: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
          at: gl.getParameter(gl.ACTIVE_TEXTURE), t2: [], t3: [],
          pr: gl.getParameter(gl.PACK_ROW_LENGTH), pa: gl.getParameter(gl.PACK_ALIGNMENT), psp: gl.getParameter(gl.PACK_SKIP_PIXELS), psr: gl.getParameter(gl.PACK_SKIP_ROWS),
          uf: gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), up: gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL), ua: gl.getParameter(gl.UNPACK_ALIGNMENT),
          ur: gl.getParameter(gl.UNPACK_ROW_LENGTH), cs: gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL),
          pbo: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), ubo: gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING),
        };
        for (let u = 0; u < 4; u++) { gl.activeTexture(gl.TEXTURE0 + u); s.t2.push(gl.getParameter(gl.TEXTURE_BINDING_2D)); s.t3.push(gl.getParameter(gl.TEXTURE_BINDING_3D)); }
        gl.activeTexture(s.at);
        // our own baseline
        FLAGS.forEach(f => gl.disable(f)); gl.colorMask(true, true, true, true); gl.bindVertexArray(gc.vao);
        gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_ALIGNMENT, 4); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      },
      restore() {
        if (!s) return;
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.dfb); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.rfb);
        gl.viewport(s.vp[0], s.vp[1], s.vp[2], s.vp[3]); gl.scissor(s.sc[0], s.sc[1], s.sc[2], s.sc[3]);
        FLAGS.forEach((f, i) => s.flags[i] ? gl.enable(f) : gl.disable(f));
        gl.colorMask(s.cm[0], s.cm[1], s.cm[2], s.cm[3]); gl.useProgram(s.prog); gl.bindVertexArray(s.vao);
        for (let u = 0; u < 4; u++) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, s.t2[u]); gl.bindTexture(gl.TEXTURE_3D, s.t3[u]); }
        gl.activeTexture(s.at);
        gl.pixelStorei(gl.PACK_ROW_LENGTH, s.pr); gl.pixelStorei(gl.PACK_ALIGNMENT, s.pa); gl.pixelStorei(gl.PACK_SKIP_PIXELS, s.psp); gl.pixelStorei(gl.PACK_SKIP_ROWS, s.psr); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, s.uf);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, s.up); gl.pixelStorei(gl.UNPACK_ALIGNMENT, s.ua); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, s.ur);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, s.cs);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pbo); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, s.ubo);
        s = null;
      },
    };
  }

  function makeTex2D(gl, internal, w, h, data, fmt, type) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (data) gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, data); else gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Edge tables for surface nets: corner c = x | y<<1 | z<<2
  const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const EDGEMASK = new Uint16Array(256);
  for (let m = 0; m < 256; m++) { let em = 0; for (let e = 0; e < 12; e++) if (((m >> EA[e]) & 1) !== ((m >> EB[e]) & 1)) em |= 1 << e; EDGEMASK[m] = em; }
  const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];

  const grow = (arr, need, Type) => { if (arr.length >= need) return arr; const n = new Type(need); n.set(arr); return n; };

  // =================================================================================================================
  //  MESHER
  // =================================================================================================================
  // Calls on the same context are serialised (they share GL state guards); different contexts run independently.
  sdf.mesh = function (gl, opts) {
    const gc = getGLCtx(gl);
    const p = (gc.queue || Promise.resolve()).then(() => meshImpl(gl, opts));
    gc.queue = p.catch(() => {});
    return p;
  };
  async function meshImpl(gl, opts) {
    const T0 = now();
    if (!opts || typeof opts.glsl !== 'string') throw new Error('PG.sdf.mesh: opts.glsl (source defining float map(vec3 p)) is required');
    const label = opts.label || 'sdf';
    const bmin = opts.min, bmax = opts.max, v = opts.voxel;
    if (!bmin || !bmax || bmin.length !== 3 || bmax.length !== 3) throw new Error(`PG.sdf.mesh[${label}]: min/max must be [x,y,z]`);
    if (!(v > 0) || !isFinite(v)) throw new Error(`PG.sdf.mesh[${label}]: voxel must be > 0`);
    for (let a = 0; a < 3; a++) if (!(bmax[a] > bmin[a])) throw new Error(`PG.sdf.mesh[${label}]: max must be > min on every axis`);
    const gc = getGLCtx(gl);
    if (opts.debug) gc.dbg = true;
    const PAD = 2;
    const ext = [0, 1, 2].map(a => Math.ceil((bmax[a] - bmin[a]) / v - 1e-6));
    const dims = ext.map(e => e + 2 * PAD + 2);           // node counts
    const [nx, ny, nz] = dims;
    const cells = (nx - 1) * (ny - 1) * (nz - 1);
    const maxCells = opts.maxCells || 3e8;
    if (cells > maxCells) throw new Error(`PG.sdf.mesh[${label}]: volume ${nx - 1}x${ny - 1}x${nz - 1} = ${(cells / 1e6).toFixed(0)} M cells exceeds the cap of ${(maxCells / 1e6).toFixed(0)} M cells - use a larger voxel (now ${v} m) or smaller bounds`);
    if (nx * ny > 2.5e7) throw new Error(`PG.sdf.mesh[${label}]: slice ${nx}x${ny} nodes is too large (max 25 M); use a larger voxel or split the volume`);
    if (nx > gc.maxTex || ny > gc.maxTex) throw new Error(`PG.sdf.mesh[${label}]: slice ${nx}x${ny} exceeds MAX_TEXTURE_SIZE ${gc.maxTex}`);
    const origin = [0, 1, 2].map(a => bmin[a] - (PAD + 0.5) * v);
    const clip = opts.clip !== false;
    const K = opts.coarse === undefined ? 4 : Math.max(0, opts.coarse | 0);
    const lip = opts.lipschitz || 1.5;
    const sharp0 = opts.sharp !== false;
    const iters = opts.newton === undefined ? (sharp0 ? 0 : 3) : opts.newton | 0;
    const doPost = opts.post !== false;
    const sharp = doPost && opts.sharp !== false;
    const qefBias = opts.qefBias === undefined ? 0.01 : opts.qefBias;
    const maxMove = (opts.maxMove || 1.0) * v;
    const normalEps = (opts.normalEps || 0.4) * v;
    const aoScale = opts.aoScale || 0.15, aoStrength = opts.aoStrength === undefined ? 1.3 : opts.aoStrength;
    const hasAttr = typeof opts.attr === 'string' && opts.attr.trim().length > 0;
    const onProgress = opts.onProgress || (() => {});
    const stats = { verts: 0, tris: 0, cells, dims, voxel: v, msGPU: 0, msMesh: 0, msPost: 0, msPostGPU: 0, msQEF: 0, msCompile: 0, msTotal: 0, skipFrac: 0 };

    // ---------------- programs (cached by source hash); volume + post are compiled in parallel by the driver
    const tc0 = now();
    const common = commonSrc(opts.glsl);
    const fsVol = HDR + common + VOLUME_MAIN;
    const fsPost = doPost ? HDR + common + (hasAttr ? opts.attr + '\n' : '') + POST_MAIN(hasAttr) : null;
    const cache = cacheOf(gl);
    const keyVol = 'V' + fnv(fsVol), keyPost = fsPost ? 'P' + fnv(fsPost) : null;
    let volE = cache.get(keyVol), postE = keyPost ? cache.get(keyPost) : null;
    const st = stateGuard(gl, gc);
    const pending = [];
    st.save();
    try {
      if (!volE) { volE = { pend: startProgram(gl, PG.glu.FULLSCREEN_VS, fsVol) }; cache.set(keyVol, volE); pending.push([volE, 'sdf-volume:' + label]); }
      if (fsPost && !postE) { postE = { pend: startProgram(gl, PG.glu.FULLSCREEN_VS, fsPost) }; cache.set(keyPost, postE); pending.push([postE, 'sdf-post:' + label]); }
    } finally { st.restore(); }
    const settle = async (e, lbl) => {
      if (!e.pend) return;
      st.save();
      try { e.prog = await finishProgram(gl, e.pend, lbl, gc.par); e.u = PG.glu.uniforms(gl, e.prog); e.pend = null; }
      catch (err) { cache.delete(keyVol); if (keyPost) cache.delete(keyPost); throw err; }
      finally { st.restore(); }
    };
    // wait for volume program only; the post program keeps compiling while the volume is evaluated
    if (volE.pend) await settle(volE, 'sdf-volume:' + label);
    stats.msCompile = now() - tc0;
    onProgress(0.03);

    // ---------------- state used by the whole run
    let lastYield = now();
    const fbo = gl.createFramebuffer();
    let rtFine = null, rtCoarse = null, skipTex = null;
    const cleanupGL = () => { if (rtFine) gl.deleteTexture(rtFine); if (rtCoarse) gl.deleteTexture(rtCoarse); if (skipTex) gl.deleteTexture(skipTex); rtFine = rtCoarse = skipTex = null; gl.deleteFramebuffer(fbo); };
    let rebind = () => {};
    const pause = async (frac) => {
      st.restore(); onProgress(frac); await yieldTask(); lastYield = now(); st.save(); rebind();
    };
    const maybePause = async (frac) => { if (now() - lastYield > 25) await pause(frac); };
    const cpuPause = async (frac) => { if (now() - lastYield > 25) { onProgress(frac); await yieldTask(); lastYield = now(); } };   // only when no GL state is held

    try {
      st.save();
      const U = volE.u, prog = volE.prog;
      const setCommonUniforms = (u) => {
        gl.uniform3f(u.uBMin, bmin[0], bmin[1], bmin[2]); gl.uniform3f(u.uBMax, bmax[0], bmax[1], bmax[2]); gl.uniform1i(u.uClip, clip ? 1 : 0);
      };
      // ------------- coarse pass: one map() sample per KxKxK block centre
      let ccx = 1, ccy = 1, ccz = 1, KK = K;
      let flags;
      let tG = now();
      if (K > 0) { ccx = Math.ceil((nx - 1) / K); ccy = Math.ceil((ny - 1) / K); ccz = Math.ceil((nz - 1) / K); } else { KK = 1 << 20; }
      flags = new Float32Array(ccx * ccy * ccz);
      // dummy 1x1x1 skip texture bound while the coarse pass runs (K==0: stays all-zero = everything active)
      skipTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, skipTex);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, 1, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array(1));
      gl.useProgram(prog); setCommonUniforms(U);
      gl.uniform3f(U.uOrigin, origin[0], origin[1], origin[2]); gl.uniform1i(U.uSkip, 1);
      gl.uniform1i(U.uK, KK); gl.uniform3i(U.uCC, ccx, ccy, ccz);
      if (K > 0) {
        const lpd = Math.max(1, Math.min(ccz, Math.floor(4096 / ccy)));
        rtCoarse = makeTex2D(gl, gl.R32F, ccx, ccy * lpd);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtCoarse, 0);
        gl.viewport(0, 0, ccx, ccy * lpd);
        gl.uniform1i(U.uMode, 0); gl.uniform1f(U.uStep, v);
        const centre = new Float32Array(ccx * ccy * lpd);
        const guard = lip * 0.8660254 * K * v, minV = 0.01 * v;
        for (let l0 = 0; l0 < ccz; l0 += lpd) {
          const nl = Math.min(lpd, ccz - l0);
          gl.uniform1i(U.uLayer0, l0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.readPixels(0, 0, ccx, ccy * nl, gl.RED, gl.FLOAT, centre);
          for (let i = 0, n = ccx * ccy * nl, o = l0 * ccx * ccy; i < n; i++) {
            const d = centre[i], a = Math.abs(d);
            flags[o + i] = (a > guard) ? (d < 0 ? -1 : 1) * Math.max(a - guard, minV) : 0;
          }
        }
        gl.deleteTexture(rtCoarse); rtCoarse = null;
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, skipTex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, ccx, ccy, ccz, 0, gl.RED, gl.FLOAT, flags);
      }
      stats.msGPU += now() - tG;
      onProgress(0.06);

      // ------------- per coarse row / layer extents of active blocks
      const rowMin = new Int16Array(ccy * ccz).fill(-1), rowMax = new Int16Array(ccy * ccz).fill(-1);
      const layX0 = new Int32Array(ccz).fill(1e9), layX1 = new Int32Array(ccz).fill(-1), layY0 = new Int32Array(ccz).fill(1e9), layY1 = new Int32Array(ccz).fill(-1);
      let activeBlocks = 0;
      for (let cz = 0; cz < ccz; cz++) for (let cy = 0; cy < ccy; cy++) {
        const base = (cz * ccy + cy) * ccx; let mn = -1, mx = -1;
        for (let cx = 0; cx < ccx; cx++) if (flags[base + cx] === 0) { if (mn < 0) mn = cx; mx = cx; activeBlocks++; }
        rowMin[cz * ccy + cy] = mn; rowMax[cz * ccy + cy] = mx;
        if (mn >= 0) { if (mn < layX0[cz]) layX0[cz] = mn; if (mx > layX1[cz]) layX1[cz] = mx; if (cy < layY0[cz]) layY0[cz] = cy; if (cy > layY1[cz]) layY1[cz] = cy; }
      }
      stats.skipFrac = 1 - activeBlocks / (ccx * ccy * ccz);
      // node slice s is needed when a cell layer that uses it is active; rectangle = union of those layers
      const rectOf = new Array(nz).fill(null);
      for (let s = 0; s < nz; s++) {
        let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
        const layers = [];
        if (s >= 1) layers.push(Math.floor((s - 1) / KK));
        if (s <= nz - 2) layers.push(Math.floor(s / KK));
        for (const L of layers) if (L < ccz && layX1[L] >= 0) { x0 = Math.min(x0, layX0[L]); x1 = Math.max(x1, layX1[L]); y0 = Math.min(y0, layY0[L]); y1 = Math.max(y1, layY1[L]); }
        if (x1 >= 0) rectOf[s] = [x0 * KK, Math.min((x1 + 1) * KK, nx - 1), y0 * KK, Math.min((y1 + 1) * KK, ny - 1)];
      }
      if (activeBlocks === 0) { st.restore(); cleanupGL(); return finish(); }
      
      // ------------- fine pass setup
      rtFine = makeTex2D(gl, gl.R32F, nx, ny);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtFine, 0);
      const setupFine = () => {
        gl.useProgram(prog); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, nx, ny); gl.enable(gl.SCISSOR_TEST);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, skipTex);
      };
      setupFine();
      gl.uniform1i(U.uMode, 1); gl.uniform1f(U.uStep, v);
      rebind = setupFine;
      const drawSlice = (s) => {
        const r = rectOf[s];
        gl.scissor(r[0], r[2], r[1] - r[0] + 1, r[3] - r[2] + 1);
        gl.uniform1i(U.uSlice, s); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.flush();
      };

      // ------------- surface-nets state
      const NB = [new Float32Array(nx * ny), new Float32Array(nx * ny)];
      const cw = nx - 1, ch = ny - 1;
      const cellIdx = [new Int32Array(cw * ch).fill(-1), new Int32Array(cw * ch).fill(-1)];
      const cellList = [new Int32Array(cw * ch), new Int32Array(cw * ch)], cellCount = [0, 0];
      let vcap = 65536, vpos = new Float32Array(3 * vcap), nv = 0;
      let vcell = sharp ? new Float32Array(3 * vcap) : null;
      let qcap = 65536, quads = new Uint32Array(4 * qcap), qpos = sharp ? new Float32Array(3 * qcap) : null, nq = 0;
      const vals = new Float32Array(8);
      const nx1 = nx + 1;

      let meshMs = 0;
      const meshSlice = (k) => {
        const par = k & 1, cur = cellIdx[par], prev = cellIdx[par ^ 1], A = NB[par], B = NB[par ^ 1];
        // clear stale entries from slice k-2 (same parity buffer)
        const lst = cellList[par]; for (let q = 0, n = cellCount[par]; q < n; q++) cur[lst[q]] = -1; cellCount[par] = 0;
        const layer = Math.floor(k / KK);
        if (layer >= ccz || layX1[layer] < 0) { return; }
        let cnt = 0;
        // phase 1: vertices
        for (let cy = layY0[layer]; cy <= layY1[layer]; cy++) {
          const rmn = rowMin[layer * ccy + cy]; if (rmn < 0) continue;
          const rmx = rowMax[layer * ccy + cy];
          const jA = cy * KK, jB = Math.min(jA + KK, ch);
          for (let cx = rmn; cx <= rmx; cx++) {
            if (flags[(layer * ccy + cy) * ccx + cx] !== 0) continue;
            const iA = cx * KK, iB = Math.min(iA + KK, cw);
            for (let j = jA; j < jB; j++) {
              let o = j * nx + iA;
              for (let i = iA; i < iB; i++, o++) {
                const v0 = A[o], v1 = A[o + 1], v2 = A[o + nx], v3 = A[o + nx1], v4 = B[o], v5 = B[o + 1], v6 = B[o + nx], v7 = B[o + nx1];
                const mask = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0) | (v4 < 0 ? 16 : 0) | (v5 < 0 ? 32 : 0) | (v6 < 0 ? 64 : 0) | (v7 < 0 ? 128 : 0);
                if (mask === 0 || mask === 255) continue;
                vals[0] = v0; vals[1] = v1; vals[2] = v2; vals[3] = v3; vals[4] = v4; vals[5] = v5; vals[6] = v6; vals[7] = v7;
                let em = EDGEMASK[mask], sx = 0, sy = 0, sz = 0, c = 0;
                while (em) {
                  const e = 31 - Math.clz32(em & -em); em &= em - 1;
                  const a = EA[e], b = EB[e], va = vals[a], t = va / (va - vals[b]);
                  sx += CX[a] + (CX[b] - CX[a]) * t; sy += CY[a] + (CY[b] - CY[a]) * t; sz += CZ[a] + (CZ[b] - CZ[a]) * t; c++;
                }
                const ic = 1 / c;
                if (nv >= vcap) {
                  vcap = Math.ceil(vcap * 1.6) + 1024;
                  vpos = grow(vpos, 3 * vcap, Float32Array);
                  if (sharp) vcell = grow(vcell, 3 * vcap, Float32Array);
                }
                const vi = 3 * nv;
                if (sharp) { vcell[vi] = i; vcell[vi + 1] = j; vcell[vi + 2] = k; }
                vpos[vi] = origin[0] + (i + sx * ic) * v; vpos[vi + 1] = origin[1] + (j + sy * ic) * v; vpos[vi + 2] = origin[2] + (k + sz * ic) * v;
                const ci = j * cw + i; cur[ci] = nv++; lst[cnt++] = ci;
              }
            }
          }
        }
        cellCount[par] = cnt;
        // phase 2: quads for every sign-changing edge whose min node belongs to a cell of this slice
        for (let q = 0; q < cnt; q++) {
          const ci = lst[q]; const j = (ci / cw) | 0, i = ci - j * cw; const o = j * nx + i;
          const va = A[o], a = va < 0;
          if (j >= 1 && k >= 1 && (a !== (A[o + 1] < 0))) {   // x edge
            const v00 = prev[ci - cw], v10 = prev[ci], v11 = cur[ci], v01 = cur[ci - cw];
            if ((v00 | v10 | v11 | v01) >= 0) emitQuad(v00, v10, v11, v01, a, origin[0] + (i + va / (va - A[o + 1])) * v, origin[1] + j * v, origin[2] + k * v);
          }
          if (i >= 1 && k >= 1 && (a !== (A[o + nx] < 0))) {   // y edge
            const v00 = prev[ci - 1], v10 = cur[ci - 1], v11 = cur[ci], v01 = prev[ci];
            if ((v00 | v10 | v11 | v01) >= 0) emitQuad(v00, v10, v11, v01, a, origin[0] + i * v, origin[1] + (j + va / (va - A[o + nx])) * v, origin[2] + k * v);
          }
          if (i >= 1 && j >= 1 && (a !== (B[o] < 0))) {   // z edge
            const v00 = cur[ci - cw - 1], v10 = cur[ci - cw], v11 = cur[ci], v01 = cur[ci - 1];
            if ((v00 | v10 | v11 | v01) >= 0) emitQuad(v00, v10, v11, v01, a, origin[0] + i * v, origin[1] + j * v, origin[2] + (k + va / (va - B[o])) * v);
          }
        }
      };
      // quad (v00,v10,v11,v01 in cycle order) of one crossing edge; `inside` = min node of the edge is inside => outward = +axis
      const emitQuad = (v00, v10, v11, v01, inside, px, py, pz) => {
        if (nq >= qcap) {
          qcap = Math.ceil(qcap * 1.6) + 4096;
          quads = grow(quads, 4 * qcap, Uint32Array);
          if (sharp) qpos = grow(qpos, 3 * qcap, Float32Array);
        }
        const w = 4 * nq;
        if (inside) { quads[w] = v00; quads[w + 1] = v10; quads[w + 2] = v11; quads[w + 3] = v01; }
        else { quads[w] = v01; quads[w + 1] = v11; quads[w + 2] = v10; quads[w + 3] = v00; }
        if (sharp) { qpos[3 * nq] = px; qpos[3 * nq + 1] = py; qpos[3 * nq + 2] = pz; }
        nq++;
      };

      // ------------- main streaming loop. The GPU renders slices AHEAD steps in front of the consumer and copies each one into a
      // pixel-pack buffer (asynchronous); the CPU fetches slice s from its PBO and meshes cells (s-1, s) meanwhile.
      const AHEAD = 3, pbos = [];
      for (let i = 0; i <= AHEAD; i++) { const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, nx * ny * 4, gl.STREAM_READ); pbos.push(b); }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const cleanupPbos = () => { for (const b of pbos) gl.deleteBuffer(b); pbos.length = 0; };
      const neededList = [], ordOf = new Int32Array(nz).fill(-1);
      for (let sl = 0; sl < nz; sl++) if (rectOf[sl]) { ordOf[sl] = neededList.length; neededList.push(sl); }
      let nextIssue = 0, consumed = 0;
      const issue = (sl) => {   // draw slice sl and copy its active rectangle into its PBO (same memory layout as NB)
        drawSlice(sl);
        const r = rectOf[sl], w = r[1] - r[0] + 1, h = r[3] - r[2] + 1;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[ordOf[sl] % (AHEAD + 1)]);
        gl.pixelStorei(gl.PACK_ROW_LENGTH, nx); gl.pixelStorei(gl.PACK_SKIP_PIXELS, r[0]); gl.pixelStorei(gl.PACK_SKIP_ROWS, r[2]);
        gl.readPixels(r[0], r[2], w, h, gl.RED, gl.FLOAT, 0);
        gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      };
      const fetchSlice = (sl) => {
        const r = rectOf[sl], w = r[1] - r[0] + 1, h = r[3] - r[2] + 1, first = r[2] * nx + r[0];
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[ordOf[sl] % (AHEAD + 1)]);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, first * 4, NB[sl & 1], first, (h - 1) * nx + w);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        consumed++;
      };
      const topUp = () => { while (nextIssue < neededList.length && nextIssue - consumed < AHEAD) issue(neededList[nextIssue++]); gl.flush(); };
      tG = now(); topUp(); stats.msGPU += now() - tG;
      for (let s = 0; s < nz; s++) {
        if (rectOf[s]) { tG = now(); fetchSlice(s); topUp(); stats.msGPU += now() - tG; }
        if (s >= 1) { const tm = now(); meshSlice(s - 1); meshMs += now() - tm; }
        if ((s & 3) === 3) {
          await maybePause(0.06 + 0.7 * s / nz);
          // surface a post-shader (attr) compile error as early as possible instead of after the whole volume pass
          if (postE && postE.pend && gc.par && gl.getProgramParameter(postE.pend.prog, gc.par.COMPLETION_STATUS_KHR)) { st.restore(); await settle(postE, 'sdf-post:' + label); st.save(); rebind(); }
        }
      }
      cleanupPbos();
      stats.msMesh = meshMs;
      gl.disable(gl.SCISSOR_TEST);
      st.restore();
      cleanupGL();
      onProgress(0.76);
      if (gc.dbg) checkErr(gl, 'volume');

      return await finishMesh();

      // ---------------------------------------------------------------- post pass + triangulation
      async function finishMesh() {
        const nVerts = nv;
        const positions = vpos.slice(0, 3 * nVerts); vpos = null;
        const normals = new Float32Array(3 * nVerts);
        const attrs = new Float32Array(4 * nVerts);
        const tp0 = now();
        if (doPost && nVerts > 0) {
          await settle(postE, 'sdf-post:' + label);
          const P = postE.prog, PU = postE.u;
          const W = 2048, ROWS = 64, BATCH = W * ROWS;
          st.save();
          const fboP = gl.createFramebuffer();
          const outTex = [0, 1, 2].map(() => makeTex2D(gl, gl.RGBA32F, W, ROWS));
          const inTex = makeTex2D(gl, gl.RGBA32F, W, ROWS);
          const scratch = new Float32Array(BATCH * 4), out = [new Float32Array(BATCH * 4), new Float32Array(BATCH * 4), hasAttr ? new Float32Array(BATCH * 4) : null];
          const setup = () => {
            gl.useProgram(P); gl.bindFramebuffer(gl.FRAMEBUFFER, fboP); gl.viewport(0, 0, W, ROWS); gl.disable(gl.SCISSOR_TEST);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inTex);
          };
          rebind = setup;
          gl.bindFramebuffer(gl.FRAMEBUFFER, fboP);
          for (let m = 0; m < 3; m++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + m, gl.TEXTURE_2D, outTex[m], 0);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('PG.sdf: post framebuffer incomplete');
          setup();
          setCommonUniforms(PU);
          gl.uniform1i(PU.uPos, 0); gl.uniform1f(PU.uVoxel, v);
          gl.uniform1f(PU.uEps, normalEps); gl.uniform1f(PU.uQefEps, (opts.qefEps || 0.1) * v); gl.uniform1f(PU.uMaxMove, maxMove);
          gl.uniform1f(PU.uAoScale, aoScale); gl.uniform1f(PU.uAoStrength, aoStrength); gl.uniform1i(PU.uIter, iters); gl.uniform1i(PU.uAttrFull, opts.attrFull ? 1 : 0);
          // upload cnt float4 texels from scratch (first `rows` rows), draw, read attachment(s) back
          const runBatch = (cnt, nOut) => {
            const rows = Math.ceil(cnt / W);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inTex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, rows, gl.RGBA, gl.FLOAT, scratch);
            gl.viewport(0, 0, W, rows);
            const tq0 = now();
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            if (gc.dbg) { gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out[0]); const dt = now() - tq0; stats.msDraw = (stats.msDraw || 0) + dt; if (!stats.firstDraw) stats.firstDraw = dt; }
            for (let m = 0; m < nOut; m++) { gl.readBuffer(gl.COLOR_ATTACHMENT0 + m); gl.readPixels(0, 0, W, rows, gl.RGBA, gl.FLOAT, out[m]); }
            stats.msPostGPU += now() - tq0;
          };
          // ---- pass 1 (sharp features): Hermite data (normal + refinement step) of every crossing edge, then CPU least squares
          if (sharp && nq > 0) {
            gl.uniform1i(PU.uMode, 0);
            const eData = new Float32Array(4 * nq);
            for (let q0 = 0; q0 < nq; q0 += BATCH) {
              const cnt = Math.min(BATCH, nq - q0);
              for (let i = 0; i < cnt; i++) { const s3 = 3 * (q0 + i), d4 = 4 * i; scratch[d4] = qpos[s3]; scratch[d4 + 1] = qpos[s3 + 1]; scratch[d4 + 2] = qpos[s3 + 2]; scratch[d4 + 3] = 0; }
              runBatch(cnt, 1);
              eData.set(out[0].subarray(0, 4 * cnt), 4 * q0);
              if (q0 + BATCH < nq) await maybePause(0.76 + 0.1 * (q0 + BATCH) / nq);
            }
            stats.msPass1 = stats.msPostGPU;
            const tq = now();
            await qefSolve(positions, nVerts, quads, nq, qpos, eData, vcell, origin, v, qefBias, () => maybePause(0.85));
            stats.msQEF = now() - tq;
            qpos = null; vcell = null;
          }
          // ---- pass 2: (Newton) projection, analytic normal, AO, user attr at the final vertex positions
          gl.uniform1i(PU.uMode, 1);
          const nb = Math.ceil(nVerts / BATCH);
          for (let b = 0; b < nb; b++) {
            const v0 = b * BATCH, cnt = Math.min(BATCH, nVerts - v0);
            for (let i = 0; i < cnt; i++) { const s3 = 3 * (v0 + i), d4 = 4 * i; scratch[d4] = positions[s3]; scratch[d4 + 1] = positions[s3 + 1]; scratch[d4 + 2] = positions[s3 + 2]; scratch[d4 + 3] = 0; }
            runBatch(cnt, hasAttr ? 3 : 2);
            const o0 = out[0], o1 = out[1], o2 = out[2];
            for (let i = 0; i < cnt; i++) {
              const s4 = 4 * i, d3 = 3 * (v0 + i), d4 = 4 * (v0 + i);
              positions[d3] = o0[s4]; positions[d3 + 1] = o0[s4 + 1]; positions[d3 + 2] = o0[s4 + 2];
              normals[d3] = o1[s4]; normals[d3 + 1] = o1[s4 + 1]; normals[d3 + 2] = o1[s4 + 2];
              if (hasAttr) { attrs[d4] = o2[s4]; attrs[d4 + 1] = o2[s4 + 1]; attrs[d4 + 2] = o2[s4 + 2]; attrs[d4 + 3] = o2[s4 + 3]; } else attrs[d4] = o1[s4 + 3];
            }
            if (b + 1 < nb) await maybePause(0.86 + 0.1 * (b + 1) / nb);
          }
          outTex.forEach(t => gl.deleteTexture(t)); gl.deleteTexture(inTex); gl.deleteFramebuffer(fboP);
          st.restore();
          rebind = () => {};
          if (gc.dbg) checkErr(gl, 'post');
        } else if (nVerts > 0) {
          // no refinement: normals from the triangle fan average
          for (let i = 0; i < nVerts; i++) attrs[4 * i] = 1;
          computeNormalsFromQuads(positions, normals, quads, nq);
        }
        // triangulate: pick the flatter diagonal from the (refined) positions
        const useU16 = nVerts <= 65535;
        const idx = useU16 ? new Uint16Array(6 * nq) : new Uint32Array(6 * nq);
        let nt = 0;
        for (let q = 0; q < nq; q++) {
          if ((q & 65535) === 65535) await cpuPause(0.97);
          const a = quads[4 * q], b = quads[4 * q + 1], c = quads[4 * q + 2], d = quads[4 * q + 3];
          const A3 = 3 * a, B3 = 3 * b, C3 = 3 * c, D3 = 3 * d;
          // split 1: (a,b,c)+(a,c,d)   split 2: (a,b,d)+(b,c,d).  flatness = dot of the two face normals
          const f1 = foldDot(positions, A3, B3, C3, A3, C3, D3), f2 = foldDot(positions, A3, B3, D3, B3, C3, D3);
          if (f1 >= f2) { idx[3 * nt] = a; idx[3 * nt + 1] = b; idx[3 * nt + 2] = c; idx[3 * nt + 3] = a; idx[3 * nt + 4] = c; idx[3 * nt + 5] = d; }
          else { idx[3 * nt] = a; idx[3 * nt + 1] = b; idx[3 * nt + 2] = d; idx[3 * nt + 3] = b; idx[3 * nt + 4] = c; idx[3 * nt + 5] = d; }
          nt += 2;
        }
        stats.msPost = now() - tp0;
        stats.verts = nVerts; stats.tris = nt;
        return finishResult({ positions, normals, attrs, indices: idx });
      }
    } catch (err) {
      try { st.restore(); } catch (_) {}
      try { cleanupGL(); } catch (_) {}
      throw err;
    }

    function finish() {   // empty result
      stats.msTotal = now() - T0;
      return finishResult({ positions: new Float32Array(0), normals: new Float32Array(0), attrs: new Float32Array(0), indices: new Uint16Array(0) });
    }
    function finishResult(m) {
      stats.msTotal = now() - T0;
      m.stats = stats;
      onProgress(1);
      PG.log(`sdf[${label}] ${dims.join('x')} nodes @${(v * 1000).toFixed(2)}mm  ${stats.verts} verts ${stats.tris} tris | compile ${stats.msCompile.toFixed(0)} ms, GPU ${stats.msGPU.toFixed(0)} ms, mesh ${stats.msMesh.toFixed(0)} ms, post ${stats.msPost.toFixed(0)} ms, total ${stats.msTotal.toFixed(0)} ms | skipped ${(100 * stats.skipFrac).toFixed(0)}% of blocks`);
      return m;
    }
  }

  // Least-squares (dual contouring) vertex placement. Every crossing edge contributes its tangent plane (unit normal n through
  // point P = crossing + n*step) to the 4 vertices of its quad. Per vertex minimise sum (n.(x-P))^2 + bias*|x-c|^2, c = mean(P);
  // the result is clamped to the vertex's own cell. Work in cell-local units for float32 accuracy.
  async function qefSolve(positions, nVerts, quads, nq, qpos, eData, vcell, origin, v, bias, tick) {
    const acc = new Float32Array(13 * nVerts), iv = 1 / v;
    for (let q = 0; q < nq; q++) {
      if ((q & 32767) === 32767) await tick();
      const nx = eData[4 * q], ny = eData[4 * q + 1], nz = eData[4 * q + 2], sd = eData[4 * q + 3];
      const px = qpos[3 * q] + nx * sd, py = qpos[3 * q + 1] + ny * sd, pz = qpos[3 * q + 2] + nz * sd;
      const axx = nx * nx, axy = nx * ny, axz = nx * nz, ayy = ny * ny, ayz = ny * nz, azz = nz * nz;
      for (let k = 0; k < 4; k++) {
        const vi = quads[4 * q + k], o = 13 * vi, c3 = 3 * vi;
        const lx = (px - origin[0]) * iv - vcell[c3], ly = (py - origin[1]) * iv - vcell[c3 + 1], lz = (pz - origin[2]) * iv - vcell[c3 + 2];
        const d = nx * lx + ny * ly + nz * lz;
        acc[o] += lx; acc[o + 1] += ly; acc[o + 2] += lz;
        acc[o + 3] += axx; acc[o + 4] += axy; acc[o + 5] += axz; acc[o + 6] += ayy; acc[o + 7] += ayz; acc[o + 8] += azz;
        acc[o + 9] += nx * d; acc[o + 10] += ny * d; acc[o + 11] += nz * d; acc[o + 12] += 1;
      }
    }
    for (let vi = 0; vi < nVerts; vi++) {
      if ((vi & 32767) === 32767) await tick();
      const o = 13 * vi, cnt = acc[o + 12]; if (cnt === 0) continue;
      const ic = 1 / cnt, cx = acc[o] * ic, cy = acc[o + 1] * ic, cz = acc[o + 2] * ic;
      const axx = acc[o + 3], axy = acc[o + 4], axz = acc[o + 5], ayy = acc[o + 6], ayz = acc[o + 7], azz = acc[o + 8];
      const rx = acc[o + 9] - (axx * cx + axy * cy + axz * cz), ry = acc[o + 10] - (axy * cx + ayy * cy + ayz * cz), rz = acc[o + 11] - (axz * cx + ayz * cy + azz * cz);
      const mxx = axx + bias, myy = ayy + bias, mzz = azz + bias;
      // inverse of the symmetric matrix [[mxx,axy,axz],[axy,myy,ayz],[axz,ayz,mzz]] via cofactors
      const c00 = myy * mzz - ayz * ayz, c01 = axz * ayz - axy * mzz, c02 = axy * ayz - myy * axz;
      const det = mxx * c00 + axy * c01 + axz * c02;
      if (!(det > 1e-12)) continue;
      const c11 = mxx * mzz - axz * axz, c12 = axy * axz - mxx * ayz, c22 = mxx * myy - axy * axy, id = 1 / det;
      let x = cx + (c00 * rx + c01 * ry + c02 * rz) * id, y = cy + (c01 * rx + c11 * ry + c12 * rz) * id, z = cz + (c02 * rx + c12 * ry + c22 * rz) * id;
      x = x < -0.02 ? -0.02 : x > 1.02 ? 1.02 : x; y = y < -0.02 ? -0.02 : y > 1.02 ? 1.02 : y; z = z < -0.02 ? -0.02 : z > 1.02 ? 1.02 : z;
      const c3 = 3 * vi;
      positions[c3] = origin[0] + (vcell[c3] + x) * v; positions[c3 + 1] = origin[1] + (vcell[c3 + 1] + y) * v; positions[c3 + 2] = origin[2] + (vcell[c3 + 2] + z) * v;
    }
  }

  function foldDot(P, a, b, c, d, e, f) {
    // face normals of triangles (a,b,c) and (d,e,f) (indices are float offsets); returns cosine of the angle between them
    let ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const n1x = uy * wz - uz * wy, n1y = uz * wx - ux * wz, n1z = ux * wy - uy * wx;
    ux = P[e] - P[d]; uy = P[e + 1] - P[d + 1]; uz = P[e + 2] - P[d + 2]; wx = P[f] - P[d]; wy = P[f + 1] - P[d + 1]; wz = P[f + 2] - P[d + 2];
    const n2x = uy * wz - uz * wy, n2y = uz * wx - ux * wz, n2z = ux * wy - uy * wx;
    const l = Math.sqrt((n1x * n1x + n1y * n1y + n1z * n1z) * (n2x * n2x + n2y * n2y + n2z * n2z));
    return l > 1e-30 ? (n1x * n2x + n1y * n2y + n1z * n2z) / l : -2;
  }
  function computeNormalsFromQuads(P, N, quads, nq) {
    for (let q = 0; q < nq; q++) {
      const a = 3 * quads[4 * q], b = 3 * quads[4 * q + 1], c = 3 * quads[4 * q + 2], d = 3 * quads[4 * q + 3];
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], wx = P[d] - P[b], wy = P[d + 1] - P[b + 1], wz = P[d + 2] - P[b + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      for (const i of [a, b, c, d]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
    }
    for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  }
  function checkErr(gl, where) { let e, n = 0; while ((e = gl.getError()) !== gl.NO_ERROR && n++ < 8) console.error(`[PG.sdf] GL error 0x${e.toString(16)} after ${where}`); }
  sdf.debugGL = function (gl, on) { getGLCtx(gl).dbg = !!on; };

  sdf.meshMany = async function (gl, list) { const out = []; for (const o of list) out.push(await sdf.mesh(gl, o)); return out; };

  // ---------------------------------------------------------------------------------------------------------------
  // sample(): evaluate map() at arbitrary points on the GPU (tests, probes, feature registries).
  sdf.sample = function (gl, glsl, pts, o) {
    const gc = getGLCtx(gl);
    const p = (gc.queue || Promise.resolve()).then(() => sampleImpl(gl, glsl, pts, o));
    gc.queue = p.catch(() => {});
    return p;
  };
  async function sampleImpl(gl, glsl, pts, o) {
    o = o || {};
    const gc = getGLCtx(gl);
    const cache = cacheOf(gl);
    const src = HDR + commonSrc(glsl) + SAMPLE_MAIN, key = 'S' + fnv(src);
    let e = cache.get(key);
    const st = stateGuard(gl, gc);
    st.save();
    try {
      if (!e) { e = { pend: startProgram(gl, PG.glu.FULLSCREEN_VS, src) }; cache.set(key, e); }
      if (e.pend) { try { e.prog = await finishProgram(gl, e.pend, 'sdf-sample', gc.par); e.u = PG.glu.uniforms(gl, e.prog); e.pend = null; } catch (err) { cache.delete(key); throw err; } }
      const n = pts.length / 3, W = 2048, ROWS = 512, BATCH = W * ROWS, res = new Float32Array(n);
      const inTex = makeTex2D(gl, gl.RGBA32F, W, ROWS), outTex = makeTex2D(gl, gl.R32F, W, ROWS), fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
      gl.useProgram(e.prog); gl.uniform1i(e.u.uPos, 0);
      const cl = o.clip === true;
      const bn = o.min || [-1e6, -1e6, -1e6], bx = o.max || [1e6, 1e6, 1e6];
      gl.uniform3f(e.u.uBMin, bn[0], bn[1], bn[2]); gl.uniform3f(e.u.uBMax, bx[0], bx[1], bx[2]); gl.uniform1i(e.u.uClip, cl ? 1 : 0);
      const scratch = new Float32Array(BATCH * 4), out = new Float32Array(BATCH);
      for (let b0 = 0; b0 < n; b0 += BATCH) {
        const cnt = Math.min(BATCH, n - b0), rows = Math.ceil(cnt / W);
        for (let i = 0; i < cnt; i++) { scratch[4 * i] = pts[3 * (b0 + i)]; scratch[4 * i + 1] = pts[3 * (b0 + i) + 1]; scratch[4 * i + 2] = pts[3 * (b0 + i) + 2]; scratch[4 * i + 3] = 0; }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, rows, gl.RGBA, gl.FLOAT, scratch);
        gl.viewport(0, 0, W, rows); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, W, rows, gl.RED, gl.FLOAT, out);
        res.set(out.subarray(0, cnt), b0);
      }
      gl.deleteTexture(inTex); gl.deleteTexture(outTex); gl.deleteFramebuffer(fb);
      return res;
    } finally { st.restore(); }
  }
})();
