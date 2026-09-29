// Sahne-bağımsız stil testi: paylaşılan parçaları bir sayfada göster
(function(){
const TK=window.TK, P=TK.props, {PAL}=TK;
TK.scenes.proptest=function(ctx,lt){
  const b=Math.floor(lt);  // t saniyesi
  P.ground(ctx,560,-20,1100);
  P.sun(ctx,930,120,42,{p:TK.seg(lt,0,1.2)});
  P.cloud(ctx,300,120,1,{p:1});
  P.fincan(ctx,230,560,{s:1.05,steam:1,look:[Math.sin(lt),0],blink:(lt%3)>2.85?1:0});
  P.fincan(ctx,560,560,{s:.7,mood:'wow',steam:.6,color:PAL.orange,squash:.1});
  P.fincan(ctx,800,560,{s:.55,mood:'sleepy',steam:.6,color:PAL.pink,rot:.15});
  P.cezve(ctx,180,980,{s:1.0,foam:.6+.4*Math.sin(lt*3)});
  P.sack(ctx,470,980,{s:.9});
  P.person(ctx,690,980,{s:.85,hat:'fes',robe:PAL.teal,beard:true,arms:'cup',cup:true,steam:.8});
  P.person(ctx,890,980,{s:.85,hat:'wig',robe:PAL.blue,arms:'up',face:'o'});
  P.grass(ctx,40,560,1,{});P.grass(ctx,1010,560,1,{});
  TK.text(ctx,'Bir fincan kahvenin kırk yıl hatırı vardır.',540,700,44,{align:'center'});
  TK.text(ctx,'1554  1683',540,780,80,{align:'center'});
};
})();
