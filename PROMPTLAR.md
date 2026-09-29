# Sonnet 5.5 testleri

Her test kendi klasöründe, temiz bir oturumda koştu. Prompt dışında yönlendirme yok. Ultracode'lu testlerde promptun başında `ultracode` kelimesi var.

| Klasör | Mod | Prompt |
|---|---|---|
| mekanik saat | normal | Bana gerçek çalışan bir mekanik kol saati yap, 3D olsun, içini açıp bakabileyim. |
| galaksi çarpışması | normal | Samanyolu ile Andromeda'nın çarpışmasını simüle et. |
| çift yarık | normal | Kuantum çift yarık deneyini simüle et. |
| yürüyen yaratıklar | ultracode | Bacaklı yaratıklar tasarla, yürümeyi evrimle kendileri öğrensin, ben canlı izleyeyim. |
| ışık masası | normal | Işıkla oynayabileceğim bir masa yap: prizma, mercek, sabun köpüğü, elmas. |
| mars inişi | ultracode | Bu videoyu izle ve içinde olanı 3D simülasyon olarak yeniden yap. |
| porsche | ultracode | Porsche 911 GT3 RS'i (992) 3D olarak sıfırdan modelle. Dışarıdan asset kullanman yasak. |
| limon doğuyor | ultracode | Tarayıcı sekmesinde, gözümün önünde sıfırdan bir dil modeli doğur, adı Limon olsun. Önce saçmalasın, dakikalar içinde Türkçe konuşmayı öğrensin; beynini de 3D göreyim. Hazır model yok, hazır kütüphane yok, bilgisayarımdaki dosyaları kullanma. |
| türk kahvesi | ultracode | Klasördeki müziğin (muzik.m4a) üstüne, her karesi JavaScript ile çizilmiş, pastel boya / çocuk çizimi tarzında bir animasyon yap. Konu: Türk kahvesinin yolculuğu; 1550'lerde İstanbul'daki ilk kahvehaneden Viyana'ya, oradan bütün Avrupa'ya. Son cümle: "Bir fincan kahvenin kırk yıl hatırı vardır." Tarz için referans.mp4'e bak. Müzikle senkron olsun; sonunda paylaşılabilir, kare bir video olarak da çıkar. (klasörde: muzik.m4a Suno'dan 79 sn, prompt ve ayarları Sonnet yazdı; referans.mp4 Kevin Ngo dinozor videosu; SUNO.md) |

Her test için not al: prompt, toplam token, reasoning, süre, maliyet.

## Nasıl koştu (28 Eylül 2026)

- Model `claude-sonnet-5-5`, effort `xhigh`, Claude Code 2.1.284, başsız (`claude -p`), izinler açık.
- Sekiz test aynı anda başladı.
- Ultracode'lu oturumlar `ultracode` ayarı açık başladı (standing ultracode).
- Promptun yanına sadece teknik ortam notu eklendi (Opus 5.5 gecesindeki `_ortam.md` ile aynı, üstüne: başka model/servis kullanma, uzun komutu arka plana at, silerken joker kullanma). Not bu repoda yok; özü README'de.
- MCP sunucuları kapalıydı: başka model ya da servis (Higgsfield, codex vb.) karışmasın, kredi harcanmasın.
- Her oturumun tam kaydı tutuldu (akış, token, düşünme tokenı, süre, maliyet). Ham kayıtlar bu repoda yok; özetleri `sunum/olcumler.js` içinde.

### Sonrası (29 Eylül)

- 5 saatlik Max limiti dolmak üzereyken Mars ve Limon durduruldu, Porsche limite takıldı. Üçü de 29 Eylül 03:04'te
  aynı oturumdan (`--resume`) kaldığı yerden devam ettirildi. Devam mesajı yalnızca "limit yüzünden durdu,
  iş akışlarını resumeFromRunId ile sürdürüp bitir" dedi; işe dair ipucu yok.
- Türk kahvesi ve yürüyen yaratıklar kalan kısmı Claude Code bulut oturumunda bitirdi (özel bir repo,
  önceki oturumun mesajları ayrı bir klasörde verildi). Bulut repo'ya push edemedi, sonuçlar zip olarak
  indirildi. Yerelde yarım kalan kopyalar bu repoya alınmadı.
- **Adil olmayan tek nokta:** bulut oturumları efor `medium` ile koştu (repo ayarına efor yazılmamıştı),
  yerel koşular `xhigh`. Bu iki testin son kısmı daha düşük eforla yapıldı.
- Maliyet oturum kayıtlarından (ana oturum + bütün alt ajanlar) API liste fiyatıyla hesaplanıyor.
  `sonuc.json`'daki modelUsage arka plandaki workflow ajanlarını saymıyordu; ajansız testlerde iki yöntem birebir
  aynı çıkıyor. Bulut kısmının alt ajan çıktı token'ı kayıtta eksik, o kısım tahmini.
- **Araya girme (03:41):** Zamanım daraldı. Porsche, Mars ve Limon durdurulup aynı oturumdan şu mesajla
  devam ettirildi: "en geç 40 dakika içinde çalışan, bitmiş bir sonuç teslim et; yeni tur ya da uzun iyileştirme
  açma, diskte ne varsa onunla birleştir, bir kez test et ve bitir." Bu üç testin sonu süre baskısı altında yapıldı.
- **Durdurma (03:53):** Üçünü de o anki haliyle bıraktım. Sonuçlar, oturumlar kesildiği andaki hali.
