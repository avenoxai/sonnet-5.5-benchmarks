'use strict';
// car/aero_under.js — roof fins, side-skirt blades, rear arch blade, flat undertray (+strakes, intakes), enclosed rear diffuser with fins.   PG.aeroUnder(K)
(function () {
  const PG = window.PG, spec = PG.spec, DEG = Math.PI / 180;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // matrix mapping local (t, y, e) -> world:  origin (cx, 0, cz),  t along r=(rx,0,rz),  y up,  e along zdir
  function frameM(cx, cz, rx, rz, zx, zz) {
    const m = PG.m4.identity();
    m[0] = rx; m[1] = 0; m[2] = rz; m[4] = 0; m[5] = 1; m[6] = 0; m[8] = zx; m[9] = 0; m[10] = zz; m[12] = cx; m[13] = 0; m[14] = cz;
    return m;
  }

  // ---------------------------------------------------------------------------------------------- roof fins
  function roofFins(K) {
    const { G, m4 } = K, F = spec.anchors.roofFin;
    const L = F.length, H = F.height + 0.006, T = 0.008, yaw = 15 * DEG;
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);                  // front -> rear direction of the RIGHT fin (rear end further out)
    const cx = F.x, cz = F.z;
    const roofAt = t => { const y = K.roof(cx + t * rx, cz + t * rz); return y == null ? 1.262 : y; };
    const N = 14, bot = [], top = [];
    for (let i = 0; i <= N; i++) { const t = -L / 2 + L * i / N; bot.push([t, roofAt(t) - 0.009]); }
    // planform: leading end sloped (low front), full height over the rear 2/3, small round at the rear end
    const hgt = t => H * (0.30 + 0.70 * sm(-L / 2, -L / 2 + 0.11, t));
    for (let i = N; i >= 0; i--) { const t = -L / 2 + L * i / N; top.push([t, roofAt(t) + hgt(t)]); }
    const list = bot.map((p, i) => [p[0], p[1], i === 0 ? 0.004 : i === N ? 0.006 : 0]).concat(top.map((p, i) => [p[0], p[1], i === 0 ? 0.010 : i === N ? 0.012 : 0]));
    const poly = G.roundPolygon(list.map(v => [v[0], v[1]]), list.map(v => v[2]), 5);
    const e = G.extrude(poly, T, { center: true, bevel: { size: 0.0022, depth: 0.0022, segments: 2 } });
    const right = G.transform(e, frameM(cx, cz, rx, rz, -Math.sin(yaw), -Math.cos(yaw)));
    K.addMesh('aero_roofFins', G.merge([right, G.mirrorZ(right)]), K.mats.satin, { reflect: false });
  }

  // ---------------------------------------------------------------------------------------------- side skirts
  function skirts(K) {
    const { G, m4 } = K, x0 = -0.84, x1 = 0.84, N = 48, yMid = 0.130, thick = 0.058;
    const inner = [], outer = [];
    for (let i = 0; i <= N; i++) {
      const x = x0 + (x1 - x0) * i / N, zb = K.side(x, yMid) || (spec.halfWidthAt(x) - 0.06);
      const prot = 0.034 * sm(0.0, 0.10, (x - x0) / (x1 - x0)) * sm(0.0, 0.10, 1 - (x - x0) / (x1 - x0));
      inner.push([x, zb - 0.014]); outer.push([x, zb + 0.004 + prot]);
    }
    const ring = inner.concat(outer.reverse());
    const list = ring.map((p, i) => [p[0], p[1], 0]);
    const plate = PG.aeroPlanPlate(G, m4, list.map(v => [v[0], v[1]]), yMid + thick / 2, thick, 0.0085);
    K.addMesh('aero_skirtR', plate, K.mats.skirt, { reflect: false });
    K.addMesh('aero_skirtL', G.mirrorZ(plate), K.mats.skirt, { reflect: false });
  }

  // ---------------------------------------------------------------------------------------------- rear wheel-arch side blade
  function archBlade(K) {
    const { G } = K;
    // find a strip just ahead of the rear arch where the flank is smooth (the sampled |z| varies little over the blade footprint)
    let xa = -0.80, zmin = 0.9, zmax = 0.9;
    for (let k = 0; k < 6; k++, xa += 0.05) {
      zmin = 9; zmax = -9;
      for (const x of [xa, xa - 0.10]) for (const y of [0.26, 0.36, 0.46, 0.55]) { const z = K.side(x, y); if (z != null) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); } }
      if (zmax < 0) { zmin = zmax = 0.90; break; }
      if (zmax - zmin < 0.03) break;
    }
    const xb = xa - 0.10;
    // slanted black intake pocket that hugs the flank (grid conformed to the skin) with two diagonal vanes standing in it
    const quad = [[xa + 0.030, 0.250], [xb - 0.040, 0.268], [xb - 0.020, 0.560], [xa + 0.028, 0.590]];      // (x, y) corners: front-low, rear-low, rear-high, front-high
    const zs = [];
    for (const [qx, qy] of quad) { const z = K.side(qx, qy); if (z != null) zs.push(z); }
    const zRef = zs.length ? zs.sort((p, q) => p - q)[zs.length >> 1] : 0.9;
    const skin = (x, y) => { const z = K.side(x, y); return z == null || Math.abs(z - zRef) > 0.05 ? zRef : z; };
    const bl = (u, v, a, b, c, d) => [(a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + c[0] * u) * v, (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v];
    const patch = G.grid(18, 22, (u, v) => {
      // rounded-corner mapping: pull the corners of the unit square inwards (squircle) so the pocket outline is soft
      let a = u * 2 - 1, b = v * 2 - 1; const sq = Math.max(Math.abs(a), Math.abs(b)), rho = Math.pow(Math.pow(Math.abs(a), 4) + Math.pow(Math.abs(b), 4), 0.25) || 1;
      a *= sq / rho; b *= sq / rho;
      const p = bl(a * 0.5 + 0.5, b * 0.5 + 0.5, quad[1], quad[0], quad[3], quad[2]);       // x runs forward with u
      return [p[0], p[1], skin(p[0], p[1]) + 0.0045];
    });
    K.addMesh('aero_archBlade_pocket', G.merge([patch, G.mirrorZ(patch)]), K.mats.matte.derive({ name: 'aeroArchPocket', baseColor: [0.010, 0.010, 0.011], doubleSided: true }), { reflect: false });
    // diagonal vanes: thin slanted plates perpendicular to the skin, running from low-rear to high-front
    const vanes = [];
    for (const off of [-0.030, 0.030]) {
      const cx = 0.5 * (xa + xb) + off, cy = 0.42, len = 0.21, th = 0.0065, ang = 22 * DEG;   // ang from vertical, leaning forward at the top
      const poly = G.roundPolygon([[-th / 2, -len / 2], [th / 2, -len / 2], [th / 2, len / 2], [-th / 2, len / 2]], [0.003, 0.003, 0.003, 0.003], 3)
        .map(p => [cx + p[0] * Math.cos(ang) + p[1] * Math.sin(ang), cy - p[0] * Math.sin(ang) + p[1] * Math.cos(ang)]);
      const e = G.extrude(poly, 0.021, { bevel: { size: 0.0012, depth: 0.0012, segments: 2 } });
      vanes.push(G.translate(e, 0, 0, zRef - 0.004));
    }
    const vm = G.merge(vanes);
    K.addMesh('aero_archBlade', G.merge([vm, G.mirrorZ(vm)]), K.mats.weave, { reflect: false });
  }

  // ---------------------------------------------------------------------------------------------- undertray, strakes, diffuser
  const TRAY_HOOK = `
void surfaceHook(inout Surf s, in Frag f) {
  vec3 n = normalize(f.nObj);
  float under = smoothstep(0.2, -0.6, n.y);
  vec2 p = f.pObj.xz; float fw = f.fw;
  // panel seams (x) and centre / outer seams (z) on the underside, plus a fine matte grain
  float sx = abs(fract((p.x + 0.35) / 0.62 + 0.5) - 0.5) * 0.62;      // seam every 0.62 m
  float sz = min(abs(abs(p.y) - 0.34), abs(p.y)) ;
  float line = 1.0 - smoothstep(0.0011 - fw, 0.0011 + fw, min(sx, sz));
  s.baseColor *= 1.0 - 0.55 * line * under;
  s.roughness = clamp(s.roughness + 0.18 * line * under, 0.0, 1.0);
}`;

  function undertray(K) {
    const { G, m4 } = K;
    // measured floor height (median of centre-line body bottom), so the tray hugs the body
    let yb = 0.12; { const vals = []; for (let x = -1.0; x <= 1.6; x += 0.2) { const y = K.bottom(x, 0.0); if (y != null) vals.push(y); } if (vals.length) { vals.sort((a, b) => a - b); yb = vals[vals.length >> 1]; } }
    yb = Math.min(0.14, Math.max(0.098, yb));
    const yTop = yb + 0.003, thick = 0.012;
    // plan outline: front x=2.02 .. rear x=-1.44 ; half-width follows the sill line
    // wheels sit in wells beside the floor: keep the tray inside the tyre inner faces
    const wheelLimit = x => {
      let lim = 9;
      for (const w of [spec.wheel.front, spec.wheel.rear]) {
        const inner = w.track / 2 - w.tireWidth / 2 - 0.022, d = Math.abs(x - w.x), R = w.tireRadius + 0.03;
        if (d < R) lim = Math.min(lim, inner);
        else if (d < R + 0.08) lim = Math.min(lim, inner + (d - R) / 0.08 * 0.12);
      }
      return lim;
    };
    const hw = x => { const zb = K.side(x, 0.14); return Math.min(0.80, wheelLimit(x), (zb == null ? spec.halfWidthAt(x) - 0.10 : zb - 0.045)) * (x > 1.75 ? Math.max(0.6, 1 - (x - 1.75) * 1.1) : 1); };
    const xs = []; for (let x = 2.02; x >= -1.44 - 1e-6; x -= 0.04) xs.push(x);
    const right = xs.map(x => [x, hw(x)]);
    const ring = right.map(p => [p[0], p[1]]).concat(right.slice().reverse().map(p => [p[0], -p[1]]));
    const holes = [];
    // intakes: two rear-brake ducts and the gearbox / rear-axle cooling scoop
    const rr = (cx, cz, w, d, r) => G.shapes.roundRect(w, d, r, 4).map(p => [p[0] + cx, p[1] + cz]);
    for (const s of [1, -1]) holes.push(rr(-0.76, s * 0.55, 0.20, 0.12, 0.02), rr(0.62, s * 0.56, 0.16, 0.10, 0.02));
    holes.push(rr(-1.06, 0.0, 0.22, 0.30, 0.03));
    const tray = PG.aeroPlanPlate(G, m4, G.roundPolygon(ring, 0.035, 4), yTop, thick, 0.0025, holes);
    K.addMesh('aero_undertray', tray, K.mats.matte.derive({ name: 'aeroTray', hook: TRAY_HOOK }), { reflect: false });
    // dark floors behind the intakes + slats
    const floors = [], slats = [];
    for (const h of holes) floors.push(PG.aeroPlanPlate(G, m4, h, yTop - 0.004, 0.003, 0.0004));
    K.addMesh('aero_intakeFloors', G.merge(floors), K.mats.matte.derive({ name: 'aeroIntake', baseColor: [0.004, 0.004, 0.004] }), { reflect: false });
    const bars = [];
    for (const s of [1, -1]) for (let i = -2; i <= 2; i++) { bars.push(G.translate(G.box(0.19, 0.006, 0.0055, { radius: 0.0022, segments: 2 }), -0.76, yTop - 0.010, s * 0.55 + i * 0.024)); }
    for (let i = -3; i <= 3; i++) bars.push(G.translate(G.box(0.20, 0.006, 0.0055, { radius: 0.0022, segments: 2 }), -1.06, yTop - 0.010, i * 0.038));
    K.addMesh('aero_intakeSlats', G.merge(bars), K.mats.satin, { reflect: false });
    // front underbody strakes behind the splitter (thin vertical blades under the tray)
    const strakes = [];
    const yBot = yTop - thick;
    for (const [z, x0, x1] of [[0.10, 1.52, 1.90], [0.26, 1.50, 1.88], [0.42, 1.55, 1.84], [0.58, 1.62, 1.80]]) for (const s of [1, -1]) {
      const poly = G.roundPolygon([[x1, yBot + 0.004], [x1 - 0.02, yBot - 0.020], [x0 + 0.05, yBot - 0.022], [x0, yBot + 0.004]], [0.004, 0.006, 0.006, 0.004], 3);
      let e = G.extrude(poly, 0.0065, { center: true, bevel: { size: 0.0012, depth: 0.0012, segments: 2 } });
      strakes.push(G.translate(e, 0, 0, s * z));
    }
    K.addMesh('aero_frontStrakes', G.merge(strakes), K.mats.satin, { reflect: false });
    return { yb, yTop, yBot };
  }

  // ---- diffuser floor ramp height (top surface) as a function of x, 11.5 deg kick starting at xk with a soft transition
  function makeRamp(yFloorTop) {
    const xk = -1.36, tan = Math.tan(12 * DEG), rk = 0.30;         // kick point, slope, blend length
    return x => {
      if (x >= xk + rk / 2) return yFloorTop;
      const d = xk + rk / 2 - x;                                     // distance behind the blend start
      if (d >= rk) return yFloorTop + tan * (d - rk / 2);            // straight ramp
      return yFloorTop + tan * d * d / (2 * rk);                     // circular-ish blend
    };
  }

  function diffuser(K, floor) {
    const { G } = K;
    let tailX = null; if (K.rc) { const h = K.rc.cast([-3.2, 0.34, 0.0], [1, 0, 0]); if (h) tailX = h.point[0]; }
    const xR = tailX == null ? -2.245 : Math.min(-2.20, Math.max(-2.36, tailX + 0.06));
    const ramp = makeRamp(floor.yTop), thick = 0.016;
    const hw = x => 0.600 + 0.024 * sm(-1.5, -2.245, x);              // plan half-width of the ramp panel (inside the rear tyre inner face 0.631)
    const xs = []; for (let x = -1.40; x >= xR - 1e-6; x -= 0.04) xs.push(x);
    const rings = xs.map(x => {
      const w = hw(x), yt = ramp(x), yb = yt - thick, r = 0.0035, ring = [];
      const c = [[w - r, yt - r, 0], [-w + r, yt - r, Math.PI / 2], [-w + r, yb + r, Math.PI], [w - r, yb + r, 1.5 * Math.PI]];
      for (const [cx, cy, a0] of c) for (let k = 0; k <= 2; k++) { const a = a0 + k * Math.PI / 4; ring.push([x, cy + Math.sin(a) * r, cx + Math.cos(a) * r]); }
      return ring;
    });
    K.addMesh('aero_diffuserFloor', G.loft(rings, { closed: true, caps: true, crease: 50 }), K.mats.diffFloor, { reflect: false });
    // fins & enclosure walls: vertical plates HANGING DOWN from the tunnel roof (ramp underside).  Their lower edge follows a much shallower line than the
    // ramp, so the tunnels open up towards the tail (fin depth grows from ~0.03 m at the kick to ~0.11 m at the trailing edge).
    const fins = [];
    // 3 fins per side + the outer enclosure wall; each has its own maximum depth below the ramp underside (bottoms stay ABOVE the splitter lip height)
    const zs = [0.17, 0.30, 0.43, 0.575], caps = [0.064, 0.074, 0.070, 0.056];
    const yFlat = floor.yTop - thick;                                // flat floor underside (fins start flush with it)
    const x0 = -1.44, N = 24;
    zs.forEach((z, zi) => {
      const top = [], bot = [];
      for (let i = 0; i <= N; i++) {
        const x = x0 + (xR - x0) * i / N, yr = ramp(x) - thick;       // ramp underside
        const t = i / N, depth = caps[zi] * (0.18 + 0.82 * sm(0.0, 0.85, t)) * (i === 0 ? 0 : 1);
        top.push([x, yr + 0.004]);
        bot.push([x, Math.max(yFlat, yr - depth)]);
      }
      const ring = top.concat(bot.slice().reverse());
      const rad = ring.map((p, k) => (k === N ? 0.003 : k === N + 1 ? 0.016 : k === ring.length - 1 ? 0.0 : 0));
      const poly = G.roundPolygon(ring.map(v => [v[0], v[1]]), rad, 3);
      const thk = z > 0.5 ? 0.011 : 0.010;
      for (const s of [1, -1]) fins.push(G.translate(G.extrude(poly, thk, { center: true, bevel: { size: 0.0018, depth: 0.0018, segments: 2 } }), 0, 0, s * z));
    });
    K.addMesh('aero_diffuserFins', G.merge(fins), K.mats.diffFin, { reflect: false });
    // small gurney lip along the diffuser trailing edge
    {
      const yt = ramp(xR), w = hw(xR) - 0.07;
      const g = G.extrude(G.roundPolygon([[xR + 0.004, yt - 0.006], [xR + 0.004, yt + 0.005], [xR + 0.0005, yt + 0.005], [xR + 0.0005, yt - 0.006]], [0.0006, 0.001, 0.001, 0.0006], 2), 2 * w, { center: true, bevel: { size: 0.0007, depth: 0.0007, segments: 1 } });
      K.addMesh('aero_diffuserGurney', g, K.mats.satin, { reflect: false });
    }
    K.ramp = ramp;
    valance(K, xR);
  }

  // black textured lower rear valance: a thin skin conformed to the body's underside/tail curve (radial rays from a point inside the tail) so the
  // diffuser fins grow out of a coherent black bumper insert instead of hanging below a bare painted blob.
  function valance(K, xR) {
    const { G } = K, rc = K.rc; if (!rc) return;
    const Cx = -1.55, Cy = 0.56, R0 = 1.2, P0 = -62 * DEG;
    const skin = (phi, z) => {
      const dx = -Math.cos(phi), dy = Math.sin(phi), h = rc.cast([Cx + dx * R0, Cy + dy * R0, z], [-dx, -dy, 0]);
      return h && h.t > 0.25 && h.t < R0 - 0.2 ? h : null;
    };
    const HW = 0.665;
    let last = null;
    const patch = G.grid(64, 22, (u, v) => {
      let a = u * 2 - 1, b = v * 2 - 1;
      const sq = Math.max(Math.abs(a), Math.abs(b)), rho = Math.pow(Math.pow(Math.abs(a), 6) + Math.pow(Math.abs(b), 6), 1 / 6) || 1;
      a *= sq / rho; b *= sq / rho;                                  // squircle: rounded outline
      const z = a * HW, phiTop = -6 * DEG - 26 * DEG * Math.pow(Math.abs(a), 3.2);
      const phi = P0 + (phiTop - P0) * (b * 0.5 + 0.5);
      const h = skin(phi, z);
      if (!h) return last || [Cx - 0.7, 0.3, z];
      const n = h.normal;
      last = [h.point[0] + n[0] * 0.005, h.point[1] + n[1] * 0.005, h.point[2] + n[2] * 0.005];
      return last;
    });
    K.addMesh('aero_diffuserValance', patch, K.mats.diffValance, { reflect: false });
  }

  PG.aeroUnder = function (K) {
    roofFins(K);
    skirts(K);
    archBlade(K);
    const floor = undertray(K);
    diffuser(K, floor);
  };
})();
