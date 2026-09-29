/* Samanyolu × Andromeda — fizik çekirdeği
 *
 * Birimler: kpc, Myr (milyon yıl), Güneş kütlesi.
 * Model: iki galaksinin merkezleri (halo dahil) çift-cisim + dinamik sürtünme ile
 * ilerler; yıldızlar bu iki potansiyelde hareket eden test parçacıklarıdır.
 * Bu dosya hem tarayıcıda (window.Physics) hem Node'da (module.exports) çalışır.
 */
(function (root) {
  'use strict';

  var G = 4.498502151469554e-12;        // kpc^3 / (Msun Myr^2)
  var KMS = 1.0227121650537077e-3;      // kpc/Myr  = 1 km/s
  var DEG = Math.PI / 180;

  /* ---------------------------------------------------------------- vektör */
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function unit(a) { var n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  /* ------------------------------------------------- rastgele sayı üreteci */
  function rng(seed) {
    var s = seed >>> 0;
    var spare = null;
    function u() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    u.gauss = function () {
      if (spare !== null) { var r = spare; spare = null; return r; }
      var a, b, q;
      do { a = 2 * u() - 1; b = 2 * u() - 1; q = a * a + b * b; } while (q >= 1 || q === 0);
      var f = Math.sqrt(-2 * Math.log(q) / q);
      spare = b * f;
      return a * f;
    };
    return u;
  }

  /* ---------------------------------------------------------------- galaksiler */
  // Samanyolu: Güneş'in konumu +x, dönüş yönü -y, kuzey kutbu +z (dönüş ekseni n = -z).
  var MW = {
    id: 0, name: 'Samanyolu',
    bulge: { M: 1.6e10, a: 0.65 },
    disc: { M: 5.2e10, a: 3.3, b: 0.30 },
    halo: { M: 1.00e12, a: 36 },
    Rd: 2.6, Rmax: 17, hz: 0.28,
    n: [0, 0, -1], e1: [1, 0, 0],
    arms: { m: 2, pitch: 13 * DEG, pattern: 0.0235, R0: 4.0, bar: 3.6, barAngle: 28 * DEG, barSpeed: 0.045 },
    tint: [1.0, 0.93, 0.85]
  };
  var M31 = {
    id: 1, name: 'Andromeda',
    bulge: { M: 3.4e10, a: 1.05 },
    disc: { M: 9.5e10, a: 5.6, b: 0.42 },
    halo: { M: 1.35e12, a: 44 },
    Rd: 5.2, Rmax: 30, hz: 0.42,
    n: [0, 0, 1], e1: [1, 0, 0],   // sahneye göre ayarlanır (aşağıda)
    arms: { m: 2, pitch: 9 * DEG, pattern: 0.0125, R0: 9.0, bar: 2.6, barAngle: 60 * DEG, barSpeed: 0.03 },
    ring: { R: 10.5, w: 1.6 },     // M31'in ünlü 10 kpc'lik yıldız oluşum halkası
    tint: [1.0, 0.88, 0.74]
  };

  /* --------------------------------------------------------------- senaryo */
  var SC = {
    sunR: 8.2,                       // kpc
    sunV: [11.1 * KMS, 12.2 * KMS + 0 * KMS, 7.25 * KMS],  // Güneş'in yerel hareketi (U,V,W), aşağıda kullanılır
    sepDir: null,                    // MW -> M31 yönü (aşağıda hesaplanır)
    sep0: 781,                       // kpc
    vr: -110,                        // km/s (yaklaşma)
    vt: 28,                          // km/s (teğetsel)
    tDir: [0, 0, 0],                 // teğet yön
    dfK: 0.5,                        // dinamik sürtünme genliği
    dfB: 35,                         // Coulomb logaritmasının yumuşatma uzunluğu (kpc) ~ halo boyutu
    Tend: 12000                      // Myr
  };

  // Andromeda'nın Güneş'ten görünen yönü: l = 121.17°, b = -21.57°
  (function () {
    var l = 121.17 * DEG, b = -21.57 * DEG;
    var d = [-Math.cos(b) * Math.cos(l), -Math.cos(b) * Math.sin(l), Math.sin(b)];
    var sun = [SC.sunR, 0, 0];
    var P = add(sun, scale(d, 778));   // Güneş'ten 778 kpc → galaktik merkezden ~781
    SC.sepVec = P;
    SC.sep0 = norm(P);
    SC.sepDir = unit(P);
    SC.losDir = d;
  })();

  function setupOrientation(opts) {
    opts = opts || {};
    // Andromeda'nın diski: görüş doğrultusuyla 77° açı (yatık, kenardan bakışa yakın)
    var los = SC.losDir;
    var u = unit(cross(los, [0, 0, 1]));
    var w = cross(los, u);
    var inc = (opts.inc !== undefined ? opts.inc : 77) * DEG;
    var psi = (opts.psi !== undefined ? opts.psi : 60) * DEG;
    var sgn = opts.spin !== undefined ? opts.spin : 1;
    var ax = add(scale(los, Math.cos(inc)), scale(add(scale(u, Math.cos(psi)), scale(w, Math.sin(psi))), Math.sin(inc)));
    M31.n = scale(unit(ax), sgn);
    // e1: n'ye dik
    var t = Math.abs(M31.n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    M31.e1 = unit(cross(t, M31.n));
    // teğetsel hız yönü: sepDir'e dik, MW diskiyle belirli açıda bir yörünge düzlemi
    var tp = opts.tPsi !== undefined ? opts.tPsi : 10;
    var sd = SC.sepDir;
    var a1 = unit(cross(sd, [0, 0, 1]));
    var a2 = cross(sd, a1);
    SC.tDir = unit(add(scale(a1, Math.cos(tp * DEG)), scale(a2, Math.sin(tp * DEG))));
  }
  setupOrientation();

  /* --------------------------------------------------------- ivme (galaksi) */
  // x: galaksi merkezine göre konum (kpc). out: ivme (kpc/Myr^2)
  function accel(g, x, out) {
    var X = x[0], Y = x[1], Z = x[2];
    var r2 = X * X + Y * Y + Z * Z;
    var r = Math.sqrt(r2) + 1e-9;
    // Hernquist: çıkıntı + halo
    var cb = -G * g.bulge.M / (r * (r + g.bulge.a) * (r + g.bulge.a));
    var ch = -G * g.halo.M / (r * (r + g.halo.a) * (r + g.halo.a));
    var c = cb + ch;
    var ax = c * X, ay = c * Y, az = c * Z;
    // Miyamoto–Nagai disk
    var n = g.n;
    var zc = X * n[0] + Y * n[1] + Z * n[2];
    var px = X - n[0] * zc, py = Y - n[1] * zc, pz = Z - n[2] * zc;
    var R2 = px * px + py * py + pz * pz;
    var B = Math.sqrt(zc * zc + g.disc.b * g.disc.b);
    var s = g.disc.a + B;
    var D = R2 + s * s;
    var cd = -G * g.disc.M / (D * Math.sqrt(D));
    var kz = zc * s / B;
    ax += cd * (px + n[0] * kz);
    ay += cd * (py + n[1] * kz);
    az += cd * (pz + n[2] * kz);
    out[0] = ax; out[1] = ay; out[2] = az;
    return out;
  }

  function totalMass(g) { return g.bulge.M + g.disc.M + g.halo.M; }

  // küresel yoğunluk (DF için): çıkıntı + halo (Hernquist)
  function density(g, r) {
    r = Math.max(r, 0.05);
    var pb = g.bulge.M * g.bulge.a / (2 * Math.PI * r * Math.pow(r + g.bulge.a, 3));
    var ph = g.halo.M * g.halo.a / (2 * Math.PI * r * Math.pow(r + g.halo.a, 3));
    // diski Plummer benzeri bir küre gibi ekle (etkisi küçük)
    var ad = g.disc.a + g.disc.b;
    var pd = 3 * g.disc.M / (4 * Math.PI * ad * ad * ad) * Math.pow(1 + r * r / (ad * ad), -2.5);
    return pb + ph + pd;
  }
  function sphericalG(g, r) {          // ortalama radyal çekim büyüklüğü
    var tmp = [0, 0, 0], s = 0;
    var dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (var i = 0; i < 6; i++) {
      var d = dirs[i];
      accel(g, [d[0] * r, d[1] * r, d[2] * r], tmp);
      s -= tmp[0] * d[0] + tmp[1] * d[1] + tmp[2] * d[2];
    }
    return s / 6;
  }
  function vcirc(g, r) { return Math.sqrt(Math.max(0, r * sphericalG(g, r))); }

  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  // I(X) = erf(X) - 2X/sqrt(pi) exp(-X^2)  (küçük X'te seri: sayısal iptali önler)
  function dfI(X) {
    if (X < 1.0) {
      var x2 = X * X, term = X * x2, sum = 0, n, c;
      // Σ (-1)^(n+1) X^(2n+1) (1 - 1/(2n+1)) / n!  , n>=1
      var f = 1;
      for (n = 1; n <= 12; n++) {
        f *= n;
        var pw = Math.pow(X, 2 * n + 1);
        c = (n % 2 === 1 ? 1 : -1) * pw / f * (1 - 1 / (2 * n + 1));
        sum += c;
      }
      return 2 / Math.sqrt(Math.PI) * sum;
    }
    return erf(X) - 2 * X / Math.sqrt(Math.PI) * Math.exp(-X * X);
  }

  /* ------------------------------------------------- merkez dinamiği (iki cisim) */
  var tmpA = [0, 0, 0], tmpB = [0, 0, 0];
  // durum: [r1(3), v1(3), r2(3), v2(3)]; çıktı: a1, a2 (grav + df ayrı)
  function centerForces(s, out) {
    var d = [s[0] - s[6], s[1] - s[7], s[2] - s[8]];       // MW - M31
    var r = norm(d);
    var M1 = totalMass(MW), M2 = totalMass(M31);
    // MW'nin M31 alanındaki ivmesi ve tersi
    accel(M31, d, tmpA);                                    // MW noktasında M31'in ivmesi
    accel(MW, [-d[0], -d[1], -d[2]], tmpB);                 // M31 noktasında MW'nin ivmesi
    // simetrik kuvvet (Newton'un 3. yasası): F1 = 0.5*(M1*gA - M2*gB)
    var F = [0.5 * (M1 * tmpA[0] - M2 * tmpB[0]), 0.5 * (M1 * tmpA[1] - M2 * tmpB[1]), 0.5 * (M1 * tmpA[2] - M2 * tmpB[2])];
    // dinamik sürtünme
    var vr = [s[3] - s[9], s[4] - s[10], s[5] - s[11]];
    var v = norm(vr) + 1e-12;
    var rho1 = density(MW, r), rho2 = density(M31, r);
    var sig = Math.max(0.5 * 0.5 * (vcirc(MW, Math.max(r, 5)) + vcirc(M31, Math.max(r, 5))), 90 * KMS);
    var X = v / (Math.SQRT2 * sig);
    var I = dfI(X);
    // yumuşatılmış Coulomb logaritması: halolar örtüşünce (r << b) sürtünme sönümlenir
    var lnL = 0.5 * Math.log(1 + (r * r) / (SC.dfB * SC.dfB));
    var Fdf = 4 * Math.PI * G * G * SC.dfK * lnL * 0.5 * (M1 * M1 * rho2 + M2 * M2 * rho1) * I / (v * v);
    var fdx = -Fdf * vr[0] / v, fdy = -Fdf * vr[1] / v, fdz = -Fdf * vr[2] / v;
    out.g1 = [F[0] / M1, F[1] / M1, F[2] / M1];
    out.g2 = [-F[0] / M2, -F[1] / M2, -F[2] / M2];
    out.d1 = [fdx / M1, fdy / M1, fdz / M1];
    out.d2 = [-fdx / M2, -fdy / M2, -fdz / M2];
    return out;
  }

  var fOut = {};
  function deriv(s, o) {
    centerForces(s, fOut);
    o[0] = s[3]; o[1] = s[4]; o[2] = s[5];
    o[3] = fOut.g1[0] + fOut.d1[0]; o[4] = fOut.g1[1] + fOut.d1[1]; o[5] = fOut.g1[2] + fOut.d1[2];
    o[6] = s[9]; o[7] = s[10]; o[8] = s[11];
    o[9] = fOut.g2[0] + fOut.d2[0]; o[10] = fOut.g2[1] + fOut.d2[1]; o[11] = fOut.g2[2] + fOut.d2[2];
  }
  function rk4(s, dt) {
    var k1 = new Array(12), k2 = new Array(12), k3 = new Array(12), k4 = new Array(12), t = new Array(12), i;
    deriv(s, k1);
    for (i = 0; i < 12; i++) t[i] = s[i] + 0.5 * dt * k1[i];
    deriv(t, k2);
    for (i = 0; i < 12; i++) t[i] = s[i] + 0.5 * dt * k2[i];
    deriv(t, k3);
    for (i = 0; i < 12; i++) t[i] = s[i] + dt * k3[i];
    deriv(t, k4);
    var o = new Array(12);
    for (i = 0; i < 12; i++) o[i] = s[i] + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    return o;
  }

  /* Merkez yörüngelerini önceden hesapla. Tablo: her satır 12 sayı, dt = h Myr. */
  function integrateCenters(h) {
    h = h || 0.5;
    var n = Math.round(SC.Tend / h);
    var M1 = totalMass(MW), M2 = totalMass(M31);
    var D = scale(SC.sepDir, SC.sep0);
    var vrel = add(scale(SC.sepDir, SC.vr * KMS), scale(SC.tDir, SC.vt * KMS));   // M31 - MW
    var mt = M1 + M2;
    // kütle merkezi çerçevesi: r1 = -M2/mt * D, r2 = +M1/mt * D
    var s = [
      -M2 / mt * D[0], -M2 / mt * D[1], -M2 / mt * D[2],
      -M2 / mt * vrel[0], -M2 / mt * vrel[1], -M2 / mt * vrel[2],
      M1 / mt * D[0], M1 / mt * D[1], M1 / mt * D[2],
      M1 / mt * vrel[0], M1 / mt * vrel[1], M1 / mt * vrel[2]
    ];
    // MW-M31 ilişkisi: d = r1 - r2 = -D (MW - M31). Burada sepDir MW->M31.
    var tab = new Float64Array(12 * (n + 1));
    for (var i = 0; i <= n; i++) {
      for (var k = 0; k < 12; k++) tab[12 * i + k] = s[k];
      if (i < n) s = rk4(s, h);
    }
    return { h: h, n: n, tab: tab };
  }

  // Hermite ara değerleme: t (Myr) -> durum
  function centerState(C, t, out) {
    out = out || new Float64Array(12);
    var f = t / C.h;
    if (f < 0) f = 0;
    if (f > C.n - 1e-9) f = C.n - 1e-9;
    var i = Math.floor(f), u = f - i, h = C.h, T = C.tab;
    var u2 = u * u, u3 = u2 * u;
    var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (var c = 0; c < 2; c++) {
      for (var k = 0; k < 3; k++) {
        var p0 = T[12 * i + 6 * c + k], p1 = T[12 * (i + 1) + 6 * c + k];
        var v0 = T[12 * i + 6 * c + 3 + k], v1 = T[12 * (i + 1) + 6 * c + 3 + k];
        out[6 * c + k] = h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
        out[6 * c + 3 + k] = v0 + (v1 - v0) * u;  // hız (yaklaşık)
      }
    }
    return out;
  }

  /* ----------------------------------------------- yıldız ivmesi (yerel çerçeve)
   * p: ebeveyn galaksi (0=MW, 1=M31), x: ebeveyn merkezine göre konum,
   * Dp: (ebeveyn merkezi - diğer merkez), aG: ebeveyn merkezinin çekim ivmesi,
   * aD: ebeveyn merkezinin dinamik sürtünme ivmesi. GLSL ile birebir aynı formül. */
  var tG1 = [0, 0, 0], tG2 = [0, 0, 0], tG3 = [0, 0, 0], tY = [0, 0, 0];
  var DF_R = 25;
  function starAccel(p, x, Dp, aG, aD, out) {
    var own = p === 0 ? MW : M31, oth = p === 0 ? M31 : MW;
    accel(own, x, tG1);
    tY[0] = Dp[0] + x[0]; tY[1] = Dp[1] + x[1]; tY[2] = Dp[2] + x[2];
    accel(oth, tY, tG2);
    var r2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2];
    var w = 1 / (1 + r2 / (DF_R * DF_R));
    // Sürtünme çekirdeğe bağlı yıldızlara da uygulanır (w≈1 → çerçeveyle birlikte yavaşlar);
    // uzak yıldızlar (w→0) sürtünmeyi hissetmez ve çerçeveye göre öne kayar.
    var u = 1 - w;
    out[0] = tG1[0] + tG2[0] - aG[0] - u * aD[0];
    out[1] = tG1[1] + tG2[1] - aG[1] - u * aD[1];
    out[2] = tG1[2] + tG2[2] - aG[2] - u * aD[2];
    return out;
  }

  /* Güneş'in tüm yörüngesi (çift duyarlıklı). */
  function integrateSun(C, h) {
    h = h || 0.1;
    var stride = Math.round(C.h / h);           // C.h / h tamsayı olmalı
    var n = C.n;
    var out = new Float64Array(6 * (n + 1));    // MW merkezine göre yerel konum(3) + hız(3)
    // başlangıç: Güneş, MW diskinde dairesel hız + yerel hareket
    var R0 = SC.sunR;
    var vc = vcirc(MW, R0);
    var x = [R0, 0, 0.02];
    // dönüş yönü: n × R̂ ; MW.n = -z, R̂=+x => -y
    var phi = unit(cross(MW.n, [1, 0, 0]));
    var v = [phi[0] * (vc + 12.2 * KMS) + 11.1 * KMS * (-1) * 1, phi[1] * (vc + 12.2 * KMS), 7.25 * KMS * (-MW.n[2])];
    // U yönü: Güneş'ten merkeze doğru pozitif (yani -x)
    v[0] = -11.1 * KMS;
    var aG = [0, 0, 0], aD = [0, 0, 0], a = [0, 0, 0], st = new Float64Array(12);
    var Dp = [0, 0, 0];
    function acc(t, xx, o) {
      centerState(C, t, st);
      centerForces(st, fOut);
      Dp[0] = st[0] - st[6]; Dp[1] = st[1] - st[7]; Dp[2] = st[2] - st[8];
      starAccel(0, xx, Dp, fOut.g1, fOut.d1, o);
    }
    var t = 0;
    acc(t, x, a);
    for (var i = 0; i <= n; i++) {
      for (var k = 0; k < 3; k++) { out[6 * i + k] = x[k]; out[6 * i + 3 + k] = v[k]; }
      if (i === n) break;
      for (var j = 0; j < stride; j++) {
        // KDK
        v[0] += 0.5 * h * a[0]; v[1] += 0.5 * h * a[1]; v[2] += 0.5 * h * a[2];
        x[0] += h * v[0]; x[1] += h * v[1]; x[2] += h * v[2];
        t += h;
        acc(t, x, a);
        v[0] += 0.5 * h * a[0]; v[1] += 0.5 * h * a[1]; v[2] += 0.5 * h * a[2];
      }
    }
    return out;
  }

  /* -------------------------------------------------- olay analizi */
  function analyze(C) {
    var n = C.n, T = C.tab, h = C.h;
    var sep = new Float32Array(n + 1);
    for (var i = 0; i <= n; i++) {
      var dx = T[12 * i] - T[12 * i + 6], dy = T[12 * i + 1] - T[12 * i + 7], dz = T[12 * i + 2] - T[12 * i + 8];
      sep[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    // yerel minimumlar (pericenter) ve maksimumlar
    var peri = [], apo = [];
    var win = Math.round(60 / h);
    for (i = win; i < n - win; i++) {
      var isMin = true, isMax = true;
      for (var j = -win; j <= win; j += Math.max(1, Math.round(win / 6))) {
        if (sep[i + j] < sep[i]) isMin = false;
        if (sep[i + j] > sep[i]) isMax = false;
      }
      if (isMin && sep[i] <= sep[i - 1] && sep[i] < sep[i + 1]) peri.push({ i: i, t: i * h, sep: sep[i] });
      if (isMax && sep[i] >= sep[i - 1] && sep[i] > sep[i + 1]) apo.push({ i: i, t: i * h, sep: sep[i] });
    }
    return { sep: sep, peri: peri, apo: apo };
  }

  /* ------------------------------------------------ Jeans (küresel) tablo */
  // tracer yoğunluğu Hernquist(a) — izotropik Jeans denklemiyle σ_r^2(r)
  function jeansTable(g, a, rmax) {
    var N = 220, r0 = 0.02, r1 = 4000;
    var lr = [], rr = [], gg = [], rho = [];
    for (var i = 0; i < N; i++) {
      var r = r0 * Math.pow(r1 / r0, i / (N - 1));
      rr.push(r);
      gg.push(sphericalG(g, r));
      var rho_ = 1 / (r * Math.pow(r + a, 3));
      if (rmax) rho_ *= 1 / (1 + Math.pow(r / rmax, 4));
      rho.push(rho_);
    }
    // σ²(r) = 1/ρ ∫_r^∞ ρ g dr  (log uzayda ters yönde trapez)
    var sig2 = new Array(N);
    var acc = 0;
    sig2[N - 1] = 0;
    for (i = N - 2; i >= 0; i--) {
      var f0 = rho[i] * gg[i], f1 = rho[i + 1] * gg[i + 1];
      acc += 0.5 * (f0 + f1) * (rr[i + 1] - rr[i]);
      sig2[i] = acc / rho[i];
    }
    return function (r) {
      var f = Math.log(r / r0) / Math.log(r1 / r0) * (N - 1);
      if (f < 0) f = 0;
      if (f > N - 1.001) f = N - 1.001;
      var k = Math.floor(f), u = f - k;
      return Math.max(0, sig2[k] * (1 - u) + sig2[k + 1] * u);
    };
  }

  /* ---------------------------------------------------- parçacık üretimi
   * Her parçacık için: dyn (8 float: x,y,z,ex, vx,vy,vz,0) ve
   * meta (8 float: parent, lum, seed, ordered, size, armAmp, tint, glow)
   * tür sırası: yıldızlar [0..nStars), toz [nStars..N). */
  function buildGalaxy(g, counts, seed) {
    var r = rng(seed);
    var n = g.n, e1 = g.e1, e2 = cross(n, e1);
    var list = [];        // {x,y,z,vx,vy,vz, meta...}
    var jB = jeansTable(g, g.bulge.a, 25);
    var jH = jeansTable(g, 9, 90);
    var star = [], dust = [];

    function place(local, vel, m, arr) {
      var x = e1[0] * local[0] + e2[0] * local[1] + n[0] * local[2];
      var y = e1[1] * local[0] + e2[1] * local[1] + n[1] * local[2];
      var z = e1[2] * local[0] + e2[2] * local[1] + n[2] * local[2];
      var vx = e1[0] * vel[0] + e2[0] * vel[1] + n[0] * vel[2];
      var vy = e1[1] * vel[0] + e2[1] * vel[1] + n[1] * vel[2];
      var vz = e1[2] * vel[0] + e2[2] * vel[1] + n[2] * vel[2];
      arr.push([x, y, z, 0, vx, vy, vz, 0, g.id, m.lum, r(), m.ordered, m.size, m.arm, m.tint, m.glow]);
    }

    // dairesel hız tablosu (disk düzleminde)
    var vcTab = [], NR = 200, Rmaxv = 60;
    var tmp = [0, 0, 0];
    for (var i = 0; i < NR; i++) {
      var Rr = 0.05 + (Rmaxv - 0.05) * i / (NR - 1);
      var s = 0;
      // disk düzleminde 4 yönün ortalaması
      var dirs = [e1, e2, [-e1[0], -e1[1], -e1[2]], [-e2[0], -e2[1], -e2[2]]];
      for (var d = 0; d < 4; d++) {
        accel(g, [dirs[d][0] * Rr, dirs[d][1] * Rr, dirs[d][2] * Rr], tmp);
        s -= tmp[0] * dirs[d][0] + tmp[1] * dirs[d][1] + tmp[2] * dirs[d][2];
      }
      vcTab.push(Math.sqrt(Math.max(0, Rr * s / 4)));
    }
    function vcAt(R) {
      var f = (R - 0.05) / (Rmaxv - 0.05) * (NR - 1);
      if (f < 0) f = 0; if (f > NR - 1.001) f = NR - 1.001;
      var k = Math.floor(f), u = f - k;
      return vcTab[k] * (1 - u) + vcTab[k + 1] * u;
    }

    function discParticle(Rd, Rmax, hz, sigScale, m, arr, ringR, ringW) {
      var R;
      do {
        if (ringR && r() < 0.75) R = ringR + ringW * r.gauss();
        else R = -Rd * (Math.log(1 - r() * 0.9999) + Math.log(1 - r() * 0.9999));
      } while (R < 0.05 || R > Rmax);
      var phi = r() * 2 * Math.PI;
      var u = Math.min(Math.max(r(), 1e-4), 1 - 1e-4);
      var z = 0.5 * hz * Math.log(u / (1 - u)) * 0.7;
      var vc = vcAt(R);
      var sR = sigScale * vc * Math.exp(-R / (5 * Rd)) + 4 * KMS;
      var sPhi = sR * 0.72, sZ = sR * 0.55;
      var vR = sR * r.gauss(), vP = vc - 0.5 * sR * sR / vc + sPhi * r.gauss(), vZ = sZ * r.gauss();
      var c = Math.cos(phi), sn = Math.sin(phi);
      // yerel çerçevede (e1,e2,n): konum ve hız (φ̂ = (-sinφ, cosφ))
      place([R * c, R * sn, z], [vR * c - vP * sn, vR * sn + vP * c, vZ], m, arr);
    }

    function sphParticle(a, rmax, jt, m, arr, flat) {
      var Fm = Math.pow(rmax / (rmax + a), 2);
      var s = Math.sqrt(r() * Fm);
      var rad = a * s / (1 - s);
      var ct = 2 * r() - 1, st = Math.sqrt(1 - ct * ct), ph = r() * 2 * Math.PI;
      var f = flat || 1;
      var lx = rad * st * Math.cos(ph), ly = rad * st * Math.sin(ph), lz = rad * ct * f;
      var sg = Math.sqrt(jt(rad));
      var vx = sg * r.gauss(), vy = sg * r.gauss(), vz = sg * r.gauss();
      // hafif dönme: çıkıntı diskle aynı yönde döner
      var rot = m.rot || 0;
      if (rot) {
        var Rc = Math.hypot(lx, ly) + 1e-6;
        var vcirc_ = vcAt(Rc) * rot;
        vx += -ly / Rc * vcirc_; vy += lx / Rc * vcirc_;
      }
      place([lx, ly, lz], [vx, vy, vz], m, arr);
    }

    var isM31 = g.id === 1;
    var Nold = counts.old, Nthick = counts.thick, Nbulge = counts.bulge, Nyoung = counts.young, Nhalo = counts.halo, Ndust = counts.dust;

    var k;
    for (k = 0; k < Nold; k++)
      discParticle(g.Rd, g.Rmax, g.hz, 0.14, { lum: 1.0, ordered: 1, size: 0.22, arm: 0.55, tint: -0.05 + 0.25 * (r() - 0.5), glow: 0.1 }, star);
    for (k = 0; k < Nthick; k++)
      discParticle(g.Rd * 1.25, g.Rmax, g.hz * 3.2, 0.22, { lum: 0.45, ordered: 1, size: 0.34, arm: 0.15, tint: -0.2 + 0.2 * (r() - 0.5), glow: 0.05 }, star);
    for (k = 0; k < Nbulge; k++)
      sphParticle(g.bulge.a, 22, jB, { lum: 0.8, ordered: 0, size: 0.16, arm: 0, tint: -0.7 + 0.2 * (r() - 0.5), glow: 0.1, rot: 0.35 }, star, 0.8);
    for (k = 0; k < Nyoung; k++)
      discParticle(g.Rd * (isM31 ? 1.5 : 1.15), g.Rmax * 0.9, g.hz * 0.35, 0.08, { lum: 1.3, ordered: 1, size: 0.2, arm: 3.2, tint: 0.55 + 0.45 * r(), glow: 1.0 }, star, isM31 ? g.ring.R : 0, isM31 ? g.ring.w : 0);
    for (k = 0; k < Nhalo; k++)
      sphParticle(9, 90, jH, { lum: 0.005, ordered: 0, size: 1.8, arm: 0, tint: 0.05 + 0.3 * (r() - 0.3), glow: 0.02 }, star, 1.0);
    for (k = 0; k < Ndust; k++)
      discParticle(g.Rd * 1.1, g.Rmax * 0.85, g.hz * 0.25, 0.06, { lum: 1.0, ordered: 1, size: 0.34, arm: 2.2, tint: 0, glow: 0 }, dust, isM31 ? g.ring.R : 0, isM31 ? g.ring.w * 1.2 : 0);
    return { star: star, dust: dust };
  }

  /* Tüm parçacıklar: yıldızlar önce, sonra toz. Float32Array döner. */
  function buildParticles(scale_) {
    var s = scale_ || 1;
    function C(o) { for (var k in o) o[k] = Math.round(o[k] * s); return o; }
    var mw = buildGalaxy(MW, C({ old: 56000, thick: 9000, bulge: 26000, young: 24000, halo: 9000, dust: 22000 }), 1234);
    var an = buildGalaxy(M31, C({ old: 62000, thick: 10000, bulge: 26000, young: 30000, halo: 10000, dust: 26000 }), 98765);
    var stars = mw.star.concat(an.star);
    var dust = mw.dust.concat(an.dust);
    var N = stars.length + dust.length;
    var dyn = new Float32Array(N * 8), meta = new Float32Array(N * 8);
    var all = stars.concat(dust);
    for (var i = 0; i < N; i++) {
      var p = all[i];
      dyn[8 * i + 0] = p[0]; dyn[8 * i + 1] = p[1]; dyn[8 * i + 2] = p[2]; dyn[8 * i + 3] = 0;
      dyn[8 * i + 4] = p[4]; dyn[8 * i + 5] = p[5]; dyn[8 * i + 6] = p[6]; dyn[8 * i + 7] = 0;
      meta[8 * i + 0] = p[8]; meta[8 * i + 1] = p[9]; meta[8 * i + 2] = p[10]; meta[8 * i + 3] = p[11];
      meta[8 * i + 4] = p[12]; meta[8 * i + 5] = p[13]; meta[8 * i + 6] = p[14]; meta[8 * i + 7] = p[15];
    }
    return { N: N, nStars: stars.length, dyn: dyn, meta: meta };
  }

  var api = {
    G: G, KMS: KMS, DEG: DEG, MW: MW, M31: M31, SC: SC,
    dot: dot, cross: cross, norm: norm, unit: unit, scale: scale, add: add, sub: sub,
    rng: rng, accel: accel, totalMass: totalMass, density: density, vcirc: vcirc, sphericalG: sphericalG,
    setupOrientation: setupOrientation,
    centerForces: centerForces, integrateCenters: integrateCenters, centerState: centerState,
    starAccel: starAccel, integrateSun: integrateSun, analyze: analyze,
    buildParticles: buildParticles, buildGalaxy: buildGalaxy, DF_R: DF_R
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Physics = api;
})(typeof window !== 'undefined' ? window : this);
