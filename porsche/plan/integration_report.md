## Integration & verification report

**Status.** The pipeline works end to end. This covers SDF meshing, the shared-vertex-buffer body and glass parts, wheels, raycaster, renderer, app and UI. Every run showed no console errors or warnings and `gl.getError()` = 0. That includes 4 environments, debug modes normals/ao/wire, `only=` filters, and paint/wheel/DRS/brake/headlight/spin state changes through `PG_APP`.
- `tools/shot.js` leaves 0 Chrome processes. I checked with `ps`, including after a timeout exit.
- Orientation is correct: nose at +X, right side +Z. The placeholder body proves it. The right side (+Z) only has a white roundel and a blue sill stripe. The nose has white headlight patches driven by `uHeadlights`. The tail has a red bar driven by `uBrake`. Cameras `side` (left flank) and `sider` (right flank) match.
- Opening `index.html` as `file://` with default params shows the loading overlay ("compiling shaders"), then the car with UI, the intro tween and auto-rotate. It was not blank.
- Synthetic pointer drag, wheel zoom (clamped to 1.2–12), `H` and double-click reset all work.

### Timings (Apple M5, headless, 1600x900, 4x MSAA)
| Item | Result |
|---|---|
| Page ready | 0.55–0.85 s (first cold run 0.8 s) |
| Placeholder body meshing | 10 mm voxel: 0.20–0.39 s (307k verts, 615k tris) |
| Body at 8 mm | 0.33 s (481k verts, 962k tris) |
| Body at 6 mm | 0.69 s (855k verts, 1.71M tris; cold compile 2.2 s page ready) |
| Body at 5 mm | 0.71 s (1.23M verts, 2.46M tris) |
| BVH raycaster build | 50–67 ms at 0.3–0.5M tris |
| Renderer init | about 30 ms |
| CPU per frame | 0.2 ms |
| Whole car, 8 mm body, main pass tris | 1.2M |
| GPU per frame, 8 mm body | 7.1 ms (12.5 ms before the glass-subset change) |
| GPU per frame, 5 mm body | about 21 ms, over budget |
| fps | 60 in all measured cases except 5 mm (59.3) |

Guideline: 8 mm voxels for the body fit the budget. 5 mm does not, unless the mirror pass is reduced.

### Foundation fixes and additions
1. **`PG.Material.derive(over)` (renderer.js).** It creates a live-linked material. Fields you do not override keep following the parent. This is required so a body variant with a hook still recolours when the UI mutates `PG.mats.paint` or `PG.mats.wheel`. `clone()` copies values once and would not follow. Assigning a field on the derived material detaches that field.
2. **`GPUMesh.subset(indices)` (renderer.js).** It returns a GPUMesh that shares the vertex buffers and has its own index buffer. Use it for glass and decals on a big mesh.
   - Drawing the whole body a second time for glass cost 3x triangles. The glass subset is now about 10% of the mesh.
   - I put a JS port of the window mask in `body.js` to select the triangles. The GLSL hook does the exact cut.
3. **Stats.** `renderer_passes.js` now restores `stats.tris` after the mirror pass, so `tris` really counts the main pass. It adds `stats.reflTris`.
4. **Floor reflection stipple.** The blur LOD in `renderer_shaders.js` (`log2(rt) - 1.2`) left gaps between the 8 taps and showed a halftone pattern on bright reflections such as headlights. I changed it to `- 0.5`. It is much smoother now. A faint dither remains at extreme zoom.
5. **`PG_APP.measureFps(seconds)`** returns `{fps, avgMs, p95Ms, maxMs, frames, cpuMs, gpuMs}`. There is also `PG_APP.pause(bool)`. `PG_APP.screenshot()` now uses `readPixels` and a 2D canvas.
6. **The "screenshot hang at 2560x1440" was in `tools/shot.js`, not the renderer.**
   - Node's built-in WebSocket client stalls forever on any CDP message larger than about 4 MB. A noisy, bright PNG of a big viewport crosses that size. Dark or empty scenes stayed small, which is why the hang looked content-dependent.
   - I switched the transport to `--remote-debugging-pipe` and removed the port and HTTP code.
   - 2560x1440 and 3840x1600 now capture through normal `Page.captureScreenshot`. I tested up to 3840x1600.
   - New shot.js options:
     - `--canvas` captures via `PG_APP.screenshot()`.
     - `--shot-timeout <ms>` sets a safety timeout.
     - The `PG_CHROME_LOG` and `PG_CHROME_FLAGS` env vars are for debugging.
   - Exit code 3 means the screenshot failed.
   - Screenshots above 4 MB no longer need to be avoided.
7. **Small extras.** The renderer accepts `?notimer=1` to disable the GPU timer query. It was a test hook and is not needed.

### Placeholders (to be replaced)
- **`js/car/body.js`** (order 10). The SDF is a lower shell built from spline tables for top, bottom and half-width, smooth-united with a cabin. Arches are cut with cylinders. It publishes `ctx.shared.body = {mesh, gpu, raycaster, parts:{body,glass}, materials, stats, voxel, featureRegistry}` and `PG.bodyStats`. URL param `bodyvoxel=0.008` sets the voxel size.
- **`js/car/wheels.js`** (order 20). 4 wheels, each a transform group with a spin child (tyre, rim with 10 spokes, disc) and a static caliper child. `PG.state.spin` drives the rotation. The angle integrates `-(spin*1.6/r)*dt`, so the tyre top moves +X. It also places two markers (`marker_roof`, `marker_hood`) with `raycaster.heightAt`. The roof height is 1.280 and the hood 0.781, and the normals are correct. Use `?markers=0` to disable them. The real modules should delete these markers.
- The placeholder body is very crude. The windshield and rear-window masks are rounded boxes in plan view.

### Remaining risks
- The default paint is Arctic Grey (index 0). It reads bland against the dark studio. Consider defaulting to a more striking colour.
- Body meshing is cheap (under 0.7 s even at 6 mm), so the real body's SDF cost is dominated by the number of `map()` call sites in the post shader. See the recipe below.
- Reflections and shadows redraw the whole body, so the real car's triangle count multiplies. Use `reflect:false` on small or unimportant parts. Use subsets for glass and trim.
- The GPU timer readings are EMAs and were noisy.
- Nothing was viewed on a real display, only headless.

### Usage notes for part-module authors
**Module skeleton**
```js
PG.registerModule({ name:'x', order:N, async build(ctx){
  const {renderer, gl, geo, m4, sdf} = ctx;
  ctx.progress('label', frac);
  const gpu = renderer.upload(cpuMesh);
  const p = ctx.add({name:'x_thing', mesh:gpu, material, matrix, parent, castShadow, reflect});
  ctx.onUpdate((dt, t, st) => {/* st.drs, st.brake, st.headlights, st.spin, st.steer */});
}});
```
- Prefix part names with your module name. `only=` and `hide=` match name prefixes.
- Yield now and then (`await PG.util.nextFrame()`) so the loading overlay repaints.

**Materials**
- Never mutate `PG.mats.paint` from a module. Use `PG.mats.paint.derive({name, hook, doubleSided:true})`.
- The same applies to `wheel`, `glass` and the other library materials.
- The hook re-declaration of the global uniforms `uTime`, `uHeadlights`, `uBrake`, `uDrs` is stripped.
- A hook has no `PG.sdf.lib`. Write your own small helpers. Do not use identifiers starting with `pg`.

**Windows and masks recipe (works, verified)**
- Mesh the body once. Put the mask function in one GLSL string shared by two hooks.
- The paint part discards where the mask is < 0 (`s.discardFrag = true`). Make it doubleSided and colour back faces near-black (`f.front == false`).
- The glass part is `gpu.subset(trianglesNearWindows)` with the mask inverted (discard where mask >= 0).
- Use the unflipped normal `n = f.front ? f.nObj : -f.nObj` inside the mask, or masks flip for back faces.
- Decals are the same thing: blend `s.baseColor` with `smoothstep(-f.fw, f.fw, d)`. `f.pObj` is car space for the body.

**Meshing recipe**
- Body: `PG.sdf.mesh(gl, {glsl, min, max, voxel: 0.008*ctx.quality, aoScale: 0.12})`. Bounds clip the shape and close it, so keep a margin. The 300-primitive body measured 0.3–0.7 s warm and 1–2 s with a cold shader cache.
- Small parts: voxel 1.5–3 mm. Walls must be at least 2–3 voxels thick.
- Build tables with `PG.sdf.tableGLSL(name, arr, {x0,x1})` and use `name_lin(x)`. Symmetric parts use `abs(p.z)`.
- Do not redefine `PG.sdf.lib` names such as `smin`, `sq` or `rot2`.
- Use exact `max()` for sharp rims and `smax` with k of 3 voxels or more.

**Placing things with the raycaster**
- Use `const rc = ctx.shared.body.raycaster`.
- `rc.heightAt(x, z, yStart)` returns the top surface y.
- `rc.cast([x, y+0.5, z], [0,-1,0])` returns `{point, normal, t, ...}`.
- `rc.bottomAt`, `rc.nearest`, `rc.castAll` and `rc.inside` also exist.
- The raycaster is in body (car) space. It is built only when the body module ran, so guard with `if (ctx.shared.body)`.

**Wheels**
- Build wheel meshes with the axis along +Y (outboard), then rotate about X by `side*90°` into car space (`+Y` becomes `+Z` for the right wheel, `-Z` for the left).
- Use a spin group with `matrix = m4.rotationZ(angle)`.
- Tyre outer face z is about 0.9535 (front). The body arches must clear tyre radius plus about 0.06.

**Testing**
- Standard: `node tools/shot.js --url "index.html?shot=1" --out shots/x.png --w 1600 --h 900 --cams front34,side --logs`.
- For timings, use `--eval "PG_APP.measureFps(3).then(JSON.stringify)"`.
- Big shots up to 3840 px wide work.

### Files touched
All under `/Users/avenox/Desktop/sonnet/porsche`:
- `js/car/body.js`
- `js/car/wheels.js`
- `js/renderer.js`
- `js/renderer_passes.js`
- `js/renderer_shaders.js`
- `js/app.js`
- `tools/shot.js`

Screenshots are in `shots/int_*.png`, for example `int_a-*` (six cameras), `int_env_*` (four environments), `int_user_loading.png`, `int_user_ready.png`, `int_2560p-*` and `int_3840.png`.