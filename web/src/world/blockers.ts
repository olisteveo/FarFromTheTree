// Blockers: places where the street layer is shut, so at street level you go over the roofs, under through the
// subway, or round by another street. They punish the shortcuts: none of them cuts a way through (world/
// windFeatures.ts routes): the Rooftops way passes over them, the subway under, and where the West or East Side
// way (or the Rooftops way, come down into the canyon) runs through one, a lane's kept open along it (Barrier.gaps).
// All very late November, and all things a New Yorker would recognise:
//   FiDi        a water main burst under Broadway: the block fenced off at street level by the crews' MDF
//               hoarding, trucks outside, and in the open middle a geyser from a crater, tall and violent (its
//               column and its fall of water are the hazard: it's what shuts the block, up to ~26 m)
//   Civic Ctr   a building site on Centre St by the courthouses (the short cut up to Canal), and
//   Union Sq    one on E 15th St (the short cut east): the scaffold and netting on the building's own frontage,
//               a tower crane, the street shut at ground level by a sidewalk shed deck run across it with MDF
//               hoarding under its ends; above that a concrete pump's boom across the street and the crane's
//               load swinging over it (Blocker.solids, craneAt)
//   Chinatown   the Mulberry Street festival: curtains of lanterns strung wall to wall up to the roofs
//   Midtown     Times Square packed solid: NYPD and sanitation trucks, barricades, a web of lights above
//   Columbus    the Thanksgiving parade: barricades, grandstands, the giant balloon
// Shapes: an "area" closes every street entering a circle (up to the roofline of the canyon, capped at CAP);
// a "stretch" closes one block of one street at both ends (low, at street level: what's over it is the hazard).

import type { CityData } from "./data";
import { project } from "./landmarks";

export type BlockerKind = "festival" | "crowd" | "water" | "construction" | "parade";

/** An open lane through a barrier (a way through runs there): across a0..a1 (along ax, az from the
 *  barrier's centre), from the street up to `top`. */
export interface Gap { a0: number; a1: number; top: number }

export interface Barrier {
  blocker: string;
  kind: BlockerKind;
  /** the barrier is a vertical rectangle: centre, direction across the street, half width, height */
  x: number; z: number; ax: number; az: number; half: number; height: number;
  /** its normal, pointing out of the closed area */
  nx: number; nz: number;
  /** the heights of the buildings it meets at each end (-ax end, +ax end; 0: open, no wall) */
  walls: [number, number];
  /** the street it closes, and its roadway width */
  street: string; w: number;
  /** how far it's solid either side of its plane, along the normal (inside, outside): the spray's thickness,
   *  the trucks' width, the scaffold standing out in front of the hoarding */
  depth: [number, number];
  gaps: Gap[];
}

export interface Blocker {
  id: string; name: string; hint: string; x: number; z: number; r: number;
  /** how high the closure's danger reaches: the top of its tallest barrier, its geyser, its boom and crane load */
  height: number;
  /** the burst main's geyser (water only): where it erupts from the crater, its column's radius and height, and
   *  the radius of the fall of water round it */
  geyser?: { x: number; z: number; r: number; h: number; fall: number };
  /** fixed hazards over a building site: the concrete pump's boom across the street, its hose */
  solids?: Capsule[];
  /** a building site's tower crane (its load swings over the street: craneAt) */
  crane?: Crane;
  /** a building site: which side of the street the building is on (+1: along +ax of the barriers), the block's
   *  middle, the street's direction along it and across it, the closed length and the half width */
  site?: { side: number; x: number; z: number; tx: number; tz: number; ax: number; az: number; len: number; half: number; wall: number };
  kind: BlockerKind;
  shape: "area" | "line" | "stretch";
}

/** A solid segment with a radius (a boom, a hose, a cable). */
export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number; what: string }

/** A tower crane: mast at (x, z), slewing top at `top`; the jib points along `yaw0` (radians, three.js rotation.y of
 *  the jib's +x) and slews slowly either side; the trolley sits `trolley` m out, the load hangs `drop` m below. */
export interface Crane { x: number; z: number; top: number; yaw0: number; ph: number; trolley: number; drop: number }

/** Where the crane's jib points, its trolley, its hook, and its load (a bundle of steel beams 7 m long, along the
 *  jib) at time t. Shared by the leaf (it's solid) and the view, so they agree. */
export function craneAt(c: Crane, t: number) {
  const yaw = c.yaw0 + Math.sin(t * 0.07 + c.ph) * 0.55;
  const jx = Math.cos(yaw), jz = -Math.sin(yaw); // the jib's +x in the world
  const sw = Math.sin(t * 0.6 + c.ph) * 0.8, sw2 = Math.sin(t * 0.47 + c.ph * 2) * 0.6; // a slow swing
  const tx = c.x + jx * c.trolley, tz = c.z + jz * c.trolley, ty = c.top + 2;
  const hx = tx + jx * sw - jz * sw2, hz = tz + jz * sw + jx * sw2, hy = ty - c.drop;
  return { yaw, jx, jz, tx, ty, tz, hx, hy, hz, ly: hy - 3.2 };
}

/** A parade balloon: a big bouncy sphere hanging over the street (y is its centre). */
export interface Balloon { x: number; y: number; z: number; r: number; yaw: number }

/** What a leaf hits at each kind of barrier. */
export const BARRIER_NAME: Record<BlockerKind, string> = {
  festival: "the festival lanterns",
  crowd: "the Times Square barricades",
  water: "the water main crews' hoarding",
  construction: "the sidewalk shed",
  parade: "the parade barricades",
};

/** the water main crews' hoarding round the burst, and the sidewalk shed deck run across a building site's street
 *  (with MDF hoarding under it), m */
export const HOARDING = 3.6, SHED = 4.4;
/** the tallest a closure gets, in the tall canyons (above it you're over it: the Rooftops way passes at 40-70 m) */
export const CAP = 36;
/** the lowest each kind gets, where the street's open at the sides (a plaza, a park) */
const MIN_H: Record<BlockerKind, number> = { water: 22, construction: 22, crowd: 18, parade: 16, festival: 14 };
/** the solid depth of each kind's barrier (see Barrier.depth) */
export const DEPTH: Record<BlockerKind, [number, number]> = { water: [-0.3, 0.3], construction: [-5.5, 0.3], crowd: [-1.35, 1.35], parade: [-0.3, 0.3], festival: [-0.3, 0.3] };
/** half the width of a lane kept open along a way through, and how far above the way it reaches */
export const LANE = { half: 4.5, above: 8 };
/** the longest single barrier fencing an area (a long open run, a plaza, is split into pieces) */
const PIECE = 40;

/** Is (across, y) in one of the barrier's open lanes? (pad widens it) */
export function inGap(bar: Barrier, across: number, y: number, pad = 0): boolean {
  for (const g of bar.gaps) if (across > g.a0 - pad && across < g.a1 + pad && y < g.top + pad) return true;
  return false;
}

// (the streets a line or stretch can shut: roads, plazas, alleys and driveways, not the tunnels and ramps)
const OPEN_RW = new Set([1, 6, 8, 10]);

export class Blockers {
  readonly list: Blocker[];
  readonly barriers: Barrier[] = [];
  readonly balloons: Balloon[] = [];

  constructor(private city: CityData) {
    const [fx, fz] = project(city, 40.7178, -73.9978); // Mulberry & Hester
    const ts = city.raw.landmarks.timesSquare;
    const onRoute = (s: number) => { const a = city.route.at(s); return { x: a.x, z: a.z }; };
    const main = onRoute(525), parade = onRoute(7985); // (the main: past the subway's ways in at s 380-520, short of its ways out at 745-770: the subway takes you under it)
    const usq = [-335, 4222]; // (E 15th St, just east of the square: the short cut across to the East Side way)
    const way = "Over the roofs, under on the subway, or round by the West or East Side.";
    this.list = [
      { id: "watermain", name: "Water main break on Broadway", hint: `A main's burst under Broadway: the block's fenced off and the geyser will blast you back. ${way}`, ...main, r: 30, height: 0, kind: "water", shape: "stretch" },
      { id: "centre", name: "Building site on Centre Street", hint: "Centre St's shut for a building site: shed deck across the street, a concrete pump's boom over it and the crane's load swinging. No short cut up to Canal: over it all, or round by Baxter St.", x: -464, z: 1801, r: 32, height: 0, kind: "construction", shape: "stretch" },
      { id: "festival", name: "Street festival on Mulberry", hint: "The streets are shut for the festival, lanterns strung up to the roofs. Over the rooftops, or round by the West or East Side.", x: fx, z: fz, r: 120, height: 0, kind: "festival", shape: "area" },
      { id: "union", name: "Building site on East 15th Street", hint: "E 15th St's shut for a building site: shed deck across the street, a concrete pump's boom over it and the crane's load swinging. No short cut to the East Side: over it all, or round by 14th or 16th.", x: usq[0], z: usq[1], r: 30, height: 0, kind: "construction", shape: "stretch" },
      { id: "times", name: "Times Square is packed", hint: "Packed solid: trucks, barricades and a web of lights up to the billboards. The police have kept a lane open along each Side way, or go over the roofs or under on the subway.", x: ts[0], z: ts[1], r: 115, height: 0, kind: "crowd", shape: "area" },
      { id: "parade", name: "The Thanksgiving Day Parade", hint: "The parade's coming down to Columbus Circle: barricades, stands and banners up high. Over the roofs, and mind the balloon!", ...parade, r: 60, height: 0, kind: "parade", shape: "area" },
    ];
    for (const b of this.list) {
      if (b.shape === "area") this.area(b);
      else this.across(b, b.id === "centre" ? "CENTRE ST" : b.id === "union" ? "E  15 ST" : "BROADWAY", b.id === "watermain" ? 36 : b.shape === "stretch" ? 30 : 0, b.id === "watermain" ? 60 : 30, b.id === "centre" ? 12 : 9);
      b.height = Math.max(0, ...this.barriers.filter((q) => q.blocker === b.id).map((q) => q.height));
      // the geyser erupts from the crater in the middle of the fenced-off block
      if (b.kind === "water") { b.geyser = { x: b.x, z: b.z, r: 3.4, h: 26, fall: 12 }; b.height = 26; }
      if (b.kind === "construction") this.site(b);
    }
    // the parade balloon floats over the route just inside the barriers
    {
      const s = city.route.nearest(parade.x, parade.z).s;
      const a = city.route.at(s - 25);
      this.balloons.push({ x: a.x, y: 22, z: a.z, r: 6.5, yaw: Math.atan2(a.tx, a.tz) });
    }
  }

  /** A building site on the block: the building on the side with the taller wall, the crane on its kerb with the
   *  jib out over the street, a concrete pump parked in the closed street with its boom across to the building. */
  private site(b: Blocker) {
    const bars = this.barriers.filter((q) => q.blocker === b.id);
    if (bars.length < 2) return;
    const [p, q] = bars;
    const x = (p.x + q.x) / 2, z = (p.z + q.z) / 2, half = (p.half + q.half) / 2;
    const tx = -p.nx, tz = -p.nz; // along the street (p's normal points out of the block)
    const ax = p.ax, az = p.az;
    const side = Math.max(p.walls[1], q.walls[1]) >= Math.max(p.walls[0], q.walls[0]) ? 1 : -1;
    const wall = Math.max(p.walls[side > 0 ? 1 : 0], q.walls[side > 0 ? 1 : 0], 20);
    const len = Math.hypot(p.x - q.x, p.z - q.z);
    b.site = { side, x, z, tx, tz, ax, az, len, half, wall };
    // the crane: on the building's kerb, near one end; the jib out across the street, the load hanging ~12 m up
    const off = half - 2.5;
    const cx = x + ax * side * off - tx * len * 0.22, cz = z + az * side * off - tz * len * 0.22;
    const top = Math.ceil(Math.max(42, Math.min(wall + 12, 110)) / 3) * 3;
    b.crane = { x: cx, z: cz, top, yaw0: Math.atan2(az * side, -ax * side), ph: (b.id.length * 1.7) % 6.28, trolley: off, drop: top + 2 - 12 };
    // the concrete pump: parked on the far side of the street, boom up and across to the building at ~13 m
    const px = x - ax * side * (half - 4) + tx * len * 0.18, pz = z - az * side * (half - 4) + tz * len * 0.18;
    // (three folding sections: up at a slant, on up over the middle of the street, down to the building)
    const across = (d: number, y: number) => ({ x: px + ax * side * d, y, z: pz + az * side * d });
    const span = 2 * half - 5.5;
    const k1 = across(0, 3.8), k2 = across(span * 0.3, 11.5), k3 = across(span * 0.62, 16.5), k4 = across(span, 12.5);
    const cap = (a: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, r: number, what: string): Capsule => ({ ax: a.x, ay: a.y, az: a.z, bx: c.x, by: c.y, bz: c.z, r, what });
    b.solids = [cap(k1, k2, 0.45, "the concrete pump's boom"), cap(k2, k3, 0.4, "the concrete pump's boom"), cap(k3, k4, 0.35, "the concrete pump's boom"), cap(k4, { x: k4.x, y: 5, z: k4.z }, 0.18, "the concrete pump's hose")];
    b.height = Math.max(b.height, 17);
  }

  /** a barrier across a street at (cx, cz): out to the building faces at either side, as tall as the canyon */
  private add(b: Blocker, cx: number, cz: number, tx: number, tz: number, nx: number, nz: number, st: { n: string; w: number }, scan = 14) {
    const city = this.city, ax = -tz, az = tx;
    const ext = [st.w / 2 + 3.5, st.w / 2 + 3.5], walls: [number, number] = [0, 0];
    [-1, 1].forEach((e, i) => {
      for (let o = 1; o < st.w / 2 + scan; o += 0.5) {
        const hb = city.buildingAt(cx + ax * e * o, cz + az * e * o);
        if (hb) { ext[i] = o + 0.4; walls[i] = hb.h; break; }
      }
    });
    const shift = (ext[1] - ext[0]) / 2, half = (ext[0] + ext[1]) / 2;
    const h = b.kind === "water" ? HOARDING : b.kind === "construction" ? SHED : Math.max(MIN_H[b.kind], Math.min(CAP, Math.max(walls[0], walls[1])));
    this.barriers.push({ blocker: b.id, kind: b.kind, x: cx + ax * shift, z: cz + az * shift, ax, az, half, height: h, nx, nz, walls, street: st.n, w: st.w, depth: DEPTH[b.kind], gaps: [] });
  }

  /** Fence the circle: every stretch of its edge that isn't inside a building (the streets, and the plazas,
   *  corners and wide pavements beside them: no gaps to slip through) gets barriers, each a straight chord of
   *  at most PIECE m, as tall as the taller of the buildings either end. */
  private area(b: Blocker) {
    const city = this.city, N = Math.ceil((2 * Math.PI * b.r) / 0.75);
    const at = (i: number) => { const a = (i / N) * 2 * Math.PI; return { x: b.x + Math.sin(a) * b.r, z: b.z + Math.cos(a) * b.r }; };
    const solid: (number)[] = [];
    for (let i = 0; i < N; i++) { const p = at(i), hb = city.buildingAt(p.x, p.z); solid.push(hb ? hb.h : -1); }
    const s0 = solid.findIndex((h) => h >= 0);
    if (s0 < 0) return;
    // walk round from a building, collecting the open runs between buildings
    for (let k = 0; k < N; ) {
      const i = (s0 + k) % N;
      if (solid[i] >= 0) { k++; continue; }
      let e = k;
      while (e < N && solid[(s0 + e) % N] < 0) e++;
      const i0 = (s0 + k - 1 + N) % N, i1 = (s0 + e) % N; // the buildings either end
      const wl = Math.max(0, solid[i0]), wr = Math.max(0, solid[i1]);
      const h = Math.max(MIN_H[b.kind], Math.min(CAP, Math.max(wl, wr)));
      const run = e - k + 1, pieces = Math.max(1, Math.ceil((run * 0.75) / PIECE));
      for (let q = 0; q < pieces; q++) {
        const a = at(s0 + k - 1 + (run * q) / pieces), c = at(s0 + k - 1 + (run * (q + 1)) / pieces);
        const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2, L = Math.hypot(c.x - a.x, c.z - a.z) || 1;
        const ax = (c.x - a.x) / L, az = (c.z - a.z) / L;
        // normal out of the area
        let nx = az, nz = -ax;
        if ((mx - b.x) * nx + (mz - b.z) * nz < 0) { nx = -nx; nz = -nz; }
        const st = city.street(mx, mz);
        const onStreet = st.dist < st.w / 2 + 6;
        this.barriers.push({
          blocker: b.id, kind: b.kind, x: mx, z: mz, ax, az, half: L / 2 + 0.3, height: h, nx, nz,
          walls: [q === 0 ? wl : 0, q === pieces - 1 ? wr : 0], street: onStreet ? st.name : "", w: onStreet ? st.w : 0, depth: DEPTH[b.kind], gaps: [],
        });
      }
      k = e;
    }
  }

  /** one street (by name), near the blocker's point: one wall across it (len 0), or a block of it closed at
   *  both ends, len apart. Slid along the street to where it meets building faces at both sides (mid-block,
   *  not in a junction or beside a plaza it could be flown round through). */
  private across(b: Blocker, name: string, len: number, reach = 90, scan = 9) {
    const city = this.city;
    const cands: { x: number; z: number; tx: number; tz: number; d: number; st: { n: string; w: number } }[] = [];
    for (const st of city.raw.streets) {
      if (st.n !== name || !OPEN_RW.has(st.rw)) continue;
      const p = st.p;
      for (let k = 0; k < p.length - 2; k += 2) {
        const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]);
        if (L < 0.5) continue;
        const tx = (p[k + 2] - p[k]) / L, tz = (p[k + 3] - p[k + 1]) / L;
        for (let u = 0; u <= L; u += 2) {
          const x = p[k] + tx * u, z = p[k + 1] + tz * u, d = Math.hypot(x - b.x, z - b.z);
          if (d < reach) cands.push({ x, z, tx, tz, d, st });
        }
      }
    }
    const closed = (x: number, z: number, tx: number, tz: number, w: number) => {
      for (const e of [-1, 1]) {
        let hit = false;
        for (let o = 1; o < w / 2 + scan && !hit; o += 0.5) hit = !!city.buildingAt(x - tz * e * o, z + tx * e * o);
        if (!hit) return false;
      }
      return true;
    };
    let best: (typeof cands)[number] | null = null, bestScore = Infinity;
    for (const c of cands) {
      const ends = len > 0 ? [-1, 1].map((e) => ({ x: c.x + c.tx * e * len / 2, z: c.z + c.tz * e * len / 2 })) : [c];
      // (both ends still on this street, in a canyon)
      const ok = ends.every((q) => { const h = city.street(q.x, q.z); return h.name === name && h.dist < h.w / 2 && closed(q.x, q.z, c.tx, c.tz, c.st.w); });
      const score = c.d + (ok ? 0 : 1000);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (!best) return;
    const { x: cx, z: cz, tx, tz } = best;
    b.x = cx; b.z = cz;
    if (len <= 0) {
      // a single wall: its "outside" is uptown
      const r = city.route.at(city.route.nearest(cx, cz).s), s = tx * r.tx + tz * r.tz >= 0 ? 1 : -1;
      this.add(b, cx, cz, tx, tz, tx * s, tz * s, best.st, scan + 3);
      return;
    }
    for (const e of [-1, 1]) this.add(b, cx + tx * e * len / 2, cz + tz * e * len / 2, tx, tz, tx * e, tz * e, best.st, scan + 3);
  }

  /** The blocker area a point is near (for the hint). */
  near(x: number, z: number): Blocker | null {
    for (const b of this.list) if (Math.hypot(x - b.x, z - b.z) < b.r + 60) return b;
    return null;
  }
}

/** Keep a lane open wherever a way through (world/windFeatures.ts routes) runs through a barrier below its top. */
export function openLanes(barriers: Barrier[], ways: { line: { length: number; at(s: number): { x: number; z: number } }; y: (s: number) => number }[]) {
  for (const bar of barriers) {
    bar.gaps = [];
    for (const w of ways) {
      for (let s = 0; s < w.line.length - 2; s += 2) {
        const a = w.line.at(s), c = w.line.at(s + 2);
        const da = (a.x - bar.x) * bar.nx + (a.z - bar.z) * bar.nz, dc = (c.x - bar.x) * bar.nx + (c.z - bar.z) * bar.nz;
        if (da * dc > 0 || da === dc) continue;
        const t = da / (da - dc), x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
        const across = (x - bar.x) * bar.ax + (z - bar.z) * bar.az, y = w.y(s);
        // (Times Square, Mulberry Street and the parade route are where the ways run through: there a lane's kept
        // open along the Rooftops way too, the full height, as the rooftop flyers come down into the canyon there)
        const iconic = bar.kind === "crowd" || bar.kind === "parade" || bar.kind === "festival";
        if (Math.abs(across) > bar.half + LANE.half || (y > bar.height + 3 && !iconic)) continue;
        bar.gaps.push({ a0: Math.max(-bar.half, across - LANE.half), a1: Math.min(bar.half, across + LANE.half), top: y > bar.height ? bar.height : Math.min(bar.height, y + LANE.above) });
      }
    }
  }
}
