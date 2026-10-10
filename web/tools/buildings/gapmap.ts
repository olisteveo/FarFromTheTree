// Debug map of the gaps: node --import tsx tools/buildings/gapmap.ts <s0> <s1>
// Writes tools/buildings/previews/gapmap_<s0>.png (1 px = 1 m): grey land, dark roads, light
// sidewalks, brown buildings, green parks, orange sites, RED = gaps (free land, no footprint).
import fs from "node:fs";
import sharp from "sharp";
import { CityData } from "../../src/world/data";
import { rasterCity, LAND, PAVED, BUILT, GREEN, SITE, ROAD } from "./raster";

const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const [s0, s1] = process.argv.slice(2).map(Number);
const R = rasterCity(city);
// overlay what gaps.ts decided: infill yellow, extensions orange-brown, slivers purple, parking cyan, construction magenta
const INF = 128;
const over = new Uint8Array(R.w * R.h);
if (fs.existsSync("public/models/buildings_gaps.json")) {
  const g = JSON.parse(fs.readFileSync("public/models/buildings_gaps.json", "utf8"));
  for (const b of g.buildings) R.fill(b.p, (i) => { over[i] = b.why === "infill" ? 1 : b.why === "extension" ? 2 : 3; });
  for (const l of g.lots) R.fill(l.p, (i) => { over[i] = l.kind === "parking" ? 4 : 5; });
}
void INF;
const a = city.route.at(s0), b = city.route.at(s1);
const x0 = Math.min(a.x, b.x) - 380, x1 = Math.max(a.x, b.x) + 380, z0 = Math.min(a.z, b.z) - 380, z1 = Math.max(a.z, b.z) + 380;
const W = Math.round(x1 - x0), H = Math.round(z1 - z0);
const img = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = Math.floor((z1 - y - R.z0) / R.cell) * R.w + Math.floor((x1 - x - R.x0) / R.cell); // x is -east: flip so east is right
  const v = R.bits[i] ?? 0;
  let c = [30, 50, 70];
  if (v & LAND) c = [255, 0, 0];
  if (v & PAVED) c = v & ROAD ? [60, 60, 60] : [170, 170, 165];
  if (v & SITE) c = [220, 140, 40];
  if (v & GREEN) c = [60, 140, 60];
  if (v & BUILT) c = [120, 90, 70];
  const o = over[i] ?? 0;
  if (o) c = [[0, 0, 0], [240, 220, 60], [190, 120, 60], [150, 80, 200], [60, 220, 230], [230, 60, 200]][o];
  img.set(c, (y * W + x) * 3);
}
fs.mkdirSync("tools/buildings/previews", { recursive: true });
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`tools/buildings/previews/gapmap_${s0}.png`);
console.log("wrote", W, H);
