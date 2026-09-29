// İsviçre çapa çıkışı (Swiss lever escapement) — saf geometri ve kinematik.
//
// Yerel çerçeve: çıkış çarkı merkezi E=(0,0), çapa pivotu P=(0,-L), balans merkezi B=(0,-(L+D)).
// Çıkış çarkı saat yönünün tersine (CCW) döner. Çapa açısı psi CCW pozitif.
// Balans açısı theta CCW pozitif; theta=0 ölü merkez (empuls taşı P doğrultusunda).
//
// Modelin özü: çarkın ucu (diş ucu) palet taşlarının içine giremez. Balans hareketi
// çatalı sürer, çark ise ana yay torkuyla ileri gitmeye çalışır ama palete çarpınca durur.
// Kilitlenme, empuls, düşme (drop) ve hafif geri tepme (draw) bu kısıttan kendiliğinden çıkar.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const wrap = (a, period = TAU) => ((a % period) + period) % period;

export function makeEscapement(opt = {}) {
  const p = {
    teeth: 15,
    Re: 3.0,               // diş ucu yarıçapı
    Rroot: 2.05,           // diş dibi yarıçapı
    beta: 42 * DEG,        // palet açıklığının yarısı (3,5 diş adımı = 84°)
    D: 6.5,                // çapa pivotu – balans ekseni
    rj: 1.1,               // empuls taşı yarıçapı
    thetaE: 25 * DEG,      // balans kaldırma açısının yarısı
    lock: 0.13,            // kilit derinliği (mm)
    impulseAngle: 47 * DEG,// empuls yüzü eğimi
    stoneW: 0.56,
    stoneTop: 0.62,
    draw: 11 * DEG,        // kilit yüzü draw açısı
    ...opt,
  };
  p.pitch = TAU / p.teeth;
  p.L = p.Re / Math.cos(p.beta);
  p.PT = Math.sqrt(p.L * p.L - p.Re * p.Re);
  p.psi0 = Math.atan2(p.rj * Math.sin(p.thetaE), p.D - p.rj * Math.cos(p.thetaE));
  // taşın kilitten tam dışarı çıkana kadar radyal yer değiştirmesi
  const stroke = 2 * p.PT * Math.sin(p.psi0);
  p.stroke = stroke;

  const P = { x: 0, y: -p.L };
  const Bc = { x: 0, y: -(p.L + p.D) };

  const stones = [
    { name: 'entry', lockAngle: -Math.PI / 2 - p.beta, psiLock: -p.psi0, psiOut: +p.psi0 },
    { name: 'exit', lockAngle: -Math.PI / 2 + p.beta, psiLock: +p.psi0, psiOut: -p.psi0 },
  ];

  // Kilit yüzü T'den geçer, radyalden "draw" açısı kadar yatıktır; empuls yüzü radyale göre tanımlı.
  const d = -p.draw;
  const tU = -Math.sin(d), tV = Math.cos(d);
  const sK = -p.lock / Math.cos(d), sO = p.stoneTop / Math.cos(d);
  const uK = sK * tU;

  function buildStones(vi) {
    const ui2 = uK + (-vi - p.lock) * Math.tan(p.impulseAngle);
    const localPoly = [
      [uK, -p.lock],
      [sO * tU, sO * tV],
      [p.stoneW, sO * tV],
      [p.stoneW, vi],
      [ui2, vi],
    ];
    for (const s of stones) {
      const c = Math.cos(s.lockAngle), sn = Math.sin(s.lockAngle);
      const T = { x: p.Re * c, y: p.Re * sn };
      s.T = T;
      const uHat = { x: -sn, y: c };
      const vHat = { x: c, y: sn };
      const pts = localPoly.map(([u, v]) => ({
        x: T.x + u * uHat.x + v * vHat.x,
        y: T.y + u * uHat.y + v * vHat.y,
      }));
      const cr = Math.cos(-s.psiLock), sr = Math.sin(-s.psiLock);
      s.rel = pts.map(q => {
        const dx = q.x - P.x, dy = q.y - P.y;
        return { x: dx * cr - dy * sr, y: dx * sr + dy * cr };
      });
    }
    p.vi = vi; p.ui = ui2;
    return localPoly;
  }
  let localPoly = buildStones(-(stroke - 0.04));

  function stonePoly(j, psi) {
    const s = stones[j];
    const c = Math.cos(psi), sn = Math.sin(psi);
    return s.rel.map(q => ({ x: P.x + q.x * c - q.y * sn, y: P.y + q.x * sn + q.y * c }));
  }

  // Dış bükey çokgenin, uç dairesi (Re) ile kesişen yayını bul: {a0, a1} (CCW, a0 önce gelir)
  function blockedArc(j, psi) {
    const poly = stonePoly(j, psi);
    const R = p.Re;
    const hits = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const A = dx * dx + dy * dy;
      const B = 2 * (a.x * dx + a.y * dy);
      const C = a.x * a.x + a.y * a.y - R * R;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const s of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
        if (s >= 0 && s <= 1) hits.push(Math.atan2(a.y + s * dy, a.x + s * dx));
      }
    }
    if (hits.length < 2) return null;
    hits.sort((x, y) => x - y);
    const inside = (ang) => {
      const x = R * Math.cos(ang), y = R * Math.sin(ang);
      let sign = 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (Math.abs(cr) < 1e-12) continue;
        const sg = cr > 0 ? 1 : -1;
        if (sign === 0) sign = sg; else if (sg !== sign) return false;
      }
      return true;
    };
    for (let i = 0; i < hits.length; i++) {
      const s = hits[i];
      let e = hits[(i + 1) % hits.length];
      if (i === hits.length - 1) e += TAU;
      if (e - s < 1e-9) continue;
      if (inside((s + e) / 2)) return { a0: s, a1: e };
    }
    return null;
  }

  // Tam dışarı çıkmış taş uç dairesine (+pay) hiç değmemeli: empuls yüzünü buna göre kısalt.
  {
    let vi = -(stroke + 0.05);
    for (let it = 0; it < 200; it++) {
      localPoly = buildStones(vi);
      const clear = [0, 1].every(j => !blockedArc(j, stones[j].psiOut));
      if (clear) break;
      vi += 0.005;
    }
    // ekstra güvenlik payı
    localPoly = buildStones(vi + 0.02);
  }

  // Çark açısı phi (dişlerden biri phi + k*pitch): psi çatal açısıyla izin verilen en büyük phi
  function limitPhi(phi, psi) {
    let lim = Infinity;
    let contact = -1;
    for (let j = 0; j < 2; j++) {
      const arc = blockedArc(j, psi);
      if (!arc) continue;
      const width = arc.a1 - arc.a0;
      const x = wrap(phi - arc.a0, p.pitch); // ilk dişin a0'ı geçtikten sonraki mesafesi
      let l;
      if (x > 1e-9 && x < width) l = phi - x;            // diş taşın içinde → geri tepme
      else l = phi + (x < 1e-9 ? 0 : p.pitch - x);       // önündeki diş a0'a ulaşınca durur
      if (l < lim) { lim = l; contact = j; }
    }
    return { limit: lim, stone: contact };
  }

  // Empuls taşı çatal yuvasındayken (|theta| küçük) çatal taşı izler; dışındayken
  // güvenlik makarası çatalı banking pimine yaslı tutar (işaret theta'nın işaretine bağlı).
  function psiOfTheta(theta) {
    const t = theta; // genlik < 360° kabul edilir, sarma yok
    if (Math.abs(t) >= Math.PI / 2) return t > 0 ? -p.psi0 : p.psi0;
    const g = -Math.atan2(p.rj * Math.sin(t), p.D - p.rj * Math.cos(t));
    return Math.max(-p.psi0, Math.min(p.psi0, g));
  }

  return { p, P, B: Bc, stones, localPoly, stonePoly, blockedArc, limitPhi, psiOfTheta };
}
