// Tüm dişli çiftlerinin profilleri ve eşleşme fazları (bir kez hesaplanır).
import { involuteOutline, ratchetOutline, escapeWheelOutline, conjugateFollower } from '../gears.js';
import * as L from '../layout.js';

const { Z, M, meshPhase, dirAngle, dist } = L;

function follower(W, zw, a, zf, m, opts = {}) {
  const rp = (zf * m) / 2;
  return conjugateFollower({
    wpts: W.pts, zw, a, zf,
    tipR: rp + (opts.add ?? 1.0) * m,
    rootR: rp - (opts.ded ?? 1.3) * m,
    clearance: opts.clearance ?? 0.014,
  });
}

let cache = null;
export function gearData() {
  if (cache) return cache;
  const D = {};

  // Tasarım çarkları (faz 0)
  D.barrel = involuteOutline({ z: Z.barrel, m: M.barrel });
  D.centerW = involuteOutline({ z: Z.centerWheel, m: M.centerWheel });
  D.thirdW = involuteOutline({ z: Z.thirdWheel, m: M.thirdWheel });
  D.fourthW = involuteOutline({ z: Z.fourthWheel, m: M.fourthWheel });
  D.ratchet = ratchetOutline({ z: Z.ratchet, rOut: 6.2, rIn: 5.72 });
  D.rotorW1 = involuteOutline({ z: Z.rotorW1, m: M.rotor });
  D.minuteW = involuteOutline({ z: Z.minuteWheel, m: M.motion });
  D.hourW = involuteOutline({ z: Z.hourWheel, m: M.hour });
  {
    const ep = L.ESCAPEMENT.p;
    D.escapeW = escapeWheelOutline({ z: Z.escapeWheel, Re: ep.Re, Rroot: ep.Rroot, lean: (Math.tan(ep.draw) * (ep.Re - ep.Rroot)) / ep.Rroot });
  }

  // Takipçiler (zarf yöntemiyle eşlenik pinyonlar) + faz
  const pairs = [
    // id, W, zw, F merkezi ile W merkezi, zf, module
    ['centerPin', 'barrel', Z.barrel, L.BARREL, L.C, Z.centerPinion, M.barrel],
    ['thirdPin', 'centerW', Z.centerWheel, L.C, L.THIRD, Z.thirdPinion, M.centerWheel],
    ['fourthPin', 'thirdW', Z.thirdWheel, L.THIRD, L.FOURTH, Z.fourthPinion, M.thirdWheel],
    ['escapePin', 'fourthW', Z.fourthWheel, L.FOURTH, L.ESCAPE, Z.escapePinion, M.fourthWheel],
    ['crownSpur', 'ratchet', Z.ratchet, L.RATCHET, L.CROWN_WHEEL, Z.crownSpur, M.crown],
    ['rotorW1Pin', 'ratchet', Z.ratchet, L.RATCHET, L.ROTOR_W1, Z.rotorW1Pinion, M.rotor],
    ['rotorPin', 'rotorW1', Z.rotorW1, L.ROTOR_W1, L.ROTOR_AXIS, Z.rotorPinion, M.rotor],
    ['cannon', 'minuteW', Z.minuteWheel, L.MINUTE_WHEEL, L.C, Z.cannon, M.motion],
    ['settingSpur', 'minuteW', Z.minuteWheel, L.MINUTE_WHEEL, L.SETTING_WHEEL, Z.settingSpur, M.motion],
    ['minutePin', 'hourW', Z.hourWheel, L.C, L.MINUTE_WHEEL, Z.minutePinion, M.hour],
  ];
  D.phase = { barrel: 0, centerW: 0, thirdW: 0, fourthW: 0, ratchet: 0, rotorW1: 0, minuteW: 0, hourW: 0, escapeW: 0 };
  D.mesh = {};
  for (const [id, wid, zw, wPos, fPos, zf, m] of pairs) {
    const a = dist(wPos, fPos);
    const W = D[wid];
    D[id] = follower(W, zw, a, zf, m, id === 'escapePin' ? { add: 1.0, ded: 1.2 } : {});
    const gamma = dirAngle(wPos, fPos);
    D.phase[id] = meshPhase(gamma, D.phase[wid], zw, zf);
    D.mesh[id] = { W: wid, gamma, a, zw, zf };
  }
  cache = D;
  return D;
}
