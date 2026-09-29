import { makeEscapement } from '../src/escapement.js';
import { escapeWheelOutline, pointInPoly, rotatePts } from '../src/gears.js';
const DEG=Math.PI/180;
const E=makeEscapement(); const p=E.p;
const wheel=escapeWheelOutline({z:15,Re:p.Re,Rroot:p.Rroot,lean:Math.tan(p.draw)*(p.Re-p.Rroot)/p.Rroot});
let phi=0.3; phi=E.limitPhi(phi,-p.psi0).limit;
const w=2*Math.PI*3, A=300*DEG; let t=0, ph=Math.PI/2;
let bad=0, samples=0, maxDepth=0;
const segDist=(px,py,ax,ay,bx,by)=>{const dx=bx-ax,dy=by-ay;let s=((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy);s=Math.max(0,Math.min(1,s));return Math.hypot(px-ax-s*dx,py-ay-s*dy)};
for(let i=0;i<8000;i++){
  const h=0.00025; t+=h; ph+=w*h; const th=A*Math.sin(ph);
  const psi=E.psiOfTheta(th); const lim=E.limitPhi(phi,psi);
  phi = lim.limit<phi ? lim.limit : Math.min(phi+190*h, lim.limit);
  if(i%20!==0) continue;
  const wp=rotatePts(wheel.pts,phi);
  for(let j=0;j<2;j++){
    const st=E.stonePoly(j,psi).map(q=>[q.x,q.y]);
    samples++;
    let over=false, depth=0;
    for(const [x,y] of wp) if(pointInPoly(st,x,y)){over=true; let d=1e9; for(let k=0;k<st.length;k++){const a=st[k],b=st[(k+1)%st.length]; d=Math.min(d,segDist(x,y,a[0],a[1],b[0],b[1]));} depth=Math.max(depth,d);}
    for(const [x,y] of st) if(pointInPoly(wp,x,y)){over=true; let d=1e9; for(let k=0;k<wp.length;k++){const a=wp[k],b=wp[(k+1)%wp.length]; d=Math.min(d,segDist(x,y,a[0],a[1],b[0],b[1]));} depth=Math.max(depth,d);}
    if(over){bad++; maxDepth=Math.max(maxDepth,depth);}
  }
}
console.log('samples',samples,'overlapping',bad,'max penetration mm',maxDepth.toFixed(4));
