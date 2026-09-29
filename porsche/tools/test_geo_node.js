// Numeric self-test of PG.geo in Node:  node tools/test_geo_node.js
'use strict';
const PG = require('./node_load.js'); const G = PG.geo;
let fails = 0;
function chk(name, mesh, opt) {
  opt = opt || {};
  const r = G.validate(mesh, { expectClosed: opt.closed !== false });
  const vol = opt.volume; let msg = '';
  if (vol !== undefined && abs(r.volume - vol) > (opt.tol || 0.02) * abs(vol)) { r.ok = false; msg += ` volume ${r.volume.toFixed(5)} != ${vol.toFixed(5)}`; }
  if (opt.area !== undefined && abs(r.area - opt.area) > (opt.tol || 0.02) * opt.area) { r.ok = false; msg += ` area ${r.area.toFixed(4)} != ${opt.area.toFixed(4)}`; }
  if (!r.ok) fails++;
  console.log((r.ok ? 'ok   ' : 'FAIL ') + name.padEnd(28) + `v=${r.vertexCount} t=${r.triCount} closed=${r.closed} vol=${r.volume.toFixed(4)} area=${r.area.toFixed(3)}` + (r.issues.length ? ' :: ' + r.issues.join('; ') : '') + msg);
  return r;
}
const abs = Math.abs, PI = Math.PI;
module.exports = { chk, G, PG, fail: () => fails };
if (require.main === module) {
  chk('box', G.box(1, 2, 3), { volume: 6, area: 22 });
  chk('box div', G.box(1, 2, 3, { div: [2, 3, 4] }), { volume: 6, area: 22 });
  chk('roundedBox', G.roundedBox(1, 2, 3, 0.2, 4), { volume: 6 - (4 - PI) * 0.04 * 6 - (10 / 3 * 0.008 * 0) , tol: 0.05 });
  chk('roundedBox r=max', G.roundedBox(1, 1, 1, 0.5, 6), { volume: 4 / 3 * PI * 0.125, tol: 0.03 });
  chk('sphere', G.sphere(1, 48, 24), { volume: 4 / 3 * PI, area: 4 * PI, tol: 0.03 });
  chk('ellipsoid', G.ellipsoid(1, 2, 3, 32, 16), { volume: 4 / 3 * PI * 6, tol: 0.05 });
  chk('cubeSphere', G.cubeSphere(1, 10), { volume: 4 / 3 * PI, tol: 0.05 });
  chk('cylinder', G.cylinder(1, 1, 2, 64, 2), { volume: 2 * PI, area: 2 * PI * 2 + 2 * PI, tol: 0.01 });
  chk('cone', G.cone(1, 2, 64), { volume: PI * 2 / 3, tol: 0.01 });
  chk('frustum', G.cylinder(0.5, 1, 2, 64), { volume: PI * 2 / 3 * (0.25 + 0.5 + 1), tol: 0.01 });
  chk('cylinder open', G.cylinder(1, 1, 2, 32, 1, { caps: false }), { closed: false });
  chk('torus', G.torus(2, 0.5, 48, 24), { volume: 2 * PI * PI * 2 * 0.25, tol: 0.02 });
  chk('disc', G.disc(1, 64), { closed: false, area: PI, tol: 0.01 });
  chk('ring', G.ring(0.5, 1, 64), { closed: false, area: PI * 0.75, tol: 0.01 });
  chk('capsule', G.capsule(0.5, 1, 32, 8), { volume: PI * 0.25 * 1 + 4 / 3 * PI * 0.125, tol: 0.02 });
  chk('plane', G.plane(2, 3, 4, 5), { closed: false, area: 6 });
  chk('grid', G.grid(8, 8, (u, v) => [u, Math.sin(u * 3) * 0.1, -v]), { closed: false, area: 1.02, tol: 0.05 });
  chk('lathe vase', G.lathe([[0, 0], [0.5, 0], [0.5, 0.05], [0.3, 0.5], [0.4, 1], [0.35, 1], [0, 0.9]], 32), { closed: true, area: undefined });
  const s = G.sphere(1, 16, 8); const n = s.normals; const c = s.positions;
  let bad = 0; for (let i = 0; i < c.length; i += 3) { const d = n[i] * c[i] + n[i + 1] * c[i + 1] + n[i + 2] * c[i + 2]; if (d < 0.99) bad++; }
  console.log('sphere normal-radial mismatch', bad);
  if (bad) fails++;
  console.log(fails ? 'FAILURES: ' + fails : 'all ok');
  process.exit(fails ? 1 : 0);
}
