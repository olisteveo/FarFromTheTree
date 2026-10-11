// Subway entrances whose opening overlaps a building, or whose open end faces straight into one.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Underground, STAIRS } from "../src/world/underground";
const c = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(c);
let overlap = 0, faces = 0, n = 0;
for (const s of u.shafts) {
  if (s.kind !== "stairs") continue;
  n++;
  const P = (a: number, b: number) => [s.x + s.ux * a + s.uz * b, s.z + s.uz * a - s.ux * b];
  const inB = (a: number, b: number) => !!c.buildingAt(...(P(a, b) as [number, number]));
  const ov = [-1.8, 0, 1.8].some((a) => [-1.6, 0, 1.6].some((b) => inB(a, b)));
  const fc = !ov && [-1.2, 0, 1.2].some((b) => inB(-STAIRS.half - 1.5, b));
  if (ov) overlap++; if (fc) faces++;
  if (ov || fc) console.log(`${s.name.padEnd(16)} ${s.out ? "out" : "in "} at ${s.x.toFixed(0)},${s.z.toFixed(0)} ${ov ? "OVERLAPS a building" : "open end faces a building"}`);
}
console.log({ stairs: n, overlap, faces });
