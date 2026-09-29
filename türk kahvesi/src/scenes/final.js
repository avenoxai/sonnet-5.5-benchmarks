/* final.js: DUYGUSAL FİNAL (küresel 73.3 → 79.21 sn)
 * Kalabalıktan tek fincana iniş. Boş kağıt, masa, kahraman Fincan + misafir fincan.
 * "Bir fincan kahvenin kırk yıl hatırı vardır." notalara bağlı yazılır; 77.47'de son akor:
 * fincanlar zıplar, yanaklar kızarır, pırıltılar, buhardan kalp. Sonra sakin kapanış.
 * SAF: her kare yalnızca info.t'nin fonksiyonu. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { clamp, lerp, smooth, easeOut, easeOutBack, seg, rnd01, noise1, ellipsePts, arcPts } = TK;

/* ------------------------------------------------------------ zamanlar (küresel sn) */
const T0 = 73.3, TC = 77.47;
const WORDS = [
  { s: 'Bir',      line: 0, t0: 73.95, t1: 74.49 },
  { s: 'fincan',   line: 0, t0: 74.49, t1: 74.99 },
  { s: 'kahvenin', line: 0, t0: 74.99, t1: 75.76 },
  { s: 'kırk',     line: 1, t0: 75.76, t1: 76.29 },
  { s: 'yıl',      line: 1, t0: 76.29, t1: 76.54 },
  { s: 'hatırı',   line: 1, t0: 76.54, t1: 77.06 },
  { s: 'vardır.',  line: 1, t0: 77.06, t1: TC },
];
const LINES = ['Bir fincan kahvenin', 'kırk yıl hatırı vardır.'];
const SIZE = 76;
const BASE = [790, 884];

/* ------------------------------------------------------------ yerleşim */
const TY = 648;                       // masa çizgisi
const HERO = { x: 385, s: 1.3, flip: -1, seed: 21 };
const GUEST = { x: 715, s: 1.14, flip: 1, seed: 47 };
const HEART = { x: 550, y: 318, k: 4.6 };

/* ------------------------------------------------------------ küçük yardımcılar */
// parçalı doğrusal + yumuşak anahtar kareler
function kf(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (u < b[0]) return lerp(a[1], b[1], smooth((u - a[0]) / (b[0] - a[0])));
  }
  return keys[keys.length - 1][1];
}
// sönümlü "boing"
const boing = (u, k = 0.11, f = 24) => u < 0 ? 0 : Math.exp(-u / k) * Math.sin(u * f);

// akorda zıplama: yükseklik (px) ve squash
function hopY(t, d) {
  const u = t - TC - d;
  if (u < 0) return 0;
  if (u < 0.48) { const v = u / 0.48; return 46 * 4 * v * (1 - v); }
  if (u < 0.78) { const v = (u - 0.48) / 0.30; return 11 * 4 * v * (1 - v); }
  return 0;
}
function squashAt(t, d) {
  const u = t - TC - d;
  return kf(u, [[-0.30, 0], [-0.03, -0.12], [0.10, 0.12], [0.32, 0.05], [0.47, 0.0], [0.53, -0.11], [0.66, 0.05], [0.78, 0.03], [0.86, -0.06], [1.15, 0]]);
}

/* buhar: kendi yumuşak ipliklerimiz (kalbe doğru eğilebilir) */
function wisps(ctx, t, x, y, o) {
  const n = o.n ?? 3, h = o.h ?? 120, amt = o.amt ?? 1, sp = o.speed ?? 0.5, seed = o.seed ?? 5, lean = o.lean ?? 0, sc = o.sc ?? 1;
  for (let i = 0; i < n; i++) {
    const c = i - (n - 1) / 2;
    const bx = x + c * 24 * sc;
    const ph = t * sp * 2.2 + i * 1.9 + seed;
    const pts = [], m = 8;
    // kenardaki iplikler daha çok eğilir
    const lw = lean * (0.55 + 0.45 * Math.abs(c) * 0.0 + 0.45 * (o.lean > 0 ? (c + 1) / 2 : (1 - c) / 2) + 0.0);
    for (let k = 0; k <= m; k++) {
      const u = k / m;
      pts.push([bx + Math.sin(ph - u * 4.2) * (6 + 7 * u) * sc + lw * u * u, y - u * h * (0.82 + 0.18 * noise1(i + seed, 3))]);
    }
    TK.ink(ctx, pts, { w: 3.2, wob: 1.0, col: PAL.ink2, seed: seed * 7 + i, p: clamp(amt * (0.86 + 0.28 * rnd01(seed, i))), ghost: false, alpha: (o.alpha ?? 1) * 0.85 });
  }
}

/* fincan + ekstra yanak kızarması */
function cup(ctx, t, C, o) {
  const s = C.s, sq = o.sq || 0, hop = o.hop || 0, rot = o.rot || 0;
  const y = TY - 3 - hop;
  P.fincan(ctx, C.x, y, { s, squash: sq, rot, blink: o.blink || 0, look: o.look, mood: o.mood || 'happy', steam: 0, p: o.p, flip: C.flip, color: o.color, seed: C.seed });
  if (o.p >= 1 && o.blush > 0.01) {
    const K = 1 / s, sx = 1 - sq * 0.7, sy = 1 + sq;
    ctx.save();
    ctx.translate(C.x, y); ctx.rotate(rot); ctx.scale(s * C.flip * sx, s * sy);
    for (const sg of [-1, 1]) {
      crayonBlush(ctx, sg, C.seed, K, o.blush);
    }
    ctx.restore();
  }
}
function crayonBlush(ctx, sg, seed, K, a) {
  const col = TK.mixHex(PAL.pink, PAL.red, 0.38);
  TK.crayon(ctx, ellipsePts(sg * 47, -52, 15.5, 10.5, 8, 0, 0.3), col, { seed: seed + 70 + sg, gap: 3.4 * K, lw: 6.5 * K, jit: 1.4, p: 1, a: 0.92 * a, dx: 0, dy: 0, still: true });
}

/* dört uçlu boyalı yıldız (ctx dönüşümüyle ölçeklenir) */
const STAR = (() => { const o = []; for (let k = 0; k < 8; k++) { const r = k % 2 ? 0.3 : 1; const a = k * Math.PI / 4 - Math.PI / 2; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; })();
function star(ctx, x, y, R, rot, col, seed, alpha) {
  if (alpha <= 0.01 || R < 1) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(R, R);
  TK.crayonPoly(ctx, STAR.map(p => [p[0], p[1]]), col, { seed, gap: 3.2 / R, lw: 6.5 / R, jit: 0.05, p: 1, dx: 0, dy: 0, still: true, grain: 0.6 });
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= alpha;
  TK.ink(ctx, TK.xf(STAR, x, y, R, rot), { w: 2.8, closed: true, smooth: false, seed, ghost: false, wob: 0.8 });
  ctx.restore();
}

/* kalp (parametrik) */
const HEART_PTS = (() => {
  const o = [];
  const n = 16;
  // alt uçtan başla, sola doğru: θ = π → 0 → -π
  for (let i = 0; i < n; i++) {
    const th = Math.PI - (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(th), 3);
    const y = -(13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th));
    o.push([x, y + 2]);
  }
  return o;
})();

function heart(ctx, t) {
  const u = t - TC;
  if (u < 0.05) return;
  const pInk = seg(t, TC + 0.05, TC + 0.75);
  const pFill = seg(t, TC + 0.55, TC + 1.25);
  const pop = easeOutBack(seg(t, TC + 0.05, TC + 0.6));
  const rise = easeOut(seg(t, TC, TC + 1.5));
  const calm = 1 - smooth(seg(t, 78.3, 78.9));
  const bob = Math.sin((t - TC) * 3.2) * 4 * calm;
  const beat = 1 + 0.045 * boing(t - 77.62, 0.2, 14) * calm;
  const k = HEART.k * (0.55 + 0.45 * pop) * beat;
  const cx = HEART.x, cy = HEART.y + 46 * (1 - rise) + bob;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-0.06 + 0.03 * Math.sin((t - TC) * 2.4) * calm); ctx.scale(k, k);
  const K = 1 / k;
  if (pFill > 0) TK.crayon(ctx, HEART_PTS, PAL.red, { seed: 313, gap: 5 * K, lw: 9 * K, jit: 0.4, p: pFill, ang: -0.9, dens: 0.6, dx: 0, dy: 0, a: 0.92 });
  TK.ink(ctx, HEART_PTS, { w: 3.6 * K, wob: 1.2 * K, closed: true, seed: 314, p: pInk, ghost: false });
  ctx.restore();
}

/* ------------------------------------------------------------ SAHNE */
TK.scenes.final = function draw(ctx, lt, info) {
  const t = info.t, A = info.audio;
  const tt = T0 + lt;           // = t (kesin)
  const midP = A.pulse('mid', t, 0.16);
  const after = t - TC;

  // ---------------- masa
  const pT = seg(t, T0, T0 + 0.5);
  if (pT > 0) {
    // ahşap şerit (silik boya)
    const slab = [[130, TY + 6], [560, TY + 9], [960, TY + 5], [968, TY + 26], [560, TY + 30], [125, TY + 27]];
    TK.crayon(ctx, slab, PAL.sand, { seed: 9, gap: 6, lw: 11, jit: 3, ang: -0.05, p: seg(t, T0 + 0.25, T0 + 1.3), a: 0.75, dens: 0.5, still: true });
    P.ground(ctx, TY, 80, 1000, { p: pT, seed: 11 });
  }

  // ---------------- gölgeler (fincanların altı)
  const pShadowH = seg(t, T0 + 0.4, T0 + 1.0);
  const hopH = hopY(t, 0), hopG = hopY(t, 0.05);

  // ---------------- kahraman fincan
  const pHero = seg(t, 73.4, 74.0);
  const pGuest = seg(t, 74.73, 75.6);
  const lookAtGuest = smooth(seg(t, 75.0, 75.5));
  const lookBack = smooth(seg(t, 78.2, 78.6));
  const blinkPhase = (t > 76.86 && t < 76.98) ? 1 : 0;

  // akor tepkisi: gözler, ruh hali
  const wowT = after >= 0 && after < 0.22;
  const closedT = after >= 0.22 && after < 0.95 ? 1 : (after >= 0.95 && after < 1.2 ? 1 - seg(after, 0.95, 1.2) : 0);
  const blush = seg(t, TC, TC + 0.5) * 0.95 + (t < TC ? 0 : 0);

  function shadow(C, hop, p) {
    if (p <= 0) return;
    const sh = 1 - Math.min(1, hop / 90);
    ctx.save();
    ctx.translate(C.x, TY + 14);
    ctx.scale(C.s * sh, C.s * sh);
    TK.crayon(ctx, ellipsePts(0, 0, 105, 8, 9, 0, 0.2), '#cbb48c', { seed: C.seed + 300, gap: 4, lw: 8, jit: 2, ang: -0.05, p: 1, a: 0.7 * p, dx: 0, dy: 0, still: true });
    ctx.restore();
  }
  shadow(HERO, hopH, pHero);
  shadow(GUEST, hopG, pGuest);

  // misafir arkada mı önde mi: iki fincan ayrık, sorun yok
  const heroBoing = midP * 0.02;
  cup(ctx, t, HERO, {
    p: pHero, color: PAL.teal, hop: hopH, sq: squashAt(t, 0) + (t < 77.2 ? heroBoing - 0.012 : 0),
    rot: after > 0 ? 0.05 * Math.sin(after * 9) * Math.exp(-after / 0.5) : 0,
    blink: t < TC ? blinkPhase : closedT, mood: wowT ? 'wow' : 'happy',
    look: [lerp(0.15, -1, lookAtGuest) * (1 - lookBack) + -0.55 * lookBack, 0.1], blush,
  });
  cup(ctx, t, GUEST, {
    p: pGuest, color: PAL.orange, hop: hopG, sq: squashAt(t, 0.05) + (t < 77.2 ? midP * 0.014 - 0.01 : 0),
    rot: after > 0 ? -0.05 * Math.sin((after - 0.05) * 9) * Math.exp(-after / 0.5) : 0,
    blink: t < TC ? ((t > 76.4 && t < 76.52) ? 1 : 0) : closedT, mood: wowT ? 'wow' : 'happy',
    look: [-0.9, 0.1], blush,
  });

  // ---------------- buhar
  const calmS = 1 - 0.5 * smooth(seg(t, 78.4, 78.9));
  const stH = smooth(seg(t, 74.0, 74.7));
  const stG = smooth(seg(t, 75.6, 76.2));
  const leanK = smooth(seg(t, TC + 0.05, TC + 0.8));
  const amtH = stH * clamp(0.6 + 0.32 * midP, 0, 1);
  const amtG = stG * clamp(0.6 + 0.32 * midP, 0, 1);
  const hh = HERO.s, hg = GUEST.s;
  wisps(ctx, t, HERO.x + 4, TY - 3 - hopH - 122 * hh, { n: 3, h: 112 * hh * (0.9 + 0.1 * calmS), amt: amtH, seed: 5, sc: hh, lean: 44 * leanK, speed: 0.5 });
  wisps(ctx, t, GUEST.x - 4, TY - 3 - hopG - 122 * hg, { n: 3, h: 112 * hg * (0.9 + 0.1 * calmS), amt: amtG, seed: 9, sc: hg, lean: -44 * leanK, speed: 0.5 });

  // ---------------- kalp
  heart(ctx, t);

  // ---------------- cümle
  LINES.forEach((line, li) => {
    const lw = TK.textWidth(line, SIZE), ox = 540 - lw / 2;
    const ws = WORDS.filter(w => w.line === li);
    ws.forEach((w, wi) => {
      const gi = WORDS.indexOf(w);
      const pre = ws.slice(0, wi).map(v => v.s).join(' ');
      const wx = ox + (wi === 0 ? 0 : TK.textWidth(pre + ' ', SIZE));
      const p = seg(t, w.t0, w.t1);
      if (p <= 0) return;
      const done = w.t1;
      const dy = -4.5 * Math.max(0, boing(t - done, 0.10, 26)) - 5.5 * Math.max(0, boing(t - (TC + 0.05 * gi + 0.02), 0.13, 22));
      TK.text(ctx, w.s, wx, BASE[li] + dy, SIZE, { p, align: 'left', seed: 100 + gi * 17, w: 4.6, wob: SIZE * 0.011 });
      // başlangıçta küçük parıltı çizgileri (kalem ucu)
      const u = t - w.t0;
      if (u >= 0 && u < 0.5) {
        const g = easeOut(seg(u, 0, 0.16)), f = 1 - seg(u, 0.2, 0.5);
        const px = wx + SIZE * 0.16, py = BASE[li] - SIZE * 0.98;
        for (let k = -1; k <= 1; k++) {
          const a = -Math.PI / 2 + k * 0.62;
          const r0 = 9, r1 = 9 + 17 * g;
          TK.ink(ctx, [[px + Math.cos(a) * r0, py + Math.sin(a) * r0], [px + Math.cos(a) * r1, py + Math.sin(a) * r1]], { w: 3, col: k === 0 ? PAL.orange : PAL.yellow, seed: 500 + gi * 3 + k, alpha: f, ghost: false, wob: 0.5 });
        }
      }
    });
  });

  // ---------------- kırk çentik (5'li gruplar), 75.76 -> 77.0
  {
    const TYY = 936, pitch = 66, h = 30;
    for (let g = 0; g < 8; g++) {
      const gx = 540 + (g - 3.5) * pitch;
      for (let k = 0; k < 5; k++) {
        const idx = g * 5 + k;
        const ts = 75.76 + idx * (1.24 / 40);
        const p = seg(t, ts, ts + 0.07);
        if (p <= 0) continue;
        const sd = 700 + idx;
        const j = (rnd01(sd, 1) - 0.5) * 3;
        if (k < 4) {
          const x = gx - 18 + k * 12 + j;
          TK.ink(ctx, [[x, TYY], [x + 1.5 + j * 0.3, TYY + h * 0.5], [x + (rnd01(sd, 2) - 0.5) * 3, TYY + h]], { w: 3, seed: sd, p, ghost: false, wob: 0.6, col: PAL.ink2 });
        } else {
          TK.ink(ctx, [[gx - 30, TYY + h * 0.82 + j], [gx, TYY + h * 0.5], [gx + 30, TYY + h * 0.14 - j]], { w: 3, seed: sd, p, ghost: false, wob: 0.6, col: PAL.red });
        }
      }
    }
  }

  // ---------------- akor: pırıltılar
  if (after >= 0) {
    const SP = [
      // x, y, R, rot, col, stay
      [262, 448, 15, 0.2, PAL.yellow, 0],
      [405, 330, 13, 0.0, PAL.orange, 1],
      [700, 300, 15, 0.3, PAL.yellow, 1],
      [815, 445, 12, 0.1, PAL.pink, 0],
      [520, 445, 10, 0.4, PAL.yellow, 0],
      [905, 560, 13, 0.2, PAL.orange, 1],
      [180, 575, 11, 0.5, PAL.pink, 1],
    ];
    SP.forEach(([x, y, R, rot, col, stay], i) => {
      const b = 0.02 + i * 0.045;
      const u = after - b;
      if (u < 0) return;
      const grow = easeOutBack(seg(u, 0, 0.32));
      const fade = stay ? lerp(1, 0.9, seg(u, 0.4, 1.5)) : 1 - smooth(seg(u, 0.55 + i * 0.05, 1.6 + i * 0.08));
      const tw = 1 + (stay ? 0 : 0.08 * Math.sin(u * 9)) * (1 - seg(u, 0.6, 1.4));
      const rr = R * grow * tw * (stay ? 0.85 : 1);
      star(ctx, x, y - 6 * easeOut(seg(u, 0, 1.2)), rr, rot + 0.5 * (1 - easeOut(seg(u, 0, 0.5))), col, 800 + i, fade);
    });
    // küçük artı pırıltıları
    const SPK = [[330, 545, 0.06], [600, 385, 0.1], [452, 262, 0.14], [770, 370, 0.18], [860, 500, 0.2]];
    SPK.forEach(([x, y, b], i) => {
      const u = after - b;
      if (u < 0) return;
      const grow = easeOut(seg(u, 0, 0.25));
      const fade = 1 - smooth(seg(u, 0.4, 1.3 + i * 0.1));
      if (fade <= 0.02) return;
      ctx.save(); ctx.globalAlpha *= fade;
      P.sparkle(ctx, x, y, 11, { p: grow, seed: 900 + i * 5, col: i % 2 ? PAL.orange : PAL.yellow, rot: 0.3 });
      ctx.restore();
    });
    // sevinç çizgileri (fincanların yanında)
    for (const [C, dirs] of [[HERO, [-1, -0.55, 0.0]], [GUEST, [0, 0.55, 1]]]) {
      const cy = TY - 70 * C.s;
      dirs.forEach((d, i) => {
        const a = -Math.PI / 2 + d * 1.15 + (d === 0 ? 0 : 0);
        const u = after - 0.03 - i * 0.03;
        if (u < 0) return;
        const g = easeOut(seg(u, 0, 0.22)), f = 1 - smooth(seg(u, 0.3, 0.8));
        if (f <= 0.02) return;
        const R0 = 140 * C.s, R1 = R0 + 34 * g;
        const cx = C.x + (d < 0 ? -20 : d > 0 ? 20 : 0);
        TK.ink(ctx, [[cx + Math.cos(a) * R0, cy + Math.sin(a) * R0], [cx + Math.cos(a) * R1, cy + Math.sin(a) * R1]], { w: 3.2, seed: 950 + i + (C === GUEST ? 7 : 0), alpha: f, ghost: false, wob: 0.6 });
      });
    }
  }
};
})();
