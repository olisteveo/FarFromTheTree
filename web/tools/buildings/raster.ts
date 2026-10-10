// Rasterises the city's ground polygons and footprints onto a 1 m grid so the gaps between
// them (vacant lots, missing footprints, slivers, block interiors) can be found.
// Used by tools/buildings/gaps.ts (offline, node + tsx). No three.js.

import type { CityData, Poly } from "../../src/world/data";

export const LAND = 1, PAVED = 2, BUILT = 4, GREEN = 8, SITE = 16, ROAD = 32, WALK = 64;

export class Raster {
  readonly w: number;
  readonly h: number;
  readonly bits: Uint8Array;
  readonly bid: Int32Array;
  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number, readonly cell = 1) {
    this.w = Math.ceil((x1 - x0) / cell);
    this.h = Math.ceil((z1 - z0) / cell);
    this.bits = new Uint8Array(this.w * this.h);
    this.bid = new Int32Array(this.w * this.h).fill(-1);
  }
  /** Even-odd scanline fill of a polygon (all rings) at cell centres. */
  fill(p: Poly, f: (i: number) => void) {
    let zMin = Infinity, zMax = -Infinity;
    for (const r of p) for (let i = 1; i < r.length; i += 2) { zMin = Math.min(zMin, r[i]); zMax = Math.max(zMax, r[i]); }
    const j0 = Math.max(0, Math.floor((zMin - this.z0) / this.cell)), j1 = Math.min(this.h - 1, Math.ceil((zMax - this.z0) / this.cell));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cell;
      xs.length = 0;
      for (const r of p) {
        for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) {
          const za = r[a + 1], zb = r[b + 1];
          if ((za > z) !== (zb > z)) xs.push(r[a] + ((z - za) / (zb - za)) * (r[b] - r[a]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / this.cell - 0.5)), i1 = Math.min(this.w - 1, Math.floor((xs[k + 1] - this.x0) / this.cell - 0.5));
        for (let i = i0; i <= i1; i++) f(j * this.w + i);
      }
    }
  }
  mark(p: Poly, bit: number) { this.fill(p, (i) => { this.bits[i] |= bit; }); }
  cx(i: number) { return this.x0 + ((i % this.w) + 0.5) * this.cell; }
  cz(i: number) { return this.z0 + (Math.floor(i / this.w) + 0.5) * this.cell; }
}

export function rasterCity(city: CityData, pad = 400, cell = 1): Raster {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < city.route.x.length; i++) {
    x0 = Math.min(x0, city.route.x[i]); x1 = Math.max(x1, city.route.x[i]);
    z0 = Math.min(z0, city.route.z[i]); z1 = Math.max(z1, city.route.z[i]);
  }
  const R = new Raster(x0 - pad, z0 - pad, x1 + pad, z1 + pad, cell);
  const raw = city.raw;
  for (const p of raw.land) R.mark(p, LAND);
  for (const p of raw.roadbed) R.mark(p, PAVED | ROAD);
  for (const p of raw.sidewalk) R.mark(p, PAVED | WALK);
  for (const p of raw.median) R.mark(p, PAVED);
  for (const p of raw.plaza) R.mark(p, PAVED);
  for (const p of raw.parks) R.mark(p.p, GREEN);
  for (const p of raw.sites) R.mark(p.p, SITE);
  for (const b of city.buildings) R.fill(b.poly, (i) => { R.bits[i] |= BUILT; R.bid[i] = b.id; });
  return R;
}
