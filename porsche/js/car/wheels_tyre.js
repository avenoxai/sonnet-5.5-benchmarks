'use strict';
// car/wheels_tyre.js - Michelin Pilot Sport Cup 2 R tyre: lathe profile (real circumferential grooves, shoulder, rim protector),
// canvas-generated sidewall lettering atlas (polar unwrapped) and the surface hook (sipes, grain, raised lettering).
(function () {
  const PG = window.PG;
  const P = PG.wheelsParts = PG.wheelsParts || {};

  // tyre description per axle
  P.tyreCfg = function (axle) {
    const w = PG.spec.wheel[axle], rr = w.rimDiameter / 2, rear = axle === 'rear', rc = P.rimCfg(axle);
    const c = {
      axle, w, rr, R: w.tireRadius, hw: rc.hw,
      hwS: rear ? rc.hw + 0.0030 : w.tireWidth / 2,      // rear: belly = protector rib (335 tyre bulge 0.9545 in car space)
      pr: rear ? 0.0030 : 0.0060,                        // rim-protector rib height beyond the flange
      treadFlat: rear ? 0.1385 : 0.1195,      // half width of the flat tread before the shoulder
      shoulderR: 0.024,                        // radial size of the shoulder rounding
      grooves: rear ? [0.043, 0.104] : [0.036, 0.087],
      size: rear ? '335/30 ZR 21 (109Y) XL' : '275/35 ZR 20 (102Y) XL',
      sizeShort: rear ? '335/30 ZR21' : '275/35 ZR20',
    };
    c.S = c.R - rr;
    c.bandIn = rr + 0.034; c.bandOut = c.R - 0.024;
    return c;
  };

  function crHalf(c) {
    // outer profile z >= 0 from the bead up to the tread centre: array of [r, z]
    const { rr, R, hw, hwS, S } = c, pts = [];
    const push = (r, z) => pts.push([r, z]);
    // bead (hidden inside the rim well) and rim protector (k scales the rib for the rear where the tyre is no wider than the rib)
    const k = c.pr / 0.006;
    push(rr + 0.0035, hw - 0.012);
    push(rr + 0.0060, hw - 0.004);
    push(rr + 0.0125, hw + 0.0012 * k);
    push(rr + 0.0170, hw + 0.0040 * k);
    push(rr + 0.0205, hw + 0.0058 * k);
    push(rr + 0.0245, hw + 0.0060 * k);
    push(rr + 0.0275, hw + 0.0042 * k);
    push(rr + 0.0305, hw + 0.0044 * k);
    // sidewall: monotone table of z(r) (Catmull-Rom sampled)
    const hB = 0.63, rearW = c.axle === 'rear';
    const zA = rearW ? hw + c.pr - 0.0006 : hw + 0.0066, zB = rearW ? hwS - 0.0010 : hw + 0.0090 + (hwS - hw) * 0.35;
    const key = [[0.0335 / S, zA], [0.20, zB], [0.33, hwS - 0.0028 * (rearW ? 0.25 : 1)], [0.47, hwS - 0.0004], [hB, hwS], [0.74, hwS - 0.0010]];
    // convert key h -> r
    const K = key.map(k => [rr + k[0] * S, k[1]]);
    const rEnd = R - c.shoulderR;
    K.push([rEnd, hwS - 0.0016]);
    const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    for (let i = 0; i < K.length - 1; i++) {
      const a = K[Math.max(0, i - 1)], b = K[i], d = K[i + 1], e = K[Math.min(K.length - 1, i + 2)];
      const n = 4;
      for (let s = 0; s < n; s++) { const t = s / n; push(cr(a[0], b[0], d[0], e[0], t), cr(a[1], b[1], d[1], e[1], t)); }
    }
    const zSide = hwS - 0.0016;
    // shoulder: quarter ellipse from (rEnd, zSide) to (R, treadFlat)
    const az = zSide - c.treadFlat, ar = c.shoulderR;
    const NS = 9;
    for (let i = 0; i <= NS; i++) {
      const ph = i / NS * Math.PI / 2;   // 0 = side point, pi/2 = tread end
      push(rEnd + ar * Math.sin(ph), c.treadFlat + az * Math.cos(ph));
    }
    // crown radius helper, tread with grooves
    const crown = z => R - 0.0028 * Math.pow(Math.min(1, z / c.treadFlat), 2.5);
    // replace the last ellipse point (r = R at treadFlat) by the crown radius
    pts[pts.length - 1][0] = crown(c.treadFlat);
    // tread from treadFlat toward the centre, cutting grooves
    const g = c.grooves.slice().sort((a, b) => b - a);   // outer groove first
    const wt = 0.0028, wb = 0.0017, dep = 0.0042;
    let zc = c.treadFlat;
    for (const gz of g) {
      const zt0 = gz + wt, zb0 = gz + wb, zb1 = gz - wb, zt1 = gz - wt;
      const seg = (za, zb) => { const n = Math.max(1, Math.round((za - zb) / 0.012)); for (let i = 1; i < n; i++) { const z = za + (zb - za) * i / n; push(crown(z), z); } };
      seg(zc, zt0);
      push(crown(zt0), zt0); push(crown(zb0) - dep * 0.5, zb0 + 0.0004); push(crown(zb0) - dep, zb0); push(crown(zb1) - dep, zb1); push(crown(zb1) - dep * 0.5, zb1 - 0.0004); push(crown(zt1), zt1);
      zc = zt1;
    }
    // centre
    { const n = Math.max(1, Math.round(zc / 0.012)); for (let i = 1; i < n; i++) { const z = zc * (1 - i / n); push(crown(z), z); } push(crown(0), 0); }
    return pts;
  }

  P.buildTyre = function (ctx, axle) {
    const G = PG.geo, c = P.tyreCfg(axle), H = crHalf(c);
    const prof = [];
    for (let i = 0; i < H.length; i++) prof.push([H[i][0], -H[i][1]]);          // -z side: bead -> centre (last point z = -0 duplicate handled below)
    for (let i = H.length - 2; i >= 0; i--) prof.push([H[i][0], H[i][1]]);      // +z side: centre -> bead
    // inner surface (hidden by the rim) closes the loop
    const zin = c.hw - 0.012;
    prof.push([c.rr + 0.0005, zin]); prof.push([c.rr + 0.0005, -zin]); prof.push(prof[0].slice());
    const seg = Math.round(200 / Math.max(0.75, Math.min(1.5, ctx.quality)));
    const mesh = G.lathe(prof, seg, { axis: 'z', crease: 34 });
    mesh.cfg = c;
    return mesh;
  };

  // ------------------------------------------------------------------------------- sidewall atlas (polar unwrapped)
  // width = full circumference at the band centre, height = band (bandOut at the top row .. bandIn at the bottom row).
  P.tyreAtlas = function (axle) {
    const c = P.tyreCfg(axle), W = 4096, H = 112;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const rMid = (c.bandIn + c.bandOut) / 2, circMM = 2 * Math.PI * rMid * 1000, bandMM = (c.bandOut - c.bandIn) * 1000;
    const sx = W / circMM, sy = H / bandMM;     // px per mm
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    g.setTransform(sx, 0, 0, sy, 0, 0);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    const xAt = deg => (0.5 - deg / 360) * circMM;     // mm along u for a wheel angle (deg, CCW from +X seen from outside)
    const FONT_B = '"Arial Black","Helvetica Neue","Arial",sans-serif', FONT = '"Helvetica Neue","Arial",sans-serif';
    const text = (str, x, y, size, weight, spacing, font, stretch) => {
      g.save(); g.font = (weight || 'bold') + ' ' + size + 'px ' + (font || FONT);
      if ('letterSpacing' in g) g.letterSpacing = (spacing || 0) + 'px';
      g.translate(x, y); if (stretch) g.scale(stretch, 1); g.fillText(str, 0, 0); g.restore();
    };
    // --- group A: MICHELIN (big) + PILOT SPORT CUP 2 R
    const A = 30;
    text('MICHELIN', xAt(A), 15.2, 15.5, '900', 1.2, FONT_B, 1.02);
    text('PILOT SPORT CUP 2 R', xAt(A), 28.6, 8.6, 'bold italic', 0.5, FONT, 1.0);
    // small sub-line and hairline rule
    g.fillRect(xAt(A) - 52, 31.2, 104, 0.45);
    text('MADE IN GERMANY', xAt(A), 36.0, 3.2, 'bold', 0.6, FONT);
    // --- group C: repeat on the other side of the wheel (smaller MICHELIN + PILOT SPORT CUP 2 R)
    const Cc = -108;
    text('MICHELIN', xAt(Cc), 13.5, 12.5, '900', 1.0, FONT_B, 1.0);
    text('PILOT SPORT CUP 2 R', xAt(Cc), 25.2, 7.4, 'bold italic', 0.4, FONT, 1.0);
    // --- group B: size, load/speed index, Porsche N mark, DOT
    const B = 142;
    text(c.size, xAt(B), 12.5, 9.2, 'bold', 0.8, FONT);
    text('TUBELESS   RADIAL   XL', xAt(B) - 30, 21.5, 4.6, 'bold', 0.7, FONT);
    text('MAX LOAD 1REM 1REM  KG', xAt(B) - 30, 27.0, 3.4, 'bold', 0.5, FONT);
    text('DOT  4XXX  MI 24', xAt(B) + 40, 34.5, 3.6, 'bold', 0.7, FONT);
    // Porsche N-rating star mark (star with N inside), left of the size
    { const cx = xAt(B) + 74, cy = 22.5, R0 = 8.6, R1 = 3.9;
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R1 : R0; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath(); g.lineWidth = 0.9; g.stroke();
      text('N', cx - 0.4, cy + 3.0, 6.4, '900', 0, FONT_B);
      text('0', cx + 3.5, cy + 4.6, 3.6, 'bold', 0, FONT);
    }
    // --- tread wear indicator arrows (triangles) at a few angles
    for (const a0 of [-20, 68, 172, 250]) {
      const x = xAt(a0);
      g.beginPath(); g.moveTo(x, 4.0); g.lineTo(x - 3.2, 12.0); g.lineTo(x + 3.2, 12.0); g.closePath(); g.fill();
      text('TWI', x, 19.0, 4.0, 'bold', 0.4, FONT);
    }
    return { canvas: cv, W, H };
  };

  // ------------------------------------------------------------------------------- hook
  P.tyreHook = `
uniform sampler2D uAtlas;
uniform vec4 uT;      // R, rr, treadFlat, bandIn
uniform vec4 uT2;     // bandOut, atlasW, atlasH, 0
uniform float uBlur;  // 0..1 wheel-speed blur (fades the fine detail)
float t_sipe(vec3 p, float th) {
  // fine diagonal lateral cuts on the shoulders only (semi-slick centre)
  float N = 150.0;
  float sPos = th * (N / 6.2831853) + abs(p.z) * 9.0;
  float id = floor(sPos);
  float fr = fract(sPos);
  float line = smoothstep(0.42, 0.5, abs(fr - 0.5));
  float zone = smoothstep(uT.z - 0.062, uT.z - 0.038, abs(p.z));
  float on = step(0.15, pg_hash12(vec2(id, 5.0 + floor(abs(p.z) * 45.0))));
  return line * zone * (0.55 + 0.45 * on);
}
void surfaceHook(inout Surf s, in Frag f) {
  vec3 p = f.pObj;
  vec3 n = s.normal;
  float rho = length(p.xy);
  float th = atan(p.y, p.x);
  vec2 eR = p.xy / max(rho, 1e-4);
  vec2 eT = vec2(eR.y, -eR.x);
  float R = uT.x;
  float fade = 1.0 - clamp(uBlur, 0.0, 1.0);
  float aa = (1.0 - smoothstep(0.0012, 0.006, f.fw)) * fade;
  // ---------------- tread area
  float onTread = smoothstep(0.62, 0.30, abs(n.z)) * smoothstep(R - 0.032, R - 0.012, rho);
  if (onTread > 0.0) {
    float sp = t_sipe(p, th);
    float grain = pg_vnoise(vec2(th * 900.0, p.z * 1400.0)) * 0.6 + pg_vnoise(vec2(th * 2300.0 + 7.0, p.z * 3100.0)) * 0.4;
    // lateral sipe cuts: normal tilts into the cut, darker + rougher
    float sl = sp * aa * onTread;
    float sgn = sign(fract(th * (150.0 / 6.2831853) + abs(p.z) * 9.0) - 0.5);
    vec3 gN = vec3(eT * sgn * sl * 0.55, 0.0);
    s.normal = normalize(s.normal + gN + vec3(eT * (grain - 0.5) * 0.10 * aa * onTread, (grain - 0.5) * 0.05 * aa * onTread));
    s.baseColor *= 1.0 - 0.45 * sl;
    s.roughness = mix(s.roughness, 0.92, sl * 0.6);
    // semi-slick sheen band: contact area a little shinier, worn look toward the centre
    float wear = smoothstep(0.12, 0.0, abs(p.z)) * 0.5 + 0.5;
    s.roughness = mix(s.roughness, 0.70 + 0.16 * grain, onTread * 0.6);
    s.baseColor *= mix(1.0, 0.85 + 0.30 * grain, onTread);
    s.specular = mix(s.specular, 0.30, onTread);
  }
  // ---------------- sidewall
  float side = smoothstep(0.55, 0.85, abs(n.z));
  if (side > 0.0) {
    // faint sheen and moulded fine ribs
    s.roughness = mix(s.roughness, 0.52, side * 0.55);
    float rib = sin(rho * 4200.0) * 0.5 + 0.5;
    float band = smoothstep(uT.y + 0.030, uT.y + 0.034, rho) * (1.0 - smoothstep(R - 0.024, R - 0.020, rho));
    s.normal = normalize(s.normal + vec3(eR * (rib - 0.5) * 0.05 * (1.0 - band) * aa * side * step(0.0, p.z), 0.0));
    float ang = fract(0.5 - th / 6.2831853);
    float v = (uT2.x - rho) / (uT2.x - uT.w);
    vec2 uv = vec2(ang, clamp(v, 0.001, 0.999));
    vec2 dt = vec2(1.0 / uT2.y, 1.0 / uT2.z) * 1.5;
    float a  = texture(uAtlas, uv).a;
    float au = texture(uAtlas, uv + vec2(dt.x, 0.0)).a - texture(uAtlas, uv - vec2(dt.x, 0.0)).a;
    float av = texture(uAtlas, uv + vec2(0.0, dt.y)).a - texture(uAtlas, uv - vec2(0.0, dt.y)).a;
    float inb = step(0.0, p.z) * step(0.0, v) * step(v, 1.0);
    // gradient directions: +u = clockwise tangent, +v = towards the rim centre (-eR)
    vec3 gL = vec3(eT * (-au) * 0.9 + eR * (av) * 0.9, 0.0);
    s.normal = normalize(s.normal + gL * side * fade * inb);
    float m = a * side * inb * (0.30 + 0.70 * fade);
    vec3 txt = vec3(0.50, 0.50, 0.48) * (0.85 + 0.25 * pg_vnoise(p.xy * 400.0));
    s.baseColor = mix(s.baseColor, txt, m);
    s.roughness = mix(s.roughness, 0.60, m);
    s.specular = mix(s.specular, 0.5, m);
  }
}
`;
})();
