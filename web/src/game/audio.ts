// Procedural sound: wind roaring past the leaf (louder and brighter with
// airspeed), the rumble of trains below, and a soft tear when the leaf hits.

import type { Glider } from "../sim/glider";

export class Audio {
  private ctx: AudioContext | null = null;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private lastIntegrity = 1;

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    // brown noise
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
    // train rumble
    const r = ctx.createBufferSource();
    r.buffer = this.noise;
    r.loop = true;
    r.playbackRate.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    r.connect(lp).connect(this.rumbleGain).connect(this.master);
    r.start();
  }

  update(leaf: Glider) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const air = leaf.state === "flying" ? leaf.airspeed : 1;
    const wind = Math.min(1, air / 14);
    this.windGain.gain.setTargetAtTime(0.05 + wind * 0.55, t, 0.08);
    this.windFilter.frequency.setTargetAtTime(280 + wind * 1600, t, 0.08);
    // nearest train
    let near = 1e9;
    const ss = leaf.flow.city.subway.nearest(leaf.pos.x, leaf.pos.z).s;
    for (const tr of leaf.flow.trainsAt(leaf.clock)) {
      const lo = Math.min(tr.head, tr.tail), hi = Math.max(tr.head, tr.tail);
      near = Math.min(near, Math.hypot(Math.max(lo - ss, 0, ss - hi), leaf.pos.y + 7));
    }
    const rumble = Math.max(0, 1 - near / 160) * (leaf.pos.y < -0.4 ? 1 : 0.35);
    this.rumbleGain.gain.setTargetAtTime(rumble * 0.9, t, 0.1);
    if (leaf.integrity < this.lastIntegrity - 0.02) this.tear(this.lastIntegrity - leaf.integrity);
    this.lastIntegrity = leaf.integrity;
  }

  reset() {
    this.lastIntegrity = 1;
  }

  private tear(amount: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.9, 0.25 + amount * 3), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.playbackRate.value = 2.5;
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, 0.2);
  }
}
