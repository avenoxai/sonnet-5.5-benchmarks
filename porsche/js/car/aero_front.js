'use strict';
// car/aero_front.js — front splitter, side blades (dive fins), active front flaps, tow-hook cap.   PG.aeroFront(K)
(function () {
  const PG = window.PG, spec = PG.spec, DEG = Math.PI / 180;

  // plan plate: polygon in (x, z) plan coordinates -> horizontal slab, top face at y = yTop, thickness t (bevelled)
  function planPlate(G, m4, poly, yTop, t, bevel, holes) {
    const e = G.extrude(poly, t, { bevel: { size: bevel, depth: bevel, segments: 3 }, holes: holes || [] });   // poly (px, py), z 0..t
    return G.transform(e, m4.multiply(m4.translation(0, yTop, 0), m4.rotationX(Math.PI / 2)));             // (px,py,ez) -> (px, -ez, py)
  }
  PG.aeroPlanPlate = planPlate;

  const SPLITTER_HOOK = `
void surfaceHook(inout Surf s, in Frag f) {
  vec3 n = normalize(f.nObj);
  float top = smoothstep(-0.05, 0.45, n.y);              // carbon weave on the upward faces, matte black underneath
  vec3 nn = normalize(f.nObj);
  s.baseColor = mix(vec3(0.010, 0.010, 0.011), s.baseColor, top);
  s.normal = normalize(mix(nn, s.normal, top));
  s.roughness = mix(0.88, s.roughness, top);
  s.clearcoat = s.clearcoat * top; s.specular = mix(0.22, s.specular, top); s.ao = mix(1.0, s.ao, top);
}`;

  PG.aeroFront = function (K) {
    const { G, m4, ctx } = K;
    const info = K.info = K.info || {};
    // ---- measured body corner (falls back to the spec plan half-width)
    const bodyHw = K.side(2.0, 0.22) || spec.halfWidthAt(2.0);
    const zEnd = Math.min(0.898, Math.max(0.86, bodyHw + 0.035));
    info.zEnd = zEnd;

    // ---- splitter -------------------------------------------------------------------------------------------------------
    let faceX = null; if (K.rc) { const h = K.rc.cast([3.2, 0.32, 0.0], [-1, 0, 0]); if (h) faceX = h.point[0]; }
    const xN = Math.max(spec.noseX, faceX == null ? 0 : faceX + 0.03), xR = 1.70, N = 26, right = [];
    info.noseFaceX = faceX; info.splitterFrontX = xN;
    for (let i = 0; i <= N; i++) { const z = zEnd * i / N; right.push([xN - 0.312 * Math.pow(z / zEnd, 3.0) - 0.0 * z, z, 0]); }
    right[right.length - 1][2] = 0.022;                              // outer front corner
    right.push([xR, zEnd, 0.03]);                                    // rear outer corner
    const ring = [];                                                 // full outline, CCW seen from above (+y): x forward, z right
    for (let i = right.length - 1; i >= 1; i--) ring.push([right[i][0], -right[i][1], right[i][2]]);   // left side, rear -> front
    for (let i = 0; i < right.length; i++) ring.push([right[i][0], right[i][1], right[i][2]]);
    // polygon coordinates (px = x, py = z); order does not matter for extrude, but roundPolygon needs consistent radii list
    const outline = G.roundPolygon(ring.map(p => [p[0], p[1]]), ring.map(p => p[2]), 6);
    const yTop = spec.splitterY + 0.019;
    const splitter = planPlate(G, m4, outline, yTop, 0.019, 0.0065);
    const matSplit = PG.mats.carbonMatte.derive({ name: 'splitterCarbon', patternScale: 270, roughness: 0.46, clearcoat: 0.55, clearcoatRoughness: 0.34, hook: SPLITTER_HOOK });
    K.addMesh('splitter_plate', splitter, matSplit);
    info.splitterTop = yTop;

    // ---- side blades / dive fins at the outer ends: vertical plates standing on the splitter --------------------------
    // The blade stands fully ON the plate: its outer face sits 12 mm inboard of the plate edge and its leading tip is 30 mm behind the plate's
    // curved front edge at that z, so nothing overhangs.  (plan edge: x = xN - 0.312 (z/zEnd)^3)
    const zb = zEnd - 0.012 - 0.0085, edgeX = xN - 0.312 * Math.pow((zb + 0.0085) / zEnd, 3.0), xf = edgeX - 0.034;
    const fin = [[xf, yTop - 0.004], [xf - 0.010, yTop + 0.020], [xf - 0.105, yTop + 0.092], [xf - 0.178, yTop + 0.100], [xf - 0.196, yTop + 0.050], [xf - 0.204, yTop - 0.004]];
    const finPoly = G.roundPolygon(fin, [0.008, 0.005, 0.018, 0.014, 0.008, 0.006], 5);
    let fr = G.extrude(finPoly, 0.0085, { bevel: { size: 0.0025, depth: 0.0025, segments: 3 } });
    fr = G.translate(fr, 0, 0, zb);
    K.addMesh('splitter_blades', G.merge([fr, G.mirrorZ(fr)]), PG.mats.carbonMatte.derive({ name: 'splitterBlade', patternScale: 300, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3 }));

    // ---- active front flaps: two cassettes in the outer bumper corners (each: bezel, dark pocket, main blade + smaller upper blade) --------
    flaps(K, info);
    towCap(K);
  };

  // local unit frame: X = along the skin towards the car centre, Y = up, Z = outward plan normal.  Units are built for the RIGHT side,
  // the LEFT side gets X-mirrored local meshes.
  function unitFrame(nx, nz, px, py, pz, side) {
    const m = PG.m4.identity();
    // right: X=(nz,0,-nx) Z=(nx,0,nz);  left (n=(nx,-nz)): X=(-nz,0,-nx) Z=(nx,0,-nz)
    if (side > 0) { m[0] = nz; m[2] = -nx; m[8] = nx; m[10] = nz; } else { m[0] = -nz; m[2] = -nx; m[8] = nx; m[10] = -nz; }
    m[12] = px; m[13] = py; m[14] = pz; return m;
  }

  function flaps(K, info) {
    const { G, m4, ctx } = K, rc = K.rc;
    const W = 0.335, Hh = 0.150;                                    // opening width (along the skin) and height
    // locate the outer corner skin: cast from outside towards the body
    let P = [2.06, 0.245, 0.72], n = [0.80, 0.60];
    if (rc) {
      const g = [0.62, 0.78], gl = Math.hypot(g[0], g[1]);
      const c = [2.06, 0.245, 0.72], o = [c[0] + g[0] / gl * 0.5, c[1], c[2] + g[1] / gl * 0.5];
      const h = rc.cast(o, [-g[0] / gl, 0, -g[1] / gl]);
      if (h) { info.flapHit = true; P = h.point; const l = Math.hypot(h.normal[0], h.normal[2]) || 1; n = [h.normal[0] / l, h.normal[2] / l]; }
    }
    if (rc && !info.flapHit) { info.flapSkin = null; return; }      // nothing found at the corner: do not float a cassette in mid-air
    info.flapSkin = { P, n };
    // ---- skin sampling: offset of the body surface along the unit's local Z on a (w, v) grid, so the dark patch and the fences hug the bumper
    const Wp = W + 0.030, Hp = Hh + 0.030, NW = 17, NV = 9;
    const Xw = [n[1], 0, -n[0]], Zw = [n[0], 0, n[1]];               // world axes of the (right) unit frame
    const zoff = [], rawHits = [];
    for (let a = 0; a < NW; a++) { zoff.push([]); for (let b = 0; b < NV; b++) {
      let z = null;
      if (rc) {
        const w = (a / (NW - 1) - 0.5) * Wp, v = (b / (NV - 1) - 0.5) * Hp;
        const o = [P[0] + Xw[0] * w + Zw[0] * 0.30, P[1] + v, P[2] + Xw[2] * w + Zw[2] * 0.30];
        const h = rc.cast(o, [-Zw[0], 0, -Zw[2]]);
        if (h && h.t > 0.16 && h.t < 0.44) { z = 0.30 - h.t; rawHits.push(z); }     // plausible skin hit only (a far-flank hit is a miss)
      }
      zoff[a].push(z);
    } }
    rawHits.sort((p, q) => p - q);
    const zMed = rawHits.length ? rawHits[rawHits.length >> 1] : 0, zLo = zMed - 0.07, zHi = zMed + 0.07;
    for (let a = 0; a < NW; a++) for (let b = 0; b < NV; b++) if (zoff[a][b] != null && (zoff[a][b] < zLo || zoff[a][b] > zHi)) zoff[a][b] = null;
    for (let a = 0; a < NW; a++) for (let b = 0; b < NV; b++) if (zoff[a][b] == null) {          // fill misses from the nearest valid sample
      let best = null, bd = 1e9;
      for (let a2 = 0; a2 < NW; a2++) for (let b2 = 0; b2 < NV; b2++) if (zoff[a2][b2] != null) { const d = (a - a2) * (a - a2) + (b - b2) * (b - b2); if (d < bd) { bd = d; best = zoff[a2][b2]; } }
      zoff[a][b] = best == null ? zMed : best;
    }
    const zAt = (w, v) => {                                          // bilinear lookup
      const fa = Math.min(NW - 1, Math.max(0, (w / Wp + 0.5) * (NW - 1))), fb = Math.min(NV - 1, Math.max(0, (v / Hp + 0.5) * (NV - 1)));
      const a0 = Math.min(NW - 2, Math.floor(fa)), b0 = Math.min(NV - 2, Math.floor(fb)), ta = fa - a0, tb = fb - b0;
      return (zoff[a0][b0] * (1 - ta) + zoff[a0 + 1][b0] * ta) * (1 - tb) + (zoff[a0][b0 + 1] * (1 - ta) + zoff[a0 + 1][b0 + 1] * ta) * tb;
    };
    info.flapSkinOffsets = [zAt(-Wp / 2, 0), zAt(0, 0), zAt(Wp / 2, 0)];
    const zc = zAt(0, 0);
    // dark patch: squircle-shaped strip surface 2 mm proud of the skin
    const patch = G.grid(NW * 2, NV * 2, (u, v, out) => {
      let x = u * 2 - 1, y = v * 2 - 1;
      const sq = Math.max(Math.abs(x), Math.abs(y)), rho = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(y), 4), 0.25) || 1;
      x *= sq / rho; y *= sq / rho;
      const w = x * Wp / 2, vv = y * Hp / 2;
      return [w, vv, zAt(w, vv) + 0.0065];
    });
    // cheeks: small end fences perpendicular to the span (outline in (z,y), extruded along x), rooted in the skin
    const Wb = 0.285;                                                // blade/fence width: kept well inside the (larger) dark pocket so nothing overhangs the opening
    const PR = 0.024;                                                // blade leading-edge protrusion in front of the skin (at the centre)
    const cheeks = [];
    for (const sx of [-1, 1]) {
      const ze = zAt(sx * Wb / 2, 0), zb = ze - 0.010;                // fence height follows the skin at its own end
      const poly = G.roundPolygon([[zb, -0.074], [ze + 0.016, -0.066], [ze + PR + 0.004, -0.030], [ze + PR + 0.004, 0.050], [ze + 0.014, 0.076], [zb, 0.076]], [0.004, 0.006, 0.008, 0.008, 0.006, 0.004], 4);
      const cm = G.extrude(poly, 0.0045, { center: true, bevel: { size: 0.001, depth: 0.001, segments: 2 } });
      cheeks.push(G.transform(cm, m4.multiply(m4.translation(sx * (Wb / 2 - 0.003), 0, 0), m4.rotationY(-Math.PI / 2))));
    }
    // blades: thin symmetric section, LE at z = 0 chord along -z (into the skin), span along x
    const blade = (chord, thick, span) => {
      const prof = G.naca4(chord, 0, 0.4, thick / chord, 40, { teThickness: 0.02 });
      const e = G.extrudeAirfoil(prof, span, { center: true, segments: 1, caps: true });   // span z, chord +x, thickness y
      return G.transform(e, m4.rotationY(Math.PI / 2));                                   // span x, chord -z
    };
    const mainB = G.translate(blade(0.085, 0.013, Wb - 0.012), 0, -0.032, zc + PR), upB = G.translate(blade(0.052, 0.009, Wb - 0.012), 0, 0.040, zc + PR - 0.006);
    const pivMain = [-0.032, zc + PR - 0.034], pivUp = [0.040, zc + PR - 0.030];   // (y,z) pivot of the blades in unit-local space
    const matBlack = K.mats.satin, matBlade = PG.mats.carbonMatte.derive({ name: 'aeroFlapBlade', patternScale: 300, baseColor: [0.032, 0.032, 0.034], roughness: 0.42 });
    const matDark = K.mats.matte.derive({ name: 'aeroFlapPocket', baseColor: [0.012, 0.012, 0.013] });
    const flip = m => G.transform(m, m4.scaling(-1, 1, 1));
    const rotX = (piv, a) => m4.multiply(m4.translation(0, piv[0], piv[1]), m4.multiply(m4.rotationX(a), m4.translation(0, -piv[0], -piv[1])));
    const anim = [];
    for (const side of [1, -1]) {
      const f = side > 0 ? (m => m) : flip, tag = side > 0 ? 'R' : 'L';
      const grp = K.add({ name: 'aero_flap' + tag, mesh: null, matrix: unitFrame(n[0], n[1], P[0], P[1], side * P[2], side) });
      K.addMesh('aero_flap' + tag + '_pocket', f(patch), matDark.derive({ doubleSided: true }), { parent: grp, reflect: false });
      K.addMesh('aero_flap' + tag + '_cheeks', f(G.merge(cheeks)), matBlack, { parent: grp, reflect: false });
      const bm = K.addMesh('aero_flap' + tag + '_main', f(mainB), matBlade, { parent: grp, reflect: false });
      const bu = K.addMesh('aero_flap' + tag + '_upper', f(upB), matBlade, { parent: grp, reflect: false });
      anim.push(v => { bm.matrix = rotX(pivMain, -v * 72 * DEG); bu.matrix = rotX(pivUp, v * 42 * DEG); });
    }
    for (const a of anim) K.anim.push(a);
  }

  // tow-hook cap: small body-colour cap with a dark push-out slot, on the lower bumper face off-centre (right of the grille)
  function towCap(K) {
    const { G, m4, rc } = K;
    if (!rc) return;
    const h = rc.cast([3.0, 0.185, 0.36], [-1, 0, 0]);
    if (!h || h.normal[0] < 0.45) return;
    const N = h.normal, up = [0, 1, 0];
    let X = [N[2] * 0 - up[1] * 0, 0, 0];                            // X = normalize(up x N)
    X = [up[1] * N[2] - up[2] * N[1], up[2] * N[0] - up[0] * N[2], up[0] * N[1] - up[1] * N[0]];
    const xl = Math.hypot(X[0], X[1], X[2]); X = X.map(v => v / xl);
    const Y = [N[1] * X[2] - N[2] * X[1], N[2] * X[0] - N[0] * X[2], N[0] * X[1] - N[1] * X[0]];
    const m = m4.identity(); m[0] = X[0]; m[1] = X[1]; m[2] = X[2]; m[4] = Y[0]; m[5] = Y[1]; m[6] = Y[2]; m[8] = N[0]; m[9] = N[1]; m[10] = N[2];
    m[12] = h.point[0] + N[0] * 0.0006; m[13] = h.point[1] + N[1] * 0.0006; m[14] = h.point[2] + N[2] * 0.0006;
    const cap = G.extrude(G.shapes.roundRect(0.066, 0.046, 0.012, 5), 0.006, { center: true, bevel: { size: 0.0016, depth: 0.0016, segments: 2 } });
    const slot = G.extrude(G.shapes.roundRect(0.040, 0.008, 0.004, 4), 0.0012, { center: true });
    const grp = K.add({ name: 'aero_towCap', mesh: null, matrix: m });
    K.addMesh('aero_towCap_cap', G.translate(cap, 0, 0, -0.001), PG.mats.paint, { parent: grp, reflect: false });
    K.addMesh('aero_towCap_slot', G.translate(slot, 0, 0.004, 0.0028), K.mats.matte, { parent: grp, reflect: false });
  }
})();
