// Limon build: src/* + corpus -> single-file index.html   (zero dependencies, Node >= 18)
//
//   node build.mjs [--out index.html] [--report] [--strict] [--quiet] [--corpus-dir src/corpus] [--gen-out src/corpus.gen.js] [--template path] [--scripts layout.js,data.js,...] [--gen path/to/gen.js]
//
// 1. reads src/corpus/*.txt (regular files only), normalises them with Limon.Data.normalize (SPEC 5), reports characters that are still
//    not allowed (with the line number in the RAW file), drops exact duplicate documents;
// 2. computes the vocab (fixed order, characters seen in the corpus or in TRGen samples of several seeds), the held-out documents
//    (leak-cleaned) and writes src/corpus.gen.js  (Limon.CORPUS = {...});
// 3. inlines CSS + scripts into src/template.html (placeholders <!--LIMON:STYLE--> / <!--LIMON:SCRIPTS-->) -> one HTML file.
// Missing inputs never abort a normal build: they are skipped with a warning (an empty corpus falls back to a tiny built-in text).
//
// --strict is the release gate. It exits 1, WITHOUT writing any output file (a stale but complete index.html is better than a fresh
// incomplete one), when the corpus holds disallowed characters, or when the generator is not fully there: src/gen.js missing / failing
// to load, Limon.TRGen producing no text, or TRGen emitting characters outside the SPEC 5 universe.
// --gen <file> loads that generator instead of src/gen.js (test hook: lets dev/data/test.mjs build with a mock generator).
// The vocab holds only characters the data really contains; SPEC characters that never occur are listed in the report ("vocab disinda")
// and encode() maps them to a space (SPEC 4.1).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

export const ROOT = dirname(fileURLToPath(import.meta.url));
const SCRIPT_ORDER = ['layout.js', 'corpus.gen.js', 'gen.js', 'data.js', 'cpu_model.js', 'gpu_engine.js', 'brain3d.js', 'app.js'];
// TRGen text scanned for the vocab: [seed, chars]. Several seeds, because the runtime uses other seeds than the build.
const VOCAB_SAMPLES = [[91, 1200000], [17, 300000], [4242, 300000], [20260929, 300000]];

const warnings = [];
let quiet = false;
function warn(msg) { warnings.push(msg); if (!quiet) console.warn('UYARI: ' + msg); }
function info(msg) { if (!quiet) console.log(msg); }
const rel = (p) => relative(ROOT, p) || '.';

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp-' + process.pid;
  writeFileSync(tmp, text);
  renameSync(tmp, path); // concurrent builds by other agents never see half a file
}
function safeOutPath(p) {
  const abs = resolve(p);
  const okRoot = abs === ROOT || abs.startsWith(ROOT + sep);
  const okTmp = [tmpdir(), '/tmp', '/private/tmp'].some((t) => abs.startsWith(t + sep));
  if (!okRoot && !okTmp) throw new Error('Cikti yolu proje klasorunun disinda: ' + abs);
  return abs;
}

// Fresh isolated context holding layout.js + gen.js + data.js (no corpus): source of normalize / splitDocs / TRGen sample.
// `gen` describes what happened to the generator so that --strict can refuse an incomplete build.
function loadSandbox(genPath) {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
  const gen = { path: genPath || join(ROOT, 'src', 'gen.js'), problems: [] };
  const files = [['layout.js', join(ROOT, 'src', 'layout.js')], ['gen.js', gen.path], ['data.js', join(ROOT, 'src', 'data.js')]];
  for (const [f, p] of files) {
    if (!existsSync(p)) {
      if (f !== 'gen.js') warn(f + ' yok'); else gen.problems.push(rel(p) + ' yok');
      continue;
    }
    try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: p }); }
    catch (e) { warn(f + ' yuklenemedi: ' + (e && e.message)); if (f === 'gen.js') gen.problems.push('gen.js yuklenemedi: ' + (e && e.message)); }
  }
  if (!vm.runInContext('!!(globalThis.Limon && Limon.Data)', ctx)) throw new Error('src/data.js yuklenemedi');
  return { ctx, gen };
}

const vis = (ch) => (ch === '\n' ? '\\n' : ch === ' ' ? '<bosluk>' : ch);
const cp = (ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

// Raw-file line numbers of the characters that stay disallowed after normalisation (the normalised text has collapsed blank
// lines, so its line numbers would be wrong). One entry per distinct character per line.
function locateBad(Data, raw, name) {
  const out = [];
  raw.split(/\r\n|\r|\n/).forEach((ln, i) => {
    const bad = new Map();
    Data.normalize(ln, { keepBad: true, bad });
    for (const ch of bad.keys()) out.push({ file: name, line: i + 1, ch });
  });
  return out;
}

// ---- corpus -> documents ----
export function buildCorpus({ corpusDir = join(ROOT, 'src', 'corpus'), genPath = null } = {}) {
  const { ctx, gen } = loadSandbox(genPath);
  const Data = ctx.Limon.Data;
  // problems: reasons for which --strict refuses the build
  const rep = { files: [], replaced: new Map(), bad: [], badTotal: new Map(), dupDocs: 0, fallback: false, problems: [...gen.problems], vocabMissing: '' };
  const docs = [], kinds = [];
  const seen = new Set();
  let names = [];
  if (existsSync(corpusDir)) names = readdirSync(corpusDir).filter((f) => f.endsWith('.txt')).sort();
  else warn('korpus klasoru yok: ' + rel(corpusDir));
  for (const name of names) {
    const path = join(corpusDir, name);
    let raw;
    try {
      if (!statSync(path).isFile()) { warn('korpus: dosya degil, atlandi: ' + name); continue; }
      raw = readFileSync(path, 'utf8');
    } catch (e) { warn('korpus: okunamadi, atlandi: ' + name + ' (' + (e && e.code || e && e.message) + ')'); continue; }
    const stats = new Map(), badMap = new Map();
    const text = Data.normalize(raw, { keepBad: true, stats, bad: badMap });
    for (const [c, n] of stats) rep.replaced.set(c, (rep.replaced.get(c) || 0) + n);
    if (badMap.size) {
      for (const b of locateBad(Data, raw, name)) rep.bad.push(b); // (no spread: a file full of bad characters would overflow the argument list)
      for (const [c, n] of badMap) rep.badTotal.set(c, (rep.badTotal.get(c) || 0) + n);
    }
    const clean = badMap.size ? Data.normalize(text) : text;
    const fdocs = clean.split(/\n\n+/).map((d) => d.trim()).filter(Boolean);
    let kept = 0, dlg = 0, chars = 0;
    for (const d of fdocs) {
      if (seen.has(d)) { rep.dupDocs++; continue; }
      seen.add(d);
      const isD = /(^|\n)(Sen|Limon): /.test(d);
      docs.push(d); kinds.push(isD ? 'd' : 'n'); kept++; chars += d.length; if (isD) dlg++;
    }
    rep.files.push({ name, bytes: Buffer.byteLength(raw), chars, docs: kept, dialogueDocs: dlg });
  }
  if (rep.badTotal.size) {
    const list = [...rep.badTotal].map(([c, n]) => `${vis(c)} ${cp(c)} x${n}`).join(', ');
    warn('izinsiz karakterler (bosluga cevrildi): ' + list);
    rep.problems.push('korpusta izinsiz karakter var (' + rep.badTotal.size + ' tur): ' + list);
  }
  if (!docs.length) {
    warn('korpus bos veya yok; kucuk yedek metin kullaniliyor');
    rep.fallback = true;
    for (const d of Data.fallbackDocs) { docs.push(d); kinds.push(/(^|\n)(Sen|Limon): /.test(d) ? 'd' : 'n'); }
  }
  if (rep.dupDocs) info(`bilgi: ${rep.dupDocs} yinelenen belge atildi`);

  // vocab = fixed order filter over characters seen in corpus or TRGen samples
  const seenCh = new Set(['\n', ' ']);
  for (const d of docs) for (const ch of d) seenCh.add(ch);
  let synthChars = 0;
  const outside = new Map();
  for (const [seed, want] of VOCAB_SAMPLES) {
    let sample = '';
    try { sample = ctx.Limon.Data.synthText(want, seed); }
    catch (e) { warn('TRGen ornegi alinamadi: ' + (e && e.message)); rep.problems.push('TRGen ornegi alinamadi: ' + (e && e.message)); break; }
    if (!sample.length) {
      warn('Limon.TRGen yok/bos: vocab yalnizca korpustan');
      rep.problems.push('Limon.TRGen metin uretmiyor (gen.js eksik, yarim veya API yok)');
      break;
    }
    if (sample.length < want) warn(`TRGen ornegi beklenenden kisa (tohum ${seed}): ${sample.length} < ${want}`);
    synthChars += sample.length;
    for (const ch of sample) { seenCh.add(ch); if (!Data.universe.includes(ch)) outside.set(ch, (outside.get(ch) || 0) + 1); }
  }
  if (outside.size) {
    const list = [...outside].map(([c, n]) => `${vis(c)} ${cp(c)} x${n}`).join(', ');
    warn('TRGen izinsiz karakter uretiyor: ' + list);
    rep.problems.push('TRGen izinsiz karakter uretiyor: ' + list);
  }
  let vocab = '';
  for (const ch of Data.universe) if (seenCh.has(ch)) vocab += ch;
  for (const ch of Data.universe) if (!seenCh.has(ch)) rep.vocabMissing += ch;

  const split = Data.splitDocs(docs.map((d) => d));
  const val = [];
  for (let i = 0; i < docs.length; i++) if (split.val[i]) val.push(i);
  if (split.leakFallback) warn('dogrulama belgesi egitim belgeleriyle 32-karakter n-gram paylasiyor (kacinilmaz)');

  let chars = 0; for (const d of docs) chars += d.length;
  const stats = {
    files: rep.files.length, docs: docs.length, dialogueDocs: kinds.filter((k) => k === 'd').length, chars,
    valDocs: val.length, valChars: val.reduce((a, i) => a + docs[i].length, 0), vocabSize: vocab.length,
    synthVocabSampleChars: synthChars, fallback: rep.fallback,
  };
  const corpus = { version: 1, vocab, docs, kinds: kinds.join(''), val, files: rep.files.map((f) => ({ name: f.name, chars: f.chars, docs: f.docs })), stats };
  return { corpus, rep, ctx };
}

// Safe inside <script>: '</' and '<!--' are escaped, U+2028/2029 too.
function jsLiteral(v) {
  return JSON.stringify(v).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
}
export function corpusGenSource(corpus) {
  const c = corpus;
  return `// AUTO-GENERATED by build.mjs - do not edit. Limon.CORPUS = { version, vocab, docs[], kinds ('d'/'n' per doc), val[] (held-out doc indices), files[], stats }
(function (root) {
  const Limon = (root.Limon = root.Limon || {});
  Limon.CORPUS = {
    version: ${c.version},
    vocab: ${jsLiteral(c.vocab)},
    kinds: ${jsLiteral(c.kinds)},
    val: ${jsLiteral(c.val)},
    files: ${jsLiteral(c.files)},
    stats: ${jsLiteral(c.stats)},
    docs: ${jsLiteral(c.docs)}
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

// ---- HTML assembly ----
function safeInline(text, closing, name) {
  const re = new RegExp('</(' + closing + ')', 'gi');
  if (re.test(text)) { warn(`${name}: '</${closing}' icerigi kacirildi`); return text.replace(new RegExp('</(' + closing + ')', 'gi'), '<\\/$1'); }
  return text;
}
export function assembleHtml({ genSource, templatePath, only }) {
  const S = 'STYLE', SC = 'SCRIPTS';
  let tpl = null, tplName = 'src/template.html';
  const tp = templatePath || join(ROOT, 'src', 'template.html');
  if (templatePath) tplName = rel(templatePath);
  if (existsSync(tp)) {
    const t = readFileSync(tp, 'utf8');
    if (t.includes(`<!--LIMON:${S}-->`) && t.includes(`<!--LIMON:${SC}-->`)) tpl = t;
    else warn('src/template.html yer tutucusuz: gecici iskelet kullaniliyor');
  } else warn('src/template.html yok: gecici iskelet kullaniliyor');
  if (!tpl) { tpl = readFileSync(join(ROOT, 'dev', 'data', 'template.min.html'), 'utf8'); tplName = 'dev/data/template.min.html'; }

  let css = '';
  const cp_ = join(ROOT, 'src', 'style.css');
  if (existsSync(cp_)) css = safeInline(readFileSync(cp_, 'utf8'), 'style', 'style.css'); else warn('src/style.css yok');
  const styleTag = css ? `<style>\n${css}\n</style>` : '';

  const scripts = [];
  const used = [];
  for (const f of SCRIPT_ORDER) {
    if (only && !only.includes(f)) continue;
    let text;
    if (f === 'corpus.gen.js') text = genSource;
    else {
      const p = join(ROOT, 'src', f);
      if (!existsSync(p)) { warn(`src/${f} yok, atlandi`); continue; }
      text = readFileSync(p, 'utf8');
    }
    text = safeInline(text, 'script', f);
    scripts.push(`<script>\n/* ---- ${f} ---- */\n${text}\n</script>`);
    used.push(f);
  }
  const splice = (html, marker, content) => { const i = html.indexOf(marker); return html.slice(0, i) + content + html.slice(i + marker.length); };
  let html = splice(tpl, `<!--LIMON:${S}-->`, styleTag);
  html = splice(html, `<!--LIMON:${SC}-->`, scripts.join('\n'));
  return { html, used, tplName };
}

// ---- report ----
function printReport(corpus, rep) {
  const L = [];
  L.push('=== KORPUS RAPORU ===');
  L.push('dosya'.padEnd(28) + 'bayt'.padStart(10) + 'karakter'.padStart(10) + 'belge'.padStart(8) + 'diyalog'.padStart(9));
  for (const f of rep.files) L.push(f.name.padEnd(28) + String(f.bytes).padStart(10) + String(f.chars).padStart(10) + String(f.docs).padStart(8) + String(f.dialogueDocs).padStart(9));
  const st = corpus.stats;
  L.push(`toplam: ${st.chars} karakter, ${st.docs} belge (${st.dialogueDocs} diyalog), dogrulama: ${st.valDocs} belge / ${st.valChars} karakter, yinelenen atilan: ${rep.dupDocs}`);
  L.push(`vocab (${corpus.vocab.length}): ${JSON.stringify(corpus.vocab)}`);
  const freq = new Map(); for (const d of corpus.docs) for (const ch of d) freq.set(ch, (freq.get(ch) || 0) + 1);
  // documents are joined by a blank line in the stream
  freq.set('\n', (freq.get('\n') || 0) + 2 * Math.max(0, corpus.docs.length - 1));
  const tot = [...freq.values()].reduce((a, b) => a + b, 0);
  L.push('--- karakter siklik tablosu (vocab sirasi) ---');
  const row = [];
  for (const ch of corpus.vocab) { const n = freq.get(ch) || 0; row.push(`${vis(ch)}:${n} (${(100 * n / Math.max(1, tot)).toFixed(2)}%)`); }
  for (let i = 0; i < row.length; i += 6) L.push('  ' + row.slice(i, i + 6).map((s) => s.padEnd(20)).join(''));
  const unseen = [...freq.keys()].filter((c) => !corpus.vocab.includes(c));
  if (unseen.length) L.push('vocab disinda: ' + unseen.map(vis).join(' '));
  if (rep.vocabMissing) L.push(`SPEC karakter kumesinden vocab'a girmeyenler (veride hic yok, encode bosluga cevirir): ${JSON.stringify(rep.vocabMissing)}`);
  if (rep.replaced.size) L.push('otomatik duzeltilen karakterler: ' + [...rep.replaced].map(([c, n]) => `${vis(c)} ${cp(c)} x${n}`).join(', '));
  if (rep.bad.length) { L.push('izinsiz karakterler (dosya:satir, ham dosyadaki satir numarasi):'); for (const b of rep.bad.slice(0, 40)) L.push(`  ${b.file}:${b.line} ${vis(b.ch)} ${cp(b.ch)}`); if (rep.bad.length > 40) L.push(`  ... ${rep.bad.length - 40} tane daha`); }
  console.log(L.join('\n'));
}

// ---- main ----
async function main() {
  const a = process.argv.slice(2);
  const flag = (k) => a.includes('--' + k);
  const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 && a[i + 1] !== undefined ? a[i + 1] : d; };
  quiet = flag('quiet');
  const out = safeOutPath(opt('out', join(ROOT, 'index.html')));
  const genOut = safeOutPath(opt('gen-out', join(ROOT, 'src', 'corpus.gen.js')));
  const corpusDir = resolve(opt('corpus-dir', join(ROOT, 'src', 'corpus')));
  const t0 = Date.now();

  const { corpus, rep } = buildCorpus({ corpusDir, genPath: opt('gen') ? resolve(opt('gen')) : null });
  if (flag('report')) printReport(corpus, rep);
  if (flag('strict') && rep.problems.length) {
    console.error('--strict: yapi yazilmadi, ' + rep.problems.length + ' sorun:');
    for (const m of rep.problems) console.error('  - ' + m);
    process.exit(1);
  }
  if (rep.vocabMissing && !flag('report')) info(`bilgi: SPEC karakterlerinden vocab'da olmayanlar (veride yok, bosluk olarak kodlanir): ${JSON.stringify(rep.vocabMissing)}`);
  const genSource = corpusGenSource(corpus);
  writeAtomic(genOut, genSource);
  const { html, used, tplName } = assembleHtml({ genSource, templatePath: opt('template') ? resolve(opt('template')) : null, only: opt('scripts') ? opt('scripts').split(',') : null });
  writeAtomic(out, html);
  info(`${rel(out)}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB | sablon: ${tplName} | betikler: ${used.join(', ')}`);
  info(`korpus: ${corpus.stats.chars} karakter, ${corpus.stats.docs} belge, vocab ${corpus.vocab.length}, dogrulama ${corpus.stats.valDocs} belge | ${Date.now() - t0} ms | ${warnings.length} uyari`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('build hatasi: ' + (e && e.stack || e)); process.exit(2); });
}
