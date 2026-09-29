/* hud.js — compact Turkish HUD (module 'hud'): start screen, controls, telemetry, event toasts, panel labels, title card, end card */
(function () {
  'use strict';
  const EDL = window.EDL, C = EDL.C, U = EDL.util;
  EDL.registerModule('hud', function (ctx) {
    const root = document.getElementById('hud-root') || document.body;
    const player = ctx.player, T = C.t;
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; (parent || root).appendChild(e); return e; };
    const mmss = (s) => { s = Math.max(0, s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };

    // ---- controls ----
    const bar = el('div', 'hud-bar');
    const row1 = el('div', 'hud-row', null, bar), row2 = el('div', 'hud-row', null, bar);
    const bPlay = el('button', 'hud-btn', '▶ Oynat', row1); bPlay.onclick = () => player.toggle();
    const scrub = el('input', 'hud-scrub', null, row1); scrub.type = 'range'; scrub.min = 0; scrub.max = player.duration; scrub.step = 0.05; scrub.value = 0;
    scrub.oninput = () => player.seek(parseFloat(scrub.value));
    const tt = el('span', 'hud-time', '', row1);
    const modeBtns = {};
    const mm = [['video', 'Video düzeni [1]'], ['cinematic', 'Sinematik [2]'], ['free', 'Serbest [3]'], ['rdc', 'RDC'], ['ruc', 'RUC'], ['ddc', 'DDC'], ['puc', 'PUC']];
    mm.forEach(([id, name]) => { const b = el('button', 'hud-btn', name, row2); b.onclick = () => { player.setMode(id); }; modeBtns[id] = b; });
    const sp = el('select', 'hud-btn', null, row2); [0.25, 0.5, 1, 2, 4].forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v + '×'; if (v === 1) o.selected = true; sp.appendChild(o); });
    sp.onchange = () => player.setSpeed(parseFloat(sp.value));
    const bTel = el('button', 'hud-btn on', 'Telemetri [T]', row2), bFs = el('button', 'hud-btn', 'Tam ekran [F]', row2);
    const bSnd = el('button', 'hud-btn', 'Ses: kapalı [M]', row2);
    bFs.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); };
    let telOn = true; bTel.onclick = () => { telOn = !telOn; tele.style.display = telOn ? '' : 'none'; bTel.classList.toggle('on', telOn); };
    bSnd.onclick = () => { const a = ctx.modules.audio; if (a && a.enable) { a.enable(); a.setMuted && a.setMuted(!a.muted); } };
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyT') bTel.click(); if (e.code === 'KeyM') bSnd.click(); });

    // ---- telemetry / toast / labels / title ----
    const tele = el('div', 'hud-tele', '');
    const toast = el('div', 'hud-toast', '');
    const title = el('div', 'hud-title', '<div>PERSEVERANCE ROVER’IN</div><div>MARS’A İNİŞİ VE YERE TEMASI</div><div style="font-weight:600;opacity:.9">KAMERA GÖRÜNTÜLERİ · 3D SİMÜLASYON</div>');
    title.style.opacity = 0;
    const labels = [];
    const end = el('div', 'hud-end', '<div><h2>Temas onaylandı</h2><p>Perseverance, Jezero Krateri’nde Mars yüzeyinde.</p><p>18 Şubat 2021 · Octavia E. Butler iniş yeri · ≈7 dakikalık iniş</p><p style="margin-top:18px"><button class="hud-btn" id="hud-replay">Yeniden oynat</button></p></div>');
    end.querySelector('#hud-replay').onclick = () => { end.classList.remove('on'); player.seek(0); player.play(); };

    // ---- event icons (video mode) ----
    const icons = el('div', 'hud-icons');
    const ICON = [
      [12.733, 6.0, '🛰<br>Giriş'], [12.733, 20.1, '🪂<br>Paraşüt'], [74.633, 35.7, '📡<br>Radar kilidi'], [125.367, 52.7, '⛑<br>Arka kabuk ayrıldı'],
      [138.6, 70.1, '🔥<br>Motorlu iniş'], [170.167, 81.9, '🏗<br>Sky crane'], [188.067, 93.7, '✂<br>Halat kesildi'],
    ].map(([t, x, txt]) => { const d = el('div', 'hud-icon', txt, icons); d.dataset.t = t; d.dataset.x = x; return d; });

    // ---- start screen ----
    const start = el('div', 'hud-start');
    start.innerHTML = '<div class="in"><h1>PERSEVERANCE</h1><p>Mars’a iniş ve yere temas — 3D simülasyon</p><p style="font-size:13px">NASA/JPL’nin “Descent and Touchdown on Mars — Onboard Camera Views” videosundan ölçülerle yeniden üretildi</p><button id="hud-go">BAŞLAT</button><div class="hint">Boşluk: oynat/duraklat · ← →: ±2 sn · 1/2/3: görünüm · 4–7: tek kamera · fare: serbest kamera<br>T: telemetri · F: tam ekran · [ ]: hız</div></div>';
    let onStart = null;
    start.querySelector('#hud-go').onclick = () => { start.classList.add('gone'); if (onStart) onStart(); };
    window.addEventListener('keydown', (e) => { if ((e.code === 'Enter') && !start.classList.contains('gone')) start.querySelector('#hud-go').click(); });

    // ---- per-frame ----
    let lastMove = 0, lastEv = -1, toastT = 0;
    window.addEventListener('pointermove', () => { lastMove = performance.now(); });
    const flight = () => ctx.modules.flight;
    const evs = () => (flight() && flight().events) || [];
    player.on('play', () => { bPlay.textContent = '❚❚ Duraklat'; });
    player.on('pause', () => { bPlay.textContent = '▶ Oynat'; });
    player.on('end', () => { end.classList.add('on'); });
    player.on('seek', () => { end.classList.remove('on'); lastEv = player.t; });
    let lastLayout = '';
    return {
      showStart(cb) { onStart = cb; },
      onFrame(t, panels) {
        scrub.value = t; const S = flight().state(t);
        tt.textContent = mmss(t) + ' / ' + mmss(player.duration) + '   ' + S.telemetry.tPlusStr;
        Object.keys(modeBtns).forEach((k) => modeBtns[k].classList.toggle('on', k === player.mode));
        bar.classList.toggle('hide', player.playing && performance.now() - lastMove > 3200);
        const tl = S.telemetry, alt = tl.altitude;
        tele.innerHTML = '<div class="ph">' + tl.phaseName + '</div>İrtifa &nbsp; <b>' + (alt >= 1000 ? (alt / 1000).toFixed(2) + ' km' : alt.toFixed(alt < 100 ? 1 : 0) + ' m') + '</b><br>Hız &nbsp;&nbsp;&nbsp;&nbsp; <b>' + tl.speed.toFixed(tl.speed < 10 ? 2 : 0) + ' m/s</b> (' + (tl.speed * 3.6).toFixed(0) + ' km/sa)<br>Dikey &nbsp;&nbsp;&nbsp; <b>' + tl.vVertical.toFixed(1) + ' m/s</b><br>Yatay &nbsp;&nbsp;&nbsp; <b>' + tl.vHorizontal.toFixed(1) + ' m/s</b><br>Mach &nbsp;&nbsp;&nbsp;&nbsp; <b>' + tl.mach.toFixed(2) + '</b><br>' + tl.tPlusStr + ' <span style="opacity:.5">(giriş sonrası)</span>';
        // toast at events
        const E = evs(); let hit = null;
        for (const e of E) if (t >= e.t && t < e.t + 3.2) hit = e;
        if (hit) { toast.textContent = hit.name.toUpperCase(); toast.style.opacity = player.mode === 'video' && (t < 12.9 || (t > 27 && t < 31)) ? 0 : (1 - U.smoothstep(2.2, 3.2, t - hit.t)); } else toast.style.opacity = 0;
        // panel labels
        let ln = 0;
        for (const p of panels) if (p.labels) for (const L of p.labels) {
          let d = labels[ln]; if (!d) { d = labels[ln] = el('div', 'hud-label', ''); }
          d.style.display = ''; d.textContent = L.text; d.style.left = L.x + 'px'; d.style.top = L.y + 'px'; d.style.fontSize = L.size + 'px'; d.style.opacity = L.opacity == null ? 1 : L.opacity; ln++;
        }
        for (let i = ln; i < labels.length; i++) labels[i].style.display = 'none';
        // title card
        const st = U.stageRect(window.innerWidth, window.innerHeight);
        const vid = player.mode === 'video';
        if (vid && t < 12.1) {
          const a = t < 0.5 ? 0 : t < 1.5 ? U.easeOut((t - 0.5) / 1) : 1; const f = t > 11.567 ? 1 - U.saturate((t - 11.567) / 0.466) : 1;
          title.style.opacity = a * f; title.style.fontSize = (st.w * 0.0470 * 0.6) + 'px'; title.style.left = (st.x + st.w / 2) + 'px'; title.style.top = (st.y + st.h * 0.51) + 'px';
        } else title.style.opacity = 0;
        // icons
        icons.style.display = vid ? '' : 'none';
        if (vid) {
          icons.style.left = st.x + 'px'; icons.style.top = st.y + 'px'; icons.style.width = st.w + 'px'; icons.style.height = st.h + 'px';
          for (const d of icons.children) {
            const ti = parseFloat(d.dataset.t); const vis = t >= ti && !(d.dataset.x === '6' && t >= 165) && (t < 192.8) && !(t >= 12.03 && t < 12.733);
            d.style.display = vis ? '' : 'none'; d.style.left = (parseFloat(d.dataset.x) / 100 * st.w) + 'px'; d.style.top = (st.h * 0.925) + 'px'; d.style.fontSize = Math.max(9, st.w * 0.0075) + 'px';
          }
        }
      },
    };
  });
})();
