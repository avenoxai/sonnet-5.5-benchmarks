import { makeEscapement, wrap } from '../src/escapement.js';
const DEG = Math.PI/180;

export function run(opt, {A=300, f=3, seconds=1.5, dt=0.0001, drop=4000, verbose=true}={}) {
  const E = makeEscapement(opt);
  const p = E.p;
  if (verbose) console.log('L',p.L.toFixed(3),'PT',p.PT.toFixed(3),'psi0',(p.psi0/DEG).toFixed(2),'stroke',p.stroke.toFixed(3),'ui',p.ui.toFixed(3),'vi',p.vi.toFixed(3));
  const w = 2*Math.PI*f;
  const Arad = A*DEG;
  let t = 0;
  // başlangıç: balans theta=+A tepe → çatal -psi0 (entry kilitli)
  let psi = E.psiOfTheta(Arad*Math.sin(0));
  // ilk: θ=0 çok hızlı geçiyor; theta'yı tepe noktasından başlat
  const ph0 = Math.PI/2;
  let phi = 0.3;
  let r = E.limitPhi(phi, -p.psi0); phi = r.limit;   // entry'e oturt
  // Güvenli başlangıç için birkaç adım
  let lastSide = Math.sign(E.psiOfTheta(Arad*Math.sin(ph0)));
  let phiAtFlip = phi, maxRecoil=0, lastPhi=phi;
  const events=[]; let beatStart=phi, inLift=false, liftStartPhi=0, liftAcc=0, dropAcc=0;
  let prevStone=-2;
  const log=[];
  for (let i=0;i<seconds/dt;i++){
    t+=dt;
    const th = Arad*Math.sin(w*t+ph0);
    psi = E.psiOfTheta(th);
    const lim = E.limitPhi(phi, psi);
    let nphi = Math.min(phi + drop*DEG*dt, lim.limit);
    if (lim.limit < phi) { nphi = lim.limit; maxRecoil=Math.max(maxRecoil, phi-lim.limit); }
    // event: contact stone changed & wheel arrived at limit
    const atLimit = nphi >= lim.limit-1e-9;
    if (atLimit && prevStone!==lim.stone && lim.stone>=0){
      events.push({t, phi:nphi/DEG, stone:lim.stone, psi:psi/DEG, th:th/DEG});
    }
    prevStone = atLimit? lim.stone : -1;
    phi = nphi;
    if (i%50===0) log.push([t,th/DEG,psi/DEG,phi/DEG,lim.stone]);
  }
  return {E,events,log,maxRecoil,phi};
}

if (process.argv[1].endsWith('test-escapement.mjs')) {
  const {events,maxRecoil,phi} = run({});
  console.log('events',events.length,'maxRecoil deg',(maxRecoil/DEG).toFixed(3),'final phi',(phi/DEG).toFixed(2));
  for (let i=1;i<Math.min(events.length,16);i++){
    const a=events[i-1],b=events[i];
    console.log(i,'t',b.t.toFixed(4),'stone',b.stone,'phi',b.phi.toFixed(2),'d',(b.phi-a.phi).toFixed(2),'psi',b.psi.toFixed(2),'theta',b.th.toFixed(1));
  }
}
