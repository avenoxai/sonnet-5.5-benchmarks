/* Cam nesneleri ve ışık kaynağı gövdelerini çizer (ışığın altında kalan katman) */
(function () {
  'use strict';
  const LT = window.LT;
  const S = LT.state;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  LT.glassCanvas = cv;
  let dpr = 1;

  LT.glassResize = function (W, H, scale) {
    dpr = scale;
    cv.width = Math.round(W * scale);
    cv.height = Math.round(H * scale);
    S.glassDirty = true;
  };

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function path(poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }
  function bbox(poly) {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    for (const p of poly) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    return [x0, y0, x1, y1];
  }

  function drawGlassBody(it) {
    const g = it.geo;
    const poly = g.poly;
    const tint = LT.MATERIALS[it.mat].tint;
    const b = bbox(poly);
    ctx.save();
    path(poly);
    const gr = ctx.createLinearGradient(b[0], b[1], b[2], b[3]);
    gr.addColorStop(0, rgba(tint, 0.2));
    gr.addColorStop(0.55, rgba(tint, 0.07));
    gr.addColorStop(1, rgba(tint, 0.13));
    ctx.fillStyle = gr;
    ctx.fill();

    // iç kenar ışıltısı
    ctx.save();
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = rgba(tint, 0.06);
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.strokeStyle = rgba(tint, 0.09);
    ctx.stroke();
    // ekranın sol üstünden gelen ışığın parlaması
    const hl = ctx.createLinearGradient(b[0], b[1], b[0] + (b[2] - b[0]) * 0.75, b[1] + (b[3] - b[1]) * 0.75);
    hl.addColorStop(0, 'rgba(255,255,255,0.75)');
    hl.addColorStop(0.45, 'rgba(255,255,255,0.08)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.lineWidth = 4;
    ctx.strokeStyle = hl;
    ctx.stroke();
    const hl2 = ctx.createLinearGradient(b[2], b[3], b[2] - (b[2] - b[0]) * 0.6, b[3] - (b[3] - b[1]) * 0.6);
    hl2.addColorStop(0, rgba(tint, 0.35));
    hl2.addColorStop(1, rgba(tint, 0));
    ctx.lineWidth = 3;
    ctx.strokeStyle = hl2;
    ctx.stroke();
    ctx.restore();

    // ince dış çizgi
    path(poly);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(225,240,255,0.66)';
    ctx.stroke();
    ctx.restore();
  }

  // Elmasın yüzey çizgileri (yalnızca görsel; ışın yolu dış çizgiden hesaplanır)
  const FACETS = {
    crown: [
      [[-0.5, -0.05], [-0.27, -0.21], [-0.13, -0.21], [-0.25, -0.05]],
      [[-0.25, -0.05], [-0.13, -0.21], [0, -0.05]],
      [[-0.13, -0.21], [0.13, -0.21], [0, -0.05]],
      [[0, -0.05], [0.13, -0.21], [0.25, -0.05]],
      [[0.25, -0.05], [0.13, -0.21], [0.27, -0.21], [0.5, -0.05]],
    ],
    pav: [
      [[-0.5, -0.02], [-0.25, -0.02], [0, 0.42]],
      [[-0.25, -0.02], [0, -0.02], [0, 0.42]],
      [[0, -0.02], [0.25, -0.02], [0, 0.42]],
      [[0.25, -0.02], [0.5, -0.02], [0, 0.42]],
    ],
  };

  function drawDiamondFacets(it) {
    const k = 175 * it.scale;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    ctx.scale(k, k);
    ctx.lineWidth = 1 / k;
    ctx.lineJoin = 'round';
    const draw = (list, base) => {
      list.forEach((f, i) => {
        ctx.beginPath();
        ctx.moveTo(f[0][0], f[0][1]);
        for (let j = 1; j < f.length; j++) ctx.lineTo(f[j][0], f[j][1]);
        ctx.closePath();
        ctx.fillStyle = 'rgba(210,230,255,' + (base + (i % 2) * 0.07) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(235,245,255,0.34)';
        ctx.stroke();
      });
    };
    draw(FACETS.crown, 0.03);
    draw(FACETS.pav, 0.02);
    ctx.beginPath();
    ctx.moveTo(-0.5, -0.05);
    ctx.lineTo(0.5, -0.05);
    ctx.moveTo(-0.5, -0.02);
    ctx.lineTo(0.5, -0.02);
    ctx.strokeStyle = 'rgba(235,245,255,0.3)';
    ctx.stroke();
    ctx.restore();
  }

  function drawLensExtras(it) {
    // iç halka: cam kalınlığı hissi
    const g = it.geo;
    path(g.poly.map((p) => [it.x + (p[0] - it.x) * 0.9, it.y + (p[1] - it.y) * 0.9]));
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(210,235,255,0.16)';
    ctx.stroke();
  }

  function drawPrismExtras(it) {
    const g = it.geo;
    const inset = g.poly.map((p) => [it.x + (p[0] - it.x) * 0.88, it.y + (p[1] - it.y) * 0.88]);
    path(inset);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(210,235,255,0.14)';
    ctx.stroke();
  }

  function drawSource(it) {
    const g = it.geo;
    const col = it.mono || it.stype === 'laser' ? LT.lamCss(it.lam) : 'rgb(255,250,240)';
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    const { bx0, bx1, hh } = g;
    const rr = it.stype === 'point' ? 15 : 5;
    ctx.beginPath();
    if (it.stype === 'point') ctx.arc(0, 0, 15, 0, Math.PI * 2);
    else ctx.roundRect(bx0, -hh, bx1 - bx0, hh * 2, rr);
    const gr = ctx.createLinearGradient(0, -hh, 0, hh);
    gr.addColorStop(0, '#3a4356');
    gr.addColorStop(0.5, '#1c222e');
    gr.addColorStop(1, '#10141c');
    ctx.fillStyle = gr;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke();

    // yayıcı yüzey
    if (it.stype === 'beam') {
      const ex = ctx.createLinearGradient(bx1 - 9, 0, bx1 + 2, 0);
      ex.addColorStop(0, 'rgba(255,255,255,0)');
      ex.addColorStop(1, col);
      ctx.fillStyle = ex;
      ctx.fillRect(bx1 - 9, -(it.width / 2), 10, it.width);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let x = bx0 + 8; x < bx1 - 12; x += 6) ctx.fillRect(x, -hh + 5, 1.4, hh * 2 - 10);
    } else if (it.stype === 'point') {
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
      rg.addColorStop(0, '#fff');
      rg.addColorStop(0.35, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(bx1 - 4, -3, 5, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(bx0 + 6, -hh + 2, 26, 2);
    }
    ctx.restore();
  }

  LT.drawGlass = function () {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S.W, S.H);
    for (const it of S.items) {
      if (it.kind === 'bubble') continue;
      if (it.kind === 'source') drawSource(it);
      else {
        drawGlassBody(it);
        if (it.kind === 'diamond') drawDiamondFacets(it);
        else if (it.kind === 'lens') drawLensExtras(it);
        else if (it.kind === 'prism') drawPrismExtras(it);
      }
    }
  };
})();
