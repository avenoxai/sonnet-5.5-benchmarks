'use strict';
// renderer_env.js — procedural environments + image based lighting for PG.Renderer.
//
// An environment is plain data registered in PG.envDefs:
//   PG.envDefs.<name> = {
//     label,                 // UI label
//     glsl,                  // GLSL defining  vec3 envRadiance(vec3 dir)  (dir = unit world direction, +Y up) -> linear HDR radiance
//     bg: { top, horizon, floor },    // linear RGB of the visible backdrop gradient (cyclorama); floor fades into bg.floor/horizon
//     floor: { albedo:[r,g,b], roughness, fadeStart, fadeEnd, poolRadius, poolMin },
//     exposure                // multiplier applied on top of renderer.settings.exposure (default 1)
//   }
// Stage B can add environments with PG.Renderer.registerEnvironment(name, def) at any time before r.setEnvironment(name).
//
// Per environment the renderer generates (lazily, cached):
//   * source cube 512^2 RGBA16F with full mip chain,
//   * GGX-prefiltered specular cube 512^2 (9 mips, mip i <-> perceptual roughness i/8, importance sampled with filtered lookups),
//   * cosine-convolved irradiance cube 32^2 (stored as E/pi so that diffuse = albedo * sample).
// The split-sum BRDF LUT (128^2 RG16F) is environment independent and generated once.
(function () {
  const PG = window.PG = window.PG || {};
  const RS = PG.RS;
  const Renderer = () => PG.Renderer;

  const defs = PG.envDefs = PG.envDefs || {};

  // ------------------------------------------------------------------------------------------------ definitions
  const GLSL_LIB = `
float pg_sdRect(vec2 p, vec2 hs) { vec2 q = abs(p) - hs; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float pg_soft(float d, float feather) { return 1.0 - smoothstep(-feather, feather, d); }
`;

  // Every definition may carry a key light:  light: { dir:[x,y,z] (env space, towards the light), irradiance:[r,g,b] (E at normal
  // incidence, linear), radius (angular, radians) }.  The GLSL must then wrap the key's own emitter in  #ifndef PG_NO_KEY ... #endif
  // so that the irradiance map is generated without it (the renderer adds it analytically, with shadows).
  // Optional bgEnv:[amount, lod] shows the (blurred) environment itself as the visible backdrop instead of the 3-colour gradient.
  defs.studio = {
    label: 'Studio',
    exposure: 1.0,
    bg: { top: [0.0040, 0.0042, 0.0050], horizon: [0.040, 0.042, 0.047], floor: [0.018, 0.0185, 0.021] },
    floor: { albedo: [0.075, 0.076, 0.082], roughness: 0.20, reflectivity: 1.0, reflBlur: 0.05, envReflect: 0.22, fadeStart: 5.5, fadeEnd: 28, poolRadius: 7.0, poolMin: 0.16 },
    light: { dir: [-0.9, 4.2, 1.35], irradiance: [5.2, 5.1, 4.95], radius: 0.13 },
    glsl: GLSL_LIB + `
vec3 envRadiance(vec3 d) {
  float up = d.y;
  vec3 wall = vec3(0.020, 0.0212, 0.024), ceilc = vec3(0.008, 0.0085, 0.010), flr = vec3(0.006, 0.0064, 0.0072);
  vec3 col = up > 0.0 ? mix(wall, ceilc, smoothstep(0.0, 0.8, up)) : mix(wall, flr, smoothstep(0.0, 0.5, -up));
  col += vec3(0.022, 0.023, 0.027) * exp(-abs(up) * 7.0);                       // haze band around the horizon
#ifndef PG_NO_KEY
  // KEY: big overhead softbox (elongated along the car, a little to the rear-right) -> clean highlight down roof, bonnet and haunches
  if (up > 0.02) {
    vec2 p = d.xz * (4.2 / up) - vec2(-0.9, 1.35);
    float m = pg_soft(pg_sdRect(p, vec2(3.3, 1.25)), 0.55);
    float g = 1.0 - 0.25 * clamp(length(p / vec2(3.3, 1.25)), 0.0, 1.4);
    col += vec3(1.0, 0.985, 0.955) * 8.5 * m * g;
  }
#endif
  // two long horizontal strip lights (5 m out, 2.3 m high, running the length of the car): shoulder-line highlights
  float az = abs(d.z);
  if (az > 0.03) {
    vec2 p = d.xy * (5.0 / az);
    float side = d.z > 0.0 ? 1.0 : 0.7;
    col += vec3(1.0, 0.99, 0.975) * 15.0 * side * pg_soft(pg_sdRect(p - vec2(0.2, 2.3), vec2(3.9, 0.19)), 0.11);
    col += vec3(0.96, 0.98, 1.0) * 4.5 * side * pg_soft(pg_sdRect(p - vec2(0.0, 0.42), vec2(3.3, 0.10)), 0.10);   // low strip: rocker / lower door line
    col += vec3(0.95, 0.97, 1.0) * 0.9 * side * pg_soft(pg_sdRect(p - vec2(0.0, 1.15), vec2(4.6, 0.95)), 0.8);   // broad dim panel: gentle gradient on doors
    // vertical strips near the corners (fender / bumper curvature)
    col += vec3(1.0, 0.99, 0.97) * 6.0 * pg_soft(pg_sdRect(p - vec2(-3.9, 1.5), vec2(0.20, 1.9)), 0.22);
    col += vec3(0.95, 0.97, 1.0) * 4.0 * pg_soft(pg_sdRect(p - vec2(4.3, 1.4), vec2(0.18, 1.6)), 0.25);
  }
  // warm kicker light behind the car (-x), low: lights the tail and wing
  if (d.x < -0.03) {
    vec2 p = d.zy * (6.5 / -d.x);
    col += vec3(1.0, 0.72, 0.5) * 3.2 * pg_soft(pg_sdRect(p - vec2(0.9, 1.6), vec2(0.6, 0.4)), 0.3);
  }
  // dim cool fill wall in front (+x)
  if (d.x > 0.03) {
    vec2 p = d.zy * (7.0 / d.x);
    col += vec3(0.72, 0.84, 1.0) * 0.8 * pg_soft(pg_sdRect(p - vec2(0.0, 1.2), vec2(4.0, 1.3)), 1.4);
  }
  // subtle floor bounce pool
  if (up < -0.02) { vec2 fp = d.xz * (1.0 / -up); col += vec3(0.075, 0.075, 0.08) * exp(-dot(fp, fp) / (2.0 * 3.8 * 3.8)); }
  return col;
}`,
  };

  defs.showroom = {
    label: 'Showroom',
    exposure: 0.9,
    bg: { top: [0.34, 0.35, 0.37], horizon: [0.74, 0.75, 0.78], floor: [0.50, 0.51, 0.53] },
    floor: { albedo: [0.56, 0.565, 0.58], roughness: 0.10, reflectivity: 1.0, reflBlur: 0.035, envReflect: 0.4, fadeStart: 9, fadeEnd: 46, poolRadius: 16.0, poolMin: 0.55 },
    light: { dir: [-0.12, 1.0, 0.16], irradiance: [3.0, 3.0, 3.05], radius: 0.30 },
    glsl: GLSL_LIB + `
vec3 envRadiance(vec3 d) {
  float up = d.y;
  vec3 col = mix(vec3(0.30, 0.305, 0.32), vec3(0.16, 0.165, 0.175), smoothstep(0.0, 0.9, abs(up)));
  if (up < 0.0) col = mix(col, vec3(0.34, 0.34, 0.35), smoothstep(0.0, 0.4, -up));
#ifndef PG_NO_KEY
  if (up > 0.02) {    // one huge soft overhead light: the key
    vec2 p = d.xz * (5.0 / up) - vec2(-0.6, 0.8);
    col += vec3(1.0, 0.99, 0.97) * 5.0 * pg_soft(pg_sdRect(p, vec2(4.6, 2.6)), 1.6);
  }
#endif
  if (up > 0.02) {     // ceiling light panels in a grid (outer ring)
    vec2 p = d.xz * (5.0 / up);
    vec2 g = abs(fract(p / vec2(2.6, 2.0) + 0.5) - 0.5) * vec2(2.6, 2.0);
    float panel = pg_soft(pg_sdRect(g, vec2(0.85, 0.55)), 0.12) * smoothstep(3.0, 6.5, length(p)) * smoothstep(11.0, 6.0, length(p));
    col += vec3(1.0, 0.99, 0.97) * 4.0 * panel;
  }
  float ax = abs(d.x), az = abs(d.z);
  if (ax > 0.03) {     // glowing walls front / back
    vec2 p = d.zy * (8.0 / ax);
    col += vec3(0.9, 0.95, 1.0) * 1.6 * pg_soft(pg_sdRect(p - vec2(0.0, 2.0), vec2(6.5, 1.6)), 1.2);
  }
  if (az > 0.03) {     // big soft windows left / right
    vec2 p = d.xy * (7.0 / az);
    col += vec3(1.0, 0.99, 0.97) * 2.6 * pg_soft(pg_sdRect(p - vec2(0.0, 2.2), vec2(5.0, 1.0)), 0.9);
  }
  return col;
}`,
  };

  defs.sunset = {
    label: 'Sunset',
    exposure: 1.0,
    bg: { top: [0.03, 0.045, 0.10], horizon: [0.55, 0.22, 0.08], floor: [0.08, 0.05, 0.045] },
    bgEnv: [1.0, 1.6],
    floor: { albedo: [0.16, 0.13, 0.11], roughness: 0.26, reflectivity: 1.0, reflBlur: 0.05, envReflect: 0.7, fadeStart: 7, fadeEnd: 34, poolRadius: 12.0, poolMin: 0.7 },
    light: { dir: [0.55, 0.2, -0.81], irradiance: [3.0, 1.66, 0.78], radius: 0.07 },
    glsl: GLSL_LIB + `
vec3 envRadiance(vec3 d) {
  float up = d.y;
  vec3 sunDir = normalize(vec3(0.55, 0.2, -0.81));
  vec3 zen = vec3(0.05, 0.085, 0.22), mid = vec3(0.50, 0.20, 0.22), hor = vec3(1.9, 0.62, 0.20);
  vec3 col = up > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.12, up)), zen, smoothstep(0.06, 0.48, up)) : mix(hor * 0.5, vec3(0.035, 0.028, 0.028), smoothstep(0.0, 0.30, -up));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.55, 0.22) * (pow(sd, 5.0) * 0.45 + pow(sd, 48.0) * 1.4);   // sky glow around the sun (part of the ambient light)
#ifndef PG_NO_KEY
  col += vec3(1.0, 0.56, 0.26) * 480.0 * smoothstep(0.9987, 0.9993, sd);        // the sun disc itself (angular radius ~0.045 rad)
#endif
  // a thin band of cloud catching the light, high in the sky opposite the sun
  float cl = smoothstep(0.30, 0.5, up) * smoothstep(0.75, 0.5, up) * (0.5 + 0.5 * sin(d.x * 9.0 + d.z * 5.0));
  col += vec3(0.9, 0.35, 0.22) * 0.5 * cl * smoothstep(-0.3, 0.6, dot(d, sunDir));
  return col;
}`,
  };

  defs.night = {
    label: 'Night',
    exposure: 1.8,
    bg: { top: [0.001, 0.0015, 0.004], horizon: [0.010, 0.014, 0.026], floor: [0.004, 0.005, 0.008] },
    bgEnv: [1.0, 1.4],
    floor: { albedo: [0.03, 0.03, 0.034], roughness: 0.13, reflectivity: 1.0, reflBlur: 0.04, envReflect: 0.8, fadeStart: 5, fadeEnd: 26, poolRadius: 8.0, poolMin: 0.25 },
    light: { dir: [0.10, 1.0, -0.22], irradiance: [0.55, 0.68, 1.0], radius: 0.22 },
    glsl: GLSL_LIB + `
float pg_h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 envRadiance(vec3 d) {
  float up = d.y;
  vec3 col = mix(vec3(0.012, 0.018, 0.04), vec3(0.003, 0.005, 0.012), smoothstep(0.0, 0.7, abs(up)));
  col += vec3(0.01, 0.012, 0.02) * exp(-abs(up) * 8.0);
  // distant city skyline: lit windows behind the horizon (they turn into bokeh in the blurred backdrop and small glints on the paint)
  if (up > -0.02 && up < 0.30) {
    float a = atan(d.z, d.x) * 57.29578;                        // degrees
    float cellA = floor(a / 2.2), h = 0.04 + 0.16 * pg_h1(cellA * 1.7 + 3.0) * pg_h1(floor(a / 9.0) + 11.0);
    if (up < h) {
      vec2 w = vec2(fract(a / 2.2 * 2.0), fract(up / 0.011));
      float lit = step(0.62, pg_h1(floor(a / 2.2 * 2.0) * 31.0 + floor(up / 0.011) * 7.0 + cellA));
      float win = pg_soft(pg_sdRect(w - 0.5, vec2(0.30, 0.28)), 0.12) * lit;
      vec3 wc = mix(vec3(1.0, 0.72, 0.38), vec3(0.6, 0.8, 1.0), step(0.7, pg_h1(cellA + floor(up / 0.011))));
      col = mix(col, vec3(0.004, 0.006, 0.012), 0.85) + wc * 2.2 * win;
    }
  }
  float ax = abs(d.x), az = abs(d.z);
  if (ax > 0.03) {   // street lamps (sodium, warm) along the x walls
    vec2 p = d.zy * (7.0 / ax);
    float m = pg_soft(pg_sdRect(p - vec2(-1.5, 3.4), vec2(0.5, 0.12)), 0.15) + pg_soft(pg_sdRect(p - vec2(3.0, 3.1), vec2(0.4, 0.1)), 0.15);
    col += vec3(1.0, 0.62, 0.28) * 22.0 * m * step(0.0, d.x);
  }
  if (az > 0.03) {   // long neon strips: magenta left, cyan right
    vec2 p = d.xy * (6.0 / az);
    vec3 nc = d.z > 0.0 ? vec3(0.15, 0.55, 1.0) : vec3(1.0, 0.15, 0.45);
    col += nc * 12.0 * pg_soft(pg_sdRect(p - vec2(-1.0, 1.6), vec2(0.12, 2.0)), 0.1);
    col += nc * 6.0 * pg_soft(pg_sdRect(p - vec2(0.3, 0.9), vec2(3.6, 0.07)), 0.07);       // low horizontal tube
  }
#ifndef PG_NO_KEY
  if (up > 0.02) { vec2 p = d.xz * (5.0 / up) - vec2(0.5, -1.1); col += vec3(0.7, 0.8, 1.0) * 3.0 * pg_soft(pg_sdRect(p, vec2(2.4, 0.7)), 0.5); }
#endif
  return col;
}`,
  };

  PG.Renderer.registerEnvironment = function (name, def) { defs[name] = def; };

  // ------------------------------------------------------------------------------------------------ generation
  const P = () => PG.Renderer.prototype;

  // The generator programs are compiled once and kept for the lifetime of the renderer (a handful of small programs). Deleting them
  // right after use made Chrome log 'GL_INVALID_VALUE: glGetProgramiv: Program object expected' (async link-status polling of a
  // deleted program, KHR_parallel_shader_compile), which must never appear in the console.
  function keep(r, key, vs, fs, label) {
    const c = r._envProgs || (r._envProgs = {});
    return c[key] || (c[key] = r._makeProgram(vs, fs, label, false));
  }

  function makeCube(gl, size, levels) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, gl.RGBA16F, size, size);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Split-sum BRDF LUT (x = N.V, y = roughness) -> (scale, bias) of F0. Generated once.
  P()._genBrdfLut = function () {
    const gl = this.gl, N = 128;
    const prog = this._makeProgram(PG.glu.FULLSCREEN_VS, RS.brdfLut, 'brdfLut', false);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, N, N);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, N, N); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(prog.prog); gl.bindVertexArray(this._emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo);
    return tex;
  };

  // Generation is a JS generator that yields between GPU stages, so it can run synchronously (setEnvironment) or spread over
  // several animation frames (setEnvironmentAsync) without freezing the UI. Total GPU work: ~15-200 ms per environment.
  P()._envSteps = function* (name) {
    const gl = this.gl, def = defs[name];
    const t0 = performance.now();
    const SRC = 512, SPEC_LEVELS = 9, IRR = 32, ISRC = 128;
    const fbo = gl.createFramebuffer();
    const begin = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
      gl.bindVertexArray(this._emptyVao); gl.activeTexture(gl.TEXTURE0);
    };
    const renderFaces = (tex, size, level, uFace) => {
      for (let f = 0; f < 6; f++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, level);
        gl.viewport(0, 0, size, size); gl.uniform1i(uFace, f); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
    // 1) radiance function -> source cube (all mips) and spec cube level 0
    begin();
    const src = makeCube(gl, SRC, 10), spec = makeCube(gl, SRC, SPEC_LEVELS), irr = makeCube(gl, IRR, 1);
    const genProg = keep(this, 'gen\u0001' + def.glsl, PG.glu.FULLSCREEN_VS, RS.envGen(def.glsl), 'env:' + name);
    gl.useProgram(genProg.prog);
    const uFaceG = gl.getUniformLocation(genProg.prog, 'uFace');
    renderFaces(src, SRC, 0, uFaceG); renderFaces(spec, SRC, 0, uFaceG);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, src); gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    yield;
    // 2) GGX prefilter chain (one level per step)
    const pf = keep(this, 'prefilter', PG.glu.FULLSCREEN_VS, RS.prefilter, 'prefilter');
    for (let l = 1; l < SPEC_LEVELS; l++) {
      begin(); gl.useProgram(pf.prog);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, src);
      gl.uniform1i(pf.u.uSrc, 0); gl.uniform1f(pf.u.uSrcRes, SRC);
      const size = Math.max(1, SRC >> l);
      gl.uniform1f(pf.u.uRough, l / (SPEC_LEVELS - 1)); gl.uniform1i(pf.u.uSamples, l < 3 ? 160 : 256);
      renderFaces(spec, size, l, pf.u.uFace);
      if (l === 2 || l === 5) yield;
    }
    yield;
    // 3) irradiance: cosine convolution of the environment WITHOUT its key light (that one is added analytically, with shadows)
    begin();
    const isrc = makeCube(gl, ISRC, 8);
    const noKey = keep(this, 'nokey\u0001' + def.glsl, PG.glu.FULLSCREEN_VS, RS.envGen(def.glsl, '#define PG_NO_KEY\n'), 'envNoKey:' + name);
    gl.useProgram(noKey.prog);
    renderFaces(isrc, ISRC, 0, gl.getUniformLocation(noKey.prog, 'uFace'));
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, isrc); gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    const ip = keep(this, 'irradiance', PG.glu.FULLSCREEN_VS, RS.irradiance, 'irradiance');
    gl.useProgram(ip.prog);
    gl.uniform1i(ip.u.uSrc, 0); gl.uniform1f(ip.u.uLod, 2); gl.uniform1i(ip.u.uRes, 32);   // ISRC mip 2 = 32^2 per face
    renderFaces(irr, IRR, 0, ip.u.uFace);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo);
    gl.deleteTexture(isrc);
    gl.bindVertexArray(null);
    gl.deleteTexture(src);
    const env = { name, def, spec, irr, maxLod: SPEC_LEVELS - 1, ms: performance.now() - t0 };
    this._envCache[name] = env;
    PG.log(`environment "${name}" generated in ${env.ms.toFixed(0)} ms`);
    return env;
  };

  // Build (or fetch from cache) the IBL set for an environment (synchronously).
  P()._buildEnvironment = function (name) {
    if (!defs[name]) throw new Error('unknown environment "' + name + '"');
    if (this._envCache[name]) return this._envCache[name];
    const g = this._envSteps(name); let r;
    do { r = g.next(); } while (!r.done);
    return r.value;
  };

  // Switch environment. Generates it on first use (synchronously, ~15-200 ms). Returns the environment record.
  P().setEnvironment = function (name) {
    const env = this._buildEnvironment(name);
    this.env = env; this.envName = name; this._envReq = name;
    return env;
  };
  // Same, but the generation is spread over several animation frames; the old environment stays until the new one is ready.
  // Resolves with the environment record (or null if a newer request superseded this one).
  P().setEnvironmentAsync = async function (name) {
    if (!defs[name]) throw new Error('unknown environment "' + name + '"');
    this._envReq = name;
    if (!this._envCache[name]) {
      const g = this._envSteps(name); let r;
      do { await PG.util.nextFrame(); r = g.next(); } while (!r.done);
    }
    if (this._envReq !== name) return null;
    const env = this._envCache[name]; this.env = env; this.envName = name;
    return env;
  };
  P().listEnvironments = function () { return Object.keys(defs); };
})();
