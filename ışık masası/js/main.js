/* Ana döngü: geometri -> ışın izleme -> birikim -> birleştirme */
(function () {
  'use strict';
  const LT = window.LT;
  const S = LT.state;
  const glc = document.getElementById('gl');
  const NMAX = 64;
  const DEBUG = /debug/.test(location.search + location.hash);
  const BURST = parseInt((/burst=(\d+)/.exec(location.search + location.hash) || [0, 1])[1], 10); // test: kare başına çoklu geçiş
  let R = null;
  let n = 0;
  let frame = 0;
  let lastT = performance.now();
  let needComp = true;
  let scale = 1;

  LT.stats = { segs: 0, traceMs: 0, n: 0 };
  LT.redraw = () => {
    needComp = true;
  };

  function fail(msg) {
    const f = document.getElementById('fallback');
    f.hidden = false;
    f.querySelector('p').textContent = msg;
  }

  function resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (S.W !== W || S.H !== H) {
      const kx = W / S.W;
      const ky = H / S.H;
      for (const it of S.items) {
        it.x *= kx;
        it.y *= ky;
      }
    }
    S.W = W;
    S.H = H;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(scale, Math.sqrt(5.6e6 / (W * H)));
    R.resize(W, H, scale);
    LT.glassResize(W, H, scale);
    if (LT.overlayResize) LT.overlayResize(W, H);
    n = 0;
    LT.rebuildGeo(S.time);
    S.glassDirty = true;
    LT.touch(2);
  }

  LT.snapshot = function (cb) {
    R.composite(compParams());
    glc.toBlob(cb, 'image/png');
  };

  function compParams() {
    return {
      time: S.time,
      exposure: S.set.exposure,
      glow: S.set.glow,
      bubbles: S.items.filter((it) => it.kind === 'bubble'),
    };
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    S.time += dt;

    let hasBubble = false;
    const gone = [];
    for (const it of S.items) {
      if (it.kind !== 'bubble') continue;
      hasBubble = true;
      if (it.popT > 0) {
        it.popT += dt / 0.4;
        if (it.popT >= 1) gone.push(it.id);
      }
    }
    for (const id of gone) {
      LT.removeItem(id);
      if (LT.onItemsChanged) LT.onItemsChanged();
    }
    if (hasBubble) LT.touch(1);

    if (S.dirty >= 2 || S.glassDirty) LT.rebuildGeo(S.time);
    else if (hasBubble) for (const it of S.items) if (it.kind === 'bubble') LT.buildGeo(it, S.time);

    if (S.dirty) {
      n = S.dirty >= 3 ? 0 : Math.min(n, S.dirty >= 2 ? 3 : 28);
      S.dirty = 0;
    }

    let traced = false;
    for (let pass = 0; pass < BURST && n < NMAX; pass++) {
      const reset = n === 0;
      n += 1;
      const alpha = Math.max(1 / n, 1 / NMAX);
      const t0 = performance.now();
      LT.trace(S.items, { W: S.W, H: S.H, disp: S.set.disp, time: S.time, frame: frame++, mode: S.set.mode, refl: S.set.refl });
      R.accumulate(LT.instCount, alpha, reset);
      traced = true;
      LT.stats.segs = LT.instCount;
      LT.stats.traceMs = performance.now() - t0;
      LT.stats.n = n;
    }
    if (traced) R.bloom();

    if (S.glassDirty) {
      LT.drawGlass();
      R.uploadGlass(LT.glassCanvas);
      S.glassDirty = false;
      needComp = true;
    }
    if (traced || hasBubble || needComp) {
      R.composite(compParams());
      needComp = false;
    }
    if (LT.drawOverlay) LT.drawOverlay(dt);
    if (DEBUG) document.body.dataset.stat = 'n=' + LT.stats.n + ' segs=' + LT.stats.segs + ' ms=' + LT.stats.traceMs.toFixed(1) + ' frames=' + frame;
    requestAnimationFrame(tick);
  }

  function start() {
    try {
      R = new LT.Renderer(glc);
    } catch (e) {
      fail('Bu tarayıcıda WebGL2 çalışmıyor: ' + e.message);
      console.error(e);
      return;
    }
    window.addEventListener('resize', resize);
    resize();
    const name = (location.hash || '').replace('#', '').split('&')[0];
    const pname = LT.presets[name] ? name : 'karma';
    LT.loadPreset(pname);
    document.querySelectorAll('#scenes button').forEach((b) => b.classList.toggle('on', b.dataset.scene === pname));
    if (LT.uiInit) LT.uiInit();
    requestAnimationFrame(tick);
    window.__ltReady = true;
  }

  window.addEventListener('error', (e) => {
    document.title = 'HATA: ' + e.message;
  });
  start();
})();
