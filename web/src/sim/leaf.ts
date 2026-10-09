// The leaf. A thin plate in moving air: no engine, no thrust. The player only
// changes its attitude (pitch, bank, spread or curl) and the air does the rest.
//
//   flat into the wind   -> it catches everything and goes where the wind goes
//   edge into the wind   -> it slices through
//   angled to the wind   -> the force tips sideways or upward: gliding, surfing, take-off
//
// Pure TS with three's maths only, so it runs the same in the browser and in the
// headless test bot (tools/fly.ts).

import { Euler, Quaternion, Vector3 } from "three";
import { clamp, noise1 } from "../core/rng";
import { insideBox, type City } from "../world/city";
import { WORLD, districtAt } from "../world/spec";
import { trainsAt, WindField } from "../world/wind";

export const TUNING = {
  mass: 0.0075,       // kg
  area: 0.03,         // m^2
  normalCoef: 1.6,    // pressure drag on the face
  edgeCoef: 0.09,     // skin friction along the face
  rho: 1.2,
  gravity: 9.81,
  spreadArea: 1.35,
  curlArea: 0.5,
  pitchMax: 0.85,     // rad
  rollMax: 0.95,
  attitudeRate: 5.5,  // how quickly the leaf answers the stick (1/s)
  bankTurn: 1.6,      // yaw rate per radian of bank (rad/s)
  weathervane: 0.9,   // how strongly the nose swings into the airflow
  radius: 0.12,
  restitution: 0.15,
  scrapeDamage: 0.045,
  safeImpact: 4.5,    // m/s you can hit a wall at without tearing
  maxSpeed: 60,
};

export type LeafState = "attached" | "flying" | "dead" | "planted";

export interface LeafInput {
  pitch: number; // +1 dive (W), -1 flare (S)
  roll: number;  // +1 bank right (D)
  spread: boolean;
  curl: boolean;
}

export interface Telemetry {
  speed: number;
  airspeed: number;
  height: number;
  layer: "subway" | "street" | "rooftop" | "sky";
  district: string;
  progress: number;
}

const tmp = new Vector3(), tmp2 = new Vector3(), up = new Vector3();
const euler = new Euler(0, 0, 0, "YXZ");

export class Leaf {
  pos = new Vector3();
  vel = new Vector3();
  q = new Quaternion();
  heading = 0;
  pitch = 0;
  roll = 0;
  integrity = 1;
  state: LeafState = "attached";
  time = 0;      // run time since detaching
  clock = 0;     // world time (trains, gusts) including the wait on the branch
  grounded = false;
  lastHit = 0;
  failure = "";
  readonly windField: WindField;
  readonly windAt = new Vector3();
  readonly airRel = new Vector3();

  constructor(readonly city: City, windField?: WindField) {
    this.windField = windField ?? new WindField(city);
    this.reset();
  }

  reset() {
    const s = WORLD.start;
    this.pos.set(s.x, s.y, s.z);
    this.vel.set(0, 0, 0);
    this.heading = 0;
    this.pitch = 0.1;
    this.roll = 0;
    this.integrity = 1;
    this.state = "attached";
    this.time = 0;
    this.clock = 0;
    this.failure = "";
    this.grounded = false;
    this.updateQuat();
  }

  detach() {
    if (this.state === "attached") this.state = "flying";
  }

  private updateQuat() {
    euler.set(this.pitch, this.heading, this.roll, "YXZ");
    this.q.setFromEuler(euler);
  }

  step(dt: number, input: LeafInput) {
    this.clock += dt;
    if (this.state === "attached") {
      // hanging on the twig, swaying in the breeze
      this.pitch = 0.25 + 0.15 * Math.sin(this.clock * 1.7);
      this.roll = 0.2 * Math.sin(this.clock * 1.1);
      this.updateQuat();
      this.windField.sample(this.pos.x, this.pos.y, this.pos.z, this.clock, this.windAt);
      return;
    }
    if (this.state !== "flying") return;
    this.time += dt;
    const T = TUNING;

    // ---- attitude: chase the stick, with flutter that grows as the leaf tears
    const flutter = (1 - this.integrity) * 0.5 + 0.06;
    const tp = clamp(input.pitch, -1, 1) * T.pitchMax + flutter * noise1(this.clock * 3.1, 1);
    const tr = clamp(input.roll, -1, 1) * T.rollMax + flutter * noise1(this.clock * 2.7, 2);
    const k = 1 - Math.exp(-T.attitudeRate * dt);
    this.pitch += (tp - this.pitch) * k;
    this.roll += (tr - this.roll) * k;

    // ---- the air around the leaf
    const W = this.windField.sample(this.pos.x, this.pos.y, this.pos.z, this.clock, this.windAt);
    this.airRel.set(this.vel.x - W.x, this.vel.y - W.y, this.vel.z - W.z);
    const rel = this.airRel;
    const relH = Math.hypot(rel.x, rel.z);

    // heading: banking turns you, and the nose weathervanes into the oncoming air
    this.heading -= this.roll * T.bankTurn * dt;
    if (relH > 0.4) {
      const want = Math.atan2(rel.x, rel.z); // the direction the leaf is moving through the air
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * clamp(relH / 6, 0, 1) * T.weathervane * dt;
    }
    this.updateQuat();

    // ---- aerodynamic force on a flat plate
    up.set(0, 1, 0).applyQuaternion(this.q);
    const area = T.area * (input.spread ? T.spreadArea : input.curl ? T.curlArea : 1) * (0.55 + 0.45 * this.integrity);
    const speed = rel.length();
    const vn = rel.dot(up);
    const q = 0.5 * T.rho * area * speed;
    // normal force (pressure on the face) and edge friction
    tmp.copy(up).multiplyScalar(-q * T.normalCoef * vn);
    tmp2.copy(rel).addScaledVector(up, -vn).multiplyScalar(-q * T.edgeCoef);
    tmp.add(tmp2);
    // a = F/m + g. A feather-light body is stiff: never let one step's drag do more
    // than most of the relative air speed, or the integration rings.
    const dv = (tmp.length() * dt) / T.mass;
    const lim = speed * 0.85;
    this.vel.addScaledVector(tmp, (dt / T.mass) * (dv > lim && dv > 0 ? lim / dv : 1));
    this.vel.y -= T.gravity * dt;
    const sp = this.vel.length();
    if (sp > T.maxSpeed) this.vel.multiplyScalar(T.maxSpeed / sp);

    this.pos.addScaledVector(this.vel, dt);
    this.collide();
    this.checkFate();
  }

  // ------------------------------------------------------------- collisions
  private hit(nx: number, ny: number, nz: number, depth: number, what: string) {
    this.pos.x += nx * depth; this.pos.y += ny * depth; this.pos.z += nz * depth;
    const vn = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
    if (vn >= 0) return;
    const impact = -vn;
    const T = TUNING;
    if (impact > T.safeImpact && this.time - this.lastHit > 0.15) {
      this.integrity -= (impact - T.safeImpact) * T.scrapeDamage;
      this.lastHit = this.time;
      if (this.integrity <= 0) this.fail(`Torn to shreds against ${what}`);
    }
    this.vel.x -= (1 + T.restitution) * vn * nx;
    this.vel.y -= (1 + T.restitution) * vn * ny;
    this.vel.z -= (1 + T.restitution) * vn * nz;
    const f = ny > 0.7 ? 0.82 : 0.93; // friction along the surface
    this.vel.x *= f; this.vel.z *= f;
    if (ny < 0.7) this.vel.y *= f;
    if (ny > 0.7) this.grounded = true;
  }

  private collide() {
    const p = this.pos, r = TUNING.radius;
    const sw = WORLD.subway;
    this.grounded = false;

    // buildings
    for (const i of this.city.index.boxesNear(p.x, p.z)) {
      const b = this.city.buildings[i];
      if (!insideBox(b, p.x, p.y, p.z, r)) continue;
      // push out along the shallowest face
      const d = [p.x - (b.x0 - r), b.x1 + r - p.x, p.y - (b.y0 - r), b.y1 + r - p.y, p.z - (b.z0 - r), b.z1 + r - p.z];
      let m = 0;
      for (let j = 1; j < 6; j++) if (d[j] < d[m]) m = j;
      const n = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][m];
      this.hit(n[0], n[1], n[2], d[m], m === 3 ? "a rooftop" : "a building");
    }

    // the street, with holes where the subway opens up
    const inTunnelX = Math.abs(p.x - sw.x) < sw.halfWidth;
    const overOpening = this.city.openings.some((o) => p.x > o.x0 && p.x < o.x1 && p.z > o.z0 && p.z < o.z1);
    if (p.y < r && p.y > -0.6 && !overOpening) this.hit(0, 1, 0, r - p.y, "the pavement");
    if (p.y <= -0.6) {
      // underground: you're in a shaft or the tunnel
      if (!inTunnelX && !overOpening) {
        // inside a stair shaft that leads sideways into the tunnel, or into solid ground
        const toward = p.x > sw.x ? -1 : 1;
        if (p.y > sw.ceiling) this.hit(0, 1, 0, -0.6 - p.y + r, "the pavement");
        else this.vel.x += toward * 6 * (1 / 240);
        if (Math.abs(p.x - sw.x) > sw.halfWidth + 6) this.hit(toward, 0, 0, Math.abs(p.x - sw.x) - sw.halfWidth - 6, "the tunnel wall");
      } else {
        if (p.x - sw.x > sw.halfWidth - r && !overOpening) this.hit(-1, 0, 0, p.x - sw.x - (sw.halfWidth - r), "the tunnel wall");
        if (sw.x - p.x > sw.halfWidth - r && !overOpening) this.hit(1, 0, 0, sw.x - p.x - (sw.halfWidth - r), "the tunnel wall");
        if (p.y > sw.ceiling - r && !overOpening) this.hit(0, -1, 0, p.y - (sw.ceiling - r), "the tunnel roof");
      }
      if (p.y < sw.floor + r) this.hit(0, 1, 0, sw.floor + r - p.y, "the tracks");
      // trains
      for (const t of trainsAt(this.clock)) {
        if (p.x > t.x0 - r && p.x < t.x1 + r && p.z > t.z0 && p.z < t.z1 && p.y < sw.ceiling) {
          this.fail(t.dir > 0 ? "Flattened by the uptown train" : "Flattened by the downtown train");
        }
      }
    }
  }

  private checkFate() {
    const p = this.pos;
    const pond = WORLD.pond;
    if (p.y < 0.4 && p.x > pond.x0 && p.x < pond.x1 && p.z > pond.z0 && p.z < pond.z1) this.fail("Sank in the Pond");
    const g = WORLD.goal;
    if (Math.hypot(p.x - g.x, p.z - g.z) < g.radius && p.y < 1.5 && this.state === "flying") {
      this.state = "planted";
    }
  }

  fail(reason: string) {
    if (this.state !== "flying") return;
    this.state = "dead";
    this.failure = reason;
    this.integrity = Math.max(0, this.integrity);
  }

  telemetry(): Telemetry {
    const p = this.pos;
    const h = p.y;
    let layer: Telemetry["layer"] = "street";
    if (h < -0.5) layer = "subway";
    else {
      let roof = 0;
      for (const i of this.city.index.boxesNear(p.x, p.z)) {
        const b = this.city.buildings[i];
        if (p.x > b.x0 - 20 && p.x < b.x1 + 20 && p.z > b.z0 - 20 && p.z < b.z1 + 20) roof = Math.max(roof, b.y1);
      }
      if (h > 140) layer = "sky";
      else if (roof > 0 && h > roof * 0.92) layer = "rooftop";
    }
    const total = WORLD.goal.z - WORLD.start.z;
    return {
      speed: this.vel.length(),
      airspeed: this.airRel.length(),
      height: h,
      layer,
      district: districtAt(p.z).name,
      progress: clamp((p.z - WORLD.start.z) / total, 0, 1),
    };
  }
}
