// Converts the NYC Open Data downloads (data/nyc_*.json) into the game's city file
// (public/city.json): local metres, grid-aligned so +z is uptown, simplified, styled.
//
//   npx tsx tools/build-city.ts
//
// Data: NYC Open Data (OTI building footprints and planimetrics, DOT centerline,
// Parks street tree census, MTA via data.ny.gov). Free to use; credited in game.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ShapeUtils, Vector2 } from "three";

const DATA = path.resolve("data");
const OUT = path.resolve("public/city.json");
const read = (n: string) => JSON.parse(fs.readFileSync(path.join(DATA, n), "utf8"));
/** Loads nyc_X.json merged with nyc2_X.json (the second download area), without duplicates. */
const load = (n: string) => {
  const rows = read(n);
  const n2 = n.replace(/^nyc_/, "nyc2_");
  if (n2 === n || !fs.existsSync(path.join(DATA, n2))) return rows;
  const key = (r: any) => r.bin ?? JSON.stringify(r.the_geom ?? r.georeference ?? r.entrance_georeference ?? r);
  const seen = new Set(rows.map(key));
  for (const r of read(n2)) if (!seen.has(key(r))) { seen.add(key(r)); rows.push(r); }
  return rows;
};

// ------------------------------------------------------------------ projection
const ORIGIN = { lat: 40.7033, lon: -74.017 }; // the tree in Battery Park
const KY = 111132.954 - 559.822 * Math.cos(2 * rad(40.74)) + 1.175 * Math.cos(4 * rad(40.74));
const KX = 111412.84 * Math.cos(rad(40.74)) - 93.5 * Math.cos(3 * rad(40.74));
/** The Manhattan grid runs about 29 degrees east of true north. Rotate so avenues run along +z. */
const GRID = rad(28.9);
function rad(d: number) { return (d * Math.PI) / 180; }

type P = [number, number]; // [x, z]
function proj(lon: number, lat: number): P {
  const e = (lon - ORIGIN.lon) * KX, n = (lat - ORIGIN.lat) * KY;
  const c = Math.cos(GRID), s = Math.sin(GRID);
  // three.js is right-handed with y up: with +z uptown (north-ish), east must be -x
  return [-(e * c - n * s), e * s + n * c];
}
const r1 = (v: number) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ geometry helpers
function area(r: P[]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}
function dpSimplify(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bd = eps;
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** Clean a closed ring: project, drop the closing duplicate, simplify, wind CCW for outers. */
function ring(coords: number[][], eps = 0.25, outer = true): P[] | null {
  let r = coords.map(([lon, lat]) => proj(lon, lat));
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  // simplify as two open paths split at the point furthest from the first (a closed
  // path's ends coincide, which Douglas-Peucker can't measure against)
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
  const a1 = dpSimplify(r.slice(0, far + 1), eps), a2 = dpSimplify([...r.slice(far), r[0]], eps);
  r = [...a1, ...a2.slice(1, -1)];
  if (r.length < 3) return null;
  const a = area(r);
  if (Math.abs(a) < 1) return null;
  if ((a > 0) !== outer) r.reverse();
  return r;
}
function ringAreaFlat(r: number[]) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] + r[i]) * (r[j + 1] - r[i + 1]);
  return a / 2;
}
export function inRingP(r: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const flat = (r: P[]) => r.flatMap(([x, z]) => [r1(x), r1(z)]);
/** MultiPolygon -> list of [outer, ...holes] (each flattened). */
function polys(geom: any, eps = 0.25, minArea = 2): number[][][] {
  const out: number[][][] = [];
  const list = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of list) {
    const o = ring(poly[0], eps, true);
    if (!o || Math.abs(area(o)) < minArea) continue;
    const holes = poly.slice(1).map((h: number[][]) => ring(h, eps, false)).filter((h: P[] | null): h is P[] => !!h && Math.abs(area(h)) > 1);
    out.push([flat(o), ...holes.map(flat)]);
  }
  return out;
}
function lines(geom: any): P[][] {
  const list = geom.type === "LineString" ? [geom.coordinates] : geom.coordinates;
  return list.map((l: number[][]) => l.map(([lon, lat]) => proj(lon, lat)));
}

// ------------------------------------------------------------------ the route up Broadway
const GUIDE: [number, number][] = [
  [40.7033, -74.017], [40.7047, -74.014], [40.7075, -74.0113], [40.7105, -74.009], [40.7127, -74.006],
  [40.716, -74.0036], [40.7192, -74.0013], [40.7253, -73.9966], [40.731, -73.9925], [40.7357, -73.9907],
  [40.7414, -73.9897], [40.7497, -73.9878], [40.758, -73.9855], [40.7681, -73.9819], [40.7718, -73.975],
];
const guide = GUIDE.map(([lat, lon]) => proj(lon, lat));
const guideS: number[] = [0];
for (let i = 1; i < guide.length; i++) guideS.push(guideS[i - 1] + Math.hypot(guide[i][0] - guide[i - 1][0], guide[i][1] - guide[i - 1][1]));
function onGuide(p: P): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < guide.length - 1; i++) {
    const [ax, az] = guide[i], [bx, bz] = guide[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2));
    const d = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]);
    if (d < best.d) best = { s: guideS[i] + t * Math.sqrt(L2), d };
  }
  return best;
}

const centerline = load("nyc_centerline.json");
// Broadway vertices, ordered along the guide
const bway: { s: number; p: P }[] = [];
for (const c of centerline) {
  if (!/^BROADWAY$/.test(c.full_street_name ?? "")) continue;
  for (const l of lines(c.the_geom)) for (const p of l) {
    const g = onGuide(p);
    if (g.d < 70) bway.push({ s: g.s, p });
  }
}
const LL = (lat: number, lon: number) => proj(lon, lat);
const gs = (lat: number, lon: number) => onGuide(LL(lat, lon)).s;
const bwayBetween = (sa: number, sb: number) => bway.filter((b) => b.s > sa && b.s < sb).sort((a, b) => a.s - b.s).map((b) => b.p);
function resample(p: P[], step: number): P[] {
  const out: P[] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i];
    const L = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= L) { out.push([ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L]); t += step; }
    carry = (carry + L) % step;
  }
  return out;
}
function smooth(line: P[], passes: number, w = 2): P[] {
  let r = line;
  for (let pass = 0; pass < passes; pass++) {
    r = r.map((p, i) => {
      if (i < w || i > r.length - 1 - w) return p;
      let x = 0, z = 0;
      for (let k = -w; k <= w; k++) { x += r[i + k][0]; z += r[i + k][1]; }
      return [x / (2 * w + 1), z / (2 * w + 1)] as P;
    });
  }
  return resample(r, 4);
}

// The spine: Battery Park, up Broadway through the Financial District to City Hall, east
// through Columbus Park into Chinatown, up Mulberry Street through Little Italy, back onto
// Broadway at Bleecker and on up to Columbus Circle and the park.
const sBG = gs(40.7056, -74.0137), sCH = gs(40.7122, -74.0068), s8 = gs(40.7302, -73.9929), sCC = gs(40.7672, -73.9822);
const spinePts: P[] = [
  LL(40.7033, -74.017), LL(40.7041, -74.0156), LL(40.7052, -74.0141),
  ...bwayBetween(sBG + 40, sCH),
  LL(40.7133, -74.0045), LL(40.7146, -74.0016), LL(40.7157, -73.9999), LL(40.7168, -73.9989),
  LL(40.7182, -73.9982), LL(40.7198, -73.9973), LL(40.7216, -73.9963), LL(40.7233, -73.9953), LL(40.7252, -73.9944),
  LL(40.7272, -73.9937),
  ...bwayBetween(s8, sCC),
  LL(40.7681, -73.9819), LL(40.7697, -73.9795), LL(40.7712, -73.9768), LL(40.7718, -73.975),
];
let route = smooth(resample(spinePts, 4), 8);

// The subway lane: the Broadway line (4/5 under lower Broadway, then the R/W) from
// Bowling Green to Times Square, then up Seventh Avenue to 57 St, where it ends.
const subwayPts: P[] = [
  LL(40.7046, -74.0141), ...bwayBetween(sBG + 40, gs(40.7553, -73.9868)),
  LL(40.7562, -73.9864), LL(40.7599, -73.9841), LL(40.7646, -73.9807),
];
const subway = smooth(resample(subwayPts, 4), 8);
const routeS = route.map((_, i) => i * 4);
function nearest(line: P[], p: P): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2));
    const d = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]);
    if (d < best.d) best = { s: i * 4 + t * Math.sqrt(L2), d };
  }
  return best;
}
const sOf = (p: P) => nearest(route, p);
const sAt = (lat: number, lon: number) => Math.round(sOf(proj(lon, lat)).s);

// ------------------------------------------------------------------ districts (by route distance)
const DISTRICTS = [
  { id: "battery", name: "Battery Park", sub: "The last tree", s0: 0 },
  { id: "fidi", name: "Financial District", sub: "Broadway, Wall Street", s0: sAt(40.7049, -74.0137) },
  { id: "chinatown", name: "Chinatown", sub: "Columbus Park, Mulberry Street", s0: sAt(40.7130, -74.0052) },
  { id: "littleitaly", name: "Little Italy", sub: "SoHo off to the west", s0: sAt(40.7192, -73.9976) },
  { id: "village", name: "The Village", sub: "Broadway to Union Square", s0: sAt(40.7272, -73.9937) },
  { id: "flatiron", name: "Flatiron", sub: "Union Square, Madison Square", s0: sAt(40.7359, -73.9906) },
  { id: "midtown", name: "Midtown", sub: "Herald Square, Times Square", s0: sAt(40.7497, -73.9878) },
  { id: "columbus", name: "Columbus Circle", sub: "Billionaires' Row", s0: sAt(40.7615, -73.9838) },
  { id: "park", name: "Central Park", sub: "Plant the seed", s0: sAt(40.7680, -73.9817) },
];
const districtAtS = (s: number) => [...DISTRICTS].reverse().find((d) => s >= d.s0)!.id;

// ------------------------------------------------------------------ buildings
type Style = "tenement" | "castiron" | "prewar" | "deco" | "modern" | "glass" | "brick" | "civic";
function styleFor(year: number, h: number, footprint: number, district: string, seed: number): Style {
  const r = (seed % 1000) / 1000;
  if (!year || year < 1800) year = h > 90 ? 1965 : 1910;
  if (year < 1900 && (district === "littleitaly" || district === "chinatown" || district === "village") && h < 36 && footprint > 180) return r < 0.75 ? "castiron" : "tenement";
  if (year < 1925 && h < 32) return "tenement";
  if (year < 1925 && h > 120) return "deco";
  if (year < 1945) return h > 85 ? "deco" : "prewar";
  if (year < 1985) return h > 45 ? "modern" : "brick";
  if (h > 55) return "glass";
  return r < 0.5 ? "brick" : "modern";
}
const bout: any[] = [];
let seed = 1;
for (const b of load("nyc_buildings.json")) {
  if (!["2100", "5100", "1006", "1005"].includes(b.feature_code)) continue;
  const h = Number(b.height_roof ?? 0) * 0.3048;
  if (!(h > 2.5)) continue;
  for (const poly of polys(b.the_geom, 0.3, 6)) {
    const o = poly[0];
    let cx = 0, cz = 0;
    for (let i = 0; i < o.length; i += 2) { cx += o[i]; cz += o[i + 1]; }
    cx /= o.length / 2; cz /= o.length / 2;
    const s = sOf([cx, cz]);
    const fp = Math.abs(area(Array.from({ length: o.length / 2 }, (_, i) => [o[i * 2], o[i * 2 + 1]] as P)));
    const year = Number(b.construction_year ?? 0);
    const id = ++seed * 2654435761 >>> 0;
    const district = districtAtS(s.s);
    let style = styleFor(year, h, fp, district, id);
    if (["Battery Park", "City Hall"].some(() => false)) style = "civic";
    bout.push({ p: poly, h: r1(h), y: year, st: style, k: id % 100000, s: Math.round(s.s), d: Math.round(s.d) });
  }
}

// ------------------------------------------------------------------ skyline (tall towers outside the corridor)
const inCorridor = new Set(load("nyc_buildings.json").map((b: any) => b.bin));
const sky: any[] = [];
for (const b of load("nyc_skyline.json")) {
  if (inCorridor.has(b.bin)) continue;
  const h = Number(b.height_roof ?? 0) * 0.3048;
  for (const poly of polys(b.the_geom, 1.2, 40)) sky.push({ p: [poly[0]], h: r1(h), y: Number(b.construction_year ?? 0) });
}

// ------------------------------------------------------------------ ground: roads, sidewalks, medians, plazas, parks, land
const grab = (n: string, eps = 0.3, min = 3) => load(n).flatMap((r: any) => polys(r.the_geom, eps, min));
const roadbed = grab("nyc_roadbed.json");
const sidewalk = grab("nyc_sidewalk.json");
const median = grab("nyc_median.json");
const plaza = grab("nyc_plaza.json");
// A concrete jungle: the only green is the tree's park at the start and Central Park at the
// end. Every other park on the way becomes a building site (hoardings, dirt, cranes).
const GREEN = /^(Battery Park|Central Park|Sheep Meadow)$/;
const parkRows = load("nyc_parks.json").flatMap((r: any) => polys(r.the_geom, 0.6, 20).map((p) => ({ n: r.park_name as string, p })));
const parks = parkRows.filter((p: any) => GREEN.test(p.n));
// The open data only gives Central Park in fragments near the corridor. Add its real southern
// end (59th St to about 72nd, Fifth Ave to Central Park West) as one lawn, inset off the
// surrounding roads, so the finale is a park and not a car park. x is -east, +z is uptown.
{
  const sw = proj(-73.9819, 40.7681), se = proj(-73.9730, 40.7644); // CPW & 59th, Fifth & 59th
  const z0 = Math.max(sw[1], se[1]) + 22, z1 = z0 + 1100;
  const xw = sw[0] - 18, xe = se[0] + 18; // inset east of CPW, west of Fifth
  let ring = [xw, z0, xe, z0, xe, z1, xw, z1];
  const sign = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.sign(a); };
  if (parks.length && sign(ring) !== sign(parks[0].p[0])) ring = [xw, z0, xw, z1, xe, z1, xe, z0];
  parks.push({ n: "Central Park", p: [ring] });
}
const sites = parkRows.filter((p: any) => !GREEN.test(p.n) && Math.abs(ringAreaFlat(p.p[0])) > 120).map((p: any) => ({ n: p.n, p: p.p }));
const open = grab("nyc_openspace.json", 0.6, 20).filter(() => false); // open space becomes concrete too
const land = load("nyc_manhattan_land.json").flatMap((r: any) => polys(r.the_geom, 1.5, 500));

// streets with traffic direction (the street wind follows them)
const streets: any[] = [];
for (const c of centerline) {
  if (!c.full_street_name) continue;
  const dir = c.trafdir === "FT" ? 1 : c.trafdir === "TF" ? -1 : 0;
  const w = Number(c.streetwidth ?? 0) * 0.3048;
  for (const l of lines(c.the_geom)) {
    const p = dpSimplify(l, 0.3);
    streets.push({ n: c.full_street_name, w: r1(w || 10), d: dir, l: Number(c.number_travel_lanes ?? 2), rw: Number(c.rw_type ?? 1), p: flat(p) });
  }
}

// ------------------------------------------------------------------ subway: the Broadway line, stations and stairs
const onLine = (r: string) => ["R", "W", "4", "5"].some((l) => (r ?? "").split(" ").includes(l));
const stations = load("nyc_subway_stations.json")
  .filter((s: any) => onLine(s.daytime_routes))
  .map((s: any) => {
    const p = proj(Number(s.gtfs_longitude), Number(s.gtfs_latitude));
    const o = nearest(subway, p);
    return { n: s.stop_name, r: s.daytime_routes, x: r1(p[0]), z: r1(p[1]), ss: Math.round(o.s), d: Math.round(o.d), s: Math.round(sOf(p).s) };
  })
  .filter((s: any) => s.d < 70)
  .sort((a: any, b: any) => a.ss - b.ss);
const entrances = load("nyc_subway_entrances.json")
  .filter((e: any) => onLine(e.daytime_routes) && stations.some((s: any) => s.n === e.stop_name))
  .map((e: any) => {
    const p = proj(Number(e.entrance_longitude), Number(e.entrance_latitude));
    const o = nearest(subway, p);
    return { n: e.stop_name, r: e.daytime_routes, t: e.entrance_type, x: r1(p[0]), z: r1(p[1]), ss: Math.round(o.s), d: Math.round(o.d), s: Math.round(sOf(p).s) };
  })
  .filter((e: any) => e.d < 60);

// ------------------------------------------------------------------ street trees
const trees: number[] = [];
const kept = new Map<string, P[]>();
function keepTree(p: P) {
  const key = (x: number, z: number) => `${Math.floor(x / 28)},${Math.floor(z / 28)}`;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
    for (const q of kept.get(key(p[0] + dx * 28, p[1] + dz * 28)) ?? []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 28) return false;
  const k = key(p[0], p[1]);
  (kept.get(k) ?? kept.set(k, []).get(k)!).push(p);
  return true;
}
for (const t of load("nyc_trees.json")) {
  if (t.status && t.status !== "Alive") continue;
  const p = proj(Number(t.longitude), Number(t.latitude));
  const o = sOf(p);
  if (o.d > 420) continue;
  // a concrete jungle with the odd street tree: keep a sparse few, never closer than 28 m
  if (!keepTree(p)) continue;
  trees.push(r1(p[0]), r1(p[1]), Number(t.tree_dbh ?? 8));
}

// ------------------------------------------------------------------ write
const city = {
  meta: {
    origin: ORIGIN, gridDeg: 28.9, length: routeS[routeS.length - 1],
    credit: "Map data: NYC Open Data (OTI, DOT, Parks, MTA). Buildings are styled, not copied.",
  },
  route: flat(route),
  subway: flat(subway),
  districts: DISTRICTS,
  buildings: bout,
  skyline: sky,
  roadbed, sidewalk, median, plaza, parks, sites, open, land,
  streets, stations, entrances, trees,
  landmarks: {
    statue: proj(-74.0445, 40.6892), // across the harbour
    bowlingGreen: proj(-74.0137, 40.7056),
    cityHall: proj(-74.0059, 40.7128),
    columbusPark: proj(-73.9998, 40.7157),
    unionSquare: proj(-73.9907, 40.7359),
    flatiron: proj(-73.9897, 40.7411),
    heraldSquare: proj(-73.9878, 40.7502),
    timesSquare: proj(-73.9855, 40.758),
    columbusCircle: proj(-73.9819, 40.7681),
    sheepMeadow: proj(-73.975, 40.7718),
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(city));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
const styles: Record<string, number> = {};
for (const b of bout) styles[b.st] = (styles[b.st] ?? 0) + 1;
console.log(`route ${(routeS[routeS.length - 1] / 1000).toFixed(2)} km, ${bout.length} buildings, ${sky.length} skyline, ${roadbed.length} roadbed, ${sidewalk.length} sidewalk, ${streets.length} street segments, ${stations.length} stations, ${entrances.length} entrances, ${trees.length / 3} trees -> ${kb} KB`);
console.log("styles", styles);
console.log("districts", DISTRICTS.map((d) => `${d.id}@${d.s0}`).join(" "));
console.log("stations", stations.map((s: any) => `${s.n}(${s.r})@${s.ss}/${s.d}`).join(", "));
console.log("subway", (subway.length * 4 / 1000).toFixed(2), "km");

// ------------------------------------------------------------------ the far city (public/far.dat)
// Everything outside the playable corridor, for render/farCity.ts: every Manhattan building, the
// Brooklyn / Queens / Bronx waterfronts, Jersey City and Hoboken (OpenStreetMap), and the land
// across the rivers. city.json is untouched: the corridor's own buildings (raw.buildings) and the
// skyline towers (raw.skyline) get their far versions from city.json at runtime.
// Download first: cd tools/osm && node far.mjs
if (fs.existsSync(path.join(DATA, "far_manhattan.json"))) buildFar();

function buildFar() {
  const OUTF = path.resolve("public/far.dat");
  const Q = 0.5, OX = 0, OZ = 6000; // quantum (m) and offset: u16 covers x +-16 km, z -10..22 km
  const qx = (x: number) => Math.round((x - OX) / Q) + 32768, qz = (z: number) => Math.round((z - OZ) / Q) + 32768;
  const X0 = -16000, X1 = 16000, Z0 = -10000, Z1 = 22000;
  const inBox = (x: number, z: number) => x > X0 && x < X1 && z > Z0 && z < Z1;

  // ---- land across the rivers: NYC boroughs (not Manhattan, ground.ts has it) + New Jersey from OSM
  function clipRect(r: P[]): P[] {
    // Sutherland-Hodgman against the box
    const edges: [(p: P) => boolean, (a: P, b: P) => P][] = [
      [(p) => p[0] >= X0, (a, b) => [X0, a[1] + ((b[1] - a[1]) * (X0 - a[0])) / (b[0] - a[0])]],
      [(p) => p[0] <= X1, (a, b) => [X1, a[1] + ((b[1] - a[1]) * (X1 - a[0])) / (b[0] - a[0])]],
      [(p) => p[1] >= Z0, (a, b) => [a[0] + ((b[0] - a[0]) * (Z0 - a[1])) / (b[1] - a[1]), Z0]],
      [(p) => p[1] <= Z1, (a, b) => [a[0] + ((b[0] - a[0]) * (Z1 - a[1])) / (b[1] - a[1]), Z1]],
    ];
    let out = r;
    for (const [inside, cut] of edges) {
      const src = out; out = [];
      for (let i = 0; i < src.length; i++) {
        const a = src[(i + src.length - 1) % src.length], b = src[i];
        if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
        else if (inside(a)) out.push(cut(a, b));
      }
      if (!out.length) break;
    }
    return out;
  }
  const landRings: P[][] = [];
  for (const r of read("far_shore.json")) {
    if (r.boroname === "Manhattan") continue;
    const list = r.the_geom.type === "Polygon" ? [r.the_geom.coordinates] : r.the_geom.coordinates;
    for (const poly of list) {
      const o = ring(poly[0], 4, true);
      if (!o || Math.abs(area(o)) < 3000) continue;
      const c = clipRect(o);
      if (c.length >= 3 && Math.abs(area(c)) > 3000) landRings.push(c);
    }
  }
  // New Jersey: assemble OSM coastline ways (land on the left) into the mainland polygon
  const njRing = (() => {
    const ways: { n: number[]; g: number[][] }[] = read("far_coast.json");
    const byStart = new Map<number, number>();
    ways.forEach((w, i) => byStart.set(w.n[0], i));
    const used = new Uint8Array(ways.length);
    // the chain through Hoboken's waterfront
    const hob = proj(-74.0268, 40.7405);
    let best = -1, bd = Infinity;
    ways.forEach((w, i) => { for (const [lon, lat] of w.g) { const p = proj(lon, lat); const d = Math.hypot(p[0] - hob[0], p[1] - hob[1]); if (d < bd) { bd = d; best = i; } } });
    // walk back to the chain's start, then forward
    const byEnd = new Map<number, number>();
    ways.forEach((w, i) => byEnd.set(w.n[w.n.length - 1], i));
    let s = best;
    for (let k = 0; k < ways.length; k++) { const p = byEnd.get(ways[s].n[0]); if (p === undefined || p === best) break; s = p; }
    const pts: number[][] = [];
    for (let i: number | undefined = s; i !== undefined && !used[i]; i = byStart.get(ways[i].n[ways[i].n.length - 1])) {
      used[i] = 1;
      pts.push(...(pts.length ? ways[i].g.slice(1) : ways[i].g));
    }
    // keep the run of the chain inside the box around Hoboken, then close it far to the west
    const pp = pts.map(([lon, lat]) => proj(lon, lat));
    let i0 = pp.findIndex((p) => Math.hypot(p[0] - hob[0], p[1] - hob[1]) < bd + 1);
    let a = i0, b = i0;
    const ok = (p: P) => inBox(p[0], p[1]) && p[0] > -4000; // west of the East River: just the NJ shore
    while (a > 0 && ok(pp[a - 1])) a--;
    while (b < pp.length - 1 && ok(pp[b + 1])) b++;
    // OSM's coastline crosses the Hudson up by the Palisades and comes back down the Bronx side:
    // stop at its northernmost point
    for (let i = i0, zMax = -Infinity, iMax = i0; i <= b; i++) { if (pp[i][1] > zMax) { zMax = pp[i][1]; iMax = i; } if (i === b) b = iMax; }
    const run = pp.slice(a, b + 1);
    console.log(`far: NJ coastline run ${run.length} points (chain ${pts.length})`);
    // land on the left of travel: close via the box's west side (+x is west)
    const first = run[0], last = run[run.length - 1];
    const closing: P[] = [[X1, last[1]], [X1, first[1]]];
    let r = [...run, ...closing];
    // simplify
    const flatPts = dpSimplify(r, 4);
    r = flatPts;
    if (area(r) < 0) r.reverse(); // same winding as the borough outers
    void i0;
    return r;
  })();
  if (njRing.length > 3) landRings.push(clipRect(njRing));

  // triangulate the land at build time (three's earcut)
  const landV: number[] = [], landI: number[] = [];
  for (const r of landRings) {
    const base = landV.length / 2;
    const tris = ShapeUtils.triangulateShape(r.map(([x, z]) => new Vector2(x, z)), []);
    for (const [x, z] of r) landV.push(x, z);
    for (const t of tris) landI.push(base + t[0], base + t[1], base + t[2]);
  }

  // ---- buildings
  const corridorBins = new Set<number>();
  for (const n of ["nyc_buildings.json", "nyc2_buildings.json", "nyc_skyline.json"]) {
    if (fs.existsSync(path.join(DATA, n))) for (const b of read(n)) corridorBins.add(Number(b.bin));
  }
  const inLand = (x: number, z: number) => landRings.some((r) => inRingP(r.flat(), x, z));
  type FB = { r: P[]; h: number; t: number; k: number };
  const far: FB[] = [];
  // t (type): 0 brick walk-up, 1 prewar masonry, 2 deco tower, 3 modern, 4 glass, 5 rowhouse/low (other boroughs, NJ)
  const typeOf = (year: number, h: number) => {
    if (!year || year < 1800) year = h > 90 ? 1965 : 1915;
    if (year < 1945) return h > 85 ? 2 : h > 30 ? 1 : 0;
    if (year < 1985) return h > 40 ? 3 : 0;
    return h > 45 ? 4 : 3;
  };
  // distance to Manhattan (its land outline), to thin out the low buildings across the rivers
  const mGrid = new Map<string, P[]>();
  for (const p of land) for (let i = 0; i < p[0].length; i += 2) {
    const k = `${Math.floor(p[0][i] / 500)},${Math.floor(p[0][i + 1] / 500)}`;
    (mGrid.get(k) ?? mGrid.set(k, []).get(k)!).push([p[0][i], p[0][i + 1]]);
  }
  const dMan = (x: number, z: number) => {
    let d = Infinity;
    for (let r = 0; r < 12 && d > (r - 1) * 500; r++)
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        for (const p of mGrid.get(`${Math.floor(x / 500) + i},${Math.floor(z / 500) + j}`) ?? []) d = Math.min(d, Math.hypot(p[0] - x, p[1] - z));
      }
    return d;
  };
  const keepAcross = (coords: number[][], h: number, near = 1300) => {
    const p = proj(coords[0][0], coords[0][1]);
    const d = dMan(p[0], p[1]);
    return h > 28 || (h > 14 && d < near + 1300) || d < near;
  };
  const addFoot = (coords: number[][], h: number, t: number, k: number, eps: number) => {
    const o = ring(coords, eps, true);
    if (!o || o.length > 250) return;
    const a = Math.abs(area(o));
    if (a < 18) return;
    let cx = 0, cz = 0;
    for (const p of o) { cx += p[0]; cz += p[1]; }
    cx /= o.length; cz /= o.length;
    if (!inBox(cx, cz)) return;
    far.push({ r: o, h, t, k });
  };
  const codes = ["2100", "5100", "1006", "1005"];
  let nM = 0, nB = 0, nJ = 0;
  for (const b of read("far_manhattan.json")) {
    if (!codes.includes(b.feature_code) || corridorBins.has(Number(b.bin))) continue;
    const h = Number(b.height_roof ?? 0) * 0.3048;
    if (!(h > 2.5)) continue;
    const list = b.the_geom.type === "Polygon" ? [b.the_geom.coordinates] : b.the_geom.coordinates;
    for (const poly of list) addFoot(poly[0], h, typeOf(Number(b.construction_year ?? 0), h), Number(b.bin) % 65536, 0.9);
    nM++;
  }
  const boroughs = read("far_boroughs.json");
  if (fs.existsSync(path.join(DATA, "far_boroughs_low.json"))) boroughs.push(...read("far_boroughs_low.json"));
  for (const b of boroughs) {
    if (!codes.includes(b.feature_code)) continue;
    const h = Number(b.height_roof ?? 0) * 0.3048;
    const list = b.the_geom.type === "Polygon" ? [b.the_geom.coordinates] : b.the_geom.coordinates;
    const year = Number(b.construction_year ?? 0);
    if (!keepAcross(list[0][0], h)) continue;
    for (const poly of list) addFoot(poly[0], h, h < 20 ? 5 : typeOf(year, h), Number(b.bin) % 65536, 1.2);
    nB++;
  }
  // New Jersey (OSM): heights where tagged, else a few storeys
  const SKIP = /^(garage|garages|shed|roof|storage_tank|carport|hut|kiosk|ruins|construction|bridge|service|greenhouse)$/;
  let osmK = 1;
  for (const b of read("far_osm_buildings.json")) {
    const tg = b.t ?? {};
    if (SKIP.test(tg.building ?? "")) continue;
    let h = parseFloat(tg.height ?? "");
    const lv = parseFloat(tg["building:levels"] ?? "");
    const k = (osmK++ * 2654435761) >>> 16;
    if (!(h > 0)) h = lv > 0 ? lv * 3.2 + 1.5 : /apartments|commercial|office|hotel/.test(tg.building ?? "") ? 14 : 7 + (k % 7);
    const g: number[][] = b.g;
    // drop anything on the NYC side (Manhattan is NYC data)
    let cx = 0, cz = 0;
    for (const [lon, lat] of g) { const p = proj(lon, lat); cx += p[0]; cz += p[1]; }
    cx /= g.length; cz /= g.length;
    if (!inRingP(njRing.flat(), cx, cz)) continue;
    if (!keepAcross(g, h, 2700)) continue;
    const before = far.length;
    addFoot(g, h, h > 45 ? 4 : h > 20 ? 3 : 5, k, 1.2);
    if (far.length > before && Math.abs(area(far[far.length - 1].r)) < 45 && h < 15) far.pop(); // sheds and garages
    else if (far.length > before) nJ++;
  }
  void inLand;

  // order by tile (1600 m) so the runtime can build tile meshes without sorting
  const T = 1600;
  const tileOf = (b: FB) => { let x = 0, z = 0; for (const p of b.r) { x += p[0]; z += p[1]; } return Math.floor((x / b.r.length - X0) / T) * 64 + Math.floor((z / b.r.length - Z0) / T); };
  far.sort((a, b) => tileOf(a) - tileOf(b));

  // ---- write: header, land, buildings (first vertex absolute, then int16 deltas), gzipped
  const parts: Buffer[] = [];
  const head = Buffer.alloc(32);
  head.write("FAR1", 0, "ascii");
  head.writeUInt32LE(landV.length / 2, 4);
  head.writeUInt32LE(landI.length / 3, 8);
  head.writeUInt32LE(far.length, 12);
  head.writeFloatLE(Q, 16); head.writeFloatLE(OX, 20); head.writeFloatLE(OZ, 24);
  parts.push(head);
  const lv = Buffer.alloc(landV.length * 2);
  for (let i = 0; i < landV.length; i += 2) { lv.writeUInt16LE(qx(landV[i]) , i * 2); lv.writeUInt16LE(qz(landV[i + 1]), i * 2 + 2); }
  const li = Buffer.alloc(landI.length * 4);
  landI.forEach((v, i) => li.writeUInt32LE(v, i * 4));
  parts.push(lv, li);
  // building records: u8 n, u8 type, u16 height (dm), u16 seed, u16 x0, u16 z0, then (n-1) x (int16 dx, int16 dz)
  let bytes = 0;
  for (const b of far) bytes += 10 + (b.r.length - 1) * 4;
  const bb = Buffer.alloc(bytes);
  let o = 0;
  for (const b of far) {
    bb.writeUInt8(b.r.length, o); bb.writeUInt8(b.t, o + 1);
    bb.writeUInt16LE(Math.min(65535, Math.round(b.h * 10)), o + 2); bb.writeUInt16LE(b.k & 0xffff, o + 4);
    let px = qx(b.r[0][0]), pz = qz(b.r[0][1]);
    bb.writeUInt16LE(px, o + 6); bb.writeUInt16LE(pz, o + 8);
    o += 10;
    for (let i = 1; i < b.r.length; i++) {
      const nx = qx(b.r[i][0]), nz = qz(b.r[i][1]);
      bb.writeInt16LE(nx - px, o); bb.writeInt16LE(nz - pz, o + 2);
      px = nx; pz = nz; o += 4;
    }
  }
  parts.push(bb);
  const raw = Buffer.concat(parts);
  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(OUTF, gz);
  console.log(`far: ${far.length} buildings (Manhattan ${nM}, boroughs ${nB}, NJ ${nJ}), land ${landRings.length} rings / ${landI.length / 3} tris -> ${(raw.length / 1024).toFixed(0)} KB raw, ${(gz.length / 1024).toFixed(0)} KB gzipped`);
}
