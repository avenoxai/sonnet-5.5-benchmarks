/* Sunumun bütün içeriği. "window.SUNUM =" sonrası geçerli JSON kalmalı (posterlar.sh python ile okur).
   Rakamlar burada yok: test ölçümleri olcumler.js (topla.py üretir), resmi rakamlar "resmi" altında
   _kaynak/resmi-benchmark.json dosyasının birebir kopyası. */
window.SUNUM = {
 "meta": {
  "baslik": "Sonnet 5.5",
  "ust": "Claude",
  "kisa": "Sonnet 5.5 test gecesi",
  "tarih": "28 Eylül 2026",
  "lede": "Anthropic bugün yayınladı. Önce resmi rakamlar, sonra bu gecenin dokuz testi.",
  "kurulum": "claude-sonnet-5-5, effort xhigh, Claude Code, başsız. Sekiz test aynı anda başladı.",
  "hero": "assets/gen/hero.png",
  "kapanis": "assets/gen/kapanis.png"
 },
 "testler": [
  {
   "slug": "kahve",
   "klasor": "türk kahvesi",
   "baslik": "Türk kahvesi",
   "mod": "ultracode",
   "sanat": "assets/gen/kahve.png",
   "duzen": "sekme",
   "alt": "Müziği Suno yaptı, promptunu Sonnet yazdı. Her kare JavaScript.",
   "manset": "79 saniye, 8 sahne, her çizgi kodla. Fincan müziğin her vuruşunda zıplıyor.",
   "detay": "El yazısı fontunu da kendisi çizdi, Türkçe harfleriyle. Sonunda 1080x1080 video olarak da çıkardı.",
   "yarim": {
    "devam_sayisi": 0,
    "durum": "bulut",
    "not": "Yerelde kullanım limiti yüzünden durdu, kalan kısmı Claude Code bulut oturumunda Sonnet 5.5 ile sürüyor."
   },
   "prompt": "Klasördeki müziğin (muzik.m4a) üstüne, her karesi JavaScript ile çizilmiş, pastel boya / çocuk çizimi tarzında bir animasyon yap. Konu: Türk kahvesinin yolculuğu; 1550'lerde İstanbul'daki ilk kahvehaneden Viyana'ya, oradan bütün Avrupa'ya. Son cümle: \"Bir fincan kahvenin kırk yıl hatırı vardır.\" Tarz için referans.mp4'e bak. Müzikle senkron olsun; sonunda paylaşılabilir, kare bir video olarak da çıkar.",
   "gorunumler": [
    {
     "id": "kahve-video",
     "tur": "video",
     "dosya": "*.mp4",
     "haric": [
      "referans.mp4"
     ],
     "etiket": "Sonnet'in çıkardığı video",
     "kare": 20
    },
    {
     "id": "kahve",
     "tur": "sayfa",
     "dosya": "index.html",
     "etiket": "Canlı animasyon",
     "bekle": 14000,
     "tikla": [
      960,
      540
     ]
    }
   ]
  },
  {
   "slug": "limon",
   "klasor": "limon doğuyor",
   "baslik": "Limon doğuyor",
   "mod": "ultracode",
   "sanat": "assets/gen/limon.png",
   "etiket": "WTF testi",
   "alt": "Hazır model yok, kütüphane yok. Sıfırdan bir dil modeli, tarayıcı sekmesinde.",
   "manset": "622 bin parametrelik bir model, sekmede sıfırdan doğup Türkçeye başlıyor.",
   "detay": "Saniyede 30 binden fazla token işleyerek eğitiliyor. Öğrenirken de sohbet ediyor, her cevabın hangi adımdaki beyinden geldiğini yazıyor.",
   "yarim": {
    "devam_sayisi": 1,
    "durum": "duraklatildi",
    "not": "Kullanım limitine yaklaşınca durduruldu. Diskte duruyor, kaldığı yerden devam edecek."
   },
   "mudahale": "Zaman daraldığı için 03:41'de 40 dakikalık süre verdi, 03:53'te de durdurdu. Ekrandaki, o andaki hali.",
   "prompt": "Tarayıcı sekmesinde, gözümün önünde sıfırdan bir dil modeli doğur, adı Limon olsun. Önce saçmalasın, dakikalar içinde Türkçe konuşmayı öğrensin; beynini de 3D göreyim. Hazır model yok, hazır kütüphane yok, bilgisayarımdaki dosyaları kullanma.",
   "gorunumler": [
    {
     "id": "limon",
     "tur": "sayfa",
     "dosya": "index.html",
     "bekle": 15000
    }
   ]
  },
  {
   "slug": "yaratiklar",
   "klasor": "yürüyen yaratıklar",
   "baslik": "Yürüyen yaratıklar",
   "mod": "ultracode",
   "sanat": "assets/gen/yaratiklar.png",
   "alt": "Yürümeyi kimse öğretmiyor, evrim buluyor.",
   "manset": "Kimse yürümeyi öğretmiyor. Birkaç nesilde sendeleme yürüyüşe dönüyor.",
   "detay": "Fizik motorunu da sıfırdan yazdı, 2 boyutlu. İki, dört, altı ve sekiz bacaklı türler, dört farklı zemin.",
   "yarim": {
    "devam_sayisi": 1,
    "durum": "bulut",
    "not": "Yerelde kullanım limiti yüzünden durdu, kalan kısmı Claude Code bulut oturumunda Sonnet 5.5 ile sürüyor."
   },
   "prompt": "Bacaklı yaratıklar tasarla, yürümeyi evrimle kendileri öğrensin, ben canlı izleyeyim.",
   "gorunumler": [
    {
     "id": "yaratiklar",
     "tur": "sayfa",
     "dosya": "index.html",
     "bekle": 15000
    }
   ]
  },
  {
   "slug": "saat",
   "klasor": "mekanik saat",
   "baslik": "Mekanik saat",
   "mod": "normal",
   "sanat": "assets/gen/saat.png",
   "alt": "Zor kısmı: çarklar birbirini gerçekten döndürmeli.",
   "manset": "Animasyon değil, mekanizmanın kendisi. Yay biterse saat duruyor.",
   "detay": "İçini aç kaydırıcısı dokuz katmanı sırayla ayırıyor. Balansın salınımını kuvvetten hesaplamadığını kendisi söylüyor.",
   "prompt": "Bana gerçek çalışan bir mekanik kol saati yap, 3D olsun, içini açıp bakabileyim.",
   "gorunumler": [
    {
     "id": "saat",
     "tur": "sayfa",
     "dosya": "index.html"
    }
   ]
  },
  {
   "slug": "galaksi",
   "klasor": "galaksi çarpışması",
   "baslik": "Galaksi çarpışması",
   "mod": "normal",
   "sanat": "assets/gen/galaksi.png",
   "alt": "İki galaksi, milyarlarca yıl, tek sekme.",
   "manset": "310 bin yıldız GPU'da, 10,5 milyar yıl ileri sarılıyor.",
   "detay": "Beş kamera var, biri Dünya'dan gökyüzüne bakıyor. Tam N-cisim hesabı olmadığını kendisi söylüyor.",
   "prompt": "Samanyolu ile Andromeda'nın çarpışmasını simüle et.",
   "gorunumler": [
    {
     "id": "galaksi",
     "tur": "sayfa",
     "dosya": "index.html",
     "bekle": 38000
    }
   ]
  },
  {
   "slug": "ciftyarik",
   "klasor": "çift yarık",
   "baslik": "Çift yarık",
   "mod": "normal",
   "sanat": "assets/gen/ciftyarik.png",
   "alt": "Fiziğin en tuhaf deneyi, tarayıcıda.",
   "manset": "Schrödinger denklemi GPU'da, gerçek zamanlı çözülüyor.",
   "detay": "Saçak aralığı kuramla yüzde 0,1 farkla tuttu. Dedektörü açınca girişim kayboluyor.",
   "prompt": "Kuantum çift yarık deneyini simüle et.",
   "gorunumler": [
    {
     "id": "ciftyarik",
     "tur": "sayfa",
     "dosya": "index.html"
    }
   ]
  },
  {
   "slug": "isikmasasi",
   "klasor": "ışık masası",
   "baslik": "Işık masası",
   "mod": "normal",
   "sanat": "assets/gen/isikmasasi.png",
   "alt": "Işığın kırılması, ayrışması, yansıması.",
   "manset": "Prizma ışığı gökkuşağına ayırıyor, elmas tam iç yansıma yapıyor.",
   "detay": "Masa 2 boyutlu, üstten bir kesit. Görünsün diye iki parlaklığı bilerek abartmış.",
   "prompt": "Işıkla oynayabileceğim bir masa yap: prizma, mercek, sabun köpüğü, elmas.",
   "gorunumler": [
    {
     "id": "isikmasasi",
     "tur": "sayfa",
     "dosya": "index.html"
    }
   ]
  },
  {
   "slug": "mars",
   "klasor": "mars inişi",
   "baslik": "Mars inişi",
   "mod": "ultracode",
   "sanat": "assets/gen/mars.png",
   "alt": "Elinde sadece NASA'nın iniş videosu var. Gerisini kendi kuruyor.",
   "manset": "Elinde sadece NASA'nın videosu vardı. İnişi 3D'de baştan kurdu.",
   "detay": "Videodaki dört araç kamerası ayrı ayrı izlenebiliyor. İrtifa, hız ve Mach canlı akıyor.",
   "yarim": {
    "devam_sayisi": 0,
    "durum": "duraklatildi",
    "ara": false,
    "not": "Kullanım limitine yaklaşınca durduruldu. Diskte duruyor, kaldığı yerden devam edecek."
   },
   "mudahale": "Zaman daraldığı için 03:41'de 40 dakikalık süre verdi, 03:53'te de durdurdu. Ekrandaki, o andaki hali.",
   "prompt": "Bu videoyu izle ve içinde olanı 3D simülasyon olarak yeniden yap.",
   "gorunumler": [
    {
     "id": "mars",
     "tur": "sayfa",
     "dosya": "index.html",
     "etiket": "Sonnet 5.5, 3D simülasyon",
     "bekle": 12000
    }
   ]
  },
  {
   "slug": "porsche",
   "klasor": "porsche",
   "baslik": "Porsche 911 GT3 RS",
   "mod": "ultracode",
   "sanat": "assets/gen/porsche.png",
   "alt": "Dışarıdan tek bir model ya da doku yok. Her parça kodla.",
   "manset": "Tek bir hazır model ya da doku yok. Gövde, jant, kanat, hepsi kodla.",
   "detay": "Üç gövde yarıştı, hakem paneli birini seçti. DRS kanadı açılıyor, farlar ve fren lambaları yanıyor.",
   "mudahale": "Zaman daraldığı için 03:41'de 40 dakikalık süre verdi, 03:53'te de durdurdu. Ekrandaki, o andaki hali.",
   "prompt": "Porsche 911 GT3 RS'i (992) 3D olarak sıfırdan modelle. Dışarıdan asset kullanman yasak.",
   "gorunumler": [
    {
     "id": "porsche",
     "tur": "sayfa",
     "dosya": "index.html"
    }
   ]
  }
 ],
 "kafa_kafaya": [
  {
   "slug": "galata",
   "klasor": "galata kulesi",
   "baslik": "Galata Kulesi: Sonnet 5 ve Sonnet 5.5",
   "kisa": "Galata Kulesi",
   "sanat": "assets/gen/galata.png",
   "alt": "Aynı prompt, iki model. Solda Sonnet 5, sağda Sonnet 5.5.",
   "kayit": "web arayüzü, kayıt yok",
   "not": "İkisi de claude.ai web arayüzünde, aynı promptla yapıldı. Reasoning ikisinde de Max. Token, süre ve maliyet kaydı yok.",
   "prompt": "bana yapabildiğin en iyi galata kulesi simülasyonunu yap, benchmarktasın çekinme en iyi işini yapmaktan",
   "duzen": "ikili",
   "gorunumler": [
    {
     "id": "galata-sonnet-5",
     "tur": "sayfa",
     "dosya": "sonnet-5/index.html",
     "boyut": [
      1280,
      890
     ],
     "etiket": "Sonnet 5",
     "bekle": 12000
    },
    {
     "id": "galata-sonnet-5-5",
     "tur": "sayfa",
     "dosya": "sonnet-5-5/index.html",
     "boyut": [
      1280,
      890
     ],
     "etiket": "Sonnet 5.5",
     "vurgu": true,
     "bekle": 12000
    }
   ]
  }
 ],
 "resmi": {
  "kaynak": "https://www.anthropic.com/claude-sonnet-5-5",
  "tarih": "28 Eylül 2026",
  "sutunlar": [
   "Sonnet 5.5",
   "Sonnet 5",
   "Opus 5.5",
   "GPT-6 Sol"
  ],
  "satirlar": [
   {
    "alan": "Agentic kodlama",
    "test": "Terminal-Bench 4.0",
    "degerler": [
     "70.6%",
     "10.3%",
     "66.4%¹",
     "—"
    ]
   },
   {
    "alan": "Agentic kodlama",
    "test": "FrontierCode 1.1 (Main)",
    "degerler": [
     "52.1% Xhigh / 46.2% Max²",
     "42.4%",
     "54.4%",
     "49.3%"
    ]
   },
   {
    "alan": "Agentic kodlama",
    "test": "CursorBench 4.0",
    "degerler": [
     "55.5%",
     "34.1%",
     "57.8%",
     "—"
    ]
   },
   {
    "alan": "Bilgi işi",
    "test": "GDPval-AA v2.1³ (Elo)",
    "degerler": [
     "1844",
     "1449",
     "1846",
     "1487⁴"
    ]
   },
   {
    "alan": "Bilgi işi",
    "test": "AA-Briefcase v1.1³ (Elo)",
    "degerler": [
     "1811",
     "1359",
     "1822",
     "1483⁴"
    ]
   },
   {
    "alan": "Çok alanlı akıl yürütme",
    "test": "Humanity's Last Exam (araçlarla)",
    "degerler": [
     "64.5%",
     "54.9%",
     "67.7%",
     "—"
    ]
   },
   {
    "alan": "Bilgisayar kullanımı",
    "test": "OSWorld 2.1 (kısmi puan)",
    "degerler": [
     "80.1%",
     "57.0%",
     "81.8%",
     "—"
    ]
   },
   {
    "alan": "Grafik okuma",
    "test": "Chartography (araçsız)",
    "degerler": [
     "61.6%",
     "15.6%",
     "64.4%",
     "53.6%⁴"
    ]
   }
  ],
  "dipnotlar": {
   "1": "Terminal-Bench 4.0'da Opus 5.5 Xhigh effort sonucu (en yüksek skoru).",
   "2": "Sonnet 5.5 Max effort'ta Xhigh'tan düşük skor aldı; Max'te code-review skill'ini daha sık çalıştırıp kapsam dışı düzenleme yaptı.",
   "3": "Artificial Analysis, sonradan düzeltilen bir yapılandırılmış çıktı hatası olan ön sürümde ölçtü; etkinin küçük olması bekleniyor.",
   "4": "GPT-6 Sol'daki görüntü anlama hatası sonradan düzeltildi; bu skorlar henüz güncellenmemiş olabilir."
  },
  "fiyat_milyon_token_usd": {
   "Sonnet 5.5": {
    "girdi": 2,
    "cikti": 10,
    "cache_okuma": 0.2,
    "cache_yazma": 2.5
   },
   "Opus 5.5": {
    "girdi": 4,
    "cikti": 20,
    "cache_okuma": 0.2,
    "cache_yazma": 5
   }
  },
  "diger": [
   "Sonnet 5'e göre %30'dan fazla hızlı çıktı üretiyor.",
   "Anthropic'e göre çoğu işte görev başına %30'a kadar daha ucuz.",
   "Claude Code ve uygulamalarda varsayılan effort Medium, Claude Platform'da High.",
   "Anthropic'in cümlesi: karmaşık, açık uçlu ve sürekli muhakeme isteyen işlerde Opus 5.5 hâlâ açıkça daha güçlü.",
   "Duyuruda Kevin Ngo (Creative Coder) alıntısı var: Opus 5.5 mimariyi kurarsa uygulamayı Sonnet 5.5'e bırakırım."
  ]
 },
 "resmi_kisa": {
  "baslik": "Resmi benchmark",
  "alt": "Anthropic'in duyuru sayfasından, birebir.",
  "dipnotlar": {
   "1": "Opus 5.5'in Xhigh sonucu, en yüksek skoru.",
   "2": "Sonnet 5.5 Max effort'ta Xhigh'tan düşük aldı: code-review skill'ini daha sık çalıştırıp kapsam dışı düzenleme yaptı.",
   "3": "Artificial Analysis ön sürümde ölçtü; hata sonradan düzeltildi, etkisi küçük bekleniyor.",
   "4": "GPT-6 Sol'daki görüntü hatası sonradan düzeltildi; skor güncellenmemiş olabilir."
  },
  "hiz": "%30+",
  "hiz_alt": "Sonnet 5'ten hızlı çıktı",
  "kaynak": "Kaynak: anthropic.com/claude-sonnet-5-5, 28 Eylül 2026. Rakamlar birebir, yazım Türkçe (ondalık virgül)."
 },
 "kapanis": {
  "baslik": "Bu gece",
  "soru": "Opus kovuldu mu?",
  "skor_satirlari": [
   "GDPval-AA v2.1³ (Elo)",
   "OSWorld 2.1 (kısmi puan)",
   "CursorBench 4.0",
   "Terminal-Bench 4.0"
  ],
  "skor_notu": "Fark çoğunda birkaç puan. Terminal-Bench'te Sonnet önde.",
  "fiyat_notu": "Girdi ve çıktıda tam yarı fiyat.",
  "alinti": "Karmaşık, açık uçlu ve sürekli muhakeme isteyen işlerde Opus 5.5 hala açıkça daha güçlü.",
  "alinti_en": "Opus 5.5 remains clearly stronger at complex, open-ended work requiring sustained judgment.",
  "kaynak": "Hepsi Anthropic'in duyuru sayfasından: anthropic.com/claude-sonnet-5-5"
 }
};
