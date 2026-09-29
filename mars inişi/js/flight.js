/* ============================================================================
 * flight.js — trajectory / attitude / event model (module 'flight')
 * The RDC (rover down-look camera) pose for t = 36..168.5 s comes from the bundle-adjusted poses reconstructed from the
 * video (assets/ba_poses.js); everything else (entry, chute, sky crane, debris, flyaway) is analytic. Pure function of t.
 * See _work/WORLD.md for frames. Schema: _work/ARCHITECTURE.md sec.4.
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util;

  EDL.registerModule('flight', function (ctx) {
    const T = C.t, K = C.world.mosaicScale, O = C.world.baOrigin;
    const V = THREE.Vector3, Q = THREE.Quaternion;
    const rows = EDL.data.baPoses || [];
    const N = rows.length;
    const qM = new Q(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);            // BA (Z-up) -> three (Y-up) frame rotation

    // ---- BA track -> world ------------------------------------------------------
    const bt = new Float64Array(N), bpos = new Float64Array(N * 3), bq = [];
    for (let i = 0; i < N; i++) {
      const r = rows[i];
      bt[i] = r[0];
      bpos[i * 3] = K * (r[2] - O[0]); bpos[i * 3 + 1] = K * r[1]; bpos[i * 3 + 2] = -K * (r[3] - O[1]);
      bq.push(new Q(r[4], r[5], r[6], r[7]).normalize());
    }
    const _q1 = new Q(), _q2 = new Q(), _v = new V(), _v2 = new V();
    function baAt(t, outPos, outQ) {
      let i = 0;
      if (t <= bt[0]) i = 0; else if (t >= bt[N - 1]) i = N - 2; else { let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bt[m] <= t) lo = m; else hi = m; } i = lo; }
      const u = U.clamp((t - bt[i]) / (bt[i + 1] - bt[i]), 0, 1);
      for (let k = 0; k < 3; k++) outPos[k] = bpos[i * 3 + k] + (bpos[(i + 1) * 3 + k] - bpos[i * 3 + k]) * u;
      outQ.copy(bq[i]).slerp(bq[i + 1], u);
      outQ.premultiply(qM);                                          // camera-to-world (three convention)
    }

    // ---- helpers ---------------------------------------------------------------
    const terrainH = (x, z) => (ctx.modules.terrain && ctx.modules.terrain.heightAt ? ctx.modules.terrain.heightAt(x, z) : 0);
    const gOff = () => C.rover.groundOffset || 1.35;
    function mount() {
      const r = ctx.modules.rover;
      if (r && r.mounts && r.mounts.rdc) return r.mounts.rdc;
      return { pos: new V(0.9, -0.8, 0), quat: new Q(-Math.SQRT1_2, 0, 0, Math.SQRT1_2) };
    }
    function setPose(b, x, y, z, q) { b.pos[0] = x; b.pos[1] = y; b.pos[2] = z; b.quat[0] = q.x; b.quat[1] = q.y; b.quat[2] = q.z; b.quat[3] = q.w; }
    function mk() { return { pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], visible: true }; }

    // ---- reference (rover) pose for t <= 168.5 ----------------------------------
    const cp = [0, 0, 0], cq = new Q(), rq = new Q(), rp = new V();
    const dirH = new V(Math.sin(123 * Math.PI / 180), 0, -Math.cos(123 * Math.PI / 180));   // true heading 107 deg -> world az 123 deg
    const preD = new U.Track([[0, 9500], [T.chuteDeploy, 6200], [T.heatShieldSep, 700], [36, 0]], { mode: 'cubic' });
    let preY = null;
    function roverRef(t, outQ, outP) {
      const m = mount();
      const tt = Math.max(36, Math.min(168.5, t));
      baAt(tt, cp, cq);
      // camera -> rover
      rq.copy(m.quat).invert(); rq.premultiply(cq);                   // rover = cam * mount^-1
      rp.copy(m.pos).applyQuaternion(rq);
      let x = cp[0] - rp.x, y = cp[1] - rp.y, z = cp[2] - rp.z;
      outQ.copy(rq);
      if (t < 36) {
        if (!preY) preY = new U.Track([[0, 14800], [T.chuteDeploy, 13300], [T.heatShieldSep, 11350], [36, y]], { mode: 'cubic' });
        const d = preD.at(t);
        x += dirH.x * -d * -1 * -1; z += dirH.z * -d * -1 * -1;      // move up-track (opposite to travel)
        x = cp[0] - rp.x - dirH.x * d; z = cp[2] - rp.z - dirH.z * d;
        y = preY.at(t);
        // gentle pendulum sway before the BA track starts
        const sw = 0.06 * Math.sin(t * 1.3) * U.smoothstep(T.chuteDeploy, T.chuteDeploy + 4, t);
        _q2.setFromEuler(_e.set(sw, 0, sw * 0.7));
        outQ.multiply(_q2);
      } else if (t > 168.5) {
        y = y - 0.8 * (t - 168.5);
      }
      outP.set(x, y, z);
    }
    const _e = new THREE.Euler();

    // ---- state ---------------------------------------------------------------------
    const S = {
      t: 0, tPlus: 0, phase: 'intro', phaseIndex: 0,
      flags: { chuteDeploying: false, chuteInflated: false, heatShieldReleased: false, backshellReleased: false, poweredDescent: false, skyCrane: false, touchdown: false, bridleCut: false, dsFlyaway: false },
      bodies: { stack: mk(), heatShield: mk(), backshell: mk(), chute: Object.assign(mk(), { inflation: 0, deploy: 0, breathe: 0, flutter: 0 }), descentStage: mk(), rover: Object.assign(mk(), { mobility: 0, touchdown: false, settle: 0 }) },
      bridle: { deployed: 0, length: 0, tension: 0, cut: false, ageSinceCut: 0 },
      umbilical: { deployed: 0, cut: false },
      engines: { lit: false, throttle: new Float32Array(8) },
      env: { altitude: 0, airDensity: 0.006, dustCover: 0, sunDir: C.sun.dir },
      telemetry: { altitude: 0, speed: 0, vVertical: 0, vHorizontal: 0, mach: 0, tPlusStr: '', phaseName: '' },
    };

    // official telemetry table (video time, altitude AGL m, speed m/s, vertical m/s)
    const TEL = [
      [0, 13800, 488, 81], [T.chuteDeploy, 12247, 434, 121], [14.5, 12088, 424, 124], [22, 11364, 238, 89], [T.heatShieldSep + 0.5, 10380, 158, 83],
      [36.3, 9963, 142, 80], [65.4, 7388, 103, 96], [74.6, 6550, 99, 92], [90, 5100, 93, 90], [T.lvsValid, 3699, 87, 87], [T.mlePriming, 2996, 84, 83],
      [T.backshellSep, 2165, 81, 80], [T.mleIgnition, 2086, 85, 84], [T.divertStart, 1977, 85, 84], [138.6, 1150, 75, 60], [148, 560, 48, 44],
      [T.constVelStart, 254, 32.2, 32.2], [T.decelStart, 120, 32.1, 32.1], [T.throttleDown, 22, 1.0, 1.0], [T.skyCraneStart + 0.4, 20, 0.75, 0.75],
      [T.touchdown, 8.3, 0.8, 0.8], [T.touchdownDetected, 7.9, 0.1, 0.1], [T.touchdownDetected + 0.6, 7.8, 0, 0], [T.duration, 0, 0, 0],
    ];
    const trAlt = new U.Track(TEL.map((r) => [r[0], r[1]]), { mode: 'cubic' });
    const trSpd = new U.Track(TEL.map((r) => [r[0], r[2]]), { mode: 'cubic' });
    const trVz = new U.Track(TEL.map((r) => [r[0], r[3]]), { mode: 'cubic' });
    const dust = new U.Track([[0, 0], [162.8, 0], [165, 0.1], [170, 0.3], [176, 0.55], [182, 0.85], [184.5, 1], [186.5, 1], [188, 0.85], [190, 0.5], [193, 0.2], [200, 0.05], [216, 0]], { mode: 'smooth' });
    const PHASES = [[0, 'Atmosferik giriş'], [T.chuteDeploy, 'Paraşüt açılıyor'], [T.chuteRound + 4, 'Paraşütle iniş'], [T.heatShieldSep, 'Isı kalkanı ayrıldı'], [T.radarLock, 'Arazi göreli navigasyon'], [T.backshellSep, 'Arka kabuk ayrıldı — motorlar ateşlendi'], [T.constVelStart, 'Sabit hızlı iniş'], [T.skyCraneStart, 'Sky crane'], [T.touchdown, 'Temas'], [T.flyaway, 'İniş aşaması uzaklaşıyor'], [T.mccCut, 'Sonuç']];
    const soundSpeed = (a) => 229 + 18 * U.smoothstep(12000, 0, a);

    // ---- pieces --------------------------------------------------------------------
    const roverQ = new Q(), roverP = new V(), stackQ = new Q(), tmpQ = new Q(), tmpQ2 = new Q(), tmpV = new V(), tmpV2 = new V();
    let bs0 = null, hs0 = null, flyImpact = null;
    const dirBS = C.world.bearingToWorld(291, 1);                      // backshell drift direction (unit)
    const dirDS = C.world.bearingToWorld(311, 1);
    const dirHS = C.world.bearingToWorld(64, 1);
    const stackOff = () => C.stack;
    function offsetWorld(q, off, out) { return out.set(off[0], off[1], off[2]).applyQuaternion(q); }

    function lowering(t) {                                              // bridle payout d(t) 0..7.6
      const u = U.saturate((t - T.skyCraneStart) / (T.bridleOut - T.skyCraneStart));
      return C.ds.bridleLength * (1 - Math.pow(1 - u, 2.3));
    }
    let ySC = null, vSC = 0;                                            // sky-crane descent setup
    function setupSkyCrane() {
      roverRef(T.skyCraneStart, roverQ, roverP);
      ySC = roverP.y; const dEnd = C.ds.bridleLength;
      vSC = Math.max(0.3, (ySC - dEnd - gOff()) / (T.touchdown - T.skyCraneStart));
    }
    function heatShieldZ(tau) { return tau < 5.1 ? 0.29 + 3.03 * tau + 1.011 * tau * tau + 0.445 * tau * tau * tau - 0.06 * Math.pow(tau, 4) : 59 + 17 * (tau - 5.1) + 0.3 * (tau - 5.1) * (tau - 5.1); }

    function stateAt(t) {
      const B = S.bodies, F = S.flags, so = stackOff();
      S.t = t;
      if (ySC === null) setupSkyCrane();
      const tc = t < T.chuteDeploy ? t - T.chuteDeploy : (t < 27.5 ? t - T.chuteDeploy : (t < T.heatShieldSep ? 14.65 + (t - 27.5) * (22.31 - 14.65) / (T.heatShieldSep - 27.5) : t - 8.53));
      S.tPlus = T.tPlusChute + tc;
      F.chuteDeploying = t >= T.chuteDeploy; F.chuteInflated = t >= T.chuteRound; F.heatShieldReleased = t >= T.heatShieldSep;
      F.backshellReleased = t >= T.backshellSep; F.poweredDescent = t >= T.mleIgnition; F.skyCrane = t >= T.skyCraneStart;
      F.touchdown = t >= T.touchdown; F.bridleCut = t >= T.bridleCut; F.dsFlyaway = t >= T.flyaway;

      // ---- rover (reference) ----
      const tr = Math.min(t, T.skyCraneStart);
      roverRef(tr, roverQ, roverP);
      let rx = roverP.x, ry = roverP.y, rz = roverP.z; stackQ.copy(roverQ);
      const dLow = lowering(t);
      let dsY = 0;
      if (t > T.skyCraneStart) {
        ry = ySC - vSC * (t - T.skyCraneStart) - dLow;
        ry = Math.max(ry, gOff() + terrainH(rx, rz));
        const tk = t - T.bridleOut;
        const amp = 0.105 * U.smoothstep(T.skyCraneStart + 1, T.bridleOut, t) * Math.exp(-Math.max(0, tk) / 8);
        const ang = amp * Math.cos(2 * Math.PI * (t - 177.4) / 2.15);
        tmpQ.setFromAxisAngle(tmpV.set(0, 0, 1), ang); stackQ.multiply(tmpQ);
      }
      const settle = F.touchdown ? U.smoothstep(T.touchdown, T.touchdown + 1.2, t) : 0;
      if (F.touchdown) ry = gOff() + terrainH(rx, rz) - 0.03 * Math.exp(-(t - T.touchdown) * 2) * Math.cos((t - T.touchdown) * 9);
      setPose(B.rover, rx, ry, rz, stackQ); B.rover.mobility = U.smoothstep(T.skyCraneStart, T.skyCraneStart + 2.5, t); B.rover.touchdown = F.touchdown; B.rover.settle = settle;
      if (t >= T.touchdown) { /* rover stays; heading frozen */ }

      // ---- stack (whole vehicle, origin = rover chassis centre in stowed frame) ----
      const attached = t < T.skyCraneStart;
      // descent-stage
      tmpV.set(0, 0, 0);
      if (attached) { offsetWorld(stackQ, so.descentStage.origin, tmpV); }
      else { tmpV.set(0, so.descentStage.origin[1] + dLow, 0).applyQuaternion(stackQ); }
      let dx = rx + tmpV.x, dy = ry + tmpV.y, dz = rz + tmpV.z;
      const dsq = tmpQ2.copy(stackQ);
      if (t > T.touchdown) { dy = Math.max(dy, terrainH(rx, rz) + so.descentStage.origin[1] + C.ds.bridleLength + gOff() * 0 ); }
      if (t >= T.flyaway) {
        const tau = t - T.flyaway, burn = 12, ah = 3.3, av = 1.0;
        const tb = Math.min(tau, burn), tg = Math.max(0, tau - burn);
        const hd = 0.5 * ah * tb * tb + ah * burn * tg;               // horizontal distance along dirDS
        let hy = 0.5 * av * tb * tb + av * burn * tg - 0.5 * C.g * tg * tg;
        const y0 = dy; dx += dirDS.x * hd; dz += dirDS.z * hd; dy = y0 + hy;
        const gr = terrainH(dx, dz) + 0.6;
        if (dy < gr) { dy = gr; }
        tmpQ.setFromAxisAngle(tmpV.set(dirDS.z, 0, -dirDS.x).normalize(), -0.8 * U.smoothstep(0, 3, tau)); dsq.premultiply(tmpQ);
        if (flyImpact === null) { flyImpact = { t: 0 }; }
      }
      setPose(B.descentStage, dx, dy, dz, dsq);
      dsY = dy;

      // ---- stack pose (before backshell separation) ----
      offsetWorld(stackQ, so.backshell.origin, tmpV);
      const bx0 = rx + tmpV.x, by0 = ry + tmpV.y, bz0 = rz + tmpV.z;
      setPose(B.stack, rx, ry, rz, stackQ); B.stack.visible = !F.backshellReleased;

      // ---- backshell + chute ----
      let bx = bx0, by = by0, bz = bz0; const bqv = tmpQ.copy(stackQ);
      let landedBS = false, collapse = 0;
      if (F.backshellReleased) {
        if (!bs0) { roverRef(T.backshellSep, roverQ, roverP); offsetWorld(roverQ, so.backshell.origin, tmpV); bs0 = { x: roverP.x + tmpV.x, y: roverP.y + tmpV.y, z: roverP.z + tmpV.z, q: roverQ.clone() }; }
        const tau = t - T.backshellSep;
        const sp = 12 * (1 - Math.exp(-tau / 6));                    // drift speed ramp
        bx = bs0.x + dirBS.x * 12 * (tau - 6 * (1 - Math.exp(-tau / 6))); bz = bs0.z + dirBS.z * 12 * (tau - 6 * (1 - Math.exp(-tau / 6)));
        by = bs0.y + 18 * (1 - Math.exp(-tau / 3)) - 62 * tau * 0.98;
        const g = terrainH(bx, bz) + 1.6;
        if (by <= g) { by = g; landedBS = true; const tl = (bs0.y + 18 - g) / 61; collapse = U.smoothstep(tl, tl + 4, tau); }
        bqv.copy(bs0.q);
      }
      setPose(B.backshell, bx, by, bz, bqv); B.backshell.visible = t >= 0;

      // chute confluence above the backshell attach point
      const tauC = t - T.chuteDeploy;
      const swAmp = 0.10 * Math.exp(-Math.max(0, tauC) / 14) + 0.03;
      const swP = 2 * Math.PI * tauC / (0.7 + 0.055 * tauC);
      tmpQ2.setFromEuler(_e.set(swAmp * Math.sin(swP), 0.15 * Math.sin(tauC * 0.31), swAmp * Math.cos(swP * 0.93)));
      const cq2 = tmpQ2.premultiply(bqv);
      tmpV.set(0, (so.chuteAttach.origin[1] - so.backshell.origin[1]) + 8.9, 0).applyQuaternion(cq2);
      const chuteUp = landedBS ? (1 - collapse) : 1;
      setPose(B.chute, bx + tmpV.x * chuteUp, by + tmpV.y * chuteUp - (landedBS ? 0 : 0), bz + tmpV.z * chuteUp, cq2);
      B.chute.visible = t >= T.chuteDeploy - 0.01;
      B.chute.deploy = U.saturate(tauC / 1.16);
      const infl = U.smoothstep(1.16, 1.63, tauC);
      B.chute.inflation = (tauC < 0 ? 0 : infl * (1 + 0.04 * Math.exp(-Math.max(0, tauC - 1.63) * 1.6) * Math.sin(Math.max(0, tauC - 1.63) * 18))) * (1 - collapse * 0.97);
      B.chute.breathe = 0.02 * Math.sin(tauC * 2.6); B.chute.flutter = 0.5 * (1 - collapse);

      // ---- heat shield ----
      if (!F.heatShieldReleased) {
        offsetWorld(stackQ, so.heatShield.origin, tmpV); setPose(B.heatShield, rx + tmpV.x, ry + tmpV.y, rz + tmpV.z, stackQ);
      } else {
        if (!hs0) { roverRef(T.heatShieldSep, roverQ, roverP); hs0 = { q: roverQ.clone(), p: roverP.clone() }; }
        const tau = t - T.heatShieldSep;
        const Z = heatShieldZ(tau);
        tmpV2.set(0, so.heatShield.origin[1] - Z, 0).applyQuaternion(hs0.q);
        let hx = rx + tmpV2.x + dirHS.x * 0.35 * Z, hz = rz + tmpV2.z + dirHS.z * 0.35 * Z, hy = ry + tmpV2.y;
        const g = terrainH(hx, hz) + 0.5;
        tmpQ.setFromEuler(_e.set(0.26 * Math.sin(tau * 0.55), 0.03 * tau, 0.15 * Math.sin(tau * 0.4 + 1)));
        const hq = tmpQ2.copy(hs0.q).multiply(tmpQ);
        if (hy < g) { hy = g; hq.copy(hs0.q).multiply(tmpQ.setFromEuler(_e.set(0.35, 0.8, 0.1))); }
        setPose(B.heatShield, hx, hy, hz, hq);
      }
      B.heatShield.visible = true;

      // ---- bridle / umbilical / engines / env ----
      const lo = U.saturate((t - T.skyCraneStart) / (T.bridleOut - T.skyCraneStart));
      S.bridle.deployed = lo; S.bridle.length = C.ds.bridleLength * (1 - Math.pow(1 - lo, 2.3)); S.bridle.tension = F.skyCrane && !F.bridleCut ? (F.touchdown ? 0.2 : 1) : 0;
      S.bridle.cut = F.bridleCut; S.bridle.ageSinceCut = Math.max(0, t - T.bridleCut); S.umbilical.deployed = lo; S.umbilical.cut = F.bridleCut;
      const lit = t >= T.mleIgnition;
      S.engines.lit = lit;
      for (let i = 0; i < 8; i++) {
        let th = 0;
        if (lit) {
          th = t < T.mleIgnition + 0.3 ? 0.2 : (t < T.throttleDown ? 0.55 + 0.1 * Math.sin(t * 0.5 + i) : 0.35);
          if (t >= T.decelStart && t < T.throttleDown) th = 0.8;
          if (t >= T.throttleDown && i % 2 === 1) th = 0;
          if (t >= T.touchdownDetected) th = 0.25;
          if (t >= T.flyaway) th = t < T.flyaway + 12 ? 1 : 0;
        }
        S.engines.throttle[i] = th;
      }
      S.env.altitude = Math.max(0, ry - terrainH(rx, rz)); S.env.dustCover = dust.at(t);
      S.telemetry.altitude = Math.max(0, trAlt.at(t)); S.telemetry.speed = Math.max(0, trSpd.at(t)); S.telemetry.vVertical = Math.max(0, trVz.at(t));
      S.telemetry.vHorizontal = Math.sqrt(Math.max(0, S.telemetry.speed * S.telemetry.speed - S.telemetry.vVertical * S.telemetry.vVertical));
      S.telemetry.mach = S.telemetry.speed / soundSpeed(S.telemetry.altitude);
      S.airDensity = 0;
      const ep = Math.max(0, Math.round(S.tPlus)); S.telemetry.tPlusStr = 'T+ ' + String(Math.floor(ep / 60)).padStart(2, '0') + ':' + String(ep % 60).padStart(2, '0');
      let ph = PHASES[0][1]; for (const p of PHASES) if (t >= p[0]) ph = p[1]; S.telemetry.phaseName = ph; S.phase = ph;
      return S;
    }

    const ev = (id, t, name, detail) => ({ id, t, name, tPlus: T.tPlusChute + (t < T.chuteDeploy ? t - T.chuteDeploy : t < 27.5 ? t - T.chuteDeploy : t < T.heatShieldSep ? 14.65 + (t - 27.5) * 2.29 : t - 8.53), detail: detail || '' });
    const events = [
      ev('masses', 1.4, 'Giriş denge kütleleri atıldı', 'Tungsten denge kütleleri kapsülden ayrılır.'),
      ev('chute', T.chuteDeploy, 'Paraşüt açıldı', 'Havan ateşlendi; Mach 1,8, 12 km irtifa.'),
      ev('inflated', T.chuteRound, 'Paraşüt tam şişti', 'Tepe yükü ~152 kN.'),
      ev('heatShield', T.heatShieldSep, 'Isı kalkanı ayrıldı', 'Radar ve kameralar ilk kez yüzeyi görür.'),
      ev('radar', T.radarLock, 'Radar yüzeyi kilitledi', 'Hız ~100 m/s, irtifa ~7 km.'),
      ev('lvs', T.lvsValid, 'Arazi göreli navigasyon çözümü geçerli', 'LVS Jezero haritasıyla eşleşti.'),
      ev('priming', T.mlePriming, 'İniş motorları hazırlanıyor', ''),
      ev('backshell', T.backshellSep, 'Arka kabuk ayrıldı', '2,2 km irtifa, 81 m/s.'),
      ev('ignition', T.mleIgnition, 'Motorlar ateşlendi', 'Sekiz Mars İniş Motoru.'),
      ev('divert', T.divertStart, 'Sapma manevrası', 'Güvenli hedefe yanal sapma.'),
      ev('constVel', T.constVelStart, 'Sabit hızlı iniş', '32 m/s, ~250 m.'),
      ev('decel', T.decelStart, 'Sabit yavaşlama', '5,3 m/s² fren.'),
      ev('throttle', T.throttleDown, 'Gaz kısıldı', '~22 m, 1 m/s.'),
      ev('skyCrane', T.skyCraneStart, 'Sky crane başladı', 'Rover halatlarla indirilir.'),
      ev('bridle', T.bridleOut, 'Halatlar tam boy', '7,6 m.'),
      ev('touchdown', T.touchdown, 'Yere temas', 'Tekerlekler 0,75 m/s ile değdi.'),
      ev('detected', T.touchdownDetected, 'Temas algılandı', ''),
      ev('cut', T.bridleCut, 'Halatlar kesildi', 'Piroteknik bıçaklar.'),
      ev('flyaway', T.flyaway, 'İniş aşaması uzaklaşıyor', 'Kaçış yanması ~20 sn.'),
    ];
    return { state: stateAt, build() { ySC = null; bs0 = null; hs0 = null; }, events, impacts: {}, isFlight: true };
  });
})();
