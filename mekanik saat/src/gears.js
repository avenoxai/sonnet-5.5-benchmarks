// Dişli profilleri: evolvent tasarım çarkı + zarf (envelope) yöntemiyle eşlenik pinyon.
// Çıktılar 2B çokgenlerdir ([x,y] dizisi, CCW). THREE.Shape'e çevirme parts tarafında yapılır.

const TAU = Math.PI * 2;
const inv = (a) => Math.tan(a) - a;

/** Evolvent profilli düz dişli dış çizgisi. Diş 0'ın merkezi 0 açısındadır. */
export function involuteOutline({
  z, m, alphaDeg = 20, add = 1.0, ded = 1.25, thick = 1.0,
  flank = 7, tip = 3, rootPts = 2,
}) {
  const rp = (z * m) / 2;
  const alpha = (alphaDeg * Math.PI) / 180;
  const rb = rp * Math.cos(alpha);
  const ra = rp + add * m;
  const rf = Math.max(rp - ded * m, rp * 0.4);
  const rs = Math.max(rf, rb);
  const half = (r) => {
    const ar = Math.acos(Math.min(1, rb / Math.max(r, rb)));
    return (Math.PI / (2 * z)) * thick + inv(alpha) - inv(ar);
  };
  const pts = [];
  const step = TAU / z;
  for (let k = 0; k < z; k++) {
    const c = k * step;
    // sol yan (alçak açı) yükselir
    for (let i = 0; i <= flank; i++) {
      const r = rs + ((ra - rs) * i) / flank;
      const h = Math.max(half(r), 0.012);
      pts.push([r * Math.cos(c - h), r * Math.sin(c - h)]);
    }
    const ht = Math.max(half(ra), 0.012);
    for (let i = 1; i < tip; i++) {
      const a = c - ht + (2 * ht * i) / tip;
      pts.push([ra * Math.cos(a), ra * Math.sin(a)]);
    }
    for (let i = flank; i >= 0; i--) {
      const r = rs + ((ra - rs) * i) / flank;
      const h = Math.max(half(r), 0.012);
      pts.push([r * Math.cos(c + h), r * Math.sin(c + h)]);
    }
    if (rs > rf + 1e-6) {
      const h = half(rs);
      pts.push([rf * Math.cos(c + h), rf * Math.sin(c + h)]);
    }
    // kök yayı
    const hRoot = half(rs);
    const a0 = c + hRoot, a1 = c + step - hRoot;
    for (let i = 1; i <= rootPts; i++) {
      const a = a0 + ((a1 - a0) * i) / (rootPts + 1);
      pts.push([rf * Math.cos(a), rf * Math.sin(a)]);
    }
    if (rs > rf + 1e-6) {
      const h = half(rs);
      pts.push([rf * Math.cos(c + step - h), rf * Math.sin(c + step - h)]);
    }
  }
  return { pts, rp, ra, rf, rb };
}

/** Mandal çarkı: testere dişli. Dik yüz (tık kilidi) küçük açı tarafında, uzun rampa büyük açı tarafında.
 *  CCW dönüşte sabit bir mandal rampayı tırmanır, dik yüze düşer. Diş ucu k*adım açısındadır. */
export const RATCHET_BACK = 0.86;
export const RATCHET_POW = 1.3;
export function ratchetOutline({ z, rOut, rIn, backFrac = RATCHET_BACK }) {
  const step = TAU / z;
  const pts = [];
  for (let k = 0; k < z; k++) {
    const c = k * step;
    pts.push([rIn * Math.cos(c - 1e-4), rIn * Math.sin(c - 1e-4)]);     // dik yüzün dibi
    pts.push([rOut * Math.cos(c), rOut * Math.sin(c)]);                 // uç
    const n = 8;
    for (let i = 1; i <= n; i++) {
      const s = i / n;
      const r = rOut - (rOut - rIn) * Math.pow(s, 1 / RATCHET_POW);
      const a = c + backFrac * step * s;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const aEnd = c + backFrac * step;
    const aNext = c + step - 1e-4;
    for (let i = 1; i <= 2; i++) {
      const a = aEnd + ((aNext - aEnd) * i) / 3;
      pts.push([rIn * Math.cos(a), rIn * Math.sin(a)]);
    }
  }
  return { pts };
}

/** Çıkış çarkı: 15 testere dişli, diş ucu 0 açısında (CCW dönüş; dik yüz öne bakar). */
export function escapeWheelOutline({ z = 15, Re, Rroot, backFrac = 0.7, lean = 0 }) {
  const step = TAU / z;
  const pts = [];
  for (let k = 0; k < z; k++) {
    const c = k * step;
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const r = Rroot + (Re - Rroot) * s;
      const a = c - backFrac * step * Math.pow(1 - s, 1.35);
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    // dik (radyal) yüz kökte biter
    const aRoot = c - lean;   // dik yüz palet kilit yüzüyle paralel (draw açısı kadar eğik)
    pts.push([Rroot * Math.cos(aRoot), Rroot * Math.sin(aRoot)]);
    // kök yayı sonraki dişin arka yüz başına
    const aNext = c + step - backFrac * step;
    for (let i = 1; i <= 2; i++) {
      const a = aRoot + ((aNext - aRoot) * i) / 3;
      pts.push([Rroot * Math.cos(a), Rroot * Math.sin(a)]);
    }
  }
  return { pts };
}

// ---- Zarf yöntemi ile eşlenik takipçi (pinyon) ----
// W çarkı: (0,0)'da, dişler tasarım çokgeninde; takipçi F: (a,0)'da.
// Çıkış: F yerel çerçevesinde ϕ∈[-π/zf, π/zf] için yarıçap; boşluk merkezi ϕ=0.
export function conjugateFollower({
  wpts, zw, a, zf, tipR, rootR, clearance = 0.014, phiSamples = 120, alphaSamples = 240,
}) {
  // W kenarları, diş dizinine göre
  const n = wpts.length;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const p = wpts[i], q = wpts[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    segs.push({ x1: p[0], y1: p[1], dx: q[0] - p[0], dy: q[1] - p[1], ang: Math.atan2(my, mx) });
  }
  // açıya göre sırala → pencere ile hızlı seçim
  segs.sort((s1, s2) => s1.ang - s2.ang);
  const angs = segs.map(s => s.ang);
  const lowerBound = (v) => {
    let lo = 0, hi = angs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (angs[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const pitchW = TAU / zw;
  const window = Math.asin(Math.min(0.95, (tipR + 0.4) / a)) + pitchW * 2.2;
  const pitchF = TAU / zf;
  const out = new Float64Array(phiSamples + 1).fill(tipR);

  const aMin = -2.2 * pitchW, aMax = 2.2 * pitchW;
  for (let ia = 0; ia <= alphaSamples; ia++) {
    const alpha = aMin + ((aMax - aMin) * ia) / alphaSamples;
    const beta = Math.PI - alpha * (zw / zf);
    // F merkezi W çerçevesinde
    const ox = a * Math.cos(alpha), oy = -a * Math.sin(alpha);
    // pencere: W çerçevesinde açı -alpha çevresi
    const center = -alpha;
    const cand = [];
    const lo = center - window, hi = center + window;
    const pushRange = (from, to) => {
      let i = lowerBound(from);
      while (i < segs.length && angs[i] <= to) { cand.push(segs[i]); i++; }
    };
    // açıları [-π, π] içine sar
    const norm = (v) => { while (v > Math.PI) v -= TAU; while (v < -Math.PI) v += TAU; return v; };
    const l2 = norm(lo), h2 = norm(hi);
    if (l2 <= h2) pushRange(l2, h2); else { pushRange(l2, Math.PI); pushRange(-Math.PI, h2); }
    if (!cand.length) continue;
    for (let ip = 0; ip <= phiSamples; ip++) {
      const phi = -pitchF / 2 + (pitchF * ip) / phiSamples;
      const ang = phi + beta - alpha;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let best = Infinity;
      for (let k = 0; k < cand.length; k++) {
        const s = cand[k];
        // ışın: o + t d ; kenar: p + u e
        const den = dx * s.dy - dy * s.dx;
        if (Math.abs(den) < 1e-14) continue;
        const wx = s.x1 - ox, wy = s.y1 - oy;
        const t = (wx * s.dy - wy * s.dx) / den;
        const u = (wx * dy - wy * dx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
      }
      if (best < out[ip]) out[ip] = best;
    }
  }
  const prof = Array.from(out, (r) => Math.max(rootR, Math.min(tipR, r - clearance)));
  // hafif yumuşatma (tek geçiş)
  const sm = prof.slice();
  for (let i = 1; i < prof.length - 1; i++) sm[i] = 0.25 * prof[i - 1] + 0.5 * prof[i] + 0.25 * prof[i + 1];
  // çokgen üret
  const pts = [];
  for (let k = 0; k < zf; k++) {
    const base = k * pitchF; // boşluk merkezi ϕ=0 → k*pitch
    for (let ip = 0; ip < phiSamples; ip++) {
      const phi = -pitchF / 2 + (pitchF * ip) / phiSamples;
      const r = sm[ip];
      const ang = base + phi;
      pts.push([r * Math.cos(ang), r * Math.sin(ang)]);
    }
  }
  return { pts };
}

/** Bir çokgeni verilen açıda döndür (yeni dizi). */
export function rotatePts(pts, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

/** Çokgenin alanı (işaretli; CCW pozitif). */
export function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Çokgen–çokgen minimum derinlik testi (nokta içeride mi) — sadece doğrulama içindir. */
export function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
