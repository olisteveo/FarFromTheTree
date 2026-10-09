// Central Park's last hazard: kids playing on the way into Sheep Meadow. They wander about
// until a leaf comes down low near them, then run after it, arms out, to catch it. A kid
// who gets you knocks you about and tears you a bit (it won't kill a healthy leaf, but a
// worn one can come apart in their hands). Grown-ups walk dogs along the paths too.
// Stepped with the leaf (Glider.step), so the test pilots meet the same kids.

import type { CityData } from "./data";

export interface Kid {
  homeX: number; homeZ: number;
  x: number; z: number; tx: number; tz: number;
  speed: number; seed: number; h: number;
  chasing: boolean;
  /** wander target and when to pick the next */
  wx: number; wz: number; next: number;
  /** the last time this kid caught the leaf (they cool off after) */
  caught: number;
}

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

export const PARK = {
  /** how close (m) and how low (m) the leaf must be before a kid gives chase */
  notice: 16, low: 3.2,
  run: 3.8, wander: 0.9,
  /** reach: a kid catches a leaf within this distance and below this height */
  reach: 0.75, reachUp: 1.9,
  damage: 0.12,
};

export class Park {
  readonly kids: Kid[] = [];

  /** clear: spots taken by park features (the pond, the rink, rocks), where no kid should stand */
  constructor(private city: CityData, from: number, clear: (x: number, z: number) => boolean = () => false) {
    // kids along the route from the park gate into the meadow, either side of it
    let k = 0;
    for (let s = from + 40; s < city.route.length - 30; s += 22) {
      const a = city.route.at(s);
      for (const side of [-1, 1]) {
        k++;
        if (h01(k * 31) < 0.45) continue;
        const off = side * (6 + h01(k * 7) * 26);
        const x = a.x + a.tz * off, z = a.z - a.tx * off;
        if (city.buildingAt(x, z) || clear(x, z)) continue;
        this.kids.push({ homeX: x, homeZ: z, x, z, tx: 0, tz: 1, speed: 0, seed: 9_000_000 + k, h: 1.1 + h01(k * 13) * 0.3, chasing: false, wx: x, wz: z, next: 0, caught: -99 });
      }
    }
  }

  /** Move the kids for this step; returns the kid who caught the leaf, if one did. */
  step(dt: number, t: number, lx: number, ly: number, lz: number, flying: boolean): Kid | null {
    let got: Kid | null = null;
    for (const c of this.kids) {
      const dx = lx - c.x, dz = lz - c.z, d = Math.hypot(dx, dz);
      const wantChase = flying && ly < PARK.low && d < PARK.notice && t - c.caught > 4 && Math.hypot(c.x - c.homeX, c.z - c.homeZ) < 40;
      c.chasing = wantChase;
      let gx: number, gz: number, sp: number;
      if (wantChase) { gx = lx; gz = lz; sp = PARK.run; }
      else {
        if (t > c.next || Math.hypot(c.wx - c.x, c.wz - c.z) < 0.5) {
          // potter about near home, sometimes stand still
          const r = h01(c.seed * 97 + Math.floor(t * 0.3));
          c.wx = c.homeX + (r - 0.5) * 14; c.wz = c.homeZ + (h01(c.seed * 89 + Math.floor(t * 0.3)) - 0.5) * 14;
          c.next = t + 3 + r * 5;
        }
        gx = c.wx; gz = c.wz; sp = Math.hypot(c.wx - c.x, c.wz - c.z) > 0.6 ? PARK.wander : 0;
      }
      const ex = gx - c.x, ez = gz - c.z, e = Math.hypot(ex, ez);
      // ease the speed so they don't snap from standing to sprinting
      c.speed += (sp - c.speed) * Math.min(1, dt * 3);
      if (e > 0.05 && c.speed > 0.02) {
        c.tx = ex / e; c.tz = ez / e;
        const step = Math.min(e, c.speed * dt);
        const nx = c.x + c.tx * step, nz = c.z + c.tz * step;
        if (!this.city.buildingAt(nx, nz)) { c.x = nx; c.z = nz; }
      }
      if (!got && flying && d < PARK.reach && ly < PARK.reachUp && t - c.caught > 4) { c.caught = t; got = c; }
    }
    return got;
  }
}
