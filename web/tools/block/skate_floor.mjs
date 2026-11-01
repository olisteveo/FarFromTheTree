// The skate spot's floor, baked for this one slab rather than tiled, so nothing repeats: separately poured panels,
// saw cuts, cracks, wheel wear along the lines people skate, wax by the ledge and rail, skid marks, gum, leaf stains,
// damp along the wall, and faded paint from the wall art sheet (run wall_art.mjs first).
//
//   node tools/block/skate_floor.mjs  -> public/textures/block/skate_floor_{c,n,r}.webp
//
// u runs along world x from SKATE.x0, v along world z from SKATE.z0 (world/heroBlock.ts): keep these in step.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/textures/block");
const METRES = { w: 54, d: 13, x0: -558, z0: 2832 };
const W = 4096, H = Math.round((W * METRES.d) / METRES.w);
const PX = W / METRES.w; // pixels per metre

let seed = 20261101;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const between = (a, b) => a + rand() * (b - a);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, y, s) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy, s) * (1 - u) + hash(ix + 1, iy, s) * u) * (1 - v) + (hash(ix, iy + 1, s) * (1 - u) + hash(ix + 1, iy + 1, s) * u) * v;
}
const fbm = (x, y, s, oct = 4) => { let a = 0.5, n = 0, t = 0; for (let i = 0; i < oct; i++) { n += vnoise(x, y, s + i) * a; t += a; x = x * 2.03 + 3.1; y = y * 2.03 + 7.7; a *= 0.5; } return n / t; };

// height in millimetres-ish, colour as 0..1 multipliers of the concrete tone, roughness 0..1
const height = new Float32Array(W * H), tone = new Float32Array(W * H), rough = new Float32Array(W * H), rubber = new Float32Array(W * H), cut = new Float32Array(W * H);
const at = (x, y) => y * W + x;
const toPx = (mx, mz) => [(mx - METRES.x0) * PX, (mz - METRES.z0) * PX];

// ---------------------------------------------------------------- the pour
const JOINT_X = [], JOINT_Z = [];
for (let x = METRES.x0 + 5.5; x < METRES.x0 + METRES.w - 1; x += between(5.2, 6.6)) JOINT_X.push((x - METRES.x0) * PX);
for (let z = METRES.z0 + 4.2; z < METRES.z0 + METRES.d - 1; z += between(4.1, 4.9)) JOINT_Z.push((z - METRES.z0) * PX);
const panelOf = (list, v) => { let i = 0; while (i < list.length && v > list[i]) i++; return i; };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = panelOf(JOINT_X, x), q = panelOf(JOINT_Z, y), panel = p * 17 + q * 5 + 3;
    const panelTone = 0.95 + hash(p, q, 91) * 0.1;
    // trowel marks run one way per panel: sweeps of slightly different finish
    const angle = hash(p, q, 92) * 3.14, sx = x * Math.cos(angle) + y * Math.sin(angle), sy = -x * Math.sin(angle) + y * Math.cos(angle);
    const trowel = fbm(sx / 240, sy / 28, panel, 3);
    const macro = fbm(x / 420, y / 420, 11, 4), mid = fbm(x / 60, y / 60, 12, 4), fine = fbm(x / 7, y / 7, 13, 3);
    const grit = hash(x, y, 14);
    // aggregate showing through where it's been worn longest
    const worn = smooth(0.55, 0.8, fbm(x / 90, y / 90, 15, 3));
    const pebble = worn * smooth(0.72, 0.9, vnoise(x / 3.3, y / 3.3, 16));
    const speck = hash(x >> 1, y >> 1, 17);
    tone[at(x, y)] = panelTone * (0.88 + macro * 0.14 + (mid - 0.5) * 0.09 + (trowel - 0.5) * 0.07 + (fine - 0.5) * 0.14 + (grit - 0.5) * 0.11) - pebble * 0.13 - (speck > 0.985 ? 0.2 : 0) + (speck < 0.012 ? 0.1 : 0);
    height[at(x, y)] = (mid - 0.5) * 1.6 + (fine - 0.5) * 1.2 + (trowel - 0.5) * 0.9 + (grit - 0.5) * 0.35 + pebble * 0.9;
    rough[at(x, y)] = 0.82 + (fine - 0.5) * 0.15 + worn * -0.05;
  }
}

// ---------------------------------------------------------------- lines cut and broken into it
function groove(px, py, width, depth, dark) {
  const r = Math.ceil(width + 2);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.round(px + dx), y = Math.round(py + dy);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const k = 1 - smooth(width * 0.4, width + 1.2, Math.hypot(dx, dy));
    if (k <= 0) continue;
    const i = at(x, y);
    cut[i] = Math.max(cut[i], k * dark);
    height[i] = Math.min(height[i], -depth * k);
  }
}
for (const x of JOINT_X) for (let y = 0; y < H; y += 1) groove(x + Math.sin(y / 300) * 0.6, y, 0.9, 3.5, 0.46 + fbm(x / 9, y / 40, 80, 2) * 0.22);
for (const y of JOINT_Z) for (let x = 0; x < W; x += 1) groove(x, y + Math.sin(x / 340) * 0.6, 0.9, 3.5, 0.46 + fbm(x / 40, y / 9, 81, 2) * 0.22);
function crack(x, y, heading, len, width) {
  let drift = heading;
  for (let i = 0; i < len; i++) {
    if (rand() < 0.07) heading = drift + between(-0.65, 0.65);
    x += Math.cos(heading) * 1.8; y += Math.sin(heading) * 1.8;
    const fade = Math.min(1, (len - i) / (len * 0.35));
    groove(x, y, Math.max(0.35, width * fade), 2.2, 0.4 * fade);
    if (rand() < 0.002 && width > 0.5) crack(x, y, heading + between(-0.9, 0.9), len * 0.3, width * 0.6);
  }
}
for (let i = 0; i < 9; i++) crack(rand() * W, rand() * H, rand() * 6.28, between(120, 420), between(0.55, 0.9));
// slabs crack from their corners
for (const jx of JOINT_X) for (const jy of JOINT_Z) if (rand() < 0.3) crack(jx, jy, Math.floor(rand() * 4) * 1.57 + 0.78 + between(-0.3, 0.3), between(70, 240), 0.8);

// ---------------------------------------------------------------- the lines people skate
// (the same layout as render/skateSpot.ts: run-ups along the strip, and the ledge and pad take the abuse)
function band(mx0, mz0, mx1, mz1, wideM, amount, shine, seedN) {
  const [ax, ay] = toPx(mx0, mz0), [bx, by] = toPx(mx1, mz1);
  const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L, wide = wideM * PX;
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - wide)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + wide));
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - wide)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + wide));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const rx = x - ax, ry = y - ay, t = rx * ux + ry * uy;
    if (t < -wide || t > L + wide) continue;
    const off = Math.abs(-rx * uy + ry * ux), ends = smooth(-wide, wide * 0.6, t) * (1 - smooth(L - wide * 0.6, L + wide, t));
    const k = (1 - smooth(0, wide, off)) * ends * (0.35 + 0.65 * fbm(x / 110, y / 14, seedN, 4));
    const i = at(x, y);
    rubber[i] = Math.max(rubber[i], k * amount);
    rough[i] -= k * shine;
  }
}
band(-552, 2836.8, -510, 2836.8, 2.6, 0.17, 0.1, 40);
band(-552, 2840.6, -512, 2840, 2.0, 0.11, 0.07, 41);
band(-524, 2841.1, -516, 2841.3, 1.0, 0.4, 0.36, 42);  // the waxed ledge's approach
band(-547, 2837.9, -540, 2837.9, 0.8, 0.28, 0.26, 43); // the rail
band(-537.5, 2834.5, -528.5, 2834.5, 0.7, 0.2, 0.2, 44);
band(-537.5, 2837.6, -528.5, 2837.6, 0.7, 0.2, 0.2, 45);
// the urethane left behind: faint dark skids, mostly along the run, soft at both ends
for (let i = 0; i < 130; i++) {
  const nearLedge = rand() < 0.3;
  let x = nearLedge ? between(-526, -514) : between(-554, -508), z = nearLedge ? between(2840, 2842) : between(2833.2, 2843.8);
  let a = between(-0.14, 0.14) + (rand() < 0.5 ? 0 : Math.PI);
  const len = Math.round(between(0.5, 2.4) * PX), dark = between(0.1, 0.32), w = between(0.9, 1.7), curve = between(-0.0012, 0.0012);
  for (let k = 0; k < len; k++) {
    a += curve;
    x += Math.cos(a) / PX; z += Math.sin(a) / PX;
    const [px, py] = toPx(x, z), fade = Math.sin((k / len) * Math.PI) * (0.5 + 0.5 * vnoise(k / 22, i, 60));
    for (let dy = -2; dy <= 2; dy++) {
      const Y = Math.round(py + dy), X = Math.round(px);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const j = at(X, Y);
      rubber[j] = Math.max(rubber[j], dark * fade * (1 - smooth(w * 0.3, w + 0.7, Math.abs(py + dy - Y + dy))));
    }
  }
}

// ---------------------------------------------------------------- what gets dropped on it
function blot(px, py, r, d, shine, seedN, wob = 0.5) {
  const R = Math.ceil(r * 1.6);
  for (let y = Math.max(0, Math.floor(py - R)); y < Math.min(H, py + R); y++) for (let x = Math.max(0, Math.floor(px - R)); x < Math.min(W, px + R); x++) {
    const dist = Math.hypot(x - px, y - py) / r + (fbm(x / (r * 0.5 + 2), y / (r * 0.5 + 2), seedN, 3) - 0.5) * wob * 2;
    const k = 1 - smooth(0.55, 1, dist);
    if (k <= 0) continue;
    const i = at(x, y);
    tone[i] *= 1 - d * k;
    rough[i] -= shine * k;
  }
}
for (let i = 0; i < 340; i++) blot(rand() * W, rand() * H, between(0.9, 2.4), between(0.4, 0.72), 0.05, 200 + i, 0.25); // gum
for (let i = 0; i < 9; i++) blot(rand() * W, rand() * H, between(30, 100), between(0.05, 0.13), 0.12, 300 + i, 0.9);       // oil, soda, who knows
// the leaves that lay here all November left their tannin behind
const leafStain = new Float32Array(W * H);
for (let i = 0; i < 46; i++) {
  const px = rand() * W, py = rand() * H, r = between(7, 15), a = rand() * 6.28, fade = between(0.05, 0.15);
  for (let y = Math.max(0, Math.floor(py - r * 1.5)); y < Math.min(H, py + r * 1.5); y++) for (let x = Math.max(0, Math.floor(px - r * 1.5)); x < Math.min(W, px + r * 1.5); x++) {
    const rx = (x - px) * Math.cos(a) + (y - py) * Math.sin(a), ry = -(x - px) * Math.sin(a) + (y - py) * Math.cos(a);
    const d = Math.hypot(rx / 1.4, ry) / r + (fbm(x / 5, y / 5, 500 + i, 2) - 0.5) * 0.5;
    const k = 1 - smooth(0.5, 1, d);
    if (k > 0) leafStain[at(x, y)] = Math.max(leafStain[at(x, y)], k * fade);
  }
}
// damp along the foot of the wall, where the sun doesn't reach
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fromWall = METRES.d - y / PX - 0.4;
  const damp = (1 - smooth(0, 2.6, fromWall)) * smooth(0.3, 0.68, fbm(x / 130, y / 34, 70, 4));
  const i = at(x, y);
  tone[i] *= 1 - damp * 0.2;
  rough[i] -= damp * 0.3;
}

// ---------------------------------------------------------------- bake
const colour = Buffer.alloc(W * H * 3), normalMap = Buffer.alloc(W * H * 3), roughMap = Buffer.alloc(W * H * 3);
const CONCRETE = [0.655, 0.628, 0.58], RUBBER = [0.2, 0.19, 0.185], TANNIN = [0.26, 0.15, 0.08];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = at(x, y), t = Math.max(0, tone[i]) * (1 - cut[i]);
  let r = CONCRETE[0] * t, g = CONCRETE[1] * t, b = CONCRETE[2] * t;
  const ru = Math.min(1, rubber[i]);
  r += (RUBBER[0] - r) * ru; g += (RUBBER[1] - g) * ru; b += (RUBBER[2] - b) * ru;
  const ls = leafStain[i];
  r += (TANNIN[0] - r) * ls; g += (TANNIN[1] - g) * ls; b += (TANNIN[2] - b) * ls;
  const o = i * 3;
  colour[o] = Math.min(255, r * 255); colour[o + 1] = Math.min(255, g * 255); colour[o + 2] = Math.min(255, b * 255);
  const hl = height[at(Math.max(0, x - 1), y)], hr = height[at(Math.min(W - 1, x + 1), y)], hu = height[at(x, Math.max(0, y - 1))], hd = height[at(x, Math.min(H - 1, y + 1))];
  const nx = (hl - hr) * 0.42, ny = (hu - hd) * 0.42, nl = 1 / Math.hypot(nx, ny, 1);
  normalMap[o] = (nx * nl * 0.5 + 0.5) * 255; normalMap[o + 1] = (ny * nl * 0.5 + 0.5) * 255; normalMap[o + 2] = (nl * 0.5 + 0.5) * 255;
  const rv = Math.max(0.18, Math.min(1, rough[i])) * 255;
  roughMap[o] = rv; roughMap[o + 1] = rv; roughMap[o + 2] = 0; // G roughness, B metalness
}

// old paint on the ground, from the wall art sheet: skated over, so well faded
const art = JSON.parse(fs.readFileSync(path.join(OUT, "wall_art.json"), "utf8"));
const sheet = await sharp(path.join(OUT, "wall_art.webp")).ensureAlpha().toBuffer();
const paints = [
  ["throw_2", -534, 2841.6, 4.6, 0.62, -6], ["tag_1", -519, 2834.4, 3, 0.7, 9], ["leaf_0", -547, 2842.6, 1.5, 0.75, 24], ["wild_1", -549.5, 2834.6, 4.8, 0.5, 174],
  ["tag_2", -528, 2843.2, 2.6, 0.65, -14], ["cat_1", -511, 2842.6, 0.9, 0.8, 0], ["tag_4", -541, 2833.7, 2.4, 0.55, 4], ["slaps_1", -538.4, 2843.5, 0.7, 0.8, 0],
];
const layers = [];
for (const [name, mx, mz, wm, op, turn] of paints) {
  const r = art.rects[name];
  const pw = Math.round(wm * PX), ph = Math.round((pw * r.h) / r.w);
  const piece = await sharp(sheet).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).resize(pw, ph).rotate(turn, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = piece;
  // worn away along the same wheel lines: paint survives where the skating doesn't go
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const [gx, gy] = toPx(mx, mz);
    const X = Math.round(gx - info.width / 2 + x), Y = Math.round(gy - info.height / 2 + y);
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    data[(y * info.width + x) * info.channels + 3] = data[(y * info.width + x) * info.channels + 3] * op * (1 - Math.min(1, rubber[at(X, Y)] * 1.3)) * smooth(0.28, 0.6, fbm(X / 24, Y / 9, 900, 3));
  }
  const [gx, gy] = toPx(mx, mz);
  layers.push({ input: data, raw: { width: info.width, height: info.height, channels: info.channels }, left: Math.max(0, Math.round(gx - info.width / 2)), top: Math.max(0, Math.round(gy - info.height / 2)) });
}
await sharp(colour, { raw: { width: W, height: H, channels: 3 } }).composite(layers).webp({ quality: 86 }).toFile(path.join(OUT, "skate_floor_c.webp"));
await sharp(normalMap, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 88 }).toFile(path.join(OUT, "skate_floor_n.webp"));
await sharp(roughMap, { raw: { width: W, height: H, channels: 3 } }).resize(2048).webp({ quality: 80 }).toFile(path.join(OUT, "skate_floor_r.webp"));
for (const f of ["c", "n", "r"]) console.log(f, Math.round(fs.statSync(path.join(OUT, `skate_floor_${f}.webp`)).size / 1024), "KB");
