// Parça bilgileri (Türkçe). specs: [etiket, değer]
export const INFO = {
  case: {
    title: 'Kasa',
    text: 'Paslanmaz çelik kasa; içindeki mekanizmayı toz, nem ve darbeden korur. Kulaklar kayışı tutar. Kasanın arkası safir camlıdır, saatin içi buradan görünür.',
    specs: [['Çap', '41 mm'], ['Malzeme', '316L çelik'], ['Su geçirmezlik', '50 m']],
  },
  crystal: {
    title: 'Safir cam ve çerçeve',
    text: 'Yapay safirden yapılmış kubbeli cam çizilmeye neredeyse dayanıklıdır. Cilalı çerçeve camı yerinde tutar.',
    specs: [['Sertlik', 'Mohs 9'], ['Biçim', 'Kubbeli']],
  },
  caseback: {
    title: 'Şeffaf kasa arkası',
    text: 'Altı vidalı çelik halka ve düz safir cam. Mekanizmayı ve dönen rotoru bileğin tarafından izleyebilmeni sağlar.',
    specs: [['Vida', '6 adet'], ['Cam', 'Safir']],
  },
  crown: {
    title: 'Taç',
    text: 'Sürükleyerek veya kaydırarak çevirirsin. İtilmiş konumda saati kurar; dışarı çekilince (çift tıkla) akrep ve yelkovanı ayarlar. Mil ucundaki konik pinyon iki farklı dişliyi sırayla çevirir.',
    specs: [['Konumlar', '0: kurma · 1: zaman ayarı'], ['Mil pinyonu', '12 diş konik']],
  },
  dial: {
    title: 'Kadran',
    text: 'Güneş ışını (sunburst) işlemeli metal kadran. Gül altın kaplama indeksler uygulanmıştır. 9 yönündeki küçük kadran saniyeyi gösterir; saniye çarkı tam orada döner.',
    specs: [['Çap', '35 mm'], ['Gösterge', 'Saat · dakika · küçük saniye']],
  },
  hands: {
    title: 'İbreler',
    text: 'Akrep (saat) ve yelkovan (dakika) ortak eksende iki iç içe boru üzerinde döner. Küçük saniye ibresi dördüncü çarkın miline takılıdır ve saniyede altı adım atar.',
    specs: [['Akrep', '12 saatte 1 devir'], ['Yelkovan', '1 saatte 1 devir'], ['Saniye', '60 sn/devir, 6 adım/sn']],
  },
  motion: {
    title: 'Kadran altı mekanizma',
    text: 'Kanon pinyonu (12 diş) dakika çarkını (36) çevirir; dakika pinyonu (9) saat çarkını (36) çevirir. Toplam oran 12:1: yelkovan 12 tur atarken akrep bir tur atar. Tacı çekip döndürdüğünde kanon pinyonu miline sürtünmeyle oturduğu için ibreler tren bozulmadan kayar.',
    specs: [['Oran', '12 : 1'], ['Dişliler', '12 · 36 · 9 · 36']],
  },
  plate: {
    title: 'Ana plaka',
    text: 'Bütün çarkların alt pivotlarını taşıyan omurga. Yüzeyi perlage (daire taşlama) ile işlenmiştir. Yakut taşlar sürtünmeyi azaltmak için pivotların oturduğu yataklardır.',
    specs: [['Kalınlık', '1,2 mm'], ['Yüzey', 'Perlage']],
  },
  barrel: {
    title: 'Yay kutusu (fıçı) ve ana yay',
    text: 'Enerji burada saklanır. Kuruldukça mil çevresine sarılan ince çelik şerit gerilir; boşalırken kutuyu döndürür. Kutunun dişleri merkez pinyonunu çevirir. Kapağı kaldırıp yayın sarımını izleyebilirsin.',
    specs: [['Diş', '80'], ['Yay', '≈ 5,4 tur kurma'], ['Güç rezervi', '≈ 43 saat'], ['Devir', '8 saatte 1']],
  },
  center: {
    title: 'Merkez çarkı',
    text: 'Saatte tam bir devir yapar; yelkovan buna bağlıdır. Yay kutusundan gelen torku üçüncü çarka iletir.',
    specs: [['Diş', '80'], ['Pinyon', '10'], ['Hız', '1 devir/saat']],
  },
  third: {
    title: 'Üçüncü çark',
    text: 'Merkez çarkının hızını artırıp dördüncü çarka aktaran ara çark.',
    specs: [['Diş', '75'], ['Pinyon', '10'], ['Hız', '8 devir/saat']],
  },
  fourth: {
    title: 'Dördüncü çark (saniye çarkı)',
    text: 'Dakikada tam bir devir yapar ve küçük saniye ibresini taşır. Kendi pinyonu üçüncü çarkla, dişi ise çıkış çarkının pinyonuyla kavraşır.',
    specs: [['Diş', '84'], ['Pinyon', '10'], ['Hız', '1 devir/dakika']],
  },
  escape: {
    title: 'Çıkış çarkı',
    text: 'On beş dişli çelik çark. Çapa (pallet fork) onu her vuruşta bırakır ve yeniden kilitler; çark her vuruşta yarım diş (12°) ilerler. Dişlerin ucundan aldığı itki çapa ve balansa enerji verir.',
    specs: [['Diş', '15'], ['Pinyon', '7'], ['Hız', '12 devir/dakika'], ['Adım', '12° / vuruş']],
  },
  fork: {
    title: 'Çapa (pallet fork)',
    text: 'İki yakut palet taşı taşır. Kilitte çarkı tutar; balans empuls taşıyla çatalı çevirince bırakır, çarkın dişi paletin eğimli yüzünde kayarak balansa küçük bir itki verir ve sonraki diş diğer palete düşer. Sesli "tik-tak"ın kaynağı budur.',
    specs: [['Toplam sapma', '≈ 9,7°'], ['Taş', '2 palet + 1 empuls']],
  },
  balance: {
    title: 'Denge çarkı ve saç yay',
    text: 'Saatin kalbi. Saç yayla birlikte yaklaşık 3 Hz (saatte 21.600 yarım salınım) sabit hızla ileri geri döner. Her salınımda çapa bir diş bırakır. Yay sarımı solunum gibi genişleyip daralır. Genlik ana yay boşaldıkça düşer.',
    specs: [['Frekans', '3 Hz (21.600 A/S)'], ['Genlik', '200°–300°'], ['Jant', '10,8 mm']],
  },
  barrelBridge: {
    title: 'Fıçı köprüsü',
    text: 'Yay kutusunun üst pivotunu ve taç çarkının milini tutar. Yüzeyi Cenevre şeritleri (Côtes de Genève) ile işlenmiştir.',
    specs: [['Yüzey', 'Côtes de Genève']],
  },
  trainBridge: {
    title: 'Dişli köprüsü',
    text: 'Merkez, üçüncü ve dördüncü çarkların üst pivotlarını taşıyan köprü. Çarkların eksenlerini plakayla birlikte hassas biçimde sabit tutar.',
    specs: [['Taş', '3 adet']],
  },
  palletBridge: {
    title: 'Çıkış köprüsü',
    text: 'Çıkış çarkı ve çapanın üst pivotlarını taşır. Çıkış çarkının dişleri köprünün altından taşarak görünür.',
    specs: [['Taş', '2 adet']],
  },
  cock: {
    title: 'Balans köprüsü (cock)',
    text: 'Balansın üst pivotunu taşır. Üzerinde saç yayın dış ucunu tutan stud ve hızı ayarlayan regülatör (iki pimli ayar kolu) bulunur.',
    specs: [['Ayar', 'Regülatör kolu']],
  },
  ratchet: {
    title: 'Mandal çarkı ve mandal',
    text: 'Yay kutusunun miline vidalıdır. Taçtan ya da rotordan gelen dönme ile yayı sarar; mandal (click) çarkın testere dişlerinin ucunda kayıp geri dönüşü engeller, kurulan enerji geri kaçmaz.',
    specs: [['Diş', '48'], ['Mandal', 'Yaylı çengel']],
  },
  crownWheel: {
    title: 'Taç çarkı',
    text: 'Tacın mili konik pinyon aracılığıyla bu çarkı döndürür; çarkın düz dişleri mandal çarkını çevirir. Yani tacın 1 turu, yay milini yaklaşık 0,4 tur döndürür.',
    specs: [['Diş', '24 konik + 39 düz'], ['Oran', '1 taç turu = 0,41 mil turu']],
  },
  stem: {
    title: 'Kurma mili ve konik pinyon',
    text: 'Taç dışarı çekilince mil 2 mm kayar; konik pinyon alttaki taç çarkından ayrılıp üstteki ayar çarkına geçer. Böylece aynı mil önce yayı kurar, sonra ibreleri çevirir.',
    specs: [['Pinyon', '12 diş konik'], ['Kayma', '2 mm']],
  },
  setting: {
    title: 'Ayar çarkı',
    text: 'Yalnızca taç çekilince mile bağlanır ve dakika çarkını çevirir. Ayar sırasında saat çalışmaya devam eder.',
    specs: [['Diş', '20 düz + 24 konik']],
  },
  minute: {
    title: 'Dakika çarkı',
    text: 'Kanon pinyonundan dönüşü alıp saat çarkına iletir. Aynı miline takılı küçük pinyon saat çarkını sürer.',
    specs: [['Diş', '36'], ['Pinyon', '9']],
  },
  cannon: {
    title: 'Kanon pinyonu ve saat çarkı',
    text: 'Kanon pinyonu merkez milinde sürtünmeyle oturur ve yelkovanı taşır. Saat çarkının borusu akrebi taşır; iki boru ortak eksende iç içe geçer.',
    specs: [['Kanon', '12 diş'], ['Saat çarkı', '36 diş']],
  },
  rotor: {
    title: 'Rotor (otomatik kurma)',
    text: 'Bilek hareketiyle serbestçe dönen ağır yarım daire. Dönerken tek yönlü kavrama ve indirgeme dişlisi aracılığıyla ana yayı kurar. Tek yönlü kavrama yüzünden yalnızca bir yönde dönerken yayı kurar. Sürükleyerek çevirebilir veya "Bileği salla" ile sallayabilirsin.',
    specs: [['Rulman', 'Bilyalı'], ['Oran', 'Rotor 15,4 tur = mil 1 tur']],
  },
  rotorGear: {
    title: 'Otomatik kurma dişlileri',
    text: 'Rotor pinyonu (10) ve ara çark (32) dönüşü ~15 kat yavaşlatıp mandal çarkına ulaştırır: rotorun çok turu yayın birkaç derecesini kurar.',
    specs: [['Oran', '15,36 : 1']],
  },
};

export const CHAIN = [
  ['barrel', 'Yay kutusu'],
  ['center', 'Merkez çarkı'],
  ['third', 'Üçüncü çark'],
  ['fourth', 'Saniye çarkı'],
  ['escape', 'Çıkış çarkı'],
  ['fork', 'Çapa'],
  ['balance', 'Denge çarkı'],
];
