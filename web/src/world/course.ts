// The course: where the last tree stands in Battery Park, and where the seed can be
// planted (open ground in Sheep Meadow: a tree can't grow on top of another tree).
// Shared by the game and the headless test pilots so both run the same course.

import { inRing, Polyline, type CityData } from "./data";

export interface Course {
  tree: { x: number; z: number };
  start: { x: number; y: number; z: number; heading: number };
  inMeadow: (x: number, z: number) => boolean;
  /** The way through along the streets, tree to meadow (the route line itself is smoothed through the
   *  districts and runs through buildings in places): for steering by, the minimap's guide, the pilots. */
  path: Polyline;
}

/** Shortest way along the street centrelines from the street nearest the route's start to the one nearest its
 *  end, kept close to the route (each metre costs more the further it strays from it). */
/** shift: keep to the route's left (negative, metres) or right instead of on it (alternative ways through) */
export function streetPath(city: CityData, from: { x: number; z: number }, to: { x: number; z: number }, shift = 0): Polyline {
  const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const nodes = new Map<string, number>(), xs: number[] = [], zs: number[] = [];
  const adj: { to: number; cost: number; pts: number[] }[][] = [];
  const node = (x: number, z: number) => {
    const k = key(x, z);
    let i = nodes.get(k);
    if (i === undefined) { i = xs.length; nodes.set(k, i); xs.push(x); zs.push(z); adj.push([]); }
    return i;
  };
  for (const st of city.raw.streets) {
    const p = st.p, n = p.length / 2;
    if (n < 2) continue;
    const a = node(p[0], p[1]), b = node(p[p.length - 2], p[p.length - 1]);
    let cost = 0;
    for (let i = 0; i < n - 1; i++) {
      const mx = (p[i * 2] + p[i * 2 + 2]) / 2, mz = (p[i * 2 + 1] + p[i * 2 + 3]) / 2;
      const L = Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]);
      const n = city.route.nearest(mx, mz);
      const away = shift ? Math.abs(n.off - shift) : n.d;
      cost += L * (1 + (away / 60) ** 2);
    }
    adj[a].push({ to: b, cost, pts: p });
    const rev: number[] = [];
    for (let i = n - 1; i >= 0; i--) rev.push(p[i * 2], p[i * 2 + 1]);
    adj[b].push({ to: a, cost, pts: rev });
  }
  const nearest = (x: number, z: number) => { let bi = 0, bd = Infinity; for (let i = 0; i < xs.length; i++) { const d = Math.hypot(xs[i] - x, zs[i] - z); if (d < bd) { bd = d; bi = i; } } return bi; };
  const s0 = nearest(from.x, from.z), s1 = nearest(to.x, to.z);
  const dist = new Float64Array(xs.length).fill(Infinity), prev = new Int32Array(xs.length).fill(-1), via: (number[] | null)[] = new Array(xs.length).fill(null);
  dist[s0] = 0;
  const open = new Set([s0]);
  while (open.size) {
    let u = -1, du = Infinity;
    for (const i of open) if (dist[i] < du) { du = dist[i]; u = i; }
    open.delete(u);
    if (u === s1) break;
    for (const e of adj[u]) if (du + e.cost < dist[e.to]) { dist[e.to] = du + e.cost; prev[e.to] = u; via[e.to] = e.pts; open.add(e.to); }
  }
  if (prev[s1] < 0) return city.route;
  const chain: number[][] = [];
  for (let v = s1; v !== s0; v = prev[v]) chain.push(via[v]!);
  const flat: number[] = [from.x, from.z];
  for (let k = chain.length - 1; k >= 0; k--) flat.push(...chain[k]);
  flat.push(to.x, to.z);
  // (a Polyline's points are evenly spaced: resample every 4 m)
  const even: number[] = [flat[0], flat[1]];
  let carry = 0;
  for (let i = 0; i < flat.length / 2 - 1; i++) {
    const ax = flat[i * 2], az = flat[i * 2 + 1], bx = flat[i * 2 + 2], bz = flat[i * 2 + 3], L = Math.hypot(bx - ax, bz - az);
    let d = 4 - carry;
    for (; d <= L; d += 4) even.push(ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L);
    carry = L - (d - 4);
  }
  return new Polyline(even, 4);
}

export function makeCourse(city: CityData): Course {
  const parks = (re: RegExp) => city.raw.parks.filter((p) => re.test(p.n)).map((p) => p.p[0]);
  const battery = parks(/Battery Park/);
  const meadow = parks(/Sheep Meadow/);
  const inAny = (rings: number[][], x: number, z: number) => rings.some((r) => inRing(r, x, z));
  // the route starts at the old fort: find open lawn nearby
  let tree = { x: city.route.at(0).x, z: city.route.at(0).z };
  search: for (let s = 30; s < 400; s += 10) for (const off of [0, 12, -12, 24, -24, 36, -36]) {
    const p = city.route.at(s);
    const x = p.x + p.tz * off, z = p.z - p.tx * off;
    if (inAny(battery, x, z) && city.canopy(x, z, 18) < 1) { tree = { x, z }; break search; }
  }
  // Sheep Meadow: the open data's outline of it is broken (it spans the meadow but encloses only a sliver),
  // so the whole lawn counts, the same open ground render/centralPark.ts and ground.ts keep clear
  const inMeadow = (x: number, z: number) => (x > 430 && x < 730 && z > 8290 && z < 8565) || inAny(meadow, x, z);
  const rs = city.route.nearest(tree.x, tree.z);
  const ahead = city.route.at(rs.s + 30);
  const heading = Math.atan2(ahead.x - tree.x, ahead.z - tree.z);
  return {
    path: streetPath(city, tree, { x: 580, z: 8420 }),
    tree,
    start: { x: tree.x + Math.sin(heading) * 4.2, y: 7.6, z: tree.z + Math.cos(heading) * 4.2, heading },
    inMeadow,
  };
}
