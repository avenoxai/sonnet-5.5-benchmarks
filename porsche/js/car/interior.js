'use strict';
// car/interior.js — compact cockpit (order 60): carbon bucket seats with Race-Tex inserts, 360 mm steering wheel with yellow marker,
// dashboard with instrument binnacle, centre tunnel, rear shelf and rollover bar. Seen through the tinted glass and from the cockpit camera.
(function () {
  const PG = window.PG, G = PG.geo, m4 = PG.m4, spec = PG.spec;
  const A = spec.anchors;

  PG.registerModule({
    name: 'interior', order: 60,
    async build(ctx) {
      const M = PG.mats;
      const carbon = M.carbonTwill, fabric = M.alcantara, plastic = M.plasticBlack, gloss = M.plasticGloss;
      const yellow = new PG.Material({ name: 'int_yellow', baseColor: PG.util.hex('#f2c200'), roughness: 0.5 });
      const belt = new PG.Material({ name: 'int_belt', baseColor: PG.util.hex('#b0101a'), roughness: 0.7 });
      const screenMat = new PG.Material({ name: 'int_screen', baseColor: [0.01, 0.012, 0.015], roughness: 0.08, clearcoat: 1, emissive: [0.05, 0.16, 0.22], emissiveIntensity: 0.6 });
      const T = (mesh, x, y, z, rx, ry, rz) => G.transform(mesh, m4.chain(m4.translation(x, y, z), m4.rotationY(ry || 0), m4.rotationZ(rz || 0), m4.rotationX(rx || 0)));

      // ---- one seat (local origin: seat pan front-centre, +X forward); z is the seat centre line
      function seat(z) {
        const sx = A.driverSeat.x, base = 0.30;
        const shell = G.merge([
          T(G.roundedBox(0.52, 0.09, 0.50, 0.035, 3), sx - 0.20, base, z),
          T(G.roundedBox(0.09, 0.66, 0.50, 0.04, 3), sx - 0.50, base + 0.34, z, 0, 0, 0.20),
          T(G.roundedBox(0.36, 0.17, 0.06, 0.03, 3), sx - 0.18, base + 0.10, z - 0.26),
          T(G.roundedBox(0.36, 0.17, 0.06, 0.03, 3), sx - 0.18, base + 0.10, z + 0.26),
          T(G.roundedBox(0.10, 0.34, 0.09, 0.03, 3), sx - 0.60, base + 0.55, z - 0.27, 0, 0, 0.20),
          T(G.roundedBox(0.10, 0.34, 0.09, 0.03, 3), sx - 0.60, base + 0.55, z + 0.27, 0, 0, 0.20),
          T(G.roundedBox(0.09, 0.22, 0.34, 0.04, 3), sx - 0.635, base + 0.86, z, 0, 0, 0.20),
        ]);
        const cushion = G.merge([
          T(G.roundedBox(0.44, 0.03, 0.34, 0.012, 2), sx - 0.19, base + 0.06, z),
          T(G.roundedBox(0.03, 0.54, 0.34, 0.012, 2), sx - 0.455, base + 0.36, z, 0, 0, 0.20),
        ]);
        const straps = G.merge([
          T(G.roundedBox(0.012, 0.62, 0.06, 0.004, 2), sx - 0.445, base + 0.50, z - 0.11, 0, 0, 0.20),
          T(G.roundedBox(0.012, 0.62, 0.06, 0.004, 2), sx - 0.445, base + 0.50, z + 0.11, 0, 0, 0.20),
        ]);
        return { shell, cushion, straps };
      }
      for (const [nm, z] of [['L', A.driverSeat.z], ['R', A.passengerSeat.z]]) {
        const s = seat(z);
        ctx.add({ name: 'interior_seat_' + nm, mesh: s.shell, material: carbon, reflect: false });
        ctx.add({ name: 'interior_seat_' + nm + '_pad', mesh: s.cushion, material: fabric, reflect: false, castShadow: false });
        ctx.add({ name: 'interior_seat_' + nm + '_belt', mesh: s.straps, material: belt, reflect: false, castShadow: false });
      }

      // ---- steering wheel (tilted ~20 deg toward the driver), pivots with PG.state.steer
      const SW = A.steeringWheel;
      const wheelLocal = G.merge([
        G.torus(0.178, 0.0165, 48, 14),                                       // rim (axis +Y)
        G.cylinder(0.040, 0.046, 0.030, 24, 1),                               // hub
        T(G.roundedBox(0.30, 0.016, 0.028, 0.006, 2), 0, 0, 0),              // horizontal spoke
        T(G.roundedBox(0.028, 0.016, 0.14, 0.006, 2), 0, 0, 0.09),           // lower spoke
      ]);
      const marker = G.translate(G.roundedBox(0.012, 0.020, 0.030, 0.004, 2), 0.178, 0, 0);
      const swBase = m4.chain(m4.translation(SW.x, SW.y, SW.z), m4.rotationZ(1.22));
      const swGroup = ctx.add({ name: 'interior_wheel', mesh: null, matrix: swBase });
      ctx.add({ name: 'interior_wheel_rim', mesh: wheelLocal, material: fabric, parent: swGroup, reflect: false });
      // marker sits at 12 o'clock: rim plane is XZ in local space; 12 o'clock = local -Z
      ctx.add({ name: 'interior_wheel_mark', mesh: G.transform(marker, m4.rotationY(-Math.PI / 2)), material: yellow, parent: swGroup, reflect: false, castShadow: false });
      ctx.onUpdate(() => { swGroup.matrix = m4.chain(swBase, m4.rotationY(-(PG.state.steer || 0) * 8)); });

      // ---- dashboard, binnacle with cluster, centre tunnel, PCM screen, rear shelf, roll bar
      const dash = G.merge([
        T(G.roundedBox(0.36, 0.15, 1.34, 0.05, 3), 0.53, 0.83, 0),
        T(G.roundedBox(0.20, 0.13, 0.46, 0.05, 3), 0.50, 0.94, A.steeringWheel.z),
        T(G.roundedBox(0.94, 0.17, 0.22, 0.06, 3), 0.02, 0.27, 0),
        T(G.roundedBox(0.30, 0.12, 0.10, 0.04, 3), 0.28, 0.40, 0.02),
      ]);
      ctx.add({ name: 'interior_dash', mesh: dash, material: fabric, reflect: false });
      const scr = G.merge([
        T(G.roundedBox(0.012, 0.11, 0.36, 0.006, 2), 0.404, 0.945, A.steeringWheel.z, 0, 0, 0.35),
        T(G.roundedBox(0.012, 0.13, 0.22, 0.006, 2), 0.375, 0.78, 0.04, 0, 0, 0.30),
      ]);
      ctx.add({ name: 'interior_screens', mesh: scr, material: screenMat, reflect: false, castShadow: false });
      const shelf = T(G.roundedBox(0.70, 0.05, 1.34, 0.02, 2), -0.98, 0.36, 0);
      ctx.add({ name: 'interior_shelf', mesh: shelf, material: carbon, reflect: false });
      const bar = G.tube([[-0.86, 0.34, -0.64], [-0.86, 1.00, -0.62], [-0.86, 1.10, -0.28], [-0.86, 1.10, 0.28], [-0.86, 1.00, 0.62], [-0.86, 0.34, 0.64]], 0.019, { radialSegments: 12, caps: 'round' });
      ctx.add({ name: 'interior_rollbar', mesh: bar, material: gloss, reflect: false });
      const floor = T(G.roundedBox(2.6, 0.02, 1.5, 0.008, 2), -0.10, 0.13, 0);
      ctx.add({ name: 'interior_floor', mesh: floor, material: plastic, reflect: false, castShadow: false });
      ctx.progress('interior', 1);
    },
  });
})();
