/** Generative in-car radio: four stations built from oscillators and noise (no audio files). */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CH = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], D7: [0, 4, 7, 10], P: [0, 7, 12] };

const STATIONS = [
  { name: 'Neon FM - synthwave', bpm: 104, swing: 0, prog: [[57, 'm'], [53, 'M'], [60, 'M'], [55, 'M']], style: 'synth' },
  { name: 'Lo-Fi 88 - chill beats', bpm: 78, swing: 0.18, prog: [[50, 'm7'], [55, 'D7'], [48, 'M7'], [57, 'm7']], style: 'lofi' },
  { name: 'Highway Rock', bpm: 128, swing: 0, prog: [[52, 'P'], [55, 'P'], [57, 'P'], [50, 'P']], style: 'rock' },
  { name: 'Smooth Jazz 92', bpm: 92, swing: 0.3, prog: [[50, 'm7'], [55, 'D7'], [48, 'M7'], [48, 'M7']], style: 'jazz' },
];

export class Radio {
  constructor(ctx, master) {
    this.ctx = ctx; this.gain = ctx.createGain(); this.gain.gain.value = 0; this.gain.connect(master);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 6000; this.lp.connect(this.gain);
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = nb;
    this.idx = -1; this.step = 0; this.next = 0; this.timer = null; this.vol = 0.6; this.active = true;
  }
  get name() { return this.idx < 0 ? 'Radio off' : STATIONS[this.idx].name; }
  nextStation() {
    this.idx = this.idx + 1 >= STATIONS.length ? -1 : this.idx + 1; this.step = 0; this.next = this.ctx.currentTime + 0.1;
    if (this.idx >= 0 && !this.timer) this.timer = setInterval(() => this.tick(), 90);
    if (this.idx < 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
    return this.name;
  }
  setLevel(active, vol) { this.active = active; this.vol = vol; this.gain.gain.setTargetAtTime(this.idx >= 0 && active ? 0.55 * vol : 0, this.ctx.currentTime, 0.12); }
  tick() {
    const st = STATIONS[this.idx]; if (!st) return;
    const stepDur = 60 / st.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.35) {
      const sw = this.step % 2 ? st.swing * stepDur : 0;
      this.play(st, this.step, this.next + sw);
      this.next += stepDur; this.step++;
    }
  }
  tone(f, t, dur, type, vol, cutoff = 4000, attack = 0.005) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(this.lp); o.start(t); o.stop(t + dur + 0.05);
  }
  perc(t, kind, vol = 0.5) {
    const c = this.ctx;
    if (kind === 'kick') { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(this.lp); o.start(t); o.stop(t + 0.22); return; }
    const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter(); s.buffer = this.noise;
    f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
    g.gain.setValueAtTime(vol * (kind === 'hat' ? 0.35 : 0.7), t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hat' ? 0.05 : 0.16));
    s.connect(f); f.connect(g); g.connect(this.lp); s.start(t, Math.random() * 0.5); s.stop(t + 0.2);
  }
  play(st, step, t) {
    const bar = Math.floor(step / 16), s16 = step % 16, [root, q] = st.prog[bar % st.prog.length], ch = CH[q], beat = Math.floor(s16 / 4), onBeat = s16 % 4 === 0;
    if (st.style === 'synth') {
      if (onBeat) this.perc(t, 'kick', 0.55); if (s16 === 4 || s16 === 12) this.perc(t, 'snare', 0.5); if (s16 % 2 === 0) this.perc(t, 'hat', 0.5);
      if (s16 % 2 === 0) this.tone(mtof(root - 12 + (s16 % 4 === 2 ? 12 : 0)), t, 0.2, 'sawtooth', 0.22, 700);
      if (s16 === 0) for (const i of ch) this.tone(mtof(root + 12 + i), t, 60 / st.bpm * 4, 'sawtooth', 0.05, 1800, 0.08);
      this.tone(mtof(root + 24 + ch[(s16 * 3 + bar) % ch.length]), t, 0.13, 'square', 0.07, 3200);
    } else if (st.style === 'lofi') {
      if (s16 === 0 || s16 === 10) this.perc(t, 'kick', 0.45); if (s16 === 4 || s16 === 12) this.perc(t, 'snare', 0.3); if (s16 % 4 === 2) this.perc(t, 'hat', 0.3);
      if (s16 === 0 || s16 === 8) this.tone(mtof(root - 12), t, 0.55, 'sine', 0.3, 600);
      if (s16 === 0 || s16 === 6 || s16 === 11) for (const i of ch) this.tone(mtof(root + i + (i > 7 ? 0 : 12)), t, 0.9, 'triangle', 0.07, 1500, 0.01);
      if (s16 % 8 === 5) this.perc(t, 'hat', 0.15);
    } else if (st.style === 'rock') {
      if (s16 === 0 || s16 === 8 || s16 === 10) this.perc(t, 'kick', 0.6); if (s16 === 4 || s16 === 12) this.perc(t, 'snare', 0.7); if (s16 % 2 === 0) this.perc(t, 'hat', 0.45);
      if (s16 % 2 === 0) { this.tone(mtof(root - 12), t, 0.2, 'sawtooth', 0.2, 900); for (const i of ch) this.tone(mtof(root + i), t, 0.2, 'sawtooth', 0.06, 2200, 0.002); }
    } else {
      if (s16 % 4 === 0) this.tone(mtof(root - 12 + [0, 4, 7, 5][beat] % 12), t, 0.45, 'sine', 0.3, 700);
      if (s16 % 4 === 0 || s16 % 8 === 6) this.perc(t, 'hat', 0.28);
      if (s16 === 4 || s16 === 12) this.perc(t, 'snare', 0.18);
      if (s16 === 0 || s16 === 7 || s16 === 10) for (const i of ch) this.tone(mtof(root + 12 + i), t, 0.7, 'triangle', 0.06, 1800, 0.01);
      if (s16 % 4 === 1 && Math.random() < 0.6) this.tone(mtof(root + 24 + ch[(step * 5) % ch.length]), t, 0.25, 'sine', 0.08, 3000);
    }
  }
}
