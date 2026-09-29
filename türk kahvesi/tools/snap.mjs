// Kullanım: node tools/snap.mjs --t 1,5,9.5 [--out _work/snap] [--sheet sheet.png --cols 4 --size 540] [--full]
//   t: küresel saniyeler. Her biri için 1080x1080 PNG üretir (--full) ya da yalnızca sheet (varsayılan: her ikisi).
//   Ayrıca sayfa hata/uyarılarını yazdırır.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, openApp, appUrl } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const times = String(opt('t', '0')).split(',').map(Number);
const out = path.resolve(root, opt('out', '_work/snap'));
const cols = parseInt(opt('cols', String(Math.min(4, times.length))));
const size = parseInt(opt('size', '540'));
const sheet = opt('sheet', null);
fs.mkdirSync(out, { recursive: true });
const b = await launch({ tag: 'snap' });
try {
  const errs = await openApp(b, appUrl(root, opt('q', 'capture=1'), opt('page', 'index.html')));
  const t0 = performance.now();
  const files = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const ms = await b.evaluate(`(()=>{const a=performance.now(); TKAPP.renderFrame(${t}); return performance.now()-a;})()`);
    const data = await b.evaluate(`TKAPP.canvas.toDataURL('image/png')`);
    const f = path.join(out, `snap_${String(i).padStart(3, '0')}_t${t.toFixed(2)}.png`);
    fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
    files.push(f);
    console.log(`t=${t} -> ${path.relative(root, f)}  (çizim ${ms.toFixed(0)} ms)`);
  }
  const more = await b.evaluate('1', false);
  if (errs.length) console.log('SAYFA HATALARI:\n' + errs.slice(0, 20).join('\n'));
  if (sheet && files.length) {
    const rows = Math.ceil(files.length / cols);
    const sp = path.resolve(root, sheet);
    fs.mkdirSync(path.dirname(sp), { recursive: true });
    if (files.length === 1) { fs.copyFileSync(files[0], sp); console.log('sheet ->', path.relative(root, sp)); process.exitCode = 0; } else {
    const inputs = files.flatMap(f => ['-i', f]);
    const filt = files.map((_, i) => `[${i}:v]scale=${size}:${size}[s${i}]`).join(';') + ';' + files.map((_, i) => `[s${i}]`).join('') + `xstack=inputs=${files.length}:layout=` +
      files.map((_, i) => `${(i % cols) * size}_${Math.floor(i / cols) * size}`).join('|');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filt, '-frames:v', '1', '-y', sp]);
    console.log('sheet ->', path.relative(root, sp));
    }
  }
} finally { await b.close(); }
