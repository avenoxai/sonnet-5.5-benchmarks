// Kalibre 01 — mekanizma yerleşimi ve tüm sayısal sabitler (mm, radyan).
// Koordinat: x sağ (3 yönü), y yukarı (12 yönü), z kadrandan izleyiciye doğru.
// Ön yüz (kadran) +z, kasa arkası -z. Ana plaka üst yüzü z=0.
import { makeEscapement } from './escapement.js';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

// ---- Zaman ve tempo ----
export const BPH = 21600;                    // titreşim/saat
export const BEAT_HZ = BPH / 3600;           // 6 vuruş/sn
export const BALANCE_HZ = BEAT_HZ / 2;       // 3 Hz

// ---- Dişli takımı (diş sayıları) ----
export const Z = {
  barrel: 80, centerPinion: 10,
  centerWheel: 80, thirdPinion: 10,
  thirdWheel: 75, fourthPinion: 10,
  fourthWheel: 84, escapePinion: 7,
  escapeWheel: 15,
  // kurma
  windPinion: 12, crownBevel: 24, crownSpur: 39, ratchet: 48,
  // zaman ayarı
  settingBevel: 24, settingSpur: 20,
  cannon: 12, minuteWheel: 36, minutePinion: 9, hourWheel: 36,
  // otomatik kurma
  rotorPinion: 10, rotorW1: 32, rotorW1Pinion: 10,
};

// Modüller (mm)
export const M = {
  barrel: 0.2,            // fıçı ↔ merkez pinyonu
  centerWheel: 0.13,      // merkez çarkı ↔ 3. pinyon
  thirdWheel: 0.13,
  fourthWheel: 0.11,
  wind: 0.2,              // konik pinyon çifti
  crown: 0.25,            // taç çarkı ↔ mandal çarkı
  motion: 0.25,           // kanon pinyonu ↔ dakika çarkı, ayar çarkı
  hour: 0.26667,          // dakika pinyonu ↔ saat çarkı
  rotor: 0.25,
};

export const pitchR = (z, m) => (z * m) / 2;
export const centerDist = (z1, z2, m) => (m * (z1 + z2)) / 2;

// ---- Z seviyeleri (çark orta düzlemi) ----
export const ZL = {
  plateTop: 0, plateBot: -1.2,
  L1: -1.75, L2: -2.45, L3: -3.15,
  bridgeBot: -3.95, bridgeTop: -4.85,
  ratchetZ: -5.3,       // mandal çarkı / taç çarkı düzlemi (köprü üstü)
  rotorGearZ: -5.95,
  rotorZ: -6.7,
  stemZ: -0.9,
};

const pol = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });

// Ortak eksenli merkez çarkı (0,0)
export const C = { x: 0, y: 0 };

// Fıçı: merkez pinyonuyla merkezden dist = m(Zb+Zp)/2
const dBarrel = centerDist(Z.barrel, Z.centerPinion, M.barrel);
export const BARREL = add(C, pol(dBarrel, 65 * DEG));

// 3. çark ile 4. çark: 4. çark 9 yönünde (saniye ibresi göstergesi)
const dCT = centerDist(Z.centerWheel, Z.thirdPinion, M.centerWheel);       // merkez–3.
const dTF = centerDist(Z.thirdWheel, Z.fourthPinion, M.thirdWheel);        // 3.–4.
export const FOURTH = { x: -10.4, y: 0 };
// 3. çark: C'den dCT, F'den dTF uzaklıkta (alt sol tarafta)
function circleIntersect(a, ra, b, rb, pickLower = true) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const l = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - l * l));
  const mx = a.x + (l * dx) / d, my = a.y + (l * dy) / d;
  const p1 = { x: mx + (h * dy) / d, y: my - (h * dx) / d };
  const p2 = { x: mx - (h * dy) / d, y: my + (h * dx) / d };
  return pickLower ? (p1.y < p2.y ? p1 : p2) : (p1.y < p2.y ? p2 : p1);
}
export const THIRD = circleIntersect(C, dCT, FOURTH, dTF, true);

// Çıkış çarkı: 4. çarkta dFE uzaklıkta
export const dFE = centerDist(Z.fourthWheel, Z.escapePinion, M.fourthWheel);
export const ESC_ANGLE_FROM_FOURTH = -125 * DEG;
export const ESCAPE = add(FOURTH, pol(dFE, ESC_ANGLE_FROM_FOURTH));

// Çıkış sistemi (E–P–B doğrultusu)
export const ESCAPEMENT = makeEscapement();
export const ESC_DIR = -30 * DEG;   // E→P→B yönü
// Yerel (−y = B yönü) → dünya dönüşü: yerel (0,-1) açısı −90° → ESC_DIR
export const ESC_ROT = ESC_DIR + 90 * DEG;
export const localToWorld = (x, y) => {
  const c = Math.cos(ESC_ROT), s = Math.sin(ESC_ROT);
  return { x: ESCAPE.x + x * c - y * s, y: ESCAPE.y + x * s + y * c };
};
export const PALLET = localToWorld(ESCAPEMENT.P.x, ESCAPEMENT.P.y);
export const BALANCE = localToWorld(ESCAPEMENT.B.x, ESCAPEMENT.B.y);

// ---- Kurma zinciri ----
// Mandal çarkı fıçı ekseninde. Taç çarkı, mandalla temas edecek ve stem ekseninde (y=0) durur.
export const dRatchetCrown = centerDist(Z.ratchet, Z.crownSpur, M.crown);
export const RATCHET = { ...BARREL };
export const CROWN_WHEEL = {
  x: BARREL.x + Math.sqrt(dRatchetCrown ** 2 - BARREL.y ** 2),
  y: 0,
};
export const STEM_TRAVEL = 2.0;   // taç çekildiğinde kayma

// Zaman ayarı: ayar çarkı sabit konumda, dakika çarkının dışında (3 yönü)
export const MINUTE_WHEEL = { x: centerDist(Z.cannon, Z.minuteWheel, M.motion), y: 0 };
export const SETTING_WHEEL = {
  x: MINUTE_WHEEL.x + pitchR(Z.minuteWheel, M.motion) + pitchR(Z.settingSpur, M.motion), y: 0,
};

// ---- Otomatik kurma ----
export const ROTOR_AXIS = { ...C };
const dRW1 = centerDist(Z.rotorPinion, Z.rotorW1, M.rotor);
const dW1R = centerDist(Z.rotorW1Pinion, Z.ratchet, M.rotor);
const dCR = Math.hypot(RATCHET.x, RATCHET.y);
{
  // C – W1 – Ratchet üçgeni
}
const cosA = (dRW1 ** 2 + dCR ** 2 - dW1R ** 2) / (2 * dRW1 * dCR);
const angR = Math.atan2(RATCHET.y, RATCHET.x);
export const ROTOR_W1 = add(C, pol(dRW1, angR + Math.acos(cosA)));

// Yay hesabı
export const SPRING_MAX_TURNS = 5.4;      // tam kurulu yay: fıçıya göre kol devri
export const POWER_RESERVE_H = 43;        // tam kurulu çalışma süresi ≈ SPRING_MAX_TURNS × 8 sa
export const BARREL_TURN_HOURS = 8;

// ---- Kinematik oranlar ----
// Çıkış çarkı açısı phi (CCW pozitif, radyan) ana sürücü. Diğerleri sabit oranlarda.
export const RATIO = {
  fourth_per_escape: -Z.escapePinion / Z.fourthWheel,                  // θ_f = -θ_e * Pe/Z4
  third_per_fourth: -Z.fourthPinion / Z.thirdWheel,
  center_per_third: -Z.thirdPinion / Z.centerWheel,
  barrel_per_center: -Z.centerPinion / Z.barrel,
};
RATIO.fourth = RATIO.fourth_per_escape;
RATIO.third = RATIO.fourth * RATIO.third_per_fourth;
RATIO.center = RATIO.third * RATIO.center_per_third;
RATIO.barrel = RATIO.center * RATIO.barrel_per_center;
// escape 12 dev/dk → fourth 1 dev/dk (−) → center 1/60 dev/dk (−) → barrel 1/480 dev/dk

// ---- Dişli eşleşme fazı ----
// W çarkı: tasarım (diş merkezi yerel 0 açısında). F: zarf pinyonu (boşluk merkezi yerel 0 açısında).
// gamma: W merkezinden F merkezine dünya açısı. Şaft açıları θ_F = -θ_W·Zw/Zf ilişkisini sağlar.
// Dönen mesh: rotation.z = şaft açısı + faz.
export const meshPhase = (gamma, phaseW, zw, zf) => gamma + Math.PI + ((gamma - phaseW) * zw) / zf;
export const dirAngle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
