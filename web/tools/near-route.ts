// Where a point sits against each wind route: nearest s, distance off, height of the current there.
//   npx tsx tools/near-route.ts x,z [x,z ...]
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
for (const arg of process.argv.slice(2)) {
  const [x, z] = arg.split(",").map(Number);
  for (const r of flow.features.routes) {
    let best = 1e9, bs = 0;
    for (let s = 0; s < r.line.length; s += 2) { const a = r.line.at(s); const d = Math.hypot(a.x - x, a.z - z); if (d < best) { best = d; bs = s; } }
    console.log(`(${x},${z}) ${r.id.padEnd(6)} s ${bs} off ${best.toFixed(0)} m, current at y ${r.y(bs).toFixed(0)}`);
  }
}
