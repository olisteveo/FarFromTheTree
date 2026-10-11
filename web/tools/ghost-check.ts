// Things drawn inside the playable corridor that the leaf can't hit (it flies straight through):
// far-city buildings (far.dat), skyline towers, and the bridge district's buildings.
//   npx tsx tools/ghost-check.ts
import fs from "node:fs";
import zlib from "node:zlib";
import { CityData, inRing } from "../src/world/data";
import { decodeFar } from "../src/render/farData";
import { AIR } from "../src/world/airflow";
import { DISTRICT_ZONE } from "../src/world/modelled";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const inCorridor = (x: number, z: number) => city.route.nearest(x, z).d < AIR.corridor + 5;
const solid = (x: number, z: number) => !!city.buildingAt(x, z);
let b = fs.readFileSync("public/far.dat"); if (b[0] === 0x1f) b = zlib.gunzipSync(b);
const f = decodeFar(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const ghosts: { kind: string; x: number; z: number; h: number; s: number }[] = [];
for (let i = 0; i < f.start.length; i++) {
  const s = f.start[i] * 2, n = f.count[i];
  let cx = 0, cz = 0; for (let k = 0; k < n; k++) { cx += f.verts[s + k * 2]; cz += f.verts[s + k * 2 + 1]; } cx /= n; cz /= n;
  if (!inCorridor(cx, cz) || solid(cx, cz)) continue;
  const inDistrict = inRing(DISTRICT_ZONE, cx, cz);
  ghosts.push({ kind: inDistrict ? "district" : "far", x: cx, z: cz, h: f.height[i], s: city.route.nearest(cx, cz).s });
}
for (const t of city.raw.skyline) {
  const r = t.p[0]; let cx = 0, cz = 0; for (let k = 0; k < r.length; k += 2) { cx += r[k]; cz += r[k + 1]; } cx /= r.length / 2; cz /= r.length / 2;
  if (inCorridor(cx, cz) && !solid(cx, cz)) ghosts.push({ kind: "skyline", x: cx, z: cz, h: t.h, s: city.route.nearest(cx, cz).s });
}
const by: Record<string, number> = {}; for (const g of ghosts) by[g.kind] = (by[g.kind] ?? 0) + 1;
console.log("ghost buildings inside the corridor:", by);
const near = ghosts.filter((g) => city.route.nearest(g.x, g.z).d < 200).sort((a, b) => a.s - b.s);
console.log("within 200 m of the route:", near.length);
for (const g of near.slice(0, 25)) console.log(`  ${g.kind} s${g.s.toFixed(0)} h${g.h.toFixed(0)} at ${g.x.toFixed(0)},${g.z.toFixed(0)} d${city.route.nearest(g.x, g.z).d.toFixed(0)}`);
fs.writeFileSync("results/ghosts.json", JSON.stringify(ghosts));
