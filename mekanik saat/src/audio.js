// Sentezlenmiş saat sesleri: çıkış "tik-tak", mandal tıkırtısı.
export class WatchAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this.noise = null;
    this.last = 0;
  }

  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      // gürültü tamponu
      const len = this.ctx.sampleRate * 0.25;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.enabled = true;
    return true;
  }

  disable() { this.enabled = false; }

  _burst({ freq, q, dur, gain, pitchPing, pingGain, rate = 1 }) {
    const c = this.ctx;
    const t = c.currentTime + 0.005;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
    if (pitchPing) {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(pitchPing, t);
      o.frequency.exponentialRampToValueAtTime(pitchPing * 0.82, t + dur);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(pingGain, t + 0.001);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.4);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + dur * 1.5 + 0.02);
    }
  }

  /** stone: 0 giriş (tik), 1 çıkış (tak). gain: 0..1 (yakınlığa göre). slow: yavaş çekim oranı */
  tick(stone, gain = 1, slow = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.last < 0.012) return;
    this.last = now;
    const g = 0.18 * gain;
    if (stone === 0) this._burst({ freq: 4200, q: 2.6, dur: 0.017, gain: g, pitchPing: 2400, pingGain: g * 0.16, rate: 1 * slow });
    else this._burst({ freq: 3100, q: 2.4, dur: 0.02, gain: g * 0.9, pitchPing: 1850, pingGain: g * 0.15, rate: 0.85 * slow });
  }

  click(gain = 1) {
    if (!this.enabled || !this.ctx) return;
    this._burst({ freq: 1500, q: 3.2, dur: 0.02, gain: 0.16 * gain, pitchPing: 900, pingGain: 0.03 * gain, rate: 0.7 });
  }

  clunk(gain = 1) {
    if (!this.enabled || !this.ctx) return;
    this._burst({ freq: 700, q: 1.5, dur: 0.08, gain: 0.28 * gain, pitchPing: 260, pingGain: 0.1 * gain, rate: 0.5 });
  }
}
