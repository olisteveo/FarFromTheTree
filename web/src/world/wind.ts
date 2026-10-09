// The wind field. Continuous, deterministic in (position, run time), and shaped by
// the city: open sky blows hard, avenues channel it uptown or downtown, streets
// carry it east or west, steam vents, AC units and roof thermals add local jets,
// and the subway trains shove the tunnel air ahead of them.

import { clamp, noise3, smoothstep } from "../core/rng";
import { canopyHeight, roadAt, type City } from "./city";
import { WORLD } from "./spec";

export interface V3 { x: number; y: number; z: number }

export const SUBWAY = {
  speed: 24,
  length: 110,
  headway: 95, // seconds between trains on each track
  /** Uptown trains ride the east track (x > 0), downtown trains the west one. */
  tracks: [
    { side: 1, dir: 1, offset: 18 },
    { side: -1, dir: -1, offset: 61 },
  ],
};

export interface Train { z0: number; z1: number; x0: number; x1: number; dir: number }

/** Where every train is at time t. A pure function, so trains are the same every run. */
export function trainsAt(t: number): Train[] {
  const sw = WORLD.subway;
  const L = WORLD.zMax - WORLD.zMin + 400;
  const out: Train[] = [];
  for (const tr of SUBWAY.tracks) {
    const span = SUBWAY.headway * SUBWAY.speed;
    for (let k = 0; k * span < L + span; k++) {
      const d = ((t + tr.offset) * SUBWAY.speed + k * span) % (Math.ceil(L / span) * span);
      const head = tr.dir > 0 ? WORLD.zMin - 200 + d : WORLD.zMax + 200 - d;
      const tail = head - tr.dir * SUBWAY.length;
      const x0 = tr.side > 0 ? sw.x + 0.6 : sw.x - sw.halfWidth + 0.6;
      out.push({ z0: Math.min(head, tail), z1: Math.max(head, tail), x0, x1: x0 + sw.halfWidth - 1.2, dir: tr.dir });
    }
  }
  return out;
}

export class WindField {
  private trains: Train[] = [];
  private trainT = -1;
  constructor(private city: City) {}

  private trainsFor(t: number) {
    if (t !== this.trainT) {
      this.trains = trainsAt(t);
      this.trainT = t;
    }
    return this.trains;
  }

  /** Wind velocity (m/s) at a point. Writes into out and returns it. */
  sample(x: number, y: number, z: number, t: number, out: V3): V3 {
    const P = WORLD.prevailing;
    const sw = WORLD.subway;

    // ---- underground: only the tunnel air, pushed by the trains
    if (y < -0.2) {
      out.x = 0; out.y = 0; out.z = 1.6;
      if (Math.abs(x - sw.x) < sw.halfWidth + 0.5) {
        for (const tr of this.trainsFor(t)) {
          const head = tr.dir > 0 ? tr.z1 : tr.z0;
          const ahead = (z - head) * tr.dir; // >0 in front of the train
          const sameTrack = (x - sw.x) * (tr.x0 - sw.x) >= 0 ? 1 : 0.45;
          if (ahead > 0 && ahead < 220) out.z += tr.dir * SUBWAY.speed * 0.95 * (1 - ahead / 220) * sameTrack;
          const behind = tr.dir > 0 ? tr.z0 - z : z - tr.z1;
          if (behind > 0 && behind < 120) out.z += tr.dir * SUBWAY.speed * 0.6 * (1 - behind / 120) * sameTrack;
        }
        // shafts: air rises out of grates and stairs
        for (const o of this.city.openings) {
          if (x > o.x0 - 1 && x < o.x1 + 1 && z > o.z0 - 1 && z < o.z1 + 1 && y > sw.ceiling - 2) out.y += 2.5;
        }
      }
      return out;
    }

    // ---- open sky: the prevailing wind, stronger with height, veering slowly
    const veer = noise3(x / 900, 0, z / 900 + t / 240, 7) * 0.45;
    const ang = (P.dirDeg * Math.PI) / 180 + veer;
    const gx = Math.sin(ang), gz = Math.cos(ang);
    const H = canopyHeight(this.city, x, z);
    const above = Math.max(0, y - H);
    const sky = P.speed + (P.roofSpeed - P.speed) * smoothstep(0, P.gradientHeight, above);
    let wx = gx * sky, wy = 0, wz = gz * sky;
    // gusts and turbulence
    const g = 1 + 0.35 * noise3(x / 70, y / 45, z / 70 - t * 0.35, 3);
    wx *= g; wz *= g;
    wy += 1.1 * noise3(x / 40, y / 30, z / 40 + t * 0.5, 11);

    // ---- street level: the canyons take over below the roofline
    if (H > 4 && y < H * 1.15) {
      const r = roadAt(this.city, x, z);
      let cx = 0, cz = 0, cy = 0;
      if (r) {
        const narrow = clamp(30 / (r.half * 2), 0.8, 1.6); // venturi: narrow lanes blow faster
        const base = r.kind === "avenue" ? P.speed * 1.05 : r.kind === "alley" ? P.speed * 0.8 : P.speed * 0.7;
        const s = base * narrow;
        if (r.axis === "z") cz = r.flow * s; else cx = r.flow * s;
        // a little lift and swirl all along the canyon: warm streets breathe upward
        cy =0.6 + 1.4 * noise3(x / 18, y / 12, z / 18 + t * 0.8, 5);
        const tw = 1.4 * noise3(x / 22, y / 15, z / 22 - t * 0.6, 9);
        if (r.axis === "z") cx += tw; else cz += tw;
      } else {
        // courtyards and doorways: slow eddies
        cx = 1.5 * noise3(x / 15, y / 10, z / 15 + t * 0.4, 21);
        cz = 1.5 * noise3(x / 15, y / 10, z / 15 + t * 0.4, 22);
        cy = 0.4;
      }
      const ground = 0.55 + 0.45 * smoothstep(0, 4, y); // slower right at the pavement
      const k = 1 - smoothstep(H * 0.7, H * 1.15, y);
      wx = wx * (1 - k) + cx * ground * k;
      wy = wy * (1 - k) + cy * k;
      wz = wz * (1 - k) + cz * ground * k;
    }

    // ---- local sources
    for (const i of this.city.index.windsNear(x, z)) {
      const w = this.city.wind[i];
      if (w.kind === "jet") {
        const rx = x - w.x, ry = y - w.y, rz = z - w.z;
        const along = rx * w.dx + ry * w.dy + rz * w.dz;
        if (along < 0 || along > w.length) continue;
        const px = rx - w.dx * along, py = ry - w.dy * along, pz = rz - w.dz * along;
        const rad = w.radius * (1 + along / w.length);
        const r2 = (px * px + py * py + pz * pz) / (rad * rad);
        if (r2 > 1) continue;
        const s = w.speed * (1 - along / w.length) * (1 - r2);
        wx += w.dx * s; wy += w.dy * s; wz += w.dz * s;
      } else if (w.kind === "plume") {
        const dy = y - w.y;
        if (dy < -1 || dy > w.height) continue;
        const rad = w.radius * (1 + (dy / w.height) * 1.8);
        const r2 = ((x - w.x) ** 2 + (z - w.z) ** 2) / (rad * rad);
        if (r2 > 1) continue;
        let pulse = 1;
        if (w.train) {
          pulse = 0;
          for (const tr of this.trainsFor(t)) {
            const d = Math.max(tr.z0 - z, 0, z - tr.z1);
            pulse = Math.max(pulse, 1 - d / 70);
          }
          pulse = Math.max(0.08, pulse);
        } else if (w.period > 0) {
          pulse = 0.45 + 0.55 * Math.max(0, Math.sin(((t + w.phase) / w.period) * Math.PI * 2));
        }
        const s = w.speed * pulse * (1 - r2) * (1 - 0.6 * (dy / w.height));
        wy += s;
        // plumes lean with the breeze
        wx *= 1 - 0.5 * (1 - r2); wz *= 1 - 0.5 * (1 - r2);
      } else {
        const dy = y - w.y;
        if (dy < 0 || dy > w.height) continue;
        const r2 = ((x - w.x) ** 2 + (z - w.z) ** 2) / (w.radius * w.radius);
        if (r2 > 1) continue;
        wy += w.speed * (1 - r2) * (1 - dy / w.height) * (0.75 + 0.25 * Math.sin(t * 0.4 + w.x));
      }
    }

    // ---- the edges of the world: the wind turns you back
    const edge = 60;
    if (x < WORLD.xMin + edge) wx += ((WORLD.xMin + edge - x) / edge) * 14;
    if (x > WORLD.xMax - edge) wx -= ((x - (WORLD.xMax - edge)) / edge) * 14;
    if (z < WORLD.zMin + edge) wz += ((WORLD.zMin + edge - z) / edge) * 14;
    if (y > 480) wy -= (y - 480) * 0.2;

    out.x = wx; out.y = wy; out.z = wz;
    return out;
  }
}
