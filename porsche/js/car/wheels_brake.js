'use strict';
// car/wheels_brake.js - brake disc (explicit geometry: extruded drilled plates, vanes, aluminium hat) and monobloc caliper (SDF).
// Wheel-local space: origin = wheel centre, axis Z (+Z outboard for the RIGHT wheel), +X forward, +Y up.
(function () {
  const PG = window.PG;
  const P = PG.wheelsParts = PG.wheelsParts || {};
  const f6 = x => (+x).toFixed(6);

  // brake layout per axle (metres). PCCB: 410/390 mm discs, yellow calipers.
  P.brakeCfg = function (axle) {
    const rim = P.rimCfg(axle), rear = axle === 'rear';
    const c = {
      axle, rim,
      R: rear ? 0.195 : 0.205,              // disc outer radius
      rin: rear ? 0.118 : 0.128,            // friction ring inner radius
      t: rear ? 0.030 : 0.036,              // disc thickness
      plate: rear ? 0.0060 : 0.0065,        // one friction plate
      hatR: rear ? 0.108 : 0.116,           // outer radius of the hat wall
      bore: 0.036,
      // caliper
      phi: (rear ? 6 : 176) * Math.PI / 180,  // centre angle of the caliper (CCW from +X, right wheel, seen from outside)
      halfArc: rear ? 0.60 : 0.70,          // half opening angle (rad)
      depthIn: rear ? 0.060 : 0.072,        // radial size of the caliper below the disc edge
      over: 0.019,                          // radial overhang above the disc edge
      pistons: rear ? 2 : 3,
    };
    c.zc = rim.hubF - (rear ? 0.056 : 0.055);           // disc centre plane
    c.zTop = rim.hubF - 0.0055;                          // hat mounting plane (behind the wheel hub face)
    c.zo = c.zc + c.t / 2; c.zi = c.zc - c.t / 2;        // outer / inner friction faces
    { const zo0 = c.zo + 0.0035, zi0 = c.zi - 0.0035; c.cz = { zo0, zo1: zo0 + (rear ? 0.036 : 0.040), zi0, zi1: zi0 - (rear ? 0.034 : 0.038), rIn: c.R - c.depthIn, rTop: c.R + c.over }; }
    return c;
  };

  // ------------------------------------------------------------------ disc
  P.buildDisc = function (ctx, axle) {
    const G = PG.geo, m4 = PG.m4, c = P.brakeCfg(axle), meshes = [];
    const circ = (r, n, cx, cy, ph) => { cx = cx || 0; cy = cy || 0; const o = []; for (let i = 0; i < n; i++) { const a = (ph || 0) + i / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
    const setId = (m, id) => { m.attrs = new Float32Array(m.positions.length / 3 * 4); for (let i = 0; i < m.attrs.length; i += 4) { m.attrs[i] = 1; m.attrs[i + 1] = id; } return m; };
    // cross-drilled holes (3 rows, staggered, slightly swirled)
    const rows = axle === 'rear' ? [[0.146, 54], [0.163, 60], [0.180, 66]] : [[0.153, 56], [0.171, 62], [0.189, 68]];
    const holes = [];
    rows.forEach(([r, n], j) => { for (let i = 0; i < n; i++) holes.push(circ(0.0033, 8, 0, 0, 0).map(p => [p[0] + Math.cos((i + j * 0.5) / n * Math.PI * 2 + j * 0.02) * r, p[1] + Math.sin((i + j * 0.5) / n * Math.PI * 2 + j * 0.02) * r])); });
    const outer = circ(c.R, 180), inner = circ(c.rin, 120);
    const plateOuter = G.extrude(outer, c.plate, { holes: [inner].concat(holes), crease: 40 });
    const pO = G.translate(plateOuter, 0, 0, c.zo - c.plate);
    const pI = G.translate(plateOuter, 0, 0, c.zi);
    meshes.push(setId(pO, 0), setId(pI, 0));
    // vanes between the plates
    const nV = axle === 'rear' ? 52 : 60, vl = c.R - c.rin - 0.004, gap = c.t - 2 * c.plate;
    let vane = G.box(vl, 0.0042, gap + 0.001, { segments: 1 });
    vane = setId(G.translate(vane, c.rin + 0.002 + vl / 2, 0, c.zc), 0);
    const vs = [], vt = [];
    for (let i = 0; i < nV; i++) { vs.push(vane); vt.push(m4.rotationZ(i / nV * Math.PI * 2)); }
    meshes.push(G.merge(vs, vt));
    // aluminium hat: mounting plate (against the wheel hub face), cylindrical wall, flange to the ring (three closed lathes)
    const zT = c.zTop, zR = c.zc, rect = (r0, r1, z0, z1) => G.lathe([[r0, z0], [r1, z0], [r1, z1], [r0, z1], [r0, z0]], 96, { axis: 'z', crease: 40 });
    meshes.push(setId(rect(c.bore, c.hatR + 0.004, zT - 0.0040, zT), 1));
    meshes.push(setId(rect(c.hatR - 0.0035, c.hatR + 0.0005, zR - 0.0030, zT - 0.0035), 1));
    meshes.push(setId(rect(c.hatR - 0.0035, c.rin + 0.003, zR - 0.0030, zR + 0.0030), 1));
    const out = G.merge(meshes);
    out.cfg = c; return out;
  };

  P.discHook = `
void surfaceHook(inout Surf s, in Frag f) {
  float id = f.attr.y;
  vec3 p = f.pObj;
  float rho = length(p.xy);
  if (id > 0.5) {                       // aluminium hat: dark anodised silver
    s.baseColor = vec3(0.13, 0.13, 0.14); s.metallic = 1.0; s.roughness = 0.46; s.clearcoat = 0.0;
    s.roughness += 0.05 * (pg_vnoise(vec2(rho * 700.0, atan(p.y, p.x) * 30.0)) - 0.5);
    return;
  }
  float axial = smoothstep(0.7, 0.95, abs(s.normal.z));
  float aa = 1.0 - smoothstep(0.0006, 0.003, f.fw);
  float ring = sin(rho * 1900.0) * 0.5 + 0.5;
  float n1 = pg_vnoise(vec2(rho * 500.0, atan(p.y, p.x) * 40.0));
  s.normal = normalize(s.normal + vec3(p.xy / max(rho, 1e-4) * (ring - 0.5) * 0.06 * axial * aa, 0.0));
  // pad swept band a little smoother/lighter, edges & inner region darker
  float band = smoothstep(uBand.x - 0.004, uBand.x + 0.004, rho) * (1.0 - smoothstep(uBand.y - 0.004, uBand.y + 0.004, rho));
  s.roughness = clamp(s.roughness + (n1 - 0.5) * 0.18 - band * 0.10 * axial, 0.15, 1.0);
  s.baseColor *= 1.0 + band * axial * 0.35 - 0.12 * (1.0 - axial);
}
`.replace('void surfaceHook', 'uniform vec2 uBand;\nvoid surfaceHook');

  // ------------------------------------------------------------------ caliper
  // decal atlas in (arc length, radius) coordinates: R channel = paint print (script), G channel = height (piston recesses)
  P.caliperAtlas = function (axle) {
    const c = P.brakeCfg(axle), W = 1024, H = 320;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const arcLen = 2 * (c.halfArc) * (c.R - 0.01);              // metres covered horizontally
    const rTop = c.R + c.over, rIn = c.R - c.depthIn;
    const ppmX = W / arcLen, ppmY = H / (rTop - rIn);
    g.globalCompositeOperation = 'lighter';
    // pistons (green): large discs with a raised lip ring
    const np = c.pistons, span = arcLen * 0.62, rp = axle === 'rear' ? 0.0190 : 0.0175;
    for (let i = 0; i < np; i++) {
      const x = W / 2 + (np === 1 ? 0 : (i / (np - 1) - 0.5) * span * ppmX), y = (rTop - (c.R - 0.030)) * ppmY;
      const gr = g.createRadialGradient(x, y, 0, x, y, rp * 1.08 * ppmX);
      gr.addColorStop(0, 'rgb(0,150,0)'); gr.addColorStop(0.82, 'rgb(0,150,0)'); gr.addColorStop(0.9, 'rgb(0,255,0)'); gr.addColorStop(1.0, 'rgb(0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rp * 1.08 * ppmX, 0, Math.PI * 2); g.fill();
    }
    // PORSCHE script (red channel)
    g.fillStyle = '#f00'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const yT = (rTop - (c.R - 0.061)) * ppmY;
    g.font = 'italic 700 ' + Math.round(0.030 * ppmY) + 'px "Snell Roundhand","Brush Script MT","Apple Chancery","Lucida Handwriting","Segoe Script",cursive';
    g.fillText('Porsche', W / 2 - 0.02 * ppmX, yT + 4);
    g.font = '700 ' + Math.round(0.0085 * ppmY) + 'px "Helvetica Neue",Arial,sans-serif';
    if ('letterSpacing' in g) g.letterSpacing = '2px';
    g.fillText(axle === 'rear' ? 'PCCB' : 'PCCB', W / 2 + 0.078 * ppmX, yT + 12);
    return { canvas: cv, W, H, arcLen, rIn, rTop };
  };

  // Explicit caliper geometry: a C-section (outer half, bridge, inner half around the disc) swept along the disc arc, ends rounded and
  // tapered, plus pads, bleed nipples and bridge bolts. Right-wheel orientation; mirror for the left wheel.
  P.buildCaliper = async function (ctx, axle) {
    const G = PG.geo, m4 = PG.m4, c = P.brakeCfg(axle), R = c.R, rIn = R - c.depthIn, rTop = R + c.over, rear = axle === 'rear';
    const zo0 = c.zo + 0.0035, zo1 = zo0 + (rear ? 0.036 : 0.040), zi0 = c.zi - 0.0035, zi1 = zi0 - (rear ? 0.034 : 0.038), bridgeR = R + 0.0045;
    const poly = [[zo1, rIn], [zo1, rTop], [zi1, rTop], [zi1, rIn], [zi0, rIn], [zi0, bridgeR], [zo0, bridgeR], [zo0, rIn]];
    const rad = [0.006, 0.007, 0.007, 0.006, 0.0015, 0.0015, 0.0015, 0.006];
    let prof = G.roundPolygon(poly, rad, 5);
    // subdivide long edges a little so the ring is not made of a few huge triangles
    const dense = []; for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.012)); for (let k = 0; k < n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    prof = dense;
    let zc = 0, rc = 0; for (const p of prof) { zc += p[0]; rc += p[1]; } zc /= prof.length; rc /= prof.length;
    const M = 66, rings = [];
    const E = 0.075;      // end zone (fraction of u) rounded
    for (let i = 0; i <= M; i++) {
      // denser sampling in the end zones
      let t = i / M, u = t * 2 - 1;
      const au = Math.abs(u), tt = Math.max(0, (au - (1 - E)) / E);
      const sc = 0.58 + 0.42 * Math.sqrt(Math.max(0, 1 - tt * tt));
      const ring = [];
      for (const p of prof) {
        const z = zc + (p[0] - zc) * sc, r = rc + (p[1] - rc) * sc;
        const A = c.halfArc * (1 - 0.20 * Math.min(1, Math.max(0, (p[1] - rIn) / (rTop - rIn))));
        const a = c.phi + u * A;
        ring.push([Math.cos(a) * r, Math.sin(a) * r, z]);
      }
      rings.push(ring);
    }
    // non-uniform u: remap so that the last 7.5% gets more rings (simple: insert extra rings)
    const body = G.loft(rings, { closed: true, caps: true, crease: 36 });
    const setId = (m, id) => { m.attrs = new Float32Array(m.positions.length / 3 * 4); for (let i = 0; i < m.attrs.length; i += 4) { m.attrs[i] = 1; m.attrs[i + 1] = id; } return m; };
    const parts = [setId(body, 0)];
    // pads: two arcs, rectangular section, slightly longer than the body
    const padT = 0.0105, padIn = rIn + 0.010, padOut = R - 0.0025, PA = c.halfArc * 0.88 + 0.045;
    for (const [za, zb] of [[c.zo + 0.0005, zo0 + padT], [zi0 - padT, c.zi - 0.0005]]) {
      const pr = []; for (let i = 0; i <= 28; i++) { const a = c.phi + (i / 28 * 2 - 1) * PA, r0 = padIn, r1 = padOut; pr.push([[Math.cos(a) * r0, Math.sin(a) * r0, za], [Math.cos(a) * r1, Math.sin(a) * r0 * 0 + Math.sin(a) * r1, za], [Math.cos(a) * r1, Math.sin(a) * r1, zb], [Math.cos(a) * r0, Math.sin(a) * r0, zb]]); }
      parts.push(setId(G.loft(pr, { closed: true, caps: true, crease: 40 }), 1));
    }
    // bleed nipples (2) with dust caps on the bridge top, bridge bolts (hex)
    const radial = (mesh, a, r, z) => G.transform(mesh, m4.chain(m4.translation(Math.cos(a) * r, Math.sin(a) * r, z), m4.rotationZ(a - Math.PI / 2)));
    for (const sg of [1, -1]) {
      const a = c.phi + sg * 0.040 / rTop * 1.0, zn = (zo1 + zo0) * 0.5 + 0.004;
      parts.push(setId(radial(G.cylinder(0.0046, 0.0052, 0.0075, 12, 1), a, rTop + 0.0033, zn), 2));
      parts.push(setId(radial(G.cylinder(0.0030, 0.0034, 0.0100, 12, 1), a, rTop + 0.0110, zn), 3));
      const ab = c.phi + sg * (c.halfArc * 0.62), zb = (zo1 + zi1) * 0.5 - 0.002;
      parts.push(setId(radial(G.cylinder(0.0072, 0.0072, 0.0065, 6, 1), ab, rTop - 0.0005, zb), 2));
    }
    const out = G.merge(parts); out.cfg = c; out.stats = { after: G.triangleCount(out), before: G.triangleCount(out), voxel: 0 };
    return out;
  };
  P.mirrorMesh = function (mesh) { const m = PG.geo.mirror(mesh, 'z'); m.cfg = mesh.cfg; return m; };

  P.caliperHook = `
uniform sampler2D uDecal;
uniform vec4 uC;     // phi, halfArc(unused), R, side
uniform vec4 uC2;    // rIn, rTop, arcLen, zFace
void surfaceHook(inout Surf s, in Frag f) {
  float id = f.attr.y;
  vec3 p = f.pObj;
  if (id > 0.5) {
    if (id < 1.5) { s.baseColor = vec3(0.020, 0.018, 0.017); s.metallic = 0.25; s.roughness = 0.75; s.clearcoat = 0.0; }        // pad
    else if (id < 2.5) { s.baseColor = vec3(0.55, 0.56, 0.58); s.metallic = 1.0; s.roughness = 0.30; s.clearcoat = 0.0; }       // bleed nipple
    else { s.baseColor = vec3(0.010); s.metallic = 0.0; s.roughness = 0.6; s.clearcoat = 0.0; }                                  // dust cap
    return;
  }
  float side = uC.w;
  float rho = length(p.xy);
  float a = atan(p.y, p.x) - uC.x;
  a = a - 6.2831853 * floor((a + 3.14159265) / 6.2831853);
  // reading direction: clockwise as seen from outside -> u = -side * a
  float u = -side * a * (uC.z - 0.01);
  float v = (uC2.y - rho) / (uC2.y - uC2.x);
  vec2 uv = vec2(0.5 + u / uC2.z, clamp(v, 0.001, 0.999));
  vec2 dt = vec2(1.0 / 1024.0, 1.0 / 320.0) * 1.4;
  vec3 c0 = texture(uDecal, uv).rgb;
  float hu = texture(uDecal, uv + vec2(dt.x, 0.0)).g - texture(uDecal, uv - vec2(dt.x, 0.0)).g;
  float hv = texture(uDecal, uv + vec2(0.0, dt.y)).g - texture(uDecal, uv - vec2(0.0, dt.y)).g;
  float face = smoothstep(0.65, 0.92, side * s.normal.z);
  float inb = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, v) * step(v, 1.0);
  // bump: tangent (increasing u) and radial (increasing v = towards centre)
  vec2 eR = p.xy / max(rho, 1e-4);
  vec2 eA = vec2(-eR.y, eR.x) * (-side);       // direction of increasing u in xy
  vec3 g = vec3(eA * (-hu) + eR * (hv), 0.0) * 0.9;
  s.normal = normalize(s.normal + g * face * inb * (1.0 - smoothstep(0.001, 0.004, f.fw)));
  // piston recess: darken inside + AO look
  s.baseColor *= 1.0 - 0.10 * c0.g * face * inb;
  float ink = c0.r * face * inb;
  s.baseColor = mix(s.baseColor, vec3(0.012), ink);
  s.clearcoat = mix(s.clearcoat, 0.6, ink);
  s.roughness = mix(s.roughness, 0.45, ink);
}
`;
})();
