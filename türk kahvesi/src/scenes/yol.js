/* yol.js: "Kervan yolu" (küresel 28.7 -> 39.1 sn).
 * A) 28.7-33.9: kervan sağa yürür (paralaks tepeler, güneş yayı, çimen), adımlar bas vuruşlarına bağlı.
 * B) 33.9-39.1: kamera yükselir, kervan İstanbul'da bir noktaya küçülür; el çizimi Balkanlar haritası çizilir;
 *    kırmızı noktalı rota İstanbul-Edirne-Belgrad-Budin-Viyana; her durakta müzik vuruşuyla iğne çakılır. */
(function () {
const TK = window.TK, P = TK.props, { PAL } = TK;
const { ink, crayon, seg, clamp, lerp, smooth, easeOut, easeInOut, easeOutBack, rnd01, noise1, arcPts, ellipsePts, blobPts } = TK;

const GY = 790;
const TAU = Math.PI * 2;
function I(ctx, pts, o) { ink(ctx, pts, Object.assign({ w: 3.4, wob: 1.2, ghost: false }, o)); }
function polyFill(ctx, pts, col, o) { TK.crayonPoly(ctx, pts, col, Object.assign({ still: true, jit: 2.5, gap: 4, lw: 7 }, o)); }
function cr(ctx, pts, col, o) { crayon(ctx, pts, col, Object.assign({ still: true, jit: 2.5, gap: 4.4, lw: 8 }, o)); }
function mod(a, n) { return ((a % n) + n) % n; }
function fillCircle(ctx, x, y, r, col) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.restore(); }

/* ------------------------------------------------------------------ zaman / ölçekler */
const SCROLL = 118;            // zemin kayma hızı (px/sn)
const STRIDE = 104;            // bir adım döngüsünde alınan yol (px)
const ENTER = 520;             // kervanın soldan giriş mesafesi
const T_ENTER0 = 0.0, T_ENTER1 = 3.2;
const T_LIFT0 = 33.92, T_LIFT1 = 34.4;      // küresel: kamera yükselir, kervan küçülür
const IST = [880, 640];

function entE(lt) { const u = seg(lt, T_ENTER0, T_ENTER1); return lerp(u, smooth(u), 0.5); }
function enterOff(lt) { return -ENTER * (1 - entE(lt)); }
function dist(lt) { return SCROLL * lt + ENTER * entE(lt); }

/* ------------------------------------------------------------------ deve */
const CAM_BODY = [[-120, -150], [-102, -192], [-74, -228], [-34, -256], [8, -238], [30, -204], [70, -198], [102, -208], [124, -268], [150, -314],
  [176, -336], [212, -338], [246, -322], [254, -302], [236, -290], [204, -288], [172, -280], [154, -232], [144, -172], [124, -128], [40, -104], [-60, -104], [-112, -122]];
const CAM_HUMP = [[-96, -206], [-66, -238], [-32, -252], [4, -236], [24, -206], [-30, -214]];
const CAM_HEAD = [[166, -318], [190, -336], [222, -334], [246, -318], [246, -298], [214, -292], [180, -296]];
const LEG = [[-10, 0], [-9, 52], [-11, 100], [-13, 114], [13, 114], [10, 100], [9, 52], [10, 0]];
const BLANKET = [[-92, -160], [-70, -206], [-30, -238], [8, -222], [34, -196], [44, -140], [-40, -126]];

// yüz sağa bakar. o: ph (adım fazı), dip (px, gövde iner), bell (çan sallanması), blink, blanket (renk), seed, trim
function camel(ctx, x, y, s, o) {
  const K = 1 / s, sd = o.seed, ph = o.ph, YC = PAL.yellow;
  const IK = (pts, oo) => I(ctx, pts, Object.assign({ w: 3.5 * K, wob: 1.2 * K, seed: sd }, oo));
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const dip = (o.dip || 0) * K;
  const leg = (hx, f, near, seed) => {
    const a = ph + f * TAU;
    const sw = Math.sin(a) * 0.34, lift = Math.max(0, Math.cos(a)) * 9;
    ctx.save(); ctx.translate(hx, -108 + dip * 0.5 - lift); ctx.rotate(sw);
    cr(ctx, LEG, near ? YC : PAL.orange, { seed: seed + 50, gap: 4 * K, lw: 7.5 * K, a: near ? 0.95 : 0.85 });
    IK(LEG, { closed: true, w: 3.2 * K, seed });
    I(ctx, [[-11, 108], [12, 108]], { w: 3.6 * K, col: PAL.brown, seed: seed + 3, wob: 0.5 * K });
    ctx.restore();
  };
  // uzak bacaklar
  leg(-56, 0.5, false, sd + 10);
  leg(104, 0.5, false, sd + 20);
  ctx.translate(0, dip);
  // kuyruk
  IK([[-118, -152], [-142, -140], [-150, -108]], { w: 3 * K, seed: sd + 12 });
  cr(ctx, ellipsePts(-150, -100, 8, 13, 8, 0, 0), PAL.brown, { seed: sd + 13, gap: 3 * K, lw: 5 * K, jit: 1 });
  // gövde
  cr(ctx, CAM_BODY, YC, { seed: sd + 1, gap: 5.2 * K, lw: 9.5 * K, ang: -0.55, a: 0.97 });
  cr(ctx, CAM_HUMP, PAL.orange, { seed: sd + 2, gap: 5 * K, lw: 8 * K, ang: 0.5, a: 0.7 });
  IK(CAM_BODY, { closed: true, seed: sd + 3 });
  // semer örtüsü
  cr(ctx, BLANKET, o.blanket, { seed: sd + 4, gap: 4.4 * K, lw: 8 * K, a: 0.9 });
  IK(BLANKET, { closed: true, smooth: false, w: 3 * K, seed: sd + 5 });
  for (let i = 0; i < 4; i++) IK([[-78 + i * 26, -150], [-66 + i * 26, -166], [-54 + i * 26, -150]], { w: 2.6 * K, col: PAL.yellow, seed: sd + 6 + i });
  // baş: yüz
  cr(ctx, CAM_HEAD, PAL.sand, { seed: sd + 20, gap: 4 * K, lw: 7 * K, a: 0.55 });
  IK([[150, -300], [152, -252]], { w: 2.2 * K, col: PAL.ink2, seed: sd + 21 });
  IK([[176, -334], [170, -358], [192, -342]], { w: 3 * K, seed: sd + 22 });
  const ex = 204, ey = -316;
  fillCircle(ctx, ex, ey, 11, PAL.white);
  IK(ellipsePts(ex, ey, 11, 11, 12, 0, 0), { closed: true, w: 2.8 * K, seed: sd + 23 });
  if (o.blink) IK([[ex - 10, ey], [ex + 10, ey]], { w: 4 * K, seed: sd + 24 });
  else { fillCircle(ctx, ex + 2.5, ey + 1, 6, PAL.ink); fillCircle(ctx, ex + 5, ey - 1.5, 2.2, PAL.white); }
  IK([[ex - 7, ey - 11], [ex - 13, ey - 21]], { w: 2.4 * K, seed: sd + 25 });
  IK([[ex, ey - 13], [ex - 2, ey - 25]], { w: 2.4 * K, seed: sd + 26 });
  IK([[ex + 8, ey - 11], [ex + 10, ey - 22]], { w: 2.4 * K, seed: sd + 27 });
  cr(ctx, blobPts(190, -294, 10, 6.5, sd + 28, 8, 0.05), PAL.pink, { seed: sd + 29, gap: 3 * K, lw: 5 * K, jit: 1, a: 0.9 });
  I(ctx, [[243, -313], [245, -311]], { w: 3.4 * K, seed: sd + 30, wob: 0.3 });
  IK(arcPts(226, -300, 12, 6, 0.3, Math.PI - 0.5, 5), { w: 2.6 * K, seed: sd + 31 });
  // çan
  const bs = Math.sin(o.bell * 9) * 0.35 * Math.min(1, Math.abs(o.bell) * 3);
  ctx.save(); ctx.translate(146, -228); ctx.rotate(bs);
  IK([[0, 0], [0, 14]], { w: 2.4 * K, seed: sd + 32, wob: 0.3 });
  cr(ctx, ellipsePts(0, 26, 11, 12, 8, 0, 0), PAL.yellow, { seed: sd + 33, gap: 3 * K, lw: 5.5 * K, jit: 1, a: 1 });
  IK(ellipsePts(0, 26, 11, 12, 8, 0, 0), { closed: true, w: 2.6 * K, seed: sd + 34, wob: 0.6 * K });
  ctx.restore();
  // yakın bacaklar
  ctx.translate(0, -dip);
  leg(-84, 0, true, sd + 30);
  leg(74, 0, true, sd + 40);
  ctx.restore();
}

/* ------------------------------------------------------------------ çuval + Fincan'ın gözleri */
function eye(ctx, x, y, r, dx, dy, blink, seed) {
  fillCircle(ctx, x, y, r, PAL.white);
  I(ctx, ellipsePts(x, y, r, r, 10, 0, 0), { seed, closed: true, w: 2.6 });
  if (blink) { I(ctx, [[x - r, y], [x + r, y]], { seed: seed + 1, w: 3.4 }); return; }
  fillCircle(ctx, x + dx * 3, y + dy * 3, r * 0.58, PAL.ink);
  fillCircle(ctx, x + dx * 3 + 2.4, y + dy * 3 - 2.4, r * 0.2, PAL.white);
}
// s: ölçek. (x,y) tabanı. peek: içinden Fincan bakar
function sackAt(ctx, x, y, s, rot, o) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  P.sack(ctx, 0, 0, { s: 1, p: 1, seed: o.seed, col: o.col });
  if (o.peek) {
    const lt = o.lt;
    const bl = (lt % 2.6) > 2.46;
    const look = [Math.sin(lt * 1.3) * 0.9, 0.1 - o.up * 0.6];
    eye(ctx, -11, -162 - o.up * 3, 9.5, look[0], look[1], bl, o.seed + 90);
    eye(ctx, 11, -162 - o.up * 3, 9.5, look[0], look[1], bl, o.seed + 93);
    cr(ctx, blobPts(-25, -150, 7, 4.5, 95, 8, 0.05), PAL.pink, { seed: 96, gap: 3, lw: 5, jit: 1, a: 0.9 });
    cr(ctx, blobPts(25, -150, 7, 4.5, 97, 8, 0.05), PAL.pink, { seed: 98, gap: 3, lw: 5, jit: 1, a: 0.9 });
    P.steam(ctx, 0, -186, { s: 1, n: 2, amt: clamp(0.45 + 0.6 * o.mid, 0, 1), h: 110, seed: 8 });
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ manzara parçaları */
function mound(ctx, sx, w, h, col, seed, alpha, p) {
  const top = arcPts(sx, GY, w / 2, h, Math.PI, TAU, 10);
  const poly = top.concat([[sx + w / 2, GY], [sx - w / 2, GY]]);
  cr(ctx, poly, col, { seed: seed + 5, gap: 8, lw: 15, a: alpha, p: p });
  I(ctx, top, { seed, w: 3.2, p: p });
}
function tuft(ctx, x, y, s, seed) {
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.42 + (rnd01(seed, i) - 0.5) * 0.2 + Math.sin(TK.S.t * 1.7 + x * 0.02 + i) * 0.05;
    const h = (24 + rnd01(seed, i + 9) * 16) * s;
    I(ctx, [[x + (i - 1) * 5 * s, y], [x + (i - 1) * 5 * s + Math.sin(a) * h * 0.5, y - h * 0.55], [x + (i - 1) * 5 * s + Math.sin(a) * h + a * 6, y - h]], { w: 2.8, col: PAL.green2, seed: seed * 5 + i, wob: 0.8 });
  }
}
function pebble(ctx, x, y, r, seed) { I(ctx, blobPts(x, y, r, r * 0.6, seed, 8, 0.08), { closed: true, w: 2.4, col: PAL.ink2, seed, wob: 0.5 }); }
function bird(ctx, x, y, sc, ph, seed) {
  const fl = Math.sin(ph) * 0.9;
  I(ctx, [[x - 20 * sc, y - 9 * sc * fl - 3 * sc], [x - 10 * sc, y - 9 * sc * fl * 0.3 - 6 * sc], [x, y]], { w: 3, seed });
  I(ctx, [[x + 20 * sc, y - 9 * sc * fl - 3 * sc], [x + 10 * sc, y - 9 * sc * fl * 0.3 - 6 * sc], [x, y]], { w: 3, seed: seed + 1 });
}
function mosque(ctx, x, p) {
  const dome = arcPts(x, GY, 44, 44, Math.PI, TAU, 8);
  cr(ctx, dome.concat([[x + 44, GY], [x - 44, GY]]), PAL.lilac, { seed: 401, gap: 5, lw: 9, a: 0.55, p });
  I(ctx, dome, { seed: 402, p });
  I(ctx, [[x - 60, GY], [x + 60, GY]], { seed: 403, w: 3, p });
  for (const [dx, hh] of [[-74, 128], [74, 108]]) {
    I(ctx, [[x + dx - 5, GY], [x + dx - 5, GY - hh]], { seed: 410 + dx, w: 3, p });
    I(ctx, [[x + dx + 5, GY], [x + dx + 5, GY - hh]], { seed: 411 + dx, w: 3, p });
    I(ctx, [[x + dx - 8, GY - hh], [x + dx, GY - hh - 26], [x + dx + 8, GY - hh]], { seed: 412 + dx, w: 3, p, smooth: false });
    I(ctx, [[x + dx - 9, GY - hh * 0.7], [x + dx + 9, GY - hh * 0.7]], { seed: 413 + dx, w: 3, p });
  }
  I(ctx, [[x, GY - 44], [x, GY - 60]], { seed: 404, w: 2.6, p });
}

const MOUNDS_FAR = [[200, 560, 150, PAL.lilac, 11], [1050, 440, 112, PAL.sky, 12], [1750, 640, 176, PAL.lilac, 13]];
const MOUNDS_NEAR = [[560, 400, 82, PAL.green, 21], [1200, 340, 64, PAL.yellow, 22], [1650, 460, 96, PAL.green, 23]];
const TUFTS = [];
for (let i = 0; i < 11; i++) TUFTS.push([60 + i * 176 + rnd01(5, i) * 90, i]);
const PEBS = [[120, 0], [620, 1], [1130, 2], [1490, 3]];

/* ------------------------------------------------------------------ HARİTA verisi */
const MC = [[872, 630], [840, 655], [800, 678], [760, 690], [700, 675], [650, 692], [618, 722], [585, 745], [600, 775], [590, 805], [612, 830], [580, 852], [545, 805], [522, 745], [515, 695], [500, 655]];
const MA = [[500, 655], [470, 590], [430, 510], [370, 430], [315, 360], [270, 320], [255, 300]];
const MB = [[1110, 170], [960, 180], [930, 300], [955, 430], [925, 540], [880, 610], [872, 630]];
const IE = [[215, 318], [270, 405], [350, 480], [420, 570], [490, 660], [525, 695]];
const IW = [[490, 712], [400, 705], [300, 650], [200, 570], [100, 480], [-40, 400], [-40, 300]];
const ASEA = [[1110, 765], [1020, 782], [930, 752], [885, 712], [845, 680]];
const LAND_M = [[-40, -40], [1120, -40]].concat(MB, MC.slice(1), MA.slice(1), [[200, 290], [-40, 290]]);
const IT_LINE = IW.slice().reverse().concat(IE.slice().reverse());
const LAND_I = IE.concat(IW, [[-40, 280], [215, 280]]);
const LAND_A = [[902, 650], [960, 616], [1040, 592], [1120, 563], [1120, 765], [1020, 782], [930, 752], [885, 712], [845, 680], [875, 668]];
const SEA_BLACK = [[960, 180], [1120, 170], [1120, 563], [1040, 592], [960, 616], [902, 650], [890, 640], [872, 630], [880, 610], [925, 540], [955, 430], [930, 300]];
const SEA_ADR = MA.concat([[235, 298]], IE);
const SEA_SOUTH = ASEA.concat(MC.slice(1), [[525, 695]], IW, [[-40, 300], [-40, 900], [1120, 900]]);
const COAST_S = [[872, 630], [840, 655], [800, 678], [760, 690], [700, 675], [650, 692], [618, 722], [585, 745], [600, 775], [590, 805], [612, 830], [580, 852], [545, 805], [522, 745], [515, 695], [500, 655], [470, 590], [430, 510], [370, 430], [315, 360], [270, 320], [255, 300]];
const COAST_B = [[872, 630], [880, 610], [925, 540], [955, 430], [930, 300], [960, 180], [1120, 170]];
const DANUBE = [[405, 224], [428, 243], [470, 285], [500, 345], [540, 420], [620, 440], [720, 410], [820, 360], [930, 300]];

const ROUTE = [[880, 640], [820, 612], [760, 590], [690, 545], [610, 505], [540, 470], [500, 430], [490, 370], [480, 315], [470, 265], [430, 230], [390, 205], [355, 178]];
const STOPS = [
  { name: 'İstanbul', T: 34.44, wp: 0, lx: 848, ly: 728, al: 'right' },
  { name: 'Edirne', T: 34.94, wp: 2, lx: 765, ly: 640, al: 'center' },
  { name: 'Belgrad', T: 35.96, wp: 6, lx: 528, ly: 420, al: 'left' },
  { name: 'Budin', T: 36.98, wp: 9, lx: 500, ly: 268, al: 'left' },
  { name: 'Viyana', T: 38.14, wp: 12, lx: 402, ly: 196, al: 'left' },
];
let ROUTE_INFO = null;
function routeInfo() {
  if (ROUTE_INFO) return ROUTE_INFO;
  const S = TK.sample(ROUTE, false, 3), cum = [0];
  for (let i = 1; i < S.length; i++) cum.push(cum[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]));
  const L = cum[cum.length - 1];
  const pw = STOPS.map(st => {
    const w = ROUTE[st.wp]; let bi = 0, bd = 1e9;
    S.forEach((q, i) => { const d = Math.hypot(q[0] - w[0], q[1] - w[1]); if (d < bd) { bd = d; bi = i; } });
    return cum[bi] / L;
  });
  return (ROUTE_INFO = { pw });
}
// T anında rota ilerlemesi (0..1): duraktan durağa, vuruşa varır
function routeP(T) {
  const pw = routeInfo().pw;
  if (T <= STOPS[0].T) return 0;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (T < STOPS[i + 1].T) {
      const u = (T - STOPS[i].T) / (STOPS[i + 1].T - STOPS[i].T);
      return lerp(pw[i], pw[i + 1], easeInOutSoft(u));
    }
  }
  return 1;
}
function easeInOutSoft(u) { return lerp(u, smooth(u), 0.55); }

function pin(ctx, x, y, T, T0, seed) {
  const u = T - T0;
  if (u < 0) return;
  const drop = easeOutBack(clamp(u / 0.26));
  const dy = -46 * (1 - drop);
  const sq = u > 0.2 ? Math.exp(-(u - 0.2) * 9) * Math.cos((u - 0.2) * 34) * 0.18 : 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(1 - sq, 1 + sq);
  I(ctx, [[0, dy], [0, dy - 26]], { w: 3, seed, wob: 0.5 });
  cr(ctx, ellipsePts(0, dy - 34, 11, 11, 9, 0, 0), PAL.red, { seed: seed + 2, gap: 3, lw: 5.5, jit: 1, a: 1 });
  I(ctx, ellipsePts(0, dy - 34, 11, 11, 9, 0, 0), { closed: true, w: 3, seed: seed + 3, wob: 0.6 });
  fillCircle(ctx, -3.5, dy - 38, 2.4, PAL.white);
  ctx.restore();
  // halka dalgası
  if (u < 0.7 && u > 0.12) {
    const r = 8 + 42 * easeOut((u - 0.12) / 0.58);
    I(ctx, ellipsePts(x, y, r, r * 0.42, 14, 0, 0), { closed: true, w: 2.6, col: PAL.red, alpha: 1 - (u - 0.12) / 0.58, seed: seed + 5, wob: 0.6 });
  }
}
function label(ctx, st, T) {
  const p = seg(T, st.T + 0.06, st.T + 0.62);
  if (p <= 0) return;
  TK.text(ctx, st.name, st.lx, st.ly, 36, { p, align: st.al, w: 2.7, wob: 0.5, seed: 700 + st.wp });
}
function castle(ctx, x, y, sc, T) {
  if (sc <= 0.01) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  const K = 1 / sc;
  const IK = (pts, o) => I(ctx, pts, Object.assign({ w: 3.4 * K, seed: 800 }, o));
  const wall = [[-60, 0], [-60, -46], [60, -46], [60, 0]];
  polyFill(ctx, wall, PAL.gray, { seed: 801, gap: 4 * K, lw: 7 * K, a: 0.7 });
  IK(wall, { closed: true, smooth: false, seed: 802 });
  // mazgal
  const cren = [[-60, -46], [-60, -56], [-46, -56], [-46, -46]];
  for (let i = 0; i < 5; i++) IK([[-60 + i * 24, -46], [-60 + i * 24, -56], [-48 + i * 24, -56], [-48 + i * 24, -46]], { smooth: false, w: 3 * K, seed: 810 + i });
  // kuleler
  for (const [tx, th, col] of [[-62, 88, PAL.red], [0, 118, PAL.red], [62, 88, PAL.red]]) {
    const tw = tx === 0 ? 24 : 20;
    const body = [[tx - tw, 0], [tx - tw, -th], [tx + tw, -th], [tx + tw, 0]];
    polyFill(ctx, body, PAL.gray, { seed: 820 + tx, gap: 4 * K, lw: 7 * K, a: 0.7 });
    IK(body, { closed: true, smooth: false, seed: 821 + tx });
    const roof = [[tx - tw - 6, -th], [tx, -th - 40], [tx + tw + 6, -th]];
    polyFill(ctx, roof, col, { seed: 830 + tx, gap: 3.4 * K, lw: 6 * K, a: 0.95 });
    IK(roof.concat([roof[0]]), { smooth: false, seed: 831 + tx });
    IK([[tx - 4, -th + 22], [tx - 4, -th + 34]], { w: 3 * K, seed: 832 + tx });
  }
  // kapı
  IK([[-12, 0], [-12, -22]].concat(arcPts(0, -22, 12, 12, Math.PI, TAU, 5)).concat([[12, 0]]), { smooth: false, w: 3 * K, seed: 840 });
  // bayrak
  const fl = Math.sin(T * 6) * 3;
  IK([[0, -158], [0, -182]], { w: 2.6 * K, seed: 841 });
  polyFill(ctx, [[0, -182], [22, -177 + fl], [0, -170]], PAL.red, { seed: 842, gap: 2.6 * K, lw: 5 * K, a: 1 });
  IK([[0, -182], [22, -177 + fl], [0, -170]], { smooth: false, w: 2.4 * K, seed: 843 });
  ctx.restore();
}
function triMount(ctx, x, y, s, seed, col) {
  const pts = [[x - 46 * s, y], [x - 8 * s, y - 62 * s], [x + 14 * s, y - 38 * s], [x + 30 * s, y - 52 * s], [x + 62 * s, y]];
  cr(ctx, pts.concat([[x, y + 4]]), col, { seed: seed + 1, gap: 4, lw: 7, a: 0.7 });
  I(ctx, pts, { seed, w: 3, smooth: false });
  I(ctx, [[x - 20 * s, y - 40 * s], [x - 8 * s, y - 34 * s], [x + 2 * s, y - 44 * s]], { seed: seed + 2, w: 2.2, col: PAL.ink2, smooth: false });
}
function boat(ctx, x, y, T) {
  const bob = Math.sin(T * 1.7) * 3, rot = Math.sin(T * 1.3 + 1) * 0.04;
  ctx.save(); ctx.translate(x, y + bob); ctx.rotate(rot); ctx.scale(0.62, 0.62);
  const hull = [[-36, 0], [36, 0], [26, 15], [-26, 15]];
  polyFill(ctx, hull, PAL.orange, { seed: 901, gap: 6, lw: 10 });
  polyFill(ctx, [[4, -70], [4, -6], [42, -6]], PAL.white, { seed: 902, gap: 7, lw: 12, a: 0.9 });
  I(ctx, hull.concat([hull[0]]), { seed: 903, smooth: false, w: 5 });
  I(ctx, [[0, 1], [0, -74]], { seed: 904, w: 5 });
  I(ctx, [[4, -70], [4, -6], [42, -6], [4, -70]], { seed: 905, smooth: false, w: 4.4 });
  ctx.restore();
}
function wave(ctx, x, y, w, seed, T) {
  const d = Math.sin(T * 1.5 + seed) * 2;
  I(ctx, [[x, y], [x + w * 0.25, y - 6 + d], [x + w * 0.5, y], [x + w * 0.75, y - 6 - d], [x + w, y]], { w: 2.6, col: PAL.blue, seed, alpha: 0.8 });
}

const WARM = { next: 0 };
const MAPFILLS = [
  (c) => cr(c, SEA_SOUTH, PAL.sky, { seed: 41, gap: 14, lw: 26, a: 0.62, ang: -0.35 }),
  (c) => cr(c, SEA_ADR, PAL.sky, { seed: 42, gap: 10, lw: 20, a: 0.62, ang: -0.35 }),
  (c) => cr(c, SEA_BLACK, PAL.sky, { seed: 43, gap: 10, lw: 20, a: 0.62, ang: -0.35 }),
  (c) => cr(c, LAND_M, PAL.sand, { seed: 44, gap: 14, lw: 26, a: 0.72, ang: -0.7 }),
  (c) => cr(c, LAND_I, PAL.sand, { seed: 45, gap: 8, lw: 15, a: 0.72, ang: -0.7 }),
  (c) => cr(c, LAND_A, PAL.sand, { seed: 46, gap: 8, lw: 15, a: 0.72, ang: -0.7 }),
  (c) => cr(c, blobPts(470, 300, 96, 62, 51, 10, 0.08), PAL.green, { seed: 47, gap: 7, lw: 13, a: 0.5 }),
  (c) => cr(c, blobPts(700, 470, 70, 46, 52, 10, 0.08), PAL.green, { seed: 48, gap: 7, lw: 13, a: 0.4 }),
  (c) => cr(c, blobPts(1000, 700, 80, 42, 53, 10, 0.08), PAL.yellow, { seed: 49, gap: 7, lw: 13, a: 0.45 }),
];

/* ------------------------------------------------------------------ SAHNE */
TK.scenes.yol = function draw(ctx, lt, info) {
  const T = info.t, A = TK.audio;
  const lowP = clamp(A.pulse('low', T, 0.1), 0, 1.4), midP = clamp(A.pulse('mid', T, 0.12), 0, 1.3), hiP = clamp(A.pulse('hi', T, 0.1), 0, 1.3);
  const midE = clamp(A.env('mid', T), 0, 1);

  // önbellek ısıtma: kare başına en fazla bir dolgu, bir kez (çıktıyı etkilemez)
  if (T < 33.9) { const k = WARM.next++; if (k < MAPFILLS.length) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); MAPFILLS[k](ctx); ctx.restore(); } }

  ctx.save();
  ctx.beginPath(); ctx.rect(-50, 0, 1180, 892); ctx.clip();

  /* ============ A) KERVAN ============ */
  const lift = seg(T, T_LIFT0, T_LIFT1);
  const aAlpha = 1 - seg(T, T_LIFT0, T_LIFT1);
  if (aAlpha > 0.01) {
    ctx.save();
    if (lift > 0) {
      const k = 1 - easeInOut(lift) * 0.965;
      ctx.translate(IST[0], IST[1]); ctx.scale(k, k); ctx.translate(-IST[0], -IST[1]);
    }
    ctx.globalAlpha *= aAlpha;
    const sc = SCROLL * lt;

    // güneş yayı
    const CX = 540, CY = 700, RX = 470, RY = 520;
    const a0 = Math.PI + 0.42, a1 = TAU - 0.42;
    const sa = lerp(a0, a1, seg(lt, 0.3, 6.2));
    const sunP = seg(lt, 0.25, 1.3);
    if (sunP > 0) {
      const trail = arcPts(CX, CY, RX, RY, a0, sa, Math.max(3, Math.round((sa - a0) * 10)));
      if (trail.length > 2) I(ctx, trail, { w: 2.4, col: PAL.ink2, alpha: 0.4, seed: 5, wob: 0.8 });
      const sx = CX + Math.cos(sa) * RX, sy = CY + Math.sin(sa) * RY;
      ctx.save(); ctx.translate(sx, sy); ctx.scale(1 + 0.05 * midP, 1 + 0.05 * midP);
      P.sun(ctx, 0, 0, 34, { p: sunP, seed: 3 });
      ctx.restore();
    }
    // bulutlar
    for (const [cx0, cy0, cs, sp, sdd] of [[300, 250, 0.95, 12, 7], [760, 330, 0.75, 9, 9]]) {
      const cp = seg(lt, 0.5, 1.5);
      if (cp > 0) P.cloud(ctx, mod(cx0 - lt * sp + 200, 1500) - 200, cy0, cs, { p: cp, seed: sdd });
    }
    // İstanbul silueti (geride kalır)
    const mp = seg(lt, 0.15, 0.9);
    if (mp > 0) { const mx = 250 - sc * 0.6; if (mx > -160) mosque(ctx, mx, mp); }
    // tepeler
    const hp = seg(lt, 0.3, 1.3);
    if (hp > 0) {
      for (const [wx, w, h, col, sdd] of MOUNDS_FAR) {
        const x = mod(wx - sc * 0.22 + 700, 2400) - 700;
        if (x + w / 2 > -40 && x - w / 2 < 1120) mound(ctx, x, w, h, col, sdd, 0.5, hp);
      }
      for (const [wx, w, h, col, sdd] of MOUNDS_NEAR) {
        const x = mod(wx - sc * 0.5 + 600, 2000) - 600;
        if (x + w / 2 > -40 && x - w / 2 < 1120) mound(ctx, x, w, h, col, sdd, 0.6, hp);
      }
    }
    // zemin
    P.ground(ctx, GY, -20, 1100, { p: seg(lt, 0, 0.7), seed: 11 });
    // çimen ve taşlar (zeminle birlikte kayar)
    const gp = seg(lt, 0.4, 1.2);
    if (gp > 0) {
      for (const [wx, i] of TUFTS) {
        const x = mod(wx - sc + 300, 1980) - 300;
        if (x > -40 && x < 1120) tuft(ctx, x, GY + (i % 3 === 0 ? 0 : 3), 1, 100 + i);
      }
      for (const [wx, i] of PEBS) {
        const x = mod(wx - sc + 200, 1700) - 200;
        if (x > -30 && x < 1110) pebble(ctx, x, GY + 20 + i * 4, 9 + i * 2, 300 + i);
      }
    }

    // kervan konumları
    const off = enterOff(lt), ph = TAU * dist(lt) / STRIDE;
    const CS = 0.52;
    const dip = lowP * 6 + Math.abs(Math.sin(ph)) * 1.5;
    const bell = midP;
    const blink = (lt % 2.4) > 2.26;
    const camX = [180, 415, 650].map(v => v + off);
    const perX = 930 + off;

    // toz bulutları (bas vuruşları)
    for (const ev of A.between('low', T - 0.75, T + 0.001)) {
      if (ev.s < 0.55 || ev.t < 28.9) continue;
      const age = (T - ev.t) / 0.75, ltE = ev.t - info.t0;
      const sce = SCROLL * ltE, scNow = sc;
      for (let ci = 0; ci < 3; ci++) {
        const wxp = camX[ci] - enterOff(lt) + enterOff(ltE) - 70 * CS + sce - scNow;
        const px = wxp, py = GY + 4;
        for (let k = 0; k < 3; k++) {
          const rr = (5 + 7 * easeOut(age)) * (0.8 + k * 0.3);
          I(ctx, blobPts(px - k * 15 - age * 8, py - 6 - age * 22 - k * 3, rr, rr * 0.8, 500 + ci * 7 + k, 7, 0.1), { closed: true, w: 2.4, col: PAL.ink2, alpha: (1 - age) * 0.8, seed: 520 + k + ci * 3, wob: 0.5 });
        }
      }
    }

    const cp3 = seg(lt, 0.0, 0.5);
    // 3. deve (en geride): çuval ve cezve
    camel(ctx, camX[0], GY + 4, CS, { ph: ph + 1.2, dip: dip, bell: bell, blink, blanket: PAL.orange, seed: 1000 });
    sackAt(ctx, camX[0] - 40 * CS * 0.5 - 18, GY - 205 * CS + 6 + dip * 0.5, 0.36, -0.08 + lowP * 0.02, { seed: 1100, col: PAL.sand });
    // cezve asılı (arka)
    P.cezve(ctx, camX[0] - 92 * CS, GY - 100 * CS + dip * 0.5, { s: 0.16, p: 1, rot: Math.sin(ph) * 0.12 });
    // 2. deve: çuvallar, birinden Fincan bakar
    camel(ctx, camX[1], GY + 4, CS, { ph: ph + 0.6, dip: dip, bell: bell * 0.8, blink: (lt % 2.4) > 2.1 && (lt % 2.4) < 2.22, blanket: PAL.teal, seed: 2000 });
    sackAt(ctx, camX[1] - 100 * CS - 4, GY - 190 * CS + 4 + dip * 0.5, 0.46, -0.06, { seed: 1200, col: PAL.sand, peek: true, lt, mid: midE, up: lowP });
    sackAt(ctx, camX[1] + 62 * CS, GY - 196 * CS + 2 + dip * 0.5, 0.4, 0.06, { seed: 1300, col: '#d9b177' });
    // 1. deve: örtülü, çan
    camel(ctx, camX[2], GY + 4, CS, { ph: ph, dip: dip, bell: bell, blink: blink, blanket: PAL.red, seed: 3000 });
    // ipler
    for (let i = 0; i < 2; i++) {
      const xa = camX[i] + 246 * CS, ya = GY - 300 * CS + dip * 0.4;
      const xb = camX[i + 1] - 118 * CS, yb = GY - 150 * CS + dip * 0.4;
      I(ctx, [[xa, ya], [(xa + xb) / 2, Math.max(ya, yb) + 22], [xb, yb]], { w: 2.6, col: PAL.brown, seed: 60 + i, wob: 0.6 });
    }
    // rehber
    P.person(ctx, perX, GY + 2, { s: 0.5, robe: PAL.teal, hat: 'fes', hatCol: PAL.red, arms: 'up', walk: ph * 1.0, bob: Math.abs(Math.sin(ph)) * 0.4 + lowP * 0.4, seed: 51, p: 1, blink: blink ? 1 : 0 });
    { // ip: rehberin elinden ilk deveye
      const xa = camX[2] + 246 * CS, ya = GY - 300 * CS + dip * 0.4;
      const xb = perX + 30, yb = GY - 100 - 12 - 4;
      I(ctx, [[xa, ya], [(xa + xb) / 2, Math.max(ya, yb) + 26], [xb, yb]], { w: 2.6, col: PAL.brown, seed: 62, wob: 0.6 });
    }

    // kuşlar: 31.88 vurgusunda çimenden fırlar
    const bu = (T - 31.88) / 5.5;
    if (bu > 0 && bu < 1.2) {
      for (let i = 0; i < 3; i++) {
        const d = i * 0.035;
        const u = Math.max(0, bu - d);
        const bx = 120 + 1100 * u + i * -34, by = GY - 60 - 390 * easeOut(clamp(u * 3)) + Math.sin(u * 14 + i) * 12 + i * 22;
        bird(ctx, bx, by, 0.95 - i * 0.12, T * 9 + i * 1.7 + hiP * 2, 600 + i * 3);
      }
    }
    // melodi pırıltıları: çuvaldaki Fincan'ın üstünde
    for (const ev of A.between('mid', T - 0.4, T + 0.001)) {
      if (ev.s < 0.75) continue;
      const u = (T - ev.t) / 0.4, kk = Math.floor(ev.t * 100);
      P.sparkle(ctx, camX[1] - 100 * CS - 4 + (rnd01(kk, 1) - 0.5) * 60, GY - 190 * CS - 150 * 0.46 - 24 - u * 34, 11 * (1 - u), { seed: kk % 500, col: rnd01(kk, 2) > 0.5 ? PAL.yellow : PAL.pink });
    }

    // ön plan otları
    if (gp > 0) for (let i = 0; i < 4; i++) {
      const x = mod(150 + i * 470 - sc * 1.25 + 300, 1900) - 300;
      if (x > -40 && x < 1120) tuft(ctx, x, GY + 58 + (i % 2) * 8, 1.1, 200 + i);
    }
    ctx.restore();
  }

  ctx.restore();

  /* alt yazı A */
  const capA = seg(lt, 1.0, 2.3) * (1 - seg(T, 33.95, 34.45));
  if (capA > 0.02) {
    ctx.save(); ctx.globalAlpha *= (1 - seg(T, 33.95, 34.45));
    P.caption(ctx, "Balkanlar'dan geçen yol", { p: seg(lt, 1.0, 2.3), y: 1040, size: 38 });
    ctx.restore();
  }

  /* ============ B) HARİTA ============ */
  if (T > 34.1) {
    drawMap(ctx, T, lt, info, { lowP, midP, hiP });
    P.caption(ctx, "İstanbul'dan Viyana'ya", { p: seg(T, 34.9, 36.1), y: 1040, size: 38 });
  }
};

function drawMap(ctx, T, lt, info, m) {
  const A = TK.audio;
  const iris = 1450 * smooth(seg(T, 34.2, 35.7));
  ctx.save();
  ctx.beginPath(); ctx.rect(26, 32, 1030, 852); ctx.clip();
  // dolgular: İstanbul'dan açılan daire
  if (iris > 4) {
    ctx.save();
    ctx.beginPath(); ctx.arc(IST[0], IST[1], iris, 0, TAU); ctx.clip();
    MAPFILLS.forEach(f => f(ctx));
    ctx.restore();
  }
  // kıyı çizgileri
  const cp = seg(T, 34.3, 35.6);
  I(ctx, COAST_S, { w: 3.6, p: cp, seed: 61, wob: 1.6 });
  I(ctx, COAST_B, { w: 3.6, p: cp, seed: 62, wob: 1.6 });
  I(ctx, IT_LINE, { w: 3.6, p: seg(T, 34.4, 35.6), seed: 63, wob: 1.6 });
  I(ctx, LAND_A.slice(0, 1).concat([[960, 616], [1040, 592], [1120, 563]]), { w: 3.6, p: seg(T, 34.3, 35.4), seed: 64, wob: 1.6 });
  I(ctx, [[1120, 765], [1020, 782], [930, 752], [885, 712], [845, 680], [875, 668], [902, 650]], { w: 3.6, p: seg(T, 34.4, 35.5), seed: 65, wob: 1.6 });

  // süsler: dağlar, Tuna, dalgalar, tekne
  const dp = seg(T, 35.0, 36.2);
  if (dp > 0) {
    I(ctx, DANUBE, { w: 3, col: PAL.blue, p: dp, seed: 71, wob: 1.2 });
    const mp = seg(T, 35.1, 36.0);
    triMount(ctx, 110, 150, 0.85 * mp, 720, PAL.lilac);
    triMount(ctx, 172, 112, 0.7 * mp, 724, PAL.lilac);
    triMount(ctx, 590, 620, 0.9 * mp, 728, PAL.brown);
    triMount(ctx, 530, 575, 0.6 * mp, 732, PAL.lilac);
    triMount(ctx, 790, 300, 0.85 * mp, 736, PAL.lilac);
    triMount(ctx, 852, 262, 0.65 * mp, 740, PAL.brown);
  }
  const wp = seg(T, 35.4, 36.4);
  if (wp > 0) {
    wave(ctx, 985, 300, 46, 81, T); wave(ctx, 1005, 460, 44, 82, T);
    wave(ctx, 130, 800, 60, 83, T); wave(ctx, 640, 830, 62, 84, T); wave(ctx, 420, 850, 56, 85, T); wave(ctx, 1010, 520, 40, 86, T);
    boat(ctx, 800, 818, T);
    TK.text(ctx, 'Kara', 1004, 405, 30, { align: 'center', p: seg(T, 35.6, 36.2), w: 2.2, col: PAL.blue, seed: 91 });
    TK.text(ctx, 'deniz', 1004, 442, 30, { align: 'center', p: seg(T, 36.0, 36.6), w: 2.2, col: PAL.blue, seed: 93 });
    TK.text(ctx, 'Ege', 690, 800, 28, { align: 'center', p: seg(T, 36.2, 36.8), w: 2.1, col: PAL.blue, seed: 94 });
    TK.text(ctx, 'Tuna', 706, 376, 26, { align: 'center', p: seg(T, 36.0, 36.6), w: 2, col: PAL.blue, seed: 95 });
    TK.text(ctx, 'Akdeniz', 300, 800, 30, { align: 'center', p: seg(T, 35.8, 36.6), w: 2.2, col: PAL.blue, seed: 92 });
  }

  // ağaçlar, evler, pusula
  const op = seg(T, 35.4, 36.4);
  if (op > 0) {
    const g = easeOutBack(op);
    for (const [x, y, sd] of [[70, 230, 1], [220, 250, 2], [590, 240, 3], [650, 300, 4], [770, 440, 5], [700, 520, 6], [860, 540, 7], [690, 640, 8]]) tree(ctx, x, y, g, 1500 + sd * 7);
    house(ctx, 850, 465, g, 1600, PAL.red);
    house(ctx, 895, 480, g * 0.85, 1610, PAL.orange);
    compass(ctx, 968, 815, seg(T, 36.0, 37.0));
  }
  // rota
  const rp = routeP(T);
  let tip = null;
  if (rp > 0) tip = P.dotted(ctx, ROUTE, rp, { col: PAL.red, w: 4.4, dash: 13, gap: 12, seed: 7 });
  // duraklar
  STOPS.forEach((st, i) => {
    const w = ROUTE[st.wp];
    label(ctx, st, T);
        pin(ctx, w[0], w[1], T, st.T, 1300 + i * 10);
    if (i === STOPS.length - 1 && T >= st.T) { /* Viyana etiketi */ }
    // duraktaki küçük pırıltı (mid olayı)
    if (T > st.T && T < st.T + 0.5) {
      const u = (T - st.T) / 0.5;
      P.sparkle(ctx, w[0] + 24, w[1] - 62 - u * 12, 11 * (1 - u), { seed: 1400 + i, col: PAL.yellow });
      P.sparkle(ctx, w[0] - 22, w[1] - 50 - u * 8, 8 * (1 - u), { seed: 1410 + i, col: PAL.pink });
    }
  });
  // rota ucunda minik Fincan
  const pinned = STOPS.some(st => T > st.T - 0.12 && T < st.T + 0.32);
  if (tip && T < 39.2 && !pinned && !(T > 38.42)) {
    const moving = rp < 0.999;
    const hop = moving ? Math.abs(Math.sin(T * 9)) * 7 : 0;
    const k = Math.min(m.lowP, 1.2);
    const sq = k * 0.16 - 0.02;
    const appear = easeOutBack(seg(T, STOPS[0].T, STOPS[0].T + 0.3));
    P.fincan(ctx, tip[0], tip[1] - 30 - hop, { s: 0.4 * appear, squash: sq, mood: moving ? 'happy' : 'wow', look: [Math.cos(tip[2]), Math.sin(tip[2])], p: 1, seed: 21, blink: 0, steam: 0 });
  }
  // Viyana: kale büyür (son 0.7 sn), 39.03 vuruşuyla sıçrar
  const cs = easeOutBack(seg(T, 38.42, 39.02));
  if (cs > 0) {
    const kick = clamp(A.pulse('low', T, 0.08), 0, 1.2);
    const w = ROUTE[12];
    castle(ctx, w[0] - 66, w[1] + 8, 0.62 * cs * (1 + kick * 0.06), T);
  }
  ctx.restore();
  // el çizimi harita çerçevesi
  const bp = seg(T, 35.0, 36.2);
  if (bp > 0) I(ctx, [[26, 34], [300, 30], [620, 34], [1054, 31], [1056, 300], [1052, 620], [1055, 885], [700, 888], [360, 884], [27, 887], [24, 600], [28, 300]], { w: 3.6, closed: true, smooth: false, p: bp, seed: 66, wob: 1.6 });
}
function tree(ctx, x, y, g, sd) {
  if (g <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(g, g);
  I(ctx, [[0, 0], [1, -12], [0, -26]], { w: 3, col: PAL.brown, seed: sd, wob: 0.5 });
  const cn = blobPts(0, -42, 17, 18, sd, 9, 0.1);
  cr(ctx, cn, PAL.green, { seed: sd + 1, gap: 4, lw: 8, jit: 1.2, a: 0.9 });
  I(ctx, cn, { closed: true, w: 2.8, seed: sd + 2, wob: 0.8 });
  ctx.restore();
}
function house(ctx, x, y, g, sd, col) {
  if (g <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(g, g);
  const b = [[-16, 0], [-16, -20], [16, -20], [16, 0]];
  polyFill(ctx, b, PAL.white, { seed: sd, gap: 4, lw: 7, a: 0.8 });
  I(ctx, b, { closed: true, smooth: false, w: 2.8, seed: sd + 1 });
  const r = [[-21, -20], [0, -38], [21, -20]];
  polyFill(ctx, r, col, { seed: sd + 2, gap: 3.4, lw: 6, a: 0.95 });
  I(ctx, r.concat([r[0]]), { smooth: false, w: 2.8, seed: sd + 3 });
  I(ctx, [[-4, 0], [-4, -10], [5, -10], [5, 0]], { smooth: false, w: 2.4, seed: sd + 4 });
  ctx.restore();
}
function compass(ctx, x, y, p) {
  if (p <= 0) return;
  I(ctx, ellipsePts(x, y, 34, 34, 16, 0, 0), { closed: true, w: 3, p, seed: 1700, wob: 1 });
  I(ctx, [[x, y - 30], [x, y + 30]], { w: 2.8, p, seed: 1701, wob: 0.6 });
  I(ctx, [[x - 30, y], [x + 30, y]], { w: 2.8, p, seed: 1702, wob: 0.6 });
  const nd = [[x - 8, y], [x, y - 30], [x + 8, y]];
  if (p > 0.6) polyFill(ctx, nd, PAL.red, { seed: 1703, gap: 3, lw: 5, a: 0.95 });
  TK.text(ctx, 'K', x, y - 40, 24, { align: 'center', p: seg(p, 0.5, 1), w: 2, seed: 1704 });
}
})();
