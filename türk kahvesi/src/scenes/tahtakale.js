/* tahtakale.js: 1554-55, İstanbul Tahtakale'de ilk kahvehane (küresel 7.7 -> 24.9 sn, lt 0..17.2).
 * A (lt 0..8.8): kahvehane cephesi çizilir, cezve köpürür (darbuka), pencerede iki kurucu, Fincan zıplar.
 * B (lt 8.8..17.2): kamera kayar (16.5 vurgusu), taburelerde müşteriler, konuşma balonları, fincan el değiştirir,
 *    24.0'dan sonra sakinleşip el sallanır, Fincan yola bakar.
 * SAF: her kare yalnızca lt/info.t fonksiyonu. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { ink, crayon, seg, clamp, lerp, smooth, easeOut, easeOutBack, easeInOut, rnd01, arcPts, ellipsePts, blobPts } = TK;

const GY = 790, T0 = 7.7, PAN = 90;
const CX = 570, HEROX = 885;          // ocak ve kahraman (dünya x)

function I(ctx, pts, o) { ink(ctx, pts, Object.assign({ w: 3.4, wob: 1.2, ghost: false }, o)); }
function poly(ctx, pts, col, o) { TK.crayonPoly(ctx, pts, col, Object.assign({ still: true, jit: 2.5, gap: 4.4, lw: 8, a: 0.95 }, o)); }
const pop = (u, d = 0.4) => easeOutBack(clamp(u / d));
function kf(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (u < b[0]) return lerp(a[1], b[1], smooth((u - a[0]) / (b[0] - a[0])));
  }
  return keys[keys.length - 1][1];
}

/* ------------------------------------------------------------------ kahvehane cephesi */
function cafe(ctx, lt) {
  const L = 92, R = 428, TOP = 440;
  const wp = seg(lt, 0.2, 1.25), rp = seg(lt, 1.0, 1.8), dp = seg(lt, 1.4, 2.2);
  // boyalar önce (çizgi üstte)
  if (lt > 1.9) {
    poly(ctx, [[L + 4, GY - 4], [L + 4, TOP + 6], [R - 4, TOP + 6], [R - 4, GY - 4]], PAL.yellow, { seed: 601, p: seg(lt, 1.9, 3.5), gap: 7, lw: 12, a: 0.5 });
  }
  if (lt > 2.6) poly(ctx, [[72, 442], [150, 354], [370, 354], [448, 442]], PAL.orange, { seed: 602, p: seg(lt, 2.6, 3.5), gap: 4.6, lw: 8.5 });
  I(ctx, [[L, GY], [L, TOP], [R, TOP], [R, GY]], { p: wp, seed: 610, smooth: false, w: 3.8 });
  I(ctx, [[70, 444], [150, 350], [370, 350], [450, 444], [70, 444]], { p: rp, seed: 611, smooth: false, w: 3.8 });
  // çatı kiremitleri
  if (rp > 0.9) {
    I(ctx, [[112, 400], [400, 400]], { seed: 612, w: 2.4, col: PAL.brown, alpha: 0.75, p: seg(lt, 2.3, 2.9) });
    I(ctx, [[90, 422], [430, 422]], { seed: 613, w: 2.4, col: PAL.brown, alpha: 0.75, p: seg(lt, 2.4, 3.0) });
  }
  // tahta çizgileri
  for (let i = 0; i < 5; i++) {
    const x = 118 + i * 74 + (i > 1 ? 40 : 0);
    if (x > 190 && x < 330) continue;
    I(ctx, [[x, 600 + (i % 2) * 20], [x + 2, 700 + (i % 3) * 14]], { seed: 620 + i, w: 2.2, col: PAL.brown, alpha: 0.55, p: seg(lt, 2.6 + i * 0.1, 3.2 + i * 0.1) });
  }
  // kemerli kapı
  const door = [[200, GY], [200, 650]].concat(arcPts(260, 650, 60, 52, Math.PI, Math.PI * 2, 9).slice(1, -1), [[320, 650], [320, GY]]);
  if (lt > 3.0) poly(ctx, door.concat([[260, GY - 4]]), PAL.coffee, { seed: 630, p: seg(lt, 3.0, 3.9), gap: 5, lw: 9, a: 0.85 });
  I(ctx, door, { p: dp, seed: 631, smooth: false, w: 3.8 });
  // kapı sıcak ışık: küçük sarı yarım daire
  if (lt > 3.6) poly(ctx, ellipsePts(260, 745, 26, 30, 9, 0, 0), PAL.yellow, { seed: 632, p: seg(lt, 3.6, 4.3), gap: 4, lw: 7, a: 0.75 });
  // tabela
  const sp = seg(lt, 3.0, 3.8);
  I(ctx, [[222, 456], [222, 470]], { seed: 640, w: 2.6, p: sp });
  I(ctx, [[298, 456], [298, 470]], { seed: 641, w: 2.6, p: sp });
  if (lt > 3.1) poly(ctx, [[196, 468], [324, 468], [324, 524], [196, 524]], PAL.teal, { seed: 642, p: seg(lt, 3.1, 4.0), gap: 4.4, lw: 8 });
  I(ctx, [[194, 466], [326, 466], [326, 525], [194, 525], [194, 466]], { seed: 643, smooth: false, w: 3.4, p: sp });
  TK.text(ctx, 'KAHVE', 260, 508, 40, { align: 'center', p: seg(lt, 3.3, 4.3), col: PAL.paper, seed: 644, w: 4.2 });
  // pencereler
  const wins = [[148, 640, 4.06, PAL.orange], [372, 641, 4.57, PAL.white]];
  wins.forEach(([cx, sd, tp, hc], i) => {
    const l = cx - 42, r = cx + 42, tp0 = 468, bt = 580;
    const p = seg(lt, 2.7 + i * 0.25, 3.5 + i * 0.25);
    if (lt > 3.2) poly(ctx, [[l + 2, tp0 + 2], [r - 2, tp0 + 2], [r - 2, bt], [l + 2, bt]], PAL.sky, { seed: sd + 20, p: seg(lt, 3.2, 3.9), gap: 5, lw: 8, a: 0.55 });
    const q = seg(lt, tp, tp + 0.7);
    if (q > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(l, tp0, r - l, bt - tp0); ctx.clip();
      const bob = clamp(TK.audio.pulse(i ? 'mid' : 'low', T0 + lt, 0.1), 0, 1) * 0.5;
      P.person(ctx, cx, bt + 10 - 12 * (1 - pop(lt - tp, 0.5)), { s: 0.32, hat: i ? 'sarik' : 'fes', robe: i ? PAL.teal : PAL.red, beard: i === 1, arms: 'down', p: q, seed: sd + 5, bob, face: 'smile' });
      ctx.restore();
    }
    I(ctx, [[l, tp0], [r, tp0], [r, bt], [l, bt], [l, tp0]], { seed: sd, smooth: false, w: 3.2, p });
    I(ctx, [[l - 6, bt + 4], [r + 6, bt + 4]], { seed: sd + 1, w: 3, p: seg(lt, 3.2, 3.8) });
  });
}

/* ------------------------------------------------------------------ ocak + cezve */
function stove(ctx, lt, t, A) {
  const sp = seg(lt, 2.2, 2.9);
  if (sp <= 0) return;
  const x = CX, top = 742;
  // alev
  const fl = clamp(A.pulse('hi', t, 0.1) * 0.6 + 0.4 + A.env('low', t) * 0.3, 0, 1.3) * seg(lt, 3.0, 3.6);
  if (fl > 0.01) {
    for (let i = 0; i < 4; i++) {
      const fx = x - 42 + i * 28, h = (20 + 12 * ((i % 2) ? 1 : 0.6)) * fl + 4 * Math.sin(t * 9 + i * 2);
      I(ctx, [[fx - 8, top], [fx - 3, top - h * 0.6], [fx + 1, top - h], [fx + 5, top - h * 0.5], [fx + 9, top]], { seed: 660 + i, w: 3, col: PAL.red, wob: 0.8 });
    }
    poly(ctx, [[x - 40, top], [x - 30, top - 26], [x - 14, top - 8], [x, top - 32], [x + 16, top - 8], [x + 30, top - 26], [x + 40, top]], PAL.yellow, { seed: 665, p: seg(lt, 3.0, 3.6), gap: 3.4, lw: 6, a: 0.9 });
  }
  poly(ctx, [[x - 62, top + 4], [x + 62, top + 4], [x + 50, GY - 4], [x - 50, GY - 4]], PAL.gray, { seed: 661, p: seg(lt, 2.4, 3.2), gap: 4.6, lw: 8, a: 0.7 });
  I(ctx, [[x - 66, top], [x + 66, top], [x + 52, GY], [x - 52, GY], [x - 66, top]], { seed: 662, smooth: false, w: 3.6, p: sp });
  for (let i = 0; i < 3; i++) I(ctx, [[x - 34 + i * 30, top + 22], [x - 30 + i * 30, top + 30]], { seed: 668 + i, w: 2.4, col: PAL.ink2, alpha: 0.6, p: seg(lt, 2.8, 3.2) });
  // cezve
  const cp = seg(lt, 2.77, 3.6);
  if (cp > 0) {
    const k = clamp(A.pulse('low', t, 0.09), 0, 1.3);
    const jump = lt > 2.77 && lt < 3.4 ? Math.sin(seg(lt, 2.77, 3.4) * Math.PI) * 26 : 0;
    const base = 0.5 * smooth(seg(lt, 3.6, 4.8)) * (1 - 0.6 * smooth(seg(lt, 5.6, 6.8)));
    const spike = lt > 4.82 ? Math.exp(-(lt - 4.82) / 0.55) * 0.6 : 0;
    const foam = clamp((base + spike + (lt > 3.8 ? 0.3 * k * (1 - 0.5 * seg(lt, 5.6, 6.8)) : 0)) * seg(lt, 3.6, 4.0));
    const sc = 0.75;
    ctx.save();
    ctx.translate(x, top - 4 - jump);
    ctx.rotate(Math.sin(t * 7) * 0.012 * k + (lt > 4.82 && lt < 5.3 ? Math.sin((lt - 4.82) * 40) * 0.03 : 0));
    ctx.scale(1 + 0.03 * k, 1 - 0.03 * k);
    P.cezve(ctx, 0, 0, { s: sc, p: cp, foam, seed: 31 });
    ctx.restore();
    const st = seg(lt, 3.2, 4.0) * clamp(0.55 + 0.4 * A.env('mid', t) + spike * 0.6, 0, 1);
    if (st > 0.02) P.steam(ctx, x, top - 4 - 145 * sc - jump, { s: 0.9, n: 3, amt: st, h: 110 + 70 * spike, seed: 9 });
  }
}

/* ------------------------------------------------------------------ küçük ayrıntılar */
function rug(ctx, p) {
  if (p <= 0) return;
  const pts = [[690, 800], [1170, 800], [1188, 826], [672, 826]];
  poly(ctx, pts, PAL.red, { seed: 740, p, gap: 5, lw: 9, a: 0.5 });
  I(ctx, pts.concat([pts[0]]), { seed: 741, smooth: false, w: 2.8, p: seg(p, 0, 0.8) });
  for (let i = 0; i < 9; i++) I(ctx, [[720 + i * 52, 808], [732 + i * 52, 819]], { seed: 745 + i, w: 2.2, col: PAL.yellow, p: seg(p, 0.5, 1) });
}
function stool(ctx, x, seat, p, seed) {
  if (p <= 0) return;
  I(ctx, [[x - 30, seat + 2], [x - 40, GY]], { seed, w: 3.2, p: seg(p, 0, 0.5) });
  I(ctx, [[x + 30, seat + 2], [x + 40, GY]], { seed: seed + 1, w: 3.2, p: seg(p, 0.1, 0.6) });
  I(ctx, [[x - 34, GY - 26], [x + 34, GY - 26]], { seed: seed + 2, w: 2.4, col: PAL.ink2, alpha: 0.7, p: seg(p, 0.3, 0.8) });
  const top = ellipsePts(x, seat + 2, 46, 9, 12, 0, 0);
  if (p > 0.4) crayon(ctx, top, PAL.brown, { seed: seed + 3, gap: 3.6, lw: 6, jit: 1.5, p: seg(p, 0.4, 1), still: true, dx: 0, dy: 0, a: 0.95 });
  I(ctx, top, { seed: seed + 4, w: 3.2, closed: true, p: seg(p, 0.3, 0.9) });
}
function table(ctx, x, p) {
  if (p <= 0) return;
  const top = GY - 62;
  I(ctx, [[x - 6, top + 8], [x - 8, GY]], { seed: 710, w: 3.4, p: seg(p, 0, 0.5) });
  I(ctx, [[x + 6, top + 8], [x + 8, GY]], { seed: 711, w: 3.4, p: seg(p, 0, 0.5) });
  I(ctx, [[x - 30, GY], [x + 30, GY]], { seed: 712, w: 3.2, p: seg(p, 0.3, 0.7) });
  const t = ellipsePts(x, top, 62, 10, 14, 0, 0);
  if (p > 0.4) crayon(ctx, t, PAL.orange, { seed: 713, gap: 3.6, lw: 6, jit: 1.5, p: seg(p, 0.4, 1), still: true, dx: 0, dy: 0, a: 0.95 });
  I(ctx, t, { seed: 714, w: 3.4, closed: true, p: seg(p, 0.2, 0.8) });
}
function cat(ctx, lt, t, A, x) {
  const p = seg(lt, 8.9, 9.6);
  if (p <= 0) return;
  const hi = clamp(A.pulse('hi', t, 0.12), 0, 1.2);
  const y = GY;
  const body = blobPts(x, y - 30, 26, 30, 77, 9, 0.05);
  const tail = [[x - 24, y - 6], [x - 48, y - 12], [x - 62 - 4 * hi, y - 34 - 8 * hi], [x - 56 - 10 * hi, y - 60 - 6 * Math.sin(t * 5)]];
  I(ctx, tail, { seed: 720, w: 5, col: PAL.orange, p: seg(p, 0, 0.6), wob: 0.8 });
  I(ctx, tail, { seed: 721, w: 2.4, p: seg(p, 0, 0.6), wob: 0.6 });
  crayon(ctx, body, PAL.orange, { seed: 722, gap: 4, lw: 7, jit: 2, p: seg(p, 0.3, 1), still: true, a: 0.95 });
  I(ctx, body, { seed: 723, w: 3.4, closed: true, p: seg(p, 0, 0.6) });
  const hd = [x + 8, y - 72];
  const head = blobPts(hd[0], hd[1], 22, 19, 78, 9, 0.04);
  crayon(ctx, head, PAL.orange, { seed: 724, gap: 4, lw: 7, jit: 2, p: seg(p, 0.4, 1), still: true, a: 0.95 });
  I(ctx, head, { seed: 725, w: 3.4, closed: true, p: seg(p, 0.2, 0.7) });
  I(ctx, [[hd[0] - 20, hd[1] - 10], [hd[0] - 15, hd[1] - 32], [hd[0] - 4, hd[1] - 17]], { seed: 726, w: 3, smooth: false, p: seg(p, 0.5, 0.9) });
  I(ctx, [[hd[0] + 4, hd[1] - 17], [hd[0] + 15, hd[1] - 32], [hd[0] + 20, hd[1] - 10]], { seed: 727, w: 3, smooth: false, p: seg(p, 0.5, 0.9) });
  if (p > 0.8) {
    const bl = (t * 0.37) % 2.6 > 2.5;
    for (const sg of [-1, 1]) {
      if (bl) I(ctx, [[hd[0] + sg * 9 - 4, hd[1] - 2], [hd[0] + sg * 9 + 4, hd[1] - 2]], { seed: 728 + sg, w: 2.4 });
      else { ctx.save(); ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(hd[0] + sg * 9, hd[1] - 2, 3, 0, 6.29); ctx.fill(); ctx.restore(); }
    }
    I(ctx, [[hd[0] - 2, hd[1] + 5], [hd[0] + 2, hd[1] + 5], [hd[0], hd[1] + 8]], { seed: 730, w: 2.2 });
    I(ctx, [[hd[0] - 12, hd[1] + 6], [hd[0] - 30, hd[1] + 3]], { seed: 731, w: 1.8, col: PAL.ink2 });
    I(ctx, [[hd[0] + 12, hd[1] + 6], [hd[0] + 30, hd[1] + 3]], { seed: 732, w: 1.8, col: PAL.ink2 });
    I(ctx, [[x - 6, y - 50], [x + 2, y - 42]], { seed: 733, w: 2.2, col: PAL.brown });
    I(ctx, [[x + 8, y - 54], [x + 14, y - 44]], { seed: 734, w: 2.2, col: PAL.brown });
  }
}

/* konuşma balonu: içeriği kind'a göre karalama / nota / nokta / kalp / yıldız / fincan */
function bubble(ctx, x, y, age, kind, seed) {
  const u = pop(age, 0.32);
  if (u <= 0) return;
  const out = 1 - smooth(seg(age, 1.5, 1.8));
  if (out <= 0.01) return;
  ctx.save();
  ctx.translate(x, y + 36); ctx.scale(u * out, u * out); ctx.translate(0, -36);
  const b = blobPts(0, 0, 66, 42, seed, 12, 0.04);
  crayon(ctx, b, PAL.white, { seed: seed + 1, gap: 4, lw: 8, jit: 1.5, p: 1, still: true, a: 0.9, grain: 0.4 });
  I(ctx, b, { seed, w: 3.2, closed: true });
  I(ctx, [[-14, 38], [-4, 58], [10, 38]], { seed: seed + 2, w: 3, smooth: false });
  poly(ctx, [[-12, 38], [-4, 54], [8, 38]], PAL.white, { seed: seed + 3, gap: 4, lw: 6, a: 0.95 });
  const q = seg(age, 0.18, 0.7);
  if (kind === 0) {
    I(ctx, [[-38, -10], [-24, -16], [-10, -8], [4, -16], [20, -8], [38, -14]], { seed: seed + 4, w: 2.6, p: q, col: PAL.ink2 });
    I(ctx, [[-38, 10], [-22, 4], [-6, 12], [14, 4], [28, 10]], { seed: seed + 5, w: 2.6, p: seg(age, 0.3, 0.8), col: PAL.ink2 });
  } else if (kind === 1) {
    const nh = ellipsePts(-10, 14, 12, 9, 9, -0.4, 0);
    crayon(ctx, nh, PAL.teal, { seed: seed + 4, gap: 3, lw: 5, jit: 1, p: 1, still: true, dx: 0, dy: 0 });
    I(ctx, nh, { seed: seed + 5, w: 2.8, closed: true, p: q });
    I(ctx, [[1, 12], [1, -24], [22, -14]], { seed: seed + 6, w: 3, p: q });
    I(ctx, [[26, 0], [30, -6]], { seed: seed + 7, w: 2.4, p: seg(age, 0.5, 0.9), col: PAL.ink2 });
  } else if (kind === 2) {
    for (let i = 0; i < 3; i++) {
      const bp = ellipsePts(-26 + i * 26, 2, 5.5, 5.5, 7, 0, 0);
      crayon(ctx, bp, PAL.orange, { seed: seed + 4 + i, gap: 2.6, lw: 4, jit: 0.5, p: 1, still: true, dx: 0, dy: 0 });
      I(ctx, bp, { seed: seed + 8 + i, w: 2.4, closed: true, p: seg(age, 0.15 + i * 0.12, 0.5 + i * 0.12) });
    }
  } else if (kind === 3) {
    const h = [[0, 16], [-24, -2], [-22, -18], [-8, -22], [0, -12], [8, -22], [22, -18], [24, -2]];
    crayon(ctx, h, PAL.pink, { seed: seed + 4, gap: 3.4, lw: 6, jit: 1, p: 1, still: true, dx: 0, dy: 0, a: 0.95 });
    I(ctx, h, { seed: seed + 5, w: 3, closed: true, p: q });
  } else if (kind === 4) {
    const st = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 11 : 25; st.push([Math.cos(a) * r, Math.sin(a) * r + 2]); }
    crayon(ctx, st, PAL.yellow, { seed: seed + 4, gap: 3.2, lw: 5.5, jit: 1, p: 1, still: true, dx: 0, dy: 0, a: 0.95 });
    I(ctx, st, { seed: seed + 5, w: 2.8, closed: true, p: q, smooth: false });
  } else {
    P.miniCup(ctx, 0, 24, 0.42, { seed: seed + 4, p: q, steam: 0.6 });
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ müşteriler */
const CUST = [
  { x: 790, t0: 16.07, hat: 'fes', hatCol: PAL.red, robe: PAL.teal, beard: false, flip: 1, seed: 811 },
  { x: 985, t0: 18.12, hat: 'sarik', hatCol: PAL.white, robe: PAL.orange, beard: true, flip: -1, seed: 822 },
  { x: 1105, t0: 18.63, hat: 'fes', hatCol: PAL.red, robe: PAL.pink, beard: false, flip: -1, seed: 833 },
];
const CUP_HAS = [
  (t) => t < 18.63 || t >= 21.5,
  (t) => t >= 19.33 && t < 22.72,
  (t) => t < 20.68 || t >= 23.4,
];
const FLIGHTS = [
  { a: 0, b: 1, t: 18.63, d: 0.7, h: 100 },
  { a: 2, b: 0, t: 20.68, d: 0.85, h: 130 },
  { a: 1, b: 2, t: 22.72, d: 0.7, h: 90 },
];
const SPEAK = [[0, 17.89, 0], [1, 18.65, 1], [2, 19.66, 2], [0, 20.42, 3], [1, 21.21, 4], [2, 21.95, 5], [0, 22.73, 1], [1, 23.25, 3], [2, 23.76, 0]];
const SEAT = GY - 60, CS = 0.85;

function sway(A, t, k) {
  let b = 0;
  for (const e of A.between('low', t - 0.7, t + 0.0001)) {
    const n = A.count('low', e.t, T0 - 0.1);
    if (n % 3 === k) b += e.s * Math.exp(-(t - e.t) / 0.17);
  }
  for (const f of FLIGHTS) if (f.b === k) { const d = t - (f.t + f.d); if (d > 0 && d < 0.7) b += 0.9 * Math.exp(-d / 0.16); }
  return clamp(b, 0, 1.2);
}
const handPos = (c) => [c.x + c.flip * 52 * CS, SEAT + 34 * CS - 126 * CS];

function customers(ctx, lt, t, A) {
  const calm = 1 - 0.55 * smooth(seg(t, 24.0, 24.6));
  CUST.forEach((c, k) => {
    const p = seg(t, c.t0, c.t0 + 1.0);
    if (p <= 0) return;
    stool(ctx, c.x, SEAT, seg(t, c.t0 - 0.1, c.t0 + 0.5), c.seed + 100);
    const sw = sway(A, t, k) * calm;
    const wave = t > 24.05 + k * 0.12;
    const has = CUP_HAS[k](t);
    const arms = wave ? 'up' : has ? 'cup' : 'down';
    const blink = ((t * 0.43 + k * 0.7) % 3.1) > 2.98 ? 1 : 0;
    P.person(ctx, c.x, SEAT + 34 * CS, {
      s: CS, hat: c.hat, hatCol: c.hatCol, robe: c.robe, beard: c.beard, flip: c.flip, seed: c.seed,
      arms, cup: has && !wave, steam: has ? 0.5 : 0, bob: sw, rot: (k % 2 ? -1 : 1) * sw * 0.05 + (wave ? Math.sin(t * 8 + k) * 0.08 : 0),
      p, blink, face: sway(A, t, k) > 0.7 && !wave ? 'o' : 'smile',
    });
  });
  // konuşma balonları
  SPEAK.forEach(([k, ts, kind], i) => {
    const age = t - ts;
    if (age < 0 || age > 1.8) return;
    const c = CUST[k];
    bubble(ctx, c.x + c.flip * 18, SEAT + 34 * CS - 300 * CS - 62, age, kind, 900 + i * 11);
  });
  // uçan fincanlar
  FLIGHTS.forEach((f, i) => {
    const u = (t - f.t) / f.d;
    if (u < 0 || u > 1) return;
    const A0 = handPos(CUST[f.a]), B0 = handPos(CUST[f.b]);
    const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
    const x = lerp(A0[0], B0[0], e), y = lerp(A0[1], B0[1], e) - f.h * 4 * u * (1 - u);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(u * Math.PI * 2) * 0.45 * (f.b > f.a ? 1 : -1)); ctx.scale(1 + 0.08 * Math.sin(u * 9), 1);
    P.miniCup(ctx, 0, 14, 0.4, { seed: 40 + i, col: PAL.teal, steam: 0 });
    ctx.restore();
    // ardından pırıltılar
    for (let j = 1; j <= 3; j++) {
      const uu = u - j * 0.07;
      if (uu <= 0) continue;
      const ee = uu * uu * (3 - 2 * uu) * 0.35 + uu * 0.65;
      P.sparkle(ctx, lerp(A0[0], B0[0], ee), lerp(A0[1], B0[1], ee) - f.h * 4 * uu * (1 - uu) + 10, 5 + 3 * (4 - j), { seed: 950 + j + i * 5, p: 1 - j * 0.25, col: j % 2 ? PAL.yellow : PAL.orange });
    }
  });
}

/* ------------------------------------------------------------------ kahraman Fincan */
function hero(ctx, lt, t, A) {
  const hp = seg(lt, 0.1, 0.75);
  if (hp <= 0) return;
  const k = clamp(A.pulse('low', t, 0.09), 0, 1.2);
    // masaya sıçrama (17.10 low olayı)
  const jt = lt - 9.66;
  let baseY = GY;
  let air = 0;
  if (jt > 0) {
    const j = clamp(jt / 0.5);
    baseY = lerp(GY, GY - 72, easeOut(j));
    air = Math.sin(j * Math.PI) * 55;
    if (j >= 1) baseY = GY - 72;
  }
  const crouch = smooth(seg(lt, 9.3, 9.62)) * (1 - seg(lt, 9.62, 9.66));
  let sq = k * 0.09 - 0.02 - crouch * 0.16 + (jt > 0 && jt < 0.5 ? 0.18 * Math.sin(jt / 0.5 * Math.PI) : 0);
  if (jt > 0.5) sq -= 0.08 * Math.exp(-(jt - 0.5) * 8) * Math.cos((jt - 0.5) * 14);
  // ilk beliriş: pop
  const u = lt - 0.1;
  sq += 0.16 * Math.exp(-4 * Math.max(u, 0)) * Math.cos(Math.max(u, 0) * 15) * (u < 1.2 ? 1 : 0);
  const emerge = (1 - easeOutBack(hp)) * 40;
  // bakış
  let look;
  if (t >= 24.0) look = [lerp(0, 1, smooth(seg(t, 24.0, 24.3))), 0.1];
  else if (lt < 4.4) look = [kf(lt, [[0.7, 0.5], [1.5, -0.6], [3.0, -0.8], [3.8, -0.8], [4.4, -0.9]]), 0.2];
  else if (lt < 8.8) look = [kf(lt, [[4.4, -0.9], [5.4, -0.4], [6.5, 0.7], [7.6, -0.3], [8.8, -0.8]]), 0.15];
  else {
    let lx = -0.5, ly = 0.2;
    for (const f of FLIGHTS) if (t > f.t - 0.1 && t < f.t + f.d + 0.2) {
      lx = f.b > f.a ? (f.b === 1 ? 0.9 : -0.9) * 0 + (CUST[f.a].x < CUST[f.b].x ? 0.9 : -0.9) : 0;
      ly = -0.7;
    }
    look = [lx, ly];
  }
  const bl = (a) => { const d = lt - a; return d > 0 && d < 0.16 ? Math.sin(d / 0.16 * Math.PI) : 0; };
  const blink = Math.max(bl(1.9), bl(6.3), bl(11.0), bl(13.9), bl(19.0), bl(22.2), bl(25) * 0);
  const wow = lt > 4.8 && lt < 5.6 || (t > 18.55 && t < 18.75);
  const st = clamp(0.5 + 0.35 * A.env('mid', t), 0, 1) * seg(lt, 0.9, 1.4);
  const cal = t > 24 ? 0.5 : 1;
  ctx.save();
  if (hp < 1) { ctx.beginPath(); ctx.rect(0, 0, 2000, GY + 6); ctx.clip(); }
  P.fincan(ctx, HEROX, baseY + 2 + emerge - air - (jt > 0.5 ? Math.min(1, k) * 4 * cal : Math.min(1, k) * 4 * cal), {
    s: 0.6, squash: sq * cal + sq * (1 - cal) * 0, rot: Math.sin(t * 1.6) * 0.02 * cal, blink, look, mood: wow ? 'wow' : 'happy', steam: st, p: hp, seed: 21,
  });
  ctx.restore();
}

/* ------------------------------------------------------------------ SAHNE */
TK.scenes.tahtakale = function draw(ctx, lt, info) {
  const t = info.t, A = TK.audio;
  const pm = A.pulse('mid', t, 0.1);

  // güneş + bulut (ekrana sabit)
  ctx.save();
  ctx.translate(930, 130); ctx.scale(1 + 0.04 * pm, 1 + 0.04 * pm);
  P.sun(ctx, 0, 0, 36, { p: seg(lt, 0.6, 2.6), seed: 3 });
  ctx.restore();
  const cp = seg(lt, 1.6, 2.6);
  if (cp > 0) { ctx.save(); ctx.translate(Math.sin(lt * 0.3) * 20 + lt * 3 - 0.4 * PAN * easeInOut(seg(lt, 8.3, 9.4)), 0); P.cloud(ctx, 640, 220, 0.9, { p: cp, seed: 4, fill: lt > 3.6 ? PAL.sky : null }); ctx.restore(); }

  // zemin çizgisi
  P.ground(ctx, GY, -20, 1100, { p: seg(lt, 0, 1.0), seed: 11 });

  // dünya (kamera kayar)
  const pan = PAN * easeInOut(seg(lt, 8.3, 9.4));
  ctx.save();
  ctx.translate(-pan, 0);
  P.grass(ctx, 520, GY, 0.8, { p: seg(lt, 1.2, 1.8), seed: 2 });
  P.grass(ctx, 770, GY, 0.7, { p: seg(lt, 1.5, 2.1), seed: 5 });
  P.grass(ctx, 1010, GY, 0.8, { p: seg(lt, 1.7, 2.3), seed: 8 });
  cafe(ctx, lt);
  // kurucu isimleri (duvarda, pencerelerin altında)
  TK.text(ctx, 'Halepli Hakem', 152, 622, 18, { align: 'center', p: seg(lt, 5.0, 6.2), seed: 61, w: 2.2 });
  TK.text(ctx, 'Şamlı Şems', 366, 622, 18, { align: 'center', p: seg(lt, 5.6, 6.6), seed: 62, w: 2.2 });
  rug(ctx, seg(lt, 9.2, 10.0));
  stove(ctx, lt + 1.2, t, A);
  table(ctx, HEROX, seg(lt, 9.1, 9.55));
  cat(ctx, lt, t, A, 462);
  hero(ctx, lt, t, A);
  customers(ctx, lt, t, A);
  ctx.restore();

  // alt yazı
  const c1 = seg(lt, 0.6, 2.4), fo1 = 1 - smooth(seg(lt, 8.5, 8.95));
  if (c1 > 0 && fo1 > 0.02) { ctx.save(); ctx.globalAlpha = fo1; P.caption(ctx, 'Tahtakale, İstanbul', { p: c1, y: 1040, size: 40, seed: 5 }); ctx.restore(); }
  const c2 = seg(lt, 8.95, 9.75);
  if (c2 > 0) P.caption(ctx, 'rivayete göre ilk kahvehane', { p: c2, y: 1040, size: 40, seed: 6 });
};
})();
