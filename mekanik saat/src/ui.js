// Arayüz: paneller, göstergeler, bilgi kartı.
import { LAYER_TOGGLES } from './scene.js';
import { dialThemeNames, dialThemes } from './materials.js';
import { CHAIN } from './info.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

const pad = (n) => String(n).padStart(2, '0');

export function createUI(cb) {
  const root = document.getElementById('ui');

  // ---------------- Gösterge kartı ----------------
  const clock = h('div', { class: 'clock' }, '00:00:00');
  const ampFill = h('div', { class: 'fill' });
  const ampVal = h('b', {}, '—');
  const pwrFill = h('div', { class: 'fill' });
  const pwrVal = h('b', {}, '—');
  const dot = h('span', { class: 'dot' });
  const beatTxt = h('span', {}, '6 vuruş/sn · 21.600 A/S');
  const state = h('div', { class: 'state' }, '');
  const readout = h('div', { id: 'readout', class: 'glass' },
    clock,
    h('div', { class: 'meter' }, h('div', { class: 'row' }, 'Güç rezervi', pwrVal), h('div', { class: 'track' }, pwrFill)),
    h('div', { class: 'meter amp' }, h('div', { class: 'row' }, 'Balans genliği', ampVal), h('div', { class: 'track' }, ampFill)),
    h('div', { class: 'tick' }, dot, beatTxt),
    state,
  );

  // ---------------- Sağ panel ----------------
  const explodeOut = h('output', {}, '0%');
  const explode = h('input', { type: 'range', min: 0, max: 100, value: 0, step: 0.5 });
  const setRange = (el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
  explode.addEventListener('input', () => {
    explodeOut.textContent = Math.round(explode.value) + '%';
    setRange(explode);
    cb.onExplode(explode.value / 100);
  });
  setRange(explode);

  const viewBtns = {};
  const views = [
    ['hero', 'Sergi'], ['front', 'Kadran'], ['back', 'Arka'], ['side', 'Yan'],
    ['movement', 'Mekanizma'], ['escape', 'Çıkış'], ['balance', 'Balans'], ['barrel', 'Yay kutusu'],
  ];
  const viewRow = h('div', { class: 'grid2' }, views.map(([id, label]) => {
    const b = h('button', { class: 'b', onclick: () => cb.onView(id) }, label);
    viewBtns[id] = b;
    return b;
  }));

  const chipEls = {};
  const chips = h('div', { class: 'chips' }, LAYER_TOGGLES.map(([id, label]) => {
    const c = h('div', { class: 'chip on' }, label);
    c.addEventListener('click', () => {
      c.classList.toggle('on');
      cb.onLayer(id, c.classList.contains('on'));
    });
    chipEls[id] = c;
    return c;
  }));

  const speedBtns = {};
  const speeds = [[0, '❚❚'], [0.02, '1/50×'], [0.1, '1/10×'], [0.25, '1/4×'], [1, 'Gerçek']];
  const speedRow = h('div', { class: 'btns' }, speeds.map(([v, label]) => {
    const b = h('button', { class: 'b third' + (v === 1 ? ' on' : ''), onclick: () => cb.onSpeed(v) }, label);
    speedBtns[v] = b;
    return b;
  }));
  const soundBtn = h('button', { class: 'b wide', onclick: () => cb.onSound() }, '🔈  Sesi aç');

  // Taç ve kurma
  const pullBtn = h('button', { class: 'b wide', onclick: () => cb.onPull() }, 'Tacı çek → zaman ayarı');
  const holdBtn = (label, cls, dir) => {
    const b = h('button', { class: 'b ' + cls }, label);
    const start = (e) => { e.preventDefault(); b.classList.add('on'); cb.onHold(dir, true); };
    const end = () => { b.classList.remove('on'); cb.onHold(dir, false); };
    b.addEventListener('pointerdown', start);
    window.addEventListener('pointerup', () => { if (b.classList.contains('on')) end(); });
    b.addEventListener('pointerleave', () => { if (b.classList.contains('on')) end(); });
    return b;
  };
  const windBtn = holdBtn('⟳  Tacı çevirerek kur (basılı tut)', 'wide', 'wind');
  const fwdBtn = holdBtn('İleri ▶', 'half', 'fwd');
  const backBtn = holdBtn('◀ Geri', 'half', 'back');
  fwdBtn.style.display = backBtn.style.display = 'none';
  const shakeBtn = h('button', { class: 'b wide', onclick: () => cb.onShake() }, '⌚  Bileği salla (rotor kurar)');
  const fullBtn = h('button', { class: 'b half', onclick: () => cb.onSpring(1) }, 'Yayı doldur');
  const emptyBtn = h('button', { class: 'b half', onclick: () => cb.onSpring(0) }, 'Yayı boşalt');

  const sws = h('div', { class: 'swatches' }, dialThemeNames.map((n) => {
    const th = dialThemes[n];
    const s = h('div', { class: 'sw' + (n === 'midnight' ? ' on' : ''), title: n });
    s.style.background = `radial-gradient(circle at 35% 30%, ${th.light}, ${th.base} 60%, ${th.dark})`;
    s.addEventListener('click', () => {
      sws.querySelectorAll('.sw').forEach((x) => x.classList.remove('on'));
      s.classList.add('on');
      cb.onTheme(n);
    });
    return s;
  }));

  const chainBtn = h('button', { class: 'b wide', onclick: () => cb.onChain() }, '⚡  Enerjinin yolunu göster');
  const tourBtn = h('button', { class: 'b wide', onclick: () => cb.onTour() }, '▶  Rehberli tur');

  const scroll = h('div', { class: 'scroll' },
    h('h3', {}, 'İçini aç'),
    h('div', { class: 'sliderRow' }, explode, explodeOut),
    h('div', { class: 'btns', style: 'margin-top:6px' },
      h('button', { class: 'b third', onclick: () => cb.onExplodeTo(0) }, 'Kapat'),
      h('button', { class: 'b third', onclick: () => cb.onExplodeTo(0.42) }, 'Yarım'),
      h('button', { class: 'b third', onclick: () => cb.onExplodeTo(1) }, 'Tam aç')),
    h('p', { class: 'note' }, 'Katmanlar sırayla ayrılır: cam · ibreler · kadran · kadran altı · plaka · dişliler · köprüler · rotor · kasa arkası.'),
    h('h3', {}, 'Bakış açısı'),
    viewRow,
    h('h3', {}, 'Katmanlar'),
    chips,
    h('h3', {}, 'Zaman'),
    speedRow,
    h('div', { style: 'margin-top:6px' }, soundBtn),
    h('h3', {}, 'Taç ve kurma'),
    h('div', { class: 'btns' }, pullBtn, windBtn, fwdBtn, backBtn, shakeBtn, fullBtn, emptyBtn),
    h('p', { class: 'note', html: '<b>Taca sürükle</b> (yukarı = kurma yönü) veya tekerleği çevir. <b>Çift tıkla</b>: çek / it. Rotoru da fareyle çevirebilirsin.' }),
    h('h3', {}, 'Kadran'),
    sws,
    h('h3', {}, 'Öğren'),
    h('div', { class: 'btns' }, chainBtn, tourBtn),
    h('p', { class: 'note', html: 'Herhangi bir parçanın üzerine gel: adını gör. <b>Tıkla</b>: nasıl çalıştığını oku.' }),
  );
  const panelHead = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px 0' },
    h('span', { style: 'font-family:var(--serif);letter-spacing:.22em;color:var(--gold);font-size:13px' }, 'KONTROL'),
    h('button', { class: 'b', onclick: () => setPanel(false) }, 'Gizle'));
  const panel = h('div', { id: 'panel', class: 'glass' }, panelHead, scroll);
  const toggle = h('div', { id: 'toggle', class: 'glass', onclick: () => setPanel(true) }, 'Kontrol');
  function setPanel(open) {
    panel.classList.toggle('hidden', !open);
    toggle.classList.toggle('show', !open);
  }

  // ---------------- Bilgi kartı ----------------
  const infoT = h('h2', {});
  const infoP = h('p', {});
  const infoS = h('div', { class: 'specs' });
  const infoX = h('div', { class: 'x', onclick: () => cb.onSelect(null) }, '×');
  const info = h('div', { id: 'info', class: 'glass' }, infoX, infoT, infoP, infoS);

  const hint = h('div', { id: 'hint', html: 'Sürükle: döndür &nbsp;·&nbsp; Tekerlek: yakınlaş &nbsp;·&nbsp; <kbd>Sağ tuş</kbd>: kaydır &nbsp;·&nbsp; Parçaya <kbd>tıkla</kbd>: bilgi' });

  const chainEl = h('div', { id: 'chain', class: 'glass' });
  CHAIN.forEach(([id, label], i) => {
    if (i) chainEl.append(h('i', {}, '›'));
    chainEl.append(h('span', { 'data-id': id }, label));
  });

  root.append(readout, panel, toggle, info, hint, chainEl);

  return {
    setPanel,
    setExplode(v) { explode.value = v * 100; explodeOut.textContent = Math.round(v * 100) + '%'; setRange(explode); },
    setView(id) { Object.entries(viewBtns).forEach(([k, b]) => b.classList.toggle('on', k === id)); },
    setSpeed(v) { Object.entries(speedBtns).forEach(([k, b]) => b.classList.toggle('on', Number(k) === v)); },
    setSound(on) { soundBtn.textContent = on ? '🔊  Sesi kapat' : '🔈  Sesi aç'; soundBtn.classList.toggle('on', on); },
    setPulled(pulled) {
      pullBtn.textContent = pulled ? 'Tacı it → kurma konumu' : 'Tacı çek → zaman ayarı';
      pullBtn.classList.toggle('on', pulled);
      windBtn.style.display = pulled ? 'none' : '';
      fwdBtn.style.display = backBtn.style.display = pulled ? '' : 'none';
    },
    setInfo(p) {
      if (!p) { info.classList.remove('show'); return; }
      const i = p.info || {};
      infoT.textContent = i.title || p.name;
      infoP.textContent = i.text || '';
      infoS.innerHTML = '';
      (i.specs || []).forEach(([k, v]) => infoS.append(h('span', {}, k, h('b', {}, v))));
      info.classList.add('show');
    },
    setChain(activeId, show) {
      chainEl.classList.toggle('show', show);
      chainEl.querySelectorAll('span').forEach((s) => s.classList.toggle('on', s.dataset.id === activeId));
      chainBtn.classList.toggle('on', show);
    },
    setReadout(o) {
      clock.innerHTML = `${pad(o.h)}:${pad(o.m)}:${pad(o.s)}`;
      pwrFill.style.width = Math.min(100, (o.spring / o.springMax) * 100) + '%';
      pwrVal.textContent = o.stopped ? 'Bitti — kur!' : `${Math.round(o.reserve)} sa`;
      ampFill.style.width = Math.min(100, (o.amp / 320) * 100) + '%';
      ampVal.textContent = o.stopped ? 'durdu' : `${Math.round(o.amp)}°`;
      state.textContent = o.state || '';
    },
    beat(on) { dot.classList.toggle('on', on); },
    setLayerChip(id, on) { chipEls[id]?.classList.toggle('on', on); },
    setTourBtn(active) { tourBtn.classList.toggle('on', active); tourBtn.textContent = active ? '■  Turu durdur' : '▶  Rehberli tur'; },
  };
}
