// Generates the whole city from spec.ts. Pure data, no three.js: the renderer,
// the flight sim, the headless test bot and the s&box exporter all read this.

import { Rng, hash01, clamp } from "../core/rng";
import { AVENUES, DISTRICTS, LANDMARKS, WORLD, districtAt, type DistrictSpec } from "./spec";

export interface Box {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
}

export type BuildingKind = "tenement" | "office" | "tower" | "needle" | "landmark";

export interface Building extends Box {
  id: number;
  kind: BuildingKind;
  district: string;
  color: string;
  roof: string;
  trim: string;
  floor: number;
  lit: number;
  /** 0 = plain, 1 = brick grid, 2 = glass curtain wall. */
  facade: number;
  seed: number;
}

export interface Prop {
  kind: "ac" | "waterTower" | "fireEscape" | "lantern" | "neon" | "billboard" | "streetLight" | "tree" | "vent" | "grate" | "stairs";
  x: number; y: number; z: number;
  /** Facing direction for wall-mounted things (unit vector in xz). */
  nx?: number; nz?: number;
  w?: number; h?: number; d?: number;
  color?: string;
  seed: number;
}

export type WindSource =
  | { kind: "jet"; x: number; y: number; z: number; dx: number; dy: number; dz: number; radius: number; length: number; speed: number }
  | { kind: "plume"; x: number; y: number; z: number; radius: number; height: number; speed: number; period: number; phase: number; train?: boolean }
  | { kind: "thermal"; x: number; y: number; z: number; radius: number; height: number; speed: number };

export interface Road {
  axis: "x" | "z"; // "z" = runs north-south (avenue/alley), "x" = runs east-west (street)
  c: number;       // centre line coordinate (x for N-S roads, z for E-W)
  half: number;    // half width
  from: number;
  to: number;
  flow: number;    // +1/-1 canyon wind direction along the road
  name: string;
  kind: "avenue" | "alley" | "street";
}

export interface Opening {
  /** A hole in the street that drops into the subway: stairs or a grate. */
  x0: number; x1: number; z0: number; z1: number;
  kind: "stairs" | "grate";
}

export interface City {
  buildings: Building[];
  props: Prop[];
  wind: WindSource[];
  roads: Road[];
  openings: Opening[];
  parks: Box[];
  /** Every city block including its pavement, for the ground mesh. */
  blocks: (Box & { park: boolean })[];
  index: SpatialIndex;
}

// ---------------------------------------------------------------- spatial index

export class SpatialIndex {
  readonly cell = 40;
  private boxes = new Map<number, number[]>();
  private winds = new Map<number, number[]>();
  constructor(private city: { buildings: Box[]; wind: WindSource[] }) {
    city.buildings.forEach((b, i) => this.add(this.boxes, b.x0, b.z0, b.x1, b.z1, i));
    city.wind.forEach((w, i) => {
      const r = w.kind === "jet" ? w.length + w.radius : w.radius;
      this.add(this.winds, w.x - r, w.z - r, w.x + r, w.z + r, i);
    });
  }
  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  private add(m: Map<number, number[]>, x0: number, z0: number, x1: number, z1: number, i: number) {
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
      for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
        const k = this.key(ix, iz);
        let l = m.get(k);
        if (!l) m.set(k, (l = []));
        l.push(i);
      }
  }
  boxesNear(x: number, z: number): number[] {
    return this.boxes.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? EMPTY;
  }
  windsNear(x: number, z: number): number[] {
    return this.winds.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? EMPTY;
  }
  get buildings() {
    return this.city.buildings;
  }
}
const EMPTY: number[] = [];

// ---------------------------------------------------------------- generation

function inPark(x: number, z: number) {
  const p = LANDMARKS.columbusPark;
  if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return true;
  const [px0, px1] = LANDMARKS.parkX;
  return z > DISTRICTS[3].z0 && x > px0 - 15 && x < px1 + 15;
}

function inTimesSquare(x: number, z: number) {
  const t = LANDMARKS.timesSquare;
  return x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1;
}

function makeStreets(): Road[] {
  const roads: Road[] = [];
  // E-W streets, district by district. Real Manhattan: even streets run east, odd run west.
  let n = 0;
  for (const d of DISTRICTS) {
    if (d.park) continue;
    const rng = new Rng(WORLD.seed ^ (d.z0 * 7919));
    let z = d.z0 + rng.range(d.street.spacing[0], d.street.spacing[1]) * 0.5;
    while (z < d.z1 - d.street.spacing[0] * 0.4) {
      roads.push({ axis: "x", c: z, half: d.street.width / 2, from: WORLD.xMin, to: WORLD.xMax, flow: n % 2 === 0 ? 1 : -1, name: `${n + 1}th St`, kind: "street" });
      n++;
      z += rng.range(d.street.spacing[0], d.street.spacing[1]);
    }
  }
  // Central Park South: the edge street where the towers stop.
  roads.push({ axis: "x", c: DISTRICTS[3].z0 - 6, half: 12, from: WORLD.xMin, to: WORLD.xMax, flow: 1, name: "Central Park South", kind: "street" });
  for (const a of AVENUES)
    roads.push({ axis: "z", c: a.x, half: a.width / 2, from: WORLD.zMin, to: WORLD.zMax, flow: a.flow, name: a.name, kind: "avenue" });
  // Alleys: narrow N-S lanes inside districts that have them.
  for (const d of DISTRICTS) {
    if (!d.alleys) continue;
    for (let i = 0; i < AVENUES.length - 1; i++) {
      const a = AVENUES[i], b = AVENUES[i + 1];
      for (let k = 1; k <= d.alleys; k++) {
        const t = k / (d.alleys + 1) + (hash01(i, k, d.z0) - 0.5) * 0.12;
        roads.push({ axis: "z", c: a.x + (b.x - a.x) * t, half: d.alleyWidth / 2, from: d.z0, to: d.z1, flow: hash01(i, k, 3) < 0.6 ? 1 : -1, name: `${d.name} lane`, kind: "alley" });
      }
    }
  }
  return roads;
}

/** Splits [a, b] by the roads crossing it, returning the solid spans between them. */
function spans(a: number, b: number, cuts: { c: number; half: number }[]): [number, number][] {
  const s = cuts.filter((r) => r.c + r.half > a && r.c - r.half < b).sort((p, q) => p.c - q.c);
  const out: [number, number][] = [];
  let cur = a;
  for (const r of s) {
    if (r.c - r.half > cur) out.push([cur, r.c - r.half]);
    cur = Math.max(cur, r.c + r.half);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

export function generateCity(): City {
  const roads = makeStreets();
  const buildings: Building[] = [];
  const props: Prop[] = [];
  const wind: WindSource[] = [];
  const openings: Opening[] = [];
  const parks: Box[] = [];
  const blocks: (Box & { park: boolean })[] = [];

  const nsRoads = roads.filter((r) => r.axis === "z");
  const ewRoads = roads.filter((r) => r.axis === "x");
  const sidewalk = 2.5;

  // Blocks are the rectangles between roads; each district fills its own blocks.
  for (const d of DISTRICTS) {
    const zSpans = spans(d.z0, d.z1, ewRoads.filter((r) => r.c > d.z0 - 20 && r.c < d.z1 + 20));
    for (const [bz0, bz1] of zSpans) {
      const xSpans = spans(WORLD.xMin, WORLD.xMax, nsRoads.filter((r) => r.from <= bz1 && r.to >= bz0));
      for (const [bx0, bx1] of xSpans) {
        blocks.push({ x0: bx0, x1: bx1, y0: 0, y1: 0.15, z0: bz0, z1: bz1, park: inPark((bx0 + bx1) / 2, (bz0 + bz1) / 2) });
        fillBlock(d, bx0 + sidewalk, bx1 - sidewalk, bz0 + sidewalk, bz1 - sidewalk);
      }
    }
  }

  function addBuilding(d: DistrictSpec, b: Box, rng: Rng, kind: BuildingKind, facade?: number) {
    const id = buildings.length;
    const color = rng.pick(d.walls);
    buildings.push({
      ...b, id, kind, district: d.id, color, roof: d.roof, trim: d.trim, floor: d.floor, lit: d.lit,
      facade: facade ?? (kind === "tower" || kind === "needle" ? 2 : kind === "tenement" ? 1 : rng.chance(0.5) ? 2 : 1),
      seed: rng.int(0, 1e9),
    });
    return buildings[id];
  }

  function fillBlock(d: DistrictSpec, x0: number, x1: number, z0: number, z1: number) {
    if (x1 - x0 < 6 || z1 - z0 < 6) return;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const rng = new Rng(WORLD.seed ^ Math.floor(cx * 31 + cz * 977));

    // Parks: Columbus Park and Central Park have trees, not buildings.
    if (inPark(cx, cz)) {
      parks.push({ x0, x1, y0: 0, y1: 0.3, z0, z1 });
      const n = Math.floor(((x1 - x0) * (z1 - z0)) / 260);
      for (let i = 0; i < n; i++) {
        const x = rng.range(x0 + 3, x1 - 3), z = rng.range(z0 + 3, z1 - 3);
        const g = WORLD.goal, p = WORLD.pond;
        if (Math.hypot(x - g.x, z - g.z) < g.radius + 30) continue;
        if (x > p.x0 - 6 && x < p.x1 + 6 && z > p.z0 - 6 && z < p.z1 + 6) continue;
        if (rng.chance(0.55)) continue;
        props.push({ kind: "tree", x, y: 0, z, h: rng.range(9, 19), w: rng.range(4, 8), seed: rng.int(0, 1e9) });
      }
      return;
    }

    // Billionaires' Row: a few needle towers, then a gap for the wind.
    const br = LANDMARKS.billionairesRow;
    if (cz > br.z0 - 60 && cz < br.z1 + 10 && d.id !== "park") {
      let x = x0;
      while (x < x1 - 14) {
        const w = rng.range(18, 30);
        if (rng.chance(0.75)) {
          const h = rng.range(220, 430);
          const b = addBuilding(d, { x0: x, x1: Math.min(x1, x + w), y0: 0, y1: h, z0: z1 - rng.range(22, 30), z1 }, rng, "needle", 2);
          b.color = rng.pick(["#2e3440", "#3b4252", "#c9c2b6", "#1f2833"]);
          b.lit = 0.25;
        }
        x += w + rng.range(4, 18);
      }
      // the rest of the block: ordinary midtown
      perimeter(d, x0, x1, z0, z1 - 32, rng);
      return;
    }

    // The Spire: one invented supertall with setbacks, the city's compass.
    const sp = LANDMARKS.spire;
    if (Math.abs(cx - sp.x) < (x1 - x0) / 2 && Math.abs(cz - sp.z) < (z1 - z0) / 2) {
      const tiers = [1, 0.8, 0.62, 0.45, 0.28];
      let y = 0;
      tiers.forEach((t, i) => {
        const h = sp.h * (i === 0 ? 0.32 : i === tiers.length - 1 ? 0.2 : 0.16);
        const w = sp.w * t, dd = sp.d * t;
        const b = addBuilding(d, { x0: sp.x - w / 2, x1: sp.x + w / 2, y0: y, y1: y + h, z0: sp.z - dd / 2, z1: sp.z + dd / 2 }, rng, "landmark", 1);
        b.color = "#b9ab95";
        b.lit = 0.55;
        y += h;
      });
      buildings.push({ x0: sp.x - 1, x1: sp.x + 1, y0: y, y1: y + 60, z0: sp.z - 1, z1: sp.z + 1, id: buildings.length, kind: "landmark", district: d.id, color: "#d8d2c6", roof: "#d8d2c6", trim: "#ffffff", floor: 99, lit: 0, facade: 0, seed: 1 });
      // fill the rest of the block lower
      perimeter(d, x0, x1, z0, sp.z - sp.d / 2 - 6, rng);
      perimeter(d, x0, x1, sp.z + sp.d / 2 + 6, z1, rng);
      return;
    }

    perimeter(d, x0, x1, z0, z1, rng);
  }

  /** Buildings around the edge of a block with a courtyard in the middle (how Manhattan blocks really work). */
  function perimeter(d: DistrictSpec, x0: number, x1: number, z0: number, z1: number, rng: Rng) {
    if (x1 - x0 < 6 || z1 - z0 < 6) return;
    const depth = rng.range(d.depth[0], d.depth[1]);
    const ts = inTimesSquare((x0 + x1) / 2, (z0 + z1) / 2);
    const deep = (x1 - x0 < depth * 2.2) || (z1 - z0 < depth * 2.2);
    // Long sides face the streets (north and south faces), short ends face the avenues.
    const rows: { a: number; b: number; fixed0: number; fixed1: number; along: "x" | "z"; face: [number, number] }[] = [];
    if (deep) {
      rows.push({ a: x0, b: x1, fixed0: z0, fixed1: z1, along: "x", face: [0, -1] });
    } else {
      rows.push({ a: x0, b: x1, fixed0: z0, fixed1: z0 + depth, along: "x", face: [0, -1] });
      rows.push({ a: x0, b: x1, fixed0: z1 - depth, fixed1: z1, along: "x", face: [0, 1] });
      rows.push({ a: z0 + depth, b: z1 - depth, fixed0: x0, fixed1: x0 + depth, along: "z", face: [-1, 0] });
      rows.push({ a: z0 + depth, b: z1 - depth, fixed0: x1 - depth, fixed1: x1, along: "z", face: [1, 0] });
    }
    for (const row of rows) {
      let p = row.a;
      while (p < row.b - 4) {
        let w = rng.range(d.lot[0], d.lot[1]);
        if (row.b - (p + w) < d.lot[0] * 0.7) w = row.b - p;
        const tall = rng.chance(d.height.tallChance);
        let h = tall ? rng.range(d.height.max, d.height.tallMax) : rng.range(d.height.min, d.height.max);
        if (d.id === "chinatown") h = Math.round(h / d.floor) * d.floor;
        if (ts) h = Math.max(h, rng.range(60, 140));
        const box: Box = row.along === "x"
          ? { x0: p, x1: p + w, y0: 0, y1: h, z0: row.fixed0, z1: row.fixed1 }
          : { x0: row.fixed0, x1: row.fixed1, y0: 0, y1: h, z0: p, z1: p + w };
        const kind: BuildingKind = d.id === "chinatown" ? "tenement" : tall ? "tower" : "office";
        const b = addBuilding(d, box, rng, kind);
        decorate(d, b, row.face, rng, ts);
        // Setback crown on tall towers.
        if (tall && h > 120 && w > 18) {
          const inset = Math.min(w, row.fixed1 - row.fixed0) * 0.18;
          const h2 = h * rng.range(0.12, 0.3);
          const c = addBuilding(d, { x0: box.x0 + inset, x1: box.x1 - inset, y0: h, y1: h + h2, z0: box.z0 + inset, z1: box.z1 - inset }, rng, kind, b.facade);
          c.color = b.color;
          if (rng.chance(d.props.thermal * 3)) wind.push({ kind: "thermal", x: (c.x0 + c.x1) / 2, y: c.y1, z: (c.z0 + c.z1) / 2, radius: rng.range(14, 22), height: 90, speed: rng.range(4, 7) });
        }
        p += w;
      }
    }
  }

  function decorate(d: DistrictSpec, b: Building, face: [number, number], rng: Rng, timesSquare: boolean) {
    const [fx, fz] = face;
    const w = fx !== 0 ? b.z1 - b.z0 : b.x1 - b.x0;
    const facePos = (t: number, y: number, out = 0.3): [number, number, number] => {
      if (fx !== 0) return [fx > 0 ? b.x1 + out : b.x0 - out, y, b.z0 + (b.z1 - b.z0) * t];
      return [b.x0 + (b.x1 - b.x0) * t, y, fz > 0 ? b.z1 + out : b.z0 - out];
    };
    const h = b.y1;
    // AC units: little boxes on the facade, and each one is a wind jet.
    if (rng.chance(d.props.ac)) {
      const n = Math.max(1, Math.floor((w / 6) * (h / 20) * 0.6 * rng.range(0.4, 1.2)));
      for (let i = 0; i < Math.min(n, 12); i++) {
        const fl = rng.int(1, Math.max(1, Math.floor(h / d.floor) - 2));
        const [x, y, z] = facePos(rng.range(0.12, 0.88), fl * d.floor + 1.1, 0.45);
        props.push({ kind: "ac", x, y, z, nx: fx, nz: fz, seed: rng.int(0, 1e9) });
        if (rng.chance(0.35)) wind.push({ kind: "jet", x, y, z, dx: fx, dy: 0.15, dz: fz, radius: 1.6, length: 9, speed: rng.range(5, 9) });
      }
    }
    if (rng.chance(d.props.fireEscape) && h < 60) {
      const [x, y, z] = facePos(rng.range(0.3, 0.7), d.floor, 0.9);
      props.push({ kind: "fireEscape", x, y, z, nx: fx, nz: fz, w: Math.min(6, w * 0.5), h: h - d.floor * 1.5, seed: rng.int(0, 1e9) });
    }
    if (rng.chance(d.props.waterTower) && h < 140) {
      props.push({ kind: "waterTower", x: (b.x0 + b.x1) / 2 + rng.range(-2, 2), y: h, z: (b.z0 + b.z1) / 2 + rng.range(-2, 2), h: rng.range(6, 9), w: rng.range(2.4, 3.4), seed: rng.int(0, 1e9) });
    }
    if (rng.chance(d.props.thermal) && h < 120) {
      wind.push({ kind: "thermal", x: (b.x0 + b.x1) / 2, y: h, z: (b.z0 + b.z1) / 2, radius: Math.min(b.x1 - b.x0, b.z1 - b.z0) * 0.5 + 6, height: 70, speed: rng.range(3, 6) });
    }
    // Shop signs and neon.
    if (d.look.neon.length && rng.chance(timesSquare ? 1 : d.props.neon)) {
      const vertical = d.id === "chinatown" && rng.chance(0.6);
      const [x, y, z] = facePos(rng.range(0.2, 0.8), vertical ? rng.range(5, 9) : rng.range(3.4, 4.4), vertical ? 1.2 : 0.15);
      props.push({ kind: "neon", x, y, z, nx: fx, nz: fz, w: vertical ? 1.1 : rng.range(3, Math.min(9, w * 0.8)), h: vertical ? rng.range(3, 6) : rng.range(0.8, 1.4), color: rng.pick(d.look.neon), seed: rng.int(0, 1e9) });
    }
    if (timesSquare && h > 30) {
      for (let i = 0; i < 2; i++) {
        const bw = Math.min(w * 0.85, rng.range(12, 26));
        const [x, y, z] = facePos(rng.range(0.3, 0.7), rng.range(12, Math.min(h - 10, 60)), 0.4);
        props.push({ kind: "billboard", x, y, z, nx: fx, nz: fz, w: bw, h: bw * rng.range(0.4, 0.7), color: rng.pick(d.look.neon), seed: rng.int(0, 1e9) });
      }
    }
  }

  // ------------------------------------------------ street furniture, steam, lanterns, the subway
  for (const r of ewRoads) {
    const d = districtAt(r.c);
    const rng = new Rng(WORLD.seed ^ Math.floor(r.c * 131));
    // Lanterns strung across Chinatown streets.
    if (d.props.lanterns > 0) {
      for (let x = WORLD.xMin + 20; x < WORLD.xMax - 20; x += rng.range(10, 26)) {
        if (nsRoads.some((a) => Math.abs(a.c - x) < a.half + 2)) continue;
        if (!rng.chance(0.55)) continue;
        const y = rng.range(7, 11);
        props.push({ kind: "lantern", x, y, z: r.c, w: r.half * 2 + 4, color: rng.pick(["#ff3b2f", "#ff5a1f", "#ffcf3b"]), seed: rng.int(0, 1e9) });
      }
    }
    // Steam vents in the road: the classic New York manhole plume.
    for (let x = WORLD.xMin + 30; x < WORLD.xMax - 30; x += rng.range(40, 110)) {
      if (!rng.chance(0.35 * d.props.steam)) continue;
      if (nsRoads.some((a) => Math.abs(a.c - x) < a.half + 1)) continue;
      const z = r.c + rng.range(-r.half * 0.5, r.half * 0.5);
      props.push({ kind: "vent", x, y: 0, z, seed: rng.int(0, 1e9) });
      wind.push({ kind: "plume", x, y: 0, z, radius: 2.4, height: rng.range(16, 34), speed: rng.range(6, 10), period: rng.range(5, 9), phase: rng.range(0, 10) });
    }
  }
  for (const r of nsRoads) {
    const rng = new Rng(WORLD.seed ^ Math.floor(r.c * 733 + 17));
    for (let z = WORLD.zMin + 20; z < WORLD.zMax; z += rng.range(70, 140)) {
      const d = districtAt(z);
      if (d.park && Math.abs(r.c) < 470) continue;
      if (r.kind === "avenue" && rng.chance(0.4 * d.props.steam)) {
        const x = r.c + rng.range(-r.half * 0.5, r.half * 0.5);
        if (Math.abs(r.c - WORLD.subway.x) < 1 && Math.abs(x - r.c) < WORLD.subway.halfWidth + 2) continue;
        props.push({ kind: "vent", x, y: 0, z, seed: rng.int(0, 1e9) });
        wind.push({ kind: "plume", x, y: 0, z, radius: 2.6, height: rng.range(20, 40), speed: rng.range(7, 11), period: rng.range(4, 8), phase: rng.range(0, 10) });
      }
    }
    if (r.kind === "avenue") {
      for (let z = WORLD.zMin + 10; z < WORLD.zMax; z += 32) {
        const d = districtAt(z);
        if (d.park && Math.abs(r.c) < 470) continue;
        for (const s of [-1, 1]) props.push({ kind: "streetLight", x: r.c + s * (r.half + 0.8), y: 0, z: z + (s > 0 ? 16 : 0), nx: -s, nz: 0, seed: 0 });
      }
    }
  }

  // The subway under Broadway: stairs every few blocks, grates between, and the
  // trains push a wall of air up through the grates as they pass.
  {
    const sw = WORLD.subway;
    let i = 0;
    for (const r of ewRoads) {
      if (districtAt(r.c).park) continue;
      i++;
      const z = r.c + r.half + 6;
      if (i % sw.openingEvery === 0) {
        openings.push({ kind: "stairs", x0: sw.x + 7, x1: sw.x + 11, z0: z, z1: z + 6 });
        openings.push({ kind: "stairs", x0: sw.x - 11, x1: sw.x - 7, z0: z, z1: z + 6 });
        props.push({ kind: "stairs", x: sw.x + 9, y: 0, z: z + 3, seed: i });
        props.push({ kind: "stairs", x: sw.x - 9, y: 0, z: z + 3, seed: i + 1 });
      }
      // grates in the avenue's median, straight above the tunnel
      const gz = r.c + 30;
      openings.push({ kind: "grate", x0: sw.x - 2, x1: sw.x + 2, z0: gz, z1: gz + 5 });
      props.push({ kind: "grate", x: sw.x, y: 0, z: gz + 2.5, w: 4, d: 5, seed: i });
      wind.push({ kind: "plume", x: sw.x, y: sw.ceiling, z: gz + 2.5, radius: 3.2, height: 24, speed: 13, period: 0, phase: 0, train: true });
    }
  }

  const city = { buildings, props, wind, roads, openings, parks, blocks, index: undefined as unknown as SpatialIndex };
  city.index = new SpatialIndex(city);
  return city;
}

// ---------------------------------------------------------------- queries

/** The road a point is on (or null if inside a block). */
export function roadAt(city: City, x: number, z: number): Road | null {
  let best: Road | null = null;
  let bestHalf = Infinity;
  for (const r of city.roads) {
    const along = r.axis === "z" ? z : x;
    const across = r.axis === "z" ? x : z;
    if (along < r.from || along > r.to) continue;
    if (Math.abs(across - r.c) <= r.half + 2.5 && r.half < bestHalf) {
      best = r;
      bestHalf = r.half;
    }
  }
  return best;
}

/** Height of the roofs around a point, sampled from the nearest buildings (for wind shading). */
export function canopyHeight(city: City, x: number, z: number): number {
  let h = 0;
  for (const i of city.index.boxesNear(x, z)) {
    const b = city.buildings[i];
    const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
    const dist = Math.hypot(dx, dz);
    if (dist < 25) h = Math.max(h, b.y1 * clamp(1 - dist / 25, 0, 1));
  }
  return h;
}

export function insideBox(b: Box, x: number, y: number, z: number, pad = 0) {
  return x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad && z > b.z0 - pad && z < b.z1 + pad;
}
