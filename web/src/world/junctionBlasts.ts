// Junction blasts: where a side street meets the way uptown, its air comes through in hard gusts, a few seconds at a
// time, and blows on down the side street for most of a block before it lets go. Flying straight through at the wrong
// moment puts you down a street you didn't choose. Curl through (the leaf barely catches) or read the streaks and
// time it. Each junction has its own beat, and which way it blows; every run is the same.

import { Grid, type CityData } from "./data";

export interface Blast {
  x: number; z: number; dx: number; dz: number;
  /** how far down the side street it reaches, how wide it is, and how far back across the avenue it starts */
  len: number; half: number; back: number;
  phase: number;
  /** how far along the route it is, 0..1: the city's air gets rougher uptown */
  prog: number;
}

const h01 = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };

/** First stretch of route (the tutorial, Battery Park) and how far a blast can reach. */
const CALM_START = 340, REACH = 85;

export function buildBlasts(city: CityData, closed: { x: number; z: number; r: number }[]): { list: Blast[]; grid: Grid<Blast> } {
  interface Arm { dx: number; dz: number; len: number; w: number; name: string }
  const nodes = new Map<string, { x: number; z: number; arms: Arm[] }>();
  const at = (x: number, z: number) => {
    const k = Math.round(x / 4) + "," + Math.round(z / 4);
    return nodes.get(k) ?? nodes.set(k, { x, z, arms: [] }).get(k)!;
  };
  for (const st of city.raw.streets) {
    if (st.rw !== 1 || st.p.length < 4) continue;
    const n = st.p.length;
    for (const [ax, az, bx, bz] of [[st.p[0], st.p[1], st.p[2], st.p[3]], [st.p[n - 2], st.p[n - 1], st.p[n - 4], st.p[n - 3]]]) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 12) continue;
      at(ax, az).arms.push({ dx: (bx - ax) / L, dz: (bz - az) / L, len: L, w: st.w, name: st.n });
    }
  }
  const list: Blast[] = [], grid = new Grid<Blast>(32);
  let i = 0;
  for (const node of nodes.values()) {
    i++;
    if (new Set(node.arms.map((a) => a.name)).size < 2) continue;
    const near = city.route.nearest(node.x, node.z);
    if (near.s < CALM_START || closed.some((b) => Math.hypot(b.x - node.x, b.z - node.z) < b.r + 20)) continue;
    const rt = city.route.at(near.s);
    const along = node.arms.filter((a) => Math.abs(a.dx * rt.tx + a.dz * rt.tz) > 0.6);
    const sides = node.arms.filter((a) => Math.abs(a.dx * rt.tx + a.dz * rt.tz) < 0.55);
    if (!along.length || !sides.length) continue;
    // one way out per junction, its pick fixed: a tricky street this time is the same tricky street next time
    const side = sides[Math.floor(h01(i, 3) * sides.length) % sides.length];
    const blast: Blast = {
      x: node.x, z: node.z, dx: side.dx, dz: side.dz,
      len: Math.min(REACH, side.len), half: side.w / 2 + 1.5, back: Math.max(...along.map((a) => a.w)) / 2 + 1,
      phase: h01(i, 7) * 6.283, prog: Math.min(1, near.s / city.route.length),
    };
    list.push(blast);
    const px = -blast.dz, pz = blast.dx, ex = blast.x + blast.dx * blast.len, ez = blast.z + blast.dz * blast.len, sx = blast.x - blast.dx * blast.back, sz = blast.z - blast.dz * blast.back;
    const wide = blast.half;
    grid.add(blast, Math.min(sx, ex) - wide - Math.abs(px), Math.min(sz, ez) - wide - Math.abs(pz), Math.max(sx, ex) + wide + Math.abs(px), Math.max(sz, ez) + wide + Math.abs(pz));
  }
  return { list, grid };
}

const smooth = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

/** How hard the blast is at time t, 0..1: a beat of about 16 s, on for around six of them. */
export const blastGust = (b: Blast, t: number) => smooth(0.25, 0.75, Math.sin(t * 0.4 + b.phase));

/** The strength (0..1) of this blast at a point, height aside. */
export function blastAt(b: Blast, x: number, z: number, t: number): number {
  const rx = x - b.x, rz = z - b.z, along = rx * b.dx + rz * b.dz;
  if (along < -b.back || along > b.len) return 0;
  const off = Math.abs(rx * -b.dz + rz * b.dx);
  if (off > b.half) return 0;
  const gust = blastGust(b, t);
  if (gust <= 0) return 0;
  return gust * (1 - smooth(b.len * 0.45, b.len, along)) * (1 - smooth(b.half * 0.7, b.half, off)) * smooth(-b.back, -b.back + 3, along);
}
