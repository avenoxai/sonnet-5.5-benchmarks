#!/usr/bin/env node
// Numeric silhouette profile of the REAL rendered geometry versus the PG.spec reference target.
//
// Usage:
//   node tools/profile.js --url "index.html?shot=1&mods=body" --view side|top|front|rear [options]
//
// Options:
//   --view <side|sider|top|front|rear>   which orthographic silhouette to measure (default side)
//   --step <m>          sampling step along the horizontal axis (default 0.1; x for side/top, z for front/rear)
//   --ref <body|full|none>   reference to compare with: body = PG.spec body only (default; wheels, mirrors, wing are NOT in it, so a whole-car
//                       silhouette shows them as positive deviations), full = also wheels + mirrors + wing envelope, none = no comparison
//   --range a,b         restrict the sampled horizontal range (metres)
//   --w <px> --h <px>   viewport (default 2400x1200 -> ~440 px/m on the side view, 1 px = ~2.3 mm; edges are sub-pixel from 8x MSAA)
//   --scale <px/m>      force a pixel scale instead of fit      --target x,y,z   camera target (default: car centre of that view)
//   --csv <file>        also write the table as CSV          --json   print the raw JSON result instead of the table
//   --timeout <ms>      wait for the page (default 180000)   --logs   print page console output
// The page is rendered through PG_APP.scan(): a debug=silhouette (flat unlit car on white, no floor/shadows/post) TRUE orthographic frame, read back
// with gl.readPixels. Per column it reports the upper / lower silhouette edge (sub-pixel from the MSAA coverage). Works for any module set
// (mods=, only=). Side view: x -> y_top, y_bottom; top view: x -> half width (widest side; 'off' = lateral centre offset in mm);
// front/rear: z -> y_top, y_bottom (the reference there is only the rough box). dev = measured - reference in millimetres (+ = car is bigger).
// Exit code 0 (2 when the page never became ready, 1 on bad arguments).
'use strict';
const fs = require('fs');
const { open } = require('./cdp_lib');

function args(argv) {
  const o = { view: 'side', step: 0.1, ref: 'body', w: 2400, h: 1200, timeout: 180000, url: 'index.html?shot=1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], nx = () => argv[++i];
    if (a === '--url') o.url = nx(); else if (a === '--view') o.view = nx(); else if (a === '--step') o.step = +nx(); else if (a === '--ref') o.ref = nx();
    else if (a === '--w') o.w = +nx(); else if (a === '--h') o.h = +nx(); else if (a === '--scale') o.scale = +nx(); else if (a === '--csv') o.csv = nx();
    else if (a === '--json') o.json = true; else if (a === '--logs') o.logs = true; else if (a === '--timeout') o.timeout = +nx();
    else if (a === '--range') o.range = nx().split(',').map(Number);
    else if (a === '--target') o.target = nx().split(',').map(Number);
    else { console.error('unknown argument ' + a); process.exit(1); }
  }
  if (!['side', 'sider', 'top', 'front', 'rear'].includes(o.view)) { console.error('--view must be side|sider|top|front|rear'); process.exit(1); }
  if (!(o.step > 0)) { console.error('--step must be > 0'); process.exit(1); }
  if (!/[?&]shot=/.test(o.url)) o.url += (o.url.includes('?') ? '&' : '?') + 'shot=1';
  return o;
}
const f = (v, n, w) => (v === null || v === undefined || Number.isNaN(v) ? '-' : v.toFixed(n)).padStart(w);
const mm = (a, b) => (a === null || b === null || a === undefined || b === undefined) ? null : (a - b) * 1000;
function stats(list) {
  const v = list.filter(q => q !== null && !Number.isNaN(q)); if (!v.length) return null;
  let mx = 0, at = 0, sum = 0, ss = 0; v.forEach((q, i) => { sum += q; ss += q * q; if (Math.abs(q) > Math.abs(mx)) { mx = q; at = i; } });
  return { n: v.length, mean: sum / v.length, rms: Math.sqrt(ss / v.length), max: mx };
}

(async () => {
  const o = args(process.argv.slice(2));
  let page;
  try { page = await open({ url: o.url, w: o.w, h: o.h, timeout: o.timeout, logs: o.logs }); }
  catch (e) { console.error(String(e.message || e)); process.exit(2); }
  try {
    const opts = { view: o.view, step: o.step }; if (o.scale) opts.scale = o.scale; if (o.range) opts.range = o.range; if (o.target) opts.target = o.target;
    const res = await page.eval(`PG_APP.scan(${JSON.stringify(opts)}).then(r => JSON.stringify(r))`, true).then(JSON.parse);
    const xs = res.rows.map(r => r.h);
    let ref = null;
    if (o.ref !== 'none') ref = await page.eval(`JSON.stringify(PG_APP.referenceAt(${JSON.stringify(o.view)}, ${JSON.stringify(xs)}, ${o.ref === 'full'}))`).then(JSON.parse);
    const spec = await page.eval('JSON.stringify({length: PG.spec.length, noseX: PG.spec.noseX, tailX: PG.spec.tailX, width: PG.spec.width, height: PG.spec.height, roofMaxY: PG.spec.roofMaxY, widthWithMirrors: PG.spec.widthWithMirrors})').then(JSON.parse);
    const built = await page.eval('JSON.stringify(PG_APP.builtModules)').then(JSON.parse);
    if (o.json) { console.log(JSON.stringify({ result: res, ref, spec, built }, null, 1)); await page.close(); process.exit(0); }

    const side = o.view === 'side' || o.view === 'sider', topv = o.view === 'top', hn = side || topv ? 'x' : 'z';
    console.log(`profile ${o.view}  url=${o.url}  modules=${built.join(',') || '-'}  ref=${o.ref}`);
    console.log(`image ${res.size[0]}x${res.size[1]}  ${res.ppm.toFixed(1)} px/m  (1 px = ${res.mmPerPx.toFixed(2)} mm, sub-pixel edges)  horizontal axis = world ${res.hAxis}, vertical = world ${res.vAxis}`);
    const lines = [], csv = [];
    let dTop = [], dBot = [], dHw = [];
    if (side || !topv) {
      const head = `${hn.padStart(7)} ${'y_top'.padStart(8)} ${'ref_top'.padStart(8)} ${'dev_mm'.padStart(8)} | ${'y_bot'.padStart(8)} ${'ref_bot'.padStart(8)} ${'dev_mm'.padStart(8)}`;
      lines.push(head); csv.push(`${hn},y_top,ref_top,dev_top_mm,y_bot,ref_bot,dev_bot_mm`);
      res.rows.forEach((r, i) => {
        const rt = ref ? ref.top[i] : null, rb = ref ? ref.bottom[i] : null, dt = mm(r.hi, rt), db = mm(r.lo, rb);
        dTop.push(dt); dBot.push(db);
        lines.push(`${f(r.h, 3, 7)} ${f(r.hi, 4, 8)} ${f(rt, 4, 8)} ${f(dt, 1, 8)} | ${f(r.lo, 4, 8)} ${f(rb, 4, 8)} ${f(db, 1, 8)}`);
        csv.push([r.h, r.hi, rt, dt, r.lo, rb, db].map(v => v === null || v === undefined ? '' : v).join(','));
      });
    } else {
      const head = `${'x'.padStart(7)} ${'half_w'.padStart(8)} ${'ref_hw'.padStart(8)} ${'dev_mm'.padStart(8)} | ${'off_mm'.padStart(8)}   (off = lateral centre offset of the silhouette, +z)`;
      lines.push(head); csv.push('x,half_width,ref_hw,dev_mm,center_offset_mm');
      res.rows.forEach((r, i) => {
        const hw = r.hi === null ? null : Math.max(r.hi, -r.lo), rh = ref ? ref.hw[i] : null, d = mm(hw, rh), off = r.hi === null ? null : (r.hi + r.lo) * 500;
        dHw.push(d);
        lines.push(`${f(r.h, 3, 7)} ${f(hw, 4, 8)} ${f(rh, 4, 8)} ${f(d, 1, 8)} | ${f(off, 1, 8)}`);
        csv.push([r.h, hw, rh, d, off].map(v => v === null || v === undefined ? '' : v).join(','));
      });
    }
    console.log(lines.join('\n'));
    // summary
    const e = res.extent;
    console.log('---- summary');
    if (!e) console.log('no silhouette found (empty scene?)');
    else if (side) {
      console.log(`x extent   ${e.hMin.toFixed(3)} .. ${e.hMax.toFixed(3)}  length ${(e.hMax - e.hMin).toFixed(3)} m   (spec tail ${spec.tailX} .. nose ${spec.noseX}, length ${spec.length};  dev tail ${((e.hMin - spec.tailX) * 1000).toFixed(0)} mm, nose ${((e.hMax - spec.noseX) * 1000).toFixed(0)} mm)`);
      let bi = 0; res.rows.forEach((r, i) => { if (r.hi !== null && (res.rows[bi].hi === null || r.hi > res.rows[bi].hi)) bi = i; });
      console.log(`height     top ${e.vMax.toFixed(3)} m, lowest ${e.vMin.toFixed(3)} m   (spec roof ${spec.roofMaxY}, overall ${spec.height} incl. wing)   highest sampled column x=${res.rows[bi].h.toFixed(2)}`);
    } else if (topv) {
      console.log(`x extent   ${e.hMin.toFixed(3)} .. ${e.hMax.toFixed(3)}  length ${(e.hMax - e.hMin).toFixed(3)} m   (spec length ${spec.length})`);
      console.log(`width      z ${e.vMin.toFixed(3)} .. ${e.vMax.toFixed(3)}  = ${(e.vMax - e.vMin).toFixed(3)} m   (spec ${spec.width} body, ${spec.widthWithMirrors} with mirrors)`);
    } else {
      console.log(`width      z ${e.hMin.toFixed(3)} .. ${e.hMax.toFixed(3)}  = ${(e.hMax - e.hMin).toFixed(3)} m   (spec ${spec.width} body, ${spec.widthWithMirrors} with mirrors)`);
      console.log(`height     ${e.vMin.toFixed(3)} .. ${e.vMax.toFixed(3)} m   (spec roof ${spec.roofMaxY}, overall ${spec.height} incl. wing; the reference here is only the rough box)`);
    }
    const S = (name, l) => { const s = stats(l); if (s) console.log(`${name.padEnd(10)} n=${s.n}  mean ${s.mean.toFixed(1)} mm  rms ${s.rms.toFixed(1)} mm  worst ${s.max.toFixed(1)} mm`); };
    if (ref) { S('dev top', dTop); S('dev bottom', dBot); S('dev width', dHw); }
    if (o.csv) { fs.writeFileSync(o.csv, csv.join('\n') + '\n'); console.log('csv written to ' + o.csv); }
    await page.close();
    process.exit(0);
  } catch (e) {
    console.error('profile failed: ' + (e && e.message || e));
    try { await page.close(); } catch (_) {}
    process.exit(2);
  }
})();
