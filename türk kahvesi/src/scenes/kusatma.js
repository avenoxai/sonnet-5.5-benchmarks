/* kusatma.js: 1683 Viyana Kuşatması (küresel 39.1 -> 41.1 sn). Kısa, sert "punch" sahne.
 * Sade kompozisyon: solda dev çadır, ortada top + kahraman Fincan, sağda yüksek sur ve kuleler.
 * Davul fill'inin her düşük vuruşunda (A.between ile bağlı) topun ağzından duman + kıvılcım, surda isabet, kamera sarsıntısı. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { ink, crayon, seg, clamp, lerp, easeOut, easeOutBack, rnd01, noise1, arcPts, ellipsePts, blobPts, spiralPts } = TK;

const GY = 790;
function I(ctx, pts, o) { ink(ctx, pts, Object.assign({ w: 3.6, wob: 1.2, ghost: false }, o)); }
function F(ctx, pts, col, o) { TK.crayonPoly(ctx, pts, col, Object.assign({ still: true, jit: 2.5, gap: 4.6, lw: 8 }, o)); }

/* düşük vuruşlar: müzik verisinden (küresel sn -> yerel), güç gerçek değerden türer */
const T0 = 39.1, T1 = 41.1;
function events() {
  const A = TK.audio;
  const raw = A.between('low', T0 + 0.05, T1).filter(e => e.s >= 0.25).map(e => [e.t - T0, clamp(0.55 + e.s * 0.8, 0.6, 1.2)]);
  // son vuruş (41.08) sahne bitmeden görünsün diye 0.15 sn önce bir "ön" patlama
  raw.push([40.93 - T0, 1.0]);
  return raw.sort((a, b) => a[0] - b[0]);
}
let EVC = null;
// surdaki isabet noktaları
const HITS = [[850, 650], [1040, 520], [935, 720], [830, 540], [1060, 430], [900, 610], [1010, 660], [860, 700], [1040, 380], [930, 540]];

/* ------------------------------------------------------------------ gökyüzü (koyu kırmızı üst, turuncu orta, sarı ufuk) */
const SKY = [[-40, -30], [1120, -30], [1120, GY + 8], [-40, GY + 8]];
const SKYY = [[-40, 560], [200, 535], [480, 570], [760, 540], [1120, 565], [1120, GY + 8], [-40, GY + 8]];
const SKYR = [[-40, -30], [1120, -30], [1120, 300], [820, 340], [520, 296], [240, 340], [-40, 300]];

/* ------------------------------------------------------------------ bayrak + hilal */
const CRES = (() => {
  const o = [];
  for (let i = 0; i <= 10; i++) { const a = 0.8 + (2 * Math.PI - 1.6) * i / 10; o.push([Math.cos(a), Math.sin(a)]); }
  for (let i = 0; i <= 8; i++) { const a = 2 * Math.PI - 1.0 - (2 * Math.PI - 2.0) * i / 8; o.push([0.42 + 0.78 * Math.cos(a), 0.78 * Math.sin(a)]); }
  return o;
})();
function flagAt(ctx, lt, fx, fy, sc, seed, t0, hiK) {
  const fl = (Math.sin(lt * 8 + seed) * 4 + hiK * 5) * sc;
  const fp = seg(lt, t0, t0 + 0.24);
  if (fp <= 0) return;
  const flag = [[fx, fy], [fx + 44 * sc, fy + 4 * sc + fl], [fx + 58 * sc, fy + 24 * sc - fl * 0.5], [fx + 42 * sc, fy + 44 * sc + fl * 0.4], [fx, fy + 46 * sc]];
  F(ctx, flag, PAL.paper, { seed: seed + 3, p: fp, gap: 3.4, lw: 6, a: 1 });
  F(ctx, flag, PAL.red, { seed: seed + 4, p: fp, gap: 3.4, lw: 6, a: 1 });
  I(ctx, flag.concat([flag[0]]), { p: fp, seed: seed + 5, w: 3, smooth: true, closed: false });
  if (fp > 0.85) {
    const r = 11 * sc, cx = fx + 24 * sc, cy = fy + 23 * sc + fl * 0.3;
    const cp = CRES.map(([x, y]) => [cx + x * r, cy + y * r]);
    ctx.save(); ctx.beginPath(); cp.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    ctx.fillStyle = PAL.yellow; ctx.globalAlpha = 0.95; ctx.fill(); ctx.restore();
    I(ctx, cp, { seed: seed + 6, w: 2.4, closed: true, smooth: false });
  }
}

/* ------------------------------------------------------------------ sur ve kuleler */
function wall(ctx, lt) {
  const pb = seg(lt, 0.26, 0.6), pf = seg(lt, 0.3, 0.6);
  const x0 = 880, top = 590;
  const body = [[x0, GY], [x0, top], [1120, top], [1120, GY]];
  F(ctx, body, PAL.sand, { seed: 503, p: pf, gap: 4.4, lw: 9 });
  F(ctx, body, PAL.brown, { seed: 504, p: pf, a: 0.28, gap: 8, lw: 9, dens: 0.6 });
  const tp = [[x0 + 10, top]];
  for (let x = x0 + 10; x < 1100; x += 46) tp.push([x, top], [x, top - 30], [x + 28, top - 30], [x + 28, top]);
  I(ctx, tp, { p: seg(pb, 0, 0.7), seed: 510, smooth: false, w: 3.6 });
  [660, 720].forEach((y, r) => {
    I(ctx, [[x0 + 2, y], [1110, y]], { p: seg(pb, 0.3 + r * 0.1, 0.95), seed: 520 + r, w: 2.6, col: PAL.ink2, alpha: 0.7, smooth: false });
    for (let x = x0 + 40 + (r % 2) * 40; x < 1100; x += 80) if (pb > 0.7) I(ctx, [[x, y], [x + 1, y + (r ? 68 : 60)]], { seed: 540 + r * 9 + (x / 80 | 0), w: 2.4, col: PAL.ink2, alpha: 0.65, smooth: false });
  });
  // kapı kemeri (büyük)
  const gate = arcPts(950, 720, 42, 48, Math.PI, Math.PI * 2, 8).concat([[992, GY], [908, GY]]);
  F(ctx, gate, PAL.brown, { seed: 505, p: pf, a: 0.92, gap: 4, lw: 7 });
  I(ctx, gate, { p: seg(pb, 0.5, 1), seed: 530, w: 3.4 });
}
function tower(ctx, lt, x0, x1, top, roofTop, seed, t0, roofCol, hiK) {
  const pb = seg(lt, t0, t0 + 0.32), pf = seg(lt, t0 + 0.04, t0 + 0.36);
  const body = [[x0, GY], [x0, top], [x1, top], [x1, GY]];
  F(ctx, body, PAL.sand, { seed: seed + 2, p: pf, gap: 4.4, lw: 9 });
  F(ctx, body, PAL.brown, { seed: seed + 3, p: pf, a: 0.42, gap: 7, lw: 9, dens: 0.6 });
  const w = x1 - x0, m = w / 5, cw = m * 1.1;
  I(ctx, body, { p: pb, seed, smooth: false, w: 3.8 });
  [x0 - 6, x0 + w * 0.5 - cw / 2, x1 + 6 - cw].forEach((a, i) => {
    I(ctx, [[a, top + 2], [a, top - 28], [a + cw, top - 28], [a + cw, top + 2]], { p: seg(pb, 0.4, 1), seed: seed + 4 + i, smooth: false, w: 3.4 });
  });
  const cx = (x0 + x1) / 2;
  const win = arcPts(cx, top + 100, 14, 22, Math.PI, Math.PI * 2, 6).concat([[cx + 14, top + 140], [cx - 14, top + 140]]);
  F(ctx, win, PAL.brown, { seed: seed + 8, p: seg(pb, 0.5, 1), a: 0.8, gap: 4, lw: 6 });
  I(ctx, win, { p: seg(pb, 0.5, 1), seed: seed + 7, w: 3, closed: true });
  const rf = [[x0 - 12, top - 28], [cx, roofTop], [x1 + 12, top - 28]];
  F(ctx, rf, roofCol, { seed: seed + 9, p: seg(lt, t0 + 0.2, t0 + 0.5), a: 1, gap: 3.8, lw: 7 });
  I(ctx, rf.concat([rf[0]]), { p: seg(lt, t0 + 0.14, t0 + 0.44), seed: seed + 10, smooth: false, w: 3.8 });
  I(ctx, [[cx, roofTop], [cx, roofTop - 46]], { p: seg(lt, t0 + 0.4, t0 + 0.55), seed: seed + 11, w: 3 });
  flagAt(ctx, lt, cx, roofTop - 46, 0.85, seed + 12, t0 + 0.5, hiK);
}

/* ------------------------------------------------------------------ çadır (tek büyük) */
function tent(ctx, lt, cx, apexY, hw, seed, t0, colA, colB, hiK) {
  const pb = seg(lt, t0, t0 + 0.32), pf = seg(lt, t0, t0 + 0.34);
  const shape = [[cx - hw, GY], [cx, apexY], [cx + hw, GY]];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const xa = cx - hw + (2 * hw * i) / n, xb = cx - hw + (2 * hw * (i + 1)) / n;
    const wedge = [[xa, GY], [cx, apexY + 4], [xb, GY]];
    F(ctx, wedge, i % 2 ? colB : colA, { seed: seed + 10 + i, p: pf, gap: i % 2 ? 3.2 : 4, lw: 7, a: 0.97 });
  }
  I(ctx, shape.concat([shape[0]]), { p: pb, seed, smooth: false, w: 4 });
  for (let i = 1; i < n; i++) I(ctx, [[cx - hw + (2 * hw * i) / n, GY], [cx, apexY + 4]], { p: seg(pb, 0.2, 1), seed: seed + 20 + i, smooth: false, w: 2.6, alpha: 0.7 });
  const door = [[cx - hw * 0.2, GY], [cx, GY - 110], [cx + hw * 0.2, GY]];
  F(ctx, door, PAL.brown, { seed: seed + 30, p: seg(pb, 0.4, 1), a: 0.9, gap: 4, lw: 6 });
  I(ctx, door, { p: seg(pb, 0.5, 1), seed: seed + 2, smooth: false, w: 3 });
  const ph = 100;
  I(ctx, [[cx, apexY + 2], [cx, apexY - ph]], { p: seg(lt, t0 + 0.2, t0 + 0.4), seed: seed + 3, w: 3.4 });
  flagAt(ctx, lt, cx, apexY - ph, 1.6, seed + 40, t0 + 0.34, hiK);
}

/* ------------------------------------------------------------------ top (büyütülmüş) */
const CPX = 470, CS = 1.35;
const MZ = [CPX + (616 - 450) * CS, GY - (762 - 720) * CS + 4 - 4 + 0];   // namlu ağzı (dünya koordinatı)
function cannon(ctx, lt, kick) {
  const p = seg(lt, 0.1, 0.34);
  const rc = kick * 16;
  ctx.save();
  ctx.translate(CPX - rc, 762 - 1 + rc * 0.25); ctx.scale(CS, CS); ctx.translate(-450, -762);
  const bp = [[450, 762], [448, 726], [604, 696], [616, 720], [610, 744], [604, 742]];
  F(ctx, bp, PAL.ink2, { seed: 602, p, a: 0.92, gap: 3.6, lw: 7 });
  I(ctx, bp.concat([bp[0]]), { p, seed: 600, smooth: false, w: 3.4 });
  I(ctx, [[590, 700], [594, 742]], { p: seg(p, 0.5, 1), seed: 603, w: 3 });
  I(ctx, [[540, 710], [543, 752]], { p: seg(p, 0.5, 1), seed: 604, w: 3 });
  I(ctx, ellipsePts(610, 720, 7, 23, 8, 0, 0), { p: seg(p, 0.6, 1), seed: 605, w: 3, closed: true, col: PAL.yellow });
  const wc = [520, 758];
  const wheel = ellipsePts(wc[0], wc[1], 32, 32, 12, 0, 0);
  F(ctx, wheel, PAL.brown, { seed: 606, p: seg(p, 0.2, 1), gap: 4, lw: 7, a: 0.95 });
  I(ctx, wheel, { p: seg(p, 0.2, 1), seed: 607, closed: true, w: 3.4 });
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4 + kick * 0.25; I(ctx, [[wc[0] + Math.cos(a) * 30, wc[1] + Math.sin(a) * 30], [wc[0] - Math.cos(a) * 30, wc[1] - Math.sin(a) * 30]], { p: seg(p, 0.6, 1), seed: 608 + i, w: 2.6, col: PAL.paper }); }
  ctx.restore();
}

/* ------------------------------------------------------------------ duman ve patlamalar */
const PUFF = blobPts(0, 0, 60, 50, 77, 11, 0.16);
const PUFF2 = blobPts(0, 0, 60, 50, 78, 11, 0.16);
const SWIRL = spiralPts(0, 0, 8, 42, 1.6, 0.4, 22);
function puff(ctx, lt, te, str, i) {
  const a = lt - te;
  if (a < 0) return;
  const gr = easeOut(a / 0.5);
  const sc = (0.3 + 1.0 * gr) * (0.75 + 0.5 * str);
  const fade = 1 - 0.25 * clamp((a - 0.9) / 1);
  const jx = (rnd01(i, 91) - 0.5) * 24;
  // namludan yukarı ve hafif sola savrulur (surdan uzağa)
  const px = MZ[0] + 4 - a * (26 + (i % 3) * 22) + jx - gr * 24;
  const py = MZ[1] - 20 - easeOut(a / 1.2) * (170 + 40 * str) - (i % 3) * 8;
  ctx.save();
  ctx.translate(px, py); ctx.scale(sc, sc); ctx.globalAlpha = fade;
  const pts = i % 2 ? PUFF : PUFF2;
  crayon(ctx, pts, PAL.paper, { seed: 700 + i, still: true, gap: 3.6, lw: 8, jit: 2, dx: 0, dy: 0 });
  crayon(ctx, pts, PAL.lilac, { seed: 710 + i, still: true, gap: 6, lw: 9, a: 0.55, dens: 0.6 });
  ink(ctx, pts, { w: 3.8 / sc, wob: 1.4 / sc, closed: true, seed: 720 + i, ghost: false, p: seg(a, 0, 0.16) });
  ink(ctx, SWIRL, { w: 3 / sc, wob: 1 / sc, seed: 730 + i, ghost: false, col: PAL.ink2, alpha: 0.8, p: seg(a, 0.05, 0.3) });
  ctx.restore();
}
const STAR8 = (() => { const o = []; for (let i = 0; i < 16; i++) { const r = i % 2 ? 0.5 : 1; const a = i / 16 * Math.PI * 2; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; })();
function burst(ctx, x, y, R, age, seed, cols) {
  if (age < 0 || age > 0.46) return;
  const g = easeOut(age / 0.12), f = 1 - seg(age, 0.24, 0.46);
  const r = R * (0.3 + 0.7 * g) * (0.8 + 0.2 * f);
  const pts = STAR8.map(([a, b]) => [a * 60, b * 60]);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rnd01(seed, 1) * 3); ctx.scale(r / 60, r / 60); ctx.globalAlpha = 0.45 + 0.55 * f;
  crayon(ctx, pts, cols[0], { seed: 800 + seed, still: true, gap: 4, lw: 8, jit: 2, dx: 0, dy: 0 });
  crayon(ctx, STAR8.map(([a, b]) => [a * 34, b * 34]), cols[1], { seed: 820 + seed, still: true, gap: 3.2, lw: 6, jit: 1.5, dx: 0, dy: 0 });
  ink(ctx, pts, { w: 3.6 / (r / 60), closed: true, smooth: false, seed: 840 + seed, wob: 1.2 / (r / 60), ghost: false, p: seg(age, 0, 0.08) });
  ctx.restore();
  for (let k = 0; k < 6; k++) {
    const an = rnd01(seed, 10 + k) * 6.283, d0 = R * 0.9 + g * R * 0.3, d1 = d0 + 16 + R * 0.35 * g;
    if (f < 0.15) continue;
    I(ctx, [[x + Math.cos(an) * d0, y + Math.sin(an) * d0], [x + Math.cos(an) * d1, y + Math.sin(an) * d1]], { seed: 850 + seed * 7 + k, w: 3.2, col: k % 2 ? PAL.yellow : PAL.ink, p: 1 });
  }
}

/* ------------------------------------------------------------------ SAHNE */
TK.scenes.kusatma = function draw(ctx, lt, info) {
  const t = info.t, A = TK.audio;
  if (!EVC) EVC = events();
  const EV = EVC;
  const lo = Math.min(1.3, A.pulse('low', t, 0.09));
  const hi = Math.min(1, A.pulse('hi', t, 0.08));
  const shake = Math.min(1, lo) * 7;
  const sx = noise1(lt * 47, 3) * shake, sy = noise1(lt * 53, 5) * shake * 0.8;

  ctx.save();
  ctx.translate(sx, sy);

  /* gökyüzü: turuncu taban, alta sarı ışık, üste koyu kırmızı; kısa yatay darbeler */
  TK.crayonPoly(ctx, SKY, PAL.orange, { seed: 402, p: easeOut(seg(lt, 0.0, 0.32)), still: true, gap: 12, lw: 26, jit: 5, a: 0.92, dens: 0.7, ang: 0.08, dx: 0, dy: 0 });
  TK.crayonPoly(ctx, SKYY, PAL.yellow, { seed: 403, p: easeOut(seg(lt, 0.1, 0.42)), still: true, gap: 12, lw: 26, jit: 5, a: 0.85, dens: 0.7, ang: 0.08, dx: 0, dy: 0 });
  TK.crayonPoly(ctx, SKYR, PAL.red, { seed: 401, p: easeOut(seg(lt, 0.06, 0.4)), still: true, gap: 12, lw: 26, jit: 5, a: 0.94, dens: 0.7, ang: -0.08, dx: 0, dy: 0 });

  /* güneş */
  if (lt > 0.35) {
    ctx.save(); ctx.translate(215, 165); const b = 1 + 0.05 * lo; ctx.scale(b, b);
    P.sun(ctx, 0, 0, 52, { p: seg(lt, 0.35, 0.75), seed: 5 });
    ctx.restore();
  }

  /* zemin (gökyüzünden sonra) */
  F(ctx, [[-40, GY - 2], [1120, GY - 2], [1120, GY + 44], [-40, GY + 44]], PAL.sand, { seed: 410, p: seg(lt, 0.28, 0.6), a: 0.9, gap: 9, lw: 16 });
  P.ground(ctx, GY, -20, 1100, { p: seg(lt, 0.3, 0.6), seed: 14 });

  /* sur + kuleler */
  wall(ctx, lt);
  tower(ctx, lt, 775, 890, 470, 350, 900, 0.36, PAL.green, hi);
  tower(ctx, lt, 990, 1130, 320, 190, 950, 0.3, PAL.teal, hi);

  /* tek büyük çadır */
  tent(ctx, lt, 118, 470, 150, 1000, 0.38, PAL.red, PAL.paper, hi);

  /* top */
  const lastEv = EV.filter(e => e[0] <= lt).pop();
  const kick = lastEv ? Math.max(0, 1 - (lt - lastEv[0]) / 0.16) * Math.min(1, lastEv[1]) : 0;
  cannon(ctx, lt, kick);

  /* kahraman Fincan: büyük, gözler topun atışını / surun isabetini izler */
  const fp = seg(lt, 0.4, 0.75);
  if (fp > 0) {
    const hop = Math.min(1, lo) * 8;
    const look = [0.85, -0.35 + kick * 0.2];
    P.fincan(ctx, 345, GY - 2 - hop - (1 - easeOutBack(fp)) * 40, {
      s: 0.98, mood: 'wow', look, steam: 0, p: fp, seed: 21, squash: -0.02 + lo * 0.06, blink: 0,
    });
  }

  /* duman, patlamalar, kıvılcım */
  EV.forEach(([te, s], i) => puff(ctx, lt, te, s, i));
  EV.forEach(([te, s], i) => {
    const last = i >= EV.length - 2;   // ön patlama + son vuruş: isabet gecikmesiz
    burst(ctx, MZ[0] + 22, MZ[1] - 6, 48 + s * 30, lt - te, i, [PAL.yellow, PAL.orange]);
    burst(ctx, HITS[i % HITS.length][0], HITS[i % HITS.length][1], 46 + s * 40 + (last ? 20 : 0), lt - te - (last ? 0.02 : 0.08), i + 10, [PAL.orange, PAL.yellow]);
  });

  /* hi vurgusu: topun ağzına yapışık ateş kıvılcımları */
  if (lt > 0.5 && hi > 0.05) {
    for (let i = 0; i < 3; i++) {
      const an = -0.9 + i * 0.55;
      P.sparkle(ctx, MZ[0] + 46 + Math.cos(an) * 46, MZ[1] - 6 + Math.sin(an) * 46, 12 + 24 * hi, { p: 1, seed: 60 + i * 5, col: PAL.yellow, rot: lt * 1.5 + i });
    }
  }
  ctx.restore();

  /* alt yazı (sarsıntısız); ilk vuruş 39.27'de başlar */
  if (lt > 0.16) P.caption(ctx, 'Viyana Kuşatması', { p: seg(lt, 0.17, 0.8), y: 1040, size: 46, w: 3.2, seed: 9 });
};
})();
