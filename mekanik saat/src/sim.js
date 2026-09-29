// Mekanik simülasyon: yay → dişli takımı → çıkış → balans.
// Balans açısı zamanın sinüs fonksiyonu (izokron), ama çapa ve çıkış çarkı gerçek geometriyle hareket eder:
// diş ucu palet taşına çarpınca durur (kilit), taş çekilince empuls verir, düşüş serbesttir.
import * as L from './layout.js';

const { Z, RATIO, DEG, TAU } = L;
const wrapPi = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

export class WatchSim {
  constructor() {
    this.esc = L.ESCAPEMENT;
    const p = this.esc.p;
    this.p = p;

    // ---- Çıkış / balans durumu ----
    this.phi = 0.3;
    const r = this.esc.limitPhi(this.phi, -p.psi0);   // giriş taşına oturt
    this.phi = r.limit;
    this.phaseB = Math.PI / 2;
    this.amp = 260 * DEG;
    this.theta = this.amp;
    this.psi = -p.psi0;
    this.running = true;
    this.beatFree = false;
    this.restSign = 1;

    // ---- Yay ----
    this.springMax = L.SPRING_MAX_TURNS;
    this.spring = 3.7;                    // tur (fıçıya göre)
    this.arbor = 0;                       // mandal/mil açısı (CCW pozitif)
    this.barrelPrev = this.phi * RATIO.barrel;
    this.clickTooth = 0;

    // ---- Zaman ayarı / kurma mili ----
    this.slide = 0;                       // 0 = kurma, 1 = ayar (çekili)
    this.slideTarget = 0;
    this.stemGamma = 0;                   // mil açısı (rad, +x etrafında)
    this.snapW = 0;
    this.snapS = 0;
    this.gammaFrom = 0;
    this.slideBlend = 1;
    this.slip = 0;                        // kanon sürtünme kayması (rad)
    this.mode = 'wind';                   // 'wind' | 'set' | 'moving'
    this.crownIn = 0;                     // taç kaydırma animasyonu 0..1

    // ---- Rotor ----
    this.rotor = 0.4;
    this.rotorVel = 0;
    this.rotorPinion = 0;
    this.shakeT = 0;
    this.gravAng = 0;
    this.rotorFullSlip = false;

    // ---- Zaman ölçeği ----
    this.timeScale = 1;
    this.simTime = 0;
    this.events = [];
    this.beatCount = 0;
    this.stats = { bps: 0, lastBeats: [] };

    this._initTime();
    this.stemGamma = this.gammaWind();
  }

  _initTime() {
    const now = new Date();
    const sec = now.getSeconds() + now.getMilliseconds() / 1000;
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;
    const thC0 = this.phi * RATIO.center;
    this.minuteOffset = -(min * 6) * DEG - thC0;
    this.hourOffset = -(hr * 30) * DEG - thC0 / 12;
    this.secOffset = -(sec * 6) * DEG - this.phi * RATIO.fourth;
  }

  // ---- Türetilmiş açılar ----
  get thC() { return this.phi * RATIO.center; }
  get thF() { return this.phi * RATIO.fourth; }
  get thT() { return this.phi * RATIO.third; }
  get thBarrel() { return this.phi * RATIO.barrel; }
  get cannonShaft() { return this.thC + this.slip; }
  get minuteRot() { return this.cannonShaft + this.minuteOffset; }
  get hourWheelShaft() { return this.cannonShaft / 12; }
  get hourRot() { return this.hourWheelShaft + this.hourOffset; }
  get minuteWheelShaft() { return -this.cannonShaft * (Z.cannon / Z.minuteWheel); }
  get settingShaft() { return -this.minuteWheelShaft * (Z.minuteWheel / Z.settingSpur); }
  get secondRot() { return this.thF + this.secOffset; }
  get crownWheelShaft() { return -this.arbor * (Z.ratchet / Z.crownSpur); }
  get w1Shaft() { return -this.arbor * (Z.ratchet / Z.rotorW1Pinion); }
  get rotorPinionShaft() { return this.arbor * (Z.ratchet / Z.rotorW1Pinion) * (Z.rotorW1 / Z.rotorPinion); }

  gammaWind() { return (Z.crownBevel / Z.windPinion) * this.crownWheelShaft + this.snapW; }
  gammaSet() { return -(Z.settingBevel / Z.windPinion) * this.settingShaft + this.snapS; }

  /** τ saniye önceki balans açısı (hareket izi için) */
  thetaBack(tau) { return this.running ? this.amp * Math.sin(this.phaseB - TAU * L.BALANCE_HZ * tau) : this.theta; }

  get amplitudeDeg() { return (Math.abs(this.amp) / DEG); }
  get powerReserveHours() { return Math.max(0, this.spring) * L.BARREL_TURN_HOURS; }
  get isFull() { return this.spring >= this.springMax - 0.02; }

  // ---- Kullanıcı girdileri ----
  /** Taç dönüşü (mil ekseni etrafında radyan). Döndürülen: gerçekten uygulanan. */
  turnCrown(dGamma) {
    if (this.mode === 'moving') return 0;
    if (this.mode === 'wind') {
      if (dGamma >= 0) return 0;              // ters yönde taç dönmez (mandal tutar)
      if (this.isFull) return 0;
      const k = (Z.windPinion / Z.crownBevel) * (Z.crownSpur / Z.ratchet);
      const dA = -dGamma * k;
      this._addArbor(dA);
      this.stemGamma = this.gammaWind();
      return dGamma;
    }
    // ayar konumu
    const r = (Z.windPinion / Z.settingBevel) * (Z.settingSpur / Z.minuteWheel) * (Z.minuteWheel / Z.cannon);
    this.slip += -r * dGamma;
    this.stemGamma = this.gammaSet();
    return dGamma;
  }

  pullCrown(pulled) {
    const target = pulled ? 1 : 0;
    if (target === this.slideTarget) return;
    this.slideTarget = target;
    this.mode = 'moving';
    this.gammaFrom = this.stemGamma;
    // hedef eşleşme fazına en yakın snap
    const step = TAU / Z.windPinion;
    if (target === 1) {
      const base = -(Z.settingBevel / Z.windPinion) * this.settingShaft;
      this.snapS = Math.round((this.stemGamma - base) / step) * step;
    } else {
      const base = (Z.crownBevel / Z.windPinion) * this.crownWheelShaft;
      this.snapW = Math.round((this.stemGamma - base) / step) * step;
    }
    this.slideBlend = 0;
  }

  shakeRotor(seconds = 3.5) { this.shakeT = seconds; }

  /** Rotoru elle döndür (fare sürükleme). Tek yönlü kavrama yine geçerli. */
  moveRotor(d) {
    this.rotor += d;
    if (d > 0 && !this.isFull) this._addArbor(d * (Z.rotorPinion / Z.rotorW1) * (Z.rotorW1Pinion / Z.ratchet));
  }
  impulseRotor(dv) { this.rotorVel += dv; }

  _addArbor(dA) {
    if (dA === 0) return;
    this.arbor += dA;
    this.spring = Math.min(this.springMax, this.spring + dA / TAU);
    // Mandal çarkı diş geçişleri → tık
    const step = TAU / Z.ratchet;
    const tooth = Math.floor(this.arbor / step);
    if (tooth !== this.clickTooth) {
      const n = Math.min(4, Math.abs(tooth - this.clickTooth));
      for (let i = 0; i < n; i++) this.events.push({ type: 'click' });
      this.clickTooth = tooth;
    }
  }

  // ---- Ana adım ----
  update(dtReal) {
    const dt = Math.min(dtReal, 0.05);
    this._updateStem(dt);
    this._updateRotor(dt);       // rotor gerçek zamanlı
    const dtV = dt * this.timeScale;
    if (dtV <= 0) return;
    const h0 = 0.00025;
    const n = Math.max(1, Math.ceil(dtV / h0));
    const h = dtV / n;
    for (let i = 0; i < n; i++) this._step(h);
    this.simTime += dtV;
    // Yay / genlik
    this._updateAmplitude(dtV);
  }

  _updateAmplitude(dt) {
    const S = this.spring;
    if (S <= 0.02) {
      if (this.running) { this.running = false; this.restSign = this.theta >= 0 ? 1 : -1; }
    } else if (!this.running && S > 0.1) {
      this.running = true;
      this.amp = Math.max(this.amp, 50 * DEG);
      this.phaseB = this.restSign >= 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    // Hedef genlik: 200° (boşalırken) … 300° (tam kurulu)
    const f = Math.min(1, S / 3.0);
    const target = this.running ? (195 + 105 * f) * DEG : 0;
    const k = 1 - Math.exp(-dt / 1.4);
    if (this.running) this.amp += (target - this.amp) * k;
  }

  _step(h) {
    const p = this.p;
    const w = TAU * L.BALANCE_HZ;
    if (this.running) {
      this.phaseB += w * h;
      this.theta = this.amp * Math.sin(this.phaseB);
    } else {
      // dur: balans ölü merkezin dışında bir hafif yerde durur
      const rest = this.restSign * (p.thetaE + 22 * DEG);
      const rate = 1 - Math.exp(-h / 0.35);
      this.theta += (rest - this.theta) * rate;
    }
    const psi = this.esc.psiOfTheta(this.theta);
    this.psi = psi;
    const lim = this.esc.limitPhi(this.phi, psi);
    let np;
    const drop = this.running ? 190 : 0;         // rad/s serbest düşüş hızı (≈10.000°/sn)
    if (lim.limit < this.phi) np = lim.limit;    // geri tepme
    else np = Math.min(this.phi + drop * h, lim.limit);
    const atLimit = np >= lim.limit - 1e-7;
    if (atLimit && this.beatFree && lim.stone >= 0 && this.running) {
      this.beatCount++;
      this.events.push({ type: 'tick', stone: lim.stone, strength: Math.min(1, this.amplitudeDeg / 280) });
    }
    this.beatFree = !atLimit;
    // Tren: çıkış çarkı açısı barrel'ı belirler → yay boşalır
    if (np !== this.phi) {
      const dPhi = np - this.phi;
      this.phi = np;
      const b = this.phi * RATIO.barrel;
      const dB = b - this.barrelPrev;
      this.barrelPrev = b;
      this.spring = Math.max(0, this.spring - dB / TAU);
      void dPhi;
    }
  }

  _updateStem(dt) {
    // kayma animasyonu
    const speed = 3.4;
    if (this.slide !== this.slideTarget) {
      const d = this.slideTarget - this.slide;
      const s = Math.min(Math.abs(d), speed * dt) * Math.sign(d);
      this.slide += s;
      this.slideBlend = Math.min(1, this.slideBlend + dt * 3.0);
      const tgt = this.slideTarget === 1 ? this.gammaSet() : this.gammaWind();
      const e = 1 - Math.pow(1 - this.slideBlend, 3);
      this.stemGamma = this.gammaFrom + (tgt - this.gammaFrom) * e;
      if (Math.abs(this.slideTarget - this.slide) < 1e-4) {
        this.slide = this.slideTarget;
        this.mode = this.slideTarget === 1 ? 'set' : 'wind';
        this.stemGamma = this.slideTarget === 1 ? this.gammaSet() : this.gammaWind();
      }
    } else {
      // kurma konumunda mil, mandala bağlı (otomatik kurma da tacı çevirir)
      if (this.mode === 'wind') this.stemGamma = this.gammaWind();
      else if (this.mode === 'set') this.stemGamma = this.gammaSet();
    }
  }

  _updateRotor(dt) {
    // Yerçekimi yönü bileğin oynamasıyla değişir
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const t = performance.now() / 1000;
      this.gravAng = 2.6 * Math.sin(t * 8.3) + 1.7 * Math.sin(t * 13.1 + 1.3) + 0.9 * Math.sin(t * 3.1);
    } else {
      this.gravAng *= Math.exp(-dt * 0.6);
    }
    const w0sq = 55, damp = 0.55;
    let steps = Math.ceil(dt / 0.004);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const gravTorque = this.shakeT > 0 || Math.abs(this.gravAng) > 0.02
        ? -w0sq * Math.sin(this.rotor - this.gravAng) : 0;
      this.rotorVel += (gravTorque - damp * this.rotorVel * 4) * h;
      // tek yönlü kavrama: yalnız CCW dönüşte pinyon sürülür
      this.moveRotor(this.rotorVel * h);
    }
  }

  /** Sekme arka plandayken geçen süreyi tam denge döngüleri halinde atla (saat gerçek zamanı tutar). */
  fastForward(seconds) {
    if (!this.running || this.timeScale !== 1 || seconds < 0.5) return;
    const p = this.p;
    let cycles = Math.floor(seconds * L.BALANCE_HZ);
    const dBarrel = RATIO.barrel * p.pitch;                // bir döngüde fıçı dönüşü (rad)
    const maxCycles = Math.floor(Math.max(0, this.spring - 0.04) / (dBarrel / TAU));
    cycles = Math.max(0, Math.min(cycles, maxCycles));
    if (!cycles) return;
    this.phi += cycles * p.pitch;
    this.phaseB += cycles * TAU;
    const b = this.phi * RATIO.barrel;
    this.spring = Math.max(0, this.spring - (b - this.barrelPrev) / TAU);
    this.barrelPrev = b;
    this.simTime += cycles / L.BALANCE_HZ;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // Yayı doldur / boşalt (hızlı test için)
  setSpring(turns) { this.spring = Math.max(0, Math.min(this.springMax, turns)); }
}
