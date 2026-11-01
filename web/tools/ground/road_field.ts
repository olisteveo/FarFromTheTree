// Where the traffic actually goes, baked from the real street centrelines so the road shader (render/groundArt.ts) can
// wear the asphalt along the lanes: tyre tracks, oil down the lane centres, grime in the gutters, polish at junctions.
//
//   npx tsx tools/ground/road_field.ts   -> public/textures/ground/road_field_{a,b}.png (2 m to the pixel)
//
//   a: R signed metres from the centreline (+-24), G the street's direction (angle / pi), B how much of a junction this is
//   b: R half the road's width (metres / 24), G lane spacing (metres / 8), B lane phase (metres / 8)
// FIELD is mirrored in groundArt.ts: keep them in step.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Grid, type CityData as CityT } from "../../src/world/data";
import { CityData } from "../../src/world/data";

const FIELD = { x0: -2000, z0: -400, w: 4000, d: 9800, metresPerPx: 2 };
const W = FIELD.w / FIELD.metresPerPx, H = FIELD.d / FIELD.metresPerPx;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const city: CityT = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
interface Seg { ax: number; az: number; tx: number; tz: number; L: number; w: number; lanes: number; dir: number; name: string }
const segs: Seg[] = [];
const grid = new Grid<Seg>(32);
for (const st of city.raw.streets) {
  if (st.rw !== 1 || st.p.length < 4) continue;
  for (let i = 0; i + 3 < st.p.length; i += 2) {
    const ax = st.p[i], az = st.p[i + 1], dx = st.p[i + 2] - ax, dz = st.p[i + 3] - az, L = Math.hypot(dx, dz);
    if (L < 0.2) continue;
    const s: Seg = { ax, az, tx: dx / L, tz: dz / L, L, w: st.w, lanes: Math.max(1, st.l), dir: st.d, name: st.n };
    segs.push(s);
    grid.add(s, Math.min(ax, ax + dx) - 34, Math.min(az, az + dz) - 34, Math.max(ax, ax + dx) + 34, Math.max(az, az + dz) + 34);
  }
}

const a = Buffer.alloc(W * H * 3), b = Buffer.alloc(W * H * 3);
let written = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const px = FIELD.x0 + (x + 0.5) * FIELD.metresPerPx, pz = FIELD.z0 + (y + 0.5) * FIELD.metresPerPx;
  // nearest centreline, and the nearest belonging to a different street (that's what makes it a junction)
  let best: Seg | null = null, bd = 1e9, bo = 0, otherD = 1e9;
  const near = grid.at(px, pz);
  for (const s of near) {
    const t = Math.max(0, Math.min(s.L, (px - s.ax) * s.tx + (pz - s.az) * s.tz));
    const qx = s.ax + s.tx * t, qz = s.az + s.tz * t, d = Math.hypot(px - qx, pz - qz);
    if (d < bd) { bd = d; best = s; bo = (px - s.ax) * -s.tz + (pz - s.az) * s.tx; }
  }
  const o = (y * W + x) * 3;
  if (!best) { a[o + 2] = 255; continue; } // nothing near: all junction, so no lane wear is drawn
  for (const s of near) {
    if (s.name === best.name) continue;
    const t = Math.max(0, Math.min(s.L, (px - s.ax) * s.tx + (pz - s.az) * s.tz));
    otherD = Math.min(otherD, Math.hypot(px - s.ax - s.tx * t, pz - s.az - s.tz * t) - s.w / 2);
  }
  const half = best.w / 2;
  const lanes = Math.min(4, best.lanes), step = Math.min(3.3, best.w / Math.max(lanes, 1));
  // the same lane centres traffic.ts drives: one-way lanes straddle the centreline, two-way ones start half a lane out
  const nl = best.dir === 0 ? Math.max(1, Math.floor(lanes / 2)) : lanes;
  const phase = best.dir === 0 ? step / 2 : (((nl - 1) / 2) % 1) * step;
  const angle = ((Math.atan2(best.tz, best.tx) % Math.PI) + Math.PI) % Math.PI;
  a[o] = Math.round((Math.max(-24, Math.min(24, bo)) / 48 + 0.5) * 255);
  a[o + 1] = Math.round((angle / Math.PI) * 255);
  a[o + 2] = Math.round((1 - smooth(1, 9, otherD)) * 255);
  b[o] = Math.round(Math.min(1, half / 24) * 255);
  b[o + 1] = Math.round(Math.min(1, step / 8) * 255);
  b[o + 2] = Math.round(Math.min(1, phase / 8) * 255);
  written++;
}
const OUT = path.resolve("public/textures/ground");
await sharp(a, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, "road_field_a.png"));
await sharp(b, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, "road_field_b.png"));
for (const f of ["a", "b"]) console.log(f, Math.round(fs.statSync(path.join(OUT, `road_field_${f}.png`)).size / 1024), "KB");
console.log("field", W, "x", H, "pixels with a street", written, "of", W * H, "segments", segs.length);
