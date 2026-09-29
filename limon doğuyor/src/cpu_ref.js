// Limon.CPURef — Float64 REFERENCE forward/backward/AdamW. Test-only (never enters the build).
// Priority is obviousness, not speed: every loop mirrors SPEC §3 line by line, the backward pass is derived by hand.
// The GPU engine and CPUModel are validated against this file; this file is validated against finite differences
// (dev/cpu/test.mjs).
//
// Conventions
//   cfg   = { V, T, D, L, H, FF, (B ignored) }.  Number of sequences is derived from x.length / T.
//   w     = flat weights in Limon.Layout order (Float32Array or Float64Array; read as doubles).
//   x, y  = Int32Array / Array of length N = B*T   (y may be null for forward-only -> loss = NaN)
//   grad  = Float64Array(total) in the SAME layout as w. Loss is the MEAN over N tokens, so grad is d(mean loss)/dw.
//
// AdamW state:  st = CPURef.adamInit(cfg, w)  ->  { w: Float64Array (the parameters, updated IN PLACE), m, v, t }
//   CPURef.adamStep(cfg, st, grad, lr, opts) -> { gradNorm, scale }   (opts: beta1, beta2, eps, wd, clip; SPEC defaults)
//   Order per step: global-norm clip (grad*clip/norm if norm>clip) -> t++ -> m,v update -> decoupled decay on `decay:true` tensors.
//
// Debug aid for the GPU engine: CPURef.run(cfg,w,x,y) returns every intermediate as Float64Array (row-major [N][...]):
//   layers[l] = { hIn, a (ln1 out), qkv, P [b][head][i][j] (j<=i), o, attnOut, hMid, m (ln2 out), u (fc1 pre-gelu), g (gelu),
//                 mlpOut, hOut }, f (final LN out), logits, probs, loss.   forward()/forwardBackward() are thin wrappers.
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});
  if (!Limon.Layout && typeof require === 'function') require('./layout.js');

  const LN_EPS = 1e-5;
  const GELU_C = Math.sqrt(2 / Math.PI);
  const GELU_A = 0.044715;

  const layCache = new Map();
  function getLayout(cfg) {
    const key = [cfg.V, cfg.T, cfg.D, cfg.L, cfg.H, cfg.FF].join(',');
    let l = layCache.get(key);
    if (!l) { l = Limon.Layout.build(cfg); layCache.set(key, l); }
    return l;
  }

  // out[N,M] = a[N,K] @ Wm[K,M] (Wm read from flat array `wm` at offset `wo`) + bias(optional)
  function matmulW(out, a, wm, wo, bias, bo, N, K, M) {
    for (let n = 0; n < N; n++) {
      for (let o = 0; o < M; o++) {
        let s = bias ? bias[bo + o] : 0;
        for (let i = 0; i < K; i++) s += a[n * K + i] * wm[wo + i * M + o];
        out[n * M + o] = s;
      }
    }
  }

  // Row-wise LayerNorm. Saves xhat and rstd for the backward pass.
  function lnForward(out, xhat, rstd, inp, w, go, bo, N, D) {
    for (let n = 0; n < N; n++) {
      let mean = 0;
      for (let d = 0; d < D; d++) mean += inp[n * D + d];
      mean /= D;
      let vr = 0;
      for (let d = 0; d < D; d++) { const c = inp[n * D + d] - mean; vr += c * c; }
      vr /= D;
      const rs = 1 / Math.sqrt(vr + LN_EPS);
      rstd[n] = rs;
      for (let d = 0; d < D; d++) {
        const xh = (inp[n * D + d] - mean) * rs;
        xhat[n * D + d] = xh;
        out[n * D + d] = xh * w[go + d] + w[bo + d];
      }
    }
  }

  // dx (ADDED into dxAcc), dgamma/dbeta added into grad.
  //   y = xhat*g + b ; dxhat = dy*g ; dx = rstd*(dxhat - mean(dxhat) - xhat*mean(dxhat*xhat))
  function lnBackward(dxAcc, grad, dy, xhat, rstd, w, go, bo, N, D) {
    for (let n = 0; n < N; n++) {
      let m1 = 0, m2 = 0;
      for (let d = 0; d < D; d++) {
        const dyv = dy[n * D + d];
        const dxh = dyv * w[go + d];
        m1 += dxh; m2 += dxh * xhat[n * D + d];
        grad[go + d] += dyv * xhat[n * D + d];
        grad[bo + d] += dyv;
      }
      m1 /= D; m2 /= D;
      for (let d = 0; d < D; d++) {
        const dxh = dy[n * D + d] * w[go + d];
        dxAcc[n * D + d] += rstd[n] * (dxh - m1 - xhat[n * D + d] * m2);
      }
    }
  }

  function gelu(u) { return 0.5 * u * (1 + Math.tanh(GELU_C * (u + GELU_A * u * u * u))); }
  function geluGrad(u) {
    const z = GELU_C * (u + GELU_A * u * u * u);
    const th = Math.tanh(z);
    return 0.5 * (1 + th) + 0.5 * u * (1 - th * th) * GELU_C * (1 + 3 * GELU_A * u * u);
  }

  // Full forward pass; returns every intermediate needed by the backward pass.
  function run(cfg, w, x, y) {
    const { V, T, D, L, H, FF } = cfg;
    if (D % H) throw new Error('D % H != 0');
    const DH = D / H;
    const N = x.length;
    if (N % T) throw new Error('x.length must be a multiple of T');
    const B = N / T;
    const lay = getLayout(cfg);
    const O = (name) => lay.byName[name].offset;
    const scale = 1 / Math.sqrt(DH);

    const h = new Float64Array(N * D);
    const tokO = O('tok'), posO = O('pos');
    for (let n = 0; n < N; n++) {
      const t = n % T, id = x[n];
      if (!(id >= 0 && id < V)) throw new Error('token id out of range: ' + id);
      for (let d = 0; d < D; d++) h[n * D + d] = w[tokO + id * D + d] + w[posO + t * D + d];
    }

    const layers = [];
    for (let l = 0; l < L; l++) {
      const c = { hIn: Float64Array.from(h) };
      c.a = new Float64Array(N * D); c.xh1 = new Float64Array(N * D); c.rs1 = new Float64Array(N);
      lnForward(c.a, c.xh1, c.rs1, h, w, O(`l${l}.ln1.g`), O(`l${l}.ln1.b`), N, D);

      c.qkv = new Float64Array(N * 3 * D);
      matmulW(c.qkv, c.a, w, O(`l${l}.qkv.w`), w, O(`l${l}.qkv.b`), N, D, 3 * D);

      c.P = new Float64Array(B * H * T * T);   // [b][head][i][j], only j<=i is meaningful
      c.o = new Float64Array(N * D);
      const s = new Float64Array(T);
      for (let b = 0; b < B; b++) {
        for (let hd = 0; hd < H; hd++) {
          for (let i = 0; i < T; i++) {
            const qn = b * T + i;
            let mx = -Infinity;
            for (let j = 0; j <= i; j++) {
              const kn = b * T + j;
              let dot = 0;
              for (let k = 0; k < DH; k++) dot += c.qkv[qn * 3 * D + hd * DH + k] * c.qkv[kn * 3 * D + D + hd * DH + k];
              s[j] = dot * scale;
              if (s[j] > mx) mx = s[j];
            }
            let sum = 0;
            for (let j = 0; j <= i; j++) { s[j] = Math.exp(s[j] - mx); sum += s[j]; }
            const pBase = ((b * H + hd) * T + i) * T;
            for (let j = 0; j <= i; j++) c.P[pBase + j] = s[j] / sum;
            for (let k = 0; k < DH; k++) {
              let acc = 0;
              for (let j = 0; j <= i; j++) acc += c.P[pBase + j] * c.qkv[(b * T + j) * 3 * D + 2 * D + hd * DH + k];
              c.o[qn * D + hd * DH + k] = acc;
            }
          }
        }
      }

      c.attnOut = new Float64Array(N * D);
      matmulW(c.attnOut, c.o, w, O(`l${l}.proj.w`), w, O(`l${l}.proj.b`), N, D, D);
      for (let i = 0; i < N * D; i++) h[i] += c.attnOut[i];
      c.hMid = Float64Array.from(h);

      c.m = new Float64Array(N * D); c.xh2 = new Float64Array(N * D); c.rs2 = new Float64Array(N);
      lnForward(c.m, c.xh2, c.rs2, h, w, O(`l${l}.ln2.g`), O(`l${l}.ln2.b`), N, D);
      c.u = new Float64Array(N * FF);
      matmulW(c.u, c.m, w, O(`l${l}.fc1.w`), w, O(`l${l}.fc1.b`), N, D, FF);
      c.g = new Float64Array(N * FF);
      for (let i = 0; i < N * FF; i++) c.g[i] = gelu(c.u[i]);
      c.mlpOut = new Float64Array(N * D);
      matmulW(c.mlpOut, c.g, w, O(`l${l}.fc2.w`), w, O(`l${l}.fc2.b`), N, FF, D);
      for (let i = 0; i < N * D; i++) h[i] += c.mlpOut[i];
      c.hOut = Float64Array.from(h);
      layers.push(c);
    }

    const f = new Float64Array(N * D), xhf = new Float64Array(N * D), rsf = new Float64Array(N);
    lnForward(f, xhf, rsf, h, w, O('lnf.g'), O('lnf.b'), N, D);

    const logits = new Float64Array(N * V);
    for (let n = 0; n < N; n++) {
      for (let v = 0; v < V; v++) {
        let sum = 0;
        for (let d = 0; d < D; d++) sum += f[n * D + d] * w[tokO + v * D + d];
        logits[n * V + v] = sum;
      }
    }

    // softmax cross-entropy (probs kept for backward)
    const probs = new Float64Array(N * V);
    let loss = 0;
    for (let n = 0; n < N; n++) {
      let mx = -Infinity;
      for (let v = 0; v < V; v++) if (logits[n * V + v] > mx) mx = logits[n * V + v];
      let sum = 0;
      for (let v = 0; v < V; v++) sum += Math.exp(logits[n * V + v] - mx);
      const lse = mx + Math.log(sum);
      for (let v = 0; v < V; v++) probs[n * V + v] = Math.exp(logits[n * V + v] - lse);
      if (y) loss += lse - logits[n * V + y[n]];
    }
    loss = y ? loss / N : NaN;
    return { cfg, lay, N, B, layers, f, xhf, rsf, logits, probs, loss, hFinal: Float64Array.from(h) };
  }

  function forward(cfg, w, x, y) {
    const r = run(cfg, w, x, y);
    return { loss: r.loss, logits: r.logits };
  }

  function forwardBackward(cfg, w, x, y) {
    const { V, T, D, L, H, FF } = cfg;
    const DH = D / H;
    const S = run(cfg, w, x, y);
    const { N, B, lay } = S;
    const O = (name) => lay.byName[name].offset;
    const scale = 1 / Math.sqrt(DH);
    const grad = new Float64Array(lay.total);
    const tokO = O('tok'), posO = O('pos');

    // d loss / d logits = (softmax - onehot) / N
    const dlog = new Float64Array(N * V);
    for (let n = 0; n < N; n++) {
      for (let v = 0; v < V; v++) dlog[n * V + v] = S.probs[n * V + v] / N;
      dlog[n * V + y[n]] -= 1 / N;
    }
    // tied head: logits = f @ tok^T
    const df = new Float64Array(N * D);
    for (let n = 0; n < N; n++) {
      for (let v = 0; v < V; v++) {
        const dl = dlog[n * V + v];
        for (let d = 0; d < D; d++) {
          grad[tokO + v * D + d] += dl * S.f[n * D + d];
          df[n * D + d] += dl * w[tokO + v * D + d];
        }
      }
    }
    // final LN -> dh (gradient of the residual stream)
    let dh = new Float64Array(N * D);
    lnBackward(dh, grad, df, S.xhf, S.rsf, w, O('lnf.g'), O('lnf.b'), N, D);

    // y = a @ W + b  backward: dW += a^T dy ; db += sum dy ; da = dy @ W^T (returned)
    function linBackward(a, dy, wName, bName, K, M) {
      const wo = O(wName), bo = O(bName);
      const da = new Float64Array(N * K);
      for (let n = 0; n < N; n++) {
        for (let o = 0; o < M; o++) {
          const dv = dy[n * M + o];
          grad[bo + o] += dv;
          for (let i = 0; i < K; i++) {
            grad[wo + i * M + o] += a[n * K + i] * dv;
            da[n * K + i] += dv * w[wo + i * M + o];
          }
        }
      }
      return da;
    }

    for (let l = L - 1; l >= 0; l--) {
      const c = S.layers[l];
      // ---- MLP branch: h_out = h_mid + fc2(gelu(fc1(ln2(h_mid)))) ; dh flows to h_mid unchanged plus through the branch
      const dg = linBackward(c.g, dh, `l${l}.fc2.w`, `l${l}.fc2.b`, FF, D);
      const du = new Float64Array(N * FF);
      for (let i = 0; i < N * FF; i++) du[i] = dg[i] * geluGrad(c.u[i]);
      const dm = linBackward(c.m, du, `l${l}.fc1.w`, `l${l}.fc1.b`, D, FF);
      lnBackward(dh, grad, dm, c.xh2, c.rs2, w, O(`l${l}.ln2.g`), O(`l${l}.ln2.b`), N, D);

      // ---- attention branch: h_mid = h_in + proj(o)
      const dO = linBackward(c.o, dh, `l${l}.proj.w`, `l${l}.proj.b`, D, D);
      const dqkv = new Float64Array(N * 3 * D);
      for (let b = 0; b < B; b++) {
        for (let hd = 0; hd < H; hd++) {
          for (let i = 0; i < T; i++) {
            const qn = b * T + i;
            const pBase = ((b * H + hd) * T + i) * T;
            // dP[j] = dO_i . V_j ; dV_j += P[i][j] dO_i
            const dP = new Float64Array(i + 1);
            let pdp = 0;
            for (let j = 0; j <= i; j++) {
              const kn = b * T + j;
              let dot = 0;
              for (let k = 0; k < DH; k++) {
                const dov = dO[qn * D + hd * DH + k];
                dot += dov * c.qkv[kn * 3 * D + 2 * D + hd * DH + k];
                dqkv[kn * 3 * D + 2 * D + hd * DH + k] += c.P[pBase + j] * dov;
              }
              dP[j] = dot;
              pdp += c.P[pBase + j] * dot;
            }
            // softmax backward: ds = P * (dP - sum_j P dP) ; s = q.k * scale
            for (let j = 0; j <= i; j++) {
              const kn = b * T + j;
              const ds = c.P[pBase + j] * (dP[j] - pdp) * scale;
              for (let k = 0; k < DH; k++) {
                dqkv[qn * 3 * D + hd * DH + k] += ds * c.qkv[kn * 3 * D + D + hd * DH + k];
                dqkv[kn * 3 * D + D + hd * DH + k] += ds * c.qkv[qn * 3 * D + hd * DH + k];
              }
            }
          }
        }
      }
      const da = linBackward(c.a, dqkv, `l${l}.qkv.w`, `l${l}.qkv.b`, D, 3 * D);
      lnBackward(dh, grad, da, c.xh1, c.rs1, w, O(`l${l}.ln1.g`), O(`l${l}.ln1.b`), N, D);
    }

    // embedding: h0 = tok[x] + pos[t]
    for (let n = 0; n < N; n++) {
      const t = n % T, id = x[n];
      for (let d = 0; d < D; d++) {
        grad[tokO + id * D + d] += dh[n * D + d];
        grad[posO + t * D + d] += dh[n * D + d];
      }
    }
    return { loss: S.loss, grad, logits: S.logits };
  }

  // ---------- AdamW ----------
  const ADAM_DEFAULTS = { beta1: 0.9, beta2: 0.98, eps: 1e-8, wd: 0.01, clip: 1.0 };

  function adamInit(cfg, w) {
    const lay = getLayout(cfg);
    return { w: Float64Array.from(w), m: new Float64Array(lay.total), v: new Float64Array(lay.total), t: 0 };
  }

  function adamStep(cfg, st, grad, lr, opts) {
    const o = Object.assign({}, ADAM_DEFAULTS, opts || {});
    const lay = getLayout(cfg);
    const p = st.w;
    if (!p) throw new Error('adamStep: state.w missing (use CPURef.adamInit)');
    let sq = 0;
    for (let i = 0; i < lay.total; i++) sq += grad[i] * grad[i];
    const gradNorm = Math.sqrt(sq);
    const scale = (o.clip > 0 && gradNorm > o.clip) ? o.clip / gradNorm : 1;
    st.t += 1;
    const bc1 = 1 - Math.pow(o.beta1, st.t), bc2 = 1 - Math.pow(o.beta2, st.t);
    for (const t of lay.tensors) {
      const wd = t.decay ? o.wd : 0;
      for (let i = t.offset; i < t.offset + t.size; i++) {
        const g = grad[i] * scale;
        st.m[i] = o.beta1 * st.m[i] + (1 - o.beta1) * g;
        st.v[i] = o.beta2 * st.v[i] + (1 - o.beta2) * g * g;
        const mh = st.m[i] / bc1, vh = st.v[i] / bc2;
        p[i] -= lr * (mh / (Math.sqrt(vh) + o.eps) + wd * p[i]);
      }
    }
    return { gradNorm, scale };
  }

  Limon.CPURef = { forward, forwardBackward, adamInit, adamStep, run, getLayout, gelu, geluGrad, ADAM_DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
