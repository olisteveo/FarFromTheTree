// Finds the gaps in the city's building data inside the playable strip and decides what fills
// them, writing web/public/models/buildings_gaps.json (read by src/render/architectureInfill.ts
// and architectureLots.ts):
//   node --import tsx tools/buildings/gaps.ts            (run from web/; re-run after city.json changes)
//
// 1. rasterise land, streets, sidewalks, parks, sites and footprints on a 1 m grid (raster.ts)
// 2. free land within the corridor = land that is none of those
// 3. an opening (erode 2 m, grow back) separates real lots from slivers; slivers wedged between
//    two buildings away from the street become filler wall at the lower neighbour's height
// 4. lots that touch a sidewalk: mostly infill buildings (cut into 6-15 m parcels along the street,
//    style and height from the neighbours), some parking lots, some construction sites;
//    yards inside blocks: some get one-storey rear extensions, the rest stay yards
// Deterministic: same city.json, same answer. Never green (concrete jungle).
import fs from "node:fs";
import { CityData, ringArea, type Building, type Style } from "../../src/world/data";
import { rasterCity, LAND, PAVED, BUILT, GREEN, SITE, WALK, ROAD } from "./raster";

const CORRIDOR = 360;
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const t0 = Date.now();
const R = rasterCity(city, 420, 1);
const { w: W, h: H } = R;
const N = W * H;

const hash = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; return (x >>> 0) / 4294967296; };

// ---------------------------------------------------------------- corridor (coarse route distance)
const C = 8, cw = Math.ceil(W / C), ch = Math.ceil(H / C);
const near = new Uint8Array(cw * ch);
for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
  const x = R.x0 + (i + 0.5) * C, z = R.z0 + (j + 0.5) * C;
  near[j * cw + i] = city.route.nearest(x, z).d < CORRIDOR ? 1 : 0;
}
const inCorridor = (i: number) => near[Math.floor(Math.floor(i / W) / C) * cw + Math.floor((i % W) / C)] === 1;

// ---------------------------------------------------------------- free land
const free = new Uint8Array(N);
let nFree = 0;
for (let i = 0; i < N; i++) {
  const b = R.bits[i];
  if ((b & LAND) && !(b & (PAVED | BUILT | GREEN | SITE)) && inCorridor(i)) { free[i] = 1; nFree++; }
}

// distance (in cells, capped) from the nearest street cell, to tell street lots from yards
const toStreet = new Uint8Array(N).fill(255);
{
  const q: number[] = [];
  for (let i = 0; i < N; i++) if (R.bits[i] & (WALK | ROAD)) { toStreet[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], d = toStreet[i];
    if (d >= 12) continue;
    const x = i % W;
    for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (n < 0 || n >= N || toStreet[n] <= d + 1) continue;
      toStreet[n] = d + 1;
      q.push(n);
    }
  }
}

// ---------------------------------------------------------------- opening: erode 2, grow back 2 (within free)
function erode(src: Uint8Array, r: number): Uint8Array {
  // separable min filter
  const a = new Uint8Array(N), b = new Uint8Array(N);
  for (let j = 0; j < H; j++) {
    let run = 0;
    for (let i = 0; i < W; i++) { run = src[j * W + i] ? run + 1 : 0; a[j * W + i] = run > 2 * r ? 1 : 0; }
  }
  // a marks the right end of a run of 2r+1: shift back by r
  const ah = new Uint8Array(N);
  for (let j = 0; j < H; j++) for (let i = r; i < W; i++) ah[j * W + i - r] = a[j * W + i];
  for (let i = 0; i < W; i++) {
    let run = 0;
    for (let j = 0; j < H; j++) { run = ah[j * W + i] ? run + 1 : 0; b[j * W + i] = run > 2 * r ? 1 : 0; }
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < W; i++) for (let j = r; j < H; j++) out[(j - r) * W + i] = b[j * W + i];
  return out;
}
function grow(src: Uint8Array, within: Uint8Array, r: number): Uint8Array {
  let cur = src;
  for (let k = 0; k < r; k++) {
    const nx = cur.slice();
    for (let i = 0; i < N; i++) {
      if (!cur[i]) continue;
      const x = i % W;
      if (x > 0 && within[i - 1]) nx[i - 1] = 1;
      if (x < W - 1 && within[i + 1]) nx[i + 1] = 1;
      if (i >= W && within[i - W]) nx[i - W] = 1;
      if (i < N - W && within[i + W]) nx[i + W] = 1;
    }
    cur = nx;
  }
  return cur;
}
const core = grow(erode(free, 2), free, 3);

// ---------------------------------------------------------------- components
function components(mask: Uint8Array, minCells: number) {
  const lab = new Int32Array(N).fill(-1);
  const comps: number[][] = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = comps.length, cells: number[] = [s];
    lab[s] = id;
    for (let h = 0; h < cells.length; h++) {
      const i = cells[h], x = i % W;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (n < 0 || n >= N || !mask[n] || lab[n] >= 0) continue;
        lab[n] = id;
        cells.push(n);
      }
    }
    comps.push(cells);
  }
  return comps.filter((c) => c.length >= minCells);
}

// ---------------------------------------------------------------- contour -> polygon
const SIGN = Math.sign(ringArea(city.buildings[0].poly[0]));
function trace(cells: number[]): number[] | null {
  const set = new Set(cells);
  // directed boundary edges between grid corners, inside on the left (anticlockwise in grid space)
  const edges = new Map<number, number[]>();
  const K = (i: number, j: number) => j * (W + 1) + i;
  const addE = (a: number, b: number) => { (edges.get(a) ?? edges.set(a, []).get(a)!).push(b); };
  for (const c of cells) {
    const i = c % W, j = Math.floor(c / W);
    if (!set.has(c - W) || j === 0) addE(K(i, j), K(i + 1, j));
    if (!set.has(c + 1) || i === W - 1) addE(K(i + 1, j), K(i + 1, j + 1));
    if (!set.has(c + W) || j === H - 1) addE(K(i + 1, j + 1), K(i, j + 1));
    if (!set.has(c - 1) || i === 0) addE(K(i, j + 1), K(i, j));
  }
  let best: number[] = [];
  const used = new Set<string>();
  for (const [start, outs] of edges) {
    for (const first of outs) {
      if (used.has(start + ">" + first)) continue;
      const loop = [start];
      let prev = start, cur = first;
      used.add(start + ">" + first);
      let guard = 0;
      while (cur !== start && guard++ < 200000) {
        loop.push(cur);
        const nexts = (edges.get(cur) ?? []).filter((n) => !used.has(cur + ">" + n));
        if (!nexts.length) break;
        // at a pinch, turn left (stay with this region)
        const px = prev % (W + 1), py = Math.floor(prev / (W + 1)), cx = cur % (W + 1), cy = Math.floor(cur / (W + 1));
        const dx = cx - px, dy = cy - py;
        let pick = nexts[0];
        if (nexts.length > 1) {
          for (const n of nexts) {
            const nx = n % (W + 1) - cx, ny = Math.floor(n / (W + 1)) - cy;
            if (dx * ny - dy * nx > 0) { pick = n; break; }
          }
        }
        used.add(cur + ">" + pick);
        prev = cur;
        cur = pick;
      }
      if (loop.length > best.length) best = loop;
    }
  }
  if (best.length < 4) return null;
  // to world corners, drop collinear points, Douglas-Peucker
  let pts = best.map((k) => [R.x0 + (k % (W + 1)) * R.cell, R.z0 + Math.floor(k / (W + 1)) * R.cell]);
  pts = dp(pts, 0.85);
  if (pts.length < 3) return null;
  const flat = pts.flat();
  if (Math.sign(ringArea(flat)) !== SIGN) { const r: number[] = []; for (let i = pts.length - 1; i >= 0; i--) r.push(pts[i][0], pts[i][1]); return r; }
  return flat;
}
function dp(pts: number[][], eps: number): number[][] {
  // closed ring: split at the farthest point from the first
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const half = (a: number[][]) => {
    const keep = new Uint8Array(a.length); keep[0] = keep[a.length - 1] = 1;
    const st: [number, number][] = [[0, a.length - 1]];
    while (st.length) {
      const [s, e] = st.pop()!;
      let bi = -1, bd = eps;
      const [ax, az] = a[s], [bx, bz] = a[e], L = Math.hypot(bx - ax, bz - az) || 1e-9;
      for (let i = s + 1; i < e; i++) { const d = Math.abs((bx - ax) * (az - a[i][1]) - (ax - a[i][0]) * (bz - az)) / L; if (d > bd) { bd = d; bi = i; } }
      if (bi > 0) { keep[bi] = 1; st.push([s, bi], [bi, e]); }
    }
    return a.filter((_, i) => keep[i]);
  };
  const a = half(pts.slice(0, far + 1)), b = half([...pts.slice(far), pts[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// ---------------------------------------------------------------- neighbours
function neighbours(cells: number[]): Building[] {
  const seen = new Map<number, number>();
  for (const c of cells) {
    const x = c % W;
    for (const n of [x > 1 ? c - 2 : -1, x < W - 2 ? c + 2 : -1, c - 2 * W, c + 2 * W]) {
      if (n < 0 || n >= N) continue;
      const id = R.bid[n];
      if (id >= 0) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => city.buildings[id]);
}

// ---------------------------------------------------------------- decide
interface OutB { p: number[][]; h: number; y: number; st: Style; k: number; s: number; d: number; why: string }
const outB: OutB[] = [], lots: { p: number[][]; kind: "parking" | "construction"; k: number; front: number[] }[] = [];
let seedN = 1;
const centroid = (cells: number[]) => { let x = 0, z = 0; for (const c of cells) { x += R.cx(c); z += R.cz(c); } return [x / cells.length, z / cells.length]; };

function addBuilding(cells: number[], why: string, h: number, st: Style, year: number) {
  // close the cracks against the neighbours: grow one cell into their footprints
  const grown = new Set(cells);
  for (const c of cells) {
    const x = c % W;
    for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) if (n >= 0 && n < N && (R.bits[n] & BUILT) && !(R.bits[n] & PAVED)) grown.add(n);
  }
  const ring = trace([...grown]);
  if (!ring || Math.abs(ringArea(ring)) < 12) return;
  const [cx, cz] = centroid(cells);
  const n = city.route.nearest(cx, cz);
  outB.push({ p: [ring], h: Math.round(h * 10) / 10, y: year, st, k: (seedN++ * 2654435761 >>> 0) % 100000, s: Math.round(n.s), d: Math.round(n.d), why });
}

function styleFrom(nb: Building[], r: number): { st: Style; h: number; year: number } {
  if (!nb.length) return { st: r < 0.5 ? "brick" : "tenement", h: 14 + r * 10, year: 1925 };
  const top = nb.slice(0, 4);
  const hs = top.map((b) => b.h).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)];
  const b0 = top[Math.floor(r * top.length)];
  let st: Style = b0.style;
  // a quarter of infill lots are newer: postwar brick or a glassy condo
  if (r < 0.25) st = med > 45 ? "glass" : "brick";
  if (st === "civic" || st === "deco") st = med > 60 ? "prewar" : "tenement";
  // never a tower: a gap beside a skyscraper gets a low infill, not a 300 m sliver
  const h = Math.max(8, Math.min(med * (0.8 + r * 0.35), med > 60 ? 70 : 45));
  return { st, h, year: st === "glass" ? 2008 : st === "brick" ? 1962 : b0.year || 1915 };
}

// 1) lots and yards
const comps = components(core, 40);
let nInfill = 0, nPark = 0, nSite = 0, nExt = 0, nYard = 0;
for (const cells of comps) {
  const [cx, cz] = centroid(cells);
  const r = hash(Math.round(cx * 10), Math.round(cz * 10));
  const front = cells.filter((c) => toStreet[c] <= 3).length;
  const area = cells.length * R.cell * R.cell;
  const nb = neighbours(cells);
  const district = city.district(city.route.nearest(cx, cz).s).id;
  // big open areas and anything on the waterfront are real open space (plazas, ramps, esplanades), not lots
  if (area > 5000 || district === "battery" || district === "park") continue;
  if (cells.some((c) => { const x = c % W; return [c - 3, c + 3, c - 3 * W, c + 3 * W].some((n) => n >= 0 && n < N && Math.abs((n % W) - x) <= 3 && !(R.bits[n] & LAND)); })) continue;
  if (front >= 6) {
    // a street lot: what goes here?
    let kind: "infill" | "parking" | "construction" = "infill";
    if (area > 2500) kind = r < 0.45 ? "parking" : r < 0.8 ? "construction" : "infill";
    else if (area > 600) kind = r < 0.22 ? "parking" : r < 0.42 ? "construction" : "infill";
    else if (area > 250) kind = r < 0.12 ? "construction" : "infill";
    if (kind === "infill") {
      // cut into parcels along the street
      const st0 = city.street(cx, cz);
      const tx = st0.tx, tz = st0.tz;
      let lo = Infinity;
      for (const c of cells) lo = Math.min(lo, R.cx(c) * tx + R.cz(c) * tz);
      const cuts: number[] = [];
      let at = 0, k = 0;
      while (at < 400) { at += 6 + hash(Math.round(cx), k++) * 9; cuts.push(at); }
      const parcels = new Map<number, number[]>();
      for (const c of cells) {
        const along = R.cx(c) * tx + R.cz(c) * tz - lo;
        let p = 0;
        while (cuts[p] < along) p++;
        (parcels.get(p) ?? parcels.set(p, []).get(p)!).push(c);
      }
      for (const [p, pc] of parcels) {
        if (pc.length < 25) continue;
        const s = styleFrom(nb, hash(Math.round(cx), p + 77));
        addBuilding(pc, "infill", s.h, s.st, s.year);
        nInfill++;
      }
    } else {
      const ring = trace(cells);
      if (!ring) continue;
      // the frontage: the ring edges that face the street
      const fr: number[] = [];
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        const mx = (ring[i] + ring[j]) / 2, mz = (ring[i + 1] + ring[j + 1]) / 2;
        const gi = Math.floor((mz - R.z0) / R.cell) * W + Math.floor((mx - R.x0) / R.cell);
        let best = 255;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const q = gi + dj * W + di; if (q >= 0 && q < N) best = Math.min(best, toStreet[q]); }
        if (best <= 2) fr.push(i / 2);
      }
      lots.push({ p: [ring], kind, k: Math.round(r * 1e5), front: fr });
      if (kind === "parking") nPark++; else nSite++;
    }
  } else {
    // a yard inside the block: one-storey rear extensions on some, open yards on the rest
    if (area < 30) continue;
    if (area < 900 && r < 0.6 && nb.length) {
      const b0 = nb[0];
      const h = b0.h < 10 ? Math.max(3.5, b0.h - 1) : 4 + r * 4;
      addBuilding(cells, "extension", h, b0.style === "glass" || b0.style === "modern" ? "brick" : b0.style === "castiron" ? "castiron" : "brick", 1950);
      nExt++;
    } else nYard++;
  }
}

// 2) slivers wedged between two buildings, away from the street
const sliver = new Uint8Array(N);
for (let i = 0; i < N; i++) if (free[i] && !core[i] && toStreet[i] > 3) sliver[i] = 1;
let nSliver = 0;
for (const cells of components(sliver, 6)) {
  const nb = neighbours(cells);
  if (nb.length < 2) continue;
  // keep some of the tenements' air shafts open
  const [sx, sz] = centroid(cells);
  if (hash(Math.round(sx * 3), Math.round(sz * 3)) < 0.3) continue;
  const h = Math.max(6, Math.min(nb[0].h, nb[1].h, 40) - 0.5);
  addBuilding(cells, "sliver", h, nb[0].style === "glass" ? "brick" : nb[0].style, nb[0].year);
  nSliver++;
}

const out = { version: 1, buildings: outB, lots };
fs.writeFileSync("public/models/buildings_gaps.json", JSON.stringify(out));
console.log(`free ${nFree} m2; ${comps.length} lots/yards: infill parcels ${nInfill}, parking ${nPark}, construction ${nSite}, extensions ${nExt}, yards left ${nYard}; slivers ${nSliver}`);
console.log(`wrote ${outB.length} buildings, ${lots.length} lots in ${Date.now() - t0} ms, ${(fs.statSync("public/models/buildings_gaps.json").size / 1024).toFixed(0)} KB`);
