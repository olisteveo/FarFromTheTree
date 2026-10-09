// Sound: the synthesized library in public/audio (tools/audio/build_audio.py), mixed live.
//
//   ambience  crossfades by where you are: harbour, street, Chinatown market, Times Square,
//             rooftop wind, tunnel drone, station echo, building sites, the park
//   wind      two wind beds blended by airspeed, plus the leaf's own paper flutter
//   world     positioned in 3D around the camera: trains roaring past, cab horns from real
//             nearby cabs, sirens, steam puffs, pigeons, gulls, kids in the park
//   events    tears, scrapes, layer-drop whooshes, tricks, vent blasts, deaths, planting
//
// Street sounds are muffled when you're underground.

import type { Glider } from "../sim/glider";
import type { CityData } from "../world/data";
import { TRAIN } from "../world/underground";

interface Entry { file: string; loop: boolean; gain: number; category: string; duration: number }
type Bank = Record<string, AudioBuffer>;

const AMBIENCES = ["amb_harbour", "amb_street", "amb_chinatown", "amb_timessquare", "amb_rooftop", "amb_park", "amb_construction", "amb_tunnel", "amb_station"] as const;
type Amb = (typeof AMBIENCES)[number];

interface Loop { src: AudioBufferSourceNode; gain: GainNode; level: number }

export class Audio {
  private ctx: AudioContext | null = null;
  private manifest: Record<string, Entry> = {};
  private bank: Bank = {};
  private master!: GainNode;
  private ambBus!: GainNode;
  private worldBus!: GainNode;
  private worldFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private loops = new Map<string, Loop>();
  private lastIntegrity = 1;
  private lastBoost = -99;
  private lastTrick = -99;
  private lastState = "";
  private heardTrains = new Map<string, number>();
  private nextHorn = 3;
  private nextCritter = 2;
  private nextSiren = 25;
  private steamPhase = new Map<object, number>();
  private wasInVent = false;
  private t = 0;
  private loading: Promise<void> | null = null;

  constructor(private city: CityData) {}

  /** Call on the first user gesture (browsers only allow sound after one). */
  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    this.worldFilter = ctx.createBiquadFilter(); this.worldFilter.type = "lowpass"; this.worldFilter.frequency.value = 20000;
    this.worldBus = ctx.createGain(); this.worldBus.connect(this.worldFilter).connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.loading = this.load();
  }

  private async load() {
    const ctx = this.ctx!;
    try {
      const m = await (await fetch("./audio/manifest.json")).json();
      this.manifest = m.sounds;
    } catch { return; }
    // ambience and wind first, then everything else
    const names = Object.keys(this.manifest).sort((a, b) => Number(this.manifest[b].loop) - Number(this.manifest[a].loop));
    await Promise.all(names.map(async (n) => {
      try {
        const buf = await (await fetch(`./audio/${this.manifest[n].file}`)).arrayBuffer();
        this.bank[n] = await ctx.decodeAudioData(buf);
        if (this.manifest[n].loop) this.ensureLoop(n);
      } catch { /* missing sound: stay quiet */ }
    }));
  }

  private ensureLoop(name: string) {
    const ctx = this.ctx!, buf = this.bank[name];
    if (!buf || this.loops.has(name)) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const bus = name.startsWith("amb_wind") || name === "leaf_flutter_loop" ? this.sfxBus : this.ambBus;
    src.connect(gain).connect(bus);
    src.start(0, Math.random() * buf.duration);
    this.loops.set(name, { src, gain, level: 0 });
  }

  private setLoop(name: string, level: number, time = 1.2) {
    const l = this.loops.get(name);
    if (!l || !this.ctx) return;
    const target = level * (this.manifest[name]?.gain ?? 1);
    if (Math.abs(target - l.level) < 0.005) return;
    l.level = target;
    l.gain.gain.setTargetAtTime(target, this.ctx.currentTime, time / 3);
  }

  /** A one-shot, optionally positioned in the world. */
  play(name: string, opts: { at?: [number, number, number]; vol?: number; rate?: number; world?: boolean } = {}) {
    const ctx = this.ctx, buf = this.bank[name];
    if (!ctx || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = (opts.vol ?? 1) * (this.manifest[name]?.gain ?? 1);
    let node: AudioNode = src.connect(g);
    let panner: PannerNode | null = null;
    if (opts.at) {
      panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 8;
      panner.rolloffFactor = 1.1;
      panner.maxDistance = 400;
      panner.positionX.value = opts.at[0]; panner.positionY.value = opts.at[1]; panner.positionZ.value = opts.at[2];
      node = node.connect(panner);
    }
    node.connect(opts.world ? this.worldBus : this.sfxBus);
    src.start();
    return { src, panner };
  }

  reset() { this.lastIntegrity = 1; this.lastState = ""; }

  update(dt: number, leaf: Glider, cam: { position: { x: number; y: number; z: number }; matrixWorld: { elements: number[] } }, district: string) {
    const ctx = this.ctx;
    if (!ctx || !this.loading) return;
    this.t += dt;
    const now = ctx.currentTime;
    // the listener follows the camera
    const L = ctx.listener, p = cam.position, e = cam.matrixWorld.elements;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, now, 0.02); L.positionY.setTargetAtTime(p.y, now, 0.02); L.positionZ.setTargetAtTime(p.z, now, 0.02);
      L.forwardX.setTargetAtTime(-e[8], now, 0.02); L.forwardY.setTargetAtTime(-e[9], now, 0.02); L.forwardZ.setTargetAtTime(-e[10], now, 0.02);
      L.upX.setTargetAtTime(e[4], now, 0.02); L.upY.setTargetAtTime(e[5], now, 0.02); L.upZ.setTargetAtTime(e[6], now, 0.02);
    }

    // ---------------------------------------------------------------- where are we?
    const lp = leaf.pos, flow = leaf.flow, under = lp.y < -0.4;
    const s = this.city.route.nearest(lp.x, lp.z).s;
    const sub = this.city.subway.nearest(lp.x, lp.z);
    const inStation = under && !!flow.under.stationAt(sub.s);
    const H = this.city.canopy(lp.x, lp.z, 14);
    const roof = !under && lp.y > Math.max(12, H * 0.9);
    const nearSite = this.city.raw.sites.some((st) => { const r = st.p[0]; return Math.hypot(r[0] - lp.x, r[1] - lp.z) < 90; });
    const want: Record<Amb, number> = { amb_harbour: 0, amb_street: 0, amb_chinatown: 0, amb_timessquare: 0, amb_rooftop: 0, amb_park: 0, amb_construction: 0, amb_tunnel: 0, amb_station: 0 };
    if (under) { want.amb_tunnel = inStation ? 0.35 : 1; want.amb_station = inStation ? 1 : 0; }
    else {
      const street: Amb = district === "Battery Park" ? "amb_harbour" : district === "Central Park" ? "amb_park"
        : district === "Chinatown" || district === "Little Italy" ? "amb_chinatown"
        : s > 6000 && s < 6750 ? "amb_timessquare" : "amb_street";
      if (roof) { want.amb_rooftop = 1; want[street] = 0.3; }
      else { want[street] = 1; want.amb_rooftop = Math.min(0.4, lp.y / 40); }
      if (nearSite) want.amb_construction = roof ? 0.25 : 0.6;
    }
    for (const a of AMBIENCES) { this.ensureLoop(a); this.setLoop(a, want[a] * 0.9, 1.5); }

    // ---------------------------------------------------------------- wind and flutter
    const air = leaf.state === "flying" ? leaf.airspeed : 0.5;
    const k = Math.min(1, air / 16);
    this.ensureLoop("amb_wind_low"); this.ensureLoop("amb_wind_high"); this.ensureLoop("leaf_flutter_loop");
    this.setLoop("amb_wind_low", 0.35 + 0.4 * (1 - k), 0.3);
    this.setLoop("amb_wind_high", 0.9 * k * k, 0.2);
    this.setLoop("leaf_flutter_loop", leaf.state === "flying" ? Math.min(1, air / 10) * (0.5 + (1 - leaf.integrity)) : 0, 0.15);
    const fl = this.loops.get("leaf_flutter_loop");
    if (fl) fl.src.playbackRate.setTargetAtTime(0.85 + k * 0.5, now, 0.1);
    // muffle the street when underground
    this.worldFilter.frequency.setTargetAtTime(under ? 900 : 20000, now, 0.3);

    // ---------------------------------------------------------------- the world around you
    // trains: one pass sound per train that comes near (keyed by the train's fixed phase)
    for (const tr of flow.trainsAt(leaf.clock)) {
      const mid = (tr.head + tr.tail) / 2;
      const d = Math.abs(mid - sub.s);
      const id = `${tr.dir}:${Math.round((tr.head - tr.dir * TRAIN.speed * leaf.clock) / 50)}`;
      if (d < 140 && (under || sub.d < 40) && !this.heardTrains.has(id)) {
        this.heardTrains.set(id, this.t);
        const a = this.city.subway.at(Math.max(0, Math.min(this.city.subway.length, mid)));
        this.play(tr.dir > 0 ? "train_pass_uptown" : "train_pass_downtown", { at: [a.x, -6, a.z], vol: under ? 1 : 0.45, world: !under });
        if (under && flow.under.stationAt(mid) && Math.random() < 0.6) this.play("train_arrive", { at: [a.x, -6, a.z], vol: 0.6 });
      }
    }
    for (const [id, t] of this.heardTrains) if (this.t - t > 20) this.heardTrains.delete(id);

    if (!under && leaf.state === "flying") {
      // cab horns from real nearby cabs
      if ((this.nextHorn -= dt) < 0) {
        this.nextHorn = 2.5 + Math.random() * 5;
        const near = flow.traffic.grid.around(lp.x, lp.z, 70, []);
        if (near.length) {
          const v = near[Math.floor(Math.random() * near.length)];
          const name = v.v.kind === "bus" ? "bus_brake_hiss" : v.v.kind === "truck" ? "car_horn_long" : `cab_horn_${1 + Math.floor(Math.random() * 4)}`;
          this.play(name, { at: [v.x, 1.2, v.z], vol: roof ? 0.4 : 0.9, world: true });
        }
      }
      if ((this.nextSiren -= dt) < 0) {
        this.nextSiren = 45 + Math.random() * 60;
        const a = this.city.route.at(s + (Math.random() < 0.5 ? -60 : 60));
        this.play("siren_pass", { at: [a.x + (Math.random() - 0.5) * 80, 2, a.z], vol: 0.7, world: true });
      }
      // critters and people
      if ((this.nextCritter -= dt) < 0) {
        this.nextCritter = 3 + Math.random() * 6;
        const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
        const name = district === "Battery Park" ? pick(["gull_cry", "gull_cry", "pigeon_coo"])
          : district === "Central Park" ? pick(["crow_caw", "kid_shout_1", "kid_shout_2", "kid_shout_3", "kid_laugh", "dog_bark"])
          : roof ? pick(["pigeon_coo", "pigeon_flap", "pigeon_coo"])
          : pick(["pigeon_flap", "pigeon_coo", "man_shout_hey", "kid_shout_1"]);
        const ang = Math.random() * 6.283, dist = 12 + Math.random() * 40;
        this.play(name, { at: [lp.x + Math.cos(ang) * dist, Math.max(1, lp.y + (Math.random() - 0.5) * 10), lp.z + Math.sin(ang) * dist], vol: 0.7, world: true });
      }
      // steam: a hiss each time a nearby vent puffs
      for (const st of flow.life.steamGrid.around(lp.x, lp.z, 40, [])) {
        const ph = ((leaf.clock + st.phase) / st.period) % 1;
        const prev = this.steamPhase.get(st) ?? ph;
        this.steamPhase.set(st, ph);
        if (prev < 0.2 && ph >= 0.2 && Math.hypot(st.x - lp.x, st.z - lp.z) < 40) this.play("steam_hiss", { at: [st.x, 1, st.z], vol: 0.8, world: true, rate: 0.9 + Math.random() * 0.2 });
      }
    }

    // ---------------------------------------------------------------- what the leaf does
    if (leaf.integrity < this.lastIntegrity - 0.02) {
      const dmg = this.lastIntegrity - leaf.integrity;
      this.play(dmg > 0.15 ? "leaf_tear_big" : "leaf_tear_small", { vol: 0.9 });
      this.play("leaf_hit_wall", { vol: Math.min(1, dmg * 4 + 0.3) });
    }
    this.lastIntegrity = leaf.integrity;
    if (leaf.boost.t > this.lastBoost) {
      this.lastBoost = leaf.boost.t;
      this.play(/Roof to subway/.test(leaf.boost.kind) ? "whoosh_drop_big" : "whoosh_drop");
    }
    if (leaf.tricks.lastAt > this.lastTrick) {
      this.lastTrick = leaf.tricks.lastAt;
      this.play(leaf.tricks.last === "loop" ? "loop_whoosh" : "corkscrew_whoosh", { vol: 0.8 });
    }
    // shot up a vent shaft
    const inVent = !!flow.under.openingAt(lp.x, lp.z) && lp.y < 0.5 && lp.y > -3 && leaf.vel.y > 6;
    if (inVent && !this.wasInVent) this.play("vent_blast");
    this.wasInVent = inVent;
    // endings
    if (leaf.state !== this.lastState) {
      if (leaf.state === "dead") {
        const f = leaf.failure;
        if (/puddle/.test(f)) this.play("puddle_splash");
        else if (/manhole/.test(f)) this.play("manhole_fall");
        else if (/train/.test(f)) this.play("train_hit");
        else if (/rat/.test(f)) this.play("cat_hiss", { rate: 1.6 });
        else this.play("leaf_tear_big");
        if (/cab/.test(f)) this.play("cab_horn_2", { vol: 0.8 });
      } else if (leaf.state === "planted") {
        this.play("seed_plant");
        setTimeout(() => this.play("crowd_cheer", { vol: 0.8 }), 600);
        setTimeout(() => this.play("achievement_chime"), 1400);
      }
      this.lastState = leaf.state;
    }
  }

  ui(name: "ui_click" | "ui_back" | "achievement_chime") { this.play(name); }
}
