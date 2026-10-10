// Post-process the Tesseract-rendered facade panels into the texture-array layers.
//   node post.mjs <work dir> <out dir> <name...>
// For each layer: lays the procedural wall (brick bonds / ashlar) under the designed features
// where the mask's G channel says so, packs the mask into albedo alpha, derives a normal map
// from the height panel and writes
//   <name>_c.webp  1024^2 sRGB colour; alpha 255 clear glass, 200 covered glass, 160 untinted
//                  trim, 128 tinted wall (never below 128: canvas decoding premultiplies)
//   <name>_n.webp  512^2  RG = tangent-space normal xy, B = roughness (z is rebuilt in the shader)
// plus review PNGs in the work dir and a contact sheet in previews/.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const [work, out, ...names] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const N = 1024, NN = 512;
const RELIEF = 0.3; // metres of relief per unit of height grey

async function panel(file) {
  const { data, info } = await sharp(file).removeAlpha().resize(N, N, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const f = new Float32Array(N * N * 3);
  for (let i = 0; i < f.length; i++) f[i] = data[i] / 255;
  void info;
  return f;
}

// ------------------------------------------------------------------ hashing
const hash = (a, b, c = 0) => {
  let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; x = Math.imul(x, 0x297a2d39) >>> 0; x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ procedural walls
/** Returns a sampler (u, v metres) -> { r, g, b, h, mortar } for the wall material. */
function wallSampler(wall, W, H) {
  if (wall.kind === "brick") {
    const vary = wall.vary ?? 0.12, painted = !!wall.painted;
    const ch = H / (2 * Math.round(H / 0.0677 / 2));             // course height (even count)
    const bond = wall.bond ?? "running";
    const mj = 0.0095;                                             // mortar joint
    let bw;
    if (bond === "flemish") bw = W / (1.5 * Math.round(W / (1.5 * 0.2032)));
    else bw = W / Math.round(W / 0.2032);
    const courses = Math.round(H / ch);
    return (u, v) => {
      const k = Math.floor(v / ch);
      const fy = v - k * ch;
      let id, fx, len;
      if (bond === "flemish") {
        const unit = 1.5 * bw;
        const p = (((u + (k % 2) * 0.75 * bw) % unit) + unit) % unit;
        const seg = Math.floor((u + (k % 2) * 0.75 * bw) / unit);
        if (p < bw) { fx = p; len = bw; id = seg * 2; } else { fx = p - bw; len = bw / 2; id = seg * 2 + 1; }
      } else if (bond === "common" && k % 6 === 0) {
        len = bw / 2;
        const p = u + (k % 12 === 0 ? 0 : bw / 4);
        id = Math.floor(p / len); fx = p - id * len;
      } else {
        len = bw;
        const p = u + (k % 2) * bw * 0.5;
        id = Math.floor(p / len); fx = p - id * len;
      }
      const nId = Math.round(W / len) || 1;
      id = ((id % nId) + nId) % nId;
      const kk = ((k % courses) + courses) % courses;
      const header = len < bw * 0.75;
      const edge = Math.min(fx, len - fx, fy, ch - fy);
      const mortar = edge < mj / 2;
      const r0 = hash(id, kk, 1), r1 = hash(id, kk, 2), r2 = hash(id, kk, 3);
      let l = 1 + (r0 - 0.5) * 2 * vary;
      if (!painted && r1 < 0.05) l *= 0.72;                         // a burnt clinker
      if (!painted && r1 > 0.96) l *= 1.12;
      if (header && bond === "flemish") l *= 0.84;                  // darker glazed headers
      const warm = painted ? 0 : (r2 - 0.5) * vary * 0.6;
      // a little texture across each brick face and a soft arris
      const grain = (hash(Math.floor(u * 400), Math.floor(v * 400), 7) - 0.5) * 0.06;
      const bevel = smooth(0, mj * 1.2, edge - mj / 2);
      if (mortar) {
        const m = wall.mortar ?? [0.8, 0.78, 0.74];
        if (painted) return { r: 0.9 * l, g: 0.9 * l, b: 0.9 * l, h: 0.44, mortar: false };
        return { r: m[0] + grain, g: m[1] + grain, b: m[2] + grain, h: 0.43, mortar: true };
      }
      const L = l * (0.97 + grain) * (0.9 + 0.1 * bevel);
      return { r: L * (1 + warm), g: L, b: L * (1 - warm), h: 0.47 + 0.05 * bevel + (r0 - 0.5) * 0.03, mortar: false };
    };
  }
  if (wall.kind === "stone") {
    const vary = wall.vary ?? 0.05;
    const ch = H / Math.round(H / (wall.course ?? 0.6));
    const courses = Math.round(H / ch);
    // per course: joints at random positions that wrap
    const rows = [];
    for (let k = 0; k < courses; k++) {
      const n = Math.max(2, Math.round(W / (wall.block ?? 1.4)));
      const cuts = [];
      const off = hash(k, 99) * W;
      for (let i = 0; i < n; i++) cuts.push((off + (i + 0.3 + hash(k, i) * 0.4) * (W / n)) % W);
      cuts.sort((a, b) => a - b);
      rows.push(cuts);
    }
    const mj = 0.007;
    return (u, v) => {
      const k = ((Math.floor(v / ch) % courses) + courses) % courses;
      const fy = v - Math.floor(v / ch) * ch;
      const cuts = rows[k];
      let id = 0, dx = Infinity;
      for (let i = 0; i < cuts.length; i++) { dx = Math.min(dx, Math.abs(u - cuts[i]), W - Math.abs(u - cuts[i])); if (u >= cuts[i]) id = i + 1; }
      const edge = Math.min(dx, fy, ch - fy);
      const r0 = hash(id % cuts.length, k, 5);
      const grain = (hash(Math.floor(u * 300), Math.floor(v * 300), 9) - 0.5) * 0.05;
      if (edge < mj) return { r: 0.72, g: 0.70, b: 0.66, h: 0.44, mortar: false };
      const l = (1 + (r0 - 0.5) * 2 * vary) * (0.98 + grain);
      return { r: l, g: l * 0.995, b: l * 0.98, h: 0.5 + 0.03 * smooth(0, 0.02, edge - mj), mortar: false };
    };
  }
  return null;
}

// ------------------------------------------------------------------ one layer
async function one(name) {
  const m = JSON.parse(fs.readFileSync(path.join(work, `${name}.meta.json`), "utf8"));
  const A = await panel(path.join(work, `${name}_a.png`));
  const Hh = await panel(path.join(work, `${name}_h.png`));
  const R = await panel(path.join(work, `${name}_r.png`));
  const M = await panel(path.join(work, `${name}_m.png`));
  const W = m.W, H = m.H;
  const wall = wallSampler(m.wall, W, H);
  const base = 0.8;
  const col = Buffer.alloc(N * N * 4);
  const height = new Float32Array(N * N);
  const rough = new Float32Array(N * N);
  // supersample the procedural wall 2x2 so mortar lines anti-alias
  const ss = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, i3 = i * 3;
    let r = A[i3], g = A[i3 + 1], b = A[i3 + 2];
    let h = Hh[i3];
    let ro = R[i3];
    const glass = M[i3], procedural = M[i3 + 1], tintOnly = M[i3 + 2];
    let alpha;
    let mortarFrac = 0;
    if (wall && procedural > 0.5 && glass < 0.25) {
      let wr = 0, wg = 0, wb = 0, wh = 0;
      for (const [ox, oy] of ss) {
        const s = wall(((x + ox) / N) * W, ((y + oy) / N) * H);
        const k = s.mortar ? 0.74 : base;   // brick faces are painted at the neutral base (tinted later); old mortar is dirty
        wr += s.r * k; wg += s.g * k; wb += s.b * k; wh += s.h; if (s.mortar) mortarFrac += 0.25;
      }
      // the designed panel carries grime, streaks and soot over the wall: apply it as a multiplier
      r = Math.min(1, (wr / 4) * (r / base)); g = Math.min(1, (wg / 4) * (g / base)); b = Math.min(1, (wb / 4) * (b / base));
      h = h + (wh / 4 - 0.5);
      ro = Math.min(1, ro + mortarFrac * 0.08);
    }
    // glass is a flat pane: no relief noise, or the reflections sparkle
    if (glass > 0.25) h = glass > 0.75 ? 0.22 : 0.24;
    if (glass > 0.75) alpha = 255;
    else if (glass > 0.25) alpha = 200;
    else if (procedural > 0.5) alpha = mortarFrac < 0.5 ? 128 : 144;   // mortar takes half the building's tint
    else if (tintOnly > 0.5) alpha = 128;
    else alpha = 160;
    col[i * 4] = Math.round(Math.max(0, Math.min(1, r)) * 255);
    col[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
    col[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
    col[i * 4 + 3] = alpha;
    height[i] = h;
    rough[i] = Math.max(0.04, Math.min(1, ro));
  }
  // normals: Sobel in metres (texels are not square), wrapping both ways
  const mx = W / N, my = H / N;
  const at = (x, y) => height[((y + N) % N) * N + ((x + N) % N)];
  const nrm = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    // dh/du (metres per metre); image rows run down while v runs up
    let nx = -(gx / 8) * RELIEF / mx, ny = (gy / 8) * RELIEF / my, nz = 1;
    const L = Math.hypot(nx, ny, nz);
    nx /= L; ny /= L;
    const i = y * N + x;
    nrm[i * 3] = Math.round((nx * 0.5 + 0.5) * 255);
    nrm[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    nrm[i * 3 + 2] = Math.round(rough[i] * 255);
  }
  await sharp(col, { raw: { width: N, height: N, channels: 4 } }).webp({ quality: 84, alphaQuality: 100, effort: 5, smartSubsample: true })
    .toFile(path.join(out, `${name}_c.webp`));
  await sharp(nrm, { raw: { width: N, height: N, channels: 3 } }).resize(NN, NN, { kernel: "lanczos3" }).webp({ quality: 88, effort: 5 })
    .toFile(path.join(out, `${name}_n.webp`));
  // review copies
  await sharp(col, { raw: { width: N, height: N, channels: 4 } }).removeAlpha().png().toFile(path.join(work, `${name}_col.png`));
  return name;
}

for (const nm of names) {
  await one(nm);
  console.log("post", nm);
}

// contact sheet of every layer's colour (4 across)
const all = fs.readdirSync(work).filter((f) => f.endsWith("_col.png")).sort();
if (all.length) {
  const T = 256, cols = 6, rows = Math.ceil(all.length / cols);
  const tiles = await Promise.all(all.map((f) => sharp(path.join(work, f)).resize(T, T).png().toBuffer()));
  const sheet = sharp({ create: { width: cols * T, height: rows * (T + 0), channels: 3, background: { r: 30, g: 30, b: 30 } } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * T, top: Math.floor(i / cols) * T })));
  const prev = path.join(path.dirname(work), "previews");
  fs.mkdirSync(prev, { recursive: true });
  await sheet.jpeg({ quality: 84 }).toFile(path.join(prev, "facade_sheet.jpg"));
}
