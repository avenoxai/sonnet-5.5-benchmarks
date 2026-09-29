// Limon.Data — tokenizer, sampler, validation batch, Turkish score, chat prompt (SPEC 4.1).
//
// Inputs (all optional; the module never throws when they are missing):
//   Limon.CORPUS  written by build.mjs into src/corpus.gen.js:
//       { docs:[string], kinds:'dnd..' (one char per doc: 'd' dialogue, 'n' narrative),
//         val:[doc index] (held-out docs, leak-cleaned at build time), vocab:string, stats:{...} }
//   Limon.TRGen   Turkish sentence generator (src/gen.js). Reached only through the adapter `synthSource`
//                 below, so any of the supported entry points works (see there).
// Without a CORPUS a tiny built-in fallback text is used (info.fallback === true).
//
// Vocab order is FIXED: '\n', ' ', punctuation, digits, lowercase (Turkish alphabet order, then q w x), uppercase.
// The build keeps only the characters actually seen in the corpus / in TRGen samples of several seeds and embeds the result as
// CORPUS.vocab so nothing is recomputed at run time. SPEC characters the data never contains (build report: "vocab'a girmeyenler")
// are not in the vocab on purpose: their embedding would never be trained, so encode() maps them to a space (SPEC 4.1).
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});

  // ---------- small helpers (kept local so data.js also works when loaded alone) ----------
  const U = Limon.Util || {};
  const lowerTR = U.lowerTR || function (s) { return s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); };
  function makeRng(seed) { // mulberry32
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- character universe / normalisation (SPEC 5) ----------
  const PUNCT = ".,!?:;-'\"()";
  const LOWER = 'abcçdefgğhıijklmnoöprsştuüvyz' + 'qwx';
  const UPPER = 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ' + 'QWX';
  const UNIVERSE = '\n ' + PUNCT + '0123456789' + LOWER + UPPER;
  const ALLOWED = new Set(UNIVERSE.split(''));

  const CHAR_MAP = {
    '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'", '`': "'", 'ʼ': "'",
    '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"', '‹': "'", '›': "'",
    '—': '-', '–': '-', '‒': '-', '―': '-', '−': '-', '‐': '-', '‑': '-',
    '…': '...',
    'â': 'a', 'Â': 'A', 'î': 'i', 'Î': 'İ', 'û': 'u', 'Û': 'U',
    '\t': ' ', '\f': ' ', '\v': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ', ' ': ' ',
    '​': '', '‌': '', '‍': '', '﻿': '', '­': '', '⁠': '',
    ' ': '\n', ' ': '\n', '\r': '\n',
  };
  for (let c = 0x2000; c <= 0x200a; c++) CHAR_MAP[String.fromCharCode(c)] = ' ';

  // opts.keepBad: leave disallowed characters in place (so the caller can report them); default → replaced by a space.
  // opts.stats:   optional Map(char → count) filled with every character that was rewritten (mapped or folded).
  // opts.bad:     optional Map(char → count) filled with characters that are still disallowed.
  function normalize(s, opts) {
    opts = opts || {};
    s = String(s).normalize('NFC').replace(/\r\n/g, '\n');
    const stats = opts.stats, bad = opts.bad;
    let out = '';
    for (const ch of s) {
      if (ALLOWED.has(ch)) { out += ch; continue; }
      let r = CHAR_MAP[ch];
      if (r === undefined) { // diacritic fold: é -> e, ñ -> n ...
        const d = ch.normalize('NFD').replace(/\p{M}/gu, '');
        if (d !== ch && d.length > 0 && [...d].every((c) => ALLOWED.has(c))) r = d;
      }
      if (r !== undefined) {
        if (stats) stats.set(ch, (stats.get(ch) || 0) + 1);
        out += r;
      } else {
        if (bad) bad.set(ch, (bad.get(ch) || 0) + 1);
        out += opts.keepBad ? ch : ' ';
      }
    }
    return out.replace(/ +/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '').replace(/^ +| +$/g, '');
  }

  // ---------- fallback corpus (only used when Limon.CORPUS has no documents) ----------
  const FALLBACK_DOCS = [
    'Sen: Merhaba!\nLimon: Merhaba! Ben Limon. Sen kimsin?\nSen: Ben Ayşe.\nLimon: Tanıştığıma sevindim Ayşe.',
    'Sen: Nasılsın?\nLimon: İyiyim, teşekkür ederim. Henüz çok küçüğüm ama öğrenmeyi çok seviyorum.',
    'Sen: Sen kimsin?\nLimon: Ben Limon, küçücük bir yapay zekayım. Bu tarayıcı sekmesinde doğdum.',
    'Sen: Ne seversin?\nLimon: Limonata, güneş, kelimeler, çay ve kedileri severim.',
    'Limon bir tarayıcı sekmesinde doğdu. Önce saçmaladı, sonra harfleri, kelimeleri ve cümleleri öğrendi. Şimdi Türkçe konuşmaya çalışıyor.',
    'Sabah güneş doğarken kediler pencerenin önünde uzanır. Çay demlenir, ekmek kızarır. Yeni bir gün böyle başlar.',
    'Kelimeler harflerden, cümleler kelimelerden yapılır. Bir dil öğrenmek, küçük parçaları yan yana getirmeyi öğrenmektir.',
    'Yağmur yağınca sokaklar parlar. Çocuklar şemsiyelerin altında koşar, kimi su birikintilerine basar, kimi gülerek eve girer.',
  ];

  // ---------- CORPUS -> documents ----------
  const CORPUS = root.Limon.CORPUS || null;
  let usingFallback = false;
  let DOCS, KINDS; // KINDS[i] = 1 dialogue, 0 narrative
  (function loadDocs() {
    if (CORPUS && Array.isArray(CORPUS.docs) && CORPUS.docs.length) {
      DOCS = CORPUS.docs.slice();
      KINDS = new Uint8Array(DOCS.length);
      for (let i = 0; i < DOCS.length; i++) {
        KINDS[i] = CORPUS.kinds ? (CORPUS.kinds[i] === 'd' ? 1 : 0) : (isDialogueText(DOCS[i]) ? 1 : 0);
      }
    } else {
      usingFallback = true;
      DOCS = FALLBACK_DOCS.slice();
      KINDS = new Uint8Array(DOCS.length);
      for (let i = 0; i < DOCS.length; i++) KINDS[i] = isDialogueText(DOCS[i]) ? 1 : 0;
    }
  })();
  function isDialogueText(t) { return /(^|\n)(Sen|Limon): /.test(t); }

  // ---------- 32-gram hashing (train/val leak check) ----------
  const GRAM = 32;
  const imul = Math.imul; // cached: global lookups are slow inside node:vm contexts (build.mjs runs this code there)
  function gramPow(base) { let p = 1; for (let i = 0; i < GRAM; i++) p = imul(p, base); return p; }
  const B1 = 31, B2 = 131, P1 = gramPow(B1), P2 = gramPow(B2);
  // key = 53-bit number from two independent 32-bit polynomial hashes
  function forEachGram(s, cb) {
    const n = s.length; if (n < GRAM) return;
    let h1 = 0, h2 = 0;
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i) + 1;
      h1 = (imul(h1, B1) + c) | 0; h2 = (imul(h2, B2) + c) | 0;
      if (i >= GRAM) {
        const o = s.charCodeAt(i - GRAM) + 1;
        h1 = (h1 - imul(o, P1)) | 0; h2 = (h2 - imul(o, P2)) | 0;
      }
      if (i >= GRAM - 1) cb((h1 >>> 0) * 2097152 + (h2 >>> 11), h1 >>> 0);
    }
  }

  // Deterministic train/val split by document index (~2% validation), cleaned so that no validation document shares a
  // 32-character n-gram with any other document. Returns { val: Uint8Array flags, leakFallback: bool }.
  function splitDocs(docs, opts) {
    opts = opts || {};
    const n = docs.length, val = new Uint8Array(n);
    if (n < 2) return { val, leakFallback: false };
    let total = 0; for (let i = 0; i < n; i++) total += docs[i].length;
    const frac = opts.frac || 0.02;
    const target = Math.max(frac * total, Math.min(opts.minChars || 6000, 0.15 * total));
    const order = []; for (let i = 0; i < n; i++) order.push(i);
    const key = (i) => { let h = Math.imul(i + 1, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return h >>> 0; };
    order.sort((a, b) => key(a) - key(b));
    // candidate pool: enough chars that dropping leaky docs still leaves the target
    const cand = []; let cc = 0;
    for (const i of order) { if (docs[i].length < 40) continue; cand.push(i); cc += docs[i].length; if (cc >= 6 * target) break; }
    if (!cand.length) { val[order[0]] = 1; return { val, leakFallback: true }; }
    const owner = new Map(); // gram -> candidate doc index, or -1 when shared by several docs
    const bad = new Uint8Array(n);
    const pre = new Uint8Array(1 << 22); // bit prefilter: most grams of non-candidate docs never reach the Map
    for (const i of cand) forEachGram(docs[i], (k, h) => {
      pre[h >>> 10] |= 1 << ((h >>> 7) & 7);
      const o = owner.get(k);
      if (o === undefined) owner.set(k, i); else if (o !== i) { owner.set(k, -1); }
    });
    for (let i = 0; i < n; i++) {
      forEachGram(docs[i], (k, h) => {
        if (!(pre[h >>> 10] & (1 << ((h >>> 7) & 7)))) return;
        const o = owner.get(k);
        if (o !== undefined && o !== i) { bad[i] = 1; if (o >= 0) bad[o] = 1; }
      });
    }
    let got = 0, any = false;
    for (const i of cand) { if (got >= target) break; if (!bad[i]) { val[i] = 1; got += docs[i].length; any = true; } }
    if (!any) { val[cand[0]] = 1; return { val, leakFallback: true }; }
    return { val, leakFallback: false };
  }

  let VAL_FLAGS;
  let leakFallback = false;
  if (!usingFallback && CORPUS && Array.isArray(CORPUS.val)) {
    VAL_FLAGS = new Uint8Array(DOCS.length); for (const i of CORPUS.val) if (i >= 0 && i < DOCS.length) VAL_FLAGS[i] = 1;
  } else { const sp = splitDocs(DOCS); VAL_FLAGS = sp.val; leakFallback = sp.leakFallback; }

  // ---------- vocab ----------
  const vocab = (CORPUS && typeof CORPUS.vocab === 'string' && CORPUS.vocab.length > 2) ? CORPUS.vocab : UNIVERSE;
  const V = vocab.length;
  const SPACE = Math.max(0, vocab.indexOf(' '));
  const CHAR2ID = new Int16Array(65536).fill(SPACE);
  for (let i = 0; i < V; i++) CHAR2ID[vocab.charCodeAt(i)] = i;

  function encode(str) {
    str = String(str);
    const out = new Int32Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = CHAR2ID[str.charCodeAt(i)];
    return out;
  }
  // Only true integer ids in [0,V) produce a character. Everything else (NaN, 1.5, null, true, [], strings, out of range) is skipped:
  // a plain `id >= 0 && id < V` accepts null / 1.5 / [] and then appends the text "undefined".
  function decode(ids) {
    let s = '';
    for (let i = 0; i < ids.length; i++) { const id = ids[i]; if (Number.isInteger(id) && id >= 0 && id < V) s += vocab[id]; }
    return s;
  }
  function encodeU8(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = CHAR2ID[str.charCodeAt(i)];
    return out;
  }

  // ---------- natural streams (built lazily, once) ----------
  let nat = null;
  function natural() {
    if (nat) return nat;
    const parts = { d: [], n: [], v: [] };
    let dlgDocs = 0, valDocs = 0, chars = 0;
    for (let i = 0; i < DOCS.length; i++) {
      chars += DOCS[i].length;
      if (VAL_FLAGS[i]) { parts.v.push(DOCS[i]); valDocs++; }
      else if (KINDS[i]) { parts.d.push(DOCS[i]); dlgDocs++; }
      else parts.n.push(DOCS[i]);
    }
    const dlgText = parts.d.join('\n\n'), narrText = parts.n.join('\n\n'), valText = parts.v.join('\n\n');
    const dlg = encodeU8(dlgText);
    // where a fresh conversation turn of the user begins ("Sen: ..."), so chat-shaped windows can start there
    const starts = [];
    for (let i = 0; i < dlgText.length; i++) if ((i === 0 || dlgText.charCodeAt(i - 1) === 10) && dlgText.startsWith('Sen: ', i)) starts.push(i);
    nat = {
      dlg, narr: encodeU8(narrText), val: encodeU8(valText), turnStarts: Int32Array.from(starts),
      chars, trainChars: dlgText.length + narrText.length, valChars: valText.length,
      docs: DOCS.length, dialogueDocs: KINDS.reduce((a, b) => a + b, 0), valDocs,
    };
    return nat;
  }

  // ---------- Limon.TRGen adapter ----------
  // Supported entry points (first match wins). A "chunk" is any string of Turkish text (one or more documents).
  //   TRGen.create(seed) -> { stream(minChars) -> string, doc(), paragraph(), qa(), sentence() }   (the documented gen.js API)
  //   TRGen.createStream(seed) -> { next(n?) -> string } | function () -> string
  //   TRGen.generate(nChars, seed) | TRGen.text(nChars, seed) | TRGen.sample(nChars, seed)   -> string | string[]
  //   TRGen.document(rng) | dialogue(rng) | conversation(rng) | paragraph(rng) | story(rng) | sentence(rng)
  // Returns null when no usable generator exists.
  function synthSource(seed) {
    const G = Limon.TRGen;
    if (!G) return null;
    const r = makeRng((seed == null ? 1 : seed) * 2654435761 + 977);
    const asText = (v) => (Array.isArray(v) ? v.join('\n\n') : String(v == null ? '' : v));
    try {
      if (typeof G.create === 'function') {
        const g = G.create(seed == null ? 1 : seed);
        if (g && typeof g.stream === 'function') return { next: () => asText(g.stream(1200)) };
        if (g && typeof g.doc === 'function') return { next: () => { let o = ''; while (o.length < 1000) o += asText(g.doc()) + '\n\n'; return o; } };
      }
      if (typeof G.createStream === 'function') {
        const st = G.createStream(seed == null ? 1 : seed);
        if (typeof st === 'function') return { next: () => asText(st()) };
        if (st && typeof st.next === 'function') return { next: () => asText(st.next(1200)) };
      }
      for (const name of ['generate', 'text', 'sample']) {
        if (typeof G[name] === 'function') {
          let k = (seed == null ? 1 : seed) * 1000003;
          const probe = asText(G[name](64, k));
          if (probe.length) return { next: () => asText(G[name](1200, ++k)) };
        }
      }
      const fns = [];
      for (const [name, w] of [['document', 3], ['dialogue', 3], ['conversation', 3], ['paragraph', 2], ['story', 2], ['sentence', 1]]) {
        if (typeof G[name] === 'function') fns.push([G[name].bind(G), w]);
      }
      if (fns.length) {
        const tw = fns.reduce((a, f) => a + f[1], 0);
        return {
          next: () => {
            let out = '';
            while (out.length < 1000) {
              let x = r() * tw, f = fns[0][0];
              for (const e of fns) { if ((x -= e[1]) < 0) { f = e[0]; break; } }
              out += asText(f(r)) + '\n\n';
            }
            return out;
          },
        };
      }
    } catch (e) { /* unusable generator → natural corpus only */ }
    return null;
  }
  // Fixed-length sample of generator text (for vocab / known words). '' when there is no generator.
  function synthText(nChars, seed) {
    const src = synthSource(seed); if (!src) return '';
    const parts = []; let n = 0, guard = 0;
    while (n < nChars && guard++ < 1e6) { const c = src.next(); if (!c) break; parts.push(c); n += c.length + 2; }
    return parts.join('\n\n');
  }

  // ---------- sampler ----------
  function createSampler(opts) {
    opts = opts || {};
    const B = opts.B || 32, T = opts.T || 128;
    const rnd = makeRng(opts.seed == null ? 1 : opts.seed);
    const D = natural();
    let synthShare = opts.synthShare == null ? 0.3 : opts.synthShare;
    const dialogueShare = opts.dialogueShare == null ? 0.35 : opts.dialogueShare;
    const turnStartShare = opts.turnStartShare == null ? 0.25 : opts.turnStartShare; // dialogue windows that start at a "Sen:" line
    const refresh = opts.refresh == null ? 0.25 : opts.refresh; // fraction of consumed synthetic text that is regenerated
    const poolChars = opts.poolChars || (1 << 20);
    const src = opts.noSynth ? null : synthSource(opts.seed == null ? 1 : opts.seed);
    const W = T + 1;

    // synthetic pool: generated up front, then a circular write pointer overwrites it a chunk at a time
    let pool = null, wp = 0, owed = 0, refreshed = 0;
    if (src) {
      pool = new Uint8Array(poolChars);
      let n = 0, guard = 0;
      while (n < poolChars && guard++ < 1e6) {
        const c = src.next(); if (!c) break;
        const ids = encodeU8(c + '\n\n'); const k = Math.min(ids.length, poolChars - n);
        pool.set(ids.subarray(0, k), n); n += k;
      }
      if (n < W + 1) pool = null; // generator produced nothing usable
      else if (n < poolChars) pool = pool.slice(0, n);
    }
    const hasSynth = !!pool;

    const st = { calls: 0, seqs: 0, synth: 0, dialogue: 0, narrative: 0, refreshedChars: 0 };
    function copyWindow(s, off, x, y, base) {
      const len = s.length;
      if (len >= W) {
        if (off + W > len) off = len - W;
        for (let i = 0; i < T; i++) { x[base + i] = s[off + i]; y[base + i] = s[off + i + 1]; }
      } else { // tiny stream: wrap around
        for (let i = 0; i < T; i++) { x[base + i] = s[(off + i) % len]; y[base + i] = s[(off + i + 1) % len]; }
      }
    }
    function pickNatural(x, y, base) {
      const haveD = D.dlg.length > 0, haveN = D.narr.length > 0;
      let useD = haveD && (!haveN || rnd() < dialogueShare);
      let s = useD ? D.dlg : D.narr;
      if (!s.length) s = D.val.length ? D.val : pool || new Uint8Array([SPACE, SPACE]); // no training text at all
      let off;
      if (useD && D.turnStarts.length && rnd() < turnStartShare) off = D.turnStarts[(rnd() * D.turnStarts.length) | 0];
      else off = (rnd() * Math.max(1, s.length - W + 1)) | 0;
      copyWindow(s, off, x, y, base);
      if (useD) st.dialogue++; else st.narrative++;
    }
    function next(x, y) {
      const n = B * T;
      if (x.length < n || y.length < n) throw new Error('sampler.next: buffers must hold B*T = ' + n + ' entries');
      let synthN = 0;
      for (let b = 0; b < B; b++) {
        const base = b * T;
        if (hasSynth && rnd() < synthShare) {
          copyWindow(pool, (rnd() * Math.max(1, pool.length - W + 1)) | 0, x, y, base); synthN++;
        } else pickNatural(x, y, base);
      }
      st.calls++; st.seqs += B; st.synth += synthN;
      if (hasSynth && synthN) { // regenerate part of the pool: at most one chunk per call so the cost stays flat
        owed = Math.min(owed + synthN * T * refresh, 16384);
        if (owed >= 1024) {
          const c = src.next();
          if (c) {
            const ids = encodeU8(c + '\n\n'); const k = Math.min(ids.length, pool.length);
            if (wp + k > pool.length) wp = 0;
            pool.set(ids.subarray(0, k), wp); wp += k; owed -= k; refreshed += k;
          } else owed = 0;
        }
      }
    }
    return {
      next,
      setSynthShare(p) { synthShare = Math.max(0, Math.min(1, +p || 0)); },
      stats() {
        const nat = st.dialogue + st.narrative;
        return {
          B, T, calls: st.calls, seqs: st.seqs, synthSeqs: st.synth, dialogueSeqs: st.dialogue, narrativeSeqs: st.narrative,
          synthShareTarget: synthShare, synthShareActual: st.seqs ? st.synth / st.seqs : 0,
          dialogueShareActual: nat ? st.dialogue / nat : 0, hasSynth, poolChars: pool ? pool.length : 0, poolRefreshedChars: refreshed,
        };
      },
    };
  }

  // Fixed held-out batch from validation documents (never used by the sampler). Same call -> same batch.
  // Windows are spread over the whole validation text. When B*T is larger than the validation text (about 18K characters with the
  // shipped corpus; the SPEC ceiling B*T = 16384 still fits) windows cannot be disjoint any more: they are then spaced evenly
  // (span/B apart) and overlap their neighbours by the same amount, instead of wrapping around onto identical text.
  const valCache = new Map();
  function valBatch(B, T) {
    const key = B + 'x' + T;
    if (valCache.has(key)) { const c = valCache.get(key); return { x: c.x.slice(), y: c.y.slice() }; }
    const D = natural(); const s = D.val.length ? D.val : D.narr.length ? D.narr : D.dlg;
    const x = new Int32Array(B * T), y = new Int32Array(B * T), len = s.length, W = T + 1;
    const span = Math.max(1, len - W + 1);
    const stride = Math.max(T, Math.floor(span / B));
    for (let b = 0; b < B; b++) {
      const off = stride * B <= span ? b * stride : Math.floor(b * span / B);
      for (let i = 0; i < T; i++) { x[b * T + i] = s[(off + i) % len]; y[b * T + i] = s[(off + i + 1) % len]; }
    }
    valCache.set(key, { x, y });
    return { x: x.slice(), y: y.slice() };
  }

  // ---------- words / score ----------
  // Words are runs of letters, so "Ayşe'nin" is the two words "ayşe" + "nin". Suffix pieces such as "nin", "ya", "nü" therefore
  // stay in the known set on purpose: the UI paints words with the same split (app.js wordsHtml) and must not flag them as invented.
  const WORD_RE = /\p{L}+/gu;
  // Not-a-word filter for the known set. The persona texts quote the newborn's babble ("qJ,;ğ(Xn", "aeaeaanlarn") and a user types
  // keyboard mash ("asdfghj"); none of that may count as Turkish. Real Turkish words have a vowel and never 5 consonants / 4 vowels
  // in a row (longest real runs in the corpus: "enstrüman" nstr = 4, "eee"/"üüü" = 3). Vowel-less interjections are listed.
  const NO_VOWEL_OK = new Set(['hmm', 'mmm', 'pst', 'şşt', 'şt']);
  function isJunkWord(w) {
    if (w.length < 2) return false; // single letters are never judged (turkishScore, app.js wordsHtml skip them)
    if (!/[aeıioöuü]/.test(w)) return !NO_VOWEL_OK.has(w);
    return /[^aeıioöuü]{5}|[aeıioöuü]{4}/.test(w);
  }
  let known = null, synthSampleChars = 0;
  function buildKnown() {
    const set = new Set();
    const add = (text) => { const m = lowerTR(text).match(WORD_RE); if (m) for (const w of m) if (!set.has(w) && !isJunkWord(w)) set.add(w); };
    for (const d of DOCS) add(d);
    const sample = synthText(opts_knownSample, 4242);
    synthSampleChars = sample.length;
    if (sample) add(sample);
    return set;
  }
  const opts_knownSample = 400000;

  // turkishScore(text, opts?) -> { words, known, ratio, skipped }
  //   words   number of judged words (letter runs of >= 2 characters; single letters are always "known" by chance, so they are skipped)
  //   skipped words left out of the judgement (single letters, cut-off fragments), so words === 0 && skipped === 0 means "no word at all"
  //   opts.start  'boundary' (default): the text begins at a word start (a trimmed reply, a prompt continuation): first word counts.
  //               'cut': the text may begin inside a word: the first word is skipped when the text starts with a letter.
  //   opts.end    'auto' (default): when the text ends with a letter that last word may be a truncated fragment: it counts if it is a
  //               known word and is skipped otherwise, so a cut-off tail is never held against the text (and a one-word reply such as
  //               "Tamam" still scores). 'complete': the last word counts like every other (generation ended by itself).
  //               'cut': generation was cut off by a length limit: the last word is skipped when the text ends with a letter.
  function turkishScore(text, opts) {
    text = String(text);
    const start = opts && opts.start === 'cut' ? 'cut' : 'boundary';
    const end = opts && (opts.end === 'complete' || opts.end === 'cut') ? opts.end : 'auto';
    const ws = lowerTR(text).match(WORD_RE);
    if (!ws) return { words: 0, known: 0, ratio: 0, skipped: 0 };
    const set = Data.knownWords;
    const dropFirst = start === 'cut' && /^\p{L}/u.test(text);
    const tail = /\p{L}$/u.test(text);
    let words = 0, kn = 0, skipped = 0;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (w.length < 2 || (i === 0 && dropFirst)) { skipped++; continue; }
      const isKnown = set.has(w);
      if (i === ws.length - 1 && tail && (end === 'cut' || (end === 'auto' && !isKnown))) { skipped++; continue; }
      words++; if (isKnown) kn++;
    }
    return { words, known: kn, ratio: words ? kn / words : 0, skipped };
  }

  // ---------- chat prompt ----------
  const oneLine = (s) => normalize(String(s == null ? '' : s)).replace(/\n+/g, ' ').replace(/ +/g, ' ').trim();
  // Format: "Sen: ...\nLimon: ...\n" turns, then "Sen: <userText>\nLimon:". `maxChars` (default: no limit) drops the oldest turns
  // first (never leaving a prompt that starts with a Limon turn) and finally cuts the user's text from the left.
  function chatPrompt(history, userText, maxChars) {
    const turns = [];
    for (const h of history || []) {
      const t = oneLine(h && h.text); if (!t) continue;
      turns.push((h.who === 'Limon' ? 'Limon: ' : 'Sen: ') + t + '\n');
    }
    let u = oneLine(userText);
    const tail = '\nLimon:';
    const lim = maxChars > 0 ? maxChars : Infinity;
    let total = turns.reduce((a, t) => a + t.length, 0);
    let first = 0;
    const size = () => total + 5 + u.length + tail.length;
    while (first < turns.length && size() > lim) { total -= turns[first].length; first++; }
    while (first < turns.length && turns[first].startsWith('Limon:')) { total -= turns[first].length; first++; }
    if (size() > lim) { const keep = Math.max(0, lim - 5 - tail.length); u = keep > 0 ? u.slice(u.length - keep).replace(/^ +/, '') : ''; }
    return turns.slice(first).join('') + 'Sen: ' + u + tail;
  }

  // ---------- random snippet ----------
  let allText = null;
  // 100-200 characters of corpus text for the brain's "reading" mode, from a word start, ending at a word end. It stays inside one
  // document: when the document ends before the window does, the snippet is cut at that break (or, if the break is closer than
  // SNIP_MIN characters, the snippet starts at the beginning of that document instead). Only documents shorter than SNIP_MIN characters
  // can spill into the next one. Length is therefore 100-200 except for the tail of short documents (>= SNIP_MIN).
  const SNIP_MIN = 40;
  function randomSnippet(rng) {
    rng = rng || Math.random;
    if (!allText) allText = DOCS.join('\n\n');
    const t = allText, n = t.length;
    const want = 100 + Math.floor(rng() * 101);
    let s = Math.floor(rng() * Math.max(1, n - want));
    // start on a word boundary
    if (s > 0 && /\S/.test(t[s - 1]) && /\S/.test(t[s])) { const j = t.indexOf(' ', s); if (j > 0 && j - s < 30) s = j + 1; }
    while (s < n - 1 && /\s/.test(t[s])) s++;
    let brk = t.indexOf('\n\n', s);
    if (brk >= 0 && brk - s < SNIP_MIN) { // too little of this document left: read it from its start
      const p = t.lastIndexOf('\n\n', s);
      s = p < 0 ? 0 : p + 2;
      brk = t.indexOf('\n\n', s);
    }
    let e = Math.min(n, s + want);
    if (brk >= 0 && brk < e && brk - s >= SNIP_MIN) e = brk;
    if (e < n && /\S/.test(t[e - 1]) && /\S/.test(t[e])) { // do not stop inside a word
      const j = Math.max(t.lastIndexOf(' ', e), t.lastIndexOf('\n', e));
      if (j - s >= SNIP_MIN) e = j;
    }
    return t.slice(s, e).replace(/\s+$/, '');
  }

  // synthSource() builds a generator instance, so `info` (read on every UI refresh) must not do it each time.
  let trgenSeen, trgenOk = false;
  function hasTRGen() {
    if (trgenSeen !== Limon.TRGen) { trgenSeen = Limon.TRGen; trgenOk = !!synthSource(1); }
    return trgenOk;
  }

  // ---------- public object ----------
  const Data = {
    vocab, V, encode, decode, createSampler, valBatch, chatPrompt, turkishScore, randomSnippet,
    normalize, universe: UNIVERSE, synthText, synthSource, splitDocs, fallbackDocs: FALLBACK_DOCS,
  };
  Object.defineProperty(Data, 'knownWords', { enumerable: true, get() { return known || (known = buildKnown()); } });
  Object.defineProperty(Data, 'info', {
    enumerable: true,
    get() {
      const D = natural();
      return {
        naturalChars: D.chars, trainChars: D.trainChars, valChars: D.valChars, docs: D.docs, dialogueDocs: D.dialogueDocs, valDocs: D.valDocs,
        vocabSize: V, fallback: usingFallback, leakFallback, hasTRGen: hasTRGen(),
        synthSampleChars, knownWords: known ? known.size : null, build: CORPUS && CORPUS.stats ? CORPUS.stats : null,
      };
    },
  });
  Limon.Data = Data;
  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
