// Weathering maps for the building shader (render/buildings.ts). They tile, and are sampled in world metres with a
// per-building offset, so they never line up with the facade tiles or from one building to the next.
//
//   node tools/buildings/wall_wear.mjs
//     -> public/textures/buildings/wear.webp    R rain streaks, G damp and soot blotches, B lime deposits
//     -> public/textures/buildings/grain.webp   RG surface normal, B grit: the close-up detail of old masonry

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/textures/buildings");
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, y, s) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mod = (a, n) => ((a % n) + n) % n;

/** Value noise that wraps every (px, py) lattice cells, which is what makes the maps tile. */
function noise(x, y, px, py, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const at = (a, b) => hash(mod(a, px), mod(b, py), s);
  return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v;
}
function fbm(u, v, fx, fy, s, oct) {
  let a = 0.5, n = 0, t = 0;
  for (let i = 0; i < oct; i++) { n += noise(u * fx, v * fy, fx, fy, s + i) * a; t += a; a *= 0.5; fx *= 2; fy *= 2; }
  return n / t;
}

// ---------------------------------------------------------------- wear
{
  const S = 1024, data = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // streaks: water runs down in narrow lines, wandering a little as it goes, and only where a broader wet patch feeds them
    const wander = (fbm(u, v, 6, 3, 3, 3) - 0.5) * 0.035;
    const lines = fbm(u + wander, v, 72, 3, 11, 4), feed = fbm(u, v, 7, 3, 21, 3);
    const streak = smooth(0.46, 0.72, lines) * smooth(0.36, 0.66, feed);
    // damp and soot: soft-edged blotches with some broken detail in them
    const blotch = smooth(0.42, 0.72, fbm(u, v, 5, 5, 31, 5)) * (0.72 + 0.28 * fbm(u, v, 48, 48, 41, 3));
    // lime: white salts that bloom out of the mortar, in crusty patches
    const lime = smooth(0.55, 0.75, fbm(u, v, 9, 7, 51, 4)) * smooth(0.36, 0.7, fbm(u, v, 90, 90, 61, 3));
    const o = (y * S + x) * 3;
    data[o] = streak * 255; data[o + 1] = blotch * 255; data[o + 2] = lime * 255;
  }
  await sharp(data, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 86 }).toFile(path.join(OUT, "wear.webp"));
}

// ---------------------------------------------------------------- grain
{
  const S = 512, H = new Float32Array(S * S), grit = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const pits = smooth(0.62, 0.8, fbm(u, v, 30, 30, 71, 3));
    H[y * S + x] = fbm(u, v, 20, 20, 81, 5) * 1.4 - pits * 0.55 + hash(x, y, 91) * 0.18;
    grit[y * S + x] = 0.5 + (fbm(u, v, 40, 40, 101, 4) - 0.5) * 0.9 - pits * 0.2 + (hash(x, y, 111) - 0.5) * 0.18;
  }
  const data = Buffer.alloc(S * S * 3);
  const h = (x, y) => H[mod(y, S) * S + mod(x, S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = (h(x - 1, y) - h(x + 1, y)) * 3.2, ny = (h(x, y - 1) - h(x, y + 1)) * 3.2, l = 1 / Math.hypot(nx, ny, 1);
    const o = (y * S + x) * 3;
    data[o] = (nx * l * 0.5 + 0.5) * 255; data[o + 1] = (ny * l * 0.5 + 0.5) * 255; data[o + 2] = Math.max(0, Math.min(1, grit[y * S + x])) * 255;
  }
  await sharp(data, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 90 }).toFile(path.join(OUT, "grain.webp"));
}
console.log("wear + grain written");
