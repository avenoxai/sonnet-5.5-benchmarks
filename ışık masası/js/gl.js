/* WebGL2 oluşturucu: HDR ışın birikimi, bloom, masa, cam ve sabun köpüğü */
(function () {
  'use strict';
  const LT = window.LT;
  const NB = 16; // kabarcık spektrum bandı sayısı
  const MAXB = 8;

  const FULL_VS = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUV = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

  const LINE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeg;
layout(location=2) in vec4 aCol;
uniform vec2 uRes;
out vec2 vP;
out vec3 vCol;
out float vLen;
out float vHW;
void main(){
  vec2 p0 = aSeg.xy, p1 = aSeg.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d/len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = aCol.w;
  float ext = hw*1.8;
  float along = mix(-ext, len+ext, aCorner.x);
  float across = aCorner.y*hw*1.8;
  vec2 pos = p0 + dir*along + nrm*across;
  vP = vec2(along, across);
  vCol = aCol.rgb;
  vLen = len;
  vHW = hw;
  gl_Position = vec4(pos.x/uRes.x*2.0-1.0, 1.0-pos.y/uRes.y*2.0, 0.0, 1.0);
}`;

  const LINE_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec3 vCol;
in float vLen;
in float vHW;
uniform float uGain;
out vec4 o;
void main(){
  float e = max(max(-vP.x, vP.x - vLen), 0.0);
  float r2 = (vP.y*vP.y + e*e)/(vHW*vHW);
  o = vec4(vCol*uGain*exp(-2.0*r2), 0.0);
}`;

  const ZERO_FS = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o = vec4(0.0); }`;

  const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main(){
  vec2 t = uTexel;
  vec3 a = texture(uTex, vUV + t*vec2(-2.0,-2.0)).rgb;
  vec3 b = texture(uTex, vUV + t*vec2( 0.0,-2.0)).rgb;
  vec3 c = texture(uTex, vUV + t*vec2( 2.0,-2.0)).rgb;
  vec3 d = texture(uTex, vUV + t*vec2(-1.0,-1.0)).rgb;
  vec3 e = texture(uTex, vUV + t*vec2( 1.0,-1.0)).rgb;
  vec3 f = texture(uTex, vUV + t*vec2(-2.0, 0.0)).rgb;
  vec3 g = texture(uTex, vUV).rgb;
  vec3 h = texture(uTex, vUV + t*vec2( 2.0, 0.0)).rgb;
  vec3 i = texture(uTex, vUV + t*vec2(-1.0, 1.0)).rgb;
  vec3 j = texture(uTex, vUV + t*vec2( 1.0, 1.0)).rgb;
  vec3 k = texture(uTex, vUV + t*vec2(-2.0, 2.0)).rgb;
  vec3 l = texture(uTex, vUV + t*vec2( 0.0, 2.0)).rgb;
  vec3 m = texture(uTex, vUV + t*vec2( 2.0, 2.0)).rgb;
  vec3 r = g*0.125 + (a+c+k+m)*0.03125 + (b+f+h+l)*0.0625 + (d+e+i+j)*0.125;
  o = vec4(r, 1.0);
}`;

  const UP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uW;
out vec4 o;
void main(){
  vec2 t = uTexel;
  vec3 s = texture(uTex, vUV + t*vec2(-1.0,-1.0)).rgb
         + texture(uTex, vUV + t*vec2( 0.0,-1.0)).rgb*2.0
         + texture(uTex, vUV + t*vec2( 1.0,-1.0)).rgb
         + texture(uTex, vUV + t*vec2(-1.0, 0.0)).rgb*2.0
         + texture(uTex, vUV).rgb*4.0
         + texture(uTex, vUV + t*vec2( 1.0, 0.0)).rgb*2.0
         + texture(uTex, vUV + t*vec2(-1.0, 1.0)).rgb
         + texture(uTex, vUV + t*vec2( 0.0, 1.0)).rgb*2.0
         + texture(uTex, vUV + t*vec2( 1.0, 1.0)).rgb;
  o = vec4(s*(uW/16.0), 1.0);
}`;

  const COMP_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uAccum;
uniform sampler2D uBloom;
uniform sampler2D uWide;
uniform sampler2D uGlass;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uGlow;
uniform int uNB;
uniform vec4 uB[${MAXB}];
uniform vec4 uC[${MAXB}];
uniform float uLam[${NB}];
uniform vec3 uSpec[${NB}];

float hash(vec2 p){
  p = fract(p*vec2(123.34, 456.21));
  p += dot(p, p+45.32);
  return fract(p.x*p.y);
}

// ---- masa: eloksallı, delikli optik masa ----
vec3 tableColor(vec2 P, vec3 wide){
  const float G = 38.0;
  vec2 q = mod(P, G) - 0.5*G;
  float dd = length(q);
  float hole = smoothstep(5.4, 4.4, dd);
  float rim = smoothstep(7.6, 5.4, dd) * (1.0 - hole);
  vec2 uv = P / uRes;
  float vg = 1.0 - 0.6*pow(length((uv-vec2(0.5,0.47))*vec2(1.0,1.15))*1.25, 2.0);
  vg = clamp(vg, 0.0, 1.0);
  float grain = hash(floor(P*0.75));
  vec3 base = vec3(0.0075, 0.0095, 0.0135) * (0.55 + 0.45*vg) * (0.86 + 0.28*grain);
  vec3 lit = wide;
  vec3 col = base;
  col += rim * (vec3(0.0075, 0.0095, 0.0135)*1.5*(0.4+0.6*vg) + lit*0.2);
  col *= 1.0 - hole*0.75;
  col += hole * lit * 0.04;
  col += lit * 0.05;
  // orta cetvel çizgileri: her 5 delikte bir hafif iz
  vec2 cell = floor(P / G);
  float ax = step(abs(mod(cell.x, 5.0)-0.0), 0.5) + step(abs(mod(cell.y, 5.0)-0.0), 0.5);
  col += rim * ax * 0.0035 * vec3(0.55,0.75,1.0);
  return col;
}

// ---- sabun filmi ----
float filmR(float lam, float cosi, float d){
  const float n = 1.33;
  float s2 = (1.0 - cosi*cosi)/(n*n);
  float cost = sqrt(max(1.0 - s2, 0.0));
  float rs = (cosi - n*cost)/(cosi + n*cost);
  float rp = (n*cosi - cost)/(n*cosi + cost);
  float cd = cos(12.5663706*n*d*cost/lam);
  float a = rs*rs, b = rp*rp;
  float Rs = 2.0*a*(1.0-cd)/(1.0 + a*a - 2.0*a*cd);
  float Rp = 2.0*b*(1.0-cd)/(1.0 + b*b - 2.0*b*cd);
  return 0.5*(Rs+Rp);
}
float filmThick(float u, float v, float t, float thick, float ph){
  float d = 300.0*thick + 210.0*v
    + 105.0*sin(2.3*u + 1.6*sin(1.9*v + 0.31*t + ph) + 0.23*t + ph*1.3)
    +  85.0*sin(3.7*v - 1.3*sin(2.6*u - 0.27*t + ph*0.7) - 0.19*t + 1.7)
    +  40.0*sin(5.1*(u+v) + 2.0*sin(3.1*u - 2.3*v + 0.4*t));
  return max(d, 45.0);
}

vec3 bubbles(vec2 P, vec3 col){
  for (int i = 0; i < ${MAXB}; i++){
    if (i >= uNB) break;
    vec4 b = uB[i];
    vec4 c = uC[i];
    float pop = c.w;
    float grow = 1.0 + 0.35*pop;
    vec2 q = P - b.xy;
    if (dot(q,q) > (max(b.z,b.w)*grow*1.12)*(max(b.z,b.w)*grow*1.12)) continue;
    float cr = cos(c.x), sr = sin(c.x);
    vec2 l = vec2(q.x*cr + q.y*sr, -q.x*sr + q.y*cr) / (b.zw*grow);
    float r = length(l);
    float px = 1.4/(min(b.z,b.w)*grow);
    float inside = 1.0 - smoothstep(1.0 - px, 1.0 + px, r);
    if (inside <= 0.0 && r > 1.05) continue;
    float rr = min(r, 1.0);
    float cosT = sqrt(max(1.0 - rr*rr, 0.0));
    float d = filmThick(l.x, l.y, uTime, c.y, c.z);
    vec3 film = vec3(0.0);
    for (int k = 0; k < ${NB}; k++){
      film += filmR(uLam[k], max(cosT, 0.04), d) * uSpec[k];
    }
    film /= float(${NB});
    // ortam: yumuşak kutu ışığı; sol üstten güçlü, alttan zayıf
    vec2 dir = r > 0.001 ? l/r : vec2(0.0);
    float env = 0.55 + 0.75*pow(max(dot(dir, normalize(vec2(-0.6,-0.8))), 0.0), 2.0)
                     + 0.35*pow(max(dot(dir, normalize(vec2(0.8,0.6))), 0.0), 2.0);
    float shellW = 0.05 + 0.95*pow(rr, 3.0);
    vec3 refl = film * env * shellW * 5.5;
    // kenar halkası
    float rim = exp(-pow((rr-0.985)/0.02, 2.0)) * 0.5;
    refl += film * rim * 6.0 + vec3(0.55,0.72,0.9)*rim*0.35;
    // pencere yansımaları
    float ang1 = dot(dir, normalize(vec2(-0.62,-0.78)));
    float hl1 = exp(-pow((rr-0.80)/0.05, 2.0)) * smoothstep(0.80, 0.97, ang1);
    float ang2 = dot(dir, normalize(vec2(0.7,0.7)));
    float hl2 = exp(-pow((rr-0.86)/0.035, 2.0)) * smoothstep(0.86, 0.98, ang2);
    refl += vec3(0.9,0.96,1.0)*(hl1*0.95 + hl2*0.35);
    float a = inside*(1.0-pop)*(1.0-pop);
    // patlama halkası
    float ring = exp(-pow((r-1.0)/0.05, 2.0)) * pop * (1.0-pop);
    col += refl * a + vec3(0.8,0.9,1.0)*ring*0.6;
  }
  return col;
}

void main(){
  vec2 P = vec2(vUV.x, 1.0 - vUV.y) * uRes;
  vec3 wide = texture(uWide, vUV).rgb * uExposure * 0.3;
  vec3 col = tableColor(P, wide);

  vec4 g = texture(uGlass, vec2(vUV.x, 1.0 - vUV.y));
  if (g.a > 0.002){
    vec3 gc = pow(g.rgb / g.a, vec3(2.2));
    col = mix(col, gc, g.a);
  }
  col = bubbles(P, col);

  vec3 acc = texture(uAccum, vUV).rgb;
  vec3 blm = texture(uBloom, vUV).rgb;
  vec3 light = (acc + blm*uGlow*0.16) * uExposure;
  vec3 base = min(col, vec3(0.985));
  vec3 disp = 1.0 - (1.0 - base) * exp(-light);
  disp = pow(disp, vec3(1.0/2.2));
  disp += (hash(P + uTime) - 0.5) / 255.0;
  outColor = vec4(disp, 1.0);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src.trim());
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const cache = {};
    return {
      p,
      u(name) {
        if (!(name in cache)) cache[name] = gl.getUniformLocation(p, name);
        return cache[name];
      },
    };
  }

  LT.Renderer = function (canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 yok');
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('Float render hedefi yok');
    gl.getExtension('OES_texture_float_linear');
    this.gl = gl;

    const pLine = program(gl, LINE_VS, LINE_FS);
    const pZero = program(gl, FULL_VS, ZERO_FS);
    const pDown = program(gl, FULL_VS, DOWN_FS);
    const pUp = program(gl, FULL_VS, UP_FS);
    const pComp = program(gl, FULL_VS, COMP_FS);

    // boş VAO (tam ekran üçgeni)
    const vaoFull = gl.createVertexArray();

    // çizgi VAO
    const vaoLine = gl.createVertexArray();
    gl.bindVertexArray(vaoLine);
    const cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, LT.instances.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    const band = LT.bandSpectrum(NB);

    function makeTarget(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h };
    }
    function freeTarget(t) {
      if (!t) return;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }

    let accum = null;
    let levels = [];
    let glassTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glassTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.W = 1;
    this.H = 1;
    this.scale = 1;

    this.resize = (W, H, scale) => {
      this.W = W;
      this.H = H;
      this.scale = scale;
      const pw = Math.max(1, Math.round(W * scale));
      const ph = Math.max(1, Math.round(H * scale));
      canvas.width = pw;
      canvas.height = ph;
      freeTarget(accum);
      for (const l of levels) freeTarget(l);
      accum = makeTarget(pw, ph);
      levels = [];
      let w = pw;
      let h = ph;
      for (let i = 0; i < 6; i++) {
        w = Math.max(2, Math.ceil(w / 2));
        h = Math.max(2, Math.ceil(h / 2));
        levels.push(makeTarget(w, h));
      }
      this.pw = pw;
      this.ph = ph;
    };

    this.uploadGlass = (cv) => {
      gl.bindTexture(gl.TEXTURE_2D, glassTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    };

    // ışın çizgilerini HDR birikim tamponuna, üstel ortalamayla ekler
    this.accumulate = (count, alpha, reset) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
      gl.viewport(0, 0, accum.w, accum.h);
      gl.disable(gl.DEPTH_TEST);
      if (reset) {
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
        gl.blendColor(0, 0, 0, 1 - alpha);
        gl.useProgram(pZero.p);
        gl.bindVertexArray(vaoFull);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (count > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pLine.p);
        gl.uniform2f(pLine.u('uRes'), this.W, this.H);
        gl.uniform1f(pLine.u('uGain'), alpha);
        gl.bindVertexArray(vaoLine);
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, LT.instances.subarray(0, count * 8));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      gl.disable(gl.BLEND);
    };

    this.bloom = () => {
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vaoFull);
      gl.useProgram(pDown.p);
      let src = accum;
      for (const l of levels) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, l.fbo);
        gl.viewport(0, 0, l.w, l.h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(pDown.u('uTex'), 0);
        gl.uniform2f(pDown.u('uTexel'), 1 / src.w, 1 / src.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = l;
      }
      gl.useProgram(pUp.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = levels.length - 1; i >= 1; i--) {
        const s = levels[i];
        const d = levels[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
        gl.viewport(0, 0, d.w, d.h);
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform1i(pUp.u('uTex'), 0);
        gl.uniform2f(pUp.u('uTexel'), 1 / s.w, 1 / s.h);
        gl.uniform1f(pUp.u('uW'), 0.6);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    };

    const bufB = new Float32Array(MAXB * 4);
    const bufC = new Float32Array(MAXB * 4);

    this.composite = (P) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.pw, this.ph);
      gl.disable(gl.BLEND);
      gl.useProgram(pComp.p);
      gl.bindVertexArray(vaoFull);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accum.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, levels[0].tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, levels[2].tex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, glassTex);
      gl.uniform1i(pComp.u('uAccum'), 0);
      gl.uniform1i(pComp.u('uBloom'), 1);
      gl.uniform1i(pComp.u('uWide'), 2);
      gl.uniform1i(pComp.u('uGlass'), 3);
      gl.uniform2f(pComp.u('uRes'), this.W, this.H);
      gl.uniform1f(pComp.u('uTime'), P.time);
      gl.uniform1f(pComp.u('uExposure'), P.exposure);
      gl.uniform1f(pComp.u('uGlow'), P.glow);
      let nb = 0;
      for (const it of P.bubbles) {
        if (nb >= MAXB) break;
        const g = it.geo;
        bufB.set([g.cx, g.cy, g.ax, g.ay], nb * 4);
        bufC.set([g.rot, it.thick, it.phase, it.popT], nb * 4);
        nb++;
      }
      gl.uniform1i(pComp.u('uNB'), nb);
      gl.uniform4fv(pComp.u('uB'), bufB);
      gl.uniform4fv(pComp.u('uC'), bufC);
      gl.uniform1fv(pComp.u('uLam'), band.lam);
      gl.uniform3fv(pComp.u('uSpec'), band.rgb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  };
})();
