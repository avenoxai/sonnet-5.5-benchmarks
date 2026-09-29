'use strict';
// core.js — shared math, GL helpers, utilities and the module registry.
// Global namespace: window.PG. Classic script (works from file://). No dependencies.
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PG = root.PG = root.PG || {};

  // ------------------------------------------------------------------ util
  const util = PG.util = {
    clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    mix: (a, b, t) => a + (b - a) * t,
    smoothstep: (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
    deg2rad: d => d * Math.PI / 180,
    rad2deg: r => r * 180 / Math.PI,
    srgb2lin: c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    lin2srgb: c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055,
    // '#rrggbb' | '#rgb' | [r,g,b] 0..255 -> LINEAR [r,g,b] 0..1 (colour inputs given as sRGB hex are converted).
    hex(h) {
      if (Array.isArray(h)) return h.map(v => util.srgb2lin(v / 255));
      h = String(h).replace('#', '');
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const n = parseInt(h, 16);
      return [util.srgb2lin(((n >> 16) & 255) / 255), util.srgb2lin(((n >> 8) & 255) / 255), util.srgb2lin((n & 255) / 255)];
    },
    // Deterministic PRNG (mulberry32) — never use Math.random() in model generation so builds are reproducible.
    rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
    nextFrame: () => new Promise(r => requestAnimationFrame(() => r())),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
  };

  // ------------------------------------------------------------------ vec3 (plain arrays)
  const v3 = PG.v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    length: a => Math.hypot(a[0], a[1], a[2]),
    distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    normalize(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    neg: a => [-a[0], -a[1], -a[2]],
  };

  // ------------------------------------------------------------------ mat4 (column-major Float32Array(16), OpenGL convention)
  const m4 = PG.m4 = {
    identity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    clone: m => new Float32Array(m),
    // returns a*b  (apply b first, then a, when transforming column vectors: p' = a*b*p)
    multiply(a, b, out) {
      out = out || new Float32Array(16);
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return out;
    },
    // chain(A,B,C) = A*B*C  (C is applied to the point first)
    chain(...ms) { let r = ms[0]; for (let i = 1; i < ms.length; i++) r = m4.multiply(r, ms[i]); return r; },
    translation(x, y, z) { if (Array.isArray(x)) [x, y, z] = x; const m = m4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
    scaling(x, y, z) { if (Array.isArray(x)) [x, y, z] = x; else if (y === undefined) y = z = x; const m = m4.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
    rotationX(r) { const c = Math.cos(r), s = Math.sin(r), m = m4.identity(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    rotationY(r) { const c = Math.cos(r), s = Math.sin(r), m = m4.identity(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    rotationZ(r) { const c = Math.cos(r), s = Math.sin(r), m = m4.identity(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    rotationAxis(axis, r) {
      const [x, y, z] = v3.normalize(axis), c = Math.cos(r), s = Math.sin(r), t = 1 - c, m = m4.identity();
      m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
      m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
      m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
      return m;
    },
    // Position + Euler XYZ (radians, applied Z then Y then X i.e. R = Rx*Ry*Rz) + scale
    fromTRS(pos, rot, scl) {
      let m = m4.translation(pos || [0, 0, 0]);
      if (rot) m = m4.chain(m, m4.rotationX(rot[0]), m4.rotationY(rot[1]), m4.rotationZ(rot[2]));
      if (scl) m = m4.chain(m, m4.scaling(scl));
      return m;
    },
    perspective(fovy, aspect, near, far, out) {
      out = out || new Float32Array(16); out.fill(0);
      const f = 1 / Math.tan(fovy / 2);
      out[0] = f / aspect; out[5] = f; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = 2 * far * near / (near - far);
      return out;
    },
    ortho(l, r, b, t, n, f, out) {
      out = out || new Float32Array(16); out.fill(0);
      out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n);
      out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1;
      return out;
    },
    lookAt(eye, target, up, out) {
      out = out || new Float32Array(16);
      const z = v3.normalize(v3.sub(eye, target)), x = v3.normalize(v3.cross(up || [0, 1, 0], z)), y = v3.cross(z, x);
      out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
      out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
      out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
      out[12] = -v3.dot(x, eye); out[13] = -v3.dot(y, eye); out[14] = -v3.dot(z, eye); out[15] = 1;
      return out;
    },
    transpose(m) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[i * 4 + j] = m[j * 4 + i]; return o; },
    invert(m, out) {
      out = out || new Float32Array(16);
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
        a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null;
      det = 1 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    },
    mulPoint(m, p) { const x = p[0], y = p[1], z = p[2]; const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; },
    mulDir(m, d) { const x = d[0], y = d[1], z = d[2]; return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]; },
    // inverse-transpose of the upper 3x3, column-major Float32Array(9)
    normalMat3(m) {
      const inv = m4.invert(m); if (!inv) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      return new Float32Array([inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]]);
    },
  };

  // ------------------------------------------------------------------ GL helpers
  PG.glu = {
    // Compile+link with readable error output (source lines are printed with numbers on failure).
    program(gl, vsSrc, fsSrc, label) {
      const mk = (type, src) => {
        const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(sh);
          const numbered = src.split('\n').map((l, i) => (i + 1).toString().padStart(4) + ' ' + l).join('\n');
          console.error(`[shader:${label || '?'}] ${type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT'} compile error:\n${log}\n${numbered.length > 20000 ? numbered.slice(0, 20000) + '\n...' : numbered}`);
          throw new Error(`shader compile failed (${label}): ${log}`);
        }
        return sh;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(p); console.error(`[program:${label}] link error: ${log}`); throw new Error(`program link failed (${label}): ${log}`); }
      return p;
    },
    // Map of uniform name -> location (array uniforms are registered as 'name' and 'name[0]').
    uniforms(gl, prog) {
      const u = {}, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); const loc = gl.getUniformLocation(prog, info.name); u[info.name] = loc; if (info.name.endsWith('[0]')) u[info.name.slice(0, -3)] = loc; }
      return u;
    },
    // Full-screen triangle vertex shader (no attributes; use gl.drawArrays(gl.TRIANGLES,0,3) with any VAO bound). Outputs vUv.
    FULLSCREEN_VS: `#version 300 es
precision highp float;
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`,
    // Canvas-2D generated texture (for lettering/decals/procedural maps). draw(ctx2d, w, h). Returns WebGLTexture (RGBA8, mipmapped, linear, anisotropic if available).
    canvasTexture(gl, w, h, draw, opts) {
      opts = opts || {};
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); draw(ctx, w, h);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY === false ? 0 : 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      const an = gl.getExtension('EXT_texture_filter_anisotropic');
      if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    },
  };

  // ------------------------------------------------------------------ module registry
  // Car modules register a builder; app.js runs them sorted by `order` (ascending) with a shared ctx.
  //   PG.registerModule({ name:'wheels', order: 20, async build(ctx) { ... ctx.add({...}) ... } })
  PG.modules = [];
  PG.registerModule = def => { PG.modules.push(def); PG.modules.sort((a, b) => (a.order || 0) - (b.order || 0)); };

  // Shared, UI-driven state. Modules read it every frame (or subscribe through ctx.onUpdate).
  PG.state = PG.state || { drs: 0, headlights: 1, brake: 0, steer: 0, spin: 1 };

  PG.log = (...a) => { console.log('[PG]', ...a); };
  PG.status = s => { root.__status = s; };
})();
