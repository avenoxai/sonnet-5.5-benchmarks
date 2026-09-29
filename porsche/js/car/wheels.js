'use strict';
// car/wheels.js - four complete, procedural wheel assemblies for the 911 GT3 RS (order 20).
//
// PUBLIC API
//   ctx.shared.wheels = { front:{cfg,brake,susp,meshes}, rear:{...}, parts:{FL:{...},FR,RL,RR}, mats, stats, clearance }
//   Part hierarchy per wheel (tag = FL FR RL RR; all names start with 'wheel_'):
//     wheel_<tag>            frame at the wheel centre PG.spec.wheelCenter(axle, side) (static, follows the body)
//       wheel_<tag>_arms     static suspension (wishbones / multilink, coil-over, tie-rod inner end)       [not steered]
//       wheel_<tag>_rod      tie rod (front only), matrix updated every frame                              [not steered]
//       wheel_<tag>_steer    yaw about the vertical axis through the wheel centre = PG.state.steer (front only, smoothed)
//         wheel_<tag>_hub      upright / hub carrier, dust shield, brake hose, (rear: drive-shaft + CV boot)
//         wheel_<tag>_caliper  monobloc caliper (does not spin)
//         wheel_<tag>_orient   left wheels: rotated 180 deg about Y so that the right-wheel meshes read correctly outward
//           wheel_<tag>_spin     rotation about the axle (integrated from PG.state.spin)
//             wheel_<tag>_tire / _rim / _nut / _disc / _hw (valve stem + balance weights)
//   PG.state keys used: spin (0..1 -> 0..22 m/s road speed), steer (radians, +left turn, clamped +-0.5, front wheels only).
//   Visual wheel speed: omega = v / r, softly saturated at ~12 rad/s (about 2 rev/s) so that frame-rate aliasing never shows.
(function () {
  const PG = window.PG;
  (function () {
    const cs = document.currentScript, base = cs && cs.src ? cs.src.replace(/wheels\.js(\?.*)?$/, '') : 'js/car/';
    for (const f of ['wheels_rim.js', 'wheels_tyre.js', 'wheels_brake.js', 'wheels_susp.js']) document.write('<script src="' + base + f + '"><\/script>');
  })();

  function texFromCanvas(gl, cv, opts) {
    opts = opts || {};
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.repeatS ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
  PG.wheelsParts = PG.wheelsParts || {};
  PG.wheelsParts.texFromCanvas = texFromCanvas;

  PG.registerModule({
    name: 'wheels', order: 20,
    async build(ctx) {
      const { renderer, geo: g, m4, spec } = ctx, P = PG.wheelsParts, gl = ctx.gl;
      const t0 = performance.now();
      const stats = { ms: {}, tris: {} };
      const tri = m => (m.triCount !== undefined ? m.triCount : (m.count / 3));
      const mats = {
        rim: PG.mats.wheel.derive({ name: 'wheel_rim', hook: P.rimHook }),
        nut: PG.mats.plasticBlack.derive({ name: 'wheel_nut', baseColor: PG.util.hex('#0d0d0f'), metallic: 0.55, roughness: 0.42, specular: 0.5, hook: P.nutHook, uniforms: { uBadge: texFromCanvas(gl, P.rsBadgeCanvas()) } }),
        hw: PG.mats.plasticBlack.derive({ name: 'wheel_hw', hook: P.hwHook }),
        susp: PG.mats.plasticBlack.derive({ name: 'wheel_susp', hook: P.suspHook }),
      };
      const axles = {};
      for (const axle of ['front', 'rear']) {
        const A = axles[axle] = { cfg: P.rimCfg(axle) };
        const ta = performance.now();
        ctx.progress('wheel ' + axle, axle === 'front' ? 0.1 : 0.55);
        const rim = await P.buildRim(ctx, axle);
        A.rim = renderer.upload(rim);
        A.nut = renderer.upload(await P.buildNut(ctx, axle));
        A.hw = renderer.upload(P.buildRimHardware(ctx, axle));
        const tyre = P.buildTyre(ctx, axle); A.tyre = renderer.upload(tyre); A.tyreZ = g.bounds(tyre).max[2];
        const at = P.tyreAtlas(axle), tc = tyre.cfg;
        A.tyreMat = PG.mats.tire.derive({ name: 'wheel_tyre_' + axle, hook: P.tyreHook, uniforms: {
          uAtlas: texFromCanvas(gl, at.canvas, { repeatS: true }), uT: [tc.R, tc.rr, tc.treadFlat, tc.bandIn], uT2: [tc.bandOut, at.W, at.H, 0], uBlur: 0 } });
        const disc = P.buildDisc(ctx, axle); A.disc = renderer.upload(disc); A.brake = disc.cfg;
        A.discMat = PG.mats.discCeramic.derive({ name: 'wheel_disc_' + axle, hook: P.discHook, uniforms: { uBand: [disc.cfg.rin + 0.006, disc.cfg.R - 0.006] } });
        const cal = await P.buildCaliper(ctx, axle);
        A.calR = renderer.upload(cal); A.calL = renderer.upload(P.mirrorMesh(cal));
        const dec = P.caliperAtlas(axle), bc = disc.cfg;
        A.decalTex = texFromCanvas(gl, dec.canvas);
        const mkCalMat = side => PG.mats.caliper.derive({ name: 'wheel_caliper_' + axle + (side > 0 ? 'R' : 'L'), hook: P.caliperHook, uniforms: { uDecal: A.decalTex, uC: [bc.phi, bc.halfArc, bc.R, side], uC2: [dec.rIn, dec.rTop, dec.arcLen, 0] } });
        A.calMatR = mkCalMat(1); A.calMatL = mkCalMat(-1);
        const su = await P.buildSuspension(ctx, axle);
        A.susp = su.cfg;
        A.hubR = renderer.upload(su.hub); A.hubL = renderer.upload(P.mirrorMesh(su.hub));
        A.armsR = renderer.upload(su.arms); A.armsL = renderer.upload(P.mirrorMesh(su.arms));
        A.rod = su.rod ? renderer.upload(su.rod) : null;
        stats.ms[axle] = Math.round(performance.now() - ta);
        stats.tris[axle] = { rim: tri(A.rim), tyre: tri(A.tyre), nut: tri(A.nut), hw: tri(A.hw), disc: tri(A.disc), caliper: tri(A.calR), hub: tri(A.hubR), arms: tri(A.armsR) };
        await PG.util.nextFrame();
      }

      const defs = [['FL', 'front', -1], ['FR', 'front', 1], ['RL', 'rear', -1], ['RR', 'rear', 1]];
      const W = [], parts = {};
      let total = 0;
      for (const [tag, axle, side] of defs) {
        const A = axles[axle], c = spec.wheelCenter(axle, side), S = A.susp;
        const N = 'wheel_' + tag;
        const frame = ctx.add({ name: N, mesh: null, matrix: m4.translation(c[0], c[1], c[2]) });
        const arms = ctx.add({ castShadow: false, name: N + '_arms', mesh: side > 0 ? A.armsR : A.armsL, material: mats.susp, parent: frame, reflect: false });
        const steer = ctx.add({ name: N + '_steer', mesh: null, parent: frame });
        const hub = ctx.add({ castShadow: false, name: N + '_hub', mesh: side > 0 ? A.hubR : A.hubL, material: mats.susp, parent: steer, reflect: false });
        const caliper = ctx.add({ castShadow: false, name: N + '_caliper', mesh: side > 0 ? A.calR : A.calL, material: side > 0 ? A.calMatR : A.calMatL, parent: steer, reflect: false });
        const orient = ctx.add({ name: N + '_orient', mesh: null, parent: steer, matrix: side < 0 ? m4.rotationY(Math.PI) : m4.identity() });
        const spin = ctx.add({ name: N + '_spin', mesh: null, parent: orient });
        const tire = ctx.add({ name: N + '_tire', mesh: A.tyre, material: A.tyreMat, parent: spin });
        const rim = ctx.add({ castShadow: false, name: N + '_rim', mesh: A.rim, material: mats.rim, parent: spin });
        const nut = ctx.add({ castShadow: false, name: N + '_nut', mesh: A.nut, material: mats.nut, parent: spin, reflect: false });
        const disc = ctx.add({ castShadow: false, name: N + '_disc', mesh: A.disc, material: A.discMat, parent: spin, reflect: false });
        const hw = ctx.add({ castShadow: false, name: N + '_hw', mesh: A.hw, material: mats.hw, parent: spin, reflect: false });
        let rod = null;
        if (A.rod) rod = ctx.add({ castShadow: false, name: N + '_rod', mesh: A.rod, material: mats.susp, parent: frame, reflect: false });
        const rec = { tag, axle, side, radius: spec.wheel[axle].tireRadius, angle: 0, frame, arms, steer, hub, caliper, orient, spin, tire, rim, nut, disc, hw, rod, S };
        W.push(rec); parts[tag] = rec;
        total += tri(A.rim) + tri(A.tyre) + tri(A.nut) + tri(A.disc) + tri(A.hw) + tri(A.calR) + tri(A.hubR) + tri(A.armsR) + (A.rod ? tri(A.rod) : 0);
      }

      // ------------------------------------------------------------------------------------------ animation
      const OMEGA_MAX = 12, MAX_STEER = 0.5;
      let steerS = 0;
      const setRod = (rec, delta) => {
        const S = rec.S, side = rec.side, cs = Math.cos(delta), sn = Math.sin(delta);
        const Pin = [S.rodIn[0], S.rodIn[1], side * S.rodIn[2]];
        const q0 = [S.steerArm[0], S.steerArm[1], side * S.steerArm[2]];
        const M = P.steerMatrix(S, side, delta);
        const Q = [M[0] * q0[0] + M[4] * q0[1] + M[8] * q0[2] + M[12], M[1] * q0[0] + M[5] * q0[1] + M[9] * q0[2] + M[13], M[2] * q0[0] + M[6] * q0[1] + M[10] * q0[2] + M[14]];
        const d = [Q[0] - Pin[0], Q[1] - Pin[1], Q[2] - Pin[2]], L = Math.hypot(d[0], d[1], d[2]);
        const e1 = [d[0] / L, d[1] / L, d[2] / L];
        let e2 = [-e1[2], 0, e1[0]];                                   // cross(e1, +Y)
        const l2 = Math.hypot(e2[0], e2[2]) || 1; e2 = [e2[0] / l2, 0, e2[2] / l2];
        const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const m = rec.rod.matrix || (rec.rod.matrix = new Float32Array(16));
        m[0] = e1[0] * L; m[1] = e1[1] * L; m[2] = e1[2] * L; m[3] = 0;
        m[4] = e2[0]; m[5] = e2[1]; m[6] = e2[2]; m[7] = 0;
        m[8] = e3[0]; m[9] = e3[1]; m[10] = e3[2]; m[11] = 0;
        m[12] = Pin[0]; m[13] = Pin[1]; m[14] = Pin[2]; m[15] = 1;
      };
      const update = (dt, time, st) => {
        dt = Math.min(dt, 0.1);
        const target = Math.max(-MAX_STEER, Math.min(MAX_STEER, +st.steer || 0));
        steerS += (target - steerS) * (1 - Math.exp(-dt * 12));
        if (Math.abs(target - steerS) < 1e-5) steerS = target;
        const v = 22 * Math.max(0, Math.min(1, +st.spin || 0));
        let blur = 0;
        for (const w of W) {
          const om = v / w.radius, ov = OMEGA_MAX * Math.tanh(om / OMEGA_MAX);
          w.angle -= w.side * ov * dt;
          if (w.angle > 1e3 || w.angle < -1e3) w.angle %= (Math.PI * 2);
          w.spin.matrix = m4.rotationZ(w.angle);
          if (w.axle === 'front') {
            w.steer.matrix = P.steerMatrix(w.S, w.side, steerS);
            if (w.rod) setRod(w, steerS);
          }
          blur = Math.max(blur, ov);
        }
        const b = Math.min(1, Math.max(0, (blur - 5) / 10)) * 0.55;
        axles.front.tyreMat.uniforms.uBlur = b; axles.rear.tyreMat.uniforms.uBlur = b;
      };
      for (const w of W) { w.steer.matrix = P.steerMatrix(w.S, w.side, 0); if (w.rod) setRod(w, 0); }
      ctx.onUpdate(update);

      ctx.shared.wheels = {
        front: { cfg: axles.front.cfg, brake: axles.front.brake, susp: axles.front.susp, meshes: axles.front },
        rear: { cfg: axles.rear.cfg, brake: axles.rear.brake, susp: axles.rear.susp, meshes: axles.rear },
        parts, mats, stats: { ms: stats.ms, tris: stats.tris, totalTris: total },
        // tyre outer radius and outer bulge |z| per axle, for arch clearance checks in other modules
        clearance: { front: { R: spec.wheel.front.tireRadius, outerZ: spec.wheel.front.track / 2 + axles.front.tyreZ }, rear: { R: spec.wheel.rear.tireRadius, outerZ: spec.wheel.rear.track / 2 + axles.rear.tyreZ } },
      };
      PG.log && PG.log('[wheels] built in ' + (performance.now() - t0).toFixed(0) + ' ms; tris/car ' + total + ' ' + JSON.stringify(stats.tris));
    },
  });
})();
