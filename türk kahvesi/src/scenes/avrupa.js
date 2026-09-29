/* avrupa.js: KAHVE BÜTÜN AVRUPA'YA (küresel 57.5 -> 73.3 sn)
 * 4 kart, sayfa çevirmeyle: Paris (57.5) - Venedik (61.63) - Leipzig (65.73) - Avrupa haritası (69.84).
 * Müzik: en yoğun bölüm. Sayfa çevirme cümle başlarında; Leipzig'de her 'mid' olayında bir nota; harita kartında
 * her vuruşta yeni bir minik fincan. 72.9-73.3 doruk: harita dolar, pırıltı.
 * SAF: her kare yalnızca info.t'nin fonksiyonu. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { clamp, lerp, smooth, easeOut, easeInOut, easeOutBack, seg, rnd01, noise1, ellipsePts, arcPts, blobPts } = TK;
const W = 1080, H = 1080;

const B = [57.5, 61.63, 65.73, 69.84, 73.3];          // kart sınırları (cümle başları)
const PRE = 0.34, POST = 0.42;                          // sayfa çevirme penceresi (sınırın öncesi/sonrası)
const START = [B[0], B[1] - PRE, B[2] - PRE, B[3] - PRE];   // kartın yerel saatinin sıfırı

const PALE_Y = TK.mixHex(PAL.yellow, PAL.paper, 0.55);
const PALE_S = TK.mixHex(PAL.sky, PAL.paper, 0.35);
const PALE_T = TK.mixHex(PAL.teal, PAL.paper, 0.45);
const RUST = TK.mixHex(PAL.red, PAL.orange, 0.35);

const ink = (ctx, pts, o) => TK.ink(ctx, pts, Object.assign({ w: 3.6, seed: 1, ghost: false }, o));
const poly = (ctx, pts, fill, p, seed, fo, o) => P.shape(ctx, pts, Object.assign({ fill, p, seed, fillOpts: Object.assign({ gap: 5.6, lw: 10, jit: 3 }, fo) }, o));

/* ------------------------------------------------------------- yardımcılar */
// yazı: aksan (é è) fontta yok, e üstüne elle çizilir (kalın ve büyük)
function caption(ctx, str, p, accents) {
  const size = 40, y = 1040;
  P.caption(ctx, str, { p, y, size, seed: 77 });
  if (!accents || p < 0.5) return;
  const L = TK.textLayout(str, size);
  const x0 = W / 2 - L.width / 2;
  for (const a of accents) {
    const pre = TK.textWidth(str.slice(0, a.i), size), we = TK.textWidth(str[a.i], size);
    const cx = x0 + pre + we / 2 + 0.06 * size;
    const pa = clamp((p - a.at) / 0.06);
    if (pa <= 0) continue;
    const yy = y - size * 0.8;
    const d = a.kind === 'acute' ? 1 : -1;
    ink(ctx, [[cx - d * size * 0.13, yy + size * 0.17], [cx + d * size * 0.13, yy - size * 0.13]], { w: 3.8, seed: 91 + a.i, p: pa, wob: 0.3 });
  }
}

// büyük boya alanı: tek önbellekli bitmap, soldan sağa açılan maskeyle "boyanır" (pahalı p adımı yok)
function bigFill(ctx, pts, col, o, prog) {
  if (prog <= 0) return;
  ctx.save();
  if (prog < 1) {
    const X = -60 + (W + 300) * easeInOut(prog);
    ctx.beginPath(); ctx.moveTo(-60, -60);
    for (let y = -60; y <= H + 60; y += 40) ctx.lineTo(X + Math.sin(y * 0.021 + X * 0.01) * 26, y);
    ctx.lineTo(-60, H + 60); ctx.closePath(); ctx.clip();
  }
  const fn = o.sharp ? TK.crayonPoly : TK.crayon;
  fn(ctx, pts, col, Object.assign({ still: true, p: 1, jit: 3 }, o));
  ctx.restore();
}

// perukun ön kısmı: yüz açıkta kalsın diye peruk yüzü örtmeden, alından ve yanlardan sarar (kişi hat:'none' ile çizilir)
function wigFront(ctx, x, y, s, seed, p, bob) {
  const hp = clamp((p - 0.6) / 0.4);
  if (hp <= 0) return;
  const K = 1 / s, b = bob || 0;
  ctx.save(); ctx.translate(x, y - b * 10 * s); ctx.scale(s, s * (1 + b * 0.03));
  const IK = (pts, o) => ink(ctx, pts, Object.assign({ w: 3.4 * K, wob: 1 * K, seed, ghost: false, p: hp }, o));
  const cap = [[-42, -224], [-52, -256], [-34, -286], [0, -298], [34, -286], [52, -256], [42, -224], [32, -240], [16, -248], [0, -241], [-16, -248], [-32, -240]];
  TK.crayon(ctx, cap, '#ffffff', { seed: seed + 50, gap: 4 * K, lw: 8 * K, jit: 2, p: hp, a: 1, grain: 0.4 });
  IK(cap, { closed: true, seed: seed + 51 });
  for (const sg of [-1, 1]) {
    for (let j = 0; j < 2; j++) {
      const cx = sg * (50 - j * 3), cy = -214 + j * 30;
      const cu = blobPts(cx, cy, 13, 15, seed + 70 + j + sg, 8, 0.04);
      TK.crayon(ctx, cu, '#ffffff', { seed: seed + 72 + j + sg, gap: 3.6 * K, lw: 7 * K, jit: 1, p: hp, a: 1, grain: 0.4, dx: 0, dy: 0 });
      IK(cu, { closed: true, seed: seed + 74 + j + sg, w: 3 * K });
      IK(TK.spiralPts(cx, cy, 2, 8, 1.3, j, 9), { w: 2.2 * K, seed: seed + 76 + j + sg });
    }
  }
  for (let i = 0; i < 5; i++) IK(TK.spiralPts(-30 + i * 15, -270 + Math.abs(i - 2) * 6, 2, 8, 1.3, i, 9), { w: 2.2 * K, seed: seed + 80 + i });
  ctx.restore();
}

// nota (♪ ya da ♫)
function note(ctx, x, y, sc, col, seed, alpha, kind, rot) {
  if (alpha <= 0.02 || sc <= 0.02) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
  const K = 1 / sc;
  const head = (hx, hy) => {
    ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(hx, hy, 12, 8.5, -0.45, 0, 6.29); ctx.fill(); ctx.restore();
    ink(ctx, ellipsePts(hx, hy, 12, 8.5, 9, -0.45, 0), { w: 3.2 * K, closed: true, seed: seed + 1, wob: 0.6 * K });
  };
  if (kind === 1) {
    head(0, 0); head(38, -8);
    ink(ctx, [[10, -3], [11, -58]], { w: 3.4 * K, seed: seed + 2, wob: 0.6 * K });
    ink(ctx, [[48, -11], [49, -66]], { w: 3.4 * K, seed: seed + 3, wob: 0.6 * K });
    ink(ctx, [[11, -58], [49, -66]], { w: 6 * K, seed: seed + 4, wob: 0.6 * K });
  } else {
    head(0, 0);
    ink(ctx, [[10, -3], [11, -58]], { w: 3.4 * K, seed: seed + 2, wob: 0.6 * K });
    ink(ctx, [[11, -58], [26, -46], [32, -30]], { w: 3.4 * K, seed: seed + 3, wob: 0.6 * K });
  }
  ctx.restore();
}

// kırılgan ipucu: küçük kuş (v)
function bird(ctx, x, y, s, flap, seed, p) {
  const w = 22 * s, up = (10 + 12 * flap) * s;
  ink(ctx, [[x - w, y - up], [x - w * 0.4, y - up * 0.2], [x, y]], { w: 3, seed, p, wob: 0.6 });
  ink(ctx, [[x, y], [x + w * 0.4, y - up * 0.2], [x + w, y - up]], { w: 3, seed: seed + 1, p, wob: 0.6 });
}

/* =================================================================================================
 * KART 1: PARİS 1686, Café Procope (kırmızı - turkuaz)
 * ================================================================================================= */
function paris(ctx, t, u, info) {
  const q = (a, b) => seg(u, a, b);
  const low = A().pulse('low', t, 0.1), mid = A().pulse('mid', t, 0.14), hi = A().pulse('hi', t, 0.1);

  // gökyüzü
  P.sun(ctx, 170, 128, 34, { p: q(0.05, 0.9), seed: 3 });
  ctx.save(); ctx.translate(Math.sin(u * 0.5) * 10, 0);
  P.cloud(ctx, 460, 150, 0.9, { p: q(0.15, 0.9), seed: 5, fill: PAL.sky });
  ctx.restore();
  bird(ctx, 350, 290, 0.9, 0.5 + 0.5 * Math.sin(t * 7), 60, q(0.5, 0.9));
  bird(ctx, 395, 262, 0.7, 0.5 + 0.5 * Math.sin(t * 7 + 1.4), 62, q(0.55, 0.95));

  P.ground(ctx, 790, -20, 1100, { p: q(0, 0.5), seed: 11 });
  // arnavut kaldırım taşları
  for (let i = 0; i < 9; i++) {
    const x = 60 + i * 120 + (rnd01(4, i) - 0.5) * 40, y = 820 + (i % 2) * 20;
    ink(ctx, arcPts(x, y, 24, 8, 3.4, 6.0, 5), { w: 2.6, col: PAL.ink2, alpha: 0.6, p: q(0.3 + i * 0.03, 0.8 + i * 0.03), seed: 200 + i, wob: 0.6 });
  }

  // ---- cephe (sağ), biraz küçültülmüş
  ctx.save(); ctx.translate(985, 790); ctx.scale(0.85, 0.85); ctx.translate(-985, -790);
  const wall = [[575, 790], [572, 336], [975, 338], [978, 790]];
  poly(ctx, wall, PALE_Y, q(0.15, 1.0), 31, { gap: 9, lw: 15, ang: -0.6, a: 0.8, dens: 0.42, still: true });
  const roof = [[546, 340], [608, 240], [942, 242], [1002, 344]];
  poly(ctx, roof, PAL.teal, q(0.45, 1.25), 32, { gap: 6.5, lw: 11, ang: -0.9, still: true });
  ink(ctx, [[708, 244], [708, 196], [746, 196], [746, 246]], { p: q(0.7, 1.1), seed: 33, smooth: false });
  P.steam(ctx, 727, 190, { s: 0.9, n: 1, amt: q(0.9, 1.4) * (0.6 + 0.3 * mid), seed: 6, h: 70 });
  // üst kat pencereleri; panjurlar sadece çizgi
  for (let i = 0; i < 2; i++) {
    const wx = 630 + i * 220, pw = q(0.7 + i * 0.12, 1.3);
    poly(ctx, [[wx, 392], [wx, 490], [wx + 92, 490], [wx + 92, 392]], PAL.sky, pw, 40 + i, { gap: 5, lw: 9, a: 0.9 });
    ink(ctx, [[wx + 46, 392], [wx + 46, 490]], { w: 2.6, p: pw, seed: 44 + i });
    ink(ctx, [[wx, 441], [wx + 92, 441]], { w: 2.6, p: pw, seed: 46 + i });
    for (const sx of [wx - 28, wx + 100]) {
      ink(ctx, [[sx, 388], [sx, 494], [sx + 22, 494], [sx + 22, 388]], { w: 3, p: pw, seed: 50 + i + sx, smooth: false, col: PAL.red });
      for (let k = 0; k < 4; k++) ink(ctx, [[sx + 2, 406 + k * 24], [sx + 20, 406 + k * 24]], { w: 2.2, p: pw, seed: 54 + k + sx, col: PAL.red, wob: 0.3 });
    }
  }
  // kapı
  const door = [[706, 790], [706, 662], [722, 626], [770, 610], [820, 626], [836, 662], [836, 790]];
  poly(ctx, door, PAL.yellow, q(0.8, 1.5), 60, { gap: 5, lw: 9, a: 0.9 }, { smooth: true });
  ink(ctx, [[771, 612], [771, 790]], { w: 2.6, p: q(1.2, 1.6), seed: 61 });
  // tente (kırmızı-beyaz çizgili), vuruşta hafif sallanır
  ctx.save(); ctx.translate(0, low * 2.2);
  for (let i = 0; i < 6; i++) {
    const xt0 = lerp(582, 968, i / 6), xt1 = lerp(582, 968, (i + 1) / 6), xb0 = lerp(560, 992, i / 6), xb1 = lerp(560, 992, (i + 1) / 6);
    const pp = q(0.4 + i * 0.06, 0.95 + i * 0.06);
    poly(ctx, [[xt0, 522], [xt1, 522], [xb1, 592], [xb0, 592]], i % 2 ? null : PAL.red, pp, 70 + i, { gap: 5.6, lw: 10, ang: -1.2 }, { w: 3.2 });
    ink(ctx, arcPts((xb0 + xb1) / 2, 592, (xb1 - xb0) / 2, 15, 0.05, Math.PI - 0.05, 5), { w: 3.2, p: pp, seed: 90 + i });
  }
  ctx.restore();
  ctx.restore();
  // sallanan tabela (bina sol kenarında)
  {
    const pv = q(1.0, 1.6);
    ctx.save(); ctx.translate(600, 452); ctx.rotate(0.045 * Math.sin(t * 2.6) + 0.09 * low);
    ink(ctx, [[0, 0], [-22, 44]], { w: 2.6, p: pv, seed: 100 }); ink(ctx, [[0, 0], [24, 44]], { w: 2.6, p: pv, seed: 101 });
    poly(ctx, [[-46, 44], [-46, 128], [46, 128], [46, 44]], PAL.white, pv, 102, { gap: 6, lw: 10 });
    P.miniCup(ctx, 0, 118, 0.4, { col: PAL.red, seed: 103, p: pv });
    ctx.restore();
    ink(ctx, [[640, 452], [600, 452]], { w: 4, p: pv, seed: 104 });
  }

  // ---- masa (orta), büyük
  const pt = q(0.35, 1.1);
  const top = ellipsePts(445, 712, 150, 27, 16, 0, 0);
  TK.crayon(ctx, top, PAL.teal, { seed: 110, gap: 5.5, lw: 10, jit: 3, p: pt, ang: -0.3, a: 0.95 });
  ink(ctx, top, { closed: true, p: pt, seed: 111 });
  ink(ctx, [[428, 738], [424, 788]], { p: pt, seed: 112 }); ink(ctx, [[462, 738], [466, 788]], { p: pt, seed: 113 });
  ink(ctx, ellipsePts(445, 790, 62, 10, 10, 0, 0), { closed: true, p: pt, seed: 114 });

  // ---- perukalı düşünür (1.45x), gazete okur
  const sway = 0.02 * Math.sin(t * 2.2) + 0.03 * low;
  const pp0 = q(0.25, 1.3);
  const PS = 1.45;
  P.person(ctx, 175, 790, { s: PS, robe: PAL.blue, hat: 'none', arms: 'both', p: pp0, bob: low * 0.4, seed: 120, face: 'smile', blink: Math.sin(t * 1.1) > 0.97 ? 1 : 0 });
  wigFront(ctx, 175, 790, PS, 120, pp0, low * 0.4);
  {
    const pn = q(1.0, 1.55);
    ctx.save(); ctx.translate(175, 590 - low * 4); ctx.rotate(sway + 0.02 * hi);
    // katlı gazete: iki sayfa, ortada kat çizgisi
    poly(ctx, [[-74, -52], [-3, -60], [-3, 48], [-70, 44]], PAL.white, pn, 130, { gap: 6, lw: 10, a: 0.95 });
    poly(ctx, [[3, -60], [76, -50], [72, 46], [3, 48]], PAL.white, pn, 131, { gap: 6, lw: 10, a: 0.95 });
    ink(ctx, [[0, -60], [0, 48]], { w: 2.2, p: pn, seed: 132, col: PAL.ink2, alpha: 0.7 });
    ink(ctx, [[-62, -36], [-12, -40]], { w: 6, p: pn, seed: 133 });
    ink(ctx, [[12, -36], [64, -32]], { w: 6, p: pn, seed: 134 });
    ink(ctx, [[-62, -18], [-24, -19], [-22, 8], [-60, 9], [-62, -18]], { w: 2.4, p: q(1.2, 1.6), seed: 135, smooth: false });
    for (let i = 0; i < 3; i++) ink(ctx, [[-16, -20 + i * 14], [-6, -19 + i * 14]], { w: 2.2, p: q(1.25, 1.6), seed: 136 + i, col: PAL.ink2, alpha: 0.7, wob: 0.4 });
    for (let i = 0; i < 4; i++) {
      const y0 = -14 + i * 14, pr = q(1.25 + i * 0.05, 1.65);
      ink(ctx, [[14, y0], [40, y0 - 1], [66, y0 + 1]], { w: 2.2, p: pr, seed: 140 + i, col: PAL.ink2, alpha: 0.7, wob: 0.4 });
    }
    for (let i = 0; i < 3; i++) ink(ctx, [[-62, 18 + i * 10], [-30, 17 + i * 10], [-10, 18 + i * 10]], { w: 2.2, p: q(1.3, 1.65), seed: 150 + i, col: PAL.ink2, alpha: 0.7, wob: 0.4 });
    ctx.restore();
  }

  // ---- kahraman Fincan masada
  P.fincanAlive(ctx, 470, 708, info, { s: 0.78, p: q(0.7, 1.6), steam: 0.6, hop: 0.6, seed: 21, look: [-0.7 + 0.2 * Math.sin(t), 0.2], bounce: 1.2 });
  // vurgu anlarında pırıltı
  for (const e of A().between('mid', 57.5, Math.min(t, 61.7))) {
    if (e.s < 0.7) continue;
    const a = t - e.t; if (a < 0 || a > 0.45) continue;
    const k = Math.round(e.t * 100) % 3;
    P.sparkle(ctx, 330 + k * 90, 470 - k * 14, 12 + 8 * e.s, { p: easeOut(seg(a, 0, 0.14)) * (1 - seg(a, 0.25, 0.45)), seed: 300 + k, col: k % 2 ? PAL.orange : PAL.yellow, rot: 0.3 * k });
  }
}

/* =================================================================================================
 * KART 2: VENEDİK 1720, Caffè Florian (sarı - mavi)
 * ================================================================================================= */
function venedik(ctx, t, u, info) {
  const q = (a, b) => seg(u, a, b);
  const low = A().pulse('low', t, 0.1), mid = A().pulse('mid', t, 0.14), hi = A().pulse('hi', t, 0.1);
  const QY = 652;                                     // rıhtım çizgisi

  // su: alt kenarı dalgalı/organik, iki yanı taşar
  const water = [[-40, 676]];
  for (let k = 0; k <= 8; k++) water.push([-40 + k * 150, 672 + Math.sin(k * 1.3) * 3]);
  const wb = [];
  for (let k = 8; k >= 0; k--) wb.push([-40 + k * 150, 852 + Math.sin(k * 1.9 + 0.6) * 14 + (k % 2) * 6]);
  const waterPts = water.concat(wb);
  bigFill(ctx, waterPts, PAL.sky, { seed: 210, gap: 10, lw: 17, ang: -0.1, a: 0.85, dens: 0.4 }, q(0.05, 0.9));
  bigFill(ctx, [[-40, 742], [1100, 738], [1100, 830], [700, 848], [300, 836], [-40, 840]], PAL.blue, { seed: 211, gap: 13, lw: 19, ang: -0.05, a: 0.42, dens: 0.3 }, q(0.3, 1.1));
  P.ground(ctx, QY, -20, 1100, { p: q(0, 0.4), seed: 12, p2: false });
  // dalga çizgileri
  for (let i = 0; i < 5; i++) {
    const y = 700 + i * 30, pts = [];
    for (let k = 0; k <= 10; k++) pts.push([-20 + k * 118 + ((i * 47) % 60), y + Math.sin(k * 1.9 + i * 1.7) * 5]);
    ink(ctx, pts.filter(p => p[0] > -60 && p[0] < 1140), { w: 2.8, col: PAL.ink2, alpha: 0.5, p: q(0.5 + i * 0.06, 1.0 + i * 0.06), seed: 220 + i, wob: 0.8 });
  }

  // güneş
  P.sun(ctx, 930, 130, 32, { p: q(0.1, 0.9), seed: 8 });

  // ---- revaklı bina (sol)
  const wallV = [[40, QY], [40, 340], [664, 338], [664, QY]];
  poly(ctx, wallV, PALE_Y, q(0.1, 0.9), 231, { gap: 9, lw: 15, a: 0.85, ang: -0.7, dens: 0.42, still: true });
  ink(ctx, [[40, 470], [664, 468]], { w: 3, p: q(0.4, 0.9), seed: 232, col: PAL.ink2 });
  for (let i = 0; i < 4; i++) {
    const cx = 40 + 78 + i * 156, pa = q(0.3 + i * 0.09, 0.8 + i * 0.09);
    ink(ctx, [[cx - 54, QY], [cx - 54, 552], [cx - 40, 520], [cx, 502], [cx + 40, 520], [cx + 54, 552], [cx + 54, QY]], { p: pa, seed: 240 + i, w: 3.6 });
    ink(ctx, [[cx - 22, 462], [cx - 22, 392], [cx, 372], [cx + 22, 392], [cx + 22, 462]], { p: pa, seed: 260 + i, w: 3.2 });
  }
  // çatı topları
  for (let i = 0; i < 6; i++) {
    const x = 40 + i * 124, pr = q(0.7 + i * 0.05, 1.0 + i * 0.05);
    if (pr > 0) ink(ctx, ellipsePts(x, 322, 12, 12, 8, 0, 0), { w: 2.8, closed: true, p: pr, seed: 280 + i });
  }

  // ---- çan kulesi
  const shaft = [[706, QY], [710, 226], [764, 226], [768, QY]];
  poly(ctx, shaft, RUST, q(0.35, 1.05), 290, { gap: 6, lw: 10, ang: -1.2 });
  poly(ctx, [[696, 226], [696, 156], [778, 156], [778, 226]], null, q(0.7, 1.2), 291);
  ink(ctx, [[716, 222], [716, 178], [727, 166], [738, 178], [738, 222]], { p: q(0.9, 1.3), seed: 292, w: 2.8 });
  ink(ctx, [[740, 222], [740, 178], [751, 166], [762, 178], [762, 222]], { p: q(0.95, 1.35), seed: 293, w: 2.8 });
  poly(ctx, [[688, 158], [737, 66], [786, 158]], PAL.teal, q(0.9, 1.4), 294, { gap: 4.6, lw: 8.5 });
  P.sparkle(ctx, 737, 50, 10 + 5 * hi, { p: q(1.2, 1.5), seed: 295, col: PAL.yellow });

  // ---- kafe: şemsiye + masa (sağ)
  const pc = q(0.7, 1.4);
  ink(ctx, [[905, QY], [905, 428]], { w: 3.6, p: pc, seed: 300 });
  const canopy = [...arcPts(905, 448, 130, 62, Math.PI, Math.PI * 2, 10), [1035, 448], [905, 452], [775, 448]];
  poly(ctx, canopy, PAL.yellow, pc, 301, { gap: 5, lw: 9, ang: -0.8 }, { smooth: true });
  ink(ctx, [[867, 392], [943, 392], [960, 452], [850, 452]], { w: 2.6, p: q(0.95, 1.5), seed: 302, smooth: false, col: PAL.blue });
  // masa: geniş tabla, fincan üstünde oturur
  const tt = ellipsePts(905, 596, 96, 17, 12, 0, 0);
  TK.crayon(ctx, tt, PAL.blue, { seed: 305, gap: 5, lw: 9, jit: 2, p: q(0.9, 1.4), ang: -0.3 });
  ink(ctx, tt, { closed: true, p: q(0.85, 1.3), seed: 306 });
  ink(ctx, [[905, 612], [905, QY]], { p: q(1.0, 1.4), seed: 307 });
  ink(ctx, [[868, QY], [905, QY - 4], [942, QY]], { p: q(1.0, 1.4), seed: 308, w: 3 });
  if (q(1.0, 1.9) > 0.3) TK.crayon(ctx, ellipsePts(905, 600, 62, 8, 8, 0, 0), PAL.ink2, { seed: 309, gap: 4, lw: 6, jit: 1, p: 1, a: 0.28, dx: 0, dy: 0, still: true });
  P.fincanAlive(ctx, 905, 604, info, { s: 0.78, p: q(1.0, 1.9), steam: 0.6, hop: 0.5, seed: 21, look: [-0.5, 0.15], bounce: 1.0, mood: 'happy' });

  // ---- güvercin: revağın önünde, rıhtımda; gagalar (1.7x)
  {
    const pg = q(1.1, 1.6), x = 600, y = QY + 6, S = 1.7, K = 1 / S;
    const peck = Math.max(0, Math.sin(t * 5.5)) * 0.8 + hi * 0.4;
    ctx.save(); ctx.translate(x, y); ctx.scale(S, S);
    const IKp = (pts, o) => ink(ctx, pts, Object.assign({ w: 2.8 * K, p: pg, wob: 0.5 * K, ghost: false }, o));
    // bacaklar + ayaklar
    IKp([[-4, -14], [-6, 0]], { col: PAL.red, seed: 328, w: 2.6 * K }); IKp([[8, -14], [9, 0]], { col: PAL.red, seed: 329, w: 2.6 * K });
    IKp([[-12, 0], [-6, -1], [0, 0]], { col: PAL.red, seed: 330, w: 2.4 * K }); IKp([[3, 0], [9, -1], [15, 0]], { col: PAL.red, seed: 331, w: 2.4 * K });
    // kuyruk
    const tail = [[-24, -32], [-50, -42], [-42, -28], [-49, -14], [-24, -20]];
    TK.crayon(ctx, tail, PAL.gray, { seed: 332, gap: 3.4 * K, lw: 6 * K, jit: 1, p: pg, dx: 0, dy: 0 });
    IKp(tail, { closed: true, seed: 333, smooth: false });
    // gövde
    const body = blobPts(0, -30, 30, 19, 320, 9, 0.04);
    TK.crayon(ctx, body, '#e4e7ee', { seed: 321, gap: 3.6 * K, lw: 7 * K, jit: 1.5, p: pg, dx: 0, dy: 0, a: 1 });
    IKp(body, { closed: true, seed: 322, w: 3.2 * K });
    // kanat
    const wing = [[-16, -38], [12, -40], [22, -28], [-4, -18], [-20, -26]];
    TK.crayon(ctx, wing, PAL.lilac, { seed: 334, gap: 3.4 * K, lw: 6 * K, jit: 1, p: pg, dx: 0, dy: 0, a: 0.9 });
    IKp(wing, { closed: true, seed: 335, w: 2.6 * K });
    // boyun + kafa
    const hx = 30 - peck * 14, hy = -52 + peck * 26;
    IKp([[20, -42], [hx - 6, hy + 10]], { w: 8 * K, col: '#e4e7ee', seed: 324 });
    const head = ellipsePts(hx, hy, 11, 10, 8, 0, 0);
    TK.crayon(ctx, head, '#e4e7ee', { seed: 325, gap: 3 * K, lw: 6 * K, jit: 1, p: pg, dx: 0, dy: 0 });
    IKp(head, { closed: true, seed: 326, w: 2.8 * K });
    IKp([[hx + 10, hy - 1], [hx + 22, hy + 3], [hx + 10, hy + 5]], { col: PAL.orange, w: 3 * K, seed: 327 });
    if (pg > 0.8) { ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(hx + 3, hy - 2, 2.4, 0, 6.29); ctx.fill(); }
    ctx.restore();
  }

  // ---- gondol (sarı) + kayıkçı, 1.4x: sudan süzülür, vuruşta sallanır
  {
    const pgd = q(0.35, 1.2);
    const gx = lerp(270, 600, easeInOut(clamp(u / 4.6))), gy = 790 + Math.sin(t * 1.6) * 3 + low * 3.5;
    ctx.save();
    ctx.translate(gx, gy); ctx.rotate(0.02 * Math.sin(t * 1.9) + 0.012 * low); ctx.scale(1.4, 1.4);
    // kürek: iki elden geçer, kıç arkasında suya iner
    const rowA = 0.035 * Math.sin(t * 1.9 + 1);
    // kayıkçı (teknenin kıç tarafında ayakta, kollar yukarıda)
    P.person(ctx, -86, -6, { s: 0.62, robe: PAL.red, hat: 'cap', hatCol: PAL.yellow, arms: 'up', p: q(0.9, 1.6), bob: mid * 0.3, seed: 340, face: 'smile' });
    ctx.save(); ctx.translate(-47, -124); ctx.rotate(rowA); ctx.translate(47, 124);
    ink(ctx, [[-22, -144], [-250, 34]], { w: 4.6, col: PAL.brown, p: q(1.3, 1.8), seed: 341, wob: 0.8 });
    poly(ctx, [[-236, 18], [-264, 26], [-272, 52], [-242, 46]], PAL.brown, q(1.6, 1.9), 342, { gap: 3.4, lw: 6 }, { w: 2.8 });
    ctx.restore();
    // tekne
    const hull = [[-150, -66], [-138, -34], [-90, -4], [0, 8], [92, -4], [142, -32], [156, -72], [162, -96], [150, -76], [140, -40], [92, -16], [0, -12], [-92, -16], [-140, -44]];
    const hullFill = [[-148, -58], [-136, -30], [-88, -2], [0, 10], [90, -2], [140, -30], [152, -62], [90, -18], [0, -14], [-90, -18]];
    TK.crayon(ctx, hullFill, PAL.yellow, { seed: 350, gap: 4.6, lw: 8.5, jit: 2, p: pgd, ang: -0.2, a: 0.97 });
    ink(ctx, hull, { closed: true, p: pgd, seed: 351, w: 3.6, smooth: true, wob: 1.1 });
    ink(ctx, [[-112, -22], [0, -6], [112, -20]], { w: 3, col: PAL.red, p: pgd, seed: 352, alpha: 0.9 });
    for (let i = 0; i < 3; i++) ink(ctx, [[152, -88 + i * 9], [172, -92 + i * 9]], { w: 2.8, p: q(1.2, 1.6), seed: 353 + i, wob: 0.4 });
    ctx.restore();
    // su halkaları
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.7 + i * 0.33) % 1;
      ink(ctx, arcPts(gx - 250 - 26 * i, 806 + 22, 30 + 30 * ph, 6 + 4 * ph, 0.2, 2.9, 6), { w: 2.6, col: PAL.ink2, alpha: 0.6 * (1 - ph) * pgd, p: 1, seed: 360 + i, wob: 0.6 });
    }
  }
}

/* =================================================================================================
 * KART 3: LEİPZİG 1734, Bach'ın Kahve Kantatı (kahve - altın)
 * ================================================================================================= */
const CUPS3 = [
  { x: 606, s: 0.7, col: PAL.orange, seed: 71, sk: 3 },
  { x: 786, s: 1.0, col: PAL.teal, seed: 21, sk: 5 },
  { x: 964, s: 0.7, col: PAL.sky, seed: 73, sk: 7 },
];
const NOTE_COLS = [PAL.orange, PAL.red, PAL.teal, PAL.blue, PAL.green2, PAL.pink, PAL.yellow];

function leipzig(ctx, t, u, info) {
  const q = (a, b) => seg(u, a, b);
  const low = A().pulse('low', t, 0.1), mid = A().pulse('mid', t, 0.12), hi = A().pulse('hi', t, 0.1);
  const FL = 790;

  // sıcak altın ışık (arka)
  bigFill(ctx, blobPts(580, 470, 470, 300, 401, 18, 0.06), PAL.yellow, { seed: 400, gap: 11, lw: 18, a: 0.26, ang: -0.4, dens: 0.4 }, q(0.05, 0.9));
  // pencere + perdeler (sol)
  const win = [[86, 500], [86, 250], [110, 190], [170, 160], [230, 190], [254, 250], [254, 500]];
  poly(ctx, win, PAL.sky, q(0.1, 0.9), 410, { gap: 5, lw: 9, a: 0.75 }, { smooth: true });
  ink(ctx, [[170, 162], [170, 500]], { w: 2.8, p: q(0.5, 0.9), seed: 411 }); ink(ctx, [[86, 336], [254, 336]], { w: 2.8, p: q(0.5, 0.9), seed: 412 });
  poly(ctx, [[60, 170], [92, 176], [98, 330], [88, 490], [58, 494]], PAL.red, q(0.4, 1.1), 413, { gap: 4.8, lw: 8.5, ang: -1.3 }, { smooth: true });
  poly(ctx, [[280, 170], [248, 176], [242, 330], [252, 490], [282, 494]], PAL.red, q(0.5, 1.2), 414, { gap: 4.8, lw: 8.5, ang: -1.3 }, { smooth: true });

  // zemin: altın tahtalar
  P.ground(ctx, FL, -20, 1100, { p: q(0, 0.4), seed: 13 });
  // zemin: uçları solan taşkın boya
  bigFill(ctx, [[30, FL + 22], [260, FL + 12], [600, FL + 16], [900, FL + 10], [1060, FL + 24], [1010, FL + 52], [820, FL + 70], [500, FL + 76], [220, FL + 70], [60, FL + 54]], PAL.sand, { seed: 420, gap: 9, lw: 15, ang: -0.05, a: 0.75, dens: 0.45 }, q(0.1, 0.9));
  bigFill(ctx, [[150, FL + 44], [500, FL + 40], [880, FL + 44], [780, FL + 66], [420, FL + 72], [200, FL + 64]], PAL.orange, { seed: 421, gap: 12, lw: 18, ang: -0.05, a: 0.25, dens: 0.35 }, q(0.3, 1.1));

  // ---- Bach: podyumda, orkestra şefi
  const bx = 318, PY = FL - 34;
  poly(ctx, [[246, FL], [258, PY], [380, PY], [392, FL]], PAL.brown, q(0.2, 0.8), 430, { gap: 5, lw: 9, ang: -0.6 });
  const beat = low;
  const bp = q(0.25, 1.2);
  P.person(ctx, bx, PY, { s: 1.2, robe: PAL.coffee, hat: 'none', arms: 'up', p: bp, bob: beat * 0.7, seed: 431, face: 'o', blink: 0 });
  wigFront(ctx, bx, PY, 1.2, 431, bp, beat * 0.7);
  // ceket ayrıntıları: beyaz jabo, düğmeler, altın kenar
  if (bp > 0.75) {
    const pj = clamp((bp - 0.75) / 0.25);
    ctx.save(); ctx.translate(bx, PY - beat * 8.4); ctx.scale(1.2, 1.2 * (1 + beat * 0.02));
    poly(ctx, [[-16, -186], [0, -140], [16, -186], [0, -176]], PAL.white, pj, 470, { gap: 3.6, lw: 6 }, { w: 2.8 });
    for (let i = 0; i < 3; i++) TK.crayon(ctx, ellipsePts(0, -122 + i * 26, 5, 5, 6, 0, 0), PAL.yellow, { seed: 471 + i, gap: 2.6, lw: 5, jit: 1, p: pj, dx: 0, dy: 0 });
    ink(ctx, [[-50, -46], [0, -36], [50, -46]], { w: 4, col: PAL.yellow, p: pj, seed: 480, wob: 0.6 });
    ctx.restore();
  }
  // baget: elden çıkar
  {
    const pb = q(1.0, 1.4);
    const hx = bx + 74, hy = PY - 228 - 12 * Math.sin(TK.S.t * 6);
    const a = -0.9 + 0.35 * Math.sin(t * 8) + 0.5 * mid;
    ink(ctx, [[hx, hy], [hx + Math.cos(a) * 84, hy + Math.sin(a) * 84]], { w: 3.4, col: PAL.brown, p: pb, seed: 432, wob: 0.5 });
  }

  // ---- masa + fincan orkestrası
  const tb = [[480, 704], [1050, 700], [1040, 730], [490, 732]];
  poly(ctx, tb, PAL.brown, q(0.3, 0.9), 440, { gap: 5, lw: 9, ang: -0.1 });
  ink(ctx, [[520, 730], [516, FL]], { p: q(0.5, 1), seed: 441 }); ink(ctx, [[1000, 730], [1006, FL]], { p: q(0.5, 1), seed: 442 });

  // notalar (her 'mid' olayında bir tane)
  const ev = A().between('mid', START[2], t + 0.001);
  const evAll = A().between('mid', START[2], B[3] + 4);
  const hits = [0, 0, 0];
  ev.forEach((e, idx) => {
    const ci = (idx * 2 + Math.round(e.s * 3)) % 3;
    const a = t - e.t;
    if (a < 0) return;
    if (a < 0.16) hits[ci] = Math.max(hits[ci], 1 - a / 0.16);
  });
  const notes = [];
  ev.forEach((e, idx) => {
    const a = t - e.t;
    if (a < 0 || a > 2.3) return;
    const ci = (idx * 2 + Math.round(e.s * 3)) % 3;
    const C = CUPS3[ci];
    const v = a / 2.3;
    const spread = ((idx * 5) % 7 - 3) * 26;               // çıkış noktaları yayılsın
    const x = C.x + spread * (0.4 + v) + Math.sin(v * 5.2 + idx) * 20 + (ci - 1) * 40 * v;
    const y = 700 - 130 * C.s - 30 - 400 * easeOut(v);
    notes.push({ x, y, sc: (0.7 + 0.35 * Math.min(1, e.s)) * easeOutBack(seg(a, 0, 0.2)), col: NOTE_COLS[(idx * 3 + ci) % NOTE_COLS.length], seed: 500 + idx * 7, alpha: 1 - smooth(seg(v, 0.55, 1)), kind: e.s > 0.85 ? 1 : 0, rot: Math.sin(v * 4 + idx) * 0.25 });
  });

  CUPS3.forEach((C, i) => {
    const pp = q(0.5 + i * 0.12, 1.3 + i * 0.12);
    const h = hits[i];
    const yb = 704;
    P.fincan(ctx, C.x, yb - 4 - h * 6, { s: C.s, squash: h * 0.14 + low * 0.02, blink: 0, mood: h > 0.2 ? 'wow' : 'happy', look: [(bx - C.x) / 400, -0.2], steam: 0, p: pp, color: C.col, seed: C.seed });
    if (pp >= 1) P.steam(ctx, C.x + 2, yb - 4 - 118 * C.s, { s: C.s * 1.05, n: 2, amt: clamp(0.55 + 0.4 * mid), seed: C.seed, h: 90 });
  });
  for (const n of notes) note(ctx, n.x, n.y, n.sc, n.col, n.seed, n.alpha, n.kind, n.rot);

  // pençere kenarında bir pırıltı
  for (const e of evAll) {
    if (e.s < 1.0) continue;
    const a = t - e.t; if (a < 0 || a > 0.5) continue;
    P.sparkle(ctx, 470 + (Math.round(e.t * 100) % 5) * 40, 420 - (Math.round(e.t * 10) % 3) * 30, 14, { p: easeOut(seg(a, 0, 0.14)) * (1 - seg(a, 0.3, 0.5)), seed: 600 + Math.round(e.t * 10), col: PAL.yellow });
  }
}

/* =================================================================================================
 * KART 4: BÜTÜN AVRUPA (yeşil - sarı - mavi): harita + fincanlar
 * ================================================================================================= */
// (boylam, enlem) -> tuval. Sağ kenar çerçeve dışına taşar.
const PX = (lo) => 60 + (lo + 22) * 14.6, PY = (la) => 100 + (70 - la) * 20.5;
const GEO = (arr) => arr.map(([lo, la]) => [PX(lo), PY(la)]);
const EUROPE = GEO([[-9, 37], [-7.5, 37.2], [-6.3, 36.6], [-5.4, 36.1], [-4.5, 36.7], [-2.2, 36.7], [-0.7, 37.6], [0, 38.8], [-0.3, 39.5], [0.8, 40.7], [3, 41.6], [3.2, 42.4], [3.5, 43.2], [4.8, 43.4], [6.5, 43.1], [7.6, 43.8], [8.8, 44.4], [10.2, 43.9], [10.8, 42.8], [12.2, 41.9], [13.6, 41.2], [14.5, 40.6], [15.6, 40], [16, 38.9], [16.1, 38], [17.1, 38.9], [16.7, 39.6], [17.9, 40.3], [18.5, 40.1], [17.2, 40.9], [16, 41.9], [14.3, 42.4], [13.6, 43.5], [12.6, 44.2], [12.3, 45.3], [13.7, 45.7], [13.6, 44.9], [14.5, 44.6], [15.5, 43.6], [17.2, 43], [18.5, 42.4], [19.4, 41.6], [19.5, 40.4], [20, 39.6], [20.7, 38.7], [21.3, 37.7], [21.7, 36.7], [22.8, 36.5], [23.1, 37.5], [23.9, 37.9], [23.2, 39.2], [22.7, 40.4], [23.8, 40.2], [24.8, 40.8], [26.2, 40.8], [27.5, 41], [28.8, 41.2], [28, 42.5], [28.6, 43.8], [28.9, 44.9], [29.7, 45.3], [30.4, 46], [31.6, 46.6], [32.3, 46.3], [33.5, 46.1], [33.2, 45.3], [34.6, 44.6], [35.6, 45.2], [36.6, 45.4], [35.5, 46.2], [36.9, 46.8], [38.3, 47.1], [39.3, 47.2], [44, 46.5], [58, 46.5], [58, 72.5], [45, 68.6], [41, 66.5], [36, 66.4], [32, 69.2], [28, 71], [24.5, 71], [20, 70], [16.5, 68.4], [13, 66], [10.5, 64.3], [7.5, 63], [5.2, 61], [5, 59.5], [6, 58.3], [8, 58], [9.7, 58.8], [11.2, 59.1], [11.8, 58.3], [11.5, 57.8], [12.5, 56.5], [12.9, 55.5], [14.2, 55.4], [14.5, 56.2], [16.4, 56.6], [16.6, 57.8], [16.6, 58.7], [18.5, 59.6], [17.5, 60.6], [17.3, 61.5], [18.7, 62.8], [20.3, 63.7], [22, 65], [24.4, 65.8], [25.4, 65.1], [24.6, 64.3], [22.8, 63.2], [21.4, 62.5], [21.3, 61], [22.6, 60.2], [25, 60.3], [28, 60.6], [30.3, 60], [29, 59.5], [26, 59.5], [23.5, 59.2], [23.3, 58.4], [24.4, 58.3], [24.2, 57.3], [23, 57], [21.8, 57.6], [21, 56.7], [21.1, 55.5], [20.4, 54.8], [19.6, 54.4], [18.5, 54.7], [17, 54.7], [14.7, 54], [13.5, 54.3], [12, 54.2], [10.9, 54], [10.9, 54.6], [10.2, 54.9], [10.6, 56.6], [10.5, 57.5], [10.2, 57.7], [9, 57.1], [8.2, 56.6], [8.1, 55.5], [8.6, 54.9], [8.9, 54], [8.5, 53.5], [7.2, 53.5], [5, 53.3], [4.6, 52.6], [4, 52], [3.5, 51.3], [2.5, 51.1], [1.6, 50.9], [1.6, 50.2], [0.2, 49.7], [-1.3, 49.7], [-1.8, 49.3], [-1.6, 48.7], [-3, 48.8], [-4.6, 48.6], [-4.7, 48], [-3.5, 47.8], [-2.5, 47.3], [-2.1, 46.8], [-1.2, 46], [-1.2, 44.7], [-1.8, 43.4], [-3.5, 43.5], [-6, 43.6], [-8.2, 43.7], [-9.3, 43], [-8.9, 42], [-8.8, 41], [-9.5, 39.4], [-9.4, 38.7], [-8.9, 38.4], [-8.8, 37.2]]);
const ANATOLIA = GEO([[27.3, 40.2], [26.3, 40], [26.5, 38.6], [27.4, 37.3], [28.8, 36.7], [30.5, 36.3], [32.5, 36.1], [34.6, 36.7], [36.1, 36.7], [37, 36.7], [44, 37], [58, 37], [58, 42], [43, 41.6], [41.5, 41.5], [39, 41], [36.8, 41.3], [35, 42], [33.4, 42], [31.5, 41.2], [29.5, 41.2], [29.1, 41.1]]);
const ISLANDS = [
  GEO([[-5.5, 50], [-3, 50.4], [1.4, 51], [1.7, 52.8], [0, 53.5], [-1.5, 55], [-2, 57], [-3.5, 58.6], [-5, 58.5], [-6, 57], [-5, 55.5], [-3, 54.8], [-3.2, 53.4], [-4.5, 53], [-5, 51.7]]),   // Britanya
  GEO([[-10, 52], [-6.2, 52.2], [-6, 54], [-8, 55.2], [-10, 54]]),                                                                               // İrlanda
  GEO([[12.5, 38], [15.5, 38.2], [15, 36.8]]),                                                                                                     // Sicilya
  GEO([[8.3, 41], [9.6, 41], [9.4, 39], [8.5, 39]]),                                                                                               // Sardinya
  GEO([[11.1, 55.4], [12.6, 55.4], [12.4, 56.1], [11.2, 56]]),                                                                                     // Zelanda
  GEO([[23.5, 35.4], [26, 35.3], [26, 35], [23.6, 35]]),                                                                                           // Girit
];
// iç bölgeyi lekeler: [renk, merkez boylam, enlem, rx, ry (derece)]
const PATCHES = [
  [PAL.green, 22, 63, 26, 6.5, 0.42], [PAL.orange, -3, 40, 8, 4.5, 0.3], [PAL.yellow, 38, 53, 16, 8, 0.45], [PAL.pink, 20, 43, 7, 4, 0.3], [PAL.teal, 6, 49.5, 7, 3, 0.22],
];
// minik fincan yerleri (boylam, enlem): İstanbul, Viyana, Paris, Venedik önce; hepsi karada, aralarında >= 60 px
const CITIES = [
  [27.4, 41.2], [16.4, 48.1], [2.4, 48.8], [11.6, 45.4], [-0.4, 51.4], [12.4, 51.3], [5, 52.3], [12.5, 41.9], [21, 52], [9.6, 56.3], [18, 59.3], [10.7, 59.9],
  [25, 60.6], [30.3, 59.9], [37.6, 55.8], [30.5, 50.4], [4.8, 45.8], [2, 41.6], [-3.7, 40.4], [-8.5, 39], [-0.8, 44.9], [-3.4, 55.9], [-7.6, 53.1], [23.7, 38],
  [20.5, 44.8], [26, 44.4], [32.8, 39.9], [30.7, 46.4], [24.1, 56.9], [27.5, 53.9], [39.7, 47.6], [16, 62.2], [34, 66.7],
];
const CUP_COLS = [PAL.red, PAL.orange, PAL.teal, PAL.yellow, PAL.pink, PAL.blue];

function evTimes() {
  // 69.84'ten sonraki low/mid/hi olaylarının birleşimi (0.09 sn içindekiler tek sayılır)
  const all = [];
  for (const k of ['low', 'mid', 'hi']) for (const e of A().between(k, B[3] - 0.01, 72.95)) all.push(e.t);
  all.sort((a, b) => a - b);
  const out = [];
  for (const x of all) if (!out.length || x - out[out.length - 1] > 0.09) out.push(x);
  return out;
}
let EV4 = null;
const LAND_COL = TK.mixHex(PAL.yellow, PAL.green, 0.4);
const MOUNTS = [[9.5, 46.6], [11.2, 46.9], [13, 47], [-1.5, 42.7], [0.5, 42.7], [24, 47.2], [26, 46.2], [7.5, 61.5], [9, 62.3], [16, 66.5]];

function avrupaKart(ctx, t, u, info) {
  const q = (a, b) => seg(u, a, b);
  const low = A().pulse('low', t, 0.1), mid = A().pulse('mid', t, 0.12), hi = A().pulse('hi', t, 0.1);
  if (!EV4) EV4 = evTimes();

  // deniz: sağ kenardan taşar (dikdörtgen görüntüsü yok); üst ve yan boşluk bol, alt y~850
  const sea = [[64, 74], [400, 62], [800, 70], [1110, 60], [1110, 846], [700, 852], [300, 846], [62, 850], [54, 460]];
  bigFill(ctx, sea, PAL.sky, { sharp: true, seed: 700, gap: 12, lw: 20, ang: -0.15, a: 0.8, dens: 0.4, jit: 5 }, q(0.02, 0.8));
  ink(ctx, [[1100, 62], [400, 60], [66, 72], [54, 460], [62, 850], [300, 846], [700, 852], [1100, 846]], { p: q(0, 0.6), seed: 701, w: 3.8, wob: 1.6, smooth: true });

  // kara: tek sarı-yeşil boya, üstüne kara içinde kalan leke
  const pl = q(0.1, 0.7);
  if (pl > 0) {
    const all = [EUROPE, ANATOLIA, ...ISLANDS];
    all.forEach((pts, i) => bigFill(ctx, pts, LAND_COL, { seed: 720 + i * 3, gap: 8, lw: 14, ang: -0.9 + i * 0.3, a: 0.92, dens: 0.4 }, clamp(pl * 1.4 - i * 0.02)));
    if (pl > 0.6) {
      ctx.save();
      ctx.beginPath(); for (const pts of all) { pts.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
      ctx.clip();
      const pa = clamp((pl - 0.6) / 0.4);
      PATCHES.forEach(([col, lo, la, rx, ry, al], i) => {
        const cx = PX(lo), cy = PY(la), bl = blobPts(cx, cy, rx * 14.6, ry * 20.5, 730 + i, 10, 0.12);
        bigFill(ctx, bl, col, { seed: 740 + i * 2, gap: 11, lw: 17, ang: -0.3 - i * 0.4, a: al, dens: 0.35 }, pa);
      });
      ctx.restore();
    }
    all.forEach((pts, i) => ink(ctx, pts, { closed: true, w: i < 2 ? 3.8 : 3.2, p: clamp(pl * 1.5 - 0.1 - i * 0.02), seed: 760 + i, wob: 1.1, smooth: i < 2 ? true : true }));
    // ülke sınırları ve dağlar (ince, soluk)
    const pb = q(0.7, 1.1);
    if (pb > 0) {
      const BORD = [[[-1.8, 43.3], [1, 42.7], [3.2, 42.4]], [[2.5, 51], [4.2, 49.6], [6.2, 49.4], [7.6, 47.6], [7, 44]], [[6, 46], [8.5, 47.7], [13.8, 48.6], [15, 50.8], [14.7, 54]], [[13.8, 46.5], [17, 46.8], [22, 48], [24, 50.2], [23.4, 53.8], [26, 56.2]], [[22, 48], [26, 48.2], [29, 45.2]], [[12, 47.5], [12.4, 45.8], [12.9, 44]], [[19, 42], [22.3, 42.3], [22.8, 44.2]], [[17, 62.8], [19, 66]]];
      BORD.forEach((b, i) => ink(ctx, GEO(b), { w: 2.2, col: PAL.ink2, alpha: 0.4, p: pb, seed: 780 + i, wob: 1 }));
      MOUNTS.forEach(([lo, la], i) => { const x = PX(lo), y = PY(la); ink(ctx, [[x - 11, y + 7], [x, y - 9], [x + 11, y + 7]], { w: 2.6, col: PAL.brown, alpha: 0.75, p: pb, seed: 800 + i, wob: 0.6, smooth: false }); });
    }
  }
  // sabit dalga işaretleri (Atlantik, Kuzey Denizi, Akdeniz, Karadeniz)
  [[-16, 47], [-14, 55], [-12, 62], [-3, 60.5], [4, 57.5], [6, 39], [16, 35.5], [2, 36], [34, 43.2], [17, 57.5], [22, 36.4]].forEach(([lo, la], i) =>
    ink(ctx, arcPts(PX(lo), PY(la), 24, 7, 3.3, 6.1, 6), { w: 2.8, col: PAL.blue, alpha: 0.7, p: q(0.6 + i * 0.03, 1.0 + i * 0.03), seed: 810 + i, wob: 0.6 }));

  // kahraman Fincan: Atlantik'in boş köşesinde, dalgalarla denizde yüzer
  {
    const hx = 142, hy = 800, ph = q(0.3, 1.2), sway = Math.sin(t * 1.6) * 3;
    for (let i = 0; i < 3; i++) ink(ctx, arcPts(hx + (i - 1) * 46, hy + 16 + (i % 2) * 8, 26, 7, 3.3, 6.1, 6), { w: 3, col: PAL.blue, alpha: 0.85, p: ph, seed: 830 + i, wob: 0.6 });
    P.fincanAlive(ctx, hx, hy + sway, info, { s: 0.6, p: q(0.3, 1.3), steam: 0.7, hop: 0.7, seed: 21, look: [0.6, -0.2], bounce: 1.3 });
  }

  // minik fincanlar: her vuruşta bir tane
  const N = CITIES.length;
  const tFill = 72.86, tEnd = 73.16;
  const nEv = Math.min(EV4.length, N - 8);
  const cupT = (i) => i < nEv ? EV4[i] : lerp(tFill, tEnd, (i - nEv) / Math.max(1, N - nEv));
  for (let i = 0; i < N; i++) {
    const ct = cupT(i);
    const a = t - ct;
    if (a < 0) continue;
    const pop = easeOutBack(seg(a, 0, 0.22));
    const X = PX(CITIES[i][0]), Y = PY(CITIES[i][1]) + 12;
    const sc = 0.4 * (0.75 + 0.35 * Math.min(1, pop)) * (i < 4 ? 1.2 : 1);
    ctx.save(); ctx.translate(X, Y); ctx.scale(pop, pop); ctx.translate(-X, -Y);
    P.miniCup(ctx, X, Y, sc, { col: CUP_COLS[i % CUP_COLS.length], seed: 850 + i, p: 1, steam: i < 4 ? 0.7 : 0 });
    ctx.restore();
    if (a < 0.4) {
      const r = 8 + 40 * easeOut(seg(a, 0, 0.4));
      ink(ctx, arcPts(X, Y - 12, r, r * 0.8, 0.2, 5.6, 8), { w: 2.8, col: CUP_COLS[(i + 2) % CUP_COLS.length], alpha: 1 - seg(a, 0.05, 0.4), seed: 900 + i, wob: 0.7 });
    }
  }

  // doruk: 72.9-73.3 parıltı
  const pk = seg(t, 72.9, 73.05), pf = seg(t, 73.14, 73.3);
  if (pk > 0) {
    const cx = 560, cy = 470;
    const fade = 1 - pf * 0.15;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 6.283 + 0.1, r0 = 250 + 30 * (i % 3), r1 = r0 + 80 * easeOut(pk) + 20 * (i % 2);
      ink(ctx, [[cx + Math.cos(a) * r0 * 1.3, cy + Math.sin(a) * r0 * 0.95], [cx + Math.cos(a) * r1 * 1.3, cy + Math.sin(a) * r1 * 0.95]], { w: 4, col: i % 2 ? PAL.yellow : PAL.orange, alpha: fade * (0.4 + 0.6 * pk), seed: 950 + i, wob: 0.6 });
    }
    const SP = [[200, 150], [520, 110], [860, 130], [1000, 420], [960, 780], [560, 826], [300, 826], [110, 420], [700, 230], [420, 260]];
    SP.forEach(([x, y], i) => {
      const a = seg(t, 72.9 + (i % 5) * 0.04, 73.05 + (i % 5) * 0.04);
      if (a <= 0) return;
      P.sparkle(ctx, x, y, (12 + 8 * (i % 3)) * (1 + 0.25 * Math.sin(t * 22 + i)), { p: easeOutBack(a), seed: 960 + i, col: i % 2 ? PAL.yellow : PAL.orange, rot: 0.3 * i });
    });
  }
}

/* ------------------------------------------------------------------ kartlar */
const A = () => TK.audio;
const CARDS = [
  { fn: paris, cap: 'Paris · Cafe Procope', acc: [{ i: 11, kind: 'acute', at: 0.9 }], cp: [0.55, 1.3] },
  { fn: venedik, cap: 'Venedik · Caffe Florian', acc: [{ i: 14, kind: 'grave', at: 0.92 }], cp: [0.8, 1.45] },
  { fn: leipzig, cap: 'Leipzig · Kahve Kantatı', acc: null, cp: [0.8, 1.4] },
  { fn: avrupaKart, cap: 'bütün Avrupa', acc: null, cp: [0.8, 1.4] },
];

function drawCard(ctx, k, t, info) {
  const u = t - START[k];
  if (u < 0) return;
  const C = CARDS[k];
  ctx.save();
  C.fn(ctx, t, u, info);
  ctx.restore();
  caption(ctx, C.cap, seg(u, C.cp[0], C.cp[1]), C.acc);
}

/* ------------------------------------------------------------------ sayfa çevirme */
function drawTurn(ctx, k, t, info) {
  const a = B[k] - PRE, b = B[k] + POST;
  const pr = clamp((t - a) / (b - a));
  const e = easeInOut(pr);
  const f = lerp(W + 130, -130, e);
  const sk = 54 * (1 - 0.45 * pr);
  const xAt = (y) => f + sk * (1 - 2 * y / H);
  // yeni kart altta
  drawCard(ctx, k, t, info);
  // yeni sayfaya düşen gölge
  {
    const g = ctx.createLinearGradient(f - 10, 0, f + 90, 0);
    g.addColorStop(0, 'rgba(60,40,20,0.20)'); g.addColorStop(1, 'rgba(60,40,20,0)');
    ctx.save(); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(xAt(-20), -20); ctx.lineTo(xAt(-20) + 100, -20); ctx.lineTo(xAt(H + 20) + 100, H + 20); ctx.lineTo(xAt(H + 20), H + 20); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // eski kart: kıvrım çizgisinin solunda
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-60, -60); ctx.lineTo(xAt(-60), -60); ctx.lineTo(xAt(H + 60), H + 60); ctx.lineTo(-60, H + 60); ctx.closePath(); ctx.clip();
  TK.paper(ctx);
  drawCard(ctx, k - 1, t, info);
  // flap'in eski sayfaya gölgesi
  const fw = Math.max(0, W - f);
  const g2 = ctx.createLinearGradient(f - fw - 4, 0, f, 0);
  g2.addColorStop(0, 'rgba(60,40,20,0)'); g2.addColorStop(0.85, 'rgba(60,40,20,0.10)'); g2.addColorStop(1, 'rgba(60,40,20,0.22)');
  ctx.fillStyle = g2; ctx.fillRect(-60, -60, W + 120, H + 120);
  ctx.restore();
  // dönen sayfanın arka yüzü: kıvrım çizgisine göre (W,0) ve (W,H) yansıması
  if (f < W) {
    const P0 = [xAt(0), 0], P1 = [xAt(H), H];
    const dx = P1[0] - P0[0], dy = P1[1] - P0[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const refl = (p) => { const vx = p[0] - P0[0], vy = p[1] - P0[1], d = vx * ux + vy * uy; const fx = P0[0] + ux * d, fy = P0[1] + uy * d; return [2 * fx - p[0], 2 * fy - p[1]]; };
    const c0 = refl([W, 0]), c1 = refl([W, H]);
    const flap = [P0, P1, c1, c0];
    ctx.save();
    ctx.beginPath(); ctx.moveTo(flap[0][0], flap[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(flap[i][0], flap[i][1]);
    ctx.closePath(); ctx.clip();
    // arka yüz: kağıt dokusu + kıvrım boyunca koyu-açık geçiş
    ctx.fillStyle = '#f3ecda'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.85; TK.paper(ctx); ctx.globalAlpha = 1;
    const gg = ctx.createLinearGradient(P0[0], 0, Math.min(c0[0], c1[0]), 0);
    gg.addColorStop(0, 'rgba(120,95,55,0.42)'); gg.addColorStop(0.12, 'rgba(150,120,70,0.16)'); gg.addColorStop(0.5, 'rgba(255,255,255,0.10)'); gg.addColorStop(1, 'rgba(255,255,255,0.18)');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // kıvrımın altına yumuşak gölge şeridi (eski sayfa tarafı)
    {
      const gs = ctx.createLinearGradient(P0[0] - 46, 0, P0[0], 0);
      gs.addColorStop(0, 'rgba(60,40,20,0)'); gs.addColorStop(1, 'rgba(60,40,20,0.30)');
      ctx.save(); ctx.fillStyle = gs;
      ctx.beginPath(); ctx.moveTo(xAt(-20) - 46, -20); ctx.lineTo(xAt(-20), -20); ctx.lineTo(xAt(H + 20), H + 20); ctx.lineTo(xAt(H + 20) - 46, H + 20); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ink(ctx, flap, { closed: true, smooth: false, w: 3, col: PAL.ink2, alpha: 0.75, seed: 40 + k, wob: 1.2 });
    // sayfa arkasında silik kalem çizgileri (kağıt izi)
    for (let i = 0; i < 5; i++) {
      const y0 = 140 + i * 180;
      const a0 = refl([f + 50, y0]), a1 = refl([f + 230 + 30 * (i % 2), y0 + 10]);
      ink(ctx, [a0, a1], { w: 2.6, col: PAL.ink2, alpha: 0.24, seed: 60 + i, wob: 1 });
    }
  }
}

TK.scenes.avrupa = function draw(ctx, lt, info) {
  const t = info.t;
  let k = 0;
  for (let i = 1; i < 4; i++) if (t >= B[i] - PRE) k = i;
  if (k >= 1 && t < B[k] + POST) drawTurn(ctx, k, t, info);
  else drawCard(ctx, k, t, info);
};
})();
