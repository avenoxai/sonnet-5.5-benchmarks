// Limon.CPUModel — Float32 inference with a KV cache and an optional activation trace (SPEC §3, §4.3).
// Same maths as Limon.CPURef (Float64 reference); this one is tuned for one-token-at-a-time speed.
//
// Design notes (read before using)
//  * WEIGHTS: setWeights(flat) COPIES `flat` into a model-owned buffer (allocated once, reused on every call, so calling it
//    every second allocates nothing). Pass {alias:true} to keep a reference instead (zero-copy; then the caller must not
//    mutate `flat` while a feed/generate is running). Pass {reset:true} to also call reset().
//  * KV CONSISTENCY: setWeights() does NOT touch the KV cache. Cached K/V were computed with the OLD weights, so after a
//    weight update the caller must call reset() (and re-prefill the context) if it needs exact results for the new weights.
//    Ignoring this is harmless for pure visualisation (mixed-version cache) but the trace is then not an exact function of
//    the current weights. slide()/generate() re-prefill, so they pick up new weights by themselves.
//  * WINDOW: `pos` = number of tokens in the window (0..T). feed()/prefill() slide automatically when pos == T (keep the
//    last T/2 tokens and re-prefill them, absolute position embeddings restart at 0). Set `m.autoSlide = false` to get a
//    RangeError instead and slide yourself with m.slide().
//  * BUFFERS ARE REUSED: feed() returns the SAME object/arrays every call (logits, trace and everything inside). Copy what
//    you need. trace.logits is the same array as the returned logits. trace.attn[l] is a view of length H*(pos+1),
//    laid out [head][j] (row stride pos+1).
//  * trace.xFinal = LN_final(h) (the vector that is multiplied by tok^T); the raw last residual stream is layers[L-1].xOut.
//    trace.token is the token that was FED (input) in that pass; trace.probs = softmax(logits) = the distribution over
//    the NEXT token. With wantTrace=false no trace work at all is done (no copies, no softmax).
//  * reset() only sets pos=0 (cache contents beyond pos are never read, so no zero-filling is needed).
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});
  if (!Limon.Layout && typeof require === 'function') require('./layout.js');

  const LN_EPS = 1e-5;
  const GELU_C = 0.7978845608028654; // sqrt(2/pi)
  const GELU_A = 0.044715;

  // y[0..M) = bias + x[0..K) @ W (W row-major [K][M] at w[wo..]); bo < 0 -> no bias.
  // Output axis is the inner loop (contiguous); 4 input rows per pass to cut y traffic.
  function matvec(y, x, w, wo, K, M, bo) {
    if (bo >= 0) { for (let o = 0; o < M; o++) y[o] = w[bo + o]; } else y.fill(0, 0, M);
    let i = 0, r = wo;
    const M4 = 4 * M;
    for (; i + 3 < K; i += 4, r += M4) {
      const x0 = x[i], x1 = x[i + 1], x2 = x[i + 2], x3 = x[i + 3];
      const r1 = r + M, r2 = r1 + M, r3 = r2 + M;
      for (let o = 0; o < M; o++) y[o] += x0 * w[r + o] + x1 * w[r1 + o] + x2 * w[r2 + o] + x3 * w[r3 + o];
    }
    for (; i < K; i++, r += M) {
      const xv = x[i];
      for (let o = 0; o < M; o++) y[o] += xv * w[r + o];
    }
  }

  function layerNorm(out, x, w, go, bo, D) {
    let mean = 0;
    for (let d = 0; d < D; d++) mean += x[d];
    mean /= D;
    let vr = 0;
    for (let d = 0; d < D; d++) { const c = x[d] - mean; vr += c * c; }
    const rs = 1 / Math.sqrt(vr / D + LN_EPS);
    for (let d = 0; d < D; d++) out[d] = (x[d] - mean) * rs * w[go + d] + w[bo + d];
  }

  class CPUModel {
    constructor(cfg) {
      const { V, T, D, L, H, FF } = cfg;
      if (!V || !T || !D || !L || !H || !FF) throw new Error('CPUModel: cfg needs V,T,D,L,H,FF');
      if (D % H) throw new Error('CPUModel: D must be divisible by H');
      this.cfg = { V, T, D, L, H, FF, DH: D / H };
      this.V = V; this.T = T; this.D = D; this.L = L; this.H = H; this.FF = FF; this.DH = D / H;
      const lay = this.lay = Limon.Layout.build(this.cfg);
      const O = (n) => lay.byName[n].offset;
      this.offTok = O('tok'); this.offPos = O('pos'); this.offLnfG = O('lnf.g'); this.offLnfB = O('lnf.b');
      this.lo = [];
      for (let l = 0; l < L; l++) {
        this.lo.push({
          ln1g: O(`l${l}.ln1.g`), ln1b: O(`l${l}.ln1.b`), qkvw: O(`l${l}.qkv.w`), qkvb: O(`l${l}.qkv.b`),
          projw: O(`l${l}.proj.w`), projb: O(`l${l}.proj.b`), ln2g: O(`l${l}.ln2.g`), ln2b: O(`l${l}.ln2.b`),
          fc1w: O(`l${l}.fc1.w`), fc1b: O(`l${l}.fc1.b`), fc2w: O(`l${l}.fc2.w`), fc2b: O(`l${l}.fc2.b`),
        });
      }
      this.wbuf = new Float32Array(lay.total);
      this.w = this.wbuf;
      this.hasWeights = false;
      this.autoSlide = true;
      this.lastStopped = false;

      this.pos = 0;
      this.hist = new Int32Array(T);          // tokens currently in the window (needed to re-prefill on slide)
      this._tmpHist = new Int32Array(T);
      this.kc = []; this.vc = [];
      for (let l = 0; l < L; l++) { this.kc.push(new Float32Array(T * D)); this.vc.push(new Float32Array(T * D)); }

      this._h = new Float32Array(D); this._a = new Float32Array(D); this._qkv = new Float32Array(3 * D);
      this._o = new Float32Array(D); this._tmp = new Float32Array(D); this._u = new Float32Array(FF);
      this._g = new Float32Array(FF); this._att = new Float32Array(H * T); this._f = new Float32Array(D);
      this.logits = new Float32Array(V);

      // trace buffers, allocated once
      const layers = [];
      this._attnBuf = []; this._attnViews = [];
      for (let l = 0; l < L; l++) {
        const buf = new Float32Array(H * T);
        const views = new Array(T + 1);
        for (let p = 1; p <= T; p++) views[p] = buf.subarray(0, H * p);
        this._attnBuf.push(buf); this._attnViews.push(views);
        layers.push({
          xIn: new Float32Array(D), attn: views[1], attnOut: new Float32Array(D), hMid: new Float32Array(D),
          mlpAct: new Float32Array(FF), mlpOut: new Float32Array(D), xOut: new Float32Array(D),
        });
      }
      this.trace = { pos: 0, token: 0, layers, xFinal: new Float32Array(D), logits: this.logits, probs: new Float32Array(V) };
      this._res = { logits: this.logits, trace: null };
    }

    setWeights(flat, opts) {
      const total = this.lay.total;
      if (!flat || flat.length !== total) throw new Error(`CPUModel.setWeights: expected ${total} floats, got ${flat && flat.length}`);
      const o = opts || {};
      if (o.alias && flat instanceof Float32Array) this.w = flat;
      else { this.wbuf.set(flat); this.w = this.wbuf; }
      this.hasWeights = true;
      if (o.reset) this.reset();
    }

    reset() { this.pos = 0; }

    // Feed ONE token at position `pos`. Returns the shared { logits, trace|null } object.
    feed(token, wantTrace) {
      this._step(token, !!wantTrace, true);
      this._res.trace = wantTrace ? this.trace : null;
      return this._res;
    }

    // Append many tokens without traces. Returns the logits after the LAST token (shared array), or null if ids is empty.
    prefill(ids) {
      const n = ids.length;
      if (!n) return null;
      for (let i = 0; i < n; i++) this._step(ids[i], false, i === n - 1);
      return this.logits;
    }

    // Keep the last `keep` (default T/2) tokens of the window and re-prefill them from position 0.
    slide(keep) {
      const k = Math.min(keep == null ? this.T >> 1 : keep, this.pos);
      const t = this._tmpHist;
      for (let i = 0; i < k; i++) t[i] = this.hist[this.pos - k + i];
      this.pos = 0;
      for (let i = 0; i < k; i++) this._step(t[i], false, false);
    }

    _step(token, wantTrace, wantLogits) {
      if (!this.hasWeights) throw new Error('CPUModel: setWeights() has not been called');
      const { D, H, DH, FF, L, V, T } = this;
      if (this.pos >= T) {
        if (!this.autoSlide) throw new RangeError('CPUModel: window full (pos == T); call slide() or reset()');
        this.slide();
      }
      if (!(token >= 0 && token < V)) throw new RangeError('CPUModel: token id out of range: ' + token);
      token = token | 0;
      const w = this.w, pos = this.pos, n = pos + 1;
      const h = this._h, a = this._a, qkv = this._qkv, o = this._o, tmp = this._tmp, u = this._u, att = this._att;
      const tr = wantTrace ? this.trace : null;
      const scale = 1 / Math.sqrt(DH);

      const tOff = this.offTok + token * D, pOff = this.offPos + pos * D;
      for (let d = 0; d < D; d++) h[d] = w[tOff + d] + w[pOff + d];
      if (tr) { tr.pos = pos; tr.token = token; }

      for (let l = 0; l < L; l++) {
        const lo = this.lo[l];
        const tl = tr ? tr.layers[l] : null;
        if (tl) tl.xIn.set(h);

        layerNorm(a, h, w, lo.ln1g, lo.ln1b, D);
        matvec(qkv, a, w, lo.qkvw, D, 3 * D, lo.qkvb);

        const kc = this.kc[l], vc = this.vc[l], base = pos * D;
        for (let d = 0; d < D; d++) { kc[base + d] = qkv[D + d]; vc[base + d] = qkv[2 * D + d]; }

        // causal attention over cache rows 0..pos, per head; att is packed [head][j] with row stride n
        for (let hd = 0; hd < H; hd++) {
          const qo = hd * DH, ao = hd * n;
          let mx = -Infinity;
          for (let j = 0; j < n; j++) {
            const ko = j * D + qo;
            let s = 0;
            for (let k = 0; k < DH; k++) s += qkv[qo + k] * kc[ko + k];
            s *= scale;
            att[ao + j] = s;
            if (s > mx) mx = s;
          }
          let sum = 0;
          for (let j = 0; j < n; j++) { const e = Math.exp(att[ao + j] - mx); att[ao + j] = e; sum += e; }
          const inv = 1 / sum;
          for (let j = 0; j < n; j++) att[ao + j] *= inv;
          for (let k = 0; k < DH; k++) o[qo + k] = 0;
          for (let j = 0; j < n; j++) {
            const p = att[ao + j], vo = j * D + qo;
            for (let k = 0; k < DH; k++) o[qo + k] += p * vc[vo + k];
          }
        }
        if (tl) {
          const view = tl.attn = this._attnViews[l][n];
          for (let i = 0, m = H * n; i < m; i++) view[i] = att[i];
        }

        const attnOut = tl ? tl.attnOut : tmp;
        matvec(attnOut, o, w, lo.projw, D, D, lo.projb);
        for (let d = 0; d < D; d++) h[d] += attnOut[d];
        if (tl) tl.hMid.set(h);

        layerNorm(a, h, w, lo.ln2g, lo.ln2b, D);
        matvec(u, a, w, lo.fc1w, D, FF, lo.fc1b);
        const g = tl ? tl.mlpAct : this._g;
        for (let i = 0; i < FF; i++) {
          const x = u[i];
          g[i] = 0.5 * x * (1 + Math.tanh(GELU_C * (x + GELU_A * x * x * x)));
        }
        const mlpOut = tl ? tl.mlpOut : tmp;
        matvec(mlpOut, g, w, lo.fc2w, FF, D, lo.fc2b);
        for (let d = 0; d < D; d++) h[d] += mlpOut[d];
        if (tl) tl.xOut.set(h);
      }

      this.hist[pos] = token;
      this.pos = pos + 1;
      if (!wantLogits) return;

      const f = this._f, logits = this.logits, tokO = this.offTok;
      layerNorm(f, h, w, this.offLnfG, this.offLnfB, D);
      for (let v = 0, r = tokO; v < V; v++, r += D) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0, d = 0;
        for (; d + 3 < D; d += 4) {
          s0 += f[d] * w[r + d]; s1 += f[d + 1] * w[r + d + 1]; s2 += f[d + 2] * w[r + d + 2]; s3 += f[d + 3] * w[r + d + 3];
        }
        for (; d < D; d++) s0 += f[d] * w[r + d];
        logits[v] = (s0 + s1) + (s2 + s3);
      }
      if (tr) {
        tr.xFinal.set(f);
        const probs = tr.probs;
        let mx = -Infinity;
        for (let v = 0; v < V; v++) if (logits[v] > mx) mx = logits[v];
        let sum = 0;
        for (let v = 0; v < V; v++) { const e = Math.exp(logits[v] - mx); probs[v] = e; sum += e; }
        const inv = 1 / sum;
        for (let v = 0; v < V; v++) probs[v] *= inv;
      }
    }

    // reset(), feed the prompt (cut to its last max(1,T-1) tokens if longer), then sample up to maxNew tokens.
    // stop ids end generation and are NOT included in the result / onToken (m.lastStopped tells whether one was hit).
    // onToken(id, trace|null): `id` was just sampled from the distribution in that trace (trace.token = the input token of
    // that pass, trace.probs = the distribution). trace is non-null only when opts.trace is truthy. Shared buffers.
    // rng is consumed exactly once per generated token, except in the argmax modes (topK=1 / temperature ~ 0): see sample().
    generate(promptIds, opts) {
      const o = opts || {};
      const maxNew = o.maxNew == null ? 64 : o.maxNew;
      const stop = o.stopIds && o.stopIds.length ? o.stopIds : null;
      const wantTrace = !!o.trace;
      const sopts = { temperature: o.temperature, topK: o.topK, topP: o.topP, rng: o.rng };
      this.lastStopped = false;
      this.reset();
      let ids = promptIds;
      if (ids.length === 0) throw new Error('CPUModel.generate: empty prompt');
      // Keep one free slot for the first sampled token; a T=1 model has no slot to spare, so it keeps 1 (the next feed slides).
      const keepN = Math.max(1, this.T - 1);
      if (ids.length > keepN) ids = ids.slice(ids.length - keepN);
      let logits;
      let tr = null;
      if (ids.length > 1) this.prefill(ids.subarray ? ids.subarray(0, ids.length - 1) : ids.slice(0, ids.length - 1));
      {
        const r = this.feed(ids[ids.length - 1], wantTrace);
        logits = r.logits; tr = r.trace;
      }
      const out = new Int32Array(Math.max(0, maxNew));
      let count = 0;
      while (count < maxNew) {
        const id = CPUModel.sample(logits, sopts);
        if (stop && stop.indexOf(id) >= 0) { this.lastStopped = true; break; }
        out[count++] = id;
        if (o.onToken) o.onToken(id, tr);
        if (count >= maxNew) break;
        const r = this.feed(id, wantTrace);
        logits = r.logits; tr = r.trace;
      }
      return count === out.length ? out : out.slice(0, count);
    }

    // Sampling: temperature <= 1e-6 or topK==1 -> argmax. Otherwise softmax(logits/temperature), then top-k (if 0<topK<V),
    // then nucleus top-p (smallest prefix of the sorted candidates whose mass >= topP, at least 1), renormalise, draw with rng.
    // RNG CONTRACT: the stochastic path consumes exactly ONE rng() value per call. The deterministic argmax paths consume
    // NONE (greedy needs no randomness): temperature <= 1e-6 (or not a number > 1e-6), topK == 1, and the degenerate
    // fallbacks (all logits -Infinity/NaN, or a softmax sum that is not > 0). So a caller that replays one rng stream in
    // lock-step across calls must not assume "one draw per token" when it may pass topK=1 / temperature ~ 0.
    static sample(logits, opts) {
      const o = opts || {};
      const temperature = o.temperature == null ? 0.8 : o.temperature;
      const topK = o.topK == null ? 0 : o.topK | 0;
      const topP = o.topP == null ? 1 : o.topP;
      const rng = o.rng || Math.random;
      const V = logits.length;
      if (!(temperature > 1e-6) || topK === 1) return argmax(logits);
      if (sBuf.length < V) { sBuf = new Float64Array(V); sIdx = new Int32Array(V); }
      const p = sBuf;
      let mx = -Infinity;
      for (let i = 0; i < V; i++) if (logits[i] > mx) mx = logits[i];
      if (mx === -Infinity || mx !== mx) return argmax(logits);
      let sum = 0;
      for (let i = 0; i < V; i++) { const e = Math.exp((logits[i] - mx) / temperature); p[i] = e; sum += e; }
      if (!(sum > 0)) return argmax(logits);

      const useK = topK > 0 && topK < V, useP = topP < 1;
      if (!useK && !useP) {
        let r = rng() * sum;
        for (let i = 0; i < V; i++) { r -= p[i]; if (r < 0) return i; }
        return V - 1;
      }
      const idx = sIdx.subarray(0, V);
      for (let i = 0; i < V; i++) idx[i] = i;
      idx.sort((x, y) => (p[y] - p[x]) || (x - y));
      let cnt = useK ? topK : V;
      let total = 0;
      for (let i = 0; i < cnt; i++) total += p[idx[i]];
      if (useP) {
        let cum = 0, keep = cnt;
        for (let i = 0; i < cnt; i++) {
          cum += p[idx[i]];
          if (cum >= topP * total) { keep = i + 1; break; }
        }
        cnt = keep;
        total = 0;
        for (let i = 0; i < cnt; i++) total += p[idx[i]];
      }
      let r = rng() * total;
      for (let i = 0; i < cnt; i++) { r -= p[idx[i]]; if (r < 0) return idx[i]; }
      return idx[cnt - 1];
    }
  }

  let sBuf = new Float64Array(256), sIdx = new Int32Array(256);
  function argmax(a) {
    let best = 0, bv = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > bv) { bv = a[i]; best = i; }
    return best;
  }

  Limon.CPUModel = CPUModel;
  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
