// wheels_cams.js - helper: node tools/wheels_cams.js <outbase> "<query>" cam1 cam2 ...   (cams from the table below or app presets)
const { spawnSync } = require('child_process');
const path = require('path');
const C = {
  // custom presets for wheel work [az, el, dist, target]
  fface: [-90, 2, 1.7, [1.2285, 0.35, -0.9]], rface: [-90, 2, 1.8, [-1.2285, 0.36, -0.9]],
  ffaceR: [90, 2, 1.7, [1.2285, 0.35, 0.9]], rfaceR: [90, 2, 1.8, [-1.2285, 0.36, 0.9]],
  fq: [-55, 12, 1.6, [1.2285, 0.33, -0.85]], rq: [-125, 12, 1.7, [-1.2285, 0.34, -0.85]],
  fqR: [55, 12, 1.6, [1.2285, 0.33, 0.85]], rqR: [125, 12, 1.7, [-1.2285, 0.34, 0.85]],
  fcal: [-80, 4, 0.9, [1.2285, 0.25, -0.86]], rcal: [-100, 4, 1.0, [-1.2285, 0.25, -0.86]],
  fcalR: [80, 4, 0.9, [1.2285, 0.25, 0.86]], rcalR: [100, 4, 1.0, [-1.2285, 0.25, 0.86]],
  nut: [-75, 6, 0.6, [1.2285, 0.35, -0.88]], nutR: [75, 6, 0.6, [1.2285, 0.35, 0.88]],
  inner: [-30, 8, 1.6, [1.2285, 0.33, -0.55]], innerR: [30, 8, 1.6, [1.2285, 0.33, 0.55]],
  rinner: [-150, 8, 1.7, [-1.2285, 0.34, -0.55]],
  fprof: [0, 0, 3.5, [1.2285, 0.4, 0]], rprof: [180, 0, 3.5, [-1.2285, 0.4, 0]],
  wtop: [90, 88, 1.7, [1.2285, 0.3, -0.6]], rtop: [90, 88, 1.7, [-1.2285, 0.3, -0.6]], fcalb: [-30, 10, 0.7, [1.2285, 0.25, -0.86]],
  susp1: [-40, 30, 1.3, [1.2285, 0.28, -0.6]], susp2: [-140, 25, 1.4, [-1.2285, 0.28, -0.6]],
  tyre1: [-70, 6, 0.8, [1.2285, 0.45, -0.95]], tread: [-8, 20, 1.0, [1.2285, 0.05, -0.8]],
  low1: [-88, -10, 0.5, [1.2285, 0.05, -0.95]],
};
const [out, query, ...cams] = process.argv.slice(2);
const pre = Object.keys(C).filter(k => cams.includes(k)).map(k => `PG_APP.presets.${k}={az:${C[k][0]},el:${C[k][1]},dist:${C[k][2]},target:${JSON.stringify(C[k][3])},fov:28,limits:{min:0.2,max:12}};`).join('');
const r = spawnSync('node', [path.join(__dirname, 'shot.js'), '--url', 'index.html?shot=1&' + query, '--out', path.join(__dirname, '..', 'shots', out + '.png'), '--w', process.env.W || '1600', '--h', process.env.H || '900', '--cams', cams.join(','), '--eval', (process.env.EV || '') + pre, ...(process.env.LOGS ? ['--logs'] : [])], { stdio: 'inherit' });
process.exit(r.status);
