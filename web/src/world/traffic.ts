// Traffic on the real streets: yellow cabs, cars, buses and trucks driving the actual lanes (world/roadNet.ts). They
// follow each other, stop at red lights, wait for room before entering a junction and take turns through it. A fixed-step
// simulation from a fixed start, and the state at time t depends only on t, so every run sees the same traffic, like the
// plan's fixed wind.
//
// For the leaf a vehicle is both a danger (getting hit tears you) and a gift: the
// slipstream behind it drags the air along, the plan's "vehicle drafting".

import { Grid, type CityData } from "./data";
import { buildRoadNet, type RoadNet } from "./roadNet";
import { SIGNAL, signalState, sinceGreen, type SignalNode } from "./signals";

export type VehicleKind = "cab" | "car" | "suv" | "van" | "bus" | "truck" | "police" | "ambulance" | "firetruck" | "garbage" | "schoolbus" | "tourbus" | "foodtruck" | "pickup" | "hatch" | "limo" | "sports" | "scooter";
export const VEHICLE_SIZE: Record<VehicleKind, { l: number; w: number; h: number }> = {
  cab: { l: 4.9, w: 1.9, h: 1.55 },
  car: { l: 4.6, w: 1.85, h: 1.45 },
  suv: { l: 4.9, w: 1.95, h: 1.8 },
  van: { l: 5.5, w: 2.0, h: 2.4 },
  police: { l: 5.0, w: 1.9, h: 1.5 },
  ambulance: { l: 6.5, w: 2.3, h: 2.8 },
  firetruck: { l: 10.5, w: 2.5, h: 3.3 },
  garbage: { l: 9, w: 2.5, h: 3.4 },
  schoolbus: { l: 11, w: 2.5, h: 3.2 },
  tourbus: { l: 12, w: 2.6, h: 4.3 },
  foodtruck: { l: 7, w: 2.4, h: 3.0 },
  pickup: { l: 5.6, w: 2.0, h: 1.85 },
  hatch: { l: 4.0, w: 1.75, h: 1.5 },
  limo: { l: 8.5, w: 1.9, h: 1.45 },
  sports: { l: 4.5, w: 1.9, h: 1.25 },
  scooter: { l: 1.9, w: 0.7, h: 1.6 },
  bus: { l: 12, w: 2.6, h: 3.2 },
  truck: { l: 8.5, w: 2.5, h: 3.4 },
};

interface Chain {
  name: string;
  x: Float32Array;
  z: Float32Array;
  cum: Float32Array; // distance at each vertex
  length: number;
  dir: number; // +1 traffic along vertex order, -1 against, 0 both
  width: number;
  lanes: number;
}

export interface Vehicle {
  kind: VehicleKind;
  colorSeed: number;
}

export interface VehicleState {
  x: number; z: number; tx: number; tz: number; speed: number; v: Vehicle;
  /** 0..1: how hard it's braking, for the brake lights and the nose dipping */
  brake: number;
  /** metres driven, for the wheels */
  odo: number;
  /** 0..1: comes up as it joins from the edge of the map, and goes as it leaves */
  fade: number;
}

/** How the traffic drives. */
export const DRIVE = {
  tick: 0.1, spacing: 20, warmup: 45,
  // New York following distances
  gapTime: 0.85, gapMin: 1.8, comfyBrake: 2.8, hardBrake: 4.5,
  /** a vehicle stuck this long with a green light in a gridlock gives up and leaves the map */
  giveUp: 150,
};

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

export class Traffic {
  readonly chains: Chain[] = [];
  readonly vehicles: Vehicle[] = [];
  /** Vehicles placed at the current time, indexed by position (rebuilt by update). */
  readonly now: VehicleState[] = [];
  readonly grid = new Grid<VehicleState>(24);
  /** Closed areas (the blockers): no vehicle drives inside them. Set before the first update. */
  closed: { x: number; z: number; r: number }[] = [];
  /** The signalled junctions (render/streetLayout.ts finds them). Set before the first update. */
  signals: SignalNode[] = [];
  private t = -1;
  /** the time the vehicles were last placed at */
  get time() { return this.t; }

  constructor(private city: CityData) {
    // stitch centreline segments with the same name into long chains
    const segs = city.raw.streets.filter((s) => s.rw === 1 && s.p.length >= 4);
    const byName = new Map<string, typeof segs>();
    for (const s of segs) (byName.get(s.n) ?? byName.set(s.n, []).get(s.n)!).push(s);
    for (const [name, list] of byName) {
      const used = new Set<number>();
      for (let i = 0; i < list.length; i++) {
        if (used.has(i)) continue;
        used.add(i);
        let pts = pairs(list[i].p);
        const dirSign = list[i].d;
        // grow forwards then backwards by joining segments whose ends touch
        for (let grow = 0; grow < 2; grow++) {
          for (let again = true; again;) {
            again = false;
            const end = pts[pts.length - 1];
            for (let j = 0; j < list.length; j++) {
              if (used.has(j)) continue;
              const q = pairs(list[j].p);
              const sameDir = list[j].d === dirSign || list[j].d === 0 || dirSign === 0;
              if (!sameDir) continue;
              if (close(q[0], end)) { pts = pts.concat(q.slice(1)); used.add(j); again = true; break; }
              if (close(q[q.length - 1], end) && list[j].d === 0) { pts = pts.concat(q.reverse().slice(1)); used.add(j); again = true; break; }
            }
          }
          pts.reverse();
        }
        const n = pts.length;
        const x = new Float32Array(n), z = new Float32Array(n), cum = new Float32Array(n);
        for (let k = 0; k < n; k++) { x[k] = pts[k][0]; z[k] = pts[k][1]; if (k) cum[k] = cum[k - 1] + Math.hypot(x[k] - x[k - 1], z[k] - z[k - 1]); }
        if (cum[n - 1] < 60) continue;
        this.chains.push({ name, x, z, cum, length: cum[n - 1], dir: dirSign, width: list[i].w, lanes: Math.max(1, list[i].l) });
      }
    }
  }

  // ------------------------------------------------------------------ the simulation

  private net: RoadNet | null = null;
  private n = 0;
  private laneOf!: Int32Array; private sAt!: Float64Array; private vel!: Float64Array; private odo!: Float64Array;
  private vMax!: Float32Array; private accel!: Float32Array; private bodyL!: Float32Array; private brake!: Float32Array; private waited!: Float32Array;
  /** the connector each vehicle is committed to (-1 none), and the one it's still clearing */
  private next!: Int32Array; private holding!: Int32Array; private trips!: Int32Array;
  private px!: Float64Array; private pz!: Float64Array; private ptx!: Float32Array; private ptz!: Float32Array;
  private cx!: Float64Array; private cz!: Float64Array; private ctx!: Float32Array; private ctz!: Float32Array;
  /** each lane's vehicles, front first */
  private onLane: number[][] = [];
  /** who's using each connector: on it, committed to it, or still clearing it */
  private using!: Int32Array;
  private simT = 0;
  private start: { t: number; f: Float64Array[]; f32: Float32Array[]; i32: Int32Array[]; lanes: number[][] } | null = null;
  private sources: number[] = [];
  private edgeIn: boolean[] = [];
  private spawnAt = 0;
  private pool: VehicleState[] = [];

  private ensureNet() {
    if (this.net) return;
    const net = (this.net = buildRoadNet(this.city, this.closed, this.signals));
    this.sources = net.blockLanes.filter((l) => !net.lanes[l].fed);
    if (!this.sources.length) this.sources = net.blockLanes;
    this.onLane = net.lanes.map(() => []);
    this.edgeIn = net.lanes.map((l) => l.node < 0 && !l.fed);
    this.using = new Int32Array(net.lanes.length);
    // populate each lane: mostly cabs (this is Manhattan), spaced so there's room to queue at the lights
    const found: { lane: number; s: number; id: number }[] = [];
    let id = 1;
    for (const l of net.blockLanes) {
      const L = net.lanes[l];
      let s = h01(id * 13 + l) * DRIVE.spacing;
      while (s < L.len - 7) {
        found.push({ lane: l, s, id });
        id++;
        // (never closer than the longest vehicle could fit)
        s += Math.max(15, DRIVE.spacing * (0.55 + h01(id * 3) * 0.9));
      }
    }
    const n = (this.n = found.length);
    this.laneOf = new Int32Array(n); this.sAt = new Float64Array(n); this.vel = new Float64Array(n); this.odo = new Float64Array(n);
    this.vMax = new Float32Array(n); this.accel = new Float32Array(n); this.bodyL = new Float32Array(n); this.brake = new Float32Array(n); this.waited = new Float32Array(n);
    this.next = new Int32Array(n).fill(-1); this.holding = new Int32Array(n).fill(-1); this.trips = new Int32Array(n);
    this.px = new Float64Array(n); this.pz = new Float64Array(n); this.ptx = new Float32Array(n); this.ptz = new Float32Array(n);
    this.cx = new Float64Array(n); this.cz = new Float64Array(n); this.ctx = new Float32Array(n); this.ctz = new Float32Array(n);
    this.vehicles.length = 0;
    found.forEach((f, i) => {
      const r = h01(f.id * 7), kind = pickKind(r, h01(f.id * 29));
      const heavy = VEHICLE_SIZE[kind].l > 7;
      this.vehicles.push({ kind, colorSeed: f.id });
      this.pool.push({ x: 0, z: 0, tx: 0, tz: 1, speed: 0, v: this.vehicles[i], brake: 0, odo: 0, fade: 1 });
      this.laneOf[i] = f.lane; this.sAt[i] = f.s;
      this.vMax[i] = (heavy ? 8.5 : 10.5) + h01(f.id * 17) * 3.5;
      this.accel[i] = heavy ? 1.1 : 1.9 + h01(f.id * 19) * 0.8;
      this.bodyL[i] = VEHICLE_SIZE[kind].l;
      this.vel[i] = this.vMax[i] * 0.6;
      this.onLane[f.lane].push(i);
    });
    // front first
    for (const list of this.onLane) list.sort((a, b) => this.sAt[b] - this.sAt[a]);
    // run it up from before the clock starts, so queues have formed by the first frame anyone sees
    this.simT = -DRIVE.warmup;
    this.place(this.cx, this.cz, this.ctx, this.ctz);
    while (this.simT < 0) this.step();
    this.start = {
      t: this.simT,
      f: [this.sAt, this.vel, this.odo, this.px, this.pz, this.cx, this.cz].map((a) => a.slice()),
      f32: [this.brake, this.waited, this.ptx, this.ptz, this.ctx, this.ctz].map((a) => a.slice()),
      i32: [this.laneOf, this.next, this.holding, this.trips, this.using].map((a) => a.slice()),
      lanes: this.onLane.map((l) => [...l]),
    };
  }

  private restore() {
    const s = this.start!;
    [this.sAt, this.vel, this.odo, this.px, this.pz, this.cx, this.cz].forEach((a, i) => a.set(s.f[i]));
    [this.brake, this.waited, this.ptx, this.ptz, this.ctx, this.ctz].forEach((a, i) => a.set(s.f32[i]));
    [this.laneOf, this.next, this.holding, this.trips, this.using].forEach((a, i) => a.set(s.i32[i]));
    this.onLane = s.lanes.map((l) => [...l]);
    this.simT = s.t;
    this.spawnAt = 0;
  }

  /** May this vehicle start through this connector now? */
  private mayEnter(i: number, conn: number, signalOpen: boolean): boolean {
    if (!signalOpen) return false;
    const net = this.net!, c = net.lanes[conn];
    // the street data splits blocks mid-way: no junction there, so just follow whoever's ahead
    if (c.len < 1 && !c.conflicts.length) return true;
    for (const other of c.conflicts) if (this.using[other] > 0) return false;
    return this.mayEnterRoom(i, conn);
  }

  /** Room on the far side for all of it, counting everyone already headed there. A piece of road shorter than the
   *  vehicle can never have that: it only has to be clear to drive on through. */
  private mayEnterRoom(i: number, conn: number): boolean {
    const net = this.net!, c = net.lanes[conn];
    if (c.len < 1 && !c.conflicts.length) return true;
    const to = c.out[0], list = this.onLane[to], need = Math.min(this.bodyL[i] + DRIVE.gapMin + 1, net.lanes[to].len * 0.9);
    let room = net.lanes[to].len;
    if (list.length) { const tail = list[list.length - 1]; room = this.sAt[tail] - this.bodyL[tail] / 2; }
    for (const inbound of this.headingTo(to)) room -= this.bodyL[inbound] + DRIVE.gapMin;
    return room >= need;
  }

  /** Vehicles committed to or on a connector into this lane. */
  private headingTo(lane: number): number[] {
    const out: number[] = [];
    for (const c of this.intoLane[lane] ?? []) {
      if (this.using[c] === 0) continue;
      for (const v of this.onLane[c]) out.push(v);
      for (const v of this.committedTo[c] ?? []) if (this.laneOf[v] !== c) out.push(v);
    }
    return out;
  }
  private intoLane: number[][] = [];
  private committedTo: number[][] = [];

  private step() {
    const net = this.net!, lanes = net.lanes, dt = DRIVE.tick;
    const t = this.simT + dt;
    if (!this.intoLane.length) {
      this.intoLane = lanes.map(() => []);
      for (const l of lanes) if (l.node >= 0) this.intoLane[l.out[0]].push(l.id);
    }
    this.committedTo = lanes.map(() => []);
    for (let i = 0; i < this.n; i++) if (this.next[i] >= 0) this.committedTo[this.next[i]].push(i);
    const acc = this.sharedAcc ?? (this.sharedAcc = new Float64Array(this.n));
    // ---- decide
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li], list = this.onLane[li];
      if (!list.length) continue;
      const isBlock = lane.node < 0;
      const node = isBlock && lane.out.length ? net.nodes[lanes[lane.out[0]].node] : null;
      let state = 2, fresh = false;
      if (node && node.signal >= 0 && lane.group >= 0) {
        const sig = this.signals[node.signal];
        state = signalState(t, lane.group, sig.offset).vehicle;
        fresh = state === 2 && sinceGreen(t, lane.group, sig.offset) < SIGNAL.reaction;
      }
      for (let k = 0; k < list.length; k++) {
        const i = list[k], half = this.bodyL[i] / 2, v = this.vel[i];
        let limit = this.vMax[i] * lane.bend;
        // what's ahead: the one in front on this lane, the stop line, or whoever's on the far side
        let gap = 1e9, leadV = limit;
        if (k > 0) {
          const f = list[k - 1];
          gap = this.sAt[f] - this.bodyL[f] / 2 - this.sAt[i] - half; leadV = this.vel[f];
        }
        const toEnd = lane.len - this.sAt[i] - half;
        if (isBlock) {
          // decide about 3.5 s out. Only the front of the queue may: one behind a blocked leader reserving the junction
          // would hold up the cross traffic for nothing, which is how a grid locks solid
          const deciding = Math.max(8, v * 3.5);
          const clearAhead = k === 0 || this.next[list[k - 1]] >= 0;
          if (lane.out.length && this.next[i] < 0 && clearAhead && toEnd < deciding) {
            // pick where it's headed now, the same way every run, and go only if it can get all the way through
            const choice = this.chooseExit(i, lane);
            const stopping = v * v / (2 * DRIVE.hardBrake) + 1 < toEnd;
            // (a driver sitting at the line takes a moment to go when it changes)
            const open = (state === 2 && !(fresh && v < 0.5)) || (state === 1 && !stopping);
            if (this.mayEnter(i, choice, open)) { this.next[i] = choice; this.using[choice]++; this.committedTo[choice].push(i); this.waited[i] = 0; }
            else if (state === 2) this.waited[i] += dt;
          }
          if (lane.out.length && this.next[i] < 0 && toEnd < gap && toEnd < Math.max(12, v * 4.5)) { gap = toEnd + DRIVE.gapMin * 0.6; leadV = 0; }
          else if (k === 0 && this.next[i] >= 0) {
            const g = this.gapBeyond(this.next[i], toEnd);
            if (g[0] < gap) { gap = g[0]; leadV = g[1]; }
          }
        } else if (k === 0) {
          const g = this.gapBeyond(lane.out[0], toEnd, true);
          if (g[0] < gap) { gap = g[0]; leadV = g[1]; }
        }
        // the Intelligent Driver Model: the usual way to make a queue behave like one
        const want = DRIVE.gapMin + Math.max(0, v * DRIVE.gapTime + (v * (v - leadV)) / (2 * Math.sqrt(this.accel[i] * DRIVE.comfyBrake)));
        const a = this.accel[i] * (1 - Math.pow(Math.max(0, v) / Math.max(0.5, limit), 4) - (want / Math.max(0.3, gap)) ** 2);
        acc[i] = Math.max(-DRIVE.hardBrake * 1.6, Math.min(this.accel[i], a));
      }
    }
    // ---- move
    this.pxSwap();
    const leaving: number[] = [];
    for (let li = 0; li < lanes.length; li++) {
      const list = this.onLane[li];
      for (const i of list) {
        const v0 = this.vel[i];
        const v1 = Math.max(0, v0 + acc[i] * dt);
        const ds = v0 * dt + 0.5 * (v1 - v0) * dt;
        this.vel[i] = v1;
        this.sAt[i] += Math.max(0, ds);
        this.odo[i] += Math.max(0, ds);
        this.brake[i] += ((acc[i] < -0.4 || v1 < 0.3 ? 1 : 0) - this.brake[i]) * 0.5;
        if (this.holding[i] >= 0 && lanes[li].node < 0 && this.sAt[i] > this.bodyL[i] * 0.5 + 1) { this.using[this.holding[i]]--; this.holding[i] = -1; }
      }
      // whatever the following model asked for, nobody drives through the vehicle in front (a shift across a junction
      // can drop a car in tight behind another; it waits for the gap to open)
      for (let k = 1; k < list.length; k++) {
        const f = list[k - 1], i = list[k], most = this.sAt[f] - this.bodyL[f] / 2 - this.bodyL[i] / 2 - 0.5;
        if (this.sAt[i] > most) { this.sAt[i] = Math.max(0, most); this.vel[i] = Math.min(this.vel[i], this.vel[f]); }
      }
      while (list.length && this.sAt[list[0]] >= lanes[li].len) leaving.push(list.shift()!);
    }
    // ---- across to the next lane
    for (const i of leaving) {
      const li = this.laneOf[i], lane = lanes[li];
      const over = this.sAt[i] - lane.len;
      if (lane.node >= 0) {
        this.toLane(i, lane.out[0], over);
      } else if (this.next[i] >= 0) {
        const c = this.next[i];
        this.next[i] = -1;
        // (over a short piece of road it can reach the next junction before clearing the last)
        if (this.holding[i] >= 0) this.using[this.holding[i]]--;
        this.holding[i] = c;
        this.toLane(i, c, over);
      } else {
        this.respawn(i); // the end of the mapped streets
      }
    }
    // ---- a gridlock doesn't last forever
    for (let i = 0; i < this.n; i++) if (this.waited[i] > DRIVE.giveUp && this.next[i] < 0) { const l = this.onLane[this.laneOf[i]]; const k = l.indexOf(i); if (k >= 0) { l.splice(k, 1); this.respawn(i); } }
    this.simT = t;
    this.place(this.cx, this.cz, this.ctx, this.ctz);
  }
  private sharedAcc: Float64Array | null = null;

  private toLane(i: number, lane: number, over: number) {
    this.laneOf[i] = lane;
    this.sAt[i] = over;
    // in the order they arrive: whoever crossed the boundary this tick is behind whoever's already there
    this.onLane[lane].push(i);
    if (this.net!.lanes[lane].node < 0) this.trips[i]++;
  }

  /** The nearest thing past the end of this lane, following connectors and the short pieces of road between them. */
  private gapBeyond(lane: number, already: number, viaOut = false): [number, number] {
    const lanes = this.net!.lanes;
    let at = lane, dist = already;
    for (let hop = 0; hop < 4; hop++) {
      const list = this.onLane[at];
      if (list.length) { const f = list[list.length - 1]; return [dist + this.sAt[f] - this.bodyL[f] / 2, this.vel[f]]; }
      const L = lanes[at];
      if (dist + L.len > 60 || !L.out.length) break;
      dist += L.len;
      // (a block lane's way out isn't chosen yet: look along its first, usually straight on)
      at = L.out[0];
    }
    void viaOut;
    return [1e9, 0];
  }

  private chooseExit(i: number, lane: { id: number; out: number[] }): number {
    const net = this.net!;
    if (lane.out.length === 1) return lane.out[0];
    // a driver can see a street that's backed up to the corner, and doesn't turn into it if there's another way
    const free = lane.out.filter((c) => this.mayEnterRoom(i, c));
    if (free.length === 1) return free[0];
    if (free.length) lane = { id: lane.id, out: free };
    // (held up long enough at a green, a driver goes another way)
    const r = h01(this.vehicles[i].colorSeed * 37 + this.trips[i] * 101 + lane.id + Math.floor(this.waited[i] / 12) * 53);
    const straight = lane.out.filter((c) => net.lanes[c].turn === 0), turning = lane.out.filter((c) => net.lanes[c].turn !== 0);
    if (straight.length && (r < 0.78 || !turning.length)) {
      // whichever lane ahead has the most room
      let best = straight[0], most = -1;
      for (const c of straight) {
        const to = net.lanes[c].out[0], list = this.onLane[to];
        const room = list.length ? this.sAt[list[list.length - 1]] : net.lanes[to].len;
        if (room > most + 0.5) { most = room; best = c; }
      }
      return best;
    }
    return turning[Math.floor(r * 971) % turning.length];
  }

  /** Off the mapped streets: it comes back on somewhere traffic enters from, when there's room. */
  private respawn(i: number) {
    const sources = this.sources;
    const net = this.net!;
    if (this.holding[i] >= 0) { this.using[this.holding[i]]--; this.holding[i] = -1; }
    if (this.next[i] >= 0) this.using[this.next[i]]--;
    this.next[i] = -1; this.waited[i] = 0; this.trips[i]++;
    for (let tries = 0; tries < sources.length; tries++) {
      const l = sources[this.spawnAt++ % sources.length], list = this.onLane[l];
      const tail = list[list.length - 1];
      if (list.length && this.sAt[tail] - this.bodyL[tail] / 2 < this.bodyL[i] + DRIVE.gapMin + 2) continue;
      if (net.lanes[l].len < this.bodyL[i] + 2) continue;
      this.laneOf[i] = l; this.sAt[i] = this.bodyL[i] / 2; this.vel[i] = this.vMax[i] * 0.5;
      list.push(i);
      return;
    }
    // nowhere free: it waits at its old spot's lane start, off the road for now
    this.laneOf[i] = -1;
  }

  private pxSwap() {
    this.px.set(this.cx); this.pz.set(this.cz); this.ptx.set(this.ctx); this.ptz.set(this.ctz);
  }

  private place(ox: Float64Array, oz: Float64Array, otx: Float32Array, otz: Float32Array) {
    const lanes = this.net!.lanes;
    for (let i = 0; i < this.n; i++) {
      if (this.laneOf[i] < 0) { ox[i] = 1e7; oz[i] = 1e7; continue; }
      const L = lanes[this.laneOf[i]], s = Math.min(L.len, this.sAt[i]);
      let k = 0;
      while (k < L.cum.length - 2 && L.cum[k + 1] < s) k++;
      const dl = L.cum[k + 1] - L.cum[k] || 1, f = (s - L.cum[k]) / dl;
      ox[i] = L.x[k] + (L.x[k + 1] - L.x[k]) * f;
      oz[i] = L.z[k] + (L.z[k + 1] - L.z[k]) * f;
      otx[i] = (L.x[k + 1] - L.x[k]) / dl;
      otz[i] = (L.z[k + 1] - L.z[k]) / dl;
    }
  }

  /** Place the vehicles near (fx, fz) at time t (call once per frame / tick batch). */
  update(t: number, fx = 0, fz = 0, range = Infinity) {
    if (t === this.t) return;
    this.ensureNet();
    this.t = t;
    if (t < this.simT - DRIVE.tick - 1e-6) this.restore();
    while (this.simT < t) this.step();
    const k = Math.max(0, Math.min(1, 1 - (this.simT - t) / DRIVE.tick));
    this.now.length = 0;
    this.grid.clear();
    for (let i = 0; i < this.n; i++) {
      if (this.laneOf[i] < 0) continue;
      const x = this.px[i] + (this.cx[i] - this.px[i]) * k, z = this.pz[i] + (this.cz[i] - this.pz[i]) * k;
      if (range < Infinity && (Math.abs(x - fx) > range || Math.abs(z - fz) > range)) continue;
      let tx = this.ptx[i] + (this.ctx[i] - this.ptx[i]) * k, tz = this.ptz[i] + (this.ctz[i] - this.ptz[i]) * k;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const st = this.pool[i];
      st.x = x; st.z = z; st.tx = tx; st.tz = tz; st.speed = this.vel[i]; st.brake = this.brake[i]; st.odo = this.odo[i];
      const on = this.net!.lanes[this.laneOf[i]];
      st.fade = on.node >= 0 ? 1 : Math.min(this.edgeIn[this.laneOf[i]] ? Math.min(1, this.sAt[i] / 7) : 1, on.out.length ? 1 : Math.min(1, (on.len - this.sAt[i]) / 7));
      this.now.push(st);
      this.grid.add(st, x - 6, z - 6, x + 6, z + 6);
    }
  }

  /** Slipstream wind behind vehicles near (x, z), and whether a vehicle body contains the point. */
  wake(x: number, y: number, z: number, out: { x: number; y: number; z: number; hit: VehicleState | null }) {
    out.x = 0; out.y = 0; out.z = 0; out.hit = null;
    for (const s of this.grid.at(x, z)) {
      const size = VEHICLE_SIZE[s.v.kind];
      const rx = x - s.x, rz = z - s.z;
      const along = rx * s.tx + rz * s.tz;      // + ahead of the centre
      const side = rx * s.tz - rz * s.tx;
      if (Math.abs(along) < size.l / 2 && Math.abs(side) < size.w / 2 && y < size.h) { out.hit = s; continue; }
      // the bow wave: air rushing up over the bonnet flicks a leaf up and over the roof
      const front = along - size.l / 2;
      if (front > 0 && front < 3.5 && Math.abs(side) < size.w * 0.7 && y < size.h + 1.2) {
        const k = (1 - front / 3.5) * (1 - Math.abs(side) / (size.w * 0.7));
        out.y += s.speed * 1.1 * k;
        out.x += s.tx * s.speed * 0.6 * k;
        out.z += s.tz * s.speed * 0.6 * k;
      }
      // the wake: behind the vehicle, as wide as it, fading over ~6 lengths and with height
      const behind = -along - size.l / 2;
      if (behind > 0 && behind < size.l * 6 && Math.abs(side) < size.w * 0.9 && y < size.h * 2.2) {
        const k = (1 - behind / (size.l * 6)) * (1 - Math.abs(side) / (size.w * 0.9)) * (1 - y / (size.h * 2.2));
        out.x += s.tx * s.speed * k * 0.95;
        out.z += s.tz * s.speed * k * 0.95;
      }
    }
    return out;
  }
}

/** What drives Manhattan: mostly cabs, then cars of every sort, and now and then something special. */
function pickKind(r: number, r2: number): VehicleKind {
  if (r < 0.4) return "cab";
  if (r < 0.52) return "car";
  if (r < 0.6) return "suv";
  if (r < 0.65) return "hatch";
  if (r < 0.69) return "pickup";
  if (r < 0.74) return "van";
  if (r < 0.79) return "truck";
  if (r < 0.84) return "bus";
  if (r < 0.88) return "scooter";
  // the specials
  const specials: VehicleKind[] = ["police", "police", "ambulance", "firetruck", "garbage", "garbage", "schoolbus", "tourbus", "tourbus", "foodtruck", "limo", "sports", "sports"];
  return specials[Math.floor(r2 * specials.length)];
}

function pairs(p: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) out.push([p[i], p[i + 1]]);
  return out;
}
const close = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1.5 && Math.abs(a[1] - b[1]) < 1.5;
