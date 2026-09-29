/* yola.js: "Yola çıkış" (küresel 24.9 -> 28.7 sn). Fincan kahvehaneye veda eder, çuvalın içine sıçrar,
 * deve gelir, çöker; çuval semere yüklenir; deve kalkıp sağa yürümeye başlar. Sakin, sade. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { ink, crayon, seg, clamp, lerp, smooth, easeOut, easeInOut, easeOutBack, rnd01, blobPts, ellipsePts, arcPts } = TK;

const GY = 790;
function I(ctx, pts, o) { ink(ctx, pts, Object.assign({ w: 3.4, wob: 1.2, ghost: false }, o)); }
function polyFill(ctx, pts, col, o) { TK.crayonPoly(ctx, pts, col, Object.assign({ still: true, jit: 2.5, gap: 4, lw: 7 }, o)); }
function add(pts, dx, dy) { return pts.map(p => [p[0] + dx, p[1] + dy]); }

/* zaman çizelgesi (yerel sn). Müzik: mid notaları 27.83 (lt 2.93), 28.08 (3.18), 28.33 (3.43); bas 26.78 (1.88) */
const T_SACK = 0.8, T_CROUCH = 1.12, T_JUMP = 1.4, T_LAND = 1.88;
const T_CAM_IN = 0.6, T_CAM_ARR = 1.95, T_KNEEL = 1.95, T_KNEEL_END = 2.2;
const T_LIFT = 2.12, T_LOADED = 2.62;
const CAMX = 740, SACKX = 390, CUPX0 = 250;

/* ------------------------------------------------------------------ küçük kahvehane (uzakta) */
function cafe(ctx, lt, info) {
  const p = seg(lt, 0.0, 0.6), t = info.t;
  if (p <= 0) return;
  const cx = 112, gb = GY;
  // tepecik (perspektif): kahvehane uzakta, minik bir yamaçta
  const hill = arcPts(cx, gb + 2, 120, 26, Math.PI, Math.PI * 2, 12);
  crayon(ctx, hill, PAL.green, { seed: 601, gap: 6, lw: 10, jit: 2, p: seg(p, 0.2, 1), a: 0.45, still: true });
  I(ctx, hill, { seed: 602, p: seg(p, 0, 0.6), w: 2.8 });
  ctx.save();
  ctx.translate(cx, gb - 20); ctx.scale(0.78, 0.78);
  const x = 0, base = 0, w = 116, h = 74, l = x - w / 2, r = x + w / 2, top = base - h;
  const roof = [[l - 10, top], [x, top - 46], [r + 10, top]];
  polyFill(ctx, [[l, base], [l, top], [r, top], [r, base]], PAL.sand, { seed: 610, p: seg(p, 0.5, 1), gap: 5, lw: 9, a: 0.6 });
  polyFill(ctx, roof.concat([[x, top + 2]]), PAL.red, { seed: 611, p: seg(p, 0.6, 1), gap: 4, lw: 7, a: 0.95 });
  I(ctx, [[l, top], [l, base], [r, base], [r, top]], { p: seg(p, 0, 0.5), seed: 612, smooth: false });
  I(ctx, [[l - 10, top], [x, top - 46], [r + 10, top], [l - 10, top]], { p: seg(p, 0.35, 0.85), seed: 613, smooth: false });
  I(ctx, [[x - 30, base], [x - 30, base - 34]].concat(arcPts(x - 15, base - 34, 15, 15, Math.PI, Math.PI * 2, 6)).concat([[x, base - 34], [x, base]]), { p: seg(p, 0.6, 1), seed: 614, smooth: false, w: 2.8 });
  polyFill(ctx, [[x + 18, base - 50], [x + 46, base - 50], [x + 46, base - 24], [x + 18, base - 24]], PAL.sky, { seed: 615, p: seg(p, 0.75, 1), gap: 3.6, lw: 6, a: 0.9 });
  I(ctx, [[x + 18, base - 50], [x + 46, base - 50], [x + 46, base - 24], [x + 18, base - 24]], { p: seg(p, 0.7, 1), seed: 616, smooth: false, closed: true, w: 2.6 });
  if (p > 0.85) {
    P.miniCup(ctx, x, top - 52, 0.34, { steam: 0, seed: 617 });
    const sm = clamp(TK.audio.pulse('mid', t, 0.1), 0, 1.2);
    P.steam(ctx, x + 2, top - 78, { s: 0.42, n: 2, amt: 0.7 + 0.3 * sm, h: 80, seed: 618 });
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ deve */
// sabit geometrili bacak parçaları (önbellek dostu; hareket ctx.rotate ile)
const THIGH = [[-12, -4], [12, -4], [14, 30], [14, 50], [9, 58], [-8, 58], [-10, 30]];
const SHIN = [[-8, -2], [8, -2], [5.5, 30], [6.5, 54], [-6.5, 54], [-5.5, 30]];
const KNEE = ellipsePts(3, 57, 11, 9, 10, 0, 0);
const HOOF = ellipsePts(3, 55, 11, 6, 10, 0, 0);
// yüz sağa bakar; fl = ±1 (yön); kn = çökme 0..1
function camel(ctx, x, y, o) {
  const fl = o.fl, kn = o.kn, ph = o.walk, mv = o.mv, nod = o.nod, s = o.s ?? 1, appear = o.p ?? 1, hop = o.hop ?? 0;
  const dy = 80 * kn;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s * fl, s);
  const YC = PAL.yellow, sd = 700;
  const bob = Math.abs(Math.sin(ph)) * mv * 6;
  ctx.translate(0, -bob - hop);
  const q = (a, b) => clamp((appear - a) / (b - a));
  const drawLeg = (hx, f, front, sdd, dim) => {
    const sw = Math.sin(ph + f * Math.PI * 2), lift = Math.max(0, Math.cos(ph + f * Math.PI * 2));
    const dirF = front ? -1 : 1;
    const th = dirF * 1.17 * kn + (-sw * 0.36 * mv) * (1 - kn);
    const walkRel = lift * 0.75 * mv * (1 - kn);
    const hipY = -112 + dy, yk = hipY + 56 * Math.cos(th);
    const kneeTot = dirF * Math.acos(clamp((-4 - yk) / 56, -1, 1));
    const tot = lerp(th + walkRel, kneeTot, smooth(clamp(kn * 1.5)));
    const col = dim ? PAL.orange : YC, aa = dim ? 0.8 : 0.95;
    ctx.save();
    ctx.translate(hx, hipY); ctx.rotate(th);
    ctx.save(); ctx.translate(0, 56); ctx.rotate(tot - th);
    polyFill(ctx, SHIN, col, { seed: sdd + 50, p: q(0.4, 1), gap: 4, lw: 7, a: aa });
    I(ctx, SHIN, { seed: sdd, closed: true, smooth: false, w: 3.2, p: q(0, 0.5) });
    crayon(ctx, HOOF, PAL.brown, { seed: sdd + 60, gap: 3, lw: 5, jit: 1, p: q(0.5, 1), still: true, a: 0.95 });
    I(ctx, HOOF, { seed: sdd + 3, closed: true, w: 2.8, p: q(0.5, 1) });
    ctx.restore();
    polyFill(ctx, THIGH, col, { seed: sdd + 51, p: q(0.4, 1), gap: 4, lw: 7, a: aa });
    I(ctx, THIGH, { seed: sdd + 1, closed: true, smooth: false, w: 3.2, p: q(0, 0.5) });
    crayon(ctx, KNEE, col, { seed: sdd + 61, gap: 3, lw: 5, jit: 1, p: q(0.5, 1), still: true, a: aa });
    I(ctx, KNEE, { seed: sdd + 2, closed: true, w: 2.6, p: q(0.5, 1) });
    ctx.restore();
  };
  drawLeg(-84, 0.0, false, sd + 10, true);
  drawLeg(96, 0.5, true, sd + 20, true);
  // gövde
  const body = [[-118, -152], [-98, -200], [-40, -214], [40, -212], [100, -196], [124, -160], [106, -122], [40, -108], [-40, -106], [-100, -118]];
  const bodyD = add(body, 0, dy);
  crayon(ctx, bodyD, YC, { seed: sd + 1, gap: 5.4, lw: 10, jit: 3, p: q(0.35, 1), ang: -0.5, a: 0.97, still: true });
  I(ctx, bodyD, { seed: sd + 2, closed: true, p: q(0, 0.5), w: 3.6 });
  // hörgüç
  const hump = [[-72, -205], [-60, -258], [-30, -282], [2, -270], [24, -214]];
  crayon(ctx, add(hump, 0, dy), PAL.orange, { seed: sd + 3, gap: 5, lw: 9, jit: 2.5, p: q(0.4, 1), ang: 0.4, a: 0.9, still: true });
  I(ctx, add(hump, 0, dy), { seed: sd + 4, p: q(0.1, 0.55), w: 3.4 });
  // semer örtüsü
  const bl = [[-78, -212], [-30, -236], [28, -224], [46, -140], [-70, -142]];
  polyFill(ctx, add(bl, 0, dy), PAL.red, { seed: sd + 5, p: q(0.5, 1), gap: 4.4, lw: 8, a: 0.88 });
  I(ctx, add(bl, 0, dy), { seed: sd + 6, closed: true, smooth: false, w: 3, p: q(0.3, 0.7) });
  for (let i = 0; i < 4; i++) I(ctx, add([[-60 + i * 26, -156], [-50 + i * 26, -170], [-40 + i * 26, -156]], 0, dy), { seed: sd + 7 + i, w: 2.6, col: PAL.yellow, p: q(0.7, 1) });
  // kuyruk
  I(ctx, add([[-118, -150], [-142, -140], [-148, -104]], 0, dy), { seed: sd + 12, w: 3.2, p: q(0.4, 0.8) });
  crayon(ctx, add(ellipsePts(-148, -98, 8, 12, 8, 0, 0), 0, dy), PAL.brown, { seed: sd + 13, gap: 3, lw: 5, jit: 1, p: q(0.7, 1), still: true });
  // boyun + baş (başı öne arkaya sallar)
  const nd = nod;
  const neck = [[78, -196], [98, -292 - nd], [138, -326 - nd], [154, -296 - nd], [138, -240], [128, -186]];
  const neckD = neck.map((p, i) => i >= 1 && i <= 3 ? [p[0], p[1] + dy * 0.78 + 0] : [p[0], p[1] + dy]);
  crayon(ctx, neckD, YC, { seed: sd + 14, gap: 5, lw: 9, jit: 2.5, p: q(0.4, 1), ang: 0.9, a: 0.97, still: true });
  I(ctx, neckD, { seed: sd + 15, closed: true, p: q(0.1, 0.55), w: 3.4 });
  const hd = dy * 0.78;
  const head = blobPts(178, -304 - nd + hd, 44, 27, 33, 12, 0.03);
  crayon(ctx, head, YC, { seed: sd + 16, gap: 4.6, lw: 8, jit: 2, p: q(0.5, 1), ang: -0.3, a: 0.97, still: true });
  I(ctx, head, { seed: sd + 17, closed: true, p: q(0.2, 0.6), w: 3.4 });
  // kulak
  I(ctx, [[148, -326 - nd + hd], [142, -350 - nd + hd], [162, -334 - nd + hd]], { seed: sd + 18, w: 3, p: q(0.6, 1) });
  // göz + kirpikler
  const ex = 186, ey = -314 - nd + hd;
  ctx.save();
  ctx.beginPath(); ctx.arc(ex, ey, 9.5, 0, 6.3); ctx.fillStyle = PAL.white; ctx.fill(); ctx.restore();
  I(ctx, ellipsePts(ex, ey, 9.5, 9.5, 12, 0, 0), { seed: sd + 19, closed: true, w: 2.8, p: q(0.6, 1) });
  const bl2 = o.blink ?? 0;
  if (bl2 > 0.5) I(ctx, [[ex - 9, ey], [ex + 9, ey]], { seed: sd + 90, w: 4, col: PAL.ink });
  else {
    ctx.save(); ctx.beginPath(); ctx.arc(ex + 2, ey + 1, 5.4, 0, 6.3); ctx.fillStyle = PAL.ink; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + 4, ey - 1, 1.9, 0, 6.3); ctx.fillStyle = PAL.white; ctx.fill(); ctx.restore();
  }
  I(ctx, [[ex - 6, ey - 10], [ex - 12, ey - 20]], { seed: sd + 20, w: 2.6, p: q(0.7, 1) });
  I(ctx, [[ex, ey - 12], [ex - 3, ey - 24]], { seed: sd + 21, w: 2.6, p: q(0.7, 1) });
  I(ctx, [[ex + 7, ey - 10], [ex + 8, ey - 21]], { seed: sd + 22, w: 2.6, p: q(0.7, 1) });
  // yanak, burun deliği, gülümseme
  crayon(ctx, blobPts(176, -290 - nd + hd, 9, 6, 61, 8, 0.05), PAL.pink, { seed: sd + 23, gap: 3, lw: 5, jit: 1, p: q(0.7, 1), still: true, a: 0.9 });
  I(ctx, [[212, -304 - nd + hd], [214, -302 - nd + hd]], { seed: sd + 24, w: 3.4, p: q(0.7, 1) });
  I(ctx, [[194, -288 - nd + hd], [202, -282 - nd + hd], [214, -288 - nd + hd]], { seed: sd + 25, w: 2.6, p: q(0.7, 1) });
  // ön bacak ve arka bacak (önde)
  drawLeg(-52, 0.5, false, sd + 30, false);
  drawLeg(128, 0.0, true, sd + 40, false);
  ctx.restore();
}

/* ------------------------------------------------------------------ çuval + içindeki Fincan'ın gözleri */
function eye(ctx, x, y, r, dx, dy, blink, seed) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fillStyle = PAL.white; ctx.fill();
  ctx.restore();
  I(ctx, ellipsePts(x, y, r, r, 10, 0, 0), { seed, closed: true, w: 2.6 });
  if (blink > 0.5) { I(ctx, [[x - r, y], [x + r, y]], { seed: seed + 1, w: 3.4 }); return; }
  ctx.save();
  ctx.beginPath(); ctx.arc(x + dx * 3, y + dy * 3, r * 0.58, 0, 6.3); ctx.fillStyle = PAL.ink; ctx.fill();
  ctx.beginPath(); ctx.arc(x + dx * 3 + 2.4, y + dy * 3 - 2.4, r * 0.2, 0, 6.3); ctx.fillStyle = PAL.white; ctx.fill();
  ctx.restore();
}
function sackWithCup(ctx, x, y, s, rot, sx, sy, sackP, cupIn, info, strap, lt) {
  const t = info.t, A = TK.audio;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s * sx, s * sy);
  if (cupIn > 0) {
    const st = clamp(0.5 + 0.5 * A.env('mid', t), 0, 1) * cupIn;
    P.steam(ctx, 0, -204, { s: 1.5, n: 2, amt: st, h: 62, seed: 8 });
  }
  P.sack(ctx, 0, 0, { s: 1, p: sackP, seed: 44 });
  if (strap > 0) {   // yüklenince kırmızı kayış
    I(ctx, [[-64, -34], [-30, -22], [0, -20], [30, -22], [64, -34]], { seed: 46, w: 5, col: PAL.red, p: strap });
    I(ctx, [[-62, -44], [-30, -32], [0, -30], [30, -32], [62, -44]], { seed: 47, w: 3.4, col: PAL.red, p: strap, alpha: 0.7 });
  }
  if (cupIn > 0) {
    const pop = easeOutBack(clamp(cupIn));
    // çuval ağzından görünen fincan üstü
    ctx.save();
    ctx.beginPath(); ctx.rect(-80, -260, 160, 120); ctx.clip();
    ctx.translate(0, -146); ctx.scale(pop, pop); ctx.translate(0, 146);
    const cupTop = blobPts(0, -166, 34, 27, 88, 12, 0.03);
    crayon(ctx, cupTop, PAL.teal, { seed: 89, gap: 3.8, lw: 7, jit: 1.5, p: 1, still: true, a: 0.95 });
    I(ctx, cupTop, { seed: 91, closed: true, w: 3, p: 1 });
    const bl = (lt % 2.6) > 2.45 ? 1 : 0;
    const look = [Math.sin(lt * 1.3) * 0.9, 0.2];
    eye(ctx, -14, -172, 12.5, look[0], look[1], bl, 90);
    eye(ctx, 14, -172, 12.5, look[0], look[1], bl, 93);
    crayon(ctx, blobPts(-28, -160, 6.5, 4, 95, 8, 0.05), PAL.pink, { seed: 96, gap: 3, lw: 5, jit: 1, p: 1, still: true, a: 0.9 });
    crayon(ctx, blobPts(28, -160, 6.5, 4, 97, 8, 0.05), PAL.pink, { seed: 98, gap: 3, lw: 5, jit: 1, p: 1, still: true, a: 0.9 });
    ctx.restore();
    // kırmızı ip ile bağlı ağız: fiyonk
    const bp = seg(cupIn, 0.3, 1);
    if (bp > 0) {
      const loops = [[[0, -141], [-13, -152], [-22, -140], [-7, -136]], [[0, -141], [13, -152], [22, -140], [7, -136]]];
      loops.forEach((lp, i) => {
        crayon(ctx, lp, PAL.red, { seed: 100 + i, gap: 3, lw: 5, jit: 1, p: bp, still: true, a: 0.9 });
        I(ctx, lp, { seed: 102 + i, closed: true, w: 3.4, col: PAL.red, p: bp });
      });
      I(ctx, [[-14, -132], [-24, -118]], { seed: 104, w: 3.2, col: PAL.red, p: bp });
      I(ctx, [[14, -132], [26, -119]], { seed: 105, w: 3.2, col: PAL.red, p: bp });
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ SAHNE */
TK.scenes.yola = function draw(ctx, lt, info) {
  const t = info.t, A = TK.audio;
  const pm = clamp(A.pulse('mid', t, 0.1), 0, 1.2);

  /* müzik notaları: kalkış tamamlanışı, zıpla-dön, ilk adım (27.83 / 28.08 / 28.33) */
  const nev = A.between('mid', 27.7, 28.45).filter(e => e.s > 0.4).map(e => e.t - info.t0);
  const N0 = nev[0] ?? 2.93, N1 = nev[1] ?? 3.18, N2 = nev[2] ?? 3.43;
  const T_STAND = N0 - 0.32, T_STAND_END = N0;          // ayağa kalkış 27.83'te biter
  const T_HOP = N1 - 0.2, T_FLIP = N1 - 0.1;             // 28.08'de tekrar yere iner, dönmüş
  const T_WALK = N1;                                     // ilk adım 28.08, büyük adım 28.33

  /* güneş + bulut (sakin) */
  ctx.save();
  ctx.translate(930, 140); ctx.scale(1 + 0.035 * pm, 1 + 0.035 * pm);
  P.sun(ctx, 0, 0, 40, { p: seg(lt, 0.1, 1.2), seed: 3 });
  ctx.restore();
  const cp = seg(lt, 0.2, 1.4);
  if (cp > 0) { ctx.save(); ctx.translate(lt * 10, 0); P.cloud(ctx, 500, 250, 1.1, { p: cp, seed: 5, fill: PAL.sky }); ctx.restore(); }

  /* küçük kuş (boş orta alan) */
  const bp = seg(lt, 0.5, 1.0);
  if (bp > 0) {
    const bx = lerp(300, 560, seg(lt, 0.5, 3.8)), by = 400 + Math.sin(lt * 1.6) * 14;
    const fl2 = Math.sin(lt * 9 + pm * 3) * 5;
    I(ctx, [[bx - 15, by + 2], [bx - 7, by - 7 - fl2], [bx, by]], { seed: 380, w: 3, p: bp });
    I(ctx, [[bx, by], [bx + 7, by - 7 - fl2], [bx + 15, by + 2]], { seed: 381, w: 3, p: bp });
  }

  /* zemin */
  P.ground(ctx, GY, -20, 1100, { p: seg(lt, 0, 0.7), seed: 11 });
  if (lt > 0.4) {
    P.grass && P.grass(ctx, 470, GY, { s: 0.7, p: seg(lt, 0.4, 0.9), seed: 71 });
    P.grass && P.grass(ctx, 990, GY, { s: 0.9, p: seg(lt, 0.7, 1.2), seed: 73 });
    P.grass && P.grass(ctx, 250, GY, { s: 0.6, p: seg(lt, 0.5, 1.0), seed: 75 });
  }

  cafe(ctx, lt, info);

  /* ---------------- deve */
  const camIn = seg(lt, T_CAM_IN, T_CAM_ARR);
  let camX = lerp(1340, CAMX, easeOut(camIn));
  const kn = smooth(seg(lt, T_KNEEL, T_KNEEL_END)) * (1 - smooth(seg(lt, T_STAND, T_STAND_END)));
  // yön: sola bakarak gelir; zıplayıp (havada) hızla döner
  const flp = smooth(seg(lt, T_FLIP - 0.04, T_FLIP + 0.04));
  let fl = -1 + 2 * flp;
  fl = (fl < 0 ? -1 : 1) * Math.max(0.32, Math.abs(fl));
  const hop = 44 * Math.sin(Math.PI * seg(lt, T_HOP, N1));
  let mv = (camIn > 0 && camIn < 1) ? (1 - smooth(seg(camIn, 0.85, 1))) : 0;
  let walkPh = lt * 7.5;
  if (lt > T_HOP && lt < T_WALK) mv = 0.5 * Math.sin(Math.PI * seg(lt, T_HOP, T_WALK));
  if (lt >= T_WALK) {
    const u = lt - T_WALK, sp = 260;
    const dist = u < 0.25 ? sp * u * u / 0.5 : sp * (u - 0.125);
    camX = CAMX + dist;
    mv = smooth(clamp(u / 0.15)) * (1 + 0.15 * clamp(A.pulse('low', t, 0.1), 0, 1));
    walkPh = 2.0 + u * 11;
  }
  const nod = (Math.sin(lt * 2.2) * 5 + pm * 8) * (kn > 0.5 ? 0.4 : 1);
  const cblink = (lt % 2.2) > 2.06 ? 1 : 0;
  const camAlpha = seg(lt, T_CAM_IN, T_CAM_IN + 0.35);
  const camelOn = camAlpha > 0;
  const camelY = GY + 4;

  /* ---------------- fincan sıçraması */
  const cupS0 = 0.6;
  const sackP = seg(lt, T_SACK, T_SACK + 0.7);
  const mouthY = GY - 150;
  const jp = clamp((lt - T_JUMP) / (T_LAND - T_JUMP));
  const cupPop = seg(lt, 0.1, 0.75);
  const cupIn = seg(lt, T_LAND, T_LAND + 0.25);

  const lp = seg(lt, T_LIFT, T_LOADED);
  const sackHump = () => {  // devenin hörgücü üstünde çuval tabanı (dünya koordinatı)
    return [camX + fl * -22, camelY - (Math.abs(Math.sin(walkPh)) * mv * 6) - hop + 80 * kn - 224];
  };
  let groundSack = null;
  if (lt < T_LIFT) {
    const u = lt - T_LAND;
    let sqy = 1, sqx = 1, rot = 0;
    if (u > 0) { const d = Math.exp(-6 * u) * Math.cos(u * 22); sqy = 1 - 0.16 * d; sqx = 1 + 0.12 * d; }
    if (u > 0.3) rot = Math.sin(lt * 5) * 0.03 * pm + Math.sin(lt * 2) * 0.012;
    groundSack = [SACKX, GY + 2, 1.0, rot, sqx, sqy];
  }

  if (camelOn) camel(ctx, camX, camelY, { fl, kn, walk: walkPh, mv, nod, p: camAlpha, blink: cblink, hop });

  /* fincan: çuvala girerken (ağız hizasından sonra çuvalın ARKASINDA kalır) */
  const drawCup = () => {
    let x = CUPX0, y = GY + 3, s = cupS0, rot = 0, sq = 0;
    let lk = [-1, 0.1];
    const pop = easeOutBack(cupPop);
    s = cupS0 * (0.5 + 0.5 * pop);
    y += (1 - pop) * 40;
    const k = Math.min(A.pulse('low', t, 0.09), 1);
    sq = k * 0.05 - 0.01;
    const wave = seg(lt, 0.85, 1.2) * (1 - seg(lt, 1.2, 1.3));
    rot = Math.sin((lt - 0.85) * 16) * 0.12 * wave;
    lk = lt < 1.15 ? [-1, 0.15] : [1, -0.1];
    if (lt >= T_CROUCH && lt < T_JUMP) sq = -0.18 * smooth(seg(lt, T_CROUCH, T_JUMP));
    if (lt >= T_JUMP) {
      const e = jp;
      x = lerp(CUPX0, SACKX, e);
      const yEnd = mouthY + 70;
      y = lerp(GY + 3, yEnd, e * e * 0.35 + e * 0.65 * e) - Math.sin(e * Math.PI) * 250;
      s = cupS0 * lerp(1, 0.4, easeInOut(e));
      sq = 0.2 * Math.sin(e * Math.PI) * (1 - e) + (e > 0.8 ? -0.1 : 0);
      rot = -0.25 * Math.sin(e * Math.PI) + e * 0.03;
    }
    P.fincan(ctx, x, y, {
      s, squash: sq, rot, blink: (lt > 0.6 && lt < 0.7) ? 1 : 0, mood: lt > T_JUMP ? 'wow' : 'happy', look: lk,
      steam: lt > 0.9 && lt < T_JUMP ? clamp(0.5 + 0.4 * A.env('mid', t), 0, 1) : (lt >= T_JUMP ? 0.6 : 0.4 * seg(lt, 0.6, 1.0)), p: seg(lt, 0.1, 0.8), seed: 21,
    });
  };
  const cupOn = lt < T_LAND && cupPop > 0;
  const cupBehind = lt >= T_JUMP && jp > 0.6;
  if (cupOn && !cupBehind) drawCup();
  if (cupOn && cupBehind) drawCup();   // çuvaldan önce çizilir (arkada kalır)

  /* çuval */
  if (lt < T_LIFT) {
    if (sackP > 0) sackWithCup(ctx, ...groundSack, sackP, cupIn, info, 0, lt);
  } else if (lt < T_LOADED) {
    const hp = sackHump();
    const e = easeInOut(lp);
    const x = lerp(SACKX, hp[0], e), y = lerp(GY + 2, hp[1], e) - Math.sin(lp * Math.PI) * 130;
    const sc = lerp(1.0, 0.72, e);
    const sx = 1 + 0.1 * Math.sin(lp * Math.PI), sy = 1 - 0.06 * Math.sin(lp * Math.PI);
    sackWithCup(ctx, x, y, sc, Math.sin(lp * 6.3) * 0.12, sx, sy, 1, 1, info, 0, lt);
  } else {
    const hp = sackHump();
    const u = lt - T_LOADED;
    const d = Math.exp(-7 * u) * Math.cos(u * 20);
    sackWithCup(ctx, hp[0], hp[1] + 4, 0.72, Math.sin(walkPh) * 0.03 * mv, 1 + 0.1 * d, 1 - 0.12 * d, 1, 1, info, seg(lt, T_LOADED, T_LOADED + 0.25), lt);
  }

  // iniş: çuval ağzından pırıltı
  if (lt >= T_LAND && lt < T_LAND + 0.7 && lt < T_LIFT) {
    const u = (lt - T_LAND) / 0.7, fade = 1 - u;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.7;
      const rr = 40 + 40 * easeOut(u);
      P.sparkle(ctx, SACKX + Math.cos(a) * rr, GY - 180 + Math.sin(a) * rr, 9 * fade, { p: 1, seed: 300 + i, col: i === 1 ? PAL.yellow : PAL.pink });
    }
  }
  // yüklenince pırıltı
  if (lt >= T_LOADED && lt < T_LOADED + 0.6) {
    const u = (lt - T_LOADED) / 0.6;
    const hp = sackHump();
    P.sparkle(ctx, hp[0] - 70, hp[1] - 90 - 10 * u, 10 * (1 - u), { seed: 320, col: PAL.yellow });
    P.sparkle(ctx, hp[0] + 70, hp[1] - 80 - 10 * u, 8 * (1 - u), { seed: 324, col: PAL.pink });
  }

  /* ---------------- alt yazı (İ noktası ayrıca çizilir: fontta nokta çok küçük) */
  const cap = "İstanbul'dan uzağa", cpp = seg(lt, 0.5, 1.7), csz = 40;
  if (cpp > 0) {
    P.caption(ctx, cap, { p: cpp, y: 1040, size: csz });
    if (cpp > 0.06) {
      const left = TK.W / 2 - TK.textWidth(cap, csz) / 2, sc = csz / 1000;
      const dx = left + 303 * sc + 1.5, dyy = 1040 - 839 * sc;
      ctx.save(); ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(dx, dyy - 1, 2.6, 0, 6.3); ctx.fill(); ctx.restore();
    }
  }
};
})();
