/* props.js: bütün sahnelerin paylaştığı çizim parçaları (aynı el, aynı stil).
 * Her fonksiyon ctx'e (x, y) noktasına, s ölçeğiyle çizer. (x,y) nesnenin TABAN ortasıdır (yer temas noktası).
 * Çizgi kalınlığı ekranda sabit kalır (K = 1/s ile telafi edilir).
 * Not: hepsi SAF: aynı (t, parametre) -> aynı çizim. */
(function (g) {
'use strict';
const TK = g.TK, { PAL, ink, crayon, ellipsePts, arcPts, blobPts, spiralPts, xf, rnd01, lerp, clamp, noise1, smooth, easeOut } = TK;
const S = TK.S;

// ink/crayon kısayolları: ölçek telafili
function pen(ctx, K, base) {
  return {
    ink: (pts, o) => ink(ctx, pts, Object.assign({ w: 3.6 * K, wob: 1.2 * K }, base, o, o && o.w ? { w: o.w * K } : null)),
    fill: (pts, col, o) => crayon(ctx, pts, col, Object.assign({ gap: 5.2 * K, lw: 9 * K, jit: 4 * K }, base, o)),
  };
}

/* --------------------------------------------------------------- buhar */
// x,y buharın çıkış noktası. amt 0..1 (çizim ilerlemesi/yoğunluk), n tane kıvrım
function steam(ctx, x, y, o = {}) {
  const s = o.s ?? 1, n = o.n ?? 3, amt = o.amt ?? 1, h = (o.h ?? 90) * s, seed = o.seed ?? 5;
  const K = 1 / s;
  const t = S.t * (o.speed ?? 1);
  for (let i = 0; i < n; i++) {
    const bx = x + (i - (n - 1) / 2) * 24 * s;
    const ph = t * 2.2 + i * 1.9 + seed;
    const pts = [];
    const m = 7;
    for (let k = 0; k <= m; k++) {
      const u = k / m;
      pts.push([bx + Math.sin(ph - u * 4.2) * (7 + 8 * u) * s + noise1(i * 9 + u * 3, seed) * 3 * s, y - u * h * (0.75 + 0.25 * noise1(i + ph * .2, seed))]);
    }
    const a = o.alpha ?? 1;
    ink(ctx, pts, { w: 3.2, wob: 1.0, col: PAL.ink2, seed: seed * 7 + i, p: clamp(amt * (0.85 + .3 * rnd01(seed, i))), p0: clamp(amt - 0.85) * 0.0, ghost: false, alpha: a * 0.85 });
  }
}

/* --------------------------------------------------------------- güneş */
function sun(ctx, x, y, r = 34, o = {}) {
  const p = o.p ?? 1, seed = o.seed ?? 3;
  // yuvarlak boya + sarmal
  const body = blobPts(x, y, r, r, seed, 12, 0.05);
  if (p > 0.15) crayon(ctx, body, o.col ?? PAL.yellow, { seed, p: clamp((p - .15) / .6), ang: -0.6, gap: 4.4, lw: 8, jit: 3, grain: .8 });
  ink(ctx, blobPts(x, y, r, r, seed + 1, 12, 0.04), { w: 3.4, p: clamp(p * 2), closed: true, seed });
  ink(ctx, spiralPts(x, y, r * 0.16, r * 0.72, 2.0, 0.7, 24), { w: 3, col: PAL.orange, p: clamp((p - .3) * 2), seed: seed + 3, ghost: false });
  const rays = o.rays ?? 8;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * 6.283 + 0.2 + Math.sin(S.t * 0.8 + i) * 0.03;
    const r0 = r * 1.35, r1 = r * (1.75 + 0.15 * Math.sin(S.boil * 1.7 + i * 2));
    ink(ctx, [[x + Math.cos(a) * r0, y + Math.sin(a) * r0], [x + Math.cos(a) * r1, y + Math.sin(a) * r1]], { w: 3.2, p: clamp((p - .5) * 3), seed: seed * 10 + i, ghost: false });
  }
}

/* ------------------------------------------------------------ yer çizgisi */
// y'de, x0..x1 arası eğri büğrü zemin çizgisi. p: ilerleme
function ground(ctx, y, x0 = -20, x1 = 1100, o = {}) {
  const seed = o.seed ?? 11, pts = [];
  for (let x = x0; x <= x1; x += 90) pts.push([x, y + noise1(x / 130, seed) * 3.2]);
  ink(ctx, pts, { w: 3.6, p: o.p ?? 1, seed, wob: 1.6, ghost: true });
  if (o.p2 !== false) { // ikinci silik çizgi
    const pts2 = pts.map((q, i) => [q[0] + 12, q[1] + 9 + noise1(i, seed + 4) * 2]);
    ink(ctx, pts2.slice(2, -2), { w: 2.4, col: PAL.ink2, p: clamp((o.p ?? 1) * 1.2 - .2), alpha: .5, seed: seed + 2, ghost: false });
  }
}

/* --------------------------------------------------------------- çimen */
function grass(ctx, x, y, s = 1, o = {}) {
  const seed = o.seed ?? 2, p = o.p ?? 1, K = 1 / s;
  const blades = o.n ?? 4;
  for (let i = 0; i < blades; i++) {
    const a = (i - (blades - 1) / 2) * 0.32 + (rnd01(seed, i) - .5) * .2 + Math.sin(S.t * 1.6 + x * .01 + i) * 0.03;
    const h = (34 + rnd01(seed, i + 9) * 28) * s;
    const bx = x + (i - blades / 2) * 6 * s;
    const pts = [[bx, y], [bx + Math.sin(a) * h * .5 + 3 * s, y - h * .55], [bx + Math.sin(a) * h + a * 10 * s, y - h]];
    ink(ctx, pts, { w: 3, col: PAL.green2, p, seed: seed * 5 + i, wob: 1, ghost: false });
  }
  if (o.fill !== false && p > .5) crayon(ctx, [[x - 14 * s, y], [x - 4 * s, y - 40 * s], [x + 16 * s, y - 34 * s], [x + 20 * s, y]], PAL.green, { seed, gap: 4 * K, lw: 7 * K, jit: 3, p: clamp((p - .5) * 2), alpha: .9 });
}

/* --------------------------------------------------------------- bulut */
function cloud(ctx, x, y, s = 1, o = {}) {
  const seed = o.seed ?? 4, p = o.p ?? 1;
  const puffs = [[-52, 0, 34], [-14, -18, 40], [30, -10, 36], [62, 4, 26]];
  const pts = [];
  // dış hat: kabarcıkların üst yayları
  const outline = [];
  puffs.forEach(([px, py, pr], i) => {
    const a0 = i === 0 ? Math.PI * 0.6 : Math.PI * 1.15, a1 = i === puffs.length - 1 ? Math.PI * 2.4 : Math.PI * 1.9;
    for (const q of arcPts(x + px * s, y + py * s, pr * s, pr * s * .9, a0, a1, 5)) outline.push(q);
  });
  outline.push([x + 62 * s, y + 28 * s], [x - 50 * s, y + 30 * s]);
  ink(ctx, outline, { w: 3.4, p, seed, closed: true, smooth: true });
  if (o.fill) crayon(ctx, outline, o.fill, { seed, gap: 5 / s, lw: 9 / s, alpha: .6, p: clamp((p - .3) * 1.5), still: false });
}

/* --------------------------------------------------------------- FİNCAN */
// Kahramanımız: gözlü, yanaklı küçük fincan. (x,y) = tabağın alt orta noktası.
// o: s (ölçek), squash (-.3..+.3; + = uzar), rot (rad), blink (0..1 kapalılık), look ([dx,dy] -1..1),
//    mood ('happy'|'wow'|'sleepy'|'sad'), steam (0..1), p (çizilme ilerlemesi 0..1), flip (±1), seed, color (gövde boyası)
function fincan(ctx, x, y, o = {}) {
  const s = o.s ?? 1, K = 1 / s, seed = o.seed ?? 21, p = o.p ?? 1;
  if (p <= 0) return;
  const sq = o.squash ?? 0, sy = 1 + sq, sx = 1 - sq * 0.7;
  const look = o.look ?? [0, 0], blink = o.blink ?? 0, mood = o.mood ?? 'happy';
  const col = o.color ?? PAL.teal;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? 0);
  ctx.scale(s * (o.flip ?? 1) * sx, s * sy);
  const P = pen(ctx, K / 1, {});
  const inkS = (pts, oo) => ink(ctx, pts, Object.assign({ w: 3.6 * K, wob: 1.1 * K, seed: seed }, oo));
  const q = (a, b) => clamp((p - a) / (b - a));
  // --- tabak
  const sauc = ellipsePts(0, -9, 104, 15, 14, 0, 0.3);
  if (q(0.55, 0.9) > 0) crayon(ctx, sauc, PAL.yellow, { seed: seed + 1, gap: 5 * K, lw: 9 * K, jit: 3, p: q(0.55, 0.9), ang: -0.2, alpha: .95 });
  inkS(sauc, { closed: true, p: q(0, 0.25), seed: seed + 2 });
  inkS(ellipsePts(0, -9, 62, 8, 10, 0, 1.0).slice(0, 7), { w: 2.4, p: q(0.1, .3), col: PAL.ink2, alpha: .6, seed: seed + 3, ghost: false });
  // --- gövde
  const body = [[-72, -112], [-70, -86], [-58, -52], [-36, -26], [-24, -17], [24, -17], [36, -26], [58, -52], [70, -86], [72, -112]];
  const bodyFill = [...body, [58, -100], [0, -104], [-58, -100]];
  if (q(0.5, .9) > 0) crayon(ctx, bodyFill, col, { seed: seed + 4, gap: 5.4 * K, lw: 9 * K, jit: 4, p: q(0.5, 0.9), ang: -0.9, dens: .5, grain: 1, alpha: .96 });
  inkS(body, { p: q(0.15, 0.5), seed: seed + 5 });
  // kulp
  inkS([[68, -100], [98, -102], [112, -84], [102, -62], [64, -58]], { p: q(0.3, 0.55), seed: seed + 6, w: 3.4 });
  // ağız (kenar) ve kahve
  const rim = ellipsePts(0, -112, 72, 13, 14, 0, 0.5);
  crayon(ctx, ellipsePts(0, -111, 62, 8.5, 12, 0, .2), PAL.coffee, { seed: seed + 7, gap: 4 * K, lw: 7 * K, jit: 2, p: q(0.7, 1), grain: .5, ang: 0.2 });
  inkS(rim, { closed: true, p: q(0.3, 0.6), seed: seed + 8 });
  // süs: turuncu lale/nokta kuşağı
  if (q(0.7, 1) > 0) {
    const bandY = -46;
    for (let i = -2; i <= 2; i++) {
      const bx = i * 22, bp = q(0.75 + i * .01, 1);
      crayon(ctx, ellipsePts(bx, bandY + Math.abs(i) * 1.5, 6.5, 5, 6, 0, i), i % 2 ? PAL.orange : PAL.red, { seed: seed + 20 + i, gap: 3.4 * K, lw: 6 * K, jit: 1.2, p: bp, dx: 0, dy: 0 });
    }
  }
  // --- yüz
  const ex = 25, ey = -74;
  const fp = q(0.6, 1);
  const lx = look[0] * 4.5, ly = look[1] * 3.5;
  for (const sgn of [-1, 1]) {
    const cx = sgn * ex, cy = ey;
    const open = 1 - blink;
    if (open > 0.15 && mood !== 'sleepy') {
      const rr = mood === 'wow' ? 14.5 : 12.5;
      ink(ctx, blobPts(cx, cy, rr, rr * (0.55 + 0.45 * open), seed + sgn + 3, 10, 0.03), { w: 3.2 * K, closed: true, p: fp, seed: seed + 30 + sgn, ghost: false, wob: .9 * K });
      const pr = mood === 'wow' ? 6 : 8;
      if (fp > .8) {
        ctx.save(); ctx.fillStyle = PAL.ink;
        ctx.beginPath(); ctx.ellipse(cx + lx, cy + ly, pr, pr * (0.5 + 0.5 * open), 0, 0, 6.29); ctx.fill();
        ctx.fillStyle = PAL.paper; ctx.beginPath(); ctx.arc(cx + lx - 2.6, cy + ly - 3 * open, 2.3, 0, 6.29); ctx.fill();
        ctx.restore();
      }
    } else if (mood === 'sleepy') {
      inkS(arcPts(cx, cy - 2, 12, 7, 0.15, Math.PI - .15, 5), { w: 3.2, p: fp, seed: seed + 40 + sgn, ghost: false });
    } else {
      inkS(arcPts(cx, cy + 2, 12, 6, Math.PI + .3, 6.28 - .3, 5), { w: 3.2, p: fp, seed: seed + 40 + sgn, ghost: false });
    }
    // yanak
    crayon(ctx, ellipsePts(sgn * 46, -52, 9.5, 6.5, 7, 0, 0), PAL.pink, { seed: seed + 50 + sgn, gap: 3.4 * K, lw: 6 * K, jit: 1.4, p: q(0.85, 1), a: .95, dx: 0, dy: 0 });
  }
  // ağız
  const my = -50;
  if (mood === 'wow') inkS(blobPts(0, my + 2, 6.5, 8, seed, 8, .05), { w: 3, closed: true, p: fp, ghost: false, seed: seed + 60 });
  else if (mood === 'sad') inkS(arcPts(0, my + 8, 10, 5, Math.PI + .3, 6.28 - .3, 5), { w: 3, p: fp, ghost: false, seed: seed + 60 });
  else inkS(arcPts(0, my - 3, 11, 8, 0.35, Math.PI - .35, 5), { w: 3, p: fp, ghost: false, seed: seed + 60 });
  ctx.restore();
  // buhar (dönüşümsüz, dünya koordinatında, üstte)
  const st = o.steam ?? 0;
  if (st > 0.02 && p >= 1) {
    steam(ctx, x + Math.sin(o.rot ?? 0) * -100 * s, y - 118 * s * sy, { s: s, amt: st, n: 3, seed: seed, h: 100 });
  }
}

/* --------------------------------------------------------------- küçük fincan (simge) */
// Kalabalık için sade fincan simgesi: kenar, gövde, kulp, buhar. col: gövde boyası
function miniCup(ctx, x, y, s = 0.4, o = {}) {
  const K = 1 / s, seed = o.seed ?? 8, p = o.p ?? 1;
  if (p <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const body = [[-62, -80], [-56, -50], [-40, -22], [-22, -12], [22, -12], [40, -22], [56, -50], [62, -80]];
  crayon(ctx, [...body, [40, -74], [-40, -74]], o.col ?? PAL.orange, { seed, gap: 5 * K, lw: 9 * K, jit: 3, p: clamp(p * 1.4 - .3), ang: -0.8 });
  ink(ctx, body, { w: 3.4 * K, wob: 1.1 * K, seed, p: clamp(p * 1.6), ghost: false });
  ink(ctx, ellipsePts(0, -80, 62, 11, 12, 0, .4), { w: 3.2 * K, closed: true, wob: 1 * K, seed: seed + 1, p: clamp(p * 1.6 - .2), ghost: false });
  ink(ctx, [[58, -70], [84, -68], [88, -46], [50, -38]], { w: 3.2 * K, wob: 1 * K, seed: seed + 2, p: clamp(p * 1.6 - .3), ghost: false });
  ctx.restore();
  if (o.steam) steam(ctx, x, y - 84 * s, { s: s * 1.2, amt: o.steam, n: 2, seed, h: 70 });
}

/* --------------------------------------------------------------- CEZVE */
// Kulplu bakır cezve. foam 0..1 (köpük taşması). fire: alt alev
function cezve(ctx, x, y, o = {}) {
  const s = o.s ?? 1, K = 1 / s, seed = o.seed ?? 31, p = o.p ?? 1, foam = o.foam ?? 0;
  if (p <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot ?? 0); ctx.scale(s * (o.flip ?? 1), s);
  const q = (a, b) => clamp((p - a) / (b - a));
  const body = [[-46, -4], [-58, -34], [-56, -78], [-40, -112], [-30, -132], [30, -132], [40, -112], [56, -78], [58, -34], [46, -4]];
  const bodyC = [...body, [0, -2]];
  crayon(ctx, [[-46, -6], [-56, -34], [-54, -78], [-40, -110], [-28, -128], [28, -128], [40, -110], [54, -78], [56, -34], [46, -6]], o.col ?? PAL.orange, { seed, gap: 5 * K, lw: 9 * K, jit: 3, ang: -1.0, p: q(.4, 1), grain: 1 });
  ink(ctx, body, { w: 3.7 * K, wob: 1.2 * K, seed, p: q(0, .5) });
  // alt
  ink(ctx, [[-46, -4], [0, 2], [46, -4]], { w: 3.4 * K, wob: 1 * K, seed: seed + 1, p: q(0.1, .5), ghost: false });
  // ağız çıkıntısı (sol) ve kulp (sağ, uzun)
  ink(ctx, [[-30, -132], [-44, -140], [-52, -146]], { w: 3.4 * K, seed: seed + 2, p: q(.2, .6), ghost: false });
  ink(ctx, [[30, -132], [40, -134], [58, -126]], { w: 3.4 * K, seed: seed + 3, p: q(.2, .6), ghost: false });
  ink(ctx, [[54, -100], [84, -112], [130, -146], [178, -160]], { w: 5 * K, seed: seed + 4, p: q(.3, .7), ghost: false, wob: 1.5 * K });
  crayon(ctx, [[110, -150], [178, -166], [182, -156], [116, -138]], PAL.brown, { seed: seed + 5, gap: 4 * K, lw: 6 * K, jit: 1.5, p: q(.6, 1) });
  // bant
  ink(ctx, [[-56, -66], [0, -60], [56, -66]], { w: 2.6 * K, col: PAL.ink2, seed: seed + 6, p: q(.4, .8), alpha: .7, ghost: false });
  // köpük (kabarcıklar)
  if (foam > 0.02) {
    const nB = 9;
    for (let i = 0; i < nB; i++) {
      const u = clamp(foam * 1.3 - i * 0.05);
      if (u <= 0) continue;
      const a = i / nB, bx = lerp(-34, 34, a) + Math.sin(S.t * 5 + i * 2) * 3 * foam;
      const by = -132 - 26 * u * (0.7 + 0.5 * Math.abs(Math.sin(i * 2.2))) - 4 * Math.sin(S.t * 7 + i);
      const r = 10 + 8 * rnd01(seed, i);
      const bp = blobPts(bx, by, r, r * .85, seed + i, 8, .06);
      crayon(ctx, bp, PAL.sand, { seed: seed + 60 + i, gap: 3.6 * K, lw: 6 * K, jit: 1, p: 1, dx: 0, dy: 0, still: true, a: .95 });
      ink(ctx, bp, { w: 2.8 * K, wob: .8 * K, closed: true, seed: seed + 70 + i, ghost: false });
    }
  }
  ctx.restore();
}

/* --------------------------------------------------------------- ÇUVAL */
function sack(ctx, x, y, o = {}) {
  const s = o.s ?? 1, K = 1 / s, seed = o.seed ?? 41, p = o.p ?? 1;
  if (p <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot ?? 0); ctx.scale(s * (o.sx ?? 1), s * (o.sy ?? 1));
  const q = (a, b) => clamp((p - a) / (b - a));
  const body = [[-58, -4], [-70, -60], [-56, -118], [-26, -142], [-14, -150], [14, -150], [26, -142], [56, -118], [70, -60], [58, -4]];
  crayon(ctx, [[-56, -8], [-66, -60], [-54, -116], [-24, -140], [24, -140], [54, -116], [66, -60], [56, -8]], o.col ?? PAL.sand, { seed, gap: 5 * K, lw: 9 * K, jit: 3, p: q(.35, 1), ang: -0.5 });
  ink(ctx, body, { w: 3.7 * K, wob: 1.4 * K, seed, p: q(0, .5) });
  ink(ctx, [[-58, -4], [0, 3], [58, -4]], { w: 3.4 * K, seed: seed + 1, p: q(.1, .5), ghost: false });
  // boyun ve bağ
  ink(ctx, [[-16, -148], [-24, -168], [-8, -176]], { w: 3.4 * K, seed: seed + 2, p: q(.3, .7), ghost: false });
  ink(ctx, [[16, -148], [26, -170], [10, -178]], { w: 3.4 * K, seed: seed + 3, p: q(.3, .7), ghost: false });
  ink(ctx, [[-20, -142], [0, -136], [20, -142]], { w: 4 * K, seed: seed + 4, p: q(.4, .8), ghost: false, col: PAL.red });
  // dikiş çizgileri
  for (let i = 0; i < 4; i++) ink(ctx, [[-44 + i * 6, -100 + i * 22], [-30 + i * 6, -94 + i * 22]], { w: 2.4 * K, seed: seed + 10 + i, p: q(.5, .9), col: PAL.ink2, alpha: .6, ghost: false });
  // yazı: kahve çekirdeği simgesi
  const bean = ellipsePts(0, -70, 20, 27, 10, 0.35, 0);
  crayon(ctx, bean, PAL.coffee, { seed: seed + 20, gap: 3.4 * K, lw: 6 * K, jit: 1.2, p: q(.6, 1), dx: 0, dy: 0 });
  ink(ctx, bean, { w: 2.8 * K, closed: true, seed: seed + 21, p: q(.6, 1), ghost: false, wob: .8 * K });
  ink(ctx, [[-6, -92], [4, -76], [-4, -60], [6, -46]], { w: 2.6 * K, col: PAL.sand, seed: seed + 22, p: q(.7, 1), ghost: false, wob: .5 * K });
  ctx.restore();
}

/* --------------------------------------------------------------- İNSAN */
// Sade çocuk figürü. o: robe (kaftan rengi), hat ('fes'|'sarik'|'wig'|'cap'|'tricorn'|'none'), beard, arms ('down'|'cup'|'up'|'both'),
// cup (elinde fincan), bob (0..1 sekme), walk (faz), face ('happy'|'smile'|'o'), flip, p
function person(ctx, x, y, o = {}) {
  const s = o.s ?? 1, K = 1 / s, seed = o.seed ?? 51, p = o.p ?? 1;
  if (p <= 0) return;
  const bob = o.bob ?? 0, walk = o.walk;
  ctx.save(); ctx.translate(x, y - bob * 10 * s); ctx.rotate(o.rot ?? 0); ctx.scale(s * (o.flip ?? 1), s * (1 + bob * 0.03));
  const q = (a, b) => clamp((p - a) / (b - a));
  const robe = o.robe ?? PAL.red;
  const IK = (pts, oo) => ink(ctx, pts, Object.assign({ w: 3.6 * K, wob: 1.2 * K, seed, ghost: false }, oo));
  // bacaklar
  const sw = walk !== undefined ? Math.sin(walk) * 14 : 0;
  IK([[-16, -40], [-16 + sw * .3, -14], [-20 + sw, 0]], { p: q(0, .3), seed: seed + 1 });
  IK([[16, -40], [16 - sw * .3, -14], [20 - sw, 0]], { p: q(0, .3), seed: seed + 2 });
  IK([[-20 + sw, 0], [-32 + sw, 0]], { p: q(.2, .4), seed: seed + 3 }); IK([[20 - sw, 0], [32 - sw, 0]], { p: q(.2, .4), seed: seed + 4 });
  // kaftan
  const bodyPts = [[-36, -190], [-44, -120], [-52, -44], [-40, -34], [0, -30], [40, -34], [52, -44], [44, -120], [36, -190]];
  crayon(ctx, [[-34, -186], [-42, -120], [-50, -46], [0, -34], [50, -46], [42, -120], [34, -186]], robe, { seed: seed + 5, gap: 5.2 * K, lw: 9 * K, jit: 3, p: q(.35, 1), ang: -1.0 });
  IK(bodyPts, { p: q(.05, .45), seed: seed + 6 });
  IK([[0, -186], [2, -100], [-2, -34]], { p: q(.3, .6), seed: seed + 7, w: 2.4, col: PAL.ink2, alpha: .6 });
  // kollar
  const arms = o.arms ?? 'down';
  const bobA = Math.sin(S.t * 3 + seed) * 0.0;
  const armL = (px, py, ex, ey) => IK([[px, py], [(px + ex) / 2 + (ex > px ? -6 : 6), (py + ey) / 2 + 6], [ex, ey]], { p: q(.4, .7), seed: seed + 8 });
  let handR = [58, -100], handL = [-58, -100];
  if (arms === 'cup') handR = [50, -134];
  if (arms === 'up') handR = [62, -190 - 10 * Math.sin(S.t * 6)];
  if (arms === 'both') { handR = [46, -128]; handL = [-46, -128]; }
  armL(34, -172, handR[0], handR[1]);
  armL(-34, -172, handL[0], handL[1]);
  ctx.fillStyle = PAL.pink;
  for (const h of [handR, handL]) { ink(ctx, blobPts(h[0], h[1], 6, 6, seed, 6, .1), { w: 3 * K, closed: true, seed: seed + 9, p: q(.6, .8), ghost: false, wob: .6 * K }); }
  // elinde fincan
  if (o.cup && q(.7, 1) > 0) miniCup(ctx, handR[0] + 2, handR[1] + 8, 0.34, { seed: seed + 60, col: o.cupCol ?? PAL.teal, steam: o.steam ?? 0 });
  // kafa
  const head = blobPts(0, -224, 33, 36, seed + 10, 10, .035);
  crayon(ctx, head, o.skin ?? '#f5cfa3', { seed: seed + 11, gap: 5 * K, lw: 9 * K, jit: 2, p: q(.4, 1), a: .55, ang: .2 });
  IK(head, { closed: true, p: q(.1, .5), seed: seed + 12, w: 3.6 });
  // yüz
  const fp = q(.7, 1);
  const eyeY = -226, bl = (o.blink ?? 0);
  for (const sg of [-1, 1]) {
    if (bl > .5) IK([[sg * 12 - 5, eyeY], [sg * 12 + 5, eyeY]], { w: 3, p: fp, seed: seed + 20 + sg });
    else { ctx.save(); ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(sg * 12, eyeY, 4.2, 0, 6.29); ctx.fill(); ctx.restore(); }
    crayon(ctx, ellipsePts(sg * 20, -212, 6, 4, 6, 0, 0), PAL.pink, { seed: seed + 30 + sg, gap: 3 * K, lw: 5 * K, jit: 1, p: fp, dx: 0, dy: 0, a: .9 });
  }
  IK([[0, -220], [3, -214], [-1, -212]], { w: 2.4, p: fp, seed: seed + 40 });
  const face = o.face ?? 'smile';
  if (face === 'o') IK(blobPts(0, -203, 4.5, 5.5, seed, 8, .05), { w: 2.8, closed: true, p: fp, seed: seed + 41 });
  else IK(arcPts(0, -206, 9, 6, 0.4, Math.PI - .4, 4), { w: 2.8, p: fp, seed: seed + 41 });
  if (o.beard) {
    const bp = [[-24, -212], [-22, -190], [-8, -178], [8, -178], [22, -190], [24, -212], [10, -200], [-10, -200]];
    crayon(ctx, bp, o.beardCol ?? '#8a8175', { seed: seed + 42, gap: 3.6 * K, lw: 6 * K, jit: 2, p: q(.7, 1), a: .9 });
    IK([[-24, -208], [-22, -190], [-8, -178], [8, -178], [22, -190], [24, -208]], { w: 3, p: fp, seed: seed + 43 });
  }
  // şapka
  const hat = o.hat ?? 'none', hc = o.hatCol ?? PAL.red;
  const hp = q(.6, 1);
  if (hat === 'fes') {
    const fes = [[-24, -252], [-20, -290], [20, -290], [24, -252]];
    crayon(ctx, fes, hc, { seed: seed + 50, gap: 4 * K, lw: 8 * K, jit: 2, p: hp });
    IK([...fes, [0, -246]].slice(0, 4), { w: 3.4, p: hp, seed: seed + 51 });
    IK([[-24, -252], [0, -246], [24, -252]], { w: 3, p: hp, seed: seed + 52 });
    IK([[0, -290], [12, -300], [18, -284], [16, -270]], { w: 3, p: hp, seed: seed + 53, col: PAL.ink });
  } else if (hat === 'sarik') {
    const tp = ellipsePts(0, -262, 40, 26, 10, 0, 0);
    crayon(ctx, tp, PAL.white, { seed: seed + 50, gap: 4 * K, lw: 8 * K, jit: 3, p: hp, a: .95, grain: .6 });
    IK(tp, { closed: true, w: 3.6, p: hp, seed: seed + 51 });
    IK([[-30, -252], [-10, -278], [20, -282]], { w: 2.6, p: hp, seed: seed + 52, col: PAL.ink2, alpha: .7 });
    IK([[-36, -262], [-4, -244], [34, -262]], { w: 2.6, p: hp, seed: seed + 53, col: PAL.ink2, alpha: .7 });
  } else if (hat === 'wig') {
    const wg = [[-38, -226], [-46, -252], [-30, -280], [0, -292], [30, -280], [46, -252], [38, -226], [44, -196], [30, -184], [-30, -184], [-44, -196]];
    crayon(ctx, wg, PAL.white, { seed: seed + 50, gap: 4 * K, lw: 8 * K, jit: 3, p: hp, a: .95, grain: .5 });
    // kıvırcık
    for (let i = 0; i < 5; i++) IK(spiralPts(-38 + i * 19, -260 + Math.abs(i - 2) * 6, 2, 9, 1.4, i, 10), { w: 2.4, p: hp, seed: seed + 55 + i });
    IK([[-38, -226], [-46, -252], [-30, -280], [0, -292], [30, -280], [46, -252], [38, -226]], { w: 3.4, p: hp, seed: seed + 51 });
    for (const sg of [-1, 1]) for (let j = 0; j < 2; j++) IK(spiralPts(sg * 38, -200 + j * 14, 2, 8, 1.4, j, 10), { w: 2.4, p: hp, seed: seed + 65 + j + sg });
  } else if (hat === 'tricorn') {
    const tc = [[-56, -252], [0, -296], [56, -252], [0, -240]];
    crayon(ctx, tc, PAL.black, { seed: seed + 50, gap: 4 * K, lw: 8 * K, jit: 2, p: hp, grain: .5 });
    IK(tc, { closed: true, w: 3.4, p: hp, seed: seed + 51 });
  } else if (hat === 'cap') {
    const cp = [[-32, -246], [-24, -276], [24, -276], [32, -246], [48, -244], [32, -238], [-32, -238]];
    crayon(ctx, cp, hc, { seed: seed + 50, gap: 4 * K, lw: 8 * K, jit: 2, p: hp });
    IK(cp, { closed: true, w: 3.4, p: hp, seed: seed + 51 });
  }
  ctx.restore();
}

/* --------------------------------------------------------------- yıldız/pırıltı */
function sparkle(ctx, x, y, r = 12, o = {}) {
  const p = o.p ?? 1, seed = o.seed ?? 6, col = o.col ?? PAL.yellow;
  const rot = o.rot ?? 0;
  for (let i = 0; i < 4; i++) {
    const a = rot + i * Math.PI / 2, r1 = i % 2 ? r * .8 : r;
    ink(ctx, [[x, y], [x + Math.cos(a) * r1 * p, y + Math.sin(a) * r1 * p]], { w: 3.2, col: o.ink ? PAL.ink : col, seed: seed + i, ghost: false, wob: .6 });
  }
}

/* --------------------------------------------------------------- alt yazı */
// Ekranın altına el yazısı açıklama. y taban çizgisi. p: yazılma ilerlemesi
function caption(ctx, str, o = {}) {
  TK.text(ctx, str, o.x ?? TK.W / 2, o.y ?? 1040, o.size ?? 38, { align: o.align ?? 'center', p: o.p ?? 1, w: o.w ?? 2.6, wob: .5, seed: o.seed, col: o.col ?? PAL.ink, slant: 0.05 });
}


/* --------------------------------------------------------------- canlı Fincan */
// Müziğe tepki veren hazır Fincan: kick'te sekme (squash), göz kırpma, buhar melodiyle. info = sahne info'su.
// o: s, color, mood, look, p, bounce (0..1.5 sekme şiddeti çarpanı), steam (taban), seed, dy (ek yükseklik), rot
function fincanAlive(ctx, x, y, info, o = {}) {
  const t = info.t, A = TK.audio, seed = o.seed ?? 21;
  const k = A.pulse('low', t, 0.09) * (o.bounce ?? 1);
  const hop = Math.min(1, k) * (o.hop ?? 0);
  const ph = (t * 0.31 + seed * 0.37) % 3.4;            // her ~3.4 sn'de bir göz kırpma
  const blink = ph > 3.25 ? 1 : 0;
  const st = clamp((o.steam ?? 0.55) + 0.35 * A.env('mid', t), 0, 1);
  fincan(ctx, x, y - hop * 26 + (o.dy ?? 0), {
    s: o.s ?? 0.8, squash: (Math.min(k, 1.2) * 0.13) - 0.02, blink, mood: o.mood ?? 'happy',
    look: o.look ?? [Math.sin(t * 0.7 + seed) * 0.6, Math.sin(t * 0.43) * 0.3], steam: o.steam === 0 ? 0 : st,
    p: o.p ?? 1, color: o.color, seed, rot: o.rot ?? 0, flip: o.flip ?? 1,
  });
}

/* --------------------------------------------------------------- köşeli şekil (ink + boya) */
// pts: köşe noktaları. o: fill (renk), closed (true), smooth (false = köşeli), p (0..1: önce çizgi, sonra boya), seed, w, fillOpts
function shape(ctx, pts, o = {}) {
  const p = o.p ?? 1, seed = o.seed ?? 1, closed = o.closed ?? true;
  if (o.fill && p > 0.35) {
    const fo = Object.assign({ seed: seed + 100, gap: 5.2, lw: 9, jit: 3 }, o.fillOpts, { p: clamp((p - 0.35) / 0.65) });
    if (o.smooth === true) crayon(ctx, pts, o.fill, fo); else TK.crayonPoly(ctx, pts, o.fill, fo);
  }
  ink(ctx, pts, { w: o.w ?? 3.6, wob: o.wob ?? 1.2, seed, closed, smooth: o.smooth ?? false, p: clamp(p / (o.fill ? 0.6 : 1)), col: o.col, ghost: o.ghost, alpha: o.alpha });
}

/* --------------------------------------------------------------- noktalı yol (harita rotası) */
// pts yol noktaları; p ilerleme; yol boyunca kısa çizgiler. Döner: ucun konumu [x,y,açı]
function dotted(ctx, pts, p, o = {}) {
  const P = TK.sample(pts, false, 3), seed = o.seed ?? 3, dash = o.dash ?? 14, gapL = o.gap ?? 12;
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1], end = L * clamp(p);
  const at = (s) => { let i = 1; while (i < P.length - 1 && cum[i] < s) i++; const u = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return [lerp(P[i - 1][0], P[i][0], u), lerp(P[i - 1][1], P[i][1], u), Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0])]; };
  let k = 0;
  for (let s = 0; s < end; s += dash + gapL, k++) {
    const a = at(s), b = at(Math.min(end, s + dash));
    ink(ctx, [[a[0], a[1]], [b[0], b[1]]], { w: o.w ?? 4, col: o.col ?? PAL.red, seed: seed + k, wob: .6, ghost: false });
  }
  return at(end);
}

TK.props = { fincanAlive, shape, dotted, pen, steam, sun, ground, grass, cloud, fincan, miniCup, cezve, sack, person, sparkle, caption };
})(window);
