/* ============================================================================
 * cameras.js — views, panel layouts (module 'cameras')
 * modes: 'video' (NASA video layouts, frame by frame), 'cinematic' (auto director), 'free' (orbit), 'rdc'|'ruc'|'ddc'|'puc' (single onboard views)
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util;
  const V3 = THREE.Vector3, Q = THREE.Quaternion, V = V3;

  EDL.registerModule('cameras', function (ctx) {
    const T = C.t;
    const mk = (fov, aspect) => new THREE.PerspectiveCamera(fov, aspect, 0.1, 400000);
    const cams = { main: mk(50, 16 / 9), puc1: mk(30.6, 1.25), puc2: mk(30.6, 1.25), rdc: mk(25.6, 1.254), ruc: mk(30.6, 1.25), ddc: mk(35.2, 4 / 3) };
    const modes = [
      { id: 'video', name: 'Video düzeni', desc: 'NASA videosunun panel düzeni' },
      { id: 'cinematic', name: 'Sinematik', desc: 'Otomatik yönetmen' },
      { id: 'free', name: 'Serbest', desc: 'Fare ile döndür / yakınlaştır' },
      { id: 'rdc', name: 'RDC', desc: 'Rover aşağı bakan kamera' }, { id: 'ruc', name: 'RUC', desc: 'Rover yukarı bakan kamera' },
      { id: 'ddc', name: 'DDC', desc: 'İniş aşaması aşağı bakan kamera' }, { id: 'puc', name: 'PUC', desc: 'Paraşüt yukarı bakan kamera' },
    ];
    let mode = 'video';
    const fl = () => ctx.modules.flight.state.bind(ctx.modules.flight);
    const terrainH = (x, z) => (ctx.modules.terrain && ctx.modules.terrain.heightAt ? ctx.modules.terrain.heightAt(x, z) : 0);

    // ---------------- helpers ----------------
    const _q = new Q(), _q2 = new Q(), _v = new V(), _v2 = new V();
    function bodyQ(b) { return _q.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]); }
    function mountCam(cam, body, mnt, fallbackPos, fallbackQuat) {
      const m = mnt || { pos: fallbackPos, quat: fallbackQuat };
      const bq = new Q(body.quat[0], body.quat[1], body.quat[2], body.quat[3]);
      _v.copy(m.pos).applyQuaternion(bq);
      cam.position.set(body.pos[0] + _v.x, body.pos[1] + _v.y, body.pos[2] + _v.z);
      cam.quaternion.copy(bq).multiply(m.quat);
      cam.updateMatrixWorld(true);
    }
    const qDown = new Q(-Math.SQRT1_2, 0, 0, Math.SQRT1_2), qUp = new Q(Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    function setup(cam, fov, aspect, near, far) { cam.fov = fov; cam.aspect = aspect; cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }

    function camRDC(S) { const r = ctx.modules.rover; mountCam(cams.rdc, S.bodies.rover, r && r.mounts && r.mounts.rdc, new V(0.9, -0.8, 0), qDown); const alt = Math.max(1, S.bodies.rover.pos[1]); setup(cams.rdc, 25.6, 1.254, Math.max(0.05, alt * 0.0006), 250000); return cams.rdc; }
    function camRUC(S) { const r = ctx.modules.rover; mountCam(cams.ruc, S.bodies.rover, r && r.mounts && r.mounts.ruc, new V(-1.1, 0.7, 0), qUp); setup(cams.ruc, 30.6, 1.25, 0.05, 100000); return cams.ruc; }
    function camDDC(S) { const d = ctx.modules.descentStage; mountCam(cams.ddc, S.bodies.descentStage, d && d.mounts && d.mounts.ddc, new V(0, -0.3, 0), qDown); setup(cams.ddc, 35.2, 4 / 3, 0.05, 100000); return cams.ddc; }
    function camPUC(S, which) {
      const c = ctx.modules.capsule, cam = which ? cams.puc2 : cams.puc1;
      const m = c && c.mounts && (which ? c.mounts.pucB : c.mounts.pucA);
      mountCam(cam, S.bodies.backshell, m, new V(which ? -0.8 : 0.8, 2.6, which ? 0.9 : -0.9), qUp);
      setup(cam, 30.6, 1.25, 0.05, 100000); return cam;
    }

    // ---------------- external director ----------------
    const tgt = new V(), eye = new V();
    function bodyPos(S, name) { const b = S.bodies[name]; return _v2.set(b.pos[0], b.pos[1], b.pos[2]); }
    function director(t, S, cam, aspect) {
      const st = S.bodies.stack, ds = S.bodies.descentStage, ro = S.bodies.rover, ch = S.bodies.chute, hs = S.bodies.heatShield, bs = S.bodies.backshell;
      const sp = new V(st.pos[0], st.pos[1], st.pos[2]);
      let fov = 45;
      if (t < 12.85) { const a = 0.6 + t * 0.09; eye.set(sp.x + 34 * Math.cos(a), sp.y + 6, sp.z + 34 * Math.sin(a)); tgt.copy(sp); }
      else if (t < 30.84) { const a = 2.2 + (t - 12.85) * 0.05; eye.set(sp.x + 45 * Math.cos(a), sp.y - 12, sp.z + 45 * Math.sin(a)); tgt.set(ch.pos[0], ch.pos[1] - 6, ch.pos[2]).lerp(sp, 0.35); fov = 55; }
      else if (t < 40) { eye.set(sp.x + 16, sp.y + 4, sp.z + 22); tgt.set(hs.pos[0], hs.pos[1], hs.pos[2]).lerp(sp, 0.5); fov = 42; }
      else if (t < T.backshellSep - 2) { const a = 0.4 + (t - 40) * 0.035; eye.set(sp.x + 95 * Math.cos(a), sp.y - 25, sp.z + 95 * Math.sin(a)); tgt.set(ch.pos[0], ch.pos[1] - 8, ch.pos[2]).lerp(sp, 0.55); fov = 52; }
      else if (t < 136) { eye.set(ds.pos[0] + 16, ds.pos[1] + 5, ds.pos[2] + 20); tgt.set(ds.pos[0], ds.pos[1], ds.pos[2]).lerp(_v2.set(bs.pos[0], bs.pos[1], bs.pos[2]), 0.25); fov = 45; }
      else if (t < 168) { const a = 0.8 + t * 0.04; eye.set(ds.pos[0] + 22 * Math.cos(a), ds.pos[1] + 3, ds.pos[2] + 22 * Math.sin(a)); tgt.set(ds.pos[0], ds.pos[1] - 3, ds.pos[2]); }
      else if (t < 187) { const a = 0.9; const my = (ds.pos[1] + ro.pos[1]) * 0.5; eye.set(ro.pos[0] + 13 * Math.cos(a), Math.max(terrainH(ro.pos[0], ro.pos[2]) + 2.5, ro.pos[1] + 1.5), ro.pos[2] + 13 * Math.sin(a)); tgt.set(ro.pos[0], my, ro.pos[2]); fov = 50; }
      else if (t < 200) { eye.set(ro.pos[0] + 15, terrainH(ro.pos[0] + 15, ro.pos[2] + 10) + 2.0, ro.pos[2] + 10); tgt.set(ro.pos[0], ro.pos[1] + 3 + 0.4 * (t - 187), ro.pos[2]); }
      else if (t < 207) { const u = (t - 200) / 7; eye.set(ro.pos[0] + 15 + 45 * u, terrainH(ro.pos[0] + 30, ro.pos[2] + 25) + 3 + 12 * u, ro.pos[2] + 10 + 45 * u); tgt.set(ro.pos[0], ro.pos[1] + 1, ro.pos[2]); }
      else { eye.set(ro.pos[0] + 130, terrainH(ro.pos[0] + 130, ro.pos[2] + 90) + 18, ro.pos[2] + 90); tgt.set(ds.pos[0], ds.pos[1], ds.pos[2]).lerp(_v2.set(ro.pos[0], 40, ro.pos[2]), 0.25); fov = 38; }
      const g = terrainH(eye.x, eye.z) + 2; if (eye.y < g) eye.y = g;
      cam.position.copy(eye); cam.lookAt(tgt);
      const d = eye.distanceTo(tgt); setup(cam, fov, aspect, Math.max(0.1, d * 0.005), 400000);
      return tgt;
    }

    // ---------------- free camera ----------------
    const free = { yaw: 0.8, pitch: 0.25, dist: 40, target: 'auto', tPos: new V() };
    let dragging = false, lx = 0, ly = 0;
    const canvas = document.getElementById('gl');
    if (canvas) {
      canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointerup', () => { dragging = false; });
      canvas.addEventListener('pointermove', (e) => { if (!dragging || mode !== 'free') return; free.yaw -= (e.clientX - lx) * 0.006; free.pitch = U.clamp(free.pitch + (e.clientY - ly) * 0.005, -1.2, 1.45); lx = e.clientX; ly = e.clientY; });
      canvas.addEventListener('wheel', (e) => { if (mode !== 'free') return; e.preventDefault(); free.dist = U.clamp(free.dist * Math.exp(e.deltaY * 0.0012), 3, 30000); }, { passive: false });
    }
    const targets = ['auto', 'rover', 'descentStage', 'stack', 'chute', 'heatShield', 'backshell'];
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); free.target = targets[(targets.indexOf(free.target) + 1) % targets.length]; }
      else if (e.code === 'KeyR') { free.yaw = 0.8; free.pitch = 0.25; free.dist = 40; }
      else if (e.code === 'Digit4') EDL.player && EDL.player.setMode('rdc');
      else if (e.code === 'Digit5') EDL.player && EDL.player.setMode('ruc');
      else if (e.code === 'Digit6') EDL.player && EDL.player.setMode('ddc');
      else if (e.code === 'Digit7') EDL.player && EDL.player.setMode('puc');
    });
    function freeCam(t, S, cam, aspect) {
      let name = free.target;
      if (name === 'auto') name = t < 12.85 ? 'stack' : t < T.backshellSep ? 'stack' : t < T.skyCraneStart ? 'descentStage' : t < 205 ? 'rover' : 'rover';
      const b = S.bodies[name] || S.bodies.stack;
      free.tPos.set(b.pos[0], b.pos[1], b.pos[2]);
      const d = free.dist, cp = Math.cos(free.pitch);
      eye.set(free.tPos.x + d * cp * Math.cos(free.yaw), free.tPos.y + d * Math.sin(free.pitch), free.tPos.z + d * cp * Math.sin(free.yaw));
      const g = terrainH(eye.x, eye.z) + 1.5; if (eye.y < g) eye.y = g;
      cam.position.copy(eye); cam.lookAt(free.tPos); setup(cam, 45, aspect, Math.max(0.05, d * 0.004), 400000);
    }

    // ---------------- looks ----------------
    const preset = (n) => { const P = window.EDL.Post && EDL.Post.presets && EDL.Post.presets[n]; return P ? JSON.parse(JSON.stringify(P)) : {}; };
    function mkLook(name, o) { const l = preset(name); return Object.assign(l, o || {}); }

    // ---------------- layout ----------------
    const panelPool = {};
    function P(id) { return panelPool[id] || (panelPool[id] = { id, x: 0, y: 0, w: 0, h: 0, camera: null, t: 0, look: {}, focus: { pos: new V(), radius: 50 }, labels: null, tag: '' }); }
    function rect(p, st, x, y, w, h) { const s = st.w / 3840; p.x = st.x + x * s; p.y = st.y + y * s; p.w = w * s; p.h = h * s; }
    const lerpRect = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    const fmt = (t) => t;

    function fullPanel(id, cssW, cssH, cam, t, look, S) {
      const p = P(id); p.x = 0; p.y = 0; p.w = cssW; p.h = cssH; p.camera = cam; p.t = t; p.look = look; p.labels = null; p.tag = '';
      const b = S.bodies.rover; p.focus.pos.set(b.pos[0], b.pos[1], b.pos[2]); p.focus.radius = 60; return p;
    }
    function sensorPanel(id, cssW, cssH, cam, aspect, t, look, S) {           // letterboxed to the sensor aspect
      const st = U.stageRect(cssW, cssH);
      const p = P(id); let w = st.h * aspect, h = st.h; if (w > st.w) { w = st.w; h = st.w / aspect; }
      p.x = (cssW - w) / 2; p.y = (cssH - h) / 2; p.w = w; p.h = h; p.camera = cam; p.t = t; p.look = look; p.labels = null;
      const b = S.bodies.rover; p.focus.pos.set(b.pos[0], b.pos[1], b.pos[2]); p.focus.radius = 12; return p;
    }
    function rdcExposure(t) {                                                   // heat-shield-separation AE ramp (heatshield_report sec.4)
      if (t < 30.933) return 0; if (t < 31.06) return (t - 30.933) / 0.13 * 0.5;
      return 0.5 + 0.5 * U.smoothstep(31.06, 31.5, t);
    }
    function rdcGain(t) { if (t < 31.5) return 0.15 + 0.85 * U.smoothstep(31.0, 31.5, t); if (t < 32.3) return 1 + 3.2 * U.smoothstep(31.5, 32.2, t); if (t < 32.95) return 4.2 - 3.4 * U.smoothstep(32.3, 32.95, t); if (t < 33.5) return 0.8 + 0.2 * U.smoothstep(33.1, 33.5, t); return 1; }
    function flicker(t) { return 1 + 0.25 * Math.sin(t * 53.1) * Math.sin(t * 17.3 + 1); }

    function layout(t, modeId, cssW, cssH) {
      const S = ctx.modules.flight.state(t); const out = [];
      const st = U.stageRect(cssW, cssH);
      const m = modeId || mode;
      if (m === 'cinematic' || m === 'free') {
        const cam = cams.main, a = cssW / cssH;
        if (m === 'cinematic') director(t, S, cam, a); else freeCam(t, S, cam, a);
        const look = mkLook('cine', { skyMix: 0, fade: 1 - U.smoothstep(0, 1, t) * 0 - (t > 214.5 ? U.smoothstep(214.5, 216, t) : 0) * 0 });
        look.fade = t > 214.6 ? U.smoothstep(214.6, 216, t) : 0;
        const p = fullPanel('main', cssW, cssH, cam, t, look, S);
        p.focus.pos.copy(m === 'free' ? free.tPos : tgt); p.focus.radius = 60;
        out.push(p); return out;
      }
      if (m === 'rdc') { const look = mkLook('rdc', { skyMix: 0 }); out.push(sensorPanel('rdc', cssW, cssH, camRDC(S), 1.254, fmt(t), look, S)); return out; }
      if (m === 'ruc') { out.push(sensorPanel('ruc', cssW, cssH, camRUC(S), 1.25, t, mkLook('ruc', { skyMix: 1, skyPalette: 'ruc' }), S)); return out; }
      if (m === 'ddc') { out.push(sensorPanel('ddc', cssW, cssH, camDDC(S), 4 / 3, Math.floor(t * 12) / 12, mkLook('ddc', { skyMix: 0.3 }), S)); return out; }
      if (m === 'puc') { out.push(sensorPanel('puc-real', cssW, cssH, camPUC(S, 0), 1.25, t, mkLook('puc', { skyMix: 1, skyPalette: 'puc' }), S)); return out; }

      // ---------------- video mode ----------------
      const blackPanel = (id) => { const p = fullPanel(id, cssW, cssH, cams.main, t, { fade: 1 }, S); p.x = st.x; p.y = st.y; p.w = st.w; p.h = st.h; out.push(p); return p; };
      if (t < 12.033) {
        const cam = cams.main; director(t, S, cam, st.w / st.h);
        const p = P('main'); p.x = st.x; p.y = st.y; p.w = st.w; p.h = st.h; p.camera = cam; p.t = t; p.labels = null; p.tag = '';
        p.look = mkLook('cine', { skyMix: 0, fade: U.smoothstep(11.567, 12.033, t) }); p.focus.pos.copy(tgt); p.focus.radius = 60; out.push(p); return out;
      }
      if (t < 12.733) { blackPanel('main'); return out; }
      if (t <= 27.5) {
        const tau = t - 12.767;
        // right = real time
        const pr = P('puc-real'); rect(pr, st, 1921, 280, 1919, 1536); pr.camera = camPUC(S, 0); pr.t = t;
        const exp = t < 12.87 ? 6 : (1 + 5 * (1 - U.smoothstep(1.3, 1.8, tau)));
        pr.look = mkLook('puc', { skyMix: 1, skyPalette: 'puc', exposure: 1 * exp * 0.5 + 0.5, whiteout: t < 12.9 ? 1 : 0 });
        pr.labels = [{ text: 'gerçek zaman', x: pr.x + pr.w * 0.5 - 0.02 * st.w, y: st.y + 245 * st.w / 3840, size: 128 * st.w / 3840, align: 'center', opacity: 1 }];
        pr.focus.pos.set(S.bodies.backshell.pos[0], S.bodies.backshell.pos[1], S.bodies.backshell.pos[2]); pr.focus.radius = 40; pr.tag = '';
        // left = 30 % speed (24 fps steps)
        const pl = P('puc-slow'); rect(pl, st, 0, 280, 1915, 1536);
        const tL = 12.767 + Math.floor((t - 12.767) / 3.2 * 24) / 24;
        const SL = ctx.modules.flight.state(tL); pl.camera = camPUC(SL, 1); pl.t = tL;
        pl.look = mkLook('puc', { skyMix: 1, skyPalette: 'puc', exposure: 0.5 + 0.5 * (t < 13 ? 6 : 1 + 5 * (1 - U.smoothstep(1.3, 1.8, (tL - 12.767) )) ) });
        pl.labels = [{ text: '%30 hız', x: pl.x + pl.w * 0.5 - 0.013 * st.w, y: st.y + 229 * st.w / 3840, size: 128 * st.w / 3840, align: 'center', opacity: 1 }];
        pl.focus.pos.set(SL.bodies.backshell.pos[0], SL.bodies.backshell.pos[1], SL.bodies.backshell.pos[2]); pl.focus.radius = 40; pl.tag = '';
        out.push(pl, pr); return out;
      }
      if (t < 30.933) { blackPanel('main'); return out; }
      const rdcRect = [840, 0, 2267, 1808], rdcRect3 = [1834, 295, 1785, 1431];
      const rdcLook = (extra) => mkLook('rdc', Object.assign({ skyMix: 0, exposure: rdcGain(t) * flicker(t) * (t > 183.4 ? 1 : 0) + (t > 183.4 ? 0 : rdcGain(t)) }, extra || {}));
      if (t < 186.6 || t < 187) {
        // RDC
        const prd = P('rdc'); const cRDC = camRDC(S); prd.camera = cRDC; prd.t = t; prd.labels = null; prd.tag = '';
        let rr = rdcRect, fadeR = 0;
        if (t >= 164.27) rr = lerpRect(rdcRect, rdcRect3, U.saturate((t - 164.266) / (166.003 - 164.266)));
        if (t >= 166.003) rr = rdcRect3;
        rect(prd, st, rr[0], rr[1], rr[2], rr[3]);
        if (t < 31.06) fadeR = 1 - (t - 30.933) / 0.13;
        if (t >= 186.37) fadeR = U.saturate((t - 186.37) / 0.23);
        const lk = rdcLook(); lk.fade = U.saturate(fadeR); prd.look = lk;
        const b = S.bodies.rover; prd.focus.pos.set(b.pos[0], b.pos[1], b.pos[2]); prd.focus.radius = Math.max(15, b.pos[1] * 0.6);
        if (t >= 164.9 && t < 186.6) {
          const a = t < 166 ? Math.pow(U.saturate(t - 165), 1.5) : 1;
          const fadeOut = t >= 186.37 ? 1 - U.saturate((t - 186.37) / 0.23) : 1;
          const pru = P('ruc'); rect(pru, st, 278, 0, 1392, 1106); pru.camera = camRUC(S); pru.t = t; pru.labels = null; pru.tag = '';
          pru.look = mkLook('ruc', { skyMix: 1, skyPalette: 'ruc', fade: 1 - a });
          pru.focus.pos.set(b.pos[0], b.pos[1] + 4, b.pos[2]); pru.focus.radius = 12;
          const pdd = P('ddc'); rect(pdd, st, 283, 1110, 1388, 1041); const tD = Math.floor(t * 12) / 12; const SD = ctx.modules.flight.state(tD); pdd.camera = camDDC(SD); pdd.t = tD; pdd.labels = null; pdd.tag = '';
          pdd.look = mkLook('ddc', { skyMix: 0.3, fade: t >= 186.37 ? U.saturate((t - 186.37) / 0.23) : 1 - a }); pdd.focus.pos.set(b.pos[0], b.pos[1], b.pos[2]); pdd.focus.radius = 12;
          out.push(pru, pdd, prd);
        } else out.push(prd);
        return out;
      }
      if (t < 192.8) {
        const u = U.saturate((t - 186.6) / (187.73 - 186.6));
        const rr = lerpRect([278, 0, 1392, 1106], [920, 124, 2055, 1644], u);
        const pru = P('ruc'); rect(pru, st, rr[0], rr[1], rr[2], rr[3]); pru.camera = camRUC(S); pru.t = t; pru.labels = null; pru.tag = '';
        pru.look = mkLook('ruc', { skyMix: 1, skyPalette: 'ruc' }); const b = S.bodies.rover; pru.focus.pos.set(b.pos[0], b.pos[1] + 4, b.pos[2]); pru.focus.radius = 15; out.push(pru); return out;
      }
      // epilogue (external cinematic)
      { const cam = cams.main; director(Math.max(t, 200) < 207 ? 190 + (t - 192.8) * 0.6 : t, S, cam, st.w / st.h);
        const p = P('main'); p.x = st.x; p.y = st.y; p.w = st.w; p.h = st.h; p.camera = cam; p.t = t; p.labels = null; p.tag = '';
        const fadeIn = U.smoothstep(192.8, 193.6, t); p.look = mkLook('cine', { skyMix: 0, fade: (1 - fadeIn) + (t > 214.6 ? U.smoothstep(214.6, 216, t) : 0) }); p.focus.pos.copy(tgt); p.focus.radius = 60; out.push(p); return out; }
    }

    return {
      layout, modes, setMode(id) { mode = id; }, get mode() { return mode; }, cams, free,
      update() { /* cameras are driven from layout() */ },
    };
  });
})();
