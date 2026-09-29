'use strict';
// renderer_passes.js — key-light shadow map, planar floor reflection, floor drawing, quality control (extends PG.Renderer).
// Loaded by js/renderer.js right after itself. Internal: nothing here is public API except r.setQuality() / r.qualityLevel.
//
//   SHADOW MAP   orthographic depth map (DEPTH_COMPONENT32F, settings.shadowSize) fitted to the union of the world bounding
//                boxes of all visible opaque casters (quantised to 0.2 m so it does not shimmer), extended down to the floor
//                so that the floor shadow is covered. Sampled with hardware PCF + a PCSS-lite blocker search (see RS.shadowLib).
//                Re-rendered when the set of casters / light / fit changes, and at most settings.shadowHz times per second
//                while casters animate. Slope-scaled polygon offset while rendering + normal-offset bias when sampling.
//   KEY LIGHT    environment definitions may carry  light: { dir, irradiance:[r,g,b], radius }  (dir = env-space direction TOWARDS
//                the light, radius = angular radius in radians). The environment's irradiance map is generated WITHOUT the key
//                (envRadiance is compiled with PG_NO_KEY), the surface shader adds the key analytically with the shadow.
//   PLANAR REFLECTION   parts with reflect:true are drawn with a mirrored view-projection (real geometry, mirrored camera, y<0
//                clipped) into an RGBA16F target (premultiplied colour + coverage) plus an R16F target (ray distance). The floor
//                shader blurs it by roughness x ray length (contact hardening) using the mip chain.
(function () {
  const PG = window.PG = window.PG || {};
  const R = PG.Renderer.prototype;
  const m4 = PG.m4;

  // ------------------------------------------------------------------------------------------------ key light
  // World-space key light for the current environment (or null): { dir:[x,y,z] towards light, col:[r,g,b] (E/pi), radius }
  R._keyLight = function () {
    const S = this.settings, e = this.env, L = e && e.def.light;
    if (!L || S.keyLight === false) return null;
    const a = S.envRotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let d = L.dir, l = Math.hypot(d[0], d[1], d[2]) || 1; d = [d[0] / l, d[1] / l, d[2] / l];
    const k = (S.keyIntensity === undefined ? 1 : S.keyIntensity) / Math.PI;
    const cache = this._lightCache || (this._lightCache = { dir: [0, 1, 0], col: [0, 0, 0], radius: 0.1 });
    cache.dir[0] = c * d[0] - s * d[2]; cache.dir[1] = d[1]; cache.dir[2] = s * d[0] + c * d[2];
    cache.col[0] = L.irradiance[0] * k; cache.col[1] = L.irradiance[1] * k; cache.col[2] = L.irradiance[2] * k;
    cache.radius = L.radius || 0.1;
    return cache;
  };

  // ------------------------------------------------------------------------------------------------ shadow map
  R._initShadow = function () {
    const gl = this.gl;
    const mk = (filter, cmp) => {
      const sm = gl.createSampler();
      gl.samplerParameteri(sm, gl.TEXTURE_MIN_FILTER, filter); gl.samplerParameteri(sm, gl.TEXTURE_MAG_FILTER, filter);
      gl.samplerParameteri(sm, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.samplerParameteri(sm, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(sm, gl.TEXTURE_COMPARE_MODE, cmp ? gl.COMPARE_REF_TO_TEXTURE : gl.NONE);
      if (cmp) gl.samplerParameteri(sm, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      return sm;
    };
    this._shadow = { size: 0, tex: null, fbo: null, cmpSampler: mk(gl.LINEAR, true), rawSampler: mk(gl.NEAREST, false), mat: new Float32Array(16), vp: new Float32Array(16),
      texel: 0.003, zr: 10, tanL: 0.1, search: 0.2, maxTexels: 40, key: '', last: -1e9, pending: false, valid: false };
    this._allocShadow(Math.max(256, this.settings.shadowSize | 0 || 2048));
    this._shadowOn = false; this._light = null;
  };
  R._allocShadow = function (size) {
    const gl = this.gl, sh = this._shadow;
    if (sh.tex) gl.deleteTexture(sh.tex); if (sh.fbo) gl.deleteFramebuffer(sh.fbo);
    size = Math.min(size, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    sh.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, sh.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    sh.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, sh.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sh.tex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    sh.size = size; sh.key = ''; sh.valid = false;
  };

  // uniforms shared by the surface programs and the floor program
  R._shadowUniforms = function (u) {
    const gl = this.gl, sh = this._shadow, L = this._light, on = this._shadowOn && L && sh.valid;
    if (u.pgLightDir) { const d = L ? L.dir : [0, 1, 0]; gl.uniform3f(u.pgLightDir, d[0], d[1], d[2]); }
    if (u.pgLightCol) { const c = L ? L.col : [0, 0, 0]; gl.uniform3f(u.pgLightCol, c[0], c[1], c[2]); }
    if (u.pgShadowMat) gl.uniformMatrix4fv(u.pgShadowMat, false, sh.mat);
    if (u.pgShadowA) gl.uniform4f(u.pgShadowA, sh.texel, sh.zr, sh.tanL, 1 / sh.size);
    if (u.pgShadowB) gl.uniform4f(u.pgShadowB, on ? 1 : 0, sh.search, sh.maxTexels, 0);
  };

  const BIAS = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);
  const _up = [1, 0, 0];

  R._passShadow = function (moved) {
    const gl = this.gl, S = this.settings, sh = this._shadow, L = this._light;
    if (!L) { this._shadowOn = false; return; }
    const want = Math.max(256, S.shadowSize | 0 || 2048);
    if (sh.size !== Math.min(want, gl.getParameter(gl.MAX_TEXTURE_SIZE))) this._allocShadow(want);

    // ---- casters + their world AABB
    const list = this._shadowList || (this._shadowList = []); list.length = 0;
    let sig = 0, x0 = 1e30, y0 = 1e30, z0 = 1e30, x1 = -1e30, y1 = -1e30, z1 = -1e30;
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.gpu || !p.castShadow || !p.material || !p.material.castShadow || p.material.blend !== 'opaque' || !p.gpu.count) continue;
      if (!this._isVisible(p)) continue;
      list.push(p); sig = (sig * 31 + p.id) | 0;
      const b = p.wb;
      if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] < z0) z0 = b[2];
      if (b[3] > x1) x1 = b[3]; if (b[4] > y1) y1 = b[4]; if (b[5] > z1) z1 = b[5];
    }
    if (!list.length) { this._shadowOn = false; return; }
    let mn, mx;
    if (S.shadowFit) { mn = S.shadowFit.min; mx = S.shadowFit.max; }
    else {
      const q = 0.2; mn = [Math.floor(x0 / q) * q, Math.max(0, Math.floor(y0 / q) * q), Math.floor(z0 / q) * q]; mx = [Math.ceil(x1 / q) * q, Math.ceil(y1 / q) * q, Math.ceil(z1 / q) * q];
    }
    const d = L.dir, key = sig + '|' + mn.join() + '|' + mx.join() + '|' + d[0].toFixed(4) + d[1].toFixed(4) + d[2].toFixed(4) + '|' + S.shadowSoftness + '|' + want;
    if (moved) sh.pending = true;
    const now = performance.now();
    const dirty = key !== sh.key || !sh.valid;
    const hz = (S.shadowHz || 30) * (this._castMovedC ? 1 : 0.5);      // casters that only rotate in place (wheels) refresh at half rate
    if (!dirty && !(sh.pending && now - sh.last >= 1000 / hz)) { this._shadowOn = true; return; }
    sh.key = key; sh.pending = false; sh.last = now;

    // ---- light-space fit
    const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const up = Math.abs(d[0]) > 0.9 ? [0, 0, 1] : _up;
    const eye = [c[0] + d[0] * 30, c[1] + d[1] * 30, c[2] + d[2] * 30];
    const view = sh.view || (sh.view = new Float32Array(16)); m4.lookAt(eye, c, up, view);
    let lx0 = 1e30, ly0 = 1e30, lz0 = 1e30, lx1 = -1e30, ly1 = -1e30, lz1 = -1e30;
    const add = (X, Y, Z) => {
      const vx = view[0] * X + view[4] * Y + view[8] * Z + view[12], vy = view[1] * X + view[5] * Y + view[9] * Z + view[13], vz = view[2] * X + view[6] * Y + view[10] * Z + view[14];
      if (vx < lx0) lx0 = vx; if (vx > lx1) lx1 = vx; if (vy < ly0) ly0 = vy; if (vy > ly1) ly1 = vy; if (vz < lz0) lz0 = vz; if (vz > lz1) lz1 = vz;
    };
    for (let k = 0; k < 8; k++) {
      const X = k & 1 ? mx[0] : mn[0], Y = k & 2 ? mx[1] : mn[1], Z = k & 4 ? mx[2] : mn[2];
      add(X, Y, Z);
      if (d[1] > 0.05) { const t = Y / d[1]; add(X - d[0] * t, 0, Z - d[2] * t); }     // the same corner projected along the light onto the floor
    }
    let half = Math.max(lx1 - lx0, ly1 - ly0) / 2 + 0.06; half = Math.ceil(half / 0.1) * 0.1;
    const texel = 2 * half / sh.size;
    const cx = Math.round((lx0 + lx1) / 2 / texel) * texel, cy = Math.round((ly0 + ly1) / 2 / texel) * texel;   // texel snapping
    const n = -lz1 - 0.25, f = -lz0 + 0.25;
    m4.ortho(cx - half, cx + half, cy - half, cy + half, n, f, sh.proj || (sh.proj = new Float32Array(16)));
    m4.multiply(sh.proj, view, sh.vp); m4.multiply(BIAS, sh.vp, sh.mat);
    const tanL = Math.tan(L.radius) * (S.shadowSoftness === undefined ? 1 : S.shadowSoftness);
    sh.texel = texel; sh.zr = f - n; sh.tanL = tanL; sh.search = Math.max(0.10, 1.9 * tanL);
    sh.maxTexels = Math.min(44, Math.max(6, 0.55 * sh.search / texel * 2.0));

    // ---- render depth
    gl.bindFramebuffer(gl.FRAMEBUFFER, sh.fbo); gl.viewport(0, 0, sh.size, sh.size);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.5, 1.0);
    const P = this._pShadow; gl.useProgram(P.prog); this._curProg = null; this._curMat = null;
    gl.uniformMatrix4fv(P.u.pgViewProj, false, sh.vp);
    let draws = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i], g = p.gpu;
      gl.uniformMatrix4fv(P.u.pgModel, false, p.world); gl.bindVertexArray(g.vao);
      if (g.ibo) gl.drawElements(gl.TRIANGLES, g.count, g.indexType, 0); else gl.drawArrays(gl.TRIANGLES, 0, g.count);
      draws++;
    }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stats.shadowDraws = draws; sh.valid = true; this._shadowOn = true;
  };

  // ------------------------------------------------------------------------------------------------ planar reflection
  R._freeRefl = function () {
    const gl = this.gl, r = this._refl; if (!r) return;
    for (const st of r.sets) { gl.deleteTexture(st.colorTex); gl.deleteTexture(st.distTex); gl.deleteFramebuffer(st.fbo); }
    if (r.depthRb) gl.deleteRenderbuffer(r.depthRb);
    this._refl = null;
  };
  // Two render-target sets are used alternately (ping-pong): the floor of frame N samples the set that frame N+1 does not write.
  R._ensureRefl = function () {
    const gl = this.gl, S = this.settings;
    const sc = Math.min(1, Math.max(0.2, S.reflectionScale || 0.5));
    const w = Math.max(64, Math.round(this.width * sc)), h = Math.max(64, Math.round(this.height * sc));
    let r = this._refl;
    if (r && r.w === w && r.h === h) return r;
    this._freeRefl();
    const levels = Math.min(8, 1 + Math.floor(Math.log2(Math.max(w, h))));
    const mk = (fmt) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    r = { w, h, levels, ok: true, scale: w / this.width, sets: [], idx: 0 };
    r.depthRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r.depthRb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    for (let k = 0; k < 2; k++) {
      const st = { colorTex: mk(gl.RGBA16F), distTex: mk(gl.R16F), fbo: gl.createFramebuffer() };
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.colorTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, st.distTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, r.depthRb);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) r.ok = false;
      r.sets.push(st);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    r.colorTex = r.sets[0].colorTex; r.distTex = r.sets[0].distTex;
    if (!r.ok) console.warn('[PG] planar reflection target incomplete: reflections disabled');
    this._refl = r; return r;
  };
  const _mirrorM = m4.scaling(1, -1, 1);
  R._passReflection = function () {
    const gl = this.gl, r = this._ensureRefl();
    if (!r.ok) { this._reflOn = false; return; }
    const e = this.cam.eye, meye = this._mirrorEye || (this._mirrorEye = [0, 0, 0]);
    meye[0] = e[0]; meye[1] = -e[1]; meye[2] = e[2];
    const mvp = this._mirrorVP || (this._mirrorVP = new Float32Array(16));
    m4.multiply(this.viewProj, _mirrorM, mvp);
    const planes = this._mirrorPlanes || (this._mirrorPlanes = new Float32Array(24));
    this._extractPlanes(mvp, planes);
    const opq = this._ropq || (this._ropq = []), trn = this._rtrn || (this._rtrn = []); opq.length = 0; trn.length = 0;
    this._buildLists(opq, trn, planes, meye, true);

    this._mirror = true; this._passVP = mvp; this._passCam = meye; this._passId++;
    r.idx ^= 1; const set = r.sets[r.idx];
    gl.bindFramebuffer(gl.FRAMEBUFFER, set.fbo); gl.viewport(0, 0, r.w, r.h);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.colorMask(true, true, true, true); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]); gl.clearBufferfv(gl.DEPTH, 0, [1]);
    this._bindEnv();
    this._curProg = null; this._curMat = null; this._curFlip = false; this._curCull = -1; gl.frontFace(gl.CCW);
    const d0 = this.stats.draws, t0 = this.stats.tris;
    this._drawLists(opq, trn, false);
    this.stats.reflDraws = this.stats.draws - d0; this.stats.draws = d0; this.stats.reflTris = this.stats.tris - t0; this.stats.tris = t0;
    gl.frontFace(gl.CCW); gl.disable(gl.CULL_FACE); gl.bindVertexArray(null);
    this._mirror = false; this._curProg = null; this._curMat = null;
    r.colorTex = set.colorTex; r.distTex = set.distTex;
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, r.colorTex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, r.distTex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._reflOn = true;
  };

  // ------------------------------------------------------------------------------------------------ floor
  R._drawFloor = function () {
    const gl = this.gl, P = this._pFloor, u = P.u, e = this.env, bg = e.def.bg, fl = e.def.floor || {}, S = this.settings, c = this.cam;
    gl.useProgram(P.prog); gl.bindVertexArray(this._emptyVao); this._curProg = null;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(u.pgViewProj, false, this.viewProj); gl.uniform3f(u.pgCam, c.eye[0], c.eye[1], c.eye[2]);
    gl.uniform1f(u.pgSize, 400);
    this._envUniforms(u); this._shadowUniforms(u);
    gl.uniform3fv(u.pgBgTop, bg.top); gl.uniform3fv(u.pgBgHorizon, bg.horizon); gl.uniform3fv(u.pgBgFloor, bg.floor);
    gl.uniform2f(u.pgBgEnv, e.def.bgEnv ? e.def.bgEnv[0] : 0, e.def.bgEnv ? e.def.bgEnv[1] : 0);
    const al = fl.albedo || [0.03, 0.03, 0.03], nz = (a, b) => a !== undefined ? a : b;
    gl.uniform3f(u.pgFloorAlbedo, al[0], al[1], al[2]);
    gl.uniform4f(u.pgFloorP0, nz(fl.roughness, 0.25), nz(fl.reflectivity, 1) * Math.min(1, S.floorReflection), nz(fl.reflBlur, 0.3), nz(fl.envReflect, 0.5));
    gl.uniform4f(u.pgFloorFade, nz(fl.fadeStart, 6), nz(fl.fadeEnd, 30), nz(fl.poolRadius, 9), nz(fl.poolMin, 0.35));
    const o = this._occl;
    gl.uniform4f(u.pgOcclRect, o.rect[0], o.rect[1], o.rect[2], o.rect[3]);
    gl.uniform1f(u.pgOcclOn, S.shadows ? 1 : 0); gl.uniform1f(u.pgOcclStrength, S.occlusionStrength);
    const rf = this._refl, on = this._reflOn && rf && rf.ok;
    gl.uniform4f(u.pgRefl, rf ? rf.scale : 0.5, 2 * Math.tan(c.fov * Math.PI / 360) / this.height, on ? 1 : 0, { refl: 1, shadow: 2, ao: 3, dist: 4 }[S.debugFloor] || 0);
    gl.uniform2f(u.pgFullRes, this.width, this.height); gl.uniform2f(u.pgReflTexel, rf ? 1 / rf.w : 1, rf ? 1 / rf.h : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  // ------------------------------------------------------------------------------------------------ quality control
  // Presets: low / medium / high (default) / ultra. Also driven automatically (settings.adaptive) when frames get slow.
  const QUALITY = {
    low: { msaa: 0, shadowSize: 1024, reflectionScale: 0.35 },
    medium: { msaa: 2, shadowSize: 2048, reflectionScale: 0.4 },
    high: { msaa: 4, shadowSize: 2048, reflectionScale: 0.5 },
    ultra: { msaa: 4, shadowSize: 4096, reflectionScale: 0.75 },
  };
  R.setQuality = function (name) {
    const q = QUALITY[name]; if (!q) throw new Error('unknown quality "' + name + '" (low|medium|high|ultra)');
    Object.assign(this.settings, q); this.quality = name; this._slow = 0; return this;
  };
  R.listQualities = () => Object.keys(QUALITY);
  // Automatic fallback: sustained frame times above ~26 ms step the quality down one notch (never back up on its own).
  const STEPS = [{ reflectionScale: 0.4 }, { shadowSize: 1024 }, { msaa: 2, maxDpr: 1.5 }, { msaa: 0, reflectionScale: 0.3 }, { maxDpr: 1 }];
  R._adapt = function (dt) {
    if (this.timeOverride !== null || dt <= 0) return;
    if (dt > 0.026 && dt < 0.09) this._slow = (this._slow || 0) + 1; else this._slow = Math.max(0, (this._slow || 0) - 2);
    if (this._slow > 90 && this.qualityLevel < STEPS.length) {
      Object.assign(this.settings, STEPS[this.qualityLevel]); this.qualityLevel++; this._slow = 0;
      PG.log('adaptive quality: level ' + this.qualityLevel + ' ' + JSON.stringify(STEPS[this.qualityLevel - 1]));
    }
  };
})();
