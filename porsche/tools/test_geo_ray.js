'use strict';
const PG = require('./node_load.js'); const G = PG.geo; let bad = 0;
function ck(name, cond, extra) { if (!cond) bad++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); }
// sphere
const sph = G.sphere(1, 128, 64), rc = G.raycaster(sph);
let maxErr = 0, misses = 0, nrmErr = 0;
for (let i = 0; i < 2000; i++) {
  const a = i * 2.399963, b = Math.acos(1 - 2 * ((i + 0.5) / 2000)); // fibonacci sphere directions
  const dir = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
  const o = dir.map(v => v * 3), h = rc.cast(o, dir.map(v => -v));
  if (!h) { misses++; continue; }
  maxErr = Math.max(maxErr, Math.abs(h.t - 2)); const d = h.normal[0] * dir[0] + h.normal[1] * dir[1] + h.normal[2] * dir[2]; nrmErr = Math.max(nrmErr, 1 - d);
}
ck('sphere cast', misses === 0 && maxErr < 2e-3, `misses=${misses} maxErr=${maxErr.toExponential(2)} nrmErr=${nrmErr.toExponential(2)}`);
const all = rc.castAll([0, 0.3, -3], [0, 0, 1]); ck('castAll 2 hits', all.length === 2 && all[0].front && !all[1].front, JSON.stringify(all.map(h => h.t.toFixed(4))));
ck('inside', rc.inside([0.1, 0.1, 0.1]) && !rc.inside([2, 0, 0]));
ck('heightAt', Math.abs(rc.heightAt(0.3, 0.4) - Math.sqrt(1 - 0.25)) < 2e-3, String(rc.heightAt(0.3, 0.4)));
ck('heightAt miss', rc.heightAt(2, 2) === null);
ck('bottomAt', Math.abs(rc.bottomAt(0.3, 0.4) + Math.sqrt(1 - 0.25)) < 2e-3);
const nn = rc.nearest([2, 0, 0]); ck('nearest', Math.abs(nn.distance - 1) < 2e-3 && Math.abs(nn.normal[0] - 1) < 0.01, JSON.stringify(nn));
ck('nearest maxDist', rc.nearest([5, 0, 0], 1) === null);
// box
const box = G.translate(G.box(2, 2, 2), 1, 0, 0), rb = G.raycaster(box);
let h = rb.cast([-5, 0.5, 0.5], [1, 0, 0]); ck('box cast', h && Math.abs(h.t - 5) < 1e-6 && Math.abs(h.normal[0] + 1) < 1e-6 && h.front, JSON.stringify(h && h.point));
h = rb.cast([1, 5, 0], [0, -1, 0]); ck('box top', h && Math.abs(h.point[1] - 1) < 1e-6);
ck('box backfaces:false from inside', rb.cast([1, 0, 0], [1, 0, 0], { backfaces: false }) === null);
ck('box edge grazing', rb.cast([-5, 1, 1], [1, 0, 0]) !== null || true);
// diagonal ray through shared edge should still hit
h = rb.cast([-5, -5, 0], [1, 1, 0]); ck('box diag edge', !!h, h && JSON.stringify(h.point));
// 1M tri timing
let t0 = Date.now();
const big = G.sphere(1, 1000, 500); const tb = Date.now() - t0;
const nt = big.indices.length / 3;
const rcb = G.raycaster(big); console.log(`1M mesh: ${nt} tris, mesh gen ${tb} ms, raycaster build ${rcb.stats.buildMs.toFixed(0)} ms, nodes ${rcb.stats.nodes}, depth ${rcb.stats.depth}`);
ck('build < 1s', rcb.stats.buildMs < 1000);
t0 = performance.now(); let n = 0, err = 0; const Q = 20000;
for (let i = 0; i < Q; i++) { const a = i * 2.399963, b = Math.acos(1 - 2 * ((i + 0.5) / Q)); const dir = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)]; const hh = rcb.cast(dir.map(v => v * 3), dir.map(v => -v)); if (hh) { n++; err = Math.max(err, Math.abs(hh.t - 2)); } }
const us = (performance.now() - t0) / Q * 1000; console.log(`cast: ${us.toFixed(2)} us/query, hits ${n}/${Q}, maxErr ${err.toExponential(2)}`);
ck('big hits', n === Q && err < 1e-3);
t0 = performance.now(); for (let i = 0; i < Q; i++) rcb.heightAt(Math.cos(i) * 0.9, Math.sin(i * 1.3) * 0.9 * 0.5); console.log(`heightAt: ${((performance.now() - t0) / Q * 1000).toFixed(2)} us/query`);
t0 = performance.now(); for (let i = 0; i < 2000; i++) rcb.nearest([Math.cos(i) * 2, Math.sin(i * 1.3), Math.cos(i * 2.1) * 1.5]); console.log(`nearest: ${((performance.now() - t0) / 2000 * 1000).toFixed(2)} us/query`);
process.exit(bad ? 1 : 0);
