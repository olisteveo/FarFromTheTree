// Facade clutter that a leaf has to deal with, generated from each building's real walls
// and style: AC units under windows (some blowing), open windows with cats that swat,
// balconies with tables and chairs (solid: somewhere to land), and washing lines strung
// across the narrow downtown streets. Deterministic, so every run is the same.

import { Grid, type Building, type CityData } from "./data";
import { TILES } from "../render/facades";
import { isModelled } from "./modelled";

export type PropKind = "ac" | "balcony" | "cat" | "line" | "solid";

/** An oriented box: centre, the wall's direction (tx, tz), its outward normal, and half sizes
 *  along the wall (hw), up (hh) and out from the wall (hd). */
export interface FacadeProp {
  kind: PropKind;
  x: number; y: number; z: number;
  tx: number; tz: number; nx: number; nz: number;
  hw: number; hh: number; hd: number;
  seed: number;
  /** AC units that blow, cats' swat reach, line sag */
  blows?: boolean;
  /** what it is, for the "torn apart on ..." message (else by kind) */
  label?: string;
  /** for lines: the far end */
  x2?: number; y2?: number; z2?: number;
}

const h01 = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; return (x >>> 0) / 4294967296; };

// balcony: the share of buildings of the style that have them (and those have them all the way up and
// along, in a regular pattern: a building has balconies or it doesn't)
const RATES: Record<string, { ac: number; cat: number; balcony: number }> = {
  tenement: { ac: 0.16, cat: 0.012, balcony: 0.035 },
  brick: { ac: 0.14, cat: 0.008, balcony: 0.09 },
  prewar: { ac: 0.08, cat: 0.006, balcony: 0.055 },
  castiron: { ac: 0.05, cat: 0.004, balcony: 0.02 },
  modern: { ac: 0.02, cat: 0, balcony: 0.14 },
  glass: { ac: 0, cat: 0, balcony: 0 }, // balconies on curtain walls just look like floating boxes
  deco: { ac: 0.04, cat: 0.003, balcony: 0.015 },
  civic: { ac: 0, cat: 0, balcony: 0 },
};

export class Facades {
  readonly props: FacadeProp[] = [];
  readonly grid = new Grid<FacadeProp>(16);

  constructor(city: CityData) {
    for (const b of city.buildings) if (!isModelled(b.cx, b.cz)) this.decorate(b, city);
    this.washingLines(city);
    for (const p of this.props) {
      const r = Math.max(p.hw, p.hd) + 1;
      if (p.kind === "line") this.grid.add(p, Math.min(p.x, p.x2!) - 1, Math.min(p.z, p.z2!) - 1, Math.max(p.x, p.x2!) + 1, Math.max(p.z, p.z2!) + 1);
      else this.grid.add(p, p.x - r, p.z - r, p.x + r, p.z + r);
    }
  }

  private decorate(b: Building, city: CityData) {
    const rate = RATES[b.style];
    if (!rate || b.h < 8) return;
    const t = TILES[b.style];
    const ring = b.poly[0], n = ring.length / 2;
    const groundH = b.style === "castiron" ? 4.6 : b.style === "glass" || b.style === "modern" ? 5.5 : 4.4;
    const floors = Math.floor((Math.min(b.h, 60) - groundH) / t.floorH);
    if (floors < 1) return;
    // balconies: all or nothing per building, every bay or every other bay (the same all the way up)
    const balconies = h01(b.seed, 9901) < rate.balcony;
    const stride = h01(b.seed, 9902) < 0.35 ? 1 : 2, phase = stride === 2 && h01(b.seed, 9903) < 0.5 ? 1 : 0;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 5) { u += L; continue; }
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx; // outward (rings wind clockwise)
      // only walls that face a street get clutter: probe a few metres out
      const mx = (ax + bx) / 2 + nx * 4, mz = (az + bz) / 2 + nz * 4;
      if (city.buildingAt(mx, mz)) { u += L; continue; }
      const bay0 = Math.ceil(u / t.bayW), bay1 = Math.floor((u + L) / t.bayW);
      for (let bay = bay0; bay < bay1; bay++) {
        const along = (bay + 0.5) * t.bayW - u;
        if (along < 1 || along > L - 1) continue;
        for (let f = 0; f < floors; f++) {
          const r = h01(b.seed + bay * 131, f * 17 + i);
          const wx = ax + tx * along, wz = az + tz * along;
          const yWin = groundH + f * t.floorH;
          const seed = (b.seed + bay * 7 + f) >>> 0;
          if (balconies && f > 0 && along > 2 && along < L - 2 && (bay - phase) % stride === 0) {
            this.props.push({ kind: "balcony", x: wx + nx * 0.75, y: yWin, z: wz + nz * 0.75, tx, tz, nx, nz, hw: 1.4, hh: 0.55, hd: 0.75, seed });
          } else if (r < rate.ac) {
            this.props.push({ kind: "ac", x: wx + nx * 0.32, y: yWin + 0.55, z: wz + nz * 0.32, tx, tz, nx, nz, hw: 0.38, hh: 0.24, hd: 0.3, seed, blows: h01(seed, 3) < 0.35 });
          } else if (r < rate.ac + rate.cat) {
            this.props.push({ kind: "cat", x: wx + nx * 0.25, y: yWin + 0.85, z: wz + nz * 0.25, tx, tz, nx, nz, hw: 0.2, hh: 0.2, hd: 0.2, seed });
          }
        }
      }
      u += L;
    }
  }

  /** Washing lines across the narrow streets of Chinatown and Little Italy. */
  private washingLines(city: CityData) {
    const n = this.props.length;
    void n;
    for (const st of city.raw.streets) {
      if (st.rw !== 1 || st.w > 15) continue;
      const p = st.p;
      for (let k = 0; k < p.length - 2; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 20) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const d = city.district(city.route.nearest(mx, mz).s).id;
        if (d !== "chinatown" && d !== "littleitaly") continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
        for (let a = 12; a < L - 8; a += 14) {
          const r = h01(Math.round(ax * 10 + az), Math.round(a));
          if (r > 0.45) continue;
          const cx = ax + tx * a, cz = az + tz * a;
          // find the walls either side
          let left = 0, right = 0;
          for (let s = 1; s < 14 && !left; s += 0.5) if (city.buildingAt(cx + nx * s, cz + nz * s)) left = s;
          for (let s = 1; s < 14 && !right; s += 0.5) if (city.buildingAt(cx - nx * s, cz - nz * s)) right = s;
          if (!left || !right) continue;
          const y = 6 + r * 18;
          this.props.push({
            kind: "line", x: cx + nx * (left - 0.2), y, z: cz + nz * (left - 0.2),
            x2: cx - nx * (right - 0.2), y2: y - 0.4 + r, z2: cz - nz * (right - 0.2),
            tx, tz, nx, nz, hw: 0, hh: 0, hd: 0, seed: Math.round(r * 1e6),
          });
        }
      }
    }
  }

  /** Distance from a point to a washing line (with a little sag in the middle). */
  static lineDistance(p: FacadeProp, x: number, y: number, z: number): number {
    const dx = p.x2! - p.x, dy = p.y2! - p.y, dz = p.z2! - p.z;
    const L2 = dx * dx + dy * dy + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy + (z - p.z) * dz) / L2));
    const sag = Math.sin(t * Math.PI) * 0.8;
    return Math.hypot(p.x + dx * t - x, p.y + dy * t - sag - y, p.z + dz * t - z);
  }
}
