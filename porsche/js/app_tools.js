'use strict';
// app_tools.js — modelling aids used by js/app.js (auto-loaded by app.js, nothing else needs to include it).   Global: PG.tools
//
//   PG.tools.reference(full?)            -> the REFERENCE TARGET tables derived from PG.spec (see below)
//   PG.tools.referenceAt(view, xs, full) -> reference values sampled at the given coordinates (used by tools/profile.js)
//   PG.tools.drawOverlay(g2, o)          -> draws the 2D overlay (metric grid, ground, axles, wheels, red reference silhouette, anchors)
//   PG.tools.scanPixels(r, pixels, view, samples)  -> per-column silhouette extents measured from a silhouette-mode frame
//   PG.tools.probe(rc, x, z) / PG.tools.probeAt(rc, origin, dir)   -> CPU ray queries on a raycaster (PG_APP.probe / probeAt wrap these)
//
// REFERENCE TARGET (all numbers come from PG.spec; a few points that spec.js does not name come from REFERENCE.md section 3.1 and are marked [R]):
//   side view (car x -> y): the closed outline  tail-bottom -> tail top -> duck-tail -> deck crest -> deck start -> rear window top ->
//     roof peak -> roof front -> cowl -> hood mid -> nose top -> nose face -> splitter tip -> underbody -> diffuser edge.
//     `top` (upper surface, ascending x) and `bottom` (lower surface) are the two functions used for numeric comparison.
//   top view: mirrored PG.spec.planHalfWidth (x -> |z| of the widest point of the body).
//   front / rear view: a rough box (half width halfWidthMax, underbody .. roofMaxY) + the wing envelope + wheel tread edges.
//   anchors (small crosses): wing, mirror, headlight, tail-light bar, exhaust, door handle, hood outlet, fender louvre, roof fin, seats, steering wheel.
//   `full` = also count wheels, mirrors and the wing in the reference (for comparing a whole-car silhouette; default is the body only).
(function () {
  const PG = window.PG;
  const tools = PG.tools = {};

  // ---------------------------------------------------------------------------------------------- reference target
  function interp(pts, x) {          // pts ascending [x, y]; null outside the domain
    if (x < pts[0][0] - 1e-9 || x > pts[pts.length - 1][0] + 1e-9) return null;
    for (let i = 0; i < pts.length - 1; i++) {
      if (x <= pts[i + 1][0] + 1e-12) { const d = pts[i + 1][0] - pts[i][0]; return d < 1e-9 ? pts[i + 1][1] : pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (x - pts[i][0]) / d; }
    }
    return pts[pts.length - 1][1];
  }
  tools.reference = function () {
    const S = PG.spec, p = S.profile, a = S.anchors, nose = S.noseX, tail = S.tailX;
    const named = [      // labelled control points of the upper centre-line profile
      ['tail top', tail, p.tailTopY], ['duck-tail', tail + 0.067, p.ducktailY],          // [R] duck-tail crest x ~ tail + 0.067
      ['deck crest', p.deckCrestX, p.deckCrestY], ['deck start', p.deckStartX, p.deckY],
      ['rear window top', p.rearWindowTopX, p.rearWindowTopY], ['roof peak', p.roofPeakX, p.roofPeakY], ['roof front', p.roofFrontX, p.roofFrontY],
      ['cowl', p.cowlX, p.cowlY], ['hood mid', 1.35, p.hoodMidY], ['nose top', 2.12, p.noseTopY],                                // [R] hood mid x 1.35, lid edge x 2.12
    ].sort((u, v) => u[1] - v[1]);
    const noseFace = [[2.20, 0.58], [nose, S.splitterY + 0.015]];                                                            // [R]
    const top = named.map(q => [q[1], q[2]]).concat(noseFace);
    const gc = S.groundClearance;
    const bottom = [[tail, 0.90], [tail + 0.067, p.tailBottomY], [tail + 0.077, 0.29], [-1.4, gc], [1.8, gc], [nose, S.splitterY]];   // [R] diffuser edge 0.29, kick-up from x -1.4
    const outline = [[tail + 0.067, p.tailBottomY, 'tail bottom'], [tail, 0.90]].concat(named.map(q => [q[1], q[2], q[0]]), [[2.20, 0.58], [nose, S.splitterY + 0.015, 'splitter tip'], [nose, S.splitterY]],
      [[1.8, gc], [-1.4, gc], [tail + 0.077, 0.29, 'diffuser edge']]);
    const plan = S.planHalfWidth.map(q => [q[0], q[1]]).sort((u, v) => u[0] - v[0]);
    const w = a.wing;
    const anchors = [
      ['wing foot', [w.footX, w.footY, w.strutZ], 1], ['wing LE', [w.leX, w.topY - 0.03, 0], 0], ['wing TE', [w.teX, w.topY, 0], 0], ['wing plate', [(w.leX + w.teX) / 2, w.topY - 0.06, w.endplateZ], 1],
      ['mirror', [a.mirror.x, a.mirror.y, a.mirror.z], 1], ['mirror tip', [a.mirror.x, a.mirror.y + 0.06, 1.0135], 1], ['headlight', [a.headlight.x, a.headlight.y, a.headlight.z], 1],
      ['tail bar', [a.taillightBar.x, a.taillightBar.y, a.taillightBar.halfWidth], 1], ['tail bar', [a.taillightBar.x, a.taillightBar.y, 0], 0],
      ['exhaust', [a.exhaust.x, a.exhaust.y, a.exhaust.z], 1], ['door handle', [a.doorHandle.x, a.doorHandle.y, a.doorHandle.z], 1],
      ['hood outlet', [a.hoodOutlet.x, interp(top, a.hoodOutlet.x) || 0.75, a.hoodOutlet.z], 1], ['louvre', [a.fenderLouvre.x, a.fenderLouvre.y, a.fenderLouvre.z], 1],
      ['roof fin', [a.roofFin.x, interp(top, a.roofFin.x) || 1.26, a.roofFin.z], 1],
      ['steering wheel', [a.steeringWheel.x, a.steeringWheel.y, a.steeringWheel.z], 0], ['seat', [a.driverSeat.x, a.driverSeat.y, a.driverSeat.z], 0],
    ];
    return { top, bottom, outline, named, plan, anchors, wing: w, mirrorX: [a.mirror.x - 0.09, a.mirror.x + 0.09], mirrorHalfWidth: 1.0135 };
  };

  // Reference values at coordinates xs. view 'side': {top, bottom} (y);  'top': {hw} (half width);  'front': {top, hw} of the rough box.
  tools.referenceAt = function (view, xs, full) {
    const S = PG.spec, R = tools.reference(), out = { view, xs: xs.slice() };
    const wheels = [S.wheel.front, S.wheel.rear];
    if (view === 'side' || view === 'sider') {
      out.top = xs.map(x => { let y = interp(R.top, x); if (full && y !== null && x >= R.wing.teX && x <= R.wing.leX) y = Math.max(y, R.wing.topY); return y; });
      out.bottom = xs.map(x => {
        let y = interp(R.bottom, x); if (y === null) return null;
        if (full) for (const w of wheels) { const d = Math.abs(x - w.x); if (d < w.tireRadius) y = Math.min(y, w.tireRadius - Math.sqrt(w.tireRadius * w.tireRadius - d * d)); }
        return y;
      });
    } else if (view === 'top' || view === 'bottom') {
      out.hw = xs.map(x => {
        let h = interp(R.plan, x); if (h === null) return null;
        if (full) {
          for (const w of wheels) if (Math.abs(x - w.x) <= w.tireRadius) h = Math.max(h, w.track / 2 + w.tireWidth / 2);
          if (x >= R.mirrorX[0] && x <= R.mirrorX[1]) h = Math.max(h, R.mirrorHalfWidth);
          if (x >= R.wing.teX && x <= R.wing.leX) h = Math.max(h, R.wing.endplateZ);
        }
        return h;
      });
    } else {   // front / rear: xs are z coordinates
      out.top = xs.map(z => { const az = Math.abs(z); if (az > S.halfWidthMax) return null; return full && az <= R.wing.endplateZ ? R.wing.topY : S.roofMaxY; });
      out.bottom = xs.map(z => Math.abs(z) > S.halfWidthMax ? null : S.groundClearance);
    }
    return out;
  };

  // ---------------------------------------------------------------------------------------------- overlay drawing
  // o = { W, H (css px), viewProj (Float32Array16), view (Float32Array16), mode: true|'all'|'refs'|'grid', light: bool (light background),
  //       target:[x,y,z], name:'oside' }
  const KIND_NAMES = { side: 'side (left, nose <-)', sider: 'side (right, nose ->)', top: 'top (nose <-, right side up)', bottom: 'bottom', front: 'front', rear: 'rear' };
  tools.viewKind = function (v) {
    const fx = -v[2], fy = -v[6], fz = -v[10], A = 0.999;
    if (Math.abs(fz) > A) return fz > 0 ? 'side' : 'sider';
    if (Math.abs(fx) > A) return fx < 0 ? 'front' : 'rear';
    if (Math.abs(fy) > A) return fy < 0 ? 'top' : 'bottom';
    return null;
  };
  tools.drawOverlay = function (g, o) {
    const W = o.W, H = o.H, m = o.viewProj, v = o.view, mode = o.mode;
    g.clearRect(0, 0, W, H);
    const kind = tools.viewKind(v); if (!kind) return false;
    const showGrid = mode === true || mode === 'all' || mode === 'grid', showRefs = mode === true || mode === 'all' || mode === 'refs';
    const S = PG.spec, R = tools.reference(), light = !!o.light;
    const P = (x, y, z) => { const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * W, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * H]; };
    // in-plane axes: horizontal (screen x) and vertical (screen y) world axis
    const right = [v[0], v[4], v[8]], up = [v[1], v[5], v[9]];
    const idx = a => Math.abs(a[0]) > 0.7 ? 0 : Math.abs(a[1]) > 0.7 ? 1 : 2;
    const hI = idx(right), vI = idx(up), tgt = o.target;
    const t0 = tgt.slice(), p0 = P(t0[0], t0[1], t0[2]);
    const unit = i => { const t = t0.slice(); t[i] += 1; return P(t[0], t[1], t[2]); };
    const kx = unit(hI)[0] - p0[0], ky = unit(vI)[1] - p0[1];            // signed px per metre
    const ppm = Math.abs(kx);
    const valX = sx => t0[hI] + (sx - p0[0]) / kx, valY = sy => t0[vI] + (sy - p0[1]) / ky;
    const sxOf = a => p0[0] + (a - t0[hI]) * kx, syOf = a => p0[1] + (a - t0[vI]) * ky;
    const AX = 'xyz';
    const ink = light ? '20,40,70' : '190,215,245', halo = light ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.7)';
    g.font = '10px ui-monospace,Menlo,Consolas,monospace'; g.textBaseline = 'alphabetic';
    const text = (s, x, y, col, align) => { g.save(); g.setLineDash([]); g.textAlign = align || 'left'; g.lineWidth = 3.5; g.lineJoin = 'round'; g.strokeStyle = halo; g.strokeText(s, x, y); g.fillStyle = col; g.fillText(s, x, y); g.restore(); };
    const poly = (pts, close) => { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); if (close) g.closePath(); };
    // 2D shape coordinates (a, b) of this view -> world point
    const to3 = { side: (a, b) => [a, b, 0], sider: (a, b) => [a, b, 0], top: (a, b) => [a, 0, b], bottom: (a, b) => [a, 0, b], front: (a, b) => [0, b, a], rear: (a, b) => [0, b, a] }[kind];
    const proj2 = (a, b) => { const q = to3(a, b); return P(q[0], q[1], q[2]); };

    // ---- grid: 0.1 m minor, 0.5 m major (labelled in metres)
    if (showGrid) {
      const draw = (axis, i, step, style, width) => {
        const isH = axis === 'h', lo = isH ? Math.min(valX(0), valX(W)) : Math.min(valY(0), valY(H)), hi = isH ? Math.max(valX(0), valX(W)) : Math.max(valY(0), valY(H));
        g.strokeStyle = style; g.lineWidth = width; g.beginPath();
        for (let k = Math.ceil(lo / step - 1e-6); k <= Math.floor(hi / step + 1e-6); k++) {
          if (step < 0.4 && k % 5 === 0) continue;            // majors are drawn separately
          const a = k * step; if (isH) { const s = Math.round(sxOf(a)) + 0.5; g.moveTo(s, 0); g.lineTo(s, H); } else { const s = Math.round(syOf(a)) + 0.5; g.moveTo(0, s); g.lineTo(W, s); }
        }
        g.stroke();
      };
      if (ppm >= 55) { draw('h', hI, 0.1, `rgba(${ink},.16)`, 1); draw('v', vI, 0.1, `rgba(${ink},.16)`, 1); }
      if (ppm >= 14) {
        draw('h', hI, 0.5, `rgba(${ink},.40)`, 1); draw('v', vI, 0.5, `rgba(${ink},.40)`, 1);
        const lab = ppm >= 90 ? 0.5 : 1.0;
        for (const [axis, lo, hi] of [['h', Math.min(valX(0), valX(W)), Math.max(valX(0), valX(W))], ['v', Math.min(valY(0), valY(H)), Math.max(valY(0), valY(H))]]) {
          for (let k = Math.ceil(lo / lab - 1e-6); k <= Math.floor(hi / lab + 1e-6); k++) {
            const a = k * lab, s = a.toFixed(1).replace('-0.0', '0.0');
            if (axis === 'h') text(s, sxOf(a), H - 6, `rgba(${ink},.95)`, 'center'); else text(s, 6, syOf(a) + 3.5, `rgba(${ink},.95)`, 'left');
          }
        }
        text(AX[hI] + ' [m]', W - 8, H - 20, `rgba(${ink},.95)`, 'right'); text(AX[vI] + ' [m]', 6, 14, `rgba(${ink},.95)`, 'left');
      }
      // ground line (side / front / rear) or centre line (top)
      g.setLineDash([]);
      if (vI === 1) { g.strokeStyle = light ? 'rgba(0,120,60,.9)' : 'rgba(80,255,150,.85)'; g.lineWidth = 2; const s = Math.round(syOf(0)) + 0.5; g.beginPath(); g.moveTo(0, s); g.lineTo(W, s); g.stroke(); text('ground y=0', W - 8, s - 4, light ? 'rgb(0,110,55)' : 'rgb(110,255,170)', 'right'); }
      g.strokeStyle = `rgba(${ink},.55)`; g.lineWidth = 1; g.setLineDash([8, 5]);
      { const s = Math.round(sxOf(0)) + 0.5; g.beginPath(); g.moveTo(s, 0); g.lineTo(s, H); g.stroke(); }
      if (kind === 'top' || kind === 'bottom') { const s = Math.round(syOf(0)) + 0.5; g.beginPath(); g.moveTo(0, s); g.lineTo(W, s); g.stroke(); }
      g.setLineDash([]);
    }

    // ---- axle centres and wheels (always with the grid or refs)
    if (showGrid || showRefs) {
      g.lineWidth = 1.5; const wc = '#22d3ee'; g.strokeStyle = wc; g.fillStyle = wc;
      for (const ax of ['front', 'rear']) {
        const w = S.wheel[ax], R0 = w.tireRadius, rr = w.rimDiameter / 2;
        g.setLineDash(ax === 'front' ? [] : [7, 4]);
        if (kind === 'side' || kind === 'sider') {
          for (const rad of [R0, rr]) { const pts = []; for (let i = 0; i < 96; i++) { const t = i / 96 * Math.PI * 2; pts.push(proj2(w.x + Math.cos(t) * rad, R0 + Math.sin(t) * rad)); } poly(pts, true); g.stroke(); }
          const c = proj2(w.x, R0); g.setLineDash([]); g.beginPath(); g.moveTo(c[0] - 7, c[1]); g.lineTo(c[0] + 7, c[1]); g.moveTo(c[0], c[1] - 7); g.lineTo(c[0], c[1] + 7); g.stroke();
          text((ax === 'front' ? 'F' : 'R') + ' axle x=' + w.x.toFixed(4), c[0], c[1] + rr * ppm * 0.5 + 16, wc, 'center');
        } else if (kind === 'top' || kind === 'bottom') {
          for (const sd of [-1, 1]) { const zc = sd * w.track / 2, hw = w.tireWidth / 2; poly([proj2(w.x - R0, zc - hw), proj2(w.x + R0, zc - hw), proj2(w.x + R0, zc + hw), proj2(w.x - R0, zc + hw)], true); g.stroke(); }
          const a = proj2(w.x, -1.15), b = proj2(w.x, 1.15); g.setLineDash([3, 5]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
          text((ax === 'front' ? 'F' : 'R') + ' axle', a[0], a[1] - 4, wc, 'center');
        } else {
          for (const sd of [-1, 1]) { const zc = sd * w.track / 2, hw = w.tireWidth / 2; poly([proj2(zc - hw, 0), proj2(zc + hw, 0), proj2(zc + hw, 2 * R0), proj2(zc - hw, 2 * R0)], true); g.stroke(); }
          const c = proj2(w.track / 2 * (kind === 'front' ? -1 : 1), 2 * R0 + (ax === 'front' ? 0.03 : 0.09)); text((ax === 'front' ? 'F' : 'R') + ' tread z=' + (w.track / 2 - w.tireWidth / 2).toFixed(3) + '..' + (w.track / 2 + w.tireWidth / 2).toFixed(3), c[0], c[1], wc, 'center');
        }
      }
      g.setLineDash([]);
    }

    // ---- reference target silhouette (red)
    if (showRefs) {
      const red = '#ff2a2a', tred = '#ff6060'; g.strokeStyle = red; g.fillStyle = red; g.lineWidth = 1.6; g.setLineDash([]);
      const dot = (q, r) => { g.beginPath(); g.arc(q[0], q[1], r || 2.6, 0, Math.PI * 2); g.fill(); };
      if (kind === 'side' || kind === 'sider') {
        poly(R.outline.map(q => proj2(q[0], q[1])), true); g.stroke();
        let lvl = 0;
        for (const q of R.outline) { const s = proj2(q[0], q[1]); dot(s); if (q[2] && ['tail top', 'duck-tail', 'deck crest', 'deck start', 'rear window top', 'roof peak', 'roof front', 'cowl', 'hood mid', 'nose top'].includes(q[2])) { text(q[2] + ' (' + q[0].toFixed(2) + ', ' + q[1].toFixed(3) + ')', s[0], s[1] - 8 - (lvl++ % 3) * 12, tred, 'center'); } else if (q[2]) text(q[2], s[0], s[1] + 14, tred, 'center'); }
      } else if (kind === 'top' || kind === 'bottom') {
        const rt = R.plan.map(q => proj2(q[0], q[1])), lt = R.plan.map(q => proj2(q[0], -q[1])).reverse();
        poly(rt.concat(lt), true); g.stroke(); let lvl = 0;
        for (const q of R.plan) { for (const sd of [-1, 1]) dot(proj2(q[0], sd * q[1])); const s = proj2(q[0], q[1]); text('x' + q[0].toFixed(2) + ' ' + q[1].toFixed(3), s[0], s[1] - 8 - (lvl++ % 2) * 12, tred, 'center'); }
      } else {
        const hw = S.halfWidthMax, y0 = S.groundClearance, y1 = S.roofMaxY, wg = R.wing;
        g.setLineDash([9, 5]); poly([proj2(-hw, y0), proj2(hw, y0), proj2(hw, y1), proj2(-hw, y1)], true); g.stroke();
        g.setLineDash([]); poly([proj2(-wg.endplateZ, wg.mainUnderY), proj2(wg.endplateZ, wg.mainUnderY), proj2(wg.endplateZ, wg.topY), proj2(-wg.endplateZ, wg.topY)], true); g.stroke();
        for (const sd of [-1, 1]) { const q = proj2(sd * R.mirrorHalfWidth, S.anchors.mirror.y + 0.03); dot(q); }
        text('width ' + (2 * hw).toFixed(3) + '  roof ' + y1.toFixed(3), proj2(-hw, y1)[0] + (kind === 'front' ? 4 : 4), proj2(-hw, y1)[1] + 14, tred, 'left');
        text('wing top ' + wg.topY.toFixed(3) + '  plate z=' + wg.endplateZ, proj2(-wg.endplateZ, wg.topY)[0], proj2(0, wg.topY)[1] - 8, tred, 'left');
      }
      // anchors: small crosses in every view
      const amb = light ? '#b06000' : '#ffb830'; g.strokeStyle = amb; g.lineWidth = 1.4;
      for (const [name, pos, mirrored] of R.anchors) {
        for (const sd of mirrored ? [-1, 1] : [1]) {
          const q = P(pos[0], pos[1], pos[2] * sd);
          g.beginPath(); g.moveTo(q[0] - 5, q[1]); g.lineTo(q[0] + 5, q[1]); g.moveTo(q[0], q[1] - 5); g.lineTo(q[0], q[1] + 5); g.stroke();
          if (sd === (mirrored ? (kind === 'top' || kind === 'bottom' ? 1 : (kind === 'sider' || kind === 'rear' ? 1 : -1)) : 1)) text(name, q[0] + 7, q[1] - 5, amb, 'left');
        }
      }
    }

    // ---- HUD
    text('OVERLAY ' + (o.name || '') + ' ' + KIND_NAMES[kind] + '   ' + ppm.toFixed(1) + ' px/m   grid 0.1 / 0.5 m   ref: red = PG.spec target', W - 8, H - 34, `rgba(${ink},.95)`, 'right');
    return true;
  };

  // ---------------------------------------------------------------------------------------------- silhouette scan (pixel readback)
  const SRGB2LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; SRGB2LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  // r: renderer that has just rendered a debug=silhouette frame, pixels: r.readPixels() (RGBA8, bottom-up), samples: world coordinates along the
  // horizontal screen axis at which to measure. Returns { kind, hAxis, vAxis, ppm, mmPerPx, rows:[{h, hi, lo}], extent:{hMin,hMax,vMin,vMax} }
  // hi/lo = world coordinates (along the vertical screen axis) of the upper / lower silhouette edge in that column (sub-pixel from the MSAA coverage), null = empty.
  tools.scanPixels = function (r, pixels, samples) {
    const W = r.width, H = r.height, m = r.viewProj, v = r.view, kind = tools.viewKind(v);
    if (!kind) throw new Error('scan needs an axis-aligned orthographic view');
    const tgt = r.cam.target;
    const P = (x, y, z) => { const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * W, (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * H]; };
    const right = [v[0], v[4], v[8]], up = [v[1], v[5], v[9]], idx = a => Math.abs(a[0]) > 0.7 ? 0 : Math.abs(a[1]) > 0.7 ? 1 : 2;
    const hI = idx(right), vI = idx(up), p0 = P(tgt[0], tgt[1], tgt[2]);
    const u = i => { const t = tgt.slice(); t[i] += 1; return P(t[0], t[1], t[2]); };
    const kx = u(hI)[0] - p0[0], ky = u(vI)[1] - p0[1];            // device px per metre (signed)
    const g0 = 0.05, cov = (col, row) => { const o = ((H - 1 - row) * W + col) * 4; const l = SRGB2LIN[pixels[o]]; const c = (1 - l) / (1 - g0); return c < 0 ? 0 : c > 1 ? 1 : c; };
    const vOf = py => tgt[vI] + (py - p0[1]) / ky;
    const colEdges = col => {          // [topPx, bottomPx, maxCov] in device px (top-down); null when the column is empty
      if (col < 0 || col >= W) return null;
      let i = 0; while (i < H && cov(col, i) < 0.02) i++;
      if (i >= H) return null;
      let k = H - 1; while (k > i && cov(col, k) < 0.02) k--;
      return [i + 1 - cov(col, i), k + cov(col, k)];
    };
    const rows = [];
    for (const h of samples) {
      const px = p0[0] + (h - tgt[hI]) * kx, c0 = Math.floor(px - 0.5), fr = px - 0.5 - c0;
      const e0 = colEdges(c0), e1 = colEdges(c0 + 1);
      let e = null;
      if (e0 && e1) e = [e0[0] + (e1[0] - e0[0]) * fr, e0[1] + (e1[1] - e0[1]) * fr]; else if (e0 && fr < 0.5) e = e0; else if (e1 && fr >= 0.5) e = e1;
      if (!e) { rows.push({ h, hi: null, lo: null }); continue; }
      const a = vOf(e[0]), b = vOf(e[1]); rows.push({ h, hi: Math.max(a, b), lo: Math.min(a, b) });
    }
    // global extent: scan every column
    let hMin = 1e9, hMax = -1e9, vMin = 1e9, vMax = -1e9, first = -1, last = -1;
    for (let c = 0; c < W; c++) { const e = colEdges(c); if (!e) continue; if (first < 0) first = c; last = c; const a = vOf(e[0]), b = vOf(e[1]); vMax = Math.max(vMax, a, b); vMin = Math.min(vMin, a, b); }
    if (first >= 0) {
      // sub-pixel left / right edge of the silhouette from the coverage of the first / last covered column
      const colMax = c => { let mx = 0; for (let y = 0; y < H; y++) { const q = cov(c, y); if (q > mx) mx = q; } return mx; };
      const xl = first + 1 - colMax(first), xr = last + colMax(last);
      const h1 = tgt[hI] + (xl - p0[0]) / kx, h2 = tgt[hI] + (xr - p0[0]) / kx; hMin = Math.min(h1, h2); hMax = Math.max(h1, h2);
    }
    return { kind, hAxis: 'xyz'[hI], vAxis: 'xyz'[vI], hSign: Math.sign(kx), ppm: Math.abs(kx), mmPerPx: 1000 / Math.abs(kx), rows, extent: first >= 0 ? { hMin, hMax, vMin, vMax } : null };
  };

  // ---------------------------------------------------------------------------------------------- CPU ray queries
  tools.probe = function (rc, x, z, opts) {
    if (!rc) return null;
    opts = opts || {};
    const y0 = opts.yStart !== undefined ? opts.yStart : 3;
    let all = [];
    try { all = rc.castAll([x, y0, z], [0, -1, 0], { backfaces: true }) || []; } catch (e) { all = []; }
    const hits = all.map(h => ({ y: +h.point[1].toFixed(5), normal: h.normal ? [+h.normal[0].toFixed(4), +h.normal[1].toFixed(4), +h.normal[2].toFixed(4)] : null, front: h.front !== false }));
    return { x, z, found: hits.length > 0, top: hits.length ? hits[0].y : null, topNormal: hits.length ? hits[0].normal : null, bottom: hits.length ? hits[hits.length - 1].y : null, hits };
  };
  tools.probeAt = function (rc, origin, dir, opts) {
    if (!rc) return null;
    let h = null; try { h = rc.cast(origin, dir, opts); } catch (e) { h = null; }
    return h || null;
  };
})();
