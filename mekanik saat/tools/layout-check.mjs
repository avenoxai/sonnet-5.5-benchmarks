import * as L from '../src/layout.js';
const f=(p)=>`(${p.x.toFixed(2)}, ${p.y.toFixed(2)}) |r|=${Math.hypot(p.x,p.y).toFixed(2)}`;
console.log('BARREL',f(L.BARREL),'R',L.pitchR(L.Z.barrel,L.M.barrel));
console.log('THIRD',f(L.THIRD),'R',L.pitchR(L.Z.thirdWheel,L.M.thirdWheel));
console.log('FOURTH',f(L.FOURTH),'R',L.pitchR(L.Z.fourthWheel,L.M.fourthWheel));
console.log('ESCAPE',f(L.ESCAPE));
console.log('PALLET',f(L.PALLET));
console.log('BALANCE',f(L.BALANCE),'|E-B|',Math.hypot(L.BALANCE.x-L.ESCAPE.x,L.BALANCE.y-L.ESCAPE.y).toFixed(2));
console.log('CROWN',f(L.CROWN_WHEEL));
console.log('MINUTE',f(L.MINUTE_WHEEL),'SETTING',f(L.SETTING_WHEEL));
console.log('ROTOR_W1',f(L.ROTOR_W1));
console.log('ratios',L.RATIO);
// distances between wheel centers vs radii on same level
const cw=L.pitchR(L.Z.centerWheel,L.M.centerWheel);
console.log('center wheel R',cw,'balance-center',Math.hypot(L.BALANCE.x,L.BALANCE.y));
console.log('third-balance',Math.hypot(L.THIRD.x-L.BALANCE.x,L.THIRD.y-L.BALANCE.y),'third R',L.pitchR(L.Z.thirdWheel,L.M.thirdWheel));
console.log('fourth-balance',Math.hypot(L.FOURTH.x-L.BALANCE.x,L.FOURTH.y-L.BALANCE.y));
console.log('barrel-third',Math.hypot(L.THIRD.x-L.BARREL.x,L.THIRD.y-L.BARREL.y));
