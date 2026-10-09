// The subway as air you can fly through: the tunnel along the real Broadway line,
// wider stations at the real station sites, the real entrance stairs, and grates up to
// the street. Described as signed distances (positive = inside the air), so collision
// is "stay where the distance is positive" and the camera can ask the same question.
//
// Blocked stretches force you back up: Prince St is flooded (a water main burst), and
// the line ends at 57 St - 7 Av.

import { Grid, type CityData } from "./data";

export const TUNNEL = {
  halfWidth: 7.2,
  floor: -9.5,
  ceiling: -2.6,
  stationHalfWidth: 12.5,
  stationCeiling: -2.4,
  stationHalfLength: 75,
  grateEvery: 70,
};

export interface Shaft { x: number; z: number; r: number; tx: number; tz: number; kind: "stairs" | "grate"; ss: number; name: string; relief?: boolean }

export interface Blocked { ss0: number; ss1: number; kind: "flood" | "end"; name: string }

export class Underground {
  readonly shafts: Shaft[] = [];
  readonly shaftGrid = new Grid<Shaft>(16);
  readonly stations: { ss: number; name: string }[];
  readonly blocked: Blocked[];
  readonly start: number;
  readonly end: number;
  private hint = -1;
  private near = { s: 0, off: 0, d: 0 };

  constructor(readonly city: CityData) {
    const sub = city.subway;
    this.stations = city.raw.stations.map((s) => ({ ss: s.ss, name: s.n }));
    const prince = this.stations.find((s) => /Prince/.test(s.name))?.ss ?? 2593;
    const end57 = this.stations.find((s) => /57 St/.test(s.name))?.ss ?? sub.length - 20;
    this.start = 0;
    this.end = Math.min(sub.length, end57 + TUNNEL.stationHalfLength - 5);
    this.blocked = [
      { ss0: prince - 150, ss1: prince + 140, kind: "flood", name: "Prince St is flooded" },
      { ss0: this.end, ss1: sub.length + 1000, kind: "end", name: "End of the line" },
    ];
    // real entrance stairs
    for (const e of city.raw.entrances) {
      const n = sub.nearest(e.x, e.z);
      const p = sub.at(n.s);
      this.addShaft({ x: e.x, z: e.z, r: 2.1, tx: p.x - e.x, tz: p.z - e.z, kind: "stairs", ss: n.s, name: e.n });
    }
    // relief vents just before the flood and the end of the line: the tunnel air (and you) escape up them
    for (const ss of [this.blocked[0].ss0 - 22, this.end - 30]) {
      const p = sub.at(ss);
      this.addShaft({ x: p.x, z: p.z, r: 2.4, tx: 0, tz: 0, kind: "grate", ss, name: "relief vent", relief: true });
    }
    // grates over the tunnel between stations
    for (let s = 40; s < this.end - 20; s += TUNNEL.grateEvery) {
      if (this.stations.some((st) => Math.abs(st.ss - s) < TUNNEL.stationHalfLength + 10)) continue;
      if (this.isBlocked(s)) continue;
      const p = sub.at(s);
      this.addShaft({ x: p.x - p.tz * 4.5, z: p.z + p.tx * 4.5, r: 1.3, tx: 0, tz: 0, kind: "grate", ss: s, name: "" });
    }
  }

  private addShaft(s: Shaft) {
    this.shafts.push(s);
    // the whole footprint: the shaft and the passage that runs from it to the tunnel
    const x1 = s.x + s.tx, z1 = s.z + s.tz;
    this.shaftGrid.add(s, Math.min(s.x, x1) - 4, Math.min(s.z, z1) - 4, Math.max(s.x, x1) + 4, Math.max(s.z, z1) + 4);
  }

  isBlocked(ss: number): Blocked | null {
    for (const b of this.blocked) if (ss > b.ss0 && ss < b.ss1) return b;
    return null;
  }

  stationAt(ss: number) {
    for (const st of this.stations) if (Math.abs(st.ss - ss) < TUNNEL.stationHalfLength) return st;
    return null;
  }

  /** Signed distance into the underground air at a point (positive inside). Also reports where. */
  sdf(x: number, y: number, z: number, info?: { ss: number; off: number; inShaft: Shaft | null }): number {
    const n = this.city.subway.nearest(x, z, this.hint, this.near);
    this.hint = n.s;
    let best = -Infinity;
    if (info) { info.ss = n.s; info.off = n.off; info.inShaft = null; }
    const blk = this.isBlocked(n.s);
    if (blk) best = -Math.min(n.s - blk.ss0, blk.ss1 - n.s);
    if (n.s >= this.start - 1 && !blk) {
      // stations open out smoothly from the tunnel over 30 m
      let k = 0;
      for (const st of this.stations) {
        const d = Math.abs(st.ss - n.s);
        if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30));
      }
      const hw = TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k;
      const ceil = TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k;
      const lateral = hw - n.d;
      best = Math.min(lateral, y - TUNNEL.floor, ceil - y);
      // the tunnel's end walls
      const endWall = Math.min(n.s - this.start + 2, this.end - n.s);
      const b = this.blocked[0];
      const flood = Math.min(Math.abs(n.s - b.ss0), Math.abs(n.s - b.ss1));
      best = Math.min(best, endWall, n.s < b.ss0 || n.s > b.ss1 ? flood + 0.0 : -flood);
    }
    for (const s of this.shaftGrid.at(x, z)) {
      // vertical shaft from the street down to the passage level
      const dh = s.r - Math.hypot(x - s.x, z - s.z);
      const top = s.kind === "grate" ? 0.6 : 0.6;
      const bottom = s.kind === "grate" ? TUNNEL.ceiling - 0.5 : -6.2;
      const v = Math.min(dh, y - bottom, top - y);
      if (v > best) { best = v; if (info) info.inShaft = s; }
      if (s.kind === "stairs") {
        // the passage from the foot of the stairs to the tunnel
        const L = Math.hypot(s.tx, s.tz) || 1, ux = s.tx / L, uz = s.tz / L;
        const t = Math.max(0, Math.min(L, (x - s.x) * ux + (z - s.z) * uz));
        const px = s.x + ux * t, pz = s.z + uz * t;
        const pr = 2.3 - Math.hypot(x - px, z - pz);
        const pv = Math.min(pr, y - -6.4, -2.2 - y);
        if (pv > best) { best = pv; if (info) info.inShaft = s; }
      }
    }
    return best;
  }

  /** Is (x, z) over a hole in the street (stairs or grate)? */
  openingAt(x: number, z: number): Shaft | null {
    for (const s of this.shaftGrid.at(x, z)) if (Math.hypot(x - s.x, z - s.z) < s.r) return s;
    return null;
  }
}

// ------------------------------------------------------------------ trains

export const TRAIN = { length: 150, speed: 22, width: 3.0, height: 3.7, uptownHeadway: 70, downtownHeadway: 88, track: 3.3 };

export interface Train { head: number; tail: number; dir: 1 | -1; off: number }

/** Where every train is at time t: deterministic, the same every run. */
/** Where every train is at time t: deterministic, the same every run. Service stops either side of
 *  a closed stretch (the flood), so trains appear and vanish at the barriers. */
export function trainsAt(t: number, length: number, out: Train[] = [], closed?: { ss0: number; ss1: number }): Train[] {
  out.length = 0;
  const loop = length + 600;
  for (const [dir, headway, phase] of [[1, TRAIN.uptownHeadway, 21], [-1, TRAIN.downtownHeadway, 47]] as const) {
    const gap = headway * TRAIN.speed;
    for (let k = 0; k * gap < loop + gap; k++) {
      const d = (((t + phase) * TRAIN.speed + k * gap) % (Math.ceil(loop / gap) * gap));
      const head = dir > 0 ? -300 + d : length + 300 - d;
      if (head < -400 || head > length + 400) continue;
      if (closed) {
        const lo = Math.min(head, head - dir * TRAIN.length), hi = Math.max(head, head - dir * TRAIN.length);
        if (hi > closed.ss0 - 12 && lo < closed.ss1 + 12) continue;
      }
      out.push({ head, tail: head - dir * TRAIN.length, dir, off: dir > 0 ? TRAIN.track : -TRAIN.track });
    }
  }
  return out;
}
