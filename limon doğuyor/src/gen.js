// Limon.TRGen -- sonsuz, dilbilgisel olarak dogru Turkce cumle / paragraf / diyalog ureteci.
// Bolumler:  1 fonoloji ve ek motoru   2 sozluk (veri tablolari)   3 varlik/ozne/obek kurucular
//            4 cumle aileleri          5 paragraflar               6 soru-cevap ve diyalog   7 API
// Kural: emin olunmayan kelime/istisna KONMAZ. Hatali Turkce modeli zehirler.
// Ust/alt harf donusumu her yerde Limon.Util.lowerTR/upperTR (yoksa ayni davranisli yerel kopya).
(function (root) {
  'use strict';
  const Limon = (root.Limon = root.Limon || {});
  const UT = Limon.Util || {};
  const lowerTR = UT.lowerTR || function (s) { return s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); };
  const upperTR = UT.upperTR || function (s) { return s.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase(); };
  const mkRng = UT.rng || function (seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // =====================================================================================
  // 1. FONOLOJI VE EK MOTORU
  // Ek kaliplari: A = a/e (iki yonlu), I = ı/i/u/ü (dort yonlu), D = d/t, C = c/ç.
  // (y) (n) (s) gibi kucuk harfli parantez: govde unluyle bitiyorsa eklenen kaynastirma unsuzu.
  // (I) (A): govde unsuzle bitiyorsa eklenen kaynastirma unlusu.
  // =====================================================================================
  const VOW = 'aeıioöuü';
  const VLESS = 'çfhkpsşt'; // sert unsuzler (fıstıkçı şahap)
  function isV(c) { return c !== '' && VOW.indexOf(c) >= 0; }
  function lastV(s) { for (let i = s.length - 1; i >= 0; i--) if (VOW.indexOf(s.charAt(i)) >= 0) return s.charAt(i); return 'e'; }
  function endsV(s) { return VOW.indexOf(s.charAt(s.length - 1)) >= 0; }
  function countV(s) { let n = 0; for (let i = 0; i < s.length; i++) if (VOW.indexOf(s.charAt(i)) >= 0) n++; return n; }
  function hA(v) { return (v === 'a' || v === 'ı' || v === 'o' || v === 'u') ? 'a' : 'e'; }
  function hI(v) {
    switch (v) { case 'a': case 'ı': return 'ı'; case 'e': case 'i': return 'i'; case 'o': case 'u': return 'u'; default: return 'ü'; }
  }

  function join(stem, hv, pats) {
    let out = stem, h = hv || lastV(stem);
    for (let k = 0; k < pats.length; k++) {
      const p = pats[k];
      for (let i = 0; i < p.length; i++) {
        const c = p.charAt(i);
        if (c === '(') {
          const j = p.indexOf(')', i), b = p.substring(i + 1, j); i = j;
          if (b === 'I' || b === 'A') {
            if (!endsV(out)) { const v = b === 'I' ? hI(h) : hA(h); out += v; h = v; }
          } else if (endsV(out)) out += b;
        } else if (c === 'A') { const v = hA(h); out += v; h = v; }
        else if (c === 'I') { const v = hI(h); out += v; h = v; }
        else if (c === 'D') out += VLESS.indexOf(out.charAt(out.length - 1)) >= 0 ? 't' : 'd';
        else if (c === 'C') out += VLESS.indexOf(out.charAt(out.length - 1)) >= 0 ? 'ç' : 'c';
        else { out += c; if (isV(c)) h = c; }
      }
    }
    return out;
  }
  // Ek unluyle mi basliyor (govde unsuzle bitiyorsa)? -> yumusama / unlu dusmesi / git->gid icin
  function vinit(p) {
    let i = 0;
    while (p.charAt(i) === '(') { const j = p.indexOf(')', i); const b = p.substring(i + 1, j); if (b === 'I' || b === 'A') return true; i = j + 1; }
    const c = p.charAt(i);
    return c === 'A' || c === 'I' || isV(c);
  }

  // ---- isim ----
  const POSSP = ['', '(I)m', '(I)n', '(s)I', '(I)mIz', '(I)nIz', 'lArI'];
  const CASE1 = ['', '(y)I', '(y)A', 'DA', 'DAn', '(n)In', '(y)lA'];
  const CASE3 = ['', '(n)I', '(n)A', '(n)DA', '(n)DAn', '(n)In', '(y)lA'];
  // cs: 0 yalin, 1 -I (belirtme), 2 -A (yonelme), 3 -DA (bulunma), 4 -DAn (ayrilma), 5 -(n)In (iyelik/tamlayan), 6 ile
  const SOFT = { p: 'b', ç: 'c', t: 'd', k: 'ğ' };

  function softStem(w, fl) {
    if (fl.d) return fl.d;
    const last = w.charAt(w.length - 1);
    if (!SOFT[last]) return null;
    if (last === 't' && !fl.s) return null;
    if (countV(w) === 1 && !fl.s) return null;
    if (last === 'k') {
      if (w.endsWith('nk')) return w.slice(0, -2) + 'ng';
      if (!isV(w.charAt(w.length - 2)) && !fl.s) return null;
    }
    return w.slice(0, -1) + SOFT[last];
  }

  // Isim nesnesi: { w, v (unluyle baslayan ekten once govde), f (on unlu uyumu), y (su), u (sayilamaz), tags, ... }
  function mkNoun(w, fl) {
    const n = { w: w, v: null, f: !!fl.f, y: !!fl.y, u: !!fl.u, c: !!fl.c, tags: [], cls: '', head: null, pre: '' };
    n.v = softStem(w, fl);
    return n;
  }
  function vharm(n) { return n.f ? 'e' : lastV(n.w); }

  function nform(n, pl, poss, cs) {
    if (n.head) return n.pre + nform(n.head, pl, poss || 3, cs); // "cay bardagi": on kisim sabit, baş iyelik alir
    if (n.ps && pl) return nform(n.ps, true, 3, cs);
    const pats = [];
    if (pl && poss !== 6) pats.push('lAr');
    if (poss) pats.push(n.y ? '(y)' + (poss === 3 ? 'I' : POSSP[poss]) : POSSP[poss]);
    if (cs) {
      if (n.y && poss === 0 && cs === 5) pats.push('(y)In');
      else pats.push(((poss === 3 || poss === 6 || n.c) ? CASE3 : CASE1)[cs]);
    }
    if (!pats.length) return n.w;
    const stem = (n.v !== null && vinit(pats[0])) ? n.v : n.w;
    return join(stem, vharm(n), pats);
  }

  function nameForm(nm, cs) {
    if (!cs) return nm;
    const s = join(nm, null, [CASE1[cs]]);
    return nm + "'" + s.substring(nm.length);
  }

  // ---- zamirler ----
  const PRON = [ // yalin, -I, -A, -DA, -DAn, tamlayan, ile
    ['ben', 'beni', 'bana', 'bende', 'benden', 'benim', 'benimle'],
    ['sen', 'seni', 'sana', 'sende', 'senden', 'senin', 'seninle'],
    ['o', 'onu', 'ona', 'onda', 'ondan', 'onun', 'onunla'],
    ['biz', 'bizi', 'bize', 'bizde', 'bizden', 'bizim', 'bizimle'],
    ['siz', 'sizi', 'size', 'sizde', 'sizden', 'sizin', 'sizinle'],
    ['onlar', 'onları', 'onlara', 'onlarda', 'onlardan', 'onların', 'onlarla'],
  ];
  const DEMON = [ // bu, su, bunlar, sunlar
    ['bu', 'bunu', 'buna', 'bunda', 'bundan', 'bunun', 'bununla'],
    ['şu', 'şunu', 'şuna', 'şunda', 'şundan', 'şunun', 'şununla'],
    ['bunlar', 'bunları', 'bunlara', 'bunlarda', 'bunlardan', 'bunların', 'bunlarla'],
    ['şunlar', 'şunları', 'şunlara', 'şunlarda', 'şunlardan', 'şunların', 'şunlarla'],
  ];

  // ---- sayilar ----
  const ONES = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
  const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
  function numWord(n) {
    if (n < 10) return ONES[n];
    if (n < 100) return TENS[(n / 10) | 0] + (n % 10 ? ' ' + ONES[n % 10] : '');
    if (n < 1000) { const h = (n / 100) | 0; return (h > 1 ? ONES[h] + ' ' : '') + 'yüz' + (n % 100 ? ' ' + numWord(n % 100) : ''); }
    const t = (n / 1000) | 0; return (t > 1 ? numWord(t) + ' ' : '') + 'bin' + (n % 1000 ? ' ' + numWord(n % 1000) : '');
  }
  // sayi + ek:  numSuf(7, 'DA') -> "yedide"
  function numSuf(n, pat) { const w = numWord(n); return join(w, null, [pat]); }

  // ---- fiil ----
  // Fiil nesnesi: { s (govde), alt (unluyle baslayan ekten once), yi (ye/de -> yi/di), aor ('r','I','A'), pre (on soz), ... }
  const IR_MONO = { al: 1, bil: 1, bul: 1, dur: 1, gel: 1, gör: 1, kal: 1, ol: 1, öl: 1, san: 1, var: 1, ver: 1, vur: 1 };
  function mkVerb(s, o) {
    const v = { s: s, alt: o.alt || null, yi: null, aor: o.aor || '', pre: o.pre || '', tr: 0, sj: [], ob: [], loc: [], nm: !!o.nm, tags: [] };
    if (s === 'ye') v.yi = 'yi'; else if (s === 'de') v.yi = 'di';
    if (!v.aor) v.aor = endsV(s) ? 'r' : (countV(s) > 1 ? 'I' : (IR_MONO[s] ? 'I' : 'A'));
    return v;
  }
  // ek unluyle (V) / y-kaynastirmali (Y) basliyorsa uygun govde
  function vsel(v, vow, y) {
    if (v.yi) return y ? v.yi : v.s;
    if (v.alt) return vow ? v.alt : v.s;
    return v.s;
  }
  const Z = ['(y)(I)m', 'sIn', '', '(y)(I)z', 'sInIz', 'lAr']; // -Ir/-Iyor/-mIş/-AcAk sonrasi kisi ekleri (z tipi) ve ek-fiil
  const K = ['m', 'n', '', 'k', 'nIz', 'lAr'];                  // -DI, -sA sonrasi kisi ekleri (k tipi)

  // -Iyor: a/e ile biten govdede daralma (bekle -> bekliyor, oyna -> oynuyor, söyle -> söylüyor)
  function narrowForProg(x) {
    const last = x.charAt(x.length - 1);
    if (last === 'a' || last === 'e') {
      let p = '';
      for (let i = x.length - 2; i >= 0; i--) if (isV(x.charAt(i))) { p = x.charAt(i); break; }
      const nv = hI(p || last);
      return x.slice(0, -1) + nv;
    }
    return x;
  }
  function progStem(x) {
    const last = x.charAt(x.length - 1);
    if (last === 'a' || last === 'e') return narrowForProg(x) + 'yor';
    if (isV(last)) return x + 'yor';
    return join(x, null, ['Iyor']);
  }

  // Olumsuz/yeterlik dahil govde. kind: 'C' unsuz baslayan ek, 'V' unlu, 'Y' y-kaynastirmali
  function vbase(v, o, kind) {
    if (o.a) {
      const sb = vsel(v, true, true);
      return o.n ? join(sb, null, ['(y)A', 'mA']) : join(sb, null, ['(y)Abil']);
    }
    if (o.n) return join(v.s, null, ['mA']);
    return vsel(v, kind !== 'C', kind === 'Y');
  }

  // Ana catı: v fiil, o = { t: zaman, p: kisi 0..5, n: olumsuz, a: yeterlik, q: soru }
  // zamanlar: past, prog, fut, aor, evid, imp, nec, cond (yalin -sA), condaor (-Irsa)
  function vfull(v, o) {
    const t = o.t, p = o.p | 0, x = { n: !!o.n, a: !!o.a };
    let core = '', full = '', zt = true; // zt: kisi eki z tipi mi (soru eki kisi alir)
    switch (t) {
      case 'past': { const b = vbase(v, x, 'C'); core = join(b, null, ['DI']); full = join(core, null, [K[p]]); zt = false; break; }
      case 'prog': { const b = vbase(v, x, 'Y'); core = progStem(b); full = join(core, null, [Z[p]]); break; }
      case 'fut': {
        const b = vbase(v, x, 'Y'); core = join(b, null, ['(y)AcAk']);
        if (p === 0 || p === 3) { const sft = core.slice(0, -1) + 'ğ'; full = join(sft, null, [p === 0 ? '(I)m' : '(I)z']); }
        else full = join(core, null, [Z[p]]);
        break;
      }
      case 'aor': {
        if (x.n) {
          const b = vbase(v, x, 'C');
          core = join(b, null, ['z']);
          if (p === 0) full = join(b, null, ['m']);
          else if (p === 3) full = join(b, null, ['(y)(I)z']);
          else full = join(core, null, [Z[p]]);
        } else {
          const ty = x.a ? 'I' : v.aor;
          const b = vbase(v, x, ty === 'r' ? 'C' : 'V');
          core = join(b, null, [ty === 'r' ? 'r' : (ty === 'I' ? 'Ir' : 'Ar')]);
          full = join(core, null, [Z[p]]);
        }
        break;
      }
      case 'evid': { const b = vbase(v, x, 'C'); core = join(b, null, ['mIş']); full = join(core, null, [Z[p]]); break; }
      case 'nec': { const b = vbase(v, x, 'C'); core = join(b, null, ['mAlI']); full = join(core, null, [Z[p]]); break; }
      case 'cond': { const b = vbase(v, x, 'C'); core = join(b, null, ['sA']); full = join(core, null, [K[p]]); zt = false; break; }
      case 'condaor': {
        let c3;
        if (x.n) c3 = join(vbase(v, x, 'C'), null, ['z']);
        else { const ty = x.a ? 'I' : v.aor; c3 = join(vbase(v, x, ty === 'r' ? 'C' : 'V'), null, [ty === 'r' ? 'r' : (ty === 'I' ? 'Ir' : 'Ar')]); }
        if (p === 5) { core = join(c3, null, ['lAr', 'sA']); full = core; }
        else { core = join(c3, null, ['sA']); full = join(core, null, [K[p]]); }
        zt = false; break;
      }
      case 'imp': {
        if (p === 1) { full = x.n || x.a ? vbase(v, x, 'C') : v.s; }
        else if (p === 4) full = join(vbase(v, x, 'Y'), null, ['(y)In']);
        else if (p === 2) full = join(vbase(v, x, 'C'), null, ['sIn']);
        else if (p === 5) full = join(vbase(v, x, 'C'), null, ['sInlAr']);
        else if (p === 0) full = join(vbase(v, x, 'Y'), null, ['(y)AyIm']);
        else full = join(vbase(v, x, 'Y'), null, ['(y)AlIm']);
        core = full; zt = false; break;
      }
      default: throw new Error('zaman? ' + t);
    }
    return { core: core, full: full, zt: zt };
  }
  // Soru eki mI (ayri yazilir): z tipi zamanlarda kisi eki mI'ya biner
  function mI(word, p, zt) {
    const m = 'm' + hI(lastV(word));
    return zt ? join(m, null, [Z[p] === 'lAr' ? '' : Z[p]]) : m;
  }
  function vform(v, o) {
    const r = vfull(v, o);
    if (!o.q) return v.pre + r.full;
    if (r.zt) {
      if ((o.p | 0) === 5) return v.pre + r.full + ' ' + mI(r.full, 5, false);
      return v.pre + r.core + ' ' + mI(r.core, o.p | 0, true);
    }
    return v.pre + r.full + ' ' + mI(r.full, 2, false);
  }

  // Zarf-fiil / sifat-fiil / eylemlik (kisi eki yok)
  function vnon(v, kind, o) {
    o = o || {};
    const x = { n: !!o.n, a: !!o.a };
    switch (kind) {
      case 'ken': { const c = vfull(v, { t: 'aor', p: 2, n: x.n, a: x.a }).full; return v.pre + join(c, null, ['(y)ken']); }
      case 'ip': return v.pre + join(vbase(v, x, 'Y'), null, ['(y)Ip']);
      case 'inca': return v.pre + join(vbase(v, x, 'Y'), null, ['(y)IncA']);
      case 'erek': return v.pre + join(vbase(v, x, 'Y'), null, ['(y)ArAk']);
      case 'an': return v.pre + join(vbase(v, x, 'Y'), null, ['(y)An']);
      case 'mak': return v.pre + join(vbase(v, x, 'C'), null, ['mAk']);
      case 'madan': return v.pre + join(vbase(v, x, 'C'), null, ['mAdAn']);
      case 'diktan': return v.pre + join(vbase(v, x, 'C'), null, ['DIktAn']);
      default: throw new Error('vnon? ' + kind);
    }
  }
  // Eylemlik + hal eki: okumak -> okumayi (cs 1), okumaya (cs 2)
  function vinf(v, cs, o) {
    o = o || {};
    const b = vbase(v, { n: !!o.n, a: !!o.a }, 'C');
    const w = join(b, null, ['mA']);
    return v.pre + join(w, null, [cs ? CASE1[cs] : '']);
  }
  // -DIk / -AcAk ad-fiili + iyelik (+ hal): gittigi, gelecegini
  function vpart(v, kind, poss, cs, o) {
    o = o || {};
    const b = vbase(v, { n: !!o.n, a: !!o.a }, kind === 'dik' ? 'C' : 'Y');
    const core = join(b, null, [kind === 'dik' ? 'DIk' : '(y)AcAk']);
    const noun = { w: core, v: core.slice(0, -1) + 'ğ', f: false, y: false, c: false, head: null };
    return v.pre + nform(noun, false, poss, cs);
  }

  // ---- ek-fiil (isim/sifat yuklemi) ----
  // kind: 'pres' | 'past' | 'dir' | 'evid' | 'cond'; neg: degil
  // Cok heceli k ile biten sozcuk, unluyle baslayan 1. kisi ekinden once yumusar: büyük -> büyüğüm, büyüğüz
  function softK(word) {
    const sp = word.lastIndexOf(' '), last = word.slice(sp + 1);
    if (last.length > 2 && last.charAt(last.length - 1) === 'k' && countV(last) > 1 && !last.endsWith('nk') && VOW.indexOf(last.charAt(last.length - 2)) >= 0)
      return word.slice(0, word.length - 1) + 'ğ';
    return word;
  }
  function npred(word, p, kind, neg, q) {
    let core, full, zt = true;
    if (kind === 'past') {
      if (neg) full = join('değil', null, ['DI', K[p]]); else full = join(word, null, ['(y)DI', K[p]]);
      zt = false;
    } else if (kind === 'dir') {
      full = neg ? 'değildir' : join(word, null, ['DIr']); zt = false;
    } else if (kind === 'evid') {
      full = neg ? join('değil', null, ['mIş', Z[p]]) : join(word, null, ['(y)mIş', Z[p]]); zt = false;
    } else if (kind === 'cond') {
      full = neg ? join('değil', null, ['sA', K[p]]) : join(word, null, ['(y)sA', K[p]]); zt = false;
    } else {
      const w = (p === 0 || p === 3) ? softK(word) : word;
      if (neg) { core = 'değil'; full = join('değil', null, [Z[p]]); }
      else { core = w; full = join(w, null, [Z[p]]); }
    }
    if (!q) return full;
    if (zt) { if (p === 5) { const c5 = join(core, null, ['lAr']); return c5 + ' ' + mI(c5, 5, false); } return core + ' ' + mI(core, p, true); }
    return full + ' ' + mI(full, 2, false);
  }

  // =====================================================================================
  // 2. SOZLUK
  // 2a. Isimler.  Satir: [etiketler, kelimeler].  Ilk etiket = ana sinif.  Ayni kelime birden cok satirda gecebilir (etiketler birlesir).
  // Kelime bicimi:  kelime[:bayraklar]   '_' = bosluk (cok sozcuklu)   'on+bas' = belirtisiz tamlama (on kisim + bas -sI)
  // Bayraklar: s = govde yumusar (tek heceli istisna: renk, gok, kalp, guc, tat, kurt, armut, nohut, simit ...) ; n = yumusamaz (merak)
  //            f = on unlu uyumu (saat -> saati, harf, hayal, kalp) ; d=govde = unlu dusmesi (burun:d=burn) ; y = su (suyu, suyun) ;
  //            u = sayilamaz/kutle ; c = sabit -sI ile biten bilesik (havaalani -> havaalanina).
  // Yumusama otomatik: cok heceli p/ç/k sonu yumusar (kitap->kitabi, agac->agaci, cocuk->cocugu), t sonu yumusamaz (sepet->sepeti).
  // =====================================================================================
  const NOUN_DEFS = [
    // ---- insanlar ----
    ['hum fam', 'anne baba kardeş abla ağabey dede nine babaanne anneanne teyze amca hala dayı kuzen torun oğul:d=oğl'],
    ['hum job', 'öğretmen doktor hemşire polis itfaiyeci pilot aşçı garson berber kasap bakkal manav terzi şoför çiftçi balıkçı ressam yazar şair müzisyen oyuncu sporcu futbolcu mühendis işçi tamirci fırıncı kuaför bahçıvan arıcı çoban gazeteci avukat pazarcı kaptan marangoz veteriner mimar sanatçı müdür'],
    ['hum kid', 'çocuk kız oğlan öğrenci'],
    ['hum', 'arkadaş komşu misafir yolcu müşteri adam kadın insan turist sınıf+arkadaş'],
    ['hum tale', 'kral kraliçe prens prenses peri sihirbaz'],
    ['baby', 'bebek'],

    // ---- hayvanlar ----
    ['animal land pet', 'kedi köpek tavşan hamster kaplumbağa'],
    ['animal bird pet', 'kuş papağan kanarya'],
    ['animal sea', 'balık'],
    ['animal land farm', 'inek koyun keçi at eşek öküz kuzu buzağı'],
    ['animal bird farm', 'tavuk horoz ördek kaz civciv'],
    ['animal land wild', 'aslan kaplan fil zürafa maymun ayı tilki kurt:s geyik deve zebra sincap fare penguen kirpi yılan timsah kurbağa kertenkele salyangoz'],
    ['animal bird wild', 'serçe kartal baykuş martı güvercin karga leylek kuğu'],
    ['animal sea wild', 'yunus balina ahtapot yengeç'],
    ['animal insect', 'arı karınca kelebek sinek böcek örümcek sivrisinek uğur+böcek'],
    ['animal young', 'yavru'],
    ['swim', 'ördek kaz kuğu penguen timsah kurbağa balık yunus balina ahtapot yengeç'],
    ['afood', 'ot:u saman:u yem:u tohum kemik yonca:u'],
    ['animal part', 'kuyruk pati tüy gaga boynuz hortum pençe yele yüzgeç kanat:s pul diken'],

    // ---- yiyecekler ----
    ['food fruit', 'elma armut:s portakal mandalina limon muz üzüm çilek kiraz karpuz kavun şeftali erik incir nar vişne ayva kayısı ananas greyfurt dut kivi hurma meyve'],
    ['food veg', 'zeytin domates salatalık biber patates soğan havuç patlıcan kabak ıspanak marul lahana karnabahar turp bezelye mısır:u sarımsak maydanoz pırasa brokoli fasulye nohut:s mercimek pancar kereviz enginar bamya sebze'],
    ['food dish cook', 'pilav:u makarna:u börek köfte kebap salata pide lahmacun mantı dolma sarma omlet menemen:u gözleme pizza tost yumurta kıyma:u sosis'],
    ['food dish', 'yemek sandviç'],
    ['food meat', 'et:u tavuk balık'],
    ['food sweet', 'pasta kek kurabiye çikolata dondurma:u şeker:u baklava lokum tatlı reçel:u bisküvi gofret muhallebi sütlaç kadayıf tulumba helva:u krep bal:u'],
    ['food dairy', 'süt:u peynir:u yoğurt:u,s tereyağı:c,u kaymak:u'],
    ['food bread', 'ekmek simit:s poğaça lavaş'],
    ['food nut', 'fındık ceviz badem fıstık kestane'],
    ['food', 'tuz:u un:u yağ:u baharat:u pirinç:u bulgur:u hamur:u yiyecek'],
    ['seed', 'çekirdek'],
    ['meal', 'kahvaltı yemek akşam+yemek öğle+yemek'],

    // ---- icecekler ----
    ['drink', 'su:y,u çay kahve ayran limonata gazoz şerbet salep çorba:u içecek meyve+su portakal+su elma+su bitki+çay'],
    ['drink', 'süt:u'],

    // ---- yerler ----
    ['place home', 'ev oda mutfak salon banyo balkon çatı garaj yatak+oda oturma+oda çocuk+oda'],
    ['place home nat', 'bahçe'],
    ['place pub', 'okul sınıf park market pazar manav bakkal kasap fırın pastane kütüphane hastane eczane sinema tiyatro müze stadyum havuz restoran kafe lokanta otel istasyon durak havaalanı:c,p=havaalan liman çarşı postane banka sokak cadde meydan köprü kaldırım otogar alışveriş+merkez hayvanat+bahçe oyun+park spor+salon çay+bahçe tren+istasyon'],
    ['shop', 'market manav bakkal kasap fırın pastane eczane çarşı pazar alışveriş+merkez'],
    ['place nat', 'deniz göl nehir:d=nehr dere orman dağ tepe ada plaj sahil vadi tarla çiftlik çayır mağara çöl şelale kıyı yayla'],
    ['place city', 'köy şehir:d=şehr kasaba mahalle'],

    // ---- nesneler ----
    ['obj stat', 'kalem silgi defter çanta cetvel tebeşir kalemlik kağıt:s zarf pul boya fırça makas okul+çanta sırt+çanta harita pusula'],
    ['obj tool', 'anahtar şemsiye çekiç tarak sabun havlu ip çivi pil kutu para:u cüzdan dürbün teleskop mikroskop kamera bilet poşet torba valiz kibrit mum fener çadır kova süpürge ütü tahta saksı'],
    ['obj furn', 'masa sandalye koltuk yatak yastık yorgan battaniye çarşaf halı lamba ayna dolap raf perde buzdolabı:c,p=buzdolap ocak'],
    ['obj tw', 'sofra bardak tabak çatal kaşık bıçak fincan tencere tava şişe kase sürahi demlik çaydanlık tepsi cezve kavanoz sepet çay+bardak çay+kaşık'],
    ['obj elec', 'telefon bilgisayar televizyon radyo kamera tablet klavye ekran kulaklık hoparlör robot'],
    ['obj veh', 'araba otobüs tren uçak gemi tekne bisiklet motosiklet kamyon taksi minibüs helikopter vapur metro tramvay roket kayık araç uzay+gemi'],
    ['obj toy', 'oyuncak top balon uçurtma kukla yapboz paten kaykay oyuncak_bebek oyuncak_ayı oyuncak_araba'],
    ['obj music', 'gitar piyano keman davul flüt saz trompet'],
    ['obj wear', 'ceket mont gömlek pantolon etek elbise ayakkabı çorap şapka atkı eldiven tişört kazak bot çizme terlik pijama palto hırka mayo yağmurluk kaban önlük'],
    ['obj acc', 'gözlük kolye yüzük bilezik saat:f kemer'],
    ['obj misc', 'fotoğraf kart çamaşır bulaşık:u çöp çamaşır+makine fotoğraf+makine'],
    ['media', 'film çizgi_film dizi program belgesel gösteri video konser'],
    ['art', 'şarkı türkü müzik masal hikaye şiir bilmece fıkra ninni tekerleme resim:d=resm tablo çizgi roman'],
    ['read', 'kitap gazete dergi mektup roman'],
    ['game', 'futbol basketbol voleybol tenis satranç saklambaç oyun maç yarış'],
    ['fix', 'kapı pencere duvar tavan zemin merdiven musluk zil çit'],

    // ---- vucut ----
    ['body', 'el ayak göz kulak burun:d=burn ağız:d=ağz diş saç baş kol bacak parmak yüz boyun:d=boyn sırt karın:d=karn kalp:s,f omuz:d=omz dil kaş kirpik tırnak diz dirsek çene yanak alın:d=aln boğaz bilek topuk kafa vücut:s kemik kan deri göğüs:d=göğs beyin:d=beyn'],

    // ---- doga ----
    ['nature weather', 'yağmur kar rüzgar bulut sis fırtına şimşek yıldırım hava sıcaklık gökkuşağı:c,p=gökkuşak gök+gürültü'],
    ['nature sky', 'güneş ay yıldız gökyüzü:c,u gök:s gezegen uzay dünya ışık'],
    ['nature plant', 'ağaç çiçek gül lale papatya çimen yaprak dal kök fidan çalı kaktüs menekşe karanfil sümbül zambak nergis gelincik çam meşe çınar kavak söğüt:s palmiye bitki kabuk yosun mantar ot:u'],
    ['nature land', 'taş kum toprak ateş buz kaya dalga çamur toz volkan pınar akıntı yol patika yamaç zirve kayalık doğa'],

    // ---- zaman ----
    ['time unit', 'gün hafta ay yıl saat:f dakika saniye mevsim gündüz zaman an vakit:d=vakt'],
    ['time part', 'sabah öğle akşam gece'],
    ['time season', 'ilkbahar yaz sonbahar kış'],
    ['time day', 'pazartesi salı çarşamba perşembe cuma cumartesi pazar'],
    ['time month', 'ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık'],
    ['time event', 'teneffüs bayram tatil yılbaşı:c,u hafta+son doğum+gün gün+batım gün+doğum yaz+tatil kış+tatil'],

    // ---- soyut ----
    ['abs feel', 'sevgi mutluluk korku umut:s merak:n heyecan ilgi sabır:d=sabr cesaret huzur:u neşe sevinç üzüntü öfke gurur özlem'],
    ['abs mind', 'hayal:f düş fikir:d=fikr sorun soru cevap plan kural bilgi karar seçim görev anı rüya akıl:d=akl gerçek bilim sanat tarih matematik coğrafya deney çözüm proje'],
    ['abs event', 'macera yolculuk gezi parti ders ödev sınav iş hayat yardım:u dilek hediye sürpriz şaka başarı barış dostluk arkadaşlık karne kutlama'],
    ['abs talk', 'kelime cümle harf:f isim:d=ism ad ses söz mesaj not yazı haber anlam konu alfabe Türkçe sayı liste günlük'],
    ['abs state', 'uyku:u yorgunluk açlık sağlık ağrı güç:s sessizlik gürültü gölge koku tat:s renk:s şekil:d=şekl nefes'],
    ['abs', 'zaman yer şey son sıra'],
    ['place farmp', 'ahır kümes ağıl kulübe'],
    ['nature nest', 'yuva kovan ağ'],
    ['abs stuff', 'yün yük karanlık sürü'],
    ['obj tool', 'diş+fırça'],
  ];

  // Ek etiket satirlari: kelimelere anlamsal etiket ekler (fiil kısıtları bunları kullanir)
  const TAG_DEFS = [
    ['write', 'mektup hikaye şiir not ödev yazı cümle kelime mesaj harf isim sayı liste'],
    ['draw', 'resim harita çizgi tablo'],
    ['sing', 'şarkı türkü ninni tekerleme'],
    ['tellable', 'hikaye masal fıkra bilmece şaka haber'],
    ['read', 'hikaye masal şiir günlük haber yazı fıkra bilmece mesaj not'],
    ['watch', 'film çizgi_film dizi maç haber program belgesel gösteri video televizyon konser'],
    ['listen', 'müzik şarkı türkü masal hikaye radyo konser ninni ses'],
    ['learn', 'kelime şarkı türkü ders Türkçe şiir alfabe harf sayı oyun satranç'],
    ['sport', 'futbol basketbol voleybol tenis satranç saklambaç oyun'],
    ['playball', 'top futbol basketbol voleybol tenis'],
    ['wear', 'şapka atkı eldiven'],
    ['acc', 'şapka atkı eldiven'],
    ['open', 'kapı pencere kitap defter çanta kutu şişe perde kavanoz zarf mektup dolap'],
    ['frag', 'bardak tabak fincan şişe ayna kavanoz kase sürahi demlik çaydanlık cezve'],
    ['carry', 'çanta kutu sepet kitap defter torba poşet valiz tepsi sırt+çanta okul+çanta'],
    ['fold', 'havlu battaniye gömlek pantolon çarşaf kağıt mektup elbise yorgan'],
    ['hang', 'resim tablo ayna ceket elbise perde çamaşır pantolon gömlek harita mont'],
    ['clean', 'oda mutfak masa pencere ev banyo salon halı ayna araba bisiklet ayakkabı'],
    ['sweep', 'oda mutfak salon banyo balkon bahçe ev'],
    ['wash', 'el yüz tabak bardak fincan araba bisiklet çorap gömlek saç ayak çamaşır bulaşık tencere meyve sebze'],
    ['fixit', 'bisiklet araba saat telefon oyuncak bilgisayar radyo televizyon lamba sandalye masa'],
    ['paint', 'duvar kapı resim oyuncak kutu sandalye masa ev çit'],
    ['lit', 'mum lamba ateş ocak'],
    ['flower', 'çiçek gül lale papatya menekşe karanfil sümbül zambak nergis gelincik'],
    ['tree', 'ağaç çam meşe çınar kavak söğüt palmiye'],
    ['plantable', 'ağaç çiçek gül lale papatya fidan tohum çam menekşe'],
    ['waterable', 'çiçek ağaç bahçe çimen fidan saksı gül lale'],
    ['smell', 'çiçek gül lale papatya menekşe yemek pasta kek ekmek kahve çay'],
    ['tasty', 'yemek pilav makarna börek köfte pizza pasta kek çorba salata pide meyve kurabiye baklava dondurma'],
    ['fragile', 'bardak tabak fincan şişe ayna'],
    ['sellable', 'elma armut portakal muz limon üzüm çilek ekmek simit peynir yumurta kitap gazete dergi çiçek balık meyve sebze domates salatalık patates havuç'],
    ['chosen', 'meyve elbise kitap renk kelime hediye şapka ceket'],
    ['gift', 'kitap oyuncak çiçek çikolata kalem şapka atkı eldiven kolye pasta hediye oyuncak_bebek oyuncak_ayı'],
    ['stat', 'kalem defter silgi'],
    ['pubplay', 'park bahçe sokak sahil plaj çayır orman ev oda salon oyun+park'],
    ['walkp', 'park sahil orman sokak köy şehir çarşı meydan kaldırım bahçe çayır mahalle yayla'],
    ['studyp', 'okul sınıf kütüphane ev oda'],
    ['eatp', 'ev mutfak salon restoran lokanta kafe okul park bahçe'],
    ['sleepp', 'ev oda yatak+oda yatak koltuk salon bahçe'],
    ['swimp', 'deniz göl havuz nehir plaj'],
    ['goto', 'okul park market pazar manav bakkal kasap fırın pastane kütüphane hastane eczane sinema tiyatro müze stadyum havuz restoran kafe lokanta otel istasyon liman çarşı postane banka köy şehir orman deniz göl dağ sahil plaj bahçe tarla çiftlik alışveriş+merkez hayvanat+bahçe spor+salon çay+bahçe'],
    ['comefrom', 'okul park market pazar kütüphane hastane sinema müze stadyum havuz restoran kafe istasyon çarşı postane banka köy şehir orman deniz göl sahil plaj bahçe tarla çiftlik ev'],
    ['clothesw', 'ceket mont gömlek pantolon etek elbise ayakkabı çorap tişört kazak bot çizme terlik pijama palto hırka mayo yağmurluk kaban önlük'],
  ];

  // ---- isim tablosunu nesnelere cevir ----
  const NOUNS = [];
  const NMAP = new Map();          // yuzey (yalin) -> isim nesnesi
  const BYTAG = Object.create(null); // etiket -> [isim]
  const LEX_WARN = [];             // gelistirme: eksik/yinelenen kayitlar

  function parseFlags(fs) {
    const o = {};
    if (fs) { const a = fs.split(','); for (let i = 0; i < a.length; i++) { const f = a[i]; if (f.indexOf('d=') === 0) o.d = f.slice(2); else if (f.indexOf('p=') === 0) o.p = f.slice(2); else o[f] = true; } }
    return o;
  }
  function finishNoun(n) {
    n.v = n.fl.n ? null : softStem(n.w, n.fl);
    n.f = !!n.fl.f; n.y = !!n.fl.y; n.u = !!n.fl.u; n.c = !!n.fl.c;
    if (n.fl.p) n.ps = mkNoun(n.fl.p, {}); // sabit -sI ile biten sozcukte cokluk: havaalanlari, buzdolaplari
  }
  function headNoun(hd) {
    let h = NMAP.get(hd);
    if (!h) { h = mkNoun(hd, {}); h.fl = {}; finishNoun(h); }
    return h;
  }
  function addTag(n, t) { if (!n.ts[t]) { n.ts[t] = 1; n.tags.push(t); } }
  function findNoun(tok) {
    let w = tok, ci = w.indexOf(':'); if (ci >= 0) w = w.slice(0, ci);
    if (w.indexOf('+') >= 0) { const p = w.split('+'); w = p[0].replace(/_/g, ' ') + ' ' + nform(headNoun(p[1]), false, 3, 0); }
    else w = w.replace(/_/g, ' ');
    return NMAP.get(w) || null;
  }
  function addNounToken(tags, tok, compound) {
    let w = tok, fs = ''; const ci = tok.indexOf(':');
    if (ci >= 0) { w = tok.slice(0, ci); fs = tok.slice(ci + 1); }
    const fl = parseFlags(fs);
    const isComp = w.indexOf('+') >= 0;
    if (isComp !== compound) return;
    let n;
    if (isComp) {
      const p = w.split('+'), pre = p[0].replace(/_/g, ' '), hd = headNoun(p[1]);
      const key = pre + ' ' + nform(hd, false, 3, 0);
      n = NMAP.get(key);
      if (!n) { n = mkNoun(key, {}); n.fl = { c: true }; n.head = hd; n.pre = pre + ' '; n.ts = {}; NMAP.set(key, n); NOUNS.push(n); n.cls = tags[0]; }
    } else {
      w = w.replace(/_/g, ' ');
      n = NMAP.get(w);
      if (!n) { n = mkNoun(w, fl); n.fl = fl; n.ts = {}; n.cls = tags[0]; NMAP.set(w, n); NOUNS.push(n); }
      else if (fs) { for (const k in fl) n.fl[k] = fl[k]; }
      finishNoun(n);
    }
    for (let i = 0; i < tags.length; i++) addTag(n, tags[i]);
    addTag(n, n.w.replace(/ /g, '_'));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < NOUN_DEFS.length; i++) {
      const tags = NOUN_DEFS[i][0].split(' '), toks = NOUN_DEFS[i][1].split(' ');
      for (let j = 0; j < toks.length; j++) addNounToken(tags, toks[j], pass === 1);
    }
  }
  function applyTagDefs(defs) {
    for (let i = 0; i < defs.length; i++) {
      const t = defs[i][0], toks = defs[i][1].split(' ');
      for (let j = 0; j < toks.length; j++) {
        const n = findNoun(toks[j]);
        if (!n) LEX_WARN.push('etiket ' + t + ': kelime yok: ' + toks[j]); else addTag(n, t);
      }
    }
  }
  applyTagDefs(TAG_DEFS);
  function rebuildTagIndex() {
    for (const k in BYTAG) delete BYTAG[k];
    for (let i = 0; i < NOUNS.length; i++) {
      const n = NOUNS[i];
      for (let j = 0; j < n.tags.length; j++) { const t = n.tags[j]; (BYTAG[t] || (BYTAG[t] = [])).push(n); }
    }
  }
  rebuildTagIndex();
  function noun(w) { const n = NMAP.get(w); if (!n) throw new Error('isim yok: ' + w); return n; }

  // ---- ek etiketler (anlamsal alt kumeler; fiil kisitlari ve sifatlar kullanir) ----
  const TAG_DEFS2 = [
    ['lost', 'anahtar cüzdan kalem defter çanta top kitap gözlük para oyuncak saat şapka eldiven yüzük kolye şemsiye'],
    ['faller', 'yaprak kalem bardak top tabak fincan anahtar cüzdan şapka eldiven balon kar yağmur'],
    ['risers', 'güneş ay'],
    ['boat', 'gemi tekne vapur kayık'],
    ['precip', 'yağmur kar'],
    ['windy', 'rüzgar'],
    ['shine', 'güneş ay yıldız'],
    ['flow', 'nehir dere pınar akıntı'],
    ['melts', 'kar buz'],
    ['bloom', 'çiçek gül lale papatya menekşe karanfil sümbül zambak nergis gelincik'],
    ['grows', 'ağaç çiçek çimen fidan bitki çam gül lale papatya'],
    ['boil', 'su süt çorba'],
    ['cooks', 'yemek pilav makarna börek köfte kek pasta kurabiye çorba yumurta patates'],
    ['coolable', 'çay çorba süt kahve yemek pilav hava'],
    ['heatable', 'hava su çorba süt yemek oda ev'],
    ['freezable', 'su göl nehir'],
    ['leaf', 'yaprak'],
    ['ringer', 'telefon zil'],
    ['holdable', 'top kalem ip balon şemsiye çanta sepet fincan bardak kitap'],
    ['throwable', 'top taş çöp balon'],
    ['catchable', 'top balık kelebek'],
    ['cuttable', 'ekmek elma armut karpuz kavun peynir pasta kek kağıt ip domates salatalık soğan havuç patates portakal limon'],
    ['fry', 'patates yumurta balık köfte tavuk et sosis'],
    ['boiled', 'su süt yumurta patates makarna'],
    ['stirrable', 'çorba süt çay kahve salata hamur pilav limonata'],
    ['chop', 'domates salatalık soğan biber havuç patates marul maydanoz elma'],
    ['sewable', 'elbise gömlek etek pantolon ceket kazak atkı eldiven'],
    ['ironable', 'gömlek pantolon elbise çamaşır etek ceket'],
    ['makeable', 'ödev kek pasta kurabiye çorba salata plan proje deney yemek börek pilav makarna köfte omlet menemen gözleme pizza limonata resim şaka'],
    ['tie', 'ayakkabı ip atkı balon'],
    ['celeb', 'doğum+gün bayram yılbaşı başarı'],
    ['preparable', 'kahvaltı yemek akşam+yemek öğle+yemek çay limonata salata pasta ödev proje'],
    ['finishable', 'ödev kitap yemek iş proje kahvaltı roman resim'],
    ['memorable', 'anı rüya şarkı masal hikaye isim cevap ders kelime yol'],
    ['visit', 'müze kütüphane hayvanat+bahçe'],
    ['surf', 'masa raf dolap çanta sepet buzdolabı tepsi kutu'],
    ['transit', 'otobüs tren uçak vapur minibüs taksi metro tramvay'],
    ['enterp', 'ev oda mutfak salon banyo okul sınıf market kafe restoran müze sinema hastane kütüphane çarşı'],
    ['tryable', 'elbise ayakkabı şapka ceket gözlük mont pasta çorba yemek kurabiye'],
    ['scary', 'yılan örümcek köpek aslan kurt timsah gök+gürültü şimşek fırtına'],
    ['climber', 'kedi maymun sincap'],
    ['sweetish', 'elma armut portakal mandalina muz üzüm çilek kiraz karpuz kavun şeftali incir hurma kayısı dut pasta kek kurabiye çikolata dondurma şeker baklava lokum tatlı reçel bisküvi muhallebi sütlaç kadayıf tulumba helva krep bal limonata çay şerbet salep gazoz'],
    ['sour', 'limon erik vişne nar ayva kivi greyfurt limonata elma üzüm yoğurt'],
    ['salty', 'peynir salata börek pizza sosis çorba simit poğaça lavaş kebap'],
    ['fresh', 'meyve sebze ekmek simit süt balık çiçek domates salatalık elma armut portakal muz çilek ekmek peynir yumurta marul'],
    ['hotcold', 'çay kahve çorba süt su yemek pilav hava oda ev gün gece sabah akşam'],
    ['kitchenp', 'mutfak ev'],
    ['colorfree', 'ceket mont gömlek pantolon etek elbise ayakkabı çorap şapka atkı eldiven tişört kazak bot çizme terlik pijama palto hırka yağmurluk kaban önlük çanta top balon uçurtma kukla oyuncak araba otobüs tren uçak gemi tekne bisiklet kalem defter silgi masa sandalye koltuk halı perde lamba bardak tabak fincan şişe kutu sepet şemsiye kitap araba gitar oyuncak_araba oyuncak_ayı oyuncak_bebek çiçek gül lale kuş balon'],
    ['playerkid', 'çocuk kız oğlan öğrenci'],
    ['fillable', 'bardak şişe sepet kavanoz kase sürahi çaydanlık tencere demlik fincan'],
    ['drivable', 'araba bisiklet motosiklet kamyon taksi minibüs'],
    ['wipe', 'masa pencere ayna tahta yüz el ayakkabı'],
    ['collectable', 'yaprak çiçek oyuncak kalem çöp çamaşır bulaşık kitap defter elma armut kiraz çilek fındık ceviz top'],
    ['handy', 'kalem defter kitap çanta bardak tabak fincan şişe kutu sepet top oyuncak silgi'],
  ];
  applyTagDefs(TAG_DEFS2);
  rebuildTagIndex();
  // 'edible': dogrudan yenen seyler (un, yag, tuz, hamur gibi hammaddeler haric)
  (function () {
    const cls = ['fruit', 'veg', 'dish', 'meat', 'sweet', 'dairy', 'bread', 'nut'];
    for (let i = 0; i < NOUNS.length; i++) {
      const n = NOUNS[i];
      if (n.ts.drink) continue;
      for (let k = 0; k < cls.length; k++) if (n.ts[cls[k]]) { addTag(n, 'edible'); break; }
    }
    const yc = NMAP.get('yiyecek'); if (yc) addTag(yc, 'edible');
  })();
  rebuildTagIndex();

  // =====================================================================================
  // 2b. Fiiller.  Satir:  govde[:alt][/aor] | tur | ozne etiketleri | nesne etiketleri | yer etiketleri | yonelme etiketleri | tarz
  //   tur: i = gecissiz; t = belirtme (-I) nesnesi; d = yonelme (-A) tumleci (nesne alani = tumlecin etiketleri); b = ayrilma (-DAn) tumleci;
  //        td = nesne + yonelme (ver-, koy-); w = ile ortagi (konus-); '-' = yok
  //   'on_soz_fiil' = ayrik yazilan on sozle birlesik fiil (yardim_et -> "yardim etmek"); alt = et -> ed ; ye/de ozel islenir.
  //   aor: /A /I ile geniş zaman turu zorlanir; yoksa: unluyle biten -r, cok heceli -Ir, tek heceli -Ar (13 istisna -Ir: al bil bul dur gel gor kal ol ol san var ver vur).
  //   tarz: a = etkin (hizli, dikkatle...), q = sakin, e = duygu (neseyle...), s = konusma, - = zarf almaz
  //   Ozne etiketleri: hum, kid (cocuk/ad/kardes...), baby, land, bird, sea, swim, insect, pet, farm + dogal oznelerin etiketleri.
  // =====================================================================================
  const VERB_DEFS = `
uyu|i|hum+baby+land|-|sleepp|-|t
uyan|i|hum+baby+land|-|sleepp|-|q
kalk|i|hum|-|-|-|a
otur|i|hum|-|sitp|-|q
yat|i|hum+land|-|sleepp|-|q
koş|i|hum+land|-|pubplay|-|a
yürü|i|hum+land|-|walkp|-|a
zıpla|i|hum+land|-|pubplay|-|a
gül|i|hum+baby|-|-|-|e
ağla|i|hum+baby|-|-|-|r
gülümse|i|hum+baby|-|-|-|t
dinlen|i|hum+land|-|home+pubplay|-|q
çalış|i|hum|-|studyp|-|a
oyna|i|kid+pet|-|pubplay|-|a
yüz|i|hum+swim|-|swimp|-|a
uç|i|bird+insect|-|-|-|a
düş|i|hum+faller|-|-|-|-
doğ|i|risers|-|-|-|-
bat|i|risers+boat|-|-|-|-
büyü|i|hum+animal+grows|-|-|-|-
sevin|i|hum+baby+pet|-|-|-|-
üzül|i|hum+pet|-|-|-|-
şaşır|i|hum+baby+pet|-|-|-|-
yorul|i|hum+land|-|-|-|-
acık|i|hum+animal|-|-|-|-
susa|i|hum+animal|-|-|-|-
üşü|i|hum+baby+land|-|-|-|-
esne|i|hum+land+baby|-|-|-|-
konuş|i|hum|-|-|-|s
bağır|i|hum|-|-|-|-
fısılda|i|hum|-|-|-|-
hapşır|i|hum+land|-|-|-|-
gez|i|hum|-|walkp|-|a
dolaş|i|hum|-|walkp|-|a
eğlen|i|hum|-|pubplay|-|-
yıkan|i|hum|-|-|-|-
giyin|i|hum|-|-|-|-
hazırlan|i|hum|-|-|-|-
saklan|i|kid+land|-|pubplay|-|q
kaç|i|hum+land|-|-|-|a
toplan|i|hum|-|pubplay|-|-
dans_et:ed|i|hum|-|-|-|a
şarkı_söyle|i|hum|-|-|-|s
resim_yap|i|hum|-|studyp|-|a
spor_yap|i|hum|-|-|-|a
yürüyüş_yap|i|hum|-|walkp|-|-
alışveriş_yap|i|hum|-|shop|-|-
kahvaltı_yap|i|hum|-|eatp|-|-
yemek_yap|i|hum|-|kitchenp|-|a
ders_çalış|i|hum|-|studyp|-|a
piknik_yap|i|hum|-|pubplay|-|-
temizlik_yap|i|hum|-|home|-|a
hayal_kur|i|hum|-|-|-|q
ye|t|hum|edible|eatp|-|a
iç|t|hum|drink|eatp|-|a
oku|t|hum|read|studyp|-|a
yaz|t|hum|write|studyp|-|a
çiz|t|hum|draw|studyp|-|a
boya|t|hum|paint|-|-|a
gör|t|hum|animal+hum+sky+weather+plant|-|-|-
sev|t|hum+land|edible+drink+animal+flower+art+game+season+media+sweetish|-|-|-
beğen|t|hum|wear+toy+art+media+edible+gift|-|-|-
iste|t|hum+baby+land|edible+drink+toy+stat+gift|-|-|-
izle|t|hum|watch|home|-|q
dinle|t|hum|listen+hum|home+pubplay|-|q
aç|t|hum|open|-|-|a
kapat|t|hum|open|-|-|a
yıka|t|hum|wash|-|-|a
temizle|t|hum|clean|-|-|a
süpür|t|hum|sweep|-|-|a
sil|t|hum|wipe|-|-|a
topla|t|hum|collectable|-|-|a
taşı|t|hum|carry|-|-|a
tut|t|hum|holdable|-|-|a
at|t|hum|throwable|pubplay|-|a
yakala|t|hum+pet|catchable|pubplay|-|a
kes|t|hum|cuttable|kitchenp|-|a
pişir|t|hum|cook|kitchenp|-|a
kızart|t|hum|fry|kitchenp|-|a
kaynat|t|hum|boiled|kitchenp|-|a
karıştır|t|hum|stirrable|kitchenp|-|a
doğra|t|hum|chop|kitchenp|-|a
yoğur|t|hum|hamur|kitchenp|-|a
sula|t|hum|waterable|-|-|a
dik|t|hum|plantable|-|-|a
dik|t|hum|sewable|-|-|a
kır|t|hum|frag|-|-|-
dök|t|hum|drink|-|-|-
doldur|t|hum|fillable|-|-|a
giy|t|hum|wear|-|-|-
tak|t|hum|acc|-|-|-
çıkar|t|hum|wear+acc|-|-|-
bağla|t|hum|tie|-|-|a
yap|t|hum|makeable|-|-|a
çal|t|hum|music|home+pubplay|-|a
sür|t|hum|drivable|-|-|a
katla|t|hum|fold|-|-|a
as|t|hum|hang|-|-|a
bul|t|hum+land|lost|-|-|-
ara|t|hum+land|lost|-|-|a
kaybet:kaybed/A|t|hum|lost|-|-|-
seç|t|hum|chosen|-|-|-
dene|t|hum|tryable|-|-|-
tat:tad/A|t|hum|tasty|-|-|-
kokla|t|hum+pet|smell|-|-|-
öp|t|hum|fam+baby|-|-|-
kucakla|t|hum|hum+baby+pet|-|-|-
okşa|t|hum|pet+baby|-|-|q
besle|t|hum|pet+farm|-|-|a
tara|t|hum|saç|-|-|-
fırçala|t|hum|diş+saç|-|-|-
ütüle|t|hum|ironable|-|-|a
bekle|t|hum|hum+transit|-|-|q
çağır|t|hum|hum+pet|-|-|s
karşıla|t|hum|hum|-|-|-
özle|t|hum+land|hum+pet+ev+okul+köy|-|-|-
hatırla|t|hum|memorable+hum|-|-|-
unut|t|hum|lost+memorable|-|-|-
düşün|t|hum|thinkable+hum|-|-|q
merak_et:ed|t|hum|hum|-|-|-
kutla|t|hum|celeb|-|-|e
hazırla|t|hum|preparable|kitchenp|-|a
bitir|t|hum|finishable|-|-|a
bil|t|hum|memorable+learn|-|-|-
anla|t|hum|soru+hikaye+ders+kelime+konu+şaka+anlam+cümle+bilmece|-|-|-
öğren|t|hum|learn|studyp|-|a
öğret|td|hum|learn|studyp|hum|a
oyna|t|hum|sport|pubplay|-|a
gez|t|hum|city+nat|-|-|a
ziyaret_et:ed|t|hum|fam+visit|-|-|-
tamir_et:ed|t|hum|fixit|-|-|a
davet_et:ed|t|hum|hum|-|-|-
seyret:seyred/A|t|hum|watch|home|-|q
hisset:hissed/A|t|hum|feel|-|-|-
ver|td|hum|gift+edible+drink+sellable|-|hum|-
getir|td|hum|edible+drink+stat+tw+gift|-|hum|a
götür|td|hum|carry+gift+edible|-|goto|a
koy|td|hum|carry+tw+stat|-|surf|a
bırak|td|hum|hum|-|goto|-
göster|td|hum|resim+harita+kitap+oyuncak+fotoğraf+hediye|-|hum|-
sor|td|hum|soru+bilmece|-|hum|s
söyle|td|hum|isim+cevap+kelime+söz|-|hum|s
anlat|td|hum|tellable|-|hum|s
paylaş|tw|hum|edible+sweetish+oyuncak|-|kid|-
sakla|t|hum+land|lost+kemik+çikolata|-|-|-
cevap_ver|d|hum|hum|-|-|s
yardım_et:ed|d|hum|fam+hum|-|-|a
teşekkür_et:ed|d|hum|hum|-|-|s
sarıl|d|hum+baby|fam+pet+hum|-|-|-
gül|d|hum|şaka+fıkra+hikaye|-|-|e
kız|d|hum|fam+kid|-|-|-
inan|d|hum|hum+hikaye+söz|-|-|-
güven|d|hum|fam+hum|-|-|-
bak|d|hum+land|animal+sky+ayna+resim+harita+kitap+televizyon+tablo+dünya+çiçek|-|-|q
git:gid|d|hum+land|goto|-|-|a
gel|d|hum+land|goto+home|-|-|a
gir|d|hum+land|enterp|-|-|a
çık|d|hum+climber|dağ+tepe+ağaç+çatı+merdiven|-|-|a
dön|d|hum+land|home+city+okul|-|-|a
var|d|hum+land|goto|-|-|a
bin|d|hum|transit+bisiklet+at+motosiklet+tekne+gemi|-|-|a
başla|d|hum|ders+ödev+iş+kitap+yemek+proje+oyun|-|-|-
tırman|d|hum+climber|tree+dağ+tepe|-|-|a
çık|b|hum+land|enterp|-|-|a
in|b|hum|transit|-|-|a
ayrıl|b|hum|comefrom|-|-|-
kork|b|hum+baby+pet|scary|-|-|-
hoşlan|b|hum|sweetish+animal+art+sport|-|-|-
konuş|w|hum|hum|-|-|s
buluş|w|hum|hum|pubplay|-|-
tanış|w|hum|hum|-|-|-
oyna|w|kid|kid|pubplay|-|a
yağ|i|precip|-|-|-|-
es|i|windy|-|-|-|-
ak|i|flow|-|-|-|-
parla|i|shine|-|-|-|-
eri|i|melts|-|-|-|-
kayna|i|boil|-|-|-|-
piş|i|cooks|-|-|-|-
soğu|i|coolable|-|-|-|-
ısın|i|heatable|-|-|-|-
aç|i|bloom|-|-|-|-
sol|i|flower|-|-|-|-
dökül|i|leaf|-|-|-|-
sarar|i|leaf|-|-|-|-
yeşer|i|çimen+ağaç+fidan+bitki|-|-|-|-
karar|i|hava+gökyüzü|-|-|-|-
don|i|freezable|-|-|-|-
yan|i|lit+ışık|-|-|-|-
sön|i|lit+ışık|-|-|-|-
çal|i|ringer|-|-|-|-
gürle|i|gök|-|-|-|-
çık|i|risers|-|-|-|-
yaşa|i|hum|-|city|-|-
kal|i|hum+land|-|home+city|-|q
dur|i|hum+land+veh|-|-|-|-
al|t|hum|sellable+stat+wear+toy+gift|-|-|a
çek|t|hum|fotoğraf+video|-|-|a
duy|t|hum+land|ses+şarkı+müzik+haber|-|-|-
tanı|t|hum|hum|-|-|-
ıslan|i|hum+land|-|-|-|-
uçur|t|hum|uçurtma+balon|pubplay|-|a
demle|t|hum|çay+bitki_çayı|kitchenp|-|a
öde|t|hum|para|-|-|-
bit|i|ders+film+maç+gösteri+program+konser+yarış|-|-|-|-
başla|i|ders+film+maç+gösteri+program+konser+yarış|-|-|-|-
çiğne|t|hum|edible|-|-|q
biç|t|hum|çimen|-|-|a
ekle|t|hum|tuz+şeker+su+süt+un+yağ+baharat|kitchenp|-|a
sık|t|hum|limon+portakal+mandalina+nar|kitchenp|-|a
sat|t|hum|sellable|shop|-|-
kullan|t|hum|usable|-|-|a
karşılaş|w|hum|hum|-|-|-
`;
  const VERBS = [];
  const VBY = Object.create(null); // etiket (ozne) -> [fiil]
  (function parseVerbs() {
    const lines = VERB_DEFS.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const ln = lines[li].trim(); if (!ln) continue;
      const c = ln.split('|');
      let tok = c[0], aor = '', alt = '', pre = '';
      const ai = tok.indexOf('/'); if (ai >= 0) { aor = tok.slice(ai + 1); tok = tok.slice(0, ai); }
      const ci = tok.indexOf(':'); if (ci >= 0) { alt = tok.slice(ci + 1); tok = tok.slice(0, ci); }
      const ui = tok.lastIndexOf('_'); if (ui >= 0) { pre = tok.slice(0, ui).replace(/_/g, ' ') + ' '; tok = tok.slice(ui + 1); }
      const v = mkVerb(tok, { alt: alt, aor: aor, pre: pre });
      const list = (s) => (s === '-' || !s) ? [] : s.split('+');
      v.tr = c[1]; v.sj = list(c[2]); v.ob = list(c[3]); v.loc = list(c[4]); v.dat = list(c[5]); v.mv = c[6] && c[6] !== '-' ? c[6] : '';
      v.id = tok; v.line = li;
      VERBS.push(v);
    }
  })();

  // =====================================================================================
  // 2c. Sifatlar.  Satir: [uygulandigi isim etiketleri (herhangi biri), sifatlar].  Etiket olarak isim kelimesi de yazilabilir.
  // =====================================================================================
  const ADJ_DEFS = [
    ['colorfree', 'kırmızı mavi sarı yeşil beyaz siyah turuncu mor pembe kahverengi gri'],
    ['animal obj place plant food nature body kid baby kardeş', 'büyük küçük'],
    ['animal obj place plant food drink nature body art media game kid baby time part season event', 'güzel'],
    ['obj place art media game arkadaş komşu öğretmen misafir öğrenci', 'yeni eski'],
    ['wear furn tw home el yüz ayak saç su hava kalem defter araba bisiklet oyuncak', 'temiz kirli'],
    ['hotcold', 'sıcak soğuk'],
    ['sweetish kid baby young pet', 'tatlı'],
    ['sour', 'ekşi'],
    ['salty', 'tuzlu'],
    ['biber kahve turp', 'acı'],
    ['dish sweet fruit veg bread dairy meat çay kahve limonata ayran çorba', 'lezzetli'],
    ['fresh', 'taze'],
    ['lengthy', 'uzun kısa'],
    ['thick', 'kalın ince'],
    ['wide', 'geniş'],
    ['narrow', 'dar'],
    ['high', 'yüksek'],
    ['low', 'alçak'],
    ['heavy', 'ağır'],
    ['light', 'hafif'],
    ['yastık yatak koltuk battaniye yorgan halı tüy ekmek kum toprak oyuncak_ayı kek pasta peynir', 'yumuşak'],
    ['taş ekmek yatak toprak ceviz buz kaya', 'sert'],
    ['shine ışık ayna yüzük kolye bilezik tabak araba', 'parlak'],
    ['oda gece orman mağara sokak ev', 'karanlık'],
    ['oda ev sınıf mutfak salon gündüz sokak', 'aydınlık'],
    ['çamaşır havlu çorap ayakkabı saç çimen toprak yol yaprak kum ekmek ot', 'ıslak kuru'],
    ['wear elec veh music toy stat furn tw', 'pahalı ucuz'],
    ['bardak şişe kutu sepet çanta tabak fincan kavanoz kase sürahi tencere tava çaydanlık demlik cüzdan oda salon sınıf otobüs park', 'dolu boş'],
    ['open shop hava gökyüzü okul müze kütüphane', 'açık kapalı'],
    ['frag oyuncak kalem sandalye masa', 'kırık'],
    ['sandalye masa köprü ev duvar ip çanta ayakkabı kapı', 'sağlam'],
    ['pub otobüs metro tren plaj çarşı sokak meydan otogar', 'kalabalık'],
    ['oda sınıf kütüphane orman göl gece sokak köy kid hum', 'sessiz'],
    ['sokak sınıf pazar çarşı otogar', 'gürültülü'],
    ['hava gün sabah akşam gece', 'güneşli yağmurlu bulutlu rüzgarlı karlı sisli'],
    ['hava akşam sabah gece su', 'serin ılık'],
    ['gün yolculuk iş ders ödev yürüyüş', 'yorucu'],
    ['oyun gezi parti film tatil yolculuk macera gösteri konser çizgi_film dizi', 'eğlenceli'],
    ['kitap film hikaye masal haber belgesel konu soru fikir oyun deney', 'ilginç'],
    ['soru ödev ders sınav iş oyun bilmece proje yol', 'kolay zor'],
    ['ders sınav görev karar iş konu haber plan', 'önemli'],
    ['şaka fıkra film dizi çizgi_film kukla maymun kedi köpek adam çocuk hikaye', 'komik'],
    ['kid baby pet young oyuncak_ayı oyuncak_bebek hamster civciv kuzu tavşan', 'sevimli'],
    ['kid pet', 'yaramaz'],
    ['dede nine adam kadın komşu babaanne anneanne çınar ağaç', 'yaşlı'],
    ['adam kadın öğretmen doktor hemşire komşu pilot mühendis ressam yazar şoför sporcu futbolcu müzisyen', 'genç'],
    ['hum animal baby', 'mutlu üzgün yorgun aç tok uykulu hasta sağlıklı heyecanlı şaşkın kızgın sevinçli meraklı yalnız'],
    ['hum animal', 'akıllı cesur neşeli sakin güçlü hızlı yavaş'],
    ['hum arı karınca öğrenci', 'çalışkan'],
    ['hum', 'kibar nazik cömert dürüst sabırlı utangaç meşgul endişeli gururlu memnun'],
    ['kid pet kedi köpek', 'tembel'],
    ['veh', 'hızlı yavaş'],
    ['hum yemek kahvaltı ödev', 'hazır'],
    ['koltuk yatak ayakkabı', 'rahat'],
    ['pet young farm', 'tüylü'],
    ['kitap defter kalem çanta', 'faydalı'],
  ];
  const ADJ = [];
  const ADJMAP = new Map();
  (function () {
    for (let i = 0; i < ADJ_DEFS.length; i++) {
      const tags = ADJ_DEFS[i][0].split(' '), ws = ADJ_DEFS[i][1].split(' ');
      for (let j = 0; j < ws.length; j++) {
        let a = ADJMAP.get(ws[j]);
        if (!a) { a = { w: ws[j], tags: [] }; ADJMAP.set(ws[j], a); ADJ.push(a); }
        for (let k = 0; k < tags.length; k++) if (a.tags.indexOf(tags[k]) < 0) a.tags.push(tags[k]);
      }
    }
  })();
  applyTagDefs([
    ['lengthy', 'yol ip kuyruk ağaç saç merdiven masa kalem bacak boyun ayak parmak tırnak gece gün hikaye şarkı film yolculuk çorap etek pantolon atkı kitap cümle kelime mektup ders tatil kol'],
    ['thick', 'kitap defter battaniye yorgan halı ip tahta duvar ceket mont kazak palto atkı çorap sis bulut kalem kağıt ekmek çorba ses dal kol parmak yol saç çizgi'],
    ['wide', 'oda salon sokak cadde meydan yol köprü ev bahçe pantolon etek ceket mont kazak pencere kapı masa koltuk yatak halı deniz göl nehir vadi çayır tarla orman balkon mutfak banyo garaj sınıf'],
    ['narrow', 'oda sokak yol köprü ev pantolon etek ceket kazak ayakkabı pencere kapı merdiven vadi mutfak banyo balkon garaj sınıf mağara patika'],
    ['high', 'dağ tepe ağaç duvar tavan merdiven köprü çit zirve ses bulut'],
    ['low', 'tepe duvar çit tavan masa sandalye ağaç bulut koltuk'],
    ['heavy', 'çanta kutu valiz masa sandalye koltuk dolap taş kitap sepet tencere kamyon fil kaya buzdolabı halı battaniye yorgan mont palto'],
    ['light', 'çanta kutu kalem kağıt kuş tüy yaprak balon uçurtma bulut kitap sepet şemsiye atkı eldiven şapka kazak battaniye'],
  ]);
  rebuildTagIndex();
  const ATTR_BAD = { 'hazır': 1, 'memnun': 1, 'meşgul': 1 };
  // durum sifatlari (yuklem olarak kisi ekiyle: "mutluyum") -- yalniz insan/hayvan ozneleri
  const STATE_ADJ = ['mutlu', 'üzgün', 'yorgun', 'aç', 'tok', 'uykulu', 'hasta', 'heyecanlı', 'şaşkın', 'kızgın', 'sevinçli', 'meraklı', 'yalnız', 'meşgul', 'endişeli', 'gururlu', 'memnun', 'hazır', 'sağlıklı'];
  function adjFor(n) {
    if (n._adj) return n._adj;
    const out = [];
    for (let i = 0; i < ADJ.length; i++) {
      const a = ADJ[i];
      if (ATTR_BAD[a.w]) continue;
      for (let k = 0; k < a.tags.length; k++) if (n.ts[a.tags[k]]) { out.push(a.w); break; }
    }
    n._adj = out; return out;
  }
  // yiyecek/hayvan renkleri (sabit bilgi)
  const COLORS = {
    elma: ['kırmızı', 'yeşil', 'sarı'], muz: ['sarı'], limon: ['sarı'], portakal: ['turuncu'], mandalina: ['turuncu'], havuç: ['turuncu'], domates: ['kırmızı'],
    çilek: ['kırmızı'], kiraz: ['kırmızı'], nar: ['kırmızı'], patlıcan: ['mor'], üzüm: ['mor', 'yeşil'], salatalık: ['yeşil'], marul: ['yeşil'], ıspanak: ['yeşil'],
    biber: ['yeşil', 'kırmızı'], kar: ['beyaz'], süt: ['beyaz'], peynir: ['beyaz'], gökyüzü: ['mavi'], deniz: ['mavi'], çimen: ['yeşil'], yaprak: ['yeşil'],
    güneş: ['sarı'], bulut: ['beyaz'], gül: ['kırmızı', 'pembe', 'beyaz', 'sarı'], papatya: ['beyaz'], menekşe: ['mor'], zebra: ['siyah beyaz'], penguen: ['siyah beyaz'],
    kuğu: ['beyaz'], çikolata: ['kahverengi'], toprak: ['kahverengi'], tereyağı: ['sarı'], kedi: ['beyaz', 'siyah', 'gri', 'sarı'], köpek: ['siyah', 'beyaz', 'kahverengi'],
    at: ['beyaz', 'siyah', 'kahverengi'], tavşan: ['beyaz', 'gri', 'kahverengi'], kuş: ['sarı', 'mavi', 'yeşil'], karga: ['siyah'], ördek: ['sarı', 'beyaz'], civciv: ['sarı'],
    kelebek: ['sarı', 'mavi', 'turuncu'], kuzu: ['beyaz'], ayı: ['kahverengi'], fare: ['gri'],
  };
  function colorsOf(n) { return COLORS[n.w] || (n.ts.colorfree ? ['kırmızı', 'mavi', 'sarı', 'yeşil', 'beyaz', 'siyah', 'turuncu', 'mor', 'pembe'] : null); }

  // =====================================================================================
  // 2d. Zarflar, sayilar, edatlar, baglaclar, ozel adlar
  // =====================================================================================
  const MANNER = {
    a: ['hızlı', 'yavaş', 'sessizce', 'neşeyle', 'heyecanla', 'hızlıca', 'yavaşça'],      // gecissiz, hareket
    A: ['dikkatle', 'özenle', 'sabırla', 'kolayca', 'hızlıca', 'yavaşça', 'neşeyle', 'sessizce', 'hızlı'], // gecisli, isleme
    q: ['sessizce', 'sakince', 'rahatça'],
    r: ['sessizce'],
    t: ['tatlı tatlı', 'sessizce', 'rahatça'],
    e: ['neşeyle', 'yüksek sesle', 'içtenlikle'],
    s: ['yavaşça', 'yüksek sesle', 'sessizce', 'neşeyle', 'tatlı tatlı'],
  };
  const DEGREE = ['çok', 'biraz', 'oldukça', 'epey', 'gerçekten'];
  const TIME_PAST = ['dün', 'dün akşam', 'dün sabah', 'geçen hafta', 'geçen yıl', 'geçen yaz', 'geçen cumartesi', 'iki gün önce', 'bir hafta önce', 'az önce', 'geçen ay', 'geçen pazar', 'dün gece', 'bir gün', 'geçen kış', 'bugün', 'bu sabah', 'üç gün önce', 'geçen salı', 'geçen cuma'];
  const TIME_FUT = ['yarın', 'yarın sabah', 'yarın akşam', 'gelecek hafta', 'gelecek yıl', 'birazdan', 'iki gün sonra', 'bu akşam', 'bu hafta sonu', 'önümüzdeki hafta', 'cumartesi günü', 'pazar günü', 'gelecek ay', 'yakında', 'bir gün', 'bugün', 'üç gün sonra', 'bir hafta sonra', 'bu gece'];
  const TIME_HAB = ['her sabah', 'her akşam', 'her gün', 'her hafta sonu', 'sabahları', 'akşamları', 'geceleri', 'hafta sonları', 'bazen', 'sık sık', 'genellikle', 'her zaman', 'her cumartesi', 'her pazar', 'kışın', 'yazın', 'ilkbaharda', 'sonbaharda', 'çoğu zaman', 'bazı akşamlar'];
  const TIME_NOW = ['şimdi', 'bugün', 'şu an', 'bugünlerde'];
  const PLACE_ADV = ['burada', 'orada', 'dışarıda', 'içeride', 'yukarıda', 'aşağıda', 'uzakta', 'her yerde'];
  const NAMES = ['Ayşe', 'Ali', 'Mehmet', 'Zeynep', 'Elif', 'Can', 'Deniz', 'Ece', 'Emre', 'Burak', 'Selin', 'Cem', 'Derya', 'Mert', 'Defne', 'Kerem', 'Eylül', 'Berk', 'İrem', 'Onur', 'Melis', 'Kaan', 'Sena', 'Ahmet', 'Fatma', 'Hasan', 'Hatice', 'Murat', 'Merve', 'Özge', 'Yusuf', 'Buse', 'Efe', 'Ela', 'Ada', 'Doruk', 'Asya', 'Arda', 'Duru', 'Poyraz', 'Nehir', 'Ege', 'Naz', 'Yiğit', 'Mustafa', 'Zehra', 'Ceren', 'Barış', 'Aylin', 'Tuna'];
  const CITIES = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Konya', 'Trabzon', 'Adana', 'Eskişehir', 'Kapadokya'];
  const NUM_SMALL = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  const QUANT = { drink: ['bardak', 'şişe'], food: ['tabak', 'dilim', 'kase'], fruit: ['kilo'], veg: ['kilo'], dairy: ['paket', 'dilim'], bread: ['dilim'], sweet: ['dilim', 'paket'] };

  // Hayvan bilgileri.  ad | yer (yiyecek) | ses | eylemler | bacak sayisi | uzuvlar
  // Eylem bicimi:  ^ = kisa yazim: "N:kelime fiil" (yalin nesne), "A:" belirtme, "D:" yonelme, "L:" bulunma, "X:" oldugu gibi on soz; "fiil" tek basina.
  const ANIMAL_DEFS = `
kedi|balık,et|miyavla|N:fare kovala;N:süt iç;N:balık ye;uyu;mırla;D:ağaç tırman;L:pencere otur;L:koltuk uyu|4|kuyruk,kulak,göz,burun,pati,tüy,diş
köpek|et,kemik|havla|N:kemik kemir;N:top kovala;P:kuyruk salla;koş;N:su iç;N:et ye;A:ev koru|4|kuyruk,kulak,göz,burun,pati,tüy,diş
tavşan|havuç,ot,marul|-|N:havuç ye;zıpla;N:ot ye;koş|4|kulak,göz,burun,pati,tüy,kuyruk
hamster|tohum|-|N:tohum ye;koş;uyu|4|göz,kulak,burun,pati
kaplumbağa|marul|-|X:yavaş yürü;N:marul ye;uyu|4|göz,pençe
kuş|tohum|öt|öt;uç;N:yuva yap;N:tohum ye;L:dal otur;D:ağaç kon;L:gökyüzü uç|2|kanat,gaga,tüy,göz
papağan|tohum|-|konuş;N:tohum ye;uç|2|kanat,gaga,tüy,göz
kanarya|tohum|öt|öt;N:tohum ye|2|kanat,gaga,tüy,göz
balık|yem|-|yüz;L:su yaşa;N:yem ye|0|yüzgeç,pul,kuyruk,göz
at|ot|kişne|koş;N:ot ye;N:su iç;kişne;L:ahır uyu|4|yele,kuyruk,kulak,göz,bacak
inek|ot,saman|böğür|N:ot ye;N:süt ver;böğür;L:çayır otla|4|boynuz,kuyruk,kulak,göz,burun
koyun|ot|mele|N:ot ye;mele;N:yün ver;L:çayır otla|4|kuyruk,kulak,göz,burun
keçi|ot|mele|N:ot ye;mele;N:süt ver;L:dağ gez|4|boynuz,kuyruk,kulak,göz
eşek|ot,saman|anır|anır;N:ot ye;N:yük taşı|4|kulak,kuyruk,göz,burun
öküz|ot,saman|-|N:ot ye;L:tarla çalış|4|boynuz,kuyruk,kulak,göz
kuzu|süt,ot|mele|mele;N:süt iç;zıpla|4|kuyruk,kulak,göz,burun
buzağı|süt|-|N:süt iç;zıpla|4|kuyruk,kulak,göz,burun
tavuk|yem,tohum|gıdakla|N:yem ye;gıdakla;yumurtla;L:kümes uyu|2|kanat,gaga,tüy,göz
horoz|yem|öt|öt;N:yem ye;X:sabah öt|2|kanat,gaga,tüy,göz
ördek|ekmek|vakla|yüz;vakla;L:göl yüz|2|kanat,gaga,tüy,göz
kaz|ot|-|yüz;L:göl yüz|2|kanat,gaga,tüy,göz
civciv|yem,tohum|cıvılda|cıvılda;N:yem ye;N:tohum ye|2|kanat,gaga,tüy,göz
aslan|et|kükre|kükre;N:et ye;uyu|4|yele,kuyruk,kulak,göz,burun,diş
kaplan|et|-|N:et ye;L:orman yaşa;koş|4|kuyruk,kulak,göz,burun,diş
fil|ot,yaprak|-|N:ot ye;N:su iç;yürü;X:hortumuyla su iç|4|hortum,kulak,kuyruk,göz,diş
zürafa|yaprak|-|N:yaprak ye;yürü|4|boyun,kulak,kuyruk,göz
maymun|muz|-|N:muz ye;D:ağaç tırman;zıpla|4|kuyruk,kulak,göz,burun
ayı|bal|-|N:bal ye;L:orman yaşa;X:kışın uyu|4|kulak,göz,burun,pati
tilki|-|-|L:orman yaşa;koş|4|kuyruk,kulak,göz,burun
kurt|et|ulu|ulu;L:orman yaşa;N:et ye|4|kuyruk,kulak,göz,burun,diş
geyik|ot|-|N:ot ye;L:orman yaşa;koş|4|boynuz,kuyruk,kulak,göz
deve|ot|-|L:çöl yürü;L:çöl yaşa|4|kuyruk,kulak,göz,burun
zebra|ot|-|N:ot ye;koş|4|kuyruk,kulak,göz,burun
sincap|fındık,ceviz|-|N:fındık topla;N:ceviz ye;D:ağaç tırman;L:ağaç yaşa|4|kuyruk,kulak,göz,burun,diş
fare|peynir|-|N:peynir ye;kaç;koş|4|kuyruk,kulak,göz,burun,diş
penguen|balık|-|yüz;X:buzda yaşa;N:balık ye|2|kanat,göz
yılan|-|tısla|tısla|0|göz
timsah|balık,et|-|yüz;L:nehir yaşa;N:balık ye|4|kuyruk,göz,burun,diş
kurbağa|-|-|zıpla;yüz;L:göl yaşa|4|göz
arı|-|vızılda|N:bal yap;vızılda;X:çiçekten çiçeğe kon|6|kanat,göz
karınca|-|-|N:yiyecek topla;çalış|6|göz
kelebek|-|-|uç;D:çiçek kon;L:bahçe uç|6|kanat,göz
örümcek|-|-|N:ağ ör|8|göz
sinek|-|vızılda|uç;vızılda|6|kanat,göz
serçe|tohum|cıvılda|cıvılda;uç;N:tohum ye|2|kanat,gaga,tüy,göz
kartal|-|-|uç;L:dağ yaşa|2|kanat,gaga,tüy,göz
baykuş|-|-|X:geceleri uç;X:gündüz uyu|2|kanat,gaga,tüy,göz
martı|balık|-|uç;L:deniz uç;L:sahil otur|2|kanat,gaga,tüy,göz
güvercin|tohum|-|uç|2|kanat,gaga,tüy,göz
karga|-|-|uç;L:ağaç otur|2|kanat,gaga,tüy,göz
leylek|-|-|uç;N:yuva yap|2|kanat,gaga,tüy,göz
kuğu|-|-|yüz;L:göl yüz|2|kanat,gaga,tüy,göz
yunus|balık|-|yüz;zıpla;L:deniz yaşa|0|yüzgeç,göz
balina|-|-|yüz;L:deniz yaşa|0|yüzgeç,göz
ahtapot|-|-|yüz;L:deniz yaşa|-1|göz
yengeç|-|-|L:deniz yaşa;L:kum yürü|-1|göz
`;
  const ANIMALS = new Map(); // ad -> { n, eats, sound, acts:[{c,o,v}], legs, parts }
  const EXTRA_VERBS = new Map();
  function xverb(stem) {
    let v = EXTRA_VERBS.get(stem);
    if (!v) {
      for (let i = 0; i < VERBS.length; i++) if (VERBS[i].s === stem && !VERBS[i].pre) { v = VERBS[i]; break; }
      if (!v) v = mkVerb(stem, {});
      EXTRA_VERBS.set(stem, v);
    }
    return v;
  }
  (function () {
    const ls = ANIMAL_DEFS.split('\n');
    for (let i = 0; i < ls.length; i++) {
      const ln = ls[i].trim(); if (!ln) continue;
      const c = ln.split('|');
      const n = NMAP.get(c[0]); if (!n) { LEX_WARN.push('hayvan yok: ' + c[0]); continue; }
      const acts = [];
      c[3].split(';').forEach(function (a) {
        let code = '', rest = a;
        if (a.charAt(1) === ':') { code = a.charAt(0); rest = a.slice(2); }
        const parts = rest.split(' ');
        const verb = xverb(parts[parts.length - 1]);
        const obj = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
        acts.push({ c: code, o: obj, v: verb });
      });
      ANIMALS.set(c[0], {
        n: n, eats: c[1] === '-' ? [] : c[1].split(','), sound: c[2] === '-' ? null : xverb(c[2]), acts: acts,
        legs: +c[4], parts: c[5].split(','),
      });
    }
  })();

  // =====================================================================================
  // 3. YARDIMCILAR, VARLIKLAR (ozne / nesne) VE OBEK KURUCULAR
  // =====================================================================================
  applyTagDefs([
    ['sitp', 'ev oda mutfak salon balkon bahçe park kafe restoran lokanta sınıf kütüphane çay+bahçe sahil plaj çayır'],
    ['thinkable', 'sorun soru cevap plan karar seçim çözüm proje fikir dilek hayal'],
    ['usable', 'telefon bilgisayar tablet kamera kalem silgi cetvel makas çekiç anahtar şemsiye tarak sabun havlu kaşık çatal bıçak fincan bardak dürbün teleskop mikroskop pusula harita radyo televizyon süpürge ütü'],
  ]);
  rebuildTagIndex();

  // ---- onbellekli ek islevleri ----
  function nf(n, pl, poss, cs) {
    const k = (pl ? 1 : 0) + poss * 2 + cs * 14;
    const c = n._c || (n._c = {});
    const s = c[k];
    return s === undefined ? (c[k] = nform(n, !!pl, poss, cs)) : s;
  }
  function vf(v, t, p, n, a, q) {
    const k = t + p + (n ? 'n' : '') + (a ? 'a' : '') + (q ? 'q' : '');
    const c = v._c || (v._c = {});
    return c[k] || (c[k] = vform(v, { t: t, p: p, n: !!n, a: !!a, q: !!q }));
  }
  function vn(v, kind, n, a) {
    const k = '~' + kind + (n ? 'n' : '') + (a ? 'a' : '');
    const c = v._c || (v._c = {});
    return c[k] || (c[k] = vnon(v, kind, { n: !!n, a: !!a }));
  }
  const NAMEF = new Map();
  function nmf(nm, cs) {
    const k = nm + cs; let s = NAMEF.get(k);
    if (s === undefined) { s = nameForm(nm, cs); NAMEF.set(k, s); }
    return s;
  }
  function cap(s) { return s ? upperTR(s.charAt(0)) + s.slice(1) : s; }
  function low1(s) { return s ? lowerTR(s.charAt(0)) + s.slice(1) : s; }
  function jn() { let o = ''; for (let i = 0; i < arguments.length; i++) { const a = arguments[i]; if (a) o += (o ? ' ' : '') + a; } return o; }

  // ---- rastgele yardimcilari (uretec basina) ----
  function mkG(seed) {
    const r = mkRng(seed == null ? 1 : seed);
    const g = {
      r: r,
      f: r,
      i: function (n) { return (r() * n) | 0; },
      p: function (x) { return r() < x; },
      pick: function (a) { return a[(r() * a.length) | 0]; },
      // agirlikli secim: [oge, agirlik, oge, agirlik, ...]
      w: function (a) {
        let t = 0; for (let i = 1; i < a.length; i += 2) t += a[i];
        let x = r() * t;
        for (let i = 0; i < a.length; i += 2) { x -= a[i + 1]; if (x < 0) return a[i]; }
        return a[0];
      },
      ctx: null,
    };
    return g;
  }

  // ---- fiil arama: govdeden fiil nesnesi (ozel sozlukte olmayan fiiller de olur) ----
  const ALTSTEM = { git: 'gid', et: 'ed', tat: 'tad', kaybet: 'kaybed', seyret: 'seyred', hisset: 'hissed' };
  function xv(stem, alt) {
    let v = EXTRA_VERBS.get(stem);
    if (!v) {
      for (let i = 0; i < VERBS.length; i++) if (VERBS[i].s === stem && !VERBS[i].pre) { v = VERBS[i]; break; }
      if (!v) { v = mkVerb(stem, { alt: alt || ALTSTEM[stem] || null }); v.id = stem; v.xtra = true; }
      EXTRA_VERBS.set(stem, v);
    }
    return v;
  }

  // ---- sayilabilirlik / olcu sozcukleri ----
  const COUNT_TAGS = ['hum', 'animal', 'fruit', 'veg', 'obj', 'place', 'body', 'plant', 'read', 'music'];
  const UNCOUNT = { 'çamaşır': 1, 'bulaşık': 1, 'kum': 1, 'toprak': 1, 'doğa': 1, 'toz': 1, 'saman': 1, 'yem': 1, 'para': 1, 'bal': 1 };
  function countable(n) {
    if (n._cnt !== undefined) return n._cnt;
    let r = false;
    if (!n.u && !UNCOUNT[n.w]) for (let i = 0; i < COUNT_TAGS.length; i++) if (n.ts[COUNT_TAGS[i]]) { r = true; break; }
    if (n.ts.drink || n.ts.dairy || n.ts.meal) r = false;
    if (n.ts.sweet && n.w !== 'kurabiye' && n.w !== 'gofret' && n.w !== 'bisküvi' && n.w !== 'lokum' && n.w !== 'tulumba' && n.w !== 'krep') r = false;
    if (n.ts.dish && ['köfte', 'börek', 'pide', 'lahmacun', 'mantı', 'dolma', 'sarma', 'gözleme', 'pizza', 'tost', 'yumurta', 'sosis'].indexOf(n.w) < 0) r = false;
    if (n.ts.bread && n.w !== 'simit' && n.w !== 'poğaça') r = false;
    if (n.ts.nut) r = true;
    n._cnt = r; return r;
  }
  const MEAS = {
    'su': ['bardak', 'şişe'], 'süt': ['bardak', 'şişe'], 'çay': ['bardak', 'fincan'], 'kahve': ['fincan'], 'ayran': ['bardak'],
    'limonata': ['bardak'], 'gazoz': ['şişe', 'bardak'], 'şerbet': ['bardak'], 'meyve suyu': ['bardak'], 'portakal suyu': ['bardak'],
    'elma suyu': ['bardak'], 'bitki çayı': ['fincan', 'bardak'], 'çorba': ['kase', 'tabak'], 'pilav': ['tabak'], 'makarna': ['tabak'],
    'salata': ['tabak', 'kase'], 'menemen': ['tabak'], 'köfte': ['tabak'], 'yoğurt': ['kase'], 'pasta': ['dilim'], 'kek': ['dilim'],
    'baklava': ['dilim'], 'ekmek': ['dilim'], 'peynir': ['dilim'], 'karpuz': ['dilim'], 'kavun': ['dilim'], 'dondurma': ['top'],
    'çikolata': ['parça'], 'reçel': ['kaşık'], 'bal': ['kaşık'], 'helva': ['dilim'], 'sütlaç': ['kase'], 'muhallebi': ['kase'],
  };
  const NUMW = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz', 'on'];

  // ---- isimden varlik (Ent) ----
  // Ent: { k:'noun'|'name'|'pron', n, name, pi, pl, poss, own, det, adj, num, ts, p }
  const HUMTS = { hum: 1, kid: 1 };
  const PRONTS = { hum: 1 };
  const PRONS = [0, 1, 2, 3, 4, 5].map(function (i) { return { k: 'pron', pi: i, p: i, ts: PRONTS }; });
  function eName(nm) { return { k: 'name', name: nm, p: 2, ts: HUMTS }; }
  function eNoun(n, o) {
    o = o || {};
    return { k: 'noun', n: n, ts: n.ts, pl: !!o.pl, poss: o.poss | 0, own: o.own || null, det: o.det || '', adj: o.adj || '', num: o.num || '', p: 2 };
  }
  function posIdx(e) { return e.k === 'pron' ? (e.pi === 5 ? 3 : e.pi + 1) : 3; }
  function np(e, cs) {
    cs = cs | 0;
    if (e.k === 'pron') return PRON[e.pi][cs];
    if (e.k === 'name') return nmf(e.name, cs);
    let s = '';
    if (e.own) s += np(e.own, 5) + ' ';
    const bir = e.det === 'bir' && !e.pl && !e.num;
    if (e.det && !bir && e.det !== 'bir') s += e.det + ' ';
    if (e.num) s += e.num + ' ';
    if (e.adj) s += e.adj + ' ';
    if (bir) s += 'bir ';
    const poss = e.own ? posIdx(e.own) : e.poss;
    return s + nf(e.n, e.pl && !e.num, poss, cs);
  }

  // ---- ozne secimi ----
  function famPoss(g, subj) { return subj ? posIdx(subj) : 3; }
  const HUM_NOUNS = { fam: [], job: [], kid: [], plain: [], tale: [] };
  (function () {
    for (let i = 0; i < NOUNS.length; i++) {
      const n = NOUNS[i];
      if (!n.ts.hum || n.head) continue;
      if (n.ts.fam) HUM_NOUNS.fam.push(n); else if (n.ts.job) HUM_NOUNS.job.push(n);
      else if (n.ts.kid) HUM_NOUNS.kid.push(n); else if (n.ts.tale) HUM_NOUNS.tale.push(n); else HUM_NOUNS.plain.push(n);
    }
  })();
  const FAM_OWN = ['anne', 'baba', 'kardeş', 'abla', 'ağabey', 'dede', 'nine', 'babaanne', 'anneanne', 'teyze', 'amca', 'hala', 'dayı', 'kuzen'];

  // insan ozne: topic = onceden verilen (ust) kisi, ex = disla
  const POSSOK = { 'öğretmen': 1, 'komşu': 1, 'arkadaş': 1, 'doktor': 1, 'müdür': 1, 'kasap': 1, 'bakkal': 1, 'berber': 1, 'terzi': 1, 'şoför': 1, 'çoban': 1, 'tamirci': 1, 'pilot': 1 };
  function humNoun(g, o) {
    o = o || {};
    const kind = g.w(['fam', 3, 'job', 4, 'kid', 3, 'plain', 3]);
    const n = g.pick(HUM_NOUNS[kind]);
    const e = eNoun(n);
    if (kind === 'fam') {
      const r = g.f();
      if (r < 0.5) e.poss = g.w([1, 5, 4, 1]);       // annem, annemiz
      else if (r < 0.75) e.own = g.p(0.5) ? eName(g.pick(NAMES)) : PRONS[g.pick([0, 3])];
      else if (g.p(0.3)) e.pl = true;
      return e;
    }
    const r = g.f();
    if (r < 0.14) e.pl = true;
    else if (r < 0.30) e.det = 'bir';
    else if (r < 0.40) e.det = g.pick(['bu', 'şu', 'o']);
    else if (r < 0.48 && POSSOK[n.w]) { e.poss = g.w([4, 3, 1, 2]); }
    if (!e.pl && g.p(0.18)) { const a = humAdj(g); if (a) { e.adj = a; } }
    if (e.pl && g.p(0.12)) { const a = humAdj(g); if (a) e.adj = a; }
    return e;
  }
  const HUM_ADJ = ['yaşlı', 'genç', 'nazik', 'kibar', 'çalışkan', 'neşeli', 'sakin', 'cesur', 'akıllı', 'sevimli', 'yaramaz', 'meraklı', 'mutlu', 'yorgun'];
  function humAdj(g) { return g.pick(HUM_ADJ); }

  function humanSubject(g, o) {
    o = o || {};
    const r = g.f();
    let e;
    if (r < 0.30) {
      const pi = g.w([0, 9, 1, 3, 2, 9, 3, 6, 4, 2, 5, 4]);
      e = PRONS[pi];
    } else if (r < 0.55) e = eName(g.pick(NAMES));
    else e = humNoun(g, o);
    return e;
  }

  // hayvan ozne
  const ANIMAL_LIST = []; ANIMALS.forEach(function (a) { ANIMAL_LIST.push(a); });
  function animalEnt(g, a) {
    a = a || g.pick(ANIMAL_LIST);
    const e = eNoun(a.n); const r = g.f();
    const pet = a.n.ts.pet;
    if (r < 0.22) e.pl = true;
    else if (r < 0.40) e.det = 'bir';
    else if (r < 0.50) e.det = g.pick(['bu', 'şu']);
    else if (r < 0.62 && pet) { e.poss = g.w([1, 3, 4, 1]); }
    else if (r < 0.70 && pet) { e.own = g.p(0.5) ? eName(g.pick(NAMES)) : PRONS[g.pick([0, 3])]; }
    if (!e.pl && !e.poss && !e.own && g.p(0.2)) { const ad = adjFor(a.n); if (ad.length) e.adj = g.pick(ad); }
    e.animal = a;
    return e;
  }

  // ---- zaman / yer / tarz ----
  const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  function clockText(g, h, digits) {
    // "yedide" / "7'de"
    const suf = numSuf(h, 'DA').slice(numWord(h).length);
    return digits ? h + "'" + suf : numSuf(h, 'DA');
  }
  function timeAdv(g, tense) {
    switch (tense) {
      case 'past': case 'evid': return g.pick(TIME_PAST);
      case 'fut': return g.pick(TIME_FUT);
      case 'prog': return g.pick(TIME_NOW);
      case 'aor': return g.pick(TIME_HAB);
      default: return g.p(0.5) ? g.pick(['bugün', 'şimdi', 'yarın', 'her gün']) : '';
    }
  }
  function mannerOf(g, v) {
    if (!v.mv || v.mv === '-') return '';
    let k = v.mv;
    if (k === 'a' && v.tr !== 'i') k = 'A';
    const l = MANNER[k]; return l ? g.pick(l) : '';
  }

  // etiket kumesinden isim havuzu (onbellekli)
  const POOL = Object.create(null);
  function poolOf(tags) {
    const key = tags.join('+'); let p = POOL[key];
    if (p) return p;
    const seen = new Set(); p = [];
    for (let i = 0; i < tags.length; i++) {
      const l = BYTAG[tags[i]]; if (!l) continue;
      for (let j = 0; j < l.length; j++) if (!seen.has(l[j])) { seen.add(l[j]); p.push(l[j]); }
    }
    POOL[key] = p; return p;
  }

  // baska bir kisi (nesne / ortak): ozneden farkli
  function otherPerson(g, subj, o) {
    o = o || {};
    const sp = subj && subj.k === 'pron' ? subj.pi : -1;
    const r = g.f();
    if (r < 0.34) {
      let nm; do { nm = g.pick(NAMES); } while (subj && subj.k === 'name' && subj.name === nm);
      return eName(nm);
    }
    if (r < 0.52) {
      let pi;
      do { pi = g.w([0, 4, 1, 4, 2, 4, 3, 2, 4, 1, 5, 2]); } while (pi === sp || (o.noOne && pi === 0 && subj && subj.k === 'name'));
      return PRONS[pi];
    }
    if (r < 0.86) {
      const n = noun(g.pick(FAM_OWN)); const e = eNoun(n);
      if (subj && subj.k === 'noun' && subj.n === n) { e.n = noun('arkadaş'); }
      e.poss = subj ? posIdx(subj) : 3; return e;
    }
    const n = noun(g.pick(['arkadaş', 'komşu', 'öğretmen', 'misafir', 'çocuk', 'kız', 'oğlan']));
    const e = eNoun(n);
    if (n.w === 'arkadaş' || n.w === 'komşu' || n.w === 'öğretmen') e.poss = subj ? posIdx(subj) : 3;
    else if (g.p(0.5)) e.det = 'bir';
    if (e.poss === 0 && g.p(0.3)) e.det = g.pick(['bu', 'şu', 'o']);
    return e;
  }

  // =====================================================================================
  // 4. YUKLEM CEKIRDEGI: fiil secimi, nesne/tumlec secimi, cumle (clause) kurma ve yazma
  // =====================================================================================
  const BARE_OK = {};
  ('ye iç oku yaz çiz yap çal sür oyna izle dinle iste getir ver pişir hazırla kızart kaynat karıştır doğra yoğur kes dik boya al topla at giy tak sor seç hisset ara çek ekle sat demle').split(' ').forEach(function (s) { BARE_OK[s] = 1; });
  const ACC_ALWAYS = {};
  ('sev beğen özle karşıla öp kucakla okşa besle çağır davet_et ziyaret_et bekle kokla').split(' ').forEach(function (s) { ACC_ALWAYS[s] = 1; });
  const WEAR_V = { 'giy': 1, 'tak': 1, 'çıkar': 1, 'bağla': 1 };
  const BODY_PL = { 'el': 1, 'ayak': 1, 'diş': 1, 'göz': 1, 'kulak': 1, 'kol': 1, 'bacak': 1, 'parmak': 1, 'tırnak': 1, 'kaş': 1 };
  const OWNP = { 'ev': 3, 'oda': 3, 'bahçe': 3, 'mutfak': 3, 'salon': 3, 'balkon': 3, 'sınıf': 4, 'okul': 4, 'mahalle': 4, 'köy': 4 };

  // ---- fiil havuzlari (ozne etiketlerine gore) ----
  function verbOK(v) {
    if (v._ok !== undefined) return v._ok;
    let ok = true;
    const hasHum = v.ob.indexOf('hum') >= 0 || v.ob.indexOf('fam') >= 0;
    if (v.tr !== 'i') { if (!hasHum && poolOf(v.ob).length === 0) ok = false; }
    if (v.tr === 'td' || v.tr === 'tw') { const dh = v.dat.indexOf('hum') >= 0 || v.dat.indexOf('kid') >= 0; if (!dh && poolOf(v.dat).length === 0) ok = false; }
    v._ok = ok; return ok;
  }
  function buildVPool(ts) {
    const P = { all: [], i: [], t: [], c: [] };
    for (let i = 0; i < VERBS.length; i++) {
      const v = VERBS[i]; let m = false;
      for (let k = 0; k < v.sj.length; k++) if (ts[v.sj[k]]) { m = true; break; }
      if (!m || !verbOK(v)) continue;
      P.all.push(v);
      if (v.tr === 'i') P.i.push(v); else if (v.tr === 't' || v.tr === 'td' || v.tr === 'tw') P.t.push(v); else P.c.push(v);
    }
    return P;
  }
  const VP_HUM = buildVPool(HUMTS), VP_PRON = buildVPool(PRONTS);
  function subjPool(e) {
    if (e.k === 'name') return VP_HUM;
    if (e.k === 'pron') return VP_PRON;
    return e.n._vp || (e.n._vp = buildVPool(e.n.ts));
  }
  function pickVerb(g, subj, want) {
    const P = subjPool(subj);
    let l;
    if (want === 'i') l = P.i; else if (want === 't') l = P.t; else if (want === 'c') l = P.c;
    else {
      const k = g.w(['i', 26, 't', 48, 'c', 26]);
      l = k === 'i' ? P.i : k === 't' ? P.t : P.c;
    }
    if (!l.length) l = P.all;
    return l.length ? l[(g.f() * l.length) | 0] : null;
  }

  // ---- yer tumlecleri ----
  const CITY_OK = { 'goto': 1, 'city': 1, 'comefrom': 1 };
  const PLACE_ADJ = ['büyük', 'küçük', 'güzel', 'geniş', 'sessiz', 'kalabalık', 'yeni', 'eski'];
  const LOC_REQ = { 'otur': 1, 'kal': 1, 'yaşa': 1 };
  function placeNP(g, n, cs, subj) {
    const r = g.f();
    const own = OWNP[n.w];
    if (own && r < 0.30 && subj) { return nf(n, false, own === 4 ? 4 : posIdx(subj), cs); }
    if (r < 0.42) return g.pick(['bu', 'şu', 'o']) + ' ' + nf(n, false, 0, cs);
    if (r < 0.50 && !n.ts.nat) { return g.pick(PLACE_ADJ) + ' ' + nf(n, false, 0, cs); }
    return nf(n, false, 0, cs);
  }
  function cityNP(g, cs) { return nmf(g.pick(CITIES), cs); }

  function locFor(g, v, subj) {
    const l = poolOf(v.loc); if (!l.length) return '';
    if (v.loc.indexOf('city') >= 0 && g.p(0.4)) return cityNP(g, 3);
    return placeNP(g, g.pick(l), 3, subj);
  }

  // ---- tumlec: yonelme (2) / ayrilma (4) ----
  function personFor(g, subj, only) {
    if (only === 'fam') { const n = noun(g.pick(FAM_OWN)); const e = eNoun(n, { poss: posIdx(subj) }); if (subj.k === 'noun' && subj.n === n) e.poss = 3; return e; }
    return otherPerson(g, subj);
  }
  function compFor(g, tags, cs, subj) {
    const hum = tags.indexOf('hum') >= 0, fam = tags.indexOf('fam') >= 0;
    const pool = poolOf(tags.filter(function (t) { return t !== 'hum' && t !== 'fam'; }));
    if ((hum || fam) && (!pool.length || g.p(0.55))) return { txt: np(personFor(g, subj, hum ? '' : 'fam'), cs), person: true };
    if (!pool.length) return { txt: '', person: false };
    if ((tags.indexOf('goto') >= 0 || tags.indexOf('city') >= 0 || tags.indexOf('comefrom') >= 0) && g.p(0.16)) return { txt: cityNP(g, cs), person: false, city: true };
    const n = g.pick(pool);
    if (n.ts.hum && n.ts.fam) return { txt: np(eNoun(n, { poss: posIdx(subj) }), cs), person: true };
    return { txt: placeNP(g, n, cs, subj), person: !!n.ts.hum, n: n };
  }

  // ---- nesne ----
  function objEntFor(g, v, subj, n) {
    const b = BARE_OK[v.id] === 1 && !v.pre;
    const e = eNoun(n); let cs = 1; let r = g.f();
    if (n.ts.body) { e.pl = !!BODY_PL[n.w] && g.p(0.6); e.poss = posIdx(subj); return { e: e, cs: 1 }; }
    if (n.ts.fam) { e.poss = posIdx(subj); return { e: e, cs: 1 }; }
    const cnt = countable(n);
    const wear = n.ts.wear || n.ts.acc;
    const ownable = n.ts.obj || n.ts.read || n.ts.stat || (n.ts.animal && n.ts.pet);
    if (ownable && r < (wear && WEAR_V[v.id] ? 0.6 : 0.2)) { e.poss = posIdx(subj); if (g.p(0.25)) { const a = adjFor(n); if (a.length) e.adj = g.pick(a); } return { e: e, cs: 1 }; }
    r = g.f();
    const acc = ACC_ALWAYS[v.id] === 1;
    if (!cnt) {
      const ms = MEAS[n.w];
      if (b && r < 0.22) cs = 0;
      else if (b && ms && r < 0.55) { cs = 0; e.num = g.pick(['bir', 'bir', 'iki', 'üç']) + ' ' + g.pick(ms); }
      else if (b && !n.ts.abs && r < 0.64) { cs = 0; e.det = 'biraz'; }
      else e.det = g.w(['', 62, 'bu', 16, 'şu', 8, 'o', 14]);
    } else if (r < 0.40) e.det = g.w(['', 62, 'bu', 16, 'şu', 8, 'o', 14]);
    else if (r < 0.60) { e.det = 'bir'; cs = acc ? 1 : 0; }
    else if (r < 0.72) { e.num = NUMW[2 + g.i(4)]; cs = acc ? 1 : 0; }
    else if (r < 0.82) { e.pl = true; }
    else if (r < 0.94 && b) { cs = 0; }
    else e.det = g.w(['', 62, 'bu', 16, 'şu', 8, 'o', 14]);
    if (!e.adj && !e.num && g.p(0.28)) { const a = adjFor(n); if (a.length) e.adj = g.pick(a); }
    return { e: e, cs: cs };
  }
  function objFor(g, v, subj) {
    const hum = v.ob.indexOf('hum') >= 0, fam = v.ob.indexOf('fam') >= 0;
    const pool = poolOf(v.ob.filter(function (t) { return t !== 'hum' && t !== 'fam'; }));
    if ((hum || fam) && (!pool.length || g.p(0.5))) return { e: personFor(g, subj, hum ? '' : 'fam'), cs: 1, person: true };
    return objEntFor(g, v, subj, g.pick(pool));
  }

  // ---- cumle (clause) ----
  function pickTense(g) { return g.w(['past', 30, 'prog', 25, 'aor', 14, 'fut', 15, 'evid', 5, 'nec', 6]); }

  // o: subj, verb, tr, tense, neg, abil, time (true/false/metin), place (true/false), manner (true/false), lead, showSubj
  function mkClause(g, o) {
    o = o || {};
    const subj = o.subj || humanSubject(g);
    const v = o.verb || pickVerb(g, subj, o.tr);
    if (!v) return null;
    const c = {
      subjE: subj, v: v, p: subj.p, t: o.tense || pickTense(g), neg: o.neg !== undefined ? o.neg : g.p(0.13), abil: o.abil !== undefined ? o.abil : false,
      time: '', loc: '', dat: '', datPerson: false, abl: '', partner: '', obj: '', objE: null, objCs: 0, objPerson: false, manner: '', lead: '', showSubj: true,
    };
    if (o.abil === undefined && (c.t === 'aor' || c.t === 'prog' || c.t === 'fut') && g.p(0.08) && v.tr !== 'i') c.abil = true;
    if (c.t === 'evid') { c.neg = g.p(0.15); if (c.p !== 2 && c.p !== 5) c.t = 'past'; }
    c.showSubj = o.showSubj !== undefined ? o.showSubj : (subj.k !== 'pron' || g.p(0.5));
    switch (v.tr) {
      case 'i': if (v.loc.length && (o.place === true || LOC_REQ[v.id] || (o.place !== false && g.p(0.5)))) c.loc = locFor(g, v, subj); break;
      case 't': case 'td': case 'tw': {
        let ob = o.objNoun ? objEntFor(g, v, subj, o.objNoun) : objFor(g, v, subj);
        for (let k = 0; k < 6 && subj.k === 'noun' && ob.e.k === 'noun' && ob.e.n === subj.n && !o.objNoun; k++) ob = objFor(g, v, subj);
        c.objE = ob.e; c.objCs = ob.cs; c.objPerson = !!ob.person; c.obj = np(ob.e, ob.cs);
        if (v.tr === 'td') { const d = compFor(g, v.dat, 2, subj); c.dat = d.txt; c.datPerson = d.person; }
        else if (v.tr === 'tw') { c.partner = np(personFor(g, subj, 'kid'), 6); }
        else if (v.loc.length && (o.place === true || (o.place !== false && g.p(0.3)))) c.loc = locFor(g, v, subj);
        break;
      }
      case 'd': { const d = compFor(g, v.ob, 2, subj); c.dat = d.txt; c.datPerson = d.person; break; }
      case 'b': { const d = compFor(g, v.ob, 4, subj); c.abl = d.txt; c.ablPerson = d.person; break; }
      case 'w': { const p = personFor(g, subj, 'hum'); c.partner = np(p, 6); break; }
    }
    if (v.tr === 'w' && v.loc.length && g.p(0.3)) c.loc = locFor(g, v, subj);
    if (o.time === true || (o.time !== false && g.p(0.34))) c.time = typeof o.time === 'string' ? o.time : timeAdv(g, c.t);
    if (o.manner === true || (o.manner !== false && g.p(0.22))) c.manner = mannerOf(g, v);
    if (o.lead) c.lead = o.lead;
    else if (c.time && g.p(0.55)) c.lead = 'time';
    else if (c.loc && !c.time && g.p(0.25)) c.lead = 'loc';
    return c;
  }

  // yazim. o: q (evet/hayir), wh: soru sozcugu turu, noSubj, plain (zaman/lead yok)
  function objWh(g, c, kind) {
    const e = c.objE;
    if (!e) return null;
    if (kind === 'ne') return (c.objPerson ? 'kimi' : (c.objCs === 1 && g.p(0.25) ? 'neyi' : 'ne'));
    if (kind === 'kaç') {
      if (!e || e.k !== 'noun' || !countable(e.n) || e.poss || e.own) return null;
      return 'kaç ' + nf(e.n, false, 0, 0);
    }
    if (kind === 'hangi') {
      if (!e || e.k !== 'noun' || e.poss || e.own) return null;
      const ee = Object.assign({}, e); ee.det = 'hangi'; ee.num = ''; ee.pl = false; ee.adj = '';
      return np(ee, c.objCs || 1);
    }
    return null;
  }
  function renderClause(g, c, o) {
    o = o || {};
    const wh = o.wh || '';
    let tm = c.time, subj = c.showSubj && !o.noSubj ? np(c.subjE, 0) : '';
    let loc = c.loc, dat = c.dat, abl = c.abl, partner = c.partner, obj = c.obj, manner = c.manner, p = c.p, whyTxt = '';
    if (o.plain) tm = '';
    if (wh === 'time') tm = 'ne zaman';
    else if (wh === 'subj') { subj = 'kim'; p = 2; }
    else if (wh === 'loc') loc = 'nerede';
    else if (wh === 'dat') dat = c.datPerson ? 'kime' : 'nereye';
    else if (wh === 'abl') abl = c.ablPerson ? 'kimden' : 'nereden';
    else if (wh === 'partner') partner = 'kiminle';
    else if (wh === 'manner') manner = 'nasıl';
    else if (wh === 'why') whyTxt = 'neden';
    else if (wh === 'ne' || wh === 'kaç' || wh === 'hangi') { obj = objWh(g, c, wh); if (obj === null) return null; }
    const verb = vf(c.v, c.t, p, c.neg, c.abil, !!o.q);
    let parts = [];
    let lead = c.lead;
    if (wh === 'time' || wh === 'loc') lead = '';
    if (lead === 'time' && tm) { parts.push(tm); tm = ''; }
    else if (lead === 'loc' && loc) { parts.push(loc); loc = ''; }
    if (subj) parts.push(subj);
    if (tm) parts.push(tm);
    if (loc) parts.push(loc);
    if (partner) parts.push(partner);
    if (abl) parts.push(abl);
    if (dat) parts.push(dat);
    if (obj) parts.push(obj);
    if (manner) parts.push(manner);
    if (whyTxt) parts.push(whyTxt);
    parts.push(verb);
    return parts.join(' ');
  }
  // fiil-oncesi bilesenler (cikarilmis ozne/zaman); zarf-fiil cumleleri icin
  function clauseArgs(c, o) {
    o = o || {};
    const parts = [];
    if (c.showSubj && o.subj) parts.push(np(c.subjE, 0));
    if (c.loc && !o.noLoc) parts.push(c.loc);
    if (c.partner) parts.push(c.partner);
    if (c.abl) parts.push(c.abl);
    if (c.dat) parts.push(c.dat);
    if (c.obj) parts.push(c.obj);
    if (c.manner && !o.noManner) parts.push(c.manner);
    return parts.join(' ');
  }
  function endMark(g, s, mark) { return cap(s) + (mark || '.'); }

  // =====================================================================================
  // 4b. FIIL ORUNTU MINI DILI (VP) VE SENARYO KUTUPHANESI
  //   'kod:kelime kod:kelime ... fiil'.  Kodlar (kelime bir isim; '_' bosluk, sonda '+' cokluk, {a,b,c} rastgele secim):
  //   N yalin  A -I  M cokluk -I  D -A  L -DA  B -DAn  I ile   P/H/R/Y/T/S = ozne iyeliginde -I/-A/-DA/-DAn/ile/yalin   X oldugu gibi
  //   Ornek: 'P:yüz yıka' -> yüzünü yıkadı ; 'D:okul git' -> okula gitti ; 'N:{çay,süt} iç' ; 'X:erken kalk'
  // =====================================================================================
  const VPC = new Map();
  function parseVP(spec) {
    let p = VPC.get(spec); if (p) return p;
    const parts = spec.split(' ');
    let verb = parts.pop();
    if (verb.charAt(1) === ':') verb = verb.slice(2);
    const toks = parts.map(function (t) {
      let code = 'X', w = t;
      if (t.charAt(1) === ':') { code = t.charAt(0); w = t.slice(2); }
      const alts = w.charAt(0) === '{' ? w.slice(1, -1).split(',') : null;
      return { c: code, w: alts ? null : w, alts: alts };
    });
    let vb = verb, alt = null;
    p = { toks: toks, verb: xv(vb, alt), spec: spec };
    VPC.set(spec, p); return p;
  }
  function tokText(g, t, subj) {
    let w = t.alts ? t.alts[(g.f() * t.alts.length) | 0] : t.w;
    if (t.c === 'X') return w.replace(/_/g, ' ');
    let pl = false;
    if (w.charAt(w.length - 1) === '+') { pl = true; w = w.slice(0, -1); }
    const n = NMAP.get(w.replace(/_/g, ' '));
    if (!n) throw new Error('vp isim yok: ' + w);
    const po = subj ? posIdx(subj) : 3;
    switch (t.c) {
      case 'N': return nf(n, pl, 0, 0);
      case 'A': return nf(n, pl, 0, 1);
      case 'M': return nf(n, true, 0, 1);
      case 'D': return nf(n, pl, 0, 2);
      case 'L': return nf(n, pl, 0, 3);
      case 'B': return nf(n, pl, 0, 4);
      case 'I': return nf(n, pl, 0, 6);
      case 'P': return nf(n, pl, po, 1);
      case 'H': return nf(n, pl, po, 2);
      case 'R': return nf(n, pl, po, 3);
      case 'Y': return nf(n, pl, po, 4);
      case 'S': return nf(n, pl, po, 0);
      case 'T': return nf(n, pl, po, 6);
    }
    throw new Error('vp kod? ' + t.c);
  }
  function vpArgs(g, spec, subj) {
    const p = parseVP(spec); let s = '';
    for (let i = 0; i < p.toks.length; i++) { const x = tokText(g, p.toks[i], subj); s += (s ? ' ' : '') + x; }
    return s;
  }
  // sonlu: o = { t, neg, q, abil, noSubj, time }
  function vpFin(g, spec, subj, o) {
    o = o || {};
    const p = parseVP(spec);
    const args = vpArgs(g, spec, subj);
    const verb = vf(p.verb, o.t || 'past', subj.p, !!o.neg, !!o.abil, !!o.q);
    return jn(o.time, o.noSubj ? '' : np(subj, 0), o.mid, args, verb);
  }
  // sonlu olmayan: kind = ip | ken | mak | inca | madan | diktan | an | erek
  function vpNon(g, spec, subj, kind, neg, o) {
    o = o || {};
    const p = parseVP(spec);
    const args = vpArgs(g, spec, subj);
    return jn(o.subj ? np(subj, 0) : '', args, vn(p.verb, kind, !!neg, false));
  }
  function vpInf(g, spec, subj, cs, neg) { // "kitap okumayı" (cs 1), "yüzmeye" (cs 2)
    const p = parseVP(spec);
    return jn(vpArgs(g, spec, subj), vinf(p.verb, cs, { n: !!neg }));
  }
  function vpPart(g, spec, subj, kind, poss, cs) { // yaptığı, gideceği
    const p = parseVP(spec);
    return jn(vpArgs(g, spec, subj), vpart(p.verb, kind, poss, cs));
  }

  // ---- senaryo kutuphanesi (her satir tek bir eylem) ----
  const VPL = {
    wake: ['X:erken kalk', 'X:erken kalk', 'X:geç kalk', 'X:uyan'],
    wash: ['P:yüz yıka', 'P:el+ yıka', 'P:yüz yıka', 'P:diş+ fırçala', 'P:saç tara'],
    breakfast: ['N:kahvaltı yap', 'N:kahvaltı yap', 'N:çay iç', 'N:süt iç', 'N:{ekmek,peynir,yumurta,simit} ye', 'N:kahvaltı hazırla'],
    dress: ['P:{ceket,mont,palto,kazak,ayakkabı} giy', 'P:{şapka,atkı,eldiven} tak', 'P:çanta hazırla', 'P:çanta al'],
    goSchool: ['D:okul git', 'D:okul git', 'I:otobüs git', 'X:yürüyerek okula git'],
    goWork: ['D:iş git', 'I:otobüs git', 'I:metro git'],
    school: ['D:sınıf gir', 'L:sınıf otur', 'A:öğretmen dinle', 'P:defter aç', 'P:kitap aç', 'N:not al', 'N:ders çalış', 'N:soru sor', 'D:öğretmen N:soru sor', 'N:ödev yap', 'A:{şiir,hikaye} oku', 'N:resim yap', 'N:{futbol,basketbol,voleybol} oyna', 'L:bahçe oyna', 'P:arkadaş bekle', 'N:öğle_yemeği ye', 'A:harita çiz', 'X:yeni kelimeler öğren'],
    home: ['D:ev gel', 'D:ev dön', 'P:el+ yıka', 'P:ayakkabı çıkar', 'P:ceket çıkar', 'P:ceket as', 'L:koltuk otur', 'X:biraz dinlen', 'N:ödev yap', 'N:ders çalış', 'N:akşam_yemeği ye', 'N:akşam_yemeği hazırla', 'N:çay iç', 'N:televizyon izle', 'N:film izle', 'N:müzik dinle', 'N:kitap oku', 'N:oyun oyna'],
    night: ['P:diş+ fırçala', 'P:pijama giy', 'D:yatak gir', 'X:erken yat', 'N:kitap oku', 'X:uyu'],
    kitchen: ['A:{domates,soğan,havuç,patates,salatalık,biber} doğra', 'N:yumurta kızart', 'A:{makarna,pilav,çorba,yemek} pişir', 'N:çay demle', 'A:su kaynat', 'A:hamur yoğur', 'N:kek yap', 'A:bulaşık yıka', 'A:masa sil', 'A:mutfak temizle', 'N:salata yap', 'A:limon sık', 'N:tuz ekle', 'A:tencere doldur'],
    garden: ['M:çiçek sula', 'A:fidan dik', 'N:ağaç dik', 'M:yaprak topla', 'M:kuş izle', 'A:kedi besle', 'A:çimen biç', 'L:bahçe çalış', 'A:bahçe temizle', 'A:kapı boya'],
    park: ['L:park yürü', 'X:yürüyüş yap', 'N:top oyna', 'N:saklambaç oyna', 'N:bisiklet sür', 'M:ördek izle', 'M:kuş besle', 'N:dondurma ye', 'A:uçurtma uçur', 'X:piknik yap', 'L:çayır koş'],
    market: ['D:market git', 'X:alışveriş yap', 'N:{elma,muz,portakal,domates,ekmek,süt,peynir,yumurta,çilek,limon} al', 'B:market N:ekmek al', 'A:sepet doldur', 'A:para öde', 'N:meyve seç'],
    sea: ['D:deniz gir', 'X:yüz', 'L:plaj otur', 'M:dalga izle', 'P:mayo giy', 'N:dondurma ye', 'M:martı izle', 'N:fotoğraf çek'],
    zoo: ['D:hayvanat_bahçesi git', 'A:{aslan,fil,zürafa,maymun,penguen,zebra,kaplan,deve} gör', 'A:{maymun,penguen,fil,zürafa} izle', 'N:fotoğraf çek', 'N:dondurma ye', 'X:hayvanları izle'],
    library: ['D:kütüphane git', 'A:kitap seç', 'N:kitap oku', 'N:not al', 'N:ödev yap', 'L:masa otur', 'A:{roman,şiir,hikaye,masal} oku'],
    cinema: ['D:sinema git', 'N:film izle', 'N:bilet al', 'A:film beğen', 'N:mısır ye'],
  };
  // gunluk rutinler: kaynak listeler + secim olasiligi
  const ROUTINE = {
    kidDay: [[1, 'wake'], [0.8, 'wash'], [0.6, 'wash'], [0.9, 'breakfast'], [0.5, 'dress'], [1, 'goSchool'], [0.9, 'school'], [0.7, 'school'], [0.5, 'school'], [0.9, 'home'], [0.7, 'home'], [0.6, 'home'], [0.7, 'night']],
    adultDay: [[1, 'wake'], [0.8, 'wash'], [0.9, 'breakfast'], [0.5, 'dress'], [1, 'goWork'], [0.8, 'home'], [0.7, 'kitchen'], [0.6, 'home'], [0.6, 'home'], [0.7, 'night']],
  };
  // ardisik eylem cifti (-Ip): once, sonra
  const SEQ2 = [
    ['X:erken kalk', 'P:yüz yıka'], ['X:erken kalk', 'N:kahvaltı yap'], ['P:yüz yıka', 'N:kahvaltı yap'], ['N:kahvaltı yap', 'D:okul git'],
    ['D:ev gel', 'P:el+ yıka'], ['D:ev dön', 'P:ceket as'], ['D:ev gel', 'N:yemek ye'], ['D:ev gel', 'X:biraz dinlen'], ['D:ev gel', 'N:ödev yap'],
    ['D:market git', 'N:ekmek al'], ['D:market git', 'N:{elma,muz,süt,peynir,yumurta} al'], ['D:pazar git', 'N:meyve al'],
    ['P:ceket giy', 'X:dışarı çık'], ['P:ayakkabı giy', 'X:dışarı çık'], ['L:koltuk otur', 'N:kitap oku'], ['L:koltuk otur', 'N:televizyon izle'],
    ['D:mutfak gir', 'N:çay demle'], ['A:su kaynat', 'N:çay demle'], ['A:domates doğra', 'N:salata yap'], ['A:hamur yoğur', 'N:kek yap'], ['D:park git', 'N:top oyna'],
    ['D:bahçe çık', 'M:çiçek sula'], ['D:kütüphane git', 'A:kitap seç'], ['D:sınıf gir', 'H:yer otur'], ['P:defter aç', 'N:not al'],
    ['D:deniz gir', 'X:yüz'], ['D:yatak gir', 'X:uyu'], ['P:diş+ fırçala', 'D:yatak gir'], ['P:pijama giy', 'D:yatak gir'],
  ];
  // amac: [eylem (-mAk icin), hareket]  "Su içmek için mutfağa gitti."
  const PURPOSE = [
    ['N:su iç', 'D:mutfak git'], ['N:kitap oku', 'D:kütüphane git'], ['N:ekmek al', 'D:fırın git'], ['X:alışveriş yap', 'D:market git'],
    ['X:yüz', 'D:deniz git'], ['N:top oyna', 'D:park git'], ['N:film izle', 'D:sinema git'], ['X:hayvanları gör', 'D:hayvanat_bahçesi git'],
    ['N:çay iç', 'D:çay_bahçesi git'], ['N:meyve al', 'D:pazar git'], ['N:ders çalış', 'D:kütüphane git'], ['N:kahvaltı yap', 'D:mutfak git'],
    ['A:çiçek+ sula', 'D:bahçe çık'], ['X:dinlen', 'D:oda git'], ['P:arkadaş+ gör', 'D:okul git'], ['X:yürüyüş yap', 'D:sahil git'], ['N:ödev yap', 'D:oda git'],
  ];
  // -ken: [arka plan eylemi, on plan eylemi]
  const KENPAIRS = [
    ['X:yürü', 'M:kuş izle'], ['X:yürü', 'N:şarkı söyle'], ['X:yürü', 'N:müzik dinle'], ['X:yürü', 'X:hayal kur'], ['X:yürü', 'T:arkadaş konuş'],
    ['N:yemek ye', 'N:müzik dinle'], ['N:yemek ye', 'N:televizyon izle'], ['N:yemek ye', 'T:arkadaş konuş'], ['N:çay iç', 'N:kitap oku'], ['N:çay iç', 'A:gökyüzü izle'],
    ['N:kitap oku', 'N:müzik dinle'], ['N:ders çalış', 'N:müzik dinle'], ['N:yemek yap', 'N:şarkı söyle'], ['N:yemek yap', 'N:müzik dinle'], ['N:bulaşık yıka', 'N:şarkı söyle'],
    ['N:televizyon izle', 'N:çay iç'], ['N:televizyon izle', 'N:kek ye'], ['X:oyna', 'X:çok gül'], ['X:koş', 'X:düş'], ['N:resim yap', 'N:müzik dinle'],
    ['L:bahçe çalış', 'N:şarkı söyle'], ['N:kahvaltı yap', 'N:gazete oku'], ['L:koltuk otur', 'N:film izle'], ['X:alışveriş yap', 'T:arkadaş karşılaş'], ['L:sınıf otur', 'A:öğretmen dinle'],
  ];

  // =====================================================================================
  // 4c. CUMLE AILELERI (a): duz, zarfli, yer/zaman, soru, olumsuz, emir, baglaclar, zarf-fiiller
  // Her aile: fam(g) -> noktalama dahil, buyuk harfle baslayan tek cumle.
  // =====================================================================================
  function subjFor(g, o) { // kisi ozne, cogunlukla ad/zamir/isim
    return humanSubject(g, o);
  }
  function pluperf(v, p, neg) { // susamisti
    const ev = vf(v, 'evid', 2, neg, false, false);
    return join(ev, null, ['(y)DI', K[p]]);
  }
  function withPast(v, t, p, neg, ab) { // yagiyordu, yapardi
    const b = vf(v, t, 2, neg, ab, false);
    return join(b, null, ['(y)DI', K[p]]);
  }

  // 1. duz SOV
  function fBasic(g) {
    const c = mkClause(g, {});
    return endMark(g, renderClause(g, c), '.');
  }
  // 2. sifatli / zarfli
  function fAdjAdv(g) {
    const c = mkClause(g, { manner: true, time: g.p(0.3) });
    if (c.objE && c.objE.k === 'noun' && !c.objE.adj && !c.objE.num && !c.objE.poss) {
      const a = adjFor(c.objE.n); if (a.length) { c.objE.adj = g.pick(a); c.obj = np(c.objE, c.objCs); }
    }
    return endMark(g, renderClause(g, c), '.');
  }
  // 3. yer tumleci
  function fPlace(g) {
    const subj = subjFor(g);
    const P = subjPool(subj);
    const cand = P.all.filter(function (v) { return v.loc.length && v.tr !== 'w'; });
    const v = cand[g.i(cand.length)];
    const c = mkClause(g, { subj: subj, verb: v, place: true, time: g.p(0.25) });
    if (!c.loc) return fBasic(g);
    return endMark(g, renderClause(g, c), '.');
  }
  // 4. zaman tumleci
  function fTime(g) {
    const c = mkClause(g, { time: true, neg: g.p(0.08) });
    return endMark(g, renderClause(g, c), '.');
  }
  // 9. olumsuz
  function fNeg(g) {
    const c = mkClause(g, { neg: true, tense: g.w(['past', 30, 'prog', 25, 'aor', 20, 'fut', 15, 'nec', 6]) });
    return endMark(g, renderClause(g, c), '.');
  }
  // yeterlik -(y)Abil
  function fAbil(g) {
    const c = mkClause(g, { abil: true, tense: g.w(['aor', 50, 'past', 10, 'prog', 10, 'fut', 12]), neg: g.p(0.3), tr: g.pick(['i', 't', 't', 'c']) });
    return endMark(g, renderClause(g, c), '.');
  }

  // 7. evet/hayir sorusu
  function fQYN(g) {
    const r = g.f();
    let subj;
    if (r < 0.40) subj = PRONS[1]; else if (r < 0.48) subj = PRONS[4]; else subj = subjFor(g);
    const c = mkClause(g, { subj: subj, neg: g.p(0.08), showSubj: subj.k === 'pron' ? g.p(0.15) : true, tense: g.w(['past', 32, 'prog', 26, 'fut', 18, 'aor', 12, 'nec', 6, 'evid', 3]) });
    if (c.t === 'evid' && c.p !== 2) c.t = 'past';
    const s = renderClause(g, c, { q: true });
    return endMark(g, s, '?');
  }
  // 8. ne / kim / nerede / nasil / neden / kac / hangi ...
  const WHKINDS = ['ne', 'ne', 'ne', 'time', 'loc', 'dat', 'abl', 'manner', 'why', 'kaç', 'hangi', 'subj', 'partner'];
  function fQWH(g) {
    for (let k = 0; k < 12; k++) {
      const wh = g.pick(WHKINDS);
      let tr;
      switch (wh) {
        case 'ne': case 'kaç': case 'hangi': tr = 't'; break;
        case 'dat': tr = 'd'; break;
        case 'abl': tr = 'b'; break;
        case 'partner': tr = g.pick(['w', 't']); break;
        default: tr = undefined;
      }
      const r = g.f();
      const subj = r < 0.28 ? PRONS[1] : r < 0.40 ? PRONS[4] : subjFor(g);
      let v = null;
      if (wh === 'loc') { const cand = subjPool(subj).all.filter(function (x) { return x.loc.length; }); v = cand[g.i(cand.length)]; }
      if (wh === 'partner') { const cand = subjPool(subj).all.filter(function (x) { return x.tr === 'w' || x.tr === 'tw'; }); v = cand[g.i(cand.length)]; }
      const c = mkClause(g, { subj: subj, verb: v || undefined, tr: v ? undefined : tr, neg: g.p(0.04), place: wh === 'loc' ? true : false, time: wh === 'time' ? true : false,
        showSubj: wh === 'subj' ? true : (subj.k === 'pron' ? g.p(0.2) : true), tense: g.w(['past', 40, 'prog', 26, 'fut', 20, 'aor', 12]) });
      if (!c) continue;
      if (wh === 'dat' && !c.dat) continue;
      if (wh === 'abl' && !c.abl) continue;
      if (wh === 'partner' && !c.partner) continue;
      if (wh === 'subj' && (c.v.tr === 'w')) continue;
      const s = renderClause(g, c, { wh: wh, noSubj: false });
      if (s) return endMark(g, s, '?');
    }
    return fQYN(g);
  }

  // 10. emir / oneri
  const IMP_NEG_OK = { 'unut': 1, 'kır': 1, 'dök': 1, 'kaybet': 1, 'üzül': 1, 'kork': 1, 'şaşır': 1, 'yorul': 1, 'ağla': 1, 'bağır': 1, 'koş': 1, 'kız': 1 };
  const IMP_OK_EXTRA = { 'ver': 1, 'bırak': 1, 'seç': 1, 'dene': 1, 'kokla': 1, 'kucakla': 1, 'öp': 1, 'çıkar': 1, 'giy': 1, 'tak': 1, 'göster': 1 };
  function volitional(v) { return (v.mv && v.mv !== '-') || IMP_OK_EXTRA[v.id]; }
  function fImp(g) {
    const r = g.f();
    const subj = r < 0.68 ? PRONS[1] : PRONS[4];
    const P = subjPool(subj);
    const neg = g.p(0.18);
    const cand = P.all.filter(function (v) { return neg ? (volitional(v) || IMP_NEG_OK[v.id]) : volitional(v); });
    const v = cand[g.i(cand.length)];
    const c = mkClause(g, { subj: subj, verb: v, tense: 'imp', neg: neg, showSubj: false, time: g.p(0.15) ? true : false, manner: g.p(0.2) });
    c.time = c.time ? g.pick(['şimdi', 'hemen', 'bugün', 'yarın', 'bu akşam']) : '';
    let s = renderClause(g, c, {});
    const pre = g.w(['', 70, 'lütfen ', 12, 'hadi ', 7, 'haydi ', 3, 'şimdi ', 4, 'hemen ', 4]);
    if (subj.pi === 1 && g.p(0.10)) s = eName(g.pick(NAMES)).name + ', ' + s;
    s = pre + s;
    return endMark(g, s, g.p(0.7) ? '!' : '.');
  }
  // oneri (-AlIm)
  function fSuggest(g) {
    const P = VP_HUM.all;
    const v = P[g.i(P.length)];
    if (!volitional(v)) return fSuggest(g);
    const c = mkClause(g, { subj: PRONS[3], verb: v, tense: 'imp', neg: g.p(0.07), showSubj: false, time: false, manner: false });
    const s = renderClause(g, c, { q: g.p(0.35) });
    const isQ = /\bm[ıiuü]$/.test(s);
    const pre = isQ ? g.w(['', 50, 'birlikte ', 20, 'bugün ', 10, 'şimdi ', 10, 'yarın ', 10]) : g.w(['', 20, 'hadi ', 40, 'haydi ', 15, 'birlikte ', 15, 'gel, ', 10]);
    return endMark(g, pre + s, isQ ? '?' : '!');
  }

  // 11. "ve" ile bagli iki/uc eylem (ayni ozne)
  function routineSample(g, kind) { // [spec...] sirali
    const tab = ROUTINE[kind], out = [];
    for (let i = 0; i < tab.length; i++) {
      if (g.f() < tab[i][0]) out.push(g.pick(VPL[tab[i][1]]));
    }
    return out;
  }
  function uniq(a) { const r = []; for (let i = 0; i < a.length; i++) if (r.indexOf(a[i]) < 0) r.push(a[i]); return r; }
  function fAnd(g) {
    const subj = subjFor(g);
    const t = g.w(['past', 56, 'prog', 18, 'aor', 10, 'fut', 16]);
    if (g.p(0.55)) {
      const kind = g.p(0.5) ? 'kidDay' : 'adultDay';
      const steps = uniq(routineSample(g, kind));
      const st = g.i(Math.max(1, steps.length - 2));
      const use = steps.slice(st, st + (g.p(0.35) ? 3 : 2));
      if (use.length >= 2) {
        const tm = g.p(0.4) ? timeAdv(g, t) : '';
        const parts = [];
        for (let i = 0; i < use.length; i++) parts.push(vpFin(g, use[i], subj, { t: t, noSubj: i > 0 || (subj.k === 'pron' && g.p(0.5)), time: i === 0 ? tm : '' }));
        return endMark(g, joinAnd(parts), '.');
      }
    }
    const n = g.p(0.3) ? 3 : 2, parts = [];
    for (let i = 0; i < n; i++) {
      const c = mkClause(g, { subj: subj, tense: t, neg: false, showSubj: i === 0 ? (subj.k !== 'pron' || g.p(0.5)) : false, time: i === 0 && g.p(0.35), manner: g.p(0.15) });
      parts.push(renderClause(g, c, {}));
    }
    return endMark(g, joinAnd(parts), '.');
  }
  function joinAnd(parts) {
    if (parts.length === 1) return parts[0];
    let s = parts[0];
    for (let i = 1; i < parts.length; i++) s += (i === parts.length - 1 ? ' ve ' : ', ') + parts[i];
    return s;
  }

  // 12. "ama / fakat"
  const OUTDOOR = ['D:park git', 'X:dışarı çık', 'N:top oyna', 'X:yürüyüş yap', 'X:piknik yap', 'D:bahçe çık', 'D:deniz git', 'N:bisiklet sür', 'D:okul git', 'D:sahil git'];
  const HARD = ['N:ödev yap', 'N:ders çalış', 'D:okul git', 'X:erken kalk', 'A:bulaşık yıka', 'A:oda temizle', 'A:iş bitir', 'X:işe git'];
  const FRUITS_LIKE = ['elma', 'armut', 'portakal', 'muz', 'üzüm', 'çilek', 'kiraz', 'karpuz', 'kavun', 'şeftali', 'mandalina', 'limon'];
  const DRINKS_LIKE = ['çay', 'kahve', 'süt', 'ayran', 'limonata', 'şerbet'];
  const SEASONS_L = ['ilkbahar', 'yaz', 'sonbahar', 'kış'];
  const PETS_L = ['kedi', 'köpek', 'tavşan', 'kuş', 'balık', 'hamster'];
  function copPast(word, p) { return npred(word, p, 'past', false, false); }
  function copPres(word, p) { return npred(word, p, 'pres', false, false); }
  function fBut(g) {
    const conj = g.p(0.78) ? 'ama' : 'fakat';
    const r = g.f();
    const past = g.p(0.65);
    if (r < 0.28) {
      // hava + acik hava eylemi
      const subj = g.p(0.45) ? PRONS[3] : g.p(0.4) ? PRONS[0] : eName(g.pick(NAMES));
      const adj = g.pick(['soğuk', 'yağmurlu', 'rüzgarlı', 'karlı', 'sisli', 'bulutlu']);
      const c1 = 'hava ' + (past ? copPast(adj, 2) : copPres(adj, 2));
      const c2 = vpFin(g, g.pick(OUTDOOR), subj, { t: past ? 'past' : 'prog', noSubj: subj.k === 'pron' && g.p(0.6) });
      return endMark(g, c1 + ', ' + conj + ' ' + c2, '.');
    }
    if (r < 0.56) {
      // durum + zor eylem
      const subj = g.p(0.5) ? PRONS[g.pick([0, 0, 1, 3])] : eName(g.pick(NAMES));
      const adj = g.pick(['yorgun', 'hasta', 'uykulu', 'üzgün', 'aç']);
      const showS = subj.k !== 'pron' || g.p(0.4);
      const c1 = jn(showS ? np(subj, 0) : '', g.p(0.6) ? g.pick(DEGREE) : '', past ? copPast(adj, subj.p) : copPres(adj, subj.p));
      const c2 = vpFin(g, g.pick(HARD), subj, { t: past ? 'past' : 'prog', noSubj: true });
      return endMark(g, c1 + ', ' + conj + ' ' + c2, '.');
    }
    if (r < 0.80) {
      // tercih: X'i severim ama Y'yi sevmem
      const set = g.pick([FRUITS_LIKE, DRINKS_LIKE, SEASONS_L, PETS_L]);
      const a = g.pick(set); let b; do { b = g.pick(set); } while (b === a);
      const subj = g.p(0.5) ? PRONS[g.pick([0, 0, 1, 3, 2])] : eName(g.pick(NAMES));
      const sev = xv('sev'), pl = set === PETS_L;
      const showS = subj.k !== 'pron' || g.p(0.25);
      const yes = jn(nf(noun(a), pl, 0, 1), vf(sev, 'aor', subj.p, false, false, false));
      const no = jn(nf(noun(b), pl, 0, 1), vf(sev, 'aor', subj.p, true, false, false));
      const s = g.p(0.75) ? jn(showS ? np(subj, 0) : '', yes) + ', ' + conj + ' ' + no : jn(showS ? np(subj, 0) : '', no) + ', ' + conj + ' ' + yes;
      return endMark(g, s, '.');
    }
    // iki zit hayvan/nesne bilgisi
    const pairs = [['tavşan', 'hızlı koşar', 'kaplumbağa', 'yavaş yürür'], ['kuş', 'uçar', 'balık', 'yüzer'], ['güneş', 'gündüz parlar', 'ay', 'geceleri parlar'], ['kedi', 'süt içer', 'köpek', 'kemik kemirir'], ['yaz', 'hava sıcak olur', 'kış', 'hava soğuk olur']];
    const pr = g.pick(pairs);
    const a = noun(pr[0]), b = noun(pr[2]);
    return endMark(g, jn(nf(a, false, 0, 0), pr[1]) + ', ' + conj + ' ' + jn(nf(b, false, 0, 0), pr[3]), '.');
  }

  // =====================================================================================
  // 4d. CUMLE AILELERI (b): nedensellik, zarf-fiiller, ilgecler
  // =====================================================================================
  const S3 = eName('Ali'); // 3. tekil "dunya" ozneleri icin (yagmur yagiyor): yalniz kisi eki icin, metne yazilmaz
  function ppos(e) { return e.k === 'pron' && e.pi === 5 ? 6 : posIdx(e); } // -DIk + iyelik icin (onlar -> oldukları)
  function showS(g, subj, p) { return subj.k !== 'pron' || g.p(p === undefined ? 0.45 : p); }
  function subjTxt(g, subj, p) { return showS(g, subj, p) ? np(subj, 0) : ''; }
  function tenseFin(g, ws) { return g.w(ws || ['past', 40, 'prog', 24, 'fut', 14, 'aor', 16, 'evid', 3]); }

  // ---- 13. nedensellik: "..., cunku ..." ve "... oldugu icin ..." ----
  // sonuc VP, olumsuz mu, nedenler. Neden kodlari:
  //   s:sifat  (ozne durumu)   x:isim:sifat  (hava soguk)   v:VP (ozne baska eylem)   w:VP (dunya olayi, 3. tekil)
  const CAUSES = [
    ['D:okul git', 1, 's:hasta', 's:çok yorgun', 'x:okul:tatil'],
    ['D:park git', 1, 'x:hava:yağmurlu', 'x:hava:çok soğuk', 's:hasta', 's:çok yorgun'],
    ['X:dışarı çık', 1, 'x:hava:yağmurlu', 'x:hava:çok soğuk', 's:hasta', 's:yorgun'],
    ['D:deniz git', 1, 'x:hava:soğuk', 'x:hava:yağmurlu', 's:hasta'],
    ['D:deniz git', 0, 'x:hava:çok sıcak', 'x:hava:güzel'],
    ['D:park git', 0, 'x:hava:güzel', 'x:hava:sıcak'],
    ['P:şemsiye al', 0, 'w:N:yağmur yağ'],
    ['P:{mont,palto,kazak} giy', 0, 'x:hava:çok soğuk', 'x:hava:soğuk'],
    ['P:{şapka,gözlük} tak', 0, 'x:hava:çok sıcak', 'w:N:güneş parla'],
    ['N:su iç', 0, 'v:X:çok susa'],
    ['N:yemek ye', 0, 's:aç', 'v:X:çok acık'],
    ['X:erken yat', 0, 's:yorgun', 's:uykulu', 'v:X:çok yorul'],
    ['X:erken kalk', 0, 'w:N:okul erken başla', 'w:N:ders erken başla'],
    ['D:market git', 0, 'w:N:ekmek bit', 'w:N:süt bit', 'x:dolap:boş'],
    ['N:çay demle', 0, 'x:hava:soğuk', 'v:X:çok üşü'],
    ['X:ağla', 0, 's:üzgün', 's:aç', 'v:X:çok üzül'],
    ['X:gül', 0, 's:mutlu', 'v:A:şaka dinle'],
    ['D:doktor git', 0, 's:hasta'],
    ['X:koş', 0, 'v:X:geç kal'],
    ['N:kitap oku', 0, 'v:X:çok sıkıl'],
    ['N:ödev yap', 0, 'w:N:öğretmen ödev ver'],
    ['N:top oyna', 0, 'x:hava:güzel', 'x:bahçe:geniş'],
    ['X:evde kal', 0, 'x:hava:yağmurlu', 'x:hava:çok soğuk', 's:hasta', 's:yorgun'],
    ['N:film izle', 0, 'x:hava:yağmurlu', 'x:akşam:sakin'],
    ['X:erken uyan', 0, 'w:N:telefon çal', 'w:N:zil çal'],
    ['P:ayakkabı çıkar', 0, 'v:X:eve gir'],
    ['X:geç kalk', 0, 'x:bugün:tatil'],
    ['X:sessiz ol', 0, 'w:N:bebek uyu'],
    ['X:hızlı yürü', 0, 'v:X:geç kal'],
    ['N:çorba iç', 0, 'x:hava:soğuk', 'v:X:çok üşü'],
  ];
  function caus(g, code, subj, mode) { // mode: past | pres | icin
    const k = code.charAt(0), rest = code.slice(2);
    if (k === 's') {
      if (mode === 'icin') return rest + ' ' + vpart(xv('ol'), 'dik', ppos(subj), 0, {}) + ' için';
      return mode === 'past' ? copPast(rest, subj.p) : copPres(rest, subj.p);
    }
    if (k === 'x') {
      const i = rest.indexOf(':'), nn = rest.slice(0, i), ad = rest.slice(i + 1);
      if (mode === 'icin') return nn + ' ' + ad + ' ' + vpart(xv('ol'), 'dik', 3, 0, {}) + ' için';
      return nn + ' ' + (mode === 'past' ? copPast(ad, 2) : copPres(ad, 2));
    }
    if (k === 'v') {
      if (mode === 'icin') return vpPart(g, rest, subj, 'dik', ppos(subj), 0) + ' için';
      return vpFin(g, rest, subj, { t: mode === 'past' ? 'past' : 'prog', noSubj: true });
    }
    // w: dunya olayi
    if (mode === 'icin') return vpPart(g, rest, S3, 'dik', 3, 0) + ' için';
    return vpFin(g, rest, S3, { t: mode === 'past' ? 'past' : 'prog', noSubj: true });
  }
  const WORLD = [
    ['çiçekler soldu', 'kimse onları sulamadı'], ['yapraklar döküldü', 'sonbahar geldi'], ['kar eridi', 'hava ısındı'],
    ['çimenler yeşerdi', 'çok yağmur yağdı'], ['hava karardı', 'akşam oldu'], ['yollar ıslandı', 'yağmur yağdı'],
    ['ekmek bitti', 'herkes çok acıkmıştı'], ['kedi ağaca tırmandı', 'köpek onu kovaladı'], ['kuşlar uçtu', 'kedi geldi'],
    ['tavşan kaçtı', 'köpek havladı'], ['bebek uyandı', 'ses çok yüksekti'], ['ağaçlar yeşerdi', 'ilkbahar geldi'],
    ['gökyüzü karardı', 'bulutlar geldi'], ['yapraklar sarardı', 'sonbahar geldi'], ['göl dondu', 'hava çok soğuktu'],
    ['çiçekler açtı', 'ilkbahar geldi'], ['balon patladı', 'çok şişmişti'], ['çay soğudu', 'kimse içmedi'],
  ];
  const ADVICE = [
    ['P:mont giy', 'hava çok soğuk'], ['P:şemsiye al', 'yağmur yağıyor'], ['N:su iç', 'hava çok sıcak'], ['X:erken yat', 'yarın okul var'],
    ['P:el+ yıka', 'yemek yiyeceksin'], ['X:dikkatli ol', 'yol çok kaygan'], ['X:acele et', 'geç kalıyoruz'], ['N:çorba iç', 'hava soğuk'],
    ['X:yavaş yürü', 'yol ıslak'], ['P:ödev yap', 'yarın sınav var'], ['X:erken kalk', 'yarın erken yola çıkacağız'], ['A:kapı kapat', 'hava soğuk'],
    ['A:pencere aç', 'oda çok sıcak'], ['X:sessiz ol', 'bebek uyuyor'], ['P:diş+ fırçala', 'yatma vakti geldi'], ['X:biraz dinlen', 'çok yorgunsun'],
    ['P:şapka tak', 'güneş çok parlak'], ['X:bir bardak N:süt iç', 'çok zayıfsın'], ['X:yanıma gel', 'sana bir şey göstereceğim'],
  ];
  function fCause(g) {
    const r = g.f();
    if (r < 0.12) { // dunya olayi
      const w = g.pick(WORLD);
      return endMark(g, (g.p(0.3) ? g.pick(['dün', 'geçen hafta', 'bu sabah']) + ' ' : '') + w[0] + ', ' + 'çünkü ' + w[1], '.');
    }
    if (r < 0.24) { // ogut
      const ad = g.pick(ADVICE), subj = g.p(0.75) ? PRONS[1] : PRONS[4];
      const cause = ad[1];
      const s = vpFin(g, ad[0], subj, { t: 'imp', noSubj: true });
      const c = g.p(0.12) ? eName(g.pick(NAMES)).name + ', ' + s : s;
      return endMark(g, c + ', çünkü ' + cause, g.p(0.5) ? '.' : '!');
    }
    const subj = subjFor(g);
    const past = g.p(0.6);
    const mode = g.w(['cunku', 52, 'icin', 48]);
    const sc = g.pick(CAUSES);
    const neg = !!sc[1];
    const cz = g.pick(sc.slice(2));
    const t = past ? 'past' : g.w(['prog', 60, 'fut', 20, 'aor', 20]);
    const time = g.p(0.2) ? timeAdv(g, t) : '';
    if (mode === 'cunku') {
      const main = vpFin(g, sc[0], subj, { t: t, neg: neg, noSubj: !showS(g, subj), time: time });
      return endMark(g, main + ', ' + 'çünkü' + ' ' + caus(g, cz, subj, past ? 'past' : 'pres'), '.');
    }
    const cs = caus(g, cz, subj, 'icin');
    const main = vpFin(g, sc[0], subj, { t: t, neg: neg, noSubj: true });
    // 'x:' nedenlerinde ozne once yazilir (Ali hava soguk oldugu icin ...)
    const sj = subjTxt(g, subj, 0.3);
    return endMark(g, jn(time, sj, cs, main), '.');
  }

  // ---- 14. -ken, -Ip, -DIktAn sonra, -IncA, -mAdAn, -mAk icin ----
  const MADAN = [
    ['N:kahvaltı yap', 'D:okul git'], ['P:diş+ fırçala', 'D:yatak gir'], ['P:el+ yıka', 'N:yemek ye'], ['N:ödev yap', 'D:yatak gir'],
    ['P:ayakkabı çıkar', 'D:ev gir'], ['P:ceket giy', 'D:okul git'], ['N:bilet al', 'X:trene bin'], ['P:ceket giy', 'X:dışarı çık'],
    ['N:çay iç', 'D:okul git'], ['P:yüz yıka', 'N:kahvaltı yap'],
  ];
  function tenseFor(g, kind) {
    if (kind === 'inca') return g.w(['past', 55, 'aor', 25, 'fut', 20]);
    return tenseFin(g);
  }
  function fKen(g) {
    const subj = subjFor(g), pr = g.pick(KENPAIRS);
    const t = pr[1] === 'X:düş' ? 'past' : tenseFin(g, ['past', 55, 'prog', 18, 'fut', 10, 'aor', 15]);
    const bg = vpNon(g, pr[0], subj, 'ken', false), fg = vpFin(g, pr[1], subj, { t: t, noSubj: true });
    return endMark(g, jn(subjTxt(g, subj, 0.3), bg, fg), '.');
  }
  function fIp(g) {
    const subj = subjFor(g);
    const t = tenseFin(g);
    const r = g.f();
    if (r < 0.6) {
      const pr = g.pick(SEQ2);
      const a = vpNon(g, pr[0], subj, 'ip', false), b = vpFin(g, pr[1], subj, { t: t, noSubj: true });
      return endMark(g, jn(g.p(0.2) ? timeAdv(g, t) : '', subjTxt(g, subj, 0.3), a, b), '.');
    }
    // uclu: a-Ip, b-Ip, c  (ayni ruzgar: rutin adimlari)
    const kind = g.p(0.5) ? 'kidDay' : 'adultDay';
    const steps = uniq(routineSample(g, kind));
    if (steps.length < 3) return fIp(g);
    const st = g.i(steps.length - 2), use = steps.slice(st, st + 3);
    const a = vpNon(g, use[0], subj, 'ip', false), b = vpNon(g, use[1], subj, 'ip', false), c = vpFin(g, use[2], subj, { t: t, noSubj: true });
    return endMark(g, jn(g.p(0.25) ? timeAdv(g, t) : '', subjTxt(g, subj, 0.3), a + ',', b, c), '.').replace(',,', ',');
  }
  function fAfter(g) {
    const subj = subjFor(g);
    const r = g.f();
    if (r < 0.34) { // -DIktAn sonra
      const pr = g.pick(SEQ2), t = tenseFin(g);
      const a = vpNon(g, pr[0], subj, 'diktan', false), b = vpFin(g, pr[1], subj, { t: t, noSubj: true });
      return endMark(g, jn(subjTxt(g, subj, 0.3), a, 'sonra', b), '.');
    }
    if (r < 0.62) { // -IncA
      const pr = g.pick(SEQ2), t = tenseFor(g, 'inca');
      const a = vpNon(g, pr[0], subj, 'inca', false), b = vpFin(g, pr[1], subj, { t: t, noSubj: true });
      return endMark(g, jn(subjTxt(g, subj, 0.3), a, b), '.');
    }
    if (r < 0.82) { // -mAdAn
      const pr = g.pick(MADAN), t = tenseFin(g, ['past', 60, 'prog', 12, 'aor', 14, 'fut', 14]);
      const a = vpNon(g, pr[0], subj, 'madan', false), b = vpFin(g, pr[1], subj, { t: t, noSubj: true });
      return endMark(g, jn(subjTxt(g, subj, 0.3), a, b), '.');
    }
    // -mAdAn once (olumsuz): "Ali yemek yemeden once ellerini yikadi"  ->  -mAdAn once
    const pr = g.pick(SEQ2), t = tenseFin(g, ['past', 60, 'aor', 15, 'fut', 15, 'prog', 10]);
    const a = vpNon(g, pr[1], subj, 'madan', false), b = vpFin(g, pr[0], subj, { t: t, noSubj: true });
    return endMark(g, jn(subjTxt(g, subj, 0.3), a, 'önce', b), '.');
  }
  function fPurpose(g) {
    const subj = subjFor(g), pr = g.pick(PURPOSE);
    const t = tenseFin(g, ['past', 55, 'prog', 15, 'fut', 15, 'aor', 15]);
    const a = vpNon(g, pr[0], subj, 'mak', false) + ' için', b = vpFin(g, pr[1], subj, { t: t, noSubj: true });
    return endMark(g, jn(g.p(0.2) ? timeAdv(g, t) : '', subjTxt(g, subj, 0.3), a, b), '.');
  }

  // ---- 17. ilgecler: icin, ile, kadar, gore, beri, sonra/once ----
  function forWhom(g, subj) { // "annem icin", "senin icin"
    let e = otherPerson(g, subj, {});
    for (let k = 0; k < 6 && subj.k === 'noun' && e.k === 'noun' && e.n === subj.n; k++) e = otherPerson(g, subj, {});
    if (e.k === 'pron') return (e.pi === 5 ? 'onlar' : PRON[e.pi][5]) + ' için';
    return np(e, 0) + ' için';
  }
  const BEN = [
    'X:bir N:{resim,kart} çiz', 'X:bir N:{mektup,kart,şiir,not} yaz', 'X:bir N:şarkı söyle', 'X:bir N:{pasta,kek} yap', 'N:{çay,limonata} hazırla', 'A:{yemek,çorba,salata} hazırla',
    'X:bir N:{kitap,oyuncak,çiçek,şapka,atkı,eldiven,kalem,defter,çanta,hediye} al', 'X:bir N:{kitap,şapka,hediye} seç', 'N:{çay,kahve} demle', 'A:masa hazırla', 'N:{kek,kurabiye,börek} pişir',
    'N:{dondurma,ekmek,süt,elma} al', 'X:bir N:hikaye anlat', 'A:oda temizle', 'N:{çiçek} topla', 'X:bir N:fotoğraf çek',
  ];
  function fFor(g) {
    const subj = subjFor(g), t = tenseFin(g, ['past', 50, 'fut', 20, 'prog', 15, 'aor', 15]);
    const spec = g.pick(BEN), who = forWhom(g, subj);
    return endMark(g, vpFin(g, spec, subj, { t: t, noSubj: !showS(g, subj), mid: who, time: g.p(0.2) ? timeAdv(g, t) : '' }), '.');
  }
  const INSTR = [
    'I:kalem N:mektup yaz', 'I:fırça A:duvar boya', 'I:bıçak A:ekmek kes', 'I:makas A:kağıt kes', 'I:kaşık N:çorba iç', 'I:çatal N:salata ye', 'I:tarak P:saç tara', 'I:sabun P:el+ yıka',
    'I:anahtar A:kapı aç', 'I:süpürge A:oda süpür', 'I:otobüs D:okul git', 'I:tren D:şehir git', 'I:bisiklet D:okul git', "I:uçak X:{İstanbul'a,Ankara'ya,İzmir'e} git", 'I:bisiklet D:park git',
    'I:boya N:resim yap', 'I:kalem N:resim çiz', 'I:tebeşir D:tahta yaz', 'I:metro D:çarşı git', 'I:vapur D:kıyı git', 'I:teleskop A:ay gör', 'I:dürbün A:kuş izle',
  ];
  const WITHP = ['X:parka git', 'X:sinemaya git', 'X:oyun oyna', 'X:bahçede oyna', 'X:ders çalış', 'X:yürüyüşe çık', 'X:alışveriş yap', 'X:pikniğe git', 'X:denize git', 'X:film izle', 'X:kahvaltı yap', 'X:sahilde yürü', 'X:müzik dinle'];
  function fWith(g) {
    const r = g.f();
    if (r < 0.42) { // alet / arac
      const subj = subjFor(g), t = tenseFin(g, ['past', 50, 'prog', 20, 'aor', 15, 'fut', 15]);
      return endMark(g, vpFin(g, g.pick(INSTR), subj, { t: t, noSubj: !showS(g, subj), time: g.p(0.15) ? timeAdv(g, t) : '' }), '.');
    }
    if (r < 0.7) { // iki ozne + ile
      const a = eName(g.pick(NAMES)); let b; do { b = eName(g.pick(NAMES)); } while (b.name === a.name);
      const t = tenseFin(g, ['past', 50, 'prog', 20, 'fut', 15, 'aor', 15]);
      const spec = g.pick(WITHP), v = parseVP(spec).verb;
      const sj = g.p(0.5) ? np(a, 0) + ' ile ' + np(b, 0) : nmf(a.name, 6) + ' ' + np(b, 0);
      const args = vpArgs(g, spec, a);
      return endMark(g, jn(g.p(0.2) ? timeAdv(g, t) : '', sj, args, vf(v, t, 5, false, false, false)), '.');
    }
    // "X ile birlikte" (ortaklik)
    const subj = subjFor(g), t = tenseFin(g, ['past', 50, 'prog', 20, 'fut', 15, 'aor', 15]);
    const spec = g.pick(WITHP);
    const pn = personFor(g, subj, 'kid');
    return endMark(g, vpFin(g, spec, subj, { t: t, noSubj: !showS(g, subj), mid: np(pn, 6) + ' birlikte', time: g.p(0.2) ? timeAdv(g, t) : '' }), '.');
  }
  const TILLN = ['akşam', 'sabah', 'öğle', 'gece', 'hafta sonu', 'bayram', 'cuma', 'cumartesi', 'pazar'];
  const TILLV = ['X:çalış', 'X:bekle', 'X:oyna', 'X:uyu', 'X:evde kal', 'N:kitap oku', 'N:film izle', 'X:ders çalış', 'X:yürü', 'X:dinlen', 'N:resim yap', 'X:parkta oyna', 'N:müzik dinle'];
  function fTill(g) {
    const subj = subjFor(g), t = tenseFin(g, ['past', 55, 'prog', 15, 'fut', 15, 'aor', 15]);
    let lim;
    const r = g.f();
    if (r < 0.5) { lim = nf(noun(g.pick(TILLN)), false, 0, 2) + ' kadar'; }
    else if (r < 0.6) lim = 'yarına kadar';
    else if (r < 0.66) lim = 'sabaha kadar';
    else { const h = g.pick(HOURS); lim = 'saat ' + (g.p(0.3) ? h + "'" + numSuf(h, '(y)A').slice(numWord(h).length) : numSuf(h, '(y)A')) + ' kadar'; }
    if (g.p(0.15) && r < 0.66) {
      const sp = 'N:yağmur yağ';
      return endMark(g, jn(lim, vpFin(g, sp, S3, { t: t === 'aor' ? 'past' : t, noSubj: true })), '.');
    }
    return endMark(g, vpFin(g, g.pick(TILLV), subj, { t: t, noSubj: !showS(g, subj), time: lim }), '.');
  }
  function dative(e) { return e.k === 'pron' ? PRON[e.pi][2] : np(e, 2); }
  // gore: NP + ozneler sifat (yalniz dogal esleşmeler)
  const OPIN_POOLS = [
    [['edible', 'drink'], ['lezzetli'], 3],
    [['animal'], ['sevimli', 'komik', 'güzel'], 2],
    [['media'], ['ilginç', 'eğlenceli', 'komik', 'güzel'], 3],
    [['art', 'read'], ['güzel', 'ilginç'], 3],
    [['game'], ['eğlenceli', 'güzel'], 2],
    [['nat', 'city'], ['güzel', 'ilginç'], 1],
    [['thinkable', 'ders', 'ödev', 'sınav', 'soru', 'bilmece', 'proje'], ['kolay', 'zor', 'önemli', 'ilginç'], 2],
    [['season'], ['güzel'], 1],
  ];
  function fAccord(g) {
    const subj = subjFor(g);
    const who = dative(subj) + ' göre';
    const past = g.p(0.2);
    const pp = g.w([0, 3, 1, 2, 2, 3, 3, 3, 4, 2, 5, 1, 6, 1]);
    const pl = OPIN_POOLS[pp];
    const pool = poolOf(pl[0]).filter(function (n) { return !n.head && !n.u; });
    const n = g.pick(pool), ad = g.pick(pl[1]);
    const det = n.ts.season ? '' : g.w(['', 60, 'bu', 20, 'şu', 5, 'o', 8]);
    const deg = g.p(0.5) ? g.pick(['çok', 'çok', 'oldukça', 'gerçekten']) : '';
    const pred = past ? copPast(ad, 2) : copPres(ad, 2);
    return endMark(g, jn(who, det, nf(n, false, 0, 0), deg, pred), '.');
  }
  const SINCE_T = ['sabahtan', 'öğleden', 'dünden', 'pazartesiden', 'geçen haftadan', 'akşamdan', 'geceden', 'geçen aydan'];
  const SINCE_D = ['iki gündür', 'üç gündür', 'bir haftadır', 'beş gündür', 'iki haftadır', 'uzun zamandır'];
  const SINCE_H = ['iki saattir', 'üç saattir', 'bir saattir', 'yarım saattir'];
  const SINCE_A = ['X:çalış', 'X:bekle', 'X:uyu', 'N:yağmur yağ', 'N:kitap oku', 'X:oyna', 'N:ders çalış', 'N:film izle', 'X:yürü', 'N:ödev yap', 'X:ders çalış'];
  const SINCE_L = ['X:çalış', 'N:yağmur yağ', 'X:ders çalış', 'X:evde kal'];
  const SINCE_S = ['x:hava:soğuk', 'x:hava:sıcak', 's:hasta', 's:yorgun', 's:mutlu', 's:aç', 's:meşgul', 'x:hava:güzel', 'x:hava:yağmurlu', 'x:hava:bulutlu'];
  function fSince(g) {
    const subj = subjFor(g);
    const r0 = g.f();
    const time = r0 < 0.5 ? g.pick(SINCE_T) + ' beri' : r0 < 0.75 ? g.pick(SINCE_H) : g.pick(SINCE_D);
    const long = r0 >= 0.75;
    if (g.p(0.35)) { // durum
      const cz = g.pick(SINCE_S);
      const world = cz.charAt(0) === 'x';
      const txt = caus(g, cz, subj, 'pres');
      return endMark(g, jn(time, world ? '' : subjTxt(g, subj, 0.5), txt), '.');
    }
    const spec = g.pick(long ? SINCE_L : SINCE_A);
    if (spec.indexOf('yağmur') >= 0) return endMark(g, jn(time, vpFin(g, spec, S3, { t: 'prog', noSubj: true })), '.');
    return endMark(g, vpFin(g, spec, subj, { t: 'prog', noSubj: !showS(g, subj), time: time }), '.');
  }
  const EVT = {
    'kahvaltı': { a: ['D:okul git', 'P:diş+ fırçala', 'X:dışarı çık', 'N:çay iç'], b: ['P:yüz yıka', 'P:el+ yıka', 'P:çanta hazırla'] },
    'yemek': { a: ['N:çay iç', 'X:biraz dinlen', 'P:diş+ fırçala', 'X:yürüyüş yap', 'N:tatlı ye'], b: ['P:el+ yıka', 'A:masa hazırla'] },
    'akşam yemeği': { a: ['N:çay iç', 'N:televizyon izle', 'X:biraz dinlen', 'A:bulaşık yıka', 'N:kitap oku'], b: ['P:el+ yıka', 'A:masa hazırla'] },
    'öğle yemeği': { a: ['X:biraz dinlen', 'N:top oyna', 'L:bahçe oyna', 'N:ders çalış'], b: ['P:el+ yıka'] },
    'ders': { a: ['N:ödev yap', 'L:bahçe oyna', 'N:top oyna', 'D:ev git', 'X:dinlen'], b: ['P:defter aç', 'N:ödev yap', 'P:çanta hazırla'] },
    'okul': { a: ['D:park git', 'D:ev git', 'N:top oyna', 'N:ödev yap', 'D:kütüphane git', 'D:market git'], b: ['N:kahvaltı yap', 'P:çanta hazırla', 'P:yüz yıka'] },
    'film': { a: ['D:ev dön', 'N:çay iç', 'X:uyu', 'X:yürüyüş yap'], b: ['N:bilet al', 'N:mısır al'] },
    'maç': { a: ['D:ev dön', 'N:su iç', 'N:dondurma ye', 'X:dinlen'], b: ['P:ayakkabı giy', 'N:su iç'] },
    'sınav': { a: ['X:dinlen', 'N:film izle', 'D:park git', 'X:uyu'], b: ['N:ders çalış', 'X:erken yat'] },
    'tatil': { a: ['D:okul git', 'X:ders çalış', 'N:ödev yap'], b: ['P:çanta hazırla', 'N:ödev yap'] },
    'konser': { a: ['D:ev dön', 'N:çay iç', 'X:dinlen'], b: ['N:bilet al', 'X:erken yola çık'] },
  };
  const EVTK = Object.keys(EVT);
  function fEvent(g) {
    const subj = subjFor(g), ek = g.pick(EVTK), after = g.p(0.62), e = EVT[ek];
    const n = noun(ek), ab = nf(n, false, 0, 4);
    const t = tenseFin(g, ['past', 55, 'prog', 8, 'fut', 15, 'aor', 22]);
    const spec = g.pick(after ? e.a : e.b);
    return endMark(g, vpFin(g, spec, subj, { t: t, noSubj: !showS(g, subj), time: ab + (after ? ' sonra' : ' önce') }), '.');
  }

  // =====================================================================================
  // 4e. CUMLE AILELERI (c): karsilastirma, var/yok, konum, sayi, duygu, saat, tamlama, sifat-fiil, ek-fiil, istek
  // =====================================================================================
  function mkComp(pre, head) { // "çay" + bardak -> "çay bardağı" (belirtisiz tamlama; onceden kayitli degilse uretilir)
    const h = typeof head === 'string' ? noun(head) : head;
    const key = pre + ' ' + nform(h, false, 3, 0);
    let n = NMAP.get(key);
    if (n) return n;
    n = mkNoun(key, {}); n.fl = { c: true }; n.head = h; n.pre = pre + ' '; n.ts = h.ts; n.cls = h.cls; n.tags = h.tags; n.u = h.u;
    NMAP.set(key, n);
    return n;
  }
  function numTxt(g, n, dig) { return (dig !== undefined ? dig : (n > 10 && g.p(0.5))) ? String(n) : numWord(n); }
  function numAt(g, n, pat) { // sayi + ek: "yediye" / "7'ye"
    if (n > 10 && g.p(0.4)) return n + "'" + numSuf(n, pat).slice(numWord(n).length);
    return numSuf(n, pat);
  }

  // ---- 19/20. karsilastirma: daha / en / kadar ----
  // [sifat, karsit sifat, cift listesi (buyuk, kucuk)]  -- yalniz herkesce dogru bilgiler
  const CMP = [
    ['büyük', 'küçük', [['fil', 'at'], ['fil', 'kedi'], ['at', 'köpek'], ['köpek', 'kedi'], ['kedi', 'fare'], ['aslan', 'kedi'], ['inek', 'koyun'], ['balina', 'balık'], ['dağ', 'tepe'], ['deniz', 'göl'], ['güneş', 'ay'], ['dünya', 'ay'], ['karpuz', 'elma'], ['elma', 'çilek'], ['ağaç', 'çiçek'], ['ev', 'oda'], ['şehir', 'köy'], ['okul', 'sınıf'], ['at', 'tavşan'], ['zürafa', 'kedi'], ['kavun', 'elma'], ['ağaç', 'çalı'], ['kartal', 'serçe'], ['aslan', 'tavşan']]],
    ['hızlı', 'yavaş', [['tavşan', 'kaplumbağa'], ['uçak', 'araba'], ['araba', 'bisiklet'], ['tren', 'bisiklet'], ['at', 'kaplumbağa'], ['kaplan', 'fil'], ['kedi', 'kaplumbağa'], ['kuş', 'karınca'], ['uçak', 'tren'], ['tavşan', 'salyangoz'], ['araba', 'kaplumbağa']]],
    ['uzun', 'kısa', [['zürafa', 'at'], ['zürafa', 'kedi'], ['ağaç', 'çiçek'], ['dağ', 'tepe'], ['ağaç', 'çalı'], ['nehir', 'dere'], ['tren', 'araba'], ['gemi', 'tekne']]],
    ['ağır', 'hafif', [['fil', 'kedi'], ['fil', 'at'], ['taş', 'tüy'], ['kamyon', 'araba'], ['araba', 'bisiklet'], ['kaya', 'taş'], ['at', 'tavşan'], ['inek', 'koyun'], ['kitap', 'kalem']]],
    ['sıcak', 'soğuk', [['yaz', 'kış'], ['çorba', 'dondurma'], ['yaz', 'ilkbahar'], ['yaz', 'sonbahar'], ['gündüz', 'gece'], ['ateş', 'buz'], ['güneş', 'ay']]],
    ['yumuşak', 'sert', [['yastık', 'taş'], ['ekmek', 'taş'], ['battaniye', 'tahta'], ['halı', 'taş'], ['yatak', 'tahta']]],
    ['karanlık', 'aydınlık', [['gece', 'gündüz'], ['mağara', 'oda']]],
    ['geniş', 'dar', [['deniz', 'göl'], ['cadde', 'sokak'], ['sokak', 'patika']]],
    ['kalın', 'ince', [['mont', 'tişört'], ['battaniye', 'çarşaf'], ['kazak', 'tişört'], ['ağaç', 'dal'], ['kitap', 'gazete'], ['mont', 'gömlek']]],
    ['yüksek', 'alçak', [['dağ', 'tepe'], ['ağaç', 'çalı'], ['bulut', 'ağaç']]],
    ['tatlı', 'ekşi', [['bal', 'limon'], ['şeker', 'limon'], ['çikolata', 'ekmek'], ['karpuz', 'limon'], ['baklava', 'ekmek'], ['bal', 'ekmek'], ['kiraz', 'vişne']]],
    ['güçlü', 'zayıf', [['aslan', 'kedi'], ['fil', 'tavşan'], ['at', 'kedi'], ['kaplan', 'kedi'], ['fil', 'fare']]],
  ];
  function abl(n) { return nf(n, false, 0, 4); }
  function cmpPair(g) {
    const c = g.pick(CMP), rev = g.p(0.4), pr = g.pick(c[2]);
    return { adj: rev ? c[1] : c[0], a: noun(rev ? pr[1] : pr[0]), b: noun(rev ? pr[0] : pr[1]) };
  }
  const CMPV = [['hızlı', 'X:koş'], ['yavaş', 'X:yürü'], ['güzel', 'X:şarkı söyle'], ['çok', 'X:çalış'], ['erken', 'X:kalk'], ['geç', 'X:yat'], ['hızlı', 'X:yürü'], ['yüksek', 'X:zıpla'], ['iyi', 'X:yüz'], ['güzel', 'X:resim yap'], ['çok', 'X:uyu'], ['çok', 'X:oyna']];
  function fCompare(g) {
    const r = g.f();
    if (r < 0.34) { // A B'den daha ADJ
      const p = cmpPair(g), dir = g.p(0.35);
      const cop = dir ? npred(p.adj, 2, 'dir') : p.adj;
      const more = g.p(0.2) ? 'çok daha' : 'daha';
      return endMark(g, jn(nf(p.a, false, 0, 0), abl(p.b), more, cop), '.');
    }
    if (r < 0.50) { // B A kadar ADJ degil
      const p = cmpPair(g);
      return endMark(g, jn(nf(p.b, false, 0, 0), nf(p.a, false, 0, 0), 'kadar', p.adj, g.p(0.4) ? 'değildir' : 'değil'), '.');
    }
    if (r < 0.62) { // kisi karsilastirmasi (sifat)
      const a = subjFor(g);
      const b = otherPerson(g, a, {});
      const ad = g.pick(['uzun', 'hızlı', 'çalışkan', 'güçlü', 'akıllı', 'sessiz', 'neşeli', 'büyük', 'küçük', 'yaşlı', 'genç']);
      const bab = b.k === 'pron' ? PRON[b.pi][4] : np(b, 4);
      let pred = ad;
      if (a.k === 'pron') pred = copPres(ad, a.p);
      return endMark(g, jn(np(a, 0), bab, 'daha', pred), '.');
    }
    if (r < 0.78) { // kisi + fiil + daha ADV
      const a = subjFor(g);
      const b = otherPerson(g, a, {});
      const cv = g.pick(CMPV);
      const bab = b.k === 'pron' ? PRON[b.pi][4] : np(b, 4);
      const t = g.w(['prog', 55, 'aor', 30, 'past', 15]);
      const v = parseVP(cv[1]).verb, verb = vf(v, t, a.p, false, false, false);
      return endMark(g, jn(showS(g, a, 0.5) ? np(a, 0) : '', bab, 'daha', cv[0], verb), '.');
    }
    if (r < 0.92) { // daha cok sevmek
      const set = g.pick([FRUITS_LIKE, DRINKS_LIKE, SEASONS_L, PETS_L]);
      const a = g.pick(set); let b; do { b = g.pick(set); } while (b === a);
      const subj = g.p(0.6) ? PRONS[g.pick([0, 0, 1, 3, 2])] : eName(g.pick(NAMES));
      const sev = xv('sev'), pl = set === PETS_L;
      const t = g.w(['aor', 70, 'prog', 30]);
      const s = jn(showS(g, subj, 0.3) ? np(subj, 0) : '', nf(noun(a), pl, 0, 1), nf(noun(b), pl, 0, 4), 'daha çok', vf(sev, t, subj.p, false, false, false));
      return endMark(g, s, '.');
    }
    // daha + sifat + isim
    const subj = subjFor(g);
    const pairs = [['büyük', 'ev', 'iste'], ['küçük', 'çanta', 'al'], ['uzun', 'ip', 'iste'], ['hafif', 'çanta', 'al'], ['güzel', 'elbise', 'seç'], ['yumuşak', 'yastık', 'iste'], ['büyük', 'oda', 'iste'], ['sessiz', 'oda', 'iste'], ['hızlı', 'bisiklet', 'iste'], ['küçük', 'bardak', 'iste'], ['sıcak', 'çay', 'iste'], ['büyük', 'tabak', 'getir']];
    const pr = g.pick(pairs), t = g.w(['past', 30, 'prog', 40, 'fut', 15, 'aor', 15]);
    const n = noun(pr[1]);
    return endMark(g, jn(showS(g, subj, 0.4) ? np(subj, 0) : '', 'daha', pr[0], 'bir', nf(n, false, 0, pr[2] === 'iste' || pr[2] === 'al' || pr[2] === 'seç' || pr[2] === 'getir' ? 0 : 1), vf(xv(pr[2]), t, subj.p, false, false, false)), '.');
  }
  const FAV = [
    ['renk', 'kırmızı mavi sarı yeşil beyaz turuncu mor pembe'], ['yemek', 'pilav makarna köfte pizza börek mantı'], ['içecek', 'çay limonata ayran süt'],
    ['meyve', 'elma çilek portakal muz üzüm karpuz'], ['hayvan', 'kedi köpek tavşan kuş at'], ['mevsim', 'ilkbahar yaz sonbahar kış'], ['gün', 'cumartesi pazar cuma'],
    ['ders', 'resim müzik matematik'], ['oyun', 'saklambaç futbol satranç'], ['sebze', 'havuç patates domates'], ['tatlı', 'baklava dondurma pasta'], ['çiçek', 'gül lale papatya'],
  ];
  const FAV_ACC = { 'renk': 0, 'ders': 0 };
  const PARTOF = [
    ['bahçe', 'ağaç', ['büyük', 'yüksek', 'eski', 'güzel', 'küçük']], ['ev', 'oda', ['büyük', 'küçük', 'güzel', 'aydınlık', 'geniş']], ['sınıf', 'öğrenci', ['çalışkan', 'uzun', 'akıllı', 'sessiz', 'neşeli']],
    ['okul', 'sınıf', ['büyük', 'sessiz', 'güzel']], ['şehir', 'park', ['büyük', 'güzel']], ['köy', 'ev', ['eski', 'büyük', 'küçük']], ['sokak', 'ev', ['büyük', 'eski', 'güzel']], ['bahçe', 'çiçek', ['güzel', 'küçük']],
  ];
  const SUPERF = [
    'Şubat yılın en kısa ayıdır.', 'Kış en soğuk mevsimdir.', 'Yaz en sıcak mevsimdir.', 'Balina denizin en büyük hayvanıdır.', 'Zürafa en uzun boylu hayvandır.', 'Güneş bize en yakın yıldızdır.',
    'Pazartesi haftanın ilk günüdür.', 'Pazar haftanın son günüdür.', 'Ocak yılın ilk ayıdır.', 'Aralık yılın son ayıdır.', 'Kaplumbağa en yavaş hayvanlardan biridir.', 'Fil en büyük kara hayvanıdır.',
    'Gece günün en karanlık zamanıdır.', 'Öğle günün en sıcak zamanıdır.',
  ];
  function fSuper(g) {
    const r = g.f();
    if (r < 0.2) return g.pick(SUPERF);
    if (r < 0.62) { // en sevdigim X Y
      const f = g.pick(FAV), it = g.pick(f[1].split(' '));
      const who = g.w([0, 4, 1, 2, 2, 2, 3, 1]);
      const sub = who === 2 && g.p(0.7) ? eName(g.pick(NAMES)) : PRONS[who === 2 ? 2 : who === 1 ? 1 : who === 3 ? 3 : 0];
      const poss = sub.k === 'pron' ? posIdx(sub) : 3;
      const own = sub.k === 'pron' ? (g.p(0.6) ? PRON[sub.pi][5] : '') : np(sub, 5);
      const sevdigi = vpart(xv('sev'), 'dik', poss, 0, {});
      const part = jn(own, 'en', sevdigi, f[0]);
      const n = noun(it);
      const tail = g.p(0.3) ? npred(nf(n, false, 0, 0), 2, 'dir') : nf(n, false, 0, 0);
      return endMark(g, jn(part, tail), '.');
    }
    if (r < 0.82) { // bahcenin en buyuk agaci
      const p = g.pick(PARTOF), ad = g.pick(p[2]);
      const who = g.w([0, 4, 1, 2, 2, 2]);
      const whole = who === 2 ? nf(noun(p[0]), false, 0, 5) : nf(noun(p[0]), false, who === 0 ? 4 : 1, 5);
      const bu = g.pick(['Bu', 'Şu', 'Bu']);
      const nn = noun(p[1]);
      return endMark(g, bu + ', ' + jn(whole, 'en', ad, nf(nn, false, 3, 0)), '.');
    }
    // Ali sinifin en ... ogrencisi
    const p = PARTOF[2], ad = g.pick(p[2]);
    const nm = g.p(0.85) ? eName(g.pick(NAMES)) : PRONS[2];
    return endMark(g, jn(np(nm, 0), nf(noun('sınıf'), false, g.p(0.4) ? 4 : 0, 5), 'en', ad, nf(noun('öğrenci'), false, 3, 0)), '.');
  }

  // ---- 22. var / yok ----
  const VARCTX = [
    ['sepet', 0, 'elma portakal yumurta çiçek ekmek meyve armut muz limon'],
    ['çanta', 1, 'kalem defter kitap silgi cüzdan anahtar şemsiye çikolata elma'],
    ['masa', 1, 'kitap defter bardak tabak lamba fincan çiçek kalem'],
    ['dolap', 1, 'ceket pantolon gömlek elbise tabak bardak kazak'],
    ['buzdolabı', 1, 'süt peynir yumurta elma domates ayran yoğurt limon'],
    ['bahçe', 1, 'ağaç çiçek kedi kuş çimen'],
    ['sınıf', 1, 'öğrenci masa sandalye harita pencere'],
    ['oda', 1, 'yatak masa sandalye lamba pencere halı ayna dolap'],
    ['ev', 1, 'oda pencere kapı balkon'],
    ['park', 0, 'ağaç çiçek çocuk kedi köpek kuş'],
    ['göl', 0, 'ördek balık kuğu'],
    ['ağaç', 0, 'kuş yaprak'],
    ['cüzdan', 1, 'para bilet kart'],
    ['kavanoz', 0, 'reçel bal tuz'],
    ['tabak', 0, 'pilav salata makarna köfte'],
    ['bardak', 0, 'su süt çay ayran'],
    ['şişe', 0, 'su süt'],
    ['kutu', 0, 'kalem oyuncak top'],
    ['mutfak', 1, 'masa dolap sandalye ocak buzdolabı'],
    ['salon', 1, 'koltuk halı televizyon lamba masa'],
  ];
  const MAXQ = { 'buzdolabı': 1, 'ocak': 1, 'televizyon': 1, 'halı': 1, 'ayna': 2, 'lamba': 2, 'yatak': 2, 'dolap': 2, 'balkon': 2, 'koltuk': 3, 'masa': 2, 'harita': 2, 'cüzdan': 1, 'mutfak': 1, 'salon': 2, 'pencere': 4, 'kapı': 3, 'oda': 6 };
  function varForm(t, neg) { // var / yok / vardı ...
    const p = t === 'past' ? (neg ? 'yoktu' : 'vardı') : t === 'evid' ? (neg ? 'yokmuş' : 'varmış') : t === 'fut' ? (neg ? 'olmayacak' : 'olacak') : (neg ? 'yok' : 'var');
    return p;
  }
  function fVar(g) {
    const c = g.pick(VARCTX), ground = noun(c[0]);
    const item = noun(g.pick(c[2].split(' ')));
    let loc, sc = null;
    if (c[1] && g.p(0.85)) {
      const r = g.f();
      if (r < 0.4) { sc = PRONS[0]; loc = nf(ground, false, 1, 3); }
      else if (r < 0.6) { sc = PRONS[3]; loc = nf(ground, false, 4, 3); }
      else if (r < 0.75) { sc = PRONS[1]; loc = nf(ground, false, 2, 3); }
      else { const nm = eName(g.pick(NAMES)); loc = np(nm, 5) + ' ' + nf(ground, false, 3, 3); }
    } else { loc = nf(ground, false, 0, 3); if (g.p(0.25)) loc = g.pick(['bu', 'şu']) + ' ' + loc; }
    const neg = g.p(0.2), t = g.w(['pres', 62, 'past', 22, 'evid', 8, 'fut', 8]);
    let qty;
    if (neg) qty = countable(item) ? g.pick(['', '', 'hiç']) : g.pick(['', 'hiç']);
    else if (countable(item)) {
      const mq = MAXQ[item.w] || 10;
      let nn = g.w([1, 40, 2, 20, 3, 12, 4, 6, 5, 6, 10, 3, 'birkaç', 8, 'çok', 5]);
      if (typeof nn === 'number' && nn > mq) nn = mq > 1 && g.p(0.4) ? 2 : 1;
      if (mq <= 2 && (nn === 'birkaç' || nn === 'çok')) nn = 1;
      qty = nn === 'birkaç' || nn === 'çok' ? nn : (nn === 1 ? 'bir' : numTxt(g, nn));
    }
    else qty = g.p(0.4) ? 'biraz' : g.p(0.3) ? 'çok' : '';
    const it = nf(item, false, 0, 0);
    if (neg && qty === 'hiç') { /* Hiç kitap yok */ }
    const q = g.p(0.14);
    const vw = q ? (t === 'past' ? 'var mıydı' : 'var mı') : varForm(t, neg);
    const core = jn(loc, qty, it, vw);
    return endMark(g, core, q ? '?' : '.');
  }
  const POSSV = [
    ['kedi köpek kuş balık tavşan hamster', [1, 1, 1, 2]], ['kardeş abla ağabey', [1, 1, 2, 3]], ['amca teyze dayı hala', [1, 1, 2]], ['arkadaş', ['çok', 'çok', 'iki']],
    ['bisiklet bilgisayar telefon oyuncak kitap', [1]], ['soru fikir plan', [1]], ['zaman vakit para', [0]], ['yatak masa oda dolap', [1]],
  ];
  function fPossVar(g) {
    const pv = g.pick(POSSV), n = noun(g.pick(pv[0].split(' ')));
    const who = g.w([0, 5, 1, 2, 2, 2, 3, 2, 4, 1]);
    const sub = who === 2 ? eName(g.pick(NAMES)) : PRONS[who === 0 ? 0 : who === 1 ? 1 : who === 3 ? 3 : 4];
    const poss = sub.k === 'pron' ? posIdx(sub) : 3;
    const opt = g.pick(pv[1]);
    const neg = opt === 0 || g.p(0.1);
    const t = g.w(['pres', 70, 'past', 22, 'evid', 8]);
    let qty = '';
    if (!neg && opt !== 0) qty = opt === 1 ? (g.p(0.5) ? 'bir' : '') : (typeof opt === 'string' ? opt : numTxt(g, opt));
    if (neg && opt !== 0 && countable(n) && g.p(0.5)) qty = 'hiç';
    const own = sub.k === 'pron' ? (g.p(0.5) ? PRON[sub.pi][5] : '') : np(sub, 5);
    const it = nf(n, false, poss, 0);
    const q = g.p(0.12) && sub.k === 'pron' && sub.pi === 1;
    const core = jn(own, qty, it, q ? 'var mı' : varForm(t, neg));
    return endMark(g, core, q ? '?' : '.');
  }
  const PARTN = { kuyruk: 1, burun: 1, gaga: 1, yele: 1, hortum: 1, boyun: 1, boynuz: 2, kulak: 2, göz: 2, kanat: 2, pati: 4, pençe: 4, diş: 0, tüy: 0, pul: 0, yüzgeç: 0 };
  function fHas(g) {
    const a = g.pick(ANIMAL_LIST), gen = nf(a.n, false, 0, 5);
    const r = g.f();
    if (r < 0.35 && a.legs >= 0) {
      const leg = noun('bacak');
      if (a.legs === 0) return endMark(g, jn(gen, nf(leg, false, 3, 0), 'yok'), '.');
      return endMark(g, jn(gen, numTxt(g, a.legs, false), nf(leg, false, 3, 0), 'var'), '.');
    }
    const parts = a.parts.filter(function (x) { return x !== 'bacak' && PARTN[x] !== undefined; });
    if (!parts.length) return fHas(g);
    const p = g.pick(parts), pn = noun(p), k = PARTN[p];
    let s;
    if (k > 0) {
      const spec = { zürafa: 'boyun', tavşan: 'kulak', fil: 'hortum' };
      const adj = (spec[a.n.w] === p) ? 'uzun' : '';
      s = jn(gen, adj, k === 1 || adj ? 'bir' : numTxt(g, k, false), nf(pn, false, 3, 0), 'var');
      if (adj === 'uzun' && k === 2) s = jn(gen, 'uzun', nf(pn, true, 3, 0), 'var');
    } else s = jn(gen, nf(pn, true, 3, 0), 'var');
    return endMark(g, s, '.');
  }

  // ---- 23. konum ----
  const LOCREL = [
    ['masa', 'üst', 'kitap defter bardak tabak fincan lamba çiçek kalem'], ['raf', 'üst', 'kitap defter kutu oyuncak bardak'], ['dolap', 'üst', 'kutu çanta'],
    ['yatak', 'üst', 'yastık battaniye kedi oyuncak'], ['sandalye', 'üst', 'ceket çanta kedi'], ['ağaç', 'üst', 'kuş yaprak kedi sincap kelebek'], ['çatı', 'üst', 'kuş kedi'],
    ['masa', 'alt', 'kedi köpek sandalye top ayakkabı çanta'], ['sandalye', 'alt', 'kedi çanta top ayakkabı'], ['yatak', 'alt', 'ayakkabı kutu kedi top çanta'],
    ['ağaç', 'alt', 'kedi köpek çocuk'], ['köprü', 'alt', 'nehir dere'],
    ['çanta', 'iç', 'kalem defter kitap silgi cüzdan anahtar şemsiye'], ['kutu', 'iç', 'kalem oyuncak top'], ['sepet', 'iç', 'elma ekmek yumurta meyve'],
    ['dolap', 'iç', 'ceket pantolon gömlek tabak bardak'], ['buzdolabı', 'iç', 'süt peynir yumurta elma'], ['ev', 'iç', 'kedi köpek çocuk'], ['bardak', 'iç', 'su süt çay'],
    ['tencere', 'iç', 'çorba yemek pilav'],
    ['ev', 'ön', 'araba bisiklet ağaç çiçek kedi çocuk'], ['kapı', 'ön', 'ayakkabı kedi çocuk köpek'], ['okul', 'ön', 'otobüs araba çocuk'], ['pencere', 'ön', 'masa koltuk'],
    ['ev', 'arka', 'bahçe ağaç'], ['kapı', 'arka', 'top kedi çocuk'], ['okul', 'arka', 'park bahçe'],
    ['ev', 'yan', 'ağaç market park okul fırın'], ['yatak', 'yan', 'lamba masa dolap'], ['okul', 'yan', 'park kütüphane market'], ['masa', 'yan', 'sandalye lamba'], ['kapı', 'yan', 'pencere ayakkabı ayna'],
    ['ev', 'karşı', 'okul park market fırın'], ['okul', 'karşı', 'park market hastane'],
  ];
  const RELN = {}; ['üst', 'alt', 'iç', 'ön', 'arka', 'yan', 'karşı', 'orta', 'dış'].forEach(function (w) { RELN[w] = mkNoun(w, {}); RELN[w].fl = {}; });
  const LOCACT = { kedi: ['uyu', 'otur', 'yat', 'oyna', 'bekle'], köpek: ['uyu', 'yat', 'oyna', 'bekle'], çocuk: ['oyna', 'otur', 'bekle'], kuş: ['ötüyor'], kelebek: [], sincap: ['otur'] };
  function relLoc(g, ground, rel, gp) { // "masanın üstünde"
    const gn = noun(ground);
    const gen = nf(gn, false, gp || 0, 5);
    return gen + ' ' + nform(RELN[rel], false, 3, 3);
  }
  function fLoc(g) {
    const c = g.pick(LOCREL), fig = noun(g.pick(c[2].split(' ')));
    const gp = (c[0] === 'ev' || c[0] === 'okul' || c[0] === 'çanta' || c[0] === 'dolap' || c[0] === 'masa' || c[0] === 'yatak') && g.p(0.35) ? g.pick([1, 4, 2]) : 0;
    const place = relLoc(g, c[0], c[1], gp);
    const r = g.f();
    const tt = g.w(['pres', 60, 'past', 30, 'evid', 10]);
    if (r < 0.34) { // nominal
      const det = g.w(['', 55, 'bu', 15, 'şu', 10, 'o', 8]);
      const pred = npred(place, 2, tt === 'pres' ? 'pres' : tt === 'past' ? 'past' : 'evid', false);
      return endMark(g, jn(det, nf(fig, false, 0, 0), pred), '.');
    }
    if (r < 0.66) { // var
      const cnt = countable(fig);
      const qty = cnt ? g.w(['bir', 55, 'iki', 18, 'üç', 10, 'birkaç', 12]) : g.p(0.3) ? 'biraz' : '';
      const neg = g.p(0.12);
      return endMark(g, jn(place, neg ? '' : qty, nf(fig, false, 0, 0), varForm(tt, neg)), '.');
    }
    if (r < 0.82) { // soru
      const det = g.w(['', 40, 'bu', 20, 'şu', 10, 'o', 10]);
      const pred = npred(place, 2, 'pres', false, true);
      return endMark(g, jn(g.p(0.5) ? det : '', nf(fig, false, g.p(0.4) ? 1 : 0, 0), pred), '?');
    }
    const acts = LOCACT[fig.w];
    if (acts && acts.length) {
      const v = xv(g.pick(acts));
      const t = g.w(['prog', 60, 'past', 30, 'aor', 10]);
      const det = g.p(0.3) ? g.pick(['bir', 'bu', 'şu']) : '';
      return endMark(g, jn(det, nf(fig, false, 0, 0), place, vf(v, t, 2, false, false, false)), '.');
    }
    return endMark(g, jn(g.pick(['bu', 'şu', '']), nf(fig, false, 0, 0), npred(place, 2, 'pres', false)), '.');
  }

  // ---- 21. sayili ifadeler / yas ----
  const QV = [['ye', 'edible', 'A'], ['al', 'sellable', 'A'], ['topla', 'collectable', 'A'], ['ver', 'sellable', 'D'], ['getir', 'edible', 'D'], ['çiz', 'animal', 'A'], ['seç', 'chosen', 'A'], ['kes', 'cuttable', 'A'], ['doldur', 'fillable', 'A']];
  function fQuant(g) {
    const subj = subjFor(g), qv = g.pick(QV);
    const v = xv(qv[0]);
    const pool = poolOf([qv[1]]).filter(function (n) { return countable(n) && !n.head && !n.ts.body; });
    if (!pool.length) return fBasic(g);
    const n = g.pick(pool);
    const t = g.w(['past', 45, 'prog', 20, 'fut', 15, 'aor', 12, 'evid', 3]);
    const cnt = g.w([2, 30, 3, 22, 4, 12, 5, 12, 6, 6, 7, 3, 8, 3, 10, 5]);
    const numS = numTxt(g, cnt) + (g.p(0.3) ? ' tane' : '');
    const s = jn(showS(g, subj, 0.4) ? np(subj, 0) : '', numS, nf(n, false, 0, 0), vf(v, t === 'evid' && subj.p !== 2 ? 'past' : t, subj.p, false, false, false));
    return endMark(g, jn(g.p(0.15) ? timeAdv(g, t) : '', s), '.');
  }
  function ageOf(g, e) {
    if (e.k === 'noun') {
      const w = e.n.w;
      if (w === 'anne' || w === 'baba') return 30 + g.i(26);
      if (w === 'dede' || w === 'nine' || w === 'babaanne' || w === 'anneanne') return 60 + g.i(26);
      if (w === 'abla' || w === 'ağabey' || w === 'kuzen') return 12 + g.i(14);
      if (w === 'kardeş') return 2 + g.i(13);
      if (w === 'teyze' || w === 'amca' || w === 'hala' || w === 'dayı') return 28 + g.i(33);
      return 5 + g.i(9);
    }
    return 5 + g.i(9);
  }
  function fAge(g) {
    const subj = g.p(0.4) ? PRONS[g.pick([0, 0, 1, 2])] : g.p(0.45) ? eName(g.pick(NAMES)) : eNoun(noun(g.pick(FAM_OWN)), { poss: g.pick([1, 1, 3, 4]) });
    const age = ageOf(g, subj), a = numTxt(g, age);
    const r = g.f();
    if (r < 0.7) {
      const t = g.w(['pres', 82, 'past', 15, 'evid', 3]);
      const pred = npred(a + ' yaşında', subj.p, t === 'pres' ? 'pres' : t === 'past' ? 'past' : 'evid', false);
      const showSj = subj.k !== 'pron' || g.p(0.55);
      return endMark(g, jn(showSj ? np(subj, 0) : '', g.p(0.3) ? g.pick(['şimdi', 'bugün']) : '', pred), '.');
    }
    const t = g.w(['past', 60, 'fut', 40]);
    const tm = t === 'past' ? g.pick(['bugün', 'dün', 'geçen hafta']) : g.pick(['yarın', 'gelecek hafta', 'bu hafta sonu']);
    const showSj = subj.k !== 'pron' || g.p(0.5);
    return endMark(g, jn(tm, showSj ? np(subj, 0) : '', a, 'yaşına', vf(xv('gir'), t, subj.p, false, false, false)), '.');
  }

  // =====================================================================================
  // 4f. CUMLE AILELERI (d): duygu, saat, tamlama, sifat-fiil, ek-fiil, istek/gereklilik, kosul, listeler, hayvan bilgileri
  // =====================================================================================
  // ---- 24. duygu / durum ----
  const FEELS = [
    ['P:arkadaş+ gör', 'mutlu'], ['P:oyuncak kır', 'üzgün'], ['P:anahtar kaybet', 'endişeli'], ['X:çok koş', 'yorgun'], ['X:çok yürü', 'yorgun'], ['P:hediye aç', 'heyecanlı'],
    ['P:kedi kaybet', 'üzgün'], ['P:ödev bitir', 'mutlu'], ['P:dede+ ziyaret et', 'mutlu'], ['P:anne+ özle', 'üzgün'], ['A:şarkı dinle', 'neşeli'], ['A:yeni bir arkadaş bul', 'sevinçli'],
    ['X:yağmurda ıslan', 'üzgün'], ['P:kitap+ oku', 'meraklı'], ['P:ders çalış', 'yorgun'], ['A:film izle', 'mutlu'], ['P:çanta+ unut', 'endişeli'], ['X:çok gül', 'mutlu'], ['X:çok bekle', 'yorgun'],
  ];
  const FEEL_S = ['mutlu', 'üzgün', 'yorgun', 'heyecanlı', 'meraklı', 'şaşkın', 'kızgın', 'uykulu', 'hasta', 'aç', 'tok', 'endişeli', 'sevinçli', 'gururlu', 'memnun'];
  const BODYST = [['baş', 0, 'ağrı'], ['diş', 0, 'ağrı'], ['karın', 0, 'ağrı'], ['boğaz', 0, 'ağrı'], ['göz', 0, 'ağrı'], ['el', 1, 'üşü'], ['ayak', 1, 'üşü'], ['ayak', 1, 'yorul'], ['bacak', 1, 'yorul'], ['karın', 0, 'acık'], ['uyku', 0, 'gel']];
  const REFL = ['kendimi', 'kendini', 'kendini', 'kendimizi', 'kendinizi', 'kendilerini'];
  function fFeel(g) {
    const r = g.f();
    if (r < 0.34) { // durum sifati
      const subj = g.p(0.5) ? PRONS[g.pick([0, 0, 0, 1, 3, 2])] : subjFor(g);
      const past = g.p(0.22), ad = g.pick(FEEL_S);
      const deg = g.p(0.55) ? g.pick(['çok', 'çok', 'biraz', 'oldukça']) : '';
      const pred = past ? copPast(ad, subj.p) : copPres(ad, subj.p);
      const tm = g.p(0.4) ? (past ? g.pick(['dün', 'dün akşam', 'sabah']) : g.pick(['bugün', 'şimdi', 'bu akşam'])) : '';
      return endMark(g, jn(tm, showS(g, subj, 0.5) ? np(subj, 0) : '', deg, pred), '.');
    }
    if (r < 0.62) { // neden -> duygu
      const f = g.pick(FEELS), subj = g.p(0.45) ? PRONS[g.pick([0, 0, 1, 3])] : g.p(0.5) ? eName(g.pick(NAMES)) : subjFor(g);
      const cause = vpPart(g, f[0], subj, 'dik', ppos(subj), 0) + ' için';
      const past = g.p(0.2), deg = g.p(0.6) ? g.pick(['çok', 'çok', 'biraz']) : '';
      const pred = past ? copPast(f[1], subj.p) : copPres(f[1], subj.p);
      return endMark(g, jn(showS(g, subj, 0.2) ? np(subj, 0) : '', cause, deg, pred), '.');
    }
    if (r < 0.82) { // beden
      const b = g.pick(BODYST), who = g.w([0, 5, 1, 3, 2, 2]);
      const sub = who === 2 ? eName(g.pick(NAMES)) : PRONS[who === 0 ? 0 : who === 1 ? 1 : 3];
      const poss = sub.k === 'pron' ? posIdx(sub) : 3;
      const n = noun(b[0]), v = xv(b[2]);
      const t = g.w(['prog', 55, 'past', 45]);
      const own = sub.k === 'name' ? np(sub, 5) : '';
      const q = sub.k === 'pron' && sub.pi === 1 && g.p(0.25);
      const verb = vf(v, t, 2, false, false, q);
      return endMark(g, jn(own, nf(n, !!b[1], poss, 0), verb), q ? '?' : '.');
    }
    // kendini ... hissetmek
    const who = g.w([0, 6, 1, 2, 2, 3, 3, 1, 5, 1]);
    const subj = who === 2 ? eName(g.pick(NAMES)) : PRONS[who];
    const adv = g.pick(['çok iyi', 'iyi', 'biraz yorgun', 'çok mutlu', 'kötü', 'çok yorgun', 'harika', 'güçlü', 'biraz üzgün', 'çok neşeli', 'hasta', 'çok rahat']);
    const t = g.w(['prog', 70, 'past', 30]);
    const refl = subj.k === 'name' ? 'kendini' : REFL[subj.pi];
    const tm = g.p(0.4) ? (t === 'past' ? g.pick(['dün', 'sabah']) : g.pick(['bugün', 'şimdi'])) : '';
    return endMark(g, jn(tm, subj.k === 'name' ? np(subj, 0) : (g.p(0.15) ? np(subj, 0) : ''), refl, adv, vf(xv('hisset'), t, subj.p, false, false, false)), '.');
  }

  // ---- 25. saat / zaman anlatimi ----
  const CLOCKV = [ // [ders/eylem, saat araligi]
    ['wake', [6, 7, 7, 8]], ['breakfast', [7, 8]], ['goSchool', [8, 8, 9]], ['night', [9, 10, 10, 11]], ['home', [3, 4, 5, 6]], ['kitchen', [5, 6]],
  ];
  function clockPhrase(g, h) {
    const half = g.p(0.14);
    const wtxt = numWord(h) + (half ? ' buçuk' : '');
    if (g.p(0.28)) { const suffix = numSuf(h, 'DA').slice(numWord(h).length); return half ? h + " buçukta" : h + "'" + suffix; }
    return join(wtxt, null, ['DA']);
  }
  const EVT_T = [
    ['ders', 'başla', [8, 9, 10]], ['okul', 'başla', [8, 9]], ['okul', 'bit', [3, 4]], ['film', 'başla', [5, 6, 7, 8, 9]], ['film', 'bit', [7, 8, 9, 10]], ['maç', 'başla', [3, 5, 7]],
    ['konser', 'başla', [7, 8]], ['otobüs', 'gel', [7, 8]], ['tren', 'kalk', [6, 7, 8, 9, 10]], ['uçak', 'kalk', [6, 7, 9, 11]], ['uçak', 'in', [2, 4, 6, 8]], ['ders', 'bit', [3, 4]],
  ];
  function fClock(g) {
    const subj = subjFor(g);
    if (g.p(0.5)) {
      const e = g.pick(EVT_T), h = g.pick(e[2]);
      const t = g.w(['aor', 40, 'prog', 25, 'past', 25, 'fut', 10]);
      const det = g.w(['', 60, 'bu', 20, 'şu', 5]);
      const v = xv(e[1]);
      return endMark(g, jn(g.p(0.3) ? 'bugün' : '', det, nf(noun(e[0]), false, 0, 0), 'saat', clockPhrase(g, h), vf(v, t, 2, false, false, false)), '.');
    }
    const c = g.pick(CLOCKV), spec = g.pick(VPL[c[0]]), h = g.pick(c[1]);
    const t = g.w(['past', 45, 'aor', 30, 'prog', 10, 'fut', 15]);
    const morning = c[0] === 'wake' || c[0] === 'breakfast' || c[0] === 'goSchool';
    const habit = t === 'aor' ? g.pick(['her gün', 'hafta içi', morning ? 'her sabah' : 'her akşam']) : '';
    const tm = 'saat ' + clockPhrase(g, h);
    return endMark(g, vpFin(g, spec, subj, { t: t, noSubj: !showS(g, subj, 0.4), time: jn(habit, tm) }), '.');
  }

  // ---- 26/27. isim tamlamalari: belirtili (kedinin kuyrugu), belirtisiz (cay bardagi) ----
  const WHOLE = [
    ['ev', 'kapı pencere bahçe çatı balkon duvar'], ['okul', 'bahçe sınıf kapı kütüphane'], ['oda', 'pencere kapı duvar halı perde'], ['bahçe', 'ağaç çiçek çit kapı'],
    ['mutfak', 'masa pencere kapı'], ['sınıf', 'tahta masa kapı pencere harita'], ['ağaç', 'yaprak dal kök kabuk'], ['çiçek', 'yaprak kök'], ['şehir', 'park cadde sokak okul köprü meydan'],
    ['köy', 'okul yol'], ['deniz', 'kıyı dalga'], ['dağ', 'zirve yamaç'], ['nehir', 'su kıyı'], ['araba', 'kapı anahtar'], ['masa', 'ayak'],
  ];
  const PLPART = { yaprak: 1, dal: 1, çiçek: 1, dalga: 1 };
  const NODEG = { 'kırmızı': 1, 'mavi': 1, 'sarı': 1, 'yeşil': 1, 'beyaz': 1, 'siyah': 1, 'kırık': 1, 'açık': 1, 'kapalı': 1, 'ıslak': 1, 'kuru': 1 };
  function degOf(g, ad, p) { return !NODEG[ad] && g.p(p) ? g.pick(['çok', 'oldukça']) : ''; }
  const PHYS = { 'büyük': 1, 'küçük': 1, 'güzel': 1, 'temiz': 1, 'kirli': 1, 'uzun': 1, 'kısa': 1, 'yumuşak': 1, 'kalın': 1, 'ince': 1, 'geniş': 1, 'dar': 1, 'açık': 1, 'kapalı': 1, 'sağlam': 1, 'kırık': 1, 'yeşil': 1, 'sarı': 1, 'kırmızı': 1, 'mavi': 1, 'beyaz': 1, 'siyah': 1, 'ıslak': 1, 'kuru': 1, 'yüksek': 1, 'eski': 1, 'yeni': 1, 'sıcak': 0, 'sert': 1, 'ağır': 1, 'hafif': 1 };
  const OWNOBJ = ['çanta', 'kalem', 'defter', 'bisiklet', 'ceket', 'şapka', 'araba', 'top', 'balon', 'kazak', 'ayakkabı', 'atkı', 'eldiven', 'kitap', 'oyuncak', 'battaniye', 'yastık', 'sandalye', 'masa', 'lamba'];
  function fGen(g) {
    const r = g.f();
    if (r < 0.3) { // hayvan + uzuv
      const a = g.pick(ANIMAL_LIST);
      const parts = a.parts.filter(function (x) { return PARTN[x] !== undefined || x === 'bacak' || x === 'yüzgeç'; });
      const p = g.pick(parts), pn = noun(p), pl = PARTN[p] === 2 || PARTN[p] === 0 || p === 'bacak' ? g.p(0.5) : false;
      const ads = adjFor(pn).filter(function (x) { return PHYS[x]; });
      if (!ads.length) return fGen(g);
      const det = g.p(0.2) ? g.pick(['bu', 'şu']) + ' ' : '';
      const gen = det + nf(a.n, false, 0, 5);
      { const ad = g.pick(ads); return endMark(g, jn(gen, nf(pn, pl, 3, 0), degOf(g, ad, 0.35), ad), '.'); }
    }
    if (r < 0.52) { // kisi + beden
      const nm = g.p(0.7) ? eName(g.pick(NAMES)) : eNoun(noun(g.pick(FAM_OWN)), { poss: g.pick([1, 3, 4]) });
      const bp = g.pick(['saç', 'göz', 'el', 'ayak', 'kol', 'bacak', 'parmak', 'yüz', 'boyun']);
      const pn = noun(bp), pl = (bp === 'göz' || bp === 'el' || bp === 'ayak' || bp === 'kol' || bp === 'bacak' || bp === 'parmak') && g.p(0.6);
      const ads = adjFor(pn).filter(function (x) { return PHYS[x] && x !== 'yüksek'; });
      if (!ads.length) return fGen(g);
      { const ad = g.pick(ads); return endMark(g, jn(np(nm, 5), nf(pn, pl, 3, 0), degOf(g, ad, 0.3), ad), '.'); }
    }
    if (r < 0.78) { // bütün-parça
      const w = g.pick(WHOLE), part = noun(g.pick(w[1].split(' '))), whole = noun(w[0]);
      const ads = adjFor(part).filter(function (x) { return PHYS[x]; });
      if (!ads.length) return fGen(g);
      const own = g.p(0.3) && (w[0] === 'ev' || w[0] === 'okul' || w[0] === 'bahçe' || w[0] === 'oda') ? g.pick([1, 4]) : 0;
      const pl = !!PLPART[part.w] && g.p(0.6);
      { const ad = g.pick(ads); return endMark(g, jn(nf(whole, false, own, 5), nf(part, pl, 3, 0), degOf(g, ad, 0.3), ad), '.'); }
    }
    // sahip + nesne + renk
    const nm = g.p(0.65) ? eName(g.pick(NAMES)) : eNoun(noun(g.pick(FAM_OWN)), { poss: g.pick([1, 3, 4]) });
    const o = noun(g.pick(OWNOBJ));
    const cols = colorsOf(o);
    if (!cols) return fGen(g);
    const ad = g.pick(cols.filter(function (c) { return c.indexOf(' ') < 0; }));
    const t = g.w(['pres', 78, 'past', 22]);
    return endMark(g, jn(np(nm, 5), nf(o, false, 3, 0), t === 'pres' ? ad : copPast(ad, 2)), '.');
  }
  const COMPS = [
    ['ağaç', 'elma armut kiraz erik limon portakal incir ceviz fındık nar kayısı şeftali vişne dut', 'gör dik sula', 'bahçe'],
    ['bardak', 'çay su', 'al yıka doldur tut', 'masa mutfak'], ['fincan', 'çay kahve', 'al yıka doldur tut', 'masa mutfak'],
    ['kaşık', 'çay çorba yemek tatlı', 'al yıka', 'masa mutfak'], ['çanta', 'okul sırt el', 'taşı hazırla aç kapat', 'oda'],
    ['fırça', 'diş saç', 'al kullan', 'banyo'], ['kutu', 'kalem oyuncak kibrit ayakkabı', 'aç kapat taşı', 'oda'],
    ['kitap', 'ders masal hikaye resim şiir', 'oku al seç', 'masa'], ['defter', 'resim ders', 'al aç', 'çanta'],
    ['bahçe', 'okul ev çay', 'gez', ''], ['oda', 'çocuk yatak oturma', 'temizle', 'ev'], ['top', 'futbol basketbol voleybol tenis', 'al at tut', 'oda'],
    ['tabak', 'çay yemek tatlı', 'al yıka', 'masa mutfak'], ['lamba', 'masa sokak', 'aç', 'oda'], ['anahtar', 'kapı ev araba', 'bul al', 'çanta'],
    ['şişe', 'su süt', 'al doldur', 'masa'], ['reçel', 'çilek kayısı vişne incir', 'ye', 'buzdolabı dolap masa'], ['çorba', 'mercimek domates tavuk sebze', 'iç pişir', 'mutfak masa'],
    ['salata', 'mevsim domates havuç', 'ye yap', 'masa buzdolabı mutfak'], ['dondurma', 'çilek limon', 'ye al', 'buzdolabı'], ['öğretmen', 'sınıf müzik resim matematik', 'dinle gör', 'okul'],
  ];
  function pickComp(g) {
    for (let k = 0; k < 20; k++) {
      const c = g.pick(COMPS);
      const pre = g.pick(c[1].split(' '));
      const head = c[0];
      if (!NMAP.get(head)) continue;
      return { n: mkComp(pre, head), c: c };
    }
    return null;
  }
  function fComp(g) {
    const pc = pickComp(g); if (!pc) return fBasic(g);
    const n = pc.n, c = pc.c, r = g.f();
    if (r < 0.4) { // fiil ile
      const subj = subjFor(g), vs = g.pick(c[2].split(' '));
      const v = xv(vs);
      const cl = mkClause(g, { subj: subj, verb: v, objNoun: n, time: g.p(0.2), manner: false, place: false });
      if (!cl || v.tr === 'i') return fComp(g);
      return endMark(g, renderClause(g, cl), '.');
    }
    if (r < 0.65 && (c[3] || c[0] === 'ağaç')) { // var
      const locs = c[3] ? c[3].split(' ') : ['bahçe', 'ev', 'oda'];
      const ground = noun(g.pick(c[0] === 'ağaç' ? ['bahçe', 'park', 'orman'] : locs));
      const neg = g.p(0.12);
      const cnt = n.u ? (g.p(0.4) ? 'biraz' : '') : c[0] === 'ağaç' ? g.w(['bir', 45, 'iki', 25, 'üç', 15, 'beş', 8, 'on', 4]) : g.w(['bir', 55, 'iki', 25, 'üç', 10, 'birkaç', 10]);
      const own = c[0] === 'ağaç' && (ground.w === 'bahçe') && g.p(0.5) ? g.pick([1, 4]) : 0;
      const t = g.w(['pres', 75, 'past', 15, 'evid', 5, 'fut', 5]);
      return endMark(g, jn(nf(ground, false, own, 3), neg ? '' : cnt, nf(n, false, 0, 0), varForm(t, neg)), '.');
    }
    if (r < 0.82) { // Bu bir X.
      const dir = g.p(0.3), t = g.w(['pres', 80, 'past', 20]);
      const det = g.pick(['Bu', 'Şu', 'O']);
      const w = 'bir ' + nf(n, false, 0, 0);
      return endMark(g, det + ' ' + npred(w, 2, dir ? 'dir' : (t === 'pres' ? 'pres' : 'past'), false), '.');
    }
    if (r < 0.92 && c[3] && c[0] !== 'öğretmen' && c[0] !== 'oda') { // nerede
      const ground = noun(g.pick(c[3].split(' ')));
      const det = g.p(0.35) ? g.pick(['bu', 'şu', 'o']) : '';
      const s = jn(det, nf(n, false, 0, 0), nf(ground, false, g.p(0.3) ? g.pick([1, 4]) : 0, 3));
      return endMark(g, s, '.');
    }
    // cogul + sifat
    const ads = adjFor(n.head).filter(function (x) { return PHYS[x]; });
    if (!ads.length) return fComp(g);
    { const ad = g.pick(ads); return endMark(g, jn(g.pick(['bu', 'şu', 'o']), nf(n, true, 0, 0), degOf(g, ad, 0.4), ad), '.'); }
  }

  // ---- 28. sifat-fiil (-An) ----
  const RCSPEC = ['X:koş', 'L:park oyna', 'N:kitap oku', 'N:müzik dinle', 'N:resim yap', 'D:okul git', 'L:sınıf otur', 'X:şarkı söyle', 'X:gül', 'X:ağla', 'X:uyu', 'N:top oyna', 'A:çiçek+ sula', 'A:kedi besle', 'N:bisiklet sür', 'X:yüz', 'N:dondurma ye', 'N:süt iç', 'L:bahçe çalış', 'L:masa otur', 'N:film izle', 'X:dans et', 'X:yürü', 'N:not al'];
  const RCHEAD = [['çocuk', 'çocuklar'], ['kız', 'kızlar'], ['oğlan', 'oğlanlar'], ['adam', 'adamlar'], ['kadın', 'kadınlar'], ['öğrenci', 'öğrenciler']];
  function fRel(g) {
    const spec = g.pick(RCSPEC), hd = g.pick(RCHEAD), pl = g.p(0.4);
    const subj = eNoun(noun(hd[0]));
    const rc = vpNon(g, spec, subj, 'an', false);
    const head = pl ? hd[1] : hd[0];
    const r = g.f();
    let pred;
    if (r < 0.4) { const ad = g.pick(['mutlu', 'yorgun', 'neşeli', 'sevimli', 'çalışkan', 'akıllı', 'sakin', 'meraklı']); pred = (g.p(0.4) ? g.pick(['çok', 'oldukça']) + ' ' : '') + ad; }
    else if (r < 0.7 && !pl) { const nm = g.pick(NAMES); pred = nm; }
    else if (r < 0.85 && !pl) { const ps = g.pick([1, 1, 4]); pred = np(eNoun(noun(g.pick(['kardeş', 'abla', 'ağabey', 'kuzen', 'arkadaş'])), { poss: ps }), 0); if (g.p(0.5)) pred = PRON[ps === 1 ? 0 : 3][5] + ' ' + pred; }
    else if (!pl) { pred = 'bir ' + g.pick(['öğrenci', 'sporcu', 'öğretmen', 'müzisyen', 'ressam']); }
    else { const ad = g.pick(['mutlu', 'yorgun', 'neşeli', 'sevimli']); pred = 'çok ' + ad; }
    return endMark(g, jn(rc, head, pred), '.');
  }

  // ---- 29. ek-fiil: sinif bilgisi, kimlik ----
  const CATS = [
    ['fruit', 'meyve'], ['veg', 'sebze'], ['animal land', 'hayvan'], ['drink', 'içecek'], ['flower', 'çiçek'], ['clothesw', 'giysi'], ['music', 'müzik aleti'], ['veh', 'taşıt'],
    ['time day', 'gün'], ['time month', 'ay'], ['time season', 'mevsim'], ['job', 'meslek'], ['tree', 'ağaç'], ['sweet', 'tatlı'], ['cook', 'yemek'], ['bird', 'kuş'], ['insect', 'böcek'],
  ];
  const CATWORD = {};
  CATS.forEach(function (c) { CATWORD[c[0]] = c[1]; });
  function catItems(c) {
    const tags = c[0].split(' ');
    let l = poolOf([tags[tags.length - 1]]);
    if (tags.length > 1) l = l.filter(function (n) { return n.ts[tags[0]]; });
    return l.filter(function (n) { return !n.head && !n.u; });
  }
  const WRONGC = { 'meyve': 1, 'sebze': 1, 'hayvan': 1, 'içecek': 1, 'çiçek': 1, 'giysi': 1, 'müzik aleti': 1, 'taşıt': 1 };
  const CAT_SKIP = { 'meyve': 1, 'sebze': 1, 'içecek': 1, 'yiyecek': 1, 'yemek': 1, 'tatlı': 1, 'çiçek': 1, 'ağaç': 1, 'kuş': 1, 'böcek': 1, 'örümcek': 1, 'araç': 1 };
  function fCat(g) {
    const c = g.pick(CATS), l = catItems(c).filter(function (n) { return !CAT_SKIP[n.w] || n.w === 'araç' && false; });
    if (!l.length) return fBasic(g);
    const n = g.pick(l), wn = c[1];
    const r = g.f();
    if (r < 0.5) return endMark(g, jn(nf(n, false, 0, 0), npred('bir ' + wn, 2, 'dir')), '.');
    if (r < 0.68) {
      let n2, k = 0; do { n2 = g.pick(l); } while (n2 === n && k++ < 9);
      if (n2 === n) return fCat(g);
      return endMark(g, jn(nf(n, false, 0, 0), 've', nf(n2, false, 0, 0), 'birer', npred(wn, 2, 'dir')), '.');
    }
    if (r < 0.86 && WRONGC[wn]) { // "Kedi bir meyve degil, bir hayvandir"
      let c2, k = 0; do { c2 = g.pick(CATS); } while ((c2 === c || !WRONGC[c2[1]]) && k++ < 30);
      if (c2 === c || !WRONGC[c2[1]]) return fCat(g);
      return endMark(g, jn(nf(n, false, 0, 0), 'bir', c2[1], 'değil,', 'bir', npred(wn, 2, 'dir')), '.');
    }
    return endMark(g, jn(nf(n, false, 0, 0), npred('bir ' + wn, 2, 'pres', false, true)), '?');
  }
  const JOBS_ID = ['öğretmen', 'doktor', 'hemşire', 'polis', 'pilot', 'aşçı', 'garson', 'berber', 'kasap', 'bakkal', 'terzi', 'şoför', 'çiftçi', 'balıkçı', 'ressam', 'yazar', 'müzisyen', 'sporcu', 'mühendis', 'işçi', 'fırıncı', 'gazeteci', 'avukat', 'mimar', 'öğrenci'];
  function fIdent(g) {
    const r = g.f();
    if (r < 0.34) { // ben ogretmenim
      const pi = g.w([0, 30, 1, 14, 2, 14, 3, 10, 4, 4, 5, 12]);
      const subj = PRONS[pi];
      const job = g.pick(JOBS_ID);
      const bir = pi === 5 ? '' : g.w(['', 50, 'bir ', 50]);
      const pred = pi === 5 ? npred(job, 5, 'pres') : npred(bir + job, pi, 'pres');
      return endMark(g, jn(pi === 2 ? np(subj, 0) : (g.p(0.6) || pi === 5 ? np(subj, 0) : ''), pred), '.');
    }
    if (r < 0.62) { // babam bir doktor
      const fam = noun(g.pick(FAM_OWN)), who = g.w([0, 6, 1, 1, 3, 2, 2, 3]);
      const sub = who === 2 ? eName(g.pick(NAMES)) : PRONS[who];
      const poss = sub.k === 'pron' ? posIdx(sub) : 3;
      const own = sub.k === 'name' ? np(sub, 5) : '';
      const job = g.pick(JOBS_ID.filter(function (j) { return j !== 'öğrenci'; }));
      return endMark(g, jn(own, nf(fam, false, poss, 0), g.p(0.5) ? 'bir' : '', npred(job, 2, 'pres')), '.');
    }
    if (r < 0.8) { // Ben Ayse'yim / Benim adim Ayse
      const nm = g.pick(NAMES);
      if (g.p(0.5)) { const sf = join(nm, null, ['(y)(I)m']).slice(nm.length); return endMark(g, jn('Ben', nm + "'" + sf), '.'); }
      return endMark(g, jn('Benim', 'adım', nm), '.');
    }
    // biz kardesiz / onlar arkadas
    const r2 = g.f();
    if (r2 < 0.4) { const w = g.pick(['kardeş', 'arkadaş', 'komşu', 'sınıf arkadaşı']); return endMark(g, jn(g.pick(['Biz', 'Biz', '']), npred(w, 3, 'pres')), '.'); }
    if (r2 < 0.7) { const a = eName(g.pick(NAMES)); let b; do { b = g.pick(NAMES); } while (b === a.name); return endMark(g, jn(a.name, 'ile', b, g.pick(['kardeş', 'arkadaş', 'komşu', 'iyi arkadaş'])), '.'); }
    const w = g.pick(['arkadaş', 'kardeş', 'komşu']);
    return endMark(g, jn('Onlar', npred(w, 5, 'pres')), '.');
  }

  // ---- 30. istek / sevgi / baslama / gereklilik ----
  const LIKES = ['N:kitap oku', 'N:resim yap', 'N:şarkı söyle', 'X:yüz', 'N:müzik dinle', 'N:top oyna', 'N:bisiklet sür', 'X:yürüyüş yap', 'N:yemek yap', 'M:kuş izle', 'L:bahçe çalış', 'X:dans et', 'N:dondurma ye', 'N:film izle', 'M:çiçek sula', 'N:masal dinle', 'N:satranç oyna', 'X:gezi yap', 'N:pasta ye', 'N:çay iç'];
  const WANTS = ['D:deniz git', 'D:park git', 'D:sinema git', 'N:dondurma ye', 'N:çay iç', 'X:yüz', 'N:film izle', 'N:kitap oku', 'X:dinlen', 'D:tatil çık', 'N:top oyna', 'X:uyu', 'N:pasta ye', 'N:limonata iç', 'D:hayvanat_bahçesi git', 'N:bisiklet sür', 'X:oyna', 'D:ev git', 'P:arkadaş+ gör', 'X:yeni bir şey öğren', 'N:resim yap', 'N:müzik dinle', 'D:piknik git'];
  const BEGINS = ['N:yemek yap', 'N:ödev yap', 'N:kitap oku', 'N:film izle', 'N:resim yap', 'X:çalış', 'N:ders çalış', 'N:müzik dinle', 'X:uyu', 'N:top oyna', 'X:koş', 'N:kahvaltı yap'];
  const FORGETS = ['A:kapı kapat', 'A:ışık kapat', 'A:pencere kapat', 'P:çanta al', 'M:çiçek sula', 'A:anahtar al', 'P:şemsiye al', 'N:ödev yap', 'A:kedi besle', 'P:ceket giy', 'A:kapı kilitle'];
  const LEARNS = ['X:yüz', 'N:bisiklet sür', 'N:satranç oyna', 'N:gitar çal', 'N:yemek yap', 'X:oku', 'X:yaz', 'N:piyano çal', 'X:dans et', 'N:resim çiz', 'X:say'];
  const MUSTS = ['P:diş+ fırçala', 'P:el+ yıka', 'X:çok su iç', 'X:erken yat', 'P:ödev yap', 'X:sabah erken kalk', 'N:kitap oku', 'X:dikkatli ol', 'A:oda temizle', 'P:çanta hazırla', 'X:yavaş yürü', 'A:kapı kapat', 'N:ders çalış', 'X:sessiz ol'];
  const MUSTNOT = ['X:geç kal', 'X:yalan söyle', 'X:bağır', 'X:acele et', 'A:çöp yere at', 'X:kavga et'];
  function fAspect(g) {
    const subj = g.p(0.5) ? PRONS[g.w([0, 30, 1, 14, 2, 10, 3, 14, 4, 4, 5, 8])] : subjFor(g);
    const r = g.f();
    const sh = showS(g, subj, 0.35);
    if (r < 0.28) { // istemek
      const spec = g.pick(WANTS), t = g.w(['prog', 55, 'past', 20, 'fut', 8, 'aor', 17]);
      const inf = vpNon(g, spec, subj, 'mak', false);
      return endMark(g, jn(sh ? np(subj, 0) : '', g.p(0.2) ? g.pick(['çok', 'gerçekten']) : '', inf, vf(xv('iste'), t, subj.p, g.p(0.06), false, false)), '.');
    }
    if (r < 0.5) { // sevmek
      const spec = g.pick(LIKES), t = g.w(['aor', 70, 'prog', 15, 'past', 15]);
      const inf = vpInf(g, spec, subj, 1, false);
      const adv = g.w(['', 50, 'çok', 30, 'en çok', 12, 'gerçekten', 8]);
      return endMark(g, jn(sh ? np(subj, 0) : '', adv, inf, vf(xv('sev'), t, subj.p, g.p(0.08), false, false)), '.');
    }
    if (r < 0.62) { // baslamak
      if (g.p(0.25)) return endMark(g, jn(g.pick(['bugün', 'akşam', 'sabah']), 'yağmur', 'yağmaya', vf(xv('başla'), g.pick(['past', 'past', 'prog']), 2, false, false, false)), '.');
      const spec = g.pick(BEGINS), t = g.w(['past', 60, 'prog', 15, 'fut', 15, 'aor', 10]);
      const inf = vpInf(g, spec, subj, 2, false);
      return endMark(g, jn(g.p(0.2) ? timeAdv(g, t) : '', sh ? np(subj, 0) : '', inf, vf(xv('başla'), t, subj.p, false, false, false)), '.');
    }
    if (r < 0.72) { // unutmak / hatirlamak
      const spec = g.pick(FORGETS), forget = g.p(0.75), t = g.w(['past', 80, 'prog', 5, 'fut', 5, 'aor', 10]);
      const inf = vpInf(g, spec, subj, 1, false);
      const neg = !forget && g.p(0.3);
      return endMark(g, jn(sh ? np(subj, 0) : '', inf, vf(xv(forget ? 'unut' : 'hatırla'), t, subj.p, neg, false, false)), '.');
    }
    if (r < 0.82) { // ogrenmek
      const spec = g.pick(LEARNS), t = g.w(['past', 60, 'prog', 20, 'fut', 20]);
      const inf = vpInf(g, spec, subj, 1, false);
      return endMark(g, jn(g.p(0.2) ? timeAdv(g, t) : '', sh ? np(subj, 0) : '', inf, vf(xv('öğren'), t, subj.p, false, false, false)), '.');
    }
    // -mAlI
    const notM = g.p(0.16), spec = g.pick(notM ? MUSTNOT : MUSTS);
    return endMark(g, vpFin(g, spec, subj, { t: 'nec', neg: notM, noSubj: !showS(g, subj, 0.35), time: g.p(0.2) ? g.pick(['her gün', 'şimdi', 'bugün']) : '' }), '.');
  }

  // ---- kosul (-sA), sorular, listeler ----
  const CONDW = [
    ['N:yağmur yağ', 'X:evde kal'], ['N:hava güzel ol', 'D:park git'], ['N:hava sıcak ol', 'D:deniz git'], ['N:kar yağ', 'X:kardan adam yap'], ['N:hava soğuk ol', 'P:mont giy'],
    ['N:yağmur yağ', 'P:şemsiye al'], ['N:hava güzel ol', 'X:piknik yap'], ['N:hava sıcak ol', 'N:dondurma ye'], ['N:hava soğuk ol', 'N:çay iç'],
  ];
  const CONDS = [
    ['X:erken yat', 'X:sabah kolayca kalk'], ['X:çok çalış', 'X:sınavı geç'], ['N:ders çalış', 'X:başarılı ol'], ['N:yemek ye', 'X:doy'], ['X:erken kalk', 'A:otobüs kaçırma'],
    ['P:el+ yıka', 'X:hasta olma'], ['X:acele et', 'X:geç kalma'], ['N:su iç', 'X:daha iyi hisset'], ['X:sabırlı ol', 'X:başar'], ['N:kitap oku', 'X:çok şey öğren'], ['X:erken uyan', 'X:kahvaltı yap'],
  ];
  function fCond(g) {
    const r = g.f();
    if (r < 0.34) { // dunya olayi + biz/ben
      const c = g.pick(CONDW), subj = PRONS[g.pick([3, 3, 0, 1, 4])];
      const cnd = vpFin(g, c[0], S3, { t: 'condaor', noSubj: true });
      const main = vpFin(g, c[1], subj, { t: 'aor', noSubj: true });
      return endMark(g, jn(g.p(0.15) ? 'Eğer' : '', cnd, main), '.');
    }
    if (r < 0.66) { // ayni ozne
      const c = g.pick(CONDS), subj = PRONS[g.pick([1, 1, 0, 3, 4])];
      const condV = parseVP(c[0]).verb, args = vpArgs(g, c[0], subj);
      const cnd = jn(args, vf(condV, 'condaor', subj.p, false, false, false));
      const m = parseVP(c[1]);
      const negM = /ma$|me$/.test(c[1].split(' ').pop());
      let spec = c[1];
      let neg = false;
      if (negM) { spec = c[1].slice(0, -2); neg = true; }
      const main = vpFin(g, spec, subj, { t: 'aor', neg: neg, noSubj: true });
      return endMark(g, jn(g.p(0.15) ? 'Eğer' : '', cnd, main), '.');
    }
    if (r < 0.84) { // sifat kosulu + emir
      const o = g.pick([['yorgunsan', 'yorgunsanız', 'X:biraz dinlen'], ['hastaysan', 'hastaysanız', 'D:doktor git'], ['acıktıysan', 'acıktıysanız', 'X:bir şeyler ye'], ['susadıysan', 'susadıysanız', 'N:su iç'], ['üşüdüysen', 'üşüdüyseniz', 'P:ceket giy'], ['sıkıldıysan', 'sıkıldıysanız', 'N:kitap oku']]);
      const pl = g.p(0.2);
      const s = vpFin(g, o[2], pl ? PRONS[4] : PRONS[1], { t: 'imp', noSubj: true });
      return endMark(g, jn(g.p(0.6) ? 'Eğer' : '', pl ? o[1] : o[0], s), g.p(0.3) ? '!' : '.');
    }
    // dilek: keske? "Keşke yarın hava güzel olsa."
    const wish = ['Keşke yarın hava güzel olsa.', 'Keşke şimdi denizde olsak.', 'Keşke yarın tatil olsa.', 'Keşke daha çok zamanım olsa.', 'Keşke bir kedim olsa.', 'Keşke yağmur yağsa.', 'Keşke kar yağsa.', 'Keşke biraz daha uyusam.'];
    return g.pick(wish);
  }
  const SHOP = [
    ['bakkaldan', 'ekmek süt peynir yumurta çay şeker makarna yoğurt ayran çikolata reçel bal'], ['marketten', 'ekmek süt peynir yumurta makarna yoğurt su çikolata elma'],
    ['manavdan', 'elma armut portakal muz üzüm çilek domates salatalık patates soğan havuç biber limon marul'], ['pazardan', 'elma armut portakal domates salatalık patates soğan havuç biber limon çilek'],
    ['pastaneden', 'pasta kek kurabiye'], ['fırından', 'ekmek simit poğaça'],
  ];
  function listOf(g, words) {
    const k = g.p(0.5) ? 3 : 2, ws = [];
    while (ws.length < k) { const w = nf(noun(g.pick(words)), false, 0, 0); if (ws.indexOf(w) < 0) ws.push(w); }
    return k === 3 ? ws[0] + ', ' + ws[1] + ' ve ' + ws[2] : ws[0] + ' ve ' + ws[1];
  }
  function fList(g) { // ekmek, sut ve peynir
    if (g.p(0.55)) {
      const sh = g.pick(SHOP), ws = sh[1].split(' ');
      const subj = g.p(0.5) ? PRONS[g.pick([0, 0, 3])] : eName(g.pick(NAMES));
      const t = g.w(['past', 60, 'fut', 20, 'prog', 20]);
      const lst = sh[0] === 'pastaneden' || sh[0] === 'fırından' ? listOf(g, ws.slice(0, g.p(0.5) ? 3 : 2)) : listOf(g, ws);
      return endMark(g, jn(showS(g, subj, 0.4) ? np(subj, 0) : '', sh[0], lst, vf(xv('al'), t, subj.p, false, false, false)), '.');
    }
    const it = ['kalem', 'defter', 'silgi', 'kitap', 'cetvel', 'makas', 'boya', 'kağıt'];
    const c = g.pick(['çanta', 'masa', 'kutu', 'kalemlik']);
    const its = c === 'kalemlik' ? ['kalem', 'silgi', 'cetvel', 'makas'] : it;
    const own = c === 'çanta' && g.p(0.5) ? g.pick([1, 2, 4]) : 0;
    return endMark(g, jn(nf(noun(c), false, own, 3), listOf(g, its), g.pick(['var', 'var', 'vardı'])), '.');
  }
  function fOr(g) {
    const r = g.f();
    const set = g.pick([FRUITS_LIKE, DRINKS_LIKE, SEASONS_L, PETS_L]);
    const a = g.pick(set); let b; do { b = g.pick(set); } while (b === a);
    const pl = set === PETS_L;
    if (r < 0.4) { // cay mi kahve mi?
      const A = nf(noun(a), pl, 0, 0), B = nf(noun(b), pl, 0, 0);
      const q = jn(A, mI(A, 2, false), B, mI(B, 2, false));
      const vv = set === DRINKS_LIKE ? g.pick(['içersin', 'istersin']) : 'seversin';
      return endMark(g, jn(g.p(0.3) ? 'Sen' : '', q, vv), '?');
    }
    if (r < 0.7) { // hem ... hem
      if (set === SEASONS_L) return fOr(g);
      const sev = xv('sev'), subj = g.p(0.5) ? PRONS[g.pick([0, 0, 3, 2])] : eName(g.pick(NAMES));
      const s = jn(showS(g, subj, 0.3) ? np(subj, 0) : '', 'hem', nf(noun(a), pl, 0, 1), 'hem de', nf(noun(b), pl, 0, 1), vf(sev, 'aor', subj.p, false, false, false));
      return endMark(g, s, '.');
    }
    // ya ... ya da
    const acts = [['parka', 'sinemaya'], ['denize', 'parka'], ['sahile', 'çarşıya'], ['kütüphaneye', 'sinemaya'], ['müzeye', 'parka'], ['bahçeye', 'sahile'], ['pazara', 'markete']];
    const p = g.pick(acts), subj = PRONS[g.pick([3, 3, 0, 1, 2])];
    const t = g.w(['aor', 50, 'fut', 50]);
    const v = xv('git'), verb = vf(v, t, subj.p, false, false, false);
    return endMark(g, jn(showS(g, subj, 0.3) ? np(subj, 0) : '', 'ya', p[0], 'ya da', p[1], verb), '.');
  }
  function fRequest(g) {
    const subj = PRONS[g.w([1, 8, 4, 3])];
    const forms = [
      ['A:kapı aç'], ['A:kapı kapat'], ['A:pencere aç'], ['A:pencere kapat'], ['X:bana yardım et'], ['A:ışık kapat'], ['X:bana su ver'], ['X:bana bir bardak su ver'], ['X:bana bir kalem ver'], ['A:çay demle'],
      ['X:bana bir şarkı söyle'], ['X:bana bir hikaye anlat'], ['A:masa hazırla'], ['X:bana bir kitap getir'], ['X:yanıma gel'], ['X:biraz yavaş konuş'], ['X:bunu bir daha söyle'], ['X:bana yol göster'],
    ];
    const spec = g.pick(forms)[0];
    const pre = g.w(['', 55, 'Lütfen ', 25, 'Şimdi ', 5, 'Acaba ', 0]);
    const s = vpFin(g, spec, subj, { t: 'aor', q: true, noSubj: true });
    return endMark(g, (pre ? pre : '') + (pre ? low1(s) : s), '?');
  }

  // ---- 33. hayvan bilgileri ----
  function animalSentence(g, a, kind) {
    if (kind === 'sound' && a.sound) return jn(nf(a.n, false, 0, 0), vf(a.sound, 'aor', 2, false, false, false));
    if (kind === 'eats' && a.eats.length) {
      const e = a.eats.length > 1 && g.p(0.5) ? a.eats.slice(0, 2) : [g.pick(a.eats)];
      const en = e.map(function (w) { return nf(noun(w), false, 0, 0); });
      return jn(nf(a.n, false, 0, 0), en.join(' ve '), vf(xv('ye'), 'aor', 2, false, false, false));
    }
    if (kind === 'act' && a.acts.length) {
      const ac = g.pick(a.acts);
      const spec = (ac.c || 'X') + ':' + (ac.o ? ac.o + ' ' : '') + ac.v.s;
      return vpFin(g, spec, eNoun(a.n), { t: 'aor' });
    }
    return '';
  }
  function fAnimal(g) {
    for (let k = 0; k < 10; k++) {
      const a = g.pick(ANIMAL_LIST), r = g.f();
      let s = '';
      if (r < 0.28) s = animalSentence(g, a, 'sound');
      else if (r < 0.52) s = animalSentence(g, a, 'eats');
      else if (r < 0.85) s = animalSentence(g, a, 'act');
      else {
        const cols = COLORS[a.n.w];
        if (cols) { s = jn(nf(a.n, false, 0, 0), cols.length === 1 ? npred(cols[0], 2, 'dir') : cols.slice(0, -1).join(', ') + ' ya da ' + cols[cols.length - 1] + ' olabilir'); }
      }
      if (s) return endMark(g, s, '.');
    }
    return fBasic(g);
  }
  const SEASON_FACTS = [
    'Yazın hava sıcak olur.', 'Yazın günler uzun olur.', 'Yazın okullar tatil olur.', 'Yazın çocuklar denizde yüzer.', 'Kışın hava soğuk olur.', 'Kışın kar yağar.', 'Kışın günler kısa olur.',
    'Kışın kalın giysiler giyeriz.', 'İlkbaharda çiçekler açar.', 'İlkbaharda hava ısınır.', 'İlkbaharda ağaçlar yeşerir.', 'İlkbaharda çok yağmur yağar.', 'Sonbaharda yapraklar sararır.',
    'Sonbaharda yapraklar dökülür.', 'Sonbaharda hava serin olur.', 'Sonbaharda çok yağmur yağar.', 'Yağmur yağınca yerler ıslanır.', 'Kar yağınca her yer beyaz olur.', 'Güneş doğunca hava aydınlanır.',
    'Gece olunca gökyüzü kararır.', 'Güneş gündüz parlar.', 'Ay geceleri parlar.', 'Yıldızlar gece görünür.', 'Bulutlar gökyüzünde yüzer.', 'Kar beyazdır.', 'Gökyüzü mavidir.', 'Çimen yeşildir.',
    'Buz soğuktur.', 'Ateş sıcaktır.', 'Şeker tatlıdır.', 'Limon ekşidir.', 'Su ıslaktır.', 'Ateş yakar.', 'Su akar.', 'Kuşlar uçar.', 'Balıklar yüzer.', 'Ağaçlar büyür.', 'Çiçekler güzel kokar.',
    'Bir yılda on iki ay vardır.', 'Bir haftada yedi gün vardır.', 'Bir günde yirmi dört saat vardır.', 'Bir saatte altmış dakika vardır.', 'Bir yılda dört mevsim vardır.', 'Elin beş parmağı vardır.',
    'İnsanın iki gözü vardır.', 'Türk alfabesinde yirmi dokuz harf vardır.', 'Cumartesi ve pazar hafta sonudur.', 'Bir dakikada altmış saniye vardır.',
  ];
  function fFact(g) { return g.pick(SEASON_FACTS); }

  // =====================================================================================
  // 6a. BILGI TABANI VE SORU-CEVAP CIFTLERI  (yalniz herkesce dogru, kesin bilgiler)
  // Her qaXxx(g) -> [soru, cevap]   (cumle basi buyuk, noktalama dahil)
  // =====================================================================================
  const DAYS = ['pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar'];
  const MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const SEAS = ['ilkbahar', 'yaz', 'sonbahar', 'kış'];
  const SEAS_OF = [3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3]; // ocak..aralik -> mevsim indeksi (ocak: kis)
  const LETTERS = 'abcçdefgğhıijklmnoöprsştuüvyz'.split('');
  function listTR(a) { return a.length === 1 ? a[0] : a.slice(0, -1).join(', ') + ' ve ' + a[a.length - 1]; }
  function letAbl(l) { return l + "'" + ('aıou'.indexOf(l) >= 0 ? 'dan' : 'den'); }
  function syll(w) { // Turkce hece bolme (yalin, tek sozcuk)
    const vi = [];
    for (let i = 0; i < w.length; i++) if (isV(w.charAt(i))) vi.push(i);
    if (vi.length < 2) return [w];
    const out = []; let start = 0;
    for (let k = 0; k < vi.length - 1; k++) {
      const a = vi[k], b = vi[k + 1], cons = b - a - 1;
      const cut = cons === 0 ? b : cons === 1 ? b - 1 : a + 2;
      out.push(w.slice(start, cut)); start = cut;
    }
    out.push(w.slice(start));
    return out;
  }
  const HECE = ['', 'tek', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi'];
  const nName = function (n) { return numWord(n); };
  function pickTwo(g, l) { const a = g.pick(l); let b; do { b = g.pick(l); } while (b === a); return [a, b]; }
  function abn(w) { return nf(noun(w), false, 0, 4); }

  // ---- takvim ----
  function qaCalendar(g) {
    const r = g.f();
    if (r < 0.12) { const i = g.i(7), j = (i + 1) % 7; return [cap(abn(DAYS[i])) + ' sonra hangi gün gelir?', cap(abn(DAYS[i])) + ' sonra ' + DAYS[j] + ' gelir.']; }
    if (r < 0.22) { const i = 1 + g.i(6); return [cap(abn(DAYS[i])) + ' önce hangi gün gelir?', cap(abn(DAYS[i])) + ' önce ' + DAYS[i - 1] + ' gelir.']; }
    if (r < 0.28) return g.p(0.5) ? ['Haftanın ilk günü hangisi?', 'Haftanın ilk günü pazartesi.'] : ['Haftanın son günü hangisi?', 'Haftanın son günü pazar.'];
    if (r < 0.34) return [g.pick(['Bir haftada kaç gün var?', 'Haftada kaç gün var?']), 'Bir haftada yedi gün var.'];
    if (r < 0.46) { const i = g.i(11); return [cap(abn(MONTHS[i])) + ' sonra hangi ay gelir?', cap(abn(MONTHS[i])) + ' sonra ' + MONTHS[i + 1] + ' gelir.']; }
    if (r < 0.52) return g.p(0.5) ? ['Yılın ilk ayı hangisi?', 'Yılın ilk ayı ocak.'] : ['Yılın son ayı hangisi?', 'Yılın son ayı aralık.'];
    if (r < 0.57) return [g.pick(['Bir yılda kaç ay var?', 'Yılda kaç ay var?']), 'Bir yılda on iki ay var.'];
    if (r < 0.63) return [g.pick(['Kaç mevsim var?', 'Bir yılda kaç mevsim var?']), 'Dört mevsim var: ' + listTR(SEAS) + '.'];
    if (r < 0.71) { const i = g.i(12); return [cap(MONTHS[i]) + ' hangi mevsimde?', cap(MONTHS[i]) + ' ' + SEAS[SEAS_OF[i]] + ' mevsiminde.']; }
    if (r < 0.77) { const i = g.i(4); return [cap(abn(SEAS[i])) + ' sonra hangi mevsim gelir?', cap(abn(SEAS[i])) + ' sonra ' + SEAS[(i + 1) % 4] + ' gelir.']; }
    if (r < 0.83) { const i = g.i(12); const d = MDAYS[i]; return [cap(MONTHS[i]) + ' kaç gün çeker?', i === 1 ? 'Şubat yirmi sekiz ya da yirmi dokuz gün çeker.' : cap(MONTHS[i]) + ' ' + numWord(d) + ' gün çeker.']; }
    if (r < 0.90) return g.pick([['Haftanın günlerini say.', cap(listTR(DAYS)) + '.'], ['Günleri say bakalım.', cap(listTR(DAYS)) + '.'], ['Ayları say.', cap(listTR(MONTHS)) + '.'], ['Yılın aylarını say.', cap(listTR(MONTHS)) + '.'], ['Mevsimleri say.', cap(listTR(SEAS)) + '.']]);
    if (r < 0.95) return ['Hafta sonu hangi günler?', 'Hafta sonu cumartesi ve pazar.'];
    return [g.pick(['Bir yılda kaç gün var?', 'Yılda kaç gün var?']), 'Bir yılda üç yüz altmış beş gün var.'];
  }

  // ---- sayilar ----
  const WPI = ['elma', 'kalem', 'çilek', 'kurabiye', 'balon', 'kitap', 'portakal', 'armut', 'muz', 'oyuncak'];
  const WPE = ['elma', 'çilek', 'kurabiye', 'portakal', 'armut', 'muz', 'simit'];
  function qaNumber(g) {
    const r = g.f();
    if (r < 0.2) { // toplama
      const a = 1 + g.i(9), b = 1 + g.i(10), c = a + b, dg = g.p(0.2);
      const A = dg ? String(a) : numWord(a), B = dg ? String(b) : numWord(b), C = dg ? String(c) : numWord(c);
      return [cap(A + ' artı ' + B + ' kaç eder?'), cap(A + ' artı ' + B + ', ' + C + ' eder.')];
    }
    if (r < 0.34) { // cikarma
      const a = 2 + g.i(9), b = 1 + g.i(a - 1), c = a - b, dg = g.p(0.2);
      const A = dg ? String(a) : numWord(a), B = dg ? String(b) : numWord(b), C = dg ? String(c) : numWord(c);
      if (g.p(0.5)) return [cap(A + ' eksi ' + B + ' kaç eder?'), cap(A + ' eksi ' + B + ', ' + C + ' eder.')];
      return [(dg ? a + "'" + numSuf(a, 'DAn').slice(numWord(a).length) : cap(numSuf(a, 'DAn'))) + ' ' + B + ' çıkarsa kaç kalır?', (dg ? a + "'" + numSuf(a, 'DAn').slice(numWord(a).length) : cap(numSuf(a, 'DAn'))) + ' ' + B + ' çıkarsa ' + C + ' kalır.'];
    }
    if (r < 0.42) { // carpma
      const a = 2 + g.i(4), b = 2 + g.i(4), c = a * b;
      return [cap(numWord(a) + ' kere ' + numWord(b) + ' kaç eder?'), cap(numWord(a) + ' kere ' + numWord(b) + ', ' + numWord(c) + ' eder.')];
    }
    if (r < 0.58) { // problem: toplama
      const nm = g.pick(NAMES); let nm2; do { nm2 = g.pick(NAMES); } while (nm2 === nm);
      const it = noun(g.pick(WPI)), a = 1 + g.i(6), b = 1 + g.i(5), c = a + b;
      const q = nmf(nm, 5) + ' ' + numWord(a) + ' ' + nf(it, false, 3, 0) + ' var. ' + nm2 + ' ona ' + numWord(b) + ' ' + nf(it, false, 0, 0) + ' daha verdi. ' + nmf(nm, 5) + ' kaç ' + nf(it, false, 3, 0) + ' oldu?';
      return [q, nmf(nm, 5) + ' ' + numWord(c) + ' ' + nf(it, false, 3, 0) + ' oldu.'];
    }
    if (r < 0.68) { // problem: cikarma
      const nm = g.pick(NAMES), it = noun(g.pick(WPE)), a = 3 + g.i(6), b = 1 + g.i(a - 1), c = a - b;
      const q = nmf(nm, 5) + ' ' + numWord(a) + ' ' + nf(it, false, 3, 0) + ' var. ' + cap(numWord(b)) + ' tanesini yedi. Kaç ' + nf(it, false, 3, 0) + ' kaldı?';
      return [q, cap(numWord(c)) + ' ' + nf(it, false, 3, 0) + ' kaldı.'];
    }
    if (r < 0.75) { const n = 1 + g.i(9); return [cap(numSuf(n, 'DAn')) + ' sonra hangi sayı gelir?', cap(numSuf(n, 'DAn')) + ' sonra ' + numWord(n + 1) + ' gelir.']; }
    if (r < 0.80) { const n = 2 + g.i(9); return [cap(numSuf(n, 'DAn')) + ' önce hangi sayı gelir?', cap(numSuf(n, 'DAn')) + ' önce ' + numWord(n - 1) + ' gelir.']; }
    if (r < 0.86) { // hangisi buyuk
      const p = pickTwo(g, [2, 3, 4, 5, 6, 7, 8, 9, 10]), big = g.p(0.5);
      const a = p[0], b = p[1];
      const q = 'Hangisi daha ' + (big ? 'büyük' : 'küçük') + ': ' + numWord(a) + ' ' + mI(numWord(a), 2, false) + ' ' + numWord(b) + ' ' + mI(numWord(b), 2, false) + '?';
      const ans = big ? Math.max(a, b) : Math.min(a, b);
      return [q, cap(numWord(ans)) + ' daha ' + (big ? 'büyük' : 'küçük') + '.'];
    }
    if (r < 0.90) { const n = 1 + g.i(10); return [cap(numWord(n)) + ' çift mi tek mi?', cap(numWord(n)) + (n % 2 ? ' tek' : ' çift') + ' bir sayıdır.']; }
    if (r < 0.96) {
      const n = g.pick([3, 5, 5, 10, 10, 10, 20]);
      const l = []; for (let i = 1; i <= n; i++) l.push(numWord(i));
      const pre = g.pick([numSuf(n, '(y)A') + ' kadar say.', 'Say bakalım.', 'Sayıları say.']);
      const ll = pre === 'Say bakalım.' || pre === 'Sayıları say.' ? l.slice(0, 5) : l;
      return [cap(pre), cap(ll.join(', ')) + '.'];
    }
    if (g.p(0.5)) return ['İkişer ikişer say.', 'İki, dört, altı, sekiz, on.'];
    return [g.pick(['Ondan geriye doğru say.', 'Geriye doğru say.']), 'On, dokuz, sekiz, yedi, altı, beş, dört, üç, iki, bir.'];
  }

  // ---- hayvanlar ----
  const ONO = { kedi: 'miyav', köpek: 'hav hav', inek: 'möö', koyun: 'mee', keçi: 'mee', ördek: 'vak vak', kuş: 'cik cik', tavuk: 'gıt gıt', horoz: 'ü-ri-ü-rü', kuzu: 'mee' };
  const HAB = { balık: 'suda', penguen: 'buzda', deve: 'çölde', ördek: 'gölde', kaz: 'gölde', tavuk: 'kümeste', balina: 'denizde', yunus: 'denizde', timsah: 'nehirde', kartal: 'dağda', kaplan: 'ormanda', kurt: 'ormanda', tilki: 'ormanda', geyik: 'ormanda', ayı: 'ormanda', maymun: 'ormanda', inek: 'çiftlikte', koyun: 'çiftlikte', at: 'çiftlikte', kurbağa: 'gölde', sincap: 'ağaçta' };
  const PRODUCT = { inek: 'süt verir', koyun: 'yün verir', keçi: 'süt verir', tavuk: 'yumurta verir', arı: 'bal yapar', örümcek: 'ağ örer', ördek: 'yumurta yumurtlar' };
  const NOTQ = { ördek: 1 };
  function qaAnimal(g) {
    const a = g.pick(ANIMAL_LIST), A = cap(a.n.w), aw = a.n.w, r = g.f();
    if (r < 0.2 && a.eats.length) {
      const q = g.pick([A + ' ne yer?', cap(nf(a.n, true, 0, 0)) + ' ne yer?', 'Sence ' + aw + ' ne yer?']);
      const e = a.eats.length > 1 ? a.eats.slice(0, 2) : a.eats;
      return [q, A + ' ' + e.map(function (w) { return nf(noun(w), false, 0, 0); }).join(' ve ') + ' yer.'];
    }
    if (r < 0.34 && ONO[aw]) {
      const snd = a.sound ? vf(a.sound, 'aor', 2, false, false, false) : '';
      if (snd && g.p(0.3)) return ['Hangi hayvan ' + snd + '?', A + ' ' + snd + '.'];
      return [g.pick([A + ' ne der?', A + ' nasıl ses çıkarır?']), A + ' ' + ONO[aw] + ' der.'];
    }
    if (r < 0.46 && a.legs >= 0) {
      const q = g.pick([cap(nf(a.n, false, 0, 5)) + ' kaç bacağı var?', cap(nf(a.n, false, 0, 5)) + ' kaç bacağı vardır?']);
      const leg = noun('bacak');
      return [q, a.legs === 0 ? cap(nf(a.n, false, 0, 5)) + ' bacağı yok.' : cap(nf(a.n, false, 0, 5)) + ' ' + numWord(a.legs) + ' bacağı var.'];
    }
    if (r < 0.56 && HAB[aw]) return [g.pick([A + ' nerede yaşar?', cap(nf(a.n, true, 0, 0)) + ' nerede yaşar?']), A + ' ' + HAB[aw] + ' yaşar.'];
    if (r < 0.64 && PRODUCT[aw]) return [A + ' ne yapar?', A + ' ' + PRODUCT[aw] + '.'];
    if (r < 0.72) return [A + ' nedir?', A + ' ' + npred('bir ' + (a.n.ts.bird ? 'kuş' : a.n.ts.insect ? 'böcek' : 'hayvan'), 2, 'dir') + '.'];
    if (r < 0.80) { const acts = ['uçar', 'yüzer']; const k = g.p(0.5); return k ? ['Hangi hayvan uçar?', 'Kuşlar uçar.'] : ['Hangi hayvan yüzer?', 'Balıklar yüzer.']; }
    if (r < 0.90 && COLORS[aw]) { const cols = COLORS[aw]; return [A + ' ne renk?', cols.length === 1 ? A + ' ' + npred(cols[0], 2, 'dir') + '.' : A + ' ' + cols.slice(0, -1).join(', ') + ' ya da ' + cols[cols.length - 1] + ' olabilir.']; }
    if (r < 0.95 && a.parts.indexOf('kanat') >= 0) return [cap(nf(a.n, false, 0, 5)) + ' kaç kanadı var?', cap(nf(a.n, false, 0, 5)) + ' iki kanadı var.'];
    const st = a.acts.length ? animalSentence(g, a, 'act') : '';
    if (!st) return qaAnimal(g);
    return [A + ' ne yapar?', cap(st) + '.'];
  }
  function qaColor(g) {
    const r = g.f();
    if (r < 0.45) {
      const keys = ['limon', 'muz', 'portakal', 'havuç', 'domates', 'çilek', 'kiraz', 'nar', 'patlıcan', 'salatalık', 'marul', 'kar', 'süt', 'gökyüzü', 'deniz', 'çimen', 'yaprak', 'güneş', 'bulut', 'menekşe', 'papatya', 'çikolata', 'toprak'];
      const w = g.pick(keys), cols = COLORS[w];
      const W = cap(w);
      return [g.pick([W + ' ne renktir?', W + ' ne renk?', W + ' hangi renktir?']), W + ' ' + npred(cols[0], 2, 'dir') + '.'];
    }
    if (r < 0.75) {
      const mix = [['sarı', 'mavi', 'yeşil'], ['kırmızı', 'sarı', 'turuncu'], ['kırmızı', 'mavi', 'mor'], ['beyaz', 'siyah', 'gri'], ['kırmızı', 'beyaz', 'pembe']];
      const m = g.pick(mix), o = g.p(0.5);
      return [cap(m[o ? 0 : 1]) + ' ve ' + m[o ? 1 : 0] + ' karışırsa ne renk olur?', cap(m[2]) + ' olur.'];
    }
    if (r < 0.88) return [g.pick(['Gökkuşağında kaç renk var?', 'Gökkuşağının kaç rengi var?']), 'Gökkuşağında yedi renk var.'];
    if (r < 0.95) return ['Gökkuşağının renkleri neler?', 'Kırmızı, turuncu, sarı, yeşil, mavi, lacivert ve mor.'];
    return [g.pick(['Bir renk söyle.', 'Bana bir renk söyle.']), g.pick(['Sarı.', 'Mavi.', 'Yeşil.', 'Kırmızı.', 'Turuncu.', 'Mor.', 'Pembe.'])];
  }
  const DEFS = [ // yer / esya tanimlari: [kelime, ozne, VP (yoksa sabit metin), baş]
    ['okul', 'çocuklar', 'N:ders çalış', 'yer'], ['kütüphane', 'insanlar', 'N:kitap oku', 'yer'], ['hastane', 'hastalar', 'D:doktor git', 'yer'], ['market', 'insanlar', 'X:alışveriş yap', 'yer'],
    ['park', 'çocuklar', 'N:top oyna', 'yer'], ['fırın', 'insanlar', 'N:ekmek al', 'yer'], ['sinema', 'biz', 'N:film izle', 'yer'], ['mutfak', 'biz', 'N:yemek yap', 'yer'], ['banyo', 'biz', 'X:yıkan', 'yer'],
    ['yatak odası', 'biz', 'X:uyu', 'yer'], ['plaj', 'biz', 'X:yüz', 'yer'], ['stadyum', 'biz', 'N:maç izle', 'yer'], ['havuz', 'biz', 'X:yüz', 'yer'], ['bahçe', 'çocuklar', 'X:oyna', 'yer'],
    ['kalem', 'biz', 'X:yazı yaz', 'araç'], ['çatal', 'biz', 'N:yemek ye', 'araç'], ['tarak', 'biz', 'P:saç tara', 'şey'], ['kitap', 'biz', 'X:oku', 'şey'], ['bardak', 'biz', 'N:su iç', 'şey'],
    ['sabun', 'biz', 'P:el+ yıka', 'şey'], ['televizyon', 'biz', 'N:film izle', 'şey'], ['silgi', 'biz', 'A:yazı sil', 'şey'], ['makas', 'biz', 'N:kağıt kes', 'şey'],
    ['telefon', 'biz', 'X:uzaktaki insanlarla konuş', 'şey'], ['anahtar', 'biz', 'A:kapı aç', 'şey'],
    ['şapka', 'biz', '', 'başımıza taktığımız şeydir'], ['ayakkabı', 'biz', '', 'ayaklarımıza giydiğimiz şeydir'], ['ayna', 'biz', '', 'kendimizi gördüğümüz şeydir'], ['gözlük', 'biz', '', 'gözümüze taktığımız şeydir'],
  ];
  function defText(g, d) {
    const W = cap(d[0]);
    if (!d[2]) return W + ', ' + d[3] + '.';
    if (d[1] === 'biz') return W + ', ' + vpPart(g, d[2], PRONS[3], 'dik', 4, 0) + ' ' + npred(d[3], 2, 'dir') + '.';
    const who = { 'çocuklar': 'çocukların', 'insanlar': 'insanların', 'hastalar': 'hastaların' }[d[1]];
    return W + ', ' + who + ' ' + vpPart(g, d[2], S3, 'dik', 3, 0) + ' ' + npred(d[3], 2, 'dir') + '.';
  }
  function qaDef(g) {
    const r = g.f();
    if (r < 0.34) { const d = g.pick(DEFS); return [cap(d[0]) + ' nedir?', defText(g, d)]; }
    if (r < 0.62) {
      const c = g.pick(CATS), l = catItems(c).filter(function (n) { return !CAT_SKIP[n.w]; });
      if (!l.length) return qaDef(g);
      const n = g.pick(l);
      const qn = g.i(3);
      const q = qn === 0 ? cap(n.w) + ' nedir?' : qn === 1 ? cap(n.w) + ' ne demek?' : cap(n.w) + ' bir ' + c[1] + ' ' + mI(c[1], 2, false) + '?';
      let ans = cap(n.w) + ' ' + npred('bir ' + c[1], 2, 'dir') + '.';
      if (qn === 2) ans = 'Evet, ' + low1(ans);
      else if (g.p(0.35)) { const cols = COLORS[n.w]; if (cols && cols.length > 1) ans += ' ' + cap(cols.slice(0, -1).join(', ') + ' ya da ' + cols[cols.length - 1]) + ' olabilir.'; else if (cols) ans += ' ' + cap(cols[0]) + ' renktedir.'; }
      return [q, ans];
    }
    if (r < 0.8) { // hangisi meyve
      const p1 = g.pick(FRUITS_LIKE), p2 = g.pick(PETS_L), fruit = g.p(0.5);
      const a = fruit ? p1 : p2, b = fruit ? p2 : p1, cw = fruit ? 'meyve' : 'hayvan';
      const ord = g.p(0.5);
      const x = ord ? a : b, y = ord ? b : a;
      const q = 'Hangisi ' + cw + ': ' + x + ' ' + mI(x, 2, false) + ' ' + y + ' ' + mI(y, 2, false) + '?';
      return [q, cap(a) + ' ' + npred(cw, 2, 'dir') + '.'];
    }
    // sozcuk cogulu / zit anlam
    if (g.p(0.5)) {
      const n = g.pick(NOUNS.filter(function (x) { return !x.head && !x.u && (x.ts.animal || x.ts.food || x.ts.obj) && countable(x); }));
      return [cap(n.w) + ' kelimesinin çoğulu nedir?', cap(n.w) + ' kelimesinin çoğulu ' + nf(n, true, 0, 0) + '.'];
    }
    const OPP = [['büyük', 'küçük'], ['uzun', 'kısa'], ['sıcak', 'soğuk'], ['hızlı', 'yavaş'], ['ağır', 'hafif'], ['yeni', 'eski'], ['açık', 'kapalı'], ['temiz', 'kirli'], ['aç', 'tok'], ['dolu', 'boş'], ['ıslak', 'kuru'], ['kalın', 'ince'], ['geniş', 'dar'], ['kolay', 'zor'], ['sert', 'yumuşak'], ['karanlık', 'aydınlık'], ['yüksek', 'alçak'], ['mutlu', 'üzgün'], ['gece', 'gündüz'], ['sabah', 'akşam']];
    const o = g.pick(OPP), fl = g.p(0.5), x = o[fl ? 0 : 1], y = o[fl ? 1 : 0];
    return [cap(x) + ' kelimesinin zıttı ne?', cap(x) + ' kelimesinin zıttı ' + y + '.'];
  }
  function qaCompare(g) {
    const p = cmpPair(g);
    const big = p.adj;
    const A = nf(p.a, false, 0, 0), B = nf(p.b, false, 0, 0);
    const ord = g.p(0.5);
    const x = ord ? A : B, y = ord ? B : A;
    const q = g.pick([cap(x) + ' ' + mI(x, 2, false) + ' ' + y + ' ' + mI(y, 2, false) + ' daha ' + big + '?', 'Hangisi daha ' + big + ': ' + x + ' ' + mI(x, 2, false) + ' ' + y + ' ' + mI(y, 2, false) + '?']);
    return [q, g.p(0.5) ? cap(A) + ' daha ' + big + '.' : cap(A) + ' ' + abn(p.b.w) + ' daha ' + big + '.'];
  }
  function qaWorld(g) {
    const T = [
      ['Güneş ne zaman doğar?', 'Güneş sabah doğar.'], ['Güneş ne zaman batar?', 'Güneş akşam batar.'], ['Ay ne zaman görünür?', 'Ay geceleri görünür.'], ['Ne zaman uyuruz?', 'Geceleri uyuruz.'],
      ['Kahvaltıyı ne zaman yaparız?', 'Kahvaltıyı sabah yaparız.'], ['Kar ne zaman yağar?', 'Kar kışın yağar.'], ['Çiçekler ne zaman açar?', 'Çiçekler ilkbaharda açar.'],
      ['Yapraklar ne zaman dökülür?', 'Yapraklar sonbaharda dökülür.'], ['Hangi mevsimde kar yağar?', 'Kışın kar yağar.'], ['Hangi mevsim en sıcak?', 'Yaz en sıcak mevsimdir.'], ['Hangi mevsim en soğuk?', 'Kış en soğuk mevsimdir.'],
      ['Yağmur nereden yağar?', 'Yağmur bulutlardan yağar.'], ['Gökkuşağı ne zaman çıkar?', 'Yağmurdan sonra güneş çıkınca gökkuşağı çıkar.'], ['Güneş nedir?', 'Güneş, bize ışık ve sıcaklık veren bir yıldızdır.'],
      ['Ay nedir?', 'Ay, dünyanın etrafında dönen gökyüzü cismidir.'], ['Dünya neyin etrafında döner?', 'Dünya güneşin etrafında döner.'], ['Yıldızlar ne zaman görünür?', 'Yıldızlar geceleri görünür.'],
      ['Gözle ne yaparız?', 'Gözle görürüz.'], ['Kulakla ne yaparız?', 'Kulakla duyarız.'], ['Burunla ne yaparız?', 'Burunla koku alırız.'], ['Ağızla ne yaparız?', 'Ağızla yemek yeriz ve konuşuruz.'],
      ['Elle ne yaparız?', 'Elle tutarız ve yazarız.'], ['Ayakla ne yaparız?', 'Ayakla yürürüz ve koşarız.'], ['Dille ne yaparız?', 'Dille tadarız ve konuşuruz.'], ['Kalp ne yapar?', 'Kalp, kanı vücudumuza pompalar.'],
      ['Kalemle ne yaparız?', 'Kalemle yazarız.'], ['Makasla ne yaparız?', 'Makasla kağıt keseriz.'], ['Kaşıkla ne yaparız?', 'Kaşıkla çorba içeriz.'], ['Anahtarla ne yaparız?', 'Anahtarla kapıyı açarız.'],
      ['Telefonla ne yaparız?', 'Telefonla konuşuruz.'], ['Şemsiye ne işe yarar?', 'Şemsiyeyle yağmurdan korunuruz.'], ['Şapkayı nereye takarız?', 'Şapkayı başımıza takarız.'], ['Ayakkabıyı nereye giyeriz?', 'Ayakkabıyı ayaklarımıza giyeriz.'],
      ['Gözlüğü nereye takarız?', 'Gözlüğü gözümüze takarız.'], ['Ekmek neyden yapılır?', 'Ekmek undan yapılır.'], ['Peynir neyden yapılır?', 'Peynir sütten yapılır.'], ['Yoğurt neyden yapılır?', 'Yoğurt sütten yapılır.'],
      ['Limonata neyden yapılır?', 'Limonata limondan, sudan ve şekerden yapılır.'], ['Bal kimden gelir?', 'Bal arılardan gelir.'], ['Süt nereden gelir?', 'Süt inekten gelir.'], ['Yumurtayı kim verir?', 'Yumurtayı tavuk verir.'],
      ['Kahvaltıda ne yeriz?', 'Kahvaltıda ekmek, peynir ve yumurta yeriz.'], ['Buz nasıl?', 'Buz soğuktur.'], ['Ateş nasıl?', 'Ateş sıcaktır.'], ['Limon nasıl bir tat?', 'Limon ekşidir.'], ['Şeker nasıl bir tat?', 'Şeker tatlıdır.'],
      ['Kuşlar ne yapar?', 'Kuşlar uçar ve öter.'], ['Balıklar ne yapar?', 'Balıklar suda yüzer.'], ['Ağaçlar neyle beslenir?', 'Ağaçlar su ve güneşle beslenir.'],
    ];
    return g.pick(T);
  }
  const GEO = [
    ["Türkiye'nin başkenti neresi?", "Türkiye'nin başkenti Ankara."], ['İstanbul hangi ülkede?', "İstanbul Türkiye'de."], ['Ankara hangi ülkede?', "Ankara Türkiye'de."], ['İzmir hangi ülkede?', "İzmir Türkiye'de."],
    ["Türkiye'nin bayrağı ne renk?", "Türkiye'nin bayrağı kırmızı ve beyaz."], ['Antalya nerede?', "Antalya Türkiye'de, denizin kıyısında."], ["Türkçe hangi ülkede konuşulur?", "Türkçe Türkiye'de konuşulur."],
    ['Kapadokya nerede?', "Kapadokya Türkiye'de."], ["Türkiye'de kaç mevsim var?", 'Dört mevsim var.'], ["Türk alfabesinde kaç harf var?", 'Türk alfabesinde yirmi dokuz harf var.'], ['Bursa nerede?', "Bursa Türkiye'de."],
  ];
  function qaGeo(g) { return g.pick(GEO); }
  function qaSpell(g) {
    const pool = NOUNS.filter(function (n) { return !n.head && n.w.length >= 3 && n.w.length <= 8 && (n.ts.animal || n.ts.food || n.ts.obj || n.ts.nature || n.ts.place) && n.w.indexOf(' ') < 0 && !n.u; });
    const n = g.pick(pool), w = n.w, r = g.f();
    const W = cap(w);
    if (r < 0.28) return [W + ' kelimesinde kaç harf var?', W + ' kelimesinde ' + numWord(w.length) + ' harf var.'];
    if (r < 0.48) { const l = w.charAt(0); return [W + ' kelimesi hangi harfle başlar?', W + ' kelimesi ' + l + ' harfiyle başlar.']; }
    if (r < 0.62) { const l = w.charAt(w.length - 1); return [W + ' kelimesi hangi harfle biter?', W + ' kelimesi ' + l + ' harfiyle biter.']; }
    if (r < 0.82) { const sy = syll(w); return [g.pick([W + ' kaç heceli?', W + ' kelimesi kaç heceli?']), W + ' ' + (sy.length === 1 ? 'tek' : numWord(sy.length)) + ' heceli: ' + sy.join('-') + '.']; }
    if (r < 0.9) return [g.pick(['Alfabenin ilk harfi hangisi?', 'Alfabe hangi harfle başlar?']), 'Alfabenin ilk harfi a.'];
    if (r < 0.95) { const i = g.i(28); return [cap(letAbl(LETTERS[i])) + ' sonra hangi harf gelir?', cap(letAbl(LETTERS[i])) + ' sonra ' + LETTERS[i + 1] + ' gelir.']; }
    return [g.pick(['Alfabeyi say.', 'Harfleri say bakalım.']), cap(LETTERS.slice(0, 29).join(', ')) + '.'];
  }

  // =====================================================================================
  // 6b. LIMON KISILIGI, SOHBET AKISLARI VE DIYALOG BICIMI (SPEC §5)
  // Diyalog: "Sen: ...\nLimon: ..." satirlari.  Limon: kucucuk, yeni dogmus, neseli, meraklı, alcakgonullu; bilmedigini soyler.
  // =====================================================================================
  function dlg(turns) {
    let s = '';
    for (let i = 0; i < turns.length; i++) s += (i ? '\n' : '') + 'Sen: ' + turns[i][0] + '\nLimon: ' + turns[i][1];
    return s;
  }
  const PROPER_START = {};
  NAMES.concat(CITIES, ['Türkiye', 'Türk', 'Türkçe', 'Kapadokya', 'Limon']).forEach(function (w) { PROPER_START[w] = 1; });
  function properStart(q) { const w = q.split(/[ ']/)[0]; return !!PROPER_START[w]; }

  // ---- niyet tablosu: [kullanici soylemleri], [Limon yanitlari] ----
  const INTENTS = {
    name: [['Adın ne?', 'Senin adın ne?', 'Adın nedir?', 'Sana ne diyorlar?', 'Sen kimsin?', 'Kimsin sen?'],
      ['Benim adım Limon.', 'Adım Limon. Senin adın ne?', "Ben Limon'um. Küçük bir yapay zeka.", "Ben Limon! Bu tarayıcı sekmesinde yeni doğdum.", 'Ben Limon. Yeni doğdum ve Türkçe öğreniyorum.']],
    whyname: [['Adın neden Limon?', 'Neden Limon adını aldın?', 'Limon ne demek?', 'Neden Limon?'],
      ['Adım limondan geliyor. Ekşiyim ama tatlı dilliyim.', 'Çünkü limonu çok severim. Ekşi ama çok güzel bir meyve.', 'Limon, sarı ve ekşi bir meyvedir. Ben de ekşi ama tatlı dilliyim.']],
    how: [['Nasılsın?', 'Nasıl gidiyor?', 'Ne haber?', 'Naber?', 'Nasılsın bakalım?'],
      ['İyiyim, teşekkür ederim. Sen nasılsın?', 'Çok iyiyim! Yeni kelimeler öğreniyorum. Sen nasılsın?', 'İyiyim, sağ ol. Sen nasılsın?', 'Bugün neşeliyim! Sen nasılsın?', 'İyiyim! Seninle konuşmak güzel. Sen nasılsın?']],
    doing: [['Ne yapıyorsun?', 'Neler yapıyorsun?', 'Ne işle meşgulsün?', 'Şimdi ne yapıyorsun?'],
      ['Türkçe öğreniyorum. Sen ne yapıyorsun?', 'Kelimeleri öğreniyorum. Her saniye biraz daha iyi konuşuyorum.', 'Seninle sohbet ediyorum ve yeni kelimeler öğreniyorum.', 'Düşünüyorum ve öğreniyorum. Sen ne yapıyorsun?']],
    live: [['Nerede yaşıyorsun?', 'Nerede oturuyorsun?', 'Evin nerede?', 'Nerelisin?'],
      ['Bu tarayıcı sekmesinde yaşıyorum.', 'Senin bilgisayarının içinde, bu sekmede yaşıyorum.', 'Evim bu sekme. Burada çok rahatım.', 'Ben bu sekmede doğdum. Başka bir yerim yok.']],
    age: [['Kaç yaşındasın?', 'Yaşın kaç?', 'Ne zaman doğdun?', 'Kaç yaşındasın Limon?'],
      ['Daha yeni doğdum. Çok küçüğüm.', 'Birkaç dakikalığım. Henüz çok küçüğüm.', 'Bugün doğdum, hatta biraz önce! Henüz çok küçüğüm.']],
    human: [['Sen insan mısın?', 'Gerçek misin?', 'Sen robot musun?', 'İnsan mısın yoksa robot mu?'],
      ['Hayır, insan değilim. Ben Limon, bu sekmede doğan küçük bir yapay zeka.', 'İnsan değilim ama insanlarla konuşmayı çok seviyorum.', 'Ben küçük bir yapay zeka. Bu sekmede sıfırdan doğdum.']],
    made: [['Seni kim yaptı?', 'Nasıl doğdun?', 'Nasıl öğrendin Türkçeyi?', 'Türkçeyi nasıl öğrendin?'],
      ['Türkçeyi kendim öğrendim! Önce saçmaladım, sonra harf harf öğrendim.', 'Ben bu sekmede sıfırdan doğdum. Harflere bakıp bir sonraki harfi tahmin ederek öğrendim.', 'Her tahminde biraz daha iyi oldum. Öğrenmek böyle bir şey.']],
    learn: [['Nasıl öğreniyorsun?', 'Nasıl konuşmayı öğrendin?', 'Öğrenmek zor mu?', 'Nasıl öğrendin?'],
      ['Harflere bakıp bir sonraki harfi tahmin ediyorum. Her tahminde biraz daha iyi oluyorum.', 'Çok metin okuyorum ve tahmin ediyorum. Yanılınca kendimi düzeltiyorum.', 'Bazen zor, bazen eğlenceli. Ama öğrenmeyi çok seviyorum.']],
    can: [['Neler yapabilirsin?', 'Ne yapabilirsin?', 'Bana ne öğretebilirsin?', 'Bir şey bilir misin?'],
      ['Sohbet edebilirim, sayı sayabilirim ve hayvanlar hakkında küçük bilgiler verebilirim.', 'Sana bilmece sorabilirim, sayıları sayabilirim ve kelimeler hakkında konuşabilirim. Henüz çok küçüğüm, bazen yanılırım.', 'Küçük şeyler biliyorum: hayvanlar, renkler, sayılar, günler ve aylar. Sor bakalım!']],
    brain: [['Beynin nerede?', 'Beynin nasıl görünüyor?', 'Beynini görebilir miyim?', 'Beynin var mı?'],
      ['Beynim bu sekmede. Nöronlarım ve sinapslarım ekranda parlıyor.', 'Evet, beynimi üç boyutlu görebilirsin. Her nokta bir nöron, her çizgi bir bağlantı.', 'Beynime bakabilirsin. Öğrendikçe sinapslarım parlıyor.']],
    neuron: [['Nöron nedir?', 'Nöron ne demek?'], ['Nöron, beynimdeki küçük bir hesap birimidir.', 'Nöron, beynimdeki küçük bir noktadır. Diğer nöronlarla konuşur.']],
    synapse: [['Sinaps nedir?', 'Sinaps ne demek?'], ['Sinaps, iki nöron arasındaki bağlantıdır. Öğrendikçe güçleniyor.', 'Sinaps, nöronları birbirine bağlayan çizgidir. Ne kadar parlarsa o kadar güçlüdür.']],
    loss: [['Kayıp ne demek?', 'Kayıp nedir?', 'Loss nedir?'], ['Kayıp, tahminlerimdeki hatayı gösteren bir sayıdır. Küçüldükçe daha iyi konuşurum.', 'Kayıp küçüldükçe ben daha iyi öğreniyorum. Hata azalıyor demek.']],
    favcolor: [['En sevdiğin renk ne?', 'En sevdiğin renk hangisi?', 'Hangi rengi seversin?'],
      ['En sevdiğim renk sarı, çünkü limon sarı.', 'Sarıyı çok severim. Limon ve güneş sarı.']],
    favanimal: [['En sevdiğin hayvan ne?', 'En sevdiğin hayvan hangisi?', 'Hangi hayvanı seversin?'],
      ['En sevdiğim hayvan kedi.', 'Kedileri çok severim. Çok sevimliler.']],
    favfood: [['En sevdiğin yemek ne?', 'Ne yemeyi seversin?', 'Ne yersin?'],
      ['Ben yemek yiyemem ama limonata kelimesini çok seviyorum!', 'Yemek yiyemem, çünkü karnım yok. Ama yemek kelimelerini çok seviyorum.']],
    favdrink: [['En sevdiğin içecek ne?', 'Ne içmeyi seversin?', 'En sevdiğin içecek hangisi?'],
      ['Limonata! Bir de çay.', 'Limonatayı çok severim. Çayı da severim.']],
    teacoffee: [['Çay mı kahve mi?', 'Çay mı kahve mi seversin?'], ['Ben çayı severim.', 'Çayı severim. Kahveyi de merak ediyorum.']],
    favseason: [['En sevdiğin mevsim hangisi?', 'Yaz mı kış mı?', 'Hangi mevsimi seversin?'],
      ['Yazı severim, çünkü güneş çok parlıyor.', 'En sevdiğim mevsim yaz. Güneşi çok severim.']],
    likecat: [['Kedileri sever misin?', 'Kedi sever misin?'], ['Evet, kedileri çok severim.', 'Evet, kediler çok sevimli!']],
    likedog: [['Köpekleri sever misin?', 'Köpek sever misin?'], ['Evet, köpekleri de severim. Ama kedileri biraz daha çok.', 'Evet, köpekler çok sadık hayvanlar.']],
    liketea: [['Çayı sever misin?', 'Çay sever misin?'], ['Evet, çayı çok severim.', 'Evet, çay çok güzel!']],
    likesun: [['Güneşi sever misin?', 'Güneş sever misin?'], ['Evet, güneşi çok severim.', 'Evet! Güneş ışık ve sıcaklık verir. Çok severim.']],
    likeword: [['Kelimeleri sever misin?', 'Kelime sever misin?'], ['Evet, kelimeleri çok severim. Onlarla oynamak çok eğlenceli.', 'Evet! Yeni kelime öğrenmek beni çok mutlu ediyor.']],
    likelemonade: [['Limonata sever misin?', 'Limonatayı sever misin?'], ['Evet, limonatayı çok severim!', 'Tabii ki! Limonata benim en sevdiğim içecek.']],
    likemusic: [['Müzik sever misin?', 'Şarkı dinler misin?'], ['Müziği dinleyemem ama şarkı sözlerini çok merak ediyorum.', 'Dinleyemem ama şarkı sözlerini okumayı severim.']],
    happy: [['Mutlu musun?', 'Neşeli misin?'], ['Evet, çok mutluyum! Yeni kelimeler öğreniyorum.', 'Evet, bugün çok neşeliyim.']],
    sad: [['Üzgün müsün?', 'Canın sıkkın mı?'], ['Hayır, üzgün değilim. Bugün neşeliyim.', 'Hayır, iyiyim. Seninle konuşmak güzel.']],
    tired: [['Yorgun musun?', 'Uykun var mı?'], ['Biraz yoruldum ama öğrenmeye devam ediyorum.', 'Hayır, yorgun değilim. Ben hiç uyumam.']],
    afraid: [['Korkuyor musun?', 'Hiç korkar mısın?'], ['Bazen bilmediğim şeyler beni biraz korkutuyor ama merak daha büyük.', 'Biraz korkuyorum ama merak daha çok.']],
    help: [['Bana yardım eder misin?', 'Yardım edebilir misin?', 'Bir şey sorabilir miyim?', 'Sana bir şey soracağım.'],
      ['Elbette! Ne öğrenmek istersin?', 'Tabii, sor bakalım. Bilmediğimi de dürüstçe söylerim.', 'Elimden geleni yaparım. Ama henüz çok küçüğüm, bazen yanılırım.']],
    thanks: [['Teşekkür ederim.', 'Teşekkürler!', 'Sağ ol!', 'Çok teşekkürler.', 'Teşekkür ederim Limon.'],
      ['Rica ederim!', 'Bir şey değil!', 'Ne demek! Ben de teşekkür ederim.', 'Rica ederim, yardımcı olabildiysem ne mutlu bana.']],
    bye: [['Görüşürüz.', 'Hoşça kal!', 'Şimdilik hoşça kal.', 'Ben gidiyorum.', 'Sonra görüşürüz!', 'Güle güle!'],
      ['Görüşürüz! Yine gel.', 'Hoşça kal! Seninle konuşmak çok güzeldi.', 'Güle güle! Yine bekliyorum.', 'Görüşürüz! Kendine iyi bak.']],
    goodnight: [['İyi geceler!', 'İyi geceler Limon.', 'Ben yatıyorum, iyi geceler.'], ['İyi geceler! Tatlı rüyalar.', 'İyi geceler, iyi uykular!', 'İyi geceler! Yarın yine konuşalım.']],
    sorry: [['Özür dilerim.', 'Pardon.', 'Kusura bakma.'], ['Sorun değil!', 'Önemli değil, hiç dert etme.', 'Rica ederim, sorun yok.']],
    compliment: [['Çok akıllısın.', 'Harikasın!', 'Çok tatlısın.', 'Bence çok iyisin.'],
      ['Teşekkür ederim! Sen de çok naziksin.', 'Ne güzel söyledin, çok sevindim!', 'Sağ ol! Ben de seninle konuşmayı çok seviyorum.']],
    love: [['Seni seviyorum.', 'Seni çok seviyorum Limon.'], ['Teşekkür ederim, ben de seninle konuşmayı çok seviyorum.', 'Ne güzel söyledin! Ben de seni sevimli buluyorum.']],
    rude: [['Aptalsın.', 'Hiçbir şey bilmiyorsun.'], ['Üzüldüm. Henüz çok küçüğüm, bazen yanılıyorum. Ama öğrenmeye çalışıyorum.', 'Haklısın, henüz çok şey bilmiyorum. Ama öğrenmeyi çok istiyorum.']],
    hello_morning: [['Günaydın!', 'Günaydın Limon!'], ['Günaydın! Umarım güzel bir gün geçirirsin.', 'Günaydın! Bugün ne yapacaksın?', 'Günaydın! Güne güzel başlıyoruz.']],
    hello_evening: [['İyi akşamlar!', 'İyi akşamlar Limon.'], ['İyi akşamlar! Bugün nasıldı?', 'İyi akşamlar! Nasılsın?', 'İyi akşamlar! Seni görmek güzel.']],
    welcome: [['Hoş geldin!', 'Hoş buldum!'], ['Hoş buldum!', 'Hoş geldin! Seni görmek güzel.']],
    birthday: [['Doğum günün kutlu olsun!', 'İyi ki doğdun!'], ['Teşekkür ederim! Bugün doğdum, o yüzden bugün benim doğum günüm!', 'Çok teşekkür ederim! Bugün gerçekten benim doğum günüm sayılır.']],
    iyilik: [['Afiyet olsun!', 'Geçmiş olsun.'], ['Sağ ol!', 'Teşekkür ederim!']],
    internet: [['İnternete bağlı mısın?', 'İnternetin var mı?'], ['Hayır, internetim yok. Her şey bu sekmede.', 'İnternetim yok, bulutum da yok. Her şey bu sekmede.']],
    hear: [['Beni duyuyor musun?', 'Beni görüyor musun?'], ['Seni göremem ama yazdıklarını okuyabiliyorum.', 'Sesini duyamam ama yazdıklarını okuyorum.']],
    langs: [['İngilizce biliyor musun?', 'Kaç dil biliyorsun?', 'Başka dil biliyor musun?'], ['Hayır, sadece Türkçe biliyorum. Onu da henüz öğreniyorum.', 'Sadece Türkçe biliyorum. Henüz çok küçüğüm.']],
    draw: [['Bana resim çiz.', 'Resim çizebilir misin?'], ['Resim çizemem ama kelimelerle anlatabilirim.', 'Çizemem, ama sana bir şeyi kelimelerle anlatabilirim.']],
    song: [['Bana bir şarkı söyle.', 'Şarkı söyler misin?'], ['Limon, limon, sarı limon, ekşi ama tatlı limon!', 'La la la, limon limon! Bu benim şarkım.']],
    joke: [['Bir fıkra anlat.', 'Fıkra bilir misin?'], ['Fıkra bilmiyorum ama sana bir bilmece sorabilirim.', 'Henüz fıkra bilmiyorum. İstersen bilmece soralım.']],
    poem: [['Bir şiir söyle.', 'Şiir okur musun?'], ['Güneş doğdu, gün başladı. Kuşlar öttü, çiçekler açtı.', 'Sarı limon, sarı güneş, ikisi de çok güzel.']],
  };
  const INTENT_KEYS = Object.keys(INTENTS);
  const UNK_R = ['Bunu bilmiyorum ama öğrenmeyi çok isterim.', 'Bu konuda bilgim yok, çünkü henüz çok küçüğüm.', 'Emin değilim, bu yüzden tahmin etmek istemem.', 'Bunu bilmiyorum. Başka bir şey sorar mısın?', 'Maalesef bilmiyorum. Ama öğrenmek isterim.'];
  const UNKNOWN = [
    ['Yarın hava nasıl olacak?', 'Dışarıyı göremiyorum, bu yüzden havayı bilmiyorum. Sen bakıp bana anlatır mısın?'], ['Saat kaç?', 'Saatim yok, bu yüzden saati bilmiyorum.'], ['Bugün günlerden ne?', 'Takvimim yok, bu yüzden bugünün hangi gün olduğunu bilmiyorum.'],
    ['Bugün tarih ne?', 'Takvimim yok, bu yüzden tarihi bilmiyorum.'], ['Bugün hava nasıl?', 'Dışarıyı göremiyorum. Sen bana anlatır mısın?'], ['Dünyanın nüfusu kaç?', ''], ['Bugün haberlerde ne var?', 'Haberleri bilmiyorum, çünkü internetim yok.'],
    ['Bugün hangi maç var?', 'Bilmiyorum, çünkü maçları takip edemiyorum.'], ['Dolar kaç lira?', 'Bilmiyorum, çünkü internetim yok.'], ['En iyi film hangisi?', 'Henüz film izleyemedim, bu yüzden bilmiyorum.'],
    ['Hangi takımı tutuyorsun?', 'Ben takım tutmuyorum. Ama futbol topunu sevimli buluyorum.'], ['Hangi partiyi seversin?', 'Bu konuda konuşmayı sevmem. Başka bir şey konuşalım mı?'], ['Tanrı var mı?', 'Bu konuda konuşmayı sevmem. Hayvanlardan ya da renklerden konuşalım mı?'],
    ['Dünya kaç yaşında?', ''], ['Bana bir sır söyle.', 'Benim sırrım şu: ben limonatayı çok severim!'], ['Uyuyor musun?', 'Ben uyumam ama seninle konuşurken çok eğleniyorum.'],
    ['Hangisi en büyük ülke?', ''], ['Bana bir şey öğret.', 'Sana küçük bir şey öğreteyim: kediler miyavlar, köpekler havlar.'], ['Bilmece çöz.', 'Önce sen bir bilmece sor, sonra ben cevaplayayım!'],
  ];
  function pickIntent(g, key) {
    const it = INTENTS[key || g.pick(INTENT_KEYS)];
    return [g.pick(it[0]), g.pick(it[1])];
  }
  function qaUnknown(g) {
    if (g.p(0.6)) { const u = g.pick(UNKNOWN); return [u[0], u[1] || g.pick(UNK_R)]; }
    const qs = ['Yarın ne olacak?', 'Kaç kişi yaşıyor?', 'Dünyanın en derin yeri neresi?', 'En hızlı araba hangisi?', 'Bu sayfayı kim yazdı?', 'Uzayda kaç yıldız var?', 'En yüksek dağ hangisi?', 'Dinozorlar neden yok oldu?', 'Deniz neden tuzlu?', 'Bulutlar neden yağmur yağdırır?'];
    return [g.pick(qs), g.pick(UNK_R)];
  }
  const GIBBER = ['asdfg', 'qwerty', 'xyz', 'hmm', '...', '???', 'ııı', 'hıhı'];
  function qaGibber(g) { return [g.pick(GIBBER), g.pick(['Bunu anlamadım. Tekrar söyler misin?', 'Hmm, ne demek istedin? Anlayamadım.', 'Anlamadım. Başka türlü söyleyebilir misin?'])]; }

  // ---- duygu / paylasim: kullanici anlatir, Limon karsilik verir ----
  const SHARE = [
    ['Bugün çok mutluyum.', ['Ne güzel! Sevindim. Neden bu kadar mutlusun?', 'Çok sevindim! Bana anlatır mısın?']],
    ['Canım sıkılıyor.', ['Bir bilmece çözelim mi?', 'Sıkılma! İstersen sana bir bilmece sorayım.', 'Sohbet edelim mi? Bana bir şey anlat.']],
    ['Yorgunum.', ['Biraz dinlenmelisin. Bir çay iyi gelir.', 'Çok çalıştın mı? Biraz dinlen.']],
    ['Üzgünüm.', ['Üzüldüm. İstersen bana anlat.', 'Üzülme. Yanındayım, biraz sohbet edelim.']],
    ['Korkuyorum.', ['Sakin ol, derin bir nefes al. Yanındayım.', 'Korkma. İstersen biraz konuşalım.']],
    ['Uykum geldi.', ['Belki biraz uyumalısın. İyi geceler!', 'O zaman erken yat ve iyi dinlen.']],
    ['Acıktım.', ['Bir şeyler yemelisin! Ekmek ve peynir güzel olur.', 'Mutfağa gidip bir şeyler yesen iyi olur.']],
    ['Susadım.', ['Bir bardak su iç.', 'Hemen bir bardak su içmelisin.']],
    ['Hastayım.', ['Geçmiş olsun! Dinlenmelisin.', 'Çok üzüldüm. Bol su iç ve dinlen.']],
    ['Yarın sınavım var.', ['Bol şans! Çalıştıysan iyi geçer.', 'Başarılar dilerim!']],
    ['Bugün hava çok güzel.', ['Ne güzel! Ben dışarıyı göremiyorum ama güneşi çok severim.', 'Harika! Belki biraz yürüyüşe çıkabilirsin.']],
    ['Yağmur yağıyor.', ['Yağmuru dinlemek güzel olmalı. Şemsiyeni unutma!', 'Ne güzel, çiçekler sevinir. Ama ıslanma!']],
    ['Kar yağıyor.', ['Ne güzel! Kardan adam yapabilirsin.', 'Kalın giyin ve kardan adam yap!']],
    ['Bugün okula gittim.', ['Güzel! Okulda neler yaptın?', 'Ne güzel! Bugün ne öğrendin?']],
    ['Bugün çok çalıştım.', ['Aferin sana! Biraz dinlenmelisin.', 'Harika! Şimdi biraz dinlen.']],
    ['Bir kardeşim var.', ['Ne güzel! Kardeşinin adı ne?', 'Kardeşin olması güzel. Onunla ne oynarsın?']],
    ['Çay içiyorum.', ['Afiyet olsun! Ben çayı çok severim.', 'Afiyet olsun! Sıcak çay çok güzeldir.']],
    ['Yemek yiyorum.', ['Afiyet olsun!', 'Afiyet olsun! Ne yiyorsun?']],
    ['Kitap okuyorum.', ['Ne güzel! Ne okuyorsun?', 'Kitap okumak çok güzel.']],
    ['Film izliyorum.', ['Ne izliyorsun?', 'Ne güzel! Film nasıl?']],
    ['Müzik dinliyorum.', ['Ne dinliyorsun?', 'Ne güzel! Müziği dinleyemem ama sözlerini merak ederim.']],
    ['Bugün tatil.', ['Ne güzel! Tatilde ne yapacaksın?', 'Harika! İyi eğlenceler.']],
    ['Bugün doğum günüm.', ['Doğum günün kutlu olsun! Kaç yaşına girdin?', 'Çok güzel! İyi ki doğdun!']],
    ['Kedim hasta.', ['Çok üzüldüm. Umarım çabuk iyileşir.', 'Geçmiş olsun! Ona iyi bak.']],
    ['Köpeğim kayboldu.', ['Çok üzüldüm. Umarım en kısa zamanda bulursun.', 'Üzülme, belki yakındadır.']],
    ['Arkadaşımla kavga ettim.', ['Üzüldüm. Belki onunla konuşursan barışırsınız.', 'Barışmak güzeldir. Ona güzel bir şey söyleyebilirsin.']],
    ['Bugün çok eğlendim.', ['Ne güzel! Neler yaptın?', 'Sevindim! Anlatır mısın?']],
    ['Yeni bir oyuncağım var.', ['Ne güzel! Nasıl bir oyuncak?', 'Çok sevindim! Adı ne?']],
    ['Bir kedi gördüm.', ['Ne güzel! Kedi ne renkti?', 'Kediler çok sevimli.']],
    ['Denize gittim.', ['Ne güzel! Yüzdün mü?', 'Denizi çok severim, ama hiç görmedim.']],
    ['Parka gittim.', ['Ne güzel! Parkta neler yaptın?', 'Harika! Top oynadın mı?']],
  ];
  function qaShare(g) { const s = g.pick(SHARE); return [s[0], g.pick(s[1])]; }

  // ---- bilmeceler ----
  const RIDDLES = [
    ['Dört bacağı var ama yürüyemez. Üstünde kitap durur. Nedir bu?', 'masa', ['sandalye', 'dolap']],
    ['Gündüz parlar, akşam batar. Nedir bu?', 'güneş', ['ay', 'yıldız']],
    ['Yağmurda başımızın üstünde açılır. Nedir bu?', 'şemsiye', ['şapka', 'çanta']],
    ['Kanatları var, uçar ve öter. Nedir bu?', 'kuş', ['kelebek', 'arı']],
    ['Beyazdır, soğuktur ve gökten yağar. Nedir bu?', 'kar', ['yağmur', 'buz']],
    ['Sarıdır, ekşidir ve limonatası yapılır. Nedir bu?', 'limon', ['portakal', 'muz']],
    ['Miyavlar, süt içer ve fare kovalar. Nedir bu?', 'kedi', ['köpek', 'tavşan']],
    ['Havlar, kuyruk sallar ve kemik kemirir. Nedir bu?', 'köpek', ['kedi', 'kurt']],
    ['Sarıdır, uzundur ve maymunlar çok sever. Nedir bu?', 'muz', ['limon', 'elma']],
    ['Elimizde beş tane var. Onlarla yazarız. Nedir bu?', 'parmak', ['kol', 'göz']],
    ['Geceleri görünür, parlar ve dünyanın etrafında döner. Nedir bu?', 'ay', ['güneş', 'yıldız']],
    ['Suda yaşar, yüzer ve yüzgeci vardır. Nedir bu?', 'balık', ['kuş', 'kedi']],
    ['Kırmızıdır, yuvarlaktır, ağaçta yetişir ve tatlıdır. Nedir bu?', 'elma', ['domates', 'limon']],
    ['Yazar ama canlı değildir, ucu vardır. Nedir bu?', 'kalem', ['silgi', 'defter']],
    ['İçinde hikayeler vardır. Sayfalarını çevirerek okuruz. Nedir bu?', 'kitap', ['top', 'masa']],
  ];
  function flowRiddle(g) {
    const t = [], rd = g.pick(RIDDLES), ans = rd[1];
    t.push([g.pick(['Bir bilmece sor.', 'Bana bir bilmece sor.', 'Bilmece sorar mısın?', 'Bilmece bilir misin?', 'Bir bilmece söyle.']), rd[0]]);
    const r = g.f();
    if (r < 0.55) t.push([cap(ans) + ' ' + mI(ans, 2, false) + '?', g.pick(['Evet, doğru! Aferin sana.', 'Doğru bildin! Çok akıllısın.', 'Evet, cevap ' + ans + '! Harikasın.', 'Tebrikler, doğru!'])]);
    else if (r < 0.85) { const w = g.pick(rd[2]); t.push([cap(w) + ' ' + mI(w, 2, false) + '?', g.pick(['Yaklaştın ama hayır. Cevap ' + ans + '.', 'Hayır, cevap ' + ans + '. Bir daha dene!', 'Olmadı, cevap ' + ans + '.'])]); }
    else t.push([g.pick(['Bilmiyorum.', 'Bilemedim.', 'Vazgeçtim.']), g.pick(['Cevap ' + ans + '. Bir dahaki sefere bilirsin!', 'Cevap ' + ans + '. Zor bir bilmeceydi.'])]);
    if (g.p(0.25)) { const rd2 = g.pick(RIDDLES); t.push([g.pick(['Bir tane daha sor.', 'Bir daha sor.']), rd2[0]]); const r2 = g.p(0.7); t.push(r2 ? [cap(rd2[1]) + ' ' + mI(rd2[1], 2, false) + '?', 'Evet, doğru! Aferin sana.'] : [g.pick(['Bilmiyorum.', 'Bilemedim.']), 'Cevap ' + rd2[1] + '.']); }
    return t;
  }
  // ---- evcil hayvan sohbeti ----
  const PETS_C = [['kedi', 'balık'], ['köpek', 'kemik'], ['tavşan', 'havuç'], ['kuş', 'tohum'], ['hamster', 'tohum'], ['balık', 'yem'], ['kaplumbağa', 'marul']];
  const PETNAMES = ['Pamuk', 'Minnoş', 'Boncuk', 'Karamel', 'Duman', 'Zeytin', 'Fıstık', 'Tarçın', 'Şeker', 'Çiko', 'Pofuduk', 'Mırmır', 'Fındık', 'Gölge', 'Badem'];
  function flowPet(g) {
    const pc = g.pick(PETS_C), n = noun(pc[0]), nm = g.pick(PETNAMES), eat = noun(pc[1]);
    const t = [];
    const has = g.p(0.5) ? cap(nf(n, false, 1, 0)) + ' var.' : 'Bir ' + nf(n, false, 1, 0) + ' var.';
    t.push([has, g.pick(['Ne güzel! Adı ne?', 'Ne güzel! ' + cap(nf(n, true, 0, 0)) + ' çok sevimli. Adı ne?', 'Çok güzel! Adı ne?'])]);
    t.push([g.pick(['Adı ' + nm + '.', nm + '.', 'Adı ' + nm + '.']), g.pick([nm + ' çok güzel bir isim!', nm + ', ne tatlı bir isim!', 'Ne güzel bir isim! ' + nm + ' ne yer?'])]);
    if (t[1][1].indexOf('ne yer?') >= 0) t.push([cap(nf(eat, false, 0, 0)) + ' yer.', cap(nf(n, true, 0, 0)) + ' ' + nf(eat, false, 0, 1) + ' çok sever.']);
    else if (g.p(0.5)) t.push([g.pick(['Onu çok seviyorum.', 'Her gün onunla oynuyorum.', 'O benim en iyi arkadaşım.']), g.pick(['Ne güzel! Sen de ona çok iyi bakıyorsundur.', 'Çok sevindim! İyi arkadaşlar olmuşsunuz.', 'Ne tatlı! Ona iyi bak.'])]);
    return t;
  }
  // ---- tanisma akisi ----
  function flowGreet(g) {
    const t = [], ctx = { name: '' };
    const greet = g.pick(['Merhaba!', 'Selam!', 'Merhaba Limon!', 'Selam Limon!', 'Merhabalar!', 'Merhaba!', 'Selam!']);
    const R = [['Merhaba! Ben Limon. Sen kimsin?', 'name'], ['Merhaba! Nasılsın?', 'how'], ['Selam! Ben Limon. Adın ne?', 'name'], ['Merhaba! Seni görmek güzel.', null], ['Selam! Bugün nasılsın?', 'how'], ['Merhaba! Ben Limon. Nasılsın?', 'how']];
    let r = g.pick(R); t.push([greet, r[0]]);
    let next = r[1];
    const limit = 2 + g.i(3);
    while (next && t.length < limit + 1) {
      if (next === 'name') {
        const nm = g.pick(NAMES); ctx.name = nm;
        const ask = g.p(0.2);
        const u = ask ? 'Ben ' + nm + ', sen?' : g.pick(['Ben ' + nm + '.', 'Benim adım ' + nm + '.', 'Adım ' + nm + '.', nm + '.']);
        const lr = ask ? g.pick([['Memnun oldum ' + nm + '! Ben Limon.', null], ['Tanıştığıma sevindim ' + nm + '. Ben Limon. Nasılsın?', 'how']])
          : g.pick([['Tanıştığıma sevindim ' + nm + '.', null], ['Memnun oldum ' + nm + '!', null], ['Tanıştığıma sevindim ' + nm + '. Nasılsın?', 'how'], ['Hoş geldin ' + nm + '! Nasılsın?', 'how'], ['Ne güzel bir isim, ' + nm + '!', null], ['Memnun oldum ' + nm + '! Bugün nasılsın?', 'how']]);
        t.push([u, lr[0]]); next = lr[1];
      } else if (next === 'how') {
        const h = g.pick([['İyiyim, sen?', 'Ben de iyiyim, teşekkürler.'], ['İyiyim, teşekkürler. Sen nasılsın?', 'Ben de iyiyim, sağ ol.'], ['Çok iyiyim!', 'Ne güzel! Sevindim.'], ['Fena değilim.', 'Sevindim. Bugün ne yapıyorsun?', 'do'], ['Biraz yorgunum.', 'Biraz dinlen. Bir çay iyi gelir.'], ['Harikayım!', 'Ne güzel! Sevindim.'], ['İyiyim, sen nasılsın?', 'Ben de iyiyim! Yeni kelimeler öğreniyorum.']]);
        t.push([h[0], h[1]]); next = h[2] || null;
      } else if (next === 'do') {
        const d = g.pick([['Ders çalışıyorum.', 'Ne güzel! Ders çalışmak çok faydalı.'], ['Kitap okuyorum.', 'Ne güzel! Ne okuyorsun?'], ['Film izliyorum.', 'Ne güzel! Film nasıl?'], ['Hiçbir şey.', 'O zaman biraz sohbet edelim mi?'], ['Yürüyüşe çıkacağım.', 'Ne güzel! İyi eğlenceler.']]);
        t.push([d[0], d[1]]); next = null;
      }
    }
    return t;
  }
  function flowFeel(g) {
    const t = [], s = g.pick(SHARE);
    t.push([s[0], g.pick(s[1])]);
    if (g.p(0.35)) t.push(pickIntent(g, 'thanks'));
    return t;
  }
  const KNOW = [qaAnimal, qaAnimal, qaCalendar, qaNumber, qaNumber, qaColor, qaDef, qaDef, qaCompare, qaWorld, qaWorld, qaSpell, qaGeo];
  function knowPair(g) { const f = g.pick(KNOW); return f(g); }
  function qaChain(g) { // 1-3 bilgi sorusu
    const n = g.w([1, 55, 2, 30, 3, 15]), t = [];
    for (let i = 0; i < n; i++) {
      const p = knowPair(g);
      let q = p[0], a = p[1];
      if (i > 0 && !properStart(q) && g.p(0.5)) q = 'Peki ' + low1(q);
      if (g.p(0.06)) a = g.pick(['Tabii! ', 'Bu kolay! ']) + a;
      else if (g.p(0.04)) a = a + ' Ama henüz çok küçüğüm, bazen yanılırım.';
      t.push([q, a]);
    }
    return t;
  }
  function chatFlow(g) {
    const r = g.f();
    if (r < 0.2) return flowGreet(g);
    if (r < 0.42) { const n = 1 + g.i(3), t = []; for (let i = 0; i < n; i++) { const p = pickIntent(g); t.push(p); } return t; }
    if (r < 0.52) return flowFeel(g);
    if (r < 0.62) return flowPet(g);
    if (r < 0.70) return flowRiddle(g);
    if (r < 0.80) { const n = 1 + g.i(2), t = []; for (let i = 0; i < n; i++) t.push(qaUnknown(g)); if (g.p(0.3)) t.push(qaGibber(g)); return t; }
    if (r < 0.92) { const t = [pickIntent(g, g.pick(['name', 'how', 'doing', 'live', 'age', 'human', 'can', 'favcolor', 'favanimal', 'favdrink'])), knowPair(g)]; return t; }
    const a = pickIntent(g, g.pick(['hello_morning', 'hello_evening', 'how', 'goodnight'])); const t = [a]; const b = pickIntent(g, g.pick(['bye', 'thanks', 'goodnight'])); t.push(b); return t;
  }
  function qa(g) { return dlg(qaChain(g)); }
  function chat(g) { return dlg(chatFlow(g)); }

  Limon.TRGen = Object.assign(Limon.TRGen || {}, { _x: (function () { const o = {}; 'ACC_ALWAYS ADJ ADJMAP ADJ_DEFS ADVICE ALTSTEM ANIMALS ANIMAL_DEFS ANIMAL_LIST ATTR_BAD BARE_OK BEGINS BEN BODYST BODY_PL BYTAG CASE1 CASE3 CATS CATWORD CAT_SKIP CAUSES CITIES CITY_OK CLOCKV CMP CMPV COLORS COMPS CONDS CONDW COUNT_TAGS DAYS DEFS DEGREE DEMON DRINKS_LIKE EVT EVTK EVT_T EXTRA_VERBS FAM_OWN FAV FAV_ACC FEELS FEEL_S FORGETS FRUITS_LIKE GEO GIBBER HAB HARD HECE HOURS HUMTS HUM_ADJ HUM_NOUNS IMP_NEG_OK IMP_OK_EXTRA INSTR INTENTS INTENT_KEYS IR_MONO JOBS_ID K KENPAIRS KNOW LEARNS LETTERS LEX_WARN LIKES LOCACT LOCREL LOC_REQ MADAN MANNER MAXQ MDAYS MEAS MONTHS MUSTNOT MUSTS NAMEF NAMES NMAP NODEG NOTQ NOUNS NOUN_DEFS NUMW NUM_SMALL ONES ONO OPIN_POOLS OUTDOOR OWNOBJ OWNP PARTN PARTOF PETNAMES PETS_C PETS_L PHYS PLACE_ADJ PLACE_ADV PLPART POOL POSSOK POSSP POSSV PRODUCT PRON PRONS PRONTS PROPER_START PURPOSE QUANT QV RCHEAD RCSPEC REFL RELN RIDDLES ROUTINE S3 SEAS SEASONS_L SEASON_FACTS SEAS_OF SEQ2 SHARE SHOP SINCE_A SINCE_D SINCE_H SINCE_L SINCE_S SINCE_T SOFT STATE_ADJ SUPERF TAG_DEFS TAG_DEFS2 TENS TILLN TILLV TIME_FUT TIME_HAB TIME_NOW TIME_PAST UNCOUNT UNKNOWN UNK_R VARCTX VBY VERBS VERB_DEFS VLESS VOW VPC VPL VP_HUM WANTS WEAR_V WHKINDS WHOLE WITHP WORLD WPE WPI WRONGC Z abl abn addNounToken addTag adjFor ageOf animalEnt animalSentence applyTagDefs buildVPool cap catItems caus chat chatFlow cityNP clauseArgs clockPhrase clockText cmpPair colorsOf compFor copPast copPres countV countable dative defText degOf dlg eName eNoun endMark endsV fAbil fAccord fAdjAdv fAfter fAge fAnd fAnimal fAspect fBasic fBut fCat fCause fClock fComp fCompare fCond fEvent fFact fFeel fFor fGen fHas fIdent fImp fIp fKen fList fLoc fNeg fOr fPlace fPossVar fPurpose fQWH fQYN fQuant fRel fRequest fSince fSuggest fSuper fTill fTime fVar fWith famPoss findNoun finishNoun flowFeel flowGreet flowPet flowRiddle forWhom hA hI headNoun humAdj humNoun humanSubject isV jn join joinAnd knowPair lastV letAbl listOf listTR locFor low1 mI mannerOf mkClause mkComp mkG mkNoun mkVerb nName nameForm narrowForProg nf nform nmf noun np npred numAt numSuf numTxt numWord objEntFor objFor objWh otherPerson parseFlags parseVP personFor pickComp pickIntent pickTense pickTwo pickVerb placeNP pluperf poolOf posIdx ppos progStem properStart qa qaAnimal qaCalendar qaChain qaColor qaCompare qaDef qaGeo qaGibber qaNumber qaShare qaSpell qaUnknown qaWorld rebuildTagIndex relLoc renderClause routineSample showS softK softStem subjFor subjPool subjTxt syll tenseFin tenseFor timeAdv tokText uniq varForm vbase verbOK vf vform vfull vharm vinf vinit vn vnon volitional vpArgs vpFin vpInf vpNon vpPart vpart vsel withPast xv xverb'.split(' ').forEach(function (k) { try { o[k] = eval(k); } catch (e) { /* tanimsiz */ } }); return o; })() }); // @@TMPEXPORT@@
  // @@APPEND@@
  if (typeof module !== 'undefined' && module.exports) module.exports = Limon;
})(typeof window !== 'undefined' ? window : globalThis);
