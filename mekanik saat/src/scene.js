// Saatin tamamını kurar, parçaları kaydeder, simülasyon durumunu sahneye uygular.
import * as THREE from 'three';
import * as L from './layout.js';
import { Ctx } from './build/helpers.js';
import { buildTrain, updateHairspring, updateSpring } from './build/train.js';
import { buildPlates } from './build/plates.js';
import { buildWinding } from './build/winding.js';
import { buildCase, buildDial, buildHands, setDialTheme } from './build/exterior.js';
import { RATCHET_BACK, RATCHET_POW } from './gears.js';
import { INFO } from './info.js';

const { ZL, DEG, TAU } = L;

// Katmanlar ve tam açılımdaki z kayması (mm)
export const LAYER_DEFS = [
  ['strap', 'Kayış', 0],
  ['case', 'Kasa', 0],
  ['crown', 'Taç', 0],
  ['crystal', 'Safir cam ve çerçeve', 66],
  ['hands', 'İbreler', 50],
  ['dial', 'Kadran', 38],
  ['motion', 'Kadran altı mekanizma', 20],
  ['plate', 'Ana plaka', 0],
  ['train', 'Dişli takımı ve çıkış', -14],
  ['barrel', 'Yay kutusu', -14],
  ['barrelLid', 'Yay kutusu kapağı', -25],
  ['balance', 'Denge çarkı', -25],
  ['bridges', 'Köprüler', -36],
  ['cock', 'Balans köprüsü', -44],
  ['winding', 'Kurma ve mandal', -54],
  ['rotorGear', 'Otomatik kurma dişlileri', -63],
  ['rotor', 'Rotor', -74],
  ['caseback', 'Kasa arkası', -90],
];

// Arayüzdeki katman anahtarları → gerçek katmanlar
export const LAYER_TOGGLES = [
  ['strap', 'Kayış', ['strap']],
  ['case', 'Kasa', ['case', 'crown']],
  ['crystal', 'Cam', ['crystal']],
  ['hands', 'İbreler', ['hands']],
  ['dial', 'Kadran', ['dial']],
  ['motion', 'Kadran altı', ['motion']],
  ['plate', 'Plaka', ['plate']],
  ['train', 'Dişliler', ['train', 'barrel', 'barrelLid', 'balance']],
  ['bridges', 'Köprüler', ['bridges', 'cock']],
  ['rotor', 'Rotor', ['winding', 'rotorGear', 'rotor']],
  ['caseback', 'Kasa arkası', ['caseback']],
];

export function createWatch(mats) {
  const ctx = new Ctx(mats);
  // Kasa parçaları için ayrı (soluklaştırılabilir) malzemeler
  mats.caseSteel = mats.steel.clone();
  mats.caseBrushed = mats.steelBrushed.clone();
  mats.strapMat = mats.leather.clone();

  for (const [id, name, off] of LAYER_DEFS) ctx.layer(id, name, off);

  buildCase(ctx);
  buildDial(ctx, 'midnight');
  buildHands(ctx);
  buildTrain(ctx);
  const pl = buildPlates(ctx);
  buildWinding(ctx);

  const n = ctx.nodes;
  const reg = (id, name, groups, layerId) => ctx.part(id, name, groups, layerId, INFO[id] || {});

  reg('case', 'Kasa', [ctx.layers.case.group], 'case');
  reg('crystal', 'Safir cam ve çerçeve', [ctx.layers.crystal.group], 'crystal');
  reg('caseback', 'Kasa arkası', [ctx.layers.caseback.group], 'caseback');
  reg('crown', 'Taç', [ctx.layers.crown.group], 'crown');
  reg('dial', 'Kadran', [ctx.layers.dial.group], 'dial');
  reg('hands', 'İbreler', [n.hourHand, n.minuteHand, n.secondHand], 'hands');
  reg('plate', 'Ana plaka', [n.plate], 'plate');
  reg('barrel', 'Yay kutusu', [n.barrel, n.barrelLid, n.barrelArbor], 'barrel');
  reg('center', 'Merkez çarkı', [n.center], 'train');
  reg('third', 'Üçüncü çark', [n.third], 'train');
  reg('fourth', 'Dördüncü çark', [n.fourth], 'train');
  reg('escape', 'Çıkış çarkı', [n.escapeWheel], 'train');
  reg('fork', 'Çapa', [n.fork], 'train');
  reg('balance', 'Denge çarkı', [n.balance.parent, n.hairspring], 'balance');
  reg('barrelBridge', 'Fıçı köprüsü', [pl.barrelBridge], 'bridges');
  reg('trainBridge', 'Dişli köprüsü', [pl.trainBridge], 'bridges');
  reg('palletBridge', 'Çıkış köprüsü', [pl.palletBridge], 'bridges');
  reg('cock', 'Balans köprüsü', [pl.cock], 'cock');
  reg('ratchet', 'Mandal çarkı', [n.ratchet, n.click], 'winding');
  reg('crownWheel', 'Taç çarkı', [n.crownWheel, n.crownBevel], 'winding');
  reg('stem', 'Kurma mili', [n.stem], 'train');
  reg('setting', 'Ayar çarkı', [n.setting], 'motion');
  reg('minute', 'Dakika çarkı', [n.minuteWheel], 'motion');
  reg('cannon', 'Kanon pinyonu ve saat çarkı', [n.cannon, n.hourWheel], 'motion');
  reg('rotor', 'Rotor', [n.rotor], 'rotor');
  reg('rotorGear', 'Otomatik kurma dişlileri', [n.rotorW1, n.rotorPinion], 'rotorGear');

  // Kasa malzemelerini kasa parçalarına ata
  ctx.layers.case.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material === mats.steel) o.material = mats.caseSteel;
    else if (o.material === mats.steelBrushed) o.material = mats.caseBrushed;
  });
  ctx.layers.crystal.group.traverse((o) => { if (o.isMesh && o.material === mats.steel) o.material = mats.caseSteel; });
  ctx.layers.crown.group.traverse((o) => { if (o.isMesh && o.material === mats.steel) o.material = mats.caseSteel; });
  ctx.layers.strap.group.traverse((o) => { if (o.isMesh) o.material = mats.strapMat; });

  // Click (mandal) animasyon verisi
  const cd = n.click.userData;
  {
    const vx = cd.vx, vy = cd.vy;
    const rx = Math.cos(cd.aClick), ry = Math.sin(cd.aClick);
    // ẑ × v = (-vy, vx); radyal ile nokta çarpımı
    const dot = -vy * rx + vx * ry;
    cd.sign = dot >= 0 ? 1 : -1;
    cd.len = Math.hypot(vx, vy);
  }
  n.click.rotation.z = 0;

  // Yay ve balans başlangıç
  updateSpring(n.spring, 3.7);
  updateHairspring(n.hairspring, 0);

  let lastSpring = -1;
  const ratchetStep = TAU / L.Z.ratchet;

  function applyState(sim) {
    n.barrel.rotation.z = sim.thBarrel;
    n.barrelLid.rotation.z = sim.thBarrel;
    n.barrelArbor.rotation.z = sim.arbor;
    n.ratchet.rotation.z = sim.arbor;
    n.center.rotation.z = sim.thC;
    n.third.rotation.z = sim.thT;
    n.fourth.rotation.z = sim.thF;
    n.escapeWheel.rotation.z = sim.phi;
    n.fork.rotation.z = L.ESC_ROT + sim.psi;
    n.balance.rotation.z = L.ESC_ROT + sim.theta;
    updateHairspring(n.hairspring, sim.theta);
    // Hareket izi: yalnız hızlı hareketlerde (gerçek zamanlı) görünür
    {
      const speed = Math.abs(sim.amp * Math.cos(sim.phaseB)) * TAU * L.BALANCE_HZ * sim.timeScale; // rad/sn
      const vis = sim.running && sim.timeScale > 0.3 && speed > 25;
      const ghosts = n.balanceGhosts;
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i];
        g.visible = vis;
        if (vis) g.rotation.z = sim.thetaBack((i + 1) * 0.0026 * sim.timeScale) - sim.theta;
      }
    }

    n.cannon.rotation.z = sim.cannonShaft;
    n.minuteWheel.rotation.z = sim.minuteWheelShaft;
    n.hourWheel.rotation.z = sim.hourWheelShaft;
    n.setting.rotation.z = sim.settingShaft;
    n.minuteHand.rotation.z = sim.minuteRot;
    n.hourHand.rotation.z = sim.hourRot;
    n.secondHand.rotation.z = sim.secondRot;

    n.crownWheel.rotation.z = sim.crownWheelShaft;
    n.crownBevel.rotation.z = sim.crownWheelShaft;
    n.stem.position.x = L.STEM_TRAVEL * sim.slide;
    n.stemRot.rotation.z = sim.stemGamma;
    n.crownPivot.position.x = 22.5 + L.STEM_TRAVEL * sim.slide;
    n.crownSpin.rotation.z = sim.stemGamma;

    n.rotorW1.rotation.z = sim.w1Shaft;
    n.rotorPinion.rotation.z = sim.rotorPinionShaft;
    n.rotor.rotation.z = sim.rotor;

    // Mandal (click) tırmanışı
    {
      const local = cd.aClick - sim.arbor;
      const x = ((local % ratchetStep) + ratchetStep) % ratchetStep;
      const back = RATCHET_BACK * ratchetStep;
      let lift = 0;
      if (x < back) lift = (0.48) * (1 - Math.pow(x / back, 1 / RATCHET_POW));
      n.click.rotation.z = cd.sign * (lift / cd.len);
    }

    if (Math.abs(sim.spring - lastSpring) > 0.008) {
      updateSpring(n.spring, sim.spring);
      lastSpring = sim.spring;
    }
  }

  function setExplode(t, ghost = true) {
    for (const [id, , off] of LAYER_DEFS) ctx.layers[id].group.position.z = off * t;
    const g = ghost ? Math.min(1, t * 4) : 0;
    for (const mat of [mats.caseSteel, mats.caseBrushed]) {
      mat.transparent = g > 0.001;
      mat.opacity = 1 - 0.95 * g;
      mat.depthWrite = g < 0.5;
    }
    mats.strapMat.transparent = g > 0.001;
    mats.strapMat.opacity = 1 - g;
    mats.strapMat.depthWrite = g < 0.5;
    ctx.layers.strap.group.visible = g < 0.98 && ctx.layerUserVisible?.strap !== false;
  }

  function setLayerVisible(toggleId, on) {
    const def = LAYER_TOGGLES.find((d) => d[0] === toggleId);
    if (!def) return;
    ctx.layerUserVisible = ctx.layerUserVisible || {};
    for (const id of def[2]) {
      ctx.layerUserVisible[id] = on;
      ctx.layers[id].group.visible = on;
    }
  }

  return {
    ctx, applyState, setExplode, setLayerVisible, setDialTheme: (name) => setDialTheme(ctx, name),
    layers: ctx.layers,
  };
}
