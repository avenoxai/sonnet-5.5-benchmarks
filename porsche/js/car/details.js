'use strict';
// car/details.js — DETAILS module (order 50): motorsport door mirrors, recessed door handles, twin centre exhaust tips.
// Parts: mirror_L/R_shell (follows the UI paint), mirror_L/R_glass, mirror_L/R_stalk, handle_L/R_*, exhaust_L/R.
// Everything is placed against the real body mesh through ctx.shared.body.raycaster when it exists (constants below are the fallback).
(function () {
  const PG = window.PG, G = PG.geo, m4 = PG.m4, v3 = PG.v3;

  // --------------------------------------------------------------------------- tunables (car space, +Z = right side)
  const MIRROR = { x: 0.535, dy: 0.088, z: 0.955, baseX: 0.665, baseZ: 0.880, yawDeg: -9 };
  const HANDLE = { x: -0.20, y: 0.925, len: 0.16 };
  const EXH = { x: -2.19, y: 0.36, z: 0.13, len: 0.16, r: 0.049 };

  // orthonormal frame at point p with outward normal n: local x -> car-forward tangent, local y -> up-ish, local z -> n
  function frame(p, n) {
    n = v3.normalize(n);
    const X = [1, 0, 0], d = v3.dot(X, n);
    const t = v3.normalize(v3.sub(X, v3.scale(n, d)));
    const u = v3.cross(n, t);
    const m = new Float32Array(16);
    m.set([t[0], t[1], t[2], 0, u[0], u[1], u[2], 0, n[0], n[1], n[2], 0, p[0], p[1], p[2], 1]);
    return m;
  }

  const both = (mesh) => G.merge([mesh, G.mirrorZ(mesh)]);          // right-side mesh -> right + mirrored left copy

  function buildMirror(yBase) {
    const yaw = m4.rotationY(MIRROR.yawDeg * Math.PI / 180);
    const C = [MIRROR.x, yBase + MIRROR.dy, MIRROR.z];
    const place = (mesh) => G.transform(G.transform(mesh, yaw), m4.translation(C));
    // housing: blunt-backed rounded box with a rounded nose
    const box = G.roundedBox(0.170, 0.098, 0.116, 0.038, 5);
    const nose = G.translate(G.ellipsoid(0.062, 0.049, 0.058, 28, 16), 0.082, 0, 0);
    const shell = place(G.merge([box, nose]));
    // mirror glass sits flush in the blunt rear face
    const glass = place(G.translate(G.roundedBox(0.004, 0.080, 0.096, 0.02, 3), -0.0865, 0, 0));
    // stalk (tapered tube from the door top to the housing) + base pad
    const B = [MIRROR.baseX, yBase, MIRROR.baseZ];
    const top = v3.add(C, [0.02, -0.040, -0.030]);
    const stalk = G.merge([
      G.tube([B, v3.lerp(B, top, 0.5), top], t => 0.0125 + 0.004 * (1 - t), { radialSegments: 14, caps: 'round' }),
      G.translate(G.roundedBox(0.100, 0.020, 0.052, 0.008, 3), B[0], B[1] + 0.004, B[2]),
    ]);
    return { shell, glass, stalk };
  }

  PG.registerModule({
    name: 'details', order: 50,
    async build(ctx) {
      const rc = ctx.shared.body && ctx.shared.body.raycaster;
      const mats = PG.mats;
      ctx.progress('details', 0.1);

      const mShell = mats.paint.derive({ name: 'mirror_shell' });
      const mGlass = mats.chrome.derive({ name: 'mirror_glass', baseColor: [0.62, 0.66, 0.70], roughness: 0.035 });
      const mBlack = mats.plasticGloss;
      const mPocket = mats.plasticBlack;
      const mHandle = mats.paint.derive({ name: 'handle_bar' });
      const mExh = mats.chrome.derive({ name: 'exhaust', baseColor: [0.06, 0.06, 0.07], metallic: 1, roughness: 0.30, doubleSided: true });

      // ---- door-top height under the mirror base (real body surface when available)
      let yBase = 0.975;
      if (rc) {
        const h = rc.heightAt(MIRROR.baseX, MIRROR.baseZ, 1.5);
        if (h != null && h > 0.85 && h < 1.15) yBase = h - 0.004;
      }
      const mir = buildMirror(yBase);
      ctx.add({ name: 'mirror_R_shell', mesh: mir.shell, material: mShell });
      ctx.add({ name: 'mirror_L_shell', mesh: G.mirrorZ(mir.shell), material: mShell });
      ctx.add({ name: 'mirror_R_glass', mesh: mir.glass, material: mGlass, castShadow: false });
      ctx.add({ name: 'mirror_L_glass', mesh: G.mirrorZ(mir.glass), material: mGlass, castShadow: false });
      ctx.add({ name: 'mirror_R_stalk', mesh: mir.stalk, material: mBlack });
      ctx.add({ name: 'mirror_L_stalk', mesh: G.mirrorZ(mir.stalk), material: mBlack });
      ctx.progress('details', 0.5);

      // ---- door handles: dark pocket + body-colour pull bar, oriented on the real door surface
      let hp = [HANDLE.x, HANDLE.y, 0.905], hn = [0, 0, 1];
      if (rc) {
        const hit = rc.cast([HANDLE.x, HANDLE.y, 1.4], [0, 0, -1]);
        if (hit) { hp = hit.point; hn = hit.normal; }
      }
      const F = frame(hp, hn);
      const pocket = G.transform(G.translate(G.roundedBox(HANDLE.len + 0.02, 0.048, 0.006, 0.014, 3), 0, 0, 0.0015), F);
      const bar = G.transform(G.translate(G.roundedBox(HANDLE.len - 0.02, 0.020, 0.014, 0.009, 3), 0.0, 0.004, 0.007), F);
      ctx.add({ name: 'handle_R_pocket', mesh: pocket, material: mPocket, castShadow: false });
      ctx.add({ name: 'handle_L_pocket', mesh: G.mirrorZ(pocket), material: mPocket, castShadow: false });
      ctx.add({ name: 'handle_R_bar', mesh: bar, material: mHandle, castShadow: false });
      ctx.add({ name: 'handle_L_bar', mesh: G.mirrorZ(bar), material: mHandle, castShadow: false });

      // ---- twin centre exhaust tips (black chrome), pointing rearwards (-X)
      const prof = [[EXH.r, 0], [EXH.r, EXH.len - 0.006], [EXH.r - 0.0015, EXH.len], [EXH.r - 0.0045, EXH.len - 0.004], [EXH.r - 0.0045, 0.03], [EXH.r * 0.55, 0.0]];
      const tip = G.lathe(prof, 40);
      const tipR = G.transform(tip, m4.chain(m4.translation(EXH.x, EXH.y, EXH.z), m4.rotationZ(Math.PI / 2 + 0.05)));
      ctx.add({ name: 'exhaust_R', mesh: tipR, material: mExh });
      ctx.add({ name: 'exhaust_L', mesh: G.mirrorZ(tipR), material: mExh });
      ctx.progress('details', 1);
    },
  });
})();
