#!/usr/bin/env node
// Cross-section / longitudinal-cut plotter for the body (uses the CPU raycaster of ctx.shared.body inside the page, plots with matplotlib).
// node tools/sections.js --url "index.html?shot=1&mods=body" --xs 2.0,1.6,1.2285,0.5,-0.3,-1.2285,-2.0 --zs 0,0.3,0.6,0.8,0.9 --out shots/B_sec.png
'use strict';
const fs = require('fs'); const { spawnSync } = require('child_process');
const { open } = require('./cdp_lib');
const a = process.argv.slice(2), o = { url: 'index.html?shot=1&mods=body&markers=0', xs: '2.0,1.6,1.2285,0.7,0.2,-0.3,-0.9,-1.2285,-1.8,-2.2', zs: '0,0.3,0.6,0.75,0.85,0.92', out: 'shots/B_sec.png' };
for (let i = 0; i < a.length; i += 2) o[a[i].slice(2)] = a[i + 1];
(async () => {
  const page = await open({ url: o.url, w: 800, h: 450, timeout: 120000 });
  const code = `(() => { const rc = PG_APP.ctx.shared.body.raycaster; const xs = [${o.xs}], zs = [${o.zs}]; const sec = {}, lon = {};
    for (const x of xs) { const top = rc.heightAt(x, 0, 3) || 0.9; const yc = 0.5 * (top + 0.12); const pts = [], all = [];
      for (let a = -90; a <= 90; a += 0.4) { const r = a * Math.PI / 180; const hits = rc.castAll([x, yc, 0], [0, Math.sin(r), Math.cos(r)]) || [];
        if (hits.length) { const h = hits[hits.length - 1]; pts.push([h.point[2], h.point[1]]); for (const q of hits) all.push([q.point[2], q.point[1]]); } }
      sec[x] = { pts, all, yc }; }
    for (const z of zs) { const row = []; for (let x = -2.4; x <= 2.4; x += 0.02) { const y = rc.heightAt(x, z, 3); row.push([x, y]); } lon[z] = row; }
    return JSON.stringify({ sec, lon }); })()`;
  const data = await page.eval(code);
  fs.writeFileSync('/tmp/pg_sections.json', data);
  await page.close();
  const py = `
import json, sys, os
Z = [float(v) for v in os.environ.get('ZOOM','-0.05,1.05,0,1.4').split(',')]
ZX=(Z[0],Z[1]); ZY=(Z[2],Z[3])
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
d = json.load(open('/tmp/pg_sections.json'))
secs = d['sec']; lon = d['lon']
n = len(secs); cols = 5; rows = (n + cols - 1) // cols
fig = plt.figure(figsize=(20, 4.2 * rows + 5.2))
gs = fig.add_gridspec(rows + 1, cols, height_ratios=[1] * rows + [1.2])
for i, (x, s) in enumerate(secs.items()):
    ax = fig.add_subplot(gs[i // cols, i % cols])
    pts = s['pts']
    if pts:
        ax.plot([p[0] for p in pts], [p[1] for p in pts], 'r-', lw=1.6)
        ax.plot([-p[0] for p in pts], [p[1] for p in pts], 'r-', lw=0.6, alpha=0.4)
    ax.scatter([p[0] for p in s['all']], [p[1] for p in s['all']], s=1, c='gray', alpha=0.5)
    ax.set_title('x = %s' % x); ax.set_aspect('equal'); ax.set_xlim(ZX[0], ZX[1]); ax.set_ylim(ZY[0], ZY[1]); ax.grid(True, alpha=0.3)
    
ax = fig.add_subplot(gs[rows, :])
for z, row in lon.items():
    xs = [r[0] for r in row if r[1] is not None]; ys = [r[1] for r in row if r[1] is not None]
    ax.plot(xs, ys, label='z=%s' % z)
ax.set_aspect('equal'); ax.grid(True, alpha=0.3); ax.legend(ncol=8); ax.set_xlim(-2.4, 2.4); ax.set_ylim(0.4, 1.35); ax.set_title('top height along x at fixed |z|')
plt.tight_layout(); plt.savefig(sys.argv[1], dpi=60)
`;
  const r = spawnSync('python3', ['-c', py, o.out], { stdio: 'inherit' });
  process.exit(r.status || 0);
})().catch(e => { console.error(e); process.exit(2); });
