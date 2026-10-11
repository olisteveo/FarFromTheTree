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
import { makeCourse, streetPath } from "./course";
import { nearestEdge, type Polyline } from "./data";
import { inGap, openLanes, type Barrier, type Blocker } from "./blockers";

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
  /** one of the ways through (see ROUTES), if it's a link in one */
  route?: string;
  /** a false lead: it branches off a way through and looks just like it, but goes wrong */
  decoy?: "back" | "edge" | "blind";
  /** route position of its start and end (for the minimap and the pilots) */
  s0: number;
  s1: number;
}

export interface Devil { id: number; name: string; x: number; z: number; wander: number; core: number; height: number; phase: number }
export interface Lee { x: number; z: number; r: number; h: number; len: number }

export interface WindHit { x: number; y: number; z: number; jet: number; devil: number; lee: boolean; guide?: number }

/** Not every current is equal: a breeze nudges you, a gale grabs you and carries you (its
 *  grip is how firmly, see Glider guide). Grade 0..2, from the current's id. */
/** past this share of a current's radius its edge churns and throws you out, at up to SHEAR_PUSH m/s */
const SHEAR = 0.5, SHEAR_PUSH = 4.5;

export const JET_GRADE = [
  { label: "breeze", speed: 0.85, grip: 0.2 },
  { label: "stream", speed: 1.0, grip: 0.4 },
  { label: "gale", speed: 1.3, grip: 0.7 },
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
   *  short of it, or it would carry you into the barrier and hold you there; one that runs along an open
   *  lane through it (a way through: the lanes are opened here, once the ways are laid) goes on through. */
  private barriers: Barrier[];
  /** the closures' hazards above their barriers (a geyser, a building site's boom and crane): a current through one
   *  stops short of it too, and the Rooftops way keeps well over them */
  private hazards: Blocker[];
  constructor(private city: CityData, barriers: Barrier[] = [], hazards: Blocker[] = []) {
    this.barriers = barriers;
    this.hazards = hazards.filter((h) => h.shape === "stretch");
    this.buildCanyons();
    this.buildSky();
    this.buildPlunges();
    this.buildGutters();
    this.buildRoutes();
    openLanes(barriers, this.routes);
    for (const j of this.jets) {
      const p = j.pts, n = p.length / 3;
      let cut = n;
      for (let k = 0; k < n - 1 && cut === n; k++) {
        for (const b of barriers) {
          const ya = p[k * 3 + 1], yb = p[k * 3 + 4];
          if (Math.min(ya, yb) > b.height + 3) continue;
          const da = (p[k * 3] - b.x) * b.nx + (p[k * 3 + 2] - b.z) * b.nz, db = (p[k * 3 + 3] - b.x) * b.nx + (p[k * 3 + 5] - b.z) * b.nz;
          if (da * db > 0 && Math.min(Math.abs(da), Math.abs(db)) > j.r) continue;
          const ac = (p[k * 3] - b.x) * b.ax + (p[k * 3 + 2] - b.z) * b.az;
          if (Math.abs(ac) > b.half + j.r) continue;
          // (along a lane kept open through it: on through)
          if (inGap(b, ac, Math.max(ya, yb) + 1, -1)) continue;
          cut = Math.max(2, k - 2); break;
        }
      }
      // (and short of a geyser or a building site's boom and swinging load)
      for (let k = 0; k < cut - 1; k++) {
        const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
        if (this.hazards.some((h) => y < h.height + 3 && Math.hypot(x - h.x, z - h.z) < h.r + j.r)) { cut = Math.max(2, k - 2); break; }
      }
      // and stops short of the first building it would run into (a current that carries you takes you
      // into the wall and holds you there)
      for (let k = 2; k < cut - 2; k++) {
        const b = this.city.buildingAt(p[k * 3], p[k * 3 + 2]);
        // (a way-through link along the streets only clips a corner at a junction: that doesn't count)
        if (b && p[k * 3 + 1] < b.h + 2 && !(j.route && nearestEdge(b.poly, p[k * 3], p[k * 3 + 2]).d < 3)) { cut = Math.max(2, k - 2); break; }
      }
      if (cut < n) { j.pts = p.slice(0, cut * 3); j.length = (cut - 1) * STEP; }
    }
    this.jets.splice(0, this.jets.length, ...this.jets.filter((j) => j.length > 40));
    this.jets.forEach((j, i) => {
      j.id = i;
      // a spread of grades: about a third gales, the sky currents mostly gales, gutter runs never
      const h = h01(i * 7919 + 13);
      if (!j.route && !j.decoy) j.grade = j.kind === "gutter" ? (h < 0.5 ? 0 : 1) : j.kind === "sky" ? (h < 0.25 ? 1 : 2) : h < 0.3 ? 0 : h < 0.65 ? 1 : 2;
      j.speed *= JET_GRADE[j.grade].speed;
      for (let k = 0; k < j.pts.length / 3 - 1; k++) {
        const ax = j.pts[k * 3], az = j.pts[k * 3 + 2], bx = j.pts[k * 3 + 3], bz = j.pts[k * 3 + 5];
        const R = j.r;
        this.jetGrid.add([i, k], Math.min(ax, bx) - R, Math.min(az, bz) - R, Math.max(ax, bx) + R, Math.max(az, bz) + R);
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
  /** The ways through: chains of currents from Battery Park to the park, each a different line, with
   *  gaps between the links you have to fly yourself (and the closed streets to climb), so they help a
   *  lot but never carry you all the way. Mostly streams, now and then a gale, the odd breeze.
   *    west    down the avenues west of Broadway, at about 16 m (over the traffic and the lamps, under the roofs)
   *    east    the same east of Broadway
   *    roofs   along Broadway over the rooftops (up to 70 m: between the towers it stays at 70)
   *  (the fourth way is the subway: the tunnel's own draught, the ways in and out and the vents) */
  readonly routes: { id: string; name: string; line: Polyline; y: (s: number) => number }[] = [];
  private buildRoutes() {
    const city = this.city, course = makeCourse(city), end = { x: 580, z: 8420 };
    const roofY = (line: Polyline) => (s: number) => {
      let h = 0;
      for (let d = -40; d <= 40; d += 10) { const a = line.at(s + d); h = Math.max(h, city.canopy(a.x, a.z, 20)); }
      // (and always well over a closed street it passes over: the Rooftops way never runs into a closure)
      let y = Math.max(28, Math.min(70, h + 14));
      const a = line.at(s);
      for (const b of this.barriers) if (Math.abs(b.x - a.x) < 60 && Math.abs(b.z - a.z) < 60 && Math.hypot(b.x - a.x, b.z - a.z) < b.half + 40) y = Math.max(y, b.height + 12);
      for (const h of this.hazards) if (Math.hypot(h.x - a.x, h.z - a.z) < h.r + 40) y = Math.max(y, h.height + 12);
      return y;
    };
    const defs = [
      // (the route's right, +off, is west in the grid: east is -x)
      { id: "west", name: "the West Side", line: streetPath(city, course.tree, end, 170), y: () => 16, kind: "canyon" as JetKind },
      { id: "east", name: "the East Side", line: streetPath(city, course.tree, end, -170), y: () => 16, kind: "canyon" as JetKind },
      { id: "roofs", name: "the Rooftops", line: course.path, y: null as unknown as (s: number) => number, kind: "sky" as JetKind },
    ];
    defs[2].y = roofY(course.path);
    let seed = 0;
    for (const d of defs) {
      this.routes.push({ id: d.id, name: d.name, line: d.line, y: d.y });
      // (the rooftop way: a run out of the tree first; the side ways take hold of you right away, as the
      // East Side's first leg runs south into the wind round the fort)
      let s = d.kind === "sky" ? 60 : 4;
      let link = 0;
      while (s < d.line.length - 80) {
        const h1 = h01(++seed * 7919 + d.id.length), h2 = h01(seed * 104729 + 3);
        // (shorter gaps down in the streets: between the towers the street air can be against you)
        // (help, not a conveyor: a third or more of each way is yours to fly, the currents a lift between)
        const len = 160 + h1 * 130, gap = d.kind === "sky" ? 90 + h2 * 90 : 55 + h2 * 65;
        const path: [number, number, number][] = [];
        for (let t = s; t <= Math.min(s + len, d.line.length - 40); t += STEP) { const a = d.line.at(t); path.push([a.x, d.y(t), a.z]); }
        if (path.length > 6) {
          const before = this.jets.length;
          this.addJet(d.kind, `${d.name}, link ${++link}`, path);
          const j = this.jets[before];
          if (j) {
            j.route = d.id;
            j.r = d.kind === "sky" ? 6 : 5;
            j.speed = d.kind === "sky" ? 15 : 13;
            const g = h01(seed * 31 + 17);
            j.grade = g < 0.32 ? 0 : g < 0.82 ? 1 : 2;
          }
        }
        // a gap only where the street air itself carries you on (down an avenue running uptown): on a
        // crosstown leg the street gusts across you or against you, and a gap there is a dead stop
        let open = gap;
        if (d.kind !== "sky") {
          for (let t = s + len; t <= s + len + gap; t += 4) {
            const a = d.line.at(t), r = city.route.at(city.route.nearest(a.x, a.z).s);
            if (a.tx * r.tx + a.tz * r.tz < 0.6) { open = 4; break; }
          }
        }
        s += len + open;
      }
    }
    this.buildDecoys(course.path.length, end);
  }

  /** False leads: every so often a current peels off a way through (same leaves, same paper, often a
   *  gale) and carries you back downtown, out over the edge, or up a street that goes nowhere. */
  private buildDecoys(_len: number, end: { x: number; z: number }) {
    const city = this.city;
    let seed = 900;
    for (const w of this.routes) {
      const sky = w.id === "roofs";
      for (let s = 500 + h01(w.id.length * 31) * 300; s < w.line.length - 600; s += 650 + h01(++seed * 7) * 450) {
        const b = w.line.at(s), h = h01(seed * 7919 + 5);
        const kind: "back" | "edge" | "blind" = h < 0.34 ? "back" : h < 0.67 ? "edge" : "blind";
        const side = h01(seed * 104729) < 0.5 ? 1 : -1, nx = b.tz * side, nz = -b.tx * side;
        // where it goes: back down the way you came, off to the side for the edge, or a few blocks across
        const tgt = kind === "back" ? { x: b.x - b.tx * 500 + nx * 160, z: b.z - b.tz * 500 + nz * 160 }
          : kind === "edge" ? { x: b.x + nx * 700, z: b.z + nz * 700 }
          : { x: b.x + nx * 260 + b.tx * 60, z: b.z + nz * 260 + b.tz * 60 };
        if (Math.hypot(tgt.x - end.x, tgt.z - end.z) < 900) continue; // (never toward the park)
        let line: Polyline;
        try { line = streetPath(city, b, tgt, 0); } catch { continue; }
        if (line.length < 120) continue;
        // start where it leaves the way (a little after: you see it peel off), run 180-300 m
        let s0 = 0;
        for (let t = 0; t < line.length; t += 4) { const a = line.at(t); if (w.line.nearest(a.x, a.z).d > 6) { s0 = Math.max(0, t - 8); break; } }
        const len = Math.min(line.length - s0, 180 + h01(seed * 13) * 120);
        if (len < 100) continue;
        const y = w.y(s);
        const path: [number, number, number][] = [];
        for (let t = s0; t <= s0 + len; t += STEP) { const a = line.at(t); path.push([a.x, sky ? y : 16, a.z]); }
        const before = this.jets.length;
        this.addJet(sky ? "sky" : "canyon", `a false lead off ${w.name}`, path);
        const j = this.jets[before];
        if (!j) continue;
        j.decoy = kind;
        j.r = sky ? 6 : 5;
        j.speed = sky ? 15 : 13;
        // (they look worth taking: streams and gales, never a breeze)
        j.grade = h01(seed * 59) < 0.5 ? 1 : 2;
      }
    }
  }

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
    let bestK = 0, bestScore = 0, bj = -1, bdx = 0, bdy = 0, bdz = 0, bL2 = 1, bpx = 0, bpy = 0, bpz = 0;
    for (const [ji, k] of this.jetGrid.around(x, z, 0, this.scratch)) {
      const j = this.jets[ji], p = j.pts;
      const ax = p[k * 3], ay = p[k * 3 + 1], az = p[k * 3 + 2];
      const dx = p[k * 3 + 3] - ax, dy = p[k * 3 + 4] - ay, dz = p[k * 3 + 5] - az;
      const L2 = dx * dx + dy * dy + dz * dz;
      if (L2 < 0.01) continue; // (a doubled point where two runs of the path meet: no direction of its own)
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2));
      const cx = ax + dx * u, cy = ay + dy * u, cz = az + dz * u;
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (d > j.r) continue;
      const along = (k + u) * STEP, ends = smooth(0, 14, along) * smooth(0, 14, j.length - along);
      // full strength over most of the tube, falling off only near its skin
      const kk = Math.min(1, 1.6 * (1 - (d / j.r) ** 2)) * ends;
      // (most of the tube is at full strength, so between equals the nearest segment wins: the one behind
      // you measures to its end point, and its pull to that point drags you backwards)
      const score = kk - d * 1e-3;
      if (score <= bestScore) continue;
      bestScore = score;
      bestK = kk; bj = ji; bdx = dx; bdy = dy; bdz = dz; bL2 = L2; bpx = cx - x; bpy = cy - y; bpz = cz - z;
    }
    if (bj >= 0) {
      // (applied once, for the nearest, strongest segment)
      const j = this.jets[bj], kk = bestK, dx = bdx, dy = bdy, dz = bdz, L = Math.sqrt(bL2);
      // A current is a fast core with a ragged edge. It doesn't steer you (you fly it like any air:
      // a tailwind is speed), only a soft hold in the middle third keeps you in if you fly straight.
      // Out toward the skin the shear churns and throws you clear: riding one is work, and leaving one
      // is a matter of steering for its edge.
      const blend = 0.75 * kk;
      let px = bpx, py = bpy, pz = bpz;
      const pa = (px * dx + py * dy + pz * dz) / bL2;
      px -= dx * pa; py -= dy * pa; pz -= dz * pa;
      const off = Math.hypot(px, py, pz), q = off / j.r;
      let hold = 0.9 * kk;
      if (q > SHEAR) hold = -SHEAR_PUSH * ((q - SHEAR) / (1 - SHEAR)) / Math.max(0.3, off); // (outward, in m/s per m)
      const churn = 3.2 * smooth(SHEAR * 0.7, 1, q);
      out.x = out.x * (1 - blend) + (dx / L) * j.speed * kk + px * hold + churn * Math.sin(t * 2.3 + x * 0.21 + z * 0.13);
      out.y = out.y * (1 - blend) + (dy / L) * j.speed * kk + py * hold + 0.9 * kk + churn * 0.6 * Math.sin(t * 1.7 + z * 0.19);
      out.z = out.z * (1 - blend) + (dz / L) * j.speed * kk + pz * hold + churn * Math.cos(t * 2.1 + x * 0.17 - z * 0.11);
      if (kk > 0.3) out.jet = bj;
      // (no steering: guide stays 0 - that's for the ways in and out of the subway)
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
