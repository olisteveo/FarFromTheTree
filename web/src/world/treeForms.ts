// The shapes of New York's street trees, shared by what's drawn (render/streetTrees.ts) and what the leaf hits: each
// species is a recipe for growing branches, and the same seed grows the same tree in both. Bare, as the story has them.

import type { CityData } from "./data";
import { Grid } from "./data";

export interface Species {
  name: string;
  /** how much of the city's planting this is */
  share: number;
  /** clear trunk before it forks, and its radius */
  trunk: number; radius: number;
  /** branch length, how much it shrinks each fork, how far forks splay, how much they keep reaching up, and sag */
  reach: number; shrink: number; splay: number; rise: number; droop: number;
  /** forking depth, and the branches per fork */
  depth: number; kids: number;
  /** a central leader carries on up through the crown (oaks, pears) instead of the trunk dividing */
  leader: boolean;
  /** bark colours: base, and the patches over it */
  bark: number; patch: number; patchShare: number;
  /** hung from the twigs in winter */
  fruit?: "balls" | "pods";
  /** a young tree, still staked */
  staked?: boolean;
  /** cut back every year to knuckled stubs */
  pollard?: boolean;
}

export const SPECIES: Species[] = [
  // tall and broad, the bark flaking to olive and cream, seed balls hanging on all winter
  { name: "london plane", share: 0.26, trunk: 3.6, radius: 0.27, reach: 3.3, shrink: 0.72, splay: 0.62, rise: 0.15, droop: 0.05, depth: 4, kids: 3, leader: false, bark: 0x57574a, patch: 0x8f8c76, patchShare: 0.4, fruit: "balls" },
  // low fork, wide flat top, fine lacy twigs, long dark pods
  { name: "honey locust", share: 0.2, trunk: 2.3, radius: 0.16, reach: 2.9, shrink: 0.74, splay: 0.82, rise: -0.02, droop: 0.1, depth: 5, kids: 2, leader: false, bark: 0x2f2925, patch: 0x241f1c, patchShare: 0.3, fruit: "pods" },
  // a tight upright teardrop, everything reaching up
  { name: "callery pear", share: 0.16, trunk: 1.9, radius: 0.14, reach: 2, shrink: 0.76, splay: 0.3, rise: 0.55, droop: 0, depth: 5, kids: 2, leader: true, bark: 0x3b3531, patch: 0x2c2724, patchShare: 0.35 },
  // a straight spire, the lower branches sweeping down
  { name: "pin oak", share: 0.12, trunk: 1.8, radius: 0.2, reach: 3, shrink: 0.7, splay: 1.25, rise: -0.12, droop: 0.2, depth: 4, kids: 2, leader: true, bark: 0x46413c, patch: 0x38332f, patchShare: 0.3 },
  // sparse and awkward, a few stiff ascending limbs, pale furrowed bark
  { name: "ginkgo", share: 0.1, trunk: 2.6, radius: 0.15, reach: 2.7, shrink: 0.72, splay: 0.5, rise: 0.3, droop: 0, depth: 3, kids: 2, leader: true, bark: 0x5c554b, patch: 0x4a443b, patchShare: 0.45 },
  // the vase: limbs fanning out and up from one point, then arching over
  { name: "elm", share: 0.07, trunk: 2.8, radius: 0.24, reach: 3.6, shrink: 0.73, splay: 0.42, rise: 0.25, droop: 0.32, depth: 4, kids: 3, leader: false, bark: 0x4a4038, patch: 0x3b332c, patchShare: 0.35 },
  // planted this year: a whip on two stakes
  { name: "sapling", share: 0.05, trunk: 1.7, radius: 0.045, reach: 0.95, shrink: 0.74, splay: 0.42, rise: 0.4, droop: 0, depth: 3, kids: 2, leader: true, bark: 0x54473a, patch: 0x463b30, patchShare: 0.2, staked: true },
  // cut back hard every year: thick arms ending in fists
  { name: "pollard", share: 0.04, trunk: 3, radius: 0.24, reach: 1.9, shrink: 0.62, splay: 0.72, rise: 0.25, droop: 0, depth: 2, kids: 3, leader: false, bark: 0x4f4d42, patch: 0x7f7c68, patchShare: 0.38, pollard: true },
];

export const KEEP_RUN = 0.72; // how often a tree is the kind planted on its stretch of street

export const VARIANTS = 2;
const hash = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };

type V = [number, number, number];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface Limb { a: V; b: V; r0: number; r1: number; sides: number; patch: boolean }
export interface TreeForm { limbs: Limb[]; fists: { at: V; r: number }[]; fruit: { at: V; len: number; spin: number; tilt: number }[] }

export function growForm(sp: Species, seed: number): TreeForm {
  let sd = seed * 7919 + 13;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const form: TreeForm = { limbs: [], fists: [], fruit: [] };
  const limb = (a: V, b: V, r0: number, r1: number, sides: number) => form.limbs.push({ a, b, r0, r1, sides, patch: rnd() < sp.patchShare });
  const branch = (from: V, dir: V, len: number, rad: number, depth: number) => {
    // a limb is two lengths with a bend, so it's never a straight stick
    const bend = norm(add(dir, [(rnd() - 0.5) * 0.28, -sp.droop * (1 + (sp.depth - depth) * 0.4) * 0.28, (rnd() - 0.5) * 0.28]));
    const mid = add(from, dir, len * 0.5), end = add(mid, bend, len * 0.5);
    const rEnd = Math.max(0.006, rad * sp.shrink);
    limb(from, mid, rad, (rad + rEnd) / 2, depth >= sp.depth - 1 ? 5 : 3);
    limb(mid, end, (rad + rEnd) / 2, rEnd, depth >= sp.depth - 1 ? 5 : 3);
    if (depth === 0) {
      if (sp.pollard) form.fists.push({ at: end, r: rad * 2.1 });
      else if (sp.fruit && rnd() < 0.5) form.fruit.push({ at: end, len: sp.fruit === "balls" ? 0.16 + rnd() * 0.12 : 0.28 + rnd() * 0.22, spin: rnd() * 6.28, tilt: rnd() - 0.5 });
      return;
    }
    const fan = rnd() * 6.28;
    for (let i = 0; i < sp.kids; i++) {
      const a = fan + (i / sp.kids) * 6.28 + (rnd() - 0.5) * 0.7;
      const splay = sp.splay * (0.7 + rnd() * 0.6);
      const d = add([bend[0] * Math.cos(splay), bend[1] * Math.cos(splay) + sp.rise, bend[2] * Math.cos(splay)], [Math.cos(a), 0, Math.sin(a)], Math.sin(splay));
      branch(end, norm(d), len * sp.shrink * (0.82 + rnd() * 0.3), rad * sp.shrink * (i === 0 ? 1 : 0.86), depth - 1);
    }
    // the leader carries on, thinner, straight up the middle
    if (sp.leader) branch(end, norm([bend[0] * 0.35, bend[1] * 0.35 + 1, bend[2] * 0.35]), len * (sp.shrink + 0.08), rad * (sp.shrink + 0.04), depth - 1);
  };
  // the trunk, with a slight lean
  const lean = norm([(rnd() - 0.5) * 0.09, 1, (rnd() - 0.5) * 0.09]);
  const top: V = [lean[0] * sp.trunk, lean[1] * sp.trunk, lean[2] * sp.trunk];
  limb([0, 0, 0], top, sp.radius, sp.radius * 0.8, sp.radius > 0.1 ? 7 : 5);
  if (sp.leader) branch(top, lean, sp.reach, sp.radius * 0.72, sp.depth);
  else {
    const first = sp.kids + 1, fan = rnd() * 6.28;
    for (let i = 0; i < first; i++) {
      const a = fan + (i / first) * 6.28 + (rnd() - 0.5) * 0.5, s = sp.splay * (0.85 + rnd() * 0.4);
      branch(top, norm([Math.cos(a) * Math.sin(s), Math.cos(s) + sp.rise, Math.sin(a) * Math.sin(s)]), sp.reach * (0.85 + rnd() * 0.3), sp.radius * 0.62, sp.depth - 1);
    }
  }
  return form;
}

export const FORM_SEED = (kind: number, variant: number) => kind * 101 + variant * 37 + 5;

function pickSpecies(r: number): number {
  for (let i = 0; i < SPECIES.length; i++) if ((r -= SPECIES[i].share) < 0) return i;
  return 0;
}

export interface TreeSpot { x: number; z: number; scale: number; street: boolean }

/** Which tree grows at a spot, and how: the same answer for the mesh and the collider. */
export function plant(t: TreeSpot) {
  const ix = Math.round(t.x), iz = Math.round(t.z);
  // a stretch of street is planted with one kind (about 70 m, along the grid)
  const planted = pickSpecies(hash(Math.floor(t.x / 70), Math.floor(t.z / 70) + 7));
  const kind = t.street && hash(ix, iz) < KEEP_RUN ? planted : pickSpecies(hash(iz, ix + 3));
  const variant = Math.floor(hash(ix * 3, iz * 5) * VARIANTS);
  // height varies far more than breadth does: same tree, different ages
  const age = t.scale * (0.86 + hash(ix, 91) * 0.3);
  return { kind, variant, age, tall: age * (0.92 + hash(Math.round(t.x * 3), 5) * 0.2), yaw: hash(iz, 17) * 6.28, guard: t.street && hash(Math.floor(t.x / 70) + 3, Math.floor(t.z / 70)) < 0.45 };
}

const inRing = (r: number[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/** Every tree outside Central Park (which plants its own): the data's street trees, and scattered through the small parks. */
export function treeSpots(city: CityData, skip?: (x: number, z: number) => boolean): TreeSpot[] {
  const spots: TreeSpot[] = [], t = city.raw.trees;
  for (let i = 0; i < t.length; i += 3) spots.push({ x: t[i], z: t[i + 1], scale: 0.75 + Math.min(1.1, t[i + 2] / 20), street: true });
  let sd = 99;
  const rnd = () => ((sd = (Math.imul(sd, 16807) >>> 0) % 2147483647) / 2147483647);
  for (const p of city.raw.parks) {
    const r = p.p[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, area = 0;
    for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); z0 = Math.min(z0, r[k + 1]); z1 = Math.max(z1, r[k + 1]); const n = (k + 2) % r.length; area += r[k] * r[n + 1] - r[n] * r[k + 1]; }
    if (/Sheep Meadow/.test(p.n)) continue; // the open meadow: the place to plant
    const n = Math.min(900, Math.abs(area / 2) / 260);
    for (let k = 0; k < n; k++) {
      const x = x0 + (x1 - x0) * rnd(), z = z0 + (z1 - z0) * rnd();
      if (!city.raw.parks.some((q) => /Sheep Meadow/.test(q.n) && inRing(q.p[0], x, z)) && inRing(r, x, z)) spots.push({ x, z, scale: 0.9 + rnd() * 0.9, street: false });
    }
  }
  return skip ? spots.filter((s) => !skip(s.x, s.z)) : spots;
}

// ---------------------------------------------------------------- what the leaf hits
// One entry a tree, tested in its own space against its form's limbs (the thick ones: twigs give way), so the whole
// city's trees cost a few bytes each rather than a capsule per branch.

const SOLID_LIMB = 0.03;
/** Limbs as flat runs of ax ay az bx by bz r, thickest first. */
const FORMS: Float32Array[][] = SPECIES.map((sp, s) => Array.from({ length: VARIANTS }, (_, v) => {
  const form = growForm(sp, FORM_SEED(s, v));
  const out: number[] = [];
  for (const l of form.limbs) if (l.r0 >= SOLID_LIMB) out.push(...l.a, ...l.b, (l.r0 + l.r1) / 2);
  for (const f of form.fists) out.push(...f.at, ...f.at, f.r);
  return new Float32Array(out);
}));
const REACH = FORMS.map((vs) => Math.max(...vs.map((a) => { let m = 0; for (let i = 0; i < a.length; i += 7) m = Math.max(m, Math.hypot(a[i + 3], a[i + 5])); return m; })));

export interface TreeSolid { x: number; z: number; age: number; tall: number; c: number; s: number; limbs: Float32Array; guard: boolean; top: number }

export function treeSolids(spots: TreeSpot[]): Grid<TreeSolid> {
  const g = new Grid<TreeSolid>(16);
  for (const t of spots) {
    const k = plant(t), limbs = FORMS[k.kind][k.variant], R = REACH[k.kind] * k.age + 1;
    let top = 0;
    for (let i = 0; i < limbs.length; i += 7) top = Math.max(top, limbs[i + 1], limbs[i + 4]);
    g.add({ x: t.x, z: t.z, age: k.age, tall: k.tall, c: Math.cos(k.yaw), s: Math.sin(k.yaw), limbs, guard: k.guard, top: top * k.tall + 1 }, t.x - R, t.z - R, t.x + R, t.z + R);
  }
  return g;
}

/** Push-out against the limbs near (x, y, z): calls hit with the way out, as collideParkColliders does. */
export function collideTrees(grid: Grid<TreeSolid>, x: number, y: number, z: number, r: number, hit: (nx: number, ny: number, nz: number, depth: number, name: string) => void) {
  for (const t of grid.at(x, z)) {
    if (y > t.top) continue;
    const wx = x - t.x, wz = z - t.z;
    // the iron guard round the bed, squared up with the street grid
    if (t.guard && y < 0.62 + r && Math.abs(wx) < 0.72 + r && Math.abs(wz) < 0.72 + r && Math.max(Math.abs(wx), Math.abs(wz)) > 0.5) {
      const ox = 0.72 + r - Math.abs(wx), oz = 0.72 + r - Math.abs(wz);
      if (ox < oz) hit(Math.sign(wx) || 1, 0, 0, ox, "a tree guard"); else hit(0, 0, Math.sign(wz) || 1, oz, "a tree guard");
      continue;
    }
    // the mesh is rotated by yaw about y: undo it and the scale. Three's Y rotation: x' = c x + s z, z' = -s x + c z
    const lx = (t.c * wx - t.s * wz) / t.age, lz = (t.s * wx + t.c * wz) / t.age, ly = y / t.tall;
    const L = t.limbs;
    for (let i = 0; i < L.length; i += 7) {
      const ax = L[i], ay = L[i + 1], az = L[i + 2], dx = L[i + 3] - ax, dy = L[i + 4] - ay, dz = L[i + 5] - az, l2 = dx * dx + dy * dy + dz * dz || 1e-9;
      const k = Math.max(0, Math.min(1, ((lx - ax) * dx + (ly - ay) * dy + (lz - az) * dz) / l2));
      const qx = (lx - ax - dx * k) * t.age, qy = (ly - ay - dy * k) * t.tall, qz = (lz - az - dz * k) * t.age, d = Math.hypot(qx, qy, qz);
      const R = L[i + 6] * t.age + r;
      if (d >= R || d < 1e-5) continue;
      const nx = qx / d, ny = qy / d, nz = qz / d;
      hit(t.c * nx + t.s * nz, ny, -t.s * nx + t.c * nz, R - d, "a tree");
      break; // one limb a step: the next step finds any other
    }
  }
}
