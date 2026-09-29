#!/usr/bin/env python3
"""Koşu kayıtlarından sunum ölçümlerini derler -> sunum/olcumler.js
Kaynak: _kayitlar/ozet.txt (başlangıç/bitiş), ~/.claude/projects/<oturum>.jsonl + <oturum>/subagents/**
(token ve maliyet: ana oturum + bütün alt ajanlar, message.id başına tekil), _kayitlar/<slug>*.sonuc.json
(düşünme token'ı; yalnız ana oturumu sayar), _kayitlar/<slug>.bulut.json (bulut oturumunda biten kısım).
Not: sonuc.json'daki modelUsage arka plan workflow ajanlarını saymıyor (ultracode koşularında eksik kalıyordu);
maliyet bu yüzden kayıtlardan, API liste fiyatıyla hesaplanıyor. Normal koşularda iki yöntem birebir aynı çıkıyor.
Her çalıştırmada baştan üretir."""
import json,os,re,glob,datetime,collections
# $/milyon token: (girdi, çıktı). Önbellek yazma 5 dk = 1,25x girdi, 1 sa = 2x girdi; okuma = 0,1x girdi.
FIYAT={'claude-sonnet-5-5':(2,10),'claude-haiku-4-5-20251001':(1,5),'claude-opus-5-5':(4,20)}
ALANLAR=['in','out','cw','cw1h','cr']
_onbellek_yol=os.path.expanduser('~/Desktop/sonnet/_kayitlar/.topla_onbellek.json')
try: _onbellek=json.load(open(_onbellek_yol))
except Exception: _onbellek={}
def dosya_kullanim(fn):
    """Bir kayıt dosyasındaki assistant mesajları: {message.id: [model, in, out, cw, cw1h, cr]} (alan başına max)."""
    st=os.stat(fn); anahtar=f'{st.st_size}:{int(st.st_mtime)}'
    c=_onbellek.get(fn)
    if c and c['k']==anahtar: return c['m']
    msj={}
    for l in open(fn,encoding='utf-8',errors='replace'):
        if '"assistant"' not in l: continue
        try: d=json.loads(l)
        except Exception: continue
        if d.get('type')!='assistant': continue
        m=d.get('message') or {}; u=m.get('usage') or {}; cc=u.get('cache_creation') or {}
        v=[u.get('input_tokens') or 0,u.get('output_tokens') or 0,u.get('cache_creation_input_tokens') or 0,
           cc.get('ephemeral_1h_input_tokens') or 0,u.get('cache_read_input_tokens') or 0]
        e=msj.setdefault(m.get('id') or d.get('uuid'),[m.get('model')]+[0]*5)
        e[0]=e[0] or m.get('model'); e[1:]=[max(a,b) for a,b in zip(e[1:],v)]
    _onbellek[fn]={'k':anahtar,'m':msj}
    return msj
def maliyet(model,t):
    i,o=FIYAT.get(model,(2,10))
    return (t['in']*i+t['out']*o+(t['cw']-t['cw1h'])*i*1.25+t['cw1h']*i*2+t['cr']*i*0.1)/1e6
def oturum_kullanim(sids):
    """Oturumların ana kaydı + alt ajan kayıtları; model başına toplam ve maliyet."""
    msj={}
    for sid in sids:
        for ana in glob.glob(os.path.expanduser(f'~/.claude/projects/*/{sid}.jsonl')):
            dosyalar=[ana]+glob.glob(ana[:-6]+'/subagents/**/agent-*.jsonl',recursive=True)
            for fn in dosyalar: msj.update(dosya_kullanim(fn))
    top=collections.defaultdict(collections.Counter)
    for e in msj.values():
        if not e[0] or e[0].startswith('<'): continue
        top[e[0]].update(dict(zip(ALANLAR,e[1:])))
    return {mdl:dict(t,maliyet=maliyet(mdl,t)) for mdl,t in top.items()}
S=os.path.expanduser('~/Desktop/sonnet'); K=S+'/_kayitlar'
SLUGS={'saat':'mekanik saat','galaksi':'galaksi çarpışması','ciftyarik':'çift yarık','isikmasasi':'ışık masası',
       'mars':'mars inişi','porsche':'porsche','limon':'limon doğuyor','yaratiklar':'yürüyen yaratıklar','kahve':'türk kahvesi'}
ozet=open(K+'/ozet.txt',encoding='utf-8').read().splitlines()
# Bulutta (Claude Code bulut oturumu) devam eden test bitip sonucu klasöre kopyalanınca ozet.txt'ye elle
# "BULUT_BITTI <slug>" satırı eklenir; sunum o testin "Bulutta devam ediyor" kartını kendiliğinden bırakır.
BULUT={m.group(1) for l in ozet for m in [re.search(r'\bBULUT_BITTI (\S+)',l)] if m}
def ts(line):
    m=re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)',line); return datetime.datetime.strptime(m.group(1),'%Y-%m-%d %H:%M:%S') if m else None
out={}
for slug,klasor in SLUGS.items():
    starts=[];ends=[];sessions=set();mode=None;sec_sum=0
    for l in ozet:
        m=re.search(r'BASLADI (\S+) mod=(\S+) session=(\S+)',l)
        if m and m.group(1).split('.')[0]==slug:
            starts.append(ts(l)); mode=m.group(2); sessions.add(m.group(3))
        m=re.search(r'BITTI (\S+) mod=\S+ rc=\S+ sure_sn=(\d+)',l)
        if m and m.group(1).split('.')[0]==slug: sec_sum+=int(m.group(2)); ends.append(l)
    best={}
    for f in sorted(glob.glob(f'{K}/{slug}.sonuc.json')+glob.glob(f'{K}/{slug}.*.sonuc.json')):
        d=json.load(open(f)); rs=d if isinstance(d,list) else [d]
        for r in rs:
            for mdl,u in (r.get('modelUsage') or {}).items():
                b=best.setdefault(mdl,{})
                for k in ['outputTokens','thinkingTokens','inputTokens','cacheReadInputTokens','cacheCreationInputTokens','costUSD']:
                    b[k]=max(b.get(k,0),u.get(k,0) or 0)
    agents=0;workflows=0
    for sid in sessions:
        for d in glob.glob(os.path.expanduser(f'~/.claude/projects/*/{sid}/subagents')):
            agents=max(agents,len(glob.glob(d+'/**/agent-*.jsonl',recursive=True)))
            workflows=max(workflows,len(glob.glob(d+'/workflows/wf_*')))
    running=bool(starts) and len(ends)<len(starts)
    finished=bool(ends) and not running and any('SONUC_YOK' not in e for e in ends)
    tot={k:sum(v.get(k,0) for v in best.values()) for k in ['outputTokens','thinkingTokens','costUSD','cacheReadInputTokens','cacheCreationInputTokens','inputTokens']}
    kayit=oturum_kullanim(sessions)
    if kayit:  # kayıtlardan: ana oturum + alt ajanlar
        cikti=sum(t['out'] for t in kayit.values()); mal=sum(t['maliyet'] for t in kayit.values())
        cr=sum(t['cr'] for t in kayit.values()); modeller=set(kayit)
    else:
        cikti=tot['outputTokens']; mal=tot['costUSD']; cr=tot['cacheReadInputTokens']; modeller=set(best)
    # Süre: koşu parçalarının (ilk koşu + devamlar) toplamı; aradaki duraklamalar sayılmaz.
    wall=sec_sum or None
    bitis=None
    if ends:
        son_ts=[ts(e) for e in ends if ts(e)]
        if son_ts: bitis=max(son_ts).strftime('%H:%M')
    if running and starts:
        wall=(wall or 0)+int((datetime.datetime.now()-max(starts)).total_seconds())
    bulut=None
    bf=f'{K}/{slug}.bulut.json'
    if os.path.exists(bf):
        bulut=json.load(open(bf,encoding='utf-8'))
        cikti+=bulut.get('cikti_token',0); mal+=bulut.get('maliyet_usd',0); cr+=bulut.get('cache_okuma_token',0)
        agents+=bulut.get('ajan_sayisi',0); workflows+=bulut.get('workflow_sayisi',0)
        modeller|=set(bulut.get('modeller',[]))
        wall=(wall or 0)+bulut.get('sure_sn',0)
        if bulut.get('bitis'): bitis=bulut['bitis']
    son=''
    for f in sorted(glob.glob(f'{K}/{slug}.sonuc.json')+glob.glob(f'{K}/{slug}.*.sonuc.json'),key=os.path.getmtime):
        d=json.load(open(f)); rs=d if isinstance(d,list) else [d]
        txt=[r.get('result') or '' for r in rs if (r.get('result') or '').strip()]
        if txt: son=txt[-1]
    idx=os.path.join(S,klasor,'index.html')
    vids=sorted(glob.glob(os.path.join(S,klasor,'*.mp4')))
    out[slug]={'klasor':klasor,'mod':mode,'durum':'bitti' if finished else ('kosuyor' if running else 'baslamadi'),
               'baslangic':min(starts).strftime('%H:%M') if starts else None,'bitis':bitis,'sure_sn':wall,
               'cikti_token':cikti,'dusunme_token':tot['thinkingTokens'],
               # sonuc.json düşünme sayısı yalnız ana oturumu kapsıyor; alt ajan varsa eksik kalır
               'dusunme_tam':agents==0 and not bulut,'maliyet_usd':round(mal,2),
               'cache_okuma_token':cr,'modeller':sorted(modeller),'ajan_sayisi':agents,'workflow_sayisi':workflows,
               'devam_sayisi':max(0,len(starts)-1),'bulut_bitti':slug in BULUT,
               'bulut':({k:bulut.get(k) for k in ['sure_sn','maliyet_usd','maliyet_aralik','cikti_token','cikti_tahmini','ajan_sayisi','effort']} if bulut else None),
               'index_var':os.path.exists(idx),'videolar':[os.path.basename(v) for v in vids],'son_mesaj':son if finished else ''}
json.dump(_onbellek,open(_onbellek_yol,'w'))
js='// topla.py üretir, elle düzenleme. Üretim: '+datetime.datetime.now().strftime('%Y-%m-%d %H:%M')+'\nwindow.OLCUMLER = '+json.dumps(out,ensure_ascii=False,indent=1)+';\n'
open(S+'/sunum/olcumler.js','w',encoding='utf-8').write(js)
for k,v in out.items(): print(k,v['durum'],v['mod'],v['sure_sn'],v['cikti_token'],v['dusunme_token'],v['maliyet_usd'],'ajan',v['ajan_sayisi'])
