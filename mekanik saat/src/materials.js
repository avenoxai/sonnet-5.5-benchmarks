import * as THREE from 'three';

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Perlage (dairesel taşlama) dokusu — bir karo 12 mm. Her daire ince eş merkezli halkalar + parlak kenar. */
export function perlageTextures() {
  const S = 1536;
  const c = canvas(S, S), b = canvas(S, S);
  const g = c.getContext('2d'), gb = b.getContext('2d');
  g.fillStyle = '#a4a4a8'; g.fillRect(0, 0, S, S);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, S, S);
  const r = rng(11);
  const pitch = S / 50, rad = pitch * 0.9;
  const draw = (x, y, k) => {
    // eş merkezli halkalar
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const rings = 5;
    for (let i = 0; i <= rings * 2; i++) {
      const t = i / (rings * 2);
      const v = (i % 2 ? 0.74 : 0.9) * k;
      const val = Math.min(255, 255 * v) | 0;
      gr.addColorStop(t, `rgb(${val},${val},${Math.min(255, val + 3)})`);
    }
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    // parlak/koyu kenar (ışık bir yandan)
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.arc(x, y, rad - 0.7, Math.PI * 1.05, Math.PI * 1.85); g.stroke();
    g.strokeStyle = 'rgba(40,40,44,0.5)';
    g.beginPath(); g.arc(x, y, rad - 0.7, Math.PI * 0.05, Math.PI * 0.85); g.stroke();
    // bump: hafif halkalar
    const gbb = gb.createRadialGradient(x, y, 0, x, y, rad);
    for (let i = 0; i <= rings * 2; i++) gbb.addColorStop(i / (rings * 2), i % 2 ? 'rgb(96,96,96)' : 'rgb(170,170,170)');
    gb.fillStyle = gbb; gb.beginPath(); gb.arc(x, y, rad, 0, TAU); gb.fill();
  };
  for (let row = -2; row < 62; row++) {
    for (let col = -2; col < 56; col++) {
      const cx = col * pitch + (row % 2 ? pitch / 2 : 0) + (r() - 0.5) * pitch * 0.1;
      const cy = row * pitch * 0.82 + (r() - 0.5) * pitch * 0.1;
      const k = 0.9 + r() * 0.16;
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        const x = cx + ox, y = cy + oy;
        if (x < -rad || x > S + rad || y < -rad || y > S + rad) continue;
        draw(x, y, k);
      }
    }
  }
  return { map: tex(c, { repeat: true, aniso: 16 }), bump: tex(b, { srgb: false, repeat: true, aniso: 16 }) };
}

/** Côtes de Genève şeritleri — U yönünde bir periyot. */
export function genevaTextures() {
  const W = 256, H = 8;
  const c = canvas(W, H), b = canvas(W, H);
  const g = c.getContext('2d'), gb = b.getContext('2d');
  const gd = g.createLinearGradient(0, 0, W, 0);
  const gdb = gb.createLinearGradient(0, 0, W, 0);
  const stops = 16;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const v = 0.5 + 0.5 * Math.cos(t * TAU);          // 1 → 0 → 1
    const lum = 165 + 88 * Math.pow(v, 1.2);
    gd.addColorStop(t, `rgb(${lum | 0},${lum | 0},${(lum * 1.02) | 0})`);
    const bl = 80 + 120 * (0.5 + 0.5 * Math.sin(t * TAU));
    gdb.addColorStop(t, `rgb(${bl | 0},${bl | 0},${bl | 0})`);
  }
  g.fillStyle = gd; g.fillRect(0, 0, W, H);
  gb.fillStyle = gdb; gb.fillRect(0, 0, W, H);
  return { map: tex(c, { repeat: true, aniso: 16 }), bump: tex(b, { srgb: false, repeat: true, aniso: 16 }) };
}

/** Fırçalı çelik / ince tanecik. */
export function brushedTextures() {
  const S = 512;
  const c = canvas(S, S), g = c.getContext('2d');
  const r = rng(5);
  g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const y = r() * S, l = 40 + r() * 260, x = r() * S;
    const v = 150 + r() * 100 | 0;
    g.strokeStyle = `rgba(${v},${v},${v},${0.12 + r() * 0.2})`;
    g.lineWidth = 0.6 + r() * 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (r() - 0.5) * 1.5); g.stroke();
  }
  return { map: tex(c, { repeat: true }), rough: tex(c, { srgb: false, repeat: true }) };
}

/** Deri kayış dokusu + dikiş. u: genişlik (0..1), v: uzunluk (12 mm/tekrar). */
export function leatherTextures(baseHex = '#4b2a1a') {
  const W = 512, H = 512;
  const c = canvas(W, H), b = canvas(W, H);
  const g = c.getContext('2d'), gb = b.getContext('2d');
  const r = rng(77);
  g.fillStyle = baseHex; g.fillRect(0, 0, W, H);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, W, H);
  // tanecik: küçük koyu/ açık lekeler
  for (let i = 0; i < 26000; i++) {
    const x = r() * W, y = r() * H, rad = 0.8 + r() * 2.4;
    const a = 0.05 + r() * 0.09;
    const dark = r() < 0.55;
    g.fillStyle = dark ? `rgba(15,6,2,${a})` : `rgba(210,150,110,${a * 0.6})`;
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    gb.fillStyle = dark ? `rgba(0,0,0,${a * 3})` : `rgba(255,255,255,${a * 2})`;
    gb.beginPath(); gb.arc(x, y, rad, 0, TAU); gb.fill();
  }
  // kenar koyulaşması
  const eg = g.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, 'rgba(0,0,0,0.35)'); eg.addColorStop(0.05, 'rgba(0,0,0,0)');
  eg.addColorStop(0.95, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = eg; g.fillRect(0, 0, W, H);
  // dikiş
  for (const u of [0.075, 0.925]) {
    const x = u * W;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const y0 = (i / n) * H + 6, y1 = ((i + 0.62) / n) * H;
      g.strokeStyle = '#e8d9b5'; g.lineWidth = 4.2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.strokeStyle = 'rgba(80,60,30,0.5)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x + 1.5, y0); g.lineTo(x + 1.5, y1); g.stroke();
      gb.strokeStyle = '#ffffff'; gb.lineWidth = 5; gb.lineCap = 'round';
      gb.beginPath(); gb.moveTo(x, y0); gb.lineTo(x, y1); gb.stroke();
      gb.strokeStyle = '#000000'; gb.lineWidth = 3; gb.beginPath(); gb.moveTo(x - 4, y0); gb.lineTo(x - 4, y1); gb.stroke();
    }
  }
  return { map: tex(c, { repeat: true }), bump: tex(b, { srgb: false, repeat: true }) };
}

const DIAL_THEMES = {
  midnight: { base: '#0d2247', light: '#2b5aa3', dark: '#050e22', ring: '#c9a46a', text: '#e8d2a4', accent: '#b98a55' },
  silver:   { base: '#c9ccd0', light: '#f4f5f6', dark: '#8d9095', ring: '#4a4d52', text: '#26282b', accent: '#2f3236' },
  forest:   { base: '#123524', light: '#2f7a52', dark: '#06150e', ring: '#c9a46a', text: '#e8d2a4', accent: '#b98a55' },
  black:    { base: '#111214', light: '#3a3d43', dark: '#040405', ring: '#b8bcc4', text: '#dfe2e7', accent: '#a9adb5' },
};
export const dialThemeNames = Object.keys(DIAL_THEMES);
export const dialThemes = DIAL_THEMES;

/**
 * Kadran dokusu: güneş ışını (sunburst) + basılı işaretler. R = kadran yarıçapı (mm).
 * Tam kare = 2R mm. Seconds subdial merkezi (sx,sy) mm.
 */
export function dialTexture(themeName, { R = 17.2, sub = { x: -10.4, y: 0, r: 4.5 } } = {}) {
  const th = DIAL_THEMES[themeName] || DIAL_THEMES.midnight;
  const S = 3072;
  const c = canvas(S, S), g = c.getContext('2d');
  const b = canvas(S, S), gb = b.getContext('2d');
  const k = S / (2 * R);           // piksel/mm
  const X = (x) => S / 2 + x * k, Y = (y) => S / 2 - y * k;
  const r = rng(303);

  g.fillStyle = th.base; g.fillRect(0, 0, S, S);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, S, S);
  // güneş ışını: konik degrade
  if (g.createConicGradient) {
    const cg = g.createConicGradient(0.4, S / 2, S / 2);
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const v = 0.5 + 0.5 * Math.cos(t * TAU * 3.0 + 0.6) * Math.cos(t * TAU * 1.0);
      const col = mix(th.dark, th.light, 0.15 + 0.85 * v * v);
      cg.addColorStop(t, col);
    }
    g.fillStyle = cg; g.fillRect(0, 0, S, S);
  }
  // ince radyal fırça çizgileri
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, R * k, 0, TAU); g.clip();
  for (let i = 0; i < 9000; i++) {
    const a = r() * TAU;
    const r0 = r() * R * k * 0.4, r1 = r0 + (0.4 + r() * 0.6) * R * k;
    const l = r() < 0.5 ? 255 : 0;
    g.strokeStyle = `rgba(${l},${l},${l},${0.012 + r() * 0.03})`;
    g.lineWidth = 0.8 + r() * 1.2;
    g.beginPath(); g.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
    g.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1); g.stroke();
  }
  // kenar karartma
  const vg = g.createRadialGradient(S / 2, S / 2, R * k * 0.55, S / 2, S / 2, R * k);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = vg; g.fillRect(0, 0, S, S);
  g.restore();

  // Alt kadran (küçük saniye): guilloché halkalar
  g.save();
  g.beginPath(); g.arc(X(sub.x), Y(sub.y), sub.r * k, 0, TAU); g.clip();
  g.fillStyle = mix(th.base, '#000000', 0.25); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const rr = (i / 90) * sub.r * k;
    g.strokeStyle = `rgba(255,255,255,${0.035 + 0.05 * ((i % 2))})`;
    g.lineWidth = 1.1;
    g.beginPath(); g.arc(X(sub.x), Y(sub.y), rr, 0, TAU); g.stroke();
  }
  if (g.createConicGradient) {
    const cg = g.createConicGradient(1.1, X(sub.x), Y(sub.y));
    for (let i = 0; i <= 12; i++) cg.addColorStop(i / 12, i % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.25)');
    g.fillStyle = cg; g.fillRect(0, 0, S, S);
  }
  g.restore();

  // Dakika/saniye izi (dış halka)
  g.strokeStyle = th.text; g.fillStyle = th.text;
  const rTrackOut = R - 0.85, rTrackIn = R - 1.55;
  g.lineCap = 'butt';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU;
    const five = i % 5 === 0;
    g.lineWidth = (five ? 0.13 : 0.06) * k;
    const r0 = five ? R - 2.05 : rTrackIn, r1 = rTrackOut;
    // Alt kadranın olduğu 9 yönünü atla değil; alt kadran R dışında kalır (merkez x=-10.4, r 4.5 => -14.9)
    g.beginPath();
    g.moveTo(X(Math.sin(a) * r0), Y(Math.cos(a) * r0));
    g.lineTo(X(Math.sin(a) * r1), Y(Math.cos(a) * r1));
    g.stroke();
  }
  g.strokeStyle = th.ring; g.lineWidth = 0.05 * k;
  g.beginPath(); g.arc(S / 2, S / 2, rTrackIn - 0.15, 0, TAU); g.stroke();
  g.beginPath(); g.arc(S / 2, S / 2, rTrackOut + 0.15, 0, TAU); g.stroke();

  // Alt kadran işaretleri
  {
    const cx = X(sub.x), cy = Y(sub.y);
    g.strokeStyle = th.text; g.fillStyle = th.text;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      const five = i % 5 === 0;
      g.lineWidth = (five ? 0.09 : 0.045) * k;
      const r1 = sub.r * 0.88, r0 = r1 - (five ? 0.62 : 0.32);
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * r0 * k, cy - Math.cos(a) * r0 * k);
      g.lineTo(cx + Math.sin(a) * r1 * k, cy - Math.cos(a) * r1 * k);
      g.stroke();
    }
    g.font = `${0.62 * k}px "Didot","Bodoni 72","Playfair Display",Georgia,serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [txt, ang] of [['60', 0], ['15', 90], ['30', 180], ['45', 270]]) {
      const a = (ang / 360) * TAU;
      const rr = sub.r * 0.52;
      g.fillText(txt, cx + Math.sin(a) * rr * k, cy - Math.cos(a) * rr * k);
    }
    g.strokeStyle = th.ring; g.lineWidth = 0.05 * k;
    g.beginPath(); g.arc(cx, cy, sub.r * 0.93 * k, 0, TAU); g.stroke();
  }

  // Marka ve yazılar
  g.fillStyle = th.text; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${1.32 * k}px "Didot","Bodoni 72","Playfair Display","Times New Roman",serif`;
  drawSpaced(g, 'HOROS', X(0), Y(7.0), 0.5 * k);
  g.font = `${0.52 * k}px "Helvetica Neue",Arial,sans-serif`;
  g.fillStyle = th.accent;
  drawSpaced(g, 'MEKANİK  ·  OTOMATİK', X(0), Y(5.2), 0.22 * k);
  g.fillStyle = th.text;
  g.font = `${0.5 * k}px "Helvetica Neue",Arial,sans-serif`;
  drawSpaced(g, 'KALİBRE 01', X(0), Y(-6.0), 0.24 * k);
  drawSpaced(g, '21 TAŞ · 21.600 A/S', X(0), Y(-7.1), 0.2 * k);

  // Pürüz haritası (parlak/mat bölge): dış halka mat
  gb.fillStyle = '#808080';
  const map = tex(c, {});
  map.anisotropy = 16;
  const bump = tex(b, { srgb: false });
  return { map, bump, theme: th };
}

function drawSpaced(g, text, x, y, spacing) {
  const chars = [...text];
  let w = 0;
  const ws = chars.map((ch) => { const m = g.measureText(ch).width; w += m; return m; });
  w += spacing * (chars.length - 1);
  let cx = x - w / 2;
  const prevAlign = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((ch, i) => { g.fillText(ch, cx, y); cx += ws[i] + spacing; });
  g.textAlign = prevAlign;
}

function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}
function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rotor kenar yazısı (yay üzerine harfler): şeffaf zemin. */
export function rotorTextTexture(text, size = 1024, rMid = 0.86) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.translate(size / 2, size / 2);
  g.fillStyle = 'rgba(20,14,6,0.78)';
  g.font = `600 ${size * 0.035}px "Helvetica Neue",Arial,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...text];
  const span = 1.9; // rad
  chars.forEach((ch, i) => {
    const a = -span / 2 + (span * i) / (chars.length - 1) - Math.PI / 2;
    g.save();
    g.rotate(a + Math.PI / 2);
    g.translate(0, -(size / 2) * rMid);
    g.fillText(ch, 0, 0);
    g.restore();
  });
  return tex(c, {});
}

/** Kasa arkası yazısı için düz dokular. */
export function engravingTexture(lines, size = 1024) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.translate(size / 2, size / 2);
  g.fillStyle = 'rgba(30,30,34,0.9)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${size * 0.03}px "Helvetica Neue",Arial,sans-serif`;
  const R = size * 0.46;
  const chars = [...lines[0]];
  const span = Math.PI * 1.55;
  chars.forEach((ch, i) => {
    const a = Math.PI / 2 + Math.PI * 0.225 + (span * i) / (chars.length - 1) + Math.PI / 2;
    g.save(); g.rotate(a - Math.PI / 2 - Math.PI * 0.0); g.translate(0, R); g.rotate(Math.PI); g.fillText(ch, 0, 0); g.restore();
  });
  return tex(c, {});
}

/** Stüdyo ortam haritası: yumuşak kutular. */
export function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(140, 84, 140),
    new THREE.MeshBasicMaterial({ color: 0x1a1c21, side: THREE.BackSide }),
  );
  scene.add(room);
  // Dikey degrade dokusu: üstü parlak, altı loş (düz yüzeylerde boğuk beyazlaşmayı önler)
  const gc = document.createElement('canvas'); gc.width = 4; gc.height = 64;
  const gg = gc.getContext('2d');
  const grad = gg.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.28, '#5a5a5a'); grad.addColorStop(0.55, '#202020'); grad.addColorStop(1, '#0a0a0a');
  gg.fillStyle = grad; gg.fillRect(0, 0, 4, 64);
  const gradTex = new THREE.CanvasTexture(gc);
  const mk = (w, h, color, k, pos, look, useGrad = false) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false, map: useGrad ? gradTex : null }),
    );
    m.position.set(...pos); m.lookAt(...look); scene.add(m);
  };
  mk(80, 56, 0xfff6ea, 1.7, [0, 4, 46], [0, 0, 0], true);      // ön yumuşak kart (degrade)
  mk(34, 26, 0xfff4e6, 6, [0, 30, 4], [0, 0, 0]);           // üst softbox
  mk(5, 40, 0xdfeaff, 14, [-34, 4, 8], [0, 0, 0]);          // sol şerit
  mk(8, 36, 0xfff0dc, 9, [34, 2, 12], [0, 0, 0]);           // sağ şerit
  mk(50, 30, 0xfff1e4, 2.4, [0, 4, -40], [0, 0, 0], true);   // arka sıcak kart (degrade)
  mk(30, 18, 0xe8f0ff, 3.2, [-16, 6, -36], [0, 0, 0]);       // arka sol yumuşak kutu
  mk(16, 16, 0x9cb4ff, 1.4, [0, -30, 0], [0, 0, 0]);         // alt soğuk yansıma
  mk(6, 6, 0xffffff, 20, [16, 20, 30], [0, 0, 0]);           // parlak nokta (spec)
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  return rt.texture;
}

export function createMaterials() {
  const P = perlageTextures();
  const G = genevaTextures();
  const B = brushedTextures();
  const m = {};
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);

  m.steel = phys({ color: 0xdadde2, metalness: 1, roughness: 0.17, envMapIntensity: 1.3 });
  m.steelDark = phys({ color: 0x8a8e96, metalness: 1, roughness: 0.28, envMapIntensity: 1.1 });
  m.steelBrushed = phys({ color: 0xd0d3d8, metalness: 1, roughness: 0.34, map: B.map, roughnessMap: B.rough, envMapIntensity: 1.2 });
  m.steelBlack = phys({ color: 0x18191c, metalness: 0.9, roughness: 0.22, envMapIntensity: 1.1 });

  m.plate = phys({ color: 0xd7d9dd, metalness: 1, roughness: 0.42, map: P.map, bumpMap: P.bump, bumpScale: 0.35, envMapIntensity: 1.0 });
  P.map.repeat.set(1, 1);
  m.bridge = phys({ color: 0xe2e4e8, metalness: 1, roughness: 0.32, map: G.map, bumpMap: G.bump, bumpScale: 0.6, envMapIntensity: 1.15 });
  m.bridgeEdge = phys({ color: 0xf0f2f5, metalness: 1, roughness: 0.12, envMapIntensity: 1.5 });

  m.gold = phys({ color: 0xe6b452, metalness: 1, roughness: 0.27, envMapIntensity: 1.35 });
  m.goldSoft = phys({ color: 0xd9a84c, metalness: 1, roughness: 0.34, envMapIntensity: 1.2 });
  m.roseGold = phys({ color: 0xeaa78b, metalness: 1, roughness: 0.16, envMapIntensity: 1.5 });
  m.blued = phys({ color: 0x2c4a94, metalness: 0.85, roughness: 0.2, envMapIntensity: 1.3 });
  m.spring = phys({ color: 0x40639f, metalness: 1, roughness: 0.3, envMapIntensity: 1.2 });
  m.hairspring = phys({ color: 0x5b7ab0, metalness: 1, roughness: 0.25, envMapIntensity: 1.3 });
  m.ruby = phys({
    color: 0xd4102a, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
    emissive: 0x5a0410, emissiveIntensity: 0.7, ior: 1.76, envMapIntensity: 1.6, specularIntensity: 1,
  });
  m.rotorGold = phys({ color: 0xe6b04c, metalness: 1, roughness: 0.2, envMapIntensity: 1.45 });
  m.black = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.6, metalness: 0.2 });
  m.dark = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.8, metalness: 0.1 });
  m.lume = new THREE.MeshStandardMaterial({ color: 0xe9f0d8, emissive: 0x9fd9a0, emissiveIntensity: 0.08, roughness: 0.7 });

  // Cam: yalnızca yansıma ekler (Fresnel), altındaki görüntü aynen geçer. Ek geçiş/kırılma maliyeti yok.
  const glassMat = (k) => new THREE.MeshStandardMaterial({
    color: 0x000000, metalness: 0, roughness: 0.03, envMapIntensity: k,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  m.glass = glassMat(1.25);
  m.glassBack = glassMat(0.7);
  const L = leatherTextures();
  m.leather = phys({ color: 0xffffff, roughness: 0.62, metalness: 0, map: L.map, bumpMap: L.bump, bumpScale: 1.4, envMapIntensity: 0.6, clearcoat: 0.15, clearcoatRoughness: 0.5 });
  m.leatherEdge = new THREE.MeshStandardMaterial({ color: 0x2a170e, roughness: 0.8 });

  m.textures = { perlage: P, geneva: G, brushed: B, leather: L };
  return m;
}
