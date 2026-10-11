// The city as loaded from public/city.json (built by tools/build-city.ts from NYC Open
// Data): types, polygon helpers, the route and a spatial index. No three.js here, so
// the headless test bot and the s&box exporter can use it too.

import { bendSubway, subwayPlan } from "./subwayBend";

export type Style = "tenement" | "castiron" | "prewar" | "deco" | "modern" | "glass" | "brick" | "civic";
export const STYLES: Style[] = ["tenement", "castiron", "prewar", "deco", "modern", "glass", "brick", "civic"];

/** A polygon: [outer, ...holes], each a flat [x, z, x, z, ...] ring. */
export type Poly = number[][];

export interface RawCity {
  meta: { origin: { lat: number; lon: number }; gridDeg: number; length: number; credit: string };
  route: number[];
  subway: number[];
  districts: { id: string; name: string; sub: string; s0: number }[];
  buildings: { p: Poly; h: number; y: number; st: Style; k: number; s: number; d: number }[];
  skyline: { p: Poly; h: number; y: number }[];
  roadbed: Poly[];
  sidewalk: Poly[];
  median: Poly[];
  plaza: Poly[];
  parks: { n: string; p: Poly }[];
  /** Former parks along the route, now building sites. */
  sites: { n: string; p: Poly }[];
  open: Poly[];
  land: Poly[];
  streets: { n: string; w: number; d: number; l: number; rw: number; p: number[] }[];
  stations: { n: string; r: string; x: number; z: number; s: number; ss: number; d: number }[];
  entrances: { n: string; r: string; t: string; x: number; z: number; s: number; ss: number; d: number }[];
  trees: number[];
  landmarks: Record<string, [number, number]>;
}

/** cx, cz: from the query point to the nearest point on the centreline */
export interface StreetHit { tx: number; tz: number; w: number; d: number; dist: number; name: string; idx: number; cx: number; cz: number }
export const streetHit = (): StreetHit => ({ tx: 0, tz: 1, w: 10, d: 0, dist: Infinity, name: "", idx: -1, cx: 0, cz: 0 });

export interface Building {
  id: number;
  poly: Poly;
  h: number;
  year: number;
  style: Style;
  seed: number;
  /** distance along the route and from it */
  s: number;
  off: number;
  x0: number; z0: number; x1: number; z1: number;
  cx: number; cz: number;
  area: number;
}

// ------------------------------------------------------------------ polygon helpers

export function ringArea(r: number[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] + r[i]) * (r[j + 1] - r[i + 1]);
  return a / 2;
}

export function inRing(r: number[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function inPoly(p: Poly, x: number, z: number): boolean {
  if (!inRing(p[0], x, z)) return false;
  for (let i = 1; i < p.length; i++) if (inRing(p[i], x, z)) return false;
  return true;
}

/** Nearest point on a polygon's boundary: distance and outward normal (pointing out of the solid). */
export function nearestEdge(p: Poly, x: number, z: number): { d: number; nx: number; nz: number; px: number; pz: number } {
  let best = { d: Infinity, nx: 0, nz: 0, px: x, pz: z };
  for (let ri = 0; ri < p.length; ri++) {
    const r = p[ri];
    const hole = ri > 0;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j], az = r[j + 1], bx = r[i], bz = r[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.d) {
        // outer rings wind clockwise, holes anticlockwise: (-dz, dx) points out of the solid either way
        const L = Math.sqrt(L2);
        best = { d, nx: -dz / L, nz: dx / L, px, pz };
        void hole;
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------ polylines (route, subway)

export class Polyline {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly step: number;
  readonly length: number;
  constructor(flat: number[], step = 4) {
    const n = flat.length / 2;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = flat[i * 2]; this.z[i] = flat[i * 2 + 1]; }
    this.step = step;
    this.length = (n - 1) * step;
  }
  /** Position and unit tangent at distance s. */
  at(s: number, out = { x: 0, z: 0, tx: 0, tz: 1 }) {
    const n = this.x.length;
    const f = Math.max(0, Math.min(n - 1.001, s / this.step));
    const i = Math.floor(f), t = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    const dx = this.x[i + 1] - this.x[i], dz = this.z[i + 1] - this.z[i], L = Math.hypot(dx, dz) || 1;
    out.tx = dx / L; out.tz = dz / L;
    return out;
  }
  // segments bucketed in a coarse grid, for an exact nearest search that doesn't scan the whole line
  private segCell = 64;
  private segGrid: Map<number, number[]> | null = null;
  private segKey(ix: number, iz: number) { return (ix + 4096) * 8192 + (iz + 4096); }
  private buildSegGrid() {
    const g = new Map<number, number[]>(), c = this.segCell, n = this.x.length;
    for (let i = 0; i < n - 1; i++) {
      const x0 = Math.min(this.x[i], this.x[i + 1]), x1 = Math.max(this.x[i], this.x[i + 1]);
      const z0 = Math.min(this.z[i], this.z[i + 1]), z1 = Math.max(this.z[i], this.z[i + 1]);
      for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
        for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
          const k = this.segKey(ix, iz);
          (g.get(k) ?? g.set(k, []).get(k)!).push(i);
        }
    }
    this.segGrid = g;
  }

  /** Nearest point: distance along (s), signed lateral offset (+ = toward +x of the tangent's left normal, i.e. west when heading uptown), distance. */
  nearest(x: number, z: number, hint = -1, out = { s: 0, off: 0, d: 0 }): { s: number; off: number; d: number } {
    const n = this.x.length;
    if (hint < 0) return this.nearestIndexed(x, z, out);
    let lo = 0, hi = n - 1;
    if (hint >= 0) { const i = Math.round(hint / this.step); lo = Math.max(0, i - 80); hi = Math.min(n - 1, i + 80); }
    let best = Infinity, bs = 0, boff = 0;
    for (let i = lo; i < hi; i++) {
      const ax = this.x[i], az = this.z[i], dx = this.x[i + 1] - ax, dz = this.z[i + 1] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const px = ax + dx * t, pz = az + dz * t;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) {
        best = d2;
        bs = (i + t) * this.step;
        const L = Math.sqrt(L2);
        boff = ((x - px) * (dz / L) - (z - pz) * (dx / L));
      }
    }
    out.s = bs; out.off = boff; out.d = Math.sqrt(best);
    // a stale hint (the point jumped) can miss the true nearest: search everything instead
    if (hint >= 0 && (out.d > 40 || bs <= lo * this.step + 1 || bs >= hi * this.step - 1) && (lo > 0 || hi < n - 1)) return this.nearestIndexed(x, z, out);
    return out;
  }

  /** The exact nearest point, searching the segment grid in growing rings. */
  private nearestIndexed(x: number, z: number, out: { s: number; off: number; d: number }) {
    if (!this.segGrid) this.buildSegGrid();
    const c = this.segCell, cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = Infinity, bi = -1, bt = 0;
    const test = (i: number) => {
      const ax = this.x[i], az = this.z[i], dx = this.x[i + 1] - ax, dz = this.z[i + 1] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d2 < best || (d2 === best && i < bi)) { best = d2; bi = i; bt = t; }
    };
    for (let ring = 0; ring < 400; ring++) {
      // everything within ring cells is searched: stop once the best beats the ring's inner edge
      if (bi >= 0 && Math.sqrt(best) <= (ring - 1) * c) break;
      for (let ix = cx - ring; ix <= cx + ring; ix++)
        for (let iz = cz - ring; iz <= cz + ring; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const list = this.segGrid!.get(this.segKey(ix, iz));
          if (list) for (const i of list) test(i);
        }
    }
    if (bi < 0) { out.s = 0; out.off = 0; out.d = Infinity; return out; }
    const ax = this.x[bi], az = this.z[bi], dx = this.x[bi + 1] - ax, dz = this.z[bi + 1] - az, L = Math.hypot(dx, dz) || 1e-9;
    const px = ax + dx * bt, pz = az + dz * bt;
    out.s = (bi + bt) * this.step; out.off = (x - px) * (dz / L) - (z - pz) * (dx / L); out.d = Math.sqrt(best);
    return out;
  }
}

// ------------------------------------------------------------------ spatial grid

export class Grid<T> {
  private cells = new Map<number, T[]>();
  constructor(readonly cell: number) {}
  private key(ix: number, iz: number) { return (ix + 32768) * 65536 + (iz + 32768); }
  add(item: T, x0: number, z0: number, x1: number, z1: number) {
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
      for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
        const k = this.key(ix, iz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(item);
      }
  }
  at(x: number, z: number): T[] {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? (EMPTY as T[]);
  }
  clear() { this.cells.clear(); }
  /** Items in all cells overlapping a square around (x, z). May contain duplicates. */
  around(x: number, z: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    const c = this.cell;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const l = this.cells.get(this.key(ix, iz));
        if (l) for (const t of l) out.push(t);
      }
    return out;
  }
}
const EMPTY: unknown[] = [];

function bbox(r: number[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]);
    z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]);
  }
  return { x0, z0, x1, z1 };
}

// ------------------------------------------------------------------ the city

export class CityData {
  readonly raw: RawCity;
  readonly route: Polyline;
  /** the bent tunnel line (world/subwayBend.ts): its s is the surveyed s */
  readonly subway: Polyline;
  /** per point of the subway line: how far its floor and ceiling sit above (+) or below (-) the usual */
  readonly subwayDy: Float32Array;
  readonly buildings: Building[];
  readonly bgrid = new Grid<Building>(24);
  readonly land: Poly[];
  readonly landGrid = new Grid<Poly>(64);
  readonly streetGrid = new Grid<number>(20);

  constructor(raw: RawCity) {
    this.raw = raw;
    this.route = new Polyline(raw.route);
    // the tunnels between the stations bend and dip a little (world/subwayBend.ts); the stations don't
    {
      const sts = raw.stations.map((q) => ({ ss: q.ss, name: q.n }));
      const straight = new Polyline(raw.subway);
      const plan = subwayPlan(sts, straight.length, 75, 260);
      const bent = bendSubway(raw.subway, {
        step: straight.step, stations: sts.map((q) => q.ss), vents: plan.vents.map((v) => v.ss),
        passages: raw.entrances.map((e) => straight.nearest(e.x, e.z).s), walls: [plan.blocked[0].ss0, plan.blocked[0].ss1, plan.end],
      });
      // (tools: globalThis.__fftt_noBend = true keeps the surveyed line, to A/B the bend)
      const noBend = (globalThis as { __fftt_noBend?: boolean }).__fftt_noBend;
      this.subway = noBend ? straight : new Polyline(bent.flat, straight.step);
      this.subwayDy = noBend ? new Float32Array(straight.x.length) : bent.dip;
    }
    this.buildings = raw.buildings.map((b, id) => {
      const bb = bbox(b.p[0]);
      let cx = 0, cz = 0;
      for (let i = 0; i < b.p[0].length; i += 2) { cx += b.p[0][i]; cz += b.p[0][i + 1]; }
      cx /= b.p[0].length / 2; cz /= b.p[0].length / 2;
      return { id, poly: b.p, h: b.h, year: b.y, style: b.st, seed: b.k, s: b.s, off: b.d, ...bb, cx, cz, area: Math.abs(ringArea(b.p[0])) };
    });
    for (const b of this.buildings) this.bgrid.add(b, b.x0, b.z0, b.x1, b.z1);
    this.land = raw.land;
    for (const p of this.land) { const bb = bbox(p[0]); this.landGrid.add(p, bb.x0, bb.z0, bb.x1, bb.z1); }
    raw.streets.forEach((st, i) => { const bb = bbox(st.p); this.streetGrid.add(i, bb.x0 - st.w, bb.z0 - st.w, bb.x1 + st.w, bb.z1 + st.w); });
  }

  /** How far the tunnel's floor and ceiling are raised (+) or lowered (-) at subway s (0 in the stations). */
  subwayDip(s: number): number {
    const d = this.subwayDy, f = Math.max(0, Math.min(d.length - 1.001, s / this.subway.step)), i = Math.floor(f);
    return d[i] + (d[i + 1] - d[i]) * (f - i);
  }

  static async load(url = "./city.json"): Promise<CityData> {
    const r = await fetch(url);
    return new CityData(await r.json());
  }

  district(s: number) {
    const d = this.raw.districts;
    for (let i = d.length - 1; i >= 0; i--) if (s >= d[i].s0) return d[i];
    return d[0];
  }

  onLand(x: number, z: number): boolean {
    for (const p of this.landGrid.at(x, z)) if (inPoly(p, x, z)) return true;
    return false;
  }

  /** The building containing (x, z) at ground level, if any. */
  buildingAt(x: number, z: number): Building | null {
    for (const b of this.bgrid.at(x, z)) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (inPoly(b.poly, x, z)) return b;
    }
    return null;
  }

  /** Tallest roof within r metres (for wind shading and the layer readout). */
  canopy(x: number, z: number, r = 18): number {
    let h = 0;
    for (const b of this.bgrid.around(x, z, r, this._tmp)) {
      if (b.h <= h) continue;
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
      if (dx * dx + dz * dz < r * r) h = b.h;
    }
    return h;
  }
  private _tmp: Building[] = [];

  /** The two nearest differently-named streets (for blending wind through intersections). */
  streets2(x: number, z: number, a: StreetHit, b: StreetHit) {
    a.dist = b.dist = Infinity;
    for (const i of this.streetGrid.at(x, z)) {
      const st = this.raw.streets[i];
      if (st.rw !== 1) continue;
      const p = st.p;
      for (let k = 0; k < p.length - 2; k += 2) {
        const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az;
        const L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        const L = Math.sqrt(L2);
        if (d < a.dist) {
          if (a.name !== st.n) Object.assign(b, a);
          a.dist = d; a.tx = dx / L; a.tz = dz / L; a.w = st.w; a.d = st.d; a.name = st.n; a.idx = i; a.cx = ax + dx * t - x; a.cz = az + dz * t - z;
        } else if (d < b.dist && st.n !== a.name) {
          b.dist = d; b.tx = dx / L; b.tz = dz / L; b.w = st.w; b.d = st.d; b.name = st.n; b.idx = i; b.cx = ax + dx * t - x; b.cz = az + dz * t - z;
        }
      }
    }
  }

  /** Nearest street centreline segment: direction (unit), width, one-way sign, distance. */
  street(x: number, z: number, out = { tx: 0, tz: 1, w: 10, d: 0, dist: Infinity, name: "" }) {
    out.dist = Infinity;
    for (const i of this.streetGrid.at(x, z)) {
      const st = this.raw.streets[i];
      const p = st.p;
      for (let k = 0; k < p.length - 2; k += 2) {
        const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az;
        const L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        if (d < out.dist) {
          const L = Math.sqrt(L2);
          out.dist = d; out.tx = dx / L; out.tz = dz / L; out.w = st.w; out.d = st.d; out.name = st.n;
        }
      }
    }
    return out;
  }
}
