'use strict';
// car/body_lights.js — body feature "lights" (order 60): headlight pods (shallow carve + shaded bezel / lens / projector / 4-point DRL / matrix strip /
// amber indicator) and the full-width LED tail-light bar (analytic mask in (z, y) on the tail face).
// Contract (see js/car/body.js header): common (GLSL shared helpers, identifiers prefixed "lights"), sdf (float feat_lights(vec3 p, float d), p.z mirrored >= 0,
// change d only locally), shade (void shade_lights(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw)).
(function () {
  const A = PG.spec.anchors, H = A.headlight, T = A.taillightBar;
  const f4 = v => v.toFixed(4);

  // pod frame: the lamp sits on the fender's front slope, so coordinates are taken in the tangent plane of a fixed surface normal
  // w = (0.451, 0.892, 0): u = z (lateral), v = along the slope (forward-down), h = height along the normal (0 = surface at the anchor)
  const common = `
const float lightsHx = ${f4(H.x)}, lightsHy = ${f4(H.y)}, lightsHz = ${f4(H.z)};
vec3 lightsQ(vec3 p) {
  vec3 d = p - vec3(lightsHx, lightsHy, lightsHz);
  return vec3(d.z, d.x * 0.8924 - d.y * 0.4512, d.x * 0.4512 + d.y * 0.8924);
}
float lightsPod(vec2 q) { return bd_rb2(q, vec2(0.130, 0.085), 0.048); }
`;

  const sdf = `
float feat_lights(vec3 p, float d) {
  if (abs(p.x - lightsHx) > 0.25 || abs(p.z - lightsHz) > 0.25 || abs(p.y - lightsHy) > 0.30) return d;
  vec3 q = lightsQ(p);
  float pd = max(lightsPod(q.xy), abs(q.z - 0.008) - 0.22);      // pod prism along the surface normal, kept off the underside
  return d + 0.012 * bd_sstep(0.0, -0.012, pd);                  // 12 mm recess with a 12 mm chamfered wall (resolves at 8 mm voxels)
}
`;

  const shade = `
void lightsHead(inout Surf s, vec3 p, vec3 n, float fw) {
  if (abs(p.x - lightsHx) > 0.25 || abs(p.z - lightsHz) > 0.25 || abs(p.y - lightsHy) > 0.30) return;
  vec3 q3 = lightsQ(p);
  if (abs(q3.z - 0.008) > 0.22 || dot(n, vec3(0.4512, 0.8924, 0.0)) < 0.10) return;
  vec2 q = q3.xy;
  float pd = lightsPod(q);
  float mPod = bd_aa(pd, fw);
  if (mPod < 0.002) return;
  float hl = uHeadlights;
  // bezel ring (satin black plastic)
  vec3 bc = vec3(0.006, 0.006, 0.007); float me = 0.0, ro = 0.42, cc = 0.15; vec3 em = vec3(0.0);
  // clear lens over the module: very dark glossy, a touch of blue-black metal
  float mLens = bd_aa(pd + 0.011, fw);
  bc = mix(bc, vec3(0.004, 0.006, 0.012), mLens); me = mix(me, 0.35, mLens); ro = mix(ro, 0.06, mLens); cc = mix(cc, 1.0, mLens);
  // projector / matrix module behind the lens
  float mMod = bd_aa(bd_rb2(q, vec2(0.118, 0.073), 0.040), fw);
  bc = mix(bc, vec3(0.010, 0.011, 0.015), mMod); me = mix(me, 0.55, mMod); ro = mix(ro, 0.22, mMod);
  // main projector: brushed ring + dark blue inner lens with a faint glow
  vec2 c1 = vec2(0.038, 0.0);
  float r1 = length(q - c1);
  float mRing = bd_aa(abs(r1 - 0.029) - 0.0035, fw);
  bc = mix(bc, vec3(0.16, 0.16, 0.17), mRing); me = mix(me, 0.9, mRing); ro = mix(ro, 0.25, mRing);
  float mIn = bd_aa(r1 - 0.024, fw);
  bc = mix(bc, vec3(0.002, 0.004, 0.010), mIn); me = mix(me, 0.2, mIn); ro = mix(ro, 0.08, mIn);
  em += vec3(0.55, 0.75, 1.0) * (1.6 * hl) * mIn * (0.3 + 0.7 * (1.0 - smoothstep(0.0, 0.024, r1)));
  // matrix LED strip (segmented) along the upper edge of the module
  float dS = bd_seg(q, vec2(-0.092, -0.056), vec2(0.092, -0.056)) - 0.0035;
  float mS = bd_aa(dS, fw);
  float cell = abs(fract(q.x / 0.0125) - 0.5);
  float segPat = mix(0.75, 0.45 + 0.55 * (1.0 - smoothstep(0.30, 0.46, cell)), 1.0 - smoothstep(0.002, 0.005, fw));
  bc = mix(bc, vec3(0.75, 0.80, 0.9), mS); ro = mix(ro, 0.2, mS);
  em += vec3(0.85, 0.92, 1.0) * (4.5 * hl) * mS * segPat;
  // FOUR-POINT daytime running light: four dots in a rounded square (folded distance to the nearest dot)
  vec2 c2 = vec2(-0.068, 0.0);
  float dd = length(abs(q - c2) - vec2(0.022));
  float mDot = bd_aa(dd - 0.0075, fw);
  bc = mix(bc, vec3(0.65), mDot); me = mix(me, 0.0, mDot); ro = mix(ro, 0.2, mDot);
  em += vec3(1.0, 0.97, 0.90) * (5.5 * hl) * mDot;
  em += vec3(1.0, 0.95, 0.85) * (0.5 * hl) * (1.0 - smoothstep(0.0075, 0.02, dd)) * mMod * (1.0 - mDot);
  // tiny amber indicator strip (dim in the off state)
  float dA = bd_seg(q, vec2(0.020, 0.055), vec2(0.092, 0.055)) - 0.0028;
  float mA = bd_aa(dA, fw);
  bc = mix(bc, vec3(0.55, 0.20, 0.0), mA); ro = mix(ro, 0.25, mA);
  em += vec3(1.0, 0.42, 0.02) * 0.9 * mA;
  // write back
  s.baseColor = mix(s.baseColor, bc, mPod); s.metallic = mix(s.metallic, me, mPod); s.roughness = mix(s.roughness, ro, mPod);
  s.clearcoat = mix(s.clearcoat, cc, mPod); s.clearcoatRoughness = mix(s.clearcoatRoughness, 0.02, mPod);
  s.flake = mix(s.flake, 0.0, mPod); s.emissive = mix(s.emissive, em, mPod);
}

void lightsTail(inout Surf s, vec3 p, vec3 n, float fw) {
  if (p.x > -2.10 || n.x > -0.25 || abs(p.y - ${f4(T.y)}) > 0.07 || p.z > ${f4(T.halfWidth)} + 0.06) return;
  float z = p.z, yb = ${f4(T.y)};
  float bh = 0.0175 + 0.0100 * bd_sstep(0.45, ${f4(T.halfWidth)}, z);             // half height: 35 mm mid, 55 mm at the ends
  float pb = bd_smax(abs(p.y - yb) - bh, z - ${f4(T.halfWidth)}, 0.012);       // bar outline (rounded end)
  float mBez = bd_aa(pb - 0.003, fw);
  if (mBez < 0.002) return;
  float mBar = bd_aa(pb, fw);
  float mDiv = bd_aa(z - 0.0025, fw);                                            // slim black divider on the centre line
  float lens = mBar * (1.0 - mDiv);
  float amp = 1.0 - smoothstep(0.0015, 0.004, fw);
  float f = abs(fract(z / 0.010) - 0.5);
  float pat = mix(0.68, mix(0.35, 1.0, 1.0 - smoothstep(0.16, 0.36, f)), amp);   // fine LED segments
  float vy = 0.72 + 0.28 * (1.0 - clamp(abs(p.y - yb) / bh, 0.0, 1.0));
  float I = 0.35 + 2.6 * uBrake;
  // brighter 4-dot clusters at both ends
  vec2 q4 = vec2(z - 0.735, p.y - yb);
  float dd = length(abs(q4) - vec2(0.022, 0.011));
  float mCl = bd_aa(dd - 0.0062, fw) * mBar;
  vec3 em = vec3(1.0, 0.035, 0.02) * I * pat * vy * lens;
  em = mix(em, vec3(1.0, 0.16, 0.09) * I * 2.4, mCl * (1.0 - mDiv));
  // materials
  vec3 bc = vec3(0.008, 0.008, 0.009); float ro = 0.30, cc = 0.5, me = 0.0;              // 3 mm black rim
  bc = mix(bc, vec3(0.030, 0.0015, 0.0025), lens); ro = mix(ro, 0.06, lens); cc = mix(cc, 1.0, lens);
  s.baseColor = mix(s.baseColor, bc, mBez); s.metallic = mix(s.metallic, me, mBez); s.roughness = mix(s.roughness, ro, mBez);
  s.clearcoat = mix(s.clearcoat, cc, mBez); s.clearcoatRoughness = mix(s.clearcoatRoughness, 0.025, mBez);
  s.flake = mix(s.flake, 0.0, mBez); s.emissive = mix(s.emissive, em, mBez);
}

void shade_lights(inout Surf s, vec3 p, vec3 n, vec4 attr, float sgnz, float fw) {
  lightsHead(s, p, n, fw);
  lightsTail(s, p, n, fw);
}
`;

  PG.body.registerFeature({ name: 'lights', order: 60, common, sdf, shade });
})();
