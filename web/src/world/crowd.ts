// People on the sidewalks: New Yorkers in winter coats walking both ways along every
// street, deterministic in time like the traffic. Soft obstacles for a leaf: brush past
// someone and you get knocked about a bit (in Central Park the kids try to catch you).

import { Grid } from "./data";
import type { Traffic } from "./traffic";

export interface Walker { chain: number; side: 1 | -1; dir: 1 | -1; s0: number; speed: number; seed: number; h: number; /** a dog on a lead (breed index) */ pet?: number }
export interface WalkerState { x: number; z: number; tx: number; tz: number; w: Walker; phase: number }

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

export class Crowd {
  readonly walkers: Walker[] = [];
  readonly now: WalkerState[] = [];
  readonly grid = new Grid<WalkerState>(16);
  private t = -1;

  constructor(private traffic: Traffic) {
    let id = 7;
    traffic.chains.forEach((c, ci) => {
      for (const side of [1, -1] as const) {
        const n = Math.floor(c.length / 5);
        for (let k = 0; k < n; k++) {
          id++;
          if (h01(id) < 0.15) continue;
          const kid = h01(id * 13) < 0.08;
          this.walkers.push({ chain: ci, side, dir: h01(id * 3) < 0.5 ? 1 : -1, s0: h01(id * 5) * c.length, speed: 1.1 + h01(id * 7) * 0.6, seed: id, h: kid ? 1.15 + h01(id * 11) * 0.2 : 1.6 + h01(id * 11) * 0.3, pet: !kid && h01(id * 17) < 0.12 ? Math.floor(h01(id * 19) * 4) : undefined });
        }
      }
    });
  }

  /** Place the walkers near (x, z) at time t (only those within range: cheap). */
  update(t: number, x: number, z: number, range = 260) {
    if (t === this.t) return;
    this.t = t;
    this.now.length = 0;
    this.grid.clear();
    for (const w of this.walkers) {
      const c = this.traffic.chains[w.chain];
      // quick reject on the chain's first point (chains are a few hundred metres at most)
      if (Math.abs(c.x[0] - x) > range + c.length || Math.abs(c.z[0] - z) > range + c.length) continue;
      const s = ((w.s0 + w.speed * t * w.dir) % c.length + c.length) % c.length;
      let lo = 0, hi = c.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.cum[m] <= s) lo = m; else hi = m; }
      const L = c.cum[hi] - c.cum[lo] || 1, f = (s - c.cum[lo]) / L;
      const tx = (c.x[hi] - c.x[lo]) / L, tz = (c.z[hi] - c.z[lo]) / L;
      const off = (c.width / 2 + 2.4) * w.side;
      const px = c.x[lo] + (c.x[hi] - c.x[lo]) * f - tz * off, pz = c.z[lo] + (c.z[hi] - c.z[lo]) * f + tx * off;
      if (Math.abs(px - x) > range || Math.abs(pz - z) > range) continue;
      const st: WalkerState = { x: px, z: pz, tx: tx * w.dir, tz: tz * w.dir, w, phase: s * 1.6 };
      this.now.push(st);
      this.grid.add(st, px - 1, pz - 1, px + 1, pz + 1);
    }
  }

  /** Someone at (x, y, z)? */
  hit(x: number, y: number, z: number): WalkerState | null {
    for (const p of this.grid.at(x, z)) if (y < p.w.h && Math.hypot(p.x - x, p.z - z) < 0.35) return p;
    return null;
  }
}
