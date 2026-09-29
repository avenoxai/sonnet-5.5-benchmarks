/* Sonnet 5.5 test gecesi · sunum motoru
   İçerik data.js'te (window.SUNUM), ölçümler olcumler.js'te (window.OLCUMLER, topla.py üretir),
   posterler posters/manifest.js'te (window.POSTERLER, posterlar.sh üretir). Bu dosyada rakam yok. */
(function () {
  'use strict';

  var BOOT = Date.now();
  var IS_HTTP = /^https?:$/.test(location.protocol);
  var PARAMS = new URLSearchParams(location.search);
  var TEST = PARAMS.has('test');
  var ROOT = '../';            // sunum/ klasöründen test klasörlerinin köküne
  var LOAD_DELAY = 480;        // slayt geçişi bitmeden ağır sonucu başlatma
  var MIN_LOGICAL = 1280;      // önizlemede sonucun gördüğü en küçük genişlik (px)
  var REFRESH_MS = 30000;      // http modunda ölçüm ve dosya durumunu tazeleme aralığı

  /* ---------- Hata kancası ---------- */
  var errors = [];
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window) return; // görsel yükleme hataları ayrı ele alınıyor
    errors.push(String(e.message || e.error || 'hata'));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; errors.push('promise: ' + (r && r.message ? r.message : String(r)));
  });
  var origError = console.error;
  console.error = function () {
    errors.push(Array.prototype.map.call(arguments, String).join(' '));
    return origError.apply(console, arguments);
  };

  /* ---------- Yardımcılar ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function encPath(p) { return String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/'); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function trDec(x, d, noGroup) { return Number(x).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: !noGroup }); }
  function fmtDur(sec) {
    if (sec == null) return null;
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' dk';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' sa ' + r + ' dk' : h + ' sa';
  }
  function fmtTok(n) {
    if (n == null) return null;
    if (n >= 1e6) return trDec(n / 1e6, 1) + ' milyon';
    if (n >= 1e3) return Math.round(n / 1e3) + ' bin';
    return String(n);
  }
  function fmtUsd(n) { return n == null ? null : '$' + trDec(n, 2); }
  function clockPlus(hhmm, sec) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m || sec == null) return null;
    var t = ((+m[1]) * 60 + (+m[2]) + Math.round(sec / 60)) % 1440;
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }
  // Sunum klasörüne göre yol -> sunucu köküne göre yol (/__durum için)
  function serverPath(rel) {
    try { return decodeURIComponent(new URL(rel, location.href).pathname).replace(/^\//, ''); }
    catch (e) { return null; }
  }

  /* ---------- Dosya var mı? ---------- */
  // http modunda sunucu.py'nin /__durum ucu sorulur (eksik dosya için 404 düşmez).
  // Uç yoksa ya da file:// modundaysak "bilinmiyor" kalır ve görsel doğrudan denenir.
  var exists = {};          // göreli yol -> true | false
  var durumUcu = IS_HTTP;   // ilk hatada kapanır
  function checkPaths(rels) {
    if (!durumUcu || !rels.length) return Promise.resolve();
    var map = {}, q = [];
    rels.forEach(function (r) { var s = serverPath(r); if (s) { map[s] = r; q.push('yol=' + encodeURIComponent(s)); } });
    return fetch('/__durum?' + q.join('&'), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('uç yok'); return res.json(); })
      .then(function (j) { Object.keys(j).forEach(function (k) { if (map[k]) exists[map[k]] = !!j[k]; }); })
      .catch(function () { durumUcu = false; });
  }
  function posterKnown(rel) {
    if (exists[rel] === true) return true;
    if (exists[rel] === false) return false;
    var m = window.POSTERLER;
    return !!(m && Object.prototype.hasOwnProperty.call(m, rel));
  }
  // <img data-src> için: dosya yoksa gizle, varsa (ya da bilinmiyorsa) yükle.
  function paintImages(root) {
    each(root.querySelectorAll('img[data-src]'), function (img) {
      var rel = img.getAttribute('data-src');
      var holder = img.closest('[data-art]') || img;
      if (exists[rel] === false) { holder.classList.add('is-missing'); return; }
      if (img.__want === rel && img.__ok) return;
      img.__want = rel;
      img.onload = function () { img.__ok = true; holder.classList.remove('is-missing'); holder.classList.add('is-loaded'); };
      img.onerror = function () { holder.classList.add('is-missing'); };
      img.src = encPath(rel) + '?v=' + BOOT;
    });
  }

  /* ---------- Ölçümler ---------- */
  function M(slug) { return (window.OLCUMLER || {})[slug] || null; }

  // Oturumu bitmiş ama sonucu yarım kalmış test. İki yol:
  //  1) data.js'te "yarim": { "devam_sayisi": n, "durum": "...", "not": "...", "ara": true|false }. Sadece
  //     olcumler.js'teki devam_sayisi n iken geçerli; test devam ettirilirse (devam_sayisi artar) kendiliğinden düşer.
  //     "durum": "bulut" (Claude Code bulut oturumunda sürüyor) ya da "duraklatildi" (limit yüzünden durduruldu);
  //     yoksa "yarıda kaldı". Bulut testi, ozet.txt'ye "BULUT_BITTI <slug>" satırı düşünce (topla.py bunu
  //     bulut_bitti olarak yazar) ya da blokta "bitti": true olunca düşer; klasörde index.html varsa canlı açılır.
  //  2) Oturum bitmiş ama kökte index.html hiç yazılmamış.
  function yarimBlok(t) {
    var m = M(t.slug) || {}, y = t.yarim;
    if (m.durum !== 'bitti' || !y) return null;
    return (y.devam_sayisi == null || +y.devam_sayisi === +(m.devam_sayisi || 0)) ? y : null;
  }
  function yarimOf(t) {
    var m = M(t.slug) || {};
    if (m.durum !== 'bitti') return null;
    var y = yarimBlok(t);
    if (y && y.durum === 'bulut' && (y.bitti || m.bulut_bitti)) y = null;
    if (y) return y;
    var main = t.gorunumler.filter(function (v) { return v.sonnet !== false && v.tur === 'sayfa'; })[0];
    if (main && (main.dosya || 'index.html') === 'index.html' && m.index_var === false) return {};
    return null;
  }
  // Yarım türleri: slayt kartı, başlık rozeti, kapanış etiketi, dizin
  var YARIM_NOT = 'Oturum kapandı ama index.html hiç yazılmadı.';
  var YARIM = {
    yarim: { st: 'yarim', baslik: 'Yarıda kaldı', rozet: 'yarıda kaldı', etiket: 'yarım' },
    bulut: { st: 'bulut', baslik: 'Bulutta devam ediyor', rozet: 'bulutta devam ediyor', etiket: 'bulutta' },
    duraklatildi: { st: 'durdu', baslik: 'Duraklatıldı', rozet: 'duraklatıldı', etiket: 'duraklatıldı' }
  };
  function yarimTur(t) {
    var y = yarimOf(t);
    return y ? (YARIM[y.durum] ? y.durum : 'yarim') : null;
  }
  // Türkçe iyelik eki: 3'ü, 7'si, 9'u ...
  function iyelik(n) {
    var ek = { 0: '\'ı', 1: '\'i', 2: '\'si', 3: '\'ü', 4: '\'ü', 5: '\'i', 6: '\'sı', 7: '\'si', 8: '\'i', 9: '\'u' };
    var s = String(n), last = +s.slice(-1);
    if (n >= 10 && last === 0) return s + ({ 1: '\'u', 2: '\'si', 3: '\'u', 4: '\'ı', 5: '\'si', 6: '\'ı', 7: '\'i', 8: '\'i', 9: '\'ı' }[+s.slice(-2, -1)] || '\'u');
    return s + ek[last];
  }

  // Bir görünümün (sayfa ya da video) şu anki durumu
  function viewInfo(t, v) {
    var m = M(t.slug) || {};
    var klasor = m.klasor || t.klasor;
    var file = v.dosya || 'index.html';
    var vids = m.videolar || null;
    if (v.tur === 'video' && file.indexOf('*') >= 0) {
      var ext = file.split('*').pop().toLowerCase();
      var pick = (vids || []).filter(function (n) {
        return (v.haric || []).indexOf(n) < 0 && n.toLowerCase().slice(-ext.length) === ext;
      });
      file = pick[0] || null;
    }
    var present = null;
    if (!file) present = false;
    else if (v.tur === 'sayfa' && file === 'index.html' && typeof m.index_var === 'boolean') present = m.index_var;
    else if (v.tur === 'video' && vids) present = vids.indexOf(file) >= 0;
    // Kafa kafaya slaytlarında koşu kaydı yok: dosya varsa hazır sayılır.
    var sonnet = v.sonnet !== false && !t.__kafa;
    var durum = m.durum || 'baslamadi';
    var yarim = sonnet ? yarimOf(t) : null;
    var st;
    if (!sonnet) st = present === false ? 'eksik' : 'hazir';
    else if (durum === 'bitti') st = yarim ? (YARIM[yarim.durum] || YARIM.yarim).st : present === false ? 'eksik' : 'hazir';
    else st = durum === 'kosuyor' ? 'calisiyor' : 'baslamadi';
    return {
      file: file, st: st, durum: durum, start: m.baslangic || null,
      yarimNot: yarim ? (yarim.not || YARIM_NOT) : '',
      peek: present === true && (st === 'calisiyor' || (!!yarim && yarim.ara !== false)),
      label: klasor + '/' + (file || ''),
      url: file ? ROOT + encPath(klasor) + '/' + encPath(file) : null,
      poster: 'posters/' + v.id + '.png'
    };
  }

  /* ---------- Ses ---------- */
  var soundOn = false; // varsayılan: sessiz
  function allowList() {
    return 'fullscreen; xr-spatial-tracking; accelerometer; gyroscope; gamepad' + (soundOn ? '; autoplay' : '');
  }
  function muteDoc(doc) {
    each(doc.querySelectorAll('video, audio'), function (m) {
      if (!soundOn && !m.muted) { m.muted = true; m.setAttribute('data-deck-muted', ''); }
      if (soundOn && m.hasAttribute('data-deck-muted')) { m.muted = false; m.removeAttribute('data-deck-muted'); }
    });
  }
  function applySound(frame) {
    try {
      var doc = frame.contentDocument; // yalnızca http modunda (aynı köken) erişilebilir
      if (!doc || !doc.documentElement) return;
      muteDoc(doc);
      if (!frame.__deckObs) {
        frame.__deckObs = new MutationObserver(function () { muteDoc(doc); });
        frame.__deckObs.observe(doc.documentElement, { childList: true, subtree: true });
      }
    } catch (e) { /* farklı köken: tarayıcının autoplay kuralı yeterli */ }
  }

  /* ---------- Canlı pencere ---------- */
  var livePanes = []; // şu an DOM'da olan bütün pencereler (tam ekran olayları için)
  var WAIT_TEXT = {
    calisiyor: { t: 'Sonnet hala çalışıyor', s: function (i) { return (i.start ? i.start + '\'te başladı. ' : '') + 'Bitince burada canlı açılacak.'; } },
    baslamadi: { t: 'Henüz başlamadı', s: function () { return 'Sırası gelince burada açılacak.'; } },
    yarim: { t: YARIM.yarim.baslik, s: function (i) { return i.yarimNot; } },
    bulut: { t: YARIM.bulut.baslik, s: function (i) { return i.yarimNot; } },
    durdu: { t: YARIM.duraklatildi.baslik, s: function (i) { return i.yarimNot; } },
    eksik: { t: 'Sonuç dosyası bulunamadı', s: function (i) { return i.label; } }
  };
  function Pane(t, v, keyNum) {
    this.t = t; this.v = v; this.token = 0; this.media = null; this.state = 'idle'; this.force = false;
    var el = this.el = document.createElement('div');
    el.className = 'pane';
    el.setAttribute('data-tur', v.tur);
    el.setAttribute('data-state', 'idle');
    el.innerHTML =
      '<div class="pane__poster"></div>' +
      '<div class="pane__frame"></div>' +
      '<div class="pane__load"><i></i></div>' +
      '<div class="wait"><div class="wait__in">' +
        '<span class="wait__dot"></span>' +
        '<strong class="wait__title"></strong>' +
        '<span class="wait__sub"></span>' +
        '<button class="wait__peek" type="button" hidden>Ara halini aç</button>' +
      '</div></div>' +
      '<button class="pane__hit" type="button" aria-label="Tam ekran aç">' +
        '<span class="pane__hint">' + (keyNum ? '<kbd>' + keyNum + '</kbd>' : '') + 'Tam ekran</span></button>' +
      '<div class="pane__esc"><kbd>Esc</kbd> sunuma dön</div>';
    this.frameBox = el.querySelector('.pane__frame');
    var self = this;
    el.querySelector('.pane__hit').addEventListener('click', function (e) { e.currentTarget.blur(); self.enterFull(); });
    el.querySelector('.wait__peek').addEventListener('click', function (e) {
      e.stopPropagation(); e.currentTarget.blur(); self.force = true; self.token++; self.load(self.info());
    });
    if ('ResizeObserver' in window) { this.ro = new ResizeObserver(function () { self.fit(); }); this.ro.observe(el); }
    this.sync();
  }
  Pane.prototype.destroy = function () { this.unmount(); if (this.ro) { this.ro.disconnect(); this.ro = null; } };
  Pane.prototype.info = function () { return viewInfo(this.t, this.v); };
  Pane.prototype.setState = function (s) {
    this.state = s; this.el.setAttribute('data-state', s);
    if (this.onState) this.onState(s);
  };
  // Veri değişince (ya da ilk kurulumda) poster ve bekleme kartını tazele. Yüklü medyaya dokunmaz.
  Pane.prototype.sync = function () {
    var i = this.info();
    this.el.setAttribute('data-st', i.st);
    var w = WAIT_TEXT[i.st];
    if (w) {
      this.el.querySelector('.wait__title').textContent = w.t;
      this.el.querySelector('.wait__sub').textContent = w.s(i);
    }
    this.el.querySelector('.wait__peek').hidden = !i.peek;
    var pos = this.el.querySelector('.pane__poster');
    if (i.st === 'hazir' && posterKnown(i.poster)) {
      var src = encPath(i.poster) + '?v=' + BOOT;
      if (pos.__src !== src) { pos.__src = src; pos.style.backgroundImage = 'url("' + src + '")'; }
      this.el.classList.add('has-poster');
    } else {
      this.el.classList.remove('has-poster');
    }
    if (!this.media) this.setState(i.st === 'hazir' || this.force ? 'idle' : 'bekliyor');
    return i;
  };
  Pane.prototype.fit = function () {
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h || document.fullscreenElement === this.el) return;
    var lw = Math.max(w, MIN_LOGICAL), s = w / lw;
    this.el.style.setProperty('--s', s.toFixed(5));
    this.el.style.setProperty('--lw', lw + 'px');
    this.el.style.setProperty('--lh', (h / s).toFixed(1) + 'px');
  };
  Pane.prototype.mount = function () {
    if (this.media) return;
    var i = this.sync();
    if (i.st !== 'hazir' && !this.force) {
      if (document.fullscreenElement === this.el) document.exitFullscreen().catch(function () {});
      return;
    }
    this.load(i);
  };
  Pane.prototype.load = function (i) {
    if (this.media || !i.url) return;
    var self = this, el;
    if (this.v.tur === 'video') {
      el = document.createElement('video');
      el.playsInline = true; el.loop = true; el.muted = !soundOn; el.preload = 'auto';
      el.setAttribute('playsinline', '');
      if (this.el.classList.contains('has-poster')) el.poster = encPath(i.poster) + '?v=' + BOOT;
      el.addEventListener('loadeddata', function () { if (self.media === el) self.setState('live'); });
      el.addEventListener('error', function () { if (self.media === el) self.setState('live'); });
      el.src = i.url;
      this.frameBox.appendChild(el);
      var p = el.play(); if (p && p.catch) p.catch(function () {});
    } else {
      el = document.createElement('iframe');
      el.setAttribute('allow', allowList());
      el.setAttribute('title', i.label);
      el.tabIndex = -1;
      el.addEventListener('load', function () {
        if (self.media !== el) return;
        applySound(el);
        clearTimeout(self.liveTimer);
        self.liveTimer = setTimeout(function () { if (self.media === el) self.setState('live'); }, 260);
        if (!document.fullscreenElement) guardFocus();
      });
      el.src = i.url;
      this.fit();
      this.frameBox.appendChild(el);
    }
    this.media = el;
    this.setState('loading');
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(function () { if (self.media === el && self.state === 'loading') self.setState('live'); }, 9000);
  };
  Pane.prototype.unmount = function () {
    this.token++;
    this.force = false;
    clearTimeout(this.liveTimer);
    if (document.fullscreenElement === this.el) document.exitFullscreen().catch(function () {});
    var el = this.media;
    if (el) {
      this.media = null;
      if (el.__deckObs) { el.__deckObs.disconnect(); el.__deckObs = null; }
      if (el.tagName === 'VIDEO') {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
      } else {
        try { el.src = 'about:blank'; } catch (e) {}
      }
      el.remove();
    }
    this.sync();
  };
  Pane.prototype.enterFull = function () {
    if (this.state === 'bekliyor') return;
    if (this.beforeFull) this.beforeFull(); // kafa kafaya: öbür pencere kapanır, aynı anda tek sahne
    var p =this.el.requestFullscreen ? this.el.requestFullscreen({ navigationUI: 'hide' }) : null;
    if (p && p.catch) p.catch(function () {});
    if (!this.media) this.mount();
  };
  Pane.prototype.onFullEnter = function () {
    var f = this.media;
    this.wasFull = true;
    if (f && f.tagName === 'VIDEO') { f.controls = true; return; }
    setTimeout(function () {
      try { if (f) { f.tabIndex = 0; f.focus(); if (f.contentWindow) f.contentWindow.focus(); } } catch (e) {}
    }, 80);
  };
  Pane.prototype.onFullExit = function () {
    this.wasFull = false;
    var f = this.media;
    if (f && f.tagName === 'VIDEO') f.controls = false;
    try { if (f && f.tagName === 'IFRAME') { f.tabIndex = -1; f.blur(); } } catch (e) {}
    this.fit();
    setTimeout(function () { window.focus(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }, 30);
  };
  document.addEventListener('fullscreenchange', function () {
    var fs = document.fullscreenElement;
    livePanes.forEach(function (p) {
      if (p.el === fs) p.onFullEnter();
      else if (p.wasFull) p.onFullExit();
    });
  });
  // Önizlemedeki bir iframe odağı çalarsa ok tuşları sunuma dönsün.
  function guardFocus() {
    setTimeout(function () {
      if (document.fullscreenElement) return;
      var a = document.activeElement;
      if (a && a.tagName === 'IFRAME') { a.blur(); window.focus(); }
    }, 0);
  }
  window.addEventListener('blur', guardFocus);

  /* ---------- Yükleme ---------- */
  function fatal(msg) {
    var d = document.createElement('div');
    d.className = 'fatal';
    d.innerHTML = '<div><b>Sunum verisi okunamadı</b>' + esc(msg) +
      '<br><br><code>sunum/data.js</code> dosyasındaki son değişikliği kontrol et. ' +
      '<code>window.SUNUM =</code> sonrası geçerli JSON olmalı.</div>';
    document.body.appendChild(d);
  }
  function loadScript(src, done) {
    var el = document.createElement('script');
    el.src = src + '?v=' + Date.now();
    el.onload = function () { el.remove(); done(true); };
    el.onerror = function () { el.remove(); done(false); };
    document.head.appendChild(el);
  }
  // Önce posterler ve ölçümler (yoksa da devam), sonra içerik.
  loadScript('posters/manifest.js', function () {
    loadScript('olcumler.js', function () {
      loadScript('data.js', function (ok) {
        if (!ok) { fatal('data.js yüklenemedi.'); return; }
        if (!window.SUNUM) { fatal(errors.length ? errors[errors.length - 1] : 'SUNUM tanımlı değil.'); return; }
        try { boot(window.SUNUM); }
        catch (e) { errors.push(String(e && e.stack || e)); fatal(String(e && e.message || e)); }
      });
    });
  });

  /* =====================================================================
     Deste
     ===================================================================== */
  function boot(D) {
    var deck = document.getElementById('deck');
    var slides = [];
    var cur = -1, loadTimer = null, seen = {};
    var tests = D.testler;
    var kafas = D.kafa_kafaya || []; // Sonnet 5.5 testlerine dahil değil, toplamlara girmez
    kafas.forEach(function (t) { t.__kafa = true; });
    var R = D.resmi, RK = D.resmi_kisa || {}, K = D.kapanis || {};

    /* ---- Resmi rakamları ayrıştır ---- */
    // "66.4%¹" -> { v: 66.4, pct: true, fn: '1' }, "52.1% Xhigh / 46.2% Max²" -> ana + ikinci değer
    var SUP = { '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5' };
    function supOf(s) {
      var fn = ''; s = String(s).replace(/[¹²³⁴⁵]/g, function (c) { fn += SUP[c]; return ''; });
      return { s: s.trim(), fn: fn };
    }
    function parseVal(raw) {
      var a = supOf(raw);
      if (!/\d/.test(a.s)) return { nil: true, raw: raw };
      var parts = a.s.split('/').map(function (p) {
        var m = /^\s*([\d.]+)\s*(%?)\s*(.*)$/.exec(p);
        return m ? { v: parseFloat(m[1]), pct: m[2] === '%', note: m[3].trim(), dec: (m[1].split('.')[1] || '').length } : null;
      }).filter(Boolean);
      return { main: parts[0], alt: parts[1] || null, fn: a.fn, raw: raw };
    }
    function numTxt(x) {
      if (!x) return '';
      var n = trDec(x.v, x.dec, true);
      return x.pct ? '%' + n : n;
    }
    function fnHtml(fn) { return fn ? '<sup>' + fn.split('').join(',') + '</sup>' : ''; }
    var rows = R.satirlar.map(function (r) {
      var nm = supOf(r.test);
      var q = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(nm.s);
      return {
        alan: r.alan, raw: r.test,
        ad: q ? q[1] : nm.s, ek: q ? q[2] : '', fn: nm.fn,
        vals: r.degerler.map(parseVal)
      };
    });
    rows.forEach(function (r) {
      var best = -Infinity;
      r.vals.forEach(function (v) { if (!v.nil && v.main.v > best) best = v.main.v; });
      r.vals.forEach(function (v) { v.best = !v.nil && v.main.v === best; });
    });
    function rowByTest(name) { for (var i = 0; i < rows.length; i++) if (rows[i].raw === name) return rows[i]; return null; }
    var COL = R.sutunlar; // ["Sonnet 5.5", "Sonnet 5", "Opus 5.5", "GPT-6 Sol"]
    var iSon = COL.indexOf('Sonnet 5.5'), iOpus = COL.indexOf('Opus 5.5');
    var price = R.fiyat_milyon_token_usd || {};
    function priceTxt(k) { var p = price[k]; return p ? '$' + trDec(p.girdi, 0) + ' / $' + trDec(p.cikti, 0) : ''; }

    /* ---- Slayt listesi ---- */
    slides.push({ kind: 'acilis', id: 'acilis', title: 'Açılış' });
    tests.forEach(function (t, n) { slides.push({ kind: 'test', id: t.slug, title: t.baslik, test: t, n: n + 1 }); });
    kafas.forEach(function (t) { slides.push({ kind: 'test', kafa: true, tekli: true, id: t.slug, title: t.kisa || t.baslik, test: t }); });
    slides.push({ kind: 'kapanis', id: 'kapanis', title: 'Kapanış' });
    var TOTAL = slides.length;
    slides.forEach(function (sl, i) { sl.index = i; });
    function slideIndexOf(id) { for (var i = 0; i < slides.length; i++) if (slides[i].id === id) return i; return -1; }

    /* ---- Açılış ---- */
    function buildAcilis(sl) {
      var head = '<div class="board__row board__row--head">' +
        '<span class="board__area"></span><span class="board__name"></span>' +
        COL.map(function (c, i) { return '<span class="board__col' + (i === iSon ? ' is-son' : '') + '">' + esc(c) + '</span>'; }).join('') + '</div>';
      var lastArea = null, body = '';
      rows.forEach(function (r) {
        var first = r.alan !== lastArea; lastArea = r.alan;
        body += '<div class="board__row' + (first ? ' is-first' : '') + '">' +
          '<span class="board__area">' + (first ? esc(r.alan) : '') + '</span>' +
          '<span class="board__name">' + esc(r.ad) + fnHtml(r.fn) + (r.ek ? ' <em>' + esc(r.ek) + '</em>' : '') + '</span>' +
          r.vals.map(function (v, i) {
            var cls = 'board__val' + (i === iSon ? ' is-son' : '') + (v.best ? ' is-best' : '');
            if (v.nil) return '<span class="' + cls + '"><i class="nil" title="Resmi sayfada değer yok"></i></span>';
            var main = '<b>' + numTxt(v.main) + '</b>' + (v.main.note ? '<small>' + esc(v.main.note) + '</small>' : '') + (v.alt ? '' : fnHtml(v.fn));
            var alt = v.alt ? '<span class="board__alt">' + numTxt(v.alt) + (v.alt.note ? ' <small>' + esc(v.alt.note) + '</small>' : '') + fnHtml(v.fn) + '</span>' : '';
            return '<span class="' + cls + (v.alt ? ' has-alt' : '') + '" title="' + esc(COL[i] + ': ' + numTxt(v.main) + (v.alt ? ' / ' + numTxt(v.alt) : '')) + '"><span class="board__main">' + main + '</span>' + alt + '</span>';
          }).join('') + '</div>';
      });
      var notes = Object.keys(RK.dipnotlar || {}).map(function (k) {
        return '<li><sup>' + esc(k) + '</sup>' + esc(RK.dipnotlar[k]) + '</li>';
      }).join('');
      sl.el.innerHTML =
        '<figure class="hero" data-art><img data-src="' + esc(D.meta.hero) + '" alt=""></figure>' +
        '<div class="open">' +
          '<div class="kick rise" style="--d:0"><i class="dot"></i><span>' + esc(D.meta.tarih) + '</span><span class="kick__sep"></span><span>' + esc(D.meta.kisa) + '</span></div>' +
          '<h1 class="open__title reveal" style="--d:1"><span class="open__over">' + esc(D.meta.ust) + '</span>' + esc(D.meta.baslik) + '</h1>' +
          '<p class="open__lede rise" style="--d:2">' + esc(D.meta.lede) + '</p>' +
          '<section class="board rise" style="--d:3" aria-label="' + esc(RK.baslik) + '">' +
            '<div class="board__cap"><b>' + esc(RK.baslik) + '</b><span>' + esc(RK.alt) + '</span><span class="board__legend"><i></i>satırın en yükseği</span></div>' +
            '<div class="board__grid">' + head + body + '</div>' +
          '</section>' +
          '<section class="pricing rise" style="--d:4">' +
            '<div class="pricing__cell is-son"><span class="pricing__k">Sonnet 5.5</span><b>' + esc(priceTxt('Sonnet 5.5')) + '</b><small>milyon token, girdi / çıktı</small></div>' +
            '<div class="pricing__cell"><span class="pricing__k">Opus 5.5</span><b>' + esc(priceTxt('Opus 5.5')) + '</b><small>milyon token, iki katı</small></div>' +
            '<div class="pricing__cell is-son"><span class="pricing__k">Hız</span><b>' + esc(RK.hiz || '') + '</b><small>' + esc(RK.hiz_alt || '') + '</small></div>' +
          '</section>' +
          '<footer class="open__foot rise" style="--d:5"><ol class="fnotes">' + notes + '</ol><p class="src">' + esc(RK.kaynak || '') + '</p></footer>' +
        '</div>';
    }

    /* ---- Test slaytı ---- */
    function metricsHtml(t) {
      var m = M(t.slug) || {};
      var mode = m.mod || t.mod;
      var done = m.durum === 'bitti';
      function cell(k, v, sub, cls) {
        return '<div class="metric' + (cls ? ' ' + cls : '') + '"><dt>' + k + '</dt><dd>' + v + '</dd>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
      }
      var wait = '<span class="na">bekleniyor</span>';
      var out = '';
      if (done) {
        var end = m.bitis || clockPlus(m.baslangic, m.sure_sn);
        var sub = m.baslangic ? esc(m.baslangic) + (end ? ' → ' + esc(end) : '') : '';
        var bl = m.bulut || null; // son kısmı Claude Code bulut oturumunda biten test
        var yaklasik = bl && bl.cikti_tahmini ? '≈' : '';
        if (bl) sub = 'yerel ' + esc(fmtDur((m.sure_sn || 0) - (bl.sure_sn || 0)) || '?') + ' + bulut ' + esc(fmtDur(bl.sure_sn) || '?');
        else if (m.devam_sayisi) sub += (sub ? ', ' : '') + m.devam_sayisi + ' kez devam, aradaki bekleme sayılmadı';
        out += cell('Süre', esc(fmtDur(m.sure_sn) || '?'), sub);
        out += cell('Çıktı token', yaklasik + esc(fmtTok(m.cikti_token)), (bl ? 'bulut kısmı tahmini' : m.dusunme_tam === false ? 'düşünme ve ajanlar dahil' : esc(Number(m.cikti_token || 0).toLocaleString('tr-TR'))));
        if (m.dusunme_tam === false) out += cell('Düşünme token', '<span class="na">ayrı sayılmıyor</span>', 'ajanlarınki çıktıya dahil');
        else out += cell('Düşünme token', esc(fmtTok(m.dusunme_token)), esc(Number(m.dusunme_token || 0).toLocaleString('tr-TR')));
        var others = (m.modeller || []).filter(function (x) { return !/sonnet/i.test(x); });
        var costSub = 'API liste fiyatıyla' + (others.some(function (x) { return /haiku/i.test(x); }) ? ', Haiku dahil' : others.length ? ', diğer modeller dahil' : '');
        if (bl) costSub = 'API fiyatı, bulut ' + esc(fmtUsd(bl.maliyet_usd)) + ' tahmini';
        out += cell('Maliyet', yaklasik + esc(fmtUsd(m.maliyet_usd)), costSub, 'is-cost is-val');
        if (mode === 'ultracode') out += cell('Ajan', esc(String(m.ajan_sayisi || 0)), m.workflow_sayisi ? m.workflow_sayisi + ' workflow' : 'alt ajan');
      } else {
        out += cell('Süre', m.durum === 'kosuyor' ? '<span class="na">sürüyor</span>' : wait, m.baslangic ? esc(m.baslangic) + '\'te başladı' : '');
        out += cell('Çıktı token', wait, '');
        out += cell('Düşünme token', wait, '');
        out += cell('Maliyet', wait, 'API liste fiyatıyla', 'is-cost');
        if (mode === 'ultracode') out += cell('Ajan', wait, '');
      }
      return out;
    }
    function promptHtml(t) {
      var mode = (M(t.slug) || {}).mod || t.mod;
      var n = t.prompt.length;
      var size = n <= 90 ? 'xl' : n <= 180 ? 'l' : n <= 300 ? 'm' : 's';
      return '<figure class="prompt prompt--' + size + '"><figcaption>Prompt, birebir</figcaption><blockquote>' +
        (mode === 'ultracode' ? '<span class="uc">ultracode</span> ' : '') + esc(t.prompt) + '</blockquote></figure>';
    }
    function kickInner(sl) {
      var t = sl.test, m = M(t.slug) || {};
      if (sl.kafa) {
        return '<span class="kick__n">Kafa kafaya</span><span class="kick__sep"></span><span>Sonnet 5.5 testlerinden ayrı</span>' +
          (t.etiket ? '<span class="badge badge--tag">' + esc(t.etiket) + '</span>' : '');
      }
      var mode = m.mod || t.mod;
      var yt = yarimTur(t);
      return '<span class="kick__n">Test ' + pad2(sl.n) + '</span><span class="kick__of">/ ' + pad2(tests.length) + '</span>' +
        '<span class="badge badge--' + esc(mode) + '">' + esc(mode) + '</span>' + (t.etiket ? '<span class="badge badge--tag">' + esc(t.etiket) + '</span>' : '') +
        (yt ? '<span class="badge badge--yarim badge--' + yt + '">' + esc(YARIM[yt].rozet) + '</span>' : '');
    }
    function titleHtml(sl) {
      var t = sl.test;
      // Kafa kafaya: "Galata Kulesi: Sonnet 5 ve Sonnet 5.5" -> büyük satır + küçük alt satır
      var k = sl.kafa ? t.baslik.indexOf(': ') : -1;
      if (k < 0) return esc(t.baslik);
      return esc(t.baslik.slice(0, k)) + '<span class="t__vs">' + esc(t.baslik.slice(k + 2)) + '</span>';
    }
    function kafaNotHtml(t) {
      return '<div class="kafa-not"><b>' + esc(t.kayit || '') + '</b><span>' + esc(t.not || '') + '</span></div>';
    }
    function headingHtml(sl, compact) {
      var t = sl.test;
      var line = t.manset || t.alt;
      return '<div class="kick rise" style="--d:0">' + kickInner(sl) + '</div>' +
        '<h2 class="t__title reveal" style="--d:1">' + titleHtml(sl) + '</h2>' +
        '<p class="t__line rise' + (t.manset ? ' is-manset' : '') + '" style="--d:2">' + esc(line) + '</p>' +
        (t.detay && !compact ? '<p class="t__detay rise" style="--d:2">' + esc(t.detay) + '</p>' : '') +
        bulutNotHtml(t, compact);
    }
    // Son kısmı Claude Code bulut oturumunda biten test: efor ve maliyet farkını açıkça yaz
    function bulutNotHtml(t, compact) {
      var bl = (M(t.slug) || {}).bulut;
      if (compact) return '';
      var mh = t.mudahale ? '<p class="t__bulut rise" style="--d:2"><b>süre</b>' + esc(t.mudahale) + '</p>' : '';
      if (!bl) return mh;
      return '<p class="t__bulut rise" style="--d:2"><b>bulut</b>Son kısmı Claude Code bulut oturumunda bitti. Orada efor ' +
        esc(bl.effort || '?') + ' kaldı, yerelde xhigh. Bulut maliyeti kayıttan tahmini.</p>' + mh;
    }
    function visibleViews(t) {
      // Joker (*.mp4) görünümler dosya çıkana kadar sekmede görünmez.
      return t.gorunumler.filter(function (v) { return v.tur !== 'video' || viewInfo(t, v).file; });
    }
    // Slaytın görünüşünü belirleyen veri: değişmediyse tazelemede yeniden kurulmaz.
    function testSig(t) {
      return JSON.stringify([M(t.slug), exists[t.sanat], t.gorunumler.map(function (v) { return posterKnown('posters/' + v.id + '.png'); })]);
    }
    function buildTest(sl) {
      var t = sl.test;
      sl.dataSig = testSig(t);
      var duo = t.duzen === 'ikili';
      var views = duo ? t.gorunumler : visibleViews(t);
      sl.viewSig = views.map(function (v) { return v.id; }).join(',');
      var art = '<figure class="t__art" data-art><img data-src="' + esc(t.sanat) + '" alt=""></figure>';
      var tabs = !duo && views.length > 1 ? '<div class="tabs" role="tablist">' + views.map(function (v, i) {
        return '<button class="tab" type="button" role="tab" data-view="' + i + '">' + esc(v.etiket || v.id) + '</button>';
      }).join('') + '<span class="tabs__keys"><kbd>↑</kbd><kbd>↓</kbd></span></div>' : '';
      var capR = '<span class="cap__r"><span class="pstate"></span><span class="cap__hint"><kbd>1</kbd> tam ekran</span></span>';
      var stage;
      if (duo) {
        stage = '<div class="duo">' + views.map(function (v, i) {
          return '<div class="duo__side' + (v.sonnet === false ? ' is-ref' : '') + (v.vurgu ? ' is-son' : '') + '"><div class="cap"><span class="cap__label">' + esc(v.etiket || '') + '</span>' +
            '<span class="cap__r"><span class="pstate"></span><span class="cap__hint"><kbd>' + (i + 1) + '</kbd> tam ekran</span></span></div>' +
            '<div class="duo__pane"></div></div>';
        }).join('') + '</div>';
      } else {
        stage = '<div class="cap">' + (tabs || '<span class="cap__path"></span>') + capR + '</div><div class="t__pane"></div>';
      }
      sl.el.innerHTML = duo ?
        '<div class="t t--duo' + (sl.kafa ? ' t--kafa' : '') + '">' +
          '<header class="t__top">' + art +
            '<div class="t__head">' + headingHtml(sl, true) + '</div>' +
            '<div class="t__prompt rise" style="--d:2">' + promptHtml(t) + '</div>' +
          '</header>' +
          '<section class="t__stage rise" style="--d:3">' + stage + (sl.kafa ? kafaNotHtml(t) : '<dl class="metrics">' + metricsHtml(t) + '</dl>') + '</section>' +
        '</div>'
        :
        '<div class="t">' +
          '<aside class="t__info">' + headingHtml(sl, false) +
            '<div class="t__prompt rise" style="--d:3">' + promptHtml(t) + '</div>' + art +
          '</aside>' +
          '<section class="t__stage rise" style="--d:2">' + stage + '<dl class="metrics">' + metricsHtml(t) + '</dl></section>' +
        '</div>';

      // Pencereler
      (sl.views || []).forEach(function (p) { p.destroy(); var k = livePanes.indexOf(p); if (k >= 0) livePanes.splice(k, 1); });
      sl.views = views.map(function (v, i) { var p = new Pane(t, v, String(duo ? i + 1 : 1)); livePanes.push(p); return p; });
      if (duo) {
        var holders = sl.el.querySelectorAll('.duo__pane'), labels = sl.el.querySelectorAll('.duo .pstate');
        sl.views.forEach(function (p, i) { holders[i].appendChild(p.el); p.onState = stateLabel(labels[i]); p.onState(p.state); });
        sl.panes = sl.views.slice();
        // Tekli: slayta girince iki taraf da poster kalır, tıklanan (ya da 1 / 2) açılır, öbürü kapanır.
        if (sl.tekli) sl.views.forEach(function (p) {
          p.beforeFull = function () { sl.views.forEach(function (o) { if (o !== p && o.media) o.unmount(); }); };
        });
      } else {
        var holder = sl.el.querySelector('.t__pane');
        var setLabel = stateLabel(sl.el.querySelector('.cap .pstate'));
        var pathEl = sl.el.querySelector('.cap__path');
        sl.views.forEach(function (p) { p.onState = function (s) { if (sl.panes[0] === p) setLabel(s); }; });
        var tabEls = sl.el.querySelectorAll('.tab');
        sl.viewIdx = Math.min(sl.viewIdx || 0, sl.views.length - 1);
        sl.setView = function (i) {
          i = (i + sl.views.length) % sl.views.length;
          each(tabEls, function (b, j) { b.classList.toggle('is-on', j === i); b.setAttribute('aria-selected', j === i); });
          var old = sl.panes[0], nu = sl.views[i];
          if (old === nu) return;
          if (old) { old.unmount(); holder.replaceChild(nu.el, old.el); } else holder.appendChild(nu.el);
          sl.viewIdx = i; sl.panes = [nu];
          if (pathEl) pathEl.textContent = nu.info().label;
          setLabel(nu.state);
          if (sl.index === cur) nu.mount();
        };
        each(tabEls, function (b) { b.addEventListener('click', function () { b.blur(); sl.setView(+b.getAttribute('data-view')); }); });
        sl.panes = [];
        sl.setView(sl.viewIdx);
      }
      paintImages(sl.el);
    }
    var STATE_TEXT = { idle: '', loading: 'yükleniyor', live: 'canlı', bekliyor: '' };
    function stateLabel(holder) {
      return function (s) {
        if (!holder) return;
        holder.setAttribute('data-state', s);
        holder.innerHTML = STATE_TEXT[s] ? '<i></i>' + STATE_TEXT[s] : '';
      };
    }
    // Veri tazelenince: aktif olmayan slaytı baştan kur, aktif olanda sadece rakamları ve durumu güncelle.
    function refreshTest(sl, active) {
      var t = sl.test;
      if (testSig(t) === sl.dataSig) return;
      var sig = (t.duzen === 'ikili' ? t.gorunumler : visibleViews(t)).map(function (v) { return v.id; }).join(',');
      if (!active || (sig !== sl.viewSig && !sl.panes.some(function (p) { return p.media; }))) {
        var wasActive = active;
        buildTest(sl);
        if (wasActive && !sl.tekli) sl.panes.forEach(function (p) { p.mount(); });
        return;
      }
      sl.dataSig = testSig(t);
      var dl = sl.el.querySelector('.metrics'); if (dl) dl.innerHTML = metricsHtml(t);
      var kk = sl.el.querySelector('.kick'); if (kk) kk.innerHTML = kickInner(sl);
      sl.views.forEach(function (p) {
        var before = p.el.getAttribute('data-st');
        var i = p.sync();
        if (before !== 'hazir' && i.st === 'hazir' && sl.panes.indexOf(p) >= 0 && !p.media) p.mount();
      });
    }

    /* ---- Kapanış ---- */
    function totalsHtml() {
      var done = tests.filter(function (t) { return (M(t.slug) || {}).durum === 'bitti'; });
      var sum = { s: 0, o: 0, d: 0, c: 0, nd: 0 };
      done.forEach(function (t) {
        var m = M(t.slug);
        sum.s += m.sure_sn || 0; sum.o += m.cikti_token || 0; sum.c += m.maliyet_usd || 0;
        if (m.dusunme_tam !== false) { sum.d += m.dusunme_token || 0; sum.nd++; } // ultracode'da ajanların düşünmesi ayrı sayılmıyor
      });
      function say(tur) { return done.filter(function (t) { return yarimTur(t) === tur; }).length; }
      var nBulut = say('bulut'), nDurdu = say('duraklatildi'), nYarim = say('yarim');
      var nTamam = done.length - nBulut - nDurdu - nYarim;
      var nKos = tests.filter(function (t) { return (M(t.slug) || {}).durum === 'kosuyor'; }).length;
      var nYok = tests.length - done.length - nKos;
      // Bulutta hala süren testin bulut kısmı kayıtta yok; bulutta bitenin kısmı tahmini olarak dahil
      var bulutVar = done.some(function (t) { var y = yarimBlok(t); return y && y.durum === 'bulut' && !(M(t.slug) || {}).bulut; });
      var bulutBitti = done.filter(function (t) { return (M(t.slug) || {}).bulut; }).length;
      var parts = [];
      if (nTamam) parts.push(nTamam === tests.length ? 'hepsi bitti' : iyelik(nTamam) + ' bitti');
      if (nBulut) parts.push(iyelik(nBulut) + ' bulutta devam ediyor');
      if (nDurdu) parts.push(iyelik(nDurdu) + ' duraklatıldı');
      if (nYarim) parts.push(iyelik(nYarim) + ' yarıda kaldı');
      if (nKos) parts.push(iyelik(nKos) + ' hala çalışıyor');
      if (nYok) parts.push(iyelik(nYok) + ' başlamadı');
      var haric = [];
      if (nKos) haric.push('çalışanlar');
      if (bulutVar) haric.push('bulut oturumları');
      var haricTxt = haric.join(' ve ');
      var note = tests.length + ' testin ' + (parts.join(', ') || 'hiçbiri bitmedi') + '.' +
        (haricTxt ? ' ' + haricTxt.charAt(0).toLocaleUpperCase('tr-TR') + haricTxt.slice(1) + ' toplama dahil değil.' : '') +
        (bulutBitti ? ' ' + iyelik(bulutBitti) + ' son kısmını bulutta medium eforla bitirdi, o kısmın maliyeti tahmini.' : '') +
        (function () { var n = done.filter(function (t) { return t.mudahale; }).length; return n ? ' ' + iyelik(n) + ' süre yüzünden o anki haliyle bırakıldı.' : ''; })();
      function tot(k, v, sub) { return '<div class="total"><dt>' + k + '</dt><dd>' + v + '</dd><small>' + sub + '</small></div>'; }
      return {
        note: note,
        html: tot('Toplam süre', esc(fmtDur(sum.s) || '0 dk'), 'testler paralel koştu, bu toplam') +
          tot('Çıktı token', esc(fmtTok(sum.o)), esc(sum.o.toLocaleString('tr-TR'))) +
          tot('Düşünme token', esc(fmtTok(sum.d)), sum.nd < done.length ? 'ajansız ' + sum.nd + ' testte; ultracode\'da çıktıya dahil' : esc(sum.d.toLocaleString('tr-TR'))) +
          tot('Maliyet', esc(fmtUsd(sum.c)), 'API liste fiyatıyla')
      };
    }
    function runsHtml() {
      return tests.map(function (t, n) {
        var m = M(t.slug) || {}, mode = m.mod || t.mod, v;
        var yt = m.durum === 'bitti' ? yarimTur(t) : null;
        if (m.durum === 'bitti') v = (yt ? '<span class="run__tag is-' + yt + '">' + esc(YARIM[yt].etiket) + '</span>' : '') + esc(fmtDur(m.sure_sn) || '?') + '<i></i>' + esc(fmtUsd(m.maliyet_usd) || '');
        else v = '<span class="na">' + (m.durum === 'kosuyor' ? 'çalışıyor' : 'başlamadı') + '</span>';
        return '<button class="run" type="button" data-go="' + slideIndexOf(t.slug) + '"><span class="run__n">' + pad2(n + 1) + '</span>' +
          '<b>' + esc(t.baslik) + (mode === 'ultracode' ? '<i class="run__uc" title="ultracode"></i>' : '') + '</b><span class="run__v">' + v + '</span></button>';
      }).join('') + kafas.map(function (t) {
        // Kafa kafaya ayrı satır: numarası yok, toplama girmez
        return '<button class="run is-kafa" type="button" data-go="' + slideIndexOf(t.slug) + '"><span class="run__n"></span>' +
          '<b>' + esc(t.kisa || t.baslik) + '</b><span class="run__v"><span class="run__tag is-kafa">kafa kafaya</span>kayıt yok</span></button>';
      }).join('');
    }
    function bindRuns(root) {
      each(root.querySelectorAll('.run[data-go]'), function (b) { b.addEventListener('click', function () { b.blur(); go(+b.getAttribute('data-go')); }); });
    }
    function buildKapanis(sl) {
      var tt = totalsHtml();
      var scoreRows = (K.skor_satirlari || []).map(rowByTest).filter(Boolean).map(function (r) {
        var s = r.vals[iSon], o = r.vals[iOpus];
        if (!s || !o || s.nil || o.nil) return '';
        var max = Math.max(s.main.v, o.main.v), pct = s.main.pct;
        var lo = pct ? 0 : Math.min(s.main.v, o.main.v) * 0.9; // Elo için eksen ortak bir tabandan başlar
        function w(v) { return Math.max(4, (v - lo) / (max - lo) * 100).toFixed(1); }
        return '<div class="vs">' +
          '<span class="vs__name">' + esc(r.ad) + fnHtml(r.fn) + '</span>' +
          '<span class="vs__bars">' +
            '<span class="vs__bar is-son"><span class="vs__track"><i style="width:' + w(s.main.v) + '%"></i></span><b>' + numTxt(s.main) + '</b></span>' +
            '<span class="vs__bar"><span class="vs__track"><i style="width:' + w(o.main.v) + '%"></i></span><b>' + numTxt(o.main) + '</b></span>' +
          '</span></div>';
      }).join('');
      sl.el.innerHTML =
        '<figure class="hero hero--close" data-art><img data-src="' + esc(D.meta.kapanis) + '" alt=""></figure>' +
        '<div class="close">' +
          '<div class="kick rise" style="--d:0"><i class="dot"></i><span>Kapanış</span><span class="kick__sep"></span><span>' + esc(D.meta.tarih) + '</span></div>' +
          '<h2 class="close__title reveal" style="--d:1">' + esc(K.baslik || 'Bu gece') + '</h2>' +
          '<p class="close__note rise" style="--d:2">' + esc(tt.note) + '</p>' +
          '<dl class="totals rise" style="--d:2">' + tt.html + '</dl>' +
          '<div class="runs rise" style="--d:3"><div class="runs__k">Test başına <span><i class="run__uc"></i>ultracode</span></div><div class="runs__grid">' + runsHtml() + '</div></div>' +
          '<section class="opus rise" style="--d:4">' +
            '<h3 class="opus__q">' + esc(K.soru || '') + '</h3>' +
            '<div class="opus__grid">' +
              '<div class="fact"><span class="fact__k">Fiyat, milyon token</span>' +
                '<div class="fact__price"><span>Sonnet 5.5</span><b class="is-son">' + esc(priceTxt('Sonnet 5.5')) + '</b></div>' +
                '<div class="fact__price"><span>Opus 5.5</span><b>' + esc(priceTxt('Opus 5.5')) + '</b></div>' +
                '<p>' + esc(K.fiyat_notu || '') + '</p></div>' +
              '<div class="fact"><span class="fact__k">Skorlar <span class="vs__legend"><i class="is-son"></i>Sonnet 5.5 <i></i>Opus 5.5</span></span>' + scoreRows +
                '<p>' + esc(K.skor_notu || '') + '</p></div>' +
              '<div class="fact fact--quote"><span class="fact__k">Anthropic\'in kendi cümlesi</span>' +
                '<blockquote>“' + esc(K.alinti || '') + '”</blockquote>' +
                '<p class="fact__en">' + esc(K.alinti_en || '') + '</p></div>' +
            '</div>' +
            '<p class="src">' + esc(K.kaynak || '') + '</p>' +
          '</section>' +
        '</div>';
      bindRuns(sl.el);
      paintImages(sl.el);
    }
    function refreshKapanis(sl) {
      var tt = totalsHtml();
      var n = sl.el.querySelector('.close__note'); if (n) n.textContent = tt.note;
      var d = sl.el.querySelector('.totals'); if (d) d.innerHTML = tt.html;
      var r = sl.el.querySelector('.runs__grid'); if (r) { r.innerHTML = runsHtml(); bindRuns(r); }
    }

    /* ---- DOM kur ---- */
    slides.forEach(function (sl) {
      var el = sl.el = document.createElement('section');
      el.className = 'slide slide--' + sl.kind;
      el.setAttribute('data-id', sl.id);
      el.setAttribute('aria-label', sl.title);
      deck.appendChild(el);
      sl.panes = [];
      if (sl.kind === 'acilis') buildAcilis(sl);
      else if (sl.kind === 'test') buildTest(sl);
      else buildKapanis(sl);
    });
    paintImages(deck);

    /* ---- Alt çubuk ---- */
    document.getElementById('bar-title').innerHTML = '<b>' + esc(D.meta.kisa) + '</b>';
    var ticks = document.getElementById('ticks');
    ticks.innerHTML = slides.map(function (sl, i) {
      return '<button class="tick" type="button" data-go="' + i + '" aria-label="' + esc(sl.title) + '"><i></i><span>' + pad2(i + 1) + '  ' + esc(sl.title) + '</span></button>';
    }).join('');
    each(ticks.children, function (b) { b.addEventListener('click', function () { b.blur(); go(+b.getAttribute('data-go')); }); });
    var countEl = document.getElementById('count');
    var soundBtn = document.getElementById('btn-sound');
    function renderSound() {
      soundBtn.setAttribute('aria-pressed', soundOn);
      soundBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z"/>' +
        (soundOn ? '<path d="M11 5.5c1 .8 1.5 1.6 1.5 2.5s-.5 1.7-1.5 2.5M12.8 3.8c1.5 1.2 2.2 2.6 2.2 4.2s-.7 3-2.2 4.2"/>' : '<path d="M11 6l3.5 4M14.5 6L11 10"/>') +
        '</svg>' + (soundOn ? 'Ses açık' : 'Ses kapalı') + ' <kbd>M</kbd>';
    }
    function toggleSound() {
      soundOn = !soundOn; renderSound();
      livePanes.forEach(function (p) {
        var f = p.media; if (!f) return;
        if (f.tagName === 'VIDEO') { f.muted = !soundOn; if (soundOn) { var q = f.play(); if (q && q.catch) q.catch(function () {}); } }
        else { f.setAttribute('allow', allowList()); applySound(f); }
      });
    }
    soundBtn.addEventListener('click', function () { soundBtn.blur(); toggleSound(); });
    renderSound();

    /* ---- Dizin ---- */
    var indexEl = document.getElementById('index');
    var grid = document.getElementById('index-grid');
    function cardHtml(sl, i) {
      var img = '', kind, st = '';
      if (sl.kind === 'test' && sl.kafa) {
        // Kafa kafaya: iki posterin yarısı yan yana
        var kt = sl.test;
        var ps = kt.gorunumler.map(function (x) { return viewInfo(kt, x); }).filter(function (x) { return x.st === 'hazir' && posterKnown(x.poster); });
        img = ps.length === kt.gorunumler.length ?
          '<div class="card__img card__img--duo">' + ps.map(function (x) { return '<i style="background-image:url(&quot;' + esc(encPath(x.poster)) + '?v=' + BOOT + '&quot;)"></i>'; }).join('') + '</div>' :
          '<div class="card__img" data-art><img data-src="' + esc(kt.sanat) + '" alt=""></div>';
        kind = 'kafa kafaya';
      } else if (sl.kind === 'test') {
        var t = sl.test, v = t.gorunumler.filter(function (x) { return x.sonnet !== false; })[0] || t.gorunumler[0];
        var inf = viewInfo(t, v);
        var poster = inf.st === 'hazir' && posterKnown(inf.poster);
        img = poster ? '<div class="card__img has-poster" style="background-image:url(&quot;' + esc(encPath(inf.poster)) + '?v=' + BOOT + '&quot;)"></div>' :
          '<div class="card__img" data-art><img data-src="' + esc(t.sanat) + '" alt=""></div>';
        var m = M(t.slug) || {};
        kind = esc(m.mod || t.mod);
        var yt = yarimTur(t);
        st = m.durum === 'bitti' ? (yt ? '<span class="card__st">' + esc(YARIM[yt].rozet) + '</span>' : '') :
          '<span class="card__st">' + (m.durum === 'kosuyor' ? 'çalışıyor' : 'başlamadı') + '</span>';
      } else {
        img = '<div class="card__img" data-art><img data-src="' + esc(sl.kind === 'acilis' ? D.meta.hero : D.meta.kapanis) + '" alt=""></div>';
        kind = sl.kind === 'acilis' ? 'resmi rakamlar' : 'toplamlar';
      }
      return '<button class="card" type="button" data-go="' + i + '" style="--d:' + i + '">' + img + st +
        '<div class="card__meta"><i>' + pad2(i + 1) + '</i><b>' + esc(sl.title) + '</b><span>' + kind + '</span></div></button>';
    }
    function renderIndex() {
      grid.innerHTML = slides.map(cardHtml).join('');
      each(grid.children, function (b, i) {
        b.classList.toggle('is-on', i === cur);
        b.addEventListener('click', function () { closeIndex(); go(+b.getAttribute('data-go')); });
      });
      paintImages(grid);
    }
    var indexOpen = false;
    function openIndex() { renderIndex(); indexOpen = true; indexEl.classList.add('is-open'); indexEl.setAttribute('aria-hidden', 'false'); }
    function closeIndex() { indexOpen = false; indexEl.classList.remove('is-open'); indexEl.setAttribute('aria-hidden', 'true'); }
    document.getElementById('btn-index').addEventListener('click', function (e) { e.currentTarget.blur(); indexOpen ? closeIndex() : openIndex(); });
    indexEl.addEventListener('click', function (e) { if (e.target === indexEl || e.target.classList.contains('index__in')) closeIndex(); });

    /* ---- Gezinme ---- */
    function go(i) {
      i = Math.max(0, Math.min(TOTAL - 1, i));
      if (i === cur) return;
      var prev = slides[cur];
      if (prev) (prev.views || []).forEach(function (p) { p.unmount(); });
      cur = i;
      seen[i] = 1;
      slides.forEach(function (sl, j) {
        sl.el.classList.toggle('is-active', j === i);
        sl.el.classList.toggle('is-before', j < i);
        sl.el.setAttribute('aria-hidden', j === i ? 'false' : 'true');
      });
      var sl = slides[i];
      document.body.setAttribute('data-kind', sl.kind);
      each(ticks.children, function (b, j) {
        b.classList.toggle('is-on', j === i);
        b.classList.toggle('is-seen', !!seen[j] && j !== i);
      });
      countEl.textContent = pad2(i + 1) + ' / ' + pad2(TOTAL);
      if (history.replaceState) history.replaceState(null, '', '#' + sl.id);
      clearTimeout(loadTimer);
      if (sl.panes.length && !sl.tekli) {
        loadTimer = setTimeout(function () {
          if (cur !== i) return;
          sl.panes.forEach(function (p) { p.mount(); });
        }, LOAD_DELAY);
      }
    }
    function fullPane(n) {
      var sl = slides[cur], p = sl && sl.panes[n];
      if (p) { clearTimeout(loadTimer); p.enterFull(); }
    }
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.fullscreenElement) return; // Esc tarayıcıya kalsın
      var k = e.key, c = e.code;
      var isI = k === 'i' || k === 'I' || k === 'ı' || k === 'İ' || c === 'KeyI';
      if (indexOpen && (k === 'Escape' || isI || k === 'Enter')) { closeIndex(); e.preventDefault(); return; }
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') go(cur + 1);
      else if (k === 'ArrowLeft' || k === 'PageUp') go(cur - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(TOTAL - 1);
      else if (k === '1' || c === 'Digit1' || c === 'Numpad1') { if (!indexOpen) fullPane(0); }
      else if (k === '2' || c === 'Digit2' || c === 'Numpad2') { if (!indexOpen) fullPane(1); }
      else if (k === 'ArrowDown' || k === 'ArrowUp') {
        var sl = slides[cur];
        if (!sl.setView || sl.views.length < 2) return;
        sl.setView(sl.viewIdx + (k === 'ArrowDown' ? 1 : -1));
      }
      else if (isI || k === 'g' || k === 'G') { indexOpen ? closeIndex() : openIndex(); }
      else if (k === 'm' || k === 'M' || c === 'KeyM') toggleSound();
      else return;
      e.preventDefault();
      if (indexOpen) each(grid.children, function (b, j) { b.classList.toggle('is-on', j === cur); });
    });
    window.addEventListener('hashchange', function () {
      var i = slideIndexOf(decodeURIComponent(location.hash.replace(/^#\/?/, '')));
      if (i >= 0) go(i);
    });

    /* ---- Tazeleme: ölçümler, posterler, görseller ---- */
    function assetPaths() {
      var list = [D.meta.hero, D.meta.kapanis];
      tests.concat(kafas).forEach(function (t) {
        list.push(t.sanat);
        t.gorunumler.forEach(function (v) { list.push('posters/' + v.id + '.png'); });
      });
      return list;
    }
    function refreshAll() {
      slides.forEach(function (sl) {
        if (sl.kind === 'test') refreshTest(sl, sl.index === cur);
        else if (sl.kind === 'kapanis') refreshKapanis(sl);
      });
      paintImages(deck);
      if (indexOpen) renderIndex();
    }
    var refreshing = false;
    function refresh() {
      if (refreshing) return;
      refreshing = true;
      loadScript('olcumler.js', function () {
        loadScript('posters/manifest.js', function () {
          checkPaths(assetPaths()).then(function () {
            refreshing = false;
            try { refreshAll(); } catch (e) { errors.push(String(e && e.stack || e)); }
          });
        });
      });
    }

    var startId = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    var start = slideIndexOf(startId);
    checkPaths(assetPaths()).then(function () {
      slides.forEach(function (sl) { if (sl.kind === 'test') sl.views.forEach(function (p) { p.sync(); }); });
      paintImages(deck);
    });
    go(start >= 0 ? start : 0);
    if (IS_HTTP) setInterval(refresh, REFRESH_MS);

    // Test ve hata ayıklama için
    window.__deck = {
      go: go, full: fullPane, slides: slides, refresh: refresh, refreshAll: refreshAll,
      state: function () {
        return {
          cur: slides[cur].id, errors: errors.slice(),
          iframes: document.querySelectorAll('iframe').length,
          videos: document.querySelectorAll('video').length,
          panes: livePanes.map(function (p) { return { id: p.v.id, state: p.state, st: p.el.getAttribute('data-st'), loaded: !!p.media }; }),
          mode: IS_HTTP ? 'http' : 'file', exists: exists
        };
      }
    };
    if (TEST) {
      setTimeout(function () {
        var pre = document.createElement('pre');
        pre.id = 'deck-test';
        pre.hidden = true;
        pre.setAttribute('data-errors', String(errors.length));
        pre.textContent = JSON.stringify(window.__deck.state());
        document.body.appendChild(pre);
      }, +PARAMS.get('test') || 2500);
    }
  }
})();
