/* ============================================================================
 * descentStage.js  —  module 'descentStage'
 * Mars 2020 / MSL-heritage "sky crane" descent stage at 1:1 scale + the bridle / umbilical system.
 *
 * Local frame of the stage (api.group): X forward, Y up (away from the rover, toward the backshell), Z right,
 * origin = deck centre.  ~3.9 m across the outer nozzle exits, 8 MLE engines in 4 pairs (one pair per corner,
 * canted 25 deg outward), open silver truss with a big X, foil-wrapped tank shrouds, hexagonal hub with the
 * black bridle bushing, umbilical spool, harness bundles, BUD pyramid hanging below.
 *
 * The bridle (3 cords) and umbilical are drawn here in WORLD space (api.bridleGroup, identity transform,
 * added to ctx.scene) from state.bodies.descentStage + state.bodies.rover and the rover anchors.
 * Everything is a pure function of t (no accumulated state).  See _work/notes/descentStage.md.
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util;
  const BGU = THREE.BufferGeometryUtils;
  const V3 = THREE.Vector3, Q4 = THREE.Quaternion, M4 = THREE.Matrix4;
  const TAU = Math.PI * 2;

  EDL.registerModule('descentStage', function factory(ctx) {
    const renderer = ctx.renderer, scene = ctx.scene;
    const _t0 = performance.now();

    /* ==================================================================================================
     *  0. DIMENSIONS (stage local frame, metres)
     * ================================================================================================ */
    const D = {
      frameX: 0.72, frameZ: 1.38,       // half extents of the rectangular truss (rails along X at z=+-frameZ)
      yLow: -0.56, yTop: -0.07,         // lower / upper truss planes
      deckHX: 0.80, deckHZ: 1.46,       // deck ring outer half extents
      podX: 1.10, podZ: 1.80,           // pair centre (nozzle exit) position of the four corner pods
      yExit: -0.50,                     // y of the nozzle exit centres
      pairHalf: 0.21,                   // half spacing between the two engines of a pair (along X)
      cantDeg: 25,                      // engine cant from vertical, outward
      exitR: 0.155,                     // nozzle exit radius (D = 0.32 m = 8 % of the 3.9 m width)
      hubY: -0.80,                      // hex hub plate (bridle bushing) height
      bagR: 0.40, bagX: 0.45, bagZ: 0.85, bagY: -0.44,
      budX: 0.62, budTopY: -0.56, budBotY: -1.56,   // BUD pyramid + spool cluster hanging below
    };

    /* ==================================================================================================
     *  1. PROCEDURAL TEXTURES  (canvas, built once)
     * ================================================================================================ */
    function tnoise(x, y, per, seed) {          // tileable value noise, lattice period `per`
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per, y0 = ((yi % per) + per) % per, y1 = (y0 + 1) % per;
      const a = U.hash2(x0, y0, seed), b = U.hash2(x1, y0, seed), c = U.hash2(x0, y1, seed), d = U.hash2(x1, y1, seed);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    function mkTex(canvas, o) {
      o = o || {};
      const t = new THREE.CanvasTexture(canvas);
      if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    }
    function grain(g, w, h, amp, seedOff) {
      const im = g.getImageData(0, 0, w, h);
      for (let i = 0; i < im.data.length; i += 4) {
        const n = (U.hash1((i >> 2) * 3 + seedOff) - 0.5) * amp;
        im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n;
      }
      g.putImageData(im, 0, 0);
    }

    /** crumpled aluminised foil: piecewise-planar "folded paper" height field = sum of triangle waves with integer wave
     *  vectors (tileable, straight creases, flat facets).  Returns colour (cavity/crease darkened), normal and roughness maps. */
    function makeFoilTextures(N, seed, tint, opts) {
      opts = opts || {};
      const rnd = U.rng(seed * 7919 + 13);
      const waves = [];
      const bands = [[2, 6, 24, 1.0], [6, 16, 40, 0.5], [16, 36, 40, 0.14]];   // [kmin, kmax, count, amp]
      bands.forEach(([k0, k1, cnt, amp]) => {
        for (let i = 0; i < cnt; i++) {
          const ang = rnd() * Math.PI, kk = k0 + rnd() * (k1 - k0);
          let kx = Math.round(Math.cos(ang) * kk), ky = Math.round(Math.sin(ang) * kk);
          if (kx === 0 && ky === 0) kx = 1;
          waves.push({ kx, ky, ph: rnd(), a: amp * (0.4 + 0.6 * rnd()) / Math.hypot(kx, ky) });
        }
      });
      const H = new Float32Array(N * N), SX = new Float32Array(N * N), SY = new Float32Array(N * N);
      let mn = 1e9, mx = -1e9;
      for (let y = 0; y < N; y++) {
        const v = (y + 0.5) / N;
        for (let x = 0; x < N; x++) {
          const u = (x + 0.5) / N;
          let h = 0, sx = 0, sy = 0;
          for (let w = 0; w < waves.length; w++) {
            const W = waves[w];
            let f = W.kx * u + W.ky * v + W.ph; f -= Math.floor(f);
            const tri = f < 0.5 ? f * 2 : 2 - f * 2, sl = (f < 0.5 ? 2 : -2) * W.a;
            h += W.a * tri; sx += W.kx * sl; sy += W.ky * sl;
          }
          const i = y * N + x; H[i] = h; SX[i] = sx; SY[i] = sy;
          if (h < mn) mn = h; if (h > mx) mx = h;
        }
      }
      let rms = 0; for (let i = 0; i < N * N; i++) rms += SX[i] * SX[i] + SY[i] * SY[i]; rms = Math.sqrt(rms / (N * N * 2)) || 1;
      const slopeScale = (opts.tilt || 0.55) / rms;
      const cm = mkCanvas(N, N), cn = mkCanvas(N, N), cr = mkCanvas(N, N);
      const gm = cm.getContext('2d'), gn = cn.getContext('2d'), gr = cr.getContext('2d');
      const im = gm.createImageData(N, N), inn = gn.createImageData(N, N), ir = gr.createImageData(N, N);
      const inv = 1 / (mx - mn);
      for (let i = 0; i < N * N; i++) {
        const sx = SX[i] * slopeScale, sy = SY[i] * slopeScale;
        let nx = -sx, ny = sy, nz = 1;
        const l = 1 / Math.hypot(nx, ny, nz); nx *= l; ny *= l; nz *= l;
        inn.data[i * 4] = (nx * 0.5 + 0.5) * 255; inn.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; inn.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; inn.data[i * 4 + 3] = 255;
        const hh = (H[i] - mn) * inv;
        const g = 0.72 + 0.28 * Math.pow(hh, 0.9);
        im.data[i * 4] = Math.min(255, 255 * g * tint[0]); im.data[i * 4 + 1] = Math.min(255, 255 * g * tint[1]); im.data[i * 4 + 2] = Math.min(255, 255 * g * tint[2]); im.data[i * 4 + 3] = 255;
        const rg = 0.75 + 0.25 * (1 - hh);
        ir.data[i * 4] = ir.data[i * 4 + 1] = ir.data[i * 4 + 2] = 255 * rg; ir.data[i * 4 + 3] = 255;
      }
      gm.putImageData(im, 0, 0); gn.putImageData(inn, 0, 0); gr.putImageData(ir, 0, 0);
      return { map: mkTex(cm), normal: mkTex(cn, { srgb: false }), rough: mkTex(cr, { srgb: false }) };
    }

    function makeHarnessTexture() {                       // copper / Kapton spiral wrap
      const c = mkCanvas(128, 64), g = c.getContext('2d');
      g.fillStyle = '#4b2718'; g.fillRect(0, 0, 128, 64);
      for (let k = -4; k < 12; k++) {
        g.fillStyle = k % 2 ? '#7d4224' : '#a5653a';
        g.beginPath(); g.moveTo(k * 16, 0); g.lineTo(k * 16 + 10, 0); g.lineTo(k * 16 + 10 - 40, 64); g.lineTo(k * 16 - 40, 64); g.closePath(); g.fill();
      }
      grain(g, 128, 64, 22, 5);
      return mkTex(c);
    }
    function makeBraidTexture(c1, c2) {                   // braided cable / rope
      const c = mkCanvas(64, 64), g = c.getContext('2d');
      g.fillStyle = c1; g.fillRect(0, 0, 64, 64);
      g.strokeStyle = c2; g.lineWidth = 3;
      for (let k = -8; k < 16; k++) { g.beginPath(); g.moveTo(k * 8, 0); g.lineTo(k * 8 + 64, 64); g.stroke(); }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
      for (let k = -8; k < 16; k++) { g.beginPath(); g.moveTo(k * 8 + 4, 0); g.lineTo(k * 8 + 68, 64); g.stroke(); }
      return mkTex(c);
    }
    function makeUmbilicalTextures() {                    // white corrugated hose with a red ring per period
      const W = 256, Hh = 32;
      const c = mkCanvas(W, Hh), g = c.getContext('2d');
      const b = mkCanvas(W, Hh), gb = b.getContext('2d');
      g.fillStyle = '#eceaef'; g.fillRect(0, 0, W, Hh);
      gb.fillStyle = '#808080'; gb.fillRect(0, 0, W, Hh);
      const ridges = 10;
      for (let i = 0; i < ridges; i++) {
        const x = 30 + (i * (W - 34)) / ridges;
        const grd = g.createLinearGradient(x, 0, x + 14, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.4, 'rgba(120,118,132,0.42)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(x, 0, 14, Hh);
        const gb2 = gb.createLinearGradient(x, 0, x + 14, 0);
        gb2.addColorStop(0, '#f0f0f0'); gb2.addColorStop(0.5, '#202020'); gb2.addColorStop(1, '#f0f0f0');
        gb.fillStyle = gb2; gb.fillRect(x, 0, 14, Hh);
      }
      g.fillStyle = '#b52b2b'; g.fillRect(4, 0, 18, Hh);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(4, 0, 2, Hh); g.fillRect(20, 0, 2, Hh);
      gb.fillStyle = '#c0c0c0'; gb.fillRect(4, 0, 18, Hh);
      return { map: mkTex(c), bump: mkTex(b, { srgb: false }) };
    }
    function makePerfTexture() {                          // perforated aluminium strip
      const c = mkCanvas(128, 512), g = c.getContext('2d');
      g.fillStyle = '#c9ccd3'; g.fillRect(0, 0, 128, 512);
      grain(g, 128, 512, 14, 11);
      for (let row = 0; row < 2; row++) for (let k = 0; k < 14; k++) {
        const x = 40 + row * 48, y = 20 + k * 34 + row * 12;
        g.fillStyle = '#3b2c3a'; g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill();
        g.fillStyle = '#b48f8c'; g.beginPath(); g.arc(x + 1.5, y + 2, 6, 0, TAU); g.fill();
      }
      return mkTex(c);
    }
    function makeSpoolTexture() {                         // silver cylinder with red lettering (text runs along x)
      const c = mkCanvas(512, 128), g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, '#9fa3ab'); grd.addColorStop(0.35, '#e6e8ee'); grd.addColorStop(0.7, '#b9bcc4'); grd.addColorStop(1, '#8a8d95');
      g.fillStyle = grd; g.fillRect(0, 0, 512, 128);
      g.fillStyle = '#b7322a'; g.font = 'bold 34px Arial, Helvetica, sans-serif'; g.textBaseline = 'middle';
      g.fillText('MARS 2020  BUD  S/N 003', 30, 40);
      g.font = 'bold 22px Arial, Helvetica, sans-serif'; g.fillText('UMBILICAL SPOOL  •  HANDLE WITH CARE', 30, 92);
      g.fillStyle = 'rgba(60,60,70,0.5)'; g.fillRect(0, 64, 512, 2);
      grain(g, 512, 128, 12, 7);
      return mkTex(c);
    }
    function makePanelTexture() {                         // white composite deck panels with rivet rows
      const c = mkCanvas(256, 256), g = c.getContext('2d');
      g.fillStyle = '#e4e0da'; g.fillRect(0, 0, 256, 256);
      grain(g, 256, 256, 16, 99);
      g.strokeStyle = 'rgba(70,66,64,0.55)'; g.lineWidth = 2;
      g.strokeRect(6, 6, 244, 244);
      g.fillStyle = 'rgba(80,76,74,0.8)';
      for (let k = 0; k < 16; k++) { const p = 14 + k * 15.5; [12, 244].forEach((q) => { g.beginPath(); g.arc(p, q, 2, 0, TAU); g.fill(); g.beginPath(); g.arc(q, p, 2, 0, TAU); g.fill(); }); }
      return mkTex(c);
    }
    function makeCoilTexture() {                          // pink/white umbilical coil on the spool
      const c = mkCanvas(64, 64), g = c.getContext('2d');
      g.fillStyle = '#efdfe1'; g.fillRect(0, 0, 64, 64);
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#d9a9b0' : '#f6ecee'; g.fillRect(0, k * 8, 64, 5); }
      return mkTex(c);
    }

    const foilA = makeFoilTextures(512, 41, [0.96, 0.97, 1.0]);          // silver, slightly cool
    const foilB = makeFoilTextures(256, 77, [1.0, 0.96, 0.95]);          // rose / gold tinted
    const harnessTex = makeHarnessTexture();
    const blueTex = makeBraidTexture('#1f45a8', '#3f6fd0');
    const ropeTex = makeBraidTexture('#ece4d2', '#f8f3e8');
    const umbTex = makeUmbilicalTextures();
    const perfTex = makePerfTexture();
    const spoolTex = makeSpoolTexture();
    const panelTex = makePanelTexture();
    const coilTex = makeCoilTexture();

    /* ==================================================================================================
     *  2. ENVIRONMENT (fallback when the atmosphere module provides no scene.environment)
     * ================================================================================================ */
    let ownEnv = null;
    function buildEnv() {
      try {
        const pm = new THREE.PMREMGenerator(renderer);
        const s = new THREE.Scene();
        const R0 = 60, g = new THREE.SphereGeometry(R0, 64, 40);
        const pos = g.attributes.position, cols = new Float32Array(pos.count * 3);
        const zen = new THREE.Color(0xa9b8de), hor = new THREE.Color(0xf0d6b4), gnd = new THREE.Color(0xa39d97), gnd2 = new THREE.Color(0x726c68);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) / R0, y = pos.getY(i) / R0, z = pos.getZ(i) / R0;
          const n = U.valueNoise3(x * 2.6 + 3.1, y * 2.6, z * 2.6 - 1.7, 5) * 0.65 + U.valueNoise3(x * 6.0, y * 6.0 + 9, z * 6.0, 6) * 0.35;
          if (y >= 0) c.copy(hor).lerp(zen, Math.pow(y, 0.5)).multiplyScalar(0.85 + 0.45 * n);
          else c.copy(hor).multiplyScalar(0.62).lerp(gnd, Math.min(1, -y * 2.6)).lerp(gnd2, Math.max(0, -y - 0.5) * 1.5).multiplyScalar(0.6 + 1.2 * n * n);
          cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
        const patch = (dir, rad, r, gc, b) => {                   // bright patches: sun, sky glow, sunlit dust
          const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); m.color.setRGB(r, gc, b);
          const sp = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 12), m); sp.position.copy(dir).normalize().multiplyScalar(52); s.add(sp);
        };
        patch(C.sun.dir, 5.5, 26, 22, 16);
        patch(new V3(0.6, 0.35, 0.7), 12, 2.6, 2.6, 3.0);
        patch(new V3(-0.5, -0.25, 0.8), 10, 3.4, 3.0, 2.6);
        patch(new V3(0.5, -0.35, -0.7), 9, 3.0, 2.7, 2.4);
        patch(new V3(0.1, -0.8, 0.2), 8, 2.4, 2.2, 2.0);
        const rt = pm.fromScene(s, 0.02);
        ownEnv = rt.texture;
        pm.dispose(); g.dispose();
      } catch (e) { console.warn('[descentStage] env build failed', e); }
    }
    buildEnv();

    /* ==================================================================================================
     *  3. MATERIALS
     * ================================================================================================ */
    const M = {};
    const allMats = [];
    function std(key, o) {
      const m = new THREE.MeshStandardMaterial(o);
      if (ownEnv) m.envMap = ownEnv;
      m.name = 'ds_' + key; M[key] = m; allMats.push(m); return m;
    }
    const nS = new THREE.Vector2(1.0, 1.0);
    std('foil', { color: 0xe4e7ef, metalness: 1.0, roughness: 0.30, map: foilA.map, normalMap: foilA.normal, normalScale: nS, roughnessMap: foilA.rough, envMapIntensity: 1.35 });
    std('foilRose', { color: 0xf6ece9, metalness: 1.0, roughness: 0.40, map: foilB.map, normalMap: foilB.normal, normalScale: nS, roughnessMap: foilB.rough, envMapIntensity: 1.25 });
    std('tube', { color: 0xc8cbd3, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.2 });
    std('steel', { color: 0xa9adb5, metalness: 1.0, roughness: 0.28, envMapIntensity: 1.2 });
    std('valve', { color: 0xd3d6dd, metalness: 0.95, roughness: 0.30, envMapIntensity: 1.25 });
    std('nozzle', { color: 0x26242a, metalness: 0.55, roughness: 0.48, side: THREE.DoubleSide, envMapIntensity: 0.9 });
    std('lip', { color: 0x4a2219, metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide });
    std('black', { color: 0x1c1b20, metalness: 0.3, roughness: 0.6, envMapIntensity: 0.7 });
    std('harness', { color: 0xffffff, map: harnessTex, metalness: 0.25, roughness: 0.5, envMapIntensity: 0.9 });
    std('kapton', { color: 0xc8782c, metalness: 0.35, roughness: 0.28, envMapIntensity: 1.0 });
    std('bronze', { color: 0xb47a48, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.0 });
    std('copper', { color: 0xb8622f, metalness: 1.0, roughness: 0.28, envMapIntensity: 1.1 });
    std('white', { color: 0xffffff, map: panelTex, metalness: 0.0, roughness: 0.62, envMapIntensity: 0.6 });
    std('hub', { color: 0xd4d7de, metalness: 0.95, roughness: 0.38, envMapIntensity: 1.2 });
    std('spool', { color: 0xffffff, map: spoolTex, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.2 });
    std('perf', { color: 0xffffff, map: perfTex, metalness: 0.85, roughness: 0.4, envMapIntensity: 1.1 });
    std('blue', { color: 0xffffff, map: blueTex, metalness: 0.0, roughness: 0.75 });
    std('tie', { color: 0xf1efe8, metalness: 0.0, roughness: 0.5 });
    std('coil', { color: 0xffffff, map: coilTex, metalness: 0.0, roughness: 0.6 });
    std('tankGold', { color: 0xdaa032, metalness: 0.95, roughness: 0.36, envMapIntensity: 1.1 });
    std('ddcBox', { color: 0x2a2b30, metalness: 0.5, roughness: 0.45 });
    // umbilical + cords (world space bridle system)
    std('umb', { color: 0xffffff, map: umbTex.map, bumpMap: umbTex.bump, bumpScale: 1.6, metalness: 0.0, roughness: 0.55, envMapIntensity: 0.8 });
    std('cord', { color: 0xfaf6ee, map: ropeTex, metalness: 0.0, roughness: 0.34, envMapIntensity: 0.9 });
    // nozzle interiors: one material per engine (individual glow)
    const innerMats = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.MeshStandardMaterial({ color: 0x0d0c10, metalness: 0.4, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x000000 });
      m.name = 'ds_inner' + i; innerMats.push(m);
    }

    /* ==================================================================================================
     *  4. GEOMETRY BUCKETS + PRIMITIVE HELPERS
     * ================================================================================================ */
    const buckets = {};
    const UP = new V3(0, 1, 0);
    const _q = new Q4(), _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _m = new M4();

    function prep(g) {
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups();
      return g;
    }
    function put(key, geo, matrix) {
      if (matrix) geo.applyMatrix4(matrix);
      (buckets[key] = buckets[key] || []).push(prep(geo));
    }
    const P = (x, y, z) => new V3(x, y, z);

    /** cylinder / cone between two points (ra at a, rb at b) */
    function cyl(a, b, ra, key, o) {
      o = o || {};
      const rb = o.rb !== undefined ? o.rb : ra;
      const len = a.distanceTo(b);
      if (len < 1e-5) return;
      const g = new THREE.CylinderGeometry(rb, ra, len, o.seg || 8, 1, !!o.open);
      const uv = g.attributes.uv;
      if (o.uvSwap) {                      // u along the axis (text/stripes run along the cylinder), v around
        for (let i = 0; i < uv.count; i++) { const uu = uv.getX(i), vv = uv.getY(i); uv.setXY(i, vv * len / (o.uvRep || len), uu); }
      } else if (o.uvRep) {
        for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / o.uvRep);
      }
      _v1.subVectors(b, a).divideScalar(len);
      _q.setFromUnitVectors(UP, _v1);
      _v2.addVectors(a, b).multiplyScalar(0.5);
      _m.compose(_v2, _q, _v3.set(1, 1, 1));
      put(key, g, _m);
    }
    /** smooth tube through control points (CatmullRom) */
    function curveTube(pts, r, key, o) {
      o = o || {};
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
      const len = curve.getLength();
      const segs = o.segs || Math.max(6, Math.round(len / 0.06));
      const g = new THREE.TubeGeometry(curve, segs, r, o.radial || 6, false);
      if (o.uvRep) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / o.uvRep); }
      put(key, g);
      return curve;
    }
    function boxAt(cx, cy, cz, sx, sy, sz, key, rot) {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      _m.identity();
      if (rot) _m.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ'));
      _m.setPosition(cx, cy, cz);
      put(key, g, _m);
    }
    function ringAt(center, axis, R, r, key, o) {          // torus with its axis along `axis`
      o = o || {};
      const g = new THREE.TorusGeometry(R, r, o.rs || 6, o.ts || 20, o.arc || TAU);
      _q.setFromUnitVectors(new V3(0, 0, 1), axis.clone().normalize());
      _m.compose(center, _q, _v3.set(1, 1, 1));
      put(key, g, _m);
    }
    function sphereAt(c, r, key) {
      const g = new THREE.SphereGeometry(r, 24, 16);
      g.translate(c.x, c.y, c.z);
      put(key, g);
    }
    function translated(g, x, y, z) { g.translate(x, y, z); return g; }

    /* ---- crumpled foil ------------------------------------------------------------------------------- */
    function ridged3(x, y, z, seed) { return 1 - Math.abs(2 * U.valueNoise3(x, y, z, seed) - 1); }
    /** displace a closed mesh into crumpled foil folds; per-face triplanar UVs for the tiling foil maps */
    const foldDirs = (function () {                     // fixed random directions for the geometric fold waves
      const r = U.rng(4242), out = [];
      for (let i = 0; i < 16; i++) {
        const z = r() * 2 - 1, a = r() * TAU, rr = Math.sqrt(1 - z * z);
        out.push({ x: rr * Math.cos(a), y: rr * Math.sin(a), z, f: 1.6 + r() * 4.2, ph: r(), a: 0.4 + 0.6 * r() });
      }
      return out;
    })();
    function crumple(geo, o) {
      o = o || {};
      geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
      geo = BGU.mergeVertices(geo, 1e-4);
      geo.computeVertexNormals();
      const pos = geo.attributes.position, nrm = geo.attributes.normal;
      const amp = o.amp !== undefined ? o.amp : 0.03, f = o.freq || 5, seed = o.seed || 1, foldAmp = (o.fold !== undefined ? o.fold : 0.9) * amp;
      const p = new V3(), n = new V3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
        let d = amp * ((ridged3(p.x * f, p.y * f, p.z * f, seed) - 0.5) * 1.0
          + (ridged3(p.x * f * 2.3 + 5, p.y * f * 2.3, p.z * f * 2.3, seed + 1) - 0.5) * 0.5
          + (ridged3(p.x * f * 5.1, p.y * f * 5.1 + 3, p.z * f * 5.1, seed + 2) - 0.5) * 0.22);
        // planar fold creases (triangle waves): flat facets meeting at straight creases, like crumpled foil
        let fw = 0;
        for (let k = 0; k < foldDirs.length; k++) {
          const F = foldDirs[k];
          let w = (p.x * F.x + p.y * F.y + p.z * F.z) * F.f * (f / 4) + F.ph + seed * 0.173; w -= Math.floor(w);
          fw += F.a * ((w < 0.5 ? w : 1 - w) * 2 - 0.5);
        }
        d += foldAmp * fw * 0.32;
        pos.setXYZ(i, p.x + n.x * d, p.y + n.y * d, p.z + n.z * d);
      }
      geo.computeVertexNormals();
      geo = geo.toNonIndexed();
      const P2 = geo.attributes.position;
      const uv = new Float32Array(P2.count * 2);
      const a = new V3(), b = new V3(), c = new V3(), fn = new V3(), e1 = new V3(), e2 = new V3();
      const k = 1 / (o.tile || 0.55);
      for (let i = 0; i < P2.count; i += 3) {
        a.fromBufferAttribute(P2, i); b.fromBufferAttribute(P2, i + 1); c.fromBufferAttribute(P2, i + 2);
        fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
        for (let j = 0; j < 3; j++) {
          const v = j === 0 ? a : j === 1 ? b : c;
          let u0, v0;
          if (ax >= ay && ax >= az) { u0 = v.z; v0 = v.y; } else if (ay >= az) { u0 = v.x; v0 = v.z; } else { u0 = v.x; v0 = v.y; }
          uv[(i + j) * 2] = u0 * k + seed * 0.37; uv[(i + j) * 2 + 1] = v0 * k;
        }
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return geo;
    }
    function roundedBoxGeo(sx, sy, sz, r) {
      const seg = (s) => Math.max(3, Math.round(s / 0.05));
      const g = new THREE.BoxGeometry(sx, sy, sz, seg(sx), seg(sy), seg(sz));
      const hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r;
      const pos = g.attributes.position, p = new V3(), c = new V3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        c.set(U.clamp(p.x, -hx, hx), U.clamp(p.y, -hy, hy), U.clamp(p.z, -hz, hz));
        p.sub(c); const l = p.length();
        if (l > 1e-6) p.multiplyScalar(r / l);
        pos.setXYZ(i, c.x + p.x, c.y + p.y, c.z + p.z);
      }
      return g;
    }
    let foilSeed = 3;
    function foilBox(cx, cy, cz, sx, sy, sz, key, o) {
      o = o || {};
      let g = roundedBoxGeo(sx, sy, sz, o.r || 0.05);
      g = crumple(g, { amp: o.amp !== undefined ? o.amp : 0.022, freq: o.freq || 7, seed: foilSeed++, tile: 0.6 });
      _m.identity();
      if (o.rot) _m.makeRotationFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2], 'YXZ'));
      _m.setPosition(cx, cy, cz);
      put(key || 'foil', g, _m);
    }
    function foilBlob(cx, cy, cz, rx, ry, rz, key, o) {
      o = o || {};
      let g = new THREE.SphereGeometry(1, o.ws || 40, o.hs || 26);
      g.scale(rx, ry, rz);
      g = crumple(g, { amp: o.amp !== undefined ? o.amp : 0.05, freq: o.freq || 4.5, seed: foilSeed++, tile: 0.6 });
      _m.identity();
      if (o.rot) _m.makeRotationFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2], 'YXZ'));
      _m.setPosition(cx, cy, cz);
      put(key || 'foil', g, _m);
    }
    /** a flat bar/strip between two points, wide face roughly facing +Y */
    function stripBetween(a, b, width, thick, key) {
      const dir = b.clone().sub(a), len = dir.length(); dir.divideScalar(len);
      const side = UP.clone().cross(dir).normalize();
      const upv = dir.clone().cross(side).normalize();
      const g = new THREE.BoxGeometry(width, thick, len);
      const bm = new M4().makeBasis(side, upv, dir).setPosition(a.clone().add(b).multiplyScalar(0.5));
      put(key, g, bm);
    }

    /* ==================================================================================================
     *  5. BUILD THE STAGE
     * ================================================================================================ */
    const group = new THREE.Group(); group.name = 'descentStage';
    const stage = new THREE.Group(); stage.name = 'ds_meshes'; group.add(stage);
    const engines = [];
    const engineInner = [];
    const rTube = 0.022;

    /* ---- 5.1 truss frame ----------------------------------------------------------------------------- */
    (function buildFrame() {
      const fx = D.frameX, fz = D.frameZ, yl = D.yLow, yt = D.yTop;
      [yl, yt].forEach((y) => {                                    // rails / cross tubes on both planes
        cyl(P(-fx, y, -fz), P(-fx, y, fz), rTube, 'tube', { seg: 10 });
        cyl(P(fx, y, -fz), P(fx, y, fz), rTube, 'tube', { seg: 10 });
        cyl(P(-fx, y, -fz), P(fx, y, -fz), rTube, 'tube', { seg: 10 });
        cyl(P(-fx, y, fz), P(fx, y, fz), rTube, 'tube', { seg: 10 });
      });
      [[-fx, -fz], [fx, -fz], [-fx, fz], [fx, fz], [0, -fz], [0, fz]].forEach(([x, z]) => cyl(P(x, yl, z), P(x, yt, z), rTube * 0.95, 'tube', { seg: 8 }));
      // the big X on the lower plane + cross members through the hub
      cyl(P(-fx, yl, -fz), P(fx, yl, fz), rTube * 1.45, 'tube', { seg: 10 });
      cyl(P(fx, yl, -fz), P(-fx, yl, fz), rTube * 1.45, 'tube', { seg: 10 });
      cyl(P(-fx, yl - 0.03, 0), P(fx, yl - 0.03, 0), rTube, 'tube', { seg: 8 });
      cyl(P(0, yl - 0.03, -fz), P(0, yl - 0.03, fz), rTube, 'tube', { seg: 8 });
      // upper X (under the deck)
      cyl(P(-fx, yt, -fz), P(fx, yt, fz), rTube * 0.8, 'tube', { seg: 8 });
      cyl(P(fx, yt, -fz), P(-fx, yt, fz), rTube * 0.8, 'tube', { seg: 8 });
      // diagonals on the side faces
      cyl(P(-fx, yl, -fz), P(fx, yt, -fz), rTube * 0.7, 'tube', { seg: 6 });
      cyl(P(fx, yl, -fz), P(-fx, yt, -fz), rTube * 0.7, 'tube', { seg: 6 });
      cyl(P(-fx, yl, fz), P(fx, yt, fz), rTube * 0.7, 'tube', { seg: 6 });
      cyl(P(fx, yl, fz), P(-fx, yt, fz), rTube * 0.7, 'tube', { seg: 6 });
      // node blocks at the frame corners
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        [yl, yt].forEach((y) => put('hub', new THREE.SphereGeometry(0.045, 12, 8), new M4().makeTranslation(sx * fx, y, sz * fz)));
        boxAt(sx * fx, yl - 0.05, sz * fz, 0.12, 0.08, 0.12, 'hub');
      });
    })();

    /* ---- 5.2 deck ring (top side) -------------------------------------------------------------------- */
    (function buildDeck() {
      const hx = D.deckHX, hz = D.deckHZ, ch = 0.30;
      const shape = new THREE.Shape();
      shape.moveTo(-hx + ch, -hz); shape.lineTo(hx - ch, -hz); shape.lineTo(hx, -hz + ch); shape.lineTo(hx, hz - ch);
      shape.lineTo(hx - ch, hz); shape.lineTo(-hx + ch, hz); shape.lineTo(-hx, hz - ch); shape.lineTo(-hx, -hz + ch); shape.closePath();
      const ix = 0.60, iz = 1.24, ic = 0.16;
      const hole = new THREE.Path();
      hole.moveTo(-ix + ic, -iz); hole.lineTo(ix - ic, -iz); hole.lineTo(ix, -iz + ic); hole.lineTo(ix, iz - ic);
      hole.lineTo(ix - ic, iz); hole.lineTo(-ix + ic, iz); hole.lineTo(-ix, iz - ic); hole.lineTo(-ix, -iz + ic); hole.closePath();
      shape.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 4 });
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.6, p.getY(i) * 0.6);
      g.rotateX(Math.PI / 2);                 // shape XY -> world X,Z ; extrusion -> down
      g.translate(0, 0.05, 0);                // deck slab spans y in [-0.05, 0.05]
      put('white', g);
      cyl(P(-hx + 0.1, -0.04, 0), P(hx - 0.1, -0.04, 0), 0.03, 'tube', { seg: 8 });
      cyl(P(0, -0.04, -hz + 0.1), P(0, -0.04, hz - 0.1), 0.03, 'tube', { seg: 8 });
      // backshell interface hard points on top of the deck
      [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]].forEach(([sx, sz]) => {
        const x = sx * (hx - 0.14), z = sz * (hz - 0.14);
        cyl(P(x, 0.05, z), P(x, 0.17, z), 0.075, 'tube', { seg: 16 });
        cyl(P(x, 0.17, z), P(x, 0.19, z), 0.06, 'black', { seg: 16 });
      });
      for (let k = 0; k < 40; k++) {                               // bolt heads along the slab rim
        const a = (k / 40) * TAU;
        const bx = U.clamp(Math.cos(a) * 1.6, -hx + 0.05, hx - 0.05), bz = U.clamp(Math.sin(a) * 2.2, -hz + 0.05, hz - 0.05);
        if (Math.abs(bx) < hx - 0.06 && Math.abs(bz) < hz - 0.06) continue;
        cyl(P(bx, 0.05, bz), P(bx, 0.062, bz), 0.012, 'steel', { seg: 6 });
      }
      // top-side MLI pillows on the rim, antennas
      foilBlob(-0.62, 0.11, -1.28, 0.36, 0.08, 0.22, 'foil', { amp: 0.02, ws: 24, hs: 14, rot: [0, 0.3, 0] });
      foilBlob(0.62, 0.11, 1.28, 0.36, 0.08, 0.22, 'foil', { amp: 0.02, ws: 24, hs: 14, rot: [0, 0.3, 0] });
      foilBlob(0.7, 0.11, -1.25, 0.3, 0.08, 0.2, 'foilRose', { amp: 0.02, ws: 24, hs: 14, rot: [0, -0.35, 0] });
      foilBlob(-0.72, 0.11, 1.25, 0.3, 0.08, 0.2, 'foilRose', { amp: 0.02, ws: 24, hs: 14, rot: [0, -0.35, 0] });
      cyl(P(-0.75, 0.05, 0.30), P(-0.75, 0.52, 0.30), 0.028, 'tube', { seg: 10, rb: 0.016 });   // UHF blade
      put('tube', new THREE.SphereGeometry(0.03, 10, 8), new M4().makeTranslation(-0.75, 0.53, 0.30));
      cyl(P(0.75, 0.05, -0.38), P(0.75, 0.27, -0.38), 0.05, 'black', { seg: 12, rb: 0.085 });    // LGA horn
      cyl(P(0.75, 0.27, -0.38), P(0.75, 0.29, -0.38), 0.085, 'kapton', { seg: 12 });
      curveTube([P(-0.9, 0.09, -0.6), P(-0.4, 0.12, -0.9), P(0.3, 0.12, -1.0), P(0.9, 0.09, -0.7)], 0.014, 'steel', { radial: 6 });
      curveTube([P(-0.9, 0.09, 0.6), P(-0.4, 0.12, 0.9), P(0.3, 0.12, 1.0), P(0.9, 0.09, 0.7)], 0.014, 'steel', { radial: 6 });
    })();

    /* ---- 5.3 engine pods ------------------------------------------------------------------------------ */
    const cant = (D.cantDeg * Math.PI) / 180;
    const podCorners = [[1, -1], [1, 1], [-1, 1], [-1, -1]];       // front-left, front-right, aft-right, aft-left
    const prof = (pts) => pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const nozOuter = prof([[0.146, 0], [0.158, 0.010], [0.155, 0.04], [0.143, 0.15], [0.130, 0.26], [0.120, 0.30]]);
    const nozInner = prof([[0.146, 0.0], [0.136, 0.04], [0.102, 0.12], [0.068, 0.20], [0.052, 0.26]]);
    const nozLip = prof([[0.124, 0.0], [0.163, 0.0]]);

    (function buildPods() {
      podCorners.forEach(([sx, sz], p) => {
        const o = new V3(sx * D.podX, 0, sz * D.podZ).normalize();               // outward horizontal
        const e = new V3(o.x * Math.sin(cant), -Math.cos(cant), o.z * Math.sin(cant)).normalize();   // exhaust direction
        const back = e.clone().negate();
        const qEng = new Q4().setFromUnitVectors(UP, back);                     // canonical +Y (chamber side) -> -e
        const pairCentre = P(sx * D.podX, D.yExit, sz * D.podZ);
        for (let k = 0; k < 2; k++) {                                            // the two engines of the pair (separated along X)
          const idx = p * 2 + k;
          const exit = pairCentre.clone(); exit.x += (k === 0 ? -1 : 1) * D.pairHalf;
          engines.push({ pos: exit.clone(), dir: e.clone(), radius: D.exitR, pair: p, index: idx });
          const em = new M4().compose(exit, qEng, new V3(1, 1, 1));
          put('nozzle', new THREE.LatheGeometry(nozOuter, 32), em.clone());
          put('lip', new THREE.LatheGeometry(nozLip, 32), em.clone());
          const inner = new THREE.LatheGeometry(nozInner, 32); inner.applyMatrix4(em);
          engineInner.push({ geo: prep(inner), idx });
          const loc = (y) => new V3(0, y, 0).applyMatrix4(em);
          cyl(loc(0.30), loc(0.66), 0.125, 'valve', { seg: 24 });                 // silver valve body
          ringAt(loc(0.32), back, 0.128, 0.011, 'steel', { rs: 6, ts: 24 });
          ringAt(loc(0.64), back, 0.128, 0.011, 'steel', { rs: 6, ts: 24 });
          cyl(loc(0.25), loc(0.30), 0.135, 'nozzle', { seg: 24 });               // collar
          cyl(loc(0.66), loc(0.72), 0.09, 'black', { seg: 16, rb: 0.06 });       // dome
          const stubA = loc(0.50);
          cyl(stubA, stubA.clone().addScaledVector(o, -0.17), 0.028, 'steel', { seg: 8 });
        }
        // pair manifold: foil wrapped box inboard of the engines + bracket + gusset + arms
        const mC = pairCentre.clone().addScaledVector(back, 0.58).addScaledVector(o, -0.30);
        foilBox(mC.x, mC.y, mC.z, 0.62, 0.30, 0.34, 'foil', { r: 0.06, amp: 0.02 });
        const bC = pairCentre.clone().addScaledVector(back, 0.50).addScaledVector(o, -0.06);
        boxAt(bC.x, bC.y, bC.z, 0.60, 0.05, 0.42, 'hub');
        const gC = pairCentre.clone().addScaledVector(back, 0.72).addScaledVector(o, -0.42);
        foilBox(gC.x, gC.y, gC.z, 0.34, 0.24, 0.30, 'foilRose', { r: 0.05, amp: 0.02 });
        const mount = pairCentre.clone().addScaledVector(back, 0.66).addScaledVector(o, -0.20);
        const cUp = P(sx * D.frameX, D.yTop, sz * D.frameZ), cLo = P(sx * D.frameX, D.yLow, sz * D.frameZ);
        const mA = mount.clone(); mA.x -= 0.16; const mB = mount.clone(); mB.x += 0.16;
        cyl(mA, cUp, 0.024, 'tube', { seg: 8 }); cyl(mB, cLo, 0.024, 'tube', { seg: 8 });
        cyl(mA, cLo, 0.018, 'tube', { seg: 8 }); cyl(mount.clone().setY(mount.y - 0.22), cLo, 0.018, 'tube', { seg: 8 });
        ringAt(mC.clone().add(P(0, 0.19, 0)), new V3(1, 0, 0), 0.034, 0.006, 'steel', { rs: 5, ts: 14 });   // lifting eye
        for (let r = 0; r < 2; r++) {                                                                     // RCS thrusters
          const rp = mC.clone().addScaledVector(o, 0.19).add(P(r ? 0.2 : -0.2, -0.05, 0));
          cyl(rp, rp.clone().addScaledVector(o, 0.11).add(P(0, -0.03, 0)), 0.03, 'black', { seg: 8, rb: 0.042 });
        }
        const tC = P(sx * D.bagX, D.bagY, sz * D.bagZ);                                                  // propellant lines
        curveTube([mC.clone().add(P(0, -0.05, 0)), mC.clone().lerp(tC, 0.5).add(P(0, 0.06, 0)), tC.clone().add(P(0, 0.30, 0))], 0.011, 'steel', { radial: 6 });
        curveTube([mC.clone().add(P(0.1, -0.08, 0)), mC.clone().lerp(tC, 0.5).add(P(0.08, 0.02, 0)), tC.clone().add(P(0.12, 0.22, 0.05))], 0.009, 'tube', { radial: 6 });
      });
    })();

    /* ---- 5.4 tanks (foil shrouds), gold helium tanks, foil filler blobs ---------------------------------- */
    (function buildTanks() {
      let i = 0;
      [[1, -1], [1, 1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
        const r = D.bagR * (0.96 + 0.08 * ((i++) % 2));
        foilBlob(sx * D.bagX, D.bagY, sz * D.bagZ, r, r * 0.94, r * 1.02, i % 2 ? 'foil' : 'foilRose', { amp: 0.062, freq: 3.4, ws: 72, hs: 46, fold: 1.0 });
        ringAt(P(sx * D.bagX, D.bagY + 0.02, sz * D.bagZ), UP, r * 0.99, 0.008, 'kapton', { rs: 4, ts: 40 });   // strap
      });
      [-1, 1].forEach((sz) => {                                                  // two small bare-gold helium tanks
        sphereAt(P(-0.05, -0.36, sz * 1.16), 0.17, 'tankGold');
        cyl(P(-0.05, -0.36, sz * 1.16), P(-0.05, -0.36, sz * 1.33), 0.03, 'steel', { seg: 8 });
      });
      [[-1, 0.0], [1, 0.0]].forEach(([sz, xx]) => foilBlob(xx, -0.36, sz * 1.30, 0.66, 0.20, 0.11, sz > 0 ? 'foil' : 'foilRose', { amp: 0.04, freq: 5, ws: 48, hs: 16 }));
      foilBlob(0.64, -0.38, 0.0, 0.10, 0.19, 0.98, 'foil', { amp: 0.035, freq: 5, ws: 16, hs: 40 });
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], k) => {          // foil-wrapped diagonal arms centre -> corner pods
        const L = Math.hypot(D.frameX, D.frameZ), th = -Math.atan2(sz * D.frameZ, sx * D.frameX);
        foilBlob(sx * D.frameX * 0.5, -0.60, sz * D.frameZ * 0.5, L * 0.5, 0.115, 0.125, k % 2 ? 'foil' : 'foilRose', { amp: 0.03, freq: 5, ws: 56, hs: 14, rot: [0, th, 0] });
      });
      const blobs = [
        [0.0, -0.20, 0.45, 0.30, 0.16, 0.26, 'foil'], [0.05, -0.22, -0.45, 0.28, 0.16, 0.26, 'foilRose'],
        [-0.42, -0.24, 0.0, 0.26, 0.18, 0.34, 'foil'], [0.52, -0.22, 0.0, 0.22, 0.16, 0.30, 'foil'],
        [-0.30, -0.33, 0.55, 0.24, 0.20, 0.20, 'foilRose'], [-0.30, -0.33, -0.55, 0.24, 0.20, 0.20, 'foil'],
        [0.10, -0.66, 0.30, 0.20, 0.10, 0.16, 'foil'], [-0.12, -0.66, -0.30, 0.20, 0.10, 0.16, 'foil'],
        [-0.55, -0.55, 1.05, 0.28, 0.14, 0.20, 'foilRose'], [0.60, -0.50, -1.05, 0.26, 0.14, 0.2, 'foil'],
        [0.65, -0.55, 1.05, 0.26, 0.14, 0.2, 'foil'], [-0.65, -0.50, -1.05, 0.26, 0.14, 0.22, 'foilRose'],
      ];
      blobs.forEach((b, k) => foilBlob(b[0], b[1], b[2], b[3], b[4], b[5], b[6], { amp: 0.04, freq: 5, ws: 28, hs: 18, rot: [0.4 * k, 0.9 * k, 0.2 * k] }));
    })();

    /* ---- 5.5 aft equipment: foil box, grey block with copper coil, umbilical spool + disc --------------- */
    (function buildAft() {
      foilBox(-0.80, -0.40, 0.0, 0.40, 0.32, 0.74, 'foil', { r: 0.06, amp: 0.028, freq: 6 });      // bright crinkled box (07 top centre)
      cyl(P(-0.80, -0.55, -0.40), P(-0.80, -0.55, 0.40), 0.03, 'hub', { seg: 8 });
      boxAt(-0.80, -0.60, 0.05, 0.16, 0.06, 0.22, 'black');
      const cx = -0.78, cz = -0.72;                                                                // grey block with copper wire loops
      boxAt(cx, -0.40, cz, 0.36, 0.22, 0.44, 'bronze');
      boxAt(cx, -0.286, cz, 0.30, 0.04, 0.38, 'hub');
      for (let k = 0; k < 7; k++) {
        const arc = new THREE.TorusGeometry(0.115, 0.011, 6, 18, Math.PI);       // half-loop in the XY plane (arch across X)
        arc.translate(cx, -0.268, cz - 0.16 + k * 0.054);
        put('copper', arc);
      }
      const sp = P(-0.66, -0.63, 0.30);                                                            // umbilical spool disc (bronze/orange)
      cyl(P(sp.x, sp.y - 0.03, sp.z), P(sp.x, sp.y + 0.03, sp.z), 0.20, 'bronze', { seg: 32 });
      cyl(P(sp.x, sp.y - 0.06, sp.z), P(sp.x, sp.y - 0.03, sp.z), 0.055, 'black', { seg: 16 });
      ringAt(P(sp.x, sp.y - 0.033, sp.z), UP.clone(), 0.14, 0.013, 'coil', { rs: 6, ts: 28 });
      ringAt(P(sp.x, sp.y - 0.02, sp.z), UP.clone(), 0.19, 0.012, 'kapton', { rs: 5, ts: 32 });
      const sc = P(-0.50, -0.70, -0.20);                                                           // spool cylinder with red lettering
      cyl(P(sc.x, sc.y, sc.z - 0.31), P(sc.x, sc.y, sc.z + 0.31), 0.125, 'spool', { seg: 28, uvSwap: true, uvRep: 0.62 });
      cyl(P(sc.x, sc.y, sc.z - 0.335), P(sc.x, sc.y, sc.z - 0.31), 0.13, 'black', { seg: 24 });
      ringAt(P(sc.x, sc.y, sc.z - 0.338), new V3(0, 0, 1), 0.075, 0.018, 'coil', { rs: 6, ts: 20 });
      cyl(P(sc.x, sc.y, sc.z + 0.31), P(sc.x, sc.y, sc.z + 0.34), 0.11, 'hub', { seg: 24 });
      boxAt(sc.x, sc.y + 0.10, sc.z - 0.15, 0.10, 0.03, 0.05, 'hub'); boxAt(sc.x, sc.y + 0.10, sc.z + 0.15, 0.10, 0.03, 0.05, 'hub');
      cyl(P(sc.x, sc.y + 0.10, sc.z - 0.15), P(sc.x, D.yLow, sc.z - 0.15), 0.014, 'tube', { seg: 6 });
      cyl(P(sc.x, sc.y + 0.10, sc.z + 0.15), P(sc.x, D.yLow, sc.z + 0.15), 0.014, 'tube', { seg: 6 });
      const boxes = [[-0.25, -0.60, -1.05, 0.16, 0.07, 0.22], [0.42, -0.64, -1.10, 0.14, 0.06, 0.18], [0.48, -0.62, 1.10, 0.14, 0.06, 0.20],
        [-0.42, -0.62, 1.06, 0.16, 0.07, 0.20], [0.20, -0.62, 0.66, 0.20, 0.07, 0.12], [-0.05, -0.70, -0.55, 0.16, 0.06, 0.14]];
      boxes.forEach((b, k) => boxAt(b[0], b[1], b[2], b[3], b[4], b[5], 'black', [0, 0.2 * k, 0]));   // electronics boxes
      [[0.72, -1.15], [0.72, 1.15], [-0.72, -1.15], [-0.72, 1.15], [0.72, 0.0], [-0.72, 0.0]].forEach(([x, z]) => {   // TDS antennas
        boxAt(x * 0.96, D.yLow - 0.125, z, 0.13, 0.014, 0.13, 'kapton', [0, 0.35, 0]);
        boxAt(x * 0.96, D.yLow - 0.105, z, 0.11, 0.03, 0.11, 'black', [0, 0.35, 0]);
      });
    })();

    /* ---- 5.6 hub, BUD pyramid + spool cluster ------------------------------------------------------------ */
    const hubPos = new V3(0, D.hubY, 0);
    (function buildHub() {
      const hexG = new THREE.CylinderGeometry(0.21, 0.21, 0.035, 6); hexG.rotateY(Math.PI / 6);      // hexagonal aluminium hub plate
      put('hub', hexG, new M4().makeTranslation(0, D.hubY, 0));
      put('black', new THREE.CylinderGeometry(0.062, 0.075, 0.06, 24), new M4().makeTranslation(0, D.hubY - 0.04, 0));   // bushing
      const hole = new THREE.CircleGeometry(0.038, 20); hole.rotateX(Math.PI / 2);
      put('nozzle', hole, new M4().makeTranslation(0, D.hubY - 0.071, 0));
      ringAt(P(0, D.hubY - 0.07, 0), UP.clone(), 0.062, 0.008, 'steel', { rs: 5, ts: 24 });
      for (let k = 0; k < 6; k++) {
        const a = k * TAU / 6 + Math.PI / 6;
        put('steel', new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6), new M4().makeTranslation(Math.cos(a) * 0.16, D.hubY - 0.022, Math.sin(a) * 0.16));
        cyl(P(Math.cos(a) * 0.19, D.hubY + 0.01, Math.sin(a) * 0.19), P(Math.cos(a) * 0.30, D.yLow - 0.03, Math.sin(a) * 0.30), 0.011, 'tube', { seg: 6 });
      }
      // BUD pyramid: 4 tubes from the forward cross tube down to the spool cluster ring
      const bx = D.budX, ty = D.budTopY, by = D.budBotY + 0.44;
      const baseC = [[-0.30, -0.52], [0.30, -0.52], [0.30, 0.52], [-0.30, 0.52]];
      const apexC = [[-0.10, -0.15], [0.10, -0.15], [0.10, 0.15], [-0.10, 0.15]];
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        cyl(P(bx + baseC[k][0], ty, baseC[k][1]), P(bx + apexC[k][0], by, apexC[k][1]), 0.019, 'black', { seg: 8 });
        cyl(P(bx + baseC[k][0], ty, baseC[k][1]), P(bx + baseC[n][0], ty, baseC[n][1]), 0.017, 'tube', { seg: 6 });
        cyl(P(bx + apexC[k][0], by, apexC[k][1]), P(bx + apexC[n][0], by, apexC[n][1]), 0.017, 'tube', { seg: 6 });
        put('hub', new THREE.SphereGeometry(0.03, 8, 6), new M4().makeTranslation(bx + apexC[k][0], by, apexC[k][1]));
      }
      // spool cluster: 4 vertical drums (3 descent-rate-limiter drums + the umbilical drum)
      [[-0.085, -0.10, 0.08], [0.085, -0.10, 0.08], [-0.085, 0.10, 0.08], [0.085, 0.10, 0.09]].forEach(([dx, dz, r], k) => {
        const yb = D.budBotY, yt2 = D.budBotY + 0.44;
        cyl(P(bx + dx, yb, dz), P(bx + dx, yt2, dz), r, k === 3 ? 'spool' : 'hub', { seg: 22, uvSwap: true, uvRep: 0.44 });
        cyl(P(bx + dx, yb - 0.02, dz), P(bx + dx, yb, dz), r * 1.02, 'black', { seg: 22 });
        if (k === 3) ringAt(P(bx + dx, yb - 0.021, dz), UP.clone(), r * 0.55, r * 0.16, 'coil', { rs: 5, ts: 16 });
        put('steel', new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.016, 22), new M4().makeTranslation(bx + dx, yt2 + 0.008, dz));
      });
      curveTube([P(bx, D.budBotY + 0.44, 0.0), P(bx + 0.1, D.budBotY + 0.8, 0.05), P(bx + 0.3, D.yLow - 0.02, 0.0)], 0.012, 'harness', { radial: 6, uvRep: 0.1 });
    })();

    /* ---- 5.7 harness bundles, perforated strips + blue cable, zip ties ----------------------------------- */
    (function buildHarness() {
      const rng = U.rng(9127);
      function bundle(ctrl, n, spread, r, tieAt) {
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + rng() * 0.6, rr = spread * (0.35 + 0.65 * rng());
          const off = P(Math.cos(a) * rr * 0.5, Math.sin(a) * rr * 0.9, Math.sin(a * 1.7) * rr * 0.6);
          const pts = ctrl.map((c, i) => {
            const w = Math.sin(Math.PI * i / (ctrl.length - 1)) * 0.6 + 0.4;
            return c.clone().add(off.clone().multiplyScalar(w)).add(P((rng() - 0.5) * 0.012, (rng() - 0.5) * 0.012, (rng() - 0.5) * 0.012));
          });
          curveTube(pts, r * (0.85 + 0.3 * rng()), 'harness', { radial: 7, uvRep: 0.09, segs: Math.max(10, Math.round(ctrl.length * 7)) });
        }
        const curve = new THREE.CatmullRomCurve3(ctrl);
        (tieAt || [0.25, 0.5, 0.75]).forEach((u, i) => {
          const c = curve.getPoint(u), tg = curve.getTangent(u);
          ringAt(c, tg, spread * 0.62 + r, r * 0.35, i === 1 ? 'kapton' : 'tie', { rs: 4, ts: 14 });
        });
      }
      bundle([P(-0.62, -0.50, 0.32), P(-0.30, -0.68, 0.70), P(0.20, -0.74, 0.98), P(0.62, -0.74, 0.80), P(0.72, -0.68, 0.40)], 9, 0.070, 0.017, [0.2, 0.42, 0.7]);
      bundle([P(-0.62, -0.50, -0.30), P(-0.36, -0.66, -0.62), P(0.05, -0.74, -0.92), P(0.45, -0.74, -0.82), P(0.72, -0.68, -0.5)], 8, 0.062, 0.016, [0.3, 0.55]);
      bundle([P(-0.66, -0.55, 0.12), P(-0.50, -0.66, 0.10), P(-0.28, -0.74, 0.05), P(-0.05, -0.76, 0.0)], 7, 0.055, 0.015, [0.35, 0.7]);
      bundle([P(-0.95, -0.28, -0.35), P(-1.02, -0.5, -0.6), P(-0.98, -0.62, -0.85), P(-0.85, -0.66, -1.2)], 5, 0.04, 0.012, [0.4]);
      bundle([P(-0.95, -0.28, 0.42), P(-1.02, -0.5, 0.66), P(-0.98, -0.62, 0.9), P(-0.85, -0.66, 1.25)], 5, 0.04, 0.012, [0.4]);
      // perforated aluminium strips, one with a blue braided cable clipped on (35)
      const pa = P(0.05, -0.50, -0.55), pb = P(0.48, -0.74, 0.08);
      stripBetween(pa, pb, 0.10, 0.006, 'perf');
      curveTube([pa.clone().add(P(0.0, 0.02, 0)), pa.clone().lerp(pb, 0.5).add(P(-0.02, 0.03, 0.01)), pb.clone().add(P(0.0, 0.02, 0))], 0.007, 'blue', { radial: 6, uvRep: 0.05 });
      stripBetween(P(-0.30, -0.5, 0.75), P(0.30, -0.72, 0.30), 0.09, 0.006, 'perf');
    })();

    /* ---- 5.8 DDC housing between the tanks --------------------------------------------------------------- */
    const ddcPos = new V3(-0.30, -0.95, 0.68);
    const ddcGeos = [translated(new THREE.BoxGeometry(0.10, 0.07, 0.12), ddcPos.x, ddcPos.y + 0.045, ddcPos.z), translated(new THREE.CylinderGeometry(0.028, 0.032, 0.05, 14), ddcPos.x, ddcPos.y, ddcPos.z)];
    cyl(P(ddcPos.x, ddcPos.y + 0.08, ddcPos.z), P(ddcPos.x, D.yLow, ddcPos.z + 0.02), 0.012, 'tube', { seg: 6 });
    curveTube([P(ddcPos.x + 0.05, ddcPos.y + 0.06, ddcPos.z), P(ddcPos.x + 0.20, ddcPos.y + 0.30, ddcPos.z - 0.10), P(ddcPos.x + 0.35, D.yLow - 0.02, ddcPos.z - 0.30)], 0.008, 'harness', { radial: 6, uvRep: 0.08 });

    /* ---- 5.9 merge buckets into meshes ---------------------------------------------------------------- */
    let triCount = 0;
    const meshByKey = {};
    Object.keys(buckets).forEach((key) => {
      const merged = BGU.mergeGeometries(buckets[key], false);
      const mat = M[key];
      if (!merged || !mat) { console.warn('[descentStage] bucket skipped: ' + key); return; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'ds_' + key; mesh.castShadow = true; mesh.receiveShadow = false;   // self-shadowing of thin truss members only causes acne
      stage.add(mesh); meshByKey[key] = mesh;
      triCount += merged.attributes.position.count / 3;
      buckets[key].forEach((g) => g.dispose());
    });
    engineInner.forEach((e) => {                                       // nozzle interiors (glow-capable)
      const mesh = new THREE.Mesh(e.geo, innerMats[e.idx]); mesh.name = 'ds_inner' + e.idx;
      stage.add(mesh); triCount += e.geo.attributes.position.count / 3;
    });
    const ddcHousing = new THREE.Group(); ddcHousing.name = 'ds_ddc';   // hidden for the 'ddc' panel so it never clips the camera
    ddcHousing.add(new THREE.Mesh(prep(ddcGeos[0]), M.ddcBox)); ddcHousing.add(new THREE.Mesh(prep(ddcGeos[1]), M.black));
    stage.add(ddcHousing);

    /* ==================================================================================================
     *  6. ANCHORS / MOUNTS
     * ================================================================================================ */
    // fallback rover anchors (rover local frame) if the rover module is not available (tests / degraded mode)
    const FALLBACK_BRIDLE = [new V3(0.30, 0.62, -0.55), new V3(0.30, 0.62, 0.55), new V3(-0.55, 0.62, 0.0)];
    const FALLBACK_UMB = new V3(-1.32, 0.55, -0.30);
    function roverAnchors() {
      const r = ctx.modules.rover, a = r && r.anchors;
      const ok = !!(a && a.bridle && a.bridle.length >= 3);
      return { bridle: ok ? a.bridle : FALLBACK_BRIDLE, umbilical: (a && a.umbilical) ? a.umbilical : FALLBACK_UMB };
    }
    // winch exits around the bushing; order matches rover.anchors.bridle[i] (angular assignment => no crossing cords)
    const winch = [new V3(), new V3(), new V3()];
    (function placeWinch() {
      const ra = roverAnchors();
      const c = new V3(); ra.bridle.forEach((b) => c.add(b)); c.multiplyScalar(1 / 3);
      const eyelets = [];
      ra.bridle.slice(0, 3).forEach((b, i) => {
        const a = Math.atan2(b.z - c.z, b.x - c.x);
        winch[i].set(hubPos.x + 0.042 * Math.cos(a), D.hubY - 0.085, hubPos.z + 0.042 * Math.sin(a));
        const g = new THREE.TorusGeometry(0.012, 0.004, 5, 12); g.rotateX(Math.PI / 2); g.translate(winch[i].x, winch[i].y + 0.006, winch[i].z);
        eyelets.push(prep(g));
      });
      const m = new THREE.Mesh(BGU.mergeGeometries(eyelets, false), M.steel); m.name = 'ds_eyelets'; stage.add(m);
    })();
    const umbilicalPort = new V3(-0.66, -0.685, 0.30);      // underside of the aft spool disc

    // DDC looks down -Y, image top = stage +X (forward), image right = +Z
    const ddcQuat = new Q4().setFromRotationMatrix(new M4().makeBasis(new V3(0, 0, 1), new V3(1, 0, 0), new V3(0, 1, 0)));
    const anchors = { winch, umbilicalPort, hub: hubPos.clone() };
    const mounts = { ddc: { pos: ddcPos.clone(), quat: ddcQuat, fovH: 46.9, fovV: 35.2, aspect: 4 / 3, fps: 12 } };

    /* ==================================================================================================
     *  7. BRIDLE + UMBILICAL (world space, analytic)
     * ================================================================================================ */
    const bridleGroup = new THREE.Group(); bridleGroup.name = 'ds_bridle';
    function makeTube(maxRings, radial, mat, name) {
      const R1 = radial + 1;
      const pos = new Float32Array(maxRings * R1 * 3), nor = new Float32Array(maxRings * R1 * 3), uv = new Float32Array(maxRings * R1 * 2);
      const idx = new Uint32Array((maxRings - 1) * radial * 6);
      let k = 0;
      for (let i = 0; i < maxRings - 1; i++) for (let j = 0; j < radial; j++) {
        const a = i * R1 + j, b = (i + 1) * R1 + j, c = (i + 1) * R1 + j + 1, d = i * R1 + j + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = d; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false; mesh.name = name;
      const cs = new Float32Array(R1), sn = new Float32Array(R1);
      for (let j = 0; j <= radial; j++) { cs[j] = Math.cos((j / radial) * TAU); sn[j] = Math.sin((j / radial) * TAU); }
      bridleGroup.add(mesh);
      return { mesh, geo, pos, nor, uv, R: radial, R1, maxRings, cs, sn, pts: new Float32Array(maxRings * 3) };
    }
    /** fill the tube T from T.pts[0..3n), radius r, uv.x = arclength * uvPerM  (parallel-transport frames) */
    function fillTube(T, n, r, uvPerM) {
      const Pp = T.pts, R = T.R, R1 = T.R1;
      if (n < 2) { T.geo.setDrawRange(0, 0); T.mesh.visible = false; return; }
      let nx = 0, ny = 0, nz = 0, arc = 0;
      for (let i = 0; i < n; i++) {
        const i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
        let tx = Pp[i1 * 3] - Pp[i0 * 3], ty = Pp[i1 * 3 + 1] - Pp[i0 * 3 + 1], tz = Pp[i1 * 3 + 2] - Pp[i0 * 3 + 2];
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        if (i === 0) {
          const ax = Math.abs(tx), ay = Math.abs(ty), az = Math.abs(tz);
          let rx = 0, ry = 0, rz = 0;
          if (ax <= ay && ax <= az) rx = 1; else if (ay <= az) ry = 1; else rz = 1;
          const d = rx * tx + ry * ty + rz * tz;
          nx = rx - d * tx; ny = ry - d * ty; nz = rz - d * tz;
        } else {
          const d = nx * tx + ny * ty + nz * tz;
          nx -= d * tx; ny -= d * ty; nz -= d * tz;
        }
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
        if (i > 0) arc += Math.hypot(Pp[i * 3] - Pp[i * 3 - 3], Pp[i * 3 + 1] - Pp[i * 3 - 2], Pp[i * 3 + 2] - Pp[i * 3 - 1]);
        for (let j = 0; j < R1; j++) {
          const c = T.cs[j], s = T.sn[j];
          const dx = c * nx + s * bx, dy = c * ny + s * by, dz = c * nz + s * bz;
          const o = (i * R1 + j) * 3;
          T.pos[o] = Pp[i * 3] + r * dx; T.pos[o + 1] = Pp[i * 3 + 1] + r * dy; T.pos[o + 2] = Pp[i * 3 + 2] + r * dz;
          T.nor[o] = dx; T.nor[o + 1] = dy; T.nor[o + 2] = dz;
          T.uv[(i * R1 + j) * 2] = arc * uvPerM; T.uv[(i * R1 + j) * 2 + 1] = j / R;
        }
      }
      T.geo.setDrawRange(0, (n - 1) * R * 6);
      T.geo.attributes.position.needsUpdate = true; T.geo.attributes.normal.needsUpdate = true; T.geo.attributes.uv.needsUpdate = true;
      T.mesh.visible = true;
    }
    const CORD_R = 0.0085, UMB_R = 0.020;
    const cordMain = [0, 1, 2].map((i) => makeTube(34, 6, M.cord, 'ds_cord' + i));
    const cordStub = [0, 1, 2].map((i) => makeTube(44, 6, M.cord, 'ds_cordStub' + i));
    const umbMain = makeTube(120, 10, M.umb, 'ds_umb');
    const umbStub = makeTube(70, 10, M.umb, 'ds_umbStub');
    if (scene) scene.add(bridleGroup);

    const wA = [new V3(), new V3(), new V3()], wB = [new V3(), new V3(), new V3()];
    const wU0 = new V3(), wU1 = new V3();
    const sQ = new Q4(), rQ = new Q4();
    const bB = new V3(), bD = new V3(), bp1 = new V3(), bp2 = new V3(), bdir = new V3(), bt = new V3();
    const XAX = new V3(1, 0, 0);

    function basisFor(dir, p1, p2) {
      const ref = Math.abs(dir.y) < 0.9 ? UP : XAX;
      p1.crossVectors(dir, ref).normalize(); p2.crossVectors(dir, p1).normalize();
    }

    /** taut (or slightly slack) cord A->B */
    function drawCord(i, A, B, slack) {
      const T = cordMain[i], n = 14;
      const d = A.distanceTo(B);
      const sag = slack > 0.001 ? Math.min(1.6, Math.sqrt(3 * d * slack / 8)) : 0;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1), s = sag * 4 * u * (1 - u);
        T.pts[k * 3] = A.x + (B.x - A.x) * u; T.pts[k * 3 + 1] = A.y + (B.y - A.y) * u - s; T.pts[k * 3 + 2] = A.z + (B.z - A.z) * u;
      }
      fillTube(T, n, CORD_R, 1 / 0.25);
    }

    /** umbilical: scalloped festoon (helical meander) from the stage port A to the rover connector B */
    function drawUmbilical(A, B, deployed, t) {
      const T = umbMain, n = 96;
      bD.subVectors(B, A); const d = bD.length() || 1; bdir.copy(bD).multiplyScalar(1 / d);
      basisFor(bdir, bp1, bp2);
      const amp = Math.min(0.06 * d, 0.05 + 0.13 * U.smoothstep(0.05, 0.85, deployed));
      const waves = 4.5 + 2.5 * Math.min(1, d / 6);
      const ph = t * 0.55, ph2 = t * 0.41 + 1.3;
      const droopK = Math.min(0.25, 0.03 * d);
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        const env = Math.pow(Math.sin(Math.PI * u), 0.6);
        const a1 = amp * env * Math.sin(TAU * waves * u + ph), a2 = amp * 0.55 * env * Math.cos(TAU * waves * u + ph2);
        const droop = droopK * 4 * u * (1 - u);
        T.pts[k * 3] = A.x + bD.x * u + bp1.x * a1 + bp2.x * a2;
        T.pts[k * 3 + 1] = A.y + bD.y * u + bp1.y * a1 + bp2.y * a2 - droop;
        T.pts[k * 3 + 2] = A.z + bD.z * u + bp1.z * a1 + bp2.z * a2;
      }
      fillTube(T, n, UMB_R, 1 / 0.38);
    }

    /** upper (stage-side) dangling free end after the cut: analytic damped wave, pure function of age */
    function drawDangling(T, A, dirW, len, age, phase, ampK, radius, uvPerM, nPts) {
      basisFor(dirW, bp1, bp2);
      const env = Math.exp(-age / 2.6), grow = U.smoothstep(0.0, 0.18, age);
      const swayK = 0.16 + 0.10 * Math.exp(-age / 6.0);
      for (let k = 0; k < nPts; k++) {
        const u = k / (nPts - 1), s = u * len;
        const u14 = Math.pow(u, 1.4);
        const wph = TAU * (1.5 * u - 0.85 * age) + phase;
        const whip = ampK * grow * env * u14 * Math.sin(wph), whip2 = ampK * 0.6 * grow * env * u14 * Math.cos(wph);
        const sway = swayK * u * u * Math.sin(TAU * (0.55 * u - 0.32 * age) + phase * 1.7) * (0.4 + 0.6 * grow);
        const sway2 = swayK * 0.7 * u * u * Math.cos(TAU * (0.5 * u - 0.27 * age) + phase * 0.9) * (0.4 + 0.6 * grow);
        const rc = 0.10 * U.smoothstep(0.66, 1.0, u) * (0.35 + 0.65 * grow) * (0.5 + 0.5 * Math.exp(-age / 9));   // small curl near the free end
        const ph = TAU * (s / 0.42) - TAU * 1.1 * age + phase;
        const ox = whip + sway + rc * Math.cos(ph), oy = whip2 + sway2 + rc * Math.sin(ph);
        const sh = 1 - 0.24 * rc * u;
        T.pts[k * 3] = A.x + dirW.x * s * sh + bp1.x * ox + bp2.x * oy;
        T.pts[k * 3 + 1] = A.y + dirW.y * s * sh + bp1.y * ox + bp2.y * oy;
        T.pts[k * 3 + 2] = A.z + dirW.z * s * sh + bp1.z * ox + bp2.z * oy;
      }
      fillTube(T, nPts, radius, uvPerM);
    }

    /** rover-side remainder after the cut: stands straight up for an instant, then collapses (rope falling under
     *  Mars gravity) into a loose serpentine heap next to its anchor.  Pure function of age. */
    const _lie = new V3(), _perp = new V3();
    function drawFallen(T, B, up, len, age, phase, radius, uvPerM, nPts, gY, lie, spread) {
      _perp.set(-lie.z, 0, lie.x);
      const hB = Math.max(0, B.y - gY);
      for (let k = 0; k < nPts; k++) {
        const u = k / (nPts - 1), s = u * len;
        const ix = B.x + up.x * s, iy = B.y + up.y * s, iz = B.z + up.z * s;                 // initial: straight toward the stage
        const r = 0.30 + spread * Math.sqrt(u), wig = 0.42 * u * Math.sin(6.5 * u + phase) * spread;
        const fx = B.x + lie.x * r + _perp.x * wig, fz = B.z + lie.z * r + _perp.z * wig;   // final: heap on the ground
        const fy = gY + 0.035 + hB * (1 - U.smoothstep(0.0, 0.16, u)) + 0.03 * Math.sin(u * 23 + phase);
        const f = U.smoothstep(0.0, 0.25 + 1.6 * u, age);
        T.pts[k * 3] = ix + (fx - ix) * f; T.pts[k * 3 + 1] = iy + (fy - iy) * f; T.pts[k * 3 + 2] = iz + (fz - iz) * f;
      }
      fillTube(T, nPts, radius, uvPerM);
    }

    const lieDir = [new V3(0.8, 0, -0.6), new V3(0.8, 0, 0.6), new V3(-1, 0, 0.1)];
    const upperLen = [2.4, 2.1, 2.7], UMB_UPPER = 3.4, UMB_TOTAL = 8.0;

    function hideBridle() {
      cordMain.forEach((c) => (c.mesh.visible = false)); cordStub.forEach((c) => (c.mesh.visible = false));
      umbMain.mesh.visible = false; umbStub.mesh.visible = false;
    }
    function updateBridle(S, t) {
      const B = S.bodies, ds = B.descentStage, rv = B.rover, br = S.bridle || {}, um = S.umbilical || {};
      const length = br.length || 0;
      if (!(ds && rv && ds.visible !== false && (length > 0.02 || br.cut))) { hideBridle(); return; }
      const ra = roverAnchors();
      sQ.set(ds.quat[0], ds.quat[1], ds.quat[2], ds.quat[3]);
      rQ.set(rv.quat[0], rv.quat[1], rv.quat[2], rv.quat[3]);
      for (let i = 0; i < 3; i++) {
        wA[i].copy(winch[i]).applyQuaternion(sQ); wA[i].x += ds.pos[0]; wA[i].y += ds.pos[1]; wA[i].z += ds.pos[2];
        wB[i].copy(ra.bridle[i]).applyQuaternion(rQ); wB[i].x += rv.pos[0]; wB[i].y += rv.pos[1]; wB[i].z += rv.pos[2];
      }
      wU0.copy(umbilicalPort).applyQuaternion(sQ); wU0.x += ds.pos[0]; wU0.y += ds.pos[1]; wU0.z += ds.pos[2];
      wU1.copy(ra.umbilical).applyQuaternion(rQ); wU1.x += rv.pos[0]; wU1.y += rv.pos[1]; wU1.z += rv.pos[2];

      if (!br.cut) {
        cordStub.forEach((c) => (c.mesh.visible = false)); umbStub.mesh.visible = false;
        const tension = br.tension === undefined ? 1 : br.tension;
        for (let i = 0; i < 3; i++) {
          const d = wA[i].distanceTo(wB[i]);
          drawCord(i, wA[i], wB[i], Math.max(0, length - d) + (tension < 0.98 ? (0.98 - tension) * 0.35 : 0));
        }
        const ud = um.deployed === undefined ? U.saturate(length / (C.ds.bridleLength || 7.6)) : um.deployed;
        if (ud > 0.01 && !um.cut) drawUmbilical(wU0, wU1, ud, t); else umbMain.mesh.visible = false;
        return;
      }
      // ---- after the cut: the stage keeps short stubs that whip and curl; the long rover-side remainders fall limp ----
      const age = Math.max(0, br.ageSinceCut || 0);
      const vel = ds.vel || [0, 0, 0];
      bdir.set(0, -1, 0).addScaledVector(bt.set(vel[0], vel[1], vel[2]), -0.045).normalize();   // trail opposite the stage motion
      const gY = rv.pos[1] - (C.rover.groundOffset || 1.35);
      for (let i = 0; i < 3; i++) {
        drawDangling(cordMain[i], wA[i], bdir, upperLen[i], age, i * 2.1 + 0.4, 0.30, CORD_R, 1 / 0.25, 26);
        bB.copy(wA[i]).sub(wB[i]).normalize();
        _lie.set(wB[i].x - rv.pos[0], 0, wB[i].z - rv.pos[2]); if (_lie.lengthSq() < 1e-4) _lie.copy(lieDir[i]); _lie.normalize();
        drawFallen(cordStub[i], wB[i], bB, Math.max(0.5, Math.max(length, 7.0) - upperLen[i]), age, i * 1.7, CORD_R, 1 / 0.25, 40, gY, _lie, 1.7 + 0.25 * i);
      }
      drawDangling(umbMain, wU0, bdir, UMB_UPPER, age, 0.9, 0.34, UMB_R, 1 / 0.38, 90);
      bB.copy(wU0).sub(wU1).normalize();
      _lie.set(wU1.x - rv.pos[0], 0, wU1.z - rv.pos[2]); if (_lie.lengthSq() < 1e-4) _lie.copy(lieDir[2]); _lie.normalize();
      drawFallen(umbStub, wU1, bB, UMB_TOTAL - UMB_UPPER, age, 3.3, UMB_R, 1 / 0.38, 64, gY, _lie, 1.5);
    }

    /* ==================================================================================================
     *  8. UPDATE
     * ================================================================================================ */
    const emisCol = new THREE.Color();
    let envChecked = false;
    function update(t, camera, view) {
      const fl = ctx.modules.flight;
      if (!fl || !fl.state) return;
      const S = fl.state(t);
      const ds = S.bodies && S.bodies.descentStage;
      if (!ds) return;
      if (!envChecked && scene && scene.environment) {           // the atmosphere module provides an environment: use it
        envChecked = true;
        allMats.forEach((m) => { m.envMap = null; m.needsUpdate = true; });
      }
      U.applyPose(group, ds);
      group.visible = ds.visible !== false;
      ddcHousing.visible = !(view && view.panelId === 'ddc');
      // engine nozzle glow (subtle emissive on the chamber interior, plumes belong to fx)
      const en = S.engines;
      for (let i = 0; i < 8; i++) {
        const th = en && en.lit && en.throttle ? en.throttle[i] || 0 : 0;
        const k = th > 0.001 ? 0.01 + 0.07 * Math.sqrt(th) : 0;
        emisCol.setRGB(k, 0.22 * k, 0.04 * k);
        innerMats[i].emissive.copy(emisCol);
      }
      try { updateBridle(S, t); } catch (e) { if (!update._err) { update._err = 1; console.error('[descentStage] bridle update failed', e); } }
    }

    /* ==================================================================================================
     *  9. PUBLIC API
     * ================================================================================================ */
    const api = {
      group, bridleGroup, update,
      anchors, engines, mounts,
      dimensions: { span: 3.94, length: 2.94, deckHalfX: D.deckHX, deckHalfZ: D.deckHZ, topY: 0.19, lowestY: D.budBotY - 0.02, exitR: D.exitR },
      worldPoint(local, out) { out = out || new V3(); return group.localToWorld(out.copy(local)); },
      triangles: triCount,
      materials: M,
      _dbg: { D, meshByKey },
    };
    console.log('[descentStage] built: ' + Math.round(triCount) + ' triangles, ' + (performance.now() - _t0).toFixed(0) + ' ms');
    return api;
  });
})();
