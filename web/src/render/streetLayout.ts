// Where New York's street furniture goes: placed from the real street data (centrelines with
// widths, lanes and one-way directions, sidewalk/roadbed/plaza polygons, the subway entrances).
// Pure data, no three.js and no DOM, so the headless test pilots (Node) can use the colliders.
//
//   const L = streetLayout(city, { traffic, life, blockers });   // (pass flow's, or they're made)
//   L.items      instanced furniture: lights, signal poles, hydrants, baskets, sheds, ...
//   L.plates     flat signs (street name blades, one-way arrows, parking rules, bus stop flags)
//   L.lenses     things that light up on a timer (signals, WALK/hand, hazard blinkers)
//   L.parked     parked and double-parked vehicles (kinds from world/traffic.ts)
//   L.colliders  solids for the leaf, same format as render/centralPark.ts ParkCollider
//
// Frames: local metres, x = -east, z = uptown, y up. An item's rot turns its model's +Z
// (its "front") to (sin rot, cos rot); its local +X becomes (cos rot, -sin rot).
// Everything is deterministic (hashes of the data), so every run sees the same street.

import { Grid, inPoly, type CityData, type Poly } from "../world/data";
import { Traffic, VEHICLE_SIZE, type VehicleKind } from "../world/traffic";
import { StreetLife } from "../world/streetlife";
import { Blockers } from "../world/blockers";
import { Underground } from "../world/underground";
import { project } from "../world/landmarks";
import type { ParkCollider } from "./centralPark";

export type StreetCollider = ParkCollider;

export type StreetKind =
  | "light_cobra" | "light_crook" | "signal_pole" | "mast_arm" | "signal_head" | "ped_head"
  | "hydrant" | "standpipe" | "mailbox" | "basket" | "newsstand" | "food_cart" | "hotdog_cart"
  | "bike_dock" | "bike" | "bike_kiosk" | "bike_rack" | "bus_pole" | "bus_shelter" | "kiosk" | "munimeter" | "sign_post"
  | "planter" | "planter_round" | "bollard" | "jersey" | "shed_bay" | "shed_end" | "steam_stack"
  | "hoop" | "fence_post" | "court_bench";

export const STREET_KINDS: StreetKind[] = [
  "light_cobra", "light_crook", "signal_pole", "mast_arm", "signal_head", "ped_head",
  "hydrant", "standpipe", "mailbox", "basket", "newsstand", "food_cart", "hotdog_cart",
  "bike_dock", "bike", "bike_kiosk", "bike_rack", "bus_pole", "bus_shelter", "kiosk", "munimeter", "sign_post",
  "planter", "planter_round", "bollard", "jersey", "shed_bay", "shed_end", "steam_stack",
  "hoop", "fence_post", "court_bench",
];

export interface StreetItem { k: StreetKind; x: number; y: number; z: number; rot: number; /** per-axis scale (mast arm length, shed depth) */ sx?: number; sy?: number; sz?: number; /** variant / tint */ v?: number }

/** A flat sign: centre, rot (local +X = reading direction from the front), size, atlas cells front and back. */
export interface Plate { x: number; y: number; z: number; rot: number; w: number; h: number; front: string; back: string }

/** Lens kinds: 0 red, 1 amber, 2 green (vehicle signals), 3 WALK, 4 hand, 5 hazard blinker. */
export interface Lens { x: number; y: number; z: number; rot: number; size: number; kind: number; group: number; offset: number }

export interface Parked { kind: VehicleKind; x: number; z: number; rot: number; seed: number; hazard: boolean; double: boolean }

/** A still figure (hot dog vendors, their queues, court spectators): pose, coat seed. */
export interface Figure { x: number; y: number; z: number; rot: number; pose: "stand" | "sit"; seed: number }

/** A basketball court ("cage"): centre, half sizes of the fenced rectangle along its local X (hw) and
 *  local Z (hd), yaw (local X = (cos yaw, -sin yaw), like every item's rot), fence height. site: the
 *  index in city.raw.sites of the building-site polygon it sits in (-1 if none): that site shouldn't be
 *  drawn as a building site. half: a half court (one hoop). Players run about inside (animated by the view). */
export interface Court {
  name: string; x: number; z: number; hw: number; hd: number; yaw: number; fence: number; half: boolean; site: number;
  hoops: { x: number; z: number; rot: number }[];
  players: { x: number; z: number; mode: "shoot" | "dribble"; hoop: number; seed: number }[];
}

/** Is (x, z) on a court's fenced rectangle (grown by margin)? For the site and far-city renderers:
 *  skip site polygons / far buildings that overlap a court so the cage isn't buried. */
export function inCourt(courts: Court[], x: number, z: number, margin = 1): Court | null {
  for (const c of courts) {
    const dx = x - c.x, dz = z - c.z;
    const u = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw), v = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
    if (Math.abs(u) < c.hw + margin && Math.abs(v) < c.hd + margin) return c;
  }
  return null;
}

export interface StreetLayout {
  items: StreetItem[];
  plates: Plate[];
  lenses: Lens[];
  parked: Parked[];
  colliders: StreetCollider[];
  /** street names used on the blades (plate cells are "name:<index>") */
  names: string[];
  /** still people: hot dog vendors and queues, spectators at the courts */
  figures: Figure[];
  /** basketball courts */
  courts: Court[];
  /** light pools on the ground under each lamp head */
  pools: { x: number; z: number; r: number }[];
  stats: Record<string, number>;
}

export interface StreetLayoutOptions { traffic?: Traffic; life?: StreetLife; blockers?: Blockers; under?: Underground }

/** The signal cycle (seconds): see signalState. */
export const SIGNAL = { cycle: 64, green: 27, amber: 3, allRed: 2, walk: 17 };

/** What a signal shows at time t: for a group, the phase within the cycle. Shared with the shader in streetFurniture.ts. */
export function signalState(t: number, group: number, offset: number): { vehicle: 0 | 1 | 2; walk: 0 | 1 | 2 } {
  const C = SIGNAL.cycle, half = C / 2;
  const p = (((t + offset) % C) + C) % C;
  const q = group === 0 ? p : (p + half) % C; // the other group runs half a cycle later
  const vehicle = q < SIGNAL.green ? 2 : q < SIGNAL.green + SIGNAL.amber ? 1 : 0;
  // pedestrians crossing a street of this group walk while the *other* group has green
  const o = (q + half) % C;
  const walk = o < SIGNAL.walk ? 2 : o < SIGNAL.green + SIGNAL.amber ? 1 : 0; // 2 walk, 1 flashing hand, 0 hand
  return { vehicle: vehicle as 0 | 1 | 2, walk: walk as 0 | 1 | 2 };
}

// ------------------------------------------------------------------ helpers

const h01 = (a: number, b = 0) => { let n = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12; n = Math.imul(n, 0x297a2d39); n ^= n >>> 15; return (n >>> 0) / 4294967296; };
const hp = (x: number, z: number, salt: number) => h01(Math.round(x * 4) * 73856093 ^ Math.round(z * 4) * 19349663, salt);

class PolyIndex {
  private grid = new Grid<number>(24);
  private bb: number[][] = [];
  constructor(readonly polys: Poly[]) {
    polys.forEach((p, i) => {
      const r = p[0];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); z0 = Math.min(z0, r[k + 1]); z1 = Math.max(z1, r[k + 1]); }
      this.bb.push([x0, z0, x1, z1]);
      this.grid.add(i, x0, z0, x1, z1);
    });
  }
  which(x: number, z: number): number {
    for (const i of this.grid.at(x, z)) {
      const b = this.bb[i];
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (inPoly(this.polys[i], x, z)) return i;
    }
    return -1;
  }
  has(x: number, z: number) { return this.which(x, z) >= 0; }
}

interface Seg { ax: number; az: number; tx: number; tz: number; L: number; si: number; chain: number }
interface Arm { tx: number; tz: number; si: number; name: string; w: number; inbound: boolean; outbound: boolean }
interface Node { x: number; z: number; arms: Arm[]; r: number }

/** Bus routes (same list ground.ts paints red lanes on). */
const BUS = /^(1|2|3|5|7|8) AVE$|^AVE OF THE AMERICAS$|^6 AVE$|^MADISON AVE$|^LEXINGTON AVE$|^PARK AVE S$|^BROADWAY$|^CHURCH ST$|^(E|W) {2}(14|23|34|42|57) ST$/;
const AVENUE = /AVE|BROADWAY|BOWERY|PARK ROW|CANAL ST|HOUSTON|DELANCEY|CENTRAL PARK|CHAMBERS|WORTH ST|(E|W) {2}(14|23|34|42|57) ST/;

// ------------------------------------------------------------------ the layout

export function streetLayout(city: CityData, opts: StreetLayoutOptions = {}): StreetLayout {
  const raw = city.raw;
  const tm: Record<string, number> = {};
  let tLast = Date.now(), tName = "setup";
  const mark = (n: string) => { const now = Date.now(); tm["ms_" + tName] = now - tLast; tLast = now; tName = n; };
  const traffic = opts.traffic ?? new Traffic(city);
  const life = opts.life ?? new StreetLife(city);
  const blockers = opts.blockers ?? new Blockers(city);
  const under = opts.under ?? new Underground(city);

  const walk = new PolyIndex(raw.sidewalk);
  const road = new PolyIndex(raw.roadbed);
  const plaza = new PolyIndex(raw.plaza);
  const parks = new PolyIndex(raw.parks.map((p) => p.p));
  const sites = new PolyIndex(raw.sites.map((p) => p.p));
  // the parks and the building sites (behind their hoardings) get nothing of ours
  const inPark = (x: number, z: number) => parks.has(x, z) || sites.has(x, z);
  const onWalk = (x: number, z: number) => walk.has(x, z) && !city.buildingAt(x, z) && !sites.has(x, z);

  const items: StreetItem[] = [];
  const plates: Plate[] = [];
  const lenses: Lens[] = [];
  const parked: Parked[] = [];
  const colliders: StreetCollider[] = [];
  const pools: { x: number; z: number; r: number }[] = [];
  const figures: Figure[] = [];
  const courts: Court[] = [];
  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  const nameCell = (n: string) => { let i = nameIdx.get(n); if (i === undefined) { i = names.length; names.push(n); nameIdx.set(n, i); } return "name:" + i; };

  // ---- occupancy: discs already taken on the sidewalk (and kerb lane), so nothing overlaps
  const taken = new Grid<{ x: number; z: number; r: number }>(4);
  const free = (x: number, z: number, r: number) => {
    for (const o of taken.around(x, z, r + 3, tmpO)) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2) return false;
    return true;
  };
  const claim = (x: number, z: number, r: number) => { const o = { x, z, r }; taken.add(o, x - r, z - r, x + r, z + r); };
  const tmpO: { x: number; z: number; r: number }[] = [];
  // the subway stairs and the street trees are already there
  for (const e of raw.entrances) claim(e.x, e.z, 3.6);
  for (let i = 0; i < raw.trees.length; i += 3) claim(raw.trees[i], raw.trees[i + 1], 1.1);
  // the subway's own holes in the street: stair squares, grates and the long vent grates
  for (const sh of under.shafts) {
    if (sh.kind === "vent") for (let a = -4.6; a <= 4.6; a += 1.5) claim(sh.x + sh.ux * a, sh.z + sh.uz * a, 2.0);
    else claim(sh.x, sh.z, sh.kind === "stairs" ? 3.4 : 1.8);
  }
  const tmpSt: { x: number; z: number }[] = [], tmpH: { x: number; z: number }[] = [];
  const tmpSh: { x: number; z: number; kind: string; ux: number; uz: number }[] = [];
  const steamNear = (x: number, z: number, r: number) => life.steamGrid.around(x, z, r + 1, tmpSt as never[]).some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < r * r);
  const holeNear = (x: number, z: number, r: number) => life.holeGrid.around(x, z, r + 1, tmpH as never[]).some((m) => (m.x - x) ** 2 + (m.z - z) ** 2 < r * r);
  /** near a stair opening, grate or vent (vents measured along their length) */
  const shaftNear = (x: number, z: number, r: number) => under.shaftGrid.around(x, z, r + 6, tmpSh as never[]).some((sh) => {
    if (sh.kind !== "vent") return (sh.x - x) ** 2 + (sh.z - z) ** 2 < (r + (sh.kind === "stairs" ? 2.6 : 1.3)) ** 2;
    const a = Math.max(-4.6, Math.min(4.6, (x - sh.x) * sh.ux + (z - sh.z) * sh.uz));
    return (sh.x + sh.ux * a - x) ** 2 + (sh.z + sh.uz * a - z) ** 2 < (r + 1.4) ** 2;
  });

  // ---- colliders
  const box = (name: string, x: number, y: number, z: number, hw: number, hh: number, hd: number, rot: number) =>
    colliders.push({ kind: "box", name, x, y, z, hw, hh, hd, tx: Math.cos(rot), tz: -Math.sin(rot) });
  const cyl = (name: string, x: number, z: number, y0: number, y1: number, r: number) => colliders.push({ kind: "cyl", name, x, z, y0, y1, r });
  const sphere = (name: string, x: number, y: number, z: number, r: number) => colliders.push({ kind: "sphere", name, x, y, z, r });
  /** local (lx along local X, lz along local Z) -> world */
  const at = (x: number, z: number, rot: number, lx: number, lz: number): [number, number] =>
    [x + Math.cos(rot) * lx + Math.sin(rot) * lz, z - Math.sin(rot) * lx + Math.cos(rot) * lz];
  const rotTo = (fx: number, fz: number) => Math.atan2(fx, fz);           // local +Z along (fx, fz)
  const rotAlong = (ux: number, uz: number) => Math.atan2(-uz, ux);       // local +X along (ux, uz)

  const SW = 0.15; // sidewalk top (ground.ts)
  const put = (k: StreetKind, x: number, y: number, z: number, rot: number, extra?: Partial<StreetItem>) => { const it: StreetItem = { k, x, y, z, rot, ...extra }; items.push(it); return it; };

  mark('segs0');
  // ---- street segments (roadways only) with the traffic chain that drives them
  const segs: Seg[] = [];
  const segGrid = new Grid<Seg>(16);
  raw.streets.forEach((st, si) => {
    if (st.rw !== 1) return;
    for (let i = 0; i + 3 < st.p.length; i += 2) {
      const ax = st.p[i], az = st.p[i + 1], dx = st.p[i + 2] - ax, dz = st.p[i + 3] - az, L = Math.hypot(dx, dz);
      if (L < 0.2) continue;
      const s: Seg = { ax, az, tx: dx / L, tz: dz / L, L, si, chain: -1 };
      segs.push(s);
      segGrid.add(s, Math.min(ax, ax + dx) - 1, Math.min(az, az + dz) - 1, Math.max(ax, ax + dx) + 1, Math.max(az, az + dz) + 1);
    }
  });
  // which traffic chain covers each segment (lanes in use there)
  {
    const cg = new Grid<[number, number]>(16);
    traffic.chains.forEach((c, ci) => { for (let k = 0; k < c.x.length; k++) cg.add([ci, k], c.x[k] - 1, c.z[k] - 1, c.x[k] + 1, c.z[k] + 1); });
    for (const s of segs) {
      const mx = s.ax + s.tx * s.L / 2, mz = s.az + s.tz * s.L / 2, name = raw.streets[s.si].n;
      let best = 4, bc = -1;
      for (const [ci] of cg.around(mx, mz, 30, [])) {
        const c = traffic.chains[ci];
        if (c.name !== name) continue;
        for (let k = 0; k + 1 < c.x.length; k++) {
          const ax = c.x[k], az = c.z[k], dx = c.x[k + 1] - ax, dz = c.z[k + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (mz - az) * dz) / L2));
          const d = Math.hypot(ax + dx * t - mx, az + dz * t - mz);
          if (d < best) { best = d; bc = ci; }
        }
      }
      s.chain = bc;
    }
  }
  const tmpS: Seg[] = [];
  /** nearest roadway segment and the signed offset of (x, z) from it (+ = left of the segment direction, i.e. along (-tz, tx)) */
  const nearestSeg = (x: number, z: number, maxD = 30) => {
    let best: Seg | null = null, bd = maxD, bt = 0, bo = 0;
    for (const s of segGrid.around(x, z, maxD, tmpS)) {
      const t = Math.max(0, Math.min(s.L, (x - s.ax) * s.tx + (z - s.az) * s.tz));
      const px = s.ax + s.tx * t, pz = s.az + s.tz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = s; bt = t; bo = (x - px) * -s.tz + (z - pz) * s.tx; }
    }
    return best ? { seg: best, t: bt, off: bo, d: bd } : null;
  };
  /** how far from the centreline moving traffic reaches (vehicle edge, both sides alike), or -1 if none drives here */
  const movingEdge = (s: Seg) => {
    if (s.chain < 0) return -1;
    const c = traffic.chains[s.chain];
    const lanes = Math.min(4, c.lanes), laneW = c.width / Math.max(lanes, 1), step = Math.min(3.3, laneW);
    const maxOff = c.dir === 0 ? (Math.max(1, Math.floor(lanes / 2)) - 0.5) * step : ((lanes - 1) / 2) * step;
    return maxOff + 1.3;
  };
  const laneCentres = (s: Seg): number[] => {
    if (s.chain < 0) return [];
    const c = traffic.chains[s.chain];
    const lanes = Math.min(4, c.lanes), laneW = c.width / Math.max(lanes, 1), step = Math.min(3.3, laneW);
    if (c.dir === 0) { const nl = Math.max(1, Math.floor(lanes / 2)), out: number[] = []; for (let l = 0; l < nl; l++) out.push((l + 0.5) * step, -(l + 0.5) * step); return out; }
    const out: number[] = [];
    for (let l = 0; l < lanes; l++) out.push((l - (lanes - 1) / 2) * step);
    return out;
  };
  /** the kerb's distance from the centreline at (cx, cz) on side n, by probing for the sidewalk */
  const kerbAt = (cx: number, cz: number, nx: number, nz: number, w: number) => {
    for (let o = Math.max(1, w / 2 - 2); o < w / 2 + 3; o += 0.25) if (walk.has(cx + nx * o, cz + nz * o)) return o - 0.12;
    return -1;
  };

  mark('nodes');
  // ---- intersections from the centreline crossings
  const nodes: Node[] = [];
  {
    const key = (x: number, z: number) => Math.round(x / 3) + "," + Math.round(z / 3);
    const map = new Map<string, Node>();
    const find = (x: number, z: number) => {
      const kx = Math.round(x / 3), kz = Math.round(z / 3);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const n = map.get(kx + i + "," + (kz + j));
        if (n && Math.hypot(n.x - x, n.z - z) < 3) return n;
      }
      const n: Node = { x, z, arms: [], r: 0 };
      map.set(key(x, z), n);
      nodes.push(n);
      return n;
    };
    raw.streets.forEach((st, si) => {
      if (st.rw !== 1 || st.p.length < 4 || st.w < 5) return;
      const p = st.p, n = p.length;
      for (const end of [0, 1]) {
        const x = end ? p[n - 2] : p[0], z = end ? p[n - 1] : p[1];
        const nx = end ? p[n - 4] : p[2], nz = end ? p[n - 3] : p[3];
        const L = Math.hypot(nx - x, nz - z);
        if (L < 0.5) continue;
        const node = find(x, z);
        // traffic along the vertex order (d = 1) leaves the start and arrives at the end
        const inbound = st.d === 0 || (st.d > 0) === (end === 1);
        const outbound = st.d === 0 || (st.d > 0) === (end === 0);
        node.arms.push({ tx: (nx - x) / L, tz: (nz - z) / L, si, name: st.n, w: st.w, inbound, outbound });
      }
    });
  }
  const crossings = nodes.filter((n) => {
    if (new Set(n.arms.map((a) => a.name)).size < 2 || inPark(n.x, n.z)) return false;
    // arms in the same direction (the same street drawn twice): keep the widest
    n.arms.sort((a, b) => b.w - a.w);
    const keep: Arm[] = [];
    for (const a of n.arms) if (!keep.some((k) => k.tx * a.tx + k.tz * a.tz > 0.94)) keep.push(a);
    n.arms = keep.sort((a, b) => Math.atan2(a.tz, a.tx) - Math.atan2(b.tz, b.tx));
    n.r = Math.max(...n.arms.map((a) => a.w / 2)) + 1;
    return n.arms.length >= 2;
  });
  const nodeGrid = new Grid<Node>(32);
  for (const n of crossings) nodeGrid.add(n, n.x - 30, n.z - 30, n.x + 30, n.z + 30);
  /** distance to the nearest intersection's edge (0 inside the junction box) */
  const cornerDist = (x: number, z: number) => {
    let d = Infinity;
    for (const n of nodeGrid.at(x, z)) d = Math.min(d, Math.max(0, Math.hypot(n.x - x, n.z - z) - n.r));
    return d;
  };
  const nearBlocker = (x: number, z: number, pad = 0) => blockers.list.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + pad) ** 2);

  const stats: Record<string, number> = {};
  const count = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
  mark('courts');
  // ================================================================== basketball courts ("cages")
  // The real West 4th Street Courts, and courts in the old parks near the route that the city
  // draws as building sites (see Court.site): Columbus Park, DeSalvio Playground, the Stanton St
  // courts and Sara D. Roosevelt Park.
  {
    const siteAt = (x: number, z: number) => raw.sites.findIndex((st) => inPoly(st.p, x, z));
    const GRID = -Math.PI / 2; // local X along the avenues (uptown)
    const spots: { name: string; at: [number, number]; half?: boolean }[] = [
      { name: "West 4th Street Courts", at: project(city, 40.7311, -74.0006) },
      { name: "Columbus Park courts", at: [-644, 1796] },
      { name: "DeSalvio Playground court", at: [-561, 2635], half: true },
      { name: "Stanton Street Courts", at: [-893, 2835] },
      { name: "Sara D. Roosevelt Park courts", at: [-938, 2470] },
    ];
    const clearRect = (cx: number, cz: number, yaw: number, hw: number, hd: number, site: number) => {
      for (let u = -hw - 0.5; u <= hw + 0.51; u += 1.5) for (let v = -hd - 0.5; v <= hd + 0.51; v += 1.5) {
        const [x, z] = at(cx, cz, yaw, u, v);
        if (city.buildingAt(x, z) || road.has(x, z) || walk.has(x, z) || parks.has(x, z) || !city.onLand(x, z)) return false;
        if (site >= 0 && siteAt(x, z) < 0 && plaza.has(x, z)) return false;
      }
      return true;
    };
    spots.forEach((sp, ci) => {
      let placed = null as Court | null;
      for (const half of sp.half ? [true] : [false, true]) {
        const hw = half ? 8 : 15, hd = 8;
        for (const yaw of [GRID, 0, GRID + 0.35, GRID - 0.35]) for (const [du, dv] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [8, 0], [-8, 0]]) {
          if (placed) break;
          const [cx, cz] = at(sp.at[0], sp.at[1], yaw, du, dv);
          const site = siteAt(cx, cz);
          if (!clearRect(cx, cz, yaw, hw, hd, site)) continue;
          placed = { name: sp.name, x: cx, z: cz, hw, hd, yaw, fence: 3.8, half, site, hoops: [], players: [] };
        }
        if (placed) break;
      }
      if (!placed) { count("court_skipped"); return; }
      const C = placed;
      courts.push(C);
      claim(C.x, C.z, Math.max(C.hw, C.hd) + 1.5);
      const P = (u: number, v: number) => at(C.x, C.z, C.yaw, u, v);
      // the fence: thin boxes per side (fly over it, or bounce off), posts every ~3 m
      const fy = 0.12;
      for (const [u, v, len, along] of [[0, -C.hd, C.hw, true], [0, C.hd, C.hw, true], [-C.hw, 0, C.hd, false], [C.hw, 0, C.hd, false]] as [number, number, number, boolean][]) {
        const [x, z] = P(u, v);
        box("the court fence", x, fy + C.fence / 2, z, along ? len : 0.05, C.fence / 2, along ? 0.05 : len, C.yaw);
        const n = Math.max(2, Math.round((len * 2) / 3));
        for (let k = 0; k <= n; k++) {
          const t = -len + (2 * len * k) / n;
          const [px, pz] = along ? P(t, v) : P(u, t);
          if (!along && (k === 0 || k === n)) continue; // the corners come with the long sides
          put("fence_post", px, fy, pz, 0, { sy: C.fence / 4 });
        }
      }
      // hoops at the baselines, facing in (rim 1.575 m from the baseline; the board 0.29 behind the rim)
      const ends = C.half ? [-1] : [-1, 1];
      for (const e of ends) {
        const bx = C.half ? -7 + 1.285 : e * (14 - 1.285);
        const [hx, hz] = P(bx, 0);
        const rot = C.yaw + (e < 0 ? Math.PI / 2 : -Math.PI / 2); // model +Z (the board's face) toward the middle
        put("hoop", hx, fy, hz, rot);
        C.hoops.push({ x: hx, z: hz, rot });
        const [kx, kz] = at(hx, hz, rot, 0, -1.25);
        cyl("the hoop", kx, kz, 0, fy + 3.5, 0.08);
        const [bbx, bbz] = at(hx, hz, rot, 0, -0.06);
        box("the backboard", bbx, fy + 3.45, bbz, 0.9, 0.53, 0.04, rot);
      }
      // players: a shooter at each hoop, the rest dribbling about
      const np = C.half ? 3 : 6;
      for (let k = 0; k < np; k++) {
        const hoop = C.half ? 0 : k % 2;
        const e = C.half ? -1 : hoop === 0 ? -1 : 1;
        const hu = C.half ? -5.425 : e * 12.425;
        const a = (h01(ci * 31 + k, 1) - 0.5) * 2.4, d = 3 + h01(ci * 31 + k, 2) * 4;
        const u = hu - e * Math.cos(a) * d, v = Math.sin(a) * d;
        const [x, z] = P(u, Math.max(-C.hd + 1, Math.min(C.hd - 1, v)));
        C.players.push({ x, z, mode: k < (C.half ? 1 : 2) ? "shoot" : "dribble", hoop, seed: ci * 100 + k });
      }
      // benches and a few people watching from outside the fence (or inside, if there's no room)
      for (const side of [1, -1]) {
        for (const bu of [-C.hw * 0.45, C.hw * 0.25]) {
          let placedBench = false;
          for (const v of [C.hd + 1.0, C.hd - 0.8]) {
            const [x, z] = P(bu, side * v);
            if (city.buildingAt(x, z) || road.has(x, z) || !city.onLand(x, z)) continue;
            const rot = C.yaw + (side > 0 ? Math.PI : 0); // the bench's front (+Z) toward the court
            put("court_bench", x, fy, z, rot);
            box("a bench", x, fy + 0.4, z, 0.9, 0.4, 0.3, rot);
            if (h01(ci * 7 + bu, side + 3) < 0.7) figures.push({ x: x + Math.sin(rot) * 0.06, y: fy, z: z + Math.cos(rot) * 0.06, rot, pose: "sit", seed: ci * 50 + Math.round(bu) + side });
            placedBench = true;
            break;
          }
          if (!placedBench) continue;
        }
        const nw = 1 + Math.floor(h01(ci, side + 9) * 3);
        for (let k = 0; k < nw; k++) {
          const [x, z] = P((h01(ci * 5 + k, side + 11) - 0.5) * C.hw * 1.6, side * (C.hd + 0.55));
          if (city.buildingAt(x, z) || road.has(x, z) || !city.onLand(x, z)) continue;
          figures.push({ x, y: fy, z, rot: C.yaw + (side > 0 ? Math.PI : 0) + (h01(k, ci) - 0.5) * 0.6, pose: "stand", seed: ci * 70 + k * 3 + side });
          cyl("people watching the game", x, z, 0, fy + 1.75, 0.25);
        }
      }
      count("court");
    });
  }

  mark('corners');
  // ================================================================== corners: signals, signs, baskets, mailboxes, carts
  const groupOf = (n: Node, a: Arm) => { const m = n.arms[0]; return Math.abs(a.tx * m.tx + a.tz * m.tz) > 0.6 ? 0 : 1; };
  const POLE_H = 6.9;

  crossings.forEach((n, ni) => {
    const offset = n.z / 13 + h01(ni, 5) * 6; // a loose green wave uptown
    // busy corners: close to the route in the districts where people stop for a hot dog
    const nearR = city.route.nearest(n.x, n.z);
    const busyNode = nearR.d < 60 && /fidi|flatiron|midtown|columbus|village/.test(city.district(nearR.s).id);
    interface Corner { a: Arm; b: Arm; px: number; pz: number; fa: [number, number]; fb: [number, number]; pole?: [number, number] }
    const corners: Corner[] = [];
    const k = n.arms.length;
    for (let i = 0; i < k; i++) {
      const a = n.arms[i], b = n.arms[(i + 1) % k];
      let gap = Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx);
      if (gap <= 0) gap += Math.PI * 2;
      if (gap < 0.35 || gap > 2.9) continue;
      const sin = Math.sin(gap);
      const px = n.x + (a.tx * (b.w / 2) + b.tx * (a.w / 2)) / sin, pz = n.z + (a.tz * (b.w / 2) + b.tz * (a.w / 2)) / sin;
      // fa: across arm a, away from b (the way the people at this corner cross a); fb likewise
      let fa: [number, number] = [-a.tz, a.tx];
      if (fa[0] * b.tx + fa[1] * b.tz > 0) fa = [a.tz, -a.tx];
      let fb: [number, number] = [-b.tz, b.tx];
      if (fb[0] * a.tx + fb[1] * a.tz > 0) fb = [b.tz, -b.tx];
      const c: Corner = { a, b, px, pz, fa, fb };
      // the corner pole: back from both kerbs
      for (const s of [0.9, 1.3, 1.8, 2.4, 3.1]) {
        const x = px - (fa[0] + fb[0]) * s, z = pz - (fa[1] + fb[1]) * s;
        if (onWalk(x, z) && walk.has(x + fa[0] * 0.45, z + fa[1] * 0.45) && walk.has(x + fb[0] * 0.45, z + fb[1] * 0.45) && free(x, z, 0.5)) { c.pole = [x, z]; break; }
      }
      corners.push(c);
    }
    for (const c of corners) {
      if (!c.pole) continue;
      const [x, z] = c.pole;
      claim(x, z, 0.55);
      put("signal_pole", x, SW, z, rotAlong(c.a.tx, c.a.tz));
      cyl("signal pole", x, z, 0, POLE_H, 0.15);
      count("signal_pole");
      // pedestrian signals facing the people across each crossing
      for (const [f, arm] of [[c.fa, c.a], [c.fb, c.b]] as [[number, number], Arm][]) {
        const r = rotTo(f[0], f[1]);
        const hx = x + f[0] * 0.2, hz = z + f[1] * 0.2;
        put("ped_head", hx, SW + 2.75, hz, r);
        const g = groupOf(n, arm);
        const [lx, lz] = at(hx, hz, r, 0, 0.13);
        lenses.push({ x: lx, y: SW + 2.75, z: lz, rot: r, size: 0.3, kind: 3, group: g, offset });
        lenses.push({ x: lx, y: SW + 2.75, z: lz, rot: r, size: 0.3, kind: 4, group: g, offset });
        count("ped_head");
      }
      // street name blades on top, one along each street
      const along = (arm: Arm, y: number) => {
        const r = rotAlong(arm.tx, arm.tz);
        plates.push({ x: x + arm.tx * 0.5, y, z: z + arm.tz * 0.5, rot: r, w: 1.05, h: 0.24, front: nameCell(arm.name), back: nameCell(arm.name) });
        count("name_blade");
      };
      along(c.a, SW + 6.3);
      along(c.b, SW + 6.57);
      // one-way arrows under them
      for (const arm of [c.a, c.b]) {
        if (arm.inbound === arm.outbound) continue;
        const tx = arm.outbound ? arm.tx : -arm.tx, tz = arm.outbound ? arm.tz : -arm.tz;
        plates.push({ x: x + arm.tx * 0.32, y: SW + 3.55 + (arm === c.b ? 0.36 : 0), z: z + arm.tz * 0.32, rot: rotAlong(tx, tz), w: 0.9, h: 0.3, front: "oneway_r", back: "oneway_l" });
        count("oneway");
      }
    }
    // vehicle signals: for each street arriving here, heads on a mast arm from the far-right corner
    for (const a of n.arms) {
      if (!a.inbound) continue;
      const vx = -a.tx, vz = -a.tz, rx = -vz, rz = vx; // travel direction and its right
      let best: Corner | null = null, bs = 0;
      for (const c of corners) {
        if (!c.pole) continue;
        const dx = c.pole[0] - n.x, dz = c.pole[1] - n.z;
        const f = dx * vx + dz * vz, s = dx * rx + dz * rz;
        if (f > 0.5 && s > 0.5 && f + s > bs) { bs = f + s; best = c; }
      }
      if (!best) continue;
      const [px, pz] = best.pole!;
      // the arm reaches left across the lanes
      const ax = -rx, az = -rz;
      const len = Math.max(3, Math.min(10, a.w * (a.inbound && a.outbound ? 0.42 : 0.72)));
      const ar = rotTo(ax, az);
      put("mast_arm", px, SW + 6.15, pz, ar, { sz: len });
      box("signal arm", px + ax * len / 2, SW + 6.15, pz + az * len / 2, 0.09, 0.1, len / 2, ar);
      count("mast_arm");
      const g = groupOf(n, a);
      const heads = len > 6 ? [0.45, 0.92] : [0.82];
      for (const f of heads) {
        const hx = px + ax * len * f, hz = pz + az * len * f;
        const r = rotTo(-vx, -vz); // facing the oncoming drivers
        put("signal_head", hx, SW + 5.45, hz, r);
        box("traffic signal", hx, SW + 5.45, hz, 0.2, 0.55, 0.2, r);
        const [lx, lz] = at(hx, hz, r, 0, 0.16);
        for (let li = 0; li < 3; li++) lenses.push({ x: lx, y: SW + 5.45 + (1 - li) * 0.33, z: lz, rot: r, size: 0.27, kind: li, group: g, offset });
        count("signal_head");
      }
    }
    // the corner's other furniture: wire baskets, mailboxes, newsstands, food carts
    corners.forEach((c, ci) => {
      const seed = ni * 7 + ci;
      const spot = (arm: Arm, f: [number, number], along: number, inset: number, r: number): [number, number] | null => {
        const x = c.px + arm.tx * along - f[0] * inset, z = c.pz + arm.tz * along - f[1] * inset;
        if (!onWalk(x, z) || !walk.has(x + f[0] * (inset - 0.35), z + f[1] * (inset - 0.35)) || !free(x, z, r) || inPark(x, z)) return null;
        return [x, z];
      };
      const [arm, f] = h01(seed, 1) < 0.5 ? [c.a, c.fa] : [c.b, c.fb];
      if (h01(seed, 2) < 0.62) {
        const p = spot(arm, f, 3.2 + h01(seed, 3) * 2, 0.55, 0.4);
        if (p) { claim(p[0], p[1], 0.4); put("basket", p[0], SW, p[1], h01(seed, 4) * 6.28); cyl("litter basket", p[0], p[1], 0, SW + 0.92, 0.3); count("basket"); }
      }
      if (h01(seed, 5) < 0.2) {
        const p = spot(arm, f, 6 + h01(seed, 6) * 2, 0.6, 0.45);
        if (p) { claim(p[0], p[1], 0.45); const r = rotTo(-f[0], -f[1]); put("mailbox", p[0], SW, p[1], r); box("mailbox", p[0], SW + 0.64, p[1], 0.29, 0.64, 0.27, r); count("mailbox"); }
      }
      const other = arm === c.a ? c.b : c.a, of = arm === c.a ? c.fb : c.fa;
      const busy = busyNode;
      const wide = AVENUE.test(other.name) || other.w >= 15;
      if (wide && h01(seed, 7) < 0.16) {
        // newsstand: on a wide sidewalk by the kerb, its long side along the avenue
        const p = spot(other, of, 9 + h01(seed, 8) * 3, 1.25, 1.9);
        if (p && onWalk(p[0] - of[0] * 2.4, p[1] - of[1] * 2.4)) {
          claim(p[0], p[1], 1.9);
          const r = rotTo(-of[0], -of[1]);
          put("newsstand", p[0], SW, p[1], r);
          box("newsstand", p[0], SW + 1.35, p[1], 1.65, 1.35, 0.8, r);
          count("newsstand");
        }
      } else if ((busy && h01(seed, 13) < 0.6) || (wide && h01(seed, 9) < 0.14)) {
        // a cart on the corner: on busy corners near the route mostly hot dogs, elsewhere halal or hot dogs
        const p = spot(other, of, 4 + h01(seed, 10) * 2, 1.0, 2.6);
        if (p && !steamNear(p[0], p[1], 4) && !holeNear(p[0], p[1], 4) && !shaftNear(p[0], p[1], 2.5) && !nearBlocker(p[0], p[1], 8)) {
          claim(p[0], p[1], 1.4);
          const r = rotAlong(other.tx, other.tz) + (h01(seed, 11) < 0.5 ? Math.PI : 0);
          const k: StreetKind = busy ? (h01(seed, 12) < 0.8 ? "hotdog_cart" : "food_cart") : (h01(seed, 12) < 0.6 ? "food_cart" : "hotdog_cart");
          put(k, p[0], SW, p[1], r);
          box(k === "food_cart" ? "halal cart" : "hot dog cart", p[0], SW + 1.1, p[1], k === "food_cart" ? 1.0 : 0.85, 1.1, 0.5, r);
          count(k);
          // the vendor stands on the road side; customers queue on the sidewalk side, along the kerb
          const zs = Math.sign(Math.sin(r) * of[0] + Math.cos(r) * of[1]) || 1; // which way local +Z faces: toward the road?
          const person = (lx: number, lz: number, face: number, sd: number) => {
            const [fx, fz] = at(p[0], p[1], r, lx, lz);
            if (!walk.has(fx, fz) || city.buildingAt(fx, fz) || shaftNear(fx, fz, 0.4)) return false; // (the corner spot was checked free)
            claim(fx, fz, 0.3);
            figures.push({ x: fx, y: SW, z: fz, rot: r + face, pose: "stand", seed: sd });
            cyl("people at the cart", fx, fz, 0, SW + 1.75, 0.25);
            return true;
          };
          person(-0.35, 0.72 * zs, zs > 0 ? Math.PI : 0, seed * 13 + 1);
          const queue = Math.floor(h01(seed, 14) * 4.2);
          let n = 1;
          for (let q = 0; q < queue; q++) { if (!person(0.15 + q * 0.72, -(0.95 + q * 0.08) * zs, zs > 0 ? 0 : Math.PI, seed * 13 + 2 + q)) break; n++; }
          count("cart_people", n);
        }
      }
    });
  });

  mark('runs');
  // ================================================================== kerb runs: lights, hydrants, signs, meters, racks, kiosks, bus stops
  interface Sample { x: number; z: number; nx: number; nz: number; tx: number; tz: number; cd: number }
  interface Run { samples: Sample[]; seg: Seg | null }
  const runs: Run[] = [];
  raw.sidewalk.forEach((p, pi) => {
    p.forEach((r, ri) => {
      const n = r.length / 2;
      if (n < 3) return;
      // walk the ring; split into runs of consecutive kerb edges
      let cur: Sample[] = [];
      let carry = 0;
      const flush = () => { if (cur.length > 6) runs.push({ samples: cur, seg: null }); cur = []; carry = 0; };
      // start at an edge that isn't kerb so runs don't wrap (if every edge is kerb, start anywhere)
      let start = 0;
      const isKerb: boolean[] = [];
      const nrm: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1e-9;
        let nx = -(bz - az) / L, nz = (bx - ax) / L;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (walk.has(mx + nx * 0.2, mz + nz * 0.2)) { nx = -nx; nz = -nz; }
        nrm.push([nx, nz]);
        isKerb.push(L > 0.05 && (road.has(mx + nx * 1.2, mz + nz * 1.2) || road.has(mx + nx * 2.6, mz + nz * 2.6)));
      }
      for (let i = 0; i < n; i++) if (!isKerb[i]) { start = i; break; }
      for (let q = 0; q < n; q++) {
        const i = (start + q) % n, j = (i + 1) % n;
        if (!isKerb[i]) { flush(); continue; }
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        let d = carry;
        for (; d < L; d += 1) {
          const x = ax + tx * d, z = az + tz * d;
          cur.push({ x, z, nx: nrm[i][0], nz: nrm[i][1], tx, tz, cd: 0 });
        }
        carry = d - L;
      }
      flush();
    });
  });
  for (const run of runs) {
    for (const s of run.samples) s.cd = cornerDist(s.x, s.z);
    const mid = run.samples[run.samples.length >> 1];
    const ns = nearestSeg(mid.x + mid.nx * 3, mid.z + mid.nz * 3, 25);
    run.seg = ns?.seg ?? null;
  }

  /** sidewalk depth inward from a kerb sample, to the building line or the far edge */
  const depthAt = (s: Sample) => {
    for (let d = 0.5; d < 14; d += 0.25) {
      const x = s.x - s.nx * d, z = s.z - s.nz * d;
      if (!walk.has(x, z) || city.buildingAt(x, z)) return d;
    }
    return 14;
  };
  const districtAt = (x: number, z: number) => city.district(city.route.nearest(x, z).s).id;
  const hydrants: [number, number][] = [];
  const busZones: [number, number, number][] = [];
  const dockZones: [number, number, number][] = [];

  runs.forEach((run, ri) => {
    const S = run.samples, N = S.length;
    const seg = run.seg;
    if (!seg) return;
    const st = raw.streets[seg.si];
    if (inPark(S[N >> 1].x, S[N >> 1].z)) return;
    const wide = AVENUE.test(st.n) || st.w >= 15;
    const at1 = (i: number, inset: number) => { const s = S[Math.max(0, Math.min(N - 1, i))]; return { x: s.x - s.nx * inset, z: s.z - s.nz * inset, s }; };
    const okAt = (x: number, z: number, r: number) => onWalk(x, z) && free(x, z, r) && !inPark(x, z);
    const facing = (s: Sample) => rotTo(s.nx, s.nz); // local +Z toward the road
    // can cars park along this kerb? (the kerb lane is clear of moving traffic)
    const mid = S[N >> 1];
    const ns = nearestSeg(mid.x + mid.nx * 2, mid.z + mid.nz * 2, 25);
    const kerbOff = ns ? Math.abs(ns.off) + 2 : 0; // distance from the centreline to this kerb
    const edge = ns ? movingEdge(ns.seg) : -1;
    const parking = !!ns && kerbOff - 2.1 >= edge + 0.25 && st.w >= 6;
    // is this the right-hand kerb for the traffic (where buses stop)?
    const travel = st.d === 0 ? 0 : st.d;
    const rightSide = travel === 0 ? true : ((-seg.tz * travel) * mid.nx + (seg.tx * travel) * mid.nz) < 0;

    // ---- street lights every ~30 m, out of the corners
    const district = districtAt(mid.x, mid.z);
    const crookArea = /CENTRAL PARK S/.test(st.n) || ((district === "littleitaly" || district === "village" || district === "chinatown") && h01(ri, 31) < 0.6) || (district === "battery");
    const phase = Math.floor(h01(ri, 1) * 30);
    for (let i = phase; i < N; i += 30) {
      let placed = false;
      for (const j of [i, i + 3, i - 3, i + 6]) {
        if (j < 0 || j >= N || S[j].cd < 8) continue;
        const p = at1(j, 0.5);
        if (!okAt(p.x, p.z, 0.45)) continue;
        claim(p.x, p.z, 0.45);
        const r = facing(p.s);
        const crook = crookArea;
        put(crook ? "light_crook" : "light_cobra", p.x, SW, p.z, r);
        if (crook) {
          cyl("lamppost", p.x, p.z, 0, SW + 7.8, 0.17);
          const [hx, hz] = at(p.x, p.z, r, 0, 1.05);
          sphere("lamp", hx, SW + 7.0, hz, 0.38);
          pools.push({ x: hx, z: hz, r: 5.5 });
        } else {
          cyl("lamppost", p.x, p.z, 0, SW + 8.9, 0.15);
          const [hx, hz] = at(p.x, p.z, r, 0, 1.5);
          box("lamp arm", hx, SW + 8.85, hz, 0.12, 0.2, 1.45, r);
          const [lx, lz] = at(p.x, p.z, r, 0, 2.55);
          pools.push({ x: lx, z: lz, r: 7.5 });
        }
        count(crook ? "light_crook" : "light_cobra");
        placed = true;
        break;
      }
      void placed;
    }

    // ---- a fire hydrant near one end of the block (NYC: 15 ft of kerb kept clear)
    for (const [end, prob] of [[0, 0.62], [1, 0.3]] as [number, number][]) {
      if (h01(ri, 2 + end) > prob) continue;
      for (let q = 0; q < 12; q++) {
        const i = end === 0 ? q : N - 1 - q;
        if (i < 0 || i >= N || S[i].cd < 3.5 || S[i].cd > 14) continue;
        const p = at1(i, 0.45);
        if (!okAt(p.x, p.z, 0.4)) continue;
        claim(p.x, p.z, 0.4);
        put("hydrant", p.x, SW, p.z, facing(p.s) + (h01(ri, 9) - 0.5) * 0.6);
        cyl("fire hydrant", p.x, p.z, 0, SW + 0.86, 0.22);
        hydrants.push([p.x, p.z]);
        count("hydrant");
        break;
      }
    }

    // ---- bus stop: a flag pole near the far end, a shelter behind it when there's room
    if (BUS.test(st.n) && rightSide && N > 45 && h01(ri, 4) < 0.7) {
      const downstream = travel === 0 ? (h01(ri, 5) < 0.5 ? 1 : 0) : ((S[N - 1].x - S[0].x) * seg.tx + (S[N - 1].z - S[0].z) * seg.tz) * travel > 0 ? 1 : 0;
      for (let q = 10; q < 25; q++) {
        const i = downstream ? N - 1 - q : q;
        if (S[i].cd < 9) continue;
        const p = at1(i, 0.5);
        if (!okAt(p.x, p.z, 0.35)) continue;
        claim(p.x, p.z, 0.35);
        const r = facing(p.s);
        put("bus_pole", p.x, SW, p.z, r);
        cyl("bus stop sign", p.x, p.z, 0, SW + 3.1, 0.07);
        // the flag sticks out from the pole across the sidewalk, facing up and down the street
        plates.push({ x: p.x - p.s.nx * 0.27, y: SW + 2.6, z: p.z - p.s.nz * 0.27, rot: rotAlong(-p.s.nx, -p.s.nz), w: 0.46, h: 0.62, front: "bus_sign", back: "bus_sign" });
        busZones.push([p.x, p.z, 0]);
        count("bus_pole");
        // the shelter, upstream of the pole
        const dir = downstream ? -1 : 1;
        const j = i + dir * 7;
        if (j > 0 && j < N - 1) {
          const sp = at1(j, 1.15);
          const dep = depthAt(S[j]);
          if (dep > 4.0 && okAt(sp.x, sp.z, 2.4) && onWalk(sp.x + sp.s.tx * 2.4, sp.z + sp.s.tz * 2.4) && onWalk(sp.x - sp.s.tx * 2.4, sp.z - sp.s.tz * 2.4)) {
            claim(sp.x, sp.z, 2.6);
            const rr = rotTo(sp.s.nx, sp.s.nz); // the open side (model +Z) toward the road
            put("bus_shelter", sp.x, SW, sp.z, rr);
            box("bus shelter", sp.x, SW + 1.3, sp.z, 2.45, 1.3, 0.75, rr);
            count("bus_shelter");
          }
        }
        busZones[busZones.length - 1][2] = 1;
        break;
      }
    }

    // ---- mid-block: a city kiosk on the avenues, bike racks, a parking pay station
    if (wide && N > 30 && h01(ri, 6) < 0.4) {
      const i = Math.floor(N * (0.3 + h01(ri, 7) * 0.4));
      const p = at1(i, 0.75);
      if (S[i].cd > 9 && okAt(p.x, p.z, 0.6)) {
        claim(p.x, p.z, 0.6);
        const r = rotAlong(p.s.tx, p.s.tz);
        put("kiosk", p.x, SW, p.z, r);
        box("street kiosk", p.x, SW + 1.45, p.z, 0.45, 1.45, 0.16, r);
        count("kiosk");
      }
    }
    if (N > 25 && h01(ri, 8) < 0.3) {
      const i = Math.floor(N * (0.2 + h01(ri, 10) * 0.6));
      const nr = 1 + Math.floor(h01(ri, 11) * 3);
      for (let q = 0; q < nr; q++) {
        const p = at1(i + q * 2, 0.7);
        if (S[Math.min(N - 1, i + q * 2)].cd < 8 || !okAt(p.x, p.z, 0.55)) continue;
        claim(p.x, p.z, 0.55);
        const r = rotTo(p.s.nx, p.s.nz); // hoops stand across the kerb
        put("bike_rack", p.x, SW, p.z, r);
        if (h01(ri * 3 + q, 12) < 0.4) { const [bx, bz] = at(p.x, p.z, r, 0.22, 0); put("bike", bx, SW, bz, r); } // someone's bike locked to it
        box("bike rack", p.x, SW + 0.45, p.z, 0.05, 0.45, 0.45, r);
        count("bike_rack");
      }
    }
    if (parking && N > 30) {
      const i = Math.floor(N * (0.35 + h01(ri, 13) * 0.3));
      const p = at1(i, 0.55);
      if (S[i].cd > 8 && okAt(p.x, p.z, 0.4)) {
        claim(p.x, p.z, 0.4);
        const r = facing(p.s) + Math.PI;
        put("munimeter", p.x, SW, p.z, r);
        box("parking meter", p.x, SW + 0.8, p.z, 0.2, 0.8, 0.14, r);
        count("munimeter");
      }
    }
    // ---- parking rules on little posts every ~22 m
    const sp0 = Math.floor(h01(ri, 14) * 22);
    for (let i = sp0 + 6; i < N - 6; i += 22) {
      if (S[i].cd < 6) continue;
      const p = at1(i, 0.35);
      if (!okAt(p.x, p.z, 0.3)) continue;
      claim(p.x, p.z, 0.3);
      const r = facing(p.s);
      put("sign_post", p.x, SW, p.z, r);
      cyl("sign post", p.x, p.z, 0, SW + 2.75, 0.05);
      const rule = !parking ? (h01(ri, i) < 0.6 ? "nostanding" : "noparking") : (h01(ri, i) < 0.55 ? "sweep" : h01(ri, i) < 0.8 ? "noparking" : "loading");
      // the sign faces along the kerb (both ways), mounted on the post
      plates.push({ x: p.x, y: SW + 2.35, z: p.z, rot: rotTo(p.s.tx, p.s.tz) + 0, w: 0.3, h: 0.45, front: rule, back: rule === "sweep" ? "noparking" : rule });
      count("sign_post");
    }

    // ---- bike share dock in the parking lane
    if (parking && N > 50 && h01(ri, 15) < 0.09 && ns) {
      const i0 = Math.floor(N * 0.3), n = 10 + Math.floor(h01(ri, 16) * 8);
      const s0 = S[i0];
      if (s0.cd > 10 && i0 + n + 2 < N - 10) {
        dockZones.push([s0.x, s0.z, 0]);
        const sN = S[i0 + n];
        dockZones.push([sN.x, sN.z, 0]);
        let any = false;
        for (let q = 0; q < n; q++) {
          const s = S[i0 + q];
          const x = s.x + s.nx * 1.05, z = s.z + s.nz * 1.05;
          if (!road.has(x, z)) continue;
          const r = rotTo(-s.nx, -s.nz); // bikes nose-in toward the kerb
          put("bike_dock", x, 0.02, z, r);
          if (h01(ri * 31 + q, 17) < 0.72) put("bike", x, 0.02, z, r, { v: h01(ri * 31 + q, 18) < 0.5 ? 0 : 1 });
          any = true;
        }
        if (any) {
          const s = S[i0 + n];
          const kx = s.x + s.nx * 1.0, kz = s.z + s.nz * 1.0;
          put("bike_kiosk", kx, 0.02, kz, rotTo(-s.nx, -s.nz));
          const sm = S[i0 + (n >> 1)];
          box("bike share dock", sm.x + sm.nx * 1.05, 0.62, sm.z + sm.nz * 1.05, n / 2 + 0.6, 0.6, 1.0, rotAlong(sm.tx, sm.tz));
          count("bike_dock", n);
          count("bike_station");
        }
      }
    }
  });

  mark('building');
  // ================================================================== building lines: standpipes and sidewalk sheds
  raw.sidewalk.forEach((p, pi) => {
    p.forEach((r, ri) => {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 9) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        let nx = -tz, nz = tx;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (walk.has(mx + nx * 0.2, mz + nz * 0.2)) { nx = -nx; nz = -nz; }
        const b = city.buildingAt(mx + nx * 1.0, mz + nz * 1.0);
        if (!b || b.h < 6 || inPark(mx, mz)) continue;
        const seed = pi * 1000 + ri * 100 + i;
        // sidewalk depth across from this frontage
        let depth = 0;
        for (let d = 0.5; d < 12; d += 0.25) if (!walk.has(mx - nx * d, mz - nz * d)) { depth = d; break; }
        if (depth === 0) continue;
        const toRoad = road.has(mx - nx * (depth + 1.2), mz - nz * (depth + 1.2)) || road.has(mx - nx * (depth + 2.5), mz - nz * (depth + 2.5));
        // a sidewalk shed: green plywood on pipe posts, very New York (old or tall buildings, often)
        const pShed = (b.year < 1935 ? 0.16 : 0.07) + (b.h > 60 ? 0.06 : 0);
        if (toRoad && depth > 2.6 && depth < 9 && h01(seed, 1) < pShed && !nearBlocker(mx, mz, 10)) {
          const len = Math.min(L - 1, 18 + h01(seed, 2) * 22);
          const bays = Math.max(3, Math.floor(len / 2.4));
          const total = bays * 2.4;
          const c0 = (L - total) / 2;
          const D = depth - 0.6;
          const rot = rotTo(-nx, -nz); // local +Z from the building toward the kerb
          for (let q = 0; q < bays; q++) {
            const u = c0 + (q + 0.5) * 2.4;
            const x = ax + tx * u, z = az + tz * u;
            put("shed_bay", x, SW, z, rot, { sz: D / 4 });
          }
          // the posts along the kerb, one per bay end, and the closed ends of the parapet
          for (let q = 0; q <= bays; q++) {
            const u = c0 + q * 2.4;
            cyl("sidewalk shed post", ax + tx * u - nx * D, az + tz * u - nz * D, 0, SW + 3.1, 0.07);
            if (q === 0 || q === bays) put("shed_end", ax + tx * u, SW, az + tz * u, rot, { sz: D / 4 });
          }
          const cu = c0 + total / 2;
          box("sidewalk shed", ax + tx * cu - nx * D / 2, SW + 3.72, az + tz * cu - nz * D / 2, total / 2, 0.62, D / 2, rotAlong(tx, tz));
          // keep the kerb-side posts' spots
          for (let q = 0; q <= bays; q++) claim(ax + tx * (c0 + q * 2.4) - nx * D, az + tz * (c0 + q * 2.4) - nz * D, 0.25);
          count("shed");
          count("shed_bay", bays);
        } else if (b.h > 25 && h01(seed, 3) < 0.3) {
          // a standpipe (Siamese connection) on the facade
          const u = 1.5 + h01(seed, 4) * (L - 3);
          const x = ax + tx * u - nx * 0.18, z = az + tz * u - nz * 0.18;
          if (walk.has(x, z) && free(x, z, 0.35)) {
            claim(x, z, 0.35);
            const rot = rotTo(-nx, -nz);
            put("standpipe", x, SW, z, rot);
            box("standpipe", x, SW + 0.62, z, 0.32, 0.2, 0.16, rot);
            count("standpipe");
          }
        }
      }
    });
  });

  mark('plaza');
  // ================================================================== plazas: bollards, planters, Jersey barriers
  raw.plaza.forEach((p, pi) => {
    const r = p[0], n = r.length / 2;
    const cx = r[0], cz = r[1];
    if (inPark(cx, cz)) return;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      let nx = -tz, nz = tx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (plaza.has(mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; }
      if (!road.has(mx + nx * 1.5, mz + nz * 1.5)) continue;
      const seed = pi * 100 + i;
      const y = 0.08;
      const style = h01(seed, 1);
      const inside = (u: number, inset: number): [number, number] | null => {
        const x = ax + tx * u - nx * inset, z = az + tz * u - nz * inset;
        // (never across the flight line: the route runs through the Broadway plazas)
        return plaza.has(x, z) && !city.buildingAt(x, z) && free(x, z, 0.3) && city.route.nearest(x, z).d > 5 ? [x, z] : null;
      };
      if (style < 0.5) {
        for (let u = 0.8; u < L - 0.5; u += 1.55) {
          const q = inside(u, 0.55);
          if (!q) continue;
          claim(q[0], q[1], 0.3);
          put("bollard", q[0], y, q[1], 0);
          cyl("bollard", q[0], q[1], 0, y + 0.95, 0.15);
          count("bollard");
        }
      } else if (style < 0.85) {
        for (let u = 1.2; u < L - 1; u += 4.2) {
          const q = inside(u, 0.95);
          if (!q) continue;
          claim(q[0], q[1], 0.85);
          const rot = rotAlong(tx, tz);
          put(h01(seed, Math.round(u)) < 0.5 ? "planter" : "planter_round", q[0], y, q[1], rot);
          box("planter", q[0], y + 0.42, q[1], 0.62, 0.42, 0.62, rot);
          count("planter");
          // bollards between the planters
          for (const du of [1.6, 2.6]) {
            const qb = inside(u + du, 0.55);
            if (!qb || u + du > L - 0.5) continue;
            claim(qb[0], qb[1], 0.3);
            put("bollard", qb[0], y, qb[1], 0);
            cyl("bollard", qb[0], qb[1], 0, y + 0.95, 0.15);
            count("bollard");
          }
        }
      } else if (L > 7) {
        for (let u = 1.7; u < L - 1.6; u += 3.3) {
          const q = inside(u, 0.6);
          if (!q) continue;
          claim(q[0], q[1], 0.6);
          const rot = rotAlong(tx, tz);
          put("jersey", q[0], y, q[1], rot);
          box("jersey barrier", q[0], y + 0.41, q[1], 1.52, 0.41, 0.31, rot);
          count("jersey");
        }
      }
    }
  });

  mark('parked');
  // ================================================================== parked cars, delivery trucks
  const zoneGrid = (list: [number, number, number?][]) => { const g = new Grid<[number, number, number?]>(32); for (const p of list) g.add(p, p[0], p[1], p[0], p[1]); return g; };
  const zones = new Map<unknown, Grid<[number, number, number?]>>();
  const tmpZ: [number, number, number?][] = [];
  const nearList = (list: [number, number, number?][], x: number, z: number, r: number) => {
    let g = zones.get(list);
    if (!g) zones.set(list, (g = zoneGrid(list)));
    return g.around(x, z, r, tmpZ).some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < r * r);
  };
  const PARK_KINDS: [VehicleKind, number][] = [["car", 0.33], ["suv", 0.24], ["hatch", 0.12], ["cab", 0.07], ["van", 0.08], ["pickup", 0.08], ["sports", 0.03], ["limo", 0.02], ["police", 0.03]];
  const pickParked = (r: number): VehicleKind => { let a = 0; for (const [k, p] of PARK_KINDS) { a += p; if (r < a) return k; } return "car"; };
  const roadSegs = new Map<number, Seg[]>();
  for (const s of segs) (roadSegs.get(s.si) ?? roadSegs.set(s.si, []).get(s.si)!).push(s);
  let pseed = 1;
  raw.streets.forEach((st, si) => {
    if (st.rw !== 1 || st.w < 6.5) return;
    const list = roadSegs.get(si);
    if (!list) return;
    // the street's own length (LION splits at the crossings, so a street is usually a block)
    let total = 0;
    for (const s of list) total += s.L;
    if (total < 30) return;
    for (const side of [1, -1]) {
      let run = 0;
      let truckDone = h01(si, side + 40) > 0.3;
      for (const s of list) {
        const nx = -s.tz * side, nz = s.tx * side;
        const edge = movingEdge(s);
        let t = Math.max(0, 11 - run);
        const tEnd = Math.min(s.L, total - 11 - run);
        while (t < tEnd - 4) {
          pseed++;
          if (h01(pseed, 1) < 0.1) { t += 5 + h01(pseed, 2) * 6; continue; } // an empty space
          const truck = !truckDone && h01(pseed, 3) < 0.12;
          const kind: VehicleKind = truck ? (h01(pseed, 4) < 0.6 ? "truck" : "van") : pickParked(h01(pseed, 5));
          const size = VEHICLE_SIZE[kind];
          if (t + size.l > tEnd) break;
          const tc = t + size.l / 2;
          const cx = s.ax + s.tx * tc, cz = s.az + s.tz * tc;
          const kerb = kerbAt(cx, cz, nx, nz, st.w);
          if (kerb < 0 || nearBlocker(cx, cz, 6)) { t += 3; continue; }
          let off = kerb - 0.2 - size.w / 2;
          let dbl = false;
          if (truck && kerb - 2.3 - size.w - 0.25 >= edge) { off = kerb - 2.3 - size.w / 2; dbl = true; }
          if (off - size.w / 2 < edge + 0.25) { t += 3; continue; }
          const x = cx + nx * off, z = cz + nz * off;
          if (!road.has(x, z) || walk.has(x + nx * (size.w / 2 - 0.1), z + nz * (size.w / 2 - 0.1)) ||
            nearList(hydrants, x, z, 4.6 + size.l / 2) || nearList(busZones, x, z, 16) || nearList(dockZones, x, z, 6) ||
            steamNear(x, z, 1.4 + size.l / 2) || holeNear(x, z, 2.2 + size.l / 2) || shaftNear(x, z, size.l / 2)) { t += 2; continue; }
          // parked facing the traffic flow (or either way on two-way streets)
          const flow = st.d === 0 ? side : st.d;
          const dir = flow >= 0 ? 1 : -1;
          const rot = rotTo(s.tx * dir, s.tz * dir);
          parked.push({ kind, x, z, rot, seed: pseed, hazard: truck, double: dbl });
          box(truck ? "delivery truck" : "parked car", x, 0.02 + size.h / 2, z, size.w / 2, size.h / 2, size.l / 2, rot);
          if (truck) {
            truckDone = true;
            // hazard blinkers at the four corners
            for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
              const [hx, hz] = at(x, z, rot, lx * (size.w / 2 - 0.08), lz * (size.l / 2 + 0.03));
              lenses.push({ x: hx, y: kind === "truck" ? 0.95 : 0.9, z: hz, rot: rot + (lz < 0 ? Math.PI : 0), size: 0.2, kind: 5, group: 0, offset: h01(pseed, 6) });
            }
            count(dbl ? "double_parked" : "delivery_kerb");
          } else count("parked");
          t += size.l + 0.9 + h01(pseed, 7) * 1.6;
        }
        run += s.L;
      }
    }
  });

  mark('steam');
  // ================================================================== Con Ed steam stacks on a few of the vents
  for (const v of life.steam) {
    const ns = nearestSeg(v.x, v.z, 15);
    if (!ns || h01(Math.round(v.x * 10), Math.round(v.z * 10)) > 0.13) continue;
    const lanes = laneCentres(ns.seg);
    // the lane offsets are symmetric about the centreline, so the segment's direction doesn't matter
    const clear = lanes.every((c) => Math.abs(ns.off - c) > 1.95);
    if (!clear || !road.has(v.x, v.z)) continue;
    put("steam_stack", v.x, 0.02, v.z, hp(v.x, v.z, 3) * 6.28);
    cyl("a steam stack", v.x, v.z, 0, 3.4, 0.45);
    count("steam_stack");
  }

  mark("end");
  Object.assign(stats, tm);
  stats.items = items.length; stats.plates = plates.length; stats.lenses = lenses.length; stats.parkedTotal = parked.length; stats.colliders = colliders.length;
  stats.intersections = crossings.length;
  return { items, plates, lenses, parked, colliders, names, pools, figures, courts, stats };
}
