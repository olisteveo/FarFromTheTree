// The leaf: a little glider in moving air. No thrust, ever. The player sets its angle
// of attack (dive / flare), its bank (turn) and its shape (spread / curl); lift and drag
// against the moving air do everything else.
//
//   dive (W)    lower angle: less lift, the leaf noses down and trades height for speed
//   flare (S)   higher angle: more lift, it climbs on its speed, then stalls if you hold it
//   bank (A/D)  tilts the lift sideways: the path curves, the nose follows
//   spread      a sail: catches the wind hard, floats, slow
//   curl        a seed: barely catches, drops fast, punches through headwinds
//
// Dropping a layer pays: roof to street gives a burst along the canyon, street to
// subway a bigger one, and both in one dive a bigger one still.
//
// Pure TS (three maths only): the browser game and the headless test bot share it.

import { Euler, Quaternion, Vector3 } from "three";
import { clamp, noise1 } from "../core/rng";
import { inPoly, nearestEdge, type Building, type CityData } from "../world/data";
import { Airflow, type AirSample, type Lane } from "../world/airflow";

export const FLIGHT = {
  wingLoad: 0.3,      // area / mass (m^2/kg): bigger floats more; sets the glide speed (~8.5 m/s)
  rho: 1.2,
  g: 9.81,
  clAlpha: 4.2,       // lift slope per radian
  alphaTrim: 0.2,     // the angle the leaf settles at with no input
  alphaDive: -0.12,   // full W
  alphaFlare: 0.33,   // full S: just short of the stall
  stall: 0.36,
  cd0: 0.08,
  kInduced: 0.06,
  spreadLoad: 1.5, spreadCd: 0.14,
  curlLoad: 0.5, curlCl: 0.25, curlCd: 0.04,
  bankMax: 1.0,       // rad
  responsiveness: 6,  // how fast the leaf answers the stick (1/s)
  maxAccel: 90,       // m/s^2 of drag: how fast a gust can grab the leaf
  maxLift: 24,        // m/s^2 of lift: about 2.5 g
  radius: 0.12,
  safeImpact: 4.5,
  damage: 0.036,      // integrity lost per m/s of impact over the safe speed (tanky enough to learn on)
  dropRoofStreet: 0.8,
  dropStreetSubway: 1.15,
  dropChain: 1.35,
  heal: 0.03,         // integrity per second regained while flying clean...
  healDelay: 4,       // ...starting this long after the last hit
  scar: 0.3,          // ...but each hit lowers the ceiling by this share of its damage
};

export type LeafState = "attached" | "flying" | "dead" | "planted";

export interface LeafInput { pitch: number; roll: number; spread: boolean; curl: boolean; corkscrew?: -1 | 0 | 1; loop?: boolean }

export type Trick = { kind: "corkscrew" | "loop"; t: number; dir: number; angle: number; axis?: Vector3; speed?: number } | null;

const eul = new Euler(0, 0, 0, "YXZ");
const up = new Vector3(), e = new Vector3(), side = new Vector3(), lift = new Vector3(), F = new Vector3(), tmp = new Vector3();

export class Glider {
  pos = new Vector3();
  vel = new Vector3();
  q = new Quaternion();
  heading = 0;
  bank = 0;
  alpha = FLIGHT.alphaTrim;
  integrity = 1;
  /** how far integrity can heal back to: every hit leaves a scar */
  maxIntegrity = 1;
  state: LeafState = "attached";
  time = 0;
  clock = 0;
  failure = "";
  lane: Lane = "street";
  airspeed = 0;
  grounded = false;
  /** the trick in progress, and a count of finished ones (for achievements and the HUD) */
  trick: Trick = null;
  tricks = { corkscrew: 0, loop: 0, last: "", lastAt: -99 };
  /** extra roll / pitch the trick adds to the leaf's look */
  private spin = 0;
  private flip = 0;
  /** last layer-drop boost (for the HUD and camera kick) */
  boost = { t: -99, amount: 0, kind: "" };
  /** recent damage, for debugging and the death screen */
  events: string[] = [];
  readonly air: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
  private dropFromRoofAt = -99;
  private lastHop = -99;
  private lastHit = -99;
  private bl: Building[] = [];

  constructor(readonly city: CityData, readonly flow: Airflow, readonly start: { x: number; y: number; z: number; heading: number }) {
    this.reset();
  }

  reset() {
    this.pos.set(this.start.x, this.start.y, this.start.z);
    this.vel.set(0, 0, 0);
    this.heading = this.start.heading;
    this.bank = 0;
    this.alpha = FLIGHT.alphaTrim;
    this.integrity = 1;
    this.maxIntegrity = 1;
    this.state = "attached";
    this.time = 0;
    this.clock = 0;
    this.failure = "";
    this.boost = { t: -99, amount: 0, kind: "" };
    this.events = [];
    this.updateQuat(0);
  }

  detach() { if (this.state === "attached") this.state = "flying"; }

  private updateQuat(sway: number) {
    // nose along the heading, pitched by the path and the angle of attack, rolled by the bank
    const vh = Math.hypot(this.vel.x, this.vel.z);
    const path = this.state === "flying" ? Math.atan2(this.vel.y, Math.max(0.5, vh)) : 0;
    const pitch = -(path + this.alpha * 0.6) + sway;
    eul.set(pitch + this.flip, this.heading, this.bank + this.spin, "YXZ");
    this.q.setFromEuler(eul);
  }

  private dtNow = 1 / 120;

  step(dt: number, input: LeafInput) {
    this.dtNow = dt;
    this.clock += dt;
    const T = FLIGHT;
    if (this.state === "attached") {
      this.bank = 0.25 * Math.sin(this.clock * 1.1);
      this.alpha = 0.3;
      this.updateQuat(0.3 * Math.sin(this.clock * 1.7));
      return;
    }
    if (this.state !== "flying") return;
    this.time += dt;

    // ---- the stick, with flutter that grows as the leaf tears
    const torn = 1 - this.integrity;
    const flutter = 0.04 + torn * 0.35;
    const k = 1 - Math.exp(-T.responsiveness * dt);
    const pitchIn = clamp(input.pitch, -1, 1);
    const wantAlpha = pitchIn > 0 ? T.alphaTrim + (T.alphaDive - T.alphaTrim) * pitchIn : T.alphaTrim + (T.alphaFlare - T.alphaTrim) * -pitchIn;
    this.alpha += (wantAlpha + flutter * 0.5 * noise1(this.clock * 3.3, 5) - this.alpha) * k;
    this.bank += (clamp(input.roll, -1, 1) * T.bankMax + flutter * noise1(this.clock * 2.9, 6) - this.bank) * k;

    // ---- tricks
    if (!this.trick && !this.grounded) {
      if (input.corkscrew) this.trick = { kind: "corkscrew", t: 0, dir: input.corkscrew, angle: 0 };
      else if (input.loop && this.vel.length() > 9) {
        const v = this.vel.clone().normalize();
        const axis = new Vector3().crossVectors(v, new Vector3(0, 1, 0));
        if (axis.lengthSq() > 0.01) this.trick = { kind: "loop", t: 0, dir: 1, angle: 0, axis: axis.normalize().negate(), speed: this.vel.length() };
      }
    }
    if (this.trick?.kind === "loop") {
      // a loop: swing the velocity round the leaf's right axis; gravity still trades speed for height
      const tr = this.trick;
      const V = Math.max(6, this.vel.length());
      const r = Math.max(6, (tr.speed! * tr.speed!) / (2.6 * T.g));
      const dA = (V / r) * dt;
      this.vel.applyAxisAngle(tr.axis!, -dA);
      this.vel.y -= T.g * dt * 0.35;
      tr.angle += dA;
      this.flip = -tr.angle;
      this.pos.addScaledVector(this.vel, dt);
      this.collide();
      this.fate();
      if (tr.angle >= Math.PI * 2) this.finishTrick("loop");
      this.updateQuat(0);
      return;
    }

    // ---- the air
    const W = this.flow.sample(this.pos.x, this.pos.y, this.pos.z, this.clock, this.air);
    const a = tmp.set(this.vel.x - W.x, this.vel.y - W.y, this.vel.z - W.z);
    let V = a.length();
    this.airspeed = V;
    if (V < 0.2) { e.set(Math.sin(this.heading), -0.2, Math.cos(this.heading)).normalize(); V = 0.2; }
    else e.copy(a).divideScalar(V);
    // on the ground: the stick turns you, and flaring or spreading lets a gust get under you
    if (this.grounded) {
      this.heading -= clamp(input.roll, -1, 1) * 2.2 * dt;
      const ws = Math.hypot(W.x, W.z);
      if ((input.pitch < -0.3 || input.spread) && this.clock - this.lastHop > 0.7) {
        this.lastHop = this.clock;
        this.vel.y = 3.2 + Math.min(4, ws * 0.45) + (input.spread ? 1 : 0);
        this.vel.x += W.x * 0.35 + Math.sin(this.heading) * 1.5;
        this.vel.z += W.z * 0.35 + Math.cos(this.heading) * 1.5;
      }
    }
    // in the air, the nose follows the path through the air (weathervane)
    const eh = Math.hypot(e.x, e.z);
    if (!this.grounded && eh > 0.15) {
      const want = Math.atan2(e.x, e.z);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 5 * eh);
    }
    // lift: perpendicular to the path, tilted by the bank (right of travel is e x up)
    up.set(0, 1, 0);
    lift.copy(up).addScaledVector(e, -e.y);
    if (lift.lengthSq() < 1e-4) lift.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(-Math.sign(e.y));
    lift.normalize();
    side.crossVectors(e, lift).normalize();
    lift.multiplyScalar(Math.cos(this.bank)).addScaledVector(side, Math.sin(this.bank));

    let load = T.wingLoad * (0.7 + 0.3 * this.integrity), cd0 = T.cd0 + torn * 0.08, clMax = 9;
    if (input.spread) { load *= T.spreadLoad; cd0 = T.spreadCd; }
    if (input.curl) { load *= T.curlLoad; cd0 = T.curlCd; clMax = T.curlCl; }
    const al = this.alpha;
    let cl = T.clAlpha * al;
    if (al > T.stall) cl = T.clAlpha * T.stall * Math.max(0.35, 1 - (al - T.stall) * 3);
    cl = Math.min(cl, clMax) * (0.75 + 0.25 * this.integrity);
    const cd = cd0 + T.kInduced * cl * cl + (al > T.stall ? (al - T.stall) * 1.5 : 0);
    const qa = 0.5 * T.rho * V * V * load; // per unit mass
    // a leaf can't pull hard turns: lift is capped at a couple of g, while drag (what carries
    // a leaf off with a gust) can be much larger
    const drill = this.trick?.kind === "corkscrew" ? 0.45 : 1; // a spinning leaf is a drill: half the drag
    const liftA = Math.min(qa * cl, T.maxLift) * (drill < 1 ? 0.3 : 1), dragA = Math.min(qa * cd, T.maxAccel) * drill;
    F.copy(lift).multiplyScalar(liftA).addScaledVector(e, -dragA);
    this.vel.addScaledVector(F, dt);
    this.vel.y -= T.g * dt;

    // ---- layer drops pay
    const lane = this.air.lane;
    if (lane !== this.lane) {
      const vy = -this.vel.y;
      if (this.lane === "roof" && lane === "street" && vy > 2) {
        this.dropFromRoofAt = this.clock;
        this.kick(vy * T.dropRoofStreet, "Dropped to the street");
      } else if (this.lane === "street" && lane === "subway" && vy > 1.2) {
        const chain = this.clock - this.dropFromRoofAt < 2.5;
        this.kick(Math.max(4, vy) * T.dropStreetSubway * (chain ? T.dropChain : 1), chain ? "Roof to subway!" : "Into the subway");
      }
      this.lane = lane;
    }

    if (this.trick?.kind === "corkscrew") {
      const tr = this.trick;
      tr.angle += dt * Math.PI * 2 / 0.55;
      this.spin = tr.angle * tr.dir;
      if (tr.angle >= Math.PI * 2) {
        // out of the spin with a little burst along the way you're going
        const h = Math.hypot(this.vel.x, this.vel.z) || 1;
        this.vel.x += (this.vel.x / h) * 2.5; this.vel.z += (this.vel.z / h) * 2.5;
        this.finishTrick("corkscrew");
      }
    }
    this.pos.addScaledVector(this.vel, dt);
    this.collide();
    if (this.air.vehicle) this.hitBy("a cab", 0.2);
    if (this.clock - this.lastHit > T.healDelay && this.integrity < this.maxIntegrity) this.integrity = Math.min(this.maxIntegrity, this.integrity + T.heal * dt);
    if (this.air.train) this.fail("Flattened by a train");
    this.fate();
    this.updateQuat(0);
  }

  private finishTrick(kind: "corkscrew" | "loop") {
    this.tricks[kind]++;
    this.tricks.last = kind;
    this.tricks.lastAt = this.clock;
    this.trick = null;
    this.spin = 0;
    this.flip = 0;
  }

  private kick(amount: number, kind: string) {
    // along the way you're going (or along the tunnel / canyon wind)
    const hx = this.vel.x + this.air.x * 0.5, hz = this.vel.z + this.air.z * 0.5;
    const L = Math.hypot(hx, hz) || 1;
    this.vel.x += (hx / L) * amount;
    this.vel.z += (hz / L) * amount;
    this.vel.y *= 0.4;
    this.boost = { t: this.clock, amount, kind };
  }

  private hitBy(what: string, dmg: number) {
    if (this.clock - this.lastHit < 0.6) return;
    this.lastHit = this.clock;
    this.integrity -= dmg;
    this.maxIntegrity -= dmg * FLIGHT.scar;
    this.events.push(`t${this.time.toFixed(1)} hit by ${what} (y ${this.pos.y.toFixed(1)}) -> ${this.integrity.toFixed(2)}`);
    this.vel.y = Math.max(this.vel.y, 0) + 6; // flung up out of the traffic
    if (this.integrity <= 0) this.fail(`Hit by ${what}`);
  }

  // ------------------------------------------------------------------ collisions
  private contact(nx: number, ny: number, nz: number, depth: number, what: string) {
    this.pos.x += nx * depth; this.pos.y += ny * depth; this.pos.z += nz * depth;
    const vn = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
    if (vn >= 0) return;
    if (this.trick) { this.trick = null; this.spin = 0; this.flip = 0; }
    const impact = -vn;
    // settling onto the ground is gentle; walls and ceilings are what tear a leaf
    const safe = ny > 0.7 ? 14 : FLIGHT.safeImpact; // settling onto the ground barely hurts
    if (impact > safe && this.clock - this.lastHit > 0.15) {
      this.lastHit = this.clock;
      const dmg = (impact - safe) * FLIGHT.damage;
      this.integrity -= dmg;
      this.maxIntegrity -= dmg * FLIGHT.scar;
      this.events.push(`t${this.time.toFixed(1)} ${what} at ${impact.toFixed(1)} m/s (wind ${Math.hypot(this.air.x, this.air.z).toFixed(1)} ${this.air.lane}, y ${this.pos.y.toFixed(1)}) -> ${this.integrity.toFixed(2)}`);
      if (this.integrity <= 0) this.fail(`Torn apart on ${what}`);
    }
    this.vel.x -= 1.2 * vn * nx; this.vel.y -= 1.2 * vn * ny; this.vel.z -= 1.2 * vn * nz;
    const f = Math.exp(-(ny > 0.7 ? 2.5 : 1) * this.dtNow);
    this.vel.x *= f; this.vel.z *= f;
    if (ny > 0.7) this.grounded = true;
  }

  private collide() {
    const p = this.pos, r = FLIGHT.radius;
    this.grounded = false;
    // buildings: push out through the nearest wall, or up onto the roof
    for (const b of this.city.bgrid.around(p.x, p.z, 1, this.bl)) {
      if (p.y > b.h + r || p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) continue;
      const inside = inPoly(b.poly, p.x, p.z);
      const ed = nearestEdge(b.poly, p.x, p.z);
      if (inside) {
        const toRoof = b.h + r - p.y;
        if (toRoof < ed.d + r) this.contact(0, 1, 0, toRoof, "a rooftop");
        else this.contact(ed.nx, 0, ed.nz, ed.d + r, "a wall");
      } else if (ed.d < r && p.y < b.h) {
        this.contact(ed.nx, 0, ed.nz, r - ed.d, "a wall");
      }
    }
    // the street, unless there's a hole in it
    const u = this.flow.under;
    const hole = u.openingAt(p.x, p.z);
    if (!hole && p.y < r && p.y > -0.6) this.contact(0, 1, 0, r - p.y, "the pavement");
    // underground: stay inside the air
    if (p.y < 0.3 && (hole || p.y < -0.6)) {
      const d = u.sdf(p.x, p.y, p.z);
      if (d < r) {
        const h = 0.05;
        const gx = u.sdf(p.x + h, p.y, p.z) - u.sdf(p.x - h, p.y, p.z);
        const gy = u.sdf(p.x, p.y + h, p.z) - u.sdf(p.x, p.y - h, p.z);
        const gz = u.sdf(p.x, p.y, p.z + h) - u.sdf(p.x, p.y, p.z - h);
        const gl = Math.hypot(gx, gy, gz) || 1;
        if (d < -3) { this.fail("Buried under the street"); return; }
        this.contact(gx / gl, gy / gl, gz / gl, r - d, d < -1 ? "the tunnel" : "the tunnel wall");
      }
    }
  }

  private fate() {
    const p = this.pos;
    const life = this.flow.life;
    if (p.y < 0.35 && p.y > -0.2) {
      if (life.puddleAt(p.x, p.z)) this.fail("Soaked in a puddle");
      else if (life.manholeAt(p.x, p.z)) this.fail("Lost down a manhole");
    }
    if (p.y < -1.2 && p.y > -3 && !this.flow.under.openingAt(p.x, p.z) && !this.city.onLand(p.x, p.z)) this.fail("Swallowed by the harbour");
    if (p.y < -12) this.fail("Lost in the dark");
  }

  fail(reason: string) {
    if (this.state !== "flying") return;
    this.state = "dead";
    this.failure = reason;
  }

  plant() { if (this.state === "flying") this.state = "planted"; }
}
