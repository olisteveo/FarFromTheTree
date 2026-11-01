// Tiling detail for the street surfaces (render/groundArt.ts).
//
//   node tools/ground/road_wear.mjs
//     -> public/textures/ground/road_wear.webp   R tar snakes, G utility patches (0.5 is none), B oil and stains (40 m tile)
//     -> public/textures/ground/road_grain.webp  RG normal, B colour: asphalt aggregate at 1.2 m a tile
//     -> public/textures/ground/walk_wear.webp   R gum, G stains, B hairline cracks (18 m tile)

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/textures/ground");
let seed = 4242;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const between = (a, b) => a + rand() * (b - a);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mod = (a, n) => ((a % n) + n) % n;
const hash = (x, y, s) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function noise(x, y, p, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const at = (a, b) => hash(mod(a, p), mod(b, p), s);
  return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v;
}
function fbm(u, v, f, s, oct = 4) { let a = 0.5, n = 0, t = 0; for (let i = 0; i < oct; i++) { n += noise(u * f, v * f, f, s + i) * a; t += a; a *= 0.5; f *= 2; } return n / t; }

/** Stamp a wandering line that wraps, into a float layer. */
function wander(layer, S, x, y, heading, len, width, wob, value) {
  for (let i = 0; i < len; i++) {
    heading += between(-wob, wob);
    x += Math.cos(heading); y += Math.sin(heading);
    const r = Math.ceil(width + 1);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const k = (1 - smooth(width * 0.5, width + 0.8, Math.hypot(dx, dy))) * value;
      const j = mod(Math.round(y) + dy, S) * S + mod(Math.round(x) + dx, S);
      if (k > layer[j]) layer[j] = k;
    }
  }
}

// ---------------------------------------------------------------- road wear
{
  const S = 2048, tar = new Float32Array(S * S), patch = new Float32Array(S * S).fill(0.5), oil = new Float32Array(S * S);
  // tar snakes follow old cracks: mostly long and lazily along the road, with shorter branches
  for (let i = 0; i < 46; i++) {
    const a = rand() < 0.6 ? (rand() < 0.5 ? 0 : Math.PI / 2) + between(-0.3, 0.3) : rand() * 6.28;
    const x = rand() * S, y = rand() * S;
    wander(tar, S, x, y, a, Math.round(between(120, 620)), between(1.6, 3.2), 0.05, between(0.7, 1));
    if (rand() < 0.5) wander(tar, S, x + 40, y, a + 1.1, Math.round(between(60, 200)), 1.4, 0.08, 0.8);
  }
  // utility cuts: rectangles of newer or older asphalt, square to the grid, each with a sealed seam
  for (let i = 0; i < 18; i++) {
    const long = rand() < 0.55, w = long ? between(40, 90) : between(180, 620), h = long ? between(180, 620) : between(40, 90), x0 = rand() * S, y0 = rand() * S, tone = rand() < 0.62 ? between(0.26, 0.42) : between(0.58, 0.68);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = mod(Math.round(y0 + y), S) * S + mod(Math.round(x0 + x), S);
      patch[j] = tone;
      if (x < 3 || y < 3 || x > w - 4 || y > h - 4) tar[j] = Math.max(tar[j], 0.85);
    }
  }
  const data = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, j = y * S + x;
    oil[j] = smooth(0.6, 0.82, fbm(u, v, 14, 11, 4)) * (0.6 + 0.4 * fbm(u, v, 90, 21, 2));
    const o = j * 3;
    data[o] = tar[j] * 255; data[o + 1] = (patch[j] + (fbm(u, v, 110, 31, 2) - 0.5) * 0.05 * (patch[j] === 0.5 ? 0 : 1)) * 255; data[o + 2] = oil[j] * 255;
  }
  await sharp(data, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 86 }).toFile(path.join(OUT, "road_wear.webp"));
}

// ---------------------------------------------------------------- aggregate
{
  const S = 1024, h = new Float32Array(S * S), c = new Float32Array(S * S);
  // stones: packed cells, each its own height and colour, the bitumen dark between them
  const CELLS = 120, cell = S / CELLS;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy);
    let d1 = 9, id = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy, ax = mod(cx, CELLS), ay = mod(cy, CELLS);
      const fx = cx + hash(ax, ay, 1), fy = cy + hash(ax, ay, 2), d = Math.hypot(gx - fx, gy - fy);
      if (d < d1) { d1 = d; id = hash(ax, ay, 3); }
    }
    const stone = 1 - smooth(0.26, 0.62, d1);
    h[y * S + x] = stone * (0.5 + id) + hash(x, y, 5) * 0.06;
    c[y * S + x] = 0.27 + stone * (0.22 + (id > 0.82 ? 0.42 : id * 0.3));
  }
  const data = Buffer.alloc(S * S * 3), H = (x, y) => h[mod(y, S) * S + mod(x, S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = (H(x - 1, y) - H(x + 1, y)) * 1.9, ny = (H(x, y - 1) - H(x, y + 1)) * 1.9, l = 1 / Math.hypot(nx, ny, 1), o = (y * S + x) * 3;
    data[o] = (nx * l * 0.5 + 0.5) * 255; data[o + 1] = (ny * l * 0.5 + 0.5) * 255; data[o + 2] = Math.min(1, c[y * S + x]) * 255;
  }
  await sharp(data, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 88 }).toFile(path.join(OUT, "road_grain.webp"));
}

// ---------------------------------------------------------------- sidewalks
{
  const S = 2048, gum = new Float32Array(S * S), crack = new Float32Array(S * S);
  for (let i = 0; i < 900; i++) {
    const px = rand() * S, py = rand() * S, r = between(1.2, 3.6);
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const k = 1 - smooth(r * 0.6, r + 1, Math.hypot(dx, dy) + (hash(dx, dy, i) - 0.5) * 1.1), j = mod(Math.round(py) + dy, S) * S + mod(Math.round(px) + dx, S);
      if (k > gum[j]) gum[j] = k;
    }
  }
  for (let i = 0; i < 34; i++) wander(crack, S, rand() * S, rand() * S, rand() * 6.28, Math.round(between(60, 340)), 0.8, 0.09, between(0.6, 1));
  const data = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, j = y * S + x, o = j * 3;
    data[o] = gum[j] * 255;
    data[o + 1] = smooth(0.5, 0.78, fbm(u, v, 12, 41, 5)) * 255;
    data[o + 2] = crack[j] * 255;
  }
  await sharp(data, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 86 }).toFile(path.join(OUT, "walk_wear.webp"));
}
console.log("street detail written");
