# Porsche 911 GT3 RS (992) — procedural WebGL2 model — ARCHITECTURE (source of truth)

Goal: a museum-quality, fully **procedural** 3D Porsche 911 GT3 RS (992) that opens by double-clicking `index.html`
(Chrome, `file://`). **Zero external assets**: no models, textures, images, font files, libraries, CDNs. Everything is
generated at load time in JS/GLSL. (Canvas-2D text drawn at runtime with system font stacks is allowed for lettering
textures.) No other AI/image services. Only create/edit files inside this project folder.

## 1. Hard constraints
- Classic `<script src>` files only, loaded by `index.html` in a fixed order. No ES modules, no `fetch`/XHR of local files,
  no external workers (Blob workers are OK). Global namespace `window.PG`. All shader code lives in JS strings.
- WebGL2 only. Available on the target machine: `EXT_color_buffer_float`, `OES_texture_float_linear`, 8x MSAA,
  3D textures, `KHR_parallel_shader_compile`. Still: feature-detect and fail with a readable message, never a blank page.
- Build must be **deterministic** (no `Math.random`, no `Date.now` in geometry; use `PG.util.rng(seed)`).
- Load-time budget on an M-series Mac: whole car ready in < ~20 s (body meshing <= ~8 s), 60 fps interactive at 1080p+.
- Console must be free of errors/warnings in the shipped state.

## 2. Coordinates & units (see `js/car/spec.js` — authoritative numbers)
Metres. Origin on the ground at mid-wheelbase on the centre-line. **+X forward (nose), +Y up, +Z = car's RIGHT side.**
LHD car: driver at −Z. Body is symmetric about Z=0 (author body SDFs with `p.z = abs(p.z)` first).
Camera azimuth convention: camera position = target + dist·(cos(el)·cos(az), sin(el), cos(el)·sin(az));
az=0 → in front of the car looking at the nose; az=+90° → car's right side; az=−90° → left side; az=180° → behind.
Triangle winding: CCW when seen from outside. Meshes are in the module's own local space (car space unless the part has a matrix).

## 3. Files, ownership, load order
```
index.html                 canvas + loading overlay + <script> list (fixed order below)          [renderer/app agent]
js/core.js                 math (PG.v3, PG.m4), PG.util, PG.glu (GL helpers), PG.registerModule  [DONE - read it]
js/geo.js                  explicit mesh builders + mesh utils + raycaster  (PG.geo)              [mesher agent]
js/sdf.js                  GPU SDF→mesh pipeline + GLSL SDF library (PG.sdf)                      [mesher agent]
js/renderer.js             PG.Renderer, PG.Material, PG.mats (material library), environment      [renderer agent]
js/car/spec.js             dimensions & anchors (PG.spec)                                         [DONE]
js/car/body.js             body shell (SDF), paint/glass/trim shading masks, feature registry     [body agents]
js/car/wheels.js           rims, tyres, brake discs, calipers, hubs, wheel wells                  [wheels agent]
js/car/aero.js             DRS rear wing, front splitter/canards, diffuser, underbody             [aero agent]
js/car/lights.js           headlights, tail-light bar, indicators (as parts and/or body masks)    [lights agent]
js/car/details.js          mirrors, handles, wipers, badges/lettering, exhaust, misc              [details agent]
js/car/interior.js         cockpit: seats, dash, wheel, cage, harnesses, trim                     [interior agent]
js/app.js                  module runner, orbit camera, UI, URL params, PG_APP API                [renderer/app agent]
tools/shot.js              headless Chrome screenshot tool (CDP)                                  [DONE]
REFERENCE.md               researched facts about the real car (dimensions, features)             [research agent]
```
Load order in `index.html`: core → geo → sdf → renderer → spec → body → wheels → aero → lights → details → interior → app.
Each car module file registers itself: `PG.registerModule({ name, order, async build(ctx){...} })`.
Orders: body 10, wheels 20, aero 30, lights 40, details 50, interior 60. A module may `document.write` extra
`<script src="js/car/<module>_*.js">` tags at the top of its file if it wants to split its code (keeps `index.html` untouched).
**Only edit files you own.** If you find a bug in someone else's module, work around it or report it in your final message.

## 4. Mesh format (CPU)
```js
mesh = { positions: Float32Array(3n), normals: Float32Array(3n),
         uvs?: Float32Array(2n), attrs?: Float32Array(4n), indices: Uint32Array | Uint16Array }
```
`attrs` is a free per-vertex vec4 (SDF mesher: x = baked ambient occlusion 0..1; y,z,w free for the producer).

## 5. Renderer API (`js/renderer.js`) — final truth is the header comment of that file
```js
const r = new PG.Renderer(canvas);  await r.init(progress);   // shaders, IBL cubemaps, BRDF LUT, studio
r.gl; r.resize(w,h,dpr); r.setCamera(eye, target, fovDeg);
const gpu  = r.upload(mesh);                       // GPUMesh (VAO + buffers, bounds); cheap to share between parts
const part = r.addPart({ name, mesh /*CPU or GPUMesh*/, material, matrix, parent, visible:true,
                         castShadow:true, receiveShadow:true, reflect:true, renderOrder:0 });   // matrix: Float32Array(16), mutable each frame
r.removePart(part); r.findParts('wheel');          // prefix match on name
r.render(dt);                                      // shadow pass, floor-reflection pass, main pass (MSAA HDR), transparents, bloom, tonemap
r.setEnvironment('studio'|'showroom'|'sunset'|'night'); r.settings = { exposure, bloom, shadows, reflections, floor:true, ... }
```
Hierarchy: `part.parent` (another Part) → world = parent.world · part.matrix.
### Material
```js
new PG.Material({ name, baseColor:[r,g,b] /*LINEAR; use PG.util.hex('#rrggbb')*/, metallic, roughness, clearcoat, clearcoatRoughness,
  emissive:[r,g,b], emissiveIntensity, alpha:1, blend:'opaque'|'alpha'|'add', doubleSided:false, specular:0.5,
  flake:0, pattern:'none'|'carbon'|'alcantara'|'knurl'…, patternScale, envIntensity:1, unlit:false,
  hook: '<GLSL>', uniforms:{ uName: number|[..]|WebGLTexture }, castShadow:true })
```
Material objects are **live** (renderer reads them every frame): the UI recolours paint by mutating `PG.mats.paint.baseColor`.
`PG.mats` is a shared library created at load (plain data, no GL needed): `paint` (metallic clear-coated, colour from UI),
`paintAccent`, `carbonTwill`, `carbonMatte`, `plasticBlack` (satin), `plasticGloss` (piano black), `rubber`, `tire`, `glass` (dark,
transparent, reflective), `glassLens` (clear headlight lens), `chrome`, `aluminum` (brushed), `wheel` (UI finish), `discCeramic`,
`discIron`, `caliper` (gloss yellow), `alcantara`, `leather`, `fabricBlack`, `redLight` (emissive tail), `whiteLED`, `amberLED`,
`meshBlack` (black grille), `rubberSeal`, `paintedBlackMetal`, `mag` (raw magnesium). Modules may add their own.
### Surface hook (GLSL) — lets a material customise shading per fragment (masks, decals, weave patterns, lettering)
```glsl
// The renderer prepends this and calls your `surfaceHook` after initialising Surf from the material's parameters.
struct Surf { vec3 baseColor; float metallic; float roughness; float clearcoat; float clearcoatRoughness; vec3 emissive;
              float alpha; float ao; vec3 normal /*OBJECT space, keep unit*/; float flake; float specular; bool discardFrag; };
struct Frag { vec3 pObj; vec3 nObj; vec2 uv; vec4 attr; bool front; vec3 pW; vec3 nW; vec3 vW /*to eye*/;
              float fw /*pixel footprint in object units, use for AA masks: smoothstep(-fw, fw, d)*/; };
uniform float uTime, uHeadlights, uBrake, uDrs;          // globals always available (0..1)
void surfaceHook(inout Surf s, in Frag f) { ... }         // define this; also declare your own `uniform`s / helper functions above it
```
Object space = the part's local mesh space (for the body: car space, so masks can use spec coordinates directly).
Back faces of `doubleSided` materials get `f.front == false` (the body renders back faces as dark interior trim).
The renderer also does: image-based lighting from a procedural studio (prefiltered GGX cubemap + irradiance + BRDF LUT), a
directional key light with soft shadows, a glossy studio floor with planar reflection + contact shadow, MSAA HDR, bloom, ACES-like tonemapping.

## 6. SDF mesher API (`js/sdf.js`)
Signed-distance model → smooth watertight mesh, evaluated on the GPU slice by slice, meshed on the CPU (surface nets).
```js
const mesh = await PG.sdf.mesh(gl, {
  glsl: `float map(vec3 p){ ... }`,                   // REQUIRED. Negative inside. Should be ≈ metric (|∇|≈1).  Prefixed with PG.sdf.lib automatically.
  attr: `vec4 attr(vec3 p, vec3 n){ ... }`,           // optional per-vertex attribute (default: x = baked AO from map())
  min:[x,y,z], max:[x,y,z], voxel: 0.008,             // bounds & cell size in metres; multiply voxel by ctx.quality
  label:'body', onProgress(frac) })                   // → CPU mesh (section 4) with analytic normals from ∇map, attrs.x = AO
PG.sdf.lib  // GLSL: smin/smax (polynomial + exponential), sdSphere/Ellipsoid/Box/RoundBox/Capsule/Cylinder/Torus/Cone…,
            // sdPolygon (2D, arbitrary winding), extrusion/revolution helpers, rotations, noise, catmull-rom helpers …
```
Measured: 25 M voxels with a 120-primitive SDF evaluates + reads back in ≈0.8 s on this GPU, so 6–8 mm voxels for the body are fine.
Geometry authoring rules: keep SDFs ≈ Lipschitz-1 near the surface; thin features (< 2 voxels) need a finer local mesh (mesh small regions
separately with a small `voxel`, e.g. 1.5–2 mm for a headlight lens or wheel spokes). Use `abs(p.z)` for symmetric bodies.
`PG.geo` (js/geo.js): explicit mesh builders (`box, sphere, cylinder, cone, torus, lathe(profile), extrude(polygon,depth), sweep/tube(path,radius),
loft(sections), grid(fn)`), mesh utils (`merge, transform(mesh,m4), computeNormals, weld, flip, mirrorZ`), and `PG.geo.raycaster(mesh)` → `{cast(origin,dir)→{t,point,normal}|null}`.

## 7. Module context (`ctx`, passed to every `build`)
```js
ctx = { renderer, gl, spec, mats: PG.mats, sdf: PG.sdf, geo: PG.geo, m4, v3, util,
        quality,            // voxel multiplier from ?q= (draft 1.8, normal 1.0, fine 0.7) — scale your meshing voxels by it
        params,             // URLSearchParams (debug flags)
        shared,             // object for cross-module data, e.g. shared.body = { mesh, raycaster, featureRegistry }
        add(partDef) → Part,            // renderer.addPart + bookkeeping
        onUpdate(fn),                   // fn(dt, time, PG.state) every frame (animation: wheel spin, DRS, steering)
        progress(label, frac) }         // drives the loading overlay
```
`PG.state = { drs, headlights, brake, steer, spin, … }` is driven by the UI.

## 8. Debug & screenshot protocol (implemented by js/app.js, used by every agent)
Run: `node tools/shot.js --url "index.html?shot=1&only=body" --out shots/x.png --w 1600 --h 900 [--cams front34,side,rear34] [--logs]`
then **look at the PNG with the Read tool** — judge the image, do not assume. Multiple cameras in one page load: `--cams`.
URL params: `shot=1` (deterministic: no auto-rotate/UI, sets `window.__ready=true` after the build and 3 rendered frames) ·
`cam=<name>` · `only=a,b` / `hide=a,b` (part-name prefix filters) · `q=draft|normal|fine` · `env=studio|showroom|sunset|night` ·
`paint=<index|#hex>` · `wheel=<index>` · `floor=0|1` · `bloom=0|1` · `debug=normals|ao|albedo|wire` · `time=<sec>`.
`window.PG_APP.setCamera(name | {az,el,dist,target:[x,y,z],fov})` → Promise (resolves after 2 frames).
Camera presets that MUST exist: `front34` (az −35°, el 8°, front-left hero), `front34r`, `rear34` (az −145°), `rear34r`, `side` (az −90°, el 0),
`sider`, `front`, `rear`, `top`, `low` (el 2°), `wheelF` (close-up front-left wheel), `wheelR`, `wing`, `nose`, `tail`, `cockpit`, `hero`.
Other agents may run Chrome concurrently; `tools/shot.js` handles profile isolation. Never leave Chrome processes running.

## 9. Quality bar (what "done" means)
- It must read as a **992 GT3 RS at first glance** (silhouette, stance, wing, wheels, nose) and hold up on close inspection.
  `REFERENCE.md` lists what the real car looks like — treat its feature checklist as acceptance criteria.
- Smooth, correctly proportioned surfaces with crisp panel gaps, sharp-but-rounded lips/edges, real depth in intakes/vents.
- Materials: deep clear-coated paint with flake, real carbon weave, matte plastics, tinted glass, believable rubber/metal.
- No z-fighting, no cracks/holes, no inside-out normals, no floating parts, no interpenetration visible from normal viewing angles.
- Judge results with screenshots from several angles, both close and far, and iterate until it looks right.
