# HOROS Kalibre 01 — Çalışan 3B Mekanik Kol Saati

`index.html` dosyasını tarayıcıda aç (internet gerekmez, tek dosya paketlenmiş: `app.js`).

## Neler gerçek?

- **Dişli takımı**: fıçı 80 → merkez pinyonu 10 → merkez çarkı 80 → 3. pinyon 10 → 3. çark 75 → 4. pinyon 10 → 4. çark 84 → çıkış pinyonu 7 → çıkış çarkı 15 diş.
  Pinyon profilleri, onları çeviren çarkın süpürme zarfından türetilir; dişliler sıfır girişimle kavraşır.
- **Çıkış (İsviçre çapası)**: çapa taşları ile çıkış çarkı dişleri arasındaki temas geometrik olarak çözülür (kilit, draw, empuls, düşme).
  Balans 3 Hz (21.600 A/S) çalışır; çark her vuruşta tam 12° ilerler, saniye ibresi saniyede 6 adım atar.
- **Enerji zinciri**: ana yay → fıçı → tren → çıkış. Yay boşaldıkça balans genliği düşer, yay bitince saat durur.
  Yay kutusunun kapağını kaldırınca yayın sarımının gerçekten kurulma durumuna göre değiştiğini görebilirsin.
- **Kurma ve ayar**: taç → konik pinyon → taç çarkı → mandal çarkı → fıçı mili (mandal tıkırtısıyla). Taç çekilince aynı pinyon ayar çarkına geçer,
  kanon pinyonu kayarak akrep ve yelkovanı (12:1) ilerletir.
- **Otomatik kurma**: rotor → tek yönlü kavrama → 15,36:1 indirgeme → mandal çarkı.

## Kullanım

- Sürükle: döndür · Tekerlek: yakınlaş · Sağ tuş: kaydır
- Parçanın üzerine gel: adı; tıkla: nasıl çalıştığı
- Taç: yukarı sürükle = kur · çift tıkla = çek/it · rotoru fareyle çevir
- Boşluk: duraklat · `E`: içini aç · `1`–`8`: görünümler · `H`: paneli göster

## Geliştirme

```
npm install
npm run build   # src/ → app.js
```
