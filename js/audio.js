// Procedural sound effects via Web Audio — zero asset downloads, tiny and fast.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
    this._footstepT = 0;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // Shared 1s white-noise buffer.
    const len = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._startAmbience();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _now() { return this.ctx ? this.ctx.currentTime : 0; }
  _ok() { return this.ctx && this.enabled; }

  _noise(duration, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.001, decay = duration } = {}) {
    const t = this._now();
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + attack + decay + 0.05);
    return { filt, g };
  }

  _tone(freq, duration, { type = 'sine', gain = 0.3, attack = 0.002, endFreq = null } = {}) {
    const t = this._now();
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // Soft looping wind bed for atmosphere.
  _startAmbience() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 220;
    const g = this.ctx.createGain();
    g.gain.value = 0.028;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.012;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    lfo.start();
  }

  // ---- Game events ----

  shoot() {
    if (!this._ok()) return;
    this._noise(0.09, { type: 'lowpass', freq: 2600, gain: 0.55, decay: 0.09 });
    this._noise(0.05, { type: 'highpass', freq: 4000, gain: 0.18, decay: 0.05 });
    this._tone(150, 0.1, { type: 'triangle', gain: 0.5, endFreq: 55 });
  }

  dryFire() {
    if (!this._ok()) return;
    this._tone(1100, 0.04, { type: 'square', gain: 0.12, endFreq: 700 });
  }

  reloadStart() {
    if (!this._ok()) return;
    this._noise(0.06, { freq: 900, q: 4, gain: 0.3 });
    this._tone(330, 0.07, { type: 'square', gain: 0.12, endFreq: 190 });
  }

  reloadMid() {
    if (!this._ok()) return;
    this._noise(0.05, { freq: 1500, q: 5, gain: 0.28 });
  }

  reloadEnd() {
    if (!this._ok()) return;
    this._noise(0.06, { freq: 1200, q: 3, gain: 0.35 });
    this._tone(520, 0.08, { type: 'square', gain: 0.16, endFreq: 320 });
  }

  hit(crit) {
    if (!this._ok()) return;
    this._tone(crit ? 1500 : 1150, 0.07, { type: 'sine', gain: 0.28, endFreq: crit ? 900 : 750 });
  }

  kill() {
    if (!this._ok()) return;
    this._tone(480, 0.28, { type: 'sawtooth', gain: 0.22, endFreq: 60 });
    this._noise(0.35, { type: 'lowpass', freq: 900, gain: 0.5, decay: 0.35 });
    this._tone(880, 0.16, { type: 'sine', gain: 0.14, endFreq: 1400 });
  }

  enemyShoot() {
    if (!this._ok()) return;
    this._tone(950, 0.13, { type: 'sawtooth', gain: 0.1, endFreq: 300 });
  }

  playerHurt() {
    if (!this._ok()) return;
    this._tone(220, 0.18, { type: 'sawtooth', gain: 0.3, endFreq: 90 });
    this._noise(0.12, { type: 'lowpass', freq: 500, gain: 0.3, decay: 0.12 });
  }

  footstep() {
    if (!this._ok()) return;
    const t = performance.now();
    if (t - this._footstepT < 60) return;
    this._footstepT = t;
    this._noise(0.05, { type: 'lowpass', freq: 480 + Math.random() * 160, gain: 0.16, decay: 0.05 });
  }

  jump() {
    if (!this._ok()) return;
    this._noise(0.08, { type: 'lowpass', freq: 700, gain: 0.14, decay: 0.08 });
  }

  land() {
    if (!this._ok()) return;
    this._noise(0.09, { type: 'lowpass', freq: 380, gain: 0.3, decay: 0.09 });
  }

  ui() {
    if (!this._ok()) return;
    this._tone(660, 0.06, { type: 'sine', gain: 0.15, endFreq: 880 });
  }

  heartbeat() {
    if (!this._ok()) return;
    this._tone(58, 0.11, { type: 'sine', gain: 0.4, endFreq: 40 });
    setTimeout(() => this._ok() && this._tone(52, 0.09, { type: 'sine', gain: 0.3, endFreq: 38 }), 160);
  }

  grenadeThrow() {
    if (!this._ok()) return;
    this._noise(0.16, { type: 'bandpass', freq: 900, q: 1.2, gain: 0.18, decay: 0.16 });
  }

  grenadeBounce() {
    if (!this._ok()) return;
    this._tone(320, 0.05, { type: 'square', gain: 0.08, endFreq: 200 });
  }

  grenadeExplode() {
    if (!this._ok()) return;
    this._noise(0.5, { type: 'lowpass', freq: 700, gain: 0.65, decay: 0.5 });
    this._tone(110, 0.4, { type: 'triangle', gain: 0.5, endFreq: 30 });
    this._noise(0.12, { type: 'highpass', freq: 3000, gain: 0.2, decay: 0.12 });
  }

  bossSpawn() {
    if (!this._ok()) return;
    this._tone(80, 0.9, { type: 'sawtooth', gain: 0.3, endFreq: 45 });
    this._noise(0.7, { type: 'lowpass', freq: 300, gain: 0.3, decay: 0.7 });
    setTimeout(() => this._ok() && this._tone(160, 0.4, { type: 'square', gain: 0.12, endFreq: 70 }), 250);
  }

  pickupHealth() {
    if (!this._ok()) return;
    this._tone(523, 0.09, { type: 'sine', gain: 0.2 });
    setTimeout(() => this._ok() && this._tone(784, 0.14, { type: 'sine', gain: 0.2 }), 80);
  }

  pickupBoost() {
    if (!this._ok()) return;
    this._tone(440, 0.1, { type: 'sawtooth', gain: 0.14, endFreq: 880 });
    setTimeout(() => this._ok() && this._tone(880, 0.18, { type: 'sawtooth', gain: 0.12, endFreq: 1320 }), 90);
  }

  waveStart() {
    if (!this._ok()) return;
    this._tone(392, 0.14, { type: 'triangle', gain: 0.2 });
    setTimeout(() => this._ok() && this._tone(587, 0.2, { type: 'triangle', gain: 0.22 }), 130);
  }

  waveClear() {
    if (!this._ok()) return;
    this._tone(523, 0.12, { type: 'triangle', gain: 0.2 });
    setTimeout(() => this._ok() && this._tone(659, 0.12, { type: 'triangle', gain: 0.2 }), 110);
    setTimeout(() => this._ok() && this._tone(784, 0.25, { type: 'triangle', gain: 0.22 }), 220);
  }

  projectileImpact() {
    if (!this._ok()) return;
    this._noise(0.07, { freq: 2000, q: 2, gain: 0.14 });
  }
}

export const audio = new AudioEngine();
