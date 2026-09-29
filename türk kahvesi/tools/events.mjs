// Kullanım: node tools/events.mjs <t0> <t1> [low|mid|hi] [minStrength]
// Müzik olaylarını (vuruş/nota başlangıçları) listeler. src/audio-data.js'i okur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/audio-data.js'), 'utf8');
const window = {}; new Function('window', src)(window);
const D = window.AUDIO;
const [t0, t1, kind = 'low', min = '0'] = process.argv.slice(2);
const list = kind === 'low' ? D.evLow : kind === 'mid' ? D.evMid : D.evHi;
const ev = list.filter(e => e[0] >= +t0 && e[0] < +t1 && e[1] >= +min);
console.log(`${kind} olayları [${t0}, ${t1}): ${ev.length} adet (t:güç)`);
console.log(ev.map(e => `${e[0].toFixed(2)}:${e[1].toFixed(1)}`).join('  '));
// yoğunluk (0.5 sn'lik dilimlerde rms/low/hi)
let line = '';
for (let t = +t0; t < +t1; t += 0.5) {
  const i = Math.min(D.rms.length - 1, Math.round(t * D.fps));
  line += `${t.toFixed(1)}:${D.rms[i].toFixed(2)}/${D.low[i].toFixed(2)}/${D.hi[i].toFixed(2)}  `;
}
console.log('\nzarf (t: rms/low/hi):\n' + line);
