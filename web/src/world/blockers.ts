// Blockers: places where the street layer is closed, forcing a layer change (over the
// roofs or under through the subway). Each one closes every street that enters an area
// with a barrier at its edge: lantern curtains for the Chinatown festival, police barriers
// and packed crowds for Times Square. Roofs and tunnels stay open.

import type { CityData } from "./data";
import { project } from "./landmarks";

export interface Barrier {
  blocker: string;
  /** the barrier is a vertical rectangle: centre, direction across the street, half width, height */
  x: number; z: number; ax: number; az: number; half: number; height: number;
  /** its normal, pointing out of the closed area */
  nx: number; nz: number;
}

export interface Blocker { id: string; name: string; hint: string; x: number; z: number; r: number; height: number; kind: "festival" | "crowd" }

export class Blockers {
  readonly list: Blocker[];
  readonly barriers: Barrier[] = [];

  constructor(city: CityData) {
    const [fx, fz] = project(city, 40.7178, -73.9978); // Mulberry & Hester
    const ts = city.raw.landmarks.timesSquare;
    this.list = [
      { id: "festival", name: "Street festival on Mulberry", hint: "The street's closed for the festival. Over the rooftops, or down into the subway at Canal St.", x: fx, z: fz, r: 120, height: 10, kind: "festival" },
      { id: "times", name: "Times Square is packed", hint: "Times Square is packed solid. Up over the roofs, or down into the subway.", x: ts[0], z: ts[1], r: 115, height: 7, kind: "crowd" },
    ];
    for (const b of this.list) {
      for (const st of city.raw.streets) {
        if (st.rw !== 1) continue;
        const p = st.p;
        for (let k = 0; k < p.length - 2; k += 2) {
          const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
          const da = Math.hypot(ax - b.x, az - b.z) - b.r, db = Math.hypot(bx - b.x, bz - b.z) - b.r;
          if (da * db > 0) continue; // doesn't cross the edge
          const t = da / (da - db);
          const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
          const L = Math.hypot(bx - ax, bz - az) || 1, tx = (bx - ax) / L, tz = (bz - az) / L;
          // normal out of the area
          let nx = tx, nz = tz;
          if ((cx - b.x) * nx + (cz - b.z) * nz < 0) { nx = -nx; nz = -nz; }
          this.barriers.push({ blocker: b.id, x: cx, z: cz, ax: -tz, az: tx, half: st.w / 2 + 3.5, height: b.height, nx, nz });
        }
      }
    }
  }

  /** The blocker area a point is near (for the hint). */
  near(x: number, z: number): Blocker | null {
    for (const b of this.list) if (Math.hypot(x - b.x, z - b.z) < b.r + 60) return b;
    return null;
  }
}
