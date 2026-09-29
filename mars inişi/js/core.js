/* ============================================================================
 * core.js  —  shared namespace, constants, math/noise helpers, module registry
 * Classic script (no ES modules) so that index.html works from file://.
 * Load order: vendor/three.bundle.js -> js/core.js -> other js/*.js -> js/main.js
 * ========================================================================== */
(function () {
  'use strict';
  const THREE = window.THREE;
  const EDL = (window.EDL = window.EDL || {});
  EDL.THREE = THREE;

  /* -------------------------------------------------------------------------
   * CONSTANTS  (SI units: metres, seconds, kilograms, radians unless noted)
   * Everything that more than one module must agree on lives here.
   * Numbers marked TODO-CAL are refined after the video analysis and may
   * change; modules must read them from EDL.C at call time (not hard-code).
   * ----------------------------------------------------------------------- */
  const C = (EDL.C = {});

  // ---- world ---------------------------------------------------------------
  // Right-handed, Y up, metres. Origin = rover touchdown point on the ground
  // (terrain.heightAt(0,0) === 0 by construction). +X = east, -Z = north.
  // Mars: surface gravity 3.71 m/s^2.
  C.g = 3.71;
  C.world = {
    half: 12000,        // detailed terrain patch is [-half, +half] in X and Z (24 km x 24 km); far ring beyond
    seaLevelY: 0,       // ground at the touchdown point is y = 0
    // --- the video-derived terrain (orthomosaics of the RDC frames) defines the world axes: see _work/WORLD.md ---
    // BA (bundle-adjustment) frame of _work/analysis/ddc_motion.json: X = mosaic right, Y = mosaic up, Z = altitude, metres for U = 9500 m/unit.
    // world (three.js) x = k*(X - X0), y = k*Z, z = -k*(Y - Y0)   with k = mosaicScale, (X0,Y0) = rover ground position at t = 168 s (touchdown point).
    mosaicScale: 1.165,               // k: official-altitude fit (official/BA altitude ratios 1.05..1.36, geometric mean 1.165)
    baOrigin: [-228.7, 116.9],        // (X0, Y0) in BA metres
    northRotationDeg: 16,             // az_world = az_true + 16 deg (clockwise from -Z); mosaic-up = true bearing 344 deg
  };
  // BA-frame point -> world (three.js) vector components. altM may be omitted (0).
  C.world.baToWorld = function (Xm, Ym, altM, out) {
    const k = C.world.mosaicScale, o = C.world.baOrigin;
    out = out || new THREE.Vector3();
    return out.set(k * (Xm - o[0]), k * (altM || 0), -k * (Ym - o[1]));
  };
  // True compass bearing (deg clockwise from north) + distance -> world (x,z) offset from the touchdown point
  C.world.bearingToWorld = function (bearingDeg, dist, out) {
    const a = ((bearingDeg + C.world.northRotationDeg) * Math.PI) / 180;
    out = out || new THREE.Vector3();
    return out.set(Math.sin(a) * dist, 0, -Math.cos(a) * dist);
  };

  // ---- sun / sky (atmosphere module owns the look; others read direction) ---
  C.sun = {
    // unit vector FROM the ground TOWARD the sun, in the WORLD frame (= the video-derived terrain mosaic frame, see _work/WORLD.md).
    // True Jezero geometry at touchdown (15:53 LMST, 18 Feb 2021): elevation 39.6 deg, azimuth 257 deg clockwise from true north.
    // The mosaic 'up' direction is true bearing 344 deg, i.e. azimuth_world = azimuth_true + 16 deg (clockwise from -Z):
    // 273 deg  =>  horizontal (sin a, -cos a) = (-0.9986, -0.0523);  x=-0.769  y=0.637  z=-0.040.  Shadows fall toward +X (right in the mosaic).
    dir: new THREE.Vector3(-0.769, 0.637, -0.040).normalize(),
    color: 0xfff1dc,
    elevationDeg: 39.6,
  };

  // ---- simulation clock ------------------------------------------------------
  // Simulation time t == VIDEO time in seconds (0 .. duration). The video is the
  // ground truth for when things happen. tPlus (mission elapsed time since
  // entry interface) = t + C.t.tPlusAtVideo0 and is used only for display.
  C.t = {
    duration: 216.0,            // 0..205 = the video's timeline; 205..216 = 3D epilogue (descent-stage crash, settling dust)
    videoDuration: 205.0,
    // --- key events in VIDEO seconds (from the analysis; see _work/analysis/hardware_and_edl_facts.md sec.8) ---
    chuteDeploy: 12.85,       // mortar fire (white-out flash in the PUC real-time panel)
    chuteRound: 14.4,         // canopy round / full inflation  (peak load at ~14.5)
    puc30End: 27.5,           // PUC panels end (video mode)
    heatShieldSep: 30.84,     // physical release (RDC first frame 30.93 already 0.35 m from the shield)
    radarLock: 65.4,          // TDS ground solution (icon 3 pops at 74.6)
    lvsValid: 106.9,
    mlePriming: 115.3,
    backshellSep: 125.4,      // icon 4 pops at 125.367
    mleIgnition: 126.4,
    divertStart: 127.7,
    constVelStart: 157.4,     // 32.2 m/s straight down at ~255 m
    decelStart: 161.7,
    throttleDown: 167.6,      // ~22 m, 1 m/s
    skyCraneStart: 169.7,     // rover released, bridle pays out (icon 6 pops at 170.167)
    bridleOut: 175.65,        // bridle fully paid out (7.6 m)
    touchdown: 185.8,         // first wheel contact (0.75 m/s)
    touchdownDetected: 186.7, // RDC/DDC panels fade to black 186.37-186.60
    bridleCut: 187.4,         // pyro cutters fire
    flyaway: 187.8,           // descent stage lights up and leaves (icon 7 pops at 188.067)
    dsOutOfRuc: 189.9,
    mccCut: 192.8,            // video cuts to Mission Control (not reproduced in 3D)
    // Mission elapsed time (E+, seconds since entry interface) = tPlusChute + T_c, where T_c = seconds since mortar fire.
    tPlusChute: 240.6,
  };

  // ---- body frames ------------------------------------------------------------
  // All bodies of the entry vehicle share the SAME orientation while stacked.
  // "Stack frame": +Y points from the heat shield toward the parachute (i.e. UP
  // under the canopy), the heat shield nose is at -Y. Rover is upright (wheels
  // toward -Y, i.e. toward the heat shield). X/Z are arbitrary but fixed: rover
  // local +X (forward) == stack +X, rover local +Z (right) == stack +Z.
  //
  // Local origins (each module builds its geometry around these origins) and the
  // fixed offsets of each origin from the STACK ORIGIN, expressed in the stack
  // frame (metres). Stack origin = centre of the rover chassis while stowed.
  C.stack = {
    rover:        { origin: [0, 0, 0] },               // rover chassis centre
    descentStage: { origin: [0, 2.10, 0] },            // deck centre of descent stage
    backshell:    { origin: [0, 2.10, 0] },            // centre of the backshell BASE ring plane (same plane as DS deck centre, roughly)
    heatShield:   { origin: [0, -0.95, 0] },           // centre of the heat-shield rim plane
    chuteAttach:  { origin: [0, 4.30, 0] },            // where the bridle attaches on the backshell apex/cone
    // Descent stage bridle winch points and rover anchors are defined by those modules
    // and exposed at runtime (see ARCHITECTURE.md "anchors").
  };

  // ---- rover ----------------------------------------------------------------
  C.rover = {
    length: 3.0, width: 2.7, height: 2.2, mass: 1025,
    wheelDiameter: 0.525,
    // distance from rover origin DOWN to the plane touching the wheels once the
    // mobility system is fully deployed (used by flight for touchdown height).
    groundOffset: 1.35,        // TODO-CAL by rover module (must keep this in sync)
  };

  // ---- entry vehicle sizes ----------------------------------------------------
  C.aeroshell = {
    diameter: 4.5,             // heat-shield / backshell base diameter
  };
  C.chute = {
    diameter: 21.5,            // disk-gap-band canopy
    lines: 80,
    lineLength: 32.0,          // suspension lines (m) — TODO-CAL by chute module
    bridleLength: 6.0,         // riser/bridle between canopy confluence and backshell
  };
  C.ds = {
    bridleLength: 7.6,         // sky-crane bridle length
    engines: 8,
  };

  /* -------------------------------------------------------------------------
   * MATH / UTILITY
   * ----------------------------------------------------------------------- */
  const U = (EDL.util = {});
  U.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  U.saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.invLerp = (a, b, v) => (v - a) / (b - a);
  U.remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
  U.smoothstep = (a, b, x) => {
    const t = U.saturate((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  U.smootherstep = (a, b, x) => {
    const t = U.saturate((x - a) / (b - a));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  U.easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  U.easeOut = (t) => 1 - (1 - t) * (1 - t);
  U.easeIn = (t) => t * t;
  U.mix = U.lerp;
  U.deg = (r) => (r * 180) / Math.PI;
  U.rad = (d) => (d * Math.PI) / 180;
  U.TAU = Math.PI * 2;

  // Deterministic PRNG (mulberry32). rng = U.rng(seed); rng() in [0,1)
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // Integer hash -> [0,1)
  U.hash1 = function (n) {
    let h = Math.imul(n | 0, 374761393) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  U.hash2 = function (x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((seed | 0) + 1, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  U.hashStr = function (s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };

  // 2D value noise (smooth, ~[0,1]) and fBm — CPU side, deterministic.
  U.valueNoise2 = function (x, y, seed) {
    seed = seed | 0;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = U.hash2(xi, yi, seed), b = U.hash2(xi + 1, yi, seed);
    const c = U.hash2(xi, yi + 1, seed), d = U.hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  U.fbm2 = function (x, y, oct, seed, lac, gain) {
    oct = oct || 5; lac = lac || 2.0; gain = gain || 0.5;
    let amp = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * U.valueNoise2(x * f, y * f, (seed | 0) + i * 101);
      norm += amp; amp *= gain; f *= lac;
    }
    return s / norm;
  };
  // 3D value noise
  U.valueNoise3 = function (x, y, z, seed) {
    seed = seed | 0;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const h = (i, j, k) => U.hash2(i + Math.imul(k, 7919), j + Math.imul(k, 104729), seed);
    const x00 = U.lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u);
    const x10 = U.lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
    const x01 = U.lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u);
    const x11 = U.lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
    return U.lerp(U.lerp(x00, x10, v), U.lerp(x01, x11, v), w);
  };

  /**
   * Track: keyframe interpolation of a scalar or array-valued quantity vs time.
   *   const tr = new EDL.util.Track([[0, 1], [10, 5]], {mode:'linear'|'smooth'|'cubic'})
   *   tr.at(t)       -> number            (scalar keys)
   *   tr.at(t, out)  -> Array (out reused) (array keys, [t, [a,b,c]])
   * Values clamp outside the key range. 'cubic' = monotone cubic Hermite (no overshoot).
   */
  U.Track = class Track {
    constructor(keys, opts) {
      const k = keys.slice().sort((a, b) => a[0] - b[0]);
      this.mode = (opts && opts.mode) || 'linear';
      this.isArr = Array.isArray(k[0][1]);
      this.nc = this.isArr ? k[0][1].length : 1;
      this.n = k.length;
      this.t = new Float64Array(this.n);
      this.v = new Float64Array(this.n * this.nc);
      for (let i = 0; i < this.n; i++) {
        this.t[i] = k[i][0];
        for (let j = 0; j < this.nc; j++) this.v[i * this.nc + j] = this.isArr ? k[i][1][j] : k[i][1];
      }
      this.m = null;
      if (this.mode === 'cubic' && this.n > 1) this._tangents();
      this._i = 0;
    }
    _tangents() {
      const { n, nc, t, v } = this;
      const m = (this.m = new Float64Array(n * nc));
      for (let j = 0; j < nc; j++) {
        const d = new Float64Array(n - 1);
        for (let i = 0; i < n - 1; i++) d[i] = (v[(i + 1) * nc + j] - v[i * nc + j]) / (t[i + 1] - t[i] || 1);
        m[j] = d[0];
        m[(n - 1) * nc + j] = d[n - 2];
        for (let i = 1; i < n - 1; i++) m[i * nc + j] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) * 0.5;
        for (let i = 0; i < n - 1; i++) {
          if (d[i] === 0) { m[i * nc + j] = 0; m[(i + 1) * nc + j] = 0; continue; }
          const al = m[i * nc + j] / d[i], be = m[(i + 1) * nc + j] / d[i], s = al * al + be * be;
          if (s > 9) { const tau = 3 / Math.sqrt(s); m[i * nc + j] = tau * al * d[i]; m[(i + 1) * nc + j] = tau * be * d[i]; }
        }
      }
    }
    _seg(x) {
      const { t, n } = this;
      if (x <= t[0]) return 0;
      if (x >= t[n - 1]) return n - 2;
      let i = this._i;
      if (!(i >= 0 && i < n - 1 && t[i] <= x && x < t[i + 1])) {
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= x) lo = mid; else hi = mid; }
        i = lo;
      }
      this._i = i;
      return i;
    }
    _comp(i, u, h, j) {
      const nc = this.nc, a = this.v[i * nc + j], b = this.v[(i + 1) * nc + j];
      if (this.mode === 'cubic') {
        const m0 = this.m[i * nc + j] * h, m1 = this.m[(i + 1) * nc + j] * h;
        const u2 = u * u, u3 = u2 * u;
        return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * m1;
      }
      return a + (b - a) * u;
    }
    at(x, out) {
      if (this.n === 1) return this.isArr ? Array.from(this.v) : this.v[0];
      const i = this._seg(x);
      const h = this.t[i + 1] - this.t[i];
      let u = U.clamp((x - this.t[i]) / h, 0, 1);
      if (this.mode === 'smooth') u = u * u * (3 - 2 * u);
      if (!this.isArr) return this._comp(i, u, h, 0);
      const r = out || new Array(this.nc);
      for (let j = 0; j < this.nc; j++) r[j] = this._comp(i, u, h, j);
      return r;
    }
  };

  /** Canvas helper. draw(ctx2d, w, h) paints; returns THREE.CanvasTexture (sRGB unless opts.linear). */
  U.canvasTexture = function (w, h, draw, opts) {
    opts = opts || {};
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    draw(g, w, h);
    const tex = new THREE.CanvasTexture(cv);
    if (!opts.linear) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.anisotropy = opts.anisotropy || 8;
    tex.needsUpdate = true;
    return tex;
  };

  /**
   * Load an image into a texture. IMPORTANT: the app must run from file://, where Chrome blocks
   * fetch/XHR and refuses to upload file:// images to WebGL (SecurityError). Therefore ONLY
   * data: URIs work. Embed image assets as base64 in assets/*.js files that assign
   * EDL.data['name'] = 'data:image/jpeg;base64,...' (use _work/tools/embed_asset.py) and load
   * with EDL.util.loadTexture(EDL.data.name). Procedural canvas textures are always fine.
   */
  U.loadTexture = function (url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        if (!opts.linear) tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.anisotropy = opts.anisotropy || 8;
        tex.needsUpdate = true;
        resolve(tex);
      };
      img.onerror = () => reject(new Error('texture failed: ' + url));
      img.src = url;
    });
  };

  /** Largest 16:9 rectangle centred in a w x h window (CSS px): {x,y,w,h}. Video mode lays its panels out inside it. */
  U.stageRect = function (w, h) {
    const ar = 16 / 9;
    let sw = w, sh = w / ar;
    if (sh > h) { sh = h; sw = h * ar; }
    return { x: (w - sw) / 2, y: (h - sh) / 2, w: sw, h: sh };
  };

  // Reusable temporaries (avoid per-frame allocation)
  U.tmp = {
    v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
    q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), m1: new THREE.Matrix4(), m2: new THREE.Matrix4(),
    e1: new THREE.Euler(), c1: new THREE.Color(),
  };

  /** Apply a flight-state body pose ({pos:[x,y,z], quat:[x,y,z,w]}) to an Object3D. */
  U.applyPose = function (obj, pose) {
    obj.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    obj.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
  };

  /** Convert a hex colour (sRGB) to a linear-space THREE.Color, for shader uniforms. */
  U.srgbColor = function (hex) { return new THREE.Color(hex); }; // THREE.Color already converts sRGB hex -> linear working space

  /* -------------------------------------------------------------------------
   * MODULE REGISTRY
   *   EDL.registerModule('terrain', function factory(ctx){ ...; return api; });
   * main.js (or harness.js) instantiates modules in EDL.MODULE_ORDER, giving each
   * `ctx` with the modules created so far in ctx.modules.
   * api shape (all optional except update): see ARCHITECTURE.md
   * ----------------------------------------------------------------------- */
  EDL.registry = {};
  EDL.registerModule = function (name, factory) {
    if (EDL.registry[name]) console.warn('[EDL] module re-registered:', name);
    EDL.registry[name] = factory;
  };
  EDL.MODULE_ORDER = [
    'flight', 'atmosphere', 'terrain', 'rover', 'descentStage', 'capsule',
    'parachute', 'fx', 'cameras',
  ];
  // DOM-only modules created by main.js after the 3D scene is ready:
  EDL.UI_MODULES = ['hud', 'audio'];

  EDL.createModules = function (ctx, names, onProgress) {
    ctx.modules = ctx.modules || {};
    const list = names || EDL.MODULE_ORDER;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const f = EDL.registry[n];
      if (!f) { console.warn('[EDL] module missing:', n); continue; }
      const t0 = performance.now();
      ctx.modules[n] = f(ctx);
      const dt = performance.now() - t0;
      console.log('[EDL] module ' + n + ' ready in ' + dt.toFixed(0) + ' ms');
      if (onProgress) onProgress(n, (i + 1) / list.length);
    }
    return ctx.modules;
  };

  // async module init hook: a module api may expose `ready` (Promise) for textures
  EDL.whenReady = function (modules) {
    return Promise.all(Object.values(modules).map((m) => (m && m.ready) || null));
  };

  /* tiny event emitter: EDL.bus.on('event', fn); EDL.bus.emit('event', payload) */
  EDL.bus = (function () {
    const h = {};
    return {
      on(n, f) { (h[n] = h[n] || []).push(f); },
      off(n, f) { h[n] = (h[n] || []).filter((x) => x !== f); },
      emit(n, p) { (h[n] || []).forEach((f) => f(p)); },
    };
  })();

  /* -------------------------------------------------------------------------
   * SHARED UNIFORMS + GLSL CHUNKS
   * Custom ShaderMaterials should do:  uniforms: Object.assign({ myOwn: {value: ...} }, EDL.uniforms)
   * and include EDL.glsl.fog (and optionally EDL.glsl.noise) in their GLSL, then finish the fragment colour with
   *   gl_FragColor.rgb = edlFog(gl_FragColor.rgb, distanceToCamera, normalize(worldPos - cameraPosition));
   * The atmosphere module updates these values every update().
   * ----------------------------------------------------------------------- */
  EDL.uniforms = {
    uSunDir: { value: C.sun.dir.clone() },
    uSunColor: { value: new THREE.Color(C.sun.color) },
    uSkyZenith: { value: new THREE.Color(0x7d8fb0) },
    uSkyHorizon: { value: new THREE.Color(0xe2b993) },
    uFogColor: { value: new THREE.Color(0xd4a684) },
    uFogDensity: { value: 0.000012 },            // exp density per metre
    uHaze: { value: new THREE.Vector4(0, 9000, 0.5, 0) }, // x: start altitude, y: scale height (m), z: strength, w: camera altitude (m)
    uTime: { value: 0 },
  };
  EDL.glsl = {
    noise: /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float hash31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1.0,0.0)), c=hash21(i+vec2(0.0,1.0)), d=hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float n000=hash31(i), n100=hash31(i+vec3(1,0,0)), n010=hash31(i+vec3(0,1,0)), n110=hash31(i+vec3(1,1,0));
  float n001=hash31(i+vec3(0,0,1)), n101=hash31(i+vec3(1,0,1)), n011=hash31(i+vec3(0,1,1)), n111=hash31(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y), mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z); }
float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise2(p); p=p*2.03+17.1; a*=0.5; } return s; }
float fbm3(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise3(p); p=p*2.03+17.1; a*=0.5; } return s; }
`,
    fog: /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon;
uniform vec3 uFogColor; uniform float uFogDensity; uniform vec4 uHaze; uniform float uTime;
// Aerial perspective: dist in metres, rd = normalised view ray direction (camera -> fragment).
vec3 edlFog(vec3 col, float dist, vec3 rd){
  float f = 1.0 - exp(-uFogDensity * dist);
  float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 6.0);
  vec3 fc = mix(uFogColor, uSunColor * 0.9, sunAmt * 0.22);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`,
  };

  // Data blobs / embedded assets live here (assets/*.js write into it before modules are created)
  EDL.data = EDL.data || {};

  EDL.query = new URLSearchParams(window.location.search);
})();
