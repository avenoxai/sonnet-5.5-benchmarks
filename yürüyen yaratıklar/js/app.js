/* app.js  -  durum, ana döngü ve arayüz bağlantıları.
 *
 * Motor (js/core.js) yalnızca CONTRACT.md'deki API ile kullanılır: Trainer, Arena, SPECIES, TERRAINS, makeTerrain.
 * Bu dosya: tek requestAnimationFrame döngüsü, bütçeli simülasyon dilimleri, HUD, galeri/spot ışığı tekrarları,
 * kayıt/devam (localStorage), klavye, ayarlar çekmecesi, test kancaları (window.__app, URL parametreleri).
 */
(function () {
  'use strict';
  const YY = window.YY, fmt = YY.fmt;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const SLICE = 1 / 60;
  const SPEEDS = [1, 2, 4, 8, 16, 32, 64]; // 64 = MAKS
  const CAMS = ['leader', 'pack', 'free'];
  const CAM_NAMES = { leader: 'Lider takibi', pack: 'Tüm sürü', free: 'Serbest' };
  // [boy eşiği, bildirim başlığı, açıklama, grafikteki kısa not]
  const MILESTONES = [
    [1, 'İlk adımlar!', 'En iyi yaratık kendi boyu kadar yol aldı.', 'ilk adımlar'],
    [3, 'Ritim yakalandı!', 'Bacaklar birbirini izlemeye başladı: 3 boy.', 'ritim'],
    [6, 'Yürüyüş oturdu.', 'Altı boy: adımlar artık düzenli.', 'düzenli adım'],
    [12, 'Koşuya geçtiler!', 'On iki boy: yürümekten çok koşuyorlar.', 'koşu'],
    [24, 'Ustalaştılar.', 'Yirmi dört boy: bu soyun yürüyüşü artık bir sanat.', 'ustalık'],
  ];
  const SAVE_PREFIX = 'yy.b.save.', PREF_KEY = 'yy.b.prefs';

  /* ------------------------------------------------------------------ motor kontrolü */
  const W = window.Walkers;
  if (!W || !W.Trainer || !W.SPECIES || !W.Arena) {
    $('fatal').hidden = false;
    $('fatalText').textContent = !W ? 'js/core.js yüklenemedi (Walkers tanımlı değil).' : 'js/core.js beklenen arayüzü (Trainer, Arena, SPECIES) sunmuyor.';
    return;
  }

  /* ------------------------------------------------------------------ durum */
  const q = new URLSearchParams(location.search);
  const qn = (k) => (q.has(k) && isFinite(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : null);
  const NOSAVE = q.get('nosave') === '1';
  const store = {
    get(k) { if (NOSAVE) return null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { if (NOSAVE) return true; try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { if (NOSAVE) return; try { localStorage.removeItem(k); } catch (e) { /* yok say */ } },
    keys() { if (NOSAVE) return []; try { const r = []; for (let i = 0; i < localStorage.length; i++) r.push(localStorage.key(i)); return r; } catch (e) { return []; } },
  };
  let prefs = {}; try { prefs = JSON.parse(store.get(PREF_KEY) || '{}') || {}; } catch (e) { prefs = {}; }

  const speciesIds = W.SPECIES.map((s) => s.id);
  const terrainIds = (W.TERRAINS || [{ id: 'flat', name: 'Düz Zemin' }]).map((t) => t.id);
  const S = {
    trainer: null,
    opts: {
      species: speciesIds.includes(q.get('species')) ? q.get('species') : speciesIds.includes('quad') ? 'quad' : speciesIds[0],
      terrain: terrainIds.includes(q.get('terrain')) ? q.get('terrain') : 'flat',
      seed: qn('seed') !== null ? Math.max(1, Math.floor(qn('seed'))) : 1,
      popSize: qn('pop') !== null ? clamp(Math.round(qn('pop')), 12, 120) : 48,
      duration: 15, mutation: 1, evolveBody: false,
    },
    urlSpecified: { terrain: q.has('terrain'), seed: q.has('seed'), pop: q.has('pop') },
    speed: qn('speed') !== null ? nearestSpeed(qn('speed')) : prefs.speed ? nearestSpeed(prefs.speed) : 4,
    paused: q.get('paused') === '1',
    cam: CAMS.includes(prefs.cam) ? prefs.cam : 'leader',
    ghost: !!prefs.ghost,
    ui: q.get('ui') !== '0',
    introSeen: !!prefs.introSeen, introDone: q.get('intro') === '0' || !!prefs.introSeen,
    acc: 0, eff: 0, drawMs: 2, frames: 0, fps: 60, hidden: document.hidden, lastT: 0,
    skipping: false, ffActive: false, ffDone: false,
    order: [], histLen: 0, gen: 1, reached: new Set(), recDist: 0,
    lastBanner: -99, lastFade: -99, saveDue: false, lastSave: 0, lastHud: 0,
    spot: null, drawerOpen: false, modalOpen: false, errShown: {},
    lead: null, orderGen: -1, frameErrs: 0, staleSince: 0, stagHinted: false, introTimer: 0,
  };
  function nearestSpeed(n) { let b = 4, d = 1e9; for (const s of SPEEDS) { const dd = Math.abs(s - n); if (dd < d) { d = dd; b = s; } } return n >= 64 ? 64 : b; }

  /* ------------------------------------------------------------------ dünya + grafik */
  const world = new YY.World($('world'), $('paper'), $('grain'));
  const chart = new YY.FitnessChart($('chart'), {
    onPick: (gen) => openSpotGen(gen),
    hasChampion: (gen) => !!findChampion(gen, true),
  });

  let vw = 0, vh = 0;
  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    world.resize(vw, vh, window.devicePixelRatio || 1);
    layoutSafe();
  }
  /** HUD panellerinin kapladığı bölgeyi hesaba katarak kamera için "güvenli" alanı belirler. */
  function layoutSafe() {
    const g = $('gallery'), gr = g.getBoundingClientRect();
    const top = gr.height > 0 ? gr.top : vh - 90;
    world.groundY = clamp(top - 34, vh * 0.42, vh * 0.70);
    if (!S.ui) { world.safeL = 12; world.safeR = 12; world.panels = null; return; }
    // Paneller yalnız zemin çizgisinin üstündeki yaratık + etiket bandına uzanıyorsa kamera güvenli alanını daraltır.
    // Paneller yeterince yukarıda bitiyorsa dünya tüm genişliği kullanır: yaratıklar büyük çizilir.
    const clear = world.groundY - Math.max(80, vh * 0.1);
    const lc = $('leftCol').getBoundingClientRect(), rc = ($('drawer').hidden ? $('rightCol') : $('drawer')).getBoundingClientRect();
    world.panels = { lr: lc.right, lb: lc.bottom, rl: rc.left, rb: rc.bottom };
    world.safeL = lc.bottom > clear ? lc.right + 10 : 12;
    world.safeR = (rc.bottom > clear || !$('drawer').hidden) ? Math.max(0, vw - rc.left) + 10 : 12;
    if (vw < 900) { world.safeL = Math.min(world.safeL, 10); world.safeR = Math.min(world.safeR, 10); }
  }

  /* ------------------------------------------------------------------ kayıt / devam */
  const saveKey = (sp) => SAVE_PREFIX + sp;
  function loadSave(sp) {
    const raw = store.get(saveKey(sp)); if (!raw) return null;
    try { const o = JSON.parse(raw); return o && o.options && o.population ? o : null; } catch (e) { store.del(saveKey(sp)); return null; }
  }
  function saveNow() {
    const T = S.trainer; if (!T || NOSAVE) return;
    S.saveDue = false; S.lastSave = performance.now();
    try {
      const str = JSON.stringify(T.serialize());
      if (!store.set(saveKey(S.opts.species), str)) throw new Error('quota');
      $('saveInfo').textContent = 'Kaydedildi: nesil ' + T.generation + ' (' + Math.round(str.length / 1024) + ' KB). Sayfayı yenilersen kaldığın yerden devam edersin.';
    } catch (e) { $('saveInfo').textContent = 'Kayıt yapılamadı (tarayıcı depolaması dolu ya da kapalı). Deney yine de çalışır.'; }
    try { store.set(PREF_KEY, JSON.stringify({ speed: S.speed, cam: S.cam, ghost: S.ghost, introSeen: S.introSeen })); } catch (e) { /* yok say */ }
  }
  function savePrefs() { store.set(PREF_KEY, JSON.stringify({ speed: S.speed, cam: S.cam, ghost: S.ghost, introSeen: S.introSeen })); }

  /** Trainer kur: kayıt varsa devam et (URL'de açıkça istenen ayarlarla çelişmiyorsa), yoksa yeni başlat. */
  function makeTrainer(species, o) {
    o = o || {};
    S.opts.species = species;
    if (!o.fresh) {
      const saved = loadSave(species);
      if (saved) {
        const so = saved.options || {};
        const conflict = (S.urlSpecified.terrain && so.terrain !== S.opts.terrain) || (S.urlSpecified.seed && so.seed !== S.opts.seed) || (S.urlSpecified.pop && so.popSize !== S.opts.popSize);
        if (!conflict) {
          try {
            const t = W.Trainer.deserialize(saved);
            validateTrainer(t);
            Object.assign(S.opts, pickOpts(so)); S.opts.species = species;
            S.resumed = { gen: t.generation, species };
            S.urlSpecified = { terrain: false, seed: false, pop: false };
            return t;
          } catch (e) { console.warn('kayıt okunamadı, yeni deney başlatılıyor', e); store.del(saveKey(species)); S.badSave = true; }
        }
      }
    }
    S.resumed = null;
    S.urlSpecified = { terrain: false, seed: false, pop: false };
    return new W.Trainer(Object.assign({}, S.opts, { species }));
  }
  /** Kayıt yapısal olarak bozuksa (deserialize geçse bile) hata fırlatır: çağıran kaydı silip yeni deney başlatır. */
  function validateTrainer(t) {
    const bad = (m) => { throw new Error('bozuk kayıt: ' + m); };
    if (!t || typeof t !== 'object') bad('trainer yok');
    if (!Array.isArray(t.history)) bad('history');
    if (!Array.isArray(t.champions)) bad('champions');
    for (const h of t.history) if (!h || typeof h !== 'object') bad('history öğesi');
    for (const c of t.champions) if (!c || typeof c !== 'object' || !c.genome) bad('champions öğesi');
    if (!(t.generation >= 1) || !isFinite(t.generation)) bad('generation');
    if (!Array.isArray(t.creatures) || !t.creatures.length) bad('creatures');
    if (t.best != null && (typeof t.best !== 'object' || !t.best.genome)) bad('best');
    if (t.history.length > t.generation + 1) bad('history uzunluğu');
  }
  function pickOpts(o) {
    const r = {};
    if (terrainIds.includes(o.terrain)) r.terrain = o.terrain;
    if (isFinite(o.seed)) r.seed = o.seed;
    if (isFinite(o.popSize)) r.popSize = clamp(o.popSize, 12, 120);
    if (isFinite(o.duration)) r.duration = clamp(o.duration, 4, 60);
    if (isFinite(o.mutation)) r.mutation = clamp(o.mutation, 0.25, 3);
    if (typeof o.evolveBody === 'boolean') r.evolveBody = o.evolveBody;
    return r;
  }

  /** Yeni trainer örneği kurulunca izleme durumunu sıfırla. */
  function adoptTrainer(t) {
    S.trainer = t; S.gen = t.generation; S.histLen = t.history.length; S.order = []; S.acc = 0; S.skipping = false;
    S.reached = new Set(); S.recDist = 0;
    const bl = bodyLen();
    for (const h of t.history) { S.recDist = Math.max(S.recDist, h.bestDist || 0); for (const m of MILESTONES) if ((h.bestDist || 0) / bl >= m[0]) S.reached.add(m[0]); }
    if (t.best && t.best.dist > S.recDist) S.recDist = t.best.dist;
    ghost = null; world.snap = true; world.keepScale = false; galleryKey = ''; closeSpot(); S.notesLen = -1;
    S.lead = null; S.orderGen = -1; S.frameErrs = 0; S.stagHinted = false; clearToasts(); resetRank();
    chart.hist = []; chart.dirty = true;
    syncUI();
  }
  function bodyLen() { const c = S.trainer && S.trainer.creatures && S.trainer.creatures[0]; return c && c.bodyLength > 0.05 ? c.bodyLength : 0.6; }

  /* ------------------------------------------------------------------ bildirimler, onay, uyarı */
  function clearToasts() { const box = $('toasts'); while (box.firstChild) box.removeChild(box.firstChild); }
  function toast(kind, title, sub, ms) {
    const box = $('toasts');
    for (const c of Array.from(box.children)) if ((c.firstChild && c.firstChild.textContent === title) || (kind === 'genend' && c.classList.contains('genend'))) box.removeChild(c); // aynı başlık / eski nesil sonu bandı üst üste binmesin
    while (box.children.length >= 3) box.removeChild(box.firstChild);
    const el = document.createElement('div'); el.className = 'toast ' + (kind || '');
    const b = document.createElement('b'); b.textContent = title; el.appendChild(b);
    if (sub) { const s = document.createElement('span'); s.textContent = sub; el.appendChild(s); }
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 650); }, ms || 4200);
  }
  let noticeTimer = 0;
  function notice(text, ms) { const n = $('notice'); n.textContent = text; n.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { n.hidden = true; }, ms || 4000); }

  function ask(title, text, okLabel) {
    return new Promise((res) => {
      const m = $('modal'); $('modalTitle').textContent = title; $('modalText').textContent = text; $('modalOk').textContent = okLabel || 'Tamam';
      m.hidden = false; S.modalOpen = true; $('modalOk').focus();
      const done = (v) => { m.hidden = true; S.modalOpen = false; $('modalOk').onclick = $('modalCancel').onclick = null; window.removeEventListener('keydown', onKey, true); res(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter' && document.activeElement !== $('modalCancel')) { e.preventDefault(); e.stopPropagation(); done(true); } };
      window.addEventListener('keydown', onKey, true);
      $('modalOk').onclick = () => done(true); $('modalCancel').onclick = () => done(false);
    });
  }

  /* ------------------------------------------------------------------ nesil sonu olayları */
  function onGenerationEnd(fromHist, quiet) {
    const T = S.trainer, H = T.history; if (H.length <= fromHist) return;
    const h = H[H.length - 1], bl = bodyLen(), best = h.bestDist || 0;
    const now = performance.now() / 1000;
    let record = false, prevRec = S.recDist;
    if (best > S.recDist * 1.03 + 0.05 && H.length > 1) record = true;
    const bigRecord = record && best > prevRec * 1.08 && now - (S.lastRecToast || -99) > 8;
    S.recDist = Math.max(S.recDist, best);
    if (T.best && T.best.dist > S.recDist) S.recDist = T.best.dist;
    S.saveDue = true; world.snap = true; world.keepScale = true; S.genStartAt = now; S.lead = null; S.orderGen = -1;
    if (!quiet) {
      let mile = null;
      for (const m of MILESTONES) if (best / bl >= m[0] && !S.reached.has(m[0])) mile = m;
      for (const m of MILESTONES) if (best / bl >= m[0]) S.reached.add(m[0]);
      if (mile) toast('record', mile[1], mile[2] + ' (' + fmt(best) + ' m)', 6000);
      else if (bigRecord) { S.lastRecToast = now; toast('record', 'Yeni rekor: ' + fmt(best) + ' m', 'Nesil ' + h.gen + ' sonunda kırıldı. Önceki rekor ' + fmt(prevRec) + ' m.', 5000); }
      else if (now - S.lastBanner > 2.4) toast('genend', 'Nesil ' + h.gen + ' tamamlandı', 'en iyi ' + fmt(best) + ' m  ·  ortalama ' + fmt(h.meanDist || 0) + ' m', 3000);
      if (mile || bigRecord || now - S.lastBanner > 2.4) S.lastBanner = now;
      // yumuşak geçiş: yalnız yavaş hızlarda (hızlı modda nesil zaten saniyede birkaç kez döner)
      if (S.speed <= 8 && now - S.lastFade > 2.6 && !S.paused) { S.lastFade = now; const c = $('world'); c.classList.remove('genfade'); void c.offsetWidth; c.classList.add('genfade'); }
      stagnationCheck(now);
    } else for (const m of MILESTONES) if (best / bl >= m[0]) S.reached.add(m[0]);
    if (S.ui) { const g = $('genNum'); g.classList.remove('tick'); void g.offsetWidth; g.classList.add('tick'); }
  }

  /** Rekor uzun süredir kırılmadıysa sessizce söyle (ilerleme düzleşince "hiçbir şey olmuyor" hissi vermesin). */
  function stagnationCheck(now) {
    const n = stagnation();
    if (n >= 14 && !S.stagHinted) { S.stagHinted = true; toast('', 'Rekor ' + n + ' nesildir aşılamadı', 'Ayarlar > Mutasyon şiddetini artırmayı ya da tohumu değiştirmeyi dene.', 7000); }
    if (n === 0) S.stagHinted = false;
  }
  /** Son rekordan bu yana geçen nesil sayısı. */
  function stagnation() {
    const T = S.trainer; if (!T || !T.best || !(T.best.gen > 0)) return 0;
    return Math.max(0, T.generation - 1 - T.best.gen);
  }

  /* ------------------------------------------------------------------ hayalet (tüm zamanların en iyisi) */
  let ghost = null; // { arena, view, gen }
  function ghostSync() {
    const T = S.trainer;
    if (!S.ghost || !T.best || !T.best.genome) { ghost = null; return; }
    if (ghost && ghost.gen === T.generation && ghost.bestGen === T.best.gen && ghost.terr === S.opts.terrain) return;
    try {
      const arena = new W.Arena({ species: S.opts.species, terrain: S.opts.terrain, seed: S.opts.seed, evolveBody: !!S.opts.evolveBody });
      const view = arena.add(JSON.parse(JSON.stringify(T.best.genome)));
      let t = T.time, g = 0; while (t > 1e-6 && g++ < 3000) { const d = Math.min(t, 1 / 30); arena.step(d); t -= d; }
      ghost = { arena, view, gen: T.generation, bestGen: T.best.gen, terr: S.opts.terrain };
    } catch (e) { ghost = null; note('ghost', 'Hayalet çizilemedi: ' + e.message); }
  }
  function note(k, msg) { if (S.errShown[k] !== msg) { S.errShown[k] = msg; console.warn(msg); } }

  /* ------------------------------------------------------------------ küçük tekrar oynatıcı (galeri + spot ışığı) */
  class Replay {
    constructor(canvas, fps, rate) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.fps = fps; this.rate = rate; this.entries = []; this.views = []; this.acc = 0; this.hold = 0; this.time = 0; this.cam = { x: 0, y: 0, s: 40, fx: 0, gy: 0, W: 1, H: 1 }; this.fail = false; }
    set(entries, cfg) { this.entries = entries; this.cfg = cfg; this.build(); }
    build() {
      if (this.beforeBuild) this.beforeBuild();
      this.views = []; this.fail = false; this.time = 0; this.hold = 0;
      try {
        const c = this.cfg; this.arena = new W.Arena({ species: c.species, terrain: c.terrain, seed: c.seed, evolveBody: !!c.evolveBody });
        for (const e of this.entries) this.views.push({ view: this.arena.add(JSON.parse(JSON.stringify(e.genome))), alpha: e.alpha, lead: e.lead, mode: e.mode || 0 });
        this.snap = true; this.snap0 = false;
      } catch (e) { this.fail = true; note('replay', 'Tekrar oynatılamadı: ' + e.message); }
    }
    tick(dt) {
      if (this.fail || !this.arena) return;
      if (this.hold > 0) { this.hold -= dt; if (this.hold <= 0) this.build(); return; }
      try { this.arena.step(Math.min(dt, 0.05) * this.rate); } catch (e) { this.fail = true; return; }
      this.time += dt * this.rate;
      let dead = true; for (const v of this.views) if (v.view.alive !== false) dead = false;
      if (this.time >= (this.cfg.duration || 15) || dead) this.hold = 0.9;
    }
    draw(dt) {
      this.acc += dt; if (this.acc < 1 / this.fps) return; this.acc = 0;
      const c = this.c, w = c.clientWidth, h = c.clientHeight; if (w < 4 || h < 4 || this.fail || !this.views.length) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      // kamera: öndeki yaratığı takip eder; yaratık boyutuna göre ölçek; ikisi ayrılırsa uzaklaşır
      let mx = -1e9, mn = 1e9, bl = 0.6, ll = 0.5;
      for (const e of this.views) { const v = e.view; if (isFinite(v.x)) { mx = Math.max(mx, v.x); mn = Math.min(mn, v.x); } bl = Math.max(bl, v.bodyLength || 0); ll = Math.max(ll, v.legLength || 0); }
      if (!isFinite(mx)) return;
      const multi = this.views.length > 1, s0 = (h * (multi ? 0.5 : 0.6)) / (ll + bl * 0.3), span = mx - mn;
      // tek yaratık: boyuta göre sabit ölçek. Yarış (karşılaştırma): ikisi sığıyorsa ikisini, sığmıyorsa öndekini izle.
      const s = clamp(s0, 8, 400), fits = span * s < w * 0.6;
      const cam = this.cam, k = this.snap ? 1 : 0.2; this.snap = false;
      cam.s += (s - cam.s) * k; const tx = multi && fits ? (mx + mn) / 2 : mx; cam.x += (tx - cam.x) * Math.max(k, 0.5); const th = this.arena.terrain.heightAt(tx); cam.y = this.snap0 ? cam.y + ((th || 0) - cam.y) * 0.35 : (th || 0); this.snap0 = true; cam.fx = w * 0.5; cam.gy = h * 0.8;
      YY.drawMini(this.ctx, dpr, w, h, cam, this.arena.terrain, this.views, { minGap: w < 200 ? 56 : 70 });
      // ekran dışında kalan yaratık için kenar oku
      const ctx = this.ctx;
      for (const e of this.views) {
        const px = cam.fx + (e.view.x - cam.x) * cam.s, side = px < 2 ? 1 : px > w - 2 ? -1 : 0; if (!side) continue;
        const ax = side > 0 ? 3 : w - 3, ay = cam.gy - 26;
        ctx.fillStyle = e.mode === 2 ? 'hsl(206,30%,62%)' : YY.dotColor(e.view.hue); ctx.strokeStyle = 'rgb(44,35,23)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + side * 9, ay - 6); ctx.lineTo(ax + side * 9, ay + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // canlı mesafe
      let y = 9;
      for (const e of this.views) {
        ctx.fillStyle = e.mode === 2 ? 'hsl(206,30%,62%)' : YY.dotColor(e.view.hue); ctx.beginPath(); ctx.arc(9, y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgb(44,35,23)'; ctx.lineWidth = 1; ctx.stroke();
        YY.tag(ctx, fmt(e.view.x, 1) + ' m', 17, y, `600 10px ${YY.MONO}`, 'rgb(44,35,23)', 'left'); y += 13;
      }
    }
  }

  /* ------------------------------------------------------------------ şampiyon bulma, galeri */
  function findChampion(gen, exact) {
    const cs = S.trainer && S.trainer.champions; if (!cs || !cs.length) return null;
    let best = null;
    for (let i = 0; i < cs.length; i++) { const c = cs[i]; if (c.gen === gen) return c; if (!exact && c.gen <= gen) best = c; }
    return best;
  }
  /** Galeri için: ilk nesil, rekor kıran dönüm noktalarından birkaçı, en son şampiyon. */
  function pickGallery(max) {
    const cs = S.trainer.champions || []; if (!cs.length) return [];
    if (cs.length <= max) return cs.slice();
    const recs = []; let run = -Infinity;
    for (const c of cs) if (c.fitness > run * 1.08 + 1e-9) { run = Math.max(run, c.fitness); recs.push(c); }
    const first = cs[0], last = cs[cs.length - 1], mid = recs.filter((c) => c !== first && c !== last);
    const out = [first], want = max - 2;
    if (mid.length <= want) out.push(...mid);
    else for (let i = 0; i < want; i++) out.push(mid[Math.round((i + 0.5) * mid.length / want - 0.5)]);
    out.push(last);
    return out;
  }
  let plates = [], galleryKey = '', galleryMin = false;
  let plateList = []; // {gen, champ, btn, capB, capD, r, latest, pending}
  function galleryMax() { return vw >= 1500 ? 5 : vw >= 1200 ? 4 : vw >= 1000 ? 3 : 2; }
  function plateChamp(pl, c) {
    pl.champ = c; pl.gen = c.gen; pl.capB.textContent = 'Nesil ' + c.gen; pl.capD.textContent = fmt(c.dist || 0) + ' m';
    pl.btn.title = 'Nesil ' + c.gen + ' şampiyonunu büyüt'; pl.btn.onclick = () => openSpotGen(pl.gen);
    pl.r.entries = [{ genome: c.genome, alpha: 0.95, lead: true }];
  }
  function makePlate(c) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'plate-card';
    const cv = document.createElement('canvas'); btn.appendChild(cv);
    const cap = document.createElement('div'); cap.className = 'cap';
    const b = document.createElement('b'); b.style.fontWeight = '600'; const d = document.createElement('span'); d.className = 'num';
    cap.appendChild(b); cap.appendChild(d); btn.appendChild(cap);
    const r = new Replay(cv, 22, 2), pl = { gen: c.gen, champ: c, btn, capB: b, capD: d, r, latest: false, pending: null };
    r.set([{ genome: c.genome, alpha: 0.95, lead: true }], replayCfg());
    // en son şampiyon her nesilde değişir: yeni genomu bir döngünün SONUNDA al, böylece plaka hep tam bir yürüyüş gösterir
    r.beforeBuild = () => { if (pl.pending) { const p = pl.pending; pl.pending = null; plateChamp(pl, p); } };
    plateChamp(pl, c);
    return pl;
  }
  /** Galeri plakalarını korur: yalnız kümeye yeni giren plaka kurulur; diğerleri kesintisiz döner. */
  function buildGallery() {
    const T = S.trainer, list = pickGallery(galleryMax());
    const cfg = S.opts.species + '|' + S.opts.terrain + '|' + S.opts.seed + '|' + (T.duration || 0) + '|' + !!S.opts.evolveBody + '|' + galleryMax();
    const row = $('galleryRow');
    if (cfg !== galleryKey) { galleryKey = cfg; plateList = []; plates = []; row.textContent = ''; }
    if (!list.length) {
      if (!row.querySelector('.empty')) {
        row.textContent = ''; plateList = []; plates = [];
        const d = document.createElement('div'); d.className = 'plate-card empty';
        d.innerHTML = '<div class="ph">İlk nesil bitince en iyi yaratık burada tekrar oynatılır.</div>'; row.appendChild(d);
      }
      return;
    }
    const emp = row.querySelector('.empty'); if (emp) emp.remove();
    const multi = list.length > 1, last = list[list.length - 1], others = multi ? list.slice(0, -1) : list;
    const used = new Set(), next = [];
    const findBy = (gen, latestFlag) => plateList.find((pl) => !used.has(pl) && pl.gen === gen && (latestFlag === undefined || pl.latest === latestFlag));
    for (const c of others) {
      let pl = findBy(c.gen);
      if (pl) { pl.latest = false; pl.pending = null; } else { pl = makePlate(c); }
      used.add(pl); next.push(pl);
    }
    if (multi) {
      let pl = findBy(last.gen, true) || plateList.find((p) => !used.has(p) && p.latest);
      if (pl) { if (pl.gen !== last.gen) pl.pending = last; else pl.pending = null; }
      else pl = makePlate(last);
      pl.latest = true; used.add(pl); next.push(pl);
    }
    for (const pl of plateList) if (!used.has(pl)) pl.btn.remove();
    plateList = next; plates = next.map((pl) => pl.r);
    next.forEach((pl, i) => { pl.btn.classList.toggle('latest', !!pl.latest); if (row.children[i] !== pl.btn) row.insertBefore(pl.btn, row.children[i] || null); });
    while (row.children.length > next.length) row.removeChild(row.lastChild);
  }
  function replayCfg(species) { return { species: species || S.opts.species, terrain: S.opts.terrain, seed: S.opts.seed, evolveBody: S.opts.evolveBody, duration: Math.min(S.trainer.duration || 15, 20) }; }

  /* ------------------------------------------------------------------ spot ışığı */
  let spotReplay = null;
  function openSpotGen(gen) {
    const c = findChampion(gen); if (!c) return;
    const last = S.trainer.champions[S.trainer.champions.length - 1];
    S.spot = { champ: c, latest: last, imported: null };
    showSpot();
  }
  function openSpotImported(obj) {
    S.spot = { champ: { gen: obj.generation || 0, dist: obj.dist || 0, fitness: obj.fitness || 0, genome: obj.genome }, latest: null, imported: obj };
    showSpot();
  }
  function showSpot() {
    const sp = S.spot; if (!sp) return;
    // çekmece açıksa spot ışığı onun altında kalmasın: geniş ekranda çekmecenin soluna yanaşır, dar ekranda çekmece kapanır
    if (S.drawerOpen && vw < 1500) setDrawer(false);
    $('spotlight').hidden = false; document.body.classList.add('spot-open');
    $('spotTitle').textContent = sp.imported ? 'İçe aktarılan şampiyon' : 'Nesil ' + sp.champ.gen + ' şampiyonu';
    const compare = $('spotCompare').checked && sp.latest && sp.latest.gen !== sp.champ.gen && !sp.imported;
    $('spotCompare').parentElement.style.display = sp.imported || (sp.latest && sp.latest.gen === sp.champ.gen) ? 'none' : '';
    if (!spotReplay) spotReplay = new Replay($('spotCanvas'), 40, 1);
    const entries = [{ genome: sp.champ.genome, alpha: 0.92, lead: true }];
    if (compare) entries.push({ genome: sp.latest.genome, alpha: 0.8, lead: false, mode: 2 });
    spotReplay.set(entries, replayCfg(sp.imported && sp.imported.species && speciesIds.includes(sp.imported.species) ? sp.imported.species : undefined));
    const lg = $('spotLegend'); lg.textContent = '';
    const add = (label, view, dashed) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = dashed ? 'hsl(206,30%,62%)' : YY.dotColor(view ? view.hue : 30); if (dashed) i.style.borderStyle = 'dashed'; s.appendChild(i); s.appendChild(document.createTextNode(label)); lg.appendChild(s); };
    add(sp.imported ? 'dosyadaki genom' : 'Nesil ' + sp.champ.gen + ' · ' + fmt(sp.champ.dist || 0) + ' m', spotReplay.views[0] && spotReplay.views[0].view);
    if (compare) add('Nesil ' + sp.latest.gen + ' (şimdiki, kesik çizgi) · ' + fmt(sp.latest.dist || 0) + ' m', spotReplay.views[1] && spotReplay.views[1].view, true);
    layoutSafe();
  }
  function closeSpot() { S.spot = null; $('spotlight').hidden = true; document.body.classList.remove('spot-open'); }

  /* ------------------------------------------------------------------ dışa/içe aktarma */
  function exportChampion(champ) {
    const c = champ || (S.trainer.best && { gen: S.trainer.best.gen, dist: S.trainer.best.dist, fitness: S.trainer.best.fitness, genome: S.trainer.best.genome });
    if (!c || !c.genome) { notice('Henüz dışa aktarılacak bir şampiyon yok. İlk nesil bitince tekrar dene.'); return; }
    const obj = { uygulama: 'yuruyen-yaratiklar', surum: 1, species: S.opts.species, terrain: S.opts.terrain, seed: S.opts.seed, evolveBody: !!S.opts.evolveBody, generation: c.gen, fitness: c.fitness, dist: c.dist, genome: c.genome };
    try {
      const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }), url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'sampiyon-' + S.opts.species + '-nesil' + c.gen + '.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000); toast('', 'Genom indirildi', 'sampiyon-' + S.opts.species + '-nesil' + c.gen + '.json', 3200);
    } catch (e) { notice('Dosya indirilemedi: ' + e.message); }
  }
  /** Genom, türün kendi rastgele genomuyla aynı biçimde (dizi uzunlukları, sonlu sayılar) ve gerçekten canlandırılabilir olmalı. */
  function validateGenome(g, species) {
    const fail = (m) => { throw new Error('genom geçersiz: ' + m); };
    if (!g || typeof g !== 'object' || Array.isArray(g)) fail('nesne değil');
    let ref; try { ref = W.randomGenome(species, 1, { evolveBody: !!(g.b && g.b.length) }); } catch (e) { fail('tür tanınmadı'); }
    if (g.species && g.species !== species) fail('tür uyuşmuyor');
    for (const k of Object.keys(ref)) {
      if (Array.isArray(ref[k])) {
        if (!Array.isArray(g[k]) || g[k].length !== ref[k].length) fail('"' + k + '" dizisi beklenen uzunlukta değil');
        for (const v of g[k]) if (typeof v !== 'number' || !isFinite(v)) fail('"' + k + '" içinde sayı olmayan değer');
      } else if (typeof ref[k] === 'number' && (typeof g[k] !== 'number' || !isFinite(g[k]))) fail('"' + k + '" sayı değil');
    }
    const a = new W.Arena({ species, terrain: 'flat', seed: 1, evolveBody: !!(g.b && g.b.length) }), v = a.add(JSON.parse(JSON.stringify(g)));
    for (let i = 0; i < 12; i++) a.step(1 / 30);
    for (const n of v.nodes) if (!isFinite(n.x) || !isFinite(n.y)) fail('canlandırılamadı');
  }
  function importFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const o = JSON.parse(rd.result);
        if (!o || typeof o !== 'object' || !o.genome) throw new Error('genom bulunamadı');
        if (o.species && !speciesIds.includes(o.species)) throw new Error('bilinmeyen tür: ' + o.species);
        validateGenome(o.genome, o.species && speciesIds.includes(o.species) ? o.species : S.opts.species);
        openSpotImported(o); toast('', 'Şampiyon içe aktarıldı', 'Yan pencerede tekrar oynatılıyor.', 3600);
      } catch (e) { notice('Dosya okunamadı: ' + e.message + '. Bu uygulamanın indirdiği bir genom dosyası seç.', 5000); }
    };
    rd.onerror = () => notice('Dosya okunamadı.'); rd.readAsText(file);
  }

  /* ------------------------------------------------------------------ eylemler */
  function setSpeed(n) {
    S.speed = (n === 'max' || n === 'MAKS' || n >= 64) ? 64 : nearestSpeed(+n) || 4; syncControls(); savePrefs();
  }
  function pause() { S.paused = true; syncControls(); }
  function resume() { S.paused = false; S.lastT = 0; syncControls(); }
  function togglePause() { S.paused ? resume() : pause(); }
  function setCam(m) { if (!CAMS.includes(m)) return; if (m === 'free') { world.free.x = world.cam.x; world.free.y = world.cam.y; world.free.s = world.cam.s; } S.cam = m; syncControls(); savePrefs(); }
  function cycleCam() { setCam(CAMS[(CAMS.indexOf(S.cam) + 1) % CAMS.length]); }
  function toggleGhost() { S.ghost = !S.ghost; ghost = null; syncControls(); savePrefs(); if (S.ghost && !S.trainer.best) notice('Hayalet, ilk nesil bitince belirir.', 3000); }
  function setUi(v) {
    S.ui = !!v; document.body.classList.toggle('ui-off', !S.ui); document.body.classList.toggle('ui-on', S.ui); $('inUi').checked = S.ui; layoutSafe();
    const h = $('uiHint'); if (h) { h.hidden = S.ui; h.classList.remove('calm'); if (!S.ui) { clearTimeout(setUi.t); setUi.t = setTimeout(() => h.classList.add('calm'), 4500); } }
  }
  function skipGeneration() { if (S.ffActive) return; S.skipping = true; S.skipFrom = S.trainer.generation; syncControls(); }
  function zoomBy(f) {
    if (S.cam === 'free') world.zoomFree(f, world.cam.fx, world.cam.gy - 60);
    else world.zoom = clamp(world.zoom * f, 0.3, 4);
  }
  async function restart(opts, skipConfirm) {
    if (!skipConfirm) { const ok = await ask('Baştan başlansın mı?', 'Şu anki nesil ' + S.trainer.generation + '. Tüm ilerleme silinir; yaratıklar yürümeyi sıfırdan öğrenir.', 'Baştan başla'); if (!ok) return false; }
    const o = Object.assign({}, S.opts, opts || {});
    try { S.trainer.reset(o); } catch (e) { S.trainer = new W.Trainer(o); }
    Object.assign(S.opts, pickOpts(o)); S.resumed = null;
    adoptTrainer(S.trainer); hideResume(); saveNow(); toast('', 'Yeni deney başladı', 'Tohum ' + S.opts.seed + ' · nesil 1', 3000);
    return true;
  }
  function switchSpecies(id) {
    if (id === S.opts.species) return;
    saveNow();
    const t = makeTrainer(id); adoptTrainer(t);
    if (S.resumed) showResume(); else hideResume();
    toast('', speciesName(id), S.resumed ? 'Kaldığın yerden devam: nesil ' + t.generation : 'Yeni tür, sıfırdan başlıyor.', 3200);
    saveNow();
  }
  function switchTerrain(id) {
    if (id === S.opts.terrain) return;
    S.opts.terrain = id; try { S.trainer.setOptions({ terrain: id }); } catch (e) { note('terrain', e.message); }
    ghost = null; galleryKey = ''; world.snap = true; syncUI();
    toast('', terrainName(id), 'Nüfus korunuyor; nesil yeni zeminde yeniden sınanıyor.', 3600); S.saveDue = true;
  }
  const speciesName = (id) => (W.SPECIES.find((s) => s.id === id) || {}).name || id;
  const terrainName = (id) => ((W.TERRAINS || []).find((s) => s.id === id) || {}).name || id;

  function showResume() {
    const n = $('resumeNote'); $('resumeText').textContent = 'Kaldığın yerden devam ediliyor: nesil ' + S.trainer.generation + ', ' + speciesName(S.opts.species) + '.'; n.hidden = false;
    clearTimeout(showResume.t); showResume.t = setTimeout(hideResume, 12000);
  }
  function hideResume() { $('resumeNote').hidden = true; }

  /* ------------------------------------------------------------------ hızlı ileri sarma (?ff=N) */
  function fastForward(n) {
    S.ffActive = true; const T = S.trainer, start = T.generation; let abort = false;
    $('ffOverlay').hidden = false; $('ffSkip').onclick = () => { abort = true; };
    const upd = (d) => { $('ffText').textContent = d + ' / ' + n + ' nesil'; $('ffFill').style.width = (100 * d / n) + '%'; };
    upd(0);
    const chunk = () => {
      try {
        const t0 = performance.now();
        while (T.generation - start < n && !abort && performance.now() - t0 < 40) T.runGenerations(1);
      } catch (e) { console.error(e); abort = true; }
      upd(Math.min(n, T.generation - start));
      if (T.generation - start < n && !abort) { setTimeout(chunk, 0); return; }
      S.histLen = T.history.length; S.gen = T.generation; S.reached = new Set(); S.recDist = 0;
      const bl = bodyLen(); for (const h of T.history) { S.recDist = Math.max(S.recDist, h.bestDist || 0); for (const m of MILESTONES) if ((h.bestDist || 0) / bl >= m[0]) S.reached.add(m[0]); }
      if (T.best && T.best.dist > S.recDist) S.recDist = T.best.dist;
      $('ffOverlay').hidden = true; S.ffActive = false; S.ffDone = true; world.snap = true; S.lastT = 0; galleryKey = ''; saveNow();
    };
    setTimeout(chunk, 30);
  }

  /* ------------------------------------------------------------------ ana döngü */
  function simulate(dt) {
    const T = S.trainer;
    if (S.paused && !S.skipping) { S.eff += (0 - S.eff) * 0.2; return; }
    const max = S.speed >= 64, unbounded = S.skipping || max, sp = S.speed;
    const t0 = performance.now(), budget = S.skipping ? 30 : Math.min(max ? 11 : 9, clamp(14 - S.drawMs * 1.25, 4, 11)), chunkMax = unbounded || sp >= 8 ? SLICE : 1 / 30;
    if (!unbounded) S.acc = Math.min(S.acc + dt * sp, 0.4 + sp * 0.06);
    let simmed = 0;
    for (;;) {
      let chunk;
      if (unbounded) chunk = chunkMax;
      else { if (S.acc < 1 / 240) break; chunk = Math.min(S.acc, chunkMax); S.acc -= chunk; }
      const before = T.history.length;
      T.step(chunk); simmed += chunk;
      if (ghost) { try { ghost.arena.step(chunk); } catch (e) { ghost = null; } }
      if (T.history.length !== before || T.generation !== S.gen) {
        const from = S.histLen; S.histLen = T.history.length; S.gen = T.generation;
        if (T.history.length < from) { S.histLen = T.history.length; } else onGenerationEnd(from, false);
        if (S.skipping) { S.skipping = false; break; }
      }
      if (performance.now() - t0 > budget) { if (!unbounded) S.acc = Math.min(S.acc, chunkMax); break; }
    }
    const inst = simmed / Math.max(dt, 1e-3);
    S.eff += (inst - S.eff) * (unbounded ? 0.25 : 0.15);
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (S.hidden) return;
    const t = ts / 1000; let dt = S.lastT ? t - S.lastT : 1 / 60; S.lastT = t;
    dt = clamp(dt, 0.0005, 0.1);
    S.frames++; S.fps += (1 / Math.max(dt, 1e-3) - S.fps) * 0.05;
    try {
      if (S.ffActive) return;
      const p0 = performance.now();
      simulate(dt);
      if (S.ghost) ghostSync();
      const T = S.trainer;
      if (S.ui && ts - S.lastHud > 110) { S.lastHud = ts; hudUpdate(); }
      else if (!S.ui && ts - S.lastHud > 250) { S.lastHud = ts; refreshOrder(); }
      const d0 = performance.now();
      chart.draw();
      drawWorld(dt, t);
      if (S.ui) tickReplays(dt);
      S.drawMs += ((performance.now() - d0) - S.drawMs) * 0.1;
      world.renderMs += ((performance.now() - p0) - world.renderMs) * 0.1;
      if (S.saveDue && performance.now() - S.lastSave > 1500) saveNow();
      S.frameErrs = 0;
    } catch (e) {
      const key = String(e && e.message);
      if (!S.errShown[key]) { S.errShown[key] = 1; console.error(e); }
      // kayıttan devam edilen bir deney her karede hata veriyorsa kayıt büyük olasılıkla bozuktur: sil ve yeni deney başlat
      if (++S.frameErrs >= 30 && S.resumed && !S.recovering) { recoverFromBadSave(); return; }
      notice('Çizimde bir sorun oluştu: ' + key + '. Deney arka planda sürüyor.', 5000);
    }
  }

  function recoverFromBadSave() {
    S.recovering = true;
    try {
      store.del(saveKey(S.opts.species)); S.resumed = null;
      const t = makeTrainer(S.opts.species, { fresh: true }); adoptTrainer(t); hideResume();
      notice('Kayıtlı deney bozuk çıktı; silindi ve yeni bir deney başlatıldı.', 7000);
    } catch (e) { console.error(e); }
    S.recovering = false; S.frameErrs = 0;
  }
  function getTerrain() {
    const T = S.trainer, t = T.terrain;
    if (t && typeof t.heightAt === 'function') return t;
    const key = S.opts.terrain + ':' + S.opts.seed;
    if (S.terrKey !== key) { S.terrKey = key; S.terrFb = W.makeTerrain(S.opts.terrain, S.opts.seed); }
    return S.terrFb;
  }
  /** Sıralama: gösterilen ölçüyle (ilerlenen mesafe) aynı; yakın farklarda yer değiştirmemek için küçük bir histerezis. */
  const RANK_MARGIN = 0.05;
  function refreshOrder() {
    const T = S.trainer, cr = T.creatures, n = cr.length;
    if (S.order.length !== n || S.orderGen !== T.generation) { S.order = new Array(n); for (let i = 0; i < n; i++) S.order[i] = i; S.orderGen = T.generation; }
    const o = S.order;
    const key = (i) => { const c = cr[i]; return isFinite(c.x) ? (c.alive === false ? c.x - 1e4 : c.x) : -1e9; };
    for (let k = 1; k < n; k++) { // araya yerleştirmeli sıralama: neredeyse sıralı olduğundan ucuz
      const it = o[k], ik = key(it); let j = k - 1;
      while (j >= 0 && ik > key(o[j]) + RANK_MARGIN) { o[j + 1] = o[j]; j--; }
      o[j + 1] = it;
    }
    S.lead = n ? cr[o[0]] : null;
  }
  const curLead = () => S.lead || S.trainer.leader || S.trainer.creatures[0];
  const lblObj = { a: '', b: '' };
  function drawWorld(dt, now) {
    const T = S.trainer, cr = T.creatures; if (!cr || !cr.length) return;
    const lead = curLead(), bl = lead.bodyLength > 0.05 ? lead.bodyLength : 0.6;
    lblObj.a = '№ ' + lead.id + ' · lider'; lblObj.b = fmt(lead.x) + ' m · ' + fmt(lead.x / bl) + ' boy';
    world.draw({
      terrain: getTerrain(), creatures: cr, order: S.order, leader: lead, ghost: ghost ? ghost.view : null,
      recordDist: S.recDist, now, dt, mode: S.cam, dust: S.eff < 10 && !S.paused, leaderLabel: T.time > 0.6 ? lblObj : null,
      fadeIn: T.time < 0.9, packRank: true,
    });
  }
  function tickReplays(dt) {
    // duraklatılınca tekrarlar donar ama çizilmeye devam eder (yeni açılan plaka / spot ışığı boş kalmasın)
    const dts = Math.min(dt, 0.05), run = !S.paused;
    if (!galleryMin) for (const r of plates) { if (run) r.tick(dts); r.draw(dts); }
    if (S.spot && spotReplay && !$('spotlight').hidden) { if (run) spotReplay.tick(dts); spotReplay.draw(dts); }
  }

  /* ------------------------------------------------------------------ HUD */
  const el = {}; ['genNum', 'speciesLine', 'genFill', 'genTime', 'genRuler', 'stAlive', 'stSpeed', 'stBest', 'stMean', 'stRecord', 'stBody', 'rankList', 'chartHint'].forEach((k) => { el[k] = $(k); });
  const txtCache = {};
  function setText(node, key, s) { if (txtCache[key] !== s) { txtCache[key] = s; node.textContent = s; } }

  function hudUpdate() {
    const T = S.trainer, cr = T.creatures; if (!cr) return;
    refreshOrder();
    const n = cr.length; let alive = 0, sum = 0;
    for (let i = 0; i < n; i++) { if (cr[i].alive !== false) alive++; sum += isFinite(cr[i].x) ? cr[i].x : 0; }
    const lead = curLead(), bl = lead && lead.bodyLength > 0.05 ? lead.bodyLength : 0.6;
    setText(el.genNum, 'gen', String(T.generation));
    const dur = T.duration || S.opts.duration || 15, prog = clamp(T.time / dur, 0, 1);
    const fillW = (prog * 100).toFixed(1) + '%'; if (txtCache.fw !== fillW) { txtCache.fw = fillW; el.genFill.style.width = fillW; el.genRuler.setAttribute('aria-valuenow', String(Math.round(prog * 100))); }
    setText(el.genTime, 'gt', fmt(T.time, 1) + ' / ' + fmt(dur, 0) + ' sn');
    setText(el.stAlive, 'al', alive + ' / ' + n);
    const eff = S.paused && !S.skipping ? 'durdu' : S.skipping ? 'atlanıyor' : '×' + fmt(S.eff, S.eff < 10 ? 1 : 0) + (S.speed >= 64 ? ' MAKS' : '');
    setText(el.stSpeed, 'sp', eff);
    setText(el.stBest, 'bs', fmt(lead ? lead.x : 0) + ' m');
    setText(el.stMean, 'mn', fmt(sum / Math.max(1, n)) + ' m');
    const rec = Math.max(S.recDist, T.best ? T.best.dist : 0);
    const recHtml = rec > 0 ? fmt(rec) + ' m' + (T.best ? '<small>nesil ' + T.best.gen + '</small>' : '') : '–';
    if (txtCache.rec !== recHtml) { txtCache.rec = recHtml; el.stRecord.innerHTML = recHtml; }
    setText(el.stBody, 'by', lead ? fmt(lead.x / bl) : '–');
    const sl = speciesName(S.opts.species) + '  ·  ' + terrainName(S.opts.terrain) + '  ·  tohum ' + S.opts.seed;
    setText(el.speciesLine, 'sl', sl);
    // grafik: canlı nokta
    if (S.notesLen !== T.history.length) { S.notesLen = T.history.length; chart.setNotes(milestoneNotes(T.history)); }
    const fl = T.leader || lead; // "puan" için motorun kendi lideri (uygunluk), "mesafe" için en öndeki
    chart.setData(T.history, lead && prog > 0.3 ? { gen: T.generation, value: chart.mode === 'dist' ? Math.max(0, lead.x) : (fl.fitness || 0) } : null);
    updateRank(cr);
    buildGallery();
    const stag = stagnation();
    setText($('chartHint'), 'hint', stag >= 8 ? 'Rekor ' + stag + ' nesildir aşılamadı; evrim bazen uzun düzlüklerden geçer.' : T.champions && T.champions.length ? 'Bir nesle tıkla, o neslin şampiyonunu izle.' : 'Bir nesle tıklayınca o neslin şampiyonunu izlersin.');
  }

  /** Her eşiğin ilk aşıldığı nesil: grafikte defter notu olarak gösterilir. */
  function milestoneNotes(H) {
    const bl = bodyLen(), out = [];
    for (const m of MILESTONES) { const h = H.find((x) => (x.bestDist || 0) / bl >= m[0]); if (h) out.push({ gen: h.gen, text: m[3] }); }
    return out;
  }

  /** 5 sabit satır: içerik yerinde güncellenir (kayma animasyonu yok), bu yüzden satırlar hiçbir zaman üst üste binmez. */
  let rankSlots = null;
  function resetRank() { if (rankSlots) for (const sl of rankSlots) { sl.id = null; sl.li.hidden = true; } }
  function updateRank(cr) {
    const list = el.rankList;
    if (!rankSlots) {
      rankSlots = [];
      for (let i = 0; i < 5; i++) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="rk"></span><span class="dot"></span><span class="who"><span class="bar"></span><span class="id"></span></span><span class="dist num"></span>';
        li.children[0].textContent = String(i + 1); li.hidden = true; list.appendChild(li);
        rankSlots.push({ li, id: null, ds: '', hue: -1, dead: false, rk: li.children[0], dot: li.children[1], bar: li.children[2].children[0], name: li.children[2].children[1], dist: li.children[3] });
      }
    }
    const T = S.trainer, calm = T.time < 1.2, maxD = Math.max(0.5, S.lead ? S.lead.x : 0.5), nowMs = performance.now();
    let cap = Infinity; // gösterilen mesafeler her zaman azalan sırada: histerezis payı (<0,05 m) ekranda ters görünmesin
    for (let i = 0; i < 5; i++) {
      const sl = rankSlots[i], v = i < S.order.length ? cr[S.order[i]] : null;
      if (!v) { if (!sl.li.hidden) sl.li.hidden = true; sl.id = null; continue; }
      if (sl.li.hidden) sl.li.hidden = false;
      const dead = v.alive === false; if (dead !== sl.dead) { sl.dead = dead; sl.li.classList.toggle('dead', dead); }
      if (sl.id !== v.id) {
        if (i === 0 && sl.id !== null && !calm && nowMs - (S.lastLeadFlash || 0) > 1500) { S.lastLeadFlash = nowMs; sl.li.classList.remove('chg'); void sl.li.offsetWidth; sl.li.classList.add('chg'); } // yeni lider: kısa vurgu
        sl.id = v.id; sl.name.textContent = '№ ' + v.id;
      }
      const hue = (((v.hue % 360) + 360) % 360) | 0; if (hue !== sl.hue) { sl.hue = hue; sl.dot.style.background = YY.dotColor(hue); }
      const xv = Math.min(isFinite(v.x) ? v.x : 0, cap); cap = xv;
      const ds = fmt(xv) + ' m'; if (ds !== sl.ds) { sl.ds = ds; sl.dist.textContent = ds; }
      sl.bar.style.width = clamp((xv / maxD) * 100, 2, 100) + '%';
    }
  }

  /* ------------------------------------------------------------------ kontrol çubuğu ve çekmece senkronu */
  function syncControls() {
    $('icoPause').style.display = S.paused ? 'none' : ''; $('icoPlay').style.display = S.paused ? '' : 'none';
    $('btnPlay').setAttribute('aria-label', S.paused ? 'Oynat' : 'Duraklat');
    document.querySelectorAll('#speeds button').forEach((b) => { const on = +b.dataset.s === S.speed; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('camLabel').textContent = CAM_NAMES[S.cam];
    document.querySelectorAll('#camSeg button').forEach((b) => b.classList.toggle('on', b.dataset.cam === S.cam));
    $('btnGhost').setAttribute('aria-pressed', String(S.ghost)); $('inGhost').checked = S.ghost;
    $('btnSettings').setAttribute('aria-expanded', String(S.drawerOpen));
  }
  function syncUI() {
    const o = S.opts;
    $('inPop').value = o.popSize; $('outPop').textContent = String(o.popSize);
    $('inDur').value = o.duration; $('outDur').textContent = fmt(o.duration, 0) + ' sn';
    $('inMut').value = o.mutation; $('outMut').textContent = fmt(o.mutation, 2) + '×';
    $('inBody').checked = !!o.evolveBody; $('inSeed').value = o.seed;
    document.querySelectorAll('#speciesCards .opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === o.species)));
    document.querySelectorAll('#terrainCards .opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === o.terrain)));
    syncControls();
  }

  let previewsBuilt = false;
  function buildDrawer() {
    const sc = $('speciesCards'), tc = $('terrainCards');
    W.SPECIES.forEach((sp, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.dataset.id = sp.id; b.setAttribute('role', 'radio');
      b.innerHTML = '<canvas></canvas><b></b><small></small>'; b.children[1].textContent = sp.name; b.children[2].textContent = sp.desc || (sp.legs + ' bacak');
      b.addEventListener('click', () => switchSpecies(sp.id)); sc.appendChild(b);
    });
    (W.TERRAINS || []).forEach((tr) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.dataset.id = tr.id; b.setAttribute('role', 'radio');
      b.innerHTML = '<canvas></canvas><b></b>'; b.children[1].textContent = tr.name;
      b.addEventListener('click', () => switchTerrain(tr.id)); tc.appendChild(b);
    });
  }
  function buildPreviews() {
    if (previewsBuilt) return; previewsBuilt = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    document.querySelectorAll('#speciesCards .opt').forEach((b, i) => {
      const cv = b.firstElementChild, w = cv.clientWidth || 120, h = cv.clientHeight || 40; cv.width = w * dpr; cv.height = h * dpr;
      try {
        const id = b.dataset.id, a = new W.Arena({ species: id, terrain: 'flat', seed: 1, evolveBody: false }), v = a.add(W.randomGenome(id, 1, {}));
        a.step(1 / 30); YY.drawSpecimen(cv.getContext('2d'), dpr, w, h, v, (28 + i * 58) % 360);
      } catch (e) { note('prev', 'Önizleme çizilemedi: ' + e.message); }
    });
    document.querySelectorAll('#terrainCards .opt').forEach((b) => {
      const cv = b.firstElementChild, w = cv.clientWidth || 120, h = cv.clientHeight || 40; cv.width = w * dpr; cv.height = h * dpr;
      try { YY.drawTerrainIcon(cv.getContext('2d'), dpr, w, h, W.makeTerrain(b.dataset.id, S.opts.seed)); } catch (e) { note('prev2', e.message); }
    });
  }
  function setDrawer(open) {
    S.drawerOpen = open; $('drawer').hidden = !open; document.body.classList.toggle('drawer-open', open);
    if (open) { buildPreviews(); } syncControls(); layoutSafe();
  }

  /* ------------------------------------------------------------------ olaylar */
  function wire() {
    $('btnPlay').addEventListener('click', togglePause);
    document.querySelectorAll('#speeds button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.s)));
    $('btnSkip').addEventListener('click', skipGeneration);
    $('btnRestart').addEventListener('click', () => restart());
    $('btnCam').addEventListener('click', cycleCam);
    $('btnGhost').addEventListener('click', toggleGhost);
    $('btnSettings').addEventListener('click', () => setDrawer(!S.drawerOpen));
    $('drawerClose').addEventListener('click', () => setDrawer(false));
    document.querySelectorAll('#camSeg button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
    $('inGhost').addEventListener('change', (e) => { if (e.target.checked !== S.ghost) toggleGhost(); });
    $('inUi').addEventListener('change', (e) => setUi(e.target.checked));
    $('uiHint').addEventListener('click', () => setUi(true));
    $('inPop').addEventListener('input', (e) => { const v = +e.target.value; S.opts.popSize = v; $('outPop').textContent = String(v); S.trainer.setOptions({ popSize: v }); S.saveDue = true; });
    $('inDur').addEventListener('input', (e) => { const v = +e.target.value; S.opts.duration = v; $('outDur').textContent = fmt(v, 0) + ' sn'; S.trainer.setOptions({ duration: v }); S.saveDue = true; });
    $('inMut').addEventListener('input', (e) => { const v = +e.target.value; S.opts.mutation = v; $('outMut').textContent = fmt(v, 2) + '×'; S.trainer.setOptions({ mutation: v }); S.saveDue = true; });
    $('inBody').addEventListener('change', (e) => { S.opts.evolveBody = e.target.checked; S.trainer.setOptions({ evolveBody: e.target.checked }); galleryKey = ''; ghost = null; S.saveDue = true; toast('', e.target.checked ? 'Vücut da evrimleşecek' : 'Vücut sabit', 'Değişiklik bir sonraki nesilde başlar.', 3200); });
    $('seedApply').addEventListener('click', () => { const v = Math.max(1, Math.floor(+$('inSeed').value) || 1); restart({ seed: v }, S.trainer.generation < 3); });
    $('seedRandom').addEventListener('click', () => { const v = 1 + Math.floor(Math.random() * 99999); $('inSeed').value = v; restart({ seed: v }, S.trainer.generation < 3); });
    $('inSeed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('seedApply').click(); });
    $('chartMode').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { $('chartMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); chart.setMode(b.dataset.m); }));
    $('introClose').addEventListener('click', () => hideIntro(false));
    $('resumeClose').addEventListener('click', hideResume);
    $('resumeReset').addEventListener('click', () => restart());
    $('galleryToggle').addEventListener('click', () => { galleryMin = !galleryMin; $('gallery').classList.toggle('min', galleryMin); $('galleryToggle').textContent = galleryMin ? '+' : '–'; layoutSafe(); });
    $('spotClose').addEventListener('click', closeSpot);
    $('spotCompare').addEventListener('change', showSpot);
    $('spotExport').addEventListener('click', () => exportChampion(S.spot && S.spot.champ));
    $('btnExport').addEventListener('click', () => exportChampion());
    $('btnImport').addEventListener('click', () => $('fileImport').click());
    $('fileImport').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
    $('btnWipe').addEventListener('click', async () => {
      const ok = await ask('Kayıtlar silinsin mi?', 'Bu tarayıcıdaki tüm kayıtlı deneyler silinir ve geçerli deney baştan başlar.', 'Kaydı sıfırla'); if (!ok) return;
      store.keys().filter((k) => k.startsWith(SAVE_PREFIX)).forEach((k) => store.del(k)); restart(null, true);
    });
    // fare tıklamasından sonra düğme odağını bırak: Boşluk tuşu yanlışlıkla düğmeyi tetiklemesin
    document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0 && !b.classList.contains('opt')) b.blur(); });

    // dünya tuvali: sürükle = serbest kamera, tekerlek = yakınlaştır
    const cv = $('world'); let drag = null;
    cv.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!drag.moved) { drag.moved = true; if (S.cam !== 'free') setCam('free'); cv.classList.add('dragging'); }
      world.pan(dx, dy); drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = () => { drag = null; cv.classList.remove('dragging'); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0016);
      if (S.cam === 'free') world.zoomFree(f, e.clientX, e.clientY); else world.zoom = clamp(world.zoom * f, 0.3, 4);
    }, { passive: false });

    window.addEventListener('resize', () => { resize(); });
    document.addEventListener('visibilitychange', () => {
      S.hidden = document.hidden;
      if (document.hidden) saveNow(); else { S.lastT = 0; S.acc = 0; }
    });
    window.addEventListener('pagehide', saveNow);

    window.addEventListener('keydown', (e) => {
      if (S.modalOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target; if (tg && (tg.tagName === 'INPUT' && tg.type !== 'range' && tg.type !== 'checkbox' || tg.tagName === 'TEXTAREA')) { if (e.key === 'Escape') tg.blur(); return; }
      if (tg && tg.tagName === 'INPUT' && tg.type === 'checkbox' && e.key === ' ') return; // Boşluk onay kutusunu değiştirsin
      const k = e.key; let used = true;
      if (k === ' ' || k === 'Spacebar') togglePause();
      else if (k >= '1' && k <= '7') setSpeed(SPEEDS[+k - 1]);
      else if (k === 'f' || k === 'F') cycleCam();
      else if (k === 'n' || k === 'N') skipGeneration();
      else if (k === 'r' || k === 'R') restart();
      else if (k === 'h' || k === 'H') setUi(!S.ui);
      else if (k === 'g' || k === 'G') toggleGhost();
      else if (k === 's' || k === 'S') setDrawer(!S.drawerOpen);
      else if (k === '+' || k === '=') zoomBy(1.2);
      else if (k === '-' || k === '_') zoomBy(1 / 1.2);
      else if (k === 'Escape') { if (S.drawerOpen) setDrawer(false); else if (S.spot) closeSpot(); else used = false; }
      else used = false;
      if (used) e.preventDefault();
    });
  }

  /* ------------------------------------------------------------------ giriş notu */
  function showIntro() {
    $('intro').hidden = false; $('intro').classList.remove('fading');
    clearTimeout(S.introTimer); S.introTimer = setTimeout(() => hideIntro(true), 32000); // okunmuşsa kendiliğinden çekilir
  }
  function hideIntro(auto) {
    clearTimeout(S.introTimer); const n = $('intro'); if (n.hidden) return;
    const done = () => { n.hidden = true; n.classList.remove('fading'); };
    if (auto) { n.classList.add('fading'); setTimeout(done, 700); } else done();
    S.introDone = S.introSeen = true; savePrefs();
  }

  /* ------------------------------------------------------------------ açılış */
  function boot() {
    buildDrawer(); wire();
    let badSave = false;
    try {
      S.trainer = makeTrainer(S.opts.species);
      // makeTrainer resume ettiyse S.opts güncellendi; adoptTrainer bunları arayüze yansıtır
      adoptTrainer(S.trainer);
    } catch (e) { // yapısal olarak bozuk kayıt: sil, temiz başla
      console.warn('kayıt uygulanamadı, yeni deney başlatılıyor', e); badSave = true;
      store.del(saveKey(S.opts.species)); S.resumed = null;
      S.trainer = makeTrainer(S.opts.species, { fresh: true }); adoptTrainer(S.trainer);
    }
    setUi(S.ui); resize();
    if (badSave || S.badSave) notice('Kayıtlı deney bozuk çıktı; silindi ve yeni bir deney başlatıldı.', 7000);
    if (S.resumed) showResume();
    if (!S.introDone && S.ui && !S.resumed) showIntro(); else if (S.resumed && !S.introSeen) { S.introDone = S.introSeen = true; savePrefs(); }
    syncUI();
    const ff = qn('ff'); if (ff && ff > 0) fastForward(Math.floor(ff));
    document.body.classList.add('ready');
    requestAnimationFrame(frame);
  }

  window.__app = {
    get trainer() { return S.trainer; }, state: S, world, chart,
    get ghost() { return ghost; }, get plates() { return plates; }, get spotReplay() { return spotReplay; },
    setSpeed, pause, resume, togglePause, skip: skipGeneration, restart: (o) => restart(o, true), setCam, setUi, toggleGhost, cycleCam,
    setDrawer, openSpotGen, exportChampion, saveNow, zoomBy, fastForward,
    get fps() { return S.fps; }, get frames() { return S.frames; }, get effSpeed() { return S.eff; },
  };
  boot();
})();
