/* viyana.js: VİYANA (küresel 41.1 -> 57.5 sn)
 * A 41.1-45.2 : surların önünde çuvallar, tricorn'lu adam koklar, çuvaldan Fincan bakar. "rivayete göre".
 * pan (44.55-45.2, cümle başı) -> B 45.2-53.4 : Viyana kafesi, avize, vals (faz = ((t-41.11)/0.513)%3).
 * C 53.4-57.5 : masada süt + bal, "1685: ilk belgeli kahvehane"; 56.9+ minik fincanlar çoğalır.
 * SAF: her kare yalnızca info.t'nin fonksiyonu. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { ink, crayon, seg, clamp, lerp, smooth, easeOut, easeInOut, easeOutBack, rnd01, blobPts, ellipsePts, arcPts } = TK;

const GY = 790;
const I = (ctx, pts, o) => ink(ctx, pts, Object.assign({ w: 3.4, wob: 1.2, ghost: false }, o));
const poly = (ctx, pts, col, o) => TK.crayonPoly(ctx, pts, col, Object.assign({ still: true, jit: 2.5, gap: 4.6, lw: 8 }, o));
const add = (pts, dx, dy) => pts.map(p => [p[0] + dx, p[1] + dy]);
const BEAT = 0.513, G0 = 41.11;
const boing = (u, k = 0.11, f = 24) => u < 0 ? 0 : Math.exp(-u / k) * Math.sin(u * f);

/* ---------------------------------------------------------------- sabit geometri */
const WALL = [[780, 790], [780, 560], [810, 560], [810, 530], [850, 530], [850, 560], [890, 560], [890, 530], [930, 530], [930, 560], [970, 560], [970, 530], [1010, 530], [1010, 560], [1050, 560], [1050, 530], [1100, 530], [1100, 790]];
const GATE = [[900, 790], [900, 700], ...arcPts(950, 700, 50, 58, Math.PI, Math.PI * 2, 6), [1000, 700], [1000, 790]];
const GATE_IN = [[910, 786], [910, 704], ...arcPts(950, 704, 40, 48, Math.PI, Math.PI * 2, 6), [990, 704], [990, 786]];
const BRICKS = (() => { const o = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const x = 800 + c * 56 + (r % 2) * 26 + (rnd01(r * 7 + c, 3) - 0.5) * 8, y = 590 + r * 46; if (x > 890 && x < 1010 && y > 640) continue; o.push([[x, y], [x + 30 + rnd01(c, r) * 12, y + (rnd01(r, c) - 0.5) * 3]]); o.push([[x + 14, y], [x + 14, y + 40]]); } return o; })();
const winPts = cx => [[cx - 90, 520], [cx - 90, 300], ...arcPts(cx, 300, 90, 104, Math.PI, Math.PI * 2, 8), [cx + 90, 300], [cx + 90, 520]];
const WINS = [130, 630].map(cx => ({ cx, pts: winPts(cx) }));
const CURT = cx => [[[cx - 132, 178], [cx - 96, 190], [cx - 102, 360], [cx - 92, 536], [cx - 138, 542], [cx - 126, 360]], [[cx + 132, 178], [cx + 96, 190], [cx + 102, 360], [cx + 92, 536], [cx + 138, 542], [cx + 126, 360]]];
const TABLE_TOP = ellipsePts(540, 606, 190, 26, 14, 0, 0.3);
const RIM = { x: 540, y: 606 - 111 * 0.85 };
const CHX = 380;            // avize ekseni (çiftlerin ortası)
const COUPLES = [{ cx: 230, dir: 1, ph: 0, bey: '#8a2236', lady: '#f4bfd0', top: PAL.yellow, seed: 100 }, { cx: 530, dir: -1, ph: 1.5, bey: '#6f2a3f', lady: '#bfe6df', top: PAL.yellow, seed: 130 }];
const SPARK = [[45.2, 1], [46.8, 2], [49.32, 3], [51.4, 4]];

/* ---------------------------------------------------------------- yardımcılar */
// hanım: (0,0) ayak ortası; dönüş dışarıda ctx.scale ile; etek kenarı sinüsle dalgalanır
function lady(ctx, x, y, o) {
  const s = o.s ?? 0.9, K = 1 / s, seed = o.seed ?? 71, sw = o.sw ?? 0, hop = o.hop ?? 0, ph = o.ph ?? 0, p = o.p ?? 1;
  ctx.save(); ctx.translate(x, y - hop); ctx.scale(s, s);
  const skirt = [[-20, -132], [-40, -90], [-78, -42], [-98, -8], [-60, -1], [-30, -8], [0, -1], [30, -8], [60, -1], [98, -8], [78, -42], [40, -90], [20, -132]];
  ctx.save(); ctx.scale(1 + 0.12 * sw, 1);
  poly(ctx, skirt, o.col ?? PAL.pink, { seed: seed + 1, gap: 5 * K, lw: 9 * K, ang: -1.1, p });
  const amp = 3 + 7 * sw, hem = [];
  for (let i = 0; i <= 8; i++) { const hx = -98 + i * 24.5; hem.push([hx, -5 + amp * Math.sin(hx / 19 + ph)]); }
  I(ctx, [[-20, -132], [-40, -90], [-78, -42], ...hem, [78, -42], [40, -90], [20, -132]], { w: 3.6 * K, seed: seed + 2, smooth: false, p });
  const fs = 5 * Math.sin(ph * 0.8);
  I(ctx, [[-50, -70], [-30 + fs, -30], [-40 + fs, -6]], { w: 2.4 * K, col: PAL.ink2, alpha: 0.55, seed: seed + 3, p });
  I(ctx, [[46, -72], [28 + fs, -32], [38 + fs, -6]], { w: 2.4 * K, col: PAL.ink2, alpha: 0.55, seed: seed + 4, p });
  ctx.restore();
  const bod = [[-20, -132], [-24, -192], [24, -192], [20, -132]];
  poly(ctx, bod, o.top ?? PAL.yellow, { seed: seed + 5, gap: 4.6 * K, lw: 8 * K, p });
  I(ctx, bod, { w: 3.4 * K, seed: seed + 6, smooth: false, p });
  I(ctx, [[24, -184], [62, -166], [86, -168]], { w: 3.4 * K, seed: seed + 7, p });
  I(ctx, [[-24, -184], [-48, -160], [-40, -140]], { w: 3.4 * K, seed: seed + 8, p });
  const head = blobPts(0, -226, 31, 34, seed + 9, 10, 0.035);
  crayon(ctx, head, '#f5cfa3', { seed: seed + 10, gap: 5 * K, lw: 9 * K, jit: 2, a: 0.55, ang: 0.2, p });
  crayon(ctx, [[-33, -232], [-30, -262], [0, -270], [30, -262], [33, -232], [22, -250], [-22, -250]], PAL.brown, { seed: seed + 11, gap: 4 * K, lw: 8 * K, jit: 2, p });
  I(ctx, head, { w: 3.5 * K, closed: true, seed: seed + 12, p });
  const bun = blobPts(0, -282, 14, 12, seed + 13, 8, 0.05);
  crayon(ctx, bun, PAL.brown, { seed: seed + 14, gap: 3.6 * K, lw: 6 * K, jit: 1.5, p, dx: 0, dy: 0 });
  I(ctx, bun, { w: 3 * K, closed: true, seed: seed + 15, p });
  ctx.fillStyle = PAL.ink;
  for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(sg * 12, -226, 4, 0, 6.29); ctx.fill(); crayon(ctx, ellipsePts(sg * 20, -213, 6, 4, 6, 0, 0), PAL.pink, { seed: seed + 16 + sg, gap: 3 * K, lw: 5 * K, jit: 1, dx: 0, dy: 0, a: 0.9, p }); }
  I(ctx, arcPts(0, -208, 9, 6, 0.4, Math.PI - 0.4, 4), { w: 2.8 * K, seed: seed + 20, p });
  ctx.restore();
}

// tricorn (üç köşe şapka): açık altın kenar, üç köşe belirgin. (0,0) = ayak ortası
function tricorn(ctx, x, y, s, flip) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * flip, s);
  const K = 1 / s;
  // yanlarda beyaz peruk lüleleri
  for (const sg of [-1, 1]) { crayon(ctx, ellipsePts(sg * 36, -214, 12, 16, 8, 0, 0), '#fbf7ee', { seed: 71 + sg, gap: 3.4 * K, lw: 6 * K, jit: 1, dx: 0, dy: 0, still: true }); I(ctx, ellipsePts(sg * 36, -214, 12, 16, 8, 0, 0), { w: 2.6 * K, closed: true, seed: 73 + sg, wob: 0.6 }); }
  const hat = [[-64, -244], [-40, -288], [-8, -262], [0, -300], [8, -262], [40, -288], [64, -244], [0, -226]];
  poly(ctx, hat, '#6b3a52', { seed: 75, gap: 4 * K, lw: 8 * K, jit: 1.6 });
  I(ctx, hat, { w: 3.6 * K, closed: true, smooth: false, seed: 76, wob: 0.9 });
  I(ctx, [[-62, -246], [0, -230], [62, -246]], { w: 4.6 * K, col: PAL.yellow, seed: 77, wob: 0.6 });
  ctx.fillStyle = PAL.yellow; for (const [hx, hy] of [[-40, -288], [0, -300], [40, -288]]) { ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 6.29); ctx.fill(); }
  ctx.restore();
}

function tableAt(ctx, x, baseY, s, p, seed) {
  if (p <= 0) return;
  const K = 1 / s;
  ctx.save(); ctx.translate(x - 540 * s, baseY - 786 * s); ctx.scale(s, s);
  const top = clamp(p * 2.5), fill = clamp((p - 0.3) / 0.5), legs = clamp((p - 0.5) / 0.5);
  I(ctx, [[520, 630], [522, 776]], { w: 3.4 * K, seed: seed + 2, p: legs }); I(ctx, [[562, 630], [560, 776]], { w: 3.4 * K, seed: seed + 3, p: legs });
  I(ctx, ellipsePts(540, 786, 90, 12, 10, 0, 0.2), { w: 3.4 * K, closed: true, seed: seed + 4, p: legs });
  if (fill > 0) poly(ctx, TABLE_TOP, '#e8e3d9', { seed: 90, a: 0.85, gap: 5 * K, lw: 9 * K, p: fill, grain: 0.5 });
  I(ctx, TABLE_TOP, { w: 3.7 * K, closed: true, seed: seed + 1, p: top });
  ctx.restore();
}

function jug(ctx, x, y, rot, p) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  const body = [[-26, 0], [-30, -60], [-18, -84], [18, -84], [30, -60], [26, 0]];
  poly(ctx, body, '#f7f1e4', { seed: 501, gap: 4.4, lw: 8, ang: -0.8, p, a: 0.95, grain: 0.5 });
  I(ctx, body, { seed: 502, smooth: false, p, w: 3.5 });
  I(ctx, [[18, -84], [38, -92], [30, -76]], { seed: 503, p, w: 3.2 });
  I(ctx, [[-28, -66], [-52, -62], [-52, -30], [-28, -22]], { seed: 504, p, w: 3.2 });
  ctx.restore();
}
function pot(ctx, x, y, p) {
  ctx.save(); ctx.translate(x, y);
  const body = [[-30, 0], [-38, -40], [-24, -68], [24, -68], [38, -40], [30, 0]];
  poly(ctx, body, PAL.yellow, { seed: 511, gap: 4.4, lw: 8, ang: -0.7, p });
  I(ctx, body, { seed: 512, smooth: false, p, w: 3.5 });
  I(ctx, [[-28, -68], [-18, -80], [18, -80], [28, -68]], { seed: 513, p, w: 3.2 });
  if (p >= 1) TK.text(ctx, 'bal', 0, -22, 24, { align: 'center', w: 2.6, seed: 514 });
  ctx.restore();
}

function sparkleBurst(ctx, x, y, u, seed, R = 34) {
  if (u < 0 || u > 0.7) return;
  const g = easeOut(seg(u, 0, 0.25)), f = 1 - seg(u, 0.25, 0.7);
  ctx.save(); ctx.globalAlpha *= f;
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3 + seed;
    I(ctx, [[x + Math.cos(a) * 10, y + Math.sin(a) * 10], [x + Math.cos(a) * (10 + R * g), y + Math.sin(a) * (10 + R * g)]], { w: 3, col: k % 2 ? PAL.orange : PAL.yellow, seed: seed * 9 + k, wob: 0.5 });
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- A dünyası */
function worldA(ctx, t, A) {
  const p = (a, b) => seg(t, a, b);
  if (p(41.1, 42.0) > 0) P.sun(ctx, 150, 140, 34, { p: p(41.1, 42.2) });
  if (p(41.4, 42.4) > 0) P.cloud(ctx, 400 + (t - 41.1) * 6, 190, 1.0, { p: p(41.4, 42.4), seed: 6 });
  P.ground(ctx, GY, -20, 1100, { p: p(41.1, 41.8), seed: 12 });
  // sur
  const pw = p(41.3, 42.6);
  if (pw > 0) {
    if (pw > 0.35) poly(ctx, WALL, PAL.sand, { seed: 21, a: 0.7, gap: 6, lw: 10, p: clamp((pw - 0.35) / 0.65), ang: -0.4 });
    I(ctx, WALL, { w: 3.7, seed: 22, smooth: false, p: clamp(pw / 0.7), ghost: true });
    BRICKS.forEach((b, i) => I(ctx, b, { w: 2.4, col: PAL.ink2, alpha: 0.55, seed: 30 + i, p: clamp((pw - 0.5) * 2.2 - i * 0.012) }));
    const pg = p(42.2, 42.9);
    if (pg > 0) { poly(ctx, GATE_IN, PAL.brown, { seed: 23, a: 0.6, p: pg, gap: 6, lw: 9, jit: 1.2, dx: 0, dy: 0 }); I(ctx, GATE, { seed: 24, smooth: false, p: pg }); }
  }
  // çuvallar
  const sk = [[220, 0.74, 41.55, 42.11, 3], [360, 0.92, 42.11, 43.15, 8], [510, 1.0, 42.75, 43.91, 12]];
  const pk = sk.map(k => easeOutBack(p(k[2], k[3])));
  const sackAt = i => { const k = sk[i]; if (pk[i] > 0.01) P.sack(ctx, k[0], GY, { s: k[1] * (0.8 + 0.2 * Math.min(1.1, pk[i])), sy: 1 + 0.06 * Math.max(0, boing(t - k[3], 0.15, 20)), p: clamp(pk[i] * 1.4), seed: k[4], sx: 1 }); };
  sackAt(0); sackAt(1);
  const sc3 = sk[2];
  if (pk[2] > 0.5) {
    const LIP = GY - 128, X = sc3[0];
    // çuval gövdesi: yalnızca ağız çizgisinin altı
    ctx.save(); ctx.beginPath();
    ctx.moveTo(X - 130, LIP - 2); ctx.lineTo(X - 70, LIP - 2); ctx.quadraticCurveTo(X, LIP + 16, X + 70, LIP - 2); ctx.lineTo(X + 130, LIP - 2); ctx.lineTo(X + 130, GY + 20); ctx.lineTo(X - 130, GY + 20); ctx.closePath(); ctx.clip();
    sackAt(2);
    ctx.restore();
    // Fincan: alt yarısı çuvalın içinde (ağız çizgisinin üstü görünür)
    const up = easeOut(p(43.95, 44.3));
    const kick = A.pulse('low', t, 0.09);
    const baseY = LIP + 18 - 16 * up - 6 * Math.min(1, kick) * up;
    ctx.save(); ctx.beginPath();
    ctx.moveTo(X - 130, 0); ctx.lineTo(X + 130, 0); ctx.lineTo(X + 130, LIP - 2); ctx.lineTo(X + 70, LIP - 2); ctx.quadraticCurveTo(X, LIP + 16, X - 70, LIP - 2); ctx.lineTo(X - 130, LIP - 2); ctx.closePath(); ctx.clip();
    P.fincan(ctx, X, baseY, { s: 0.52, p: 1, look: [0.9, 0.25], mood: t > 44.17 && t < 44.55 ? 'wow' : 'happy', blink: (t > 43.2 && t < 43.3) ? 1 : 0, color: PAL.teal, seed: 21 });
    ctx.restore();
    // çuvalın ön ağız kıvrımı Fincan'ın üstünde
    const lip = [[X - 62, LIP - 2], [X - 34, LIP + 9], [X, LIP + 13], [X + 34, LIP + 9], [X + 62, LIP - 2]];
    I(ctx, lip, { w: 10, col: PAL.sand, seed: 55, wob: 0.6, alpha: 0.95 });
    I(ctx, lip, { w: 3.6, seed: 56, wob: 0.9 });
    I(ctx, add(lip, 0, 9).map((q, i) => [q[0] * 0.92 + X * 0.08, q[1]]), { w: 3.4, col: PAL.red, seed: 57, wob: 0.8 });
  } else sackAt(2);
  // adam (üç köşe şapkalı)
  const pm = p(42.66, 43.6);
  if (pm > 0) {
    const MX = 690;
    const bob = Math.min(1.2, A.pulse('low', t, 0.1)) * 0.6 * p(43.9, 44.2);
    P.person(ctx, MX, GY, { s: 1.0, flip: -1, hat: 'none', robe: PAL.red, arms: 'cup', face: t > 44.0 ? 'o' : 'smile', p: pm, bob, seed: 61, blink: (t > 44.9 && t < 45.0) ? 1 : 0 });
    if (pm > 0.7) tricorn(ctx, MX, GY - bob * 10, 1.0, -1);
  }
  // koku çizgileri
  const ps = p(43.9, 44.7);
  if (ps > 0) {
    for (let i = 0; i < 3; i++) {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const u = k / 8; pts.push([560 + u * 92, 598 - i * 12 - u * 22 + Math.sin(u * 9 - t * 6 + i * 2) * (5 + 3 * u)]); }
      I(ctx, pts, { w: 3, col: PAL.coffee, seed: 90 + i, p: clamp(ps * 1.2 - i * 0.1), alpha: 0.9 });
    }
  }
  // "rivayete göre"
  const pr = p(42.05, 43.1);
  if (pr > 0) {
    ctx.save(); ctx.translate(730, 110); ctx.rotate(-0.06);
    TK.text(ctx, 'rivayete göre', 0, 0, 46, { align: 'center', p: pr, w: 3, seed: 5, col: PAL.red });
    I(ctx, [[-150, 22], [-60, 30], [40, 20], [140, 28]], { w: 3, col: PAL.red, seed: 6, p: p(42.9, 43.4), alpha: 0.8 });
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- B/C dünyası */
function worldB(ctx, t, A) {
  const p = (a, b) => seg(t, a, b);
  const pIn = p(44.3, 45.4);
  const u = (t - G0) / BEAT;
  const pcOut = p(52.4, 53.0);           // çiftler 53.0'da tamamen biter
  const hiP = Math.min(1, A.pulse('hi', t, 0.08));
  P.ground(ctx, GY, -20, 1100, { p: p(44.2, 44.9), seed: 15 });
  // kareli döşeme şeridi
  const pf = p(44.4, 45.3);
  if (pf > 0) for (let r = 0; r < 2; r++) for (let c = 0; c < 14; c++) {
    if ((r + c) % 2) continue;
    if (pf < (c + r) / 16) continue;
    const x0 = c * 80 - 10, y0 = 796 + r * 30;
    poly(ctx, [[x0, y0], [x0 + 78, y0], [x0 + 78, y0 + 28], [x0, y0 + 28]], '#b03a4a', { seed: 300 + r * 20 + c, a: 0.42, gap: 6, lw: 10, jit: 1.4 });
  }
  // pencereler + perdeler
  WINS.forEach((w, wi) => {
    const pwn = p(44.3 + wi * 0.1, 45.2 + wi * 0.1);
    if (pwn <= 0) return;
    if (pwn > 0.4) poly(ctx, w.pts, PAL.sky, { seed: 41 + wi * 10, a: 0.72, gap: 5.5, lw: 10, p: clamp((pwn - 0.4) / 0.6), ang: -0.7 });
    I(ctx, w.pts, { w: 3.8, seed: 42 + wi * 10, smooth: false, p: clamp(pwn / 0.7) });
    I(ctx, [[w.cx, 196], [w.cx, 520]], { w: 2.8, seed: 43 + wi * 10, p: pwn, col: PAL.ink2 });
    I(ctx, [[w.cx - 90, 380], [w.cx + 90, 380]], { w: 2.8, seed: 44 + wi * 10, p: pwn, col: PAL.ink2 });
    I(ctx, [[w.cx - 104, 522], [w.cx + 104, 522]], { w: 3.6, seed: 45 + wi * 10, p: pwn });
    if (pwn > 0.7) CURT(w.cx).forEach((cp, k) => {
      const pp = clamp((pwn - 0.7) / 0.3);
      poly(ctx, cp, '#a3243b', { seed: 320 + wi * 4 + k, a: 0.85, gap: 5, lw: 9, p: pp, ang: 1.2 });
      I(ctx, cp, { w: 3.4, closed: true, smooth: false, seed: 324 + wi * 4 + k, p: pp });
    });
  });
  // arka plan mermer masaları (yalnızca vals sırasında)
  const ptb0 = p(44.6, 45.4) * (1 - pcOut);
  if (ptb0 > 0.01) {
    ctx.save(); ctx.globalAlpha *= clamp(1 - pcOut * 1.5);
    [[70, 0.4, 700], [690, 0.4, 720]].forEach(([tx, ts, sd], i) => {
      tableAt(ctx, tx, 786, ts, clamp(ptb0 * 1.2), sd);
      if (ptb0 > 0.9) P.miniCup(ctx, tx + 10 * i, 786 - 180 * ts - 4, 0.5, { col: i ? PAL.pink : PAL.orange, seed: 710 + i, p: 1, steam: 0.6 });
    });
    ctx.restore();
  }
  // gazete sopası
  const pgz = p(44.6, 45.4);
  if (pgz > 0) {
    I(ctx, [[905, 250], [1072, 250]], { w: 7, seed: 46, p: pgz, col: PAL.brown, wob: 0.8 });
    if (pgz > 0.7) for (const kx of [903, 1074]) { crayon(ctx, ellipsePts(kx, 250, 8, 8, 8, 0, 0), PAL.brown, { seed: 47 + kx, gap: 3, lw: 6, dx: 0, dy: 0, still: true }); I(ctx, ellipsePts(kx, 250, 8, 8, 8, 0, 0), { w: 2.6, closed: true, seed: 48 + kx, wob: 0.5 }); }
    const paper = [[942, 256], [1044, 256], [1044, 420], [942, 420]];
    poly(ctx, paper, '#efe6d0', { seed: 47, a: 0.85, gap: 6, lw: 10, p: pgz });
    I(ctx, paper, { seed: 48, smooth: false, p: pgz, w: 3.2 });
    for (let i = 0; i < 6; i++) I(ctx, [[954, 312 + i * 17], [1032 - (i % 3) * 14, 312 + i * 17]], { w: 2.2, col: PAL.ink2, alpha: 0.6, seed: 49 + i, p: clamp(pgz * 1.5 - 0.3) });
    if (pgz > 0.8) TK.text(ctx, 'gazete', 993, 296, 26, { align: 'center', w: 2.8, seed: 56, col: PAL.red });
  }

  // avize
  const pch = p(44.4, 45.4);
  if (pch > 0) {
    let sway = Math.sin(t * 1.4) * 2, bump = 0;
    for (const [tb] of SPARK) { const d = t - tb; if (d > 0 && d < 1.6) { sway += 9 * Math.exp(-d / 0.55) * Math.sin(d * 9); bump = Math.max(bump, Math.exp(-d / 0.3)); } }
    const dx = CHX - 540;
    ctx.save(); ctx.translate(CHX, 20); ctx.rotate(sway * 0.006); ctx.translate(-CHX, -20);
    I(ctx, [[CHX, 20], [CHX, 150]], { w: 3.4, seed: 60, p: pch });
    I(ctx, [[CHX, 70], [CHX - 100, 158]], { w: 2.8, seed: 61, p: pch }); I(ctx, [[CHX, 70], [CHX + 100, 158]], { w: 2.8, seed: 62, p: pch });
    const ring = ellipsePts(CHX, 168, 118, 20, 14, 0, 0.3);
    if (pch > 0.6) crayon(ctx, ring, PAL.yellow, { seed: 63, gap: 4.4, lw: 8, a: 0.9, p: clamp((pch - 0.6) * 2.5), ang: -0.1 });
    I(ctx, ring, { w: 3.4, closed: true, seed: 64, p: pch });
    const mid = A.pulse('mid', t, 0.14);
    [[CHX - 88, 170], [CHX, 186], [CHX + 88, 170]].forEach(([cx, cy], i) => {
      const pc = clamp(pch * 1.5 - 0.4 - i * 0.1);
      I(ctx, [[cx, cy], [cx, cy - 34]], { w: 4.2, seed: 65 + i, p: pc, col: PAL.ink });
      if (pc >= 1) {
        const fl = 1 + 0.18 * Math.sin(t * 9 + i * 2) + 0.2 * Math.min(1, mid) + 0.35 * bump;
        ctx.save(); ctx.translate(cx, cy - 34); ctx.scale(fl * 0.9, fl);
        const flame = [[0, -30], [9, -12], [0, 0], [-9, -12]];
        crayon(ctx, flame, i === 1 ? PAL.orange : PAL.yellow, { seed: 70 + i, gap: 3, lw: 5, jit: 1, dx: 0, dy: 0, still: true });
        I(ctx, flame, { w: 2.6, closed: true, seed: 73 + i, wob: 0.6 });
        ctx.restore();
        if (hiP > 0.2) { const L = 5 + 12 * hiP; for (const [ax, ay] of [[1, 0], [0, 1], [-1, 0], [0.7, -0.7], [-0.7, -0.7]]) I(ctx, [[cx + ax * 12, cy - 66 + ay * 12 - (ay < 0 ? 4 : 0)], [cx + ax * (12 + L), cy - 66 + ay * (12 + L) - (ay < 0 ? 4 : 0)]], { w: 2.4, col: PAL.yellow, seed: 80 + i, wob: 0.3, alpha: 0.9 }); }
      }
    });
    ctx.restore();
    for (const [tb, sd] of SPARK) {
      sparkleBurst(ctx, CHX - 88, 110, t - tb, sd); sparkleBurst(ctx, CHX + 88, 110, t - tb - 0.06, sd + 3); sparkleBurst(ctx, CHX, 118, t - tb - 0.03, sd + 6, 42);
    }
  }

  // tezgâh
  const pcn = p(44.5, 45.5);
  if (pcn > 0) {
    const cn = [[772, 570], [1100, 570], [1100, 790], [772, 790]];
    poly(ctx, cn, PAL.brown, { seed: 80, a: 0.7, gap: 6, lw: 10, p: clamp((pcn - 0.3) / 0.7), ang: -0.3 });
    I(ctx, cn, { w: 3.7, seed: 81, smooth: false, p: pcn });
    I(ctx, [[758, 566], [1100, 566]], { w: 5, seed: 82, p: pcn, col: PAL.brown });
    for (let i = 0; i < 3; i++) I(ctx, [[810 + i * 100, 780], [810 + i * 100, 680], ...arcPts(840 + i * 100, 680, 30, 34, Math.PI, Math.PI * 2, 5).slice(1)].slice(0, 8), { w: 2.6, col: PAL.ink2, seed: 83 + i, p: clamp(pcn * 1.4 - 0.4), alpha: 0.7, smooth: true });
    if (pcn > 0.8) P.cezve(ctx, 820, 566, { s: 0.5, p: 1, foam: 0.3 + 0.2 * Math.sin(t * 2), seed: 34 });
  }

  // ---- vals çiftleri
  const S = 0.92;
  if (t < 53.05) {
    const beat = ((Math.floor(u) % 3) + 3) % 3, fr = u - Math.floor(u);
    const amp = beat === 0 ? 30 : 10;
    const hop = amp * Math.pow(Math.sin(Math.PI * fr), 0.8);
    const sw = Math.sin(Math.PI * fr) * (beat === 0 ? 1 : 0.4);
    const scaleOut = 1 - easeInOut(pcOut);
    const SEP = 88;
    COUPLES.forEach((c, ci) => {
      const tin = easeOutBack(seg(t, 44.85 + ci * 0.2, 45.4 + ci * 0.2));
      const k = tin * scaleOut; if (k < 0.03) return;
      const a = c.dir * (Math.PI * 2 * u / 6) + c.ph;
      const sa = Math.sin(a), ca = Math.cos(a);
      const px = c.cx, hy = GY, h = hop * k;
      const sx = (ca >= 0 ? 1 : -1) * Math.max(0.3, Math.min(1, Math.abs(ca) * 2.5));
      const beyX = px + SEP * ca, ladX = px - SEP * ca;
      const beyBack = sa > 0;
      const fig = (x, back, fn) => {
        const d = back ? 0.92 : 1.04, yy = hy + (back ? -8 : 8);
        ctx.save(); ctx.globalAlpha *= back ? 0.78 : 1; ctx.translate(x, yy); ctx.scale(sx * d * k, d * k);
        fn(); ctx.restore();
      };
      const drawBey = () => fig(beyX, beyBack, () => P.person(ctx, 0, -h, { s: S, flip: -1, hat: 'wig', robe: c.bey, arms: 'both', face: 'smile', seed: c.seed + 1, bob: 0 }));
      const drawLad = () => fig(ladX, !beyBack, () => lady(ctx, 0, 0, { s: S, col: c.lady, top: c.top, seed: c.seed + 20, sw, hop: h, ph: u * 2.1 + ci }));
      // sarmal etek çizgileri (zeminde)
      const glow = beat === 0 ? 1 : 0;
      for (let j = 0; j < 2; j++) {
        const a0 = a * 1.6 + j * Math.PI, len = 1.7 + 0.7 * glow * Math.sin(Math.PI * fr);
        I(ctx, arcPts(px, hy + 6, (SEP + 62) * k, 16 * k, a0, a0 + len, 9), { w: 3.6 + glow * 1.2, col: j ? PAL.pink : PAL.sky, seed: c.seed + 50 + j, alpha: 1 });
      }
      if (beyBack) { drawBey(); drawLad(); } else { drawLad(); drawBey(); }
      // kolları birleştiren çizgi (bey ile hanım el ele)
      if (Math.abs(beyX - ladX) > 50) {
        const yy = hy - (118 * S + h) * k, m = (beyX + ladX) / 2, half = Math.abs(beyX - ladX) * 0.34;
        I(ctx, [[m - half, yy + 4], [m, yy - 6], [m + half, yy + 4]], { w: 3.6, seed: c.seed + 60, wob: 0.6 });
        ctx.fillStyle = PAL.pink; ctx.beginPath(); ctx.arc(m, yy - 5, 5 * k, 0, 6.29); ctx.fill();
      }
    });
  }
  if (t > 52.95 && t < 53.7) { sparkleBurst(ctx, 230, 700, t - 52.98, 4, 46); sparkleBurst(ctx, 530, 700, t - 53.02, 7, 46); }

  // ---- masa (C): çiftler kaybolduktan sonra
  const ptb = p(53.0, 53.55);
  if (ptb > 0) tableAt(ctx, 540, 786, 1, ptb, 90);

  // ---- kahraman Fincan
  const kick = Math.min(1.2, A.pulse('low', t, 0.09));
  const tj0 = 53.41, tj1 = 54.15;
  const pj = seg(t, tj0, tj1), ej = easeInOut(pj);
  let hx = lerp(930, 540, ej), hy = lerp(566, 604, ej) - 170 * 4 * pj * (1 - pj);
  const landU = t - tj1;
  let sq = kick * 0.11 - 0.02;
  if (pj > 0 && pj < 1) sq = 0.14 * Math.sin(pj * Math.PI);
  if (landU > 0) sq += -0.15 * Math.max(0, boing(landU, 0.12, 22)) * 1.0;
  const pour = seg(t, 54.43, 55.4), honeyT = seg(t, 55.85, 56.3);
  let look = [-0.4, 0.15], mood = 'happy';
  if (t > 45.2 && t < 53.3) look = [Math.sin(t * 0.9) * 0.7, -0.1];
  if (t > 54.2) look = [-0.9 * (1 - seg(t, 55.5, 55.8)) + 0.8 * seg(t, 55.5, 55.8), -0.7];
  if (t > 56.2) { mood = 'wow'; look = [0, -0.2]; }
  if (t > 56.5) mood = 'happy';
  const hopR = (t > 56.23) ? [56.23, 56.49, 56.75, 56.99].reduce((s, tt) => s + Math.max(0, t - tt < 0.32 && t > tt ? Math.sin((t - tt) / 0.32 * Math.PI) * 14 : 0), 0) : 0;
  if (pIn > 0.5) {
    const blink = ((t * 0.31 + 3.1) % 3.4 > 3.25) ? 1 : 0;
    P.fincan(ctx, hx, hy - hopR, { s: 0.85, squash: sq, look, mood, blink, steam: pour > 0.05 ? 0.5 : 0.6, p: clamp((pIn - 0.5) * 2), color: PAL.teal, seed: 21, flip: t < tj1 ? -1 : 1, rot: pj > 0 && pj < 1 ? 0.25 * Math.sin(pj * Math.PI * 2) * -1 : 0 });
  }

  // ---- süt ve bal (C)
  if (t > 53.4) {
    const pj2 = p(53.5, 54.1);
    const e1 = easeInOut(seg(t, 54.1, 54.43)), e2 = easeInOut(seg(t, 55.3, 55.75));
    const away = e1 * (1 - e2);
    const jx = lerp(400, 405, away), jy = lerp(606, 470, away), jr = 0.95 * away * smooth(seg(t, 54.3, 54.5)) * (1 - smooth(seg(t, 55.25, 55.4)));
    if (pj2 > 0) {
      jug(ctx, jx, jy, jr, pj2);
      if (pj2 >= 1 && away < 0.1) TK.text(ctx, 'süt', 396, 580, 24, { align: 'center', w: 2.6, seed: 515 });
    }
    // akan süt: geniş, beyaz, mavi kenarlı
    if (pour > 0 && pour < 1) {
      const st = clamp(pour * 8), en = 1 - clamp((pour - 0.85) * 6.6);
      const yA = 449 + 2 * Math.sin(t * 30), yB = lerp(449, RIM.y - 2, st);
      if (en > 0.02 && yB > yA) {
        const mid = (yA + yB) / 2;
        I(ctx, [[503, yA], [508, mid], [514, yB]], { w: 16, col: '#fbfaf5', seed: 530, alpha: en, wob: 0.6 });
        I(ctx, [[496, yA], [501, mid], [507, yB]], { w: 2.6, col: PAL.sky, seed: 531, alpha: en, wob: 0.6 });
        I(ctx, [[511, yA], [516, mid], [522, yB]], { w: 2.6, col: PAL.sky, seed: 533, alpha: en, wob: 0.6 });
      }
    }
    const pcr = seg(t, 54.9, 55.5);
    if (pcr > 0) {
      const sp = TK.spiralPts(0, 0, 2, 26, 1.4, 0.4, 20).map(q => [RIM.x - 6 + q[0], RIM.y + 2 + q[1] * 0.26]);
      I(ctx, sp, { w: 3, col: '#f3ead6', seed: 532, p: pcr, alpha: 0.95 });
    }
    pot(ctx, 690, 606, pj2);
    // kaşık: bal kabından fincanın tam üstüne gelir
    const eS = easeInOut(seg(t, 55.35, 55.85)), eR = easeInOut(seg(t, 56.35, 56.8));
    const sx0 = 690, sy0 = 532, sx1 = 556, sy1 = 462;
    const away2 = eS * (1 - eR);
    if (pj2 >= 1) {
      const bx = lerp(sx0, sx1, away2), by = lerp(sy0, sy1, away2);
      I(ctx, [[bx + 66, by - 96], [bx + 30, by - 40], [bx, by]], { w: 5, col: PAL.brown, seed: 540 });
      const ball = blobPts(0, 0, 21, 16, 541, 9, 0.05);
      ctx.save(); ctx.translate(bx, by);
      crayon(ctx, ball, PAL.orange, { seed: 542, gap: 3.2, lw: 6, dx: 0, dy: 0, still: true, jit: 1 });
      I(ctx, ball, { w: 3.2, closed: true, seed: 543, wob: 0.6 });
      I(ctx, [[-9, -6], [-3, -10]], { w: 2.6, col: '#fff3c9', seed: 546, wob: 0.3 });
      ctx.restore();
      // bal damlası: dolu turuncu damla
      if (honeyT > 0 && honeyT < 1 && away2 > 0.9) {
        const dy = lerp(by + 26, RIM.y - 4, honeyT * honeyT);
        const len = 12 + 14 * Math.sin(honeyT * Math.PI);
        if (honeyT < 0.5) I(ctx, [[bx, by + 12], [bx, dy - len]], { w: 5, col: PAL.orange, seed: 545, wob: 0.3 });
        const drop = [[0, -len], [7, -len * 0.3], [9, 2], [0, 10], [-9, 2], [-7, -len * 0.3]];
        ctx.save(); ctx.translate(bx, dy);
        crayon(ctx, drop, PAL.orange, { seed: 547, gap: 2.6, lw: 5, dx: 0, dy: 0, still: true, jit: 0.6 });
        I(ctx, drop, { w: 3, closed: true, seed: 544, wob: 0.3 });
        ctx.restore();
      }
    }
    if (t > 56.28) sparkleBurst(ctx, RIM.x, RIM.y - 50, t - 56.28, 12, 40);
  }

  // ---- fill: minik fincanlar çoğalır
  const MC = [[300, 740, 56.75, PAL.orange], [790, 745, 56.9, PAL.pink], [170, 700, 56.99, PAL.yellow], [900, 690, 57.08, PAL.teal], [70, 760, 57.17, PAL.red], [1005, 748, 57.24, PAL.sky], [400, 770, 57.3, PAL.yellow], [700, 772, 57.36, PAL.orange], [230, 640, 57.42, PAL.teal], [850, 630, 57.47, PAL.pink]];
  MC.forEach(([x, y, ts, col], i) => {
    const uu = t - ts; if (uu < 0) return;
    const g = easeOutBack(seg(uu, 0, 0.22));
    const jp = uu < 0.4 ? Math.sin(uu / 0.4 * Math.PI) * 26 : 0;
    P.miniCup(ctx, x, y - jp, 0.5 * g, { col, steam: 0.7, seed: 600 + i, p: 1 });
  });
}

/* ---------------------------------------------------------------- SAHNE */
TK.scenes.viyana = function draw(ctx, lt, info) {
  const t = info.t, A = info.audio;
  const e = easeInOut(seg(t, 44.55, 45.2));
  if (e < 1) { ctx.save(); ctx.translate(-1080 * e, 0); worldA(ctx, t, A); ctx.restore(); }
  if (e > 0) { ctx.save(); ctx.translate(1080 * (1 - e), 0); worldB(ctx, t, A); ctx.restore(); }
  // alt yazılar: 'Viyana' 52.6-53.0'da erir, yenisi 53.1'de başlar
  const c1 = seg(t, 41.3, 42.1), c1f = 1 - seg(t, 52.6, 53.0);
  if (c1 > 0 && c1f > 0.01) { ctx.save(); ctx.globalAlpha *= c1f; P.caption(ctx, 'Viyana', { p: c1, size: 40, seed: 3 }); ctx.restore(); }
  const c2 = seg(t, 53.1, 54.7);
  if (c2 > 0) P.caption(ctx, '1685: ilk belgeli kahvehane', { p: c2, size: 38, seed: 8 });
};
})();
