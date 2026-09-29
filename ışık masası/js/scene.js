/* Sahne durumu, öğeler ve geometri */
(function () {
  'use strict';
  const LT = window.LT;
  const S = (LT.state = {
    items: [],
    selId: null,
    hoverId: null,
    W: window.innerWidth,
    H: window.innerHeight,
    set: { exposure: 1.0, disp: 1.6, glow: 0.7, refl: 0.6, mode: 'light', drift: true },
    time: 0,
    dirty: 2, // 0 yok, 1 hafif (kabarcık nefesi), 2 ağır (sürükleme)
    glassDirty: true,
    overlayDirty: true,
  });

  LT.touch = (level) => {
    S.dirty = Math.max(S.dirty, level === undefined ? 2 : level);
  };
  // yapısal değişiklik (ekle/sil/yükle/malzeme): birikimi tamamen sıfırla, eski ışınlar hayalet bırakmasın
  LT.hardReset = () => {
    S.glassDirty = true;
    S.overlayDirty = true;
    LT.touch(3);
  };
  LT.glassChanged = () => {
    S.glassDirty = true;
    S.overlayDirty = true;
    LT.touch(2);
  };

  let uid = 1;
  const DEF = {
    beam: { kind: 'source', stype: 'beam', width: 24, mono: false, lam: 560, power: 1, spread: 60 },
    point: { kind: 'source', stype: 'point', width: 0, mono: false, lam: 560, power: 1, spread: 80 },
    laser: { kind: 'source', stype: 'laser', width: 2, mono: true, lam: 640, power: 1, spread: 0 },
    prism: { kind: 'prism', mat: 'flint', apex: 60 },
    lens: { kind: 'lens', mat: 'kron', concave: false, f: 230 },
    diamond: { kind: 'diamond', mat: 'elmas' },
    bubble: { kind: 'bubble', thick: 1 },
  };
  LT.NAMES = {
    beam: 'Işın demeti',
    point: 'Nokta ışık',
    laser: 'Lazer',
    prism: 'Prizma',
    lens: 'Mercek',
    diamond: 'Elmas',
    bubble: 'Sabun köpüğü',
  };

  // küçük ekranlarda nesneleri ve huzme genişliklerini küçült
  LT.viewK = () => LT.clamp(Math.min(S.W / 1500, S.H / 850), 0.5, 1);

  LT.newItem = function (type, x, y, extra) {
    const it = Object.assign({ id: uid++, type, x, y, rot: 0, scale: 1, phase: Math.random() * 6.28, popT: 0 }, DEF[type], extra || {});
    if (extra === undefined || extra.scale === undefined) it.scale = LT.viewK();
    S.items.push(it);
    LT.buildGeo(it, S.time);
    LT.hardReset();
    return it;
  };

  LT.removeItem = function (id) {
    const i = S.items.findIndex((t) => t.id === id);
    if (i >= 0) S.items.splice(i, 1);
    if (S.selId === id) S.selId = null;
    LT.hardReset();
  };

  LT.getItem = (id) => S.items.find((t) => t.id === id) || null;

  // ---------- geometri ----------

  function xf(it, lx, ly) {
    const c = Math.cos(it.rot);
    const s = Math.sin(it.rot);
    lx *= it.scale;
    ly *= it.scale;
    return [it.x + lx * c - ly * s, it.y + lx * s + ly * c];
  }
  function rotv(it, nx, ny) {
    const c = Math.cos(it.rot);
    const s = Math.sin(it.rot);
    return [nx * c - ny * s, nx * s + ny * c];
  }

  // Düz yüzlü (dışbükey) çokgen: normaller merkezden dışarı bakacak şekilde seçilir
  function flatPoly(it, pts) {
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    const n = pts.length;
    const segs = new Float64Array(n * 8);
    const poly = [];
    let R = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      let nx = b[1] - a[1];
      let ny = -(b[0] - a[0]);
      if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const l = Math.hypot(nx, ny);
      const [wnx, wny] = rotv(it, nx / l, ny / l);
      const A = xf(it, a[0], a[1]);
      const B = xf(it, b[0], b[1]);
      segs.set([A[0], A[1], B[0], B[1], wnx, wny, wnx, wny], i * 8);
      poly.push(A);
      R = Math.max(R, Math.hypot(A[0] - it.x, A[1] - it.y));
    }
    return { segs, n, poly, R, cx: it.x, cy: it.y };
  }

  // Yay parçalarından oluşan (mercek) çokgen; normaller analitik
  function arcPoly(it, parts) {
    // parts: [{p:[x,y], n:[nx,ny]}] köşe listesi, ardışık ikililer birer kenar. Düz kenarlar için her köşenin
    // 'nNext' alanı sonraki kenarın normalini verir (yay noktalarında n her iki kenar için de geçerli).
    const n = parts.length;
    const segs = new Float64Array(n * 8);
    const poly = [];
    let R = 0;
    for (let i = 0; i < n; i++) {
      const a = parts[i];
      const b = parts[(i + 1) % n];
      const A = xf(it, a.p[0], a.p[1]);
      const B = xf(it, b.p[0], b.p[1]);
      const na = rotv(it, (a.nOut || a.n)[0], (a.nOut || a.n)[1]);
      const nb = rotv(it, (b.nIn || b.n)[0], (b.nIn || b.n)[1]);
      segs.set([A[0], A[1], B[0], B[1], na[0], na[1], nb[0], nb[1]], i * 8);
      poly.push(A);
      R = Math.max(R, Math.hypot(A[0] - it.x, A[1] - it.y));
    }
    return { segs, n, poly, R, cx: it.x, cy: it.y };
  }

  const ARC_N = 40;

  function geoLens(it) {
    const h = 210;
    const half = h / 2;
    const nD = LT.MATERIALS[it.mat].nD;
    // ince mercek: f = R / (2 (n-1))
    const R = Math.max(2 * (nD - 1) * it.f, half * 1.12);
    const sag = R - Math.sqrt(R * R - half * half);
    const tm = Math.asin(half / R);
    const parts = [];
    if (!it.concave) {
      const cr = -(R - sag);
      for (let i = 0; i <= ARC_N; i++) {
        const th = -tm + (2 * tm * i) / ARC_N;
        parts.push({ p: [cr + R * Math.cos(th), R * Math.sin(th)], n: [Math.cos(th), Math.sin(th)] });
      }
      const cl = R - sag;
      for (let i = 0; i <= ARC_N; i++) {
        const th = tm - (2 * tm * i) / ARC_N;
        parts.push({ p: [cl - R * Math.cos(th), R * Math.sin(th)], n: [-Math.cos(th), Math.sin(th)] });
      }
    } else {
      const e = h * 0.1;
      const cr = e / 2 - sag + R;
      for (let i = 0; i <= ARC_N; i++) {
        const th = -tm + (2 * tm * i) / ARC_N;
        parts.push({
          p: [cr - R * Math.cos(th), R * Math.sin(th)],
          n: [Math.cos(th), -Math.sin(th)],
          nOut: i === ARC_N ? [0, 1] : null, // sağ yayın son köşesinden alt düz kenara
          nIn: i === 0 ? [0, -1] : null, // üst düz kenardan gelen kenarın normali
        });
      }
      const cl = -(e / 2 - sag + R);
      for (let i = 0; i <= ARC_N; i++) {
        const th = tm - (2 * tm * i) / ARC_N;
        parts.push({
          p: [cl + R * Math.cos(th), R * Math.sin(th)],
          n: [-Math.cos(th), -Math.sin(th)],
          nOut: i === ARC_N ? [0, -1] : null, // sol yayın son köşesinden üst düz kenara
          nIn: i === 0 ? [0, 1] : null, // alt düz kenardan gelen kenarın normali
        });
      }
    }
    const g = arcPoly(it, parts);
    g.lensR = R;
    g.lensH = h;
    return g;
  }

  // Elmasın kesiti (yandan görünüş). Birim: girdle çapı = 1. Taç ~34.9°, pavyon ~41.3°.
  const DIAMOND = [
    [-0.27, -0.21],
    [0.27, -0.21],
    [0.5, -0.05],
    [0.5, -0.02],
    [0, 0.42],
    [-0.5, -0.02],
    [-0.5, -0.05],
  ];
  LT.DIAMOND_LOCAL = DIAMOND;
  const DIAMOND_SIZE = 175;

  function geoPrism(it) {
    const L = 200;
    const a = (it.apex * Math.PI) / 180;
    const w = L * Math.sin(a / 2);
    const H = L * Math.cos(a / 2);
    return flatPoly(it, [
      [0, (-2 * H) / 3],
      [w, H / 3],
      [-w, H / 3],
    ]);
  }

  LT.buildGeo = function (it, t) {
    const mat = LT.MATERIALS[it.mat];
    let g;
    if (it.kind === 'prism') g = geoPrism(it);
    else if (it.kind === 'lens') g = geoLens(it);
    else if (it.kind === 'diamond') {
      const k = DIAMOND_SIZE;
      g = flatPoly(
        it,
        DIAMOND.map((p) => [p[0] * k, p[1] * k])
      );
    } else if (it.kind === 'bubble') {
      const R = 72 * it.scale;
      const w = 0.03 * Math.sin(t * 1.7 + it.phase) + 0.015 * Math.sin(t * 2.9 + it.phase * 2.1);
      let dx = 0;
      let dy = 0;
      if (S.set.drift) {
        dx = 7 * Math.sin(t * 0.37 + it.phase * 1.7);
        dy = 5 * Math.cos(t * 0.29 + it.phase);
      }
      const pop = it.popT;
      const rot = 0.35 * Math.sin(t * 0.4 + it.phase);
      g = {
        cx: it.x + dx,
        cy: it.y + dy,
        ax: R * (1 + w),
        ay: R * (1 - w),
        cr: Math.cos(rot),
        sr: Math.sin(rot),
        rot,
        R: R * 1.05,
        pop,
      };
    } else {
      // ışık kaynağı: yerel +x öne bakar
      const dxr = Math.cos(it.rot);
      const dyr = Math.sin(it.rot);
      let bx0 = -36;
      let bx1 = 16;
      let hh = 17;
      let front = 18;
      if (it.stype === 'beam') hh = LT.clamp(it.width / 2 + 9, 17, 220);
      else if (it.stype === 'point') {
        bx0 = -15;
        bx1 = 15;
        hh = 15;
        front = 16;
      } else {
        bx0 = -46;
        bx1 = 10;
        hh = 8;
        front = 12;
      }
      g = { dx: dxr, dy: dyr, bx0, bx1, hh, front, R: Math.max(40, hh), cx: it.x, cy: it.y };
    }
    g.mat = mat || null;
    it.geo = g;
    return g;
  };

  LT.rebuildGeo = function (t) {
    for (const it of S.items) LT.buildGeo(it, t);
  };

  // ---------- seçme ----------

  function inPoly(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  LT.inPoly = inPoly;

  LT.pick = function (x, y) {
    for (let i = S.items.length - 1; i >= 0; i--) {
      const it = S.items[i];
      const g = it.geo;
      if (it.kind === 'source') {
        const dx = x - it.x;
        const dy = y - it.y;
        const lx = dx * g.dx + dy * g.dy;
        const ly = -dx * g.dy + dy * g.dx;
        if (lx >= g.bx0 - 5 && lx <= g.bx1 + 5 && Math.abs(ly) <= g.hh + 5) return it;
      } else if (it.kind === 'bubble') {
        if (it.popT > 0) continue;
        const px = x - g.cx;
        const py = y - g.cy;
        const lx = (px * g.cr + py * g.sr) / g.ax;
        const ly = (-px * g.sr + py * g.cr) / g.ay;
        if (lx * lx + ly * ly <= 1.08) return it;
      } else if (inPoly(g.poly, x, y)) return it;
    }
    return null;
  };

  LT.bringToFront = function (it) {
    const i = S.items.indexOf(it);
    if (i >= 0 && i < S.items.length - 1) {
      S.items.splice(i, 1);
      S.items.push(it);
      LT.glassChanged();
    }
  };

  // ---------- hazır sahneler ----------

  function fr(x, y) {
    return [x * S.W, y * S.H];
  }
  function addPx(type, x, y, extra) {
    const k = LT.viewK();
    const e = Object.assign({}, extra);
    e.scale = (e.scale || 1) * k;
    if (e.width) e.width = Math.max(2, e.width * k);
    return LT.newItem(type, x, y, e);
  }
  function add(type, fx, fy, extra) {
    const p = fr(fx, fy);
    return addPx(type, p[0], p[1], extra);
  }
  const D = Math.PI / 180;
  // (x,y) noktasından ang yönünde d uzaklıktaki nokta
  const along = (p, ang, d) => [p[0] + Math.cos(ang) * d, p[1] + Math.sin(ang) * d];

  // ışın prizmanın sol yüzünün ortasına ~54° geliş açısıyla (asgari sapma) düşecek şekilde kaynak yerleştirir
  function prismRig(fx, fy, scale, width, dist) {
    const k = LT.viewK();
    const pc = fr(fx, fy);
    const ang = -25 * D;
    const mid = [pc[0] - 50 * scale * k, pc[1] - 29 * scale * k]; // sol yüz ortası (60° tepe, kenar 200)
    const d = Math.min(dist * k, (mid[0] - 50) / Math.cos(ang));
    const src = along(mid, ang, -d);
    addPx('beam', src[0], src[1], { width, rot: ang });
    addPx('prism', pc[0], pc[1], { scale });
  }

  LT.presets = {
    karma() {
      // üst: ince beyaz ışın prizmadan gökkuşağına ayrışır
      prismRig(0.31, 0.28, 1.1, 26, 400);
      // alt: geniş huzme mercekle odaklanıp elmasa düşer (tek eksen boyunca)
      const k = LT.viewK();
      const ang = 14 * D;
      const s0 = fr(0.04, 0.52);
      addPx('beam', s0[0], s0[1], { width: 70, rot: ang });
      const l = along(s0, ang, 300 * k);
      addPx('lens', l[0], l[1], { f: 200, scale: 0.95, rot: ang });
      const dm = along(l, ang, 375 * k);
      addPx('diamond', dm[0], dm[1], { scale: 1.15 });
      // köpükler ışığı yakalar
      add('bubble', 0.74, 0.5, { scale: 1.25, phase: 1.3 });
      add('bubble', 0.87, 0.24, { scale: 0.7, phase: 4.1, thick: 1.25 });
      add('bubble', 0.62, 0.78, { scale: 0.8, phase: 2.7, thick: 0.85 });
    },
    prizma() {
      prismRig(0.46, 0.4, 1.35, 26, 520);
    },
    mercek() {
      add('beam', 0.08, 0.5, { width: 190, rot: 0 });
      add('lens', 0.3, 0.5, { f: 240, scale: 1.1 });
      add('lens', 0.62, 0.5, { f: 200, concave: true, scale: 0.9 });
    },
    elmas() {
      const dm = fr(0.52, 0.52);
      const src = fr(0.12, 0.4);
      const aim = Math.atan2(dm[1] - src[1], dm[0] - src[0]) + 4 * D;
      addPx('beam', src[0], src[1], { width: 34, rot: aim });
      addPx('diamond', dm[0], dm[1], { scale: 1.9, rot: -0.15 });
    },
    kopuk() {
      add('beam', 0.05, 0.5, { width: 230, rot: 0 });
      add('bubble', 0.36, 0.42, { scale: 1.8, phase: 0.6 });
      add('bubble', 0.6, 0.66, { scale: 1.25, phase: 2.2, thick: 1.3 });
      add('bubble', 0.7, 0.26, { scale: 0.85, phase: 3.7, thick: 0.8 });
      add('bubble', 0.86, 0.55, { scale: 1.5, phase: 5.1, thick: 1.1 });
    },
  };

  LT.loadPreset = function (name) {
    S.items.length = 0;
    S.selId = null;
    (LT.presets[name] || LT.presets.karma)();
    LT.hardReset();
  };
})();
