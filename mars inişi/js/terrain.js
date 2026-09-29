/* ============================================================================
 * terrain.js — Jezero ground (module 'terrain')
 * Albedo = the three video-derived orthomosaics (assets/mosaic_*.js, placed with the WORLD.md mapping) over a procedural
 * terracotta base with pebble/rock detail near the camera; gentle procedural relief (CPU heightAt == mesh).
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util;

  EDL.registerModule('terrain', function (ctx) {
    const K = C.world.mosaicScale, O = C.world.baOrigin, HALF = C.world.half;
    const group = new THREE.Group();

    // ---------------- height function (shared by CPU + mesh) ----------------
    function relief(x, z) {
      const a = U.fbm2(x / 2600 + 11.3, z / 2600 - 4.7, 5, 21) - 0.5;            // regional undulation (~ +-10 m)
      const b = U.fbm2(x / 380 + 3.1, z / 380 + 9.4, 4, 33) - 0.5;              // hummocks (~ +-2 m)
      const c = U.fbm2(x / 45 + 7.7, z / 45 - 2.2, 3, 57) - 0.5;                // small relief (~ +-0.4 m)
      return a * 22 + b * 4.5 + c * 0.8;
    }
    const h00 = relief(0, 0);
    function heightAt(x, z) {
      const r = Math.hypot(x, z);
      const w = U.smoothstep(6, 90, r);                                          // flat pavement around the touchdown point
      return (relief(x, z) - h00) * w;
    }
    const nrm = new THREE.Vector3();
    function normalAt(x, z, out) {
      const e = 1.5, hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
      return (out || nrm).set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
    }

    // ---------------- geometry: non-uniform grid (fine at the centre) ----------------
    const NSEG = 360;
    const pos = new Float32Array((NSEG + 1) * (NSEG + 1) * 3);
    const uvs = new Float32Array((NSEG + 1) * (NSEG + 1) * 2);
    const axis = new Float32Array(NSEG + 1);
    for (let i = 0; i <= NSEG; i++) { const a = (i / NSEG) * 2 - 1; axis[i] = HALF * Math.sign(a) * Math.pow(Math.abs(a), 2.2); }
    let p = 0;
    for (let j = 0; j <= NSEG; j++) for (let i = 0; i <= NSEG; i++) {
      const x = axis[i], z = axis[j];
      pos[p++] = x; pos[p++] = heightAt(x, z); pos[p++] = z;
    }
    const idx = new Uint32Array(NSEG * NSEG * 6);
    let q = 0;
    for (let j = 0; j < NSEG; j++) for (let i = 0; i < NSEG; i++) {
      const a = j * (NSEG + 1) + i, b = a + 1, c = a + NSEG + 1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), HALF * 1.5);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, -100, -HALF), new THREE.Vector3(HALF, 100, HALF));

    // ---------------- mosaics ----------------
    const meta = EDL.data.mosaicMeta || {};
    const names = ['wide_t42_100', 'mid_t100_140', 'fine_t140_164'];
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
    const tex = names.map(() => blank);
    const place = names.map((n) => { const m = meta[n] || { Xl: 0, Yt: 0, wm: 1, hm: 1 }; return new THREE.Vector4(m.Xl, m.Yt, m.wm, m.hm); });
    const uni = Object.assign({
      uMosW: { value: blank }, uMosM: { value: blank }, uMosF: { value: blank },
      uPlaceW: { value: place[0] }, uPlaceM: { value: place[1] }, uPlaceF: { value: place[2] },
      uBA: { value: new THREE.Vector3(K, O[0], O[1]) },
      uGain: { value: 1.0 },
    }, EDL.uniforms);

    const vert = /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`;
    const frag = /* glsl */ `
      precision highp float;
      varying vec3 vW; varying vec3 vN;
      uniform sampler2D uMosW, uMosM, uMosF;
      uniform vec4 uPlaceW, uPlaceM, uPlaceF; uniform vec3 uBA; uniform float uGain;
      ${EDL.glsl.noise}
      ${EDL.glsl.fog}
      vec4 mosaic(sampler2D t, vec4 pl, vec2 ba){
        vec2 uv = vec2((ba.x - pl.x) / pl.z, (pl.y - ba.y) / pl.w);
        vec2 e = min(uv, 1.0 - uv);
        float inside = smoothstep(0.0, 0.02, min(e.x, e.y));
        vec3 c = texture2D(t, clamp(uv, 0.001, 0.999)).rgb;
        float l = dot(c, vec3(0.3, 0.55, 0.15));
        float a = inside * smoothstep(0.045, 0.16, l);
        return vec4(c, a);
      }
      void main(){
        float k = uBA.x;
        vec2 ba = vec2(vW.x / k + uBA.y, -vW.z / k + uBA.z);
        vec3 toCam = cameraPosition - vW; float dist = length(toCam);
        vec3 rd = -toCam / max(dist, 1e-3);
        // procedural base (terracotta)
        float n1 = fbm2(vW.xz * 0.0012), n2 = fbm2(vW.xz * 0.02 + 5.0);
        vec3 base = vec3(0.62, 0.40, 0.31) * (0.82 + 0.36 * n1) * (0.94 + 0.12 * n2);
        vec4 mw = mosaic(uMosW, uPlaceW, ba), mm = mosaic(uMosM, uPlaceM, ba), mf = mosaic(uMosF, uPlaceF, ba);
        vec3 col = base;
        col = mix(col, mw.rgb, mw.a * 0.95);
        col = mix(col, mm.rgb, mm.a * (1.0 - smoothstep(4500.0, 9000.0, dist)));
        col = mix(col, mf.rgb, mf.a * (1.0 - smoothstep(1500.0, 4500.0, dist)));
        col = pow(col, vec3(2.2)) * 0.78 * uGain;                                   // video sRGB -> linear albedo (darker: the footage is over-bright)
        // near-field detail: pebbles / cobbles / speckle
        float near = 1.0 - smoothstep(60.0, 700.0, dist);
        if (near > 0.0) {
          float pe = fbm2(vW.xz * 3.1) * 0.6 + fbm2(vW.xz * 11.0) * 0.4;
          float rocks = smoothstep(0.66, 0.74, vnoise2(vW.xz * 1.7 + 3.0)) * smoothstep(0.35, 0.6, vnoise2(vW.xz * 5.0));
          float peb = smoothstep(0.72, 0.8, vnoise2(vW.xz * 9.0 + 1.0));
          col *= 1.0 + near * ((pe - 0.5) * 0.55 - 0.06);
          col = mix(col, col * 1.55 + 0.03, near * (rocks * 0.7 + peb * 0.45));
        }
        vec3 N = normalize(vN + (near > 0.0 ? near * 0.22 * vec3(vnoise2(vW.xz * 6.0) - 0.5, 0.0, vnoise2(vW.xz * 6.0 + 9.0) - 0.5) : vec3(0.0)));
        float nl = max(dot(N, uSunDir), 0.0);
        vec3 amb = mix(uSkyHorizon, uSkyZenith, 0.5 + 0.5 * N.y);
        vec3 lit = col * (uSunColor * nl * 0.9 + amb * 0.55);
        lit = edlFog(lit, dist, rd);
        gl_FragColor = vec4(lit, 1.0);
      }`;
    const mat = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: vert, fragmentShader: frag });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.receiveShadow = false;
    group.add(mesh);
    // far ring (flat, same shader, catches the horizon)
    const far = new THREE.Mesh(new THREE.PlaneGeometry(600000, 600000, 4, 4).rotateX(-Math.PI / 2), mat);
    far.position.y = -6; far.frustumCulled = false; group.add(far);

    const ready = Promise.all(names.map((n, i) => EDL.util.loadTexture(EDL.data['mosaic_' + n]).then((t) => {
      t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; t.needsUpdate = true; tex[i] = t; return t;
    }).catch((e) => console.warn('[terrain] mosaic failed', n, e)))).then(() => {
      uni.uMosW.value = tex[0]; uni.uMosM.value = tex[1]; uni.uMosF.value = tex[2];
    });

    return {
      group, ready, heightAt, normalAt, mesh, material: mat,
      info: { half: HALF, mosaics: names, touchdown: { x: 0, z: 0 } },
      update() { /* static */ },
      setQuality() {},
    };
  });
})();
