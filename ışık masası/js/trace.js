/* 2B spektral ışın izleme: Snell, Fresnel, tam iç yansıma, dispersiyon, ince film */
(function () {
  'use strict';
  const LT = window.LT;
  const MAXSEG = 140000;
  const MAXPATH = 64; // bir yolun en fazla kaç parçası olabilir
  const K_LIGHT = 0.14; // ışık modunda huzme parlaklığı
  const K_RAYS = 1.1; // ışın modunda çizgi parlaklığı
  const BUBBLE_BOOST = 3.0; // sanatsal: ince film yansımasını gözle görülür yapar
  const SPEC = LT.SPEC;
  const MONO = LT.MONO;

  LT.instances = new Float32Array(MAXSEG * 8);
  LT.instCount = 0;

  const STACK = new Float64Array(300 * 7);
  let nSeg = 0;
  let W = 0;
  let H = 0;
  let disp = 1;
  let time = 0;
  let refl = 1;
  let glass = [];
  let bubbles = [];
  // isabet çıktıları
  let hNx = 0;
  let hNy = 0;
  let hU = 0;
  let hV = 0;

  function frac(x) {
    return x - Math.floor(x);
  }

  function rectExit(x, y, dx, dy) {
    const m = 120;
    let t = 1e9;
    if (dx > 1e-9) t = Math.min(t, (W + m - x) / dx);
    else if (dx < -1e-9) t = Math.min(t, (-m - x) / dx);
    if (dy > 1e-9) t = Math.min(t, (H + m - y) / dy);
    else if (dy < -1e-9) t = Math.min(t, (-m - y) / dy);
    return t < 0 ? 0 : t;
  }

  function segHit(g, ox, oy, dx, dy, tmax) {
    const S = g.segs;
    const n = g.n;
    let bt = tmax;
    let bi = -1;
    let bu = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      const x0 = S[o];
      const y0 = S[o + 1];
      const ex = S[o + 2] - x0;
      const ey = S[o + 3] - y0;
      const den = dx * ey - dy * ex;
      if (den > -1e-12 && den < 1e-12) continue;
      const ax = x0 - ox;
      const ay = y0 - oy;
      const t = (ax * ey - ay * ex) / den;
      if (t <= 1e-4 || t >= bt) continue;
      const u = (ax * dy - ay * dx) / den;
      if (u < 0 || u > 1) continue;
      bt = t;
      bi = i;
      bu = u;
    }
    if (bi < 0) return -1;
    const o = bi * 8;
    const nx = S[o + 4] * (1 - bu) + S[o + 6] * bu;
    const ny = S[o + 5] * (1 - bu) + S[o + 7] * bu;
    const l = Math.hypot(nx, ny) || 1;
    hNx = nx / l;
    hNy = ny / l;
    return bt;
  }

  // Elips biçimli sabun filmi. Yerel birim çember uzayında çözülür.
  function bubbleHit(b, ox, oy, dx, dy) {
    const px = ox - b.cx;
    const py = oy - b.cy;
    const lox = (px * b.cr + py * b.sr) / b.ax;
    const loy = (-px * b.sr + py * b.cr) / b.ay;
    const ldx = (dx * b.cr + dy * b.sr) / b.ax;
    const ldy = (-dx * b.sr + dy * b.cr) / b.ay;
    const A = ldx * ldx + ldy * ldy;
    const B = lox * ldx + loy * ldy;
    const C = lox * lox + loy * loy - 1;
    const disc = B * B - A * C;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    let t = (-B - s) / A;
    if (t <= 1e-4) t = (-B + s) / A;
    if (t <= 1e-4) return -1;
    hU = lox + t * ldx;
    hV = loy + t * ldy;
    const gx = hU / b.ax;
    const gy = hV / b.ay;
    const nx = gx * b.cr - gy * b.sr;
    const ny = gx * b.sr + gy * b.cr;
    const l = Math.hypot(nx, ny) || 1;
    hNx = nx / l;
    hNy = ny / l;
    return t;
  }

  function emit(x0, y0, x1, y1, lam, mono, I, hw) {
    if (nSeg >= MAXSEG) return;
    const T = mono ? MONO : SPEC;
    let idx = Math.round(lam) - 400;
    idx = idx < 0 ? 0 : idx > 300 ? 300 : idx;
    const o = nSeg * 8;
    const B = LT.instances;
    B[o] = x0;
    B[o + 1] = y0;
    B[o + 2] = x1;
    B[o + 3] = y1;
    B[o + 4] = T[idx * 3] * I;
    B[o + 5] = T[idx * 3 + 1] * I;
    B[o + 6] = T[idx * 3 + 2] * I;
    B[o + 7] = hw;
    nSeg++;
  }

  function traceRay(ox, oy, dx, dy, lam, mono, I0, hw, dots) {
    const Iterm = I0 * 0.012;
    const Ib = I0 * 0.02;
    const st = STACK;
    st[0] = ox;
    st[1] = oy;
    st[2] = dx;
    st[3] = dy;
    st[4] = I0;
    st[5] = -1;
    st[6] = 0;
    let top = 1;
    const l2 = 1e6 / (lam * lam);

    while (top > 0) {
      top--;
      const so = top * 7;
      let x = st[so];
      let y = st[so + 1];
      let rdx = st[so + 2];
      let rdy = st[so + 3];
      let I = st[so + 4];
      let med = st[so + 5];
      let cnt = st[so + 6];

      for (;;) {
        if (I < Iterm || cnt >= MAXPATH || nSeg >= MAXSEG) break;
        const tb = rectExit(x, y, rdx, rdy);
        let bt = tb;
        let kind = 0;
        let gi = -1;
        let bi = -1;
        let nx = 0;
        let ny = 0;
        let u = 0;
        let v = 0;

        if (med >= 0) {
          const t = segHit(glass[med], x, y, rdx, rdy, tb);
          if (t > 0) {
            bt = t;
            kind = 1;
            gi = med;
            nx = hNx;
            ny = hNy;
          }
        } else {
          for (let k = 0; k < glass.length; k++) {
            const g = glass[k];
            const lx = g.cx - x;
            const ly = g.cy - y;
            const tca = lx * rdx + ly * rdy;
            const d2 = lx * lx + ly * ly - tca * tca;
            if (d2 > g.R * g.R || tca + g.R < 0) continue;
            const t = segHit(g, x, y, rdx, rdy, bt);
            if (t > 0 && t < bt) {
              bt = t;
              kind = 1;
              gi = k;
              nx = hNx;
              ny = hNy;
            }
          }
          for (let k = 0; k < bubbles.length; k++) {
            const b = bubbles[k];
            const lx = b.cx - x;
            const ly = b.cy - y;
            const tca = lx * rdx + ly * rdy;
            const d2 = lx * lx + ly * ly - tca * tca;
            const R = b.R;
            if (d2 > R * R || tca + R < 0) continue;
            const t = bubbleHit(b, x, y, rdx, rdy);
            if (t > 0 && t < bt) {
              bt = t;
              kind = 2;
              bi = k;
              nx = hNx;
              ny = hNy;
              u = hU;
              v = hV;
            }
          }
        }

        const hx = x + rdx * bt;
        const hy = y + rdy * bt;
        emit(x, y, hx, hy, lam, mono, I, hw);
        cnt++;
        if (kind === 0) break;

        if (kind === 1) {
          const g = glass[gi];
          const n = g.mat.nD + disp * g.mat.B * (l2 - 2.8794);
          const cd = rdx * nx + rdy * ny;
          let n1;
          let n2;
          let mx;
          let my;
          let cosi;
          let entering;
          if (cd < 0) {
            entering = true;
            n1 = 1;
            n2 = n;
            mx = nx;
            my = ny;
            cosi = -cd;
          } else {
            entering = false;
            n1 = n;
            n2 = 1;
            mx = -nx;
            my = -ny;
            cosi = cd;
          }
          const eta = n1 / n2;
          const k = 1 - eta * eta * (1 - cosi * cosi);
          // yansıyan yön
          const rx = rdx + 2 * cosi * mx;
          const ry = rdy + 2 * cosi * my;
          if (k <= 0) {
            // tam iç yansıma
            rdx = rx;
            rdy = ry;
            x = hx + rdx * 0.004;
            y = hy + rdy * 0.004;
            continue;
          }
          const cost = Math.sqrt(k);
          const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
          const rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
          const R = 0.5 * (rs * rs + rp * rp);
          const Ir = I * R * refl;
          if (top < 290 && (Ir >= Ib || Math.random() * Ib < Ir)) {
            const so2 = top * 7;
            st[so2] = hx + rx * 0.004;
            st[so2 + 1] = hy + ry * 0.004;
            st[so2 + 2] = rx;
            st[so2 + 3] = ry;
            st[so2 + 4] = Ir >= Ib ? Ir : Ib;
            st[so2 + 5] = med;
            st[so2 + 6] = cnt;
            top++;
          }
          // geçen ışın
          const f = eta * cosi - cost;
          rdx = eta * rdx + f * mx;
          rdy = eta * rdy + f * my;
          const l = Math.hypot(rdx, rdy);
          rdx /= l;
          rdy /= l;
          I *= 1 - R;
          med = entering ? gi : -1;
          x = hx + rdx * 0.004;
          y = hy + rdy * 0.004;
        } else {
          // sabun filmi: ince film girişimi kadarını yansıtır, gerisi düz geçer
          const b = bubbles[bi];
          const cd = rdx * nx + rdy * ny;
          const cosi = Math.abs(cd);
          const d = LT.filmThickness(u, v, time, b.thick, b.phase);
          let R = LT.filmR(lam, cosi, d) * BUBBLE_BOOST;
          if (R > 0.9) R = 0.9;
          const Ir = I * R;
          const rx = rdx - 2 * cd * nx;
          const ry = rdy - 2 * cd * ny;
          if (dots) emit(hx, hy, hx, hy, lam, mono, Ir * 0.55, 4.5);
          if (top < 290 && (Ir >= Ib || Math.random() * Ib < Ir)) {
            const so2 = top * 7;
            st[so2] = hx + rx * 0.004;
            st[so2 + 1] = hy + ry * 0.004;
            st[so2 + 2] = rx;
            st[so2 + 3] = ry;
            st[so2 + 4] = Ir >= Ib ? Ir : Ib;
            st[so2 + 5] = -1;
            st[so2 + 6] = cnt;
            top++;
          }
          I *= 1 - R;
          x = hx + rdx * 0.004;
          y = hy + rdy * 0.004;
        }
      }
    }
  }

  function emitSource(s, P) {
    const g = s.geo;
    const dx = g.dx;
    const dy = g.dy;
    const px = -dy;
    const py = dx;
    const ox = s.x + dx * g.front;
    const oy = s.y + dy * g.front;
    const light = P.mode === 'light';
    const power = s.power;
    const hw = light ? 1.7 : 0.95;
    const f = P.frame;
    const u1 = frac(0.5 + f * 0.6180339887);
    const v1 = frac(0.5 + f * 0.5698402910);
    const mono = s.mono || s.stype === 'laser';
    const NL = mono ? 1 : light ? 14 : 9;

    if (s.stype === 'point') {
      const spread = (s.spread * Math.PI) / 180;
      const N = light ? LT.clamp(Math.round(s.spread * 2.2), 40, 620) : LT.clamp(Math.round(s.spread / 5) + 1, 2, 73);
      const step = spread / N;
      const nl = mono ? 1 : light ? 6 : 9;
      const I = light ? (K_LIGHT * 2 * power * Math.max(100 * step, 0.9)) / nl : (K_RAYS * power) / nl;
      const a0 = Math.atan2(dy, dx);
      for (let i = 0; i < N; i++) {
        const jit = light ? frac(v1 + i * 0.7548776662) : 0.5;
        const a = a0 + ((i + jit) / N - 0.5) * spread;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        for (let j = 0; j < nl; j++) {
          const uj = light ? frac(u1 + i * 0.7548776662 + j * 0.31) : 0.5;
          const lam = mono ? s.lam : 400 + (300 * (j + uj)) / nl;
          traceRay(s.x + cx * g.front, s.y + cy * g.front, cx, cy, lam, mono, I, hw, light);
        }
      }
      return;
    }

    // paralel huzme / lazer
    const w = s.width;
    let nSp;
    if (light) nSp = Math.max(1, Math.round(w / 2.2));
    else nSp = w < 4 ? 1 : LT.clamp(Math.round(w / 16) + 1, 2, 15);
    const sp = w / nSp;
    // dar huzmeler gözle daha parlak görünür; güç yoğunluğunu genişlikle artır
    const boost = 1 + 4 * Math.exp(-w / 30);
    const I = light ? (K_LIGHT * power * boost * Math.max(sp, 2.2)) / NL : (K_RAYS * power) / NL;
    for (let i = 0; i < nSp; i++) {
      let off;
      if (light) off = ((i + frac(v1 + i * 0.7548776662)) / nSp - 0.5) * w;
      else off = nSp === 1 ? 0 : ((i + 0.5) / nSp - 0.5) * w;
      const sx = ox + px * off;
      const sy = oy + py * off;
      for (let j = 0; j < NL; j++) {
        const uj = light ? frac(u1 + i * 0.7548776662 + j * 0.31) : 0.5;
        const lam = mono ? s.lam : 400 + (300 * (j + uj)) / NL;
        traceRay(sx, sy, dx, dy, lam, mono, I, hw, light);
      }
    }
  }

  LT.trace = function (items, P) {
    W = P.W;
    H = P.H;
    disp = P.disp;
    refl = P.refl === undefined ? 1 : P.refl;
    time = P.time;
    nSeg = 0;
    glass = [];
    bubbles = [];
    for (const it of items) {
      if (it.kind === 'prism' || it.kind === 'lens' || it.kind === 'diamond') {
        const g = it.geo;
        g.mat = LT.MATERIALS[it.mat];
        glass.push(g);
      } else if (it.kind === 'bubble' && it.popT === 0) {
        const g = it.geo;
        g.thick = it.thick;
        g.phase = it.phase;
        bubbles.push(g);
      }
    }
    for (const it of items) if (it.kind === 'source') emitSource(it, P);
    LT.instCount = nSeg;
    return nSeg;
  };
})();
