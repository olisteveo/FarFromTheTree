// The wind's secrets: hidden currents, dust devils and tower downdrafts, laid over the base
// airflow (avenue tailwinds, cross-street gusts, gust fronts, steam, the subway draught).
//
//   Hidden currents ("jets"): invisible ribbons of fast air, each a different way uptown.
//     canyon  - a strong current up a parallel avenue, at about third-floor height
//     sky     - from the top of one tower to the top of another, high over the roofs
//     plunge  - from roof height down into a street canyon: a dive with the wind behind you
//     gutter  - fast and low along the kerb, among the cabs (quick and risky)
//   Nothing marks them. The clues: litter caught in a stream, the wind streaks turning
//   cyan, a whistle. Found ones are remembered and drawn on the minimap.
//
//   Dust devils: spinning columns in the open squares that carry you up in a spiral.
//   Downdrafts: sinking, churning air in the lee of the tallest towers (the winter wind is
//   from the north-west). Fly through one low and it pushes you down into the street.
//
// Everything is built from the city data and is a pure function of time, so the headless
// test pilots meet the same wind.

import type { CityData } from "./data";
import { Grid } from "./data";
import { project } from "./landmarks";
import type { Barrier } from "./blockers";

export type JetKind = "canyon" | "sky" | "plunge" | "gutter";

export interface Jet {
  id: number;
  kind: JetKind;
  name: string;
  /** points every STEP metres along it: x, y, z */
  pts: Float32Array;
  length: number;
  /** radius of the tube and the speed on its axis */
  r: number;
  speed: number;
  /** 0 breeze, 1 stream, 2 gale (see JET_GRADE) */
  grade: number;
  /** route position of its start and end (for the minimap and the pilots) */
  s0: number;
  s1: number;
}

export interface Devil { id: number; name: string; x: number; z: number; wander: number; core: number; height: number; phase: number }
export interface Lee { x: number; z: number; r: number; h: number; len: number }

export interface WindHit { x: number; y: number; z: number; jet: number; devil: number; lee: boolean; guide?: number }

/** Not every current is equal: a breeze nudges you, a gale grabs you and carries you (its
 *  grip is how firmly, see Glider guide). Grade 0..2, from the current's id. */
export const JET_GRADE = [
  { label: "breeze", speed: 0.85, grip: 0.3 },
  { label: "stream", speed: 1.05, grip: 0.6 },
  { label: "gale", speed: 1.35, grip: 0.95 },
];

const STEP = 6;
const WIND = { x: -0.96, z: -0.28 }; // the winter wind over the roofs, from the north-west
const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const JET_SPEC: Record<JetKind, { r: number; speed: number; label: string }> = {
  canyon: { r: 4.5, speed: 19, label: "canyon current" },
  sky: { r: 7, speed: 25, label: "sky current" },
  plunge: { r: 5, speed: 23, label: "plunge" },
  gutter: { r: 2.4, speed: 16, label: "gutter run" },
};

export class WindFeatures {
  readonly jets: Jet[] = [];
  readonly devils: Devil[] = [];
  readonly lees: Lee[] = [];
  private jetGrid = new Grid<[number, number]>(24); // [jet, segment]
  private leeGrid = new Grid<Lee>(48);
  private scratch: [number, number][] = [];

  /** barriers: the closed streets (world/blockers.ts). A current that would run through one stops
   *  short of it, or it would carry you into the barrier and hold you there. */
  constructor(private city: CityData, barriers: Barrier[] = []) {
    this.buildCanyons();
    this.buildSky();
    this.buildPlunges();
    this.buildGutters();
    for (const j of this.jets) {
      const p = j.pts, n = p.length / 3;
      let cut = n;
      for (let k = 0; k < n - 1 && cut === n; k++) {
        for (const b of barriers) {
          const ya = p[k * 3 + 1], yb = p[k * 3 + 4];
          if (Math.min(ya, yb) > b.height + 3) continue;
          const da = (p[k * 3] - b.x) * b.nx + (p[k * 3 + 2] - b.z) * b.nz, db = (p[k * 3 + 3] - b.x) * b.nx + (p[k * 3 + 5] - b.z) * b.nz;
          if (da * db > 0 && Math.min(Math.abs(da), Math.abs(db)) > j.r) continue;
          const ax = Math.abs((p[k * 3] - b.x) * b.ax + (p[k * 3 + 2] - b.z) * b.az);
          if (ax > b.half + j.r) continue;
          cut = Math.max(2, k - 2); break;
        }
      }
      if (cut < n) { j.pts = p.slice(0, cut * 3); j.length = (cut - 1) * STEP; }
    }
    this.jets.splice(0, this.jets.length, ...this.jets.filter((j) => j.length > 40));
    this.jets.forEach((j, i) => {
      j.id = i;
      // a spread of grades: about a third gales, the sky currents mostly gales, gutter runs never
      const h = h01(i * 7919 + 13);
      j.grade = j.kind === "gutter" ? (h < 0.5 ? 0 : 1) : j.kind === "sky" ? (h < 0.25 ? 1 : 2) : h < 0.3 ? 0 : h < 0.65 ? 1 : 2;
      j.speed *= JET_GRADE[j.grade].speed;
      for (let k = 0; k < j.pts.length / 3 - 1; k++) {
        const ax = j.pts[k * 3], az = j.pts[k * 3 + 2], bx = j.pts[k * 3 + 3], bz = j.pts[k * 3 + 5];
        this.jetGrid.add([i, k], Math.min(ax, bx) - j.r, Math.min(az, bz) - j.r, Math.max(ax, bx) + j.r, Math.max(az, bz) + j.r);
      }
    });
    this.buildDevils();
    this.buildLees();
  }

  // ------------------------------------------------------------------ building the currents

  private addJet(kind: JetKind, name: string, path: [number, number, number][]) {
    // resample the path every STEP metres
    const out: number[] = [];
    let len = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay, az] = path[i], [bx, by, bz] = path[i + 1];
      const L = Math.hypot(bx - ax, by - ay, bz - az);
      const n = Math.max(1, Math.round(L / STEP));
      for (let k = 0; k < n; k++) { const t = k / n; out.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t); }
      len += L;
    }
    const last = path[path.length - 1];
    out.push(last[0], last[1], last[2]);
    const spec = JET_SPEC[kind];
    const r = this.city.route;
    this.jets.push({
      id: -1, kind, name, pts: new Float32Array(out), length: len, r: spec.r, speed: spec.speed, grade: 1,
      s0: r.nearest(path[0][0], path[0][2]).s, s1: r.nearest(last[0], last[2]).s,
    });
  }

  /** Long avenues running uptown near the route but not on it: canyon currents. */
  private buildCanyons() {
    const city = this.city, route = city.route;
    const byName = new Map<string, { s: number; x: number; z: number; w: number }[]>();
    for (const st of city.raw.streets) {
      if (st.rw !== 1) continue;
      const p = st.p;
      for (let k = 0; k < p.length - 2; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        const n = route.nearest((ax + bx) / 2, (az + bz) / 2);
        const t = route.at(n.s);
        const align = ((bx - ax) * t.tx + (bz - az) * t.tz) / L;
        if (Math.abs(align) < 0.93 || n.d < 45 || n.d > 420) continue;
        const list = byName.get(st.n) ?? byName.set(st.n, []).get(st.n)!;
        list.push({ s: n.s, x: ax, z: az, w: st.w }, { s: route.nearest(bx, bz).s, x: bx, z: bz, w: st.w });
      }
    }
    const used: { name: string; s0: number; s1: number }[] = [];
    const names = [...byName.keys()].sort();
    for (const name of names) {
      const pts = byName.get(name)!.sort((a, b) => a.s - b.s);
      // walk along the avenue in uptown order and cut it into runs of 380-650 m
      let start = 0;
      while (start < pts.length - 1) {
        let end = start;
        while (end < pts.length - 1 && pts[end + 1].s - pts[start].s < 380 + h01(start * 7 + name.length) * 270 && Math.hypot(pts[end + 1].x - pts[end].x, pts[end + 1].z - pts[end].z) < 120) end++;
        const s0 = pts[start].s, s1 = pts[end].s;
        if (s1 - s0 > 300 && !used.some((u) => Math.abs(u.s0 - s0) < 500) && h01(Math.round(s0) + name.length * 31) < 0.7) {
          const y = 9 + h01(Math.round(s1)) * 7;
          const path: [number, number, number][] = [];
          for (let i = start; i <= end; i += Math.max(1, Math.floor((end - start) / 24))) path.push([pts[i].x, y, pts[i].z]);
          path.push([pts[end].x, y, pts[end].z]);
          {
            this.addJet("canyon", name.replace(/\b(\w)(\w*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase()), path);
            used.push({ name, s0, s1 });
          }
        }
        start = end + 1;
      }
    }
  }

  /** Tower top to tower top: sky currents high over the roofs. */
  private buildSky() {
    const city = this.city;
    // towers you can actually get up to (the roof layer tops out around 200 m)
    const towers = city.buildings.filter((b) => b.h > 70 && b.h < 200 && Math.abs(b.off) < 320).sort((a, b) => a.s - b.s);
    const used: number[] = [];
    for (const a of towers) {
      if (used.some((s) => Math.abs(s - a.s) < 750)) continue;
      // the tallest tower 300-900 m further uptown, not too far to the side
      let best = null as (typeof towers)[number] | null;
      for (const b of towers) {
        const ds = b.s - a.s;
        if (ds < 300 || ds > 900 || Math.abs(b.off - a.off) > 320) continue;
        if (!best || b.h > best.h) best = b;
      }
      if (!best) continue;
      const path: [number, number, number][] = [];
      const top = Math.max(a.h, best.h) + 16;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const x = a.cx + (best.cx - a.cx) * t, z = a.cz + (best.cz - a.cz) * t;
        // an arc from just over one roof to just over the other, never through a building
        let y = (a.h + 8) * (1 - t) + (best.h + 8) * t + Math.sin(t * Math.PI) * (top - Math.max(a.h, best.h));
        y = Math.max(y, this.city.canopy(x, z, 10) + 8);
        path.push([x, y, z]);
      }
      this.addJet("sky", `the ${Math.round(a.h)} m to ${Math.round(best.h)} m skyway`, path);
      used.push(a.s);
    }
  }

  /** From roof height down into a street canyon along the route: plunges. */
  private buildPlunges() {
    const city = this.city, route = city.route;
    for (let s = 700; s < route.length - 600; s += 1050 + h01(s) * 500) {
      const a = route.at(s);
      const H = Math.min(95, city.canopy(a.x, a.z, 30));
      if (H < 25) continue;
      const path: [number, number, number][] = [];
      // 160 m dive from above the roofs to 5 m, then 110 m along the street
      for (let d = 0; d <= 270; d += 15) {
        const p = route.at(s + d);
        const t = Math.min(1, d / 160);
        const y = H + 6 - (H + 1) * smooth(0, 1, t);
        path.push([p.x, Math.max(y, 5), p.z]);
      }
      this.addJet("plunge", `the ${Math.round(H)} m plunge`, path);
    }
  }

  /** Fast and low along the kerb: gutter runs. */
  private buildGutters() {
    const city = this.city, route = city.route;
    for (let s = 420; s < route.length - 500; s += 1350 + h01(s * 3) * 400) {
      const path: [number, number, number][] = [];
      const side = h01(s) < 0.5 ? -1 : 1;
      let ok = true;
      for (let d = 0; d <= 240; d += 12) {
        const p = route.at(s + d);
        const hit = { tx: 0, tz: 1, w: 10, d: 0, dist: Infinity, name: "" };
        city.street(p.x, p.z, hit);
        const off = (Math.max(6, hit.w) / 2 - 1.3) * side;
        const x = p.x + p.tz * off, z = p.z - p.tx * off;
        if (city.buildingAt(x, z)) { ok = false; break; }
        path.push([x, 1.4, z]);
      }
      if (ok && path.length > 8) this.addJet("gutter", "the gutter run", path);
    }
  }

  /** Open squares near the route get a dust devil wandering around them. */
  private buildDevils() {
    const city = this.city;
    const spots: [string, number, number][] = [
      ["Bowling Green", 40.7056, -74.0134], ["City Hall Plaza", 40.7123, -74.0059], ["Foley Square", 40.7143, -74.0026],
      ["Union Square", 40.7359, -73.9906], ["Madison Square", 40.7420, -73.9877], ["Herald Square", 40.7497, -73.9877],
      ["Duffy Square", 40.7590, -73.9850], ["Columbus Circle", 40.7681, -73.9819], ["Sheep Meadow", 40.7716, -73.9750],
    ];
    spots.forEach(([name, lat, lon], i) => {
      const [x, z] = project(city, lat, lon);
      if (city.route.nearest(x, z).d > 260) return;
      this.devils.push({ id: i, name, x, z, wander: 14, core: 3.6, height: 46, phase: i * 2.1 });
    });
  }

  /** The tallest towers shed sinking, churning air downwind. */
  private buildLees() {
    for (const b of this.city.buildings) {
      if (b.h < 160 || Math.abs(b.off) > 300) continue;
      const r = Math.sqrt(b.area / Math.PI);
      const lee: Lee = { x: b.cx, z: b.cz, r, h: b.h, len: Math.min(220, b.h * 1.1) };
      this.lees.push(lee);
      const ex = b.cx + WIND.x * lee.len, ez = b.cz + WIND.z * lee.len;
      this.leeGrid.add(lee, Math.min(b.cx, ex) - r - 10, Math.min(b.cz, ez) - r - 10, Math.max(b.cx, ex) + r + 10, Math.max(b.cz, ez) + r + 10);
    }
  }

  // ------------------------------------------------------------------ sampling

  /** Where the dust devil is right now. */
  devilAt(d: Devil, t: number): [number, number] {
    return [d.x + Math.sin(t * 0.13 + d.phase) * d.wander, d.z + Math.cos(t * 0.11 + d.phase * 1.7) * d.wander];
  }

  /** Add the features' wind at (x, y, z) to `out` (which holds the base wind). */
  apply(x: number, y: number, z: number, t: number, out: WindHit): WindHit {
    out.jet = -1; out.devil = -1; out.lee = false; out.guide = 0;
    if (y < -0.4) return out;
    // hidden currents
    let bestK = 0;
    for (const [ji, k] of this.jetGrid.around(x, z, 0, this.scratch)) {
      const j = this.jets[ji], p = j.pts;
      const ax = p[k * 3], ay = p[k * 3 + 1], az = p[k * 3 + 2];
      const dx = p[k * 3 + 3] - ax, dy = p[k * 3 + 4] - ay, dz = p[k * 3 + 5] - az;
      const L2 = dx * dx + dy * dy + dz * dz || 1e-9;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2));
      const cx = ax + dx * u, cy = ay + dy * u, cz = az + dz * u;
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (d > j.r) continue;
      const along = (k + u) * STEP, ends = smooth(0, 14, along) * smooth(0, 14, j.length - along);
      // full strength over most of the tube, falling off only near its skin
      const kk = Math.min(1, 1.6 * (1 - (d / j.r) ** 2)) * ends;
      if (kk <= bestK) continue;
      bestK = kk;
      const L = Math.sqrt(L2);
      // the stream itself, a firm hold toward its axis so you can ride it, and lift enough to
      // cancel a leaf's sink (it's moving with the air, so it gets little lift of its own)
      const blend = 0.75 * kk;
      out.x = out.x * (1 - blend) + (dx / L) * j.speed * kk + (cx - x) * 3.2 * kk;
      out.y = out.y * (1 - blend) + (dy / L) * j.speed * kk + (cy - y) * 3.2 * kk + 2.2 * kk;
      out.z = out.z * (1 - blend) + (dz / L) * j.speed * kk + (cz - z) * 3.2 * kk;
      if (kk > 0.3) out.jet = ji;
      // (the gutter runs never take hold: down among the cabs, being carried is how you die)
      out.guide = j.kind === "gutter" ? 0 : JET_GRADE[j.grade].grip * Math.min(1, kk);
    }
    // dust devils
    for (const dv of this.devils) {
      if (Math.abs(x - dv.x) > 60 || Math.abs(z - dv.z) > 60 || y > dv.height + 6) continue;
      const [cx, cz] = this.devilAt(dv, t);
      const rx = x - cx, rz = z - cz, d = Math.hypot(rx, rz) + 1e-3;
      const core = dv.core * (1 + y / 25); // it widens as it rises
      if (d > core * 3.2) continue;
      const pulse = 0.65 + 0.35 * Math.sin(t * 0.4 + dv.phase);
      const k = Math.max(0, 1 - d / (core * 3.2)) * pulse * (1 - Math.max(0, y - dv.height + 10) / 16);
      // spin (counter-clockwise from above), suck in, and lift strongest in the core
      const spin = 10 * Math.min(1, d / core) * k;
      out.x += (-rz / d) * spin - (rx / d) * 2.2 * k;
      out.z += (rx / d) * spin - (rz / d) * 2.2 * k;
      out.y += 11 * k * Math.exp(-((d / core) ** 2));
      if (k > 0.35) out.devil = dv.id;
    }
    // tower downdrafts
    for (const l of this.leeGrid.at(x, z)) {
      if (y > l.h) continue;
      const rx = x - l.x, rz = z - l.z;
      const along = rx * WIND.x + rz * WIND.z, side = Math.abs(rx * WIND.z - rz * WIND.x);
      if (along < l.r || along > l.r + l.len || side > l.r + 8) continue;
      const k = (1 - (along - l.r) / l.len) * (1 - side / (l.r + 8)) * smooth(0, 15, y);
      out.y -= 4.5 * k;
      out.x += Math.sin(t * 1.7 + x * 0.05) * 2.5 * k;
      out.z += Math.cos(t * 1.3 + z * 0.05) * 2.5 * k;
      out.lee = true;
    }
    return out;
  }
}
