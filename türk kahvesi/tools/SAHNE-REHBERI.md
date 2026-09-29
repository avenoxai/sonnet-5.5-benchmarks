# SAHNE REHBERİ: "Türk Kahvesi'nin Yolculuğu" (79.2 sn, 1080×1080, JavaScript ile çizilmiş pastel boya / çocuk çizimi)

Proje klasörü: `/Users/avenox/Desktop/sonnet/türk kahvesi` (yolda boşluk ve Türkçe harf var; tırnakla kullan). Sadece bu klasörün altına yaz.
Bu belge, sahne yazarlarının ortak sözleşmesi. **Ortak dosyalara (src/engine.js, src/props.js, src/main.js, src/audio.js, src/font.js, index.html) DOKUNMA**; eksik bir şey görürsen kendi sahne dosyanın içine yerel yardımcı olarak yaz ve raporda öner.

## 1. Ne yapıyoruz
Müzik (`muzik.m4a`, 79.21 sn) üstüne, her karesi Canvas2D ile kodla çizilen bir animasyon. Konu: Türk kahvesinin yolculuğu: 1554'te İstanbul Tahtakale'deki ilk kahvehane → 1683 Viyana → bütün Avrupa. Son cümle: **"Bir fincan kahvenin kırk yıl hatırı vardır."**
Stil referansı: `_work/ref/sheet1.png` (referans videodan 16 kare; MUTLAKA aç ve bak) ve `_work/ref/crop_b.png`, `crop_a.png` (yakın plan doku). Özellikleri:
- krem kağıt zemin; lacivert mürekkep kalem çizgileri (titrek, biraz eğri büğrü, çocuk eli); üstüne doygun **pastel boya (crayon) dolgu**: kısa darbeler, beyaz kağıt izi, dolgu çizgiyi tam tutturmaz, taşar; kalabalık değil, **sade kompozisyon**, çoğu yer boş kağıt; ufuk/zemin çizgisi; altta el yazısı yazı; çizgiler "çizilerek" belirir.
- naif, sevimli, hafif komik. Gözler: büyük daire + lacivert göz bebeği + beyaz parıltı. Yanaklar pembe boya. Kusursuz/vektörel/temiz değil; **elle çizilmiş** hissi. Renk paleti `TK.PAL` (turuncu, sarı, turkuaz, pembe, yeşil, kahve, kırmızı, gök mavisi). Siyah/koyu sadece özel anlarda.
- Tarih/coğrafya: kabaca doğru ama çocuk gözüyle sadeleştirilmiş. Kesin bilinmeyeni kesin gibi yazma ("rivayete göre").

## 2. Dosya sözleşmesi
Sahne dosyan: `src/scenes/<id>.js`. İçinde IIFE ve şu atama:
```js
(function(){
const TK = window.TK, P = TK.props, {PAL} = TK;
TK.scenes.<id> = function draw(ctx, lt, info) { ... };   // lt: sahnenin yerel saniyesi (0..dur, sonrasında ~1 sn taşabilir), info: aşağıda
})();
```
- `info = { t (KÜRESEL saniye), lt, dur, t0, t1, audio: TK.audio, year, id }`. Müzik sorgularında **küresel `info.t`** kullan (`TK.audio.pulse('low', info.t)`), sahne animasyonlarında `lt`.
- `ctx` 1080×1080 tuval. Zemin kağıdı ve yıl sayacı (aşağıda) sahne dışında çizilir. **Sen sadece kağıdın üstündeki resmi çiz**. Tüm alanı boyayacaksan (kırmızı gökyüzü vb.) kendin `TK.crayon` ile kaplarsın.
- Fonksiyon **saf** olmalı: yalnızca `lt`/`info`'nun fonksiyonu. `Math.random()`, `Date`, `performance.now()` YASAK; rastgelelik için `TK.rnd01(seed, i)` / `TK.noise1(x, seed)`. Sahne içinde durum saklama (dışarıdan değişen değişken) yok; her kare `lt`'den yeniden hesaplanır (oynatma geri sarılabilir).
- Sahne başında (lt=0) çizim **boş kağıttan** başlayıp çizilerek/belirerek kurulmalı (geçişte önceki sahne silinir), sonda (lt≥dur) durağan bir "son hal" olmalı. `lt` sahne süresini ~1 sn aşabilir; çökmemeli.
- Hızlı ve deterministik olmalı. Hedef: en ağır karede < 200 ms (headless Chrome, önbellek ısınınca). Çok pahalı iş yapma; ipuçları §7.

## 3. Motor API'si (`window.TK`) — bkz. `src/engine.js`, `src/props.js`
Sabitler: `TK.W=TK.H=1080`, `TK.PAL` (ink, ink2, orange, yellow, teal, pink, green, green2, brown, coffee, red, sky, blue, gray, black, white, sand, lilac, paper).
Matematik: `TK.clamp, lerp, smooth, easeOut, easeInOut, easeOutBack, seg(t,a,b)` (a..b aralığında 0..1), `TK.rnd01(seed,i)`, `TK.noise1(x,seed)`, `TK.rng(seed)`.
**Mürekkep:** `TK.ink(ctx, pts, {w=3.6, col, wob=1.3, seed, p=1, p0=0, closed=false, smooth=true, ghost, alpha})`. `pts=[[x,y],...]`. Varsayılan Catmull-Rom yumuşatır; **köşeli** şekil (bina, kutu) için `smooth:false`. `p` çizilme ilerlemesi (0..1): animasyon için `p: TK.seg(lt, 1, 2)` gibi. Seed her çizgiye FARKLI ver (titreme deseni ondan). Çizgi kalınlığı 3–4.5 px arası tut (küçük ayrıntı 2.4–3).
**Boya:** `TK.crayon(ctx, pts, color, {seed, ang, gap=5.2, lw=9, dens, grain, jit, dx, dy, a, p, still})` kapalı çokgeni boyar (yumuşatır); köşeli için `TK.crayonPoly`. `p` boyanma ilerlemesi (0..1; satır satır boyama animasyonu). Boya hep çizgiden hafif kayık ve taşkın olur; iyi. Aynı şekle her karede aynı `pts` ver (önbellek!).
**Yardımcı geometri:** `TK.ellipsePts(cx,cy,rx,ry,n,rot,a0)`, `TK.arcPts(cx,cy,rx,ry,a0,a1,n)`, `TK.blobPts(cx,cy,rx,ry,seed,n,amt)`, `TK.spiralPts(cx,cy,r0,r1,turns,a0,n)`, `TK.xf(pts,dx,dy,scale,rot)`.
**Yazı:** `TK.text(ctx, str, x, y, size, {p=1, align:'left|center|right', col, w, seed})` el yazısı çizgi-font; `y` taban çizgisi; `p` yazılma ilerlemesi. Kelime bazlı zamanlama için parçala ya da `p`'yi parçalı doğrusal hesapla. `TK.textWidth(str,size)`. Türkçe karakterler var (ç ğ ı İ ö ş ü). Alt yazı kısayolu: `P.caption(ctx, str, {p, y:1040, size:38})`.
**Hazır parçalar (`P = TK.props`)**, hepsi (x,y)=taban ortası, `s` ölçek:
- `P.fincan(ctx,x,y,{s,squash,rot,blink,look:[dx,dy],mood:'happy|wow|sleepy|sad',steam,p,flip,color,seed})`: KAHRAMANIMIZ, gözlü minik fincan (tabak+kulplu, turkuaz gövde). Genişliği ~210·s, yüksekliği ~125·s px.
- `P.fincanAlive(ctx,x,y,info,{s,bounce,hop,steam,mood,look,p,color,seed,dy,rot,flip})`: müziğe tepki veren (kick'te sekme, göz kırpma, melodiyle buhar) hazır Fincan. **Her sahnede bu kahramanı (küçük de olsa) göster**; izleyici onu takip ediyor.
- `P.miniCup(ctx,x,y,s,{col,steam,p,seed})`: sade fincan simgesi (kalabalık için). `P.cezve(ctx,x,y,{s,foam 0..1,p,flip,rot,col})`. `P.sack(ctx,x,y,{s,sx,sy,rot,p})` kahve çuvalı. `P.person(ctx,x,y,{s,robe,hat:'fes|sarik|wig|tricorn|cap|none',hatCol,beard,arms:'down|cup|up|both',cup,steam,bob,walk,flip,face:'smile|o',blink,p,skin})` sade insan (boy ≈ 300·s). `P.steam(ctx,x,y,{s,n,amt,h})`. `P.sun(ctx,x,y,r,{p})` sarmal güneş. `P.ground(ctx,y,x0,x1,{p})` zemin çizgisi. `P.grass`, `P.cloud`, `P.sparkle`.
- `P.shape(ctx, pts, {fill, closed, smooth:false, p, seed, w, fillOpts})`: köşeli çokgen: çizgi + boya birlikte. `P.dotted(ctx, pts, p, {col,w,dash,gap})`: noktalı yol, ucun [x,y,açı]'sını döner.
Bu parçalar başlangıç setidir: kendi çizimlerini `TK.ink`/`TK.crayon` ile **kendin çiz** (deve, bina, gondol, kale, insan varyasyonu vb.). Hepsi aynı elden çıkmış görünmeli: aynı çizgi kalınlığı, aynı boya dokusu, aynı sevimli/eğri büğrü oran.

## 4. Kompozisyon kuralları (kesin)
- Tuval 1080×1080. **Resim alanı y ∈ [30, 880]**. Alt bölge (y ≥ 900) global yıl sayacı (taban çizgisi y≈968, boyut 82, ortalı) ve alt yazıya ayrılı: bu bölgeye başka şey çizme. Sahne alt yazısı (yer adı) **taban çizgisi y=1040, boyut ≈36–40, ortalı**, `P.caption`. Kısa tut (≤ 30 karakter). Sadece `final` sahnesinde yıl sayacı yok.
- Ufuk/zemin çizgisi tipik olarak **y≈790**. Karakterler ayaklarını bu çizgiye basar. Boş kağıda cömert ol (referans gibi): 4–6 öğeden fazla dolgulu nesne aynı anda ekranda olmasın; kalabalık gerekiyorsa sadece çizgi (boyasız) ya da az boyalı olsun.
- Kenardan taşan büyük öğeler serbest (referansta dev dinozor gibi). Kamera "kayması" için kendi içinde `ctx.translate` kullanabilirsin.
- Her sahnede hareketli/yaşayan bir şey olmalı (çizgi titremesi zaten var): sekme, sallanma, buhar, kayan bulut, yürüyüş, kuş.

## 5. Müzikle SENKRON (bu işin kalbi)
Müzik önceden analiz edildi (`src/audio-data.js`, `TK.audio`). API (küresel t ile):
- `A.pulse('low'|'mid'|'hi', t, tau=0.12)`: son vuruşların sönümlü toplamı (0..1.6). `low`=davul/bas vuruşları (sekmeler, adımlar, top atışı), `mid`=melodi/ud/ney notaları (buhar, göz kırpma, yıldız), `hi`=zil/def/tıkırtı (pırıltı, kıpırtı).
- `A.env('rms'|'low'|'mid'|'hi', t)`: yumuşak zarf (0..~1.2). `A.last(kind,t)` / `A.next(kind,t)` → {t,s}; `A.between(kind,a,b)` → olay listesi; `A.count(kind,t,from)` → `from`'dan beri kaç olay oldu ("her vuruşta bir tane ekle" için).
- Zamanları görmek için: `node tools/events.mjs <t0> <t1> [low|mid|hi] [minGüç]`.
Müzik yapısı (ölçülmüş, küresel saniye): 0–7.7 tek ud/ney, seyrek nabız (giriş); **7.7** tüm grup girer (darbuka/def, 9/8 yuvarlanan groove; sekizlik nabız ≈0.257 sn); ~12.4 ve 16.5 parlak vurgular; **24.9–28.7** sadeleşme (breakdown: sıcak, ince); **28.7** yeni bölüm (dolu, ileri gidiş; vurgular 29.9, 31.9, 34.9); **39.1–41.1** davul fill'i (yükselen gerilim); **41.1** yeni bölüm (vals hissi, çeyrek ≈0.513 sn, 8 vuruşluk cümle ≈4.1 sn; vurgular 44.3, 46.8, 49.0, 51.4, 54.3); 56.9–57.5 fill; **57.5** yeni bölüm (montaj, en yoğun; vurgular 59.5, 61.6, 62.6, 65.3, 67.7, 69.65); **73.3** ani incelme (sahne değişir, sessizleşir); ince nota başlangıçları 73.4, 73.95, 74.49, 74.73, 74.99, 75.24, 75.76, 76.02, 76.29, 76.54, 77.06; **77.47 SON AKOR** (tok bas + parlak akor), 78.5'e doğru söner, 79.21 bitiş. Vuruş ızgarası (28 sn sonrası güvenilir): t = 0.07 + k·0.513; her 8 vuruş (4.104 sn) bir cümle: …28.80, 32.90, 37.01, 41.11, 45.21, 49.32, 53.42, 57.53, 61.63, 65.73, 69.84, 73.94.
İlkeler: (1) sahne değişimleri/büyük olaylar (yeni öğe, kamera hareketi, sayfa çevirme, patlama) mümkün olduğunca **müzik olaylarının zamanına** oturmalı; (2) sürekli nabız (sekme, sallanma, buhar, ayak) `pulse`/`env` ile beslenmeli, sabit sinüs değil; (3) yavaş geçişler cümle sınırlarına yayılmalı; (4) sessiz/sade anlarda (24.9–28.7 ve 73.3 sonrası) hareket de sakin olmalı. Sahne ekranda görünürken izleyici "müzik bunu çiziyor" hissini almalı.

## 6. Test etme (ZORUNLU: görmeden bitirme)
```
node tools/snap.mjs --t 8,10,12,14,16,18,20,22 --sheet _work/<id>/sheet.png --cols 4 --size 540 --out _work/<id>
```
Küresel saniyeleri ver; sahne dosyan yüklenir, yıl sayacı ve geçişler dahil tam kare çıkar. Sonra `Read` ile `sheet.png` (ve gerekirse tek kareleri, `snap_000_t8.00.png` gibi, 1080×1080) aç ve **eleştirel bak**: referansa benziyor mu? sevimli mi? kompozisyon boş kağıda nefes veriyor mu? yazılar okunuyor mu? alt bölgeye taştı mı? Yakın plan doku için PNG'den `ffmpeg -i in.png -vf crop=W:H:X:Y,scale=...` ile kırp. Hareket için birkaç ardışık kare al (örn. 0.1 sn arayla) ve sıçrama/kopma var mı bak. Konsol hataları `snap` çıktısında "SAYFA HATALARI" olarak görünür; sıfır olmalı. Çizim süresi (ms) her kare için yazılır: sıcak kareler <200 ms olmalı (ilk kare önbelleği ısıtır; yavaş kareyi aynı komutta tekrar ver).
Tek sahneyi izole çalıştırmak için `--page tools/dev.html --q "capture=1&only=<id>"`. Chrome'u sadece `tools/snap.mjs` üzerinden kullan (kendi user-data-dir'ini kurar ve kapatır); elle Chrome başlatırsan işin bitince kapat. Başka ajanlar aynı anda çalışıyor olabilir: `_work/<id>/` dışına yazma.

## 7. Performans ve önbellek ipuçları
- `TK.crayon` çıktıyı (şekil, renk, seed, aşama) önbelleğe alır. Hareket eden nesneyi **noktalarını değiştirerek değil, `ctx.translate/rotate/scale` ile** taşı ve çizim koordinatlarını sabit tut. Böylece dolgu bitmap'i her karede yeniden üretilmez.
- Boyayı animasyonla sürüyorsan (`p`), `p`'yi kaba adımlara yuvarla (motor 1/40'a yuvarlar).
- Çok büyük tek bir boya alanı yerine (1000×800), mümkünse daha küçük/az sayıda alan kullan; büyük zemin şeritleri için `gap` ve `lw` büyüt (ör. gap 9, lw 16).
- Karede yüzlerce `TK.ink` çağrısı sorun değil, ama binlerce nokta üretme. Kalabalıkları az çizgiyle, tekrar eden basit simgelerle (miniCup) kur.

## 8. Teslim
Sahne dosyası hazır olunca son bir kez `snap` ile en az 8–10 zamanı görerek doğrula, hata/perf yok. Yanıt (rapor) olarak şunu ver: (a) dosya yolu, (b) sahnede hangi müzik olaylarına hangi görsel olayları bağladığın (saniye bazında), (c) ölçtüğün en ağır kare süresi, (d) bilinen zayıflıklar, (e) ortak dosyalara önerilen eklemeler.
