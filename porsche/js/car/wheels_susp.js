'use strict';
// car/wheels_susp.js - the suspension that shows behind the spokes: upright / hub carrier (SDF), dust shield, teardrop-section
// wishbones (front double wishbone, rear multilink), tie rod, coil-over damper, rear drive-shaft with CV boot.
// Wheel-local space of the RIGHT wheel (+Z outboard, z < 0 inboard, +X forward, +Y up). Left wheels use mirrored meshes.
(function () {
  const PG = window.PG;
  const P = PG.wheelsParts = PG.wheelsParts || {};
  const f6 = x => (+x).toFixed(6);

  // hard points (right-local coordinates, relative to the wheel centre)
  P.suspCfg = function (axle) {
    const rear = axle === 'rear', b = P.brakeCfg(axle);
    if (!rear) return {
      axle, b, rear, camber: -1.5 * Math.PI / 180, pivotZ: -0.108,
      lowerBall: [0, -0.205, -0.108], upperBall: [0, 0.196, -0.108],
      lowerLegs: [[0.205, -0.168, -0.455], [-0.225, -0.162, -0.455]],
      upperLegs: [[0.150, 0.222, -0.405], [-0.175, 0.232, -0.405]],
      steerArm: [0.092, -0.062, -0.122], rodIn: [0.098, -0.052, -0.455],
      damperLo: [0.045, -0.185, -0.315], damperHi: [0.058, 0.300, -0.365],
    };
    return {
      axle, b, rear, camber: -2.5 * Math.PI / 180, pivotZ: -0.100,
      lowerBall: [0, -0.190, -0.100], upperBall: [0, 0.190, -0.100],
      upperLegs: [[0.215, 0.205, -0.430], [-0.205, 0.220, -0.430]],
      lowerLegs: [[0.030, -0.192, -0.490], [0.225, -0.150, -0.430]],       // spring link, lower control link
      toeIn: [-0.090, -0.035, -0.108], toeOut: [-0.305, -0.005, -0.450],
      damperLo: [0.022, -0.168, -0.340], damperHi: [0.075, 0.295, -0.372],
    };
  };

  const setId = (m, id) => { m.attrs = new Float32Array(m.positions.length / 3 * 4); for (let i = 0; i < m.attrs.length; i += 4) { m.attrs[i] = 1; m.attrs[i + 1] = id; } return m; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const nrm = a => mul(a, 1 / len(a));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // symmetric teardrop / airfoil section (chord along +x, centred on the chord's 30 % point), thickness ratio t
  function teardrop(chord, t, n) {
    n = n || 14; const up = [], lo = [];
    for (let i = 0; i <= n; i++) {
      const b = i / n, x = 0.5 - 0.5 * Math.cos(b * Math.PI);        // cosine spacing, 0 = nose
      const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
      up.push([(x - 0.30) * chord, yt * chord]); lo.push([(x - 0.30) * chord, -yt * chord]);
    }
    const pts = up.concat(lo.reverse().slice(1, -1));
    return pts.map(p => [-p[0], p[1]]);     // nose towards -x of the profile (sweeps put profile x along +X of the world for our arms -> nose forward)
  }

  // flat aero blade between two points: teardrop section, chord kept horizontal (thickness vertical), nose towards +X. Loft of section rings.
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function blade(p0, p1, c0, c1, t, id, noseSign) {
    const G = PG.geo, d = sub(p1, p0), L = len(d), u = mul(d, 1 / L);
    const up = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const nt = nrm(sub(up, mul(u, dot(up, u))));
    let c = cross(u, nt); if (c[0] * (noseSign || 1) < 0) c = mul(c, -1);
    const n = 12, prof = [];
    const up2 = [], lo2 = [];
    for (let i = 0; i <= n; i++) {
      const b = i / n, x = 0.5 - 0.5 * Math.cos(b * Math.PI);
      const yt = 5 * 0.5 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);   // half thickness / (chord*t) *... (t applied below)
      up2.push([x, yt]); lo2.push([x, -yt]);
    }
    const ring0 = up2.concat(lo2.reverse().slice(1, -1));
    const S = 8, rings = [];
    for (let k = 0; k <= S; k++) {
      const s = k / S, ch = c0 + (c1 - c0) * s, ctr = add(p0, mul(d, s)), ring = [];
      for (const q of ring0) ring.push(add(ctr, add(mul(c, (0.30 - q[0]) * ch), mul(nt, q[1] * ch * t * 2))));
      rings.push(ring);
    }
    return setId(G.loft(rings, { closed: true, caps: true, crease: 50 }), id);
  }
  // clevis bracket: two thin ear plates (normal along X) around a bush at p, reaching back to the mounting plane z = zBack, plus the bolt
  function clevis(p, zBack, spread, height, id, bolt) {
    const G = PG.geo, out = [], zf = p[2] + 0.030, depth = zf - zBack, zc = (zf + zBack) / 2;
    for (const sg of [-1, 1]) out.push(setId(G.translate(G.box(0.0055, height, depth, { radius: 0.0016, segments: 1 }), p[0] + sg * spread, p[1], zc), id));
    if (bolt !== false) {
      out.push(rodX(p[0] - spread - 0.004, p[0] + spread + 0.004, p[1], p[2], 0.0068, 2));
      out.push(rodX(p[0] + spread + 0.0045, p[0] + spread + 0.0085, p[1], p[2], 0.0120, 2, 6));
    }
    return out;
  }
  function rodX(x0, x1, y, z, r, id, seg) {
    const G = PG.geo; return setId(G.translate(G.cylinder(r, r, Math.abs(x1 - x0), seg || 14, 1, { axis: 'x' }), (x0 + x1) / 2, y, z), id);
  }
  // rubber-bushed end of a blade: steel sleeve along X with rubber ends
  function bushEnd(p, r, len) {
    const out = [rodX(p[0] - len / 2, p[0] + len / 2, p[1], p[2], r, 0, 18), rodX(p[0] - len / 2 - 0.004, p[0] - len / 2, p[1], p[2], r * 0.82, 1, 16), rodX(p[0] + len / 2, p[0] + len / 2 + 0.004, p[1], p[2], r * 0.82, 1, 16)];
    return out;
  }
  // outer ball-joint housing on the upright side: vertical boss + tapered rubber boot + castle nut
  function ballHousing(p, dir, rb) {
    const G = PG.geo, out = [];
    let boss = G.cylinder(rb, rb, 0.026, 20, 1); boss = G.translate(boss, p[0], p[1] + dir * 0.0, p[2]); out.push(setId(boss, 0));
    let boot = G.cylinder(rb * 0.62, rb * 0.95, 0.020, 18, 1); if (dir > 0) boot = G.rotateX(boot, Math.PI);
    boot = G.translate(boot, p[0], p[1] - dir * 0.022, p[2]); out.push(setId(boot, 1));
    let nut = G.cylinder(0.0105, 0.0105, 0.012, 6, 1); nut = G.translate(nut, p[0], p[1] + dir * 0.0195, p[2]); out.push(setId(nut, 2));
    return out;
  }
  function boxAt(c, sx, sy, sz, id, rad) { const G = PG.geo; return setId(G.translate(G.box(sx, sy, sz, { radius: rad === undefined ? 0.002 : rad, segments: 1 }), c[0], c[1], c[2]), id); }
  const rotXp = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
  const lerp3 = (a, b, t) => add(a, mul(sub(b, a), t));

  function ballBoot(p, r, id) { const G = PG.geo; return setId(G.translate(G.sphere(r, 16, 10), p[0], p[1], p[2]), id); }
  // cylinder between two points
  function rod(p0, p1, r, seg, id) {
    const G = PG.geo, m4 = PG.m4, d = sub(p1, p0), L = len(d), u = nrm(d);
    // build along +Y then rotate Y -> u
    const y = [0, 1, 0], ax = cross(y, u), al = len(ax), ang = Math.acos(Math.max(-1, Math.min(1, u[1])));
    let m = G.cylinder(r, r, L, seg || 14, 1);
    const R = al < 1e-6 ? (u[1] > 0 ? m4.identity() : m4.rotationX(Math.PI)) : m4.rotationAxis(mul(ax, 1 / al), ang);
    const c = mul(add(p0, p1), 0.5);
    m = G.transform(m, m4.chain(m4.translation(c[0], c[1], c[2]), R));
    return setId(m, id);
  }
  const rodEnds = (p0, p1, r, seg, id) => rod(p0, p1, r, seg, id);
  function helix(a, b, radius, turns, wire, id) {
    const G = PG.geo, axis = nrm(sub(b, a)), tmp = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = nrm(cross(axis, tmp)), v = cross(axis, u), L = len(sub(b, a)), N = Math.round(turns * 14), path = [];
    for (let i = 0; i <= N; i++) { const t = i / N, ang = t * turns * Math.PI * 2; const c = add(a, mul(axis, L * t)); path.push(add(c, add(mul(u, Math.cos(ang) * radius), mul(v, Math.sin(ang) * radius)))); }
    return setId(G.tube(path, wire, { radialSegments: 8, caps: 'flat', crease: 60 }), 4);
  }
  function coilover(lo, hi, rearAxle) {
    const G = PG.geo, m4 = PG.m4, parts = [], axis = nrm(sub(hi, lo)), L = len(sub(hi, lo));
    parts.push(helix(add(lo, mul(axis, 0.045)), sub(hi, mul(axis, 0.03)), 0.036, rearAxle ? 8.5 : 9.5, 0.0044, 4));
    parts.push(rod(add(lo, mul(axis, 0.0)), add(lo, mul(axis, L * 0.62)), 0.0235, 16, 5));      // damper body
    parts.push(rod(add(lo, mul(axis, L * 0.60)), sub(hi, mul(axis, 0.0)), 0.0105, 12, 2));       // piston rod
    parts.push(rod(add(lo, mul(axis, 0.040)), add(lo, mul(axis, 0.046)), 0.046, 24, 5));        // lower spring perch
    parts.push(rod(sub(hi, mul(axis, 0.036)), sub(hi, mul(axis, 0.030)), 0.046, 24, 5));         // upper perch
    parts.push(rod(sub(hi, mul(axis, 0.030)), hi, 0.030, 16, 1));                                 // top mount rubber
    return parts;
  }

  // rear: pleated CV boot + shaft, along -Z from the hub
  function driveShaft() {
    const G = PG.geo, parts = [];
    const prof = [[0.010, -0.100]];
    // outer CV cup, then pleated boot, then shaft
    const pl = []; const z0 = -0.128, z1 = -0.235, n = 7;
    pl.push([0.020, z0]);
    for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 0.5) / n, t2 = (i + 1) / n; const rB = 0.050 - 0.026 * t0; pl.push([rB + 0.006, z0 + (z1 - z0) * t1]); pl.push([rB - 0.010 * (1 - 0.3 * t0) + 0.0, z0 + (z1 - z0) * t2]); }
    pl.push([0.013, z1 - 0.008]); pl.push([0.013, -0.46]);
    const boot = G.lathe(pl.map(p => [p[0], p[1]]), 40, { axis: 'z', crease: 30 });
    parts.push(setId(boot, 1));
    const cup = G.lathe([[0, -0.098], [0.046, -0.098], [0.050, -0.103], [0.050, -0.122], [0.030, -0.130], [0.0, -0.130]].reverse().reverse(), 40, { axis: 'z', crease: 40 });
    parts.push(setId(cup, 2));
    parts.push(setId(G.lathe([[0.013, -0.24], [0.014, -0.24], [0.014, -0.46], [0.013, -0.46]], 16, { axis: 'z', crease: 40 }), 2));
    return parts;
  }

  // ---- upright / hub carrier (SDF) --------------------------------------------------------------------------
  function uprightGLSL(S) {
    const b = S.b, rear = S.rear;
    const lb = S.lowerBall, ub = S.upperBall;
    const R = b.R, phi = b.phi, ha = b.halfArc;
    const lugA = [Math.cos(phi + ha * 0.66) * (R - 0.035), Math.sin(phi + ha * 0.66) * (R - 0.035), b.zi - 0.026];
    const lugB = [Math.cos(phi - ha * 0.66) * (R - 0.035), Math.sin(phi - ha * 0.66) * (R - 0.035), b.zi - 0.026];
    const v3 = a => `vec3(${f6(a[0])}, ${f6(a[1])}, ${f6(a[2])})`;
    const steer = rear ? `sdCapsule(p, vec3(-0.010, -0.030, -0.112), ${v3(S.toeIn)}, 0.011)` : `sdCapsule(p, vec3(0.0, -0.045, -0.112), ${v3(S.steerArm)}, 0.0125)`;
    return `
float map(vec3 p) {
  float hub = sdCappedCylinderZ(p - vec3(0.0, 0.0, -0.079), 0.049, 0.048);
  float flange = sdCappedCylinderZ(p - vec3(0.0, 0.0, ${f6(b.zi - 0.020)}), 0.078, 0.0055);
  float beam = sdRoundCone(p, ${v3(lb)}, ${v3(ub)}, 0.018, 0.016);
  float web = sdRoundBox(p - vec3(-0.002, 0.0, -0.106), vec3(0.052, 0.108, 0.013), 0.010);
  float d = smin(hub, beam, 0.016);
  d = smin(d, web, 0.016);
  d = smin(d, flange, 0.008);
  d = smin(d, sdCapsule(p, vec3(0.0, 0.0, -0.09), ${v3(lugA)}, 0.0125), 0.010);
  d = smin(d, sdCapsule(p, vec3(0.0, 0.0, -0.09), ${v3(lugB)}, 0.0125), 0.010);
  d = smin(d, ${steer}, 0.010);
  d = min(d, sdSphere(p - ${v3(lb)}, 0.0185));
  d = min(d, sdSphere(p - ${v3(ub)}, 0.0185));
  // bearing bore / hub face relief
  d = smax(d, -sdCappedCylinderZ(p - vec3(0.0, 0.0, -0.030), 0.030, 0.010), 0.003);
  return d * 0.9;
}`;
  }

  // steering group matrix: static camber about the wheel centre (X axis) * yaw about the vertical steering axis through the ball joints
  P.steerMatrix = function (S, side, delta) {
    const m4 = PG.m4, pz = side * S.pivotZ;
    return m4.chain(m4.rotationX(side * S.camber), m4.translation(0, 0, pz), m4.rotationY(delta), m4.translation(0, 0, -pz));
  };

  P.buildSuspension = async function (ctx, axle) {
    const G = PG.geo, m4 = PG.m4, S = P.suspCfg(axle), b = S.b, rear = S.rear, gl = ctx.gl;
    // ---------- steered hub group: upright + dust shield (+ rear drive-shaft)
    const R = b.R, lb = S.lowerBall, ub = S.upperBall;
    const x0 = -0.11, x1 = 0.13, y0 = lb[1] - 0.03, y1 = ub[1] + 0.03;
    const sdfBounds = { min: [-0.13, y0, -0.16], max: [0.14, y1, -0.03] };
    // extend bounds for the caliper lugs
    let bx0 = -0.13, bx1 = 0.14, by0 = y0, by1 = y1;
    for (const sg of [1, -1]) { const a = b.phi + sg * b.halfArc * 0.66, r = R - 0.035; bx0 = Math.min(bx0, Math.cos(a) * r - 0.03); bx1 = Math.max(bx1, Math.cos(a) * r + 0.03); by0 = Math.min(by0, Math.sin(a) * r - 0.03); by1 = Math.max(by1, Math.sin(a) * r + 0.03); }
    if (!rear) { bx1 = Math.max(bx1, S.steerArm[0] + 0.03); } else { bx0 = Math.min(bx0, S.toeIn[0] - 0.03); }
    const up = await PG.sdf.mesh(gl, { glsl: uprightGLSL(S), min: [bx0, by0, -0.16], max: [bx1, by1, -0.02], voxel: 0.0038 * ctx.quality, label: 'upright_' + axle, aoScale: 0.04, aoStrength: 1.0 });
    setId(up, 3);
    const hubParts = [up];
    // dust shield: partial disc (open where the caliper sits)
    { const gap = b.halfArc * 1.06, zs = b.zi - 0.0125;
      const ds = G.lathe([[0.060, zs - 0.0013], [R - 0.012, zs - 0.0013], [R - 0.010, zs + 0.0013], [0.060, zs + 0.0013], [0.060, zs - 0.0013]], 96, { axis: 'z', crease: 40, start: b.phi + gap, sweep: Math.PI * 2 - 2 * gap });
      hubParts.push(setId(ds, 0)); }
    // ball joint boots (rubber) and steering / toe joint end
    hubParts.push(ballBoot(lb, 0.0135, 1), ballBoot(ub, 0.0135, 1));
    if (rear) hubParts.push(...driveShaft());
    else hubParts.push(ballBoot(S.steerArm, 0.0105, 1));
    // brake hose from the caliper bridge (banjo) up to the body
    { const a = b.phi + b.halfArc * 0.42, rT = b.cz.rTop;
      const p0 = [Math.cos(a) * (rT + 0.001), Math.sin(a) * (rT + 0.001), (b.cz.zi1 + b.cz.zi0) * 0.5];
      const path = G.catmullRom([p0, add(p0, [-0.020, 0.030, -0.010]), [-0.05, 0.19, -0.08], [-0.06, 0.212, -0.16], [-0.085, 0.225, -0.25]], { segments: 10 });
      hubParts.push(setId(G.tube(path, 0.0038, { radialSegments: 8, caps: 'flat' }), 6));
      hubParts.push(setId(G.translate(G.sphere(0.0072, 10, 8), p0[0], p0[1], p0[2]), 2)); }
    const hub = G.merge(hubParts);
    // ---------- static arms (frame level): wishbone / multilink blades with bushings, clevis brackets, sub-frame rails, crossmember, tower plate
    const arms = [], cam = S.camber;
    const lB = rotXp(S.lowerBall, cam), uB = rotXp(S.upperBall, cam);          // ball joints follow the static camber (upright is rotated by the steer group)
    const twr = rear ? -0.470 : -0.445;        // plane of the inner wheelhouse / tower plate (upper mounts)
    const rz = rear ? -0.520 : -0.492;         // plane of the lower sub-frame rail
    // upper arm(s): blades from the upper ball to two inboard bushes
    const uc = rear ? 0.056 : 0.068;
    for (const q of S.upperLegs) {
      arms.push(blade(uB, q, uc * 0.92, uc, 0.34, 0));
      arms.push(...bushEnd(q, 0.0165, 0.055)); arms.push(...clevis(q, twr, 0.0345, 0.052, 0));
    }
    arms.push(...ballHousing(uB, +1, 0.021));
    // lower arm(s)
    if (!rear) {
      for (const q of S.lowerLegs) { arms.push(blade(lB, q, 0.070, 0.084, 0.34, 0)); arms.push(...bushEnd(q, 0.0195, 0.060)); arms.push(...clevis(q, rz, 0.0375, 0.058, 0)); }
      // cross brace between the two legs (carries the damper fork)
      const ta = (0.315 - 0.108) / 0.347, pa = lerp3(lB, S.lowerLegs[0], ta), pb = lerp3(lB, S.lowerLegs[1], ta);
      arms.push(rodEnds(pa, pb, 0.0105, 12, 0));
      arms.push(...clevis([S.damperLo[0], S.damperLo[1] + 0.0, S.damperLo[2]], S.damperLo[2] - 0.030, 0.0215, 0.052, 0));
    } else {
      const sl = S.lowerLegs[0], cl = S.lowerLegs[1];
      arms.push(blade(lB, sl, 0.088, 0.072, 0.32, 0)); arms.push(...bushEnd(sl, 0.0195, 0.060)); arms.push(...clevis(sl, rz, 0.0375, 0.058, 0));
      arms.push(blade(lB, cl, 0.054, 0.060, 0.36, 0)); arms.push(...bushEnd(cl, 0.0165, 0.052)); arms.push(...clevis(cl, rz + 0.02, 0.0325, 0.05, 0));
      arms.push(blade(S.toeIn, S.toeOut, 0.030, 0.034, 0.34, 0, 1)); arms.push(...bushEnd(S.toeOut, 0.0130, 0.040)); arms.push(...clevis(S.toeOut, rz + 0.03, 0.0235, 0.036, 0));
      arms.push(ballBoot(S.toeIn, 0.0125, 1));
      // spring perch pad on the spring link
      const tp = (0.340 - 0.100) / 0.390, pl = lerp3(lB, sl, tp);
      arms.push(boxAt([pl[0], pl[1] + 0.017, pl[2]], 0.062, 0.010, 0.062, 0, 0.004));
      arms.push(...clevis([S.damperLo[0], S.damperLo[1] + 0.004, S.damperLo[2]], S.damperLo[2] - 0.030, 0.0215, 0.048, 0));
    }
    arms.push(...ballHousing(lB, -1, 0.023));
    // sub-frame: side rail along X + cross member running to the car centre line; tower plate for the upper mounts
    {
      const yL = rear ? -0.165 : -0.166, cz1 = -(PG.spec.wheel[axle].track / 2);           // -track/2 = car centre line in the wheel-local frame
      const rx0 = rear ? -0.400 : -0.330, rx1 = rear ? 0.340 : 0.330;
      arms.push(boxAt([(rx0 + rx1) / 2, yL, rz - 0.020], rx1 - rx0, 0.062, 0.040, 7, 0.006));                // side rail (sheet metal / cast)
      arms.push(boxAt([(rx0 + rx1) / 2, yL, rz - 0.020], rx1 - rx0 - 0.02, 0.050, 0.046, 7, 0.006));
      arms.push(boxAt([rx1 * 0.5 + rx0 * 0.5, yL, (rz - 0.040 + cz1) / 2], 0.070, 0.056, Math.abs(cz1 - (rz - 0.040)), 7, 0.005)); // cross member to the centre
      arms.push(boxAt([0.0, 0.215, twr - 0.009], 0.62, 0.30, 0.016, 7, 0.006));                                      // tower / inner wheelhouse plate
      arms.push(boxAt([0.0, 0.385, twr - 0.004], 0.62, 0.022, 0.050, 7, 0.004));                                       // its top flange
    }
    if (!rear) {   // steering rack housing with inner tie-rod boot, running to the centre line
      const c0 = -(PG.spec.wheel[axle].track / 2), rz0 = S.rodIn[2];
      arms.push(setId(G.translate(G.cylinder(0.024, 0.024, Math.abs(c0 - rz0) - 0.05, 24, 1, { axis: 'z' }), S.rodIn[0], S.rodIn[1], (c0 + rz0 - 0.05) / 2 - 0.01), 7));
      const pl = []; for (let i = 0; i < 6; i++) { pl.push([0.0128 + 0.0, rz0 - 0.004 - i * 0.0095 + 0.002]); pl.push([0.0225, rz0 - 0.004 - i * 0.0095 - 0.0045]); }
      arms.push(G.translate(setId(G.lathe([[0.0085, 0.0], [0.0085, -0.004]].concat(pl.map(p => [p[0], p[1] - rz0])).concat([[0.0085, -0.065], [0.0085, -0.066]]), 24, { axis: 'z', crease: 40 }), 1), S.rodIn[0], S.rodIn[1], rz0));
    }
    arms.push(...coilover(S.damperLo, S.damperHi, rear));
    // top mount cup bolted on the tower plate
    arms.push(boxAt([S.damperHi[0], S.damperHi[1] + 0.020, (S.damperHi[2] + twr) / 2 - 0.004], 0.070, 0.040, Math.abs(twr - S.damperHi[2]) + 0.04, 0, 0.006));
    // rear drive-shaft inboard end: second CV joint + transaxle output flange (so the shaft does not end in air)
    if (rear) {
      const G = PG.geo, ps = [[0.013, -0.46], [0.013, -0.470], [0.034, -0.474], [0.048, -0.50], [0.052, -0.57], [0.048, -0.585], [0.030, -0.592], [0.0, -0.592]];
      arms.push(setId(G.lathe(ps.map(p => [p[0], p[1]]), 32, { axis: 'z', crease: 40 }), 1));
      arms.push(setId(G.lathe([[0.0, -0.592], [0.078, -0.592], [0.078, -0.640], [0.0, -0.640]], 40, { axis: 'z', crease: 40 }), 2));
    }
    const armsMesh = G.merge(arms);
    // ---------- tie rod (front): unit-length rod along +X, scaled per frame
    let rodMesh = null;
    if (!rear) { const r = G.cylinder(0.0085, 0.0085, 1, 12, 1); rodMesh = setId(G.transform(r, m4.chain(m4.translation(0.5, 0, 0), m4.rotationZ(-Math.PI / 2))), 0); }
    return { hub, arms: armsMesh, rod: rodMesh, cfg: S };
  };

  P.suspHook = `
void surfaceHook(inout Surf s, in Frag f) {
  float id = f.attr.y;
  vec3 p = f.pObj;
  float n1 = pg_vnoise(p.xy * 260.0 + p.z * 190.0);
  if (id < 0.5) { s.baseColor = vec3(0.030, 0.030, 0.032); s.metallic = 0.55; s.roughness = 0.52 + 0.06 * n1; s.clearcoat = 0.0; }              // black satin steel / forged arms
  else if (id < 1.5) { s.baseColor = vec3(0.012, 0.012, 0.012); s.metallic = 0.0; s.roughness = 0.82; s.clearcoat = 0.0; }                       // rubber boots, bushings
  else if (id < 2.5) { s.baseColor = vec3(0.42, 0.43, 0.44); s.metallic = 1.0; s.roughness = 0.38 + 0.08 * n1; s.clearcoat = 0.0; }               // raw steel / zinc
  else if (id < 3.5) { s.baseColor = vec3(0.16, 0.16, 0.17); s.metallic = 1.0; s.roughness = 0.60 + 0.15 * n1; s.clearcoat = 0.0; }               // cast aluminium (upright)
  else if (id < 4.5) { s.baseColor = vec3(0.045, 0.045, 0.048); s.metallic = 0.7; s.roughness = 0.42; s.clearcoat = 0.0; }                        // spring
  else if (id < 5.5) { s.baseColor = vec3(0.020, 0.020, 0.022); s.metallic = 0.8; s.roughness = 0.35; s.clearcoat = 0.0; }                        // damper body
  else if (id < 6.5) { s.baseColor = vec3(0.020, 0.020, 0.024); s.metallic = 0.3; s.roughness = 0.5; s.clearcoat = 0.0; }                       // braided hose
  else { s.baseColor = vec3(0.020, 0.021, 0.023) * (0.8 + 0.4 * n1); s.metallic = 0.35; s.roughness = 0.62; s.clearcoat = 0.0; }             // sub-frame / plate sheet metal
}
`;
})();
