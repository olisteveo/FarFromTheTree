// The wind along the whole route: per 100 m, at street (4 m), roof (canopy+8) and high (canopy+40),
// averaged across the corridor near the route (±60 m) and over time: how much it carries you uptown
// (along) and sideways (lateral, + = to the route's right), and how much it lifts.
//   npx tsx tools/wind-audit.ts
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const o: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
const r = city.route;
console.log("   s   | street along/lat/up | roof along/lat/up | high along/lat/up | edge(+300) lat");
for (let s = 0; s < r.length; s += 200) {
  const p = r.at(s), nx = p.tz, nz = -p.tx; // right of travel
  const acc = { st: [0, 0, 0], rf: [0, 0, 0], hi: [0, 0, 0] } as Record<string, number[]>;
  let edge = 0, n = 0;
  for (const off of [-60, -30, 0, 30, 60]) for (const t of [10, 40, 70]) {
    const x = p.x + nx * off, z = p.z + nz * off;
    const H = city.canopy(x, z, 20);
    for (const [k, y] of [["st", 4], ["rf", H + 8], ["hi", H + 40]] as [string, number][]) {
      flow.sample(x, y, z, t, o);
      acc[k][0] += o.x * p.tx + o.z * p.tz; acc[k][1] += o.x * nx + o.z * nz; acc[k][2] += o.y;
    }
    n++;
  }
  for (const side of [-1, 1]) { const x = p.x + nx * 300 * side, z = p.z + nz * 300 * side; flow.sample(x, 20, z, 30, o); edge += (o.x * nx + o.z * nz) * side; }
  const f = (a: number[]) => a.map((v) => (v / n).toFixed(1).padStart(5)).join(" ");
  console.log(`${String(s).padStart(6)} | ${f(acc.st)} | ${f(acc.rf)} | ${f(acc.hi)} | ${(edge / 2).toFixed(1)}`);
}
