// Facade textures: Tesseract-designed layers (tools/buildings/facade_design.py, built by
// build_buildings.py into public/textures/buildings/) packed into two texture arrays:
//   albedo  RGB colour, A = what the pixel is: 255 clear glass (the shader puts a room behind it),
//           200 covered glass (blinds, curtains, shop displays), 160 untinted trim (stone, iron,
//           frames, signs, mortar), 128 tinted wall (brick / stone / paint coloured per building)
//   normal  RG = tangent-space normal xy, B = roughness (half resolution)
// Each layer is a whole number of bays wide and floors tall, so window centres stay on the bay
// centres world/facades.ts uses for AC units, cats and balconies.
//
// The arrays start as flat placeholders (so the city can be built straight away) and fill in
// as the layer images arrive.

import * as THREE from "three";
import type { Style } from "../world/data";

/** Real-world bay width and floor height per style. world/facades.ts places props by these: don't change them. */
export interface StyleTile { bays: number; floors: number; bayW: number; floorH: number }
export const TILES: Record<Style, StyleTile> = {
  tenement: { bays: 4, floors: 4, bayW: 2.6, floorH: 3.2 },
  castiron: { bays: 3, floors: 3, bayW: 3.7, floorH: 4.3 },
  prewar: { bays: 4, floors: 4, bayW: 3.0, floorH: 3.4 },
  deco: { bays: 3, floors: 4, bayW: 3.2, floorH: 3.7 },
  modern: { bays: 6, floors: 4, bayW: 1.6, floorH: 3.7 },
  glass: { bays: 6, floors: 3, bayW: 1.5, floorH: 4.0 },
  brick: { bays: 4, floors: 4, bayW: 2.8, floorH: 2.95 },
  civic: { bays: 3, floors: 3, bayW: 3.6, floorH: 4.6 },
};

export const STOREFRONTS = ["generic", "chinatown", "soho", "midtown", "lobby", "residential"] as const;
export type Storefront = (typeof STOREFRONTS)[number];
export const SHOP_W = 9;    // metres per storefront layer: two 4.5 m shops
export const SHOP_H = 4.6;

export interface FacadeLayer { name: string; W: number; H: number; bays: number; floors: number }

const L: FacadeLayer[] = [];
const add = (name: string, W: number, H: number, bays: number, floors: number) => { L.push({ name, W, H, bays, floors }); return L.length - 1; };
const styleLayers = (st: Style, variants: string) => [...variants].map((v) => add(`${st}_${v}`, TILES[st].bays * TILES[st].bayW, TILES[st].floors * TILES[st].floorH, TILES[st].bays, TILES[st].floors));

/** Wall layers per style (a building picks one by its seed). Order matches facade_design.all_layers(). */
export const STYLE_LAYERS: Record<Style, number[]> = {
  tenement: styleLayers("tenement", "abcd"),
  castiron: styleLayers("castiron", "abc"),
  prewar: styleLayers("prewar", "abc"),
  deco: styleLayers("deco", "ab"),
  modern: styleLayers("modern", "ab"),
  glass: styleLayers("glass", "abc"),
  brick: styleLayers("brick", "ab"),
  civic: styleLayers("civic", "a"),
};
const SHOP_COUNT: Record<Storefront, number> = { generic: 3, chinatown: 2, soho: 2, midtown: 2, lobby: 2, residential: 1 };
/** Storefront layers per kind: consecutive, [first, count]. */
export const SHOP_LAYERS = Object.fromEntries(STOREFRONTS.map((k) => {
  const first = L.length;
  for (let i = 0; i < SHOP_COUNT[k]; i++) add(`shop_${k}_${i}`, SHOP_W, SHOP_H, 2, 1);
  return [k, [first, SHOP_COUNT[k]]];
})) as Record<Storefront, [number, number]>;
export const ROOF_LAYERS = { tar: add("roof_tar", 8, 8, 1, 1), gravel: add("roof_gravel", 8, 8, 1, 1), membrane: add("roof_membrane", 8, 8, 1, 1) };
export const PARTY_LAYERS = { brick: add("party_brick", 12, 12, 4, 4), parge: add("party_parge", 12, 12, 4, 4) };
export const FACADE_LAYERS: readonly FacadeLayer[] = L;
export const LAYERS = L.length;

/** Per-style wall tints (multiplied into the light neutral wall; trim and glass are never tinted). */
export const TINTS: Record<Style, string[]> = {
  tenement: ["#b5523b", "#a34a36", "#8f3f30", "#c26a4a", "#9a5a42", "#7d4434", "#d8c7a8", "#a8a8a0", "#c9a882", "#6e5446", "#b8664c", "#94503c"],
  castiron: ["#ffffff", "#f4ecdc", "#e2dccf", "#d7d9d6", "#c8ccc6", "#efe2c4", "#b9bdb8", "#5c6b5e", "#4a4d52", "#7a8a8c"],
  prewar: ["#f2e6cf", "#e2cfae", "#d8bf98", "#c9a77e", "#efe9de", "#bfa58a", "#b07a5a", "#a3634a"],
  deco: ["#f2e8d5", "#e5d5b5", "#d9c7a3", "#cdbfa8", "#e8dcc6"],
  modern: ["#ffffff", "#e8ecec", "#d8dcd8", "#c4cbd0", "#e8e0d0", "#b8a48e"],
  glass: ["#ffffff", "#e6f0f2", "#dde8e2", "#e6e6f0", "#d0dde6"],
  brick: ["#c9a07e", "#b78463", "#a87456", "#d6b896", "#9c6a50", "#c2a68a", "#e8e2d6"],
  civic: ["#ffffff", "#f4efe2", "#ebe4d4"],
};

// ------------------------------------------------------------------ quality

export type FacadeQuality = "low" | "medium" | "high";

/** The same choice main.ts pickQuality makes (URL ?q=, else the GPU), so this module needs no wiring. */
export function detectQuality(): FacadeQuality {
  const q = new URLSearchParams(location.search).get("q");
  if (q === "low" || q === "medium" || q === "high") return q;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const r = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (/Intel|UHD|Iris|Mali|Adreno|Apple M1/i.test(r)) return "medium";
  } catch { /* fall through */ }
  return "high";
}

// ------------------------------------------------------------------ the arrays

export interface FacadeTextures {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  quality: FacadeQuality;
  /** resolves when every layer is in (or failed: the placeholders stay) */
  ready: Promise<void>;
  groundH: (st: Style) => number;
  /** called when albedo / normal are replaced (the materials re-point at them) */
  onSwap?: () => void;
}

/** A neutral stand-in per layer until the real images arrive: wall colour, a hint of glass. */
function placeholder(size: number, srgb: boolean, normal: boolean): THREE.DataArrayTexture {
  const data = new Uint8Array(size * size * 4 * LAYERS);
  for (let l = 0; l < LAYERS; l++) {
    for (let i = 0; i < size * size; i++) {
      const o = (l * size * size + i) * 4;
      if (normal) { data[o] = 128; data[o + 1] = 128; data[o + 2] = 220; data[o + 3] = 255; }
      else { data[o] = 200; data[o + 1] = 198; data[o + 2] = 192; data[o + 3] = 128; }
    }
  }
  const t = new THREE.DataArrayTexture(data, size, size, LAYERS);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeArray(size: number, srgb: boolean): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint8Array(size * size * 4 * LAYERS), size, size, LAYERS);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function decode(url: string, size: number): Promise<Uint8ClampedArray> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none", resizeWidth: size, resizeHeight: size, resizeQuality: "high" });
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const c = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  c.clearRect(0, 0, size, size);
  c.drawImage(bmp, 0, 0);
  bmp.close();
  return c.getImageData(0, 0, size, size).data;
}

/** opts.base: folder holding textures/ (default: next to the page, or the site root from the tools/ test pages). */
export function buildFacadeTextures(opts: { base?: string; quality?: FacadeQuality } = {}): FacadeTextures {
  const quality = opts.quality ?? detectQuality();
  const base = opts.base ?? (location.pathname.includes("/tools/") ? "/" : "./");
  const AS = quality === "low" ? 512 : 1024, NS = quality === "low" ? 256 : 512;
  const tex: FacadeTextures = {
    albedo: placeholder(4, true, false),
    normal: placeholder(4, false, true),
    quality,
    ready: Promise.resolve(),
    groundH: (st) => (st === "castiron" ? 4.6 : st === "glass" || st === "modern" ? 5.5 : 4.4),
  };
  tex.ready = (async () => {
    // the full arrays from the start, every layer the neutral stand-in; each style's real images
    // drop in as soon as they're decoded (off the main thread where the browser can), so the
    // city fills in a style at a time instead of all at once at the end
    const albedo = makeArray(AS, true), normal = makeArray(NS, false);
    new Uint32Array((albedo.image.data as Uint8Array).buffer).fill(0x80c0c6c8); // r 200, g 198, b 192, a 128
    new Uint32Array((normal.image.data as Uint8Array).buffer).fill(0xffdc8080); // 128, 128, 220, 255
    albedo.needsUpdate = normal.needsUpdate = true;
    tex.albedo = albedo; tex.normal = normal;
    tex.onSwap?.();
    const ad = albedo.image.data as Uint8Array, nd = normal.image.data as Uint8Array;
    // the commonest walls first: once they're all in, the arrays go up to the GPU (and again at the end).
    // (Two whole uploads: three's per-layer updates didn't reach the mipmaps.)
    const rank = (n: string) => (/^(party|brick|prewar)/.test(n) ? 0 : /^(castiron|deco)/.test(n) ? 1 : 2);
    const order = FACADE_LAYERS.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l.name) - rank(b.l.name));
    let firstLeft = order.filter((o) => rank(o.l.name) === 0).length * 2;
    const put = (_arr: THREE.DataArrayTexture, data: Uint8Array, px: Uint8Array | Uint8ClampedArray, size: number, i: number) => {
      data.set(px, i * size * size * 4);
      if (rank(FACADE_LAYERS[i].name) === 0 && --firstLeft === 0) albedo.needsUpdate = normal.needsUpdate = true;
    };
    const useWorkers = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
    if (useWorkers) {
      const N = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
      const workers = Array.from({ length: N }, () => new Worker(new URL("./facadeWorker.ts", import.meta.url), { type: "module" }));
      let next = 0;
      const pending = new Map<number, (d: Uint8Array | null) => void>();
      for (const w of workers) w.onmessage = (e) => { pending.get(e.data.id)?.(e.data.error ? null : e.data.data); pending.delete(e.data.id); };
      const job = (w: Worker, url: string, size: number) => new Promise<Uint8Array | null>((res) => { const id = next++; pending.set(id, res); w.postMessage({ id, url: new URL(url, location.href).href, size }); }); // (a worker resolves relative URLs against its own script)
      const queue = [...order];
      await Promise.all(workers.map(async (w) => {
        while (queue.length) {
          const { l, i } = queue.shift()!;
          const [a, n] = await Promise.all([job(w, `${base}textures/buildings/${l.name}_c.webp`, AS), job(w, `${base}textures/buildings/${l.name}_n.webp`, NS)]);
          if (a) put(albedo, ad, a, AS, i); else console.warn("facade layer missing", l.name);
          if (n) put(normal, nd, n, NS, i);
        }
      }));
      for (const w of workers) w.terminate();
    } else {
      const flip = (px: Uint8ClampedArray, size: number) => {
        const out = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) out.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        return out;
      };
      const queue = [...order];
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const { l, i } = queue.shift()!;
          try {
            const [a, n] = await Promise.all([decode(`${base}textures/buildings/${l.name}_c.webp`, AS), decode(`${base}textures/buildings/${l.name}_n.webp`, NS)]);
            put(albedo, ad, flip(a, AS), AS, i);
            put(normal, nd, flip(n, NS), NS, i);
          } catch (e) { console.warn("facade layer missing", l.name, e); }
        }
      }));
    }
    albedo.needsUpdate = normal.needsUpdate = true;
  })();
  return tex;
}
