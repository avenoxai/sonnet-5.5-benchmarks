/* render.js  -  "Saha defteri" dünya çizicisi.
 *
 * Kağıt üzerine mürekkep + sulu boya: krem kağıt, el çizimi gibi titreşen zemin çizgisi, tarama (hatch) gölgeleri,
 * kontur çizgileri, cetvel işaretleri, lineage rengiyle yıkanmış yaratıklar.
 *
 * Her şey motor sözleşmesine (CONTRACT.md) göre genel yazıldı: yaratık boyutu, bacak sayısı, düğüm sayısı varsayılmaz;
 * ölçek yalnızca links[].w, nodes[].r, bodyLength, legLength alanlarından gelir.
 *
 * Dışa açılan: window.YY = { fmt, World, drawCreature, drawTerrain, drawBackdrop, paintPaper, paintGrain, ... }
 */
(function (global) {
  'use strict';
  const YY = (global.YY = global.YY || {});
  const PI = Math.PI, TAU = PI * 2, HALF_PI = PI / 2;

  const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua","Hoefler Text",Georgia,serif';
  const MONO = 'ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,"Liberation Mono",monospace';
  const INK = 'rgb(44,35,23)';
  const INK_RGB = '44,35,23';
  const MADDER = 'rgb(163,40,58)';
  const PAPER_HI = 'rgba(249,243,227,.92)';
  YY.SERIF = SERIF; YY.MONO = MONO;

  /* ------------------------------------------------------------------ küçük yardımcılar */

  /** Türkçe ondalık: 8.4 -> "8,4" */
  YY.fmt = function (n, d) {
    if (d === undefined) d = 1;
    if (!isFinite(n)) return '–';
    if (Math.abs(n) < 0.5 * Math.pow(10, -d)) n = 0;
    return n.toFixed(d).replace('.', ',');
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  /** Deterministik sahte-rastgele (0..1) ve 1B değer gürültüsü: dünya koordinatına bağlı, titremez. */
  function hash(i) { const h = Math.sin(i * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); }
  function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; }
  YY.hash = hash; YY.noise1 = noise1;
  function mulberry(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const fin = (v) => v === v && v > -1e5 && v < 1e5;

  /* ------------------------------------------------------------------ kağıt dokusu (bir kez çizilir) */

  function makeTile(size, fn) { const c = document.createElement('canvas'); c.width = c.height = size; fn(c.getContext('2d'), size); return c; }

  /** Krem kağıt: vinyet, hafif lekeler ("foxing"), lif ve tanecik. Statik; yalnız yeniden boyutlanınca çizilir. */
  YY.paintPaper = function (canvas, W, H, dpr) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#efe4cb'; ctx.fillRect(0, 0, W, H);
    const R = Math.max(W, H) * 0.78;
    const g = ctx.createRadialGradient(W * 0.5, H * 0.42, R * 0.15, W * 0.5, H * 0.5, R);
    g.addColorStop(0, 'rgba(255,251,238,.60)'); g.addColorStop(0.55, 'rgba(255,248,230,.0)'); g.addColorStop(1, 'rgba(150,108,58,.30)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rnd = mulberry(20240611);
    for (let i = 0; i < 11; i++) { // soluk lekeler
      const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 190;
      const b = ctx.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(176,126,62,${0.035 + rnd() * 0.04})`); b.addColorStop(1, 'rgba(176,126,62,0)');
      ctx.fillStyle = b; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tile = makeTile(256, (c, n) => {
      const img = c.createImageData(n, n), d = img.data, rr = mulberry(77);
      for (let i = 0; i < n * n; i++) {
        const v = rr(), o = i * 4;
        if (v < 0.5) { d[o] = 96; d[o + 1] = 68; d[o + 2] = 30; d[o + 3] = (rr() * 20) | 0; }
        else { d[o] = 255; d[o + 1] = 251; d[o + 2] = 238; d[o + 3] = (rr() * 26) | 0; }
      }
      c.putImageData(img, 0, 0);
      c.lineCap = 'round';
      for (let i = 0; i < 70; i++) { // kağıt lifleri
        const x = rr() * n, y = rr() * n, a = rr() * TAU, l = 5 + rr() * 16;
        c.strokeStyle = rr() < 0.6 ? 'rgba(110,80,40,.075)' : 'rgba(255,252,240,.20)'; c.lineWidth = 0.5 + rr() * 0.5;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.7) * l * 0.5, y + Math.sin(a + 0.7) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
      }
    });
    ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fillRect(0, 0, W, H);
  };

  /** Dünya katmanının üstüne binen çok ince tanecik: sulu boya "kağıda oturmuş" görünür. */
  YY.paintGrain = function (canvas, W, H, dpr) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const tile = makeTile(200, (c, n) => {
      const img = c.createImageData(n, n), d = img.data, rr = mulberry(1234);
      for (let i = 0; i < n * n; i++) {
        const o = i * 4, v = rr();
        if (v < 0.42) { d[o] = 84; d[o + 1] = 60; d[o + 2] = 28; d[o + 3] = (rr() * 15) | 0; }
        else if (v < 0.5) { d[o] = 255; d[o + 1] = 250; d[o + 2] = 235; d[o + 3] = (rr() * 30) | 0; }
      }
      c.putImageData(img, 0, 0);
    });
    ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fillRect(0, 0, W, H);
  };

  /* ------------------------------------------------------------------ renk paleti (sulu boya yıkamaları) */

  // Çizim sırası (arkadan öne): ayak, kaval, uyluk, diğer, gövde, baş
  const KIND_IDX = { foot: 0, shin: 1, thigh: 2, other: 3, torso: 4, head: 5 };
  const LIGHT = [40, 47, 55, 52, 63, 70];
  const SAT = [46, 50, 54, 44, 56, 62];
  const washCache = [[], [], [], [], [], []], jointCache = [];
  const GHOST_WASH = LIGHT.map((l) => `hsl(206,30%,${l + 8}%)`);
  const DEAD_WASH = LIGHT.map((l) => `hsl(36,8%,${l + 10}%)`);
  const LV = [-5, 0, 5]; // yaratık başına hafif açıklık farkı: aynı soydan gelenler birebir aynı görünmesin
  function wash(k, hue, mode, lv) {
    if (mode === 2) return GHOST_WASH[k];
    if (mode === 1) return DEAD_WASH[k];
    const c = washCache[k], key = hue + 360 * lv; let s = c[key];
    if (s === undefined) s = c[key] = `hsl(${hue},${SAT[k]}%,${LIGHT[k] + LV[lv]}%)`;
    return s;
  }
  function jointWash(hue, mode, lv) {
    if (mode === 2) return 'hsl(206,28%,42%)';
    if (mode === 1) return 'hsl(36,8%,50%)';
    const key = hue + 360 * lv; let s = jointCache[key]; if (s === undefined) s = jointCache[key] = `hsl(${hue},50%,${34 + LV[lv]}%)`;
    return s;
  }
  YY.washColor = (hue) => wash(4, ((hue % 360) + 360) % 360 | 0, 0, 1);
  YY.dotColor = (hue) => `hsl(${((hue % 360) + 360) % 360 | 0},58%,55%)`;

  /* ------------------------------------------------------------------ yaratık çizimi */

  const infoMap = new WeakMap();
  /** Topoloji sabittir; kategoriye göre bağ listelerini ve önceki temas durumlarını önbelleğe alır. */
  function getInfo(v) {
    let inf = infoMap.get(v);
    if (inf && inf.links === v.links && inf.n === v.links.length) return inf;
    const groups = [[], [], [], [], [], []]; let head = -1;
    for (let i = 0; i < v.links.length; i++) {
      let k = KIND_IDX[v.links[i].kind]; if (k === undefined) k = 3;
      groups[k].push(i); if (k === 5 && head < 0) head = i;
    }
    inf = { links: v.links, n: v.links.length, groups, head, prev: new Uint8Array(v.feet ? v.feet.length : 0), seen: false };
    infoMap.set(v, inf); return inf;
  }
  YY.getInfo = getInfo;

  let SC = new Float32Array(512); // bağ başına 5 kayan sayı: ax, ay, bx, by, r
  const LW_KIND = [0.9, 0.95, 1.0, 0.95, 1.22, 1.1];

  /**
   * Bir yaratığı çizer. o = { alpha, mode: 0 canlı | 1 ölü | 2 hayalet, lead, detail: 0 tam | 1 sürü | 2 küçük }
   * Kapsüller kategoriye göre tek yol (path) olarak biriktirilir: önce yıkama dolgusu, sonra ince mürekkep çizgisi.
   */
  function drawCreature(ctx, cam, v, o) {
    const nodes = v.nodes, links = v.links;
    if (!nodes || !links || links.length === 0) return;
    const inf = getInfo(v), s = cam.s, fx = cam.fx, cx = cam.x, gy = cam.gy, cy = cam.y;
    const mode = o.mode, alpha = o.alpha, lead = o.lead, detail = o.detail;
    let hue = v.hue; hue = hue === hue ? (((hue % 360) + 360) % 360) | 0 : 30;
    const idn = typeof v.id === 'number' ? v.id : 0;
    // soy rengi korunur ama yaratık başına ±13° ton ve 3 açıklık kademesi: kalabalık tek bir leke olmasın
    const lv = (idn % 3 + 3) % 3;
    if (mode === 0 && !o.plain) hue = (hue + 360 + (((hash(idn * 1.73 + 3.1) - 0.5) * 26) | 0)) % 360;
    const lwVar = 0.88 + 0.26 * hash(idn + 1); // çizgi kalınlığı her yaratıkta hafif farklı: "el yapımı"
    const strokeA = lead ? 1 : Math.min(1, alpha * 0.72);
    if (SC.length < links.length * 5) SC = new Float32Array(links.length * 5 + 64);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (mode === 2) ctx.setLineDash([4, 3]);

    for (let gi = 0; gi < 6; gi++) {
      if (gi === 4 && detail < 2) drawJoints(ctx, cam, nodes, hue, mode, alpha, strokeA, lv);
      const g = inf.groups[gi]; if (g.length === 0) continue;
      ctx.beginPath();
      let any = false, maxR = 0;
      for (let k = 0; k < g.length; k++) {
        const l = links[g[k]], A = nodes[l.a], B = nodes[l.b]; if (!A || !B) { SC[k * 5 + 4] = -1; continue; }
        const ax = fx + (A.x - cx) * s, ay = gy - (A.y - cy) * s, bx = fx + (B.x - cx) * s, by = gy - (B.y - cy) * s;
        if (!(fin(ax) && fin(ay) && fin(bx) && fin(by))) { SC[k * 5 + 4] = -1; continue; }
        const r = Math.max(0.9, (l.w > 0 ? l.w : 0.05) * s * 0.5);
        if (r > maxR) maxR = r;
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.moveTo(ax + Math.cos(ang + HALF_PI) * r, ay + Math.sin(ang + HALF_PI) * r);
        ctx.arc(ax, ay, r, ang + HALF_PI, ang + PI * 1.5);
        ctx.arc(bx, by, r, ang - HALF_PI, ang + HALF_PI);
        ctx.closePath();
        const q = k * 5; SC[q] = ax; SC[q + 1] = ay; SC[q + 2] = bx; SC[q + 3] = by; SC[q + 4] = r; any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = alpha; ctx.fillStyle = wash(gi, hue, mode, lv); ctx.fill();
      if (detail === 0 && (gi === 4 || gi === 5 || lead)) drawShading(ctx, g.length, gi, mode, hue, alpha);
      ctx.globalAlpha = strokeA; ctx.strokeStyle = mode === 2 ? 'rgb(31,78,112)' : INK;
      let lw = (0.65 + Math.min(maxR, 40) * 0.085) * LW_KIND[gi] * lwVar * (lead ? 1.3 : 0.72);
      ctx.lineWidth = lw < 0.6 ? 0.6 : lw > 3.4 ? 3.4 : lw;
      ctx.stroke();
    }
    if (mode === 2) ctx.setLineDash([]);
    if (detail < 2) drawEye(ctx, cam, v, inf, alive(v), strokeA);
    ctx.globalAlpha = 1;
  }
  const alive = (v) => v.alive !== false;

  /** Işık (üst) ve gölge (alt) yıkaması: gövde/baş üzerinde hafif hacim; sulu boya "birikmesi". */
  function drawShading(ctx, n, gi, mode, hue, alpha) {
    if (mode === 1) return;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const q = k * 5, r = SC[q + 4]; if (r < 0) continue;
      ctx.moveTo(SC[q], SC[q + 1] + r * 0.34); ctx.lineTo(SC[q + 2], SC[q + 3] + r * 0.34);
    }
    ctx.globalAlpha = alpha * 0.22; ctx.strokeStyle = mode === 2 ? 'hsl(206,40%,30%)' : `hsl(${hue},55%,30%)`;
    ctx.lineWidth = Math.max(1, SC[4] * 0.55); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const q = k * 5, r = SC[q + 4]; if (r < 0) continue;
      ctx.moveTo(SC[q], SC[q + 1] - r * 0.36); ctx.lineTo(SC[q + 2], SC[q + 3] - r * 0.36);
    }
    ctx.globalAlpha = alpha * 0.4; ctx.strokeStyle = '#fff8e6'; ctx.lineWidth = Math.max(1, SC[4] * 0.36); ctx.stroke();
  }

  /** Eklem daireleri: yalnız yeterince büyük görünürse (küçük yaratıklarda atlanır). */
  function drawJoints(ctx, cam, nodes, hue, mode, alpha, strokeA, lv) {
    const s = cam.s, fx = cam.fx, cx = cam.x, gy = cam.gy, cy = cam.y;
    ctx.beginPath(); let any = false;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], r = n.r * s * 0.82; if (!(r >= 1.7)) continue;
      const px = fx + (n.x - cx) * s, py = gy - (n.y - cy) * s; if (!fin(px) || !fin(py)) continue;
      ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU); any = true;
    }
    if (!any) return;
    ctx.globalAlpha = alpha * 0.85; ctx.fillStyle = jointWash(hue, mode, lv); ctx.fill();
    ctx.globalAlpha = strokeA * 0.75; ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.stroke();
  }

  /** Göz: baş bağının ön ucunda (yoksa ön gövde bağında); ölüyse çarpı. */
  function drawEye(ctx, cam, v, inf, isAlive, strokeA) {
    const nodes = v.nodes, links = v.links; let li = inf.head;
    if (li < 0) { // baş yok: gövde bağlarından en öndekini seç
      const g = inf.groups[4]; let best = -1e9;
      for (let k = 0; k < g.length; k++) { const l = links[g[k]], A = nodes[l.a], B = nodes[l.b]; if (!A || !B) continue; const f = Math.max(A.x, B.x); if (f > best) { best = f; li = g[k]; } }
      if (li < 0) return;
    }
    const l = links[li], A = nodes[l.a], B = nodes[l.b]; if (!A || !B) return;
    const F = A.x >= B.x ? A : B, O = F === A ? B : A, s = cam.s;
    const hr = Math.max(0.9, (l.w || 0.05) * s * 0.5), er = hr * 0.34;
    if (hr < 4.2) return;
    const dx = F.x - O.x, dy = F.y - O.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = cam.fx + (F.x - cam.x) * s - (dx / dl) * hr * 0.42, py = cam.gy - (F.y - cam.y) * s + (dy / dl) * hr * 0.42 - hr * 0.22;
    if (!fin(px) || !fin(py)) return;
    ctx.globalAlpha = strokeA; ctx.lineWidth = 0.9;
    if (isAlive) {
      ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(px, py, er, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(px + er * 0.28, py + er * 0.05, er * 0.5, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = INK; ctx.beginPath();
      ctx.moveTo(px - er * 0.7, py - er * 0.7); ctx.lineTo(px + er * 0.7, py + er * 0.7);
      ctx.moveTo(px + er * 0.7, py - er * 0.7); ctx.lineTo(px - er * 0.7, py + er * 0.7); ctx.stroke();
    }
  }
  YY.drawCreature = drawCreature;

  /* ------------------------------------------------------------------ yazı etiketleri */

  function tag(ctx, text, x, y, font, color, align, bg) {
    ctx.font = font; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    if (bg) {
      const w = ctx.measureText(text).width, px = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      ctx.fillStyle = bg; ctx.fillRect(px - 3, y - 7, w + 6, 14);
    }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  YY.tag = tag;

  /* ------------------------------------------------------------------ arka plan: tepeler, ızgara, zemin */

  const HILL_LAYERS = [
    { f: 0.10, lift: 0.19, amp: 0.085, fill: 'rgba(108,138,146,.15)', line: 'rgba(70,96,104,.30)', l1: 260, l2: 97, l3: 41, ph: 1.3 },
    { f: 0.24, lift: 0.075, amp: 0.06, fill: 'rgba(134,146,104,.19)', line: 'rgba(84,96,58,.34)', l1: 190, l2: 71, l3: 29, ph: 4.1 },
  ];
  function hillY(L, u, base, amp) {
    return base - amp * (0.5 + 0.32 * Math.sin(u / L.l1 + L.ph) + 0.22 * Math.sin(u / L.l2 + L.ph * 2) + 0.18 * (noise1(u / L.l3) - 0.5));
  }
  /** Uzak tepeler: sönük sulu boya bantları, parallax. Ölçekten bağımsız (yakınlaştırma yüzmesin diye). Yakın katmanda minik ağaçlar. */
  function drawHills(ctx, cam, lite) {
    const W = cam.W, H = cam.H;
    for (let li = 0; li < HILL_LAYERS.length; li++) {
      if (lite && li === 0) continue;
      const L = HILL_LAYERS[li], off = cam.x * L.f * 60, base = cam.gy - L.lift * H, amp = L.amp * H;
      ctx.beginPath(); ctx.moveTo(-6, H + 4);
      for (let x = -6; x <= W + 12; x += 8) ctx.lineTo(x, hillY(L, x + off, base, amp));
      ctx.lineTo(W + 12, H + 4); ctx.closePath();
      ctx.fillStyle = L.fill; ctx.fill();
      ctx.strokeStyle = L.line; ctx.lineWidth = 0.9; ctx.stroke();
      if (li === 1 && !lite) { // ağaç damgaları: mürekkep gövde + sulu boya taç
        const cell = 38; ctx.beginPath(); const trunks = new Path2D();
        for (let k = Math.floor((off - 20) / cell); k * cell <= off + W + 20; k++) {
          const hh = hash(k * 7.3 + 2); if (hh < 0.5) continue;
          const u = (k + hash(k * 3.9)) * cell, x = u - off, y = hillY(L, u, base, amp) + 1, sz = 9 + hash(k * 1.3) * 12;
          trunks.moveTo(x, y); trunks.lineTo(x, y - sz * 0.55);
          ctx.moveTo(x + sz * 0.32, y - sz * 0.95); ctx.ellipse(x, y - sz * 0.95, sz * 0.32, sz * 0.46, 0, 0, TAU);
        }
        ctx.fillStyle = 'rgba(78,104,62,.30)'; ctx.fill(); ctx.strokeStyle = 'rgba(52,70,38,.42)'; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.strokeStyle = 'rgba(52,70,38,.5)'; ctx.stroke(trunks);
      }
    }
  }

  /** Sönük bulut yıkamaları: çok yavaş kayar. */
  function drawClouds(ctx, cam, now) {
    const W = cam.W, H = cam.H; ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const sp = 0.004 + 0.003 * hash(i * 3.1), wdt = 150 + 190 * hash(i + 4), x0 = (((i * 0.27 + now * sp - cam.x * 0.0025) % 1.5) + 1.5) % 1.5 * (W + 500) - 250;
      const y = H * (0.07 + 0.2 * hash(i * 5.7)), h = wdt * 0.11;
      for (let j = 0; j < 4; j++) { const cx = x0 + wdt * (0.15 + 0.23 * j), rx = wdt * (0.2 + 0.05 * hash(i * 9 + j)), ry = h * (0.8 + 0.6 * Math.sin(j * 1.9 + i)); ctx.moveTo(cx + rx, y); ctx.ellipse(cx, y - (j === 1 || j === 2 ? h * 0.35 : 0), rx, Math.abs(ry) + 3, 0, 0, TAU); }
    }
    ctx.fillStyle = 'rgba(112,140,158,.055)'; ctx.fill();
  }

  /** Soluk güneş: yıkama halkaları. */
  function drawSun(ctx, cam) {
    const W = cam.W, H = cam.H, x = W * 0.63 - (cam.x * 1.5 % 40), y = H * 0.17, r = Math.min(W, H) * 0.062;
    ctx.fillStyle = 'rgba(214,160,72,.15)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(222,120,70,.09)'; ctx.beginPath(); ctx.arc(x + r * 0.08, y + r * 0.06, r * 0.78, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(150,100,40,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 1.12, 0, TAU); ctx.stroke();
  }

  const NICE = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  function niceStep(minPx, s) { for (let i = 0; i < NICE.length; i++) if (NICE[i] * s >= minPx) return NICE[i]; return NICE[NICE.length - 1]; }

  /** Cetvel çizgili defter ızgarası (çok silik). */
  function drawGrid(ctx, cam) {
    const W = cam.W, s = cam.s, gy = cam.gy, cx = cam.x, cy = cam.y, fx = cam.fx;
    const gs = niceStep(46, s);
    ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${INK_RGB},.07)`; ctx.beginPath();
    // yatay çizgiler: yükseklik metreleri
    const yTop = cy + gy / s, yBot = cy - (cam.H - gy) / s;
    for (let k = Math.ceil(yBot / gs); k * gs <= yTop; k++) { const y = Math.round(gy - (k * gs - cy) * s) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    // dikey çizgiler: mesafe
    const xl = cx - fx / s, xr = cx + (W - fx) / s;
    for (let k = Math.ceil(xl / gs); k * gs <= xr; k++) { const x = Math.round(fx + (k * gs - cx) * s) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, cam.H); }
    ctx.stroke();
  }

  let SY = new Float32Array(1200);
  /**
   * Zemin: dolgu, tarama, kontur (katman) çizgileri, el çizimi yüzey çizgisi, çimen tutamları, mesafe işaretleri.
   * o = { lite, marks }
   */
  function drawTerrain(ctx, cam, terrain, o) {
    const W = cam.W, H = cam.H, s = cam.s, cx = cam.x, cy = cam.y, fx = cam.fx, gy = cam.gy, lite = !!o.lite;
    const step = lite ? 4 : 3, n = Math.ceil(W / step) + 4, inv = 1 / s;
    if (SY.length < n) SY = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const px = i * step - step, wx = cx + (px - fx) * inv;
      let h = terrain.heightAt(wx); if (!(h === h)) h = 0;
      const jit = lite ? 0 : (noise1(wx * 5.5) - 0.5) * 1.5 + (noise1(wx * 23 + 7) - 0.5) * 0.7; // el titremesi
      SY[i] = gy - (h - cy) * s + jit;
    }
    const yAt = (px) => { const f = (px + step) / step, i = Math.max(0, Math.min(n - 2, Math.floor(f))); return SY[i] + (SY[i + 1] - SY[i]) * (f - i); };
    // dolgu (opak sepya yıkama)
    ctx.beginPath(); ctx.moveTo(-step, SY[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(i * step - step, SY[i]);
    const last = (n - 1) * step - step;
    ctx.lineTo(last, H + 20); ctx.lineTo(-step, H + 20); ctx.closePath();
    ctx.fillStyle = '#dcc89d'; ctx.fill();
    // tarama: yüzeyden sola-aşağı eğik kısa çizgiler (dünya koordinatına bağlı)
    const spacing = Math.max(lite ? 0.4 : 0.26, 9 / s), xl = cx - fx * inv, xr = cx + (W - fx) * inv;
    ctx.beginPath();
    for (let k = Math.floor(xl / spacing); k * spacing <= xr + 1; k++) {
      const wx = (k + hash(k * 1.7) * 0.6) * spacing, px = fx + (wx - cx) * s, y0 = yAt(px) + 3;
      const len = (lite ? 5 : 8) + hash(k) * (lite ? 16 : 34);
      ctx.moveTo(px, y0); ctx.lineTo(px - len * 0.55, y0 + len * 0.82);
      if (!lite && hash(k * 3.3) > 0.62) { ctx.moveTo(px + 3, y0 + 8); ctx.lineTo(px + 3 - len * 0.35, y0 + 8 + len * 0.55); }
    }
    ctx.strokeStyle = `rgba(${INK_RGB},.30)`; ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.stroke();
    // taşlar: zeminin içinde, mürekkep çizgili minik çakıllar (dünya koordinatına bağlı)
    if (!lite) {
      ctx.beginPath(); const ss = 1.35;
      for (let k = Math.floor(xl / ss); k * ss <= xr + 1; k++) {
        if (hash(k * 4.7 + 1) < 0.45) continue;
        const wx = (k + hash(k * 8.1)) * ss, px = fx + (wx - cx) * s, depth = 34 + hash(k * 2.3) * 110, py = yAt(px) + depth;
        if (py > H + 10) continue;
        const rx = 3 + hash(k * 6.1) * 6, ry = rx * (0.5 + hash(k * 1.9) * 0.3);
        ctx.moveTo(px + rx, py); ctx.ellipse(px, py, rx, ry, (hash(k) - 0.5) * 0.6, 0, TAU);
      }
      ctx.fillStyle = 'rgba(238,224,190,.55)'; ctx.fill(); ctx.strokeStyle = `rgba(${INK_RGB},.38)`; ctx.lineWidth = 0.9; ctx.stroke();
    }
    // kontur / katman çizgileri
    if (!lite) {
      ctx.setLineDash([7, 6]); ctx.lineWidth = 1;
      const D = [16, 36, 64, 104];
      for (let d = 0; d < D.length; d++) {
        ctx.beginPath(); ctx.moveTo(-step, SY[0] + D[d]);
        for (let i = 1; i < n; i += 2) ctx.lineTo(i * step - step, SY[i] + D[d] + Math.sin(i * 0.09 + d * 2) * 2);
        ctx.strokeStyle = `rgba(${INK_RGB},${0.2 - d * 0.04})`; ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // yüzey çizgisi: iki geçiş, biri kalın biri ince/kaymış
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-step, SY[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(i * step - step, SY[i]);
    ctx.strokeStyle = `rgba(${INK_RGB},.92)`; ctx.lineWidth = lite ? 1.6 : 2.3; ctx.stroke();
    if (!lite) {
      ctx.beginPath(); ctx.moveTo(-step, SY[0] + 2.2);
      for (let i = 1; i < n; i++) ctx.lineTo(i * step - step, SY[i] + 2.2 + (noise1(i * 0.21) - 0.5) * 1.2);
      ctx.strokeStyle = `rgba(${INK_RGB},.34)`; ctx.lineWidth = 0.8; ctx.stroke();
      // çimen tutamları
      ctx.beginPath(); const ts = 0.62;
      for (let k = Math.floor(xl / ts); k * ts <= xr + 1; k++) {
        if (hash(k * 3.1 + 9) < 0.42) continue;
        const wx = (k + hash(k * 5.7)) * ts, px = fx + (wx - cx) * s, y0 = yAt(px) - 0.5, sz = clamp(s * 0.05, 3.5, 9) * (0.7 + hash(k * 2.9));
        ctx.moveTo(px, y0); ctx.lineTo(px - sz * 0.5, y0 - sz);
        ctx.moveTo(px, y0); ctx.lineTo(px + 0.08 * sz, y0 - sz * 1.15);
        ctx.moveTo(px, y0); ctx.lineTo(px + sz * 0.55, y0 - sz * 0.9);
      }
      ctx.strokeStyle = `rgba(${INK_RGB},.55)`; ctx.lineWidth = 1; ctx.stroke();
    }
    // mesafe işaretleri
    if (o.marks) {
      const mi = niceStep(o.minGap || 112, s), fnt = `600 ${o.fontPx || 11}px ${MONO}`;
      const minor = mi / 5; ctx.beginPath();
      if (minor * s >= 13) for (let k = Math.ceil(xl / minor); k * minor <= xr; k++) {
        if (k % 5 === 0) continue;
        const px = fx + (k * minor - cx) * s, y0 = yAt(px);
        ctx.moveTo(px, y0 - 2); ctx.lineTo(px, y0 + 5);
      }
      ctx.strokeStyle = `rgba(${INK_RGB},.55)`; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath();
      for (let k = Math.ceil(xl / mi); k * mi <= xr; k++) { const px = fx + (k * mi - cx) * s, y0 = yAt(px); ctx.moveTo(px, y0 - 7); ctx.lineTo(px, y0 + 9); }
      ctx.strokeStyle = `rgba(${INK_RGB},.85)`; ctx.lineWidth = 1.6; ctx.stroke();
      for (let k = Math.ceil(xl / mi); k * mi <= xr; k++) {
        const px = fx + (k * mi - cx) * s, y0 = yAt(px);
        tag(ctx, YY.fmt(k * mi, mi < 1 ? 1 : 0) + ' m', px, y0 + 21, fnt, INK, 'center', 'rgba(220,200,157,.9)');
      }
    }
    // dış çizgi için yardımcı: zemin yüksekliğini piksel olarak okuyabilsin
    cam.groundPx = yAt;
  }
  YY.drawTerrain = drawTerrain;

  /** Başlangıç çizgisi + yükseklik ölçeği (0-1-2 m). */
  function drawStart(ctx, cam, terrain, o) {
    const s = cam.s, sx = cam.fx + (0 - cam.x) * s; if (sx < -80 || sx > cam.W + 80) return;
    const y0 = cam.gy - (terrain.heightAt(0) - cam.cy) * s, top = Math.min(y0 - 16, y0 - 2.7 * s);
    ctx.lineCap = 'butt';
    ctx.setLineDash([6, 4]); ctx.strokeStyle = MADDER; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx, y0 + 26); ctx.lineTo(sx, top); ctx.stroke(); ctx.setLineDash([]);
    if (s >= 20) {
      ctx.beginPath();
      for (let m = 0.25; m * s <= y0 - top; m += 0.25) { const y = y0 - m * s, big = Math.abs(m - Math.round(m)) < 1e-6; ctx.moveTo(sx, y); ctx.lineTo(sx + (big ? 10 : 5), y); }
      ctx.strokeStyle = MADDER; ctx.lineWidth = 1.1; ctx.stroke();
      for (let m = 1; m * s <= y0 - top + 1; m++) tag(ctx, m + ' m', sx + 14, y0 - m * s, `600 10px ${MONO}`, MADDER, 'left', 'rgba(239,228,203,.7)');
    }
    tag(ctx, o && o.lite ? 'başlangıç' : 'başlangıç çizgisi', sx, top - 10, `italic 12px ${SERIF}`, MADDER, 'center', 'rgba(239,228,203,.7)');
  }

  /** Rekor bayrağı: tüm zamanların en iyi mesafesine dikilir. */
  function drawRecordFlag(ctx, cam, terrain, dist) {
    const s = cam.s, sx = cam.fx + (dist - cam.x) * s; if (!(dist > 0) || sx < -120 || sx > cam.W + 120) return;
    const y0 = cam.gy - (terrain.heightAt(dist) - cam.cy) * s, hgt = clamp(1.9 * s, 60, 170);
    ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(sx, y0 + 2); ctx.lineTo(sx, y0 - hgt); ctx.stroke();
    const fw = 74, fh = 26, fy = y0 - hgt;
    ctx.beginPath(); ctx.moveTo(sx, fy); ctx.quadraticCurveTo(sx + fw * 0.5, fy + 4, sx + fw, fy + fh * 0.5); ctx.quadraticCurveTo(sx + fw * 0.5, fy + fh - 1, sx, fy + fh); ctx.closePath();
    ctx.fillStyle = 'rgba(163,40,58,.30)'; ctx.fill(); ctx.strokeStyle = MADDER; ctx.lineWidth = 1.4; ctx.stroke();
    tag(ctx, 'rekor', sx + 8, fy + 8, `italic 11.5px ${SERIF}`, MADDER, 'left');
    tag(ctx, YY.fmt(dist) + ' m', sx + 8, fy + 19, `700 11px ${MONO}`, MADDER, 'left');
  }

  /** Arka plan + zemin: ana dünya, galeri ve spot ışığı ortak kullanır. */
  YY.drawBackdrop = function (ctx, cam, terrain, o) {
    o = o || {};
    if (!o.lite) { drawSun(ctx, cam); drawClouds(ctx, cam, o.now || 0); }
    drawHills(ctx, cam, !!o.lite);
    if (o.grid) drawGrid(ctx, cam);
    drawTerrain(ctx, cam, terrain, o);
    if (o.start) drawStart(ctx, cam, terrain, o);
  };

  /* ------------------------------------------------------------------ parçacıklar: toz ve ayak izi */

  const DN = 160; const dust = { x: new Float32Array(DN), y: new Float32Array(DN), vx: new Float32Array(DN), vy: new Float32Array(DN), life: new Float32Array(DN), max: new Float32Array(DN), r: new Float32Array(DN), head: 0 };
  function emitDust(wx, wy, size, dir) {
    const i = (dust.head = (dust.head + 1) % DN);
    dust.x[i] = wx; dust.y[i] = wy + size * 0.2; dust.vx[i] = -dir * size * (0.6 + Math.random()) + (Math.random() - 0.5) * size; dust.vy[i] = size * (0.5 + Math.random() * 0.9);
    dust.max[i] = dust.life[i] = 0.5 + Math.random() * 0.35; dust.r[i] = size * (0.28 + Math.random() * 0.2);
  }
  function stepDust(dt) {
    for (let i = 0; i < DN; i++) if (dust.life[i] > 0) { dust.life[i] -= dt; dust.x[i] += dust.vx[i] * dt; dust.y[i] += dust.vy[i] * dt; dust.vy[i] *= Math.max(0, 1 - 2.6 * dt); dust.vx[i] *= Math.max(0, 1 - 2.2 * dt); }
  }
  function drawDust(ctx, cam) {
    const s = cam.s;
    for (let b = 0; b < 3; b++) { // 3 saydamlık kovası
      ctx.beginPath(); let any = false;
      for (let i = 0; i < DN; i++) {
        const l = dust.life[i]; if (!(l > 0)) continue; const t = l / dust.max[i];
        if ((t > 0.66 ? 0 : t > 0.33 ? 1 : 2) !== b) continue;
        const r = dust.r[i] * s * (1 + (1 - t) * 1.7), px = cam.fx + (dust.x[i] - cam.x) * s, py = cam.gy - (dust.y[i] - cam.y) * s;
        ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, TAU); any = true;
      }
      if (!any) continue;
      ctx.fillStyle = `rgba(120,92,56,${0.30 - b * 0.09})`; ctx.fill();
      ctx.strokeStyle = `rgba(${INK_RGB},${0.22 - b * 0.06})`; ctx.lineWidth = 0.8; ctx.stroke();
    }
  }
  const FN = 420; const prints = { x: new Float32Array(FN), y: new Float32Array(FN), t: new Float64Array(FN), r: new Float32Array(FN), head: 0 };
  function addPrint(wx, wy, size, now) { const i = (prints.head = (prints.head + 1) % FN); prints.x[i] = wx; prints.y[i] = wy; prints.r[i] = size; prints.t[i] = now; }
  function drawPrints(ctx, cam, now) {
    const s = cam.s, LIFE = 9;
    for (let b = 0; b < 3; b++) {
      ctx.beginPath(); let any = false;
      for (let i = 0; i < FN; i++) {
        const age = now - prints.t[i]; if (!(age >= 0 && age < LIFE)) continue;
        if (Math.min(2, (age / (LIFE / 3)) | 0) !== b) continue;
        const px = cam.fx + (prints.x[i] - cam.x) * s; if (px < -10 || px > cam.W + 10) continue;
        const py = cam.gy - (prints.y[i] - cam.y) * s, r = Math.max(1.4, prints.r[i] * s);
        ctx.moveTo(px + r, py + 2); ctx.ellipse(px, py + 2, r, r * 0.34, 0, 0, TAU); any = true;
      }
      if (any) { ctx.fillStyle = `rgba(${INK_RGB},${0.24 - b * 0.08})`; ctx.fill(); }
    }
  }

  /* ------------------------------------------------------------------ ana dünya */

  /** Sahte derinlik şeridi (0..3): kalabalıkta yaratıklar birebir üst üste binmesin diye hafifçe yukarı ve küçük çizilir. */
  const LANE_DY = 2.4, LANE_SC = 0.028;
  const laneOf = (v, i) => (((typeof v.id === 'number' ? v.id : i) % 4) + 4) % 4;

  class World {
    constructor(canvas, paperCanvas, grainCanvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.paper = paperCanvas; this.grain = grainCanvas;
      this.W = 0; this.H = 0; this.dpr = 1;
      this.cam = { x: 0, y: 0, s: 80, W: 0, H: 0, fx: 0, gy: 0 };
      this.free = { x: 0, y: 0, s: 80 };
      this.zoom = 1; this.snap = true; this.keepScale = false; this.safeL = 0; this.safeR = 0; this.groundY = 0;
      this.xs = new Float32Array(128); this.fade = null; this.vel = 0; this.prevTx = 0;
      this.renderMs = 0;
    }

    /** Boyut/DPR değişince tuvalleri yeniden kur. Çok büyük ekranlarda DPR sınırlanır. */
    resize(W, H, dpr) {
      W = Math.max(1, W | 0); H = Math.max(1, H | 0);
      const cap = 9.6e6; let d = clamp(dpr || 1, 1, 2); // 1728x1117 @2x = 7,7 Mpx tam keskin kalsın
      if (W * H * d * d > cap) d = Math.max(1, Math.sqrt(cap / (W * H)));
      this.W = W; this.H = H; this.dpr = d;
      for (const c of [this.canvas, this.paper, this.grain]) { c.width = Math.round(W * d); c.height = Math.round(H * d); }
      YY.paintPaper(this.paper, W, H, d); YY.paintGrain(this.grain, W, H, d);
      this.cam.W = W; this.cam.H = H; this.snap = true;
      // alt kenarı yumuşatan degrade (kağıt rengine erir)
      this.fadeGrad = null;
    }

    /** Kamera: lider takibi / tüm sürü / serbest. dt gerçek saniye; snap=true ise yumuşatmadan atlar. */
    updateCamera(dt, D) {
      const cam = this.cam, W = this.W, H = this.H;
      const safeL = this.safeL, safeR = this.safeR, safeW = Math.max(260, W - safeL - safeR);
      cam.gy = this.groundY > 0 ? this.groundY : H * 0.68;
      const L = D.leader, list = D.creatures, n = list.length;
      const bl = (L && L.bodyLength > 0.05 ? L.bodyLength : list[0] && list[0].bodyLength > 0.05 ? list[0].bodyLength : 0.6);
      const rate = (r) => (this.snap ? 1 : 1 - Math.exp(-dt * r));
      if (D.mode === 'free') {
        cam.x = this.free.x; cam.y = this.free.y; cam.s = this.free.s; cam.fx = safeL + safeW * 0.5; return;
      }
      let tx = 0, ty = 0, ts = 80, fxT = safeL + safeW * 0.6;
      if (n === 0 || !L) { ts = 80; }
      else if (D.mode === 'pack') {
        let mn = 1e9, mx = -1e9, cnt = 0;
        for (let i = 0; i < n; i++) { const c = list[i]; if (c.alive === false && cnt > 2) continue; if (!fin(c.x)) continue; cnt++; if (c.x < mn) mn = c.x; if (c.x > mx) mx = c.x; }
        if (cnt === 0) { mn = 0; mx = 0; }
        const span = clamp((mx - mn) * 1.18 + bl * 5, bl * 8, 1e4);
        ts = safeW / span; tx = (mn + mx) / 2; fxT = safeL + safeW * 0.5;
        ty = D.terrain.heightAt(tx);
      } else {
        if (this.xs.length < n) this.xs = new Float32Array(n * 2);
        let m = 0; for (let i = 0; i < n; i++) { const c = list[i]; if (c.alive === false || !fin(c.x)) continue; this.xs[m++] = c.x; }
        if (m < 3) { m = 0; for (let i = 0; i < n; i++) if (fin(list[i].x)) this.xs[m++] = list[i].x; }
        const sub = this.xs.subarray(0, m); sub.sort(); const p35 = m ? sub[Math.floor(m * 0.35)] : 0;
        const ll = L.legLength > 0.05 ? L.legLength : bl * 0.8;
        // yaratıklar ekranda büyük görünsün: sürünün ortasını sığdırır, geride kalan kuyruk kadraj dışında (kenar okuyla) kalabilir
        const span = clamp((L.x - p35) * 1.15 + bl * 6.5, Math.max(bl * 7.2, (bl + ll) * 5), Math.max(bl * 13, (bl + ll) * 8.5));
        ts = Math.min(safeW / span, 0.085 * W / bl); tx = L.x + bl * 0.15; ty = D.terrain.heightAt(L.x);
      }
      ts = clamp(ts * this.zoom, 9, 320);
      // ileri besleme: hedef hızlı hareket ederken üstel yumuşatma geride kalır; hızı ölçüp gecikmeyi öngörürüz
      const kx = 4.2;
      if (!this.snap && dt > 0) {
        let v = (tx - this.prevTx) / dt; const lim = 400;
        if (Math.abs(tx - this.prevTx) > bl * 12) v = 0; // lider değişimi / nesil sıfırlanması sıçraması
        this.vel += (clamp(v, -lim, lim) - this.vel) * (1 - Math.exp(-dt * 6));
        tx += this.vel / kx;
      }
      this.prevTx = tx - (this.snap ? 0 : this.vel / kx);
      const k = rate(kx);
      // nesil değişiminde yalnız konum atlar; ölçek (yakınlık) yumuşakça geçer
      if (this.snap && !this.keepScale) { cam.s = ts; }
      else cam.s += (ts - cam.s) * (1 - Math.exp(-Math.min(dt, 0.1) * 2.6));
      cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * rate(2.2); cam.fx += (fxT - cam.fx) * rate(3);
      if (this.snap) { cam.x = tx; cam.y = ty; cam.fx = fxT; this.snap = false; this.keepScale = false; this.vel = 0; this.prevTx = tx; }
      this.free.x = cam.x; this.free.y = cam.y; this.free.s = cam.s;
    }

    /** Kullanıcı sürükleme/tekerlek (serbest mod). */
    pan(dxPx, dyPx) { const f = this.free; f.x -= dxPx / f.s; f.y += dyPx / f.s; }
    zoomFree(factor, ax, ay) {
      const f = this.free, cam = this.cam, ns = clamp(f.s * factor, 6, 420);
      // imleç altındaki dünya noktası sabit kalsın
      const wx = cam.x + (ax - cam.fx) / cam.s, wy = cam.y + (cam.gy - ay) / cam.s;
      f.s = ns; f.x = wx - (ax - cam.fx) / ns; f.y = wy - (cam.gy - ay) / ns;
    }

    /**
     * D = { terrain, creatures, order, leader, ghost, recordDist, now, dt, mode, dust, leaderLabel }
     * order: sıralama indeksleri (en iyi başta); en kötüden en iyiye doğru çizilir, lider en üstte.
     */
    draw(D) {
      const ctx = this.ctx, W = this.W, H = this.H;
      if (W < 2 || H < 2) return;
      this.updateCamera(D.dt, D);
      const cam = this.cam;
      if (!(cam.s > 0) || !fin(cam.x) || !fin(cam.y)) { cam.x = 0; cam.y = 0; cam.s = 80; }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      YY.drawBackdrop(ctx, cam, D.terrain, { grid: true, marks: true, start: true, now: D.now });
      this.drawFade(ctx);
      if (D.recordDist > 0) drawRecordFlag(ctx, cam, D.terrain, D.recordDist);

      const list = D.creatures, n = list.length, s = cam.s, now = D.now;
      // temas geçişleri: toz + ayak izi; görünür yaratıklar
      let budget = D.dust ? 14 : 0, pbudget = 18;
      const margin = 3; // ekran dışı kırpma payı (metre cinsinden çarpan)
      stepDust(D.dt);
      for (let i = 0; i < n; i++) {
        const v = list[i]; if (!v.feet || !fin(v.x)) continue;
        const inf = getInfo(v), F = v.feet, vis = Math.abs(cam.fx + (v.x - cam.x) * s - W * 0.5) < W * 0.5 + (v.bodyLength + v.legLength) * s * margin;
        if (inf.prev.length !== F.length) inf.prev = new Uint8Array(F.length);
        for (let j = 0; j < F.length; j++) {
          const c = F[j].contact ? 1 : 0;
          if (c && !inf.prev[j] && vis && inf.seen) {
            const nd = v.nodes[F[j].node]; if (nd && fin(nd.x)) {
              const gyw = D.terrain.heightAt(nd.x), sz = Math.max(0.03, (v.bodyLength || 0.5) * 0.11);
              if (budget > 0) { emitDust(nd.x, gyw, sz, 1); budget--; }
              if (pbudget > 0 && v.alive !== false) { addPrint(nd.x, gyw, sz * 0.7, now); pbudget--; }
            }
          }
          inf.prev[j] = c;
        }
        inf.seen = true;
      }
      drawPrints(ctx, cam, now);

      // gölgeler (tek yol, tek dolgu)
      ctx.beginPath(); let any = false;
      for (let i = 0; i < n; i++) {
        const v = list[i]; if (!fin(v.x)) continue;
        const px = cam.fx + (v.x - cam.x) * s, rx = Math.max(4, (v.bodyLength || 0.5) * 0.62 * s);
        if (px < -rx * 2 || px > W + rx * 2) continue;
        const lane = v === D.leader ? 0 : laneOf(v, i), py = cam.gy - (D.terrain.heightAt(v.x) - cam.y) * s + 1 - lane * LANE_DY;
        ctx.moveTo(px + rx, py); ctx.ellipse(px, py, rx, rx * 0.15, 0, 0, TAU); any = true;
      }
      if (any) { ctx.fillStyle = `rgba(${INK_RGB},.13)`; ctx.fill(); }

      const gv = D.ghost;

      // yaratıklar: en kötüden en iyiye, lider en üstte. İlk 6 belirgin, gerisi silik: sürü tek koyu leke olmasın
      const lead = D.leader, order = D.order, useOrder = order && order.length === n;
      const aTop = n > 40 ? 0.66 : 0.74, aRest = n > 80 ? 0.16 : n > 40 ? 0.21 : n > 24 ? 0.32 : 0.55;
      for (let k = n - 1; k >= 0; k--) {
        const i = useOrder ? order[k] : k, v = list[i]; if (!v || v === lead) continue;
        this.drawOne(ctx, cam, v, useOrder && k >= 6 ? aRest : aTop, false, D, laneOf(v, i));
      }
      // hayalet: sürünün üstünde ama liderin altında; kesikli koyu mavi çizgi + soluk mavi dolgu, sürüden ayırt edilir
      if (gv) { drawCreature(ctx, cam, gv, { alpha: 0.62, mode: 2, lead: false, detail: 1 }); this.drawGhostTag(ctx, cam, gv, D.terrain); }
      if (lead) {
        // lider hâlesi: yalnız lidere, ince madder yıkama + noktalı halka
        const lpx = cam.fx + (lead.x - cam.x) * s, lpy = cam.gy - (lead.y - cam.y) * s, hr = (lead.bodyLength || 0.5) * 0.9 * s;
        if (fin(lpx) && fin(lpy) && lpx > -hr && lpx < W + hr) {
          ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(163,40,58,.045)'; ctx.beginPath(); ctx.arc(lpx, lpy, hr, 0, TAU); ctx.fill();
          ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(163,40,58,.32)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        }
        this.drawOne(ctx, cam, lead, 1, true, D, 0);
      }
      drawDust(ctx, cam);
      this.drawStragglers(ctx, cam, list, D);
      if (lead && D.leaderLabel) { this.drawCallout(ctx, cam, lead, D.leaderLabel); this.drawBodyGauge(ctx, cam, lead, D.terrain); }
      ctx.globalAlpha = 1;
    }

    drawOne(ctx, cam, v, alpha, isLead, D, lane) {
      if (!fin(v.x) || !fin(v.y)) return;
      const s = cam.s, bl = v.bodyLength || 0.5, reach = (bl + (v.legLength || 0.5)) * 1.5;
      const px = cam.fx + (v.x - cam.x) * s; if (px < -reach * s || px > this.W + reach * s) return;
      const dead = v.alive === false, pxSize = bl * s;
      const detail = isLead ? 0 : pxSize < 13 ? 2 : 1;
      let c = cam;
      if (lane) { // şerit: yaratığın kendi x'i etrafında küçült, zemine oturmasını koru
        const sc = s * (1 - LANE_SC * lane), c2 = this.laneCam || (this.laneCam = { x: 0, y: 0, s: 1, fx: 0, gy: 0, W: 0, H: 0 });
        c2.s = sc; c2.x = cam.x; c2.y = cam.y; c2.W = cam.W; c2.H = cam.H; c2.fx = cam.fx + (v.x - cam.x) * (s - sc);
        c2.gy = cam.gy - lane * LANE_DY + (D.terrain.heightAt(v.x) - cam.y) * (sc - s); c = c2;
      }
      drawCreature(ctx, c, v, { alpha: dead ? Math.min(0.3, alpha) : alpha, mode: dead ? 1 : 0, lead: isLead, detail });
    }

    /** Kadrajın solunda kalan yaratıklar için kenar işareti (kamera liderdeyken geride kalanlar kaybolmasın). */
    drawStragglers(ctx, cam, list, D) {
      if (D.mode !== 'leader') return;
      let n = 0; const s = cam.s;
      for (let i = 0; i < list.length; i++) { const v = list[i]; if (!fin(v.x) || v.alive === false) continue; if (cam.fx + (v.x - cam.x) * s < -(v.bodyLength || 0.5) * s) n++; }
      if (D.fadeIn) this.stragA = 0; // yeni nesil başında sürü toplu: etiket sönük kalsın
      const a = (this.stragA = this.stragA === undefined ? 0 : this.stragA), tgt = n > 0 && !D.fadeIn ? 1 : 0; this.stragA = a + (tgt - a) * 0.15;
      if (this.stragA < 0.03) return;
      if (n > 0) this.stragN = n;
      const txt = '◂ ' + this.stragN + ' yaratık daha geride', y = cam.gy - 34;
      ctx.globalAlpha = this.stragA; tag(ctx, txt, 14, y, `italic 12.5px ${SERIF}`, INK, 'left', 'rgba(249,243,227,.88)'); ctx.globalAlpha = 1;
    }

    /** Lider için künye çıkması: ince kırmızı çizgi + etiket. */
    drawCallout(ctx, cam, v, label) {
      const s = cam.s; let top = -1e9, ax = 0;
      for (let i = 0; i < v.nodes.length; i++) { const nd = v.nodes[i]; if (nd.y > top) { top = nd.y; ax = nd.x; } }
      if (!fin(top)) return;
      const x = cam.fx + (ax - cam.x) * s, y = cam.gy - (top - cam.y) * s - Math.max(4, (v.bodyLength || 0.5) * s * 0.22);
      if (x < -40 || x > this.W + 40) return;
      ctx.font = `italic 13px ${SERIF}`; const w1 = ctx.measureText(label.a).width; ctx.font = `700 12px ${MONO}`; const w2 = ctx.measureText(label.b).width;
      const bw = Math.max(w1, w2) + 14;
      // etiket panellerin ya da ekran kenarının altında kalmasın: önce sağa, olmazsa sola
      const P = this.panels || { lr: 0, lb: 0, rl: 1e9, rb: 0 }, byy = y - 38 - 21;
      const hitR = x + 34 + 18 + bw > Math.min(this.W - 8, byy < P.rb + 4 ? P.rl - 6 : 1e9);
      const hitL = x - 34 - 18 - bw < Math.max(8, byy < P.lb + 4 ? P.lr + 6 : 0);
      const flip = hitR && !hitL;
      const dir = flip ? -1 : 1, ex = x + dir * 34, ey = y - 38, bx = flip ? ex - 18 - bw : ex + 18, by = ey - 21;
      ctx.strokeStyle = MADDER; ctx.lineWidth = 1.2; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.lineTo(ex + dir * 18, ey); ctx.stroke();
      ctx.fillStyle = MADDER; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = PAPER_HI; ctx.fillRect(bx, by, bw, 38); ctx.strokeStyle = MADDER; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 37);
      tag(ctx, label.a, bx + 7, by + 11, `italic 13px ${SERIF}`, INK, 'left');
      tag(ctx, label.b, bx + 7, by + 27, `700 12px ${MONO}`, MADDER, 'left');
    }

    /** Hayalet etiketi: zeminin altına, noktalı çizgiyle; lider etiketiyle çakışmaz. */
    drawGhostTag(ctx, cam, v, terrain) {
      let ax = v.x; if (!fin(ax)) return;
      let top = -1e9; for (let i = 0; i < v.nodes.length; i++) { const nd = v.nodes[i]; if (nd.y > top) top = nd.y; }
      const x = cam.fx + (ax - cam.x) * cam.s; if (x < 40 || x > this.W - 40) return;
      const y0 = cam.gy - (terrain.heightAt(ax) - cam.y) * cam.s, below = y0 + 88 < this.H - 24;
      const y1 = below ? y0 + 5 : cam.gy - (top - cam.y) * cam.s - 6, ly = below ? y0 + 88 : y1 - 28;
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgb(31,78,112)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, below ? ly - 8 : y1 - 20); ctx.stroke(); ctx.setLineDash([]);
      tag(ctx, 'şampiyon hayaleti', x, ly, `italic 12px ${SERIF}`, 'rgb(31,78,112)', 'center', 'rgba(249,243,227,.9)');
    }

    /** Ölçü çizgisi: liderin gövde boyu, zeminin altına mimari çizim gibi işlenir ("1 boy"). */
    drawBodyGauge(ctx, cam, v, terrain) {
      const s = cam.s, bl = v.bodyLength || 0, len = bl * s; if (!(len >= 34) || !fin(v.x)) return;
      const x0 = cam.fx + (v.x - cam.x) * s - len / 2, y = cam.gy - (terrain.heightAt(v.x) - cam.y) * s + 46;
      if (y > this.H - 20) return;
      ctx.strokeStyle = MADDER; ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + len, y); ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y + 4); ctx.moveTo(x0 + len, y - 4); ctx.lineTo(x0 + len, y + 4);
      ctx.moveTo(x0 + 6, y - 3); ctx.lineTo(x0, y); ctx.lineTo(x0 + 6, y + 3); ctx.moveTo(x0 + len - 6, y - 3); ctx.lineTo(x0 + len, y); ctx.lineTo(x0 + len - 6, y + 3); ctx.stroke();
      tag(ctx, '1 boy = ' + YY.fmt(bl, 2) + ' m', x0 + len / 2, y + 13, `italic 11.5px ${SERIF}`, MADDER, 'center', 'rgba(220,200,157,.85)');
      ctx.globalAlpha = 1;
    }

    /** Alt kenar: zemin, kağıt rengine erir. */
    drawFade(ctx) {
      const H = this.H, W = this.W; if (!this.fadeGrad || this.fadeH !== H) { const g = ctx.createLinearGradient(0, H * 0.62, 0, H); g.addColorStop(0, 'rgba(239,228,203,0)'); g.addColorStop(1, 'rgba(239,228,203,.62)'); this.fadeGrad = g; this.fadeH = H; }
      ctx.fillStyle = this.fadeGrad; ctx.fillRect(0, H * 0.62, W, H * 0.38);
    }
  }
  YY.World = World;

  /* ------------------------------------------------------------------ küçük sahne (galeri, spot ışığı) */

  /**
   * Küçük tuvale bir sahne çizer. cam = { x, y, s, fx, gy, W, H }; views: [{view, alpha, mode}]
   * Kağıt rengi kendisi boyanır (tuval şeffaf değil).
   */
  YY.drawMini = function (ctx, dpr, W, H, cam, terrain, views, o) {
    o = o || {};
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f3ead2'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.4, 4, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,252,240,.5)'); g.addColorStop(1, 'rgba(160,120,70,.16)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    cam.W = W; cam.H = H;
    YY.drawBackdrop(ctx, cam, terrain, { lite: true, marks: true, minGap: o.minGap || 62, fontPx: o.fontPx || 9, start: true, grid: !!o.grid });
    // gölgeler
    ctx.beginPath(); let any = false;
    for (const e of views) { const v = e.view; if (!fin(v.x)) continue; const px = cam.fx + (v.x - cam.x) * cam.s, rx = Math.max(3, (v.bodyLength || 0.5) * 0.6 * cam.s), py = cam.gy - (terrain.heightAt(v.x) - cam.y) * cam.s + 1; ctx.moveTo(px + rx, py); ctx.ellipse(px, py, rx, rx * 0.15, 0, 0, TAU); any = true; }
    if (any) { ctx.fillStyle = `rgba(${INK_RGB},.14)`; ctx.fill(); }
    for (const e of views) {
      const v = e.view, dead = v.alive === false;
      drawCreature(ctx, cam, v, { alpha: dead ? 0.5 : (e.alpha || 1), mode: dead ? 1 : (e.mode || 0), lead: !!e.lead, detail: (v.bodyLength || 0.5) * cam.s < 13 ? 2 : (e.lead ? 0 : 1) });
    }
    ctx.globalAlpha = 1;
  };

  /** Bir görünümün (view) kutusuna sığdırılmış tek yaratık; tür kartları için. */
  YY.drawSpecimen = function (ctx, dpr, W, H, view, hue) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const n of view.nodes) { if (!fin(n.x) || !fin(n.y)) continue; const r = n.r || 0.05; x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r); y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r); }
    if (!(x1 > x0) || !(y1 > y0)) return;
    const s = Math.min((W - 8) / (x1 - x0), (H - 6) / (y1 - y0)), cam = { x: (x0 + x1) / 2, y: y0, s, fx: W / 2, gy: H - 3, W, H };
    const saveHue = view.hue; view.hue = hue;
    ctx.strokeStyle = `rgba(${INK_RGB},.5)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(2, H - 2.5); ctx.lineTo(W - 2, H - 2.5); ctx.stroke();
    drawCreature(ctx, cam, view, { alpha: 0.95, mode: 0, lead: false, detail: s * (view.bodyLength || 0.5) < 13 ? 2 : 1 });
    view.hue = saveHue; ctx.globalAlpha = 1;
  };

  /** Zemin türü kartı için profil çizgisi. */
  YY.drawTerrainIcon = function (ctx, dpr, W, H, terrain) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const x0 = -2, x1 = 26, ys = []; let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= 56; i++) { const y = terrain.heightAt(x0 + (x1 - x0) * i / 56) || 0; ys.push(y); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const rng = Math.max(1.2, hi - lo), sy = (H - 14) / rng, base = H - 6;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let i = 0; i <= 56; i++) ctx.lineTo(W * i / 56, base - (ys[i] - lo) * sy - 2);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = '#dcc89d'; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= 56; i++) { const x = W * i / 56, y = base - (ys[i] - lo) * sy - 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath();
    for (let i = 1; i < 56; i += 2) { const x = W * i / 56, y = base - (ys[i] - lo) * sy - 2; ctx.moveTo(x, y + 2); ctx.lineTo(x - 4, y + 8); }
    ctx.strokeStyle = `rgba(${INK_RGB},.4)`; ctx.lineWidth = 0.9; ctx.stroke();
  };
})(typeof window !== 'undefined' ? window : globalThis);
