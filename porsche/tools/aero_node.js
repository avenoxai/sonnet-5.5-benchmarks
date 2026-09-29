// node tools/aero_node.js : numeric test of aero geometry (agent 'aero')
'use strict';
const PG = require('./node_load.js'); const G = PG.geo;
const vm = require('vm'), fs = require('fs'), path = require('path');
for (const f of ['js/car/spec.js', 'js/car/aero_wing.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
const W = PG.aeroWingGeo(G, { lidY: () => 1.04 });
const L = W.layout;
console.log('mainUnderY', L.mainUnderY.toFixed(4), 'wingTop', L.wingTop, 'flapLE', L.flapLE.map(v=>v.toFixed(4)), 'hinge', L.hinge.map(v=>v.toFixed(4)), 'flapTE', L.flapTE.map(v=>v.toFixed(4)), 'mainTEx', L.mainTEx.toFixed(4));
for (const k of ['main','flap','endplates','uprights']) {
  const r = G.validate(W[k], { expectClosed: true }); const b = G.bounds(W[k]);
  console.log(k.padEnd(10), 'tri', r.triCount, 'closed', r.closed, 'vol', r.volume.toFixed(6), r.issues.join(';'), 'bounds', b.min.map(v=>v.toFixed(3)).join(','), b.max.map(v=>v.toFixed(3)).join(','));
}
// slot gap profile
for (let x = L.flapLE[0]; x > L.mainTEx; x -= 0.02) console.log('x', x.toFixed(3), 'mainTop', L.mainUpper(x).toFixed(4), 'flapLow', L.flapLower(x).toFixed(4), 'gap', (L.flapLower(x)-L.mainUpper(x)).toFixed(4));
