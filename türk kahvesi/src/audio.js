/* audio.js: müzikten önceden çıkarılmış veriyi (audio-data.js) sorgulama yardımcıları.
 * Hepsi t (saniye) -> değer; deterministik. */
(function (g) {
'use strict';
const D = g.AUDIO;
const FPS = D.fps;

function env(name, t) {            // rms|low|mid|hi -> 0..~1.2 (60 fps, doğrusal ara değer)
  const a = D[name];
  const x = Math.max(0, Math.min(a.length - 1.001, t * FPS));
  const i = Math.floor(x), f = x - i;
  return a[i] + (a[i + 1] - a[i]) * f;
}
function evList(kind) { return kind === 'low' ? D.evLow : kind === 'mid' ? D.evMid : D.evHi; }
// t anında ya da öncesindeki son olayın indeksi (-1 yoksa)
function lastIdx(list, t) {
  let lo = 0, hi = list.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
// Vuruş nabzı: son olaylardan üstel sönümlü toplam (0..~1.5). kind: 'low' (davul/bas), 'mid' (melodi/ud), 'hi' (zil/def)
function pulse(kind, t, tau = 0.12) {
  const list = evList(kind);
  let i = lastIdx(list, t), s = 0;
  while (i >= 0 && t - list[i][0] < tau * 6) { s += list[i][1] * Math.exp(-(t - list[i][0]) / tau); i--; }
  return Math.min(s, 1.6);
}
// t'den önceki son olay {t, s} ya da null
function last(kind, t) { const l = evList(kind), i = lastIdx(l, t); return i < 0 ? null : { t: l[i][0], s: l[i][1] }; }
// t'den sonraki ilk olay
function next(kind, t) { const l = evList(kind), i = lastIdx(l, t) + 1; return i >= l.length ? null : { t: l[i][0], s: l[i][1] }; }
// t anına kadar kaç olay oldu (sayaç: "her vuruşta bir şey ekle" için)
function count(kind, t, from = 0) { const l = evList(kind); return Math.max(0, lastIdx(l, t) + 1 - lastIdx(l, from) - 1); }
// [a,b] aralığındaki olayların listesi
function between(kind, a, b) { return evList(kind).filter(e => e[0] >= a && e[0] < b).map(e => ({ t: e[0], s: e[1] })); }
// Yavaş sallanma için 'vuruş fazı' üretmek: son 'low' olayından bu yana geçen süre (sn)
function since(kind, t) { const l = last(kind, t); return l ? t - l.t : 9; }

g.TK.audio = { env, pulse, last, next, count, between, since, dur: D.dur, chord: D.chord, outroNotes: D.outroNotes, sections: D.sections };
})(window);
