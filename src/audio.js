import { Radio } from './radio.js';

/** Procedural WebAudio: RPM-driven engine, start/stop, tyre squeal, wind, rain, crash, thunder, indicators. */
export class GameAudio {
  constructor() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;

    // engine: pulse-rich oscillators -> distortion -> lowpass
    const harm = 48, re = new Float32Array(harm), im = new Float32Array(harm);
    for (let n = 1; n < harm; n++) im[n] = 1 / Math.pow(n, 0.75);
    const wave = ctx.createPeriodicWave(re, im);
    this.o1 = ctx.createOscillator(); this.o2 = ctx.createOscillator(); this.o3 = ctx.createOscillator();
    for (const o of [this.o1, this.o2]) o.setPeriodicWave(wave);
    this.o3.type = 'sine';
    this.eGain = ctx.createGain(); this.eGain.gain.value = 0;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 1.2;
    const ws = ctx.createWaveShaper(); const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); } ws.curve = curve;
    const mix = ctx.createGain(); mix.gain.value = 0.4;
    this.o1.connect(mix); this.o2.connect(mix); this.o3.connect(mix);
    mix.connect(ws); ws.connect(this.lp); this.lp.connect(this.eGain); this.eGain.connect(this.master);
    this.o1.start(); this.o2.start(); this.o3.start();

    this.squeal = this.loop(900, 6, 'bandpass'); this.wind = this.loop(600, 0.7, 'lowpass'); this.rainS = this.loop(3500, 0.5, 'highpass');
    this.cyl = 4;
    this.radio = new Radio(ctx, this.master);
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'sawtooth'; this.sirenG = ctx.createGain(); this.sirenG.gain.value = 0;
    const sl = ctx.createBiquadFilter(); sl.type = 'lowpass'; sl.frequency.value = 2200;
    this.sirenOsc.connect(sl); sl.connect(this.sirenG); this.sirenG.connect(this.master); this.sirenOsc.start();
  }
  /** dist = metres to the nearest police car (Infinity = silent). */
  siren(dist) {
    const t = this.ctx.currentTime, vol = dist < 400 ? Math.min(0.12, 18 / (dist + 40)) : 0;
    this.sirenG.gain.setTargetAtTime(vol, t, 0.1);
    this.sirenOsc.frequency.setTargetAtTime(Math.floor(t * 2.2) % 2 ? 960 : 720, t, 0.04);
  }
  loop(freq, q, type) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start();
    return { g, f };
  }
  burst(dur, freq, vol, type = 'lowpass', delay = 0) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(), t = ctx.currentTime + delay;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur);
  }
  tone(freq, dur, vol, type = 'square') {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  }
  event(name) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    switch (name) {
      case 'tick': this.tone(1800, 0.03, 0.12); break;
      case 'tock': this.tone(1300, 0.03, 0.1); break;
      case 'crash': this.burst(0.35, 900, 0.7); this.tone(70, 0.3, 0.6, 'sine'); break;
      case 'crash-big': this.burst(0.8, 1400, 1); this.tone(55, 0.6, 0.9, 'sine'); break;
      case 'shift': this.burst(0.08, 600, 0.08); break;
      case 'horn': this.tone(420, 0.4, 0.2, 'sawtooth'); this.tone(530, 0.4, 0.15, 'sawtooth'); break;
      case 'stall': this.burst(0.25, 300, 0.3); break;
      case 'nofuel': this.tone(220, 0.25, 0.2, 'sawtooth'); break;
      case 'pump': this.tone(900, 0.04, 0.08); break;
    }
  }
  thunder(delay) { this.burst(3, 250, 1, 'lowpass', delay); this.burst(1.2, 700, 0.6, 'lowpass', delay); }
  /** state: off|starting|running */
  update(v, env, inside) {
    const ctx = this.ctx, t = ctx.currentTime, e = v.engine, d = v.def;
    const on = e.state !== 'off' || e.rpm > 60;
    const hz = (e.rpm / 60) * (d.cyl / 2);
    const cr = e.state === 'starting' ? 0.6 + 0.4 * Math.sin(e.crank * 38) : 1;
    this.o1.frequency.setTargetAtTime(Math.max(5, hz), t, 0.03);
    this.o2.frequency.setTargetAtTime(Math.max(5, hz * 1.007), t, 0.03);
    this.o3.frequency.setTargetAtTime(Math.max(5, hz * 0.5), t, 0.03);
    const thr = v.ctrl.throttle * (e.state === 'running' ? 1 : 0);
    this.eGain.gain.setTargetAtTime(on ? (0.1 + 0.28 * thr + 0.08 * (e.rpm / d.redline)) * cr * (inside ? 0.7 : 1) : 0, t, 0.05);
    this.lp.frequency.setTargetAtTime((220 + e.rpm * 0.55 + thr * 900) * (inside ? 0.55 : 1), t, 0.05);
    const sq = Math.max(0, Math.min(1, (v.t.slip - 0.22) * 3 + v.t.wheelspin * 0.6 + (v.t.locked ? 0.6 : 0))) * (v.speed > 4 ? 1 : 0) * (v.t.grounded > 0.5 ? 1 : 0);
    this.squeal.g.gain.setTargetAtTime(sq * 0.18, t, 0.04);
    this.squeal.f.frequency.setTargetAtTime(800 + v.speed * 8, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.35, (v.speed / 60) ** 2 * 0.35), t, 0.1);
    this.rainS.g.gain.setTargetAtTime(env.cur.rain * (inside ? 0.05 : 0.13), t, 0.3);
  }
}
