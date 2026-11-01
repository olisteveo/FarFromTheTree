// The wall art atlas: ghost signs, graffiti, wheatpaste posters and the leaf stencil, for render/wallArt.ts.
//
//   node tools/block/wall_art.mjs    -> public/textures/block/wall_art.webp + wall_art.json
//
// Everything is drawn from the stroke alphabet below rather than fonts, so there is nothing to license
// and the same letters can be a sign painter's gothic, a marker tag or a fat throw-up. All names and
// brands are invented.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { LETTERS, WIDE, wordWith } from "./letters.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/textures/block");
const SIZE = 4096;

let seed = 1;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const between = (a, b) => a + rand() * (b - a);
const esc = (s) => s.replace(/&/g, "&amp;");

const word = wordWith(between);

const stroke = (d, color, width, extra = "") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

/** Paint runs: thin vertical lines from random points along the bottom of a box. */
function drips(x, y, w, color, n, width, maxLen) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const dx = x + rand() * w, len = between(maxLen * 0.2, maxLen);
    s += `<line x1="${dx.toFixed(1)}" y1="${y}" x2="${dx.toFixed(1)}" y2="${(y + len).toFixed(1)}" stroke="${color}" stroke-width="${between(width * 0.5, width).toFixed(1)}" stroke-linecap="round"/>`;
  }
  return s;
}

// ------------------------------------------------------------------ the pieces

/** A painted sign a century old: flat colour, sign-painter letters, most of the paint gone. */
function ghostSign(cell, lines, bg, fg, filter) {
  const { x, y, w, h } = cell;
  const pad = w * 0.05;
  let s = `<g filter="url(#${filter})"><rect x="${x + pad * 0.3}" y="${y + pad * 0.3}" width="${w - pad * 0.6}" height="${h - pad * 0.6}" fill="${bg}"/>`;
  s += `<rect x="${x + pad}" y="${y + pad}" width="${w - pad * 2}" height="${h - pad * 2}" fill="none" stroke="${fg}" stroke-width="${w * 0.008}"/>`;
  const total = lines.reduce((n, l) => n + l.size, 0);
  let ly = y + pad * 1.8;
  const usable = h - pad * 3.6;
  for (const l of lines) {
    const lh = (l.size / total) * usable;
    s += `<path d="${word(l.text, x + pad * 1.6, ly + lh * 0.1, w - pad * 3.2, lh * 0.76, { gap: 0.2 })}" fill="none" stroke="${l.color ?? fg}" stroke-width="${lh * (l.weight ?? 0.13)}" stroke-linecap="butt" stroke-linejoin="miter"/>`;
    ly += lh;
  }
  return s + `</g>`;
}

/** A marker or spray-can tag: one quick line of letters, an underline, and a run or two. */
function tag(cell, text, color, { width = 0.075, under = true, slant = 0.32, spray = false } = {}) {
  const { x, y, w, h } = cell;
  const d = word(text, x + w * 0.06, y + h * 0.16, w * 0.86, h * 0.56, { jitter: 0.045, slant, gap: 0.04, bounce: 0.06 });
  const sw = h * width;
  let s = `<g ${spray ? 'filter="url(#spray)"' : ""}>` + stroke(d, color, sw);
  if (under) s += stroke(`M${x + w * 0.1} ${y + h * 0.83}Q${x + w * 0.5} ${y + h * 0.72} ${x + w * 0.93} ${y + h * 0.8}`, color, sw * 0.8);
  s += drips(x + w * 0.2, y + h * 0.72, w * 0.6, color, spray ? 4 : 2, sw * 0.42, h * 0.2);
  return s + `</g>`;
}

/** A throw-up: fat rounded letters, one quick fill, a hard outline and a drop shadow. */
function throwUp(cell, text, fill, line, shadow) {
  const { x, y, w, h } = cell;
  const d = word(text, x + w * 0.08, y + h * 0.22, w * 0.84, h * 0.46, { jitter: 0.02, slant: 0.1, gap: 0.42, bounce: 0.03 });
  const sw = h * 0.17;
  let s = `<g filter="url(#spray)">`;
  s += stroke(d, shadow, sw + h * 0.07, `transform="translate(${h * 0.045} ${h * 0.05})"`);
  s += stroke(d, line, sw + h * 0.06);
  s += stroke(d, fill, sw);
  s += stroke(d, "#ffffff", sw * 0.16, `transform="translate(${-sw * 0.16} ${-sw * 0.2})" opacity="0.55"`);
  s += drips(x + w * 0.12, y + h * 0.8, w * 0.76, fill, 7, sw * 0.17, h * 0.17);
  return s + `</g>`;
}

/** A proper piece, the kind that takes a night: letters over a colour field, with a burst behind. */
function piece(cell, text, a, b, c, bgA, bgB) {
  const { x, y, w, h } = cell;
  const id = "p" + Math.round(x + y);
  let s = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>`;
  s += `<g filter="url(#spray)">`;
  // the cloud behind the letters
  for (let i = 0; i < 26; i++) {
    const cx = x + w * (0.04 + 0.92 * (i / 25)), cy = y + h * between(0.34, 0.66), r = h * between(0.22, 0.42);
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${i % 2 ? bgA : bgB}"/>`;
  }
  for (let i = 0; i < 40; i++) {
    const cx = x + w * rand(), cy = y + h * between(0.06, 0.94);
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(h * between(0.006, 0.02)).toFixed(1)}" fill="#fff" opacity="0.8"/>`;
  }
  const d = word(text, x + w * 0.06, y + h * 0.2, w * 0.88, h * 0.52, { jitter: 0.022, slant: 0.18, gap: 0.46, bounce: 0.05 });
  const sw = h * 0.15;
  s += stroke(d, "#0b0a12", sw + h * 0.09, `transform="translate(${h * 0.05} ${h * 0.06})"`);
  s += stroke(d, "#0b0a12", sw + h * 0.055);
  s += stroke(d, "#fdfdf7", sw + h * 0.022);
  s += stroke(d, `url(#${id})`, sw);
  s += stroke(d, "#ffffff", sw * 0.13, `transform="translate(${-sw * 0.2} ${-sw * 0.24})" opacity="0.7"`);
  return s + `</g>`;
}

/** One paper poster with a torn edge. */
function poster(x, y, w, h, paper, ink, title, sub) {
  const pts = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) pts.push([x + (w * i) / steps, y + between(-0.012, 0.012) * h]);
  for (let i = 0; i <= steps; i++) pts.push([x + w + between(-0.015, 0.015) * w, y + (h * i) / steps]);
  for (let i = steps; i >= 0; i--) pts.push([x + (w * i) / steps, y + h + between(-0.03, 0.012) * h]);
  for (let i = steps; i >= 0; i--) pts.push([x + between(-0.012, 0.02) * w, y + (h * i) / steps]);
  let s = `<polygon points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" fill="${paper}"/>`;
  const t = word(title, x + w * 0.07, y + h * 0.12, w * 0.86, h * 0.34, { gap: 0.2 });
  s += `<path d="${t}" fill="none" stroke="${ink}" stroke-width="${h * 0.052}" stroke-linecap="square" stroke-linejoin="miter"/>`;
  s += `<rect x="${x + w * 0.08}" y="${y + h * 0.55}" width="${w * 0.84}" height="${h * 0.012}" fill="${ink}"/>`;
  const u = word(sub, x + w * 0.1, y + h * 0.62, w * 0.8, h * 0.14, { gap: 0.25 });
  s += `<path d="${u}" fill="none" stroke="${ink}" stroke-width="${h * 0.02}" stroke-linecap="square"/>`;
  return s;
}

const GIGS = [
  ["#efe6cf", "#c8301f", "RATS", "BOWERY FRI 9PM"], ["#16161a", "#f2d64a", "KILN", "SAT NO COVER"], ["#d94f2b", "#fff4dc", "SOFT CAB", "LAST SHOW"],
  ["#2a5a8a", "#f6f0dc", "NIGHT FERRY", "ALL AGES"], ["#f4efe3", "#141414", "VOTE NO", "ON BLOCK 44"], ["#e3b82e", "#17120a", "LOST CAT", "ANSWERS TO TONY"],
  ["#efe6cf", "#1f5a3a", "SALSICCIA", "SUN STREET FAIR"], ["#101014", "#ee6aa0", "PIGEON", "IN THE WALLS"],
];

function wheatpaste(cell, count) {
  const { x, y, w, h } = cell;
  let s = `<g filter="url(#paper)">`;
  const cols = Math.ceil(Math.sqrt(count * (w / h))), rows = Math.ceil(count / cols);
  const pw = w / cols, ph = h / rows;
  for (let i = 0; i < count; i++) {
    const g = GIGS[Math.floor(rand() * GIGS.length)];
    const cx = x + (i % cols) * pw + pw * 0.04, cy = y + Math.floor(i / cols) * ph + ph * 0.04;
    s += `<g transform="rotate(${between(-2.2, 2.2).toFixed(2)} ${(cx + pw / 2).toFixed(1)} ${(cy + ph / 2).toFixed(1)})">` + poster(cx, cy, pw * 0.92, ph * 0.92, g[0], g[1], g[2], g[3]) + `</g>`;
  }
  return s + `</g>`;
}

/** The game's own mark: someone in this city has been stencilling a leaf. */
function leafStencil(cell, color, label) {
  const { x, y, w, h } = cell;
  const cx = x + w / 2, cy = y + h * 0.4, r = Math.min(w, h) * 0.38;
  const outline = [[0, -1], [0.13, -0.62], [0.32, -0.74], [0.27, -0.34], [0.62, -0.5], [0.56, -0.32], [0.98, -0.3], [0.86, -0.12], [0.98, 0.02], [0.56, 0.2], [0.6, 0.38], [0.2, 0.34], [0.04, 0.42], [0.04, 0.98], [-0.04, 0.98], [-0.04, 0.42], [-0.2, 0.34], [-0.6, 0.38], [-0.56, 0.2], [-0.98, 0.02], [-0.86, -0.12], [-0.98, -0.3], [-0.56, -0.32], [-0.62, -0.5], [-0.27, -0.34], [-0.32, -0.74], [-0.13, -0.62]];
  const pts = outline.map(([a, b]) => `${(cx + a * r).toFixed(1)},${(cy + b * r).toFixed(1)}`).join(" ");
  const id = "leafcut" + Math.round(x);
  const veins = `M${cx} ${cy - r * 0.8}L${cx} ${cy + r * 0.36}M${cx} ${cy + r * 0.2}L${cx - r * 0.72} ${cy - r * 0.14}M${cx} ${cy + r * 0.2}L${cx + r * 0.72} ${cy - r * 0.14}M${cx} ${cy - r * 0.02}L${cx - r * 0.4} ${cy - r * 0.5}M${cx} ${cy - r * 0.02}L${cx + r * 0.4} ${cy - r * 0.5}`;
  let s = `<mask id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/><polygon points="${pts}" fill="#fff"/><path d="${veins}" stroke="#000" stroke-width="${r * 0.045}" fill="none"/></mask>`;
  s += `<g filter="url(#spray)"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" mask="url(#${id})"/>`;
  if (label) s += `<path d="${word(label, x + w * 0.14, y + h * 0.84, w * 0.72, h * 0.1, { gap: 0.28 })}" fill="none" stroke="${color}" stroke-width="${h * 0.022}" stroke-linecap="butt"/>`;
  return s + `</g>`;
}


// ------------------------------------------------------------------ more hands

/** Wildstyle: letters broken up with arrows and spikes off every stroke end; barely readable, which is the point. */
function wildstyle(cell, text, a, b, line) {
  const { x, y, w, h } = cell;
  const id = "w" + Math.round(x + y);
  const d = word(text, x + w * 0.08, y + h * 0.24, w * 0.84, h * 0.46, { jitter: 0.07, slant: 0.34, gap: 0.12, bounce: 0.12 });
  const sw = h * 0.1;
  let s = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><g filter="url(#spray)">`;
  // an arrow off the end of each stroke
  const ends = [...d.matchAll(/M([\d.]+) ([\d.]+)((?:L[\d.]+ [\d.]+)*)/g)];
  let arrows = "";
  for (const m of ends) {
    const pts = (m[3].match(/[\d.]+ [\d.]+/g) ?? []).map((q) => q.split(" ").map(Number));
    if (!pts.length) continue;
    const [ex, ey] = pts[pts.length - 1], [px, py] = pts.length > 1 ? pts[pts.length - 2] : [+m[1], +m[2]];
    const L = Math.hypot(ex - px, ey - py) || 1, ux = (ex - px) / L, uy = (ey - py) / L, A = h * between(0.12, 0.22);
    const tipx = ex + ux * A, tipy = ey + uy * A;
    arrows += `<polygon points="${(ex - uy * A * 0.55).toFixed(1)},${(ey + ux * A * 0.55).toFixed(1)} ${tipx.toFixed(1)},${tipy.toFixed(1)} ${(ex + uy * A * 0.55).toFixed(1)},${(ey - ux * A * 0.55).toFixed(1)}" fill="url(#${id})" stroke="${line}" stroke-width="${h * 0.018}"/>`;
  }
  s += stroke(d, line, sw + h * 0.05, `transform="translate(${h * 0.03} ${h * 0.035})"`);
  s += stroke(d, line, sw + h * 0.035);
  s += arrows;
  s += stroke(d, `url(#${id})`, sw);
  return s + `</g>`;
}

/** Chrome: the silver throw-up that goes up fast and covers a whole shutter. */
function chrome(cell, text, shadow) {
  const { x, y, w, h } = cell;
  const id = "c" + Math.round(x + y);
  const d = word(text, x + w * 0.07, y + h * 0.2, w * 0.86, h * 0.54, { jitter: 0.012, slant: 0.05, gap: 0.42 });
  const sw = h * 0.19;
  let s = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f8fa"/><stop offset="0.48" stop-color="#b6bcc4"/><stop offset="0.52" stop-color="#6e747c"/><stop offset="1" stop-color="#d8dce0"/></linearGradient></defs><g filter="url(#spray)">`;
  s += stroke(d, shadow, sw + h * 0.06, `transform="translate(${h * 0.06} ${h * 0.06})"`);
  s += stroke(d, "#07080c", sw + h * 0.055);
  s += stroke(d, `url(#${id})`, sw);
  return s + `</g>`;
}

/** A blockbuster: huge square letters laid down with a roller, one coat, the wall showing through the strokes. */
function blockbuster(cell, text, fill, edge) {
  const { x, y, w, h } = cell;
  const d = word(text, x + w * 0.04, y + h * 0.14, w * 0.92, h * 0.68, { gap: 0.3 });
  const sw = h * 0.22;
  let s = `<g filter="url(#roller)">`;
  s += `<path d="${d}" fill="none" stroke="${edge}" stroke-width="${sw + h * 0.05}" stroke-linecap="square" stroke-linejoin="miter"/>`;
  s += `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${sw}" stroke-linecap="square" stroke-linejoin="miter"/>`;
  return s + `</g>`;
}

/** Bubble letters, pink and puffy, with stars: somebody's first big piece. */
function bubble(cell, text, fill, line) {
  const { x, y, w, h } = cell;
  const d = word(text, x + w * 0.1, y + h * 0.24, w * 0.8, h * 0.42, { jitter: 0.03, gap: 0.5, bounce: 0.08 });
  const sw = h * 0.22;
  let s = `<g filter="url(#spray)">`;
  s += stroke(d, line, sw + h * 0.05) + stroke(d, fill, sw);
  s += stroke(d, "#ffffff", sw * 0.28, `transform="translate(${-sw * 0.14} ${-sw * 0.2})" opacity="0.6"`);
  for (let i = 0; i < 7; i++) {
    const cx = x + w * rand(), cy = y + h * (rand() < 0.5 ? between(0.06, 0.16) : between(0.84, 0.94)), r = h * between(0.03, 0.06);
    s += `<polygon points="${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k * Math.PI) / 4, q = k % 2 ? r * 0.3 : r; return `${(cx + Math.cos(a) * q).toFixed(1)},${(cy + Math.sin(a) * q).toFixed(1)}`; }).join(" ")}" fill="#fff4b0"/>`;
  }
  return s + `</g>`;
}

/** A tag wall: years of hands on top of each other, every colour of marker. */
function tagWall(cell, count) {
  const { x, y, w, h } = cell;
  const names = ["SIK9", "NUTZ", "KAPS", "ROOF", "RUBE", "OZZ", "BLOK", "MR TOM", "EL OSO", "JUNE", "T-BONE", "DUKE7", "ZIP", "RAZA", "MOSS"];
  const inks = ["#101014", "#17171c", "#d32f3f", "#1e6fd0", "#e8e6df", "#1f8a4a", "#f2c230", "#8a2cc4", "#c7c9cc"];
  let s = `<g filter="url(#spray)">`;
  for (let i = 0; i < count; i++) {
    const tw = w * between(0.18, 0.4), th = tw * between(0.26, 0.4), tx = x + rand() * (w - tw), ty = y + rand() * (h - th);
    const d = word(names[Math.floor(rand() * names.length)], tx, ty, tw, th, { jitter: 0.05, slant: between(0.1, 0.5), gap: 0.03, bounce: 0.06 });
    s += stroke(d, inks[Math.floor(rand() * inks.length)], th * between(0.05, 0.1));
  }
  return s + `</g>`;
}

/** A corner memorial: wings, a name, the dates, flowers. Every neighbourhood has one. */
function memorial(cell, name, dates) {
  const { x, y, w, h } = cell;
  const cx = x + w / 2, cy = y + h * 0.36;
  let s = `<g filter="url(#spray)"><rect x="${x + w * 0.05}" y="${y + h * 0.05}" width="${w * 0.9}" height="${h * 0.9}" rx="${w * 0.04}" fill="#1c2747"/>`;
  s += `<rect x="${x + w * 0.05}" y="${y + h * 0.05}" width="${w * 0.9}" height="${h * 0.42}" fill="#2f5fa8" opacity="0.55"/>`;
  for (let i = 0; i < 16; i++) s += `<circle cx="${(x + w * between(0.1, 0.9)).toFixed(1)}" cy="${(y + h * between(0.1, 0.42)).toFixed(1)}" r="${(w * between(0.02, 0.05)).toFixed(1)}" fill="#fff" opacity="${between(0.2, 0.5).toFixed(2)}"/>`;
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
    const L = w * (0.32 - i * 0.03), a = side * (0.25 + i * 0.2);
    s += `<path d="M${cx + side * w * 0.03} ${cy}Q${cx + side * L * 0.6} ${cy - h * 0.2 + i * h * 0.02} ${cx + Math.sin(a + side * 1.1) * L} ${cy - Math.cos(a + side * 1.1) * L * 0.6}" fill="none" stroke="#f8f4e8" stroke-width="${w * 0.03}" stroke-linecap="round"/>`;
  }
  s += `<path d="${word("RIP", x + w * 0.34, y + h * 0.26, w * 0.32, h * 0.16, { gap: 0.3 })}" fill="none" stroke="#e8b73a" stroke-width="${h * 0.028}" stroke-linecap="round"/>`;
  s += `<path d="${word(name, x + w * 0.1, y + h * 0.52, w * 0.8, h * 0.17, { gap: 0.22, slant: 0.08 })}" fill="none" stroke="#f8f4e8" stroke-width="${h * 0.035}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${word(dates, x + w * 0.2, y + h * 0.73, w * 0.6, h * 0.07, { gap: 0.25 })}" fill="none" stroke="#e8b73a" stroke-width="${h * 0.014}" stroke-linecap="round"/>`;
  for (const [fx, c] of [[0.16, "#d7263d"], [0.26, "#f46036"], [0.74, "#f46036"], [0.84, "#d7263d"], [0.5, "#f2d64a"]]) {
    s += `<circle cx="${x + w * fx}" cy="${y + h * 0.88}" r="${w * 0.04}" fill="${c}"/><circle cx="${x + w * fx}" cy="${y + h * 0.88}" r="${w * 0.016}" fill="#3a0f14"/>`;
  }
  return s + `</g>`;
}

/** The kind of mural a neighbourhood association pays for: a big name over the flag's colours. */
function streetMural(cell, title, sub) {
  const { x, y, w, h } = cell;
  let s = `<g filter="url(#ghost2)"><rect x="${x}" y="${y}" width="${w / 3}" height="${h}" fill="#2a7a4a"/><rect x="${x + w / 3}" y="${y}" width="${w / 3}" height="${h}" fill="#efe8d6"/><rect x="${x + (2 * w) / 3}" y="${y}" width="${w / 3}" height="${h}" fill="#c0392b"/>`;
  s += `<rect x="${x}" y="${y + h * 0.66}" width="${w}" height="${h * 0.34}" fill="#1b2a44"/>`;
  s += `<path d="${word(title, x + w * 0.05, y + h * 0.15, w * 0.9, h * 0.42, { gap: 0.22 })}" fill="none" stroke="#16100c" stroke-width="${h * 0.12}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${h * 0.015} ${h * 0.02})"/>`;
  s += `<path d="${word(title, x + w * 0.05, y + h * 0.15, w * 0.9, h * 0.42, { gap: 0.22 })}" fill="none" stroke="#f6c945" stroke-width="${h * 0.085}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${word(sub, x + w * 0.14, y + h * 0.74, w * 0.72, h * 0.14, { gap: 0.28 })}" fill="none" stroke="#efe8d6" stroke-width="${h * 0.028}" stroke-linecap="round"/>`;
  return s + `</g>`;
}

/** Hard-edged triangles in a tight palette: the commissioned wall on the newer building. */
function geometric(cell, palette) {
  const { x, y, w, h } = cell;
  const cols = 9, rows = Math.max(3, Math.round((cols * h) / w)), cw = w / cols, ch = h / rows;
  let s = `<g filter="url(#roller)">`;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const ax = x + i * cw, ay = y + j * ch, flip = rand() < 0.5;
    const c1 = palette[Math.floor(rand() * palette.length)], c2 = palette[Math.floor(rand() * palette.length)];
    const t1 = flip ? [[ax, ay], [ax + cw, ay], [ax, ay + ch]] : [[ax, ay], [ax + cw, ay], [ax + cw, ay + ch]];
    const t2 = flip ? [[ax + cw, ay], [ax + cw, ay + ch], [ax, ay + ch]] : [[ax, ay], [ax + cw, ay + ch], [ax, ay + ch]];
    for (const [t, c] of [[t1, c1], [t2, c2]]) s += `<polygon points="${t.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" fill="${c}"/>`;
  }
  return s + `</g>`;
}

/** Flat-colour characters: the pigeon and the cat, stencilled or pasted around the block. */
function pigeon(cell, body, dark, label) {
  const { x, y, w, h } = cell;
  const X = (u) => (x + u * w).toFixed(1), Y = (v) => (y + v * h).toFixed(1);
  let s = `<g filter="url(#spray)">`;
  s += `<path d="M${X(0.2)} ${Y(0.56)}Q${X(0.24)} ${Y(0.3)} ${X(0.48)} ${Y(0.34)}Q${X(0.56)} ${Y(0.14)} ${X(0.7)} ${Y(0.14)}Q${X(0.84)} ${Y(0.16)} ${X(0.82)} ${Y(0.3)}L${X(0.93)} ${Y(0.34)}L${X(0.8)} ${Y(0.37)}Q${X(0.78)} ${Y(0.62)} ${X(0.56)} ${Y(0.7)}L${X(0.2)} ${Y(0.74)}L${X(0.04)} ${Y(0.84)}L${X(0.1)} ${Y(0.66)}Z" fill="${body}"/>`;
  s += `<path d="M${X(0.24)} ${Y(0.52)}Q${X(0.4)} ${Y(0.4)} ${X(0.58)} ${Y(0.48)}Q${X(0.46)} ${Y(0.64)} ${X(0.2)} ${Y(0.68)}Z" fill="${dark}"/>`;
  s += `<circle cx="${X(0.72)}" cy="${Y(0.25)}" r="${h * 0.032}" fill="#fdf6e0"/><circle cx="${X(0.725)}" cy="${Y(0.25)}" r="${h * 0.015}" fill="#0a0a0a"/>`;
  s += `<path d="M${X(0.42)} ${Y(0.7)}L${X(0.42)} ${Y(0.82)}M${X(0.54)} ${Y(0.68)}L${X(0.54)} ${Y(0.82)}" stroke="${dark}" stroke-width="${h * 0.02}"/>`;
  if (label) s += `<path d="${word(label, x + w * 0.1, y + h * 0.86, w * 0.8, h * 0.1, { gap: 0.26 })}" fill="none" stroke="${body}" stroke-width="${h * 0.02}" stroke-linecap="butt"/>`;
  return s + `</g>`;
}

function catStencil(cell, color) {
  const { x, y, w, h } = cell;
  const X = (u) => (x + u * w).toFixed(1), Y = (v) => (y + v * h).toFixed(1);
  let s = `<g filter="url(#spray)"><path d="M${X(0.22)} ${Y(0.9)}Q${X(0.16)} ${Y(0.5)} ${X(0.36)} ${Y(0.36)}L${X(0.32)} ${Y(0.1)}L${X(0.46)} ${Y(0.22)}Q${X(0.54)} ${Y(0.2)} ${X(0.62)} ${Y(0.22)}L${X(0.76)} ${Y(0.1)}L${X(0.72)} ${Y(0.36)}Q${X(0.88)} ${Y(0.5)} ${X(0.82)} ${Y(0.9)}Z" fill="${color}"/>`;
  s += `<path d="M${X(0.82)} ${Y(0.86)}Q${X(1)} ${Y(0.82)} ${X(0.94)} ${Y(0.56)}" fill="none" stroke="${color}" stroke-width="${w * 0.05}" stroke-linecap="round"/>`;
  return s + `<circle cx="${X(0.44)}" cy="${Y(0.36)}" r="${w * 0.03}" fill="#f2e24a"/><circle cx="${X(0.64)}" cy="${Y(0.36)}" r="${w * 0.03}" fill="#f2e24a"/></g>`;
}

/** Stickers on a sign pole or a shutter: "HI I AM" slaps and printed vinyl, overlapping. */
function slaps(cell, count) {
  const { x, y, w, h } = cell;
  const kinds = [["#c8301f", "#fff", "HI I AM", "KAPS"], ["#1e4fa8", "#fff", "HI I AM", "OZZ"], ["#f2d64a", "#111", "LOST", "LEAF"], ["#111", "#f2f0e8", "NO", "FEAR"], ["#f4efe3", "#c8301f", "DUKE", "7"], ["#2a8a5a", "#fff", "MOTT", "ST"]];
  let s = `<g filter="url(#paper)">`;
  for (let i = 0; i < count; i++) {
    const k = kinds[Math.floor(rand() * kinds.length)];
    const sw = w * between(0.22, 0.32), sh = sw * 0.68, sx = x + rand() * (w - sw), sy = y + rand() * (h - sh);
    s += `<g transform="rotate(${between(-14, 14).toFixed(1)} ${(sx + sw / 2).toFixed(1)} ${(sy + sh / 2).toFixed(1)})"><rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${sw.toFixed(1)}" height="${sh.toFixed(1)}" rx="${(sw * 0.06).toFixed(1)}" fill="${k[0]}"/>`;
    s += `<path d="${word(k[2], sx + sw * 0.08, sy + sh * 0.08, sw * 0.84, sh * 0.26, { gap: 0.25 })}" fill="none" stroke="${k[1]}" stroke-width="${sh * 0.05}"/>`;
    s += `<rect x="${(sx + sw * 0.06).toFixed(1)}" y="${(sy + sh * 0.42).toFixed(1)}" width="${(sw * 0.88).toFixed(1)}" height="${(sh * 0.48).toFixed(1)}" fill="#f8f6ee"/>`;
    s += stroke(word(k[3], sx + sw * 0.1, sy + sh * 0.46, sw * 0.8, sh * 0.38, { jitter: 0.05, slant: 0.2, gap: 0.08 }), "#101014", sh * 0.055);
    s += `</g>`;
  }
  return s + `</g>`;
}

/** Ignorant style: wobbly, deliberately childish letters with a crown and a heart. */
function naive(cell, text, color) {
  const { x, y, w, h } = cell;
  const d = word(text, x + w * 0.08, y + h * 0.36, w * 0.84, h * 0.44, { jitter: 0.09, gap: 0.3, bounce: 0.1 });
  const cx = x + w * 0.5, ty = y + h * 0.08, u = h * 0.11;
  const crown = `M${cx - u * 1.6} ${ty + u * 2}L${cx - u * 1.8} ${ty}L${cx - u * 0.7} ${ty + u}L${cx} ${ty - u * 0.3}L${cx + u * 0.7} ${ty + u}L${cx + u * 1.8} ${ty}L${cx + u * 1.6} ${ty + u * 2}Z`;
  return `<g filter="url(#spray)">` + stroke(crown, color, h * 0.035) + stroke(d, color, h * 0.06) + drips(x + w * 0.1, y + h * 0.8, w * 0.8, color, 5, h * 0.018, h * 0.14) + `</g>`;
}

// ------------------------------------------------------------------ the sheet

const rects = {};
let cursor = { x: 8, y: 8, rowH: 0 };
function cell(name, w, h) {
  if (cursor.x + w + 8 > SIZE) cursor = { x: 8, y: cursor.y + cursor.rowH + 16, rowH: 0 };
  const c = { x: cursor.x, y: cursor.y, w, h };
  cursor.x += w + 16;
  cursor.rowH = Math.max(cursor.rowH, h);
  rects[name] = c;
  return c;
}

const defs = `<defs>
  <filter id="ghost" x="0" y="0" width="1" height="1">
    <feTurbulence type="fractalNoise" baseFrequency="0.018 0.05" numOctaves="4" seed="4" result="big"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" seed="9" result="fine"/>
    <feComposite in="big" in2="fine" operator="arithmetic" k1="1.5" k2="0.5" k3="0.1" k4="0"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.1 0 0 0 -0.34" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in"/>
  </filter>
  <filter id="ghost2" x="0" y="0" width="1" height="1">
    <feTurbulence type="fractalNoise" baseFrequency="0.03 0.012" numOctaves="4" seed="21" result="big"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="3" result="fine"/>
    <feComposite in="big" in2="fine" operator="arithmetic" k1="1.5" k2="0.5" k3="0.1" k4="0"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.0 0 0 0 -0.3" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in"/>
  </filter>
  <filter id="spray" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="12" result="wear"/>
    <feColorMatrix in="wear" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3 0 0 0 0.05" result="mask"/>
    <feComposite in="d" in2="mask" operator="in"/>
  </filter>
  <filter id="paper" x="0" y="0" width="1" height="1">
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="4" seed="31" result="wear"/>
    <feColorMatrix in="wear" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  5 0 0 0 -1.5" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in"/>
  </filter>
  <filter id="roller" x="0" y="0" width="1" height="1">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.14" numOctaves="3" seed="17" result="s"/>
    <feColorMatrix in="s" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.4 0 0 0 -0.55" result="mask"/>
    <feComposite in="SourceGraphic" in2="mask" operator="in"/>
  </filter>
</defs>`;

let art = "";
const put = (name, w, h, draw) => {
  const c = cell(name, w, h), id = "clip_" + name;
  art += `<clipPath id="${id}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}"/></clipPath><g clip-path="url(#${id})">${draw(c)}</g>`;
};
put("ghost_macaroni", 760, 460, (c) => ghostSign(c, [
  { text: "BELLANDI BROS", size: 3, weight: 0.17 }, { text: "MACARONI & OIL", size: 2.2, color: "#f0e6c8", weight: 0.15 }, { text: "SINCE 1911", size: 1 },
], "#6d2a20", "#ead9ae", "ghost"));
put("ghost_cigars", 520, 760, (c) => ghostSign(c, [
  { text: "OLD", size: 1.4 }, { text: "PIER", size: 2.3, weight: 0.19 }, { text: "CIGARS", size: 1.7, color: "#f4d58a", weight: 0.17 }, { text: "5 CENTS", size: 1 },
], "#1e3347", "#e8e0c4", "ghost2"));
put("ghost_collars", 680, 340, (c) => ghostSign(c, [
  { text: "NONPAREIL", size: 2.2, weight: 0.17 }, { text: "COLLARS & CUFFS", size: 1.4 }, { text: "ASK YOUR TAILOR", size: 0.8 },
], "#d9cfad", "#3a2a22", "ghost"));
put("piece_leaf", 1000, 340, (c) => piece(c, "LASTLEAF", "#ffe25c", "#ff7a2d", "#d81e5b", "#1fa6b8", "#22326e"));
put("piece_mott", 900, 320, (c) => piece(c, "MOTT", "#8ef0d0", "#2cb5e8", "#5b3bd6", "#e8446b", "#7a1f6a"));
put("throw_0", 460, 220, (c) => throwUp(c, "KAPS", "#f4f0e4", "#14161e", "#c82c4a"));
put("throw_1", 460, 220, (c) => throwUp(c, "RUBE", "#47c9e6", "#0d1020", "#f4f0e4"));
put("throw_2", 460, 220, (c) => throwUp(c, "BLOK", "#f2c230", "#171010", "#e04a22"));
put("throw_3", 460, 220, (c) => throwUp(c, "OZZ", "#e8e4d8", "#27305c", "#16b08a"));
put("tag_0", 360, 130, (c) => tag(c, "SIK9", "#101014"));
put("tag_1", 360, 130, (c) => tag(c, "NUTZ", "#c7c9cc", { spray: true }));
put("tag_2", 360, 130, (c) => tag(c, "MR TOM", "#d32f3f", { spray: true }));
put("tag_3", 360, 130, (c) => tag(c, "KAPS", "#14161e", { width: 0.1 }));
put("tag_4", 360, 130, (c) => tag(c, "ROOF", "#f2f0ea", { spray: true, width: 0.11 }));
put("tag_5", 360, 130, (c) => tag(c, "EL OSO", "#1e6fd0", { under: false }));
put("paste_0", 640, 420, (c) => wheatpaste(c, 12));
put("paste_1", 460, 300, (c) => wheatpaste(c, 6));
put("leaf_0", 220, 260, (c) => leafStencil(c, "#c8501f", "STILL HERE"));
put("leaf_1", 220, 260, (c) => leafStencil(c, "#efe8d6", "LET GO"));

put("wild_0", 980, 400, (c) => wildstyle(c, "SKAMO", "#f6e04a", "#e8342c", "#0c0a14"));
put("wild_1", 980, 400, (c) => wildstyle(c, "VEXOR", "#54e6c8", "#3a3ad0", "#10061c"));
put("chrome_0", 620, 260, (c) => chrome(c, "ZONE", "#2346c4"));
put("chrome_1", 620, 260, (c) => chrome(c, "HYPE", "#c42346"));
put("block_0", 1200, 340, (c) => blockbuster(c, "DEFER", "#f2f0e6", "#1a1a20"));
put("block_1", 1200, 340, (c) => blockbuster(c, "MOSS", "#e8452c", "#22101a"));
put("bubble_0", 600, 280, (c) => bubble(c, "JUNE", "#f27eb4", "#3a0f3a"));
put("bubble_1", 600, 280, (c) => bubble(c, "POPS", "#7fd4f2", "#102a4a"));
put("tagwall_0", 900, 420, (c) => tagWall(c, 46));
put("tagwall_1", 640, 300, (c) => tagWall(c, 28));
put("memorial_0", 460, 620, (c) => memorial(c, "SAL", "1948 - 2019"));
put("mural_mulberry", 1300, 420, (c) => streetMural(c, "MULBERRY", "BENVENUTI SINCE 1890"));
put("geo_0", 800, 400, (c) => geometric(c, ["#f2b632", "#e8552c", "#2a6f8a", "#173a55", "#efe6cf"]));
put("geo_1", 500, 500, (c) => geometric(c, ["#ee6aa0", "#7a3bd0", "#2cc4b4", "#1a1a33", "#f4efe3"]));
put("pigeon_0", 420, 340, (c) => pigeon(c, "#dfe3e6", "#55606a", "WATCHING YOU"));
put("pigeon_1", 620, 500, (c) => pigeon(c, "#3f7fd0", "#16294a", null));
put("cat_0", 240, 300, (c) => catStencil(c, "#17151a"));
put("cat_1", 240, 300, (c) => catStencil(c, "#e8742c"));
put("slaps_0", 520, 340, (c) => slaps(c, 14));
put("slaps_1", 360, 300, (c) => slaps(c, 9));
put("naive_0", 460, 300, (c) => naive(c, "KING RAT", "#f4f0e4"));
put("naive_1", 460, 300, (c) => naive(c, "OK BYE", "#e23c6a"));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${defs}${esc(art)}</svg>`;

fs.mkdirSync(OUT, { recursive: true });
await sharp(Buffer.from(svg)).webp({ quality: 88, alphaQuality: 90 }).toFile(path.join(OUT, "wall_art.webp"));
fs.writeFileSync(path.join(OUT, "wall_art.json"), JSON.stringify({ size: SIZE, rects }));
console.log("wall art:", Object.keys(rects).length, "pieces, sheet used to y =", cursor.y + cursor.rowH);
