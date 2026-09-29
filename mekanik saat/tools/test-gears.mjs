import { involuteOutline, conjugateFollower, rotatePts, pointInPoly, polyArea } from '../src/gears.js';
function test(zw, mw, zf, mf, tipAdd=1.0, label='') {
  const W = involuteOutline({z:zw, m:mw});
  const rpf = zf*mf/2;
  const a = W.rp + rpf;
  const t0=performance.now();
  const F = conjugateFollower({wpts:W.pts, zw, a, zf, tipR: rpf + tipAdd*mf, rootR: rpf - 1.2*mf});
  const dt=performance.now()-t0;
  // overlap test over phases
  let bad=0, total=0, minGap=1e9;
  for (let i=0;i<60;i++){
    const alpha = (i/60)*Math.PI*2/zw*3;
    const wp = rotatePts(W.pts, alpha);
    const beta = Math.PI - alpha*(zw/zf);
    const fp = rotatePts(F.pts, beta).map(([x,y])=>[x+a,y]);
    for (const [x,y] of fp) { total++; if (pointInPoly(wp,x,y)) bad++; }
    for (const [x,y] of wp) { if (x> a-rpf*2) { total++; if (pointInPoly(fp,x,y)) bad++; } }
  }
  console.log(label,`z ${zw}/${zf}`,'follower pts',F.pts.length,'ms',dt.toFixed(0),'overlap pts',bad,'/',total, 'area',polyArea(F.pts).toFixed(3));
}
test(80,0.2,10,0.2,1.0,'barrel-center');
test(80,0.13,10,0.13,1.0,'center-third');
test(75,0.13,10,0.13,1.0,'third-fourth');
test(84,0.11,7,0.11,1.0,'fourth-escape');
test(48,0.25,39,0.25,1.0,'ratchet-crown');


function depthTest(zw,mw,zf,mf){
  const W = involuteOutline({z:zw, m:mw});
  const rpf = zf*mf/2; const a=W.rp+rpf;
  const F = conjugateFollower({wpts:W.pts, zw, a, zf, tipR: rpf+mf, rootR: rpf-1.2*mf});
  let maxD=0, cnt=0;
  const segDist=(px,py,ax,ay,bx,by)=>{const dx=bx-ax,dy=by-ay;let t=((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy);t=Math.max(0,Math.min(1,t));return Math.hypot(px-ax-t*dx,py-ay-t*dy)};
  for (let i=0;i<60;i++){
    const alpha=(i/60)*Math.PI*2/zw*3;
    const wpAll=rotatePts(W.pts,alpha);
    const wp=wpAll.filter(([x,y])=>Math.hypot(x-a,y)<rpf*2.5);
    const fp=rotatePts(F.pts,Math.PI-alpha*(zw/zf)).map(([x,y])=>[x+a,y]);
    for (const [x,y] of fp){ if(pointInPoly(wpAll,x,y)){ cnt++; let d=1e9; for(let k=0;k<wpAll.length;k++){const q=wpAll[k],r=wpAll[(k+1)%wpAll.length]; d=Math.min(d,segDist(x,y,q[0],q[1],r[0],r[1]));} maxD=Math.max(maxD,d);} }
  }
  console.log(`z ${zw}/${zf} overlaps ${cnt} max penetration mm`, maxD.toFixed(4));
}
depthTest(80,0.2,10,0.2);depthTest(80,0.13,10,0.13);depthTest(75,0.13,10,0.13);depthTest(84,0.11,7,0.11);
