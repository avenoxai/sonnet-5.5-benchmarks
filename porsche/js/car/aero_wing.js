'use strict';
// car/aero_wing.js — geometry of the swan-neck two-element DRS rear wing (pure PG.geo meshes, no GL; runs in Node too).
// Exposes PG.aeroWingGeo(G, U) -> { layout, main, flap, endplates, uprights, hinges, link, gurney ... }   (all in CAR space at DRS = 0)
//   U = { lidY(x,z) -> engine-lid height (or null), quality }
// Wing frame: chord runs along -X (LE forward at x ~ -1.94, TE at ~ -2.315), the wing is an INVERTED (downforce) cambered section:
// convex side down, trailing edge higher than the leading edge.  Flap hinge axis = line (hinge.x, hinge.y) along Z.
(function () {
  const PG = window.PG, spec = PG.spec, DEG = Math.PI / 180;
  const A = spec.anchors.wing;

  // ---- 2D helpers -----------------------------------------------------------------------------------------------
  function vHits(poly, x) {                       // [ymin, ymax] of a closed polygon on the vertical line x
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[0] <= x && b[0] >= x) || (b[0] <= x && a[0] >= x)) {
        const dx = b[0] - a[0], t = Math.abs(dx) < 1e-12 ? 0 : (x - a[0]) / dx, y = a[1] + t * (b[1] - a[1]);
        lo = Math.min(lo, y, Math.abs(dx) < 1e-12 ? b[1] : y); hi = Math.max(hi, y, Math.abs(dx) < 1e-12 ? b[1] : y);
      }
    }
    return [lo, hi];
  }
  const rot2 = (poly, a, cx, cy) => { const c = Math.cos(a), s = Math.sin(a); return poly.map(p => { const x = p[0] - cx, y = p[1] - cy; return [cx + x * c - y * s, cy + x * s + y * c]; }); };
  const shift2 = (poly, dx, dy) => poly.map(p => [p[0] + dx, p[1] + dy]);

  // Inverted high-lift section, LE at the origin, chord towards -X, trailing edge raised by `pitchDeg`.
  function foil(G, o) {
    const base = G.naca4(o.chord, o.m, o.p, o.t, o.points || 96, { teThickness: o.te || 0 });
    const p180 = base.map(p => [-p[0], -p[1]]);                  // 180 deg about Z: convex side down, LE stays at origin, keeps CCW winding
    return rot2(p180, -o.pitchDeg * DEG, 0, 0);                   // TE up
  }

  // Polygon with per-corner radii from a list of [x, y, r]
  function roundedPoly(G, list, seg) { return G.roundPolygon(list.map(v => [v[0], v[1]]), list.map(v => v[2] || 0), seg || 8); }

  // ---- layout ---------------------------------------------------------------------------------------------------
  function layout(G) {
    const L = {};
    L.leX = -1.858; L.chordMain = 0.35; L.chordFlap = 0.24;
    L.pitchMain = 6.5; L.pitchFlap0 = 3.0;                       // degrees, TE up
    const main0 = foil(G, { chord: L.chordMain, m: 0.042, p: 0.40, t: 0.156, te: 0.012, pitchDeg: L.pitchMain });
    const flapRel0 = foil(G, { chord: L.chordFlap, m: 0.052, p: 0.5, t: 0.118, te: 0.014, pitchDeg: L.pitchFlap0 });
    // flap LE (in main-LE-relative coordinates): 0.19 m behind the main LE; vertical offset from the slot gap rule
    const fx = -0.222, gap = 0.016;
    let dy = -Infinity;
    const x0 = fx - 0.001, x1 = Math.min(fx - 0.19 - 0.0, -L.chordMain * Math.cos(L.pitchMain * DEG)) + 0.0;
    for (let x = fx; x >= Math.max(x1, fx - 0.11) - 1e-9; x -= 0.002) {
      const mh = vHits(main0, x), fh = vHits(flapRel0, x - fx);
      if (isFinite(mh[1]) && isFinite(fh[0])) dy = Math.max(dy, mh[1] + gap - fh[0]);
    }
    L.gap = gap;
    let mainLowest = Infinity, wingTop = -Infinity;
    for (const p of main0) mainLowest = Math.min(mainLowest, p[1]);
    for (const p of flapRel0) wingTop = Math.max(wingTop, p[1] + dy);
    // shift everything so that the flat-flap wing top is exactly spec top (1.322)
    const shiftY = A.topY - 0.009 - wingTop;      // gurney (9 mm) brings the total to the official 1.322
    L.shiftY = shiftY;
    L.main = shift2(main0, L.leX, shiftY);
    L.flap = shift2(flapRel0, L.leX + fx, dy + shiftY);
    L.mainUnderY = mainLowest + shiftY;
    L.wingTop = A.topY;
    L.flapLE = [L.leX + fx, dy + shiftY];                        // flap leading-edge point
    // hinge: on the flap camber line 5 % chord behind its LE
    const hx = L.flapLE[0] - 0.012, fh = vHits(L.flap, hx);
    L.hinge = [hx, (fh[0] + fh[1]) / 2];
    L.mainUpper = x => vHits(L.main, x)[1]; L.mainLower = x => vHits(L.main, x)[0];
    L.flapUpper = x => vHits(L.flap, x)[1]; L.flapLower = x => vHits(L.flap, x)[0];
    let teX = Infinity, teY = 0; for (const p of L.flap) if (p[0] < teX) { teX = p[0]; }
    const th = vHits(L.flap, teX + 1e-4); L.flapTE = [teX, (th[0] + th[1]) / 2, th[1]];
    let mte = Infinity; for (const p of L.main) mte = Math.min(mte, p[0]); L.mainTEx = mte;
    L.zIn = A.endplateZ - 0.013;                                 // inner face of the endplate
    return L;
  }

  // ---- gurney (thin lip on the flap trailing edge), built in car space at drs=0 ------------------------------------------
  function gurneyPoly(L) {
    const te = L.flapTE, ang = -L.pitchFlap0 * DEG;
    // small L: vertical strip 3.5 mm thick, 11 mm tall standing on the upper surface at the trailing edge
    const x = te[0], y = te[2];
    return [[x + 0.0035, y - 0.004], [x + 0.0035, y + 0.009], [x, y + 0.009], [x, y - 0.004]].map(p => p);
  }

  // ---- endplate outline (right side; the mirror gets it via mirrorZ) --------------------------------------------------------------
  const EP = { xf: -1.800, xtf: -1.835, xr: -2.322, xrB: -2.298, yTopF: 1.262, yTopR: 1.333, yBotF: 1.130, yBotR: 1.000 };
  const epTop = x => { const t = (x - EP.xtf) / (EP.xr - EP.xtf); return EP.yTopF + (EP.yTopR - EP.yTopF) * t + 0.010 * Math.sin(Math.PI * t); };
  const epBot = x => { const t = (x - EP.xf) / (EP.xrB - EP.xf); return EP.yBotF + (EP.yBotR - EP.yBotF) * t - 0.012 * Math.sin(Math.PI * t); };
  function endplateOutline(G, L) {
    const list = [], N = 18;
    for (let i = 0; i <= N; i++) { const x = EP.xf + (EP.xrB - EP.xf) * i / N; list.push([x, epBot(x), i === 0 ? 0.045 : i === N ? 0.032 : 0]); }
    for (let i = N; i >= 0; i--) { const x = EP.xtf + (EP.xr - EP.xtf) * i / N; list.push([x, epTop(x), i === N ? 0.030 : i === 0 ? 0.040 : 0]); }
    return roundedPoly(G, list, 6);
  }
  function endplateHoles(G, L) {
    // one long louvre-like slot parallel to the top edge, and a short one below the wing
    const holes = [];
    const stad = (x0, x1, off, w) => {
      const y0 = epBot(x0) + off, y1 = epBot(x1) + off, len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
      const poly = G.shapes.slot(len, w, 8), c = Math.cos(a), sn = Math.sin(a);
      return poly.map(p => [(x0 + x1) / 2 + p[0] * c - p[1] * sn, (y0 + y1) / 2 + p[0] * sn + p[1] * c]);
    };
    return holes;                                                // (louvre slot removed: not on the real plate, and it showed the body through it)
  }

  // ---- swan neck upright ------------------------------------------------------------------------------------------------
  // Rises from the engine lid AHEAD of the wing's leading edge, arcs rearwards over the leading edge and lands, tapering, on the
  // TOP surface of the main element (the underside stays clean).  Cross-section: ellipse, a = in-plane half width, b = half thickness (Z).
  function upright(G, L, zc, lidY) {
    const fx = L.leX + 0.045;                                     // foot centre x (ahead of the wing leading edge)
    const yF = lidY - 0.03;                                       // starts below the lid surface (hidden)
    const cx = L.leX - 0.070, yTopC = Math.min(L.mainUpper(cx) + 0.034, A.topY - 0.006 - 0.030), yA = yTopC - 0.12, rx = fx - cx, ry = yTopC - yA;
    // clean C1 path: straight vertical run, ONE quarter-ellipse arc, then a smooth landing run onto the main element (no mid control points => no knees)
    const pts = [], phase = [];
    for (let k = 0; k <= 8; k++) { pts.push([fx, yF + (yA - yF) * k / 8]); phase.push(0); }
    for (let k = 1; k <= 14; k++) { const th = k / 14 * Math.PI / 2; pts.push([cx + rx * Math.cos(th), yA + ry * Math.sin(th)]); phase.push(1); }
    const xEnd = L.leX - 0.255, yEnd = L.mainUpper(xEnd) - 0.003;
    for (let k = 1; k <= 10; k++) { const t = k / 10, x = cx + (xEnd - cx) * t; pts.push([x, yTopC + (yEnd - yTopC) * t * t * (3 - 2 * t)]); phase.push(2); }
    const n = pts.length, rings = [], RS = 40;
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const i2 = phase.indexOf(2), sL = cum[i2 - 1], lenL = cum[n - 1] - sL;
    // smoothed tangents (avoid the kink at phase joins)
    const tan = [];
    for (let i = 0; i < n; i++) {
      const a0 = pts[Math.max(0, i - 2)], a1 = pts[Math.min(n - 1, i + 2)];
      let tx = a1[0] - a0[0], ty = a1[1] - a0[1]; const tl = Math.hypot(tx, ty); tan.push([tx / tl, ty / tl]);
    }
    const EXP = 2.5;                                              // superellipse exponent: flat-sided blade with rounded edges
    const sp = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    for (let i = 0; i < n; i++) {
      const tx = tan[i][0], ty = tan[i][1], nx = -ty, ny = tx;
      const yAbove = pts[i][1] - lidY, fil = Math.exp(-Math.max(0, yAbove) / 0.010);      // slim pad flare where it meets the lid
      const land = sm(0.25, 1.0, Math.max(0, cum[i] - sL) / lenL);                        // taper while landing on the wing
      const arc = phase[i] === 0 ? 0 : phase[i] === 1 ? sm(0, 1, (cum[i] - cum[8]) / (sL - cum[8])) : 1;   // 0 on the straight, 1 at the crest
      const a = (0.056 - 0.026 * arc + 0.010 * fil) * (1 - 0.62 * land);                  // in-plane half chord: fat blade below, thin over the crest
      const b = (0.026 + 0.004 * fil) * (1 + 0.20 * land);                                // half thickness across the car (z): landing pad widens
      const ring = [];
      for (let k = 0; k < RS; k++) {
        const ph = k / RS * Math.PI * 2, ca = Math.cos(ph), sa = Math.sin(ph);
        const ex = sp(ca, EXP), ez = sp(sa, EXP) * (1 - 0.22 * sm(-0.1, 1.0, ca));        // slimmer trailing edge
        ring.push([pts[i][0] + nx * a * ex, pts[i][1] + ny * a * ex, zc + b * ez]);
      }
      rings.push(ring);
    }
    return G.loft(rings, { closed: true, caps: true, crease: 100 });
  }

  // ---- everything ---------------------------------------------------------------------------------------------------------
  PG.aeroWingGeo = function (G, U) {
    U = U || {};
    const L = layout(G);
    const out = { layout: L };
    const zIn = L.zIn, span = 2 * (zIn + 0.006);                  // main/flap run slightly into the endplates
    const flapSpan = 2 * (zIn - 0.004);                           // flap keeps a 4 mm clearance to the endplates (it rotates)
    // main element and flap: extruded airfoils spanning z (centred)
    out.main = G.extrudeAirfoil(L.main, span, { center: true, segments: 2, caps: true, uvScale: 1 });
    // trim the main element to the actual end (caps are flat & buried in the endplates)
    out.flap = G.merge([G.extrudeAirfoil(L.flap, flapSpan, { center: true, segments: 2, caps: true }),
      G.translate(G.extrude(gurneyPoly(L), flapSpan - 0.002, { center: true, bevel: { size: 0.0009, depth: 0.0009, segments: 2 } }), 0, 0, 0)]);
    // gurney extrusion runs along +Z already; extrude(...center) is centred on z=0
    // endplates (right side, then mirrored)
    const ep = G.extrude(endplateOutline(G, L), 0.013, { bevel: { size: 0.0045, depth: 0.0045, segments: 3 }, holes: endplateHoles(G, L) });
    const epR = G.translate(ep, 0, 0, zIn);
    out.endplates = G.merge([epR, G.mirrorZ(epR)]);
    // uprights
    const lid = U.lidY || (() => A.footY);
    const up = [];
    for (const s of [1, -1]) { const zc = s * A.strutZ, y = lid(L.leX + 0.012, zc); up.push(upright(G, L, zc, y == null ? A.footY : y)); }
    out.uprights = G.merge(up);
    return out;
  };

  // ---- hinge pylons (static, on the main element, standing in the slot up to the flap hinge line) ---------------------------------
  function pylons(G, L, zs) {
    const list = [];
    const yTopMain = L.mainUpper(L.hinge[0]), yb = yTopMain - 0.008, yt = L.hinge[1] + 0.0015, NL = 12;
    for (const z of zs) {
      // lofted teardrop (blunt nose forward, pointed tail rearwards) that flares into a small fillet where it meets the main plane
      const rings = [];
      for (let k = 0; k <= NL; k++) {
        const y = yb + (yt - yb) * k / NL, fl = 1 + 1.6 * Math.exp(-Math.max(0, y - yTopMain) / 0.0042), ring = [];
        const taper = 1 - 0.18 * Math.pow(k / NL, 2);
        for (let q = 0; q < 24; q++) {
          const a = q / 24 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
          const px = 0.016 * c * (c < 0 ? 2.4 : 1), pz = 0.0100 * sn * (c < 0 ? 1 - 0.6 * c * c : 1);
          ring.push([L.hinge[0] + 0.005 + px * fl * taper, y, z + pz * fl * taper]);
        }
        rings.push(ring);
      }
      list.push(G.loft(rings, { closed: true, caps: true, crease: 60 }));
    }
    return G.merge(list);
  }
  const _wingGeo = PG.aeroWingGeo;
  PG.aeroWingGeo = function (G, U) {
    const out = _wingGeo(G, U), L = out.layout;
    out.hinges = pylons(G, L, [-0.50, 0.50]);
    // hydraulic rams (2 per side) between the main-element top surface and clevis brackets under the flap
    const zr = [-0.22, 0.22], m4 = PG.m4;
    const bx = L.flapLE[0] - 0.052, fxp = bx - 0.034;
    L.ram = { B: [bx, L.mainUpper(bx) + 0.0015], F0: [fxp, L.flapLower(fxp) - 0.0012] };
    const cyl = (r, len, z) => G.transform(G.cylinder(r, r, len, 18, 1, { caps: true }), m4.translation(0, len / 2, z));
    const knob = (r, z) => G.translate(G.sphere(r, 14, 10), 0, 0, z);
    out.ramBody = G.merge(zr.map(z => G.merge([cyl(0.0110, 0.038, z), knob(0.0110, z), cyl(0.0140, 0.010, z)])));
    out.ramRod = G.merge(zr.map(z => G.merge([cyl(0.0060, 0.042, z), knob(0.0075, z)])));
    // clevis brackets: two small tear-shaped cheek plates either side of the rod eye, bonded into the flap underside
    const fx0 = L.ram.F0[0], fy0 = L.ram.F0[1];
    const plate = G.extrude(G.roundPolygon([[-0.013, 0.012], [0.013, 0.012], [0.007, -0.0055], [0, -0.0125], [-0.007, -0.0055]], [0.002, 0.002, 0.004, 0.005, 0.004], 4), 0.0032, { center: true, bevel: { size: 0.0006, depth: 0.0006, segments: 1 } });
    const pinT = G.cylinder(0.0028, 0.0028, 0.021, 12, 1, { axis: 'z' });
    out.flapTabs = G.merge(zr.map(z => G.merge([G.translate(plate, fx0, fy0, z + 0.0068), G.translate(plate, fx0, fy0, z - 0.0068)])));
    return out;
  };
})();
