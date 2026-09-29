# Sonnet 5.5 test gecesi

Claude Sonnet 5.5 çıktığı gece (28 Eylül 2026) yaptığımız dokuz testin sonuçları, birebir promptları ve hepsini yan yana gösteren sunum. Üstüne bir de Galata Kulesi: aynı prompt, Sonnet 5 ve Sonnet 5.5.

Kanal: YouTube [@avenoxai](https://www.youtube.com/@avenoxai)

## Testler

Sıra sunumdaki sırayla aynı. Süre, oturumun aktif çalıştığı süre (limit yüzünden beklediği saatler dahil değil). Maliyet, oturum kayıtlarından API liste fiyatıyla hesaplandı (Sonnet 5.5: girdi $2, çıktı $10, önbellekten okuma $0,20, önbelleğe yazma $2,50, milyon token başına). Çıktı token'ına düşünme ve alt ajanlar dahil.

| Test | Klasör | Mod | Prompt | Süre | Çıktı token | Maliyet | Ajan |
|---|---|---|---|---|---|---|---|
| Mekanik saat | `mekanik saat/` | normal | Bana gerçek çalışan bir mekanik kol saati yap, 3D olsun, içini açıp bakabileyim. | 1 sa 35 dk | 492 bin | $22,27 | tek |
| Galaksi çarpışması | `galaksi çarpışması/` | normal | Samanyolu ile Andromeda'nın çarpışmasını simüle et. | 45 dk | 234 bin | $7,37 | tek |
| Çift yarık | `çift yarık/` | normal | Kuantum çift yarık deneyini simüle et. | 38 dk | 166 bin | $4,16 | tek |
| Işık masası | `ışık masası/` | normal | Işıkla oynayabileceğim bir masa yap: prizma, mercek, sabun köpüğü, elmas. | 55 dk | 210 bin | $5,98 | tek |
| Mars inişi | `mars inişi/` | ultracode | Bu videoyu izle ve içinde olanı 3D simülasyon olarak yeniden yap. | 2 sa 2 dk | 3,55 milyon | $123,02 | 24 |
| Porsche 911 GT3 RS | `porsche/` | ultracode | Porsche 911 GT3 RS'i (992) 3D olarak sıfırdan modelle. Dışarıdan asset kullanman yasak. | 4 sa 33 dk | 3,06 milyon | $142,95 | 49 |
| Yürüyen yaratıklar | `yürüyen yaratıklar/` | ultracode | Bacaklı yaratıklar tasarla, yürümeyi evrimle kendileri öğrensin, ben canlı izleyeyim. | 3 sa 12 dk (yerel 1 sa 9 dk + bulut 2 sa 2 dk) | 1,59 milyon* | $52,34* | 19 |
| Türk kahvesi | `türk kahvesi/` | ultracode | Müzik üstüne, her karesi JavaScript ile çizilmiş pastel boya animasyon (tam metin `PROMPTLAR.md`'de) | 2 sa 35 dk (yerel 28 dk + bulut 2 sa 7 dk) | 671 bin* | $20,31* | 27 |
| Limon doğuyor | `limon doğuyor/` | ultracode | Tarayıcı sekmesinde, gözümün önünde sıfırdan bir dil modeli doğur, adı Limon olsun. (tam metin `PROMPTLAR.md`'de) | 2 sa 2 dk | 2,98 milyon | $73,45 | 80 |
| Galata Kulesi | `galata kulesi/` | web, Sonnet 5 ve 5.5 | bana yapabildiğin en iyi galata kulesi simülasyonunu yap, benchmarktasın çekinme en iyi işini yapmaktan | kayıt yok | kayıt yok | kayıt yok | |

\* Bulut kısmı tahmini, aşağıda.

Dokuz testin toplamı: yaklaşık 12,97 milyon çıktı token'ı, $451,85 (bulut kısımları tahmini dahil). "Ajan" sütunu workflow'larda açılan alt ajan sayısı; tek = alt ajansız tek oturum.

Promptlar birebir, yazım hataları dahil: [`PROMPTLAR.md`](PROMPTLAR.md). Her klasörde ayrıca kendi `PROMPT.md`'si var. Ultracode'lu testlerde promptun başında `ultracode` kelimesi vardı.

## Nasıl çalıştırıldı

Claude Code, başsız (`claude -p`), model `claude-sonnet-5-5`, effort xhigh, izinler açık, MCP sunucuları kapalı (başka model ya da servis karışmasın diye). Sekiz test 21:43'te aynı anda başladı, her biri kendi klasöründe temiz bir oturumda. Promptun yanına sadece kısa bir teknik ortam notu eklendi: otonom çalış, klasörün dışına yazma, başka model kullanma, headless Chrome ile test edebilirsin. Yaratıcı yönlendirme yok.

## Dürüstlük notları

- **Maliyet hesabı:** `claude -p` çıktısındaki `modelUsage` arka planda çalışan workflow ajanlarını saymıyordu. Bu yüzden maliyet ve token'ı oturum kayıtlarından (ana oturum ve bütün alt ajanlar) API liste fiyatıyla biz hesapladık. Alt ajansız testlerde iki yöntem birebir aynı çıkıyor.
- **Bulut kısmı:** Türk kahvesi ve yürüyen yaratıklar yerelde kullanım limitine takıldı. Kalan kısmı Claude Code bulut oturumunda, yine Sonnet 5.5 ile bitti. Bulut oturumları medium eforla koştu (yerel koşular xhigh). Bu iki testin son kısmı daha düşük eforla yapıldı; adil olmayan tek nokta bu. Bulut kısmının alt ajan çıktı token'ı kayıtta eksik, o kısmın maliyeti tahmini: yürüyen yaratıklar bulut $18,39 (aralık $16,24 ile $20,97), türk kahvesi bulut $11,28 (aralık $9,52 ile $13,38).
- **Mars, Porsche, Limon:** üçü de gece limit yüzünden durdu, 29 Eylül 03:04'te aynı oturumdan kaldığı yerden devam ettirildi (devam mesajında işe dair ipucu yok). 03:41'de zamanım daraldığı için üçüne de "en geç 40 dakika içinde çalışan, bitmiş bir sonuç teslim et" mesajı gitti. 03:53'te üçünü de o anki haliyle durdurdum. Repodaki sonuçlar, oturumların kesildiği andaki hali.
- **Galata Kulesi:** ikisi de claude.ai web arayüzünde, aynı promptla, reasoning Max. Token, süre ve maliyet kaydı yok.
- Ajanların kendi yazdığı notlarda (README, SPEC, rapor) iddia ettikleri ölçümleri bağımsız doğrulamadık.

## Açmak

```bash
git clone https://github.com/avenoxai/sonnet-5.5-benchmarks.git
cd sonnet-5.5-benchmarks
python3 sunum/sunucu.py 8765 .
# tarayıcıda: http://127.0.0.1:8765/sunum/
```

`sunucu.py` repo kökünü sadece bu bilgisayara yayınlar; video sarmayı ve sunumun dosya kontrolünü destekler. Tek bir sonucu açmak için aynı sunucuda klasörün `index.html`'ine gidin (ör. `http://127.0.0.1:8765/mekanik%20saat/`). Bazı sonuçlar ES modülü kullandığı için dosyayı doğrudan açmak yerine yerel sunucu üzerinden açın. Chrome önerilir, sonuçların çoğu WebGL2 istiyor.

Sunum klavyesi: `← →` slayt, `1` / `2` sonucu tam ekran, `Esc` geri, `↑ ↓` Türk kahvesi slaytında sekme, `I` dizin, `M` ses.

`sunum/topla.py` rakamları oturum kayıtlarından üreten betik. Kayıtlar repoda olmadığı için burada çalışmaz; ürettiği sonuç `sunum/olcumler.js`.

## Resmi rakamlar

Sunumun ilk slaytındaki tablo Anthropic'in duyurusundan birebir: [anthropic.com/claude-sonnet-5-5](https://www.anthropic.com/claude-sonnet-5-5) (28 Eylül 2026). Kopyası `sunum/_kaynak/resmi-benchmark.json`.

| Alan | Test | Sonnet 5.5 | Sonnet 5 | Opus 5.5 | GPT-6 Sol |
|---|---|---|---|---|---|
| Agentic kodlama | Terminal-Bench 4.0 | 70.6% | 10.3% | 66.4%¹ | yok |
| Agentic kodlama | FrontierCode 1.1 (Main) | 52.1% Xhigh / 46.2% Max² | 42.4% | 54.4% | 49.3% |
| Agentic kodlama | CursorBench 4.0 | 55.5% | 34.1% | 57.8% | yok |
| Bilgi işi | GDPval-AA v2.1³ (Elo) | 1844 | 1449 | 1846 | 1487⁴ |
| Bilgi işi | AA-Briefcase v1.1³ (Elo) | 1811 | 1359 | 1822 | 1483⁴ |
| Çok alanlı akıl yürütme | Humanity's Last Exam (araçlarla) | 64.5% | 54.9% | 67.7% | yok |
| Bilgisayar kullanımı | OSWorld 2.1 (kısmi puan) | 80.1% | 57.0% | 81.8% | yok |
| Grafik okuma | Chartography (araçsız) | 61.6% | 15.6% | 64.4% | 53.6%⁴ |

1. Terminal-Bench 4.0'da Opus 5.5 Xhigh effort sonucu (en yüksek skoru).
2. Sonnet 5.5 Max effort'ta Xhigh'tan düşük skor aldı; Max'te code-review skill'ini daha sık çalıştırıp kapsam dışı düzenleme yaptı.
3. Artificial Analysis, sonradan düzeltilen bir yapılandırılmış çıktı hatası olan ön sürümde ölçtü; etkinin küçük olması bekleniyor.
4. GPT-6 Sol'daki görüntü anlama hatası sonradan düzeltildi; bu skorlar henüz güncellenmemiş olabilir.

"yok": Anthropic'in tablosunda bu hücre boş. Fiyat (milyon token): Sonnet 5.5 girdi $2, çıktı $10, önbellekten okuma $0,20. Anthropic'e göre Sonnet 5'ten %30'dan fazla hızlı çıktı üretiyor ve çoğu işte görev başına %30'a kadar daha ucuz.

## Repoda olmayanlar

- **Mars inişi için verilen NASA videosu** (`mars inişi/video.mp4`, 260 MB, GitHub'ın 100 MB sınırını aşıyor). Kaynak: Perseverance "Descent and Touchdown" araç kameraları görüntüleri, NASA/JPL-Caltech. Sunumda bu yüzden Mars slaytında yalnızca Sonnet'in simülasyonu var. `mars inişi/assets/` altındaki arazi ve mozaik verisini Sonnet bu videodan çıkardı. `paylasim/mars-nasa-vs-sonnet55.mp4` NASA görüntüsüyle simülasyonu yan yana gösteren kısa bir karşılaştırma.
- **Türk kahvesi referansı:** tarz için referans olarak Kevin Ngo'nun bir videosu verildi. Üçüncü taraf içeriği olduğu için repoda yok, ondan türeyen kareler de yok. `muzik.m4a` Suno ile üretildi (promptunu ve ayarlarını Sonnet yazdı, `türk kahvesi/SUNO.md`); animasyon onsuz sessiz kalır.
- Oturum kayıtları (jsonl), çalıştırma betikleri, ajanların test için çektiği ekran görüntüleri, denemeler ve ara çıktılar (`_work`, `dev`, `shots`, `attempts`, yerelde yarım kalan kopyalar) boyut yüzünden eklenmedi. Klasörlerde kalan `tools/` ve `plan/` betiklerindeki yollar bizim makineye göre yazılmış.

## Paylaşım videoları

- `paylasim/mekanik-saat-sonnet55.mp4`: mekanik saatin ekran kaydı.
- `paylasim/mars-nasa-vs-sonnet55.mp4`: NASA iniş görüntüsü ile Sonnet 5.5'in simülasyonu yan yana.
- `türk kahvesi/turk-kahvesi-yolculugu.mp4`: Sonnet'in kendi çıkardığı 1080x1080 video.

## Lisans

Kod MIT lisanslı ([`LICENSE`](LICENSE)). NASA görüntüleri ve üçüncü taraf materyali bu reponun parçası değil, lisansa dahil değil. Mars karşılaştırma videosundaki NASA görüntüsü NASA/JPL-Caltech'e aittir. Sunumdaki yazı tipleri (Fraunces, JetBrains Mono, Schibsted Grotesk) kendi açık lisanslarıyla (SIL OFL) gelir.

---

**English, short:** Claude Sonnet 5.5 launch-night tests (28 to 29 September 2026). Nine builds from short Turkish prompts, headless Claude Code at xhigh effort, five of them in ultracode (multi-agent workflows), plus a Sonnet 5 vs Sonnet 5.5 Galata Tower comparison from the web app. Costs are computed from session logs at API list price; two tests finished in a cloud session at medium effort, and three were stopped as-is at 03:53. Open `sunum/` through `python3 sunum/sunucu.py 8765 .` to see them side by side; prompts are in `PROMPTLAR.md` (Turkish).
