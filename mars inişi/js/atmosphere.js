/* ============================================================================
 * atmosphere.js  —  module 'atmosphere'   (owner: atmosphere engineer)
 *
 * The look of the light and the air:
 *   - procedural sky dome (one draw, z = w so it is always at the far plane, works from any camera/altitude)
 *   - sun DirectionalLight + one shadow map re-centred on view.focus (texel-snapped, deterministic)
 *   - image based lighting (PMREM of the same sky shader, generated once) + hemisphere fill
 *   - aerial perspective: writes EDL.uniforms + scene.fog (FogExp2) as a function of camera altitude and dustCover
 *   - dust engulfment (state.env.dustCover 0..1): warm brown/ochre fog that gets opaque within ~5..10 m, sky -> rose/brown-pink
 *   - per-panel palette blend view.look.skyMix (0 = true Mars colours, 1 = the video's raw-camera lavender)
 *
 * Purity: update(t, camera, view) is a pure function of (t, camera, view, flight.state(t)). No accumulated state.
 *
 * UNITS / CONVENTIONS (important for other shader authors)
 *   Scene radiance units are chosen so that a Lambertian surface of albedo a facing the sun reads
 *       a * uSunColor * max(dot(N, uSunDir), 0)        (custom shaders)
 *   which equals what MeshStandardMaterial produces with the DirectionalLight (intensity = pi * luminance(uSunColor)).
 *   uSkyZenith / uSkyHorizon are *radiance* colours of the sky (irradiance/pi), i.e. a Lambertian ambient term is
 *       albedo * mix(uSkyHorizon, uSkyZenith, N.y*0.5+0.5)  (dust-aware).
 *   With EDL.Post = ACES filmic at exposure 1 a white (0.8) surface facing the sun reads ~0.85 (sRGB).
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util;
  const UNI = EDL.uniforms;
  const clamp01 = U.saturate;

  /* -------------------------------------------------------------------------
   * colour helpers (all colours in the API are LINEAR working-space unless stated)
   * ----------------------------------------------------------------------- */
  const srgb2lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lin2srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  function hexLin(hex) { return [srgb2lin(((hex >> 16) & 255) / 255), srgb2lin(((hex >> 8) & 255) / 255), srgb2lin((hex & 255) / 255)]; }

  // three.js ACESFilmicToneMapping (exposure 1) mirrored on the CPU: used to pre-compensate the "video palette" so that after
  // ACES the sky lands on the sampled video colours. (EDL.Post may use its own tone mapper: see api.setToneMapModel.)
  const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
  const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const rrt = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (v * 0.983729 + 0.432951) + 0.238081);
  function acesFwd(c, out) {
    const a = c[0] / 0.6, b = c[1] / 0.6, d = c[2] / 0.6;
    const x0 = rrt(ACES_IN[0][0] * a + ACES_IN[0][1] * b + ACES_IN[0][2] * d);
    const x1 = rrt(ACES_IN[1][0] * a + ACES_IN[1][1] * b + ACES_IN[1][2] * d);
    const x2 = rrt(ACES_IN[2][0] * a + ACES_IN[2][1] * b + ACES_IN[2][2] * d);
    out[0] = clamp01(ACES_OUT[0][0] * x0 + ACES_OUT[0][1] * x1 + ACES_OUT[0][2] * x2);
    out[1] = clamp01(ACES_OUT[1][0] * x0 + ACES_OUT[1][1] * x1 + ACES_OUT[1][2] * x2);
    out[2] = clamp01(ACES_OUT[2][0] * x0 + ACES_OUT[2][1] * x1 + ACES_OUT[2][2] * x2);
    return out;
  }
  // Solve acesFwd(x) = target (linear display-referred). Damped Newton with a numeric Jacobian; result clamped to [0, cap].
  function acesInverse(target, cap) {
    cap = cap || 2.2;
    const x = [Math.max(target[0], 1e-4), Math.max(target[1], 1e-4), Math.max(target[2], 1e-4)];
    const f = [0, 0, 0], f2 = [0, 0, 0], J = [0, 0, 0, 0, 0, 0, 0, 0, 0], xp = [0, 0, 0];
    const tg = [Math.min(target[0], 0.985), Math.min(target[1], 0.985), Math.min(target[2], 0.985)];
    for (let it = 0; it < 40; it++) {
      acesFwd(x, f);
      const r0 = f[0] - tg[0], r1 = f[1] - tg[1], r2 = f[2] - tg[2];
      if (Math.abs(r0) + Math.abs(r1) + Math.abs(r2) < 1e-6) break;
      for (let j = 0; j < 3; j++) {
        const h = Math.max(1e-4, x[j] * 1e-3);
        xp[0] = x[0]; xp[1] = x[1]; xp[2] = x[2]; xp[j] += h;
        acesFwd(xp, f2);
        J[0 * 3 + j] = (f2[0] - f[0]) / h; J[1 * 3 + j] = (f2[1] - f[1]) / h; J[2 * 3 + j] = (f2[2] - f[2]) / h;
      }
      const det = J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6]);
      if (Math.abs(det) < 1e-9) break;
      const i = 1 / det;
      const inv = [
        (J[4] * J[8] - J[5] * J[7]) * i, (J[2] * J[7] - J[1] * J[8]) * i, (J[1] * J[5] - J[2] * J[4]) * i,
        (J[5] * J[6] - J[3] * J[8]) * i, (J[0] * J[8] - J[2] * J[6]) * i, (J[2] * J[3] - J[0] * J[5]) * i,
        (J[3] * J[7] - J[4] * J[6]) * i, (J[1] * J[6] - J[0] * J[7]) * i, (J[0] * J[4] - J[1] * J[3]) * i,
      ];
      for (let k = 0; k < 3; k++) {
        const step = inv[k * 3] * r0 + inv[k * 3 + 1] * r1 + inv[k * 3 + 2] * r2;
        x[k] = Math.min(cap, Math.max(1e-4, x[k] - 0.8 * step));
      }
    }
    return x;
  }

  /* -------------------------------------------------------------------------
   * TUNABLE PARAMETERS (api.params) — physical + artistic
   * ----------------------------------------------------------------------- */
  const P = {
    marsRadius: 3389500,        // m
    tau0: 0.5,                  // vertical dust optical depth at the surface (Ls 5.6, Jezero)
    dustScaleHeight: 10000,     // m, dust mixing scale height
    gasScaleHeight: 11100,      // m, CO2 scale height
    hazeScale: 1.0,             // artistic multiplier on tau0 for the aerial perspective only
    Lw0: 0.72,                  // radiance of an albedo-1 surface facing the sun (scene units): white paint 0.8 -> ~0.85 after ACES
    sunAltGain: 0.5,            // fraction of the physical direct-beam brightening with altitude (1 = full)
    sunDiscRadiance: 40,        // HDR radiance of the solar disc (physical value is ~1e5; capped so that bloom stays sane)
    sunDiscAngularRadius: 0.0046, // rad (true 0.0030): slightly enlarged so that it is >= 3 px at 50 deg FOV / 1080p
    dustDensityMax: 0.32,       // 1/m extinction of full dust cover (opaque within ~5..10 m)
    dustSunTau: 1.8,            // direct-beam optical depth at full dust cover
    envIntensity: 0.7,          // scene.environmentIntensity at ground level, clear air
    hemiBase: 0.0,              // extra hemisphere fill in clear air (radiance units); the env map already carries the fill
    dither: 0.0035,             // sky dither amplitude (HDR units), static in screen space
    shadowBiasTexels: 1.2,      // depth bias in shadow-map texels
    shadowNormalBiasTexels: 1.6,// normal bias in shadow-map texels
    shadowDefaultRadius: 40,    // used when the view has no focus
  };

  // True-colour palette (linear radiance, scene units). See notes/atmosphere.md for how these were calibrated.
  const COL = {
    horizon: [0.597, 0.316, 0.164],      // butterscotch horizon haze (after ACES ~ #d0aa82)
    zenith: [0.265, 0.166, 0.100],       // dusty tan-brown zenith at the surface (after ACES ~ #9a7a5c) - reference only
    dark: [0.050, 0.075, 0.100],         // clear-air colour behind the dust (dark slate blue, Rayleigh + space): F = 0 limit
    aur1: [0.30, 0.36, 0.52],            // wide bluish forward-scatter glow around the Sun
    aur2: [0.90, 1.00, 1.20],            // mid glow
    ground: [0.26, 0.150, 0.100],        // albedo of the ground for the IBL bounce
    dustOchre: [0.41, 0.20, 0.086],      // sunlit dust cloud, generic (chase cameras) (after ACES ~ #b98a58)
    dustRdc: [0.62, 0.13, 0.044],        // sunlit dust seen by the RDC: orange (after ACES ~ #d8703c; the video peaks at #de7846)
    dustDdc: [0.26, 0.232, 0.173],       // dust seen by the DDC: beige (after ACES ~ #9a927f)
  };

  // Video (raw camera) palettes, sRGB hex sampled from the reference frames. Stops are at fixed positions POS.
  const PAL_POS = [0.0, 0.16, 0.36, 0.56, 0.74, 0.88, 1.0];
  const PAL_HEX = {
    // RUC clear sky 190.5 s: dark violet-grey #5f5868/#746c80 (left/bottom) -> #87809b/#9c98bb (mid) -> periwinkle #adb1e0/#b4b8e9 -> peak #cccdf8
    ruc: [0x574f5f, 0x625b6f, 0x746c80, 0x8b849f, 0xa09dc4, 0xb0b4e4, 0xcbcdf8],
    // PUC after the exposure collapse: ink #14171c/#2d2c35, mid #43404d, lit side #5a6890 and the sun glare #7b86bf -> #e8f8ff
    puc: [0x101216, 0x191b21, 0x2b2b35, 0x403f4e, 0x565f8a, 0x6f7cb6, 0xb8d0ff],
  };
  // Dust colours seen by the RUC (lavender -> rose -> brown-pink), as a function of dustCover
  const DUSTLAV_POS = [0.0, 0.18, 0.5, 0.8, 1.0];
  const DUSTLAV_HEX = [0x8d87a3, 0xbbb0d6, 0xc1898d, 0x9a6a70, 0x714845];

  /* -------------------------------------------------------------------------
   * shaders
   * ----------------------------------------------------------------------- */
  const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;                                             // unit sphere at the origin: object space == world directions
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;                                        // z = w -> depth 1.0, independent of camera far / position
}`;

  const SKY_FRAG = /* glsl */ `
${EDL.glsl.fog}
uniform vec3  uDark;          // clear-air (dust free) sky colour, dark slate blue
uniform float uTauAbove;      // vertical dust optical depth above the camera
uniform vec3  uDustSky;       // colour of dust cloud lit by the sun (already palette-blended)
uniform float uDustA;         // sky opacity due to dust cover 0..1
uniform vec3  uAur1; uniform vec3 uAur2;
uniform float uAurGain;       // < 1 at altitude (less dust above the camera)
uniform vec2  uDip;           // cos, sin of the horizon dip angle
uniform float uSunDisc;       // 0/1
uniform float uSunDiscRad;
uniform float uSunDiscAng;
uniform float uSkyMix;        // 0 true colours .. 1 video lavender
uniform float uSkyGain;
uniform vec3  uPal[7];
uniform float uBake;          // 1 while generating the environment map
uniform vec3  uGround;        // bounce colour below the horizon (bake only)
uniform float uDither;
varying vec3 vDir;

const float PALPOS[7] = float[7](0.0, 0.16, 0.36, 0.56, 0.74, 0.88, 1.0);
vec3 palRamp(float s){
  s = clamp(s, 0.0, 1.0);
  vec3 c = uPal[0];
  for(int i = 0; i < 6; i++){ c = mix(c, uPal[i+1], clamp((s - PALPOS[i]) / (PALPOS[i+1] - PALPOS[i]), 0.0, 1.0)); }
  return c;
}

void main(){
  vec3 rd = normalize(vDir);
  float e = clamp(rd.y, -1.0, 1.0);
  // elevation relative to the *geometric* horizon of a sphere: at altitude the horizon lies below the level line
  float sinAng = e * uDip.x + sqrt(max(1.0 - e*e, 0.0)) * uDip.y;
  float cg = dot(rd, uSunDir);
  float gam = acos(clamp(cg, -1.0, 1.0));

  // fully fogged ground / horizon haze == exactly what edlFog gives at infinity (seamless with the terrain)
  vec3 hazeC = edlFog(vec3(0.0), 1.0e12, rd);
  // dust haze fraction along the ray: slant optical depth above the camera tauAbove / sin(elevation)
  float F = 1.0 - exp(-uTauAbove / max(sinAng, 0.015));
  vec3 dark = mix(uDark, uDustSky, uDustA);
  vec3 col = dark + (hazeC - dark) * F;

  // forward-scatter aureole (bluish because the dust absorbs blue on the direct path), + sun disc
  float cgp = max(cg, 0.0);
  float aW = pow(cgp, 7.0), aM = pow(cgp, 90.0), aC = pow(cgp, 2500.0);
  vec3 aur = (uAur1 * aW + uAur2 * (0.9 * aM) + vec3(1.0, 0.97, 0.9) * (3.0 * aC)) * uAurGain;
  aur *= (1.0 - uDustA * 0.85);
  float skyMask = smoothstep(-0.004, 0.004, sinAng);
  col += aur * skyMask;
  float disc = 1.0 - smoothstep(uSunDiscAng * 0.78, uSunDiscAng * 1.22, gam);
  float limb = 1.0 - 0.42 * pow(clamp(gam / uSunDiscAng, 0.0, 1.0), 2.0);
  col += uSunColor / max(dot(uSunColor, vec3(0.2126, 0.7152, 0.0722)), 1e-3) * (uSunDiscRad * disc * limb * uSunDisc * (1.0 - uDustA) * skyMask);

  if(uBake > 0.5){
    // ground hemisphere for the IBL: warm bounce light, fading in around the horizon
    col = mix(col, uGround, smoothstep(0.0, -0.2, e));
  }

  // ---- video palette (raw-camera lavender): brightness field = angular distance to the Sun (+ slightly brighter to the horizon)
  if(uSkyMix > 0.001){
    float lin = clamp((1.27 - gam) / 0.80, 0.0, 1.0);          // ~ linear in the angle to the Sun: 31 deg -> 0.9, 50 deg -> 0.5, 69 deg -> 0.1
    float s = mix(lin, lin * lin * (3.0 - 2.0 * lin), 0.5);
    s = clamp(0.02 + 0.98 * s + 0.08 * F, 0.0, 1.0);
    vec3 lav = palRamp(s) * uSkyGain;
    col = mix(col, lav, uSkyMix);
    col = mix(col, uDustSky * (0.85 + 0.3 * s), uDustA * uSkyMix * skyMask);
  }
  // dust cloud in front of the sky (true-colour path handled through 'zen' above; here the lit-cloud brightening toward the Sun)
  if(uSkyMix <= 0.001){
    col = mix(col, uDustSky * (0.85 + 0.6 * aW), uDustA * skyMask * 0.5);
  }

  // static dither against banding of the smooth gradients (screen-space hash, no time term)
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * uDither;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

  /* =========================================================================
   * FACTORY
   * ======================================================================= */
  EDL.registerModule('atmosphere', function factory(ctx) {
    const renderer = ctx.renderer, scene = ctx.scene;
    const group = new THREE.Group();
    group.name = 'atmosphere';

    // ---- make three's built-in fog consistent with edlFog (exponential, not squared) -------------------------------
    // FogExp2 in three is exp(-(d*rho)^2); edlFog (core.js) is exp(-d*rho). Patch the chunk once (before any program is built).
    try {
      if (!THREE.ShaderChunk.__edlFogPatched) {
        THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
          'fogDensity * fogDensity * vFogDepth * vFogDepth', 'fogDensity * vFogDepth');
        THREE.ShaderChunk.__edlFogPatched = true;
      }
    } catch (e) { console.warn('[atmosphere] fog chunk patch failed', e); }

    // ---- state / temporaries -------------------------------------------------------------------------------------
    const override = { altitude: null, dust: null, skyMix: null, focus: null };   // test hooks only (never set by the app)
    const DEFAULT_Q = { level: 'high', particles: 1, shadows: true, resolutionScale: 1 };
    const cur = {                                                                  // last computed values (read-only for others)
      camAlt: 0, dust: 0, skyMix: 0, fogDensity: 0, tauNadir: 0, sunGain: 1, dustAlpha: 0, envIntensity: 1,
    };
    const vCam = new THREE.Vector3(), vFwd = new THREE.Vector3(), vFocus = new THREE.Vector3();
    const cTmp = new THREE.Color();
    const haze = { rho: 0, density: 0, tauNadir: 0, transmission: 1, tauAbove: 0, skyFrac: 1, airFrac: 1, altitude: 0 };
    const rgbA = [0, 0, 0], rgbB = [0, 0, 0];
    let quality = ctx.quality || DEFAULT_Q;
    let toneModel = 'aces';
    let errOnce = false;

    // sun direction is read live from C.sun.dir every update (nobody may rotate it, but stay safe if core changes at load)
    const sunTint = new THREE.Color(C.sun.color);              // linear
    let sunTintHex = C.sun.color;
    function sunTintNorm(out) {
      const l = 0.2126 * sunTint.r + 0.7152 * sunTint.g + 0.0722 * sunTint.b;
      return out.setRGB(sunTint.r / l, sunTint.g / l, sunTint.b / l);
    }

    /* ---------------------------------------------------------------------
     * palette uniforms (video colours -> linear, optionally pre-compensated for ACES)
     * ------------------------------------------------------------------- */
    function buildPalette(hexList) {
      return hexList.map((h) => {
        const lin = hexLin(h);
        const v = toneModel === 'aces' ? acesInverse(lin, 2.2) : lin;
        return new THREE.Vector3(v[0], v[1], v[2]);
      });
    }
    let palettes = {};
    let dustLav = [];
    function rebuildPalettes() {
      palettes = { ruc: buildPalette(PAL_HEX.ruc), puc: buildPalette(PAL_HEX.puc) };
      dustLav = buildPalette(DUSTLAV_HEX);
    }
    rebuildPalettes();
    let curPalName = '';

    /* ---------------------------------------------------------------------
     * SKY MESH  (one draw)
     * ------------------------------------------------------------------- */
    const skyGeo = new THREE.SphereGeometry(1, 64, 40);
    const skyUniforms = Object.assign({
      uDark: { value: new THREE.Color().setRGB(...COL.dark) },
      uTauAbove: { value: P.tau0 },
      uDustSky: { value: new THREE.Color().setRGB(...COL.dustOchre) },
      uDustA: { value: 0 },
      uAur1: { value: new THREE.Color().setRGB(...COL.aur1) },
      uAur2: { value: new THREE.Color().setRGB(...COL.aur2) },
      uAurGain: { value: 1 },
      uDip: { value: new THREE.Vector2(1, 0) },
      uSunDisc: { value: 1 },
      uSunDiscRad: { value: P.sunDiscRadiance },
      uSunDiscAng: { value: P.sunDiscAngularRadius },
      uSkyMix: { value: 0 },
      uSkyGain: { value: 1 },
      uPal: { value: buildPalette(PAL_HEX.ruc) },
      uBake: { value: 0 },
      uGround: { value: new THREE.Color().setRGB(0, 0, 0) },
      uDither: { value: P.dither },
    }, UNI); // shares uSunDir, uSunColor, uSkyZenith, uSkyHorizon, uFogColor, uFogDensity, uHaze, uTime by reference
    const skyMat = new THREE.ShaderMaterial({
      name: 'edl-sky', vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyUniforms,
      side: THREE.BackSide, depthTest: true, depthWrite: false, fog: false, toneMapped: true,   // drawn last at depth 1.0: early-Z skips every covered pixel
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.name = 'sky';
    sky.frustumCulled = false;
    sky.renderOrder = 1000;                 // last of the opaque list (transparent objects still draw after it)
    sky.matrixAutoUpdate = false;
    group.add(sky);

    /* ---------------------------------------------------------------------
     * SUN + FILL LIGHTS
     * ------------------------------------------------------------------- */
    const sun = new THREE.DirectionalLight(0xffffff, Math.PI * P.Lw0);
    sun.name = 'sun';
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    sun.shadow.intensity = 1;
    group.add(sun); group.add(sun.target);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0);
    hemi.name = 'skyFill';
    group.add(hemi);

    if (scene) {
      scene.add(group);
      scene.fog = new THREE.FogExp2(0xc8a07c, 5e-5);
    }

    /* ---------------------------------------------------------------------
     * ENVIRONMENT MAP (PMREM of the same sky shader at ground level, no sun disc, once at load)
     * ------------------------------------------------------------------- */
    let envRT = null, envMs = 0;
    function bakeEnvironment() {
      const t0 = performance.now();
      const bakeU = {};
      // private copies of everything the sky shader reads so the bake is independent of the runtime state
      const sunDirB = { value: C.sun.dir.clone() };
      const sunColB = { value: new THREE.Color() };
      const fogB = { value: new THREE.Color().setRGB(...COL.horizon) };
      Object.assign(bakeU, skyUniforms, {
        uSunDir: sunDirB, uSunColor: sunColB, uFogColor: fogB, uFogDensity: { value: 5e-5 },
        uSkyZenith: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() },
        uHaze: { value: new THREE.Vector4() }, uTime: { value: 0 },
        uDark: { value: new THREE.Color().setRGB(...COL.dark) }, uTauAbove: { value: P.tau0 }, uDustSky: { value: new THREE.Color() }, uDustA: { value: 0 },
        uAurGain: { value: 1 }, uDip: { value: new THREE.Vector2(1, 0) }, uSunDisc: { value: 0 }, uSkyMix: { value: 0 },
        uBake: { value: 1 }, uDither: { value: 0 },
        uGround: { value: new THREE.Color() },
      });
      sunTintNorm(sunColB.value).multiplyScalar(P.Lw0);
      // ground bounce radiance = albedo * (direct on a horizontal surface + sky fill)
      const gk = P.Lw0 * Math.max(C.sun.dir.y, 0.05) + 0.2;
      bakeU.uGround.value.setRGB(COL.ground[0] * gk, COL.ground[1] * gk, COL.ground[2] * gk);
      const bm = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: bakeU, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false });
      const bs = new THREE.Scene();
      const bmesh = new THREE.Mesh(skyGeo, bm);
      bmesh.frustumCulled = false;
      bs.add(bmesh);
      const pm = new THREE.PMREMGenerator(renderer);
      try {
        envRT = pm.fromScene(bs, 0, 0.1, 100);
        if (scene) { scene.environment = envRT.texture; scene.environmentIntensity = P.envIntensity; }
      } finally { pm.dispose(); bm.dispose(); }
      envMs = performance.now() - t0;
    }
    try { bakeEnvironment(); } catch (e) {
      console.error('[atmosphere] environment bake failed (falling back to hemisphere fill only): ' + (e && e.message));
      envRT = null;
    }

    /* ---------------------------------------------------------------------
     * HAZE MODEL   (exponential dust layer, optical depth tau0, scale height H)
     * For rays that hit a flat ground plane from altitude h the MEAN extinction along the ray is independent of the ray
     * elevation:  rho_eff(h) = rho0 * (H/h) * (1 - exp(-h/H)),  rho0 = tau0/H.  A uniform exponential fog with this density
     * therefore reproduces the exact transmission of the layered atmosphere for every ground pixel (the trick used here).
     * ------------------------------------------------------------------- */
    function hazeAt(alt, out) {
      out = out || haze;
      const h = Math.max(alt || 0, 0), H = P.dustScaleHeight, tau0 = P.tau0 * P.hazeScale, x = h / H;
      const ratio = x < 1e-4 ? 1 - 0.5 * x : (1 - Math.exp(-x)) / x;
      out.altitude = h;
      out.rho = (tau0 / H) * Math.exp(-x);                 // local extinction (1/m) at the altitude
      out.density = (tau0 / H) * ratio;                    // mean extinction (1/m) for rays hitting the ground -> uFogDensity
      out.tauNadir = tau0 * (1 - Math.exp(-x));            // optical depth camera -> ground, looking straight down
      out.transmission = Math.exp(-out.tauNadir);
      out.tauAbove = tau0 * Math.exp(-x);                  // vertical optical depth above the camera
      out.skyFrac = (1 - Math.exp(-out.tauAbove)) / (1 - Math.exp(-tau0));   // diffuse sky light relative to the surface
      out.airFrac = Math.exp(-h / P.gasScaleHeight);       // CO2 column above, relative to the surface
      return out;
    }

    /* ---------------------------------------------------------------------
     * SHADOW FRAMING
     * ------------------------------------------------------------------- */
    let shadowSize = 2048, shadowEnabled = true;
    function setShadowSize(n) {
      n = n | 0;
      if (n === shadowSize) return;
      shadowSize = n;
      sun.shadow.mapSize.set(n, n);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    function applyQuality(q) {
      quality = q || DEFAULT_Q;
      const want = quality.shadows !== false;
      if (want !== shadowEnabled) { shadowEnabled = want; sun.castShadow = want; }
      // 2048 RGBA8 packed depth = 16 MB (+depth buffer); 4096 would be 128 MB and blow the texture budget, so it is opt-in only
      if (!api.allow4k) setShadowSize(2048);
    }
    const sunX = new THREE.Vector3(), sunY = new THREE.Vector3(), tgt = new THREE.Vector3();
    function frameShadow(pos, R) {
      const L = UNI.uSunDir.value;
      // light camera basis (three: z = towards the light, x = normalize(cross(up, z)), y = cross(z, x))
      const lx = L.z, lz = -L.x, ln = Math.hypot(lx, lz) || 1;
      sunX.set(lx / ln, 0, lz / ln);
      sunY.crossVectors(L, sunX);
      // snap the target to the shadow-texel grid in light space -> no shimmering, fully deterministic
      const texel = (2 * R) / shadowSize;
      const px = pos.dot(sunX), py = pos.dot(sunY);
      const sx = Math.round(px / texel) * texel - px, sy = Math.round(py / texel) * texel - py;
      tgt.copy(pos).addScaledVector(sunX, sx).addScaledVector(sunY, sy);
      const above = R * 1.6 + 25;                                       // casters between the light and the focus
      const groundDist = pos.y > 0 ? pos.y / Math.max(L.y, 0.2) : 0;    // distance along the ray from the focus to the ground
      const below = Math.min(Math.max(groundDist + 1.4 * R + 2, R * 1.3), R * 4 + 80);
      const sc = sun.shadow.camera;
      sun.position.copy(tgt).addScaledVector(L, above);
      sun.target.position.copy(tgt);
      const range = above + below;
      if (sc.right !== R || sc.far !== range) {
        sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = range;
        sc.updateProjectionMatrix();
      }
      // bias is in normalised depth units (fraction of far-near) -> convert from metres
      sun.shadow.bias = -(texel * P.shadowBiasTexels) / range;
      sun.shadow.normalBias = texel * P.shadowNormalBiasTexels;
    }

    /* ---------------------------------------------------------------------
     * dust colours
     * ------------------------------------------------------------------- */
    const dustBase = new THREE.Color(), dustLavC = new THREE.Color(), dustCol = new THREE.Color(), hazeCol = new THREE.Color(), fogCol = new THREE.Color();
    function dustLavAt(d, out) {
      // piecewise-linear through DUSTLAV (linear colours, ACES pre-compensated)
      let i = 0;
      while (i < DUSTLAV_POS.length - 2 && d > DUSTLAV_POS[i + 1]) i++;
      const a = DUSTLAV_POS[i], b = DUSTLAV_POS[i + 1], f = clamp01((d - a) / (b - a));
      const p = dustLav[i], q = dustLav[i + 1];
      return out.setRGB(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f);
    }
    function panelDustRGB(panelId) {
      if (panelId) {
        if (/ddc/i.test(panelId)) return COL.dustDdc;
        if (/rdc/i.test(panelId)) return COL.dustRdc;
      }
      return COL.dustOchre;
    }

    /* ---------------------------------------------------------------------
     * UPDATE
     * ------------------------------------------------------------------- */
    const NOLOOK = {};
    function _update(t, camera, view) {
      const look = (view && view.look) || NOLOOK;
      const q = (view && view.quality) || ctx.quality || DEFAULT_Q;
      if (q !== quality || q.shadows !== shadowEnabled) applyQuality(q);

      camera.getWorldPosition(vCam);
      const camAlt = override.altitude !== null ? override.altitude : Math.max(vCam.y, 0);

      let dust = 0;
      const fl = ctx.modules && ctx.modules.flight;
      if (fl && typeof fl.state === 'function') {
        const st = fl.state(t);
        if (st && st.env && st.env.dustCover) dust = st.env.dustCover;
      }
      if (override.dust !== null) dust = override.dust;
      dust = clamp01(dust);
      let skyMix = look.skyMix !== undefined && look.skyMix !== null ? look.skyMix : 0;
      if (override.skyMix !== null) skyMix = override.skyMix;
      skyMix = clamp01(skyMix);

      const hz = hazeAt(camAlt, haze);
      const L = UNI.uSunDir.value.copy(C.sun.dir);
      if (C.sun.color !== sunTintHex) { sunTintHex = C.sun.color; sunTint.set(sunTintHex); }
      const sinEl = Math.max(L.y, 0.05);

      // ---- dust (smooth functions of dustCover) ------------------------------------------------------------------
      const dAlpha = 1 - Math.exp(-5 * dust * dust);                   // sky opacity
      const dAmb = 1 - Math.exp(-3.5 * Math.pow(dust, 1.5));           // ambient / fill takeover
      const dSun = P.dustSunTau * Math.pow(dust, 1.6);                 // direct-beam optical depth
      const rhoD = P.dustDensityMax * Math.pow(dust, 2.2);
      const rhoH = hz.density;
      const dens = Math.max(rhoH + rhoD, 1e-8);                        // never 0 (edlFog(infinity) must stay finite)
      const dustFrac = rhoD / dens;

      // ---- sun ---------------------------------------------------------------------------------------------------
      const altGain = Math.exp((P.sunAltGain * P.tau0 * P.hazeScale * (1 - Math.exp(-camAlt / P.dustScaleHeight))) / sinEl);
      const tR = Math.exp(-dSun * 0.8), tG = Math.exp(-dSun), tB = Math.exp(-dSun * 1.4);
      sunTintNorm(cTmp);
      const sunL = P.Lw0 * altGain;
      UNI.uSunColor.value.setRGB(cTmp.r * tR * sunL, cTmp.g * tG * sunL, cTmp.b * tB * sunL);
      sun.color.setRGB(cTmp.r * tR, cTmp.g * tG, cTmp.b * tB);
      sun.intensity = Math.PI * sunL;
      sun.shadow.intensity = 1 - 0.7 * dAmb;

      // ---- colours: horizon haze / zenith (true colours, altitude aware) -----------------------------------------
      const hf = 0.8 + 0.2 * Math.exp(-camAlt / 15000);                // limb band dims a little at very high altitude
      const hR = COL.horizon[0] * hf, hG = COL.horizon[1] * hf, hB = COL.horizon[2] * hf;
      // zenith radiance = dark clear-air colour + dust haze fraction (1 - exp(-tauAbove)) toward the horizon haze colour:
      // from 12 km (tauAbove 0.15) the zenith is a dark slate blue-grey, at the surface (0.5) butterscotch-brown.
      const dk = 0.35 + 0.65 * hz.airFrac;                              // clear-air colour dims with the gas column above
      const dR = COL.dark[0] * dk, dG = COL.dark[1] * dk, dB = COL.dark[2] * dk;
      const Fz = 1 - Math.exp(-hz.tauAbove);
      const zR = dR + (hR - dR) * Fz, zG = dG + (hG - dG) * Fz, zB = dB + (hB - dB) * Fz;

      // palette (lavender) selection
      if (skyMix > 0) {
        const pn = look.skyPalette === 'puc' ? 'puc' : 'ruc';
        if (pn !== curPalName) { curPalName = pn; const pal = palettes[pn], dst = skyUniforms.uPal.value; for (let i = 0; i < 7; i++) dst[i].copy(pal[i]); }
      }
      skyUniforms.uSkyGain.value = look.skyGain !== undefined ? look.skyGain : 1;

      // dust colour: true (per panel) blended with the video's lavender->rose->brown-pink ramp
      const pd = panelDustRGB(view && view.panelId);
      dustBase.setRGB(pd[0], pd[1], pd[2]);
      dustLavAt(dust, dustLavC);
      dustCol.copy(dustBase).lerp(dustLavC, skyMix);
      // lavender horizon colour (clean air) for skyMix > 0: bottom-middle of the ramp
      const pal0 = palettes[curPalName || 'ruc'];
      const lh = pal0[2];
      hazeCol.setRGB(hR + (lh.x - hR) * skyMix, hG + (lh.y - hG) * skyMix, hB + (lh.z - hB) * skyMix);
      fogCol.copy(hazeCol).lerp(dustCol, dustFrac);

      // ---- shared uniforms ------------------------------------------------------------------------------------------
      UNI.uFogColor.value.copy(fogCol);
      UNI.uFogDensity.value = dens;
      UNI.uHaze.value.set(0, P.dustScaleHeight, P.tau0 * P.hazeScale, camAlt);
      // ambient sky radiance for custom shaders (true colours, dust aware, independent of skyMix)
      const fill = 1 - dAmb;
      UNI.uSkyHorizon.value.setRGB(hR * fill + COL.dustOchre[0] * dAmb, hG * fill + COL.dustOchre[1] * dAmb, hB * fill + COL.dustOchre[2] * dAmb);
      UNI.uSkyZenith.value.setRGB(zR * fill + COL.dustOchre[0] * 0.8 * dAmb, zG * fill + COL.dustOchre[1] * 0.8 * dAmb, zB * fill + COL.dustOchre[2] * 0.8 * dAmb);
      UNI.uTime.value = t;

      // ---- sky uniforms --------------------------------------------------------------------------------------------
      const cd = P.marsRadius / (P.marsRadius + camAlt), sd = Math.sqrt(Math.max(1 - cd * cd, 0));
      skyUniforms.uDip.value.set(cd, sd);
      skyUniforms.uDark.value.setRGB(dR, dG, dB);
      skyUniforms.uTauAbove.value = hz.tauAbove;
      skyUniforms.uDustSky.value.copy(dustCol);
      skyUniforms.uDustA.value = dAlpha;
      skyUniforms.uAurGain.value = 0.25 + 0.75 * hz.skyFrac;
      skyUniforms.uSkyMix.value = skyMix;
      skyUniforms.uSunDiscRad.value = P.sunDiscRadiance;
      skyUniforms.uSunDiscAng.value = P.sunDiscAngularRadius;
      skyUniforms.uSunDisc.value = 1;

      // ---- fill light: env map (clean-air ground fill) scaled by altitude/dust, hemisphere carries the dust fill -----
      const envK = (0.5 + 0.5 * hz.skyFrac) * (1 - 0.6 * dAmb) * P.envIntensity;
      if (scene) {
        scene.environmentIntensity = envRT ? envK : 0;
        const fg = scene.fog;
        if (fg) { fg.color.copy(fogCol); fg.density = dens; }
      }
      // hemisphere: irradiance-carrying colours (pi * radiance)
      const hb = envRT ? P.hemiBase : Math.max(P.hemiBase, 0.28);      // without env map the hemisphere is the whole fill
      const hi = Math.PI * (hb * (1 - dAmb) + 0.55 * P.Lw0 * dAmb);
      hemi.intensity = hi;
      if (hi > 0) {
        const kA = envRT ? dAmb : 1;
        // sky colour: clean-air zenith/horizon mean, dust ochre when engulfed; ground: warm bounce
        hemi.color.setRGB(zR * (1 - dAmb) + COL.dustOchre[0] * dAmb, zG * (1 - dAmb) + COL.dustOchre[1] * dAmb, zB * (1 - dAmb) + COL.dustOchre[2] * dAmb);
        hemi.groundColor.setRGB(COL.ground[0] * 0.8 * (1 - dAmb) + COL.dustOchre[0] * 0.55 * dAmb, COL.ground[1] * 0.8 * (1 - dAmb) + COL.dustOchre[1] * 0.55 * dAmb, COL.ground[2] * 0.8 * (1 - dAmb) + COL.dustOchre[2] * 0.55 * dAmb);
        void kA;
      }

      // ---- shadow framing ------------------------------------------------------------------------------------------
      if (shadowEnabled) {
        const fc = override.focus || (view && view.focus) || null;
        let R = P.shadowDefaultRadius;
        if (fc && fc.pos) {
          const fp = fc.pos;
          if (Array.isArray(fp)) vFocus.set(fp[0], fp[1], fp[2]); else vFocus.set(fp.x, fp.y, fp.z);
          if (fc.radius > 0) R = fc.radius;
        } else {
          camera.getWorldDirection(vFwd);
          vFocus.copy(vCam).addScaledVector(vFwd, R * 0.6);
        }
        frameShadow(vFocus, Math.max(R, 0.5));
      }

      // ---- bookkeeping ------------------------------------------------------------------------------------------------
      cur.camAlt = camAlt; cur.dust = dust; cur.skyMix = skyMix; cur.fogDensity = dens; cur.tauNadir = hz.tauNadir;
      cur.sunGain = altGain; cur.dustAlpha = dAlpha; cur.envIntensity = envK;
      api.horizonColor.copy(fogCol);
    }

    function update(t, camera, view) {
      try { _update(t, camera, view); } catch (e) {
        if (!errOnce) { errOnce = true; console.error('[atmosphere] update failed: ' + (e && e.stack || e)); }
      }
    }

    /* ---------------------------------------------------------------------
     * CPU mirror of the (true-colour) sky, for other modules (translucent canopy tint, particles, ...):
     *   api.skyColor(dirVec3, outColor)  -> outColor (linear radiance) as currently rendered with skyMix = 0
     * ------------------------------------------------------------------- */
    function skyColor(dir, out) {
      out = out || new THREE.Color();
      const L = UNI.uSunDir.value, alt = cur.camAlt;
      const cd = P.marsRadius / (P.marsRadius + alt), sd = Math.sqrt(Math.max(1 - cd * cd, 0));
      const e = Math.max(-1, Math.min(1, dir.y));
      const sinAng = e * cd + Math.sqrt(Math.max(1 - e * e, 0)) * sd;
      const cg = Math.max(dir.x * L.x + dir.y * L.y + dir.z * L.z, 0);
      const F = 1 - Math.exp(-skyUniforms.uTauAbove.value / Math.max(sinAng, 0.015));
      const sunAmt = Math.pow(cg, 6) * 0.22;
      const sc = UNI.uSunColor.value, fc = UNI.uFogColor.value, dk = skyUniforms.uDark.value, dc = skyUniforms.uDustSky.value;
      const a = skyUniforms.uDustA.value, ag = skyUniforms.uAurGain.value;
      const aW = Math.pow(cg, 7), aM = 0.9 * Math.pow(cg, 90), aC = 3 * Math.pow(cg, 2500);
      const a1 = skyUniforms.uAur1.value, a2 = skyUniforms.uAur2.value;
      const sm = smoothstepJS(-0.004, 0.004, sinAng);
      const ch = (f0, s0, d0, dc0, w1, w2, wc) => {
        const haze0 = f0 + (s0 * 0.9 - f0) * sunAmt;
        const dark = d0 + (dc0 - d0) * a;
        let c = dark + (haze0 - dark) * F;
        c += ((w1 * aW + w2 * aM + wc * aC) * ag) * (1 - a * 0.85) * sm;
        return c;
      };
      return out.setRGB(ch(fc.r, sc.r, dk.r, dc.r, a1.r, a2.r, 1), ch(fc.g, sc.g, dk.g, dc.g, a1.g, a2.g, 0.97), ch(fc.b, sc.b, dk.b, dc.b, a1.b, a2.b, 0.9));
    }
    function smoothstepJS(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

    /* ---------------------------------------------------------------------
     * PUBLIC API
     * ------------------------------------------------------------------- */
    const api = {
      group,
      ready: Promise.resolve(),
      update,
      sky,                                   // THREE.Mesh (ShaderMaterial), renderOrder 1000 (drawn last, depth 1.0), never culled
      sunLight: sun,                         // THREE.DirectionalLight (shadow caster; target lives in group)
      hemiLight: hemi,                       // HemisphereLight (dust / fallback fill)
      exposureHint: 1.0,                     // EDL.Post exposure for daylight scenes (calibrated for ACES filmic, see notes)
      horizonColor: new THREE.Color().setRGB(...COL.horizon), // live: colour of the sky at the horizon == fully fogged ground (linear)
      params: P,                             // tunables (physical + artistic); safe to tweak at runtime
      colors: COL,                           // base palette (linear radiance)
      hazeAt,                                // hazeAt(altitude_m, out?) -> {rho, density, tauNadir, transmission, tauAbove, skyFrac, airFrac}
      skyColor,                              // skyColor(dirVec3, outColor?) -> linear radiance of the sky in that direction (true colours)
      setQuality(qq) {                       // 'high'|'medium'|'low' or a ctx.quality-like object
        if (typeof qq === 'string') qq = { level: qq, shadows: qq !== 'low', particles: 1, resolutionScale: 1 };
        applyQuality(qq);
      },
      setShadowMapSize(n) { api.allow4k = n > 2048; setShadowSize(n); },   // opt-in 4096 (128 MB!): memory budget
      allow4k: false,
      setToneMapModel(m) {                   // 'aces' (default; three ACESFilmic @ exposure 1) or 'none': how the lavender palette is pre-compensated
        toneModel = m === 'none' ? 'none' : 'aces'; rebuildPalettes(); curPalName = '';
      },
      override,                              // TEST HOOKS: {altitude, dust, skyMix, focus} (null = use live values)
      state: cur,                            // last computed values (camAlt, dust, fogDensity, sunGain, ...)
      envMap: () => (envRT ? envRT.texture : null),
      envBakeMs: () => envMs,
      fog: scene ? scene.fog : null,
      isAtmosphere: true,
    };
    EDL.hazeAt = hazeAt;                     // convenience: usable without ctx.modules
    applyQuality(quality);
    // consistent baseline (clear air, ground level) so that modules reading EDL.uniforms before the first update see sane values
    (function initUniforms() {
      const hz0 = hazeAt(0, haze);
      UNI.uSunDir.value.copy(C.sun.dir);
      sunTintNorm(cTmp); UNI.uSunColor.value.setRGB(cTmp.r * P.Lw0, cTmp.g * P.Lw0, cTmp.b * P.Lw0);
      UNI.uFogColor.value.setRGB(COL.horizon[0], COL.horizon[1], COL.horizon[2]);
      UNI.uFogDensity.value = hz0.density;
      UNI.uSkyHorizon.value.setRGB(COL.horizon[0], COL.horizon[1], COL.horizon[2]);
      UNI.uSkyZenith.value.setRGB(COL.zenith[0], COL.zenith[1], COL.zenith[2]);
      UNI.uHaze.value.set(0, P.dustScaleHeight, P.tau0 * P.hazeScale, 0);
      if (scene && scene.fog) { scene.fog.color.copy(UNI.uFogColor.value); scene.fog.density = hz0.density; }
    })();
    return api;
  });
})();
