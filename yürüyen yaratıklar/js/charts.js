/* charts.js  -  "Şekil 1": nesilden nesile uygunluk grafiği.
 *
 * Bilimsel levha gibi: silik ızgara, mono rakamlı eksenler, en iyi / ortanca / ortalama çizgileri, rekor basamağı,
 * rekor kıran nesillerde şampiyon işaretleri. Fareyle üzerine gelince ipucu, tıklayınca onPick(gen).
 */
(function (global) {
  'use strict';
  const YY = (global.YY = global.YY || {});
  const INK = '44,35,23';
  const C = { best: '#1f4e70', median: '#94651f', mean: '#26755f', record: '#a3283a' };
  const M = { l: 38, r: 10, t: 20, b: 32 };

  /** y ekseni için "güzel" ölçek: adım 1/2/2.5/5 x 10^k, 3-5 aralık; veriyi sığdıran en küçük tepe. */
  function niceScale(v) {
    if (!(v > 0)) return { top: 1, nt: 4 };
    let best = null; const mag0 = Math.floor(Math.log10(v)) - 1, big = v >= 8; // 8 m / puan üstünde tam sayı adımlar: "12,5 / 7,5" gibi gürültü olmasın
    for (let m = mag0; m <= mag0 + 3; m++) for (const f of big ? [1, 2, 5] : [1, 2, 2.5, 5]) for (let nt = 3; nt <= 5; nt++) {
      const step = f * Math.pow(10, m), top = step * nt; if (big && step < 1) continue;
      if (top >= v * 1.02 && (!best || top < best.top - 1e-9 || (Math.abs(top - best.top) < 1e-9 && nt > best.nt))) best = { top, nt };
    }
    return best || { top: v, nt: 4 };
  }
  function axisFmt(v, step) {
    const whole = (x) => Math.abs(x - Math.round(x)) < 1e-9; // tüm etiketler aynı ondalık sayısıyla: 1,00 / 0,75 / 0,50 ...
    return YY.fmt(v, whole(step) ? 0 : whole(step * 10) ? 1 : 2);
  }

  class FitnessChart {
    /** @param {HTMLCanvasElement} canvas @param {{onPick:(gen:number)=>void, hasChampion:(gen:number)=>boolean}} opts */
    constructor(canvas, opts) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.opts = opts || {};
      this.mode = 'fit'; this.hist = []; this.cur = null; this.hover = -1; this.dpr = 1; this.w = 0; this.h = 0;
      this.dirty = true; this.recIdx = null; this.dom = null; this.notes = [];
      canvas.addEventListener('mousemove', (e) => this.onMove(e));
      canvas.addEventListener('mouseleave', () => { if (this.hover !== -1) { this.hover = -1; this.dirty = true; } });
      canvas.addEventListener('click', (e) => this.onClick(e));
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { this.dirty = true; }).observe(canvas);
    }
    setMode(m) { this.mode = m; this.dirty = true; }
    /** Defter kenarı notları: [{gen, text}] (dönüm noktaları) */
    setNotes(n) { const a = JSON.stringify(n); if (a !== this.notesKey) { this.notesKey = a; this.notes = n; this.dirty = true; } }
    /** history: trainer.history; cur: {gen, value} canlı (henüz bitmemiş) nesil noktası */
    setData(history, cur) {
      if (history !== this.hist || history.length !== this.n) { this.hist = history; this.n = history.length; this.dirty = true; }
      const cv = cur ? Math.round(cur.value * 20) : -1;
      if (!this.cur !== !cur || (cur && (cur.gen !== this.cur.gen || cv !== this.curQ))) this.dirty = true;
      this.cur = cur; this.curQ = cv;
    }

    series(h) {
      const d = this.mode === 'dist';
      return { best: d ? h.bestDist : h.best, median: d ? null : h.median, mean: d ? h.meanDist : h.mean };
    }

    layout() {
      const c = this.c, w = c.clientWidth, h = c.clientHeight, dpr = Math.min(2, global.devicePixelRatio || 1);
      if (w !== this.w || h !== this.h || dpr !== this.dpr || c.width !== Math.round(w * dpr)) {
        this.w = w; this.h = h; this.dpr = dpr; c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); this.dirty = true;
      }
      return w > 20 && h > 20;
    }

    /** Veri aralığı ve ölçekler. */
    computeDomain() {
      const H = this.hist, n = H.length; let g0 = 1, g1 = 6, ymax = 0;
      if (n) { g0 = H[0].gen; g1 = Math.max(H[n - 1].gen, g0 + 5); }
      if (this.cur) g1 = Math.max(g1, this.cur.gen);
      for (let i = 0; i < n; i++) {
        const s = this.series(H[i]);
        for (const k of ['best', 'median', 'mean']) { const v = s[k]; if (v > ymax && isFinite(v)) ymax = v; }
      }
      if (this.cur && this.cur.value > ymax) ymax = this.cur.value;
      const sc = niceScale(ymax);
      this.dom = { g0, g1, top: sc.top, nt: sc.nt };
      this.pw = this.w - M.l - M.r; this.ph = this.h - M.t - M.b;
    }
    X(g) { return M.l + (this.dom.g1 === this.dom.g0 ? 0 : (g - this.dom.g0) / (this.dom.g1 - this.dom.g0)) * this.pw; }
    Y(v) { return M.t + this.ph - (v / this.dom.top) * this.ph; }

    draw() {
      if (!this.layout()) return;
      if (!this.dirty) return; this.dirty = false;
      const ctx = this.ctx, w = this.w, h = this.h, H = this.hist, n = H.length;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      this.computeDomain();
      const dom = this.dom;
      // yatay ızgara + y ekseni
      const nt = dom.nt, stepV = dom.top / nt;
      ctx.font = `10.5px ${YY.MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.lineWidth = 1;
      for (let i = 0; i <= nt; i++) {
        const v = stepV * i, y = Math.round(this.Y(v)) + 0.5;
        ctx.strokeStyle = i === 0 ? `rgba(${INK},.75)` : `rgba(${INK},.14)`; ctx.setLineDash(i === 0 ? [] : [2, 3]);
        ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(w - M.r, y); ctx.stroke();
        ctx.fillStyle = `rgb(${INK})`; ctx.fillText(axisFmt(v, stepV), M.l - 6, y);
      }
      ctx.setLineDash([]);
      // x ekseni: nesil sayıları (yuvarlak adımlar)
      const span = dom.g1 - dom.g0, gstep = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find((s) => span / s <= 6) || 1000;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.beginPath();
      for (let g = Math.ceil(dom.g0 / gstep) * gstep; g <= dom.g1; g += gstep) {
        const x = Math.round(this.X(g)) + 0.5; ctx.moveTo(x, M.t + this.ph); ctx.lineTo(x, M.t + this.ph + 4);
        ctx.fillStyle = `rgb(${INK})`; ctx.fillText(String(g), x, M.t + this.ph + 6);
      }
      if (dom.g0 === 1 || true) { const x = Math.round(this.X(dom.g0)) + 0.5; ctx.moveTo(x, M.t + this.ph); ctx.lineTo(x, M.t + this.ph + 4); }
      ctx.strokeStyle = `rgba(${INK},.75)`; ctx.stroke();

      if (n === 0) {
        ctx.fillStyle = `rgba(${INK},.78)`; ctx.font = `italic 13px ${YY.SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('İlk nesil bitince eğri burada belirir.', M.l + this.pw / 2, M.t + this.ph / 2 - 8);
        ctx.font = `italic 12px ${YY.SERIF}`; ctx.fillStyle = `rgba(${INK},.6)`; ctx.fillText('Her nokta bir neslin sonucudur.', M.l + this.pw / 2, M.t + this.ph / 2 + 10);
        this.drawCur(ctx); return;
      }

      // nokta seyreltme: çok uzun geçmişte piksel başına bir örnek
      const stride = Math.max(1, Math.floor(n / Math.max(40, this.pw * 1.2)));
      const idx = []; for (let i = 0; i < n; i += stride) idx.push(i); if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);

      // rekor basamağı + rekor kıran nesiller
      const isDist = this.mode === 'dist';
      let run = -Infinity; const recs = [], recLine = [];
      for (let i = 0; i < n; i++) { const b = this.series(H[i]).best; if (b > run + 1e-9) { run = b; recs.push(i); } recLine.push(run); }
      // en iyi altı: hafif prusya yıkama
      ctx.beginPath();
      for (let k = 0; k < idx.length; k++) { const i = idx[k], x = this.X(H[i].gen), y = this.Y(this.series(H[i]).best); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.lineTo(this.X(H[idx[idx.length - 1]].gen), M.t + this.ph); ctx.lineTo(this.X(H[idx[0]].gen), M.t + this.ph); ctx.closePath();
      ctx.fillStyle = 'rgba(31,78,112,.10)'; ctx.fill();
      // rekor (noktalı, basamaklı)
      ctx.beginPath();
      for (let k = 0; k < idx.length; k++) { const i = idx[k], x = this.X(H[i].gen), y = this.Y(recLine[i]); k ? (ctx.lineTo(x, this.Y(recLine[idx[k - 1]])), ctx.lineTo(x, y)) : ctx.moveTo(x, y); }
      ctx.setLineDash([1.5, 3]); ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.strokeStyle = C.record; ctx.stroke(); ctx.setLineDash([]);
      // ortalama (kesik), ortanca, en iyi
      const line = (key, col, lw, dash) => {
        ctx.beginPath(); let st = false;
        for (let k = 0; k < idx.length; k++) { const v = this.series(H[idx[k]])[key]; if (v == null || !isFinite(v)) continue; const x = this.X(H[idx[k]].gen), y = this.Y(v); st ? ctx.lineTo(x, y) : ctx.moveTo(x, y); st = true; }
        ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
      };
      line('mean', C.mean, 1.6, [5, 3]);
      if (!isDist) line('median', C.median, 1.6);
      line('best', C.best, 2.4);
      // şampiyon işaretleri (rekor kıranlar); çok fazlaysa seyrelt
      const rstep = Math.max(1, Math.ceil(recs.length / 26));
      for (let k = 0; k < recs.length; k += rstep) {
        const i = recs[k], x = this.X(H[i].gen), y = this.Y(this.series(H[i]).best);
        ctx.beginPath(); ctx.moveTo(x, y - 4.2); ctx.lineTo(x + 3.6, y); ctx.lineTo(x, y + 4.2); ctx.lineTo(x - 3.6, y); ctx.closePath();
        ctx.fillStyle = '#f9f3e3'; ctx.fill(); ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 1.2; ctx.stroke();
      }
      this.drawNotes(ctx);
      this.drawCur(ctx);
      if (this.hover >= 0 && this.hover < n) this.drawHover(ctx, recLine);
      // eksen başlığı
      ctx.font = `italic 11px ${YY.SERIF}`; ctx.fillStyle = `rgba(${INK},.8)`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(isDist ? 'metre' : 'puan', 4, 2);
      ctx.textAlign = 'right'; ctx.fillText('nesil', w - 2, h - 13);
    }

    /** Dönüm noktası notları: eğri üstünde küçük halka + italik not. Öncelik en yüksek eşiğe verilir; sığmayanlar için üst/alt satır denenir. */
    drawNotes(ctx) {
      const H = this.hist; if (!this.notes || !this.notes.length || !H.length) return;
      ctx.textBaseline = 'middle'; ctx.font = `italic 11px ${YY.SERIF}`;
      const items = [];
      for (const n of this.notes) { const i = H.findIndex((h) => h.gen === n.gen); if (i >= 0) items.push({ n, x: this.X(n.gen), y: this.Y(this.series(H[i]).best) }); }
      const placed = [], top = M.t + 2, bot = M.t + this.ph - 8;
      const hit = (r) => placed.some((q) => r.x0 < q.x1 + 3 && r.x1 > q.x0 - 3 && r.y0 < q.y1 + 2 && r.y1 > q.y0 - 2);
      const labels = [];
      for (const it of items.slice().sort((a, b) => b.n.gen - a.n.gen)) { // yüksek eşik önce yer alır
        const tw = ctx.measureText(it.n.text).width, right = it.x + 8 + tw > this.w - 4;
        for (const off of [-16, -30, 17, 31]) {
          const ty = it.y + off; if (ty < top + 6 || ty > bot) continue;
          const bx = right ? it.x - 3 - tw : it.x + 3, r = { x0: bx - 2, x1: bx + tw + 2, y0: ty - 6, y1: ty + 6 };
          if (hit(r)) continue;
          placed.push(r); labels.push({ it, ty, bx, tw }); break;
        }
      }
      for (const it of items) { ctx.beginPath(); ctx.arc(it.x, it.y, 5, 0, Math.PI * 2); ctx.strokeStyle = C.record; ctx.lineWidth = 1.3; ctx.stroke(); }
      for (const L of labels) {
        const it = L.it, up = L.ty < it.y;
        ctx.strokeStyle = `rgba(${INK},.55)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(it.x, it.y + (up ? -5 : 5)); ctx.lineTo(it.x, L.ty + (up ? 5 : -5)); ctx.stroke();
        ctx.fillStyle = 'rgba(249,243,227,.88)'; ctx.fillRect(L.bx - 2, L.ty - 6, L.tw + 4, 12);
        ctx.fillStyle = `rgb(${INK})`; ctx.textAlign = 'left'; ctx.fillText(it.n.text, L.bx, L.ty);
      }
    }

    /** Henüz bitmemiş neslin canlı noktası (boş daire). */
    drawCur(ctx) {
      const c = this.cur; if (!c || !isFinite(c.value)) return;
      const x = this.X(c.gen), y = this.Y(c.value);
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fillStyle = '#f9f3e3'; ctx.fill();
      ctx.strokeStyle = C.best; ctx.lineWidth = 1.6; ctx.stroke();
    }

    drawHover(ctx, recLine) {
      const i = this.hover, hh = this.hist[i], s = this.series(hh), x = this.X(hh.gen), isDist = this.mode === 'dist';
      ctx.strokeStyle = `rgba(${INK},.5)`; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, M.t); ctx.lineTo(Math.round(x) + 0.5, M.t + this.ph); ctx.stroke(); ctx.setLineDash([]);
      const pts = [['best', C.best], ['median', C.median], ['mean', C.mean]];
      for (const [k, col] of pts) { const v = s[k]; if (v == null) continue; ctx.beginPath(); ctx.arc(x, this.Y(v), 3, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#f9f3e3'; ctx.lineWidth = 1; ctx.stroke(); }
      const rows = [['en iyi', s.best, C.best]]; if (!isDist) rows.push(['ortanca', s.median, C.median]); rows.push(['ortalama', s.mean, C.mean]); rows.push(['rekor', recLine[i], C.record]);
      const unit = isDist ? ' m' : '';
      const canPick = this.opts.hasChampion && this.opts.hasChampion(hh.gen);
      const bw = 132, bh = 22 + rows.length * 15 + (canPick ? 18 : 0);
      let bx = x + 10, by = M.t + 4; if (bx + bw > this.w - 2) bx = x - 10 - bw; if (bx < M.l + 2) bx = M.l + 2;
      ctx.fillStyle = 'rgba(249,243,227,.97)'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = `rgba(${INK},.8)`; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = `italic 700 12px ${YY.SERIF}`; ctx.fillStyle = `rgb(${INK})`; ctx.fillText('Nesil ' + hh.gen, bx + 8, by + 11);
      ctx.font = `11px ${YY.MONO}`;
      rows.forEach((r, k) => {
        const y = by + 27 + k * 15; ctx.fillStyle = r[2]; ctx.fillRect(bx + 8, y - 1.5, 9, 3);
        ctx.fillStyle = `rgb(${INK})`; ctx.textAlign = 'left'; ctx.fillText(r[0], bx + 22, y);
        ctx.textAlign = 'right'; ctx.fillText(YY.fmt(r[1], 1) + unit, bx + bw - 8, y);
      });
      if (canPick) { ctx.textAlign = 'left'; ctx.font = `italic 11px ${YY.SERIF}`; ctx.fillStyle = C.best; ctx.fillText('tıkla: şampiyonu izle', bx + 8, by + bh - 9); }
    }

    genAt(e) {
      const r = this.c.getBoundingClientRect(), px = e.clientX - r.left;
      if (!this.dom || !this.hist.length || this.pw <= 0) return -1;
      const g = this.dom.g0 + ((px - M.l) / this.pw) * (this.dom.g1 - this.dom.g0);
      let best = -1, bd = 1e9; const H = this.hist;
      // ikili arama yerine doğrusal (geçmiş kısa) ama uzun geçmişte tahmin + komşu taraması
      let i0 = Math.max(0, Math.min(H.length - 1, Math.round(g - H[0].gen)));
      for (let i = Math.max(0, i0 - 3); i <= Math.min(H.length - 1, i0 + 3); i++) { const d = Math.abs(H[i].gen - g); if (d < bd) { bd = d; best = i; } }
      return px < M.l - 6 || px > this.w - M.r + 6 ? -1 : best;
    }
    onMove(e) { const i = this.genAt(e); if (i !== this.hover) { this.hover = i; this.dirty = true; } this.c.style.cursor = i >= 0 && this.opts.hasChampion && this.opts.hasChampion(this.hist[i].gen) ? 'pointer' : 'crosshair'; }
    onClick(e) { const i = this.genAt(e); if (i >= 0 && this.opts.onPick) this.opts.onPick(this.hist[i].gen); }
  }
  YY.FitnessChart = FitnessChart;
})(typeof window !== 'undefined' ? window : globalThis);
