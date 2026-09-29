'use strict';
const PG = require('./node_load.js'); const G = PG.geo;
const T = (n, f) => { const t = performance.now(); const r = f(); console.log(n.padEnd(34), (performance.now() - t).toFixed(0).padStart(6), 'ms'); return r; };
const big = T('sphere 1000x500 (998k tris)', () => G.sphere(1, 1000, 500));
T('computeNormals smooth', () => G.computeNormals(big, 180));
T('computeNormals crease 30', () => G.computeNormals(big, 30));
T('merge x2 w/ transform', () => G.merge([big, big], [null, PG.m4.translation(3, 0, 0)]));
T('validate', () => G.validate(big, { expectClosed: true }));
T('weld', () => G.weld(G.toNonIndexed(G.sphere(1, 400, 200)), 1e-6));
T('raycaster', () => G.raycaster(big));
T('loft 400x200', () => G.loft(Array.from({ length: 200 }, (_, j) => Array.from({ length: 400 }, (_, i) => { const a = i / 400 * 2 * Math.PI, y = j / 199; return [Math.cos(a) * (0.5 + 0.2 * Math.sin(y * 6)), y, Math.sin(a) * (0.5 + 0.2 * Math.sin(y * 6))]; })), { closed: true }));
T('triangulate 2000-pt circle', () => G.triangulate(G.shapes.circle(1, 2000)));
T('extrude 500-pt gear w/ hole', () => G.extrude(G.shapes.gear(1, 0.9, 125), 0.2, { holes: [G.shapes.circle(0.3, 200)], bevel: 0.01 }));
// offset polygon area check via grid sampling
const star = G.shapes.star(1, 0.4, 5), d = 0.05, off = G.offsetPolygon(star, -d);
function insideDist(p, poly) { let m = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); m = Math.min(m, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)); } return m; }
let cnt = 0; const N = 800; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = [-1 + 2 * i / N, -1 + 2 * j / N]; if (G.pointInPolygon(p, star) && insideDist(p, star) >= d) cnt++; }
console.log('inset star: sampled area', (cnt * 4 / N / N).toFixed(4), 'offsetPolygon area', G.polygonArea(off).toFixed(4));
const out = G.offsetPolygon(star, d, { join: 'round' }); cnt = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = [-1.3 + 2.6 * i / N, -1.3 + 2.6 * j / N]; if (G.pointInPolygon(p, star) || insideDist(p, star) <= d) cnt++; }
console.log('outset star round: sampled area', (cnt * 2.6 * 2.6 / N / N).toFixed(4), 'offsetPolygon area', G.polygonArea(out).toFixed(4));
