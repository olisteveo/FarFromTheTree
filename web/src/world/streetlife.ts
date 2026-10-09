// Things in the street that matter to a leaf, placed deterministically along the real
// centrelines: steam manholes (the street's elevators), puddles in the gutters and open
// manholes behind Con Ed barriers (both end a run), and the old leaves in the gutter.

import { Grid, type CityData } from "./data";

export interface Steam { x: number; z: number; height: number; speed: number; period: number; phase: number }
export interface Puddle { x: number; z: number; rx: number; rz: number; ang: number }
export interface Manhole { x: number; z: number; tx: number; tz: number }

const h01 = (a: number, b = 0) => { let n = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12; return (n >>> 0) / 4294967296; };

export class StreetLife {
  readonly steam: Steam[] = [];
  readonly puddles: Puddle[] = [];
  readonly manholes: Manhole[] = [];
  readonly steamGrid = new Grid<Steam>(32);
  readonly puddleGrid = new Grid<Puddle>(16);
  readonly holeGrid = new Grid<Manhole>(16);

  constructor(city: CityData) {
    const safeUntil = 420; // the tutorial ground around Battery Park and Bowling Green
    city.raw.streets.forEach((st, si) => {
      if (st.rw !== 1) return;
      const p = st.p;
      let run = 0;
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        for (let d = 8; d < L - 8; d += 9) {
          const k = Math.floor((run + d) / 9);
          const r = h01(si * 977 + k, 3);
          const x = ax + tx * d, z = az + tz * d;
          if (r < 0.085) {
            // steam: in the roadway, puffing in the cold
            const off = (h01(si, k) - 0.5) * st.w * 0.4;
            const s: Steam = { x: x - tz * off, z: z + tx * off, height: 22 + h01(si, k + 1) * 22, speed: 9 + h01(si, k + 2) * 6, period: 5 + h01(si, k + 3) * 5, phase: h01(si, k + 4) * 10 };
            this.steam.push(s);
            this.steamGrid.add(s, s.x - 6, s.z - 6, s.x + 6, s.z + 6);
          } else if (r < 0.15 && city.route.nearest(x, z).s > safeUntil) {
            // a puddle in the gutter, by one kerb or the other
            const side = h01(si, k + 5) < 0.5 ? -1 : 1;
            const off = side * (st.w / 2 - 0.9);
            const pd: Puddle = { x: x - tz * off, z: z + tx * off, rx: 1.2 + h01(si, k + 6) * 1.8, rz: 0.7 + h01(si, k + 7) * 0.6, ang: Math.atan2(tx, tz) };
            this.puddles.push(pd);
            this.puddleGrid.add(pd, pd.x - 3, pd.z - 3, pd.x + 3, pd.z + 3);
          } else if (r < 0.158 && city.route.nearest(x, z).s > safeUntil) {
            const off = (h01(si, k + 8) - 0.5) * st.w * 0.5;
            const m: Manhole = { x: x - tz * off, z: z + tx * off, tx, tz };
            this.manholes.push(m);
            this.holeGrid.add(m, m.x - 5, m.z - 5, m.x + 5, m.z + 5);
          }
        }
        run += L;
      }
    });
  }

  puddleAt(x: number, z: number): Puddle | null {
    for (const p of this.puddleGrid.at(x, z)) {
      const dx = x - p.x, dz = z - p.z, c = Math.cos(p.ang), s = Math.sin(p.ang);
      const u = dx * c - dz * s, v = dx * s + dz * c;
      if ((u * u) / (p.rz * p.rz) + (v * v) / (p.rx * p.rx) < 1) return p;
    }
    return null;
  }

  manholeAt(x: number, z: number, r = 0.55): Manhole | null {
    for (const m of this.holeGrid.at(x, z)) if (Math.hypot(x - m.x, z - m.z) < r) return m;
    return null;
  }
}
