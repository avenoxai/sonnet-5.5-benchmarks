'use strict';
// car/aero.js — AERO module (order 30): swan-neck DRS rear wing, front splitter + blades + active flaps, rear diffuser, underbody, side skirts, roof fins.
//
// Files: aero.js (this: module, materials, textures, wing/roof-fin parts, animation)  ·  aero_wing.js (wing geometry, pure)  ·
//        aero_front.js (splitter, blades, front flaps, tow cap)  ·  aero_under.js (undertray, diffuser, skirts, arch blade, roof fins geometry).
// PUBLIC (ctx.shared.aero): { parts:{name:Part}, materials, layout (wing numbers), lid(x,z), roof(x,z), stats, setDrs(v) }.
// Part names: wing_main wing_flap wing_endplates wing_upright wing_hinge splitter_* aero_* ...
// PG.state.drs (0..1, eased by the app): wing flap 0..34 deg about its hinge line, front flaps tilt with it.
// URL params: ?wing=black (gloss-black CFRP instead of carbon twill).  Everything deterministic, no Math.random.
(function () {
  const PG = window.PG, spec = PG.spec;
  (function () {                                            // pull in the split-out geometry files (executes right after this file)
    const cs = document.currentScript; const base = cs && cs.src ? cs.src.replace(/aero\.js(\?.*)?$/, '') : 'js/car/';
    for (const f of ['aero_wing.js', 'aero_front.js', 'aero_under.js']) document.write('<script src="' + base + f + '"><\/script>');
  })();
  const A = spec.anchors.wing, DEG = Math.PI / 180;

  // ------------------------------------------------------------------------------------------------ lettering textures
  function letterTex(gl, text, w, h, font, spacing, color) {
    return PG.glu.canvasTexture(gl, w, h, (g, W, H) => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = color || '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center';
      g.font = font; if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
      g.fillText(text, W / 2 + spacing / 2, H * 0.53);
    });
  }

  const WING_HOOK_PORSCHE = `
uniform sampler2D uTxt;
uniform vec3 uAccent;
void surfaceHook(inout Surf s, in Frag f) {
  vec3 n = f.front ? f.nObj : -f.nObj;
  // 'PORSCHE' lettering on the flap top surface: u = +Z (reads left to right from behind), v = +X (letter tops point forward)
  vec2 q = vec2((f.pObj.z + 0.300) / 0.600, (f.pObj.x + 2.222) / 0.058 + 0.5);
  vec4 t = texture(uTxt, q);
  float inb = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  float m = t.a * inb * smoothstep(0.6, 0.9, n.y);
  s.baseColor = mix(s.baseColor, uAccent * 0.62, m);
  s.metallic = mix(s.metallic, 0.15, m); s.roughness = mix(s.roughness, 0.38, m);
  s.normal = normalize(mix(s.normal, n, m * 0.9)); s.ao = mix(s.ao, 1.0, m);
}`;

  const WING_HOOK_ENDPLATE = `
uniform sampler2D uTxt;
uniform vec3 uAccent;
void surfaceHook(inout Surf s, in Frag f) {
  vec3 n = f.front ? f.nObj : -f.nObj;
  float sg = f.pObj.z >= 0.0 ? 1.0 : -1.0;
  // small 'GT3 RS' on the outer face, lower rear part; reads left to right when looking at the plate from outside
  vec2 q = vec2((f.pObj.x + 2.150) * sg / 0.210 + 0.5, (f.pObj.y - 1.205) / 0.0525 + 0.5);
  vec4 t = texture(uTxt, q);
  float inb = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  float m = t.a * inb * smoothstep(0.7, 0.95, n.z * sg);
  s.baseColor = mix(s.baseColor, uAccent * 0.62, m);
  s.metallic = mix(s.metallic, 0.15, m); s.roughness = mix(s.roughness, 0.38, m);
  s.normal = normalize(mix(s.normal, n, m * 0.9)); s.ao = mix(s.ao, 1.0, m);
}`;

  // textured (grained) black lower valance: fine stipple in albedo + roughness so the panel reads as moulded plastic even in shadow
  const VALANCE_HOOK = `
float vHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
void surfaceHook(inout Surf s, in Frag f) {
  vec2 cell = floor(vec2(f.pObj.z * 330.0, (f.pObj.y + f.pObj.x * 0.6) * 330.0));
  float h = vHash(cell);
  s.baseColor *= 0.80 + 0.40 * h;
  s.roughness = clamp(s.roughness + (h - 0.5) * 0.22, 0.05, 1.0);
  if (!f.front) s.baseColor *= 0.3;
}`;

  // ------------------------------------------------------------------------------------------------ module
  PG.registerModule({
    name: 'aero', order: 30,
    async build(ctx) {
      const { renderer, gl, geo: G, m4, util } = ctx;
      const t0 = performance.now();
      const body = ctx.shared.body, rc = body && body.raycaster;
      const K = {                                             // kit shared with the geometry files
        ctx, G, m4, rc, spec, parts: {}, tris: 0,
        lid: (x, z) => { const y = rc ? rc.heightAt(x, z, 1.5) : null; return y == null ? null : y; },
        roof: (x, z) => { const y = rc ? rc.heightAt(x, z, 2.0) : null; return y == null ? null : y; },
        bottom: (x, z) => { const y = rc ? rc.bottomAt(x, z, 0.0) : null; return y == null ? null : y; },
        // side surface: |z| of the body at (x, y) seen from outside (null when nothing is hit)
        side: (x, y) => { if (!rc) return null; const h = rc.cast([x, y, 2.0], [0, 0, -1]); return h ? h.point[2] : null; },
      };
      const hex = util.hex || PG.util.hex;
      const M = PG.mats;
      const blackWing = ctx.params.get('wing') === 'black';
      K.mats = {
        carbon: M.carbonTwill.derive({ name: 'aeroCarbon', patternScale: 190, clearcoat: 0.8, clearcoatRoughness: 0.32, roughness: 0.42 }),
        carbonFine: M.carbonTwill.derive({ name: 'aeroCarbonFine', patternScale: 190, clearcoat: 0.8, clearcoatRoughness: 0.32, roughness: 0.42 }),
        gloss: M.plasticGloss.derive({ name: 'aeroGloss' }),
        satin: M.plasticBlack.derive({ name: 'aeroSatin', baseColor: hex('#2b2b2e'), roughness: 0.44, specular: 0.55 }),
        matte: M.plasticBlack.derive({ name: 'aeroMatte', baseColor: hex('#222225'), roughness: 0.66, specular: 0.4 }),
        weave: M.carbonMatte.derive({ name: 'aeroWeave', patternScale: 300, baseColor: hex('#2c2c2f'), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.32 }),
      };
      K.mats.diffFloor = M.carbonMatte.derive({ name: 'aeroDiffFloor', patternScale: 260, baseColor: hex('#2e2f33'), roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3 });
      K.mats.diffFin = M.plasticBlack.derive({ name: 'aeroDiffFin', baseColor: hex('#43444a'), roughness: 0.46, specular: 0.6 });
      K.mats.diffValance = M.plasticBlack.derive({ name: 'aeroDiffValance', baseColor: hex('#46474c'), roughness: 0.55, specular: 0.5, doubleSided: true, hook: VALANCE_HOOK });
      K.mats.skirt = M.carbonMatte.derive({ name: 'aeroSkirt', patternScale: 220, baseColor: hex('#2a2b2f'), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25 });
      if (blackWing) { K.mats.carbon = M.plasticGloss.derive({ name: 'aeroWingBlack' }); K.mats.carbonFine = K.mats.carbon; }
      K.add = (def) => { const p = ctx.add(def); K.parts[def.name] = p; if (def.mesh && !def.mesh.subset) K.tris += G.triangleCount(def.mesh); return p; };
      K.addMesh = (name, mesh, material, extra) => {
        const gpu = renderer.upload(mesh);
        K.tris += G.triangleCount(mesh);
        const p = ctx.add(Object.assign({ name, mesh: gpu, material }, extra || {}));
        K.parts[name] = p; return p;
      };

      // ---------------------------------------------------------------- REAR WING
      ctx.progress('aero: wing', 0.1);
      const W = PG.aeroWingGeo(G, { lidY: K.lid });
      const L = W.layout;
      const txPorsche = letterTex(gl, 'PORSCHE', 2048, 176, '800 132px "Helvetica Neue", Helvetica, Arial, sans-serif', 30);
      const txRS = letterTex(gl, 'GT3 RS', 1024, 256, 'italic 800 150px "Helvetica Neue", Helvetica, Arial, sans-serif', 6);
      const matFlap = K.mats.carbon.derive({ name: 'wingFlap', hook: WING_HOOK_PORSCHE, uniforms: { uTxt: txPorsche, uAccent: M.paintAccent.baseColor.slice() } });
      const matEnd = K.mats.carbon.derive({ name: 'wingEndplate', hook: WING_HOOK_ENDPLATE, uniforms: { uTxt: txRS, uAccent: M.paintAccent.baseColor.slice() } });
      for (const k of ['main', 'flap', 'endplates', 'uprights']) delete W[k].uvs;   // one planar weave projection for the whole wing: identical tow size everywhere
      K.addMesh('wing_main', W.main, K.mats.carbon);
      const flap = K.addMesh('wing_flap', W.flap, matFlap);
      K.addMesh('wing_endplates', W.endplates, matEnd);
      K.addMesh('wing_upright', W.uprights, K.mats.carbonFine);
      K.addMesh('wing_hinge', W.hinges, K.mats.satin, { reflect: false });
      const ramBody = K.addMesh('wing_ramBody', W.ramBody, M.aluminum.derive({ name: 'aeroRam', baseColor: hex('#3a3b3e'), roughness: 0.38 }), { reflect: false });
      const ramRod = K.addMesh('wing_ramRod', W.ramRod, M.chrome.derive({ name: 'aeroRamRod', roughness: 0.18 }), { reflect: false });
      K.addMesh('wing_flapTabs', W.flapTabs, K.mats.satin, { parent: flap, reflect: false });
      K.wing = { L, flap };
      ctx.progress('aero: front', 0.4);

      // remaining sub-systems (each file adds its parts and may register animation callbacks through K.anim)
      K.anim = [];
      if (PG.aeroFront) PG.aeroFront(K);
      await PG.util.nextFrame();
      ctx.progress('aero: underbody', 0.7);
      if (PG.aeroUnder) PG.aeroUnder(K);

      // ---------------------------------------------------------------- animation
      const ramAt = (part, from, to, flip) => {           // orient a +Y cylinder from `from` towards `to`
        const dx = to[0] - from[0], dy = to[1] - from[1], phi = Math.atan2(-dx * (flip ? -1 : 1), dy * (flip ? -1 : 1));
        part.matrix = m4.multiply(m4.translation(from[0], from[1], 0), m4.rotationZ(phi));
      };
      const hx = L.hinge[0], hy = L.hinge[1], T1 = m4.translation(hx, hy, 0), T0 = m4.translation(-hx, -hy, 0);
      let lastDrs = -1;
      const setDrs = v => {
        const a = v * A.flapMaxDeg * DEG;
        flap.matrix = m4.multiply(T1, m4.multiply(m4.rotationZ(-a), T0));
        const c = Math.cos(-a), sn = Math.sin(-a), fx = L.ram.F0[0] - hx, fy = L.ram.F0[1] - hy;
        const F = [hx + fx * c - fy * sn, hy + fx * sn + fy * c];
        ramAt(ramBody, L.ram.B, F, false); ramAt(ramRod, F, L.ram.B, false);
        for (const f of K.anim) f(v);
      };
      const acc = M.paintAccent.baseColor; let accKey = '';
      ctx.onUpdate((dt, time, st) => {
        const key = acc[0] + ',' + acc[1] + ',' + acc[2];                       // lettering follows PG.mats.paintAccent live
        if (key !== accKey) { accKey = key; matFlap.uniforms.uAccent = acc.slice(); matEnd.uniforms.uAccent = acc.slice(); }
        const v = st.drs || 0; if (Math.abs(v - lastDrs) > 1e-4) { lastDrs = v; setDrs(v); } });
      setDrs(PG.state.drs || 0);

      // runtime finish switch: 'carbon' (twill weave, default) | 'black' (gloss black CFRP, no weave)
      const wingMats = blackWing ? [] : [K.mats.carbon, K.mats.carbonFine, matFlap, matEnd];
      const setWingFinish = kind => {
        for (const m of wingMats) {
          if (kind === 'black') { m.pattern = 'none'; m.baseColor = hex('#111113'); m.roughness = 0.16; }
          else { m.pattern = M.carbonTwill.pattern; m.baseColor = M.carbonTwill.baseColor.slice(); m.roughness = M.carbonTwill.roughness; }
        }
        return kind;
      };
      ctx.shared.aero = { setWingFinish, parts: K.parts, materials: K.mats, layout: L, lid: K.lid, roof: K.roof, setDrs, info: K.info || {}, kit: K, stats: {} };
      const ms = performance.now() - t0;
      ctx.shared.aero.stats = { ms, tris: K.tris };
      PG.log(`aero: ${Object.keys(K.parts).length} parts, ${K.tris} tris, ${ms.toFixed(0)} ms; wing main under ${L.mainUnderY.toFixed(3)} top ${L.wingTop}`);
    },
  });
})();
