'use strict';
// app.js — module runner, orbit camera, UI, URL params and the PG_APP debug/screenshot API.
//
// ============================================================================================================
// PUBLIC API (window.PG_APP, available immediately; fully functional after PG_APP.ready resolves)
// ============================================================================================================
//   PG_APP.ready                 Promise<void>, resolved when all modules are built and the first frames are rendered
//   PG_APP.renderer / .ctx       the PG.Renderer and the module context (ARCHITECTURE.md section 7)
//   PG_APP.setCamera(name | {az, el, dist, target:[x,y,z], fov, limits?:{min,max}} | {ortho:true, view, scale, target}) -> Promise
//                                preset name or partial camera; tweened (1.3 s) in normal mode, instant in shot mode.
//                                Resolves 2 rendered frames after the camera has arrived.
//   PG_APP.getCamera() -> {az, el, dist, target, fov, eye}          PG_APP.presets  (mutable map name -> camera)
//   PG_APP.setPaint(indexOrHex)  PG_APP.setWheel(index)  PG_APP.setEnv(name) -> Promise (async IBL generation in live mode)  PG_APP.setDebug('normals'|'ao'|'albedo'|'wire'|'silhouette'|'zebra'|'')
//   PG_APP.setState({drs, headlights, brake, spin})   eased targets for the animated PG.state values
//   PG_APP.setAutoRotate(bool)  PG_APP.setFilters({only:[..], hide:[..]})  PG_APP.hideUI(bool)
//   PG_APP.stats() -> {fps, ms, draws, tris, parts, cpuMs, gpuName, modules:{name:status}, timings}
//   PG_APP.screenshot() -> data URL (renders a frame first)
//   PG_APP.measureFps(seconds=2) -> Promise<{fps, avgMs, p95Ms, maxMs, frames, cpuMs, gpuMs}> real frame intervals over that time window
//                                (rAF is vsync locked: 60 fps means "holds the display rate"; look at cpuMs/gpuMs for headroom)
// window.__ready (true after build + 3 frames), window.__status ('loading: ...' | 'ready' | 'ready (errors: a,b)' | 'error: ...').
//
// URL parameters (ARCHITECTURE.md section 8): shot=1 · cam=<preset> · only=a,b · hide=a,b · q=draft|normal|fine ·
//   env=studio|showroom|sunset|night · paint=<index|hex> · wheel=<index> · floor=0|1 · bloom=0|1 · debug=normals|ao|albedo|wire|silhouette|zebra ·
//   time=<sec>. Extras: drs=0|1 headlights=0|1 brake=0|1 spin=0|1 exposure=<x> msaa=<0|2|4|8> ui=0 autorotate=0|1 fps=1 shadows=0|1
//   reflections=0|1 gfx=low|medium|high|ultra refl=<reflection scale 0.25..1> shadowsize=<1024|2048|4096> adaptive=0.
// Controls: drag = orbit, right-drag / shift-drag / two-finger drag = pan, wheel / pinch = zoom (1.2 .. 12 m), double-click = reset,
//   H = hide UI, Space = auto-rotate, R = reset, D = DRS, L = headlights, B = brake lights, W = wheel spin, G = cycle graphics quality,
//   O = cycle the modelling overlay (off -> grid+reference -> reference only -> off).  In ORTHO views drag = pan, wheel = zoom about the cursor.
//
// ============================================================================================================
// MODELLING AIDS (for part authors; all of them are inert unless asked for; js/app_tools.js holds the implementation)
// ============================================================================================================
// 1) MODULE SELECTION   ?mods=wheels,aero   builds ONLY those modules (names as passed to PG.registerModule; default = all). A leading '-'
//      excludes instead: ?mods=-interior (everything but the interior); ?mods=all = default. Unknown names print one console warning.
//      Skipped modules get PG.moduleStatus[name] = 'skipped'. PG_APP.builtModules lists what actually ran. Modules must tolerate missing
//      neighbours (guard `ctx.shared.body`). Example: node tools/shot.js --url "index.html?shot=1&mods=body" --out shots/x.png --cams side
// 2) ORTHOGRAPHIC CAMERAS  presets oside (left, nose left) osider (right) otop (nose left, +Z = car's right side up) ofront orear; or
//      PG_APP.setCamera({ortho:true, view:'side'|'sider'|'top'|'front'|'rear', scale:<CSS pixels per metre | 'fit'>, target:[x,y,z]}) -> Promise.
//      'fit' (default) frames the car with a margin and follows window resizes until the user zooms; a target is optional (defaults to the car
//      centre of that view). {ortho:true, az, el, scale} gives an arbitrary parallel view (overlay only for axis-aligned ones). A later
//      perspective setCamera / preset leaves ortho mode. The projection is a true parallel projection (renderer setOrtho), depth range covers
//      the whole car, so silhouettes and measurements are exact: 1 m = `scale` CSS pixels on screen at every depth. In ortho views drag = pan and
//      the wheel zooms about the cursor (scale 15 .. 6000 px/m). PG_APP.getCamera() then also returns {ortho, view, scale, halfHeight}.
//      ?cam=oside works as URL parameter; node tools/shot.js ... --cams oside,otop,ofront,orear.
// 3) OVERLAY   ?overlay=1|all|refs|grid   or  PG_APP.setOverlay(true | 'refs' | 'grid' | false) -> the mode.   A 2D canvas (#overlay) above the WebGL
//      canvas, redrawn only when the view changes, drawn only in axis-aligned ortho views (harmlessly ignored in perspective) and part of every
//      Page.captureScreenshot / PG_APP.screenshot(). Contents: metric grid (0.1 m minor, 0.5 m major, labelled in metres), ground line,
//      mid-wheelbase / centre line, axle centres + wheel circles (cyan: tyre + rim; dashed = rear) or tread rectangles from PG.spec, the REFERENCE
//      TARGET in RED (side: the PG.spec.profile outline with labelled control points: tail top, duck-tail, deck crest, deck start, rear window top,
//      roof peak, roof front, cowl, hood mid, nose top, nose face, splitter tip, underbody, diffuser edge; top: mirrored planHalfWidth polyline;
//      front/rear: width x roof-height box + wing envelope + mirror tips) and amber crosses for the anchors (wing foot / LE / TE / plate, mirror,
//      headlight, tail-light bar, exhaust, door handle, hood outlet, fender louvre, roof fin, seats, steering wheel). 'refs' = no grid, 'grid' = no reference.
//      PG_APP.reference() returns the target tables (top, bottom, outline, plan, anchors); PG_APP.referenceAt(view, xs, full) samples them.
// 4) DEBUG VIEWS   ?debug=silhouette  flat dark-grey unlit car on a plain white background (no floor, shadow, environment, bloom, vignette, grain,
//      dither; MSAA forced >= 8x) - combine with ortho: index.html?shot=1&debug=silhouette&cam=oside.
//      ?debug=zebra  every part shows black/white zebra stripes of its perfect-mirror reflection (unlit, mid-grey background): judge surface
//      continuity (breaks and wobbles in the stripes = curvature errors). 24 stripes per 180 degrees around a diagonal axis
//      (renderer.settings.zebraStripes / zebraAxis, live). PG_APP.setDebug('silhouette' | 'zebra' | 'normals' | ... | '').
// 5) NUMERIC PROFILES   PG_APP.scan({view:'side'|'top'|'front'|'rear', step:0.1, scale:'fit'|<px/m>, range:[a,b], samples:[..]}) -> Promise: renders a
//      silhouette-mode ortho frame (restores the previous camera / debug / overlay afterwards), reads the pixels back and returns per column
//      {h, hi, lo} = world coordinates of the upper / lower silhouette edge (sub-pixel), plus `extent` and `mmPerPx`. `node tools/profile.js` prints
//      it as a table next to the reference target (deviation in mm):
//        node tools/profile.js --url "index.html?shot=1&mods=body" --view side|top|front|rear [--step 0.1] [--ref body|full] [--w 2400 --h 1200]
// 6) CPU PROBES   PG_APP.probe(x, z, {module:'body', yStart:3}) -> {x, z, found, top, topNormal, bottom, hits:[{y, normal, front}]} : vertical ray through the
//      CPU mesh of ctx.shared[module] (default 'body'; needs a .raycaster); PG_APP.probeAt([x,y,z], [dx,dy,dz], opts?) -> {t, point, normal, front,
//      faceIndex} | null.  Both return null (never throw) when the module or its raycaster does not exist.  PG_APP.raycaster(module?) gives the object.
// ============================================================================================================
(function () {
  const PG = window.PG;
  if (!PG.tools) {       // companion file with the modelling aids (overlay, reference target, scan, probe); resolved next to this script
    const cs = document.currentScript, base = cs && cs.src ? cs.src.replace(/app\.js(\?.*)?$/, '') : 'js/';
    document.write('<script src="' + base + 'app_tools.js"><\/script>');
  }
  const util = PG.util;
  const params = new URLSearchParams(location.search);
  const SHOT = params.has('shot') && params.get('shot') !== '0';
  const QUALITY = { draft: 1.8, normal: 1.0, fine: 0.7 }[params.get('q') || 'normal'] || 1.0;
  const clamp = util.clamp;
  const D2R = Math.PI / 180;

  window.__ready = false;
  window.__status = 'loading: starting';

  // ---------------------------------------------------------------------------------------------- DOM helpers
  function el(tag, cls, text, parent) {
    const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; if (parent) parent.appendChild(e); return e;
  }
  function ensureDom() {
    let canvas = document.getElementById('c');
    if (!canvas) { canvas = el('canvas'); canvas.id = 'c'; canvas.tabIndex = 0; canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none'; document.body.appendChild(canvas); }
    let overlay = document.getElementById('overlay');
    if (!overlay) { overlay = el('canvas'); overlay.id = 'overlay'; overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:4'; canvas.after(overlay); }
    let loading = document.getElementById('loading');
    if (!loading) {
      loading = el('div'); loading.id = 'loading'; loading.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b0c0e;z-index:10;transition:opacity .6s;color:#e9e9ea;font:12px -apple-system,Helvetica,Arial,sans-serif';
      loading.innerHTML = '<div class="t" style="letter-spacing:.35em;text-transform:uppercase;opacity:.7">911 GT3 RS</div><div style="width:260px;height:2px;background:#222;margin-top:18px;overflow:hidden"><i id="loadbar" style="display:block;height:100%;width:0;background:#d5001c;transition:width .2s"></i></div><div id="loadtext" style="margin-top:12px;font-size:11px;opacity:.45;min-height:14px"></div>';
      document.body.appendChild(loading);
    }
    let ui = document.getElementById('ui'); if (!ui) { ui = el('div'); ui.id = 'ui'; document.body.appendChild(ui); }
    return { canvas, overlay, loading, ui, bar: document.getElementById('loadbar'), text: document.getElementById('loadtext') };
  }
  const dom = ensureDom();

  const UI_CSS = `
#ui{position:fixed;inset:0;z-index:5;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;color:rgba(233,233,234,.68);user-select:none;-webkit-user-select:none;transition:opacity .35s}
#ui.hidden{opacity:0}#ui.hidden *{pointer-events:none!important}
#ui button{all:unset;box-sizing:border-box;cursor:pointer;pointer-events:auto;font:inherit;text-transform:uppercase;letter-spacing:.18em;font-size:10px;line-height:1;color:inherit;transition:color .2s,opacity .2s}
#ui button:hover{color:#fff}#ui button:focus-visible{outline:1px solid rgba(255,255,255,.5);outline-offset:3px}
#ui .brand{position:absolute;left:32px;top:28px}
#ui .brand .a{font-size:9px;letter-spacing:.55em;text-transform:uppercase;opacity:.75}
#ui .brand .b{margin-top:9px;font-size:19px;font-weight:300;letter-spacing:.14em;text-transform:uppercase;color:#f2f2f3}
#ui .brand .c{margin-top:8px;font-size:9px;letter-spacing:.3em;text-transform:uppercase;opacity:.45}
#ui .brand .r{width:22px;height:2px;background:#d5001c;margin-top:12px}
#ui .col{position:absolute;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:26px}
#ui .left{left:32px;width:176px;top:calc(50% + 34px)}#ui .right{right:32px;align-items:flex-end;width:120px}
#ui h4{margin:0 0 11px;font-weight:400;font-size:9px;letter-spacing:.32em;text-transform:uppercase;color:rgba(233,233,234,.36);padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,.09)}
#ui .right h4{align-self:stretch;text-align:right}
#ui .sws{display:flex;flex-wrap:wrap;gap:9px 8px}
#ui .sw{width:15px;height:15px;border-radius:50%;background:var(--c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);position:relative}
#ui .sw.on::after{content:"";position:absolute;inset:-5px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.85)}
#ui .lbl{margin-top:11px;font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:rgba(233,233,234,.75);min-height:10px}
#ui .list{display:flex;flex-direction:column;gap:11px}
#ui .right .list{align-items:flex-end}
#ui .opt.on{color:#fff}
#ui .right .opt.on::before{content:"";display:inline-block;width:14px;height:1px;background:#d5001c;vertical-align:middle;margin-right:9px}
#ui .left .opt.on::before{content:"";display:inline-block;width:14px;height:1px;background:#d5001c;vertical-align:middle;margin-right:9px;margin-left:-23px}
#ui .left .opt{padding-left:0}
#ui .tg{display:flex!important;align-items:center;justify-content:space-between;width:100%}
#ui .tg i{width:20px;height:9px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.28);position:relative;flex:none;transition:box-shadow .2s,background .2s}
#ui .tg i::after{content:"";position:absolute;top:2px;left:2px;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.5);transition:left .2s,background .2s}
#ui .tg.on{color:#fff}#ui .tg.on i{box-shadow:inset 0 0 0 1px #d5001c;background:rgba(213,0,28,.25)}#ui .tg.on i::after{left:13px;background:#ff2a44}
#ui .hint{position:absolute;left:0;right:0;bottom:20px;text-align:center;font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:rgba(233,233,234,.26)}
#ui .fps{position:absolute;left:32px;bottom:20px;font:10px ui-monospace,Menlo,monospace;color:rgba(255,255,255,.5);letter-spacing:0}
#loading .err{margin-top:18px;max-width:560px;text-align:center;font-size:12px;line-height:1.6;color:#ff6b7c;white-space:pre-wrap}
@media (max-height:780px){#ui .col{gap:16px}#ui .left{top:calc(50% + 46px)}#ui .list{gap:8px}#ui .brand .c,#ui .brand .r{display:none}#ui h4{margin-bottom:8px}}
#ui .lbl{white-space:nowrap}
@media (max-width:900px){#ui .right{display:none}#ui .left{width:150px}#ui .hint{display:none}}
`;
  if (!document.getElementById('pg-ui-css')) { const st = el('style'); st.id = 'pg-ui-css'; st.textContent = UI_CSS; document.head.appendChild(st); }

  // ---------------------------------------------------------------------------------------------- loading overlay
  const loadState = { frac: 0, label: '' };
  function setProgress(frac, label) {
    loadState.frac = Math.max(loadState.frac, clamp(frac, 0, 1)); if (label) loadState.label = label;
    if (dom.bar) dom.bar.style.width = (loadState.frac * 100).toFixed(1) + '%';
    if (dom.text) dom.text.textContent = loadState.label;
    window.__status = 'loading: ' + loadState.label;
  }
  function fatal(msg, detail) {
    console.error('[PG] fatal:', msg, detail || '');
    window.__status = 'error: ' + msg;
    dom.loading.style.display = 'flex'; dom.loading.style.opacity = '1'; dom.loading.style.pointerEvents = 'auto';
    if (dom.bar) dom.bar.parentNode.style.display = 'none';
    if (dom.text) dom.text.textContent = '';
    let e = dom.loading.querySelector('.err'); if (!e) e = el('div', 'err', '', dom.loading);
    e.textContent = msg;
  }

  // ---------------------------------------------------------------------------------------------- camera presets
  // Camera model: position = target + dist * (cos(el) cos(az), sin(el), cos(el) sin(az)); az=0 looks at the nose, +90 = car's right.
  // Ortho presets: { ortho:true, view, scale:'fit'|px per metre, target? } (see MODELLING AIDS in the header).
  const T_CAR = [0.1, 0.52, 0];
  const CLOSE = { min: 0.3, max: 12 };
  const presets = {
    hero: { az: -38, el: 9, dist: 6.5, target: [0.12, 0.5, 0], fov: 30 },
    front34: { az: -35, el: 8, dist: 6.8, target: T_CAR, fov: 30 },
    front34r: { az: 35, el: 8, dist: 6.8, target: T_CAR, fov: 30 },
    rear34: { az: -145, el: 8, dist: 6.8, target: T_CAR, fov: 30 },
    rear34r: { az: 145, el: 8, dist: 6.8, target: T_CAR, fov: 30 },
    side: { az: -90, el: 0, dist: 8.4, target: [0, 0.6, 0], fov: 28 },
    sider: { az: 90, el: 0, dist: 8.4, target: [0, 0.6, 0], fov: 28 },
    front: { az: 0, el: 4, dist: 6.0, target: [0, 0.62, 0], fov: 28 },
    rear: { az: 180, el: 4, dist: 6.0, target: [0, 0.68, 0], fov: 28 },
    top: { az: 90, el: 88, dist: 7.6, target: [0, 0.3, 0], fov: 30 },
    low: { az: -32, el: 2, dist: 6.0, target: [0.1, 0.42, 0], fov: 30 },
    wheelF: { az: -68, el: 5, dist: 2.5, target: [1.23, 0.4, -0.78], fov: 28, limits: CLOSE },       // front-left wheel (the visible one from the left presets)
    wheelR: { az: -108, el: 5, dist: 2.7, target: [-1.23, 0.42, -0.76], fov: 28, limits: CLOSE },    // rear-left wheel
    wheelFr: { az: 68, el: 5, dist: 2.5, target: [1.23, 0.4, 0.78], fov: 28, limits: CLOSE },        // front-right wheel
    wheelRr: { az: 108, el: 5, dist: 2.7, target: [-1.23, 0.42, 0.76], fov: 28, limits: CLOSE },     // rear-right wheel
    wing: { az: -140, el: 15, dist: 3.7, target: [-2.05, 1.25, 0], fov: 30, limits: CLOSE },
    rearhi: { az: -145, el: 28, dist: 4.2, target: [-1.85, 1.1, 0], fov: 30, limits: CLOSE },        // high rear 3/4: wing, engine lid, duck-tail
    nose: { az: -28, el: 6, dist: 3.5, target: [1.95, 0.5, -0.05], fov: 32, limits: CLOSE },
    frontlow: { az: -32, el: 3, dist: 3.3, target: [2.0, 0.34, -0.1], fov: 32, limits: CLOSE },      // low front 3/4: splitter, bumper, headlights
    tail: { az: -152, el: 8, dist: 3.7, target: [-2.1, 0.72, 0], fov: 32, limits: CLOSE },
    tailL: { az: -138, el: 7, dist: 2.7, target: [-2.2, 0.55, -0.35], fov: 32, limits: CLOSE },      // close rear-left: tail-light bar, bumper, exhaust, diffuser
    roof: { az: 180, el: 20, dist: 3.4, target: [-0.35, 1.12, 0], fov: 34, limits: CLOSE },          // from behind, looking down the roof / rear deck
    sillL: { az: -80, el: 3, dist: 2.4, target: [-0.05, 0.36, -0.86], fov: 30, limits: CLOSE },      // low close side view: left sill and lower door
    lidL: { az: -50, el: 32, dist: 2.5, target: [1.3, 0.83, -0.35], fov: 30, limits: CLOSE },        // from above / front-left: front lid and left fender crest
    cockpit: { az: 180, el: 3, dist: 0.95, target: [0.55, 0.9, -0.3], fov: 64, limits: { min: 0.15, max: 2.2 } },
    // orthographic modelling views (true parallel projection, scale 'fit' = car fills the window)
    oside: { ortho: true, view: 'side', scale: 'fit' },
    osider: { ortho: true, view: 'sider', scale: 'fit' },
    otop: { ortho: true, view: 'top', scale: 'fit' },
    ofront: { ortho: true, view: 'front', scale: 'fit' },
    orear: { ortho: true, view: 'rear', scale: 'fit' },
  };
  const PRESET_ORDER = ['hero', 'front34', 'front34r', 'side', 'sider', 'rear34', 'rear34r', 'front', 'rear', 'top', 'low', 'nose', 'tail', 'wheelF', 'wheelR', 'wing', 'cockpit'];
  // presets that appear in the UI list of the showcase (the rest is for modelling / detail shots: ?dev=1 lists everything)
  const UI_HIDDEN = /^(o(side|sider|top|front|rear)|wheelFr|wheelRr|rearhi|frontlow|roof|sillL|lidL|tailL)$/;

  // Ortho views: dir = from the target towards the eye, up = screen up. side = the car's LEFT flank (like the 'side' preset, nose on the left),
  // top = nose on the left and the car's right side (+Z) up, front = looking at the nose (car's left is on screen right).
  const ORTHO_VIEWS = {
    side: { dir: [0, 0, -1], up: [0, 1, 0], ctr: [-0.035, 0.725, 0], w: 4.75, h: 1.47, hx: 0, vx: 1 },
    sider: { dir: [0, 0, 1], up: [0, 1, 0], ctr: [-0.035, 0.725, 0], w: 4.75, h: 1.47, hx: 0, vx: 1 },
    top: { dir: [0, 1, 0], up: [0, 0, 1], ctr: [-0.035, 0.5, 0], w: 4.75, h: 2.15, hx: 0, vx: 2 },
    front: { dir: [1, 0, 0], up: [0, 1, 0], ctr: [0, 0.725, 0], w: 2.15, h: 1.47, hx: 2, vx: 1 },
    rear: { dir: [-1, 0, 0], up: [0, 1, 0], ctr: [0, 0.725, 0], w: 2.15, h: 1.47, hx: 2, vx: 1 },
  };
  const ORTHO_DIST = 60;                       // eye distance (only matters for the shading view vector and the depth range)
  const SCALE_LIMITS = { min: 15, max: 6000 };

  const DEFAULT_LIMITS = { min: 1.2, max: 12 };
  const cam = { az: -38, el: 9, dist: 6.5, target: [0.12, 0.5, 0], fov: 30, ortho: false, view: null, scale: 300, fit: false };
  let limits = DEFAULT_LIMITS, activePreset = 'hero';
  let tween = null, vAz = 0, vEl = 0, dragging = false, lastInteract = -100, arRamp = 0, autoRotate = !SHOT && params.get('autorotate') !== '0';
  const eye = [0, 1, 6];
  const BOX0 = { min: [-3.2, 0.0, -2.2], max: [3.2, 2.4, 2.2] };
  const TARGET_BOX = { min: BOX0.min.slice(), max: BOX0.max.slice() };   // pan limits; widened automatically for presets outside it
  function fitBox(t) { for (let i = 0; i < 3; i++) { TARGET_BOX.min[i] = Math.min(BOX0.min[i], t[i] - 0.5); TARGET_BOX.max[i] = Math.max(BOX0.max[i], t[i] + 0.5); } }
  const FLOOR_EPS = 0.06;

  const canvasCss = () => [dom.canvas.clientWidth || window.innerWidth, dom.canvas.clientHeight || window.innerHeight];
  function fitScale(view) {                    // CSS px per metre that frames the car in the current window
    const V = ORTHO_VIEWS[view] || ORTHO_VIEWS.side, c = canvasCss();
    return Math.min(c[0] * 0.90 / V.w, c[1] * 0.86 / V.h);
  }
  function orthoDir(c) {                       // {dir, up} of the current ortho camera state
    const V = c.view && ORTHO_VIEWS[c.view];
    if (V) return { dir: V.dir, up: V.up };
    const a = c.az * D2R, e = c.el * D2R, ce = Math.cos(e);
    return { dir: [ce * Math.cos(a), Math.sin(e), ce * Math.sin(a)], up: Math.abs(c.el) > 85 ? [-Math.cos(a), 0, -Math.sin(a)] : [0, 1, 0] };
  }
  function orthoBasis() {                      // screen right / up in world space for the current ortho camera
    const d = orthoDir(cam), f = [-d.dir[0], -d.dir[1], -d.dir[2]];
    let r = [f[1] * d.up[2] - f[2] * d.up[1], f[2] * d.up[0] - f[0] * d.up[2], f[0] * d.up[1] - f[1] * d.up[0]]; const l = Math.hypot(r[0], r[1], r[2]) || 1; r = [r[0] / l, r[1] / l, r[2] / l];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { right: r, up: u };
  }
  // Partial camera description -> full description (also switches between perspective and ortho).
  function normCam(p) {
    const o = {};
    if (p.az !== undefined) o.az = p.az; if (p.el !== undefined) o.el = p.el; if (p.dist !== undefined) o.dist = p.dist; if (p.fov !== undefined) o.fov = p.fov;
    if (p.target) o.target = p.target.slice(0, 3);
    const persp = p.az !== undefined || p.el !== undefined || p.dist !== undefined || p.fov !== undefined;
    const wantOrtho = p.ortho !== undefined ? !!p.ortho : (p.view !== undefined ? true : (persp ? false : cam.ortho));
    o.ortho = wantOrtho;
    if (wantOrtho) {
      if (p.view !== undefined) { if (!ORTHO_VIEWS[p.view]) { console.warn('[PG_APP] unknown ortho view "' + p.view + '" (side|sider|top|front|rear)'); o.view = 'side'; } else o.view = p.view; }
      else if (!persp && cam.ortho) o.view = cam.view; else o.view = persp ? null : 'side';
      if (p.scale !== undefined) { if (p.scale === 'fit' || p.scale === undefined) { o.fit = true; } else { o.scale = clamp(+p.scale || 300, SCALE_LIMITS.min, SCALE_LIMITS.max); o.fit = false; } }
      else if (p.view !== undefined || !cam.ortho) o.fit = true;
      if (o.fit) o.scale = fitScale(o.view || 'side');
      if (!p.target && (p.view !== undefined || !cam.ortho) && ORTHO_VIEWS[o.view]) o.target = ORTHO_VIEWS[o.view].ctr.slice();
    }
    return o;
  }
  function clampCam() {
    if (cam.ortho) { cam.scale = clamp(cam.scale, SCALE_LIMITS.min, SCALE_LIMITS.max); }
    else {
      cam.dist = clamp(cam.dist, limits.min, limits.max);
      let minEl = -2;
      const need = (FLOOR_EPS - cam.target[1]) / cam.dist;                // keep the eye above the floor
      if (need > -1 && need < 1) minEl = Math.max(minEl, Math.asin(need) / D2R);
      cam.el = clamp(cam.el, minEl, 88);
    }
    for (let i = 0; i < 3; i++) cam.target[i] = clamp(cam.target[i], TARGET_BOX.min[i], TARGET_BOX.max[i]);
  }
  function camEye(out) {
    if (cam.ortho) { const d = orthoDir(cam).dir; for (let i = 0; i < 3; i++) out[i] = cam.target[i] + d[i] * ORTHO_DIST; return out; }
    const a = cam.az * D2R, e = cam.el * D2R, ce = Math.cos(e);
    out[0] = cam.target[0] + cam.dist * ce * Math.cos(a); out[1] = cam.target[1] + cam.dist * Math.sin(e); out[2] = cam.target[2] + cam.dist * ce * Math.sin(a);
    return out;
  }
  // hands the current camera to the renderer (perspective or orthographic)
  function applyCameraToRenderer(r) {
    camEye(eye);
    if (cam.ortho) {
      const h = canvasCss()[1];
      r.setOrtho(eye, cam.target, (h / 2) / cam.scale, { up: orthoDir(cam).up });
    } else r.setCamera(eye, cam.target, cam.fov);
  }
  const angDiff = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  let frameCount = 0; const frameWaiters = [];
  const waitFrames = n => new Promise(res => frameWaiters.push({ at: frameCount + n, res }));

  function setCamera(arg, opts) {
    introPending = false;
    let p, name = null;
    if (typeof arg === 'string') { p = presets[arg]; name = arg; if (!p) { console.warn('[PG_APP] unknown camera preset "' + arg + '"'); return waitFrames(2); } }
    else p = arg || {};
    const n = normCam(p);
    const to = Object.assign({ az: cam.az, el: cam.el, dist: cam.dist, fov: cam.fov, target: cam.target.slice(), ortho: cam.ortho, view: cam.view, scale: cam.scale, fit: cam.fit }, n);
    limits = (p.limits ? Object.assign({}, DEFAULT_LIMITS, p.limits) : DEFAULT_LIMITS); activePreset = name; syncPresetUI(); fitBox(to.target);
    vAz = vEl = 0;
    const instant = SHOT || (opts && opts.instant) || to.ortho || cam.ortho;     // no tweening into / out of / within ortho views
    if (instant) {
      tween = null; Object.assign(cam, { az: to.az, el: to.el, dist: to.dist, fov: to.fov, target: to.target, ortho: to.ortho, view: to.view, scale: to.scale, fit: to.fit }); clampCam();
      overlayDirty = true;
      return waitFrames(2);
    }
    // keep the tween's own end state unclamped by the *previous* limits
    tween = { t: 0, dur: (opts && opts.duration) || 1.3, from: { az: cam.az, el: cam.el, dist: cam.dist, fov: cam.fov, target: cam.target.slice() }, to, waiters: [] };
    return new Promise(res => tween.waiters.push(res)).then(() => waitFrames(2));
  }
  function updateCamera(dt, now) {
    if (tween) {
      tween.t += dt / tween.dur; const k = ease(Math.min(1, tween.t)), f = tween.from, t = tween.to;
      cam.az = f.az + angDiff(f.az, t.az) * k; cam.el = f.el + (t.el - f.el) * k; cam.fov = f.fov + (t.fov - f.fov) * k;
      cam.dist = Math.exp(Math.log(f.dist) + (Math.log(t.dist) - Math.log(f.dist)) * k);
      for (let i = 0; i < 3; i++) cam.target[i] = f.target[i] + (t.target[i] - f.target[i]) * k;
      if (tween.t >= 1) { const w = tween.waiters; tween = null; w.forEach(r => r()); }
    } else if (!dragging && !cam.ortho) {
      if (Math.abs(vAz) > 0.01 || Math.abs(vEl) > 0.01) {
        cam.az += vAz * dt; cam.el += vEl * dt; const d = Math.exp(-dt * 4.2); vAz *= d; vEl *= d;
      }
      const idle = now - lastInteract > 2.5;
      arRamp += ((autoRotate && idle && !SHOT ? 1 : 0) - arRamp) * (1 - Math.exp(-dt * 1.5));
      if (arRamp > 0.001) cam.az += 5.5 * arRamp * dt;
    }
    if (cam.ortho && cam.fit) cam.scale = fitScale(cam.view || 'side');
    if (cam.az > 360) cam.az -= 360; else if (cam.az < -360) cam.az += 360;
    clampCam();
  }

  // ---------------------------------------------------------------------------------------------- input
  function setupInput(canvas) {
    const ptrs = new Map(); let lastT = 0, pinch = null, moved = 0;
    const touch = () => { lastInteract = now(); activePreset = null; syncPresetUI(); tween = null; };
    const now = () => performance.now() / 1000;
    function pan(dx, dy) {
      if (cam.ortho) {           // drag moves the scene with the cursor (1 CSS px = 1/scale metres)
        const b = orthoBasis(), k = 1 / cam.scale; cam.fit = false;
        for (let i = 0; i < 3; i++) cam.target[i] += (-dx * b.right[i] + dy * b.up[i]) * k;
        return;
      }
      const h = canvas.clientHeight || 1, k = 2 * cam.dist * Math.tan(cam.fov * D2R / 2) / h;
      const a = cam.az * D2R, e = cam.el * D2R, ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
      // camera basis: right = (sin az, 0, -cos az), up = (-cos az sin el, cos el, -sin az sin el)
      cam.target[0] += (-dx * sa + dy * -ca * se) * k;
      cam.target[1] += (dy * ce) * k;
      cam.target[2] += (dx * ca + dy * -sa * se) * k;
    }
    canvas.addEventListener('pointerdown', ev => {
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic pointer */ } canvas.focus({ preventScroll: true });
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, button: ev.button, shift: ev.shiftKey });
      dragging = true; moved = 0; vAz = vEl = 0; touch();
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist, scale: cam.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
      ev.preventDefault();
    });
    canvas.addEventListener('pointermove', ev => {
      const p = ptrs.get(ev.pointerId); if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y; const t = now(); const dt = Math.max(0.004, t - lastT); lastT = t;
      moved += Math.abs(dx) + Math.abs(dy); touch();
      if (ptrs.size === 1) {
        if (cam.ortho || p.button === 2 || p.shift || ev.shiftKey || ev.buttons === 2) pan(dx, dy);
        else { const dAz = dx * 0.25, dEl = dy * 0.25; cam.az += dAz; cam.el += dEl; vAz += (dAz / dt - vAz) * 0.5; vEl += (dEl / dt - vEl) * 0.5; }
      } else if (ptrs.size === 2 && pinch) {
        p.x = ev.clientX; p.y = ev.clientY;
        const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (cam.ortho) { cam.scale = clamp(pinch.scale * d / Math.max(pinch.d, 1), SCALE_LIMITS.min, SCALE_LIMITS.max); cam.fit = false; }
        else cam.dist = clamp(pinch.dist * pinch.d / Math.max(d, 1), limits.min, limits.max);
        pan(cx - pinch.cx, cy - pinch.cy); pinch.cx = cx; pinch.cy = cy;
      }
      p.x = ev.clientX; p.y = ev.clientY;
    });
    const up = ev => {
      if (!ptrs.has(ev.pointerId)) return; ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 0) { dragging = false; if (now() - lastT > 0.08) vAz = vEl = 0; lastInteract = now(); }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('wheel', ev => {
      ev.preventDefault(); touch();
      const k = ev.deltaMode === 1 ? 16 : 1;
      if (cam.ortho) {            // zoom about the cursor: the world point under the pointer stays under the pointer
        const s0 = cam.scale, s1 = clamp(s0 * Math.exp(-ev.deltaY * k * 0.0012), SCALE_LIMITS.min, SCALE_LIMITS.max), b = orthoBasis(), rc = canvas.getBoundingClientRect();
        const dx = ev.clientX - rc.left - rc.width / 2, dy = ev.clientY - rc.top - rc.height / 2, f = 1 / s0 - 1 / s1;
        for (let i = 0; i < 3; i++) cam.target[i] += (b.right[i] * dx - b.up[i] * dy) * f;
        cam.scale = s1; cam.fit = false; return;
      }
      cam.dist = clamp(cam.dist * Math.exp(ev.deltaY * k * 0.0012), limits.min, limits.max);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => setCamera('hero'));
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  }

  // ---------------------------------------------------------------------------------------------- state (eased UI-driven values)
  const S = PG.state;
  const target = { drs: S.drs || 0, headlights: S.headlights === undefined ? 1 : S.headlights, brake: S.brake || 0, spin: S.spin === undefined ? 1 : S.spin };
  const vel = { drs: 0, headlights: 0, brake: 0, spin: 0 }, SMOOTH = { drs: 0.6, headlights: 0.14, brake: 0.1, spin: 0.9 };
  function smoothDamp(cur, tgt, v, st, dt) {   // critically damped spring (Game Programming Gems 4)
    const w = 2 / st, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const ch = cur - tgt, tmp = (v + w * ch) * dt; const nv = (v - w * tmp) * e; let out = tgt + (ch + tmp) * e;
    if (Math.abs(out - tgt) < 5e-4 && Math.abs(nv) < 5e-3) return [tgt, 0];
    return [out, nv];
  }
  function updateState(dt) {
    for (const k in target) { if (S[k] === target[k] && !vel[k]) continue; const r = smoothDamp(S[k], target[k], vel[k], SMOOTH[k], dt); S[k] = r[0]; vel[k] = r[1]; }
  }

  // ---------------------------------------------------------------------------------------------- paint / wheels / env
  let paintIdx = 0, wheelIdx = 0, envName = 'studio';
  const uiRefs = { paint: [], wheel: [], env: [], presets: {}, toggles: {} };
  function applyPaint(p) {
    const M = PG.mats.paint; M.baseColor = util.hex(p.hex);
    const m = p.metallic || 0;
    M.metallic = Math.min(0.75, m * 0.95); M.flake = clamp(m * 1.5, 0, 1);
    M.roughness = 0.42 - m * 0.1;
  }
  function setPaint(v) {
    const list = PG.spec.paints; let p = null, idx = -1;
    if (typeof v === 'number' || /^\d{1,2}$/.test(String(v))) { idx = clamp(parseInt(v, 10), 0, list.length - 1); p = list[idx]; }
    else { const h = String(v).replace('#', ''); if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(h)) { p = { name: '#' + h, hex: '#' + h, metallic: 0.0 }; idx = list.findIndex(q => q.hex.toLowerCase() === '#' + h.toLowerCase()); if (idx >= 0) p = list[idx]; } }
    if (!p) return;
    paintIdx = idx; applyPaint(p); uiRefs.paint.forEach((b, i) => b.classList.toggle('on', i === idx)); if (uiRefs.paintLabel) uiRefs.paintLabel.textContent = p.name;
  }
  function setWheel(i) {
    const list = PG.spec.wheelFinishes; i = clamp(i | 0, 0, list.length - 1); const f = list[i], M = PG.mats.wheel;
    M.baseColor = util.hex(f.hex); M.metallic = f.metallic; M.roughness = f.roughness; wheelIdx = i;
    uiRefs.wheel.forEach((b, k) => b.classList.toggle('on', k === i)); if (uiRefs.wheelLabel) uiRefs.wheelLabel.textContent = f.name;
  }
  let renderer = null;
  // Switching is instant for already generated environments; a new one is generated over a few frames (no UI freeze).
  // Returns a Promise (resolved when the environment is active). In shot mode the switch is synchronous.
  function setEnv(name) {
    if (!renderer || !PG.envDefs[name]) return Promise.resolve();
    envName = name;
    uiRefs.env.forEach(b => b.classList.toggle('on', b.dataset.k === name));
    if (SHOT || renderer._envCache[name]) { renderer.setEnvironment(name); return Promise.resolve(); }
    return renderer.setEnvironmentAsync(name).then(() => {}, e => console.error('[PG] environment "' + name + '" failed:', e));
  }

  // ---------------------------------------------------------------------------------------------- UI
  let uiHidden = false;
  function hideUI(h) { uiHidden = h === undefined ? !uiHidden : !!h; dom.ui.classList.toggle('hidden', uiHidden); }
  function syncPresetUI() { for (const k in uiRefs.presets) uiRefs.presets[k].classList.toggle('on', k === activePreset); }
  function syncToggles() { for (const k in uiRefs.toggles) uiRefs.toggles[k].b.classList.toggle('on', !!uiRefs.toggles[k].get()); }

  function buildUI() {
    const ui = dom.ui; ui.innerHTML = '';
    const brand = el('div', 'brand', '', ui);
    el('div', 'a', 'Porsche', brand); el('div', 'b', '911 GT3 RS', brand); el('div', 'c', 'Type 992 · Procedural', brand); el('div', 'r', '', brand);

    const left = el('div', 'col left', '', ui);
    const sec = (parent, title) => { const s = el('div', 'sec', '', parent); el('h4', '', title, s); return s; };
    // paint
    let s = sec(left, 'Paint'); let w = el('div', 'sws', '', s);
    PG.spec.paints.forEach((p, i) => { const b = el('button', 'sw', '', w); b.style.setProperty('--c', p.hex); b.title = p.name; b.setAttribute('aria-label', p.name); b.onclick = () => setPaint(i); uiRefs.paint.push(b); });
    uiRefs.paintLabel = el('div', 'lbl', '', s);
    // wheels
    s = sec(left, 'Wheels'); w = el('div', 'sws', '', s);
    PG.spec.wheelFinishes.forEach((f, i) => { const b = el('button', 'sw', '', w); b.style.setProperty('--c', f.hex); b.title = f.name; b.setAttribute('aria-label', f.name); b.onclick = () => setWheel(i); uiRefs.wheel.push(b); });
    uiRefs.wheelLabel = el('div', 'lbl', '', s);
    // environment
    s = sec(left, 'Environment'); w = el('div', 'list', '', s);
    Object.keys(PG.envDefs).forEach(k => { const b = el('button', 'opt', PG.envDefs[k].label || k, w); b.dataset.k = k; b.onclick = () => setEnv(k); uiRefs.env.push(b); });
    // systems
    s = sec(left, 'Systems'); w = el('div', 'list', '', s);
    const toggle = (key, label, get, set) => { const b = el('button', 'tg', label, w); el('i', '', '', b); b.onclick = () => { set(!get()); syncToggles(); }; b.setAttribute('aria-pressed', 'false'); uiRefs.toggles[key] = { b, get }; };
    toggle('drs', 'DRS wing', () => target.drs > 0.5, v => { target.drs = v ? 1 : 0; });
    toggle('headlights', 'Headlights', () => target.headlights > 0.5, v => { target.headlights = v ? 1 : 0; });
    toggle('brake', 'Brake lights', () => target.brake > 0.5, v => { target.brake = v ? 1 : 0; });
    toggle('spin', 'Wheel spin', () => target.spin > 0.5, v => { target.spin = v ? 1 : 0; });
    toggle('auto', 'Auto-rotate', () => autoRotate, v => { autoRotate = v; lastInteract = -100; });

    // camera presets
    const right = el('div', 'col right', '', ui); s = sec(right, 'View'); w = el('div', 'list', '', s);
    const dev = params.get('dev') === '1';
    const names = PRESET_ORDER.filter(n => presets[n]).concat(Object.keys(presets).filter(n => !PRESET_ORDER.includes(n) && (dev || !UI_HIDDEN.test(n))));
    names.forEach(n => { const b = el('button', 'opt', n, w); b.onclick = () => setCamera(n); uiRefs.presets[n] = b; });
    el('div', 'hint', 'Drag orbit · Scroll zoom · Right-drag pan · H hide', ui);
    if (params.get('fps') === '1') uiRefs.fps = el('div', 'fps', '', ui);
    syncToggles(); syncPresetUI(); setPaint(paintIdx < 0 ? PG.spec.paints[0].hex : paintIdx); setWheel(wheelIdx); uiRefs.env.forEach(b => b.classList.toggle('on', b.dataset.k === envName));
    dom.ui.classList.toggle('hidden', SHOT || params.get('ui') === '0' || uiHidden);
    if (SHOT || params.get('ui') === '0') { uiHidden = true; dom.ui.style.transition = 'none'; }
  }

  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (k === 'h') hideUI();
    else if (k === ' ') { autoRotate = !autoRotate; lastInteract = -100; syncToggles(); ev.preventDefault(); }
    else if (k === 'r') setCamera('hero');
    else if (k === 'o') setOverlay(overlayMode === false ? true : overlayMode === true ? 'refs' : false);
    else if (k === 'd') { target.drs = target.drs > 0.5 ? 0 : 1; syncToggles(); }
    else if (k === 'l') { target.headlights = target.headlights > 0.5 ? 0 : 1; syncToggles(); }
    else if (k === 'b') { target.brake = target.brake > 0.5 ? 0 : 1; syncToggles(); }
    else if (k === 'w') { target.spin = target.spin > 0.5 ? 0 : 1; syncToggles(); }
    else if (k === 'g' && renderer) { const q = renderer.listQualities(), i = (q.indexOf(renderer.quality || 'high') + 1) % q.length; renderer.setQuality(q[i]); PG.log('graphics quality: ' + q[i]); }
  });

  // ---------------------------------------------------------------------------------------------- filters (only= / hide=)
  const filters = { only: (params.get('only') || '').split(',').map(s => s.trim()).filter(Boolean), hide: (params.get('hide') || '').split(',').map(s => s.trim()).filter(Boolean) };
  function applyFilters() {
    const { only, hide } = filters;
    renderer.filter = (only.length || hide.length) ? (p => (!only.length || only.some(o => p.name.startsWith(o))) && !hide.some(h => p.name.startsWith(h))) : null;
    renderer._occlDirty = true;
  }

  // ---------------------------------------------------------------------------------------------- module runner + main
  const updaters = []; const timings = {}; PG.moduleStatus = {};
  let fps = 60, msAvg = 16, lastNow = 0;
  // ---------------------------------------------------------------------------------------------- modelling overlay
  const parseOverlay = v => { if (v === null || v === undefined || v === false) return false; v = String(v).toLowerCase(); if (v === '' || v === '0' || v === 'false' || v === 'off') return false; return v === 'refs' || v === 'grid' ? v : true; };
  let overlayMode = params.has('overlay') ? parseOverlay(params.get('overlay')) : false, overlayDirty = true, ovDrawn = false, ovDbg = false;
  const ovSig = new Float32Array(16);
  function setOverlay(v) { overlayMode = parseOverlay(v === true ? '1' : v); overlayDirty = true; return overlayMode; }
  // redraws the overlay canvas when needed (call after r.render so the renderer's matrices are current)
  function updateOverlay(r) {
    const c = dom.overlay; if (!c) return;
    if (!(overlayMode && r.cam.ortho && PG.tools)) { if (ovDrawn) { c.getContext('2d').clearRect(0, 0, c.width, c.height); ovDrawn = false; } return; }
    const cs = canvasCss(), w = cs[0], h = cs[1], dpr = r.dpr, pw = Math.round(w * dpr), ph = Math.round(h * dpr), light = r.settings.debug === 'silhouette';
    let dirty = overlayDirty || !ovDrawn || c.width !== pw || c.height !== ph || light !== ovDbg;
    if (!dirty) for (let i = 0; i < 16; i++) if (ovSig[i] !== r.viewProj[i]) { dirty = true; break; }
    if (!dirty) return;
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    ovDrawn = PG.tools.drawOverlay(g, { W: w, H: h, viewProj: r.viewProj, view: r.view, mode: overlayMode, light, target: cam.target, name: activePreset || cam.view || '' });
    ovSig.set(r.viewProj); ovDbg = light; overlayDirty = false;
  }

  // ---------------------------------------------------------------------------------------------- silhouette scan (tools/profile.js)
  async function scanSilhouette(opts) {
    opts = opts || {}; const r = renderer; if (!r || !built) throw new Error('scan: the page is not ready');
    const view = opts.view || 'side'; if (!ORTHO_VIEWS[view]) throw new Error('scan: unknown view "' + view + '" (side|sider|top|front|rear)');
    const saved = { cam: JSON.parse(JSON.stringify(cam)), dbg: r.settings.debug, ov: overlayMode, preset: activePreset, limits, tween };
    overlayMode = false; overlayDirty = true; updateOverlay(r); r.settings.debug = 'silhouette';
    try {
      setCamera({ ortho: true, view, scale: opts.scale === undefined ? 'fit' : opts.scale, target: opts.target }, { instant: true });
      updateCamera(0, 0); applyCameraToRenderer(r);
      const spec = PG.spec, step = opts.step > 0 ? +opts.step : 0.1;
      let samples = opts.samples;
      if (!samples) {
        const rg = opts.range || (view === 'front' || view === 'rear' ? [-1.05, 1.05] : [spec.tailX, spec.noseX]);
        samples = []; for (let k = Math.ceil(rg[0] / step - 1e-9); k * step <= rg[1] + 1e-9; k++) samples.push(+(k * step).toFixed(6));
      }
      r.render(0);
      const px = r.readPixels(), res = PG.tools.scanPixels(r, px, samples);
      res.view = view; res.step = step; res.size = [r.width, r.height]; res.cssScale = cam.scale; res.target = cam.target.slice();
      return res;
    } finally {
      Object.assign(cam, saved.cam); limits = saved.limits; activePreset = saved.preset; r.settings.debug = saved.dbg; overlayMode = saved.ov; overlayDirty = true; syncPresetUI();
      if (cam.ortho && cam.fit) cam.scale = fitScale(cam.view || 'side');
      applyCameraToRenderer(r);
    }
  }

  const app = window.PG_APP = {
    presets, params, shot: SHOT, quality: QUALITY, renderer: null, ctx: null,
    setCamera, getCamera: () => ({ az: cam.az, el: cam.el, dist: cam.dist, fov: cam.fov, target: cam.target.slice(), eye: camEye([0, 0, 0]), ortho: cam.ortho, view: cam.ortho ? cam.view : null, scale: cam.scale, halfHeight: cam.ortho ? canvasCss()[1] / 2 / cam.scale : undefined }),
    setPaint, setWheel, setEnv, hideUI, applyFilters,
    setDebug(mode) { if (renderer) renderer.settings.debug = mode || ''; },
    setState(o) { for (const k in o) if (k in target) target[k] = +o[k]; syncToggles(); },
    setAutoRotate(v) { autoRotate = !!v; syncToggles(); },
    setFilters(o) { filters.only = (o && o.only) || []; filters.hide = (o && o.hide) || []; applyFilters(); },
    stats() { const st = renderer ? renderer.stats : {}; return { fps, ms: msAvg, draws: st.draws, tris: st.tris, parts: st.parts, cpuMs: st.cpuMs, gpuMs: st.gpuMs, gpuName: renderer && renderer.gpuName, modules: PG.moduleStatus, timings, initMs: renderer && renderer.initMs, iblMs: renderer && renderer.iblMs }; },
    // Renders one frame and returns it as a PNG data URL. Uses gl.readPixels + a 2D canvas instead of canvas.toDataURL: in headless Chrome
    // toDataURL / Page.captureScreenshot of the WebGL canvas can hang for large viewports (>= ~2000x1500), readPixels never does.
    screenshot() {
      const r = renderer; applyCameraToRenderer(r); r.render(0); updateOverlay(r);
      const gl = r.gl, w = r.width, h = r.height, px = new Uint8ClampedArray(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = new Uint8ClampedArray(w * h * 4), row = w * 4;
      for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g2 = c.getContext('2d'); g2.putImageData(new ImageData(out, w, h), 0, 0);
      if (ovDrawn && dom.overlay.width) g2.drawImage(dom.overlay, 0, 0, w, h);      // the modelling overlay is part of the picture
      return c.toDataURL('image/png');
    },
    // ---- modelling aids (documented in the header)
    setOverlay, getOverlay: () => overlayMode, reference: () => PG.tools.reference(), referenceAt: (view, xs, full) => PG.tools.referenceAt(view, xs, !!full),
    raycaster(module) { const sh = app.ctx && app.ctx.shared, m = sh && sh[module || 'body']; return (m && m.raycaster) || null; },
    probe(x, z, opts) { return PG.tools.probe(app.raycaster(opts && opts.module), x, z, opts); },
    probeAt(origin, dir, opts) { return PG.tools.probeAt(app.raycaster(opts && opts.module), origin, dir, opts); },
    scan: scanSilhouette,
    builtModules: [],
    measureFps(seconds) {
      return new Promise(res => { probe = { start: performance.now(), dur: (seconds || 2) * 1000, last: 0, dts: [], cpu: 0, gpu: 0, n: 0, res }; });
    },
  };
  let probe = null, paused = false;
  app.pause = v => { paused = v === undefined ? !paused : !!v; return paused; };   // stops the render loop (the last frame stays on screen)
  let resolveReady; app.ready = new Promise(r => { resolveReady = r; });

  async function main() {
    // ---- renderer
    let r;
    try {
      r = renderer = new PG.Renderer(dom.canvas);
    } catch (e) { fatal('This demo needs WebGL2 with floating-point render targets.\n' + (e && e.message ? e.message : e)); return; }
    app.renderer = r;
    r.onContextLost = () => { fatal('The graphics context was lost. Restoring…'); };
    r.onContextRestored = () => location.reload();
    const ex = params.get('exposure'); if (ex) r.settings.exposure = +ex;
    if (params.has('msaa')) r.settings.msaa = +params.get('msaa');
    if (params.get('floor') === '0') r.settings.floor = false;
    if (params.get('shadows') === '0') r.settings.shadows = false;
    if (params.get('gfx') && r.listQualities().includes(params.get('gfx'))) r.setQuality(params.get('gfx'));
    if (params.get('reflections') === '0') r.settings.reflections = false;
    if (params.has('refl')) r.settings.reflectionScale = +params.get('refl');
    if (params.has('shadowsize')) r.settings.shadowSize = +params.get('shadowsize');
    if (params.get('adaptive') === '0' || SHOT) r.settings.adaptive = false;
    if (params.has('bloom')) r.settings.bloom = params.get('bloom') === '0' ? 0 : (+params.get('bloom') > 1 ? +params.get('bloom') : r.settings.bloom);
    if (params.get('debug')) r.settings.debug = params.get('debug');
    if (params.has('time')) r.timeOverride = +params.get('time'); else if (SHOT) r.timeOverride = 0;
    if (params.get('env') && PG.envDefs[params.get('env')]) { envName = params.get('env'); r.envName = envName; }
    try {
      await r.init((label, f) => setProgress(f * 0.08, label));
    } catch (e) { fatal('Renderer initialisation failed:\n' + (e && e.message ? e.message : e), e); return; }
    r.resize();
    applyFilters();

    // ---- state from URL
    for (const k of ['drs', 'headlights', 'brake', 'spin']) if (params.has(k)) { const v = +params.get(k); target[k] = v; S[k] = v; }
    if (params.has('hl')) { target.headlights = S.headlights = +params.get('hl'); }
    // ---- camera
    const startName = params.get('cam') || 'hero';
    if (presets[startName]) { const p = presets[startName], n = normCam(p); Object.assign(cam, n); if (n.target) cam.target = n.target.slice(); limits = p.limits ? Object.assign({}, DEFAULT_LIMITS, p.limits) : DEFAULT_LIMITS; activePreset = startName; }
    else pendingCam = startName;
    if (!SHOT && startName === 'hero' && !cam.ortho) { Object.assign(cam, { az: cam.az - 55, el: 20, dist: 9.5, fov: 30 }); introPending = true; }
    fitBox(cam.target); clampCam();
    if (params.has('paint')) setPaint(params.get('paint')); else paintIdx = 0;
    if (params.has('wheel')) setWheel(+params.get('wheel'));

    // ---- module context
    const shared = {}; let curModule = null; let curProgress = () => {};
    const ctx = {
      renderer: r, gl: r.gl, spec: PG.spec, mats: PG.mats, sdf: PG.sdf, geo: PG.geo, m4: PG.m4, v3: PG.v3, util: PG.util,
      quality: QUALITY, params, shared,
      add(def) { const p = r.addPart(Object.assign({ module: curModule }, def)); return p; },
      onUpdate(fn) { updaters.push({ fn, module: curModule, dead: false }); },
      progress(label, frac) { curProgress(label, frac); },
    };
    app.ctx = ctx;
    buildUI();
    setEnv(envName);

    let mods = PG.modules.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    // ?mods=a,b builds only those modules; ?mods=-a,-b everything except those; unset / all = every module
    const modWant = (params.get('mods') || '').split(',').map(s => s.trim()).filter(Boolean).filter(s => s !== 'all');
    if (modWant.length) {
      const inc = modWant.filter(s => s[0] !== '-'), exc = modWant.filter(s => s[0] === '-').map(s => s.slice(1)), names = mods.map(m => m.name);
      const unknown = inc.concat(exc).filter(s => !names.includes(s));
      if (unknown.length) console.warn('[PG] mods=: unknown module(s) ' + unknown.join(', ') + ' (registered: ' + names.join(', ') + ')');
      for (const m of mods) if ((inc.length && !inc.includes(m.name)) || exc.includes(m.name)) PG.moduleStatus[m.name] = 'skipped';
      mods = mods.filter(m => PG.moduleStatus[m.name] !== 'skipped');
    }
    app.builtModules = mods.map(m => m.name);
    const n = Math.max(1, mods.length), errors = [];
    const tAll = performance.now();
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i]; curModule = m.name; PG.moduleStatus[m.name] = 'building';
      const base = 0.08 + 0.84 * i / n, share = 0.84 / n;
      curProgress = (label, frac) => setProgress(base + share * clamp(frac || 0, 0, 1), m.name + (label ? ': ' + label : ''));
      curProgress('starting', 0);
      await new Promise(res => requestAnimationFrame(() => res()));     // let the overlay repaint
      const t0 = performance.now();
      try { await m.build(ctx); PG.moduleStatus[m.name] = 'ok'; }
      catch (e) {
        PG.moduleStatus[m.name] = 'error: ' + (e && e.message ? e.message : e); errors.push(m.name);
        console.error('[PG] module "' + m.name + '" failed:', e);
      }
      timings[m.name] = Math.round(performance.now() - t0);
      curProgress('done', 1);
    }
    curModule = null;
    setProgress(0.93, 'compiling shaders');
    await r.whenProgramsReady();
    setProgress(0.97, 'first frames');
    timings.total = Math.round(performance.now() - tAll);
    PG.log('modules built in ' + timings.total + ' ms', JSON.stringify(timings));
    built = true; builtErrors = errors;
    if (pendingCam) { if (presets[pendingCam]) { setCamera(pendingCam, { instant: true }); introPending = false; } else console.warn('[PG_APP] unknown cam "' + pendingCam + '"'); pendingCam = null; }
    setProgress(1, 'ready');
    // hide overlay
    if (SHOT) { dom.loading.style.display = 'none'; }
    else { dom.loading.style.opacity = '0'; dom.loading.style.pointerEvents = 'none'; setTimeout(() => { dom.loading.style.display = 'none'; }, 700); }
    lastInteract = performance.now() / 1000 - 1.0;
    if (introPending) setTimeout(() => { if (introPending) setCamera('hero', { duration: 2.6 }); }, 250);      // (any earlier setCamera() call cancels the intro)
  }
  let built = false, builtErrors = [], introPending = false, readyFrames = 0, pendingCam = null;

  function frame(nowMs) {
    requestAnimationFrame(frame);
    const r = renderer; if (!r || !r.ready || r.lost || paused) return;
    const now = nowMs / 1000; let dt = lastNow ? Math.min(0.1, now - lastNow) : 0.016; lastNow = now;
    const w = dom.canvas.clientWidth, h = dom.canvas.clientHeight, dpr = r.pixelRatio(window.devicePixelRatio, w, h);
    if (Math.round(w * dpr) !== r.width || Math.round(h * dpr) !== r.height) r.resize(w, h, dpr);
    updateCamera(dt, now);
    applyCameraToRenderer(r);
    updateState(dt);
    if (built) {
      const time = r.timeOverride !== null ? r.timeOverride : r.time;
      for (let i = 0; i < updaters.length; i++) {
        const u = updaters[i]; if (u.dead) continue;
        try { u.fn(dt, time, PG.state); } catch (e) { u.dead = true; console.error('[PG] update of "' + u.module + '" threw and was disabled:', e); }
      }
    }
    r.render(SHOT ? 1 / 60 : dt);
    updateOverlay(r);
    // stats
    msAvg += (dt * 1000 - msAvg) * 0.05; fps = 1000 / Math.max(msAvg, 0.1);
    if (uiRefs.fps && (frameCount & 15) === 0) uiRefs.fps.textContent = fps.toFixed(0) + ' fps  ' + r.stats.draws + ' draws  ' + (r.stats.tris / 1000).toFixed(0) + 'k tris  cpu ' + r.stats.cpuMs.toFixed(1) + ' ms' + (r.stats.gpuMs !== undefined ? '  gpu ' + r.stats.gpuMs.toFixed(1) + ' ms' : '');
    frameCount++;
    if (probe) {
      if (probe.last) { probe.dts.push(nowMs - probe.last); probe.cpu += r.stats.cpuMs; probe.gpu += r.stats.gpuMs || 0; probe.n++; }
      probe.last = nowMs;
      if (nowMs - probe.start > probe.dur && probe.n > 2) {
        const d = probe.dts.slice().sort((a, b) => a - b), sum = d.reduce((a, b) => a + b, 0), q = probe.res; const pr = probe; probe = null;
        q({ fps: +(1000 * d.length / sum).toFixed(1), avgMs: +(sum / d.length).toFixed(2), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2), maxMs: +d[d.length - 1].toFixed(2), frames: d.length, cpuMs: +(pr.cpu / pr.n).toFixed(2), gpuMs: +(pr.gpu / pr.n).toFixed(2) });
      }
    }
    for (let i = frameWaiters.length - 1; i >= 0; i--) if (frameCount >= frameWaiters[i].at) { frameWaiters[i].res(); frameWaiters.splice(i, 1); }
    if (built && !window.__ready) {
      if (++readyFrames >= 3 && !tween) {
        window.__ready = true; window.__status = builtErrors.length ? 'ready (errors: ' + builtErrors.join(',') + ')' : 'ready';
        resolveReady();
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  function start() {
    setupInput(dom.canvas);
    requestAnimationFrame(frame);
    main().catch(e => fatal('Unexpected error: ' + (e && e.message ? e.message : e), e));
  }
})();
