'use strict';
// renderer_shaders.js — GLSL sources for the renderer (PG.RS). Loaded by js/renderer.js.
// Internal identifiers use the prefix pg / pg_ so that surface hooks written by other modules cannot collide with them.
// The ONLY names a hook may rely on are: structs Surf / Frag, uniforms uTime, uHeadlights, uBrake, uDrs, and the helpers
// pg_hash12/pg_hash33/pg_vnoise/pg_vnoise3 (convenience, may be used but are not part of the contract).
(function () {
  const PG = window.PG = window.PG || {};
  const RS = PG.RS = {};

  // ------------------------------------------------------------------ shared snippets
  RS.PRE = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp samplerCube;\nprecision highp sampler2DShadow;\n';

  RS.cubeFace = `
vec3 pg_faceDir(int face, vec2 uv) { // uv in [-1,1]
  if (face == 0) return vec3( 1.0, -uv.y, -uv.x);
  if (face == 1) return vec3(-1.0, -uv.y,  uv.x);
  if (face == 2) return vec3( uv.x,  1.0,  uv.y);
  if (face == 3) return vec3( uv.x, -1.0, -uv.y);
  if (face == 4) return vec3( uv.x, -uv.y,  1.0);
  return vec3(-uv.x, -uv.y, -1.0);
}`;

  RS.sampling = `
const float PG_PI = 3.14159265359;
float pg_radicalInverse(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10;
}
vec2 pg_hammersley(uint i, uint n) { return vec2(float(i) / float(n), pg_radicalInverse(i)); }
vec3 pg_ggxSample(vec2 Xi, vec3 N, float a) {
  float phi = 2.0 * PG_PI * Xi.x;
  float cosT = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
  float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  vec3 H = vec3(cos(phi) * sinT, sin(phi) * sinT, cosT);
  vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N)); vec3 B = cross(N, T);
  return normalize(T * H.x + B * H.y + N * H.z);
}`;

  // ------------------------------------------------------------------ directional key light shadow (PCSS-lite)
  // The shadow map is an orthographic depth map: depth is linear (0 = near/light side, 1 = far), zr = metres per depth unit.
  // pgShadowMat: world -> (uv.xy, depth). pgShadowA = (texel size in metres, zr, tan(light angular radius), 1/mapSize),
  // pgShadowB = (enabled, blocker search radius in metres, max filter radius in texels, -).
  RS.shadowUniforms = `
uniform sampler2DShadow pgShadowMap; uniform sampler2D pgShadowDepth;
uniform mat4 pgShadowMat; uniform vec4 pgShadowA; uniform vec4 pgShadowB;
uniform vec3 pgLightDir; uniform vec3 pgLightCol;   // direction TOWARDS the light; colour = irradiance / pi (same units as the irradiance map)
`;
  RS.shadowLib = (blk, pcf) => RS.shadowUniforms + `
float pg_ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 pg_vogel(int i, int n, float rot) { float r = sqrt((float(i) + 0.5) / float(n)); float a = float(i) * 2.39996323 + rot; return r * vec2(cos(a), sin(a)); }
// nG = geometric (interpolated vertex) world normal, NoL = max(dot(nG, L), 0). Returns 1 = fully lit, 0 = fully shadowed.
float pg_shadow(vec3 pW, vec3 nG, float NoL) {
  if (pgShadowB.x < 0.5) return 1.0;
  float tw = pgShadowA.x, zr = pgShadowA.y, tanL = pgShadowA.z, tu = pgShadowA.w;
  float sinT = sqrt(max(0.0, 1.0 - NoL * NoL));
  float tanT = min(sinT / max(NoL, 0.08), 3.0);
  vec3 sc = (pgShadowMat * vec4(pW + nG * (tw * (1.0 + 2.5 * sinT)), 1.0)).xyz;      // normal-offset bias
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float rot = pg_ign(gl_FragCoord.xy) * 6.2831853;
  float bz = tw * (0.6 + 0.5 * tanT) / zr;
  float sr = pgShadowB.y / tw, sum = 0.0, cnt = 0.0;                                    // 1) blocker search
  for (int i = 0; i < ${blk}; i++) {
    float d = texture(pgShadowDepth, sc.xy + pg_vogel(i, ${blk}, rot) * (sr * tu)).r;
    if (d < sc.z - bz) { sum += d; cnt += 1.0; }
  }
  if (cnt < 0.5) return 1.0;
  float pen = (sc.z - sum / cnt) * zr * tanL;                                            // 2) penumbra radius (metres)
  float rt = clamp(pen / tw, 1.5, pgShadowB.z);
  float bias = tw * (0.5 + 0.55 * rt * min(tanT, 2.0)) / zr;                            // slope-scaled, grows with the filter radius
  float lit = 0.0;                                                                       // 3) PCF (hardware 2x2 bilinear per tap)
  for (int i = 0; i < ${pcf}; i++) lit += texture(pgShadowMap, vec3(sc.xy + pg_vogel(i, ${pcf}, rot + 1.7) * (rt * tu), sc.z - bias));
  return lit / float(${pcf});
}
`;

  // depth-only pass shared by shadow map rendering
  RS.shadowVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 pgModel; uniform mat4 pgViewProj;
void main() { gl_Position = pgViewProj * (pgModel * vec4(aPos, 1.0)); }`;
  RS.shadowFS = `#version 300 es
precision highp float;
void main() {}`;

  // ------------------------------------------------------------------ environment generation passes
  RS.envGen = (glsl, defines) => RS.PRE + (defines || '') + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform int uFace;
` + RS.cubeFace + `
` + glsl + `
void main() {
  vec3 d = normalize(pg_faceDir(uFace, vUv * 2.0 - 1.0));
  outColor = vec4(min(envRadiance(d), vec3(60000.0)), 1.0);
}`;

  RS.prefilter = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform samplerCube uSrc; uniform int uFace; uniform float uRough; uniform float uSrcRes; uniform int uSamples;
` + RS.cubeFace + RS.sampling + `
void main() {
  vec3 N = normalize(pg_faceDir(uFace, vUv * 2.0 - 1.0));
  float a = uRough * uRough;
  vec3 sum = vec3(0.0); float wsum = 0.0;
  float omegaP = 4.0 * PG_PI / (6.0 * uSrcRes * uSrcRes);
  for (int i = 0; i < 1024; i++) {
    if (i >= uSamples) break;
    vec2 Xi = pg_hammersley(uint(i), uint(uSamples));
    vec3 H = pg_ggxSample(Xi, N, a);
    vec3 L = 2.0 * dot(N, H) * H - N;
    float NoL = dot(N, L);
    if (NoL > 0.0) {
      float NoH = max(dot(N, H), 0.0);
      float d = NoH * NoH * (a * a - 1.0) + 1.0;
      float D = a * a / (PG_PI * d * d);
      float pdf = D * 0.25 + 1e-5;
      float omegaS = 1.0 / (float(uSamples) * pdf);
      float lod = max(0.5 * log2(omegaS / omegaP) + 1.0, 0.0);
      sum += textureLod(uSrc, L, lod).rgb * NoL; wsum += NoL;
    }
  }
  outColor = vec4(sum / max(wsum, 1e-4), 1.0);
}`;

  RS.irradiance = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform samplerCube uSrc; uniform int uFace; uniform float uLod; uniform int uRes;
` + RS.cubeFace + `
void main() {
  vec3 N = normalize(pg_faceDir(uFace, vUv * 2.0 - 1.0));
  vec3 acc = vec3(0.0);
  float fr = float(uRes);
  for (int f = 0; f < 6; f++) {
    for (int y = 0; y < 64; y++) {
      if (y >= uRes) break;
      for (int x = 0; x < 64; x++) {
        if (x >= uRes) break;
        vec2 uv = (vec2(float(x), float(y)) + 0.5) / fr * 2.0 - 1.0;
        vec3 d = pg_faceDir(f, uv);
        float l2 = dot(d, d);
        vec3 dn = d * inversesqrt(l2);
        float w = (4.0 / (fr * fr)) / (l2 * sqrt(l2));
        float c = max(dot(N, dn), 0.0);
        if (c > 0.0) acc += textureLod(uSrc, dn, uLod).rgb * (c * w);
      }
    }
  }
  outColor = vec4(acc / 3.14159265, 1.0);
}`;

  RS.brdfLut = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
` + RS.sampling + `
void main() {
  float NoV = max(vUv.x, 1e-3); float rough = max(vUv.y, 0.02);
  vec3 V = vec3(sqrt(1.0 - NoV * NoV), 0.0, NoV);
  float a = rough * rough; float k = a * 0.5;
  float A = 0.0, B = 0.0;
  const int N = 512;
  for (int i = 0; i < N; i++) {
    vec2 Xi = pg_hammersley(uint(i), uint(N));
    vec3 H = pg_ggxSample(Xi, vec3(0.0, 0.0, 1.0), a);
    vec3 L = 2.0 * dot(V, H) * H - V;
    float NoL = L.z, NoH = max(H.z, 0.0), VoH = max(dot(V, H), 0.0);
    if (NoL > 0.0) {
      float Gl = NoL / (NoL * (1.0 - k) + k), Gv = NoV / (NoV * (1.0 - k) + k);
      float Gvis = Gl * Gv * VoH / (NoH * NoV + 1e-5);
      float Fc = pow(1.0 - VoH, 5.0);
      A += (1.0 - Fc) * Gvis; B += Fc * Gvis;
    }
  }
  outColor = vec4(A / float(N), B / float(N), 0.0, 1.0);
}`;

  // ------------------------------------------------------------------ backdrop + env sampling shared by bg & floor
  RS.backdrop = `
uniform vec3 pgBgTop; uniform vec3 pgBgHorizon; uniform vec3 pgBgFloor; uniform vec2 pgBgEnv;   // pgBgEnv: (amount, lod) of the environment shown as backdrop
vec3 pg_backdrop(vec3 dir) {
  float y = dir.y;
  vec3 c = mix(pgBgHorizon, pgBgTop, smoothstep(0.0, 0.75, y));
  c = mix(c, pgBgFloor, smoothstep(0.0, -0.35, y));
  if (pgBgEnv.x > 0.0) {
    vec3 e = vec3(pgEnvRot.x * dir.x + pgEnvRot.y * dir.z, dir.y, -pgEnvRot.y * dir.x + pgEnvRot.x * dir.z);
    c = mix(c, textureLod(pgSpecEnv, e, pgBgEnv.y).rgb, pgBgEnv.x);
  }
  return c;
}`;

  RS.bg = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform vec3 pgCamR; uniform vec3 pgCamU; uniform vec3 pgCamF; uniform vec2 pgTan; uniform float pgShowEnv; uniform float pgBgDebug;
uniform samplerCube pgSpecEnv; uniform vec2 pgEnvRot;
` + RS.backdrop + `
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec3 d = normalize(pgCamF + pgCamR * (p.x * pgTan.x) + pgCamU * (p.y * pgTan.y));
  vec3 c = pg_backdrop(d);
  if (pgShowEnv > 0.5) { vec3 e = d; e = vec3(pgEnvRot.x * e.x + pgEnvRot.y * e.z, e.y, -pgEnvRot.y * e.x + pgEnvRot.x * e.z); c = textureLod(pgSpecEnv, e, max(pgShowEnv - 1.0, 0.0)).rgb; }
  if (pgBgDebug > 0.5) c = pgBgDebug > 2.5 ? vec3(0.30) : (pgBgDebug > 1.5 ? vec3(1.0) : vec3(0.06));   // 1 debug views, 2 silhouette (white), 3 zebra (mid grey)
  outColor = vec4(c, 1.0);
}`;

  // ------------------------------------------------------------------ main surface vertex shader
  RS.VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aAttr;
uniform mat4 pgModel; uniform mat4 pgViewProj;
out vec3 vPos; out vec3 vNrm; out vec2 vUv; out vec4 vAttr; out vec3 vPosW;
void main() {
  vPos = aPos; vNrm = aNrm; vUv = aUv; vAttr = aAttr;
  vec4 w = pgModel * vec4(aPos, 1.0);
  vPosW = w.xyz;
  gl_Position = pgViewProj * w;
}`;

  // ------------------------------------------------------------------ fragment: header (structs + globals) visible to hooks
  RS.fsHead = `
struct Surf { vec3 baseColor; float metallic; float roughness; float clearcoat; float clearcoatRoughness; vec3 emissive;
              float alpha; float ao; vec3 normal; float flake; float specular; bool discardFrag; };
struct Frag { vec3 pObj; vec3 nObj; vec2 uv; vec4 attr; bool front; vec3 pW; vec3 nW; vec3 vW; float fw; };
uniform float uTime, uHeadlights, uBrake, uDrs;
float pg_hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 pg_hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float pg_vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pg_hash12(i), pg_hash12(i + vec2(1.0, 0.0)), f.x), mix(pg_hash12(i + vec2(0.0, 1.0)), pg_hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float pg_vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = pg_hash33(i).x, b = pg_hash33(i + vec3(1, 0, 0)).x, c = pg_hash33(i + vec3(0, 1, 0)).x, d = pg_hash33(i + vec3(1, 1, 0)).x;
  float e = pg_hash33(i + vec3(0, 0, 1)).x, g = pg_hash33(i + vec3(1, 0, 1)).x, h = pg_hash33(i + vec3(0, 1, 1)).x, k = pg_hash33(i + vec3(1, 1, 1)).x;
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
`;

  // ------------------------------------------------------------------ fragment: built-in procedural patterns
  RS.fsPatterns = `
vec3 pgAnisoDir = vec3(1.0, 0.0, 0.0); float pgAniso = 0.0; vec3 pgSheen = vec3(0.0);
struct PgFrame { vec2 c; vec3 T; vec3 B; };
PgFrame pg_patFrame(vec3 pObj, vec3 nObj, vec2 uv, float scale, bool useUV) {
  PgFrame pf;
  if (useUV) {
    pf.c = uv * scale;
    vec3 dp1 = dFdx(pObj), dp2 = dFdy(pObj); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
    vec3 dp2p = cross(dp2, nObj), dp1p = cross(nObj, dp1);
    vec3 T = dp2p * du1.x + dp1p * du2.x; vec3 B = dp2p * du1.y + dp1p * du2.y;
    // fall back to a fixed frame where the uv derivatives are degenerate
    vec3 a = abs(nObj); vec3 up = a.y < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T0 = normalize(cross(up, nObj)); vec3 B0 = cross(nObj, T0);
    float lt = dot(T, T), lb = dot(B, B);
    pf.T = lt > 1e-20 ? T * inversesqrt(lt) : T0;
    pf.B = lb > 1e-20 ? B * inversesqrt(lb) : B0;
  } else {
    vec3 a = abs(nObj);
    if (a.y >= a.x && a.y >= a.z) { pf.c = pObj.xz * scale; pf.T = vec3(1.0, 0.0, 0.0); pf.B = vec3(0.0, 0.0, 1.0); }
    else if (a.x >= a.z) { pf.c = pObj.zy * scale; pf.T = vec3(0.0, 0.0, 1.0); pf.B = vec3(0.0, 1.0, 0.0); }
    else { pf.c = pObj.xy * scale; pf.T = vec3(1.0, 0.0, 0.0); pf.B = vec3(0.0, 1.0, 0.0); }
  }
  return pf;
}
float pg_footprint(vec2 c) { return max(length(dFdx(c)), length(dFdy(c))); }

#ifdef PG_PAT_CARBON
// 2x2 twill weave. One tow = one unit of pattern coordinates, weave repeats every 4 tows.
float pg_towH(float across, float along, bool cA, bool cB) {
  float ha = sin(clamp(across, 0.0, 1.0) * 3.14159265);
  float dive = max(cA ? 0.0 : smoothstep(0.5, 0.0, along), cB ? 0.0 : smoothstep(0.5, 1.0, along));
  return ha * (1.0 - 0.5 * dive);
}
void pg_patCarbon(inout Surf s, in Frag f) {
  bool useUV = pgMat2.y > 0.5;
  float sc = pgMat2.x > 0.0 ? pgMat2.x : (useUV ? 64.0 : 200.0);
  PgFrame pf = pg_patFrame(f.pObj, f.nObj, f.uv, sc, useUV);
  float pfw = pg_footprint(pf.c);
  float fade = 1.0 - smoothstep(0.18, 0.55, pfw);
  vec2 id = floor(pf.c); vec2 lc = fract(pf.c);
  float ph = mod(id.x + id.y, 4.0);
  bool warp = ph < 2.0;                       // warp tow (runs along B) on top, else weft (runs along T)
  float across = warp ? lc.x : lc.y;
  float along = warp ? lc.y : lc.x;
  float pm = mod(ph + 3.0, 4.0), pp = mod(ph + 1.0, 4.0);
  bool cA = warp ? (pm < 2.0) : (pm >= 2.0);
  bool cB = warp ? (pp < 2.0) : (pp >= 2.0);
  float h = pg_towH(across, along, cA, cB);
  float e = 0.03;
  float dAc = (pg_towH(across + e, along, cA, cB) - pg_towH(across - e, along, cA, cB)) / (2.0 * e);
  float dAl = (pg_towH(across, along + e, cA, cB) - pg_towH(across, along - e, cA, cB)) / (2.0 * e);
  float dx = warp ? dAc : dAl, dy = warp ? dAl : dAc;
  s.normal = normalize(s.normal - (pf.T * dx + pf.B * dy) * 0.32 * fade);
  float edge = smoothstep(0.0, 0.22, across) * smoothstep(1.0, 0.78, across);
  float diveAO = 1.0 - 0.45 * max(cA ? 0.0 : smoothstep(0.35, 0.0, along), cB ? 0.0 : smoothstep(0.65, 1.0, along));
  float wao = mix(0.30, 1.0, edge) * diveAO;
  float fib = pg_vnoise(vec2(across * 22.0, along * 3.0 + dot(id, vec2(1.7, 3.1))));
  float ambient = mix(1.0, wao, fade);
  s.ao *= mix(1.0, 0.35 + 0.65 * wao, fade);
  s.baseColor *= ambient * mix(1.0, 0.7 + 0.6 * fib, fade) * (0.78 + 0.22 * h);
  s.roughness = clamp(s.roughness + (fib - 0.5) * 0.14 * fade, 0.05, 1.0);
  pgAniso = 0.9 * fade; pgAnisoDir = warp ? pf.B : pf.T;
}
#endif

#ifdef PG_PAT_ALCANTARA
void pg_patAlcantara(inout Surf s, in Frag f) {
  bool useUV = pgMat2.y > 0.5;
  float sc = pgMat2.x > 0.0 ? pgMat2.x : (useUV ? 700.0 : 2200.0);
  PgFrame pf = pg_patFrame(f.pObj, f.nObj, f.uv, sc, useUV);
  float pfw = pg_footprint(pf.c);
  float fade = 1.0 - smoothstep(0.2, 0.7, pfw);
  float n1 = pg_vnoise(pf.c), n2 = pg_vnoise(pf.c * 2.31 + 11.7);
  float nx = pg_vnoise(pf.c + vec2(0.31, 0.0)) - n1, ny = pg_vnoise(pf.c + vec2(0.0, 0.31)) - n1;
  s.normal = normalize(s.normal - (pf.T * nx + pf.B * ny) * 1.1 * fade);
  float nap = n1 * 0.6 + n2 * 0.4;
  s.baseColor *= mix(1.0, 0.68 + 0.64 * nap, fade);
  s.roughness = mix(s.roughness, 0.96, 0.6);
  s.metallic = 0.0;
  pgSheen = (s.baseColor * 3.0 + 0.06) * mix(0.55, 1.0, nap) * 1.4;
}
#endif

#ifdef PG_PAT_KNURL
float pg_knurlH(vec2 c) {
  vec2 d = vec2(c.x + c.y, c.x - c.y) * 0.70710678;
  vec2 t = 1.0 - abs(fract(d) * 2.0 - 1.0);
  return min(t.x, t.y);
}
void pg_patKnurl(inout Surf s, in Frag f) {
  bool useUV = pgMat2.y > 0.5;
  float sc = pgMat2.x > 0.0 ? pgMat2.x : (useUV ? 90.0 : 380.0);
  PgFrame pf = pg_patFrame(f.pObj, f.nObj, f.uv, sc, useUV);
  float pfw = pg_footprint(pf.c);
  float fade = 1.0 - smoothstep(0.09, 0.3, pfw);
  float e = 0.04;
  float h = pg_knurlH(pf.c);
  float dx = (pg_knurlH(pf.c + vec2(e, 0.0)) - pg_knurlH(pf.c - vec2(e, 0.0))) / (2.0 * e);
  float dy = (pg_knurlH(pf.c + vec2(0.0, e)) - pg_knurlH(pf.c - vec2(0.0, e))) / (2.0 * e);
  s.normal = normalize(s.normal - (pf.T * dx + pf.B * dy) * 0.55 * fade);
  s.ao *= mix(1.0, 0.55 + 0.45 * smoothstep(0.0, 0.35, h), fade);
  s.roughness = clamp(s.roughness + (0.5 - h) * 0.18 * fade, 0.05, 1.0);
}
#endif

#ifdef PG_PAT_BRUSHED
void pg_patBrushed(inout Surf s, in Frag f) {
  bool useUV = pgMat2.y > 0.5;
  float sc = pgMat2.x > 0.0 ? pgMat2.x : (useUV ? 500.0 : 1400.0);
  PgFrame pf = pg_patFrame(f.pObj, f.nObj, f.uv, sc, useUV);   // streaks run along T (c.x)
  float fw = length(vec2(length(dFdx(pf.c.y)), length(dFdy(pf.c.y))));
  float fade = 1.0 - smoothstep(0.35, 1.0, fw);
  vec2 q = vec2(pf.c.x * 0.03, pf.c.y);
  float v = pg_vnoise(q) * 0.55 + pg_vnoise(vec2(pf.c.x * 0.07 + 5.0, pf.c.y * 2.7)) * 0.3 + pg_vnoise(vec2(pf.c.x * 0.2, pf.c.y * 9.0)) * 0.15;
  float dv = pg_vnoise(q + vec2(0.0, 0.25)) - pg_vnoise(q - vec2(0.0, 0.25));
  s.normal = normalize(s.normal - pf.B * dv * 0.28 * fade);
  s.roughness = clamp(s.roughness + (v - 0.5) * 0.16 * fade, 0.04, 1.0);
  s.baseColor *= 1.0 + (v - 0.5) * 0.14 * fade;
  pgAniso = 0.7; pgAnisoDir = pf.T;
}
#endif
`;

  // ------------------------------------------------------------------ fragment: lighting + main
  RS.fsUniforms = `
in vec3 vPos; in vec3 vNrm; in vec2 vUv; in vec4 vAttr; in vec3 vPosW;
layout(location=0) out vec4 outColor;

uniform mat4 pgModel; uniform mat3 pgNormalMat; uniform vec3 pgCam;
uniform vec4 pgMat0;   // metallic, roughness, clearcoat, clearcoatRoughness
uniform vec4 pgMat1;   // alpha, specular, flake, envIntensity
uniform vec4 pgMat2;   // patternScale (0 = auto), hasUV, aoFromAttr, doubleSided
uniform vec4 pgMat3;   // blend (0 opaque, 1 alpha, 2 add), unlit, debug mode, -
uniform vec3 pgBase; uniform vec3 pgEmis;
uniform samplerCube pgSpecEnv; uniform samplerCube pgIrrEnv; uniform sampler2D pgBrdf; uniform sampler2D pgOccl;
uniform float pgEnvMaxLod; uniform float pgEnvScale; uniform vec2 pgEnvRot;
uniform vec4 pgPart;       // x = receiveShadow
uniform vec4 pgOcclRect;   // minX, minZ, 1/sizeX, 1/sizeZ of the baked ground occlusion map
uniform vec4 pgPass;       // x = mirror (planar reflection) pass, y = ground occlusion on
uniform vec4 pgZebra;      // debug=zebra: xyz = unit stripe axis (world), w = stripes per 180 degrees
layout(location=1) out vec4 outDist;   // planar reflection pass only: distance eye -> surface (premultiplied like the colour)

vec3 pg_envDir(vec3 d) { return vec3(pgEnvRot.x * d.x + pgEnvRot.y * d.z, d.y, -pgEnvRot.y * d.x + pgEnvRot.x * d.z); }
` + RS.shadowLib(8, 12);

  RS.fsMain = `

vec3 pg_flakes(vec3 pObj, float fw, vec3 N, vec3 V, vec3 base, float amount) {
  const float cell0 = 0.0011;
  float lv = log2(max(fw * 1.3, cell0) / cell0);
  float l0 = floor(lv), fr = lv - l0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float cell = cell0 * exp2(l0 + float(i));
    vec3 id = floor(pObj / cell);
    vec3 h = pg_hash33(id);
    vec3 rn = normalize(pg_hash33(id + 31.7) * 2.0 - 1.0 + 1e-4);
    vec3 fn = normalize(N + (rn - N * dot(rn, N)) * 0.55);
    float present = step(0.72, h.x);
    vec3 Rf = reflect(-V, fn);
    vec3 e = textureLod(pgSpecEnv, pg_envDir(Rf), 1.2).rgb;
    acc += e * present * (i == 0 ? 1.0 - fr : fr);
  }
  vec3 tint = mix(vec3(1.0), base / max(max(base.r, max(base.g, base.b)), 1e-3), 0.6);
  return acc * tint * amount * 0.05;
}

void main() {
  if (pgPass.x > 0.5 && vPosW.y < -0.002) discard;          // planar reflection pass: clip everything below the floor plane
  outDist = vec4(0.0);
  bool front = gl_FrontFacing;
  vec3 nObj = normalize(vNrm); if (!front) nObj = -nObj;
  Frag f;
  f.pObj = vPos; f.nObj = nObj; f.uv = vUv; f.attr = vAttr; f.front = front;
  f.pW = vPosW; f.nW = normalize(pgNormalMat * nObj); f.vW = normalize(pgCam - vPosW);
  f.fw = max(length(dFdx(vPos)), length(dFdy(vPos)));

  Surf s;
  s.baseColor = pgBase; s.metallic = pgMat0.x; s.roughness = pgMat0.y; s.clearcoat = pgMat0.z; s.clearcoatRoughness = pgMat0.w;
  s.emissive = pgEmis; s.alpha = pgMat1.x; s.ao = mix(1.0, clamp(vAttr.x, 0.0, 1.0), pgMat2.z);
  s.normal = nObj; s.flake = pgMat1.z; s.specular = pgMat1.y; s.discardFrag = false;

#ifdef PG_PAT_CARBON
  pg_patCarbon(s, f);
#endif
#ifdef PG_PAT_ALCANTARA
  pg_patAlcantara(s, f);
#endif
#ifdef PG_PAT_KNURL
  pg_patKnurl(s, f);
#endif
#ifdef PG_PAT_BRUSHED
  pg_patBrushed(s, f);
#endif

  vec3 nPat = s.normal;
  surfaceHook(s, f);
  if (s.discardFrag) discard;

  vec3 nrmObj = normalize(s.normal);
  vec3 N = normalize(pgNormalMat * nrmObj);
  vec3 V = f.vW;
  int dbg = int(pgMat3.z + 0.5);
  if (dbg == 1) { outColor = vec4(N * 0.5 + 0.5, 1.0); return; }
  if (dbg == 2) { outColor = vec4(vec3(s.ao), 1.0); return; }
  if (dbg == 3) { outColor = vec4(s.baseColor, 1.0); return; }
  if (dbg == 4) { outColor = vec4(0.25, 0.95, 0.55, 1.0); return; }
  if (dbg == 7) { outColor = vec4(vec3(0.05), 1.0); return; }          // silhouette: flat dark grey (sRGB ~ 63), the post pass writes it unmodified
  if (dbg == 8) {                                                       // zebra: pure mirror term, black/white stripes over the reflection vector
    vec3 Rz = reflect(-V, N);
    float t = acos(clamp(dot(Rz, pgZebra.xyz), -1.0, 1.0)) * 0.31830989 * pgZebra.w;   // 1 unit = one stripe
    float wd = fwidth(t);
    float sq = sin(t * 3.14159265);
    float aa = max(wd * 2.6, 2e-3);                                     // ~ +-0.8 px blur of the stripe edge
    float zv = smoothstep(-aa, aa, sq);
    zv = mix(zv, 0.5, smoothstep(0.55, 1.1, wd));                       // sub-pixel stripes -> mid grey instead of moire
    outColor = vec4(vec3(mix(0.004, 0.86, zv)), 1.0); return;
  }

  float mode = pgMat3.x;
  float alpha = mode < 0.5 ? 1.0 : clamp(s.alpha, 0.0, 1.0);
  vec3 emis = max(s.emissive, vec3(0.0));
  float distOut = length(pgCam - vPosW);
  float dOut = mode < 0.5 ? distOut : (mode < 1.5 ? distOut * alpha : 0.0);      // premultiplied like the colour

  if (pgMat3.y > 0.5) {                       // unlit
    vec3 c = s.baseColor + emis;
    outColor = mode < 0.5 ? vec4(c, 1.0) : (mode < 1.5 ? vec4(c * alpha, alpha) : vec4(c * alpha, 1.0));
    outDist = vec4(dOut, 0.0, 0.0, 0.0);
    return;
  }

  float envI = pgMat1.w * pgEnvScale;
  float rough = clamp(s.roughness, 0.03, 1.0);
  float metal = clamp(s.metallic, 0.0, 1.0);
  float ao = clamp(s.ao, 0.0, 1.0);
  // ground contact occlusion: surfaces close to the floor (tyres, sills, underbody) see less of the environment
  if (pgPass.y > 0.5 && vPosW.y < 1.0) {
    vec2 ouv = (vPosW.xz - pgOcclRect.xy) * pgOcclRect.zw;
    if (ouv.x > 0.0 && ouv.y > 0.0 && ouv.x < 1.0 && ouv.y < 1.0) {
      float g = textureLod(pgOccl, ouv, 0.0).r;
      float w = exp(-max(vPosW.y, 0.0) * 3.2) * (0.6 + 0.4 * clamp(0.5 - 0.5 * N.y, 0.0, 1.0)) * smoothstep(1.0, 0.7, vPosW.y);
      ao *= mix(1.0, max(g, 0.2), w);
    }
  }
  float NoV = clamp(dot(N, V), 0.02, 1.0);
  vec3 F0 = mix(vec3(0.16 * s.specular * s.specular), s.baseColor, metal);
  vec2 ab = textureLod(pgBrdf, vec2(NoV, rough), 0.0).rg;
  vec3 Fss = F0 * ab.x + ab.y;
  vec3 comp = 1.0 + F0 * (1.0 / max(ab.x + ab.y, 1e-3) - 1.0);

  // key light shadow: the key light's diffuse contribution is analytic (it is excluded from the irradiance map);
  // its specular part lives in the environment map, so the shadow only attenuates reflections that point at the light.
  vec3 Lk = pgLightDir;
  float shadowTerm = 1.0, NoLk = 0.0;
  if (dot(pgLightCol, vec3(1.0)) > 0.0) {
    NoLk = max(dot(N, Lk), 0.0);
    float NoLg = dot(f.nW, Lk);
    if (pgPart.x > 0.5 && mode < 0.5 && pgShadowB.x > 0.5 && pgPass.x < 0.5) shadowTerm = NoLg > 0.0 ? pg_shadow(f.pW, f.nW, NoLg) : 0.0;
  }

  // base layer: diffuse + specular
  vec3 Nb = N;
  if (pgAniso > 0.001) {
    vec3 aw = normalize(mat3(pgModel) * pgAnisoDir);
    vec3 at = cross(aw, V); vec3 an = cross(at, aw);
    Nb = normalize(mix(N, an, pgAniso));
  }
  vec3 R = reflect(-V, Nb); R = normalize(mix(R, N, rough * rough));
  float so = clamp(pow(NoV + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0);
  if (dbg == 6) { outColor = vec4(V * 0.5 + 0.5, 1.0); return; }
  if (dbg == 5) { outColor = vec4(R * 0.5 + 0.5, 1.0); return; }
  vec3 irr = textureLod(pgIrrEnv, pg_envDir(N), 0.0).rgb;
  vec3 keyE = pgLightCol * (NoLk * shadowTerm * mix(1.0, ao, 0.5));
  vec3 specEnv = textureLod(pgSpecEnv, pg_envDir(R), rough * pgEnvMaxLod).rgb;
  float kw = smoothstep(0.80 - 0.45 * rough, 0.985, dot(R, Lk));
  specEnv *= mix(1.0, shadowTerm, kw);
  vec3 diffuse = s.baseColor * (1.0 - metal) * (irr * ao + keyE) * (1.0 - Fss) * envI;
  vec3 spec = specEnv * Fss * comp * so * envI;
  if (pgSheen.x + pgSheen.y + pgSheen.z > 0.0) {
    vec3 sh = textureLod(pgSpecEnv, pg_envDir(N), pgEnvMaxLod * 0.85).rgb;
    spec += sh * pgSheen * pow(1.0 - NoV, 3.0) * ao * envI;
  }
  if (s.flake > 0.001) spec += pg_flakes(f.pObj, f.fw, N, V, s.baseColor, s.flake) * ao * envI * mix(1.0, shadowTerm, 0.85);

  // clear coat: smooth second GGX lobe. Pattern bump is not seen by the coat, hook perturbation is.
  vec3 coat = vec3(0.0); float atten = 1.0;
  if (s.clearcoat > 0.001) {
    vec3 Nc = normalize(pgNormalMat * normalize(nObj + (s.normal - nPat)));
    float NoVc = clamp(dot(Nc, V), 0.02, 1.0);
    float cr = clamp(s.clearcoatRoughness, 0.02, 1.0);
    vec2 abc = textureLod(pgBrdf, vec2(NoVc, cr), 0.0).rg;
    float Fc = (0.04 * abc.x + abc.y) * clamp(s.clearcoat, 0.0, 1.0);
    vec3 Rc = reflect(-V, Nc); Rc = normalize(mix(Rc, Nc, cr * cr));
    float soc = clamp(pow(NoVc + ao, exp2(-16.0 * cr - 1.0)) - 1.0 + ao, 0.0, 1.0);
    float kwc = smoothstep(0.80 - 0.45 * cr, 0.985, dot(Rc, Lk));
    coat = textureLod(pgSpecEnv, pg_envDir(Rc), cr * pgEnvMaxLod).rgb * Fc * soc * envI * mix(1.0, shadowTerm, kwc);
    atten = 1.0 - Fc;
  }
  vec3 dTerm = diffuse * atten;
  vec3 sTerm = spec * atten + coat;

  vec4 oc;
  if (mode < 0.5) oc = vec4(dTerm + sTerm + emis, 1.0);
  else if (mode < 1.5) oc = vec4((dTerm + emis) * alpha + sTerm, alpha);
  else oc = vec4((dTerm + sTerm + emis) * alpha, 1.0);
  oc.rgb = clamp(oc.rgb, vec3(0.0), vec3(64.0));
  outColor = oc;
  outDist = vec4(dOut, 0.0, 0.0, 0.0);
}
`;

  // ------------------------------------------------------------------ floor (isolated: stage B may replace it wholesale)
  RS.floorVS = `#version 300 es
precision highp float;
uniform mat4 pgViewProj; uniform float pgSize;
out vec3 vPosW;
void main() {
  vec2 c = vec2(float((gl_VertexID == 1 || gl_VertexID == 4 || gl_VertexID == 5) ? 1 : -1), float((gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5) ? 1 : -1));
  vec3 p = vec3(c.x * pgSize, 0.0, c.y * pgSize);
  vPosW = p; gl_Position = pgViewProj * vec4(p, 1.0);
}`;

  RS.floorFS = RS.PRE + `
in vec3 vPosW; layout(location=0) out vec4 outColor;
uniform vec3 pgCam;
uniform samplerCube pgSpecEnv; uniform samplerCube pgIrrEnv; uniform sampler2D pgBrdf; uniform sampler2D pgOccl;
uniform sampler2D pgReflTex; uniform sampler2D pgReflDist;
uniform float pgEnvMaxLod; uniform float pgEnvScale; uniform vec2 pgEnvRot;
uniform vec3 pgFloorAlbedo;
uniform vec4 pgFloorP0;   // roughness, reflectivity (Fresnel scale), reflection blur (rad), environment reflection amount
uniform vec4 pgFloorFade; // fadeStart, fadeEnd, poolRadius, poolMin
uniform vec4 pgOcclRect;  // minX, minZ, 1/sizeX, 1/sizeZ
uniform float pgOcclOn; uniform float pgOcclStrength;
uniform vec4 pgRefl;      // reflection texture scale (refl/full), pixel size per metre of distance (2 tan(fov/2) / H), enabled, -
uniform vec2 pgFullRes; uniform vec2 pgReflTexel;
` + RS.backdrop + RS.shadowLib(16, 24) + `
vec3 pg_envDir(vec3 d) { return vec3(pgEnvRot.x * d.x + pgEnvRot.y * d.z, d.y, -pgEnvRot.y * d.x + pgEnvRot.x * d.z); }
float pg_h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float pg_n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pg_h21(i), pg_h21(i + vec2(1.0, 0.0)), f.x), mix(pg_h21(i + vec2(0.0, 1.0)), pg_h21(i + vec2(1.0, 1.0)), f.x), f.y); }
// Baked contact-shadow / ambient occlusion under the car (see RS.aoBake), one bilinear fetch here.
float pg_occlusion(vec3 p) {
  if (pgOcclOn < 0.5) return 1.0;
  vec2 uv = (p.xz - pgOcclRect.xy) * pgOcclRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return textureLod(pgOccl, uv, 0.0).r;
}
// Planar reflection with contact hardening: the blur radius grows with the length of the reflected ray (stored per pixel in
// pgReflDist), so the tyres stay crisp where they touch the floor and the roof melts away. Returns premultiplied rgb + coverage.
vec4 pg_planar(vec2 suv, float blur, float dEye) {
  vec4 c2 = textureLod(pgReflTex, suv, 2.0);
  float dRay = c2.a > 0.02 ? max(textureLod(pgReflDist, suv, 2.0).r / c2.a - dEye, 0.0) : 3.0;
  float blurW = blur * dRay + 0.0035 * dEye;
  float rt = clamp(blurW / max(pgRefl.y * (dEye + dRay), 1e-5) * pgRefl.x, 0.6, 48.0);
  float lod = clamp(log2(rt) - 0.5, 0.0, 7.0);
  vec4 probe = textureLod(pgReflTex, suv, clamp(log2(rt) + 0.7, 0.0, 7.0));   // footprint slightly larger than the blur disc
  if (probe.a < 0.0004 && dot(probe.rgb, vec3(1.0)) < 0.0004) return vec4(0.0);   // nothing of the car anywhere near: skip the blur taps (most floor pixels)
  float rot = pg_ign(gl_FragCoord.xy) * 6.2831853;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 8; i++) acc += textureLod(pgReflTex, suv + pg_vogel(i, 8, rot) * rt * pgReflTexel, lod);
  return acc * 0.125;
}
void main() {
  vec3 p = vPosW;
  vec3 Vv = pgCam - p; float dEye = length(Vv); vec3 V = Vv / dEye;
  float r = length(p.xz);
  // procedural polished-resin / sealed-concrete character: slow roughness mottling + a whisper of surface waviness
  float amp = 1.0 / (1.0 + dEye * dEye * 0.05);
  float nL = pg_n2(p.xz * 0.27 + 5.0), nM = pg_n2(p.xz * 0.9 + 3.1);
  float mott = 0.6 * nL + 0.4 * nM;
  float rough = clamp(pgFloorP0.x * (0.86 + 0.28 * mott), 0.04, 1.0);
  vec3 N = normalize(vec3((nM - 0.5) * 0.010 * amp, 1.0, (nL - 0.5) * 0.010 * amp));
  float NoV = clamp(dot(N, V), 0.02, 1.0);
  vec2 ab = textureLod(pgBrdf, vec2(NoV, rough), 0.0).rg;
  vec3 Fss = vec3((0.04 * ab.x + ab.y) * pgFloorP0.y);
  float occ = pg_occlusion(p);
  float occA = mix(1.0, 0.09 + 0.91 * occ * occ, pgOcclStrength);

  // soft pool of light around the car (elliptical, longer along the car)
  float poolR = length(p.xz * vec2(0.80, 1.10));
  float pool = mix(pgFloorFade.w, 1.0, 1.0 - smoothstep(0.0, pgFloorFade.z, poolR));
  float NoL = max(dot(N, pgLightDir), 0.0);
  float sh = pg_shadow(p, vec3(0.0, 1.0, 0.0), max(pgLightDir.y, 0.0));
  vec3 key = pgLightCol * (NoL * sh * pool);
  vec3 irr = textureLod(pgIrrEnv, pg_envDir(N), 0.0).rgb;
  vec3 albedo = pgFloorAlbedo * (0.94 + 0.12 * mott);
  vec3 diffuse = albedo * (irr * mix(1.0, pool, 0.35) * occA + key) * (1.0 - Fss) * pgEnvScale;

  vec3 R = reflect(-V, N); R.y = abs(R.y); R = normalize(mix(R, vec3(0.0, 1.0, 0.0), rough * rough));
  vec3 envS = textureLod(pgSpecEnv, pg_envDir(R), rough * pgEnvMaxLod).rgb;
  float kw = smoothstep(0.80 - 0.45 * rough, 0.985, dot(R, pgLightDir));
  float reflFade = 1.0 - smoothstep(pgFloorFade.x * 0.45, pgFloorFade.y * 0.85, r);
  vec3 envRefl = envS * pgEnvScale * pgFloorP0.w * mix(1.0, occ, 0.6) * mix(1.0, sh, kw) * mix(0.5, 1.0, reflFade);
  vec4 pl = vec4(0.0);
  if (pgRefl.z > 0.5) pl = pg_planar(gl_FragCoord.xy / pgFullRes, pgFloorP0.z * (0.6 + 0.8 * mott), dEye);
  float cov = clamp(pl.a, 0.0, 1.0);
  vec3 refl = pl.rgb * reflFade + envRefl * (1.0 - cov * reflFade);
  vec3 col = diffuse + refl * Fss;   // (the planar reflection already carries the environment scale)

  vec3 bd = pg_backdrop(-V);
  float t = smoothstep(pgFloorFade.x, pgFloorFade.y, r);
  col = mix(col, bd, t);
  if (pgRefl.w > 0.5) {   // floor debug views: 1 planar reflection (colour, coverage in blue), 2 shadow, 3 contact occlusion, 4 ray distance
    if (pgRefl.w < 1.5) col = vec3(pl.rgb * 0.5 + vec3(0.0, 0.0, cov * 0.2));
    else if (pgRefl.w < 2.5) col = vec3(sh);
    else if (pgRefl.w < 3.5) col = vec3(occ);
    else col = vec3(textureLod(pgReflDist, gl_FragCoord.xy / pgFullRes, 0.0).r * 0.1);
  }
  outColor = vec4(col, 1.0);
}`;

  // top-down "lowest surface height" pass (min blending). Fed to the floor shader for the contact shadow / AO.
  RS.occlVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 pgModel; uniform vec4 pgOcclRect; // minX, minZ, 1/sizeX, 1/sizeZ
out float vY;
void main() {
  vec4 w = pgModel * vec4(aPos, 1.0);
  vY = w.y;
  vec2 uv = (w.xz - pgOcclRect.xy) * pgOcclRect.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
  RS.occlFS = RS.PRE + `
in float vY; layout(location=0) out vec4 outColor;
void main() { outColor = vec4(max(vY, 0.0), 0.0, 0.0, 1.0); }`;

  // Horizon-based occlusion baked from the top-down "lowest surface height" map: for each azimuth find the lowest elevation angle
  // at which the car starts; visible sky (cosine weighted) = sin^2(elevation). Runs only when the car geometry changed.
  RS.aoBake = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform sampler2D pgMinY; uniform vec4 pgOcclRect;
float pg_h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = pgOcclRect.xy + vUv / pgOcclRect.zw;
  float rot = pg_h(vUv * 517.0) * 6.2831853;
  float sum = 0.0;
  const int DIRS = 32; const int STEPS = 7;
  for (int i = 0; i < DIRS; i++) {
    float a = rot + float(i) * (6.2831853 / float(DIRS));
    vec2 dir = vec2(cos(a), sin(a));
    float minTan = 1e3;
    for (int j = 0; j < STEPS; j++) {
      float d = 0.03 * pow(1.65, float(j)) * (0.85 + 0.3 * pg_h(vUv * 91.0 + float(i * 7 + j)));
      vec2 uv = (p + dir * d - pgOcclRect.xy) * pgOcclRect.zw;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
      float h = textureLod(pgMinY, uv, 0.0).r;
      if (h < 3.0) minTan = min(minTan, h / d);
    }
    float sn = sin(min(atan(minTan), 1.5707963));
    sum += sn * sn;
  }
  outColor = vec4(vec3(sum / float(DIRS)), 1.0);
}`;

  // ------------------------------------------------------------------ post: bloom + tone map
  RS.bloomDown = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uFirst; uniform float uThreshold;
vec3 pg_fetch(vec2 uv) { return texture(uTex, uv).rgb; }
float pg_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 pg_prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.6;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * w;
}
void main() {
  vec2 t = uTexel;
  vec3 a = pg_fetch(vUv + t * vec2(-2, 2)), b = pg_fetch(vUv + t * vec2(0, 2)), c = pg_fetch(vUv + t * vec2(2, 2));
  vec3 d = pg_fetch(vUv + t * vec2(-2, 0)), e = pg_fetch(vUv), f = pg_fetch(vUv + t * vec2(2, 0));
  vec3 g = pg_fetch(vUv + t * vec2(-2, -2)), h = pg_fetch(vUv + t * vec2(0, -2)), i = pg_fetch(vUv + t * vec2(2, -2));
  vec3 j = pg_fetch(vUv + t * vec2(-1, 1)), k = pg_fetch(vUv + t * vec2(1, 1)), l = pg_fetch(vUv + t * vec2(-1, -1)), m = pg_fetch(vUv + t * vec2(1, -1));
  vec3 r;
  if (uFirst > 0.5) {
    // Karis average to tame fireflies from aliased highlights
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = 1.0 / (1.0 + pg_luma(g0)), w1 = 1.0 / (1.0 + pg_luma(g1)), w2 = 1.0 / (1.0 + pg_luma(g2)), w3 = 1.0 / (1.0 + pg_luma(g3)), w4 = 1.0 / (1.0 + pg_luma(g4));
    r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3) * 0.125 + g4 * w4 * 0.5;
    r /= (w0 + w1 + w2 + w3) * 0.125 + w4 * 0.5;
    r = pg_prefilter(r);
  } else {
    r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  outColor = vec4(r, 1.0);
}`;
  RS.bloomUp = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uRadius; uniform float uGain;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 r = texture(uTex, vUv + t * vec2(-1, 1)).rgb + texture(uTex, vUv + t * vec2(0, 1)).rgb * 2.0 + texture(uTex, vUv + t * vec2(1, 1)).rgb
         + texture(uTex, vUv + t * vec2(-1, 0)).rgb * 2.0 + texture(uTex, vUv).rgb * 4.0 + texture(uTex, vUv + t * vec2(1, 0)).rgb * 2.0
         + texture(uTex, vUv + t * vec2(-1, -1)).rgb + texture(uTex, vUv + t * vec2(0, -1)).rgb * 2.0 + texture(uTex, vUv + t * vec2(1, -1)).rgb;
  outColor = vec4(r / 16.0 * uGain, 1.0);
}`;

  RS.post = RS.PRE + `
in vec2 vUv; layout(location=0) out vec4 outColor;
uniform sampler2D uScene; uniform sampler2D uBloom;
uniform float uExposure; uniform float uBloomAmt; uniform float uVignette; uniform float uDebug; uniform vec2 uRes;
uniform float uGrain; uniform float uSaturation; uniform float uContrast; uniform float uSeed;
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 pg_rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 pg_aces(vec3 c) { c = ACES_IN * c; c = pg_rrtOdt(c); c = ACES_OUT * c; return clamp(c, 0.0, 1.0); }
vec3 pg_srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float pg_noise(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  if (uBloomAmt > 0.0) c += texture(uBloom, vUv).rgb * uBloomAmt;
  c *= uExposure;
  vec3 o;
  if (uDebug > 1.5) { outColor = vec4(pg_srgb(clamp(texture(uScene, vUv).rgb, 0.0, 1.0)), 1.0); return; }   // silhouette / zebra: clean output (no vignette, grain, dither)
  if (uDebug > 0.5) o = pg_srgb(clamp(c / max(uExposure, 1e-4), 0.0, 1.0));
  else {
    // filmic contrast about middle grey (scene linear), then an ACES-like curve. The curve is a blend of the per-channel version
    // (natural highlight desaturation) and a ratio-preserving one (keeps hue and chroma); the more saturated the input, the more the
    // ratio-preserving one wins, so red/yellow/blue paint and saturated emissives (tail lights) do not skew to pastel.
    c = uContrast == 1.0 ? c : pow(max(c, vec3(0.0)) / 0.18, vec3(uContrast)) * 0.18;
    vec3 t1 = pg_aces(c);
    float mx = max(max(c.r, c.g), max(c.b, 1e-5)), mn = max(min(min(c.r, c.g), c.b), 0.0);
    float sat = (mx - mn) / mx;
    vec3 t2 = clamp(c * (pg_aces(vec3(mx)).g / mx), 0.0, 1.0);
    o = mix(t1, t2, mix(0.45, 0.9, smoothstep(0.35, 0.95, sat)));
    float l = dot(o, vec3(0.2126, 0.7152, 0.0722));
    o = clamp(mix(vec3(l), o, uSaturation), 0.0, 1.0);
    o = pg_srgb(o);
  }
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
  float vg = 1.0 - uVignette * smoothstep(0.35, 1.05, length(q) * 1.15);
  o *= vg;
  // film grain (luminance dependent, strongest in the mid tones) + 1-LSB dither against banding
  float g = pg_noise(gl_FragCoord.xy + uSeed * 7.31) + pg_noise(gl_FragCoord.yx + 17.0 + uSeed * 3.17) - 1.0;
  float lm = dot(o, vec3(0.333));
  o += g * uGrain * (0.35 + 1.3 * lm * (1.0 - lm)) ;
  float n = pg_noise(gl_FragCoord.xy) + pg_noise(gl_FragCoord.yx + 17.0) - 1.0;
  o += n / 255.0;
  outColor = vec4(o, 1.0);
}`;
})();
