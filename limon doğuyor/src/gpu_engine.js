// Limon.GPU — ham WebGL2 eğitim motoru (kütüphane yok). Limon.GPU.Trainer + Limon.GPU.supported()
//
// TASARIM ÖZETİ (kendi kararlarım; SPEC §3/§4.2'yi uygular)
//  * Her tensör RGBA32F dokusudur, dört değer bir texel'de paketlidir (dot4/vec4 matmul çekirdekleri, skaler R32F'e göre 2-4x hızlı).
//    Satırlar 4'ün katına doldurulur (D, FF, V, T "p" boyutları); doldurma sütunları/satırları HER ZAMAN tam 0 kalır
//    (ağırlık doldurması 0, gradyan doldurması 0 → AdamW 0'da kalır), bu yüzden matmul'lar doldurmayı görmezden gelir.
//    qkv sütunları [Q|K|V] üç bloktur ve her blok Dp genişliğindedir (qkv.w: Dp x 3Dp).
//  * Parametreler, Adam m/v ve gradyan G: "atlas" dokularıdır (aynı boyut/aynı yerleşim). Her tensör atlasta (x0,y0,cols4,rows)
//    dikdörtgenidir; "W ve hemen ardından bias'ı" ya da "LN g ve hemen ardından b" bitişik tutulur ki tek geçişle yazılabilsin.
//    Böylece her geçiş gradyanını doğrudan atlas dikdörtgenine yazar; global norm ve AdamW atlasın üstünde TEK geçiştir.
//  * Kullanıcı düzeni (Limon.Layout) ↔ atlas dönüşümü yalnızca init/loadWeights/readWeights'ta (CPU'da) yapılır.
//  * Adım = ~150 tam ekran üçgen geçişi. Hiçbir uniform adım başına değişmez: adım başına değişen her şey (x,y, lr, Adam düzeltmeleri,
//    halka yuvası, kimlik-sıralama listeleri) tek bir R32I "ids" dokusuna tek texSubImage2D ile yüklenir (8'li halka).
//    Geçiş listeleri kurulum sırasında hazırlanır; step() yalnızca listeyi koşar (texture/FBO/program YARATMAZ, getError/finish/readPixels YOK).
//  * Ağırlık dokuları ping-pong (Adam farklı dokuya yazar) → iki parite için iki geçiş listesi.
//  * Dikkat: skorlar S[n][h][j] saklanır, softmax normalizasyonu lse[n][h] ile (P = exp(S-lse) anında hesaplanır).
//  * Tied embedding gradyanı atomiksiz: CPU her adım token→konum listesini sayma sıralamasıyla çıkarır (N+V işlem), GPU her (v,d) için
//    o token'ı kullanan satırları toplar. Ayrıca logits geri katkısı normal bir dW (Aᵀ·B) geçişidir.
//  * Ek yardımcılar (SPEC dışı): tr.debugForward, tr.debugGrad, tr.profile, tr.info.*, tr.cpuMs (yalnızca test/ayar için).
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});
  const GPU = (Limon.GPU = Limon.GPU || {});

  const IDW = 1024;            // ids dokusu genişliği (texel)
  const CTL_N = 16;            // ids[0..15] kontrol alanı (float bitleri + tamsayılar)
  const RING = 256;            // kayıp/gradNorm halka doku yuvaları
  const IDS_RING = 8;          // ids doku halkası
  const GEN_TARGET_FRAGS = 32768; // dW için hedef parça sayısı (split-K seçimi)

  // ------------------------------------------------------------------------------------------- shader kaynakları
  const VS = '#version 300 es\nvoid main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }\n';

  // Ortak başlık. FT(t,x,y)=texelFetch. PX = parçanın viewport'a göre yerel (x,y) koordinatı (U[0].xy = viewport başlangıcı).
  const FS_HEAD = `
precision highp float; precision highp int; precision highp sampler2D; precision highp isampler2D;
uniform sampler2D T0,T1,T2,T3,T4,T5,T6,T7;
uniform isampler2D TI;
uniform ivec4 U[6];
layout(location=0) out vec4 o0;
#if NOUT>=2
layout(location=1) out vec4 o1;
#endif
#if NOUT>=3
layout(location=2) out vec4 o2;
#endif
#define FT(t,x,y) texelFetch(t,ivec2(x,y),0)
#define PX (ivec2(gl_FragCoord.xy)-U[0].xy)
#define ID(i) texelFetch(TI,ivec2((i)&1023,(i)>>10),0).r
#define CTL(k) intBitsToFloat(ID(k))
#define NEG (-1e30)
#define LANE(c4) (vec4(float(4*(c4)))+vec4(0.,1.,2.,3.))
vec4 tanhv(vec4 z){ vec4 e=exp(-2.0*abs(z)); vec4 t=(1.0-e)/(1.0+e); return mix(t,-t,lessThan(z,vec4(0.0))); }
vec4 gelu(vec4 u){ vec4 z=0.7978845608028654*(u+0.044715*u*u*u); return 0.5*u*(1.0+tanhv(z)); }
vec4 geluD(vec4 u){ vec4 uu=u*u; vec4 z=0.7978845608028654*(u+0.044715*uu*u); vec4 t=tanhv(z);
  return 0.5*(1.0+t)+0.5*u*(1.0-t*t)*0.7978845608028654*(1.0+0.134145*uu); }
float g1(sampler2D t,int row,int col){ return texelFetch(t,ivec2(col>>2,row),0)[col&3]; }
`;

  const KS = {};

  // h0[n] = tok[x[n]] + pos[n mod T]        T0=P atlas ; U1=(tok.x,tok.y,pos.x,pos.y)
  KS.embed = `
void main(){ ivec2 p=PX; int id=ID(C_X0+p.y);
  o0=FT(T0,U[1].x+p.x,U[1].y+id)+FT(T0,U[1].z+p.x,U[1].w+(p.y%C_T)); }`;

  // LayerNorm satır istatistikleri: T0=X[N,D4] -> [1,N] = (mean, rstd)
  KS.lnStats = `
void main(){ int n=PX.y; float s=0.0;
  for(int i=0;i<C_D4;i++){ vec4 v=FT(T0,i,n); s+=v.x+v.y+v.z+v.w; }
  float mean=s/float(C_D); float q=0.0;
  for(int i=0;i<C_D4;i++){ vec4 d=FT(T0,i,n)-vec4(mean);
#if DPAD
    d*=vec4(lessThan(LANE(i),vec4(float(C_D))));
#endif
    q+=dot(d,d); }
  o0=vec4(mean,inversesqrt(q/float(C_D)+1e-5),0.0,0.0); }`;

  // LN uygula: T0=X, T1=stats, T2=P ; U1=(g.x,g.y,b.x,b.y)
  KS.lnApply = `
void main(){ ivec2 p=PX; vec2 st=FT(T1,0,p.y).xy;
  o0=(FT(T0,p.x,p.y)-vec4(st.x))*st.y*FT(T2,U[1].x+p.x,U[1].y)+FT(T2,U[1].z+p.x,U[1].w); }`;

  // C = A·W (+bias) [+residual | +gelu(MRT)]   T0=A[N,K4], T1=W atlas, T2=residual ; U1=(w.x,w.y,b.x,b.y)
  KS.mm = `
void main(){ ivec2 p=PX; int wx=U[1].x+p.x; int wy=U[1].y; vec4 s=vec4(0.0);
  for(int k=0;k<C_K4;k++){ vec4 a=FT(T0,k,p.y);
    s+=a.x*FT(T1,wx,wy)+a.y*FT(T1,wx,wy+1)+a.z*FT(T1,wx,wy+2)+a.w*FT(T1,wx,wy+3); wy+=4; }
#if BIAS
  s+=FT(T1,U[1].z+p.x,U[1].w);
#endif
#if EPI==1
  s+=FT(T2,p.x,p.y);
#endif
  o0=s;
#if EPI==2
  o1=gelu(s);
#endif
}`;

  // C = dC·Wᵀ  (W[K rows][M cols]; C[n][k] = Σ_m dC[n][m] W[k][m])   T0=dC[N,M4], T1=W atlas, T2=u (gelu' için) ; U1=(w.x,w.y)
  KS.mt = `
void main(){ ivec2 p=PX; int wy=U[1].y+4*p.x; int wx=U[1].x; vec4 s=vec4(0.0);
  for(int m=0;m<C_M4;m++){ vec4 c=FT(T0,m,p.y);
    s.x+=dot(c,FT(T1,wx+m,wy)); s.y+=dot(c,FT(T1,wx+m,wy+1)); s.z+=dot(c,FT(T1,wx+m,wy+2)); s.w+=dot(c,FT(T1,wx+m,wy+3)); }
#if EPI==3
  s*=geluD(FT(T2,p.x,p.y));
#endif
  o0=s; }`;

  // dW = Aᵀ·dC (+ bias satırı = Σ dC). Parça (m4, s*RT+k): bölüm s, satır k.   T0=A[N,KA4], T1=dC[N,M4] ; U1=(RT,Kp,chunk,0)
  KS.dw = `
void main(){ ivec2 p=PX; int RT=U[1].x; int s=p.y/RT; int k=p.y-s*RT; int chunk=U[1].z;
  int n0=s*chunk; int n1=min(n0+chunk,C_N); vec4 acc=vec4(0.0);
  if(k<U[1].y){ int kc=k>>2; int kq=k&3; for(int n=n0;n<n1;n++) acc+=FT(T0,kc,n)[kq]*FT(T1,p.x,n); }
  else {
#if KBZ
    // K bloğunun bias gradyanı matematiksel olarak tam 0 (softmax, tüm anahtarlara eklenen sabite duyarsız); yuvarlama gürültüsünü
    // Adam'ın m/(sqrt(v)+eps) oranı büyütmesin diye tam 0 yazılır.
    if(p.x>=C_D4 && p.x<2*C_D4) { o0=vec4(0.0); return; }
#endif
    for(int n=n0;n<n1;n++) acc+=FT(T1,p.x,n); }
  o0=acc; }`;

  // bölümleri topla (+ tok için embedding gather).  T0=partial[M4, S*RT], T1=dh0[N,D4] ; U1=(RT,S)
  KS.dwSum = `
void main(){ ivec2 p=PX; int RT=U[1].x; int S=U[1].y; vec4 a=vec4(0.0);
  for(int s=0;s<S;s++) a+=FT(T0,p.x,s*RT+p.y);
#if TOK
  int st=ID(C_ST0+p.y); int en=ID(C_ST0+p.y+1);
  for(int j=st;j<en;j++) a+=FT(T1,p.x,ID(C_LS0+j));
#endif
  o0=a; }`;

  // dpos[t] = Σ_b dh0[b*T+t]      T0=dh0
  KS.posGrad = `
void main(){ ivec2 p=PX; vec4 a=vec4(0.0); for(int b=0;b<C_B;b++) a+=FT(T0,p.x,b*C_T+p.y); o0=a; }`;

  // ---- dikkat ----
  // skorlar: T0=qkv -> S[N, H*T4]   (4 anahtar/parça)
  KS.attS = `
void main(){ ivec2 p=PX; int n=p.y; int h=p.x/C_T4; int j4=p.x-h*C_T4; int b=n/C_T; int i=n-b*C_T;
#if DHV4
  if(j4*4>i){ o0=vec4(NEG); return; }
  int qc=h*C_DH4; int kc=C_D4+qc; int kr=b*C_T+j4*4; vec4 s=vec4(0.0);
  for(int d=0;d<C_DH4;d++){ vec4 q=FT(T0,qc+d,n);
    s.x+=dot(q,FT(T0,kc+d,min(kr,C_N-1))); s.y+=dot(q,FT(T0,kc+d,min(kr+1,C_N-1)));
    s.z+=dot(q,FT(T0,kc+d,min(kr+2,C_N-1))); s.w+=dot(q,FT(T0,kc+d,min(kr+3,C_N-1))); }
  o0=mix(vec4(NEG),s*ISQ,lessThanEqual(LANE(j4),vec4(float(i))));
#else
  vec4 s=vec4(NEG);
  for(int c=0;c<4;c++){ int j=j4*4+c; if(j<=i){ float a=0.0; int kr=b*C_T+j;
    for(int d=0;d<C_DH;d++) a+=g1(T0,n,h*C_DH+d)*g1(T0,kr,C_DP+h*C_DH+d);
    s[c]=a*ISQ; } }
  o0=s;
#endif
}`;

  // lse[n][h] : T0=S -> [H,N]
  KS.attL = `
void main(){ ivec2 p=PX; int h=p.x; int n=p.y; int b=n/C_T; int i=n-b*C_T; int nj=(i>>2)+1; float m=NEG;
  for(int j=0;j<nj;j++){ vec4 s=FT(T0,h*C_T4+j,n); m=max(m,max(max(s.x,s.y),max(s.z,s.w))); }
  float t=0.0;
  for(int j=0;j<nj;j++){ vec4 e=exp(FT(T0,h*C_T4+j,n)-vec4(m)); t+=e.x+e.y+e.z+e.w; }
  o0=vec4(m+log(t),0.0,0.0,0.0); }`;

  // o = P·V : T0=qkv, T1=lse, T2=S -> [N,D4]
  KS.attPV = `
void main(){ ivec2 p=PX; int n=p.y; int b=n/C_T; int i=n-b*C_T;
#if DHV4
  int c4=p.x; int h=c4/C_DH4; float lse=FT(T1,h,n).x; int vc=2*C_D4+c4; int nj=(i>>2)+1; vec4 o=vec4(0.0);
  for(int j4=0;j4<nj;j4++){ vec4 pr=exp(FT(T2,h*C_T4+j4,n)-vec4(lse)); int r=b*C_T+j4*4;
    o+=pr.x*FT(T0,vc,min(r,C_N-1))+pr.y*FT(T0,vc,min(r+1,C_N-1))+pr.z*FT(T0,vc,min(r+2,C_N-1))+pr.w*FT(T0,vc,min(r+3,C_N-1)); }
  o0=o;
#else
  vec4 o=vec4(0.0);
  for(int c=0;c<4;c++){ int col=p.x*4+c; if(col<C_D){ int h=col/C_DH; float lse=FT(T1,h,n).x; float a=0.0;
    for(int j=0;j<=i;j++) a+=exp(g1(T2,n,h*C_TP+j)-lse)*g1(T0,b*C_T+j,2*C_DP+col);
    o[c]=a; } }
  o0=o;
#endif
}`;

  // delta[n][h] = dO·o : T0=dO, T1=o -> [H,N]
  KS.attD = `
void main(){ ivec2 p=PX; int h=p.x; int n=p.y; float s=0.0;
#if DHV4
  for(int d=0;d<C_DH4;d++) s+=dot(FT(T0,h*C_DH4+d,n),FT(T1,h*C_DH4+d,n));
#else
  for(int d=0;d<C_DH;d++) s+=g1(T0,n,h*C_DH+d)*g1(T1,n,h*C_DH+d);
#endif
  o0=vec4(s,0.0,0.0,0.0); }`;

  // dS = P*(dP-delta)/sqrt(DH) : T0=dO, T1=qkv, T2=S, T3=lse, T4=delta -> [N,H*T4]
  KS.attDS = `
void main(){ ivec2 p=PX; int n=p.y; int h=p.x/C_T4; int j4=p.x-h*C_T4; int b=n/C_T; int i=n-b*C_T;
  float lse=FT(T3,h,n).x; float dl=FT(T4,h,n).x;
#if DHV4
  if(j4*4>i){ o0=vec4(0.0); return; }
  int oc=h*C_DH4; int vc=2*C_D4+oc; int kr=b*C_T+j4*4; vec4 dp=vec4(0.0);
  for(int d=0;d<C_DH4;d++){ vec4 g=FT(T0,oc+d,n);
    dp.x+=dot(g,FT(T1,vc+d,min(kr,C_N-1))); dp.y+=dot(g,FT(T1,vc+d,min(kr+1,C_N-1)));
    dp.z+=dot(g,FT(T1,vc+d,min(kr+2,C_N-1))); dp.w+=dot(g,FT(T1,vc+d,min(kr+3,C_N-1))); }
  vec4 pr=exp(FT(T2,p.x,n)-vec4(lse));
  o0=pr*(dp-vec4(dl))*ISQ;
#else
  vec4 s=vec4(0.0);
  for(int c=0;c<4;c++){ int j=j4*4+c; if(j<=i){ float dp=0.0; int kr=b*C_T+j;
    for(int d=0;d<C_DH;d++) dp+=g1(T0,n,h*C_DH+d)*g1(T1,kr,2*C_DP+h*C_DH+d);
    s[c]=exp(g1(T2,n,h*C_TP+j)-lse)*(dp-dl)*ISQ; } }
  o0=s;
#endif
}`;

  // dqkv : T0=dS, T1=qkv, T2=S, T3=lse, T4=dO -> [N,3*D4]
  KS.attB = `
void main(){ ivec2 p=PX; int n=p.y; int blk=p.x/C_D4; int c4=p.x-blk*C_D4; int b=n/C_T; int t=n-b*C_T;
#if DHV4
  int h=c4/C_DH4; int hb=h*C_T4; vec4 a=vec4(0.0);
  if(blk==0){
    int nj=(t>>2)+1;
    for(int j4=0;j4<nj;j4++){ vec4 ds=FT(T0,hb+j4,n); int r=b*C_T+j4*4;
      a+=ds.x*FT(T1,C_D4+c4,min(r,C_N-1))+ds.y*FT(T1,C_D4+c4,min(r+1,C_N-1))+ds.z*FT(T1,C_D4+c4,min(r+2,C_N-1))+ds.w*FT(T1,C_D4+c4,min(r+3,C_N-1)); }
  } else if(blk==1){
    int tc=hb+(t>>2); int tq=t&3;
    for(int i=t;i<C_T;i++){ int r=b*C_T+i; a+=FT(T0,tc,r)[tq]*FT(T1,c4,r); }
  } else {
    int tc=hb+(t>>2); int tq=t&3;
    for(int i=t;i<C_T;i++){ int r=b*C_T+i; a+=exp(FT(T2,tc,r)[tq]-FT(T3,h,r).x)*FT(T4,c4,r); }
  }
  o0=a;
#else
  vec4 a=vec4(0.0);
  for(int c=0;c<4;c++){ int col=c4*4+c; if(col<C_D){ int h=col/C_DH; float acc=0.0;
    if(blk==0){ for(int j=0;j<=t;j++) acc+=g1(T0,n,h*C_TP+j)*g1(T1,b*C_T+j,C_DP+col); }
    else if(blk==1){ for(int i=t;i<C_T;i++){ int r=b*C_T+i; acc+=g1(T0,r,h*C_TP+t)*g1(T1,r,col); } }
    else { for(int i=t;i<C_T;i++){ int r=b*C_T+i; acc+=exp(g1(T2,r,h*C_TP+t)-FT(T3,h,r).x)*g1(T4,r,col); } }
    a[c]=acc; } }
  o0=a;
#endif
}`;

  // ---- LayerNorm geri ----
  // satır toplamları: T0=dy, T1=X(LN girdisi), T2=fwd stats, T3=P ; U1=(g.x,g.y) -> [1,N]=(Σdxhat/D, Σdxhat·xhat/D)
  KS.lnbStats = `
void main(){ int n=PX.y; vec2 st=FT(T2,0,n).xy; float s1=0.0; float s2=0.0;
  for(int i=0;i<C_D4;i++){ vec4 dyg=FT(T0,i,n)*FT(T3,U[1].x+i,U[1].y); vec4 xh=(FT(T1,i,n)-vec4(st.x))*st.y;
    s1+=dyg.x+dyg.y+dyg.z+dyg.w; s2+=dot(dyg,xh); }
  o0=vec4(s1/float(C_D),s2/float(C_D),0.0,0.0); }`;

  // dx = rstd*(dyg - s1m - xhat*s2m) [+ residual]   T0=dy, T1=X, T2=fwd stats, T3=P, T4=lnb stats, T5=residual ; U1=(g.x,g.y)
  KS.lnbApply = `
void main(){ ivec2 p=PX; vec2 st=FT(T2,0,p.y).xy; vec2 bs=FT(T4,0,p.y).xy;
  vec4 dyg=FT(T0,p.x,p.y)*FT(T3,U[1].x+p.x,U[1].y); vec4 xh=(FT(T1,p.x,p.y)-vec4(st.x))*st.y;
  vec4 r=st.y*(dyg-vec4(bs.x)-xh*bs.y);
#if DPAD
  r*=vec4(lessThan(LANE(p.x),vec4(float(C_D))));
#endif
#if RES
  r+=FT(T5,p.x,p.y);
#endif
  o0=r; }`;

  // g/b gradyan bölümleri: T0=dy, T1=X, T2=fwd stats ; U1=(chunk) -> o0=Σ dy*xhat , o1=Σ dy   ([D4, S])
  KS.lnPP = `
void main(){ ivec2 p=PX; int chunk=U[1].x; int n0=p.y*chunk; int n1=min(n0+chunk,C_N); vec4 a=vec4(0.0); vec4 b=vec4(0.0);
  for(int n=n0;n<n1;n++){ vec2 st=FT(T2,0,n).xy; vec4 dy=FT(T0,p.x,n); a+=dy*(FT(T1,p.x,n)-vec4(st.x))*st.y; b+=dy; }
  o0=a; o1=b; }`;

  // T0=Σ dy*xhat parts, T1=Σ dy parts ; U1=(S) ; çıktı dikdörtgeni 2 satır (g,b)
  KS.lnPF = `
void main(){ ivec2 p=PX; int S=U[1].x; vec4 a=vec4(0.0);
  if(p.y==0){ for(int s=0;s<S;s++) a+=FT(T0,p.x,s); } else { for(int s=0;s<S;s++) a+=FT(T1,p.x,s); }
  o0=a; }`;

  // ---- başlık: tied logits + çapraz entropi ----
  // T0=logits[N,V4] -> [1,N] = (lse, (lse-logit_y)/N)
  KS.ceRow = `
void main(){ int n=PX.y; float m=NEG;
  for(int v=0;v<C_V4;v++){ vec4 l=FT(T0,v,n);
#if VPAD
    if(v==C_V4-1) l=mix(vec4(NEG),l,lessThan(LANE(v),vec4(float(C_V))));
#endif
    m=max(m,max(max(l.x,l.y),max(l.z,l.w))); }
  float s=0.0;
  for(int v=0;v<C_V4;v++){ vec4 l=FT(T0,v,n);
#if VPAD
    if(v==C_V4-1) l=mix(vec4(NEG),l,lessThan(LANE(v),vec4(float(C_V))));
#endif
    vec4 e=exp(l-vec4(m)); s+=e.x+e.y+e.z+e.w; }
  float lse=m+log(s); int y=ID(C_Y0+n); float ly=FT(T0,y>>2,n)[y&3];
  o0=vec4(lse,(lse-ly)*INVN,0.0,0.0); }`;

  // dlogits = (softmax - onehot)/N : T0=logits, T1=ce
  KS.ceGrad = `
void main(){ ivec2 p=PX; vec4 l=FT(T0,p.x,p.y); float lse=FT(T1,0,p.y).x; int y=ID(C_Y0+p.y);
  vec4 idx=LANE(p.x); vec4 r=(exp(l-vec4(lse))-vec4(equal(idx,vec4(float(y)))))*INVN;
#if VPAD
  r*=vec4(lessThan(idx,vec4(float(C_V))));
#endif
  o0=r; }`;

  // ---- indirgemeler ----
  // atlas karesel toplamı: T0=G -> [WA, HB]   (her parça R satırı toplar)
  KS.sumsq = `
void main(){ ivec2 p=PX; float s=0.0;
  for(int r=0;r<C_R;r++){ int y=p.y*C_R+r; if(y<C_HA){ vec4 v=FT(T0,p.x,y); s+=dot(v,v); } }
  o0=vec4(s,0.0,0.0,0.0); }`;
  // x boyunca topla: T0=[W,H] -> [1,H]
  KS.reduceX = `
void main(){ int y=PX.y; float s=0.0; for(int x=0;x<C_W;x++) s+=FT(T0,x,y).x; o0=vec4(s,0.0,0.0,0.0); }`;
  // y boyunca R'lik gruplar: T0=[1,H] ; COMP bileşeni. OUT: 0 düz, 1 kayıp (x=loss,z=adım), 2 norm (y=sqrt)
  KS.reduceY = `
void main(){ int g=PX.y; float s=0.0;
  for(int r=0;r<C_R;r++){ int y=g*C_R+r; if(y<C_RH) s+=FT(T0,0,y)[C_COMP]; }
#if OUT==1
  o0=vec4(s,0.0,float(ID(9)),0.0);
#elif OUT==2
  o0=vec4(0.0,sqrt(s),0.0,0.0);
#else
  o0=vec4(s,0.0,0.0,0.0);
#endif
}`;

  // AdamW: T0=P,T1=M,T2=V,T3=G,T4=decay,T5=ring -> P',M',V'
  KS.adam = `
void main(){ ivec2 p=ivec2(gl_FragCoord.xy);
  float lr=CTL(0), bc1=CTL(1), bc2=CTL(2), wd=CTL(3), clip=CTL(4), b1=CTL(5), b2=CTL(6), eps=CTL(7); int slot=ID(8);
  float norm=FT(T5,slot,0).y; float sc=(norm>clip)?clip/norm:1.0;
  vec4 g=FT(T3,p.x,p.y)*sc; vec4 m=b1*FT(T1,p.x,p.y)+(1.0-b1)*g; vec4 v=b2*FT(T2,p.x,p.y)+(1.0-b2)*g*g; vec4 w=FT(T0,p.x,p.y);
  float dec=FT(T4,p.x,p.y).x*wd;
  o0=w-lr*((m*bc1)/(sqrt(v*bc2)+vec4(eps))+dec*w); o1=m; o2=v; }`;

  // ------------------------------------------------------------------------------------------- yardımcılar
  const fnum = (x) => { const s = String(x); return /[.eE]/.test(s) ? s : s + '.0'; };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ceil4 = (n) => (n + 3) >> 2;

  function makeCanvas() {
    if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = c.height = 1; return c; }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
    return null;
  }
  const GL_ATTR = { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
  function codeErr(msg, code) { const e = new Error(msg); e.code = code; return e; }
  function rendererOf(gl) {
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }

  // ------------------------------------------------------------------------------------------- supported()
  // Atılık bağlamda gerçekten çizip okuyarak sınar: RGBA32F/R32I doku, MRT, texelFetch, float readPixels.
  GPU.supported = function supported() {
    let canvas = null, gl = null;
    try {
      canvas = makeCanvas();
      if (!canvas) return { ok: false, reason: 'WebGL2 yok (canvas oluşturulamadı)' };
      gl = canvas.getContext('webgl2', GL_ATTR);
      if (!gl) return { ok: false, reason: 'WebGL2 desteklenmiyor' };
      const renderer = rendererOf(gl);
      if (!gl.getExtension('EXT_color_buffer_float')) return { ok: false, reason: 'EXT_color_buffer_float yok (float doku çizimi desteklenmiyor)', renderer };
      if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 4) return { ok: false, reason: 'MAX_DRAW_BUFFERS < 4', renderer };
      if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 10) return { ok: false, reason: 'MAX_TEXTURE_IMAGE_UNITS < 10', renderer };
      if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < 4096) return { ok: false, reason: 'MAX_TEXTURE_SIZE < 4096', renderer };
      const mkShader = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
        return s;
      };
      const vs = mkShader(gl.VERTEX_SHADER, VS);
      const fsA = mkShader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; layout(location=0) out vec4 a; layout(location=1) out vec4 b;\nvoid main(){ a=vec4(1.5,2.5,3.5,4.5); b=vec4(-1.0,0.25,8.0,16.0); }');
      const fsB = mkShader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; precision highp sampler2D; precision highp isampler2D; uniform sampler2D A,B; uniform isampler2D I; out vec4 o;\n' +
        'void main(){ o=texelFetch(A,ivec2(1,0),0)+texelFetch(B,ivec2(0,1),0)+vec4(float(texelFetch(I,ivec2(1,1),0).r)); }');
      const link = (fs) => {
        const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
        return p;
      };
      const pA = link(fsA), pB = link(fsB);
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const mkTex = (w, h) => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t;
      };
      const A = mkTex(2, 2), B = mkTex(2, 2), C = mkTex(1, 1);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, A, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, B, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return { ok: false, reason: 'RGBA32F çizim hedefi (MRT) tamamlanmıyor', renderer };
      gl.viewport(0, 0, 2, 2); gl.useProgram(pA); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const it = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, it); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32I, 2, 2);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RED_INTEGER, gl.INT, new Int32Array([1, 2, 3, 40]));
      const fb2 = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb2);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, C, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.useProgram(pB);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A); gl.uniform1i(gl.getUniformLocation(pB, 'A'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B); gl.uniform1i(gl.getUniformLocation(pB, 'B'), 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, it); gl.uniform1i(gl.getUniformLocation(pB, 'I'), 2);
      gl.viewport(0, 0, 1, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
      const want = [1.5 - 1.0 + 40, 2.5 + 0.25 + 40, 3.5 + 8.0 + 40, 4.5 + 16.0 + 40];
      for (let i = 0; i < 4; i++) if (Math.abs(px[i] - want[i]) > 1e-4) return { ok: false, reason: 'float doku okuma/yazma sınaması başarısız (' + Array.from(px).join(',') + ')', renderer };
      return { ok: true, renderer };
    } catch (e) {
      return { ok: false, reason: 'WebGL2 sınaması hata verdi: ' + (e && e.message ? e.message : e) };
    } finally {
      try { if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } } catch (_) { /* önemsiz */ }
    }
  };

  // ------------------------------------------------------------------------------------------- Trainer
  class Trainer {
    constructor(cfg, opts) {
      opts = opts || {};
      const c = Object.assign({}, cfg);
      for (const k of ['V', 'T', 'D', 'L', 'H', 'FF']) if (!(c[k] > 0)) throw new Error('Trainer: cfg.' + k + ' gerekli');
      if (!(c.B > 0)) c.B = 1;
      if (c.D % c.H) throw new Error('Trainer: D, H\'ye tam bölünmeli');
      this.cfg = c;
      this.stepCount = 0;
      this.cpuMs = 0;               // step() CPU maliyeti (üstel ortalama, ms)
      this.lost = false;
      this._disposed = false;
      this._seed = opts.seed;
      this._initOpts = opts.initOpts;
      this._opts = opts;
      this._res = { tex: [], fbo: [], prog: [], buf: [], query: [] };
      this._texId = 0; this._fboCache = new Map(); this._progCache = new Map(); this._pwCache = new Map();
      this._fences = []; this._pending = []; this._pboFree = []; this._epoch = 0; this._lastDone = 0; this._pumping = false;
      this._par = 0; this._adamT = 0; this._slot = 0;
      this._curProg = null; this._curFbo = null; this._vp = [-1, -1, -1, -1]; this._unitTex = new Array(16).fill(null); this._active = -1;
      const t0 = now();
      this._open();
      this._dims();
      this._atlas();
      this._alloc();
      this._compile();
      this._build();
      this.info.compileMs = now() - t0;
      this.init(null, opts.seed);
    }

    // ---------------------------------------------------------------- bağlam
    _open() {
      const canvas = makeCanvas();
      if (!canvas) throw codeErr('WebGL2 yok', 'NO_WEBGL2');
      const gl = canvas.getContext('webgl2', GL_ATTR);
      if (!gl) throw codeErr('WebGL2 desteklenmiyor', 'NO_WEBGL2');
      if (!gl.getExtension('EXT_color_buffer_float')) throw codeErr('EXT_color_buffer_float yok', 'NO_FLOAT_RT');
      this.canvas = canvas; this.gl = gl;
      this._loseExt = gl.getExtension('WEBGL_lose_context');
      this._timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      gl.getExtension('KHR_parallel_shader_compile');
      this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 3 || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 10) throw codeErr('GPU sınırları yetersiz', 'NO_FLOAT_RT');
      this._vao = gl.createVertexArray(); gl.bindVertexArray(this._vao);
      if (canvas.addEventListener) canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
      this.info = { renderer: rendererOf(gl), maxTex: this.maxTex };
    }

    _dims() {
      const c = this.cfg; const { V, T, D, L, H, FF, B } = c;
      const D4 = ceil4(D), FF4 = ceil4(FF), V4 = ceil4(V), T4 = ceil4(T), DH = D / H;
      this.d = { V, T, D, L, H, FF, B, N: B * T, D4, Dp: 4 * D4, FF4, FFp: 4 * FF4, V4, Vp: 4 * V4, T4, Tp: 4 * T4, DH, DH4: DH >> 2, DHV4: DH % 4 === 0 };
      if (this.d.N > this.maxTex) throw codeErr('B*T ' + this.d.N + ' > MAX_TEXTURE_SIZE', 'TOO_BIG');
      if (Math.max(3 * D4, FF4, this.d.H * T4, V4) > this.maxTex) throw codeErr('tensör genişliği MAX_TEXTURE_SIZE üstünde', 'TOO_BIG');
    }

    // ---------------------------------------------------------------- atlas yerleşimi
    _atlas() {
      const d = this.d;
      const lay = Limon.Layout.build(this.cfg); this.lay = lay;
      const shapeOf = (n) => {
        if (n === 'tok') return { rows: d.Vp, c4: d.D4 };
        if (n === 'pos') return { rows: d.T, c4: d.D4 };
        if (/\.qkv\.w$/.test(n)) return { rows: d.Dp, c4: 3 * d.D4 };
        if (/\.qkv\.b$/.test(n)) return { rows: 1, c4: 3 * d.D4 };
        if (/\.fc1\.w$/.test(n)) return { rows: d.Dp, c4: d.FF4 };
        if (/\.fc1\.b$/.test(n)) return { rows: 1, c4: d.FF4 };
        if (/\.fc2\.w$/.test(n)) return { rows: d.FFp, c4: d.D4 };
        if (/\.proj\.w$/.test(n)) return { rows: d.Dp, c4: d.D4 };
        return { rows: 1, c4: d.D4 }; // proj.b, fc2.b, ln.*
      };
      const ts = lay.tensors; const units = [];
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i], nx = ts[i + 1];
        const pair = nx && t.name.includes('.') && nx.name.includes('.') && t.name.slice(0, t.name.lastIndexOf('.')) === nx.name.slice(0, nx.name.lastIndexOf('.')) &&
          ((/\.w$/.test(t.name) && /\.b$/.test(nx.name)) || (/\.g$/.test(t.name) && /\.b$/.test(nx.name)));
        if (pair) { units.push([t, nx]); i++; } else units.push([t]);
      }
      let colW = 0; for (const t of ts) colW = Math.max(colW, shapeOf(t.name).c4);
      const BANDH = Math.min(this.maxTex, 8192);
      const rect = {}; const grad = {}; let band = 0, y = 0, maxY = 0;
      for (const u of units) {
        let rows = 0; for (const t of u) rows += shapeOf(t.name).rows;
        if (y > 0 && y + rows > BANDH) { band++; y = 0; }
        const y0 = y;
        for (const t of u) { const s = shapeOf(t.name); rect[t.name] = { x: band * colW, y, rows: s.rows, c4: s.c4, t }; y += s.rows; }
        grad[u[0].name] = { x: band * colW, y: y0, rows: y - y0, c4: rect[u[0].name].c4 }; // W+bias veya g+b birlikte
        maxY = Math.max(maxY, y);
      }
      const W = (band + 1) * colW, H = maxY;
      if (W > this.maxTex || H > this.maxTex) throw codeErr('parametre atlası MAX_TEXTURE_SIZE üstünde', 'TOO_BIG');
      this.rect = rect; this.gradRect = grad; this.aW = W; this.aH = H;
      // düz Layout indeksi -> atlas float indeksi
      const gidx = new Int32Array(lay.total);
      for (const t of ts) {
        const r = rect[t.name]; const qkv = /\.qkv\.[wb]$/.test(t.name);
        for (let ro = 0; ro < t.rows; ro++) {
          const base = ((r.y + ro) * W + r.x) * 4;
          for (let c = 0; c < t.cols; c++) {
            let gc = c;
            if (qkv) { const blk = (c / d.D) | 0; gc = blk * d.Dp + (c - blk * d.D); }
            gidx[t.offset + ro * t.cols + c] = base + gc;
          }
        }
      }
      this._gidx = gidx;
      this.info.paramCount = lay.total; this.info.atlas = [W, H];
    }

    // ---------------------------------------------------------------- doku/FBO/program
    _tex(w, h, name, fmt) {
      const gl = this.gl;
      if (w > this.maxTex || h > this.maxTex || w < 1 || h < 1) throw codeErr('doku boyutu geçersiz ' + w + 'x' + h + ' (' + name + ')', 'TOO_BIG');
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === 'r' ? gl.R32F : fmt === 'i' ? gl.R32I : gl.RGBA32F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._res.tex.push(t); this._active = -1; this._unitTex.fill(null); // bağlama önbelleğini geçersiz kıl (kurulum sırasında)
      this._texBytes = (this._texBytes || 0) + w * h * (fmt === 'r' || fmt === 'i' ? 4 : 16);
      return { t, w, h, name, id: ++this._texId };
    }
    // birden çok ekli çizim hedefi (MRT) ya da tek doku hedefi; önbellekli
    _tgt(...txs) {
      const key = txs.map((t) => t.id).join(',');
      let r = this._fboCache.get(key);
      if (r) return r;
      const gl = this.gl; const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      txs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.t, 0));
      gl.drawBuffers(txs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw codeErr('FBO tamamlanmadı: ' + txs.map((t) => t.name + ' ' + t.w + 'x' + t.h).join(','), 'NO_FLOAT_RT');
      this._res.fbo.push(fbo); this._curFbo = null;
      r = { fbo, w: txs[0].w, h: txs[0].h }; this._fboCache.set(key, r); return r;
    }
    _pw(w, h) { // dW/LN bölüm tamponları (şekle göre paylaşılır)
      const k = w + 'x' + h; let t = this._pwCache.get(k);
      if (!t) { t = this._tex(w, h, 'part' + k); this._pwCache.set(k, t); }
      return t;
    }

    _alloc() {
      const d = this.d, W = this.aW, H = this.aH, N = d.N;
      const tx = (w, h, n) => this._tex(w, h, n);
      this.P = [tx(W, H, 'P0'), tx(W, H, 'P1')];
      this.M = [tx(W, H, 'M0'), tx(W, H, 'M1')];
      this.Vv = [tx(W, H, 'V0'), tx(W, H, 'V1')];
      this.G = tx(W, H, 'G');
      this.decay = this._tex(W, H, 'decay', 'r');
      this.ring = tx(RING, 1, 'ring');
      this.evalTex = tx(1, 1, 'eval');
      const A = (this.A = {});
      const mk = (n, w, h) => tx(w, h, n);
      A.h = []; A.st1 = []; A.a1 = []; A.qkv = []; A.S = []; A.lse = []; A.o = []; A.hm = []; A.st2 = []; A.m = []; A.u = []; A.g = [];
      for (let l = 0; l <= d.L; l++) A.h.push(mk('h' + l, d.D4, N));
      for (let l = 0; l < d.L; l++) {
        A.st1.push(mk('st1_' + l, 1, N)); A.a1.push(mk('a1_' + l, d.D4, N)); A.qkv.push(mk('qkv' + l, 3 * d.D4, N));
        A.S.push(mk('S' + l, d.H * d.T4, N)); A.lse.push(mk('lse' + l, d.H, N)); A.o.push(mk('o' + l, d.D4, N));
        A.hm.push(mk('hm' + l, d.D4, N)); A.st2.push(mk('st2_' + l, 1, N)); A.m.push(mk('m' + l, d.D4, N));
        A.u.push(mk('u' + l, d.FF4, N)); A.g.push(mk('g' + l, d.FF4, N));
      }
      A.stf = mk('stf', 1, N); A.f = mk('f', d.D4, N); A.logits = mk('logits', d.V4, N); A.ce = mk('ce', 1, N);
      const R1 = Math.max(1, Math.ceil(Math.sqrt(N))); this._lossR1 = R1; this._lossG1 = Math.ceil(N / R1);
      A.rl1 = mk('rl1', 1, this._lossG1);
      A.dl = mk('dl', d.V4, N); A.dy = mk('dy', d.D4, N); A.dO = mk('dO', d.D4, N); A.dhm = mk('dhm', d.D4, N);
      A.dhA = mk('dhA', d.D4, N); A.dhB = mk('dhB', d.D4, N); A.du = mk('du', d.FF4, N); A.dqkv = mk('dqkv', 3 * d.D4, N);
      A.dS = mk('dS', d.H * d.T4, N); A.delta = mk('delta', d.H, N); A.lnbs = mk('lnbs', 1, N);
      // norm indirgeme tamponları
      const NR = 64; this._normR = NR; const HB = Math.ceil(H / NR); this._normHB = HB;
      A.ns1 = mk('ns1', W, HB); A.ns2 = mk('ns2', 1, HB);
      // LN g/b bölümleri
      const SL = Math.max(1, Math.min(256, Math.round(N / 32))); this._lnS = SL;
      A.ppA = mk('ppA', d.D4, SL); A.ppB = mk('ppB', d.D4, SL);
      // ids dokuları
      const total = CTL_N + 3 * N + d.Vp + 1;
      this._idsRows = Math.ceil(total / IDW);
      this._ids = new Int32Array(this._idsRows * IDW); this._idsF = new Float32Array(this._ids.buffer);
      this._cur = new Int32Array(d.V);
      this._idsTex = []; for (let i = 0; i < IDS_RING; i++) this._idsTex.push(this._tex(IDW, this._idsRows, 'ids' + i, 'i'));
      this._idsK = 0;
      // decay maskesi
      const dm = new Float32Array(W * H);
      for (const t of this.lay.tensors) {
        if (!t.decay) continue; const r = this.rect[t.name];
        for (let y = r.y; y < r.y + r.rows; y++) for (let x = r.x; x < r.x + r.c4; x++) dm[y * W + x] = 1;
      }
      this._upload(this.decay, dm, this.gl.RED, W, H);
      // okuma FBO'ları (P[0], P[1], ring, G): tek eklentili
      this._tgt(this.P[0]); this._tgt(this.P[1]); this._tgt(this.ring); this._tgt(this.G); this._tgt(this.evalTex);
      this.info.texMB = Math.round(this._texBytes / 1048576);
    }

    _upload(tx, data, fmt, w, h) {
      const gl = this.gl; this._bindTex(15, tx.t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w == null ? tx.w : w, h == null ? tx.h : h, fmt || gl.RGBA, gl.FLOAT, data);
    }
    _bindTex(unit, t) {
      if (this._unitTex[unit] === t) return;
      const gl = this.gl;
      if (this._active !== unit) { gl.activeTexture(gl.TEXTURE0 + unit); this._active = unit; }
      gl.bindTexture(gl.TEXTURE_2D, t); this._unitTex[unit] = t;
    }

    // ---------------------------------------------------------------- programlar
    _compile() {
      const d = this.d; const N = d.N;
      const base = {
        C_N: N, C_T: d.T, C_B: d.B, C_T4: d.T4, C_TP: d.Tp, C_D: d.D, C_D4: d.D4, C_DP: d.Dp, C_H: d.H, C_DH: d.DH, C_DH4: d.DH4,
        DHV4: this._opts.forceSlowAttn ? 0 : +d.DHV4, DPAD: +(d.D % 4 !== 0), C_V: d.V, C_V4: d.V4, VPAD: +(d.V % 4 !== 0),
        C_X0: CTL_N, C_Y0: CTL_N + N, C_ST0: CTL_N + 2 * N, C_LS0: CTL_N + 2 * N + d.Vp + 1,
        ISQ: fnum(1 / Math.sqrt(d.DH)), INVN: fnum(1 / N),
        NOUT: 1, OUT: 0, EPI: 0, BIAS: 0, TOK: 0, RES: 0, KBZ: 0, C_K4: 1, C_M4: 1, C_R: 1, C_HA: 1, C_W: 1, C_RH: 1, C_COMP: 0,
      };
      this._base = base;
      const gl = this.gl;
      const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VS); gl.compileShader(vs); this._vs = vs;
      this._progList = [];
      const P = (kernel, extra) => {
        const key = kernel + JSON.stringify(extra || {});
        let pr = this._progCache.get(key); if (pr) return pr;
        const defs = Object.assign({}, base, extra || {});
        const txt = Object.keys(defs).map((k) => '#define ' + k + ' ' + defs[k]).join('\n');
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        const src = '#version 300 es\n' + txt + '\n' + FS_HEAD + KS[kernel];
        gl.shaderSource(fs, src); gl.compileShader(fs);
        const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        pr = { p, fs, name: kernel, key, src, uLoc: null };
        this._res.prog.push(p); this._progCache.set(key, pr); this._progList.push(pr); return pr;
      };
      const pg = (this.pg = {});
      const { D4, FF4, V4 } = d;
      pg.embed = P('embed'); pg.lnStats = P('lnStats'); pg.lnApply = P('lnApply');
      pg.mmQKV = P('mm', { C_K4: D4, BIAS: 1, EPI: 0 }); pg.mmProj = P('mm', { C_K4: D4, BIAS: 1, EPI: 1 });
      pg.mmFC1 = P('mm', { C_K4: D4, BIAS: 1, EPI: 2, NOUT: 2 }); pg.mmFC2 = P('mm', { C_K4: FF4, BIAS: 1, EPI: 1 });
      pg.mmHead = P('mm', { C_K4: V4, BIAS: 0, EPI: 0 });
      pg.mtQKV = P('mt', { C_M4: 3 * D4 }); pg.mtProj = P('mt', { C_M4: D4 }); pg.mtFC1 = P('mt', { C_M4: FF4 });
      pg.mtFC2 = P('mt', { C_M4: D4, EPI: 3 }); pg.mtLogit = pg.mtProj;
      pg.dw = P('dw'); pg.dwK = P('dw', { KBZ: 1 }); pg.dwSum = P('dwSum'); pg.dwSumTok = P('dwSum', { TOK: 1 }); pg.posGrad = P('posGrad');
      pg.attS = P('attS'); pg.attL = P('attL'); pg.attPV = P('attPV'); pg.attD = P('attD'); pg.attDS = P('attDS'); pg.attB = P('attB');
      pg.lnbStats = P('lnbStats'); pg.lnbA0 = P('lnbApply', { RES: 0 }); pg.lnbA1 = P('lnbApply', { RES: 1 });
      pg.lnPP = P('lnPP', { NOUT: 2 }); pg.lnPF = P('lnPF');
      pg.ceRow = P('ceRow'); pg.ceGrad = P('ceGrad');
      pg.sumsq = P('sumsq', { C_R: this._normR, C_HA: this.aH }); pg.reduceX = P('reduceX', { C_W: this.aW });
      const R1 = this._lossR1, G1 = this._lossG1, HB = this._normHB;
      pg.lossS1 = P('reduceY', { C_R: R1, C_RH: N, C_COMP: 1, OUT: 0 });
      pg.lossRing = P('reduceY', { C_R: G1, C_RH: G1, C_COMP: 0, OUT: 1 });
      pg.lossEval = P('reduceY', { C_R: G1, C_RH: G1, C_COMP: 0, OUT: 0 });
      pg.normFinal = P('reduceY', { C_R: HB, C_RH: HB, C_COMP: 0, OUT: 2 });
      pg.adam = P('adam', { NOUT: 3 });
      // bağlantı durumlarını topluca doğrula (paralel derleme için ikinci döngü)
      for (const pr of this._progList) {
        if (!gl.getProgramParameter(pr.p, gl.LINK_STATUS)) {
          const log = (gl.getShaderInfoLog(pr.fs) || '') + '\n' + (gl.getProgramInfoLog(pr.p) || '');
          const lines = pr.src.split('\n'); const m = /ERROR: \d+:(\d+)/.exec(log); const ln = m ? +m[1] : 0;
          throw new Error('Shader derlenemedi (' + pr.key + '): ' + log + '\n>> ' + (ln ? lines.slice(Math.max(0, ln - 3), ln + 2).join('\n>> ') : ''));
        }
        gl.useProgram(pr.p);
        for (let i = 0; i < 8; i++) { const loc = gl.getUniformLocation(pr.p, 'T' + i); if (loc) gl.uniform1i(loc, i); }
        const li = gl.getUniformLocation(pr.p, 'TI'); if (li) gl.uniform1i(li, 8);
        pr.uLoc = gl.getUniformLocation(pr.p, 'U');
      }
      this._curProg = null;
      this.info.programs = this._progList.length;
    }

    // ---------------------------------------------------------------- geçiş listeleri
    _build() {
      this._lists = [this._buildLists(0), this._buildLists(1)];
      this.info.passes = this._lists[0].train.length;
    }

    _buildLists(par) {
      const d = this.d, pg = this.pg, A = this.A;
      const R = (n) => this.rect[n];
      const GR = (n) => this.gradRect[n];
      const Pt = this.P[par].t;
      const T1 = (t) => this._tgt(t);
      const mk = (name, prog, out, vp, tex, u) => {
        const p = { name, prog, fbo: out.fbo, vp: vp || [0, 0, out.w, out.h], tex, u: new Int32Array(24), dyn: false, mask: 0 };
        p.u[0] = p.vp[0]; p.u[1] = p.vp[1];
        if (u) for (let i = 0; i < u.length; i++) p.u[4 + i] = u[i];
        return p;
      };
      const F = [], Bk = [], Up = [];
      const tok = R('tok'), pos = R('pos');

      // ------------------------- ileri
      F.push(mk('embed', pg.embed, T1(A.h[0]), null, [Pt], [tok.x, tok.y, pos.x, pos.y]));
      for (let l = 0; l < d.L; l++) {
        const g1 = R(`l${l}.ln1.g`), b1 = R(`l${l}.ln1.b`), qw = R(`l${l}.qkv.w`), qb = R(`l${l}.qkv.b`);
        const pw = R(`l${l}.proj.w`), pb = R(`l${l}.proj.b`), g2 = R(`l${l}.ln2.g`), b2 = R(`l${l}.ln2.b`);
        const f1w = R(`l${l}.fc1.w`), f1b = R(`l${l}.fc1.b`), f2w = R(`l${l}.fc2.w`), f2b = R(`l${l}.fc2.b`);
        F.push(mk(`l${l}.ln1.stats`, pg.lnStats, T1(A.st1[l]), null, [A.h[l].t]));
        F.push(mk(`l${l}.ln1.apply`, pg.lnApply, T1(A.a1[l]), null, [A.h[l].t, A.st1[l].t, Pt], [g1.x, g1.y, b1.x, b1.y]));
        F.push(mk(`l${l}.qkv`, pg.mmQKV, T1(A.qkv[l]), null, [A.a1[l].t, Pt], [qw.x, qw.y, qb.x, qb.y]));
        F.push(mk(`l${l}.att.score`, pg.attS, T1(A.S[l]), null, [A.qkv[l].t]));
        F.push(mk(`l${l}.att.lse`, pg.attL, T1(A.lse[l]), null, [A.S[l].t]));
        F.push(mk(`l${l}.att.pv`, pg.attPV, T1(A.o[l]), null, [A.qkv[l].t, A.lse[l].t, A.S[l].t]));
        F.push(mk(`l${l}.proj`, pg.mmProj, T1(A.hm[l]), null, [A.o[l].t, Pt, A.h[l].t], [pw.x, pw.y, pb.x, pb.y]));
        F.push(mk(`l${l}.ln2.stats`, pg.lnStats, T1(A.st2[l]), null, [A.hm[l].t]));
        F.push(mk(`l${l}.ln2.apply`, pg.lnApply, T1(A.m[l]), null, [A.hm[l].t, A.st2[l].t, Pt], [g2.x, g2.y, b2.x, b2.y]));
        F.push(mk(`l${l}.fc1`, pg.mmFC1, this._tgt(A.u[l], A.g[l]), null, [A.m[l].t, Pt], [f1w.x, f1w.y, f1b.x, f1b.y]));
        F.push(mk(`l${l}.fc2`, pg.mmFC2, T1(A.h[l + 1]), null, [A.g[l].t, Pt, A.hm[l].t], [f2w.x, f2w.y, f2b.x, f2b.y]));
      }
      const gf = R('lnf.g'), bf = R('lnf.b');
      F.push(mk('lnf.stats', pg.lnStats, T1(A.stf), null, [A.h[d.L].t]));
      F.push(mk('lnf.apply', pg.lnApply, T1(A.f), null, [A.h[d.L].t, A.stf.t, Pt], [gf.x, gf.y, bf.x, bf.y]));
      F.push(mk('logits', pg.mtLogit, T1(A.logits), null, [A.f.t, Pt], [tok.x, tok.y]));
      F.push(mk('ce.row', pg.ceRow, T1(A.ce), null, [A.logits.t]));

      // ------------------------- kayıp indirgemesi (halkaya / eval dokusuna)
      const lossS1 = mk('loss.1', pg.lossS1, T1(A.rl1), null, [A.ce.t]);
      const lossRing = mk('loss.ring', pg.lossRing, T1(this.ring), [0, 0, 1, 1], [A.rl1.t]); lossRing.dyn = true; lossRing.mask = 1;
      const lossEval = mk('loss.eval', pg.lossEval, T1(this.evalTex), [0, 0, 1, 1], [A.rl1.t]);

      // ------------------------- geri
      // dW (+bias satırı): S=1 ise doğrudan G'ye, değilse bölümlere ayır + topla
      const addDW = (name, At, Ct, grName, wName, deferSum, dwProg) => {
        dwProg = dwProg || pg.dw;
        const gr = GR(grName), wr = R(wName); const Kp = wr.rows, RT = gr.rows, M4 = gr.c4;
        let S = Math.max(1, Math.min(16, Math.ceil(GEN_TARGET_FRAGS / (M4 * RT)))); S = Math.min(S, d.N);
        const chunk = Math.ceil(d.N / S); S = Math.ceil(d.N / chunk);
        if (S === 1 && !deferSum) { Bk.push(mk(name, dwProg, T1(this.G), [gr.x, gr.y, M4, RT], [At.t, Ct.t], [RT, Kp, chunk, 0])); return null; }
        const PW = deferSum ? this._tex(M4, S * RT, 'part_' + name) : this._pw(M4, S * RT);
        Bk.push(mk(name, dwProg, T1(PW), null, [At.t, Ct.t], [RT, Kp, chunk, 0]));
        if (deferSum) return { PW, RT, S, M4 };
        Bk.push(mk(name + '.sum', pg.dwSum, T1(this.G), [gr.x, gr.y, M4, RT], [PW.t], [RT, S]));
        return null;
      };
      const lnBack = (nm, dy, X, st, gName, out, res) => {
        const g = R(gName);
        Bk.push(mk(nm + '.bs', pg.lnbStats, T1(A.lnbs), null, [dy.t, X.t, st.t, Pt], [g.x, g.y]));
        const tex = [dy.t, X.t, st.t, Pt, A.lnbs.t]; if (res) tex.push(res.t);
        Bk.push(mk(nm + '.ba', res ? pg.lnbA1 : pg.lnbA0, T1(out), null, tex, [g.x, g.y]));
        const chunk = Math.ceil(d.N / this._lnS), S2 = Math.ceil(d.N / chunk); const gr = GR(gName);
        Bk.push(mk(nm + '.pp', pg.lnPP, this._tgt(A.ppA, A.ppB), [0, 0, d.D4, S2], [dy.t, X.t, st.t], [chunk]));
        Bk.push(mk(nm + '.pf', pg.lnPF, T1(this.G), [gr.x, gr.y, gr.c4, 2], [A.ppA.t, A.ppB.t], [S2]));
      };
      Bk.push(mk('ce.grad', pg.ceGrad, T1(A.dl), null, [A.logits.t, A.ce.t]));
      Bk.push(mk('head.df', pg.mmHead, T1(A.dy), null, [A.dl.t, Pt], [tok.x, tok.y, 0, 0]));
      const tokPart = addDW('tok.dw', A.dl, A.f, 'tok', 'tok', true);
      let cur = A.dhA, oth = A.dhB;
      lnBack('lnf', A.dy, A.h[d.L], A.stf, 'lnf.g', cur, null);
      for (let l = d.L - 1; l >= 0; l--) {
        const dOut = cur, dIn = oth;
        const qw = R(`l${l}.qkv.w`), pw = R(`l${l}.proj.w`), f1w = R(`l${l}.fc1.w`), f2w = R(`l${l}.fc2.w`);
        addDW(`l${l}.fc2.dw`, A.g[l], dOut, `l${l}.fc2.w`, `l${l}.fc2.w`);
        Bk.push(mk(`l${l}.fc2.dg`, pg.mtFC2, T1(A.du), null, [dOut.t, Pt, A.u[l].t], [f2w.x, f2w.y]));
        addDW(`l${l}.fc1.dw`, A.m[l], A.du, `l${l}.fc1.w`, `l${l}.fc1.w`);
        Bk.push(mk(`l${l}.fc1.dm`, pg.mtFC1, T1(A.dy), null, [A.du.t, Pt], [f1w.x, f1w.y]));
        lnBack(`l${l}.ln2`, A.dy, A.hm[l], A.st2[l], `l${l}.ln2.g`, A.dhm, dOut);
        addDW(`l${l}.proj.dw`, A.o[l], A.dhm, `l${l}.proj.w`, `l${l}.proj.w`);
        Bk.push(mk(`l${l}.proj.dO`, pg.mtProj, T1(A.dO), null, [A.dhm.t, Pt], [pw.x, pw.y]));
        Bk.push(mk(`l${l}.att.delta`, pg.attD, T1(A.delta), null, [A.dO.t, A.o[l].t]));
        Bk.push(mk(`l${l}.att.dS`, pg.attDS, T1(A.dS), null, [A.dO.t, A.qkv[l].t, A.S[l].t, A.lse[l].t, A.delta.t]));
        Bk.push(mk(`l${l}.att.dqkv`, pg.attB, T1(A.dqkv), null, [A.dS.t, A.qkv[l].t, A.S[l].t, A.lse[l].t, A.dO.t]));
        addDW(`l${l}.qkv.dw`, A.a1[l], A.dqkv, `l${l}.qkv.w`, `l${l}.qkv.w`, false, pg.dwK);
        Bk.push(mk(`l${l}.qkv.da`, pg.mtQKV, T1(A.dy), null, [A.dqkv.t, Pt], [qw.x, qw.y]));
        lnBack(`l${l}.ln1`, A.dy, A.h[l], A.st1[l], `l${l}.ln1.g`, dIn, A.dhm);
        cur = dIn; oth = dOut;
      }
      const dh0 = cur; const pg_ = GR('pos'), tg = GR('tok');
      Bk.push(mk('pos.grad', pg.posGrad, T1(this.G), [pg_.x, pg_.y, d.D4, d.T], [dh0.t]));
      Bk.push(mk('tok.sum', pg.dwSumTok, T1(this.G), [tg.x, tg.y, tg.c4, tg.rows], [tokPart.PW.t, dh0.t], [tokPart.RT, tokPart.S]));
      // global gradyan normu (iki aşamalı indirgeme; sonuç halkanın .y kanalına)
      Bk.push(mk('norm.1', pg.sumsq, T1(A.ns1), null, [this.G.t]));
      Bk.push(mk('norm.2', pg.reduceX, T1(A.ns2), null, [A.ns1.t]));
      const nf = mk('norm.3', pg.normFinal, T1(this.ring), [0, 0, 1, 1], [A.ns2.t]); nf.dyn = true; nf.mask = 2; Bk.push(nf);

      // ------------------------- AdamW (kırpma ölçeği GPU'da, halkadaki norm'dan)
      Up.push(mk('adam', pg.adam, this._tgt(this.P[1 - par], this.M[1 - par], this.Vv[1 - par]), null,
        [this.P[par], this.M[par], this.Vv[par]].map((t) => t.t).concat([this.G.t, this.decay.t, this.ring.t])));

      return { fwd: F, bwd: Bk, upd: Up, lossRing: [lossS1, lossRing], lossEval: [lossS1, lossEval],
        train: [].concat(F, [lossS1, lossRing], Bk, Up), evalL: [].concat(F, [lossS1, lossEval]), grads: [].concat(F, [lossS1, lossRing], Bk) };
    }

    // ---------------------------------------------------------------- geçiş koşucusu
    _exec(p) {
      const gl = this.gl;
      if (this._curProg !== p.prog) { gl.useProgram(p.prog.p); this._curProg = p.prog; }
      if (this._curFbo !== p.fbo) { gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo); this._curFbo = p.fbo; }
      const tex = p.tex, ut = this._unitTex;
      for (let i = 0; i < tex.length; i++) {
        if (ut[i] !== tex[i]) {
          if (this._active !== i) { gl.activeTexture(gl.TEXTURE0 + i); this._active = i; }
          gl.bindTexture(gl.TEXTURE_2D, tex[i]); ut[i] = tex[i];
        }
      }
      const vp = p.vp, v = this._vp, vx = p.dyn ? this._slot : vp[0];
      if (v[0] !== vx || v[1] !== vp[1] || v[2] !== vp[2] || v[3] !== vp[3]) { gl.viewport(vx, vp[1], vp[2], vp[3]); v[0] = vx; v[1] = vp[1]; v[2] = vp[2]; v[3] = vp[3]; }
      gl.uniform4iv(p.prog.uLoc, p.u);
      if (p.mask === 0) { gl.drawArrays(gl.TRIANGLES, 0, 3); return; }
      if (p.mask === 1) gl.colorMask(true, false, true, false); else gl.colorMask(false, true, false, false);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.colorMask(true, true, true, true);
    }
    _run(list) { for (let i = 0; i < list.length; i++) this._exec(list[i]); }

    // ---------------------------------------------------------------- ids yükleme (x, y, kimlik listeleri, kontrol)
    _uploadIds(x, y) {
      const d = this.d, N = d.N, V = d.V, Vp = d.Vp, I = this._ids, gl = this.gl;
      if (!x || !y || x.length < N || y.length < N) throw new Error('Trainer: x ve y uzunluğu B*T = ' + N + ' olmalı');
      const X0 = CTL_N, Y0 = CTL_N + N, ST0 = CTL_N + 2 * N, LS0 = ST0 + Vp + 1;
      for (let v = 0; v <= Vp; v++) I[ST0 + v] = 0;
      for (let n = 0; n < N; n++) {
        let a = x[n]; if (!(a >= 0 && a < V)) a = 0; let b = y[n]; if (!(b >= 0 && b < V)) b = 0;
        I[X0 + n] = a; I[Y0 + n] = b; I[ST0 + a + 1]++;
      }
      const cur = this._cur;
      for (let v = 0; v < V; v++) { I[ST0 + v + 1] += I[ST0 + v]; cur[v] = I[ST0 + v]; }
      for (let v = V + 1; v <= Vp; v++) I[ST0 + v] = N;
      for (let n = 0; n < N; n++) I[LS0 + cur[I[X0 + n]]++] = n;
      this._idsK = (this._idsK + 1) % IDS_RING;
      this._bindTex(8, this._idsTex[this._idsK].t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, IDW, this._idsRows, gl.RED_INTEGER, gl.INT, I);
    }

    _prepStep(x, y, lr, o) {
      const st = ++this.stepCount, t = ++this._adamT, F = this._idsF, I = this._ids;
      const b1 = o.beta1 != null ? o.beta1 : 0.9, b2 = o.beta2 != null ? o.beta2 : 0.98;
      F[0] = lr; F[1] = 1 / (1 - Math.pow(b1, t)); F[2] = 1 / (1 - Math.pow(b2, t));
      F[3] = o.wd != null ? o.wd : 0.01; F[4] = (o.clip == null) ? 1.0 : (o.clip > 0 && o.clip < 1e30 ? o.clip : 1e30);
      F[5] = b1; F[6] = b2; F[7] = o.eps != null ? o.eps : 1e-8;
      this._slot = (st - 1) % RING; I[8] = this._slot; I[9] = st;
      this._uploadIds(x, y);
    }

    step(x, y, lr, opts) {
      if (this._disposed) throw new Error('Trainer: dispose edilmiş');
      const t0 = now(), gl = this.gl;
      this._prepStep(x, y, lr, opts || {});
      this._run(this._lists[this._par].train);
      this._par ^= 1;
      this._fences.push({ s: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), step: this.stepCount, epoch: this._epoch });
      gl.flush();
      const dt = now() - t0; this.cpuMs += (dt - this.cpuMs) * 0.1;
    }

    // ---------------------------------------------------------------- kuyruk durumu / asenkron okuma
    _poll() {
      const gl = this.gl; if (!gl) return;
      while (this._fences.length) {
        const f = this._fences[0], r = gl.clientWaitSync(f.s, 0, 0);
        if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED) {
          gl.deleteSync(f.s); this._fences.shift(); if (f.epoch === this._epoch) this._lastDone = f.step;
        } else break;
      }
    }
    inFlight() { if (this._disposed) return 0; this._poll(); return this._fences.length; }

    _getPbo(bytes) {
      const gl = this.gl;
      for (let i = 0; i < this._pboFree.length; i++) if (this._pboFree[i].bytes === bytes) return this._pboFree.splice(i, 1)[0];
      const buf = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf); gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_COPY); // *_READ kullanımı, PBO yeniden kullanılınca Chrome'un 'shadow copy' performans uyarısını üretiyor gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this._res.buf.push(buf); return { buf, bytes };
    }
    _asyncRead(fbo, x, y, w, h) {
      const gl = this.gl, n = w * h * 4, pbo = this._getPbo(n * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); this._curFbo = fbo;
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      return new Promise((resolve, reject) => { this._pending.push({ sync, pbo, n, resolve, reject }); this._pump(); });
    }
    _pump() {
      if (this._pumping) return; this._pumping = true;
      const tick = () => {
        const gl = this.gl;
        if (this._disposed || !gl) { this._pumping = false; return; }
        for (let i = 0; i < this._pending.length;) {
          const q = this._pending[i], r = gl.clientWaitSync(q.sync, 0, 0);
          if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED) {
            this._pending.splice(i, 1);
            const dst = new Float32Array(q.n);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.pbo.buf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, dst); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.deleteSync(q.sync); this._pboFree.push(q.pbo); q.resolve(dst);
          } else if (r === gl.WAIT_FAILED) { this._pending.splice(i, 1); gl.deleteSync(q.sync); this._pboFree.push(q.pbo); q.reject(new Error('GPU okuma başarısız (bağlam kaybı?)')); }
          else i++;
        }
        if (this._pending.length) setTimeout(tick, 1); else this._pumping = false;
      };
      setTimeout(tick, 0);
    }

    readLossAsync() {
      if (this._disposed) return Promise.resolve(null);
      this._poll();
      if (this.stepCount === 0) return Promise.resolve(null);
      const s = this._lastDone > 0 ? this._lastDone : 1; // en son tamamlanmış adım; henüz yoksa ilk adım (kısa süre sonra biter)
      return this._asyncRead(this._tgt(this.ring).fbo, (s - 1) % RING, 0, 1, 1).then((v) => (v[2] > 0 ? { step: Math.round(v[2]), loss: v[0], gradNorm: v[1] } : null));
    }
    evalLoss(x, y) {
      if (this._disposed) return Promise.resolve(NaN);
      this._uploadIds(x, y);
      this._run(this._lists[this._par].evalL);
      return this._asyncRead(this._tgt(this.evalTex).fbo, 0, 0, 1, 1).then((v) => v[0]);
    }

    // ---------------------------------------------------------------- ağırlıklar
    _unpack(buf) { const gi = this._gidx, out = new Float32Array(gi.length); for (let i = 0; i < gi.length; i++) out[i] = buf[gi[i]]; return out; }
    readWeights() {
      const gl = this.gl, buf = new Float32Array(this.aW * this.aH * 4), fbo = this._tgt(this.P[this._par]).fbo;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); this._curFbo = fbo;
      gl.readPixels(0, 0, this.aW, this.aH, gl.RGBA, gl.FLOAT, buf);
      return this._unpack(buf);
    }
    readWeightsAsync() {
      if (this._disposed) return Promise.resolve(null);
      return this._asyncRead(this._tgt(this.P[this._par]).fbo, 0, 0, this.aW, this.aH).then((buf) => this._unpack(buf));
    }
    loadWeights(flat) { this._uploadWeights(flat, false); }
    _uploadWeights(w, reset) {
      if (!w || w.length !== this.lay.total) throw new Error('Trainer: ağırlık uzunluğu ' + (w && w.length) + ' != ' + this.lay.total);
      const buf = new Float32Array(this.aW * this.aH * 4), gi = this._gidx;
      for (let i = 0; i < gi.length; i++) buf[gi[i]] = w[i];
      this._upload(this.P[this._par], buf);
      if (reset) { buf.fill(0); this._upload(this.M[this._par], buf); this._upload(this.Vv[this._par], buf); }
    }
    init(weights, seed) {
      if (this._disposed) throw new Error('Trainer: dispose edilmiş');
      if (seed != null) this._seed = seed;
      const w = weights || Limon.Layout.init(this.cfg, this._seed == null ? 1 : this._seed, this._initOpts);
      this._uploadWeights(w, true);
      this.stepCount = 0; this._adamT = 0; this._epoch++; this._lastDone = 0;
    }

    // ---------------------------------------------------------------- hata ayıklama / ölçüm yardımcıları (SPEC dışı)
    _readTex(tx) {
      const gl = this.gl, buf = new Float32Array(tx.w * tx.h * 4), fbo = this._tgt(tx).fbo;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); this._curFbo = fbo;
      gl.readPixels(0, 0, tx.w, tx.h, gl.RGBA, gl.FLOAT, buf); return buf;
    }
    // Ara tensör oku: satır-major [rows][cols] Float32Array (doldurma atılır). name: 'h0','a1_0','qkv0','o0','hm0','m0','u0','g0','f','logits','S0'...
    debugTensor(name, cols) {
      const A = this.A; let tx = null;
      const mm = /^([a-zA-Z]+?)_?(\d+)$/.exec(name);
      if (A[name]) tx = A[name]; else if (mm && A[mm[1]] && A[mm[1]][+mm[2]]) tx = A[mm[1]][+mm[2]];
      if (!tx || Array.isArray(tx)) throw new Error('debugTensor: bilinmeyen ' + name);
      const buf = this._readTex(tx), rows = tx.h, stride = tx.w * 4, c = cols == null ? stride : cols;
      const out = new Float32Array(rows * c);
      for (let r = 0; r < rows; r++) for (let i = 0; i < c; i++) out[r * c + i] = buf[r * stride + i];
      return out;
    }
    debugForward(x, y) {
      const gl = this.gl, d = this.d;
      this._uploadIds(x, y);
      this._run(this._lists[this._par].evalL);
      const l = this._readTex(this.evalTex)[0];
      const raw = this._readTex(this.A.logits), logits = new Float32Array(d.N * d.V), Vp = d.Vp;
      for (let n = 0; n < d.N; n++) for (let v = 0; v < d.V; v++) logits[n * d.V + v] = raw[n * Vp + v];
      return { loss: l, logits };
    }
    // İleri+geri (kırpma/Adam YOK): ham gradyan (Layout sırası), kayıp, gradNorm
    debugGrad(x, y) {
      const gl = this.gl;
      this._slot = 0; this._ids[8] = 0; this._ids[9] = -1; this._idsF[4] = 1e30;
      this._uploadIds(x, y);
      this._run(this._lists[this._par].grads);
      const ring = this._readTex(this.ring);
      const g = this._unpack(this._readTex(this.G));
      return { loss: ring[0], gradNorm: ring[1], grad: g };
    }
    // Bir eğitim adımını geçiş başına GPU zamanlayıcısıyla koşar (gerçek adım: ağırlıklar güncellenir). Promise<{total, passes:[{name,ms}], byKind}>
    profile(x, y, lr, opts) {
      const ext = this._timer, gl = this.gl;
      if (!ext) return Promise.reject(new Error('EXT_disjoint_timer_query_webgl2 yok'));
      this._prepStep(x, y, lr, opts || {});
      const list = this._lists[this._par].train, qs = [];
      for (const p of list) {
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); this._exec(p); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q);
      }
      this._par ^= 1; gl.flush();
      return new Promise((resolve) => {
        const check = () => {
          if (!gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE)) { setTimeout(check, 5); return; }
          const passes = list.map((p, i) => ({ name: p.name, ms: gl.getQueryParameter(qs[i], gl.QUERY_RESULT) / 1e6 }));
          const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
          qs.forEach((q) => gl.deleteQuery(q));
          const byKind = {}; let total = 0;
          for (const p of passes) { const k = p.name.replace(/^l\d+\./, ''); byKind[k] = (byKind[k] || 0) + p.ms; total += p.ms; }
          resolve({ total, passes, byKind, disjoint });
        };
        check();
      });
    }

    dispose() {
      if (this._disposed) return; this._disposed = true;
      const gl = this.gl; if (!gl) return;
      for (const q of this._pending) { try { q.reject(new Error('Trainer dispose edildi')); } catch (_) { /* yoksay */ } }
      this._pending.length = 0;
      for (const f of this._fences) gl.deleteSync(f.s);
      this._fences.length = 0;
      for (const r of this._res.buf) gl.deleteBuffer(r);
      for (const r of this._res.fbo) gl.deleteFramebuffer(r);
      for (const r of this._res.tex) gl.deleteTexture(r);
      for (const pr of this._progList) { gl.deleteProgram(pr.p); gl.deleteShader(pr.fs); }
      gl.deleteShader(this._vs); gl.deleteVertexArray(this._vao);
      if (this._loseExt) this._loseExt.loseContext();
      this._fboCache.clear(); this._progCache.clear(); this._pwCache.clear(); this._lists = null;
    }
  }

  GPU.Trainer = Trainer;

  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
