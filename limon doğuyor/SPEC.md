# LİMON — proje sözleşmesi (SPEC)

Bu dosya, birlikte çalışan bütün ajanların uyduğu tek doğru kaynaktır. Başka bir şey varsayma; burada yazmıyorsa
kendi modülünün içinde karar ver ve dosyanın başına belgele.

## 0. Ne yapıyoruz

Kullanıcı `index.html`'i tarayıcıda açar. **Limon** adında, hiçbir hazır model/kütüphane/dosya kullanmadan
**sıfırdan** bir dil modeli o sekmede *gözünün önünde doğar*:

1. Doğduğunda ağırlıkları rastgeledir → **saçmalar** (`qJ,;ğ(Xn..`).
2. Model **kullanıcının GPU'sunda (WebGL2)** canlı eğitilir; birkaç dakikada harfleri, kelimeleri, cümleleri,
   sonunda **Türkçe konuşmayı** öğrenir. Ekranda kayıp (loss), örnek konuşmalar ve "Türkçe skoru" akar.
3. Modelin **beyni 3 boyutlu** görünür: gerçek nöronlar, gerçek sinaps (ağırlık) bağlantıları, gerçek aktivasyonlar,
   öğrenirken parlayan sinapslar, harf takımyıldızı (embedding'lerin 3B uzayı), dikkat (attention).
4. Kullanıcı Limon'a yazıp sohbet edebilir (eğitim sürerken bile).
5. Arayüz **Türkçe**.

**Kesin kısıtlar:** hazır model yok; hazır kütüphane yok (three.js, tf.js, vs. YOK); kullanıcının bilgisayarındaki
hiçbir dosya çalışma zamanında okunmaz (fetch/XHR ile dosya yok, harici URL yok, CDN yok, harici font yok);
eğitim verisi tamamen bu projede **bizim yazdığımız** metinden ve **bizim yazdığımız** Türkçe cümle üretecinden gelir.
Başka yapay zekâ modeli/servisi (codex, gemini, görsel/ses üretimi vb.) KULLANMA.
Sonuç `index.html` çift tıklanınca (file://) çalışmalı.

## 1. Ortam ve çalışma kuralları

- Çalışma klasörü: `/Users/avenox/Desktop/sonnet/limon doğuyor` (yolda boşluk ve `ğ` var — tırnakla). **Bu klasörün dışına dosya yazma**
  (geçici Chrome profilleri için `/tmp` serbest; `dev/cdp.mjs` bunu kendi yapar). Kullanıcının diğer dosyalarını okuma.
- Node v22 var (`node`), Python3 var. Zero-dependency çalış (npm install yok).
- **Klasik `<script>`** kullan; ES module (`type=module`) YOK (file:// altında CORS'a takılır). Worker gerekiyorsa
  `Blob` URL ile (file:// altında `new Worker('x.js')` çalışmaz). `SharedArrayBuffer` YOK (cross-origin isolation yok).
- Her kaynak dosya `window.Limon` ad alanına kayıt olan bir IIFE'dir ve **Node'da da yüklenebilir**:
  ```js
  (function (root) { const Limon = (root.Limon = root.Limon || {}); /* ... */
    if (typeof module !== 'undefined' && module.exports) module.exports = Limon; })(typeof window !== 'undefined' ? window : globalThis);
  ```
  (GPU/DOM'a dokunan dosyalar Node'da yüklenebilir ama çalıştırılamaz; sadece `require` patlamamalı.)
- Makine: Apple M5, 10 çekirdek, paylaşımlı — başka ağır işler de çalışıyor. Aynı anda **en fazla 1 headless Chrome** aç, işin bitince kapat
  (`dev/cdp.mjs` `b.close()` yapar). Uzun komutları `perl -e 'alarm shift; exec @ARGV' <sn> komut...` ile sar. 3 dakikadan uzun süren komutu arka planda çalıştır.
- Test sürücüsü: `dev/cdp.mjs` (gerçek zamanlı, sanal zaman yok). Kullanım örneği: `dev/run-probe.mjs`. Ekran görüntüsünü `Read` aracıyla açıp **gözünle** incele.
  WebGL2 gerçek GPU'da çalışır (ANGLE Metal, M5, `EXT_color_buffer_float` var, MAX_TEXTURE_SIZE 16384, pass başı ~12–25 µs, matmul yüzlerce GFLOPS–TFLOPS).
- Dosya silerken joker/değişken kullanma, tam yol yaz. Kendi test dosyalarını `dev/<modül>/` altına koy.
- Kod stili: sade, okunaklı, yorumlar yalnızca "neden"i açıklar. Türkçe kullanıcı metinleri doğru Türkçe (ı/İ, ğ, ş, ç, ö, ü).

## 2. Dosya düzeni ve sahiplik

```
index.html            BUILD ÇIKTISI (tek dosya, kendi kendine yeten). Sadece `node build.mjs` üretir.
build.mjs             src/* + korpus → index.html (sahibi: data ajanı)
SPEC.md               bu dosya
src/layout.js         Limon.Util, Limon.CONFIG, Limon.Layout        (YAZILDI, dokunma; hata bulursan raporla)
src/gen.js            Limon.TRGen  Türkçe cümle üreteci             (sahibi: gen ajanı)
src/data.js           Limon.Data   tokenizer, örnekleyici, skor      (sahibi: data ajanı)
src/cpu_model.js      Limon.CPUModel  Float32 çıkarım + iz (trace)   (sahibi: cpu ajanı)
src/cpu_ref.js        Limon.CPURef  Float64 referans ileri/geri      (sahibi: cpu ajanı; SADECE test, build'e girmez)
src/gpu_engine.js     Limon.GPU.Trainer  WebGL2 eğitim motoru       (sahibi: gpu ajanı)
src/brain3d.js        Limon.Brain  ham WebGL2 3B beyin               (sahibi: brain ajanı)
src/app.js            uygulama, eğitim döngüsü, arayüz mantığı       (sahibi: ui ajanı)
src/style.css         stil                                          (sahibi: ui ajanı)
src/template.html     HTML iskeleti (yer tutucular aşağıda)          (sahibi: ui ajanı)
src/corpus/*.txt      doğal Türkçe eğitim metni (UTF-8)              (sahibi: korpus ajanları, dosya başına bir sahip)
dev/                  test/harness (herkes kendi alt klasöründe)
```
Build çıktısı için geçici dosya: `node build.mjs --out dev/<isim>/build.html` (ajanlar `index.html`'e YAZMAZ).
`template.html` iki yer tutucu içerir: `<!--LIMON:STYLE-->` (CSS `<style>` olarak buraya) ve `<!--LIMON:SCRIPTS-->` (betikler buraya).
Betik sırası (build sabitler): `layout.js`, `corpus.gen.js` (build'in ürettiği), `gen.js`, `data.js`, `cpu_model.js`, `gpu_engine.js`, `brain3d.js`, `app.js`. Eksik dosya atlanır (uyarı verir).

## 3. Model (Limon-1) — matematiksel tanım (CPU ve GPU AYNEN bunu uygular)

Karakter düzeyinde, decoder-only, pre-LayerNorm Transformer. Bağlam T karakter. Girdi kimlikleri `x[n]`, hedefler `y[n]` (bir sonraki karakter),
`N = B*T`, pozisyon `t = n mod T`. Sekanslar birbirinden bağımsızdır (dikkat yalnızca kendi sekansı içinde, nedensel).

```
h  = tok[x[n]] + pos[t]                                   [N,D]
her katman l için:
  a   = LN(h; l.ln1.g, l.ln1.b)                            (satır başına D üzerinde; eps=1e-5; biased varyans)
  qkv = a @ l.qkv.w + l.qkv.b                              [N,3D]  = [Q|K|V]
  her head i, DH=D/H:  s[i,j] = (Q_i · K_j)/sqrt(DH)  (j<=i, aksi -inf) ; p = softmax_j(s) ; o_i = Σ_j p[i,j] V_j   (head'ler yan yana → [N,D])
  h   = h + (o @ l.proj.w + l.proj.b)
  m   = LN(h; l.ln2.g, l.ln2.b)
  u   = m @ l.fc1.w + l.fc1.b                              [N,FF]
  g   = gelu(u)   (tanh yaklaşımı: 0.5u(1+tanh(√(2/π)(u+0.044715u³))))
  h   = h + (g @ l.fc2.w + l.fc2.b)
f      = LN(h; lnf.g, lnf.b)
logits = f @ tokᵀ                                           [N,V]   (tied embedding, çıkış bias'ı YOK)
loss   = mean_n( logsumexp(logits[n]) − logits[n][y[n]] )
```
Parametre düzeni: **`src/layout.js` → `Limon.Layout.build(cfg)`** (tek düz `Float32Array`, satır-major, matrisler `[in][out]`, isimler `tok`, `pos`,
`l{i}.ln1.g` … `lnf.b`). Başlatma: `Limon.Layout.init(cfg, seed, opts)`. **Herkes bunu kullanır; kendi düzenini icat etme.**

Optimizer: **AdamW** (ayrık weight decay). `m=β1 m+(1-β1)g; v=β2 v+(1-β2)g²; p -= lr*( (m/(1-β1^t)) / (sqrt(v/(1-β2^t))+eps) + wd*p )`
(wd yalnızca `decay:true` tensörlerde — layout'ta işaretli). Varsayılan β1=0.9, β2=0.98, eps=1e-8, wd=0.01.
Gradyan kırpma: global L2 norm > `clip` (varsayılan 1.0) ise hepsini `clip/norm` ile ölç — GPU'da, CPU'ya senkron dönmeden.
lr çizelgesini uygulama hesaplar ve her `step()` çağrısında verir.

`cfg = { V, T, D, L, H, FF, B }` — `V` = `Limon.Data.vocab.length`. Varsayılan `Limon.CONFIG = {T:128, D:128, L:3, H:4, FF:512, B:32}`
(ayar aşamasında değişebilir; kod cfg'den bağımsız yazılmalı: her D, H (D%H==0), L, FF, T ≤ 256, B*T ≤ 16384 çalışmalı).

## 4. Modül API'leri

### 4.1 `Limon.Data` (src/data.js)
```js
Limon.Data.vocab          // string: id → karakter (id = indexOf). '\n' ve ' ' dahil. V = vocab.length
Limon.Data.V
Limon.Data.encode(str) -> Int32Array   // vocab dışı karakter → boşluk id'si (sessizce)
Limon.Data.decode(ids: ArrayLike<number>) -> string
Limon.Data.createSampler({ B, T, seed, synthShare }) -> { next(xOut: Int32Array, yOut: Int32Array), setSynthShare(p), stats() }
        // xOut/yOut uzunluğu B*T; y[n]=x[n+1] (sekans içinde kaydırılmış). Doğal korpus + Limon.TRGen akışı karışımı.
Limon.Data.valBatch(B, T) -> { x: Int32Array, y: Int32Array }   // sabit, eğitimde ASLA görülmeyen doğal metinden
Limon.Data.chatPrompt(history: [{who:'Sen'|'Limon', text}], userText) -> string  // "Sen: ...\nLimon:" biçimi
Limon.Data.knownWords     // Set<string> (Türkçe-küçük harf) — bilinen geçerli kelimeler
Limon.Data.turkishScore(text) -> { words, known, ratio }   // ratio ∈ [0,1]: metindeki kelimelerin bilinenlere oranı
Limon.Data.randomSnippet(rng) -> string   // beynin "okuma" modu için korpustan kısa metin
Limon.Data.info -> { naturalChars, docs, synthSampleChars, ... }
```
### 4.2 `Limon.GPU.Trainer` (src/gpu_engine.js) — WebGL2 eğitim motoru
```js
const tr = new Limon.GPU.Trainer(cfg, { seed })   // kendi gizli canvas'ı + WebGL2 bağlamı; desteklenmiyorsa Error (.code='NO_WEBGL2'|'NO_FLOAT_RT')
Limon.GPU.supported() -> { ok:boolean, reason?:string, renderer?:string }   // atılık bağlamla WebGL2 + EXT_color_buffer_float + float doku okuma/yazma yeteneğini sınar
tr.info                      // { renderer, maxTex, paramCount, ... }
tr.init(weights|null, seed)  // ağırlıkları yükler (null → Limon.Layout.init), Adam durumunu ve adım sayacını sıfırlar
tr.step(x: Int32Array(B*T), y: Int32Array(B*T), lr, opts?)   // TEK tam eğitim adımı (ileri+geri+kırpma+AdamW) KUYRUĞA atar; CPU'ya senkron OKUMA YOK
tr.stepCount                 // kuyruğa atılan adım sayısı
tr.inFlight() -> number      // henüz GPU'da bitmemiş (fence'i sinyallenmemiş) adım sayısı, bloklamaz
tr.readLossAsync() -> Promise<{step, loss, gradNorm}|null>  // en son TAMAMLANMIŞ adımın kaybı; GPU hattını kilitlemeden (PBO+fence)
tr.evalLoss(x, y) -> Promise<number>        // yalnızca ileri geçiş, ortalama kayıp (doğrulama)
tr.readWeights() -> Float32Array            // senkron, düz layout sırası (birkaç ms; seyrek çağrılır)
tr.readWeightsAsync() -> Promise<Float32Array>   // tercih edilen: bloklamaz
tr.loadWeights(flat)
tr.dispose()
```
Hedef başarım (referans cfg, V≈100): ≥ 100K token/sn eğitim (adım süresi ≈ ≤ 40 ms). `step()`'in CPU tarafı maliyeti ≤ ~4 ms olmalı (çizim çağrısı sayısını düşük tut).
Motor render bağlamından bağımsız; uygulama `inFlight()` ile kuyruğu 1–2 adımla sınırlar ki 3B render akıcı kalsın.

### 4.3 `Limon.CPUModel` (src/cpu_model.js) — Float32 çıkarım (KV önbellekli)
```js
const m = new Limon.CPUModel(cfg);
m.setWeights(flat)          // Layout sırası; kopyalar (ya da referans alır — belgele)
m.reset()                   // KV önbelleğini ve pos=0'ı sıfırla
m.feed(tokenId, wantTrace=false) -> { logits: Float32Array(V), trace|null }   // pos'taki tek token; pos++ ; pos==T olunca çağıran pencereyi kaydırır
m.prefill(ids: Int32Array)  // toplu besleme (iz almadan hızlı)
m.pos
Limon.CPUModel.sample(logits, { temperature=0.8, topK=0, topP=1, rng }) -> id
m.generate(promptIds, { maxNew, temperature, topK, topP, rng, stopIds:[id..], onToken(id, trace|null) }) -> Int32Array(üretilen)
        // pencere dolarsa son T/2 tokenı yeniden prefill ederek kayan pencere yapar
```
**Trace** (yeniden kullanılan, ön-ayrılmış tamponlar; çağıran kopyalamalı):
```js
trace = { pos, token,
  layers: [ { xIn:Float32Array(D), attn:Float32Array(H*(pos+1)) /*[h][j] softmax ağırlıkları*/, attnOut:Float32Array(D) /*proj çıkışı, residual'a eklenen*/,
              hMid:Float32Array(D) /*attention sonrası residual*/, mlpAct:Float32Array(FF) /*gelu sonrası*/, mlpOut:Float32Array(D), xOut:Float32Array(D) } , ...L ],
  xFinal:Float32Array(D), logits:Float32Array(V), probs:Float32Array(V) }
```
`Limon.CPURef` (src/cpu_ref.js, yalnızca test): Float64 referans `forward(cfg,w,x,y)` ve `forwardBackward(cfg,w,x,y) -> {loss, grad:Float64Array(total), logits}`, `adamStep(...)`.
GPU motoru bu referansa karşı doğrulanır (ileri: logits/loss; geri: bütün parametre gradyanları).

### 4.4 `Limon.Brain` (src/brain3d.js) — ham WebGL2 3B beyin
```js
const brain = new Limon.Brain(canvas, cfg)   // cfg: {V,T,D,L,H,FF}; harf etiketleri için Limon.Data.vocab okunur
brain.resize(cssW, cssH, dpr)
brain.setWeights(flat: Float32Array)         // ~1–2 sn'de bir; eski ağırlıkla farkı "plastisite parlaması" olarak gösterir; en güçlü sinapsları yeniden seçer
brain.pushTrace(trace)                       // her token için; nöron parlaması + sinyal darbesi ilerlemesi + attention yayları
brain.setStatus({ step, loss, lossNorm /*0..1, 1=yeni doğmuş*/, stage /*0..5*/, tokensPerSec })
brain.birth()                                // doğum animasyonu (sinapslar/nöronlar belirir)
brain.render(tSeconds)                       // uygulamanın rAF'ında çağrılır; brain kendi rAF'ını AÇMAZ
brain.setOptions({ autoRotate, showSynapses, showLetters, showAttention, quality })
brain.dispose()
```
Fare/dokunma kontrolü brain içinde (yörünge dönüş, tekerlek yakınlaştırma, sağ tık/shift ile kaydırma, çift tıkla sıfırla).
Görsel doğruluk ilkesi: her nokta gerçek bir birim, her çizgi gerçek bir ağırlık, parlama gerçek aktivasyon — süs değil.

### 4.5 Uygulama (`src/app.js`)
Eğitim döngüsü (rAF): `inFlight()<2` iken ve kare bütçesi (≈6 ms CPU) dolmadan `sampler.next → tr.step`; ~0.7–2 sn'de bir `readWeightsAsync` →
`cpuModel.setWeights` + `brain.setWeights`; beynin "okuma/düşünme" akışı (CPU model, korpustan kısa metni karakter karakter besler, ~10–15 tok/sn, trace → brain);
periyodik serbest konuşma örnekleri ("Ders defteri" anlık görüntüleri) ve `Data.turkishScore`; sohbet kutusu (`Sen: …\nLimon:` biçimi, satır sonunda durur);
kontroller (duraklat/devam, yeniden doğur, sıcaklık, hız/GPU payı, kamera). Sahne/aşama: skor < .05 "Saçmalıyor", < .25 "Harfleri tanıyor", < .5 "Kelime uyduruyor",
< .75 "Gerçek kelimeler söylüyor", < .9 "Cümle kuruyor", ≥ .9 "Türkçe konuşuyor".
Hata ayıklama/test için `window.__limon` = `{ stats(), sample(prompt, n, temp) -> string, pause(), resume(), reborn(), state }` ve hazır olunca `window.__limonReady = true`.
URL parametreleri: `?seed=N`, `?speed=` (test için), `?nobrain=1`.

## 5. Eğitim verisi biçimi (korpus + üreteç ortak)

İzinli karakter kümesi (başka karakter YOK): Türkçe harfler `abcçdefgğhıijklmnoöprsştuüvyz` + `qwx`, büyükleri `ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZQWX`,
rakamlar, boşluk, `\n`, ve noktalama **yalnızca** `. , ! ? : ; - ' " ( )`. Yani: düz tırnak (‘ ’ “ ” yok), tire `-` (— – yok), üç nokta `...` (… yok), şapkalı harfler düz (â→a, î→i, û→u; "kâğıt"→"kağıt"), emoji YOK, URL YOK, İngilizce YOK (özel ad hariç), madde işareti/markdown YOK.
- Dosyalar `src/corpus/*.txt`, UTF-8, `\n` satır sonu. Belgeler arasında **bir boş satır** (`\n\n`).
- **Diyalog** belgeleri (bir konuşma = birkaç satır, sonra boş satır):
  ```
  Sen: Merhaba!
  Limon: Merhaba! Ben Limon. Sen kimsin?
  Sen: Ben Ayşe.
  Limon: Tanıştığıma sevindim Ayşe.

  ```
  Konuşmacı etiketleri tam olarak `Sen:` ve `Limon:` (iki nokta üst üste + tek boşluk). Her satır tek konuşma turu; `Limon:` yanıtı 1–3 kısa cümle (≤ ~200 karakter).
- **Anlatı** belgeleri: düz paragraflar (1–8 cümle), belgeler boş satırla ayrılır, başlık/etiket/madde işareti yok.
- **Limon karakteri (persona):** küçücük, yeni doğmuş bir yapay zekâ; kullanıcının tarayıcı sekmesinde, kendi ekran kartında sıfırdan doğdu; önce saçmaladı, sonra harf harf
  Türkçe öğrendi; beyni 3 boyutlu görülebiliyor (nöronlar, sinapslar); adı limondan; ekşi ama tatlı dilli, neşeli, meraklı, alçakgönüllü ("henüz çok küçüğüm, bazen yanılırım");
  interneti/bulutu yok, her şey bu sekmede; sevdikleri: limonata, güneş, kelimeler, çay, kediler. Bilmediğini dürüstçe söyler ("Bunu bilmiyorum ama öğrenmeyi çok isterim."). Ne insan taklidi yapar ne de yapay zekâ klişesi.
  Kullanıcıya "sen" der. Argo/küfür/siyaset/din tartışması/şiddet YOK. Doğruluğundan emin olmadığın olgusal bilgi YOK (Türkiye coğrafyası vb. yalnızca kesin bilinenler).
- Dil: sade, doğal, günlük Türkçe (A2–B2). Kısa-orta cümleler. Farklı kelime dağarcığı; şablon tekrarı yapma. Yazım/noktalama kusursuz; ünlü uyumu ve ek kuralları doğru.

## 6. Doğrulama standardı

- Her modül kendi başına test edilir (Node veya `dev/cdp.mjs` ile gerçek Chrome). "Çalışıyor" demek = çalıştırdın ve çıktıyı/ekran görüntüsünü gördün.
- Sayısal doğruluk: GPU ↔ CPURef ileri farkı ≤ 1e-3 (göreli), bütün parametre gradyanları göreli hata ≤ 1e-2 (float32 GPU vs float64 ref), küçük veride kayıp düşer.
- Konsolda hata/uyarı bırakma. `console.log` gürültüsü bırakma (uygulamada yalnızca `?debug=1` ile).
- Bitirince raporun: yaptığın, test sonuçların (sayılarla), bilinen sınırlar, ve diğer modüllerin bilmesi gereken her şey.
