'use strict';
const { chk, G, PG, fail } = require('./test_geo_node.js');
const PI = Math.PI;
// triangulation checks
function triArea(poly, holes, tris) {
  const pts = poly.concat(...holes); let a = 0, neg = 0;
  for (let i = 0; i < tris.length; i += 3) { const p = pts[tris[i]], q = pts[tris[i + 1]], r = pts[tris[i + 2]]; const ar = ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2; a += ar; if (ar < 0) neg++; }
  return { a, neg };
}
function tcheck(name, poly, holes) {
  const t = G.triangulate(poly, holes); const r = triArea(poly, holes, t);
  let exp = Math.abs(G.polygonArea(poly)); for (const h of holes) exp -= Math.abs(G.polygonArea(h));
  const ok = Math.abs(r.a - exp) < 1e-6 * Math.max(1, exp) && r.neg === 0;
  console.log((ok ? 'ok   ' : 'FAIL ') + 'triangulate ' + name + ` area ${r.a.toFixed(4)} exp ${exp.toFixed(4)} neg=${r.neg} tris=${t.length / 3}`);
  if (!ok) process.exitCode = 1;
}
tcheck('square', G.shapes.rect(2, 2), []);
tcheck('concave star', G.shapes.star(1, 0.4, 7), []);
tcheck('gear', G.shapes.gear(1, 0.8, 12), []);
tcheck('ring hole', G.shapes.circle(1, 24), [G.shapes.circle(0.5, 16)]);
tcheck('3 holes', G.shapes.circle(2, 40), [G.shapes.circle(0.3, 12, 1, 0), G.shapes.circle(0.3, 12, -0.5, 0.9), G.shapes.circle(0.3, 12, -0.5, -0.9)]);
tcheck('slot holes', G.shapes.roundRect(4, 2, 0.4, 4), [G.shapes.slot(1.5, 0.4).map(p => [p[0] - 1, p[1]]), G.shapes.slot(1.5, 0.4).map(p => [p[0] + 1, p[1]])]);
const spokes = []; for (let i = 0; i < 5; i++) { const a = i / 5 * 2 * PI; spokes.push(G.shapes.slot(0.6, 0.3, 4).map(p => { const x = p[0] + 0.7, y = p[1]; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; })); }
tcheck('wheel windows', G.shapes.circle(1.2, 48), spokes.concat([G.shapes.circle(0.2, 12)]));

chk('extrude rect', G.extrude(G.shapes.rect(2, 1), 3), { volume: 6 });
chk('extrude star', G.extrude(G.shapes.star(1, 0.4, 7), 0.5));
chk('extrude hole', G.extrude(G.shapes.circle(1, 64), 1, { holes: [G.shapes.circle(0.5, 64)] }), { volume: PI * 0.75, tol: 0.01 });
chk('extrude bevel', G.extrude(G.shapes.roundRect(2, 1, 0.3, 6), 0.4, { bevel: { size: 0.08, segments: 4 } }));
chk('extrude bevel hole', G.extrude(G.shapes.circle(1, 48), 0.4, { holes: [G.shapes.circle(0.5, 32)], bevel: 0.06, center: true }));
chk('extrude gear', G.extrude(G.shapes.gear(1, 0.8, 10), 0.3, { steps: 2 }));
chk('extrude CW input', G.extrude(G.shapes.rect(1, 1).reverse(), 1), { volume: 1 });

// sweeps
const helix = []; for (let i = 0; i <= 80; i++) { const a = i / 80 * 4 * PI; helix.push([Math.cos(a), i / 80 * 2, Math.sin(a)]); }
const R = 0.08;
chk('tube helix', G.tube(helix, R, { radialSegments: 12 }), { volume: 3 * R * R * G.pathLength(helix), tol: 0.03 });
chk('tube round caps', G.tube(helix, R, { radialSegments: 12, caps: 'round' }), { volume: PI * R * R * G.pathLength(helix) + 4 / 3 * PI * R * R * R, tol: 0.05 });
const circle = []; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * PI; circle.push([Math.cos(a), 0, Math.sin(a)]); }
chk('tube closed ring', G.tube(circle, 0.2, { closed: true, radialSegments: 16 }), { volume: 2 * PI * PI * 0.04, tol: 0.03 });
chk('sweep rect', G.sweep(G.shapes.rect(0.2, 0.1), helix), {});
chk('sweep taper', G.sweep(G.shapes.circle(0.1, 12), G.catmullRom([[0, 0, 0], [1, 1, 0], [2, 0, 1], [3, 1, 1]], { segments: 10 }), { scale: t => 1 - 0.8 * t, twist: 3 }));
chk('sweep open profile', G.sweep([[-0.2, 0], [0, 0.1], [0.2, 0]], helix, { closedProfile: false }), { closed: false });
chk('loft circle->square', G.loft([0, 1, 2, 3, 4].map(k => { const t = k / 4, r = []; for (let i = 0; i < 24; i++) { const a = i / 24 * 2 * PI, c = Math.cos(a), s = Math.sin(a), m = Math.max(Math.abs(c), Math.abs(s)); const f = (1 - t) + t / m; r.push([c * f * 0.5, k * 0.3, s * f * 0.5]); } return r; }), { closed: true }));
chk('loft reversed', G.loft([[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]], { closed: true }), { volume: 1 });
chk('loft reversed2', G.loft([[[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], { closed: true }), { volume: 1 });
// wing
const foil = G.naca4(1, 0.04, 0.4, 0.12, 40);
console.log('naca pts', foil.length, 'area', G.polygonArea(foil).toFixed(4), '(CCW>0)');
chk('extrudeAirfoil', G.extrudeAirfoil(foil, 2, { taper: 0.6, sweepDeg: 20, twistDeg: -3, segments: 6 }));
chk('extrudeAirfoil thickTE', G.extrudeAirfoil(G.naca4(1, 0.05, 0.4, 0.1, 40, { teThickness: 0.02 }), 2, { mirror: true, dihedralDeg: 5 }));
chk('naca sym', G.extrudeAirfoil(G.naca('0012', 1, 30), 1, {}), { volume: 0.0822 * 0 + G.polygonArea(G.naca('0012', 1, 30)) });
// utilities
const sp = G.sphere(1, 24, 12);
{ const r = G.validate(G.flip(sp), { expectClosed: true }); console.log('flip sphere volume', r.volume.toFixed(3), r.volume < 0 ? '(ok, negative)' : 'BAD'); if (r.volume >= 0) process.exitCode = 1; }
const half = G.translate(G.box(1, 1, 1), 0, 0, 1);
const mm = G.mirrorZ(half, true); chk('mirrorZ merged', mm, { closed: true, volume: 2 });
chk('mirror only', G.mirrorZ(half), { volume: 1 });
chk('rotate+translate', G.rotate(G.translate(G.box(1, 2, 3), 5, 0, 0), 'y', 0.7), { volume: 6 });
chk('scale neg (mirror)', G.scale(G.box(1, 2, 3), -1, 1, 1), { volume: 6 });
chk('computeNormals flat', G.computeNormals(G.box(1, 1, 1), 30), { volume: 1 });
const welded = G.weld(G.toNonIndexed(G.box(1, 1, 1)), 1e-6); console.log('weld box: verts', welded.positions.length / 3, '(24 expected)');
const cs = G.computeNormals(G.weld(G.box(1, 1, 1), 1e-6, { positionOnly: true }), 180); console.log('smooth box verts', cs.positions.length / 3);
const cr = G.computeNormals(G.weld(G.box(1, 1, 1), 1e-6, { positionOnly: true }), 40); console.log('creased box verts', cr.positions.length / 3, '(24 expected)');
chk('merge', G.merge([G.box(1, 1, 1), G.sphere(1, 8, 4)], [null, PG.m4.translation(3, 0, 0)]), {});
const off = G.offsetPolygon(G.shapes.rect(2, 1), -0.1); console.log('inset rect area', G.polygonArea(off).toFixed(4), '(1.52)');
const off2 = G.offsetPolygon(G.shapes.rect(2, 1), 0.1, { join: 'round' }); console.log('outset rect round area', G.polygonArea(off2).toFixed(4), '(2+0.6+0.0314*... ~2.63)');
const off3 = G.offsetPolygon(G.shapes.star(1, 0.4, 5), -0.05); console.log('inset star pts', off3.length, 'area', G.polygonArea(off3).toFixed(4), 'orig', G.polygonArea(G.shapes.star(1, 0.4, 5)).toFixed(4));
const rp = G.roundPolygon(G.shapes.rect(2, 1), 0.2, 8); console.log('roundPolygon area', G.polygonArea(rp).toFixed(4), 'expect', (2 - (4 - PI) * 0.04).toFixed(4));
const cr2 = G.catmullRom([[0, 0], [1, 1], [2, 0], [3, 1]], { segments: 8 }); console.log('catmull pts', cr2.length, cr2[0], cr2[cr2.length - 1]);
const rs = G.resample(cr2, 10); console.log('resample', rs.length);
const uvb = G.generateUVs(G.sphere(1, 8, 4), { mode: 'box' }); chk('generateUVs box', uvb, {});
process.exit(process.exitCode || (fail() ? 1 : 0));
