// The wind, by layer. Deterministic in (position, time): every run blows the same.
//
//   Rooftops  the cold north-westerly off the Hudson: strong, gusty, mostly across and
//             a little against you. Slow but safe. Thermals over dark roofs and lift on
//             the windward faces of buildings keep you up.
//   Street    the avenues channel it uptown (the fast lane above ground); cross streets
//             gust across; steam manholes lift you; cabs and buses drag the air behind
//             them. Middle speed, middle danger.
//   Subway    the trains' piston wind: a roaring tailwind uptown, surges ahead of every
//             uptown train, a wall of air (and steel) from the downtown ones.

import { clamp, noise3, smoothstep } from "../core/rng";
import { inPoly, nearestEdge, streetHit, type Building, type CityData } from "./data";
import { StreetLife } from "./streetlife";
import { Facades } from "./facades";
import { Crowd } from "./crowd";
import { Blockers, CAP, inGap } from "./blockers";
import { Park } from "./park";
import { WindFeatures, type WindHit } from "./windFeatures";
import { makeCourse } from "./course";
import type { Polyline } from "./data";
import { Grid } from "./data";
import { colliderGrid, parkLayout, type ParkCollider, type ParkLayout } from "../render/centralPark";
import { streetLayout, type StreetLayout } from "../render/streetLayout";
import { Traffic } from "./traffic";
import { STAIRS, STAIRS_FOOT, TRAIN, trainsAt, TUNNEL, Underground, VENT, type Shaft, type Train } from "./underground";

export type Lane = "subway" | "street" | "roof";

export const AIR = {
  avenue: 9.5,        // street tailwind on route-aligned streets (m/s)
  cross: 4.5,         // cross-street gusts
  crossBurst: 8,      // ...and the bursts they throw out across the avenue at a junction (m/s at their peak, uptown; only in the junction itself)
  channel: 0.35,      // how strongly an avenue canyon draws you back to its middle (1/s)
  roof: 6.5,          // the wind over the roofs (a quartering tailwind: see roofWind)
  roofGrowth: 0.035,  // stronger with height
  tunnel: 11,         // the tunnel's standing draught
  station: 7,
  canyonLift: 1.5,    // mean updraft in the street canyons (m/s)
  gust: 9,            // gust fronts: extra tailwind at the front (m/s)
  gustSpeed: 15,      // ...how fast they sweep uptown
  gustEvery: 30,      // ...seconds between them at any one spot
  cushion: 2.4,       // tunnel walls: how far out (m) the air starts turning along them
  cushionPush: 7,     // ...and how hard it pushes a leaf off them (m/s, right at the wall)
  trainPush: 20,      // extra ahead of an uptown train
  corridor: 340,
  /** the wall of wind at the corridor's edge: how deep (it starts this far inside) and how hard it blows back */
  wallDepth: 30, wallSpeed: 20,      // how far either side of the route before the wind turns you back
};

export interface AirSample {
  x: number; y: number; z: number;
  lane: Lane;
  /** what the leaf touched, if it's fatal or hurts */
  vehicle: boolean;
  train: boolean;
  /** which way the train that got you was going */
  trainDir?: number;
  /** inside a hidden current (its id) or a dust devil (its id), or -1 */
  jet?: number;
  devil?: number;
  /** inside a guided stream (down a way in, up a way out): 0..1, how firmly it carries the leaf
   *  along whatever it's doing (see Glider) */
  guide?: number;
  /** set by whoever samples: the leaf's own velocity, so the wide pulls round the ways in and out
   *  only take a leaf that's heading for them (or drifting), not one flying past */
  vx?: number; vy?: number; vz?: number;
}

/** The winter wind's direction over the roofs: from the north-west, so it blows to the
 *  south-east, which in the grid frame (east = -x) is across the route and slightly against. */
// (the roof wind is set along the route: see the rooftops in sample)
/** how far across a station the ways out by the stairs reach to draw you in */
const EXIT_REACH = 10;

const tmpE = { d: 0, nx: 0, nz: 0, px: 0, pz: 0 };

const WAY_CELL = 8, WAY_HOLD = 60, WAY_FADE = 140;

export class Airflow {
  readonly under: Underground;
  private entryGrid = new Grid<Shaft>(16);
  private mouths = new Map<Shaft, Float32Array>();
  private exitGrid = new Grid<Shaft>(16);
  /** the way through along the streets (world/course.ts): the city's draught at street level leads along it */
  private way!: Polyline;
  private wayN = { s: 0, off: 0, d: 0 };
  private wayA = { x: 0, z: 0, tx: 0, tz: 1 };
  private water = new Map<number, boolean>();
  /** Open water, well clear of the shore (a coarse, cached look-up: 8 m cells, no land within a cell either side). */
  overWater(x: number, z: number): boolean {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8), key = (cx + 5000) * 10000 + (cz + 5000);
    let w = this.water.get(key);
    if (w === undefined) {
      w = true;
      for (let i = -1; i <= 1 && w; i++) for (let j = -1; j <= 1 && w; j++) if (this.city.onLand((cx + i + 0.5) * 8, (cz + j + 0.5) * 8)) w = false;
      this.water.set(key, w);
    }
    return w;
  }
  readonly traffic: Traffic;
  readonly life: StreetLife;
  readonly facades: Facades;
  readonly crowd: Crowd;
  readonly park: Park;
  /** hidden currents, dust devils, tower downdrafts */
  readonly features: WindFeatures;
  private fh: WindHit = { x: 0, y: 0, z: 0, jet: -1, devil: -1, lee: false };
  /** Central Park's features (pond, rocks, lamps, benches, trees...) and what the leaf can hit there */
  readonly parkLayout: ParkLayout;
  readonly parkSolids: Grid<ParkCollider>;
  /** street furniture (render/streetLayout.ts): signals, lamps, hydrants, sheds, parked cars... and their colliders */
  readonly streetLayout: StreetLayout;
  readonly streetSolids: Grid<ParkCollider>;
  readonly blockers: Blockers;
  private trains: Train[] = [];
  private trainT = -1;
  private wk = { x: 0, y: 0, z: 0, hit: null as unknown };
  private s1 = streetHit();
  private s2 = streetHit();
  private nr = { s: 0, off: 0, d: 0 };
  private hint = -1;
  private rtw = { x: 0, z: 0, tx: 0, tz: 1 };
  private bl: Building[] = [];
  private uinfo = { ss: 0, off: 0, inShaft: null as unknown };

  constructor(readonly city: CityData) {
    this.under = new Underground(city);
    this.blockers = new Blockers(city);
    // (no vent grate inside a closed street's blocked zone)
    this.under.dropShafts((sh) => sh.kind === "vent" && this.blockers.list.some((bl) => Math.hypot(sh.x - bl.x, sh.z - bl.z) < bl.r + 10));
    // the ways in by the stairs reach out into the street round them (see the street air)
    for (const sh of this.under.shafts) {
      if (sh.exitPath) {
        const p = sh.exitPath;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]); }
        this.exitGrid.add(sh, x0 - EXIT_REACH, z0 - EXIT_REACH, x1 + EXIT_REACH, z1 + EXIT_REACH);
      }
      if (!sh.entryPath) continue;
      // the street end of it: up to where it's gone well down the stairs (drawn toward a point
      // under the pavement you'd only be pressed into the ground)
      let m = 0;
      while (m < sh.entryPath.length && sh.entryPath[m + 1] > 0.4) m += 3;
      const p = sh.entryPath.slice(0, Math.max(6, m + 3));
      this.mouths.set(sh, p);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]); }
      this.entryGrid.add(sh, x0 - 13, z0 - 13, x1 + 13, z1 + 13);
    }
    this.traffic = new Traffic(city);
    this.life = new StreetLife(city);
    this.facades = new Facades(city);
    this.crowd = new Crowd(this.traffic);
    this.traffic.closed = this.blockers.list;
    this.features = new WindFeatures(city, this.blockers.barriers, this.blockers.list);
    this.way = makeCourse(city).path;
    this.buildWayField();
    this.parkLayout = parkLayout(city);
    this.parkSolids = colliderGrid(this.parkLayout.colliders);
    this.streetLayout = streetLayout(city, { traffic: this.traffic, life: this.life, blockers: this.blockers, under: this.under });
    this.streetSolids = colliderGrid(this.streetLayout.colliders);
    // the sidewalk crowd (block loops, schedules, groups) needs the furniture to step round it
    // (people step round the subway stairs' openings too: they walked over the holes, in mid-air)
    const stairHoles = this.under.shafts.filter((sh) => sh.kind === "stairs").flatMap((sh) => [-1.1, 0.6].map((a) => ({ kind: "cyl", x: sh.x + sh.ux * a, z: sh.z + sh.uz * a, r: 1.75, y0: 0, y1: 1 })));
    this.crowd.attach(city, { street: { ...this.streetLayout, colliders: [...this.streetLayout.colliders, ...stairHoles] } });
    this.park = new Park(city, city.raw.districts.find((d) => d.id === "park")?.s0 ?? city.route.length - 700, this.parkLayout.keepClear);
  }

  trainsAt(t: number): Train[] {
    if (t !== this.trainT) { trainsAt(t, this.city.subway.length, this.trains, this.under.noTrains); this.trainT = t; }
    return this.trains;
  }

  /** Which layer a point is in. */
  lane(x: number, y: number, z: number): Lane {
    if (y < -0.4) return "subway";
    const H = this.city.canopy(x, z, 14);
    if (H > 6 && y < H * 0.88) return "street";
    if (H <= 6 && y < 14) return "street"; // open ground: parks, squares, sites
    return "roof";
  }

  /** How much of a gust front is at route position s at time t (0..1): a sharp leading edge
   *  sweeping uptown at AIR.gustSpeed, a long churning tail behind it. */
  gustAt(s: number, t: number): number {
    const gap = AIR.gustSpeed * AIR.gustEvery;
    // fronts are evenly spaced in time; how far behind the nearest front ahead of s are we?
    const behind = ((t * AIR.gustSpeed - s) % gap + gap) % gap; // 0 right at a front
    const lead = gap - behind; // distance to the next front coming up from downtown
    const tail = Math.exp(-behind / 38) * Math.min(1, behind / 3 + 0.35);
    const edge = lead < 8 ? (1 - lead / 8) * 0.5 : 0;
    return Math.min(1, tail + edge);
  }

  /** Seconds until the next gust front reaches route position s (for the warning whoosh). */
  gustEta(s: number, t: number): number {
    const gap = AIR.gustSpeed * AIR.gustEvery;
    const behind = ((t * AIR.gustSpeed - s) % gap + gap) % gap;
    return (gap - behind) / AIR.gustSpeed;
  }

  /** The air along a way out by the stairs: inside the path's tube it streams along the path toward
   *  the street and holds you to its middle; around its start it gathers you in. k is how much of
   *  the local air it replaces (1 inside the tube). Null when you're nowhere near it. */
  private ef = { x: 0, y: 0, z: 0, k: 0, tube: false };
  private lv = { x: 0, y: 0, z: 0 };
  private exitFlow(p: Float32Array, x: number, y: number, z: number, reach: number, TUBE = 3.2, gatherToNearest = false, release = true, axis?: { tx: number; tz: number }) {
    const n = p.length / 3;
    // a cheap bounds check against the path's start and end first
    if (Math.hypot(p[0] - x, p[2] - z) > reach + 30 && Math.hypot(p[n * 3 - 3] - x, p[n * 3 - 1] - z) > reach + 30) return null;
    let best = Infinity, bi = 0, bu = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2];
      const dx = p[i * 3 + 3] - ax, dy = p[i * 3 + 4] - ay, dz = p[i * 3 + 5] - az, L2 = dx * dx + dy * dy + dz * dz || 1e-9;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2));
      const d2 = (ax + dx * u - x) ** 2 + (ay + dy * u - y) ** 2 + (az + dz * u - z) ** 2;
      if (d2 < best) { best = d2; bi = i; bu = u; }
    }
    // past the end of it, it lets you go (or the pull back to its end would hold you there)
    if (release && bi === n - 2 && bu > 0.999) return null;
    const d = Math.sqrt(best), f = this.ef;
    const i = bi, ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2];
    const dx = p[i * 3 + 3] - ax, dy = p[i * 3 + 4] - ay, dz = p[i * 3 + 5] - az, L = Math.hypot(dx, dy, dz) || 1;
    const cx = ax + dx * bu, cy = ay + dy * bu, cz = az + dz * bu;
    // a stream only carries a leaf going its way (or drifting): flying the other way down a passage
    // you're in the next stream over (side-by-side ways in and out share their air)
    const v = this.lv, sp = Math.hypot(v.x, v.y, v.z);
    if (d < TUBE && sp > 3 && (v.x * dx + v.y * dy + v.z * dz) / L < -0.25 * sp) return null;
    if (d < TUBE) {
      // stream along it at 10 m/s in the middle, fading toward the edge of the tube where the pull
      // to the middle takes over (the tube is wider than the doorways it threads: at its edge you're
      // beside the opening, and must be drawn into it, not pushed along into the wall)
      const along = 10 * (1 - (d / TUBE) ** 2), hold = 3.5 + 3 * (d / TUBE);
      f.x = (dx / L) * along + (cx - x) * hold; f.y = (dy / L) * along + (cy - y) * hold + 1; f.z = (dz / L) * along + (cz - z) * hold;
      f.k = 1; f.tube = true;
      return f;
    }
    f.tube = false;
    if (gatherToNearest) {
      // round a way in: drawn sideways into the stream from wherever you are, and a little along it
      // (if you're making for it: a leaf going past at speed is left alone)
      if (d > reach) return null;
      if (sp > 4 && ((cx - x) * v.x + (cy - y) * v.y + (cz - z) * v.z) / d < 0.35 * sp) return null;
      // in a tunnel or station (axis: the line's direction), heading for it means turning toward it: a leaf
      // riding on along the line past a way out is left alone, however close it passes (the way out lies
      // ahead of it, so "toward it" alone took everyone riding through the station)
      if (axis) {
        const va = v.x * axis.tx + v.z * axis.tz;
        const hx = cx - x - axis.tx * ((cx - x) * axis.tx + (cz - z) * axis.tz), hz = cz - z - axis.tz * ((cx - x) * axis.tx + (cz - z) * axis.tz), hl = Math.hypot(hx, hz);
        const across = hl > 0.3 ? (v.x * hx + v.z * hz) / hl : 0;
        if (Math.abs(va) > 5 && across < 1.5) return null;
      }
      const kk = Math.sqrt(1 - (d - TUBE) / (reach - TUBE));
      f.k = Math.min(1, 1.3 * kk);
      f.x = ((cx - x) / d) * 9 + (dx / L) * 4; f.y = ((cy - y) / d) * 9 + (dy / L) * 4; f.z = ((cz - z) / d) * 9 + (dz / L) * 4;
      return f;
    }
    // outside the tube, near the way in from the platform: drawn toward the path's start
    const sx = p[0] - x, sy = p[1] - y, sz = p[2] - z, sd = Math.hypot(sx, sy, sz);
    if (sd > reach) return null;
    f.k = Math.min(1, 1.3 * (1 - sd / reach));
    f.x = (sx / (sd + 0.5)) * 11; f.y = (sy / (sd + 0.5)) * 11; f.z = (sz / (sd + 0.5)) * 11;
    return f;
  }

  // ---------------------------------------------------------------- the ways through
  // Only a few ways through carry you uptown (the rooftops, the West and East Sides, the subway's
  // streets). Off them the city's air has its own ideas: across you, or back downtown, in patches a
  // few blocks wide. `onWay` is 1 on a way, fading to 0 by WAY_FADE metres off it.
  private wayX0 = 0; private wayZ0 = 0; private wayW = 0; private wayH = 0;
  private wayCells = new Uint8Array(0);
  private buildWayField() {
    const lines = [...this.features.routes.map((r) => r.line), this.city.subway];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const l of lines) for (let i = 0; i < l.x.length; i++) { x0 = Math.min(x0, l.x[i]); x1 = Math.max(x1, l.x[i]); z0 = Math.min(z0, l.z[i]); z1 = Math.max(z1, l.z[i]); }
    const C = WAY_CELL, pad = WAY_FADE + C;
    this.wayX0 = x0 - pad; this.wayZ0 = z0 - pad;
    this.wayW = Math.ceil((x1 - x0 + pad * 2) / C); this.wayH = Math.ceil((z1 - z0 + pad * 2) / C);
    const cells = new Uint8Array(this.wayW * this.wayH);
    const R = Math.ceil(WAY_FADE / C);
    for (const l of lines) {
      for (let i = 0; i < l.x.length; i += 2) {
        const ci = Math.floor((l.x[i] - this.wayX0) / C), cj = Math.floor((l.z[i] - this.wayZ0) / C);
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
          const a = ci + di, b = cj + dj;
          if (a < 0 || b < 0 || a >= this.wayW || b >= this.wayH) continue;
          const d = Math.hypot(di, dj) * C;
          const v = Math.round(255 * (1 - Math.max(0, Math.min(1, (d - WAY_HOLD) / (WAY_FADE - WAY_HOLD)))));
          if (v > cells[b * this.wayW + a]) cells[b * this.wayW + a] = v;
        }
      }
    }
    this.wayCells = cells;
  }
  /** 1 on one of the ways through, 0 well off them. */
  onWay(x: number, z: number) {
    if ((globalThis as { __fftt_noWay?: boolean }).__fftt_noWay) return 1; // (tools: A/B the way field)
    const i = Math.floor((x - this.wayX0) / WAY_CELL), j = Math.floor((z - this.wayZ0) / WAY_CELL);
    if (i < 0 || j < 0 || i >= this.wayW || j >= this.wayH) return 0;
    return this.wayCells[j * this.wayW + i] / 255;
  }
  /** Off the ways, how far the air turns from uptown here: across you, or quartering back (70-140 degrees
   *  either side). Costly, not a trap: you can always claw your way back to a way. */
  private wrongTurn(x: number, z: number) {
    const a = Math.floor(x / 260), b = Math.floor(z / 260);
    // (an integer hash: a float sin-hash differs between engines in its last bits, and the port must match)
    let n = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
    n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d) >>> 0; n ^= n >>> 12;
    const h = (n >>> 0) / 4294967296;
    return (h < 0.5 ? 1 : -1) * Math.PI * (0.39 + 0.78 * Math.abs(h - 0.5));
  }

  sample(x: number, y: number, z: number, t: number, out: AirSample): AirSample {
    out.vehicle = false; out.train = false; out.jet = -1; out.devil = -1; out.guide = 0;
    this.lv.x = out.vx ?? 0; this.lv.y = out.vy ?? 0; this.lv.z = out.vz ?? 0;
    const city = this.city;
    const n = city.route.nearest(x, z, this.hint, this.nr);
    this.hint = n.s;
    const rt0 = city.route.at(n.s);
    // "uptown" as the air here sees it: on a way through, uptown; off them, turned across or back
    const ow = this.onWay(x, z), turn = (1 - ow) * this.wrongTurn(x, z);
    const tc = Math.cos(turn), ts = Math.sin(turn);
    const rt = this.rtw; rt.x = rt0.x; rt.z = rt0.z; rt.tx = rt0.tx * tc + rt0.tz * ts; rt.tz = rt0.tz * tc - rt0.tx * ts;
    let wx = 0, wy = 0, wz = 0;
    let entry: { x: number; y: number; z: number; k: number } | null = null;

    // ---------------------------------------------------------------- underground
    if (y < -0.4) {
      out.lane = "subway";
      const u = this.under;
      const wallD = u.sdf(x, y, z, this.uinfo as never);
      const ss = this.uinfo.ss, off = this.uinfo.off;
      // heights measured from the tunnel's own floor here (it dips and rises between the stations)
      const yl = y - u.dip(ss);
      const sp = city.subway.at(ss);
      const st = u.stationAt(ss);
      let along = st ? AIR.station : AIR.tunnel;
      // the draught slows as the tunnel nears the flood or the end of the line (it escapes up
      // the relief vent), but a train's own piston of air doesn't: it shoves you ahead of it
      const blockAhead = Math.min(...u.blocked.map((b) => (b.ss0 > ss ? b.ss0 - ss : 1e9)));
      if (blockAhead < 260) along *= 0.2 + 0.8 * (blockAhead / 260);
      let spill = 0;
      for (const tr of this.trainsAt(t)) {
        const ahead = (ss - tr.head) * tr.dir; // > 0 in front of the train
        const behind = (tr.tail - ss) * tr.dir;
        // each train's air mostly stays on its own track: the downtown track is the wrong side of the road
        const sameTrack = Math.sign(off) === Math.sign(tr.off) ? 1 : tr.dir > 0 ? 0.5 : 0.15;
        if (tr.dir > 0) {
          if (ahead > 0 && ahead < 260) along += AIR.trainPush * (1 - ahead / 260) * sameTrack;
          if (behind > 0 && behind < 120) along += 8 * (1 - behind / 120);
        } else if (ahead > 0 && ahead < 220) {
          along -= (AIR.tunnel + 14) * (1 - ahead / 220) * sameTrack; // the downtown train's wall of air
        }
        // right in front of a train on your track, its air spills up and over its roof: ride it up
        // and the train passes underneath (the gap above a train is about 2.5 m)
        if (sameTrack === 1 && ahead > 0 && ahead < 45) spill = Math.max(spill, 7 * (1 - ahead / 45));
        // inside a train?
        const inBody = tr.dir > 0 ? ss < tr.head && ss > tr.tail : ss > tr.head && ss < tr.tail;
        if (inBody && Math.abs(off - tr.off) < TRAIN.width / 2 + 0.15 && yl < TUNNEL.floor + 0.35 + TRAIN.height) { out.train = true; out.trainDir = tr.dir; }
      }
      wx = sp.tx * along; wz = sp.tz * along;
      // pull toward the middle of the tunnel and a little turbulence
      // the tunnel air hugs the curves: it holds you in the middle of whichever track you're over
      // (not the middle of the tunnel, where the column row is)
      const lane = (off >= 0 ? 1 : -1) * TRAIN.track, dl = off - lane;
      wx += sp.tz * -dl * 1.1; wz += -sp.tx * -dl * 1.1;
      wy = 0.8 * noise3(x / 8, y / 4, z / 8 + t, 41) + spill;
      // an air cushion off the walls: near a wall the air turns along it and pushes you off it,
      // so a leaf riding the draught round a bend skims the outer wall instead of slamming into it
      // (not under a shaft: there the ceiling has a hole in it and the air is going up it)
      let underShaft = false;
      for (const g of u.shaftGrid.at(x, z)) {
        const a = (x - g.x) * g.ux + (z - g.z) * g.uz, b = (x - g.x) * g.uz - (z - g.z) * g.ux;
        const near = g.kind === "vent" ? Math.abs(a) < VENT.halfLength + 2.5 && Math.abs(b) < VENT.halfWidth + 2.5
          : g.kind === "stairs" ? a > -STAIRS.half && a < STAIRS_FOOT + 1 && Math.abs(b) < STAIRS.halfWidth + 1.5
          : Math.hypot(a, b) < g.r + 2;
        if (near) { underShaft = true; break; }
      }
      if (wallD < AIR.cushion && !underShaft) {
        const e = 0.3;
        const nx = u.sdf(x + e, y, z) - u.sdf(x - e, y, z), nz = u.sdf(x, y, z + e) - u.sdf(x, y, z - e);
        const ny = u.sdf(x, y + e, z) - u.sdf(x, y - e, z);
        const nl = Math.hypot(nx, ny, nz);
        if (nl > 1e-4) {
          const ux = nx / nl, uy = ny / nl, uz = nz / nl, k = 1 - Math.max(0, wallD) / AIR.cushion;
          const into = Math.min(0, wx * ux + wy * uy + wz * uz); // the part of the air heading into the wall
          wx += ux * (-into * k + AIR.cushionPush * k * k);
          wy += uy * (-into * k + AIR.cushionPush * k * k);
          wz += uz * (-into * k + AIR.cushionPush * k * k);
        }
      }
      // ways out. Under a big "out" vent the tunnel air roars up the shaft and takes you with it;
      // at a station, the air drifts toward the passages up to the exit stairs (and the draught
      // eases there, so you can turn off the line).
      for (const g of u.shaftGrid.at(x, z)) {
        if (!g.out) continue;
        if (g.kind === "vent") {
          const a = (x - g.x) * g.ux + (z - g.z) * g.uz, b = (x - g.x) * g.uz - (z - g.z) * g.ux;
          const ea = Math.max(0, Math.abs(a) - VENT.halfLength), eb = Math.max(0, Math.abs(b) - VENT.halfWidth);
          const d = Math.hypot(ea, eb);
          if (d > 9) continue;
          const k = 1 - d / 9;
          // straight up under the opening; round it, drawn in toward the opening first
          // (near the roof only well inside the opening, or it jams you against the rim)
          const nearRoof = yl > TUNNEL.ceiling - 1.6;
          const under = nearRoof ? (Math.abs(a) < VENT.halfLength - 1 && Math.abs(b) < VENT.halfWidth - 0.4 ? 1 : 0.1) : d < 1.5 ? 1 : 0.2;
          // (like the ways out by the stairs, it only takes a leaf that wants it: one turning toward it or
          // slowing under it; one riding on along the line just feels the updraft)
          const lv = this.lv, va = lv.x * sp.tx + lv.z * sp.tz, hx = g.x - x, hz = g.z - z;
          const lat = hx * sp.tz - hz * sp.tx, across = Math.abs(lat) > 0.3 ? ((lv.x * sp.tz - lv.z * sp.tx) * Math.sign(lat)) : 0;
          const want = Math.abs(va) < 5 || across > 1.5 || (Math.abs(a) < VENT.halfLength - 1 && Math.abs(b) < VENT.halfWidth - 0.4 && nearRoof && Math.abs(va) < 8) ? 1 : 0.15;
          wy += 18 * k * under * want * smoothstep(TUNNEL.floor + 0.1, TUNNEL.floor + 1.0, yl);
          const na = Math.max(-VENT.halfLength + 0.8, Math.min(VENT.halfLength - 0.8, a)) - a, nb = Math.max(-VENT.halfWidth + 0.5, Math.min(VENT.halfWidth - 0.5, b)) - b;
          const nl = Math.hypot(na, nb) + 0.3;
          // the draught dies away under the vent (it's all going up the shaft), so you slow down there
          wx = wx * (1 - 0.92 * k) + ((g.ux * na + g.uz * nb) / nl) * 9 * k;
          wz = wz * (1 - 0.92 * k) + ((g.uz * na - g.ux * nb) / nl) * 9 * k;
        }
      }
      // the station's air pours out up the exit stairs: from across the platform it draws you into
      // the stream, which carries you out (see exitFlow)
      let exitTube = false;
      for (const g of this.exitGrid.at(x, z)) {
        const f = this.exitFlow(g.exitPath!, x, y, z, EXIT_REACH, 3.2, true, true, sp);
        if (f) { wx = wx * (1 - f.k) + f.x * f.k; wy = wy * (1 - f.k) + f.y * f.k; wz = wz * (1 - f.k) + f.z * f.k; out.guide = Math.max(out.guide ?? 0, f.tube ? 1 : f.k * 0.6); }
        if (f?.tube) { exitTube = true; break; }
      }
      // the ways in: drawn down the middle of the stairs, along the passage and out into the station
      let entryTube = false;
      if (!exitTube) for (const g of this.entryGrid.at(x, z)) {
        const f = this.exitFlow(g.entryPath!, x, y, z, 0, 2.6);
        if (f) { wx = f.x; wy = f.y; wz = f.z; out.guide = 1; entryTube = true; break; }
      }
      // vents overhead draw the tunnel air up into them: the relief vents always, the grates
      // when a train pushes the air ahead of it. Stand under one and you're fired up to the street.
      for (const g of u.shaftGrid.at(x, z)) {
        if (g.kind !== "grate") continue;
        const d = Math.hypot(x - g.x, z - g.z);
        const reach = g.relief ? 14 : g.r + 2.5;
        if (d > reach || (!g.relief && yl < TUNNEL.ceiling - 3.5)) continue;
        let pump = g.relief ? 13 : 0;
        if (!g.relief) for (const tr of this.trainsAt(t)) {
          const dd = Math.max(0, tr.dir > 0 ? g.ss - tr.head : tr.head - g.ss, tr.dir > 0 ? tr.tail - g.ss : g.ss - tr.tail);
          pump = Math.max(pump, 16 * Math.max(0, 1 - dd / 90));
        }
        const k = g.relief ? 0.35 + 0.65 * (1 - d / reach) : (1 - d / reach) * Math.min(1, (yl - (TUNNEL.ceiling - 3.5)) / 2);
        wy += pump * k;
        wx += ((g.x - x) / (d + 0.3)) * pump * 0.25 * k;
        wz += ((g.z - z) / (d + 0.3)) * pump * 0.25 * k;
      }
      // shafts: air leaks up the stairs, and the grates breathe out when a train passes
      const sh = this.uinfo.inShaft as Shaft | null;
      if (sh && sh.kind === "stairs" && sh.out && sh.exitPath) {
        // a way out: carried along the exit path, up the middle of the stairs and out
        const f = this.exitFlow(sh.exitPath, x, y, z, 24, 3.2, true);
        if (f) { out.x = f.x; out.y = f.y; out.z = f.z; out.guide = f.tube ? 1 : f.k * 0.6; return out; }
      }
      if (entryTube) { out.x = wx; out.y = wy; out.z = wz; return out; }
      if (exitTube) { out.x = wx; out.y = wy; out.z = wz; return out; }
      if (sh && sh.kind === "stairs") {
        // down the stairs (ways in) or up them and out (ways out), then along the passage
        const a = (x - sh.x) * sh.ux + (z - sh.z) * sh.uz, b = (x - sh.x) * sh.uz - (z - sh.z) * sh.ux;
        const dir = sh.out ? -1 : 1;
        if (a < STAIRS_FOOT) {
          const L = Math.hypot(1, STAIRS.slope), sp = sh.out ? 7 : 6.5;
          wx = (sh.ux / L) * sp * dir; wz = (sh.uz / L) * sp * dir; wy = (-STAIRS.slope / L) * sp * dir;
        } else {
          wx = sh.ux * 6 * dir; wz = sh.uz * 6 * dir; wy = 0;
        }
        // keep to the middle of the stairwell
        wx -= sh.uz * b * 1.5; wz += sh.ux * b * 1.5;
        out.x = wx; out.y = wy; out.z = wz;
        return out;
      }
      if (sh && sh.kind === "vent") {
        // straight up (ways out) or down (ways in) the shaft, held to its middle
        const a = (x - sh.x) * sh.ux + (z - sh.z) * sh.uz, b = (x - sh.x) * sh.uz - (z - sh.z) * sh.ux;
        wx = wx * 0.2 - sh.ux * a * 1.2 - sh.uz * b * 3;
        wz = wz * 0.2 - sh.uz * a * 1.2 + sh.ux * b * 3;
        wy = sh.out ? VENT.outBlast : -VENT.inPull - 3;
        out.x = wx; out.y = wy; out.z = wz;
        return out;
      }
      if (sh) {
        // ways in draw air (and leaves) down the stairs; ways out breathe warm air up into the street
        let pump = sh.kind === "stairs" ? ((sh as { out?: boolean }).out ? 6 : -1.5) : 0.5;
        if ((sh as { relief?: boolean }).relief) pump = 13;
        if (sh.kind === "grate") for (const tr of this.trainsAt(t)) {
          const d = Math.max(0, tr.dir > 0 ? sh.ss - tr.head : tr.head - sh.ss, tr.dir > 0 ? tr.tail - sh.ss : sh.ss - tr.tail);
          pump = Math.max(pump, 18 * Math.max(0, 1 - d / 90));
        }
        wy += pump;
        if (sh.kind === "grate") {
          // inside a vent shaft the air rushes straight up its middle
          wx = wx * 0.2 + (sh.x - x) * 3; wz = wz * 0.2 + (sh.z - z) * 3;
        } else { wx *= 0.4; wz *= 0.4; }
      }
      out.x = wx; out.y = wy; out.z = wz;
      return out;
    }

    const H = city.canopy(x, z, 14);
    const streetLevel = (H > 6 && y < H * 0.88) || (H <= 6 && y < 14);
    out.lane = streetLevel ? "street" : "roof";

    // ---------------------------------------------------------------- rooftops (and above)
    const above = Math.max(0, y - H);
    const gust = 1 + 0.45 * noise3(x / 90, y / 60, z / 90 - t * 0.25, 3) + 0.5 * Math.max(0, Math.sin(t * 0.52 + x * 0.004)) ** 6;
    const roofSpeed = (AIR.roof + Math.min(8, above * AIR.roofGrowth)) * gust * (0.6 + 0.4 * ow);
    // The wind over the roofs blows uptown, quartering: it comes at an angle that swings from one side
    // of the route to the other every kilometre or so (and wanders a little), so up there you're carried
    // along but always crabbing, and which side the city's edge is coming at you from keeps changing.
    // (It was a fixed north-westerly, which along this route is a cross- and headwind: past Chinatown
    // it blew every leaf backwards and sideways into the edge of the map.)
    const veer = 0.62 * Math.sin(n.s / 900 + 0.7) + 0.25 * noise3(x / 400, 0, z / 400 + t / 90, 9);
    const c = Math.cos(veer), s = Math.sin(veer);
    let rx = (rt.tx * c + rt.tz * s) * roofSpeed, rz = (rt.tz * c - rt.tx * s) * roofSpeed;
    const wdx = rx / (roofSpeed || 1), wdz = rz / (roofSpeed || 1); // its direction
    let ry = 1.2 * noise3(x / 30, y / 20, z / 30 + t * 0.6, 11);
    // thermals over dark roofs and lift where the wind hits a wall
    if (!streetLevel || y > 6) {
      for (const b of city.bgrid.around(x, z, 10, this.bl)) {
        if (b.h < 8) continue;
        const inside = x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && inPoly(b.poly, x, z);
        if (inside && y > b.h && y < b.h + 45 && (b.seed % 5) === 0) ry += 3.2 * (1 - (y - b.h) / 45); // thermal
        if (!inside && y > b.h * 0.4 && y < b.h + 14) {
          const e = nearestEdge(b.poly, x, z);
          tmpE.d = e.d;
          if (e.d < 9) {
            // windward face (its outward normal points into the wind): the air rides up the wall
            const into = -(e.nx * wdx + e.nz * wdz);
            if (into > 0.2) ry += roofSpeed * 0.75 * into * (1 - e.d / 9) * smoothstep(b.h * 0.4, b.h * 0.8, y);
            // leeward: a curl of downdraught off the roof edge
            else if (into < -0.3 && y > b.h - 4) ry -= roofSpeed * 0.35 * -into * (1 - e.d / 9);
          }
        }
      }
    }
    if (!streetLevel) { wx = rx; wy = ry; wz = rz; }

    // ---------------------------------------------------------------- street level
    if (streetLevel || y < H + 4) {
      let sx = 0, sy = 0, sz = 0;
      const a = this.s1, b = this.s2;
      city.streets2(x, z, a, b);
      const streetDir = (h: typeof a, tWeight: number) => {
        if (!isFinite(h.dist)) return;
        const align = h.tx * rt.tx + h.tz * rt.tz;
        let sign: number, speed: number;
        if (Math.abs(align) > 0.55) {
          sign = Math.sign(align); // route-aligned: always a tailwind uptown
          speed = AIR.avenue * clamp(22 / Math.max(6, h.w), 0.85, 1.4);
          // like a river current, the canyon keeps you in its middle
          sx += h.cx * AIR.channel * tWeight * 2;
          sz += h.cz * AIR.channel * tWeight * 2;
        } else {
          // cross streets gust across in their traffic direction, in pulses
          sign = h.d !== 0 ? h.d : (h.idx % 2 ? 1 : -1);
          const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.7 + h.idx * 1.37)) ** 2;
          speed = AIR.cross * pulse * 1.4;
          // and a steady drift uptown underneath, so a side street is never dead calm
          sx += rt.tx * 3.2 * tWeight; sz += rt.tz * 3.2 * tWeight;
        }
        sx += h.tx * sign * speed * tWeight;
        sz += h.tz * sign * speed * tWeight;
      };
      // blend the two nearest streets through intersections
      const da = a.dist, db = b.dist;
      const wa = isFinite(db) ? clamp((db - da) / 8 + 0.5, 0.5, 1) : 1;
      streetDir(a, wa);
      if (wa < 1) streetDir(b, 1 - wa);
      // cross-street bursts: at a junction the side street's air bursts out across the avenue in gusts (a few
      // seconds on, then calm), hard enough to shove a leaf off its line and down the side street if it's not
      // flown against. They grow as the city gets denser uptown.
      const prog = Math.min(1, n.s / city.route.length);
      for (const h of [a, b]) {
        if (!isFinite(h.dist) || h.dist > h.w / 2 + 3) continue;
        if (Math.abs(h.tx * rt0.tx + h.tz * rt0.tz) > 0.55) continue; // (the avenues themselves: no)
        // only in the junction, out over the avenue: once it has shoved you into the side street it lets go
        // (it blew all the way down the side street, a conveyor away from the route)
        const av = h === a ? b : a;
        if (!isFinite(av.dist) || av.dist > av.w / 2 + 2 || Math.abs(av.tx * rt0.tx + av.tz * rt0.tz) < 0.55) continue;
        const burst = Math.max(0, Math.sin(t * 0.45 + h.idx * 2.17)) ** 4;
        if (burst < 0.02) continue;
        const sign = h.d !== 0 ? h.d : (h.idx % 2 ? 1 : -1);
        const k = burst * AIR.crossBurst * (0.45 + 0.75 * prog) * (1 - smoothstep(Math.min(7, H * 0.5), Math.min(11, H * 0.7 + 1), y)) * smoothstep(0.3, 2, y); // (down in the street, where you fly it)
        sx += h.tx * sign * k; sz += h.tz * sign * k;
      }
      const inCanyon = a.dist < a.w / 2 + 6;
      // courtyards, lots and squares: sheltered, but never dead calm - a breeze always runs uptown
      if (!inCanyon) { sx = sx * 0.3 + rt.tx * 5; sz = sz * 0.3 + rt.tz * 5; }
      sx += 1.6 * noise3(x / 20, y / 10, z / 20 + t * 0.7, 21);
      sz += 1.6 * noise3(x / 20, y / 10, z / 20 + t * 0.7, 22);
      // the canyons breathe upward (warm streets, sunlit walls): enough to hold height if you
      // fly well, thinning right above the tarmac where the traffic is
      sy = AIR.canyonLift * smoothstep(0.5, 3.5, y) + 1.2 * noise3(x / 14, y / 9, z / 14 + t * 0.9, 23);
      const ground = 0.6 + 0.4 * smoothstep(0, 4, y);
      sx *= ground; sz *= ground;
      // open ground (parks, squares, building sites): a softer breeze along the route
      if (H <= 6) { sx = rt.tx * 6 + sx * 0.3; sz = rt.tz * 6 + sz * 0.3; }
      // steam manholes: the street's elevators
      for (const st of this.life.steamGrid.at(x, z)) {
        const dy = y;
        if (dy > st.height) continue;
        const rad = 1.3 + dy * 0.12;
        const r2 = ((x - st.x) ** 2 + (z - st.z) ** 2) / (rad * rad);
        if (r2 > 1) continue;
        const puff = 0.55 + 0.45 * Math.max(0, Math.sin(((t + st.phase) / st.period) * 6.283));
        sy += st.speed * puff * (1 - r2) * (1 - 0.5 * dy / st.height);
        sx *= 0.5; sz *= 0.5;
      }
      // coming up out of a way out, its stream carries you on up into the street
      if (y < 6) for (const g of this.exitGrid.at(x, z)) {
        const f = this.exitFlow(g.exitPath!, x, y, z, 0, 3.2);
        if (f) { entry = { x: f.x, y: f.y, z: f.z, k: 1 }; break; }
      }
      // the ways in: their stream reaches out a dozen metres into the street and draws you into it
      if (y < 6.5 && !entry) for (const sh of this.entryGrid.at(x, z)) {
        const f = this.exitFlow(this.mouths.get(sh)!, x, y, z, 12, 2.6, true, false);
        if (f && (!entry || f.k > entry.k)) entry = { x: f.x, y: f.y, z: f.z, k: f.tube ? 1 : f.k * 0.7 };
      }
      // subway stairs: the ways in draw you down when you're close (dive for it); the ways out
      // breathe a warm column up into the cold street
      for (const sh of this.under.shaftGrid.at(x, z)) {
        if (sh.kind !== "stairs" || y > 9) continue;
        const d = Math.hypot(x - sh.x, z - sh.z);
        if (sh.out) {
          if (d > 5.5) continue;
          sy += 5 * (1 - d / 5.5) * (1 - y / 9);
          continue;
        }
        // the mouth of the way in: once you're in its stream it takes you down (see the end of sample)
        if (entry) continue;
        // around it a wide, firm funnel draws you toward it: aim at the sign and dive
        if (d > 9 || y > 7) continue;
        const k = 1 - d / 9, kk = k * (1 - Math.max(0, y - 2) / 5);
        // over the opening it pulls you down; just short of it, skimming the pavement, it lifts you
        // a little and draws you in (so a leaf that lands by the entrance slides in, not sticks)
        const over = Math.abs((x - sh.x) * sh.ux + (z - sh.z) * sh.uz) < 2.1 && Math.abs((x - sh.x) * sh.uz - (z - sh.z) * sh.ux) < 1.95;
        sy += over ? -4.5 * kk : y < 1.3 ? 1.6 * k : -2 * kk;
        const pull = over ? 4 : y < 1.3 ? 7 : 4.5;
        sx += ((sh.x - x) / (d + 0.2)) * pull * kk;
        sz += ((sh.z - z) / (d + 0.2)) * pull * kk;
      }
      // the closed streets: no lift over them. The air at a closure churns and blows back at you (the idling
      // trucks, the crowd, the scaffold's netting: a buffeting push back the way you came). Over the roofs,
      // under, or round. (Not in the lanes kept open along the ways through.)
      if (y < CAP + 6) for (const bl of this.blockers.list) {
        if (Math.abs(x - bl.x) > bl.r + 16 || Math.abs(z - bl.z) > bl.r + 16) continue;
        for (const bar of this.blockers.barriers) {
          if (bar.blocker !== bl.id) continue;
          const rx = x - bar.x, rz = z - bar.z;
          // (either side: you can be caught inside a closed stretch too)
          const d = rx * bar.nx + rz * bar.nz, across = rx * bar.ax + rz * bar.az, ad = Math.abs(d), side = d >= 0 ? 1 : -1;
          const reach = 12;
          if (ad > reach || Math.abs(across) > bar.half + 2 || y > bar.height + 4) continue;
          if (inGap(bar, across, y, 1.5)) continue;
          const k = (1 - ad / reach) * (1 - Math.max(0, Math.abs(across) - bar.half) / 2) * (1 - smoothstep(bar.height - 3, bar.height + 4, y));
          // none of the air blows into it...
          const into = Math.min(0, (sx * bar.nx + sz * bar.nz) * side);
          sx -= bar.nx * side * into * k; sz -= bar.nz * side * into * k;
          // ...it blows back out at you, and churns
          const push = 4.5 * k, ch = 2.4 * k;
          sx += bar.nx * side * push + Math.sin(t * 2.7 + x * 0.31 + z * 0.17) * ch;
          sz += bar.nz * side * push + Math.cos(t * 2.3 - x * 0.13 + z * 0.29) * ch;
          sy = sy * (1 - 0.7 * k) + 1.8 * Math.sin(t * 1.9 + x * 0.2 + y * 0.3) * k;
        }
      }
      // the burst main's geyser: a column of air and water roaring up, and round it the fall of water beating
      // down and blowing out
      for (const bl of this.blockers.list) {
        const gz = bl.geyser;
        if (!gz || y > gz.h + 8) continue;
        const dx = x - gz.x, dz = z - gz.z, d = Math.hypot(dx, dz);
        if (d > gz.fall + 6) continue;
        if (d < gz.r * 1.3) { const k = 1 - d / (gz.r * 1.3); sy = sy * (1 - k) + 18 * k; }
        else {
          // the fall of water and the mist cloud round it: beating down, blowing out, turbulent
          const k = Math.min(1, 1.3 * (1 - (d - gz.r * 1.3) / (gz.fall + 6 - gz.r * 1.3))) * (1 - Math.max(0, y - gz.h * 0.7) / (gz.h * 0.3 + 8));
          sy -= 4 * k;
          sx += (dx / d) * 6 * k + Math.sin(t * 3.1 + y * 0.7 + z * 0.3) * 3.5 * k;
          sz += (dz / d) * 6 * k + Math.cos(t * 2.7 + y * 0.6 + x * 0.3) * 3.5 * k;
          sy += Math.sin(t * 4.3 + x * 0.4) * 2.5 * k;
        }
      }
      // open manholes suck you down
      for (const m of this.life.holeGrid.at(x, z)) {
        const d = Math.hypot(x - m.x, z - m.z);
        if (d < 3.5 && y < 3) { sy -= 3 * (1 - d / 3.5); sx += ((m.x - x) / (d + 0.1)) * 1.5; sz += ((m.z - z) / (d + 0.1)) * 1.5; }
      }
      // slipstreams behind traffic
      if (y < 7) {
        const w = this.traffic.wake(x, y, z, this.wk as never);
        sx += w.x; sy += w.y; sz += w.z;
        if (w.hit) out.vehicle = true;
      }
      // never dead calm down here: in the lee of the towers the street air can all but stop, and a leaf
      // that's sunk into a sheltered corner had nothing to carry it on or lift it out. There's always a
      // breath of the city's draught uptown, and a little lift off the pavement.
      {
        const hs = Math.hypot(sx, sz);
        if (hs < 3.5) {
          // along the way through, or back toward it from a side street (the route line itself cuts
          // through buildings: its direction can point straight into a wall)
          const wn = this.way.nearest(x, z, -1, this.wayN), a = this.way.at(wn.s + (wn.d > 15 ? 4 : 0), this.wayA);
          let dx = a.tx, dz = a.tz;
          if (wn.d > 15) { const L = Math.hypot(a.x - x, a.z - z) || 1; dx = (a.x - x) / L; dz = (a.z - z) / L; }
          // (off the ways it's the city's own draught, wherever that's going)
          dx = dx * ow + rt.tx * (1 - ow); dz = dz * ow + rt.tz * (1 - ow);
          sx += dx * (3.5 - hs); sz += dz * (3.5 - hs);
        }
        if (y < 2.5) sy = Math.max(sy, 1.6 * (1 - y / 2.5) + 0.6);
      }
      // blend from street air into roof air near the roofline
      const k = streetLevel ? (H > 6 ? smoothstep(H * 0.6, H * 0.88, y) * 0.5 : smoothstep(8, 14, y)) : 1;
      wx = sx * (1 - k) + rx * k;
      wy = sy * (1 - k) + ry * k;
      wz = sz * (1 - k) + rz * k;
    }

    // ---------------------------------------------------------------- walls: air can't blow through them
    // Near a wall the part of the wind blowing into it turns along the wall and up it, so a leaf
    // is never pinned against a building, and windward faces give lift.
    {
      // (and a leaf that's been shoved a little way into a wall is blown back out of it, not on in:
      // a strong street wind straight at a wall used to hold leaves there for good)
      let best = 6, nx = 0, nz = 0, inside = false;
      for (const b of city.bgrid.around(x, z, 6, this.bl)) {
        if (y > b.h + 1 || x < b.x0 - 6 || x > b.x1 + 6 || z < b.z0 - 6 || z > b.z1 + 6) continue;
        const e = nearestEdge(b.poly, x, z);
        const isIn = inPoly(b.poly, x, z);
        if (isIn && y < b.h) { if (!inside || e.d < best) { best = e.d; nx = e.nx; nz = e.nz; inside = true; } }
        else if (!inside && e.d < best) { best = e.d; nx = e.nx; nz = e.nz; }
      }
      if (inside) {
        const into = -(wx * nx + wz * nz);
        if (into > 0) { wx += nx * into; wz += nz * into; wy += into * 0.7; }
        wx += nx * 3; wz += nz * 3;
      } else if (best < 6) {
        const into = -(wx * nx + wz * nz);
        if (into > 0) {
          const k = Math.min(1, 1.15 * (1 - best / 6));
          wx += nx * into * k; wz += nz * into * k;
          wy += into * k * 0.7;
        }
      }
    }

    // ---------------------------------------------------------------- AC units blowing out of the walls
    if (y > 2 && y < 64) {
      for (const p of this.facades.grid.at(x, z)) {
        if (p.kind !== "ac" || !p.blows) continue;
        const rx = x - p.x, ry = y - p.y, rz = z - p.z;
        const out = rx * p.nx + rz * p.nz;
        if (out < 0 || out > 4.5) continue;
        const side = Math.abs(rx * p.tx + rz * p.tz);
        if (side > 0.9 || Math.abs(ry) > 0.8) continue;
        const k = (1 - out / 4.5) * (1 - side / 0.9);
        wx += p.nx * 7 * k; wz += p.nz * 7 * k; wy += 1.5 * k;
      }
    }

    // ---------------------------------------------------------------- gust fronts
    // waves of wind sweeping uptown, street and roofs: you hear one coming, the litter kicks
    // up, and if you're in it you're flung along. Catch the front edge and surf it.
    {
      const g = this.gustAt(n.s, t);
      if (g > 0.01) {
        const k = g * (y > -0.4 ? 1 : 0) * (0.25 + 0.75 * ow);
        wx += rt.tx * AIR.gust * k; wz += rt.tz * AIR.gust * k;
        wy += 1.2 * k;
        // churning inside it
        wx += 2.5 * k * noise3(x / 9, y / 6, z / 9 + t * 2.2, 61);
        wz += 2.5 * k * noise3(x / 9, y / 6, z / 9 + t * 2.2, 62);
        wy += 1.5 * k * noise3(x / 9, y / 6, z / 9 + t * 2.2, 63);
      }
    }

    // ---------------------------------------------------------------- the massive vents
    // ways in pull you down into them from a few metres around; ways out fire a column of tunnel
    // air straight up past the rooftops (ride it and you're on the roofs in seconds)
    if (y > -0.6) {
      for (const v of this.under.shaftGrid.at(x, z)) {
        if (v.kind !== "vent") continue;
        const a = (x - v.x) * v.ux + (z - v.z) * v.uz, b = (x - v.x) * v.uz - (z - v.z) * v.ux;
        const ea = Math.max(0, Math.abs(a) - VENT.halfLength), eb = Math.max(0, Math.abs(b) - VENT.halfWidth);
        const d = Math.hypot(ea, eb); // distance outside the grate's rectangle (0 over it)
        if (v.out) {
          if (d > 2.5 || y > VENT.outReach) continue;
          const k = (1 - d / 2.5) * (1 - y / VENT.outReach);
          wy += VENT.outBlast * k;
          wx *= 1 - 0.6 * k; wz *= 1 - 0.6 * k;
        } else {
          if (d > 8 || y > 10) continue;
          const k = (1 - d / 8) * (1 - Math.max(0, y - 2) / 8);
          wy -= VENT.inPull * k;
          const L = Math.hypot(a, b) + 0.5;
          wx += (-(v.ux * a + v.uz * b) / L) * 4 * k;
          wz += (-(v.uz * a - v.ux * b) / L) * 4 * k;
        }
      }
    }

    // ---------------------------------------------------------------- hidden currents, dust devils, downdrafts
    {
      const f = this.fh;
      f.x = wx; f.y = wy; f.z = wz;
      this.features.apply(x, y, z, t, f);
      wx = f.x; wy = f.y; wz = f.z;
      out.jet = f.jet; out.devil = f.devil;
      if (f.guide) out.guide = Math.max(out.guide ?? 0, f.guide);
    }

    // ---------------------------------------------------------------- the edges of the corridor
    // a wall of wind (render/edgeWall.ts draws it): it takes you and carries you back toward the route
    {
      const edge = n.d - (AIR.corridor - AIR.wallDepth);
      if (edge > 0) {
        const k = Math.min(1, edge / AIR.wallDepth);
        const nx = (rt.x - x) / n.d, nz = (rt.z - z) / n.d;
        const churn = noise3(x / 14, y / 10, z / 14 + t * 1.5, 71);
        // (and on uptown along it, so it never just pins you against it)
        wx = wx * (1 - 0.7 * k) + (nx * AIR.wallSpeed + rt0.tx * 7 + -nz * churn * 5) * k;
        wz = wz * (1 - 0.7 * k) + (nz * AIR.wallSpeed + rt0.tz * 7 + nx * churn * 5) * k;
        wy += (2 + 3 * churn) * k;
        out.guide = Math.max(out.guide ?? 0, 0.3 * k * k); // (firm at its heart, but you can fight your way out of its edge)
      }
    }
    // ---------------------------------------------------------------- over the rivers
    // the wind off the water: it drags a leaf down into the river (off the bridges, off the piers)
    if (y > -0.4 && y < 80 && this.overWater(x, z)) {
      const k = 1 - y / 80;
      wy = wy * (1 - 0.5 * k) - 9 * k;
      wx += 6 * k * noise3(x / 20, y / 10, z / 20 + t, 72);
      wz += 6 * k * noise3(x / 20, y / 10, z / 20 + t, 73);
      out.guide = Math.max(out.guide ?? 0, 0.5 * k);
    }
    if (y > 320) wy -= (y - 320) * 0.15;
    if (entry) { const k = Math.min(1, entry.k * 1.4); wx = wx * (1 - k) + entry.x * k; wy = wy * (1 - k) + entry.y * k; wz = wz * (1 - k) + entry.z * k; out.guide = entry.k; }

    out.x = wx; out.y = wy; out.z = wz;
    return out;
  }
}
