# Türk Kahvesi: Suno müzik promptu

Hazırlanma tarihi: 28 Eylül 2026. Hedef: yaklaşık 80 saniyelik müzik, pastel boya / çocuk çizimi tarzı JavaScript animasyonunun altına.
Not: Suno'yu bu makinede açıp hiçbir şey üretmedim. Aşağıdaki her şey kaynaklara ve prompt mantığına dayanıyor, dinlenmiş bir take yok.

## 0. Yaratıcı kararlar (özet)

- **Enstrümantal.** Sebep: (1) Suno'nun Türkçe telaffuzu güvenilmez, üstelik söylenen cümlenin hangi saniyeye düşeceğini kilitleyemem. (2) Son cümle ekranda yazı olarak gelecek; müzik ona yol açar, onu söylemez. (3) Sözsüz müzikte duygu melodiden gelir, animasyondaki tanık karakterin yolculuğu da böyle daha iyi taşınır.
- **Fikir: yolculuğu müzik de yapsın.** Kahve İstanbul'dan Viyana'ya, oradan Avrupa'ya gidiyor; müzik de aynı yoldan geçiyor. Osmanlı halk çalgıları (ud, saz, ney, darbuka) önce yuvarlanan bir 9/8 ritimle başlıyor, kısa bir mehter patlamasıyla Viyana valsine dönüyor, sonra hızlı bir Avrupa kafe montajı geliyor. Hepsinin üstünden kısa, 4 notalık tek bir motif geçiyor. Kahve gibi: aynı şey, başka bir elde.
- **Ters köşe:** montajın zirvesinde her şey bir anda kesiliyor. Sonra tek ney ve müzik kutusu, aynı motifi yavaş yavaş çalıyor. Kalabalıktan tek fincana inmek duygusal vuruş. Son akor son kelimeyle birlikte vuruyor.
- **Ton:** sıcak, ahşap, naif, biraz oyuncak tadında (glockenspiel, oyuncak piyano). Epik, sinematik ya da "çöl" klişesi yok. Çocuk çizimine uyar.
- **Tempo:** yaklaşık 118 BPM. Suno BPM'i kesin tutmaz, yaklaşık okur.

## 1. Suno'ya yapıştırılacaklar

### Ayarlar

| Ayar | Değer | Not |
|---|---|---|
| Model | **v6** (bayrak model) | v6-wild'i seçme: öngörülemez, senkron için riskli. v6-mini'yi de seçme: kaynaklara göre süre kontrolü yok. v6 ve v6-wild ücretli plan ister (Suno duyurusu). v6 görünmüyorsa v5.5. |
| Mod | **Custom** (Simple değil) | Style, Exclude ve Lyrics alanları ayrı alanlar olarak Custom'da açılıyor. |
| Instrumental | **Açık** | Ama aşağıdaki "Emin olmadığım noktalar" 1. madde: kutu kapanabilir. |
| Duration | **Custom, 1:20** | Auto değil. Kaynaklara göre v6'da 10 sn ile 6 dk arası ayarlanıyor. Arayüzde yoksa Bölüm 3'e geç. |
| Weirdness | **%30** | 50 "normal". Tür karışımı için biraz serbestlik lazım, ama Türk müziği klişesine ya da kaosa kaymasın. |
| Style Influence | **%80** | Varsayılan 50; ayrıntılı bir style promptunun yarısı boşa gitmesin. %100 yapma. |
| Variety | **0 / Off** | Kaynaklara göre Variety, style promptunu Suno'ya yeniden yazdırıyor; 0'da promptun olduğu gibi kalıyor. |
| Max Mode | Kapalı (ilk tur) | Yapı dağılırsa aç. Kaynaklara göre kredi maliyeti 2 katı. |
| Vocal Gender | Seçme | Enstrümantal. |
| Personalize / My Taste | Kapalı | Sonucu kişisel zevke doğru kaydırır, karşılaştırmayı bozar. |
| Deneme sayısı | **3 kez Create = 6 take** | Her Create iki take veriyor. Üçünde de ayarlar ve prompt aynı kalsın. |

Kural: iki take'i de dinlemeden promptu değiştirme. İki take arasındaki fark, senin küçük prompt değişikliklerinden büyük olabiliyor.

### Title

```
Kırk Yıl Hatırı
```

(15 karakter. Sınır 100. Sadece etiket, ürünü etkilemesi beklenmez.)

### Style (862 karakter)

```
Instrumental, no vocals. Playful storybook chamber folk, warm, wooden, intimate, naive and childlike like a crayon drawing. Opens with a lone oud, then a rolling 9/8 Turkish groove: oud, saz, ney, soft kanun ornaments, darbuka and def, with a short catchy 4-note hicaz-flavored motif that returns all song long. About halfway a brief Ottoman military band burst (davul, zurna, cymbals, alla turca) turns into an elegant 3/4 Viennese waltz: pizzicato strings, cello, harpsichord, violin playing the same motif. Then a fast joyful European cafe montage: musette accordion, mandolin, clarinet, glockenspiel, toy piano, layering up to a bright peak, then a sudden full stop. Ends very quiet: solo ney and music box replay the motif slowly, one warm final chord rings out and decays naturally. Around 118 BPM, dry close-miked acoustic recording, tiny 80 second story.
```

Yedek, sade sürüm (368 karakter): v6 uzun promptta dağılırsa buna geç.

```
Instrumental, no vocals. Playful storybook chamber folk. Ottoman oud, saz, ney and darbuka in a rolling 9/8 groove, then a Viennese 3/4 waltz with pizzicato strings and harpsichord, then a fast European cafe montage with accordion, mandolin and glockenspiel. Sudden full stop, then solo ney and music box, very quiet, one warm final chord. About 118 BPM, dry acoustic.
```

### Exclude styles (144 karakter)

```
vocals, singing, humming, choir, spoken word, EDM, trap, electronic drums, synthesizer, electric guitar, sitar, bollywood, epic cinematic, lo-fi
```

Neden bunlar: mırıltı ve koro Suno'nun enstrümantalde sızdırdığı klasik hatalar; sitar ve bollywood "Doğu" klişesine kayışı, EDM ve elektronik davul modern kaymayı, epic cinematic de ciddi trailer tonunu engelliyor.

### Lyrics (yalnızca etiketler)

```
[Instrumental]
[Intro: lone oud, one slow phrase, a single ney breath, dry and close]
[Istanbul 1554: rolling 9/8 groove, darbuka and def enter, oud and saz play the 4-note motif, kanun sparkles, curious and warm]
[The road: tempo lifts, more percussion, the motif passes to ney and clarinet, forward motion]
[Ottoman military band burst: davul, zurna, cymbals, alla turca march, short and bright]
[Vienna 1683: elegant 3/4 waltz, pizzicato strings, cello, harpsichord, violin plays the same motif, slightly amused]
[European cafe montage: faster, musette accordion, mandolin, clarinet, glockenspiel, toy piano, everything layering to a joyful peak]
[Break: full stop, one beat of silence]
[Outro: solo ney and music box only, very quiet, the motif played slowly, one warm final chord rings out and decays naturally]
[End]
```

Etiket yazımı, v6'nın bölüm içi yönergeleri okuduğunu söyleyen kaynaklara göre seçildi. Etiketler tek başına komut değil, pekiştirme; asıl yapı style alanında da aynı cümlelerle duruyor (model talimatı iki kez alıyor).

### Emin olmadığım noktalar (Suno arayüzü)

1. **Instrumental anahtarı ile Lyrics kutusu.** Bazı kaynaklar enstrümantalde `[Instrumental]` gibi etiketleri lyrics alanına yazmayı öneriyor; Instrumental anahtarının kutuyu gizleyip gizlemediğine dair net bir bilgi bulamadım. Yapılacak: önce anahtarı aç ve kutu hala yazılabiliyorsa etiketleri yapıştır. Kutu gizlendiyse iki yol var: (a) etiketsiz devam et, style alanı yapıyı zaten taşıyor; (b) anahtarı kapat, lyrics'e yalnız yukarıdaki etiketleri yapıştır ve Exclude'un vokali engellemesine güven. (b)'de ilk take'lerde mırıltı ya da "ooh" var mı diye özellikle dinle.
2. **Duration.** Kolbo ve Undetectr gibi üçüncü taraf yazılar v6'da 10 sn ile 6 dk arasında süre ayarı olduğunu söylüyor; Jack Righteous ise v5.5'in Duration slider'ının v6'da "legacy" kaldığını yazıyor. Suno'nun kendi duyuru sayfası bu ayrıntıyı vermiyor. Arayüzde "Duration: Custom / Auto" seçeneğini görmezsen Bölüm 3'teki Auto senaryosuna geç.
3. **Slider yüzdeleri.** Weirdness (Safe ile Chaos arası, 50 normal), Style Influence (Loose ile Strong arası, varsayılan 50) ve Variety davranışı ikincil kaynaklardan. %30 / %80 / 0 değerleri benim önerim; kaynaktaki taban değerler %20 / %75 / 0 idi.
4. **9/8 ve 3/4 geçişi.** Bir rehbere göre (v5.5 için) zaman işareti üretimi koşullamıyor, sadece editör ızgarasında geçerli. Bu yüzden geçişi zaman işaretine değil enstrüman değişimine (mehter davulu, yaylılar, klavsen) yasladım. Vals hissi gelmese bile geçiş algılanmalı.
5. **`[Break: ...]` gerçek sessizlik üretir mi?** Garanti yok. Üretmezse duruşu editörde kendin yap (Bölüm 3).
6. **Karakter sınırları.** Style 1.000, Exclude 1.000, Lyrics 5.000, Title 100 (v6 için üçüncü taraf kaynaklar). Arayüzdeki sayaçla doğrula. Style metnim 862 karakter.
7. **Model seçicinin ekrandaki yeri**, Max Mode'un tam kredi maliyeti ve "Extend / Replace Section / Crop" gibi düzenleme düğmelerinin bugünkü adları: arayüzden doğrula.

## 2. 80 saniyelik zaman haritası

Zamanlar hedeftir; Suno birkaç saniye kaydırabilir. Seçtiğin take'i dinleyip alttaki çapa tablosunun "gerçek" sütununu doldur, animasyon sahnelerini çapalar arasında ölçekle.
"Sahne" sütunu öneridir. Animasyon senaryosu farklıysa müzik sütunu aynı kalsın, sahneyi kaydır. Tanık karakter (fincan, cezve ya da küçük bir çizgi insan; sen ne seçtiysen) hem yolculuğu yaşar hem sondaki ters köşeyi taşır.

| Saniye | Müzikte ne oluyor | Animasyonda sahne |
|---|---|---|
| 0:00-0:06 | Intro. Tek ud, yavaş bir cümle, arada bir ney nefesi. Kuru, yakın ses. | Boş kağıt dokusu, pastel boyayla İstanbul ufku, sabah. Tanık karakter belirir. Sayaç **1554**'te başlar. |
| 0:06-0:20 | İstanbul. Darbuka ve def girer, 9/8 yuvarlanan ritim, ud ve saz 4 notalık motifi çalar, kanun pırıltıları. Meraklı, sıcak. | Tahtakale'de ilk kahvehane (Peçevi'nin anlatımına göre 1554-55, Halepli Hakem ve Şamlı Şems). Cezve kaynıyor, köpük çıkıyor, fincanlar dolaşıyor. Sayaç yavaş akar: 1554 → 1600. |
| 0:20-0:30 | Yol. Tempo yükselir, perküsyon çoğalır, motif ney ve klarnete geçer. İleri gitme hissi. | Kahve çuvalı yüklü kervan, harita üzerinde İstanbul'dan Balkanlar'a yol. Sayaç hızlanır: 1600 → 1683. |
| 0:30-0:34 | Mehter patlaması (4 sn). Davul, zurna, zil, kısa ve parlak marş. | Viyana surları, 1683 kuşatması (kesin tarih). Kısa, sert renk, kırmızı pastel. Sayaç **1683**'te vurur ve durur. |
| 0:34-0:48 | Vals. 3/4, pizzicato yaylılar, çello, klavsen, keman aynı motifi çalar. Zarif, hafif alaycı. | Viyana'da kahvehane. Rivayete göre Kolschitzky, kuşatma sonrası geride kalan kahve çuvallarıyla ilk kahvehaneyi açtı. Tarihçiler bunu çoğunlukla efsane sayıyor, ilk belgeli Viyana kahvehanesi 1685'te Johannes Diodato'ya bağlanıyor. Çuval sahnesini çiziyorsan ekranda küçük bir "rivayete göre" yaz. Sayaç 1683 → 1750 yavaş akar. |
| 0:48-0:62 | Avrupa montajı. Hızlı, akordeon, mandolin, klarnet, glockenspiel, oyuncak piyano; her şey üst üste biner, parlak bir zirve. | 3 ya da 4 kısa şehir kartı: Venedik, Londra (geleneksel anlatıma göre 1652, Pasqua Rosée), Paris (1672, Saint-Germain panayırı). Sonra Avrupa haritası fincanlarla dolar. Sayaç çılgın hızla 1750 → 2026. |
| 0:62-0:64 | **Tam duruş.** Her şey kesilir, 1 vuruş boşluk. | Sayaç 2026'da durur ve silinir. Ekran kırık beyaz kağıda açılır. Tanık karakter döner, bize bakar. |
| 0:64-0:70 | Ters köşe. Çok kısık solo ney ve müzik kutusu motifi yavaş çalar. | Kalabalık yok. Tek masa, tek fincan, buhar. (Öneri: tanık karakter fincanı bir misafire uzatır. Ne çizersen çiz, kadraj kalabalıktan tek kişiye küçülsün.) |
| 0:70-0:80 | Final. Motif son cümleye doğru toplanır, son akor **0:73-0:74**'te vurur, doğal olarak tınlar, son 1 sn neredeyse sessiz. | **"Bir fincan kahvenin kırk yıl hatırı vardır."** 0:70'te çizilmeye başlar, 0:73.5'te tamamlanır (son kelime akorla aynı anda), 0:80'e kadar ekranda kalır. Son kare bu. |

### Senkron çapaları

Seçtiğin take'te bunları dinleyerek işaretle. Animasyon sahne süreleri bu noktalar arasında kayar.

| Çapa | Hedef | Gerçek (take'ten doldur) |
|---|---|---|
| A1 ilk ud notası | 0:00 | |
| A2 darbuka girişi (ritim başlar) | 0:06 | |
| A3 mehter patlaması | 0:30 | |
| A4 vals ilk vuruşu | 0:34 | |
| A5 montaj başlangıcı | 0:48 | |
| A6 zirvenin son vuruşu ve duruş | 0:62 | |
| A7 ilk solo ney notası | 0:64 | |
| A8 son akor | 0:73.5 | |

### Tarih notları (sayaç ve sahne için)

- **1554:** Peçevi (17. yüzyıl Osmanlı tarihçisi) kahvehanelerin bu tarihten önce olmadığını, Tahtakale'de Halepli Hakem ile Şamlı Şems'in dükkan açtığını anlatır. Kaynak anlatım olduğu için "rivayete göre" ya da "1554-55" diye geç.
- **1683:** İkinci Viyana Kuşatması. Kesin.
- **Kolschitzky ve kahve çuvalları:** Rivayet. Araştırmalar ilk Viyana kahvehanesini 1685'e ve Johannes Diodato'ya bağlıyor, Kolschitzky hikayesinin büyük kısmı sonradan eklenmiş. Kesin gibi yazma.
- **Londra 1652:** Pasqua Rosée'nin kahvehanesi uzun süredir "ilk" diye anlatılıyor; Oxford'da daha erken bir kahvehane vardı. Güvenli yazım: "1650'ler".
- **Paris 1672:** Pascal'ın Saint-Germain panayırındaki tezgahı, yaygın anlatıma göre.
- **Atasözü:** "Bir fincan kahvenin kırk yıl hatırı vardır" bir atasözü. Kaynağı ya da ilk kimin söylediği için tarih iddia etme.

## 3. Suno süreyi tutturmazsa

**Önce ölç:** seçtiğin take'in gerçek süresine bak ve çapa tablosunu doldur. Sonra:

| Gerçek süre | Ne yap |
|---|---|
| 78-82 sn | Dokunma. Animasyonu çapalara göre ölç. |
| 82-90 sn (uzun) | Müzikten al, animasyonu kısaltma. Önce "Yol" bölümünden (0:20-0:30) 2-4 sn kes; yetmezse montajdan (0:48-0:62) bir döngü, yani 4-8 sn al. Kesimi ölçü başında yap, 0.2-0.3 sn çapraz geçişle. **Intro'ya, duruşa ve finale dokunma.** |
| 70-78 sn (kısa) | Müziği uzatma. Son kare zaten sabit bir cümle: son akor bittikten sonra 2-6 sn sessiz kare kalması hatır duygusunu güçlendirir. Gerekirse duruşu (0:62-0:64) 1 sn uzat. |
| 60-70 ya da 90+ sn, ya da yapı çökmüşse | Plan B (aşağıda). |

**Nasıl bitirilir (kural):** son akor animasyonun son kelimesiyle birlikte vurur (yaklaşık 0:73.5) ve 5-6 sn doğal olarak söner. Take fade-out ile bitiyorsa puanını düşür; mümkünse Plan B ile sonu yeniden üret. Yine de o take'i kullanacaksan son 6 sn'yi kes ve editörde 3 sn'lik yapay sönüm ver.

**Duruş gelmediyse:** Suno reverb kuyruğuyla devam ediyorsa duruşu editörde yap. A6 noktasından sonra sesi 50 ms'de sıfıra çek, 0:64'e kadar sıfırda tut.

**Duration seçeneği arayüzde yoksa (Auto):** Suno süreyi lyrics yapısına göre seçer. Etiket sayısı azsa kısa çıkma ihtimali var (tahminim, ölçmedim). Bu durumda: (1) yukarıdaki etiketleri olduğu gibi kullan, (2) en iyi take'i seç, (3) 80 sn'yi aşıyorsa yukarıdaki "uzun" satırını uygula. Kısa çıkarsa Plan B'nin ikinci parçasıyla sonu ayrı üret.

### Plan B: iki parça

Yapı tutmadığında ya da final yeterince küçülmediğinde. Duruş noktası zaten ses kesildiği için doğal dikiş yeridir; iki parça arasındaki ton farkı sessizlikte kaybolur.

**Parça 1 (0:00-1:02):** aynı Title, Exclude ve Lyrics, ama Duration 1:02 ve lyrics'te son iki satırı (`[Outro...]` ve `[End]`) şununla değiştir: `[Break: full stop, silence]` ve `[End]`. Style için:

```
Instrumental, no vocals. Playful storybook chamber folk, warm, wooden, intimate, naive and childlike like a crayon drawing. Opens with a lone oud, then a rolling 9/8 Turkish groove: oud, saz, ney, soft kanun ornaments, darbuka and def, with a short catchy 4-note hicaz-flavored motif that returns all song long. About halfway a brief Ottoman military band burst (davul, zurna, cymbals, alla turca) turns into an elegant 3/4 Viennese waltz: pizzicato strings, cello, harpsichord, violin playing the same motif. Then a fast joyful European cafe montage: musette accordion, mandolin, clarinet, glockenspiel, toy piano, layering up to a bright peak, then a sudden full stop, silence. Around 118 BPM, dry close-miked acoustic recording.
```

(731 karakter.)

**Parça 2 (0:20):** ayrı üretim, Duration 0:20. Style (240 karakter):

```
Instrumental, no vocals. Very quiet solo ney and music box playing a slow 4-note hicaz-flavored motif, tender, intimate, dry close-miked acoustic. Around 70 BPM. Ends on one warm final chord that rings out and decays naturally, no fade out.
```

Lyrics:

```
[Instrumental]
[Intro: solo ney, very quiet, one slow phrase]
[Outro: music box joins, the motif played slowly, one warm final chord rings out and decays naturally]
[End]
```

Birleştirme: Parça 1'in son vuruşundan sonra 1 sn boşluk bırak, Parça 2'yi 0:64'te başlat. Daha temiz yol: Suno'da Parça 1'i seçip Extend ile (arayüzdeki adı değişmiş olabilir) duruş noktasından devam ettir ve Parça 2 style ve lyrics'ini kullan; böylece ton ve tempo aynı kalır. Extend sonucu tüm şarkıyı yeniden birleştirmek gerekebilir, düğme adını arayüzden doğrula.

### Kısa ffmpeg tarifleri

Bu makinede denenmedi, standart filtreler. Dosya adlarını değiştir.

```
# 80 sn'ye kes, son 2.5 sn'yi sönümle (take zaten doğal bitiyorsa fade'e gerek yok)
ffmpeg -i secilen.wav -t 80 -af "afade=t=out:st=77.5:d=2.5" kirk-yil-hatiri-80s.wav

# Perdeyi değiştirmeden hafif hızlandır (82 sn'yi 80'e: 1.025). En fazla yaklaşık %4 oyna.
ffmpeg -i secilen.wav -af "atempo=1.025" hizli.wav
```

## 4. Dinleme kontrol listesi (aynı promptun 6 take'i için)

Her maddeye 0 (yok), 1 (kısmen), 2 (tam) puan ver. En az 6/8 alan take'ler aday; eşitlikte 2. madde (motif ve ters köşe) belirler. İki take'i de dinlemeden karar verme.

1. **İskelet ve süre.** Toplam süre 76-84 sn arası mı? A3 (mehter, ~0:30), A4 (vals, ~0:34), A6 (duruş, ~0:62) ve A8 (son akor, ~0:73.5) hedefin ±3 sn içinde mi? Geçişler algılanıyor mu: İstanbul'dan Viyana'ya bir "hava değişimi" hissediliyor mu (vals gelmese bile yaylılar ve klavsen girdi mi)?
2. **Motif ve ters köşe.** İstanbul'daki 4 notalık motif vals ve finalde tanınır biçimde geri dönüyor mu? Zirveden sonra gerçekten küçülüyor mu (tek ney + müzik kutusu, kısık), yoksa yine tam kadro mu bitiyor? Bu duygunun kendisi.
3. **Temizlik ve ton.** Mırıltı, "ooh", koro ya da vokal yok mu? İlk 6 sn'de "çöl / yılan oynatıcı" klişesi, sitar, EDM davulu yok mu? Ses ahşap, sıcak ve naif mi; glockenspiel ve oyuncak piyano çocuk çizimine uyacak dozda mı, yoksa kulak mı yoruyor?
4. **Duruş ve son akor.** A6 civarında gerçek bir kesilme var mı (ya da editörde 1 sn'lik kesme kolayca yapılabilir mi)? Son akor tam tınlayıp doğal sönüyor mu? Fade-out'la bitenler, yarım kalanlar ve ani kesilenler 0 alır.

Hepsi kötü çıkarsa tek değişken değiştir, yenisini 3 Create ile dene:

- Tür karışımı tutmuyor, hep İstanbul'da kalıyor: Style Influence %90'a çıkar ya da Max Mode aç.
- Mırıltı ya da "ooh" var: Exclude'a `ooh, aah, la la, wordless vocals` ekle.
- Çok klişe ya da çok karışık: Weirdness'i 10 puan oynat (klişeyse yukarı, kaosa kaçıyorsa aşağı).
- Uzun prompt dağıtıyor: sade sürüm style'ı (368 karakter) kullan.

## Kaynaklar

- Suno v6 duyurusu: https://suno.com/release-notes/introducing-v6
- Suno v6 rehberi (limitler, Variety, Exclude, bölüm içi yönerge): https://hookgenius.app/learn/suno-v6-guide/
- v6 önerilen ayarlar (Weirdness 20, Style Influence 75, Variety 0): https://sunostyles.com/blog/suno-v6-settings
- v6 prompt kuralları (bitiş, enstrümantal, etiketler): https://undetectr.com/blog/suno-v6-prompts
- Bitiş etiketleri, BPM ve zaman işareti notu: https://blakecrosley.com/guides/suno
- Duration kontrolü (ikincil kaynak, Suno'nun kendi sayfasında doğrulanmadı): https://kolbo.ai/blog/suno-v6-launch
- v5.5 Duration slider'ının v6'da "legacy" olduğu notu: https://jackrighteous.com/en-us/blogs/guides-using-suno-ai-music-creation/suno-duration-slider-control-song-length-in-v5-5
- Kahvehane tarihi (1554 Peçevi, Viyana 1685 Diodato, Londra 1652, Paris 1672): https://en.wikipedia.org/wiki/Ottoman_coffeehouse , https://en.wikipedia.org/wiki/The_Blue_Bottle_Coffee_House , https://en.wikipedia.org/wiki/Pasqua_Ros%C3%A9e
