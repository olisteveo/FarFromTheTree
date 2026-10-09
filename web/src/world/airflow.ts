// The wind, by layer. Deterministic in (position, time): every run blows the same.
//
//   Rooftops  the cold north-westerly off the Hudson: strong, gusty, mostly across and
//             a little against you. Slow but safe. Thermals over dark roofs and lift on
//             the windward faces of buildings keep you up.
//   Street    the avenues channel it uptown (the fast lane above ground); cross streets
//             gust across; steam manholes lift you; cabs and buses drag the air behind
//             them. Middle speed, middle danger.
//   Subway    the trains' piston wind: a roaring tailwind uptown, surges ahead of every
//             uptown train, a wall of air (and steel) from the downtown ones.

import { clamp, noise3, smoothstep } from "../core/rng";
import { inPoly, nearestEdge, streetHit, type Building, type CityData } from "./data";
import { StreetLife } from "./streetlife";
import { Traffic } from "./traffic";
import { TRAIN, trainsAt, TUNNEL, Underground, type Train } from "./underground";

export type Lane = "subway" | "street" | "roof";

export const AIR = {
  avenue: 9.5,        // street tailwind on route-aligned streets (m/s)
  cross: 4.5,         // cross-street gusts
  channel: 0.35,      // how strongly an avenue canyon draws you back to its middle (1/s)
  roof: 8.5,          // the north-westerly over the roofs
  roofGrowth: 0.035,  // stronger with height
  tunnel: 14,         // the tunnel's standing draught
  station: 7,
  canyonLift: 1.5,    // mean updraft in the street canyons (m/s)
  trainPush: 20,      // extra ahead of an uptown train
  corridor: 340,      // how far either side of the route before the wind turns you back
};

export interface AirSample {
  x: number; y: number; z: number;
  lane: Lane;
  /** what the leaf touched, if it's fatal or hurts */
  vehicle: boolean;
  train: boolean;
}

/** The winter wind's direction over the roofs: from the north-west, so it blows to the
 *  south-east, which in the grid frame (east = -x) is across the route and slightly against. */
const NW = { x: -0.96, z: -0.28 };

const tmpE = { d: 0, nx: 0, nz: 0, px: 0, pz: 0 };

export class Airflow {
  readonly under: Underground;
  readonly traffic: Traffic;
  readonly life: StreetLife;
  private trains: Train[] = [];
  private trainT = -1;
  private wk = { x: 0, y: 0, z: 0, hit: null as unknown };
  private s1 = streetHit();
  private s2 = streetHit();
  private nr = { s: 0, off: 0, d: 0 };
  private hint = -1;
  private bl: Building[] = [];
  private uinfo = { ss: 0, off: 0, inShaft: null as unknown };

  constructor(readonly city: CityData) {
    this.under = new Underground(city);
    this.traffic = new Traffic(city);
    this.life = new StreetLife(city);
  }

  trainsAt(t: number): Train[] {
    if (t !== this.trainT) { trainsAt(t, this.city.subway.length, this.trains, this.under.blocked[0]); this.trainT = t; }
    return this.trains;
  }

  /** Which layer a point is in. */
  lane(x: number, y: number, z: number): Lane {
    if (y < -0.4) return "subway";
    const H = this.city.canopy(x, z, 14);
    if (H > 6 && y < H * 0.88) return "street";
    if (H <= 6 && y < 14) return "street"; // open ground: parks, squares, sites
    return "roof";
  }

  sample(x: number, y: number, z: number, t: number, out: AirSample): AirSample {
    out.vehicle = false; out.train = false;
    const city = this.city;
    const n = city.route.nearest(x, z, this.hint, this.nr);
    this.hint = n.s;
    const rt = city.route.at(n.s);
    let wx = 0, wy = 0, wz = 0;

    // ---------------------------------------------------------------- underground
    if (y < -0.4) {
      out.lane = "subway";
      const u = this.under;
      u.sdf(x, y, z, this.uinfo as never);
      const ss = this.uinfo.ss, off = this.uinfo.off;
      const sp = city.subway.at(ss);
      const st = u.stationAt(ss);
      let along = st ? AIR.station : AIR.tunnel;
      for (const tr of this.trainsAt(t)) {
        const ahead = (ss - tr.head) * tr.dir; // > 0 in front of the train
        const behind = (tr.tail - ss) * tr.dir;
        const sameTrack = Math.sign(off) === Math.sign(tr.off) ? 1 : 0.5;
        if (tr.dir > 0) {
          if (ahead > 0 && ahead < 260) along += AIR.trainPush * (1 - ahead / 260) * sameTrack;
          if (behind > 0 && behind < 120) along += 8 * (1 - behind / 120);
        } else if (ahead > 0 && ahead < 220) {
          along -= (AIR.tunnel + 14) * (1 - ahead / 220) * sameTrack; // the downtown train's wall of air
        }
        // inside a train?
        const inBody = tr.dir > 0 ? ss < tr.head && ss > tr.tail : ss > tr.head && ss < tr.tail;
        if (inBody && Math.abs(off - tr.off) < TRAIN.width / 2 + 0.15 && y < TUNNEL.floor + 0.6 + TRAIN.height) out.train = true;
      }
      // the air slows as the tunnel nears the flood or the end of the line and escapes up the relief vent
      const blockAhead = Math.min(...u.blocked.map((b) => (b.ss0 > ss ? b.ss0 - ss : 1e9)));
      if (blockAhead < 140) along *= 0.3 + 0.7 * (blockAhead / 140);
      wx = sp.tx * along; wz = sp.tz * along;
      // pull toward the middle of the tunnel and a little turbulence
      wx += -sp.tz * -off * 0.15; wz += sp.tx * -off * 0.15;
      wy = 0.8 * noise3(x / 8, y / 4, z / 8 + t, 41);
      // shafts: air leaks up the stairs, and the grates breathe out when a train passes
      const sh = this.uinfo.inShaft as { kind: string; x: number; z: number; ss: number } | null;
      if (sh) {
        let pump = sh.kind === "stairs" ? -1.5 : 0.5; // the stations draw air (and leaves) down the stairs
        if ((sh as { relief?: boolean }).relief) pump = 13;
        if (sh.kind === "grate") for (const tr of this.trainsAt(t)) {
          const d = Math.max(0, tr.dir > 0 ? sh.ss - tr.head : tr.head - sh.ss, tr.dir > 0 ? tr.tail - sh.ss : sh.ss - tr.tail);
          pump = Math.max(pump, 18 * Math.max(0, 1 - d / 90));
        }
        wy += pump;
        wx *= 0.4; wz *= 0.4;
      }
      out.x = wx; out.y = wy; out.z = wz;
      return out;
    }

    const H = city.canopy(x, z, 14);
    const streetLevel = (H > 6 && y < H * 0.88) || (H <= 6 && y < 14);
    out.lane = streetLevel ? "street" : "roof";

    // ---------------------------------------------------------------- rooftops (and above)
    const above = Math.max(0, y - H);
    const gust = 1 + 0.45 * noise3(x / 90, y / 60, z / 90 - t * 0.25, 3) + 0.5 * Math.max(0, Math.sin(t * 0.52 + x * 0.004)) ** 6;
    const roofSpeed = (AIR.roof + Math.min(8, above * AIR.roofGrowth)) * gust;
    const veer = 0.35 * noise3(x / 400, 0, z / 400 + t / 90, 9);
    const c = Math.cos(veer), s = Math.sin(veer);
    let rx = (NW.x * c - NW.z * s) * roofSpeed, rz = (NW.x * s + NW.z * c) * roofSpeed;
    let ry = 1.2 * noise3(x / 30, y / 20, z / 30 + t * 0.6, 11);
    // thermals over dark roofs and lift where the wind hits a wall
    if (!streetLevel || y > 6) {
      for (const b of city.bgrid.around(x, z, 10, this.bl)) {
        if (b.h < 8) continue;
        const inside = x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && inPoly(b.poly, x, z);
        if (inside && y > b.h && y < b.h + 45 && (b.seed % 5) === 0) ry += 3.2 * (1 - (y - b.h) / 45); // thermal
        if (!inside && y > b.h * 0.4 && y < b.h + 14) {
          const e = nearestEdge(b.poly, x, z);
          tmpE.d = e.d;
          if (e.d < 9) {
            // windward face (its outward normal points into the wind): the air rides up the wall
            const into = -(e.nx * NW.x + e.nz * NW.z);
            if (into > 0.2) ry += roofSpeed * 0.75 * into * (1 - e.d / 9) * smoothstep(b.h * 0.4, b.h * 0.8, y);
            // leeward: a curl of downdraught off the roof edge
            else if (into < -0.3 && y > b.h - 4) ry -= roofSpeed * 0.35 * -into * (1 - e.d / 9);
          }
        }
      }
    }
    if (!streetLevel) { wx = rx; wy = ry; wz = rz; }

    // ---------------------------------------------------------------- street level
    if (streetLevel || y < H + 4) {
      let sx = 0, sy = 0, sz = 0;
      const a = this.s1, b = this.s2;
      city.streets2(x, z, a, b);
      const streetDir = (h: typeof a, tWeight: number) => {
        if (!isFinite(h.dist)) return;
        const align = h.tx * rt.tx + h.tz * rt.tz;
        let sign: number, speed: number;
        if (Math.abs(align) > 0.55) {
          sign = Math.sign(align); // route-aligned: always a tailwind uptown
          speed = AIR.avenue * clamp(22 / Math.max(6, h.w), 0.85, 1.4);
          // like a river current, the canyon keeps you in its middle
          const p = city.raw.streets[h.idx].p;
          let best = Infinity, cx = 0, cz = 0;
          for (let k = 0; k < p.length - 2; k += 2) {
            const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L2 = dx * dx + dz * dz || 1e-9;
            const tt = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), px = ax + dx * tt, pz = az + dz * tt;
            const dd = (px - x) ** 2 + (pz - z) ** 2;
            if (dd < best) { best = dd; cx = px - x; cz = pz - z; }
          }
          sx += cx * AIR.channel * tWeight * 2;
          sz += cz * AIR.channel * tWeight * 2;
        } else {
          // cross streets gust across in their traffic direction, in pulses
          sign = h.d !== 0 ? h.d : (h.idx % 2 ? 1 : -1);
          const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.7 + h.idx * 1.37)) ** 2;
          speed = AIR.cross * pulse * 1.4;
          // and a steady drift uptown underneath, so a side street is never dead calm
          sx += rt.tx * 3.2 * tWeight; sz += rt.tz * 3.2 * tWeight;
        }
        sx += h.tx * sign * speed * tWeight;
        sz += h.tz * sign * speed * tWeight;
      };
      // blend the two nearest streets through intersections
      const da = a.dist, db = b.dist;
      const wa = isFinite(db) ? clamp((db - da) / 8 + 0.5, 0.5, 1) : 1;
      streetDir(a, wa);
      if (wa < 1) streetDir(b, 1 - wa);
      const inCanyon = a.dist < a.w / 2 + 6;
      // courtyards, lots and squares: sheltered, but never dead calm - a breeze always runs uptown
      if (!inCanyon) { sx = sx * 0.3 + rt.tx * 5; sz = sz * 0.3 + rt.tz * 5; }
      sx += 1.6 * noise3(x / 20, y / 10, z / 20 + t * 0.7, 21);
      sz += 1.6 * noise3(x / 20, y / 10, z / 20 + t * 0.7, 22);
      // the canyons breathe upward (warm streets, sunlit walls): enough to hold height if you
      // fly well, thinning right above the tarmac where the traffic is
      sy = AIR.canyonLift * smoothstep(0.5, 3.5, y) + 1.2 * noise3(x / 14, y / 9, z / 14 + t * 0.9, 23);
      const ground = 0.6 + 0.4 * smoothstep(0, 4, y);
      sx *= ground; sz *= ground;
      // open ground (parks, squares, building sites): a softer breeze along the route
      if (H <= 6) { sx = rt.tx * 6 + sx * 0.3; sz = rt.tz * 6 + sz * 0.3; }
      // steam manholes: the street's elevators
      for (const st of this.life.steamGrid.at(x, z)) {
        const dy = y;
        if (dy > st.height) continue;
        const rad = 1.3 + dy * 0.12;
        const r2 = ((x - st.x) ** 2 + (z - st.z) ** 2) / (rad * rad);
        if (r2 > 1) continue;
        const puff = 0.55 + 0.45 * Math.max(0, Math.sin(((t + st.phase) / st.period) * 6.283));
        sy += st.speed * puff * (1 - r2) * (1 - 0.5 * dy / st.height);
        sx *= 0.5; sz *= 0.5;
      }
      // subway stairs draw you in when you're close: dive for it
      for (const sh of this.under.shaftGrid.at(x, z)) {
        if (sh.kind !== "stairs" || y > 4.5) continue;
        const d = Math.hypot(x - sh.x, z - sh.z);
        if (d > 5.5) continue;
        const k = 1 - d / 5.5;
        sy -= 3 * k;
        sx += ((sh.x - x) / (d + 0.2)) * 2.5 * k;
        sz += ((sh.z - z) / (d + 0.2)) * 2.5 * k;
      }
      // open manholes suck you down
      for (const m of this.life.holeGrid.at(x, z)) {
        const d = Math.hypot(x - m.x, z - m.z);
        if (d < 3.5 && y < 3) { sy -= 3 * (1 - d / 3.5); sx += ((m.x - x) / (d + 0.1)) * 1.5; sz += ((m.z - z) / (d + 0.1)) * 1.5; }
      }
      // slipstreams behind traffic
      if (y < 7) {
        const w = this.traffic.wake(x, y, z, this.wk as never);
        sx += w.x; sy += w.y; sz += w.z;
        if (w.hit) out.vehicle = true;
      }
      // blend from street air into roof air near the roofline
      const k = streetLevel ? (H > 6 ? smoothstep(H * 0.6, H * 0.88, y) * 0.5 : smoothstep(8, 14, y)) : 1;
      wx = sx * (1 - k) + rx * k;
      wy = sy * (1 - k) + ry * k;
      wz = sz * (1 - k) + rz * k;
    }

    // ---------------------------------------------------------------- walls: air can't blow through them
    // Near a wall the part of the wind blowing into it turns along the wall and up it, so a leaf
    // is never pinned against a building, and windward faces give lift.
    {
      let best = 6, nx = 0, nz = 0;
      for (const b of city.bgrid.around(x, z, 6, this.bl)) {
        if (y > b.h + 1 || x < b.x0 - 6 || x > b.x1 + 6 || z < b.z0 - 6 || z > b.z1 + 6) continue;
        const e = nearestEdge(b.poly, x, z);
        if (e.d < best && !inPoly(b.poly, x, z)) { best = e.d; nx = e.nx; nz = e.nz; }
      }
      if (best < 6) {
        const into = -(wx * nx + wz * nz);
        if (into > 0) {
          const k = 1 - best / 6;
          wx += nx * into * k; wz += nz * into * k;
          wy += into * k * 0.7;
        }
      }
    }

    // ---------------------------------------------------------------- the edges of the corridor
    if (n.d > AIR.corridor) {
      const back = Math.min(1, (n.d - AIR.corridor) / 60) * 12;
      const nx = (rt.x - x) / n.d, nz = (rt.z - z) / n.d;
      wx += nx * back; wz += nz * back;
    }
    if (y > 320) wy -= (y - 320) * 0.15;

    out.x = wx; out.y = wy; out.z = wz;
    return out;
  }
}
