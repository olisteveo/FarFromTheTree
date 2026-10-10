// Check the exit paths: how many stairs have one, their length, and the biggest gap between points.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Underground } from "../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(city);
const outs = u.shafts.filter((s) => s.kind === "stairs" && s.out);
let have = 0, worst = 0;
for (const s of outs) {
  const p = s.exitPath;
  if (!p) { console.log("no path:", s.name, u.isBlocked(s.ss) ? "(flooded)" : ""); continue; }
  have++;
  let gap = 0;
  for (let i = 3; i < p.length; i += 3) gap = Math.max(gap, Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]));
  worst = Math.max(worst, gap);
  if (gap > 3) console.log("gap", gap.toFixed(1), s.name);
}
console.log(`${have}/${outs.length} exit stairs have a path; worst gap ${worst.toFixed(1)} m`);
const pick = outs.find((s) => /City Hall/.test(s.name) && s.exitPath)!;
const L = Math.hypot(pick.tx, pick.tz);
console.log("City Hall L", L.toFixed(1));
const p = pick.exitPath!;
for (let i = 0; i < p.length; i += 3) {
  const a = (p[i] - pick.x) * pick.ux + (p[i + 2] - pick.z) * pick.uz;
  console.log(`a ${a.toFixed(1)} y ${p[i + 1].toFixed(2)} sdf ${(p[i + 1] > 0 ? 9 : u.sdf(p[i], p[i + 1], p[i + 2])).toFixed(2)}`);
}
{
  // every segment clear?
  let bad = 0, segs = 0;
  for (const s of outs) {
    const p = s.exitPath; if (!p) continue;
    for (let i = 0; i < p.length - 3; i += 3) {
      segs++;
      for (let t = 0.25; t < 1; t += 0.25) {
        const x = p[i] + (p[i + 3] - p[i]) * t, y = p[i + 1] + (p[i + 4] - p[i + 1]) * t, z = p[i + 2] + (p[i + 5] - p[i + 2]) * t;
        if (y < 0.3 && u.sdf(x, y, z) < 0.1) { bad++; break; }
      }
    }
  }
  console.log(`${bad} of ${segs} path segments touch a wall`);
}
