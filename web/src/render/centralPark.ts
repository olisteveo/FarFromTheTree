// Central Park's south end in late November: The Pond and Gapstow Bridge, Wollman Rink with
// skaters, the schist outcrops (Umpire Rock and friends), the low stone wall along Central Park
// South / Central Park West / Fifth with its gates, the Maine monument at Merchants' Gate,
// Bacon lampposts, World's Fair benches, wire baskets, hot dog carts, the elms of the Mall, and
// bare winter trees (American elm, oak, London plane) with LODs.
//
// Assets: public/models/park_trees.glb + park_props.glb and public/textures/park/* (built by
// tools/park/build_park.py: textures designed in Tesseract, models made in Blender).
//
//   const park = new CentralPark(city);          // starts loading; park.ready resolves when built
//   scene.add(park.root);
//   park.update(focus, t);                      // every frame: distance culling, LODs, skaters, ducks
//   park.colliders                              // solid shapes (see ParkCollider) - available at once
//   park.collide(x, y, z, r, onHit)             // push-out test against them
//
// parkLayout(city) is the pure placement step (no three.js objects, no DOM), so headless code
// (the test pilots) can use the colliders too. Everything is deterministic.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Grid, inRing, type CityData } from "../world/data";

// ================================================================== layout (pure data)

/** Lawn height in the park (ground.ts draws the lawns at 0.12). */
export const PARK_Y = 0.12;
const WATER_Y = 0.17;
const ICE_Y = 0.2;

/** Solid shapes the leaf should hit. All in world metres, y up.
 *  - box:    oriented box. Centre (x, y, z); half sizes hw along (tx, tz), hh up, hd along (nx, nz) = (-tz, tx).
 *  - cyl:    vertical cylinder, radius r, from y0 to y1 (lampposts, trunks, baskets).
 *  - sphere: (lamp globes, the monument's top group).
 *  - dome:   a rock outcrop: an elliptical whaleback, radii rx along (tx, tz) and rz across, its
 *            surface at y(x, z) = y0 + h * (1 - q^2.2)^0.4 where q is the elliptical distance (0 at
 *            the centre, 1 at the rim). Same shape as the rock meshes, minus their noise. */
export type ParkCollider =
  | { kind: "box"; name: string; x: number; y: number; z: number; hw: number; hh: number; hd: number; tx: number; tz: number }
  | { kind: "cyl"; name: string; x: number; z: number; y0: number; y1: number; r: number }
  | { kind: "sphere"; name: string; x: number; y: number; z: number; r: number }
  | { kind: "dome"; name: string; x: number; z: number; y0: number; h: number; rx: number; rz: number; tx: number; tz: number };

export type TreeSpecies = "elm" | "oak" | "plane";
export const TREE_SPECIES: TreeSpecies[] = ["elm", "oak", "plane"];
/** v: which of the species' models (0 or 1), so neighbours don't match */
export interface ParkTree { x: number; z: number; sp: TreeSpecies; s: number; rot: number; v?: number }

export type PropKind = "lamp" | "bench" | "basket" | "cart" | "sitter" | "vendor";
export type RockKind = "rock_big" | "rock_ridge" | "rock_mid" | "rock_small" | "rock_boulder";
export interface Placed { x: number; z: number; rot: number; y?: number; s?: number; v?: number }

/** Footprint radii and heights of the rock meshes (see park_blender.py rock()). */
const ROCKS: Record<RockKind, { rx: number; rz: number; h: number }> = {
  rock_big: { rx: 15, rz: 9.5, h: 4.2 }, rock_ridge: { rx: 11, rz: 3.5, h: 3.4 }, rock_mid: { rx: 6, rz: 4, h: 2.6 },
  rock_small: { rx: 2.25, rz: 1.6, h: 1.5 }, rock_boulder: { rx: 1.1, rz: 0.85, h: 1.2 },
};

export interface ParkLayout {
  bounds: { x0: number; x1: number; z0: number; z1: number };
  trees: ParkTree[];
  props: Record<PropKind, Placed[]>;
  rocks: (Placed & { kind: RockKind })[];
  pond: number[];
  bridge: Placed;
  rink: { x: number; z: number; hx: number; hz: number; r: number; apron: number; house: Placed & { w: number; d: number; h: number } };
  maine: Placed;
  /** low wall runs: [ax, az, bx, bz] */
  walls: [number, number, number, number][];
  /** gate piers */
  piers: Placed[];
  /** the low hoop fence round Sheep Meadow's lawn, and the post-and-rail along the bridle path (2 m / 3 m pieces) */
  fences: { hoop: Placed[]; rail: Placed[] };
  /** the bridle path's segments [ax, az, bx, bz, width]: stone dust, not asphalt */
  bridle: [number, number, number, number, number][];
  colliders: ParkCollider[];
  /** Is this spot taken by a park feature (or the open meadow)? For other scatterers (ground.ts trees). */
  keepClear: (x: number, z: number) => boolean;
  /** Sheep Meadow's open lawn (nothing solid in here). */
  inMeadow: (x: number, z: number) => boolean;
}

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };
function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296); }

/** The Pond (south-east corner) with its northern arm, which Gapstow Bridge crosses at z 7866. */
const POND: number[] = [68, 7806, 78, 7790, 100, 7779, 140, 7773, 185, 7776, 222, 7783, 248, 7795, 256, 7810, 240, 7822, 212, 7830, 196, 7846,
  188, 7860, 188, 7872, 194, 7888, 204, 7904, 196, 7918, 178, 7914, 170, 7898, 174, 7880, 175, 7866, 172, 7850, 160, 7840, 135, 7836, 105, 7830, 82, 7820];

export function parkLayout(city: CityData): ParkLayout {
  const raw = city.raw;
  const big = raw.parks.filter((p) => p.n === "Central Park").sort((a, b) => b.p[0].length - a.p[0].length || 0)
    .map((p) => p.p[0]).reduce((best, r) => (bboxArea(r) > bboxArea(best) ? r : best));
  const bb = bbox(big);
  const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = bb;
  const meadowRings = raw.parks.filter((p) => /Sheep Meadow/.test(p.n)).map((p) => p.p[0]);
  const inMeadow = (x: number, z: number) => (x > 430 && x < 730 && z > 8290 && z < 8565) || meadowRings.some((r) => inRing(r, x, z));
  const inPark = (x: number, z: number) => x > X0 + 1 && x < X1 - 1 && z > Z0 + 1 && z < Z1 - 1;

  // paths and drives inside the park, as segments
  interface Seg { ax: number; az: number; bx: number; bz: number; w: number; drive: boolean }
  const segs: Seg[] = [];
  const sgrid = new Grid<Seg>(32);
  for (const st of raw.streets) {
    const p = st.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      if (!inPark(ax, az) && !inPark(bx, bz)) continue;
      const s: Seg = { ax, az, bx, bz, w: st.rw === 1 ? Math.max(7, st.w) : Math.max(3, Math.min(st.w, 8)), drive: st.rw === 1 };
      segs.push(s);
      sgrid.add(s, Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1);
    }
  }
  const tmp: Seg[] = [];
  /** distance from (x, z) to the nearest path/drive edge (negative = on it) */
  const pathClear = (x: number, z: number, skip?: Seg) => {
    let best = Infinity;
    for (const s of sgrid.around(x, z, 40, tmp)) {
      if (s === skip) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      best = Math.min(best, Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) - s.w / 2);
    }
    return best;
  };

  const colliders: ParkCollider[] = [];
  const box = (name: string, x: number, y: number, z: number, hw: number, hh: number, hd: number, rot = 0) =>
    colliders.push({ kind: "box", name, x, y, z, hw, hh, hd, tx: Math.cos(rot), tz: -Math.sin(rot) });
  const cyl = (name: string, x: number, z: number, y0: number, y1: number, r: number) => colliders.push({ kind: "cyl", name, x, z, y0, y1, r });

  // ---- features at their real places
  const bridge: Placed = { x: 181.5, z: 7866, rot: 0, y: WATER_Y };
  const rink = { x: 250, z: 7978, hx: 32, hz: 20, r: 9, apron: 6, house: { x: 250, z: 8011, rot: 0, w: 46, d: 8, h: 4.6 } };
  const maine: Placed = { x: 846, z: 7787, rot: Math.atan2(882 - 846, 7733 - 7787) };

  // blocked areas, for everything placed after
  type Blob = { x: number; z: number; r: number };
  const blobs: Blob[] = [];
  const pondBox = bbox(POND);
  const inPond = (x: number, z: number, m = 0) => x > pondBox.x0 - m && x < pondBox.x1 + m && z > pondBox.z0 - m && z < pondBox.z1 + m &&
    (inRing(POND, x, z) || (m > 0 && distRing(POND, x, z) < m));
  const inRink = (x: number, z: number, m = 0) => Math.abs(x - rink.x) < rink.hx + rink.apron + m && Math.abs(z - rink.z) < rink.hz + rink.apron + m + 12;
  // a few real buildings stand inside the park (the zoo, the Heckscher buildings): keep clear of them
  const onBuilding = (x: number, z: number, r: number) => {
    if (city.buildingAt(x, z)) return true;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (city.buildingAt(x + Math.cos(a) * (r + 1), z + Math.sin(a) * (r + 1))) return true; }
    return false;
  };
  const blocked = (x: number, z: number, r: number) =>
    !inPark(x, z) || onBuilding(x, z, r) || x < X0 + 4 + r || x > X1 - 4 - r || z < Z0 + 4 + r || inMeadow(x, z) || inPond(x, z, r + 1) || inRink(x, z, r) ||
    Math.hypot(x - maine.x, z - maine.z) < 12 + r || Math.hypot(x - bridge.x, z - bridge.z) < 14 + r || blobs.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r);

  // ---- rocks: Umpire Rock by Heckscher, and the other schist outcrops of the south end
  const rocks: (Placed & { kind: RockKind })[] = [];
  const addRock = (kind: RockKind, x: number, z: number, rot: number, s = 1, force = false) => {
    const R = ROCKS[kind], rr = Math.max(R.rx, R.rz) * s;
    if (!force && (blocked(x, z, rr * 0.6) || pathClear(x, z) < rr * 0.75)) return false;
    rocks.push({ kind, x, z, rot, s });
    blobs.push({ x, z, r: rr * 0.85 });
    colliders.push({ kind: "dome", name: "a rock", x, z, y0: PARK_Y - 0.35, h: R.h * s * 0.92 + 0.35, rx: R.rx * s * 1.05, rz: R.rz * s * 1.05, tx: Math.cos(rot), tz: -Math.sin(rot) });
    return true;
  };
  const r0 = rng(1873);
  const hand: [RockKind, number, number, number][] = [
    ["rock_big", 548, 7962, 0.5], ["rock_ridge", 700, 8060, 1.2], ["rock_ridge", 650, 7860, -0.4], ["rock_mid", 770, 7905, 2.0],
    ["rock_mid", 612, 8212, 0.3], ["rock_mid", 300, 7885, 1.0], ["rock_mid", 480, 7855, 0.7], ["rock_ridge", 390, 7960, 2.4],
    ["rock_mid", 790, 8240, 1.4], ["rock_ridge", 720, 8190, 0.2], ["rock_mid", 420, 8120, 2.8],
  ];
  for (const [k, x, z, rot] of hand) {
    // nudge each outcrop until it sits clear of the paths
    for (let i = 0; i < 40; i++) {
      const a = i * 2.4, d = i * 2.2;
      if (addRock(k, x + Math.cos(a) * d, z + Math.sin(a) * d, rot)) break;
    }
  }
  for (let i = 0; i < 400 && rocks.length < 48; i++) {
    const x = X0 + 10 + r0() * (X1 - X0 - 20), z = Z0 + 10 + r0() * Math.min(900, Z1 - Z0 - 20);
    addRock(r0() < 0.5 ? "rock_small" : "rock_boulder", x, z, r0() * 6.28, 0.8 + r0() * 0.6);
  }
  // boulders on the Pond's banks and around Hallett
  for (let i = 0; i < POND.length; i += 2) {
    if (h01(i * 7) < 0.35) continue;
    const ax = POND[i], az = POND[i + 1], bx = POND[(i + 2) % POND.length], bz = POND[(i + 3) % POND.length];
    const f = h01(i * 13), x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    if (Math.hypot(x - bridge.x, z - bridge.z) < 16) continue;
    rocks.push({ kind: h01(i) < 0.6 ? "rock_boulder" : "rock_small", x, z, rot: h01(i * 3) * 6.28, s: 0.7 + h01(i * 5) * 0.6 });
  }

  // ---- walls along 59th St, CPW and Fifth, with gaps for every path and drive that comes in
  const walls: [number, number, number, number][] = [];
  const piers: Placed[] = [];
  const IN = 0.5; // wall centre inside the park edge
  const crossings = (horizontal: boolean, at: number, lo: number, hi: number) => {
    const gaps: [number, number][] = [];
    for (const st of raw.streets) {
      const p = st.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const a = horizontal ? p[i + 1] : p[i], b = horizontal ? p[i + 3] : p[i + 2];
        if ((a - at) * (b - at) > 0 || a === b) continue;
        const t = (at - a) / (b - a);
        const c = horizontal ? p[i] + (p[i + 2] - p[i]) * t : p[i + 1] + (p[i + 3] - p[i + 1]) * t;
        if (c < lo - 5 || c > hi + 5) continue;
        const half = (st.rw === 1 ? Math.max(st.w, 8) : Math.max(st.w, 3)) / 2 + 1.5;
        gaps.push([c - half, c + half]);
      }
    }
    return gaps;
  };
  const run = (horizontal: boolean, at: number, lo: number, hi: number, extra: [number, number][]) => {
    const gaps = [...crossings(horizontal, at, lo, hi), ...extra].sort((a, b) => a[0] - b[0]);
    let c = lo;
    const seg = (a: number, b: number) => {
      if (b - a < 1.5) return;
      walls.push(horizontal ? [a, at, b, at] : [at, a, at, b]);
      for (const e of [a, b]) piers.push(horizontal ? { x: e, z: at, rot: 0 } : { x: at, z: e, rot: Math.PI / 2 });
    };
    for (const [g0, g1] of gaps) { if (g0 > c) seg(c, Math.min(g0, hi)); c = Math.max(c, g1); if (c >= hi) break; }
    if (c < hi) seg(c, hi);
  };
  run(true, Z0 + IN, X0 + IN, X1 - 74, [[289 - 5, 289 + 5], [538 - 5, 538 + 5]]);          // Central Park South (gates at 6th and 7th Aves)
  run(false, X1 - IN, Z0 + 78, Z1, []);                                                       // Central Park West, from Merchants' Gate up
  run(false, X0 + IN, Z0 + IN, Z1, [[7838 - 5, 7838 + 5]]);                                   // Fifth Avenue (Scholars' Gate at 60th)
  for (const [ax, az, bx, bz] of walls) {
    const L = Math.hypot(bx - ax, bz - az);
    box("the park wall", (ax + bx) / 2, 0.5, (az + bz) / 2, L / 2, 0.5, 0.35, Math.abs(bx - ax) > Math.abs(bz - az) ? 0 : Math.PI / 2);
  }
  for (const p of piers) cyl("a gatepost", p.x, p.z, 0, 1.45, 0.45);

  // ---- trees
  const trees: ParkTree[] = [];
  const tr = rng(4021);
  const addTree = (x: number, z: number, sp: TreeSpecies, s: number, clear = 2.5) => {
    if (blocked(x, z, 1.2) || pathClear(x, z) < clear) return false;
    if (trees.some((t) => Math.abs(t.x - x) < 5 && Math.abs(t.z - z) < 5)) return false;
    trees.push({ x, z, sp, s, rot: tr() * 6.28, v: h01(Math.round(x * 7) * 131 + Math.round(z * 3)) < 0.5 ? 0 : 1 });
    return true;
  };
  const pick = (pElm: number, pOak: number): TreeSpecies => { const r = tr(); return r < pElm ? "elm" : r < pElm + pOak ? "oak" : "plane"; };
  // the perimeter rows just inside the wall
  for (let x = X0 + 8; x < X1 - 70; x += 10.5) addTree(x, Z0 + 6.5, pick(0.55, 0), 0.85 + tr() * 0.25);
  for (let z = Z0 + 82; z < Z1; z += 10.5) addTree(X1 - 6.5, z, pick(0.55, 0), 0.85 + tr() * 0.25);
  for (let z = Z0 + 8; z < Z1; z += 10.5) addTree(X0 + 6.5, z, pick(0.55, 0), 0.85 + tr() * 0.25);
  // the Mall: four rows of American elms
  {
    const ax = 348, az = 8268, bx = 381, bz = 8694, L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
    for (let d = 6; d < L; d += 9.5) for (const off of [-17, -8.5, 8.5, 17]) {
      const x = ax + tx * d - tz * off + (tr() - 0.5), z = az + tz * d + tx * off + (tr() - 0.5);
      addTree(x, z, "elm", 1.0 + tr() * 0.2, 0.8);
    }
  }
  // round the meadow's edge, and through the woods of the south end
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2, x = 580 + Math.cos(a) * 168, z = 8428 + Math.sin(a) * 158;
    addTree(Math.max(434, Math.min(726, x)) + Math.cos(a) * 8, Math.max(8294, Math.min(8561, z)) + Math.sin(a) * 8, pick(0.6, 0.2), 0.85 + tr() * 0.3);
  }
  for (let i = 0; i < 3000 && trees.length < 1000; i++) {
    const x = X0 + 8 + tr() * (X1 - X0 - 16), z = Z0 + 12 + tr() * 860;
    if (inMeadow(x, z)) continue;
    addTree(x, z, pick(0.3, 0.4), 0.75 + tr() * 0.45, 3);
  }
  for (let i = 0; i < 120; i++) addTree(195 + tr() * 95, 7826 + tr() * 85, pick(0.3, 0.35), 0.7 + tr() * 0.4, 1); // Hallett
  for (const t of trees) {
    const trunk = t.sp === "plane" ? 8 : t.sp === "oak" ? 4.6 : 3.8;
    cyl("a tree", t.x, t.z, 0, PARK_Y + trunk * t.s, (t.sp === "elm" ? 0.42 : 0.5) * t.s + 0.05);
  }

  // ---- furniture along the paths (never in the meadow), carts at the gates, people
  const props: Record<PropKind, Placed[]> = { lamp: [], bench: [], basket: [], cart: [], sitter: [], vendor: [] };
  const taken: Blob[] = [];
  const free = (x: number, z: number, r: number) => !blocked(x, z, r) && !taken.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r);
  const pr = rng(77);
  const lampAt = (x: number, z: number) => {
    if (!free(x, z, 0.6)) return;
    props.lamp.push({ x, z, rot: pr() * 6.28 });
    taken.push({ x, z, r: 1 });
    cyl("a lamppost", x, z, 0, PARK_Y + 3.08, 0.13);
    colliders.push({ kind: "sphere", name: "a lamppost", x, y: PARK_Y + 3.4, z, r: 0.28 });
  };
  const benchAt = (x: number, z: number, rot: number, seed: number) => {
    if (!free(x, z, 1.0)) return false;
    props.bench.push({ x, z, rot });
    taken.push({ x, z, r: 1.0 });
    box("a bench", x, PARK_Y + 0.45, z, 0.93, 0.45, 0.36, rot);
    if (h01(seed) < 0.16) props.sitter.push({ x: x + Math.sin(rot) * 0.0, z: z + Math.cos(rot) * 0.0, rot, v: seed, y: 0 });
    return true;
  };
  const basketAt = (x: number, z: number) => {
    if (!free(x, z, 0.4)) return;
    props.basket.push({ x, z, rot: pr() * 6.28 });
    taken.push({ x, z, r: 0.5 });
    cyl("a trash basket", x, z, 0, PARK_Y + 0.92, 0.33);
  };
  // walk every path: lamps every ~30 m alternating sides, and pairs of benches with a basket
  const chains = raw.streets.filter((st) => st.p.length >= 4);
  let si = 0;
  for (const st of chains) {
    si++;
    const p = st.p, drive = st.rw === 1;
    const half = (drive ? Math.max(7, st.w) : Math.max(3, Math.min(8, st.w))) / 2;
    let acc = h01(si) * 20, side = 1, benchAcc = h01(si * 3) * 30;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      for (let d = 0; d < L; d += 1) {
        const x = ax + tx * d, z = az + tz * d;
        if (!inPark(x, z) || inMeadow(x, z) || x > X1 - 10 || z < Z0 + 8) { acc = Math.min(acc, 10); continue; }
        acc += 1; benchAcc += 1;
        const lampEvery = drive ? 36 : 29;
        if (acc >= lampEvery) {
          const o = half + (drive ? 1.0 : 0.5);
          const lx = x + nx * o * side, lz = z + nz * o * side;
          if (pathClear(lx, lz) > 0.3) { lampAt(lx, lz); acc = 0; side = -side; }
        }
        if (!drive && benchAcc >= 44) {
          const o = half + 0.85, s2 = h01(si * 7 + i) < 0.5 ? 1 : -1;
          const rot = Math.atan2(-nx * s2, -nz * s2);   // the bench faces the path
          let n = 0;
          for (let k = 0; k < 2; k++) {
            const bxp = x + nx * o * s2 + tx * k * 2.1, bzp = z + nz * o * s2 + tz * k * 2.1;
            if (pathClear(bxp, bzp) > 0.15 && benchAt(bxp, bzp, rot, si * 31 + i * 7 + k)) n++;
          }
          if (n) { basketAt(x + nx * o * s2 + tx * (n * 2.1 - 0.5), z + nz * o * s2 + tz * (n * 2.1 - 0.5)); benchAcc = 0; }
        }
      }
    }
  }
  // the promenade along the Pond's south shore: benches looking at the water, lamps between
  for (let x = 82; x < 246; x += 6.5) {
    if (Math.floor(x) % 3 === 0) lampAt(x + 3, Z0 + 10.8);
    benchAt(x, Z0 + 12, 0, Math.floor(x) * 17);
  }
  // around the rink's apron
  for (let k = -3; k <= 3; k++) benchAt(rink.x + k * 7, rink.z - rink.hz - rink.apron + 1.2, Math.PI, 900 + k);
  for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lampAt(rink.x + cx * (rink.hx + rink.apron - 1), rink.z + cz * (rink.hz + rink.apron - 1));
  // carts at the gates (and their vendors)
  for (const [x, z, rot] of [[826, 7774, Math.PI * 0.75], [544, 7768, Math.PI], [296, 7768, Math.PI], [222, 7948, Math.PI]] as [number, number, number][]) {
    props.cart.push({ x, z, rot });
    props.vendor.push({ x: x + Math.cos(rot) * 1.3, z: z - Math.sin(rot) * 1.3, rot: rot + Math.PI, v: x | 0 });
    taken.push({ x, z, r: 1.6 });
    box("a hot dog cart", x, PARK_Y + 0.7, z, 0.85, 0.7, 0.45, rot);
    cyl("a cart umbrella", x, z, PARK_Y + 2.0, PARK_Y + 2.45, 1.07);
  }

  // ---- colliders of the big features
  // Gapstow Bridge: spandrels at the ends, the deck over the arch (you can fly under it), parapets
  {
    const L = 23, W = 4.6 + 1.1, S = 13.4, R = 3.3, by = bridge.y!;
    const deck = (x: number) => 4.4 - 1.6 * (x / (L / 2)) ** 2;
    const N = 8;
    for (let i = 0; i < N; i++) {
      const xa = -L / 2 + (L * i) / N, xb = xa + L / N, xm = (xa + xb) / 2;
      const top = by + Math.min(deck(xa), deck(xb));
      const archBot = (x: number) => (Math.abs(x) < S / 2 ? R * Math.sqrt(1 - (x / (S / 2)) ** 2) - 0.6 : -0.6);
      const bot = by + Math.max(archBot(xa), archBot(xb));
      box("Gapstow Bridge", bridge.x + xm, (top + bot) / 2, bridge.z, L / N / 2, Math.max(0.3, (top - bot) / 2), W / 2);
      box("Gapstow Bridge", bridge.x + xm, top + 0.48, bridge.z - (4.6 / 2 + 0.28), L / N / 2, 0.48, 0.28);
      box("Gapstow Bridge", bridge.x + xm, top + 0.48, bridge.z + (4.6 / 2 + 0.28), L / N / 2, 0.48, 0.28);
    }
  }
  // Wollman Rink: boards (as straight runs plus corner pieces), the rink house
  {
    const { x, z, hx, hz } = rink;
    box("the rink boards", x, ICE_Y + 0.55, z - hz, hx - 6, 0.55, 0.08);
    box("the rink boards", x, ICE_Y + 0.55, z + hz, hx - 6, 0.55, 0.08);
    box("the rink boards", x - hx, ICE_Y + 0.55, z, 0.08, 0.55, hz - 6);
    box("the rink boards", x + hx, ICE_Y + 0.55, z, 0.08, 0.55, hz - 6);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box("the rink boards", x + sx * (hx - 3), ICE_Y + 0.55, z + sz * (hz - 3), 2.6, 0.55, 2.6, Math.PI / 4);
    const hs = rink.house;
    box("the rink house", hs.x, PARK_Y + hs.h / 2, hs.z, hs.w / 2, hs.h / 2, hs.d / 2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl("a floodlight", x + sx * (hx + 3), z + sz * (hz + 3), 0, 12.5, 0.2);
  }
  // the Maine monument
  {
    const { x, z, rot } = maine;
    const fx = Math.sin(rot), fz = Math.cos(rot);   // its front
    box("the Maine monument", x, PARK_Y + 0.75, z, 6, 0.75, 4.5, rot);
    box("the Maine monument", x - fx * 1.2, PARK_Y + 1.5 + 6.5, z - fz * 1.2, 1.55, 6.5, 1.2, rot);
    box("the Maine monument", x + fx * 0.7, PARK_Y + 1.5 + 1.45, z + fz * 0.7, 1.2, 1.45, 1.8, rot);
    colliders.push({ kind: "sphere", name: "the Maine monument", x: x - fx * 1.2, y: PARK_Y + 1.5 + 13 + 2.2, z: z - fz * 1.2, r: 1.9 });
  }

  // ---- the lawn edge round Sheep Meadow: the low hoop fence, open where the paths come up to it
  const fences: ParkLayout["fences"] = { hoop: [], rail: [] };
  {
    const o = 2.5, X0m = 430 - o, X1m = 730 + o, Z0m = 8290 - o, Z1m = 8565 + o;
    const edges: [number, number, number, number][] = [[X0m, Z0m, X1m, Z0m], [X1m, Z0m, X1m, Z1m], [X1m, Z1m, X0m, Z1m], [X0m, Z1m, X0m, Z0m]];
    for (const [ax, az, bx, bz] of edges) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.round(L / 2), tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let i = 0; i < n; i++) {
        const x = ax + tx * (i + 0.5) * (L / n), z = az + tz * (i + 0.5) * (L / n);
        if (!inPark(x, z) || city.buildingAt(x, z) || pathClear(x, z) < 1.5) continue;
        if (trees.some((t) => Math.abs(t.x - x) < 1.6 && Math.abs(t.z - z) < 1.6)) continue;
        fences.hoop.push({ x, z, rot: Math.atan2(-tz, tx), s: L / n / 2 });
      }
    }
  }
  // ---- the bridle path: stone dust between post-and-rail fences
  const bridle: ParkLayout["bridle"] = [];
  for (const st of raw.streets) {
    if (!/BRIDLE/.test(st.n)) continue;
    const p = st.p, w = Math.max(3, Math.min(st.w, 8));
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5 || (!inPark(ax, az) && !inPark(bx, bz)) || inMeadow(ax, az) || inMeadow(bx, bz)) continue;
      bridle.push([ax, az, bx, bz, w]);
      const tx = (bx - ax) / L, tz = (bz - az) / L, n = Math.max(1, Math.round(L / 3));
      for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
        const d = (k + 0.5) * (L / n), o = w / 2 + 0.45;
        const x = ax + tx * d - tz * o * side, z = az + tz * d + tx * o * side;
        // (not across another path, nor into the trees, lamps and benches)
        if (!inPark(x, z) || inMeadow(x, z) || pathClear(x, z) < 0.25 || city.buildingAt(x, z)) continue;
        if (trees.some((t) => Math.abs(t.x - x) < 1.8 && Math.abs(t.z - z) < 1.8) || taken.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 1.6)) continue;
        fences.rail.push({ x, z, rot: Math.atan2(-tz, tx), s: L / n / 3 });
      }
    }
  }

  const keepClear = (x: number, z: number) => inMeadow(x, z) || !!city.buildingAt(x, z) || inPond(x, z, 2) || inRink(x, z, 2) ||
    Math.hypot(x - maine.x, z - maine.z) < 14 || Math.hypot(x - bridge.x, z - bridge.z) < 15 ||
    rocks.some((r) => Math.hypot(r.x - x, r.z - z) < Math.max(ROCKS[r.kind].rx, ROCKS[r.kind].rz) * (r.s ?? 1) + 1.5);

  return { bounds: bb, trees, props, rocks, pond: POND, bridge, rink, maine, walls, piers, fences, bridle, colliders, keepClear, inMeadow };
}

function bbox(r: number[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
  return { x0, x1, z0, z1 };
}
function bboxArea(r: number[]) { const b = bbox(r); return (b.x1 - b.x0) * (b.z1 - b.z0); }
function distRing(r: number[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], dx = r[i] - ax, dz = r[i + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// ================================================================== collision

/** Push-out test: calls hit(nx, ny, nz, depth, name) for every collider a sphere (x, y, z, r) overlaps. */
export function collideParkColliders(grid: Grid<ParkCollider>, x: number, y: number, z: number, r: number,
  hit: (nx: number, ny: number, nz: number, depth: number, name: string) => void, scratch: ParkCollider[] = []): void {
  for (const c of grid.around(x, z, r + 0.5, scratch)) {
    if (c.kind === "cyl") {
      if (y < c.y0 - r || y > c.y1 + r) continue;
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
      const side = c.r + r - d;
      if (side <= 0) continue;
      const up = c.y1 + r - y, down = y - (c.y0 - r);
      if (up < side && up < down) hit(0, 1, 0, up, c.name);
      else if (down < side) hit(0, -1, 0, down, c.name);
      else hit(d > 1e-6 ? dx / d : 1, 0, d > 1e-6 ? dz / d : 0, side, c.name);
    } else if (c.kind === "sphere") {
      const dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.hypot(dx, dy, dz);
      if (d < c.r + r && d > 1e-6) hit(dx / d, dy / d, dz / d, c.r + r - d, c.name);
    } else if (c.kind === "box") {
      const rx = x - c.x, ry = y - c.y, rz = z - c.z, nx = -c.tz, nz = c.tx;
      const lu = rx * c.tx + rz * c.tz, lo = rx * nx + rz * nz;
      const du = c.hw + r - Math.abs(lu), dh = c.hh + r - Math.abs(ry), dd = c.hd + r - Math.abs(lo);
      if (du <= 0 || dh <= 0 || dd <= 0) continue;
      if (dh < du && dh < dd) hit(0, Math.sign(ry) || 1, 0, dh, c.name);
      else if (dd < du) { const s = Math.sign(lo) || 1; hit(nx * s, 0, nz * s, dd, c.name); }
      else { const s = Math.sign(lu) || 1; hit(c.tx * s, 0, c.tz * s, du, c.name); }
    } else {
      const rx = x - c.x, rz = z - c.z;
      const u = (rx * c.tx + rz * c.tz) / c.rx, v = (rx * -c.tz + rz * c.tx) / c.rz;
      const q = Math.hypot(u, v);
      if (q >= 1.02) continue;
      const k = Math.max(0, 1 - Math.pow(q, 2.2));
      const surf = c.y0 + c.h * Math.pow(k, 0.4);
      const depth = surf + r - y;
      if (depth <= 0 || y < c.y0 - r) continue;
      // normal from the slope of the dome
      const dq = q > 1e-3 ? (c.h * 0.4 * Math.pow(Math.max(k, 1e-3), -0.6) * 2.2 * Math.pow(q, 1.2)) : 0;
      const gx = q > 1e-3 ? (u / q) * dq / c.rx : 0, gz = q > 1e-3 ? (v / q) * dq / c.rz : 0;
      const wx = gx * c.tx - gz * c.tz, wz = gx * c.tz + gz * c.tx;
      const L = Math.hypot(wx, 1, wz);
      hit(wx / L, 1 / L, wz / L, depth / L, c.name);
    }
  }
}

/** Colliders as the oriented "solid" boxes flow.facades understands (see render/landmarks.ts landmarkSolids):
 *  push each into facades.props and facades.grid. Domes become a box over their upper two thirds. */
export function parkFacadeSolids(colliders: ParkCollider[]) {
  return colliders.map((c) => {
    if (c.kind === "box") return { kind: "solid" as const, x: c.x, y: c.y, z: c.z, tx: c.tx, tz: c.tz, nx: -c.tz, nz: c.tx, hw: c.hw, hh: c.hh, hd: c.hd, seed: 0 };
    if (c.kind === "cyl") return { kind: "solid" as const, x: c.x, y: (c.y0 + c.y1) / 2, z: c.z, tx: 1, tz: 0, nx: 0, nz: 1, hw: c.r * 0.85, hh: (c.y1 - c.y0) / 2, hd: c.r * 0.85, seed: 0 };
    if (c.kind === "sphere") return { kind: "solid" as const, x: c.x, y: c.y, z: c.z, tx: 1, tz: 0, nx: 0, nz: 1, hw: c.r * 0.8, hh: c.r * 0.8, hd: c.r * 0.8, seed: 0 };
    return { kind: "solid" as const, x: c.x, y: c.y0 + c.h * 0.4, z: c.z, tx: c.tx, tz: c.tz, nx: -c.tz, nz: c.tx, hw: c.rx * 0.6, hh: c.h * 0.4, hd: c.rz * 0.6, seed: 0 };
  });
}

export function colliderGrid(colliders: ParkCollider[]): Grid<ParkCollider> {
  const g = new Grid<ParkCollider>(16);
  for (const c of colliders) {
    const r = c.kind === "box" ? Math.max(c.hw, c.hd) * 1.42 : c.kind === "dome" ? Math.max(c.rx, c.rz) : c.r;
    g.add(c, c.x - r, c.z - r, c.x + r, c.z + r);
  }
  return g;
}

// ================================================================== assets

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material }

export interface ParkAssets {
  parts: (name: string) => Part[];
  mats: Record<string, THREE.Material>;
  tex: Record<string, THREE.Texture>;
}

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  draw(cv.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let assetsPromise: Promise<ParkAssets> | null = null;

/** Loads (once) the park's GLBs and textures. base: URL of the folder holding models/ and textures/. */
export function loadParkAssets(base = "./"): Promise<ParkAssets> {
  if (assetsPromise) return assetsPromise;
  const url = (f: string) => new URL(f, new URL(base, document.baseURI)).href;
  assetsPromise = (async () => {
    const tl = new THREE.TextureLoader();
    const load = async (f: string, srgb = true, mirror = false) => {
      const t = await tl.loadAsync(url("textures/park/" + f));
      t.flipY = false;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    };
    const [trees, props, schist, wall, rubble, ice, bridle, gTrees, gProps] = await Promise.all([
      load("trees.png"), load("props.png"), load("schist.jpg", true, true), load("wall.jpg", true, true), load("rubble.jpg", true, true), load("ice.jpg", true, true),
      load("bridle.jpg", true, true).catch(() => new THREE.Texture()),
      new GLTFLoader().loadAsync(url("models/park_trees.glb")), new GLTFLoader().loadAsync(url("models/park_props.glb")),
    ]);
    trees.wrapS = THREE.ClampToEdgeWrapping;
    props.wrapS = props.wrapT = THREE.ClampToEdgeWrapping;
    const mats: Record<string, THREE.Material> = {
      bark: new THREE.MeshStandardMaterial({ map: trees, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.95, color: 0xd8d2cc }),
      props: new THREE.MeshStandardMaterial({ map: props, roughness: 0.7, metalness: 0.15 }),
      wire: new THREE.MeshStandardMaterial({ map: props, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
      globe: new THREE.MeshStandardMaterial({ map: props, color: 0xffffff, emissive: 0xffc27a, emissiveIntensity: 2.4, roughness: 0.3 }),
      schist: new THREE.MeshStandardMaterial({ map: schist, bumpMap: schist, bumpScale: 3, roughness: 0.88, color: 0xe2e0dc }),
      rubble: new THREE.MeshStandardMaterial({ map: rubble, bumpMap: rubble, bumpScale: 2.5, roughness: 0.92 }),
      deck: new THREE.MeshStandardMaterial({ color: 0x4f4c49, roughness: 0.95 }),
      water: new THREE.MeshStandardMaterial({ color: 0x24302e, roughness: 0.08, metalness: 0.1 }),
      person: personMaterial(),
      // the park wall's rock-faced stones (each its own patch of the rubble texture, tinted per stone) and its coping
      stone: new THREE.MeshStandardMaterial({ map: rubble, bumpMap: rubble, bumpScale: 2, roughness: 0.9, color: 0xc4beb4, vertexColors: true }),
      coping: new THREE.MeshStandardMaterial({ map: wall, roughness: 0.85, color: 0xd6d0c4 }),
    };
    // twig cards (the atlas' right-hand column): keep the thin twigs crisp at a distance instead of letting the
    // mips smear them into dark clumps that read as leaves, and light them as a haze of twigs (from above),
    // not as flat cards turned away from the sun
    mats.bark.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <alphatest_fragment>", `
          bool twigCard = vMapUv.x > 0.75;
          if (twigCard) { float a = diffuseColor.a; diffuseColor.a = (a - 0.45) / max(fwidth(a) * 1.5, 1e-4) + 0.5; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.39, 0.36), 0.2); }
          #include <alphatest_fragment>`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          if (twigCard) normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.75));`);
    };
    const lib = new Map<string, Part[]>();
    for (const g of [gTrees, gProps]) {
      g.scene.updateMatrixWorld(true);
      for (const node of g.scene.children) {
        const list: Part[] = [];
        node.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
          // older exports carry a blank COLOR_0 and the real colours in COLOR_1
          if (geo.getAttribute("color_1")) { geo.setAttribute("color", geo.getAttribute("color_1")); geo.deleteAttribute("color_1"); }
          const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
          list.push({ geo, mat: mats[name] ?? mats.props });
        });
        lib.set(node.name, list);
      }
    }
    // the umbrella is a single sheet: show both sides
    const both = (mats.props as THREE.MeshStandardMaterial).clone();
    both.side = THREE.DoubleSide;
    for (const p of lib.get("cart_umbrella") ?? []) p.mat = both;
    return {
      parts: (n: string) => { const p = lib.get(n); if (!p) throw new Error("park asset missing: " + n); return p; },
      mats, tex: { trees, props, schist, wall, rubble, ice, bridle },
    };
  })();
  return assetsPromise;
}

/** Plain figures (skaters, people on benches, vendors), ducks: vertex colours, alpha 0 = the coat,
 *  tinted per instance (aCoat). aMode 1 = skating: legs push out to the side in turn, arms swing. */
function personMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec3 aCoat; attribute float aPhase; attribute float aMode; varying vec3 vTint;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_COLOR_ALPHA
          vTint = color.a < 0.5 ? aCoat : color.rgb;
        #else
          vTint = color.rgb;
        #endif
        if (aMode > 0.5 && aMode < 1.5) {
          float s = sign(transformed.x);
          if (transformed.y < 0.92) {
            float push = max(0.0, s * sin(aPhase)) * 0.42;
            float a = s * push;
            vec2 p = transformed.xy - vec2(s * 0.1, 0.92);
            transformed.xy = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)) + vec2(s * 0.1, 0.92);
          } else if (abs(transformed.x) > 0.17 && transformed.y < 1.45) {
            float a = s * sin(aPhase) * 0.5;
            vec2 p = transformed.zy - vec2(0.0, 1.42);
            transformed.zy = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)) + vec2(0.0, 1.42);
          }
          // lean into the stride
          float lean = 0.22;
          vec2 q = transformed.zy;
          transformed.zy = vec2(q.x * cos(lean) + q.y * sin(lean), -q.x * sin(lean) + q.y * cos(lean));
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTint;")
      .replace("#include <color_fragment>", "diffuseColor.rgb *= vTint;");
  };
  return m;
}

// ================================================================== instancing

/** One instanced draw per part, sharing transforms; refilled with whatever is in range. */
class Batch {
  readonly meshes: THREE.InstancedMesh[];
  readonly matrices: THREE.Matrix4[] = [];
  constructor(parts: Part[], readonly cap: number, shadow: boolean, readonly extra?: (geo: THREE.InstancedMesh[]) => void) {
    this.meshes = parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geo, p.mat, Math.max(1, cap));
      im.count = 0;
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return im;
    });
    extra?.(this.meshes);
  }
  begin() { this.n = 0; }
  private n = 0;
  push(m: THREE.Matrix4) {
    if (this.n >= this.cap) return -1;
    for (const im of this.meshes) im.setMatrixAt(this.n, m);
    return this.n++;
  }
  end() {
    for (const im of this.meshes) { im.count = this.n; im.instanceMatrix.needsUpdate = true; }
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const compose = (x: number, y: number, z: number, rot: number, s = 1) => _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_Y, rot), _s.set(s, s, s));

/** Bare winter trees, instanced with three LODs chosen per tree by distance from the focus.
 *  Usable on its own (ground.ts can feed it every tree in the city): new TreeField(spots, assets). */
export class TreeField {
  readonly root = new THREE.Group();
  /** LOD switch distances (m): LOD0 below the first, LOD1 below the second, LOD2 below the third, then hidden */
  ranges = [110, 300, 950];
  private batches: Batch[][] = [];
  private mats: THREE.Matrix4[];
  /** per tree: its model (species x 2 + variant) */
  private sp: number[];
  private last = new THREE.Vector2(1e9, 1e9);

  constructor(readonly trees: ParkTree[], assets: ParkAssets) {
    this.root.name = "park-trees";
    // two models of each species (the second is optional: older exports have one)
    const model = (t: ParkTree) => TREE_SPECIES.indexOf(t.sp) * 2 + (t.v ? 1 : 0);
    this.sp = trees.map(model);
    TREE_SPECIES.forEach((s, si) => {
      for (const v of [0, 1]) {
        let name = `${s}${v ? "2" : ""}`;
        try { assets.parts(`tree_${name}_lod0`); } catch { name = s; }
        const n = this.sp.filter((k) => k === si * 2 + v).length;
        const b = [0, 1, 2].map((l) => new Batch(assets.parts(`tree_${name}_lod${l}`), n, l < 2));
        this.batches.push(b);
        for (const x of b) this.root.add(...x.meshes);
      }
    });
    this.mats = trees.map((t) => compose(t.x, PARK_Y - 0.05, t.z, t.rot, t.s).clone());
  }

  update(focus: THREE.Vector3) {
    if (Math.hypot(focus.x - this.last.x, focus.z - this.last.y) < 4) return;
    this.last.set(focus.x, focus.z);
    for (const sb of this.batches) for (const b of sb) b.begin();
    const [r0, r1, r2] = this.ranges;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i], d = Math.hypot(t.x - focus.x, t.z - focus.z) - t.s * 4;
      if (d > r2) continue;
      this.batches[this.sp[i]][d < r0 ? 0 : d < r1 ? 1 : 2].push(this.mats[i]);
    }
    for (const sb of this.batches) for (const b of sb) b.end();
  }
}

// ================================================================== the park

interface Skater { cx: number; cz: number; ax: number; az: number; speed: number; a: number; phase: number; stride: number; coat: THREE.Color; h: number; mode: number }

/** quality "low" (phones): shorter LOD distances and draw ranges */
export interface CentralParkOptions { base?: string; layout?: ParkLayout; quality?: "low" | "medium" | "high" }

export class CentralPark {
  readonly root = new THREE.Group();
  readonly layout: ParkLayout;
  readonly colliders: ParkCollider[];
  readonly grid: Grid<ParkCollider>;
  /** Resolves when the assets have loaded and everything is built (root is empty until then). */
  readonly ready: Promise<void>;
  /** Draw distance for the furniture and people (m); trees use TreeField.ranges. */
  propRange = 380;
  /** Lamp glow, 0..1 (globes, halos and light pools). */
  set glow(v: number) { this._glow = v; this.applyGlow(); }
  get glow() { return this._glow; }

  private _glow = 1;
  private low = false;
  private trees?: TreeField;
  private sets: { batch: Batch; items: Placed[]; y: number; range: number; near?: number; mats: THREE.Matrix4[] }[] = [];
  private statics: { o: THREE.Object3D; x: number; z: number; r: number }[] = [];
  private skaters: Skater[] = [];
  private skaterBatch?: Batch;
  private duckBatch?: Batch;
  private ducks: { x: number; z: number; a: number; sp: number; ph: number }[] = [];
  private globeMat?: THREE.MeshStandardMaterial;
  private halo?: THREE.Points;
  private pools?: THREE.InstancedMesh;
  private lastFocus = new THREE.Vector2(1e9, 1e9);
  private scratch: ParkCollider[] = [];

  constructor(readonly city: CityData, opts: CentralParkOptions = {}) {
    this.root.name = "central-park";
    this.layout = opts.layout ?? parkLayout(city);
    this.colliders = this.layout.colliders;
    this.grid = colliderGrid(this.colliders);
    this.low = opts.quality === "low";
    if (this.low) this.propRange = 220;
    this.ready = loadParkAssets(opts.base).then((a) => this.build(a));
  }

  /** Push-out against the park's solids (see collideParkColliders). */
  collide(x: number, y: number, z: number, r: number, hit: (nx: number, ny: number, nz: number, depth: number, name: string) => void) {
    collideParkColliders(this.grid, x, y, z, r, hit, this.scratch);
  }

  // ------------------------------------------------------------ build
  private build(A: ParkAssets) {
    const L = this.layout;
    this.trees = new TreeField(L.trees, A);
    if (this.low) this.trees.ranges = [45, 170, 560];
    this.root.add(this.trees.root);

    // furniture and still people
    const set = (name: string, items: Placed[], y: number, range: number, shadow = true, extra?: (ms: THREE.InstancedMesh[]) => void) => {
      if (!items.length) return;
      const batch = new Batch(A.parts(name), items.length, shadow, extra);
      for (const m of batch.meshes) m.name = name;
      this.root.add(...batch.meshes);
      this.sets.push({ batch, items, y, range, mats: items.map((p) => compose(p.x, (p.y ?? 0) + y, p.z, p.rot, p.s ?? 1).clone()) });
      return batch;
    };
    set("lamp_post", L.props.lamp, PARK_Y, this.propRange);
    set("lamp_globe", L.props.lamp, PARK_Y, this.propRange, false);
    const lowR = (r: number) => (this.low ? Math.min(r, r * 0.55) : r);
    set("bench", L.props.bench, PARK_Y, lowR(260));
    set("basket_wire", L.props.basket, PARK_Y, lowR(200));
    set("basket_bag", L.props.basket, PARK_Y, lowR(200));
    // the lawn edge and the bridle path's rails (stretched to fit their runs)
    const stretched = (name: string, items: Placed[], range: number, shadow: boolean) => {
      const b = set(name, items, PARK_Y, range, shadow);
      if (b) this.sets[this.sets.length - 1].mats = items.map((p) => _m.compose(_p.set(p.x, PARK_Y - 0.02, p.z), _q.setFromAxisAngle(_Y, p.rot), _s.set(p.s ?? 1, 1, 1)).clone());
    };
    stretched("hoop_fence", L.fences.hoop, lowR(170), false);
    stretched("bridle_rail", L.fences.rail, lowR(220), !this.low);
    set("cart", L.props.cart, PARK_Y, this.propRange);
    set("cart_umbrella", L.props.cart, PARK_Y, this.propRange);
    const people = (list: Placed[]) => (ms: THREE.InstancedMesh[]) => personAttrs(ms, list.map((p) => p.v ?? 0), 0);
    // sitters: on the bench seat, set back a touch from its front
    const sit = L.props.sitter.map((p) => ({ ...p, x: p.x - Math.sin(p.rot) * 0.06, z: p.z - Math.cos(p.rot) * 0.06, y: 0 }));
    set("person_sit", sit, PARK_Y, 220, true, people(sit));
    set("person_stand", L.props.vendor, PARK_Y, 260, true, people(L.props.vendor));
    for (const k of ["rock_big", "rock_ridge", "rock_mid", "rock_small", "rock_boulder"] as RockKind[]) {
      set(k, L.rocks.filter((r) => r.kind === k), PARK_Y, k === "rock_small" || k === "rock_boulder" ? 420 : 900);
    }
    this.globeMat = A.mats.globe as THREE.MeshStandardMaterial;

    // The Pond, Gapstow Bridge, ducks
    this.pond(A);
    // Wollman Rink and its skaters
    this.rink(A);
    // the Maine monument
    {
      const g = new THREE.Group();
      for (const n of ["maine", "maine_pool"]) for (const p of A.parts(n)) {
        const m = new THREE.Mesh(p.geo, n === "maine_pool" ? A.mats.water : p.mat);
        m.castShadow = n === "maine"; m.receiveShadow = true;
        g.add(m);
      }
      g.position.set(L.maine.x, PARK_Y - 0.02, L.maine.z);
      g.rotation.y = L.maine.rot;
      this.addStatic(g, L.maine.x, L.maine.z, 1000);
    }
    // the wall and its gateposts
    this.walls(A);
    // the bridle path's stone dust
    this.bridle(A);
    // lamp glow: halos and pools of light
    this.lampGlow();
    this.applyGlow();
  }

  private addStatic(o: THREE.Object3D, x: number, z: number, r: number) {
    this.root.add(o);
    this.statics.push({ o, x, z, r });
  }

  private pond(A: ParkAssets) {
    const L = this.layout;
    const ring = L.pond;
    // water
    const shape = new THREE.Shape();
    for (let i = 0; i < ring.length; i += 2) (i ? shape.lineTo(ring[i], -ring[i + 1]) : shape.moveTo(ring[i], -ring[i + 1]));
    const wg = new THREE.ShapeGeometry(shape, 4).rotateX(-Math.PI / 2);
    const ripple = canvasTex(256, (c, s) => {
      const img = c.createImageData(s, s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const a = Math.sin((x / s) * Math.PI * 6 + Math.sin((y / s) * Math.PI * 4) * 1.2) * 0.6 + Math.sin(((x + y) / s) * Math.PI * 10) * 0.3;
        const b = Math.cos((y / s) * Math.PI * 6 + Math.sin((x / s) * Math.PI * 2) * 1.4) * 0.6 + Math.cos(((x - y) / s) * Math.PI * 8) * 0.3;
        const i = (y * s + x) * 4;
        img.data[i] = 128 + a * 40; img.data[i + 1] = 128 + b * 40; img.data[i + 2] = 255; img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    });
    ripple.repeat.set(1 / 5, 1 / 5);
    const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x2a3634, roughness: 0.1, metalness: 0.15, normalMap: ripple, normalScale: new THREE.Vector2(0.07, 0.07) }));
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    // the muddy, leaf-strewn margin
    const outer = offsetRing(ring, 1.2);
    const bank = new THREE.Shape();
    for (let i = 0; i < outer.length; i += 2) (i ? bank.lineTo(outer[i], -outer[i + 1]) : bank.moveTo(outer[i], -outer[i + 1]));
    bank.holes.push(new THREE.Path(shape.getPoints()));
    const bankMesh = new THREE.Mesh(new THREE.ShapeGeometry(bank, 4).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x544a3c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    bankMesh.position.y = PARK_Y + 0.01;
    bankMesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(water, bankMesh);
    // Gapstow Bridge
    const b = new THREE.Group();
    for (const p of A.parts("bridge")) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = m.receiveShadow = true; b.add(m); }
    b.position.set(L.bridge.x, L.bridge.y!, L.bridge.z);
    b.rotation.y = L.bridge.rot;
    g.add(b);
    const c = bbox(ring);
    this.addStatic(g, (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, 1100);
    // mallards
    const r = rng(55);
    for (let i = 0; i < 11; i++) {
      for (let k = 0; k < 30; k++) {
        const x = c.x0 + r() * (c.x1 - c.x0), z = c.z0 + r() * (c.z1 - c.z0);
        if (inRing(ring, x, z) && distRing(ring, x, z) > 3 && Math.hypot(x - L.bridge.x, z - L.bridge.z) > 9) {
          this.ducks.push({ x, z, a: r() * 6.28, sp: 0.15 + r() * 0.25, ph: r() * 6.28 });
          break;
        }
      }
    }
    this.duckBatch = new Batch(A.parts("duck"), this.ducks.length, false, (ms) => personAttrs(ms, this.ducks.map(() => 0), 0, true));
    this.root.add(...this.duckBatch.meshes);
  }

  private rink(A: ParkAssets) {
    const { x, z, hx, hz, r, apron, house } = this.layout.rink;
    const g = new THREE.Group();
    const rr = (ex: number, ez: number, rad: number) => {
      const s = new THREE.Shape(), X = ex, Z = ez;
      s.moveTo(-X + rad, -Z);
      s.lineTo(X - rad, -Z); s.absarc(X - rad, -Z + rad, rad, -Math.PI / 2, 0, false);
      s.lineTo(X, Z - rad); s.absarc(X - rad, Z - rad, rad, 0, Math.PI / 2, false);
      s.lineTo(-X + rad, Z); s.absarc(-X + rad, Z - rad, rad, Math.PI / 2, Math.PI, false);
      s.lineTo(-X, -Z + rad); s.absarc(-X + rad, -Z + rad, rad, Math.PI, Math.PI * 1.5, false);
      return s;
    };
    const iceTex = A.tex.ice.clone();
    iceTex.repeat.set(1 / 7, 1 / 7);
    iceTex.needsUpdate = true;
    const ice = new THREE.Mesh(new THREE.ShapeGeometry(rr(hx, hz, r), 6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: iceTex, color: 0xf2f6fa, roughness: 0.12, metalness: 0.0 }));
    ice.position.set(x, ICE_Y, z);
    ice.receiveShadow = true;
    const apronShape = rr(hx + apron, hz + apron, r + apron);
    apronShape.holes.push(new THREE.Path(rr(hx, hz, r).getPoints(6)));
    const wallTex = A.tex.wall.clone();
    wallTex.repeat.set(1 / 1.5, 1 / 1.5);
    wallTex.needsUpdate = true;
    const apronMesh = new THREE.Mesh(new THREE.ShapeGeometry(apronShape, 6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: wallTex, color: 0xa29d94, roughness: 0.9 }));
    apronMesh.position.set(x, PARK_Y + 0.04, z);
    apronMesh.receiveShadow = true;
    // dasher boards: a ribbon round the ice, each ~2.4 m panel mapped onto the boards cell
    const pts = rr(hx, hz, r).getSpacedPoints(110);
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const cellU = (u: number) => (768 + 8 + u * 240) / 1024, v0 = (512 + 8) / 1024, v1 = (768 - 8) / 1024;
    const H = 1.07, T = 0.12;
    let vi = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, Ln = Math.hypot(dx, dy) || 1, nx = dy / Ln, ny = -dx / Ln;
      for (const [o, flip] of [[0, false], [T, true]] as [number, boolean][]) {
        const ax = a.x + nx * o, ay = a.y + ny * o, bx = b.x + nx * o, by = b.y + ny * o;
        pos.push(ax, 0, -ay, bx, 0, -by, bx, H, -by, ax, H, -ay);
        uv.push(cellU(0), v1, cellU(1), v1, cellU(1), v0, cellU(0), v0);
        if (flip) idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2); else idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
      }
      // the cap rail
      pos.push(a.x, H, -a.y, b.x, H, -b.y, b.x + nx * T, H, -(b.y + ny * T), a.x + nx * T, H, -(a.y + ny * T));
      uv.push(cellU(0), v0, cellU(1), v0, cellU(1), v0 + 0.01, cellU(0), v0 + 0.01);
      idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      vi += 4;
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    bg.setIndex(idx);
    bg.computeVertexNormals();
    const boardsMat = (A.mats.props as THREE.MeshStandardMaterial).clone();
    boardsMat.side = THREE.DoubleSide;
    const boards = new THREE.Mesh(bg, boardsMat);
    boards.position.set(x, ICE_Y, z);
    boards.castShadow = boards.receiveShadow = true;
    // the rink house: a low stone pavilion with a glazed front, glowing warm
    const hm = new THREE.Group();
    const hwTex = A.tex.wall.clone();
    hwTex.repeat.set(1 / 1.2, 1 / 1.2);
    hwTex.needsUpdate = true;
    const body = new THREE.Mesh(new THREE.BoxGeometry(house.w, house.h, house.d), new THREE.MeshStandardMaterial({ map: hwTex, color: 0xb0a898, roughness: 0.9 }));
    body.position.y = house.h / 2;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(house.w + 1.2, 0.35, house.d + 1.2), new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.8 }));
    roof.position.y = house.h + 0.17;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(house.w - 4, 2.2), new THREE.MeshStandardMaterial({ color: 0x2a2620, emissive: 0xffb866, emissiveIntensity: 0.9, roughness: 0.2 }));
    glass.position.set(0, 1.9, -house.d / 2 - 0.02);
    glass.rotation.y = Math.PI;
    for (const m of [body, roof]) { m.castShadow = m.receiveShadow = true; }
    hm.add(body, roof, glass);
    hm.position.set(house.x, PARK_Y, house.z);
    // floodlight poles at the corners
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.2, 12.4, 8).translate(0, 6.2, 0);
    const headGeo = new THREE.BoxGeometry(1.4, 0.5, 0.6).translate(0, 12.5, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c302c, roughness: 0.6, metalness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d6, emissiveIntensity: 2.2 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pole = new THREE.Mesh(poleGeo, poleMat), head = new THREE.Mesh(headGeo, headMat);
      for (const m of [pole, head]) { m.position.set(x + sx * (hx + 3), PARK_Y, z + sz * (hz + 3)); m.rotation.y = Math.atan2(-sx, -sz); }
      pole.castShadow = true;
      g.add(pole, head);
    }
    g.add(ice, apronMesh, boards, hm);
    this.addStatic(g, x, z, 1000);

    // skaters: loops round the ice, mostly anticlockwise, a few beginners hugging the boards
    const rr2 = rng(909);
    const coats = [0xb03a2e, 0x2e4a7a, 0x3d6b4f, 0xd9b44a, 0x6b3d6b, 0x222222, 0xe8e2d6, 0x8a5a3a, 0xc8553d, 0x4a90a4, 0x9a9a9a, 0x1f3550];
    for (let i = 0; i < 30; i++) {
      const k = 0.35 + rr2() * 0.55;
      const beginner = i < 4;
      this.skaters.push({
        cx: x + (rr2() - 0.5) * 4, cz: z + (rr2() - 0.5) * 3, ax: beginner ? hx - 1.2 : (hx - 4) * k, az: beginner ? hz - 1.2 : (hz - 4) * k,
        speed: beginner ? 0.5 + rr2() * 0.3 : 2.4 + rr2() * 2.4, a: rr2() * 6.28, phase: rr2() * 6.28, stride: beginner ? 2.2 : 1.1 + rr2() * 0.4,
        coat: new THREE.Color(coats[i % coats.length]), h: i % 7 === 3 ? 0.72 : 0.95 + rr2() * 0.1, mode: i % 13 === 5 ? 0 : 1,
      });
    }
    this.skaterBatch = new Batch(A.parts("person_stand"), this.skaters.length, true, (ms) => personAttrs(ms, this.skaters.map((_, i) => 200 + i), 1, false, this.skaters.map((s) => s.coat)));
    this.root.add(...this.skaterBatch.meshes);
  }

  /** The low wall along 59th St, CPW and Fifth, in modelled 3 m pieces of rock-faced stone (a plain box
   *  stand-in further off), and its gate piers. */
  private walls(A: ParkAssets) {
    const L = this.layout;
    const items: Placed[] = [], mats: THREE.Matrix4[] = [];
    for (const [ax, az, bx, bz] of L.walls) {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 3)), rot = Math.atan2(-(bz - az), bx - ax);
      for (let i = 0; i < n; i++) {
        const x = ax + ((bx - ax) * (i + 0.5)) / n, z = az + ((bz - az) * (i + 0.5)) / n;
        items.push({ x, z, rot });
        // (every other piece turned end for end, so the stones don't repeat every 3 m)
        mats.push(_m.compose(_p.set(x, PARK_Y - 0.1, z), _q.setFromAxisAngle(_Y, rot + (i % 2) * Math.PI), _s.set(len / n / 3, 1, 1)).clone());
      }
    }
    const near = this.low ? 70 : 170;
    const add = (name: string, list: Placed[], m: THREE.Matrix4[], from: number, to: number, shadow: boolean) => {
      if (!list.length) return;
      const batch = new Batch(A.parts(name), list.length, shadow);
      for (const im of batch.meshes) im.name = name;
      this.root.add(...batch.meshes);
      this.sets.push({ batch, items: list, y: 0, range: to, near: from, mats: m });
    };
    add("wall_seg", items, mats, 0, near, true);
    add("wall_seg_lod1", items, mats, near, 750, !this.low);
    add("wall_pier", L.piers, L.piers.map((p) => compose(p.x, PARK_Y - 0.1, p.z, p.rot).clone()), 0, 750, true);
  }

  /** The bridle path: packed tan stone dust laid over the path (render/ground.ts draws it as a footpath). */
  private bridle(A: ParkAssets) {
    const segs = this.layout.bridle;
    if (!segs.length) return;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let u = 0;
    for (const [ax, az, bx, bz, w] of segs) {
      const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx, h = w / 2 + 0.05;
      // (a little past each end so the joints overlap)
      const x0 = ax - tx * h * 0.5, z0 = az - tz * h * 0.5, x1 = bx + tx * h * 0.5, z1 = bz + tz * h * 0.5;
      const v = pos.length / 3;
      pos.push(x0 + nx * h, 0, z0 + nz * h, x0 - nx * h, 0, z0 - nz * h, x1 - nx * h, 0, z1 - nz * h, x1 + nx * h, 0, z1 + nz * h);
      const u1 = u + (L + h) / 5;
      uv.push(u, 0, u, w / 5, u1, w / 5, u1, 0);
      u = u1 % 20;
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.getAttribute("normal").getY(0) < 0) { g.setIndex(idx.map((_, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
    const m = new THREE.MeshStandardMaterial({ map: A.tex.bridle, roughness: 0.97, color: 0xe2d8c8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 0.134;
    mesh.receiveShadow = true;
    const c = segs.reduce((a, q) => [a[0] + q[0] / segs.length, a[1] + q[1] / segs.length], [0, 0]);
    this.addStatic(mesh, c[0], c[1], 1400);
  }

  private lampGlow() {
    const lamps = this.layout.props.lamp;
    if (!lamps.length) return;
    const glowTex = canvasTex(64, (c, s) => {
      const gr = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, "rgba(255,230,190,1)"); gr.addColorStop(0.25, "rgba(255,200,130,0.45)"); gr.addColorStop(1, "rgba(255,180,100,0)");
      c.fillStyle = gr; c.fillRect(0, 0, s, s);
    });
    glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;
    const pos = new Float32Array(lamps.length * 3);
    lamps.forEach((l, i) => pos.set([l.x, PARK_Y + 3.36, l.z], i * 3));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.halo = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: 2.6, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd6a0 }));
    this.halo.frustumCulled = false;
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x5a4630, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), lamps.length);
    lamps.forEach((l, i) => this.pools!.setMatrixAt(i, compose(l.x, PARK_Y + 0.06, l.z, 0)));
    this.pools.computeBoundingSphere();
    this.root.add(this.halo, this.pools);
  }

  private applyGlow() {
    const g = this._glow;
    if (this.globeMat) this.globeMat.emissiveIntensity = 0.25 + 2.4 * g;
    if (this.halo) { this.halo.visible = g > 0.02; (this.halo.material as THREE.PointsMaterial).opacity = g; }
    if (this.pools) { this.pools.visible = g > 0.02; (this.pools.material as THREE.MeshBasicMaterial).opacity = g; }
  }

  // ------------------------------------------------------------ per frame
  /** focus: the camera or the leaf. t: seconds (for the skaters and ducks). */
  update(focus: THREE.Vector3, t = performance.now() / 1000) {
    if (!this.trees) return;
    this.trees.update(focus);
    const fx = focus.x, fz = focus.z;
    if (Math.hypot(fx - this.lastFocus.x, fz - this.lastFocus.y) > 5) {
      this.lastFocus.set(fx, fz);
      for (const s of this.sets) {
        s.batch.begin();
        for (let i = 0; i < s.items.length; i++) {
          const p = s.items[i];
          if (Math.abs(p.x - fx) > s.range || Math.abs(p.z - fz) > s.range) continue;
          const d = Math.hypot(p.x - fx, p.z - fz);
          if (d < s.range && d >= (s.near ?? 0)) s.batch.push(s.mats[i]);
        }
        s.batch.end();
      }
      for (const st of this.statics) st.o.visible = Math.hypot(st.x - fx, st.z - fz) < st.r;
      if (this.halo) this.halo.visible = this._glow > 0.02 && Math.hypot(fx - 450, fz - 8100) < 1300;
    }
    const near = (x: number, z: number, r: number) => Math.hypot(x - fx, z - fz) < r;
    const { x: rx, z: rz } = this.layout.rink;
    if (this.skaterBatch) {
      const on = near(rx, rz, 450);
      this.skaterBatch.begin();
      if (on) {
        const ph = this.skaterBatch.meshes[0].geometry.getAttribute("aPhase") as THREE.InstancedBufferAttribute;
        this.skaters.forEach((s, i) => {
          const w = s.speed / Math.max(4, (s.ax + s.az) / 2);
          const a = s.a + t * w * (s.mode ? 1 : 0.05);
          const x = s.cx + Math.cos(a) * s.ax, z = s.cz + Math.sin(a) * s.az;
          // heading along the loop (anticlockwise seen from above: -x, -z tangent)
          const dx = -Math.sin(a) * s.ax, dz = Math.cos(a) * s.az;
          const rot = Math.atan2(dx, dz);
          this.skaterBatch!.push(_m.compose(_p.set(x, ICE_Y, z), _q.setFromAxisAngle(_Y, rot), _s.set(s.h, s.h, s.h)));
          ph.setX(i, s.phase + t * (s.speed / s.stride));
        });
        ph.needsUpdate = true;
      }
      this.skaterBatch.end();
    }
    if (this.duckBatch) {
      const on = near(160, 7840, 380);
      this.duckBatch.begin();
      if (on) for (const d of this.ducks) {
        const a = d.a + Math.sin(t * 0.05 + d.ph) * 1.5;
        const x = d.x + Math.cos(a) * 3 + Math.sin(t * d.sp * 0.2 + d.ph) * 2, z = d.z + Math.sin(a) * 3;
        this.duckBatch.push(_m.compose(_p.set(x, WATER_Y + Math.sin(t * 1.3 + d.ph) * 0.015, z), _q.setFromAxisAngle(_Y, a + Math.PI / 2 + Math.sin(t * 0.4 + d.ph) * 0.4), _s.set(1, 1, 1)));
      }
      this.duckBatch.end();
    }
  }
}

/** per-instance coat colour, stride phase and mode for the figure material */
function personAttrs(ms: THREE.InstancedMesh[], seeds: number[], mode: number, plain = false, coats?: THREE.Color[]) {
  const n = Math.max(1, seeds.length);
  const coat = new Float32Array(n * 3), phase = new Float32Array(n), md = new Float32Array(n).fill(mode);
  const pal = [0x2f3b4c, 0x6b2d2a, 0x3b4a35, 0x7a6a55, 0x1d1d20, 0x8c7d6a, 0x4d3a5c, 0xb0432f, 0x5c6f82, 0x9a8c74];
  const c = new THREE.Color();
  seeds.forEach((sd, i) => {
    if (coats) c.copy(coats[i]); else c.set(plain ? 0xffffff : pal[Math.floor(h01(sd * 7 + 3) * pal.length)]);
    coat.set([c.r, c.g, c.b], i * 3);
    phase[i] = h01(sd) * 6.28;
  });
  for (const m of ms) {
    m.geometry = m.geometry.clone();
    m.geometry.setAttribute("aCoat", new THREE.InstancedBufferAttribute(coat, 3));
    m.geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1).setUsage(THREE.DynamicDrawUsage));
    m.geometry.setAttribute("aMode", new THREE.InstancedBufferAttribute(md, 1));
  }
}

/** push a ring outward (or inward for negative d) by d metres */
function offsetRing(r: number[], d: number): number[] {
  const n = r.length / 2, out: number[] = [];
  const cw = ringSign(r);
  for (let i = 0; i < n; i++) {
    const px = r[((i - 1 + n) % n) * 2], pz = r[((i - 1 + n) % n) * 2 + 1], x = r[i * 2], z = r[i * 2 + 1], qx = r[((i + 1) % n) * 2], qz = r[((i + 1) % n) * 2 + 1];
    let nx = -(qz - pz), nz = qx - px;
    const L = Math.hypot(nx, nz) || 1;
    nx = (nx / L) * cw; nz = (nz / L) * cw;
    out.push(x + nx * d, z + nz * d);
  }
  return out;
}
function ringSign(r: number[]) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] - r[i]) * (r[j + 1] + r[i + 1]);
  return a > 0 ? -1 : 1;
}
