// A human-like test pilot. Not a perfect AI: it reacts late, steers with wobbly
// digital keys, misjudges heights, looks away now and then, and makes route choices
// like a player would (stay on the street, chance the subway, ride steam up a block).
// Skill slides all of that from "first evening" to "has played fifty runs".
//
// Used by tools/play.ts (headless, thousands of runs) and ?pilot= in the browser.

import type { Glider, LeafInput } from "./glider";
import type { Airflow } from "../world/airflow";
import type { CityData } from "../world/data";
import { TUNNEL, type Shaft } from "../world/underground";
import { makeCourse } from "../world/course";
import type { Polyline } from "../world/data";

/** the way along the streets (world/course.ts): the route line itself cuts through buildings in places */
const paths = new WeakMap<CityData, Polyline>();

export interface Profile {
  name: string;
  skill: number;        // 0..1
  reaction: number;     // seconds of input delay
  wobble: number;       // steering noise (rad)
  lapse: number;        // chance per second of looking away
  digital: boolean;     // keyboard on/off keys rather than smooth stick
  subway: number;       // 0..1 how keen on the subway
  drops: boolean;       // goes for roof-to-street / street-to-subway drops
  tricks: number;       // 0..1 how often they show off
}

export const PROFILES: Profile[] = [
  { name: "first go", skill: 0.15, reaction: 0.45, wobble: 0.35, lapse: 0.05, digital: true, subway: 0.15, drops: false, tricks: 0.05 },
  { name: "casual", skill: 0.35, reaction: 0.35, wobble: 0.25, lapse: 0.03, digital: true, subway: 0.35, drops: false, tricks: 0.1 },
  { name: "regular", skill: 0.6, reaction: 0.28, wobble: 0.15, lapse: 0.015, digital: true, subway: 0.6, drops: true, tricks: 0.15 },
  { name: "speedrunner", skill: 0.85, reaction: 0.2, wobble: 0.07, lapse: 0.005, digital: false, subway: 0.9, drops: true, tricks: 0.05 },
];

type Mode = "street" | "roof" | "toSubway" | "subway" | "exitSubway";

class Rand {
  constructor(private s: number) {}
  next() { let t = (this.s += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  gauss() { return Math.sqrt(-2 * Math.log(this.next() + 1e-9)) * Math.cos(6.2831853 * this.next()); }
}

export class Pilot {
  mode: Mode = "street";
  private rng: Rand;
  private history: { t: number; input: LeafInput }[] = [];
  private lapseUntil = -1;
  private heightBias: number;
  private wobblePhase: number;
  private target: Shaft | null = null;
  private decided = -1;
  private stuckFor = 0;
  private targetSince = 0;
  private trackSide = 0;
  private giveUpUntil = -1;
  /** what the pilot is doing, for the report */
  log: string[] = [];

  private path: Polyline;
  constructor(readonly city: CityData, readonly flow: Airflow, readonly leaf: Glider, readonly p: Profile, seed: number) {
    this.path = paths.get(city) ?? paths.set(city, makeCourse(city).path).get(city)!;
    this.rng = new Rand(seed * 7919 + 13);
    this.heightBias = this.rng.gauss() * (1 - p.skill) * 2.5;
    this.wobblePhase = this.rng.next() * 100;
  }

  /** Decide this tick's input; returns the delayed (human) one. */
  update(dt: number): LeafInput {
    const L = this.leaf, p = this.p, t = L.clock;
    const fresh = this.think(dt);
    // looking away
    if (t > this.lapseUntil && this.rng.next() < p.lapse * dt) this.lapseUntil = t + 0.4 + this.rng.next() * 1.1;
    this.history.push({ t, input: fresh });
    while (this.history.length > 1 && this.history[1].t <= t - p.reaction) this.history.shift();
    const out = { ...this.history[0].input };
    if (t < this.lapseUntil) { out.roll *= 0.2; out.pitch *= 0.2; out.corkscrew = 0; out.loop = false; }
    if (p.digital) {
      out.roll = Math.abs(out.roll) > 0.3 ? Math.sign(out.roll) : 0;
      out.pitch = Math.abs(out.pitch) > 0.3 ? Math.sign(out.pitch) : 0;
    }
    return out;
  }

  private think(dt: number): LeafInput {
    const L = this.leaf, city = this.city, p = this.p, u = this.flow.under;
    const input: LeafInput = { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0, loop: false };
    const pos = L.pos;
    const route = city.route.nearest(pos.x, pos.z);
    const under = pos.y < -0.4;

    // ---- choose what to do (re-thought every few seconds, like a person)
    if (L.clock - this.decided > 3) {
      this.decided = L.clock;
      if (!under && (this.mode === "street" || this.mode === "roof")) {
        // a station entrance coming up? keen players go for it
        const sub = city.subway.nearest(pos.x, pos.z);
        const blocked = u.isBlocked(sub.s + 150);
        if (!blocked && sub.d < 90 && sub.s < u.end - 300 && this.rng.next() < p.subway * 0.5) {
          let best: Shaft | null = null, bd = 1e9;
          for (const sh of u.shafts) {
            if (sh.kind !== "stairs" || sh.out) continue;
            const ahead = city.route.nearest(sh.x, sh.z).s - route.s;
            const d = Math.hypot(sh.x - pos.x, sh.z - pos.z);
            if (ahead > 10 && ahead < 140 && d < bd) { bd = d; best = sh; }
          }
          if (best && L.clock > this.giveUpUntil) { this.target = best; this.mode = "toSubway"; this.targetSince = L.clock; this.log.push(`s${route.s.toFixed(0)}: heading for ${best.name}`); }
        } else if (this.mode === "street" && p.skill < 0.4 && this.rng.next() < 0.15) {
          this.mode = "roof"; // cautious players climb out of the traffic
        }
      }
    }
    if (under && this.mode !== "subway" && this.mode !== "exitSubway") { this.mode = "subway"; this.target = null; }
    if (!under && (this.mode === "subway" || this.mode === "exitSubway")) { this.mode = "street"; this.target = null; }

    // ---- where to steer, how high to be
    let tx: number, tz: number, wantY: number;
    if (this.mode === "subway" || this.mode === "exitSubway") {
      const sub = city.subway.nearest(pos.x, pos.z);
      // trouble ahead (flood, end of the line)? get out up a grate or the stairs
      if (this.mode === "subway" && (u.isBlocked(sub.s + 200) || sub.s > u.end - 200)) {
        let best: Shaft | null = null, bd = 1e9;
        for (const sh of u.shafts) {
          if ((sh.kind === "stairs" || sh.kind === "vent") && !sh.out) continue; // a way in won't get you out
          const ahead = sh.ss - sub.s;
          if (ahead > 8 && ahead < 150 && ahead < bd) { bd = ahead; best = sh; }
        }
        if (best) { this.mode = "exitSubway"; this.target = best; this.log.push(`s${route.s.toFixed(0)}: getting out at ${best.kind}`); }
      }
      if (this.mode === "exitSubway" && this.target) {
        tx = this.target.x; tz = this.target.z;
        const d = Math.hypot(tx - pos.x, tz - pos.z);
        wantY = d < 3 ? 2 : (TUNNEL.floor + TUNNEL.ceiling) / 2 + 1 + city.subwayDip(sub.s);
        if (d < 4) input.spread = true;
      } else {
        const a = city.subway.at(sub.s + 28 + p.skill * 22); // in a tunnel you watch the curve coming
        // good players keep to the uptown track (the downtown one has trains coming at you), and
        // anyone sees headlights coming and swerves to the other track
        let side = p.skill > 0.5 ? 3.0 : this.trackSide;
        // headlights coming: get over to the uptown track, wherever you've drifted to
        let coming = false;
        for (const tr of this.flow.trainsAt(L.clock)) {
          if (tr.dir > 0) continue;
          const ahead = tr.head - sub.s;
          if (ahead > -10 && ahead < 90 + 160 * p.skill) { side = 3.0; coming = true; }
        }
        // drifted way off the line (stations, junctions): steer back hard toward it
        if (coming && sub.off < 1.5) side = 4.5;
        this.trackSide = side;
        tx = a.x + a.tz * side; tz = a.z - a.tx * side;
        // good players hug the ceiling: a train can pass underneath
        wantY = (TUNNEL.floor + TUNNEL.ceiling) / 2 + 0.3 + p.skill * 2.4 + city.subwayDip(sub.s);
      }
    } else if (this.mode === "toSubway" && this.target) {
      tx = this.target.x; tz = this.target.z;
      const d = Math.hypot(tx - pos.x, tz - pos.z);
      wantY = d < 6 ? -3 : 3.5;
      if (d < 5) input.curl = true;
      if (d > 160 || L.clock - this.targetSince > 25) { this.mode = "street"; this.target = null; this.giveUpUntil = L.clock + 30; this.log.push(`s${route.s.toFixed(0)}: gave up on the stairs`); }
    } else if (this.flow.blockers.near(pos.x, pos.z) && !under) {
      // a closed street: hop the barrier (it's only so high), or over the roofs if they're low
      const look = 22 + p.skill * 18;
      const a = this.path.at(this.path.nearest(pos.x, pos.z).s + look);
      tx = a.x; tz = a.z;
      const bl = this.flow.blockers.near(pos.x, pos.z)!;
      const roofs = city.canopy(pos.x, pos.z, 30);
      wantY = roofs < 25 ? roofs + 8 : bl.height + 4;
    } else {
      const look = 22 + p.skill * 18;
      const a = this.path.at(this.path.nearest(pos.x, pos.z).s + look);
      tx = a.x; tz = a.z;
      const H = city.canopy(pos.x, pos.z, 16);
      // street flyers keep above the traffic and the parked cars (and below the lamp arms)
      wantY = this.mode === "roof" ? H + 8 : 5.8 + p.skill * 1.6;
      // ride steam if low
      if (this.mode === "street" && pos.y < wantY - 1.5) {
        for (const st of this.flow.life.steamGrid.around(pos.x, pos.z, 26, [])) {
          const ahead = (st.x - pos.x) * (a.x - pos.x) + (st.z - pos.z) * (a.z - pos.z);
          if (ahead > 0) { tx = st.x; tz = st.z; break; }
        }
      }
    }
    wantY += this.heightBias;

    // ---- steer: bank toward the target with human wobble
    const wob = p.wobble * Math.sin(L.clock * 1.7 + this.wobblePhase) + this.rng.gauss() * p.wobble * 0.3;
    let d = Math.atan2(tx - pos.x, tz - pos.z) - L.heading + wob;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    input.roll = Math.max(-1, Math.min(1, -d * (1.6 + p.skill)));

    // ---- height: dive when high, flare when low (anticipating with skill)
    const err = pos.y - wantY;
    input.pitch = Math.max(-1, Math.min(1, err * 0.3 - L.vel.y * (0.1 + 0.2 * p.skill)));
    if (err < -2.5 && !input.curl) input.spread = true;
    if (err > 8 && this.mode !== "roof") input.curl = true;

    // ---- traffic: climb if a vehicle is coming at your height
    if (!under && pos.y < 3.2) {
      for (const v of this.flow.traffic.grid.around(pos.x, pos.z, 16, [])) {
        const dx = v.x - pos.x, dz = v.z - pos.z;
        if (dx * dx + dz * dz < (6 + 10 * p.skill) ** 2) { input.pitch = -1; input.spread = true; break; }
      }
    }
    // ---- stuck on the ground: flick up into the wind
    if (L.grounded) { this.stuckFor += dt; if (this.stuckFor > 0.6 + (1 - p.skill)) { input.spread = true; input.pitch = -1; } }
    else this.stuckFor = 0;
    // ---- show-offs
    if (this.rng.next() < p.tricks * dt * 0.2 && pos.y > 6) input.corkscrew = this.rng.next() < 0.5 ? -1 : 1;
    return input;
  }
}
