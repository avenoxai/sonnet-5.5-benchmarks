// Limon.Brain — modelin beynini ham WebGL2 ile 3 boyutlu gösterir (SPEC §4.4). Kütüphane yok, harici dosya yok.
//
// DÜRÜSTLÜK İLKESİ: her nokta gerçek bir model birimi, her çizgi gerçek bir ağırlık, her parlama gerçek bir aktivasyon.
//
// NÖRONLAR (hepsi gerçek birim; ön→arka eksen = x, okuma solda / konuşma sağda)
//   * girdi harfleri (V) ........ sol "OKUMA" panelinde, çıktı harfleri (V) sağ "KONUŞMA" panelinde
//   * residual akış boyutları ... (L+1)*D akış + L*D "dikkat sonrası" (hMid) + D son LayerNorm çıkışı (xFinal)
//   * MLP gizli nöronları ....... her katmanda FF'nin ADİL ALT KÜMESİ: en çok min(FF, 320) tane, indeks aralığı EŞİT
//                                 (j -> floor((j+.5)*FF/n)); seçim ağırlığa/aktivasyona bakmaz, yani yanlı değil
//   * attention head'leri (H) ... katman başına H büyük küre; parlaklığı = o head'in ODAKLANMASI (1 - normalize entropi)
//   Sabit boyutlu akış boyutu i, bütün akış dilimlerinde aynı (y,z) konumundadır -> residual "kablolar" düz uzanır.
// SİNAPSLAR (hepsi gerçek ağırlık; her matristen en güçlü |w| alt kümesi, ~11K çizgi bütçesi)
//   emb: tok[v][d] (harf -> akış0)      qkv: akış boyutu i -> head h, kuvvet = Q|K|V bloğunun RMS'i, renk = V bloğu toplamının işareti
//   proj: head h -> hMid boyutu j, kuvvet = h'nin DH satırının RMS'i, renk = toplamın işareti
//   fc1: hMid i -> MLP j (w[i][j])      fc2: MLP j -> xOut k (w[j][k])       out: xFinal d -> çıktı harfi v (tok[v][d], tied)
//   skip: residual toplamları (özdeşlik, kuvvet 1; sabit soluk çizgiler). Renk: + limon/lime, - camgöbeği/mor.
//   Parlaklık = log ölçekli |w| / (doğumdaki RMS): doğumda hepsi sönük, öğrenildikçe büyüyenler parlar.
// AKTİVASYON: nöron başına EMA-normalize |a|, tanh sıkıştırma. Dalga zamanı yapaydır (görsel akış), değerler gerçektir:
//   bir token'ın dalgası dilimden dilime 70 ms aralıkla yayılır; darbe şiddeti = aktivasyon x kuvvet.
// KAMERA: sürükle = yörünge, tekerlek/pinch = yakınlaş, sağ tık | shift+sürükle | iki parmak = kaydır, çift tık = sıfırla.
//
// API notu: resize(cssW, cssH, dpr) yalnızca canvas.width/height'i ayarlar (CSS boyutuna dokunmaz).
//   setOptions ayrıca { insets:{l,r,t,b} } (CSS px, panellerin kapladığı yerler), { quality:'auto'|'low'|'medium'|'high' }, { gpuTiming } alır.
//   stats() -> sayılar ve süreler.  Brain kendi rAF'ını açmaz.
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});

  // ------------------------------------------------------------------ küçük yardımcılar
  const PI = Math.PI, TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  function mulberry(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function h3(ix, iy, iz) { let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const a = h3(ix, iy, iz), b = h3(ix + 1, iy, iz), c = h3(ix, iy + 1, iz), d = h3(ix + 1, iy + 1, iz);
    const e = h3(ix, iy, iz + 1), f = h3(ix + 1, iy, iz + 1), g = h3(ix, iy + 1, iz + 1), h = h3(ix + 1, iy + 1, iz + 1);
    const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (h - g) * fx;
    const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
    return y1 + (y2 - y1) * fz;
  }
  // kıvrım deseni: 0..1, 1'e yakın = oluk (sulkus) çizgisi
  function foldPattern(x, y, z) {
    let s = 0, amp = 0.62, f = 3.1, norm = 0;
    for (let o = 0; o < 3; o++) { const n = vnoise(x * f + 7.3 * o, y * f - 3.1 * o, z * f + 1.7 * o); s += amp * (1 - Math.abs(2 * n - 1)); norm += amp; amp *= 0.5; f *= 2.13; }
    return s / norm;
  }

  function mat4Perspective(o, fovy, aspect, near, far, shx, shy) {
    const f = 1 / Math.tan(fovy / 2); o.fill(0);
    o[0] = f / aspect; o[5] = f; o[8] = shx || 0; o[9] = shy || 0;
    o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far);
  }
  function mat4LookAt(o, ex, ey, ez, tx, ty, tz) {
    let zx = ex - tx, zy = ey - ty, zz = ez - tz; let l = 1 / Math.hypot(zx, zy, zz); zx *= l; zy *= l; zz *= l;
    let xx = zz, xy = 0, xz = -zx; l = 1 / (Math.hypot(xx, xz) || 1); xx *= l; xz *= l; // up = (0,1,0)
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0; o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez); o[13] = -(yx * ex + yy * ey + yz * ez); o[14] = -(zx * ex + zy * ey + zz * ez); o[15] = 1;
  }
  function mat4Mul(o, a, b) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }

  // ------------------------------------------------------------------ sabitler
  const NK = { IN: 0, STREAM: 1, HEAD: 2, MLP: 3, FINAL: 4, OUT: 5 };
  const GT = { EMB: 0, QKV: 1, PROJ: 2, FC1: 3, FC2: 4, OUT: 5, SKIP: 6 };
  const ESTRIDE = 20;            // bir sinaps örneği = 5 vec4
  const PSTRIDE = 12;            // bir darbe = 3 vec4
  const PULSE_POOL = 6144, ARC_POOL = 900, WAVE_POOL = 36, ARC_SEG = 28, EDGE_SEG = 8, SLAB_DELAY = 0.045;
  const HEAD_COLS = [[0.62, 1.0, 0.25], [0.10, 0.90, 1.0], [0.72, 0.42, 1.0], [1.0, 0.62, 0.20], [1.0, 0.42, 0.72], [0.30, 1.0, 0.72], [1.0, 0.92, 0.25], [0.38, 0.58, 1.0]];
  const VOWELS = 'aeıioöuüAEIİOÖUÜ';
  const BRAIN_HALF = 1.1;

  // ------------------------------------------------------------------ GLSL
  const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
  const COMMON = `
uniform mat4 uVP;
uniform float uTime, uPxScale, uDist, uWarm, uJit, uBirth, uWaveX, uWaveA, uRtScale, uAxial;
uniform vec3 uOrigin;
uniform vec2 uRes;
float hash11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float fogf(float w){ return mix(1.0,0.30,smoothstep(uDist-0.9,uDist+2.0,w)); }
vec3 grade(vec3 c){ float l=dot(c,vec3(.299,.587,.114)); vec3 cold=vec3(.58,.76,1.0)*l*.95; return mix(cold,c,uWarm); }
float birthMask(vec3 p){ float d=length(p-uOrigin)/1.9; return smoothstep(0.0,0.14,uBirth-d*.8); }
// beyin ekseni boyunca bakınca bütün katmanlar aynı piksellere yığılır; toplamsal karışımda patlamasın diye görüntü kazancı düşer
float axialGain(){ return mix(1.0,.30,smoothstep(.42,.96,uAxial)); }
float waveAt(float x){ float d=(x-uWaveX)/0.24; return exp(-d*d)*uWaveA; }
`;
  const BEZIER = `
vec3 ctrlPt(vec3 a, vec3 b, float seed, float kind){
  vec3 d=b-a; float L=max(length(d),1e-4); vec3 dir=d/L;
  vec3 up=abs(dir.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.);
  vec3 n1=normalize(cross(dir,up)); vec3 n2=cross(dir,n1);
  float ang=seed*6.2831853;
  vec3 bend=(n1*cos(ang)+n2*sin(ang))*L*(0.09+0.16*fract(seed*13.7));
  return (a+b)*.5+bend*(1.0-kind);
}
vec3 bez(vec3 a, vec3 c, vec3 b, float t){ float s=1.-t; return s*s*a+2.*s*t*c+t*t*b; }
`;
  const FS_FULL_VS = HEAD + `out vec2 vUV; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUV=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;

  const SH = {};
  SH.dustVS = HEAD + COMMON + `
layout(location=0) in vec4 aP;
out vec3 vC;
void main(){
  float ph=aP.w; bool dust=ph>0.5; float pr=fract(ph*91.7);
  vec3 p=aP.xyz;
  if(dust) p+=0.06*vec3(sin(uTime*.13+ph*20.),sin(uTime*.10+ph*31.),cos(uTime*.12+ph*17.));
  vec4 c=uVP*vec4(p,1.); gl_Position=c;
  float tw=.55+.45*sin(uTime*(.6+pr*1.7)+ph*40.);
  float size=dust?(0.012+0.02*pr):(0.03+0.05*pr);
  gl_PointSize=clamp(size*uPxScale/c.w,1.2,7.0);
  vec3 col=mix(vec3(.45,.65,1.),vec3(1.,.95,.6),fract(ph*7.31));
  float fog=dust?fogf(c.w):1.0;
  float br=dust?(.12+.30*tw):(.22+.5*tw);
  vC=grade(col)*br*fog;
}`;
  SH.dustFS = HEAD + `in vec3 vC; out vec4 o; void main(){ vec2 q=gl_PointCoord*2.-1.; float d=dot(q,q); if(d>1.)discard; o=vec4(vC*exp(-d*3.5),1.); }`;

  SH.shellVS = HEAD + COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in float aFold;
out vec3 vPos; out vec3 vNor; out float vFold; out float vW;
void main(){ vec4 c=uVP*vec4(aPos,1.); gl_Position=c; vPos=aPos; vNor=aNor; vFold=aFold; vW=c.w; }`;
  SH.shellFS = HEAD + COMMON + `
in vec3 vPos; in vec3 vNor; in float vFold; in float vW;
uniform vec3 uEye; uniform float uSlab[32]; uniform float uNSlab; uniform float uPart; uniform float uShellA;
out vec4 o;
void main(){
  vec3 N=normalize(vNor); vec3 V=normalize(uEye-vPos);
  float ndv=abs(dot(N,V)); float fr=pow(1.-ndv,2.3);
  float sul=smoothstep(.70,.92,vFold);
  float bm=smoothstep(0.0,0.2,uBirth-length(vPos-uOrigin)/1.9*.8+0.15);
  float sp=clamp((vPos.x+1.1)/2.2,0.,1.)*(uNSlab-1.);
  int i0=int(floor(sp)); int i1=min(i0+1,int(uNSlab)-1); float sg=mix(uSlab[i0],uSlab[i1],sp-float(i0));
  vec3 rim=mix(vec3(.15,.55,1.),mix(vec3(.30,.95,.85),vec3(1.,.90,.30),.45),uWarm);
  vec3 body=mix(vec3(.05,.12,.28),vec3(.03,.22,.26),uWarm);
  vec3 col=body*(.025+.14*fr)+rim*fr*fr*.20*uShellA+rim*sul*(.015+.10*fr)*uShellA;
  col+=mix(vec3(.5,.9,.7),vec3(1.,.9,.35),.5)*sg*(.02+.25*fr)*(1.-uPart*.8);
  col+=vec3(1.,.95,.6)*waveAt(vPos.x)*(.05+.30*fr);
  col*=fogf(vW)*bm*mix(1.,.55,uPart);
  o=vec4(col,1.);
}`;

  SH.neuronVS = HEAD + COMMON + `
layout(location=0) in vec4 aP; layout(location=1) in vec2 aK;
uniform sampler2D uGlow; uniform float uGlowW; uniform vec3 uHead[8];
out vec4 vC;
void main(){
  int id=gl_VertexID; int gw=int(uGlowW);
  vec4 g=texelFetch(uGlow,ivec2(id%gw,id/gw),0);
  int kind=int(aK.x+.5);
  float bm=birthMask(aP.xyz);
  float tick=floor(uTime*12.);
  float spur=step(.90,hash11(float(id)*1.37+tick))*uJit;
  float pp=g.x+spur*.9, nn=g.y;
  float act=min(pp+nn,2.0);
  vec3 cp=vec3(1.,.90,.30), cn=vec3(.12,.85,1.);
  float idle=.07, gain=.85, sz=1.;
  if(kind==0||kind==5){ cp=vec3(1.,.95,.62); cn=cp; idle=.26; gain=1.2; }
  else if(kind==2){ vec3 hc=uHead[int(aK.y+.5)&7]; cp=hc; cn=hc; idle=.45; gain=1.5; }
  else if(kind==3){ cp=vec3(.62,1.,.30); cn=vec3(.66,.36,1.); idle=.05; gain=.95; }
  else if(kind==4){ cp=vec3(1.,.97,.75); cn=vec3(.35,.9,1.); idle=.10; gain=.95; }
  vec3 lit=(cp*pp+cn*nn)/max(pp+nn,1e-3);
  vec3 idleC=mix(cp,cn,.15)*.75;
  vec3 col=(idleC*idle+lit*act*gain)*bm*mix(1.,axialGain(),.85);
  if(kind==0) col*=1.+act*.8;
  vec4 c=uVP*vec4(aP.xyz,1.); gl_Position=c;
  float size=aP.w*.72*(1.+1.0*act)*(.30+.70*bm);
  gl_PointSize=clamp(size*uPxScale/c.w,1.6,110.);
  vC=vec4(grade(col)*fogf(c.w),1.);
}`;
  SH.neuronFS = HEAD + `in vec4 vC; out vec4 o;
void main(){ vec2 q=gl_PointCoord*2.-1.; float d=dot(q,q); if(d>1.)discard; float a=exp(-d*4.2); float core=exp(-d*20.);
  o=vec4(vC.rgb*(a*.5+core*.7),1.); }`;

  SH.edgeVS = HEAD + COMMON + BEZIER + `
layout(location=0) in vec2 aV;
layout(location=1) in vec4 A0; layout(location=2) in vec4 A1; layout(location=3) in vec4 A2; layout(location=4) in vec4 A3; layout(location=5) in vec4 A4;
uniform sampler2D uGlow; uniform float uGlowW;
out vec3 vCol; out float vI; out float vSide;
vec2 gl2(float idx){ int id=int(idx+.5); int gw=int(uGlowW); return texelFetch(uGlow,ivec2(id%gw,id/gw),0).xy; }
void main(){
  vec3 a=A0.xyz, b=A1.xyz; float seed=A0.w, kind=A1.w;
  vec3 c=ctrlPt(a,b,seed,kind);
  float tick=floor(uTime*10.);
  vec3 jv=vec3(hash11(seed*91.+tick),hash11(seed*57.+tick*1.7),hash11(seed*33.+tick*2.3))-.5;
  c+=jv*uJit*.14; a+=jv.yzx*uJit*.02; b+=jv.zxy*uJit*.02;
  float t=aV.x; float t2=t<.97?t+.03:t-.03;
  vec3 P=bez(a,c,b,t), P2=bez(a,c,b,t2);
  vec4 c0=uVP*vec4(P,1.), c1=uVP*vec4(P2,1.);
  vec2 s0=c0.xy/c0.w*uRes*.5, s1=c1.xy/c1.w*uRes*.5;
  vec2 dir=s1-s0; float dl=length(dir); dir=dl>1e-4?dir/dl:vec2(1.,0.); if(t2<t) dir=-dir;
  vec2 nrm=vec2(-dir.y,dir.x);
  float k=smooth01_(clamp((uTime-A3.x)/.8,0.,1.));
  float w=mix(A2.z,A2.w,k); float bw=abs(w);
  float alive=smoothstep(0.,.9,uTime-A3.y)*(1.-smoothstep(0.,.9,uTime-A3.z));
  vec2 gs=gl2(A2.x), gd=gl2(A2.y);
  float act=min(mix(gs.x+gs.y,gd.x+gd.y,t*t),1.6);
  float pl=A3.w*exp(-max(uTime-A4.x,0.)/.9);
  float dA=length(A0.xyz-uOrigin)/1.9; float len=length(b-a);
  float grow=clamp((uBirth-(dA*.8+.02))/(.10+len*.30),0.,1.);
  float head=grow>=.999?1.:1.-smoothstep(grow-.15,grow+.0001,t); if(grow<=0.) head=0.;
  vec4 ca=uVP*vec4(a,1.), cb=uVP*vec4(b,1.);
  float chord=length(ca.xy/ca.w-cb.xy/cb.w)*uRes.y*.5;
  float fs=clamp(chord/(.09*uRes.y),.22,1.); fs=sqrt(fs); // uçtan bakışta üst üste binen çizgiler sönsün (yoğunluk dengesi)
  float base=.007+.20*bw*bw*bw*bw;
  float lit=act*act*(.006+.085*bw*bw);
  float wv=waveAt(P.x)*.8*(.25+bw);
  float I=(alive*head*(base+lit)*fs+alive*head*(pl*1.6+wv)*(.35+.65*fs))*fogf(c0.w)*axialGain();
  float wpx=(.75+1.5*bw+2.4*pl+1.1*act*bw)*uRtScale;
  vec3 col;
  if(kind>.5) col=vec3(.30,.78,.95);
  else if(w>=0.) col=mix(vec3(1.,.93,.22),vec3(.60,1.,.25),fract(seed*3.3));
  else col=mix(vec3(.05,.82,1.),vec3(.62,.35,1.),fract(seed*5.1));
  col=mix(col,vec3(1.,.97,.78)*1.5,clamp(pl,0.,1.)*.85);
  vCol=grade(col); vI=I; vSide=aV.y;
  gl_Position=c0+vec4(nrm*aV.y*wpx*.5/(uRes*.5)*c0.w,0.,0.);
}`.replace('void main(){', 'float smooth01_(float t){ return t*t*(3.-2.*t); }\nvoid main(){');
  SH.ribbonFS = HEAD + `in vec3 vCol; in float vI; in float vSide; out vec4 o;
void main(){ float e=1.-abs(vSide); float a=smoothstep(0.,.75,e); o=vec4(vCol*vI*a,1.); }`;

  SH.pulseVS = HEAD + COMMON + BEZIER + `
layout(location=0) in float aTrail;
layout(location=1) in vec4 P0; layout(location=2) in vec4 P1; layout(location=3) in vec4 P2;
out vec4 vC;
void main(){
  vec3 a=P0.xyz, b=P1.xyz; float seed=P0.w; float launch=P1.w; float dur=P2.x; float inten=P2.y; float sgn=P2.z; float kind=P2.w;
  vec3 c=ctrlPt(a,b,seed,kind);
  float age=uTime-launch-aTrail*.035; float u=age/dur;
  if(u<0.||u>1.){ gl_Position=vec4(2.,2.,2.,1.); gl_PointSize=0.; vC=vec4(0.); return; }
  vec3 P=bez(a,c,b,u); vec4 cc=uVP*vec4(P,1.); gl_Position=cc;
  float env=smoothstep(0.,.08,u)*(1.-smoothstep(.85,1.,u));
  float sz=mix(.022,.009,aTrail/3.)*(.6+inten);
  gl_PointSize=clamp(sz*uPxScale/cc.w,1.5,40.);
  vec3 col=sgn>=0.?vec3(1.,.95,.45):vec3(.35,.9,1.);
  if(kind>.5) col=vec3(.6,.9,1.);
  col=mix(col,vec3(1.),.35*(1.-aTrail/3.));
  vC=vec4(grade(col)*inten*env*(1.-aTrail*.22)*fogf(cc.w)*axialGain(),1.);
}`;

  SH.spriteVS = HEAD + COMMON + `
layout(location=0) in vec4 aP; layout(location=1) in vec4 aC;
out vec4 vC;
void main(){ vec4 c=uVP*vec4(aP.xyz,1.); gl_Position=c; gl_PointSize=clamp(aP.w*uPxScale/c.w,1.,120.); vC=vec4(grade(aC.rgb)*aC.a*fogf(c.w),1.); }`;
  SH.spriteFS = HEAD + `in vec4 vC; out vec4 o; void main(){ vec2 q=gl_PointCoord*2.-1.; float d=dot(q,q); if(d>1.)discard; o=vec4(vC.rgb*(exp(-d*4.)*.7+exp(-d*24.)*.9),1.); }`;

  SH.arcVS = HEAD + COMMON + `
layout(location=0) in vec2 aV;
layout(location=1) in vec4 B0; layout(location=2) in vec4 B1;
uniform float uCurPos, uSpacing, uStripX, uStripY; uniform vec3 uHead[8];
out vec3 vCol; out float vI; out float vSide;
float xf(float p){ return uStripX-(uCurPos-p)*uSpacing; }
void main(){
  float layer=B1.x; float hd=B1.y; float z=0.035*layer;
  vec3 a=vec3(xf(B0.x),uStripY,z), b=vec3(xf(B0.y),uStripY,z);
  float span=abs(a.x-b.x); float hgt=min(.34,.04+.16*sqrt(span))*(1.+.10*layer);
  vec3 c=vec3((a.x+b.x)*.5,uStripY-hgt*2.,z);
  float t=aV.x; float t2=t<.97?t+.03:t-.03;
  float s=1.-t; vec3 P=s*s*a+2.*s*t*c+t*t*b; float s2=1.-t2; vec3 P2=s2*s2*a+2.*s2*t2*c+t2*t2*b;
  vec4 c0=uVP*vec4(P,1.), c1=uVP*vec4(P2,1.);
  vec2 s0=c0.xy/c0.w*uRes*.5, s1=c1.xy/c1.w*uRes*.5;
  vec2 dir=s1-s0; float dl=length(dir); dir=dl>1e-4?dir/dl:vec2(1.,0.); if(t2<t) dir=-dir;
  vec2 nrm=vec2(-dir.y,dir.x);
  float age=uTime-B0.w; float wgt=B0.z;
  float env=smoothstep(0.,.05,age)*exp(-max(age,0.)/.60);
  float I=pow(wgt,.7)*env*1.6*fogf(c0.w)*smoothstep(0.,.08,t)*smoothstep(0.,.08,1.-t)*.7+pow(wgt,.7)*env*.4;
  float wpx=(.9+3.2*wgt)*uRtScale;
  vCol=grade(mix(uHead[int(hd+.5)&7],vec3(1.),.25)); vI=I; vSide=aV.y;
  gl_Position=c0+vec4(nrm*aV.y*wpx*.5/(uRes*.5)*c0.w,0.,0.);
}`;

  SH.labelVS = HEAD + `
layout(location=0) in vec4 L0; layout(location=1) in vec4 L1; layout(location=2) in vec4 L2; layout(location=3) in vec4 L3;
uniform mat4 uVP; uniform vec2 uCanvas; uniform float uDist, uDpr;
out vec2 vUV; out vec4 vCol;
void main(){
  vec2 cor=vec2(float(gl_VertexID&1),float(gl_VertexID>>1));
  vec4 c=uVP*vec4(L0.xyz,1.);
  float sc=L3.w>.5?clamp(pow(uDist/max(c.w,.3),.5),.72,1.6):1.;
  vec2 px=((cor-.5)*L2.xy*sc+L2.zw)*uDpr;
  gl_Position=c+vec4(px/(uCanvas*.5)*c.w,0.,0.);
  vUV=L1.xy+vec2(cor.x,1.-cor.y)*L1.zw;
  float fog=mix(1.,.35,smoothstep(uDist-.8,uDist+1.8,c.w));
  vCol=vec4(L3.rgb,L0.w*fog*step(.05,c.w));
}`;
  SH.labelFS = HEAD + `in vec2 vUV; in vec4 vCol; uniform sampler2D uAtlas; out vec4 o;
void main(){ float a=texture(uAtlas,vUV).a*vCol.a; o=vec4(vCol.rgb*a,a); }`;

  SH.downFS = HEAD + `in vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThresh; out vec4 o;
void main(){
  vec3 c=texture(uTex,vUV+uTexel*vec2(-.5,-.5)).rgb+texture(uTex,vUV+uTexel*vec2(.5,-.5)).rgb+texture(uTex,vUV+uTexel*vec2(-.5,.5)).rgb+texture(uTex,vUV+uTexel*vec2(.5,.5)).rgb;
  c*=.25;
  if(uThresh>0.){ float l=max(c.r,max(c.g,c.b)); c*=max(l-uThresh,0.)/max(l,1e-4); }
  o=vec4(c,1.);
}`;
  SH.blurFS = HEAD + `in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec3 c=texture(uTex,vUV).rgb*.2270270270;
  c+=(texture(uTex,vUV+uDir*1.3846153846).rgb+texture(uTex,vUV-uDir*1.3846153846).rgb)*.3162162162;
  c+=(texture(uTex,vUV+uDir*3.2307692308).rgb+texture(uTex,vUV-uDir*3.2307692308).rgb)*.0702702703;
  o=vec4(c,1.);
}`;
  SH.compFS = HEAD + `in vec2 vUV; uniform sampler2D uScene,uB0,uB1,uB2; uniform vec3 uBW; uniform vec2 uCanvas; uniform float uTime,uJit,uWarm,uBloom,uExposure,uPulse; out vec4 o;
float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 uv=vUV;
  float band=floor(uv.y*64.); float tp=hash21(vec2(band,floor(uTime*15.)));
  uv.x+=(tp>.988?(hash21(vec2(band*3.1,uTime))-.5)*.03:0.)*uJit*uJit;
  vec2 ca=(uv-.5)*(.0008+.0035*uJit);
  vec3 sc=vec3(texture(uScene,uv+ca).r,texture(uScene,uv).g,texture(uScene,uv-ca).b);
  vec3 bl=texture(uB0,uv).rgb*uBW.x+texture(uB1,uv).rgb*uBW.y+texture(uB2,uv).rgb*uBW.z;
  vec3 col=sc+bl*uBloom;
  vec2 q=vUV-.5; float r=length(q*vec2(1.25,1.));
  vec3 bg=mix(vec3(.0045,.0110,.0260),vec3(.0008,.0016,.0040),smoothstep(0.,.9,r));
  bg=mix(bg,bg.bgr*vec3(1.,1.,1.4),uJit*.25);
  col+=bg;
  col*=uExposure;
  col=1.-exp(-col*1.55);
  col=pow(clamp(col,0.,1.),vec3(1./1.6));
  col*=1.-.42*smoothstep(.45,1.0,r*1.15);
  col+=(hash21(gl_FragCoord.xy+fract(uTime)*97.)-.5)*(.010+.05*uJit);
  o=vec4(col,1.);
}`;

  // ------------------------------------------------------------------ geometri yardımcıları
  // Bir kesitin (x konumunda) yarım küre eliptik kesiti: rho=1 kabuk, rho<1 içeride.
  function crossPos(out, o, x, hemi, phi, rho) {
    const u = clamp(x / BRAIN_HALF, -1, 1);
    const base = Math.pow(Math.max(0, 1 - u * u), 0.42);
    const ry = 0.56 * base * (1 + 0.10 * u), rz = 0.43 * base;
    const yc = 0.03 + 0.03 * u, zc = 0.035 + rz;
    const cs = Math.cos(phi); let sn = Math.sin(phi); if (sn < 0) sn *= 0.72;
    out[o] = x; out[o + 1] = yc + rho * ry * sn; out[o + 2] = hemi * (zc + rho * rz * cs);
  }

  // Izgara yüzeyi: posFn(iu, iv, out) -> out[0..3]=xyz, out[3]=kıvrım. Normaller yüzlerden hesaplanır.
  function buildGrid(nu, nv, posFn, wrapV, vtx, idx, baseVertex, flip) {
    const nx = nu + 1, ny = nv + 1, tmp = new Float32Array(4);
    const P = new Float32Array(nx * ny * 3), F = new Float32Array(nx * ny), Nn = new Float32Array(nx * ny * 3);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { posFn(i, j, tmp); const k = i * ny + j; P[k * 3] = tmp[0]; P[k * 3 + 1] = tmp[1]; P[k * 3 + 2] = tmp[2]; F[k] = tmp[3]; }
    const tri = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * ny + j, b = (i + 1) * ny + j, c = (i + 1) * ny + j + 1, d = i * ny + j + 1;
      tri.push(a, b, c, a, c, d);
    }
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
      for (const q of [a, b, c]) { Nn[q] += nx_; Nn[q + 1] += ny_; Nn[q + 2] += nz_; }
    }
    if (wrapV) for (let i = 0; i < nx; i++) { const a = (i * ny) * 3, b = (i * ny + nv) * 3; for (let k = 0; k < 3; k++) { const s = Nn[a + k] + Nn[b + k]; Nn[a + k] = Nn[b + k] = s; } }
    const sgn = flip ? -1 : 1;
    for (let k = 0; k < nx * ny; k++) {
      let x = Nn[k * 3], y = Nn[k * 3 + 1], z = Nn[k * 3 + 2]; const l = Math.hypot(x, y, z) || 1;
      vtx.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], sgn * x / l, sgn * y / l, sgn * z / l, F[k]);
    }
    for (let t = 0; t < tri.length; t++) idx.push(baseVertex + tri[t]);
    return nx * ny;
  }

  // ------------------------------------------------------------------ Brain
  class Brain {
    constructor(canvas, cfg, opts) {
      if (!Limon.Layout) throw new Error('Limon.Brain: layout.js gerekli');
      this.canvas = canvas;
      this.cfg = Object.assign({}, cfg);
      const c = this.cfg;
      if (!c.V || !c.D || !c.L || !c.H || !c.FF || !c.T) throw new Error('Limon.Brain: cfg {V,T,D,L,H,FF} gerekli');
      this.lay = Limon.Layout.build(c);
      let vocab = (Limon.Data && typeof Limon.Data.vocab === 'string') ? Limon.Data.vocab : '';
      while (vocab.length < c.V) vocab += '?';
      this.vocab = vocab;
      this.opt = { autoRotate: true, showSynapses: true, showLetters: true, showAttention: true, quality: 'auto', gpuTiming: false, maxSynapses: 11000, insets: { l: 0, r: 0, t: 0, b: 0 } };
      if (opts) Object.assign(this.opt, opts);
      this.cssW = 800; this.cssH = 600; this.dpr = 1;
      this._buildTopology();
      this._buildGroups();
      this._initState();
      this._buildShell();
      this._initGL();
      this._bindInput();
    }

    // ---------------------------------------------------------------- topoloji (nöronlar)
    _buildTopology() {
      const { V, D, L, H, FF } = this.cfg;
      const ffN = Math.min(FF, 320);
      this.ffN = ffN; this.ffIdx = new Int32Array(ffN);
      for (let j = 0; j < ffN; j++) this.ffIdx[j] = Math.min(FF - 1, Math.floor((j + 0.5) * FF / ffN));
      const nS = 4 * L + 4; this.nSlabs = nS;
      const S = this.S = { IN: 0, S0: 1, head: (l) => 2 + 4 * l, mid: (l) => 3 + 4 * l, mlp: (l) => 4 + 4 * l, xout: (l) => 5 + 4 * l, xin: (l) => (l === 0 ? 1 : 5 + 4 * (l - 1)), fin: 2 + 4 * L, OUT: 3 + 4 * L };
      const counts = this.slabCount = new Int32Array(nS), kinds = this.slabKind = new Uint8Array(nS);
      counts[0] = V; kinds[0] = NK.IN; counts[1] = D; kinds[1] = NK.STREAM;
      for (let l = 0; l < L; l++) {
        counts[S.head(l)] = H; kinds[S.head(l)] = NK.HEAD; counts[S.mid(l)] = D; kinds[S.mid(l)] = NK.STREAM;
        counts[S.mlp(l)] = ffN; kinds[S.mlp(l)] = NK.MLP; counts[S.xout(l)] = D; kinds[S.xout(l)] = NK.STREAM;
      }
      counts[S.fin] = D; kinds[S.fin] = NK.FINAL; counts[S.OUT] = V; kinds[S.OUT] = NK.OUT;
      const st = this.slabStart = new Int32Array(nS + 1);
      for (let s = 0; s < nS; s++) st[s + 1] = st[s] + counts[s];
      const NN = this.NN = st[nS];
      const pos = this.nPos = new Float32Array(NN * 3), size = this.nSize = new Float32Array(NN);
      const kd = this.nKind = new Float32Array(NN), un = this.nUnit = new Float32Array(NN);
      const rng = mulberry(20240611);
      this.slabX = new Float32Array(nS);
      for (let s = 1; s < nS - 1; s++) this.slabX[s] = -0.93 + 1.86 * (s - 1) / (nS - 3);
      // akış boyutlarının sabit (yarımküre, açı, yarıçap) konumu: iki yarımkürede altın-açı çiçeği
      const dh = new Float32Array(D), dp = new Float32Array(D), dr = new Float32Array(D), nh = (D + 1) >> 1;
      for (let k = 0; k < D; k++) { const hemi = (k & 1) ? 1 : -1, m = k >> 1; dh[k] = hemi; dr[k] = 0.22 + 0.76 * Math.sqrt((m + 0.5) / nh); dp[k] = m * 2.39996323 + (hemi > 0 ? 0 : 1.3); }
      this.dimPhi = dp; this.dimRho = dr; this.dimHemi = dh;
      // harf panelleri
      const cols = Math.ceil(Math.sqrt(V * 1.5)), rows = Math.ceil(V / cols), sp = 0.085;
      this.panel = { cols, rows, sp };
      const tmp = new Float32Array(3);
      for (let s = 0; s < nS; s++) {
        const kind = kinds[s], n = counts[s];
        for (let u = 0; u < n; u++) {
          const idx = st[s] + u, o = idx * 3; let sz = 0.04, un_ = 0;
          if (kind === NK.IN || kind === NK.OUT) {
            const col = u % cols, row = (u / cols) | 0;
            const z = (col - (cols - 1) / 2) * sp, y = 0.05 + ((rows - 1) / 2 - row) * sp;
            const curve = 0.30 * (z * z + (y - 0.05) * (y - 0.05));
            pos[o] = kind === NK.IN ? -1.50 + curve : 1.50 - curve; pos[o + 1] = y; pos[o + 2] = z; sz = 0.062;
          } else if (kind === NK.HEAD) {
            const hemi = (u & 1) ? 1 : -1, phi = 0.9 + Math.floor(u / 2) * (TAU / Math.max(1, Math.ceil(H / 2))) + (hemi > 0 ? 0.4 : 0);
            crossPos(tmp, 0, this.slabX[s], hemi, phi, 0.42); pos[o] = tmp[0]; pos[o + 1] = tmp[1]; pos[o + 2] = tmp[2]; sz = 0.115; un_ = u;
          } else if (kind === NK.MLP) {
            const hemi = rng() < 0.5 ? -1 : 1, phi = rng() * TAU, rho = 0.16 + 0.80 * Math.sqrt(rng());
            crossPos(tmp, 0, this.slabX[s] + (rng() - 0.5) * 0.12, hemi, phi, rho); pos[o] = tmp[0]; pos[o + 1] = tmp[1]; pos[o + 2] = tmp[2]; sz = 0.034;
          } else { // akış / final
            crossPos(tmp, 0, this.slabX[s] + (rng() - 0.5) * 0.02, dh[u], dp[u], dr[u]); pos[o] = tmp[0]; pos[o + 1] = tmp[1]; pos[o + 2] = tmp[2]; sz = kind === NK.FINAL ? 0.046 : 0.042;
          }
          size[idx] = sz; kd[idx] = kind; un[idx] = un_;
        }
      }
      this.nSlab = new Int16Array(NN); for (let s = 0; s < nS; s++) for (let i = st[s]; i < st[s + 1]; i++) this.nSlab[i] = s;
      this.slabDelay = new Float32Array(nS); for (let s = 0; s < nS; s++) this.slabDelay[s] = s * SLAB_DELAY;
    }

    // ---------------------------------------------------------------- sinaps grupları
    _buildGroups() {
      const { V, D, L, H } = this.cfg, ffN = this.ffN, S = this.S;
      const groups = this.groups = [];
      const skipTotal = L * 2 * D + D;
      const rest = Math.max(1000, this.opt.maxSynapses - skipTotal);
      const kEmb = Math.round(rest * 0.075), per = rest * 0.85 / L;
      const mk = (type, layer, src, dst, cand, K, agg, extra) => {
        K = Math.min(K, type === GT.SKIP ? cand : Math.floor(cand * (agg ? 0.45 : 0.30)));
        const cap = type === GT.SKIP ? cand : Math.ceil(K * 1.5) + 8;
        const g = Object.assign({ type, layer, src, dst, cand, K, cap, base: 0, agg, idx: groups.length, ref: 0, gain: 1, lo: agg ? 1.10 : 2.3, span: agg ? 2.2 : 3.0,
          slotOf: type === GT.SKIP ? null : new Int32Array(cand).fill(-1), free: new Int32Array(cap), nFree: cap, alive: 0 }, extra || {});
        for (let i = 0; i < cap; i++) g.free[i] = cap - 1 - i;
        groups.push(g); return g;
      };
      mk(GT.EMB, -1, S.IN, S.S0, V * D, kEmb, false);
      for (let l = 0; l < L; l++) {
        mk(GT.QKV, l, S.xin(l), S.head(l), D * H, Math.round(per * 0.14), true);
        mk(GT.PROJ, l, S.head(l), S.mid(l), H * D, Math.round(per * 0.14), true);
        mk(GT.SKIP, l, S.xin(l), S.mid(l), D, D, false);
        mk(GT.FC1, l, S.mid(l), S.mlp(l), D * ffN, Math.round(per * 0.36), false);
        mk(GT.FC2, l, S.mlp(l), S.xout(l), ffN * D, Math.round(per * 0.36), false);
        mk(GT.SKIP, l, S.mid(l), S.xout(l), D, D, false);
      }
      mk(GT.SKIP, L - 1, S.xout(L - 1), S.fin, D, D, false);
      mk(GT.OUT, -1, S.fin, S.OUT, D * V, kEmb, false);
      let base = 0; for (const g of groups) { g.base = base; base += g.cap; }
      const nSl = this.nSlots = base;
      this.E = new Float32Array(nSl * ESTRIDE);
      this.sSrc = new Int32Array(nSl); this.sDst = new Int32Array(nSl); this.sStr = new Float32Array(nSl);
      this.sState = new Uint8Array(nSl); this.sId = new Int32Array(nSl); this.sDeath = new Float32Array(nSl);
      let maxCand = 0, maxCap = 0;
      for (const g of groups) { maxCand = Math.max(maxCand, g.cand); maxCap = Math.max(maxCap, g.cap); }
      this._mag = new Float32Array(maxCand); this._sgn = new Int8Array(maxCand); this._dBuf = new Float32Array(maxCap); this._dSlot = new Int32Array(maxCap);
      for (let s = 0; s < nSl; s++) { const o = s * ESTRIDE; this.E[o + 13] = 1e6; this.E[o + 14] = 1e6; }
      // ağırlık ofsetleri
      const by = this.lay.byName; this.off = { tok: by.tok.offset, layers: [] };
      for (let l = 0; l < L; l++) this.off.layers.push({ qkv: by[`l${l}.qkv.w`].offset, proj: by[`l${l}.proj.w`].offset, fc1: by[`l${l}.fc1.w`].offset, fc2: by[`l${l}.fc2.w`].offset });
      // özdeşlik (residual) çizgileri: hepsi hazır, sabit soluk
      for (const g of groups) if (g.type === GT.SKIP) for (let i = 0; i < D; i++) {
        const slot = g.base + i; this.sState[slot] = 1; this.sId[slot] = i;
        this._writeGeom(slot, g, i, 1); const o = slot * ESTRIDE;
        this.E[o + 10] = 0.30; this.E[o + 11] = 0.30; this.E[o + 12] = -100; this.E[o + 13] = -100; this.E[o + 14] = 1e6; this.sStr[slot] = 0.30;
      }
    }

    _decode(g, id) {
      const { V, D, H } = this.cfg, ffN = this.ffN;
      switch (g.type) {
        case GT.EMB: this._du = (id / D) | 0; this._dv = id % D; break;
        case GT.QKV: this._du = (id / H) | 0; this._dv = id % H; break;
        case GT.PROJ: this._du = (id / D) | 0; this._dv = id % D; break;
        case GT.FC1: this._du = (id / ffN) | 0; this._dv = id % ffN; break;
        case GT.FC2: this._du = (id / D) | 0; this._dv = id % D; break;
        case GT.OUT: this._du = (id / V) | 0; this._dv = id % V; break;
        default: this._du = id; this._dv = id;
      }
    }
    _writeGeom(slot, g, id, kind) {
      this._decode(g, id);
      const src = this.slabStart[g.src] + this._du, dst = this.slabStart[g.dst] + this._dv, p = this.nPos, E = this.E, o = slot * ESTRIDE;
      E[o] = p[src * 3]; E[o + 1] = p[src * 3 + 1]; E[o + 2] = p[src * 3 + 2];
      let sd = ((id * 2654435761 + g.idx * 40503) >>> 0) / 4294967296; E[o + 3] = sd;
      E[o + 4] = p[dst * 3]; E[o + 5] = p[dst * 3 + 1]; E[o + 6] = p[dst * 3 + 2]; E[o + 7] = kind;
      E[o + 8] = src; E[o + 9] = dst; this.sSrc[slot] = src; this.sDst[slot] = dst;
    }

    // ---------------------------------------------------------------- durum
    _initState() {
      const { V, T, L, H } = this.cfg, NN = this.NN;
      this.now = 0; this._t0 = null; this._lastT = null;
      this.glowW = 256; this.glowH = Math.max(1, Math.ceil(NN / 256)); this.glowArr = new Float32Array(this.glowW * this.glowH * 4);
      this.slabGlow = new Float32Array(32); this.nScale = new Float32Array(NN);
      this.waves = []; for (let i = 0; i < WAVE_POOL; i++) this.waves.push({ t0: -1e9, act: new Float32Array(NN), probs: new Float32Array(V), tok: 0, used: false });
      this.waveHead = 0; this.arrivedWave = -1; this._lastArrive = -1e9;
      this.pulseData = new Float32Array(PULSE_POOL * PSTRIDE); this.pulseHead = 0; this.pulseTotal = 0; this.pulseDirtyFrom = 0; this.pulseDirtyN = 0;
      this.arcData = new Float32Array(ARC_POOL * 8); this.arcHead = 0; this.arcDirtyFrom = 0; this.arcDirtyN = 0;
      for (let i = 0; i < ARC_POOL; i++) this.arcData[i * 8 + 3] = -1e6;
      for (let i = 0; i < PULSE_POOL; i++) this.pulseData[i * PSTRIDE + 7] = 1e9;
      this.ctxTok = new Int32Array(T + 8).fill(-1); this.curPos = 0; this.curPosSm = 0; this.lastTok = -1;
      this.outSm = new Float32Array(V); this.inSm = new Float32Array(V);
      this.top = [{ id: 0, p: 0 }, { id: 0, p: 0 }, { id: 0, p: 0 }];
      // durum
      this.warm = 0; this.warmT = 0; this.jit = 1; this.jitT = 1; this.stage = -1; this.stageT0 = -1e9; this.status = { step: 0, loss: 0, lossNorm: 1, stage: 0, tokensPerSec: 0 };
      this.birthT0 = null; this.birthReq = true; this.birthDone = true; this.uBirth = 9; this.sparkT0 = -1e9;
      // sonsuza dek gelen ağırlıklar
      this._wPend = null; this._wCur = null; this._updPending = false; this._stage = 0; this._noPlast = false; this._refDirty = true;
      this.pcaC = null; this.pcaCur = new Float32Array(V * 3); this.pcaTgt = new Float32Array(V * 3); this._pcaReady = false;
      this._comp = [new Float32Array(this.cfg.D), new Float32Array(this.cfg.D), new Float32Array(this.cfg.D)]; this._compInit = false;
      this._Xc = new Float32Array(V * this.cfg.D); this._pu = new Float32Array(V); this._pv = new Float32Array(this.cfg.D);
      this.perf = { cpu: 0, cpuMax: 0, update: 0, updateMax: 0, gpu: 0, frames: 0, labels: 0 };
      this._qLevel = 2; this._qEma = 16.7; this._qT = 0;
      // harf sınıfı renkleri
      this.letterCol = new Float32Array(V * 3); const vc = this.vocab;
      for (let i = 0; i < V; i++) {
        const ch = vc[i]; let col;
        if (VOWELS.indexOf(ch) >= 0) col = [1.0, 0.90, 0.25];
        else if (/[0-9]/.test(ch)) col = [0.55, 1.0, 0.30];
        else if (ch === ' ' || ch === '\n') col = [0.95, 0.98, 1.0];
        else if (/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(ch)) col = [0.20, 0.85, 1.0];
        else col = [0.78, 0.50, 1.0];
        this.letterCol.set(col, i * 3);
      }
      // kamera
      this.cam = { yaw: 0.42, pitch: 0.20, zoom: 1, px: 0, py: 0, pz: 0, yawV: 0, pitchV: 0, frameY: 0.2, frameHH: 1.5, idle: 0, resetting: false };
      this.camDefault = { yaw: 0.42, pitch: 0.20 };
      this.vp = new Float32Array(16); this.proj = new Float32Array(16); this.view = new Float32Array(16); this.eye = new Float32Array(3);
      this.camDist = 4.2; this._axial = 0; this.camFwd = new Float32Array(3);
    }

    // ---------------------------------------------------------------- kabuk (korteks) ağı
    _buildShell() {
      const vtx = [], idx = [], ranges = [];
      let baseV = 0;
      const NT = 150, NP = 96;
      for (const hemi of [-1, 1]) {
        const n = buildGrid(NT, NP, (i, j, out) => {
          const x = -BRAIN_HALF * Math.cos(PI * i / NT), phi = TAU * j / NP;
          const p = [0, 0, 0], c = [0, 0, 0], tmp = new Float32Array(3);
          crossPos(tmp, 0, x, hemi, phi, 1); p[0] = tmp[0]; p[1] = tmp[1]; p[2] = tmp[2];
          crossPos(tmp, 0, x, hemi, phi, 0); c[0] = tmp[0]; c[1] = tmp[1]; c[2] = tmp[2];
          let dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]; let l = Math.hypot(dx, dy, dz);
          if (l < 1e-5) { dx = x < 0 ? -1 : 1; dy = 0; dz = 0; l = 1; }
          dx /= l; dy /= l; dz /= l;
          const f = foldPattern(p[0] * 1.15, p[1] * 1.15, p[2] * 1.15);
          const pole = Math.min(1, Math.sin(PI * i / NT) * 3);
          const d = (-0.034 * smooth01((f - 0.55) / 0.4) + 0.010 * (f - 0.5)) * pole;
          out[0] = p[0] + dx * d; out[1] = p[1] + dy * d; out[2] = p[2] + dz * d; out[3] = f;
        }, true, vtx, idx, baseV, false);
        baseV += n;
      }
      const hemiIdx = idx.length;
      // beyincik: ince yatay kıvrımlı elipsoid
      baseV += buildGrid(48, 64, (i, j, out) => {
        const th = PI * i / 48, ph = TAU * j / 64;
        const x = -0.66 - 0.36 * Math.cos(th) * 1.0, y = -0.47 + 0.19 * Math.sin(th) * Math.sin(ph) * 1.0, z = 0.40 * Math.sin(th) * Math.cos(ph);
        const n1 = vnoise(x * 4, y * 4, z * 4);
        out[0] = x; out[1] = y; out[2] = z; out[3] = Math.pow(0.5 + 0.5 * Math.sin(y * 105 + n1 * 5), 3) * 1.0;
      }, true, vtx, idx, baseV, false);
      // beyin sapı: hafif eğik tüp
      baseV += buildGrid(36, 24, (i, j, out) => {
        const t = i / 36, ph = TAU * j / 24, r = 0.085 - 0.03 * t;
        const cx = -0.02 + 0.13 * t, cy = -0.28 - 0.70 * t;
        out[0] = cx + r * Math.cos(ph) * 0.9; out[1] = cy; out[2] = r * Math.sin(ph); out[3] = Math.pow(0.5 + 0.5 * Math.sin(t * 60), 4);
      }, true, vtx, idx, baseV, false);
      this.shellV = new Float32Array(vtx); this.shellI = new Uint16Array(idx);
      this.shellHemiCount = hemiIdx; this.shellCount = idx.length;
      if (baseV > 65535) throw new Error('shell too big');
    }

    // ---------------------------------------------------------------- ağırlık işleme (aşamalı, kareye bölünür)
    setWeights(flat) {
      const n = this.lay.total;
      if (!flat || flat.length < n) return;
      if (!this._wPend) this._wPend = new Float32Array(n);
      this._wPend.set(flat.length === n ? flat : flat.subarray(0, n));
      this._updPending = true; this._stage = 0; this._updAcc = 0;
    }

    _val(g, w, id) { // işaretli ham değer (ağırlık ölçeğinde)
      const { V, D, H, FF } = this.cfg, DH = D / H, ff = this.ffIdx, ffN = this.ffN, L0 = g.layer >= 0 ? this.off.layers[g.layer] : null;
      switch (g.type) {
        case GT.EMB: return w[this.off.tok + id];
        case GT.OUT: { const d = (id / V) | 0, v = id % V; return w[this.off.tok + v * D + d]; }
        case GT.QKV: {
          const i = (id / H) | 0, h = id % H, b = L0.qkv + i * 3 * D; let ss = 0, sv = 0;
          for (let c = 0; c < DH; c++) { const q = w[b + h * DH + c], k = w[b + D + h * DH + c], v = w[b + 2 * D + h * DH + c]; ss += q * q + k * k + v * v; sv += v; }
          const r = Math.sqrt(ss / (3 * DH)); return sv < 0 ? -r : r;
        }
        case GT.PROJ: {
          const h = (id / D) | 0, j = id % D; let ss = 0, sv = 0;
          for (let r = 0; r < DH; r++) { const x = w[L0.proj + (h * DH + r) * D + j]; ss += x * x; sv += x; }
          const r = Math.sqrt(ss / DH); return sv < 0 ? -r : r;
        }
        case GT.FC1: { const i = (id / ffN) | 0, j = id % ffN; return w[L0.fc1 + i * FF + ff[j]]; }
        case GT.FC2: { const j = (id / D) | 0, k = id % D; return w[L0.fc2 + ff[j] * D + k]; }
        default: return 1;
      }
    }
    _fillMag(g, w) {
      const { V, D, FF } = this.cfg, mag = this._mag, sg = this._sgn, ff = this.ffIdx, ffN = this.ffN, n = g.cand;
      const L0 = g.layer >= 0 ? this.off.layers[g.layer] : null;
      if (g.type === GT.EMB) { const o = this.off.tok; for (let i = 0; i < n; i++) { const x = w[o + i]; mag[i] = x < 0 ? -x : x; sg[i] = x < 0 ? -1 : 1; } }
      else if (g.type === GT.OUT) { const o = this.off.tok; for (let d = 0; d < D; d++) for (let v = 0; v < V; v++) { const x = w[o + v * D + d], i = d * V + v; mag[i] = x < 0 ? -x : x; sg[i] = x < 0 ? -1 : 1; } }
      else if (g.type === GT.FC1) { for (let i = 0; i < D; i++) { const r = L0.fc1 + i * FF; for (let j = 0; j < ffN; j++) { const x = w[r + ff[j]], k = i * ffN + j; mag[k] = x < 0 ? -x : x; sg[k] = x < 0 ? -1 : 1; } } }
      else if (g.type === GT.FC2) { for (let j = 0; j < ffN; j++) { const r = L0.fc2 + ff[j] * D; for (let k = 0; k < D; k++) { const x = w[r + k], i = j * D + k; mag[i] = x < 0 ? -x : x; sg[i] = x < 0 ? -1 : 1; } } }
      else for (let i = 0; i < n; i++) { const x = this._val(g, w, i); mag[i] = x < 0 ? -x : x; sg[i] = x < 0 ? -1 : 1; }
    }
    _bright(g, m) { const s = m / g.ref; return 0.08 + 0.92 * clamp(Math.log2(Math.max(s, 1e-6) / g.lo) / g.span, 0, 1); }

    _updateGroup(g) {
      const w = this._wPend, prev = this._noPlast ? null : this._wCur, now = this.now, E = this.E;
      const n = g.cand, mag = this._mag, sg = this._sgn;
      this._fillMag(g, w);
      let mx = 0, ss = 0, sm = 0, s3 = 0;
      const gain = g.gain;
      for (let i = 0; i < n; i++) { const m = mag[i]; if (m > mx) mx = m; ss += m * m; sm += m; }
      if (g.ref === 0 || !(g.ref > 0)) g.ref = Math.max(1e-9, g.agg ? sm / n : Math.sqrt(ss / n));
      if (!this._hist) this._hist = new Int32Array(512);
      const hist = this._hist; hist.fill(0);
      const inv = 511 / (mx || 1);
      for (let i = 0; i < n; i++) hist[(mag[i] * inv) | 0]++;
      let acc = 0, b = 511; for (; b > 0; b--) { acc += hist[b]; if (acc >= g.K) break; }
      const thr = b / inv, keep = thr * 0.9;
      const slotOf = g.slotOf, dB = this._dBuf, dS = this._dSlot; let alive = 0, nd = 0;
      const end = g.base + g.cap;
      for (let slot = g.base; slot < end; slot++) {
        const s = this.sState[slot], o = slot * ESTRIDE;
        if (s === 2) { if (now - this.sDeath[slot] > 1.0) { this.sState[slot] = 0; g.free[g.nFree++] = slot - g.base; E[o + 13] = 1e6; E[o + 14] = 1e6; } continue; }
        if (s !== 1) continue;
        const id = this.sId[slot];
        if (mag[id] < keep) { this.sState[slot] = 2; this.sDeath[slot] = now; E[o + 14] = now; slotOf[id] = -1; continue; }
        alive++;
        const b0 = this._bright(g, mag[id]); s3 += b0 * b0 * b0;
        const bv = b0 * gain * sg[id];
        const k = smooth01((now - E[o + 12]) / 0.8), disp = E[o + 10] + (E[o + 11] - E[o + 10]) * k;
        E[o + 10] = disp; E[o + 11] = bv; E[o + 12] = now; this.sStr[slot] = bv < 0 ? -bv : bv;
        if (prev) { dB[nd] = Math.abs(sg[id] * mag[id] - this._val(g, prev, id)) / g.ref; dS[nd] = slot; nd++; }
      }
      for (let id = 0; id < n && alive < g.K; id++) {
        if (mag[id] < thr || slotOf[id] >= 0) continue;
        if (g.nFree === 0) { // en eski ölen slotu çal
          let best = -1, bd = 1e30; for (let slot = g.base; slot < end; slot++) if (this.sState[slot] === 2 && this.sDeath[slot] < bd) { bd = this.sDeath[slot]; best = slot; }
          if (best < 0) break; this.sState[best] = 0; g.free[g.nFree++] = best - g.base;
        }
        const b0 = this._bright(g, mag[id]); s3 += b0 * b0 * b0;
        const slot = g.base + g.free[--g.nFree], o = slot * ESTRIDE, bv = b0 * gain * sg[id];
        this._writeGeom(slot, g, id, 0);
        E[o + 10] = bv; E[o + 11] = bv; E[o + 12] = now; E[o + 13] = now; E[o + 14] = 1e6; E[o + 15] = 0; E[o + 16] = -100;
        this.sState[slot] = 1; this.sId[slot] = id; slotOf[id] = slot; this.sStr[slot] = bv < 0 ? -bv : bv; alive++;
      }
      g.alive = alive;
      // yoğunluk dengesi: grup içinde çok sayıda sinaps aynı anda "çok güçlü" ise (ölçek ne olursa olsun) ekran patlamasın diye ortak kazanç düşer
      if (alive > 0) g.gain = Math.min(1, Math.cbrt(0.24 / Math.max(1e-6, s3 / alive)));
      if (nd > 0) { // plastisite: grubun ortalamasına ve mutlak ölçeğe göre
        let mu = 0; for (let i = 0; i < nd; i++) mu += dB[i]; mu /= nd;
        for (let i = 0; i < nd; i++) {
          const rel = clamp((dB[i] - 0.5 * mu) / (1.5 * mu + 1e-9), 0, 1), ab = Math.pow(clamp(dB[i] / 0.4, 0, 1), 0.7), pl = rel * ab;
          if (pl > 0.12) { const o = dS[i] * ESTRIDE; E[o + 15] = pl; E[o + 16] = now; }
        }
      }
      this._uploadEdges(g.base, g.cap);
    }

    _updatePCA() {
      const { V, D } = this.cfg, w = this._wPend, X = this._Xc, o = this.off.tok, comp = this._comp, u = this._pu, mean = this._pv;
      mean.fill(0);
      for (let v = 0; v < V; v++) for (let d = 0; d < D; d++) mean[d] += w[o + v * D + d];
      for (let d = 0; d < D; d++) mean[d] /= V;
      for (let v = 0; v < V; v++) for (let d = 0; d < D; d++) X[v * D + d] = w[o + v * D + d] - mean[d];
      if (!this._compInit) { const r = mulberry(4242); for (let k = 0; k < 3; k++) for (let d = 0; d < D; d++) comp[k][d] = r() - 0.5; }
      const iters = this._compInit ? 4 : 22;
      for (let it = 0; it < iters; it++) for (let k = 0; k < 3; k++) {
        const c = comp[k];
        for (let v = 0; v < V; v++) { let s = 0; const r = v * D; for (let d = 0; d < D; d++) s += X[r + d] * c[d]; u[v] = s; }
        const nv = this._tmpD || (this._tmpD = new Float32Array(D)); nv.fill(0);
        for (let v = 0; v < V; v++) { const uv = u[v], r = v * D; for (let d = 0; d < D; d++) nv[d] += X[r + d] * uv; }
        for (let j = 0; j < k; j++) { let dp = 0; const cj = comp[j]; for (let d = 0; d < D; d++) dp += nv[d] * cj[d]; for (let d = 0; d < D; d++) nv[d] -= dp * cj[d]; }
        let l = 0; for (let d = 0; d < D; d++) l += nv[d] * nv[d]; l = Math.sqrt(l) || 1;
        for (let d = 0; d < D; d++) c[d] = nv[d] / l;
      }
      this._compInit = true;
      const sig = [0, 0, 0], T = this.pcaTgt;
      for (let k = 0; k < 3; k++) {
        const c = comp[k]; let s2 = 0;
        for (let v = 0; v < V; v++) { let s = 0; const r = v * D; for (let d = 0; d < D; d++) s += X[r + d] * c[d]; T[v * 3 + k] = s; s2 += s * s; }
        sig[k] = Math.sqrt(s2 / V);
      }
      const sm = Math.max(sig[0], sig[1], sig[2], 1e-12);
      for (let k = 0; k < 3; k++) { const sc = sig[k] > 1e-12 ? Math.pow(sig[k] / sm, 0.35) / (2.6 * sig[k]) : 0; for (let v = 0; v < V; v++) T[v * 3 + k] *= sc; }
      for (let v = 0; v < V; v++) { const l = Math.hypot(T[v * 3], T[v * 3 + 1], T[v * 3 + 2]); if (l > 1.25) { const f = 1.25 / l; T[v * 3] *= f; T[v * 3 + 1] *= f; T[v * 3 + 2] *= f; } }
      // etiket çakışmasını gider: kümeler korunur, yalnızca üst üste binen harfler birbirinden itilir (okunabilirlik)
      const dmin = 0.15, dm2 = dmin * dmin;
      for (let it = 0; it < 16; it++) {
        for (let i = 0; i < V; i++) for (let j = i + 1; j < V; j++) {
          let dx = T[j * 3] - T[i * 3], dy = T[j * 3 + 1] - T[i * 3 + 1], dz = T[j * 3 + 2] - T[i * 3 + 2]; const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= dm2) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-6) { dx = ((i * 7 + j * 3) % 5) - 2 + 0.5; dy = ((i * 3 + j) % 7) - 3; dz = 1; d = Math.hypot(dx, dy, dz); dx /= d; dy /= d; dz /= d; d = 0; } else { dx /= d; dy /= d; dz /= d; }
          const push = (dmin - d) * 0.5 * 0.6;
          T[i * 3] -= dx * push; T[i * 3 + 1] -= dy * push; T[i * 3 + 2] -= dz * push; T[j * 3] += dx * push; T[j * 3 + 1] += dy * push; T[j * 3 + 2] += dz * push;
        }
      }
      if (!this._pcaReady) { this.pcaCur.set(T); this._pcaReady = true; }
    }

    _commit() {
      const t = this._wCur; this._wCur = this._wPend; this._wPend = t || new Float32Array(this.lay.total);
      this._updPending = false; this._noPlast = false;
      this.perf.update = this._updAcc; this.perf.updateMax = Math.max(this.perf.updateMax, this._updAcc);
    }

    _runJobs(budget) {
      if (!this._updPending) return;
      const t0 = performance.now(), G = this.groups.length;
      while (this._updPending) {
        const st = this._stage;
        if (st < G) { const g = this.groups[st]; if (g.type !== GT.SKIP) this._updateGroup(g); this._stage++; }
        else if (st === G) { this._updatePCA(); this._stage++; }
        else { this._updAcc += performance.now() - t0; this._commit(); return; }
        if (performance.now() - t0 > budget) break;
      }
      this._updAcc += performance.now() - t0;
    }

    // ---------------------------------------------------------------- iz (trace): gerçek aktivasyonlar
    _nrm(idx, v) {
      const a = v < 0 ? -v : v; let s = this.nScale[idx];
      s = s === 0 ? a + 1e-6 : s + (a - s) * 0.02; this.nScale[idx] = s;
      const r = a / (s + 1e-6), t = Math.tanh(0.22 * r * Math.pow(r, 1.2)); return v < 0 ? -t : t;
    }
    _rnd() { let x = this._rs || 2463534242; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this._rs = x; return x / 4294967296; }

    pushTrace(tr) {
      if (!tr || !tr.layers || !this.groups) return;
      const { V, D, L, H } = this.cfg, S = this.S, st = this.slabStart, ffN = this.ffN, ffIdx = this.ffIdx, now = this.now;
      const wv = this.waves[this.waveHead]; this.waveHead = (this.waveHead + 1) % WAVE_POOL;
      const act = wv.act; act.fill(0); wv.t0 = now; wv.used = true;
      const tk = clamp(tr.token | 0, 0, V - 1); wv.tok = tk; act[st[S.IN] + tk] = 1;
      const l0 = tr.layers[0];
      if (l0 && l0.xIn) { const b = st[S.S0]; for (let d = 0; d < D; d++) act[b + d] = this._nrm(b + d, l0.xIn[d]); }
      const pos = tr.pos | 0;
      for (let l = 0; l < L; l++) {
        const T_ = tr.layers[l]; if (!T_) continue;
        const hb = st[S.head(l)], mb = st[S.mid(l)], fb = st[S.mlp(l)], xb = st[S.xout(l)];
        const attn = T_.attn;
        if (attn) {
          const n = Math.max(1, (attn.length / H) | 0);
          for (let h = 0; h < H; h++) {
            let ent = 0, mxp = 0;
            const r = h * n;
            for (let j = 0; j < n; j++) { const p = attn[r + j]; if (p > 1e-9) ent -= p * Math.log(p); if (p > mxp) mxp = p; }
            act[hb + h] = n > 1 ? clamp(0.15 + 1.4 * (1 - ent / Math.log(n)), 0.1, 1) : 0.6;
          }
        }
        if (T_.hMid) for (let d = 0; d < D; d++) act[mb + d] = this._nrm(mb + d, T_.hMid[d]);
        if (T_.mlpAct) for (let j = 0; j < ffN; j++) act[fb + j] = this._nrm(fb + j, T_.mlpAct[ffIdx[j]]);
        if (T_.xOut) for (let d = 0; d < D; d++) act[xb + d] = this._nrm(xb + d, T_.xOut[d]);
      }
      if (tr.xFinal) { const b = st[S.fin]; for (let d = 0; d < D; d++) act[b + d] = this._nrm(b + d, tr.xFinal[d]); }
      if (tr.probs) { const b = st[S.OUT]; for (let v = 0; v < V; v++) { const p = tr.probs[v]; wv.probs[v] = p; act[b + v] = Math.sqrt(p > 0 ? p : 0); } }
      // bağlam şeridi
      if (pos >= 0 && pos < this.ctxTok.length) this.ctxTok[pos] = tk;
      if (pos < this.curPos - 4) this.curPosSm = pos;
      this.curPos = pos; this.lastTok = tk;
      // dikkat yayları: head başına en güçlü 2 önceki konum
      for (let l = 0; l < L; l++) {
        const attn = tr.layers[l] && tr.layers[l].attn; if (!attn) continue;
        const n = Math.max(1, (attn.length / H) | 0), birth = now + this.slabDelay[S.head(l)];
        for (let h = 0; h < H; h++) {
          let v1 = 0.12, i1 = -1, v2 = 0.12, i2 = -1; const r = h * n;
          for (let j = 0; j < n - 1; j++) { const p = attn[r + j]; if (p > v1) { v2 = v1; i2 = i1; v1 = p; i1 = j; } else if (p > v2) { v2 = p; i2 = j; } }
          if (i1 >= 0) this._addArc(pos, i1, v1, birth, l, h);
          if (i2 >= 0) this._addArc(pos, i2, v2, birth, l, h);
        }
      }
      this._spawnPulses(act, now);
    }
    _addArc(from, to, wgt, birth, l, h) {
      const o = this.arcHead * 8, a = this.arcData;
      a[o] = from; a[o + 1] = to; a[o + 2] = wgt; a[o + 3] = birth; a[o + 4] = l; a[o + 5] = h; a[o + 6] = this._rnd(); a[o + 7] = 0;
      this.arcHead = (this.arcHead + 1) % ARC_POOL; this.arcDirtyN = Math.min(ARC_POOL, this.arcDirtyN + 1);
    }
    _spawnPulses(act, t0) {
      const nSl = this.nSlots, sc = this._score || (this._score = new Float32Array(nSl)), sState = this.sState, sSrc = this.sSrc, sStr = this.sStr;
      let sum = 0;
      for (let s = 0; s < nSl; s++) {
        if (sState[s] !== 1) { sc[s] = 0; continue; }
        let a = act[sSrc[s]]; if (a < 0) a = -a;
        const v = a * (0.12 + sStr[s]); sc[s] = v; sum += v;
      }
      if (sum <= 0) return;
      const rate = (this._pulseTarget || 150) / sum, E = this.E, P = this.pulseData, sl = this.slabDelay, nSlab = this.nSlab;
      for (let s = 0; s < nSl; s++) {
        const v = sc[s]; if (v <= 0 || this._rnd() >= v * rate) continue;
        const o = s * ESTRIDE, p = this.pulseHead * PSTRIDE, src = sSrc[s], dst = this.sDst[s];
        const launch = t0 + sl[nSlab[src]], dur = Math.max(0.10, (sl[nSlab[dst]] - sl[nSlab[src]]) * 0.9);
        P[p] = E[o]; P[p + 1] = E[o + 1]; P[p + 2] = E[o + 2]; P[p + 3] = E[o + 3];
        P[p + 4] = E[o + 4]; P[p + 5] = E[o + 5]; P[p + 6] = E[o + 6]; P[p + 7] = launch;
        P[p + 8] = dur; P[p + 9] = clamp(Math.abs(act[src]) * (0.35 + 1.3 * sStr[s]), 0.05, 1.6);
        P[p + 10] = (E[o + 11] >= 0) === (act[src] >= 0) ? 1 : -1; P[p + 11] = E[o + 7];
        this.pulseHead = (this.pulseHead + 1) % PULSE_POOL; this.pulseDirtyN = Math.min(PULSE_POOL, this.pulseDirtyN + 1);
      }
    }

    // ---------------------------------------------------------------- durum / seçenekler / yaşam döngüsü
    setStatus(s) {
      if (!s) return;
      const st = this.status;
      if (s.step !== undefined) st.step = s.step; if (s.loss !== undefined) st.loss = s.loss;
      if (s.tokensPerSec !== undefined) st.tokensPerSec = s.tokensPerSec;
      if (s.lossNorm !== undefined && isFinite(s.lossNorm)) { st.lossNorm = clamp(s.lossNorm, 0, 1); this.warmT = 1 - st.lossNorm; this.jitT = Math.pow(st.lossNorm, 1.3); }
      if (s.stage !== undefined && s.stage !== this.stage) { if (this.stage !== -1) this.stageT0 = this.now; this.stage = s.stage; }
    }
    setOptions(o) {
      if (!o) return;
      for (const k in o) { if (k === 'insets') Object.assign(this.opt.insets, o.insets); else if (o[k] !== undefined) this.opt[k] = o[k]; }
      if (o.quality !== undefined) { this._rtDirty = true; if (o.quality !== 'auto') this._qLevel = { low: 0, medium: 1, high: 2 }[o.quality] != null ? { low: 0, medium: 1, high: 2 }[o.quality] : 2; }
      if (o.gpuTiming !== undefined) this._gpuTimingOn = !!o.gpuTiming;
    }
    resize(cssW, cssH, dpr) {
      this.cssW = Math.max(1, cssW || 1); this.cssH = Math.max(1, cssH || 1); this.dpr = dpr > 0 ? dpr : 1;
      this.canvas.width = Math.max(1, Math.round(this.cssW * this.dpr)); this.canvas.height = Math.max(1, Math.round(this.cssH * this.dpr));
      this._rtDirty = true;
    }
    resetCamera() { this.cam.resetting = true; this.cam.yawV = this.cam.pitchV = 0; }
    birth() {
      this.birthReq = true;
      const E = this.E;
      for (const g of this.groups) {
        if (g.type === GT.SKIP) continue;
        for (let s = g.base; s < g.base + g.cap; s++) { this.sState[s] = 0; const o = s * ESTRIDE; E[o + 13] = 1e6; E[o + 14] = 1e6; E[o + 15] = 0; }
        g.slotOf.fill(-1); g.nFree = g.cap; for (let i = 0; i < g.cap; i++) g.free[i] = g.cap - 1 - i; g.ref = 0; g.gain = 1; g.alive = 0;
      }
      this._uploadEdges(0, this.nSlots);
      for (const w of this.waves) { w.t0 = -1e9; w.used = false; }
      for (let i = 0; i < PULSE_POOL; i++) this.pulseData[i * PSTRIDE + 7] = 1e9;
      for (let i = 0; i < ARC_POOL; i++) this.arcData[i * 8 + 3] = -1e6;
      this.pulseDirtyN = PULSE_POOL; this.arcDirtyN = ARC_POOL; this._pulseFull = true;
      this._wCur = null; this._noPlast = true; this._compInit = false; this._pcaReady = false; this.nScale.fill(0); this.outSm.fill(0); this._arrProbs = null;
      this.ctxTok.fill(-1); this.curPos = 0; this.curPosSm = 0;
      this.warm = 0; this.jit = 1;
      if (this._updPending) { this._stage = 0; this._updAcc = 0; }
    }
    stats() {
      let alive = 0; for (const g of this.groups) alive += g.type === GT.SKIP ? g.cand : g.alive;
      const p = this.perf;
      return { neurons: this.NN, synapses: alive, synapseSlots: this.nSlots, slabs: this.nSlabs, mlpShown: this.ffN, cpuMs: p.cpu, cpuMaxMs: p.cpuMax, gpuMs: p.gpu, updateMs: p.update, updateMaxMs: p.updateMax, quality: this._qLevel, rt: this.rtW ? [this.rtW, this.rtH] : null };
    }

    // ---------------------------------------------------------------- WebGL kurulumu
    _initGL() {
      const cv = this.canvas;
      const gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      if (!gl) { const e = new Error('WebGL2 açılamadı'); e.code = 'NO_WEBGL2'; throw e; }
      this.gl = gl; this._lost = false;
      this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
      this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const P = this.prog = {};
      const mk = (name, vs, fs) => { P[name] = makeProgram(gl, vs, fs, name); };
      mk('dust', SH.dustVS, SH.dustFS); mk('shell', SH.shellVS, SH.shellFS); mk('neuron', SH.neuronVS, SH.neuronFS);
      mk('edge', SH.edgeVS, SH.ribbonFS); mk('pulse', SH.pulseVS, SH.spriteFS.replace('o=vec4(vC.rgb*(exp(-d*4.)*.7+exp(-d*24.)*.9),1.);', 'o=vec4(vC.rgb*(exp(-d*3.)*.6+exp(-d*16.)*.9),1.);'));
      mk('sprite', SH.spriteVS, SH.spriteFS); mk('arc', SH.arcVS, SH.ribbonFS); mk('label', SH.labelVS, SH.labelFS);
      mk('down', FS_FULL_VS, SH.downFS); mk('blur', FS_FULL_VS, SH.blurFS); mk('comp', FS_FULL_VS, SH.compFS);
      const buf = (target, data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, usage || gl.STATIC_DRAW); return b; };
      const vao = () => { const v = gl.createVertexArray(); gl.bindVertexArray(v); return v; };
      const attr = (loc, size, stride, off, div) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off); gl.vertexAttribDivisor(loc, div || 0); };
      const B = this.buf = {}, A = this.vao = {};
      // toz / yıldız
      { const r = mulberry(99), d = new Float32Array(2600 * 4);
        for (let i = 0; i < 2600; i++) {
          const star = i < 1700; let x, y, z; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.02);
          const l = Math.hypot(x, y, z);
          if (star) { const R = 7 + r() * 9; d[i * 4] = x / l * R; d[i * 4 + 1] = y / l * R; d[i * 4 + 2] = z / l * R; d[i * 4 + 3] = r() * 0.48; }
          else { d[i * 4] = x * 3.1; d[i * 4 + 1] = y * 1.9; d[i * 4 + 2] = z * 2.3; d[i * 4 + 3] = 0.52 + r() * 0.47; }
        }
        A.dust = vao(); B.dust = buf(gl.ARRAY_BUFFER, d); attr(0, 4, 16, 0); }
      // kabuk
      A.shell = vao(); B.shellV = buf(gl.ARRAY_BUFFER, this.shellV); attr(0, 3, 28, 0); attr(1, 3, 28, 12); attr(2, 1, 28, 24);
      B.shellI = buf(gl.ELEMENT_ARRAY_BUFFER, this.shellI);
      // nöronlar
      { const NN = this.NN, d = new Float32Array(NN * 6);
        for (let i = 0; i < NN; i++) { d[i * 6] = this.nPos[i * 3]; d[i * 6 + 1] = this.nPos[i * 3 + 1]; d[i * 6 + 2] = this.nPos[i * 3 + 2]; d[i * 6 + 3] = this.nSize[i]; d[i * 6 + 4] = this.nKind[i]; d[i * 6 + 5] = this.nUnit[i]; }
        A.neuron = vao(); B.neuron = buf(gl.ARRAY_BUFFER, d); attr(0, 4, 24, 0); attr(1, 2, 24, 16); }
      // sinapslar (kurdele)
      { const n = 2 * (EDGE_SEG + 1), d = new Float32Array(n * 2);
        for (let s = 0; s <= EDGE_SEG; s++) for (let k = 0; k < 2; k++) { d[(s * 2 + k) * 2] = s / EDGE_SEG; d[(s * 2 + k) * 2 + 1] = k ? 1 : -1; }
        A.edge = vao(); B.edgeV = buf(gl.ARRAY_BUFFER, d); attr(0, 2, 8, 0);
        B.edge = buf(gl.ARRAY_BUFFER, this.E, gl.DYNAMIC_DRAW); for (let k = 0; k < 5; k++) attr(1 + k, 4, ESTRIDE * 4, k * 16, 1); this.edgeVerts = n; }
      // darbeler
      A.pulse = vao(); B.trail = buf(gl.ARRAY_BUFFER, new Float32Array([0, 1, 2, 3])); attr(0, 1, 4, 0);
      B.pulse = buf(gl.ARRAY_BUFFER, this.pulseData, gl.DYNAMIC_DRAW); for (let k = 0; k < 3; k++) attr(1 + k, 4, PSTRIDE * 4, k * 16, 1);
      // sprite'lar (takımyıldız, bağlam şeridi, kıvılcım)
      this.spriteN = this.cfg.V + 64 + 1; this.spriteData = new Float32Array(this.spriteN * 8);
      A.sprite = vao(); B.sprite = buf(gl.ARRAY_BUFFER, this.spriteData, gl.DYNAMIC_DRAW); attr(0, 4, 32, 0); attr(1, 4, 32, 16);
      { const r = mulberry(5), n = 260, d = new Float32Array(n * 8);
        for (let i = 0; i < n; i++) { const z = r() * 2 - 1, a = r() * TAU, q = Math.sqrt(1 - z * z); d[i * 8] = 0 + q * Math.cos(a) * 0.62; d[i * 8 + 1] = 1.28 + z * 0.62; d[i * 8 + 2] = q * Math.sin(a) * 0.62; d[i * 8 + 3] = 0.012 + r() * 0.01; d[i * 8 + 4] = 0.35; d[i * 8 + 5] = 0.7; d[i * 8 + 6] = 0.9; d[i * 8 + 7] = 0.10 + r() * 0.12; }
        A.halo = vao(); B.halo = buf(gl.ARRAY_BUFFER, d); attr(0, 4, 32, 0); attr(1, 4, 32, 16); this.haloN = n; }
      // dikkat yayları
      { const n = 2 * (ARC_SEG + 1), d = new Float32Array(n * 2);
        for (let s = 0; s <= ARC_SEG; s++) for (let k = 0; k < 2; k++) { d[(s * 2 + k) * 2] = s / ARC_SEG; d[(s * 2 + k) * 2 + 1] = k ? 1 : -1; }
        A.arc = vao(); B.arcV = buf(gl.ARRAY_BUFFER, d); attr(0, 2, 8, 0);
        B.arc = buf(gl.ARRAY_BUFFER, this.arcData, gl.DYNAMIC_DRAW); attr(1, 4, 32, 0, 1); attr(2, 4, 32, 16, 1); this.arcVerts = n; }
      // etiketler
      this.labCap = 4 * this.cfg.V + 260; this.labData = new Float32Array(this.labCap * 16);
      A.label = vao(); B.label = buf(gl.ARRAY_BUFFER, this.labData, gl.DYNAMIC_DRAW); for (let k = 0; k < 4; k++) attr(k, 4, 64, k * 16, 1);
      A.empty = vao();
      gl.bindVertexArray(null);
      // dokular
      const T = this.tex = {};
      T.glow = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, T.glow);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.glowW, this.glowH, 0, gl.RGBA, gl.FLOAT, this.glowArr);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._buildAtlas();
      this._rt = null; this._rtDirty = true; this._pulseFull = true; this._qs = [];
      this._checkGL('init');
    }
    _checkGL(where) { const e = this.gl.getError(); if (e !== 0 && !this._glErrReported) { this._glErrReported = true; throw new Error('Limon.Brain GL hatası 0x' + e.toString(16) + ' @' + where); } }

    _buildAtlas() {
      const gl = this.gl, V = this.cfg.V, cv = document.createElement('canvas'); cv.width = cv.height = 1024;
      const c = cv.getContext('2d'); c.clearRect(0, 0, 1024, 1024); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const fam = '"SF Pro Rounded","SF Pro Display",-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif';
      c.font = `600 44px ${fam}`;
      const cell = (i) => [(i % 16) * 64 + 32, ((i / 16) | 0) * 64 + 33];
      for (let i = 0; i < V; i++) {
        const ch = this.vocab[i], [cx, cy] = cell(i);
        if (ch === ' ') { c.lineWidth = 4; c.lineJoin = 'round'; c.beginPath(); c.moveTo(cx - 16, cy - 4); c.lineTo(cx - 16, cy + 9); c.lineTo(cx + 16, cy + 9); c.lineTo(cx + 16, cy - 4); c.stroke(); }
        else if (ch === '\n') { c.lineWidth = 4; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); c.moveTo(cx + 14, cy - 12); c.lineTo(cx + 14, cy + 4); c.lineTo(cx - 14, cy + 4); c.moveTo(cx - 6, cy - 4); c.lineTo(cx - 15, cy + 4); c.lineTo(cx - 6, cy + 12); c.stroke(); }
        else c.fillText(ch, cx, cy);
      }
      for (let d = 0; d < 11; d++) { const [cx, cy] = cell(V + d); c.fillText(d < 10 ? String(d) : '%', cx, cy); }
      const R0 = Math.ceil((V + 11) / 16), LH = 40, LF = 27;
      c.font = `600 ${LF}px ${fam}`; c.textAlign = 'left';
      const defs = [['in', 'OKUMA  ·  girdi harfleri'], ['out', 'KONUŞMA  ·  çıktı harfleri'], ['const', 'HARF TAKIMYILDIZI'], ['constSub', 'gömme uzayı  ·  PCA'], ['ctx', 'BAĞLAM  ·  dikkat yayları']];
      for (let l = 0; l < Math.min(this.cfg.L, 12); l++) defs.push(['layer' + l, 'KATMAN ' + (l + 1)]);
      this.lab = {}; const y0 = R0 * 64;
      defs.forEach((d, j) => {
        const cx = (j % 2) * 512, cy = y0 + (j >> 1) * LH; c.fillText(d[1], cx + 4, cy + LH / 2 + 1);
        const tw = Math.ceil(c.measureText(d[1]).width) + 8;
        this.lab[d[0]] = { u0: cx / 1024, v0: cy / 1024, du: tw / 1024, dv: LH / 1024, tw, th: LH, fs: LF };
      });
      this.glyphR0 = R0;
      const gl2 = this.gl, t = this.tex.atlas = gl2.createTexture(); gl2.bindTexture(gl2.TEXTURE_2D, t);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, cv);
      gl2.generateMipmap(gl2.TEXTURE_2D);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR_MIPMAP_LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
      this.atlasCanvas = cv;
    }

    _uploadEdges(base, count) {
      const gl = this.gl; if (!gl || this._lost || !this.buf) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.edge);
      gl.bufferSubData(gl.ARRAY_BUFFER, base * ESTRIDE * 4, this.E, base * ESTRIDE, count * ESTRIDE);
    }
    _flushRing(buffer, data, stride, pool, head, n) {
      const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (n >= pool) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); return; }
      const start = (head - n + pool) % pool;
      if (start + n <= pool) gl.bufferSubData(gl.ARRAY_BUFFER, start * stride * 4, data, start * stride, n * stride);
      else { const a = pool - start; gl.bufferSubData(gl.ARRAY_BUFFER, start * stride * 4, data, start * stride, a * stride); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, (n - a) * stride); }
    }

    _allocTargets() {
      const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
      const QL = [{ cap: 0.9e6, nb: 2 }, { cap: 1.9e6, nb: 3 }, { cap: 3.2e6, nb: 3 }][this._qLevel];
      this._ql = QL; this._pulseTarget = [60, 85, 110][this._qLevel];
      const s = Math.min(1, Math.sqrt(QL.cap / (W * H)));
      this.rtW = Math.max(64, Math.round(W * s)); this.rtH = Math.max(64, Math.round(H * s));
      if (this._rt) this._freeTargets();
      const mkT = (w, h) => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { const e = new Error('FBO eksik'); e.code = 'NO_FLOAT_RT'; throw e; }
        return { tex: t, fbo: f, w, h };
      };
      const rt = this._rt = { scene: mkT(this.rtW, this.rtH), lv: [], nb: QL.nb };
      for (let i = 0; i < QL.nb; i++) {
        const w = Math.max(2, Math.ceil(this.rtW / (2 << i))), h = Math.max(2, Math.ceil(this.rtH / (2 << i)));
        rt.lv.push({ a: mkT(w, h), b: mkT(w, h), w, h });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); this._rtDirty = false;
    }
    _freeTargets() {
      const gl = this.gl, rt = this._rt; if (!rt) return;
      const fr = (o) => { gl.deleteTexture(o.tex); gl.deleteFramebuffer(o.fbo); };
      fr(rt.scene); for (const l of rt.lv) { fr(l.a); fr(l.b); } this._rt = null;
    }

    // ---------------------------------------------------------------- kamera
    _updateCamera(dt) {
      const c = this.cam, o = this.opt;
      c.idle += dt;
      if (!this._drag) {
        if (c.resetting) {
          const k = 1 - Math.exp(-dt * 4.5); let dy = this.camDefault.yaw - c.yaw; dy -= TAU * Math.round(dy / TAU);
          c.yaw += dy * k; c.pitch += (this.camDefault.pitch - c.pitch) * k; c.zoom += (1 - c.zoom) * k;
          c.px -= c.px * k; c.py -= c.py * k; c.pz -= c.pz * k;
          if (Math.abs(dy) < 0.004 && Math.abs(c.pitch - this.camDefault.pitch) < 0.004 && Math.abs(c.zoom - 1) < 0.004) c.resetting = false;
        } else {
          c.yaw += c.yawV * dt; c.pitch += c.pitchV * dt; const dmp = Math.exp(-dt * 3.2); c.yawV *= dmp; c.pitchV *= dmp;
          if (o.autoRotate && c.idle > 2.5) c.yaw += 0.075 * dt * smooth01((c.idle - 2.5) / 2);
        }
      }
      c.pitch = clamp(c.pitch, -1.3, 1.3);
      const ty = (o.showLetters ? 1.72 : 0.86) + (o.showAttention ? -1.40 : -0.86), tyc = ty / 2, thh = ((o.showLetters ? 1.72 : 0.86) - (o.showAttention ? -1.40 : -0.86)) / 2;
      const kf = 1 - Math.exp(-dt * 3); c.frameY += (tyc - c.frameY) * kf; c.frameHH += (thh - c.frameHH) * kf;
      const ins = o.insets, W = this.cssW, H = this.cssH, aw = Math.max(80, W - ins.l - ins.r), ah = Math.max(80, H - ins.t - ins.b);
      const fov = 0.66, th = Math.tan(fov / 2), asp = W / H;
      const dv = c.frameHH * (H / ah) / th, dh = 1.72 * (W / aw) / (th * asp);
      const dist = 1.06 * Math.max(dv, dh) * c.zoom; this.camDist = dist;
      const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      const tx = c.px, tyy = c.frameY + c.py, tz = c.pz;
      const ex = tx + dist * cp * sy, ey = tyy + dist * sp, ez = tz + dist * cp * cy;
      this.eye[0] = ex; this.eye[1] = ey; this.eye[2] = ez;
      mat4LookAt(this.view, ex, ey, ez, tx, tyy, tz);
      mat4Perspective(this.proj, fov, asp, 0.1, 60, -(ins.l - ins.r) / W, -(ins.b - ins.t) / H);
      mat4Mul(this.vp, this.proj, this.view);
      this._axial = Math.abs(ex - tx) / dist; this._fov = fov; this._th = th;
    }

    _bindInput() {
      const cv = this.canvas, self = this, c = this.cam, ptrs = new Map(); this._on = [];
      const on = (t, f, o) => { cv.addEventListener(t, f, o); this._on.push([t, f, o]); };
      cv.style.touchAction = 'none';
      let mode = 0, lx = 0, ly = 0, pd = 0, pmx = 0, pmy = 0, lt = 0;
      const pan = (dx, dy) => {
        const k = 2 * self.camDist * self._th / self.cssH, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
        c.px += (-cy * dx + (-sp * sy) * dy) * k; c.py += (cp * dy) * k; c.pz += (sy * dx + (-sp * cy) * dy) * k; c.resetting = false;
      };
      on('pointerdown', (e) => {
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* yok say */ }
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        c.idle = 0; c.resetting = false; self._drag = true;
        if (ptrs.size === 2) { const a = [...ptrs.values()]; pd = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); pmx = (a[0].x + a[1].x) / 2; pmy = (a[0].y + a[1].y) / 2; mode = 3; }
        else { mode = (e.button === 2 || e.shiftKey || e.ctrlKey) ? 2 : 1; lx = e.clientX; ly = e.clientY; lt = performance.now(); c.yawV = c.pitchV = 0; }
        e.preventDefault();
      });
      on('pointermove', (e) => {
        const p = ptrs.get(e.pointerId); if (!p) return; c.idle = 0;
        if (mode === 3 && ptrs.size >= 2) {
          p.x = e.clientX; p.y = e.clientY; const a = [...ptrs.values()];
          const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
          if (pd > 0 && d > 0) c.zoom = clamp(c.zoom * pd / d, 0.18, 3); pd = d; pan(mx - pmx, my - pmy); pmx = mx; pmy = my;
        } else if (mode === 1) {
          const dx = e.clientX - lx, dy = e.clientY - ly, now = performance.now(), dt = Math.max(1, now - lt) / 1000; lx = e.clientX; ly = e.clientY; lt = now;
          c.yaw -= dx * 0.0055; c.pitch += dy * 0.0055;
          c.yawV += (-dx * 0.0055 / dt - c.yawV) * 0.5; c.pitchV += (dy * 0.0055 / dt - c.pitchV) * 0.5;
        } else if (mode === 2) { const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; pan(dx, dy); }
      });
      const up = (e) => {
        ptrs.delete(e.pointerId); try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* yok say */ }
        if (ptrs.size === 0) { self._drag = false; mode = 0; if (performance.now() - lt > 90) { c.yawV = c.pitchV = 0; } c.idle = 0; }
        else if (ptrs.size === 1) { const a = [...ptrs.values()][0]; lx = a.x; ly = a.y; mode = 1; c.yawV = c.pitchV = 0; }
      };
      on('pointerup', up); on('pointercancel', up);
      on('wheel', (e) => { e.preventDefault(); const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; c.zoom = clamp(c.zoom * Math.exp(e.deltaY * k * 0.0012), 0.18, 3); c.idle = 0; c.resetting = false; }, { passive: false });
      on('dblclick', () => { self.resetCamera(); });
      on('contextmenu', (e) => e.preventDefault());
      on('webglcontextlost', (e) => { e.preventDefault(); self._lost = true; });
      on('webglcontextrestored', () => { try { self._initGL(); self._uploadEdges(0, self.nSlots); } catch (err) { self._lost = true; } });
    }

    // ---------------------------------------------------------------- kare başına iş
    _autoQuality(dt) {
      if (this.opt.quality !== 'auto') { const m = { low: 0, medium: 1, high: 2 }[this.opt.quality]; if (m != null && m !== this._qLevel) { this._qLevel = m; this._rtDirty = true; } return; }
      this._qEma += (dt * 1000 - this._qEma) * 0.03; this._qT += dt;
      if (this._qT > 4 && this._qLevel > 0 && this._qEma > 27 && this.now > 6) { this._qLevel--; this._qT = 0; this._rtDirty = true; this._qEma = 16.7; }
    }

    _accumulateGlow(now) {
      const g = this.glowArr, sd = this.slabDelay, st = this.slabStart, nS = this.nSlabs, sg = this.slabGlow;
      g.fill(0);
      for (let wi = 0; wi < WAVE_POOL; wi++) {
        const w = this.waves[wi]; if (!w.used) continue;
        if (now - w.t0 > 1.4 + sd[nS - 1]) { w.used = false; continue; }
        const act = w.act;
        for (let s = 0; s < nS; s++) {
          const dt = now - (w.t0 + sd[s]); if (dt < 0 || dt > 1.4) continue;
          const k = (1 - Math.exp(-dt / 0.03)) * Math.exp(-dt / 0.13) * 1.6; if (k < 0.004) continue;
          for (let i = st[s], e = st[s + 1]; i < e; i++) { const a = act[i]; if (a > 0) g[i * 4] += a * k; else if (a < 0) g[i * 4 + 1] -= a * k; }
        }
      }
      for (let s = 0; s < nS; s++) {
        let sum = 0; const e = st[s + 1];
        for (let i = st[s]; i < e; i++) { let a = g[i * 4], b = g[i * 4 + 1]; a = g[i * 4] = 1 - Math.exp(-1.3 * a); b = g[i * 4 + 1] = 1 - Math.exp(-1.3 * b); sum += a + b; }
        sg[s] = sum / Math.max(1, e - st[s]) * 2.2;
      }
    }

    _lab(x, y, z, a, u0, v0, du, dv, w, h, ox, oy, r, g, b, sf) {
      if (this._ln >= this.labCap) return; const d = this.labData, o = this._ln++ * 16;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = a; d[o + 4] = u0; d[o + 5] = v0; d[o + 6] = du; d[o + 7] = dv;
      d[o + 8] = w; d[o + 9] = h; d[o + 10] = ox; d[o + 11] = oy; d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = sf;
    }
    _glyph(i, x, y, z, a, px, ox, oy, r, g, b, sf) {
      const s = px * 64 / 44; this._lab(x, y, z, a, (i % 16) / 16, ((i / 16) | 0) * 64 / 1024, 1 / 16, 64 / 1024, s, s, ox, oy, r, g, b, sf);
    }
    _text(name, x, y, z, a, fontPx, align, oy, r, g, b) {
      const L = this.lab[name]; if (!L) return; const s = fontPx / L.fs, w = L.tw * s, h = L.th * s;
      this._lab(x, y, z, a, L.u0, L.v0, L.du, L.dv, w, h, align === 0 ? 0 : align > 0 ? w / 2 : -w / 2, oy, r, g, b, 0);
    }

    _buildDynamic(now, dt) {
      const { V, L } = this.cfg, S = this.S, st = this.slabStart, glow = this.glowArr, o = this.opt, np = this.nPos;
      // --- son gelen dalganın olasılıkları (çıkış harfi etiketleri için yumuşatılmış)
      const dOut = this.slabDelay[S.OUT]; let best = null, bt = this._lastArrive;
      for (let i = 0; i < WAVE_POOL; i++) { const w = this.waves[i]; if (!w.used) continue; const ta = w.t0 + dOut; if (ta <= now && ta > bt) { bt = ta; best = w; } }
      if (best) { this._lastArrive = bt; this._arrProbs = best.probs; }
      const ks = 1 - Math.exp(-dt / 0.22), pr = this._arrProbs, os = this.outSm;
      for (let v = 0; v < V; v++) os[v] += ((pr ? pr[v] : 0) - os[v]) * ks;
      const top = this.top; for (let r = 0; r < 3; r++) { top[r].p = -1; top[r].id = 0; }
      for (let v = 0; v < V; v++) {
        const p = os[v];
        if (p > top[2].p) { if (p > top[1].p) { top[2].p = top[1].p; top[2].id = top[1].id; if (p > top[0].p) { top[1].p = top[0].p; top[1].id = top[0].id; top[0].p = p; top[0].id = v; } else { top[1].p = p; top[1].id = v; } } else { top[2].p = p; top[2].id = v; } }
      }
      // --- takımyıldız yumuşak hareket
      const kp = 1 - Math.exp(-dt * 2.5), pc = this.pcaCur, pt = this.pcaTgt; for (let i = 0; i < V * 3; i++) pc[i] += (pt[i] - pc[i]) * kp;
      this.curPosSm += (this.curPos - this.curPosSm) * (1 - Math.exp(-dt * 14));
      // --- sprite'lar
      const sp = this.spriteData, C0 = 0, C1 = 1.28, C2 = 0, R = 0.42, lc = this.letterCol; let q = 0;
      const showL = o.showLetters ? 1 : 0, bf = smooth01((this.uBirth - 0.6) / 0.4);
      for (let v = 0; v < V; v++, q += 8) {
        const gw = Math.min(1.4, glow[(st[S.IN] + v) * 4]);
        sp[q] = C0 + R * pc[v * 3]; sp[q + 1] = C1 + R * pc[v * 3 + 1]; sp[q + 2] = C2 + R * pc[v * 3 + 2]; sp[q + 3] = 0.030 * (1 + 1.6 * gw);
        sp[q + 4] = lc[v * 3]; sp[q + 5] = lc[v * 3 + 1]; sp[q + 6] = lc[v * 3 + 2]; sp[q + 7] = showL * bf * (0.55 + 1.6 * gw);
      }
      const sX = 1.05, spc = 0.034, sY = -1.08, base = Math.floor(this.curPosSm), showA = o.showAttention ? 1 : 0;
      for (let k = 0; k < 64; k++, q += 8) {
        const p = base - k, ok = p >= 0 && this.ctxTok[p] >= 0;
        sp[q] = sX - (this.curPosSm - p) * spc; sp[q + 1] = sY; sp[q + 2] = 0; sp[q + 3] = p === this.curPos ? 0.028 : 0.012;
        const fade = 1 - smooth01((k - 44) / 20);
        sp[q + 4] = p === this.curPos ? 1 : 0.35; sp[q + 5] = p === this.curPos ? 0.9 : 0.75; sp[q + 6] = p === this.curPos ? 0.3 : 0.95; sp[q + 7] = ok ? showA * bf * fade * (p === this.curPos ? 1.4 : 0.55) : 0;
      }
      const age = now - this.sparkT0;
      sp[q] = 0; sp[q + 1] = 0.03; sp[q + 2] = 0; sp[q + 3] = 0.06 + 0.7 * Math.exp(-age * 1.5); sp[q + 4] = 1; sp[q + 5] = 0.95; sp[q + 6] = 0.6; sp[q + 7] = age < 4 ? 3.0 * Math.exp(-age * 1.3) : 0;
      // --- etiketler
      this._ln = 0; const lf = smooth01((this.uBirth - 0.55) / 0.35); if (lf <= 0.001) return;
      const pan = this.panel, gz = 0, dz = this.camDist;
      const zoomA = clamp(1.6 - dz * 0.16, 0.5, 1.15);
      for (let v = 0; v < V; v++) { // girdi harfleri
        const n = (st[S.IN] + v), gw = Math.min(1.5, glow[n * 4]), a = (0.30 + 0.95 * gw) * lf * zoomA, l = this.vocab.charCodeAt(v);
        const t = Math.min(1, gw);
        this._glyph(v, np[n * 3], np[n * 3 + 1], np[n * 3 + 2], a, 12.5 + 9 * t, 0, 0, 0.72 + 0.28 * t, 0.86 + 0.09 * t, 0.98 - 0.4 * t, 1);
      }
      for (let v = 0; v < V; v++) { // çıktı harfleri
        const n = (st[S.OUT] + v), gw = Math.min(1.5, glow[n * 4]), t = Math.min(1, gw);
        let rank = -1; for (let r = 0; r < 3; r++) if (top[r].id === v && top[r].p > 0.015) rank = r;
        const a = ((0.28 + 0.9 * gw) * zoomA + (rank >= 0 ? 0.55 : 0)) * lf;
        const px = 12.5 + 8 * t + (rank >= 0 ? (rank === 0 ? 11 : rank === 1 ? 8 : 5) : 0);
        this._glyph(v, np[n * 3], np[n * 3 + 1], np[n * 3 + 2], Math.min(1.4, a), px, 0, 0, 0.75 + 0.25 * t, 0.9, 0.9 - 0.35 * t, 1);
        if (rank >= 0) {
          const pct = Math.max(1, Math.round(top[rank].p * 100)), s = String(pct); let ox = px * 0.5 + 8;
          for (let k = 0; k < s.length; k++) { this._glyph(V + (s.charCodeAt(k) - 48), np[n * 3], np[n * 3 + 1], np[n * 3 + 2], 0.9 * lf, 10.5, ox + 4, 0, 1, 0.95, 0.6, 1); ox += 6.2; }
          this._glyph(V + 10, np[n * 3], np[n * 3 + 1], np[n * 3 + 2], 0.9 * lf, 10.5, ox + 4, 0, 1, 0.95, 0.6, 1);
        }
      }
      if (o.showLetters) { // takımyıldız harfleri
        for (let v = 0; v < V; v++) {
          const gw = Math.min(1.4, glow[(st[S.IN] + v) * 4]), t = Math.min(1, gw), r0 = v * 3;
          this._glyph(v, C0 + R * pc[r0], C1 + R * pc[r0 + 1], C2 + R * pc[r0 + 2], (0.80 + 0.5 * gw) * lf, 14 + 7 * t, 0, 11 + 4 * t, lc[r0] * 0.7 + 0.3, lc[r0 + 1] * 0.7 + 0.3, lc[r0 + 2] * 0.7 + 0.3, 1);
        }
        this._text('const', C0, C1 + R + 0.16, 0, 0.62 * lf, 12.5, 0, 0, 1, 0.95, 0.6);
        this._text('constSub', C0, C1 + R + 0.16, 0, 0.38 * lf, 10.5, 0, -15, 0.7, 0.85, 1);
      }
      if (o.showAttention) { // bağlam şeridi harfleri
        for (let k = 0; k < 64; k++) {
          const p = base - k; if (p < 0) break; const tk = this.ctxTok[p]; if (tk < 0) continue;
          const fade = 1 - smooth01((k - 44) / 20), cur = p === this.curPos;
          this._glyph(tk, sX - (this.curPosSm - p) * spc, sY, 0, (cur ? 1.2 : 0.75) * fade * lf, cur ? 17 : 13, 0, -14, cur ? 1 : 0.85, cur ? 0.95 : 0.92, cur ? 0.55 : 0.95, 0);
        }
        this._text('ctx', sX - 63 * spc - 0.02, sY, 0, 0.6 * lf, 12, -1, 0, 0.6, 0.85, 1);
      }
      const py = 0.05 + (pan.rows / 2) * pan.sp + 0.12;
      this._text('in', -1.45, py, 0, 0.62 * lf, 12, 0, 8, 0.75, 0.9, 1);
      this._text('out', 1.45, py, 0, 0.62 * lf, 12, 0, 8, 1, 0.95, 0.6);
      for (let l = 0; l < Math.min(L, 12); l++) this._text('layer' + l, (this.slabX[S.head(l)] + this.slabX[S.xout(l)]) / 2, 0.80, 0, 0.5 * lf, 11.5, 0, 0, 0.75, 0.95, 0.85);
    }

    _com(pr, now) {
      const gl = this.gl, u = pr.u;
      gl.uniformMatrix4fv(u.uVP, false, this.vp); gl.uniform1f(u.uTime, now); gl.uniform1f(u.uPxScale, this.rtH / (2 * this._th));
      gl.uniform1f(u.uDist, this.camDist); gl.uniform1f(u.uWarm, this.warm); gl.uniform1f(u.uJit, this.jit); gl.uniform1f(u.uBirth, this.uBirth);
      gl.uniform3f(u.uOrigin, 0, 0.03, 0); gl.uniform1f(u.uWaveX, this._waveX); gl.uniform1f(u.uWaveA, this._waveA);
      gl.uniform1f(u.uRtScale, this.rtW / this.cssW); gl.uniform1f(u.uAxial, this._axial); gl.uniform2f(u.uRes, this.rtW, this.rtH);
    }

    _draw(now) {
      const gl = this.gl, cv = this.canvas, cw = cv.width, ch = cv.height, o = this.opt, P = this.prog, A = this.vao, T = this.tex;
      if (this._rtDirty || !this._rt) this._allocTargets();
      const rt = this._rt, nb = rt.nb;
      let tq = null;
      if (this._gpuTimingOn && this.timerExt) {
        while (this._qs.length) {
          const q = this._qs[0];
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
          const dis = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
          if (!dis) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.perf.gpu += (ms - this.perf.gpu) * 0.1; this.perf.gpuMax = Math.max(this.perf.gpuMax || 0, ms); }
          gl.deleteQuery(q); this._qs.shift();
        }
        if (this._qs.length < 6) { tq = gl.createQuery(); gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, tq); }
      }
      // yüklemeler
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.glow);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.glowW, this.glowH, gl.RGBA, gl.FLOAT, this.glowArr);
      if (this.pulseDirtyN > 0) { this._flushRing(this.buf.pulse, this.pulseData, PSTRIDE, PULSE_POOL, this.pulseHead, this._pulseFull ? PULSE_POOL : this.pulseDirtyN); this.pulseDirtyN = 0; this._pulseFull = false; }
      if (this.arcDirtyN > 0) { this._flushRing(this.buf.arc, this.arcData, 8, ARC_POOL, this.arcHead, this.arcDirtyN); this.arcDirtyN = 0; }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.sprite); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.spriteData);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.label); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.labData, 0, this._ln * 16);
      // sahne
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.scene.fbo); gl.viewport(0, 0, this.rtW, this.rtH); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      let pr = P.dust; gl.useProgram(pr.p); this._com(pr, now); gl.bindVertexArray(A.dust); gl.drawArrays(gl.POINTS, 0, 2600);
      const dbg = this._dbg || {};
      if (!dbg.noShell) { pr = P.shell; gl.useProgram(pr.p); this._com(pr, now); gl.uniform3fv(pr.u.uEye, this.eye); gl.uniform1fv(pr.u.uSlab, this.slabGlow); gl.uniform1f(pr.u.uNSlab, this.nSlabs);
      gl.bindVertexArray(A.shell); gl.uniform1f(pr.u.uPart, 0); gl.uniform1f(pr.u.uShellA, 1); gl.drawElements(gl.TRIANGLES, this.shellHemiCount, gl.UNSIGNED_SHORT, 0);
      gl.uniform1f(pr.u.uPart, 1); gl.drawElements(gl.TRIANGLES, this.shellCount - this.shellHemiCount, gl.UNSIGNED_SHORT, this.shellHemiCount * 2); }
      const hc = this._headCols || (this._headCols = new Float32Array(24)); for (let i = 0; i < 24; i++) hc[i] = HEAD_COLS[(i / 3) | 0][i % 3];
      if (o.showSynapses && !dbg.noEdges) {
        pr = P.edge; gl.useProgram(pr.p); this._com(pr, now); gl.uniform1i(pr.u.uGlow, 0); gl.uniform1f(pr.u.uGlowW, this.glowW);
        gl.bindVertexArray(A.edge); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.edgeVerts, this.nSlots);
        if (!dbg.noPulse) { pr = P.pulse; gl.useProgram(pr.p); this._com(pr, now); gl.bindVertexArray(A.pulse); gl.drawArraysInstanced(gl.POINTS, 0, 4, PULSE_POOL); }
      }
      if (!dbg.noNeurons) { pr = P.neuron; gl.useProgram(pr.p); this._com(pr, now); gl.uniform1i(pr.u.uGlow, 0); gl.uniform1f(pr.u.uGlowW, this.glowW); gl.uniform3fv(pr.u.uHead, hc);
      gl.bindVertexArray(A.neuron); gl.drawArrays(gl.POINTS, 0, this.NN); }
      pr = P.sprite; gl.useProgram(pr.p); this._com(pr, now);
      if (o.showLetters) { gl.bindVertexArray(A.halo); gl.drawArrays(gl.POINTS, 0, this.haloN); }
      gl.bindVertexArray(A.sprite); gl.drawArrays(gl.POINTS, 0, this.spriteN);
      if (o.showAttention) {
        pr = P.arc; gl.useProgram(pr.p); this._com(pr, now); gl.uniform3fv(pr.u.uHead, hc);
        gl.uniform1f(pr.u.uCurPos, this.curPosSm); gl.uniform1f(pr.u.uSpacing, 0.034); gl.uniform1f(pr.u.uStripX, 1.05); gl.uniform1f(pr.u.uStripY, -1.08);
        gl.bindVertexArray(A.arc); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.arcVerts, ARC_POOL);
      }
      // bloom
      gl.disable(gl.BLEND); gl.bindVertexArray(A.empty);
      pr = P.down; gl.useProgram(pr.p); gl.uniform1i(pr.u.uTex, 0);
      for (let i = 0; i < nb; i++) {
        const lv = rt.lv[i], src = i === 0 ? rt.scene : rt.lv[i - 1].a;
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv.a.fbo); gl.viewport(0, 0, lv.w, lv.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform2f(pr.u.uTexel, 1 / src.w, 1 / src.h); gl.uniform1f(pr.u.uThresh, i === 0 ? 0.35 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      pr = P.blur; gl.useProgram(pr.p); gl.uniform1i(pr.u.uTex, 0);
      for (let i = 0; i < nb; i++) {
        const lv = rt.lv[i]; gl.viewport(0, 0, lv.w, lv.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv.b.fbo); gl.bindTexture(gl.TEXTURE_2D, lv.a.tex); gl.uniform2f(pr.u.uDir, 1 / lv.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv.a.fbo); gl.bindTexture(gl.TEXTURE_2D, lv.b.tex); gl.uniform2f(pr.u.uDir, 0, 1 / lv.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // birleştirme
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cw, ch);
      pr = P.comp; gl.useProgram(pr.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rt.scene.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rt.lv[0].a.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, rt.lv[1].a.tex);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, (rt.lv[2] || rt.lv[1]).a.tex);
      gl.uniform1i(pr.u.uScene, 0); gl.uniform1i(pr.u.uB0, 1); gl.uniform1i(pr.u.uB1, 2); gl.uniform1i(pr.u.uB2, 3);
      gl.uniform3f(pr.u.uBW, 0.32, 0.36, nb > 2 ? 0.40 : 0); gl.uniform2f(pr.u.uCanvas, cw, ch); gl.uniform1f(pr.u.uTime, now);
      gl.uniform1f(pr.u.uJit, this.jit); gl.uniform1f(pr.u.uWarm, this.warm); gl.uniform1f(pr.u.uBloom, dbg.noBloom ? 0 : 0.8); gl.uniform1f(pr.u.uExposure, 0.62);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      // etiketler (netlik için doğrudan ekrana)
      if (this._ln > 0) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        pr = P.label; gl.useProgram(pr.p); gl.uniformMatrix4fv(pr.u.uVP, false, this.vp); gl.uniform2f(pr.u.uCanvas, cw, ch);
        gl.uniform1f(pr.u.uDist, this.camDist); gl.uniform1f(pr.u.uDpr, cw / this.cssW); gl.bindTexture(gl.TEXTURE_2D, T.atlas); gl.uniform1i(pr.u.uAtlas, 0);
        gl.bindVertexArray(A.label); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this._ln);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
      if (tq) { gl.endQuery(this.timerExt.TIME_ELAPSED_EXT); this._qs.push(tq); }
    }

    render(t) {
      if (this._lost || !this.gl) return;
      const p0 = performance.now();
      if (this._t0 === null) this._t0 = t;
      const now = t - this._t0; let dt = this._lastT === null ? 1 / 60 : now - this._lastT; this._lastT = now; dt = clamp(dt, 0.001, 0.1);
      this.now = now;
      if (this.birthReq) { this.birthReq = false; this.birthT0 = now; this.birthDone = false; this.sparkT0 = now; }
      if (!this.birthDone) { const age = now - this.birthT0; this.uBirth = age / 2.6; if (age > 4.4) { this.birthDone = true; this.uBirth = 9; } }
      const kw = 1 - Math.exp(-dt / 1.2); this.warm += (this.warmT - this.warm) * kw; this.jit += (this.jitT - this.jit) * kw;
      const wa = now - this.stageT0; this._waveX = -1.5 + wa / 1.3 * 3.0; this._waveA = wa >= 0 && wa < 1.7 ? (1 - wa / 1.7) * 0.9 : 0;
      this._autoQuality(dt);
      this._updateCamera(dt);
      this._runJobs(2.5);
      this._accumulateGlow(now);
      this._buildDynamic(now, dt);
      this._draw(now);
      const ms = performance.now() - p0, pf = this.perf;
      pf.cpu += (ms - pf.cpu) * 0.05; pf.cpuMax = Math.max(pf.cpuMax * 0.995, ms); pf.frames++;
    }

    dispose() {
      if (this._disposed) return; this._disposed = true;
      const cv = this.canvas; for (const [t, f, o] of this._on) cv.removeEventListener(t, f, o); this._on = [];
      const gl = this.gl;
      if (gl && !this._lost) {
        this._freeTargets();
        for (const k in this.buf) gl.deleteBuffer(this.buf[k]); for (const k in this.vao) gl.deleteVertexArray(this.vao[k]);
        for (const k in this.tex) gl.deleteTexture(this.tex[k]); for (const k in this.prog) gl.deleteProgram(this.prog[k].p);
        const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      }
      this.gl = null;
    }
  }

  function makeProgram(gl, vs, fs, name) {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Limon.Brain shader (' + name + ') ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram(), v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Limon.Brain link (' + name + ') ' + gl.getProgramInfoLog(p));
    gl.deleteShader(v); gl.deleteShader(f);
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const inf = gl.getActiveUniform(p, i), nm = inf.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, inf.name); }
    return { p, u };
  }

  Limon.Brain = Brain;

  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
