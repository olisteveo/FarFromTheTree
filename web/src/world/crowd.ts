// People on the sidewalks: New Yorkers in winter coats walking round the blocks, waiting at
// the corners, stopping at shop windows, chatting in knots, hailing cabs, queuing at the
// carts, sitting out on the stoops, and packed in solid where the streets are closed.
// Soft obstacles for a leaf: brush past someone and you get knocked about a bit (in
// Central Park the kids try to catch you).
//
// Everything here is a pure function of time (like the traffic), so every run meets the same
// crowd and what the leaf bumps into is exactly what's drawn. Each walker walks a loop round a
// block (the midline of the block's sidewalk ring, from city.raw.sidewalk) or, where a closed
// area cuts the loop, a stretch of it back and forth; its schedule over one lap (where it
// slows, stops and for how long) is fixed, so position(t) is cheap to evaluate. Passers-by
// sidestep each other and the standers by a lateral offset that is itself computed from
// everyone's free positions at t, so it's deterministic too.
//
// Without the city (new Crowd(traffic) only: see attach) the old street-chain walkers are
// used, two per ten metres of street.

import { Grid, inPoly, type CityData } from "./data";
import type { Traffic } from "./traffic";
import { SIGNAL, signalState } from "../render/streetLayout";

/** What the crowd can use from the street furniture (render/streetLayout.ts StreetLayout). */
export interface CrowdExtras {
  street?: {
    items: { k: string; x: number; z: number; rot: number }[];
    lenses: { x: number; z: number; kind: number; group: number; offset: number }[];
    colliders: { kind: string; x: number; z: number; y?: number; hw?: number; hh?: number; hd?: number; y0?: number; y1?: number; r?: number }[];
  };
}

/** What someone is doing in the crowd. */
export type Role = "walk" | "jog" | "dolly" | "dogs" | "talk" | "hail" | "vendor" | "queue" | "sit" | "fan" | "plaza";
/** The animation that fits what they're doing right now. */
export type Act = "walk" | "jog" | "idle" | "talk" | "hail" | "sit" | "cheer";

export interface Walker {
  /** legacy street-chain walkers only (-1 otherwise) */
  chain: number; side: 1 | -1; dir: 1 | -1; s0: number;
  /** cruising speed, m/s (0 for people standing about) */
  speed: number; seed: number;
  /** height, metres */
  h: number;
  /** a dog on a lead (breed index) */
  pet?: number;
  /** how many dogs (a dog walker's pack; breeds follow on from pet) */
  pets?: number;
  role?: Role;
  /** which modelled character to draw (people.json name); the renderer picks one if unset */
  char?: string;
  /** walkers: the sidewalk loop, lateral place (-1 shop fronts .. +1 kerb), schedule, phase (s) */
  path?: number; lat?: number; plan?: Plan; t0?: number;
  /** people walking together share a group id (and their schedule) */
  group?: number;
  /** along-path offset from the group's anchor (m) */
  ds?: number;
  /** standers: where they stand and which way they face; wanderers circle (cx, cz) */
  x?: number; z?: number; yaw?: number; y?: number; wander?: number;
  /** footprint radius others keep clear of (a knot of people, a cart); ghost: an obstacle only, not drawn */
  foot?: number; ghost?: boolean;
  /** walking together: whose schedule this one follows */
  lead?: Walker;
  /** (internal) the reused state object, and when it was last placed */
  _st?: WalkerState; _t?: number; _slot?: number; _can?: number;
}
export interface WalkerState {
  x: number; z: number;
  /** facing (unit): the way they're walking, or looking when they stand */
  tx: number; tz: number;
  w: Walker;
  /** metres walked (drives the walk cycle so feet don't slide) */
  phase: number;
  /** current speed (m/s): 0 standing, ramps up and down around stops */
  v: number;
  act: Act;
  /** seat height for sitters (above the pavement) */
  y?: number;
}

/** Static street-life props the renderer draws: hot dog carts and the stoops people sit on. */
export interface CrowdProp { kind: "cart" | "stoop"; x: number; z: number; tx: number; tz: number; seed: number }

interface Plan {
  /** travel length of one lap (loop: the loop; stretch: there and back) */
  U: number;
  /** lap time, s */
  T: number;
  /** pause positions (travel coordinate), durations, kinds (0 corner, 1 shop window, 2 turn round, 3 delivery, 4 phone) */
  pu: Float32Array; pd: Float32Array; pk: Uint8Array;
  /** time to slow to a stop / get going again */
  tau: number;
  /** the walker's phase: position(t) is position at lap time (t + t0) mod T */
  t0: number;
}

interface Path {
  loop: boolean; n: number; ds: number; len: number;
  x: Float32Array; z: Float32Array; tx: Float32Array; tz: Float32Array;
  /** unit normal toward the kerb */
  nx: Float32Array; nz: Float32Array;
  /** clear distance from the midline to the kerb and to the shop fronts */
  kerb: Float32Array; bld: Float32Array;
  /** for travel along +s the kerb is on the walker's right */
  kerbRight: boolean;
  busy: number;
  corners: number[];
  /** per corner: the WALK signal (group, offset) for walking +s, then for -s (-1: none) */
  sig?: Float32Array;
  x0: number; z0: number; x1: number; z1: number;
  walkers: Walker[];
  standers: Walker[];
}

/** Every walker made with the same fields in the same order (one hidden class: fast property access). */
function walker(p: Partial<Walker>): Walker {
  const w: Walker = {
    chain: -1, side: 1, dir: 1, s0: 0, speed: 0, seed: 0, h: 1.7, pet: undefined, pets: undefined, role: undefined, char: undefined,
    path: undefined, lat: undefined, plan: undefined, t0: undefined, group: undefined, ds: undefined, x: undefined, z: undefined, yaw: undefined,
    y: undefined, wander: undefined, foot: undefined, ghost: undefined, lead: undefined, _st: undefined, _t: undefined, _slot: undefined, _can: undefined,
  };
  for (const k in p) (w as unknown as Record<string, unknown>)[k] = (p as Record<string, unknown>)[k];
  return w;
}
/** each walker keeps one state object (reused frame to frame: no garbage) */
const stOf = (w: Walker, x: number, z: number, tx: number, tz: number, phase: number, v: number, act: Act): WalkerState => {
  const s = w._st ?? (w._st = { x, z, tx, tz, w, phase, v, act, y: undefined });
  s.x = x; s.z = z; s.tx = tx; s.tz = tz; s.phase = phase; s.v = v; s.act = act;
  return s;
};
const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The cast: name, weight, speed range (m/s), height range (m). Names match the modelled characters. */
const CAST: [string, number, number, number, number, number][] = [
  ["commuter", 1.0, 1.32, 1.72, 1.74, 1.9], ["puffer", 1.0, 1.15, 1.5, 1.6, 1.74], ["parka", 1.0, 1.2, 1.55, 1.75, 1.9],
  ["texter", 0.75, 0.82, 1.1, 1.56, 1.7], ["shopper", 0.85, 1.0, 1.35, 1.63, 1.76], ["courier", 0.55, 1.4, 1.78, 1.72, 1.85],
  ["gent", 0.55, 0.72, 1.0, 1.66, 1.78], ["nana", 0.55, 0.66, 0.92, 1.53, 1.65], ["student", 1.0, 1.15, 1.5, 1.6, 1.72],
  ["banker", 0.9, 1.35, 1.72, 1.78, 1.93], ["hoodie", 0.85, 1.1, 1.45, 1.7, 1.85], ["trench", 0.9, 1.25, 1.62, 1.63, 1.78],
  ["hivis", 0.35, 1.2, 1.5, 1.74, 1.88], ["tourist", 0.8, 0.78, 1.1, 1.7, 1.84], ["stroller", 0.35, 0.95, 1.2, 1.62, 1.74],
  ["umbrella", 0.3, 1.1, 1.4, 1.62, 1.76],
];
const CAST_W = CAST.reduce((a, c) => a + c[1], 0);
/** who has which extra clips (mirrors tools/people/people_blender.py EXTRA_CLIPS) */
const CAN_SIT = ["parka", "texter", "courier", "gent", "nana", "student", "hoodie", "tourist"];
const CAN_TALK = ["commuter", "puffer", "parka", "texter", "shopper", "gent", "nana", "student", "banker", "hoodie", "trench", "hivis", "tourist", "umbrella"];
const CAN_HAIL = ["commuter", "shopper", "banker", "trench"];
const CAN_CHEER = ["parka", "courier", "student", "banker", "hoodie", "kid", "hivis", "tourist"];
/** within this of the focus everyone is placed every update (further out, every third: they're small and the leaf can't reach them) */
const NEAR = 75;
const HOT_SPOTS = ["timesSquare", "heraldSquare", "flatiron", "unionSquare", "columbusCircle", "cityHall", "bowlingGreen"];

export class Crowd {
  readonly walkers: Walker[] = [];
  readonly now: WalkerState[] = [];
  readonly grid = new Grid<WalkerState>(16);
  /** carts and stoops (visual: the people at them are in walkers) */
  readonly props: CrowdProp[] = [];
  private t = -1;
  private ticks = 0;
  private paths: Path[] = [];
  private pathGrid = new Grid<number>(64);
  /** standers off the sidewalk loops: the packed crowds in the closed areas */
  private spots: Walker[] = [];
  private spotGrid = new Grid<Walker>(32);
  private scratch: number[] = [];
  private tmpSpots: Walker[] = [];
  private city: CityData | null = null;

  constructor(private traffic: Traffic, city?: CityData) {
    if (city) this.attach(city);
    else this.legacy();
  }

  /**
   * Walk the city's real sidewalks (block loops) instead of the street chains. Call once, before
   * the first update. With the street furniture (Airflow.streetLayout) people step round the
   * hydrants, poles, newsstands and shelters, wait at the corners for the WALK signal, queue at
   * the carts and wait at the bus stops.
   */
  attach(city: CityData, extras: CrowdExtras = {}) {
    if (this.city === city) return;
    this.city = city;
    this.walkers.length = 0;
    this.props.length = 0;
    this.spots.length = 0;
    this.paths = buildPaths(city, this.closed());
    this.pathGrid.clear();
    this.spotGrid.clear();
    this.paths.forEach((p, i) => this.pathGrid.add(i, p.x0 - 4, p.z0 - 4, p.x1 + 4, p.z1 + 4));
    this.sampleGrid.clear();
    this.paths.forEach((p, pi) => { for (let i = 0; i < p.n; i += 2) this.sampleGrid.add(pi * 65536 + i, p.x[i], p.z[i], p.x[i], p.z[i]); });
    if (extras.street) this.furnish(extras.street);
    this.populate(city, extras);
    for (const s of this.spots) this.spotGrid.add(s, s.x!, s.z!, s.x!, s.z!);
    this.t = -1;
  }

  private sampleGrid = new Grid<number>(10);
  private pj = { pi: -1, s: 0, off: 0, d: 0 };
  /** the nearest path sample to (x, z) within `max` metres: path, arc length, lateral offset (+ kerbward) */
  private project(x: number, z: number, max = 6) {
    const o = this.pj;
    o.pi = -1; o.d = max;
    for (const id of this.sampleGrid.around(x, z, max, this.scratch2)) {
      const pi = Math.floor(id / 65536), i = id % 65536, P = this.paths[pi];
      const d = Math.hypot(P.x[i] - x, P.z[i] - z);
      if (d >= o.d) continue;
      o.pi = pi; o.d = d;
      // refine along the tangent
      const along = (x - P.x[i]) * P.tx[i] + (z - P.z[i]) * P.tz[i];
      o.s = i * P.ds + along;
      if (P.loop) o.s = ((o.s % P.len) + P.len) % P.len; else o.s = Math.max(0, Math.min(P.len, o.s));
      o.off = (x - P.x[i]) * P.nx[i] + (z - P.z[i]) * P.nz[i];
    }
    return o;
  }
  private scratch2: number[] = [];

  /** Street furniture: obstacles to step round, and which WALK signal governs each corner. */
  private furnish(street: NonNullable<CrowdExtras["street"]>) {
    // obstacles at pedestrian height on the sidewalks
    for (const c of street.colliders) {
      let r: number, x: number, z: number;
      if (c.kind === "cyl") { if (c.y0! > 1.2 || c.y1! < 0.5) continue; r = c.r!; x = c.x; z = c.z; }
      else if (c.kind === "box") { if (c.y! - c.hh! > 1.2 || c.y! + c.hh! < 0.5) continue; r = Math.min(1.7, Math.max(c.hw!, c.hd!)); x = c.x; z = c.z; }
      else continue;
      const p = this.project(x, z, 5);
      if (p.pi < 0) continue;
      const P = this.paths[p.pi];
      const f = this.frame(P, p.s);
      if (p.off > f.kerb + 0.3 || p.off < -f.bld - 0.3) continue;
      P.standers.push(walker({ role: "vendor", ghost: true, foot: r + 0.12, s0: p.s, lat: p.off, x, z, path: p.pi, seed: 0 }));
    }
    // the WALK lights: for each corner and each way round, the crossing straight ahead
    const walks = street.lenses.filter((l) => l.kind === 3);
    const lg = new Grid<number>(30);
    walks.forEach((l, i) => lg.add(i, l.x, l.z, l.x, l.z));
    const tmp: number[] = [];
    for (const P of this.paths) {
      const sig = (P.sig = new Float32Array(P.corners.length * 4).fill(-1));
      P.corners.forEach((c, ci) => {
        for (const dir of [1, -1]) {
          const a = this.frame(P, c - dir * 5);
          const px = a.x, pz = a.z, tx = a.tx * dir, tz = a.tz * dir;
          let best = -1, score = 1e9;
          for (const li of lg.around(px, pz, 30, tmp)) {
            const l = walks[li], dx = l.x - px, dz = l.z - pz;
            const along = dx * tx + dz * tz, perp = Math.abs(dx * tz - dz * tx);
            if (along < 2 || along > 32 || perp > along * 0.8) continue;
            const sc = along + perp * 2;
            if (sc < score) { score = sc; best = li; }
          }
          if (best >= 0) { sig[ci * 4 + (dir > 0 ? 0 : 2)] = walks[best].group; sig[ci * 4 + (dir > 0 ? 1 : 3)] = walks[best].offset; }
        }
      });
    }
  }

  /** Place the walkers near (x, z) at time t (only those within range: cheap). */
  update(t: number, x: number, z: number, range = 170) {
    if (t === this.t) return;
    this.t = t;
    this.ticks++;
    this.fx = x; this.fz = z;
    this.now.length = 0;
    this.grid.clear();
    if (!this.city) { this.updateLegacy(t, x, z, range); return; }
    const ids = this.pathGrid.around(x, z, range, this.scratch);
    const seen = new Set<number>();
    for (const pi of ids) {
      if (seen.has(pi)) continue;
      seen.add(pi);
      const P = this.paths[pi];
      if (P.x1 < x - range || P.x0 > x + range || P.z1 < z - range || P.z0 > z + range) continue;
      this.placePath(P, t, x, z, range);
    }
    for (const w of this.spotGrid.around(x, z, range, this.tmpSpots)) {
      if (Math.abs(w.x! - x) > range || Math.abs(w.z! - z) > range) continue;
      const st = this.placeSpot(w, t);
      if (st) this.push(st);
    }
  }

  /** Someone at (x, y, z)? */
  hit(x: number, y: number, z: number): WalkerState | null {
    for (const p of this.grid.at(x, z)) {
      const h = p.act === "sit" ? p.w.h * 0.72 + (p.y ?? 0) : p.w.h;
      if (y < h && Math.hypot(p.x - x, p.z - z) < 0.35) return p;
    }
    return null;
  }

  // ------------------------------------------------------------------ placing

  private fx = 0; private fz = 0;
  private push(st: WalkerState) {
    this.now.push(st);
    // only the people near the focus can be hit (the leaf is the focus): far ones skip the grid
    const dx = st.x - this.fx, dz = st.z - this.fz;
    if (dx * dx + dz * dz < NEAR * NEAR) this.grid.add(st, st.x - 0.4, st.z - 0.4, st.x + 0.4, st.z + 0.4);
  }

  private sAt = { x: 0, z: 0, tx: 0, tz: 0, nx: 0, nz: 0, kerb: 0, bld: 0 };
  /** the path's frame at arc length s */
  private frame(P: Path, s: number) {
    const o = this.sAt;
    if (P.loop) s = ((s % P.len) + P.len) % P.len;
    else s = Math.min(P.len - 1e-3, Math.max(0, s));
    const f = s / P.ds;
    let i = Math.floor(f);
    const u = f - i;
    if (i >= P.n) i = P.n - 1;
    const j = P.loop ? (i + 1) % P.n : Math.min(P.n - 1, i + 1);
    o.x = P.x[i] + (P.x[j] - P.x[i]) * u; o.z = P.z[i] + (P.z[j] - P.z[i]) * u;
    o.tx = P.tx[i] + (P.tx[j] - P.tx[i]) * u; o.tz = P.tz[i] + (P.tz[j] - P.tz[i]) * u;
    const L = Math.hypot(o.tx, o.tz) || 1; o.tx /= L; o.tz /= L;
    o.nx = P.nx[i] + (P.nx[j] - P.nx[i]) * u; o.nz = P.nz[i] + (P.nz[j] - P.nz[i]) * u;
    const N = Math.hypot(o.nx, o.nz) || 1; o.nx /= N; o.nz /= N;
    o.kerb = P.kerb[i] + (P.kerb[j] - P.kerb[i]) * u; o.bld = P.bld[i] + (P.bld[j] - P.bld[i]) * u;
    return o;
  }

  private ev = { s: 0, dir: 1, v: 0, dist: 0, pk: -1, pt: 0, pd: 0, near: 0, nearK: -1 };
  /** Where a walker is on its path at time t (pure: depends only on t and the walker). */
  private evalWalker(w: Walker, P: Path, t: number) {
    // schedules are worked out the first time someone is looked at (people walking together share their leader's)
    const lead = w.lead ?? w;
    if (!lead.plan) { lead.plan = this.plan(P, lead.seed, lead.dir, lead.s0, lead.speed, lead.role ?? "walk", lead.char ?? ""); lead.t0 = lead.plan.t0; }
    const e = this.ev, pl = lead.plan;
    const v = w.speed, tau = pl.tau, half = v * tau * 0.5;
    const tt = t + lead.t0!;
    const lap = Math.floor(tt / pl.T);
    const tl = tt - lap * pl.T;
    let tc = 0, uc = 0, u = -1, sp = v;
    e.pk = -1; e.pt = 0; e.pd = 0;
    for (let k = 0; k < pl.pu.length && u < 0; k++) {
      const uA = pl.pu[k] - half;
      const walkT = (uA - uc) / v;
      if (tl < tc + walkT) { u = uc + v * (tl - tc); break; }
      tc += walkT;
      if (tl < tc + tau) { const d = tl - tc; u = uA + v * (d - (d * d) / (2 * tau)); sp = v * (1 - d / tau); e.pk = pl.pk[k]; e.pt = -1; e.pd = pl.pd[k]; break; }
      tc += tau;
      if (tl < tc + pl.pd[k]) { u = pl.pu[k]; sp = 0; e.pk = pl.pk[k]; e.pt = tl - tc; e.pd = pl.pd[k]; break; }
      tc += pl.pd[k];
      if (tl < tc + tau) { const d = tl - tc; u = pl.pu[k] + (v * d * d) / (2 * tau); sp = (v * d) / tau; e.pk = pl.pk[k]; e.pt = pl.pd[k] + 1; e.pd = pl.pd[k]; break; }
      tc += tau;
      uc = pl.pu[k] + half;
    }
    if (u < 0) u = Math.min(pl.U, uc + v * (tl - tc));
    // the nearest pause (pulls the walker toward the kerb or a shop window as it comes up)
    let near = 1e9, nearK = -1;
    for (let k = 0; k < pl.pu.length; k++) {
      let d = Math.abs(u - pl.pu[k]);
      if (P.loop) d = Math.min(d, pl.U - d);
      if (d < near) { near = d; nearK = pl.pk[k]; }
    }
    e.near = near; e.nearK = nearK;
    e.dist = lap * pl.U + u;
    e.v = sp;
    if (P.loop) {
      const s = w.s0 + u * w.dir + (w.ds ?? 0) * w.dir;
      e.s = ((s % P.len) + P.len) % P.len;
      e.dir = w.dir;
    } else {
      const L = P.len, q = (u + L / 2) % (2 * L);
      e.s = q < L ? q : 2 * L - q;
      e.dir = q < L ? 1 : -1;
      e.s += (w.ds ?? 0) * e.dir;
    }
    return e;
  }

  // per-path scratch for the sidestepping pass
  private act: { st: WalkerState; s: number; off: number; r: number; mov: number; g: number; d: number }[] = [];
  private actN = 0;
  private pool: { st: WalkerState; s: number; off: number; r: number; mov: number; g: number; d: number }[] = [];
  private item(st: WalkerState, s: number, off: number, r: number, mov: number, g: number) {
    const it = this.pool[this.actN] ?? (this.pool[this.actN] = { st, s, off, r, mov, g, d: 0 });
    it.st = st; it.s = s; it.off = off; it.r = r; it.mov = mov; it.g = g;
    this.act.push(it);
    this.actN++;
  }

  private placePath(P: Path, t: number, fx: number, fz: number, range: number) {
    const list = this.act;
    list.length = 0;
    this.actN = 0;
    const near2 = NEAR * NEAR;
    for (const w of P.walkers) {
      const prev = w._st;
      if (prev && w._t !== undefined) {
        const dx = prev.x - fx, dz = prev.z - fz, dt = Math.abs(t - w._t);
        // certainly still out of range (they can't have walked that far since we last looked): skip
        const slack = (w.speed + 0.5) * dt + 2;
        if (Math.abs(dx) > range + slack || Math.abs(dz) > range + slack) continue;
        // far from the focus (drawn small, never hit): only re-placed every third update
        if (dx * dx + dz * dz > near2 && dt < 0.25 && (this.ticks + w.seed) % 3 !== 0) {
          if (Math.abs(dx) <= range && Math.abs(dz) <= range) this.push(prev);
          continue;
        }
      }
      const e = this.evalWalker(w, P, t);
      const f = this.frame(P, e.s);
      w._t = t;
      if (Math.abs(f.x - fx) > range + 2 || Math.abs(f.z - fz) > range + 2) { stOf(w, f.x, f.z, f.tx, f.tz, e.dist, e.v, "walk"); continue; }
      // lateral place: their lane, pulled to the kerb (corner) or the shop front (window, delivery) near a stop
      let lat = w.lat!;
      if (e.nearK >= 0 && e.near < 3) {
        const k = 1 - sstep(0, 3, e.near);
        const want = e.nearK === 0 ? 0.85 : e.nearK === 1 || e.nearK === 3 ? -1.05 : lat;
        lat += (want - lat) * k;
      }
      const off = lat > 0 ? lat * Math.max(0, f.kerb - 0.55) : lat * Math.max(0, f.bld - 0.4);
      let tx = f.tx * e.dir, tz = f.tz * e.dir;
      let act: Act = w.role === "jog" ? "jog" : "walk";
      if (e.pk >= 0 && e.v < 0.05) act = "idle";
      // face the shop window (or the door) while stopped there
      if ((e.pk === 1 || e.pk === 3) && e.pt >= 0 && e.pt <= e.pd) {
        const k = sstep(0, 0.9, e.pt) * sstep(0, 0.9, e.pd - e.pt);
        tx += (-f.nx - tx) * k; tz += (-f.nz - tz) * k;
        const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      }
      const st = stOf(w, 0, 0, tx, tz, e.dist, e.v, act);
      this.item(st, e.s, off, w.role === "dolly" || w.char === "stroller" ? 0.45 : 0.3, 1, w.group ?? -w.seed);
    }
    for (const w of P.standers) {
      if (Math.abs(w.x! - fx) > range + 2 || Math.abs(w.z! - fz) > range + 2) continue;
      const st = w.ghost ? (w._st ?? stOf(w, w.x!, w.z!, 0, 1, 0, 0, "idle")) : this.placeStander(w, t);
      this.item(st, w.s0, w.lat!, w.foot ?? 0.3, 0, w.group ?? -w.seed);
    }
    // sidestep: everyone keeps clear of the people (and the furniture) beside them. Each pair's push
    // is a smooth function of how far apart they are along and across the sidewalk, all summed from
    // the free positions (so it doesn't matter who's first), and across the loop's seam too.
    list.sort((a, b) => a.s - b.s);
    const n = list.length;
    for (let i = 0; i < n; i++) list[i].d = 0;
    const pair = (a: typeof list[0], b: typeof list[0], ds: number) => {
      const reach = a.r + b.r + 1.3;
      if (ds > reach || a.g === b.g || (a.mov === 0 && b.mov === 0)) return;
      const d = a.off - b.off, need = a.r + b.r + 0.08;
      const over = need - Math.abs(d);
      if (over <= 0) return;
      const bell = 1 - (ds / reach) * (ds / reach);
      const push = over * bell * Math.tanh(d / 0.25 + ((a.st.w.seed ^ b.st.w.seed) & 1 ? 0.15 : -0.15));
      const wa = a.mov / (a.mov + b.mov);
      a.d += push * wa; b.d -= push * (1 - wa);
    };
    for (let i = 0; i < n; i++) {
      const a = list[i];
      for (let j = i + 1; j < n; j++) {
        const ds = list[j].s - a.s;
        if (ds > 4) break;
        pair(a, list[j], ds);
      }
    }
    if (P.loop) {
      for (let i = 0; i < n && list[i].s < 4; i++) {
        for (let j = n - 1; j > i && list[j].s > P.len - 4; j--) pair(list[i], list[j], list[i].s + P.len - list[j].s);
      }
    }
    for (let i = 0; i < n; i++) list[i].off += list[i].d;
    for (const it of list) {
      if (it.mov === 0) { if (!it.st.w.ghost) this.push(it.st); continue; }
      const f = this.frame(P, it.s);
      const off = Math.min(f.kerb - 0.4, Math.max(-(f.bld - 0.3), it.off));
      it.st.x = f.x + f.nx * off;
      it.st.z = f.z + f.nz * off;
      this.push(it.st);
    }
  }

  /** standers on a sidewalk: chatting, hailing, queuing, vending, sitting on the stoop */
  private placeStander(w: Walker, t: number): WalkerState {
    const x = w.x!, z = w.z!;
    const yaw = w.yaw!;
    let act: Act = "idle";
    const ph = h01(w.seed * 31) * 40;
    switch (w.role) {
      case "talk": act = "talk"; break;
      case "hail": act = ((t + ph) % 24) < 8 ? "hail" : "idle"; break;
      case "vendor": act = ((t + ph) % 14) < 7 ? "talk" : "idle"; break;
      case "sit": act = "sit"; break;
      case "queue": act = ((t + ph) % 30) < 6 && (w._can ??= CAN_TALK.includes(w.char!) ? 2 : 0) ? "talk" : "idle"; break;
    }
    const st = stOf(w, x, z, Math.sin(yaw), Math.cos(yaw), 0, 0, act);
    st.y = w.y;
    return st;
  }

  /** the packed crowds in the closed areas (some milling about in little circles) */
  private placeSpot(w: Walker, t: number): WalkerState | null {
    const ph = h01(w.seed * 31);
    if (w.wander) {
      const r = w.wander, om = (0.45 / r) * (w.seed & 1 ? 1 : -1);
      const a = ph * Math.PI * 2 + om * t;
      const x = w.x! + Math.cos(a) * r, z = w.z! + Math.sin(a) * r;
      const s = om > 0 ? 1 : -1;
      return stOf(w, x, z, -Math.sin(a) * s, Math.cos(a) * s, Math.abs(om) * r * t, 0.45, "walk");
    }
    // fans: mostly watching, some clapping and cheering, some chatting (in turns of nine seconds)
    const slot = Math.floor((t + ph * 60) / 9);
    if (w._slot === slot && w._st) return w._st;
    w._slot = slot;
    w._can ??= (CAN_CHEER.includes(w.char!) ? 1 : 0) | (CAN_TALK.includes(w.char!) ? 2 : 0);
    const r = h01(w.seed * 7 + slot * 131);
    let act: Act = "idle";
    if (w.role === "fan") {
      if (r < (w.char === "kid" ? 0.5 : 0.3) && w._can & 1) act = "cheer";
      else if (r < 0.55 && w._can & 2) act = "talk";
    } else if (w.role === "plaza" && r < 0.5 && w._can & 2) act = "talk";
    return stOf(w, w.x!, w.z!, Math.sin(w.yaw!), Math.cos(w.yaw!), 0, 0, act);
  }

  // ------------------------------------------------------------------ populating

  private closed(): { x: number; z: number; r: number; kind?: string; id?: string }[] {
    return (this.traffic.closed ?? []) as { x: number; z: number; r: number; kind?: string; id?: string }[];
  }

  private populate(city: CityData, extras: CrowdExtras) {
    let id = 7;
    let group = 1;
    const lm = city.raw.landmarks;
    const hot = HOT_SPOTS.map((k) => lm[k]).filter(Boolean);
    const pickCast = (r: number, filter?: string[]) => {
      if (filter) return filter[Math.floor(r * filter.length) % filter.length];
      let x = r * CAST_W;
      for (const c of CAST) { x -= c[1]; if (x < 0) return c[0]; }
      return CAST[0][0];
    };
    const castOf = (name: string) => CAST.find((c) => c[0] === name) ?? CAST[0];
    for (let pi = 0; pi < this.paths.length; pi++) {
      const P = this.paths[pi];
      // how busy: tall buildings and the famous squares bring the crowds; the residential blocks are quieter
      let b = P.busy;
      const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
      for (const [hx, hz] of hot) b += 0.7 * Math.max(0, 1 - Math.hypot(cx - hx, cz - hz) / 380);
      b = Math.min(1.8, b);
      P.busy = b;
      const n = Math.floor(P.len * 0.26 * b);
      const kerbSide = (dir: 1 | -1) => (P.kerbRight ? dir : -dir); // keep right: + means the kerb half
      for (let k = 0; k < n; k++) {
        id++;
        const r = h01(id * 3);
        const dir: 1 | -1 = h01(id * 5) < 0.5 ? 1 : -1;
        const s0 = h01(id * 7) * P.len;
        const keep = h01(id * 11) < 0.8 ? kerbSide(dir) : -kerbSide(dir);
        const lat = keep * (0.15 + h01(id * 13) * 0.75);
        let role: Role = "walk", char: string, size = 1, speed: number, h: number;
        if (r < 0.025) { role = "jog"; char = "runner"; speed = 2.6 + h01(id * 17) * 0.7; h = 1.62 + h01(id * 19) * 0.24; }
        else if (r < 0.037 && b > 0.6) { role = "dolly"; char = "dolly"; speed = 0.95 + h01(id * 17) * 0.2; h = 1.74 + h01(id * 19) * 0.12; }
        else if (r < 0.043) { role = "dogs"; char = pickCast(h01(id * 23), ["hoodie", "student", "puffer", "parka"]); speed = 0.95 + h01(id * 17) * 0.2; h = 1.62 + h01(id * 19) * 0.24; }
        else {
          char = pickCast(h01(id * 29));
          const c = castOf(char);
          speed = c[2] + h01(id * 17) * (c[3] - c[2]);
          h = c[4] + h01(id * 19) * (c[5] - c[4]);
          const g = h01(id * 37);
          if (g < 0.1) size = 2; else if (g < 0.14) size = 3; else if (g < 0.18) size = 0; // 0: a parent with a child
          if (size !== 1 && (char === "stroller" || char === "umbrella")) size = 1;
          if (size !== 1) speed = Math.min(speed, 1.3);
        }
        const pet = role === "dogs" ? Math.floor(h01(id * 43) * 4) : role === "walk" && size === 1 && char !== "stroller" && h01(id * 47) < 0.07 ? Math.floor(h01(id * 53) * 4) : undefined;
        const base = walker({ dir, s0, speed, seed: id, h, role, char, path: pi, lat, pet, pets: role === "dogs" ? 3 + Math.floor(h01(id * 59) * 3) : undefined });
        if (size === 1) { P.walkers.push(base); this.walkers.push(base); continue; }
        // walking together: side by side, sharing the schedule
        const g = group++;
        const m = size === 0 ? 2 : size;
        const across = lat > 0 ? -1 : 1;
        for (let q = 0; q < m; q++) {
          const kid = size === 0 && q === 1;
          const mid = q === 0 ? id : (id = id + 1);
          const cname = q === 0 ? char : kid ? "kid" : pickCast(h01(mid * 29));
          const c = castOf(cname);
          const ww = walker({
            ...base, _st: undefined, lead: base, seed: mid, group: g, char: cname, pet: undefined, pets: undefined,
            h: kid ? 1.08 + h01(mid * 19) * 0.24 : c[4] + h01(mid * 19) * (c[5] - c[4]),
            lat: Math.max(-1, Math.min(1, lat + across * q * (kid ? 0.32 : 0.42))), ds: (h01(mid * 61) - 0.5) * 0.35,
          });
          P.walkers.push(ww); this.walkers.push(ww);
        }
      }
      // ---- standers
      const wide = (s: number) => { const f = this.frame(P, s); return f.kerb + f.bld; };
      const at = (s: number, off: number, yaw: number, w: Partial<Walker>): Walker => {
        const f = this.frame(P, s);
        const x = f.x + f.nx * off, z = f.z + f.nz * off;
        return walker({ s0: s, speed: 0, seed: ++id, h: 1.7, path: pi, lat: off, x, z, yaw, ...w });
      };
      const add = (w: Walker) => { P.standers.push(w); this.walkers.push(w); };
      const yawOf = (x: number, z: number) => Math.atan2(x, z);
      // knots of people chatting by the shop fronts
      for (let s = 20 + h01(pi * 7 + 1) * 60; s < P.len - 10; s += 90 / b + h01(pi * 13 + s) * 120) {
        if (wide(s) < 3.6 || this.nearCorner(P, s, 6)) continue;
        const f = this.frame(P, s);
        const g = group++;
        const m = 2 + Math.floor(h01(id * 3 + 5) * 3);
        const off0 = -(f.bld - 0.95);
        const ccx = f.x + f.nx * off0, ccz = f.z + f.nz * off0;
        for (let q = 0; q < m; q++) {
          const a = (q / m) * Math.PI * 2 + h01(id * 7) * 2;
          const px = ccx + Math.cos(a) * 0.5, pz = ccz + Math.sin(a) * 0.5;
          const cname = pickCast(h01(id * 29 + q), CAN_TALK);
          const c = castOf(cname);
          // their along-path coordinate and lateral offset (for the sidestepping pass)
          const along = (px - f.x) * f.tx + (pz - f.z) * f.tz, side = (px - f.x) * f.nx + (pz - f.z) * f.nz;
          const w = at(s + along, side, yawOf(ccx - px, ccz - pz), { role: "talk", char: cname, group: g, h: c[4] + h01(id * 19) * (c[5] - c[4]) });
          w.x = px; w.z = pz;
          if (q === 0) w.foot = 0.85; // the knot's footprint for passers-by
          add(w);
        }
      }
      // someone at the kerb with an arm up for a cab
      if (b > 0.7) for (let s = 30 + h01(pi * 17) * 200; s < P.len - 10; s += 240 + h01(pi * 19 + s) * 260) {
        if (this.nearCorner(P, s, 5)) continue;
        const f = this.frame(P, s);
        const off = f.kerb - 0.35;
        // facing the road, turned a little toward the oncoming traffic
        const turn = (h01(id * 3) - 0.5) * 1.4;
        const fx = f.nx * Math.cos(turn) + f.tx * Math.sin(turn), fz = f.nz * Math.cos(turn) + f.tz * Math.sin(turn);
        const cname = pickCast(h01(id * 29), CAN_HAIL), c = castOf(cname);
        add(at(s, off, yawOf(fx, fz), { role: "hail", char: cname, h: c[4] + h01(id * 19) * (c[5] - c[4]) }));
      }
      // hot dog carts on the busy blocks, with a vendor and a little queue (unless the street furniture has its own)
      if (b > 0.85 && !extras.street) for (let s = 40 + h01(pi * 23) * 150; s < P.len - 20; s += 260 + h01(pi * 29 + s) * 200) {
        if (wide(s) < 4.2 || this.nearCorner(P, s, 10)) continue;
        const f = this.frame(P, s);
        const offC = f.kerb - 0.85;
        this.props.push({ kind: "cart", x: f.x + f.nx * offC, z: f.z + f.nz * offC, tx: f.tx, tz: f.tz, seed: id });
        // the cart is an obstacle for passers-by (not drawn here: see props)
        P.standers.push(at(s, offC, 0, { role: "vendor", ghost: true, foot: 1.15 }));
        // the vendor at the cart's end, facing the sidewalk
        add(at(s + 1.3, offC + 0.1, yawOf(-f.nx * 0.8 - f.tx * 0.6, -f.nz * 0.8 - f.tz * 0.6), { role: "vendor", char: "vendor", h: 1.68 + h01(id * 5) * 0.12 }));
        const qn = 1 + Math.floor(h01(id * 7) * 4);
        for (let q = 0; q < qn; q++) {
          const ss = s + 0.2 - q * 0.75, off = offC - 1.15;
          const cname = pickCast(h01(id * 29 + q)), c = castOf(cname);
          add(at(ss, off, q === 0 ? yawOf(f.nx, f.nz) : yawOf(f.tx * 0.6 + f.nx * 0.4, f.tz * 0.6 + f.nz * 0.4), { role: "queue", char: cname, h: c[4] + h01(id * 19) * (c[5] - c[4]) }));
        }
      }
      // sitting out on the stoops of the walk-ups
      if (b < 1.1) for (let s = 15 + h01(pi * 31) * 60; s < P.len - 8; s += 50 + h01(pi * 37 + s) * 90) {
        if (this.nearCorner(P, s, 8) || wide(s) < 3.2 || h01(id * 3 + 1) < 0.35) continue;
        const f = this.frame(P, s);
        const bx = f.x - f.nx * (f.bld + 1.5), bz = f.z - f.nz * (f.bld + 1.5);
        const bld = city.buildingAt(bx, bz);
        if (!bld || bld.h > 32 || !(bld.style === "tenement" || bld.style === "brick" || bld.style === "prewar")) continue;
        const off = -(f.bld - 0.15);
        const sx = f.x + f.nx * off, sz = f.z + f.nz * off;
        this.props.push({ kind: "stoop", x: sx, z: sz, tx: f.nx, tz: f.nz, seed: id });
        const m = 1 + (h01(id * 5) < 0.4 ? 1 : 0);
        for (let q = 0; q < m; q++) {
          const cname = pickCast(h01(id * 29 + q), CAN_SIT), c = castOf(cname);
          const along = m === 1 ? 0 : (q - 0.5) * 0.75;
          const w = at(s + along, off + 0.35, yawOf(f.nx, f.nz), { role: "sit", char: cname, y: 0.42, h: c[4] + h01(id * 19) * (c[5] - c[4]) });
          if (q === 0) w.foot = 0.75;
          add(w);
        }
      }
    }
    if (extras.street) id = this.populateStreet(extras.street, id, pickCast, castOf);
    this.populateClosed(city, () => ++id, pickCast, castOf);
    this.populatePlazas(city, () => ++id, pickCast, castOf, extras);
  }

  /** The pedestrian plazas (Broadway at Herald Sq, the Flatiron...): people lingering, chatting, ambling about. */
  private populatePlazas(city: CityData, nid: () => number, pickCast: (r: number, f?: string[]) => string, castOf: (n: string) => [string, number, number, number, number, number], extras: CrowdExtras) {
    const solid = new Grid<{ x: number; z: number; r: number }>(8);
    for (const c of extras.street?.colliders ?? []) {
      const r = c.kind === "cyl" ? c.r! : c.kind === "box" ? Math.max(c.hw!, c.hd!) : 0;
      if (r > 0) solid.add({ x: c.x, z: c.z, r }, c.x - r, c.z - r, c.x + r, c.z + r);
    }
    const tmp: { x: number; z: number; r: number }[] = [];
    for (const poly of city.raw.plaza) {
      const ring = poly[0];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
      if ((x1 - x0) * (z1 - z0) < 120) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (this.closed().some((c) => Math.hypot(cx - c.x, cz - c.z) < c.r + 15)) continue;
      // busier near the famous squares
      const lm = city.raw.landmarks;
      let busy = 0.35;
      for (const k of HOT_SPOTS) { const p = lm[k]; if (p) busy += 0.5 * Math.max(0, 1 - Math.hypot(cx - p[0], cz - p[1]) / 350); }
      const sp = 3.4;
      for (let gx = x0 + sp / 2; gx < x1; gx += sp) for (let gz = z0 + sp / 2; gz < z1; gz += sp) {
        const k = Math.floor(gx * 7.1) * 9973 + Math.floor(gz * 3.7);
        if (h01(k) > busy) continue;
        const x = gx + (h01(k * 3) - 0.5) * sp * 0.7, z = gz + (h01(k * 5) - 0.5) * sp * 0.7;
        if (!inPoly(poly, x, z) || city.buildingAt(x, z)) continue;
        if (solid.around(x, z, 2, tmp).some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 0.6)) continue;
        const id = nid();
        const cname = pickCast(h01(id * 29));
        const cs = castOf(cname);
        const w = walker({ seed: id, role: "plaza", char: cname, x, z, yaw: h01(id * 3) * Math.PI * 2, h: cs[4] + h01(id * 19) * (cs[5] - cs[4]) });
        if (h01(id * 7) < 0.35) { w.wander = 0.8 + h01(id * 11) * 1.6; w.role = "walk"; }
        this.spots.push(w);
        this.walkers.push(w);
      }
    }
  }

  /** the carts get a vendor and a queue, the bus stops people waiting */
  private populateStreet(street: NonNullable<CrowdExtras["street"]>, id: number, pickCast: (r: number, f?: string[]) => string, castOf: (n: string) => [string, number, number, number, number, number]) {
    const yawOf = (x: number, z: number) => Math.atan2(x, z);
    const person = (P: Path, pi: number, s: number, off: number, yaw: number, role: Role, char: string) => {
      const f = this.frame(P, s);
      const c = castOf(char);
      const w = walker({ s0: s, seed: ++id, path: pi, lat: off, x: f.x + f.nx * off, z: f.z + f.nz * off, yaw, role, char,
        h: char === "kid" ? 1.1 + h01(id * 19) * 0.2 : c[4] + h01(id * 19) * (c[5] - c[4]) });
      P.standers.push(w); this.walkers.push(w);
      return w;
    };
    for (const it of street.items) {
      const cart = it.k === "food_cart" || it.k === "hotdog_cart", pole = it.k === "bus_pole", shelter = it.k === "bus_shelter";
      if (!cart && !pole && !shelter) continue;
      const p = this.project(it.x, it.z, 7);
      if (p.pi < 0) continue;
      const pi = p.pi, P = this.paths[pi], s = p.s, off = p.off;
      const f = this.frame(P, s);
      const busy = P.busy;
      if (cart) {
        // the vendor at the cart's end, a little queue on the sidewalk side
        person(P, pi, s + 1.3, off, yawOf(-f.nx * 0.8 - f.tx * 0.6, -f.nz * 0.8 - f.tz * 0.6), "vendor", "vendor");
        const qn = Math.floor(h01(id * 7) * (1 + busy * 3.5));
        for (let q = 0; q < qn; q++) {
          const ss = s + 0.3 - q * 0.75, qo = off - 1.15 - (q ? h01(id * 3 + q) * 0.2 : 0);
          if (-qo > f.bld - 0.3) break;
          person(P, pi, ss, qo, q === 0 ? yawOf(f.nx, f.nz) : yawOf(f.tx * 0.6 + f.nx * 0.4, f.tz * 0.6 + f.nz * 0.4), "queue", pickCast(h01(id * 29 + q)));
        }
      } else {
        // waiting for the bus: by the pole along the kerb, or under the shelter, looking up the street
        const n = Math.floor(h01(id * 11) * (pole ? 1 + busy * 3 : 1 + busy * 2.5));
        for (let q = 0; q < n; q++) {
          const ss = s + (pole ? -1 - q * (0.8 + h01(id * 5 + q) * 0.6) : (q - (n - 1) / 2) * 0.9);
          const so = pole ? off - 0.4 - h01(id * 13 + q) * 1.2 : off - 0.25 + h01(id * 17 + q) * 0.3;
          const look = h01(id * 23 + q) < 0.5 ? 1 : -1;
          const yaw = yawOf(f.nx * 0.6 + f.tx * look * 0.8, f.nz * 0.6 + f.tz * look * 0.8);
          const w = person(P, pi, ss, so, yaw, "queue", pickCast(h01(id * 29 + q)));
          if (q === 0 && shelter) w.foot = 1.3;
        }
      }
    }
    return id;
  }

  private nearCorner(P: Path, s: number, d: number) {
    for (const c of P.corners) { let x = Math.abs(c - s); if (P.loop) x = Math.min(x, P.len - x); if (x < d) return true; }
    return !P.loop && (s < d || s > P.len - d);
  }

  /** A walker's stops over one lap: corners (waiting to cross), shop windows, deliveries; turning round at the ends of a stretch. */
  private plan(P: Path, id: number, dir: 1 | -1, s0: number, v: number, role: Role, char: string): Plan {
    const U = P.loop ? P.len : 2 * P.len;
    const tau = role === "jog" ? 1.2 : 0.8;
    const half = v * tau * 0.5;
    const stops: [number, number, number, number, number][] = [];
    const toU = (s: number) => (P.loop ? ((((s - s0) * dir) % U) + U) % U : s);
    if (!P.loop) {
      // turn round a little short of the ends (the barriers), having a look first
      const L = P.len;
      stops.push([L / 2, 1.5 + h01(id * 67) * 3, 2, -1, 0], [L * 1.5, 1.5 + h01(id * 71) * 3, 2, -1, 0]);
    }
    if (role !== "jog") {
      P.corners.forEach((c, i) => {
        if (h01(id * 73 + i * 7) < 0.32) {
          // waiting at the kerb, just short of the corner
          const before = 1.2 + h01(id * 79 + i) * 2.4;
          const sg = P.sig;
          const fw = sg ? [sg[i * 4], sg[i * 4 + 1]] : [-1, 0], bw = sg ? [sg[i * 4 + 2], sg[i * 4 + 3]] : [-1, 0];
          if (P.loop) stops.push([toU(c - before * dir), 4 + h01(id * 83 + i) * 20, 0, ...((dir > 0 ? fw : bw) as [number, number])]);
          else {
            // a stretch: q = (u + L/2) mod 2L, s = q on the way out, 2L - q on the way back
            const L = P.len, toQ = (q: number) => (((q - L / 2) % (2 * L)) + 2 * L) % (2 * L);
            stops.push([toQ(c - before), 4 + h01(id * 83 + i) * 18, 0, fw[0], fw[1]], [toQ(2 * L - c - before), 4 + h01(id * 89 + i) * 18, 0, bw[0], bw[1]]);
          }
        }
      });
      const every = role === "dolly" ? 70 : char === "tourist" || char === "shopper" || char === "stroller" ? 55 : 140;
      const kind = role === "dolly" ? 3 : 1;
      for (let u = 20 + h01(id * 97) * every; u < U - 10; u += every * (0.6 + h01(id * 101 + u) * 0.8)) {
        if (h01(id * 103 + Math.floor(u)) < (role === "dolly" ? 0.8 : 0.45)) stops.push([u, kind === 3 ? 15 + h01(id * 107 + u) * 25 : 4 + h01(id * 109 + u) * 12, kind, -1, 0]);
      }
      if (char === "texter" && h01(id * 113) < 0.5) stops.push([h01(id * 127) * U, 3 + h01(id * 131) * 6, 4, -1, 0]);
    }
    stops.sort((a, b) => a[0] - b[0]);
    // keep them apart (room to slow down and speed up), clear of the lap's ends
    const keep: [number, number, number, number, number][] = [];
    for (const st of stops) {
      if (st[0] < half + 0.1 || st[0] > U - half - 0.1) continue;
      if (keep.length && st[0] - keep[keep.length - 1][0] < 2 * half + 0.5) { if (st[2] === 2) keep[keep.length - 1] = st; continue; }
      keep.push(st);
    }
    // waiting at a corner lasts until the WALK comes on (the light over the crossing ahead); then the
    // lap is stretched to a whole number of signal cycles (a linger somewhere quiet), so every lap
    // meets the lights the same way and position(t) stays a simple periodic function
    const t0 = h01(id * 41) * SIGNAL.cycle * 7;
    let t = 0, uc = 0, synced = false;
    for (const st of keep) {
      t += (st[0] - half - uc) / v + tau;
      if (st[2] === 0 && st[3] >= 0) {
        const g = t - t0;
        st[1] = untilWalk(g, st[3], st[4]) + 0.35 + h01(id * 137 + Math.floor(st[0])) * 1.2;
        synced = true;
      }
      t += st[1] + tau;
      uc = st[0] + half;
    }
    let T = t + (U - uc) / v;
    if (synced) {
      const C = SIGNAL.cycle;
      let T2 = Math.ceil(T / C) * C, left = T2 - T;
      if (left < tau + 1) { T2 += C; left += C; }
      if (U - uc > 4 * half + 2) keep.push([(uc + U) / 2, left - tau, keep.length % 2 ? 1 : 4, -1, 0]);
      else if (keep.length) keep[keep.length - 1][1] += left;
      T = T2;
    }
    return { U, T, tau, t0, pu: Float32Array.from(keep.map((x) => x[0])), pd: Float32Array.from(keep.map((x) => x[1])), pk: Uint8Array.from(keep.map((x) => x[2])) };
  }

  /** Packed in where the streets are closed: Times Square, the parade, the festival, the market. */
  private populateClosed(city: CityData, nid: () => number, pickCast: (r: number, f?: string[]) => string, castOf: (n: string) => [string, number, number, number, number, number]) {
    const FANS = ["parka", "courier", "student", "banker", "hoodie", "hivis", "tourist", "puffer", "commuter", "trench", "shopper", "texter"];
    const route = city.route;
    for (const c of this.closed()) {
      const kind = c.kind ?? "crowd";
      if (kind === "water") continue;
      const budget = kind === "crowd" ? 1700 : kind === "parade" ? 1300 : kind === "festival" ? 900 : 650;
      const pts: [number, number, number][] = [];
      const R = c.r - 1.6;
      // denser near the barriers (where people see them), thinner in the middle
      for (const [spacing, r0, r1] of [[kind === "market" ? 1.9 : 1.3, R - 34, R], [2.6, 0, R - 34]] as const) {
        for (let gx = c.x - R; gx <= c.x + R; gx += spacing) {
          for (let gz = c.z - R; gz <= c.z + R; gz += spacing) {
            const seed = Math.floor(gx * 13.7) * 7919 + Math.floor(gz * 7.3);
            const x = gx + (h01(seed) - 0.5) * spacing * 0.8, z = gz + (h01(seed * 3) - 0.5) * spacing * 0.8;
            const d = Math.hypot(x - c.x, z - c.z);
            if (d < r0 || d > r1) continue;
            if (city.buildingAt(x, z)) continue;
            const st = city.street(x, z);
            if (st.dist > st.w / 2 + 6) continue;
            if (kind === "parade") {
              // spectators line the route; the middle of the street is the parade's
              const n = route.nearest(x, z);
              if (n.d < st.w / 2 - 0.5 || n.d > st.w / 2 + 6) continue;
            }
            pts.push([x, z, d]);
          }
        }
      }
      pts.sort((a, b) => b[2] - a[2]);
      const n = Math.min(budget, pts.length);
      for (let i = 0; i < n; i++) {
        const [x, z] = pts[i];
        const id = nid();
        let yaw: number;
        if (kind === "parade") { const p = route.nearest(x, z); const a = route.at(p.s); yaw = Math.atan2(a.x - x, a.z - z); }
        else if (kind === "crowd") yaw = Math.atan2(c.x - x, c.z - z) + (h01(id * 3) - 0.5) * 1.6;
        else yaw = h01(id * 3) * Math.PI * 2;
        const kidOk = kind !== "crowd" && h01(id * 5) < 0.12;
        const cname = kidOk ? "kid" : kind === "market" || kind === "festival" ? pickCast(h01(id * 29)) : pickCast(h01(id * 29), FANS);
        const cs = castOf(cname);
        const w = walker({
          seed: id, role: "fan", char: cname,
          h: cname === "kid" ? 1.05 + h01(id * 19) * 0.25 : cs[4] + h01(id * 19) * (cs[5] - cs[4]), x, z, yaw,
        });
        // at the festival and the market people mill about
        if ((kind === "festival" || kind === "market") && h01(id * 7) < 0.35) { w.wander = 0.6 + h01(id * 11) * 1.4; w.role = "walk"; }
        this.spots.push(w);
        this.walkers.push(w);
      }
    }
  }

  // ------------------------------------------------------------------ the old street-chain walkers (no city)

  private legacy() {
    let id = 7;
    this.traffic.chains.forEach((c, ci) => {
      for (const side of [1, -1] as const) {
        const n = Math.floor(c.length / 5);
        for (let k = 0; k < n; k++) {
          id++;
          if (h01(id) < 0.15) continue;
          const kid = h01(id * 13) < 0.08;
          this.walkers.push(walker({ chain: ci, side, dir: h01(id * 3) < 0.5 ? 1 : -1, s0: h01(id * 5) * c.length, speed: 1.1 + h01(id * 7) * 0.6, seed: id, h: kid ? 1.15 + h01(id * 11) * 0.2 : 1.6 + h01(id * 11) * 0.3, pet: !kid && h01(id * 17) < 0.12 ? Math.floor(h01(id * 19) * 4) : undefined }));
        }
      }
    });
  }

  private updateLegacy(t: number, x: number, z: number, range: number) {
    for (const w of this.walkers) {
      const c = this.traffic.chains[w.chain];
      if (!c) continue;
      if (Math.abs(c.x[0] - x) > range + c.length || Math.abs(c.z[0] - z) > range + c.length) continue;
      const s = ((w.s0 + w.speed * t * w.dir) % c.length + c.length) % c.length;
      let lo = 0, hi = c.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.cum[m] <= s) lo = m; else hi = m; }
      const L = c.cum[hi] - c.cum[lo] || 1, f = (s - c.cum[lo]) / L;
      const tx = (c.x[hi] - c.x[lo]) / L, tz = (c.z[hi] - c.z[lo]) / L;
      const off = (c.width / 2 + 2.4) * w.side;
      const px = c.x[lo] + (c.x[hi] - c.x[lo]) * f - tz * off, pz = c.z[lo] + (c.z[hi] - c.z[lo]) * f + tx * off;
      if (Math.abs(px - x) > range || Math.abs(pz - z) > range) continue;
      this.push({ x: px, z: pz, tx: tx * w.dir, tz: tz * w.dir, w, phase: s * w.dir, v: w.speed, act: "walk" });
    }
  }
}

// ==================================================================== sidewalk loops

/** Midlines of the block sidewalk rings (city.raw.sidewalk polygons with a block in the middle),
 *  resampled every metre, cut into stretches where a closed area crosses them. */
function buildPaths(city: CityData, closed: { x: number; z: number; r: number }[]): Path[] {
  const out: Path[] = [];
  for (const poly of city.raw.sidewalk) {
    if (poly.length < 2) continue;
    // edges of every ring of this sidewalk polygon (for the ray casts)
    const E: number[] = [];
    for (const r of poly) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) E.push(r[j], r[j + 1], r[i], r[i + 1]);
    for (let hi = 1; hi < poly.length; hi++) {
      const ring = dedupe(poly[hi], 0.35);
      const n = ring.length / 2;
      if (n < 3) continue;
      // which way is out of the block (into the sidewalk)?
      let sgn = 1;
      {
        let votes = 0;
        for (let i = 0; i < n; i++) {
          const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 2) continue;
          const nx = -(bz - az) / L, nz = (bx - ax) / L;
          votes += inPoly(poly, (ax + bx) / 2 + nx * 0.4, (az + bz) / 2 + nz * 0.4) ? 1 : -1;
          if (Math.abs(votes) > 4) break;
        }
        sgn = votes >= 0 ? 1 : -1;
      }
      const enx = new Float32Array(n), enz = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        enx[i] = (-(bz - az) / L) * sgn; enz[i] = ((bx - ax) / L) * sgn;
      }
      // samples along the property line: points along each edge, a fan of normals round each corner
      const sx: number[] = [], sz: number[] = [], snx: number[] = [], snz: number[] = [], fan: boolean[] = [], vd: number[] = [];
      for (let i = 0; i < n; i++) {
        const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
        const p = (i + n - 1) % n;
        const a0 = Math.atan2(enz[p], enx[p]);
        let da = Math.atan2(enz[i], enx[i]) - a0;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const steps = Math.floor(Math.abs(da) / 0.3);
        for (let k = 1; k <= steps; k++) {
          const a = a0 + (da * k) / (steps + 1);
          sx.push(ax); sz.push(az); snx.push(Math.cos(a)); snz.push(Math.sin(a)); fan.push(true); vd.push(0);
        }
        const L = Math.hypot(bx - ax, bz - az);
        const m = Math.max(1, Math.ceil(L / 1.2));
        for (let k = 0; k < m; k++) {
          const f = k / m;
          sx.push(ax + (bx - ax) * f); sz.push(az + (bz - az) * f); snx.push(enx[i]); snz.push(enz[i]); fan.push(false); vd.push(Math.min(f, 1 - f) * L);
        }
      }
      const N = sx.length;
      // sidewalk width along each normal (to the kerb or another block); corners take their neighbours'
      const w = new Float32Array(N);
      for (let i = 0; i < N; i++) w[i] = fan[i] ? -1 : Math.min(12, rayDist(E, sx[i] + snx[i] * 0.03, sz[i] + snz[i] * 0.03, snx[i], snz[i], 14));
      for (let i = 0; i < N; i++) if (w[i] < 0) {
        let a = -1, b = -1;
        for (let k = 1; k < N && (a < 0 || b < 0); k++) { if (a < 0 && w[(i - k + N) % N] >= 0) a = w[(i - k + N) % N]; if (b < 0 && w[(i + k) % N] >= 0) b = w[(i + k) % N]; }
        w[i] = Math.min(a < 0 ? 4 : a, b < 0 ? 4 : b);
      }
      const ws = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0, c = 0;
        for (let k = -3; k <= 3; k++) { s += Math.min(w[(i + k + N) % N], w[i] * 1.6); c++; }
        ws[i] = s / c;
      }
      // the midline: half way across, dropping points that fold back on themselves at inside corners
      const cx: number[] = [], cz: number[] = [];
      for (let i = 0; i < N; i++) {
        const hw = ws[i] / 2;
        if (hw < 0.55) continue;
        const x = sx[i] + snx[i] * hw, z = sz[i] + snz[i] * hw;
        // (folding back only happens near a corner of the block)
        if (vd[i] < hw * 2.5 + 1 && distToRing(ring, x, z) < hw * 0.8) continue;
        if (!inPoly(poly, x, z)) continue;
        if (cx.length) {
          const tx = snz[i] * sgn, tz = -snx[i] * sgn;
          void tx; void tz;
          if (Math.hypot(x - cx[cx.length - 1], z - cz[cz.length - 1]) < 0.25) continue;
        }
        cx.push(x); cz.push(z);
      }
      if (cx.length < 8) continue;
      // round it off and resample every metre
      let px = cx, pz = cz;
      for (let it = 0; it < 2; it++) [px, pz] = chaikin(px, pz);
      const rs = resample(px, pz, 1.0);
      if (!rs || rs.len < 40) continue;
      const P = finishPath(rs.x, rs.z, true, E);
      if (!P) continue;
      // which side is the kerb: away from the block
      // (normals from finishPath point left of travel; flip so they point away from the ring)
      let flip = 0;
      for (let i = 0; i < P.n; i += Math.max(1, Math.floor(P.n / 12))) flip += distToRing(ring, P.x[i] + P.nx[i] * 0.5, P.z[i] + P.nz[i] * 0.5) > distToRing(ring, P.x[i], P.z[i]) ? 1 : -1;
      if (flip < 0) { for (let i = 0; i < P.n; i++) { P.nx[i] = -P.nx[i]; P.nz[i] = -P.nz[i]; const k = P.kerb[i]; P.kerb[i] = P.bld[i]; P.bld[i] = k; } }
      // buildings that stick out past the property line: keep the shop-front lane clear of them
      for (let i = 0; i < P.n; i++) {
        while (P.bld[i] > 0.7 && city.buildingAt(P.x[i] - P.nx[i] * (P.bld[i] - 0.35), P.z[i] - P.nz[i] * (P.bld[i] - 0.35))) P.bld[i] -= 0.35;
      }
      // right of travel along t is (-tz, tx) (see traffic.ts)
      P.kerbRight = (-P.tz[0]) * P.nx[0] + P.tx[0] * P.nz[0] > 0;
      // busy: how tall the block is
      let hs = 0, hc = 0;
      for (let i = 0; i < P.n; i += 10) {
        const b = city.buildingAt(P.x[i] - P.nx[i] * (P.bld[i] + 2), P.z[i] - P.nz[i] * (P.bld[i] + 2));
        hs += b ? b.h : 0; hc++;
      }
      P.busy = Math.max(0.3, Math.min(1.3, 0.25 + (hs / Math.max(1, hc)) / 55));
      // cut where a closed area crosses it
      const inside = (i: number) => closed.some((c) => Math.hypot(P.x[i] - c.x, P.z[i] - c.z) < c.r + 1.5);
      const mask = Array.from({ length: P.n }, (_, i) => inside(i));
      if (!mask.some(Boolean)) { out.push(P); continue; }
      if (mask.every(Boolean)) continue;
      // runs of outside samples (rotate so we start inside)
      const start = mask.indexOf(true);
      let run: number[] = [];
      const flush = () => {
        if (run.length * P.ds > 25) {
          const S = finishPath(Float32Array.from(run.map((i) => P.x[i])), Float32Array.from(run.map((i) => P.z[i])), false, E, P);
          if (S) { S.kerbRight = (-S.tz[0]) * S.nx[0] + S.tx[0] * S.nz[0] > 0; S.busy = P.busy; out.push(S); }
        }
        run = [];
      };
      for (let k = 1; k <= P.n; k++) {
        const i = (start + k) % P.n;
        if (mask[i]) flush(); else run.push(i);
      }
      flush();
    }
  }
  return out;
}

/** tangents, normals (toward the kerb once flipped), clearances, corners, bounds */
function finishPath(x: Float32Array, z: Float32Array, loop: boolean, E: number[], like?: Path): Path | null {
  const n = x.length;
  if (n < 6) return null;
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  if (loop) len += Math.hypot(x[0] - x[n - 1], z[0] - z[n - 1]);
  const tx = new Float32Array(n), tz = new Float32Array(n), nx = new Float32Array(n), nz = new Float32Array(n);
  const kerb = new Float32Array(n), bld = new Float32Array(n);
  const idx = (i: number) => (loop ? (i + n) % n : Math.max(0, Math.min(n - 1, i)));
  for (let i = 0; i < n; i++) {
    const a = idx(i - 2), b = idx(i + 2);
    let dx = x[b] - x[a], dz = z[b] - z[a];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    tx[i] = dx; tz[i] = dz;
    nx[i] = -dz; nz[i] = dx;
  }
  if (like) {
    // keep the parent loop's sense of which side is the kerb
    for (let i = 0; i < n; i++) {
      let best = 0, bd = 1e9;
      for (let k = 0; k < like.n; k += 1) { const d = (like.x[k] - x[i]) ** 2 + (like.z[k] - z[i]) ** 2; if (d < bd) { bd = d; best = k; } if (bd < 0.01) break; }
      if (nx[i] * like.nx[best] + nz[i] * like.nz[best] < 0) { nx[i] = -nx[i]; nz[i] = -nz[i]; }
    }
  }
  for (let i = 0; i < n; i++) {
    kerb[i] = Math.min(8, rayDist(E, x[i], z[i], nx[i], nz[i], 10));
    bld[i] = Math.min(8, rayDist(E, x[i], z[i], -nx[i], -nz[i], 10));
  }
  // corners: where the heading turns hard over a few metres
  const corners: number[] = [];
  let lastC = -1e9;
  for (let i = 0; i < n; i++) {
    if (!loop && (i < 3 || i > n - 4)) continue;
    const a = idx(i - 4), b = idx(i + 4);
    const turn = Math.abs(Math.atan2(tx[a] * tz[b] - tz[a] * tx[b], tx[a] * tx[b] + tz[a] * tz[b]));
    if (turn < 0.7) continue;
    const ta = idx(i - 1), tb = idx(i + 1);
    const t0 = Math.abs(Math.atan2(tx[idx(ta - 4)] * tz[idx(ta + 4)] - tz[idx(ta - 4)] * tx[idx(ta + 4)], tx[idx(ta - 4)] * tx[idx(ta + 4)] + tz[idx(ta - 4)] * tz[idx(ta + 4)]));
    const t1 = Math.abs(Math.atan2(tx[idx(tb - 4)] * tz[idx(tb + 4)] - tz[idx(tb - 4)] * tx[idx(tb + 4)], tx[idx(tb - 4)] * tx[idx(tb + 4)] + tz[idx(tb - 4)] * tz[idx(tb + 4)]));
    if (turn < t0 || turn < t1) continue;
    const s = (i * len) / (loop ? n : n - 1);
    if (s - lastC < 10) continue;
    corners.push(s); lastC = s;
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); z0 = Math.min(z0, z[i]); z1 = Math.max(z1, z[i]); }
  return { loop, n, ds: len / (loop ? n : n - 1), len, x, z, tx, tz, nx, nz, kerb, bld, kerbRight: true, busy: 1, corners, x0, z0, x1, z1, walkers: [], standers: [] };
}

/** seconds from global time g until the WALK comes on at a crossing (0 if it's on now) */
function untilWalk(g: number, group: number, offset: number): number {
  // signalState: walk is on while ((t + offset + (group 0 ? half a cycle : 0)) mod cycle) < SIGNAL.walk
  const C = SIGNAL.cycle;
  const o = ((((g + offset + (group === 0 ? C / 2 : 0)) % C) + C) % C);
  return o < SIGNAL.walk ? 0 : C - o;
}
void signalState;

function dedupe(r: number[], d: number): number[] {
  const o: number[] = [];
  for (let i = 0; i < r.length; i += 2) {
    if (o.length && Math.hypot(r[i] - o[o.length - 2], r[i + 1] - o[o.length - 1]) < d) continue;
    o.push(r[i], r[i + 1]);
  }
  if (o.length > 4 && Math.hypot(o[0] - o[o.length - 2], o[1] - o[o.length - 1]) < d) o.length -= 2;
  return o;
}

/** distance along (dx, dz) from (ox, oz) to the nearest edge in E (flat ax, az, bx, bz) */
function rayDist(E: number[], ox: number, oz: number, dx: number, dz: number, max: number): number {
  let best = max;
  for (let i = 0; i < E.length; i += 4) {
    const ax = E[i], az = E[i + 1], ex = E[i + 2] - ax, ez = E[i + 3] - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const wx = ax - ox, wz = az - oz;
    const t = (wx * ez - wz * ex) / den;
    if (t <= 1e-3 || t >= best) continue;
    const u = (wx * dz - wz * dx) / den;
    if (u < 0 || u > 1) continue;
    best = t;
  }
  return best;
}

function distToRing(r: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], dx = r[i] - ax, dz = r[i + 1] - az;
    const L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}

function chaikin(x: number[], z: number[]): [number[], number[]] {
  const n = x.length, ox: number[] = [], oz: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ox.push(x[i] * 0.75 + x[j] * 0.25, x[i] * 0.25 + x[j] * 0.75);
    oz.push(z[i] * 0.75 + z[j] * 0.25, z[i] * 0.25 + z[j] * 0.75);
  }
  return [ox, oz];
}

/** a closed polyline resampled at (about) `step` metres */
function resample(x: number[], z: number[], step: number): { x: Float32Array; z: Float32Array; len: number } | null {
  const n = x.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(x[i % n] - x[i - 1], z[i % n] - z[i - 1]));
  const len = cum[n];
  if (len < 1) return null;
  const m = Math.max(8, Math.round(len / step));
  const ox = new Float32Array(m), oz = new Float32Array(m);
  let k = 0;
  for (let i = 0; i < m; i++) {
    const s = (i / m) * len;
    while (k < n - 1 && cum[k + 1] < s) k++;
    const L = cum[k + 1] - cum[k] || 1, f = (s - cum[k]) / L;
    ox[i] = x[k] + (x[(k + 1) % n] - x[k]) * f;
    oz[i] = z[k] + (z[(k + 1) % n] - z[k]) * f;
  }
  return { x: ox, z: oz, len };
}
