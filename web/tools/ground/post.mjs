// Post-process the Tesseract-rendered ground panels into game textures.
//   node post.mjs <work dir> <out dir> <name...>
// For each texture: split albedo | height | rough [| alpha] panels, cross-fade the overlap
// margin so the tile is seamless, derive a tangent-space normal map from the height panel,
// and write  <name>_c.webp  (sRGB colour, alpha = decal/paint coverage when there is one)
// and        <name>_n.webp  (RGB normal, A = roughness).  macro is packed as one RGB mask.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const [work, out, ...names] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

// normal strength (height units per pixel), and how alpha is derived
const CFG = {
  walk_a: { k: 5.0 }, walk_b: { k: 5.0 },
  road_a: { k: 3.5 }, road_b: { k: 3.5 },
  lawn_a: { k: 3.0 }, lawn_b: { k: 4.0 },
  strips: { k: 4.0, alpha: true },
  paint: { k: 2.0, alpha: true, wear: [0.22, 0.36] },
  decals: { k: 4.0, alpha: true },
};

async function panel(file) {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) rgba[i] = data[i] / 255;
  return rgba;
}

/** Cross-fade the margin: O(x) = x < M ? mix(I(x+S), I(x), x/M) : I(x), in x then y. */
function seamless(p, m) {
  const { w, h, mx, my, pw } = m;
  const tmp = new Float32Array(w * (h + my) * 4);
  for (let y = 0; y < h + my; y++) for (let x = 0; x < w; x++) {
    const a = (y * pw + x) * 4, d = (y * w + x) * 4;
    if (x < mx) {
      const b = (y * pw + x + w) * 4, t = smooth(x / mx);
      for (let c = 0; c < 4; c++) tmp[d + c] = p[b + c] * (1 - t) + p[a + c] * t;
    } else for (let c = 0; c < 4; c++) tmp[d + c] = p[a + c];
  }
  const o = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = (y * w + x) * 4, d = a;
    if (y < my) {
      const b = ((y + h) * w + x) * 4, t = smooth(y / my);
      for (let c = 0; c < 4; c++) o[d + c] = tmp[b + c] * (1 - t) + tmp[a + c] * t;
    } else for (let c = 0; c < 4; c++) o[d + c] = tmp[a + c];
  }
  return o;
}
const smooth = (t) => t * t * (3 - 2 * t);
const lum = (p, i) => p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

async function one(name) {
  const m = JSON.parse(fs.readFileSync(path.join(work, `${name}.meta.json`), "utf8"));
  const P = {};
  for (const ch of m.channels) P[ch] = seamless(await panel(path.join(work, `${name}_${ch}.png`)), m);
  const { w, h } = m;
  const n = w * h;

  if (name === "macro") {
    const o = Buffer.alloc(n * 3);
    for (let i = 0; i < n; i++) { o[i * 3] = lum(P.a, i) * 255; o[i * 3 + 1] = lum(P.h, i) * 255; o[i * 3 + 2] = lum(P.r, i) * 255; }
    await sharp(o, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 90 }).toFile(path.join(out, `${name}.webp`));
    return;
  }
  const cfg = CFG[name];
  // colour (+ alpha)
  const c = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) c[i * 4 + k] = Math.round(Math.min(1, P.a[i * 4 + k]) * 255);
    let a = 1;
    if (cfg.alpha) {
      a = lum(P.m, i);
      if (cfg.wear) a = ss(cfg.wear[0], cfg.wear[1], a);
    }
    c[i * 4 + 3] = Math.round(a * 255);
  }
  // normal from height (wrapping where the tile wraps), roughness in alpha
  const H = new Float32Array(n);
  for (let i = 0; i < n; i++) H[i] = lum(P.h, i);
  const wrapX = m.mx > 0, wrapY = m.my > 0;
  const at = (x, y) => {
    x = wrapX ? (x + w) % w : Math.max(0, Math.min(w - 1, x));
    y = wrapY ? (y + h) % h : Math.max(0, Math.min(h - 1, y));
    return H[y * w + x];
  };
  const nb = Buffer.alloc(n * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Sobel
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    // image rows run down, texture v runs up: n = (-dh/du, -dh/dv, 1) = (-gx, +gy, 1)
    let nx = -gx * cfg.k / 8, ny = gy * cfg.k / 8, nz = 1;
    const L = Math.hypot(nx, ny, nz);
    nx /= L; ny /= L; nz /= L;
    const i = y * w + x;
    nb[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
    nb[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    nb[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    nb[i * 4 + 3] = Math.round(Math.max(0.12, Math.min(1, lum(P.r, i))) * 255);
  }
  await sharp(c, { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 86, alphaQuality: cfg.alpha ? 90 : 100, effort: 5, ...(cfg.alpha ? {} : {}) })
    .toFile(path.join(out, `${name}_c.webp`));
  await sharp(nb, { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 90, alphaQuality: 90, effort: 5 })
    .toFile(path.join(out, `${name}_n.webp`));
  // review copies
  await sharp(c, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(work, `${name}_c.png`));
  await sharp(nb, { raw: { width: w, height: h, channels: 4 } }).removeAlpha().png().toFile(path.join(work, `${name}_n.png`));
}

for (const nm of names) {
  await one(nm);
  console.log("post", nm);
}
