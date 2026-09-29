// Video export: her kare TKAPP.renderFrame(t) ile (tarayıcıda, JavaScript ile) çizilir; PNG olarak ffmpeg'e akar.
// Kullanım: node tools/render.mjs [--out dosya.mp4] [--fps 30] [--workers 4] [--seg 90] [--from 0] [--to 79.21] [--size 1080]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, openApp, appUrl } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = parseFloat(opt('fps', '30'));
const WORKERS = parseInt(opt('workers', '4'));
const SEG = parseInt(opt('seg', '90'));
const SIZE = parseInt(opt('size', '1080'));
const out = path.resolve(root, opt('out', '_work/render/out.mp4'));
const noAudio = args.includes('--no-audio');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-render-'));
fs.mkdirSync(path.dirname(out), { recursive: true });

// süre
const probe = await launch({ tag: 'probe' });
let DUR;
try { await openApp(probe, appUrl(root)); DUR = await probe.evaluate('TKAPP.DUR', false); } finally { await probe.close(); }
const from = parseFloat(opt('from', '0')), to = Math.min(DUR, parseFloat(opt('to', String(DUR))));
const f0 = Math.round(from * FPS), f1 = Math.ceil(to * FPS - 1e-6);   // [f0, f1)
const segs = [];
for (let a = f0, i = 0; a < f1; a += SEG, i++) segs.push({ i, a, b: Math.min(f1, a + SEG), file: path.join(tmp, `seg_${String(i).padStart(3, '0')}.mp4`) });
console.log(`süre ${DUR}s, kare ${f1 - f0} @${FPS}fps, ${segs.length} parça, ${WORKERS} işçi`);

let next = 0, done = 0; const t0 = performance.now();
const vf = `scale=${SIZE}:${SIZE}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`;
async function worker(w) {
  const b = await launch({ tag: 'render' + w, width: 1200, height: 1200 });
  try {
    const errs = await openApp(b, appUrl(root));
    if (errs.length) console.log(`[işçi ${w}] uyarılar:`, errs.slice(0, 5).join(' | '));
    while (true) {
      const s = segs[next++]; if (!s) break;
      const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-profile:v', 'high', '-bf', '2', '-g', '60',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(FPS), s.file], { stdio: ['pipe', 'inherit', 'inherit'] });
      const closed = new Promise(r => ff.on('close', r));
      for (let f = s.a; f < s.b; f++) {
        const data = await b.evaluate(`(()=>{TKAPP.renderFrame(${(f / FPS).toFixed(6)}); return TKAPP.canvas.toDataURL('image/png');})()`);
        const buf = Buffer.from(data.slice(22), 'base64');
        if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      }
      ff.stdin.end(); await closed; done += (s.b - s.a);
      const el = (performance.now() - t0) / 1000;
      console.log(`parça ${s.i + 1}/${segs.length} tamam | ${done}/${f1 - f0} kare | ${el.toFixed(0)} sn | kalan ≈ ${(el / done * (f1 - f0 - done)).toFixed(0)} sn`);
    }
  } finally { await b.close(); }
}
await Promise.all(Array.from({ length: Math.min(WORKERS, segs.length) }, (_, w) => worker(w)));

const list = path.join(tmp, 'list.txt');
fs.writeFileSync(list, segs.map(s => `file '${s.file}'`).join('\n'));
const mux = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list];
if (!noAudio) mux.push('-ss', String(f0 / FPS), '-i', path.join(root, 'muzik.m4a'), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest');
mux.push('-c:v', 'copy', '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0', '-movflags', '+faststart', out);
execFileSync('ffmpeg', mux);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('bitti ->', path.relative(root, out), ((performance.now() - t0) / 1000).toFixed(0) + ' sn');
