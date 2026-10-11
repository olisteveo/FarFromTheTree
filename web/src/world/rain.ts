// The rain over Central Park: the last squeeze before the meadow. It starts as the leaf comes into
// the park and builds over a few seconds; the leaf soaks it up (faster spread, slower curled) and
// raindrops hammer it; a wet leaf is heavy, and a sodden one tears. Once it has rained a while,
// puddles spread across the paths and drives, and a leaf that comes down in one drowns.
//
// Pure TS, stepped by the leaf (sim/glider.ts) on its own clock, so the game and the headless test
// pilots get the same rain, the same drops and the same puddles. render/rain.ts draws it.

import { Grid, type CityData } from "./data";

export const RAIN = {
  /** seconds for the rain to build to full once you're in the park, and to stop once you're out */
  rampIn: 4, rampOut: 3,
  /** wetness soaked up per second in full rain: normal, spread (a sail: catches it all), curled (a seed) */
  soak: 0.0065, soakSpread: 0.0095, soakCurl: 0.003,
  /** raindrop hits per second in full rain (seeded on the leaf's clock), by shape */
  drops: 0.5, dropsSpread: 0.85, dropsCurl: 0.25,
  /** each hit: wetness added, and integrity lost (x accel above `heavy` wet, ramping to x(1 + accel) at 1) */
  dropWet: 0.005, dropDamage: 0.0065, heavy: 0.7, accel: 3,
  /** a soaked leaf is heavier: wing loading x 1 / (1 + weight * wet); lift x (1 - lift * wet) */
  weight: 0.7, lift: 0.18,
  /** drying per second out of the rain (spread dries faster: it's all surface) */
  dry: 0.012, drySpread: 0.02,
  /** puddles: they start forming after `puddleAfter` s of rain, each starts at a staggered time across
   *  `puddleSpread` s and takes `puddleGrow` s to reach full size */
  puddleAfter: 6, puddleSpread: 20, puddleGrow: 7,
  /** a leaf this low over a puddle (m above the water) is in it */
  puddleDepth: 0.32,
};

export interface Puddle {
  x: number; z: number;
  /** half sizes (m) along (tx, tz) and across it */
  rx: number; rz: number; tx: number; tz: number;
  /** seconds of rain before this one starts to form */
  t0: number;
  seed: number;
}

export interface RainField {
  /** where it rains (the park's bounding box) */
  x0: number; x1: number; z0: number; z1: number;
  puddles: Puddle[];
  grid: Grid<Puddle>;
  inRain(x: number, z: number): boolean;
  /** 0..1: how far this puddle has spread after `rainFor` seconds of rain */
  growth(p: Puddle, rainFor: number): number;
  /** the puddle (if any) under (x, z) after `rainFor` seconds of rain */
  puddleAt(x: number, z: number, rainFor: number): Puddle | null;
}

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

const cache = new WeakMap<object, RainField>();

/** The rain zone and its puddles for a park (bounds from render/centralPark.ts parkLayout). Cached per layout. */
export function rainField(city: CityData, layout: { bounds: { x0: number; x1: number; z0: number; z1: number }; inMeadow: (x: number, z: number) => boolean }): RainField {
  const hit = cache.get(layout);
  if (hit) return hit;
  const { x0, x1, z0, z1 } = layout.bounds;
  const inPark = (x: number, z: number, m = 0) => x > x0 + m && x < x1 - m && z > z0 + m && z < z1 - m;
  // never in the meadow's planting zone, nor on the way in to it: a wide dry margin round the lawn
  const nearMeadow = (x: number, z: number) => x > 430 - 26 && x < 730 + 26 && z > 8290 - 26 && z < 8565 + 26 || layout.inMeadow(x, z);
  const puddles: Puddle[] = [];
  const grid = new Grid<Puddle>(16);
  let k = 0;
  for (const st of city.raw.streets) {
    // footpaths (rw 3, 6) and the park drives (rw 1): the paved ways through the park
    if (st.rw !== 1 && st.rw !== 3 && st.rw !== 6) continue;
    const p = st.p, drive = st.rw === 1;
    const w = drive ? Math.max(7, st.w) : Math.max(3, Math.min(st.w, 8));
    let acc = h01(++k * 7919) * 30;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let d = 0; d < L; d += 1) {
        acc += 1;
        // one every ~26 m of path on average (the drives a little more often: they're wider)
        if (acc < (drive ? 22 : 26)) continue;
        const seed = ++k;
        if (h01(seed * 31) < 0.35) { acc = 10; continue; }
        const x = ax + tx * d, z = az + tz * d;
        // inside the park, clear of its walls and gates and of the meadow
        if (!inPark(x, z, 12) || nearMeadow(x, z)) continue;
        if (city.buildingAt(x, z)) continue;
        acc = 0;
        // off to one side of the path, never more than ~80% of its width: there's always a dry strip
        const rz = Math.min(w * 0.3, 0.8 + h01(seed * 13) * (w * 0.22));
        const rx = rz * (1.3 + h01(seed * 17) * 1.4);
        const side = (h01(seed * 19) - 0.5) * (w * 0.5 - rz) * 1.4;
        const cx = x - tz * side, cz = z + tx * side;
        const pd: Puddle = { x: cx, z: cz, rx, rz, tx, tz, t0: RAIN.puddleAfter + h01(seed * 23) * RAIN.puddleSpread, seed };
        puddles.push(pd);
        grid.add(pd, cx - rx, cz - rx, cx + rx, cz + rx);
      }
    }
  }
  const growth = (pd: Puddle, rainFor: number) => Math.max(0, Math.min(1, (rainFor - pd.t0) / RAIN.puddleGrow));
  const f: RainField = {
    x0, x1, z0, z1, puddles, grid, growth,
    inRain: (x, z) => inPark(x, z),
    puddleAt(x, z, rainFor) {
      if (rainFor < RAIN.puddleAfter) return null;
      for (const pd of grid.at(x, z)) {
        const g = growth(pd, rainFor);
        if (g < 0.15) continue;
        const dx = x - pd.x, dz = z - pd.z;
        const u = (dx * pd.tx + dz * pd.tz) / (pd.rx * g), v = (-dx * pd.tz + dz * pd.tx) / (pd.rz * g);
        // (the drawn puddle's ragged edge goes in to ~0.85 of the ellipse: only the water counts)
        if (u * u + v * v < 0.8) return pd;
      }
      return null;
    },
  };
  cache.set(layout, f);
  return f;
}

/** 0..1 hash on an integer (drop buckets) */
export const rainHash = h01;
