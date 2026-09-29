/* ============================================================================
 * post.js  —  EDL.Post : render pipeline (scene -> HDR MSAA target -> bloom -> camera-look composite)
 *
 * Not a registered module. main.js does:
 *     const post = new EDL.Post(renderer, ctx);
 *     post.render(scene, camera, rect, look, view);      // once per panel
 * rect = {x,y,w,h} in DEVICE pixels of the canvas, origin bottom-left (three.js viewport convention).
 *
 * Pipeline per panel (all HalfFloat, linear light):
 *   1. scene  -> HDR target (4x MSAA, depth), sized to rect, cached by size (LRU, disposed when idle)
 *   2. bloom  -> soft-knee prefilter + Karis average, 13-tap dual-filter downsample pyramid, additive tent upsample
 *   3. sensor -> (only when look.softness > 0) low-pass + downsample to a virtual 1280x1024 "sensor" picture
 *   4. composite -> straight overwrite of the canvas inside viewport+scissor rect:
 *        (bicubic upsample of the sensor picture) * exposure*tint + bloom, vignette (linear light),
 *        tone map, lemon highlight clipping, sRGB encode, saturation/contrast/lift, unsharp halo,
 *        grain, 8x8 blockiness, dither, flash, fade.
 *
 * LOOK PARAMETERS  (every field optional; resolution order: look.x  ->  presets[look.preset].x  ->  defaults)
 *   preset      'clean'|'cine'|'rdc'|'ruc'|'puc'|'ddc'  (or a preset object)
 *   exposure    linear multiplier applied to the scene colour (animate per frame from the caller); it is RELATIVE
 *               to the preset's calibrated nominal exposure `gain` (so exposure:1 = nominal camera exposure)   1
 *   whitePoint  post-exposure value mapped to white: aces/agx/cam divide by it, reinhard uses it as W.  0 = auto  0
 *   tonemap     'filmic' (ACES curve + hueKeep of the chroma ACES desaturates; the default) | 'aces' (pure three.js ACES) |
 *               'agx' ('agx-ish') | 'reinhard' | 'cam' (linear + soft shoulder = camera) | 'none'          'filmic'
 *   hueKeep     0..1 chroma restored by the 'filmic' curve                                                    0.6
 *   knee        start of the shoulder for tonemap 'cam' (0.5..1)                                             0.72
 *   saturation, contrast (pivot = mid grey), lift (>0 crushes blacks, <0 raises them; encoded space)         1, 1, 0
 *   tint        [r,g,b] multiplicative colour cast in linear light                                          [1,1,1]
 *   clipTint    [r,g,b] sRGB colour (0..1 or 0..255) over-range values clip toward (e.g. lemon 244,255,186)  null
 *   clipStart / clipEnd  exposed-linear peak range over which the shift to clipTint happens                 1.0 / 3.0
 *   bloom       {strength, threshold, radius, clamp}  or a number (= strength)                               {0.06,1.0,0.6}
 *   vignette    {radial: 0..1, corners:[tl,tr,bl,br], edges:[t,r,b,l], center}  or a number (= radial).
 *               radial = 1 - radial*r^2 (r = 0 centre .. 1 corner). corners/edges/center are DISPLAY-luminance multipliers as
 *               measured on the video (default edges = half-way to the neighbouring corners, center = 1); the 9 values are
 *               joined by a biquadratic surface. Applied in linear light as m^2.2 (before the tone curve).   {0.10,[1,1,1,1]}
 *   glare       {strength, pos:[u,v], radius, color}  soft lens-flare glow of a light source outside the frame (additive, scene-linear
 *               before exposure; pos in 0..1 panel coordinates, origin bottom-left, radius in panel heights) or a number (= strength)   off
 *   softness    virtual sensor pixel size in 1280x1024-equivalent px (0 = off, 1 = native 1280x1024 upscaled)   0
 *   blur        multiplier of the sensor low-pass (1 = default)                                              1
 *   sharpen     unsharp-mask ("sharpening halo") amount, sharpenRadius in sensor px                          0, 1.2
 *   grain       gaussian-ish luminance noise sigma in 0..1 display units (0.005 = 0.5 %), seeded by view.t     0
 *   blockiness  0..1  subtle 8x8 (sensor px) DC banding + posterisation                                      0
 *   flash       0..1  additive white (flashColor optional), fade 0..1 to black
 *   skyMix      NOT used here (atmosphere reads it from the same look object)
 * ========================================================================== */
(function () {
  'use strict';
  const THREE = window.THREE;
  const EDL = (window.EDL = window.EDL || {});
  if (!THREE) { console.error('[post] THREE is missing'); return; }

  /* -------------------------------------------------------------------------
   * DEFAULTS and PRESETS
   * ----------------------------------------------------------------------- */
  const DEF = {
    exposure: 1, gain: 1, whitePoint: 0, tonemap: 'filmic', knee: 0.72, hueKeep: 0.6,
    saturation: 1, contrast: 1, lift: 0,
    tint: [1, 1, 1], clipTint: null, clipStart: 1.0, clipEnd: 3.0,
    bloom: { strength: 0.06, threshold: 1.0, radius: 0.6, clamp: 48 },
    vignette: { radial: 0.10, corners: [1, 1, 1, 1] },
    softness: 0, blur: 1, sharpen: 0, sharpenRadius: 1.2, sensorWidth: 1280, cubic: [1 / 3, 1 / 3],
    glare: { strength: 0, pos: [1, 0], radius: 0.6, color: [1, 0.96, 0.88] },
    grain: 0, blockiness: 0, flash: 0, flashColor: [1, 1, 1], fade: 0,
  };

  // Presets. Colours are tuned against the reference frames in _work/ref (see _work/notes/post.md and
  // _work/test/post_presets.html which renders a synthetic Mars scene through each preset).
  const PRESETS = {
    // neutral, almost untouched image (debug / free camera)
    clean: {
      tonemap: 'filmic', saturation: 1, contrast: 1,
      bloom: { strength: 0.04, threshold: 1.0, radius: 0.55 },
      vignette: { radial: 0.06 },
      grain: 0,
    },
    // filmic external camera: warm, mild bloom, subtle vignette + grain
    cine: {
      tonemap: 'filmic', saturation: 1.06, contrast: 1.08, lift: 0.006,
      tint: [1.035, 1.0, 0.93],
      bloom: { strength: 0.16, threshold: 0.85, radius: 0.7 },
      vignette: { radial: 0.24 },
      grain: 0.007,
    },
    // rover down-look camera (heat-shield report sec.8): asymmetric vignette, soft 1.77x upscale, warm hazy terrain, lemon clip.
    // gain/tint/saturation are fitted so that the synthetic test ground (linear 0.266,0.122,0.058) lands on the video's terrain (161,111,88).
    rdc: {
      gain: 1.36, tonemap: 'cam', knee: 0.74, saturation: 0.85, contrast: 1.0, lift: 0.025,
      tint: [1.12, 1.0, 1.2],
      clipTint: [244, 255, 186], clipStart: 0.95, clipEnd: 1.9,
      bloom: { strength: 0, threshold: 1.2, radius: 0.5 },      // the RDC picture shows no glow (also saves the whole bloom chain, ~0.4 ms, in the longest panel)
      // display multipliers measured on the video (TL .55 / T .83 / L .68 / BL .72 / B 1.0 / R 1.1 / BR 1.1), divided by the 12 % radial term
      vignette: { radial: 0.12, corners: [0.59, 1.08, 0.77, 1.25], edges: [0.85, 1.17, 1.064, 0.68] },
      softness: 1.0, blur: 1.0, sharpen: 0.55, sharpenRadius: 1.3, grain: 0.005, blockiness: 0.12,
    },
    // rover up-look camera: lavender/violet cast, hazy lifted blacks, silver-blue foil highlights, clips to near-white
    ruc: {
      gain: 0.24, tonemap: 'cam', knee: 0.7, saturation: 1.0, contrast: 1.06, lift: -0.04,
      tint: [1.14, 1.0, 1.6],
      clipTint: [250, 247, 255], clipStart: 1.0, clipEnd: 2.4,
      bloom: { strength: 0.08, threshold: 1.0, radius: 0.75 },
      vignette: { radial: 0.22, corners: [0.86, 1.0, 0.72, 0.95] },
      glare: { strength: 0.55, pos: [1.0, 1.0], radius: 0.42 },
      softness: 1.0, blur: 1.0, sharpen: 0.5, sharpenRadius: 1.3, grain: 0.007, blockiness: 0.2,
    },
    // parachute up-look cameras: dark violet sky, blue-white canopy, big glare, strong contrast.
    // (the caller animates look.exposure: whiteout at mortar fire, then settle to 1)
    puc: {
      gain: 0.75, tonemap: 'cam', knee: 0.7, saturation: 0.8, contrast: 1.04, lift: 0.0,
      tint: [0.84, 1.0, 2.2],
      clipTint: [232, 240, 255], clipStart: 1.0, clipEnd: 2.2,
      bloom: { strength: 0.4, threshold: 0.9, radius: 0.95 },
      vignette: { radial: 0.16, corners: [0.95, 0.85, 0.75, 1.0] },
      glare: { strength: 0.3, pos: [1.02, -0.02], radius: 0.55 },
      softness: 1.0, blur: 1.0, sharpen: 0.45, sharpenRadius: 1.3, grain: 0.006, blockiness: 0.2,
    },
    // descent-stage down-look camera (4:3): brown/grey ground, pink-white highlights, bloom on the rover deck
    ddc: {
      gain: 0.98, tonemap: 'cam', knee: 0.7, saturation: 0.6, contrast: 1.06, lift: 0.02,
      tint: [0.91, 1.0, 1.55],
      clipTint: [247, 228, 254], clipStart: 0.95, clipEnd: 2.0,
      bloom: { strength: 0.2, threshold: 0.85, radius: 0.7 },
      vignette: { radial: 0.20, corners: [0.55, 0.95, 0.82, 0.88] },
      softness: 1.0, blur: 1.0, sharpen: 0.5, sharpenRadius: 1.3, grain: 0.007, blockiness: 0.2,
    },
  };

  const TONEMAP = { none: 0, linear: 0, aces: 1, agx: 2, 'agx-ish': 2, reinhard: 3, cam: 4, camera: 4, filmic: 5 };

  /* -------------------------------------------------------------------------
   * look resolution helpers (allocation-free)
   * ----------------------------------------------------------------------- */
  const EMPTY = {};
  function presetOf(look) {
    const p = look.preset;
    if (p && typeof p === 'object') return p;
    return (p && PRESETS[p]) || EMPTY;
  }
  function pick(look, P, key) {
    let v = look[key];
    if (v !== undefined && v !== null) return v;
    v = P[key];
    if (v !== undefined && v !== null) return v;
    return DEF[key];
  }
  // nested scalar: look[key] may be a number (alias for sub === numSub) or an object {sub: value}
  function nested(look, P, key, sub, numSub) {
    let o = look[key], v;
    if (o !== undefined && o !== null) {
      if (typeof o === 'object') v = o[sub];
      else if (sub === numSub) v = o;
    }
    if (v === undefined || v === null) {
      o = P[key];
      if (o !== undefined && o !== null) {
        if (typeof o === 'object') v = o[sub];
        else if (sub === numSub) v = o;
      }
    }
    if (v === undefined || v === null) { o = DEF[key]; v = o && typeof o === 'object' ? o[sub] : undefined; }
    return v;
  }
  function nestedArr(look, P, key, sub) {
    let o = look[key], v;
    if (o !== undefined && o !== null && typeof o === 'object') v = o[sub];
    if (!v) { o = P[key]; if (o && typeof o === 'object') v = o[sub]; }
    if (!v) { o = DEF[key]; v = o && o[sub]; }
    return v;
  }
  function fnum(v, d) { return typeof v === 'number' && v === v ? v : d; }
  // colour-like input: [r,g,b] array, THREE.Color/{r,g,b} or Vector3/{x,y,z}
  function comp(v, i) {
    if (v[i] !== undefined) return v[i];
    return i === 0 ? (v.r !== undefined ? v.r : v.x) : i === 1 ? (v.g !== undefined ? v.g : v.y) : (v.b !== undefined ? v.b : v.z);
  }
  function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

  /* -------------------------------------------------------------------------
   * GLSL
   * ----------------------------------------------------------------------- */
  const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

  // 13-tap dual-filter downsample. PREFILTER: exposure*tint, soft-knee threshold, Karis average (first level only).
  const FRAG_DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
#ifdef PREFILTER
uniform vec3 uExpTint;
uniform vec3 uThr;   // x threshold, y knee, z clamp
vec3 pre(vec3 c){
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = min(max(c, vec3(0.0)) * uExpTint, vec3(uThr.z));
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThr.x + uThr.y, 0.0, 2.0 * uThr.y);
  rq = rq * rq / (4.0 * uThr.y + 1e-5);
  return c * (max(rq, br - uThr.x) / max(br, 1e-4));
}
#define S(o) pre(texture2D(tSrc, vUv + (o) * uTexel).rgb)
float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
#else
#define S(o) texture2D(tSrc, vUv + (o) * uTexel).rgb
#endif
void main(){
  vec3 a = S(vec2(-2.0,  2.0)), b = S(vec2(0.0,  2.0)), c = S(vec2(2.0,  2.0));
  vec3 d = S(vec2(-2.0,  0.0)), e = S(vec2(0.0,  0.0)), f = S(vec2(2.0,  0.0));
  vec3 g = S(vec2(-2.0, -2.0)), h = S(vec2(0.0, -2.0)), i = S(vec2(2.0, -2.0));
  vec3 j = S(vec2(-1.0,  1.0)), k = S(vec2(1.0,  1.0)), l = S(vec2(-1.0, -1.0)), m = S(vec2(1.0, -1.0));
#ifdef PREFILTER
  vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25;
  vec3 g4 = (j + k + l + m) * 0.25;
  float w0 = 0.125 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.5 * kw(g4);
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
#else
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
#endif
  gl_FragColor = vec4(col, 1.0);
}
`;

  // 3x3 tent upsample of the coarser level, scaled by uWeight and ADDED (blend One/One) into the finer level.
  const FRAG_UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb
      + texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb
     + texture2D(tSrc, vUv + vec2(-t.x,  t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x,  t.y)).rgb;
  gl_FragColor = vec4(c * (uWeight / 16.0), 1.0);
}
`;

  // virtual sensor picture: 3x3 gaussian with bilinear taps spaced uSpread source texels apart
  const FRAG_SENSOR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uSpread;
varying vec2 vUv;
void main(){
  vec2 o = uTexel * uSpread;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(-o.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x, 0.0)).rgb
      + texture2D(tSrc, vUv + vec2(0.0, -o.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb
     + texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x,  o.y)).rgb;
  gl_FragColor = vec4(c * (1.0 / 16.0), 1.0);
}
`;

  const FRAG_COMPOSITE = /* glsl */ `
uniform sampler2D tScene;      // HDR scene (plain) or the low-res "sensor" picture (SOFT)
uniform sampler2D tBloom;
uniform vec2  uSrcSize;        // pixel size of tScene
uniform vec2  uOrigin;         // rect origin in device px (gl_FragCoord space)
uniform vec3  uExpTint;
uniform float uBloomGain;
uniform float uTonemap;        // 0 none 1 aces 2 agx 3 reinhard 4 cam
uniform float uWhite, uKnee, uHue;
uniform float uSat, uContrast, uLift;
uniform vec3  uClipLin;
uniform vec2  uClipRange;
uniform float uClipAmt;
uniform vec3  uVigT, uVigM, uVigB;  // rows of the 3x3 vignette grid (tl,t,tr) (l,c,r) (bl,b,br): display multipliers
uniform float uRadial;
uniform float uSharp, uSharpPx;
uniform float uGrain, uGrainScale, uSeed;
uniform float uBlock, uFlash, uFade;
uniform vec3  uFlashColor;
uniform vec2  uCubic;
uniform vec4  uGlare;          // x,y (uv of the source), radius (panel heights), strength (scene-linear, before exposure)
uniform vec3  uGlareCol;
uniform float uAspect;
varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 toSRGB(vec3 c){
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

/* ---- tone curves (aces + agx are the three.js r170 implementations) ---- */
vec3 rrtOdt(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 tmAces(vec3 color){
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = rrtOdt(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 agxContrast(vec3 x){
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 tmAgx(vec3 color){
  const mat3 LIN709_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 LIN2020_TO_709 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 AgXInset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AgXOutset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float MIN_EV = -12.47393; const float MAX_EV = 4.026069;
  color = LIN709_TO_2020 * color;
  color = AgXInset * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - MIN_EV) / (MAX_EV - MIN_EV);
  color = clamp(color, 0.0, 1.0);
  color = agxContrast(color);
  color = AgXOutset * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LIN2020_TO_709 * color;
  return clamp(color, 0.0, 1.0);
}
// ACES luminance curve with part of the chroma that per-channel ACES desaturates restored (keeps butterscotch skies / terracotta ground)
vec3 tmFilmic(vec3 c, float keep){
  vec3 d = tmAces(c);
  float l0 = max(dot(c, LUMA), 1e-5), l1 = dot(d, LUMA);
  return clamp(mix(d, c * (l1 / l0), keep), 0.0, 1.0);
}
vec3 tmReinhard(vec3 c, float W){ return clamp(c * (1.0 + c / (W * W)) / (1.0 + c), 0.0, 1.0); }
// camera-like curve: linear up to the knee, exponential shoulder to 1 (C1 continuous)
vec3 tmCam(vec3 c, float K){
  return min(c, vec3(K)) + (1.0 - K) * (1.0 - exp(-max(c - K, 0.0) / (1.0 - K)));
}
vec3 toneMap(vec3 c){
  if (uTonemap < 0.5) return clamp(c, 0.0, 1.0);
  if (uTonemap < 1.5) return tmAces(c / uWhite);
  if (uTonemap < 2.5) return tmAgx(c / uWhite);
  if (uTonemap < 3.5) return tmReinhard(c, uWhite);
  if (uTonemap < 4.5) return tmCam(c / uWhite, uKnee);
  return tmFilmic(c / uWhite, uHue);
}

/* exposed, vignetted linear colour -> display (sRGB encoded) colour with the camera 'look' */
vec3 grade(vec3 x){
  float peak = max(x.r, max(x.g, x.b));
  vec3 d = toneMap(x);
  float hl = smoothstep(uClipRange.x, uClipRange.y, peak) * uClipAmt;
  d = mix(d, uClipLin, hl);
  vec3 e = toSRGB(d);
  float l = dot(e, LUMA);
  e = mix(vec3(l), e, uSat);
  e = (e - 0.46) * uContrast + 0.46;
  e = max(e, 0.0);
  if (uLift >= 0.0) e = max(e - uLift, 0.0) / (1.0 - uLift);
  else e = e * (1.0 + uLift) - uLift;
  return e;
}

#ifdef SOFT
// Mitchell-Netravali (B,C) bicubic using 9 bilinear taps
vec3 sampleCubic(sampler2D tex, vec2 uv, vec2 texSize){
  vec2 pos = uv * texSize;
  vec2 tc = floor(pos - 0.5) + 0.5;
  vec2 f = pos - tc;
  vec2 f2 = f * f, f3 = f2 * f;
  float B = uCubic.x, C = uCubic.y;
  vec2 w0 = (-B / 6.0 - C) * f3 + (B / 2.0 + 2.0 * C) * f2 + (-B / 2.0 - C) * f + B / 6.0;
  vec2 w1 = (2.0 - 1.5 * B - C) * f3 + (-3.0 + 2.0 * B + C) * f2 + (1.0 - B / 3.0);
  vec2 w2 = (-2.0 + 1.5 * B + C) * f3 + (3.0 - 2.5 * B - 2.0 * C) * f2 + (B / 2.0 + C) * f + B / 6.0;
  vec2 w3 = (B / 6.0 + C) * f3 - C * f2;
  vec2 w12 = w1 + w2;
  vec2 p0 = (tc - 1.0) / texSize, p3 = (tc + 2.0) / texSize, p12 = (tc + w2 / w12) / texSize;
  vec3 r = texture2D(tex, vec2(p0.x, p0.y)).rgb * (w0.x * w0.y);
  r += texture2D(tex, vec2(p12.x, p0.y)).rgb * (w12.x * w0.y);
  r += texture2D(tex, vec2(p3.x, p0.y)).rgb * (w3.x * w0.y);
  r += texture2D(tex, vec2(p0.x, p12.y)).rgb * (w0.x * w12.y);
  r += texture2D(tex, vec2(p12.x, p12.y)).rgb * (w12.x * w12.y);
  r += texture2D(tex, vec2(p3.x, p12.y)).rgb * (w3.x * w12.y);
  r += texture2D(tex, vec2(p0.x, p3.y)).rgb * (w0.x * w3.y);
  r += texture2D(tex, vec2(p12.x, p3.y)).rgb * (w12.x * w3.y);
  r += texture2D(tex, vec2(p3.x, p3.y)).rgb * (w3.x * w3.y);
  return max(r, vec3(0.0));
}
#endif

// lens glare / sun flare: soft Lorentzian glow around uGlare.xy, light from outside the frame (additive, scene-linear)
vec3 glareAt(vec2 uv){
  if (uGlare.w <= 0.0) return vec3(0.0);
  vec2 d = (uv - uGlare.xy) * vec2(uAspect, 1.0) / max(uGlare.z, 1e-3);
  return uGlareCol * (uGlare.w * pow(1.0 + dot(d, d), -1.5));
}

void main(){
  vec2 uv = vUv;

  // --- vignette: radial term * biquadratic surface through a 3x3 grid of display multipliers, applied in linear light as m^2.2 ---
  vec2 dd = (uv - 0.5) * 1.41421356;
  float vr = 1.0 - uRadial * dot(dd, dd);
  vec2 pp = uv * 2.0 - 1.0;
  vec3 lx = vec3(pp.x * (pp.x - 1.0) * 0.5, 1.0 - pp.x * pp.x, pp.x * (pp.x + 1.0) * 0.5);
  vec3 ly = vec3(pp.y * (pp.y - 1.0) * 0.5, 1.0 - pp.y * pp.y, pp.y * (pp.y + 1.0) * 0.5);
  float vc = dot(lx, uVigB) * ly.x + dot(lx, uVigM) * ly.y + dot(lx, uVigT) * ly.z;
  float vEnc = max(vr * vc, 0.001);
  float vigLin = exp2(2.2 * log2(vEnc));

  // --- scene ---
#ifdef SOFT
  vec3 s = sampleCubic(tScene, uv, uSrcSize);
  vec2 sTexel = 1.0 / uSrcSize;
#else
  vec3 s = max(texture2D(tScene, uv).rgb, vec3(0.0));
  vec2 sTexel = 1.0 / uSrcSize;
#endif
  vec3 bl = vec3(0.0);
  if (uBloomGain > 0.0) bl = texture2D(tBloom, uv).rgb * uBloomGain;

  vec3 gl = glareAt(uv) * uExpTint;
  vec3 e = grade((s * uExpTint + bl) * vigLin + gl);

  // --- sharpening halo (unsharp mask in display space) ---
  if (uSharp > 0.0) {
    vec2 o = sTexel * uSharpPx;
    vec3 sb = texture2D(tScene, uv + vec2( o.x,  o.y)).rgb + texture2D(tScene, uv + vec2(-o.x,  o.y)).rgb
            + texture2D(tScene, uv + vec2( o.x, -o.y)).rgb + texture2D(tScene, uv + vec2(-o.x, -o.y)).rgb;
    sb = max(sb * 0.25, vec3(0.0));
    vec3 eb = grade((sb * uExpTint + bl) * vigLin + gl);
    e += clamp(uSharp * (e - eb), vec3(-0.22), vec3(0.22));
  }

  // --- sensor noise / compression artefacts (panel-relative coordinates, sensor-pixel sized cells) ---
  vec2 pc = gl_FragCoord.xy - uOrigin;
  vec2 sd = vec2(uSeed * 17.13, uSeed * 31.71);
  if (uGrain > 0.0) {
    vec2 cell = floor(pc / uGrainScale);
    float n = hash12(cell + sd) + hash12(cell * 1.37 + sd + 11.0) - 1.0;       // triangular, sigma ~0.408
    float lum = dot(e, LUMA);
    float w = 1.0 - 0.55 * pow(abs(lum - 0.5) * 2.0, 2.0);
    e += n * (uGrain / 0.408) * w;
  }
  if (uBlock > 0.0) {
    vec2 bc = floor(pc / (8.0 * uGrainScale));
    e += (hash12(bc + sd * 0.37 + 5.0) - 0.5) * 0.028 * uBlock;
    float L = mix(255.0, 72.0, uBlock);
    e = floor(e * L + 0.5) / L;
  }
  e += (hash12(pc + 0.5) + hash12(pc * 1.7 + 3.1) - 1.0) * (1.0 / 255.0);     // 8-bit dither

  e = min(e + uFlash * uFlashColor, vec3(1.0));
  e *= (1.0 - uFade);
  gl_FragColor = vec4(clamp(e, 0.0, 1.0), 1.0);
}
`;

  /* -------------------------------------------------------------------------
   * Post
   * ----------------------------------------------------------------------- */
  const QUALITY = {
    high:   { samples: 4, bloomLevels: 6 },
    medium: { samples: 2, bloomLevels: 5 },
    low:    { samples: 0, bloomLevels: 4 },
  };

  class Post {
    constructor(renderer, ctx) {
      this.renderer = renderer;
      this.ctx = ctx || {};
      this.ok = false;
      this.lost = false;
      this.stats = { passes: 0, targets: 0, cpuMs: 0, renders: 0, msaa: 0, hdr: 'half' };
      this._entries = [];      // {w,h,samples,scene,bloom[],used}
      this._sensors = [];      // {w,h,rt,used}
      this._lastLevel = null;
      this._lastEvict = 0;
      this._q = { samples: 4, bloomLevels: 6, maxSamples: 4 };
      // preallocated scratch (no per-frame allocation)
      this._v0 = new THREE.Vector4(); this._s0 = new THREE.Vector4(); this._c0 = new THREE.Color();

      try { this._init(); this.ok = true; } catch (e) { console.error('[post] init failed, falling back to direct rendering:', e); this.ok = false; }
      if (this.ctx.quality) this.setQuality(this.ctx.quality);
    }

    _init() {
      const r = this.renderer;
      const gl = r.getContext();
      if (!(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 required');
      const ext = r.extensions;
      const halfOK = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
      this._hdrType = halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
      this.stats.hdr = halfOK ? 'half' : 'ldr-fallback';
      if (!halfOK) console.warn('[post] no float colour-buffer support: HDR pipeline degraded to 8 bit');
      this._maxSamples = Math.max(0, r.capabilities.maxSamples | 0);

      // full-screen triangle
      const geo = (this._geo = new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this._scene = new THREE.Scene();
      this._quad = new THREE.Mesh(geo, null);
      this._quad.frustumCulled = false;
      this._scene.add(this._quad);
      this._scene.matrixAutoUpdate = false;

      const base = { vertexShader: VERT, depthTest: false, depthWrite: false, toneMapped: false, fog: false };
      // shared uniform objects (same references in bloom prefilter and composite)
      const expTint = (this._expTint = { value: new THREE.Vector3(1, 1, 1) });

      this._uPre = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uExpTint: expTint, uThr: { value: new THREE.Vector3(1, 0.5, 48) } };
      this._matPre = new THREE.ShaderMaterial(Object.assign({ uniforms: this._uPre, fragmentShader: FRAG_DOWN, defines: { PREFILTER: 1 } }, base));
      this._uDown = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } };
      this._matDown = new THREE.ShaderMaterial(Object.assign({ uniforms: this._uDown, fragmentShader: FRAG_DOWN }, base));
      this._uUp = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 0.7 } };
      this._matUp = new THREE.ShaderMaterial(Object.assign({
        uniforms: this._uUp, fragmentShader: FRAG_UP,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      }, base));
      this._uSensor = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 1 } };
      this._matSensor = new THREE.ShaderMaterial(Object.assign({ uniforms: this._uSensor, fragmentShader: FRAG_SENSOR }, base));

      const V2 = (x, y) => new THREE.Vector2(x, y);
      const cu = (this._uComp = {
        tScene: { value: null }, tBloom: { value: null }, uSrcSize: { value: V2(1, 1) }, uOrigin: { value: V2(0, 0) },
        uExpTint: expTint, uBloomGain: { value: 0 }, uTonemap: { value: 1 }, uWhite: { value: 1 }, uKnee: { value: 0.72 }, uHue: { value: 0.6 },
        uSat: { value: 1 }, uContrast: { value: 1 }, uLift: { value: 0 },
        uClipLin: { value: new THREE.Vector3(1, 1, 1) }, uClipRange: { value: V2(1, 3) }, uClipAmt: { value: 0 },
        uVigT: { value: new THREE.Vector3(1, 1, 1) }, uVigM: { value: new THREE.Vector3(1, 1, 1) }, uVigB: { value: new THREE.Vector3(1, 1, 1) }, uRadial: { value: 0 },
        uSharp: { value: 0 }, uSharpPx: { value: 1.2 },
        uGrain: { value: 0 }, uGrainScale: { value: 1 }, uSeed: { value: 0 },
        uBlock: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 0 }, uFlashColor: { value: new THREE.Vector3(1, 1, 1) },
        uCubic: { value: V2(1 / 3, 1 / 3) },
        uGlare: { value: new THREE.Vector4(1, 1, 0.6, 0) }, uGlareCol: { value: new THREE.Vector3(1, 0.96, 0.88) }, uAspect: { value: 1.25 },
      });
      this._matComp = new THREE.ShaderMaterial(Object.assign({ uniforms: cu, fragmentShader: FRAG_COMPOSITE }, base));
      this._matCompSoft = new THREE.ShaderMaterial(Object.assign({ uniforms: cu, fragmentShader: FRAG_COMPOSITE, defines: { SOFT: 1 } }, base));

      // context loss handling: three.js re-creates its GL state on restore; our cached targets are simply recreated lazily
      const cv = r.domElement;
      this._onLost = (e) => { e.preventDefault(); this.lost = true; };
      // after a restore the old GL objects belong to the dead context: just forget them (calling dispose() would delete foreign handles)
      this._onRestored = () => { this.lost = false; this._entries.length = 0; this._sensors.length = 0; this.stats.targets = 0; };
      if (cv && cv.addEventListener) {
        cv.addEventListener('webglcontextlost', this._onLost, false);
        cv.addEventListener('webglcontextrestored', this._onRestored, false);
      }

      // pre-compile the programs so the first panel does not hitch (best effort)
      try {
        const mats = [this._matPre, this._matDown, this._matUp, this._matSensor, this._matComp, this._matCompSoft];
        for (let i = 0; i < mats.length; i++) { this._quad.material = mats[i]; r.compile(this._scene, this._cam); }
      } catch (e) { /* not fatal */ }
    }

    /* ---- quality ------------------------------------------------------------------------------------------------ */
    /** q: 'high'|'medium'|'low' or {level, msaa (0/2/4), bloomLevels}. Also accepts ctx.quality-like objects. */
    setQuality(q) {
      if (!q) return;
      const level = typeof q === 'string' ? q : q.level || 'high';
      const b = QUALITY[level] || QUALITY.high;
      let samples = b.samples, levels = b.bloomLevels;
      if (typeof q === 'object') {
        if (typeof q.msaa === 'number') samples = q.msaa | 0;
        if (typeof q.bloomLevels === 'number') levels = q.bloomLevels | 0;
      }
      samples = Math.min(samples, this._maxSamples || 0);
      levels = Math.max(2, Math.min(8, levels));
      this._lastLevel = level;
      if (samples !== this._q.samples) this._disposeTargets();   // sample count is baked into the targets
      else if (levels !== this._q.bloomLevels) this._disposeTargets();
      this._q.samples = samples; this._q.bloomLevels = levels;
    }

    /* ---- render target cache -------------------------------------------------------------------------------------- */
    _rt(w, h, samples, depth) {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: this._hdrType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        generateMipmaps: false, depthBuffer: !!depth, stencilBuffer: false, samples: samples | 0,
        resolveDepthBuffer: false, resolveStencilBuffer: false,
      });
      rt.texture.name = 'EDL.Post';
      return rt;
    }

    _samplesFor(w, h) {
      let s = this._q.samples;
      const px = w * h;
      if (px > 6.5e6) s = 0; else if (px > 3.4e6) s = Math.min(s, 2);
      return Math.min(s, this._maxSamples);
    }

    _entry(w, h, now) {
      const samples = this._samplesFor(w, h);
      const a = this._entries;
      for (let i = 0; i < a.length; i++) {
        const e = a[i];
        if (e.w === w && e.h === h && e.samples === samples) { e.used = now; return e; }
      }
      const scene = this._rt(w, h, samples, true);
      const minDim = Math.min(w, h);
      const n = Math.max(2, Math.min(this._q.bloomLevels, Math.floor(Math.log2(minDim)) - 4));
      const bloom = [];
      for (let i = 0; i < n; i++) bloom.push(this._rt(Math.max(2, w >> (i + 1)), Math.max(2, h >> (i + 1)), 0, false));
      const e = { w, h, samples, scene, bloom, used: now };
      a.push(e);
      this.stats.targets = a.length + this._sensors.length;
      this.stats.msaa = samples;
      return e;
    }

    _sensor(sw, sh, now) {
      const a = this._sensors;
      for (let i = 0; i < a.length; i++) { const e = a[i]; if (e.w === sw && e.h === sh) { e.used = now; return e; } }
      const e = { w: sw, h: sh, rt: this._rt(sw, sh, 0, false), used: now };
      a.push(e);
      this.stats.targets = this._entries.length + a.length;
      return e;
    }

    _evict(now) {
      if (now - this._lastEvict < 1000) return;
      this._lastEvict = now;
      let a = this._entries;
      for (let i = a.length - 1; i >= 0; i--) {
        const e = a[i];
        if (now - e.used > 4000) { e.scene.dispose(); for (let j = 0; j < e.bloom.length; j++) e.bloom[j].dispose(); a.splice(i, 1); }
      }
      a = this._sensors;
      for (let i = a.length - 1; i >= 0; i--) { const e = a[i]; if (now - e.used > 4000) { e.rt.dispose(); a.splice(i, 1); } }
      this.stats.targets = this._entries.length + this._sensors.length;
    }

    _disposeTargets() {
      const a = this._entries;
      for (let i = 0; i < a.length; i++) { a[i].scene.dispose(); for (let j = 0; j < a[i].bloom.length; j++) a[i].bloom[j].dispose(); }
      a.length = 0;
      const s = this._sensors;
      for (let i = 0; i < s.length; i++) s[i].rt.dispose();
      s.length = 0;
      this.stats.targets = 0;
    }

    /** Free every cached target (they are recreated on demand). */
    flushCache() { this._disposeTargets(); }

    dispose() {
      this._disposeTargets();
      const cv = this.renderer && this.renderer.domElement;
      if (cv && cv.removeEventListener && this._onLost) {
        cv.removeEventListener('webglcontextlost', this._onLost, false);
        cv.removeEventListener('webglcontextrestored', this._onRestored, false);
      }
      const mats = [this._matPre, this._matDown, this._matUp, this._matSensor, this._matComp, this._matCompSoft];
      for (let i = 0; i < mats.length; i++) if (mats[i]) mats[i].dispose();
      if (this._geo) this._geo.dispose();
      this.ok = false;
    }

    /* ---- passes -------------------------------------------------------------------------------------------------- */
    _pass(mat, target) {
      mat.uniformsNeedUpdate = true;
      this._quad.material = mat;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this._scene, this._cam);
      this.stats.passes++;
    }

    /* ---- look -> uniforms ------------------------------------------------------------------------------------------ */
    _applyLook(look, view, w, h, rx, ry) {
      const P = presetOf(look), cu = this._uComp;
      const exposure = Math.max(0, fnum(pick(look, P, 'exposure'), 1) * fnum(pick(look, P, 'gain'), 1));   // look.exposure is relative to the preset's calibrated gain
      const tint = pick(look, P, 'tint');
      this._expTint.value.set(exposure * fnum(comp(tint, 0), 1), exposure * fnum(comp(tint, 1), 1), exposure * fnum(comp(tint, 2), 1));

      const tmName = pick(look, P, 'tonemap');
      const tm = TONEMAP[tmName] !== undefined ? TONEMAP[tmName] : 5;
      cu.uTonemap.value = tm;
      let wp = fnum(pick(look, P, 'whitePoint'), 0);
      if (!(wp > 0)) wp = tm === 3 ? 6 : 1;
      cu.uWhite.value = wp;
      cu.uKnee.value = Math.min(0.98, Math.max(0.3, fnum(pick(look, P, 'knee'), 0.72)));
      cu.uHue.value = Math.min(1, Math.max(0, fnum(pick(look, P, 'hueKeep'), 0.6)));
      cu.uSat.value = fnum(pick(look, P, 'saturation'), 1);
      cu.uContrast.value = fnum(pick(look, P, 'contrast'), 1);
      cu.uLift.value = Math.max(-0.5, Math.min(0.5, fnum(pick(look, P, 'lift'), 0)));

      const ct = pick(look, P, 'clipTint');
      if (ct && (ct.length >= 3 || ct.r !== undefined || ct.x !== undefined)) {
        const c0 = fnum(comp(ct, 0), 1), c1 = fnum(comp(ct, 1), 1), c2 = fnum(comp(ct, 2), 1);
        const s = c0 > 1.5 || c1 > 1.5 || c2 > 1.5 ? 1 / 255 : 1;
        cu.uClipLin.value.set(srgbToLin(c0 * s), srgbToLin(c1 * s), srgbToLin(c2 * s));
        cu.uClipAmt.value = 1;
        const cs = fnum(pick(look, P, 'clipStart'), 1), ce = fnum(pick(look, P, 'clipEnd'), 3);
        cu.uClipRange.value.set(cs, Math.max(ce, cs + 1e-3));
      } else cu.uClipAmt.value = 0;

      const cn = nestedArr(look, P, 'vignette', 'corners') || DEF.vignette.corners;
      const vTL = fnum(cn[0], 1), vTR = fnum(cn[1], 1), vBL = fnum(cn[2], 1), vBR = fnum(cn[3], 1);
      const ed = nestedArr(look, P, 'vignette', 'edges');            // [top, right, bottom, left]; default: half-way to the neighbouring corners
      const vT = ed ? fnum(ed[0], 1) : 1 + 0.5 * (0.5 * (vTL + vTR) - 1), vR = ed ? fnum(ed[1], 1) : 1 + 0.5 * (0.5 * (vTR + vBR) - 1);
      const vB = ed ? fnum(ed[2], 1) : 1 + 0.5 * (0.5 * (vBL + vBR) - 1), vL = ed ? fnum(ed[3], 1) : 1 + 0.5 * (0.5 * (vTL + vBL) - 1);
      const vCen = fnum(nested(look, P, 'vignette', 'center', 'radial'), 1);
      cu.uVigT.value.set(vTL, vT, vTR); cu.uVigM.value.set(vL, vCen, vR); cu.uVigB.value.set(vBL, vB, vBR);
      cu.uRadial.value = fnum(nested(look, P, 'vignette', 'radial', 'radial'), 0);

      const seedBase = look.grainSeed !== undefined ? look.grainSeed : (view && typeof view.t === 'number' ? Math.floor(view.t * 30) : 0);
      cu.uSeed.value = (((seedBase % 4093) + 4093) % 4093) * 0.6180339 % 97.0;
      cu.uGrain.value = Math.max(0, fnum(pick(look, P, 'grain'), 0));
      cu.uBlock.value = Math.max(0, Math.min(1, fnum(pick(look, P, 'blockiness'), 0)));
      cu.uFlash.value = Math.max(0, Math.min(1, fnum(pick(look, P, 'flash'), 0)));
      const fc = pick(look, P, 'flashColor');
      cu.uFlashColor.value.set(fnum(comp(fc, 0), 1), fnum(comp(fc, 1), 1), fnum(comp(fc, 2), 1));
      cu.uFade.value = Math.max(0, Math.min(1, fnum(pick(look, P, 'fade'), 0)));
      cu.uOrigin.value.set(rx, ry);
      const gs = Math.max(0, fnum(nested(look, P, 'glare', 'strength', 'strength'), 0));
      cu.uAspect.value = w / h;
      if (gs > 0) {
        const gp = nestedArr(look, P, 'glare', 'pos') || DEF.glare.pos, gc = nestedArr(look, P, 'glare', 'color') || DEF.glare.color;
        cu.uGlare.value.set(fnum(gp[0], 1), fnum(gp[1], 1), Math.max(0.02, fnum(nested(look, P, 'glare', 'radius', 'strength'), 0.6)), gs);
        cu.uGlareCol.value.set(fnum(comp(gc, 0), 1), fnum(comp(gc, 1), 1), fnum(comp(gc, 2), 1));
      } else cu.uGlare.value.w = 0;
      const cb = pick(look, P, 'cubic');
      cu.uCubic.value.set(fnum(cb[0], 1 / 3), fnum(cb[1], 1 / 3));

      // bloom params (prefilter uniforms + gain are finished in render() once the chain length is known)
      const bs = Math.max(0, fnum(nested(look, P, 'bloom', 'strength', 'strength'), 0));
      const bt = Math.max(0, fnum(nested(look, P, 'bloom', 'threshold', 'strength'), 1));
      const br = Math.min(1, Math.max(0, fnum(nested(look, P, 'bloom', 'radius', 'strength'), 0.6)));
      const bc = Math.max(1, fnum(nested(look, P, 'bloom', 'clamp', 'strength'), 48));
      this._bloomStrength = bs; this._bloomRadius = br;
      this._uPre.uThr.value.set(bt, Math.max(bt * 0.5, 0.02), bc);
      return bs;
    }

    /* ---- main entry ------------------------------------------------------------------------------------------------ */
    /**
     * @param scene  THREE.Scene   @param camera THREE.Camera
     * @param rect   {x,y,w,h} device px, origin bottom-left
     * @param look   plain object of camera-look parameters (see header)  @param view per-panel view (view.t used for grain)
     */
    render(scene, camera, rect, look, view) {
      const r = this.renderer;
      look = look || EMPTY;
      const t0 = performance.now();
      const w = Math.max(2, Math.round(rect.w)), h = Math.max(2, Math.round(rect.h));
      const x = Math.round(rect.x), y = Math.round(rect.y);
      if (this.lost || r.getContext().isContextLost()) return;
      if (!this.ok) { this._fallback(scene, camera, x, y, w, h, look); return; }

      if (view && view.quality && view.quality.level !== this._lastLevel) this.setQuality(view.quality);

      // complete fade to black: skip the whole pipeline (just blank the rect)
      const P = presetOf(look);
      const fade = fnum(pick(look, P, 'fade'), 0);
      const pr = r.getPixelRatio();

      // ---- save renderer state ----
      const prevTarget = r.getRenderTarget();
      const prevAuto = r.autoClear;
      const prevAlpha = r.getClearAlpha();
      r.getViewport(this._v0); r.getScissor(this._s0);
      const prevScissorTest = r.getScissorTest();
      r.getClearColor(this._c0);
      const cr = this._c0.r, cg = this._c0.g, cb = this._c0.b;
      r.autoClear = false;
      this.stats.passes = 0;

      try {
        if (fade >= 0.999) {
          this._setCanvasRect(x, y, w, h, pr);
          r.setClearColor(0x000000, 1);
          r.clear(true, false, false);
          return;
        }
        const now = t0;
        const bloomOn = this._applyLook(look, view, w, h, x, y) > 0.0005;
        const cu = this._uComp;

        // ---- 1. scene -> HDR target ----
        const e = this._entry(w, h, now);
        r.setRenderTarget(e.scene);
        r.setClearColor(0x000000, 1);
        r.clear(true, true, false);
        r.render(scene, camera);
        const hdr = e.scene.texture;

        // ---- 2. bloom ----
        const n = e.bloom.length;
        if (bloomOn) {
          const k = 0.35 + 0.6 * this._bloomRadius;
          let norm = 0, kk = 1;
          for (let i = 0; i < n; i++) { norm += kk; kk *= k; }
          this._uPre.tSrc.value = hdr; this._uPre.uTexel.value.set(1 / w, 1 / h);
          this._pass(this._matPre, e.bloom[0]);
          for (let i = 1; i < n; i++) {
            const src = e.bloom[i - 1];
            this._uDown.tSrc.value = src.texture; this._uDown.uTexel.value.set(1 / src.width, 1 / src.height);
            this._pass(this._matDown, e.bloom[i]);
          }
          this._uUp.uWeight.value = k;
          for (let i = n - 2; i >= 0; i--) {
            const src = e.bloom[i + 1];
            this._uUp.tSrc.value = src.texture; this._uUp.uTexel.value.set(1 / src.width, 1 / src.height);
            this._pass(this._matUp, e.bloom[i]);
          }
          cu.uBloomGain.value = this._bloomStrength / norm;
          cu.tBloom.value = e.bloom[0].texture;
        } else {
          cu.uBloomGain.value = 0;
          cu.tBloom.value = e.bloom[0].texture;
        }

        // ---- 3. virtual sensor picture ----
        const soft = fnum(pick(look, P, 'softness'), 0);
        let mat = this._matComp;
        let sw = w, sh = h;
        let sharpPx = fnum(pick(look, P, 'sharpenRadius'), 1.2);
        if (soft > 0.001) {
          const sensorW = Math.max(64, fnum(pick(look, P, 'sensorWidth'), 1280));
          sw = Math.max(16, Math.min(w, Math.round(sensorW / soft)));
          sh = Math.max(16, Math.round((sw * h) / w));
          const f = w / sw;
          const s = this._sensor(sw, sh, now);
          this._uSensor.tSrc.value = hdr; this._uSensor.uTexel.value.set(1 / w, 1 / h);
          this._uSensor.uSpread.value = Math.max(0.5, 0.75 * f * fnum(pick(look, P, 'blur'), 1));
          this._pass(this._matSensor, s.rt);
          cu.tScene.value = s.rt.texture;
          mat = this._matCompSoft;
        } else {
          cu.tScene.value = hdr;
          sharpPx *= w / Math.max(64, fnum(pick(look, P, 'sensorWidth'), 1280));    // sensor px -> device px
        }
        cu.uSrcSize.value.set(sw, sh);
        cu.uSharp.value = Math.max(0, fnum(pick(look, P, 'sharpen'), 0));
        cu.uSharpPx.value = sharpPx;
        cu.uGrainScale.value = Math.max(1, w / Math.max(64, fnum(pick(look, P, 'sensorWidth'), 1280)));

        // ---- 4. composite to the canvas rect (straight overwrite) ----
        this._setCanvasRect(x, y, w, h, pr);
        this._pass(mat, null);
      } finally {
        // ---- restore renderer state ----
        r.setRenderTarget(prevTarget);
        r.setViewport(this._v0); r.setScissor(this._s0); r.setScissorTest(prevScissorTest);
        r.setClearColor(this._c0.setRGB(cr, cg, cb), prevAlpha);
        r.autoClear = prevAuto;
        this._evict(t0);
        this.stats.cpuMs = performance.now() - t0;
        this.stats.renders++;
      }
    }

    // canvas viewport + scissor in DEVICE px. three multiplies by pixelRatio and rounds/floors, so pass (v+0.25)/pr.
    _setCanvasRect(x, y, w, h, pr) {
      const r = this.renderer;
      r.setRenderTarget(null);
      const k = 1 / pr;
      r.setViewport((x + 0.25) * k, (y + 0.25) * k, (w + 0.25) * k, (h + 0.25) * k);
      r.setScissor((x + 0.25) * k, (y + 0.25) * k, (w + 0.25) * k, (h + 0.25) * k);
      r.setScissorTest(true);
    }

    // used only when the HDR pipeline could not be created: direct render with three's ACES
    _fallback(scene, camera, x, y, w, h, look) {
      const r = this.renderer, pr = r.getPixelRatio(), k = 1 / pr;
      const tm = r.toneMapping, ex = r.toneMappingExposure, auto = r.autoClear;
      r.autoClear = false; r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = fnum(look.exposure, 1);
      r.setRenderTarget(null);
      r.setViewport((x + 0.25) * k, (y + 0.25) * k, (w + 0.25) * k, (h + 0.25) * k);
      r.setScissor((x + 0.25) * k, (y + 0.25) * k, (w + 0.25) * k, (h + 0.25) * k);
      r.setScissorTest(true);
      r.clear(true, true, false);
      r.render(scene, camera);
      r.toneMapping = tm; r.toneMappingExposure = ex; r.autoClear = auto;
    }
  }

  /** Fully resolved look (look -> preset -> defaults) as a fresh plain object; for debugging / UI, not used per frame. */
  Post.resolveLook = function (look) {
    look = look || EMPTY;
    const P = presetOf(look), o = {};
    const flat = ['exposure', 'gain', 'whitePoint', 'tonemap', 'knee', 'hueKeep', 'saturation', 'contrast', 'lift', 'tint', 'clipTint', 'clipStart', 'clipEnd',
      'softness', 'blur', 'sharpen', 'sharpenRadius', 'sensorWidth', 'cubic', 'grain', 'blockiness', 'flash', 'flashColor', 'fade'];
    for (const k of flat) o[k] = pick(look, P, k);
    o.bloom = { strength: nested(look, P, 'bloom', 'strength', 'strength'), threshold: nested(look, P, 'bloom', 'threshold', 'strength'), radius: nested(look, P, 'bloom', 'radius', 'strength'), clamp: nested(look, P, 'bloom', 'clamp', 'strength') };
    o.vignette = { radial: nested(look, P, 'vignette', 'radial', 'radial'), corners: nestedArr(look, P, 'vignette', 'corners'), edges: nestedArr(look, P, 'vignette', 'edges'), center: nested(look, P, 'vignette', 'center', 'radial') };
    o.glare = { strength: nested(look, P, 'glare', 'strength', 'strength'), pos: nestedArr(look, P, 'glare', 'pos'), radius: nested(look, P, 'glare', 'radius', 'strength'), color: nestedArr(look, P, 'glare', 'color') };
    return o;
  };
  Post.presets = PRESETS;
  Post.defaults = DEF;
  Post.tonemaps = Object.keys(TONEMAP);
  EDL.Post = Post;
})();
