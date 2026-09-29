/* Dalga boyu, renk, malzeme ve sabun filmi fiziği */
(function () {
  'use strict';
  const LT = (window.LT = window.LT || {});
  const NT = 301; // 400..700 nm, 1 nm adım

  LT.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function lobe(x, mu, s1, s2) {
    const t = (x - mu) / (x < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  }

  // Dalga boyu -> doğrusal sRGB (CIE 1931 için Wyman-Sloan-Shirley yaklaşımı)
  function rawRGB(l) {
    const x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
    const y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
    const z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
    return [
      Math.max(0, 3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
      Math.max(0, -0.969266 * x + 1.8760108 * y + 0.041556 * z),
      Math.max(0, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
    ];
  }

  // SPEC: tüm dalga boylarının ortalaması tam (1,1,1) olacak şekilde dengelenmiş, yani eşit enerjili beyaz.
  // MONO: tek dalga boyunun canlı hâli (en parlak kanal = 1).
  const SPEC = new Float32Array(NT * 3);
  const MONO = new Float32Array(NT * 3);
  (function build() {
    const raw = new Float32Array(NT * 3);
    const sum = [0, 0, 0];
    for (let i = 0; i < NT; i++) {
      const c = rawRGB(400 + i);
      for (let k = 0; k < 3; k++) {
        raw[i * 3 + k] = c[k];
        sum[k] += c[k];
      }
    }
    for (let i = 0; i < NT; i++) {
      const m = Math.max(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) {
        SPEC[i * 3 + k] = raw[i * 3 + k] / (sum[k] / NT);
        MONO[i * 3 + k] = raw[i * 3 + k] / m;
      }
    }
  })();
  LT.SPEC = SPEC;
  LT.MONO = MONO;

  // Kabarcık gölgelendiricisi için 16 banda bölünmüş spektrum
  LT.bandSpectrum = function (nb) {
    const lam = new Float32Array(nb);
    const rgb = new Float32Array(nb * 3);
    const per = NT / nb;
    for (let b = 0; b < nb; b++) {
      lam[b] = 400 + (300 * (b + 0.5)) / nb;
      for (let k = 0; k < 3; k++) {
        let s = 0;
        let c = 0;
        for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) {
          s += SPEC[i * 3 + k];
          c++;
        }
        rgb[b * 3 + k] = s / c;
      }
    }
    return { lam, rgb };
  };

  // Arayüzde gösterilecek tek dalga boyu rengi (sRGB)
  LT.lamCss = function (lam) {
    const i = LT.clamp(Math.round(lam) - 400, 0, NT - 1);
    const g = (v) => Math.round(255 * Math.pow(LT.clamp(v, 0, 1), 1 / 2.2));
    return 'rgb(' + g(MONO[i * 3]) + ',' + g(MONO[i * 3 + 1]) + ',' + g(MONO[i * 3 + 2]) + ')';
  };

  // Malzemeler: nD (sodyum D çizgisi), B (Cauchy: n = A + B/λ²)
  // B değerleri gerçek Abbe sayılarından türetildi: n_F - n_C = B * (1/0.4861² - 1/0.6563²)
  LT.MATERIALS = {
    su: { name: 'Su', nD: 1.333, B: 0.00314, tint: [150, 215, 255] },
    kron: { name: 'Kron cam', nD: 1.517, B: 0.00424, tint: [175, 215, 255] },
    flint: { name: 'Flint cam', nD: 1.62, B: 0.00892, tint: [190, 225, 235] },
    elmas: { name: 'Elmas', nD: 2.417, B: 0.01319, tint: [200, 225, 255] },
  };
  const INV_D2 = 1e6 / (589.3 * 589.3);
  LT.ior = (mat, lam, disp) => mat.nD + disp * mat.B * (1e6 / (lam * lam) - INV_D2);

  // Sabun filminin kalınlık haritası (nm). Kabarcığın birim diskindeki (u,v) noktasına göre.
  // Yerçekimi kalınlığı aşağıya (v>0) doğru artırır; üstüne zamanla akan girdaplar biner.
  LT.filmThickness = function (u, v, t, thick, ph) {
    const d =
      300 * thick +
      210 * v +
      105 * Math.sin(2.3 * u + 1.6 * Math.sin(1.9 * v + 0.31 * t + ph) + 0.23 * t + ph * 1.3) +
      85 * Math.sin(3.7 * v - 1.3 * Math.sin(2.6 * u - 0.27 * t + ph * 0.7) - 0.19 * t + 1.7) +
      40 * Math.sin(5.1 * (u + v) + 2.0 * Math.sin(3.1 * u - 2.3 * v + 0.4 * t));
    return d < 45 ? 45 : d;
  };

  // İnce film yansıması (Airy): hava / film (n=1.33) / hava, s ve p kutuplanmasının ortalaması
  LT.filmR = function (lam, cosi, d) {
    const n = 1.33;
    const s2 = (1 - cosi * cosi) / (n * n);
    const cost = Math.sqrt(1 - s2);
    const rs = (cosi - n * cost) / (cosi + n * cost);
    const rp = (n * cosi - cost) / (n * cosi + cost);
    const cd = Math.cos((4 * Math.PI * n * d * cost) / lam);
    const rs2 = rs * rs;
    const rp2 = rp * rp;
    const Rs = (2 * rs2 * (1 - cd)) / (1 + rs2 * rs2 - 2 * rs2 * cd);
    const Rp = (2 * rp2 * (1 - cd)) / (1 + rp2 * rp2 - 2 * rp2 * cd);
    return 0.5 * (Rs + Rp);
  };
})();
