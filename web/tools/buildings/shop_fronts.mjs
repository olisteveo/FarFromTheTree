// The shop front sheet: 64 individual 4.5 m shops, each its own business with its own sign, layout and insides, for
// render/buildings.ts to pick from bay by bay. Drawn from the stroke alphabet (no fonts); every name is invented.
//
//   node tools/buildings/shop_fronts.mjs  -> public/textures/buildings/shops.webp
//
// An 8 x 8 sheet of 512 px cells with an 8 px gutter. Alpha follows facades.ts: 255 is glass, 160 is everything else.
// Cell ranges by district are mirrored in SHOP_SHEET (render/buildings.ts): generic 0-31, chinatown 32-41,
// soho 42-51, midtown 52-59, lobby 60-63.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { wordWith } from "../block/letters.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/textures/buildings");
const SIZE = 4096, CELL = 512, GUTTER = 8, UNITS = 450; // drawn in centimetres: 4.5 m wide by 4.5 m tall

let seed = 77;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const between = (a, b) => a + rand() * (b - a);
const pick = (l) => l[Math.floor(rand() * l.length) % l.length];
const word = wordWith(between);

const rect = (x, y, w, h, c, extra = "") => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}" ${extra}/>`;
const line = (x1, y1, x2, y2, c, w) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="${w}"/>`;
const circle = (x, y, r, c, extra = "") => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${c}" ${extra}/>`;
const grad = (id, top, bottom) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;

/** Lettering. style: block (sign painter), slab (heavy and square), script (leaning, joined up), neon (a lit tube), thin. */
function letters(text, x, y, w, h, color, style = "block", back = null) {
  const opt = { block: { gap: 0.2 }, slab: { gap: 0.24 }, script: { gap: 0.05, slant: 0.28, jitter: 0.012 }, neon: { gap: 0.28 }, thin: { gap: 0.34 } }[style];
  const d = word(text, x, y, w, h, opt);
  const weight = { block: 0.17, slab: 0.25, script: 0.14, neon: 0.075, thin: 0.075 }[style] * h;
  const cap = style === "script" || style === "neon" ? "round" : "butt", join = style === "script" || style === "neon" ? "round" : "miter";
  const s = (c, sw, more = "") => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw.toFixed(1)}" stroke-linecap="${cap}" stroke-linejoin="${join}" ${more}/>`;
  let out = "";
  if (style === "neon") return s(color, weight * 3.2, 'opacity="0.28"') + s(color, weight * 1.5) + s("#fff8ee", weight * 0.5);
  if (back) out += s(back, weight * 1.05, `transform="translate(${(h * 0.05).toFixed(1)} ${(h * 0.06).toFixed(1)})"`);
  return out + s(color, weight);
}

// ------------------------------------------------------------------ what's in the window

const INK = ["#c8382a", "#e7b52f", "#2c6fb0", "#2f8a55", "#e8e2d2", "#8a3f8f", "#e0672a", "#3fa0a8", "#d9558a", "#7d5a38"];
const LIGHT = { warm: ["#6d4a2c", "#3a2518"], fluoro: ["#c9cfc8", "#8f958f"], cool: ["#dfe5e6", "#a8b0b4"], dim: ["#2b211c", "#14100e"], gold: ["#a8733a", "#50301a"], white: ["#f2efe8", "#cfcac0"], red: ["#6e1f1c", "#2a0d0e"] };

function shelves(x, y, w, h, rows, draw, plank = "#3a2a1e") {
  let s = "";
  for (let r = 0; r < rows; r++) {
    const sy = y + (h * (r + 1)) / (rows + 0.2);
    let px = x + 3;
    while (px < x + w - 6) px += draw(px, sy, (out) => { s += out; }) + between(0.5, 3);
    s += rect(x, sy, w, 2.6, plank);
  }
  return s;
}
const INSIDES = {
  groceries: (x, y, w, h) => shelves(x, y, w, h * 0.78, 4, (px, sy, put) => {
    const iw = between(5, 12), ih = between(9, 20), c = pick(INK);
    put(rect(px, sy - ih, iw, ih, c) + rect(px, sy - ih * 0.6, iw, ih * 0.25, "#f0e8d6", 'opacity="0.7"'));
    return iw;
  }) + produce(x, y + h * 0.78, w, h * 0.22),
  bottles: (x, y, w, h) => shelves(x, y, w, h * 0.92, 5, (px, sy, put) => {
    const ih = between(16, 24), c = pick(["#3f6b3a", "#6a3a1e", "#8a6a2a", "#1f3a2a", "#a03a28", "#d8d4c8"]);
    put(rect(px + 1.2, sy - ih, 3.2, ih * 0.35, c) + `<rect x="${px.toFixed(1)}" y="${(sy - ih * 0.7).toFixed(1)}" width="5.6" height="${(ih * 0.7).toFixed(1)}" rx="1.6" fill="${c}"/>` + rect(px + 0.6, sy - ih * 0.42, 4.4, ih * 0.22, "#ece4d2"));
    return 6;
  }, "#1e1712"),
  washers: (x, y, w, h) => {
    let s = rect(x, y + h * 0.3, w, h * 0.7, "#bfc6c8");
    const n = Math.max(2, Math.floor(w / 44)), mw = w / n;
    for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++) {
      const cx = x + mw * (i + 0.5), cy = y + h * (0.47 + r * 0.32);
      s += rect(x + mw * i + 1.5, y + h * (0.32 + r * 0.32), mw - 3, h * 0.3, r ? "#dfe3e2" : "#eceeec") + circle(cx, cy, mw * 0.3, "#3c4a55") + circle(cx, cy, mw * 0.22, r % 2 ? "#6f8fa8" : "#8eb0c8") + rect(x + mw * i + 4, y + h * (0.33 + r * 0.32), mw * 0.3, 3, "#2a6fb0");
    }
    return s;
  },
  racks: (x, y, w, h) => {
    let s = line(x + 4, y + h * 0.2, x + w - 4, y + h * 0.2, "#c8c8c8", 2.2);
    for (let px = x + 8; px < x + w - 10; px += between(8, 15)) {
      const c = pick(INK), l = between(h * 0.32, h * 0.58);
      s += `<path d="M${px - 6} ${y + h * 0.22} L${px + 6} ${y + h * 0.22} L${px + 8} ${y + h * 0.22 + l} L${px - 8} ${y + h * 0.22 + l} Z" fill="${c}"/>`;
    }
    return s + rect(x, y + h * 0.9, w, h * 0.1, "#3a3430");
  },
  mannequins: (x, y, w, h) => {
    let s = rect(x, y + h * 0.84, w, h * 0.16, "#d8d2c6");
    const n = Math.max(1, Math.floor(w / 42));
    for (let i = 0; i < n; i++) {
      const cx = x + (w * (i + 0.5)) / n, c = pick(["#181818", "#c8382a", "#e8e2d2", "#2c5f88", "#b08a4a", "#5a4a8a"]);
      s += circle(cx, y + h * 0.26, 7.5, "#e8dccb") + `<path d="M${cx - 13} ${y + h * 0.34} L${cx + 13} ${y + h * 0.34} L${cx + 17} ${y + h * 0.82} L${cx - 17} ${y + h * 0.82} Z" fill="${c}"/>` + rect(cx - 1.5, y + h * 0.82, 3, h * 0.04, "#555");
    }
    return s;
  },
  pizza: (x, y, w, h) => {
    let s = rect(x, y + h * 0.1, w, h * 0.38, "#7a4a30");
    s += rect(x + w * 0.1, y + h * 0.15, w * 0.34, h * 0.26, "#28201c") + rect(x + w * 0.54, y + h * 0.15, w * 0.34, h * 0.26, "#28201c") + rect(x + w * 0.12, y + h * 0.3, w * 0.3, h * 0.09, "#d8642a", 'opacity="0.9"') + rect(x + w * 0.56, y + h * 0.3, w * 0.3, h * 0.09, "#d8642a", 'opacity="0.9"');
    s += rect(x, y + h * 0.58, w, h * 0.42, "#c9c4b6") + rect(x, y + h * 0.54, w, h * 0.05, "#e8e6de");
    for (let i = 0; i < Math.floor(w / 36); i++) {
      const cx = x + 20 + i * 36;
      s += circle(cx, y + h * 0.53, 15, "#d9a43a") + circle(cx, y + h * 0.53, 12, "#c8502a") + circle(cx - 4, y + h * 0.52, 2, "#6a2518") + circle(cx + 4, y + h * 0.54, 2, "#6a2518");
    }
    return s;
  },
  counter: (x, y, w, h) => {
    let s = rect(x, y + h * 0.56, w, h * 0.44, "#6a3f28") + rect(x, y + h * 0.53, w, h * 0.04, "#d9d4c6");
    for (let i = 0; i < Math.floor(w / 26); i++) {
      const cx = x + 12 + i * 26;
      s += rect(cx - 1, y + h * 0.1, 2, h * 0.16, "#222") + `<path d="M${cx - 8} ${y + h * 0.26} L${cx + 8} ${y + h * 0.26} L${cx + 5} ${y + h * 0.19} L${cx - 5} ${y + h * 0.19} Z" fill="#e8c26a"/>` + circle(cx, y + h * 0.27, 3.4, "#fff2c4") ;
      s += rect(cx - 1.3, y + h * 0.66, 2.6, h * 0.26, "#a8a8a8") + `<ellipse cx="${cx}" cy="${y + h * 0.65}" rx="8" ry="2.6" fill="#b5322a"/>`;
    }
    return s;
  },
  flowers: (x, y, w, h) => {
    let s = rect(x, y + h * 0.82, w, h * 0.18, "#4a4038");
    for (let r = 0; r < 3; r++) for (let i = 0; i < Math.floor(w / 16); i++) {
      const cx = x + 8 + i * 16 + r * 5, cy = y + h * (0.74 - r * 0.2);
      s += rect(cx - 5, cy + 5, 10, 13, "#6a6a66");
      for (let k = 0; k < 6; k++) s += circle(cx + between(-7, 7), cy + between(-8, 6), between(2.2, 4.2), k % 3 ? pick(["#d9558a", "#e7b52f", "#e8e2d2", "#c8382a", "#a24fc0"]) : pick(["#3f6a30", "#57803c"]));
    }
    return s;
  },
  hanging: (x, y, w, h) => {
    let s = line(x + 4, y + h * 0.14, x + w - 4, y + h * 0.14, "#8a8a8a", 2) + rect(x, y + h * 0.66, w, h * 0.34, "#c9c4b6");
    for (let px = x + 12; px < x + w - 10; px += between(20, 30)) s += line(px, y + h * 0.14, px, y + h * 0.2, "#ccc", 1.2) + `<ellipse cx="${px}" cy="${y + h * 0.34}" rx="${between(7, 10)}" ry="${h * 0.14}" fill="${pick(["#8a3f18", "#a0521e", "#6e2f12"])}"/>`;
    for (let i = 0; i < Math.floor(w / 22); i++) s += rect(x + 4 + i * 22, y + h * 0.7, 18, h * 0.2, pick(["#d8d4c8", "#c88a7a", "#e0a080"]));
    return s;
  },
  fish: (x, y, w, h) => {
    let s = rect(x, y + h * 0.5, w, h * 0.5, "#e6eef0");
    for (let i = 0; i < Math.floor(w / 9); i++) for (let r = 0; r < 3; r++) {
      const px = x + 4 + i * 9 + between(-2, 2), py = y + h * (0.58 + r * 0.14) + between(-2, 2);
      s += `<ellipse cx="${px}" cy="${py}" rx="${between(9, 14)}" ry="3.6" fill="${pick(["#8a98a4", "#b2bcc4", "#a55a4a", "#6a7a88"])}" transform="rotate(${between(-24, 24)} ${px} ${py})"/>`;
    }
    return s + rect(x, y + h * 0.42, w, 4, "#2a6fb0");
  },
  books: (x, y, w, h) => shelves(x, y, w, h * 0.96, 5, (px, sy, put) => {
    const iw = between(2.4, 6), ih = between(16, 25);
    put(rect(px, sy - ih, iw, ih, pick(["#7a2a22", "#2a3f5a", "#2f5a3a", "#d0c4a8", "#8a6a2a", "#3a2a4a", "#a85a2a", "#ded8c8"])));
    return iw;
  }, "#3a2616"),
  screens: (x, y, w, h) => {
    let s = "";
    const n = Math.max(2, Math.floor(w / 34));
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) {
      const px = x + 4 + i * ((w - 4) / n), py = y + h * (0.1 + r * 0.27), c = pick(["#3fa0d8", "#e0672a", "#2f8a55", "#c8382a", "#8a3f8f", "#e7b52f", "#d8dde0"]);
      s += rect(px, py, w / n - 6, h * 0.22, "#101014") + rect(px + 1.8, py + 1.8, w / n - 9.6, h * 0.22 - 3.6, c);
    }
    return s;
  },
  tools: (x, y, w, h) => {
    let s = rect(x, y, w, h * 0.8, "#6e6250");
    for (let px = x + 6; px < x + w; px += 13) for (let py = y + 8; py < y + h * 0.78; py += 13) s += circle(px, py, 0.8, "#3a3024");
    for (let i = 0; i < w / 6; i++) {
      const px = x + between(3, w - 6), py = y + between(h * 0.04, h * 0.62);
      s += rect(px, py, between(2, 4), between(14, 26), pick(["#c8382a", "#2c6fb0", "#e7b52f", "#b8b8b8", "#3f3f3f"]));
    }
    return s + rect(x, y + h * 0.8, w, h * 0.2, "#38322a") + rect(x + 6, y + h * 0.75, 28, h * 0.12, "#a03a28") + rect(x + 40, y + h * 0.77, 34, h * 0.1, "#3a5a78");
  },
  jewels: (x, y, w, h) => {
    let s = rect(x, y + h * 0.46, w, h * 0.54, "#20181a") + rect(x, y + h * 0.1, w, h * 0.36, "#3a2a2c");
    for (let r = 0; r < 3; r++) for (let i = 0; i < w / 18; i++) {
      const px = x + 8 + i * 18, py = y + h * (0.2 + r * 0.25);
      s += rect(px - 6, py - 6, 12, 12, "#0c0a0c") + circle(px, py, 3.2, "none", 'stroke="#e8c868" stroke-width="1.4"') + circle(px, py - 3.4, 1, "#f4f4ff");
    }
    return s;
  },
  chairs: (x, y, w, h) => {
    let s = rect(x, y, w, h * 0.46, "#b8c4c0") + rect(x, y + h * 0.1, w, h * 0.22, "#d8dee0");
    const n = Math.max(1, Math.floor(w / 52));
    for (let i = 0; i < n; i++) {
      const cx = x + (w * (i + 0.5)) / n;
      s += rect(cx - 15, y + h * 0.44, 30, h * 0.14, "#7a1f22") + rect(cx - 15, y + h * 0.22, 30, h * 0.24, "#8e2428") + rect(cx - 3, y + h * 0.58, 6, h * 0.26, "#9a9a9a") + rect(cx - 16, y + h * 0.84, 32, 4, "#6a6a6a");
    }
    return s + rect(x, y + h * 0.9, w, h * 0.1, "#d0c8b4");
  },
  gallery: (x, y, w, h) => {
    let s = rect(x, y + h * 0.82, w, h * 0.18, "#a8a29a");
    s += rect(x + w * 0.14, y + h * 0.2, w * 0.3, h * 0.36, pick(["#c8382a", "#20262e", "#e7b52f"])) + rect(x + w * 0.56, y + h * 0.28, w * 0.26, h * 0.26, pick(["#2c6fb0", "#d9558a", "#3a3a3a"])) + circle(x + w * 0.66, y + h * 0.39, h * 0.07, "#efe8d6");
    return s + rect(x + w * 0.42, y + h * 0.62, w * 0.14, h * 0.2, "#f2f0ea");
  },
  bar: (x, y, w, h) => {
    let s = rect(x, y + h * 0.1, w, h * 0.45, "#1a1210");
    for (let i = 0; i < w / 9; i++) { const c = pick(["#a85a2a", "#6a8a4a", "#d8c07a", "#8a2a22"]); s += rect(x + 3 + i * 9, y + h * 0.3, 5, h * 0.2, c); }
    s += rect(x, y + h * 0.55, w, h * 0.05, "#5a3a20") + rect(x, y + h * 0.6, w, h * 0.4, "#20140e");
    for (let i = 0; i < w / 40; i++) s += rect(x + 14 + i * 40, y + h * 0.62, 3, h * 0.28, "#7a7a7a") + circle(x + 15.5 + i * 40, y + h * 0.61, 8, "#3a1a16");
    return s;
  },
  cakes: (x, y, w, h) => {
    let s = rect(x, y + h * 0.62, w, h * 0.38, "#d9cdb6");
    for (let r = 0; r < 3; r++) {
      s += rect(x, y + h * (0.26 + r * 0.19), w, 2.4, "#efe9dc");
      for (let px = x + 8; px < x + w - 8; px += between(18, 26)) { const c = pick(["#f2d9b0", "#d89a5a", "#fbeee0", "#b45a2a", "#e8a0b0"]); s += `<ellipse cx="${px}" cy="${y + h * (0.24 + r * 0.19)}" rx="8" ry="${between(4, 7)}" fill="${c}"/>`; }
    }
    return s;
  },
  antiques: (x, y, w, h) => {
    let s = rect(x, y + h * 0.84, w, h * 0.16, "#3a2a1c") + rect(x + w * 0.08, y + h * 0.5, w * 0.3, h * 0.34, "#6a4426") + rect(x + w * 0.11, y + h * 0.56, w * 0.24, 2, "#3a2414");
    s += circle(x + w * 0.62, y + h * 0.38, h * 0.13, "#c4a050", 'stroke="#4a3418" stroke-width="3"') + rect(x + w * 0.6, y + h * 0.5, w * 0.05, h * 0.34, "#4a3418");
    s += rect(x + w * 0.76, y + h * 0.3, w * 0.16, h * 0.32, "#52627a", 'stroke="#c4a050" stroke-width="2.4"');
    return s + `<ellipse cx="${x + w * 0.23}" cy="${y + h * 0.42}" rx="${w * 0.08}" ry="${h * 0.08}" fill="#8aa8a0"/>`;
  },
  dim: () => "",
};
function produce(x, y, w, h) {
  let s = "";
  for (let i = 0; i < Math.floor(w / 30); i++) {
    const cx = x + 2 + i * 30, c = pick(["#c8382a", "#e0872a", "#e7c52f", "#57803c", "#a03a5a"]);
    s += rect(cx, y + h * 0.4, 28, h * 0.6, "#8a6a42");
    for (let k = 0; k < 14; k++) s += circle(cx + between(3, 25), y + h * between(0.22, 0.5), 3.4, c);
  }
  return s;
}

// ------------------------------------------------------------------ one shop

const RISER = { tile: ["#3e5a5a", "#2d4040"], black: ["#141416", "#232326"], marble: ["#b6b0a6", "#8c867c"], wood: ["#5a3a24", "#3c2616"], brick: ["#7a4230", "#54301f"], steel: ["#8a8d90", "#65686c"], red: ["#7a2420", "#4a1412"], green: ["#21483a", "#143026"] };

/** A whole front. spec: name, sub, sign colours and style, the insides, door position, riser, and extras like a gate. */
function shop(i, s) {
  const defs = [], mask = [];
  const id = `s${i}`, pier = s.pier ?? "#4a4440";
  let o = rect(0, 0, UNITS, UNITS, pier);
  o += rect(0, 0, UNITS, 7, "#26221f");
  // half piers, so neighbouring shops share a whole one
  const pw = s.pierW ?? 15;
  for (const x of [0, UNITS - pw]) o += rect(x, 7, pw, UNITS - 7, s.pierFace ?? pier) + rect(x === 0 ? pw - 2 : x, 7, 2, UNITS - 7, "#00000044");
  // ---- the sign
  const sx = pw, sw = UNITS - pw * 2, sy = 10, sh = s.signH ?? 72;
  if (s.sign === "awning") {
    // painted canvas: the sign's on the valance
    defs.push(grad(id + "a", s.bg, s.bg2 ?? s.bg));
    o += `<path d="M${sx} ${sy} L${sx + sw} ${sy} L${sx + sw} ${sy + sh} L${sx} ${sy + sh} Z" fill="url(#${id}a)"/>`;
    if (s.stripe) for (let k = 0; k * 40 < sw; k += 2) o += rect(sx + k * 40, sy, 40, sh, s.stripe, 'opacity="0.85"');
  } else if (s.sign === "box") {
    o += rect(sx, sy, sw, sh, "#1a1a1c") + rect(sx + 3, sy + 3, sw - 6, sh - 6, s.bg) + rect(sx + 3, sy + 3, sw - 6, sh * 0.18, "#ffffff", 'opacity="0.12"');
  } else if (s.sign === "bare") {
    o += rect(sx, sy, sw, sh, s.bg);
  } else if (s.sign === "painted") {
    o += rect(sx, sy, sw, sh, s.bg) + rect(sx + 5, sy + 5, sw - 10, sh - 10, "none", `stroke="${s.fg}" stroke-width="2"`);
  } else if (s.sign === "ghost") {
    o += rect(sx, sy, sw, sh, s.bg, 'opacity="0.8"');
  }
  if (s.name) {
    const hasSub = !!s.sub;
    o += letters(s.name, sx + 12, sy + sh * 0.12, sw - 24, sh * (hasSub ? 0.5 : 0.72), s.fg, s.font ?? "block", s.drop);
    if (hasSub) o += letters(s.sub, sx + 30, sy + sh * 0.7, sw - 60, sh * 0.2, s.fg2 ?? s.fg, "thin");
  }
  if (s.glyphs) o += s.glyphs(sx, sy, sw, sh);
  // ---- below the sign
  const top = sy + sh + 4, base = UNITS - (s.riserH ?? 54), riserH = s.riserH ?? 54;
  const rc = RISER[s.riser ?? "tile"];
  o += rect(pw, base, UNITS - pw * 2, riserH, rc[0]);
  for (let k = 0; k * 22 < UNITS; k++) if (s.riser === "tile" || s.riser === "brick") o += rect(pw + k * 22, base, 1, riserH, rc[1]);
  if (s.riser === "marble") o += line(pw + 30, base + 8, pw + 130, base + 40, rc[1], 1.5) + line(pw + 210, base + 6, pw + 300, base + 44, rc[1], 1.2);
  // ---- gate, whole or part: these have no glass at all
  if (s.gate === "full") {
    o += rect(pw, top, UNITS - pw * 2, UNITS - top, "#6a6e70");
    for (let y = top; y < UNITS; y += 5) o += rect(pw, y, UNITS - pw * 2, 1.6, "#3e4244");
    o += rect(pw, top - 2, UNITS - pw * 2, 7, "#3a3d40");
    if (s.gatePaint) o += rect(pw + 10, top + 18, UNITS - pw * 2 - 20, UNITS - top - 44, s.gatePaint, 'opacity="0.86"');
    return { o: `<defs>${defs.join("")}</defs>${o}`, mask };
  }
  const door = s.door ?? "right", doorW = s.doorW ?? 86, gapL = pw + 6, gapR = UNITS - pw - 6;
  const doors = door === "none" ? [] : door === "double" ? [[UNITS / 2 - doorW, doorW], [UNITS / 2, doorW]] : door === "left" ? [[gapL, doorW]] : door === "center" ? [[UNITS / 2 - doorW / 2, doorW]] : [[gapR - doorW, doorW]];
  const dx0 = doors.length ? Math.min(...doors.map((d) => d[0])) : -1, dx1 = doors.length ? Math.max(...doors.map((d) => d[0] + d[1])) : -1;
  const windows = door === "none" ? [[gapL, gapR - gapL]] : [[gapL, dx0 - gapL - 6], [dx1 + 6, gapR - dx1 - 6]].filter((w) => w[1] > 40);
  const light = LIGHT[s.light ?? "warm"];
  defs.push(grad(id + "l", light[0], light[1]));
  const frame = s.frame ?? "#1a1a1c";
  windows.forEach(([x, w], k) => {
    const y = top + 5, h = base - y - 3;
    mask.push([x, y, w, h]);
    defs.push(`<clipPath id="${id}w${k}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);
    o += rect(x - 4, y - 4, w + 8, h + 8, frame);
    o += `<g clip-path="url(#${id}w${k})">` + rect(x, y, w, h, `url(#${id}l)`) + INSIDES[s.in](x, y, w, h);
    if (s.film) o += rect(x, y, w, h, s.film, `opacity="${s.filmOp ?? 0.55}"`);
    o += `</g>`;
    if (s.bars) for (let bx = x + 8; bx < x + w; bx += 17) o += rect(bx, y, 2.4, h, "#16161a");
    // window lettering
    if (k === 0 && s.onGlass) o += letters(s.onGlass, x + 10, y + h * 0.05, w - 20, h * 0.15, s.onGlassC ?? "#f6f0dc", s.onGlassF ?? "block");
    if (k === windows.length - 1 && s.neon) {
      const nw = Math.min(w - 16, 110), nx = x + w - nw - 8, ny = y + h * (s.neonY ?? 0.36);
      o += letters(s.neon, nx, ny, nw, 25, s.neonC ?? "#ff4a3a", "neon");
    }
    if (k === 0 && s.stickers) for (let n = 0; n < s.stickers; n++) o += rect(x + 5 + n * 18, y + h - 22, 14, 18, pick(["#e7b52f", "#c8382a", "#efe8d6", "#2c6fb0", "#fff"]), 'opacity="0.95"');
    if (k === 0 && s.papered) {
      o += rect(x, y, w, h, s.papered);
      for (let n = 0; n < 7; n++) { const py = y + between(0, h - 18); o += line(x + 2, py, x + w - 2, py + between(-6, 6), "#00000022", 2); }
    }
  });
  doors.forEach(([x, w], k) => {
    const y = top + 2, h = UNITS - y - 4, ix = x + 9, iy = y + 8, iw = w - 18, ih = h - 54;
    o += rect(x, y, w, h, s.doorC ?? frame);
    mask.push([ix, iy, iw, ih]);
    defs.push(`<clipPath id="${id}d${k}"><rect x="${ix}" y="${iy}" width="${iw}" height="${ih}"/></clipPath>`);
    o += `<g clip-path="url(#${id}d${k})">` + rect(ix, iy, iw, ih, `url(#${id}l)`) + (s.doorIn === false ? "" : INSIDES[s.in === "washers" || s.in === "chairs" ? "dim" : s.in](ix, iy, iw, ih)) + `</g>`;
    o += rect(x + (k === 0 && door === "double" ? w - 13 : 8), y + h * 0.48, 4, 40, "#c8c2a8");
    if (s.hours !== false) o += rect(ix + 4, iy + 10, 30, 20, "#f1ece0", 'opacity="0.9"') + rect(ix + 7, iy + 13, 22, 1.4, "#333") + rect(ix + 7, iy + 17, 18, 1.4, "#333") + rect(ix + 7, iy + 21, 22, 1.4, "#333");
    if (s.papered && k === 0) o += rect(ix, iy, iw, ih, s.papered);
  });
  if (s.gate === "half") {
    const gy = top, gh = (base - top) * (s.gateDown ?? 0.34);
    o += rect(pw, gy, UNITS - pw * 2, gh, "#70747a");
    for (let y = gy; y < gy + gh; y += 5) o += rect(pw, y, UNITS - pw * 2, 1.6, "#3e4244");
    o += rect(pw, gy + gh - 4, UNITS - pw * 2, 5, "#2e3032");
  }
  if (s.extra) o += s.extra(pw, top, base);
  return { o: `<defs>${defs.join("")}</defs>${o}`, mask };
}

const pole = (x, y) => {
  let s = rect(x - 7, y, 14, 90, "#f4f0e6");
  for (let k = 0; k < 5; k++) s += `<path d="M${x - 7} ${y + 8 + k * 18} L${x + 7} ${y - 4 + k * 18} L${x + 7} ${y + 4 + k * 18} L${x - 7} ${y + 16 + k * 18} Z" fill="${k % 2 ? "#2c5fa8" : "#c8302a"}"/>`;
  return s + circle(x, y, 8, "#c8c8c8") + circle(x, y + 90, 8, "#c8c8c8");
};
const crates = (x, y, c) => { let s = ""; for (let k = 0; k < 3; k++) { const cx = x + k * 52; s += rect(cx, y, 48, 34, "#8a6a42"); for (let n = 0; n < 16; n++) s += circle(cx + between(4, 44), y - between(-2, 8), 4, pick(c)); } return s; };

// a few characters, drawn from strokes like everything else
const HANZI = {
  中: [[[0.2, 0.25], [0.2, 0.68]], [[0.2, 0.25], [0.8, 0.25], [0.8, 0.68]], [[0.2, 0.68], [0.8, 0.68]], [[0.5, 0.02], [0.5, 0.98]]],
  山: [[[0.5, 0.05], [0.5, 0.92]], [[0.12, 0.42], [0.12, 0.92], [0.88, 0.92], [0.88, 0.42]]],
  大: [[[0.08, 0.34], [0.92, 0.34]], [[0.5, 0.05], [0.42, 0.45], [0.08, 0.95]], [[0.47, 0.42], [0.92, 0.95]]],
  王: [[[0.15, 0.1], [0.85, 0.1]], [[0.2, 0.5], [0.8, 0.5]], [[0.05, 0.92], [0.95, 0.92]], [[0.5, 0.1], [0.5, 0.92]]],
  天: [[[0.15, 0.1], [0.85, 0.1]], [[0.08, 0.42], [0.92, 0.42]], [[0.5, 0.1], [0.42, 0.5], [0.08, 0.95]], [[0.47, 0.5], [0.92, 0.95]]],
  日: [[[0.2, 0.06], [0.2, 0.95]], [[0.2, 0.06], [0.8, 0.06], [0.8, 0.95]], [[0.2, 0.5], [0.8, 0.5]], [[0.2, 0.95], [0.8, 0.95]]],
  月: [[[0.28, 0.06], [0.24, 0.7], [0.08, 0.95]], [[0.28, 0.06], [0.82, 0.06], [0.82, 0.92], [0.68, 0.86]], [[0.28, 0.36], [0.82, 0.36]], [[0.26, 0.62], [0.82, 0.62]]],
  田: [[[0.12, 0.1], [0.12, 0.92]], [[0.12, 0.1], [0.88, 0.1], [0.88, 0.92]], [[0.12, 0.92], [0.88, 0.92]], [[0.12, 0.5], [0.88, 0.5]], [[0.5, 0.1], [0.5, 0.92]]],
  小: [[[0.5, 0.05], [0.5, 0.82], [0.4, 0.92]], [[0.22, 0.35], [0.06, 0.78]], [[0.76, 0.35], [0.94, 0.78]]],
  口: [[[0.16, 0.14], [0.16, 0.88]], [[0.16, 0.14], [0.84, 0.14], [0.84, 0.88]], [[0.16, 0.88], [0.84, 0.88]]],
};
const hanzi = (chars, color, weight = 0.13) => (sx, sy, sw, sh) => {
  const size = sh * 0.82, x0 = sx + 12;
  let out = "";
  [...chars].forEach((c, n) => {
    const gx = x0 + n * size * 1.04, gy = sy + sh * 0.09;
    for (const stroke of HANZI[c] ?? []) out += `<path d="M${stroke.map(([u, v]) => `${(gx + u * size).toFixed(1)} ${(gy + v * size).toFixed(1)}`).join("L")}" fill="none" stroke="${color}" stroke-width="${(size * weight).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return out;
};

// ------------------------------------------------------------------ the shops

const GENERIC = [
  { name: "SAL'S PIZZA", sub: "BY THE SLICE", sign: "box", bg: "#c8302a", fg: "#fff4dc", drop: "#6a1410", in: "pizza", light: "warm", door: "left", riser: "tile", neon: "HOT", neonC: "#ff6a2a", stickers: 3 },
  { name: "MILANO DELI", sub: "HEROES COLD CUTS", sign: "painted", bg: "#21483a", fg: "#f0e6c8", in: "hanging", light: "warm", door: "right", riser: "green", onGlass: "COFFEE TO GO" },
  { name: "GROCERY", sub: "TOBACCO LOTTO ATM", sign: "box", bg: "#e7c52f", fg: "#1a1208", in: "groceries", light: "fluoro", door: "center", doorW: 80, riser: "steel", neon: "OPEN", stickers: 5, extra: (p, t, b) => crates(p + 8, b - 8, ["#c8382a", "#e0872a", "#57803c"]) },
  { name: "SPIN CYCLE", sub: "LAUNDROMAT", sign: "box", bg: "#2c6fb0", fg: "#ffffff", font: "slab", in: "washers", light: "cool", door: "left", doorW: 74, riser: "steel", onGlass: "WASH DRY FOLD", onGlassC: "#2c6fb0" },
  { name: "LUCKY NAILS", sign: "box", bg: "#e88ab2", fg: "#ffffff", font: "script", drop: "#a0406a", in: "chairs", light: "white", door: "right", riser: "marble", neon: "NAILS", neonC: "#ff5fae", film: "#ffd8ea", filmOp: 0.14 },
  { name: "TONY'S BARBER", sign: "painted", bg: "#f2ece0", fg: "#a02420", in: "chairs", light: "fluoro", door: "right", doorW: 74, riser: "black", extra: (p, t, b) => pole(p + 12, t + 22), neon: "CUTS", neonC: "#3fb4ff" },
  { name: "WINES", sub: "AND LIQUORS", sign: "bare", bg: "#101014", fg: "#e8c868", font: "slab", in: "bottles", light: "warm", door: "left", riser: "wood", bars: true, neon: "COLD BEER", neonC: "#ff4a3a" },
  { name: "PHARMACY", sub: "PRESCRIPTIONS", sign: "box", bg: "#f4f1e8", fg: "#2f8a55", font: "slab", in: "groceries", light: "white", door: "center", riser: "steel", film: "#ffffff", filmOp: 0.22, onGlass: "FLU SHOTS", onGlassC: "#c8382a" },
  { name: "ACE HARDWARE CO", sign: "painted", bg: "#c8382a", fg: "#fff8e8", in: "tools", light: "fluoro", door: "right", riser: "brick", onGlass: "KEYS CUT" },
  { name: "PAWN", sub: "WE BUY GOLD", sign: "box", bg: "#e7b52f", fg: "#1a1208", font: "slab", in: "jewels", light: "dim", door: "right", doorW: 72, riser: "black", bars: true, neon: "CASH", neonC: "#37e06a" },
  { name: "CELL WORLD", sub: "REPAIR UNLOCK", sign: "box", bg: "#101a30", fg: "#3fd0ff", font: "slab", in: "screens", light: "cool", door: "left", doorW: 74, riser: "steel", stickers: 6 },
  { name: "SHOE REPAIR", sub: "WHILE YOU WAIT", sign: "painted", bg: "#3a2616", fg: "#ecd9a8", font: "block", in: "racks", light: "warm", door: "right", riser: "wood", papered: null, onGlass: "HEELS 10" },
  { name: "PETALS", sub: "FLOWERS", sign: "painted", bg: "#f2ece0", fg: "#2f6a42", font: "script", in: "flowers", light: "white", door: "left", riser: "green", extra: (p, t, b) => crates(p + 150, b - 8, ["#d9558a", "#e7b52f", "#e8e2d2"]) },
  { name: "CRUST", sub: "BAKERY SINCE 1931", sign: "painted", bg: "#e8d9b8", fg: "#5a2f18", font: "script", in: "cakes", light: "gold", door: "center", doorW: 80, riser: "marble", onGlass: "FRESH DAILY", onGlassC: "#f4e8c8" },
  { name: "PRIME CUTS", sub: "BUTCHER", sign: "bare", bg: "#7a1f1c", fg: "#f6efe0", font: "slab", in: "hanging", light: "fluoro", door: "left", riser: "tile", doorW: 74 },
  { name: "ROYAL DINER", sub: "OPEN 24 HOURS", sign: "box", bg: "#d8dee0", fg: "#b5322a", font: "script", drop: "#5a1a16", in: "counter", light: "warm", door: "center", riser: "steel", neon: "EAT", neonC: "#ff4a3a", frame: "#8a8d90" },
  { name: "THE LOCAL", sign: "bare", bg: "#14100c", fg: "#d9b860", font: "block", in: "bar", light: "dim", door: "right", doorW: 82, riser: "wood", neon: "BEER", neonC: "#ffb03a", doorC: "#3a2010", hours: false },
  { name: "O'MALLEY'S", sub: "PUB", sign: "painted", bg: "#17402e", fg: "#e4c777", font: "block", in: "bar", light: "dim", door: "left", riser: "green", doorC: "#17402e", neon: "GUINEA ALE", neonC: "#ff5a2a", hours: false },
  { name: "GRIND", sub: "COFFEE", sign: "bare", bg: "#26221e", fg: "#ece4d2", font: "thin", in: "counter", light: "gold", door: "right", riser: "wood", doorC: "#26221e", onGlass: "ESPRESSO", onGlassC: "#ece4d2", onGlassF: "thin" },
  { name: "USED BOOKS", sign: "painted", bg: "#2a3f5a", fg: "#efe4c8", font: "block", in: "books", light: "gold", door: "right", doorW: 78, riser: "wood", onGlass: "CHEAP READS" },
  { name: "VINYL HEAVEN", sub: "RECORDS", sign: "painted", bg: "#111114", fg: "#ee6aa0", font: "script", in: "books", light: "dim", door: "left", riser: "black", neon: "RECORDS", neonC: "#ff5fae", stickers: 7 },
  { name: "SECOND HAND", sign: "bare", bg: "#c47a2a", fg: "#1a1208", font: "slab", in: "racks", light: "warm", door: "center", riser: "brick", onGlass: "THRIFT" },
  { name: "BIG EYE", sub: "OPTICAL", sign: "box", bg: "#ffffff", fg: "#1e4fa8", font: "slab", in: "jewels", light: "white", door: "left", doorW: 74, riser: "marble", frame: "#b8bcc0" },
  { name: "ALTERATIONS", sub: "TAILOR DRY CLEAN", sign: "box", bg: "#e8e4d8", fg: "#26408a", font: "block", in: "racks", light: "fluoro", door: "right", riser: "steel", neon: "1 HOUR", neonC: "#3fb4ff" },
  { name: "COSMOS TRAVEL", sub: "CHEAP FLIGHTS", sign: "painted", bg: "#2f7f96", fg: "#fff4d8", font: "block", in: "gallery", light: "white", door: "left", doorW: 74, riser: "tile", stickers: 4, onGlass: "VISAS", onGlassC: "#c8382a" },
  { name: "INK LAB", sub: "TATTOO", sign: "bare", bg: "#0e0e10", fg: "#d9d6cc", font: "slab", in: "dim", light: "red", door: "right", doorW: 74, riser: "black", neon: "TATTOO", neonC: "#ff3a3a", neonY: 0.3, doorC: "#0e0e10" },
  { name: "FOR LEASE", sub: "212 555 0142", sign: "ghost", bg: "#c8c4b8", fg: "#c8302a", font: "slab", in: "dim", light: "dim", door: "right", doorW: 74, riser: "brick", papered: "#c4b89a", hours: false },
  { sign: "ghost", bg: "#55504a", name: "CLOSED", fg: "#3a3632", font: "thin", gate: "full", gatePaint: null, in: "dim", riser: "brick" },
  { name: "KIM'S MARKET", sign: "awning", bg: "#2f7a42", stripe: "#f2ece0", fg: "#14281c", font: "slab", in: "groceries", light: "fluoro", door: "center", riser: "steel", extra: (p, t, b) => crates(p + 6, b - 8, ["#c8382a", "#e7c52f", "#57803c", "#e0872a"]) },
  { name: "MUNDO", sub: "99 CENTS", sign: "box", bg: "#e8421e", fg: "#fff14a", font: "slab", drop: "#6a1a08", in: "groceries", light: "fluoro", door: "left", riser: "steel", stickers: 8, gate: "half", gateDown: 0.18 },
  { name: "HONG FA", sub: "MASSAGE", sign: "box", bg: "#6a1a4a", fg: "#ffd8a0", font: "script", in: "dim", light: "red", door: "right", doorW: 74, riser: "black", film: "#2a0e1a", filmOp: 0.7, neon: "OPEN", neonC: "#ff3ab0" },
  { sign: "bare", bg: "#2a2a2c", name: "BODEGA", fg: "#f2d64a", font: "slab", gate: "half", gateDown: 0.62, in: "groceries", light: "fluoro", door: "right", riser: "steel" },
];
const CHINATOWN = [
  { glyphs: hanzi("中山", "#ffd868"), sign: "box", bg: "#b5201c", name: null, in: "groceries", light: "fluoro", door: "left", riser: "tile", extra: (p, t, b) => letters("GIFTS", p + 240, 26, 140, 34, "#ffe8b8", "block") },
  { glyphs: hanzi("大王", "#f6f0dc"), sign: "painted", bg: "#14503a", fg: "#e7c868", in: "fish", light: "cool", door: "right", riser: "steel", extra: (p) => letters("SEAFOOD", p + 220, 28, 170, 34, "#f6f0dc", "slab") },
  { glyphs: hanzi("天日", "#c81e1e"), sign: "box", bg: "#f2c52a", in: "hanging", light: "warm", door: "left", doorW: 74, riser: "tile", extra: (p) => letters("BBQ", p + 250, 26, 100, 36, "#a01616", "slab") },
  { glyphs: hanzi("日月", "#ffffff"), sign: "box", bg: "#1e4fa8", in: "counter", light: "warm", door: "center", doorW: 76, riser: "marble", extra: (p) => letters("NOODLES", p + 215, 28, 175, 34, "#fff8d8", "block") },
  { glyphs: hanzi("小山", "#f8e8c0"), sign: "bare", bg: "#7a1c26", in: "bottles", light: "gold", door: "right", riser: "wood", extra: (p) => letters("TEA HERBS", p + 215, 28, 175, 32, "#f8e8c0", "thin") },
  { glyphs: hanzi("田中", "#1a1a1a"), sign: "painted", bg: "#ede4cc", fg: "#8a2a22", in: "cakes", light: "warm", door: "left", riser: "brick", extra: (p) => letters("BAKERY", p + 225, 28, 165, 34, "#8a2a22", "block") },
  { glyphs: hanzi("大中", "#ffe08a"), sign: "box", bg: "#3a1e6a", in: "screens", light: "cool", door: "right", doorW: 74, riser: "steel", extra: (p) => letters("PHONE CARDS", p + 205, 30, 190, 28, "#ffffff", "slab"), stickers: 6 },
  { glyphs: hanzi("王口", "#ffffff"), sign: "box", bg: "#c86a1e", in: "groceries", light: "fluoro", door: "center", riser: "steel", extra: (p, t, b) => letters("MARKET", p + 225, 28, 165, 34, "#fff4d8", "slab") + crates(p + 8, b - 8, ["#57803c", "#e7c52f", "#d0d8a0"]) },
  { glyphs: hanzi("天中", "#f2d27a"), sign: "bare", bg: "#17171a", in: "jewels", light: "dim", door: "left", doorW: 74, riser: "black", bars: true, extra: (p) => letters("JEWELRY", p + 220, 28, 170, 32, "#f2d27a", "thin") },
  { glyphs: hanzi("山田", "#c81e1e"), sign: "ghost", bg: "#d8d2c0", gate: "half", gateDown: 0.45, in: "dim", light: "dim", door: "right", riser: "brick" },
];
const SOHO = [
  { name: "ATELIER NORD", sign: "bare", bg: "#111113", fg: "#ece8dc", font: "thin", in: "mannequins", light: "white", door: "right", doorW: 78, riser: "black", pier: "#17171a", pierW: 20, frame: "#0a0a0c" },
  { name: "SELVEDGE", sign: "bare", bg: "#3a2f26", fg: "#e8ddc4", font: "thin", in: "racks", light: "gold", door: "left", riser: "wood", pier: "#201c18", pierW: 20 },
  { name: "GALERIE 41", sign: "bare", bg: "#f4f1ea", fg: "#1a1a1c", font: "thin", in: "gallery", light: "white", door: "center", doorW: 74, riser: "black", pier: "#1a1a1e", pierW: 20, frame: "#101012", hours: false },
  { name: "PARADIS", sign: "bare", bg: "#0e0e10", fg: "#d8b870", font: "thin", in: "jewels", light: "dim", door: "right", doorW: 72, riser: "marble", pier: "#22222a", pierW: 20 },
  { name: "OAK AND IRON", sub: "ANTIQUES", sign: "painted", bg: "#2c3a36", fg: "#d8ccaa", font: "block", in: "antiques", light: "gold", door: "left", riser: "green", pier: "#1c2422", pierW: 20 },
  { name: "SOFT GOODS", sign: "bare", bg: "#e8e0d0", fg: "#3a3028", font: "thin", in: "mannequins", light: "gold", door: "right", riser: "wood", pier: "#3a342c", pierW: 20 },
  { name: "PAPER MOON", sub: "STATIONERS", sign: "painted", bg: "#c8b89a", fg: "#2a2622", font: "script", in: "books", light: "gold", door: "left", doorW: 76, riser: "wood", pier: "#2a2622", pierW: 20 },
  { name: "HALF PRICE", sub: "SAMPLE SALE", sign: "ghost", bg: "#efe8d6", fg: "#c8302a", font: "slab", in: "racks", light: "fluoro", door: "center", riser: "black", pier: "#17171a", pierW: 20, stickers: 2, onGlass: "LAST DAYS", onGlassC: "#c8302a" },
  { name: "VERDE", sub: "PLANTS", sign: "painted", bg: "#23412f", fg: "#e8e2c6", font: "script", in: "flowers", light: "white", door: "right", riser: "green", pier: "#17201a", pierW: 20 },
  { name: "THE ROOM", sub: "COCKTAILS", sign: "bare", bg: "#0a0a0c", fg: "#c8a860", font: "thin", in: "bar", light: "dim", door: "left", doorW: 72, riser: "black", pier: "#121216", pierW: 20, neon: "OPEN", neonC: "#ff7a3a", hours: false, doorC: "#0a0a0c" },
];
const MIDTOWN = [
  { name: "NY SOUVENIRS", sub: "I LOVE THIS TOWN", sign: "box", bg: "#d81e3a", fg: "#ffffff", font: "slab", drop: "#6a0e1c", in: "racks", light: "fluoro", door: "center", riser: "steel", neon: "SALE", neonC: "#ffe23a", stickers: 8 },
  { name: "SNACK EXPRESS", sign: "box", bg: "#ffd21e", fg: "#c81e1e", font: "slab", in: "groceries", light: "white", door: "right", riser: "steel", neon: "OPEN", onGlass: "HOT PRETZELS", onGlassC: "#c81e1e" },
  { name: "TICKETS", sub: "BROADWAY SHOWS", sign: "box", bg: "#20184e", fg: "#ffcf4a", font: "slab", in: "screens", light: "cool", door: "left", riser: "marble", neon: "TODAY", neonC: "#ff4a8a" },
  { name: "FIRST UNION", sub: "BANK", sign: "box", bg: "#0f2f5a", fg: "#f2f0e6", font: "thin", in: "gallery", light: "white", door: "double", doorW: 70, riser: "marble", frame: "#8a8d90", pier: "#8c867c", hours: false },
  { name: "BURGER PALACE", sign: "box", bg: "#e8421e", fg: "#fff4c8", font: "script", drop: "#7a1a08", in: "counter", light: "warm", door: "left", riser: "tile", neon: "OPEN LATE", neonC: "#ffb03a" },
  { name: "ELECTRONICS", sub: "CAMERAS LUGGAGE", sign: "box", bg: "#101014", fg: "#3af0a0", font: "slab", in: "screens", light: "dim", door: "right", doorW: 74, riser: "black", gate: "half", gateDown: 0.14, stickers: 5 },
  { name: "BROADWAY DELI", sign: "painted", bg: "#2a2a2c", fg: "#f6d36a", font: "block", in: "hanging", light: "warm", door: "center", doorW: 76, riser: "marble", neon: "PASTRAMI", neonC: "#ff4a3a" },
  { name: "SUPREME SHOES", sign: "box", bg: "#f6f4ec", fg: "#101014", font: "slab", in: "racks", light: "white", door: "left", riser: "black", frame: "#2a2a2e", onGlass: "SALE", onGlassC: "#e03030" },
];
const LOBBY = [
  { name: "ONE TWENTY", sign: "bare", bg: "#3a3026", fg: "#d8b870", font: "thin", in: "gallery", light: "gold", door: "double", doorW: 92, riser: "marble", frame: "#7a6236", pier: "#8c867c", hours: false, doorIn: false },
  { name: "THE ASTOR", sign: "bare", bg: "#20201e", fg: "#e0c070", font: "thin", in: "dim", light: "gold", door: "center", doorW: 110, riser: "black", frame: "#6a5228", pier: "#a09a8e", hours: false },
  { name: "45 EAST", sign: "bare", bg: "#c8c4b8", fg: "#2a2a2c", font: "thin", in: "gallery", light: "white", door: "double", doorW: 90, riser: "steel", frame: "#3a3c40", pier: "#b4b0a4", hours: false, doorIn: false },
  { name: "TOWER RESIDENCES", sign: "bare", bg: "#1a1d22", fg: "#c8ccd0", font: "thin", in: "dim", light: "gold", door: "center", doorW: 110, riser: "marble", frame: "#1a1d22", pier: "#46484c", hours: false },
];

const ALL = [...GENERIC, ...CHINATOWN, ...SOHO, ...MIDTOWN, ...LOBBY];
if (GENERIC.length !== 32 || CHINATOWN.length !== 10 || SOHO.length !== 10 || MIDTOWN.length !== 8 || LOBBY.length !== 4) throw new Error(`sheet ranges are off: ${[GENERIC, CHINATOWN, SOHO, MIDTOWN, LOBBY].map((l) => l.length)}`);

// ------------------------------------------------------------------ the sheet
const scale = (CELL - GUTTER * 2) / UNITS;
let colour = "", masks = "";
ALL.forEach((spec, i) => {
  const cx = (i % 8) * CELL, cy = Math.floor(i / 8) * CELL;
  const { o, mask } = shop(i, spec);
  // the gutter's filled with the cell's own edge colours by drawing the shop slightly oversize beneath itself
  const t = `translate(${cx + GUTTER} ${cy + GUTTER}) scale(${scale})`;
  colour += `<clipPath id="c${i}"><rect x="${cx}" y="${cy}" width="${CELL}" height="${CELL}"/></clipPath><g clip-path="url(#c${i})"><g transform="translate(${cx} ${cy}) scale(${CELL / UNITS})">${rect(0, 0, UNITS, UNITS, spec.pier ?? "#4a4440")}</g><g filter="url(#age)" transform="${t}">${o}</g></g>`;
  masks += `<g transform="${t}">${mask.map(([x, y, w, h]) => rect(x, y, w, h, "#ffffff")).join("")}</g>`;
});
const svg = (body, bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><defs><filter id="age" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="4" seed="8" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 0 0.08  0.62 0 0 0 -0.24" result="dirt"/><feComposite in="dirt" in2="SourceGraphic" operator="atop"/></filter></defs><rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>${body}</svg>`);
const rgb = await sharp(svg(colour.replace(/&/g, "&amp;"), "#332e2a")).removeAlpha().raw().toBuffer();
const maskPx = await sharp(svg(masks, "#000000")).removeAlpha().raw().toBuffer();
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  out[i * 4] = rgb[i * 3]; out[i * 4 + 1] = rgb[i * 3 + 1]; out[i * 4 + 2] = rgb[i * 3 + 2];
  out[i * 4 + 3] = maskPx[i * 3] > 127 ? 255 : 160;
}
await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 85, alphaQuality: 100, effort: 5 }).toFile(path.join(OUT, "shops.webp"));
console.log("shops:", ALL.length, Math.round(fs.statSync(path.join(OUT, "shops.webp")).size / 1024), "KB");
