// Limon — shared foundations: RNG utilities + flat parameter layout + deterministic init.
// Single source of truth for how the model's weights are laid out in ONE flat Float32Array.
// Used by: GPU trainer, CPU model/reference, brain visualiser, app.
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});

  // ---------- Util ----------
  function rng(seed) { // mulberry32 -> [0,1)
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randn(r) { // Box-Muller, one sample per call
    let u = 0, v = 0;
    while (u === 0) u = r();
    v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Turkish-aware lowercase / uppercase (I<->ı, İ<->i). Never use String.prototype.toLowerCase for Turkish text.
  function lowerTR(s) { return s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); }
  function upperTR(s) { return s.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase(); }

  Limon.Util = { rng, randn, lowerTR, upperTR };

  // ---------- Default config ----------
  // V (vocab size) is filled in at runtime from Limon.Data.vocab.length.
  Limon.CONFIG = { T: 128, D: 128, L: 3, H: 4, FF: 512, B: 32 };

  // ---------- Layout ----------
  // All tensors row-major inside one flat Float32Array. Matrices are stored [in][out]:
  //   y[o] = sum_i x[i] * w[i*cols + o]   (rows = in, cols = out)
  // Vectors have rows = 1.
  // qkv.w columns: [ Q (D) | K (D) | V (D) ]; head h owns columns h*DH .. (h+1)*DH-1 inside each block.
  // Output projection is TIED to `tok`:  logits[n][v] = sum_d f[n][d] * tok[v*D + d]  (no output bias).
  function build(cfg) {
    const { V, T, D, L, FF } = cfg;
    if (!V || !T || !D || !L || !FF || !cfg.H) throw new Error('Layout.build: cfg needs V,T,D,L,H,FF');
    if (D % cfg.H) throw new Error('D must be divisible by H');
    const tensors = []; const byName = {}; let offset = 0;
    function add(name, rows, cols, kind, layer, decay) {
      const t = { name, rows, cols, size: rows * cols, offset, kind, layer: layer == null ? -1 : layer, decay: !!decay };
      tensors.push(t); byName[name] = t; offset += t.size; return t;
    }
    add('tok', V, D, 'emb', -1, false);
    add('pos', T, D, 'emb', -1, false);
    for (let l = 0; l < L; l++) {
      add(`l${l}.ln1.g`, 1, D, 'ln_g', l, false); add(`l${l}.ln1.b`, 1, D, 'ln_b', l, false);
      add(`l${l}.qkv.w`, D, 3 * D, 'mat', l, true); add(`l${l}.qkv.b`, 1, 3 * D, 'bias', l, false);
      add(`l${l}.proj.w`, D, D, 'mat', l, true); add(`l${l}.proj.b`, 1, D, 'bias', l, false);
      add(`l${l}.ln2.g`, 1, D, 'ln_g', l, false); add(`l${l}.ln2.b`, 1, D, 'ln_b', l, false);
      add(`l${l}.fc1.w`, D, FF, 'mat', l, true); add(`l${l}.fc1.b`, 1, FF, 'bias', l, false);
      add(`l${l}.fc2.w`, FF, D, 'mat', l, true); add(`l${l}.fc2.b`, 1, D, 'bias', l, false);
    }
    add('lnf.g', 1, D, 'ln_g', -1, false); add('lnf.b', 1, D, 'ln_b', -1, false);
    return { cfg: { ...cfg, DH: D / cfg.H }, total: offset, tensors, byName };
  }

  // Deterministic init. opts override the defaults (all stds are absolute).
  //   embStd: tok, posStd: pos, matStd: qkv/fc1, outStd: proj/fc2 (residual-out; default matStd/sqrt(2L))
  function init(cfg, seed, opts) {
    const lay = build(cfg); const w = new Float32Array(lay.total); const r = rng((seed == null ? 1 : seed) * 7919 + 13);
    const o = Object.assign({ embStd: 0.05, posStd: 0.02, matStd: 0.04 }, opts || {});
    if (o.outStd == null) o.outStd = o.matStd / Math.sqrt(2 * cfg.L);
    for (const t of lay.tensors) {
      const a = t.offset, b = t.offset + t.size;
      if (t.kind === 'ln_g') w.fill(1, a, b);
      else if (t.kind === 'ln_b' || t.kind === 'bias') w.fill(0, a, b);
      else {
        const std = t.name === 'tok' ? o.embStd : t.name === 'pos' ? o.posStd
          : (t.name.endsWith('proj.w') || t.name.endsWith('fc2.w')) ? o.outStd : o.matStd;
        for (let i = a; i < b; i++) w[i] = randn(r) * std;
      }
    }
    return w;
  }

  function paramCount(cfg) { return build(cfg).total; }

  Limon.Layout = { build, init, paramCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
