// Blockers: places where the street layer is closed, forcing a layer change (over the
// roofs or under through the subway). Each one closes every street that enters an area
// with a barrier at its edge. One per section, all very late November:
//   FiDi        a water main break on Broadway: a curtain of spray across the street
//   Chinatown   the Mulberry Street festival: curtains of lanterns
//   Union Sq    the holiday market: rows of stalls under strings of lights
//   Midtown     Times Square packed solid: police barriers and crowds
//   Columbus    the Thanksgiving parade: barriers, crowds, and a giant balloon overhead
// Roofs and tunnels stay open.

import type { CityData } from "./data";
import { project } from "./landmarks";

export type BlockerKind = "festival" | "crowd" | "water" | "market" | "parade";

export interface Barrier {
  blocker: string;
  kind: BlockerKind;
  /** the barrier is a vertical rectangle: centre, direction across the street, half width, height */
  x: number; z: number; ax: number; az: number; half: number; height: number;
  /** its normal, pointing out of the closed area */
  nx: number; nz: number;
}

export interface Blocker { id: string; name: string; hint: string; x: number; z: number; r: number; height: number; kind: BlockerKind }

/** A parade balloon: a big bouncy sphere hanging over the street (y is its centre). */
export interface Balloon { x: number; y: number; z: number; r: number; yaw: number }

/** What a leaf hits at each kind of barrier. */
export const BARRIER_NAME: Record<BlockerKind, string> = {
  festival: "the festival lanterns",
  crowd: "the crowd barriers",
  water: "the burst water main",
  market: "the market stalls",
  parade: "the parade barriers",
};

export class Blockers {
  readonly list: Blocker[];
  readonly barriers: Barrier[] = [];
  readonly balloons: Balloon[] = [];

  constructor(city: CityData) {
    const [fx, fz] = project(city, 40.7178, -73.9978); // Mulberry & Hester
    const ts = city.raw.landmarks.timesSquare;
    const onRoute = (s: number) => { const a = city.route.at(s); return { x: a.x, z: a.z }; };
    const main = onRoute(850), market = project(city, 40.7347, -73.9907), parade = onRoute(7985);
    this.list = [
      { id: "watermain", name: "Water main break on Broadway", hint: "A burst main is spraying across the street. Climb over it on the roofs, or duck into the subway.", ...main, r: 70, height: 9, kind: "water" },
      { id: "festival", name: "Street festival on Mulberry", hint: "The street's closed for the festival. Over the rooftops, or down into the subway at Canal St.", x: fx, z: fz, r: 120, height: 10, kind: "festival" },
      { id: "market", name: "Union Square Holiday Market", hint: "The market stalls fill the street. Over the roofs, or into the subway at Union Sq.", x: market[0], z: market[1], r: 95, height: 8, kind: "market" },
      { id: "times", name: "Times Square is packed", hint: "Times Square is packed solid. Up over the roofs, or down into the subway.", x: ts[0], z: ts[1], r: 115, height: 7, kind: "crowd" },
      { id: "parade", name: "The Thanksgiving Day Parade", hint: "The parade's coming down to Columbus Circle. Get up over it, and mind the balloon!", ...parade, r: 100, height: 7, kind: "parade" },
    ];
    // the parade balloon floats over the route just inside the barriers
    {
      const s = city.route.nearest(parade.x, parade.z).s;
      const a = city.route.at(s - 40);
      this.balloons.push({ x: a.x, y: 19, z: a.z, r: 6.5, yaw: Math.atan2(a.tx, a.tz) });
    }
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
          this.barriers.push({ blocker: b.id, kind: b.kind, x: cx, z: cz, ax: -tz, az: tx, half: st.w / 2 + 3.5, height: b.height, nx, nz });
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
