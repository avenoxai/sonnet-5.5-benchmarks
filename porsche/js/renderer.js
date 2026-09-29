'use strict';
// renderer.js — PG.Renderer, PG.Material, PG.mats (WebGL2 physically based forward renderer).   FINAL API REFERENCE (stage B)
//
// Files: renderer.js (this file: API, parts, frame loop) · renderer_shaders.js (GLSL, PG.RS) · renderer_env.js (environments + IBL)
//        · renderer_passes.js (key-light shadow map, planar floor reflection, floor, quality control). renderer.js loads the other
//        three itself (document.write, paths resolved from document.currentScript, works from tools/ too).
//
// ============================================================================================================
// FRAME PIPELINE  (r.render(dt))
//   world matrices + bounds -> draw lists (frustum culled; opaque sorted by program/material, transparent back-to-front)
//   -> contact-occlusion bake (top-down height map, only when casters moved) -> key-light SHADOW MAP (ortho, PCSS-lite sampling)
//   -> PLANAR REFLECTION pass (mirrored camera, half-res RGBA16F + ray distance) -> MAIN pass (4x MSAA RGBA16F): backdrop, floor,
//   opaque, transparent -> resolve -> dual-filter BLOOM -> tone map (ACES-like, saturation preserving) + vignette + grain + dither.
//   Lighting = image based lighting from a procedural environment (prefiltered GGX cube, irradiance cube, BRDF LUT) + ONE analytic
//   key light with soft shadows (the environment's main softbox / sun is excluded from the irradiance map and added analytically).
//
// ============================================================================================================
// PUBLIC API
// ============================================================================================================
//   const r = new PG.Renderer(canvas, opts?);      // throws Error with a readable message when WebGL2 / float RTs are missing
//                                                  //   opts.preserveDrawingBuffer (default false)
//   await r.init(progress?)                        // progress(label, frac); shaders, BRDF LUT, IBL of the current environment (~30-400 ms)
//   r.gl, r.canvas, r.width, r.height (device px), r.dpr, r.ready, r.lost, r.gpuName, r.initMs, r.iblMs
//   r.resize(w?, h?, dpr?)                         // CSS px + device pixel ratio (capped by settings.maxDpr = 2). No args: measure the canvas.
//   r.pixelRatio(devicePixelRatio, cssW?, cssH?)   // the ratio resize() will use (call it to detect when a resize is needed)
//   r.setCamera(eye:[x,y,z], target:[x,y,z], fovDeg, {near?, far?}?)     // near 0.02..0.12 m (from distance), far 250 when omitted
//   r.setOrtho(eye, target, halfHeight, {up?, near?, far?}?)          // TRUE orthographic projection (modelling aid): halfHeight = half the visible
//                                                  // vertical extent in METRES, width follows the aspect. eye only gives the view direction (and the view
//                                                  // vector of the shading: keep it 50-100 m away). near/far default to eye distance -/+ 25 m (whole car).
//                                                  // Pass up:[0,0,1] for a top view. Any later setCamera() returns to perspective. r.cam.ortho tells which.
//                                                  // (app.js drives it: PG_APP.setCamera({ortho:true, view:'side'|'top'|'front'|'rear', scale, target}), presets oside otop ofront orear.)
//   r.upload(mesh) -> GPUMesh                      // mesh = {positions, normals?, uvs?, attrs?, indices?} (ARCHITECTURE.md section 4)
//        GPUMesh: {vao, count, indexType, vertexCount, triCount, bounds:{min,max,center,radius}, hasUV, hasAttr, dispose(),
//                  subset(indices) -> GPUMesh sharing the vertex buffers but drawing only those triangles (window glass etc.)}
//   r.addPart({name, mesh|GPUMesh|null, material, matrix, parent, visible=true, castShadow=true, receiveShadow=true,
//              reflect=true, renderOrder=0}) -> Part
//        Part (mutable): name, matrix (Float32Array16, LOCAL, may be mutated every frame), parent (Part), visible, castShadow,
//        receiveShadow, reflect (drawn into the floor reflection), renderOrder (sorts BEFORE depth/material; also orders
//        transparents), material, gpu. Read-only: world (Float32Array16, valid after a render/updateWorld), id.
//        A part without mesh is a pure transform group. A hidden parent hides its children. world = parent.world * matrix.
//        castShadow only takes effect for OPAQUE materials with material.castShadow (glass / additive never cast).
//   r.removePart(part)                             // also removes descendants
//   r.findParts(prefix) -> Part[]                  // name prefix match
//   r.filter = null | (part)=>bool                 // per-part visibility filter (app.js uses it for only= / hide=)
//   r.render(dt)                                   // dt in seconds (advances r.time -> uTime). One call = one frame.
//   r.updateWorld()                                // recompute world matrices + bounds now (render does it too)
//   r.whenProgramsReady() -> Promise               // resolves when all submitted shader programs are compiled and linked
//   r.readPixels()                                 // RGBA8 snapshot of the last frame (tests)
//   r.time, r.timeOverride (number freezes uTime; null = live)
//   r.stats = { draws, tris, parts, cpuMs, gpuMs (EMA, EXT_disjoint_timer_query when available), frame, shadowDraws, reflDraws }
//       draws/tris count the MAIN pass only; shadowDraws / reflDraws count the extra passes.
//
//   ENVIRONMENTS   r.setEnvironment(name)                 synchronous (first use of a name generates its IBL: 15-200 ms; cached after)
//                  r.setEnvironmentAsync(name) -> Promise  same, spread over ~5 frames (UI never freezes); resolves null if superseded
//                  r.listEnvironments() -> ['studio','showroom','sunset','night', ...custom]      r.envName, r.env
//                  PG.Renderer.registerEnvironment(name, def)   def format: see renderer_env.js
//                    { label, exposure, glsl:'vec3 envRadiance(vec3 dir){...}', bg:{top,horizon,floor}, bgEnv:[amount,lod]?,
//                      floor:{albedo, roughness, reflectivity, reflBlur, envReflect, fadeStart, fadeEnd, poolRadius, poolMin},
//                      light:{dir, irradiance:[r,g,b], radius}? }     (wrap the key emitter of glsl in #ifndef PG_NO_KEY ... #endif)
//                  Built in: 'studio' (default: dark cyclorama, big overhead softbox, two long strip lights, low strips, corner
//                  strips, warm kicker), 'showroom' (bright white cyclorama, huge soft overhead light, window walls), 'sunset'
//                  (low warm sun with shadows, sky gradient shown as backdrop, warm tinted floor), 'night' (dark blue city
//                  skyline bokeh backdrop, neon strips, sodium lamps, cool top light).
//
//   QUALITY        r.setQuality('low'|'medium'|'high'|'ultra') -> r   (high = default)   r.listQualities()   r.quality  r.qualityLevel
//                    low   : msaa 0, shadowSize 1024, reflectionScale 0.35     medium: msaa 2, 2048, 0.4
//                    high  : msaa 4, shadowSize 2048, reflectionScale 0.5      ultra : msaa 4, 4096, 0.75
//                  settings.adaptive (default true; app.js turns it off in shot mode): after ~90 slow frames (> 26 ms, in a row
//                  or nearly) the renderer steps down: reflectionScale 0.4 -> shadowSize 1024 -> msaa 2 + maxDpr 1.5 ->
//                  msaa 0 + reflectionScale 0.3 -> maxDpr 1. Never steps up. (app.js calls r.pixelRatio() so resizes follow.)
//
//   r.settings (all live, mutable at any time)
//     exposure 1            multiplier on top of the environment's own exposure
//     bloom 0.16            bloom strength (0 = off, skips the pass)       bloomThreshold 1.6   scene-linear radiance where bloom starts
//     vignette 0.28         grain 0.012 (film grain amplitude)            saturation 1.0   contrast 1.0 (about middle grey, scene linear)
//     shadows true          key-light shadow map + contact occlusion (floor AO, tyre/underbody AO). false = key light unshadowed.
//     keyLight true         analytic key light on/off (off: IBL only)     keyIntensity 1   shadowSoftness 1 (multiplies the light radius)
//     shadowSize 2048       shadow map resolution (px, square)            shadowHz 30   max refresh rate while casters animate
//                           (casters that only rotate in place, e.g. wheels, refresh at half that)
//     shadowFit null        {min:[x,y,z],max:[x,y,z]} world box to fit the shadow map to (default: union of visible caster AABBs)
//     reflections true      planar floor reflection                       reflectionScale 0.5   reflection target size / screen size
//     floorReflection 1     0..1 strength of the floor's mirror term      floor true   draw the studio floor
//     envIntensity 1        envRotation 0 (deg, spins the environment AND its key light)      showEnv false|true|lod+1  show raw environment
//     msaa 4                0|2|4|8 (clamped to hardware)                 adaptive true      maxDpr 2   cap of the canvas pixel ratio     maxPixels 4.5e6   cap of the canvas size in device pixels
//     occlusionStrength 1   occlusionRect null | [minX,minZ,maxX,maxZ]   world rectangle of the contact-occlusion map
//                           (default = PG.spec.bounds + 1.3 m margin)
//     debug ''              'normals'|'ao'|'albedo'|'wire'|'reflect'|'view'        debugFloor ''  'refl'|'shadow'|'ao'|'dist' (floor only)
//                           'silhouette': flat dark-grey (sRGB 63) unlit car on a plain white background: no floor, shadow, environment, bloom,
//                           vignette, grain or dithering; MSAA is forced to at least 8x (so edges are exact for pixel measurements, see tools/profile.js).
//                           'zebra': every part (glass too) shows black/white zebra stripes of its perfect-mirror reflection vector on a mid-grey
//                           background, unlit (surface continuity check). Stripes are cones about settings.zebraAxis (world, default (0.555,0.832,0), a
//                           diagonal that shows curvature breaks on flanks and on the bonnet), settings.zebraStripes (default 24) stripes per 180 degrees,
//                           edges anti-aliased over about 1.5 px. Hook normal perturbations (bumps) show up too.
//
// ============================================================================================================
// PG.Material  new PG.Material({...}); materials are LIVE (read every frame): mutate any field any time.
//   name 'material'         baseColor [r,g,b] LINEAR (use PG.util.hex('#rrggbb'))   default [0.8,0.8,0.8]
//   metallic 0              roughness 0.5 (perceptual)                specular 0.5 (dielectric F0 = 0.16 * specular^2 -> 0.04)
//   clearcoat 0 (0..1)      clearcoatRoughness 0.04                   real second GGX lobe, own Fresnel, sees hook normal perturbation
//   emissive [0,0,0]        emissiveIntensity 1                       added after lighting, blooms above bloomThreshold
//   alpha 1                 blend 'opaque'|'alpha'|'add'              alpha: premultiplied, sorted back to front, no depth write;
//                                                                     the specular / reflection is NOT dimmed by alpha (glass)
//   doubleSided false       true: both faces, back faces get Frag.front == false and a flipped normal. blend 'alpha' + doubleSided
//                           draws back faces then front faces. Never culled in the mirror pass either.
//   flake 0 (0..1)          metallic flake glints (view dependent, pixel-sized cells, subtle)
//   pattern 'none'|'carbon'|'alcantara'|'knurl'|'brushed'   patternScale 0 (cells per uv unit if the mesh has uvs, else per metre; 0 = default)
//   envIntensity 1          unlit false (baseColor + emissive only)   castShadow true   aoFromAttr true (x mesh attrs.x, the SDF baked AO)
//   hook ''                 GLSL, see below                           uniforms {name: number|[..]|Float32Array|WebGLTexture}
//   clone(overrides) -> Material         derive(overrides) -> Material (LIVE: non-overridden fields keep following the parent, e.g.
//   PG.mats.paint.derive({hook, doubleSided:true}) still recolours from the UI)     isTransparent (getter)
// PG.mats       shared library (plain data): paint paintAccent carbonTwill carbonMatte plasticBlack plasticGloss rubber tire glass
//               glassLens chrome aluminum wheel discCeramic discIron caliper alcantara leather fabricBlack redLight whiteLED
//               amberLED meshBlack rubberSeal paintedBlackMetal mag   (app.js recolours paint / wheel live)
//
// SURFACE HOOK (GLSL) — customise a material per fragment (masks, decals, weave, lettering). Provide `void surfaceHook(inout Surf s, in Frag f)`
//   plus any helper functions / `uniform`s (float/int/vecN/matN/sampler2D/samplerCube/sampler3D, fed from material.uniforms; texture units 8+).
//   struct Surf { vec3 baseColor; float metallic; float roughness; float clearcoat; float clearcoatRoughness; vec3 emissive;
//                 float alpha; float ao; vec3 normal /*OBJECT space, keep unit*/; float flake; float specular; bool discardFrag; };
//   struct Frag { vec3 pObj; vec3 nObj /*flipped for back faces*/; vec2 uv; vec4 attr; bool front; vec3 pW; vec3 nW; vec3 vW /*to eye*/;
//                 float fw /*pixel footprint in object units: smoothstep(-fw, fw, d) gives 1-px AA masks*/; };
//   uniform float uTime, uHeadlights, uBrake, uDrs;   // always available (re-declaring them in a hook is harmless, it is stripped)
//   Helpers you may use: pg_hash12(vec2), pg_hash33(vec3), pg_vnoise(vec2), pg_vnoise3(vec3). Every other identifier starting with
//   `pg` is internal — do not declare names with that prefix. Surf starts from the material values (then built-in pattern, then your hook).
//   Object space = the part's local mesh space. The hook also runs in the floor-reflection pass. A hook that fails to compile is
//   logged and the material silently falls back to its hook-less version (stays visible).
//
// Coordinates: +X forward, +Y up, +Z car's right. The floor is the plane y = 0 (nothing renders below it; parts are clipped in the mirror).
// ============================================================================================================
(function () {
  const PG = window.PG = window.PG || {};

  // ---- load the split-out code (executes right after this file, before the next <script> of the page)
  (function () {
    const cs = document.currentScript; const base = cs && cs.src ? cs.src.replace(/renderer\.js(\?.*)?$/, '') : 'js/';
    for (const f of ['renderer_shaders.js', 'renderer_env.js', 'renderer_passes.js']) document.write('<script src="' + base + f + '"><\/script>');
  })();

  // ==========================================================================================================
  // Material
  // ==========================================================================================================
  let matCounter = 1;
  class Material {
    constructor(o) {
      o = o || {};
      this.id = matCounter++;
      this.name = o.name || 'material';
      this.baseColor = o.baseColor ? o.baseColor.slice() : [0.8, 0.8, 0.8];
      this.metallic = o.metallic !== undefined ? o.metallic : 0;
      this.roughness = o.roughness !== undefined ? o.roughness : 0.5;
      this.clearcoat = o.clearcoat || 0;
      this.clearcoatRoughness = o.clearcoatRoughness !== undefined ? o.clearcoatRoughness : 0.04;
      this.emissive = o.emissive ? o.emissive.slice() : [0, 0, 0];
      this.emissiveIntensity = o.emissiveIntensity !== undefined ? o.emissiveIntensity : 1;
      this.alpha = o.alpha !== undefined ? o.alpha : 1;
      this.blend = o.blend || 'opaque';           // 'opaque' | 'alpha' | 'add'
      this.doubleSided = !!o.doubleSided;
      this.specular = o.specular !== undefined ? o.specular : 0.5;
      this.flake = o.flake || 0;
      this.pattern = o.pattern || 'none';         // 'none'|'carbon'|'alcantara'|'knurl'|'brushed'
      this.patternScale = o.patternScale || 0;    // cells per uv unit (mesh has uvs) or per metre; 0 = pattern default
      this.envIntensity = o.envIntensity !== undefined ? o.envIntensity : 1;
      this.unlit = !!o.unlit;
      this.hook = o.hook || '';
      this.uniforms = o.uniforms || {};
      this.castShadow = o.castShadow !== undefined ? o.castShadow : true;
      this.aoFromAttr = o.aoFromAttr !== undefined ? o.aoFromAttr : true;
    }
    clone(over) { const m = new Material(this); if (over) Object.assign(m, over); m.baseColor = (over && over.baseColor || this.baseColor).slice(); m.emissive = (over && over.emissive || this.emissive).slice(); m.uniforms = Object.assign({}, this.uniforms, over && over.uniforms); m.id = matCounter++; return m; }
    // LIVE derived material: every field that is not overridden keeps following `this` (so a body variant that only adds a hook and
    // doubleSided still recolours when the UI mutates PG.mats.paint). Assigning a field on the derived material detaches that field.
    //   const bodyPaint = PG.mats.paint.derive({ name: 'bodyPaint', hook: '...', doubleSided: true });
    derive(over) {
      over = over || {};
      const parent = this, d = new Material(this);
      const own = new Set(['id', 'uniforms']);
      for (const k of Object.keys(over)) { d[k] = over[k]; own.add(k); }
      if (over.baseColor) d.baseColor = over.baseColor.slice();
      if (over.emissive) d.emissive = over.emissive.slice();
      if (!over.name) d.name = this.name + '.derived';
      d.uniforms = Object.assign({}, this.uniforms, over.uniforms);
      for (const k of Object.keys(d)) {
        if (own.has(k) || k[0] === '_') continue;
        Object.defineProperty(d, k, {
          configurable: true, enumerable: true,
          get() { return parent[k]; },
          set(v) { Object.defineProperty(d, k, { value: v, writable: true, configurable: true, enumerable: true }); },
        });
      }
      d.parentMaterial = parent;
      return d;
    }
    get isTransparent() { return this.blend !== 'opaque'; }
  }
  PG.Material = Material;

  // ==========================================================================================================
  // Material library (linear colours)
  // ==========================================================================================================
  const hex = PG.util.hex;
  const M = o => new Material(o);
  PG.mats = {
    paint: M({ name: 'paint', baseColor: hex('#c8102e'), metallic: 0.0, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.035, flake: 0, specular: 0.5 }),
    paintAccent: M({ name: 'paintAccent', baseColor: hex('#e9eaec'), metallic: 0.0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.035 }),
    carbonTwill: M({ name: 'carbonTwill', baseColor: hex('#232326'), metallic: 0, roughness: 0.33, clearcoat: 1, clearcoatRoughness: 0.03, pattern: 'carbon', specular: 0.55 }),
    carbonMatte: M({ name: 'carbonMatte', baseColor: hex('#232326'), metallic: 0, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.32, pattern: 'carbon', specular: 0.5 }),
    plasticBlack: M({ name: 'plasticBlack', baseColor: hex('#2e2e30'), roughness: 0.5, specular: 0.4 }),
    plasticGloss: M({ name: 'plasticGloss', baseColor: hex('#141416'), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, specular: 0.5 }),
    rubber: M({ name: 'rubber', baseColor: hex('#2a2a2b'), roughness: 0.86, specular: 0.3 }),
    tire: M({ name: 'tire', baseColor: hex('#262627'), roughness: 0.78, specular: 0.3 }),
    glass: M({ name: 'glass', baseColor: hex('#04090b'), roughness: 0.02, specular: 0.5, envIntensity: 0.55, blend: 'alpha', alpha: 0.80, doubleSided: true, castShadow: false }),
    glassLens: M({ name: 'glassLens', baseColor: hex('#d8e4ea'), roughness: 0.02, specular: 0.5, blend: 'alpha', alpha: 0.10, doubleSided: true, castShadow: false }),
    chrome: M({ name: 'chrome', baseColor: [0.93, 0.93, 0.95], metallic: 1, roughness: 0.05 }),
    aluminum: M({ name: 'aluminum', baseColor: [0.91, 0.92, 0.93], metallic: 1, roughness: 0.34, pattern: 'brushed' }),
    wheel: M({ name: 'wheel', baseColor: hex('#1a1a1c'), metallic: 0.9, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.12 }),
    discCeramic: M({ name: 'discCeramic', baseColor: hex('#2a2a2c'), metallic: 0.55, roughness: 0.46, specular: 0.5 }),
    discIron: M({ name: 'discIron', baseColor: [0.36, 0.35, 0.34], metallic: 1, roughness: 0.45, pattern: 'brushed' }),
    caliper: M({ name: 'caliper', baseColor: hex('#f2c200'), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    alcantara: M({ name: 'alcantara', baseColor: hex('#2c2c31'), roughness: 0.95, specular: 0.25, pattern: 'alcantara' }),
    leather: M({ name: 'leather', baseColor: hex('#3a2e27'), roughness: 0.48, specular: 0.4, clearcoat: 0.15, clearcoatRoughness: 0.35 }),
    fabricBlack: M({ name: 'fabricBlack', baseColor: hex('#28282a'), roughness: 0.95, specular: 0.2 }),
    redLight: M({ name: 'redLight', baseColor: hex('#300506'), roughness: 0.2, emissive: [1.0, 0.025, 0.012], emissiveIntensity: 1.6, clearcoat: 0.6, clearcoatRoughness: 0.05,
      hook: 'void surfaceHook(inout Surf s, in Frag f) { s.emissive *= 0.45 + 2.4 * uBrake; }' }),
    whiteLED: M({ name: 'whiteLED', baseColor: [0.9, 0.92, 0.95], roughness: 0.2, emissive: [1.0, 0.96, 0.9], emissiveIntensity: 3.0,
      hook: 'void surfaceHook(inout Surf s, in Frag f) { s.emissive *= uHeadlights; }' }),
    amberLED: M({ name: 'amberLED', baseColor: hex('#402000'), roughness: 0.25, emissive: [1.0, 0.42, 0.03], emissiveIntensity: 1.5 }),
    meshBlack: M({ name: 'meshBlack', baseColor: hex('#1c1c1e'), roughness: 0.65, specular: 0.35 }),
    rubberSeal: M({ name: 'rubberSeal', baseColor: hex('#232324'), roughness: 0.72, specular: 0.3 }),
    paintedBlackMetal: M({ name: 'paintedBlackMetal', baseColor: hex('#1e1e21'), metallic: 0.55, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.1 }),
    mag: M({ name: 'mag', baseColor: [0.62, 0.63, 0.62], metallic: 1, roughness: 0.48, pattern: 'brushed', patternScale: 0 }),
  };

  // ==========================================================================================================
  // GPU mesh / Part
  // ==========================================================================================================
  class GPUMesh {
    constructor(gl, mesh) {
      this.gl = gl;
      const pos = mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions);
      const n = pos.length / 3;
      let nor = mesh.normals ? (mesh.normals instanceof Float32Array ? mesh.normals : new Float32Array(mesh.normals)) : null;
      let idx = mesh.indices || null;
      if (idx && !(idx instanceof Uint32Array) && !(idx instanceof Uint16Array)) idx = new Uint32Array(idx);
      if (!nor) nor = GPUMesh.computeNormals(pos, idx);
      this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
      this.buffers = [];
      const attr = (loc, data, size) => {
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); this.buffers.push(b);
      };
      attr(0, pos, 3); attr(1, nor, 3);
      this.hasUV = !!(mesh.uvs && mesh.uvs.length >= n * 2);
      this.hasAttr = !!(mesh.attrs && mesh.attrs.length >= n * 4);
      if (this.hasUV) attr(2, mesh.uvs instanceof Float32Array ? mesh.uvs : new Float32Array(mesh.uvs), 2);
      if (this.hasAttr) attr(3, mesh.attrs instanceof Float32Array ? mesh.attrs : new Float32Array(mesh.attrs), 4);
      if (idx) {
        this.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        this.count = idx.length; this.indexType = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; this._idx = idx;
      } else { this.ibo = null; this.count = n; this.indexType = 0; }
      gl.bindVertexArray(null);
      this.vertexCount = n; this.triCount = Math.floor(this.count / 3);
      // bounds
      let x0 = 1e30, y0 = 1e30, z0 = 1e30, x1 = -1e30, y1 = -1e30, z1 = -1e30;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      if (!n) { x0 = y0 = z0 = x1 = y1 = z1 = 0; }
      const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      this.bounds = { min: [x0, y0, z0], max: [x1, y1, z1], center: c, radius: Math.hypot(x1 - c[0], y1 - c[1], z1 - c[2]) };
      this._pos = null; this._wire = null; this._posCPU = pos;
    }
    // A new GPUMesh that SHARES this mesh's vertex buffers but draws only the given triangles (indices into the same vertex array,
    // Uint32Array|Uint16Array|Array). Use it for materials that only cover a part of a big mesh (window glass, decals, trim):
    // drawing the whole body mesh a second time just to discard 98% of it in a hook costs a full extra pass of triangles.
    // dispose() of the subset frees only its own VAO / index buffer.
    subset(indices) {
      const gl = this.gl, o = Object.create(GPUMesh.prototype), src0 = this.sharedBuffers || this.buffers;
      let idx = indices; if (!(idx instanceof Uint32Array) && !(idx instanceof Uint16Array)) idx = new Uint32Array(idx);
      if (idx instanceof Uint32Array && this.vertexCount <= 65535) idx = new Uint16Array(idx);
      o.gl = gl; o.vao = gl.createVertexArray(); gl.bindVertexArray(o.vao);
      o.buffers = []; o.sharedBuffers = src0; o._posCPU = this._posCPU;
      const sizes = [3, 3, 2, 4], src = this.sharedBuffers || this.buffers;      // (a subset of a subset shares the original buffers)
      for (let i = 0; i < src.length; i++) {
        const loc = i === 2 && !this.hasUV ? 3 : i;      // attribute locations: 0 pos, 1 normal, 2 uv (if any), 3 attr (if any)
        gl.bindBuffer(gl.ARRAY_BUFFER, src[i]); gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, sizes[loc], gl.FLOAT, false, 0, 0);
      }
      o.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      o.count = idx.length; o.indexType = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT; o._idx = idx;
      o.hasUV = this.hasUV; o.hasAttr = this.hasAttr; o.vertexCount = this.vertexCount; o.triCount = Math.floor(o.count / 3);
      o._pos = null; o._wire = null;
      // bounds of the used vertices only (needs positions: kept by upload() on the parent when available)
      const P = this._posCPU;
      if (P) {
        let x0 = 1e30, y0 = 1e30, z0 = 1e30, x1 = -1e30, y1 = -1e30, z1 = -1e30;
        for (let k = 0; k < idx.length; k++) { const v = idx[k] * 3, x = P[v], y = P[v + 1], z = P[v + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        if (!idx.length) x0 = y0 = z0 = x1 = y1 = z1 = 0;
        const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
        o.bounds = { min: [x0, y0, z0], max: [x1, y1, z1], center: c, radius: Math.hypot(x1 - c[0], y1 - c[1], z1 - c[2]) };
      } else o.bounds = this.bounds;
      return o;
    }
    static computeNormals(pos, idx) {
      const nor = new Float32Array(pos.length), tri = idx ? idx.length / 3 : pos.length / 9;
      for (let t = 0; t < tri; t++) {
        const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
        const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const i of [a, b, c]) { nor[i * 3] += nx; nor[i * 3 + 1] += ny; nor[i * 3 + 2] += nz; }
      }
      for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
      return nor;
    }
    // line-list VAO for the wire debug view (built lazily)
    wire() {
      if (this._wire) return this._wire;
      const gl = this.gl, tri = this.triCount, src = this._idx;
      const li = new Uint32Array(tri * 6);
      for (let t = 0; t < tri; t++) {
        const a = src ? src[t * 3] : t * 3, b = src ? src[t * 3 + 1] : t * 3 + 1, c = src ? src[t * 3 + 2] : t * 3 + 2;
        li.set([a, b, b, c, c, a], t * 6);
      }
      const ibo = gl.createBuffer();
      gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, li, gl.STATIC_DRAW);
      // Element buffer binding is VAO state: restore the original after the draw via wireDraw
      this._wire = { ibo, count: li.length };
      if (this.ibo) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); else gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.bindVertexArray(null);
      return this._wire;
    }
    dispose() {
      const gl = this.gl; gl.deleteVertexArray(this.vao); this.buffers.forEach(b => gl.deleteBuffer(b)); this._posCPU = null; if (this.ibo) gl.deleteBuffer(this.ibo);
      if (this._wire) gl.deleteBuffer(this._wire.ibo);
    }
  }
  PG.GPUMesh = GPUMesh;

  let partCounter = 1;
  class Part {
    constructor(def) {
      this.id = partCounter++;
      this.name = def.name || ('part' + this.id);
      this.gpu = null; this.material = def.material || null;
      this.matrix = def.matrix instanceof Float32Array ? def.matrix : (def.matrix ? new Float32Array(def.matrix) : PG.m4.identity());
      this.parent = def.parent || null;
      this.visible = def.visible !== false;
      this.castShadow = def.castShadow !== false;
      this.receiveShadow = def.receiveShadow !== false;
      this.reflect = def.reflect !== false;
      this.renderOrder = def.renderOrder || 0;
      this.world = PG.m4.identity();
      this.normalMat = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      this.flip = false; this.wcx = 0; this.wcy = 0; this.wcz = 0; this.wr = 0;
      this._stamp = -1; this._changed = true; this._depth = 0; this._key = 0;
      this.module = def.module || null;
    }
  }
  PG.Part = Part;

  // ==========================================================================================================
  // Renderer
  // ==========================================================================================================
  const BUILTIN_SAMPLERS = { pgSpecEnv: 0, pgIrrEnv: 1, pgBrdf: 2, pgOccl: 3, pgShadowMap: 4, pgShadowDepth: 5, pgReflTex: 6, pgReflDist: 7 };
  const BLEND = { opaque: 0, alpha: 1, add: 2 };
  const PATTERNS = { carbon: 'PG_PAT_CARBON', alcantara: 'PG_PAT_ALCANTARA', knurl: 'PG_PAT_KNURL', brushed: 'PG_PAT_BRUSHED' };
  const DEBUG_MODES = { normals: 1, ao: 2, albedo: 3, wire: 4, reflect: 5, view: 6, silhouette: 7, zebra: 8 };
  const RESERVED_UNIFORMS = ['uTime', 'uHeadlights', 'uBrake', 'uDrs'];

  // Remove hook re-declarations of the renderer-provided global uniforms (they are prepended by the renderer).
  function sanitizeHook(src) {
    if (!src) return '';
    return src.replace(/^[ \t]*uniform\s+(?:(?:highp|mediump|lowp)\s+)?float\s+([^;]+);[ \t]*$/gm, (m, list) => {
      const names = list.split(',').map(s => s.trim()).filter(Boolean);
      const keep = names.filter(n => !RESERVED_UNIFORMS.includes(n));
      if (keep.length === names.length) return m;
      return keep.length ? 'uniform float ' + keep.join(', ') + ';' : '';
    });
  }

  class Renderer {
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU/browser does not support rendering to floating-point textures (EXT_color_buffer_float).');
      gl.getExtension('EXT_color_buffer_half_float'); gl.getExtension('OES_texture_float_linear'); gl.getExtension('EXT_float_blend');
      this.parallel = gl.getExtension('KHR_parallel_shader_compile');
      this.timerExt = /[?&]notimer=1/.test(location.search) ? null : gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
      this.settings = {
        exposure: 1, bloom: 0.16, bloomThreshold: 1.6, vignette: 0.28, grain: 0.012, saturation: 1.0, contrast: 1.0,
        shadows: true, reflections: true, floor: true, keyLight: true, keyIntensity: 1, shadowSoftness: 1, shadowFit: null,
        envIntensity: 1, envRotation: 0, showEnv: false, debug: '', msaa: 4, occlusionStrength: 1, occlusionRect: null, shadowHz: 30,
        shadowSize: 2048, reflectionScale: 0.5, floorReflection: 1, adaptive: true, maxDpr: 2, maxPixels: 4.5e6,
        zebraStripes: 24, zebraAxis: [0.5547, 0.8321, 0],
      };
      this.qualityLevel = 0; this.quality = 'high';
      this.parts = []; this.filter = null;
      this.time = 0; this.timeOverride = null; this.frame = 0;
      this.stats = { draws: 0, tris: 0, parts: 0, cpuMs: 0, gpuMs: undefined, frame: 0 };
      this.width = 1; this.height = 1; this.dpr = 1;
      this.cam = { eye: [0, 1, 6], target: [0, 0.5, 0], fov: 32, near: 0.05, far: 200, aspect: 1, ortho: false, halfHeight: 1, up: [0, 1, 0] };
      this.view = new Float32Array(16); this.proj = new Float32Array(16); this.viewProj = new Float32Array(16);
      this.planes = new Float32Array(24);
      this._progs = new Map(); this._pending = []; this._envCache = {};
      this._opaque = []; this._trans = []; this._tmpM = new Float32Array(16); this._frameId = 0; this._passId = 0;
      this._targets = null; this.lost = false; this.ready = false;
      this.env = null; this.envName = 'studio';
      this._occl = null; this._occlSig = -1; this._occlDirty = true;
      this._customUnitCache = [];
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; PG.log('WebGL context lost'); if (this.onContextLost) this.onContextLost(); }, false);
      canvas.addEventListener('webglcontextrestored', () => { PG.log('WebGL context restored'); if (this.onContextRestored) this.onContextRestored(); }, false);
    }

    // ---------------------------------------------------------------- shader programs
    // Compiles + links without blocking when KHR_parallel_shader_compile is present. `defer=false` forces immediate validation.
    _makeProgram(vsSrc, fsSrc, label, defer) {
      const gl = this.gl;
      const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
      const P = { label, prog: gl.createProgram(), vs: mk(gl.VERTEX_SHADER, vsSrc), fs: mk(gl.FRAGMENT_SHADER, fsSrc), vsSrc, fsSrc, ready: false, failed: false, u: null, all: null, stamp: -1, pass: -1, id: this._progs.size + 1 };
      gl.attachShader(P.prog, P.vs); gl.attachShader(P.prog, P.fs); gl.linkProgram(P.prog);
      if (defer && this.parallel) this._pending.push(P); else this._finishProgram(P);
      return P;
    }
    _finishProgram(P) {
      const gl = this.gl;
      if (!gl.getProgramParameter(P.prog, gl.LINK_STATUS)) {
        P.failed = true;
        for (const [sh, src, nm] of [[P.vs, P.vsSrc, 'VERTEX'], [P.fs, P.fsSrc, 'FRAGMENT']]) {
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const numbered = src.split('\n').map((l, i) => (i + 1).toString().padStart(4) + ' ' + l).join('\n');
            console.error(`[shader:${P.label}] ${nm} compile error:\n${gl.getShaderInfoLog(sh)}\n${numbered.length > 24000 ? numbered.slice(0, 24000) + '\n...' : numbered}`);
          }
        }
        console.error(`[program:${P.label}] link error: ${gl.getProgramInfoLog(P.prog)}`);
        if (!P.deferred) throw new Error('program failed: ' + P.label);
        return;
      }
      gl.deleteShader(P.vs); gl.deleteShader(P.fs);
      const u = {}, all = {}, n = gl.getProgramParameter(P.prog, gl.ACTIVE_UNIFORMS);
      let unit = 8;
      gl.useProgram(P.prog);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(P.prog, i); const name = info.name.replace(/\[0\]$/, '');
        const loc = gl.getUniformLocation(P.prog, info.name);
        const rec = { loc, type: info.type, size: info.size, unit: -1 };
        if (info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_CUBE || info.type === gl.SAMPLER_3D || info.type === gl.SAMPLER_2D_SHADOW) {
          rec.unit = BUILTIN_SAMPLERS[name] !== undefined ? BUILTIN_SAMPLERS[name] : unit++;
          gl.uniform1i(loc, rec.unit);
        }
        u[name] = loc; all[name] = rec;
      }
      P.u = u; P.all = all; P.ready = true;
    }
    _programReady(P) {
      if (P.ready) return true; if (P.failed) return false;
      if (this.parallel && !this.gl.getProgramParameter(P.prog, this.parallel.COMPLETION_STATUS_KHR)) return false;
      this._finishProgram(P);
      const i = this._pending.indexOf(P); if (i >= 0) this._pending.splice(i, 1);
      return P.ready;
    }
    // Resolves when every submitted program has finished compiling.
    whenProgramsReady() {
      return new Promise(res => {
        const poll = () => {
          for (let i = this._pending.length - 1; i >= 0; i--) this._programReady(this._pending[i]);
          if (!this._pending.length) res(); else setTimeout(poll, 8);
        };
        poll();
      });
    }

    // Program for a material (variant key: pattern + hook source). Cached on the material.
    _materialProgram(m) {
      if (m._prog && m._cPat === m.pattern && m._cHook === m.hook) return m._prog;
      m._prog = this._variant(m.pattern, m.hook, m.name); m._cPat = m.pattern; m._cHook = m.hook;
      return m._prog;
    }
    _variant(pattern, hookSrc, name) {
      const key = pattern + '\u0001' + hookSrc;
      let P = this._progs.get(key);
      if (!P) {
        const defs = PATTERNS[pattern] ? '#define ' + PATTERNS[pattern] + '\n' : '';
        const hook = sanitizeHook(hookSrc);
        const hasHook = /surfaceHook\s*\(/.test(hook);
        const fs = '#version 300 es\n' + defs + 'precision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp samplerCube;\nprecision highp sampler2DShadow;\n' + PG.RS.fsHead +
          '\n// ---- renderer uniforms\n' + PG.RS.fsUniforms + '\n// ---- surface hook\n' + (hasHook ? hook : 'void surfaceHook(inout Surf s, in Frag f) {}') + '\n' + PG.RS.fsPatterns + PG.RS.fsMain;
        P = this._makeProgram(PG.RS.VS, fs, 'surface:' + name + (pattern !== 'none' ? '/' + pattern : ''), true);
        P.deferred = true; P.pattern = pattern; P.hasHook = !!hookSrc; this._progs.set(key, P);
      }
      return P;
    }
    // A material whose hook failed to compile keeps rendering without its hook (visible, but plain) instead of vanishing.
    _fallback(m) { m._prog = this._variant(m.pattern, '', m.name + '(fallback)'); m._cHook = m.hook; return m._prog; }

    // ---------------------------------------------------------------- init
    async init(progress) {
      const gl = this.gl; const prog = progress || (() => {});
      const t0 = performance.now();
      prog('preparing renderer', 0.02);
      this._emptyVao = gl.createVertexArray();
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      // utility programs (compiled immediately: needed for IBL generation)
      this._pBg = this._makeProgram(PG.glu.FULLSCREEN_VS, PG.RS.bg, 'backdrop', false);
      this._pFloor = this._makeProgram(PG.RS.floorVS, PG.RS.floorFS, 'floor', false);
      this._pOccl = this._makeProgram(PG.RS.occlVS, PG.RS.occlFS, 'occlusion', false);
      this._pAoBake = this._makeProgram(PG.glu.FULLSCREEN_VS, PG.RS.aoBake, 'aoBake', false);
      this._pShadow = this._makeProgram(PG.RS.shadowVS, PG.RS.shadowFS, 'shadowDepth', false);
      this._pPost = this._makeProgram(PG.glu.FULLSCREEN_VS, PG.RS.post, 'post', false);
      this._pBloomDown = this._makeProgram(PG.glu.FULLSCREEN_VS, PG.RS.bloomDown, 'bloomDown', false);
      this._pBloomUp = this._makeProgram(PG.glu.FULLSCREEN_VS, PG.RS.bloomUp, 'bloomUp', false);
      prog('generating BRDF lookup table', 0.2); await PG.util.nextFrame();
      const tb = performance.now();
      this.brdfLut = this._genBrdfLut();
      prog('generating studio environment', 0.4); await PG.util.nextFrame();
      this.setEnvironment(this.envName);
      this.initMs = performance.now() - t0; this.iblMs = performance.now() - tb;
      this._initOcclusion();
      this._initShadow();
      this.resize();
      prog('renderer ready', 1);
      this.ready = true;
      PG.log(`renderer init ${this.initMs.toFixed(0)} ms (IBL ${this.iblMs.toFixed(0)} ms), GPU: ${this.gpuName}`);
      return this;
    }

    // ---------------------------------------------------------------- size / targets
    // Effective pixel ratio for a given devicePixelRatio: capped by settings.maxDpr (default 2; the adaptive quality lowers it).
    // Also capped so that the canvas never exceeds settings.maxPixels device pixels (default 4.5 M, ~2560x1760).
    pixelRatio(dpr, w, h) {
      const c = this.canvas; dpr = Math.min(dpr || window.devicePixelRatio || 1, this.settings.maxDpr || 2);
      w = w || c.clientWidth || window.innerWidth; h = h || c.clientHeight || window.innerHeight;
      const mp = this.settings.maxPixels || 4.5e6;
      if (w * h * dpr * dpr > mp) dpr = Math.max(1, Math.sqrt(mp / (w * h)));
      return dpr;
    }
    resize(w, h, dpr) {
      const c = this.canvas;
      if (!w) w = c.clientWidth || window.innerWidth; if (!h) h = c.clientHeight || window.innerHeight;
      dpr = this.pixelRatio(dpr, w, h);
      const pw = Math.max(2, Math.round(w * dpr)), ph = Math.max(2, Math.round(h * dpr));
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      this.width = pw; this.height = ph; this.dpr = dpr; this._camDirty = true;
    }

    _mkTex(w, h, filter) {
      const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    _freeTargets() {
      const gl = this.gl, T = this._targets; if (!T) return;
      for (const k of ['msColor', 'msDepth']) if (T[k]) gl.deleteRenderbuffer(T[k]);
      for (const k of ['msFbo', 'resFbo']) if (T[k]) gl.deleteFramebuffer(T[k]);
      if (T.resTex) gl.deleteTexture(T.resTex);
      if (T.levels) for (const l of T.levels) { gl.deleteTexture(l.tex); gl.deleteFramebuffer(l.fbo); }
      this._targets = null;
    }
    _ensureTargets() {
      const gl = this.gl, w = this.width, h = this.height, want = Math.min(Math.max(this.settings.msaa | 0, this.settings.debug === 'silhouette' ? 8 : 0), gl.getParameter(gl.MAX_SAMPLES));
      const T = this._targets;
      if (T && T.w === w && T.h === h && T.samples === want) return T;
      this._freeTargets();
      let samples = want, ok = false, N = null;
      while (!ok) {
        N = { w, h, samples };
        N.resTex = this._mkTex(w, h);
        N.resFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, N.resFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, N.resTex, 0);
        N.msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, N.msDepth);
        if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        if (samples > 0) {
          N.msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, N.msColor);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h);
          N.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, N.msFbo);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, N.msColor);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, N.msDepth);
          ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        } else {
          // no MSAA: render straight into the resolve texture
          gl.bindFramebuffer(gl.FRAMEBUFFER, N.resFbo);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, N.msDepth);
          N.msFbo = N.resFbo; ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
          if (!ok) throw new Error('Could not create a floating-point render target.');
        }
        if (!ok) { this._targets = N; this._freeTargets(); samples = samples > 4 ? 4 : 0; }
      }
      // bloom chain
      N.levels = [];
      let lw = w, lh = h;
      for (let i = 0; i < 5; i++) {
        lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
        const tex = this._mkTex(lw, lh), fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        N.levels.push({ tex, fbo, w: lw, h: lh });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._targets = N; return N;
    }

    // ---------------------------------------------------------------- camera
    setCamera(eye, target, fovDeg, opts) {
      const c = this.cam; c.eye[0] = eye[0]; c.eye[1] = eye[1]; c.eye[2] = eye[2]; c.target[0] = target[0]; c.target[1] = target[1]; c.target[2] = target[2];
      c.fov = fovDeg || 32;
      const d = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
      c.near = opts && opts.near ? opts.near : Math.min(0.12, Math.max(0.02, d * 0.025));
      c.far = opts && opts.far ? opts.far : 250;
      c.ortho = false; c.up[0] = 0; c.up[1] = 1; c.up[2] = 0;
      this._camDirty = true;
    }
    // TRUE orthographic camera (parallel projection, no perspective at all): halfHeight = half of the visible vertical extent in metres
    // (the horizontal extent follows the aspect ratio). `eye` only defines the viewing direction (and the view vector used by shading, so put
    // it far away, ~50-100 m, for practically parallel view rays). opts: { up:[x,y,z] (default +Y; pass another one for top views),
    // near, far (default: eye distance -/+ 25 m, which contains the whole car) }. Any later setCamera() switches back to perspective.
    setOrtho(eye, target, halfHeight, opts) {
      const c = this.cam; opts = opts || {};
      for (let i = 0; i < 3; i++) { c.eye[i] = eye[i]; c.target[i] = target[i]; c.up[i] = opts.up ? opts.up[i] : (i === 1 ? 1 : 0); }
      const d = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
      c.ortho = true; c.halfHeight = Math.max(1e-4, halfHeight || 1);
      c.near = opts.near || Math.max(0.05, d - 25); c.far = opts.far || (d + 25);
      this._camDirty = true;
    }
    _updateCamera() {
      const c = this.cam, aspect = this.width / this.height; c.aspect = aspect;
      PG.m4.lookAt(c.eye, c.target, c.up, this.view);
      if (c.ortho) { const hh = c.halfHeight, hw = hh * aspect; PG.m4.ortho(-hw, hw, -hh, hh, c.near, c.far, this.proj); }
      else PG.m4.perspective(c.fov * Math.PI / 180, aspect, c.near, c.far, this.proj);
      PG.m4.multiply(this.proj, this.view, this.viewProj);
      this._extractPlanes(this.viewProj, this.planes);
      // basis for the backdrop shader
      const v = this.view, th = c.ortho ? 1e-5 : Math.tan(c.fov * Math.PI / 360);
      this._camR = [v[0], v[4], v[8]]; this._camU = [v[1], v[5], v[9]]; this._camF = [-v[2], -v[6], -v[10]]; this._tan = [th * aspect, th];
      this._camDirty = false;
    }

    // frustum planes (Gribb/Hartmann), normalised, from a view-projection matrix
    _extractPlanes(m, p) {
      const set = (i, a, b, cc, d) => { const l = Math.hypot(a, b, cc) || 1; p[i * 4] = a / l; p[i * 4 + 1] = b / l; p[i * 4 + 2] = cc / l; p[i * 4 + 3] = d / l; };
      set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
      set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
      set(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]); set(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
      return p;
    }

    // ---------------------------------------------------------------- meshes / parts
    upload(mesh) {
      if (mesh instanceof GPUMesh) return mesh;
      return new GPUMesh(this.gl, mesh);
    }
    addPart(def) {
      const p = new Part(def);
      if (def.mesh) p.gpu = this.upload(def.mesh);
      if (!p.material && p.gpu) p.material = PG.mats.plasticBlack;
      this.parts.push(p);
      if (p.material && p.gpu) this._materialProgram(p.material);   // kick off (async) shader compilation right away
      this._occlDirty = true;
      return p;
    }
    removePart(part) {
      const kill = new Set([part]);
      let grew = true; while (grew) { grew = false; for (const q of this.parts) if (!kill.has(q) && q.parent && kill.has(q.parent)) { kill.add(q); grew = true; } }
      this.parts = this.parts.filter(q => !kill.has(q));
      this._occlDirty = true;
    }
    findParts(prefix) { return this.parts.filter(p => p.name.startsWith(prefix)); }

    _isVisible(p) {
      for (let q = p; q; q = q.parent) if (!q.visible) return false;
      return !this.filter || this.filter(p);
    }

    // world matrices (parents first), normal matrices, bounding spheres. Returns true when any casting part moved.
    updateWorld() {
      const stamp = ++this._stampId || (this._stampId = 1); let castMoved = false, castMovedC = false;
      const parts = this.parts, tmp = this._tmpM, m4 = PG.m4;
      const upd = p => {
        if (p._stamp === stamp) return; p._stamp = stamp;
        let src;
        if (p.parent) { upd(p.parent); m4.multiply(p.parent.world, p.matrix, tmp); src = tmp; } else src = p.matrix;
        const w = p.world; let ch = false;
        for (let i = 0; i < 16; i++) if (w[i] !== src[i]) { ch = true; break; }
        if (ch || p._changed) {
          for (let i = 0; i < 16; i++) w[i] = src[i];
          // inverse transpose of upper 3x3 (cofactors / det)
          const a = w[0], b = w[1], c = w[2], d = w[4], e = w[5], f = w[6], g = w[8], h = w[9], i2 = w[10];
          const A = e * i2 - f * h, B = f * g - d * i2, C = d * h - e * g;
          const det = a * A + b * B + c * C, id = det ? 1 / det : 1, n = p.normalMat;
          n[0] = A * id; n[1] = B * id; n[2] = C * id;
          n[3] = (c * h - b * i2) * id; n[4] = (a * i2 - c * g) * id; n[5] = (b * g - a * h) * id;
          n[6] = (b * f - c * e) * id; n[7] = (c * d - a * f) * id; n[8] = (a * e - b * d) * id;
          p.flip = det < 0;
          if (p.gpu) {
            const bc = p.gpu.bounds.center, ox = p.wcx, oy = p.wcy, oz = p.wcz, or = p.wr;
            p.wcx = w[0] * bc[0] + w[4] * bc[1] + w[8] * bc[2] + w[12]; p.wcy = w[1] * bc[0] + w[5] * bc[1] + w[9] * bc[2] + w[13]; p.wcz = w[2] * bc[0] + w[6] * bc[1] + w[10] * bc[2] + w[14];
            p.wr = p.gpu.bounds.radius * Math.sqrt(Math.max(w[0] * w[0] + w[1] * w[1] + w[2] * w[2], w[4] * w[4] + w[5] * w[5] + w[6] * w[6], w[8] * w[8] + w[9] * w[9] + w[10] * w[10]));
            // world AABB = (AABB of the transformed local box) ∩ (AABB of the bounding sphere): both contain the mesh
            const mn = p.gpu.bounds.min, mx = p.gpu.bounds.max, wb = p.wb || (p.wb = new Float32Array(6));
            let x0 = 1e30, y0 = 1e30, z0 = 1e30, x1 = -1e30, y1 = -1e30, z1 = -1e30;
            for (let k = 0; k < 8; k++) {
              const lx = k & 1 ? mx[0] : mn[0], ly = k & 2 ? mx[1] : mn[1], lz = k & 4 ? mx[2] : mn[2];
              const X = w[0] * lx + w[4] * ly + w[8] * lz + w[12], Y = w[1] * lx + w[5] * ly + w[9] * lz + w[13], Z = w[2] * lx + w[6] * ly + w[10] * lz + w[14];
              if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
            }
            wb[0] = Math.max(x0, p.wcx - p.wr); wb[1] = Math.max(y0, p.wcy - p.wr); wb[2] = Math.max(z0, p.wcz - p.wr);
            wb[3] = Math.min(x1, p.wcx + p.wr); wb[4] = Math.min(y1, p.wcy + p.wr); wb[5] = Math.min(z1, p.wcz + p.wr);
            if (p.castShadow && (Math.abs(p.wcx - ox) + Math.abs(p.wcy - oy) + Math.abs(p.wcz - oz) > 4e-4 || Math.abs(p.wr - or) > 4e-4 || !(or >= 0))) castMovedC = true;
          }
          p._changed = false;
          if (p.castShadow) castMoved = true;
        }
      };
      for (let i = 0; i < parts.length; i++) upd(parts[i]);
      this._castMovedC = castMovedC;      // a casting part's bounding sphere moved (rotation about its own centre does not count)
      return castMoved;
    }

    _inFrustum(p, planes) {
      if (!p.wr) return true;
      const pl = planes || this.planes;
      for (let i = 0; i < 6; i++) if (pl[i * 4] * p.wcx + pl[i * 4 + 1] * p.wcy + pl[i * 4 + 2] * p.wcz + pl[i * 4 + 3] < -p.wr) return false;
      return true;
    }

    // ---------------------------------------------------------------- floor occlusion map (isolated: stage B can replace)
    _initOcclusion() {
      const gl = this.gl;
      const W = 768;
      this._occl = { w: W, h: 480, tex: null, fbo: null, aoTex: null, aoFbo: null, rect: [0, 0, 1, 1], lastBake: -1e9 };
      const o = this._occl;
      const mk = (fmt) => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, o.w, o.h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        return [t, f];
      };
      [o.tex, o.fbo] = mk(gl.RGBA16F); [o.aoTex, o.aoFbo] = mk(gl.RGBA8);
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo); gl.clearBufferfv(gl.COLOR, 0, [9, 0, 0, 1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.aoFbo); gl.clearBufferfv(gl.COLOR, 0, [1, 1, 1, 1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    _occlusionRect() {
      const s = this.settings.occlusionRect; if (s) return s;
      const b = PG.spec && PG.spec.bounds;
      const m = 1.3;
      return b ? [b.min[0] - m, b.min[2] - m, b.max[0] + m, b.max[2] + m] : [-3.7, -2.4, 3.7, 2.4];
    }
    _passOcclusion(moved) {
      const gl = this.gl, o = this._occl, S = this.settings;
      let sig = 0;
      const list = this._occList || (this._occList = []); list.length = 0;
      for (let i = 0; i < this.parts.length; i++) {
        const p = this.parts[i];
        if (!p.gpu || !p.castShadow || !p.material || !p.material.castShadow || p.material.blend !== 'opaque') continue;
        if (!this._isVisible(p)) continue;
        list.push(p); sig = (sig * 31 + p.id) | 0;
      }
      const rect = this._occlusionRect();
      const rsig = rect[0] + rect[1] * 3 + rect[2] * 7 + rect[3] * 11;
      if (moved || sig !== this._occlSig || rsig !== this._occlRectSig) this._occlDirty = true;
      const now = performance.now();
      if (!this._occlDirty || (now - o.lastBake < 1000 / (S.shadowHz || 15) && o.baked)) return;
      this._occlSig = sig; this._occlRectSig = rsig; this._occlDirty = false; o.lastBake = now; o.baked = true;
      const sx = rect[2] - rect[0], sz = rect[3] - rect[1];
      o.rect = [rect[0], rect[1], 1 / sx, 1 / sz];
      // 1) lowest-surface-height map (min blending)
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo); gl.viewport(0, 0, o.w, o.h);
      gl.clearBufferfv(gl.COLOR, 0, [9, 0, 0, 1]);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendEquation(gl.MIN); gl.blendFunc(gl.ONE, gl.ONE);
      let P = this._pOccl; gl.useProgram(P.prog);
      gl.uniform4f(P.u.pgOcclRect, o.rect[0], o.rect[1], o.rect[2], o.rect[3]);
      for (const p of list) {
        gl.uniformMatrix4fv(P.u.pgModel, false, p.world);
        gl.bindVertexArray(p.gpu.vao);
        if (p.gpu.ibo) gl.drawElements(gl.TRIANGLES, p.gpu.count, p.gpu.indexType, 0); else gl.drawArrays(gl.TRIANGLES, 0, p.gpu.count);
      }
      gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);
      // 2) bake horizon occlusion into the AO texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.aoFbo); gl.viewport(0, 0, o.w, o.h);
      P = this._pAoBake; gl.useProgram(P.prog);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, o.tex); gl.uniform1i(P.u.pgMinY, 4); gl.activeTexture(gl.TEXTURE0);
      gl.uniform4f(P.u.pgOcclRect, o.rect[0], o.rect[1], o.rect[2], o.rect[3]);
      gl.bindVertexArray(this._emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---------------------------------------------------------------- uniforms
    // Binds the built-in samplers: 0 spec env, 1 irradiance, 2 BRDF LUT, 3 ground occlusion, 4/5 key-light shadow map
    // (comparison / raw sampler objects), 6/7 planar reflection colour / ray distance (floor only). Custom material samplers use 8+.
    _bindEnv() {
      const gl = this.gl, e = this.env, sh = this._shadow, rf = this._refl;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, e.spec);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_CUBE_MAP, e.irr);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.brdfLut);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._occl.aoTex);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, sh.tex); gl.bindSampler(4, sh.cmpSampler);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, sh.tex); gl.bindSampler(5, sh.rawSampler);
      if (rf && rf.ok) {
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, rf.colorTex);
        gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, rf.distTex);
      } else {        // keep every sampled unit backed by a real texture (no WebGL 'no texture bound' warnings)
        if (!this._blackTex) { this._blackTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this._blackTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); }
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this._blackTex);
        gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this._blackTex);
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    _envUniforms(u) {
      const gl = this.gl, S = this.settings, e = this.env, a = S.envRotation * Math.PI / 180;
      gl.uniform1f(u.pgEnvMaxLod, e.maxLod); gl.uniform1f(u.pgEnvScale, S.envIntensity * (e.def.exposure || 1) * 1.0);
      gl.uniform2f(u.pgEnvRot, Math.cos(a), Math.sin(a));
    }
    _frameUniforms(P) {
      const gl = this.gl, u = P.u, c = this._passCam, st = PG.state || {};
      gl.uniformMatrix4fv(u.pgViewProj, false, this._passVP);
      gl.uniform3f(u.pgCam, c[0], c[1], c[2]);
      if (u.pgPass) gl.uniform4f(u.pgPass, this._mirror ? 1 : 0, this._shadowAoOn ? 1 : 0, 0, 0);
      if (u.pgOcclRect) { const o = this._occl.rect; gl.uniform4f(u.pgOcclRect, o[0], o[1], o[2], o[3]); }
      this._shadowUniforms(u);
      gl.uniform1f(u.uTime, this.timeOverride !== null ? this.timeOverride : this.time);
      gl.uniform1f(u.uHeadlights, st.headlights !== undefined ? st.headlights : 1);
      gl.uniform1f(u.uBrake, st.brake || 0); gl.uniform1f(u.uDrs, st.drs || 0);
      if (u.pgZebra) { const S = this.settings, za = S.zebraAxis || [0.5547, 0.8321, 0], zl = Math.hypot(za[0], za[1], za[2]) || 1; gl.uniform4f(u.pgZebra, za[0] / zl, za[1] / zl, za[2] / zl, S.zebraStripes || 24); }
      this._envUniforms(u);
      P.stamp = this._passId;
    }
    _setCustomUniforms(P, m) {
      const gl = this.gl, U = m.uniforms, all = P.all;
      for (const k in U) {
        const rec = all[k]; if (!rec) continue; const v = U[k], loc = rec.loc, t = rec.type;
        if (rec.unit >= 0) {
          if (!v) continue;
          gl.activeTexture(gl.TEXTURE0 + rec.unit);
          gl.bindTexture(t === gl.SAMPLER_CUBE ? gl.TEXTURE_CUBE_MAP : t === gl.SAMPLER_3D ? gl.TEXTURE_3D : gl.TEXTURE_2D, v);
          continue;
        }
        const num = typeof v === 'number' || typeof v === 'boolean';
        switch (t) {
          case gl.FLOAT: if (num) gl.uniform1f(loc, +v); else gl.uniform1fv(loc, v); break;
          case gl.FLOAT_VEC2: gl.uniform2fv(loc, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(loc, v); break;
          case gl.FLOAT_VEC4: gl.uniform4fv(loc, v); break;
          case gl.INT: case gl.BOOL: if (num) gl.uniform1i(loc, +v); else gl.uniform1iv(loc, v); break;
          case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, v); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, v); break;
          default: break;
        }
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    _setMaterial(P, m, dbg) {
      const gl = this.gl, u = P.u, b = m.baseColor, e = m.emissive, ei = m.emissiveIntensity;
      gl.uniform3f(u.pgBase, b[0], b[1], b[2]);
      gl.uniform3f(u.pgEmis, e[0] * ei, e[1] * ei, e[2] * ei);
      gl.uniform4f(u.pgMat0, m.metallic, m.roughness, m.clearcoat, m.clearcoatRoughness);
      gl.uniform4f(u.pgMat1, m.alpha, m.specular, m.flake, m.envIntensity);
      gl.uniform4f(u.pgMat3, BLEND[m.blend] || 0, m.unlit ? 1 : 0, dbg, 0);
      if (m.uniforms) this._setCustomUniforms(P, m);
    }

    // ---------------------------------------------------------------- draw helpers
    _drawGpu(p, mode) {
      const gl = this.gl, g = p.gpu, st = this.stats;
      if (mode === 4) {
        const w = g.wire(); gl.bindVertexArray(g.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, w.ibo);
        gl.drawElements(gl.LINES, w.count, gl.UNSIGNED_INT, 0);
        if (g.ibo) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo); else gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      } else {
        gl.bindVertexArray(g.vao);
        if (!g.hasUV) gl.vertexAttrib2f(2, 0, 0);
        if (!g.hasAttr) gl.vertexAttrib4f(3, 1, 0, 0, 0);
        if (g.ibo) gl.drawElements(gl.TRIANGLES, g.count, g.indexType, 0); else gl.drawArrays(gl.TRIANGLES, 0, g.count);
      }
      st.draws++; st.tris += g.triCount;
    }
    _drawSurface(p, cull) {
      // cull: gl.BACK | gl.FRONT | 0 (none)
      const gl = this.gl, m = p.material, P = m._prog;
      const dbg = this._dbgMode;
      if (P !== this._curProg) { gl.useProgram(P.prog); this._curProg = P; this._curMat = null; }
      if (P.stamp !== this._passId) this._frameUniforms(P);
      if (this._curMat !== m || m._dirtyFrame !== this._passId) { this._setMaterial(P, m, dbg); this._curMat = m; m._dirtyFrame = this._passId; }
      gl.uniformMatrix4fv(P.u.pgModel, false, p.world);
      gl.uniformMatrix3fv(P.u.pgNormalMat, false, p.normalMat);
      gl.uniform4f(P.u.pgMat2, m.patternScale, p.gpu.hasUV ? 1 : 0, (m.aoFromAttr && p.gpu.hasAttr) ? 1 : 0, m.doubleSided ? 1 : 0);
      if (P.u.pgPart) gl.uniform4f(P.u.pgPart, p.receiveShadow ? 1 : 0, 0, 0, 0);
      const flip = p.flip !== this._mirror;
      if (flip !== this._curFlip) { gl.frontFace(flip ? gl.CW : gl.CCW); this._curFlip = flip; }
      if (cull !== this._curCull) { if (cull) { gl.enable(gl.CULL_FACE); gl.cullFace(cull); } else gl.disable(gl.CULL_FACE); this._curCull = cull; }
      this._drawGpu(p, dbg);
    }

    // ---------------------------------------------------------------- main frame
    render(dt) {
      if (this.lost || !this.ready) return;
      const t0 = performance.now(), gl = this.gl, S = this.settings, st = this.stats;
      dt = dt || 0; this.time += dt; this._frameId++; this.frame++;
      const T = this._ensureTargets();
      // optional GPU timing (EXT_disjoint_timer_query_webgl2): one query in flight, result read a few frames later
      const tq = this.timerExt; let q = null;
      if (tq) {
        if (this._tqPending) {
          const ok = gl.getQueryParameter(this._tqPending, gl.QUERY_RESULT_AVAILABLE);
          if (ok) { if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(this._tqPending, gl.QUERY_RESULT) / 1e6; st.gpuMs = st.gpuMs === undefined ? ms : st.gpuMs + (ms - st.gpuMs) * 0.1; } gl.deleteQuery(this._tqPending); this._tqPending = null; }
        }
        if (!this._tqPending) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
      }
      if (this._camDirty !== false) this._updateCamera();
      const moved = this.updateWorld();
      this._dbgMode = DEBUG_MODES[S.debug] || 0;
      st.draws = 0; st.tris = 0; st.shadowDraws = 0; st.reflDraws = 0;
      // other modules (SDF mesher...) share this context: restore the state we rely on
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.RASTERIZER_DISCARD); gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.disable(gl.SAMPLE_COVERAGE); gl.enable(gl.DITHER);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindVertexArray(null); gl.blendEquation(gl.FUNC_ADD);
      gl.colorMask(true, true, true, true); gl.depthMask(true);

      // ---- main-camera draw lists (frustum culled, sorted)
      const opq = this._opaque, trn = this._trans; opq.length = 0; trn.length = 0;
      this._buildLists(opq, trn, this.planes, this.cam.eye, false);
      st.parts = opq.length + trn.length;

      // ---- shadow map, contact-occlusion map, planar reflection
      this._shadowAoOn = !!S.shadows; this._light = this._keyLight();
      this._mirror = false; this._passVP = this.viewProj; this._passCam = this.cam.eye;
      if (S.shadows && this._dbgMode < 7) { this._passOcclusion(this._castMovedC); this._passShadow(moved); } else this._shadowOn = false;
      const wantRefl = S.floor && S.reflections && !this._dbgMode && !this.cam.ortho && this.cam.eye[1] > 0.02 && S.floorReflection > 0;
      if (wantRefl) this._passReflection(); else this._reflOn = false;

      // ---- main pass
      this._mirror = false; this._passVP = this.viewProj; this._passCam = this.cam.eye;
      this._passId++;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.msFbo); gl.viewport(0, 0, T.w, T.h);
      gl.disable(gl.BLEND); gl.depthMask(true); gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this._bindEnv();
      this._curProg = null; this._curMat = null; this._curFlip = false; this._curCull = -1; gl.frontFace(gl.CCW);
      this._drawBackdrop();
      if (S.floor && !this._dbgMode) this._drawFloor();
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      if (this._dbgMode === 4) gl.disable(gl.CULL_FACE), this._curCull = 0;
      this._curProg = null; this._curFlip = false;
      this._drawLists(opq, trn, this._dbgMode === 4);
      gl.frontFace(gl.CCW); gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);

      // ---- resolve + post
      if (T.msFbo !== T.resFbo) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.resFbo);
        gl.blitFramebuffer(0, 0, T.w, T.h, 0, 0, T.w, T.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(this._emptyVao);
      const bloomOn = S.bloom > 0 && !this._dbgMode;
      if (bloomOn) this._passBloom(T);
      this._passPost(T, bloomOn);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); this._tqPending = q; }
      st.cpuMs = performance.now() - t0; st.frame = this.frame;
      if (S.adaptive) this._adapt(dt);
    }

    // Visible, compiled parts -> opaque (sorted by program/material) and transparent (sorted back to front) lists.
    // mirror = planar reflection pass: only parts with `reflect`, small/far ones are skipped.
    _buildLists(opq, trn, planes, eye, mirror) {
      const parts = this.parts;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p.gpu || !p.material || !p.gpu.count) continue;
        if (mirror && (!p.reflect || p.wcy + p.wr < 0)) continue;
        if (!this._isVisible(p)) continue;
        if (!this._inFrustum(p, planes)) continue;
        const dx = p.wcx - eye[0], dy = p.wcy - eye[1], dz = p.wcz - eye[2], d2 = dx * dx + dy * dy + dz * dz;
        if (mirror && p.wr * p.wr < d2 * 1.6e-5) continue;            // < ~0.4% of the distance: invisible in the mirror
        const m = p.material; let P = this._materialProgram(m);
        if (P.failed && P.hasHook) P = this._fallback(m);
        if (!this._programReady(P)) continue;
        if (m.blend === 'opaque') { p._key = p.renderOrder * 1e7 + P.id * 1e4 + (m.id & 4095); opq.push(p); }
        else { p._depth = d2; trn.push(p); }
      }
      opq.sort((a, b) => a._key - b._key);
      trn.sort((a, b) => (a.renderOrder - b.renderOrder) || (b._depth - a._depth));
    }
    // Draw opaque then transparent lists with the current pass state (backface culling, back-to-front blending, no depth writes for glass)
    _drawLists(opq, trn, wire) {
      const gl = this.gl;
      for (let i = 0; i < opq.length; i++) {
        const p = opq[i];
        this._drawSurface(p, wire ? 0 : (p.material.doubleSided ? 0 : gl.BACK));
      }
      // transparents: back-to-front, no depth writes; alpha double-sided parts draw back faces first, then front faces
      if (trn.length) {
        gl.enable(gl.BLEND); gl.depthMask(false);
        let lastBlend = '';
        for (let i = 0; i < trn.length; i++) {
          const p = trn[i], m = p.material;
          if (m.blend !== lastBlend) { if (this._dbgMode >= 7) gl.blendFunc(gl.ONE, gl.ZERO); else if (m.blend === 'add') gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); lastBlend = m.blend; }   // silhouette / zebra: every part is drawn opaque
          if (m.doubleSided && m.blend === 'alpha') { this._drawSurface(p, gl.FRONT); this._drawSurface(p, gl.BACK); }
          else this._drawSurface(p, m.doubleSided ? 0 : gl.BACK);
        }
        gl.disable(gl.BLEND); gl.depthMask(true);
      }
    }

    _drawBackdrop() {
      const gl = this.gl, P = this._pBg, u = P.u, e = this.env, bg = e.def.bg;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false);
      gl.useProgram(P.prog); gl.bindVertexArray(this._emptyVao);
      gl.uniform3fv(u.pgBgTop, bg.top); gl.uniform3fv(u.pgBgHorizon, bg.horizon); gl.uniform3fv(u.pgBgFloor, bg.floor);
      gl.uniform2f(u.pgBgEnv, e.def.bgEnv ? e.def.bgEnv[0] : 0, e.def.bgEnv ? e.def.bgEnv[1] : 0);
      gl.uniform3fv(u.pgCamR, this._camR); gl.uniform3fv(u.pgCamU, this._camU); gl.uniform3fv(u.pgCamF, this._camF); gl.uniform2fv(u.pgTan, this._tan);
      gl.uniform1f(u.pgShowEnv, +this.settings.showEnv || 0); gl.uniform1f(u.pgBgDebug, this._dbgMode === 7 ? 2 : this._dbgMode === 8 ? 3 : this._dbgMode ? 1 : 0);
      const a = this.settings.envRotation * Math.PI / 180; gl.uniform2f(u.pgEnvRot, Math.cos(a), Math.sin(a));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    }

    _passBloom(T) {
      const gl = this.gl, L = T.levels, S = this.settings;
      gl.bindVertexArray(this._emptyVao);
      let P = this._pBloomDown; gl.useProgram(P.prog); gl.uniform1i(P.u.uTex, 0);
      gl.uniform1f(P.u.uThreshold, S.bloomThreshold);
      let srcTex = T.resTex, sw = T.w, sh = T.h;
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < L.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, L[i].fbo); gl.viewport(0, 0, L[i].w, L[i].h);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform2f(P.u.uTexel, 1 / sw, 1 / sh); gl.uniform1f(P.u.uFirst, i === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        srcTex = L[i].tex; sw = L[i].w; sh = L[i].h;
      }
      P = this._pBloomUp; gl.useProgram(P.prog); gl.uniform1i(P.u.uTex, 0); gl.uniform1f(P.u.uRadius, 1.0); gl.uniform1f(P.u.uGain, 0.82);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = L.length - 2; i >= 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, L[i].fbo); gl.viewport(0, 0, L[i].w, L[i].h);
        gl.bindTexture(gl.TEXTURE_2D, L[i + 1].tex); gl.uniform2f(P.u.uTexel, 1 / L[i + 1].w, 1 / L[i + 1].h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }
    _passPost(T, bloomOn) {
      const gl = this.gl, P = this._pPost, u = P.u, S = this.settings;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(P.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.resTex); gl.uniform1i(u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomOn ? T.levels[0].tex : T.resTex); gl.uniform1i(u.uBloom, 1);
      gl.uniform1f(u.uExposure, S.exposure * (this.env.def.exposure || 1) * 1.0);
      gl.uniform1f(u.uBloomAmt, bloomOn ? S.bloom : 0); gl.uniform1f(u.uVignette, S.vignette);
      gl.uniform1f(u.uGrain, S.grain); gl.uniform1f(u.uSaturation, S.saturation); gl.uniform1f(u.uContrast, S.contrast);
      gl.uniform1f(u.uSeed, this.timeOverride !== null ? 0 : (this.frame % 61));
      gl.uniform1f(u.uDebug, this._dbgMode >= 7 ? 2 : this._dbgMode && this._dbgMode < 4 ? 1 : 0); gl.uniform2f(u.uRes, this.width, this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    // Snapshot of the last frame (RGBA8), for tests. Call right after render() (preserveDrawingBuffer not required for this).
    readPixels() {
      const gl = this.gl, w = this.width, h = this.height, buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf;
    }
  }
  PG.Renderer = Renderer;
})();
