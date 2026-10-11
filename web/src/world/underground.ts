// The subway as air you can fly through: the tunnel along the real Broadway line,
// wider stations at the real station sites, the real entrance stairs, and grates up to
// the street. Described as signed distances (positive = inside the air), so collision
// is "stay where the distance is positive" and the camera can ask the same question.
//
// Blocked stretches force you back up: Prince St is flooded (a water main burst), and
// the line ends at 57 St - 7 Av.

import { Grid, inRing, type CityData } from "./data";

export const TUNNEL = {
  halfWidth: 7.2,
  floor: -9.5,
  ceiling: -2.6,
  stationHalfWidth: 12.5,
  stationCeiling: -2.4,
  stationHalfLength: 75,
  grateEvery: 70,
  /** steel I-beam columns down the middle of the tunnel, between the two tracks */
  columnEvery: 8,
  columnRadius: 0.22,
};

/** A street entrance's stairwell, in its own frame: origin at the shaft (x, z), +a along (ux, uz)
 *  toward the tunnel, b across, y up. The opening is a square in the sidewalk (|a|, |b| < half);
 *  the stairs start at the open side (a = -half) at the sidewalk top and go down toward the
 *  tunnel at `slope` until they reach the passage floor, under a ceiling once they are below the
 *  pavement; the passage then runs on to the station. The art (render/subwayEntrances.ts) is built
 *  to exactly these numbers. */
export const STAIRS = { half: 2.1, halfWidth: 1.95, top: 0.15, slope: 0.7, headroom: 3.1, roofUnder: -0.15, passageFloor: -6.4, passageCeiling: -2.2, passageHalfWidth: 2.3 };
/** where the stairs reach the passage floor (a) */
export const STAIRS_FOOT = -STAIRS.half + (STAIRS.top - STAIRS.passageFloor) / STAIRS.slope;
/** Massive vents over the tunnel between stations: a long grate in the street, a straight drop
 *  to the tunnel roof. The ways in suck you down into the subway; the ways out fire you up past
 *  the rooftops. Local frame like the stairs: a along the tunnel, b across. */
export const VENT = { halfLength: 4.6, halfWidth: 1.4, every: 260, inPull: 9, outBlast: 24, outReach: 34 };
/** Station platforms: solid from the platform edge to the wall, up to the platform top. */
export const PLATFORM = { edge: 4.95, height: 1.1, columnEvery: 9, columnSpan: 63, columnOff: 7.0, columnRadius: 0.3 };

export interface Shaft { x: number; z: number; r: number; tx: number; tz: number; kind: "stairs" | "grate" | "vent"; ss: number; name: string; relief?: boolean;
  /** stairs/vents that breathe air up and out (ways out); the others draw air down (ways in) */
  out?: boolean;
  /** unit direction of the local +a axis (stairs: toward the tunnel; vents and grates: along it) */
  ux: number; uz: number;
  /** ways out by the stairs: the line the air carries you along, from the platform out to the
   *  street (x, y, z every metre or so), checked to be clear of every wall */
  exitPath?: Float32Array;
  /** ways in by the stairs: the line the air draws you along, from the street down the middle of
   *  the stairs and out into the station */
  entryPath?: Float32Array;
  /** stairs only: the first a (along the centre line) that's inside the tunnel or a station hall
   *  (Infinity if the stairs and passage never reach it, -Infinity if the opening is over it) */
  aw?: number;
  /** stairs that come down over the hall: where their air ends (they open into the hall through
   *  its ceiling or wall there, with no passage and nothing standing in the hall) */
  aCut?: number }

/** The a where the stairs' floor has dropped `below` metres under a ceiling at height ceil. */
export const stairsBelow = (ceil: number, below: number) => -STAIRS.half + (STAIRS.top - (ceil - below)) / STAIRS.slope;

export interface Blocked { ss0: number; ss1: number; kind: "flood" | "end"; name: string }

/** A station's fare control on one side: the stairs up from the platform, the turnstile line and the
 *  token booth (drawn by render/subwayArt.ts, solid here). s along the line, side +1/-1. */
export interface FareArea { s: number; side: number; station: string; hw: number }

export class Underground {
  readonly shafts: Shaft[] = [];
  readonly fareAreas: FareArea[] = [];
  private fareGrid = new Grid<FareArea>(16);
  readonly shaftGrid = new Grid<Shaft>(16);
  readonly stations: { ss: number; name: string }[];
  readonly blocked: Blocked[];
  /** stretches with no train service: the flood, and Bowling Green to the Wall St junction
   *  (a calm first tunnel to learn the subway in) */
  readonly noTrains: { ss0: number; ss1: number }[];
  readonly start: number;
  readonly end: number;
  private hint = -1;
  private near = { s: 0, off: 0, d: 0 };
  rats: Rat[] = [];

  constructor(readonly city: CityData) {
    const sub = city.subway;
    this.stations = city.raw.stations.map((s) => ({ ss: s.ss, name: s.n }));
    const prince = this.stations.find((s) => /Prince/.test(s.name))?.ss ?? 2593;
    const end57 = this.stations.find((s) => /57 St/.test(s.name))?.ss ?? sub.length - 20;
    this.start = 0;
    this.end = Math.min(sub.length, end57 + TUNNEL.stationHalfLength - 5);
    this.blocked = [
      { ss0: prince - 150, ss1: prince + 140, kind: "flood", name: "Prince St is flooded" },
      { ss0: this.end, ss1: sub.length + 1000, kind: "end", name: "End of the line" },
    ];
    // real entrance stairs: at every station some are ways in (air drawn down) and some ways
    // out (warm station air rising into the cold street, steaming)
    const byStation = new Map<string, typeof city.raw.entrances>();
    for (const e of city.raw.entrances) (byStation.get(e.n) ?? byStation.set(e.n, []).get(e.n)!).push(e);
    // At each station the stairs at the downtown end are the ways in and the ones at the uptown end the
    // ways out: you're going uptown, so you drop in at one end, ride through and come out at the other.
    // (Real entrances come in pairs on the corners of a street: alternating them put a way out right
    // beside every way in, and the leaf went down one and straight back up the other.)
    for (const list of byStation.values()) {
      const sorted = list.map((e) => ({ e, s: sub.nearest(e.x, e.z).s })).sort((a, b) => a.s - b.s);
      const st = this.stations.find((q) => q.name === list[0].n);
      const mid = st && sorted.some((q) => q.s < st.ss) && sorted.some((q) => q.s >= st.ss) ? st.ss : (sorted[0].s + sorted[sorted.length - 1].s) / 2;
      sorted.forEach(({ e, s }, i) => {
        const p = sub.at(s);
        const L = Math.hypot(p.x - e.x, p.z - e.z) || 1, ux = (p.x - e.x) / L, uz = (p.z - e.z) / L;
        const at = this.fitSidewalk(e.x, e.z, ux, uz);
        // (entrances on the same spot in the data, or nudged onto one another: just the one)
        if (this.shafts.some((o) => o.kind === "stairs" && Math.hypot(o.x - at[0], o.z - at[1]) < 5)) return;
        this.addShaft({ x: at[0], z: at[1], r: STAIRS.half, tx: p.x - at[0], tz: p.z - at[1], ux, uz, kind: "stairs", ss: s, name: e.n, out: sorted.length > 1 ? s >= mid && !(i === 0) : false });
      });
      // no way out within 30 m of a way in: a way out that close becomes a way in too (but every
      // station keeps its most uptown way out)
      const mine = this.shafts.filter((q) => q.kind === "stairs" && q.name === list[0].n);
      const last = mine.reduce((a, b) => (b.ss > a.ss ? b : a), mine[0]);
      for (let changed = true; changed;) {
        changed = false;
        for (const o of mine) {
          if (!o.out || o === last) continue;
          if (mine.some((q) => !q.out && Math.hypot(q.x - o.x, q.z - o.z) < 30)) { o.out = false; changed = true; }
        }
      }
      if (mine.length > 1) for (const q of mine) if (q !== last && !q.out && Math.hypot(q.x - last.x, q.z - last.z) < 30) q.out = true;
    }
    const wallSt = this.stations.find((s) => /Wall St/.test(s.name))?.ss ?? 380;
    this.noTrains = [{ ss0: -2000, ss1: wallSt - 110 }, this.blocked[0]];
    // relief vents just before the flood and the end of the line: the tunnel air (and you) escape up them
    for (const ss of [this.blocked[0].ss0 - 7, this.end - 7]) {
      const p = sub.at(ss);
      const s: Shaft = { x: p.x, z: p.z, r: 3.4, tx: 0, tz: 0, ux: p.tx, uz: p.tz, kind: "grate", ss, name: "relief vent", relief: true };
      this.shafts.push(s);
      this.shaftGrid.add(s, p.x - 16, p.z - 16, p.x + 16, p.z + 16); // its pull reaches right across the tunnel
    }
    // massive vents over the tunnel between stations: alternately ways in and ways out
    const vents: number[] = [];
    let flip = 0;
    for (let s = 150; s < this.end - 60; s += VENT.every) {
      let ss = s;
      // keep clear of the stations (their stairs do that job) and the closed stretches
      const st = this.stations.find((q) => Math.abs(q.ss - ss) < TUNNEL.stationHalfLength + 40);
      if (st) ss = st.ss + Math.sign(ss - st.ss || 1) * (TUNNEL.stationHalfLength + 45);
      if (this.isBlocked(ss) || this.isBlocked(ss + 10) || this.isBlocked(ss - 10) || ss > this.end - 60) continue;
      if (this.stations.some((q) => Math.abs(q.ss - ss) < TUNNEL.stationHalfLength + 30)) continue;
      const p = sub.at(ss), side = flip % 2 ? 1 : -1;
      const off = (TUNNEL.halfWidth - VENT.halfWidth - 0.6) * side;
      this.addShaft({ x: p.x + p.tz * off, z: p.z - p.tx * off, r: VENT.halfLength, tx: 0, tz: 0, ux: p.tx, uz: p.tz, kind: "vent", ss, name: flip % 2 ? "air vent (out)" : "air vent (in)", out: flip % 2 === 1 });
      vents.push(ss);
      flip++;
    }
    // small grates over the tunnel between stations (not right next to a big vent)
    for (let s = 40; s < this.end - 20; s += TUNNEL.grateEvery) {
      if (this.stations.some((st) => Math.abs(st.ss - s) < TUNNEL.stationHalfLength + 10)) continue;
      if (this.isBlocked(s) || vents.some((v) => Math.abs(v - s) < 30)) continue;
      const p = sub.at(s);
      this.addShaft({ x: p.x - p.tz * 4.5, z: p.z + p.tx * 4.5, r: 1.3, tx: 0, tz: 0, ux: p.tx, uz: p.tz, kind: "grate", ss: s, name: "" });
    }
    // where each stairwell meets the tunnel or a station. Stairs that come down over the hall stop
    // where their floor has dropped a little under its ceiling (or where they come through its wall),
    // so you drop out of them into the hall; nothing of them stands in the hall or over the tracks
    for (const s of this.shafts) {
      if (s.kind !== "stairs") continue;
      const L = Math.hypot(s.tx, s.tz);
      s.aw = Infinity;
      for (let a = -STAIRS.half; a <= L + 0.05; a += 0.05) if (this.hallAt(s.x + s.ux * a, s.z + s.uz * a)) { s.aw = a; break; }
      if (s.aw <= -STAIRS.half + 1e-6) s.aw = -Infinity;
      if (s.aw < STAIRS_FOOT - 0.45) {
        const cl = this.hallAt(s.x + s.ux * Math.max(s.aw, 0), s.z + s.uz * Math.max(s.aw, 0))?.ceil ?? TUNNEL.ceiling;
        s.aCut = Math.min(STAIRS_FOOT + 0.6, Math.max(s.aw + 0.3, stairsBelow(cl, 2.6)));
      }
    }
    for (const s of this.shafts) {
      if (s.kind !== "stairs" || this.isBlocked(s.ss)) continue;
      const p = this.buildExitPath(s);
      if (!p) continue;
      if (s.out) s.exitPath = p;
      else {
        // the same line run backwards, from a few metres out in the street down into the station
        // (from a few metres out in the street, if that's open street: not inside a building or against its wall)
        const ax = s.x - s.ux * (STAIRS.half + 5), az = s.z - s.uz * (STAIRS.half + 5);
        const open = !this.city.buildingAt(ax, az) && !this.city.buildingAt(s.x - s.ux * (STAIRS.half + 2.5), s.z - s.uz * (STAIRS.half + 2.5));
        const n = p.length / 3, rev: number[] = open ? [ax, 2.4, az] : [];
        // (only as far as where it comes out under the station's ceiling: not on across the station, where
        // the streams of ways in facing each other met and held leaves between them)
        let ex = p[0], ez = p[2];
        for (let i = n - 1; i >= 0; i--) {
          rev.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
          ex = p[i * 3]; ez = p[i * 3 + 2];
          if (p[i * 3 + 1] < -3.8 && this.hallAt(ex, ez)) break;
        }
        // and on down over the track on this side, turning uptown into the tunnel's draught (toward the
        // nearer track, never back on itself)
        const q = sub.nearest(ex, ez), lane = Math.max(-TRAIN.track, Math.min(TRAIN.track, q.off));
        for (const [ds, y] of [[4, -5.8], [10, -6.2], [18, -6.2]] as const) {
          const a = sub.at(q.s + ds);
          rev.push(a.x + a.tz * lane, y, a.z - a.tx * lane);
        }
        s.entryPath = new Float32Array(rev);
      }
    }
    // fare control at the foot of each entrance's passage, one per platform side within 30 m
    for (const st of this.stations) {
      if (this.isBlocked(st.ss)) continue;
      const near = this.shafts.filter((sh) => sh.kind === "stairs" && Math.abs(sh.ss - st.ss) < TUNNEL.stationHalfLength + 40)
        .sort((a, b) => Math.abs(a.ss - st.ss) - Math.abs(b.ss - st.ss));
      const mine: FareArea[] = [];
      for (const sh of near) {
        const q = sub.nearest(sh.x, sh.z), side = q.off >= 0 ? 1 : -1;
        const s = Math.max(st.ss - 58, Math.min(st.ss + 58, q.s));
        if (mine.some((a) => a.side === side && Math.abs(a.s - s) < 30)) continue;
        mine.push({ s, side, station: st.name, hw: this.shape(s).hw });
      }
      for (const a of mine) {
        this.fareAreas.push(a);
        const p = sub.at(a.s), o = a.hw * a.side;
        this.fareGrid.add(a, p.x + p.tz * o - 16, p.z - p.tx * o - 16, p.x + p.tz * o + 16, p.z - p.tx * o + 16);
      }
    }
    this.rats = makeRats(this);
  }

  /** The way out from a station by these stairs: in from the platform, through the doorway or the
   *  opening in the station ceiling, up the middle of the stairs and out over the street. Points are
   *  nudged up or down until they're well clear of the walls. */
  private buildExitPath(s: Shaft): Float32Array | undefined {
    const L = Math.hypot(s.tx, s.tz);
    const st = this.stationAt(s.ss);
    const hw = st ? TUNNEL.stationHalfWidth : TUNNEL.halfWidth;
    const aWall = s.aCut !== undefined ? s.aw! : L - hw; // where the station (or tunnel) wall is, along the stairs' axis
    const pts: [number, number][] = []; // (a, y) from the platform outwards
    // where you get from the station into the stairs: through the doorway in the wall, or where the
    // stairs come down through the station ceiling (they only dip below it a few metres along)
    const ceilY = st ? TUNNEL.stationCeiling : TUNNEL.ceiling;
    const aDip = -STAIRS.half + (STAIRS.top - (ceilY - 1.2)) / STAIRS.slope;
    const aEntry = s.aCut !== undefined ? s.aCut - 0.4 : Math.min(STAIRS_FOOT, Math.max(aWall + 0.5, aDip));
    const aIn = Math.max(aEntry, aWall);
    pts.push([aIn + 4, -5.2], [aIn + 1.8, -4.6]);
    // along the passage (if the stairs end before the wall) at mid-height
    if (s.aCut === undefined) for (let a = Math.min(aWall + 0.5, L); a > STAIRS_FOOT; a -= 1) pts.push([a, (STAIRS.passageFloor + STAIRS.passageCeiling) / 2]);
    // up the stairs, a little over halfway between the steps and the ceiling
    for (let a = aEntry; a > -STAIRS.half + 0.6; a -= 0.8) {
      const floor = STAIRS.top - STAIRS.slope * (Math.max(-STAIRS.half, a) + STAIRS.half);
      const ceil = a < STAIRS.half ? floor + 4 : Math.min(STAIRS.roofUnder, floor + STAIRS.headroom);
      pts.push([a, Math.min(floor + 1.3, (floor + ceil) / 2)]);
    }
    // and out: up past the railings into the street (straight up out of the opening, if the street beyond
    // the stairs' open end is a building: some entrances face a wall, and the stream held you against it)
    const ox = s.x - s.ux * (STAIRS.half + 1.5), oz = s.z - s.uz * (STAIRS.half + 1.5);
    if (this.city.buildingAt(ox, oz)) pts.push([-STAIRS.half + 1.2, 1.6], [-STAIRS.half + 1.2, 5]);
    else pts.push([-STAIRS.half + 0.4, 1.6], [-STAIRS.half - 0.5, 3.2]);
    // the clearest height near a planned one (above ground the street is open air)
    const clearAt = (x: number, y0: number, z: number): [number, number] => {
      if (y0 > 0.3) return [y0, 9];
      let best = y0, bd = this.sdf(x, y0, z);
      for (let dy = -1.6; dy <= 1.6; dy += 0.2) { const d = this.sdf(x, y0 + dy, z); if (d > bd + 0.05) { bd = d; best = y0 + dy; } }
      return [best, bd];
    };
    const pts3: [number, number, number][] = [];
    for (const [a, y0] of pts) {
      const x = s.x + s.ux * a, z = s.z + s.uz * a;
      const [y, d] = clearAt(x, y0, z);
      if (d >= 0.3) pts3.push([x, y, z]);
    }
    // make every segment clear: walk it every half metre, lifting or lowering any sample that
    // touches a wall into open air and keeping it as a waypoint (so the stream never runs you into
    // a corner)
    const out: number[] = [];
    for (let i = 0; i < pts3.length; i++) {
      const [x0, y0, z0] = pts3[i];
      out.push(x0, y0, z0);
      if (i === pts3.length - 1) break;
      const [x1, y1, z1] = pts3[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.ceil(L / 0.5);
      for (let k = 1; k < n; k++) {
        const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
        if (y > 0.3 || this.sdf(x, y, z) >= 0.3) continue;
        const [cy, d] = clearAt(x, y, z);
        if (d >= 0.3) out.push(x, cy, z);
      }
    }
    return out.length >= 12 ? new Float32Array(out) : undefined;
  }

  /** Place a stair opening: clear of every building (the opening, and a few metres of street in front of
   *  its open end, where you come in and go out), as near the real entrance as can be (up to 10 m),
   *  in one sidewalk if it can be. (The real entrances are often built into building fronts: drawn as
   *  open stairwells they cut into the buildings, and the walls blocked their way in and out.) */
  private fitSidewalk(x: number, z: number, ux: number, uz: number): [number, number] {
    const walks = this.city.raw.sidewalk;
    const P = (cx: number, cz: number, a: number, b: number): [number, number] => [cx + ux * a + uz * b, cz + uz * a - ux * b];
    const onWalk = (cx: number, cz: number) => {
      const h = STAIRS.half + 0.15, w = STAIRS.halfWidth + 0.15;
      const corners = [[-h, -w], [-h, w], [h, w], [h, -w]].map(([a, b]) => P(cx, cz, a, b));
      return walks.some((p) => corners.every(([px, pz]) => inRing(p[0], px, pz) && !p.slice(1).some((hole) => inRing(hole, px, pz))));
    };
    const clear = (cx: number, cz: number) => {
      for (let a = -STAIRS.half - 4; a <= STAIRS.half + 0.4; a += 0.8)
        for (const b of a < -STAIRS.half ? [-1.4, 0, 1.4] : [-STAIRS.halfWidth - 0.3, 0, STAIRS.halfWidth + 0.3])
          if (this.city.buildingAt(...P(cx, cz, a, b))) return false;
      return true;
    };
    if (clear(x, z) && onWalk(x, z)) return [x, z];
    let best: [number, number] | null = null, bd = Infinity;
    for (let da = -10; da <= 10; da += 0.5) for (let db = -10; db <= 10; db += 0.5) {
      const d = Math.hypot(da, db);
      if (d >= bd) continue;
      const [cx, cz] = P(x, z, da, db);
      if (!clear(cx, cz)) continue;
      const cost = d + (onWalk(cx, cz) ? 0 : 6);
      if (cost < bd) { best = [cx, cz]; bd = cost; }
    }
    return best ?? [x, z];
  }

  private addShaft(s: Shaft) {
    this.shafts.push(s);
    if (s.kind === "vent") {
      const h = VENT.halfLength + 6;
      this.shaftGrid.add(s, s.x - h, s.z - h, s.x + h, s.z + h);
      return;
    }
    // the whole footprint: the shaft and the passage that runs from it to the tunnel
    const x1 = s.x + s.tx, z1 = s.z + s.tz;
    this.shaftGrid.add(s, Math.min(s.x, x1) - 4, Math.min(s.z, z1) - 4, Math.max(s.x, x1) + 4, Math.max(s.z, z1) + 4);
  }

  /** The tunnel's width and ceiling at s (stations open out over 30 m). */
  shape(s: number) {
    let k = 0;
    for (const st of this.stations) { const d = Math.abs(st.ss - s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
    return { hw: TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k, ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k, k };
  }

  /** Is (x, z) inside the tunnel's or a station's walls? Its ceiling there if so. */
  hallAt(x: number, z: number): { ceil: number } | null {
    const n = this.city.subway.nearest(x, z);
    if (this.isBlocked(n.s) || n.s > this.end) return null;
    let k = 0;
    for (const st of this.stations) { const d = Math.abs(st.ss - n.s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
    const hw = TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k;
    return Math.abs(n.off) < hw + 0.1 ? { ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k } : null;
  }

  isBlocked(ss: number): Blocked | null {
    for (const b of this.blocked) if (ss > b.ss0 && ss < b.ss1) return b;
    return null;
  }

  stationAt(ss: number) {
    for (const st of this.stations) if (Math.abs(st.ss - ss) < TUNNEL.stationHalfLength) return st;
    return null;
  }

  /** Signed distance into the underground air at a point (positive inside). Also reports where. */
  sdf(x: number, y: number, z: number, info?: { ss: number; off: number; inShaft: Shaft | null }): number {
    const n = this.city.subway.nearest(x, z, this.hint, this.near);
    this.hint = n.s;
    let best = -Infinity;
    let tunnelHW = TUNNEL.halfWidth, hallCeil = TUNNEL.ceiling;
    if (info) { info.ss = n.s; info.off = n.off; info.inShaft = null; }
    const blk = this.isBlocked(n.s);
    if (blk) best = -Math.min(n.s - blk.ss0, blk.ss1 - n.s);
    if (n.s >= this.start - 1 && !blk) {
      // stations open out smoothly from the tunnel over 30 m
      let k = 0;
      for (const st of this.stations) {
        const d = Math.abs(st.ss - n.s);
        if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30));
      }
      const hw = TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k;
      tunnelHW = hw;
      const ceil = TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k;
      hallCeil = ceil;
      const lateral = hw - n.d;
      best = Math.min(lateral, y - TUNNEL.floor, ceil - y);
      // the tunnel's end walls
      const endWall = Math.min(n.s - this.start + 2, this.end - n.s);
      const b = this.blocked[0];
      const flood = Math.min(Math.abs(n.s - b.ss0), Math.abs(n.s - b.ss1));
      best = Math.min(best, endWall, n.s < b.ss0 || n.s > b.ss1 ? flood + 0.0 : -flood);
      // station platforms: solid from the edge to the wall, up to the platform top; and their columns
      if (k > 0.6) {
        const top = TUNNEL.floor + PLATFORM.height;
        const dx = PLATFORM.edge - Math.abs(n.off), dy = y - top;
        const pd = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
        best = Math.min(best, pd);
        if (k > 0.95 && Math.abs(Math.abs(n.off) - PLATFORM.columnOff) < 1.5) {
          for (const st of this.stations) {
            const ds = n.s - st.ss;
            if (Math.abs(ds) > PLATFORM.columnSpan + 2) continue;
            const j = Math.round(ds / PLATFORM.columnEvery), dd = ds - j * PLATFORM.columnEvery;
            if (Math.abs(j * PLATFORM.columnEvery) > PLATFORM.columnSpan) continue;
            const cs = st.ss + j * PLATFORM.columnEvery, cside = n.off >= 0 ? 1 : -1;
            if (this.fareAreas.some((fa) => fa.side === cside && Math.abs(fa.s - cs) < 7)) continue;
            best = Math.min(best, Math.hypot(dd, Math.abs(n.off) - PLATFORM.columnOff) - PLATFORM.columnRadius);
          }
        }
      }
      // fare control: the stairs up from the platform, the turnstile line, the booth
      if (k > 0.6) for (const fa of this.fareGrid.at(x, z)) {
        const ds = n.s - fa.s, o = n.off * fa.side, top = TUNNEL.floor + PLATFORM.height;
        // a box in (along, across, up) as a signed distance (negative inside)
        const box = (s0: number, s1: number, o0: number, o1: number, y1: number) => {
          const qa = Math.abs(ds - (s0 + s1) / 2) - (s1 - s0) / 2, qo = Math.abs(o - (o0 + o1) / 2) - (o1 - o0) / 2, qy = Math.abs(y - (top + y1) / 2) - (y1 - top) / 2;
          return Math.hypot(Math.max(qa, 0), Math.max(qo, 0), Math.max(qy, 0)) + Math.min(Math.max(qa, qo, qy), 0);
        };
        // the stairs: rising 3 m along the line from s - 5.7 to the landing at s + 0.6, walls 0.9 m over the steps
        const rise = top + Math.max(0, Math.min(3, ((ds + 5.7) / 5.1) * 3)) + 0.9;
        best = Math.min(best, box(-5.75, 0.6, fa.hw - 2.6, fa.hw, rise));
        best = Math.min(best, box(-6.6, 6.6, fa.hw - 4.45, fa.hw - 3.95, top + 1.1)); // turnstiles and rails
        best = Math.min(best, box(7.6, 9.6, fa.hw - 2.6, fa.hw - 0.2, top + 2.7)); // the booth
      }
      // the row of columns between the tracks (not in the stations, where the platforms are)
      if (k < 0.3) {
        const ds = Math.abs(((n.s % TUNNEL.columnEvery) + TUNNEL.columnEvery) % TUNNEL.columnEvery - TUNNEL.columnEvery / 2);
        const dc = Math.hypot(TUNNEL.columnEvery / 2 - ds, n.off) - TUNNEL.columnRadius;
        best = Math.min(best, dc);
      }
    }
    for (const s of this.shaftGrid.at(x, z)) {
      const a = (x - s.x) * s.ux + (z - s.z) * s.uz, b = (x - s.x) * s.uz - (z - s.z) * s.ux;
      if (s.kind === "grate") {
        // a vertical shaft from the street down to the tunnel roof
        const v = Math.min(s.r - Math.hypot(x - s.x, z - s.z), y - (TUNNEL.ceiling - 0.5), 0.6 - y);
        if (v > best) { best = v; if (info) info.inShaft = s; }
      } else if (s.kind === "vent") {
        // a long box straight down to the tunnel roof
        const v = Math.min(VENT.halfLength - Math.abs(a), VENT.halfWidth - Math.abs(b), y - (TUNNEL.ceiling - 0.5), 0.6 - y);
        if (v > best) { best = v; if (info) info.inShaft = s; }
      } else {
        // the stairs: down from the open side of the opening toward the tunnel
        const aa = Math.max(-STAIRS.half, Math.min(STAIRS_FOOT, a));
        const floor = STAIRS.top - STAIRS.slope * (aa + STAIRS.half);
        const ceil = a < STAIRS.half ? 0.8 : Math.min(STAIRS.roofUnder, floor + STAIRS.headroom);
        const sv = Math.min(STAIRS.halfWidth - Math.abs(b), (y - floor) * 0.82, ceil - y, a + STAIRS.half, (s.aCut ?? STAIRS_FOOT + 0.6) - a);
        // (in the stairs, not the hall, when it's above the hall's ceiling or outside its walls)
        if (sv > best) { best = sv; if (info && (y > Math.min(-0.4, hallCeil - 0.2) || n.d > tunnelHW - 0.3)) info.inShaft = s; }
        if (s.aCut !== undefined) continue; // stairs that open straight into the hall have no passage
        // the passage from the foot of the stairs to the station
        const L = Math.hypot(s.tx, s.tz) || 1;
        const t = Math.max(STAIRS_FOOT - 0.6, Math.min(L, a));
        const px = s.x + s.ux * t, pz = s.z + s.uz * t;
        const pr = STAIRS.passageHalfWidth - Math.hypot(x - px, z - pz);
        const pv = Math.min(pr, y - STAIRS.passageFloor, STAIRS.passageCeiling - y);
        // (the passage is only "the passage" up to the station/tunnel wall: inside, it's the tunnel)
        if (pv > best) { best = pv; if (info && n.d > tunnelHW - 0.3) info.inShaft = s; }
      }
    }
    return best;
  }

  /** Is (x, z) over a hole in the street (stairs or grate)? */
  openingAt(x: number, z: number): Shaft | null {
    for (const s of this.shaftGrid.at(x, z)) {
      const a = (x - s.x) * s.ux + (z - s.z) * s.uz, b = (x - s.x) * s.uz - (z - s.z) * s.ux;
      if (s.kind === "grate" ? Math.hypot(x - s.x, z - s.z) < s.r
        : s.kind === "vent" ? Math.abs(a) < VENT.halfLength && Math.abs(b) < VENT.halfWidth
        : Math.abs(a) < STAIRS.half && Math.abs(b) < STAIRS.halfWidth) return s;
    }
    return null;
  }
}

// ------------------------------------------------------------------ trains

export const TRAIN = { length: 150, speed: 22, width: 3.0, height: 3.7, uptownHeadway: 70, downtownHeadway: 88, track: 3.3 };

/** head/tail: the part of the train that's out in the open tunnel (clipped at closed
 *  stretches, which it slides into and out of); lo0: where its full length starts. */
export interface Train { head: number; tail: number; dir: 1 | -1; off: number; lo0: number }

/** Where every train is at time t: deterministic, the same every run. Trains slide into a
 *  closed stretch (the flood, the dead end at Bowling Green) and back out of it a carriage at
 *  a time, as if they ran on behind its wall; they never appear on top of you. */
export function trainsAt(t: number, length: number, out: Train[] = [], closed: { ss0: number; ss1: number }[] = []): Train[] {
  out.length = 0;
  const loop = length + 600;
  for (const [dir, headway, phase] of [[1, TRAIN.uptownHeadway, 21], [-1, TRAIN.downtownHeadway, 47]] as const) {
    const gap = headway * TRAIN.speed;
    for (let k = 0; k * gap < loop + gap; k++) {
      const d = (((t + phase) * TRAIN.speed + k * gap) % (Math.ceil(loop / gap) * gap));
      const head = dir > 0 ? -300 + d : length + 300 - d;
      if (head < -400 || head > length + 400) continue;
      const lo0 = Math.min(head, head - dir * TRAIN.length);
      let lo = lo0, hi = lo0 + TRAIN.length, gone = false;
      for (const c of closed) {
        const a = c.ss0 - 12, b = c.ss1 + 12;
        if (hi <= a || lo >= b) continue;
        if (lo < a) hi = a; else if (hi > b) lo = b; else gone = true;
      }
      if (gone || hi - lo < 1) continue;
      out.push({ head: dir > 0 ? hi : lo, tail: dir > 0 ? lo : hi, dir, off: dir > 0 ? TRAIN.track : -TRAIN.track, lo0 });
    }
  }
  return out;
}

// ------------------------------------------------------------------ rats on the track bed

export interface Rat { home: number; side: number; range: number; speed: number; phase: number }

/** Rats scurry back and forth along the track bed near the walls. Deterministic. */
export function makeRats(u: Underground): Rat[] {
  const rats: Rat[] = [];
  let k = 1;
  for (let s = 30; s < u.end; s += 26) {
    if (u.isBlocked(s)) continue;
    const h = (n: number) => { let x = Math.imul((k * 9973 + n) | 0, 0x9e3779b1) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return (x >>> 0) / 4294967296; };
    k++;
    if (h(1) < 0.35) continue;
    rats.push({ home: s + h(2) * 20, side: h(3) < 0.5 ? -1 : 1, range: 6 + h(4) * 14, speed: 0.6 + h(5) * 0.8, phase: h(6) * 20 });
  }
  return rats;
}

/** A rat's position along the tunnel (ss) and lateral offset at time t. */
export function ratAt(r: Rat, t: number): { ss: number; off: number; dir: number } {
  const x = Math.sin(t * r.speed + r.phase);
  const dir = Math.cos(t * r.speed + r.phase) >= 0 ? 1 : -1;
  return { ss: r.home + x * r.range, off: r.side * (TUNNEL.halfWidth - 0.8 - Math.abs(Math.sin(t * 2.3 + r.phase)) * 0.6), dir };
}
