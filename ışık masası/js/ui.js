/* Etkileşim: seçim, sürükleme, tutamaçlar, paneller, kabarcık patlatma */
(function () {
  'use strict';
  const LT = window.LT;
  const S = LT.state;
  const ov = document.getElementById('overlay');
  const octx = ov.getContext('2d');
  const insp = document.getElementById('inspector');
  const settings = document.getElementById('settings');
  const hint = document.getElementById('hint');
  let odpr = 1;
  let drag = null;
  let pending = null; // panelden sürüklenen yeni nesne
  const pops = [];
  const syncers = [];
  const setSync = [];
  let reg = syncers; // kontrol üreticilerinin kayıt defteri

  LT.overlayResize = function (W, H) {
    odpr = Math.min(window.devicePixelRatio || 1, 2);
    ov.width = Math.round(W * odpr);
    ov.height = Math.round(H * odpr);
    S.overlayDirty = true;
  };

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const sel = () => LT.getItem(S.selId);

  // ---------- seçim ----------
  function select(id) {
    if (S.selId === id) return;
    S.selId = id;
    S.overlayDirty = true;
    renderInspector();
  }
  LT.onItemsChanged = () => {
    if (!sel()) S.selId = null;
    S.overlayDirty = true;
    renderInspector();
  };

  // ---------- tutamaçlar ----------
  function handles(it) {
    const g = it.geo;
    const out = { rot: null, scl: null };
    if (it.kind === 'source') {
      out.rot = { x: it.x + g.dx * (g.bx1 + 36), y: it.y + g.dy * (g.bx1 + 36) };
    } else if (it.kind === 'bubble') {
      const a = Math.PI / 4;
      const d = Math.max(g.ax, g.ay) + 16;
      out.scl = { x: g.cx + Math.cos(a) * d, y: g.cy + Math.sin(a) * d };
    } else {
      const a = it.rot - Math.PI / 2;
      out.rot = { x: it.x + Math.cos(a) * (g.R + 30), y: it.y + Math.sin(a) * (g.R + 30) };
      const b = Math.PI / 4;
      out.scl = { x: it.x + Math.cos(b) * (g.R + 16), y: it.y + Math.sin(b) * (g.R + 16) };
    }
    return out;
  }
  function hitHandle(it, x, y) {
    const h = handles(it);
    if (h.rot && Math.hypot(x - h.rot.x, y - h.rot.y) < 11) return 'rot';
    if (h.scl && Math.hypot(x - h.scl.x, y - h.scl.y) < 11) return 'scl';
    return null;
  }

  // ---------- fare / dokunma ----------
  function beginDrag(it, x, y) {
    drag = { type: 'move', id: it.id, ox: it.x - x, oy: it.y - y };
    ov.style.cursor = 'grabbing';
  }

  ov.addEventListener('pointerdown', (e) => {
    fadeHint();
    closeSettings();
    const x = e.clientX;
    const y = e.clientY;
    const cur = sel();
    if (cur) {
      const h = hitHandle(cur, x, y);
      if (h === 'rot') {
        drag = { type: 'rot', id: cur.id };
        ov.style.cursor = 'grabbing';
        return;
      }
      if (h === 'scl') {
        const c = cur.kind === 'bubble' ? { x: cur.geo.cx, y: cur.geo.cy } : cur;
        drag = { type: 'scl', id: cur.id, d0: Math.hypot(x - c.x, y - c.y) || 1, s0: cur.scale };
        ov.style.cursor = 'nwse-resize';
        return;
      }
    }
    const it = LT.pick(x, y);
    if (it) {
      select(it.id);
      LT.bringToFront(it);
      beginDrag(it, x, y);
    } else select(null);
  });

  window.addEventListener('pointermove', (e) => {
    const x = e.clientX;
    const y = e.clientY;
    if (pending && !drag) {
      if (Math.hypot(x - pending.x, y - pending.y) > 8) {
        const it = spawn(pending.type, x, y);
        beginDrag(it, x, y);
        drag.ox = 0;
        drag.oy = 0;
        pending = null;
      }
    }
    if (drag) {
      const it = LT.getItem(drag.id);
      if (!it) return;
      if (drag.type === 'move') {
        it.x = LT.clamp(x + drag.ox, 0, S.W);
        it.y = LT.clamp(y + drag.oy, 0, S.H);
      } else if (drag.type === 'rot') {
        let a = Math.atan2(y - it.y, x - it.x) - (it.kind === 'source' ? 0 : -Math.PI / 2);
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        it.rot = a;
      } else if (drag.type === 'scl') {
        const c = it.kind === 'bubble' ? { x: it.geo.cx, y: it.geo.cy } : it;
        it.scale = LT.clamp((drag.s0 * Math.hypot(x - c.x, y - c.y)) / drag.d0, 0.4, 2.8);
      }
      LT.glassChanged();
      syncInspector();
      return;
    }
    if (e.target !== ov) return;
    // üzerine gelme
    const cur = sel();
    let cursor = 'default';
    let hid = null;
    if (cur && hitHandle(cur, x, y)) cursor = hitHandle(cur, x, y) === 'rot' ? 'grab' : 'nwse-resize';
    else {
      const it = LT.pick(x, y);
      if (it) {
        hid = it.id;
        cursor = 'grab';
      }
    }
    ov.style.cursor = cursor;
    if (hid !== S.hoverId) {
      S.hoverId = hid;
      S.overlayDirty = true;
    }
  });

  function endDrag() {
    if (pending) {
      spawn(pending.type);
      pending = null;
    }
    if (drag) {
      drag = null;
      ov.style.cursor = 'default';
      S.overlayDirty = true;
    }
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  ov.addEventListener('dblclick', (e) => {
    const it = LT.pick(e.clientX, e.clientY);
    if (it && it.kind === 'bubble') popBubble(it);
  });
  ov.addEventListener('contextmenu', (e) => e.preventDefault());

  ov.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      fadeHint();
      const it = LT.pick(e.clientX, e.clientY) || sel();
      if (!it) return;
      if (e.shiftKey || e.ctrlKey) {
        if (it.kind === 'source') return;
        const k = e.ctrlKey ? 0.012 : 0.0035;
        it.scale = LT.clamp(it.scale * Math.exp(-e.deltaY * k), 0.4, 2.8);
      } else if (it.kind !== 'bubble') {
        it.rot += (e.deltaY || e.deltaX) * 0.0028;
      } else return;
      LT.glassChanged();
      syncInspector();
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const it = sel();
    if (!it) return;
    let used = true;
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'Delete' || e.key === 'Backspace') removeSel();
    else if (e.key === 'Escape') select(null);
    else if (e.key === 'd' || e.key === 'D') duplicate();
    else if (e.key === 'ArrowLeft') it.x -= step;
    else if (e.key === 'ArrowRight') it.x += step;
    else if (e.key === 'ArrowUp') it.y -= step;
    else if (e.key === 'ArrowDown') it.y += step;
    else if (e.key === 'q' || e.key === 'Q') it.rot -= 0.05;
    else if (e.key === 'e' || e.key === 'E') it.rot += 0.05;
    else if (e.key === '+' || e.key === '=') it.scale = LT.clamp(it.scale * 1.05, 0.4, 2.8);
    else if (e.key === '-') it.scale = LT.clamp(it.scale / 1.05, 0.4, 2.8);
    else used = false;
    if (used) {
      e.preventDefault();
      LT.glassChanged();
      syncInspector();
    }
  });

  function fadeHint() {
    hint.classList.add('gone');
  }

  // ---------- ekleme / silme ----------
  function freeSpot(type) {
    let best = null;
    let bestD = -1;
    const isSrc = type === 'beam' || type === 'point' || type === 'laser';
    for (let i = 0; i < 40; i++) {
      const x = S.W * (isSrc ? 0.06 + Math.random() * 0.16 : 0.28 + Math.random() * 0.46);
      const y = S.H * (0.2 + Math.random() * 0.5);
      let d = 1e9;
      for (const it of S.items) d = Math.min(d, Math.hypot(it.x - x, it.y - y));
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
    return best;
  }

  function spawn(type, x, y) {
    if (x === undefined) {
      const p = freeSpot(type);
      x = p[0];
      y = p[1];
    }
    const it = LT.newItem(type, x, y);
    select(it.id);
    return it;
  }

  function removeSel() {
    const it = sel();
    if (!it) return;
    LT.removeItem(it.id);
    renderInspector();
  }
  function duplicate() {
    const it = sel();
    if (!it) return;
    const c = LT.newItem(it.type, it.x + 44, it.y + 44, {
      rot: it.rot,
      scale: it.scale,
      mat: it.mat,
      apex: it.apex,
      concave: it.concave,
      f: it.f,
      width: it.width,
      spread: it.spread,
      mono: it.mono,
      lam: it.lam,
      power: it.power,
      thick: it.thick,
    });
    select(c.id);
  }

  function popBubble(it) {
    if (it.popT > 0) return;
    it.popT = 0.001;
    const g = it.geo;
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 150;
      pops.push({
        x: g.cx + Math.cos(a) * g.ax * 0.95,
        y: g.cy + Math.sin(a) * g.ay * 0.95,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 20,
        life: 0.5 + Math.random() * 0.5,
        age: 0,
        hue: Math.random() * 360,
        r: 1 + Math.random() * 2.2,
      });
    }
    if (S.selId === it.id) select(null);
    S.overlayDirty = true;
    LT.touch(3);
  }
  LT.popBubble = popBubble;

  // ---------- dock ----------
  document.querySelectorAll('.tool').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fadeHint();
      closeSettings();
      pending = { type: b.dataset.add, x: e.clientX, y: e.clientY };
    });
  });

  // ---------- hazır sahneler ----------
  const sceneBtns = document.querySelectorAll('#scenes button');
  sceneBtns.forEach((b) => {
    b.addEventListener('click', () => {
      LT.loadPreset(b.dataset.scene);
      sceneBtns.forEach((x) => x.classList.toggle('on', x === b));
      history.replaceState(null, '', '#' + b.dataset.scene);
      renderInspector();
    });
  });

  // ---------- kontrol üreticileri ----------
  function slider(label, min, max, step, get, set, fmt, cls) {
    const r = el('div', 'row');
    r.innerHTML = '<label><span>' + label + '</span><output></output></label>';
    const out = r.querySelector('output');
    const inp = el('input', cls || '');
    inp.type = 'range';
    inp.min = min;
    inp.max = max;
    inp.step = step;
    const upd = () => {
      const v = get();
      inp.value = v;
      out.textContent = fmt ? fmt(v) : v;
      inp.style.setProperty('--p', ((v - min) / (max - min)) * 100 + '%');
    };
    inp.addEventListener('input', () => {
      set(parseFloat(inp.value));
      upd();
    });
    r.appendChild(inp);
    reg.push(upd);
    upd();
    return r;
  }
  function seg(label, opts, get, set) {
    const r = el('div', 'row');
    if (label) r.appendChild(el('div', 'lbl', '<span>' + label + '</span>'));
    const s = el('div', 'seg');
    const btns = opts.map((o) => {
      const b = el('button', '', o.t);
      b.addEventListener('click', () => {
        set(o.v);
        upd();
      });
      s.appendChild(b);
      return b;
    });
    const upd = () => opts.forEach((o, i) => btns[i].classList.toggle('on', get() === o.v));
    reg.push(upd);
    upd();
    r.appendChild(s);
    return r;
  }
  function toggle(label, get, set) {
    const t = el('div', 'toggle', '<span>' + label + '</span><i></i>');
    const upd = () => t.classList.toggle('on', !!get());
    t.addEventListener('click', () => {
      set(!get());
      upd();
    });
    reg.push(upd);
    upd();
    return t;
  }
  function btn(text, cls, fn) {
    const b = el('button', 'btn ' + (cls || ''), text);
    b.addEventListener('click', fn);
    return b;
  }

  const MATS = [
    { v: 'su', t: 'Su' },
    { v: 'kron', t: 'Kron' },
    { v: 'flint', t: 'Flint' },
    { v: 'elmas', t: 'Elmas' },
  ];
  const changed = () => LT.glassChanged();

  function syncInspector() {
    for (const f of syncers) f();
  }

  function renderInspector() {
    reg = syncers;
    syncers.length = 0;
    const it = sel();
    if (!it) {
      insp.classList.add('hidden');
      insp.innerHTML = '';
      return;
    }
    insp.classList.remove('hidden');
    insp.innerHTML = '';
    const isSrc = it.kind === 'source';
    const dotCol = isSrc ? 'rgb(255,240,210)' : it.kind === 'bubble' ? '#c7a0ff' : '#9ad7ff';
    insp.appendChild(el('h3', '', '<span class="dot" style="background:' + dotCol + ';box-shadow:0 0 12px ' + dotCol + '"></span>' + LT.NAMES[it.type]));

    if (isSrc) {
      if (it.stype === 'beam') insp.appendChild(slider('Genişlik', 2, 300, 1, () => it.width, (v) => { it.width = v; changed(); }, (v) => Math.round(v) + ' px'));
      if (it.stype === 'point') insp.appendChild(slider('Açıklık', 10, 360, 1, () => it.spread, (v) => { it.spread = v; changed(); }, (v) => Math.round(v) + '°'));
      if (it.stype !== 'laser') {
        insp.appendChild(seg('Renk', [{ v: false, t: 'Beyaz' }, { v: true, t: 'Tek renk' }], () => it.mono, (v) => { it.mono = v; LT.hardReset(); renderInspector(); }));
      }
      if (it.mono || it.stype === 'laser') {
        insp.appendChild(slider('Dalga boyu', 0, 300, 1, () => 700 - it.lam, (v) => { it.lam = 700 - v; changed(); }, () => Math.round(it.lam) + ' nm', 'hue'));
      }
      insp.appendChild(slider('Parlaklık', 0.2, 2.5, 0.05, () => it.power, (v) => { it.power = v; changed(); }, (v) => v.toFixed(2)));
      insp.appendChild(slider('Yön', 0, 360, 1, () => ((((it.rot * 180) / Math.PI) % 360) + 360) % 360, (v) => { it.rot = (v * Math.PI) / 180; changed(); }, (v) => Math.round(v) + '°'));
    } else if (it.kind === 'bubble') {
      insp.appendChild(slider('Boyut', 0.4, 2.8, 0.05, () => it.scale, (v) => { it.scale = v; changed(); }, (v) => '×' + v.toFixed(2)));
      insp.appendChild(slider('Film kalınlığı', 0.4, 2.2, 0.05, () => it.thick, (v) => { it.thick = v; changed(); }, (v) => Math.round(v * 300) + ' nm'));
      const p = el('p', 'note', 'Kalınlık değiştikçe girişim renkleri kayar.');
      insp.appendChild(p);
      insp.appendChild(btn('Patlat', '', () => popBubble(it)));
      insp.lastChild.style.width = '100%';
      insp.lastChild.style.marginBottom = '10px';
    } else {
      if (it.kind === 'lens') insp.appendChild(seg('Tür', [{ v: false, t: 'Dışbükey' }, { v: true, t: 'İçbükey' }], () => it.concave, (v) => { it.concave = v; LT.hardReset(); }));
      insp.appendChild(seg('Malzeme', MATS, () => it.mat, (v) => { it.mat = v; LT.hardReset(); }));
      insp.appendChild(el('p', 'note', 'n = ' + '<span id="ior"></span>'));
      const iorEl = insp.lastChild.querySelector('#ior');
      syncers.push(() => {
        const m = LT.MATERIALS[it.mat];
        iorEl.textContent = m.nD.toFixed(3) + ' · Abbe sayısı ' + Math.round((m.nD - 1) / (m.B * 1.91));
      });
      syncers[syncers.length - 1]();
      if (it.kind === 'prism') insp.appendChild(slider('Tepe açısı', 20, 90, 1, () => it.apex, (v) => { it.apex = v; changed(); }, (v) => Math.round(v) + '°'));
      if (it.kind === 'lens') insp.appendChild(slider('Odak uzaklığı', 90, 520, 5, () => it.f, (v) => { it.f = v; changed(); }, (v) => Math.round(v) + ' px'));
      insp.appendChild(slider('Boyut', 0.4, 2.8, 0.05, () => it.scale, (v) => { it.scale = v; changed(); }, (v) => '×' + v.toFixed(2)));
      insp.appendChild(slider('Döndür', 0, 360, 1, () => ((((it.rot * 180) / Math.PI) % 360) + 360) % 360, (v) => { it.rot = (v * Math.PI) / 180; changed(); }, (v) => Math.round(v) + '°'));
    }
    const row = el('div', 'btns');
    row.appendChild(btn('Çoğalt', '', duplicate));
    row.appendChild(btn('Sil', 'danger', removeSel));
    insp.appendChild(row);
  }

  // ---------- ayarlar ----------
  const settingsBody = document.getElementById('settingsBody');
  function buildSettings() {
    reg = setSync;
    setSync.length = 0;
    settingsBody.innerHTML = '';
    const set = S.set;
    const redraw = () => LT.redraw();
    settingsBody.appendChild(slider('Işık parlaklığı', 0.3, 3, 0.05, () => set.exposure, (v) => { set.exposure = v; redraw(); }, (v) => v.toFixed(2)));
    settingsBody.appendChild(slider('Dispersiyon', 0, 4, 0.05, () => set.disp, (v) => { set.disp = v; LT.touch(2); }, (v) => (v === 0 ? 'yok' : '×' + v.toFixed(2))));
    settingsBody.appendChild(slider('Sis / parıltı', 0, 2, 0.05, () => set.glow, (v) => { set.glow = v; redraw(); }, (v) => v.toFixed(2)));
    settingsBody.appendChild(slider('Yüzey yansımaları', 0, 1, 0.05, () => set.refl, (v) => { set.refl = v; LT.touch(2); }, (v) => Math.round(v * 100) + '%'));
    settingsBody.appendChild(seg('Görünüm', [{ v: 'light', t: 'Işık huzmesi' }, { v: 'rays', t: 'Işın çizgileri' }], () => set.mode, (v) => { set.mode = v; LT.touch(3); }));
    settingsBody.appendChild(toggle('Köpükler süzülsün', () => set.drift, (v) => { set.drift = v; LT.touch(3); }));
    const row = el('div', 'btns');
    row.appendChild(
      btn('PNG kaydet', '', () =>
        LT.snapshot((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'isik-masasi.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        })
      )
    );
    row.appendChild(
      btn('Masayı boşalt', 'danger', () => {
        S.items.length = 0;
        select(null);
        LT.hardReset();
        sceneBtns.forEach((x) => x.classList.remove('on'));
      })
    );
    settingsBody.appendChild(row);
    reg = syncers;
  }
  function closeSettings() {
    settings.classList.add('hidden');
  }
  document.getElementById('btnSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    if (settings.classList.contains('hidden')) {
      buildSettings();
      settings.classList.remove('hidden');
    } else {
      closeSettings();
      renderInspector();
    }
  });

  // ---------- kaplama çizimi ----------
  function drawSelection(it, hover) {
    const g = it.geo;
    octx.save();
    octx.lineJoin = 'round';
    if (hover) {
      octx.strokeStyle = 'rgba(255,255,255,0.3)';
      octx.lineWidth = 1.2;
    } else {
      octx.strokeStyle = 'rgba(154,215,255,0.9)';
      octx.lineWidth = 1.4;
      octx.setLineDash([5, 4]);
    }
    octx.beginPath();
    if (it.kind === 'source') {
      octx.translate(it.x, it.y);
      octx.rotate(it.rot);
      octx.roundRect(g.bx0 - 5, -g.hh - 5, g.bx1 - g.bx0 + 10, g.hh * 2 + 10, 7);
    } else if (it.kind === 'bubble') {
      octx.translate(g.cx, g.cy);
      octx.rotate(g.rot);
      octx.ellipse(0, 0, g.ax * 1.06, g.ay * 1.06, 0, 0, Math.PI * 2);
    } else {
      octx.moveTo(g.poly[0][0], g.poly[0][1]);
      for (let i = 1; i < g.poly.length; i++) octx.lineTo(g.poly[i][0], g.poly[i][1]);
      octx.closePath();
    }
    octx.stroke();
    octx.restore();
  }

  function drawHandles(it) {
    const h = handles(it);
    const c = it.kind === 'bubble' ? { x: it.geo.cx, y: it.geo.cy } : it;
    octx.save();
    octx.strokeStyle = 'rgba(154,215,255,0.9)';
    octx.fillStyle = 'rgba(10,16,26,0.85)';
    octx.lineWidth = 1.4;
    if (h.rot) {
      const a = it.kind === 'source' ? { x: it.x + it.geo.dx * it.geo.bx1, y: it.y + it.geo.dy * it.geo.bx1 } : { x: it.x + (h.rot.x - it.x) * (it.geo.R / (it.geo.R + 30)), y: it.y + (h.rot.y - it.y) * (it.geo.R / (it.geo.R + 30)) };
      octx.globalAlpha = 0.5;
      octx.beginPath();
      octx.moveTo(a.x, a.y);
      octx.lineTo(h.rot.x, h.rot.y);
      octx.stroke();
      octx.globalAlpha = 1;
      octx.beginPath();
      octx.arc(h.rot.x, h.rot.y, 7, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
      octx.beginPath();
      octx.arc(h.rot.x, h.rot.y, 3, -2.4, 1.6);
      octx.stroke();
    }
    if (h.scl) {
      octx.beginPath();
      octx.arc(h.scl.x, h.scl.y, 6.5, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
      const ux = Math.SQRT1_2;
      octx.beginPath();
      octx.moveTo(h.scl.x - ux * 3, h.scl.y - ux * 3);
      octx.lineTo(h.scl.x + ux * 3, h.scl.y + ux * 3);
      octx.stroke();
    }
    // nokta ışığın açıklık kaması
    if (it.kind === 'source' && it.stype === 'point') {
      const half = (it.spread * Math.PI) / 360;
      octx.setLineDash([3, 5]);
      octx.globalAlpha = 0.45;
      for (const s of [-1, 1]) {
        octx.beginPath();
        octx.moveTo(c.x, c.y);
        octx.lineTo(c.x + Math.cos(it.rot + s * half) * 90, c.y + Math.sin(it.rot + s * half) * 90);
        octx.stroke();
      }
    }
    octx.restore();
  }

  LT.drawOverlay = function (dt) {
    const active = pops.length > 0;
    if (!S.overlayDirty && !active) return;
    S.overlayDirty = false;
    octx.setTransform(odpr, 0, 0, odpr, 0, 0);
    octx.clearRect(0, 0, S.W, S.H);
    const hov = LT.getItem(S.hoverId);
    const cur = sel();
    if (hov && hov !== cur && !drag) drawSelection(hov, true);
    if (cur) {
      drawSelection(cur, false);
      drawHandles(cur);
    }
    if (active) {
      octx.save();
      octx.globalCompositeOperation = 'lighter';
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.age += dt;
        if (p.age >= p.life) {
          pops.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 260 * dt;
        p.vx *= 0.985;
        const k = 1 - p.age / p.life;
        octx.fillStyle = 'hsla(' + p.hue + ',90%,72%,' + k * 0.9 + ')';
        octx.beginPath();
        octx.arc(p.x, p.y, p.r * (0.5 + k), 0, Math.PI * 2);
        octx.fill();
      }
      octx.restore();
    }
  };

  LT.uiInit = function () {
    renderInspector();
  };

  // otomatik test/demo için
  LT.ui = { select, spawn, popBubble, removeSel, duplicate };
})();
