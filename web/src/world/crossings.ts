// Where the crosswalk goes on each street arriving at a junction: far enough back to clear the road it crosses, so
// crosswalks at a corner sit beside each other instead of on top of each other. render/ground.ts paints them here and
// world/roadNet.ts stops the traffic behind them. Distances are from the centre of the junction, along the street.

import { Grid, type CityData } from "./data";

/** half the crosswalk's depth along the street */
export const CROSSWALK_DEPTH = 1.6;
/** how far behind the crosswalk's centre the stop line is */
export const STOP_LINE_BACK = 2.6;
const KERB_CLEAR = 1.0, NEAREST = 5, FURTHEST = 24;

interface End { x: number; z: number; tx: number; tz: number; w: number; name: string }

export class Crossings {
  private ends = new Grid<End>(16);

  constructor(city: CityData) {
    for (const st of city.raw.streets) {
      if (st.rw !== 1 || st.p.length < 4) continue;
      const n = st.p.length;
      for (const [x, z, nx, nz] of [[st.p[0], st.p[1], st.p[2], st.p[3]], [st.p[n - 2], st.p[n - 1], st.p[n - 4], st.p[n - 3]]]) {
        const L = Math.hypot(nx - x, nz - z) || 1;
        this.ends.add({ x, z, tx: (nx - x) / L, tz: (nz - z) / L, w: st.w, name: st.n }, x - 1, z - 1, x + 1, z + 1);
      }
    }
  }

  /** The crosswalk's centre, in metres back from a junction at (x, z), on a street called `name` leaving it along (tx, tz). */
  setback(x: number, z: number, name: string, tx: number, tz: number): number {
    let d = NEAREST;
    for (const e of this.ends.around(x, z, 5, [])) {
      if (e.name === name || Math.hypot(e.x - x, e.z - z) > 4) continue;
      // meeting at a shallow angle, the other road's edge is further along this one
      const across = Math.max(0.35, Math.abs(tx * e.tz - tz * e.tx));
      d = Math.max(d, (e.w / 2 + KERB_CLEAR) / across + CROSSWALK_DEPTH);
    }
    return Math.min(FURTHEST, d);
  }
}
