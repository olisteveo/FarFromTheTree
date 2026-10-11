// The subway as air you can fly through: the tunnel along the real Broadway line,
// wider stations at the real station sites, the real entrance stairs, and grates up to
// the street. Described as signed distances (positive = inside the air), so collision
// is "stay where the distance is positive" and the camera can ask the same question.
//
// Blocked stretches force you back up: Prince St is flooded (a water main burst), and
// the line ends at 57 St - 7 Av.

import { Grid, inRing, type CityData } from "./data";
import { subwayPlan } from "./subwayBend";

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
export interface FareArea {
  s: number; side: number; station: string; hw: number;
  /** the stairs' flight runs from the landing toward -dir (its foot at s - dir * 5.82), so it rises toward +dir */
  dir: 1 | -1;
  /** a fare control (turnstiles, exit gates, booth) with it; the others are just the stairs and their landing */
  fare: boolean;
}
/** The platform stairs (render: platform_stair_a/b, subway_blender.py): up 2.0 m from the platform to the
 *  passage floor, over 3.42 m, to a 4.8 m landing in front of the doorway, 2.2 m wide from 0.2 m off the wall;
 *  the tiled outer wall 0.2 m thick, 0.9 m over the steps. In (ds' = (s - fa.s) * dir, o = out from the wall). */
export const PLATFORM_STAIR = { rise: 2.0, run: 3.42, land: 2.4, o0: 0.2, o1: 2.4, wall: 2.6, foot: -2.4 - 3.42 };
/** the fare control round them, in the same frame: the turnstile line (o = 4.2) from ds' -8.6 to 4.6 */
export const FARE = { line: 4.2, s0: -8.6, s1: 4.6, gates: [-0.1, 1.6], turnstiles: [-4.75, -3.8, -2.85, -1.9], emergency: -5.85, booth: 6.6, barrier: -6.25 };

/** Furniture on the platforms that the leaf can hit (render/subwayArt.ts draws it here): benches, trash
 *  cans, the fare-card machines by each fare control, someone asleep on a bench, a busker. s along the
 *  line, off the lateral offset of its origin (signed like Polyline.nearest), side the platform's side. */
export interface StationProp { s: number; off: number; side: number; kind: "bench" | "trash" | "fare_machine" | "sleeper" | "busker" | "commuter"; station: string;
  /** commuters: which of the two, and which way they face (0 the tracks, +-1 along the line) */
  variant?: number; turn?: number }
/** Flat on a station wall (render/subwayArt.ts): a poster, the map, a mosaic plaque. j: its slot (picks the poster). */
export interface WallProp { s: number; side: number; kind: "ad" | "map" | "plaque" | "tablet"; j: number }
/** where a prop is solid, in (along s, out from the wall o = hw - |off|, up from the platform top): boxes */
const PROP_BOXES: Record<StationProp["kind"], [number, number, number, number, number][]> = {
  //            s0     s1    o0    o1   height  (o measured from the prop's origin, + toward the tracks)
  bench: [[-1.2, 1.2, -0.21, 0.21, 0.5], [-1.2, 1.2, -0.27, -0.15, 1.0]],
  trash: [[-0.31, 0.31, -0.31, 0.31, 0.95]],
  fare_machine: [[-0.48, 0.48, 0, 0.62, 1.85]],
  sleeper: [[-1.1, 1.15, -0.21, 0.21, 0.95]],
  busker: [[-0.2, 0.2, -0.2, 0.55, 1.3], [-0.55, 0.55, 0.72, 1.6, 0.12]],
  commuter: [[-0.26, 0.26, -0.26, 0.26, 1.78]],
};

export class Underground {
  readonly shafts: Shaft[] = [];
  readonly fareAreas: FareArea[] = [];
  readonly stationProps: StationProp[] = [];
  private propGrid = new Grid<StationProp>(16);
  /** wisps of steam rising off the track bed by the stations (render/life.ts's SteamView) */
  readonly steam: { x: number; z: number; y: number; ss: number }[] = [];
  private fareGrid = new Grid<FareArea>(16);
  shaftGrid = new Grid<Shaft>(16);
  readonly stations: { ss: number; name: string }[];
  readonly blocked: Blocked[];
  /** stretches with no train service: the flood, and Bowling Green to the Wall St junction
   *  (a calm first tunnel to learn the subway in) */
  readonly noTrains: { ss0: number; ss1: number }[];
  readonly start: number;
  readonly end: number;
  private hint = -1;
  private near = { s: 0, off: 0, d: 0 };
  private startAt = { x: 0, z: 0, tx: 0, tz: 1 };
  rats: Rat[] = [];

  constructor(readonly city: CityData) {
    const sub = city.subway;
    this.stations = city.raw.stations.map((s) => ({ ss: s.ss, name: s.n }));
    // (the same plan the bend in the line was made round: world/subwayBend.ts)
    const plan = subwayPlan(this.stations, sub.length, TUNNEL.stationHalfLength, VENT.every);
    this.start = 0;
    this.end = plan.end;
    this.blocked = [
      { ...plan.blocked[0], kind: "flood", name: "Prince St is flooded" },
      { ...plan.blocked[1], kind: "end", name: "End of the line" },
    ];
    // real entrance stairs: at every station some are ways in (air drawn down) and some ways
    // out (warm station air rising into the cold street, steaming)
    const byStation = new Map<string, typeof city.raw.entrances>();
    for (const e of city.raw.entrances) (byStation.get(e.n) ?? byStation.set(e.n, []).get(e.n)!).push(e);
    // At each station the stairs at the downtown end are the ways in and the ones at the uptown end the
    // ways out: you're going uptown, so you drop in at one end, ride through and come out at the other.
    // (Real entrances come in pairs on the corners of a street: alternating them put a way out right
    // beside every way in, and the leaf went down one and straight back up the other.)
    const dropped = new Set<Shaft>();
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
      // a way out that's still within 30 m of a way in (it's that close to the last way out too, so it can't
      // be either): those stairs are left out (Canal St and 28 St each had one between the two)
      for (const o of mine) if (o.out && o !== last && mine.some((q) => !q.out && Math.hypot(q.x - o.x, q.z - o.z) < 30)) dropped.add(o);
    }
    if (dropped.size) {
      for (let i = this.shafts.length - 1; i >= 0; i--) if (dropped.has(this.shafts[i])) this.shafts.splice(i, 1);
      this.shaftGrid = new Grid<Shaft>(16);
      for (const sh of this.shafts) this.addShaft(sh, false);
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
    // (out in the street: where the line swings under a building, the vent goes in the tunnel's other side
    // or its middle instead)
    const underBuilding = (x: number, z: number, ux: number, uz: number, ha: number, hb: number) =>
      [-ha, 0, ha].some((a) => [-hb, 0, hb].some((b) => !!city.buildingAt(x + ux * a + uz * b, z + uz * a - ux * b)));
    for (const { ss, out } of plan.vents) {
      const p = sub.at(ss), side = out ? 1 : -1;
      const base = (TUNNEL.halfWidth - VENT.halfWidth - 0.6) * side;
      const off = [base, -base].find((o) => !underBuilding(p.x + p.tz * o, p.z - p.tx * o, p.tx, p.tz, VENT.halfLength, VENT.halfWidth));
      if (off === undefined) continue;
      const vx = p.x + p.tz * off, vz = p.z - p.tx * off;
      // (not within 25 m of a station's stair openings)
      if (this.shafts.some((o) => o.kind === "stairs" && Math.hypot(o.x - vx, o.z - vz) < 25)) continue;
      // (nor where a stair's passage comes into the tunnel: its own air arrives there)
      if (this.shafts.some((o) => o.kind === "stairs" && Math.abs(o.ss - ss) < 25 && Math.hypot(o.x + o.tx - vx, o.z + o.tz - vz) < 25)) continue;
      this.addShaft({ x: p.x + p.tz * off, z: p.z - p.tx * off, r: VENT.halfLength, tx: 0, tz: 0, ux: p.tx, uz: p.tz, kind: "vent", ss, name: out ? "air vent (out)" : "air vent (in)", out });
      vents.push(ss);
    }
    // small grates over the tunnel between stations (not right next to a big vent)
    for (let s = 40; s < this.end - 20; s += TUNNEL.grateEvery) {
      if (this.stations.some((st) => Math.abs(st.ss - s) < TUNNEL.stationHalfLength + 10)) continue;
      if (this.isBlocked(s) || vents.some((v) => Math.abs(v - s) < 30)) continue;
      const p = sub.at(s);
      // (not under a building: the grate is a hole in the street)
      if (underBuilding(p.x - p.tz * 4.5, p.z + p.tx * 4.5, p.tx, p.tz, 1.3, 1.3)) continue;
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
    // (the ways out first: a way in's stream mustn't run on past a way out's mouth)
    for (const s of this.shafts) if (s.kind === "stairs" && s.out && !this.isBlocked(s.ss)) s.exitPath = this.buildExitPath(s);
    const mouths = this.shafts.filter((s) => s.exitPath).map((s) => [s.exitPath![0], s.exitPath![2]]);
    for (const s of this.shafts) {
      if (s.kind !== "stairs" || this.isBlocked(s.ss) || s.out) continue;
      const p = this.buildExitPath(s);
      if (!p) continue;
      {
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
        // and on down over the uptown track, easing across as it turns uptown into the tunnel's draught
        // (onto the downtown track, it delivered you to the trains coming the other way), above the trains'
        // roofs (at train height it handed you to the next uptown train: they pass under you up here)
        const q = sub.nearest(ex, ez), lane = TRAIN.track;
        for (const [ds, y] of [[6, -4.9], [14, -4.6], [24, -4.4]] as const) {
          const a = sub.at(q.s + ds), x = a.x + a.tz * lane, z = a.z - a.tx * lane;
          // (it lets you go short of a way out's mouth: it held you on past it, unable to turn off for it)
          if (mouths.some(([mx, mz]) => Math.hypot(mx - x, mz - z) < 10)) break;
          rev.push(x, y, z);
        }
        s.entryPath = new Float32Array(rev);
      }
    }
    // the ways in by the big vents: their air takes you straight down the shaft and, under the roof, across
    // onto the uptown track and on uptown above the trains' roofs (the same height the stairs deliver you at),
    // crossing the column row between two columns
    for (const v of this.shafts) {
      if (v.kind !== "vent" || v.out || this.isBlocked(v.ss) || (globalThis as { __fftt_noVentStream?: boolean }).__fftt_noVentStream) continue;
      const q = sub.nearest(v.x, v.z), dy = (s: number) => this.city.subwayDip(s);
      const P = (s: number, off: number, y: number) => { const a = sub.at(s); return [a.x + a.tz * off, y + dy(s), a.z - a.tx * off]; };
      const lane = TRAIN.track, s0 = q.s;
      let sc = Math.ceil((s0 + 6 - 4) / TUNNEL.columnEvery) * TUNNEL.columnEvery + 4; // between two columns
      const pts: number[] = [v.x, 2.4, v.z, v.x, 0.3, v.z, v.x, TUNNEL.ceiling - 0.2 + dy(s0), v.z];
      pts.push(...P(s0 + 2.5, q.off * 0.8, TUNNEL.ceiling - 1.0));
      if (Math.sign(q.off) !== Math.sign(lane)) pts.push(...P(sc, 0, -4.1)); else sc = s0 + 4;
      pts.push(...P(sc + 6, lane, -4.5), ...P(sc + 14, lane, -4.5), ...P(sc + 22, lane, -4.4));
      v.entryPath = new Float32Array(pts);
    }
    // the platform stairs: wherever a street entrance's passage (or the foot of its stairs) comes through a
    // station's side wall over a platform, stairs come up from the platform to a landing in front of that
    // doorway, at the passage floor; the first such on each side of a station gets the fare control
    for (const st of this.stations) {
      if (this.isBlocked(st.ss)) continue;
      const arrivals: { s: number; side: number; d: number }[] = [];
      for (const sh of this.shafts) {
        if (sh.kind !== "stairs" || sh.aCut !== undefined || !isFinite(sh.aw!) || this.isBlocked(sh.ss)) continue;
        const q = sub.nearest(sh.x + sh.ux * sh.aw!, sh.z + sh.uz * sh.aw!);
        if (this.stationAt(q.s) !== st || this.shape(q.s).k < 0.95 || Math.abs(q.off) < this.shape(q.s).hw - 0.6) continue;
        arrivals.push({ s: q.s, side: q.off >= 0 ? 1 : -1, d: Math.abs(q.s - st.ss) });
      }
      arrivals.sort((a, b) => a.d - b.d);
      const mine: FareArea[] = [];
      const fits = (s0: number, s1: number) => s0 > this.start + 2 && s1 < this.end - 2 && this.shape(s0).k >= 0.95 && this.shape(s1).k >= 0.95;
      const zone = (a: FareArea) => (a.fare ? [-8.8, 8.0] : [PLATFORM_STAIR.foot - 0.8, PLATFORM_STAIR.land + 0.2]).map((d) => a.s + d * a.dir).sort((x, y) => x - y);
      for (const ar of arrivals) {
        // side-by-side doorways share a landing
        const same = mine.find((a) => a.side === ar.side && Math.abs(a.s - ar.s) < 5.5);
        if (same) { same.s = (same.s + ar.s) / 2; continue; }
        let made: FareArea | null = null;
        for (const dir of [1, -1] as const) for (const fare of [true, false]) {
          if (made || (fare && mine.some((a) => a.side === ar.side && a.fare))) continue;
          const a: FareArea = { s: ar.s, side: ar.side, station: st.name, hw: this.shape(ar.s).hw, dir, fare };
          const [z0, z1] = zone(a);
          if (!fits(z0, z1) || mine.some((o) => o.side === a.side && (([p0, p1]) => z0 < p1 + 1 && z1 > p0 - 1)(zone(o)))) continue;
          made = a;
        }
        if (made) mine.push(made);
      }
      for (const a of mine) {
        a.hw = this.shape(a.s).hw;
        this.fareAreas.push(a);
        const p = sub.at(a.s), o = a.hw * a.side;
        this.fareGrid.add(a, p.x + p.tz * o - 16, p.z - p.tx * o - 16, p.x + p.tz * o + 16, p.z - p.tx * o + 16);
      }
    }
    this.placeStationProps();
    this.rats = makeRats(this);
  }

  /** The platforms' furniture (drawn by render/subwayArt.ts, solid in sdf) and what hangs flat on the
   *  walls (posters, the map, plaques). Everything goes through one placement pass per platform that keeps
   *  it clear of everything else: the fare controls and the foot of their stairs, the columns, the posters,
   *  each other, the walkway along the platform edge and the ends of the line. Then the steam. */
  readonly wallProps: WallProp[] = [];
  /** what the placement pass found: props whose first spot overlapped something, and of those how many it
   *  moved to a clear spot and how many it left out */
  readonly placement = { conflicts: 0, moved: 0, dropped: 0, byKind: {} as Record<string, { conflicts: number; moved: number; dropped: number }> };
  private placeStationProps() {
    const sub = this.city.subway;
    this.stations.forEach((st, si) => {
      if (this.isBlocked(st.ss)) return;
      const areas = this.fareAreas.filter((a) => a.station === st.name);
      const hwAt = (s: number) => this.shape(s).hw;
      const sleepSide = si % 4 === 0 ? 1 : si % 4 === 2 ? -1 : 0;
      for (const side of [1, -1]) {
        // footprints in (s along the line, o out from the wall): [s0, s1, o0, o1]
        type R = [number, number, number, number];
        const taken: R[] = [];
        const lo = Math.max(st.ss - 66, this.start + 2), hi = Math.min(st.ss + 66, this.end - 2);
        // the walkway along the platform edge (from the columns to the yellow strip) stays clear, but for people
        const walk = (s: number) => hwAt(s) - PLATFORM.columnOff - 0.4;
        const hit = (r: R, m: number, person = false) => r[0] < lo || r[1] > hi || (!person && r[3] > walk((r[0] + r[1]) / 2))
          || taken.some((t) => r[0] < t[1] + m && r[1] > t[0] - m && r[2] < t[3] + m && r[3] > t[2] - m);
        // the fixed things: each fare control (its stairs and their clear foot, turnstiles, gates, the booth,
        // the paid side behind them, the booth's trash can) and the columns
        for (const a of areas) if (a.side === side) {
          // (the stairs keep a clear 1.5 m in front of their foot)
          const [d0, d1, o1] = a.fare ? [-8.8, 8.0, 5.1] : [PLATFORM_STAIR.foot - 1.6, PLATFORM_STAIR.land + 0.2, 2.9];
          taken.push([Math.min(a.s + d0 * a.dir, a.s + d1 * a.dir), Math.max(a.s + d0 * a.dir, a.s + d1 * a.dir), 0, o1]);
        }
        for (let ds = -63; ds <= 63; ds += PLATFORM.columnEvery) {
          const cs = st.ss + ds;
          if (this.shape(cs).k < 0.95 || this.columnHidden(cs, side)) continue;
          const o = hwAt(cs) - PLATFORM.columnOff;
          taken.push([cs - 0.35, cs + 0.35, o - 0.35, o + 0.35]);
        }
        // the station's name, in mosaic, high on this wall: where it's seen across the tracks from the other
        // platform, so never behind or beside stairs, fare controls, booths or where a street stair comes in
        {
          const block: R[] = taken.slice();
          for (const sh of this.shafts) {
            if (sh.kind !== "stairs" || !isFinite(sh.aw!) || sh.aw! < -STAIRS.half) continue;
            const q = sub.nearest(sh.x + sh.ux * Math.max(sh.aw!, 0), sh.z + sh.uz * Math.max(sh.aw!, 0));
            if ((q.off >= 0 ? 1 : -1) !== side || Math.abs(q.s - st.ss) > 90 || Math.abs(q.off) < hwAt(q.s) - 4) continue;
            block.push([q.s - 4.5, q.s + 4.5, 0, 6]);
          }
          const tabs: number[] = [];
          const free = (s: number) => s - 1.8 > lo && s + 1.8 < hi && this.shape(s).k >= 0.95 && !tabs.some((t) => Math.abs(t - s) < 12)
            && !block.some((b) => s - 1.8 < b[1] + 1 && s + 1.8 > b[0] - 1 && b[2] < 3);
          // (centred between two columns, so the columns of either platform don't stand in front of it)
          const mid = (ds: number) => st.ss + PLATFORM.columnEvery / 2 + Math.round((ds - PLATFORM.columnEvery / 2) / PLATFORM.columnEvery) * PLATFORM.columnEvery;
          for (const ds of [-45, -15, 15, 45]) {
            let got: number | null = null;
            for (let d = 0; d <= 18 && got === null; d += PLATFORM.columnEvery) for (const q of [mid(ds) + d, mid(ds) - d]) if (got === null && free(q)) got = q;
            if (got !== null) tabs.push(got);
          }
          for (let q = mid(-63); q <= st.ss + 64 && tabs.length < 2; q += PLATFORM.columnEvery) if (free(q)) tabs.push(q);
          for (let q = st.ss - 64; q <= st.ss + 64 && tabs.length < 2; q += 1.5) if (free(q)) tabs.push(q);
          for (const t of tabs) this.wallProps.push({ s: t, side, kind: "tablet", j: 0 });
        }
        /** a prop at s, or nudged along the platform by up to `reach` metres to a clear spot: footprint
         *  [a0, a1] along about s and [o0, o1] out from the wall, clearance m. The s it went at, or null. */
        const place = (kind: string, s0: number, a0: number, a1: number, o0: number, o1: number, m: number, reach: number) => {
          const tally = (this.placement.byKind[kind] ??= { conflicts: 0, moved: 0, dropped: 0 });
          const ok = (s: number) => this.shape(s).k >= 0.95 && !hit([s + a0, s + a1, o0, o1], m);
          let at: number | null = ok(s0) ? s0 : null;
          if (at === null) {
            this.placement.conflicts++; tally.conflicts++;
            for (let d = 0.75; d <= reach && at === null; d += 0.75) for (const q of [s0 + d, s0 - d]) if (at === null && ok(q)) at = q;
            if (at === null) { this.placement.dropped++; tally.dropped++; } else { this.placement.moved++; tally.moved++; }
          }
          if (at !== null) taken.push([at + a0, at + a1, o0, o1]);
          return at;
        };
        const add = (p: Omit<StationProp, "station" | "side">) => this.stationProps.push({ ...p, side, station: st.name });
        // fare-card machines: a pair against the wall beside each fare control (downtown of its stairs, or
        // uptown past the booth where that's too near the end of the line)
        for (const a of areas) if (a.side === side && a.fare) for (const pref of [-10.0, 9.2]) {
          const at = place("fare_machine", a.s + pref * a.dir, -1.1, 1.1, 0, 0.7, 0.3, 1.5);
          if (at === null) continue;
          for (const d of [-0.55, 0.55]) add({ s: at + d, off: hwAt(at) * side, kind: "fare_machine" });
          break;
        }
        // posters and the map flat on the wall (the space in front of them is theirs: nothing stands there),
        // plaques up high
        for (let j = 0; j < 22; j++) {
          const s = st.ss - 63 + j * 6;
          const kind = j === 10 ? "map" : j % 4 === 0 || j % 4 === 2 ? "ad" : j % 4 === 3 ? "plaque" : null;
          if (!kind || this.shape(s).k < 0.95 || s < lo || s > hi) continue;
          if (kind === "plaque") { if (!areas.some((a) => a.side === side && s > a.s - 8.5 && s < a.s + 10.2)) this.wallProps.push({ s, side, kind, j }); continue; }
          const half = kind === "map" ? 0.95 : 0.7;
          const at = place(kind, s, -half, half, 0, 0.7, 0.3, 2.25);
          if (at !== null) this.wallProps.push({ s: at, side, kind, j });
        }
        // a busker at the big stations, out on the platform
        if (/Union Sq|Herald Sq|Times Sq|Fulton|Canal/.test(st.name) && side === (si % 2 ? 1 : -1)) {
          const at = place("busker", st.ss + 18, -0.6, 0.6, 2.35, 4.25, 0.8, 30);
          if (at !== null) add({ s: at, off: (hwAt(at) - 2.6) * side, kind: "busker" });
        }
        // benches along the wall, a metre clear of everything; trash cans
        for (let j = 0; j < 22; j++) {
          const s = st.ss - 63 + j * 6 + 3;
          if (j % 5 === 2) {
            const at = place("bench", s, -1.2, 1.2, 0.45, 1.0, 1.0, 3);
            if (at !== null) add({ s: at, off: (hwAt(at) - 0.75) * side, kind: j === 7 && side === sleepSide ? "sleeper" : "bench" });
          }
          if (j % 7 === 4) {
            const at = place("trash", s, -0.32, 0.32, 0.18, 0.82, 0.5, 3);
            if (at !== null) add({ s: at, off: (hwAt(at) - 0.5) * side, kind: "trash" });
          }
        }
        // people waiting for the train: some by the platform edge (between the columns and the yellow strip),
        // some back by the wall
        let seed = Math.round(st.ss) * 31 + 7 + (side > 0 ? 0 : 13);
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        let placed = 0;
        for (let tries = 0; tries < 40 && placed < 4; tries++) {
          const s = st.ss + (rnd() * 2 - 1) * 60, hw = hwAt(s);
          const byWall = rnd() < 0.35, o = byWall ? 1.7 : hw - 6.1;
          const variant = rnd() < 0.5 ? 0 : 1, turn = rnd() < 0.6 ? 0 : rnd() < 0.5 ? 1 : -1;
          if (this.shape(s).k < 0.95 || hit([s - 0.3, s + 0.3, o - 0.3, o + 0.3], 0.5, true)) continue;
          taken.push([s - 0.3, s + 0.3, o - 0.3, o + 0.3]);
          add({ s, off: (hw - o) * side, kind: "commuter", variant, turn });
          placed++;
        }
      }
      // steam off the track bed at the station's ends (warm air from the drains into the cold tunnel)
      for (const ds of [-TUNNEL.stationHalfLength - 8, TUNNEL.stationHalfLength + 12]) {
        const ss = st.ss + ds;
        if (ss < this.start + 5 || ss > this.end - 5 || this.isBlocked(ss)) continue;
        const a = sub.at(ss);
        this.steam.push({ x: a.x, z: a.z, y: TUNNEL.floor + this.city.subwayDip(ss) + 0.1, ss });
      }
    });
    for (const p of this.stationProps) {
      const a = sub.at(p.s), x = a.x + a.tz * p.off, z = a.z - a.tx * p.off;
      this.propGrid.add(p, x - 3, z - 3, x + 3, z + 3);
    }
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

  private addShaft(s: Shaft, push = true) {
    if (push) this.shafts.push(s);
    if (s.kind === "vent") {
      const h = VENT.halfLength + 6;
      this.shaftGrid.add(s, s.x - h, s.z - h, s.x + h, s.z + h);
      return;
    }
    // the whole footprint: the shaft and the passage that runs from it to the tunnel
    const x1 = s.x + s.tx, z1 = s.z + s.tz;
    this.shaftGrid.add(s, Math.min(s.x, x1) - 4, Math.min(s.z, z1) - 4, Math.max(s.x, x1) + 4, Math.max(s.z, z1) + 4);
  }

  /** Take shafts out (after the fact: Airflow drops the vents inside closed streets). */
  dropShafts(pred: (s: Shaft) => boolean) {
    const n = this.shafts.length;
    for (let i = this.shafts.length - 1; i >= 0; i--) if (pred(this.shafts[i])) this.shafts.splice(i, 1);
    if (this.shafts.length === n) return;
    this.shaftGrid = new Grid<Shaft>(16);
    for (const sh of this.shafts) {
      if (sh.relief) this.shaftGrid.add(sh, sh.x - 16, sh.z - 16, sh.x + 16, sh.z + 16);
      else this.addShaft(sh, false);
    }
  }

  /** No platform column here (s, side): it would stand in a fare control. */
  columnHidden(cs: number, side: number) {
    return this.fareAreas.some((fa) => fa.side === side && fa.fare && (cs - fa.s) * fa.dir > FARE.s0 - 0.6 && (cs - fa.s) * fa.dir < FARE.s1 + 0.6);
  }

  /** The tunnel's width and ceiling at s (stations open out over 30 m). */
  shape(s: number) {
    let k = 0;
    for (const st of this.stations) { const d = Math.abs(st.ss - s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
    const dy = this.city.subwayDip(s);
    return { hw: TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k, ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k + dy, floor: TUNNEL.floor + dy, k };
  }

  /** How far the tunnel's floor and ceiling sit above (+) / below (-) their usual height at s (the line
   *  dips and rises between the stations: world/subwayBend.ts). */
  dip(s: number) { return this.city.subwayDip(s); }

  /** Is (x, z) inside the tunnel's or a station's walls? Its ceiling there if so. */
  hallAt(x: number, z: number): { ceil: number } | null {
    const n = this.city.subway.nearest(x, z);
    if (this.isBlocked(n.s) || n.s > this.end) return null;
    let k = 0;
    for (const st of this.stations) { const d = Math.abs(st.ss - n.s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
    const hw = TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k;
    return Math.abs(n.off) < hw + 0.1 ? { ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k + this.city.subwayDip(n.s) } : null;
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
      // (the line dips and rises between the stations: measure heights from its floor here)
      const yg = y;
      y -= this.city.subwayDip(n.s);
      // stations open out smoothly from the tunnel over 30 m
      let k = 0;
      for (const st of this.stations) {
        const d = Math.abs(st.ss - n.s);
        if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30));
      }
      const hw = TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k;
      tunnelHW = hw;
      const ceil = TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k;
      hallCeil = ceil + (yg - y);
      const lateral = hw - n.d;
      best = Math.min(lateral, y - TUNNEL.floor, ceil - y);
      // the tunnel's end walls
      // (the start: a flat wall across the line where it's drawn, render/subway.ts; the nearest point can't
      // say how far past it you are, so measure along the line's first stretch)
      let fromStart = n.s - this.start;
      if (fromStart < 1) { const a = this.city.subway.at(this.start, this.startAt); fromStart = (x - a.x) * a.tx + (z - a.z) * a.tz; }
      const endWall = Math.min(fromStart, this.end - n.s);
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
            if (this.columnHidden(cs, cside)) continue;
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
        // (in the stairs' own frame: ds' along, rising toward the landing; o out from the wall)
        const d2 = ds * fa.dir, o2 = fa.hw - o, P = PLATFORM_STAIR;
        const box2 = (s0: number, s1: number, o0: number, o1: number, y1: number) => box(fa.dir > 0 ? s0 : -s1, fa.dir > 0 ? s1 : -s0, fa.hw - o1, fa.hw - o0, y1);
        // the flight (its treads as a ramp), the landing, the tiled wall 0.9 m over them, the barrier across the foot
        const tread = top + Math.max(0, Math.min(P.rise, ((d2 - P.foot) / P.run) * P.rise));
        best = Math.min(best, box2(P.foot, -P.land, P.o0, P.o1, tread));
        best = Math.min(best, box2(-P.land, P.land, P.o0, P.o1, top + P.rise));
        best = Math.min(best, box2(P.foot - 0.05, P.land, P.o1, P.wall, tread + 0.9));
        best = Math.min(best, box2(FARE.barrier - 0.1, FARE.barrier + 0.1, P.o0, P.wall, top + 1.1));
        void o2;
        if (fa.fare) {
          best = Math.min(best, box2(FARE.s0, FARE.s1, FARE.line - 0.25, FARE.line + 0.25, top + 1.1)); // turnstiles and rails
          best = Math.min(best, box2(FARE.gates[0] - 0.85, FARE.gates[1] + 0.85, FARE.line - 0.85, FARE.line + 0.85, top + 2.4)); // the full-height exit gates
          best = Math.min(best, box2(FARE.booth - 1.2, FARE.booth + 1.2, 0.4, 2.4, top + 2.7)); // the booth
        }
      }
      // the platforms' furniture
      if (k > 0.6) for (const pr of this.propGrid.at(x, z)) {
        const ds = n.s - pr.s, o = (pr.off - n.off) * pr.side, top = TUNNEL.floor + PLATFORM.height;
        for (const [s0, s1, o0, o1, h] of PROP_BOXES[pr.kind]) {
          const qa = Math.abs(ds - (s0 + s1) / 2) - (s1 - s0) / 2, qo = Math.abs(o - (o0 + o1) / 2) - (o1 - o0) / 2, qy = Math.abs(y - (top + h / 2)) - h / 2;
          best = Math.min(best, Math.hypot(Math.max(qa, 0), Math.max(qo, 0), Math.max(qy, 0)) + Math.min(Math.max(qa, qo, qy), 0));
        }
      }
      // the row of columns between the tracks (not in the stations, where the platforms are)
      if (k < 0.3) {
        const ds = Math.abs(((n.s % TUNNEL.columnEvery) + TUNNEL.columnEvery) % TUNNEL.columnEvery - TUNNEL.columnEvery / 2);
        const dc = Math.hypot(TUNNEL.columnEvery / 2 - ds, n.off) - TUNNEL.columnRadius;
        best = Math.min(best, dc);
      }
      y = yg;
    }
    for (const s of this.shaftGrid.at(x, z)) {
      const a = (x - s.x) * s.ux + (z - s.z) * s.uz, b = (x - s.x) * s.uz - (z - s.z) * s.ux;
      if (s.kind === "grate") {
        // a vertical shaft from the street down to the tunnel roof
        const v = Math.min(s.r - Math.hypot(x - s.x, z - s.z), y - (TUNNEL.ceiling + this.city.subwayDip(s.ss) - 0.5), 0.6 - y);
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
