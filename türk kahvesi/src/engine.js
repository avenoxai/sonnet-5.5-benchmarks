/* ============================================================================
 * engine.js: pastel boya / çocuk çizimi çizim motoru
 * Hiçbir görsel dosya yok; her şey Canvas2D ile, koddan çizilir.
 * Her fonksiyon t'nin SAF fonksiyonudur (Math.random yok, Date yok):
 * aynı t -> aynı kare. Canlı oynatma ve video export aynı kodu kullanır.
 * ==========================================================================*/
(function (g) {
'use strict';

const W = 1080, H = 1080;
const BOIL_HZ = 8;              // çizgi "titreme" (line boil) hızı
const CRAYON_HZ = 4;            // boya tarama deseninin yeniden çizilme hızı

const PAL = {
  paper:  '#f4efe2',
  ink:    '#1e2b7a',   // referanstaki lacivert mürekkep
  ink2:   '#3a4796',   // açık lacivert (hayalet çizgi)
  orange: '#f28c1e',
  yellow: '#f4b92f',
  teal:   '#2f9d8f',
  pink:   '#f3a6a3',
  green:  '#6db04a',
  green2: '#3f8f45',
  brown:  '#8b5a34',
  coffee: '#5e3520',
  red:    '#d8342c',
  sky:    '#8fc7e6',
  blue:   '#3f73c4',
  gray:   '#8f8c86',
  black:  '#231f20',
  white:  '#fbf8ef',
  sand:   '#e2c088',
  lilac:  '#b9a3d6',
};

// Zaman durumu: her karenin başında setTime(t) çağrılır.
const S = { t: 0, boil: 0, crayon: 0, W, H };
function setTime(t) {
  S.t = t;
  S.boil = Math.floor(t * BOIL_HZ + 1e-6);
  S.crayon = Math.floor(t * CRAYON_HZ + 1e-6);
}

/* ---------------------------------------------------------------- rastgele */
function hashInt(x) {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
function h2(a, b) { return hashInt((Math.imul(a | 0, 0x9E3779B1) ^ hashInt(b | 0)) | 0); }
function rnd01(a, b = 0) { return h2(a, b) / 4294967296; }
function rng(seed) {
  let s = (seed | 0) >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sid(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function noise1(x, seed = 0) {           // -1..1 pürüzsüz tek boyutlu gürültü
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = rnd01(i, seed) * 2 - 1, b = rnd01(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOut = (t) => { t = clamp(t); return 1 - (1 - t) * (1 - t) * (1 - t); };
const easeInOut = (t) => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeOutBack = (t) => { t = clamp(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
// [a,b] aralığında 0..1
const seg = (t, a, b) => clamp((t - a) / (b - a));

/* ------------------------------------------------------------ yol örnekleme */
// Catmull-Rom (uniform) ile pürüzsüz örnekleme; step ≈ nokta aralığı (px)
function sample(pts, closed, step = 4) {
  const n = pts.length;
  if (n < 2) return pts.map(p => [p[0], p[1]]);
  const out = [];
  const get = (i) => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
// Düz çizgi parçaları (köşeli) örnekleme
function linSample(pts, closed, step = 4) {
  const n = pts.length, out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < m; k++) out.push([lerp(a[0], b[0], k / m), lerp(a[1], b[1], k / m)]);
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

/* -------------------------------------------------------------------- mürekkep */
// Değişken kalınlıklı, titreyen, çizilme (draw-on) ilerlemeli kalem çizgisi.
// o: w, col, wob, seed, p (0..1 ilerleme), p0 (0..1 başlangıç), closed, smooth(false=köşeli),
//    ghost (hayalet ikinci çizgi), alpha
function ink(ctx, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const w = o.w ?? 3.6, col = o.col ?? PAL.ink, wob = o.wob ?? 1.3, seed = o.seed ?? 0;
  let P = (o.smooth === false) ? linSample(pts, o.closed, 4) : sample(pts, o.closed, 4);
  if (o.closed) {                        // çocuk gibi: kapanış biraz taşsın
    const extra = Math.min(P.length - 1, Math.max(2, Math.floor(P.length * 0.07)));
    const dx = (rnd01(seed, 91) - .5) * 5, dy = (rnd01(seed, 92) - .5) * 5;
    for (let i = 0; i <= extra; i++) P.push([P[i][0] + dx * (i / extra), P[i][1] + dy * (i / extra)]);
  }
  const n = P.length;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const L = cum[n - 1];
  const s0 = clamp(o.p0 ?? 0) * L, s1 = clamp(o.p ?? 1) * L;
  if (s1 - s0 < 0.01 && L > 1) return;
  const alpha = o.alpha ?? 1;
  drawRibbon(ctx, P, cum, L, s0, s1, w, col, wob, seed, alpha, 0, 0);
  const gh = o.ghost ?? (rnd01(seed, 31) < 0.28);
  if (gh && L > 40) {
    drawRibbon(ctx, P, cum, L, s0, s1, w * 0.55, PAL.ink2, wob * 1.3, seed + 977, alpha * 0.42,
      (rnd01(seed, 33) - .5) * 5, (rnd01(seed, 34) - .5) * 5);
  }
}
function drawRibbon(ctx, P, cum, L, s0, s1, w, col, wob, seed, alpha, ox, oy) {
  const n = P.length;
  const pts = [];
  const bo = S.boil;
  const dispAt = (s) => {
    return wob * (0.5 * noise1(s / 40, seed * 7 + 3) + 0.3 * noise1(s / 19 + bo * 3.7, seed * 7 + 5)
      + 0.25 * noise1(s / 71 + bo * 1.3, seed * 7 + 9));
  };
  const wAt = (s) => {
    let k = 1 + 0.16 * noise1(s / 26, seed * 5 + 1);
    const edge = 9;
    const e0 = Math.min((s - 0) / edge, 1), e1 = Math.min((L - s) / edge, 1);
    k *= 0.6 + 0.4 * Math.min(e0, e1);
    return w * k;
  };
  const push = (i, s, frac) => {
    let a = P[Math.max(0, Math.min(n - 1, i))], b = P[Math.max(0, Math.min(n - 1, i + 1))];
    let x = a[0], y = a[1];
    if (frac !== undefined) { x = lerp(a[0], b[0], frac); y = lerp(a[1], b[1], frac); }
    const pa = P[Math.max(0, i - 1)], pb = P[Math.min(n - 1, i + 1)];
    let tx = pb[0] - pa[0], ty = pb[1] - pa[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const d = dispAt(s);
    pts.push({ x: x - ty * d + ox, y: y + tx * d + oy, nx: -ty, ny: tx, w: wAt(s) });
  };
  // başlangıç sınırı
  let i0 = 0; while (i0 < n - 1 && cum[i0 + 1] <= s0) i0++;
  if (cum[i0] < s0 && i0 < n - 1) {
    const fr = (s0 - cum[i0]) / Math.max(1e-6, cum[i0 + 1] - cum[i0]);
    push(i0, s0, fr);
  }
  for (let i = i0 + (cum[i0] < s0 ? 1 : 0); i < n && cum[i] <= s1; i++) push(i, cum[i]);
  // bitiş sınırı
  let i1 = 0; while (i1 < n - 1 && cum[i1 + 1] <= s1) i1++;
  if (i1 < n - 1 && cum[i1] < s1) {
    const fr = (s1 - cum[i1]) / Math.max(1e-6, cum[i1 + 1] - cum[i1]);
    push(i1, s1, fr);
  }
  const m = pts.length;
  if (m < 2) {
    if (m === 1) { ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, 6.29); ctx.fill(); ctx.restore(); }
    return;
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + pts[0].nx * pts[0].w / 2, pts[0].y + pts[0].ny * pts[0].w / 2);
  for (let i = 1; i < m; i++) ctx.lineTo(pts[i].x + pts[i].nx * pts[i].w / 2, pts[i].y + pts[i].ny * pts[i].w / 2);
  for (let i = m - 1; i >= 0; i--) ctx.lineTo(pts[i].x - pts[i].nx * pts[i].w / 2, pts[i].y - pts[i].ny * pts[i].w / 2);
  ctx.closePath();
  ctx.fill();
  // yuvarlak uçlar
  ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, 6.29); ctx.fill();
  ctx.beginPath(); ctx.arc(pts[m - 1].x, pts[m - 1].y, pts[m - 1].w / 2, 0, 6.29); ctx.fill();
  ctx.restore();
}

/* --------------------------------------------------------- şekil yardımcıları */
// Elips noktaları (kapalı eğri için). rot: radyan.
function ellipsePts(cx, cy, rx, ry, n = 12, rot = 0, a0 = 0) {
  const out = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}
// Yay noktaları (açık eğri). Açılar radyan, y aşağı.
function arcPts(cx, cy, rx, ry, a0, a1, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}
// Çocuk çizimi gibi eğri büğrü daire/elips (kapalı ink)
function blobPts(cx, cy, rx, ry, seed = 0, n = 10, amt = 0.06) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rnd01(seed, i) - .5) * 2 * amt;
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}
// Spiral (güneş, göz, yanak): çok turlu açık eğri
function spiralPts(cx, cy, r0, r1, turns = 2.2, a0 = 0, n = 26) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + t * turns * Math.PI * 2, r = lerp(r0, r1, t);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
// Noktaları dönüştür
function xf(pts, dx, dy, s = 1, rot = 0) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return pts.map(p => { const x = p[0] * s, y = p[1] * s; return [dx + x * c - y * sn, dy + x * sn + y * c]; });
}

/* ------------------------------------------------------------------- bellek */
const cache = new Map();
let cachePix = 0;
const CACHE_PIX_MAX = 70e6;      // ~280 MB
function cget(key, make) {
  let v = cache.get(key);
  if (v !== undefined) { cache.delete(key); cache.set(key, v); return v; }
  v = make();
  cache.set(key, v);
  v.pix = v.c ? v.c.width * v.c.height : 0;
  cachePix += v.pix;
  while (cachePix > CACHE_PIX_MAX && cache.size > 1) {
    const k = cache.keys().next().value, old = cache.get(k);
    cachePix -= old.pix || 0; cache.delete(k);
  }
  return v;
}
function mkCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c;
}
function hashPts(pts) {
  let h = 2166136261;
  for (let i = 0; i < pts.length; i++) { h ^= Math.round(pts[i][0] * 4); h = Math.imul(h, 16777619); h ^= Math.round(pts[i][1] * 4); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* -------------------------------------------------------------- boya (crayon) */
let grainCanvas = null;
function getGrain() {
  if (grainCanvas) return grainCanvas;
  const N = 256, c = mkCanvas(N, N), x = c.getContext('2d');
  const img = x.createImageData(N, N), d = img.data, r = rng(4242);
  // kağıt dokusu: ince tuz-biber + biraz yatay/çapraz lif
  const base = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) base[i] = r();
  for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
    const i = y * N + xx;
    const a = base[i];
    const b = base[((y + 1) % N) * N + xx], cc = base[y * N + (xx + 1) % N], dd = base[((y + N - 1) % N) * N + (xx + N - 1) % N];
    const v = 0.55 * a + 0.15 * b + 0.15 * cc + 0.15 * dd;
    // eşik: ~28% delik
    const hole = clamp((0.36 - v) * 9);
    d[i * 4] = 255; d[i * 4 + 1] = 255; d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.round(hole * 255);
  }
  x.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}
let paperCanvas = null;
function getPaper() {
  if (paperCanvas) return paperCanvas;
  const c = mkCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = PAL.paper; x.fillRect(0, 0, W, H);
  const r = rng(777);
  // çok hafif leke/bulut
  for (let i = 0; i < 26; i++) {
    const cx = r() * W, cy = r() * H, rad = 120 + r() * 260;
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const dark = r() < .5;
    gr.addColorStop(0, dark ? 'rgba(170,150,110,0.035)' : 'rgba(255,255,255,0.05)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  // ince tane
  const img = x.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < W * H; i++) {
    const n = (r() - .5) * 7;
    d[i * 4] = clamp(d[i * 4] + n, 0, 255); d[i * 4 + 1] = clamp(d[i * 4 + 1] + n, 0, 255); d[i * 4 + 2] = clamp(d[i * 4 + 2] + n * 1.1, 0, 255);
  }
  x.putImageData(img, 0, 0);
  paperCanvas = c;
  return c;
}
function paper(ctx, color) {
  if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); }
  else ctx.drawImage(getPaper(), 0, 0);
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp(pa >> 16, pb >> 16, t)), gg = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t)), bb = Math.round(lerp(pa & 255, pb & 255, t));
  return '#' + ((1 << 24) + (r << 16) + (gg << 8) + bb).toString(16).slice(1);
}

// Poligonun içini kısa boya darbeleriyle doldurur; kenarlar tırtıklı taşar, kağıt tanesi çizgi yönünde boyayı deler
function makeCrayon(pts, col, o) {
  const seed = o.seed, r = rng(seed * 131 + (o.step | 0) * 7919 + 17);
  const jit = o.jit;
  let poly = sample(pts, true, 7).map((p, i) => [p[0] + (rnd01(seed, i) - .5) * jit, p[1] + (rnd01(seed, i + 500) - .5) * jit]);
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of poly) { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
  const pad = 16;
  const bx = Math.floor(minx - pad), by = Math.floor(miny - pad);
  const cw = Math.ceil(maxx - minx + pad * 2), chh = Math.ceil(maxy - miny + pad * 2);
  const c = mkCanvas(cw, chh), x = c.getContext('2d');
  x.lineCap = 'round'; x.lineJoin = 'round';
  const local = poly.map(p => [p[0] - bx, p[1] - by]);
  const passes = [
    { ang: o.ang, gap: o.gap, lw: o.lw, a: 0.95, cover: 1, len: 30 },
    { ang: o.ang + 0.55 + r() * .35, gap: o.gap * 1.9, lw: o.lw * 0.85, a: 0.6, cover: o.dens, len: 22 },
  ];
  const plan = [];
  for (const ps of passes) {
    const c0 = Math.cos(-ps.ang), s0 = Math.sin(-ps.ang);
    const rp = local.map(p => [p[0] * c0 - p[1] * s0, p[0] * s0 + p[1] * c0]);
    let ymin = 1e9, ymax = -1e9;
    for (const p of rp) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
    let y = ymin + ps.gap * (0.1 + r() * 0.5), flip = r() < .5;
    while (y < ymax + ps.gap * .3) {
      const xs = [];
      for (let i = 0; i < rp.length; i++) {
        const a = rp[i], b = rp[(i + 1) % rp.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        if (r() > ps.cover) continue;
        const xa = xs[k] - 1 + (r() - .3) * 6, xb = xs[k + 1] + 1 + (r() - .3) * 6;
        if (xb - xa < 2) continue;
        // kısa parçalara böl
        const pieces = [];
        let cx = xa;
        while (cx < xb - 1) {
          const L = ps.len * (0.5 + r() * 1.1);
          const ex = Math.min(xb + r() * 2, cx + L);
          pieces.push([cx, ex]);
          cx = ex - (1 + r() * 4);
          if (ex >= xb) break;
        }
        if (flip) pieces.reverse().forEach(pc => pc.reverse());
        for (const pc of pieces) plan.push({ xa: pc[0], xb: pc[1], y, ps });
      }
      flip = !flip;
      y += ps.gap * (0.75 + r() * 0.5);
    }
  }
  const limit = o.p < 1 ? Math.floor(plan.length * o.p) : plan.length;
  for (let i = 0; i < limit; i++) {
    const s = plan[i], ps = s.ps;
    const cs = Math.cos(ps.ang), sn = Math.sin(ps.ang);
    const da = (r() - .5) * 0.3;                       // her darbenin hafif açı sapması
    const mx = (s.xa + s.xb) / 2, half = (s.xb - s.xa) / 2;
    const dyA = (r() - .5) * 2.2, dyB = (r() - .5) * 2.2 + Math.sin(da) * half;
    const rot = (px, py) => [px * cs - py * sn, px * sn + py * cs];
    const A = rot(s.xa, s.y + dyA), Bp = rot(s.xb, s.y + dyB), M = rot(mx, s.y + (r() - .5) * 3);
    x.strokeStyle = mixHex(col, r() < .5 ? '#ffffff' : '#000000', r() * 0.12);
    x.globalAlpha = Math.min(1, ps.a * (0.8 + r() * .3));
    x.lineWidth = ps.lw * (0.7 + r() * 0.6);
    x.beginPath(); x.moveTo(A[0], A[1]); x.quadraticCurveTo(M[0], M[1], Bp[0], Bp[1]); x.stroke();
  }
  x.globalAlpha = 1;
  // kağıt tanesi: çizgi yönünde uzamış beyaz lekeler boyayı deler
  x.globalCompositeOperation = 'destination-out';
  const pat = x.createPattern(getGrain(), 'repeat');
  const dpat = new DOMMatrix().rotate(o.ang * 180 / Math.PI).scale(2.6, 1);
  pat.setTransform(dpat.translate(Math.floor(r() * 256), Math.floor(r() * 256)));
  x.fillStyle = pat; x.globalAlpha = o.grain; x.fillRect(0, 0, cw, chh);
  const pat2 = x.createPattern(getGrain(), 'repeat');
  pat2.setTransform(new DOMMatrix().rotate(o.ang * 180 / Math.PI + 90).scale(1.6, 1).translate(Math.floor(r() * 256), Math.floor(r() * 256)));
  x.fillStyle = pat2; x.globalAlpha = o.grain * 0.45; x.fillRect(0, 0, cw, chh);
  x.globalCompositeOperation = 'source-over';
  return { c, x: bx, y: by };
}

// Boya dolgusu. pts: kapalı çokgen (yumuşatılır). o: seed, ang, gap, lw, dens, grain, jit, dx, dy, a, p, still
function crayon(ctx, pts, col, o = {}) {
  const p = o.p ?? 1;
  if (p <= 0.001) return;
  const seed = o.seed ?? 1;
  const opt = {
    seed, ang: o.ang ?? (-0.75 + (rnd01(seed, 3) - .5) * .7), gap: o.gap ?? 5.2, lw: o.lw ?? 9,
    dens: o.dens ?? 0.6, grain: o.grain ?? 0.85, jit: o.jit ?? 4,
    step: o.still ? 0 : (S.crayon), p: p < 1 ? Math.round(p * 40) / 40 : 1,
  };
  const key = col + '|' + seed + '|' + opt.step + '|' + opt.ang.toFixed(2) + '|' + opt.gap + '|' + opt.lw + '|' + opt.dens + '|' + opt.grain + '|' + opt.jit + '|' + opt.p + '|' + hashPts(pts);
  const bmp = cget(key, () => makeCrayon(pts, col, opt));
  const dx = o.dx ?? (rnd01(seed, 8) - .5) * 5, dy = o.dy ?? (rnd01(seed, 9) - .5) * 5;
  const a = o.a ?? 1;
  if (a !== 1) { ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(bmp.c, bmp.x + dx, bmp.y + dy); ctx.restore(); }
  else ctx.drawImage(bmp.c, bmp.x + dx, bmp.y + dy);
}
// Dikdörtgen boya alanı kısayolu
function crayonRect(ctx, x, y, w, h, col, o = {}) {
  crayon(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((p, i) => p), col, Object.assign({ jit: 5 }, o));
}
// Sadece yumuşatmasız köşeli çokgen boyası (ör. bina, dikdörtgen)
function crayonPoly(ctx, pts, col, o = {}) {
  // Köşeli kalması için kenarları ara noktalarla yoğunlaştır: Catmull-Rom köşeleri yumuşatmasın
  const dense = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    dense.push(a);
    dense.push([lerp(a[0], b[0], .5), lerp(a[1], b[1], .5)]);
  }
  crayon(ctx, dense, col, o);
}

/* -------------------------------------------------------- yazı (vuruş font) */
// TKFONT: src/font.js (y aşağı, taban çizgisi y=0, x-height=-500)
const textCache = new Map();
function textLayout(str, size) {
  const F = g.TKFONT;
  if (!F) return null;
  const key = str + '|' + size;
  let L = textCache.get(key);
  if (L) return L;
  const sc = size / 1000;
  const strokes = []; let x = 0, total = 0, wordStart = [];
  const chars = Array.from(str);
  chars.forEach((ch, ci) => {
    if (ch === ' ') { x += F.space * sc; wordStart.push(total); return; }
    const gl = F.glyphs[ch] || F.glyphs['?'];
    if (!gl) { x += F.space * sc; return; }
    for (let si = 0; si < gl.s.length; si++) {
      const pts = gl.s[si].map(p => [x + p[0] * sc, p[1] * sc]);
      // uzunluk
      let len = 0; const sm = sample(pts, false, 6);
      for (let i = 1; i < sm.length; i++) len += Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]);
      strokes.push({ pts, len, ci, si, start: total, ch });
      total += len + size * 0.12;   // vuruşlar arası "kalem havada" payı
    }
    x += gl.w * sc;
  });
  L = { strokes, total: Math.max(1, total - size * 0.12), width: x, chars };
  textCache.set(key, L);
  return L;
}
function textWidth(str, size) { const L = textLayout(str, size); return L ? L.width : str.length * size * .5; }
// Yazıyı çiz. o: p (0..1), col, align('left'|'center'|'right'), seed, w (çizgi kalınlığı), wob, slant
function text(ctx, str, x, y, size, o = {}) {
  const L = textLayout(str, size);
  if (!L) return;
  const p = clamp(o.p ?? 1);
  if (p <= 0) return;
  const align = o.align || 'left';
  const ox = align === 'center' ? x - L.width / 2 : align === 'right' ? x - L.width : x;
  const w = o.w ?? Math.max(1.6, size * 0.065), col = o.col ?? PAL.ink, seed = o.seed ?? sid(str);
  const cur = p * L.total;
  const slant = o.slant ?? 0.06;
  for (const st of L.strokes) {
    if (cur <= st.start) break;
    const sp = clamp((cur - st.start) / Math.max(1, st.len));
    const j = (rnd01(seed, st.ci * 7 + 1) - .5) * size * 0.05;    // harf taban çizgisi oynaması
    const sk = (rnd01(seed, st.ci * 7 + 2) - .5) * 0.10;
    const pts = st.pts.map(q => [ox + q[0] - (q[1]) * (slant + sk), y + q[1] + j]);
    ink(ctx, pts, { w, col, wob: o.wob ?? size * 0.012, seed: seed + st.ci * 13 + st.si, p: sp, ghost: false, alpha: o.alpha ?? 1 });
  }
}

/* ---------------------------------------------------------------- dışa aktar */
g.TK = {
  W, H, PAL, S, setTime, BOIL_HZ,
  rnd01, rng, sid, noise1, clamp, lerp, smooth, easeOut, easeInOut, easeOutBack, seg, h2,
  sample, ink, ellipsePts, arcPts, blobPts, spiralPts, xf,
  crayon, crayonRect, crayonPoly, paper, mkCanvas, mixHex,
  text, textWidth, textLayout,
  scenes: {},
};
})(window);
