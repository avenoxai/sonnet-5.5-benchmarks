/* ============================================================================
 * main.js — bootstrap, player clock, render loop      (owner: lead)
 * ========================================================================== */
(function () {
  'use strict';
  const EDL = window.EDL, THREE = window.THREE, C = EDL.C, U = EDL.util, q = EDL.query;

  const canvas = document.getElementById('gl');
  const loadingEl = document.getElementById('loading');
  const loadingBar = document.getElementById('loading-bar');
  const loadingMsg = document.getElementById('loading-msg');
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setLoading(p, msg) {
    if (loadingBar) loadingBar.style.width = Math.round(p * 100) + '%';
    if (loadingMsg && msg) loadingMsg.textContent = msg;
  }
  function showFatal(err) {
    console.error('[EDL] FATAL', err);
    if (loadingMsg) loadingMsg.textContent = 'Hata: ' + (err && err.message ? err.message : err);
    if (loadingEl) loadingEl.classList.add('error');
  }

  /* -------------------------------------------------------------------------
   * Player — the simulation clock. Simulation time == video seconds.
   * ----------------------------------------------------------------------- */
  const listeners = {};
  const player = (EDL.player = {
    t: 0,
    duration: C.t.duration,
    playing: false,
    speed: 1,
    mode: 'video',
    panels: [],
    quality: { level: 'high', particles: 1, shadows: true, resolutionScale: 1 },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return fn; },
    off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    emit(ev, p) { (listeners[ev] || []).forEach((f) => { try { f(p); } catch (e) { console.error(e); } }); },
    play() { if (player.t >= player.duration - 1e-3) player.seek(0); player.playing = true; player.emit('play'); },
    pause() { player.playing = false; player.emit('pause'); },
    toggle() { player.playing ? player.pause() : player.play(); },
    seek(t) { player.t = U.clamp(t, 0, player.duration); player.emit('seek', player.t); },
    setSpeed(s) { player.speed = U.clamp(s, 0.05, 16); player.emit('speed', player.speed); },
    setMode(id) { player.mode = id; if (EDL.ctx && EDL.ctx.modules.cameras && EDL.ctx.modules.cameras.setMode) EDL.ctx.modules.cameras.setMode(id); player.emit('mode', id); },
    step(frames) { player.pause(); player.seek(player.t + frames / 30); },
  });

  /* -------------------------------------------------------------------------
   * Boot
   * ----------------------------------------------------------------------- */
  async function boot() {
    if (!window.WebGL2RenderingContext) throw new Error('Bu tarayıcı WebGL2 desteklemiyor.');
    const dprCap = parseFloat(q.get('dpr') || '2');
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false, depth: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: q.get('keep') === '1',
    });
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // EDL.Post tone-maps
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = false;

    const scene = new THREE.Scene();
    const qualityParam = q.get('q');
    if (qualityParam) player.quality.level = qualityParam === 'low' ? 'low' : qualityParam === 'med' ? 'medium' : 'high';
    const ctx = (EDL.ctx = {
      THREE, renderer, scene, C, util: U, uniforms: EDL.uniforms, glsl: EDL.glsl, modules: {}, bus: EDL.bus,
      quality: player.quality, player,
    });

    let cssW = window.innerWidth, cssH = window.innerHeight;
    let renderScale = 1;
    function applySize() {
      cssW = window.innerWidth; cssH = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * renderScale;
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssW, cssH, false);
      canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
      player.quality.resolutionScale = renderScale;
      Object.values(ctx.modules).forEach((m) => { try { m && m.onResize && m.onResize(cssW, cssH); } catch (e) { console.error(e); } });
    }
    applySize();
    window.addEventListener('resize', applySize);

    // ---- modules -----------------------------------------------------------------
    setLoading(0.02, 'Modüller hazırlanıyor…');
    await nextFrame();
    const names = EDL.MODULE_ORDER;
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      setLoading(0.05 + 0.6 * (i / names.length), 'Yükleniyor: ' + n);
      await nextFrame();
      try { EDL.createModules(ctx, [n]); } catch (e) { console.error('[EDL] module ' + n + ' failed:', e); }
    }
    setLoading(0.68, 'Dokular hazırlanıyor…');
    try { await Promise.race([EDL.whenReady(ctx.modules), sleep(20000)]); } catch (e) { console.error(e); }

    for (const [n, m] of Object.entries(ctx.modules)) {
      if (m && m.group && !m.group.parent) scene.add(m.group);
    }
    if (ctx.modules.flight && ctx.modules.flight.build) {
      setLoading(0.74, 'Yörünge hesaplanıyor…');
      await nextFrame();
      try { ctx.modules.flight.build(); } catch (e) { console.error('[EDL] flight.build failed:', e); }
    }
    for (const n of EDL.UI_MODULES) {
      setLoading(0.8, 'Arayüz: ' + n);
      await nextFrame();
      try { EDL.createModules(ctx, [n]); } catch (e) { console.error('[EDL] UI module ' + n + ' failed:', e); }
    }
    const post = (EDL.post = EDL.Post ? new EDL.Post(renderer, ctx) : null);
    setLoading(0.9, 'Sahne derleniyor…');
    await nextFrame();

    const cameras = ctx.modules.cameras;
    const updaters = Object.entries(ctx.modules).filter(([n, m]) => m && typeof m.update === 'function' && !EDL.UI_MODULES.includes(n));
    const hud = ctx.modules.hud, audio = ctx.modules.audio;

    // ---- one render of every panel at time player.t ---------------------------
    const errOnce = {};
    function safe(name, fn) {
      try { fn(); } catch (e) { if (!errOnce[name]) { errOnce[name] = 1; console.error('[EDL] error in ' + name + ':', e); } }
    }
    function updateAll(t, camera, view) {
      for (let i = 0; i < updaters.length; i++) {
        const [n, m] = updaters[i];
        safe(n + '.update', () => m.update(t, camera, view));
      }
    }
    const fallbackCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 50000);
    fallbackCam.position.set(0, 30, 60); fallbackCam.lookAt(0, 5, 0);

    function renderFrame(dt) {
      let panels = null;
      if (cameras && cameras.layout) safe('cameras.layout', () => { panels = cameras.layout(player.t, player.mode, cssW, cssH); });
      if (!panels || !panels.length) panels = [{ id: 'main', x: 0, y: 0, w: cssW, h: cssH, camera: fallbackCam, t: player.t, look: {} }];
      player.panels = panels;
      const dpr = renderer.getPixelRatio();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, cssW * dpr, cssH * dpr);
      renderer.clear(true, true, true);
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i];
        const rect = { x: Math.round(p.x * dpr), y: Math.round((cssH - p.y - p.h) * dpr), w: Math.max(2, Math.round(p.w * dpr)), h: Math.max(2, Math.round(p.h * dpr)) };
        const view = { t: p.t, dt, camera: p.camera, width: rect.w, height: rect.h, pixelRatio: dpr, panelId: p.id, isPrimary: i === 0, quality: player.quality, focus: p.focus || null, look: p.look || {} };
        updateAll(p.t, p.camera, view);
        if (post) safe('post.render', () => post.render(scene, p.camera, rect, p.look || {}, view));
        else {
          renderer.setViewport(rect.x, rect.y, rect.w, rect.h); renderer.setScissor(rect.x, rect.y, rect.w, rect.h); renderer.setScissorTest(true);
          renderer.render(scene, p.camera);
        }
      }
      renderer.setScissorTest(false);
      if (hud && hud.onFrame) safe('hud.onFrame', () => hud.onFrame(player.t, panels, player));
      if (audio && audio.onFrame) safe('audio.onFrame', () => audio.onFrame(player.t, player));
    }

    // ---- input: keyboard shortcuts (HUD adds buttons) --------------------------
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); player.toggle(); break;
        case 'ArrowRight': player.seek(player.t + (e.shiftKey ? 10 : 2)); break;
        case 'ArrowLeft': player.seek(player.t - (e.shiftKey ? 10 : 2)); break;
        case 'Period': player.step(1); break;
        case 'Comma': player.step(-1); break;
        case 'Home': player.seek(0); break;
        case 'KeyF': if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); break;
        case 'BracketRight': player.setSpeed(player.speed * 1.5); break;
        case 'BracketLeft': player.setSpeed(player.speed / 1.5); break;
        case 'Digit1': player.setMode('video'); break;
        case 'Digit2': player.setMode('cinematic'); break;
        case 'Digit3': player.setMode('free'); break;
        default: break;
      }
    });

    // ---- initial state from URL ----------------------------------------------
    if (q.get('mode')) player.mode = q.get('mode');
    if (cameras && cameras.setMode) safe('cameras.setMode', () => cameras.setMode(player.mode));
    if (q.get('speed')) player.speed = parseFloat(q.get('speed'));
    const startT = q.get('t') !== null ? parseFloat(q.get('t')) : 0;
    player.t = U.clamp(startT, 0, player.duration);
    const autoplay = q.get('play') === '1' || (q.get('t') === null && q.get('paused') !== '1' && q.get('autostart') === '1');

    // ---- first frames (compile shaders behind the loading screen) -----------------
    setLoading(0.95, 'İlk kareler çiziliyor…');
    renderFrame(0); await nextFrame(); renderFrame(0); await nextFrame();
    setLoading(1, 'Hazır');
    await sleep(120);
    if (loadingEl) loadingEl.classList.add('done');
    if (hud && hud.showStart && q.get('t') === null && q.get('ui') !== '0' && q.get('nostart') !== '1') hud.showStart(() => { player.play(); if (audio && audio.enable) audio.enable(); });
    else if (autoplay) player.play();
    if (q.get('ui') === '0') document.body.classList.add('no-ui');

    // ---- main loop with adaptive resolution -------------------------------------
    let last = performance.now(), acc = 0, frames = 0, slow = 0, fast = 0;
    const adaptive = q.get('adapt') !== '0';
    function loop(now) {
      requestAnimationFrame(loop);
      let dt = Math.min((now - last) / 1000, 0.1); last = now;
      if (player.playing) {
        player.t += dt * player.speed;
        if (player.t >= player.duration) { player.t = player.duration; player.pause(); player.emit('end'); }
        player.emit('tick', player.t);
      }
      renderer.info.reset();
      renderFrame(dt);
      if (adaptive) { // simple FPS governor on wall-clock frame interval
        acc += dt; frames++;
        if (acc >= 1.0) {
          const fps = frames / acc; acc = 0; frames = 0;
          if (fps < 28) { slow++; fast = 0; } else if (fps > 52) { fast++; slow = 0; } else { slow = 0; fast = 0; }
          if (slow >= 2 && renderScale > 0.55) { renderScale = Math.max(0.55, renderScale - 0.15); applySize(); slow = 0; }
          else if (fast >= 6 && renderScale < 1) { renderScale = Math.min(1, renderScale + 0.1); applySize(); fast = 0; }
          if (q.get('debug') === '1') console.log('[EDL] fps=' + fps.toFixed(1) + ' scale=' + renderScale.toFixed(2) + ' draw=' + renderer.info.render.calls + ' tris=' + renderer.info.render.triangles);
        }
      }
    }
    requestAnimationFrame((n) => { last = n; loop(n); });
    document.title = 'Perseverance — Mars\'a İniş 3D Simülasyonu';
    window.EDL_READY = true;
    console.log('[EDL] ready');
  }

  boot().catch(showFatal);
})();
