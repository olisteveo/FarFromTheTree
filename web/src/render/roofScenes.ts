// What people have actually done with their roofs. The kit in buildings.ts is the plant every roof has (tanks, vents,
// bulkheads); these are the lives on top of it: tar beaches, vegetable beds, greenhouses, bars under strung bulbs, caged
// courts, pigeon lofts, helipads, pools, a shack someone built without asking, old neon on steel frames, a green roof, an
// aerial farm, a throw-up the size of the roof only the pigeons can read. Every scene is one recipe run twice: once at
// placement for what's solid (so it's all there to land on), and again as geometry when its chunk comes near.

import * as THREE from "three";
import type { FacadeProp } from "../world/facades";

export type RoofScene = "tarbeach" | "garden" | "greenhouse" | "bar" | "court" | "loft" | "helipad" | "pool" | "shack" | "sign" | "aerials" | "sedum" | "art";

/** How much clear roof each needs: the radius buildings.ts checks is free. */
export const SCENE_NEEDS: Record<RoofScene, number> = { tarbeach: 3.6, garden: 4.6, greenhouse: 4.6, bar: 6.2, court: 9.5, loft: 3.2, helipad: 9, pool: 7.5, shack: 5, sign: 6.5, aerials: 2.6, sedum: 6.5, art: 5.5 };

const hash = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };

/** What this roof has been turned into, if anything: most haven't, and a neighbourhood has its own habits. */
export function pickRoofScene(style: string, district: string, h: number, area: number, r0: number, r1: number): RoofScene | null {
  const lively = district === "chinatown" || district === "littleitaly" || district === "village";
  const weights: [RoofScene, number][] = [];
  const add = (s: RoofScene, w: number) => { if (w > 0) weights.push([s, w]); };
  if (style === "glass" || style === "modern") {
    if (r0 > 0.42) return null;
    add("helipad", h > 70 ? 3 : 0); add("pool", h < 130 ? 2.4 : 0.6); add("bar", 2); add("sedum", 2.2); add("aerials", 1.2);
  } else if (style === "civic") {
    if (r0 > 0.3) return null;
    add("sedum", 2); add("aerials", 2);
  } else {
    if (r0 > (lively ? 0.62 : 0.46)) return null;
    add("tarbeach", h < 60 ? 3.4 : 0.4); add("garden", lively ? 2.8 : 1.6); add("loft", district === "chinatown" || district === "littleitaly" ? 3 : 1.2);
    add("shack", h < 50 ? 1.7 : 0.3); add("greenhouse", district === "village" ? 1.9 : 0.9); add("art", lively ? 2.4 : 1.2); add("aerials", 1);
    add("bar", district === "village" || district === "flatiron" || district === "midtown" ? 2 : 0.8); add("court", area > 500 ? 2 : 0);
    add("sign", h < 70 && (district === "midtown" || district === "chinatown" || district === "flatiron" || district === "columbus") ? 3 : h < 50 ? 0.8 : 0);
    add("pool", style === "prewar" && area > 450 ? 0.7 : 0);
  }
  let t = r1 * weights.reduce((s, w) => s + w[1], 0);
  for (const [s, w] of weights) if ((t -= w) < 0) return s;
  return null;
}

const SIGNS: [string, string, string, string][] = [
  ["HOTEL ROYALE", "#ff4a3a", "#1a0606", "ROOMS"], ["DELMONT", "#ffd24a", "#1a1206", "FINE FURS"], ["PICKLES", "#62e06a", "#06180a", "SINCE 1922"], ["EAT", "#ff5aa8", "#1a0612", "ALL NIGHT"],
  ["BAKING CO", "#ffe9c4", "#1a1208", "BREAD & ROLLS"], ["LAUNDRY", "#58d4ff", "#061218", "WHILE U WAIT"], ["金龍酒家", "#ff4a3a", "#1a0606", "GOLDEN DRAGON"], ["SEAFOOD", "#58ffd8", "#061812", "FRESH DAILY"],
];
const ROOF_ART = ["throw_0", "throw_1", "throw_2", "throw_3", "wild_0", "wild_1", "chrome_0", "chrome_1", "block_0", "block_1", "bubble_0", "bubble_1", "roller_0", "roller_1", "roller_2", "geo_0", "geo_1", "pigeon_1", "tagwall_0"];

function signSheet(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256 * 4;
  const d = c.getContext("2d")!;
  SIGNS.forEach(([word, ink, , sub], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    d.clearRect(x, y, 512, 256);
    d.textAlign = "center"; d.textBaseline = "middle";
    let size = 118;
    do { d.font = `900 ${size}px "Arial Narrow", Impact, Arial, sans-serif`; size -= 4; } while (d.measureText(word).width > 480);
    // a tube's halo, then the tube
    d.shadowColor = ink; d.shadowBlur = 26; d.fillStyle = ink; d.fillText(word, x + 256, y + 100); d.fillText(word, x + 256, y + 100);
    d.shadowBlur = 8; d.fillStyle = "#fff6ea"; d.font = `900 ${size - 4}px "Arial Narrow", Impact, Arial, sans-serif`; d.globalAlpha = 0.55; d.fillText(word, x + 256, y + 100); d.globalAlpha = 1;
    d.shadowBlur = 12; d.font = '700 38px "Arial Narrow", Arial, sans-serif'; d.fillStyle = ink; d.fillText(sub, x + 256, y + 202);
    d.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

class Sink {
  pos: number[][] = [[], [], []]; nor: number[][] = [[], [], []]; col: number[][] = [[], [], []];
  sign: { pos: number[]; uv: number[] } = { pos: [], uv: [] };
  art: { pos: number[]; uv: number[]; nor: number[] } = { pos: [], uv: [], nor: [] };
}
const SOLID = 0, LIT = 1, GLASS = 2;
const tmp = new THREE.Color();

/** A scene's frame on its roof: u across, v along, y up from the roof, all turned by yaw. */
class Frame {
  readonly c: number; readonly s: number;
  constructor(readonly x: number, readonly y: number, readonly z: number, yaw: number, readonly solids: FacadeProp[] | null, readonly sink: Sink | null, readonly art: { size: number; rects: Record<string, { x: number; y: number; w: number; h: number }> } | null) {
    this.c = Math.cos(yaw); this.s = Math.sin(yaw);
  }
  private w(u: number, y: number, v: number): [number, number, number] { return [this.x + u * this.c + v * this.s, this.y + y, this.z - u * this.s + v * this.c]; }
  private quad(m: number, a: number[], b: number[], c: number[], d: number[], col: number) {
    const k = this.sink!; tmp.set(col);
    // (a triangle drawn as a quad has two corners the same: take its normal from the other pair, or a NaN blacks out the frame)
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let f = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    if (Math.hypot(f[0], f[1], f[2]) < 1e-5 || Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]) < 1e-5) f = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]], l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-8) { n = [0, 1, 0]; l = 1; }
    for (const p of [a, b, c, a, c, d]) { k.pos[m].push(p[0], p[1], p[2]); k.nor[m].push(n[0] / l, n[1] / l, n[2] / l); k.col[m].push(tmp.r, tmp.g, tmp.b); }
  }
  solid(u: number, y0: number, v: number, w: number, h: number, d: number, what: string) {
    if (!this.solids) return;
    const [x, y, z] = this.w(u, y0 + h / 2, v);
    this.solids.push({ kind: "solid", x, y, z, tx: this.c, tz: -this.s, nx: this.s, nz: this.c, hw: w / 2, hh: h / 2, hd: d / 2, seed: 0, label: what });
  }
  /** a box, u v its centre, y0 its foot; `what` makes it solid */
  box(u: number, y0: number, v: number, w: number, h: number, d: number, col: number, what?: string, m = SOLID) {
    if (what) this.solid(u, y0, v, w, h, d, what);
    if (!this.sink) return;
    const P = (a: number, b: number, q: number) => this.w(u + (a * w) / 2, y0 + b * h, v + (q * d) / 2);
    const A = P(-1, 0, 1), B = P(1, 0, 1), C = P(1, 1, 1), D = P(-1, 1, 1), E = P(1, 0, -1), F = P(-1, 0, -1), G = P(-1, 1, -1), H = P(1, 1, -1);
    this.quad(m, A, B, C, D, col); this.quad(m, E, F, G, H, col); this.quad(m, F, A, D, G, col); this.quad(m, B, E, H, C, col); this.quad(m, D, C, H, G, col); this.quad(m, F, E, B, A, col);
  }
  /** a flat patch lying on the roof */
  patch(u: number, v: number, w: number, d: number, col: number, y = 0.03, m = SOLID) {
    if (!this.sink) return;
    this.quad(m, this.w(u - w / 2, y, v + d / 2), this.w(u + w / 2, y, v + d / 2), this.w(u + w / 2, y, v - d / 2), this.w(u - w / 2, y, v - d / 2), col);
  }
  /** an upright pane */
  pane(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, col: number, m = GLASS) {
    if (!this.sink) return;
    this.quad(m, this.w(u0, y0, v0), this.w(u1, y0, v1), this.w(u1, y1, v1), this.w(u0, y1, v0), col);
  }
  /** a sloping pane, say half a pitched roof */
  slope(a: number[], b: number[], c: number[], d: number[], col: number, m = SOLID) {
    if (!this.sink) return;
    this.quad(m, this.w(a[0], a[1], a[2]), this.w(b[0], b[1], b[2]), this.w(c[0], c[1], c[2]), this.w(d[0], d[1], d[2]), col);
  }
  cyl(u: number, y0: number, v: number, r0: number, r1: number, h: number, sides: number, col: number, what?: string, m = SOLID) {
    if (what) this.solid(u, y0, v, Math.max(r0, r1) * 1.7, h, Math.max(r0, r1) * 1.7, what);
    if (!this.sink) return;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * 6.2832, b = ((i + 1) / sides) * 6.2832;
      const p = (r: number, q: number, y: number) => this.w(u + Math.sin(q) * r, y, v + Math.cos(q) * r);
      this.quad(m, p(r0, a, y0), p(r0, b, y0), p(r1, b, y0 + h), p(r1, a, y0 + h), col);
      if (r1 > 0.01) this.quad(m, this.w(u, y0 + h, v), p(r1, a, y0 + h), p(r1, b, y0 + h), this.w(u, y0 + h, v), col);
    }
  }
  /** a thin straight member between two points */
  rod(a: number[], b: number[], t: number, col: number, m = SOLID) {
    if (!this.sink) return;
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1, ou = (-dz / L) * t, ov = (dx / L) * t;
    const P = (q: number[], s: number, up: number) => this.w(q[0] + ou * s, q[1] + up, q[2] + ov * s);
    this.quad(m, P(a, -1, -t), P(b, -1, -t), P(b, -1, t), P(a, -1, t), col);
    this.quad(m, P(b, 1, -t), P(a, 1, -t), P(a, 1, t), P(b, 1, t), col);
    this.quad(m, P(a, -1, t), P(b, -1, t), P(b, 1, t), P(a, 1, t), col);
    this.quad(m, P(a, 1, -t), P(b, 1, -t), P(b, -1, -t), P(a, -1, -t), col);
  }
  /** a string of bulbs, sagging between two points */
  bulbs(a: number[], b: number[], n: number, col = 0xffd9a0) {
    if (!this.sink) return;
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const t = i / n, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.45, a[2] + (b[2] - a[2]) * t];
      this.rod(prev, q, 0.012, 0x1a1a1a);
      if (i < n) this.box(q[0], q[1] - 0.14, q[2], 0.1, 0.12, 0.1, col, undefined, LIT);
      prev = q;
    }
  }
  /** art off the wall-art sheet, flat on the roof */
  paint(name: string, u: number, v: number, width: number) {
    const k = this.sink, r = this.art?.rects[name];
    if (!k || !r) return;
    const h = (width * r.h) / r.w, S = this.art!.size;
    const u0 = r.x / S, u1 = (r.x + r.w) / S, v1 = 1 - r.y / S, v0 = 1 - (r.y + r.h) / S;
    const A = this.w(u - width / 2, 0.05, v - h / 2), B = this.w(u + width / 2, 0.05, v - h / 2), C = this.w(u + width / 2, 0.05, v + h / 2), D = this.w(u - width / 2, 0.05, v + h / 2);
    for (const p of [A, B, C, A, C, D]) { k.art.pos.push(...p); k.art.nor.push(0, 1, 0); }
    k.art.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }
  /** one of the neon signs, facing -v */
  neon(i: number, u: number, y0: number, v: number, w: number, h: number) {
    const k = this.sink;
    if (!k) return;
    const col = i % 2, row = Math.floor(i / 2);
    const u0 = col / 2, u1 = u0 + 0.5, v1 = 1 - row / 4, v0 = v1 - 0.25;
    for (const f of [-1, 1]) {
      const a = this.w(u - (f * w) / 2, y0, v + f * -0.04), b = this.w(u + (f * w) / 2, y0, v + f * -0.04), c = this.w(u + (f * w) / 2, y0 + h, v + f * -0.04), d = this.w(u - (f * w) / 2, y0 + h, v + f * -0.04);
      for (const p of [a, b, c, a, c, d]) k.sign.pos.push(...p);
      k.sign.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
  }
}

// ---------------------------------------------------------------- the recipes (half = half the square that's free)

const WOOD = 0x8a6a48, IRON = 0x25272a;

function deckChair(f: Frame, u: number, v: number, col: number) {
  f.box(u, 0.28, v + 0.25, 0.6, 0.05, 1.1, col);
  f.slope([u - 0.3, 0.3, v + 0.8], [u + 0.3, 0.3, v + 0.8], [u + 0.3, 0.8, v + 1.15], [u - 0.3, 0.8, v + 1.15], col);
  for (const a of [-0.28, 0.28]) { f.box(u + a, 0, v - 0.2, 0.04, 0.3, 0.04, IRON); f.box(u + a, 0, v + 0.7, 0.04, 0.3, 0.04, IRON); }
}

function tarbeach(f: Frame, half: number, r: (k: number) => number) {
  // a roll of cheap astroturf or a blanket on the tar, two loungers, the cooler, an umbrella, a kid's paddling pool
  const hue = [0xc8382a, 0x2a5a9a, 0xe0b423, 0x3a8a5a, 0xd27aa2];
  f.patch(0, 0, half * 1.5, half * 1.2, r(1) < 0.5 ? 0x5b8a3c : 0xa0917a);
  deckChair(f, -half * 0.45, -half * 0.25, hue[Math.floor(r(2) * 5)]);
  deckChair(f, half * 0.1, -half * 0.3, hue[Math.floor(r(3) * 5)]);
  f.box(half * 0.48, 0, half * 0.1, 0.7, 0.42, 0.45, 0xd8352e, "a cooler");
  f.box(half * 0.48, 0.42, half * 0.1, 0.72, 0.05, 0.47, 0xf0ece0);
  const ux = -half * 0.1, uz = half * 0.35;
  f.cyl(ux, 0, uz, 0.03, 0.03, 2.2, 5, 0xdedede, "a beach umbrella");
  f.cyl(ux, 1.85, uz, 1.25, 0.04, 0.45, 8, hue[Math.floor(r(4) * 5)]);
  if (r(5) < 0.6) { f.cyl(-half * 0.55, 0, half * 0.45, 0.8, 0.8, 0.26, 12, 0x7fc8e8, "a paddling pool"); f.cyl(-half * 0.55, 0.26, half * 0.45, 0.72, 0.72, 0.01, 12, 0x6ec2d8, undefined, LIT); }
  else { f.box(-half * 0.55, 0, half * 0.45, 0.6, 0.55, 0.45, 0x2a2a2a, "a grill"); f.cyl(-half * 0.55, 0.55, half * 0.45, 0.3, 0.22, 0.2, 8, 0x1a1a1a); }
  // the line with towels on it, off the bulkhead
  f.cyl(half * 0.6, 0, -half * 0.5, 0.03, 0.03, 1.9, 5, 0x888888); f.cyl(-half * 0.1, 0, -half * 0.75, 0.03, 0.03, 1.9, 5, 0x888888);
  f.rod([half * 0.6, 1.85, -half * 0.5], [-half * 0.1, 1.85, -half * 0.75], 0.01, 0xdddddd);
  for (let i = 0; i < 3; i++) { const t = 0.2 + i * 0.28, a = half * 0.6 - t * half * 0.7, b = -half * 0.5 - t * half * 0.25; f.pane(a - 0.25, b, a + 0.25, b, 1.2, 1.82, hue[(i + Math.floor(r(6) * 5)) % 5], SOLID); }
}

function garden(f: Frame, half: number, r: (k: number) => number) {
  // raised beds in rows of old timber, winter-bare stakes and cabbages, tomato cages, barrels, a little shed and a bench
  const cols = half > 5.5 ? 3 : 2, rows = half > 6.5 ? 3 : 2, w = (half * 1.25) / cols, d = (half * 1.3) / rows;
  f.patch(0, 0, half * 1.85, half * 1.85, 0x9a8f7a);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const u = -half * 0.55 + (i + 0.5) * w * 1.1, v = -half * 0.65 + (j + 0.5) * d * 1.15, bw = w * 0.82, bd = d * 0.74;
    f.box(u, 0, v, bw, 0.42, bd, WOOD, "a raised bed");
    f.box(u, 0.42, v, bw - 0.12, 0.02, bd - 0.12, 0x34281c);
    const n = Math.floor(bw * 2);
    for (let k = 0; k < n; k++) for (const o of [-0.25, 0.25]) {
      const a = u - bw * 0.42 + (k + 0.5) * (bw * 0.84) / n, b = v + o * bd, c = r(20 + k * 7 + i + j * 3);
      if (c < 0.4) f.cyl(a, 0.44, b, 0.14, 0.07, 0.14, 6, c < 0.2 ? 0x56703c : 0x6d8048);
      else if (c < 0.7) { f.box(a, 0.44, b, 0.02, 0.9, 0.02, 0x7a6a50); f.box(a + 0.08, 0.72, b, 0.16, 0.012, 0.012, 0x6a5a3a); }
    }
  }
  // the shed at the end
  const su = half * 0.62, sv = half * 0.62;
  f.box(su, 0, sv, 1.3, 1.7, 1.1, 0x5e6f55, "a garden shed");
  f.slope([su - 0.75, 1.7, sv + 0.65], [su + 0.75, 1.7, sv + 0.65], [su + 0.75, 2.05, sv - 0.65], [su - 0.75, 2.05, sv - 0.65], 0x35373a);
  f.cyl(-half * 0.68, 0, half * 0.65, 0.3, 0.34, 0.85, 10, 0x4e3a2a, "a rain barrel");
  f.box(0, 0, half * 0.75, 1.3, 0.42, 0.36, WOOD, "a bench");
}

function greenhouse(f: Frame, half: number) {
  const W = half * 0.95, L = half * 1.25, H = 2.2, R = 3.1, frame = 0xd8dbd6, glass = 0xcfe4e0;
  f.solid(0, 0, 0, W * 2, H, L * 2, "a greenhouse");
  f.box(0, 0, 0, W * 2, 0.3, L * 2, 0xa49a88);
  for (const s of [-1, 1]) {
    f.pane(s * W, -L * s, s * W, L * s, 0.3, H, glass);
    f.slope([s * W, H, -L], [s * W, H, L], [0, R, L], [0, R, -L], glass, GLASS);
    for (let i = -3; i <= 3; i++) { const v = (i / 3) * L; f.box(s * W, 0.3, v, 0.05, H - 0.3, 0.05, frame); f.rod([s * W, H, v], [0, R, v], 0.022, frame); }
  }
  for (const e of [-1, 1]) { f.pane(-W, e * L, W, e * L, 0.3, H, glass); f.slope([-W, H, e * L], [W, H, e * L], [0, R, e * L], [0, R, e * L], glass, GLASS); }
  f.box(0, R - 0.03, 0, 0.06, 0.06, L * 2, frame);
  for (let i = -3; i <= 3; i++) f.cyl((i % 2 ? -1 : 1) * W * 0.55, 0.3, (i / 3.4) * L, 0.2, 0.26, 0.5, 8, 0x47663c);
}

function bar(f: Frame, half: number, r: (k: number) => number) {
  // a timber deck, a pergola of strung bulbs, tall tables, the bar itself, fenced with glass and potted bay trees
  const W = half * 0.95, L = half * 0.95, top = 2.8, wood = 0x8c6a46;
  f.box(0, 0, 0, W * 2, 0.14, L * 2, wood, "a roof deck");
  for (let i = -8; i <= 8; i++) f.patch((i / 8) * W, 0, 0.02, L * 2, 0x5a4530, 0.15);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) f.box(a * W * 0.92, 0.14, b * L * 0.92, 0.1, top, 0.1, IRON, "a pergola post");
  for (const s of [-1, 1]) f.box(s * W * 0.92, top, 0, 0.08, 0.1, L * 1.84, IRON);
  const n = Math.max(3, Math.round(L));
  for (let i = 0; i < n; i++) { const v = -L * 0.92 + ((i + 0.5) * L * 1.84) / n; f.bulbs([-W * 0.92, top - 0.02, v], [W * 0.92, top - 0.02, v], Math.round(W * 2.4)); }
  // the bar, bottles lit behind it
  f.box(0, 0.14, L * 0.72, W * 1.1, 1.05, 0.55, 0x3a2a1e, "a bar");
  f.box(0, 1.19, L * 0.72, W * 1.16, 0.05, 0.62, 0x1c1c1c);
  f.box(0, 1.2, L * 0.9, W * 1.1, 0.8, 0.12, 0x20160e);
  for (let i = 0; i < 9; i++) f.box(-W * 0.45 + (i / 8) * W * 0.9, 1.3, L * 0.86, 0.07, 0.24 + r(70 + i) * 0.1, 0.07, [0xd8a040, 0x60b060, 0xd06040, 0x80a0d0][i % 4], undefined, LIT);
  for (let i = 0; i < Math.round(W); i++) {
    const u = -W * 0.55 + (i / Math.max(1, Math.round(W) - 1)) * W * 1.1, v = -L * 0.35 + (i % 2) * L * 0.42;
    f.cyl(u, 0.14, v, 0.05, 0.05, 1, 6, IRON, "a bar table"); f.cyl(u, 1.14, v, 0.42, 0.42, 0.03, 12, 0xddd8cc);
    f.cyl(u + 0.55, 0.14, v, 0.14, 0.14, 0.72, 8, 0x3a3a3a); f.cyl(u - 0.55, 0.14, v, 0.14, 0.14, 0.72, 8, 0x3a3a3a);
  }
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 0.3], [1, 0.3]]) { f.cyl(a * W * 0.8, 0.14, b * L * 0.8, 0.26, 0.32, 0.5, 8, 0x8a4a30, "a planter"); f.cyl(a * W * 0.8, 0.64, b * L * 0.8, 0.03, 0.03, 0.6, 5, 0x4a3a2a); f.cyl(a * W * 0.8, 1.1, b * L * 0.8, 0.4, 0.05, 0.9, 7, 0x2f4a2a); }
}

function court(f: Frame, half: number) {
  // half a court in chipped green and red, the cage round it, a hoop on a heavy pole, a bench
  const W = half * 0.92, L = half * 0.92, H = 3.8;
  f.patch(0, 0, W * 2, L * 2, 0x396b4e);
  f.patch(0, L * 0.45, W * 1.05, L * 1.1, 0xa84a38, 0.04);
  const line = (u: number, v: number, w: number, d: number) => f.patch(u, v, w, d, 0xece6d4, 0.05);
  line(0, L * 0.97, W * 2, 0.06); line(0, -L * 0.97, W * 2, 0.06); line(W * 0.97, 0, 0.06, L * 2); line(-W * 0.97, 0, 0.06, L * 2);
  line(W * 0.52, L * 0.45, 0.06, L * 1.1); line(-W * 0.52, L * 0.45, 0.06, L * 1.1); line(0, -0.1, W * 1.05, 0.06);
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI, R = W * 0.8; line(Math.cos(a) * R, L * 0.9 - Math.sin(a) * R, 0.28, 0.07); }
  f.cyl(0, 0, L * 0.86, 0.09, 0.09, 3.3, 8, IRON, "a basketball hoop");
  f.box(0, 3.05, L * 0.72, 1.6, 1, 0.05, 0xe6e6e0, "a backboard");
  f.cyl(0, 3.05, L * 0.47, 0.25, 0.25, 0.02, 12, 0xd8532a);
  // the cage: posts and a rail you hit, and chain link you can see through (and can't get through)
  for (const [sx, su, sv, w, d] of [[0, 0, L, W * 2, 0], [0, 0, -L, W * 2, 0], [1, W, 0, 0, L * 2], [1, -W, 0, 0, L * 2]] as const) {
    f.solid(su, 0, sv, Math.max(w, 0.1), H, Math.max(d, 0.1), "a court fence");
    const n = Math.round(Math.max(w, d) / 3);
    for (let i = 0; i <= n; i++) { const t = i / n - 0.5; f.box(su + (sx ? 0 : t * w), 0, sv + (sx ? t * d : 0), 0.07, H, 0.07, IRON); }
    if (sx) f.pane(su, sv - d / 2, su, sv + d / 2, 0, H, 0x8a9096); else f.pane(su - w / 2, sv, su + w / 2, sv, 0, H, 0x8a9096);
    f.box(su, H, sv, Math.max(w, 0.05), 0.06, Math.max(d, 0.05), IRON);
  }
}

function loft(f: Frame, half: number, r: (k: number) => number) {
  // a pigeon fancier's loft: patchwork boards, wire front, landing boards, the long pole with its flag, a chair
  const W = Math.min(half * 0.9, 2.6), D = 1.3, H = 1.9, c = [0x9a8a70, 0x7a8a78, 0x8a5a48, 0xc8c0a8];
  f.box(0, 0.25, -half * 0.2, W * 2, H, D * 2, c[Math.floor(r(1) * 4)], "a pigeon loft");
  f.slope([-W - 0.12, H + 0.25, -half * 0.2 + D + 0.2], [W + 0.12, H + 0.25, -half * 0.2 + D + 0.2], [W + 0.12, H + 0.75, -half * 0.2 - D - 0.2], [-W - 0.12, H + 0.75, -half * 0.2 - D - 0.2], 0x3a3a3c);
  for (let i = 0; i < 5; i++) f.box(-W + 0.45 + i * (W * 2 - 0.9) / 4, 0.25, -half * 0.2 - D - 0.012, (W * 2) / 6, H, 0.02, c[(i + Math.floor(r(2) * 4)) % 4]);
  for (let k = 0; k < 2; k++) { const y = 1 + k * 0.7; f.box(0, y, -half * 0.2 - D - 0.25, W * 1.8, 0.04, 0.5, WOOD); f.pane(-W * 0.9, -half * 0.2 - D - 0.03, W * 0.9, -half * 0.2 - D - 0.03, y + 0.04, y + 0.55, 0x222428, SOLID); }
  f.cyl(W + 0.7, 0, -half * 0.2, 0.03, 0.02, 6.5, 5, 0xbcb09a);
  f.pane(W + 0.7, -half * 0.2, W + 1.4, -half * 0.2, 5.8, 6.3, 0xc8382a, SOLID);
  f.box(-W * 0.6, 0, half * 0.5, 0.45, 0.45, 0.45, 0x6a6a68, "a crate");
  for (let i = 0; i < 5; i++) { const a = r(30 + i) * 6.3, R = 1 + r(40 + i) * half * 0.5; f.box(Math.cos(a) * R, 0.02, half * 0.3 + Math.sin(a) * R * 0.5, 0.16, 0.14, 0.26, 0x8a8f96); }
}

function helipad(f: Frame, half: number) {
  const R = half * 0.86, y = 0.5, H = 0xeeeeea;
  f.solid(0, 0, 0, R * 1.85, y, R * 1.85, "a helipad");
  f.cyl(0, 0, 0, R, R, y, 24, 0x4c4e50);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.2832; f.cyl(Math.sin(a) * R * 0.7, 0, Math.cos(a) * R * 0.7, 0.1, 0.1, y, 6, 0x2a2a2a); }
  f.cyl(0, y + 0.01, 0, R * 0.86, R * 0.86, 0.01, 28, H);
  f.cyl(0, y + 0.02, 0, R * 0.8, R * 0.8, 0.01, 28, 0x4c4e50);
  const w = R * 0.1, s = R * 0.4;
  f.box(-s * 0.7, y + 0.02, 0, w, 0.02, s * 2, 0xe8c030); f.box(s * 0.7, y + 0.02, 0, w, 0.02, s * 2, 0xe8c030); f.box(0, y + 0.02, 0, s * 1.4, 0.02, w, 0xe8c030);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.2832; f.box(Math.sin(a) * R * 0.95, y, Math.cos(a) * R * 0.95, 0.14, 0.12, 0.14, i % 2 ? 0x58ff78 : 0xffe080, undefined, LIT); }
  f.cyl(R * 1.02, 0, 0, 0.04, 0.04, 2.2, 5, 0x6a6a6a); f.cyl(R * 1.02 + 0.28, 1.7, 0, 0.12, 0.28, 0.9, 8, 0xd8652a);
}

function pool(f: Frame, half: number) {
  const W = half * 0.9, L = half * 0.9, stone = 0xcfcabb;
  f.box(0, 0, 0, W * 2, 0.45, L * 2, stone, "a pool deck");
  f.box(0, 0.45, -L * 0.15, W * 1.3, 0.01, L * 1.2, 0x2fb7c8, undefined, LIT);
  f.box(0, 0.452, -L * 0.15, W * 1.36, 0.005, L * 1.26, 0xf0ece0);
  f.box(0, 0.46, -L * 0.15, W * 1.26, 0.01, L * 1.16, 0x35c0d0, undefined, LIT);
  for (let i = 0; i < 3; i++) deckChairAt(f, -W * 0.55 + i * W * 0.55, L * 0.68);
  // the glass round it, on a roof this high
  for (const [a, b, c, d] of [[-W, -L, W, -L], [-W, L, W, L], [-W, -L, -W, L], [W, -L, W, L]]) { f.pane(a, b, c, d, 0.45, 1.6, 0xc4dce4); f.solid((a + c) / 2, 0.45, (b + d) / 2, Math.max(Math.abs(c - a), 0.08), 1.15, Math.max(Math.abs(d - b), 0.08), "pool glass"); }
  f.box(W * 0.68, 0.45, L * 0.6, 1.6, 2.2, 1.3, 0xe0ddd2, "a cabana");
  f.box(W * 0.68, 2.65, L * 0.6, 1.9, 0.12, 1.6, 0x2a2d30);
}
function deckChairAt(f: Frame, u: number, v: number) {
  f.box(u, 0.72, v, 0.62, 0.05, 1.15, 0xf0ece0);
  f.slope([u - 0.31, 0.76, v + 0.45], [u + 0.31, 0.76, v + 0.45], [u + 0.31, 1.2, v + 0.8], [u - 0.31, 1.2, v + 0.8], 0xf0ece0);
  f.box(u, 0.45, v, 0.5, 0.27, 0.9, 0x2a2a2a);
}

function shack(f: Frame, half: number, r: (k: number) => number) {
  // the shack someone built without asking: clapboard, a stovepipe, a lean-to, a picket fence round a patch of real lawn
  const W = Math.min(half * 0.6, 2.8), D = Math.min(half * 0.5, 2.2), H = 2.3, Hr = 1.25, cols = [0xb4503e, 0x4e6f78, 0xe0d8c0, 0x6a8a58, 0xd8b050], col = cols[Math.floor(r(1) * 5)], v0 = half * 0.28;
  f.patch(0, -half * 0.3, half * 1.5, half * 0.95, 0x62803e);
  f.box(0, 0, v0, W * 2, H, D * 2, col, "a rooftop shack");
  for (let y = 0.25; y < H; y += 0.25) { f.box(0, y, v0 - D - 0.01, W * 2.02, 0.02, 0.03, 0x000000); f.box(0, y, v0 + D + 0.01, W * 2.02, 0.02, 0.03, 0x000000); }
  // its pitched roof, gables and all
  for (const s of [-1, 1]) f.slope([s * (W + 0.25), H, v0 - D - 0.2], [s * (W + 0.25), H, v0 + D + 0.2], [0, H + Hr, v0 + D + 0.2], [0, H + Hr, v0 - D - 0.2], 0x3a3634);
  for (const e of [-1, 1]) f.slope([-W, H, v0 + e * D], [W, H, v0 + e * D], [0, H + Hr, v0 + e * D], [0, H + Hr, v0 + e * D], col);
  f.solid(0, H, v0, W * 1.2, Hr, D * 2, "a rooftop shack");
  // a door, a lit window, a stovepipe with its hat
  f.box(-W * 0.4, 0, v0 - D - 0.02, 0.85, 1.95, 0.04, 0x2e3a42);
  f.box(W * 0.45, 0.95, v0 - D - 0.02, 0.95, 0.85, 0.04, 0xffcc80, undefined, LIT);
  f.box(W * 0.45, 0.95, v0 - D - 0.03, 1.04, 0.05, 0.04, 0xf2ece0); f.box(W * 0.45, 1.78, v0 - D - 0.03, 1.04, 0.05, 0.04, 0xf2ece0); f.box(W * 0.45, 1.34, v0 - D - 0.03, 0.04, 0.85, 0.04, 0xf2ece0);
  f.cyl(W * 0.55, H + 0.4, v0 + D * 0.3, 0.09, 0.09, 1.3, 7, 0x2a2a2a); f.cyl(W * 0.55, H + 1.7, v0 + D * 0.3, 0.22, 0.04, 0.16, 7, 0x2a2a2a);
  // the picket fence
  const X = half * 0.75, zf = -half * 0.75;
  for (let u = -X; u <= X; u += 0.34) f.box(u, 0, zf, 0.1, 0.72, 0.03, 0xf2eee0);
  f.box(0, 0.5, zf - 0.02, X * 2, 0.05, 0.03, 0xf2eee0);
  f.solid(0, 0, zf, X * 2, 0.72, 0.1, "a picket fence");
  f.box(-half * 0.3, 0, -half * 0.25, 0.6, 0.42, 0.3, 0xe0d8c0, "a bench");
  f.cyl(half * 0.42, 0, -half * 0.3, 0.11, 0.04, 2.4, 5, 0x5a4a38, "a little tree");
}

function sign(f: Frame, half: number, r: (k: number) => number) {
  // a steel frame up on the roof, tubes and rusting catwalk, and the old neon, facing the avenue
  const i = Math.floor(r(1) * SIGNS.length), W = half * 1.3, H = Math.min(W * 0.48, 5.4), y = 3.2, rust = 0x4e3a30;
  f.solid(0, y, 0, W * 2, H, 0.3, "an old neon sign");
  f.neon(i, 0, y, 0, W * 2, H);
  for (const u of [-W, -W * 0.5, 0, W * 0.5, W]) {
    f.box(u, 0, 0.32, 0.14, y + H, 0.14, rust, "a sign frame");
    f.rod([u, 0, 2.2], [u, y + H * 0.7, 0.32], 0.05, rust);
    f.box(u, 0, 2.2, 0.3, 0.1, 0.3, 0x5a5a58);
  }
  for (const yy of [y, y + H * 0.5, y + H]) f.box(0, yy - 0.05, 0.32, W * 2.06, 0.1, 0.1, rust);
  for (let k = -5; k < 5; k++) { const a = (k / 5) * W, b = ((k + 1) / 5) * W; f.rod([a, k % 2 ? y : y + H, 0.32], [b, k % 2 ? y + H : y, 0.32], 0.03, rust); }
  // the catwalk the electrician uses
  f.box(0, y - 0.12, 0.05, W * 2, 0.04, 0.5, 0x3a3a38);
}

function aerials(f: Frame, half: number, r: (k: number) => number) {
  // everyone's old aerial and a satellite dish or six, the cables and a junction box
  const n = 4 + Math.floor(r(1) * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r(10 + i), R = half * (0.2 + r(20 + i) * 0.6), u = Math.cos(a) * R, v = Math.sin(a) * R, H = 2.4 + r(30 + i) * 4;
    f.cyl(u, 0, v, 0.035, 0.02, H, 5, 0x77797c, "an aerial");
    f.box(u, 0, v, 0.3, 0.06, 0.3, 0x444444);
    for (let k = 0; k < 4 + Math.floor(H); k++) { const w = 1.2 - k * 0.11; if (w > 0) f.box(u, H - 0.25 - k * 0.26, v, w, 0.015, 0.015, 0x8a8c8f); }
    f.rod([u, H * 0.7, v], [u + 0.9, 0, v + 0.9], 0.006, 0x4a4a4a);
  }
  for (let i = 0; i < 3; i++) { const u = -half * 0.5 + i * half * 0.5, v = -half * 0.65; f.cyl(u, 0, v, 0.035, 0.035, 1, 5, 0x555555); f.cyl(u, 1, v, 0.42, 0.04, 0.2, 10, 0xdedcd6, "a satellite dish"); }
  f.box(half * 0.55, 0, half * 0.5, 0.7, 1.1, 0.35, 0x8a8c80, "a junction box");
}

function sedum(f: Frame, half: number) {
  // a green roof: squares of sedum in rust and moss, gravel margins, a boardwalk across it and a beehive or two
  const S = half * 0.95, n = Math.max(2, Math.round(S / 1.5));
  f.patch(0, 0, S * 2, S * 2, 0x9b9486);
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const u = ((i + 0.5) / n) * S, v = ((j + 0.5) / n) * S;
    if (Math.abs(u) < 0.6) continue;
    const q = hash(i * 7 + 13, j * 11 + 5);
    f.patch(u, v, (S / n) * 0.94, (S / n) * 0.94, q < 0.34 ? 0x6e7e3f : q < 0.66 ? 0x89693e : 0x4f6d3b, 0.06);
  }
  f.box(0, 0, 0, 1, 0.08, S * 2, WOOD);
  for (const a of [-0.4, 0.4]) { f.box(a * S, 0, S * 0.8, 0.5, 0.65, 0.42, 0xe8e2d0, "a beehive"); f.box(a * S, 0.65, S * 0.8, 0.56, 0.05, 0.48, 0x777a7c); }
}

function art(f: Frame, half: number, r: (k: number) => number) {
  // sprayed big, for the pigeons and the planes
  f.paint(ROOF_ART[Math.floor(r(1) * ROOF_ART.length)], 0, 0, half * 1.8);
  for (let i = 0; i < 3; i++) { f.cyl(-half * 0.6 + i * 0.55, 0, -half * 0.75, 0.05, 0.05, 0.2, 6, [0xd8352e, 0x2a5a9a, 0xe0b423][i]); }
}

const RECIPES: Record<RoofScene, (f: Frame, half: number, r: (k: number) => number) => void> = { tarbeach, garden, greenhouse: (f, h) => greenhouse(f, h), bar, court: (f, h) => court(f, h), loft, helipad: (f, h) => helipad(f, h), pool: (f, h) => pool(f, h), shack, sign, aerials, sedum: (f, h) => sedum(f, h), art };

interface Placed { kind: RoofScene; x: number; y: number; z: number; yaw: number; half: number; seed: number }
const CHUNK = 240;

export class RoofScenesView {
  readonly root = new THREE.Group();
  readonly counts: Partial<Record<RoofScene, number>> = {};
  readonly list: Placed[] = [];
  private byChunk = new Map<number, Placed[]>();
  private built = new Map<number, THREE.Group>();
  private mats: { solid: THREE.Material; lit: THREE.Material; glass: THREE.Material; sign: THREE.Material; art: THREE.Material } | null = null;
  private atlas: { size: number; rects: Record<string, { x: number; y: number; w: number; h: number }> } | null = null;

  constructor() {
    fetch("./textures/block/wall_art.json").then((r) => r.json()).then((a) => { this.atlas = a; }).catch(() => {});
  }

  private key(x: number, z: number) { return (Math.floor(x / CHUNK) + 4096) * 16384 + (Math.floor(z / CHUNK) + 4096); }

  /** A scene on a roof: what's solid in it goes on `solids` now, its geometry waits till it's near. */
  add(kind: RoofScene, x: number, y: number, z: number, yaw: number, radius: number, seed: number, solids: FacadeProp[]) {
    const half = radius * 0.7, p: Placed = { kind, x, y, z, yaw, half, seed };
    RECIPES[kind](new Frame(x, y, z, yaw, solids, null, null), half, (k) => hash(seed, k));
    const key = this.key(x, z);
    (this.byChunk.get(key) ?? this.byChunk.set(key, []).get(key)!).push(p);
    this.list.push(p);
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }

  private materials() {
    if (this.mats) return this.mats;
    const map = new THREE.TextureLoader().load("./textures/block/wall_art.webp");
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    return (this.mats = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide }),
      lit: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.12, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
      sign: new THREE.MeshBasicMaterial({ map: signSheet(), transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
      art: new THREE.MeshStandardMaterial({ map, transparent: true, opacity: 0.92, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    });
  }

  private build(key: number) {
    const sink = new Sink(), m = this.materials(), g = new THREE.Group();
    for (const p of this.byChunk.get(key) ?? []) RECIPES[p.kind](new Frame(p.x, p.y, p.z, p.yaw, null, sink, this.atlas), p.half, (k) => hash(p.seed, k));
    [m.solid, m.lit, m.glass].forEach((mat, i) => {
      if (!sink.pos[i].length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(sink.pos[i], 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(sink.nor[i], 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(sink.col[i], 3));
      const mesh = new THREE.Mesh(geo, mat);
      if (i === SOLID) { mesh.castShadow = true; mesh.receiveShadow = true; }
      if (i === GLASS) mesh.renderOrder = 2;
      g.add(mesh);
    });
    for (const [part, mat] of [[sink.sign, m.sign], [sink.art, m.art]] as const) {
      if (!part.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(part.pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(part.uv, 2));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      g.add(mesh);
    }
    this.built.set(key, g);
    this.root.add(g);
  }

  /** One chunk a frame, nearest first; freed well behind. */
  update(focus: THREE.Vector3) {
    if (!this.atlas) return;
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    let done = false;
    for (let r = 0; r <= 3 && !done; r++) for (let i = -r; i <= r && !done; i++) for (let j = -r; j <= r && !done; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const k = (cx + i + 4096) * 16384 + (cz + j + 4096);
      if (this.byChunk.has(k) && !this.built.has(k)) { this.build(k); done = true; }
    }
    if (!done) for (const [k, g] of this.built) {
      const ix = Math.floor(k / 16384) - 4096, iz = (k % 16384) - 4096;
      if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) > 5) {
        this.root.remove(g);
        g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        this.built.delete(k);
        break;
      }
    }
  }
}
