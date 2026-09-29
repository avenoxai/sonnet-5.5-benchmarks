/* intro.js: video açılışı (küresel 0 -> 7.7 sn). Boş kağıttan başlar: başlık yazılır, güneş doğar,
 * İstanbul silueti çizilir, kahraman Fincan yerden "pop" diye belirir. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { ink, crayon, seg, clamp, lerp, smooth, easeOut, easeOutBack, easeInOut, rnd01, noise1, arcPts, ellipsePts, blobPts } = TK;

const GY = 790;                   // zemin / kıyı çizgisi
const HX = 540, HS = 0.86;        // kahraman fincanın yeri ve ölçeği

function I(ctx, pts, o) { ink(ctx, pts, Object.assign({ w: 3.4, wob: 1.2, ghost: false }, o)); }
function polyFill(ctx, pts, col, o) { TK.crayonPoly(ctx, pts, col, Object.assign({ still: true, jit: 2.5, gap: 4, lw: 7 }, o)); }

/* ------------------------------------------------------------------ tepe konturları */
const LC = [[-30, 700], [20, 662], [70, 632], [120, 613], [170, 607], [225, 613], [280, 634], [335, 672], [385, 718], [425, 758], [452, 790]];
const RC = [[628, 790], [666, 758], [705, 727], [750, 697], [800, 672], [850, 658], [905, 655], [960, 665], [1020, 687], [1090, 715], [1125, 732]];
function yOn(c, x) {
  for (let i = 0; i < c.length - 1; i++) if (x >= c[i][0] && x <= c[i + 1][0]) return lerp(c[i][1], c[i + 1][1], (x - c[i][0]) / (c[i + 1][0] - c[i][0]));
  return x < c[0][0] ? c[0][1] : c[c.length - 1][1];
}
const HILL_L = LC.concat([[452, GY], [-30, GY]]);
const HILL_R = RC.concat([[1125, GY], [628, GY]]);

/* ------------------------------------------------------------------ yapılar */
// kubbe (yarım elips), taban y'de
function dome(ctx, cx, base, rx, ry, o) {
  const p = o.p, s = o.seed;
  const arc = arcPts(cx, base, rx, ry, Math.PI, Math.PI * 2, 8);
  if (o.fill && o.fp > 0) polyFill(ctx, arc, o.fill, { seed: s + 40, p: o.fp, a: 0.95, gap: o.gap || 4.6, lw: o.lw || 8 });
  I(ctx, arc, { p: seg(p, 0, 0.8), seed: s, w: o.w || 3.4 });
  if (o.finial !== false) {
    I(ctx, [[cx, base - ry], [cx, base - ry - 13]], { p: seg(p, 0.75, 1), seed: s + 1, w: 2.8 });
    I(ctx, arcPts(cx + 3, base - ry - 17, 5, 5, 0.6, 5.2, 5), { p: seg(p, 0.85, 1), seed: s + 2, w: 2.4 });
  }
}
// ince minare: uçlu şapka
function minaret(ctx, x, base, top, o) {
  const p = o.p, s = o.seed, hw = 5;
  const Hh = base - top;
  const by = base - Hh * 0.6, cb = base - Hh * 0.82;
  I(ctx, [[x - hw, base], [x - hw, by]], { p: seg(p, 0, 0.35), seed: s });
  I(ctx, [[x + hw, base], [x + hw, by]], { p: seg(p, 0, 0.35), seed: s + 1 });
  I(ctx, [[x - hw - 5, by + 2], [x + hw + 5, by + 2], [x + hw + 4, by - 6], [x - hw - 4, by - 6]], { p: seg(p, 0.3, 0.55), seed: s + 2, smooth: false, closed: true, w: 3 });
  I(ctx, [[x - 4, by - 6], [x - 4, cb]], { p: seg(p, 0.5, 0.7), seed: s + 3, w: 3 });
  I(ctx, [[x + 4, by - 6], [x + 4, cb]], { p: seg(p, 0.5, 0.7), seed: s + 4, w: 3 });
  const cap = [[x - 8, cb], [x, top + 14], [x + 8, cb]];
  if (o.fill && o.fp > 0) polyFill(ctx, cap.concat([[x, cb + 3]]), o.fill, { seed: s + 20, p: o.fp, gap: 3.2, lw: 5.5, a: 0.95 });
  I(ctx, [[x - 8, cb], [x, top + 12], [x + 8, cb], [x - 8, cb]], { p: seg(p, 0.65, 0.92), seed: s + 5, smooth: false, w: 3 });
  I(ctx, [[x, top + 12], [x, top - 6]], { p: seg(p, 0.9, 1), seed: s + 6, w: 2.6 });
}
// ahşap ev: gövde + çatı + pencere
function house(ctx, x, base, w, h, o) {
  const p = o.p, s = o.seed;
  const l = x - w / 2, r = x + w / 2, top = base - h;
  const roof = [[l - 5, top], [x, top - w * 0.5], [r + 5, top]];
  if (o.fill && o.fp > 0) polyFill(ctx, roof.concat([[x, top + 2]]), o.fill, { seed: s + 30, p: o.fp, gap: 3.6, lw: 6.5, a: 0.95 });
  if (o.wall && o.fp > 0) polyFill(ctx, [[l, base], [l, top], [r, top], [r, base]], o.wall, { seed: s + 31, p: o.fp, gap: 4.5, lw: 8, a: 0.55 });
  I(ctx, [[l, top], [l, base], [r, base], [r, top]], { p: seg(p, 0, 0.55), seed: s, smooth: false, w: 3 });
  I(ctx, [[l - 5, top], [x, top - w * 0.5], [r + 5, top], [l - 5, top]], { p: seg(p, 0.45, 1), seed: s + 1, smooth: false, w: 3 });
  const wy = base - h * 0.55;
  if (p > 0.85) {
    I(ctx, [[x - w * 0.22, wy - 6], [x - w * 0.22, wy + 6]], { seed: s + 2, w: 2.6 });
    I(ctx, [[x + w * 0.22, wy - 6], [x + w * 0.22, wy + 6]], { seed: s + 3, w: 2.6 });
  }
}
// Galata Kulesi
function galata(ctx, x, base, o) {
  const p = o.p, s = o.seed;
  const l = x - 27, r = x + 27, bal = base - 140, top2 = base - 172;
  if (o.wall && o.fp > 0) polyFill(ctx, [[l + 2, base], [l + 2, bal], [r - 2, bal], [r - 2, base]], o.wall, { seed: s + 40, p: o.fp, gap: 5, lw: 9, a: 0.5 });
  I(ctx, [[l, base], [l + 1, bal + 6]], { p: seg(p, 0, 0.4), seed: s });
  I(ctx, [[r, base], [r - 1, bal + 6]], { p: seg(p, 0, 0.4), seed: s + 1 });
  // balkon
  I(ctx, [[l - 10, bal + 8], [r + 10, bal + 8], [r + 10, bal - 5], [l - 10, bal - 5]], { p: seg(p, 0.38, 0.6), seed: s + 2, smooth: false, closed: true, w: 3.2 });
  // üst gövde
  I(ctx, [[l + 4, bal - 5], [l + 4, top2]], { p: seg(p, 0.55, 0.72), seed: s + 3, w: 3 });
  I(ctx, [[r - 4, bal - 5], [r - 4, top2]], { p: seg(p, 0.55, 0.72), seed: s + 4, w: 3 });
  // külah
  const cone = [[l - 2, top2], [x, top2 - 66], [r + 2, top2]];
  if (o.fill && o.fp > 0) polyFill(ctx, cone.concat([[x, top2 + 3]]), o.fill, { seed: s + 41, p: o.fp, gap: 4, lw: 7, a: 0.95 });
  I(ctx, [[l - 2, top2], [x, top2 - 66], [r + 2, top2], [l - 2, top2]], { p: seg(p, 0.7, 0.95), seed: s + 5, smooth: false, w: 3.2 });
  I(ctx, [[x, top2 - 66], [x, top2 - 84]], { p: seg(p, 0.92, 1), seed: s + 6, w: 2.8 });
  // pencereler ve taş çizgileri
  if (p > 0.8) {
    for (let i = 0; i < 3; i++) I(ctx, [[x - 7 + i * 3, base - 40 - i * 28], [x - 7 + i * 3, base - 26 - i * 28]], { seed: s + 10 + i, w: 2.6 });
    I(ctx, [[x + 12, base - 60], [x + 12, base - 48]], { seed: s + 14, w: 2.4 });
    I(ctx, [[l + 8, base - 100], [l + 18, base - 98]], { seed: s + 15, w: 2.2, col: PAL.ink2, alpha: 0.6 });
    I(ctx, [[r - 18, base - 84], [r - 8, base - 86]], { seed: s + 16, w: 2.2, col: PAL.ink2, alpha: 0.6 });
    // ufacık bayrak
    const fl = Math.sin(TK.S.t * 4 + 1) * 3;
    I(ctx, [[x, top2 - 84], [x + 12, top2 - 80 + fl], [x + 22, top2 - 84 - fl * 0.5], [x + 12, top2 - 88 - fl * 0.3]], { seed: s + 17, w: 2.4, smooth: true });
  }
}

/* ------------------------------------------------------------------ kuşlar ve dalgalar */
function gull(ctx, x, y, sc, ph, t, p, pulse) {
  if (p <= 0) return;
  const fl = Math.sin(t * 4.6 + ph) * 0.75 + pulse * 0.5;
  const ty = (-5 - 9 * fl) * sc, my = (ty * 0.4 - 5) * sc / sc;
  I(ctx, [[x - 21 * sc, y + ty], [x - 11 * sc, y + my], [x, y]], { p: seg(p, 0, 0.55), seed: 300 + Math.floor(ph * 10), w: 3 });
  I(ctx, [[x + 21 * sc, y + ty], [x + 11 * sc, y + my], [x, y]], { p: seg(p, 0.4, 1), seed: 301 + Math.floor(ph * 10), w: 3 });
}
function wave(ctx, x, y, w, p, seed, col, dy) {
  const pts = [[x, y], [x + w * 0.25, y - 6 + dy], [x + w * 0.5, y], [x + w * 0.75, y - 6 - dy], [x + w, y]];
  I(ctx, pts, { p, seed, w: 2.8, col: col || PAL.ink2, alpha: 0.85 });
}

/* ------------------------------------------------------------------ yelkenli */
function boat(ctx, x, y, lt, p) {
  if (p <= 0) return;
  const bob = Math.sin(lt * 1.5) * 3, rot = Math.sin(lt * 1.2 + 1) * 0.035;
  ctx.save();
  ctx.translate(x + Math.sin(lt * 0.35) * 14 + (lt - 4.9) * 6, y + bob);
  ctx.rotate(rot);
  const hull = [[-36, 0], [36, 0], [26, 15], [-26, 15]];
  const sailR = [[4, -70], [4, -6], [42, -6]];
  const sailL = [[-5, -52], [-5, -6], [-28, -6]];
  if (p > 0.55) {
    polyFill(ctx, hull, PAL.orange, { seed: 71, p: seg(p, 0.55, 1), gap: 3.6, lw: 6.5, a: 0.95 });
    polyFill(ctx, sailR, PAL.white, { seed: 72, p: seg(p, 0.6, 1), gap: 4.5, lw: 8, a: 0.9, grain: 0.5 });
    polyFill(ctx, sailL, PAL.pink, { seed: 73, p: seg(p, 0.6, 1), gap: 4, lw: 7, a: 0.9 });
  }
  I(ctx, [[-36, 0], [36, 0], [26, 15], [-26, 15], [-36, 0]], { p: seg(p, 0, 0.4), seed: 74, smooth: false, w: 3.2 });
  I(ctx, [[0, 1], [0, -74]], { p: seg(p, 0.25, 0.5), seed: 75, w: 3 });
  I(ctx, [[4, -70], [4, -6], [42, -6], [4, -70]], { p: seg(p, 0.45, 0.8), seed: 76, smooth: false, w: 2.8 });
  I(ctx, [[-5, -52], [-5, -6], [-28, -6], [-5, -52]], { p: seg(p, 0.6, 0.9), seed: 77, smooth: false, w: 2.8 });
  ctx.restore();
}

/* ------------------------------------------------------------------ kahraman Fincan */
const LOOK_KF = [[0, 0, 0.3], [4.9, 0, 0.3], [5.15, -1, -0.15], [5.55, -1, -0.15], [5.85, 1, -0.2], [6.3, 1, -0.2], [6.6, 0.2, -1], [7.0, 0.2, -1], [7.25, 0, 0.1]];
function lookAt(lt) {
  const K = LOOK_KF;
  if (lt <= K[0][0]) return [K[0][1], K[0][2]];
  for (let i = 0; i < K.length - 1; i++) if (lt < K[i + 1][0]) {
    const u = smooth((lt - K[i][0]) / (K[i + 1][0] - K[i][0]));
    return [lerp(K[i][1], K[i + 1][1], u), lerp(K[i][2], K[i + 1][2], u)];
  }
  return [K[K.length - 1][1], K[K.length - 1][2]];
}
function hero(ctx, lt, info) {
  const A = TK.audio, t = info.t;
  const u = lt - 4.42;
  if (u <= 0) return;
  const pop = easeOutBack(seg(lt, 4.42, 4.98));
  const sc = HS * (0.4 + 0.6 * pop);
  const k = Math.min(A.pulse('low', t, 0.09), 1.2);
  // pop: uzama, sonra ezilme (sönümlü yay)
  let sq = 0.16 * Math.exp(-4 * u) * Math.cos(u * 15);
  sq += k * 0.09 * (lt > 5.2 ? 1 : 0.4) - 0.02;
  // bakınma: gövde hafif eğilir
  const lk = lookAt(lt);
  let rot = lk[0] * 0.045 * (lt > 5 ? 1 : 0);
  // 7.66 sıçrama: önce çömel, sonra fırla
  let dy = Math.min(1, k) * (lt > 5.2 ? 5 : 0);
  const crouch = smooth(seg(lt, 7.22, 7.6)) * (1 - seg(lt, 7.6, 7.66));
  sq -= crouch * 0.17;
  const jt = lt - 7.62;
  if (jt > 0) { const j = Math.min(1, jt / 0.55); dy += Math.sin(j * Math.PI) * 42; sq += 0.2 * Math.sin(j * Math.PI) ; }
  // göz kırpma
  const blinkAt = (a) => { const d = lt - a; return d > 0 && d < 0.16 ? Math.sin((d / 0.16) * Math.PI) : 0; };
  const blink = Math.max(blinkAt(5.42), blinkAt(6.68), blinkAt(7.05), blinkAt(7.24), 0);
  const st = clamp(0.55 + 0.35 * A.env('mid', t), 0, 1);
  const emerge = (1 - pop) * 46;
  ctx.save();
  if (pop < 1) { ctx.beginPath(); ctx.rect(0, 0, 1080, GY + 8); ctx.clip(); }
  P.fincan(ctx, HX, GY + 3 + emerge - dy, {
    s: sc, squash: sq, rot, blink, mood: 'happy', look: lk, steam: seg(lt, 5.0, 5.4) * st,
    p: seg(lt, 4.42, 5.15), seed: 21,
  });
  ctx.restore();
}

/* ------------------------------------------------------------------ SAHNE */
TK.scenes.intro = function draw(ctx, lt, info) {
  const t = info.t, A = TK.audio;
  const pm = A.pulse('mid', t, 0.10), ph = A.pulse('hi', t, 0.10);

  /* --- güneş: 0.4 -> 3.0 sarmal doğar; orta notalarla ışınları nabız atar */
  ctx.save();
  ctx.translate(945, 130); ctx.scale(1 + 0.045 * pm, 1 + 0.045 * pm);
  P.sun(ctx, 0, 0, 40, { p: seg(lt, 0.4, 3.0), seed: 3 });
  ctx.restore();

  /* --- bulut (süzülür) */
  const cp = seg(lt, 2.7, 3.7);
  if (cp > 0) {
    ctx.save();
    ctx.translate(lt * 9, 0);
    P.cloud(ctx, 470, 520, 1.15, { p: cp, seed: 4, fill: lt > 4.6 ? PAL.sky : null });
    ctx.restore();
  }

  /* --- başlık: iki satır el yazısı */
  const T1 = "Türk Kahvesi'nin", T2 = 'Yolculuğu';
  const p1 = seg(lt, 0.31, 1.95), p2 = seg(lt, 2.38, 3.38);
  const ex1 = seg(lt, 6.2, 7.25), ex2 = seg(lt, 6.34, 7.4);
  const titleLine = (str, y, p, ex, seed, ph0) => {
    if (p <= 0) return;
    ctx.save();
    if (ex > 0) {
      const e = ex * ex * (3 - 2 * ex);
      ctx.translate(Math.sin(lt * 3 + ph0) * 7 * e, -e * 70);
      ctx.globalAlpha = 1 - ex * ex;
    }
    TK.text(ctx, str, 540, y, 84, { align: 'center', p, seed, w: 5.6, wob: 1.0 });
    ctx.restore();
  };
  titleLine(T1, 228, p1, ex1, 11, 0);
  titleLine(T2, 322, p2, ex2, 12, 1.7);

  /* --- zemin çizgisi */
  P.ground(ctx, GY, -20, 1100, { p: seg(lt, 1.4, 2.7), seed: 11 });

  /* --- sol tepe + cami */
  const hlp = seg(lt, 2.38, 3.3);
  I(ctx, LC, { p: hlp, seed: 101, w: 3.6, ghost: true });
  if (lt > 3.4) polyFill(ctx, HILL_L, PAL.green, { seed: 102, p: seg(lt, 3.5, 5.0), gap: 8, lw: 14, a: 0.42, grain: 0.9, dens: 0.4 });
  // yan kubbeler, ana kubbe
  dome(ctx, 108, 617, 27, 24, { p: seg(lt, 3.45, 3.95), seed: 110, fill: PAL.pink, fp: seg(lt, 4.55, 5.05), finial: false });
  dome(ctx, 232, 617, 27, 24, { p: seg(lt, 3.55, 4.05), seed: 111, fill: PAL.orange, fp: seg(lt, 4.75, 5.2), finial: false });
  dome(ctx, 170, 611, 50, 54, { p: seg(lt, 3.16, 3.85), seed: 112, fill: PAL.teal, fp: seg(lt, 4.15, 4.85), gap: 5, lw: 9 });
  minaret(ctx, 82, 632, 452, { p: seg(lt, 3.40, 4.05), seed: 120, fill: PAL.orange, fp: seg(lt, 4.9, 5.3) });
  minaret(ctx, 258, 636, 470, { p: seg(lt, 3.65, 4.3), seed: 130, fill: PAL.pink, fp: seg(lt, 5.0, 5.4) });
  // sol yamaç evleri
  const hl = [[300, 40, 36, 3.91, PAL.yellow], [345, 34, 30, 4.15, null], [392, 36, 30, 4.42, PAL.pink]];
  hl.forEach(([x, w, h, t0, fc], i) => house(ctx, x, yOn(LC, x) + 7, w, h, { p: seg(lt, t0, t0 + 0.4), seed: 140 + i * 7, fill: fc, fp: seg(lt, t0 + 0.9, t0 + 1.4) }));

  /* --- sağ tepe + Galata + evler */
  I(ctx, RC, { p: seg(lt, 3.40, 4.3), seed: 201, w: 3.6, ghost: true });
  if (lt > 3.6) polyFill(ctx, HILL_R, PAL.green, { seed: 202, p: seg(lt, 3.8, 5.2), gap: 8, lw: 14, a: 0.42, grain: 0.9, dens: 0.4 });
  galata(ctx, 868, yOn(RC, 868) + 6, { p: seg(lt, 3.91, 4.75), seed: 210, fill: PAL.orange, fp: seg(lt, 4.6, 5.2), wall: PAL.sand, });
  const hr = [[690, 36, 32, 3.65, PAL.pink], [738, 40, 34, 4.15, null], [950, 38, 32, 4.67, PAL.orange], [1000, 40, 34, 4.92, null], [1048, 36, 30, 5.1, PAL.yellow]];
  hr.forEach(([x, w, h, t0, fc], i) => house(ctx, x, yOn(RC, x) + 8, w, h, { p: seg(lt, t0, t0 + 0.4), seed: 240 + i * 7, fill: fc, fp: seg(lt, t0 + 0.8, t0 + 1.3) }));

  /* --- deniz: dalga çizgileri ve yelkenli */
  const rows = [[828, 0], [852, 1], [874, 2]];
  rows.forEach(([y, r], ri) => {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x0 = 40 + i * 210 + (ri % 2) * 95 + Math.sin(lt * 0.9 + i + ri) * 8;
      const at = 2.0 + ri * 0.3 + i * 0.18;
      const wv = Math.sin(lt * 2 + i * 1.3 + ri);
      wave(ctx, x0, y + wv * 2, 64, seg(lt, at, at + 0.5), 400 + ri * 10 + i, ri === 1 ? PAL.blue : PAL.ink2, wv * 2 + ph * 3);
    }
  });
  boat(ctx, 760, 846, lt, seg(lt, 4.97, 5.9));

  /* --- martılar */
  const gulls = [[300, 420, 1.0, 0.0, 2.4], [372, 458, 0.8, 1.3, 2.9], [690, 372, 1.0, 2.1, 3.65], [762, 410, 0.8, 0.7, 3.91], [960, 330, 0.7, 3.3, 4.67]];
  gulls.forEach(([gx, gy, sc, phs, t0], i) => {
    const gp = seg(lt, t0, t0 + 0.5);
    gull(ctx, gx + lt * (10 + i * 2), gy + Math.sin(lt * 1.1 + phs) * 7, sc, phs, t, gp, pm * 0.6);
  });

  /* --- kahraman fincan + alt yazı */
  hero(ctx, lt, info);
  if (lt > 4.6) P.caption(ctx, 'İstanbul', { p: seg(lt, 4.6, 5.5), y: 1040, size: 40 });
};
})();
