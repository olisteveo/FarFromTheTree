// Builds the far city's tile meshes off the main thread: decodes public/far.dat, adds far
// versions of the corridor's own buildings (city.json), extrudes footprints into merged,
// shared-vertex geometry (flat normals come from screen derivatives in the shader), adds the
// odd water tower and the landmark silhouettes, and posts typed arrays back.

import { decodeFar, gunzipMaybe, projLL } from "./farData";

export interface FarIn {
  buf: ArrayBuffer;
  /** corridor + skyline buildings from city.json (their far versions fade in beyond the detail distance) */
  corridor: { verts: Float32Array; start: Uint32Array; count: Uint16Array; h: Float32Array; type: Uint8Array; seed: Uint16Array };
  low: boolean;
  /** rectangles to keep clear (the basketball courts): no far building with a corner or its centre inside */
  clear?: { x: number; z: number; hw: number; hd: number; yaw: number }[];
}
export interface FarTile {
  gated: boolean;
  pos: Float32Array;
  u: Float32Array;
  info: Uint8Array;
  center: Float32Array | null;
  index: Uint32Array;
  /** cumulative index counts: [importance 0 only, 0..1, 0..2, all] */
  lod: number[];
  box: number[]; // x0, z0, x1, z1, maxH
}
export interface FarOut { tiles: FarTile[]; landV: Float32Array; landI: Uint32Array; ms: number }

// type ids shared with the shader: 0 brick walk-up, 1 prewar masonry, 2 deco, 3 modern, 4 glass, 5 low (boroughs/NJ),
// 6 water tower, 7 spire / landmark metal
const T_TOWER = 6, T_SPIRE = 7;
const TILE = 1600, X0 = -16000, Z0 = -10000;

// ---------------------------------------------------------------- landmark silhouettes
// tiers: [scale of the footprint (about its centroid), top height]; spire: [radius, tip height]
interface Mark { name: string; at: [number, number]; tiers: [number, number][]; spire?: [number, number]; rot?: number }
const MARKS: Mark[] = [
  { name: "Empire State", at: [40.74844, -73.98566], tiers: [[1, 26], [0.8, 120], [0.66, 265], [0.5, 320], [0.36, 350], [0.24, 373]], spire: [2.6, 443] },
  { name: "Chrysler", at: [40.75164, -73.97547], tiers: [[1, 60], [0.82, 190], [0.62, 240], [0.5, 252], [0.42, 262], [0.33, 271], [0.24, 280]], spire: [1.2, 319] },
  { name: "One World Trade", at: [40.71274, -74.01338], tiers: [], spire: [1.6, 541] },
  { name: "Woolworth", at: [40.71240, -74.00829], tiers: [[1, 90], [0.55, 180], [0.42, 215], [0.3, 232]], spire: [1.5, 241] },
  { name: "Bank of America", at: [40.75550, -73.98430], tiers: [], spire: [1.2, 366] },
  { name: "New York Times", at: [40.75620, -73.99000], tiers: [], spire: [0.9, 319] },
];

function hash(n: number) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }

// ---------------------------------------------------------------- geometry
class Geo {
  pos: number[] = []; u: number[] = []; info: number[] = []; center: number[] | null; idx: number[][] = [[], [], [], []];
  x0 = Infinity; z0 = Infinity; x1 = -Infinity; z1 = -Infinity; hMax = 0;
  constructor(readonly gated: boolean) { this.center = gated ? [] : null; }
  vtx(x: number, y: number, z: number, u: number, t: number, seed: number, flags: number, hq: number, cx: number, cz: number) {
    this.pos.push(x, y, z); this.u.push(u); this.info.push(t, seed & 255, flags, hq);
    if (this.center) this.center.push(cx, cz);
    if (x < this.x0) this.x0 = x; if (x > this.x1) this.x1 = x;
    if (z < this.z0) this.z0 = z; if (z > this.z1) this.z1 = z;
    if (y > this.hMax) this.hMax = y;
    return this.pos.length / 3 - 1;
  }
}

/** Signed area in x,z. */
function sArea(xs: number[], zs: number[]) {
  let a = 0;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) a += xs[j] * zs[i] - xs[i] * zs[j];
  return a / 2;
}

/** Ear clipping for a simple ring (CCW in x,z math orientation). Returns local index triples. */
function earClip(xs: number[], zs: number[]): number[] {
  const n = xs.length;
  if (n === 3) return [0, 1, 2];
  const V = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  const cross = (a: number, b: number, c: number) => (xs[b] - xs[a]) * (zs[c] - zs[a]) - (zs[b] - zs[a]) * (xs[c] - xs[a]);
  const inside = (a: number, b: number, c: number, p: number) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (V.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const a = V[(i + V.length - 1) % V.length], b = V[i], c = V[(i + 1) % V.length];
      if (cross(a, b, c) <= 1e-9) continue; // reflex
      let ear = true;
      for (const p of V) { if (p === a || p === b || p === c) continue; if (inside(a, b, c, p)) { ear = false; break; } }
      if (!ear) continue;
      out.push(a, b, c); V.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (V.length === 3) out.push(V[0], V[1], V[2]);
  else for (let i = 1; i < V.length - 1; i++) out.push(V[0], V[i], V[i + 1]); // degenerate leftovers: fan
  return out;
}

/** Extrude a ring between y0 and y1 (optionally scaled to a second ring at the top), with a flat cap. */
function prism(g: Geo, cls: number, xs: number[], zs: number[], y0: number, y1: number, t: number, seed: number, flags: number, cx: number, cz: number, cap = true, txs?: number[], tzs?: number[], u0 = 0) {
  const n = xs.length;
  if (sArea(xs, zs) < 0) { xs = xs.slice().reverse(); zs = zs.slice().reverse(); if (txs && tzs) { txs = txs.slice().reverse(); tzs = tzs.slice().reverse(); } }
  const tx = txs ?? xs, tz = tzs ?? zs;
  const hq = Math.min(255, Math.round(y1 / 2));
  const I = g.idx[cls];
  const bot: number[] = [], top: number[] = [];
  let u = u0;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i > 0) u += Math.hypot(xs[k] - xs[i - 1], zs[k] - zs[i - 1]);
    bot.push(g.vtx(xs[k], y0, zs[k], u, t, seed, flags, hq, cx, cz));
    top.push(g.vtx(tx[k], y1, tz[k], u, t, seed, flags, hq, cx, cz));
  }
  // CCW in (x,z) math orientation: the triangle (B_i, B_i+1, T_i+1) faces (-dz, dx), which is inward,
  // so wind the other way round
  for (let i = 0; i < n; i++) I.push(bot[i], top[i + 1], bot[i + 1], bot[i], top[i], top[i + 1]);
  if (cap) {
    const tri = earClip(tx, tz);
    // roof triangles must face +y: with CCW (x,z) the ear (a,b,c) has normal -y, so flip
    for (let i = 0; i < tri.length; i += 3) I.push(top[tri[i]], top[tri[i + 2]], top[tri[i + 1]]);
  }
}

function waterTower(g: Geo, x: number, z: number, h: number, seed: number, cx: number, cz: number) {
  const xs: number[] = [], zs: number[] = [];
  const r = 2.1 + hash(seed * 7) * 0.8;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; xs.push(x + Math.cos(a) * r); zs.push(z + Math.sin(a) * r); }
  const y0 = h + 2.2, y1 = y0 + 3.6 + hash(seed * 3) * 1.4;
  prism(g, 3, xs, zs, y0, y1, T_TOWER, seed, 0, cx, cz, false);
  // the conical lid
  const apex = g.vtx(x, y1 + 1.6, z, 0, T_TOWER, seed, 1, Math.min(255, Math.round(h / 2)), cx, cz);
  const ring: number[] = [];
  for (let i = 0; i < 6; i++) ring.push(g.vtx(xs[i], y1, zs[i], 0, T_TOWER, seed, 1, Math.min(255, Math.round(h / 2)), cx, cz));
  for (let i = 0; i < 6; i++) g.idx[3].push(ring[i], apex, ring[(i + 1) % 6]);
  // legs: a dark band under it reads as the stilts from afar
  const lx = xs.map((v) => x + (v - x) * 0.8), lz = zs.map((v) => z + (v - z) * 0.8);
  prism(g, 3, lx, lz, h, y0, T_TOWER, seed, 2, cx, cz, false);
}

function spire(g: Geo, x: number, z: number, y0: number, r: number, tip: number, cx: number, cz: number) {
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.785; xs.push(x + Math.cos(a) * r); zs.push(z + Math.sin(a) * r); }
  const txs = xs.map((v) => x + (v - x) * 0.12), tzs = zs.map((v) => z + (v - z) * 0.12);
  prism(g, 0, xs, zs, y0, tip, T_SPIRE, 1, 0, cx, cz, true, txs, tzs);
}

function inRing(xs: number[], zs: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++)
    if ((zs[i] > z) !== (zs[j] > z) && x < ((xs[j] - xs[i]) * (z - zs[i])) / (zs[j] - zs[i]) + xs[i]) c = !c;
  return c;
}

function build(msg: FarIn, far: ReturnType<typeof decodeFar>): FarOut {
  const t0 = performance.now();
  const tiles = new Map<number, Geo>();
  const tileFor = (gated: boolean, x: number, z: number) => {
    const k = (gated ? 1 : 0) + 2 * (Math.floor((x - X0) / TILE) * 64 + Math.floor((z - Z0) / TILE));
    let g = tiles.get(k);
    if (!g) tiles.set(k, (g = new Geo(gated)));
    return g;
  };
  const marks = MARKS.map((m) => ({ ...m, p: projLL(m.at[0], m.at[1]), best: null as null | { h: number; gated: boolean; xs: number[]; zs: number[] } }));

  const one = (gated: boolean, xs: number[], zs: number[], h: number, t: number, seed: number) => {
    const n = xs.length;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += xs[i]; cz += zs[i]; }
    cx /= n; cz /= n;
    if (msg.clear?.length) {
      const inside = (x: number, z: number) => msg.clear!.some((c) => {
        const dx = x - c.x, dz = z - c.z;
        return Math.abs(dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)) < c.hw + 1 && Math.abs(dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)) < c.hd + 1;
      });
      if (inside(cx, cz) || xs.some((x, k) => inside(x, zs[k]))) return;
    }
    // a landmark? remember the tallest candidate and build it afterwards
    if (h > 150) for (const m of marks) {
      if (Math.hypot(cx - m.p[0], cz - m.p[1]) < 70 && (inRing(xs, zs, m.p[0], m.p[1]) || Math.hypot(cx - m.p[0], cz - m.p[1]) < 45)) {
        if (!m.best || h > m.best.h) m.best = { h, gated, xs, zs };
        if (m.tiers.length) return;
      }
    }
    const area = Math.abs(sArea(xs, zs));
    if (msg.low && !gated && h < 12 && area < 250) return;
    const cls = h > 70 ? 0 : h > 30 ? 1 : h > 14 || area > 1500 ? 2 : 3;
    const g = tileFor(gated, cx, cz);
    prism(g, cls, xs, zs, -2, h, t, seed, 0, cx, cz);
    // water towers on old walk-ups and prewar roofs in Manhattan
    if ((t === 0 || t === 1) && h > 14 && h < 80 && area > 140 && hash(seed * 31 + 7) < (msg.low ? 0.15 : 0.3) && inRing(xs, zs, cx, cz)) {
      const ox = (hash(seed * 13) - 0.5) * Math.sqrt(area) * 0.3, oz = (hash(seed * 17) - 0.5) * Math.sqrt(area) * 0.3;
      const wx = inRing(xs, zs, cx + ox, cz + oz) ? cx + ox : cx, wz = inRing(xs, zs, cx + ox, cz + oz) ? cz + oz : cz;
      waterTower(g, wx, wz, h, seed, cx, cz);
    }
  };

  // the far.dat buildings (never gated: nothing else draws them)
  for (let i = 0; i < far.start.length; i++) {
    const s = far.start[i] * 2, n = far.count[i];
    const xs: number[] = [], zs: number[] = [];
    for (let k = 0; k < n; k++) { xs.push(far.verts[s + k * 2]); zs.push(far.verts[s + k * 2 + 1]); }
    one(false, xs, zs, far.height[i], far.type[i], far.seed[i] + i);
  }
  // the corridor's buildings: far versions, hidden near the camera where the detailed ones are
  const c = msg.corridor;
  for (let i = 0; i < c.start.length; i++) {
    const s = c.start[i] * 2, n = c.count[i];
    if (n < 3) continue;
    // simplify: drop vertices closer than 0.8 m to the previous kept one
    const xs: number[] = [], zs: number[] = [];
    for (let k = 0; k < n; k++) {
      const x = c.verts[s + k * 2], z = c.verts[s + k * 2 + 1];
      if (xs.length && Math.hypot(x - xs[xs.length - 1], z - zs[zs.length - 1]) < 0.8) continue;
      xs.push(x); zs.push(z);
    }
    if (xs.length > 3 && Math.hypot(xs[0] - xs[xs.length - 1], zs[0] - zs[zs.length - 1]) < 0.8) { xs.pop(); zs.pop(); }
    if (xs.length < 3) continue;
    one(true, xs, zs, c.h[i], c.type[i], c.seed[i]);
  }
  // landmarks: setback tiers and spires
  for (const m of marks) {
    const b = m.best;
    if (!b) continue;
    let cx = 0, cz = 0;
    for (let i = 0; i < b.xs.length; i++) { cx += b.xs[i]; cz += b.zs[i]; }
    cx /= b.xs.length; cz /= b.zs.length;
    const g = tileFor(b.gated, cx, cz);
    let y = -2;
    const t = m.name === "Chrysler" || m.name === "Empire State" || m.name === "Woolworth" ? 2 : 4;
    for (const [sc, top] of m.tiers) {
      const xs = b.xs.map((v) => cx + (v - cx) * sc), zs = b.zs.map((v) => cz + (v - cz) * sc);
      prism(g, 0, xs, zs, y, top, t, 77, 0, cx, cz);
      y = top;
    }
    // spires are always drawn (not gated): they top the detailed building near and the far one far away
    if (m.spire) {
      const top = m.tiers.length ? y : b.h;
      spire(tileFor(false, cx, cz), cx, cz, top - 1, m.spire[0], m.spire[1], cx, cz);
    }
  }

  const out: FarTile[] = [];
  for (const g of tiles.values()) {
    if (!g.pos.length) continue;
    const lod: number[] = [];
    let total = 0;
    for (const l of g.idx) { total += l.length; lod.push(total); }
    const index = new Uint32Array(total);
    let o = 0;
    for (const l of g.idx) { index.set(l, o); o += l.length; }
    out.push({
      gated: g.gated, pos: new Float32Array(g.pos), u: new Float32Array(g.u), info: new Uint8Array(g.info),
      center: g.center ? new Float32Array(g.center) : null, index, lod, box: [g.x0, g.z0, g.x1, g.z1, g.hMax],
    });
  }
  return { tiles: out, landV: far.landV, landI: far.landI, ms: performance.now() - t0 };
}

/** Decode and build (the worker's job; also callable directly, e.g. for headless tests). */
export async function runFar(msg: FarIn): Promise<FarOut> {
  const raw = await gunzipMaybe(msg.buf);
  return build(msg, decodeFar(raw));
}

if (typeof window === "undefined") {
  self.onmessage = async (e: MessageEvent<FarIn>) => {
    try {
      const res = await runFar(e.data);
      const transfer: Transferable[] = [res.landV.buffer, res.landI.buffer];
      for (const t of res.tiles) { transfer.push(t.pos.buffer, t.u.buffer, t.info.buffer, t.index.buffer); if (t.center) transfer.push(t.center.buffer); }
      (self as unknown as Worker).postMessage(res, transfer);
    } catch (err) {
      (self as unknown as Worker).postMessage({ error: String(err) });
    }
  };
}