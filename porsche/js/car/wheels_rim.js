'use strict';
// car/wheels_rim.js - forged centre-lock 10-spoke rim (SDF mesh), centre-lock nut, valve stem + balance weights.
// Local wheel space: origin = wheel centre, +Z = outboard, axis = Z, +X forward, +Y up (right-wheel orientation).
(function () {
  const PG = window.PG;
  const P = PG.wheelsParts = PG.wheelsParts || {};
  const f6 = x => (+x).toFixed(6);

  // ---- geometry constants of one rim (derived from PG.spec.wheel[axle])
  P.rimCfg = function (axle) {
    const w = PG.spec.wheel[axle];
    const rr = w.rimDiameter / 2, hw = w.rimWidth / 2 - (axle === 'rear' ? 0.0045 : 0), hubF = w.hubFaceZ - w.track / 2;
    const c = {
      axle, w, rr, hw, hubF,
      R: w.tireRadius,
      fh: 0.0175, fw: 0.0080, bs: 0.014, ramp: 0.024, dd: 0.029, t: 0.0062,   // barrel: flange height/thickness, bead seat length, ramp length, drop depth, wall
      nSpokes: 10, phase: Math.PI / 2,
    };
    c.zf = hw - c.fw; c.zs = c.zf - c.bs; c.zw = c.zs - c.ramp; c.rF = rr + c.fh; c.rW = rr - c.dd;
    // spoke design (front face z at hub / rim, thickness, taper)
    const rear = axle === 'rear';
    c.spoke = {
      x0: 0.030, x1: rr - 0.005,
      zfHub: hubF + (rear ? 0.030 : 0.034), zfRim: hw - (rear ? 0.013 : 0.012),
      thHub: rear ? 0.032 : 0.034, thRim: rear ? 0.030 : 0.030,
      hwHub: 0.0125, hwRim: rear ? 0.0275 : 0.0270,
      expo: rear ? 1.55 : 1.45,
    };
    c.hubBossR = 0.090; c.nutR = 0.050;
    c.zNutBase = c.spoke.zfHub - 0.005;
    return c;
  };

  // barrel wall cross-section polygon in (z, rho)
  function barrelPoly(c) {
    const { hw, zf, zs, zw, rF, rr, rW, t } = c;
    return [[hw, rF], [hw, rr - t], [zs, rr - t], [zw, rW - t], [-zw, rW - t], [-zs, rr - t], [-hw, rr - t], [-hw, rF],
      [-zf, rF], [-zf, rr], [-zs, rr], [-zw, rW], [zw, rW], [zs, rr], [zf, rr], [zf, rF]];
  }
  // outer (tyre side) radius of the barrel at |z| (used to strip the hidden surface)
  P.rimOuterR = function (c, z) {
    z = Math.abs(z);
    if (z <= c.zw) return c.rW;
    if (z <= c.zs) return c.rW + (c.rr - c.rW) * (z - c.zw) / (c.zs - c.zw);
    return c.rr;
  };
  P.rimInnerR = function (c, z) { return P.rimOuterR(c, z) - c.t; };


  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---- spoke (explicit loft). Spoke lies along +X, front face towards +Z.
  function spokeMesh(c) {
    const G = PG.geo, S = c.spoke, N = 56, rings = [], attrs = [];
    const pa = 0.088, pb = 0.222, ramp = 0.014, D = 0.0058, DB = 0.0130, e = 0.0078, eb = 0.0090, rc = 0.0038;
    const NC = 4;
    let count = 0;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), x = S.x0 + t * (S.x1 - S.x0);
      const te = Math.pow(t, S.expo);
      const flare = smooth(S.x1 - 0.030, S.x1 - 0.004, x);
      const w = S.hwHub + (S.hwRim - S.hwHub) * Math.pow(t, 1.05) + 0.0055 * flare * flare;
      const zf = S.zfHub + (S.zfRim - S.zfHub) * te + 0.0050 * flare * flare;
      const th = S.thHub + (S.thRim - S.thHub) * t;
      const zb = zf - th - 0.0030 * flare;
      const dp = D * smooth(pa, pa + ramp, x) * (1 - smooth(pb - ramp, pb, x));
      const dpb = DB * smooth(pa - 0.004, pa + ramp, x) * (1 - smooth(pb - 0.004 - ramp, pb - 0.004, x));
      const sw = 0.010 * t * t;                       // tangential sweep
      const ring = [], ra = [];
      const P = (s, z, ao) => { ring.push([x, s + sw, z]); ra.push(ao); };
      const arc = (cs, cz, a0, a1, ao) => { for (let k = 0; k <= NC; k++) { const a = a0 + (a1 - a0) * k / NC; P(cs + Math.cos(a) * rc, cz + Math.sin(a) * rc, ao); } };
      const endAO = 1 - 0.22 * (1 - smooth(S.x0, S.x0 + 0.05, x)) - 0.28 * smooth(S.x1 - 0.028, S.x1 - 0.002, x);
      const aoF = endAO * (1 - 0.30 * (dp / D)), aoB = endAO * (1 - 0.30 * (dpb / DB));
      // front, left -> right (s increases). start at left side going up
      // left top corner: from (-w, zf-rc) up around to (-w+rc, zf)
      arc(-w + rc, zf - rc, Math.PI, Math.PI / 2, endAO);
      P(-(w - e), zf, endAO);
      P(-(w - e) + dp * 0.55, zf - dp, aoF);
      P((w - e) - dp * 0.55, zf - dp, aoF);
      P((w - e), zf, endAO);
      arc(w - rc, zf - rc, Math.PI / 2, 0, endAO);
      // right side down, back face right -> left
      arc(w - rc, zb + rc, 0, -Math.PI / 2, endAO);
      P((w - eb), zb, endAO);
      P((w - eb) - dpb * 0.55, zb + dpb, aoB);
      P(-(w - eb) + dpb * 0.55, zb + dpb, aoB);
      P(-(w - eb), zb, endAO);
      arc(-w + rc, zb + rc, -Math.PI / 2, -Math.PI, endAO);
      rings.push(ring); attrs.push(ra); count = ring.length;
    }
    // orientation: rings run front (+z) left->right then back; fix with loft's auto orient
    const m = G.loft(rings, { closed: true, caps: true, crease: 38 });
    // ao attrs: loft output ordering = rows*cols(+1 closing col) then caps; assign by nearest lookup instead of index math
    const cols = count + 1, nvLoft = N * cols;
    const at = new Float32Array(m.positions.length / 3 * 4);
    for (let v = 0; v < at.length / 4; v++) { at[v * 4] = 1; }
    for (let r = 0; r < N; r++) for (let cc = 0; cc < cols; cc++) at[(r * cols + cc) * 4] = attrs[r][cc % count];
    m.attrs = at;
    return m;
  }

  // barrel wall + hub boss as lathes
  function barrelMesh(c) {
    const G = PG.geo, { hw, zf, zs, zw, rF, rr, rW, t } = c;
    const full = [[hw, rF], [hw, rr - t], [zs, rr - t], [zw, rW - t], [-zw, rW - t], [-zs, rr - t], [-hw, rr - t], [-hw, rF],
      [-zf, rF], [-zf, rr], [-zs, rr], [-zw, rW], [zw, rW], [zs, rr], [zf, rr], [zf, rF]];
    const sign = G.polygonArea(full.map(p => [p[1], p[0]])) < 0;      // in (rho, z): CCW needed for outward normals
    // only the visible surfaces (the tyre-side wall is completely covered by the tyre): open polyline 14,15,0..9
    const idx = [14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const R = [0, 0.0022, 0.0022, 0.0016, 0.0035, 0.0035, 0.0035, 0.0035, 0.0016, 0.0022, 0.0012, 0];
    let q = G.roundPolygon(idx.map(i => [full[i][1], full[i][0]]), R, 3);
    // roundPolygon closes the loop; the last point equals the polyline end (radius 0) -> keep as open path
    if (sign) q = q.reverse();
    return G.lathe(q, 168, { axis: 'z', crease: 38 });
  }
  function hubMesh(c) {
    const G = PG.geo, S = c.spoke, br = c.hubBossR, nr = c.nutR + 0.012;
    const pts = [[c.hubF - 0.004, 0], [c.hubF - 0.004, br], [c.hubF + 0.008, br], [S.zfHub + 0.006, br - 0.020], [S.zfHub + 0.006, nr], [S.zfHub - 0.006, nr], [S.zfHub - 0.006, 0]];
    const R = [0, 0.0015, 0.004, 0.004, 0.0015, 0.0015, 0];
    let q = G.roundPolygon(pts.map(p => [p[1], p[0]]), R, 4);
    if (G.polygonArea(q) < 0) q = q.reverse();
    return G.lathe(q, 96, { axis: 'z', crease: 38 });
  }

  P.buildRim = async function (ctx, axle) {
    const G = PG.geo, c = P.rimCfg(axle), m4 = PG.m4;
    const sp = spokeMesh(c), list = [], tr = [];
    for (let i = 0; i < c.nSpokes; i++) { list.push(sp); tr.push(m4.rotationZ(c.phase + i * Math.PI * 2 / c.nSpokes)); }
    const spokes = G.merge(list, tr);
    const bar = barrelMesh(c), hub = hubMesh(c);
    for (const m of [bar, hub]) { m.attrs = new Float32Array(m.positions.length / 3 * 4); for (let i = 0; i < m.attrs.length; i += 4) m.attrs[i] = 1; }
    const out = G.merge([spokes, bar, hub]);
    out.cfg = c; out.stats = { spokeTris: G.triangleCount(spokes), barrelTris: G.triangleCount(bar), hubTris: G.triangleCount(hub), tris: G.triangleCount(out) };
    return out;
  };

  // hook for the rim material: turned / brushed machining pattern
  P.rimHook = `
void surfaceHook(inout Surf s, in Frag f) {
  vec3 p = f.pObj;
  float rho = length(p.xy);
  vec3 n = s.normal;
  vec2 rd = p.xy / max(rho, 1e-4);
  vec2 eT = vec2(-rd.y, rd.x);
  float axial = smoothstep(0.35, 0.9, abs(n.z));
  float th = atan(p.y, p.x);
  // fine isotropic satin micro-grain + very subtle radial brushing (both fade out with the pixel footprint: no moire, no mottling)
  float aa = 1.0 - smoothstep(0.00025, 0.0011, f.fw);
  float g1 = pg_vnoise(p.xy * 2600.0 + p.z * 2100.0);
  float g2 = pg_vnoise(vec2(th * rho * 3800.0, rho * 180.0));
  s.normal = normalize(n + vec3(rd * (g2 - 0.5) * 0.010 * axial * aa, 0.0) + vec3(eT * (g1 - 0.5) * 0.020 * aa, (g1 - 0.5) * 0.012 * aa));
  s.roughness = clamp(s.roughness + (g1 - 0.5) * 0.05 * aa, 0.05, 1.0);
  // the inside of the barrel (normals pointing at the axis) is seen through the windows: dark, rougher, occluded (otherwise it mirrors the studio ceiling)
  float inward = smoothstep(0.10, 0.65, -dot(n.xy, rd));
  float deep = 1.0 - 0.4 * smoothstep(0.10, 0.26, rho);
  s.baseColor *= (1.0 - 0.58 * inward) * (0.88 + 0.12 * smoothstep(0.09, 0.24, rho)) * (1.0 - 0.10 * (1.0 - axial) * 0.0);
  s.roughness = mix(s.roughness, 0.62, inward * 0.85);
  s.specular = mix(s.specular, 0.35, inward);
  s.clearcoat = mix(s.clearcoat, 0.0, inward);
}
`;

  // ---- centre-lock nut (black satin, silver RS badge) in wheel-local space: lathe
  P.buildNut = async function (ctx, axle) {
    const G = PG.geo, c = P.rimCfg(axle), z0 = c.zNutBase, R = c.nutR;
    const dome = (r) => 0.0255 - 0.0060 * (r / 0.036) * (r / 0.036);
    const prof = [[0, z0 + 0.0002], [R - 0.004, z0 + 0.0002], [R, z0 + 0.0022], [R, z0 + 0.0075], [R - 0.0008, z0 + 0.0085], [R, z0 + 0.0095], [R, z0 + 0.0195],
      [R - 0.0030, z0 + 0.0232], [R - 0.0095, z0 + 0.0245], [0.0345, z0 + 0.0246], [0.0340, z0 + 0.0236], [0.0200, z0 + 0.0240], [0, z0 + 0.0243]];
    const m = G.lathe(prof, 128, { axis: 'z', crease: 40 });
    m.attrs = new Float32Array(m.positions.length / 3 * 4); for (let i = 0; i < m.attrs.length; i += 4) m.attrs[i] = 1;
    m.cfg = c; return m;
  };
  // canvas texture of the RS badge (256 px square, alpha = badge)
  P.rsBadgeCanvas = function () {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(128, 132); g.transform(1, 0, -0.16, 1, 0, 0);
    g.font = '900 150px "Arial Black","Helvetica Neue",Impact,Arial,sans-serif';
    g.fillText('RS', 0, 0);
    g.restore();
    // thin underline stripe
    g.fillRect(56, 196, 148, 7);
    return cv;
  };

  P.nutHook = `
uniform sampler2D uBadge;
void surfaceHook(inout Surf s, in Frag f) {
  vec3 p = f.pObj;
  float rho = length(p.xy);
  float top = smoothstep(0.55, 0.9, s.normal.z);
  vec2 uv = p.xy / 0.070 + 0.5;
  uv.y = 1.0 - uv.y;
  float m = 0.0;
  if (rho < 0.0345 && top > 0.5) m = texture(uBadge, uv).a * smoothstep(0.0345, 0.032, rho);
  vec3 silver = vec3(0.80, 0.81, 0.83);
  s.baseColor = mix(s.baseColor, silver, m);
  s.metallic = mix(s.metallic, 1.0, m);
  s.roughness = mix(s.roughness, 0.22, m);
  s.clearcoat = mix(s.clearcoat, 0.0, m);
  // fine radial knurl on the flutes
  float a = atan(p.y, p.x);
  float k = sin(a * 90.0) * 0.5 + 0.5;
  s.roughness += (1.0 - top) * (k - 0.5) * 0.10;
}
`;

  // ---- valve stem + balance weights (small hardware mesh, hook picks colour by attr.y)
  P.buildRimHardware = function (ctx, axle) {
    const g = PG.geo, c = P.rimCfg(axle), meshes = [];
    const setId = (m, id) => { m.attrs = new Float32Array(m.positions.length / 3 * 4); for (let i = 0; i < m.attrs.length; i += 4) { m.attrs[i] = 1; m.attrs[i + 1] = id; } return m; };
    // valve stem: on the well, midway between two spokes (angle = phase + 18 deg), pointing inwards, leaning outboard
    const va = c.phase + Math.PI / c.nSpokes * 1.0, zv = c.zw - 0.020, rv = c.rW - c.t;
    const stem = [];
    { const m4 = PG.m4;
      let a = g.cylinder(0.0042, 0.0050, 0.026, 14, 1, { axis: 'y' });   // along Y
      a = g.translate(a, 0, -0.013, 0); setId(a, 0); stem.push(a);
      let cap = g.cylinder(0.0034, 0.0034, 0.012, 14, 1, { axis: 'y' }); cap = g.translate(cap, 0, -0.031, 0); setId(cap, 1); stem.push(cap);
      let base = g.cylinder(0.0085, 0.0085, 0.004, 16, 1, { axis: 'y' }); base = g.translate(base, 0, -0.001, 0); setId(base, 2); stem.push(base);
      let st = g.merge(stem);
      // Y axis -> pointing towards the axis (radially inward at angle va), tilted slightly outboard
      st = g.transform(st, m4.chain(m4.translation(Math.cos(va) * rv, Math.sin(va) * rv, zv), m4.rotationZ(va - Math.PI / 2), m4.rotationX(-0.10)));
      meshes.push(st);
    }
    // balance weight strips (grey adhesive), 3 of them on the inside of the well
    for (let i = 0; i < 3; i++) {
      const ang = c.phase + (i * 2.09 + 0.45);
      let b = g.box(0.030, 0.0028, 0.0075, { radius: 0.0008, segments: 1 });   // long along X, thin along Y, width along Z
      setId(b, 3);
      const zc = c.zw - 0.02 - (i === 1 ? 0.03 : 0) - (i === 2 ? 0.008 : 0);
      b = g.transform(b, PG.m4.chain(PG.m4.rotationZ(ang), PG.m4.translation(rv - 0.0014, 0, zc)));
      // after translation along +x then rotate about Z: chain order (a,b) = a*b -> rotate applied last
      meshes.push(b);
    }
    return g.merge(meshes);
  };
  P.hwHook = `
void surfaceHook(inout Surf s, in Frag f) {
  float id = f.attr.y;
  if (id < 0.5) { s.baseColor = vec3(0.012); s.roughness = 0.55; s.metallic = 0.0; }
  else if (id < 1.5) { s.baseColor = vec3(0.60, 0.61, 0.63); s.metallic = 1.0; s.roughness = 0.3; }
  else if (id < 2.5) { s.baseColor = vec3(0.35, 0.36, 0.37); s.metallic = 1.0; s.roughness = 0.4; }
  else { s.baseColor = vec3(0.27, 0.27, 0.28); s.metallic = 0.85; s.roughness = 0.5; }
}
`;
})();
