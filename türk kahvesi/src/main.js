/* main.js: zaman çizelgesi, yıl sayacı, geçişler, kare çizimi ve oynatıcı.
 * renderFrame(t) SAF: aynı t -> aynı kare. Video export da canlı oynatma da bunu çağırır. */
(function (g) {
'use strict';
const TK = g.TK, { W, H, PAL } = TK;
const DUR = TK.audio.dur;

/* ---- ZAMAN ÇİZELGESİ (müzikten ölçüldü, bkz. src/audio-data.js) ----
 * Ölçülen bölüm sınırları: 7.7 grup girişi, 24.9 sadeleşme (breakdown), 28.7 yeni bölüm,
 * 39.1-41.1 davul fill'i, 41.1 yeni bölüm, 57.5 yeni bölüm (fill 56.9-57.5), 73.3 ani incelme,
 * 77.47 son akor. Vuruş: yaklaşık 0.513 sn (117 BPM); 8 vuruşluk cümle ≈ 4.1 sn. */
const TIMELINE = [
  { id: 'intro',     t0: 0,     t1: 7.7,   tr: 'cut' },
  { id: 'tahtakale', t0: 7.7,   t1: 24.9,  tr: 'cut' },
  { id: 'yola',      t0: 24.9,  t1: 28.7,  tr: 'wipe' },
  { id: 'yol',       t0: 28.7,  t1: 39.1,  tr: 'wipe' },
  { id: 'kusatma',   t0: 39.1,  t1: 41.1,  tr: 'cut' },
  { id: 'viyana',    t0: 41.1,  t1: 57.5,  tr: 'wipe' },
  { id: 'avrupa',    t0: 57.5,  t1: 73.3,  tr: 'wipe' },
  { id: 'final',     t0: 73.3,  t1: DUR,   tr: 'cut', noYear: true },
];

/* ---- YIL SAYACI ---- [t, yıl, ease]  ease: s=smoothstep, l=doğrusal, in=hızlanan, out=yavaşlayan */
const YEAR_KF = [
  [0, 1554, 'l'], [16.5, 1554, 's'], [24.7, 1600, 's'], [28.7, 1615, 's'], [38.9, 1683, 'l'],
  [54.0, 1683, 's'], [57.4, 1686, 'l'], [60.6, 1686, 's'], [61.6, 1720, 'l'], [64.8, 1720, 's'],
  [65.7, 1734, 'l'], [66.4, 1734, 'in'], [72.9, 2026, 'l'], [79.3, 2026, 'l'],
];
function yearAt(t) {
  const K = YEAR_KF;
  if (t <= K[0][0]) return K[0][1];
  for (let i = 0; i < K.length - 1; i++) {
    if (t < K[i + 1][0]) {
      const u = (t - K[i][0]) / (K[i + 1][0] - K[i][0]);
      const e = K[i][2];
      const v = e === 'l' ? u : e === 's' ? TK.smooth(u) : e === 'in' ? Math.pow(u, 2.4) : 1 - Math.pow(1 - u, 2.2);
      return Math.round(K[i][1] + (K[i + 1][1] - K[i][1]) * v);
    }
  }
  return K[K.length - 1][1];
}

/* ---- ÇİZİM ---- */
const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');
let cA = null, cB = null, cM = null, cT = null;
function layer(c) { return c || TK.mkCanvas(W, H); }

function sceneAt(t) {
  for (let i = TIMELINE.length - 1; i >= 0; i--) if (t >= TIMELINE[i].t0) return i;
  return 0;
}
function drawScene(c, sc, t) {
  TK.paper(c);
  const fn = TK.scenes[sc.id];
  const info = { t, lt: Math.max(0, t - sc.t0), dur: sc.t1 - sc.t0, t0: sc.t0, t1: sc.t1, audio: TK.audio, year: yearAt(t), id: sc.id };
  if (fn) {
    c.save();
    fn(c, info.lt, info);
    c.restore();
  } else {
    // sahne henüz yok: yer tutucu
    TK.text(c, sc.id, W / 2, 500, 90, { align: 'center', p: TK.seg(info.lt, 0, 1) });
  }
}
// Kalın boya darbeleriyle kağıdı "boyayarak silen" geçiş maskesi (u: 0..1)
function wipeMask(c, u) {
  c.clearRect(0, 0, W, H);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = '#fff'; c.lineWidth = 190;
  const rows = 8, rowH = (H + 120) / (rows - 1);
  const total = rows * u;
  for (let r = 0; r < rows; r++) {
    const f = Math.max(0, Math.min(1, total - r));
    if (f <= 0) break;
    const y = -60 + r * rowH + Math.sin(r * 2.3) * 14;
    const x0 = r % 2 === 0 ? -100 : W + 100, x1 = r % 2 === 0 ? W + 100 : -100;
    c.beginPath(); c.moveTo(x0, y);
    const xe = x0 + (x1 - x0) * f;
    // hafif dalgalı
    const n = 6;
    for (let k = 1; k <= n; k++) { const xx = x0 + (xe - x0) * (k / n); c.lineTo(xx, y + Math.sin(k * 1.7 + r) * 22); }
    c.stroke();
  }
}
const WIPE = 0.6;   // saniye

const ONLY = new URLSearchParams(location.search).get('only');
function renderFrame(t) {
  t = Math.max(0, Math.min(DUR, t));
  TK.setTime(t);
  if (ONLY) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; drawScene(ctx, TIMELINE.find(x => x.id === ONLY) || { id: ONLY, t0: 0, t1: DUR }, t); return; }
  const i = sceneAt(t), sc = TIMELINE[i];
  // geçiş penceresi: [t0 - WIPE/2, t0 + WIPE/2] (bir sonraki sahnenin girişi)
  const nx = TIMELINE[i + 1];
  let mode = 'single', cur = sc, u = 0, prev = null;
  if (nx && nx.tr === 'wipe' && t > nx.t0 - WIPE / 2) { mode = 'wipe'; prev = sc; cur = nx; u = (t - (nx.t0 - WIPE / 2)) / WIPE; }
  else if (i > 0 && sc.tr === 'wipe' && t < sc.t0 + WIPE / 2) { mode = 'wipe'; prev = TIMELINE[i - 1]; u = (t - (sc.t0 - WIPE / 2)) / WIPE; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (mode === 'wipe') {
    cA = layer(cA); cB = layer(cB); cM = layer(cM); cT = layer(cT);
    const a = cA.getContext('2d'), b = cB.getContext('2d'), m = cM.getContext('2d'), tt = cT.getContext('2d');
    drawScene(a, prev, t);
    drawScene(b, cur, t);
    wipeMask(m, TK.smooth(u));
    tt.globalCompositeOperation = 'source-over'; tt.clearRect(0, 0, W, H);
    tt.drawImage(cM, 0, 0);
    tt.globalCompositeOperation = 'source-in'; tt.drawImage(cB, 0, 0);
    tt.globalCompositeOperation = 'source-over';
    ctx.drawImage(cA, 0, 0);
    ctx.drawImage(cT, 0, 0);
  } else {
    drawScene(ctx, sc, t);
  }
  // yıl sayacı (global katman)
  const showing = (mode === 'wipe') ? (cur.noYear && u > .5 ? false : !(prev.noYear && u < .5)) : !sc.noYear;
  if (showing && t > 3.2) TK.overlay.year(ctx, t);
}

/* ---- Yıl katmanı ---- */
TK.overlay = {
  year(c, t) {
    const y = yearAt(t);
    const appear = TK.seg(t, 3.2, 4.4);
    const s = String(y);
    // rakamlar kalem gibi yazılır (ilk çıkışta), sonra sayaç akar
    TK.text(c, s, W / 2, 968, 82, { align: 'center', p: appear >= 1 ? 1 : appear, seed: 5, w: 5.2, wob: 1.0, slant: 0.03 });
  },
};
TK.yearAt = yearAt;
TK.TIMELINE = TIMELINE;

/* ---- Oynatıcı ---- */
const audioEl = document.getElementById('audio');
const params = new URLSearchParams(location.search);
const ui = { play: document.getElementById('play'), bar: document.getElementById('bar'), time: document.getElementById('time'), wrap: document.getElementById('wrap') };
let started = false, ended = false, stillT = params.has('t') ? parseFloat(params.get('t')) : null;

function fitCanvas() {
  const s = Math.min(g.innerWidth, g.innerHeight - 56);
  canvas.style.width = s + 'px'; canvas.style.height = s + 'px';
}
g.addEventListener('resize', fitCanvas); fitCanvas();

function loop() {
  const t = audioEl.currentTime || 0;
  renderFrame(t);
  if (ui.bar) ui.bar.style.width = (100 * t / DUR).toFixed(2) + '%';
  if (ui.time) ui.time.textContent = t.toFixed(1) + ' / ' + DUR.toFixed(1) + ' sn';
  requestAnimationFrame(loop);
}
function startPlay() {
  ui.wrap.classList.add('playing');
  if (ended) { audioEl.currentTime = 0; ended = false; }
  audioEl.play().then(() => { started = true; }).catch(() => { ui.wrap.classList.remove('playing'); });
}
if (ui.play) ui.play.addEventListener('click', startPlay);
canvas.addEventListener('click', () => { if (audioEl.paused) startPlay(); else { audioEl.pause(); ui.wrap.classList.remove('playing'); } });
audioEl.addEventListener('ended', () => { ended = true; ui.wrap.classList.remove('playing'); });
g.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (audioEl.paused) startPlay(); else audioEl.pause(); }
  if (e.code === 'ArrowLeft') audioEl.currentTime = Math.max(0, audioEl.currentTime - 2);
  if (e.code === 'ArrowRight') audioEl.currentTime = Math.min(DUR, audioEl.currentTime + 2);
});
const barWrap = document.getElementById('barwrap');
if (barWrap) barWrap.addEventListener('click', (e) => { const r = barWrap.getBoundingClientRect(); audioEl.currentTime = DUR * (e.clientX - r.left) / r.width; });

g.TKAPP = { renderFrame, canvas, DUR, timeline: TIMELINE };
if (params.get('capture')) { document.body.classList.add('capture'); }
else if (stillT !== null) { renderFrame(stillT); }
else { requestAnimationFrame(loop); }
g.TKREADY = true;
})(window);
