// Limon.App: uygulama arayüzü ve orkestrasyon (SPEC 4.5).
//
// Bu dosya yalnızca SPEC'teki API'lere dayanır: Limon.Data, Limon.GPU.Trainer, Limon.CPUModel, Limon.Brain,
// Limon.Layout, Limon.Util. Sayfa açılınca kendi kendine başlar; Node'da yüklenirse yalnızca TUNE'u dışa verir.
//
// Akış (tek rAF döngüsü, tek zaman tabanı = "uygulama zamanı": sekme arka plandayken akmaz, dönünce sıçrama olmaz):
//   1. eğitim   : inFlight() < 2 iken ve ~6 ms CPU bütçesi dolmadan  sampler.next -> tr.step   (GPU payı = kare görev döngüsü)
//   2. senkron  : readWeightsAsync -> cpuModel.setWeights + brain.setWeights (başta sık, sonra seyrek)
//   3. kayıp    : readLossAsync (~10 Hz), evalLoss(valBatch) seyrek
//   4. konuşma  : tek "talker" CPUModel'i, iş kuyruğu (sohbet > ders defteri > canlı örnek), kare başına <= ~3 ms'lik dilim
//   5. düşünme  : ayrı "thinker" CPUModel'i korpustan karakter karakter okur, trace -> brain.pushTrace (10-15 tok/sn)
//
// URL parametreleri: ?seed=N  ?speed=X (0.1-1: GPU payı; >1: kare bütçesini X ile çarpar)  ?nobrain=1  ?debug=1
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});

  // ------------------------------------------------------------------------------------------------
  // TUNE: bütün ayar sabitleri burada.
  // ------------------------------------------------------------------------------------------------
  const TUNE = {
    // -- eğitim
    lrPeak: 2.5e-3,          // tepe öğrenme oranı
    lrMin: 2.5e-4,           // kosinüs düşüşünün tabanı; sonrası sonsuza dek bu değerde eğitilir
    warmup: 150,             // lineer ısınma adımı
    decaySteps: 14000,       // tepe -> taban kosinüs düşüşünün uzunluğu (ısınmadan sonra, adım)
    // sampler'daki sentetik cümle payı: [adım, pay] noktaları arasında lineer
    synthSchedule: [[0, 0.7], [1500, 0.55], [4000, 0.4], [10000, 0.3]],
    maxInFlight: 2,          // GPU kuyruğunda en fazla bekleyen adım (kare hızı düşerse geçici olarak 1'e iner)
    fpsFloor: 48,            // bunun altına düşen kare hızı kuyruğu 1 adıma indirir (3B akıcı kalsın)
    fpsRetryMs: 90000,       // 1 adıma inildikten bu kadar sonra 2'yi yeniden dene
    frameBudgetMs: 6,        // kare başına eğitim CPU bütçesi (sampler.next + step)
    maxStepsPerFrame: 3,
    maxFrameDt: 100,         // ms; büyük kare aralıkları (arka plan, takılma) buna kırpılır
    gpuShare: 1,             // 0.1 .. 1 (kare görev döngüsü)
    // -- ağırlık senkronu: [yaş sn, aralık ms] (parça parça sabit)
    syncSchedule: [[0, 700], [30, 1200], [120, 2000]],
    lossEveryMs: 150,        // readLossAsync aralığı
    lossEma: 0.06,           // kayıp yumuşatma katsayısı (okuma başına)
    lossFloor: 1.0,          // lossNorm için "iyi" kayıp (nat); lossNorm = (kayıp - floor) / (ln V - floor)
    histMax: 3000,           // grafik noktası sınırı (aşınca ikişer ikişer birleştirilir)
    valFirstSec: 5, valEverySec: 30,   // doğrulama kaybı: ilk kez / sonra periyot (yaş sn)
    // -- konuşma
    temperature: 0.8,        // sohbet + canlı örnek sıcaklığı (kaydırıcı başlangıcı)
    tempMin: 0.2, tempMax: 1.5,
    topK: 0, topP: 0.95,
    talkEntries: 5,          // canlı konuşma akışında tutulan örnek sayısı
    talkSliceMs: 3,          // kare başına üretim dilimi
    liveChars: 150,          // canlı örnek uzunluğu (karakter)
    liveTokPerSec: 55,       // canlı örnek akış hızı (daktilo etkisi); 0 = sınırsız
    liveHoldMs: 1800,        // örnek bittikten sonra ekranda kalma süresi
    livePrompts: ['Merhaba!', 'Sen kimsin?', 'Bugün ne yaptın?', 'Ne seversin?', 'Hava nasıl?', 'Bana bir şey anlat.'],
    scoreWindow: 6,          // Türkçe skoru son kaç örnekten hesaplanır
    stageEdges: [0.05, 0.25, 0.5, 0.75, 0.9],
    stageHysteresis: 0.03,   // aşama geri düşmeden önce tolerans
    scoreEase: 0.07,         // gösterilen skorun hedefe yaklaşma hızı (kare başına)
    // -- ders defteri (yaş sn cinsinden anlık görüntü zamanları)
    snapTimes: [0, 4, 10, 20, 40, 70, 110, 160, 220, 300, 420, 600, 840, 1200, 1800, 2700, 3600],
    snapEvery: 1800,         // listeden sonra her bu kadar sn'de bir
    snapPrompt: 'Merhaba!',  // hep aynı istem
    snapSeed: 1234,          // hep aynı rastgelelik: farklar yalnızca modelden gelir
    snapTemp: 0.7,
    snapChars: 110,
    snapMax: 80,             // ekranda tutulan kart sayısı
    // -- sohbet
    chatMaxChars: 180,
    chatTokPerSec: 45,       // cevap akış hızı (beyin de bu hızda düşünür)
    chatHistoryTurns: 3,     // isteme eklenen önceki tur sayısı
    chatMaxLen: 160,
    // -- beyin "düşünme" akışı
    thinkTokPerSec: 12,
    // -- arayüz
    uiEveryMs: 250,          // sayı/etiket güncelleme aralığı
    chartEveryMs: 100,
    brainStatusEveryMs: 250,
    insetPad: 14,            // beyne bildirilen panel boşluğu (px)
    rebornConfirmMs: 3000,
    toastMs: 4700,
    hintDelayMs: 4000,
    minSplashMs: 900,
  };

  if (typeof document === 'undefined') { Limon.App = { TUNE }; if (typeof module !== 'undefined' && module.exports) module.exports = Limon; return; }

  // ------------------------------------------------------------------------------------------------
  // Yardımcılar
  // ------------------------------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') === '1';
  const dbg = (...a) => { if (DEBUG) console.log('[limon]', ...a); };
  const reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Türkçe sayı biçimi: 12.345,67
  function nf(n, d) {
    if (!isFinite(n)) return '-';
    const s = Math.abs(n).toFixed(d || 0); const p = s.split('.');
    const i = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + i + (p[1] ? ',' + p[1] : '');
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function clock(ms) {
    const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + pad2(m) + ':' + pad2(s % 60) : pad2(m) + ':' + pad2(s % 60);
  }
  function ageLabel(sec) {
    if (sec <= 0) return 'Doğum';
    return sec < 60 ? sec + ' sn' : clock(sec * 1000); // 1:50, 1:05:00: başlıktaki yaş saatiyle aynı dil
  }
  function piecewise(table, x) { // [[x0,y0],[x1,y1],...] lineer
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (x <= table[i][0]) { const a = table[i - 1], b = table[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    }
    return table[table.length - 1][1];
  }
  function step2(table, x) { // parça parça sabit: son x0 <= x olan satırın değeri
    let v = table[0][1];
    for (const r of table) if (x >= r[0]) v = r[1];
    return v;
  }
  function gpuLabel(r) {
    if (!r) return 'GPU';
    let s = String(r);
    const m = /^ANGLE \((.*)\)$/.exec(s);
    if (m) {
      const parts = m[1].split(/,\s*/);
      s = parts.length > 1 ? parts[1] : parts[0];
      s = s.replace(/^ANGLE [A-Za-z]+ Renderer:\s*/, '');
    }
    s = s.replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s+Direct3D\d*.*$/i, '').replace(/\s+vs_\d.*$/i, '').replace(/\s+\(R\)/g, '').trim();
    return s || 'GPU';
  }
  function cloneTrace(t) { // CPUModel tamponları yeniden kullanır; beyne kopya ver
    const c = { pos: t.pos, token: t.token, layers: new Array(t.layers.length) };
    for (let i = 0; i < t.layers.length; i++) {
      const L = t.layers[i], o = {};
      for (const k in L) o[k] = L[k] && L[k].slice ? L[k].slice() : L[k];
      c.layers[i] = o;
    }
    for (const k of ['xFinal', 'logits', 'probs']) if (t[k]) c[k] = t[k].slice();
    return c;
  }

  const STAGES = ['Saçmalıyor', 'Harfleri tanıyor', 'Kelime uyduruyor', 'Gerçek kelimeler söylüyor', 'Cümle kuruyor', 'Türkçe konuşuyor'];
  const STAGE_HINT = [
    'Ağırlıklar rastgele: Limon henüz anlamsız harfler diziyor.',
    'Boşlukları, ünlü ve ünsüz kalıplarını sezmeye başladı.',
    'Kelimeye benzeyen şeyler uyduruyor; çoğu henüz Türkçe değil.',
    'Gerçek kelimeler geliyor, ama cümleler hâlâ dağınık.',
    'Cümle kuruyor; anlam yer yer kayabiliyor.',
    'Akıcı Türkçe konuşuyor. Sohbet etmeyi dene!',
  ];
  const STAGE_TOAST = [
    '', 'Limon harfleri tanımaya başladı!', 'Limon kelime kurmaya başladı!',
    'Limon gerçek kelimeler söylüyor!', 'Limon cümle kurmaya başladı!', 'Limon artık Türkçe konuşuyor!',
  ];
  const STAGE_COLOR = ['#ff9d8e', '#ffc978', '#f5e663', '#d3ee62', '#b4ee5a', '#5ce1e6'];

  // ------------------------------------------------------------------------------------------------
  // Durum
  // ------------------------------------------------------------------------------------------------
  const S = {
    booted: false, paused: false, hidden: false,
    seed: 1, bornCount: 0,
    appT: 0, ageMs: 0,
    step: 0, loss: NaN, smLoss: NaN, gradNorm: NaN, valLoss: NaN,
    tps: 0, bpc: NaN,
    score: 0, shownScore: 0, stage: 0, maxStage: 0, scoreWords: 0, scoreKnown: 0,
    share: TUNE.gpuShare, temp: TUNE.temperature, speedMul: 1,
    syncedStep: 0, weights: null, lastSyncT: 0,
    frameMs: 0, fps: 0, trainMs: 0, stepsIssued: 0,
    maxInFlight: TUNE.maxInFlight, flightT: 0, nextStepT: 0, lastIssueT: 0, baseIv: 40,
    errors: 0, snaps: [], chatCount: 0, lossN: 0, nonFinite: 0, userPanel: {},
  };

  // Modül ve bileşen tutamaçları
  let cfg = null, tr = null, brain = null, sampler = null, valBatch = null;
  let talker = null, thinker = null, probe = null;
  let epoch = 0, rebornBusy = false, rafId = 0, lastNow = 0;
  let bufs = [], bufI = 0;
  let syncP = null, lossBusy = false, valBusy = false, snapBusy = false;
  let nextSnapIdx = 0, nextValSec = TUNE.valFirstSec;
  let lossT = 0, valT = 0, uiT = 0, chartT = 0, brainT = 0, tpsT = 0, tpsLast = 0;
  let scoreWin = [];
  const hist = { s: [], l: [], m: [] };      // eğitim kaybı (adım, ham, yumuşak)
  const valHist = [];                        // {s, v}
  const stageMarks = [];                     // {s, stage}
  let chat = null;                           // sohbet durumu
  let dom = {};

  // ------------------------------------------------------------------------------------------------
  // Ders defteri, canlı konuşma: kelimeleri gerçek/uydurma diye boyayan çizici
  // ------------------------------------------------------------------------------------------------
  const LETTERS = /\p{L}+/gu;
  function wordsHtml(text, final) {
    const Data = Limon.Data, known = Data.knownWords, lower = Limon.Util.lowerTR;
    let out = '', last = 0, m; LETTERS.lastIndex = 0;
    while ((m = LETTERS.exec(text))) {
      out += esc(text.slice(last, m.index));
      const w = m[0], end = m.index + w.length;
      if (w.length < 2 || (!final && end === text.length)) out += esc(w);
      else out += '<span class="w ' + (known.has(lower(w)) ? 'k' : 'u') + '">' + esc(w) + '</span>';
      last = end;
    }
    return out + esc(text.slice(last));
  }

  // ------------------------------------------------------------------------------------------------
  // Eğitim
  // ------------------------------------------------------------------------------------------------
  function lrAt(step) {
    if (step < TUNE.warmup) return TUNE.lrPeak * (step + 1) / TUNE.warmup;
    const p = Math.min(1, (step - TUNE.warmup) / TUNE.decaySteps);
    return TUNE.lrMin + (TUNE.lrPeak - TUNE.lrMin) * 0.5 * (1 + Math.cos(Math.PI * p));
  }

  function makeBufs() {
    const n = cfg.B * cfg.T; bufs = [];
    for (let i = 0; i < 3; i++) bufs.push({ x: new Int32Array(n), y: new Int32Array(n) });
  }

  function pumpTraining() {
    // GPU payı: pay < 1 iken adımlar, tam hızdaki ölçülü adım aralığının 1/pay katı kadar aralıkla verilir
    if (S.share < 0.995 && S.appT < S.nextStepT) return;
    const t0 = performance.now(), budget = TUNE.frameBudgetMs * S.speedMul;
    let n = 0;
    try {
      while (tr.inFlight() < S.maxInFlight && n < TUNE.maxStepsPerFrame && (n === 0 || performance.now() - t0 < budget)) {
        const b = bufs[bufI]; bufI = (bufI + 1) % bufs.length;
        const st = tr.stepCount;
        if ((st & 63) === 0) sampler.setSynthShare(piecewise(TUNE.synthSchedule, st));
        sampler.next(b.x, b.y);
        tr.step(b.x, b.y, lrAt(st));
        n++;
      }
      S.consecFail = 0;
    } catch (e) {
      S.consecFail = (S.consecFail || 0) + 1; S.errors++;
      report(e);
      if (S.consecFail >= 3) { setPaused(true); toast('GPU eğitimi durdu: ' + (e && e.message ? e.message : e), 'warn'); }
    }
    S.stepsIssued += n;
    if (n) {
      if (S.share >= 0.995) { if (S.lastIssueT) S.baseIv = clamp(S.baseIv + ((S.appT - S.lastIssueT) / n - S.baseIv) * 0.05, 8, 250); }
      else S.nextStepT = S.appT + S.baseIv * n / S.share;
      S.lastIssueT = S.appT;
    }
    S.trainMs += ((performance.now() - t0) - S.trainMs) * 0.05;
    S.step = tr.stepCount;
  }

  // 3B akıcılığı: eğitim kuyruğu render'ı boğarsa (kare hızı düşerse) kuyruğu geçici olarak 1 adıma indir
  function adaptFlight() {
    if (S.appT - S.flightT < 2500) return;
    if (S.maxInFlight > 1 && S.fps < TUNE.fpsFloor && S.appT > 4000 && !S.paused) { S.maxInFlight = 1; S.flightT = S.appT; }
    else if (S.maxInFlight === 1 && S.appT - S.flightT > TUNE.fpsRetryMs) { S.maxInFlight = TUNE.maxInFlight; S.flightT = S.appT; }
    else if (S.maxInFlight > 1) S.flightT = S.appT - 1500;
  }
  // Ağırlıkları GPU'dan al, CPU modellere ve beyne dağıt
  function applyWeights(w, step) {
    S.weights = w; S.syncedStep = step;
    thinker.model.setWeights(w);
    talker.pendingW = w; talker.pendingStep = step;
    if (brain) brain.setWeights(w);
  }
  function syncNow() {
    if (syncP) return syncP;
    if (!tr || rebornBusy || tr.stepCount === S.syncedStep) return Promise.resolve();
    const g = epoch, at = tr.stepCount;
    syncP = tr.readWeightsAsync()
      .then((w) => { if (g === epoch && w) applyWeights(w, at); })
      .catch(report)
      .then(() => { syncP = null; S.lastSyncT = S.appT; });
    return syncP;
  }

  function pushLoss(r) {
    S.lossN++;
    S.loss = r.loss; S.gradNorm = r.gradNorm;
    S.smLoss = isFinite(S.smLoss) ? S.smLoss + (r.loss - S.smLoss) * TUNE.lossEma : r.loss;
    S.bpc = S.smLoss / Math.LN2;
    hist.s.push(r.step); hist.l.push(r.loss); hist.m.push(S.smLoss);
    if (hist.s.length > TUNE.histMax) { // ikişer ikişer birleştir: uzun eğitimde grafik hep sınırlı kalır
      const n = hist.s.length >> 1;
      for (let i = 0; i < n; i++) {
        hist.s[i] = hist.s[2 * i + 1]; hist.l[i] = (hist.l[2 * i] + hist.l[2 * i + 1]) / 2; hist.m[i] = (hist.m[2 * i] + hist.m[2 * i + 1]) / 2;
      }
      hist.s.length = hist.l.length = hist.m.length = n;
    }
    chart.dirty = true;
  }
  function pumpLoss() {
    if (lossBusy || S.appT - lossT < TUNE.lossEveryMs) return;
    lossT = S.appT; lossBusy = true; const g = epoch;
    tr.readLossAsync().then((r) => {
      if (g !== epoch || !r) return;
      if (!isFinite(r.loss)) {
        if (++S.nonFinite === 6) toast('Kayıp sayı olmaktan çıktı; eğitim bozulmuş olabilir. "Yeniden doğur" ile baştan başla.', 'warn');
        return;
      }
      const last = hist.s.length ? hist.s[hist.s.length - 1] : -1;
      if (r.step !== last) pushLoss(r);
    }).catch(report).then(() => { lossBusy = false; });
  }
  function pumpVal() {
    if (valBusy || S.ageMs / 1000 < nextValSec || !valBatch) return;
    valBusy = true; nextValSec = Math.max(nextValSec, S.ageMs / 1000) + TUNE.valEverySec;
    const g = epoch, at = tr.stepCount;
    tr.evalLoss(valBatch.x, valBatch.y).then((v) => {
      if (g !== epoch || !isFinite(v)) return;
      S.valLoss = v; valHist.push({ s: at, v }); chart.dirty = true;
    }).catch(report).then(() => { valBusy = false; });
  }

  // ------------------------------------------------------------------------------------------------
  // Konuşma motoru: tek CPUModel + iş kuyruğu, kare başına küçük dilimler
  // ------------------------------------------------------------------------------------------------
  function makeTalker(model) {
    const T = {
      model, queue: [], cur: null, pendingW: null, pendingStep: 0, wStep: 0, hold: 0, liveIdx: 0,
      enqueue(job, front) { if (front) this.queue.unshift(job); else this.queue.push(job); },
      abort(pred) { // pred(job) doğruysa iptal (çalışan dahil)
        this.queue = this.queue.filter((j) => { if (pred(j)) { if (j.onAbort) j.onAbort(j); return false; } return true; });
        if (this.cur && pred(this.cur)) { const j = this.cur; this.cur = null; if (j.onAbort) j.onAbort(j); }
      },
      clear() { this.abort(() => true); this.hold = 0; },
      start(j) {
        const Data = Limon.Data, m = this.model;
        if (this.pendingW) { m.setWeights(this.pendingW); this.wStep = this.pendingStep; this.pendingW = null; }
        j.step = this.wStep; j.started = true; j.credit = 1; j.out = []; j.text = '';
        let ids = Data.encode(j.prompt);
        if (!ids.length) ids = Data.encode('\n');
        if (ids.length > cfg.T - 1) ids = ids.slice(ids.length - (cfg.T - 1));
        m.reset();
        if (ids.length > 1) m.prefill(ids.subarray(0, ids.length - 1));
        const r = m.feed(ids[ids.length - 1], !!j.trace);
        j.logits = r.logits;
        if (j.trace && r.trace && j.onTrace) j.onTrace(cloneTrace(r.trace));
        if (j.onStart) j.onStart(j);
      },
      finish(j, stopped) { this.cur = null; if (j.onDone) j.onDone(j, j.text, stopped); },
      pump(dt, sliceMs) {
        if (!this.cur) {
          let j = this.queue.shift();
          if (!j) {
            this.hold -= dt; if (this.hold > 0 || !this.liveFactory) return;
            j = this.liveFactory();
          }
          this.cur = j;
        }
        const j = this.cur;
        if (!j.started) this.start(j);
        if (j.rate) j.credit = Math.min(j.credit + dt * j.rate / 1000, 4);
        const t0 = performance.now(), Data = Limon.Data, m = this.model;
        const sopts = { temperature: j.temp, topK: j.topK, topP: j.topP, rng: j.rng };
        for (let n = 0; ; n++) {
          if (j.rate && j.credit < 1) return;
          if (n > 0 && performance.now() - t0 > sliceMs) return;
          const id = Limon.CPUModel.sample(j.logits, sopts);
          if (j.stopIds && j.stopIds.indexOf(id) >= 0) return this.finish(j, true);
          j.out.push(id); j.text += Data.decode([id]);
          if (j.onToken) j.onToken(j, j.text);
          if (j.out.length >= j.maxNew) return this.finish(j, false);
          const r = m.feed(id, !!j.trace);
          j.logits = r.logits;
          if (j.trace && r.trace && j.onTrace) j.onTrace(cloneTrace(r.trace));
          if (j.rate) j.credit -= 1;
        }
      },
    };
    return T;
  }

  // Beynin "okuma/düşünme" akışı: korpustan kısa metni karakter karakter besler
  function makeThinker(model) {
    return {
      model, ids: null, i: 0, acc: 0, rng: null,
      reset() { this.ids = null; this.i = 0; this.acc = 0; },
      pump(dt) {
        if (!brain) return;
        this.acc = Math.min(this.acc + dt * TUNE.thinkTokPerSec / 1000, 3);
        while (this.acc >= 1) {
          this.acc -= 1;
          if (!this.ids || this.i >= this.ids.length) {
            this.ids = Limon.Data.encode('\n' + Limon.Data.randomSnippet(this.rng)); this.i = 0; this.model.reset();
          }
          const r = this.model.feed(this.ids[this.i++], true);
          if (r.trace) brain.pushTrace(cloneTrace(r.trace));
        }
      },
    };
  }

  function genSync(model, prompt, maxNew, temp, rng, stop) { // __limon.sample için
    const Data = Limon.Data;
    let ids = Data.encode(prompt); if (!ids.length) ids = Data.encode('\n');
    if (ids.length > cfg.T - 1) ids = ids.slice(ids.length - (cfg.T - 1));
    model.reset();
    if (ids.length > 1) model.prefill(ids.subarray(0, ids.length - 1));
    let logits = model.feed(ids[ids.length - 1], false).logits, out = '';
    for (let i = 0; i < maxNew; i++) {
      const id = Limon.CPUModel.sample(logits, { temperature: temp, topK: TUNE.topK, topP: TUNE.topP, rng });
      if (stop && stop.indexOf(id) >= 0) break;
      out += Data.decode([id]);
      logits = model.feed(id, false).logits;
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------
  // Skor ve aşama
  // ------------------------------------------------------------------------------------------------
  function addScoreSample(text) {
    const r = Limon.Data.turkishScore(text);
    scoreWin.push({ w: r.words, k: r.known });
    if (scoreWin.length > TUNE.scoreWindow) scoreWin.shift();
    let w = 0, k = 0; for (const e of scoreWin) { w += e.w; k += e.k; }
    S.scoreWords = w; S.scoreKnown = k;
    S.score = w >= 3 ? k / w : 0;
    updateStage();
  }
  function stageOf(score) { let s = 0; for (const e of TUNE.stageEdges) if (score >= e) s++; return s; }
  function updateStage() {
    let s = stageOf(S.score);
    // geri düşüş için histerezis: skor eşiğin biraz altına inmedikçe aşama düşmez
    if (s < S.stage && S.score > TUNE.stageEdges[S.stage - 1] - TUNE.stageHysteresis) s = S.stage;
    if (s !== S.stage) {
      S.stage = s;
      if (s > S.maxStage) {
        S.maxStage = s; stageMarks.push({ s: tr ? tr.stepCount : 0, stage: s }); chart.dirty = true;
        if (STAGE_TOAST[s]) toast(STAGE_TOAST[s]);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Canlı serbest konuşma
  // ------------------------------------------------------------------------------------------------
  function liveJob() {
    const Data = Limon.Data;
    const q = TUNE.livePrompts[talker.liveIdx++ % TUNE.livePrompts.length];
    const g = epoch;
    return {
      kind: 'live', prompt: Data.chatPrompt([], q), maxNew: TUNE.liveChars, temp: S.temp, topK: TUNE.topK, topP: TUNE.topP,
      stopIds: [Data.encode('\n')[0]], rate: TUNE.liveTokPerSec, rng: Math.random,
      onStart(j) { if (g === epoch) j.entry = newTalkEntry(q); },
      onToken(j, text) { if (g === epoch && j.entry) renderTalk(j.entry, text, false); },
      // sohbet/ders defteri araya girip yarıda keserse: imleç kalksın, yarım kalan son kelime boyanmasın
      onAbort(j) { if (g === epoch && j.entry) renderTalk(j.entry, j.text.trimStart() || '...', false, true); },
      onDone(j, text) {
        if (g !== epoch || !j.entry) return;
        text = text.trim() || '...';
        renderTalk(j.entry, text, true); addScoreSample(text); talker.hold = TUNE.liveHoldMs;
      },
    };
  }
  function newTalkEntry(q) {
    const e = document.createElement('div'); e.className = 'talk-entry';
    e.style.setProperty('--g', dom.talk.dataset.g || '1'); // eski girdiler kendi dönemlerinin bozuk halini korur
    e.innerHTML = '<div class="talk-prompt"></div><div class="talk-line"><span class="who">Limon</span><p class="says"><span class="cur"></span></p></div>';
    if (dom.talkText) dom.talkText.classList.remove('jit');
    dom.talkFeed.appendChild(e);
    while (dom.talkFeed.children.length > TUNE.talkEntries) dom.talkFeed.removeChild(dom.talkFeed.firstChild);
    dom.curEntry = e; dom.talkPrompt = e.firstChild; dom.talkText = e.querySelector('.says'); dom.talkPrompt.textContent = q;
    dom.talkText.classList.toggle('jit', +(dom.talk.dataset.g || 1) > 0.3 && !reduceMotion);
    return e;
  }
  // final: konuşma bitti (son kelime de boyanır); cut: yarıda kesildi (imleç yok, son kelime yarım olabilir, boyanmaz)
  function renderTalk(entry, text, final, cut) {
    const el = entry.querySelector('.says');
    el.innerHTML = wordsHtml(text, final) + (final || cut ? '' : '<span class="cur"></span>');
    el.classList.toggle('done', !!(final || cut));
  }

  // ------------------------------------------------------------------------------------------------
  // Ders defteri
  // ------------------------------------------------------------------------------------------------
  function snapTimeAt(i) { const T = TUNE.snapTimes; return i < T.length ? T[i] : T[T.length - 1] + (i - T.length + 1) * TUNE.snapEvery; }

  function takeSnapshot(sec) {
    if (snapBusy) return;
    snapBusy = true; const g = epoch, Data = Limon.Data;
    const go = () => {
      if (g !== epoch) { snapBusy = false; return; }
      talker.abort((j) => j.kind === 'live'); talker.hold = 0;
      talker.enqueue({
        kind: 'snap', prompt: Data.chatPrompt([], TUNE.snapPrompt), maxNew: TUNE.snapChars, temp: TUNE.snapTemp, topK: TUNE.topK, topP: TUNE.topP,
        stopIds: [Data.encode('\n')[0]], rate: 0, rng: Limon.Util.rng(TUNE.snapSeed),
        onAbort() { snapBusy = false; },
        onDone(j, text) {
          snapBusy = false; if (g !== epoch) return;
          text = text.trim() || '...';
          const r = Data.turkishScore(text);
          const snap = { sec, step: j.step, text, score: r.ratio, words: r.words, known: r.known };
          S.snaps.push(snap); addCard(snap);
        },
      }, true);
    };
    if (sec > 0) syncNow().then(go); else go();
  }

  function addCard(snap) {
    const nb = dom.nbScroll; const empty = nb.querySelector('.nb-empty'); if (empty) empty.remove();
    const stage = stageOf(snap.score);
    const c = document.createElement('article');
    c.className = 'nb-card fresh'; c.style.setProperty('--sc', STAGE_COLOR[stage]);
    c.title = ageLabel(snap.sec) + ': ' + snap.text;
    c.innerHTML = '<header><b>' + ageLabel(snap.sec) + '</b><span>adım ' + nf(snap.step) + ' · %' + Math.round(snap.score * 100) + '</span></header><p>' + wordsHtml(snap.text, true) + '</p>';
    nb.appendChild(c); dom.nbEdge();
    while (nb.children.length > TUNE.snapMax) nb.removeChild(nb.firstChild);
    if (performance.now() - (dom.nbUserT || 0) > 6000) nb.scrollTo({ left: nb.scrollWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(() => c.classList.remove('fresh'), 1500);
  }

  // ------------------------------------------------------------------------------------------------
  // Sohbet
  // ------------------------------------------------------------------------------------------------
  function initChat() {
    chat = { history: [], queue: [], busy: false, sent: 0 };
  }
  function addMsg(who, text, tag) {
    const m = document.createElement('div'); m.className = 'msg ' + (who === 'Sen' ? 'me' : 'li');
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text; m.appendChild(b);
    if (tag) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tag; m.appendChild(t); }
    dom.chatLog.appendChild(m); dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
    return m;
  }
  function submitChat(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, TUNE.chatMaxLen);
    if (!text) return Promise.resolve(null);
    if (dom.chatNote) { dom.chatNote.remove(); dom.chatNote = null; }
    dom.suggest.classList.add('gone');
    addMsg('Sen', text);
    S.chatCount++;
    return new Promise((resolve) => { chat.queue.push({ text, resolve }); runChat(); });
  }
  function runChat() {
    if (chat.busy || !chat.queue.length || !talker) return;
    chat.busy = true; const item = chat.queue.shift(), g = epoch;
    dom.typing.hidden = false;
    const fail = () => { chat.busy = false; dom.typing.hidden = true; item.resolve(null); };
    syncNow().then(() => {
      if (g !== epoch) return fail();
      const Data = Limon.Data;
      const hist = chat.history.slice(-TUNE.chatHistoryTurns * 2);
      const prompt = Data.chatPrompt(hist, item.text, cfg.T - 24);
      let bubbleWrap = null, bubble = null;
      talker.abort((j) => j.kind === 'live'); talker.hold = 0;
      talker.enqueue({
        kind: 'chat', prompt, maxNew: TUNE.chatMaxChars, temp: S.temp, topK: TUNE.topK, topP: TUNE.topP,
        stopIds: [Data.encode('\n')[0]], rate: TUNE.chatTokPerSec, rng: Math.random, trace: !!brain,
        onTrace(t) { brain.pushTrace(t); },
        onToken(j, text) {
          if (!bubble) {
            dom.typing.hidden = true; bubbleWrap = addMsg('Limon', '', null); bubble = bubbleWrap.firstChild; bubble.classList.add('stream');
          }
          bubble.textContent = text.replace(/^\s+/, ''); dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
        },
        onAbort() { fail(); },
        onDone(j, text) {
          if (g !== epoch) return fail();
          text = text.replace(/\s+/g, ' ').trim() || '...';
          if (!bubble) { dom.typing.hidden = true; bubbleWrap = addMsg('Limon', text, null); bubble = bubbleWrap.firstChild; }
          bubble.textContent = text; bubble.classList.remove('stream');
          if (Limon.Data.turkishScore(text).ratio < 0.5) bubble.classList.add('rough');
          const tag = document.createElement('span'); tag.className = 'tag';
          tag.textContent = 'adım ' + nf(j.step) + ' · skor %' + Math.round(S.shownScore * 100);
          bubbleWrap.appendChild(tag); dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
          chat.history.push({ who: 'Sen', text: item.text }, { who: 'Limon', text });
          chat.busy = false; item.resolve(text); runChat();
        },
      }, true);
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Grafik (canvas 2D)
  // ------------------------------------------------------------------------------------------------
  const chart = { cv: null, ctx: null, w: 0, h: 0, dpr: 1, dirty: true };
  function chartResize() {
    const cv = chart.cv; if (!cv) return;
    const r = cv.getBoundingClientRect(); const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === chart.w && h === chart.h && dpr === chart.dpr) return;
    chart.w = w; chart.h = h; chart.dpr = dpr; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); chart.dirty = true;
  }
  const Y_NICE = [0.25, 0.4, 0.5, 0.8, 1, 1.5, 2, 3, 4, 5, 6, 8, 12];
  const X_NICE = [0, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000];
  function drawChart() {
    const c = chart.ctx; if (!c || !chart.w) return;
    const w = chart.w, h = chart.h;
    c.setTransform(chart.dpr, 0, 0, chart.dpr, 0, 0); c.clearRect(0, 0, w, h);
    const padL = 30, padR = 10, padT = 8, padB = 16, pw = w - padL - padR, ph = h - padT - padB;
    const n = hist.s.length;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { if (hist.l[i] > hi) hi = hist.l[i]; if (hist.m[i] < lo) lo = hist.m[i]; }
    for (const v of valHist) { if (v.v < lo) lo = v.v; if (v.v > hi) hi = v.v; }
    if (!isFinite(lo)) { lo = 1.5; hi = cfg ? Math.log(cfg.V) : 4.5; }
    let ymax = Y_NICE.find((v) => v >= hi * 1.03) || hi * 1.05, ymin = 0.25;
    for (const v of Y_NICE) if (v <= lo * 0.9) ymin = v;
    if (ymin >= ymax) ymin = ymax / 2;
    const ly0 = Math.log(ymin), ly1 = Math.log(ymax);
    const maxStep = Math.max(200, n ? hist.s[n - 1] : 0, S.step);
    const sx = (s) => padL + Math.sqrt(s / maxStep) * pw;
    const sy = (v) => padT + (1 - (Math.log(clamp(v, ymin, ymax)) - ly0) / (ly1 - ly0)) * ph;

    c.font = '10px ui-monospace, Menlo, monospace'; c.textBaseline = 'middle'; c.textAlign = 'right';
    let lastY = -99;
    for (let i = Y_NICE.length - 1; i >= 0; i--) {
      const v = Y_NICE[i]; if (v < ymin * 0.999 || v > ymax * 1.001) continue;
      const y = sy(v); if (Math.abs(y - lastY) < 15) continue; lastY = y;
      c.strokeStyle = 'rgba(238,242,230,.07)'; c.lineWidth = 1; c.beginPath(); c.moveTo(padL, Math.round(y) + .5); c.lineTo(w - padR, Math.round(y) + .5); c.stroke();
      c.fillStyle = 'rgba(238,242,230,.42)'; c.fillText(nf(v, v < 1 || v % 1 ? 1 : 0), padL - 5, y);
    }
    c.textAlign = 'center'; c.textBaseline = 'top'; let lastX = -99;
    for (const s of X_NICE) {
      if (s > maxStep) break; const x = sx(s); if (x - lastX < 46) continue; lastX = x;
      c.fillStyle = 'rgba(238,242,230,.38)'; c.fillText(nf(s), clamp(x, padL + 6, w - padR - 10), h - padB + 4);
      c.strokeStyle = 'rgba(238,242,230,.05)'; c.beginPath(); c.moveTo(Math.round(x) + .5, padT); c.lineTo(Math.round(x) + .5, padT + ph); c.stroke();
    }
    // aşama işaretleri
    for (const mk of stageMarks) {
      const x = sx(mk.s); c.strokeStyle = STAGE_COLOR[mk.stage]; c.globalAlpha = .45; c.setLineDash([2, 3]);
      c.beginPath(); c.moveTo(x, padT + 4); c.lineTo(x, padT + ph); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      c.fillStyle = STAGE_COLOR[mk.stage]; c.beginPath(); c.arc(x, padT + 3, 2.4, 0, 7); c.fill();
    }
    if (n > 1) {
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(245,230,99,.2)'; c.lineWidth = 1; c.beginPath();
      for (let i = 0; i < n; i++) { const x = sx(hist.s[i]), y = sy(hist.l[i]); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      const g = c.createLinearGradient(0, padT, 0, padT + ph); g.addColorStop(0, 'rgba(245,230,99,.22)'); g.addColorStop(1, 'rgba(245,230,99,0)');
      c.beginPath(); for (let i = 0; i < n; i++) { const x = sx(hist.s[i]), y = sy(hist.m[i]); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.lineTo(sx(hist.s[n - 1]), padT + ph); c.lineTo(sx(hist.s[0]), padT + ph); c.closePath(); c.fillStyle = g; c.fill();
      c.strokeStyle = '#f5e663'; c.lineWidth = 2; c.shadowColor = 'rgba(245,230,99,.6)'; c.shadowBlur = 6; c.beginPath();
      for (let i = 0; i < n; i++) { const x = sx(hist.s[i]), y = sy(hist.m[i]); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke(); c.shadowBlur = 0;
      const ex = sx(hist.s[n - 1]), ey = sy(hist.m[n - 1]), pulse = reduceMotion ? 0 : (Math.sin(performance.now() / 320) + 1) / 2;
      c.fillStyle = 'rgba(245,230,99,' + (.18 + .18 * pulse) + ')'; c.beginPath(); c.arc(ex, ey, 6 + 3 * pulse, 0, 7); c.fill();
      c.fillStyle = '#fff6a8'; c.beginPath(); c.arc(ex, ey, 3, 0, 7); c.fill();
    }
    if (valHist.length) {
      c.strokeStyle = 'rgba(92,225,230,.55)'; c.lineWidth = 1.2; c.beginPath();
      valHist.forEach((v, i) => { const x = sx(v.s), y = sy(v.v); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      for (const v of valHist) { c.fillStyle = '#5ce1e6'; c.beginPath(); c.arc(sx(v.s), sy(v.v), 2.8, 0, 7); c.fill(); }
    }
    if (!n) { c.fillStyle = 'rgba(238,242,230,.4)'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '12px system-ui, sans-serif'; c.fillText('Kayıp burada akacak', padL + pw / 2, padT + ph / 2); }
  }

  // ------------------------------------------------------------------------------------------------
  // Arayüz güncellemeleri
  // ------------------------------------------------------------------------------------------------
  function updateUI() {
    dom.age.textContent = clock(S.ageMs);
    dom.sStep.textContent = nf(S.step);
    dom.sTps.textContent = nf(S.tps);
    dom.sBpc.textContent = isFinite(S.bpc) ? nf(S.bpc, 2) : '-';
    dom.sLoss.textContent = isFinite(S.smLoss) ? nf(S.smLoss, 3) : '-';
    dom.wordStat.textContent = S.scoreWords ? 'Son örneklerde gerçek kelime: ' + S.scoreKnown + ' / ' + S.scoreWords : 'İlk örnek bekleniyor';
    if (dom.stageChip.dataset.stage !== String(S.stage)) {
      dom.stageChip.dataset.stage = S.stage; dom.stageChip.textContent = STAGES[S.stage]; dom.stageHint.textContent = STAGE_HINT[S.stage];
      dom.talk.dataset.stage = S.stage;
      dom.stageItems.forEach((li, i) => { li.classList.toggle('on', i <= S.stage); li.classList.toggle('cur', i === S.stage); });
    }
  }
  function updateScoreAnim() {
    S.shownScore += (S.score - S.shownScore) * (reduceMotion ? 1 : TUNE.scoreEase);
    if (Math.abs(S.score - S.shownScore) < 0.0005) S.shownScore = S.score;
    const p = Math.round(S.shownScore * 100);
    if (String(p) !== dom.scoreVal.textContent) {
      dom.scoreVal.textContent = p; dom.ringArc.style.strokeDashoffset = String(263.9 * (1 - S.shownScore));
      dom.ring.setAttribute('aria-label', 'Türkçe skoru yüzde ' + p);
    }
    // bozuk cam etkisi: skor yükseldikçe sönümlenir
    const g = clamp(1 - S.shownScore * 1.7, 0, 1);
    const gs = g.toFixed(2);
    if (dom.talk.dataset.g !== gs) {
      dom.talk.dataset.g = gs; dom.talk.style.setProperty('--g', gs);
      if (dom.curEntry) { dom.curEntry.style.setProperty('--g', gs); dom.talkText.classList.toggle('jit', g > 0.3 && !reduceMotion); }
    }
  }
  // Panellerin kapladığı yerleri beyne bildir: beyin, arayüzün örtmediği pencerenin ortasına yerleşsin
  let insetKey = '';
  function updateInsets() {
    if (!brain) return;
    const only = dom.ui.classList.contains('only-brain'), W = root.innerWidth, H = root.innerHeight, g = TUNE.insetPad;
    const r = (id) => $(id).getBoundingClientRect();
    let ins = { l: 0, r: 0, t: 0, b: 0 };
    if (!only) {
      const pl = r('pLeft'), pr = r('pRight'), tools = r('tools'), dock = r('dock');
      if (pr.top >= pl.bottom - 1) { // dar ekran: paneller alt alta dizilir (üstte sol, ortada araçlar+dock, altta sağ)
        const dockTop = dock.height > 0 ? dock.top : H;
        ins = { l: g, r: g, t: Math.round(tools.bottom + g), b: Math.round(H - Math.min(dockTop, pr.top) + g) };
      } else {
        ins = { l: Math.round(pl.right + g), r: Math.round(W - pr.left + g), t: Math.round(tools.bottom + g), b: Math.round(H - dock.top + g) };
      }
    }
    const key = ins.l + ',' + ins.r + ',' + ins.t + ',' + ins.b;
    if (key !== insetKey) { insetKey = key; brain.setOptions({ insets: ins }); }
  }
  function brainStatus() {
    if (!brain) return;
    const top = cfg ? Math.log(cfg.V) : 4.6;
    const norm = isFinite(S.smLoss) ? clamp((S.smLoss - TUNE.lossFloor) / (top - TUNE.lossFloor), 0, 1) : 1;
    brain.setStatus({ step: S.step, loss: isFinite(S.smLoss) ? S.smLoss : top, lossNorm: norm, stage: S.stage, tokensPerSec: S.tps });
  }

  let toastN = 0;
  function toast(msg, kind) {
    const el = document.createElement('div'); el.className = 'toast' + (kind ? ' ' + kind : ''); el.textContent = msg;
    dom.toasts.appendChild(el);
    while (dom.toasts.children.length > 3) dom.toasts.removeChild(dom.toasts.firstChild);
    const id = ++toastN; el.dataset.id = id;
    setTimeout(() => el.remove(), TUNE.toastMs + 600);
  }
  function report(e) {
    S.errors++;
    if (S.errors <= 3 || DEBUG) console.error('[limon]', e);
  }

  function fatal(code, extra) {
    const map = {
      NO_WEBGL2: ['Tarayıcın WebGL2\'yi açamıyor', 'Limon, ekran kartını kullanarak öğreniyor; bunun için WebGL2 gerekiyor ve bu sekmede açılamadı.'],
      NO_FLOAT_RT: ['Ekran kartın ondalıklı hesap desteklemiyor', 'Limon\'un öğrenmesi için ekran kartının kayan noktalı dokulara (EXT_color_buffer_float) yazabilmesi gerekiyor. Bu kart ya da sürücü bunu vermiyor.'],
      MISSING: ['Limon eksik parçayla açıldı', 'Uygulamanın bazı parçaları yüklenemedi. Sayfayı yeniden yüklemeyi dene.'],
    };
    const [title, msg] = map[code] || ['Limon burada doğamıyor', 'Başlatma sırasında beklenmedik bir sorun çıktı.'];
    $('fatalTitle').textContent = title; $('fatalMsg').textContent = msg;
    const tips = $('fatalTips'); tips.innerHTML = '';
    ['Chrome, Edge, Firefox ya da Safari\'nin güncel bir sürümünü dene.', 'Tarayıcı ayarlarında "donanım hızlandırma"nın açık olduğundan emin ol.', 'Başka bir cihazda ya da ekran kartı olan bir bilgisayarda aç.']
      .forEach((t) => { const li = document.createElement('li'); li.textContent = t; tips.appendChild(li); });
    $('fatalCode').textContent = [code, extra && (extra.reason || extra.message)].filter(Boolean).join(': ');
    $('fatal').hidden = false; $('splash').classList.add('gone');
    root.__limonFatal = code;
  }

  // ------------------------------------------------------------------------------------------------
  // Kontroller
  // ------------------------------------------------------------------------------------------------
  function setPaused(p) {
    S.paused = !!p;
    dom.ui.classList.toggle('is-paused', S.paused);
    dom.pauseTxt.textContent = S.paused ? 'Devam' : 'Duraklat';
    dom.pauseIcon.setAttribute('href', S.paused ? '#i-play' : '#i-pause');
    dom.btnPause.setAttribute('aria-label', S.paused ? 'Eğitime devam et' : 'Eğitimi duraklat');
    dom.btnPause.title = S.paused ? 'Devam et (P)' : 'Duraklat (P)';
    if (S.paused) syncNow();
  }
  function setToggle(btn, on) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function brainOpts() {
    if (!brain) return;
    brain.setOptions({
      autoRotate: dom.tRot.getAttribute('aria-pressed') === 'true',
      showSynapses: dom.tSyn.getAttribute('aria-pressed') === 'true',
      showLetters: dom.tLet.getAttribute('aria-pressed') === 'true',
      showAttention: dom.tAtt.getAttribute('aria-pressed') === 'true',
    });
  }
  function setOnlyBrain(on) {
    dom.ui.classList.toggle('only-brain', on);
    dom.btnShow.hidden = !on;
    dom.btnHide.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function setCollapsed(id, on) {
    const p = $(id); p.classList.toggle('collapsed', on);
    dom.ui.classList.toggle(id === 'pLeft' ? 'lc' : 'rc', on);
    const b = p.querySelector('.collapse'); b.setAttribute('aria-expanded', on ? 'false' : 'true'); b.setAttribute('aria-label', on ? 'Paneli aç' : 'Paneli daralt');
  }

  function bindUI() {
    dom.btnPause.addEventListener('click', () => setPaused(!S.paused));
    let armT = 0;
    dom.btnReborn.addEventListener('click', () => {
      if (!dom.btnReborn.classList.contains('arm')) {
        dom.btnReborn.classList.add('arm'); dom.rebornTxt.textContent = 'Emin misin?';
        armT = setTimeout(disarm, TUNE.rebornConfirmMs);
      } else { clearTimeout(armT); disarm(); reborn(); }
    });
    function disarm() { dom.btnReborn.classList.remove('arm'); dom.rebornTxt.textContent = 'Yeniden doğur'; }
    for (const b of [dom.tSyn, dom.tLet, dom.tAtt, dom.tRot]) b.addEventListener('click', () => { setToggle(b, b.getAttribute('aria-pressed') !== 'true'); brainOpts(); });
    dom.btnHide.addEventListener('click', () => setOnlyBrain(true));
    dom.btnShow.addEventListener('click', () => setOnlyBrain(false));
    document.querySelectorAll('.collapse').forEach((b) => b.addEventListener('click', () => { S.userPanel[b.dataset.collapse] = true; setCollapsed(b.dataset.collapse, !$(b.dataset.collapse).classList.contains('collapsed')); }));
    dom.rShare.addEventListener('input', () => { S.share = clamp(+dom.rShare.value / 100, 0.1, 1); dom.oShare.textContent = '%' + Math.round(S.share * 100); });
    dom.rTemp.addEventListener('input', () => { S.temp = clamp(+dom.rTemp.value, TUNE.tempMin, TUNE.tempMax); dom.oTemp.textContent = nf(S.temp, 2); });
    dom.chatForm.addEventListener('submit', (e) => { e.preventDefault(); const v = dom.chatInput.value; dom.chatInput.value = ''; submitChat(v); });
    dom.suggest.addEventListener('click', (e) => { const b = e.target.closest('.pill'); if (b) submitChat(b.textContent); });
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && typing) { t.blur(); return; }
      if (typing) return;
      if (e.key === 'h' || e.key === 'H') { setOnlyBrain(!dom.ui.classList.contains('only-brain')); e.preventDefault(); }
      else if (e.key === 'p' || e.key === 'P') { setPaused(!S.paused); e.preventDefault(); }
    });
    // ders defterinde dikey tekerlek yatay kaydırsın
    dom.nbScroll.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { dom.nbScroll.scrollLeft += e.deltaY; e.preventDefault(); }
      dom.nbUserT = performance.now();
    }, { passive: false });
    dom.nbScroll.addEventListener('pointerdown', () => { dom.nbUserT = performance.now(); });
    const edge = () => { // kenarda kart kesiliyorsa yumuşak solma göster
      const n = dom.nbScroll;
      n.style.setProperty('--ml', n.scrollLeft > 4 ? '1.6rem' : '0px');
      n.style.setProperty('--mr', n.scrollLeft + n.clientWidth < n.scrollWidth - 4 ? '1.6rem' : '0px');
    };
    dom.nbScroll.addEventListener('scroll', edge, { passive: true }); dom.nbEdge = edge;
    root.addEventListener('resize', onResize);
    if (root.ResizeObserver) new ResizeObserver(() => chartResize()).observe(dom.chartWrap);
    document.addEventListener('visibilitychange', () => {
      S.hidden = document.hidden;
      if (!document.hidden) { lastNow = 0; S.lastIssueT = 0; } // dönünce dt sıçraması olmasın
    });
  }
  // Dar pencerede paneller kendiliğinden daralır, pencere büyüyünce açılır; kullanıcı elle dokunduysa ona karışılmaz
  function autoPanels() {
    const W = root.innerWidth, want = { pRight: W < 900, pLeft: W < 760 };
    for (const id in want) if (!S.userPanel[id] && $(id).classList.contains('collapsed') !== want[id]) setCollapsed(id, want[id]);
  }
  function onResize() {
    if (brain) brain.resize(root.innerWidth, root.innerHeight, Math.min(root.devicePixelRatio || 1, 2));
    chartResize(); autoPanels(); updateInsets();
  }

  // ------------------------------------------------------------------------------------------------
  // Yeniden doğur
  // ------------------------------------------------------------------------------------------------
  function resetCurves() {
    hist.s.length = hist.l.length = hist.m.length = 0; valHist.length = 0; stageMarks.length = 0;
    S.loss = S.smLoss = S.gradNorm = S.valLoss = NaN; S.bpc = NaN; S.step = 0; S.tps = 0; S.lossN = 0; S.nonFinite = 0;
    S.score = S.shownScore = 0; S.stage = 0; S.maxStage = 0; S.scoreWords = S.scoreKnown = 0; scoreWin = [];
    S.ageMs = 0; S.syncedStep = 0; S.snaps = []; S.chatCount = 0;
    nextSnapIdx = 0; nextValSec = TUNE.valFirstSec; snapBusy = false; tpsLast = 0; tpsT = S.appT; lossT = S.appT; S.lastSyncT = S.appT;
    chart.dirty = true;
  }
  function resetDom(reborn) {
    dom.nbScroll.innerHTML = '<p class="nb-empty">Ders defteri ilk anlık görüntüyle dolacak.</p>';
    dom.chatLog.innerHTML = ''; dom.chatNote = document.createElement('p'); dom.chatNote.className = 'chat-note';
    dom.chatNote.textContent = reborn ? 'Limon yeniden doğdu. Ona bir şey yaz; şimdilik saçmalayabilir.' : 'Limon\'a bir şey yaz. Eğitim sürerken de cevap verir; her cevabın altında hangi adımdaki beyinle konuştuğunu görürsün.'; dom.chatLog.appendChild(dom.chatNote);
    dom.suggest.classList.remove('gone'); dom.typing.hidden = true;
    dom.talkFeed.innerHTML = ''; dom.curEntry = dom.talkText = dom.talkPrompt = null;
    dom.stageChip.dataset.stage = '-1';
  }
  async function reborn() {
    if (rebornBusy || !S.booted) return;
    rebornBusy = true; epoch++;
    try {
      talker.clear(); thinker.reset(); initChat(); resetDom(true); resetCurves();
      const t0 = performance.now();
      while (tr.inFlight() > 0 && performance.now() - t0 < 1500) await sleep(16);
      S.bornCount++; S.seed = S.baseSeed + S.bornCount;
      const w0 = Limon.Layout.init(cfg, S.seed);
      tr.init(w0, S.seed);
      sampler = Limon.Data.createSampler({ B: cfg.B, T: cfg.T, seed: S.seed, synthShare: piecewise(TUNE.synthSchedule, 0) });
      S.weights = w0; thinker.model.setWeights(w0); talker.pendingW = w0; talker.pendingStep = 0; talker.hold = 0;
      thinker.rng = Limon.Util.rng(S.seed * 17 + 3);
      if (brain) { brain.setWeights(w0); brainStatus(); brain.birth(); }
      setPaused(false); updateUI();
      toast('Limon yeniden doğdu!', 'info');
    } catch (e) { report(e); toast('Yeniden doğma başarısız: ' + (e && e.message), 'warn'); }
    rebornBusy = false;
  }

  // ------------------------------------------------------------------------------------------------
  // Ana döngü
  // ------------------------------------------------------------------------------------------------
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const f0 = performance.now();
    const dt = lastNow ? clamp(now - lastNow, 0, TUNE.maxFrameDt) : 16; lastNow = now;
    S.appT += dt;
    S.fps += ((dt > 0 ? 1000 / dt : 60) - S.fps) * 0.05;
    try {
      const live = !rebornBusy;
      if (live) {
        if (!S.paused) {
          S.ageMs += dt;
          pumpTraining();
          if (S.appT - S.lastSyncT >= step2(TUNE.syncSchedule, S.ageMs / 1000)) syncNow();
          pumpVal();
          const sec = S.ageMs / 1000;
          if (!snapBusy && sec >= snapTimeAt(nextSnapIdx)) { const t = snapTimeAt(nextSnapIdx++); takeSnapshot(t); }
        }
        pumpLoss();
        adaptFlight();
        talker.pump(dt, TUNE.talkSliceMs);
        if (!(chat.busy)) thinker.pump(dt);
        // tokens/sn: tamamlanan adımlardan
        if (S.appT - tpsT >= 1000) {
          const done = tr.stepCount - tr.inFlight(), el = (S.appT - tpsT) / 1000;
          const v = S.paused ? 0 : Math.max(0, (done - tpsLast) * cfg.B * cfg.T / el);
          S.tps = S.tps ? S.tps + (v - S.tps) * 0.5 : v; tpsLast = done; tpsT = S.appT;
        }
      }
      updateScoreAnim();
      if (S.appT - uiT >= TUNE.uiEveryMs) { uiT = S.appT; updateUI(); }
      if (S.appT - brainT >= TUNE.brainStatusEveryMs) { brainT = S.appT; brainStatus(); updateInsets(); }
      if (S.appT - chartT >= TUNE.chartEveryMs) { chartT = S.appT; chart.dirty = false; drawChart(); }
      if (brain) brain.render(now / 1000);
    } catch (e) { report(e); }
    S.frameMs += ((performance.now() - f0) - S.frameMs) * 0.05;
    if (DEBUG && dom.debug && (S.appT - (dom.dbgT || 0)) > 500) {
      dom.dbgT = S.appT;
      dom.debug.textContent = 'fps ' + S.fps.toFixed(0) + '  kare ' + S.frameMs.toFixed(1) + ' ms  egitim ' + S.trainMs.toFixed(1) + ' ms  inFlight ' + (tr ? tr.inFlight() : '-') + '  adim ' + S.step;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Açılış
  // ------------------------------------------------------------------------------------------------
  function grabDom() {
    dom = {
      ui: $('ui'), splash: $('splash'), toasts: $('toasts'), brainCv: $('brain'),
      age: $('age'), gpuName: $('gpuName'), paramCount: $('paramCount'),
      talk: $('talk'), talkFeed: $('talkFeed'), talkPrompt: null, talkText: null, curEntry: null,
      ring: $('ring'), ringArc: $('ringArc'), scoreVal: $('scoreVal'), stageChip: $('stageChip'), stageHint: $('stageHint'), wordStat: $('wordStat'),
      stageItems: Array.from($('stageBar').children),
      btnPause: $('btnPause'), pauseTxt: $('pauseTxt'), pauseIcon: $('pauseIcon'), btnReborn: $('btnReborn'), rebornTxt: $('rebornTxt'),
      tSyn: $('tSyn'), tLet: $('tLet'), tAtt: $('tAtt'), tRot: $('tRot'), btnHide: $('btnHide'), btnShow: $('btnShow'),
      sStep: $('sStep'), sTps: $('sTps'), sBpc: $('sBpc'), sLoss: $('sLoss'), chartWrap: document.querySelector('.chart-wrap'),
      rShare: $('rShare'), oShare: $('oShare'), rTemp: $('rTemp'), oTemp: $('oTemp'),
      nbScroll: $('nbScroll'), chatLog: $('chatLog'), chatNote: $('chatNote'), typing: $('typing'), suggest: $('suggest'),
      chatForm: $('chatForm'), chatInput: $('chatInput'),
    };
    chart.cv = $('chart'); chart.ctx = chart.cv.getContext('2d');
    if (DEBUG) {
      dom.debug = document.createElement('div');
      dom.debug.style.cssText = 'position:fixed;left:8px;bottom:4px;z-index:99;font:11px ui-monospace,monospace;color:#9f9;pointer-events:none';
      document.body.appendChild(dom.debug);
    }
  }

  async function boot() {
    grabDom(); bindUI(); initChat();
    dom.nbScroll.innerHTML = '<p class="nb-empty">Ders defteri ilk anlık görüntüyle dolacak.</p>';
    dom.rShare.value = '100'; dom.rTemp.value = String(TUNE.temperature);
    S.temp = TUNE.temperature; dom.oTemp.textContent = nf(S.temp, 2);
    const sp = parseFloat(params.get('speed'));
    if (isFinite(sp) && sp > 0) { if (sp <= 1) S.share = clamp(sp, 0.1, 1); else S.speedMul = Math.min(sp, 8); }
    S.share = clamp(S.share, 0.1, 1); dom.rShare.value = String(Math.round(S.share * 100)); dom.oShare.textContent = '%' + Math.round(S.share * 100);
    setToggle(dom.tRot, !reduceMotion);
    await nextPaint(); // "Limon doğuyor" ekranı boyansın
    const t0 = performance.now();
    try {
      for (const k of ['Data', 'CPUModel', 'Layout', 'Util', 'GPU']) if (!Limon[k]) throw Object.assign(new Error('Limon.' + k + ' yok'), { code: 'MISSING' });
      const sup = Limon.GPU.supported ? Limon.GPU.supported() : { ok: true };
      if (!sup.ok) return fatal(/float/i.test(sup.reason || '') ? 'NO_FLOAT_RT' : /webgl2/i.test(sup.reason || '') ? 'NO_WEBGL2' : (sup.reason || 'NO_WEBGL2'), sup);
      const Data = Limon.Data;
      cfg = Object.assign({}, Limon.CONFIG, { V: Data.V });
      const seedP = parseInt(params.get('seed'), 10);
      S.baseSeed = isFinite(seedP) ? seedP : 1 + Math.floor(Math.random() * 1e6); S.seed = S.baseSeed;
      Data.knownWords; // kelime kümesini perde arkasında kur (ilk kullanımda takılma olmasın)
      valBatch = Data.valBatch(cfg.B, cfg.T);
      sampler = Data.createSampler({ B: cfg.B, T: cfg.T, seed: S.seed, synthShare: piecewise(TUNE.synthSchedule, 0) });
      makeBufs();
      try { tr = new Limon.GPU.Trainer(cfg, { seed: S.seed }); }
      catch (e) { return fatal(e && e.code, e); }
      const w0 = Limon.Layout.init(cfg, S.seed);
      tr.init(w0, S.seed);
      thinker = makeThinker(new Limon.CPUModel(cfg)); thinker.rng = Limon.Util.rng(S.seed * 17 + 3);
      talker = makeTalker(new Limon.CPUModel(cfg)); talker.liveFactory = liveJob;
      thinker.model.setWeights(w0); talker.pendingW = w0; S.weights = w0;
      if (params.get('nobrain') !== '1' && Limon.Brain) {
        try {
          brain = new Limon.Brain(dom.brainCv, cfg);
          brain.resize(root.innerWidth, root.innerHeight, Math.min(root.devicePixelRatio || 1, 2));
          brain.setWeights(w0); brainOpts(); brainStatus();
        } catch (e) { report(e); brain = null; toast('3B beyin bu tarayıcıda açılamadı; eğitim sürüyor.', 'info'); }
      }
      const info = tr.info || {};
      dom.gpuName.textContent = gpuLabel(info.renderer || sup.renderer);
      const pc = info.paramCount || Limon.Layout.paramCount(cfg);
      dom.paramCount.textContent = (pc >= 1e6 ? nf(pc / 1e6, 2) + ' milyon' : nf(Math.round(pc / 1000)) + ' bin') + ' parametre';
      onResize(); chartResize();
      resetDom(); updateUI(); setPaused(false);
      S.booted = true; tpsT = 0; S.appT = 0;
      root.addEventListener('pagehide', () => { try { tr.dispose(); if (brain) brain.dispose(); } catch (_) { /* kapanıyor */ } });
      rafId = requestAnimationFrame(frame);
      // ilk saçmalama örneği akmaya başlayana kadar (birkaç kare) bekle, sonra perdeyi kaldır
      const need = TUNE.minSplashMs - (performance.now() - t0); if (need > 0) await sleep(need);
      dom.splash.classList.add('gone'); document.body.classList.add('ready');
      if (brain) brain.birth();
      setTimeout(() => toast('Beyni tutup döndür, tekerlekle yakınlaştır. H tuşu panelleri gizler.', 'info'), TUNE.hintDelayMs);
      root.__limonReady = true;
    } catch (e) {
      report(e); fatal(e && e.code, e);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Dış API (test/hata ayıklama)
  // ------------------------------------------------------------------------------------------------
  root.__limon = {
    state: S, TUNE,
    stats() {
      return {
        step: S.step, loss: S.loss, smLoss: S.smLoss, valLoss: S.valLoss, score: S.score, shownScore: S.shownScore, stage: S.stage,
        tokensPerSec: S.tps, bpc: S.bpc, ageSec: S.ageMs / 1000, paused: S.paused, inFlight: tr ? tr.inFlight() : 0,
        frameMs: S.frameMs, trainMs: S.trainMs, fps: S.fps, snaps: S.snaps.length, chats: S.chatCount, seed: S.seed, errors: S.errors,
        maxInFlight: S.maxInFlight, syncedStep: S.syncedStep, histLen: hist.s.length, brain: !!brain,
      };
    },
    sample(prompt, n, temp) {
      if (!probe) probe = new Limon.CPUModel(cfg);
      probe.setWeights(S.weights);
      return genSync(probe, prompt == null ? '\n' : prompt, n == null ? 120 : n, temp == null ? S.temp : temp, Limon.Util.rng(7), null);
    },
    chat: submitChat,
    syncNow,
    pause() { setPaused(true); },
    resume() { setPaused(false); },
    reborn,
    get parts() { return { cfg, tr, brain, sampler, talker, thinker }; },
  };
  root.__limonReady = false;
  Limon.App = { TUNE, state: S };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
