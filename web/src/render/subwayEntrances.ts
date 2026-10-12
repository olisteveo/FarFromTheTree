// The ways into and out of the subway, built to the gameplay geometry in world/underground.ts:
//
//  - the stairwells: yellow-nosed concrete steps, white tile walls with the maroon base course and a
//    mosaic band, handrails, a painted ceiling with caged fluorescents under the pavement, and the
//    passage on to the station; where a stairwell runs into the tunnel or station it opens through a
//    hole in their wall or ceiling (subwayCuts(), used by subway.ts) instead of hanging in the hall
//  - the street entrances: four styles on the same opening (the green railings of subwayArt.ts, a
//    cast-iron kiosk, a glass-and-steel canopy, a limestone entrance like the base of a building),
//    chosen per entrance by entranceStyle(); green globes at ways in, red at the ways out
//  - the massive vents: heavy bar grating flush with the road in a diamond-plate frame, a hazard band,
//    three caged fans spinning in the shaft below, and for the ways out a column of steam and litter
//    blasting up to the rooftops (ways in suck leaves and grit down through the bars)
//  - streetOpenings() / cutRects(): the holes ground.ts cuts in the pavement so you really go in
//
// Assets come from tools/entrances (Tesseract + Blender): public/models/entrances.glb + .json and
// public/textures/entrances/{atlas.webp, stair_wall.webp, grate.png}; subway_floor.jpg is shared.
// Shaft frame (as underground.ts): origin (x, z), a along (ux, uz), b along (uz, -ux), y up. Models
// are built with +X = b, +Z = a, so they're placed with yaw atan2(ux, uz).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { STAIRS, STAIRS_FOOT, TUNNEL, VENT, stairsBelow, type Shaft, type Underground } from "../world/underground";

// ------------------------------------------------------------------ shared geometry rules

export type EntranceStyle = "railing" | "kiosk" | "canopy" | "stone";

function hash2(x: number, z: number) {
  let n = (Math.imul(Math.round(x * 10) | 0, 0x9e3779b1) ^ Math.imul(Math.round(z * 10) | 0, 0x85ebca77)) >>> 0;
  n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12;
  return (n >>> 0) / 4294967296;
}

const styleCache = new WeakMap<Shaft, EntranceStyle>();

/** Which street entrance stands over a stair opening (deterministic per entrance). Openings side by
 *  side (a pair of stairs) keep the plain railings, which can share a footprint; ones hard against a
 *  building get the railings or the stone entrance, which then reads as part of the building's base. */
export function entranceStyle(s: Shaft, u?: Underground): EntranceStyle {
  const hit = styleCache.get(s);
  if (hit) return hit;
  let style: EntranceStyle;
  const h = hash2(s.x, s.z);
  if (!u) style = h < 0.4 ? "railing" : h < 0.62 ? "kiosk" : h < 0.82 ? "canopy" : "stone";
  else if (u.shafts.some((o) => o !== s && o.kind === "stairs" && Math.hypot(o.x - s.x, o.z - s.z) < 6.2)) style = "railing";
  else {
    const inB = (a: number, b: number) => !!u.city.buildingAt(s.x + s.ux * a + s.uz * b, s.z + s.uz * a - s.ux * b);
    const pts = (bw: number, a0: number, a1: number) => [[a0, -bw], [a0, bw], [a1, -bw], [a1, bw], [0, -bw], [0, bw]].some(([a, b]) => inB(a, b));
    const tight = pts(2.22, -1.9, 2.4), wide = pts(2.95, -1.9, 2.6);
    const near = pts(3.6, -1.5, 3.2);
    // hard against a building: either plain railings, or the stone entrance that reads as part of the building
    if (tight) style = h < 0.45 ? "stone" : "railing";
    else if (near && h < 0.5) style = "stone";
    else {
      const k = h < 0.4 ? "railing" : h < 0.64 ? "kiosk" : h < 0.84 ? "canopy" : "stone";
      style = k === "canopy" && wide ? "kiosk" : k;
    }
  }
  styleCache.set(s, style);
  return style;
}

/** An oriented rectangle in plan: centre, unit a axis (ux, uz), half sizes along a and b = (uz, -ux). */
export interface Rect { x: number; z: number; ux: number; uz: number; ha: number; hb: number }

/** The holes in the street: every stair opening and every vent grate (exactly the gameplay rectangles). */
export function streetOpenings(u: Underground): Rect[] {
  const out: Rect[] = [];
  for (const s of u.shafts) {
    if (s.kind === "stairs") out.push({ x: s.x, z: s.z, ux: s.ux, uz: s.uz, ha: STAIRS.half, hb: STAIRS.halfWidth });
    else if (s.kind === "vent") out.push({ x: s.x, z: s.z, ux: s.ux, uz: s.uz, ha: VENT.halfLength, hb: VENT.halfWidth });
  }
  return out;
}

/** Holes for the harbour plane that lies under the whole city at y = -1.6 (ground.ts): wherever a shaft
 *  is open at that depth (stairwells down to where their ceiling drops below it, vents, small grates). */
export function deepOpenings(u: Underground): Rect[] {
  const out: Rect[] = [];
  const a1 = -STAIRS.half + (STAIRS.top - (-1.6 - STAIRS.headroom)) / STAIRS.slope + 0.2;
  for (const s of u.shafts) {
    if (s.kind === "stairs") out.push({ x: s.x + s.ux * (a1 - STAIRS.half) / 2, z: s.z + s.uz * (a1 - STAIRS.half) / 2, ux: s.ux, uz: s.uz, ha: (a1 + STAIRS.half) / 2, hb: STAIRS.halfWidth + 0.05 });
    else if (s.kind === "vent") out.push({ x: s.x, z: s.z, ux: s.ux, uz: s.uz, ha: VENT.halfLength + 0.1, hb: VENT.halfWidth + 0.1 });
    else out.push({ x: s.x, z: s.z, ux: s.ux, uz: s.uz, ha: s.r + 0.1, hb: s.r + 0.1 });
  }
  return out;
}

/** The tunnel's cross-section at s, as subway.ts draws it. */
export function tunnelShape(u: Underground, s: number) {
  let k = 0;
  for (const st of u.stations) { const d = Math.abs(st.ss - s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
  return { hw: TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k, ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k, k };
}

const N_STEPS = 36;
const RUN = (STAIRS_FOOT + STAIRS.half) / N_STEPS, RISE = (STAIRS.top - STAIRS.passageFloor) / N_STEPS;
/** the nosing line of the stairs */
const line = (a: number) => STAIRS.top - STAIRS.slope * (a + STAIRS.half);
/** the stair ceiling (Infinity over the open part) */
const stairCeil = (a: number) => (a < STAIRS.half ? Infinity : Math.min(STAIRS.roofUnder, line(a) + STAIRS.headroom));
/** where the passage starts (as the sdf has it) */
const P0 = STAIRS_FOOT - 0.6;

/** How far inside a stairwell's (or its passage's) air a point is (positive inside), as underground.ts has it. */
function stairAir(s: Shaft, x: number, y: number, z: number) {
  const a = (x - s.x) * s.ux + (z - s.z) * s.uz, b = (x - s.x) * s.uz - (z - s.z) * s.ux;
  const aa = Math.max(-STAIRS.half, Math.min(STAIRS_FOOT, a));
  const fl = line(aa);
  const ce = a < STAIRS.half ? 0.8 : Math.min(STAIRS.roofUnder, fl + STAIRS.headroom);
  const sv = Math.min(STAIRS.halfWidth - Math.abs(b), y - fl, ce - y, a + STAIRS.half, STAIRS_FOOT + 0.6 - a);
  const L = Math.hypot(s.tx, s.tz) || 1;
  const t = Math.max(P0, Math.min(L, a));
  const pv = Math.min(STAIRS.passageHalfWidth - Math.hypot(x - (s.x + s.ux * t), z - (s.z + s.uz * t)), y - STAIRS.passageFloor, STAIRS.passageCeiling - y);
  return Math.max(sv, pv);
}

/** Where a stairwell meets the tunnel or a station: aw = the first a (along its centre line) inside
 *  the tunnel's walls (Infinity if never, -Infinity if its opening is already over the tunnel). */
export interface StairCut { shaft: Shaft; aw: number; L: number; blocked: boolean; inside: (a: number) => { inside: boolean; ceil: number } }

export function stairCut(u: Underground, s: Shaft): StairCut {
  const sub = u.city.subway;
  const L = Math.hypot(s.tx, s.tz) || 1;
  const inside = (a: number) => {
    const n = sub.nearest(s.x + s.ux * a, s.z + s.uz * a);
    const w = tunnelShape(u, n.s);
    // the flooded stretch isn't drawn: there is nothing to open into
    const blocked = !!u.isBlocked(n.s) || n.s > u.end;
    return { inside: !blocked && Math.abs(n.off) < w.hw + 0.1, ceil: w.ceil };
  };
  let aw = Infinity;
  for (let a = -STAIRS.half; a <= L + 0.05; a += 0.05) if (inside(a).inside) { aw = a; break; }
  if (aw <= -STAIRS.half + 1e-6 && inside(-STAIRS.half).inside) aw = -Infinity;
  const n = sub.nearest(s.x + s.ux * L, s.z + s.uz * L);
  return { shaft: s, aw, L, blocked: !!u.isBlocked(n.s), inside };
}

export interface WallHole { s0: number; s1: number; side: number; y0: number; y1: number }

/** What subway.ts must cut out of the tunnel for the shafts: ceiling holes (stairs crossing it, vents)
 *  and holes in the side walls where a stair or passage comes through. */
export function subwayCuts(u: Underground): { ceil: Rect[]; walls: WallHole[] } {
  const sub = u.city.subway;
  const ceil: Rect[] = [], walls: WallHole[] = [];
  for (const s of u.shafts) {
    if (s.kind === "vent") { ceil.push({ x: s.x, z: s.z, ux: s.ux, uz: s.uz, ha: VENT.halfLength + 0.05, hb: VENT.halfWidth + 0.05 }); continue; }
    if (s.kind !== "stairs") continue;
    const c = stairCut(u, s);
    if (!isFinite(c.aw) && c.aw > 0) continue;
    const aStart = Math.max(c.aw, -STAIRS.half);
    const cl = c.inside(Math.max(aStart, 0)).ceil;
    // the ceiling: where the stair enclosure (0.5 m under the steps, 0.25 m over its ceiling) crosses it
    const aLo = -STAIRS.half + (STAIRS.top + 0.55 - cl) / STAIRS.slope;
    const aHi = -STAIRS.half + (STAIRS.top + STAIRS.headroom + 0.25 - cl) / STAIRS.slope;
    // (stairs that open straight into the hall: the hole runs on to where their air ends)
    const A0 = Math.max(aStart, aLo - 0.05), A1 = s.aCut !== undefined ? s.aCut + 0.05 : Math.min(aHi + 0.05, STAIRS_FOOT);
    if (A1 > A0) ceil.push({ x: s.x + s.ux * (A0 + A1) / 2, z: s.z + s.uz * (A0 + A1) / 2, ux: s.ux, uz: s.uz, ha: (A1 - A0) / 2, hb: STAIRS.halfWidth + 0.18 });
    // the side wall, where the stairwell or the passage comes through it
    if (c.aw > -STAIRS.half && isFinite(c.aw)) {
      const a = c.aw;
      let y0 = Infinity, y1 = -Infinity, hb = STAIRS.halfWidth + 0.15;
      if (a < STAIRS_FOOT) { y0 = Math.min(y0, line(a) - 0.6); y1 = Math.max(y1, stairCeil(a) + 0.25); }
      if (a >= P0) { y0 = Math.min(y0, STAIRS.passageFloor - 0.05); y1 = Math.max(y1, STAIRS.passageCeiling); hb = STAIRS.passageHalfWidth; }
      y0 = Math.max(y0, TUNNEL.floor + 0.2);
      y1 = Math.min(y1, cl + 0.5);
      if (y1 > y0 + 0.2) {
        const pa = sub.nearest(s.x + s.ux * a + s.uz * (hb + 0.05), s.z + s.uz * a - s.ux * (hb + 0.05));
        const pb = sub.nearest(s.x + s.ux * a - s.uz * (hb + 0.05), s.z + s.uz * a + s.ux * (hb + 0.05));
        const pm = sub.nearest(s.x + s.ux * a, s.z + s.uz * a);
        walls.push({ s0: Math.min(pa.s, pb.s) - 0.05, s1: Math.max(pa.s, pb.s) + 0.05, side: pm.off >= 0 ? 1 : -1, y0, y1 });
      }
    }
  }
  return { ceil, walls };
}

// ------------------------------------------------------------------ cutting holes in flat geometry

/**
 * Cuts oriented rectangles out of a mesh, seen from above: triangles overlapping a hole are clipped
 * against it (every attribute interpolated, so uvs, colours and normals stay right) and the parts
 * inside dropped. Vertical faces (no area in plan) are dropped if their centre is inside a hole.
 * Returns the geometry untouched when no hole is near it.
 */
export function cutRects(geo: THREE.BufferGeometry, rects: Rect[]): THREE.BufferGeometry {
  if (!rects.length) return geo;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const ext = rects.map((r) => {
    const ex = Math.abs(r.ux) * r.ha + Math.abs(r.uz) * r.hb, ez = Math.abs(r.uz) * r.ha + Math.abs(r.ux) * r.hb;
    return [r.x - ex, r.z - ez, r.x + ex, r.z + ez];
  });
  const near = rects.map((_, i) => i).filter((i) => ext[i][2] >= bb.min.x && ext[i][0] <= bb.max.x && ext[i][3] >= bb.min.z && ext[i][1] <= bb.max.z);
  if (!near.length) return geo;
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes);
  const attrs = names.map((n) => g.attributes[n] as THREE.BufferAttribute);
  const sizes = attrs.map((a) => a.itemSize);
  const S = sizes.reduce((a, b) => a + b, 0);
  const posOff = sizes.slice(0, names.indexOf("position")).reduce((a, b) => a + b, 0);
  // grid of the holes near this mesh
  const cell = 16, grid = new Map<number, number[]>();
  const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
  for (const i of near) {
    const [x0, z0, x1, z1] = ext[i];
    for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {
      const k = key(ix, iz);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
  }
  const arrays = attrs.map((a) => a.array as ArrayLike<number>);
  const vert = (i: number) => {
    const v = new Float64Array(S);
    let o = 0;
    for (let k = 0; k < attrs.length; k++) { const sz = sizes[k], arr = arrays[k]; for (let c = 0; c < sz; c++) v[o + c] = arr[i * sz + c]; o += sz; }
    return v;
  };
  const out: number[] = [];
  const push = (v: Float64Array) => { for (let c = 0; c < S; c++) out.push(v[c]); };
  const lerp = (a: Float64Array, b: Float64Array, t: number) => { const v = new Float64Array(S); for (let c = 0; c < S; c++) v[c] = a[c] + (b[c] - a[c]) * t; return v; };
  /** split a convex polygon by f(v) >= 0 (outside) and f < 0 (inside) */
  const split = (poly: Float64Array[], f: (v: Float64Array) => number) => {
    const o: Float64Array[] = [], i: Float64Array[] = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length], fa = f(a), fb = f(b);
      (fa >= 0 ? o : i).push(a);
      if ((fa >= 0) !== (fb >= 0)) { const v = lerp(a, b, fa / (fa - fb)); o.push(v); i.push(v); }
    }
    return [o, i];
  };
  const pos = arrays[names.indexOf("position")];
  const cand: number[] = [];
  const n = pos.length / 3;
  let touched = false;
  for (let t = 0; t < n; t += 3) {
    const x0 = Math.min(pos[t * 3], pos[t * 3 + 3], pos[t * 3 + 6]), x1 = Math.max(pos[t * 3], pos[t * 3 + 3], pos[t * 3 + 6]);
    const z0 = Math.min(pos[t * 3 + 2], pos[t * 3 + 5], pos[t * 3 + 8]), z1 = Math.max(pos[t * 3 + 2], pos[t * 3 + 5], pos[t * 3 + 8]);
    cand.length = 0;
    for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {
      const l = grid.get(key(ix, iz));
      if (l) for (const r of l) if (!cand.includes(r) && ext[r][2] >= x0 && ext[r][0] <= x1 && ext[r][3] >= z0 && ext[r][1] <= z1) cand.push(r);
    }
    const tri = [vert(t), vert(t + 1), vert(t + 2)];
    if (!cand.length) { tri.forEach(push); continue; }
    touched = true;
    const area = (tri[1][posOff] - tri[0][posOff]) * (tri[2][posOff + 2] - tri[0][posOff + 2]) - (tri[2][posOff] - tri[0][posOff]) * (tri[1][posOff + 2] - tri[0][posOff + 2]);
    if (Math.abs(area) < 1e-5) {
      const cx = (tri[0][posOff] + tri[1][posOff] + tri[2][posOff]) / 3, cz = (tri[0][posOff + 2] + tri[1][posOff + 2] + tri[2][posOff + 2]) / 3;
      const hit = cand.some((i) => { const r = rects[i], dx = cx - r.x, dz = cz - r.z; return Math.abs(dx * r.ux + dz * r.uz) < r.ha && Math.abs(dx * r.uz - dz * r.ux) < r.hb; });
      if (!hit) tri.forEach(push);
      continue;
    }
    let polys: Float64Array[][] = [tri];
    for (const i of cand) {
      const r = rects[i];
      const fa = (v: Float64Array) => (v[posOff] - r.x) * r.ux + (v[posOff + 2] - r.z) * r.uz;
      const fb = (v: Float64Array) => (v[posOff] - r.x) * r.uz - (v[posOff + 2] - r.z) * r.ux;
      const planes = [(v: Float64Array) => fa(v) - r.ha, (v: Float64Array) => -fa(v) - r.ha, (v: Float64Array) => fb(v) - r.hb, (v: Float64Array) => -fb(v) - r.hb];
      const next: Float64Array[][] = [];
      for (const p of polys) {
        let rem: Float64Array[] = p;
        for (const f of planes) {
          const [o, inn] = split(rem, f);
          if (o.length >= 3) next.push(o);
          rem = inn;
          if (rem.length < 3) break;
        }
      }
      polys = next;
    }
    for (const p of polys) for (let k = 1; k < p.length - 1; k++) { push(p[0]); push(p[k]); push(p[k + 1]); }
  }
  if (!touched) return geo;
  const res = new THREE.BufferGeometry();
  const nv = out.length / S;
  let o = 0;
  attrs.forEach((a, k) => {
    const sz = sizes[k], arr = new Float32Array(nv * sz);
    for (let i = 0; i < nv; i++) for (let c = 0; c < sz; c++) arr[i * sz + c] = out[i * S + o + c];
    res.setAttribute(names[k], new THREE.BufferAttribute(arr, sz, a.normalized));
    o += sz;
  });
  return res;
}

// ------------------------------------------------------------------ a little geometry builder (local frame)

type V3 = [number, number, number];
type UV = [number, number];

class Buf {
  pos: number[] = []; nor: number[] = []; uv: number[] = [];
  /** drop quads whose centre fails this (local coordinates) */
  constructor(readonly keep?: (x: number, y: number, z: number) => boolean) {}
  /** a quad (any winding), flipped to face along n */
  quad(p: V3[], uv: UV[], n: V3) {
    if (this.keep) {
      // test in pieces of about a metre, so a surface that only partly runs into a neighbour keeps the rest
      const d = (i: number, j: number) => Math.hypot(p[j][0] - p[i][0], p[j][1] - p[i][1], p[j][2] - p[i][2]);
      const nu = Math.min(4, Math.ceil(Math.max(d(0, 1), d(3, 2)) / 1.0)), nv = Math.min(4, Math.ceil(Math.max(d(1, 2), d(0, 3)) / 1.0));
      const P = (u: number, v: number): V3 => [0, 1, 2].map((k) => (p[0][k] * (1 - u) + p[1][k] * u) * (1 - v) + (p[3][k] * (1 - u) + p[2][k] * u) * v) as V3;
      const T = (u: number, v: number): UV => [0, 1].map((k) => (uv[0][k] * (1 - u) + uv[1][k] * u) * (1 - v) + (uv[3][k] * (1 - u) + uv[2][k] * u) * v) as UV;
      const keep = this.keep;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
        const c = P((u0 + u1) / 2, (v0 + v1) / 2);
        if (!keep(c[0], c[1], c[2])) continue;
        this.emit([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], [T(u0, v0), T(u1, v0), T(u1, v1), T(u0, v1)], n);
      }
      return;
    }
    this.emit(p, uv, n);
  }
  private emit(p: V3[], uv: UV[], n: V3) {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const flip = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const i of order) { this.pos.push(...p[i]); this.nor.push(n[0] / L, n[1] / L, n[2] / L); this.uv.push(...uv[i]); }
  }
  /** add a geometry (non-indexed or indexed), transformed */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4) {
    const h = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    const p = h.attributes.position.array, nn = h.attributes.normal?.array, uv = h.attributes.uv?.array;
    for (let i = 0; i < p.length / 3; i++) {
      this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      if (nn) this.nor.push(nn[i * 3], nn[i * 3 + 1], nn[i * 3 + 2]); else this.nor.push(0, 1, 0);
      if (uv) this.uv.push(uv[i * 2], uv[i * 2 + 1]); else this.uv.push(0, 0);
    }
  }
  /** to world space for a shaft frame, with baked light in vertex colours */
  geometry(s: { x: number; z: number; ux: number; uz: number }, light: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number) {
    const n = this.pos.length / 3;
    if (!n) return null;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const X = this.pos[i * 3], Y = this.pos[i * 3 + 1], Z = this.pos[i * 3 + 2];
      const nX = this.nor[i * 3], nY = this.nor[i * 3 + 1], nZ = this.nor[i * 3 + 2];
      P[i * 3] = s.x + s.ux * Z + s.uz * X; P[i * 3 + 1] = Y; P[i * 3 + 2] = s.z + s.uz * Z - s.ux * X;
      N[i * 3] = s.ux * nZ + s.uz * nX; N[i * 3 + 1] = nY; N[i * 3 + 2] = s.uz * nZ - s.ux * nX;
      const l = light(X, Y, Z, nX, nY, nZ);
      C[i * 3] = l * 1.0; C[i * 3 + 1] = l * 0.985; C[i * 3 + 2] = l * 0.95;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute("color", new THREE.BufferAttribute(C, 3));
    return g;
  }
}

/** a round bar between two points (for handrails), uv pinned to one atlas texel */
function bar(b: Buf, p: V3, q: V3, r: number, uv: UV, segs = 6) {
  const d = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const L = d.length();
  if (L < 1e-4) return;
  const g = new THREE.CylinderGeometry(r, r, L, segs, 1, true).translate(0, L / 2, 0);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).setPosition(p[0], p[1], p[2]);
  const uvA = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uv[0], uv[1]);
  b.add(g, m);
}

// ------------------------------------------------------------------ assets

interface Meta { atlas: { size: [number, number]; rects: Record<string, [number, number, number, number]> } }
type MatName = "atlas" | "metal" | "glow" | "glass" | "grate";
interface Part { geo: THREE.BufferGeometry; mat: MatName }

const Yax = new THREE.Vector3(0, 1, 0);

/** an instanced model placed at many spots, only the ones near the camera drawn */
class Placed {
  readonly meshes: THREE.InstancedMesh[] = [];
  private mats: Float32Array;
  constructor(readonly name: string, parts: Part[], mats: Record<MatName, THREE.Material>, readonly at: { x: number; z: number; m: THREE.Matrix4 }[], root: THREE.Object3D, shadow: boolean) {
    this.mats = new Float32Array(at.length * 16);
    at.forEach((p, i) => p.m.toArray(this.mats, i * 16));
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geo, mats[p.mat], Math.max(1, at.length));
      im.name = `${name}:${p.mat}`;
      im.frustumCulled = false;
      im.count = 0;
      im.castShadow = shadow && p.mat !== "glass" && p.mat !== "glow";
      im.receiveShadow = p.mat !== "glow";
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (p.mat === "glass" || p.mat === "grate") im.renderOrder = 2;
      this.meshes.push(im);
      root.add(im);
    }
  }
  /** show the ones within r of (x, z); extra(i) lets callers override a matrix (spinning fans) */
  update(x: number, z: number, r: number, live?: (i: number, out: THREE.Matrix4) => void) {
    let n = 0;
    const tmp = new THREE.Matrix4();
    for (const im of this.meshes) {
      const arr = im.instanceMatrix.array as Float32Array;
      n = 0;
      for (let i = 0; i < this.at.length; i++) {
        const p = this.at[i];
        if ((p.x - x) ** 2 + (p.z - z) ** 2 > r * r) continue;
        if (live) { live(i, tmp); tmp.toArray(arr, n * 16); } else arr.set(this.mats.subarray(i * 16, i * 16 + 16), n * 16);
        n++;
      }
      im.count = n;
      im.visible = n > 0;
      im.instanceMatrix.needsUpdate = true;
    }
    return n;
  }
}

// ------------------------------------------------------------------ particles: vent plumes and suction

function softDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const PLUME_VS = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime, uScale, uIn;
  varying float vA; varying vec3 vC; varying float vLitter; varying float vRot;
  float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
  void main(){
    float litter = step(uIn > 0.5 ? 0.55 : 0.94, aSeed.w);
    vec3 p; float size; float a;
    if (uIn < 0.5) {
      // ways out: a column of tunnel air blasting up past the rooftops
      float T = mix(1.9, 3.0, aSeed.y) * mix(1.0, 0.75, litter);
      float ph = fract(uTime / T + aSeed.x);
      float top = mix(26.0, 36.0, aSeed.z) * mix(1.0, 0.95, litter);
      float hgt = -2.0 + (top + 2.0) * (1.0 - pow(1.0 - ph, mix(1.7, 2.3, aSeed.z)));
      vec2 o = vec2(aSeed.z * 2.0 - 1.0, h1(aSeed.y * 31.7) * 2.0 - 1.0) * vec2(1.25, 4.4);
      float spread = 1.0 + max(hgt, 0.0) / 9.0;
      o *= spread;
      o += vec2(sin(uTime * 1.3 + aSeed.x * 40.0), cos(uTime * 1.1 + aSeed.y * 30.0)) * max(hgt, 0.0) * 0.06;
      if (litter > 0.5) o += vec2(sin(uTime * 3.0 + aSeed.x * 60.0), cos(uTime * 2.6 + aSeed.y * 50.0)) * (0.3 + hgt * 0.05);
      p = vec3(o.x, hgt, o.y);
      size = litter > 0.5 ? mix(0.12, 0.26, aSeed.z) : 1.1 + max(hgt, 0.0) * 0.24;
      a = smoothstep(0.0, 0.05, ph) * pow(1.0 - ph, 1.3) * (litter > 0.5 ? 1.0 : 0.46);
      vC = litter > 0.5 ? mix(vec3(0.55, 0.30, 0.1), vec3(0.85, 0.82, 0.75), step(0.75, h1(aSeed.x * 91.0)))
                        : mix(vec3(1.0, 0.78, 0.55), vec3(0.93, 0.94, 0.97), smoothstep(-1.0, 6.0, hgt));
    } else {
      // ways in: grit and leaves spiralling in from round about and sucked down through the bars
      float T = mix(1.8, 3.2, aSeed.y);
      float ph = fract(uTime / T + aSeed.x);
      float r0 = mix(2.0, 8.0, aSeed.z);
      float ang = aSeed.y * 6.2832 + ph * 3.5;
      float r = r0 * pow(1.0 - ph, 1.4);
      float y0 = mix(0.15, 3.5, h1(aSeed.z * 17.0));
      float hgt = mix(y0, -2.6, pow(ph, 1.8));
      p = vec3(cos(ang) * r * 0.45, hgt, sin(ang) * r);
      p.x = clamp(p.x, -1.6 - r0 * 0.5, 1.6 + r0 * 0.5);
      size = litter > 0.5 ? mix(0.12, 0.24, aSeed.z) : mix(0.3, 0.7, aSeed.z);
      a = smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.85, 1.0, ph)) * (litter > 0.5 ? 1.0 : 0.05);
      vC = litter > 0.5 ? mix(vec3(0.5, 0.28, 0.1), vec3(0.75, 0.45, 0.15), h1(aSeed.x * 13.0)) : vec3(0.75, 0.72, 0.66);
    }
    vLitter = litter;
    vRot = uTime * mix(4.0, 11.0, aSeed.y) + aSeed.x * 20.0;
    vA = a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = max(litter > 0.5 ? 1.5 : 1.0, size * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PLUME_FS = /* glsl */ `
  uniform sampler2D uTex;
  varying float vA; varying vec3 vC; varying float vLitter; varying float vRot;
  void main(){
    vec2 q = gl_PointCoord - 0.5;
    float a;
    if (vLitter > 0.5) {
      float c = cos(vRot), s = sin(vRot);
      q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
      q.y *= 1.0 + 0.8 * abs(sin(vRot * 0.7));   // tumbling: the scrap foreshortens as it turns
      a = step(abs(q.x) + abs(q.y) * 1.4, 0.42) * vA;
      if (a < 0.5) discard;
    } else a = texture2D(uTex, gl_PointCoord).a * vA;
    gl_FragColor = vec4(vC * a, a);
  }`;

// ------------------------------------------------------------------ the whole thing

/**
 *   const entrances = new SubwayEntrances(flow.under, { quality, onLamp });
 *   scene.add(entrances.root);
 *   await entrances.load();
 *   entrances.update(t, cam.position);   // every frame
 */
export class SubwayEntrances {
  readonly root = new THREE.Group();
  ready = false;
  private meta!: Meta;
  private parts = new Map<string, Part[]>();
  private interiors: { g: THREE.Group; x0: number; z0: number; x1: number; z1: number }[] = [];
  private placed: Placed[] = [];
  private fans: { x: number; z: number; yaw: number; y: number; out: boolean; phase: number }[] = [];
  private rotors: Placed[] = [];
  private fanLists: (typeof this.fans)[] = [];
  private plumes: { pts: THREE.Points; x: number; z: number; out: boolean }[] = [];
  private plumeMats: THREE.ShaderMaterial[] = [];
  private beams: THREE.Mesh[] = [];
  private jets: THREE.Mesh[] = [];
  private mats!: Record<MatName, THREE.Material>;
  private lowQ: boolean;

  constructor(readonly u: Underground, readonly opts: { base?: string; quality?: "low" | "medium" | "high"; onLamp?: (x: number, y: number, z: number) => void } = {}) {
    this.root.name = "subwayEntrances";
    this.lowQ = opts.quality === "low";
  }

  async load(): Promise<void> {
    const base = this.opts.base ?? "./";
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const tl = new THREE.TextureLoader();
    const tex = (f: string, flip: boolean, repeat: boolean, srgb = true) => tl.loadAsync(base + f).then((t) => {
      t.flipY = flip; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
    });
    const [gltf, meta, atlas, wall, grate, floor] = await Promise.all([
      new GLTFLoader().loadAsync(base + "models/entrances.glb"),
      fetch(base + "models/entrances.json").then((r) => r.json() as Promise<Meta>),
      tex("textures/entrances/atlas.webp", false, false), tex("textures/entrances/stair_wall.webp", true, true),
      tex("textures/entrances/grate.png", false, true), tex("models/subway_floor.jpg", true, true),
    ]);
    this.meta = meta;
    gltf.scene.updateMatrixWorld(true);
    for (const obj of gltf.scene.children) {
      const list: Part[] = [];
      const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const geo = m.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        list.push({ geo, mat: (((m.material as THREE.Material).name || "atlas").replace(/\.\d+$/, "")) as MatName });
      });
      this.parts.set(obj.name, list);
    }
    this.mats = this.makeMaterials(atlas, grate);
    this.buildEntrances();
    this.buildVents();
    this.buildInteriors(atlas, wall, floor);
    this.ready = true;
  }

  private makeMaterials(atlas: THREE.Texture, grate: THREE.Texture): Record<MatName, THREE.Material> {
    const a = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.75, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.04 });
    const metal = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.38, metalness: 0.55, envMapIntensity: 0.4, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.03 });
    const glow = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
    glow.color.setScalar(1.35);
    const glass = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    const gr = new THREE.MeshStandardMaterial({ map: grate, roughness: 0.5, metalness: 0.6, transparent: true, alphaTest: 0.05, depthWrite: false, side: THREE.DoubleSide, color: 0xb8b8b8 });
    return { atlas: a, metal, glow, glass, grate: gr };
  }

  // --- atlas helpers -------------------------------------------------------------------

  private uv(name: string, s = 0.5, t = 0.5): UV {
    const [W, H] = this.meta.atlas.size;
    const [x, y, w, h] = this.meta.atlas.rects[name];
    s = Math.min(1, Math.max(0, s)); t = Math.min(1, Math.max(0, t));
    return [(x + 0.5 + s * (w - 1)) / W, (y + 0.5 + (1 - t) * (h - 1)) / H];
  }

  private remap(parts: Part[], pairs: [string, string][]): Part[] {
    if (!pairs.length) return parts;
    const [W, H] = this.meta.atlas.size;
    const r = (n: string) => { const [x, y, w, h] = this.meta.atlas.rects[n]; return { u0: x / W, v0: y / H, u1: (x + w) / W, v1: (y + h) / H }; };
    return parts.map((p) => {
      if (p.mat === "grate") return p;
      const geo = p.geo.clone();
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (const [a, b] of pairs) {
        const f = r(a), t = r(b), e = 1e-4;
        for (let i = 0; i < uv.count; i++) {
          const x = uv.getX(i), y = uv.getY(i);
          if (x < f.u0 - e || x > f.u1 + e || y < f.v0 - e || y > f.v1 + e) continue;
          uv.setXY(i, t.u0 + ((x - f.u0) / (f.u1 - f.u0)) * (t.u1 - t.u0), t.v0 + ((y - f.v0) / (f.v1 - f.v0)) * (t.v1 - t.v0));
        }
      }
      return { geo, mat: p.mat };
    });
  }

  private frame(x: number, y: number, z: number, ux: number, uz: number, extra?: THREE.Matrix4) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Yax, Math.atan2(ux, uz)), new THREE.Vector3(1, 1, 1));
    return extra ? m.multiply(extra) : m;
  }

  // --- the street entrances ----------------------------------------------------------------

  private buildEntrances() {
    const OUT: [string, string][] = [["globe_green", "globe_red"], ["cartouche_in", "cartouche_out"], ["lintel_in", "lintel_out"], ["band_in", "band_out"], ["sign_subway", "sign_exit"]];
    for (const style of ["kiosk", "canopy", "stone"] as const) {
      for (const out of [false, true]) {
        const at = this.u.shafts.filter((s) => s.kind === "stairs" && !!s.out === out && entranceStyle(s, this.u) === style)
          .map((s) => ({ x: s.x, z: s.z, m: this.frame(s.x, STAIRS.top, s.z, s.ux, s.uz) }));
        if (!at.length) continue;
        this.placed.push(new Placed(`${style}${out ? "_out" : ""}`, this.remap(this.parts.get(style)!, out ? OUT : []), this.mats, at, this.root, !this.lowQ));
      }
    }
  }

  // --- the vents --------------------------------------------------------------------------

  private buildVents() {
    const vents = this.u.shafts.filter((s) => s.kind === "vent");
    const OUT: [string, string][] = [["hazard", "hazard_red"], ["warn_in", "warn_out"], ["fluor", "amber"]];
    // the shaft and fans are lit by their own work lights: brighter self-light so they read through the bars
    const lit: Record<MatName, THREE.Material> = { ...this.mats };
    for (const k of ["atlas", "metal"] as const) {
      const m = (this.mats[k] as THREE.MeshStandardMaterial).clone();
      m.emissiveIntensity = 0.42;
      lit[k] = m;
    }
    for (const out of [false, true]) {
      const list = vents.filter((v) => !!v.out === out);
      if (!list.length) continue;
      const at = list.map((v) => ({ x: v.x, z: v.z, m: this.frame(v.x, 0, v.z, v.ux, v.uz) }));
      for (const name of ["vent_frame", "vent_shaft", "fan_frame"]) {
        if (name === "fan_frame") {
          const fat: typeof at = [];
          for (const v of list) for (const a of [-3.05, 0, 3.05]) fat.push({ x: v.x, z: v.z, m: this.frame(v.x + v.ux * a, -1.55, v.z + v.uz * a, v.ux, v.uz) });
          this.placed.push(new Placed(name + (out ? "_out" : ""), this.remap(this.parts.get(name)!, out ? OUT : []), lit, fat, this.root, false));
        } else this.placed.push(new Placed(name + (out ? "_out" : ""), this.remap(this.parts.get(name)!, out ? OUT : []), name === "vent_frame" ? this.mats : lit, at, this.root, false));
      }
      // the rotors: spun every frame
      const rat: { x: number; z: number; m: THREE.Matrix4 }[] = [];
      for (const v of list) for (const [k, a] of [-3.05, 0, 3.05].entries()) {
        this.fans.push({ x: v.x + v.ux * a, z: v.z + v.uz * a, yaw: Math.atan2(v.ux, v.uz), y: -1.55, out, phase: k * 0.7 + hash2(v.x, v.z) * 6 });
        rat.push({ x: v.x, z: v.z, m: new THREE.Matrix4() });
      }
      this.rotors.push(new Placed("fan_rotor" + (out ? "_out" : ""), this.parts.get("fan_rotor")!, lit, rat, this.root, false));
    }
    // light pouring up out of the shaft: warm at the ways out, cold at the ways in
    const beamGeo = new THREE.BoxGeometry(VENT.halfWidth * 2 - 0.1, 1, VENT.halfLength * 2 - 0.1, 1, 1, 1).translate(0, 0.5, 0);
    for (const v of vents) {
      const H = v.out ? 9 : 3.5;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        uniforms: { uCol: { value: v.out ? new THREE.Color(1.0, 0.55, 0.22) : new THREE.Color(0.55, 0.7, 0.9) }, uA: { value: v.out ? 0.22 : 0.1 } },
        vertexShader: "varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "uniform vec3 uCol; uniform float uA; varying float vY; void main(){ float a = pow(1.0 - clamp(vY, 0.0, 1.0), 2.2) * uA; gl_FragColor = vec4(uCol * a, a); }",
      });
      const m = new THREE.Mesh(beamGeo, mat);
      m.scale.y = H + 2.6;
      m.position.set(v.x, -2.6, v.z);
      m.rotation.y = Math.atan2(v.ux, v.uz);
      m.renderOrder = 3;
      m.visible = false;
      this.beams.push(m);
      this.root.add(m);
    }
    // the jet itself: a column of fast-scrolling turbulence over each way out, readable from blocks away
    const jetMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: "varying vec2 vUv; varying float vY; varying float vFace; void main(){ vUv = uv; vY = (modelMatrix * vec4(position, 1.0)).y; vec4 mv = modelViewMatrix * vec4(position,1.0); vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }",
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vY; varying float vFace;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          vec2 p = vec2(vUv.x * 9.0, vY * 0.35 - uTime * 7.0);
          float t = n(p) * 0.6 + n(p * 2.3 + 7.0) * 0.4;
          float a = smoothstep(0.3, 0.75, t) * (1.0 - smoothstep(6.0, 31.0, vY)) * smoothstep(-0.5, 1.0, vY) * 0.45 * pow(vFace, 1.5);
          vec3 c = mix(vec3(1.0, 0.82, 0.62), vec3(0.95, 0.96, 0.98), smoothstep(0.0, 8.0, vY));
          gl_FragColor = vec4(c * a, a);
        }`,
    });
    jetMat.blending = THREE.CustomBlending;
    jetMat.blendSrc = THREE.OneFactor; jetMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.plumeMats.push(jetMat);
    const jetGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 12, true).translate(0, 0.5, 0);
    { // flare out with height
      const p = jetGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 1 + y * 2.2; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    }
    for (const v of vents.filter((q) => q.out)) {
      const m = new THREE.Mesh(jetGeo, jetMat);
      m.scale.set(VENT.halfWidth * 0.9, 32, VENT.halfLength * 0.85);
      m.position.set(v.x, 0, v.z);
      m.rotation.y = Math.atan2(v.ux, v.uz);
      m.renderOrder = 4;
      m.frustumCulled = false;
      m.visible = false;
      this.jets.push(m);
      this.root.add(m);
    }
    // the plumes and the suction
    const dot = softDot();
    for (const out of [false, true]) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uIn: { value: out ? 0 : 1 }, uTex: { value: dot } },
        vertexShader: PLUME_VS, fragmentShader: PLUME_FS,
      });
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;   // premultiplied
      this.plumeMats.push(mat);
      const N = Math.round((out ? 420 : 140) * (this.lowQ ? 0.5 : 1));
      for (const v of vents.filter((q) => !!q.out === out)) {
        const seeds = new Float32Array(N * 4);
        let k = hash2(v.x, v.z) * 1000;
        const r = () => { k = (k * 16807 + 11) % 2147483647; return (k % 100000) / 100000; };
        for (let i = 0; i < N * 4; i++) seeds[i] = r();
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
        g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
        const pts = new THREE.Points(g, mat);
        pts.frustumCulled = false;
        pts.position.set(v.x, 0, v.z);
        pts.rotation.y = Math.atan2(v.ux, v.uz);
        pts.renderOrder = 4;
        pts.visible = false;
        this.plumes.push({ pts, x: v.x, z: v.z, out });
        this.root.add(pts);
      }
    }
  }

  // --- the stairwells and passages ----------------------------------------------------------

  private buildInteriors(atlas: THREE.Texture, wallTex: THREE.Texture, floorTex: THREE.Texture) {
    // interior materials: the baked light in the vertex colours also drives a little self-light, so the
    // stairs read underground before the camera's point lights reach them
    const lit = (m: THREE.MeshStandardMaterial) => {
      m.vertexColors = true;
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif");
      };
      return m;
    };
    const wallMat = lit(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.3, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.17 }));
    const fl = floorTex.clone();
    fl.repeat.set(1 / 4, 1 / 4); fl.needsUpdate = true;
    const floorMat = lit(new THREE.MeshStandardMaterial({ map: fl, roughness: 0.6, color: 0x9a948a, emissive: 0xffffff, emissiveMap: fl, emissiveIntensity: 0.25 }));
    const atlasMat = lit(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.7, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.2 }));
    const metalMat = lit(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.3, metalness: 0.6, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.3 }));
    const glowMat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
    glowMat.color.setScalar(1.6);
    const groups = new Map<string, Shaft[]>();
    for (const s of this.u.shafts) if (s.kind === "stairs") (groups.get(s.name) ?? groups.set(s.name, []).get(s.name)!).push(s);
    for (const [name, list] of groups) {
      const per: Record<string, THREE.BufferGeometry[]> = { wall: [], floor: [], atlas: [], metal: [], glow: [] };
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const s of list) {
        const L = Math.hypot(s.tx, s.tz);
        for (const [x, z] of [[s.x, s.z], [s.x + s.ux * L, s.z + s.uz * L]]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        const geos = this.buildStair(s);
        for (const k in geos) if (geos[k]) per[k].push(geos[k]!);
      }
      const g = new THREE.Group();
      g.name = "stairs:" + name;
      const mats: Record<string, THREE.Material> = { wall: wallMat, floor: floorMat, atlas: atlasMat, metal: metalMat, glow: glowMat };
      for (const k in per) {
        if (!per[k].length) continue;
        const m = new THREE.Mesh(mergeGeometries(per[k])!, mats[k]);
        m.receiveShadow = true;
        m.name = `stairs:${name}:${k}`;
        g.add(m);
      }
      g.visible = false;
      this.interiors.push({ g, x0, z0, x1, z1 });
      this.root.add(g);
    }
  }

  /** One stairwell (and its passage), in world space, per material. */
  private buildStair(s: Shaft): Record<string, THREE.BufferGeometry | null> {
    const cut = stairCut(this.u, s);
    const HW = STAIRS.halfWidth, PW = STAIRS.passageHalfWidth;
    // where the stair is in the open hall of a tunnel or station (and so not drawn): per a
    const passEnd = cut.aw === Infinity ? cut.L : Math.min(cut.L, Math.max(cut.aw, -STAIRS.half)) + (cut.blocked ? 0 : 0.15);
    // stairs over the hall open straight into it through its ceiling (or wall): the steps stop where
    // they reach the hall's ceiling and the stairwell ends at aCut, with nothing of it in the hall
    const intoHall = s.aCut !== undefined;
    const hallCeil = intoHall ? cut.inside(Math.max(s.aw!, 0)).ceil : 0;
    const stepsEnd = intoHall ? Math.min(STAIRS_FOOT, Math.max(s.aw!, stairsBelow(hallCeil, 0))) : Infinity;
    const hasPassage = !intoHall && passEnd > P0 + 0.3;
    // side-by-side entrances share their air: leave out any surface of this one that lies inside another's
    const others = this.u.shafts.filter((o) => o !== s && o.kind === "stairs" && Math.hypot(o.x - s.x, o.z - s.z) < Math.hypot(s.tx, s.tz) + Math.hypot(o.tx, o.tz) + 12);
    const keep = others.length ? (X: number, Y: number, Z: number) => {
      const x = s.x + s.ux * Z + s.uz * X, z = s.z + s.uz * Z - s.ux * X;
      return !others.some((o) => stairAir(o, x, Y, z) > 0.08);
    } : undefined;
    const wall = new Buf(keep), floor = new Buf(keep), at = new Buf(keep), metal = new Buf(), glow = new Buf();
    const fixtures: V3[] = [];
    const U = (n: string, s0 = 0.5, t0 = 0.5) => this.uv(n, s0, t0);
    const quadR = (b: Buf, p: V3[], rect: string, st: UV[], n: V3) => b.quad(p, st.map(([u, v]) => U(rect, u, v)), n);
    const wallUV = (a: number, h: number): UV => [a / 2, (h + 0.6) / 5];

    // ---- steps, stringers, underside. Where the stairwell runs into a station or the tunnel it carries
    // on as a tiled stair enclosure down to a landing (the leaf flies out of its open end)
    const LAND = 1.4;
    const aEnd = intoHall ? s.aCut! : hasPassage ? P0 : STAIRS_FOOT + LAND;
    const lineC = (a: number) => line(Math.min(a, STAIRS_FOOT));
    // (stairs that come down through a station's ceiling: their stairwell is a real one, its ceiling raked
    // parallel to the flight 2.3 m over the treads all the way from the street opening, so looking up from the
    // platform you see a lit, sloping stairwell going up and away. The air (world/underground.ts) is unchanged:
    // the leaf's path down it runs 1.3 m over the treads)
    const RAKE = 2.3;
    const stairTop = intoHall ? (a: number) => (a < STAIRS.half ? Infinity : Math.min(STAIRS.roofUnder, line(a) + RAKE)) : stairCeil;
    const ceilC = (a: number) => stairTop(Math.min(a, STAIRS_FOOT));
    // (over the hall nothing of the stairs hangs under its ceiling: the soffit is boxed in flush with it)
    const under = (y: number) => (intoHall ? Math.max(y, hallCeil + 0.006) : y);
    /** where the opening in the station's ceiling starts (along a): from there the stairwell is the well's,
     *  painted like its lining, so the view up it is one finished shaft (not tiled panels at angles) */
    let wellA0 = Infinity;
    for (let i = 0; i < N_STEPS; i++) {
      const a0 = -STAIRS.half + i * RUN, a1 = a0 + RUN, yT = line(a1), yN = line(a0);
      if (a0 >= stepsEnd - 1e-4) {
        // the last step's edge, where the stairs drop away into the hall
        if (a0 < stepsEnd + RUN && under(yN - 0.5) < yN - 0.01) quadR(at, [[-HW, under(yN - 0.5), a0], [HW, under(yN - 0.5), a0], [HW, yN, a0], [-HW, yN, a0]], "yellow", [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, 1]);
        continue;
      }
      const w = a1 > P0 && hasPassage ? PW : HW;
      // the riser drops from the tread above (at a0) to this one; the yellow nosing is on this tread's far edge
      quadR(at, [[-w, yT, a0], [w, yT, a0], [w, yN, a0], [-w, yN, a0]], "riser", [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, 1]);
      quadR(at, [[-w, yT, a0], [w, yT, a0], [w, yT, a1], [-w, yT, a1]], "tread", [[0, 1], [1, 1], [1, 0], [0, 0]], [0, 1, 0]);
      quadR(at, [[-w, under(yN - 0.5), a0], [w, under(yN - 0.5), a0], [w, under(yT - 0.5), a1], [-w, under(yT - 0.5), a1]], intoHall ? "ceiling_paint" : "concrete_shaft",
        intoHall ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], [0, -1, -STAIRS.slope]);
      for (const sx of [-1, 1]) {
        const x = sx * (HW - 0.02);
        if (a0 < P0 || !hasPassage) quadR(at, [[x, yN + 0.12, a0], [x, yT + 0.12, a1], [x, under(yT - RISE - 0.02), a1], [x, under(yN - RISE - 0.02), a0]], "stringer",
          [[0, 1], [0.5, 1], [0.5, 0], [0, 0]], [-sx, 0, 0]);
      }
    }
    if (intoHall) {
      // the well round the opening in the station's ceiling (exactly the hole subwayCuts cuts): a painted lining
      // up from the ceiling line with a guard rail on it, a stone trim flush with the ceiling round its edge, the
      // green trimmer beam's face framing it (the girders stop on it, the vaults end against it), and a light
      const aStart = Math.max(cut.aw, -STAIRS.half), cl = hallCeil;
      const aLo = -STAIRS.half + (STAIRS.top + 0.55 - cl) / STAIRS.slope;
      const A0 = Math.max(aStart, aLo - 0.05), A1 = s.aCut! + 0.05, hb = HW + 0.18, T = 0.35, LH = 0.6;
      wellA0 = A0;
      if (A1 > A0 + 0.3) {
        for (const sx of [-1, 1]) {
          quadR(at, [[sx * hb, cl, A0], [sx * hb, cl, A1], [sx * hb, cl + LH, A1], [sx * hb, cl + LH, A0]], "ceiling_paint", [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], [-sx, 0, 0]);
          quadR(at, [[sx * HW, cl + LH, A0], [sx * hb, cl + LH, A0], [sx * hb, cl + LH, A1], [sx * HW, cl + LH, A1]], "ceiling_paint", [[0, 0], [0.1, 0], [0.1, 1], [0, 1]], [0, -1, 0]);
          // the trim and the trimmer's face along the sides
          quadR(at, [[sx * hb, cl - 0.006, A0 - T], [sx * (hb + T), cl - 0.006, A0 - T], [sx * (hb + T), cl - 0.006, A1 + T], [sx * hb, cl - 0.006, A1 + T]], "limestone", [[0, 0], [0.2, 0], [0.2, 1], [0, 1]], [0, -1, 0]);
          quadR(at, [[sx * (hb + T), cl - 0.006, A0 - T], [sx * (hb + T), cl - 0.006, A1 + T], [sx * (hb + T), cl + 0.34, A1 + T], [sx * (hb + T), cl + 0.34, A0 - T]], "iron_green", [[0, 0], [1, 0], [1, 1], [0, 1]], [sx, 0, 0]);
          bar(metal, [sx * (hb - 0.04), cl + LH + 0.02, A0 + 0.2], [sx * (hb - 0.04), cl + LH + 0.02, A1 - 0.1], 0.025, this.uv("steel_dark"), 6);
          // the light in the well
          glow.quad([[sx * (hb - 0.01), cl + 0.22, (A0 + A1) / 2 - 0.6], [sx * (hb - 0.01), cl + 0.22, (A0 + A1) / 2 + 0.6], [sx * (hb - 0.01), cl + 0.34, (A0 + A1) / 2 + 0.6], [sx * (hb - 0.01), cl + 0.34, (A0 + A1) / 2 - 0.6]],
            [U("fluor", 0, 0), U("fluor", 1, 0), U("fluor", 1, 1), U("fluor", 0, 1)], [-sx, 0, 0]);
        }
        fixtures.push([0, cl + 0.3, (A0 + A1) / 2]);
        for (const [z, nz] of [[A1, -1], [A0, 1]] as const) {
          if (nz > 0) continue; // (the stairs' own soffit closes the top end)
          quadR(at, [[-hb, cl, z], [hb, cl, z], [hb, cl + LH, z], [-hb, cl + LH, z]], "ceiling_paint", [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], [0, 0, nz]);
        }
        for (const [z0, z1, zf, nz] of [[A1, A1 + T, A1 + T, 1], [A0 - T, A0, A0 - T, -1]] as const) {
          quadR(at, [[-hb - T, cl - 0.006, z0], [hb + T, cl - 0.006, z0], [hb + T, cl - 0.006, z1], [-hb - T, cl - 0.006, z1]], "limestone", [[0, 0], [1, 0], [1, 0.2], [0, 0.2]], [0, -1, 0]);
          quadR(at, [[-hb - T, cl - 0.006, zf], [hb + T, cl - 0.006, zf], [hb + T, cl + 0.34, zf], [-hb - T, cl + 0.34, zf]], "iron_green", [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, nz]);
        }
      }
      // the end of the stairwell, up above the hall's ceiling
      const C = ceilC(aEnd);
      if (C > hallCeil && isFinite(wellA0)) quadR(at, [[HW, hallCeil, aEnd], [-HW, hallCeil, aEnd], [-HW, C, aEnd], [HW, C, aEnd]], "ceiling_paint", [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, -1]);
      else if (C > hallCeil) wall.quad([[HW, hallCeil, aEnd], [-HW, hallCeil, aEnd], [-HW, C, aEnd], [HW, C, aEnd]], [wallUV(-1, 0), wallUV(1, 0), wallUV(1, C - hallCeil), wallUV(-1, C - hallCeil)], [0, 0, -1]);
    } else if (!hasPassage) {
      // the landing at the foot, and the rim of the enclosure's open end
      const F = STAIRS.passageFloor, A0 = STAIRS_FOOT, A1 = aEnd;
      floor.quad([[-HW, F, A0], [HW, F, A0], [HW, F, A1], [-HW, F, A1]], [[-HW / 4, A0 / 4], [HW / 4, A0 / 4], [HW / 4, A1 / 4], [-HW / 4, A1 / 4]], [0, 1, 0]);
      quadR(at, [[-HW, F - 0.5, A0], [HW, F - 0.5, A0], [HW, F - 0.5, A1], [-HW, F - 0.5, A1]], "concrete_shaft", [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], [0, -1, 0]);
      quadR(at, [[-HW - 0.15, F - 0.5, A1], [HW + 0.15, F - 0.5, A1], [HW + 0.15, F, A1], [-HW - 0.15, F, A1]], "yellow", [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, 1]);
      const C = ceilC(A1);
      quadR(at, [[-HW - 0.15, C, A1], [HW + 0.15, C, A1], [HW + 0.15, C + 0.25, A1], [-HW - 0.15, C + 0.25, A1]], "concrete_shaft", [[0, 0], [1, 0], [1, 0.2], [0, 0.2]], [0, 0, 1]);
      for (const sx of [-1, 1]) quadR(at, [[sx * HW, F - 0.5, A1], [sx * (HW + 0.15), F - 0.5, A1], [sx * (HW + 0.15), C + 0.25, A1], [sx * HW, C + 0.25, A1]], "concrete_shaft", [[0, 0], [0.1, 0], [0.1, 1], [0, 1]], [0, 0, 1]);
    }

    // ---- side walls (and, inside a station, their outer faces), soffit
    const bounds = [-STAIRS.half];
    for (let i = 1; i <= N_STEPS; i++) bounds.push(-STAIRS.half + i * RUN);
    bounds.push(STAIRS.half, -STAIRS.half + (STAIRS.top - STAIRS.roofUnder + STAIRS.headroom) / STAIRS.slope - 0.0001, aEnd);
    if (isFinite(wellA0) && wellA0 > -STAIRS.half && wellA0 < aEnd) bounds.push(wellA0);
    const cuts = [...new Set(bounds.filter((a) => a <= aEnd + 1e-6))].sort((p, q) => p - q);
    const GROUP = RUN * 5;
    for (let k = 0; k < cuts.length - 1; k++) {
      const a0 = cuts[k], a1 = cuts[k + 1];
      if (a1 - a0 < 1e-4) continue;
      const mid = (a0 + a1) / 2, open = mid < STAIRS.half;
      const top = (a: number) => (open ? STAIRS.top : ceilC(a));
      const bot0 = (a: number) => (a > STAIRS_FOOT ? STAIRS.passageFloor - 0.5 : lineC(a) - RISE - 0.3);
      // (over the hall the walls stop at its ceiling)
      const bot = intoHall ? (a: number) => (a >= s.aw! - 1e-4 ? Math.max(bot0(a), hallCeil) : bot0(a)) : bot0;
      const c = cut.inside(mid);
      const lat = !intoHall && mid >= cut.aw && c.inside;
      for (const sx of [-1, 1]) {
        const x = sx * HW;
        // in rows, so the baked light has vertices to live on
        const rows = [0, 0.33, 0.62, 1];
        for (let r = 0; r < 3; r++) {
          const yAt = (a: number, f: number) => bot(a) + (top(a) - bot(a)) * f;
          const p00 = yAt(a0, rows[r]), p01 = yAt(a0, rows[r + 1]), p10 = yAt(a1, rows[r]), p11 = yAt(a1, rows[r + 1]);
          if (a0 >= wellA0 - 1e-4) { quadR(at, [[x, p00, a0], [x, p10, a1], [x, p11, a1], [x, p01, a0]], "ceiling_paint", [[0, 0], [1, 0], [1, 1], [0, 1]], [-sx, 0, 0]); continue; }
          wall.quad([[x, p00, a0], [x, p10, a1], [x, p11, a1], [x, p01, a0]],
            [wallUV(a0, p00 - lineC(a0)), wallUV(a1, p10 - lineC(a1)), wallUV(a1, p11 - lineC(a1)), wallUV(a0, p01 - lineC(a0))], [-sx, 0, 0]);
        }
        if (lat) {
          // the enclosure seen from the platform: tiled outside too, up to the station ceiling
          const xo = sx * (HW + 0.15);
          const ob = (a: number) => bot(a) - 0.05, ot = (a: number) => Math.min(top(a) + 0.25, c.ceil);
          if (ot(a0) > ob(a0) || ot(a1) > ob(a1)) wall.quad([[xo, ob(a0), a0], [xo, ob(a1), a1], [xo, Math.max(ob(a1), ot(a1)), a1], [xo, Math.max(ob(a0), ot(a0)), a0]],
            [wallUV(-a0, ob(a0) - lineC(a0)), wallUV(-a1, ob(a1) - lineC(a1)), wallUV(-a1, Math.max(ob(a1), ot(a1)) - lineC(a1)), wallUV(-a0, Math.max(ob(a0), ot(a0)) - lineC(a0))], [sx, 0, 0]);
          quadR(at, [[sx * HW, ob(a0), a0], [xo, ob(a0), a0], [xo, ob(a1), a1], [sx * HW, ob(a1), a1]], "concrete_shaft", [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]], [0, -1, 0]);
        }
      }
      // the soffit under the pavement / following the stairs down
      if (!open) {
        const g0 = Math.floor((a0 + STAIRS.half) / GROUP) * GROUP - STAIRS.half;
        const t0 = (a0 - g0) / GROUP, t1 = (a1 - g0) / GROUP;
        quadR(at, [[-HW, ceilC(a0), a0], [HW, ceilC(a0), a0], [HW, ceilC(a1), a1], [-HW, ceilC(a1), a1]], "ceiling_paint", [[0, t0], [1, t0], [1, t1], [0, t1]],
          [0, -1, mid > 2.757 && mid < STAIRS_FOOT ? -STAIRS.slope : 0]);
      }
    }
    // the pavement slab's edge over the stairs, and a granite coping round the opening
    for (let k = 0; k < 4; k++) {
      const x0 = -HW + (2 * HW * k) / 4, x1 = -HW + (2 * HW * (k + 1)) / 4;
      quadR(at, [[x0, STAIRS.roofUnder, STAIRS.half], [x1, STAIRS.roofUnder, STAIRS.half], [x1, STAIRS.top, STAIRS.half], [x0, STAIRS.top, STAIRS.half]], "granite", [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], [0, 0, -1]);
    }
    const CY = STAIRS.top + 0.018, CW = 0.2;
    const cope = (p: V3[], n: V3 = [0, 1, 0]) => quadR(at, p, "granite", [[0, 0], [1, 0], [1, 0.25], [0, 0.25]], n);
    for (const sx of [-1, 1]) {
      cope([[sx * HW, CY, -STAIRS.half - CW], [sx * (HW + CW), CY, -STAIRS.half - CW], [sx * (HW + CW), CY, STAIRS.half + CW], [sx * HW, CY, STAIRS.half + CW]]);
      cope([[sx * HW, STAIRS.top, -STAIRS.half - CW], [sx * HW, CY, -STAIRS.half - CW], [sx * HW, CY, STAIRS.half + CW], [sx * HW, STAIRS.top, STAIRS.half + CW]], [-sx, 0, 0]);
    }
    for (const sz of [-1, 1]) {
      const z = sz * STAIRS.half;
      cope([[-HW, CY, z], [HW, CY, z], [HW, CY, z + sz * CW], [-HW, CY, z + sz * CW]]);
      cope([[-HW, STAIRS.top, z], [HW, STAIRS.top, z], [HW, CY, z], [-HW, CY, z]], [0, 0, -sz]);
    }

    // ---- handrails on brackets, both sides
    const steel = U("stainless");
    for (const sx of [-1, 1]) {
      const x = sx * (HW - 0.09);
      const aA = -STAIRS.half + 0.15;
      const aB = intoHall ? stepsEnd - 0.15 : hasPassage ? STAIRS_FOOT + 0.3 : aEnd - 0.1;
      const yAt = (a: number) => Math.max(line(Math.min(a, STAIRS_FOOT)), STAIRS.passageFloor) + 0.9;
      bar(metal, [x, yAt(aA), aA], [x, yAt(Math.min(aB, STAIRS_FOOT)), Math.min(aB, STAIRS_FOOT)], 0.024, steel, 8);
      if (aB > STAIRS_FOOT) bar(metal, [x, yAt(STAIRS_FOOT), STAIRS_FOOT], [x, yAt(aB), aB], 0.024, steel, 8);
      bar(metal, [x, yAt(aA), aA], [x, STAIRS.top + 0.02, aA - 0.08], 0.024, steel, 6);
      for (let a = aA + 0.5; a < aB - 0.2; a += 1.6) bar(metal, [x, yAt(a) - 0.01, a], [sx * HW, yAt(a) - 0.06, a], 0.012, steel, 4);
    }

    // ---- fittings: lights on the soffit, a mosaic plaque, wayfinding
    const fix = this.parts.get("fixture") ?? [];
    const putFixture = (a: number, y: number, pitch: number, across = false) => {
      const m = new THREE.Matrix4().makeTranslation(0, y, a).multiply(new THREE.Matrix4().makeRotationX(pitch));
      if (across) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      for (const p of fix) (p.mat === "glow" ? glow : at).add(p.geo, m);
      fixtures.push([0, y - 0.15, a]);
      this.opts.onLamp?.(s.x + s.ux * a, y - 0.4, s.z + s.uz * a);
    };
    if (intoHall) putFixture(2.6, stairTop(2.6) - 0.02, Math.atan(STAIRS.slope));
    else putFixture(2.42, STAIRS.roofUnder, 0, true);
    for (let a = 3.9; a < Math.min(STAIRS_FOOT - 0.6, aEnd - 0.3); a += 2.4) putFixture(a, stairTop(a) - 0.02, Math.atan(STAIRS.slope));
    if (intoHall) {
      // where the raked ceiling starts under the pavement's edge: its face up to the slab
      const y0 = stairTop(STAIRS.half + 1e-4);
      if (y0 < STAIRS.roofUnder - 0.01) quadR(at, [[HW, y0, STAIRS.half], [-HW, y0, STAIRS.half], [-HW, STAIRS.roofUnder, STAIRS.half], [HW, STAIRS.roofUnder, STAIRS.half]], "ceiling_paint", [[0, 0], [1, 0], [1, 0.2], [0, 0.2]], [0, 0, -1]);
    }
    if (!hasPassage && !intoHall) putFixture(STAIRS_FOOT + 0.7, ceilC(STAIRS_FOOT) - 0.02, 0);
    if (stepsEnd > 3.7) {
      const sx = hash2(s.z, s.x) < 0.5 ? -1 : 1, x = sx * (HW - 0.012);
      quadR(at, [[x, line(3.0) + 1.25, 3.0], [x, line(3.6) + 1.25, 3.6], [x, line(3.6) + 1.85, 3.6], [x, line(3.0) + 1.85, 3.0]], "mosaic_plaque", [[0, 0], [1, 0], [1, 1], [0, 1]], [-sx, 0, 0]);
    }

    // ---- the passage on to the station
    if (hasPassage) {
      const F = STAIRS.passageFloor, C = STAIRS.passageCeiling;
      const len = passEnd - P0;
      const n = Math.max(1, Math.round(len / 1.5));
      for (let k = 0; k < n; k++) {
        const a0 = P0 + (len * k) / n, a1 = P0 + (len * (k + 1)) / n;
        floor.quad([[-PW, F, a0], [PW, F, a0], [PW, F, a1], [-PW, F, a1]], [[-PW / 4, a0 / 4], [PW / 4, a0 / 4], [PW / 4, a1 / 4], [-PW / 4, a1 / 4]], [0, 1, 0]);
        quadR(at, [[-PW, C, a0], [PW, C, a0], [PW, C, a1], [-PW, C, a1]], "ceiling_paint", [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0]);
        for (const sx of [-1, 1]) {
          const x = sx * PW, rows = [F, F + 1.2, F + 2.6, C];
          for (let r = 0; r < 3; r++) wall.quad([[x, rows[r], a0], [x, rows[r], a1], [x, rows[r + 1], a1], [x, rows[r + 1], a0]],
            [wallUV(a0, rows[r] - F), wallUV(a1, rows[r] - F), wallUV(a1, rows[r + 1] - F), wallUV(a0, rows[r + 1] - F)], [-sx, 0, 0]);
        }
      }
      // where the stairs come into the passage: the strips either side, and over the stair ceiling
      for (const sx of [-1, 1]) wall.quad([[sx * HW, F, P0], [sx * PW, F, P0], [sx * PW, C, P0], [sx * HW, C, P0]],
        [wallUV(P0, 0), wallUV(P0 + 0.35, 0), wallUV(P0 + 0.35, C - F), wallUV(P0, C - F)], [0, 0, 1]);
      const sc = stairCeil(P0);
      wall.quad([[-HW, sc, P0], [HW, sc, P0], [HW, C, P0], [-HW, C, P0]], [wallUV(-1, sc - F), wallUV(1, sc - F), wallUV(1, C - F), wallUV(-1, C - F)], [0, 0, 1]);
      if (cut.blocked || !isFinite(cut.aw)) wall.quad([[-PW, F, passEnd], [PW, F, passEnd], [PW, C, passEnd], [-PW, C, passEnd]], [wallUV(-1, 0), wallUV(1, 0), wallUV(1, C - F), wallUV(-1, C - F)], [0, 0, -1]);
      for (let a = P0 + 1.6; a < passEnd - 0.8; a += 3.2) putFixture(a, C, 0);
      // posters on the passage walls
      const posters = ["poster_a", "poster_b", "poster_c"];
      for (let a = P0 + 2.5, k = Math.floor(hash2(s.x, s.z) * 3); a < passEnd - 1.5; a += 4.5, k++) {
        const sx = k % 2 ? 1 : -1, x = sx * (PW - 0.015);
        quadR(at, [[x, F + 1.0, a - 0.5], [x, F + 1.0, a + 0.5], [x, F + 2.5, a + 0.5], [x, F + 2.5, a - 0.5]], posters[k % 3],
          sx < 0 ? [[1, 0], [0, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]], [-sx, 0, 0]);
      }
      // a hanging sign: to the trains (ways in, read coming down) or to the street (ways out, read going up)
      const sa = P0 + 1.0, sy = C - 0.45;
      at.quad([[-0.85, sy - 0.18, sa], [0.85, sy - 0.18, sa], [0.85, sy + 0.18, sa], [-0.85, sy + 0.18, sa]], [U("black"), U("black"), U("black"), U("black")], [0, 0, -1]);
      if (s.out) glow.quad([[0.8, sy - 0.16, sa + 0.012], [-0.8, sy - 0.16, sa + 0.012], [-0.8, sy + 0.16, sa + 0.012], [0.8, sy + 0.16, sa + 0.012]],
        [U("way_street", 0, 0), U("way_street", 1, 0), U("way_street", 1, 1), U("way_street", 0, 1)], [0, 0, 1]);
      else glow.quad([[-0.8, sy - 0.16, sa - 0.012], [0.8, sy - 0.16, sa - 0.012], [0.8, sy + 0.16, sa - 0.012], [-0.8, sy + 0.16, sa - 0.012]],
        [U("way_trains", 0, 0), U("way_trains", 1, 0), U("way_trains", 1, 1), U("way_trains", 0, 1)], [0, 0, -1]);
      for (const sx of [-0.6, 0.6]) bar(metal, [sx, sy + 0.18, sa], [sx, C, sa], 0.01, steel, 4);
    }

    // ---- baked light: the fittings, daylight down the open end, darker into corners
    const light = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      let l = 0.16;
      for (const f of fixtures) {
        const dx = f[0] - x, dy = f[1] - y, dz = f[2] - z, d2 = dx * dx + dy * dy + dz * dz;
        const facing = Math.max(0.25, (dx * nx + dy * ny + dz * nz) / Math.sqrt(d2 + 1e-6));
        l += (1.5 * facing) / (1 + d2 * 0.28);
      }
      const day = Math.max(0, Math.min(1, (y + 3.2) / 3.3)) * Math.max(0, Math.min(1, (3.6 - z) / 2.6));
      l += day * 0.9 * (0.6 + 0.4 * Math.max(0, ny));
      return Math.min(1.55, l);
    };
    return { wall: wall.geometry(s, light), floor: floor.geometry(s, light), atlas: at.geometry(s, light), metal: metal.geometry(s, light), glow: glow.geometry(s, () => 1) };
  }

  // --- per frame ---------------------------------------------------------------------------

  /** t: the game clock; cam: the camera position; viewH: the canvas height (for particle sizes) */
  update(t: number, cam: THREE.Vector3, viewH = 720) {
    if (!this.ready) return;
    const x = cam.x, z = cam.z;
    for (const p of this.placed) p.update(x, z, /fan|shaft/.test(p.name) ? 160 : 320);
    // spinning rotors: the ways in turn steadily, the ways out flat out
    const q = new THREE.Quaternion(), qs = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const [ri, r] of this.rotors.entries()) {
      const out = r.name.endsWith("_out");
      const list = (this.fanLists[ri] ??= this.fans.filter((f) => f.out === out));
      r.update(x, z, 160, (i, m) => {
        const f = list[i];
        q.setFromAxisAngle(Yax, f.yaw);
        qs.setFromAxisAngle(Yax, (out ? -13 : 7.5) * t + f.phase);
        m.compose(pos.set(f.x, f.y, f.z), q.multiply(qs), one);
      });
    }
    for (const b of this.beams) b.visible = (b.position.x - x) ** 2 + (b.position.z - z) ** 2 < 300 * 300;
    for (const m of this.plumeMats) { m.uniforms.uTime.value = t; if (m.uniforms.uScale) m.uniforms.uScale.value = viewH * 0.9; }
    for (const j of this.jets) j.visible = (j.position.x - x) ** 2 + (j.position.z - z) ** 2 < 600 * 600;
    for (const p of this.plumes) p.pts.visible = (p.x - x) ** 2 + (p.z - z) ** 2 < (p.out ? 520 : 160) ** 2;
    // the stairwells only near the camera (and never from high over the rooftops)
    for (const it of this.interiors) {
      const dx = Math.max(it.x0 - x, 0, x - it.x1), dz = Math.max(it.z0 - z, 0, z - it.z1);
      it.g.visible = dx * dx + dz * dz < 130 * 130 && cam.y < 70;
    }
  }

  /** draw-call / triangle summary of what's visible (debugging) */
  stats() {
    let calls = 0, tris = 0;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      let p: THREE.Object3D | null = m;
      while (p) { if (!p.visible) return; p = p.parent; }
      const im = m as THREE.InstancedMesh;
      const n = im.isInstancedMesh ? im.count : 1;
      if (!n) return;
      calls++;
      tris += ((m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3) * n;
    });
    return { calls, tris: Math.round(tris), plumes: this.plumes.filter((p) => p.pts.visible).length };
  }
}
