// Procedural facade textures. Each style is one tile of a real facade (a few bays wide,
// a few floors tall) drawn on a canvas: colour in RGB, glass mask in A. A matching
// height map becomes a normal map, so window reveals, sills, cornices and piers catch
// the low sun. Packed into texture arrays; the building shader picks a layer per building.
//
// Walls are painted in light neutral tones and tinted per building in the shader, so one
// brick texture can be red, brown, cream or painted. Glass is never tinted.

import * as THREE from "three";
import type { Style } from "../world/data";

export const TEX = 1024;

/** Real-world size of one tile, and the rules the shader needs (bays, floors). */
export interface StyleTile { bays: number; floors: number; bayW: number; floorH: number }
export const TILES: Record<Style, StyleTile> = {
  tenement: { bays: 4, floors: 2, bayW: 2.6, floorH: 3.2 },
  castiron: { bays: 3, floors: 2, bayW: 3.7, floorH: 4.3 },
  prewar: { bays: 4, floors: 2, bayW: 3.0, floorH: 3.4 },
  deco: { bays: 3, floors: 2, bayW: 3.2, floorH: 3.7 },
  modern: { bays: 4, floors: 2, bayW: 1.6, floorH: 3.7 },
  glass: { bays: 4, floors: 2, bayW: 1.5, floorH: 4.0 },
  brick: { bays: 4, floors: 2, bayW: 2.8, floorH: 2.95 },
  civic: { bays: 3, floors: 2, bayW: 3.6, floorH: 4.6 },
};
export const STYLE_LAYER: Record<Style, number> = { tenement: 0, castiron: 1, prewar: 2, deco: 3, modern: 4, glass: 5, brick: 6, civic: 7 };
export const STOREFRONTS = ["generic", "chinatown", "soho", "midtown", "lobby"] as const;
export type Storefront = (typeof STOREFRONTS)[number];
export const SHOP_LAYER = (s: Storefront) => 8 + STOREFRONTS.indexOf(s);
export const SHOP_W = 27; // metres per storefront tile: six different shops
export const LAYERS = 8 + STOREFRONTS.length;

// ------------------------------------------------------------------ drawing kit

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

interface Ctx {
  c: CanvasRenderingContext2D; // colour (alpha = glass mask)
  h: CanvasRenderingContext2D; // height (grey: 255 = proud, 0 = deep)
  sx: number; sy: number;       // px per metre
}

function mk(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = TEX;
  return [cv, cv.getContext("2d", { willReadFrequently: true })!];
}

/** Rect in metres from the tile's top-left (y down from the top floor). */
function rect(k: Ctx, x: number, y: number, w: number, h: number, col: string, height: number | null, glass = false) {
  k.c.globalCompositeOperation = "source-over";
  k.c.fillStyle = col;
  k.c.fillRect(x * k.sx, y * k.sy, w * k.sx, h * k.sy);
  if (glass) {
    // mark the glass in alpha: punch alpha to 254 later via the mask pass
    k.c.fillStyle = "rgba(0,0,0,0)";
  }
  if (height !== null) {
    k.h.fillStyle = `rgb(${height},${height},${height})`;
    k.h.fillRect(x * k.sx, y * k.sy, w * k.sx, h * k.sy);
  }
}

const glassRects: { x: number; y: number; w: number; h: number }[] = [];
function glass(k: Ctx, x: number, y: number, w: number, h: number, tone: [number, number, number], depth = 40, blinds = true) {
  // dark glass with a soft sky gradient and the odd blind or curtain
  const g = k.c.createLinearGradient(0, y * k.sy, 0, (y + h) * k.sy);
  const [r, gg, b] = tone;
  g.addColorStop(0, `rgb(${r + 30},${gg + 34},${b + 40})`);
  g.addColorStop(0.55, `rgb(${r},${gg},${b})`);
  g.addColorStop(1, `rgb(${Math.max(0, r - 10)},${Math.max(0, gg - 10)},${Math.max(0, b - 8)})`);
  k.c.fillStyle = g;
  k.c.fillRect(x * k.sx, y * k.sy, w * k.sx, h * k.sy);
  const blind = blinds ? rnd() : 1;
  if (blind < 0.35) {
    k.c.fillStyle = pick(["#d9cdb4", "#cfc2a6", "#e6dcc8", "#bfae8f", "#a8b4b8"]);
    k.c.fillRect(x * k.sx, y * k.sy, w * k.sx, h * k.sy * (0.2 + rnd() * 0.5));
  } else if (blind < 0.5) {
    k.c.fillStyle = pick(["#7a2f2a", "#5a4a3a", "#3c5560", "#8a6a3a"]);
    k.c.fillRect(x * k.sx, y * k.sy, w * k.sx * 0.28, h * k.sy);
    k.c.fillRect((x + w * 0.72) * k.sx, y * k.sy, w * k.sx * 0.28, h * k.sy);
  }
  k.h.fillStyle = `rgb(${depth},${depth},${depth})`;
  k.h.fillRect(x * k.sx, y * k.sy, w * k.sx, h * k.sy);
  glassRects.push({ x: x * k.sx, y: y * k.sy, w: w * k.sx, h: h * k.sy });
}

function noise(k: Ctx, amount: number, scale = 1) {
  const n = 5000 * scale;
  for (let i = 0; i < n; i++) {
    const x = rnd() * TEX, y = rnd() * TEX, s = 1 + rnd() * 3;
    if (glassRects.some((g) => x > g.x - 2 && x < g.x + g.w + 2 && y > g.y - 2 && y < g.y + g.h + 2)) continue;
    k.c.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${amount * rnd()})` : `rgba(255,255,255,${amount * 0.6 * rnd()})`;
    k.c.fillRect(x, y, s, s);
  }
}

/** Streaks of grime running down from sills. */
function grime(k: Ctx, xs: number[], y: number, amount: number) {
  for (const x of xs) {
    const g = k.c.createLinearGradient(0, y * k.sy, 0, (y + 1.6) * k.sy);
    g.addColorStop(0, `rgba(40,32,26,${amount})`);
    g.addColorStop(1, "rgba(40,32,26,0)");
    k.c.fillStyle = g;
    k.c.fillRect((x - 0.05) * k.sx, y * k.sy, (0.4 + rnd() * 0.5) * k.sx, 1.6 * k.sy);
  }
}

function bricks(k: Ctx, x0: number, y0: number, w: number, h: number, base: [number, number, number], vary: number, bw = 0.215, bh = 0.07) {
  const [r, g, b] = base;
  k.c.fillStyle = `rgb(${r * 0.78},${g * 0.78},${b * 0.8})`; // mortar
  k.c.fillRect(x0 * k.sx, y0 * k.sy, w * k.sx, h * k.sy);
  k.h.fillStyle = "rgb(150,150,150)";
  k.h.fillRect(x0 * k.sx, y0 * k.sy, w * k.sx, h * k.sy);
  let row = 0;
  for (let y = y0; y < y0 + h; y += bh, row++) {
    for (let x = x0 - (row % 2) * bw * 0.5; x < x0 + w; x += bw) {
      const v = 1 + (rnd() - 0.5) * vary;
      k.c.fillStyle = `rgb(${Math.min(255, r * v)},${Math.min(255, g * v)},${Math.min(255, b * v)})`;
      const xa = Math.max(x, x0);
      k.c.fillRect(xa * k.sx + 0.5, y * k.sy + 0.5, (Math.min(x + bw, x0 + w) - xa) * k.sx - 1.2, bh * k.sy - 1.2);
    }
  }
  k.h.fillStyle = "rgb(170,170,170)";
  for (let y = y0; y < y0 + h; y += bh) k.h.fillRect(x0 * k.sx, y * k.sy + 0.5, w * k.sx, bh * k.sy - 1.5);
}

function stone(k: Ctx, x0: number, y0: number, w: number, h: number, base: [number, number, number], courseH = 0.6, blockW = 1.2) {
  const [r, g, b] = base;
  k.c.fillStyle = `rgb(${r},${g},${b})`;
  k.c.fillRect(x0 * k.sx, y0 * k.sy, w * k.sx, h * k.sy);
  k.h.fillStyle = "rgb(160,160,160)";
  k.h.fillRect(x0 * k.sx, y0 * k.sy, w * k.sx, h * k.sy);
  let row = 0;
  for (let y = y0; y < y0 + h; y += courseH, row++) {
    for (let x = x0 - (row % 2) * blockW * 0.5; x < x0 + w; x += blockW) {
      const v = 1 + (rnd() - 0.5) * 0.06;
      k.c.fillStyle = `rgb(${r * v},${g * v},${b * v})`;
      k.c.fillRect(Math.max(x, x0) * k.sx + 1, y * k.sy + 1, blockW * k.sx - 2, courseH * k.sy - 2);
    }
    k.h.fillStyle = "rgb(120,120,120)";
    k.h.fillRect(x0 * k.sx, y * k.sy, w * k.sx, 2);
  }
}

// ------------------------------------------------------------------ styles

type Drawer = (k: Ctx, t: StyleTile) => void;

const STYLES: Record<Style, Drawer> = {
  tenement(k, t) {
    const W = t.bays * t.bayW, H = t.floors * t.floorH;
    bricks(k, 0, 0, W, H, [200, 196, 190], 0.16);
    for (let f = 0; f < t.floors; f++) {
      for (let b = 0; b < t.bays; b++) {
        const cx = (b + 0.5) * t.bayW, y = f * t.floorH;
        const ww = 1.0, wh = 1.65, wx = cx - ww / 2, wy = y + 0.7;
        rect(k, wx - 0.12, wy - 0.28, ww + 0.24, 0.24, "#e8e0d0", 210); // stone lintel
        rect(k, wx - 0.1, wy + wh, ww + 0.2, 0.12, "#ddd5c4", 220);    // sill
        rect(k, wx, wy, ww, wh, "#f2efe8", 120);                        // frame
        glass(k, wx + 0.07, wy + 0.07, ww - 0.14, wh / 2 - 0.1, [38, 44, 52]);
        glass(k, wx + 0.07, wy + wh / 2 + 0.03, ww - 0.14, wh / 2 - 0.1, [34, 40, 48]);
        rect(k, wx, wy + wh / 2 - 0.03, ww, 0.06, "#f2efe8", 120);     // meeting rail
        grime(k, [wx, wx + ww * 0.6], wy + wh + 0.12, 0.25);
      }
    }
    noise(k, 0.12);
  },
  castiron(k, t) {
    const W = t.bays * t.bayW, H = t.floors * t.floorH;
    rect(k, 0, 0, W, H, "#ece6da", 190);
    for (let f = 0; f < t.floors; f++) {
      const y = f * t.floorH;
      rect(k, 0, y, W, 0.45, "#f4efe4", 235);     // entablature
      rect(k, 0, y + 0.45, W, 0.08, "#c9c1b2", 160);
      for (let b = 0; b < t.bays; b++) {
        const x = b * t.bayW;
        // columns between bays
        rect(k, x, y + 0.53, 0.55, t.floorH - 0.53, "#f6f1e7", 245);
        rect(k, x + 0.08, y + 0.53, 0.06, t.floorH - 0.53, "#d8d0c0", 200);
        rect(k, x + 0.41, y + 0.53, 0.06, t.floorH - 0.53, "#d8d0c0", 200);
        rect(k, x - 0.05, y + 0.53, 0.65, 0.22, "#fbf8f0", 250); // capital
        // tall window with arched head
        const wx = x + 0.75, ww = t.bayW - 0.95, wy = y + 0.95, wh = t.floorH - 1.25;
        rect(k, wx - 0.08, wy - 0.08, ww + 0.16, wh + 0.16, "#dcd3c2", 130);
        glass(k, wx, wy + 0.3, ww, wh - 0.3, [36, 42, 50], 30);
        k.c.fillStyle = "#2c333c";
        k.c.beginPath();
        k.c.ellipse((wx + ww / 2) * k.sx, (wy + 0.32) * k.sy, (ww / 2) * k.sx, 0.32 * k.sy, 0, Math.PI, 0);
        k.c.fill();
        rect(k, wx + ww / 2 - 0.04, wy + 0.3, 0.08, wh - 0.3, "#efe9dc", 120); // mullion
        rect(k, wx, wy + wh * 0.55, ww, 0.07, "#efe9dc", 120);
        rect(k, wx - 0.12, wy + wh, ww + 0.24, 0.14, "#f6f1e7", 230); // sill
      }
    }
    noise(k, 0.08);
  },
  prewar(k, t) {
    const W = t.bays * t.bayW, H = t.floors * t.floorH;
    bricks(k, 0, 0, W, H, [226, 214, 194], 0.08, 0.215, 0.07);
    for (let f = 0; f < t.floors; f++) {
      const y = f * t.floorH;
      if (f === 0) rect(k, 0, y + t.floorH - 0.18, W, 0.18, "#efe7d8", 225); // belt course
      for (let b = 0; b < t.bays; b++) {
        const cx = (b + 0.5) * t.bayW;
        const ww = 1.15, wh = 1.75, wx = cx - ww / 2, wy = y + 0.7;
        rect(k, wx - 0.14, wy - 0.14, ww + 0.28, wh + 0.28, "#ebe2d2", 205); // stone surround
        rect(k, wx, wy, ww, wh, "#f4f1ea", 110);
        glass(k, wx + 0.06, wy + 0.06, ww - 0.12, wh * 0.45, [40, 46, 54]);
        glass(k, wx + 0.06, wy + wh * 0.52, ww - 0.12, wh * 0.45, [36, 42, 50]);
        grime(k, [wx + 0.1], wy + wh + 0.14, 0.15);
      }
    }
    noise(k, 0.09);
  },
  deco(k, t) {
    const W = t.bays * t.bayW, H = t.floors * t.floorH;
    stone(k, 0, 0, W, H, [222, 212, 192], 0.62, 1.5);
    for (let b = 0; b < t.bays; b++) {
      const x = b * t.bayW;
      // continuous vertical pier
      rect(k, x, 0, 0.7, H, "#ece4d2", 250);
      rect(k, x + 0.62, 0, 0.08, H, "#c9bea8", 200);
      const wx = x + 0.95, ww = t.bayW - 1.2;
      for (let f = 0; f < t.floors; f++) {
        const y = f * t.floorH;
        glass(k, wx, y + 0.5, ww, t.floorH - 1.35, [30, 38, 46], 40);
        rect(k, wx + ww / 2 - 0.04, y + 0.5, 0.08, t.floorH - 1.35, "#3a3f44", 60);
        // dark spandrel with a chevron
        rect(k, wx, y + t.floorH - 0.85, ww, 0.85, "#5b5248", 70);
        k.c.strokeStyle = "#b39c6a";
        k.c.lineWidth = 3;
        k.c.beginPath();
        for (let i = 0; i < 4; i++) {
          const px = (wx + (ww / 4) * i) * k.sx, py = (y + t.floorH - 0.55) * k.sy;
          k.c.moveTo(px, py + 10); k.c.lineTo(px + (ww / 8) * k.sx, py - 6); k.c.lineTo(px + (ww / 4) * k.sx, py + 10);
        }
        k.c.stroke();
      }
    }
    noise(k, 0.07);
  },
  modern(k, t) {
    const W = t.bays * t.bayW, H = t.floors * t.floorH;
    for (let f = 0; f < t.floors; f++) {
      const y = f * t.floorH;
      // ribbon window band and a spandrel panel band
      for (let b = 0; b < t.bays; b++) glass(k, b * t.bayW + 0.04, y, t.bayW - 0.08, t.floorH * 0.58, [52, 66, 72], 70);
      rect(k, 0, y + t.floorH * 0.58, W, t.floorH * 0.42, "#c9ccc8", 200);
      for (let b = 0; b <= t.bays; b++) rect(k, b * t.bayW - 0.04, y, 0.08, t.floorH, "#9aa0a3", 215); // mullions
      rect(k, 0, y + t.floorH * 0.58, W, 0.05, "#8e9497", 150);
    }
    void H;
    noise(k, 0.05);
  },
  glass(k, t) {
    const W = t.bays * t.bayW;
    for (let f = 0; f < t.floors; f++) {
      const y = f * t.floorH;
      for (let b = 0; b < t.bays; b++) glass(k, b * t.bayW + 0.03, y + 0.06, t.bayW - 0.06, t.floorH - 0.5, [44, 70, 84], 110);
      rect(k, 0, y + t.floorH - 0.44, W, 0.44, "#3d5662", 150); // floor-edge spandrel glass
      for (let b = 0; b <= t.bays; b++) rect(k, b * t.bayW - 0.03, y, 0.06, t.floorH, "#7d8c94", 200);
    }
    noise(k, 0.03);
  },
  brick(k, t) {
    const W = t.bays * t.bayW, H = t.floors * t.floorH;
    bricks(k, 0, 0, W, H, [214, 196, 176], 0.12, 0.2, 0.068);
    for (let f = 0; f < t.floors; f++) {
      const y = f * t.floorH;
      for (let b = 0; b < t.bays; b++) {
        const cx = (b + 0.5) * t.bayW, ww = 1.7, wh = 1.35, wx = cx - ww / 2, wy = y + 0.75;
        rect(k, wx - 0.05, wy - 0.05, ww + 0.1, wh + 0.1, "#9b9fa2", 120);
        glass(k, wx, wy, ww / 2 - 0.02, wh, [40, 46, 52]);
        glass(k, wx + ww / 2 + 0.02, wy, ww / 2 - 0.02, wh, [38, 44, 50]);
        rect(k, wx - 0.08, wy + wh + 0.05, ww + 0.16, 0.1, "#c8c2b6", 205);
        if (rnd() < 0.4) rect(k, cx - 0.35, wy + wh + 0.25, 0.7, 0.42, "#b9b4a8", 235); // AC sleeve
      }
    }
    void H;
    noise(k, 0.1);
  },
  civic(k, t) {
    const W = t.bays * t.bayW, H = t.floors * t.floorH;
    stone(k, 0, 0, W, H, [232, 226, 212], 0.55, 1.4);
    for (let b = 0; b < t.bays; b++) {
      const x = b * t.bayW;
      rect(k, x + 0.2, 0, 0.6, H, "#f3efe4", 245); // pilaster
      for (let f = 0; f < t.floors; f++) {
        const y = f * t.floorH, wx = x + 1.25, ww = t.bayW - 1.6;
        rect(k, wx - 0.15, y + 0.6, ww + 0.3, t.floorH - 1.2, "#e6dfcf", 210);
        glass(k, wx, y + 0.75, ww, t.floorH - 1.5, [38, 44, 52]);
        rect(k, wx - 0.25, y + 0.42, ww + 0.5, 0.2, "#f6f2e8", 240); // pediment
      }
    }
    noise(k, 0.06);
  },
};

// ------------------------------------------------------------------ storefronts (ground floor band)

const SIGN_WORDS = ["DELI", "BAKERY", "NAILS", "PHARMACY", "PIZZA", "CAFE", "LAUNDROMAT", "BAGELS", "HARDWARE", "GROCERY", "FLOWERS", "SHOES", "NEWS", "DINER", "BOOKS", "TAILOR", "LIQUORS", "PAWN", "HOTEL", "SUSHI", "BARBER", "TACOS"];
const CN = ["龍", "福", "茶", "麵", "金", "記", "樓", "海", "鮮", "飯", "店", "園", "華", "興"];

/** A lit shop window: warm interior, shelves and goods, a reflection band. */
function shopWindow(k: Ctx, x: number, y: number, w: number, h: number) {
  const g = k.c.createLinearGradient(0, y * k.sy, 0, (y + h) * k.sy);
  g.addColorStop(0, "#5a4632"); g.addColorStop(1, "#2a2018");
  k.c.fillStyle = g;
  k.c.fillRect(x * k.sx, y * k.sy, w * k.sx, h * k.sy);
  for (let s = 0; s < 3; s++) {
    const sy = y + h * (0.3 + s * 0.25);
    k.c.fillStyle = "#1c1612";
    k.c.fillRect(x * k.sx, sy * k.sy, w * k.sx, 0.05 * k.sy);
    for (let i = 0; i < 9; i++) {
      k.c.fillStyle = pick(["#b0473a", "#d6b04a", "#e8e0cc", "#3f6e8a", "#6a8a3a", "#c97a3a"]);
      const bw = 0.08 + rnd() * 0.18;
      k.c.fillRect((x + rnd() * (w - bw)) * k.sx, (sy - 0.08 - rnd() * 0.14) * k.sy, bw * k.sx, 0.12 * k.sy);
    }
  }
  k.c.fillStyle = "rgba(255,255,255,0.08)";
  k.c.beginPath(); k.c.moveTo(x * k.sx, (y + h) * k.sy); k.c.lineTo((x + w * 0.4) * k.sx, y * k.sy); k.c.lineTo((x + w * 0.55) * k.sx, y * k.sy); k.c.lineTo((x + w * 0.15) * k.sx, (y + h) * k.sy); k.c.fill();
  k.h.fillStyle = "rgb(50,50,50)";
  k.h.fillRect(x * k.sx, y * k.sy, w * k.sx, h * k.sy);
  glassRects.push({ x: x * k.sx, y: y * k.sy, w: w * k.sx, h: h * k.sy });
}

/** Text drawn in metres with the right proportions, whatever the tile's aspect. */
function signText(k: Ctx, text: string, xm: number, ym: number, maxWm: number) {
  k.c.save();
  k.c.translate(xm * k.sx, ym * k.sy);
  k.c.scale(k.sx / k.sy, 1); // the tile is squeezed sideways: draw in vertical-pixel units
  k.c.fillText(text, 0, 0, maxWm * k.sy);
  k.c.restore();
}

function storefront(k: Ctx, kind: Storefront, H: number) {
  void SHOP_W;
  // 2 shops per tile, each 4.5 m
  for (let i = 0; i < 6; i++) {
    const x = i * 4.5;
    const pier = kind === "lobby" ? "#9da5aa" : kind === "soho" ? "#2b2d30" : pick(["#6b5a4a", "#4d4440", "#7a6a58", "#5a5550"]);
    rect(k, x, 0, 4.5, H, pier, 200);
    if (kind === "lobby") {
      glass(k, x + 0.3, 0.6, 3.9, H - 0.6, [60, 70, 76], 60, false);
      rect(k, x + 2.2, 0.6, 0.08, H - 0.6, "#bcc3c7", 160);
      continue;
    }
    const signH = kind === "chinatown" ? 1.1 : 0.85;
    // sign board
    const signCol = kind === "chinatown" ? pick(["#c8231b", "#e0b21a", "#b51f3a", "#1f6f3a"]) : kind === "soho" ? "#1d1d1f" : pick(["#2f4f7a", "#7a2f2f", "#2f6a4f", "#e8e2d4", "#c9a227", "#3b3b3b"]);
    rect(k, x + 0.25, 0.25, 4.0, signH, signCol, 230);
    k.c.fillStyle = kind === "chinatown" ? (signCol === "#e0b21a" ? "#b0121a" : "#ffe9a8") : kind === "soho" ? "#e9e2d0" : signCol === "#e8e2d4" ? "#222" : "#f4efe4";
    k.c.textAlign = "center";
    k.c.textBaseline = "middle";
    if (kind === "chinatown") {
      k.c.font = `bold ${Math.round(signH * k.sy * 0.62)}px serif`;
      const word = pick(CN) + pick(CN) + pick(CN);
      signText(k, word, x + 2.25, 0.25 + signH / 2, 3.7);
    } else {
      k.c.font = `bold ${Math.round(signH * k.sy * 0.5)}px Inter, Arial, sans-serif`;
      signText(k, pick(SIGN_WORDS), x + 2.25, 0.25 + signH / 2, 3.7);
    }
    // shop window and door, sometimes a roll-down shutter
    const wy = 0.25 + signH + 0.25;
    if (rnd() < (kind === "chinatown" ? 0.25 : 0.12)) {
      rect(k, x + 0.3, wy, 3.9, H - wy, "#8d9194", 170);
      for (let y = wy; y < H; y += 0.09) rect(k, x + 0.3, y, 3.9, 0.025, "#6c7073", 140);
    } else {
      shopWindow(k, x + 0.3, wy, 2.6, H - wy - 0.55);
      rect(k, x + 0.3, H - 0.55, 2.6, 0.55, pier, 190); // stall riser
      glass(k, x + 3.15, wy + 0.1, 1.05, H - wy - 0.1, [50, 46, 40], 40); // door
    }
  }
  noise(k, 0.08);
}

// ------------------------------------------------------------------ build the arrays

function heightToNormal(src: Uint8ClampedArray, out: Uint8Array, offset: number, strength: number) {
  const N = TEX;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const h = (xx: number, yy: number) => src[(((yy + N) % N) * N + ((xx + N) % N)) * 4] / 255;
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = offset + (y * N + x) * 4;
      out[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((dy / len) * 0.5 + 0.5) * 255; // canvas y runs down, texture v runs up
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
}

export interface FacadeTextures { albedo: THREE.DataArrayTexture; normal: THREE.DataArrayTexture; groundH: (st: Style) => number }

export function buildFacadeTextures(): FacadeTextures {
  const albedo = new Uint8Array(TEX * TEX * 4 * LAYERS);
  const normal = new Uint8Array(TEX * TEX * 4 * LAYERS);
  const draw = (layer: number, wM: number, hM: number, fn: (k: Ctx) => void) => {
    seed = 1234 + layer * 977;
    const [cvC, c] = mk();
    const [, h] = mk();
    h.fillStyle = "rgb(160,160,160)";
    h.fillRect(0, 0, TEX, TEX);
    glassRects.length = 0;
    const k: Ctx = { c, h, sx: TEX / wM, sy: TEX / hM };
    fn(k);
    void cvC;
    const img = c.getImageData(0, 0, TEX, TEX).data;
    // glass mask into alpha
    const mask = new Uint8Array(TEX * TEX);
    for (const g of glassRects) {
      for (let y = Math.max(0, Math.floor(g.y)); y < Math.min(TEX, Math.ceil(g.y + g.h)); y++)
        for (let x = Math.max(0, Math.floor(g.x)); x < Math.min(TEX, Math.ceil(g.x + g.w)); x++) mask[y * TEX + x] = 255;
    }
    const off = layer * TEX * TEX * 4;
    // flip vertically: canvas row 0 is the top of the tile, texture v = 1 is the top
    for (let y = 0; y < TEX; y++) {
      const sy = TEX - 1 - y;
      for (let x = 0; x < TEX; x++) {
        const si = (sy * TEX + x) * 4, di = off + (y * TEX + x) * 4;
        albedo[di] = img[si]; albedo[di + 1] = img[si + 1]; albedo[di + 2] = img[si + 2];
        albedo[di + 3] = mask[sy * TEX + x];
      }
    }
    const hd = h.getImageData(0, 0, TEX, TEX).data;
    const flipped = new Uint8ClampedArray(hd.length);
    for (let y = 0; y < TEX; y++) flipped.set(hd.subarray((TEX - 1 - y) * TEX * 4, (TEX - y) * TEX * 4), y * TEX * 4);
    heightToNormal(flipped, normal, off, 6);
  };
  for (const [st, fn] of Object.entries(STYLES) as [Style, Drawer][]) {
    const t = TILES[st];
    draw(STYLE_LAYER[st], t.bays * t.bayW, t.floors * t.floorH, (k) => fn(k, t));
  }
  for (const sf of STOREFRONTS) draw(SHOP_LAYER(sf), SHOP_W, 4.6, (k) => storefront(k, sf, 4.6));

  const mkTex = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, TEX, TEX, LAYERS);
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
  };
  return {
    albedo: mkTex(albedo, true),
    normal: mkTex(normal, false),
    groundH: (st) => (st === "castiron" ? 4.6 : st === "glass" || st === "modern" ? 5.5 : 4.4),
  };
}

/** Per-style wall tints (multiplied into the light neutral texture). */
export const TINTS: Record<Style, string[]> = {
  tenement: ["#b5523b", "#a34a36", "#8f3f30", "#c26a4a", "#9a5a42", "#7d4434", "#d8c7a8", "#a8a8a0", "#c9a882", "#6e5446"],
  castiron: ["#ffffff", "#f4ecdc", "#e2dccf", "#d7d9d6", "#c8ccc6", "#efe2c4", "#b9bdb8"],
  prewar: ["#f2e6cf", "#e2cfae", "#d8bf98", "#c9a77e", "#efe9de", "#bfa58a", "#b07a5a", "#a3634a"],
  deco: ["#f2e8d5", "#e5d5b5", "#d9c7a3", "#cdbfa8", "#e8dcc6"],
  modern: ["#ffffff", "#e8ecec", "#d8dcd8", "#c4cbd0", "#e8e0d0"],
  glass: ["#ffffff", "#e6f0f2", "#dde8e2", "#e6e6f0", "#d0dde6"],
  brick: ["#c9a07e", "#b78463", "#a87456", "#d6b896", "#9c6a50", "#c2a68a"],
  civic: ["#ffffff", "#f4efe2", "#ebe4d4"],
};
