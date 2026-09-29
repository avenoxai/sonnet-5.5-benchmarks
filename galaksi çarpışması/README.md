# Samanyolu × Andromeda — galaksi çarpışması simülasyonu

`index.html` dosyasını bir tarayıcıda (güncel Chrome / Safari / Firefox, WebGL2 gerekir) açmanız yeterli; sunucu gerekmez.

## Ne gösteriyor?
Bugünden ~10,5 milyar yıl sonrasına kadar iki galaksinin birleşmesi: yaklaşma → ilk yakın geçiş (~4,2 milyar yıl) →
gel-git kuyrukları ve köprüler → ikinci geçiş (~6 milyar yıl) → birleşme (~7,4 milyar yıl) → “Milkomeda”.
Güneş ayrıca izlenir; “Dünya'dan gökyüzü” modunda gökyüzünde Andromeda'nın büyümesi görülür.

## Nasıl çalışıyor?
* **Başlangıç koşulları gerçek gözleme dayanır:** 780 kpc mesafe, ~110 km/s yaklaşma hızı, Andromeda'nın Güneş'ten
  görünen yönü (l = 121°, b = −22°), Güneş'in Samanyolu'ndaki konumu ve hızı (8,2 kpc, ~220 km/s).
* **Fizik (`physics.js`):** Her galaksi = Hernquist çıkıntı + Miyamoto–Nagai disk + Hernquist karanlık madde halesi.
  İki galaksinin merkezleri çift-cisim olarak (RK4, çift duyarlık) ve yumuşatılmış Chandrasekhar **dinamik sürtünmesi**
  ile ilerler; yörünge önceden hesaplanır (zaman çizelgesindeki eğri budur).
* **Yıldızlar (`index.html`):** ~310 bin test parçacığı, iki galaksinin birleşik alanında GPU'da (WebGL2 transform feedback,
  parçacık başına uyarlanabilir alt-adımlı leapfrog) her karede ilerletilir. Anlık görüntüler sayesinde zaman çizelgesinde
  ileri-geri sarılabilir.
* **Görüntü:** HDR sahne, toz soğurması, gel-git kaynaklı yıldız oluşumu parlaması, bloom ve asinh gerdirmeli filmik ton eşleme.

## Sınırlar (dürüst not)
Bu tam bir N-cisim hesabı değil, “kısıtlı” bir modeldir: yıldızlar birbirini çekmez, spiral kollar kayan bir yoğunluk
örüntüsüyle çizilir, gaz fiziği yoktur. Zamanlamalar gerçek tahminlerle (≈4–5 milyar yıl ilk geçiş, ≈6–7 milyar yıl
birleşme) aynı mertebededir; ayrıntılar (kuyrukların biçimi, Güneş'in kaderi) yalnızca bir olası senaryodur.

## Kontroller
Sürükle: döndür · Tekerlek: yakınlaş · Çift tık: kamerayı sıfırla · Boşluk: oynat/duraklat · ← →: ±100 milyon yıl (Shift ±500) ·
1–5: kamera · [ ]: hız · R: başa sar · L / T / D: etiket / Güneş izi / toz · H: arayüzü gizle · I: bilgi.
