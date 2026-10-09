// Traffic on the real streets: yellow cabs, cars, buses and trucks driving the actual
// one-way directions. Deterministic in time (position = start + speed x time along a
// street chain), so every run sees the same traffic, like the plan's fixed wind.
//
// For the leaf a vehicle is both a danger (getting hit tears you) and a gift: the
// slipstream behind it drags the air along, the plan's "vehicle drafting".

import { Grid, type CityData } from "./data";

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
  chain: number;
  lane: number;   // lateral offset in metres (+ right)
  dir: 1 | -1;
  speed: number;
  s0: number;
  colorSeed: number;
}

export interface VehicleState { x: number; z: number; tx: number; tz: number; speed: number; v: Vehicle }

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

export class Traffic {
  readonly chains: Chain[] = [];
  readonly vehicles: Vehicle[] = [];
  /** Vehicles placed at the current time, indexed by position (rebuilt by update). */
  readonly now: VehicleState[] = [];
  readonly grid = new Grid<VehicleState>(24);
  /** Closed areas (the blockers): no vehicle drives inside them. */
  closed: { x: number; z: number; r: number }[] = [];
  private t = -1;

  constructor(city: CityData) {
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
    // populate: one vehicle per ~45 m of lane, mostly cabs (this is Manhattan)
    let id = 1;
    this.chains.forEach((c, ci) => {
      const lanes = Math.min(4, c.lanes);
      const dirs: (1 | -1)[] = c.dir === 0 ? [1, -1] : [c.dir > 0 ? 1 : -1];
      for (const d of dirs) {
        const nl = c.dir === 0 ? Math.max(1, Math.floor(lanes / 2)) : lanes;
        for (let l = 0; l < nl; l++) {
          const count = Math.floor(c.length / (19 + h01(id) * 16)); // busy Manhattan traffic
          // one speed per lane and cars spaced along it, so nobody drives through anybody
          const laneSpeed = 8.5 + h01(id * 17 + l) * 4.5, laneOffset = h01(id * 23 + l) * c.length;
          for (let k = 0; k < count; k++) {
            id++;
            const r = h01(id * 7);
            const kind = pickKind(r, h01(id * 29));
            const laneW = c.width / Math.max(lanes, 1);
            const lane = c.dir === 0 ? (l + 0.5) * Math.min(3.3, laneW) : (l - (nl - 1) / 2) * Math.min(3.3, laneW);
            this.vehicles.push({ kind, chain: ci, lane, dir: d, speed: laneSpeed, s0: laneOffset + (k + (h01(id * 3) - 0.5) * 0.35) * (c.length / count), colorSeed: id });
          }
        }
      }
    });
  }

  /** Place the vehicles near (fx, fz) at time t (call once per frame / tick batch). */
  update(t: number, fx = 0, fz = 0, range = Infinity) {
    if (t === this.t) return;
    this.t = t;
    this.now.length = 0;
    this.grid.clear();
    for (const v of this.vehicles) {
      const c = this.chains[v.chain];
      if (range < Infinity && (Math.abs(c.x[0] - fx) > range + c.length || Math.abs(c.z[0] - fz) > range + c.length)) continue;
      let s = (v.s0 + v.speed * t) % c.length;
      if (v.dir < 0) s = c.length - s;
      // find the segment
      let lo = 0, hi = c.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.cum[m] <= s) lo = m; else hi = m; }
      const L = c.cum[hi] - c.cum[lo] || 1, f = (s - c.cum[lo]) / L;
      let tx = (c.x[hi] - c.x[lo]) / L, tz = (c.z[hi] - c.z[lo]) / L;
      // drive on the right: with y up and east = -x, right of travel along t is (-tz, tx)
      const x = c.x[lo] + (c.x[hi] - c.x[lo]) * f - tz * v.lane * v.dir;
      const z = c.z[lo] + (c.z[hi] - c.z[lo]) * f + tx * v.lane * v.dir;
      tx *= v.dir; tz *= v.dir;
      // the street's closed: traffic turns off before the barriers (they hide the turn)
      let shut = false;
      for (const b of this.closed) if ((x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + 4) ** 2) { shut = true; break; }
      if (shut) continue;
      const st: VehicleState = { x, z, tx, tz, speed: v.speed, v };
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
