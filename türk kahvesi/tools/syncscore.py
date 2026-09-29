#!/usr/bin/env python3
"""Videodaki hareket enerjisi ile müziğin vuruş enerjisi arasındaki ilişkiyi ölçer.
Kullanım: python3 tools/syncscore.py video.mp4
Her sahne için gecikme (−8..+8 kare) çapraz korelasyon: tepe 0'da ise görüntü müzikle senkron."""
import sys, json, subprocess, re, numpy as np
vid = sys.argv[1]
FPS = 30
raw = subprocess.run(['ffmpeg','-v','error','-i',vid,'-vf',f'fps={FPS},scale=160:160,format=gray','-f','rawvideo','-'],capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1,160,160).astype(np.float32)
motion = np.r_[0, np.abs(np.diff(fr,axis=0)).mean(axis=(1,2))]
# çizgi titremesi (8 Hz) sabit bir taban oluşturur; hareket = taban üstü
src = open('src/audio-data.js').read()
D = json.loads(src[len('window.AUDIO='):].rstrip(';\n'))
n = len(motion); t = np.arange(n)/FPS
def env(name): return np.interp(t, np.arange(len(D[name]))/D['fps'], D[name])
def pulse(ev,tau=0.10):
    out=np.zeros(n)
    for te,s in ev:
        m=(t>=te)&(t<te+tau*6); out[m]+=s*np.exp(-(t[m]-te)/tau)
    return out
aud = {'low':pulse(D['evLow']),'mid':pulse(D['evMid']),'hi':pulse(D['evHi']),'rms':env('rms')}
tl=[('intro',0,7.7),('tahtakale',7.7,24.9),('yola',24.9,28.7),('yol',28.7,39.1),('kusatma',39.1,41.1),('viyana',41.1,57.5),('avrupa',57.5,73.3),('final',73.3,79.2)]
def zs(x): return (x-x.mean())/(x.std()+1e-9)
print('sahne      | ort.hareket | korelasyon (lag -6..+6 kare) en iyi lag | r@0')
for name,a,b in tl:
    i0,i1=int(a*FPS),min(n,int(b*FPS))
    m=motion[i0:i1]
    if len(m)<8: print(name,'çok kısa'); continue
    best=None; res={}
    a_mix = aud['low']+aud['mid']*0.6+aud['hi']*0.4
    for lag in range(-6,7):
        x=zs(m); y=zs(a_mix[max(0,i0+lag):max(0,i0+lag)+len(m)])
        if len(y)!=len(x): continue
        r=float((x*y).mean()); res[lag]=r
        if best is None or r>best[1]: best=(lag,r)
    print(f'{name:10s} | {m.mean():6.2f}      | best lag {best[0]:+d} (r={best[1]:.2f}) | r0={res.get(0,0):.2f}')
# hareketsiz uzun aralıklar
still=[];run=0
for i in range(1,n):
    if motion[i] < 0.02: run+=1
    else:
        if run>=int(1.5*FPS): still.append((round((i-run)/FPS,1),round(i/FPS,1)))
        run=0
if run>=int(1.5*FPS): still.append((round((n-run)/FPS,1),round(n/FPS,1)))
print('durağan aralıklar (>1.5 sn, hareket<0.02):', still)
print('çok durağan kare oranı:', float((motion<0.05).mean()))
