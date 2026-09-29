'use strict';
// car/body_cabin.js — body feature "cabin" (order 50): windshield, door glass, fixed front triangle, rear quarter glass, rear glass,
// black window trim, ceramic frit borders, roof panel mask.  (The greenhouse VOLUME itself lives in the base map of body.js.)
//
// GLSL API (common block, usable by every later feature; p is car space with p.z mirrored >= 0):
//   float cabin_glass(vec3 p)      signed distance to the union of the glass regions (negative inside glass) -- THE glass mask
//   float cabin_trim(vec3 p)       signed distance to the black window trim ring (negative inside glass + ring)
//   float cabin_roof(vec3 p)       signed distance to the roof panel region (negative inside; the part a carbon roof would replace)
//   float cabin_panel(int i, vec3 p)  i = 0 door, 1 front triangle, 2 quarter, 3 windshield, 4 rear glass
// Each glass region = 2D polygon (side view x,y for the panels on the lean planes; plan view x,|z| for windshield / rear glass)
// intersected with a thin band around the carrier surface (the same analytic surfaces the body SDF uses), so it needs no normals.
(function () {
  const P = PG.body.prof;
  const belt = P.beltY, f5 = v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(5);
  const zL = (x, y) => P.Wb(x) - (y - belt) * P.tl(x);                    // lean plane half width at height y
  const roofY = (x, z) => P.Rf(x) - P.cR(x) * z * z;
  const roofEdge = x => { let y = P.Rf(x); for (let i = 0; i < 24; i++) y = roofY(x, zL(x, y)); return y; };
  const baseTop = (x, z) => {
    const zc = P.cZ(x), A = Math.max(0, P.cA(x)), w = z < zc ? P.cWi(x) : P.cWo(x), u = (z - zc) / w;
    return P.Tb(x) - P.cr(x) * z * z + A * Math.exp(-u * u);
  };
  const sill = x => { let y = belt; for (let i = 0; i < 24; i++) y = baseTop(x, zL(x, y)); return y + 0.010; };
  const top = (x, m) => roofEdge(x) - (m === undefined ? 0.017 : m);

  // ---- panels
  const door = [], tri = [], quarter = [];
  { // door glass (side view, CCW): rear-bottom, front-bottom, front-top ..., top edge back to the rear
    const xr = -0.70, xf = 0.44, xft = 0.10, xrt = -0.62;
    const pts = [[xr, sill(xr)], [xf, sill(xf)], [xft, top(xft)]];
    for (const x of [-0.05, -0.22, -0.38, -0.50, xrt]) pts.push([x, top(x)]);
    pts.push([xr + 0.005, sill(xr) + 0.05]);
    door.push(...pts);
  }
  { // fixed triangle at the mirror base
    const x0 = 0.462, x1 = 0.60;
    tri.push([x0, sill(x0)], [x1, sill(x1)], [x0, Math.max(top(x0), sill(x0) + 0.02)]);
    const t = tri[2]; tri[2] = [x0 + 0.004, t[1]];
  }
  { // small triangular rear quarter glass on the broad sail panel (911 hallmark)
    const xa = -0.752, xe = -1.16;
    const bot = [], up = [];
    for (const x of [xa, -0.90, -1.03, xe]) { bot.push([x, sill(x) + 0.004]); }
    for (const x of [-1.03, -0.90, xa]) up.push([x, Math.max(top(x, 0.03), sill(x) + 0.01)]);
    quarter.push(...bot, ...up);
  }
  // windshield and rear glass in plan (x, z) with full symmetric polygons
  const zEdge = x => zL(x, roofEdge(x));
  const shield = [], rear = [], roofp = [];
  {  // windshield: explicit plan outline (x, half width), wide at the cowl, narrower at the header
    const half = [[0.685, 0.700], [0.55, 0.683], [0.40, 0.652], [0.25, 0.618], [0.13, 0.583], [0.056, 0.552]];
    for (const [x, z] of half) shield.push([x, -z]);
    for (let i = half.length - 1; i >= 0; i--) shield.push([half[i][0], half[i][1]]);
  }
  {  // rear glass: small, wide, oval-ish window set into the fastback
    const half = [[-0.90, 0.43], [-0.97, 0.49], [-1.08, 0.53], [-1.22, 0.53], [-1.33, 0.48], [-1.41, 0.39], [-1.455, 0.26], [-1.47, 0.12]];
    for (const [x, z] of half) rear.push([x, -z]);
    for (let i = half.length - 1; i >= 0; i--) rear.push([half[i][0], half[i][1]]);
  }
  {
    const xa = -0.83, xb = 0.005, m = 0.045;
    const xs = [xa, -0.6, -0.3, -0.05, xb];
    const half = xs.map(x => [x, zEdge(x) - m]);
    for (const [x, z] of half) roofp.push([x, -z]);
    for (let i = half.length - 1; i >= 0; i--) roofp.push([half[i][0], half[i][1]]);
  }

  // convex polygon distance function (winding independent: normals are oriented towards the centroid)
  function polyGLSL(name, pts, k) {
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
    let s = `float ${name}(vec2 p) { float d = -1e3;\n`;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny); if (l < 1e-6) continue; nx /= l; ny /= l;
      if ((cx - a[0]) * nx + (cy - a[1]) * ny > 0) { nx = -nx; ny = -ny; }
      s += `  d = bd_smax(d, dot(p - vec2(${f5(a[0])}, ${f5(a[1])}), vec2(${f5(nx)}, ${f5(ny)})), ${k});\n`;
    }
    return s + '  return d; }\n';
  }
  PG.body.cabinPolys = { door, tri, quarter, shield, rear, roofp };

  const common = () => `
// ---- cabin: window regions
${polyGLSL('cabinPolyDoor', door, '0.05')}${polyGLSL('cabinPolyTri', tri, '0.03')}${polyGLSL('cabinPolyQuarter', quarter, '0.05')}
${polyGLSL('cabinPolyShield', shield, '0.09')}${polyGLSL('cabinPolyRear', rear, '0.06')}${polyGLSL('cabinPolyRoof', roofp, '0.05')}
float cabinBandSide(vec3 p) { return abs(bd_ghSide(p.x, p.y, p.z)) - 0.045; }
float cabinBandRoof(vec3 p) { return abs(p.y - bd_roofY(p.x, p.z)) - 0.05; }
float cabin_panel(int i, vec3 p) {
  if (i == 0) return max(cabinPolyDoor(p.xy), cabinBandSide(p));
  if (i == 1) return max(cabinPolyTri(p.xy), cabinBandSide(p));
  if (i == 2) return max(cabinPolyQuarter(p.xy), cabinBandSide(p));
  if (i == 3) return max(cabinPolyShield(p.xz), cabinBandRoof(p));
  return max(cabinPolyRear(p.xz), cabinBandRoof(p));
}
float cabin_glass(vec3 p) {
  float d = cabin_panel(0, p);
  d = min(d, cabin_panel(1, p)); d = min(d, cabin_panel(2, p)); d = min(d, cabin_panel(3, p)); d = min(d, cabin_panel(4, p));
  return d;
}
float cabin_trim(vec3 p) {
  const float W = 0.022;
  float d = min(cabin_panel(0, p), cabin_panel(1, p)) - W;
  d = min(d, cabin_panel(2, p) - W); d = min(d, cabin_panel(3, p) - W * 1.6); d = min(d, cabin_panel(4, p) - W * 1.6);
  return d;   // (the glass interior is discarded by the paint part, so no exclusion is needed - it would leave an AA seam at the glass edge)
}
float cabin_roof(vec3 p) { return max(cabinPolyRoof(p.xz), cabinBandRoof(p)); }
`;
  const shade = `
void cabin_glassShade(inout Surf s, vec3 p, vec3 n, float fw) {
  float g = cabin_glass(p);
  float frit = smoothstep(-0.014 - fw, -0.014 + fw, g);           // ceramic frit border, ~2 cm
  s.baseColor = mix(s.baseColor, vec3(0.006, 0.006, 0.007), frit);
  s.alpha = mix(s.alpha, 1.0, frit);
  s.roughness = mix(s.roughness, 0.28, frit);
}
void shade_cabin(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {
  float t = cabin_trim(p);
  float m = bd_aa(t, fw);
  if (m > 0.0) {
    s.baseColor = mix(s.baseColor, vec3(0.008, 0.008, 0.009), m); s.metallic = mix(s.metallic, 0.0, m);
    s.roughness = mix(s.roughness, 0.30, m); s.clearcoat = mix(s.clearcoat, 0.6, m); s.flake = mix(s.flake, 0.0, m);
  }
}
`;
  PG.body.registerFeature({ name: 'cabin', order: 50, common, sdf: 'float feat_cabin(vec3 p, float d) { return d; }', shade });
})();
